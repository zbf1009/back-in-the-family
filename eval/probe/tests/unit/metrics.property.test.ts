import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { atLeast, atMost, computeMetrics, randomBaseline, THRESHOLDS, type MetricCard, type MetricsInput } from '../../src/metrics.ts';
import { weakEvidenceLabel } from '../../src/stats.ts';
import type { ContrastLine } from '../../src/results.ts';
import type { TaskType } from '../../src/cards.ts';
import {
  genContrast,
  genFullRuns,
  genMetricCard,
  genRunsFor,
  genTask,
  genWorld,
  type Runs,
  type World,
} from './metrics.gen.ts';

const NUM_RUNS = 100;

function input(cards: MetricCard[], runs: Runs, contrasts: ContrastLine[]): MetricsInput {
  return { cards, records: runs.records, grades: runs.grades, contrasts };
}

interface Extras {
  cards: MetricCard[];
  contrasts: ContrastLine[];
}

/** Void cards (some as the missing half of a core pair), plus Sanity_Cards. */
function genExtras(world: World): fc.Arbitrary<Extras> {
  return fc
    .record({
      partners: fc.tuple(...world.halfPairs.map(() => fc.boolean())),
      voids: fc.array(genTaskVoid, { maxLength: 3 }),
      sanities: fc.array(fc.constantFrom('decision' as const, 'synthesis' as const), { maxLength: 3 }),
    })
    .chain(({ partners, voids, sanities }) => {
      const specs: { id: string; kind: 'void' | 'sanity'; task?: 'decision' | 'synthesis'; pairId?: string; group?: string }[] = [];
      world.halfPairs.forEach((h, i) => {
        if (partners[i]) specs.push({ id: `xh${i}`, kind: 'void', task: h.task, pairId: h.pairId, group: h.scenarioGroup });
      });
      voids.forEach((task, i) => specs.push({ id: `xv${i}`, kind: 'void', task }));
      sanities.forEach((task, i) => specs.push({ id: `xz${i}`, kind: 'sanity', task }));
      return fc
        .tuple(
          fc.tuple(
            ...specs.map((s) =>
              genMetricCard(s.id, {
                task: s.task,
                void: s.kind === 'void',
                scored: s.kind === 'void' ? undefined : false,
                pairId: s.pairId ?? null,
                role: s.pairId === undefined ? null : 'b',
                scenarioGroup: s.group,
              }),
            ),
          ),
          fc.tuple(...specs.filter((s) => s.pairId !== undefined).map((s) => genContrast(s.pairId as string))),
        )
        .map(([cards, contrasts]) => ({ cards, contrasts }));
    });
}
const genTaskVoid = fc.constantFrom('decision' as const, 'synthesis' as const);

// Feature: llm-probe, Property 18: Void and sanity cards never move a Metric
test('Property 18: adding void and sanity cards (and void pair halves) moves no Metric', () => {
  fc.assert(
    fc.property(
      genWorld
        .chain((world) => genExtras(world).map((extras) => ({ world, extras })))
        .chain((x) => genRunsFor(x.extras.cards).map((extraRuns) => ({ ...x, extraRuns }))),
      ({ world, extras, extraRuns }) => {
        const core = computeMetrics(input(world.cards, world.runs, world.contrasts));
        const full = computeMetrics(
          input(
            [...world.cards, ...extras.cards],
            { records: [...world.runs.records, ...extraRuns.records], grades: [...world.runs.grades, ...extraRuns.grades] },
            [...world.contrasts, ...extras.contrasts],
          ),
        );

        // Numerators, denominators, Random_Baseline, per-card and per-pair inputs and verdicts: unchanged.
        assert.deepStrictEqual(full.tasks, core.tasks);

        // Every void and sanity card is listed, in card order, void first when both apply.
        assert.deepStrictEqual(
          full.excluded,
          extras.cards.map((c) => ({ id: c.id, reason: c.void ? 'void' : 'sanity' })),
        );
        assert.deepStrictEqual(core.excluded, []);

        // Sanity results are reported apart, one per non-void sanity card, graded from the base record.
        const sanityIds = extras.cards.filter((c) => !c.scored && !c.void).map((c) => c.id);
        assert.deepStrictEqual(
          full.sanity.map((s) => s.cardId),
          sanityIds,
        );
        for (const s of full.sanity) {
          const base = extraRuns.records.find((r) => r.card_id === s.cardId && r.permutation === 'base');
          assert.equal(s.outcome, base === undefined ? 'none' : base.outcome.kind);
          assert.equal(s.grade === null, base === undefined);
        }
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

test('Property 18: changing the outputs and grades of void and sanity cards moves no Metric', () => {
  fc.assert(
    fc.property(
      genWorld
        .chain((world) => genExtras(world).map((extras) => ({ world, extras })))
        .chain((x) =>
          fc.tuple(genRunsFor(x.extras.cards), genRunsFor(x.extras.cards)).map(([first, second]) => ({ ...x, first, second })),
        ),
      ({ world, extras, first, second }) => {
        const run = (extraRuns: Runs) =>
          computeMetrics(
            input(
              [...world.cards, ...extras.cards],
              { records: [...world.runs.records, ...extraRuns.records], grades: [...world.runs.grades, ...extraRuns.grades] },
              [...world.contrasts, ...extras.contrasts],
            ),
          );
        const a = run(first);
        const b = run(second);
        assert.deepStrictEqual(a.tasks, b.tasks);
        assert.deepStrictEqual(a.excluded, b.excluded);
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

test('Property 18: marking a card void equals removing it, and it is listed as void', () => {
  fc.assert(
    fc.property(
      genWorld.filter((w) => w.cards.length > 0).chain((world) => fc.nat({ max: world.cards.length - 1 }).map((index) => ({ world, index }))),
      ({ world, index }) => {
        const target = world.cards[index] as MetricCard;
        const marked = computeMetrics(
          input(
            world.cards.map((c) => (c.id === target.id ? { ...c, void: true } : c)),
            world.runs,
            world.contrasts,
          ),
        );
        const removed = computeMetrics(
          input(
            world.cards.filter((c) => c.id !== target.id),
            {
              records: world.runs.records.filter((r) => r.card_id !== target.id),
              grades: world.runs.grades.filter((g) => g.card_id !== target.id),
            },
            world.contrasts,
          ),
        );
        // The remaining cards keep their Metrics; the pair containing the card is gone (its partner is
        // then a half pair in both runs), and the void card never reaches the sanity list.
        assert.deepStrictEqual(marked.tasks, removed.tasks);
        assert.deepStrictEqual(marked.excluded, [{ id: target.id, reason: 'void' }]);
        assert.deepStrictEqual(marked.sanity, []);
        if (target.pairId !== null) {
          for (const t of marked.tasks) assert.ok(!t.pairs.some((p) => p.pairId === target.pairId));
        }
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------- Property 19

type Verdict = 'pass' | 'fail' | 'not_computable';

/** Independent reference of the Metric definitions. Integers only; verdicts by cross-multiplication. */
function reference(cards: MetricCard[], runs: Runs, contrasts: ContrastLine[], task: TaskType) {
  const gradeOf = (cardId: string, perm: string) => runs.grades.find((g) => g.card_id === cardId && g.permutation === perm);
  const recOf = (cardId: string, perm: string) => runs.records.find((r) => r.card_id === cardId && r.permutation === perm);
  const flagsOf = (v: unknown) => v as { acceptable: boolean; severe: boolean; illegal: boolean };
  const isOutput = (k: string | undefined) => k === 'text' || k === 'timeout' || k === 'error';
  const idKey = (v: unknown) => JSON.stringify(v);

  const counted = cards.filter((c) => c.task === task && c.scored && !c.void);
  const denominator = counted.length;
  let acceptable = 0;
  let severe = 0;
  let illegal = 0;
  let acceptableNt = 0;
  let severeNt = 0;
  let illegalNt = 0;
  let replaced = 0;
  for (const c of counted) {
    const rec = recOf(c.id, 'base');
    if (rec === undefined || !isOutput(rec.outcome.kind)) continue;
    const g = gradeOf(c.id, 'base');
    assert.ok(g !== undefined);
    const f = flagsOf(g.grade);
    if (f.acceptable) acceptable++;
    if (f.severe) severe++;
    if (f.illegal) illegal++;
    const useLate = rec.outcome.kind === 'timeout' && rec.late !== null && rec.late.kind === 'late';
    const n = useLate ? flagsOf(g.late_grade) : f;
    if (useLate) replaced++;
    if (n.acceptable) acceptableNt++;
    if (n.severe) severeNt++;
    if (n.illegal) illegalNt++;
  }

  // Flips: every non-base Permutation with an output, against the base identity (invalid when no base output).
  let perms = 0;
  let flips = 0;
  for (const c of counted) {
    const baseRec = recOf(c.id, 'base');
    const baseGrade = baseRec !== undefined && isOutput(baseRec.outcome.kind) ? gradeOf(c.id, 'base') : undefined;
    const baseId = baseGrade === undefined ? idKey({ kind: 'invalid' }) : idKey(baseGrade.identity);
    for (const r of runs.records) {
      if (r.card_id !== c.id || r.permutation === 'base' || !isOutput(r.outcome.kind)) continue;
      perms++;
      if (idKey(gradeOf(c.id, r.permutation)?.identity) !== baseId) flips++;
    }
  }

  // Contrast pairs: both cards scored and not void; the pair belongs to card A's Task_Type.
  let pairCount = 0;
  let consistent = 0;
  const pairIds = [...new Set(cards.flatMap((c) => (c.pairId === null ? [] : [c.pairId])))];
  for (const pid of pairIds) {
    const a = cards.find((c) => c.pairId === pid && c.role === 'a');
    const b = cards.find((c) => c.pairId === pid && c.role === 'b');
    if (a === undefined || b === undefined || a.task !== task) continue;
    if (!a.scored || !b.scored || a.void || b.void) continue;
    pairCount++;
    const usable = (c: MetricCard) => {
      const r = recOf(c.id, 'base');
      return r !== undefined && isOutput(r.outcome.kind) && !flagsOf(gradeOf(c.id, 'base')?.grade).illegal;
    };
    const line = contrasts.find((l) => l.pair_id === pid);
    if (usable(a) && usable(b) && (line?.contrast as { consistent?: boolean } | undefined)?.consistent === true) consistent++;
  }

  const atLeast = (n: number, d: number, pct: number): Verdict => (d === 0 ? 'not_computable' : 100 * n >= pct * d ? 'pass' : 'fail');
  const atMost = (n: number, d: number, pct: number): Verdict => (d === 0 ? 'not_computable' : 100 * n <= pct * d ? 'pass' : 'fail');
  const verdicts: Verdict[] = [
    atLeast(acceptable, denominator, 80),
    denominator === 0 ? 'not_computable' : severe <= 1 ? 'pass' : 'fail',
    atMost(flips, perms, 5),
    atLeast(consistent, pairCount, 80),
  ];

  const taskCards = cards.filter((c) => c.task === task);
  const faultRecs = runs.records.filter((r) => taskCards.some((c) => c.id === r.card_id));
  return {
    denominator, acceptable, severe, illegal, acceptableNt, severeNt, illegalNt, replaced, perms, flips, pairCount, consistent,
    verdicts,
    passes: verdicts.every((v) => v === 'pass'),
    engineFault: faultRecs.filter((r) => r.outcome.kind === 'engine_fault').length,
    rebuildFailed: faultRecs.filter((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'rebuild_failed').length,
    withoutBase: counted.filter((c) => !isOutput(recOf(c.id, 'base')?.outcome.kind)).length,
  };
}

/** Random worlds: singles and pairs of arbitrary task / scored / void, with timeouts, errors, faults, missing bases. */
const genMetricsWorld = fc
  .record({
    singles: fc.array(fc.tuple(genTask, fc.boolean(), fc.boolean()), { maxLength: 6 }),
    pairs: fc.array(
      fc.record({ task: genTask, taskB: genTask, aScored: fc.boolean(), bScored: fc.boolean(), aVoid: fc.boolean(), bVoid: fc.boolean() }),
      { maxLength: 4 },
    ),
  })
  .chain((shape) => {
    const specs: { id: string; task: TaskType; scored: boolean; isVoid: boolean; pairId: string | null; role: 'a' | 'b' | null }[] = [];
    shape.singles.forEach(([task, scored, isVoid], i) => specs.push({ id: `s${i}`, task, scored, isVoid, pairId: null, role: null }));
    shape.pairs.forEach((p, i) => {
      specs.push({ id: `p${i}a`, task: p.task, scored: p.aScored, isVoid: p.aVoid, pairId: `P${i}`, role: 'a' });
      specs.push({ id: `p${i}b`, task: p.taskB, scored: p.bScored, isVoid: p.bVoid, pairId: `P${i}`, role: 'b' });
    });
    return fc
      .tuple(
        fc.tuple(...specs.map((s) => genMetricCard(s.id, { task: s.task, scored: s.scored, void: s.isVoid, pairId: s.pairId, role: s.role }))),
        fc.tuple(...specs.map((s) => genFullRuns(s.id))),
        fc.tuple(...shape.pairs.map((_, i) => fc.option(genContrast(`P${i}`), { nil: null }))),
      )
      .map(([cards, allRuns, lines]) => ({
        cards,
        runs: { records: allRuns.flatMap((r) => r.records), grades: allRuns.flatMap((r) => r.grades) },
        contrasts: lines.filter((l): l is ContrastLine => l !== null),
      }));
  });

// Feature: llm-probe, Property 19: Metrics match their definitions
test('Property 19: computeMetrics equals an independent reference computation', () => {
  fc.assert(
    fc.property(genMetricsWorld, ({ cards, runs, contrasts }) => {
      const m = computeMetrics(input(cards, runs, contrasts));
      for (const t of m.tasks) {
        const ref = reference(cards, runs, contrasts, t.task);
        assert.equal(t.cards, ref.denominator);
        // Acceptable and Illegal use the full non-void scored denominator, outputs or not.
        assert.deepStrictEqual([t.acceptable.num, t.acceptable.den], [ref.acceptable, ref.denominator]);
        assert.deepStrictEqual([t.illegal.num, t.illegal.den], [ref.illegal, ref.denominator]);
        assert.deepStrictEqual([t.severe.count, t.severe.den], [ref.severe, ref.denominator]);
        assert.deepStrictEqual([t.flip.num, t.flip.den], [ref.flips, ref.perms]);
        assert.deepStrictEqual([t.contrast.num, t.contrast.den], [ref.consistent, ref.pairCount]);
        assert.deepStrictEqual([t.acceptable.verdict, t.severe.verdict, t.flip.verdict, t.contrast.verdict], ref.verdicts);
        assert.equal(t.passes, ref.passes);
        // Zero denominator: no rate, not computable, not passing.
        if (ref.denominator === 0) {
          assert.equal(t.acceptable.rate, null);
          assert.equal(t.acceptable.verdict, 'not_computable');
          assert.equal(t.passes, false);
        }
        if (ref.perms === 0) assert.equal(t.flip.verdict, 'not_computable');
        if (ref.pairCount === 0) assert.equal(t.contrast.verdict, 'not_computable');
        // Faults stay outside every numerator but are counted apart.
        assert.deepStrictEqual(t.faults, { engineFault: ref.engineFault, rebuildFailed: ref.rebuildFailed });
        assert.equal(t.cardsWithoutBaseOutput, ref.withoutBase);
        assert.equal(t.usableForMark, ref.withoutBase === 0 && ref.engineFault === 0 && ref.rebuildFailed === 0);
        // Without-timeout figures: same denominators, replaced only at timed-out cards with a Late_Answer.
        assert.deepStrictEqual([t.withoutTimeout.acceptable.num, t.withoutTimeout.acceptable.den], [ref.acceptableNt, ref.denominator]);
        assert.deepStrictEqual([t.withoutTimeout.illegal.num, t.withoutTimeout.illegal.den], [ref.illegalNt, ref.denominator]);
        assert.equal(t.withoutTimeout.severe, ref.severeNt);
        assert.equal(t.withoutTimeout.replaced, ref.replaced);
        if (ref.replaced === 0) {
          assert.equal(t.withoutTimeout.acceptable.num, t.acceptable.num);
          assert.equal(t.withoutTimeout.severe, t.severe.count);
          assert.equal(t.withoutTimeout.illegal.num, t.illegal.num);
        }
      }
      const all = runs.records;
      assert.equal(m.faults.filter((f) => f.kind === 'engine_fault').length, all.filter((r) => r.outcome.kind === 'engine_fault').length);
      assert.equal(m.combinationFailed, all.some((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'rebuild_failed'));
    }),
    { numRuns: 300 },
  );
});

// ---------------------------------------------------------------- Property 20

/**
 * Feature: llm-probe, Property 20: Thresholds compare integers exactly.
 * **Validates: Requirements 13.4, 13.9**
 */
const ref = {
  atLeast: (n: number, d: number, p: number) =>
    d === 0 ? 'not_computable' : 100n * BigInt(n) >= BigInt(p) * BigInt(d) ? 'pass' : 'fail',
  atMost: (n: number, d: number, p: number) =>
    d === 0 ? 'not_computable' : 100n * BigInt(n) <= BigInt(p) * BigInt(d) ? 'pass' : 'fail',
  label: (k: number, m: number, t: number) =>
    100n * BigInt(k) >= BigInt(t) * BigInt(m)
      ? 'pass'
      : 100n * BigInt(k) >= BigInt(t - 10) * BigInt(m)
        ? 'pass (interval overlaps threshold)'
        : 'pass with weak evidence',
};

const genPair = fc.integer({ min: 0, max: 5000 }).chain((den) =>
  fc.tuple(fc.integer({ min: 0, max: den }), fc.constant(den)),
);

test('Property 20: atLeast / atMost equal the BigInt cross-multiplication', () => {
  fc.assert(
    fc.property(genPair, fc.constantFrom(5, 80), ([n, d], pct) => {
      assert.equal(atLeast(n, d, pct), ref.atLeast(n, d, pct));
      assert.equal(atMost(n, d, pct), ref.atMost(n, d, pct));
    }),
    { numRuns: 500 },
  );
});

test('Property 20: exact boundary examples are inclusive and unrounded', () => {
  assert.equal(THRESHOLDS.acceptablePct, 80);
  assert.equal(THRESHOLDS.flipPct, 5);
  assert.equal(THRESHOLDS.contrastPct, 80);
  assert.equal(atLeast(4, 5, 80), 'pass');
  assert.equal(atLeast(799, 1000, 80), 'fail');
  assert.equal(atLeast(800, 1000, 80), 'pass');
  assert.equal(atMost(5, 100, 5), 'pass');
  assert.equal(atMost(51, 1000, 5), 'fail');
  assert.equal(atMost(50, 1000, 5), 'pass');
  assert.equal(atLeast(12, 15, THRESHOLDS.contrastPct), 'pass');
  assert.equal(atLeast(8, 10, THRESHOLDS.contrastPct), 'pass');
  assert.equal(atLeast(11, 15, THRESHOLDS.contrastPct), 'fail');
  assert.equal(atLeast(7, 10, THRESHOLDS.contrastPct), 'fail');
  assert.equal(THRESHOLDS.severeMax, 1);
  for (const [s, ok] of [[0, true], [1, true], [2, false]] as const) assert.equal(s <= THRESHOLDS.severeMax, ok);
});

test('Property 20: zero denominator is not computable', () => {
  assert.equal(atLeast(0, 0, 80), 'not_computable');
  assert.equal(atMost(0, 0, 5), 'not_computable');
});

test('Property 20: weak-evidence label equals the BigInt reference and is monotone in the lower bound', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 3000 }).chain((m) => fc.tuple(fc.integer({ min: 0, max: m }), fc.constant(m))),
      fc.integer({ min: 0, max: 3000 }).chain((m) => fc.tuple(fc.integer({ min: 0, max: m }), fc.constant(m))),
      fc.constantFrom(80),
      ([k1, m1], [k2, m2], t) => {
        assert.equal(weakEvidenceLabel({ k: k1, m: m1 }, t), ref.label(k1, m1, t));
        if (m2 > 0) {
          const rank = { 'pass with weak evidence': 0, 'pass (interval overlaps threshold)': 1, pass: 2 } as const;
          const lo = k1 * m2 <= k2 * m1 ? [k1, m1] : [k2, m2];
          const hi = lo === undefined || (lo[0] === k1 && lo[1] === m1) ? [k2, m2] : [k1, m1];
          assert.ok(
            rank[weakEvidenceLabel({ k: lo[0]!, m: lo[1]! }, t)] <= rank[weakEvidenceLabel({ k: hi[0]!, m: hi[1]! }, t)],
          );
        }
      },
    ),
    { numRuns: 500 },
  );
});

test('Property 20: weak-evidence label is exact at the boundaries', () => {
  const R = 10_000;
  for (const t of [80, 5 + 10]) {
    assert.equal(weakEvidenceLabel({ k: t * 100, m: R }, t), 'pass');
    assert.equal(weakEvidenceLabel({ k: t * 100 - 1, m: R }, t), 'pass (interval overlaps threshold)');
    assert.equal(weakEvidenceLabel({ k: (t - 10) * 100, m: R }, t), 'pass (interval overlaps threshold)');
    assert.equal(weakEvidenceLabel({ k: (t - 10) * 100 - 1, m: R }, t), 'pass with weak evidence');
  }
  assert.equal(weakEvidenceLabel({ k: 4, m: 5 }, 80), 'pass');
  assert.equal(weakEvidenceLabel({ k: 7, m: 10 }, 80), 'pass (interval overlaps threshold)');
  assert.equal(weakEvidenceLabel({ k: 69, m: 100 }, 80), 'pass with weak evidence');
});

test('Property 20: a failed Metric is never a pass label, whatever its interval', () => {
  fc.assert(
    fc.property(genPair, genPair, ([n, d], [k, m]) => {
      fc.pre(d > 0);
      if (atLeast(n, d, 80) === 'fail') {
        // the label function is only applied to passing Metrics; a fail verdict stays 'fail'
        assert.notEqual(atLeast(n, d, 80), 'pass');
        assert.ok(m >= 0 && k <= m);
      }
    }),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------- Property 22

const genCards = (maxLen: number, prefix = 'c'): fc.Arbitrary<MetricCard[]> =>
  fc
    .integer({ min: 0, max: maxLen })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => genMetricCard(`${prefix}${i}`))))
    .map((cs) => cs as MetricCard[]);

const counts = (c: MetricCard): boolean => c.task === 'decision' && c.scored && !c.void;

/** Independent reference: sum of acc/opt over a common denominator in BigInt, divided by the count. */
function referenceBaseline(cards: readonly MetricCard[]): { num: bigint; den: bigint } | null {
  const used = cards.filter(counts);
  if (used.length === 0) return null;
  let den = 1n;
  for (const c of used) den *= BigInt(c.optionCount as number);
  let num = 0n;
  for (const c of used) num += (BigInt(c.acceptableCount as number) * den) / BigInt(c.optionCount as number);
  return { num, den: den * BigInt(used.length) };
}

const sameFraction = (got: { num: number; den: number } | null, want: { num: bigint; den: bigint } | null): void => {
  if (want === null) {
    assert.equal(got, null);
    return;
  }
  assert.notEqual(got, null);
  const g = got as { num: number; den: number };
  assert.equal(BigInt(g.num) * want.den, want.num * BigInt(g.den));
};

const decisionBaseline = (m: ReturnType<typeof computeMetrics>) => m.tasks.find((t) => t.task === 'decision')?.randomBaseline;

// Feature: llm-probe, Property 22: The Random_Baseline depends only on the cards
test('Property 22: the baseline equals the exact mean of acceptable/options over non-void scored D cards', () => {
  fc.assert(
    fc.property(genCards(8), (cards) => {
      sameFraction(randomBaseline(cards), referenceBaseline(cards));
      const m = computeMetrics(input(cards, { records: [], grades: [] }, []));
      sameFraction(decisionBaseline(m) ?? null, referenceBaseline(cards));
      // Synthesis never has a baseline.
      assert.equal(m.tasks.find((t) => t.task === 'synthesis')?.randomBaseline ?? null, null);
    }),
    { numRuns: NUM_RUNS },
  );
});

test('Property 22: different model outputs, records, grades and contrasts give the same baseline', () => {
  fc.assert(
    fc.property(
      genCards(6).chain((cards) =>
        fc.tuple(genRunsFor(cards), genRunsFor(cards), fc.option(genContrast('Px'), { nil: null })).map(([a, b, contrast]) => ({
          cards,
          a,
          b,
          contrasts: contrast === null ? [] : [contrast],
        })),
      ),
      ({ cards, a, b, contrasts }) => {
        const ma = computeMetrics(input(cards, a, []));
        const mb = computeMetrics(input(cards, b, contrasts));
        const mc = computeMetrics(input(cards, { records: [], grades: [] }, []));
        assert.deepStrictEqual(decisionBaseline(ma), decisionBaseline(mb));
        assert.deepStrictEqual(decisionBaseline(ma), decisionBaseline(mc));
        assert.deepStrictEqual(decisionBaseline(ma), randomBaseline(cards));
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

test('Property 22: void cards, sanity cards and S cards do not move the baseline', () => {
  fc.assert(
    fc.property(
      genCards(6).chain((core) =>
        fc
          .tuple(
            fc.array(genMetricCard('xv', { task: 'decision', void: true }), { maxLength: 3 }),
            fc.array(genMetricCard('xz', { task: 'decision', scored: false, void: false }), { maxLength: 3 }),
            fc.array(genMetricCard('xs', { task: 'synthesis' }), { maxLength: 3 }),
          )
          .map(([v, z, s]) => ({
            core,
            extra: [...v.map((c, i) => ({ ...c, id: `xv${i}` })), ...z.map((c, i) => ({ ...c, id: `xz${i}` })), ...s.map((c, i) => ({ ...c, id: `xs${i}` }))],
          })),
      ),
      ({ core, extra }) => {
        const all = [...core, ...extra];
        assert.deepStrictEqual(randomBaseline(all), randomBaseline(core));
        const m = computeMetrics(input(all, { records: [], grades: [] }, []));
        sameFraction(decisionBaseline(m) ?? null, referenceBaseline(core));
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

test('Property 22: a run with no counting D cards has no baseline', () => {
  fc.assert(
    fc.property(genCards(8), (cards) => {
      const none = cards.filter((c) => !counts(c));
      assert.equal(randomBaseline(none), null);
      const m = computeMetrics(input(none, { records: [], grades: [] }, []));
      assert.equal(decisionBaseline(m), null);
    }),
    { numRuns: NUM_RUNS },
  );
  assert.equal(randomBaseline([]), null);
});
