import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { APPROVALS_PATH, APPROVALS_SCHEMA, loadApprovals, type Approval, type ApprovalsResult } from '../../src/approvals.ts';
import { deriveEntries, LEDGER_SCHEMA, type LedgerEvent } from '../../src/ledger.ts';
import { allowWorkersAi, browserPass, phaseStatus, type Combination, type EntryPasses, type PhaseState } from '../../src/phase.ts';
import { readResultsFile, SCHEMA, type SmokeRecord, type TaskSubset } from '../../src/results.ts';
import { devRun, lockedRun } from '../../src/run.ts';
import { capture, createFakeRuntime, FAKE_COMBO, makeCardSet, makeEnv, WORKERS_COMBO } from './run.helpers.ts';

// Feature: llm-probe, Property 38: The phase gate and the Task_Type_Subset bound every request
// **Validates: Requirements 3.14, 11.19, 18.1, 18.2, 18.3, 18.4**

const REV = 'a'.repeat(40);
const TASKS = ['decision', 'synthesis'] as const;
type Task = (typeof TASKS)[number];

const browser = (n: number): Combination => ({ id: `webllm/m${n}`, runtime: 'webllm', model_id: `Model-${n}`, quantization: 'q4', revision: REV, phase1_locked: true });
const WAI: Combination = { id: 'workers-ai/a', runtime: 'workers-ai', model_id: '@cf/a', quantization: '', revision: 'server-side, not pinnable', phase1_locked: false, response_shape: 'chat' };
const WAI2: Combination = { ...WAI, id: 'workers-ai/b', model_id: '@cf/b' };

function entryEvents(c: Combination, id: string, subset: TaskSubset, at: string): LedgerEvent[] {
  return [
    {
      schema: LEDGER_SCHEMA,
      event: 'start',
      entry_id: id,
      model_key: { runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision },
      combination: c.id,
      task_subset: subset,
      fingerprint: {},
      template_hashes: {},
      started_at: at,
      rerun_of: null,
      rerun_reason: null,
      overlaps: [],
      approval: null,
      planned: subset === 'DS' ? { decision: 1, synthesis: 1 } : subset === 'D' ? { decision: 1 } : { synthesis: 1 },
    },
    { schema: LEDGER_SCHEMA, event: 'complete', entry_id: id, ended_at: at, results: 'x', requests_sent: 2 },
  ];
}

const subsetTasks = (s: TaskSubset): Task[] => (s === 'DS' ? ['decision', 'synthesis'] : s === 'D' ? ['decision'] : ['synthesis']);
const subsetOf = (t: readonly Task[]): TaskSubset | null => (t.length === 2 ? 'DS' : t[0] === 'decision' ? 'D' : t[0] === 'synthesis' ? 'S' : null);
const textOf = (branch: string | null, subset: string | null): string => (branch === 'A' ? 'A (no subset)' : `B (subset ${subset ?? 'none'})`);

// ---------------------------------------------------------------- (a) the pure gate

const mostly = <T>(good: T, ...rest: T[]): fc.Arbitrary<T> => fc.constantFrom<T>(...Array<T>(8).fill(good), ...rest);

type Cover = 'none' | 'DS' | 'D' | 'S' | 'D+S' | 'incomplete';
interface BrowserPlan {
  cover: Cover;
  failure: boolean;
  exclusion: boolean;
  overLimit: boolean;
  passD: boolean;
  passS: boolean;
}
const plan: fc.Arbitrary<BrowserPlan> = fc.record({
  cover: fc.constantFrom<Cover>('none', 'DS', 'DS', 'DS', 'D', 'S', 'D+S', 'incomplete'),
  failure: fc.constantFrom(false, false, false, true),
  exclusion: fc.constantFrom(false, false, false, true),
  overLimit: fc.constantFrom(false, false, false, true),
  passD: fc.boolean(),
  passS: fc.boolean(),
});

interface Scenario {
  plans: BrowserPlan[];
  smoke: { combo: 0 | 1; check: 'ok' | 'mismatch'; shape: 'chat' | 'text' }[];
  approvalsOk: boolean;
  p2: { branch: 'right' | 'A' | 'B'; subset: 'right' | TaskSubset | null; model: 'right' | 'other' | 'none' }[];
  grants: { kind: 'dev' | 'locked'; combo: 0 | 1; subset: 'failing' | TaskSubset; phase2: 'last' | 'first' | 'bogus' }[];
  kind: 'smoke' | 'dev' | 'locked';
  reqCombo: 0 | 1;
  reqSubset: 'failing' | TaskSubset;
}

const scenario: fc.Arbitrary<Scenario> = fc.record({
  plans: fc.array(plan, { minLength: 2, maxLength: 4 }),
  smoke: fc.array(fc.record({ combo: mostly<0 | 1>(0, 1), check: mostly<'ok' | 'mismatch'>('ok', 'mismatch'), shape: mostly<'chat' | 'text'>('chat', 'text') }), { minLength: 1, maxLength: 3 }),
  approvalsOk: mostly(true, false),
  p2: fc.array(
    fc.record({
      branch: mostly<'right' | 'A' | 'B'>('right', 'A', 'B'),
      subset: mostly<'right' | TaskSubset | null>('right', 'D', 'S', 'DS', null),
      model: mostly<'right' | 'other' | 'none'>('right', 'other', 'none'),
    }),
    { minLength: 1, maxLength: 2 },
  ),
  grants: fc.array(
    fc.record({
      kind: fc.constantFrom<'dev' | 'locked'>('dev', 'locked'),
      combo: mostly<0 | 1>(0, 1),
      subset: mostly<'failing' | TaskSubset>('failing', 'D', 'S', 'DS'),
      phase2: mostly<'last' | 'first' | 'bogus'>('last', 'first', 'bogus'),
    }),
    { minLength: 2, maxLength: 4 },
  ),
  kind: fc.constantFrom<'smoke' | 'dev' | 'locked'>('smoke', 'dev', 'dev', 'locked', 'locked'),
  reqCombo: mostly<0 | 1>(0, 1),
  reqSubset: mostly<'failing' | TaskSubset>('failing', 'D', 'S', 'DS'),
});

interface Built {
  state: PhaseState;
  combos: Combination[];
  ended: boolean;
  /** Oracle (independent of phase.ts). */
  pass: Record<Task, string[]>;
  branch: 'A' | 'B' | null;
  failingSubset: TaskSubset | null;
  p2: Approval | null;
}

function build(s: Scenario): Built {
  const combos = s.plans.map((_, i) => browser(i + 1));
  const events: LedgerEvent[] = [];
  const passes = new Map<string, EntryPasses>();
  const exclusions: PhaseState['exclusions'][number][] = [];
  const failures: PhaseState['failures'][number][] = [];
  const overLimit = new Set<string>();
  const pass: Record<Task, string[]> = { decision: [], synthesis: [] };
  let ended = true;
  s.plans.forEach((p, i) => {
    const c = combos[i] as Combination;
    const at = `2026-11-0${i + 1}T09:00:00Z`;
    const result: EntryPasses = { decision: p.passD, synthesis: p.passS };
    const covers: Task[] = [];
    const add = (id: string, sub: TaskSubset): void => {
      events.push(...entryEvents(c, id, sub, at));
      passes.set(id, result);
    };
    if (p.cover === 'DS') (add(`L-${i}`, 'DS'), covers.push('decision', 'synthesis'));
    else if (p.cover === 'D') (add(`L-${i}`, 'D'), covers.push('decision'));
    else if (p.cover === 'S') (add(`L-${i}`, 'S'), covers.push('synthesis'));
    else if (p.cover === 'D+S') (add(`L-${i}d`, 'D'), add(`L-${i}s`, 'S'), covers.push('decision', 'synthesis'));
    else if (p.cover === 'incomplete') events.push(entryEvents(c, `L-${i}`, 'DS', at)[0] as LedgerEvent);
    if (p.failure) failures.push({ schema: SCHEMA.failure, combination: c.id, kind: 'model_load_failed' } as PhaseState['failures'][number]);
    if (p.exclusion) exclusions.push({ schema: SCHEMA.exclusion, combination: c.id, model: c.model_id, check: 'vram', value: 1, limit: 0, at } as PhaseState['exclusions'][number]);
    if (p.overLimit) overLimit.add(c.id);
    if (!(p.exclusion || p.failure || (covers.includes('decision') && covers.includes('synthesis')))) ended = false;
    if (!p.exclusion && !p.overLimit) {
      if (covers.includes('decision') && p.passD) pass.decision.push(p.cover === 'D+S' ? `L-${i}d` : `L-${i}`);
      if (covers.includes('synthesis') && p.passS) pass.synthesis.push(p.cover === 'D+S' ? `L-${i}s` : `L-${i}`);
    }
  });
  const failing = TASKS.filter((t) => pass[t].length === 0);
  const branch = !ended ? null : failing.length === 0 ? 'A' : 'B';
  const failingSubset = branch === 'B' ? subsetOf(failing) : null;

  const list: Approval[] = [];
  s.p2.forEach((e, i) => {
    const rb = e.branch === 'right' ? (branch ?? 'B') : e.branch;
    const rs = e.subset === 'right' ? (rb === 'B' ? (failingSubset ?? 'DS') : null) : e.subset;
    const model = e.model === 'right' ? WAI.model_id : e.model === 'other' ? '@cf/other' : undefined;
    list.push({ id: `P2-${i + 1}`, kind: 'phase2', branch: rb, task_subset: rs, ...(model === undefined ? {} : { model }), approved_on: '2026-11-08', note: '' });
  });
  const p2 = list.length === 0 ? null : (list[list.length - 1] as Approval);
  s.grants.forEach((g, i) => {
    const ref = g.phase2 === 'last' ? p2?.id : g.phase2 === 'first' ? list[0]?.id : 'P2-bogus';
    const sub = g.subset === 'failing' ? (failingSubset ?? 'DS') : g.subset;
    list.push({ id: `G-${i + 1}`, kind: g.kind, combination: (g.combo === 0 ? WAI : WAI2).id, task_subset: sub, max_requests: 50, ...(ref === undefined ? {} : { phase2: ref }), approved_on: '2026-11-08', note: '' });
  });
  const approvals: ApprovalsResult = s.approvalsOk ? { approved: true, approvals: list } : { approved: false, reason: 'approvals.json has uncommitted changes' };
  const smoke = s.smoke.map((m) => ({ schema: SCHEMA.smoke, combination: (m.combo === 0 ? WAI : WAI2).id, shape_check: m.check, declared_shape: m.shape, http_status: 200 }) as SmokeRecord);
  const state: PhaseState = { combinations: [...combos, WAI, WAI2], entries: deriveEntries(events), failures, exclusions, smoke, approvals, passes, overLimit };
  return { state, combos, ended, pass, branch, failingSubset, p2 };
}

let pureFull = 0;

test('Property 38 (pure): allowWorkersAi is exactly the conjunction of R18/R11.19 conditions', () => {
  fc.assert(
    fc.property(scenario, (s) => {
      const b = build(s);
      const combo = s.reqCombo === 0 ? WAI : WAI2;
      const subset: TaskSubset = s.reqSubset === 'failing' ? (b.failingSubset ?? 'DS') : s.reqSubset;
      const d = allowWorkersAi(s.kind, combo, subset, b.state);

      // The independent oracle.
      const list = b.state.approvals.approved ? b.state.approvals.approvals : [];
      const p2 = list.filter((a) => a.kind === 'phase2').at(-1) ?? null;
      const recomputedMatches = p2 !== null && b.branch !== null && p2.branch === b.branch && (b.branch === 'A' || (p2.task_subset ?? null) === b.failingSubset);
      const smokeNow = b.state.smoke.filter((m) => m['combination'] === combo.id).at(-1);
      const shapeOk = smokeNow !== undefined && smokeNow['shape_check'] === 'ok' && smokeNow['declared_shape'] === combo.response_shape;
      const granted = p2 !== null && list.some((a) => a.kind === s.kind && a.combination === combo.id && (a.task_subset ?? null) === subset && a.phase2 === p2.id);
      const expectFull =
        s.kind !== 'smoke' &&
        b.state.approvals.approved &&
        b.ended &&
        b.branch === 'B' &&
        recomputedMatches &&
        p2?.model === combo.model_id &&
        subset === b.failingSubset &&
        granted &&
        shapeOk;
      assert.equal(d.allowed, expectFull ? 'full' : 'smoke_only', d.reason);
      if (expectFull) pureFull += 1;

      // Phase_1 and branch A allow Smoke_Calls only.
      if (!b.ended || b.branch === 'A' || s.kind === 'smoke') assert.equal(d.allowed, 'smoke_only');
      // A recomputed-branch mismatch refuses naming both values.
      if (s.kind !== 'smoke' && b.state.approvals.approved && b.ended && p2 !== null && !recomputedMatches) {
        assert.match(d.reason, /^branch mismatch/);
        assert.ok(d.reason.includes(`records branch ${textOf(p2.branch ?? null, p2.task_subset ?? null)}`), d.reason);
        assert.ok(d.reason.includes(`recomputes branch ${textOf(b.branch, b.failingSubset)}`), d.reason);
      }
      // phase-status agrees with the oracle per Task_Type, citing the same entry IDs.
      const st = phaseStatus(b.state);
      assert.equal(st.ended, b.ended);
      assert.equal(st.branch, b.branch);
      for (const t of st.tasks) {
        assert.deepEqual(t.passingEntries.map((e) => e.entry_id).sort(), [...b.pass[t.task]].sort());
        assert.equal(t.pass, b.pass[t.task].length > 0);
      }
      // An Exclusion_Record, an over-limit Combination or a Workers AI Combination is never a browser pass.
      for (const c of [...b.combos, WAI]) {
        for (const t of TASKS) {
          if (!browserPass(c, t, b.state)) continue;
          assert.ok(c.runtime !== 'workers-ai' && !b.state.exclusions.some((x) => x.combination === c.id) && !b.state.overLimit.has(c.id));
        }
      }
    }),
    { numRuns: 1500 },
  );
  assert.ok(pureFull >= 1, 'the generator never produced an allowed run');
});

// ---------------------------------------------------------------- (b) the run flow

const cardSet = makeCardSet();
const taskOfCard = new Map<string, Task>();
for (const f of ['dev.jsonl', 'locked.jsonl']) {
  for (const l of fs.readFileSync(path.join(cardSet.dir, 'cards', f), 'utf8').split('\n').filter((x) => x.trim() !== '')) {
    const c = JSON.parse(l) as { id: string; task: Task };
    taskOfCard.set(c.id, c.task);
  }
}

interface RunScenario {
  kind: 'dev' | 'locked';
  failing: TaskSubset;
  req: TaskSubset;
  p2: 'right' | 'branchA' | 'wrongSubset' | 'wrongModel' | 'none';
  grantSubset: 'req' | TaskSubset;
  maxRequests: 10 | 74 | 104 | 200;
  rightId: boolean;
  dirty: boolean;
  smokeOk: boolean;
}

const runScenario: fc.Arbitrary<RunScenario> = fc
  .record({
    kind: fc.constantFrom<'dev' | 'locked'>('dev', 'locked'),
    failing: fc.constantFrom<TaskSubset>('D', 'S', 'DS'),
    reqIsFailing: mostly(true, false),
    anyReq: fc.constantFrom<TaskSubset>('D', 'S', 'DS'),
    p2: mostly<RunScenario['p2']>('right', 'branchA', 'wrongSubset', 'wrongModel', 'none'),
    grantSubset: mostly<RunScenario['grantSubset']>('req', 'D', 'S', 'DS'),
    maxRequests: mostly<RunScenario['maxRequests']>(200, 10, 74, 104),
    rightId: mostly(true, false),
    dirty: mostly(false, true),
    smokeOk: mostly(true, false),
  })
  .map(({ reqIsFailing, anyReq, ...r }) => ({ ...r, req: reqIsFailing ? r.failing : anyReq }));

let fullRuns = 0;

function runState(s: { failing: TaskSubset; p2: RunScenario['p2']; grant: TaskSubset; max: number; dirty: boolean; smokeOk: boolean }): PhaseState {
  const b0 = browser(1);
  const b1 = browser(2);
  const failTasks = subsetTasks(s.failing);
  const events = [...entryEvents(b0, 'L-1', 'DS', '2026-11-01T09:00:00Z'), ...entryEvents(b1, 'L-2', 'DS', '2026-11-02T09:00:00Z')];
  const passes = new Map<string, EntryPasses>([
    ['L-1', { decision: !failTasks.includes('decision'), synthesis: !failTasks.includes('synthesis') }],
    ['L-2', { decision: false, synthesis: false }],
  ]);
  const other: TaskSubset = s.failing === 'D' ? 'S' : 'D';
  const list: Approval[] = [];
  if (s.p2 !== 'none') {
    const branch = s.p2 === 'branchA' ? 'A' : 'B';
    list.push({
      id: 'p2',
      kind: 'phase2',
      branch,
      task_subset: branch === 'A' ? null : s.p2 === 'wrongSubset' ? other : s.failing,
      model: s.p2 === 'wrongModel' ? '@cf/other' : WORKERS_COMBO.model_id,
      approved_on: '2026-11-08',
      note: '',
    });
  }
  list.push({ id: 'dev1', kind: 'dev', combination: WORKERS_COMBO.id, task_subset: s.grant, max_requests: s.max, phase2: 'p2', approved_on: '2026-11-08', note: '' });
  list.push({ id: 'lock1', kind: 'locked', combination: WORKERS_COMBO.id, task_subset: s.grant, max_requests: s.max, phase2: 'p2', approved_on: '2026-11-08', note: '' });
  return {
    combinations: [b0, b1, WORKERS_COMBO],
    entries: deriveEntries(events),
    failures: [],
    exclusions: [],
    smoke: [{ schema: SCHEMA.smoke, combination: WORKERS_COMBO.id, shape_check: s.smokeOk ? 'ok' : 'mismatch', declared_shape: 'chat', http_status: 200 } as SmokeRecord],
    approvals: s.dirty ? { approved: false, reason: 'approvals.json has uncommitted changes' } : { approved: true, approvals: list },
    passes,
    overLimit: new Set(),
  };
}

function recordsOf(root: string, kind: 'dev' | 'locked') {
  const dir = path.join(root, 'eval/results', kind);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl') && !n.endsWith('.grades.jsonl'))
    .flatMap((n) => readResultsFile(path.join(dir, n)).records);
}

test('Property 38 (run flow): requests stay inside the decision and the Task_Type_Subset; refusals send and write nothing', async () => {
  await fc.assert(
    fc.asyncProperty(runScenario, async (sc) => {
      const grant = sc.grantSubset === 'req' ? sc.req : sc.grantSubset;
      const state = runState({ failing: sc.failing, p2: sc.p2, grant, max: sc.maxRequests, dirty: sc.dirty, smokeOk: sc.smokeOk });
      const env = makeEnv(cardSet);
      const rt = createFakeRuntime();
      const deps = env.deps(rt, { phaseState: async () => state });
      const approval = sc.rightId ? (sc.kind === 'dev' ? 'dev1' : 'lock1') : 'nope';

      if (sc.kind === 'locked') {
        // The Dev_Run precondition (R3.12) is met by a Dev_Run made under an always-open gate; it is not counted below.
        const open = runState({ failing: 'DS', p2: 'right', grant: 'DS', max: 1000, dirty: false, smokeOk: true });
        const pre = createFakeRuntime();
        await capture(() => devRun(env.deps(pre, { phaseState: async () => open }), { combo: WORKERS_COMBO.id, task: 'DS', approval: 'dev1' }));
      }
      const decision = allowWorkersAi(sc.kind, WORKERS_COMBO, sc.req, state);
      const code = await capture(() =>
        sc.kind === 'dev' ? devRun(deps, { combo: WORKERS_COMBO.id, task: sc.req, approval }) : lockedRun(deps, { combo: WORKERS_COMBO.id, task: sc.req, approval }),
      );
      const recs = recordsOf(env.root, sc.kind);
      const sent = recs.filter((r) => r.outcome.kind !== 'not_run').length;
      assert.equal(rt.calls.length, sent, 'every request sent has a record');

      // 3.14: only Cards of the Task_Type_Subset are ever requested or rendered.
      const allowedTasks = subsetTasks(sc.req);
      for (const r of recs) assert.ok(allowedTasks.includes(taskOfCard.get(r.card_id) as Task), `${r.card_id} is outside subset ${sc.req}`);

      // Requests never exceed what the gate and the approval allow.
      if (rt.calls.length > 0) {
        assert.equal(decision.allowed, 'full');
        assert.ok(rt.calls.length <= sc.maxRequests);
        // Independent of phase.ts: these scenario facts are necessary for any request.
        assert.ok(!sc.dirty && sc.smokeOk && sc.rightId && sc.p2 === 'right' && sc.req === sc.failing && grant === sc.req);
        assert.equal(code.value, 0);
        fullRuns += 1;
      } else if (sc.kind === 'dev') {
        // R11.8: refused Dev_Run records every Card x Permutation as not_run / not_approved.
        assert.ok(recs.length > 0 && recs.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'not_approved'));
        assert.equal(code.value, 1);
      } else {
        // A refused Locked_Run writes nothing: no ledger entry, no results.
        assert.equal(recs.length, 0);
        assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')));
        assert.equal(code.value, 1);
      }
      if (decision.allowed === 'smoke_only') assert.equal(rt.calls.length, 0);
    }),
    { numRuns: 40 },
  );
  assert.ok(fullRuns >= 3, `only ${fullRuns} runs were allowed; the generator must exercise the allowed path`);
});

test('Property 38 (run flow): a decision that allows a run of a browser Combination is not gated', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  const { value } = await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 0);
  assert.ok(rt.calls.length > 0);
});

// ---------------------------------------------------------------- approvals read from a (fake) HEAD

test('approvals read from HEAD: a dirty or untracked file is not approved, so the gate allows Smoke_Calls only', async () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'gate-head-'));
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  const file = path.join(repo, APPROVALS_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const doc = (extra: Approval[]): string => JSON.stringify({ schema: APPROVALS_SCHEMA, approvals: extra }) + '\n';
  const p2: Approval = { id: 'p2', kind: 'phase2', branch: 'B', task_subset: 'S', model: WAI.model_id, approved_on: '2026-11-08', note: '' };
  const dev: Approval = { id: 'd1', kind: 'dev', combination: WAI.id, task_subset: 'S', max_requests: 30, phase2: 'p2', approved_on: '2026-11-08', note: '' };

  const gate = (approvals: ApprovalsResult) => {
    const s = build({
      plans: [
        { cover: 'DS', failure: false, exclusion: false, overLimit: false, passD: true, passS: false },
        { cover: 'DS', failure: false, exclusion: false, overLimit: false, passD: true, passS: false },
      ],
      smoke: [{ combo: 0, check: 'ok', shape: 'chat' }],
      approvalsOk: true,
      p2: [],
      grants: [],
      kind: 'dev',
      reqCombo: 0,
      reqSubset: 'S',
    });
    return allowWorkersAi('dev', WAI, 'S', { ...s.state, approvals });
  };

  writeFileSync(file, doc([p2, dev]));
  const untracked = await loadApprovals({ repoDir: repo, print: () => {} });
  assert.equal(untracked.approved, false);
  assert.equal(gate(untracked).allowed, 'smoke_only');

  git('add', '.');
  git('commit', '-q', '-m', 'approvals');
  const clean = await loadApprovals({ repoDir: repo, print: () => {} });
  assert.equal(clean.approved, true);
  assert.equal(gate(clean).allowed, 'full');

  writeFileSync(file, doc([p2, dev, { ...dev, id: 'd2' }]));
  const dirty = await loadApprovals({ repoDir: repo, print: () => {} });
  assert.equal(dirty.approved, false);
  assert.equal(gate(dirty).allowed, 'smoke_only');
  assert.match(gate(dirty).reason, /uncommitted changes/);
  fs.rmSync(repo, { recursive: true, force: true });
});
