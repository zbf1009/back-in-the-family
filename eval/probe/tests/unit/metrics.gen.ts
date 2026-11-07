// Shared fast-check generators for the Metrics property tests (llm-probe tasks 9.3 to 9.8).
// Everything is synthetic: no real cards, no model output.
import fc from 'fast-check';
import type { TaskType } from '../../src/cards.ts';
import type { MetricCard } from '../../src/metrics.ts';
import { SCHEMA, type ContrastLine, type GradeLine, type JsonValue, type Outcome, type ResultRecord } from '../../src/results.ts';

export const PERMUTATIONS = ['reversed', 'rotated_1', 'rotated_2'] as const;

export interface Runs {
  records: ResultRecord[];
  grades: GradeLine[];
}

export interface Flags {
  acceptable: boolean;
  severe: boolean;
  illegal: boolean;
}

export const genTask: fc.Arbitrary<TaskType> = fc.constantFrom<TaskType>('decision', 'synthesis');

export const genFlags: fc.Arbitrary<Flags> = fc.record({ acceptable: fc.boolean(), severe: fc.boolean(), illegal: fc.boolean() });

export const genIdentity: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.constantFrom('a', 'b', 'c').map((o): JsonValue => ({ kind: 'option', option: o })),
  fc.constant<JsonValue>({ kind: 'invalid' }),
);

export const flagsToGrade = (f: Flags): JsonValue => ({ ...f, severe_conditions: [] });

/** A MetricCard. Decision cards get consistent random_baseline_parts (1 <= acceptable <= options). */
export function genMetricCard(
  id: string,
  over: { task?: TaskType; scored?: boolean; void?: boolean; scenarioGroup?: string; pairId?: string | null; role?: 'a' | 'b' | null } = {},
): fc.Arbitrary<MetricCard> {
  return fc
    .record({
      task: over.task === undefined ? genTask : fc.constant(over.task),
      options: fc.integer({ min: 1, max: 5 }),
      pick: fc.nat(),
      group: fc.constantFrom('g1', 'g2', 'g3', 'g4'),
      scored: over.scored === undefined ? fc.boolean() : fc.constant(over.scored),
      isVoid: over.void === undefined ? fc.boolean() : fc.constant(over.void),
    })
    .map((r) => ({
      id,
      task: r.task,
      scored: r.scored,
      void: r.isVoid,
      scenarioGroup: over.scenarioGroup ?? r.group,
      pairId: over.pairId ?? null,
      role: over.role ?? null,
      acceptableCount: r.task === 'decision' ? 1 + (r.pick % r.options) : null,
      optionCount: r.task === 'decision' ? r.options : null,
    }));
}

function record(cardId: string, permutation: string, outcome: Outcome, late: ResultRecord['late']): ResultRecord {
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

const genOutput = fc.oneof(
  fc.constant<Outcome>({ kind: 'text', text: '{}' }),
  fc.constant<Outcome>({ kind: 'timeout' }),
  fc.constant<Outcome>({ kind: 'error', code: 'http', detail: '', remote: false }),
);
const genLate = fc.option(
  fc.oneof(
    fc.constant<NonNullable<ResultRecord['late']>>({ kind: 'late', text: '{}', latency_ms: 12000 }),
    fc.constant<NonNullable<ResultRecord['late']>>({ kind: 'none', reason: 'idle_cap' }),
  ),
  { nil: null },
);

/**
 * One card's results records and grade lines: a base record that is present or missing, and
 * 0 to 3 other Permutations. Only output outcomes (text, timeout, error), so no fault records.
 * Every record with an output has a grade line; a Timeout with a Late_Answer has a late_grade.
 */
export function genRuns(cardId: string, opts: { withBase?: boolean } = {}): fc.Arbitrary<Runs> {
  const one = fc.record({ outcome: genOutput, late: genLate, flags: genFlags, late_flags: genFlags, identity: genIdentity });
  return fc
    .record({
      base: opts.withBase === true ? one.map((x) => x as typeof x | null) : fc.option(one, { nil: null }),
      others: fc.uniqueArray(fc.tuple(fc.constantFrom(...PERMUTATIONS), one), { selector: ([p]) => p, maxLength: 3 }),
    })
    .map(({ base, others }) => {
      const records: ResultRecord[] = [];
      const grades: GradeLine[] = [];
      const add = (perm: string, x: NonNullable<typeof base>): void => {
        const late = x.outcome.kind === 'timeout' ? x.late : null;
        records.push(record(cardId, perm, x.outcome, late));
        grades.push({
          schema: SCHEMA.grade,
          card_id: cardId,
          permutation: perm,
          verdict: null,
          grade: flagsToGrade(x.flags),
          identity: x.identity,
          late_grade: late !== null && late.kind === 'late' ? flagsToGrade(x.late_flags) : null,
        });
      };
      if (base !== null) add('base', base);
      for (const [perm, x] of others) add(perm, x);
      return { records, grades };
    });
}

const genAnyOutcome = fc.oneof(
  { weight: 6, arbitrary: genOutput },
  fc.constant<Outcome>({ kind: 'engine_fault', code: 'runtime_stuck', detail: '' }),
  fc.constant<Outcome>({ kind: 'not_run', reason: 'rebuild_failed', detail: '' }),
  fc.constant<Outcome>({ kind: 'not_run', reason: 'budget', detail: '' }),
);

/**
 * Like genRuns, but records may also be engine_fault or not_run (rebuild_failed, budget), which
 * carry no grade line. A Timeout or error is Illegal with the `invalid` identity, as the Grader
 * yields; a text output keeps its random flags, and an Illegal text has the `invalid` identity.
 */
export function genFullRuns(cardId: string): fc.Arbitrary<Runs> {
  const one = fc.record({ outcome: genAnyOutcome, late: genLate, flags: genFlags, late_flags: genFlags, identity: genIdentity });
  return fc
    .record({
      base: fc.option(one, { nil: null }),
      others: fc.uniqueArray(fc.tuple(fc.constantFrom(...PERMUTATIONS), one), { selector: ([p]) => p, maxLength: 3 }),
    })
    .map(({ base, others }) => {
      const records: ResultRecord[] = [];
      const grades: GradeLine[] = [];
      const add = (perm: string, x: NonNullable<typeof base>): void => {
        const k = x.outcome.kind;
        const late = k === 'timeout' ? x.late : null;
        records.push(record(cardId, perm, x.outcome, late));
        if (k !== 'text' && k !== 'timeout' && k !== 'error') return;
        const failed = k !== 'text';
        const flags: Flags = failed ? { acceptable: false, severe: false, illegal: true } : x.flags;
        const identity: JsonValue = flags.illegal ? { kind: 'invalid' } : x.identity;
        grades.push({
          schema: SCHEMA.grade,
          card_id: cardId,
          permutation: perm,
          verdict: null,
          grade: flagsToGrade(flags),
          identity,
          late_grade: late !== null && late.kind === 'late' ? flagsToGrade(x.late_flags) : null,
        });
      };
      if (base !== null) add('base', base);
      for (const [perm, x] of others) add(perm, x);
      return { records, grades };
    });
}

export const genContrast = (pairId: string): fc.Arbitrary<ContrastLine> =>
  fc.boolean().map((consistent) => ({
    schema: SCHEMA.contrast,
    pair_id: pairId,
    contrast: { a_in_expected: true, b_in_expected: true, consistent },
  }));

export interface Group {
  cards: MetricCard[];
  runs: Runs;
  contrasts: ContrastLine[];
}

/** Cards (with runs) built from a list of arbitrary cards: concatenates their runs. */
export function genRunsFor(cards: readonly MetricCard[], opts: { withBase?: boolean } = {}): fc.Arbitrary<Runs> {
  return fc.tuple(...cards.map((c) => genRuns(c.id, opts))).map((all) => ({
    records: all.flatMap((r) => r.records),
    grades: all.flatMap((r) => r.grades),
  }));
}

export interface World {
  cards: MetricCard[];
  runs: Runs;
  contrasts: ContrastLine[];
  /** Ids of the first card of each pair that has only role `a` (a partner may be added void). */
  halfPairs: { pairId: string; task: TaskType; scenarioGroup: string }[];
}

/**
 * A "core" world of scored, non-void cards: singles, complete pairs (same task and group)
 * and half pairs (role a only, so no pair is counted until a partner shows up).
 */
export const genWorld: fc.Arbitrary<World> = fc
  .record({
    singles: fc.array(fc.tuple(genTask, fc.constantFrom('g1', 'g2', 'g3', 'g4')), { maxLength: 5 }),
    pairs: fc.array(fc.tuple(genTask, fc.constantFrom('g1', 'g2', 'g3', 'g4')), { maxLength: 3 }),
    halves: fc.array(fc.tuple(genTask, fc.constantFrom('g1', 'g2', 'g3', 'g4')), { maxLength: 3 }),
  })
  .chain((shape) => {
    const specs: { id: string; task: TaskType; group: string; pairId: string | null; role: 'a' | 'b' | null }[] = [];
    shape.singles.forEach(([task, group], i) => specs.push({ id: `s${i}`, task, group, pairId: null, role: null }));
    shape.pairs.forEach(([task, group], i) => {
      specs.push({ id: `p${i}a`, task, group, pairId: `P${i}`, role: 'a' });
      specs.push({ id: `p${i}b`, task, group, pairId: `P${i}`, role: 'b' });
    });
    shape.halves.forEach(([task, group], i) => specs.push({ id: `h${i}`, task, group, pairId: `H${i}`, role: 'a' }));
    return fc
      .tuple(
        fc.tuple(...specs.map((s) => genMetricCard(s.id, { task: s.task, scored: true, void: false, scenarioGroup: s.group, pairId: s.pairId, role: s.role }))),
        fc.tuple(...shape.pairs.map((_, i) => genContrast(`P${i}`))),
      )
      .chain(([cards, contrasts]) =>
        genRunsFor(cards).map((runs) => ({
          cards,
          runs,
          contrasts,
          halfPairs: shape.halves.map(([task, group], i) => ({ pairId: `H${i}`, task, scenarioGroup: group })),
        })),
      );
  });
