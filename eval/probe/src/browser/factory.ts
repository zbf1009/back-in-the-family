// RuntimeFactory and FreshProfileHook for in-browser Combinations (llm-probe task 16.8). Builds the
// `RuntimeHandle` that run.ts drives, backed by one `BrowserSession` per run:
//   createRuntime   makes the session and the handle. Opens nothing: no Chrome, no server, no request.
//   freshProfile    run.ts step 6: launch Chrome on the Fresh_Profile, check the WebGPU adapter, check the
//                   storage quota. Sends no Runtime request, so a failure leaves the ledger untouched. For a
//                   Locked_Run the ledger `start` entry is written by run.ts right AFTER this hook and BEFORE
//                   `handle.load`, which is the first thing that downloads a model or sends a prompt.
//   handle.load     run.ts step 8: cold starts (empty cache, reload, warm cache) and the Warm_Up_Prompts.
//   handle.adapter  sends each prompt through `page.evaluate(window.__probe.runPrompt(...))`.
//   handle.lifecycle  rebuild after an Idle_Cap hit: page reload, engine create, both Warm_Up_Prompts.
//   handle.finish   stops the memory measurement after the last Card request and returns the final perf.
//   handle.close    closes Chrome and the server and deletes the Fresh_Profile.
import type { AdapterResult, AdapterState, LateAnswer, Prompt, RequestOptions, RuntimeAdapter, RuntimeIdentity } from '../adapters/interface.ts';
import type { LifecycleEngine } from '../adapters/lifecycle.ts';
import { WEBLLM_PLACEMENT, type Placement } from '../adapters/placement.ts';
import type { Combination } from '../phase.ts';
import type { JsonObject, Placement as ResultsPlacement } from '../results.ts';
import { RuntimeLoadError, type FreshProfileHook, type FreshProfileResult, type RuntimeContext, type RuntimeFactory, type RuntimeHandle } from '../run.ts';
import { BrowserLoadError, BrowserSession, HEADLESS_LAUNCH_FLAGS, browserVersionOf, powerPreferenceOf, type PromptRunView, type SessionDeps, type WarmUpView } from './driver.ts';

export interface EngineVersions {
  readonly webllm: string;
  readonly transformers: string;
}

export interface BrowserRuntimeOptions {
  /** Called lazily, the first time a session starts. Tests give fakes; the CLI gives `realSessionDeps`. */
  readonly sessionDeps: () => Promise<SessionDeps>;
  readonly engineVersions: EngineVersions;
  /** Used for `failed_at` style timestamps in failure objects. Milliseconds since the epoch. */
  readonly wallNow?: () => number;
}

export const isInBrowser = (combo: Combination): boolean => combo.runtime === 'webllm' || combo.runtime === 'transformers.js';

/**
 * The page cannot tell a Card's task type from a prompt. Run.ts hands the adapter the sampling it chose for
 * the task; the decision sampling is recognised by its output limit, anything else is synthesis.
 */
export function taskOfSampling(ctx: Pick<RuntimeContext, 'samplings'>, options: RequestOptions): 'decision' | 'synthesis' {
  return options.sampling.maxOutputTokens === ctx.samplings.decision.maxOutputTokens ? 'decision' : 'synthesis';
}

/** Page result -> AdapterResult. A timeout whose late marker is `idle_cap` leaves the engine stuck. */
export function toAdapterResult(view: PromptRunView, timeoutMs: number): { result: AdapterResult; stuck: boolean } {
  const o = view.outcome;
  if (o.kind === 'text') return { result: { kind: 'text', text: o.text, latencyMs: view.latency_ms, usage: null }, stuck: false };
  if (o.kind === 'timeout') {
    const late: LateAnswer =
      view.late !== null && view.late.kind === 'late'
        ? { kind: 'late', text: view.late.text, latencyMs: view.late.latency_ms }
        : { kind: 'none', reason: view.late !== null && view.late.kind === 'none' ? (view.late.reason as 'generation_cap' | 'idle_cap' | 'aborted' | 'error') : 'error' };
    return { result: { kind: 'timeout', timeoutMs, elapsedMs: view.latency_ms, late: Promise.resolve(late) }, stuck: late.kind === 'none' && late.reason === 'idle_cap' };
  }
  return {
    result: { kind: 'error', code: o.code as never, detail: o.detail, elapsedMs: view.latency_ms, remote: null },
    stuck: o.code === 'runtime_stuck',
  };
}

interface Built {
  readonly handle: RuntimeHandle;
  readonly session: BrowserSession;
}

export function createBrowserRuntime(options: BrowserRuntimeOptions): { createRuntime: RuntimeFactory; freshProfile: FreshProfileHook } {
  const built = new WeakMap<RuntimeHandle, Built>();
  const wallNow = options.wallNow ?? ((): number => Date.now());

  const createRuntime: RuntimeFactory = async (ctx) => {
    const combo = ctx.combo;
    if (!isInBrowser(combo)) throw new Error(`"${combo.runtime}" is not an in-browser Runtime`);
    const session = new BrowserSession(await options.sessionDeps(), combo, ctx.kind);
    const identity: RuntimeIdentity = {
      runtime: combo.runtime,
      runtimeVersion: combo.runtime === 'webllm' ? options.engineVersions.webllm : options.engineVersions.transformers,
      modelId: combo.model_id,
      modelRevision: combo.revision,
      quantization: combo.quantization,
    };

    let state: AdapterState = 'idle';
    let inFlight = 0;
    const adapter: RuntimeAdapter = {
      identity: () => identity,
      state: () => (state === 'stuck' ? 'stuck' : inFlight > 0 ? 'busy' : 'idle'),
      async complete(prompt: Prompt, o: RequestOptions): Promise<AdapterResult> {
        if (state === 'stuck') return { kind: 'error', code: 'runtime_stuck', detail: 'engine is stuck; rebuild required', elapsedMs: 0, remote: null };
        inFlight += 1;
        const t0 = Date.now();
        try {
          const view = await session.runPrompt(prompt, taskOfSampling(ctx, o), o.timeoutMs, o.sampling.constraint);
          const mapped = toAdapterResult(view, o.timeoutMs);
          if (mapped.stuck) state = 'stuck';
          return mapped.result;
        } catch (e) {
          // A page crash or a lost page: the Combination cannot go on without a rebuild, which a crashed page refuses.
          state = 'stuck';
          const detail = session.hasCrashed ? 'the page crashed' : e instanceof Error ? e.message : String(e);
          return { kind: 'error', code: 'runtime_error', detail, elapsedMs: Math.max(0, Date.now() - t0), remote: null };
        } finally {
          inFlight -= 1;
        }
      },
    };

    let warmups: readonly WarmUpView[] = [];
    let warmIndex = 0;
    // The page runs both Warm_Up_Prompts inside createEngine(); the lifecycle's two generate() calls hand back
    // those recorded answers instead of sending anything twice. Nothing here can reach a Results writer.
    const engine: LifecycleEngine = {
      async create() {
        warmups = await session.rebuildEngine();
        warmIndex = 0;
      },
      generate: async () => warmups[warmIndex++]?.text ?? '',
      dispose() {
        warmIndex = 0;
      },
    };

    const handle: RuntimeHandle = {
      adapter,
      source: 'headless',
      get fingerprint(): JsonObject {
        return fingerprintOf(session, combo);
      },
      get placement(): ResultsPlacement | null {
        const p: Placement | null = combo.runtime === 'webllm' ? WEBLLM_PLACEMENT : session.placement;
        return p === null ? null : { method: p.method, cpu_nodes: p.cpu_nodes.map((n) => ({ op_type: n.op_type, count: n.count })) };
      },
      async load({ coldStart }) {
        try {
          const out = await session.load(coldStart);
          return out.perf === null ? undefined : { perf: out.perf };
        } catch (e) {
          if (e instanceof BrowserLoadError) throw new RuntimeLoadError(e.code, e.message);
          throw e;
        }
      },
      lifecycle: { engine, onReady: () => (state = 'idle') },
      async finish() {
        const perf = await session.finish();
        return perf === null ? undefined : { perf };
      },
      close: () => session.close(),
    };
    built.set(handle, { handle, session });
    return handle;
  };

  const freshProfile: FreshProfileHook = async (ctx, handle): Promise<FreshProfileResult> => {
    const b = built.get(handle);
    if (b === undefined) return { ok: true }; // not one of ours
    const r = await b.session.prepare();
    if (r.ok) return { ok: true };
    const f = r.failure;
    return {
      ok: false,
      failure: { kind: f.code, reason: f.reason, detail: f.detail, run_kind: ctx.kind, phase: 'fresh_profile', at: new Date(wallNow()).toISOString(), ...f.extra },
    };
  };

  return { createRuntime, freshProfile };
}

/** Browser and adapter fields of the Model_Fingerprint (R9.5, R10.3); `null` until the session is prepared. */
export function fingerprintOf(session: Pick<BrowserSession, 'adapterInfo' | 'userAgentString' | 'fingerprintExtras'>, combo: Combination): JsonObject {
  const info = session.adapterInfo;
  const ua = session.userAgentString;
  return {
    browser:
      info === null
        ? null
        : { version: browserVersionOf(ua), user_agent: ua, channel: 'chrome', headless: true, launch_flags: [...HEADLESS_LAUNCH_FLAGS] },
    webgpu: info === null ? null : { ...info, power_preference: powerPreferenceOf(combo) },
    measurement: 'headless',
    // chat_template_kwargs, seed, constraint_used, model_url, ... as the page's adapter reports them (R12.12).
    // These come last on purpose: the adapter knows its own template arguments and seed.
    ...(session.fingerprintExtras ?? {}),
  };
}
