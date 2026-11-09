// Phase gate (R18, R11.8, R11.19, R9.17): `allowWorkersAi` and `browserPass`, plus the pure
// derivations behind `phase-status` and `ledger`. Everything here is a function of injected data
// (ledger entries, failure and Exclusion_Records, Smoke_Call records, `combinations.json`,
// approvals read from `HEAD`, and the per-entry pass results), so tests use fixtures and the
// Report calls the very same `browserPass`. No I/O and no card content in this file.
import { fileURLToPath } from 'node:url';
import { loadAggregationRule, ruleVersionOf } from './templates.ts';
import { chooseReportEntries, modelKeysEqual, subsetTaskTypes, type LedgerEntry } from './ledger.ts';
import type { Approval, ApprovalsResult, DecisionStep } from './approvals.ts';
import type { TaskType } from './cards.ts';
import { countsForGate, type ExclusionRecord, type FailureRecord, type ModelKey, type SmokeRecord, type TaskSubset } from './results.ts';

// ---------------------------------------------------------------- Combination (combinations.json)

export type ResponseShape = 'chat' | 'text' | 'system_one';

export interface CombinationLicense {
  readonly name: string;
  readonly osi: boolean;
  readonly url: string;
  readonly declared_by: 'model' | 'base_model';
  readonly accepted: string | null;
}

/** Figures behind the In_Browser_Size_Limits (R9.3); null while not yet read or measured. */
export interface CombinationSize {
  readonly expected_download_bytes: number | null;
  readonly download_source: string;
  readonly params: number | null;
  readonly params_source: string;
  readonly vram_mib: number | null;
  readonly vram_source: string;
}

/**
 * One candidate Combination as `combinations.json` lists it (design: Combination). The fields the
 * gate reads are typed strictly; the rest is optional because Workers AI and in-browser entries
 * carry different extras (`model_lib_url`, `power_preference`, `sampling`, ...).
 */
export interface Combination {
  readonly id: string;
  readonly runtime: string;
  readonly model_id: string;
  readonly quantization: string;
  readonly revision: string;
  readonly phase1_locked: boolean;
  /** Workers AI only (R11.19). */
  readonly response_shape?: ResponseShape;
  /** Workers AI only: name of the output-length parameter and its source URL. */
  readonly max_output_param?: { readonly name: string; readonly source: string };
  /** Workers AI only: integer neurons per million tokens. */
  readonly prices?: { readonly input: number; readonly output: number; readonly source: string; readonly read_on: string };
  readonly license?: CombinationLicense;
  readonly size?: CombinationSize;
  readonly model_lib_url?: string;
  /** Decision_Variant (R20.1). Absent means `single`. */
  readonly variant?: DecisionVariant;
  /** `perm_avg` only: the ID of the `single` record whose stored bodies it aggregates (R20.1, DA-27). */
  readonly derives_from?: string;
  /** `perm_avg` only: the Aggregation_Rule file, its `rule_version` and the pinned Aggregation_Hash (R20.8). */
  readonly aggregation?: AggregationPin;
  /** `false` for a `perm_avg` record: it sends nothing. Absent on a `single` record. */
  readonly sends_requests?: boolean;
  readonly [extra: string]: unknown;
}

export type DecisionVariant = 'single' | 'perm_avg';

/** The pinned Aggregation_Rule of a `perm_avg` record (DA-27). `sha256` is the Aggregation_Hash. */
export interface AggregationPin {
  readonly file: string;
  readonly rule_version: number;
  readonly sha256: string;
}

/**
 * A Decision_Model Combination (R19.6, R19.11): `response_shape: "system_one"`, Task_Type D only. The validator
 * mode is required and fixed to `raw_choice` (R4.16): a record without it does not type check, and
 * `parseCombinations` refuses it at run time.
 */
export interface SystemOneCombination extends Combination {
  readonly response_shape: 'system_one';
  readonly validator_mode: 'raw_choice';
  /** The model name in the request body (`clef-flash`, `clef`). */
  readonly model_selector: string;
  /** W: input tokens the service accepts. A request body longer than this many bytes is refused (R19.11). */
  readonly context_window_tokens: number;
  /** K: the provisional or frozen cap on bytes per input token; part of the Model_Fingerprint. */
  readonly max_bytes_per_token: number;
  readonly prices: { readonly input: number; readonly output: number; readonly source: string; readonly read_on: string };
}

export const WORKERS_AI_RUNTIME = 'workers-ai';

/** The in-browser download limit of option M (R9.3): 1,536 MiB. */
export const IN_BROWSER_DOWNLOAD_LIMIT_BYTES = 1536 * 1024 * 1024;

export const isWorkersAi = (c: Combination): boolean => c.runtime === WORKERS_AI_RUNTIME;
/** The Decision_Variant of a record; a record without `variant` is `single` (R20.1). */
export const variantOf = (c: Combination): DecisionVariant => (c.variant === 'perm_avg' ? 'perm_avg' : 'single');
/** True for a `perm_avg` record: a derived Combination that has no Runtime and sends no request (R20.9). */
export const isPermAvg = (c: Combination): boolean => variantOf(c) === 'perm_avg';
/**
 * True for a `single` Decision_Model record, the one that carries the model, sampling and price members and is run
 * through a Runtime; `parseCombinations` has checked the extra members of such a record. A `perm_avg` record is not a
 * System_One Combination in this sense: nothing is sent for it (its gate is added with the variant approvals, task 42).
 */
export const isSystemOne = (c: Combination): c is SystemOneCombination => c.response_shape === 'system_one' && !isPermAvg(c);
export const comboModelKey = (c: Combination): ModelKey => ({ runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision });

/** True when a measured model download is over the In_Browser_Size_Limits (R9.11). */
export const overDownloadLimit = (measuredBytes: number): boolean => measuredBytes > IN_BROWSER_DOWNLOAD_LIMIT_BYTES;

/** Where the pinned Aggregation_Rule files are looked up: the repository root (this file is `eval/probe/src/phase.ts`). */
const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));

/** What the validator needs to know about an Aggregation_Rule file: its Aggregation_Hash and `rule_version`; null when unreadable. */
export type AggregationReader = (file: string) => { readonly sha256: string; readonly ruleVersion: number | null } | null;

/** Reads the rule file from the repository (the one I/O of this module, used while `combinations.json` is validated). */
export const readAggregationFromRepo: AggregationReader = (file) => {
  try {
    const rule = loadAggregationRule(REPO_DIR, file);
    return { sha256: rule.sha256, ruleVersion: ruleVersionOf(rule.text) };
  } catch {
    return null;
  }
};

/**
 * Parses `combinations.json` text: a JSON array of objects with the fields the gate needs. `readAggregation` is injectable
 * for tests; a `perm_avg` record is refused when the sha256 it pins differs from the rule file's (R20.8).
 */
export function parseCombinations(text: string, readAggregation: AggregationReader = readAggregationFromRepo): Combination[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('combinations.json is not valid JSON');
  }
  const list = Array.isArray(value) ? value : (value as { combinations?: unknown } | null)?.combinations;
  if (!Array.isArray(list)) throw new Error('combinations.json must be a list (or an object with a "combinations" list)');
  const seen = new Set<string>();
  list.forEach((c: unknown, i) => {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) throw new Error(`combinations[${i}] is not an object`);
    const o = c as Record<string, unknown>;
    for (const k of ['id', 'runtime', 'model_id', 'quantization', 'revision'] as const) {
      if (typeof o[k] !== 'string' || (k !== 'quantization' && o[k] === '')) throw new Error(`combinations[${i}].${k} must be a ${k === 'quantization' ? '' : 'non-empty '}string`);
    }
    if (typeof o['phase1_locked'] !== 'boolean') throw new Error(`combinations[${i}].phase1_locked must be a boolean`);
    const shape = o['response_shape'];
    if (shape !== undefined && shape !== 'chat' && shape !== 'text' && shape !== 'system_one') throw new Error(`combinations[${i}].response_shape must be chat, text or system_one`);
    const variant = o['variant'];
    if (variant !== undefined && variant !== 'single' && variant !== 'perm_avg') throw new Error(`combinations[${i}].variant must be "single" or "perm_avg"`);
    if (variant === 'perm_avg') checkPermAvgShape(o, i, readAggregation);
    else {
      if (shape === 'system_one') checkSystemOne(o, i);
      checkSingleVariant(o, i);
    }
    const id = o['id'] as string;
    if (seen.has(id)) throw new Error(`combinations[${i}].id "${id}" is a duplicate`);
    seen.add(id);
  });
  // Cross-record rules (R20.1, DA-27): each `perm_avg` record derives from a `single` record of the same model.
  const byId = new Map<string, Record<string, unknown>>(list.map((c: Record<string, unknown>) => [c['id'] as string, c]));
  list.forEach((c: Record<string, unknown>, i) => {
    if (c['variant'] !== 'perm_avg') return;
    checkPermAvgSource(c, byId, `combinations[${i}]`);
  });
  return list as Combination[];
}

/** A `single` record carries none of the `perm_avg` members (DA-27). */
function checkSingleVariant(o: Record<string, unknown>, i: number): void {
  const at = `combinations[${i}]`;
  if (o['derives_from'] !== undefined) throw new Error(`${at}.derives_from is not allowed on a "single" record`);
  if (o['aggregation'] !== undefined) throw new Error(`${at}.aggregation is not allowed on a "single" record`);
  if (o['sends_requests'] !== undefined && o['sends_requests'] !== true) throw new Error(`${at}.sends_requests must be absent or true on a "single" record`);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Members a `perm_avg` record must not carry: it sends nothing, so the checks that need them read the `derives_from` record (DA-27). */
const PERM_AVG_FORBIDDEN = ['sampling', 'prices', 'context_window_tokens', 'max_bytes_per_token'] as const;

/** Shape of a `perm_avg` record, alone: R20.1, R20.8, DA-27. */
function checkPermAvgShape(o: Record<string, unknown>, i: number, readAggregation: AggregationReader): void {
  const at = `combinations[${i}]`;
  if (o['response_shape'] !== 'system_one') throw new Error(`${at}.response_shape must be "system_one" for a "perm_avg" record`);
  if (o['validator_mode'] !== 'raw_choice') throw new Error(`${at}.validator_mode must be "raw_choice" for a "perm_avg" record`);
  if (o['task_subset_allowed'] !== 'D') throw new Error(`${at}.task_subset_allowed must be "D" for a "perm_avg" record`);
  if (o['phase1_locked'] !== false) throw new Error(`${at}.phase1_locked must be false for a "perm_avg" record`);
  if (o['sends_requests'] !== false) throw new Error(`${at}.sends_requests must be false for a "perm_avg" record`);
  if (typeof o['derives_from'] !== 'string' || o['derives_from'] === '') throw new Error(`${at}.derives_from must name the "single" record it derives from`);
  if (typeof o['model_selector'] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(o['model_selector'])) throw new Error(`${at}.model_selector must be a model name such as "clef-flash"`);
  for (const k of PERM_AVG_FORBIDDEN) if (o[k] !== undefined) throw new Error(`${at}.${k} is not allowed on a "perm_avg" record (it sends nothing; read it from the derives_from record)`);
  const agg = o['aggregation'];
  if (typeof agg !== 'object' || agg === null || Array.isArray(agg)) throw new Error(`${at}.aggregation must be an object with file, rule_version and sha256`);
  const a = agg as Record<string, unknown>;
  if (typeof a['file'] !== 'string' || a['file'] === '') throw new Error(`${at}.aggregation.file must be a non-empty string`);
  if (!isPositiveInt(a['rule_version'])) throw new Error(`${at}.aggregation.rule_version must be a positive integer`);
  if (typeof a['sha256'] !== 'string' || !SHA256_HEX.test(a['sha256'])) throw new Error(`${at}.aggregation.sha256 must be 64 lowercase hex digits`);
  const rule = readAggregation(a['file']);
  if (rule === null) throw new Error(`${at}.aggregation.file "${a['file']}" cannot be read`);
  if (rule.sha256 !== a['sha256']) throw new Error(`${at}.aggregation.sha256 does not equal the sha256 of ${a['file']} (pinned ${a['sha256']}, file ${rule.sha256})`);
  if (rule.ruleVersion !== a['rule_version']) throw new Error(`${at}.aggregation.rule_version ${String(a['rule_version'])} differs from the rule_version line of ${a['file']} (${String(rule.ruleVersion)})`);
}

/** The model fields a `perm_avg` record repeats from its source (DA-27 Cons: a test checks they are equal). */
const PERM_AVG_REPEATED = ['runtime', 'model_id', 'model_selector', 'quantization', 'revision', 'question_id'] as const;

function checkPermAvgSource(o: Record<string, unknown>, byId: ReadonlyMap<string, Record<string, unknown>>, at: string): void {
  const from = o['derives_from'] as string;
  const src = byId.get(from);
  if (src === undefined) throw new Error(`${at}.derives_from "${from}" is not a record of combinations.json`);
  if (src['variant'] !== undefined && src['variant'] !== 'single') throw new Error(`${at}.derives_from "${from}" is not a "single" record`);
  if (src['response_shape'] !== 'system_one') throw new Error(`${at}.derives_from "${from}" is not a System_One record`);
  for (const k of PERM_AVG_REPEATED) {
    if (o[k] !== src[k]) throw new Error(`${at}.${k} differs from the derives_from record ${from}`);
  }
  if (JSON.stringify(o['mapping']) !== JSON.stringify(src['mapping'])) throw new Error(`${at}.mapping differs from the derives_from record ${from}`);
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** The members a `system_one` record must carry (R19.6, R19.11, R19.12). */
function checkSystemOne(o: Record<string, unknown>, i: number): void {
  const at = `combinations[${i}]`;
  if (o['validator_mode'] !== 'raw_choice') throw new Error(`${at}.validator_mode must be "raw_choice" for response_shape system_one`);
  if (typeof o['model_selector'] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(o['model_selector'])) throw new Error(`${at}.model_selector must be a model name such as "clef-flash"`);
  if (!isPositiveInt(o['context_window_tokens'])) throw new Error(`${at}.context_window_tokens must be a positive integer`);
  if (!isPositiveInt(o['max_bytes_per_token'])) throw new Error(`${at}.max_bytes_per_token must be a positive integer`);
  const prices = o['prices'];
  const input = typeof prices === 'object' && prices !== null ? (prices as Record<string, unknown>)['input'] : undefined;
  if (!isPositiveInt(input)) throw new Error(`${at}.prices.input must be a positive integer`);
  if (o['task_subset_allowed'] !== 'D') throw new Error(`${at}.task_subset_allowed must be "D" for response_shape system_one`);
}

// ---------------------------------------------------------------- state

/** Pass result of one ledger entry per Task_Type under R13.4 (`TaskMetrics.passes`). */
export type EntryPasses = { readonly decision?: boolean; readonly synthesis?: boolean };

/** Everything the gate derives from. Built by the caller (I/O in `phase-commands.ts`). */
export interface PhaseState {
  readonly combinations: readonly Combination[];
  readonly entries: readonly LedgerEntry[];
  readonly failures: readonly FailureRecord[];
  readonly exclusions: readonly ExclusionRecord[];
  /** Smoke_Call records in chronological order (oldest first). */
  readonly smoke: readonly SmokeRecord[];
  /** Approvals from `HEAD` (R11.20); `approved: false` means Smoke_Calls only. */
  readonly approvals: ApprovalsResult;
  /** Entry ID -> pass per Task_Type. Only `complete` entries are consulted. */
  readonly passes: ReadonlyMap<string, EntryPasses>;
  /** Combination IDs whose measured download is over the In_Browser_Size_Limits (R9.11). */
  readonly overLimit: ReadonlySet<string>;
  /** Dev_Run headers, oldest first. Read by the Decision_Model gate only (R19.5); absent means none. */
  readonly devRuns?: readonly DevRunInfo[];
  /**
   * The current variant registry per `model_id` (R20.1): the `variant` ids and the Aggregation_Hashes as read now. Compared
   * with the registry in the earliest Decision_Model Dev_Run header by `registryCheck`. Absent means not read.
   */
  readonly registry?: ReadonlyMap<string, readonly VariantRegistryEntry[]>;
  /** Derived_Run files (headers only) of both splits, oldest first. Counted as the variant's Results file (R20.13). */
  readonly derived?: readonly DerivedRunInfo[];
  /**
   * What the I/O side found about the sources a derive step reads (DA-27). Built only by `derive`, which has opened the
   * Dev cards for the plan; absent means nothing is known and every derive step is refused.
   */
  readonly variantSources?: VariantSources;
}

/** Header facts of one Derived_Run file. */
export interface DerivedRunInfo {
  readonly run_id: string;
  /** The `perm_avg` Combination ID. */
  readonly combination: string;
  readonly split: 'dev' | 'locked';
  readonly template_hashes: Readonly<Record<string, string>>;
}

export interface VariantSources {
  /** `single` Combination IDs whose newest equal-mapping Dev_Run Results file is complete (RC-24). */
  readonly devComplete: ReadonlySet<string>;
  /** `single` Combination IDs whose first `complete` D ledger entry has a complete Results file (RC-24). */
  readonly lockedComplete: ReadonlySet<string>;
  /** `single` Combination ID -> Template_Hash of its System_One_Mapping file as of now. */
  readonly mappingHash: ReadonlyMap<string, string>;
}

/** What the Decision_Model gate needs from a Dev_Run Results header. */
export interface DevRunInfo {
  readonly run_id: string;
  readonly combination: string;
  readonly task_subset: string;
  readonly template_hashes: Readonly<Record<string, string>>;
  /**
   * False when the Results file holds only `not_run` / `not_approved` records, i.e. the gate refused the run and nothing
   * was sent. Absent means true. Read by `phase2Candidates` only.
   */
  readonly attempted?: boolean;
  /** The variant registry written into the header (R20.1); absent for a file written before the variants. */
  readonly variants?: readonly VariantRegistryEntry[];
  /** Header `variant`; absent means `single`. */
  readonly variant?: string;
}

export type Branch = 'A' | 'B';

const TASKS: readonly TaskType[] = ['decision', 'synthesis'];
const taskLetter = (t: TaskType): 'D' | 'S' => (t === 'decision' ? 'D' : 'S');

function subsetOfTasks(tasks: readonly TaskType[]): TaskSubset | null {
  const d = tasks.includes('decision');
  const s = tasks.includes('synthesis');
  return d && s ? 'DS' : d ? 'D' : s ? 'S' : null;
}

// ---------------------------------------------------------------- Phase_1

/** Why a `phase1_locked` Combination has finished Phase_1; null while it has not. */
export type Phase1Finish = 'complete' | 'failure' | 'exclusion';

/** Task_Types covered by `complete` entries of the Combination's Model_Key (union over entries). */
function completeCoverage(combo: Combination, state: PhaseState): Set<TaskType> {
  const key = comboModelKey(combo);
  const covered = new Set<TaskType>();
  for (const e of state.entries) {
    if (e.status === 'complete' && modelKeysEqual(e.start.model_key, key)) for (const t of subsetTaskTypes(e.start.task_subset)) covered.add(t);
  }
  return covered;
}

export const hasExclusion = (combo: Combination, state: PhaseState): boolean => state.exclusions.some((x) => x.combination === combo.id);
/**
 * A Combination has failed Phase_1 only through a non-transient failure of a Locked_Run (Author, 2026-11-08):
 * a Dev_Run failure and a transient network error never finish it. See `effectiveFailure` in `results.ts`.
 */
export const hasFailure = (combo: Combination, state: PhaseState): boolean => state.failures.some((f) => f.combination === combo.id && countsForGate(f));

/** Terminal Phase_1 state of one Combination, or null when it still needs a run (R18.2, R9.17). */
export function phase1Finish(combo: Combination, state: PhaseState): Phase1Finish | null {
  if (hasExclusion(combo, state)) return 'exclusion';
  if (hasFailure(combo, state)) return 'failure';
  const covered = completeCoverage(combo, state);
  return TASKS.every((t) => covered.has(t)) ? 'complete' : null;
}

export const phase1Combinations = (state: PhaseState): Combination[] => state.combinations.filter((c) => c.phase1_locked);

/** Phase_1 ends exactly when every `phase1_locked` Combination has finished. */
export function phase1Pending(state: PhaseState): Combination[] {
  return phase1Combinations(state).filter((c) => phase1Finish(c, state) === null);
}
export const phase1Ended = (state: PhaseState): boolean => phase1Pending(state).length === 0;

// ---------------------------------------------------------------- browserPass

/** The `complete` entry used under R3.8 for the Combination's Model_Key and the Task_Type. */
export function usedEntryId(combo: Combination, task: TaskType, state: PhaseState): string | null {
  const key = comboModelKey(combo);
  const choice = chooseReportEntries(state.entries).find((c) => c.task === task && modelKeysEqual(c.model_key, key));
  return choice?.used ?? null;
}

/**
 * True only when the Combination passed `task` under R13.4 in the entry used under R3.8, has no
 * Exclusion_Record and is not over the In_Browser_Size_Limits (R9.11, R9.17, R18.2). A Workers AI
 * Combination is never a browser pass. Failure records do not remove a pass that a `complete`
 * entry already earned for a Task_Type (the failure then concerns another run).
 */
export function browserPass(combo: Combination, task: TaskType, state: PhaseState): boolean {
  return browserPassEntry(combo, task, state) !== null;
}

/** The entry ID that makes `browserPass` true, or null. Same rules as `browserPass`. */
export function browserPassEntry(combo: Combination, task: TaskType, state: PhaseState): string | null {
  if (isWorkersAi(combo)) return null;
  if (hasExclusion(combo, state) || state.overLimit.has(combo.id)) return null;
  const used = usedEntryId(combo, task, state);
  if (used === null) return null;
  return state.passes.get(used)?.[task] === true ? used : null;
}

// ---------------------------------------------------------------- phase-status

export interface TaskPhaseResult {
  readonly task: TaskType;
  readonly pass: boolean;
  /** Ledger entries that made some `phase1_locked` Combination pass (empty on no pass). */
  readonly passingEntries: readonly { readonly combination: string; readonly entry_id: string }[];
  /** For a no-pass: the entries that were evaluated and did not pass. */
  readonly evaluatedEntries: readonly { readonly combination: string; readonly entry_id: string; readonly note: string }[];
}

export interface PendingCombination {
  readonly combination: string;
  readonly missing: readonly TaskType[];
}

export interface PhaseStatus {
  readonly ended: boolean;
  readonly pending: readonly PendingCombination[];
  readonly finished: readonly { readonly combination: string; readonly by: Phase1Finish }[];
  readonly tasks: readonly TaskPhaseResult[];
  /** Branch that follows; null while Phase_1 is in progress. */
  readonly branch: Branch | null;
  /** Task_Types without a browser pass, as a subset; null on branch A or while Phase_1 runs. */
  readonly subset: TaskSubset | null;
  /** The `phase2` approval on `HEAD` (the last one), or null. */
  readonly phase2: Approval | null;
  /** Set when the recorded `phase2` entry disagrees with the recomputed branch or subset. */
  readonly mismatch: string | null;
  /** The `approvals.json` problem, when it could not be read from `HEAD`. */
  readonly approvalsProblem: string | null;
}

function noPassNote(combo: Combination, entry: string, task: TaskType, state: PhaseState): string {
  if (hasExclusion(combo, state)) return 'Exclusion_Record';
  if (state.overLimit.has(combo.id)) return 'over the In_Browser_Size_Limits';
  const p = state.passes.get(entry)?.[task];
  return p === undefined ? 'no pass result available' : 'did not pass R13.4';
}

/** The last `phase2` entry on `HEAD`, if the approvals could be read. */
export function phase2Entry(state: PhaseState): Approval | null {
  if (!state.approvals.approved) return null;
  const list = state.approvals.approvals.filter((a) => a.kind === 'phase2');
  return list.length === 0 ? null : (list[list.length - 1] as Approval);
}

/** `B:S`-style text of a branch and subset, for messages. */
export const describeBranch = (branch: Branch | null, subset: string | null | undefined): string =>
  branch === null ? 'none' : branch === 'A' ? 'A (no subset)' : `B (subset ${subset ?? 'none'})`;

export function phaseStatus(state: PhaseState): PhaseStatus {
  const phase1 = phase1Combinations(state);
  const pending = phase1Pending(state).map((c) => ({
    combination: c.id,
    missing: TASKS.filter((t) => !completeCoverage(c, state).has(t)),
  }));
  const finished = phase1
    .map((c) => ({ combination: c.id, by: phase1Finish(c, state) }))
    .filter((f): f is { combination: string; by: Phase1Finish } => f.by !== null);
  const ended = pending.length === 0;

  const tasks: TaskPhaseResult[] = TASKS.map((task) => {
    const passing: { combination: string; entry_id: string }[] = [];
    const evaluated: { combination: string; entry_id: string; note: string }[] = [];
    for (const c of phase1) {
      const pe = browserPassEntry(c, task, state);
      if (pe !== null) passing.push({ combination: c.id, entry_id: pe });
      else {
        const used = usedEntryId(c, task, state);
        if (used !== null) evaluated.push({ combination: c.id, entry_id: used, note: noPassNote(c, used, task, state) });
      }
    }
    return { task, pass: passing.length > 0, passingEntries: passing, evaluatedEntries: passing.length > 0 ? [] : evaluated };
  });

  const failing = tasks.filter((t) => !t.pass).map((t) => t.task);
  const branch: Branch | null = !ended ? null : failing.length === 0 ? 'A' : 'B';
  const subset = branch === 'B' ? subsetOfTasks(failing) : null;
  const phase2 = phase2Entry(state);

  let mismatch: string | null = null;
  if (phase2 !== null && branch !== null) {
    const recorded = phase2.branch === 'A' || phase2.branch === 'B' ? (phase2.branch as Branch) : null;
    const recordedSubset = phase2.task_subset ?? null;
    if (recorded !== branch || (branch === 'B' && recordedSubset !== subset)) {
      mismatch = `phase2 entry ${phase2.id} records branch ${describeBranch(recorded, recordedSubset)} but phase-status recomputes branch ${describeBranch(branch, subset)}`;
    }
  }
  return {
    ended,
    pending,
    finished,
    tasks,
    branch,
    subset,
    phase2,
    mismatch,
    approvalsProblem: state.approvals.approved ? null : state.approvals.reason,
  };
}

// ---------------------------------------------------------------- allowWorkersAi

export type GateKind = 'smoke' | 'dev' | 'locked';

export interface GateDecision {
  /** `full`: the run may send its Cards. `smoke_only`: at most the Smoke_Calls left in the count. */
  readonly allowed: 'smoke_only' | 'full';
  /** The gate condition that decided (printed when a non-smoke run is refused). */
  readonly reason: string;
  readonly phase: 'phase1' | 'phase2';
  /** Branch recomputed from the ledger; null while Phase_1 is in progress. */
  readonly branch: Branch | null;
  /** Recomputed failing Task_Type_Subset (branch B), else null. */
  readonly subset: TaskSubset | null;
  /** IDs of the `phase2` and the matching `dev`/`locked` approval when `allowed` is `full`. */
  readonly approvals: readonly string[];
}

/**
 * The one gate for every Workers AI request (R18.1 to R18.4, R11.8, R11.19, R11.20).
 *
 * A refusal is not an error: the caller then sends at most the remaining Smoke_Calls, records
 * every other Card × Permutation as `not_run` with reason `not_approved`, prints `reason` and, for
 * a Locked_Run, writes no ledger entry. `smoke` itself is always `smoke_only` (the count is the
 * budget's business). Request-count caps of an approval are checked by `findApproval`.
 */
export function allowWorkersAi(kind: GateKind, combo: Combination, task_subset: TaskSubset, state: PhaseState): GateDecision {
  const status = phaseStatus(state);
  const base = { phase: status.ended && status.phase2 !== null ? ('phase2' as const) : ('phase1' as const), branch: status.branch, subset: status.subset, approvals: [] as string[] };
  const smokeOnly = (reason: string): GateDecision => ({ ...base, allowed: 'smoke_only', reason });

  if (kind === 'smoke') return smokeOnly('Smoke_Calls are allowed in every phase, within the daily count');
  if (!isWorkersAi(combo)) return { ...base, allowed: 'full', reason: `${combo.id} is not a Workers AI Combination; the phase gate does not apply` };

  if (!state.approvals.approved) return smokeOnly(`approvals.json is not usable: ${state.approvals.reason}`);
  if (!status.ended) {
    const names = status.pending.map((p) => `${p.combination} (${p.missing.map(taskLetter).join('')} missing)`).join(', ');
    return smokeOnly(`Phase_1 has not ended; waiting for: ${names}`);
  }
  const p2 = status.phase2;
  if (p2 === null) return smokeOnly(`Phase_1 has ended (branch ${describeBranch(status.branch, status.subset)}) but approvals.json holds no phase2 entry`);
  if (status.mismatch !== null) return smokeOnly(`branch mismatch: ${status.mismatch}`);
  if (status.branch === 'A') return smokeOnly(`branch A (D and S both passed in the browser): only Smoke_Calls are allowed (phase2 entry ${p2.id})`);

  // Branch B from here on.
  if (p2.model !== combo.model_id) return smokeOnly(`phase2 entry ${p2.id} names model ${String(p2.model ?? 'none')}, not ${combo.model_id}`);
  if (task_subset !== status.subset) return smokeOnly(`requested Task_Type_Subset ${task_subset} differs from the failing subset ${String(status.subset)}`);
  const wanted = approvalMatches(state.approvals.approvals, kind, combo.id, task_subset, p2.id);
  if (wanted.length === 0) return smokeOnly(`no ${kind} approval for ${combo.id} with Task_Type_Subset ${task_subset} under phase2 entry ${p2.id}`);

  const shape = shapeGate(combo, state.smoke);
  if (shape !== null) return smokeOnly(shape);

  return { ...base, phase: 'phase2', allowed: 'full', reason: `branch B, model ${combo.model_id}, subset ${task_subset}`, approvals: [p2.id, ...wanted] };
}

function approvalMatches(approvals: readonly Approval[], kind: 'dev' | 'locked', comboId: string, subset: TaskSubset, phase2Id: string): string[] {
  return approvals
    .filter((a) => a.kind === kind && a.combination === comboId && (a.task_subset ?? null) === subset && a.phase2 === phase2Id)
    .map((a) => a.id);
}

/** Response_Shape gate (R11.19): the newest Smoke_Call record of the Combination must be `ok` for the declared shape. */
function shapeGate(combo: Combination, smoke: readonly SmokeRecord[]): string | null {
  const mine = smoke.filter((s) => s['combination'] === combo.id && s['shape_check'] !== undefined);
  const newest = mine[mine.length - 1];
  if (newest === undefined) return `no Smoke_Call shape check for ${combo.id}; run \`probe smoke\` first (R11.19)`;
  if (newest['shape_check'] !== 'ok') {
    return `newest Smoke_Call shape check for ${combo.id} is ${String(newest['shape_check'])} (HTTP status ${String(newest['http_status'] ?? 'unknown')}) for declared shape ${String(newest['declared_shape'])}`;
  }
  if (newest['declared_shape'] !== combo.response_shape) {
    return `newest Smoke_Call for ${combo.id} confirmed shape ${String(newest['declared_shape'])} but combinations.json now declares ${String(combo.response_shape)}`;
  }
  return null;
}

// ---------------------------------------------------------------- output text

/** Lines `phase-status` prints. Entry IDs and Combination IDs only; no card content. */
export function formatPhaseStatus(status: PhaseStatus): string[] {
  const out: string[] = [];
  out.push(`Phase_1: ${status.ended ? 'ended' : 'in progress'}`);
  for (const f of status.finished) out.push(`  finished  ${f.combination}  (${f.by === 'complete' ? 'complete D and S entry' : f.by === 'failure' ? 'failure record' : 'Exclusion_Record'})`);
  for (const p of status.pending) out.push(`  pending   ${p.combination}  (needs ${p.missing.map(taskLetter).join(' and ')})`);
  for (const t of status.tasks) {
    const label = t.task === 'decision' ? 'D (decision)' : 'S (synthesis)';
    if (t.pass) out.push(`${label}: pass  ${t.passingEntries.map((e) => `${e.combination} ${e.entry_id}`).join('; ')}`);
    else {
      const ev = t.evaluatedEntries.map((e) => `${e.combination} ${e.entry_id} (${e.note})`).join('; ');
      out.push(`${label}: no pass${ev === '' ? '' : `  evaluated: ${ev}`}`);
    }
  }
  if (status.approvalsProblem !== null) out.push(`approvals: not usable (${status.approvalsProblem})`);
  if (status.branch === null) out.push('Branch: not decided (Phase_1 in progress)');
  else if (status.branch === 'A') out.push('Branch: A (D and S both passed in the browser); Phase_2 sends Smoke_Calls only');
  else out.push(`Branch: B (Workers AI measures subset ${String(status.subset)}); Phase_2 needs a model named by the Author`);
  if (status.phase2 === null) out.push(status.ended ? 'phase2 approval: none; ask the Author before starting Phase_2' : 'phase2 approval: none');
  else out.push(`phase2 approval: ${status.phase2.id} (${status.phase2.approved_on}), branch ${describeBranch(status.phase2.branch === 'A' ? 'A' : 'B', status.phase2.task_subset)}${status.phase2.model ? `, model ${status.phase2.model}` : ''}`);
  if (status.mismatch !== null) out.push(`MISMATCH: ${status.mismatch}; every non-smoke Workers AI run is refused`);
  return out;
}

/**
 * Phase_2 result lines: one per `complete` Workers AI ledger entry, with its pass or fail per Task_Type under R13.4.
 * `phase-status` above covers the Phase_1 browser question only (R18.2); this keeps a Phase_2 Locked_Run visible.
 */
export function phase2ResultLines(state: PhaseState): string[] {
  const out: string[] = [];
  for (const e of [...state.entries].sort((a, b) => a.order - b.order)) {
    if (e.status !== 'complete') continue;
    const combo = state.combinations.find((c) => c.id === e.start.combination);
    if (combo === undefined || !isWorkersAi(combo)) continue;
    const passes = state.passes.get(e.entry_id);
    const marks = subsetTaskTypes(e.start.task_subset).map((t) => `${taskLetter(t)} ${passes?.[t] === undefined ? 'unknown' : passes[t] ? 'pass' : 'fail'}`);
    out.push(`Phase_2 Locked_Run: ${combo.id} ${e.entry_id} (subset ${e.start.task_subset}): ${marks.join(', ')}`);
  }
  return out;
}

export interface LedgerRow {
  readonly entry_id: string;
  readonly combination: string;
  readonly task_subset: TaskSubset;
  readonly status: 'complete' | 'incomplete';
  readonly detail: string;
  readonly rerun_of: string | null;
}

/** Rows for the `ledger` command, in ledger order. */
export function ledgerRows(entries: readonly LedgerEntry[]): LedgerRow[] {
  return [...entries]
    .sort((a, b) => a.order - b.order)
    .map((e) => ({
      entry_id: e.entry_id,
      combination: e.start.combination,
      task_subset: e.start.task_subset,
      status: e.status,
      rerun_of: e.start.rerun_of,
      detail:
        e.status === 'complete'
          ? `ended ${e.complete?.ended_at ?? ''}`
          : e.abort_reason !== null
            ? `aborted: ${e.abort_reason}`
            : e.resumes > 0
              ? `resumed ${e.resumes}x`
              : 'started',
    }));
}

export function formatLedger(entries: readonly LedgerEntry[]): string[] {
  const rows = ledgerRows(entries);
  if (rows.length === 0) return ['ledger: no entries'];
  return rows.map((r) => `${r.entry_id}  ${r.combination}  subset ${r.task_subset}  ${r.status}  ${r.detail}${r.rerun_of === null ? '' : `  re-run of ${r.rerun_of}`}`);
}

// ---------------------------------------------------------------- Decision_Models (R19, DA-21, DA-22)

/** A Decision_Model is a Workers AI Combination with the `system_one` Response_Shape (design: Decision_Model Combination records). */
export const isDecisionModel = (c: Combination): boolean => isWorkersAi(c) && c.response_shape === 'system_one' && !isPermAvg(c);
/** A Decision_Variant (R20.1, DA-27): a Workers AI `system_one` record of either variant. The hold, the count and the status lines iterate these. */
export const isDecisionVariant = (c: Combination): boolean => isWorkersAi(c) && c.response_shape === 'system_one';

/** IDs withdrawn by some `withdrawal` entry (DA-21). A withdrawal of a withdrawal does nothing: only `decision_model` entries are looked up. */
export function withdrawnIds(approvals: readonly Approval[]): Set<string> {
  const out = new Set<string>();
  for (const a of approvals) if (a.kind === 'withdrawal') for (const id of a.withdraws ?? []) out.add(id);
  return out;
}

/** Unwithdrawn `decision_model` entries, optionally for one Combination and one step. */
export function decisionModelApprovals(approvals: readonly Approval[], combinationId?: string, step?: DecisionStep, variant: 'single' | 'perm_avg' = 'single'): Approval[] {
  const gone = withdrawnIds(approvals);
  return approvals.filter(
    (a) =>
      a.kind === 'decision_model' &&
      !gone.has(a.id) &&
      (a.variant ?? 'single') === variant &&
      (combinationId === undefined || a.combination === combinationId) &&
      (step === undefined || a.step === step),
  );
}

export type DecisionStepKind = 'smoke' | 'dev' | 'locked';

/** What the caller knows about the planned run: the request count and the mapping file's Template_Hash. */
export interface DecisionPlan {
  readonly count: number;
  readonly mappingHash: string;
}

export type DecisionGate =
  /** Task_Type_Subset contains S: exit non-zero, write nothing at all (R19.1). Nothing else was read. */
  | { readonly outcome: 'wrong_subset'; readonly reason: string }
  /** A refused run: no request, `not_run` with `not_approved`, no ledger entry for a Locked_Run, non-zero exit. */
  | { readonly outcome: 'refused'; readonly reason: string }
  | { readonly outcome: 'allowed'; readonly reason: string; readonly approval: string | null };

/**
 * The gate for the Decision_Models (R19.1, R19.4, R19.5, R18.1, R18.3, R18.4, DA-21). It never looks at the
 * branch, the `phase2` entry or an approval of another kind. Order of checks:
 * (1) subset exactly D; (2) Phase_1 ended; (3) an unwithdrawn `decision_model` entry for this Combination and step;
 * (4) smoke, Dev_Run, Locked_Run order; (5) planned count within the entry's `max_requests`.
 * A `smoke` step needs no approval (RC-10): the 10-per-UTC-day count and the budget caps are the budget's business.
 * `plan` is required for `dev` and `locked`.
 */
export function allowDecisionModel(step: DecisionStepKind, combo: Combination, task_subset: TaskSubset, state: PhaseState, plan?: DecisionPlan): DecisionGate {
  if (task_subset !== 'D') {
    return { outcome: 'wrong_subset', reason: `task_subset: ${combo.id} accepts Task_Type D only; requested ${task_subset}` };
  }
  if (!isDecisionModel(combo)) return { outcome: 'refused', reason: `${combo.id} is not a Decision_Model (response_shape system_one)` };
  if (step === 'smoke') return { outcome: 'allowed', reason: 'Decision_Model Smoke_Calls need no approval (RC-10); the daily count and the budget caps apply', approval: null };

  if (!phase1Ended(state)) {
    const names = phase1Pending(state).map((c) => c.id).join(', ');
    return { outcome: 'refused', reason: `Phase_1 has not ended; waiting for: ${names}` };
  }
  if (!state.approvals.approved) return { outcome: 'refused', reason: `approvals.json is not usable: ${state.approvals.reason}` };
  const entries = decisionModelApprovals(state.approvals.approvals, combo.id, step);
  if (entries.length === 0) return { outcome: 'refused', reason: `no unwithdrawn decision_model ${step} approval for ${combo.id}` };

  const shape = shapeGate(combo, state.smoke);
  if (shape !== null) return { outcome: 'refused', reason: shape };
  if (plan === undefined) return { outcome: 'refused', reason: 'the planned request count and mapping Template_Hash were not given' };
  if (step === 'locked') {
    const mine = (state.devRuns ?? []).filter((d) => d.combination === combo.id);
    const newest = mine[mine.length - 1];
    if (newest === undefined) return { outcome: 'refused', reason: `no Dev_Run of ${combo.id} precedes the Locked_Run (R19.5)` };
    if (newest.template_hashes['decision'] !== plan.mappingHash) {
      return { outcome: 'refused', reason: `mapping Template_Hash differs from the newest Dev_Run ${newest.run_id} (recorded ${newest.template_hashes['decision'] ?? 'none'}, current ${plan.mappingHash})` };
    }
  }
  const fit = entries.find((a) => a.max_requests !== undefined && plan.count <= a.max_requests);
  if (fit === undefined) {
    return { outcome: 'refused', reason: `planned ${plan.count} requests exceed max_requests of ${entries.map((a) => `${a.id} (${String(a.max_requests)})`).join(', ')}` };
  }
  return { outcome: 'allowed', reason: `${step} approval ${fit.id} for ${combo.id}, ${plan.count} requests`, approval: fit.id };
}

/**
 * R19.17, per variant (R20.10): true exactly when some Decision_Variant has an unwithdrawn `decision_model` entry and has not
 * reached its resolution. `single`: a `complete` ledger entry for D, a non-transient locked failure record (the DA-15 rule), or an
 * Exclusion_Record. `perm_avg`: a Locked derived file, or a resolved failure or Exclusion_Record of its source.
 */
export function decisionHold(state: PhaseState): boolean {
  return decisionHoldPending(state).length > 0;
}

/** The Decision_Variants that keep the hold on (R19.17, R20.10), by Combination ID, in `combinations.json` order. */
export function decisionHoldPending(state: PhaseState): string[] {
  if (!state.approvals.approved) return [];
  const approvals = state.approvals.approvals;
  return state.combinations
    .filter((c) => {
      if (!isDecisionVariant(c)) return false;
      if (decisionModelApprovals(approvals, c.id, undefined, variantOf(c)).length === 0) return false;
      if (!isPermAvg(c)) return !completeCoverage(c, state).has('decision') && !hasFailure(c, state) && !hasExclusion(c, state);
      const source = state.combinations.find((x) => x.id === c.derives_from);
      const sourceResolved = source !== undefined && (hasFailure(source, state) || hasExclusion(source, state));
      const lockedDerived = (state.derived ?? []).some((d) => d.combination === c.id && d.split === 'locked');
      return !lockedDerived && !sourceResolved;
    })
    .map((c) => c.id);
}

/**
 * The distinct Workers AI Combinations tried in Phase_2 (R19.13, R20.13): at least one ledger entry, or one Dev_Run Results file
 * in which something was actually attempted, or a derived Results file (a Derived_Run is the variant's Results file). A
 * Combination that only had Smoke_Calls, or whose Dev_Run the gate refused (all records `not_run` / `not_approved`), is not
 * counted. Sorted by Combination ID.
 */
export function phase2Candidates(state: PhaseState): string[] {
  const workers = new Set(state.combinations.filter(isWorkersAi).map((c) => c.id));
  const tried = new Set<string>();
  for (const e of state.entries) if (workers.has(e.start.combination)) tried.add(e.start.combination);
  for (const d of state.devRuns ?? []) if (workers.has(d.combination) && d.attempted !== false) tried.add(d.combination);
  for (const d of state.derived ?? []) if (workers.has(d.combination)) tried.add(d.combination);
  return [...tried].sort();
}

/** The number printed in section 2 of the Report. */
export const phase2CandidatesTried = (state: PhaseState): number => phase2Candidates(state).length;

/** Result of the registry check of R20.1 for one model. */
export type RegistryCheck =
  | { readonly status: 'free'; readonly detail: string }
  | { readonly status: 'equal'; readonly detail: string }
  | { readonly status: 'changed'; readonly detail: string };

/** Message of a refusal by the registry check (R20.1). */
export const REGISTRY_CHANGED_MESSAGE = 'registry changed after the first Dev_Run result (R20.1); needs a recorded Author amendment';

const sameRegistry = (a: readonly VariantRegistryEntry[], b: readonly VariantRegistryEntry[]): boolean =>
  a.length === b.length && a.every((x, i) => x.id === (b[i] as VariantRegistryEntry).id && x.variant === (b[i] as VariantRegistryEntry).variant && x.aggregation_hash === (b[i] as VariantRegistryEntry).aggregation_hash);

/**
 * R20.1: from the first recorded Decision_Model Dev_Run result of a model on, the current registry of that model must equal the
 * registry in the earliest Dev_Run header of the model. `free` before any such result exists.
 */
export function registryCheck(modelId: string, state: PhaseState): RegistryCheck {
  const ids = new Set(state.combinations.filter((c) => isDecisionModel(c) && c.model_id === modelId).map((c) => c.id));
  const first = (state.devRuns ?? []).find((d) => ids.has(d.combination) && d.attempted !== false && d.variant !== 'perm_avg');
  if (first === undefined) return { status: 'free', detail: 'no Decision_Model Dev_Run result yet; the registry may still be amended' };
  const current = state.registry?.get(modelId);
  if (first.variants === undefined || current === undefined) return { status: 'changed', detail: `the Dev_Run header ${first.run_id} records no registry, or the current registry was not read` };
  return sameRegistry(first.variants, current)
    ? { status: 'equal', detail: `equal to the registry in the Dev_Run header ${first.run_id}` }
    : { status: 'changed', detail: `differs from the registry in the Dev_Run header ${first.run_id}` };
}

export interface VariantGateOptions {
  /** The `--approval` ID the caller named; when given, an unwithdrawn entry with that ID must be among the matching ones. */
  readonly approvalId?: string | null;
}

/**
 * The gate for a Decision_Variant step (R20.1, R20.10, R20.11; DA-27). A `perm_avg` Combination never goes through
 * `allowDecisionModel`, and an entry of the `single` variant never covers a derive step (the reverse holds too).
 * Order: (1) `dev` / `locked` of a `perm_avg` Combination are refused (option (a) of DA-24); (2) the Combination is a `perm_avg`
 * record; (3) subset D; (4) Phase_1 ended; (5) an unwithdrawn `decision_model` entry with `variant: "perm_avg"`, this
 * Combination and this step; (6) the source named by `derives_from` is complete for the split; (7) for `derive_locked`, a Dev
 * Derived_Run with equal mapping and aggregation Template_Hashes; (8) the registry equals that of the earliest Dev_Run header.
 */
export function allowDecisionVariant(step: DecisionStepKind | 'derive_dev' | 'derive_locked', combo: Combination, state: PhaseState, task_subset: TaskSubset = 'D', options: VariantGateOptions = {}): DecisionGate {
  const refuse = (reason: string): DecisionGate => ({ outcome: 'refused', reason });
  if (step === 'smoke' || step === 'dev' || step === 'locked') {
    return refuse(`variant: ${step} of ${combo.id} is refused; a perm_avg Combination only derives, it sends no request (DA-24 option (a))`);
  }
  if (!isDecisionVariant(combo) || !isPermAvg(combo)) return refuse(`${combo.id} is not a perm_avg Decision_Variant`);
  if (task_subset !== 'D') return { outcome: 'wrong_subset', reason: `task_subset: ${combo.id} accepts Task_Type D only; requested ${task_subset}` };
  if (!phase1Ended(state)) return refuse(`Phase_1 has not ended; waiting for: ${phase1Pending(state).map((c) => c.id).join(', ')}`);
  if (!state.approvals.approved) return refuse(`approvals.json is not usable: ${state.approvals.reason}`);
  const entries = decisionModelApprovals(state.approvals.approvals, combo.id, step, 'perm_avg');
  if (entries.length === 0) return refuse(`no unwithdrawn decision_model ${step} approval with variant perm_avg for ${combo.id}`);
  if (options.approvalId !== undefined && options.approvalId !== null && !entries.some((a) => a.id === options.approvalId)) {
    return refuse(`--approval ${options.approvalId} is not an unwithdrawn ${step} approval for ${combo.id}`);
  }
  const single = state.combinations.find((c) => c.id === combo.derives_from);
  if (single === undefined || !isDecisionModel(single)) return refuse(`${combo.id} derives from ${String(combo.derives_from)}, which is not a single Decision_Model record`);
  const sources = state.variantSources;
  const complete = step === 'derive_dev' ? sources?.devComplete : sources?.lockedComplete;
  if (complete === undefined || !complete.has(single.id)) return refuse(`the source ${single.id} has no complete ${step === 'derive_dev' ? 'Dev_Run' : 'Locked_Run'} Results file (R20.11, RC-24)`);
  if (step === 'derive_locked') {
    const mapping = sources?.mappingHash.get(single.id);
    const aggregation = combo.aggregation?.sha256;
    const dev = (state.derived ?? []).find((d) => d.combination === combo.id && d.split === 'dev' && mapping !== undefined && d.template_hashes['decision'] === mapping && d.template_hashes['aggregation'] === aggregation);
    if (dev === undefined) return refuse(`derive_locked needs the Derived_Run of the Dev split of ${combo.id} with equal Template_Hashes (R3.12, R20.11)`);
  }
  const registry = registryCheck(combo.model_id, state);
  if (registry.status !== 'equal') return refuse(registry.status === 'free' ? `${REGISTRY_CHANGED_MESSAGE}: no Dev_Run header of the model records the registry` : `${REGISTRY_CHANGED_MESSAGE}: ${registry.detail}`);
  const fit = entries.find((a) => options.approvalId === undefined || options.approvalId === null || a.id === options.approvalId) as Approval;
  return { outcome: 'allowed', reason: `${step} approval ${fit.id} for ${combo.id}, 0 requests`, approval: fit.id };
}

/** The `decision_models:` block and the hold line of `phase-status`: one line per Decision_Variant (DA-22, DA-27), then the registry check per model. */
export function formatDecisionModels(state: PhaseState): string[] {
  const out: string[] = ['decision_models:'];
  const variants = state.combinations.filter(isDecisionVariant);
  if (variants.length === 0) out.push('  none');
  const approvals = state.approvals.approved ? state.approvals.approvals : [];
  const gone = withdrawnIds(approvals);
  for (const c of variants) {
    const perm = isPermAvg(c);
    const mine = approvals.filter((a) => a.kind === 'decision_model' && a.combination === c.id);
    const text = (step: DecisionStep): string => {
      const list = mine.filter((a) => a.step === step).map((a) => `${a.id} (max ${String(a.max_requests)})${gone.has(a.id) ? ' withdrawn' : ''}`);
      return `${step}: ${list.length === 0 ? 'none' : list.join(', ')}`;
    };
    const approvalText = perm ? `${text('derive_dev')}; ${text('derive_locked')}` : `${text('dev')}; ${text('locked')}`;
    if (perm) {
      const files = (state.derived ?? []).filter((d) => d.combination === c.id);
      const split = (sp: 'dev' | 'locked'): string => (files.some((d) => d.split === sp) ? 'yes' : 'no');
      const source = state.combinations.find((x) => x.id === c.derives_from);
      const end = source !== undefined && hasExclusion(source, state) ? 'source Exclusion_Record' : source !== undefined && hasFailure(source, state) ? 'source failure record' : null;
      out.push(`  ${c.id}  variant perm_avg  approvals ${approvalText}  derived: dev ${split('dev')}, locked ${split('locked')}${end === null ? '' : `  ended by: ${end}`}`);
      continue;
    }
    const ledger = [...state.entries].filter((e) => e.start.combination === c.id).sort((a, b) => a.order - b.order);
    const last = ledger[ledger.length - 1];
    const end = hasExclusion(c, state) ? 'Exclusion_Record' : hasFailure(c, state) ? 'failure record' : null;
    out.push(`  ${c.id}  approvals ${approvalText}  ledger: ${last === undefined ? 'none' : `${last.entry_id} ${last.status}`}${end === null ? '' : `  ended by: ${end}`}`);
  }
  for (const modelId of [...new Set(variants.map((c) => c.model_id))].sort()) {
    const r = registryCheck(modelId, state);
    out.push(`  registry check ${modelId}: ${r.status} (${r.detail})`);
  }
  out.push(decisionHold(state) ? 'runtime decision: ON HOLD (R19.17)' : 'runtime decision: not on hold');
  return out;
}

/** One entry of the variant registry written into a Decision_Model run header (R20.1, DA-27). */
export interface VariantRegistryEntry {
  readonly id: string;
  readonly variant: DecisionVariant;
  /** `perm_avg`: sha256 of the Aggregation_Rule file named by the record, as read now; `single`: null. */
  readonly aggregation_hash: string | null;
}

/**
 * The registry of the Decision_Variants of one model (the records of `combinations.json` with this `model_id`, Workers AI,
 * `system_one`), in file order. The Dev_Run header of every Decision_Model run records it (R20.1); a later difference
 * is what the variant gate's registry check (task 42) refuses.
 */
export function variantRegistry(combos: readonly Combination[], modelId: string, readAggregation: AggregationReader = readAggregationFromRepo): VariantRegistryEntry[] {
  return combos
    .filter((c) => isWorkersAi(c) && c.response_shape === 'system_one' && c.model_id === modelId)
    .map((c) => ({
      id: c.id,
      variant: variantOf(c),
      aggregation_hash: isPermAvg(c) && c.aggregation !== undefined ? (readAggregation(c.aggregation.file)?.sha256 ?? null) : null,
    }));
}

/** Text the "LLM runtime" row of tech.md starts with while the decision is pending. */
export const TECH_PENDING_TEXT = 'Pending';

/** Warning (not a gate) when the hold is on and the tech.md "LLM runtime" row no longer starts with its pending text. */
export function techRuntimeWarning(state: PhaseState, techText: string | null): string | null {
  if (!decisionHold(state)) return null;
  if (techText === null) return 'runtime decision is on hold but .kiro/steering/tech.md could not be read';
  const row = techText.split('\n').find((l) => /^\|\s*LLM runtime\s*\|/.test(l));
  const cell = row?.split('|')[2]?.trim();
  if (cell !== undefined && cell.startsWith(TECH_PENDING_TEXT)) return null;
  return 'runtime decision is on hold (R19.17) but the tech.md "LLM runtime" row no longer starts with "Pending"';
}
