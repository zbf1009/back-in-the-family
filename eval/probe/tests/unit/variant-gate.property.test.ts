// Property 53 (llm-probe task 42.2): A Decision_Variant step needs its own approval, its own order, an unchanged registry,
// and is held per variant. Synthetic ledger, headers and approvals only; no card content, no real file.
// Coverage is deterministic: every deciding condition has a pinned example, and the random property compares the gate with an
// independent oracle on top of them (the earlier Property 48 flaked on a random-only coverage assertion).
// **Validates: Requirements 20.1, 20.10, 20.11, 19.4, 19.13, 19.17**
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { parseApprovals, type Approval } from '../../src/approvals.ts';
import { deriveEntries } from '../../src/ledger.ts';
import {
  allowDecisionModel,
  allowDecisionVariant,
  decisionHold,
  decisionHoldPending,
  formatDecisionModels,
  phase2Candidates,
  phase2CandidatesTried,
  registryCheck,
  type Combination,
  type DerivedRunInfo,
  type DevRunInfo,
  type PhaseState,
  type VariantRegistryEntry,
} from '../../src/phase.ts';
import type { ExclusionRecord, FailureRecord } from '../../src/results.ts';
import { baseState, BROWSER, DM_A, DM_B, GEMMA, entryEvents, exclusion, failure, smokeRec } from './decision-gate.helpers.ts';

const AGG = 'a'.repeat(64);
const permAvgOf = (single: Combination): Combination =>
  ({
    id: `${single.id}/perm_avg`,
    runtime: single.runtime,
    model_id: single.model_id,
    quantization: '',
    revision: single.revision,
    phase1_locked: false,
    response_shape: 'system_one',
    variant: 'perm_avg',
    derives_from: single.id,
    sends_requests: false,
    aggregation: { file: 'x.txt', rule_version: 1, sha256: AGG },
  }) as unknown as Combination;
const PA_A = permAvgOf(DM_A);
const PA_B = permAvgOf(DM_B);
const COMBOS: readonly Combination[] = [BROWSER, GEMMA, DM_A, PA_A, DM_B, PA_B];
const PAIRS = [
  { single: DM_A, perm: PA_A },
  { single: DM_B, perm: PA_B },
] as const;
const MAPPING = 'map-hash';

const registryOf = (single: Combination, perm: Combination, aggregation = AGG): VariantRegistryEntry[] => [
  { id: single.id, variant: 'single', aggregation_hash: null },
  { id: perm.id, variant: 'perm_avg', aggregation_hash: aggregation },
];
const approval = (id: string, c: Combination, step: Approval['step'], variant: 'single' | 'perm_avg' | undefined, max: number): Approval => ({
  id,
  kind: 'decision_model',
  step,
  combination: c.id,
  task_subset: 'D',
  max_requests: max,
  approved_on: '2026-11-10',
  note: '',
  ...(variant === undefined ? {} : { variant }),
});
const withdrawalOf = (id: string, ...ids: string[]): Approval => ({ id, kind: 'withdrawal', withdraws: ids, withdrawn_on: '2026-11-11', note: '' });

// ---------------------------------------------------------------- a state built from a spec

interface Spec {
  ended: boolean;
  readable: boolean;
  /** Entries for the combination under test (index 0 = A pair, 1 = B pair). */
  entries: { pair: 0 | 1; variant: 'perm_avg' | 'single'; step: 'derive_dev' | 'derive_locked' | 'dev' | 'locked'; withdrawn: boolean }[];
  devComplete: [boolean, boolean];
  lockedComplete: [boolean, boolean];
  derivedDev: 'none' | 'equal' | 'old_mapping' | 'old_aggregation' | 'other_combo';
  header: 'equal' | 'different' | 'missing' | 'no_dev_run';
  step: 'derive_dev' | 'derive_locked' | 'dev' | 'locked' | 'smoke';
  subset: 'D' | 'S' | 'DS';
  pair: 0 | 1;
  named: boolean;
}

const GOOD: Spec = {
  ended: true,
  readable: true,
  entries: [
    { pair: 0, variant: 'perm_avg', step: 'derive_dev', withdrawn: false },
    { pair: 0, variant: 'perm_avg', step: 'derive_locked', withdrawn: false },
  ],
  devComplete: [true, true],
  lockedComplete: [true, true],
  derivedDev: 'equal',
  header: 'equal',
  step: 'derive_locked',
  subset: 'D',
  pair: 0,
  named: true,
};

function build(spec: Spec): { state: PhaseState; approvalId: string | null } {
  const approvals: Approval[] = [];
  const gone: string[] = [];
  spec.entries.forEach((e, i) => {
    const c = PAIRS[e.pair][e.variant === 'perm_avg' ? 'perm' : 'single'];
    const a = approval(`E${i}`, c, e.step, e.variant === 'perm_avg' ? 'perm_avg' : undefined, e.variant === 'perm_avg' ? 0 : 74);
    approvals.push(a);
    if (e.withdrawn) gone.push(a.id);
  });
  if (gone.length > 0) approvals.push(withdrawalOf('W1', ...gone));
  const devRuns: DevRunInfo[] = [];
  const registry = new Map<string, readonly VariantRegistryEntry[]>();
  for (const { single, perm } of PAIRS) {
    registry.set(single.model_id, registryOf(single, perm));
    if (spec.header === 'no_dev_run') continue;
    devRuns.push({
      run_id: `dev-${single.id}`,
      combination: single.id,
      task_subset: 'D',
      template_hashes: { decision: MAPPING },
      ...(spec.header === 'missing' ? {} : { variants: spec.header === 'equal' ? registryOf(single, perm) : registryOf(single, perm, 'b'.repeat(64)) }),
    });
  }
  const derived: DerivedRunInfo[] = [];
  const target = PAIRS[spec.pair].perm;
  if (spec.derivedDev !== 'none') {
    derived.push({
      run_id: 'derived-dev-1',
      combination: spec.derivedDev === 'other_combo' ? PAIRS[spec.pair === 0 ? 1 : 0].perm.id : target.id,
      split: 'dev',
      template_hashes: { decision: spec.derivedDev === 'old_mapping' ? 'old' : MAPPING, aggregation: spec.derivedDev === 'old_aggregation' ? 'old' : AGG },
    });
  }
  const sources = (flags: [boolean, boolean]): Set<string> => new Set(PAIRS.filter((_, i) => flags[i]).map((p) => p.single.id));
  const state = baseState({
    combinations: COMBOS,
    entries: deriveEntries(spec.ended ? entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z') : []),
    approvals: spec.readable ? { approved: true, approvals } : { approved: false, reason: 'test: unreadable' },
    devRuns,
    derived,
    registry,
    variantSources: { devComplete: sources(spec.devComplete), lockedComplete: sources(spec.lockedComplete), mappingHash: new Map(PAIRS.map((p) => [p.single.id, MAPPING] as const)) },
  });
  const matching = spec.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.pair === spec.pair && e.variant === 'perm_avg' && e.step === spec.step);
  const named = (matching.find(({ e }) => !e.withdrawn) ?? matching[0])?.i ?? -1;
  return { state, approvalId: spec.named && named >= 0 ? `E${named}` : null };
}

/** Independent oracle: the conditions of the property, written out again. */
function expected(spec: Spec): 'allowed' | 'wrong_subset' | 'refused' {
  if (spec.step !== 'derive_dev' && spec.step !== 'derive_locked') return 'refused';
  if (spec.subset !== 'D') return 'wrong_subset';
  if (!spec.ended || !spec.readable) return 'refused';
  const covered = spec.entries.some((e) => e.pair === spec.pair && e.variant === 'perm_avg' && e.step === spec.step && !e.withdrawn);
  if (!covered) return 'refused';
  const complete = spec.step === 'derive_dev' ? spec.devComplete[spec.pair] : spec.lockedComplete[spec.pair];
  if (!complete) return 'refused';
  if (spec.step === 'derive_locked' && spec.derivedDev !== 'equal') return 'refused';
  if (spec.header !== 'equal') return 'refused';
  return 'allowed';
}

const gate = (spec: Spec): string => {
  const { state, approvalId } = build(spec);
  const r = allowDecisionVariant(spec.step, PAIRS[spec.pair].perm, state, spec.subset, { approvalId });
  return r.outcome;
};

// ---------------------------------------------------------------- pinned examples (deterministic coverage)

const MUTATIONS: readonly { name: string; spec: Spec; outcome: 'allowed' | 'refused' | 'wrong_subset'; reason?: RegExp }[] = [
  { name: 'all conditions hold (derive_locked)', spec: GOOD, outcome: 'allowed' },
  { name: 'all conditions hold (derive_dev)', spec: { ...GOOD, step: 'derive_dev', derivedDev: 'none' }, outcome: 'allowed' },
  { name: 'subset S', spec: { ...GOOD, subset: 'S' }, outcome: 'wrong_subset' },
  { name: 'subset DS', spec: { ...GOOD, subset: 'DS' }, outcome: 'wrong_subset' },
  { name: 'Phase_1 not ended', spec: { ...GOOD, ended: false }, outcome: 'refused', reason: /Phase_1 has not ended/ },
  { name: 'approvals unreadable', spec: { ...GOOD, readable: false }, outcome: 'refused', reason: /approvals.json is not usable/ },
  { name: 'no entry at all', spec: { ...GOOD, entries: [] }, outcome: 'refused', reason: /no unwithdrawn decision_model derive_locked approval/ },
  { name: 'only the derive_dev entry covers derive_dev, not derive_locked', spec: { ...GOOD, entries: [GOOD.entries[0] as Spec['entries'][number]] }, outcome: 'refused', reason: /derive_locked approval/ },
  { name: 'the entry is withdrawn', spec: { ...GOOD, entries: [GOOD.entries[0] as Spec['entries'][number], { ...(GOOD.entries[1] as Spec['entries'][number]), withdrawn: true }] }, outcome: 'refused', reason: /no unwithdrawn/ },
  { name: 'the entry is for the other model', spec: { ...GOOD, entries: GOOD.entries.map((e) => ({ ...e, pair: 1 as const })) }, outcome: 'refused', reason: /no unwithdrawn/ },
  { name: 'single entries (dev, locked) cover nothing', spec: { ...GOOD, entries: [{ pair: 0, variant: 'single', step: 'dev', withdrawn: false }, { pair: 0, variant: 'single', step: 'locked', withdrawn: false }] }, outcome: 'refused', reason: /no unwithdrawn/ },
  { name: 'a perm_avg dev request', spec: { ...GOOD, step: 'dev' }, outcome: 'refused', reason: /^variant: dev of .+ is refused/ },
  { name: 'a perm_avg locked request', spec: { ...GOOD, step: 'locked' }, outcome: 'refused', reason: /^variant: locked of .+ is refused/ },
  { name: 'source Dev_Run incomplete (derive_dev)', spec: { ...GOOD, step: 'derive_dev', devComplete: [false, true] }, outcome: 'refused', reason: /no complete Dev_Run/ },
  { name: 'source Locked_Run incomplete', spec: { ...GOOD, lockedComplete: [false, true] }, outcome: 'refused', reason: /no complete Locked_Run/ },
  { name: 'no Dev derived file for derive_locked', spec: { ...GOOD, derivedDev: 'none' }, outcome: 'refused', reason: /Derived_Run of the Dev split/ },
  { name: 'Dev derived file with an old mapping hash', spec: { ...GOOD, derivedDev: 'old_mapping' }, outcome: 'refused', reason: /Derived_Run of the Dev split/ },
  { name: 'Dev derived file with an old aggregation hash', spec: { ...GOOD, derivedDev: 'old_aggregation' }, outcome: 'refused', reason: /Derived_Run of the Dev split/ },
  { name: 'Dev derived file of the other Combination', spec: { ...GOOD, derivedDev: 'other_combo' }, outcome: 'refused', reason: /Derived_Run of the Dev split/ },
  { name: 'registry differs from the Dev_Run header', spec: { ...GOOD, header: 'different' }, outcome: 'refused', reason: /registry changed after the first Dev_Run result \(R20.1\); needs a recorded Author amendment/ },
  { name: 'Dev_Run header records no registry', spec: { ...GOOD, header: 'missing' }, outcome: 'refused', reason: /registry changed/ },
  { name: 'no Dev_Run at all', spec: { ...GOOD, header: 'no_dev_run' }, outcome: 'refused', reason: /registry changed/ },
  { name: 'no --approval ID given', spec: { ...GOOD, named: false }, outcome: 'allowed' },
];

for (const m of MUTATIONS) {
  test(`Property 53 (pinned): ${m.name}`, () => {
    const { state, approvalId } = build(m.spec);
    const r = allowDecisionVariant(m.spec.step, PAIRS[m.spec.pair].perm, state, m.spec.subset, { approvalId });
    assert.equal(r.outcome, m.outcome, r.reason);
    if (m.reason !== undefined) assert.match(r.reason, m.reason);
    assert.equal(expected(m.spec), m.outcome, 'the oracle agrees with the pinned outcome');
  });
}

test('Property 53 (pinned): an --approval ID that names no unwithdrawn entry of the step refuses', () => {
  const { state } = build(GOOD);
  const r = allowDecisionVariant('derive_locked', PA_A, state, 'D', { approvalId: 'E0' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.reason, /--approval E0 is not an unwithdrawn derive_locked approval/);
  assert.equal(allowDecisionVariant('derive_locked', PA_A, state, 'D', { approvalId: 'E1' }).outcome, 'allowed');
});

test('Property 53 (pinned): allowDecisionModel never accepts a perm_avg Combination, and a perm_avg entry never covers a single step', () => {
  const approvals = [approval('E0', PA_A, 'derive_dev', 'perm_avg', 0), approval('S1', DM_A, 'dev', undefined, 74)];
  const state = baseState({ combinations: COMBOS, approvals: { approved: true, approvals }, smoke: [smokeRec(DM_A, 'ok'), smokeRec(PA_A, 'ok')], devRuns: [] });
  assert.equal(allowDecisionModel('dev', PA_A, 'D', state, { count: 74, mappingHash: MAPPING }).outcome, 'refused');
  const single = allowDecisionModel('dev', DM_A, 'D', state, { count: 74, mappingHash: MAPPING });
  assert.equal(single.outcome, 'allowed');
  assert.equal(single.outcome === 'allowed' ? single.approval : null, 'S1');
  // The single step does not see the perm_avg entry even for the same ID space.
  const only = baseState({ combinations: COMBOS, approvals: { approved: true, approvals: [approval('E0', PA_A, 'derive_dev', 'perm_avg', 0)] }, smoke: [smokeRec(DM_A, 'ok')] });
  assert.equal(allowDecisionModel('dev', DM_A, 'D', only, { count: 74, mappingHash: MAPPING }).outcome, 'refused');
});

// ---------------------------------------------------------------- the reader (approvals.ts)

const file = (entries: unknown[]): string => JSON.stringify({ schema: 'llm-probe-approvals-v1', approvals: entries });
const entry = (over: Record<string, unknown>): Record<string, unknown> => ({ id: 'X1', kind: 'decision_model', combination: PA_A.id, task_subset: 'D', step: 'derive_dev', variant: 'perm_avg', max_requests: 0, approved_on: '2026-11-10', note: '', ...over });

test('Property 53 (reader): derive steps need variant perm_avg and max_requests 0; dev and locked need the single variant', () => {
  assert.equal(parseApprovals(file([entry({})])).length, 1);
  assert.equal(parseApprovals(file([entry({ step: 'derive_locked' })]))[0]?.variant, 'perm_avg');
  assert.equal(parseApprovals(file([entry({ combination: DM_A.id, step: 'dev', variant: 'single', max_requests: 74 })])).length, 1);
  assert.equal(parseApprovals(file([entry({ combination: DM_A.id, step: 'locked', variant: undefined, max_requests: 236 })])).length, 1);
  assert.throws(() => parseApprovals(file([entry({ variant: undefined })])), /derive_dev needs "variant": "perm_avg"/);
  assert.throws(() => parseApprovals(file([entry({ variant: 'single' })])), /needs "variant": "perm_avg"/);
  assert.throws(() => parseApprovals(file([entry({ step: 'dev' })])), /not derive_dev or derive_locked/);
  assert.throws(() => parseApprovals(file([entry({ step: 'locked' })])), /not derive_dev or derive_locked/);
  assert.throws(() => parseApprovals(file([entry({ max_requests: 1 })])), /not 0/);
  assert.throws(() => parseApprovals(file([entry({ max_requests: undefined })])), /missing max_requests/);
  assert.throws(() => parseApprovals(file([entry({ variant: 'both' })])), /variant is not single or perm_avg/);
  assert.throws(() => parseApprovals(file([entry({ combination: DM_A.id, step: 'dev', variant: 'single', max_requests: 0 })])), /not a positive integer/);
});

// ---------------------------------------------------------------- the random property

const entryArb = fc.record({
  pair: fc.constantFrom<0 | 1>(0, 1),
  variant: fc.constantFrom<'perm_avg' | 'single'>('perm_avg', 'perm_avg', 'perm_avg', 'single'),
  step: fc.constantFrom<'derive_dev' | 'derive_locked' | 'dev' | 'locked'>('derive_dev', 'derive_locked', 'dev', 'locked'),
  withdrawn: fc.boolean(),
});
const specArb: fc.Arbitrary<Spec> = fc.record({
  ended: fc.constantFrom(true, true, true, false),
  readable: fc.constantFrom(true, true, true, false),
  entries: fc.array(entryArb, { maxLength: 6 }),
  devComplete: fc.tuple(fc.boolean(), fc.boolean()),
  lockedComplete: fc.tuple(fc.boolean(), fc.boolean()),
  derivedDev: fc.constantFrom('none', 'equal', 'equal', 'old_mapping', 'old_aggregation', 'other_combo'),
  header: fc.constantFrom('equal', 'equal', 'equal', 'different', 'missing', 'no_dev_run'),
  step: fc.constantFrom('derive_dev', 'derive_locked', 'derive_locked', 'dev', 'locked', 'smoke'),
  subset: fc.constantFrom('D', 'D', 'D', 'S', 'DS'),
  pair: fc.constantFrom<0 | 1>(0, 1),
  named: fc.boolean(),
}) as fc.Arbitrary<Spec>;

test('Property 53: the variant gate equals the written-out conditions for any state and request', () => {
  const examples: [Spec][] = MUTATIONS.map((m) => [m.spec]);
  fc.assert(
    fc.property(specArb, (spec) => {
      assert.equal(gate(spec), expected(spec), JSON.stringify(spec));
    }),
    { numRuns: 400, examples },
  );
});

test('Property 53: the gate reads nothing but its arguments (the state is not changed)', () => {
  const { state } = build(GOOD);
  const text = (): string => JSON.stringify(state, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
  const before = text();
  allowDecisionVariant('derive_locked', PA_A, state);
  allowDecisionVariant('dev', PA_A, state);
  assert.equal(text(), before);
});

// ---------------------------------------------------------------- the registry check

test('Property 53 (registry): free before the first Dev_Run result, equal or changed after it', () => {
  const a = build({ ...GOOD, header: 'no_dev_run' }).state;
  assert.equal(registryCheck(DM_A.model_id, a).status, 'free');
  assert.equal(registryCheck(DM_A.model_id, build(GOOD).state).status, 'equal');
  assert.equal(registryCheck(DM_A.model_id, build({ ...GOOD, header: 'different' }).state).status, 'changed');
  // A refused Dev_Run (nothing attempted) is not a result.
  const refused: PhaseState = { ...build(GOOD).state, devRuns: [{ run_id: 'd', combination: DM_A.id, task_subset: 'D', template_hashes: {}, attempted: false }] };
  assert.equal(registryCheck(DM_A.model_id, refused).status, 'free');
  // Adding a variant to the current registry after the first result is visible.
  const grown: PhaseState = { ...build(GOOD).state, registry: new Map([[DM_A.model_id, [...registryOf(DM_A, PA_A), { id: 'workers-ai/x/perm_avg', variant: 'perm_avg' as const, aggregation_hash: AGG }]]]) };
  assert.equal(registryCheck(DM_A.model_id, grown).status, 'changed');
});

// ---------------------------------------------------------------- the hold and the candidate count, per variant

interface HoldSpec {
  readable: boolean;
  /** Per variant: [A single, A perm, B single, B perm]. */
  approved: [boolean, boolean, boolean, boolean];
  withdrawn: [boolean, boolean, boolean, boolean];
  /** single: complete D ledger entry; perm_avg: Locked derived file. */
  resolved: [boolean, boolean, boolean, boolean];
  /** A recorded failure (single: locked, non-transient) or Exclusion_Record on the single variant of the pair. */
  sourceEnded: ['none' | 'failure' | 'exclusion', 'none' | 'failure' | 'exclusion'];
  devDerived: [boolean, boolean];
  devRun: [boolean, boolean];
}

const VARIANTS = [DM_A, PA_A, DM_B, PA_B] as const;

function buildHold(spec: HoldSpec): PhaseState {
  const approvals: Approval[] = [];
  const gone: string[] = [];
  VARIANTS.forEach((c, i) => {
    if (!spec.approved[i]) return;
    const perm = i % 2 === 1;
    const a = perm ? approval(`H${i}`, c, 'derive_locked', 'perm_avg', 0) : approval(`H${i}`, c, 'dev', undefined, 74);
    approvals.push(a);
    if (spec.withdrawn[i]) gone.push(a.id);
  });
  if (gone.length > 0) approvals.push(withdrawalOf('HW', ...gone));
  const events = entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z');
  const failures: FailureRecord[] = [];
  const exclusions: ExclusionRecord[] = [];
  const derived: DerivedRunInfo[] = [];
  const devRuns: DevRunInfo[] = [];
  PAIRS.forEach((p, k) => {
    if (spec.resolved[2 * k]) events.push(...entryEvents(p.single, `W-${k}`, 'D', `2026-11-09T0${k + 1}:00:00Z`));
    if (spec.sourceEnded[k] === 'failure') failures.push(failure(p.single, 'locked', false));
    if (spec.sourceEnded[k] === 'exclusion') exclusions.push(exclusion(p.single));
    if (spec.resolved[2 * k + 1]) derived.push({ run_id: `dl-${k}`, combination: p.perm.id, split: 'locked', template_hashes: {} });
    if (spec.devDerived[k]) derived.push({ run_id: `dd-${k}`, combination: p.perm.id, split: 'dev', template_hashes: {} });
    if (spec.devRun[k]) devRuns.push({ run_id: `dev-${k}`, combination: p.single.id, task_subset: 'D', template_hashes: {}, attempted: true });
  });
  return baseState({
    combinations: COMBOS,
    entries: deriveEntries(events),
    failures,
    exclusions,
    approvals: spec.readable ? { approved: true, approvals } : { approved: false, reason: 'test: unreadable' },
    devRuns,
    derived,
  });
}

function holdOracle(spec: HoldSpec): string[] {
  if (!spec.readable) return [];
  const out: string[] = [];
  VARIANTS.forEach((c, i) => {
    if (!spec.approved[i] || spec.withdrawn[i]) return;
    const k = i >> 1;
    const ended = spec.sourceEnded[k] !== 'none';
    if (!(spec.resolved[i] || ended)) out.push(c.id);
  });
  return out;
}

const four = <T>(a: fc.Arbitrary<T>): fc.Arbitrary<[T, T, T, T]> => fc.tuple(a, a, a, a);
const holdArb: fc.Arbitrary<HoldSpec> = fc.record({
  readable: fc.constantFrom(true, true, true, false),
  approved: four(fc.boolean()),
  withdrawn: four(fc.boolean()),
  resolved: four(fc.boolean()),
  sourceEnded: fc.tuple(fc.constantFrom<'none' | 'failure' | 'exclusion'>('none', 'none', 'failure', 'exclusion'), fc.constantFrom<'none' | 'failure' | 'exclusion'>('none', 'none', 'failure', 'exclusion')),
  devDerived: fc.tuple(fc.boolean(), fc.boolean()),
  devRun: fc.tuple(fc.boolean(), fc.boolean()),
}) as fc.Arbitrary<HoldSpec>;

const NONE: HoldSpec = {
  readable: true,
  approved: [false, false, false, false],
  withdrawn: [false, false, false, false],
  resolved: [false, false, false, false],
  sourceEnded: ['none', 'none'],
  devDerived: [false, false],
  devRun: [false, false],
};
const HOLD_EXAMPLES: HoldSpec[] = [
  NONE,
  { ...NONE, approved: [true, false, false, false] },
  { ...NONE, approved: [false, true, false, false] },
  { ...NONE, approved: [true, true, true, true] },
  { ...NONE, approved: [true, true, true, true], resolved: [true, false, false, false] },
  { ...NONE, approved: [true, true, true, true], resolved: [false, true, false, false] },
  { ...NONE, approved: [true, true, true, true], sourceEnded: ['failure', 'exclusion'] },
  { ...NONE, approved: [true, true, true, true], withdrawn: [true, false, true, false] },
  { ...NONE, approved: [true, true, false, false], resolved: [true, true, false, false] },
  { ...NONE, approved: [true, true, true, true], devDerived: [true, true], devRun: [true, true] },
  { ...NONE, readable: false, approved: [true, true, true, true] },
];

test('Property 53: the hold is evaluated per variant and the candidate count counts derived files', () => {
  fc.assert(
    fc.property(holdArb, (spec) => {
      const state = buildHold(spec);
      assert.deepEqual(decisionHoldPending(state), holdOracle(spec), JSON.stringify(spec));
      assert.equal(decisionHold(state), holdOracle(spec).length > 0);
      // Count: distinct Workers AI Combinations with a ledger entry, an attempted Dev_Run or a derived file.
      const oracle = new Set<string>();
      PAIRS.forEach((p, k) => {
        if (spec.resolved[2 * k] || spec.devRun[k]) oracle.add(p.single.id);
        if (spec.resolved[2 * k + 1] || spec.devDerived[k]) oracle.add(p.perm.id);
      });
      assert.deepEqual(phase2Candidates(state), [...oracle].sort());
      assert.equal(phase2CandidatesTried(state), oracle.size);
      // phase-status lists every variant by Combination ID.
      const lines = formatDecisionModels(state).join('\n');
      for (const c of VARIANTS) assert.ok(lines.includes(`  ${c.id}  `), c.id);
      assert.ok(lines.endsWith(decisionHold(state) ? 'runtime decision: ON HOLD (R19.17)' : 'runtime decision: not on hold'));
    }),
    { numRuns: 300, examples: HOLD_EXAMPLES.map((h) => [h] as [HoldSpec]) },
  );
});

test('Property 53 (pinned): five candidates when gemma, both single variants and both derived files each have a Results file', () => {
  const events = [...entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z'), ...entryEvents(GEMMA, 'W-1', 'DS', '2026-11-09T01:00:00Z')];
  const state = baseState({
    combinations: COMBOS,
    entries: deriveEntries(events),
    devRuns: [DM_A, DM_B].map((c, i) => ({ run_id: `d${i}`, combination: c.id, task_subset: 'D', template_hashes: {}, attempted: true })),
    derived: [PA_A, PA_B].map((c, i) => ({ run_id: `x${i}`, combination: c.id, split: 'dev' as const, template_hashes: {} })),
  });
  assert.equal(phase2CandidatesTried(state), 5);
  assert.deepEqual(phase2Candidates(state), [DM_B.id, PA_B.id, DM_A.id, PA_A.id, GEMMA.id].sort());
});
