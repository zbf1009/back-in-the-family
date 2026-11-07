// Scriptable fake engine and fake clock for the timing tests (task 12). No real timers:
// time moves only when a test calls `clock.advance(ms)`.
import type { Prompt, SamplingParams, Usage } from './interface.ts';

export interface FakeClock {
  now(): number;
  /** Resolves after `ms` of fake time. */
  sleep(ms: number): Promise<void>;
  /** Calls `fn` after `ms` of fake time; the returned function cancels it. */
  setTimer(ms: number, fn: () => void): () => void;
  /** Moves fake time forward, firing due timers in time order and flushing microtasks between them. */
  advance(ms: number): Promise<void>;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: FakeClock = {
    now: () => current,
    setTimer(ms, fn) {
      const id = seq++;
      timers.set(id, { at: current + Math.max(0, ms), fn });
      return () => {
        timers.delete(id);
      };
    },
    // A zero-length sleep resolves at once, so unscripted create/warm-up need no advance().
    sleep: (ms) => (ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => void clock.setTimer(ms, resolve))),
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        let nextId = -1;
        let nextAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && (t.at < nextAt || (t.at === nextAt && id < nextId))) {
            nextId = id;
            nextAt = t.at;
          }
        }
        if (nextId < 0) break;
        const t = timers.get(nextId)!;
        timers.delete(nextId);
        current = Math.max(current, t.at);
        t.fn();
        await flush();
      }
      current = target;
      await flush();
    },
  };
  return clock;
}

/** What the engine does when `interrupt()` is called during a generation. */
export type InterruptBehaviour =
  | { kind: 'honour'; idleDelayMs: number } // generation ends (partial text) after idleDelayMs
  | { kind: 'ignore' }; // never goes idle: the engine is stuck

export interface GenerationScript {
  /** Fake time from the start of generation to the complete text. Wins over tokensPerSecond. */
  completionMs?: number;
  /** Used when completionMs is absent: duration = ceil(outputTokens * 1000 / tokensPerSecond). */
  tokensPerSecond?: number;
  text: string;
  outputTokens: number;
  inputTokens?: number;
  /** Throw this instead of producing text, after the completion time. */
  fail?: { message: string };
  interrupt?: InterruptBehaviour;
}

export interface FakeEngineScript {
  createMs?: number;
  createFails?: string; // message
  warmUpMs?: number;
  warmUpFails?: string; // message
  /** Per-call script; a function gets the 0-based index of the generate call. */
  generate: GenerationScript | ((callIndex: number) => GenerationScript);
}

export type FakeEngineState = 'uncreated' | 'idle' | 'generating' | 'interrupting' | 'stuck' | 'disposed';

export interface FakeGenerateResult {
  text: string;
  usage: Usage;
  interrupted: boolean;
}

export interface FakeEngine {
  state(): FakeEngineState;
  create(): Promise<void>;
  warmUp(): Promise<void>;
  generate(prompt: Prompt, sampling: SamplingParams): Promise<FakeGenerateResult>;
  interrupt(): void;
  dispose(): void;
  readonly calls: { prompt: Prompt; sampling: SamplingParams; startedAtMs: number }[];
}

export function createFakeEngine(clock: FakeClock, script: FakeEngineScript): FakeEngine {
  let state: FakeEngineState = 'uncreated';
  const calls: FakeEngine['calls'] = [];
  let interruptCurrent: (() => void) | null = null;

  return {
    calls,
    state: () => state,
    async create() {
      await clock.sleep(script.createMs ?? 0);
      if (script.createFails !== undefined) throw new Error(script.createFails);
      state = 'idle';
    },
    async warmUp() {
      await clock.sleep(script.warmUpMs ?? 0);
      if (script.warmUpFails !== undefined) throw new Error(script.warmUpFails);
    },
    generate(prompt, sampling) {
      if (state !== 'idle') return Promise.reject(new Error(`engine not idle: ${state}`));
      const index = calls.length;
      calls.push({ prompt, sampling, startedAtMs: clock.now() });
      const s = typeof script.generate === 'function' ? script.generate(index) : script.generate;
      const duration =
        s.completionMs ?? Math.ceil((s.outputTokens * 1000) / Math.max(1, s.tokensPerSecond ?? 1000));
      state = 'generating';
      return new Promise<FakeGenerateResult>((resolve, reject) => {
        let cancelDone: (() => void) | null = null;
        const finish = (interrupted: boolean): void => {
          interruptCurrent = null;
          if (s.fail !== undefined && !interrupted) {
            state = 'idle';
            reject(new Error(s.fail.message));
            return;
          }
          state = 'idle';
          const text = interrupted ? s.text.slice(0, Math.floor(s.text.length / 2)) : s.text;
          resolve({
            text,
            usage: {
              inputTokens: s.inputTokens ?? 0,
              outputTokens: interrupted ? Math.floor(s.outputTokens / 2) : s.outputTokens,
              reasoningTokens: null,
            },
            interrupted,
          });
        };
        cancelDone = clock.setTimer(duration, () => finish(false));
        interruptCurrent = () => {
          const behaviour = s.interrupt ?? { kind: 'honour', idleDelayMs: 0 };
          cancelDone?.();
          if (behaviour.kind === 'ignore') {
            state = 'stuck';
            interruptCurrent = null;
            return;
          }
          state = 'interrupting';
          clock.setTimer(behaviour.idleDelayMs, () => finish(true));
        };
      });
    },
    interrupt() {
      if (state === 'generating') interruptCurrent?.();
    },
    dispose() {
      state = 'disposed';
    },
  };
}
