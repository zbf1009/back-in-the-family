// llm-probe task 29 (run-flow part): a Dev_Run and a Locked_Run of a Decision_Model through the System_One_Mapping.
// Fake fetch only: no network, no `env` read, no Cloudflare request. The card set is the synthetic one of run.helpers.ts.
// **Validates: Requirements 19.6, 19.7, 19.10, 19.11, 19.12, 3.12, 3.15, 19.1**
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createSystemOneRuntime } from '../../src/adapters/system-one.ts';
import { systemOneUsageNeurons } from '../../src/budget.ts';
import { type Combination, type DevRunInfo, type PhaseState, type SystemOneCombination } from '../../src/phase.ts';
import { readGradesFile, readResultsFile, gradesPathFor } from '../../src/results.ts';
import { devRun, lockedRun, type RunDeps } from '../../src/run.ts';
import { Secret } from '../../src/redact.ts';
import { loadSystemOneMapping } from '../../src/templates.ts';
import { baseState, BROWSER, devRunInfo, dm, smokeRec } from './decision-gate.helpers.ts';
import { capture, createFakeRuntime, makeCardSet, makeEnv, sha256, type TestEnv } from './run.helpers.ts';
import { answerBody, comboWith, fakeFetch, type Call } from './system-one.helpers.ts';

const MAPPING_REL = 'eval/probe/templates/decision.system_one.v1.txt';
const REPO = new URL('../../../../', import.meta.url).pathname;
const cardSet = makeCardSet();
const D_CARDS = fs
  .readFileSync(path.join(cardSet.dir, 'cards', 'dev.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l !== '' && (JSON.parse(l) as { task: string }).task === 'decision').length;

const REAL_MAPPING = loadSystemOneMapping(REPO, MAPPING_REL);

/** The Decision_Model Combination under test; `window` shrinks the verified context window for over_context cases. */
const comboFor = (window?: number): SystemOneCombination => comboWith(window === undefined ? {} : { window });

/** A temp repo whose mapping file is a copy of the committed v1 file (or `mapping` when given). */
function repoWithMapping(env: TestEnv, mapping: string = REAL_MAPPING.text): void {
  const file = path.join(env.root, MAPPING_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, mapping);
}

/** Answers with the first option of `criteria`, reporting usage that passes the post-check. */
const answerFirst = (_n: number, call: Call): { status: number; body: string } => {
  const sent = JSON.parse(call.init.body) as { questions: { decision: { criteria: Record<string, string> } } };
  const choice = Object.keys(sent.questions.decision.criteria)[0] as string;
  return { status: 200, body: answerBody({ choice, inputTokens: Math.ceil(Buffer.byteLength(call.init.body, 'utf8') / 4), outputTokens: 1 }) };
};

function devRunsOnDisk(env: TestEnv): DevRunInfo[] {
  const dir = path.join(env.root, 'eval/results/dev');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl') && !n.endsWith('.grades.jsonl'))
    .sort()
    .map((n) => {
      const h = readResultsFile(path.join(dir, n)).header;
      return { run_id: h.run_id, combination: h.combination, task_subset: h.task_subset, template_hashes: h.template_hashes };
    });
}

/** Phase_1 ended, a smoke `ok`, both approvals and the Dev_Runs found on disk, like the real `readPhaseState`. */
const stateFor =
  (env: TestEnv, combo: SystemOneCombination): (() => Promise<PhaseState>) =>
  () =>
    Promise.resolve(
      baseState({
        combinations: [BROWSER, combo as Combination],
        approvals: { approved: true, approvals: [dm('DM-D', combo, 'dev', 1000), dm('DM-L', combo, 'locked', 1000)] },
        smoke: [smokeRec(combo as Combination, 'ok')],
        devRuns: devRunsOnDisk(env),
      }),
    );

function depsFor(env: TestEnv, combo: SystemOneCombination, fetch: ReturnType<typeof fakeFetch>['fetch']): RunDeps {
  const unused = createFakeRuntime();
  return env.deps(unused, {
    combinations: [combo as Combination],
    createRuntime: createSystemOneRuntime({ loadEnv: () => ({ token: new Secret('t-token-0123456789'), accountId: new Secret('a-account-0123456789') }), fetch }),
    phaseState: stateFor(env, combo),
  });
}

const readOnly = (env: TestEnv, sub: 'dev' | 'locked') => {
  const dir = path.join(env.root, 'eval/results', sub);
  const file = path.join(dir, fs.readdirSync(dir).find((n) => n.endsWith('.jsonl') && !n.endsWith('.grades.jsonl')) as string);
  return { file, ...readResultsFile(file) };
};

test('an end-to-end fake Dev_Run renders every D request from the mapping, sends System One bodies and grades Raw_Choices', async () => {
  const env = makeEnv(cardSet);
  repoWithMapping(env);
  const combo = comboFor();
  const net = fakeFetch(answerFirst);
  const { value } = await capture(() => devRun(depsFor(env, combo, net.fetch), { combo: combo.id, task: 'D', approval: 'DM-D' }));
  assert.equal(value, 0);

  const { file, header, records } = readOnly(env, 'dev');
  assert.ok(records.length >= D_CARDS);
  assert.equal(net.calls.length, records.length);
  assert.ok(records.every((r) => r.outcome.kind === 'text'));
  // Header: the shape, the mode and the mapping hash as the D Template_Hash (R19.10).
  assert.equal(header.response_shape, 'system_one');
  assert.equal(header.validator_mode, 'raw_choice');
  assert.deepEqual(header.template_hashes, { decision: sha256(fs.readFileSync(path.join(REPO, MAPPING_REL))) });
  assert.equal(header.template_hashes['decision'], REAL_MAPPING.sha256);
  assert.ok(records.every((r) => r.template_hash === REAL_MAPPING.sha256));
  // Request bodies: one `decision` choice question, no sampling member, instructions from the mapping.
  const first = JSON.parse((net.calls[0] as Call).init.body) as { model: string; state: string; questions: { decision: { type: string; instructions: string; criteria: object } } } & Record<string, unknown>;
  assert.deepEqual(Object.keys(first).sort(), ['model', 'questions', 'state']);
  assert.equal(first.model, 'clef-flash');
  assert.match(first.state, /^Today is day \d+\./);
  assert.equal(first.questions.decision.type, 'choice');
  assert.match(first.questions.decision.instructions, /^How to read the facts:/);
  // Grades: the first listed option is an option ID, so the Raw_Choice validated (mode raw_choice, never `json`).
  const grades = readGradesFile(gradesPathFor(file)).grades;
  assert.equal(grades.length, records.length);
  assert.ok(grades.every((g) => (g.verdict as { kind: string }).kind === 'decision'));
  // Budget: every counted cost is ceil(input_tokens × price / 1e6) (R19.12).
  const budget = JSON.parse(fs.readFileSync(path.join(env.root, 'eval/results/budget/workers-ai.json'), 'utf8')) as { days: Record<string, { neurons: number; requests: number }> };
  const day = Object.values(budget.days)[0] as { neurons: number; requests: number };
  const expected = net.calls.reduce((sum, c) => sum + systemOneUsageNeurons(Math.ceil(Buffer.byteLength(c.init.body, 'utf8') / 4), combo.prices.input), 0);
  assert.equal(day.requests, records.length);
  assert.equal(day.neurons, expected);
});

test('a Dev_Run records over-window requests as not_run over_context, sends the others, and accepts a body of exactly the window', async () => {
  const env = makeEnv(cardSet);
  repoWithMapping(env);
  // First learn the body sizes with the real window.
  const probe = fakeFetch(answerFirst);
  await capture(() => devRun(depsFor(env, comboFor(), probe.fetch), { combo: comboFor().id, task: 'D', approval: 'DM-D' }));
  const sizes = probe.calls.map((c) => Buffer.byteLength(c.init.body, 'utf8'));
  const window = Math.min(...sizes);
  const over = sizes.filter((n) => n > window).length;
  assert.ok(over > 0 && over < sizes.length, 'the cards must differ in size for this test');

  const env2 = makeEnv(cardSet);
  repoWithMapping(env2);
  const net = fakeFetch((_n, call) => ({ status: 200, body: answerBody({ choice: Object.keys((JSON.parse(call.init.body) as { questions: { decision: { criteria: object } } }).questions.decision.criteria)[0] as string, inputTokens: window }) }));
  const { value } = await capture(() => devRun(depsFor(env2, comboFor(window), net.fetch), { combo: comboFor().id, task: 'D', approval: 'DM-D' }));
  assert.equal(value, 0);
  const { records } = readOnly(env2, 'dev');
  const notRun = records.filter((r) => r.outcome.kind === 'not_run');
  assert.equal(notRun.length, over);
  assert.ok(notRun.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'over_context'));
  assert.ok(records.filter((r) => r.outcome.kind !== 'not_run').every((r) => r.outcome.kind === 'text'));
  assert.equal(net.calls.length, sizes.length - over, 'a body of exactly the window is sent; nothing longer is');
  assert.ok(net.calls.every((c) => Buffer.byteLength(c.init.body, 'utf8') <= window));
});

test('a Locked_Run with an over-window request refuses before the ledger start, lists every Card ID, sends nothing and writes no Results', async () => {
  const env = makeEnv(cardSet);
  repoWithMapping(env);
  const net = fakeFetch(answerFirst);
  assert.equal((await capture(() => devRun(depsFor(env, comboFor(), net.fetch), { combo: comboFor().id, task: 'D', approval: 'DM-D' }))).value, 0);
  const sentBefore = net.calls.length;

  const tiny = comboFor(100);
  const locked = await capture(() => lockedRun(depsFor(env, tiny, net.fetch), { combo: tiny.id, task: 'D', approval: 'DM-L' }));
  assert.notEqual(locked.value, 0);
  const listed = locked.err.match(/over_context: Card ID \S+/g) ?? [];
  assert.equal(listed.length, D_CARDS, 'every over-window Card ID is listed once');
  assert.match(locked.err, /probe: over_context: /);
  assert.equal(net.calls.length, sentBefore, 'nothing is sent');
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')), 'no ledger start entry');
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/locked')), 'no Results file');
});

test('a Locked_Run is refused when the newest Dev_Run used another mapping hash (R3.12), and an S subset writes nothing at all (R19.1)', async () => {
  const env = makeEnv(cardSet);
  repoWithMapping(env);
  const net = fakeFetch(answerFirst);
  const combo = comboFor();
  assert.equal((await capture(() => devRun(depsFor(env, combo, net.fetch), { combo: combo.id, task: 'D', approval: 'DM-D' }))).value, 0);
  const calls = net.calls.length;

  repoWithMapping(env, `${REAL_MAPPING.text}`.replace('How to choose:', 'How to choose, carefully:'));
  const changed = await capture(() => lockedRun(depsFor(env, combo, net.fetch), { combo: combo.id, task: 'D', approval: 'DM-L' }));
  assert.notEqual(changed.value, 0);
  assert.match(changed.err, /mapping Template_Hash differs from the newest Dev_Run/);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')));

  const fresh = makeEnv(cardSet);
  repoWithMapping(fresh);
  for (const task of ['S', 'DS'] as const) {
    const refused = await capture(() => devRun(depsFor(fresh, combo, net.fetch), { combo: combo.id, task, approval: 'DM-D' }));
    assert.equal(refused.value, 1);
    assert.match(refused.err, /accepts Task_Type D only/);
    assert.ok(!fs.existsSync(path.join(fresh.root, 'eval/results/dev')), 'no Results at all');
  }
  assert.equal(net.calls.length, calls, 'nothing was sent');
});

// ---------------------------------------------------------------- variant registry (R20.1, DA-27, task 40)

const RULE_REL = 'eval/probe/templates/aggregation.perm_avg.v1.txt';

/** The two records of one model: the `single` record under test and the committed-shape `perm_avg` record derived from it. */
function recordsWithVariant(): { single: SystemOneCombination; permAvg: Combination } {
  const single = comboFor();
  const rule = fs.readFileSync(path.join(REPO, RULE_REL));
  const permAvg = {
    id: `${single.id}/perm_avg`, variant: 'perm_avg', derives_from: single.id, sends_requests: false,
    runtime: single.runtime, model_id: single.model_id, model_selector: single.model_selector, quantization: single.quantization, revision: single.revision,
    phase1_locked: false, task_subset_allowed: 'D', response_shape: 'system_one', validator_mode: 'raw_choice', question_id: 'decision', mapping: single['mapping'],
    aggregation: { file: RULE_REL, rule_version: 1, sha256: sha256(rule) },
  } as unknown as Combination;
  return { single, permAvg };
}

test('every Decision_Model Dev_Run header records the frozen variant registry; the Locked_Run header too', async () => {
  const env = makeEnv(cardSet);
  repoWithMapping(env);
  const rulePath = path.join(env.root, RULE_REL);
  fs.mkdirSync(path.dirname(rulePath), { recursive: true });
  fs.copyFileSync(path.join(REPO, RULE_REL), rulePath);
  const { single, permAvg } = recordsWithVariant();
  const net = fakeFetch(answerFirst);
  const deps: RunDeps = { ...depsFor(env, single, net.fetch), combinations: [single as Combination, permAvg] };
  const dev = await capture(() => devRun(deps, { combo: single.id, task: 'D', approval: 'DM-D' }));
  assert.equal(dev.value, 0);
  const expected = [
    { id: single.id, variant: 'single', aggregation_hash: null },
    { id: permAvg.id, variant: 'perm_avg', aggregation_hash: sha256(fs.readFileSync(rulePath)) },
  ];
  assert.deepEqual(readOnly(env, 'dev').header.variants, expected);

  const locked = await capture(() => lockedRun(deps, { combo: single.id, task: 'D', approval: 'DM-L' }));
  assert.equal(locked.value, 0);
  assert.deepEqual(readOnly(env, 'locked').header.variants, expected);
});

test('dev-run and locked-run refuse a perm_avg Combination before anything is read, sent or written', async () => {
  const env = makeEnv(cardSet);
  repoWithMapping(env);
  const { single, permAvg } = recordsWithVariant();
  const net = fakeFetch(answerFirst);
  const deps: RunDeps = { ...depsFor(env, single, net.fetch), combinations: [single as Combination, permAvg] };
  const dev = await capture(() => devRun(deps, { combo: permAvg.id, task: 'D', approval: 'DM-D' }));
  assert.notEqual(dev.value, 0);
  assert.match(dev.err, /variant: perm_avg is derived/);
  const locked = await capture(() => lockedRun(deps, { combo: permAvg.id, task: 'D', approval: 'DM-L' }));
  assert.notEqual(locked.value, 0);
  assert.equal(net.calls.length, 0);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/dev')) && !fs.existsSync(path.join(env.root, 'eval/results/locked')));
});
