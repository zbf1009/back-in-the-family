// The REAL engines of the Probe_Page (llm-probe task 16.7; R9.7, R9.15, R10.6). This is the only page
// module that imports `@mlc-ai/web-llm` and `@huggingface/transformers`; both are loaded with a
// dynamic import() the first time an engine is created, so a page that only checks the adapter
// downloads no runtime code. Engines run on the page's main thread (design: byte counting, R14.5).
//
// Nothing here can run offline: the unit tests cover the adapters (src/adapters/*) and the page
// logic (probe-core.ts) with fakes. These two wrappers are exercised for the first time by the
// VRAM_Preflight (transformers.js) and the first Dev_Run (WebLLM); see the task 16.7 report.
import {
  createTransformersRuntime,
  pinHubUrl,
  type TransformersGenerateParams,
  type TransformersLoadConfig,
  type TransformersLoaded,
  type TransformersLoader,
  type TransformersPlacementProbe,
} from '../src/adapters/transformers.ts';
import { createWebLlmRuntime, type WebLlmEngineFactory, type WebLlmEngineLike } from '../src/adapters/webllm.ts';
import type { Combination } from '../src/phase.ts';
import type { PageRuntime } from './probe-core.ts';

/** `performance.now()` and `setTimeout`, the clock the timing state machine takes. */
export const browserClock = {
  now: (): number => performance.now(),
  setTimer: (ms: number, fn: () => void): (() => void) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** Versions of the two engines, fixed at build time from package.json by vite.config.ts. */
export interface EngineVersions {
  readonly webllm: string;
  readonly transformers: string;
}

// ---------------------------------------------------------------- WebLLM

/** `CreateMLCEngine(modelId, { appConfig })` with the Combination's single pinned model record. */
export const webLlmFactory: WebLlmEngineFactory = async (modelId, config) => {
  const webllm = await import('@mlc-ai/web-llm');
  const engine = await webllm.CreateMLCEngine(modelId, {
    // The record is the prebuilt-entry shape (model, model_id, model_lib, vram_required_MB, overrides).
    appConfig: config.appConfig as unknown as NonNullable<Parameters<typeof webllm.CreateMLCEngine>[1]>['appConfig'],
    initProgressCallback: (p) => console.log(`[probe] webllm load: ${p.text}`),
  });
  return engine as unknown as WebLlmEngineLike;
};

// ---------------------------------------------------------------- transformers.js

type Tf = typeof import('@huggingface/transformers');

/** Global ONNX Runtime setup before any session: verbose env log level, revision-pinned `env.fetch`. */
async function setUp(modelId: string, config: TransformersLoadConfig): Promise<Tf> {
  const tf = await import('@huggingface/transformers');
  tf.env.backends.onnx.logLevel = config.onnxLogLevel;
  // Pin the library's revision-less metadata probes to the pinned revision (see pinHubUrl).
  const baseFetch = globalThis.fetch.bind(globalThis);
  tf.env.fetch = (input: string | URL, init?: RequestInit) => baseFetch(pinHubUrl(String(input), modelId, config.revision), init);
  return tf;
}

/** `from_pretrained` of the model with the given session options; collects the files it read (progress callback). */
async function loadModel(tf: Tf, modelId: string, config: TransformersLoadConfig, sessionOptions: TransformersLoadConfig['session_options']) {
  const files = new Set<string>();
  // The design says "the model class named on the model card"; AutoModelForCausalLM maps the text path
  // of each candidate (the VRAM_Preflight records the files it read).
  const model = await tf.AutoModelForCausalLM.from_pretrained(modelId, {
    revision: config.revision,
    device: config.device,
    dtype: config.dtype,
    session_options: sessionOptions as never, // plain numbers; the d.ts wants the 0..4 literal union
    progress_callback: (p: { status?: string; file?: string }) => {
      if ((p.status === 'initiate' || p.status === 'done') && typeof p.file === 'string') files.add(p.file);
    },
  } as never);
  return { model, files: [...files].sort() };
}

/**
 * Step 1 of the two-session method (design: Placement detection, 2026-11-07): create the model's sessions with
 * `placement_session_options` (severity 0), so ONNX Runtime prints its "Node placements" block to the console where
 * the driver reads it; run nothing; release the sessions.
 */
export const transformersPlacementProbe: TransformersPlacementProbe = async (modelId, config) => {
  const tf = await setUp(modelId, config);
  const { model, files } = await loadModel(tf, modelId, config, config.placement_session_options);
  await model.dispose();
  console.log(`[probe] placement session released (${files.length} files)`);
  return { files };
};

/** Step 2: tokenizer and the measured model (quiet `session_options`), from the browser cache after step 1. */
export const transformersLoader: TransformersLoader = async (modelId: string, config: TransformersLoadConfig): Promise<TransformersLoaded> => {
  const tf = await setUp(modelId, config);
  const tokenizer = await tf.AutoTokenizer.from_pretrained(modelId, { revision: config.revision });
  const { model, files } = await loadModel(tf, modelId, config, config.session_options);
  const stopping = new tf.InterruptableStoppingCriteria();

  return {
    tokenizer: {
      apply_chat_template: (messages, options) => tokenizer.apply_chat_template(messages, options) as unknown as string,
    },
    stoppingCriteria: stopping,
    facts: { files },
    async generate(text: string, params: TransformersGenerateParams) {
      // The template text already carries the special tokens, so none are added.
      const inputs = tokenizer(text, { add_special_tokens: false }) as { input_ids: { dims: number[] } };
      const inputLength = inputs.input_ids.dims[1] ?? 0;
      const generated = (await model.generate({
        ...inputs,
        do_sample: params.do_sample,
        max_new_tokens: params.max_new_tokens,
        ...(params.min_new_tokens !== undefined ? { min_new_tokens: params.min_new_tokens } : {}),
        stopping_criteria: params.stopping_criteria as unknown as InstanceType<typeof tf.InterruptableStoppingCriteria>,
        ...(params.logits_processor !== undefined ? { logits_processor: params.logits_processor } : {}),
      } as never)) as InstanceType<typeof tf.Tensor>;
      // Decode only the new tokens: slice the prompt off the returned sequence.
      const fresh = generated.slice(null, [inputLength, null] as unknown as [number, number]);
      const decoded = tokenizer.batch_decode(fresh, { skip_special_tokens: true });
      return { text: decoded[0] ?? '', inputTokens: inputLength, outputTokens: fresh.dims[1] ?? 0 };
    },
    dispose: async () => {
      await model.dispose();
    },
  };
};

// ---------------------------------------------------------------- runtime of a Combination

const asStringRecord = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Builds the engine runtime for an in-browser Combination (starts no download; `load()` does). */
export const makeRuntime =
  (versions: EngineVersions): import('./probe-core.ts').PageDeps['makeRuntime'] =>
  (combo: Combination, warmups, samplings): PageRuntime => {
    if (combo.runtime === 'webllm') {
      const size = asStringRecord(combo['size']);
      const vram = typeof size?.['vram_mib'] === 'number' ? Math.ceil(size['vram_mib']) : 0;
      return createWebLlmRuntime({
        factory: webLlmFactory,
        model: {
          modelId: combo.model_id,
          revision: combo.revision,
          modelLibUrl: typeof combo['model_lib_url'] === 'string' ? combo['model_lib_url'] : '',
          vramRequiredMB: vram,
          quantization: combo.quantization,
          runtimeVersion: versions.webllm,
        },
        clock: browserClock,
        warmups,
        samplings,
      });
    }
    if (combo.runtime === 'transformers.js') {
      const kwargs = asStringRecord(combo['chat_template_kwargs']);
      return createTransformersRuntime({
        loader: transformersLoader,
        placementProbe: transformersPlacementProbe,
        model: {
          modelId: combo.model_id,
          revision: combo.revision,
          enableThinkingArg: kwargs !== null && 'enable_thinking' in kwargs,
          runtimeVersion: versions.transformers,
        },
        clock: browserClock,
        warmups,
        samplings,
      });
    }
    throw new Error(`the Probe_Page runs in-browser Combinations only, not "${combo.runtime}"`);
  };
