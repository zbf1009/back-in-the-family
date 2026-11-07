// Adapter timing state machine (design: "Adapter timing state machine", R8.1, R8.2, R8.12, R8.13).
// All time comes from the injected clock, so this module has no real timers and no Date.
// Real adapters inject a performance.now-based clock; tests inject the fake clock.
import type { AdapterResult, AdapterState, LateAnswer, Prompt, RequestOptions, SamplingParams, Usage } from './interface.ts';

/** Extra time after the Timeout during which a still-running generation may finish as a Late_Answer. */
export const LATE_WINDOW_MS = 60_000;
/** The Idle_Cap is the Timeout plus this much, measured from request start. */
export const IDLE_CAP_MS = 90_000;

export interface TimingClock {
  /** Monotonic milliseconds (performance.now-like). May be fractional. */
  now(): number;
  /** Calls `fn` after `ms`; the returned function cancels it. */
  setTimer(ms: number, fn: () => void): () => void;
}

export interface TimedEngine {
  generate(prompt: Prompt, sampling: SamplingParams): Promise<{ text: string; usage: Usage | null; interrupted: boolean }>;
  /** Ask the engine to end the current generation (WebLLM interruptGenerate, a stopping criterion, ...). */
  interrupt(): void;
}

export interface TimedRunner {
  /** `stuck` after an Idle_Cap hit, until `reset()`; `busy` while a request (including overtime) is in flight. */
  state(): AdapterState;
  complete(prompt: Prompt, options: RequestOptions): Promise<AdapterResult>;
  /** The runner calls this after it has rebuilt the engine and finished the Warm_Up_Prompts. */
  reset(): void;
}

function ceilMs(fromMs: number, toMs: number): number {
  return Math.max(0, Math.ceil(toMs - fromMs));
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createTimedRunner(engine: TimedEngine, clock: TimingClock): TimedRunner {
  let stuck = false;
  let inFlight = false;
  // Resolves when the previous request has fully left the engine (idle again, or stuck).
  let previousDone: Promise<void> = Promise.resolve();

  async function run(prompt: Prompt, options: RequestOptions, markDone: () => void): Promise<AdapterResult> {
    const T = options.timeoutMs;
    const t0 = clock.now();
    const cancels: (() => void)[] = [];
    let genDone = false;
    let timedOut = false;
    let lateResolve: (l: LateAnswer) => void = () => {};
    let resolveMain: (r: AdapterResult) => void = () => {};
    const main = new Promise<AdapterResult>((resolve) => {
      resolveMain = resolve;
    });
    const clearTimers = (): void => {
      for (const c of cancels) c();
      cancels.length = 0;
    };
    const settle = (): void => {
      clearTimers();
      markDone();
    };

    let gen: ReturnType<TimedEngine['generate']>;
    try {
      gen = engine.generate(prompt, options.sampling);
    } catch (e) {
      gen = Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }

    gen.then(
      (r) => {
        if (genDone || stuck) return;
        genDone = true;
        const finishedAt = clock.now();
        if (!timedOut) {
          settle();
          resolveMain({ kind: 'text', text: r.text, latencyMs: ceilMs(t0, finishedAt), usage: r.usage });
          return;
        }
        settle();
        const inWindow = !r.interrupted && finishedAt - t0 <= T + LATE_WINDOW_MS;
        lateResolve(
          inWindow
            ? { kind: 'late', text: r.text, latencyMs: ceilMs(t0, finishedAt), usage: r.usage }
            : { kind: 'none', reason: 'generation_cap' },
        );
      },
      (e: unknown) => {
        if (genDone || stuck) return;
        genDone = true;
        settle();
        if (!timedOut) {
          resolveMain({
            kind: 'error',
            code: 'runtime_error',
            detail: message(e),
            elapsedMs: ceilMs(t0, clock.now()),
            remote: null,
          });
        } else {
          lateResolve({ kind: 'none', reason: 'error' });
        }
      },
    );

    // Racing timer: the Timeout result never waits for the engine.
    cancels.push(
      clock.setTimer(T, () => {
        if (genDone) return;
        timedOut = true;
        const late = new Promise<LateAnswer>((resolve) => {
          lateResolve = resolve;
        });
        resolveMain({ kind: 'timeout', timeoutMs: T, elapsedMs: ceilMs(t0, clock.now()), late });
      }),
    );
    // Generation_Cap: the only timer that interrupts (max output tokens ends generation by itself).
    cancels.push(
      clock.setTimer(T + LATE_WINDOW_MS, () => {
        if (!genDone) engine.interrupt();
      }),
    );
    // Idle_Cap: the engine did not return to idle; it is stuck until rebuilt.
    cancels.push(
      clock.setTimer(T + IDLE_CAP_MS, () => {
        if (genDone) return;
        stuck = true;
        clearTimers();
        lateResolve({ kind: 'none', reason: 'idle_cap' });
        markDone();
      }),
    );
    return main;
  }

  return {
    state: () => (stuck ? 'stuck' : inFlight ? 'busy' : 'idle'),
    reset() {
      stuck = false;
    },
    async complete(prompt, options) {
      if (stuck) {
        return {
          kind: 'error',
          code: 'runtime_stuck',
          detail: 'engine did not return to idle by the Idle_Cap; rebuild required',
          elapsedMs: 0,
          remote: null,
        };
      }
      // Serialise: wait until the previous request has left the engine.
      const wait = previousDone;
      let markDone: () => void = () => {};
      previousDone = new Promise<void>((resolve) => {
        markDone = resolve;
      });
      inFlight = true;
      await wait;
      if (stuck) {
        markDone();
        inFlight = false;
        return {
          kind: 'error',
          code: 'runtime_stuck',
          detail: 'engine did not return to idle by the Idle_Cap; rebuild required',
          elapsedMs: 0,
          remote: null,
        };
      }
      const done = (): void => {
        inFlight = false;
        markDone();
      };
      return run(prompt, options, done);
    },
  };
}
