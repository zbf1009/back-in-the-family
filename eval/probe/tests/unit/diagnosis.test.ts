// Request-level D baseline and position diagnosis (llm-probe task 20.6). Synthetic cards only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { diagnoseDecisions, diagnosisLines, expectedCount, shownIndex, sharePercent, type DecisionCardFacts } from '../../src/diagnosis.ts';
import { SCHEMA, type GradeLine } from '../../src/results.ts';

const card = (id: string, n: number, acceptableCount: number, scored = true): DecisionCardFacts => ({
  id,
  scored,
  void: false,
  optionIds: Array.from({ length: n }, (_, i) => `o${i}`),
  acceptableCount,
});

const grade = (cardId: string, permutation: string, option: string | null, acceptable = false): GradeLine => ({
  schema: SCHEMA.grade,
  card_id: cardId,
  permutation,
  verdict: {},
  grade: { acceptable, illegal: option === null, severe: false, severe_conditions: [] },
  identity: option === null ? { kind: 'invalid' } : { kind: 'option', option },
  late_grade: null,
});

test('shownIndex follows the renderer: reversed and left rotations', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => shownIndex('reversed', i, 4)), [3, 2, 1, 0]);
  // rotated_1 of [a,b,c,d] is [b,c,d,a]: a (0) is shown last, b (1) first.
  assert.deepEqual([0, 1, 2, 3].map((i) => shownIndex('rotated_1', i, 4)), [3, 0, 1, 2]);
  assert.deepEqual([0, 1].map((i) => shownIndex('rotated_2', i, 2)), [0, 1]);
  assert.throws(() => shownIndex('nonsense', 0, 2));
});

test('random baseline is computed from the cards per request, with and without Sanity_Cards', () => {
  const cards = [card('A', 4, 2), card('B', 2, 1), card('S1', 4, 1, false)];
  const grades = [
    ...['base', 'reversed', 'rotated_1', 'rotated_2'].map((p) => grade('A', p, 'o0', true)),
    ...['base', 'reversed'].map((p) => grade('B', p, 'o1')),
    grade('S1', 'base', 'o0', true),
  ];
  const d = diagnoseDecisions(cards, grades);
  assert.equal(d.requests, 7);
  assert.equal(d.acceptable, 5);
  // 4 * 1/2 + 2 * 1/2 + 1 * 1/4 = 3.25 of 7
  assert.equal(expectedCount(d.randomBaseline), '3.3');
  assert.equal(sharePercent(d.randomBaseline), '46.4%');
  assert.equal(d.scoredRequests, 6);
  assert.equal(sharePercent(d.scoredRandomBaseline), '50.0%');
});

test('position and shuffle counts separate position preference from content', () => {
  const cards = [card('P', 4, 1), card('Q', 4, 1)];
  // P: always the first shown position (so the option changes with the order).
  // Q: always option o2 (so the shown position changes with the order).
  const perms = ['base', 'reversed', 'rotated_1', 'rotated_2'];
  const shownToOrig = (perm: string, shown: number): number => [0, 1, 2, 3].find((o) => shownIndex(perm, o, 4) === shown) as number;
  const grades = perms.flatMap((p) => [grade('P', p, `o${shownToOrig(p, 0)}`), grade('Q', p, 'o2')]);
  const d = diagnoseDecisions(cards, grades);
  assert.equal(d.cardsWithPicks, 2);
  assert.equal(d.stableByShownPosition, 1);
  assert.equal(d.stableByOption, 1);
  assert.equal(d.flipComparisons, 6);
  assert.equal(d.flips, 3); // only P flips: o0 -> o3, o1, o2 against its base pick
  const row = d.positions[0];
  assert.equal(row?.picks, 8);
  assert.deepEqual(row?.byShown, [5, 2, 1, 0]);
  assert.deepEqual(row?.byOriginal, [1, 1, 5, 1]);
});

test('Illegal requests count as requests but not as picks', () => {
  const d = diagnoseDecisions([card('A', 2, 1)], [grade('A', 'base', null), grade('A', 'reversed', 'o1', true)]);
  assert.equal(d.requests, 2);
  assert.equal(d.illegal, 1);
  assert.equal(d.positions[0]?.picks, 1);
  assert.equal(d.cardsWithPicks, 0);
});

test('emitted lines name the baseline, the shuffle counts and the position tables', () => {
  const d = diagnoseDecisions([card('A', 4, 2)], [grade('A', 'base', 'o0', true), grade('A', 'reversed', 'o3', true)]);
  const text = diagnosisLines(d, 'Dev_Run').join('\n');
  assert.match(text, /acceptable 2\/2 \(100\.0%\) against a random baseline of 50\.0%/);
  assert.match(text, /1 of 1 comparisons/);
  assert.match(text, /4-option cards, 2 valid picks: by original position 1 \/ 0 \/ 0 \/ 1; by shown position 2 \/ 0 \/ 0 \/ 0/);
});

test('property: the baseline stays between 0 and 100 percent and the position tables add up to the picks', () => {
  const permArb = fc.constantFrom('base', 'reversed', 'rotated_1', 'rotated_2');
  fc.assert(
    fc.property(
      fc.array(fc.record({ n: fc.integer({ min: 2, max: 5 }), acc: fc.integer({ min: 1, max: 4 }) }), { minLength: 1, maxLength: 5 }),
      fc.array(fc.tuple(fc.nat(4), permArb, fc.nat(5)), { maxLength: 30 }),
      (specs, picks) => {
        const cards = specs.map((s, i) => card(`C${i}`, s.n, Math.min(s.acc, s.n - 1)));
        const grades = picks.map(([ci, p, o]) => {
          const c = cards[ci % cards.length] as DecisionCardFacts;
          return grade(c.id, p, o >= c.optionIds.length ? null : `o${o}`);
        });
        const d = diagnoseDecisions(cards, grades);
        const rb = d.randomBaseline;
        if (rb !== null) assert.ok(rb.num >= 0 && rb.num <= rb.den);
        const total = d.positions.reduce((a, r) => a + r.picks, 0);
        assert.equal(total + d.illegal, d.requests);
        for (const r of d.positions) {
          assert.equal(r.byOriginal.reduce((a, b) => a + b, 0), r.picks);
          assert.equal(r.byShown.reduce((a, b) => a + b, 0), r.picks);
        }
      },
    ),
    { numRuns: 200 },
  );
});
