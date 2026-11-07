// Probe_Page logic (llm-probe task 16.7; design "Probe_Page bundle and export", R9.7, R10.2, R10.3,
// R10.11, R14.4). Pure: no DOM, no Node, no engine import, so it runs unchanged on the page and in
// the offline unit tests with fakes. The real engines are wired in engines.ts, the DOM in main.ts.
//
// This file reads nothing under eval/cards/ and imports nothing from web/ (R10.11): the page sees
// only the prompts the Probe_Runner rendered into a bundle.
//
// Type-only imports from ../src/** are erased by the bundler; the only runtime imports are the two
// engine-neutral adapter modules in engines.ts.
import type { AdapterResult, OutputConstraint, Prompt, RequestOptions, RuntimeAdapter, RuntimeIdentity, SamplingParams } from '../src/adapters/interface.ts';
import { checkAdapter, type AdapterCheck, type GpuLike, type PowerPreference } from '../src/adapters/gpu.ts';
import type { TimingClock } from '../src/adapters/timing.ts';
import type { WarmUpPrompts } from '../src/adapters/lifecycle.ts';
import type { TaskType } from '../src/cards.ts';
import type { Bundle, BundleRequest, ExportEntry, ExportOutcome, PageExport } from '../src/ingest.ts';
import type { Combination } from '../src/phase.ts';
import type { JsonObject, JsonValue, Late } from '../src/results.ts';

export const PAGE_EXPORT_SCHEMA_ID = 'llm-probe-page-export-v1' as const;
export const BUNDLE_SCHEMA_ID = 'llm-probe-bundle-v1' as const;

// ---------------------------------------------------------------- sampling (mirrors run.ts)

/** The one card-independent decision schema (copy of run.ts DECISION_SCHEMA; a unit test pins them equal). */
export const DECISION_SCHEMA: JsonObject = {
  type: 'object',
  properties: { option: { type: 'string' } },
  required: ['option'],
  additionalProperties: false,
};

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const wantsSchema = (combo: Combination): boolean => combo['constraint'] === 'json_schema';

/** Copy of run.ts `samplingFor` (a unit test pins them equal on every Combination). */
export function samplingForCombo(combo: Combination, task: TaskType, constraint: OutputConstraint): SamplingParams {
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

/** Sampling of the two Warm_Up_Prompts (R9.12), as run.ts `warmupSamplings`. */
export function warmupSamplings(combo: Combination): Record<TaskType, SamplingParams> {
  return {
    decision: samplingForCombo(combo, 'decision', wantsSchema(combo) ? { kind: 'json_schema', schema: DECISION_SCHEMA } : { kind: 'none' }),
    synthesis: samplingForCombo(combo, 'synthesis', { kind: 'none' }),
  };
}

/** Splits a warm-up file into `[system]` and `[user]` (copy of templates.ts `parseWarmupPrompt`). */
export function parseWarmupText(text: string): Prompt {
  const lines = text.split('\n');
  const sys = lines.findIndex((l) => l === '[system]');
  const usr = lines.findIndex((l) => l === '[user]');
  if (sys !== 0 || usr < 0) throw new Error('warm-up prompt must start with [system] and contain [user]');
  return { system: lines.slice(1, usr).join('\n'), user: lines.slice(usr + 1).join('\n') };
}

// ---------------------------------------------------------------- bundle shape check

/** A light structural check of a bundle the Author loaded (the runner's own parseBundle is the strict one). */
export function checkBundleShape(v: unknown): Bundle {
  const o = asRecord(v);
  if (o === null) throw new Error('bundle: must be an object');
  if (o['schema'] !== BUNDLE_SCHEMA_ID) throw new Error(`bundle: schema must be "${BUNDLE_SCHEMA_ID}"`);
  for (const k of ['run_id', 'split', 'task_subset', 'combination', 'template_hashes', 'pinned_manifest_hash', 'timeout_ms', 'requests']) {
    if (!(k in o)) throw new Error(`bundle: missing the field "${k}"`);
  }
  if (!Array.isArray(o['requests'])) throw new Error('bundle: requests must be an array');
  if (typeof o['timeout_ms'] !== 'number' || !Number.isSafeInteger(o['timeout_ms']) || o['timeout_ms'] < 1) throw new Error('bundle: timeout_ms must be a positive integer');
  o['requests'].forEach((r, i) => {
    const q = asRecord(r);
    const p = asRecord(q?.['prompt']);
    if (q === null || p === null || typeof q['card_id'] !== 'string' || typeof q['permutation'] !== 'string' || typeof p['system'] !== 'string' || typeof p['user'] !== 'string') {
      throw new Error(`bundle: requests[${i}] needs card_id, permutation and prompt.system/prompt.user`);
    }
    if (q['task'] !== 'decision' && q['task'] !== 'synthesis') throw new Error(`bundle: requests[${i}].task must be decision or synthesis`);
  });
  return v as Bundle;
}

// ---------------------------------------------------------------- outcome mapping

const wholeMs = (n: number): number => Math.max(0, Math.round(n));

/** Adapter result -> export outcome, latency and Late_Answer (R10.3). Awaits the late answer of a timeout. */
export async function toExportParts(result: AdapterResult): Promise<{ outcome: ExportOutcome; latency_ms: number; late: Late | null }> {
  switch (result.kind) {
    case 'text':
      return { outcome: { kind: 'text', text: result.text }, latency_ms: wholeMs(result.latencyMs), late: null };
    case 'timeout': {
      const l = await result.late;
      const late: Late = l.kind === 'late' ? { kind: 'late', text: l.text, latency_ms: wholeMs(l.latencyMs) } : { kind: 'none', reason: l.reason };
      return { outcome: { kind: 'timeout' }, latency_ms: wholeMs(result.elapsedMs), late };
    }
    case 'error':
      return { outcome: { kind: 'error', code: result.code, detail: result.detail }, latency_ms: wholeMs(result.elapsedMs), late: null };
  }
}

export interface RunOneDeps {
  readonly adapter: RuntimeAdapter;
  /** Wall-clock milliseconds since the epoch (for `requested_at` only). */
  readonly wallNow: () => number;
  readonly combo: Combination;
  readonly timeoutMs: number;
}

/** Sends one prompt and returns the export view of the result. */
export async function runOne(
  deps: RunOneDeps,
  prompt: Prompt,
  task: TaskType,
  constraint: OutputConstraint,
  timeoutMs: number = deps.timeoutMs,
): Promise<{ outcome: ExportOutcome; latency_ms: number; requested_at: string; late: Late | null }> {
  const requested_at = new Date(deps.wallNow()).toISOString();
  const result = await deps.adapter.complete(prompt, { timeoutMs, sampling: samplingForCombo(deps.combo, task, constraint) });
  return { requested_at, ...(await toExportParts(result)) };
}

export type BundleProgress = (done: number, total: number, request: BundleRequest) => void;

/** Runs every request of the bundle in order, one at a time (the adapter is single-flight). */
export async function runBundleEntries(bundle: Bundle, deps: Omit<RunOneDeps, 'timeoutMs' | 'combo'>, onProgress?: BundleProgress): Promise<ExportEntry[]> {
  const entries: ExportEntry[] = [];
  const base: RunOneDeps = { ...deps, combo: bundle.combination, timeoutMs: bundle.timeout_ms };
  for (const request of bundle.requests) {
    const r = await runOne(base, request.prompt, request.task, request.constraint);
    entries.push({ card_id: request.card_id, permutation: request.permutation, outcome: r.outcome, latency_ms: r.latency_ms, requested_at: r.requested_at, late: r.late });
    onProgress?.(entries.length, bundle.requests.length, request);
  }
  return entries;
}

// ---------------------------------------------------------------- fingerprint and export

export interface AdapterFacts {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly is_fallback_adapter: boolean;
}

/** `Chrome/137.0.7151.55` -> `137.0.7151.55`; otherwise the whole user agent (never empty). */
export function browserVersion(userAgent: string): string {
  const m = /\b(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/.exec(userAgent);
  return m?.[1] ?? (userAgent === '' ? 'unknown' : userAgent);
}

export interface FingerprintInput {
  readonly combo: Combination;
  readonly identity: RuntimeIdentity;
  /** `runtime.fingerprint()` of the engine adapter. */
  readonly runtimeFingerprint: JsonObject;
  readonly adapter: AdapterFacts;
  readonly powerPreference: PowerPreference;
  readonly userAgent: string;
  readonly templateHashes: { readonly [name: string]: string };
  readonly pinnedManifestHash: string;
}

/**
 * The Model_Fingerprint of a Probe_Page export (R10.3): same field names as the headless one where
 * the page knows the value, `measurement: "probe_page"`, plus `browser.version` and the full adapter
 * strings. Fields only the Node side knows (sim_wasm_sha256, renderer_version, warmup_hashes) are null.
 */
export function buildPageFingerprint(i: FingerprintInput): JsonObject {
  const c = i.combo;
  const s = asRecord(c['sampling']) ?? {};
  return {
    runtime: { name: i.identity.runtime, version: i.identity.runtimeVersion },
    model: {
      id: i.identity.modelId,
      revision: i.identity.modelRevision,
      model_lib_url: typeof c['model_lib_url'] === 'string' ? c['model_lib_url'] : null,
      quantization: i.identity.quantization,
    },
    model_key: { runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision },
    sampling: JSON.parse(JSON.stringify(s)) as JsonValue,
    chat_template_kwargs: (c['chat_template_kwargs'] ?? null) as JsonValue,
    constraint: typeof c['constraint'] === 'string' ? c['constraint'] : 'none',
    template_hashes: { ...i.templateHashes },
    warmup_hashes: null,
    renderer_version: null,
    sim_wasm_sha256: null,
    pinned_manifest_hash: i.pinnedManifestHash,
    browser: { version: browserVersion(i.userAgent), user_agent: i.userAgent },
    webgpu: { ...i.adapter, power_preference: i.powerPreference },
    measurement: 'probe_page',
    ...i.runtimeFingerprint,
  };
}

export interface ColdStartFigures {
  readonly empty_cache_ms: number | null;
  readonly warm_cache_ms: number | null;
}

export interface ExportInput {
  readonly bundle: Bundle;
  readonly fingerprint: JsonObject;
  readonly coldStart: ColdStartFigures;
  readonly entries: readonly ExportEntry[];
}

/** Builds the `llm-probe-page-export-v1` object; template and manifest hashes come from the bundle. */
export function buildPageExport(i: ExportInput): PageExport {
  if (i.coldStart.empty_cache_ms === null || i.coldStart.warm_cache_ms === null) {
    throw new Error('export needs both cold-start figures: run coldStart() on a fresh profile, reload the page, then run coldStart() again');
  }
  if (i.entries.length !== i.bundle.requests.length) {
    throw new Error(`export needs every request answered (${i.entries.length} of ${i.bundle.requests.length} done)`);
  }
  return {
    schema: PAGE_EXPORT_SCHEMA_ID,
    run_id: i.bundle.run_id,
    split: i.bundle.split,
    template_hashes: { ...i.bundle.template_hashes },
    pinned_manifest_hash: i.bundle.pinned_manifest_hash,
    fingerprint: i.fingerprint,
    cold_start: { empty_cache_ms: i.coldStart.empty_cache_ms, warm_cache_ms: i.coldStart.warm_cache_ms },
    entries: [...i.entries],
  };
}

export const exportFileName = (runId: string): string => `${runId}.page-export.json`;

// ---------------------------------------------------------------- cold-start store

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const coldKey = (comboId: string): string => `llm-probe:cold-start:${comboId}`;

export function readColdStart(store: KeyValueStore, comboId: string): ColdStartFigures {
  const raw = store.get(coldKey(comboId));
  if (raw === null) return { empty_cache_ms: null, warm_cache_ms: null };
  try {
    const o = asRecord(JSON.parse(raw));
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
    return { empty_cache_ms: num(o?.['empty_cache_ms']), warm_cache_ms: num(o?.['warm_cache_ms']) };
  } catch {
    return { empty_cache_ms: null, warm_cache_ms: null };
  }
}

/**
 * Stores one cold-start figure. `slot` is explicit, or chosen by what is stored: the first figure of a
 * Fresh_Profile is the empty-cache one, a later one (after a reload) is the warm-cache one.
 */
export function recordColdStart(store: KeyValueStore, comboId: string, ms: number, slot?: 'empty' | 'warm'): { slot: 'empty' | 'warm'; figures: ColdStartFigures } {
  const cur = readColdStart(store, comboId);
  const use = slot ?? (cur.empty_cache_ms === null ? 'empty' : 'warm');
  const figures: ColdStartFigures = use === 'empty' ? { ...cur, empty_cache_ms: wholeMs(ms) } : { ...cur, warm_cache_ms: wholeMs(ms) };
  store.set(coldKey(comboId), JSON.stringify(figures));
  return { slot: use, figures };
}

export function clearColdStart(store: KeyValueStore, comboId: string): void {
  store.set(coldKey(comboId), JSON.stringify({ empty_cache_ms: null, warm_cache_ms: null }));
}

// ---------------------------------------------------------------- the controller behind window.__probe

export interface WarmUpResult {
  readonly task: 'decision' | 'synthesis';
  readonly text: string;
  readonly latencyMs: number;
}

/** What the page needs from a WebLLM or transformers.js runtime (both runtimes in src/adapters fit). */
export interface PageRuntime {
  readonly adapter: RuntimeAdapter;
  /** transformers.js only: the VRAM_Preflight request, the one place `min_new_tokens` is sent (R9.16). */
  readonly preflight?: { complete(prompt: Prompt, options: RequestOptions, minNewTokens: number): Promise<AdapterResult> };
  load(): Promise<WarmUpResult[]>;
  fingerprint(): JsonObject;
  close(): void;
}

export interface PageDeps {
  readonly gpu: GpuLike | undefined | null;
  readonly userAgent: string;
  readonly clock: TimingClock;
  readonly wallNow: () => number;
  readonly combinations: readonly Combination[];
  readonly warmups: WarmUpPrompts;
  readonly store: KeyValueStore;
  /** Builds the engine runtime of a Combination. Starts no download. */
  readonly makeRuntime: (combo: Combination, warmups: WarmUpPrompts, samplings: { decision: SamplingParams; synthesis: SamplingParams }) => PageRuntime;
  readonly log: (line: string) => void;
}

export interface PromptRun {
  readonly outcome: ExportOutcome;
  readonly latency_ms: number;
  readonly requested_at: string;
  readonly late: Late | null;
}

/** What `runPreflight` returns: the export view of the request, plus whether it ran to the token limit. */
export interface PreflightRun {
  readonly outcome: ExportOutcome;
  readonly latency_ms: number;
  /** True when the adapter reported `truncated`: generation ran to `max_new_tokens` with the EOS stop suppressed. */
  readonly reached_limit: boolean;
}

export interface ColdStartRun {
  readonly slot: 'empty' | 'warm';
  readonly ms: number;
  readonly figures: ColdStartFigures;
}

export interface ProbeStatus {
  readonly combo: string | null;
  readonly engine: 'none' | 'loading' | 'ready' | 'failed';
  readonly adapter: AdapterCheck | null;
  readonly bundle: { readonly run_id: string; readonly requests: number } | null;
  readonly answered: number;
  readonly coldStart: ColdStartFigures;
  readonly error: string | null;
}

/** The API exposed as `window.__probe` (the driver in 16.8 calls it through `page.evaluate`). */
export interface ProbeApi {
  listCombinations(): string[];
  selectCombination(id: string): void;
  /** Requests the WebGPU adapter with the Combination's powerPreference (R9.5, R9.6). */
  checkAdapter(): Promise<AdapterCheck>;
  /** Creates the engine and runs both Warm_Up_Prompts. Starts the model download. Not recorded as cold start. */
  createEngine(): Promise<WarmUpResult[]>;
  /** Download start -> complete raw text of the first Warm_Up answer, in whole ms (R14.4). Leaves the engine ready. */
  coldStart(slot?: 'empty' | 'warm'): Promise<number>;
  /**
   * The Model_Fingerprint fields only the engine adapter knows (`chat_template_kwargs`, `seed`, `constraint_used`,
   * model URLs ...), from `runtime.fingerprint()` (R12.12). Builds the runtime if needed; starts no download.
   */
  fingerprintExtras(): JsonObject;
  /**
   * VRAM_Preflight request (transformers.js, R9.9, R9.16): `maxNewTokens` and `minNewTokens` are both sent, so
   * the end-of-sequence stop is suppressed. Needs a ready engine. No Card is involved.
   */
  runPreflight(prompt: Prompt, options: { maxNewTokens: number; minNewTokens: number; timeoutMs: number }): Promise<PreflightRun>;
  /** One prompt through the adapter; returns the export view of the result. */
  runPrompt(prompt: Prompt, options?: { task?: TaskType; timeoutMs?: number; constraint?: OutputConstraint }): Promise<PromptRun>;
  loadBundle(bundle: unknown): { run_id: string; requests: number };
  runBundle(): Promise<ExportEntry[]>;
  /** The export object (throws until both cold-start figures exist and every request is answered). */
  export(): PageExport;
  exportText(): string;
  resetColdStart(): void;
  status(): ProbeStatus;
}

export function createProbeController(deps: PageDeps): ProbeApi {
  let combo: Combination | null = null;
  let runtime: PageRuntime | null = null;
  let engine: ProbeStatus['engine'] = 'none';
  let adapterCheck: AdapterCheck | null = null;
  let bundle: Bundle | null = null;
  let entries: ExportEntry[] = [];
  let error: string | null = null;

  const need = (): Combination => {
    if (combo === null) throw new Error('no Combination selected: call selectCombination(id) first');
    return combo;
  };
  const power = (c: Combination): PowerPreference => (c['power_preference'] === 'low-power' ? 'low-power' : 'high-performance');
  const fail = (e: unknown): never => {
    error = e instanceof Error ? e.message : String(e);
    deps.log(`[probe] error: ${error}`);
    throw e instanceof Error ? e : new Error(error);
  };

  function select(id: string): void {
    const c = deps.combinations.find((x) => x.id === id);
    if (c === undefined) throw new Error(`unknown Combination "${id}"`);
    adopt(c);
  }

  /** Makes `c` the current Combination; a different one drops the engine of the previous one. */
  function adopt(c: Combination): void {
    if (combo === c) return;
    runtime?.close();
    runtime = null;
    engine = 'none';
    adapterCheck = null;
    entries = [];
    error = null;
    combo = c;
  }

  async function check(): Promise<AdapterCheck> {
    const c = need();
    adapterCheck = await checkAdapter(deps.gpu, power(c));
    deps.log(`[probe] adapter check: ${JSON.stringify(adapterCheck)}`);
    return adapterCheck;
  }

  async function load(): Promise<{ records: WarmUpResult[]; totalMs: number }> {
    const c = need();
    const gate = adapterCheck ?? (await check());
    if (!gate.ok) throw new Error(`${gate.code}: ${gate.detail}`);
    runtime?.close();
    runtime = deps.makeRuntime(c, deps.warmups, warmupSamplings(c));
    engine = 'loading';
    error = null;
    const t0 = deps.clock.now();
    try {
      const records = await runtime.load();
      const totalMs = deps.clock.now() - t0;
      engine = 'ready';
      return { records, totalMs };
    } catch (e) {
      engine = 'failed';
      return fail(e);
    }
  }

  function mapRuntime(): { rt: PageRuntime; c: Combination } {
    const c = need();
    if (runtime === null || engine !== 'ready') throw new Error('engine not ready: call coldStart() or createEngine() first');
    return { rt: runtime, c };
  }

  return {
    listCombinations: () => deps.combinations.map((c) => c.id),
    selectCombination: select,
    checkAdapter: check,
    async createEngine() {
      return (await load()).records;
    },
    async coldStart(slot) {
      const c = need();
      const { records, totalMs } = await load();
      // load() = create + decision warm-up + synthesis warm-up. Cold start stops at the complete first
      // answer, so the second warm-up's latency is taken off.
      const second = records[1]?.latencyMs ?? 0;
      const ms = wholeMs(totalMs - second);
      const r = recordColdStart(deps.store, c.id, ms, slot);
      deps.log(`[probe] cold start (${r.slot}-cache): ${ms} ms`);
      return ms;
    },
    fingerprintExtras() {
      const c = need();
      // A runtime that is created and never loaded starts no download; it is dropped without a close.
      return deps.makeRuntime(c, deps.warmups, warmupSamplings(c)).fingerprint();
    },
    async runPreflight(prompt, options) {
      const { rt, c } = mapRuntime();
      if (rt.preflight === undefined) throw new Error(`the ${c.runtime} runtime has no VRAM_Preflight request`);
      const base = samplingForCombo(c, 'synthesis', { kind: 'none' });
      const result = await rt.preflight.complete(prompt, { timeoutMs: options.timeoutMs, sampling: { ...base, maxOutputTokens: options.maxNewTokens } }, options.minNewTokens);
      const parts = await toExportParts(result);
      return { outcome: parts.outcome, latency_ms: parts.latency_ms, reached_limit: result.kind === 'error' && result.code === 'truncated' };
    },
    async runPrompt(prompt, options = {}) {
      const { rt, c } = mapRuntime();
      const timeoutMs = options.timeoutMs ?? bundle?.timeout_ms ?? 10_000;
      return runOne({ adapter: rt.adapter, wallNow: deps.wallNow, combo: c, timeoutMs }, prompt, options.task ?? 'decision', options.constraint ?? { kind: 'none' });
    },
    loadBundle(v) {
      const b = checkBundleShape(v);
      adopt(b.combination); // the bundle's Combination (its pins) is the one that runs
      bundle = b;
      entries = [];
      return { run_id: b.run_id, requests: b.requests.length };
    },
    async runBundle() {
      const b = bundle;
      if (b === null) throw new Error('no bundle loaded: call loadBundle(bundle) first');
      const { rt } = mapRuntime();
      entries = [];
      try {
        entries = await runBundleEntries(b, { adapter: rt.adapter, wallNow: deps.wallNow }, (done, total) => deps.log(`[probe] answered ${done}/${total}`));
      } catch (e) {
        return fail(e);
      }
      return [...entries];
    },
    export: exportObject,
    exportText() {
      return `${JSON.stringify(exportObject(), null, 2)}\n`;
    },
    resetColdStart() {
      clearColdStart(deps.store, need().id);
    },
    status: () => ({
      combo: combo?.id ?? null,
      engine,
      adapter: adapterCheck,
      bundle: bundle === null ? null : { run_id: bundle.run_id, requests: bundle.requests.length },
      answered: entries.length,
      coldStart: combo === null ? { empty_cache_ms: null, warm_cache_ms: null } : readColdStart(deps.store, combo.id),
      error,
    }),
  };

  function exportObject(): PageExport {
    const b = bundle;
    if (b === null) throw new Error('no bundle loaded');
    const { rt, c } = mapRuntime();
    const facts = adapterCheck?.info;
    if (facts === undefined || facts === null) throw new Error('adapter info missing: call checkAdapter() first');
    const fingerprint = buildPageFingerprint({
      combo: c,
      identity: rt.adapter.identity(),
      runtimeFingerprint: rt.fingerprint(),
      adapter: facts,
      powerPreference: power(c),
      userAgent: deps.userAgent,
      templateHashes: b.template_hashes,
      pinnedManifestHash: b.pinned_manifest_hash,
    });
    return buildPageExport({ bundle: b, fingerprint, coldStart: readColdStart(deps.store, c.id), entries });
  }
}
