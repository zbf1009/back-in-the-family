// Quality Metrics (llm-probe task 9.1; requirements 2.8, 8.5, 8.13, 13.1 to 13.6, 13.10, 13.12).
//
// Pure functions: loaded cards, one Combination's Results records and its grade lines in,
// a structured Metrics object out. Nothing here validates or grades model output; the
// Grader, the Identity_Value and the contrast decision all come from Sim_Wasm and arrive as
// `GradeLine` and `ContrastLine` values (grades file). This module only counts them.
//
// Pass or fail compares integers by cross-multiplication (R13.4). Floating point appears in
// the `rate` display fields only and never feeds a verdict.
//
// Intervals (Wilson, Cluster_Bootstrap), the intra-group correlation and the latency
// percentiles belong to stats.ts. This module exposes the per-card and per-pair facts they
// need (`perCard`, `pairs`).
import type { LoadedCard, TaskType } from './cards.ts';
import { canonicalJson } from './results.ts';
import type { ContrastLine, ExcludedLine, GradeLine, JsonValue, ResultRecord } from './results.ts';

// ---------------------------------------------------------------- thresholds

/** The locked Thresholds (R13.4). Percentages are whole numbers. */
export const THRESHOLDS = {
  /** Acceptable rate at least this many percent (inclusive). */
  acceptablePct: 80,
  /** Severe count at most this (inclusive). */
  severeMax: 1,
  /** Flip rate at most this many percent (inclusive). */
  flipPct: 5,
  /** Contrast consistency at least this many percent (inclusive). */
  contrastPct: 80,
} as const;

export const BASE_PERMUTATION = 'base';

// ---------------------------------------------------------------- input types

/** What the Metrics read from one card. `metricCardFromLoaded` fills it from `llm_parse_card`. */
export interface MetricCard {
  id: string;
  task: TaskType;
  /** False for a Sanity_Card. */
  scored: boolean;
  void: boolean;
  scenarioGroup: string;
  pairId: string | null;
  role: 'a' | 'b' | null;
  /** D cards only: number of acceptable option IDs in the answer key. */
  acceptableCount: number | null;
  /** D cards only: number of options. */
  optionCount: number | null;
}

/** Thrown when inputs do not fit together (a record without its grade line, a duplicate, ...). */
export class MetricsInputError extends Error {
  constructor(message: string) {
    super(`metrics: ${message}`);
    this.name = 'MetricsInputError';
  }
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Reads the members of a `LoadedCard.parsed` (the `llm_parse_card` result) that Metrics need. */
export function metricCardFromLoaded(card: LoadedCard): MetricCard {
  const env = asObject(JSON.parse(card.parsed));
  const meta = asObject(env?.meta);
  if (meta === undefined) throw new MetricsInputError(`card ${card.id}: parsed card has no meta`);
  const group = meta.scenario_group;
  if (typeof group !== 'string') throw new MetricsInputError(`card ${card.id}: meta.scenario_group must be a string`);
  const pairId = meta.pair_id ?? null;
  const role = meta.role ?? null;
  if (pairId !== null && typeof pairId !== 'string') throw new MetricsInputError(`card ${card.id}: meta.pair_id must be a string or null`);
  if (role !== null && role !== 'a' && role !== 'b') throw new MetricsInputError(`card ${card.id}: meta.role must be a, b or null`);
  const parts = asObject(env?.random_baseline_parts);
  const ac = parts?.acceptable_count;
  const oc = parts?.option_count;
  const haveParts = typeof ac === 'number' && typeof oc === 'number';
  if (card.task === 'decision' && !haveParts) {
    throw new MetricsInputError(`card ${card.id}: decision card has no random_baseline_parts`);
  }
  return {
    id: card.id,
    task: card.task,
    scored: card.scored,
    void: card.void,
    scenarioGroup: group,
    pairId,
    role,
    acceptableCount: haveParts ? (ac as number) : null,
    optionCount: haveParts ? (oc as number) : null,
  };
}

export interface MetricsInput {
  /** The cards of the run's split (both tasks). Dev_Run: dev cards; Locked_Run: locked cards. */
  cards: readonly MetricCard[];
  /** The Combination's Results records of that split. */
  records: readonly ResultRecord[];
  /** Grade lines (grades file) for every record that has an output. */
  grades: readonly GradeLine[];
  /** Contrast lines (grades file). */
  contrasts: readonly ContrastLine[];
  /** Task types to report; default both. A D-only run passes `['decision']`. */
  tasks?: readonly TaskType[];
  /**
   * How the Shuffle_Test flip Metric is obtained (R20.12, DA-26). `measured` (default) counts flips over the non-base
   * Permutations. `by_construction` is for a Derived_Run only (Results header `variant: "perm_avg"`, read by the caller
   * from the header, never guessed from the records): the flip is guaranteed by the Aggregation_Rule, so it has no
   * numerator, no denominator and no verdict.
   */
  flip?: FlipMode;
}

export type FlipMode = 'measured' | 'by_construction';

// ---------------------------------------------------------------- output types

/** Integer numerator and denominator; `rate` (0..1) is for display only, `null` when den is 0. */
export interface Ratio {
  num: number;
  den: number;
  rate: number | null;
}
export type Verdict = 'pass' | 'fail' | 'not_computable';
export interface JudgedRatio extends Ratio {
  verdict: Verdict;
}
export interface SevereCount {
  count: number;
  /** All non-void Scored_Cards of the Task_Type (the common denominator). */
  den: number;
  verdict: Verdict;
}

/** One non-void Scored_Card's base-Permutation result. */
export interface PerCard {
  cardId: string;
  scenarioGroup: string;
  /** False when the base Permutation has no output (not run, engine fault, or missing). */
  hasOutput: boolean;
  acceptable: boolean;
  severe: boolean;
  illegal: boolean;
}

/** One counted Contrast_Pair. */
export interface PairResult {
  pairId: string;
  /** Scenario group of card A (both cards of a pair live in one group). */
  scenarioGroup: string;
  consistent: boolean;
}

export interface Fraction {
  num: number;
  den: number;
}

export interface WithoutTimeout {
  acceptable: Ratio;
  severe: number;
  illegal: Ratio;
  /** Timed-out base requests whose Late_Answer grade replaced the Timeout. */
  replaced: number;
}

export interface FaultRecord {
  cardId: string;
  permutation: string;
  kind: 'engine_fault' | 'rebuild_failed';
  /** The engine fault's own code (`runtime_stuck`, `truncated_state`); set for `engine_fault` only. */
  code?: 'runtime_stuck' | 'truncated_state';
}

/** The flip Metric of a Derived_Run: guaranteed by construction, not measured (R20.13). It is not a pass and not a fail. */
export interface ByConstructionFlip {
  mode: 'by_construction';
}

/** True for the flip Metric of a Derived_Run. */
export const isByConstruction = (f: JudgedRatio | ByConstructionFlip): f is ByConstructionFlip => 'mode' in f;

/** The measured flip of a Task_Type; throws for a by-construction flip, which has no numerator or denominator. */
export function measuredFlip(m: Pick<TaskMetrics, 'flip'>): JudgedRatio {
  if (isByConstruction(m.flip)) throw new MetricsInputError('the flip Metric is by_construction: it has no numerator or denominator');
  return m.flip;
}

export interface TaskMetrics {
  task: TaskType;
  /** Non-void Scored_Cards of the Task_Type: the denominator of the card-level Metrics. */
  cards: number;
  acceptable: JudgedRatio;
  severe: SevereCount;
  /**
   * Severe grades on non-base Permutations of the same cards (reported only, no verdict). The
   * Severe count above is over the base Permutation of each card, by design (R13.1). Always 0 for a Derived_Run, which
   * holds a base record per Card only ("not applicable").
   */
  severeOtherPermutations: number;
  /** Reported without a verdict (R13.4). */
  illegal: Ratio;
  flip: JudgedRatio | ByConstructionFlip;
  contrast: JudgedRatio;
  /** Mean over non-void scored D cards of acceptable/options, exact; `null` for S or no cards. */
  randomBaseline: Fraction | null;
  /** True only when all four Thresholds hold; a zero denominator means not passing (R13.5). */
  passes: boolean;
  /** "Quality without timeout" figures (R13.12); never feed a mark. */
  withoutTimeout: WithoutTimeout;
  /** Base cards with no output record (only in an entry that is not complete). */
  cardsWithoutBaseOutput: number;
  /** Counts of fault records of this Task_Type's cards (outside every numerator). */
  faults: { engineFault: number; rebuildFailed: number };
  /**
   * False when any fault record exists or a base output is missing: the entry is not
   * `complete` (R3.8), so these Metrics are not used for a mark.
   */
  usableForMark: boolean;
  perCard: PerCard[];
  pairs: PairResult[];
}

export interface SanityResult {
  cardId: string;
  task: TaskType;
  /** What the base Permutation produced: `text`, `timeout`, `error`, or `none` (no output). */
  outcome: 'text' | 'timeout' | 'error' | 'none';
  /** The base grade, or `null` when there is no output. */
  grade: { acceptable: boolean; severe: boolean; illegal: boolean } | null;
}

export interface Metrics {
  tasks: TaskMetrics[];
  /** Void and Sanity cards, in card order. Void takes precedence over sanity. */
  excluded: ExcludedLine['excluded'];
  /** Non-void Sanity_Cards, apart from every Metric (R13.10). */
  sanity: SanityResult[];
  /** Every `engine_fault` and `rebuild_failed` record (R8.5, R8.13), for the Report. */
  faults: FaultRecord[];
  /** True when a rebuild failed: the whole Combination is reported as failed. */
  combinationFailed: boolean;
}

// ---------------------------------------------------------------- integer helpers

const ratio = (num: number, den: number): Ratio => ({ num, den, rate: den > 0 ? num / den : null });

/** 100·num ≥ pct·den, exact on integers; zero denominator is not computable. */
export function atLeast(num: number, den: number, pct: number): Verdict {
  if (den === 0) return 'not_computable';
  return 100 * num >= pct * den ? 'pass' : 'fail';
}
/** 100·num ≤ pct·den. */
export function atMost(num: number, den: number, pct: number): Verdict {
  if (den === 0) return 'not_computable';
  return 100 * num <= pct * den ? 'pass' : 'fail';
}

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

/**
 * Random_Baseline (R13.6): mean over the cards of acceptable/options as an exact reduced
 * fraction. Reads only the cards; no model output. `null` when no card counts.
 */
export function randomBaseline(cards: readonly MetricCard[]): Fraction | null {
  const used = cards.filter((c) => c.task === 'decision' && c.scored && !c.void);
  if (used.length === 0) return null;
  // Sum acc_i/opt_i over a common denominator, then divide by the card count.
  let num = 0n;
  let den = 1n;
  for (const c of used) {
    if (c.acceptableCount === null || c.optionCount === null || c.optionCount < 1) {
      throw new MetricsInputError(`card ${c.id}: Random_Baseline needs an acceptable count and a positive option count`);
    }
    const o = BigInt(c.optionCount);
    const a = BigInt(c.acceptableCount);
    num = num * o + a * den;
    den = den * o;
    const g = gcd(num, den);
    if (g > 1n) {
      num /= g;
      den /= g;
    }
  }
  den *= BigInt(used.length);
  const g = gcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  if (num > BigInt(Number.MAX_SAFE_INTEGER) || den > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MetricsInputError('Random_Baseline does not fit a safe integer fraction');
  }
  return { num: Number(num), den: Number(den) };
}

// ---------------------------------------------------------------- reading grade lines

interface Flags {
  acceptable: boolean;
  severe: boolean;
  illegal: boolean;
}

function readFlags(v: JsonValue | null, where: string): Flags {
  const o = asObject(v);
  if (o === undefined || typeof o.acceptable !== 'boolean' || typeof o.severe !== 'boolean' || typeof o.illegal !== 'boolean') {
    throw new MetricsInputError(`${where}: grade must be an object with boolean acceptable, severe and illegal`);
  }
  return { acceptable: o.acceptable, severe: o.severe, illegal: o.illegal };
}

const key = (cardId: string, permutation: string): string => `${cardId}\u0000${permutation}`;

type OutputKind = 'text' | 'timeout' | 'error';
const hasOutput = (r: ResultRecord | undefined): r is ResultRecord & { outcome: { kind: OutputKind } } =>
  r !== undefined && (r.outcome.kind === 'text' || r.outcome.kind === 'timeout' || r.outcome.kind === 'error');

const INVALID_IDENTITY = canonicalJson({ kind: 'invalid' });

// ---------------------------------------------------------------- computation

export function computeMetrics(input: MetricsInput): Metrics {
  const cardById = new Map<string, MetricCard>();
  for (const c of input.cards) {
    if (cardById.has(c.id)) throw new MetricsInputError(`duplicate card ${c.id}`);
    cardById.set(c.id, c);
  }

  const recs = new Map<string, ResultRecord>();
  for (const r of input.records) {
    if (!cardById.has(r.card_id)) throw new MetricsInputError(`record for unknown card ${r.card_id}`);
    const k = key(r.card_id, r.permutation);
    if (recs.has(k)) throw new MetricsInputError(`duplicate record for ${r.card_id} / ${r.permutation}`);
    recs.set(k, r);
  }
  const gradeLines = new Map<string, GradeLine>();
  for (const g of input.grades) {
    const k = key(g.card_id, g.permutation);
    if (gradeLines.has(k)) throw new MetricsInputError(`duplicate grade line for ${g.card_id} / ${g.permutation}`);
    gradeLines.set(k, g);
  }
  const contrastLines = new Map<string, ContrastLine>();
  for (const c of input.contrasts) {
    if (contrastLines.has(c.pair_id)) throw new MetricsInputError(`duplicate contrast line for pair ${c.pair_id}`);
    contrastLines.set(c.pair_id, c);
  }

  const gradeOf = (r: ResultRecord): GradeLine => {
    const g = gradeLines.get(key(r.card_id, r.permutation));
    if (g === undefined) throw new MetricsInputError(`no grade line for ${r.card_id} / ${r.permutation}`);
    return g;
  };

  // Faults: outside every numerator, listed for the Report (R8.5, R8.13).
  const faults: FaultRecord[] = [];
  for (const r of input.records) {
    if (r.outcome.kind === 'engine_fault') {
      faults.push({ cardId: r.card_id, permutation: r.permutation, kind: 'engine_fault', code: r.outcome.code });
    } else if (r.outcome.kind === 'not_run' && r.outcome.reason === 'rebuild_failed') {
      faults.push({ cardId: r.card_id, permutation: r.permutation, kind: 'rebuild_failed' });
    }
  }

  const excluded: ExcludedLine['excluded'] = [];
  const sanity: SanityResult[] = [];
  for (const c of input.cards) {
    if (c.void) {
      excluded.push({ id: c.id, reason: 'void' });
    } else if (!c.scored) {
      excluded.push({ id: c.id, reason: 'sanity' });
      const base = recs.get(key(c.id, BASE_PERMUTATION));
      if (hasOutput(base)) {
        sanity.push({ cardId: c.id, task: c.task, outcome: base.outcome.kind, grade: readFlags(gradeOf(base).grade, `sanity ${c.id}`) });
      } else {
        sanity.push({ cardId: c.id, task: c.task, outcome: 'none', grade: null });
      }
    }
  }

  const tasks = (input.tasks ?? (['decision', 'synthesis'] as const)).map((t) => taskMetrics(t));
  return { tasks, excluded, sanity, faults, combinationFailed: faults.some((f) => f.kind === 'rebuild_failed') };

  function taskMetrics(task: TaskType): TaskMetrics {
    const counted = input.cards.filter((c) => c.task === task && c.scored && !c.void);
    const den = counted.length;

    let acc = 0;
    let severe = 0;
    let illegal = 0;
    let accNt = 0;
    let severeNt = 0;
    let illegalNt = 0;
    let replaced = 0;
    let without = 0;
    const perCard: PerCard[] = [];
    const baseIdentity = new Map<string, string>();
    const baseFlags = new Map<string, Flags | null>();

    for (const c of counted) {
      const base = recs.get(key(c.id, BASE_PERMUTATION));
      if (!hasOutput(base)) {
        // No output: not acceptable, not severe, not Illegal; stays in the denominator (R13.1).
        without++;
        baseIdentity.set(c.id, INVALID_IDENTITY);
        baseFlags.set(c.id, null);
        perCard.push({ cardId: c.id, scenarioGroup: c.scenarioGroup, hasOutput: false, acceptable: false, severe: false, illegal: false });
        continue;
      }
      const line = gradeOf(base);
      const f = readFlags(line.grade, `grade of ${c.id}`);
      baseIdentity.set(c.id, canonicalJson(line.identity));
      baseFlags.set(c.id, f);
      if (f.acceptable) acc++;
      if (f.severe) severe++;
      if (f.illegal) illegal++;
      perCard.push({ cardId: c.id, scenarioGroup: c.scenarioGroup, hasOutput: true, acceptable: f.acceptable, severe: f.severe, illegal: f.illegal });

      // "Quality without timeout": a Late_Answer's grade replaces its Timeout (R13.12).
      let g = f;
      if (base.outcome.kind === 'timeout' && base.late !== null && base.late.kind === 'late') {
        if (line.late_grade === null) {
          throw new MetricsInputError(`${c.id}: record has a Late_Answer but the grade line has no late_grade`);
        }
        g = readFlags(line.late_grade, `late_grade of ${c.id}`);
        replaced++;
      }
      if (g.acceptable) accNt++;
      if (g.severe) severeNt++;
      if (g.illegal) illegalNt++;
    }

    // Shuffle_Test: non-base Permutations run, Flips by Identity_Value (R13.2).
    let perms = 0;
    let flips = 0;
    let severeOther = 0;
    for (const c of counted) {
      const b = baseIdentity.get(c.id) as string;
      for (const r of input.records) {
        if (r.card_id !== c.id || r.permutation === BASE_PERMUTATION || !hasOutput(r)) continue;
        perms++;
        if (readFlags(gradeOf(r).grade, `grade of ${r.card_id} / ${r.permutation}`).severe) severeOther++;
        // An Illegal output has the `invalid` identity, so it flips unless the base is invalid too.
        if (canonicalJson(gradeOf(r).identity) !== b) flips++;
      }
    }

    // Contrast_Pairs counted: both cards Scored and not void (R13.3).
    const pairs: PairResult[] = [];
    const byPair = new Map<string, { a?: MetricCard; b?: MetricCard }>();
    for (const c of input.cards) {
      if (c.pairId === null || c.role === null) continue;
      const slot = byPair.get(c.pairId) ?? {};
      slot[c.role] = c;
      byPair.set(c.pairId, slot);
    }
    for (const [pairId, { a, b }] of [...byPair].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      if (a === undefined || b === undefined) continue;
      if (a.task !== task) continue;
      if (!a.scored || !b.scored || a.void || b.void) continue;
      const fa = baseFlags.get(a.id);
      const fb = baseFlags.get(b.id);
      let consistent = false;
      if (fa && fb && !fa.illegal && !fb.illegal) {
        const line = contrastLines.get(pairId);
        const d = asObject(line?.contrast);
        consistent = d?.consistent === true;
      }
      pairs.push({ pairId, scenarioGroup: a.scenarioGroup, consistent });
    }
    const consistentCount = pairs.filter((p) => p.consistent).length;

    const faultsOfTask = faults.filter((f) => cardById.get(f.cardId)?.task === task);
    const engineFault = faultsOfTask.filter((f) => f.kind === 'engine_fault').length;
    const rebuildFailed = faultsOfTask.filter((f) => f.kind === 'rebuild_failed').length;

    const acceptable: JudgedRatio = { ...ratio(acc, den), verdict: atLeast(acc, den, THRESHOLDS.acceptablePct) };
    const severeC: SevereCount = {
      count: severe,
      den,
      verdict: den === 0 ? 'not_computable' : severe <= THRESHOLDS.severeMax ? 'pass' : 'fail',
    };
    const byConstruction = (input.flip ?? 'measured') === 'by_construction';
    const flip: JudgedRatio | ByConstructionFlip = byConstruction ? { mode: 'by_construction' } : { ...ratio(flips, perms), verdict: atMost(flips, perms, THRESHOLDS.flipPct) };
    const contrast: JudgedRatio = {
      ...ratio(consistentCount, pairs.length),
      verdict: atLeast(consistentCount, pairs.length, THRESHOLDS.contrastPct),
    };

    return {
      task,
      cards: den,
      acceptable,
      severe: severeC,
      severeOtherPermutations: byConstruction ? 0 : severeOther,
      illegal: ratio(illegal, den),
      flip,
      contrast,
      randomBaseline: task === 'decision' ? randomBaseline(input.cards) : null,
      passes: [acceptable.verdict, severeC.verdict, ...(isByConstruction(flip) ? [] : [flip.verdict]), contrast.verdict].every((v) => v === 'pass'),
      withoutTimeout: { acceptable: ratio(accNt, den), severe: severeNt, illegal: ratio(illegalNt, den), replaced },
      cardsWithoutBaseOutput: without,
      faults: { engineFault, rebuildFailed },
      usableForMark: without === 0 && engineFault === 0 && rebuildFailed === 0,
      perCard,
      pairs,
    };
  }
}

// ---------------------------------------------------------------- pass label (R20.13, RC-23)

/** The label of the pass mark of a Combination whose flip is guaranteed by construction (R20.13). */
export const BY_CONSTRUCTION_PASS_LABEL = 'pass (flip guaranteed by construction, not measured)';

/**
 * The one place that turns a Task_Type's Metrics into the label of its pass mark (R20.13, RC-23). A measured flip gives
 * `pass` or `fail`. A by-construction flip gives {@link BY_CONSTRUCTION_PASS_LABEL} when the other three Thresholds hold
 * (it still counts as a pass under R13.4, with its label), else `fail` with the failing Thresholds named. The R13.9
 * labels stay on the acceptable-rate and contrast rows and are not part of this label.
 */
export function passLabel(m: Pick<TaskMetrics, 'passes' | 'flip' | 'acceptable' | 'severe' | 'contrast'>): string {
  if (m.passes) return isByConstruction(m.flip) ? BY_CONSTRUCTION_PASS_LABEL : 'pass';
  if (!isByConstruction(m.flip)) return 'fail';
  const failing: string[] = [];
  if (m.acceptable.verdict !== 'pass') failing.push('acceptable rate');
  if (m.severe.verdict !== 'pass') failing.push('severe count');
  if (m.contrast.verdict !== 'pass') failing.push('contrast consistency');
  return `fail (${failing.join(', ')})`;
}
