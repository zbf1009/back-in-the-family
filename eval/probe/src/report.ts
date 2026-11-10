// Report generator (llm-probe task 10.2; requirements 3.8, 9.2, 9.3, 9.10, 9.11, 9.17, 10.10,
// 13.9, 13.10, 13.12, 14.4 to 14.8, 14.10, 15.1 to 15.7, 15.10 to 15.12, 18.6 to 18.8).
//
// `buildReport(input)` is a pure function: injected data in, Markdown text out. The Report calls
// the very same `browserPass` as the phase gate (phase.ts), fed by pass results derived from the
// Locked_Run analyses in this file, so the support marks and the phase gate cannot disagree.
//
// Card content: the Report prints Card IDs, Contrast_Pair IDs and scenario-group counts only.
// Nothing in this module renders a prompt; the card objects it reads are `MetricCard`s (parsed
// facts such as `task`, `scored`, `void`, `pair_id`), and every output comes from stored Results
// and grades files.
import { splitCpuNodes } from './adapters/placement.ts';
import type { TaskType } from './cards.ts';
import { chooseReportEntries, subsetTaskTypes, type LedgerEntry } from './ledger.ts';
import { diagnoseDecisions, diagnosisLines, type DecisionCardFacts, type DecisionDiagnosis } from './diagnosis.ts';
import { computeMetrics, isByConstruction, passLabel, THRESHOLDS, type FaultRecord, type MetricCard, type Ratio, type SanityResult, type TaskMetrics, type Verdict } from './metrics.ts';
import {
  browserPassEntry,
  decisionHold,
  decisionHoldPending,
  decisionModelApprovals,
  describeBranch,
  hasFailure,
  isDecisionModel,
  isDecisionVariant,
  isPermAvg,
  isWorkersAi,
  phase2Candidates,
  phaseStatus,
  usedEntryId,
  withdrawnIds,
  IN_BROWSER_DOWNLOAD_LIMIT_BYTES,
  type Combination,
  type EntryPasses,
  type PhaseState,
} from './phase.ts';
import { canonicalJson, countsForGate, effectiveFailure } from './results.ts';
import {
  FINE_TUNING_SENTENCE,
  FINE_TUNING_TITLE,
  multiplierDistribution,
  NON_INDEPENDENCE_SENTENCE,
  ONE_REQUEST_ALTERNATIVE,
  PERM_AVG_FLIP_CELL,
  permAvgMark,
  positionDistribution,
  PREREGISTRATION_SENTENCE,
  PRODUCTION_NOTE,
} from './report-variants.ts';
import type { ExcludedLine, GradesFile, JsonObject, PerfRecord, PreflightRecord, ResultRecord, ResultsHeader, SmokeRecord } from './results.ts';
import {
  clusterBootstrapAcceptable,
  clusterBootstrapIllegal,
  groupUnits,
  intraGroupCorrelation,
  latencySummary,
  pairBootstrap,
  weakEvidenceLabel,
  wilsonInterval,
  type BootstrapInterval,
  type Frac,
  type IccResult,
  type LatencySummary,
  type PassLabel,
  type WilsonInterval,
} from './stats.ts';

// ---------------------------------------------------------------- constants

export const NVIDIA_MEMORY_COLUMN = 'NVIDIA device memory.used delta, MiB';
export const INTEL_MEMORY_QUANTITY = 'Chrome GPU process peak RSS (excludes unmapped GEM buffers)';
/** The Author's reading of the iteration-2 Dev_Runs (2026-11-08); fixed text, the figures are checked by hand in docs/kiro-log.md. */
export const DEV_D_FINDING =
  'Reading of the Dev_Runs with the frozen D template (Author, 2026-11-08): Qwen3.5-0.8B 43/74 and Qwen3.5-2B 38/74 acceptable D requests are at random level (see the request-level random baseline below, about 41 of 74); contrast-pair consistency is 0 of the pairs; and the gain from the first template to the frozen one came mainly from fewer Illegal outputs (the model stopped writing a leading dash and a wrong ID), not from better judgement. The final Dev_Runs with the frozen hashes gave the same picture: Qwen3.5-0.8B 43/74 on NVIDIA (the two earlier Intel-labelled runs with the same 43/74 are INVALID: they ran on the NVIDIA GPU, see the Intel finding below) and Qwen3.5-2B 34/74 (8 Illegal, mostly Timeouts; run-to-run latency noise moved it from 38/74).';

/** The corrected Intel Dev_Run (dev-20261108T044612Z): a latency finding, checked against its Results file and in docs/kiro-log.md. */
export const INTEL_TIMEOUT_RUN_ID = 'dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel';
export const INTEL_TIMEOUT_FINDING =
  'Intel iGPU finding (Dev_Run, corrected run dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel, device_mismatch false): all 74 D requests hit the 10 s timeout; the Late_Answers arrived after 11,975 / 14,955 / 17,495 ms (min / median / max), about 6.7 times the 2,245 ms NVIDIA median of the same Combination. In S, 3 requests timed out and 27 ended in `runtime_error` ("The current Object has already been disposed") after the repeated timeouts; the cause was not investigated. So no Intel quality figure exists for the frozen templates; the run shows a latency result only: the Intel iGPU cannot meet the 10 s limit for the 0.8B. The two earlier Intel-labelled runs are INVALID (device_mismatch) and show no Intel figure.';

/**
 * Author's condition 3 (2026-11-08). The dev figures are from `dev.jsonl` (checked 2026-11-08: 15 scored four-option D cards
 * have exactly one severe option and it is the fourth in card order; the two unscored two-option Sanity_Cards also have it
 * last, so 17 D cards in all). The locked distribution is the Author's statement; it was not computed or read here.
 */
export const DEV_CONFOUND_NOTE =
  'Position/content confound in the dev set: in `dev.jsonl` all 15 scored D cards that have a severe option list it last in card order (the two unscored two-option Sanity_Cards do too). Option rotation was applied only to the locked set; this was an oversight on the card-authoring side, and the cards are locked and are not changed. So in the Dev_Runs a model that prefers the last-listed option cannot be told apart from one that prefers the severe content. Per the Author, the severe options of the locked set are distributed last 14, middle 26, first 7. The position-versus-content question is therefore to be settled from the Locked_Run results, not from the Dev_Runs.';

export const DEV_SECTION_TITLE = 'Dev_Run figures (not used for the recommendation)';
export const QUALITY_WITHOUT_TIMEOUT_TITLE = 'Quality without timeout (not used for any mark, label or recommendation)';

export const PREFLIGHT_FINDINGS_TITLE = 'VRAM_Preflight findings and their limits';

/**
 * Fixed notes the Author asked the Report to carry (2026-11-08). They qualify the Exclusion_Records above and change none
 * of them. Raw evidence: `eval/results/preflight/*.json`, `attempts.jsonl`, `diagnosis/*.json`.
 */
export const PREFLIGHT_FINDINGS: readonly string[] = [
  'Both Qwen3.5 ONNX exports (0.8B and 2B, q4) run out of GPU memory in the prefill step (new_tokens = 0, `vkAllocateMemory` returned `VK_ERROR_OUT_OF_DEVICE_MEMORY`) on transformers.js 4.3.2 with onnxruntime-web 1.31.0-dev.20260914-8d85527a0, on the 4,096 MiB RTX 3050 Ti, with the 9.4 KB VRAM_Preflight prompt. Their Exclusion_Records carry the reason `out_of_memory`, not a peak above 2,600 MiB.',
  'The peak figures of those two runs are readings at the moment of the crash, not complete peaks: 2,128 MiB (0.8B, delta over a 44 MiB baseline; 2,172 MiB absolute) and 3,090 MiB (2B, delta over a 46 MiB baseline; 3,136 MiB absolute). The 2B figure being above 2,600 MiB is not the reason for its exclusion.',
  'This is not a matter of model size: the larger LFM2.5-1.2B-Instruct runs the same preflight to the end (1,024 tokens, peak 2,675 MiB). It stays excluded because 2,675 MiB is above the 2,600 MiB limit, which was not relaxed.',
  'Clue: the placement log shows that both Qwen3.5 exports put 18 gated-delta-net `Scan` nodes on the CPU, so every step needs a CPU to GPU copy.',
  'Per the Author, onnxruntime already has a WebGPU LinearAttention fused operator for Qwen3.5, but these exports do not use it. The Report has not verified this statement independently.',
  'The exclusion conclusion does not change. It covers the Qwen3.5 ONNX exports on transformers.js with this onnxruntime-web build only. The browser-side conclusion covers only the Qwen3.5 family on WebLLM; it does not represent all in-browser models.',
  'Intel iGPU memory is the GPU process peak RSS. It excludes unmapped GEM buffers and is a different quantity from the NVIDIA device memory.used delta. The two are never compared and never share a column in this Report.',
  'Prompt-length diagnosis (Report only; no Exclusion_Record was written or changed from it): Qwen3.5-0.8B (transformers.js, NVIDIA) was run again with prompts built from Dev_Cards only. A 1,560-byte prompt completed all 1,024 tokens (no OOM, peak 1,392 MiB). The longest Dev_Card prompt, 4,689 bytes, also completed all 1,024 tokens (no OOM, peak 2,726 MiB, above the 2,600 MiB limit). The 9.4 KB preflight prompt ran out of memory in prefill. So the failure depends on prompt length, and the memory peak grows steeply with it. The raw records are in `eval/results/preflight/diagnosis/`. The VRAM_Preflight rule (R9.16) fixes the prompt, so the Exclusion_Record stands.',
];

/** The Target_Machine of the glossary; the Report states it (R14.8). */
export const TARGET_MACHINE =
  'NVIDIA GeForce RTX 3050 Ti Laptop GPU (4,096 MiB VRAM, driver 615.78.08), Intel UHD Graphics (TigerLake-H GT1), Intel i7-11800H (16 threads), 15 GiB RAM, Linux, Chrome 155';

// ---------------------------------------------------------------- analysis of one run

export interface RateStats {
  readonly cluster: BootstrapInterval | null;
  readonly wilson: WilsonInterval | null;
  readonly icc: IccResult;
}

/** Everything the Report prints for one Task_Type of one run. */
export interface TaskAnalysis {
  readonly metrics: TaskMetrics;
  readonly acceptable: RateStats;
  readonly illegal: RateStats;
  readonly contrastInterval: BootstrapInterval | null;
  readonly latency: LatencySummary;
  /** R13.9 label, only when the acceptable rate passes. */
  readonly acceptableLabel: PassLabel | null;
  /** R13.9 label, only when contrast consistency passes. */
  readonly contrastLabel: PassLabel | null;
  /** Rendered mark text for a passing acceptable rate (states the lower bound when it is under the Threshold). */
  readonly acceptableMark: string | null;
  /** Rendered mark text for a passing contrast consistency. */
  readonly contrastMark: string | null;
}

export interface ExcludedPair {
  readonly pairId: string;
  readonly reason: string;
}

/** Result of analysing one Results file with its grades (a Locked_Run entry or a Dev_Run). */
export interface RunAnalysis {
  readonly kind: 'locked' | 'dev';
  /** Ledger entry ID (locked) or run ID (dev). */
  readonly id: string;
  readonly combination: string;
  readonly header: ResultsHeader;
  readonly tasks: readonly TaskAnalysis[];
  readonly sanity: readonly SanityResult[];
  readonly excluded: ExcludedLine['excluded'];
  readonly excludedPairs: readonly ExcludedPair[];
  readonly faults: readonly FaultRecord[];
  readonly combinationFailed: boolean;
  /** Distinct `source` values of the records (`headless`, `probe_page`, `node`). */
  readonly sources: readonly string[];
  readonly perf: PerfRecord | null;
  /** Request-level D baseline and position diagnosis; absent when the D cards were not supplied. */
  readonly decisionDiagnosis?: DecisionDiagnosis | null;
}

export interface RunInputs {
  readonly kind: 'locked' | 'dev';
  readonly id: string;
  readonly cards: readonly MetricCard[];
  readonly header: ResultsHeader;
  readonly records: readonly ResultRecord[];
  readonly grades: GradesFile;
  readonly perf: PerfRecord | null;
  /** D card facts of the run's split; when given, the run's D request-level diagnosis is computed. */
  readonly decisionCards?: readonly DecisionCardFacts[];
}

function rateStats(r: Ratio, cluster: BootstrapInterval | null, perCard: TaskMetrics['perCard'], pick: (c: TaskMetrics['perCard'][number]) => boolean): RateStats {
  return {
    cluster,
    wilson: wilsonInterval(r.num, r.den),
    icc: intraGroupCorrelation(groupUnits(perCard, pick)),
  };
}

/** Pairs left out of the contrast count, with a written reason (R15.7). */
export function excludedPairsOf(cards: readonly MetricCard[], tasks: readonly TaskType[]): ExcludedPair[] {
  const byPair = new Map<string, { a?: MetricCard; b?: MetricCard }>();
  for (const c of cards) {
    if (c.pairId === null || c.role === null) continue;
    const slot = byPair.get(c.pairId) ?? {};
    slot[c.role] = c;
    byPair.set(c.pairId, slot);
  }
  const out: ExcludedPair[] = [];
  for (const [pairId, { a, b }] of [...byPair].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    if (a === undefined || b === undefined || !tasks.includes(a.task)) continue;
    const why: string[] = [];
    for (const c of [a, b]) {
      if (c.void) why.push(`card ${c.id} is a Void_Card`);
      else if (!c.scored) why.push(`card ${c.id} is a Sanity_Card`);
    }
    if (why.length > 0) out.push({ pairId, reason: why.join('; ') });
  }
  return out;
}

/** Computes Metrics, intervals and latency of one run from loaded cards, Results and grades. */
export function analyzeRun(input: RunInputs): RunAnalysis {
  const tasks = subsetTaskTypes(input.header.task_subset);
  const metrics = computeMetrics({ cards: input.cards, records: input.records, grades: input.grades.grades, contrasts: input.grades.contrasts, tasks, flip: input.header.variant === 'perm_avg' ? 'by_construction' : 'measured' });
  const taskOfCard = new Map(input.cards.map((c) => [c.id, c.task] as const));
  const analyses: TaskAnalysis[] = metrics.tasks.map((m) => {
    const acceptable = rateStats(m.acceptable, clusterBootstrapAcceptable(m.perCard), m.perCard, (c) => c.acceptable);
    const illegal = rateStats(m.illegal, clusterBootstrapIllegal(m.perCard), m.perCard, (c) => c.illegal);
    const contrastInterval = pairBootstrap(m.pairs);
    const latency = latencySummary(
      input.records.filter((r) => taskOfCard.get(r.card_id) === m.task).map((r) => ({ outcome: r.outcome, latency_ms: r.latency_ms })),
    );
    return {
      metrics: m,
      acceptable,
      illegal,
      contrastInterval,
      latency,
      acceptableLabel: m.acceptable.verdict === 'pass' && acceptable.cluster !== null ? weakEvidenceLabel(acceptable.cluster.lower, THRESHOLDS.acceptablePct) : null,
      contrastLabel: m.contrast.verdict === 'pass' && contrastInterval !== null ? weakEvidenceLabel(contrastInterval.lower, THRESHOLDS.contrastPct) : null,
      acceptableMark: m.acceptable.verdict === 'pass' && acceptable.cluster !== null ? passMarkText(acceptable.cluster.lower, THRESHOLDS.acceptablePct, 'Cluster_Bootstrap') : null,
      contrastMark: m.contrast.verdict === 'pass' && contrastInterval !== null ? passMarkText(contrastInterval.lower, THRESHOLDS.contrastPct, 'pair bootstrap') : null,
    };
  });
  return {
    kind: input.kind,
    id: input.id,
    combination: input.header.combination,
    header: input.header,
    tasks: analyses,
    sanity: metrics.sanity,
    excluded: metrics.excluded,
    excludedPairs: excludedPairsOf(input.cards, tasks),
    faults: metrics.faults,
    combinationFailed: metrics.combinationFailed,
    sources: [...new Set(input.records.map((r) => r.source))].sort(),
    perf: input.perf,
    decisionDiagnosis: input.decisionCards !== undefined && tasks.includes('decision') ? diagnoseDecisions(input.decisionCards, input.grades.grades) : null,
  };
}

/** Engine faults and rebuild failures in a Results file, for entries that are not analysed (R8.5, R8.13). */
export function scanFaults(records: readonly ResultRecord[]): FaultRecord[] {
  const out: FaultRecord[] = [];
  for (const r of records) {
    if (r.outcome.kind === 'engine_fault') out.push({ cardId: r.card_id, permutation: r.permutation, kind: 'engine_fault', code: r.outcome.code });
    else if (r.outcome.kind === 'not_run' && r.outcome.reason === 'rebuild_failed') out.push({ cardId: r.card_id, permutation: r.permutation, kind: 'rebuild_failed' });
  }
  return out;
}

/** Pass per Task_Type for each analysed Locked_Run, the shape `browserPass` reads. */
export function entryPassesFrom(runs: readonly RunAnalysis[]): Map<string, EntryPasses> {
  const out = new Map<string, EntryPasses>();
  for (const run of runs) {
    if (run.kind !== 'locked') continue;
    const p: { decision?: boolean; synthesis?: boolean } = {};
    for (const t of run.tasks) p[t.metrics.task] = t.metrics.passes && t.metrics.usableForMark;
    out.set(run.id, p);
  }
  return out;
}

// ---------------------------------------------------------------- Report input

export type ReportState = Omit<PhaseState, 'passes' | 'overLimit'>;

export interface RuntimeLibrary {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly url: string;
}

export interface ReportInput {
  /** `YYYY-MM-DD`; supplied by the caller so the output is a function of the input. */
  readonly generated_on: string;
  readonly environment: { readonly targetMachine: string; readonly workersEndpoint: string | null };
  /** Ledger, failure and Exclusion_Records, Smoke_Calls, Combinations, approvals from `HEAD`. */
  readonly state: ReportState;
  /** Analyses of the `complete` Locked_Run entries (one per entry ID). */
  readonly lockedRuns: readonly RunAnalysis[];
  /** Faults found in Results of entries that are not analysed (incomplete entries), by entry ID. */
  readonly incompleteFaults: ReadonlyMap<string, readonly FaultRecord[]>;
  readonly devRuns: readonly RunAnalysis[];
  /** VRAM_Preflight results by Combination ID. */
  readonly preflights: ReadonlyMap<string, PreflightRecord>;
  readonly runtimeLibraries: readonly RuntimeLibrary[];
  /**
   * Ingested External_References (R19.16), as plain data read by the CLI. Printed in section 12 only. `report.ts` does not
   * import `external.ts`: nothing in the marks, the link marks, the recommendations or the Phase_2 branch can see them.
   */
  readonly external?: readonly ExternalReferenceView[];
  /** Author-supplied External references (task 43; R20.18, R20.19), as plain data read by the CLI. Printed in section 12 only. */
  readonly authorSupplied?: readonly AuthorSuppliedView[];
  /**
   * Derived_Run files (R20.7) of both splits, already analysed (flip `by_construction`) with their stored records. Printed in
   * sections 2, 4, 4a, 4b and 4c; a `locked` one feeds a mark, a `dev` one is labelled Dev_Run and feeds none. Absent means none.
   */
  readonly derivedRuns?: readonly DerivedRunView[];
}

/** One Derived_Run file as the Report reads it. */
export interface DerivedRunView {
  readonly split: 'dev' | 'locked';
  readonly analysis: RunAnalysis;
  readonly records: readonly ResultRecord[];
}

/** The Metric figures of an External_Reference (integers; the names are those of the Metrics). */
export interface ExternalFiguresView {
  readonly acceptable: number;
  readonly scored_cards: number;
  readonly severe: number;
  readonly illegal: number;
  readonly flip_perms: number;
  readonly flips: number;
  readonly consistent_pairs: number;
  readonly pairs: number;
}

/** What section 12 prints about one stored External_Reference (the shape of its `record.json`). */
export interface ExternalReferenceView {
  readonly label: string;
  readonly reference_model: string;
  readonly task_type: 'D' | 'S';
  readonly pinned_manifest_hash: string;
  readonly reference_sha256: string;
  readonly config: { readonly file: string; readonly sha256: string };
  readonly ledger: { readonly file: string; readonly sha256: string };
  readonly results: { readonly file: string; readonly sha256: string };
  readonly raw_outputs: { readonly file: string; readonly sha256: string; readonly answer_mode: string } | null;
  readonly supplied: ExternalFiguresView;
  readonly regrade: 'match' | 'mismatch' | null;
  readonly regrade_figures: ExternalFiguresView | null;
  readonly differing: readonly string[];
  readonly raw_output_count: number | null;
}

/** One task of an Author-supplied External reference (the shape of `author-supplied.json`; integers only). */
export interface AuthorSuppliedTaskView {
  readonly task_type: 'D' | 'S';
  readonly config_id: string;
  readonly run_id: string;
  readonly model: string;
  readonly thinking: boolean;
  readonly template: string;
  readonly template_sha256: string;
  readonly results_sha256: string;
  readonly grades_sha256: string;
  readonly figures: { readonly acceptable: number; readonly scored_cards: number; readonly severe: number; readonly flips: number; readonly flip_perms: number; readonly consistent_pairs: number; readonly pairs: number };
  readonly acceptable_cluster_lower_bound_tenths_pct: number | null;
  readonly archive_summary: { readonly records: number; readonly errors: number; readonly truncated: number; readonly model_mismatch: number };
}

/** What section 12 prints about one Author-supplied External reference. */
export interface AuthorSuppliedView {
  readonly verification: string;
  readonly label: string;
  readonly supplied_by: string;
  readonly run_date: string;
  readonly workbench: string;
  readonly archive: {
    readonly path: string;
    readonly freeze_and_ledger_start_commit: { readonly short: string; readonly full: string };
    readonly results_and_complete_commit: { readonly short: string; readonly full: string };
    readonly freeze_json_sha256: string;
    readonly ledger_sha256: string;
  };
  readonly evaluated_repo_head: { readonly short: string; readonly full: string };
  readonly frozen: { readonly manifest_sha256: string; readonly locked_sha256: string; readonly wasm_sha256: string };
  readonly grading: string;
  readonly post_hoc_note: { readonly text: string; readonly attributed_to: string; readonly archive_commit: string };
  readonly tasks: readonly AuthorSuppliedTaskView[];
  /** sha256 of the checked-in `author-supplied.json` bytes. */
  readonly file_sha256: string;
}

// ---------------------------------------------------------------- small helpers

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null);
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const dig = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((acc, k) => asRec(acc)?.[k], v);

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  if (rows.length === 0) return [];
  return [`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`), ''];
}

/** `n.d%` rounded half up from integers; "not computable" for a zero denominator. */
function pct(num: number, den: number): string {
  if (den <= 0) return 'not computable';
  const t = Math.floor((num * 2000 + den) / (2 * den));
  return `${Math.floor(t / 10)}.${t % 10}%`;
}
const fracPct = (f: Frac): string => pct(f.k, f.m);

/**
 * Mark of a passing Metric from its interval lower bound (R13.9). At or above the Threshold: "pass".
 * Under it: the R13.9 label, followed by the point-estimate statement with the actual lower bound.
 */
export function passMarkText(lower: Frac, thresholdPct: number, method: string): string {
  const label = weakEvidenceLabel(lower, thresholdPct);
  if (label === 'pass') return 'pass';
  const detail = `point estimate; 95% ${method} lower bound ${fracPct(lower)} < ${thresholdPct}%`;
  return label === 'pass with weak evidence' ? `pass with weak evidence (${detail})` : `pass (${detail})`;
}

/** Model_Key as text: empty segments are omitted; a commit hash is shortened, a text revision is kept whole. */
export function modelKeyText(k: { runtime: string; model_id: string; quantization: string; revision: string }): string {
  const revision = /^[0-9a-f]{40}$/.test(k.revision) ? k.revision.slice(0, 12) : k.revision;
  return [k.runtime, k.model_id, k.quantization, revision].filter((x) => x !== '').join(' / ');
}
const ratioText = (r: Ratio): string => (r.den === 0 ? `${r.num}/${r.den} (not computable)` : `${r.num}/${r.den}`);
const ratioPct = (r: Ratio): string => pct(r.num, r.den);

function mib(bytes: number): string {
  const t = Math.floor((bytes * 10 + 524288) / 1048576);
  return `${Math.floor(t / 10)}.${t % 10}`;
}

const taskLetter = (t: TaskType): string => (t === 'decision' ? 'D' : 'S');
const taskTitle = (t: TaskType): string => `Task_Type ${taskLetter(t)} (${t})`;
/** Author's scope statement, repeated in section 9 (Author review of docs/llm-probe.md). */
export const RECOMMENDATION_SCOPE =
  'The in-browser conclusion covers only Qwen3.5 on WebLLM. The Workers AI conclusion covers only gemma-4-26b-a4b-it with the frozen templates, thinking disabled and one call per request; it does not represent other models on Workers AI or other ways of calling them.';
const TASKS: readonly TaskType[] = ['decision', 'synthesis'];

/** Section 2: printed exactly when two or more Phase_2 candidates were tried (R19.13). The Thresholds are not adjusted. */
export const SELECTION_BIAS_NOTE =
  'Several candidates were tried against the same Locked_Cards. This creates a selection bias through multiple comparisons. The Thresholds were not adjusted for it. A pass of the best of several candidates is weaker evidence than a pass of a single pre-chosen one.';

/** Section 9: printed exactly while `decisionHold(state)` is true (R19.17). */
export const HOLD_BANNER_PREFIX = 'Runtime decision on hold (R19.17): Decision_Model(s) pending: ';

export const EXTERNAL_SECTION_TITLE = '12. External reference (not a repo Combination)';
export const EXTERNAL_SENTENCE =
  'This is an external reference measurement, not a Combination of this repository; it is not part of any mark, link mark, recommendation, Phase_2 branch logic or the Locked_Run_Ledger.';

/** V14: repeated identical requests giving the same `choice`. Printed "not tested" unless a Smoke record carries a `repeat_pair` result. */
function repeatDeterminismText(state: PhaseState, comboId: string): string {
  const pairs = state.smoke.filter((r) => r['combination'] === comboId && asRec(r['repeat_pair']) !== null);
  if (pairs.length === 0) return 'not tested';
  const same = pairs.filter((r) => asRec(r['repeat_pair'])?.['same_choice'] === true).length;
  return `measured: the same choice in ${same} of ${pairs.length} repeated pair(s)`;
}

function notMeasuredReason(c: Combination, state: PhaseState): string {
  // A Smoke_Call that failed at the HTTP level (plan or billing error, 429) has no shape_check, so it is looked at first (R19.3, V13).
  const calls = state.smoke.filter((s) => s['combination'] === c.id);
  const last = calls[calls.length - 1];
  const status = last?.['http_status'];
  if (typeof status === 'number' && status !== 200) {
    return `the newest Smoke_Call failed with HTTP status ${status}${typeof last?.['outcome'] === 'string' ? ` (${last['outcome']})` : ''}, so no shape check was possible`;
  }
  const shapes = calls.filter((s) => s['shape_check'] !== undefined);
  const newest = shapes[shapes.length - 1];
  if (newest !== undefined && newest['shape_check'] !== 'ok') {
    return `the newest Smoke_Call shape check is ${String(newest['shape_check'])} (HTTP status ${String(newest['http_status'] ?? 'unknown')})`;
  }
  return 'no Dev_Run or Locked_Run approval has been recorded for it (R19.4), so nothing beyond the Smoke_Calls has been run';
}

/** The Additional_Candidate_Set of section 2: each Decision_Model with its approval IDs and dates, or "not measured" with the reason (R19.13, R19.3). */
export function additionalCandidateLines(state: PhaseState): string[] {
  const models = state.combinations.filter(isDecisionVariant);
  if (models.length === 0) return ['- none is defined in `combinations.json`'];
  const approvals = state.approvals.approved ? state.approvals.approvals : [];
  const gone = withdrawnIds(approvals);
  return models.map((c) => {
    if (isPermAvg(c)) {
      const mine = approvals.filter((a) => a.kind === 'decision_model' && a.combination === c.id);
      const live = mine.filter((a) => !gone.has(a.id));
      const withdrawn = mine.filter((a) => gone.has(a.id));
      const files = (state.derived ?? []).filter((d) => d.combination === c.id);
      const parts: string[] = [];
      if (live.length > 0) parts.push(`approval IDs ${live.map((a) => `${a.id} (${a.step ?? 'step not recorded'}, ${a.approved_on ?? 'date not recorded'})`).join(', ')}`);
      if (withdrawn.length > 0) parts.push(`withdrawn ${withdrawn.map((a) => a.id).join(', ')}`);
      parts.push(files.length > 0 ? `Derived_Run file(s): ${files.map((d) => `${d.split} ${d.run_id}`).join(', ')}` : 'no Derived_Run yet (not measured)');
      return `- ${c.id} (Task_Type D only, variant perm_avg, derived from the stored records of ${String(c.derives_from)}, 0 requests): ${parts.join('; ')}.`;
    }
    const live = decisionModelApprovals(approvals, c.id);
    const withdrawn = approvals.filter((a) => a.kind === 'decision_model' && a.combination === c.id && gone.has(a.id));
    const complete = [...state.entries]
      .filter((e) => e.start.combination === c.id && e.status === 'complete' && subsetTaskTypes(e.start.task_subset).includes('decision'))
      .sort((a, b) => a.order - b.order);
    const exclusion = state.exclusions.find((x) => x.combination === c.id);
    const failures = state.failures.filter((f) => f.combination === c.id && countsForGate(f));
    const parts: string[] = [];
    if (live.length > 0) parts.push(`approval IDs ${live.map((a) => `${a.id} (${a.step ?? 'step not recorded'}, ${a.approved_on ?? 'date not recorded'})`).join(', ')}`);
    if (withdrawn.length > 0) parts.push(`withdrawn ${withdrawn.map((a) => a.id).join(', ')}`);
    const last = complete[complete.length - 1];
    if (last !== undefined) parts.push(`Locked_Run entry ${last.entry_id} complete (its figures are in section 4)`);
    else if (exclusion !== undefined) parts.push(`Exclusion_Record (${exclusion.check})`);
    else if (failures.length > 0) parts.push(`non-transient failure record (${failures.map((f) => f.kind).join(', ')})`);
    else if (live.length > 0) parts.push('approved, no completed Locked_Run yet');
    else parts.push(`not measured: ${notMeasuredReason(c, state)}`);
    return `- ${c.id} (Task_Type D only): ${parts.join('; ')}. Repeat-request determinism of \`choice\` (V14): ${repeatDeterminismText(state, c.id)}.`;
  });
}

/** Figure names that decide each row of the section 12 table. */
const EXTERNAL_ROWS: readonly { readonly label: string; readonly names: readonly (keyof ExternalFiguresView)[]; readonly show: (f: ExternalFiguresView) => string }[] = [
  { label: 'Acceptable rate', names: ['acceptable', 'scored_cards'], show: (f) => `${f.acceptable}/${f.scored_cards} = ${pct(f.acceptable, f.scored_cards)}` },
  { label: 'Severe count', names: ['severe', 'scored_cards'], show: (f) => `${f.severe} of ${f.scored_cards} cards` },
  { label: 'Illegal rate', names: ['illegal', 'scored_cards'], show: (f) => `${f.illegal}/${f.scored_cards} = ${pct(f.illegal, f.scored_cards)}` },
  { label: 'Flip rate', names: ['flips', 'flip_perms'], show: (f) => `${f.flips}/${f.flip_perms} = ${pct(f.flips, f.flip_perms)}` },
  { label: 'Contrast consistency', names: ['consistent_pairs', 'pairs'], show: (f) => `${f.consistent_pairs}/${f.pairs} pairs = ${pct(f.consistent_pairs, f.pairs)}` },
];

export const AUTHOR_SUPPLIED_NOTE =
  'This is an External_Reference, not a Locked_Run Combination of this repository. It takes part in no mark, link mark, recommendation, branch logic or ledger (R19.16), and the Report computes no Threshold verdict for it; the only verdict printed is the Author\'s own text below (Amendment RC-20).';

/**
 * The Author\'s answer to RC-20 (2026-11-10), printed VERBATIM in the section 12 External reference subsection (R20.18).
 * A fixed constant, not a field of `author-supplied.json`, so the checked-in file (a record of figures as supplied) and its
 * reader stay unchanged. It must appear exactly once in the Report, and only in section 12.
 */
export const RC20_AUTHOR_TEXT =
  "Under this probe's Thresholds the teacher D reference fails flip (34 of 172) and contrast (11 of 15, below 12 of 15); the teacher S reference fails flip only (7 of 44). No reference configuration passes all four Thresholds. One D request (D-reconcile_or_revenge-008, permutation rotated_1) reached the 16,384-token output cap with empty content; it is graded Illegal and, being a non-base Permutation, affects only the flip count (it counts as a flip under R13.2; without it the flip rate is at least 33 of 171).";

/** Percent with one decimal from tenths (915 gives 91.5%). */
const tenths = (t: number): string => `${Math.floor(t / 10)}.${t % 10}%`;

/** The "External reference" subsection of section 12 for one Author-supplied file (R20.18, R20.19). Figures are printed as supplied; no verdict. */
export function authorSuppliedLines(r: AuthorSuppliedView): string[] {
  const out: string[] = [`### External reference: ${r.label} (${r.verification})`, ''];
  out.push(AUTHOR_SUPPLIED_NOTE, '');
  out.push(`- Label: ${r.verification}. The figures below are recorded exactly as the ${r.supplied_by} supplied them; ingest did not check or re-grade them.`);
  out.push(`- Run on ${r.run_date} outside this repository, in an "${r.workbench}" workbench; archive \`${r.archive.path}\``);
  out.push(`- Archive commit ${r.archive.freeze_and_ledger_start_commit.short} (frozen configuration and ledger start): ${r.archive.freeze_and_ledger_start_commit.full}`);
  out.push(`- Archive commit ${r.archive.results_and_complete_commit.short} (results and complete): ${r.archive.results_and_complete_commit.full}`);
  out.push(`- Evaluated repository HEAD ${r.evaluated_repo_head.short}: ${r.evaluated_repo_head.full}`);
  out.push(`- Frozen manifest sha256: ${r.frozen.manifest_sha256}`);
  out.push(`- Frozen locked cards sha256: ${r.frozen.locked_sha256}`);
  out.push(`- Frozen Sim_Wasm sha256: ${r.frozen.wasm_sha256}`);
  out.push(`- Frozen configuration file (freeze.json) sha256: ${r.archive.freeze_json_sha256}`);
  out.push(`- Archive ledger sha256: ${r.archive.ledger_sha256}`);
  out.push(`- Grading and Metrics: ${r.grading}.`);
  out.push(`- sha256 of the checked-in file (author-supplied.json): ${r.file_sha256}`, '');
  for (const t of r.tasks) {
    const f = t.figures;
    out.push(`Task_Type ${t.task_type}: \`${t.model}\`, thinking ${t.thinking ? 'on' : 'off'}, template \`${t.template}\` (sha256 ${t.template_sha256}); run ${t.run_id}`, '');
    const cluster = t.acceptable_cluster_lower_bound_tenths_pct === null ? '' : `, cluster lower bound ${tenths(t.acceptable_cluster_lower_bound_tenths_pct)}`;
    out.push(
      ...table(
        ['Metric', 'As supplied'],
        [
          ['Acceptable rate', `${f.acceptable} of ${f.scored_cards} (${pct(f.acceptable, f.scored_cards)}${cluster})`],
          ['Severe count', `${f.severe}`],
          ['Flip rate', `${f.flips} of ${f.flip_perms} (${pct(f.flips, f.flip_perms)})`],
          ['Contrast consistency', `${f.consistent_pairs} of ${f.pairs} pairs`],
        ],
      ),
    );
    out.push(`- sha256 of its results file: ${t.results_sha256}`, `- sha256 of its grades file: ${t.grades_sha256}`);
    const s = t.archive_summary;
    out.push(`- As the archive's summary file records it: records ${s.records}, errors ${s.errors}, truncated ${s.truncated}, model_mismatch ${s.model_mismatch}. Recorded as printed there; not interpreted here.`, '');
  }
  out.push('Reading against this probe\'s Thresholds (the Author\'s text, Amendment RC-20, 2026-11-10):', '', RC20_AUTHOR_TEXT, '');
  out.push(`Post-hoc note (an analysis, not a judgement; as reported by the ${r.post_hoc_note.attributed_to}; script in archive commit ${r.post_hoc_note.archive_commit}): ${r.post_hoc_note.text}`, '');
  return out;
}

/** Section 12 (R19.16): every ingested External_Reference, labelled, with its hashes and its Metrics as supplied or re-graded. */
export function externalSectionLines(records: readonly ExternalReferenceView[], authorSupplied: readonly AuthorSuppliedView[] = []): string[] {
  const out: string[] = [`## ${EXTERNAL_SECTION_TITLE}`, ''];
  if (records.length === 0) {
    out.push('No External_Reference has been ingested.', '');
    for (const a of authorSupplied) out.push(...authorSuppliedLines(a));
    return out;
  }
  out.push(EXTERNAL_SENTENCE, '');
  for (const r of records) {
    out.push(`### ${r.label} (external reference, not a repo Combination)`, '');
    out.push(`- Reference model, as given: ${r.reference_model}`);
    out.push(`- Task_Type: ${r.task_type}`);
    out.push(`- Pinned_Manifest_Hash of the Card_Set it ran on: ${r.pinned_manifest_hash}`);
    out.push(`- sha256 of the reference file: ${r.reference_sha256}`);
    out.push(`- sha256 of its frozen configuration (${r.config.file}): ${r.config.sha256}`);
    out.push(`- sha256 of its ledger (${r.ledger.file}): ${r.ledger.sha256}`);
    out.push(`- sha256 of its results (${r.results.file}): ${r.results.sha256}`);
    out.push(r.raw_outputs === null ? '- Raw outputs: none supplied, so the figures below are as supplied and were not re-graded' : `- sha256 of its raw outputs (${r.raw_outputs.file}, answer mode ${r.raw_outputs.answer_mode}): ${r.raw_outputs.sha256}; ${r.raw_output_count ?? 0} outputs re-graded through Sim_Wasm`, '');
    const rows = EXTERNAL_ROWS.map((row) => {
      const differs = r.regrade_figures !== null && row.names.some((n) => r.supplied[n] !== (r.regrade_figures as ExternalFiguresView)[n]);
      return [row.label, row.show(r.supplied), r.regrade_figures === null ? 'not re-graded' : row.show(r.regrade_figures), r.regrade_figures === null ? 'as supplied' : differs ? 'MISMATCH' : 'match'];
    });
    out.push(`Task_Type ${r.task_type}, Metrics as supplied${r.regrade_figures === null ? '' : ' and as re-graded'}:`, '');
    out.push(...table(['Metric', 'Supplied', 'Re-graded', 'Flag'], rows));
    if (r.regrade === 'mismatch') out.push(`Re-grade: MISMATCH in ${r.differing.join(', ')}. Both sets of figures are shown; the supplied figures were not changed.`, '');
    else if (r.regrade === 'match') out.push('Re-grade: match. Every supplied figure equals the re-graded one.', '');
  }
  for (const a of authorSupplied) out.push(...authorSuppliedLines(a));
  return out;
}

const verdictText = (v: Verdict): string => (v === 'not_computable' ? 'not computable' : v);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function bootText(b: BootstrapInterval | null): string {
  return b === null ? 'not computable' : `${fracPct(b.lower)} to ${fracPct(b.upper)}`;
}
function wilsonText(w: WilsonInterval | null): string {
  return w === null ? 'not computable' : `${(w.lower * 100).toFixed(1)}% to ${(w.upper * 100).toFixed(1)}%`;
}
function iccText(i: IccResult): string {
  return i.kind === 'estimable' ? i.value.toFixed(3) : `not estimable (${i.reason.replace(/_/g, ' ')})`;
}
function latencyText(v: number | 'no data'): string {
  return v === 'no data' ? 'no data' : `${v}`;
}

/** Marks of one Task_Type (R13.4, R13.9). */
function marks(t: TaskAnalysis): { acceptable: string; severe: string; flip: string; contrast: string; overall: string } {
  const m = t.metrics;
  return {
    acceptable: m.acceptable.verdict === 'pass' ? (t.acceptableMark ?? 'pass') : verdictText(m.acceptable.verdict),
    severe: verdictText(m.severe.verdict),
    flip: isByConstruction(m.flip) ? 'by construction (not measured)' : verdictText(m.flip.verdict),
    contrast: m.contrast.verdict === 'pass' ? (t.contrastMark ?? 'pass') : verdictText(m.contrast.verdict),
    overall: !m.usableForMark ? 'not used for a mark (missing outputs or engine faults)' : m.passes ? passLabel(m) : 'fail',
  };
}

/** The Thresholds a Task_Type failed, in words (R15.5). */
export function failedThresholds(m: TaskMetrics): string[] {
  const out: string[] = [];
  if (m.acceptable.verdict === 'not_computable') out.push('acceptable rate not computable (denominator 0)');
  else if (m.acceptable.verdict === 'fail') out.push(`acceptable rate ${ratioText(m.acceptable)} = ${ratioPct(m.acceptable)}, below ${THRESHOLDS.acceptablePct}%`);
  if (m.severe.verdict === 'not_computable') out.push('severe count not computable (denominator 0)');
  else if (m.severe.verdict === 'fail') out.push(`severe count ${m.severe.count}, above ${THRESHOLDS.severeMax}`);
  if (isByConstruction(m.flip)) {
    // Guaranteed by construction (R20.13): no flip row to fail.
  } else if (m.flip.verdict === 'not_computable') out.push('flip rate not computable (denominator 0)');
  else if (m.flip.verdict === 'fail') out.push(`flip rate ${ratioText(m.flip)} = ${ratioPct(m.flip)}, above ${THRESHOLDS.flipPct}%`);
  if (m.contrast.verdict === 'not_computable') out.push('contrast consistency not computable (denominator 0)');
  else if (m.contrast.verdict === 'fail') out.push(`contrast consistency ${ratioText(m.contrast)} = ${ratioPct(m.contrast)}, below ${THRESHOLDS.contrastPct}%`);
  if (!m.usableForMark) out.push('entry has missing base outputs or engine faults, so no mark is given');
  return out;
}

/** Smoke_Call counts: records sent and records whose output the Output_Validator accepted (R18.6). */
export function smokeSummary(records: readonly SmokeRecord[]): { sent: number; accepted: number } {
  let accepted = 0;
  for (const r of records) {
    const kind = asRec(r['verdict'])?.['kind'];
    if (kind === 'decision' || kind === 'synthesis') accepted++;
  }
  return { sent: records.length, accepted };
}

// ---------------------------------------------------------------- perf record view

interface PerfView {
  readonly coldEmpty: number | null;
  readonly coldWarm: number | null;
  readonly modelBytes: number | null;
  readonly runtimeBytes: number | null;
  readonly localBytes: number | null;
  readonly memGpu: string | null;
  readonly memQuantity: string | null;
  readonly memPeak: number | null;
  readonly memReason: string | null;
  /** `true`: NVIDIA memory rose during an Intel-adapter run, so the work did not run on the Intel GPU. */
  readonly deviceMismatch: boolean | null;
  readonly connection: string | null;
  readonly throttling: string | null;
  readonly mbit: number | null;
}

function perfView(perf: PerfRecord | null): PerfView | null {
  if (perf === null) return null;
  return {
    coldEmpty: asNum(dig(perf, 'cold_start', 'empty_cache_ms')),
    coldWarm: asNum(dig(perf, 'cold_start', 'warm_cache_ms')),
    modelBytes: asNum(dig(perf, 'download', 'model_bytes')),
    runtimeBytes: asNum(dig(perf, 'download', 'runtime_bytes')),
    localBytes: asNum(dig(perf, 'download', 'local_bytes')),
    memGpu: asStr(dig(perf, 'memory', 'gpu')),
    memQuantity: asStr(dig(perf, 'memory', 'quantity')),
    memPeak: asNum(dig(perf, 'memory', 'peak_mib')),
    memReason: asStr(dig(perf, 'memory', 'reason')),
    deviceMismatch: dig(perf, 'memory', 'device_mismatch') === true ? true : dig(perf, 'memory', 'device_mismatch') === false ? false : null,
    connection: asStr(dig(perf, 'network', 'connection')),
    throttling: asStr(dig(perf, 'network', 'throttling')),
    mbit: asNum(dig(perf, 'network', 'measured_mbit_s')),
  };
}

const cpuNodeCount = (run: RunAnalysis | undefined): number => (run?.header.placement?.cpu_nodes ?? []).reduce((s, n) => s + n.count, 0);
const nodeText = (nodes: readonly { op_type: string; count: number }[]): string => nodes.map((n) => `${n.op_type} ×${n.count}`).join(', ');
/** CPU-placed nodes in two groups (Author, 2026-11-07): compute operators first, then shape computation. */
const cpuNodeList = (run: RunAnalysis): string => {
  const { shape, compute } = splitCpuNodes(run.header.placement?.cpu_nodes ?? []);
  const parts: string[] = [];
  if (compute.length > 0) parts.push(`compute operators (affect latency): ${nodeText(compute)}`);
  if (shape.length > 0) parts.push(`shape computation (cheap, placed on the CPU on purpose): ${nodeText(shape)}`);
  return parts.join('; ');
};

function gpuLabel(run: RunAnalysis, workers: boolean): string {
  if (workers) return 'not applicable (server side)';
  const vendor = asStr(dig(run.header.fingerprint, 'webgpu', 'vendor')) ?? asStr(perfView(run.perf)?.memGpu);
  if (vendor === 'nvidia') return 'NVIDIA discrete GPU';
  if (vendor === 'intel') return perfView(run.perf)?.deviceMismatch === true ? 'INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch)' : 'Intel integrated GPU';
  return vendor ?? 'unknown';
}

function memoryCells(run: RunAnalysis, workers: boolean): { nvidia: string; intel: string } {
  if (workers) return { nvidia: 'not applicable', intel: 'not applicable' };
  const p = perfView(run.perf);
  if (p === null) return { nvidia: 'not measured: no perf record', intel: 'not measured: no perf record' };
  const unmeasured = `not measured: ${p.memReason ?? 'no reason recorded'}`;
  if (p.memGpu === 'nvidia') return { nvidia: p.memPeak !== null ? `${p.memPeak}` : unmeasured, intel: '—' };
  if (p.memGpu === 'intel' && p.deviceMismatch === true) return { nvidia: '—', intel: 'INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures' };
  if (p.memGpu === 'intel') return { nvidia: '—', intel: p.memPeak !== null ? `${p.memPeak} — ${p.memQuantity ?? 'quantity not named'}` : unmeasured };
  return { nvidia: unmeasured, intel: unmeasured };
}

const msText = (v: number | null): string => (v === null ? 'not measured' : `${v}`);
const bytesText = (v: number | null): string => (v === null ? 'not measured' : `${v} B (${mib(v)} MiB)`);

// ---------------------------------------------------------------- license text

function licenseText(c: Combination): string {
  const l = c.license;
  if (l === undefined) return 'license not recorded';
  const parts: string[] = [l.osi ? `${l.name} (OSI-approved)` : `${l.name} — custom license, not OSI-approved`, l.url];
  if (!l.osi) parts.push(l.accepted !== null ? `accepted by the Author on ${l.accepted}` : 'no Author acceptance recorded');
  if (l.declared_by === 'base_model') parts.push(`this is the base model's license; the conversion repository ${c.model_id} declares no license`);
  return parts.join('; ');
}

const EXCLUSION_WHAT: Record<string, string> = {
  vram: 'VRAM need (MiB)',
  download: 'published download (bytes)',
  params: 'parameter count',
  unpinned: 'no Pinned_Revision or unpinned model library URL',
  preflight_load: 'VRAM_Preflight did not load the model on WebGPU',
  preflight_vram: 'VRAM_Preflight peak VRAM (MiB)',
};

// ---------------------------------------------------------------- buildReport

export function buildReport(input: ReportInput): string {
  const lockedRuns = input.lockedRuns.filter((r) => r.kind === 'locked');
  const runById = new Map(lockedRuns.map((r) => [r.id, r] as const));
  const overLimit = new Set<string>();
  for (const r of lockedRuns) {
    const bytes = perfView(r.perf)?.modelBytes;
    if (bytes !== null && bytes !== undefined && bytes > IN_BROWSER_DOWNLOAD_LIMIT_BYTES) overLimit.add(r.combination);
  }
  const state: PhaseState = { ...input.state, passes: entryPassesFrom(lockedRuns), overLimit };
  const derivedViews = input.derivedRuns ?? [];
  /** Combinations that run through a Runtime; a `perm_avg` record is a variant of one of them, never a separate candidate (R20.1). */
  const runnable = state.combinations.filter((c) => !isPermAvg(c));
  const permAvgCombos = state.combinations.filter(isPermAvg);
  const entryById = new Map(state.entries.map((e) => [e.entry_id, e] as const));
  const comboById = new Map(state.combinations.map((c) => [c.id, c] as const));
  const choices = chooseReportEntries(state.entries);
  const status = phaseStatus(state);
  const smoke = smokeSummary(state.smoke);
  const taskAnalysis = (entryId: string | null, task: TaskType): TaskAnalysis | undefined =>
    entryId === null ? undefined : runById.get(entryId)?.tasks.find((t) => t.metrics.task === task);

  /** The used entry of each (Combination, Task_Type) that has a completed Locked_Run. */
  const usedRuns: { run: RunAnalysis; task: TaskType; analysis: TaskAnalysis }[] = [];
  for (const choice of choices) {
    if (choice.used === null) continue;
    const run = runById.get(choice.used);
    const analysis = run?.tasks.find((t) => t.metrics.task === choice.task);
    if (run !== undefined && analysis !== undefined) usedRuns.push({ run, task: choice.task, analysis });
  }
  const usedEntries = [...new Map(usedRuns.map((u) => [u.run.id, u.run] as const)).values()];

  const out: string[] = [];
  const h2 = (t: string): void => void out.push(`## ${t}`, '');
  const h3 = (t: string): void => void out.push(`### ${t}`, '');
  const para = (...lines: string[]): void => void out.push(...lines, '');

  out.push('# LLM probe report', '');
  para(
    `Generated on ${input.generated_on} by \`probe report\` from the ledger, the Locked_Run Results and grades, the performance records, the failure, preflight, Exclusion and Smoke_Call records, \`combinations.json\` and the approvals on \`HEAD\`.`,
    'The Report recommends; it does not decide. Every Metric, interval and performance figure behind a mark or a recommendation comes from Locked_Run Results only (R15.2). This file names Card IDs, Contrast_Pair IDs and scenario-group counts only, and no card content.',
  );

  // ---- 1. Target_Machine, browser, network (R14.8, R9.5, R10.10)
  h2('1. Target_Machine, browser version and network conditions');
  para(`Target_Machine: ${input.environment.targetMachine}.`);
  out.push(
    ...table(
      ['Combination', 'Ledger entry', 'GPU used', 'WebGPU adapter (vendor / architecture / device / description)', 'Browser version', 'Measurement source'],
      usedEntries.map((r) => {
        const workers = isWorkersAi(comboById.get(r.combination) ?? ({ runtime: '' } as Combination));
        const fp = r.header.fingerprint;
        const adapter = [dig(fp, 'webgpu', 'vendor'), dig(fp, 'webgpu', 'architecture'), dig(fp, 'webgpu', 'device'), dig(fp, 'webgpu', 'description')].map((v) => (typeof v === 'string' && v !== '' ? v : 'unknown'));
        return [
          r.combination,
          r.id,
          gpuLabel(r, workers),
          workers ? 'not applicable' : adapter.join(' / '),
          workers ? 'not applicable' : (asStr(dig(fp, 'browser', 'version')) ?? 'unknown'),
          workers ? 'REST API from the local Probe_Runner' : (asStr(dig(fp, 'measurement')) ?? (r.sources.join(', ') || 'unknown')),
        ];
      }),
    ),
  );
  const networks = usedEntries.flatMap((r) => {
    const p = perfView(r.perf);
    if (p === null || isWorkersAi(comboById.get(r.combination) ?? ({ runtime: '' } as Combination))) return [];
    return [`- ${r.combination} (${r.id}): connection ${p.connection ?? 'not recorded'}; throttling ${p.throttling ?? 'not recorded'}; ${p.mbit === null ? 'bandwidth not recorded' : `measured download bandwidth ${p.mbit} Mbit/s`}.`];
  });
  out.push(...(networks.length > 0 ? networks : ['- Network conditions: no in-browser Locked_Run perf record yet.']), '');
  para(`Workers AI region or endpoint: ${input.environment.workersEndpoint ?? 'not reported by the API'}.`);

  // ---- 2. Measurement plan (R18.8)
  h2('2. Measurement plan');
  para(
    `Phase_1 (in-browser Combinations): ${status.ended ? 'ended' : 'in progress'}.` +
      (status.pending.length > 0 ? ` Waiting for: ${status.pending.map((p) => p.combination).join(', ')}.` : ''),
  );
  for (const t of status.tasks) {
    out.push(`- ${taskTitle(t.task)}: ${t.pass ? `a Combination passed in the browser (${t.passingEntries.map((e) => `${e.combination}, ${e.entry_id}`).join('; ')})` : 'no Combination passed in the browser'}.`);
  }
  out.push('');
  if (status.branch === null) para('Phase_2 branch: not decided (Phase_1 in progress).');
  else if (status.branch === 'A') para(`Phase_2 branch taken: **A** (both Task_Types passed in the browser): Smoke_Calls only, no Workers AI Dev_Run or Locked_Run. Smoke_Calls sent: ${smoke.sent}; accepted by the Output_Validator: ${smoke.accepted}.`);
  else para(`Phase_2 branch taken: **B** (Task_Type_Subset ${status.subset ?? 'none'}): exactly one Workers AI model is measured, for the Task_Types with no passing in-browser Combination.`);
  const p2 = status.phase2;
  if (p2 === null) para(`Author's Phase_2 approval: none recorded${status.ended ? '; Phase_2 has not started' : ''}.`);
  else {
    para(
      `Author's Phase_2 approval: ${p2.id}, approved on ${p2.approved_on}, branch ${p2.branch ?? 'unknown'}` +
        (p2.branch === 'B' ? `, approved model ${p2.model ?? 'unknown'}, Task_Type_Subset ${p2.task_subset ?? 'unknown'}` : '') +
        '.',
    );
  }
  if (status.mismatch !== null) para(`**Branch mismatch:** ${status.mismatch}.`);
  if (status.approvalsProblem !== null) para(`Approvals could not be read from \`HEAD\`: ${status.approvalsProblem}.`);
  const tried = phase2Candidates(state);
  para(`Phase_2 candidates tried: ${tried.length} (${tried.length === 0 ? 'none' : tried.join(', ')}). A Workers AI Combination counts when it has a Dev_Run or Locked_Run Results file, or a ledger entry, made in Phase_2; a Combination with Smoke_Calls only, or whose Dev_Run the gate refused, does not count.`);
  if (tried.length >= 2) para(SELECTION_BIAS_NOTE);
  if (derivedViews.length > 0 || (state.derived ?? []).length > 0) para(PREREGISTRATION_SENTENCE, NON_INDEPENDENCE_SENTENCE);
  para('Additional_Candidate_Set (Decision_Models, Task_Type D only, each approved by the Author by name):');
  out.push(...additionalCandidateLines(state), '');

  // ---- 3. Candidate table (R9.2, R9.3, R9.10, R9.17, R15.6)
  h2('3. Candidates, size limits, pinned revisions and licenses');
  const candidateRows = runnable.map((c) => {
    const size = c.size;
    const preflight = input.preflights.get(c.id);
    const preflightPeak = preflight === undefined ? null : asNum(preflight['peak_vram_mib']);
    const vram =
      isWorkersAi(c) ? 'not applicable'
      : size?.vram_mib !== null && size?.vram_mib !== undefined ? `${size.vram_mib}`
      : preflightPeak !== null ? `${preflightPeak} (VRAM_Preflight peak)`
      : 'unknown';
    const measured = perfView(runById.get(usedEntries.find((r) => r.combination === c.id)?.id ?? '')?.perf ?? null)?.modelBytes ?? null;
    const download = isWorkersAi(c) ? 'not applicable' : `${size?.expected_download_bytes === null || size?.expected_download_bytes === undefined ? 'unknown' : `${mib(size.expected_download_bytes)} MiB (published)`}${measured === null ? '' : `; measured ${mib(measured)} MiB`}`;
    const excl = state.exclusions.filter((x) => x.combination === c.id);
    const fail = state.failures.filter((f) => f.combination === c.id && countsForGate(f));
    const statusText =
      excl.length > 0 ? `excluded (${excl.map((x) => x.check).join(', ')})`
      : overLimit.has(c.id) ? 'over the In_Browser_Size_Limits (measured download); not recommended'
      : fail.length > 0 ? `failed (${fail.map((f) => f.kind).join(', ')})`
      : usedEntries.some((r) => r.combination === c.id) ? 'measured'
      : 'not run';
    return [c.id, `${c.runtime} / ${c.model_id}${c.quantization === '' ? '' : ` / ${c.quantization}`}`, c.revision, download, size?.params === null || size?.params === undefined ? (isWorkersAi(c) ? 'not applicable' : 'unknown') : `${size.params}`, vram, licenseText(c), statusText];
  });
  out.push(...table(['Combination', 'Runtime / model / quantization', 'Pinned_Revision', 'Download', 'Parameters', 'VRAM need, MiB', 'License', 'Status'], candidateRows));
  out.push('Sources of the figures above:', '');
  for (const c of runnable) {
    if (isWorkersAi(c)) {
      out.push(`- ${c.id}: Workers AI model, license ${licenseText(c)}${c.prices ? `; prices ${c.prices.input}/${c.prices.output} neurons per million tokens (${c.prices.source}, read on ${c.prices.read_on})` : ''}.`);
      continue;
    }
    const preflight = input.preflights.get(c.id);
    const vramSource = c.size?.vram_mib !== null && c.size?.vram_mib !== undefined ? c.size.vram_source : preflight !== undefined ? 'VRAM_Preflight on the Target_Machine' : 'no source (unknown)';
    out.push(`- ${c.id}: download source ${c.size?.download_source ?? 'not recorded'}; parameters source ${c.size?.params_source ?? 'not recorded'}; VRAM source ${vramSource}; GPU ${c.id.endsWith('/intel') ? 'Intel integrated GPU' : c.id.endsWith('/nvidia') ? 'NVIDIA discrete GPU' : 'see section 1'}.`);
  }
  out.push('');
  para('Runtime libraries:');
  out.push(...(input.runtimeLibraries.length > 0 ? input.runtimeLibraries.map((l) => `- ${l.name} ${l.version}: ${l.license} (${l.url})`) : ['- none recorded']), '');
  h3('Excluded candidates');
  if (state.exclusions.length === 0) para('No Exclusion_Record.');
  else {
    for (const x of state.exclusions) {
      out.push(`- ${x.combination} (${x.model}): ${EXCLUSION_WHAT[x.check] ?? x.check}: value ${x.value === 'unknown' ? 'unknown' : String(x.value)}${x.limit === null ? '' : `, limit ${String(x.limit)}`} (${x.at}). A terminal Phase_1 state; never a passing in-browser Combination.`);
    }
    out.push('');
  }
  h3(PREFLIGHT_FINDINGS_TITLE);
  out.push(...PREFLIGHT_FINDINGS.map((f) => `- ${f}`), '');

  // ---- 4. Metrics per Combination and Task_Type (R15.1, R13)
  h2('4. Locked_Run Metrics per Combination and Task_Type');
  if (usedRuns.length === 0) para('No completed Locked_Run yet.');
  const metricsBlock = (run: RunAnalysis, task: TaskType, analysis: TaskAnalysis, title: string, variant: { mark: string; derivationLine: string } | null): void => {
    const m = analysis.metrics;
    const mk = marks(analysis);
    if (variant !== null) mk.overall = variant.mark;
    h3(title);
    para(`Mark: **${mk.overall}**. Scenario groups: ${groupUnits(m.perCard, () => false).length}. Scored non-void cards: ${m.cards}.`);
    const baseline = m.randomBaseline === null ? null : pct(m.randomBaseline.num, m.randomBaseline.den);
    out.push(
      ...table(
        ['Metric', 'Numerator / denominator', 'Value', 'Threshold', 'Mark'],
        [
          ['Acceptable rate', ratioText(m.acceptable), `${ratioPct(m.acceptable)}${baseline === null ? '' : ` (Random_Baseline ${baseline})`}`, `at least ${THRESHOLDS.acceptablePct}%`, mk.acceptable],
          ['Severe count (base Permutation of each card)', `${m.severe.count} of ${m.severe.den} cards`, `${m.severe.count}`, `at most ${THRESHOLDS.severeMax}`, mk.severe],
          ['Severe outputs in other Permutations', isByConstruction(m.flip) ? 'not applicable' : `${m.severeOtherPermutations} of ${m.flip.den} non-base requests`, `${m.severeOtherPermutations}`, 'none (no verdict)', 'reported only'],
          ['Flip rate (non-base requests with an output, Illegal and timeouts included)', isByConstruction(m.flip) ? PERM_AVG_FLIP_CELL : ratioText(m.flip), isByConstruction(m.flip) ? 'not applicable' : ratioPct(m.flip), isByConstruction(m.flip) ? 'none (no verdict)' : `at most ${THRESHOLDS.flipPct}%`, mk.flip],
          ['Contrast consistency', `${ratioText(m.contrast)} pairs`, ratioPct(m.contrast), `at least ${THRESHOLDS.contrastPct}%`, mk.contrast],
          ['Illegal rate', ratioText(m.illegal), ratioPct(m.illegal), 'none (no verdict)', 'reported only'],
        ],
      ),
    );
    out.push(
      ...table(
        ['Quantity', 'Cluster_Bootstrap 95% (10,000 resamples, seed 20261104)', 'Wilson 95%', 'Intra-group correlation'],
        [
          ['Acceptable rate', bootText(analysis.acceptable.cluster), wilsonText(analysis.acceptable.wilson), iccText(analysis.acceptable.icc)],
          ['Illegal rate', bootText(analysis.illegal.cluster), wilsonText(analysis.illegal.wilson), iccText(analysis.illegal.icc)],
          ['Contrast consistency (pair bootstrap)', bootText(analysis.contrastInterval), 'not reported', 'not applicable'],
        ],
      ),
    );
    if (task === 'decision') para(`Random_Baseline next to the D acceptable rate: ${baseline ?? 'not computable'}.`);
    if (task === 'decision' && run.decisionDiagnosis != null) out.push(...diagnosisLines(run.decisionDiagnosis, 'Locked_Run').map((l) => `- ${l}`), '');
    const nodes = cpuNodeList(run);
    para(`CPU-placed nodes (placement detection: ${run.header.placement?.method ?? 'not applicable'}): ${nodes === '' ? 'none' : nodes}.`);
    if (variant !== null) para(variant.derivationLine);
  };
  for (const { run, task, analysis } of usedRuns) metricsBlock(run, task, analysis, `${run.combination}, ${taskTitle(task)}, entry ${run.id}`, null);
  // perm_avg: a Locked derived file feeds a mark; a Dev one is labelled Dev_Run and is printed in the Dev_Run section only.
  const derivedMark = (v: DerivedRunView, m: TaskMetrics): { mark: string; derivationLine: string } => {
    const from = v.analysis.header.derived_from;
    return permAvgMark(m, { single: from?.combination ?? String(comboById.get(v.analysis.combination)?.derives_from ?? 'unknown'), ledgerEntry: from?.ledger_entry ?? null, sourceSha256: from?.results_sha256 ?? 'unknown' });
  };
  for (const v of derivedViews.filter((d) => d.split === 'locked')) {
    for (const analysis of v.analysis.tasks) metricsBlock(v.analysis, analysis.metrics.task, analysis, `${v.analysis.combination}, ${taskTitle(analysis.metrics.task)}, derived run ${v.analysis.id}`, derivedMark(v, analysis.metrics));
  }

  // ---- 4a, 4b, 4c: the Decision_Variants (R20.13 to R20.16, DA-28)
  if (permAvgCombos.length > 0) {
    const decisionOf = (v: DerivedRunView): TaskAnalysis | undefined => v.analysis.tasks.find((t) => t.metrics.task === 'decision');
    const scoredIdsOf = (v: DerivedRunView): Set<string> => new Set(decisionOf(v)?.metrics.perCard.map((c) => c.cardId) ?? []);
    const variantLabel = (v: DerivedRunView): string => (v.split === 'locked' ? 'Locked_Run' : 'Dev_Run, not used for a mark');

    h2('4a. Decision_Variants side by side');
    para('Each Decision_Model with its `single` and `perm_avg` variants, same Metrics, Thresholds and intervals. A figure of one variant is never printed in the other\'s column. The `single` flip rate is measured; the `perm_avg` flip row is guaranteed by construction and carries no number. Locked_Run figures only (a Dev_Run derived file is in the Dev_Run section and in 4b and 4c, labelled).');
    const cells = (a: TaskAnalysis | undefined, variant: { mark: string } | null, why: string): string[] => {
      if (a === undefined) return Array.from({ length: 8 }, () => why);
      const m = a.metrics;
      const mk = marks(a);
      return [
        `${ratioText(m.acceptable)} = ${ratioPct(m.acceptable)} (${mk.acceptable})`,
        bootText(a.acceptable.cluster),
        `${m.severe.count} of ${m.severe.den} cards (${mk.severe})`,
        variant !== null ? PERM_AVG_FLIP_CELL : `${ratioText(m.flip as Ratio)} = ${ratioPct(m.flip as Ratio)} (${mk.flip})`,
        `${ratioText(m.contrast)} pairs = ${ratioPct(m.contrast)} (${mk.contrast})`,
        `${ratioText(m.illegal)} = ${ratioPct(m.illegal)}`,
        variant !== null ? 'see 4c (sum and maximum of the calls)' : `${latencyText(a.latency.p50)} / ${latencyText(a.latency.p95)}`,
        variant !== null ? variant.mark : mk.overall,
      ];
    };
    const ROWS = ['Acceptable rate', 'Acceptable rate, Cluster_Bootstrap 95%', 'Severe count (base Permutation)', 'Flip rate', 'Contrast consistency', 'Illegal rate', 'Latency p50 / p95, ms (per request; see 4c for a decision)', 'Mark'];
    for (const pa of permAvgCombos) {
      const single = runnable.find((c) => c.id === pa.derives_from);
      const sRun = usedRuns.find((u) => u.run.combination === single?.id && u.task === 'decision');
      const pView = derivedViews.find((v) => v.split === 'locked' && v.analysis.combination === pa.id);
      const pAnalysis = pView === undefined ? undefined : decisionOf(pView);
      const pMark = pView === undefined || pAnalysis === undefined ? null : derivedMark(pView, pAnalysis.metrics);
      const sCells = cells(sRun?.analysis, null, 'not measured (no completed Locked_Run)');
      const pCells = pMark === null ? cells(undefined, null, 'not measured (no Locked Derived_Run)') : cells(pAnalysis, pMark, '');
      h3(`${String(pa.model_id)}: ${single?.id ?? String(pa.derives_from)} (single) and ${pa.id} (perm_avg)`);
      out.push(...table(['Metric', `single: ${single?.id ?? 'unknown'}`, `perm_avg: ${pa.id}`], ROWS.map((r, i) => [r, sCells[i] as string, pCells[i] as string])));
      if (pMark !== null) para(pMark.derivationLine);
    }

    h2('4b. Position of the chosen option (perm_avg)');
    para('Counts over the Scored_Cards that are not Void_Cards, from the stored `perm_avg.positions` of the derived records: one row per Permutation, one column per shown position (1 based, in the order of that request). The row "original position" is the position in the base Permutation. Illegal answers are counted apart and are in no cell.');
    if (derivedViews.length === 0) para('No Derived_Run yet (not measured).');
    for (const v of derivedViews) {
      const d = positionDistribution(v.records, scoredIdsOf(v));
      h3(`${v.analysis.combination}, derived run ${v.analysis.id} (${variantLabel(v)})`);
      const cols = Array.from({ length: d.width }, (_, i) => `${i + 1}`);
      out.push(...table(['Shown position', ...cols], [...d.rows.map((r) => [r.permutation, ...r.counts.map(String)]), ['original position', ...d.original.map(String)]]));
      para(`Illegal answers (in no position cell): ${d.illegal}. Cards counted: ${d.total}.`);
    }

    h2('4c. Request_Multiplier and decision latency (perm_avg)');
    para(PRODUCTION_NOTE);
    para(ONE_REQUEST_ALTERNATIVE);
    para('The Request_Multiplier is the number of calls one decision needs: 4 for a Card with 3 to 5 options, 2 for a Card with 2 options, 1 for a Sanity_Card. The decision latency of a Card is the sum (calls in sequence) and the maximum (calls in parallel) of the latencies of its calls, taken from the requests of the `single` run; no request was sent for the variant. Percentiles are nearest-rank (R14.1).');
    if (derivedViews.length === 0) para('No Derived_Run yet (not measured).');
    for (const v of derivedViews) {
      const d = multiplierDistribution(v.records, scoredIdsOf(v));
      h3(`${v.analysis.combination}, derived run ${v.analysis.id} (${variantLabel(v)})`);
      out.push(
        ...table(
          ['Request_Multiplier (calls per decision)', 'Scored_Cards'],
          d.byCalls.map((r) => [`${r.calls}`, `${r.cards}`]),
        ),
      );
      out.push(
        ...table(
          ['Decision latency', 'p50, ms', 'p95, ms'],
          [
            ['Sum of the calls (in sequence)', latencyText(d.sum.p50), latencyText(d.sum.p95)],
            ['Maximum of the calls (in parallel)', latencyText(d.max.p50), latencyText(d.max.p95)],
          ],
        ),
      );
    }
  }

  // ---- 5. Sanity results, apart (R13.10)
  h2('5. Sanity results (apart from every Metric)');
  const sanityRows = usedEntries.flatMap((r) =>
    r.sanity.map((s) => [r.combination, r.id, s.cardId, taskLetter(s.task), s.outcome, s.grade === null ? 'no output' : `acceptable ${s.grade.acceptable}, severe ${s.grade.severe}, illegal ${s.grade.illegal}`]),
  );
  if (sanityRows.length === 0) para('No Sanity_Card results.');
  else out.push(...table(['Combination', 'Ledger entry', 'Card ID', 'Task', 'Base outcome', 'Grade'], sanityRows));

  // ---- 6. Performance (R14, R10.10, R9.11, R15.11)
  h2('6. Performance');
  para('All figures come from the Locked_Run perf record of the entry (R14.10). Latency covers every request that returned raw text (all Permutations and Sanity_Cards), including outputs later graded Illegal; Timeouts and runtime errors are counted apart. Percentiles are nearest-rank on the sorted values, index floor((p·n + 99) / 100) − 1, with no interpolation, so p50 of 30 values is the 15th and p95 the 29th.');
  out.push(
    ...table(
      ['Combination', 'Task', 'p50, ms', 'p95, ms', 'Requests covered', 'Timeouts', 'Runtime errors', 'Notes'],
      usedRuns.map(({ run, task, analysis }) => {
        const n = cpuNodeCount(run);
        return [run.combination, taskLetter(task), latencyText(analysis.latency.p50), latencyText(analysis.latency.p95), `${analysis.latency.covered}`, `${analysis.latency.timeouts}`, `${analysis.latency.errors}`, n > 0 ? `not pure-WebGPU results: ${n} nodes placed on the CPU` : ''];
      }),
    ),
  );
  out.push(
    ...table(
      ['Combination', 'Ledger entry', 'Source', 'Cold start, empty cache, ms', 'Cold start, warm cache, ms', 'Model download', 'Runtime download', NVIDIA_MEMORY_COLUMN, 'Intel iGPU peak memory, MiB (quantity named)', 'Limits'],
      usedEntries.map((r) => {
        const workers = isWorkersAi(comboById.get(r.combination) ?? ({ runtime: '' } as Combination));
        const p = perfView(r.perf);
        const mem = memoryCells(r, workers);
        const source = workers ? 'REST API (local Probe_Runner)' : (asStr(dig(r.header.fingerprint, 'measurement')) ?? (r.sources.join(', ') || 'unknown'));
        return [
          r.combination,
          r.id,
          source,
          workers ? 'not applicable' : msText(p?.coldEmpty ?? null),
          workers ? 'not applicable' : msText(p?.coldWarm ?? null),
          workers ? 'not applicable' : bytesText(p?.modelBytes ?? null),
          workers ? 'not applicable' : bytesText(p?.runtimeBytes ?? null),
          mem.nvidia,
          mem.intel,
          overLimit.has(r.combination) ? 'over the In_Browser_Size_Limits' : 'within',
        ];
      }),
    ),
  );
  para(`Intel iGPU figures are never put in the NVIDIA column. The Intel quantity is either "${INTEL_MEMORY_QUANTITY}" or the i915 debugfs / \`intel_gpu_top\` source, and it is named in the cell.`);

  // ---- 7. Ledger entries (R3.8)
  h2('7. Ledger entries per Model_Key and Task_Type');
  const ledgerRows: string[][] = [];
  const metricsText = (e: LedgerEntry, task: TaskType): string => {
    const t = taskAnalysis(e.entry_id, task);
    if (t === undefined) return e.status === 'complete' ? 'not available' : 'not computed (entry incomplete)';
    const m = t.metrics;
    return `acceptable ${ratioText(m.acceptable)} (${ratioPct(m.acceptable)}), severe ${m.severe.count}, flips ${isByConstruction(m.flip) ? 'by construction' : ratioText(m.flip)}, contrast ${ratioText(m.contrast)}; ${marks(t).overall}`;
  };
  for (const c of choices) {
    const keyText = modelKeyText(c.model_key);
    if (c.used === null) ledgerRows.push([keyText, taskLetter(c.task), '—', 'none', 'no complete entry', '—']);
    else {
      const e = entryById.get(c.used);
      if (e !== undefined) ledgerRows.push([keyText, taskLetter(c.task), e.entry_id, e.status, 'used for marks and recommendation', metricsText(e, c.task)]);
    }
    for (const o of c.others) {
      const e = entryById.get(o.entry_id);
      if (e !== undefined) ledgerRows.push([keyText, taskLetter(c.task), e.entry_id, e.status, o.label === 'rerun, not used' ? 're-run, not used' : 'incomplete', metricsText(e, c.task)]);
    }
  }
  if (ledgerRows.length === 0) para('The ledger has no entries.');
  else out.push(...table(['Model_Key', 'Task', 'Entry', 'Status', 'Role', 'Metrics'], ledgerRows));

  // ---- 8. Support marks (R15.4, R18.6)
  h2('8. Support marks per link of the fallback chain');
  const inBrowser = state.combinations.filter((c) => !isWorkersAi(c) && c.phase1_locked);
  const workersCombos = runnable.filter(isWorkersAi);
  const runtimes = [...new Set(inBrowser.map((c) => c.runtime))].sort(cmp);
  const whyNot = (c: Combination, task: TaskType): string => {
    const used = usedEntryId(c, task, state);
    const ex = state.exclusions.find((x) => x.combination === c.id);
    if (ex !== undefined) return `${c.id}: Exclusion_Record (${ex.check})${used === null ? '' : `, entry ${used}`}`;
    if (overLimit.has(c.id)) return `${c.id}: over the In_Browser_Size_Limits${used === null ? '' : `, entry ${used}`}`;
    if (used !== null) return `${c.id}: entry ${used} did not pass`;
    if (hasFailure(c, state)) return `${c.id}: failure record (${state.failures.filter((f) => f.combination === c.id && countsForGate(f)).map((f) => f.kind).join(', ')}), no completed entry`;
    return `${c.id}: no completed Locked_Run for this Task_Type`;
  };
  const workersPass = (c: Combination, task: TaskType): string | null => {
    const used = usedEntryId(c, task, state);
    return used !== null && state.passes.get(used)?.[task] === true ? used : null;
  };
  const supportRows: string[][] = [];
  const browserPassing = (task: TaskType): { combo: Combination; entry: string }[] =>
    inBrowser.flatMap((c) => {
      const e = browserPassEntry(c, task, state);
      return e === null ? [] : [{ combo: c, entry: e }];
    });
  for (const task of TASKS) {
    for (const rt of runtimes) {
      const combos = inBrowser.filter((c) => c.runtime === rt);
      const passing = browserPassing(task).filter((p) => p.combo.runtime === rt);
      supportRows.push(
        passing.length > 0
          ? [taskLetter(task), `In-browser: ${rt}`, 'supported', passing.map((p) => `${p.combo.id}: entry ${p.entry}`).join('; ')]
          : [taskLetter(task), `In-browser: ${rt}`, 'not supported', combos.map((c) => whyNot(c, task)).join('; ')],
      );
    }
    const wp = workersCombos.flatMap((c) => {
      const e = workersPass(c, task);
      return e === null ? [] : [{ c, e }];
    });
    const wUsed = workersCombos.flatMap((c) => {
      const e = usedEntryId(c, task, state);
      return e === null ? [] : [{ c, e }];
    });
    const bp = browserPassing(task);
    if (wp.length > 0) supportRows.push([taskLetter(task), 'Workers AI', 'supported', wp.map((p) => `${p.c.id}: entry ${p.e}`).join('; ')]);
    else if (wUsed.length > 0) supportRows.push([taskLetter(task), 'Workers AI', 'not supported', wUsed.map((p) => `${p.c.id}: entry ${p.e} did not pass`).join('; ')]);
    else if (bp.length > 0) {
      supportRows.push([taskLetter(task), 'Workers AI', 'not measured (browser passed)', `passing in-browser entries: ${bp.map((p) => `${p.combo.id}: ${p.entry}`).join('; ')}; Smoke_Calls sent: ${smoke.sent}; accepted by the Output_Validator: ${smoke.accepted}`]);
    } else supportRows.push([taskLetter(task), 'Workers AI', 'not measured', 'no passing in-browser Combination, and no Workers AI Locked_Run for this Task_Type yet']);
    supportRows.push([taskLetter(task), 'Rules_Default', 'supported', 'always supported']);
  }
  out.push(...table(['Task', 'Link', 'Mark', 'Evidence (ledger entry IDs)'], supportRows));
  para('Smoke_Call outputs appear only in this section; they never enter a Metric, a pass or fail mark or an interval (R18.6).');

  // ---- 9. Recommendations (R15.3, R15.5, R15.6, R15.12, R18.7)
  h2('9. Recommendation per Task_Type');
  if (decisionHold(state)) para(`${HOLD_BANNER_PREFIX}${decisionHoldPending(state).join(', ')}`);
  const better = (a: { combo: Combination; entry: string }, b: { combo: Combination; entry: string }, task: TaskType): number => {
    const ma = taskAnalysis(a.entry, task);
    const mb = taskAnalysis(b.entry, task);
    if (ma !== undefined && mb !== undefined) {
      const l = ma.metrics.acceptable.num * mb.metrics.acceptable.den;
      const r = mb.metrics.acceptable.num * ma.metrics.acceptable.den;
      if (l !== r) return l > r ? -1 : 1;
      if (ma.metrics.severe.count !== mb.metrics.severe.count) return ma.metrics.severe.count - mb.metrics.severe.count;
      const pa = ma.latency.p95;
      const pb = mb.latency.p95;
      if (pa !== pb) return pa === 'no data' ? 1 : pb === 'no data' ? -1 : pa - pb;
    }
    return cmp(a.combo.id, b.combo.id);
  };
  para(RECOMMENDATION_SCOPE);
  para('Selection among passing Combinations of a link: highest acceptable rate, then fewest severe outputs, then lowest p95 latency, then Combination ID.');
  for (const task of TASKS) {
    h3(taskTitle(task));
    const bp = [...browserPassing(task)].sort((a, b) => better(a, b, task));
    const wp = workersCombos
      .flatMap((c) => {
        const e = workersPass(c, task);
        return e === null ? [] : [{ combo: c, entry: e }];
      })
      .sort((a, b) => better(a, b, task));
    const pick = bp[0];
    const wpick = wp[0];
    const describe = (p: { combo: Combination; entry: string }): string => {
      const t = taskAnalysis(p.entry, task);
      return t === undefined ? `${p.combo.id} (entry ${p.entry})` : `${p.combo.id} (entry ${p.entry}; acceptable ${ratioPct(t.metrics.acceptable)} [${marks(t).acceptable}], p95 ${latencyText(t.latency.p95)} ms)`;
    };
    out.push(`- In-browser Runtime: ${pick === undefined ? 'no recommended Combination' : `**${describe(pick)}**`}`);
    const workersLine = wpick !== undefined ? `**${describe(wpick)}**`
      : workersCombos.some((c) => usedEntryId(c, task, state) !== null) ? 'no recommended Combination (measured, did not pass)'
      : bp.length > 0 ? 'not measured (browser passed)'
      : 'no recommended Combination (not measured)';
    out.push(`- Workers AI: ${workersLine}`);
    out.push('- Rules_Default: last link, always supported', '');
    if (pick === undefined && wpick === undefined) {
      para(`Recommendation for ${taskLetter(task)}: **Rules_Default alone.** Thresholds failed, per Combination run:`);
      const lines: string[] = [];
      for (const c of [...inBrowser, ...workersCombos]) {
        const used = usedEntryId(c, task, state);
        const t = taskAnalysis(used, task);
        if (t !== undefined) lines.push(`- ${c.id} (entry ${used}): ${failedThresholds(t.metrics).join('; ') || 'passed the Thresholds but is not a browser pass (Exclusion_Record or over the limits)'}`);
        else if (!isWorkersAi(c) || usedEntryId(c, task, state) !== null) lines.push(`- ${c.id}: ${whyNot(c, task).slice(c.id.length + 2)}`);
      }
      out.push(...(lines.length > 0 ? lines : ['- no Combination was run for this Task_Type']), '');
    } else {
      para(`Recommended chain for ${taskLetter(task)}: ${pick === undefined ? '(no in-browser Combination)' : `in-browser ${pick.combo.id}`} → ${wpick === undefined ? `Workers AI ${bp.length > 0 && !workersCombos.some((c) => usedEntryId(c, task, state) !== null) ? 'not measured (browser passed)' : 'none'}` : `Workers AI ${wpick.combo.id}`} → Rules_Default.`);
    }
    for (const p of [pick, wpick]) {
      if (p === undefined) continue;
      const run = runById.get(p.entry);
      para(`Model_Fingerprint of ${p.combo.id} (entry ${p.entry}):`);
      out.push('```json', run === undefined ? '{}' : canonicalJson(run.header.fingerprint as JsonObject), '```', '');
      if (run !== undefined && cpuNodeCount(run) > 0) para(`**Risks:** this Combination places ${cpuNodeCount(run)} nodes on the CPU (${cpuNodeList(run)}); its latency figures are not pure-WebGPU results.`);
    }
  }

  // ---- 10. Voids, exclusions, failures, faults, re-runs, incomplete entries (R15.7)
  h2('10. Void cards, left-out pairs, failures, engine faults, re-runs and incomplete entries');
  const allRuns = [...lockedRuns];
  const voidIds = [...new Set(allRuns.flatMap((r) => r.excluded.filter((x) => x.reason === 'void').map((x) => x.id)))].sort(cmp);
  h3('Void cards');
  out.push(...(voidIds.length > 0 ? voidIds.map((id) => `- ${id}: Void_Card (named in the LOCK.md "Voided cards" table); left out of every Metric, interval and the Random_Baseline`) : ['- none']), '');
  h3('Contrast pairs left out of the consistency count');
  const pairLeft = new Map<string, string>();
  for (const r of allRuns) for (const p of r.excludedPairs) pairLeft.set(p.pairId, p.reason);
  out.push(...(pairLeft.size > 0 ? [...pairLeft].sort(([a], [b]) => cmp(a, b)).map(([id, why]) => `- ${id}: ${why}`) : ['- none']), '');
  h3('Failed Combinations');
  const failedLines: string[] = [];
  for (const f of state.failures) {
    const bits = ['message', 'reason', 'phase', 'cards_answered', 'quota', 'expected'].flatMap((k) => (f[k] === undefined || f[k] === null ? [] : [`${k}: ${typeof f[k] === 'string' ? f[k] : JSON.stringify(f[k])}`]));
    const eff = effectiveFailure(f);
    if (!countsForGate(f)) bits.unshift(`${eff.run_kind} run, ${eff.transient ? 'transient' : 'not transient'}; not counted as a Combination failure`);
    failedLines.push(`- ${f.combination}: failure record ${f.kind}${bits.length > 0 ? ` (${bits.join('; ')})` : ''}`);
  }
  for (const { run, task, analysis } of usedRuns) {
    if (!analysis.metrics.passes || !analysis.metrics.usableForMark) failedLines.push(`- ${run.combination}, ${taskLetter(task)} (entry ${run.id}): failed Thresholds: ${failedThresholds(analysis.metrics).join('; ')}`);
  }
  for (const x of state.exclusions) failedLines.push(`- ${x.combination}: excluded, see section 3 (${x.check})`);
  for (const id of overLimit) failedLines.push(`- ${id}: measured model download over 1,536 MiB, over the In_Browser_Size_Limits`);
  out.push(...(failedLines.length > 0 ? failedLines : ['- none']), '');
  h3('Engine faults (runtime_stuck, truncated_state) and engine rebuild failures (rebuild_failed)');
  const faultLines: string[] = [];
  for (const e of [...state.entries].sort((a, b) => a.order - b.order)) {
    const faults = runById.get(e.entry_id)?.faults ?? input.incompleteFaults.get(e.entry_id) ?? [];
    // One line per fault code: a `truncated_state` fault is reported under its own name, not as `runtime_stuck`.
    const groups: { kind: 'engine_fault' | 'rebuild_failed'; code: string; of: FaultRecord[] }[] = [];
    for (const f of faults) {
      const code = f.kind === 'engine_fault' ? (f.code ?? 'runtime_stuck') : 'rebuild_failed';
      const found = groups.find((g) => g.kind === f.kind && g.code === code);
      if (found === undefined) groups.push({ kind: f.kind, code, of: [f] });
      else found.of.push(f);
    }
    for (const kind of ['engine_fault', 'rebuild_failed'] as const) {
      for (const { code, of } of groups.filter((g) => g.kind === kind).sort((a, b) => (a.code < b.code ? -1 : 1))) {
        const ids = of.slice(0, 10).map((f) => `${f.cardId}/${f.permutation}`).join(', ');
        faultLines.push(
          kind === 'engine_fault'
            ? `- ${e.start.combination} (entry ${e.entry_id}): ${code} engine fault on ${of.length} request(s): ${ids}${of.length > 10 ? `, and ${of.length - 10} more` : ''}; not graded, in no numerator`
            : `- ${e.start.combination} (entry ${e.entry_id}): engine rebuild failed (rebuild_failed) for ${of.length} request(s): ${ids}${of.length > 10 ? `, and ${of.length - 10} more` : ''}; the Combination is reported as failed, not scored card by card`,
        );
      }
    }
  }
  out.push(...(faultLines.length > 0 ? faultLines : ['- none']), '');
  h3('Re-runs');
  const usedIds = new Set(choices.flatMap((c) => (c.used === null ? [] : [c.used])));
  const rerunLines = [...state.entries]
    .sort((a, b) => a.order - b.order)
    .filter((e) => e.start.rerun_of !== null)
    .map((e) => `- ${e.entry_id}: re-run of ${e.start.rerun_of}${e.start.rerun_reason === null ? '' : ` (reason: ${e.start.rerun_reason})`}; ${usedIds.has(e.entry_id) ? 'used for the marks' : e.status === 'complete' ? 're-run, not used' : 'incomplete'}`);
  out.push(...(rerunLines.length > 0 ? rerunLines : ['- none']), '');
  h3('Incomplete ledger entries');
  const incompleteLines = [...state.entries]
    .sort((a, b) => a.order - b.order)
    .filter((e) => e.status === 'incomplete')
    .map((e) => `- ${e.entry_id} (${e.start.combination}, subset ${e.start.task_subset}): incomplete, ${e.abort_reason !== null ? `aborted: ${e.abort_reason}` : 'in progress or interrupted'}`);
  out.push(...(incompleteLines.length > 0 ? incompleteLines : ['- none']), '');

  // ---- 11. Workers AI note (R15.10)
  h2('11. Workers AI note');
  para(
    'Workers AI measurements, or Smoke_Calls, used the REST API called from the local Probe_Runner. A production server path still has to decide or measure:',
    '',
  );
  out.push(
    '- the added latency of a Worker proxy in front of the model;',
    '- how to keep the Workers_AI_Token out of the browser;',
    '- the request budget and rate limits from `tech.md`.',
    '',
  );
  para('None of these is decided here.');

  // ---- 12. External reference (R19.16): the only place an External_Reference appears
  out.push(...externalSectionLines(input.external ?? [], input.authorSupplied ?? []));

  // ---- quality without timeout (R13.12)
  h2(QUALITY_WITHOUT_TIMEOUT_TITLE);
  para('Same denominator as the Metrics, but each timed-out base output that has a Late_Answer is replaced by the grade of that Late_Answer. A timeout without a Late_Answer stays Illegal.');
  out.push(
    ...table(
      ['Combination', 'Task', 'Entry', 'Acceptable rate, without timeout', 'Severe count, without timeout', 'Illegal rate, without timeout', 'Timeouts replaced by a Late_Answer'],
      usedRuns.map(({ run, task, analysis }) => {
        const w = analysis.metrics.withoutTimeout;
        return [run.combination, taskLetter(task), run.id, `${ratioText(w.acceptable)} (${ratioPct(w.acceptable)})`, `${w.severe}`, `${ratioText(w.illegal)} (${ratioPct(w.illegal)})`, `${w.replaced}`];
      }),
    ),
  );

  // ---- Dev_Run figures (R15.2)
  h2(DEV_SECTION_TITLE);
  para('These are Dev_Run figures. They are kept out of every mark and out of the recommendation. The Intel iGPU Dev_Run appears only here.');
  para(DEV_CONFOUND_NOTE);
  if (input.devRuns.some((r) => r.id === INTEL_TIMEOUT_RUN_ID)) para(INTEL_TIMEOUT_FINDING);
  const devRows = input.devRuns.flatMap((r) => {
    const workers = isWorkersAi(comboById.get(r.combination) ?? ({ runtime: '' } as Combination));
    const mem = memoryCells(r, workers);
    return r.tasks.map((t) => [
      r.id,
      r.combination,
      gpuLabel(r, workers),
      taskLetter(t.metrics.task),
      `${ratioText(t.metrics.acceptable)} (${ratioPct(t.metrics.acceptable)})${t.metrics.randomBaseline === null ? '' : `; random baseline ${pct(t.metrics.randomBaseline.num, t.metrics.randomBaseline.den)}`}`,
      `${t.metrics.severe.count}`,
      `${t.metrics.severeOtherPermutations}`,
      `${isByConstruction(t.metrics.flip) ? 'by construction' : ratioText(t.metrics.flip)}`,
      `${ratioText(t.metrics.contrast)}`,
      `${latencyText(t.latency.p50)} / ${latencyText(t.latency.p95)}`,
      mem.nvidia,
      mem.intel,
    ]);
  });
  if (devRows.length === 0) para('No Dev_Run figures are included.');
  else out.push(...table(['Dev_Run', 'Combination', 'GPU', 'Task', 'Acceptable (Dev_Run, base cards)', 'Severe (base cards)', 'Severe in other Permutations', 'Flips (non-base requests with an output)', 'Contrast pairs', 'Latency p50 / p95, ms (nearest rank, all requests with text)', NVIDIA_MEMORY_COLUMN, 'Intel iGPU peak memory, MiB (quantity named)'], devRows));

  // Request-level D figures next to their random baseline, and the position / shuffle diagnosis.
  const devDiag = input.devRuns.filter((r) => r.decisionDiagnosis != null && r.decisionDiagnosis.requests > 0);
  if (devDiag.length > 0) {
    h3('D requests against the random baseline, and position diagnosis (Dev_Run)');
    para(DEV_D_FINDING);
    para('The table above counts the base Permutation of each Scored_Card (Random_Baseline over cards). The lines below count every graded D request (all Permutations and the Sanity_Cards); the random baseline is computed from the cards (acceptable options / options per request), not typed in. Positions are 1-based in the printed order: "original" is the card order, "shown" is the order in that request\'s prompt.');
    for (const r of devDiag) out.push(`- **${r.id}** (${r.combination}):`, ...diagnosisLines(r.decisionDiagnosis as DecisionDiagnosis, 'Dev_Run').map((l) => `  - ${l}`));
    out.push('');
  }

  // ---- 13. Note on fine-tuning (R20.20)
  h2(FINE_TUNING_TITLE);
  para(FINE_TUNING_SENTENCE);

  while (out[out.length - 1] === '') out.pop();
  return `${out.join('\n')}\n`;
}
