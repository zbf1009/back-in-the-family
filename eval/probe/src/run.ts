// Dev_Run and Locked_Run flows (llm-probe task 13.2; design "Locked run flow", R3, R8, R11, R18).
//
// Everything outside the Runtime is injected through `RunDeps`: paths (cards, results, ledger,
// budget), the pinned Manifest hash, the Combination list, the Runtime factory, the Fresh_Profile
// hook, the Workers AI phase state and the clock. Tests point all of them at temporary files and a
// fake Runtime; the real adapters arrive in tasks 16 and 17.
//
// Design rule: all grading goes through Sim_Wasm (run-grading.ts); this file holds no validation or
// scoring logic. All output goes through RunLogger, which has no method for prompt or output text.
import * as fs from 'node:fs';
import path from 'node:path';
import type { AdapterResult, LateAnswer, Prompt, RuntimeAdapter, SamplingParams, OutputConstraint } from './adapters/interface.ts';
import { rebuildEngineWithWarmUp, type LifecycleEngine, type WarmUpPrompts } from './adapters/lifecycle.ts';
import { findApproval } from './approvals.ts';
import { BudgetError, BudgetSession, estimateNeurons, isRefusal, type Reservation } from './budget.ts';
import { CardLoadError, loadCards, type LoadedCard, type LoadedCards, type TaskType } from './cards.ts';
import {
  appendAbort,
  appendComplete,
  appendResume,
  appendStart,
  canComplete,
  decideOverlap,
  LedgerError,
  makeEntryId,
  missingRuns,
  readLedger,
  subsetTaskTypes,
  type LedgerEntry,
  type PlannedRun,
  type ResumeIdentity,
} from './ledger.ts';
import { checkManifest, formatManifestResult } from './manifest.ts';
import {
  allowWorkersAi,
  comboModelKey,
  isWorkersAi,
  type Combination,
  type PhaseState,
} from './phase.ts';
import {
  appendFailure,
  canonicalJson,
  fingerprintId,
  gradesPathFor,
  readGradesFile,
  readResultsFile,
  ResultsFormatError,
  ResultsWriter,
  resultsPath,
  SCHEMA,
  writeGradesFile,
  writePerf,
  type FailureRecord,
  type JsonObject,
  type JsonValue,
  type Late,
  type ModelKey,
  type NotRunReason,
  type Outcome,
  type PerfRecord,
  type Placement,
  type ResultRecord,
  type ResultsHeader,
  type Source,
  type TaskSubset,
  type Usage as ResultUsage,
} from './results.ts';
import { GradingError, cardFacts, gradeRecords, hasOutput, type CardFacts } from './run-grading.ts';
import { RunLogger, renderReasonCategory, type FailureCode, type FailureArgs, type TaskProgress } from './run-logger.ts';
import { llmPermutations, llmRenderPrompt, wasmSha256 } from './simwasm.ts';
import { TEMPLATES_DIR, WARMUP_DIR, loadTemplate, loadWarmup, loadWarmupPrompt, type TextWithHash } from './templates.ts';

// ---------------------------------------------------------------- public types

export const DEFAULT_TIMEOUT_MS = 10_000;
export type RunKind = 'dev' | 'locked';

/** Everything on disk a run reads or writes. Tests give temporary directories. */
export interface RunPaths {
  /** Root that `results` paths in `complete` ledger events are relative to. */
  readonly repoDir: string;
  /** Holds MANIFEST.sha256, LOCK.md, cards/ and schemas/. */
  readonly cardsDir: string;
  /** `eval/results`: `dev/`, `locked/` live under it. */
  readonly resultsDir: string;
  readonly ledger: string;
  readonly failures: string;
  readonly exclusions: string;
  readonly budgetFile: string;
  readonly templatesDir?: string;
  readonly warmupDir?: string;
}

export type FreshProfileResult = { readonly ok: true } | { readonly ok: false; readonly failure: JsonObject };

export interface RuntimeContext {
  readonly combo: Combination;
  readonly kind: RunKind;
  readonly resume: boolean;
  readonly timeoutMs: number;
  readonly samplings: Readonly<Record<TaskType, SamplingParams>>;
  readonly warmups: WarmUpPrompts;
}

/** A Runtime that cannot be loaded: becomes a failure record (R9.4) and `not_run` for the rest. */
export class RuntimeLoadError extends Error {
  readonly code: 'model_load_failed' | 'out_of_memory' | 'gpu_unavailable' | 'software_adapter' | 'backend_not_webgpu' | 'placement_not_logged';
  constructor(code: RuntimeLoadError['code'], detail: string) {
    super(detail);
    this.name = 'RuntimeLoadError';
    this.code = code;
  }
}

export interface RuntimeHandle {
  readonly adapter: RuntimeAdapter;
  /** Where results come from; default `node`. */
  readonly source?: Source;
  /** Merged over the fingerprint defaults (`browser`, `webgpu`, `measurement`). */
  readonly fingerprint?: JsonObject;
  readonly placement?: Placement | null;
  /**
   * Step 8: load the engine and run the cold-start measurements and Warm_Up_Prompts. Sends no Card.
   * Throws RuntimeLoadError on failure. May return the cold-start `perf` record.
   */
  load(opts: { readonly coldStart: boolean }): Promise<{ readonly perf?: PerfRecord } | void>;
  /** What a rebuild needs after an Idle_Cap hit (R8.13). Without it a stuck engine cannot be rebuilt. */
  readonly lifecycle?: { readonly engine: LifecycleEngine; readonly onReady?: () => void };
  /**
   * Called after the last Card request when `load` returned a perf record: returns the final record (for
   * example with the memory peak taken up to the last Card, R14.7), which replaces the one written at load.
   */
  finish?(): Promise<{ readonly perf?: PerfRecord } | void>;
  close?(): Promise<void> | void;
}

/** Creates a Runtime handle. It must not send a request or load a model (that is `handle.load`). */
export type RuntimeFactory = (ctx: RuntimeContext) => Promise<RuntimeHandle>;

/** Step 6 hook (task 16): Fresh_Profile, WebGPU adapter and quota checks. Sends no Runtime request. */
export type FreshProfileHook = (ctx: RuntimeContext, handle: RuntimeHandle) => Promise<FreshProfileResult>;

export interface RunDeps {
  readonly paths: RunPaths;
  readonly pinnedManifestHash: string;
  readonly combinations: readonly Combination[];
  readonly createRuntime: RuntimeFactory;
  readonly freshProfile?: FreshProfileHook;
  /** Needed for Workers AI Combinations only. */
  readonly phaseState?: () => Promise<PhaseState>;
  /** Milliseconds since the epoch; default `Date.now`. */
  readonly now?: () => number;
  readonly logger?: RunLogger;
}

/** One rendered request of a Probe_Page bundle (design: Probe_Page bundle and export). */
export interface PageBundleRequest {
  readonly card_id: string;
  readonly permutation: string;
  readonly task: TaskType;
  readonly prompt: Prompt;
  readonly constraint: OutputConstraint;
}

/** What `page-bundle` writes (task 13.7). Built by the run flow after pre-render; no Runtime is created. */
export interface PageBundleData {
  readonly runId: string;
  readonly split: RunKind;
  readonly taskSubset: TaskSubset;
  readonly combination: Combination;
  readonly templateHashes: { readonly [name: string]: string };
  readonly pinnedManifestHash: string;
  readonly timeoutMs: number;
  readonly requests: readonly PageBundleRequest[];
}

/** Receives the rendered prompts instead of a Runtime. Throws when the bundle cannot be written. */
export type PageBundleHook = (data: PageBundleData) => void;

export interface DevRunOptions {
  readonly combo: string;
  readonly task?: TaskSubset;
  readonly timeoutMs?: number | string;
  readonly approval?: string | null;
  /** `page-bundle --split dev`: render and hand the prompts to the hook; send nothing. */
  readonly pageBundle?: PageBundleHook;
}

export interface LockedRunOptions {
  readonly combo?: string;
  readonly task?: TaskSubset;
  readonly timeoutMs?: number | string;
  readonly approval?: string | null;
  readonly rerunReason?: string | null;
  readonly resume?: string;
  /** `page-bundle --split locked`: follow the flow up to the ledger `start` entry, then hand the prompts to the hook. */
  readonly pageBundle?: PageBundleHook;
}

/** Thrown inside the flow for a failure that ends the run with one logger line. */
export class RunError extends Error {
  readonly code: FailureCode;
  readonly args: FailureArgs;
  constructor(code: FailureCode, args: FailureArgs = {}) {
    super(code);
    this.name = 'RunError';
    this.code = code;
    this.args = args;
  }
}

// ---------------------------------------------------------------- Timeout (R8.4)

/** A positive safe integer, as a number or as digits; default 10,000 ms. Throws RunError('invalid_timeout'). */
export function parseTimeoutMs(raw: number | string | null | undefined): number {
  if (raw === undefined || raw === null) return DEFAULT_TIMEOUT_MS;
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (/^[0-9]+$/.test(raw)) n = Number(raw);
  else throw new RunError('invalid_timeout', { value: raw });
  if (!Number.isSafeInteger(n) || n < 1) throw new RunError('invalid_timeout', { value: typeof raw === 'number' ? String(raw) : raw });
  return n;
}

// ---------------------------------------------------------------- sampling and fingerprint

/** The one card-independent decision schema (design: WebLLM constraint B6). */
export const DECISION_SCHEMA: JsonObject = {
  type: 'object',
  properties: { option: { type: 'string' } },
  required: ['option'],
  additionalProperties: false,
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Sampling parameters of a Combination for one Task_Type and output constraint. */
export function samplingFor(combo: Combination, task: TaskType, constraint: OutputConstraint): SamplingParams {
  const bad = (what: string): never => {
    throw new Error(`combinations.json: ${combo.id}: ${what}`);
  };
  const s = asRecord(combo['sampling']) ?? bad('sampling must be an object');
  const temperature = typeof s['temperature'] === 'number' ? s['temperature'] : s['do_sample'] === false ? 0 : bad('sampling needs temperature or do_sample false');
  const topP = s['top_p'] === null || s['top_p'] === undefined ? null : typeof s['top_p'] === 'number' ? s['top_p'] : bad('sampling.top_p');
  const seed = s['seed'] === null || s['seed'] === undefined ? null : typeof s['seed'] === 'number' ? s['seed'] : bad('sampling.seed');
  const max = asRecord(s['max_output_tokens'])?.[task];
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1) bad(`sampling.max_output_tokens.${task} must be a positive integer`);
  const kwargs = combo['chat_template_kwargs'];
  const chatTemplateKwargs = kwargs === null || kwargs === undefined ? null : (asRecord(kwargs) as Record<string, boolean | string | number>) ?? bad('chat_template_kwargs');
  return { temperature, topP, maxOutputTokens: max as number, seed, chatTemplateKwargs, constraint };
}

/** `json_schema` only when the Combination asks for it; `prompt_only` and `none` send no constraint. */
function wantsSchema(combo: Combination): boolean {
  return combo['constraint'] === 'json_schema';
}

const TEMPLATE_KEY: Readonly<Record<TaskType, string>> = { decision: 'decision', synthesis: 'synthesis' };

export interface Templates {
  readonly texts: Record<TaskType, TextWithHash>;
  readonly hashes: Record<TaskType, string>;
  readonly warmupHashes: Record<TaskType, string>;
  readonly warmups: WarmUpPrompts;
}

export function loadTemplates(paths: RunPaths): Templates {
  const tdir = paths.templatesDir ?? TEMPLATES_DIR;
  const wdir = paths.warmupDir ?? WARMUP_DIR;
  const texts = { decision: loadTemplate('decision', tdir), synthesis: loadTemplate('synthesis', tdir) };
  return {
    texts,
    hashes: { decision: texts.decision.sha256, synthesis: texts.synthesis.sha256 },
    warmupHashes: { decision: loadWarmup('decision', wdir).sha256, synthesis: loadWarmup('synthesis', wdir).sha256 },
    warmups: { decision: loadWarmupPrompt('decision', wdir), synthesis: loadWarmupPrompt('synthesis', wdir) },
  };
}

function subsetHashes(all: Record<TaskType, string>, tasks: readonly TaskType[]): { [name: string]: string } {
  const out: { [name: string]: string } = {};
  for (const t of tasks) out[TEMPLATE_KEY[t]] = all[t];
  return out;
}

function buildFingerprint(
  deps: RunDeps,
  combo: Combination,
  handle: RuntimeHandle,
  templates: Templates,
  tasks: readonly TaskType[],
  rendererVersion: number | null,
): JsonObject {
  const id = handle.adapter.identity();
  const s = asRecord(combo['sampling']) ?? {};
  return {
    runtime: { name: id.runtime, version: id.runtimeVersion },
    model: {
      id: id.modelId,
      revision: id.modelRevision,
      model_lib_url: typeof combo['model_lib_url'] === 'string' ? combo['model_lib_url'] : null,
      quantization: id.quantization,
    },
    model_key: { ...comboModelKey(combo) },
    sampling: JSON.parse(JSON.stringify(s)) as JsonValue,
    chat_template_kwargs: (combo['chat_template_kwargs'] ?? null) as JsonValue,
    constraint: typeof combo['constraint'] === 'string' ? combo['constraint'] : 'none',
    template_hashes: subsetHashes(templates.hashes, tasks),
    warmup_hashes: subsetHashes(templates.warmupHashes, tasks),
    renderer_version: rendererVersion,
    sim_wasm_sha256: wasmSha256,
    pinned_manifest_hash: deps.pinnedManifestHash,
    browser: null,
    webgpu: null,
    measurement: 'node',
    ...(handle.fingerprint ?? {}),
  };
}

// ---------------------------------------------------------------- plan and pre-render

export interface PlanItem {
  readonly card: LoadedCard;
  readonly facts: CardFacts;
  readonly task: TaskType;
  readonly permutation: string;
  prompt: Prompt | null;
  renderError: string | null;
  sampling: SamplingParams | null;
}

const keyOf = (cardId: string, permutation: string): string => `${cardId}\u0000${permutation}`;

function tasksOf(subset: TaskSubset): TaskType[] {
  return subsetTaskTypes(subset);
}

/** Every Card x Permutation of the subset: Scored_Cards in every kept permutation, Sanity_Cards in base only. */
export function buildPlan(cards: readonly LoadedCard[], tasks: readonly TaskType[]): PlanItem[] {
  const items: PlanItem[] = [];
  for (const task of tasks) {
    for (const card of cards.filter((c) => c.task === task)) {
      const facts = cardFacts(card);
      let perms: string[] = ['base'];
      if (card.scored) {
        const env = JSON.parse(llmPermutations(JSON.stringify({ frozen_context: facts.frozenContext }), card.id)) as { ok: boolean; permutations?: string[] };
        if (env.ok !== true || !Array.isArray(env.permutations) || env.permutations[0] !== 'base') {
          throw new GradingError(card.id, 'llm_permutations returned no usable list');
        }
        perms = env.permutations;
      }
      for (const permutation of perms) items.push({ card, facts, task, permutation, prompt: null, renderError: null, sampling: null });
    }
  }
  return items;
}

const plannedRunsOf = (plan: readonly PlanItem[]): PlannedRun[] => plan.map((p) => ({ card_id: p.card.id, permutation: p.permutation, task: p.task }));

function plannedCounts(plan: readonly PlanItem[], tasks: readonly TaskType[]): { decision?: number; synthesis?: number } {
  const out: { decision?: number; synthesis?: number } = {};
  for (const t of tasks) out[t] = plan.filter((p) => p.task === t).length;
  return out;
}

function schemaFile(cardsDir: string, name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new RunError('card_load', { value: 'bad schema name' });
  return path.join(cardsDir, 'schemas', `${name}.json`);
}

export interface SchemaInfo {
  readonly text: string;
  readonly json: JsonValue;
}

export function loadSchemas(cardsDir: string, plan: readonly PlanItem[]): Map<string, SchemaInfo> {
  const out = new Map<string, SchemaInfo>();
  for (const item of plan) {
    const name = item.facts.outputSchema;
    if (name === null || out.has(name)) continue;
    let text: string;
    try {
      text = fs.readFileSync(schemaFile(cardsDir, name), 'utf8');
    } catch (e) {
      if (e instanceof RunError) throw e;
      throw new RunError('card_load', { value: `schema ${name} unreadable` });
    }
    out.set(name, { text, json: JSON.parse(text) as JsonValue });
  }
  return out;
}

export interface RenderOutcome {
  readonly rendererVersion: number | null;
  /** Items whose render returned an error, with the Rust message (kept internal; only a category is printed). */
  readonly errors: PlanItem[];
}

/** Renders every item once; sets `prompt` or `renderError`. */
export function renderPlan(plan: readonly PlanItem[], templates: Templates, schemas: ReadonlyMap<string, SchemaInfo>, combo: Combination): RenderOutcome {
  let rendererVersion: number | null = null;
  const errors: PlanItem[] = [];
  const constraintD: OutputConstraint = wantsSchema(combo) ? { kind: 'json_schema', schema: DECISION_SCHEMA } : { kind: 'none' };
  for (const item of plan) {
    const schema = item.facts.outputSchema === null ? null : (schemas.get(item.facts.outputSchema) as SchemaInfo);
    const input = JSON.stringify({
      frozen_context: item.facts.frozenContext,
      template: templates.texts[item.task].text,
      schema_text: schema === null ? null : schema.text,
      permutation: item.permutation,
    });
    const env = JSON.parse(llmRenderPrompt(input, item.card.id)) as { ok: boolean; system?: string; user?: string; renderer_version?: number; error?: { message?: string } };
    if (env.ok === true && typeof env.system === 'string' && typeof env.user === 'string') {
      item.prompt = { system: env.system, user: env.user };
      if (typeof env.renderer_version === 'number') rendererVersion = env.renderer_version;
    } else {
      item.renderError = env.error?.message ?? 'render error';
      errors.push(item);
    }
    const constraint: OutputConstraint = item.task === 'decision' ? constraintD : wantsSchema(combo) && schema !== null ? { kind: 'json_schema', schema: schema.json } : { kind: 'none' };
    item.sampling = samplingFor(combo, item.task, constraint);
  }
  return { rendererVersion, errors };
}

function warmupSamplings(combo: Combination): Record<TaskType, SamplingParams> {
  return {
    decision: samplingFor(combo, 'decision', wantsSchema(combo) ? { kind: 'json_schema', schema: DECISION_SCHEMA } : { kind: 'none' }),
    synthesis: samplingFor(combo, 'synthesis', { kind: 'none' }),
  };
}

function bundleDataOf(
  deps: RunDeps,
  a: { runId: string; split: RunKind; subset: TaskSubset; combo: Combination; plan: readonly PlanItem[]; templates: Templates; tasks: readonly TaskType[]; timeoutMs: number },
): PageBundleData {
  return {
    runId: a.runId,
    split: a.split,
    taskSubset: a.subset,
    combination: a.combo,
    templateHashes: subsetHashes(a.templates.hashes, a.tasks),
    pinnedManifestHash: deps.pinnedManifestHash,
    timeoutMs: a.timeoutMs,
    requests: a.plan.map((p) => ({
      card_id: p.card.id,
      permutation: p.permutation,
      task: p.task,
      prompt: p.prompt as Prompt,
      constraint: (p.sampling as SamplingParams).constraint,
    })),
  };
}

/** A bundle is for the headed browser page: it never serves a Workers AI Combination. */
function requireInBrowser(combo: Combination, hook: PageBundleHook | undefined): void {
  if (hook !== undefined && isWorkersAi(combo)) throw new RunError('invalid_arguments', { combination: combo.id, value: 'page-bundle is for in-browser Combinations' });
}

// ---------------------------------------------------------------- shared preparation

interface Prepared {
  readonly combo: Combination;
  readonly subset: TaskSubset;
  readonly tasks: TaskType[];
  readonly timeoutMs: number;
}

/** Manifest_Check at the start of every run that reads cards (R1.1); throws RunError('card_load') on failure. */
export async function runManifestCheck(deps: Pick<RunDeps, 'paths' | 'pinnedManifestHash'>, logger: RunLogger): Promise<void> {
  const result = await checkManifest({ cardsDir: deps.paths.cardsDir, pinnedHash: deps.pinnedManifestHash });
  logger.manifest(formatManifestResult(result, deps.pinnedManifestHash), result.ok);
  if (!result.ok) throw new RunError('card_load', { value: 'manifest' });
}

function findCombo(deps: RunDeps, id: string): Combination {
  const combo = deps.combinations.find((c) => c.id === id);
  if (combo === undefined) throw new RunError('unknown_combination', { combination: id });
  return combo;
}

function loadSplits(deps: RunDeps, kind: RunKind): LoadedCards {
  return loadCards({ cardsDir: deps.paths.cardsDir, splits: kind === 'dev' ? ['dev'] : ['dev', 'locked'] });
}

interface GateOk {
  readonly approval: string | null;
}

/** Phase gate and approval for Workers AI (R18, R11.8, R11.20). Returns null reason when allowed. */
async function gateRun(
  deps: RunDeps,
  kind: RunKind,
  combo: Combination,
  subset: TaskSubset,
  approvalId: string | null,
  requestCount: number,
): Promise<{ readonly ok: true; readonly value: GateOk } | { readonly ok: false; readonly reason: string }> {
  if (!isWorkersAi(combo)) return { ok: true, value: { approval: null } };
  if (deps.phaseState === undefined) return { ok: false, reason: 'phase state is not available' };
  const state = await deps.phaseState();
  const decision = allowWorkersAi(kind, combo, subset, state);
  if (decision.allowed !== 'full') return { ok: false, reason: decision.reason };
  if (approvalId === null) return { ok: false, reason: `--approval is required for a Workers AI ${kind} run` };
  const list = state.approvals.approved ? state.approvals.approvals : [];
  const found = findApproval(list, { id: approvalId, kind, combination: combo.id, task_subset: subset, requestCount });
  if (found === undefined) {
    return { ok: false, reason: `approval ${approvalId} does not match a ${kind} approval for ${combo.id} with subset ${subset} and ${requestCount} requests` };
  }
  return { ok: true, value: { approval: approvalId } };
}

// ---------------------------------------------------------------- records

interface RecordBase {
  readonly runId: string;
  readonly split: RunKind;
  readonly timeoutMs: number;
  readonly fingerprintId: string;
  readonly source: Source;
  readonly templateHashes: Record<TaskType, string>;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function notRun(base: RecordBase, item: PlanItem, reason: NotRunReason, detail: string, at: number): ResultRecord {
  return {
    schema: SCHEMA.result,
    run_id: base.runId,
    split: base.split,
    card_id: item.card.id,
    permutation: item.permutation,
    outcome: { kind: 'not_run', reason, detail },
    latency_ms: null,
    timeout_ms: base.timeoutMs,
    requested_at: iso(at),
    template_hash: base.templateHashes[item.task],
    fingerprint_id: base.fingerprintId,
    usage: null,
    late: null,
    source: base.source,
  };
}

function usageOf(u: { inputTokens: number; outputTokens: number; reasoningTokens: number | null } | null | undefined): ResultUsage | null {
  return u === null || u === undefined ? null : { input_tokens: u.inputTokens, output_tokens: u.outputTokens, reasoning_tokens: u.reasoningTokens };
}

function lateOf(l: LateAnswer): Late {
  return l.kind === 'late' ? { kind: 'late', text: l.text, latency_ms: l.latencyMs } : { kind: 'none', reason: l.reason };
}

/** Why the request loop stopped before every item was handled. */
interface Stop {
  readonly notRun: NotRunReason;
  readonly ledgerReason: string;
  readonly code: FailureCode;
  readonly detail: string;
}

type Mapped =
  | { readonly kind: 'record'; readonly outcome: Outcome; readonly latency: number | null; readonly usage: ResultUsage | null; readonly late: Late | null }
  | { readonly kind: 'stop'; readonly stop: Stop; readonly failure: { readonly kind: string; readonly detail: string } | null };

const LOAD_CLASS_ERRORS: readonly string[] = ['gpu_unavailable', 'software_adapter', 'backend_not_webgpu', 'placement_not_logged', 'model_load_failed', 'out_of_memory'];

/** Outcome mapping table (design "Outcome mapping", R8.5). */
async function mapResult(res: AdapterResult): Promise<Mapped> {
  if (res.kind === 'text') return { kind: 'record', outcome: { kind: 'text', text: res.text }, latency: res.latencyMs, usage: usageOf(res.usage), late: null };
  if (res.kind === 'timeout') {
    // The Probe_Runner waits for the Late_Answer before the next request (R8.12).
    const late = lateOf(await res.late);
    return { kind: 'record', outcome: { kind: 'timeout' }, latency: res.elapsedMs, usage: null, late };
  }
  const detail = res.detail;
  switch (res.code) {
    case 'budget_exhausted':
      return { kind: 'stop', stop: { notRun: 'budget', ledgerReason: 'budget', code: 'budget_stop', detail }, failure: null };
    case 'not_approved':
      return { kind: 'stop', stop: { notRun: 'not_approved', ledgerReason: 'not_approved', code: 'not_approved_stop', detail }, failure: null };
    case 'out_of_memory':
      return { kind: 'stop', stop: { notRun: 'oom', ledgerReason: 'out_of_memory', code: 'load_failed', detail }, failure: { kind: res.code, detail } };
    case 'runtime_stuck':
      return { kind: 'record', outcome: { kind: 'engine_fault', code: 'runtime_stuck', detail }, latency: null, usage: null, late: null };
    default:
      if (LOAD_CLASS_ERRORS.includes(res.code)) {
        return { kind: 'stop', stop: { notRun: 'load_failed', ledgerReason: res.code, code: 'load_failed', detail }, failure: { kind: res.code, detail } };
      }
      return {
        kind: 'record',
        outcome: { kind: 'error', code: res.code, detail, remote: res.remote !== null },
        latency: res.elapsedMs,
        usage: null,
        late: null,
      };
  }
}

function failureRecord(a: {
  combo: Combination;
  kind: string;
  runKind: RunKind;
  runId: string;
  cardsAnswered: number;
  detail: string;
  at: number;
  entryId: string | null;
}): FailureRecord {
  return {
    schema: SCHEMA.failure,
    combination: a.combo.id,
    kind: a.kind,
    cause: a.kind,
    phase: a.kind === 'rebuild_failed' ? 'inference' : 'load',
    run_kind: a.runKind,
    run_id: a.runId,
    entry_id: a.entryId,
    cards_answered: a.cardsAnswered,
    detail: a.detail,
    at: iso(a.at),
  };
}

// ---------------------------------------------------------------- the request loop

interface Exec {
  readonly deps: RunDeps;
  readonly logger: RunLogger;
  readonly kind: RunKind;
  readonly combo: Combination;
  readonly tasks: readonly TaskType[];
  readonly timeoutMs: number;
  readonly plan: readonly PlanItem[];
  readonly handle: RuntimeHandle;
  readonly writer: ResultsWriter;
  readonly base: RecordBase;
  readonly budget: BudgetSession | null;
  readonly entryId: string | null;
  readonly templates: Templates;
  readonly samplings: Readonly<Record<TaskType, SamplingParams>>;
}

const nowOf = (deps: RunDeps): number => (deps.now ?? Date.now)();

function progressOf(plan: readonly PlanItem[], done: ReadonlySet<string>, task: TaskType): TaskProgress {
  const items = plan.filter((p) => p.task === task);
  if (items.length === 0) return null;
  return [items.filter((p) => done.has(keyOf(p.card.id, p.permutation))).length, items.length];
}

function logProgress(c: Exec, done: ReadonlySet<string>): void {
  c.logger.progress(progressOf(c.plan, done, 'decision'), progressOf(c.plan, done, 'synthesis'));
}

/** Count of records that stand for a request actually sent to the Runtime. */
const sentCount = (records: readonly ResultRecord[]): number => records.filter(hasOutput).length;

/**
 * Sends every item that has no output record and writes one record per item. Returns the Stop that
 * ended it early, or null. Items left over after a Stop are written as `not_run`.
 */
async function sendMissing(c: Exec, existing: readonly ResultRecord[]): Promise<Stop | null> {
  const missing = new Set(missingRuns(plannedRunsOf(c.plan), existing).map((m) => keyOf(m.card_id, m.permutation)));
  const done = new Set(c.plan.filter((p) => !missing.has(keyOf(p.card.id, p.permutation))).map((p) => keyOf(p.card.id, p.permutation)));
  const todo = c.plan.filter((p) => missing.has(keyOf(p.card.id, p.permutation)) && p.prompt !== null && p.sampling !== null);
  // Dev_Run only: a render error is recorded as `not_run` and no request is sent (R3.15 stops a Locked_Run earlier).
  for (const item of c.plan) {
    if (missing.has(keyOf(item.card.id, item.permutation)) && (item.prompt === null || item.sampling === null)) {
      c.writer.append(notRun(c.base, item, 'render_error', item.renderError ?? 'render error', nowOf(c.deps)));
      done.add(keyOf(item.card.id, item.permutation));
    }
  }
  let answered = existing.filter(hasOutput).length;
  let handled = 0;
  const prices = isWorkersAi(c.combo) ? (c.combo.prices as NonNullable<Combination['prices']>) : null;

  const writeRemaining = (from: number, stop: Stop): void => {
    for (const item of todo.slice(from)) c.writer.append(notRun(c.base, item, stop.notRun, stop.detail, nowOf(c.deps)));
  };

  for (let i = 0; i < todo.length; i++) {
    const item = todo[i] as PlanItem;
    const key = keyOf(item.card.id, item.permutation);
    if (item.prompt === null || item.sampling === null) continue; // filtered out above

    // Rebuild before the request when the engine is stuck (R8.13).
    if (c.handle.adapter.state() === 'stuck') {
      try {
        await rebuild(c);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const stop: Stop = { notRun: 'rebuild_failed', ledgerReason: 'rebuild_failed', code: 'rebuild_failed', detail };
        appendFailure(
          c.deps.paths.failures,
          failureRecord({ combo: c.combo, kind: 'rebuild_failed', runKind: c.kind, runId: c.base.runId, cardsAnswered: answered, detail, at: nowOf(c.deps), entryId: c.entryId }),
        );
        writeRemaining(i, stop);
        return stop;
      }
    }

    let reservation: Reservation | null = null;
    if (c.budget !== null && prices !== null) {
      const promptBytes = Buffer.byteLength(item.prompt.system, 'utf8') + Buffer.byteLength(item.prompt.user, 'utf8');
      const estimate = estimateNeurons({ promptBytes, maxOutputTokens: item.sampling.maxOutputTokens, inputPrice: prices.input, outputPrice: prices.output });
      const r = c.budget.reserve({ smoke: false, estimate });
      if (isRefusal(r)) {
        const stop: Stop = { notRun: 'budget', ledgerReason: 'budget', code: 'budget_stop', detail: r.message };
        writeRemaining(i, stop);
        return stop;
      }
      reservation = r;
    }

    const requestedAt = nowOf(c.deps);
    const result = await c.handle.adapter.complete(item.prompt, { timeoutMs: c.timeoutMs, sampling: item.sampling });
    if (reservation !== null && c.budget !== null && prices !== null && result.kind === 'text' && result.usage !== null) {
      c.budget.settle(
        reservation,
        { promptTokens: result.usage.inputTokens, completionTokens: result.usage.outputTokens, reasoningTokens: result.usage.reasoningTokens },
        { inputPrice: prices.input, outputPrice: prices.output },
      );
    }
    const mapped = await mapResult(result);
    if (mapped.kind === 'stop') {
      if (mapped.failure !== null) {
        appendFailure(
          c.deps.paths.failures,
          failureRecord({ combo: c.combo, kind: mapped.failure.kind, runKind: c.kind, runId: c.base.runId, cardsAnswered: answered, detail: mapped.failure.detail, at: nowOf(c.deps), entryId: c.entryId }),
        );
      }
      writeRemaining(i, mapped.stop);
      return mapped.stop;
    }
    c.writer.append({
      schema: SCHEMA.result,
      run_id: c.base.runId,
      split: c.base.split,
      card_id: item.card.id,
      permutation: item.permutation,
      outcome: mapped.outcome,
      latency_ms: mapped.latency,
      timeout_ms: c.base.timeoutMs,
      requested_at: iso(requestedAt),
      template_hash: c.base.templateHashes[item.task],
      fingerprint_id: c.base.fingerprintId,
      usage: mapped.usage,
      late: mapped.late,
      source: c.base.source,
    });
    if (mapped.outcome.kind !== 'engine_fault') answered += 1;
    done.add(key);
    handled += 1;
    if (handled % 10 === 0 || i === todo.length - 1) logProgress(c, done);
  }
  return null;
}

async function rebuild(c: Exec): Promise<void> {
  const lifecycle = c.handle.lifecycle;
  if (lifecycle === undefined) throw new Error('the Runtime has no engine lifecycle to rebuild');
  await rebuildEngineWithWarmUp({
    engine: lifecycle.engine,
    warmups: c.templates.warmups,
    sampling: c.samplings.decision,
    synthesisSampling: c.samplings.synthesis,
    ...(lifecycle.onReady === undefined ? {} : { onReady: lifecycle.onReady }),
  });
}

// ---------------------------------------------------------------- grades

/** Replaces the perf record written at load with the handle's final one (memory peak up to the last Card). */
async function finishPerf(handle: RuntimeHandle, file: string): Promise<void> {
  if (handle.finish === undefined) return;
  const done = await handle.finish();
  if (done !== undefined && done.perf !== undefined) writePerf(file, done.perf, true);
}

const perfPathFor = (resultsFile: string): string => resultsFile.replace(/\.jsonl$/, '') + '.perf.json';

/** Grades the run's records and writes the grades file. An identical existing file is accepted. */
function writeGrades(c: { readonly writer: ResultsWriter; readonly cards: readonly LoadedCard[]; readonly tasks: readonly TaskType[] }): void {
  const records = readResultsFile(c.writer.file).records;
  const graded = gradeRecords(c.cards, records, c.tasks);
  const file = gradesPathFor(c.writer.file);
  if (fs.existsSync(file)) {
    const old = readGradesFile(file);
    const same = canonicalJson({ g: old.grades, c: old.contrasts, e: old.excluded }) === canonicalJson({ g: graded.grades, c: graded.contrasts, e: graded.excluded });
    if (!same) throw new Error('a different grades file already exists for this run');
    return;
  }
  writeGradesFile(file, graded.grades, graded.contrasts, graded.excluded);
}

function runCounts(records: readonly ResultRecord[]): { total: number; withOutput: number; notRun: number; engineFaults: number } {
  return {
    total: records.length,
    withOutput: records.filter(hasOutput).length,
    notRun: records.filter((r) => r.outcome.kind === 'not_run').length,
    engineFaults: records.filter((r) => r.outcome.kind === 'engine_fault').length,
  };
}

// ---------------------------------------------------------------- error handling

/** Prints one failure through the logger and returns the exit code (1). */
export function reportFailure(logger: RunLogger, e: unknown): number {
  if (e instanceof RunError) {
    // Manifest failures were printed line by line already.
    if (!(e.code === 'card_load' && e.args.value === 'manifest')) logger.failure(e.code, e.args);
    return 1;
  }
  if (e instanceof CardLoadError) {
    logger.cardLoad(e.failures);
    return 1;
  }
  if (e instanceof LedgerError) {
    logger.ledgerError(e);
    return 1;
  }
  if (e instanceof GradingError) {
    logger.failure('grading_failed', { cardId: e.cardId });
    return 1;
  }
  if (e instanceof BudgetError) {
    logger.failure('budget_unreadable');
    return 1;
  }
  const code = (e as NodeJS.ErrnoException | null)?.code;
  logger.failure('internal', { value: `${e instanceof Error ? e.name : typeof e}${typeof code === 'string' ? ` ${code}` : ''}` });
  return 1;
}

async function closeHandle(h: RuntimeHandle | null): Promise<void> {
  if (h?.close !== undefined) await h.close();
}

/** Timeout check and Combination lookup. Reads no Card (the Manifest_Check comes next, R1.1). */
function prepare(deps: RunDeps, comboId: string, task: TaskSubset, rawTimeout: number | string | undefined): Prepared {
  const timeoutMs = parseTimeoutMs(rawTimeout);
  const combo = findCombo(deps, comboId);
  return { combo, subset: task, tasks: tasksOf(task), timeoutMs };
}

function runContext(prep: Prepared, kind: RunKind, resume: boolean, templates: Templates): RuntimeContext {
  return {
    combo: prep.combo,
    kind,
    resume,
    timeoutMs: prep.timeoutMs,
    samplings: warmupSamplings(prep.combo),
    warmups: templates.warmups,
  };
}

function utcStamp(ms: number): string {
  return iso(ms).replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------- Dev_Run

/** Dev_Run over `dev.jsonl` for the Task_Type_Subset. Returns the process exit code. */
export async function devRun(deps: RunDeps, opts: DevRunOptions): Promise<number> {
  const logger = deps.logger ?? new RunLogger();
  let handle: RuntimeHandle | null = null;
  try {
    const subset: TaskSubset = opts.task ?? 'DS';
    const prep = prepare(deps, opts.combo, subset, opts.timeoutMs);
    requireInBrowser(prep.combo, opts.pageBundle);
    await runManifestCheck(deps, logger);
    const loaded = loadSplits(deps, 'dev');
    const cards = loaded.cards.dev;
    const { combo, tasks, timeoutMs } = prep;
    const templates = loadTemplates(deps.paths);
    const plan = buildPlan(cards, tasks);
    const schemas = loadSchemas(deps.paths.cardsDir, plan);
    const rendered = renderPlan(plan, templates, schemas, combo);

    const startedAt = nowOf(deps);
    const runId = `dev-${utcStamp(startedAt)}-${slug(combo.id)}`;
    logger.status('dev-run start', { combination: combo.id, count: plan.length });

    if (opts.pageBundle !== undefined) {
      // page-bundle: a render error stops the bundle (the page has no way to show a not_run record).
      if (rendered.errors.length > 0) {
        logger.failure('render_errors', { count: rendered.errors.length });
        for (const item of rendered.errors) logger.renderError(item.card.id, item.permutation, renderReasonCategory(item.renderError ?? ''));
        return 1;
      }
      opts.pageBundle(bundleDataOf(deps, { runId, split: 'dev', subset, combo, plan, templates, tasks, timeoutMs }));
      return 0;
    }

    const gate = await gateRun(deps, 'dev', combo, subset, opts.approval ?? null, plan.length);
    const ctx = runContext(prep, 'dev', false, templates);

    if (!gate.ok) {
      // Refused (R11.8, R18): nothing is sent; every Card x Permutation is recorded as not_run.
      logger.gateRefusal(gate.reason);
      const identity = placeholderHandle(combo);
      const fingerprint = buildFingerprint(deps, combo, identity, templates, tasks, rendered.rendererVersion);
      const writer = ResultsWriter.create(deps.paths.resultsDir, header(runId, 'dev', combo, subset, fingerprint, templates, tasks, timeoutMs, null));
      const base = recordBase(runId, 'dev', timeoutMs, writer.fingerprintId, 'node', templates.hashes);
      for (const item of plan) writer.append(notRun(base, item, 'not_approved', gate.reason, nowOf(deps)));
      writeGrades({ writer, cards, tasks });
      logger.summary(runCounts(readResultsFile(writer.file).records));
      return 1;
    }

    handle = await createHandle(deps, ctx);
    // Fresh_Profile, WebGPU adapter and quota checks come before anything is written (no Runtime request is sent).
    if (deps.freshProfile !== undefined) {
      const fp = await deps.freshProfile(ctx, handle);
      if (!fp.ok) {
        appendFailure(deps.paths.failures, { ...fp.failure, schema: SCHEMA.failure, combination: combo.id, kind: typeof fp.failure['kind'] === 'string' ? (fp.failure['kind'] as string) : 'fresh_profile_failed' });
        logger.failure('fresh_profile_failed', { combination: combo.id });
        return 1;
      }
    }
    const fingerprint = buildFingerprint(deps, combo, handle, templates, tasks, rendered.rendererVersion);
    const budget = openBudget(deps, combo, 0);

    // Load first: the Results header records the placement, which an in-browser Runtime knows only after the
    // session is created. The load sends no Card, so the header still precedes the first request.
    const outcome = await loadFirst(handle, true);
    const writer = ResultsWriter.create(deps.paths.resultsDir, header(runId, 'dev', combo, subset, fingerprint, templates, tasks, timeoutMs, handle.placement ?? null));
    if (outcome.crash !== null) throw outcome.crash;
    const base = recordBase(runId, 'dev', timeoutMs, writer.fingerprintId, handle.source ?? 'node', templates.hashes);

    let stop: Stop | null = null;
    let perfWritten = false;
    if (outcome.perf !== undefined) {
      writePerf(perfPathFor(writer.file), outcome.perf);
      perfWritten = true;
    }
    if (outcome.failure !== null) {
      const e = outcome.failure;
      stop = loadStop(e);
      appendFailure(deps.paths.failures, failureRecord({ combo, kind: e.code, runKind: 'dev', runId, cardsAnswered: 0, detail: e.message, at: nowOf(deps), entryId: null }));
      for (const item of plan) writer.append(notRun(base, item, stop.notRun, stop.detail, nowOf(deps)));
    }
    if (stop === null) {
      const exec: Exec = { deps, logger, kind: 'dev', combo, tasks, timeoutMs, plan, handle, writer, base, budget, entryId: null, templates, samplings: ctx.samplings };
      stop = await sendMissing(exec, []);
    }
    if (perfWritten) await finishPerf(handle, perfPathFor(writer.file));
    const records = readResultsFile(writer.file).records;
    writeGrades({ writer, cards, tasks });
    logger.status('results written', { count: records.length });
    logger.summary(runCounts(records));
    if (stop !== null) {
      logger.failure(stop.code);
      return 1;
    }
    return 0;
  } catch (e) {
    return reportFailure(logger, e);
  } finally {
    await closeHandle(handle);
  }
}

// ---------------------------------------------------------------- helpers shared by both flows

/** Result of `handle.load`: a load failure and an unexpected crash are kept apart so the caller can still write the header. */
interface Loaded {
  readonly perf: PerfRecord | undefined;
  readonly failure: RuntimeLoadError | null;
  /** A non-RuntimeLoadError: rethrown by the caller after the Results header exists. */
  readonly crash: unknown;
}

async function loadFirst(handle: RuntimeHandle, coldStart: boolean): Promise<Loaded> {
  try {
    const r = await handle.load({ coldStart });
    return { perf: r !== undefined ? r.perf : undefined, failure: null, crash: null };
  } catch (e) {
    if (e instanceof RuntimeLoadError) return { perf: undefined, failure: e, crash: null };
    return { perf: undefined, failure: null, crash: e };
  }
}

function placeholderHandle(combo: Combination): RuntimeHandle {
  const adapter: RuntimeAdapter = {
    identity: () => ({ runtime: combo.runtime, runtimeVersion: 'unknown', modelId: combo.model_id, modelRevision: combo.revision, quantization: combo.quantization }),
    state: () => 'idle',
    complete: () => Promise.reject(new Error('no Runtime was created for this run')),
  };
  return { adapter, load: () => Promise.resolve() };
}

async function createHandle(deps: RunDeps, ctx: RuntimeContext): Promise<RuntimeHandle> {
  try {
    return await deps.createRuntime(ctx);
  } catch (e) {
    throw new RunError('runtime_unavailable', { combination: ctx.combo.id, value: e instanceof Error ? e.name : 'error' });
  }
}

function openBudget(deps: RunDeps, combo: Combination, runCount: number): BudgetSession | null {
  if (!isWorkersAi(combo)) return null;
  if (combo.prices === undefined) throw new RunError('invalid_arguments', { combination: combo.id, value: 'no prices in combinations.json' });
  return BudgetSession.open({ file: deps.paths.budgetFile, now: () => nowOf(deps), runCount });
}

function loadStop(e: RuntimeLoadError): Stop {
  return { notRun: e.code === 'out_of_memory' ? 'oom' : 'load_failed', ledgerReason: e.code, code: 'load_failed', detail: e.message };
}

function header(
  runId: string,
  split: RunKind,
  combo: Combination,
  subset: TaskSubset,
  fingerprint: JsonObject,
  templates: Templates,
  tasks: readonly TaskType[],
  timeoutMs: number,
  placement: Placement | null,
): ResultsHeader {
  const key: ModelKey = comboModelKey(combo);
  return {
    schema: SCHEMA.header,
    run_id: runId,
    split,
    combination: combo.id,
    model_key: key,
    task_subset: subset,
    fingerprint,
    template_hashes: subsetHashes(templates.hashes, tasks),
    timeout_ms: timeoutMs,
    placement,
  };
}

function recordBase(runId: string, split: RunKind, timeoutMs: number, fpId: string, source: Source, hashes: Record<TaskType, string>): RecordBase {
  return { runId, split, timeoutMs, fingerprintId: fpId, source, templateHashes: hashes };
}

// ---------------------------------------------------------------- Dev_Run precondition (R3.12)

/** Problems (empty when the precondition holds). Names a missing Dev_Run or each mismatched template. */
export function devRunPrecondition(resultsDir: string, comboId: string, tasks: readonly TaskType[], current: Record<TaskType, string>): string[] {
  const dir = path.join(resultsDir, 'dev');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl') && !n.endsWith('.grades.jsonl')).sort() : [];
  const headers: ResultsHeader[] = [];
  const problems: string[] = [];
  for (const name of files) {
    try {
      const h = readResultsFile(path.join(dir, name)).header;
      if (h.combination === comboId) headers.push(h);
    } catch (e) {
      if (e instanceof ResultsFormatError) problems.push(`Dev_Run file ${name} is unreadable`);
      else throw e;
    }
  }
  for (const task of tasks) {
    const letter = task === 'decision' ? 'D' : 'S';
    const covering = headers.filter((h) => tasksOf(h.task_subset).includes(task));
    const latest = covering[covering.length - 1];
    if (latest === undefined) {
      problems.push(`no Dev_Run of Combination ${comboId} covers Task_Type ${letter}`);
      continue;
    }
    const recorded = latest.template_hashes[TEMPLATE_KEY[task]];
    if (recorded !== current[task]) {
      problems.push(`Prompt_Template ${task} differs from the most recent Dev_Run ${latest.run_id} (recorded ${recorded ?? 'none'}, current ${current[task]})`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- Locked_Run

/**
 * Locked_Run for one Task_Type_Subset, in the order of the design's "Locked run flow", or a resume of
 * an incomplete entry. Returns the process exit code.
 */
export async function lockedRun(deps: RunDeps, opts: LockedRunOptions): Promise<number> {
  const logger = deps.logger ?? new RunLogger();
  let handle: RuntimeHandle | null = null;
  try {
    const resuming = opts.resume !== undefined;
    if (resuming && (opts.combo !== undefined || opts.task !== undefined || (opts.rerunReason !== undefined && opts.rerunReason !== null))) {
      throw new RunError('invalid_arguments', { value: '--resume cannot be combined with --combo, --task or --rerun-reason' });
    }
    if (!resuming && (opts.combo === undefined || opts.task === undefined)) {
      throw new RunError('invalid_arguments', { value: '--combo and --task are required' });
    }
    if (resuming && opts.pageBundle !== undefined) throw new RunError('invalid_arguments', { value: 'page-bundle cannot resume an entry' });

    // Resume: find the entry first, so the Combination and subset come from the ledger.
    let entry: LedgerEntry | null = null;
    if (resuming) {
      entry = readLedger(deps.paths.ledger).entries.find((e) => e.entry_id === opts.resume) ?? null;
      if (entry === null || entry.status === 'complete') throw new RunError('resume_unknown', { entryId: opts.resume as string });
    }
    const comboId = entry === null ? (opts.combo as string) : entry.start.combination;
    const subset: TaskSubset = entry === null ? (opts.task as TaskSubset) : entry.start.task_subset;

    // Step 1: Timeout check, Manifest_Check, card load and count checks.
    const timeoutMs = parseTimeoutMs(opts.timeoutMs);
    await runManifestCheck(deps, logger);
    const combo = findCombo(deps, comboId);
    requireInBrowser(combo, opts.pageBundle);
    const tasks = tasksOf(subset);
    const loaded = loadSplits(deps, 'locked');
    const cards = loaded.cards.locked;
    const prep: Prepared = { combo, subset, tasks, timeoutMs };

    // Resume keeps the recorded Timeout (R3.10 compares the header's identity, not a new choice).
    let effectiveTimeout = timeoutMs;
    let resumeFile: string | null = null;
    if (entry !== null) {
      resumeFile = resultsPath(deps.paths.resultsDir, 'locked', entry.entry_id);
      if (!fs.existsSync(resumeFile)) throw new RunError('resume_unknown', { entryId: entry.entry_id });
      const recorded = readResultsFile(resumeFile).header.timeout_ms;
      if (opts.timeoutMs !== undefined && recorded !== timeoutMs) throw new RunError('invalid_arguments', { value: `Timeout differs from the recorded ${recorded}` });
      effectiveTimeout = recorded;
    }
    if (!isWorkersAi(combo) && entry === null && !/^[0-9a-f]{40}$/.test(combo.revision)) throw new RunError('not_pinned', { combination: combo.id });
    if (entry === null && fs.existsSync(deps.paths.exclusions) && readExclusionsFor(deps.paths.exclusions, combo.id)) throw new RunError('excluded', { combination: combo.id });

    const templates = loadTemplates(deps.paths);
    const plan = buildPlan(cards, tasks);
    const planned = plannedRunsOf(plan);

    // Step 2: phase gate and approval. A refusal sends nothing and writes nothing.
    const approvalId = opts.approval ?? entry?.start.approval ?? null;
    const gate = await gateRun(deps, 'locked', combo, subset, approvalId, plan.length);
    if (!gate.ok) {
      logger.gateRefusal(gate.reason);
      return 1;
    }

    // Step 3: once-only check on the Model_Key (a resume is not a re-run).
    const modelKey = comboModelKey(combo);
    if (entry === null) {
      const decision = decideOverlap(readLedger(deps.paths.ledger).entries, modelKey, subset, opts.rerunReason);
      if (decision.kind === 'refused') throw new LedgerError('overlap', decision.message, decision.overlaps);
    }

    // Step 4: Dev_Run precondition per Task_Type (not repeated for a resume: the entry's template hashes are checked instead).
    if (entry === null) {
      const problems = devRunPrecondition(deps.paths.resultsDir, combo.id, tasks, templates.hashes);
      if (problems.length > 0) {
        logger.failure(problems.some((p) => p.startsWith('Prompt_Template')) && !problems.some((p) => p.startsWith('no Dev_Run')) ? 'template_mismatch' : 'dev_run_missing', { combination: combo.id });
        logger.precondition(problems);
        return 1;
      }
    }

    // Step 5: pre-render every Card x Permutation. Any error: print every Card ID and reason, write nothing.
    const schemas = loadSchemas(deps.paths.cardsDir, plan);
    const rendered = renderPlan(plan, templates, schemas, combo);
    if (rendered.errors.length > 0) {
      logger.failure('render_errors', { count: rendered.errors.length });
      for (const item of rendered.errors) logger.renderError(item.card.id, item.permutation, renderReasonCategory(item.renderError ?? ''));
      return 1;
    }

    // Step 6: Runtime handle, Fresh_Profile hook, budget counter. No Runtime request is sent.
    const ctx = runContext(prep, 'locked', entry !== null, templates);
    // page-bundle creates no Runtime and opens no Fresh_Profile: the Author's headed Chrome does both.
    handle = opts.pageBundle !== undefined ? { ...placeholderHandle(combo), fingerprint: { measurement: 'probe_page' } } : await createHandle(deps, ctx);
    if (opts.pageBundle === undefined && deps.freshProfile !== undefined) {
      const fp = await deps.freshProfile(ctx, handle);
      if (!fp.ok) {
        appendFailure(deps.paths.failures, { ...fp.failure, schema: SCHEMA.failure, combination: combo.id, kind: typeof fp.failure['kind'] === 'string' ? (fp.failure['kind'] as string) : 'fresh_profile_failed' });
        logger.failure('fresh_profile_failed', { combination: combo.id });
        return 1;
      }
    }
    // After the hook: the browser and adapter fields of the fingerprint are known only once Chrome has been asked.
    const fingerprint = buildFingerprint(deps, combo, handle, templates, tasks, rendered.rendererVersion);
    const priorRecords = resumeFile === null ? [] : readResultsFile(resumeFile).records;
    const budget = openBudget(deps, combo, sentCount(priorRecords));

    // Step 7: ledger `start` (fsync before any request) or `resume`, and the docs/kiro-log.md entry text.
    const startedMs = nowOf(deps);
    const startedAt = iso(startedMs);
    const identity: ResumeIdentity = { model_key: modelKey, fingerprint, template_hashes: subsetHashes(templates.hashes, tasks) };
    let entryId: string;
    let rerunOf: string | null = null;
    try {
      if (entry === null) {
        entryId = makeEntryId(startedAt, combo.id);
        const start = appendStart(deps.paths.ledger, {
          entry_id: entryId,
          model_key: modelKey,
          combination: combo.id,
          task_subset: subset,
          fingerprint,
          template_hashes: identity.template_hashes,
          started_at: startedAt,
          approval: gate.value.approval,
          planned: plannedCounts(plan, tasks),
          rerun_reason: opts.rerunReason ?? null,
        });
        rerunOf = start.rerun_of;
      } else {
        entryId = entry.entry_id;
        appendResume(deps.paths.ledger, entryId, startedAt, identity);
      }
    } catch (e) {
      if (e instanceof LedgerError) throw e;
      throw new RunError('ledger_write_failed');
    }
    logger.docEntry({
      kind: entry === null ? 'start' : 'resume',
      entryId,
      combination: combo.id,
      taskSubset: subset,
      modelKey: canonicalJson([modelKey.runtime, modelKey.model_id, modelKey.quantization, modelKey.revision]),
      fingerprintId: fingerprintId(fingerprint),
      templateHashes: identity.template_hashes,
      planned: plannedCounts(plan, tasks) as Record<string, number>,
      approval: gate.value.approval,
      rerunOf,
      startedAt,
    });
    logger.status(entry === null ? 'locked-run start' : 'resume', { entryId, combination: combo.id, count: plan.length });

    const abort = (reason: string): void => {
      appendAbort(deps.paths.ledger, entryId, iso(nowOf(deps)), reason);
      logger.status('aborted', { entryId });
    };

    if (opts.pageBundle !== undefined) {
      // The ledger `start` is written (step 7); the prompts go to the bundle instead of a Runtime. `ingest` completes the entry.
      try {
        opts.pageBundle(bundleDataOf(deps, { runId: entryId, split: 'locked', subset, combo, plan, templates, tasks, timeoutMs: effectiveTimeout }));
      } catch (e) {
        abort('bundle_write_failed');
        throw e;
      }
      return 0;
    }

    // Step 8: load the engine; cold start only when the entry has no perf record yet. The load sends no Card
    // and comes BEFORE the Results header is written, because the header records the placement, which an
    // in-browser Runtime knows only after its session exists. The ledger `start` (step 7) still precedes it.
    const resultsFile = resumeFile ?? resultsPath(deps.paths.resultsDir, 'locked', entryId);
    const perfFile = perfPathFor(resultsFile);
    const outcome = await loadFirst(handle, !fs.existsSync(perfFile));

    let writer: ResultsWriter;
    try {
      writer =
        resumeFile !== null
          ? ResultsWriter.open(resumeFile)
          : ResultsWriter.create(deps.paths.resultsDir, header(entryId, 'locked', combo, subset, fingerprint, templates, tasks, effectiveTimeout, handle.placement ?? null));
    } catch {
      abort('results_write_failed');
      throw new RunError('results_write_failed', { entryId });
    }
    if (outcome.crash !== null) throw outcome.crash;
    const base = recordBase(entryId, 'locked', effectiveTimeout, writer.fingerprintId, handle.source ?? 'node', templates.hashes);

    let stop: Stop | null = null;
    let perfWritten = false;
    if (outcome.perf !== undefined && !fs.existsSync(perfFile)) {
      writePerf(perfFile, outcome.perf);
      perfWritten = true;
    }
    if (outcome.failure !== null) {
      const e = outcome.failure;
      stop = loadStop(e);
      appendFailure(deps.paths.failures, failureRecord({ combo, kind: e.code, runKind: 'locked', runId: entryId, cardsAnswered: sentCount(priorRecords), detail: e.message, at: nowOf(deps), entryId }));
      const todo = missingRuns(planned, priorRecords);
      const byKey = new Map(plan.map((p) => [keyOf(p.card.id, p.permutation), p] as const));
      for (const m of todo) writer.append(notRun(base, byKey.get(keyOf(m.card_id, m.permutation)) as PlanItem, stop.notRun, stop.detail, nowOf(deps)));
    }

    // Step 9: send every request that has no recorded output.
    if (stop === null) {
      const exec: Exec = { deps, logger, kind: 'locked', combo, tasks, timeoutMs: effectiveTimeout, plan, handle, writer, base, budget, entryId, templates, samplings: ctx.samplings };
      stop = await sendMissing(exec, priorRecords);
    }
    if (perfWritten) await finishPerf(handle, perfFile);

    // Steps 10 and 11: grade, then `complete` only when every Card x Permutation has an output.
    const records = readResultsFile(writer.file).records;
    logger.summary(runCounts(records));
    const check = canComplete(planned, records);
    if (!check.ok) {
      abort(stop?.ledgerReason ?? 'missing_outputs');
      logger.failure(stop?.code ?? 'run_incomplete', { entryId });
      return 1;
    }
    try {
      writeGrades({ writer, cards, tasks });
    } catch (e) {
      abort('grading_failed');
      throw e;
    }
    logger.status('grades written', { entryId });
    appendComplete(
      deps.paths.ledger,
      entryId,
      { ended_at: iso(nowOf(deps)), results: path.relative(deps.paths.repoDir, writer.file), requests_sent: sentCount(records) },
      planned,
      records,
    );
    logger.status('complete', { entryId });
    return 0;
  } catch (e) {
    return reportFailure(logger, e);
  } finally {
    await closeHandle(handle);
  }
}

function readExclusionsFor(file: string, comboId: string): boolean {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .some((l) => {
      try {
        return (JSON.parse(l) as { combination?: unknown }).combination === comboId;
      } catch {
        return false;
      }
    });
}
