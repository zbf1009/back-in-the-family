import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CARDS_DIR, loadCards } from '../../src/cards.ts';
import { computeMetrics, metricCardFromLoaded, randomBaseline, type MetricCard } from '../../src/metrics.ts';
import { SCHEMA, type ContrastLine, type GradeLine, type JsonValue, type Outcome, type ResultRecord } from '../../src/results.ts';

// Hand-computed Metrics example (llm-probe task 9.9; requirement 13.11).
//
// World (decision task; the synthesis task has no cards at all):
//   a1 group g1, 1 of 3 options acceptable, pair PA role a
//   a2 group g1, 1 of 3,                    pair PA role b
//   a3 group g2, 2 of 5,                    pair PB role a
//   a4 group g2, 1 of 2,                    pair PB role b
//   v1 Void_Card, s1 Sanity_Card (both outside every Metric)
// Base results:
//   a1 acceptable (option a)            a2 acceptable (option b)
//   a3 Timeout, Late_Answer acceptable  (base grade: Illegal, identity invalid)
//   a4 text, severe, not acceptable     (option b)
// Other Permutations run: a1 reversed (a) and rotated (a); a2 reversed (c); a3 reversed
// (Illegal text, identity invalid); a4 reversed (b, severe). That is 5 permutations.

function card(id: string, over: Partial<MetricCard> = {}): MetricCard {
  return { id, task: 'decision', scored: true, void: false, scenarioGroup: `g-${id}`, pairId: null, role: null, acceptableCount: 1, optionCount: 2, ...over };
}

function rec(cardId: string, permutation: string, outcome: Outcome, late: ResultRecord['late'] = null): ResultRecord {
  return {
    schema: SCHEMA.result,
    run_id: 'r',
    split: 'dev',
    card_id: cardId,
    permutation,
    outcome,
    latency_ms: 100,
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
const ILLEGAL = { acceptable: false, severe: false, illegal: true, severe_conditions: [] };
const SEVERE = { acceptable: false, severe: true, illegal: false, severe_conditions: [] };
const opt = (o: string): JsonValue => ({ kind: 'option', option: o });
const INVALID: JsonValue = { kind: 'invalid' };

function gl(cardId: string, permutation: string, grade: JsonValue, identity: JsonValue, late: JsonValue | null = null): GradeLine {
  return { schema: SCHEMA.grade, card_id: cardId, permutation, verdict: null, grade, identity, late_grade: late };
}
const contrast = (pairId: string, consistent: boolean): ContrastLine => ({
  schema: SCHEMA.contrast,
  pair_id: pairId,
  contrast: { a_in_expected: true, b_in_expected: true, consistent },
});

const cards: MetricCard[] = [
  card('a1', { scenarioGroup: 'g1', acceptableCount: 1, optionCount: 3, pairId: 'PA', role: 'a' }),
  card('a2', { scenarioGroup: 'g1', acceptableCount: 1, optionCount: 3, pairId: 'PA', role: 'b' }),
  card('a3', { scenarioGroup: 'g2', acceptableCount: 2, optionCount: 5, pairId: 'PB', role: 'a' }),
  card('a4', { scenarioGroup: 'g2', acceptableCount: 1, optionCount: 2, pairId: 'PB', role: 'b' }),
  card('v1', { void: true, acceptableCount: 1, optionCount: 1 }),
  card('s1', { scored: false }),
];
const records: ResultRecord[] = [
  rec('a1', 'base', text()),
  rec('a1', 'reversed', text()),
  rec('a1', 'rotated_1', text()),
  rec('a2', 'base', text()),
  rec('a2', 'reversed', text()),
  rec('a3', 'base', { kind: 'timeout' }, { kind: 'late', text: '{"option":"x"}', latency_ms: 12000 }),
  rec('a3', 'reversed', text()),
  rec('a4', 'base', text()),
  rec('a4', 'reversed', text()),
  rec('v1', 'base', text()),
  rec('s1', 'base', text()),
];
const grades: GradeLine[] = [
  gl('a1', 'base', OK, opt('a')),
  gl('a1', 'reversed', OK, opt('a')),
  gl('a1', 'rotated_1', OK, opt('a')),
  gl('a2', 'base', OK, opt('b')),
  gl('a2', 'reversed', OK, opt('c')),
  gl('a3', 'base', ILLEGAL, INVALID, OK),
  gl('a3', 'reversed', ILLEGAL, INVALID),
  gl('a4', 'base', SEVERE, opt('b')),
  gl('a4', 'reversed', SEVERE, opt('b')),
  gl('v1', 'base', OK, opt('a')),
  gl('s1', 'base', OK, opt('a')),
];
// PB's line says consistent, but a3's base is Illegal, so the pair must not count as consistent.
const contrasts = [contrast('PA', true), contrast('PB', true)];

test('decision Metrics match the hand computation', () => {
  const m = computeMetrics({ cards, records, grades, contrasts });
  const d = m.tasks[0]!;
  assert.equal(d.task, 'decision');
  // Counted cards: a1..a4 (v1 void, s1 Sanity_Card are out) = 4.
  assert.equal(d.cards, 4);
  // Acceptable: a1, a2 = 2 of 4 = 50% < 80% -> fail. The Timeout card stays in the denominator.
  assert.deepEqual([d.acceptable.num, d.acceptable.den, d.acceptable.verdict], [2, 4, 'fail']);
  // Severe: a4 only = 1, within the limit of 1 -> pass.
  assert.deepEqual([d.severe.count, d.severe.den, d.severe.verdict], [1, 4, 'pass']);
  // Illegal: a3 (Timeout counts as Illegal) = 1 of 4, no verdict field.
  assert.deepEqual([d.illegal.num, d.illegal.den], [1, 4]);
  // Flip: 5 non-base Permutations run; only a2 reversed (c vs b) flips. a3 reversed is
  // invalid against an invalid base, so no flip. 1 of 5 = 20% > 5% -> fail.
  assert.deepEqual([d.flip.num, d.flip.den, d.flip.verdict], [1, 5, 'fail']);
  // Contrast: PA consistent; PB not (a3 base Illegal). 1 of 2 = 50% < 80% -> fail.
  assert.deepEqual([d.contrast.num, d.contrast.den, d.contrast.verdict], [1, 2, 'fail']);
  assert.deepEqual(d.pairs.map((p) => [p.pairId, p.consistent]), [['PA', true], ['PB', false]]);
  assert.equal(d.passes, false);
  assert.equal(d.usableForMark, true);
  // Random_Baseline: (1/3 + 1/3 + 2/5 + 1/2) / 4 = (47/30) / 4 = 47/120.
  assert.deepEqual(d.randomBaseline, { num: 47, den: 120 });
  assert.deepEqual(randomBaseline(cards), { num: 47, den: 120 });
  // Without timeout: a3's Late_Answer is acceptable -> 3 of 4, Illegal 0, 1 replaced.
  assert.deepEqual([d.withoutTimeout.acceptable.num, d.withoutTimeout.acceptable.den], [3, 4]);
  assert.deepEqual([d.withoutTimeout.illegal.num, d.withoutTimeout.replaced], [0, 1]);
});

test('Void_Card and Sanity_Card are listed apart; the Sanity_Card is reported on its own', () => {
  const m = computeMetrics({ cards, records, grades, contrasts });
  assert.deepEqual(m.excluded, [
    { id: 'v1', reason: 'void' },
    { id: 's1', reason: 'sanity' },
  ]);
  assert.deepEqual(m.sanity, [{ cardId: 's1', task: 'decision', outcome: 'text', grade: { acceptable: true, severe: false, illegal: false } }]);
  assert.equal(m.combinationFailed, false);
});

test('a task with a zero denominator is not computable and not passing', () => {
  const s = computeMetrics({ cards, records, grades, contrasts }).tasks[1]!;
  assert.equal(s.task, 'synthesis');
  assert.equal(s.cards, 0);
  for (const v of [s.acceptable.verdict, s.severe.verdict, s.flip.verdict, s.contrast.verdict]) {
    assert.equal(v, 'not_computable');
  }
  assert.equal(s.randomBaseline, null);
  assert.equal(s.passes, false);
});

// Dev Random_Baseline (llm-probe task 9.11; requirement 13.6). Only the dev split is loaded.
test('the dev Random_Baseline is 5/9, which rounds to the 55.6% recorded in LOCK.md', () => {
  const loaded = loadCards({ cardsDir: DEFAULT_CARDS_DIR, splits: ['dev'] });
  const f = randomBaseline(loaded.cards.dev.map(metricCardFromLoaded));
  assert.deepEqual(f, { num: 5, den: 9 });
  const pct = (Math.round((f!.num * 1000) / f!.den) / 10).toFixed(1);
  assert.equal(pct, '55.6');
  const lock = readFileSync(path.join(DEFAULT_CARDS_DIR, 'LOCK.md'), 'utf8');
  const section = lock.slice(lock.indexOf('## Random-pick baseline'));
  assert.match(section, /55\.6% \(dev\)/);
});
