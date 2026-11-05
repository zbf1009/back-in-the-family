// Controller test helper: hand-driven fakes for the injected dependencies (R6.6).
//
// The controller takes a `FrameScheduler`, a `Clock`, a `createSim` and a `post`
// (see worker/controller.ts `Deps`). In the worker these are
// `requestAnimationFrame`, `performance.now`, `new WasmSim` and
// `self.postMessage`. The tests replace the scheduler and clock with fakes they
// drive by hand, so a "frame" fires only when the test says so and time only
// advances when the test moves it. This makes frame discipline (Property 5) and
// clock independence (Property 6) checkable without any real timing.

import type { Clock, FrameScheduler, SimHandle } from '../../../src/worker/controller.ts';

/**
 * A `FrameScheduler` fired by hand. `request(cb)` stores the callback and returns
 * a fresh incrementing handle; `cancel(handle)` drops the stored callback if it
 * is the one with that handle; `flush()` fires the single outstanding callback.
 *
 * It models the worker's "one frame outstanding at a time" rule (R4.3): there is
 * room for exactly one pending callback. `request` while one is already pending
 * throws, so a test (and Property 5) catches any double-request by the
 * controller. The controller only ever requests the next frame from inside the
 * previous frame's callback, after clearing the outstanding handle, so a correct
 * controller never triggers this.
 */
export class FakeFrameScheduler implements FrameScheduler {
  #nextHandle = 1;
  /** The one outstanding (handle, callback), or null when nothing is pending. */
  #pending: { handle: number; cb: () => void } | null = null;

  /** True while a frame callback is outstanding. */
  get isPending(): boolean {
    return this.#pending !== null;
  }

  /** The outstanding handle, or null. For assertions about the one-outstanding rule. */
  get pendingHandle(): number | null {
    return this.#pending === null ? null : this.#pending.handle;
  }

  request(cb: () => void): number {
    if (this.#pending !== null) {
      throw new Error(
        'FakeFrameScheduler: request() while a frame is already outstanding ' +
          '(the controller must keep at most one frame request pending)',
      );
    }
    const handle = this.#nextHandle++;
    this.#pending = { handle, cb };
    return handle;
  }

  cancel(handle: number): void {
    if (this.#pending !== null && this.#pending.handle === handle) {
      this.#pending = null;
    }
  }

  /**
   * Fire the outstanding callback, if any. The callback is removed before it runs
   * (mirroring a real frame, which is consumed when it fires), so the controller
   * may request the next frame from inside it. Returns true if a callback ran.
   */
  flush(): boolean {
    const pending = this.#pending;
    if (pending === null) {
      return false;
    }
    this.#pending = null;
    pending.cb();
    return true;
  }

  /** Fire frames until none is outstanding or `max` frames have fired (a safety cap). */
  flushUntilIdle(max: number): number {
    let fired = 0;
    while (fired < max && this.flush()) {
      fired++;
    }
    return fired;
  }
}

/**
 * A `Clock` with a settable `now`, advanceable by the test. The controller reads
 * it only for Frame pacing and the Ticks_Per_Second window, never as a simulation
 * argument (R6.5), so Property 6 drives two runs with different clocks and checks
 * the recorded `SimHandle` calls are identical.
 */
export class FakeClock implements Clock {
  #now: number;

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  /** Set the current time. */
  set(now: number): void {
    this.#now = now;
  }

  /** Advance the current time by `ms` (may be 0). */
  advance(ms: number): void {
    this.#now += ms;
  }
}

/** One recorded call on a wrapped `SimHandle`, with its arguments. */
export type RecordedCall =
  | { method: 'submit'; input: string }
  | { method: 'step' }
  | { method: 'run_ticks'; n: number }
  | { method: 'tick' };

/**
 * A `SimHandle` wrapper that records every call (method and arguments) and
 * forwards to a real or fake inner handle. Used by the determinism and
 * frame-discipline properties: Property 3 checks no state-changing call is made
 * for a rejected request and that every forwarded argument is in range; Property
 * 6 compares the recorded sequences of two runs with different clocks; Property 5
 * reads `stepCalls`/`runTicksCalls` to check each frame advances by exactly the
 * Speed.
 */
export class RecordingSimHandle implements SimHandle {
  readonly #inner: SimHandle;
  readonly #calls: RecordedCall[] = [];

  constructor(inner: SimHandle) {
    this.#inner = inner;
  }

  /** Every recorded call, in order. */
  get calls(): readonly RecordedCall[] {
    return this.#calls;
  }

  /** Only the state-changing calls (submit, step, run_ticks), in order. */
  get mutatingCalls(): readonly RecordedCall[] {
    return this.#calls.filter((c) => c.method !== 'tick');
  }

  /** The `n` argument of every `run_ticks` call, in order. */
  get runTicksArgs(): readonly number[] {
    return this.#calls.flatMap((c) => (c.method === 'run_ticks' ? [c.n] : []));
  }

  submit(input_json: string): void {
    this.#calls.push({ method: 'submit', input: input_json });
    this.#inner.submit(input_json);
  }

  step(): string {
    this.#calls.push({ method: 'step' });
    return this.#inner.step();
  }

  run_ticks(n: number): string {
    this.#calls.push({ method: 'run_ticks', n });
    return this.#inner.run_ticks(n);
  }

  tick(): bigint {
    this.#calls.push({ method: 'tick' });
    return this.#inner.tick();
  }
}

/**
 * A collector for the controller's `post` dependency: every posted
 * `WorkerMessage` is appended to `messages` in order. Tests read it to check the
 * reply discipline (Property 2), the status cadence, and failure snapshots.
 */
export function messageCollector<M>(): { post: (m: M) => void; messages: M[] } {
  const messages: M[] = [];
  return { post: (m: M) => void messages.push(m), messages };
}
