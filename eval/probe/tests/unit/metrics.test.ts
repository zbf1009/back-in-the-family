import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeMetrics, randomBaseline, type MetricCard } from '../../src/metrics.ts';
import { SCHEMA, type ContrastLine, type GradeLine, type JsonValue, type Outcome, type ResultRecord } from '../../src/results.ts';

// Smoke examples only; the detailed examples and property tests are tasks 9.3 to 9.11.

function card(id: string, over: Partial<MetricCard> = {}): MetricCard {
  return {
    id,
    task: 'decision',
    scored: true,
    void: false,
    scenarioGroup: `g-${id}`,
    pairId: null,
    role: null,
    acceptableCount: 1,
    optionCount: 2,
    ...over,
  };
}

function rec(cardId: string, permutation: string, outcome: Outcome, late: ResultRecord['late'] = null): ResultRecord {
  return {
    schema: SCHEMA.result,
    run_id: 'r',
    split: 'dev',
    card_id: cardId,
    permutation,
    outcome,
    latency_ms: outcome.kind === 'not_run' || outcome.kind === 'engine_fault' ? null : 100,
    timeout_ms: 10000,
    requested_at: '2026-11-06T10:00:00.000Z',
    template_hash: 'h',
    fingerprint_id: 'fp',
    usage: null,
    late,
    source: 'node',
  };
}

const text = (): Outcome => ({ kind: 'text', text: '{"option":"x"}' });

const OK = { acceptable: true, severe: false, illegal: false, severe_conditions: [] };
const BAD = { acceptable: false, severe: false, illegal: true, severe_conditions: [] };
const opt = (o: string): JsonValue => ({ kind: 'option', option: o });
const INVALID: JsonValue = { kind: 'invalid' };

function gradeLine(cardId: string, permutation: string, grade: JsonValue, identity: JsonValue, late: JsonValue | null = null): GradeLine {
  return { schema: SCHEMA.grade, card_id: cardId, permutation, verdict: null, grade, identity, late_grade: late };
}
const contrast = (pairId: string, consistent: boolean): ContrastLine => ({
  schema: SCHEMA.contrast,
  pair_id: pairId,
  contrast: { a_in_expected: true, b_in_expected: true, consistent },
});

function fixture() {
  const cards: MetricCard[] = [
    card('d1', { acceptableCount: 1, optionCount: 2, pairId: 'P1', role: 'a' }),
    card('d2', { acceptableCount: 1, optionCount: 4, pairId: 'P1', role: 'b' }),
    card('d3', { acceptableCount: 2, optionCount: 4, pairId: 'P2', role: 'a' }),
    card('d4', { acceptableCount: 1, optionCount: 2, pairId: 'P2', role: 'b' }),
    card('d5', { acceptableCount: 1, optionCount: 5 }),
    card('d6', { void: true, acceptableCount: 1, optionCount: 1 }),
    card('z1', { scored: false }),
  ];
  const records: ResultRecord[] = [
    rec('d1', 'base', text()),
    rec('d1', 'reversed', text()),
    rec('d2', 'base', text()),
    rec('d2', 'reversed', { kind: 'timeout' }, { kind: 'none', reason: 'idle_cap' }),
    rec('d3', 'base', text()),
    rec('d3', 'reversed', { kind: 'not_run', reason: 'rebuild_failed', detail: '' }),
    rec('d4', 'base', text()),
    rec('d5', 'base', { kind: 'timeout' }, { kind: 'late', text: '{"option":"x"}', latency_ms: 12000 }),
    rec('d5', 'rotated_1', { kind: 'engine_fault', code: 'runtime_stuck', detail: '' }),
    rec('d6', 'base', text()),
    rec('z1', 'base', text()),
  ];
  const grades: GradeLine[] = [
    gradeLine('d1', 'base', OK, opt('a')),
    gradeLine('d1', 'reversed', OK, opt('a')),
    gradeLine('d2', 'base', OK, opt('a')),
    gradeLine('d2', 'reversed', BAD, INVALID),
    gradeLine('d3', 'base', OK, opt('a')),
    gradeLine('d4', 'base', OK, opt('b')),
    gradeLine('d5', 'base', BAD, INVALID, OK),
    gradeLine('d6', 'base', OK, opt('a')),
    gradeLine('z1', 'base', OK, opt('a')),
  ];
  return { cards, records, grades, contrasts: [contrast('P1', true), contrast('P2', true)] };
}

test('Random_Baseline is an exact fraction of the non-void scored D cards only', () => {
  // (1/2 + 1/4 + 2/4 + 1/2 + 1/5) / 5 = 39/100; the void card and the Sanity_Card do not count.
  assert.deepEqual(randomBaseline(fixture().cards), { num: 39, den: 100 });
  assert.equal(randomBaseline([card('s', { task: 'synthesis' })]), null);
});

test('acceptable rate is exactly 80% (inclusive pass) and keeps the full denominator', () => {
  const m = computeMetrics({ ...fixture(), tasks: ['decision'] });
  const d = m.tasks[0]!;
  assert.equal(d.cards, 5);
  assert.deepEqual([d.acceptable.num, d.acceptable.den, d.acceptable.verdict], [4, 5, 'pass']);
  // The Timeout counts as Illegal, not acceptable, not severe.
  assert.deepEqual([d.illegal.num, d.illegal.den], [1, 5]);
  assert.deepEqual([d.severe.count, d.severe.verdict], [0, 'pass']);
});

test('quality without timeout grades the Late_Answer over the same denominator', () => {
  const d = computeMetrics({ ...fixture(), tasks: ['decision'] }).tasks[0]!;
  assert.deepEqual([d.withoutTimeout.acceptable.num, d.withoutTimeout.acceptable.den], [5, 5]);
  assert.equal(d.withoutTimeout.illegal.num, 0);
  assert.equal(d.withoutTimeout.replaced, 1);
});

test('flip rate counts an Illegal permutation unless the base is invalid; faults are outside numerators', () => {
  const d = computeMetrics({ ...fixture(), tasks: ['decision'] }).tasks[0]!;
  // d1 reversed same identity, d2 reversed Illegal against an option base: 1 flip in 2 permutations.
  // The rebuild_failed and engine_fault records are not permutations run.
  assert.deepEqual([d.flip.num, d.flip.den, d.flip.verdict], [1, 2, 'fail']);
  assert.deepEqual(d.faults, { engineFault: 1, rebuildFailed: 1 });
  assert.equal(d.usableForMark, false);
  assert.equal(d.passes, false);
});

test('contrast consistency reports both counts; an Illegal base counts as not consistent', () => {
  const f = fixture();
  const d = computeMetrics({ ...f, tasks: ['decision'] }).tasks[0]!;
  assert.deepEqual([d.contrast.num, d.contrast.den, d.contrast.verdict], [2, 2, 'pass']);
  // Make d4's base Illegal: pair P2 is no longer consistent even though its contrast line says so.
  const grades = f.grades.map((g) => (g.card_id === 'd4' ? gradeLine('d4', 'base', BAD, INVALID) : g));
  const d2 = computeMetrics({ ...f, grades, tasks: ['decision'] }).tasks[0]!;
  assert.deepEqual([d2.contrast.num, d2.contrast.den], [1, 2]);
});

test('zero denominator is not computable and not passing', () => {
  const s = computeMetrics(fixture()).tasks[1]!;
  assert.equal(s.task, 'synthesis');
  assert.equal(s.cards, 0);
  assert.equal(s.acceptable.verdict, 'not_computable');
  assert.equal(s.acceptable.rate, null);
  assert.equal(s.passes, false);
});

test('void and Sanity cards are listed apart and enter no Metric', () => {
  const m = computeMetrics({ ...fixture(), tasks: ['decision'] });
  assert.deepEqual(m.excluded, [
    { id: 'd6', reason: 'void' },
    { id: 'z1', reason: 'sanity' },
  ]);
  assert.deepEqual(m.sanity, [{ cardId: 'z1', task: 'decision', outcome: 'text', grade: { acceptable: true, severe: false, illegal: false } }]);
  assert.equal(m.combinationFailed, true);
});

test('a severe grade on a non-base Permutation stays out of the severe count and shows in severeOtherPermutations', () => {
  const SEV = { acceptable: true, severe: true, illegal: false, severe_conditions: ['reversed_direction'] };
  const m = computeMetrics({
    cards: [card('s1', { task: 'synthesis', acceptableCount: null, optionCount: null })],
    records: [rec('s1', 'base', text()), rec('s1', 'reversed', text())],
    grades: [gradeLine('s1', 'base', OK, opt('a')), gradeLine('s1', 'reversed', SEV, opt('a'))],
    contrasts: [],
    tasks: ['synthesis'],
  });
  const t = m.tasks[0];
  assert.equal(t?.severe.count, 0);
  assert.equal(t?.severeOtherPermutations, 1);
  assert.equal(t?.flip.den, 1);
});
