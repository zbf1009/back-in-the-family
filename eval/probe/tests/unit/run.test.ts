// Run-flow examples (llm-probe task 13.2): Dev_Run end to end, Locked_Run on a SYNTHETIC card set,
// precondition, pre-render, rebuild, resume and the Workers AI gate and budget. The dedicated
// property tests are 13.3 to 13.10. Nothing here touches the real eval/results or locked.jsonl.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { AdapterResult } from '../../src/adapters/interface.ts';
import type { Approval } from '../../src/approvals.ts';
import { readLedger } from '../../src/ledger.ts';
import type { PhaseState } from '../../src/phase.ts';
import { gradesPathFor, readFailures, readGradesFile, readResultsFile } from '../../src/results.ts';
import { DEFAULT_TIMEOUT_MS, devRun, lockedRun, parseTimeoutMs, RunError, RuntimeLoadError, type RuntimeFactory } from '../../src/run.ts';
import { parseDevRunArgs, parseLockedRunArgs } from '../../src/run-command.ts';
import { capture, createFakeRuntime, FAKE_COMBO, makeCardSet, makeEnv, REVISION, templatesCopy, WORKERS_COMBO } from './run.helpers.ts';

const cardSet = makeCardSet();
const logFiles = (dir: string, sub: string): string[] => (fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)).sort() : []);

test('Timeout: default 10,000; positive safe integers only', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 10_000);
  assert.equal(parseTimeoutMs(undefined), 10_000);
  assert.equal(parseTimeoutMs('2500'), 2500);
  assert.equal(parseTimeoutMs(1), 1);
  for (const bad of ['0', '-5', '1.5', '1e4', '', 'abc', ' 7', '9007199254740993', 0, -1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseTimeoutMs(bad), (e) => e instanceof RunError && e.code === 'invalid_timeout', String(bad));
  }
});

test('an invalid Timeout starts nothing: no request, no Results', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const { value, err } = await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, timeoutMs: '0' }));
  assert.equal(value, 1);
  assert.match(err, /invalid_timeout.*"0"/);
  assert.equal(rt.calls.length, 0);
  assert.deepEqual(logFiles(env.root, 'eval/results'), []);
});

test('CLI flags: dev-run defaults to DS; locked-run needs --combo and --task or --resume', () => {
  const dev = parseDevRunArgs(['--combo', 'x']);
  assert.ok(dev.ok && dev.options.task === undefined && dev.options.combo === 'x');
  assert.ok(!parseDevRunArgs(['--combo', 'x', '--task', 'Q']).ok);
  assert.ok(!parseDevRunArgs([]).ok);
  assert.ok(parseLockedRunArgs(['--combo', 'x', '--task', 'D', '--rerun-reason', 'why']).ok);
  assert.ok(parseLockedRunArgs(['--resume', 'L-1']).ok);
  assert.ok(!parseLockedRunArgs(['--resume', 'L-1', '--task', 'D']).ok);
  assert.ok(!parseLockedRunArgs(['--combo', 'x']).ok);
});

test('Dev_Run end to end with the fake Runtime writes Results and grades; locked is never loaded', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const { value, out } = await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id }));
  assert.equal(value, 0);
  const files = logFiles(env.root, 'eval/results/dev');
  assert.equal(files.length, 2);
  const results = path.join(env.root, 'eval/results/dev', files.find((f) => !f.endsWith('.grades.jsonl')) as string);
  const { header, records } = readResultsFile(results);
  assert.equal(header.split, 'dev');
  assert.equal(header.task_subset, 'DS');
  assert.equal(header.timeout_ms, 10_000);
  assert.deepEqual(Object.keys(header.template_hashes).sort(), ['decision', 'synthesis']);
  // 104 requests: the design's measured dev count.
  assert.equal(records.length, 104);
  assert.equal(rt.calls.length, 104);
  assert.ok(records.every((r) => r.outcome.kind === 'text' && r.split === 'dev'));
  const grades = readGradesFile(gradesPathFor(results));
  assert.equal(grades.grades.length, 104);
  assert.ok(grades.contrasts.length > 0);
  assert.ok(grades.excluded.some((e) => e.reason === 'sanity'));
  assert.match(out, /D \d+\/74 S \d+\/30/);
});

test('Dev_Run honours --task: a D-only run sends no S request', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const { value } = await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 0);
  assert.equal(rt.calls.length, 74);
  assert.ok(rt.calls.every((c) => !c.user.includes('Schema:')));
});

test('Dev_Run render errors are recorded as not_run (render_error), nothing is sent for them', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const templatesDir = templatesCopy({ file: 'decision.v1.txt', map: (t) => t.replace('{{subject}}', '{{bogus}}') });
  const deps = env.deps(rt);
  const { value } = await capture(() => devRun({ ...deps, paths: { ...deps.paths, templatesDir } }, { combo: FAKE_COMBO.id, task: 'DS' }));
  assert.equal(value, 0);
  const dir = path.join(env.root, 'eval/results/dev');
  const file = fs.readdirSync(dir).find((f) => !f.endsWith('.grades.jsonl')) as string;
  const { records } = readResultsFile(path.join(dir, file));
  const notRun = records.filter((r) => r.outcome.kind === 'not_run');
  assert.equal(notRun.length, 74);
  assert.ok(notRun.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'render_error' && r.latency_ms === null));
  assert.equal(rt.calls.length, 30);
});

/** Dev_Run then Locked_Run on the synthetic locked split. */
async function devThenLocked(env: ReturnType<typeof makeEnv>, rt: ReturnType<typeof createFakeRuntime>, task: 'D' | 'S' | 'DS', extra?: Parameters<typeof lockedRun>[1]) {
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task }))).value, 0);
  const before = rt.calls.length;
  const run = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task, ...extra }));
  return { ...run, sent: rt.calls.length - before };
}

test('Locked_Run on a synthetic card set: ledger start then complete, Results, grades, silent output', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const { value, out, err, sent } = await devThenLocked(env, rt, 'DS');
  assert.equal(value, 0, err);
  assert.equal(sent, 104);
  const { events, entries } = readLedger(path.join(env.root, 'eval/results/ledger.jsonl'));
  assert.deepEqual(events.map((e) => e.event), ['start', 'complete']);
  const entry = entries[0]!;
  assert.equal(entry.status, 'complete');
  assert.deepEqual(entry.start.planned, { decision: 74, synthesis: 30 });
  assert.equal(entry.complete?.requests_sent, 104);
  const results = path.join(env.root, entry.complete?.results as string);
  assert.equal(results, path.join(env.root, 'eval/results/locked', `${entry.entry_id}.jsonl`));
  const { header, records } = readResultsFile(results);
  assert.equal(header.split, 'locked');
  assert.equal(header.run_id, entry.entry_id);
  assert.ok(records.every((r) => cardSet.lockedIds.includes(r.card_id)));
  assert.equal(readGradesFile(gradesPathFor(results)).grades.length, 104);
  // The kiro-log text is printed, progress lines are counts, and no prompt, output or card text appears (R3.11).
  assert.match(out, /docs\/kiro-log\.md entry to paste/);
  assert.match(out, /D \d+\/74 S \d+\/30/);
  const all = out + err;
  for (const secret of ['Today is day', 'People:', '{"option"', 'Harold', 'June Pike', 'ladder']) assert.ok(!all.includes(secret), `output leaked ${secret}`);
});

test('once-only: a second Locked_Run of the same Model_Key is refused; --rerun-reason allows it', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  assert.equal((await devThenLocked(env, rt, 'D')).value, 0);
  const ledger = path.join(env.root, 'eval/results/ledger.jsonl');
  const before = fs.readFileSync(ledger, 'utf8');
  const calls = rt.calls.length;
  const refused = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(refused.value, 1);
  assert.match(refused.err, /--rerun-reason/);
  assert.equal(fs.readFileSync(ledger, 'utf8'), before);
  assert.equal(rt.calls.length, calls);
  const again = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D', rerunReason: 'checking a fix' }));
  assert.equal(again.value, 0, again.err);
  const entries = readLedger(ledger).entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[1]?.start.rerun_of, entries[0]?.entry_id);
});

test('Dev_Run precondition: no Dev_Run, or a changed Template_Hash, sends nothing and writes nothing', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const none = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'DS' }));
  assert.equal(none.value, 1);
  assert.match(none.err, /no Dev_Run of Combination fake\/in-browser covers Task_Type D/);
  assert.match(none.err, /Task_Type S/);
  assert.deepEqual(logFiles(env.root, 'eval/results'), []);

  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
  const calls = rt.calls.length;
  const templatesDir = templatesCopy({ file: 'decision.v1.txt', map: (t) => `${t}\nExtra line.\n` });
  const deps = env.deps(rt);
  const changed = await capture(() => lockedRun({ ...deps, paths: { ...deps.paths, templatesDir } }, { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(changed.value, 1);
  assert.match(changed.err, /Prompt_Template decision differs from the most recent Dev_Run/);
  assert.equal(rt.calls.length, calls);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')));
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/locked')));
});

test('pre-render: every Card ID with a render error is printed, nothing is written or sent', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const bogus = templatesCopy({ file: 'decision.v1.txt', map: (t) => t.replace('{{subject}}', '{{bogus}}') });
  const bad = { ...env.deps(rt) };
  const badDeps = { ...bad, paths: { ...bad.paths, templatesDir: bogus } };
  // The Dev_Run records the bogus template's hash with render_error records, so the precondition holds.
  assert.equal((await capture(() => devRun(badDeps, { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
  const calls = rt.calls.length;
  const { value, err } = await capture(() => lockedRun(badDeps, { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 1);
  const decisionIds = cardSet.lockedIds.filter((id) => id.startsWith('D-'));
  for (const id of decisionIds) assert.ok(err.includes(`Card ID ${id}`), id);
  assert.ok(!err.includes('{{bogus}}') && !err.includes('bogus'));
  assert.equal(rt.calls.length, calls);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')));
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/locked')));
});

test('a stuck engine is rebuilt (create + both warm-ups) before the next request', async () => {
  const env = makeEnv(cardSet);
  const timeout: AdapterResult = { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'none', reason: 'idle_cap' }) };
  const rt = createFakeRuntime({ script: (i, p) => (i === 78 ? timeout : { kind: 'text', text: '{"option":"x"}', latencyMs: 1, usage: null }), stuckAfter: [78] });
  const { value } = await devThenLocked(env, rt, 'D');
  assert.equal(value, 0);
  // Dev_Run: load only. Locked_Run: load, then dispose + create + decision warm-up + synthesis warm-up once.
  assert.deepEqual(rt.engine, ['load', 'load', 'dispose', 'create', 'warmup', 'warmup']);
  const entry = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!;
  const { records } = readResultsFile(path.join(env.root, entry.complete?.results as string));
  const t = records.filter((r) => r.outcome.kind === 'timeout');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0]?.late, { kind: 'none', reason: 'idle_cap' });
});

test('a failed rebuild: one rebuild_failed failure record, an abort event, not_run for the rest; then --resume completes', async () => {
  const env = makeEnv(cardSet);
  const timeout: AdapterResult = { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'none', reason: 'idle_cap' }) };
  const rt = createFakeRuntime({ script: (i, p) => (i === 80 ? timeout : { kind: 'text', text: '{"option":"x"}', latencyMs: 1, usage: null }), stuckAfter: [80], failRebuilds: 1 });
  const first = await devThenLocked(env, rt, 'D');
  assert.equal(first.value, 1);
  const ledger = path.join(env.root, 'eval/results/ledger.jsonl');
  let { events, entries } = readLedger(ledger);
  assert.deepEqual(events.map((e) => e.event), ['start', 'abort']);
  assert.equal(entries[0]?.abort_reason, 'rebuild_failed');
  assert.equal(entries[0]?.status, 'incomplete');
  const failures = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, 'rebuild_failed');
  const id = entries[0]!.entry_id;
  const file = path.join(env.root, 'eval/results/locked', `${id}.jsonl`);
  let { records } = readResultsFile(file);
  const rest = records.filter((r) => r.outcome.kind === 'not_run');
  assert.equal(rest.length, 74 - 7);
  assert.ok(rest.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'rebuild_failed'));
  assert.ok(!fs.existsSync(gradesPathFor(file)));

  // Resume: only the Card x Permutations without an output are sent (R3.9).
  const before = rt.calls.length;
  const resumed = await capture(() => lockedRun(env.deps(rt), { resume: id }));
  assert.equal(resumed.value, 0, resumed.err);
  assert.equal(rt.calls.length - before, rest.length);
  ({ events, entries } = readLedger(ledger));
  assert.deepEqual(events.map((e) => e.event), ['start', 'abort', 'resume', 'complete']);
  ({ records } = readResultsFile(file));
  assert.equal(records.length, 74 + rest.length);
  assert.equal(readGradesFile(gradesPathFor(file)).grades.length, 74);
});

test('--resume refuses a completed or unknown entry and sends nothing', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  assert.equal((await devThenLocked(env, rt, 'D')).value, 0);
  const id = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!.entry_id;
  const calls = rt.calls.length;
  for (const bad of [id, 'L-nope']) {
    const r = await capture(() => lockedRun(env.deps(rt), { resume: bad }));
    assert.equal(r.value, 1);
    assert.match(r.err, /resume_unknown/);
  }
  assert.equal(rt.calls.length, calls);
});

test('outcome mapping: timeout + late, error codes, non_text_response, engine_fault', async () => {
  const env = makeEnv(cardSet);
  const scripted: AdapterResult[] = [
    { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_002, late: Promise.resolve({ kind: 'late', text: '{"option":"late"}', latencyMs: 12_000 }) },
    { kind: 'error', code: 'remote_error', detail: 'HTTP 500', elapsedMs: 40, remote: { status: 500, code: null } },
    { kind: 'error', code: 'non_text_response', detail: 'array', elapsedMs: 41, remote: null },
    { kind: 'error', code: 'runtime_stuck', detail: 'stuck', elapsedMs: 0, remote: null },
  ];
  const rt = createFakeRuntime({ script: (i) => scripted[i] ?? { kind: 'text', text: 'not json', latencyMs: 2, usage: null } });
  const { value } = await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 0);
  const dir = path.join(env.root, 'eval/results/dev');
  const file = path.join(dir, fs.readdirSync(dir).find((f) => !f.endsWith('.grades.jsonl')) as string);
  const { records } = readResultsFile(file);
  const [timeout, remote, nonText, fault] = records;
  assert.deepEqual(timeout?.outcome, { kind: 'timeout' });
  assert.deepEqual(timeout?.late, { kind: 'late', text: '{"option":"late"}', latency_ms: 12_000 });
  assert.deepEqual(remote?.outcome, { kind: 'error', code: 'remote_error', detail: 'HTTP 500', remote: true });
  assert.equal(nonText?.outcome.kind, 'error');
  assert.equal(fault?.outcome.kind, 'engine_fault');
  assert.equal(fault?.latency_ms, null);
  // Graded through Sim_Wasm: timeout, error and non-text are Illegal; the engine fault has no grade line.
  const grades = readGradesFile(gradesPathFor(file)).grades;
  assert.equal(grades.length, 73);
  const g = (card: string, perm: string) => grades.find((x) => x.card_id === card && x.permutation === perm);
  for (const r of [timeout, remote, nonText]) {
    const line = g(r!.card_id, r!.permutation);
    assert.deepEqual((line?.verdict as { kind: string }).kind, 'illegal');
    assert.equal((line?.grade as { illegal: boolean }).illegal, true);
  }
  assert.ok(g(timeout!.card_id, timeout!.permutation)?.late_grade !== null);
  assert.equal(g(fault!.card_id, fault!.permutation), undefined);
});

test('a load failure writes a failure record, not_run (load_failed) and a ledger abort', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
  const failing = createFakeRuntime({ loadError: new RuntimeLoadError('model_load_failed', 'weights missing') });
  const { value } = await capture(() => lockedRun(env.deps(failing), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 1);
  assert.equal(failing.calls.length, 0);
  const entry = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!;
  assert.equal(entry.abort_reason, 'model_load_failed');
  const f = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
  assert.equal(f[0]?.kind, 'model_load_failed');
  const { records } = readResultsFile(path.join(env.root, 'eval/results/locked', `${entry.entry_id}.jsonl`));
  assert.equal(records.length, 74);
  assert.ok(records.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'load_failed'));
});

test('the Fresh_Profile hook runs before the ledger entry; a failure uses up no once-only slot', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
  const calls = rt.calls.length;
  const freshProfile = async () => ({ ok: false as const, failure: { kind: 'model_load_failed', reason: 'quota' } });
  const { value } = await capture(() => lockedRun(env.deps(rt, { freshProfile }), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 1);
  assert.equal(rt.calls.length, calls);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')));
  assert.equal(readFailures(path.join(env.root, 'eval/results/failures.jsonl'))[0]?.reason, 'quota');
  // The same slot is still free.
  assert.equal((await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
});

test('the Results header is written after load, so it records the placement known only after load; the ledger start still comes first', async () => {
  const placement = { method: 'onnxruntime_node_placements', cpu_nodes: [{ op_type: 'Shape', count: 3 }] };
  const wrap = (base: ReturnType<typeof createFakeRuntime>, seen: { ledger: boolean; results: boolean }[], env: ReturnType<typeof makeEnv>): RuntimeFactory => async (ctx) => {
    const h = await base.factory(ctx);
    let loaded = false;
    return {
      ...h,
      get placement() {
        return loaded ? placement : null;
      },
      load: async (o) => {
        const dir = path.join(env.root, 'eval/results', ctx.kind);
        seen.push({ ledger: fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')), results: fs.existsSync(dir) && fs.readdirSync(dir).length > 0 });
        await h.load(o);
        loaded = true;
      },
    };
  };
  const env = makeEnv(cardSet);
  const seen: { ledger: boolean; results: boolean }[] = [];
  const base = createFakeRuntime();
  const deps = env.deps(base, { createRuntime: wrap(base, seen, env) });
  assert.equal((await capture(() => devRun(deps, { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
  assert.equal((await capture(() => lockedRun(deps, { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
  assert.deepEqual(seen, [
    { ledger: false, results: false }, // dev: nothing written before load
    { ledger: true, results: false }, // locked: ledger `start` is on disk, the Results file is not yet
  ]);
  for (const sub of ['dev', 'locked']) {
    const dir = path.join(env.root, 'eval/results', sub);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.jsonl') && !f.endsWith('.grades.jsonl')) as string;
    assert.deepEqual(readResultsFile(path.join(dir, file)).header.placement, placement);
  }
});

// ------------------------------------------------------------ Workers AI gate and budget

function phaseState(approved: boolean): PhaseState {
  const approvals: Approval[] = [
    { id: 'p2', kind: 'phase2', branch: 'B', task_subset: 'DS', model: WORKERS_COMBO.model_id, approved_on: '2026-11-07', note: 't' },
    { id: 'dev1', kind: 'dev', combination: WORKERS_COMBO.id, task_subset: 'DS', max_requests: 1000, phase2: 'p2', approved_on: '2026-11-07', note: 't' },
    { id: 'lock1', kind: 'locked', combination: WORKERS_COMBO.id, task_subset: 'DS', max_requests: 1000, phase2: 'p2', approved_on: '2026-11-07', note: 't' },
  ];
  return {
    combinations: [WORKERS_COMBO],
    entries: [],
    failures: [],
    exclusions: [],
    smoke: [{ schema: 'llm-probe-smoke-v1', combination: WORKERS_COMBO.id, shape_check: 'ok', declared_shape: 'chat' }],
    approvals: approved ? { approved: true, approvals } : { approved: false, reason: 'approvals.json has uncommitted changes' },
    passes: new Map(),
    overLimit: new Set(),
  };
}

test('Workers AI without approval: Dev_Run records not_run (not_approved), Locked_Run writes nothing; nothing is sent', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const deps = env.deps(rt, { phaseState: async () => phaseState(false) });
  const dev = await capture(() => devRun(deps, { combo: WORKERS_COMBO.id, task: 'D' }));
  assert.equal(dev.value, 1);
  assert.match(dev.err, /approvals\.json has uncommitted changes/);
  const dir = path.join(env.root, 'eval/results/dev');
  const file = path.join(dir, fs.readdirSync(dir).find((f) => !f.endsWith('.grades.jsonl')) as string);
  const { records } = readResultsFile(file);
  assert.equal(records.length, 74);
  assert.ok(records.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'not_approved'));
  const locked = await capture(() => lockedRun(deps, { combo: WORKERS_COMBO.id, task: 'D', approval: 'lock1' }));
  assert.equal(locked.value, 1);
  assert.equal(rt.calls.length, 0);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')));
});

test('Workers AI with a matching approval runs; a budget refusal records not_run (budget) and stops', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const deps = env.deps(rt, { phaseState: async () => phaseState(true) });
  // The day's request counter is already at the daily cap.
  fs.mkdirSync(path.join(env.root, 'eval/results/budget'), { recursive: true });
  fs.writeFileSync(path.join(env.root, 'eval/results/budget/workers-ai.json'), JSON.stringify({ schema: 'llm-probe-budget-v1', days: { '2026-11-07': { requests: 600, smoke: 0, neurons: 0 } } }) + '\n');
  const wrongApproval = await capture(() => devRun(deps, { combo: WORKERS_COMBO.id, task: 'DS', approval: 'nope' }));
  assert.equal(wrongApproval.value, 1);
  assert.match(wrongApproval.err, /approval nope does not match/);
  const { value } = await capture(() => devRun(deps, { combo: WORKERS_COMBO.id, task: 'DS', approval: 'dev1' }));
  assert.equal(value, 1);
  assert.equal(rt.calls.length, 0);
  const dir = path.join(env.root, 'eval/results/dev');
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.grades.jsonl')).sort();
  const { records } = readResultsFile(path.join(dir, files[files.length - 1] as string));
  assert.equal(records.length, 104);
  assert.ok(records.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'budget'));
});

test('Workers AI: requests are reserved in the budget counter and settled by usage', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const deps = env.deps(rt, { phaseState: async () => phaseState(true) });
  const { value } = await capture(() => devRun(deps, { combo: WORKERS_COMBO.id, task: 'DS', approval: 'dev1' }));
  assert.equal(value, 0);
  assert.equal(rt.calls.length, 104);
  const counter = JSON.parse(fs.readFileSync(path.join(env.root, 'eval/results/budget/workers-ai.json'), 'utf8')) as { days: Record<string, { requests: number; neurons: number }> };
  const day = Object.values(counter.days)[0]!;
  assert.equal(day.requests, 104);
  assert.ok(day.neurons > 0);
});

test('REVISION constant is a 40-hex pin used by the fake Combination', () => {
  assert.match(REVISION, /^[0-9a-f]{40}$/);
});
