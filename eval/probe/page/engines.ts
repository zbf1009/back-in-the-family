// The REAL engines of the Probe_Page (llm-probe task 16.7; R9.7, R9.15, R10.6). This is the only page
// module that imports `@mlc-ai/web-llm` and `@huggingface/transformers`; both are loaded with a
// dynamic import() the first time an engine is created, so a page that only checks the adapter
// downloads no runtime code. Engines run on the page's main thread (design: byte counting, R14.5).
//
// Nothing here can run offline: the unit tests cover the adapters (src/adapters/*) and the page
// logic (probe-core.ts) with fakes. These two wrappers are exercised for the first time by the
// VRAM_Preflight (transformers.js) and the first Dev_Run (WebLLM); see the task 16.7 report.
import { createTransformersRuntime, type TransformersGenerateParams, type TransformersLoadConfig, type TransformersLoaded, type TransformersLoader } from '../src/adapters/transformers.ts';
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

/**
 * `from_pretrained` for tokenizer and model. Sets ONNX Runtime's log level to verbose BEFORE the first
 * `from_pretrained`, so ORT prints its "Node placements" block to the console, where the driver reads it
 * (design: Placement detection). The block is whatever ORT-web prints; it is not re-logged here.
 */
export const transformersLoader: TransformersLoader = async (modelId: string, config: TransformersLoadConfig): Promise<TransformersLoaded> => {
  const tf = await import('@huggingface/transformers');
  tf.env.backends.onnx.logLevel = config.onnxLogLevel;
  const tokenizer = await tf.AutoTokenizer.from_pretrained(modelId, { revision: config.revision });
  // The design says "the model class named on the model card"; AutoModelForCausalLM maps the text path
  // of each candidate (confirmed by the VRAM_Preflight, the first run that loads one).
  const model = await tf.AutoModelForCausalLM.from_pretrained(modelId, {
    revision: config.revision,
    device: config.device,
    dtype: config.dtype,
    session_options: config.session_options as never, // plain numbers; the d.ts wants the 0..4 literal union
  });
  const stopping = new tf.InterruptableStoppingCriteria();

  return {
    tokenizer: {
      apply_chat_template: (messages, options) => tokenizer.apply_chat_template(messages, options) as unknown as string,
    },
    stoppingCriteria: stopping,
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
