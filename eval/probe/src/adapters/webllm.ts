// WebLLM Runtime_Adapter (design: "In-browser adapters", revised 2026-11-07 at the v0.2.87 tag;
// R4.15, R9.1, R9.7, R9.12, R9.14, R9.15, R12.12).
//
// The adapter talks to a structural view of the web-llm engine (`WebLlmEngineLike`), so it runs
// unchanged on the Probe_Page and in Node unit tests with a fake. `@mlc-ai/web-llm` is NOT imported
// here: the page entry (task 16.7) passes a factory that calls `CreateMLCEngine`. Warm-up and
// rebuild go through lifecycle.ts, which has no access to any Results writer.
import type { JsonObject } from '../results.ts';
import type {
  AdapterResult,
  AdapterState,
  OutputConstraint,
  Prompt,
  RequestOptions,
  RuntimeAdapter,
  RuntimeIdentity,
  SamplingParams,
  Usage,
} from './interface.ts';
import { createEngineWithWarmUp, rebuildEngineWithWarmUp, type LifecycleEngine, type WarmUpPrompts } from './lifecycle.ts';
import { createTimedRunner, type TimedEngine, type TimedRunner, type TimingClock } from './timing.ts';

// ---------------------------------------------------------------- structural web-llm view

export interface WebLlmChatRequest {
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  max_tokens: number;
  seed?: number;
  /** `schema` is a JSON-ENCODED STRING; web-llm accepts it only with `type: "json_object"`. */
  response_format?: { type: 'json_object'; schema: string };
  extra_body?: { enable_thinking: boolean };
  stream?: false;
}

export interface WebLlmChatResponse {
  choices: { message: { content: string | null }; finish_reason: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface WebLlmEngineLike {
  chat: { completions: { create(request: WebLlmChatRequest): Promise<WebLlmChatResponse> } };
  /** Applies only to the request running now; that request ends with finish_reason "abort". */
  interruptGenerate(): void | Promise<void>;
  unload(): Promise<void>;
}

/** Prebuilt-entry `overrides` that a custom `model_list` entry must repeat. */
export interface WebLlmOverrides {
  context_window_size: number;
  max_history_size: number;
  conv_config: { stop_token_ids: number[] };
}

export interface WebLlmModelRecord {
  /** `https://huggingface.co/mlc-ai/<repo>/resolve/<revision>/` */
  model: string;
  model_id: string;
  /** `raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/<sha>/...` */
  model_lib: string;
  vram_required_MB: number;
  overrides: WebLlmOverrides;
}

export interface WebLlmEngineConfig {
  appConfig: { model_list: WebLlmModelRecord[] };
}

/** The page entry implements this with `CreateMLCEngine(modelId, config)`. */
export type WebLlmEngineFactory = (modelId: string, config: WebLlmEngineConfig) => Promise<WebLlmEngineLike>;

/** Copied from the prebuilt entries of both Qwen3.5 sizes (config.ts:1380-1384, 1425-1429). */
export const QWEN35_OVERRIDES: Readonly<WebLlmOverrides> = Object.freeze({
  context_window_size: 4096,
  max_history_size: 1,
  conv_config: Object.freeze({ stop_token_ids: [248046, 248044] }) as { stop_token_ids: number[] },
});

export const WEBLLM_SEED = 20261104;
/** What the fingerprint records for the template arguments WebLLM maps to (R9.14). */
export const WEBLLM_CHAT_TEMPLATE_KWARGS = Object.freeze({ enable_thinking: false, add_generation_prompt: true });

// ---------------------------------------------------------------- schema handling

/** XGrammar rejects JSON Schema `pattern`; remove it everywhere (design B6). Pure, input untouched. */
export function stripPattern(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripPattern);
  if (typeof schema === 'object' && schema !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'pattern' && typeof v === 'string') continue;
      out[k] = stripPattern(v);
    }
    return out;
  }
  return schema;
}

/** Builds the web-llm request body for one prompt (exported for tests and the page). */
export function buildChatRequest(prompt: Prompt, sampling: SamplingParams): WebLlmChatRequest {
  const request: WebLlmChatRequest = {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: sampling.temperature,
    max_tokens: sampling.maxOutputTokens,
    extra_body: { enable_thinking: sampling.chatTemplateKwargs?.['enable_thinking'] === true },
    stream: false,
  };
  if (sampling.seed !== null) request.seed = sampling.seed;
  const c: OutputConstraint = sampling.constraint;
  if (c.kind === 'json_schema') request.response_format = { type: 'json_object', schema: JSON.stringify(stripPattern(c.schema)) };
  return request;
}

// ---------------------------------------------------------------- adapter

export interface WebLlmModelSpec {
  /** e.g. `Qwen3.5-0.8B-q4f32_1-MLC` */
  modelId: string;
  /** Hugging Face repository, default `mlc-ai/<modelId>` */
  repo?: string;
  /** 40-hex commit sha (Pinned_Revision) */
  revision: string;
  modelLibUrl: string;
  vramRequiredMB: number;
  quantization: string;
  overrides?: WebLlmOverrides;
  runtimeVersion: string;
}

export interface WebLlmDeps {
  factory: WebLlmEngineFactory;
  model: WebLlmModelSpec;
  clock: TimingClock;
  warmups: WarmUpPrompts;
  /** D and S sampling of the run, used by the warm-ups (R9.12). */
  samplings: { decision: SamplingParams; synthesis: SamplingParams };
}

/** Warm-up output, for perf.ts only (cold start, R14.4). Never a Results record. */
export interface WarmUpRecord {
  task: 'decision' | 'synthesis';
  text: string;
  latencyMs: number;
}

export interface WebLlmRuntime {
  readonly adapter: RuntimeAdapter;
  /** Create the engine and run both warm-ups; resets the timing machine. */
  load(): Promise<WarmUpRecord[]>;
  /** Dispose, create again, run both warm-ups (after an Idle_Cap hit). */
  rebuild(): Promise<WarmUpRecord[]>;
  /** For `RuntimeHandle.lifecycle`. */
  readonly lifecycle: { readonly engine: LifecycleEngine; readonly onReady: () => void };
  /** Merged over the fingerprint defaults by run.ts. */
  fingerprint(): JsonObject;
  modelRecord(): WebLlmModelRecord;
  close(): void;
}

const HEX40 = /^[0-9a-f]{40}$/;

export function buildModelRecord(spec: WebLlmModelSpec): WebLlmModelRecord {
  if (!HEX40.test(spec.revision)) throw new Error(`webllm: revision must be a 40-hex commit sha, got "${spec.revision}"`);
  if (spec.modelLibUrl === '') throw new Error('webllm: model_lib_url is required');
  const repo = spec.repo ?? `mlc-ai/${spec.modelId}`;
  const o = spec.overrides ?? QWEN35_OVERRIDES;
  return {
    model: `https://huggingface.co/${repo}/resolve/${spec.revision}/`,
    model_id: spec.modelId,
    model_lib: spec.modelLibUrl,
    vram_required_MB: spec.vramRequiredMB,
    overrides: {
      context_window_size: o.context_window_size,
      max_history_size: o.max_history_size,
      conv_config: { stop_token_ids: [...o.conv_config.stop_token_ids] },
    },
  };
}

export function createWebLlmRuntime(deps: WebLlmDeps): WebLlmRuntime {
  const record = buildModelRecord(deps.model);
  let engine: WebLlmEngineLike | null = null;
  let lastFinish: string | null = null;
  let warmRecords: WarmUpRecord[] | null = null;

  async function rawGenerate(prompt: Prompt, sampling: SamplingParams): Promise<{ text: string; usage: Usage | null; interrupted: boolean }> {
    const e = engine;
    if (e === null) throw new Error('webllm engine not created');
    const response = await e.chat.completions.create(buildChatRequest(prompt, sampling));
    const choice = response.choices[0];
    const finish = choice?.finish_reason ?? null;
    lastFinish = finish;
    const u = response.usage;
    const usage: Usage | null =
      u !== undefined && u !== null && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number'
        ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, reasoningTokens: null }
        : null;
    return { text: choice?.message.content ?? '', usage, interrupted: finish === 'abort' };
  }

  const lifecycleEngine: LifecycleEngine = {
    async create() {
      engine = await deps.factory(deps.model.modelId, { appConfig: { model_list: [record] } });
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
      const old = engine;
      engine = null;
      if (old !== null) void old.unload().catch(() => undefined);
    },
  };

  const timedEngine: TimedEngine = {
    generate: rawGenerate,
    interrupt() {
      const e = engine;
      if (e === null) return;
      try {
        void Promise.resolve(e.interruptGenerate()).catch(() => undefined);
      } catch {
        // an engine that throws on interrupt stays busy; the Idle_Cap handles it
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

  async function withRecords(step: () => Promise<void>): Promise<WarmUpRecord[]> {
    const records: WarmUpRecord[] = [];
    warmRecords = records;
    try {
      await step();
    } finally {
      warmRecords = null;
    }
    return records;
  }

  const identity: RuntimeIdentity = {
    runtime: 'webllm',
    runtimeVersion: deps.model.runtimeVersion,
    modelId: deps.model.modelId,
    modelRevision: deps.model.revision,
    quantization: deps.model.quantization,
  };

  const adapter: RuntimeAdapter = {
    identity: () => identity,
    state: (): AdapterState => runner.state(),
    async complete(prompt: Prompt, options: RequestOptions): Promise<AdapterResult> {
      if (engine === null) {
        return { kind: 'error', code: 'runtime_error', detail: 'webllm engine not created', elapsedMs: 0, remote: null };
      }
      lastFinish = null;
      const result = await runner.complete(prompt, options);
      if (result.kind !== 'text') return result;
      // Outcome mapping (as for the chat shape in the design): length → truncated, checked first;
      // empty content → empty_content.
      if (lastFinish === 'length') {
        return { kind: 'error', code: 'truncated', detail: 'finish_reason length', elapsedMs: result.latencyMs, remote: null };
      }
      if (result.text === '') {
        return { kind: 'error', code: 'empty_content', detail: 'empty message content', elapsedMs: result.latencyMs, remote: null };
      }
      return result;
    },
  };

  return {
    adapter,
    load: () => withRecords(() => createEngineWithWarmUp(lifecycleInput())),
    rebuild: () => withRecords(() => rebuildEngineWithWarmUp(lifecycleInput())),
    lifecycle: { engine: lifecycleEngine, onReady },
    fingerprint: () => ({
      chat_template_kwargs: { ...WEBLLM_CHAT_TEMPLATE_KWARGS },
      seed: deps.samplings.decision.seed,
      model_url: record.model,
      model_lib_url: record.model_lib,
      vram_required_mb: record.vram_required_MB,
      overrides: JSON.parse(JSON.stringify(record.overrides)) as JsonObject,
    }),
    modelRecord: () => record,
    close: () => lifecycleEngine.dispose(),
  };
}
