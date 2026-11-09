import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import type { Approval } from '../../src/approvals.ts';
import { allowDecisionModel, decisionHold } from '../../src/phase.ts';
import { deriveEntries } from '../../src/ledger.ts';
import { baseState, BROWSER, DM_A, DM_B, GEMMA, devRunInfo, dm, entryEvents, exclusion, failure, smokeRec, withdrawal, phase1Entries } from './decision-gate.helpers.ts';

// Feature: llm-probe, Property 47: A Decision_Model step needs its own approval, its own order and Task_Type D
// **Validates: Requirements 19.1, 19.4, 19.5, 19.17, 18.1, 18.3, 18.4, 11.8, 11.20**

const HASH = 'h-current';

// ---------------------------------------------------------------- generators

interface Spec {
  ended: boolean;
  approved: boolean;
  /** decision_model entries: combo index (0 = A, 1 = B), step, max. */
  entries: { combo: 0 | 1; step: 'dev' | 'locked'; max: number }[];
  /** Indexes of the entries above that a withdrawal names. */
  withdrawn: number[];
  /** Noise entries that cover nothing (R19.4). */
  noise: ('phase2' | 'branchB-dev' | 'branchB-locked' | 'other-dev')[];
  smoke: { check: 'ok' | 'bad_shape' | 'unparsable'; declared: 'system_one' | 'chat'; combo: 0 | 1 }[];
  devRuns: { combo: 0 | 1; hash: string }[];
  step: 'smoke' | 'dev' | 'locked';
  subset: 'D' | 'S' | 'DS';
  count: number;
  comboIdx: 0 | 1;
}

const randomSpecArb: fc.Arbitrary<Spec> = fc.record({
  ended: fc.boolean(),
  approved: fc.constantFrom(true, true, true, false),
  entries: fc.array(fc.record({ combo: fc.constantFrom<0 | 1>(0, 1), step: fc.constantFrom<'dev' | 'locked'>('dev', 'locked'), max: fc.constantFrom(10, 74, 236) }), { maxLength: 6 }),
  withdrawn: fc.array(fc.nat(5), { maxLength: 3 }),
  noise: fc.array(fc.constantFrom('phase2' as const, 'branchB-dev' as const, 'branchB-locked' as const, 'other-dev' as const), { maxLength: 4 }),
  smoke: fc.array(fc.record({ check: fc.constantFrom<'ok' | 'bad_shape' | 'unparsable'>('ok', 'ok', 'ok', 'bad_shape', 'unparsable'), declared: fc.constantFrom<'system_one' | 'chat'>('system_one', 'system_one', 'chat'), combo: fc.constantFrom<0 | 1>(0, 1) }), { maxLength: 4 }),
  devRuns: fc.array(fc.record({ combo: fc.constantFrom<0 | 1>(0, 1), hash: fc.constantFrom(HASH, HASH, 'h-old') }), { maxLength: 3 }),
  step: fc.constantFrom('smoke' as const, 'dev' as const, 'locked' as const),
  subset: fc.constantFrom('D' as const, 'D' as const, 'D' as const, 'S' as const, 'DS' as const),
  count: fc.constantFrom(1, 10, 74, 75, 236, 237),
  comboIdx: fc.constantFrom<0 | 1>(0, 1),
});

const combos = [DM_A, DM_B] as const;

/** Mostly-allowed specs with at most one thing broken, so that every condition of the property is the deciding one often. */
type Mutation = 'none' | 'phase1' | 'unreadable' | 'withdraw' | 'count' | 'no-smoke' | 'bad-smoke' | 'chat-smoke' | 'old-hash' | 'no-devrun' | 'subset' | 'other-step' | 'other-combo';
const nearlyGoodArb: fc.Arbitrary<Spec> = fc
  .tuple(randomSpecArb, fc.constantFrom<'dev' | 'locked'>('dev', 'locked'), fc.constantFrom<0 | 1>(0, 1), fc.constantFrom<Mutation>('none', 'none', 'phase1', 'unreadable', 'withdraw', 'count', 'no-smoke', 'bad-smoke', 'chat-smoke', 'old-hash', 'no-devrun', 'subset', 'other-step', 'other-combo'))
  .map(([r, step, comboIdx, m]) => {
    const other = comboIdx === 0 ? 1 : 0;
    const sp: Spec = {
      ...r,
      ended: m !== 'phase1',
      approved: m !== 'unreadable',
      step,
      comboIdx,
      subset: m === 'subset' ? 'S' : 'D',
      count: m === 'count' ? 237 : 74,
      entries: [{ combo: m === 'other-combo' ? other : comboIdx, step: m === 'other-step' ? (step === 'dev' ? 'locked' : 'dev') : step, max: 236 }, ...r.entries],
      withdrawn: m === 'withdraw' ? [0] : [],
      smoke: [...r.smoke, ...(m === 'no-smoke' ? [] : [{ check: m === 'bad-smoke' ? ('bad_shape' as const) : ('ok' as const), declared: m === 'chat-smoke' ? ('chat' as const) : ('system_one' as const), combo: comboIdx }])],
      devRuns: [...r.devRuns, ...(m === 'no-devrun' ? [] : [{ combo: comboIdx, hash: m === 'old-hash' ? 'h-old' : HASH }])],
    };
    if (m === 'no-smoke') sp.smoke = sp.smoke.filter((x) => x.combo !== comboIdx);
    if (m === 'no-devrun') sp.devRuns = sp.devRuns.filter((x) => x.combo !== comboIdx);
    return sp;
  });
const specArb: fc.Arbitrary<Spec> = fc.oneof({ weight: 3, arbitrary: nearlyGoodArb }, { weight: 1, arbitrary: randomSpecArb });

function build(sp: Spec) {
  const list: Approval[] = [];
  sp.entries.forEach((e, i) => list.push(dm(`DM-${i}`, combos[e.combo], e.step, e.max)));
  sp.noise.forEach((n, i) => {
    if (n === 'phase2') list.push({ id: `N-${i}`, kind: 'phase2', branch: 'B', model: DM_A.model_id, task_subset: 'DS', approved_on: '2026-11-08', note: '' });
    else if (n === 'other-dev') list.push({ id: `N-${i}`, kind: 'dev', combination: GEMMA.id, task_subset: 'DS', max_requests: 999, phase2: 'N-0', approved_on: '2026-11-08', note: '' });
    else list.push({ id: `N-${i}`, kind: n === 'branchB-dev' ? 'dev' : 'locked', combination: combos[i % 2]?.id, task_subset: 'D', max_requests: 999, phase2: 'P2-001', approved_on: '2026-11-08', note: '' });
  });
  const real = sp.entries.map((_, i) => `DM-${i}`);
  const wd = [...new Set(sp.withdrawn.map((i) => real[i]).filter((x): x is string => x !== undefined))];
  if (wd.length > 0) list.push(withdrawal('W-1', ...wd));
  const state = baseState({
    entries: phase1Entries(sp.ended),
    approvals: sp.approved ? { approved: true, approvals: list } : { approved: false, reason: 'uncommitted' },
    smoke: sp.smoke.map((s) => smokeRec(combos[s.combo], s.check, s.declared)),
    devRuns: sp.devRuns.map((d, i) => devRunInfo(combos[d.combo], `dev-${i}`, d.hash)),
  });
  return { state, list, withdrawnIds: new Set(wd) };
}

function expectAllowed(sp: Spec): boolean {
  const { state, list, withdrawnIds } = build(sp);
  if (sp.subset !== 'D') return false;
  if (sp.step === 'smoke') return true;
  const c = combos[sp.comboIdx];
  if (!sp.ended || !state.approvals.approved) return false;
  const mine = list.filter((a) => a.kind === 'decision_model' && a.combination === c.id && a.step === sp.step && !withdrawnIds.has(a.id));
  if (mine.length === 0) return false;
  const smokes = state.smoke.filter((s) => s['combination'] === c.id);
  const newest = smokes[smokes.length - 1];
  if (newest === undefined || newest['shape_check'] !== 'ok' || newest['declared_shape'] !== 'system_one') return false;
  if (sp.step === 'locked') {
    const runs = (state.devRuns ?? []).filter((d) => d.combination === c.id);
    const last = runs[runs.length - 1];
    if (last === undefined || last.template_hashes['decision'] !== HASH) return false;
  }
  return mine.some((a) => sp.count <= (a.max_requests ?? 0));
}

// ---------------------------------------------------------------- the properties

test('Property 47: the gate allows a Decision_Model step exactly when the design says (subset, Phase_1, own approval, order, count)', () => {
  let allowedSteps = 0;
  fc.assert(
    fc.property(specArb, (sp) => {
      const { state } = build(sp);
      const r = allowDecisionModel(sp.step, combos[sp.comboIdx], sp.subset, state, { count: sp.count, mappingHash: HASH });
      assert.equal(r.outcome === 'allowed', expectAllowed(sp), JSON.stringify({ sp, r }));
      if (r.outcome === 'allowed' && sp.step !== 'smoke') allowedSteps += 1;
      if (sp.subset !== 'D') assert.equal(r.outcome, 'wrong_subset');
      if (sp.step === 'smoke' && sp.subset === 'D') assert.equal(r.outcome === 'allowed' && r.approval, null);
    }),
    { numRuns: 400 },
  );
  assert.ok(allowedSteps > 0, 'the generator never produced an allowed dev or locked step');
});

test('Property 47: a subset containing S reads nothing from the state (it writes nothing either: the gate is pure)', () => {
  const trap = new Proxy({}, { get: () => { throw new Error('state was read'); } }) as never;
  fc.assert(
    fc.property(fc.constantFrom('S' as const, 'DS' as const), fc.constantFrom('smoke' as const, 'dev' as const, 'locked' as const), fc.constantFrom(DM_A, DM_B), (subset, step, c) => {
      const r = allowDecisionModel(step, c, subset, trap, { count: 1, mappingHash: HASH });
      assert.equal(r.outcome, 'wrong_subset');
      assert.match(r.reason, new RegExp(`${c.id} accepts Task_Type D only; requested ${subset}`));
    }),
  );
});

test('Property 47: an approval of one Combination or one step never allows another; branch-B and phase2 entries allow nothing', () => {
  fc.assert(
    fc.property(fc.constantFrom<'dev' | 'locked'>('dev', 'locked'), fc.constantFrom(DM_A, DM_B), fc.boolean(), (step, c, withdrawIt) => {
      const other = c === DM_A ? DM_B : DM_A;
      const otherStep = step === 'dev' ? 'locked' : 'dev';
      const list: Approval[] = [dm('DM-1', other, step, 500), dm('DM-2', c, otherStep, 500), { id: 'P2-001', kind: 'phase2', branch: 'B', model: c.model_id, task_subset: 'DS', approved_on: '2026-11-08', note: '' }];
      if (withdrawIt) list.push(withdrawal('W-1', 'DM-1'));
      const state = baseState({ approvals: { approved: true, approvals: list }, smoke: [smokeRec(c, 'ok')], devRuns: [devRunInfo(c, 'dev-1', HASH)] });
      assert.equal(allowDecisionModel(step, c, 'D', state, { count: 1, mappingHash: HASH }).outcome, 'refused');
    }),
  );
});

test('Property 47: decisionHold is exactly "an unwithdrawn decision_model entry and no complete D, locked failure, or Exclusion_Record"', () => {
  const holdArb = fc.record({
    hasEntry: fc.boolean(),
    withdrawn: fc.boolean(),
    completeD: fc.constantFrom<'none' | 'D' | 'S' | 'DS' | 'incomplete'>('none', 'D', 'S', 'DS', 'incomplete'),
    fail: fc.constantFrom<'none' | 'locked' | 'locked-transient' | 'dev'>('none', 'locked', 'locked-transient', 'dev'),
    excl: fc.boolean(),
    otherModelEntry: fc.boolean(),
  });
  fc.assert(
    fc.property(holdArb, (h) => {
      const list: Approval[] = [];
      if (h.hasEntry) list.push(dm('DM-1', DM_A, 'dev', 74));
      if (h.hasEntry && h.withdrawn) list.push(withdrawal('W-1', 'DM-1'));
      const events = h.completeD === 'none' ? [] : entryEvents(DM_A, 'L-9', h.completeD === 'incomplete' ? 'D' : h.completeD, '2026-11-12T09:00:00Z', h.completeD !== 'incomplete');
      const state = baseState({
        approvals: { approved: true, approvals: list },
        entries: deriveEntries([...entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z'), ...events]),
        failures: h.fail === 'none' ? [] : [failure(DM_A, h.fail === 'dev' ? 'dev' : 'locked', h.fail === 'locked-transient')],
        exclusions: h.excl ? [exclusion(DM_A)] : [],
      });
      const expected = h.hasEntry && !h.withdrawn && !['D', 'DS'].includes(h.completeD) && h.fail !== 'locked' && !h.excl;
      assert.equal(decisionHold(state), expected, JSON.stringify(h));
    }),
    { numRuns: 300 },
  );
});
