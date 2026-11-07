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

/** `session_options` exactly as the design fixes them (placement logging, WebGPU only). */
export const TRANSFORMERS_SESSION_OPTIONS = Object.freeze({
  executionProviders: Object.freeze(['webgpu']) as readonly string[],
  logSeverityLevel: 0,
  logVerbosityLevel: 0,
});

export interface TransformersLoadConfig {
  revision: string;
  device: 'webgpu';
  dtype: 'q4';
  session_options: { executionProviders: string[]; logSeverityLevel: number; logVerbosityLevel: number };
  /** The loader sets `env.backends.onnx.logLevel` to this before `from_pretrained`. */
  onnxLogLevel: 'verbose';
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
  dispose(): void | Promise<void>;
}

/** The page entry implements this with `from_pretrained` for tokenizer and model. */
export type TransformersLoader = (modelId: string, config: TransformersLoadConfig) => Promise<TransformersLoaded>;

/** Optional (DA-6): builds a logits processor from a JSON Schema. Experimental, so it is opt-in. */
export type StructuredOutputFactory = (schema: unknown) => unknown;

export const TRANSFORMERS_QUANTIZATION = 'q4';

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
      loaded = await deps.loader(deps.model.modelId, buildLoadConfig(deps.model.revision));
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
    fingerprint: () => {
      const so = deps.structuredOutput;
      return {
        chat_template_kwargs: chatTemplateKwargs(deps.model.enableThinkingArg),
        seed: null,
        device: loadConfig.device,
        dtype: loadConfig.dtype,
        session_options: JSON.parse(JSON.stringify(loadConfig.session_options)) as JsonObject,
        // The constraint each task actually used, not the one requested (R9.14).
        constraint_used: { decision: effectiveConstraint(deps.samplings.decision), synthesis: effectiveConstraint(deps.samplings.synthesis) },
        structured_output_package: so === undefined ? null : `${so.packageName}@${so.packageVersion}`,
      };
    },
    loadConfig: () => loadConfig,
    close: () => lifecycleEngine.dispose(),
  };
}
