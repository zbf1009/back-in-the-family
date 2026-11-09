// Phase gate (R18, R11.8, R11.19, R9.17): `allowWorkersAi` and `browserPass`, plus the pure
// derivations behind `phase-status` and `ledger`. Everything here is a function of injected data
// (ledger entries, failure and Exclusion_Records, Smoke_Call records, `combinations.json`,
// approvals read from `HEAD`, and the per-entry pass results), so tests use fixtures and the
// Report calls the very same `browserPass`. No I/O and no card content in this file.
import { chooseReportEntries, modelKeysEqual, subsetTaskTypes, type LedgerEntry } from './ledger.ts';
import type { Approval, ApprovalsResult } from './approvals.ts';
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
  readonly [extra: string]: unknown;
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
/** True for a Decision_Model; `parseCombinations` has checked the extra members of such a record. */
export const isSystemOne = (c: Combination): c is SystemOneCombination => c.response_shape === 'system_one';
export const comboModelKey = (c: Combination): ModelKey => ({ runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision });

/** True when a measured model download is over the In_Browser_Size_Limits (R9.11). */
export const overDownloadLimit = (measuredBytes: number): boolean => measuredBytes > IN_BROWSER_DOWNLOAD_LIMIT_BYTES;

/** Parses `combinations.json` text: a JSON array of objects with the fields the gate needs. */
export function parseCombinations(text: string): Combination[] {
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
    if (shape === 'system_one') checkSystemOne(o, i);
    const id = o['id'] as string;
    if (seen.has(id)) throw new Error(`combinations[${i}].id "${id}" is a duplicate`);
    seen.add(id);
  });
  return list as Combination[];
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
}

/** What the Decision_Model gate needs from a Dev_Run Results header. */
export interface DevRunInfo {
  readonly run_id: string;
  readonly combination: string;
  readonly task_subset: string;
  readonly template_hashes: Readonly<Record<string, string>>;
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
export const isDecisionModel = (c: Combination): boolean => isWorkersAi(c) && c.response_shape === 'system_one';

/** IDs withdrawn by some `withdrawal` entry (DA-21). A withdrawal of a withdrawal does nothing: only `decision_model` entries are looked up. */
export function withdrawnIds(approvals: readonly Approval[]): Set<string> {
  const out = new Set<string>();
  for (const a of approvals) if (a.kind === 'withdrawal') for (const id of a.withdraws ?? []) out.add(id);
  return out;
}

/** Unwithdrawn `decision_model` entries, optionally for one Combination and one step. */
export function decisionModelApprovals(approvals: readonly Approval[], combinationId?: string, step?: 'dev' | 'locked'): Approval[] {
  const gone = withdrawnIds(approvals);
  return approvals.filter((a) => a.kind === 'decision_model' && !gone.has(a.id) && (combinationId === undefined || a.combination === combinationId) && (step === undefined || a.step === step));
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
 * R19.17: true exactly when some Decision_Model has an unwithdrawn `decision_model` entry and none of: a `complete`
 * ledger entry for D, a non-transient locked failure record (the DA-15 rule), an Exclusion_Record.
 */
export function decisionHold(state: PhaseState): boolean {
  if (!state.approvals.approved) return false;
  const approvals = state.approvals.approvals;
  return state.combinations.some(
    (c) => isDecisionModel(c) && decisionModelApprovals(approvals, c.id).length > 0 && !completeCoverage(c, state).has('decision') && !hasFailure(c, state) && !hasExclusion(c, state),
  );
}

/** The `decision_models:` block and the hold line of `phase-status` (DA-22). */
export function formatDecisionModels(state: PhaseState): string[] {
  const out: string[] = ['decision_models:'];
  const models = state.combinations.filter(isDecisionModel);
  if (models.length === 0) out.push('  none');
  const approvals = state.approvals.approved ? state.approvals.approvals : [];
  const gone = withdrawnIds(approvals);
  for (const c of models) {
    const mine = approvals.filter((a) => a.kind === 'decision_model' && a.combination === c.id);
    const text = (step: 'dev' | 'locked'): string => {
      const list = mine.filter((a) => a.step === step).map((a) => `${a.id} (max ${String(a.max_requests)})${gone.has(a.id) ? ' withdrawn' : ''}`);
      return `${step}: ${list.length === 0 ? 'none' : list.join(', ')}`;
    };
    const ledger = [...state.entries].filter((e) => e.start.combination === c.id).sort((a, b) => a.order - b.order);
    const last = ledger[ledger.length - 1];
    const end = hasExclusion(c, state) ? 'Exclusion_Record' : hasFailure(c, state) ? 'failure record' : null;
    out.push(`  ${c.id}  approvals ${text('dev')}; ${text('locked')}  ledger: ${last === undefined ? 'none' : `${last.entry_id} ${last.status}`}${end === null ? '' : `  ended by: ${end}`}`);
  }
  out.push(decisionHold(state) ? 'runtime decision: ON HOLD (R19.17)' : 'runtime decision: not on hold');
  return out;
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
