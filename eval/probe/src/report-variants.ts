// Pure parts of the Report for the Decision_Variants (llm-probe task 42.3; R20.13 to R20.16; DA-28).
//
// Everything here is a function of stored Results records and Metrics: the pass mark of a `perm_avg` Combination and the
// line that must travel with it, the position distributions (section 4b), the Request_Multiplier distribution and the
// decision latency percentiles (section 4c). No I/O, no card content, no Permutation arithmetic of its own: positions are
// the 1-based positions the aggregation export stored (`perm_avg.positions`).
import { BY_CONSTRUCTION_PASS_LABEL, isByConstruction, type TaskMetrics } from './metrics.ts';
import type { ResultRecord } from './results.ts';
import { nearestRank } from './stats.ts';
import { decisionLatencies } from './variants.ts';

/** The flip row of a `perm_avg` Combination: no numbers, no mark from data (R20.13). */
export const PERM_AVG_FLIP_CELL = 'guaranteed by construction (not measured)';

export const PERM_AVG_FAIL_LABEL = 'fail';

/** Section 2, whenever a `perm_avg` variant is derived (R20.13). */
export const PREREGISTRATION_SENTENCE =
  'The Decision_Variants were pre-registered on 2026-11-09, before any Decision_Model Dev_Run result was seen.';
export const NON_INDEPENDENCE_SENTENCE =
  'A `perm_avg` variant derived from the stored records of its `single` run is not an independent measurement: it re-reads the same requests and responses.';

/** Section 4c (R20.15). The conflict with `tech.md` is stated and left to the Author. */
export const PRODUCTION_NOTE =
  '`tech.md` fixes one request per node for server inference. A `perm_avg` runtime needs up to four requests per node and per NPC in production. This conflict is left to the Author.';
export const ONE_REQUEST_ALTERNATIVE =
  'One-request alternative (DA-28): System One accepts several questions in one request, and for a decision the four Variant_Permutations differ only in the order of `criteria`, so they could be asked as four questions over one `state`. This is described, not built: whether the answers stay independent over one shared state is undocumented, the questions share the context window with `state`, and it only holds when the Permutations differ in option order alone. It is not measured, and it is not a Combination.';

/** Section 13 (R20.20). */
export const FINE_TUNING_TITLE = '13. Note on fine-tuning';
export const FINE_TUNING_SENTENCE =
  'External workbenches discussed fine-tuning small models and teacher tests; this is outside the main line of this spec and nothing in this Report depends on it.';

export interface PermAvgSource {
  /** The `single` Combination the records come from. */
  readonly single: string;
  /** The `complete` ledger entry of a Locked source; null for a Dev_Run source. */
  readonly ledgerEntry: string | null;
  readonly sourceSha256: string;
}

/**
 * The one function that produces the mark of a `perm_avg` Combination and the derivation line that must appear with it
 * (R20.13 "wherever it appears", Property 54). The mark is exactly the by-construction pass label, `fail`, or the "not used
 * for a mark" text when the file is not usable. A measured flip is a programming error here.
 */
export function permAvgMark(m: Pick<TaskMetrics, 'passes' | 'flip' | 'usableForMark'>, source: PermAvgSource): { readonly mark: string; readonly derivationLine: string } {
  if (!isByConstruction(m.flip)) throw new Error('permAvgMark: the flip Metric of a perm_avg Combination must be by_construction');
  const mark = !m.usableForMark ? 'not used for a mark (missing outputs or engine faults)' : m.passes ? BY_CONSTRUCTION_PASS_LABEL : PERM_AVG_FAIL_LABEL;
  const derivationLine =
    `Derived from the stored records of \`${source.single}\`, ledger entry ${source.ledgerEntry ?? 'none (Dev_Run source)'}, source Results sha256 ${source.sourceSha256}; ` +
    'no request was sent for it; the guarantee holds for the set of Variant_Permutations that the variant averages and is not a measurement of position bias; ' +
    'this is not an independent measurement from the `single` run.';
  return { mark, derivationLine };
}

// ---------------------------------------------------------------- section 4b

export interface PositionDistribution {
  /** Number of shown positions (columns), at least 5. */
  readonly width: number;
  /** One row per Permutation seen, base first, then reversed, rotated_N ascending, then the rest by name. */
  readonly rows: readonly { readonly permutation: string; readonly counts: readonly number[] }[];
  /** Counts of `positions.original` (the position in the base Permutation). */
  readonly original: readonly number[];
  /** Cards with an Illegal answer (no `chosen` or no `positions`); in no position cell. */
  readonly illegal: number;
  /** Cards counted: the non-Void Scored_Cards present in `records`. */
  readonly total: number;
}

const permOrder = (p: string): [number, number, string] => {
  if (p === 'base') return [0, 0, p];
  if (p === 'reversed') return [1, 0, p];
  const m = /^rotated_(\d+)$/.exec(p);
  return m === null ? [3, 0, p] : [2, Number(m[1]), p];
};
const cmpPerm = (a: string, b: string): number => {
  const x = permOrder(a);
  const y = permOrder(b);
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
};

/**
 * Position counts over the stored `perm_avg.positions` of the derived records of the non-Void Scored_Cards (`scoredIds`).
 * Row sums plus the Illegal count equal `total` (Property 55): a Card is Illegal when it has no `chosen` option or no
 * `positions`, and then it is in no cell.
 */
export function positionDistribution(records: readonly ResultRecord[], scoredIds: ReadonlySet<string>): PositionDistribution {
  const rows = new Map<string, number[]>();
  const original: number[] = [];
  let illegal = 0;
  let total = 0;
  let width = 5;
  const bump = (arr: number[], pos: number): void => {
    while (arr.length < pos) arr.push(0);
    arr[pos - 1] = (arr[pos - 1] ?? 0) + 1;
    width = Math.max(width, pos);
  };
  for (const r of records) {
    const f = r.perm_avg;
    if (f === undefined || !scoredIds.has(r.card_id)) continue;
    total++;
    if (f.chosen === null || f.positions === null) {
      illegal++;
      continue;
    }
    bump(original, f.positions.original);
    for (const s of f.positions.shown) {
      const row = rows.get(s.permutation) ?? [];
      bump(row, s.position);
      rows.set(s.permutation, row);
    }
  }
  const pad = (a: number[]): number[] => Array.from({ length: width }, (_, i) => a[i] ?? 0);
  return {
    width,
    rows: [...rows.keys()].sort(cmpPerm).map((permutation) => ({ permutation, counts: pad(rows.get(permutation) as number[]) })),
    original: pad(original),
    illegal,
    total,
  };
}

// ---------------------------------------------------------------- section 4c

export interface MultiplierDistribution {
  /** Call count -> number of Cards, ascending by call count. */
  readonly byCalls: readonly { readonly calls: number; readonly cards: number }[];
  readonly cards: number;
  /** Nearest-rank p50 and p95 (R14.1) of the per-Card sum of the calls' latencies, ms. */
  readonly sum: { readonly p50: number | 'no data'; readonly p95: number | 'no data' };
  /** Nearest-rank p50 and p95 of the per-Card maximum of the calls' latencies, ms. */
  readonly max: { readonly p50: number | 'no data'; readonly p95: number | 'no data' };
}

/** Request_Multiplier distribution and decision latency over the non-Void Scored_Cards of a derived file (R20.15, Property 55). */
export function multiplierDistribution(records: readonly ResultRecord[], scoredIds: ReadonlySet<string>): MultiplierDistribution {
  const lat = decisionLatencies(records).filter((l) => scoredIds.has(l.cardId));
  const counts = new Map<number, number>();
  for (const l of lat) counts.set(l.calls, (counts.get(l.calls) ?? 0) + 1);
  const sums = lat.map((l) => l.sumMs).sort((a, b) => a - b);
  const maxes = lat.map((l) => l.maxMs).sort((a, b) => a - b);
  return {
    byCalls: [...counts].sort(([a], [b]) => a - b).map(([calls, cards]) => ({ calls, cards })),
    cards: lat.length,
    sum: { p50: nearestRank(sums, 50), p95: nearestRank(sums, 95) },
    max: { p50: nearestRank(maxes, 50), p95: nearestRank(maxes, 95) },
  };
}
