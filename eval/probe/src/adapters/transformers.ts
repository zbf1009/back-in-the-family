// transformers.js Runtime_Adapter (design: "In-browser adapters" transformers.js bullet, "Placement
// detection", "Warm-up"; R9.1, R9.7, R9.12, R9.14, R9.16, R12.12).
//
// The adapter talks to a structural view of a loaded tokenizer + model (`TransformersLoaded`), so
// it runs unchanged on the Probe_Page and in Node unit tests with a fake. `@huggingface/transformers`
// is NOT imported here: the page entry (task 16.7) passes a loader that calls `from_pretrained`
// and sets `env.backends.onnx.logLevel`. ONNX Runtime's placement log lines are captured by the
// browser driver from the page console and parsed by placement.ts; this adapter only sets the
// session options that make ORT print them.
//
// `min_new_tokens` is sent ONLY by the VRAM_Preflight (R9.16) through `preflight.complete`; the
// normal `adapter.complete` path cannot set it.
import type { JsonObject } from '../results.ts';
import type {
  AdapterResult,
  AdapterState,
  Prompt,
  RequestOptions,
  RuntimeAdapter,
  RuntimeIdentity,
  SamplingParams,
  Usage,
} from './interface.ts';
import { createEngineWithWarmUp, rebuildEngineWithWarmUp, type LifecycleEngine, type WarmUpPrompts } from './lifecycle.ts';
import { createTimedRunner, type TimedEngine, type TimedRunner, type TimingClock } from './timing.ts';
import { stripPattern } from './webllm.ts';

// ---------------------------------------------------------------- structural transformers.js view

/**
 * Placement detection with two sessions (task 19.3 / V6, Author 2026-11-07). At `logSeverityLevel` 0 ONNX Runtime
 * prints its "Node placements" block, but the session logger also logs every WebGPU dispatch ("Starting program",
 * info level), which flooded the console (~848k lines in 14 min) and stalled generation. So the model is first
 * created with the PLACEMENT options only to log the placement, released without any inference, then created
 * again with the MEASURED options. The two differ ONLY in the two log fields.
 */
export const TRANSFORMERS_PLACEMENT_SESSION_OPTIONS = Object.freeze({
  executionProviders: Object.freeze(['webgpu']) as readonly string[],
  logSeverityLevel: 0,
  logVerbosityLevel: 0,
});
/** The session that is warmed up, generates and is measured: warnings and errors only. */
export const TRANSFORMERS_SESSION_OPTIONS = Object.freeze({
  executionProviders: Object.freeze(['webgpu']) as readonly string[],
  logSeverityLevel: 2,
  logVerbosityLevel: 0,
});

export type SessionOptions = { executionProviders: string[]; logSeverityLevel: number; logVerbosityLevel: number };

export interface TransformersLoadConfig {
  revision: string;
  device: 'webgpu';
  dtype: 'q4';
  /** The measured session. */
  session_options: SessionOptions;
  /** The placement-only session: `session_options` with the log fields at verbose. */
  placement_session_options: SessionOptions;
  /** The loader sets `env.backends.onnx.logLevel` to this before the first `from_pretrained`. */
  onnxLogLevel: 'verbose';
}

/** Everything that decides the graph partition, i.e. the session options without the two log fields. */
export function partitionOptions(o: SessionOptions): JsonObject {
  const { logSeverityLevel: _s, logVerbosityLevel: _v, ...rest } = o;
  return JSON.parse(JSON.stringify(rest)) as JsonObject;
}

/** What one `from_pretrained` of the model actually loaded (files from the progress callback). */
export interface ModelLoadFacts {
  /** Model files (`onnx/...`, `config.json` ...) the load read, sorted, without duplicates. */
  files: string[];
}

/**
 * The hash the two sessions are compared by: model, revision, device, dtype, partition-relevant session options
 * and the files loaded. sha256 hex of the canonical JSON (keys sorted).
 */
export async function placementKeyHash(i: { modelId: string; revision: string; device: string; dtype: string; options: SessionOptions; files: readonly string[] }): Promise<string> {
  const canon = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
    : JSON.stringify(v);
  const text = canon({ model_id: i.modelId, revision: i.revision, device: i.device, dtype: i.dtype, session_options: partitionOptions(i.options), files: [...new Set(i.files)].sort() });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ChatTemplateOptions {
  add_generation_prompt: true;
  tokenize: false;
  /** Present (false) for Qwen3.5 only; absent for LFM2.5, whose template does not use it. */
  enable_thinking?: false;
}

export interface TransformersTokenizerLike {
  apply_chat_template(messages: { role: 'system' | 'user'; content: string }[], options: ChatTemplateOptions): string;
}

/** `InterruptableStoppingCriteria`-like: the timing timer calls `interrupt()`. */
export interface InterruptableLike {
  interrupt(): void;
  reset(): void;
}

export interface TransformersGenerateParams {
  do_sample: false;
  max_new_tokens: number;
  /** Set only by the VRAM_Preflight (R9.16); absent in every other request. */
  min_new_tokens?: number;
  stopping_criteria: InterruptableLike;
  /** Opaque logits processor from the optional structured-output package; absent for `none`. */
  logits_processor?: unknown;
}

export interface TransformersLoaded {
  tokenizer: TransformersTokenizerLike;
  /** Tokenizes `text`, runs `model.generate`, decodes only the new tokens. */
  generate(text: string, params: TransformersGenerateParams): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  stoppingCriteria: InterruptableLike;
  /** What the model load read. */
  facts: ModelLoadFacts;
  dispose(): void | Promise<void>;
}

/** Creates the model's sessions with `placement_session_options`, runs nothing, releases them. */
export type TransformersPlacementProbe = (modelId: string, config: TransformersLoadConfig) => Promise<ModelLoadFacts>;

/** The page entry implements this with `from_pretrained` for tokenizer and model. */
export type TransformersLoader = (modelId: string, config: TransformersLoadConfig) => Promise<TransformersLoaded>;

/** Optional (DA-6): builds a logits processor from a JSON Schema. Experimental, so it is opt-in. */
export type StructuredOutputFactory = (schema: unknown) => unknown;

export const TRANSFORMERS_QUANTIZATION = 'q4';

/**
 * transformers.js 4.3.2 probes `tokenizer_config.json` (and the image processor config) with a Range request that
 * ignores `revision` and goes to `/resolve/main/` (`get_tokenizer_files`, `get_processor_files`). The page's
 * `env.fetch` passes every URL through this, so those probes ask for the pinned revision too (R9.15). Only
 * `huggingface.co/<modelId>/resolve/main/` URLs change.
 */
export function pinHubUrl(url: string, modelId: string, revision: string): string {
  const prefix = `https://huggingface.co/${modelId}/resolve/main/`;
  return url.startsWith(prefix) ? `https://huggingface.co/${modelId}/resolve/${revision}/${url.slice(prefix.length)}` : url;
}

export function buildLoadConfig(revision: string): TransformersLoadConfig {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error(`transformers: revision must be a 40-hex commit sha, got "${revision}"`);
  return {
    revision,
    device: 'webgpu',
    dtype: TRANSFORMERS_QUANTIZATION,
    session_options: {
      executionProviders: [...TRANSFORMERS_SESSION_OPTIONS.executionProviders],
      logSeverityLevel: TRANSFORMERS_SESSION_OPTIONS.logSeverityLevel,
      logVerbosityLevel: TRANSFORMERS_SESSION_OPTIONS.logVerbosityLevel,
    },
    placement_session_options: {
      executionProviders: [...TRANSFORMERS_PLACEMENT_SESSION_OPTIONS.executionProviders],
      logSeverityLevel: TRANSFORMERS_PLACEMENT_SESSION_OPTIONS.logSeverityLevel,
      logVerbosityLevel: TRANSFORMERS_PLACEMENT_SESSION_OPTIONS.logVerbosityLevel,
    },
    onnxLogLevel: 'verbose',
  };
}

export function buildChatTemplateOptions(enableThinkingArg: boolean): ChatTemplateOptions {
  return enableThinkingArg
    ? { add_generation_prompt: true, enable_thinking: false, tokenize: false }
    : { add_generation_prompt: true, tokenize: false };
}

export function chatTemplateKwargs(enableThinkingArg: boolean): Record<string, boolean> {
  return enableThinkingArg ? { enable_thinking: false, add_generation_prompt: true } : { add_generation_prompt: true };
}

/**
 * Builds the `generate` parameters. `minNewTokens` is taken ONLY from the explicit preflight
 * option, never from `sampling` (R9.16).
 */
export function buildGenerateParams(
  sampling: SamplingParams,
  stopping: InterruptableLike,
  extra: { preflight?: { minNewTokens: number }; logitsProcessor?: unknown } = {},
): TransformersGenerateParams {
  const p: TransformersGenerateParams = { do_sample: false, max_new_tokens: sampling.maxOutputTokens, stopping_criteria: stopping };
  if (extra.preflight !== undefined) p.min_new_tokens = extra.preflight.minNewTokens;
  if (extra.logitsProcessor !== undefined) p.logits_processor = extra.logitsProcessor;
  return p;
}

// ---------------------------------------------------------------- adapter

export interface TransformersModelSpec {
  /** e.g. `onnx-community/Qwen3.5-0.8B-ONNX` */
  modelId: string;
  /** 40-hex commit sha (Pinned_Revision) */
  revision: string;
  /** true for Qwen3.5 (passes `enable_thinking: false`); false for LFM2.5 (argument absent). */
  enableThinkingArg: boolean;
  runtimeVersion: string;
}

export interface TransformersDeps {
  loader: TransformersLoader;
  /** The placement-only session (two-session method). Absent: `probePlacement()` fails. */
  placementProbe?: TransformersPlacementProbe;
  model: TransformersModelSpec;
  clock: TimingClock;
  warmups: WarmUpPrompts;
  samplings: { decision: SamplingParams; synthesis: SamplingParams };
  /**
   * Optional structured-output path (package pinned in 16.1, experimental). Used only for a request
   * whose `sampling.constraint` is `json_schema`; absent → `none` is used and recorded.
   */
  structuredOutput?: { factory: StructuredOutputFactory; packageName: string; packageVersion: string };
}

export interface TransformersWarmUpRecord {
  task: 'decision' | 'synthesis';
  text: string;
  latencyMs: number;
}

export interface TransformersRuntime {
  readonly adapter: RuntimeAdapter;
  load(): Promise<TransformersWarmUpRecord[]>;
  rebuild(): Promise<TransformersWarmUpRecord[]>;
  readonly lifecycle: { readonly engine: LifecycleEngine; readonly onReady: () => void };
  /** Only the VRAM_Preflight (16.9) uses this; it is the one place `min_new_tokens` is sent. */
  readonly preflight: { complete(prompt: Prompt, options: RequestOptions, minNewTokens: number): Promise<AdapterResult> };
  /**
   * Step 1 of the two-session method: the placement-only session (verbose, no inference, released). Must run
   * before `load()`; `load()` then checks that the measured session has the same placement key hash.
   */
  probePlacement(): Promise<void>;
  fingerprint(): JsonObject;
  loadConfig(): TransformersLoadConfig;
  close(): void;
}

export function createTransformersRuntime(deps: TransformersDeps): TransformersRuntime {
  const loadConfig = buildLoadConfig(deps.model.revision);
  const templateOptions = buildChatTemplateOptions(deps.model.enableThinkingArg);
  let loaded: TransformersLoaded | null = null;
  let interrupted = false;
  let lastTruncated = false;
  let preflightMin: number | null = null;
  let warmRecords: TransformersWarmUpRecord[] | null = null;
  let placementCheck: { probe_sha256: string; measured_sha256: string | null; probe_files: string[]; measured_files: string[] | null } | null = null;

  const keyHash = (options: SessionOptions, files: readonly string[]): Promise<string> =>
    placementKeyHash({ modelId: deps.model.modelId, revision: deps.model.revision, device: loadConfig.device, dtype: loadConfig.dtype, options, files });

  /** What the request actually uses: json_schema only with a factory, else none. */
  const effectiveConstraint = (s: SamplingParams): 'json_schema' | 'none' =>
    s.constraint.kind === 'json_schema' && deps.structuredOutput !== undefined ? 'json_schema' : 'none';

  async function rawGenerate(prompt: Prompt, sampling: SamplingParams): Promise<{ text: string; usage: Usage | null; interrupted: boolean }> {
    const m = loaded;
    if (m === null) throw new Error('transformers model not loaded');
    interrupted = false;
    m.stoppingCriteria.reset();
    const text = m.tokenizer.apply_chat_template(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      { ...templateOptions },
    );
    const extra: { preflight?: { minNewTokens: number }; logitsProcessor?: unknown } = {};
    if (preflightMin !== null) extra.preflight = { minNewTokens: preflightMin };
    if (sampling.constraint.kind === 'json_schema' && deps.structuredOutput !== undefined) {
      extra.logitsProcessor = deps.structuredOutput.factory(stripPattern(sampling.constraint.schema));
    }
    const out = await m.generate(text, buildGenerateParams(sampling, m.stoppingCriteria, extra));
    lastTruncated = !interrupted && out.outputTokens >= sampling.maxOutputTokens;
    return {
      text: out.text,
      usage: { inputTokens: out.inputTokens, outputTokens: out.outputTokens, reasoningTokens: null },
      interrupted,
    };
  }

  const lifecycleEngine: LifecycleEngine = {
    async create() {
      const m = await deps.loader(deps.model.modelId, buildLoadConfig(deps.model.revision));
      if (placementCheck !== null) {
        const measured = await keyHash(loadConfig.session_options, m.facts.files);
        placementCheck = { ...placementCheck, measured_sha256: measured, measured_files: [...new Set(m.facts.files)].sort() };
        if (measured !== placementCheck.probe_sha256) {
          await Promise.resolve(m.dispose()).catch(() => undefined);
          throw new Error(
            `placement_session_mismatch: the measured session differs from the placement session (probe ${placementCheck.probe_sha256.slice(0, 12)}, measured ${measured.slice(0, 12)}; files ${placementCheck.probe_files.join(',')} vs ${placementCheck.measured_files?.join(',')})`,
          );
        }
      }
      loaded = m;
    },
    async generate(prompt, sampling) {
      const t0 = deps.clock.now();
      const r = await rawGenerate(prompt, sampling);
      if (warmRecords !== null) {
        warmRecords.push({
          task: warmRecords.length === 0 ? 'decision' : 'synthesis',
          text: r.text,
          latencyMs: Math.max(0, Math.ceil(deps.clock.now() - t0)),
        });
      }
      return r;
    },
    dispose() {
      const old = loaded;
      loaded = null;
      if (old !== null) void Promise.resolve(old.dispose()).catch(() => undefined);
    },
  };

  const timedEngine: TimedEngine = {
    generate: rawGenerate,
    interrupt() {
      const m = loaded;
      if (m === null) return;
      interrupted = true;
      try {
        m.stoppingCriteria.interrupt();
      } catch {
        // a criterion that throws leaves the engine busy; the Idle_Cap handles it
      }
    },
  };

  const runner: TimedRunner = createTimedRunner(timedEngine, deps.clock);
  const onReady = (): void => runner.reset();

  const lifecycleInput = () => ({
    engine: lifecycleEngine,
    warmups: deps.warmups,
    sampling: deps.samplings.decision,
    synthesisSampling: deps.samplings.synthesis,
    onReady,
  });

  async function withRecords(step: () => Promise<void>): Promise<TransformersWarmUpRecord[]> {
    const records: TransformersWarmUpRecord[] = [];
    warmRecords = records;
    try {
      await step();
    } finally {
      warmRecords = null;
    }
    return records;
  }

  const identity: RuntimeIdentity = {
    runtime: 'transformers.js',
    runtimeVersion: deps.model.runtimeVersion,
    modelId: deps.model.modelId,
    modelRevision: deps.model.revision,
    quantization: TRANSFORMERS_QUANTIZATION,
  };

  async function complete(prompt: Prompt, options: RequestOptions): Promise<AdapterResult> {
    if (loaded === null) {
      return { kind: 'error', code: 'runtime_error', detail: 'transformers model not loaded', elapsedMs: 0, remote: null };
    }
    lastTruncated = false;
    const result = await runner.complete(prompt, options);
    if (result.kind !== 'text') return result;
    if (lastTruncated) {
      return { kind: 'error', code: 'truncated', detail: 'max_new_tokens reached', elapsedMs: result.latencyMs, remote: null };
    }
    if (result.text === '') {
      return { kind: 'error', code: 'empty_content', detail: 'empty decoded output', elapsedMs: result.latencyMs, remote: null };
    }
    return result;
  }

  const adapter: RuntimeAdapter = {
    identity: () => identity,
    state: (): AdapterState => runner.state(),
    complete,
  };

  return {
    adapter,
    load: () => withRecords(() => createEngineWithWarmUp(lifecycleInput())),
    rebuild: () => withRecords(() => rebuildEngineWithWarmUp(lifecycleInput())),
    lifecycle: { engine: lifecycleEngine, onReady },
    preflight: {
      async complete(prompt, options, minNewTokens) {
        if (runner.state() !== 'idle') {
          return { kind: 'error', code: 'runtime_error', detail: 'preflight requires an idle adapter', elapsedMs: 0, remote: null };
        }
        preflightMin = minNewTokens;
        try {
          return await complete(prompt, options);
        } finally {
          preflightMin = null;
        }
      },
    },
    async probePlacement() {
      if (deps.placementProbe === undefined) throw new Error('transformers: no placement probe configured');
      if (loaded !== null) throw new Error('transformers: the placement probe runs before the measured session is created');
      const facts = await deps.placementProbe(deps.model.modelId, buildLoadConfig(deps.model.revision));
      placementCheck = { probe_sha256: await keyHash(loadConfig.placement_session_options, facts.files), measured_sha256: null, probe_files: [...new Set(facts.files)].sort(), measured_files: null };
    },
    fingerprint: () => {
      const so = deps.structuredOutput;
      return {
        chat_template_kwargs: chatTemplateKwargs(deps.model.enableThinkingArg),
        seed: null,
        device: loadConfig.device,
        dtype: loadConfig.dtype,
        session_options: JSON.parse(JSON.stringify(loadConfig.session_options)) as JsonObject,
        placement_session_options: JSON.parse(JSON.stringify(loadConfig.placement_session_options)) as JsonObject,
        placement_check: placementCheck === null ? null : (JSON.parse(JSON.stringify(placementCheck)) as JsonObject),
        // The constraint each task actually used, not the one requested (R9.14).
        constraint_used: { decision: effectiveConstraint(deps.samplings.decision), synthesis: effectiveConstraint(deps.samplings.synthesis) },
        structured_output_package: so === undefined ? null : `${so.packageName}@${so.packageVersion}`,
      };
    },
    loadConfig: () => loadConfig,
    close: () => lifecycleEngine.dispose(),
  };
}
