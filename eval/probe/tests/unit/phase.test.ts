import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Approval } from '../../src/approvals.ts';
import { deriveEntries, LEDGER_SCHEMA, type LedgerEvent } from '../../src/ledger.ts';
import {
  allowWorkersAi,
  browserPass,
  formatLedger,
  formatPhaseStatus,
  parseCombinations,
  phase1Ended,
  phase2ResultLines,
  phaseStatus,
  type Combination,
  type EntryPasses,
  type PhaseState,
} from '../../src/phase.ts';
import { SCHEMA, type ExclusionRecord, type FailureRecord, type SmokeRecord, type TaskSubset } from '../../src/results.ts';

const REV = 'a'.repeat(40);
const inBrowser = (n: number): Combination => ({
  id: `webllm/m${n}/nvidia`,
  runtime: 'webllm',
  model_id: `Model-${n}`,
  quantization: 'q4',
  revision: REV,
  phase1_locked: true,
});
const BROWSER = [1, 2, 3, 4, 5].map(inBrowser);
const WAI: Combination = {
  id: 'workers-ai/gemma',
  runtime: 'workers-ai',
  model_id: '@cf/google/gemma-4-26b-a4b-it',
  quantization: '',
  revision: 'server-side, not pinnable',
  phase1_locked: false,
  response_shape: 'chat',
};
const COMBOS = [...BROWSER, WAI];

function entryEvents(c: Combination, id: string, subset: TaskSubset, at: string, complete = true): LedgerEvent[] {
  const evs: LedgerEvent[] = [
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
  ];
  if (complete) evs.push({ schema: LEDGER_SCHEMA, event: 'complete', entry_id: id, ended_at: at, results: 'x', requests_sent: 2 });
  return evs;
}

const approvalsOf = (...a: Approval[]) => ({ approved: true as const, approvals: a });
const P2_A: Approval = { id: 'P2-001', kind: 'phase2', branch: 'A', task_subset: null, approved_on: '2026-11-08', note: '' };
const P2_B_S: Approval = { id: 'P2-001', kind: 'phase2', branch: 'B', model: WAI.model_id, task_subset: 'S', approved_on: '2026-11-08', note: '' };
const DEV_S: Approval = { id: 'A-001', kind: 'dev', combination: WAI.id, task_subset: 'S', max_requests: 30, phase2: 'P2-001', approved_on: '2026-11-08', note: '' };
const LOCKED_S: Approval = { id: 'A-002', kind: 'locked', combination: WAI.id, task_subset: 'S', max_requests: 200, phase2: 'P2-001', approved_on: '2026-11-08', note: '' };
const SMOKE_OK = { schema: SCHEMA.smoke, combination: WAI.id, shape_check: 'ok', declared_shape: 'chat', http_status: 200 } as SmokeRecord;

/** Every browser Combination has a complete DS entry; `passes` says what each passed. */
function state(over: Partial<PhaseState> & { passing?: Record<string, EntryPasses> } = {}): PhaseState {
  const events = BROWSER.flatMap((c, i) => entryEvents(c, `L-${i + 1}`, 'DS', `2026-11-0${i + 1}T09:00:00Z`));
  const passes = new Map<string, EntryPasses>(Object.entries(over.passing ?? {}));
  const { passing: _unused, ...rest } = over;
  return {
    combinations: COMBOS,
    entries: deriveEntries(events),
    failures: [],
    exclusions: [],
    smoke: [],
    approvals: approvalsOf(),
    passes,
    overLimit: new Set(),
    ...rest,
  };
}

const excl = (c: Combination): ExclusionRecord => ({ schema: SCHEMA.exclusion, combination: c.id, model: c.model_id, check: 'vram', value: 3000, limit: 2600, at: '2026-11-05T00:00:00Z' });

// ---------------------------------------------------------------- Phase_1

test('Phase_1 ends only when every phase1_locked Combination is complete, failed or excluded', () => {
  const only4 = state({ entries: deriveEntries(BROWSER.slice(0, 4).flatMap((c, i) => entryEvents(c, `L-${i + 1}`, 'DS', `2026-11-0${i + 1}T09:00:00Z`))) });
  assert.equal(phase1Ended(only4), false);
  assert.deepEqual(phaseStatus(only4).pending.map((p) => p.combination), [BROWSER[4]?.id]);
  // The fifth: a failure record, then an Exclusion_Record, each finishes it.
  const failure = { schema: SCHEMA.failure, combination: BROWSER[4]?.id as string, kind: 'model_load_failed' } as FailureRecord;
  assert.equal(phase1Ended({ ...only4, failures: [failure] }), true);
  assert.equal(phase1Ended({ ...only4, exclusions: [excl(BROWSER[4] as Combination)] }), true);
  // A D-only complete entry is not a D-and-S entry; D then S entries together are.
  const dOnly = state({ entries: deriveEntries([...BROWSER.slice(0, 4).flatMap((c, i) => entryEvents(c, `L-${i + 1}`, 'DS', '2026-11-01T09:00:00Z')), ...entryEvents(BROWSER[4] as Combination, 'L-5', 'D', '2026-11-05T09:00:00Z')]) });
  assert.equal(phase1Ended(dOnly), false);
  const base4 = BROWSER.slice(0, 4).flatMap((c, i) => entryEvents(c, `L-${i + 1}`, 'DS', '2026-11-01T09:00:00Z'));
  const fifth = BROWSER[4] as Combination;
  const dThenS = [...base4, ...entryEvents(fifth, 'L-5', 'D', '2026-11-05T09:00:00Z'), ...entryEvents(fifth, 'L-6', 'S', '2026-11-06T09:00:00Z')];
  assert.equal(phase1Ended(state({ entries: deriveEntries(dThenS) })), true);
});

test('an incomplete entry does not finish Phase_1', () => {
  const events = [...BROWSER.slice(0, 4).flatMap((c, i) => entryEvents(c, `L-${i + 1}`, 'DS', '2026-11-01T09:00:00Z')), ...entryEvents(BROWSER[4] as Combination, 'L-5', 'DS', '2026-11-05T09:00:00Z', false)];
  assert.equal(phase1Ended(state({ entries: deriveEntries(events) })), false);
});

// ---------------------------------------------------------------- phase-status

test('phase-status, branch A: both Task_Types pass, entry IDs cited', () => {
  const s = state({ passing: { 'L-1': { decision: true, synthesis: false }, 'L-2': { decision: false, synthesis: true } } });
  const st = phaseStatus(s);
  assert.equal(st.branch, 'A');
  assert.equal(st.subset, null);
  assert.deepEqual(st.tasks.map((t) => [t.task, t.pass, t.passingEntries.map((e) => e.entry_id)]), [['decision', true, ['L-1']], ['synthesis', true, ['L-2']]]);
  const text = formatPhaseStatus(st).join('\n');
  assert.match(text, /D \(decision\): pass.*L-1/);
  assert.match(text, /S \(synthesis\): pass.*L-2/);
  assert.match(text, /Branch: A/);
});

test('phase-status, branch B: S has no pass, so the subset is S', () => {
  const st = phaseStatus(state({ passing: { 'L-1': { decision: true, synthesis: false }, 'L-2': { decision: true, synthesis: false } } }));
  assert.equal(st.branch, 'B');
  assert.equal(st.subset, 'S');
  const text = formatPhaseStatus(st).join('\n');
  assert.match(text, /S \(synthesis\): no pass/);
  assert.match(text, /Branch: B .*subset S/);
  assert.match(text, /phase2 approval: none; ask the Author/);
  // Neither passes: DS.
  assert.equal(phaseStatus(state()).subset, 'DS');
});

test('phase-status with an Exclusion_Record: the excluded Combination never counts as a pass', () => {
  const c1 = BROWSER[0] as Combination;
  const s = state({ passing: { 'L-1': { decision: true, synthesis: true } }, exclusions: [excl(c1)] });
  assert.equal(browserPass(c1, 'decision', s), false);
  const st = phaseStatus(s);
  assert.equal(st.ended, true);
  assert.equal(st.branch, 'B');
  assert.equal(st.subset, 'DS');
  assert.match(formatPhaseStatus(st).join('\n'), /Exclusion_Record/);
  // The same pass without the exclusion counts.
  assert.equal(browserPass(c1, 'decision', { ...s, exclusions: [] }), true);
  // Over the In_Browser_Size_Limits by measured download: also not a pass.
  assert.equal(browserPass(c1, 'synthesis', { ...s, exclusions: [], overLimit: new Set([c1.id]) }), false);
});

test('phase-status reports Phase_1 in progress with the missing Task_Types', () => {
  const st = phaseStatus(state({ entries: [] }));
  assert.equal(st.ended, false);
  assert.equal(st.branch, null);
  assert.match(formatPhaseStatus(st).join('\n'), /Phase_1: in progress[\s\S]*pending\s+webllm\/m1\/nvidia\s+\(needs D and S\)/);
});

test('only the entry used under R3.8 decides: a later passing re-run does not change a failed pass', () => {
  const c1 = BROWSER[0] as Combination;
  const events = [...entryEvents(c1, 'L-1', 'DS', '2026-11-01T09:00:00Z'), ...entryEvents(c1, 'L-9', 'DS', '2026-11-09T09:00:00Z')];
  const s = state({ entries: deriveEntries(events), passing: { 'L-1': { decision: false }, 'L-9': { decision: true } } });
  assert.equal(browserPass(c1, 'decision', s), false);
});

// ---------------------------------------------------------------- allowWorkersAi

const full = (extra: Partial<PhaseState> & { passing?: Record<string, EntryPasses> } = {}) =>
  state({ passing: { 'L-1': { decision: true, synthesis: false }, 'L-2': { decision: true, synthesis: false } }, approvals: approvalsOf(P2_B_S, DEV_S, LOCKED_S), smoke: [SMOKE_OK], ...extra });

test('smoke is always smoke_only; non-smoke in Phase_1 is smoke_only with the pending Combinations named', () => {
  assert.equal(allowWorkersAi('smoke', WAI, 'S', full()).allowed, 'smoke_only');
  const d = allowWorkersAi('dev', WAI, 'S', full({ entries: [] }));
  assert.equal(d.allowed, 'smoke_only');
  assert.equal(d.phase, 'phase1');
  assert.match(d.reason, /Phase_1 has not ended.*webllm\/m1\/nvidia/);
});

test('branch B allows dev and locked for the named model and the failing subset only', () => {
  const dev = allowWorkersAi('dev', WAI, 'S', full());
  assert.equal(dev.allowed, 'full');
  assert.deepEqual(dev.approvals, ['P2-001', 'A-001']);
  assert.equal(allowWorkersAi('locked', WAI, 'S', full()).allowed, 'full');
  // Wrong subset (DS is not the failing subset S), wrong model, missing per-run approval.
  assert.match(allowWorkersAi('dev', WAI, 'DS', full()).reason, /differs from the failing subset S/);
  assert.match(allowWorkersAi('dev', { ...WAI, id: 'workers-ai/other', model_id: '@cf/other' }, 'S', full()).reason, /names model @cf\/google\/gemma-4-26b-a4b-it, not @cf\/other/);
  const noLocked = allowWorkersAi('locked', WAI, 'S', full({ approvals: approvalsOf(P2_B_S, DEV_S) }));
  assert.equal(noLocked.allowed, 'smoke_only');
  assert.match(noLocked.reason, /no locked approval/);
});

test('branch A allows Smoke_Calls only', () => {
  const s = full({ passing: { 'L-1': { decision: true, synthesis: true } }, approvals: approvalsOf(P2_A) });
  const d = allowWorkersAi('dev', WAI, 'S', s);
  assert.equal(d.allowed, 'smoke_only');
  assert.equal(d.branch, 'A');
  assert.match(d.reason, /branch A/);
});

test('a branch recomputed differently from the phase2 entry refuses every non-smoke run naming both values', () => {
  // The entry says A, but S now has no pass: recomputed B (subset S).
  const d = allowWorkersAi('dev', WAI, 'S', full({ approvals: approvalsOf(P2_A, DEV_S) }));
  assert.equal(d.allowed, 'smoke_only');
  assert.match(d.reason, /records branch A \(no subset\).*recomputes branch B \(subset S\)/);
  // Same branch letter, different subset also refuses.
  const e = allowWorkersAi('dev', WAI, 'S', full({ approvals: approvalsOf({ ...P2_B_S, task_subset: 'DS' }, DEV_S) }));
  assert.match(e.reason, /branch B \(subset DS\).*branch B \(subset S\)/);
});

test('Phase_1 ended but no phase2 entry, and approvals unreadable from HEAD: smoke only', () => {
  assert.match(allowWorkersAi('dev', WAI, 'S', full({ approvals: approvalsOf() })).reason, /no phase2 entry/);
  const u = allowWorkersAi('locked', WAI, 'S', full({ approvals: { approved: false, reason: 'approvals.json has uncommitted changes' } }));
  assert.equal(u.allowed, 'smoke_only');
  assert.match(u.reason, /uncommitted changes/);
});

test('Response_Shape gate: needs the newest Smoke_Call shape check ok for the declared shape', () => {
  assert.match(allowWorkersAi('dev', WAI, 'S', full({ smoke: [] })).reason, /no Smoke_Call shape check/);
  const bad = { ...SMOKE_OK, shape_check: 'mismatch', http_status: 200 } as SmokeRecord;
  assert.match(allowWorkersAi('dev', WAI, 'S', full({ smoke: [SMOKE_OK, bad] })).reason, /is mismatch \(HTTP status 200\)/);
  // An older mismatch followed by an ok is fine.
  assert.equal(allowWorkersAi('dev', WAI, 'S', full({ smoke: [bad, SMOKE_OK] })).allowed, 'full');
  // The declared shape changed after the last Smoke_Call.
  assert.match(allowWorkersAi('dev', { ...WAI, response_shape: 'text' }, 'S', full()).reason, /now declares text/);
});

// ---------------------------------------------------------------- ledger listing, combinations

test('ledger lists entries with subset and derived status', () => {
  const c1 = BROWSER[0] as Combination;
  const lines = formatLedger(deriveEntries([...entryEvents(c1, 'L-1', 'D', '2026-11-01T09:00:00Z'), ...entryEvents(c1, 'L-2', 'S', '2026-11-02T09:00:00Z', false)]));
  assert.match(lines[0] as string, /^L-1 {2}webllm\/m1\/nvidia {2}subset D {2}complete/);
  assert.match(lines[1] as string, /^L-2 {2}webllm\/m1\/nvidia {2}subset S {2}incomplete {2}started/);
  assert.deepEqual(formatLedger([]), ['ledger: no entries']);
});

test('parseCombinations accepts a list and refuses bad shapes', () => {
  assert.equal(parseCombinations(JSON.stringify(COMBOS)).length, 6);
  assert.throws(() => parseCombinations('{'), /not valid JSON/);
  assert.throws(() => parseCombinations(JSON.stringify([{ ...BROWSER[0], phase1_locked: 'yes' }])), /phase1_locked/);
  assert.throws(() => parseCombinations(JSON.stringify([BROWSER[0], BROWSER[0]])), /duplicate/);
  assert.throws(() => parseCombinations(JSON.stringify([{ ...WAI, response_shape: 'json' }])), /response_shape/);
});

test('phase2ResultLines: a complete Workers AI Locked_Run shows its pass or fail per Task_Type; browser entries are not listed', () => {
  const entries = deriveEntries([
    ...BROWSER.flatMap((c, i) => entryEvents(c, `L-${i + 1}`, 'DS', `2026-11-0${i + 1}T09:00:00Z`)),
    ...entryEvents(WAI, 'L-W', 'DS', '2026-11-09T01:00:00Z'),
    ...entryEvents(WAI, 'L-W2', 'D', '2026-11-09T02:00:00Z', false),
  ]);
  const lines = phase2ResultLines(state({ entries, passing: { 'L-W': { decision: false, synthesis: false } } }));
  assert.deepEqual(lines, [`Phase_2 Locked_Run: ${WAI.id} L-W (subset DS): D fail, S fail`]);
  assert.match(phase2ResultLines(state({ entries }))[0] as string, /D unknown, S unknown/);
  assert.deepEqual(phase2ResultLines(state()), []);
});
