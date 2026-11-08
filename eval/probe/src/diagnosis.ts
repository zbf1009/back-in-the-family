// Request-level D diagnosis (llm-probe task 20.6, Author's notes 1 and 2). Pure functions over a
// run's grade lines and the cards' option lists; no I/O, no model, no randomness.
//
// 1. Request-level random baseline: the expected acceptable share if every D request were answered
//    by a uniform pick among its card's options (acceptable_count / option_count per request). It is
//    computed from the cards and the requests that have a grade line, never hard-coded. It sits next
//    to the request-level acceptable count so a score near it reads as "random level".
// 2. Position diagnosis: which option position the model picks (in the card's original order and in
//    the order shown in that request's prompt) and how often the pick changes when the same card's
//    options are shuffled. This separates "position preference" from "unable to judge".
//
// Permutation names and their effect are the renderer's: `reversed`, `rotated_1`, `rotated_2`
// (left rotation `xs[k..] ++ xs[..k]`); `base` keeps the card order.
import type { LoadedCard } from './cards.ts';
import type { GradeLine } from './results.ts';

/** What the diagnosis needs of one D card. */
export interface DecisionCardFacts {
  readonly id: string;
  readonly scored: boolean;
  readonly void: boolean;
  /** Option IDs in the card's original (unshuffled) order. */
  readonly optionIds: readonly string[];
  readonly acceptableCount: number;
}

/** Reads a loaded card's D facts; null for an S card. */
export function decisionFactsFromLoaded(card: LoadedCard): DecisionCardFacts | null {
  if (card.task !== 'decision') return null;
  const env = JSON.parse(card.parsed) as {
    frozen_context?: { options?: { id: string }[] };
    random_baseline_parts?: { acceptable_count?: number } | null;
  };
  const options = env.frozen_context?.options;
  const acc = env.random_baseline_parts?.acceptable_count;
  if (!Array.isArray(options) || typeof acc !== 'number') throw new Error(`card ${card.id}: no options or acceptable_count in the parsed card`);
  return { id: card.id, scored: card.scored, void: card.void, optionIds: options.map((o) => o.id), acceptableCount: acc };
}

/** Index in the shown order of the option at `originalIndex` (0-based) under a named permutation. */
export function shownIndex(permutation: string, originalIndex: number, n: number): number {
  if (permutation === 'base') return originalIndex;
  if (permutation === 'reversed') return n - 1 - originalIndex;
  const m = /^rotated_(\d+)$/.exec(permutation);
  if (m !== null) {
    const k = Number(m[1]) % n;
    return (((originalIndex - k) % n) + n) % n;
  }
  throw new Error(`unknown permutation ${permutation}`);
}

/** Exact fraction; the denominator is the number of requests times LCD (60 covers 2..5 options). */
export interface Share {
  readonly num: number;
  readonly den: number;
}

export interface PositionRow {
  /** Number of options of the cards in this row. */
  readonly optionCount: number;
  /** Valid option picks on cards with this many options. */
  readonly picks: number;
  /** Picks per original position (index 0 = first option of the card), length `optionCount`. */
  readonly byOriginal: readonly number[];
  /** Picks per shown position in the request's prompt. */
  readonly byShown: readonly number[];
}

export interface DecisionDiagnosis {
  /** Graded D requests of counted cards (scored and Sanity; Void cards left out). */
  readonly requests: number;
  readonly acceptable: number;
  readonly illegal: number;
  /** Expected acceptable requests under a uniform random pick, as a share of `requests`. */
  readonly randomBaseline: Share | null;
  /** The same over Scored_Cards' requests only (no Sanity_Cards). */
  readonly scoredRequests: number;
  readonly scoredAcceptable: number;
  readonly scoredRandomBaseline: Share | null;
  readonly positions: readonly PositionRow[];
  /** Same card, both picks valid options: comparisons against the base pick, and how many differ. */
  readonly flipComparisons: number;
  readonly flips: number;
  /** Cards with at least two valid picks. */
  readonly cardsWithPicks: number;
  /** Of those: the same option ID in every request (the model judged the content, or ignores the order). */
  readonly stableByOption: number;
  /** Of those: the same shown position in every request (the model follows the position). */
  readonly stableByShownPosition: number;
}

const LCD = 60;

const shareOf = (parts: number, requests: number): Share | null => (requests === 0 ? null : { num: parts, den: requests * LCD });

/** Computes the D diagnosis of one run from its grade lines. Grade lines of other cards are ignored. */
export function diagnoseDecisions(cards: readonly DecisionCardFacts[], grades: readonly GradeLine[]): DecisionDiagnosis {
  const byId = new Map(cards.filter((c) => !c.void).map((c) => [c.id, c] as const));
  let requests = 0;
  let acceptable = 0;
  let illegal = 0;
  let baseParts = 0;
  let scoredRequests = 0;
  let scoredAcceptable = 0;
  let scoredParts = 0;
  const rows = new Map<number, { picks: number; byOriginal: number[]; byShown: number[] }>();
  const picksByCard = new Map<string, { permutation: string; option: string; shown: number }[]>();

  for (const g of grades) {
    const card = byId.get(g.card_id);
    if (card === undefined) continue;
    const n = card.optionIds.length;
    const flags = g.grade as { acceptable?: boolean; illegal?: boolean };
    requests++;
    baseParts += (card.acceptableCount * LCD) / n;
    if (flags.acceptable === true) acceptable++;
    if (flags.illegal === true) illegal++;
    if (card.scored) {
      scoredRequests++;
      scoredParts += (card.acceptableCount * LCD) / n;
      if (flags.acceptable === true) scoredAcceptable++;
    }
    const id = g.identity as { kind?: string; option?: string };
    if (id.kind !== 'option' || typeof id.option !== 'string') continue;
    const orig = card.optionIds.indexOf(id.option);
    if (orig < 0) continue;
    const shown = shownIndex(g.permutation, orig, n);
    const row = rows.get(n) ?? { picks: 0, byOriginal: new Array<number>(n).fill(0), byShown: new Array<number>(n).fill(0) };
    row.picks++;
    row.byOriginal[orig] = (row.byOriginal[orig] ?? 0) + 1;
    row.byShown[shown] = (row.byShown[shown] ?? 0) + 1;
    rows.set(n, row);
    const list = picksByCard.get(card.id) ?? [];
    list.push({ permutation: g.permutation, option: id.option, shown });
    picksByCard.set(card.id, list);
  }

  let flipComparisons = 0;
  let flips = 0;
  let cardsWithPicks = 0;
  let stableByOption = 0;
  let stableByShownPosition = 0;
  for (const list of picksByCard.values()) {
    const base = list.find((p) => p.permutation === 'base');
    if (base !== undefined) {
      for (const p of list) {
        if (p === base) continue;
        flipComparisons++;
        if (p.option !== base.option) flips++;
      }
    }
    if (list.length < 2) continue;
    cardsWithPicks++;
    if (list.every((p) => p.option === list[0]?.option)) stableByOption++;
    if (list.every((p) => p.shown === list[0]?.shown)) stableByShownPosition++;
  }

  return {
    requests,
    acceptable,
    illegal,
    randomBaseline: shareOf(baseParts, requests),
    scoredRequests,
    scoredAcceptable,
    scoredRandomBaseline: shareOf(scoredParts, scoredRequests),
    positions: [...rows].sort(([a], [b]) => a - b).map(([optionCount, r]) => ({ optionCount, picks: r.picks, byOriginal: r.byOriginal, byShown: r.byShown })),
    flipComparisons,
    flips,
    cardsWithPicks,
    stableByOption,
    stableByShownPosition,
  };
}

/** Percent with one decimal, from an exact share; "n/a" when absent. Round half up on integers. */
export function sharePercent(s: Share | null): string {
  if (s === null) return 'n/a';
  const tenths = Math.floor((s.num * 1000 + Math.floor(s.den / 2)) / s.den);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** Expected number of acceptable requests under a uniform random pick, one decimal ("41.0"). */
export function expectedCount(s: Share | null): string {
  if (s === null) return 'n/a';
  const tenths = Math.floor((s.num * 10 + Math.floor(LCD / 2)) / LCD);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

const pctOf = (num: number, den: number): string => (den === 0 ? 'n/a' : sharePercent({ num, den }));

/** The emitted lines for one run's D diagnosis. `label` names the figures (Dev_Run or Locked_Run). */
export function diagnosisLines(d: DecisionDiagnosis, label: string): string[] {
  const out: string[] = [];
  out.push(
    `${label} D, request level: acceptable ${d.acceptable}/${d.requests} (${pctOf(d.acceptable, d.requests)}) against a random baseline of ${sharePercent(d.randomBaseline)} (expected ${expectedCount(d.randomBaseline)} of ${d.requests}); Scored_Cards' requests only: ${d.scoredAcceptable}/${d.scoredRequests} (${pctOf(d.scoredAcceptable, d.scoredRequests)}) against ${sharePercent(d.scoredRandomBaseline)}. Illegal requests: ${d.illegal}.`,
  );
  out.push(
    `${label} D, shuffle: ${d.flips} of ${d.flipComparisons} comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of ${d.cardsWithPicks} cards with at least two valid picks, ${d.stableByOption} kept the same option in every order and ${d.stableByShownPosition} kept the same shown position in every order.`,
  );
  for (const r of d.positions) {
    out.push(`${label} D, ${r.optionCount}-option cards, ${r.picks} valid picks: by original position ${r.byOriginal.join(' / ')}; by shown position ${r.byShown.join(' / ')} (uniform would be ${(r.picks / r.optionCount).toFixed(1)} each).`);
  }
  return out;
}
