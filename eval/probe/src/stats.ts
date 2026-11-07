// Statistics (llm-probe task 9.2; requirements 13.7, 13.8, 13.9, 14.1, 14.2, 14.3).
//
// Pure functions, no I/O. Floating point appears only in the Wilson interval, the
// intra-group correlation estimate and the display `rate` fields. Everything that orders
// values or decides a label is integer arithmetic:
//   - SplitMix64 runs on BigInt (64-bit wrap by masking);
//   - bootstrap resample values are exact fractions k/m, sorted by cross-multiplication;
//   - bounds are the nearest-rank elements at sorted indices 249 and 9,749 of 10,000;
//   - weak-evidence labels compare 100·k with t·m and (t − 10)·m;
//   - latency percentiles use the index floor((p·n + 99) / 100) − 1.
import type { PairResult, PerCard } from './metrics.ts';

// ---------------------------------------------------------------- constants

export const BOOTSTRAP_SEED = 20261104n;
export const BOOTSTRAP_RESAMPLES = 10_000;
/** ceil(25·10,000 / 1,000) − 1: the 2.5th percentile, nearest rank. */
export const LOWER_INDEX = 249;
/** ceil(975·10,000 / 1,000) − 1: the 97.5th percentile, nearest rank. */
export const UPPER_INDEX = 9_749;
/** Weak_Evidence_Margin, percentage points. */
export const WEAK_EVIDENCE_MARGIN = 10;
/** Normal quantile for the 95% Wilson interval, an explicit constant. */
export const WILSON_Z = 1.96;

const MASK64 = (1n << 64n) - 1n;
const TWO64 = 1n << 64n;

// ---------------------------------------------------------------- Wilson

export interface WilsonInterval {
  /** Bounds in 0..1, for display. */
  lower: number;
  upper: number;
}

/** Wilson 95% score interval for `successes` of `n`; `null` when n is 0. */
export function wilsonInterval(successes: number, n: number): WilsonInterval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || n < 0 || successes < 0 || successes > n) {
    throw new RangeError(`wilsonInterval: need integers 0 <= successes <= n, got ${successes} of ${n}`);
  }
  if (n === 0) return null;
  const z = WILSON_Z;
  const z2 = z * z;
  const p = successes / n;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lower = successes === 0 ? 0 : Math.max(0, centre - half);
  const upper = successes === n ? 1 : Math.min(1, centre + half);
  return { lower, upper };
}

// ---------------------------------------------------------------- SplitMix64

/**
 * SplitMix64 on BigInt. Each call: state += 0x9E3779B97F4A7C15; then
 * z = (z ^ z>>30) · 0xBF58476D1CE4E5B9; z = (z ^ z>>27) · 0x94D049BB133111EB; z ^ z>>31
 * (all modulo 2^64).
 */
export class SplitMix64 {
  #state: bigint;
  constructor(seed: bigint) {
    this.#state = seed & MASK64;
  }
  next(): bigint {
    this.#state = (this.#state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = this.#state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  }
  /**
   * Unbiased integer in [0, bound) by rejection: outputs x >= 2^64 − (2^64 mod bound) are
   * discarded (the next output is drawn), the rest give `x mod bound`.
   */
  below(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1) throw new RangeError(`below: bound must be a positive integer, got ${bound}`);
    const b = BigInt(bound);
    const limit = TWO64 - (TWO64 % b);
    for (;;) {
      const x = this.next();
      if (x < limit) return Number(x % b);
    }
  }
}

// ---------------------------------------------------------------- exact fractions

/** An exact fraction k/m, m > 0. */
export interface Frac {
  k: number;
  m: number;
}

/** Orders k1/m1 against k2/m2 by cross-multiplication (safe integers). */
export function compareFrac(a: Frac, b: Frac): number {
  const l = a.k * b.m;
  const r = b.k * a.m;
  return l < r ? -1 : l > r ? 1 : 0;
}

/** Nearest-rank element at `index` of the sorted copy (ascending by exact fraction). */
function sortedFracs(values: readonly Frac[]): Frac[] {
  return [...values].sort(compareFrac);
}

/** One resampling unit: `k` successes out of `m` cards (a scenario group, or one pair as 0/1 of 1). */
export interface Unit {
  k: number;
  m: number;
}

export interface BootstrapInterval {
  /** Lower and upper bounds, exact fractions (sorted indices 249 and 9,749). */
  lower: Frac;
  upper: Frac;
  resamples: number;
  /** Display values (k/m as floats). */
  lowerRate: number;
  upperRate: number;
}

/**
 * Bootstrap over `units`: `resamples` times draw units.length units with replacement
 * (index = rng.below(units.length)), sum k and m, keep k/m exactly. A fresh SplitMix64 is
 * seeded per call, so two calls on the same units give identical bounds (R13.8).
 * Returns `null` when there are no units. Units must have m > 0.
 */
export function bootstrapUnits(
  units: readonly Unit[],
  resamples: number = BOOTSTRAP_RESAMPLES,
  seed: bigint = BOOTSTRAP_SEED,
): BootstrapInterval | null {
  if (units.length === 0) return null;
  for (const u of units) {
    if (!(u.m > 0) || u.k < 0 || u.k > u.m) throw new RangeError('bootstrapUnits: each unit needs 0 <= k <= m and m > 0');
  }
  const rng = new SplitMix64(seed);
  const n = units.length;
  const values: Frac[] = [];
  for (let r = 0; r < resamples; r++) {
    let k = 0;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const u = units[rng.below(n)] as Unit;
      k += u.k;
      m += u.m;
    }
    values.push({ k, m });
  }
  const sorted = sortedFracs(values);
  // Nearest rank for 2.5 and 97.5: ceil(25·R/1000) − 1 and ceil(975·R/1000) − 1 (249 and 9,749 at R = 10,000).
  const lo = Math.floor((25 * resamples + 999) / 1000) - 1;
  const hi = Math.floor((975 * resamples + 999) / 1000) - 1;
  const lower = sorted[lo] as Frac;
  const upper = sorted[hi] as Frac;
  return { lower, upper, resamples, lowerRate: lower.k / lower.m, upperRate: upper.k / upper.m };
}

/** Groups perCard rows by scenario group into units counting rows where `pick` holds. */
export function groupUnits(perCard: readonly PerCard[], pick: (c: PerCard) => boolean): Unit[] {
  const byGroup = new Map<string, Unit>();
  for (const c of perCard) {
    const u = byGroup.get(c.scenarioGroup) ?? { k: 0, m: 0 };
    u.m += 1;
    if (pick(c)) u.k += 1;
    byGroup.set(c.scenarioGroup, u);
  }
  // Deterministic order: by group name.
  return [...byGroup].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, u]) => u);
}

/** Cluster_Bootstrap of the acceptable rate (resamples whole scenario groups). */
export function clusterBootstrapAcceptable(perCard: readonly PerCard[]): BootstrapInterval | null {
  return bootstrapUnits(groupUnits(perCard, (c) => c.acceptable));
}
/** Cluster_Bootstrap of the illegal rate. */
export function clusterBootstrapIllegal(perCard: readonly PerCard[]): BootstrapInterval | null {
  return bootstrapUnits(groupUnits(perCard, (c) => c.illegal));
}
/** Pair bootstrap of contrast consistency (resamples Contrast_Pairs; each pair is 1 of 1). Pairs are sorted by id first. */
export function pairBootstrap(pairs: readonly PairResult[]): BootstrapInterval | null {
  const sorted = [...pairs].sort((a, b) => (a.pairId < b.pairId ? -1 : a.pairId > b.pairId ? 1 : 0));
  return bootstrapUnits(sorted.map((p) => ({ k: p.consistent ? 1 : 0, m: 1 })));
}

// ---------------------------------------------------------------- weak-evidence labels

export type PassLabel = 'pass' | 'pass (interval overlaps threshold)' | 'pass with weak evidence';

/**
 * Label for a passing Metric from the exact lower bound `lb` = k/m and the Threshold `t`
 * in whole percentage points. Integer tests only: 100·k ≥ t·m → pass;
 * 100·k ≥ (t − 10)·m → overlaps; otherwise weak evidence.
 */
export function weakEvidenceLabel(lowerBound: Frac, thresholdPct: number): PassLabel {
  const { k, m } = lowerBound;
  if (100 * k >= thresholdPct * m) return 'pass';
  if (100 * k >= (thresholdPct - WEAK_EVIDENCE_MARGIN) * m) return 'pass (interval overlaps threshold)';
  return 'pass with weak evidence';
}

// ---------------------------------------------------------------- intra-group correlation

export type IccResult =
  | { kind: 'estimable'; value: number }
  | { kind: 'not_estimable'; reason: 'no_data' | 'single_group' | 'no_within_group_degrees' | 'zero_variance' };

/**
 * One-way ANOVA estimator of the intra-group correlation for 0/1 outcomes:
 * ICC = (MSB − MSW) / (MSB + (n0 − 1)·MSW), n0 = (N − Σnᵢ²/N) / (k − 1).
 * Not estimable with fewer than two groups, with N ≤ k (no within-group degrees of
 * freedom), or when every value is equal (zero variance).
 */
export function intraGroupCorrelation(units: readonly Unit[]): IccResult {
  const groups = units.filter((u) => u.m > 0);
  if (groups.length === 0) return { kind: 'not_estimable', reason: 'no_data' };
  const k = groups.length;
  if (k < 2) return { kind: 'not_estimable', reason: 'single_group' };
  const N = groups.reduce((s, g) => s + g.m, 0);
  if (N <= k) return { kind: 'not_estimable', reason: 'no_within_group_degrees' };
  const total = groups.reduce((s, g) => s + g.k, 0);
  if (total === 0 || total === N) return { kind: 'not_estimable', reason: 'zero_variance' };
  const grand = total / N;
  let ssb = 0;
  let ssw = 0;
  for (const g of groups) {
    const mean = g.k / g.m;
    ssb += g.m * (mean - grand) ** 2;
    // Sum of squared deviations of 0/1 values around the group mean: k(1 − mean)^2 + (m − k)·mean^2.
    ssw += g.k * (1 - mean) ** 2 + (g.m - g.k) * mean ** 2;
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const n0 = (N - groups.reduce((s, g) => s + g.m * g.m, 0) / N) / (k - 1);
  const denom = msb + (n0 - 1) * msw;
  if (!(denom > 0)) return { kind: 'not_estimable', reason: 'zero_variance' };
  return { kind: 'estimable', value: (msb - msw) / denom };
}

export function intraGroupCorrelationOf(perCard: readonly PerCard[], pick: (c: PerCard) => boolean): IccResult {
  return intraGroupCorrelation(groupUnits(perCard, pick));
}

// ---------------------------------------------------------------- latency

/** What latency needs from a Results record. */
export interface LatencySample {
  outcome: { kind: string };
  latency_ms: number | null;
}

export interface LatencySummary {
  /** Requests the percentiles cover: `text` outcomes only (including later-Illegal ones). */
  covered: number;
  timeouts: number;
  errors: number;
  /** Whole milliseconds, or 'no data' when no request returned raw text (R14.3). */
  p50: number | 'no data';
  p95: number | 'no data';
}

/** Nearest-rank percentile of an ascending-sorted integer array: index floor((p·n + 99)/100) − 1. */
export function nearestRank(sortedAscending: readonly number[], p: number): number | 'no data' {
  const n = sortedAscending.length;
  if (n === 0) return 'no data';
  const idx = Math.floor((p * n + 99) / 100) - 1;
  return sortedAscending[idx] as number;
}

/** Latency p50 and p95 over `text` outcomes only, with covered, timeout and error counts. */
export function latencySummary(samples: readonly LatencySample[]): LatencySummary {
  const values: number[] = [];
  let timeouts = 0;
  let errors = 0;
  for (const s of samples) {
    if (s.outcome.kind === 'text') {
      if (s.latency_ms === null) throw new RangeError('latencySummary: a text outcome needs latency_ms');
      values.push(s.latency_ms);
    } else if (s.outcome.kind === 'timeout') timeouts++;
    else if (s.outcome.kind === 'error') errors++;
  }
  values.sort((a, b) => a - b);
  return { covered: values.length, timeouts, errors, p50: nearestRank(values, 50), p95: nearestRank(values, 95) };
}
