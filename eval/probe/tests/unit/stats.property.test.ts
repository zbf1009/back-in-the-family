// Property 21: Intervals are well formed and reproducible (llm-probe task 9.6).
// **Validates: Requirements 13.7, 13.8**
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import type { PairResult, PerCard } from '../../src/metrics.ts';
import {
  BOOTSTRAP_SEED,
  bootstrapUnits,
  clusterBootstrapAcceptable,
  clusterBootstrapIllegal,
  compareFrac,
  pairBootstrap,
  wilsonInterval,
  type BootstrapInterval,
} from '../../src/stats.ts';

// Each run does 10,000 resamples, so keep run counts and sizes small.
const BOOT_RUNS = 15;

const genPerCard: fc.Arbitrary<PerCard[]> = fc
  .array(
    fc.record({
      scenarioGroup: fc.constantFrom('g1', 'g2', 'g3', 'g4', 'g5'),
      acceptable: fc.boolean(),
      illegal: fc.boolean(),
    }),
    { minLength: 1, maxLength: 12 },
  )
  .map((rows) =>
    rows.map((r, i) => ({ cardId: `c${i}`, scenarioGroup: r.scenarioGroup, hasOutput: true, acceptable: r.acceptable, severe: false, illegal: r.illegal })),
  );

const genPairs: fc.Arbitrary<PairResult[]> = fc
  .array(fc.boolean(), { minLength: 1, maxLength: 12 })
  .map((bs) => bs.map((consistent, i) => ({ pairId: `P${String(i).padStart(2, '0')}`, scenarioGroup: 'g1', consistent })));

const inRange = (b: BootstrapInterval): boolean =>
  b.lower.k >= 0 && b.upper.k <= b.upper.m && b.lower.k <= b.lower.m && compareFrac(b.lower, b.upper) <= 0 && b.lowerRate >= 0 && b.upperRate <= 1;

test('Property 21: Wilson interval brackets the observed rate within [0, 1]', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 5000 }).chain((n) => fc.tuple(fc.integer({ min: 0, max: n }), fc.constant(n))), ([k, n]) => {
      const w = wilsonInterval(k, n);
      assert.ok(w !== null);
      const p = k / n;
      const eps = 1e-12;
      assert.ok(0 <= w.lower && w.lower <= p + eps, `lower ${w.lower} p ${p}`);
      assert.ok(p - eps <= w.upper && w.upper <= 1, `upper ${w.upper} p ${p}`);
      if (k === 0) assert.equal(w.lower, 0);
      if (k === n) assert.equal(w.upper, 1);
    }),
    { numRuns: 500 },
  );
});

test('Property 21: Wilson interval is null for n = 0', () => {
  assert.equal(wilsonInterval(0, 0), null);
});

test('Property 21: cluster bootstrap bounds are ordered, within [0, 1], and bit-identical across runs', () => {
  fc.assert(
    fc.property(genPerCard, (cards) => {
      for (const f of [clusterBootstrapAcceptable, clusterBootstrapIllegal]) {
        const a = f(cards);
        const b = f(cards);
        assert.ok(a !== null && b !== null);
        assert.ok(inRange(a));
        assert.deepEqual(a, b);
        assert.deepEqual(a.lower, b.lower);
        assert.deepEqual(a.upper, b.upper);
      }
    }),
    { numRuns: BOOT_RUNS },
  );
});

test('Property 21: pair bootstrap bounds are ordered, within [0, 1], and bit-identical across runs', () => {
  fc.assert(
    fc.property(genPairs, (pairs) => {
      const a = pairBootstrap(pairs);
      const b = pairBootstrap(pairs);
      assert.ok(a !== null && b !== null);
      assert.ok(inRange(a));
      assert.deepEqual(a, b);
    }),
    { numRuns: BOOT_RUNS },
  );
});

test('Property 21: input order does not change the bootstrap result', () => {
  fc.assert(
    fc.property(
      genPerCard.chain((c) => fc.tuple(fc.constant(c), fc.shuffledSubarray(c, { minLength: c.length, maxLength: c.length }))),
      genPairs.chain((p) => fc.tuple(fc.constant(p), fc.shuffledSubarray(p, { minLength: p.length, maxLength: p.length }))),
      ([cards, shuffledCards], [pairs, shuffledPairs]) => {
        assert.deepEqual(clusterBootstrapAcceptable(cards), clusterBootstrapAcceptable(shuffledCards));
        assert.deepEqual(clusterBootstrapIllegal(cards), clusterBootstrapIllegal(shuffledCards));
        assert.deepEqual(pairBootstrap(pairs), pairBootstrap(shuffledPairs));
      },
    ),
    { numRuns: BOOT_RUNS },
  );
});

test('Property 21: degenerate inputs give a zero-width interval', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.integer({ min: 1, max: 12 }), (value, n) => {
      const pairs: PairResult[] = Array.from({ length: n }, (_, i) => ({ pairId: `P${i}`, scenarioGroup: 'g1', consistent: value }));
      const b = pairBootstrap(pairs);
      assert.ok(b !== null);
      assert.equal(compareFrac(b.lower, b.upper), 0);
      assert.equal(b.lowerRate, value ? 1 : 0);
      const cards: PerCard[] = Array.from({ length: n }, (_, i) => ({
        cardId: `c${i}`,
        scenarioGroup: `g${i % 3}`,
        hasOutput: true,
        acceptable: value,
        severe: false,
        illegal: value,
      }));
      const c = clusterBootstrapAcceptable(cards);
      assert.ok(c !== null);
      assert.equal(c.lowerRate, c.upperRate);
    }),
    { numRuns: BOOT_RUNS },
  );
});

test('Property 21: no units gives null', () => {
  assert.equal(clusterBootstrapAcceptable([]), null);
  assert.equal(clusterBootstrapIllegal([]), null);
  assert.equal(pairBootstrap([]), null);
  assert.equal(bootstrapUnits([]), null);
});

test('Property 21: a different seed changes the bounds on a non-degenerate example', () => {
  const units = [
    { k: 0, m: 3 },
    { k: 3, m: 3 },
    { k: 1, m: 4 },
    { k: 4, m: 5 },
    { k: 2, m: 2 },
    { k: 0, m: 6 },
    { k: 5, m: 6 },
    { k: 1, m: 1 },
  ];
  const a = bootstrapUnits(units, undefined, BOOTSTRAP_SEED);
  const b = bootstrapUnits(units, undefined, 12345n);
  assert.ok(a !== null && b !== null);
  assert.notDeepEqual({ l: a.lower, u: a.upper }, { l: b.lower, u: b.upper });
});

// ---------------------------------------------------------------- Property 23 (llm-probe task 9.8)
// Property 23: Latency percentiles use returned text only.
// **Validates: Requirements 14.1, 14.2, 14.3**
import { latencySummary, nearestRank, type LatencySample } from '../../src/stats.ts';

const KINDS = ['text', 'timeout', 'error', 'engine_fault', 'not_run'] as const;

const genSample: fc.Arbitrary<LatencySample> = fc
  .tuple(fc.constantFrom(...KINDS), fc.integer({ min: 0, max: 120_000 }))
  .map(([kind, ms]) => ({ outcome: { kind }, latency_ms: kind === 'text' || kind === 'timeout' || kind === 'error' ? ms : null }));
const genSamples = fc.array(genSample, { maxLength: 60 });

/** Independent reference: ceil(p·n/100) − 1 on BigInt. */
function refPercentile(sorted: number[], p: number): number | 'no data' {
  if (sorted.length === 0) return 'no data';
  const n = BigInt(sorted.length);
  const idx = (BigInt(p) * n + 99n) / 100n - 1n;
  return sorted[Number(idx)] as number;
}
const textLatencies = (xs: LatencySample[]): number[] =>
  xs.filter((s) => s.outcome.kind === 'text').map((s) => s.latency_ms as number).sort((a, b) => a - b);
const count = (xs: LatencySample[], k: string): number => xs.filter((s) => s.outcome.kind === k).length;

test('Property 23: p50 and p95 match the BigInt reference over text latencies, with exact counts', () => {
  fc.assert(
    fc.property(genSamples, (xs) => {
      const r = latencySummary(xs);
      const t = textLatencies(xs);
      assert.equal(r.p50, refPercentile(t, 50));
      assert.equal(r.p95, refPercentile(t, 95));
      assert.equal(r.covered, count(xs, 'text'));
      assert.equal(r.timeouts, count(xs, 'timeout'));
      assert.equal(r.errors, count(xs, 'error'));
    }),
    { numRuns: 300 },
  );
});

test('Property 23: p50 <= p95 and both are observed text latencies', () => {
  fc.assert(
    fc.property(genSamples, (xs) => {
      const r = latencySummary(xs);
      if (r.p50 === 'no data' || r.p95 === 'no data') return;
      const t = textLatencies(xs);
      assert.ok(r.p50 <= r.p95);
      assert.ok(t.includes(r.p50));
      assert.ok(t.includes(r.p95));
    }),
    { numRuns: 300 },
  );
});

test('Property 23: non-text outcomes never move the percentiles, and input order is irrelevant', () => {
  fc.assert(
    fc.property(genSamples, fc.integer({ min: 0, max: 1_000_000 }), (xs, ms) => {
      const base = latencySummary(xs);
      const noise: LatencySample[] = [
        { outcome: { kind: 'timeout' }, latency_ms: ms },
        { outcome: { kind: 'error' }, latency_ms: ms },
        { outcome: { kind: 'engine_fault' }, latency_ms: ms },
        { outcome: { kind: 'not_run' }, latency_ms: null },
      ];
      const more = latencySummary([...xs, ...noise]);
      assert.equal(more.p50, base.p50);
      assert.equal(more.p95, base.p95);
      assert.equal(more.covered, base.covered);
      assert.equal(more.timeouts, base.timeouts + 1);
      assert.equal(more.errors, base.errors + 1);
      assert.deepEqual(latencySummary([...xs].reverse()), base);
    }),
    { numRuns: 200 },
  );
});

test('Property 23: shuffled input gives the identical summary', () => {
  fc.assert(
    fc.property(
      genSamples.chain((xs) => fc.tuple(fc.constant(xs), fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length }))),
      ([xs, shuffled]) => {
        assert.deepEqual(latencySummary(shuffled), latencySummary(xs));
      },
    ),
    { numRuns: 200 },
  );
});

test('Property 23: without text outcomes the percentiles are "no data" and the counts are still reported', () => {
  const genNoText = fc.array(genSample.filter((s) => s.outcome.kind !== 'text'), { maxLength: 30 });
  fc.assert(
    fc.property(genNoText, (xs) => {
      const r = latencySummary(xs);
      assert.equal(r.p50, 'no data');
      assert.equal(r.p95, 'no data');
      assert.equal(r.covered, 0);
      assert.equal(r.timeouts, count(xs, 'timeout'));
      assert.equal(r.errors, count(xs, 'error'));
    }),
    { numRuns: 100 },
  );
});

test('Property 23: nearestRank agrees with the reference on sorted arrays for any p in 1..100', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 80 }).map((a) => a.sort((x, y) => x - y)),
      fc.integer({ min: 1, max: 100 }),
      (sorted, p) => {
        assert.equal(nearestRank(sorted, p), refPercentile(sorted, p));
      },
    ),
    { numRuns: 300 },
  );
});

test('Property 23: example, ten text samples give p50 = 5th and p95 = 10th smallest', () => {
  const xs: LatencySample[] = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((ms) => ({ outcome: { kind: 'text' }, latency_ms: ms * 100 }));
  const r = latencySummary(xs);
  assert.deepEqual(r, { covered: 10, timeouts: 0, errors: 0, p50: 500, p95: 1000 });
});
