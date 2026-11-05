// SimController: all Sim_Worker request handling and the run loop (R2, R3, R4, R6).
//
// The controller owns the one WasmSim of the page, the Run_State, the Speed, the
// latest Checksum and the Ticks_Per_Second window. It is deliberately free of the
// real clock, the real frame scheduler, `postMessage` and the WASM itself: every
// one of those is injected (see `Deps`). The worker entry (sim.worker.ts, task 3.1)
// wires the real ones after `init()` resolves; the unit tests (tasks 2.6-2.12) wire
// fakes they drive by hand. Clock values are read only for Frame pacing and for the
// Ticks_Per_Second window; no clock value or random value is ever passed to a
// SimHandle call (R6.5).

import type { ErrorKind, Request, Snapshot, WorkerMessage } from '../shared/protocol.ts';
import { parseSeed } from '../shared/seed.ts';
import { isSpeed, SPEEDS } from '../shared/speeds.ts';
import { TpsWindow } from './tps.ts';

/**
 * The subset of the WasmSim API the controller is allowed to call (R6.1): the
 * three state-changing methods and the read-only `tick()`. `WasmSim` satisfies
 * this structurally, so the worker entry passes `(s, c) => new WasmSim(s, c)` as
 * `createSim` without an explicit implements clause.
 */
export interface SimHandle {
  submit(input_json: string): void;
  step(): string;
  run_ticks(n: number): string;
  tick(): bigint;
}

/**
 * The Frame scheduler the run loop uses to pace batches. In the worker this is
 * `requestAnimationFrame` / `cancelAnimationFrame` (with a `setTimeout` fallback);
 * in tests it is a fake fired by hand. `request` returns an opaque handle that
 * `cancel` accepts.
 */
export interface FrameScheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

/** The wall-clock source, read only for pacing and Ticks_Per_Second. `performance.now` in the worker. */
export interface Clock {
  now(): number;
}

interface Deps {
  /** Build a new world. Throws a Sim_Error when the config is rejected (R3.6). */
  createSim: (seed: bigint, config: string) => SimHandle;
  scheduler: FrameScheduler;
  clock: Clock;
  post: (m: WorkerMessage) => void;
}

/** The one live world and the id that moves with it (Data Models: `sim`). */
interface World {
  handle: SimHandle;
  worldId: number;
}

export class SimController {
  readonly #createSim: Deps['createSim'];
  readonly #scheduler: FrameScheduler;
  readonly #clock: Clock;
  readonly #post: (m: WorkerMessage) => void;

  /** The live world and its id, or null when no world exists (`no-world`). */
  #world: World | null = null;
  /** `no-world` iff `#world === null`, unless a fatal error set it to `failed`. */
  #runState: Snapshot['runState'] = 'no-world';
  /** The current Speed; starts at 1 and is kept across create, run and pause (R4.5). */
  #speed: number = SPEEDS[0];
  /** The checksum of the last completed tick, or null before the first tick (R2.5). Reset on create. */
  #lastChecksum: string | null = null;
  /** The one outstanding Frame request; non-null only while `running` (R4.3). */
  #frame: number | null = null;
  /** The Ticks_Per_Second window; reset on each run (R2.12, R5.6). */
  readonly #tps = new TpsWindow();
  /** The next worldId to assign; 0 means no world has ever been created. */
  #nextWorldId = 1;

  /** The last wall-clock time a `status` message was posted, for the 100 ms throttle. */
  #lastStatusTime: number | null = null;

  /**
   * False until the worker entry has finished loading the WASM. Requests that
   * arrive before then are held in `#queue` and drained in order by `ready()`
   * (R2.7). `createSim` is injected synchronously, so "loaded" is a flag the
   * entry flips rather than anything the controller awaits.
   */
  #loaded = false;
  /** Requests received before the WASM finished loading, in arrival order. */
  readonly #queue: Request[] = [];
  /** Set once `fail()` has run, so later requests are answered `load-failed`/`invalid-state`. */
  #failed = false;
  /** The ErrorKind later requests get after a failure: `load-failed` if the WASM never loaded, else `invalid-state`. */
  #failKind: ErrorKind = 'invalid-state';
  /** The error text of the failure, repeated on later failure replies. */
  #failError = '';

  constructor(deps: Deps) {
    this.#createSim = deps.createSim;
    this.#scheduler = deps.scheduler;
    this.#clock = deps.clock;
    this.#post = deps.post;
  }

  /**
   * Accept one request. While the WASM is still loading, the request is queued and
   * answered in order once `ready()` (success) or `fail()` (load failure) runs.
   * Once loaded, exactly one `reply` is posted for the request (R2.7).
   */
  handle(req: Request): void {
    if (this.#failed) {
      // A fatal error is final. A load failure means the WASM never loaded, so
      // every later request gets `load-failed` with the load error text (R2.8);
      // a runtime failure gets `invalid-state` (R2.9).
      this.#post(this.#failReply(req, this.#failKind, this.#failError));
      return;
    }
    if (!this.#loaded) {
      this.#queue.push(req);
      return;
    }
    this.#dispatch(req);
  }

  /**
   * Called by the worker entry after `init()` resolves. Marks the controller
   * loaded and drains every request that arrived while loading, in order (R2.7).
   */
  ready(): void {
    if (this.#loaded || this.#failed) {
      return;
    }
    this.#loaded = true;
    // Splice so a request that somehow arrives during draining is appended, not
    // skipped; `#loaded` is now true so any new request dispatches directly.
    while (this.#queue.length > 0) {
      const req = this.#queue.shift()!;
      this.#dispatch(req);
    }
  }

  /**
   * Load failure or an uncaught worker error: post `fatal`, set Run_State `failed`,
   * stop the loop, and answer every queued and later request. A load failure
   * (before `ready()`) answers queued requests with `load-failed`; a runtime
   * failure answers later requests with `invalid-state` (R2.8, R2.9).
   */
  fail(error: string): void {
    if (this.#failed) {
      return;
    }
    const wasLoaded = this.#loaded;
    this.#failed = true;
    // A failure before `ready()` means the WASM never loaded, so every queued and
    // later request gets `load-failed`; a runtime failure after loading gets
    // `invalid-state`.
    this.#failKind = wasLoaded ? 'invalid-state' : 'load-failed';
    this.#failError = error;
    this.#stopLoop();
    this.#runState = 'failed';
    this.#post({ type: 'fatal', error });
    // Drain any requests that were waiting for the WASM to load.
    while (this.#queue.length > 0) {
      const req = this.#queue.shift()!;
      this.#post(this.#failReply(req, this.#failKind, error));
    }
  }

  // --- request dispatch -----------------------------------------------------

  #dispatch(req: Request): void {
    switch (req.type) {
      case 'create-world':
        this.#createWorld(req);
        return;
      case 'run':
        this.#run(req);
        return;
      case 'pause':
        this.#pause(req);
        return;
      case 'step':
        this.#step(req);
        return;
      case 'set-speed':
        this.#setSpeed(req);
        return;
      case 'submit':
        this.#submit(req);
        return;
    }
  }

  #createWorld(req: Request & { type: 'create-world' }): void {
    // Validate the seed before touching the WASM (R2.10, R6.4). The config is
    // passed unchanged; only `new WasmSim` decides whether it is legal (R3.6).
    const seed = parseSeed(req.seed);
    if (!seed.ok) {
      this.#post(this.#failReply(req, 'invalid-seed', `invalid seed: ${req.seed}`));
      return;
    }
    // Construct the new world first; only on success do we stop the loop and
    // replace the old world, so a failed create leaves a running world running
    // (R2.10, R3.6, R3.7).
    let handle: SimHandle;
    try {
      handle = this.#createSim(seed.value, req.config);
    } catch (e) {
      this.#post(this.#failReply(req, 'sim-error', errorText(e)));
      return;
    }
    this.#stopLoop();
    this.#world = { handle, worldId: this.#nextWorldId++ };
    this.#runState = 'paused';
    this.#lastChecksum = null; // no tick has run for the new world yet (R3.5)
    this.#post(this.#okReply(req));
  }

  #run(req: Request & { type: 'run' }): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    if (this.#runState === 'running') {
      this.#post(this.#okReply(req)); // already running; no change (R4.2 table)
      return;
    }
    this.#runState = 'running';
    const now = this.#clock.now();
    this.#tps.reset(now, this.#world.handle.tick());
    this.#lastStatusTime = null;
    this.#requestFrame();
    this.#post(this.#okReply(req));
  }

  #pause(req: Request & { type: 'pause' }): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    if (this.#runState === 'running') {
      this.#stopLoop();
      this.#runState = 'paused';
    }
    // In `paused` already: no change (R4 table).
    this.#post(this.#okReply(req));
  }

  #step(req: Request & { type: 'step' }): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    if (this.#runState === 'running') {
      this.#post(this.#failReply(req, 'invalid-state', 'cannot step while running'));
      return;
    }
    // paused: run exactly one tick (R4.1).
    try {
      this.#lastChecksum = this.#world.handle.step();
    } catch (e) {
      // A throw from step() is a Rust panic: the instance is unusable. Go fatal,
      // then still answer this request so every request gets exactly one reply
      // (R2.7, Property 2).
      this.fail(errorText(e));
      this.#post(this.#failReply(req, 'invalid-state', errorText(e)));
      return;
    }
    this.#post(this.#okReply(req));
  }

  #setSpeed(req: Request & { type: 'set-speed' }): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    if (!isSpeed(req.speed)) {
      // Reject without changing the stored Speed (R4.11, R6.4).
      this.#post(this.#failReply(req, 'invalid-speed', `invalid speed: ${req.speed}`));
      return;
    }
    // Only change the stored Speed. A batch in progress finishes at the old
    // Speed and the next one uses the new Speed (R4.5).
    this.#speed = req.speed;
    this.#post(this.#okReply(req));
  }

  #submit(req: Request & { type: 'submit' }): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    // The input is passed unchanged; only WasmSim.submit decides whether it is
    // legal, and sim-core guarantees a rejected submit leaves the stream
    // unchanged (R2.10).
    try {
      this.#world.handle.submit(req.input);
    } catch (e) {
      this.#post(this.#failReply(req, 'sim-error', errorText(e)));
      return;
    }
    this.#post(this.#okReply(req));
  }

  // --- run loop -------------------------------------------------------------

  #requestFrame(): void {
    // Only one Frame request is outstanding at a time (R4.3). A new one is asked
    // for only after the previous batch ended, in `#onFrame`.
    this.#frame = this.#scheduler.request(() => this.#onFrame());
  }

  #onFrame(): void {
    // The callback is no longer outstanding once it fires.
    this.#frame = null;
    if (this.#runState !== 'running' || this.#world === null) {
      return; // a pause or create between request and fire cancels the batch
    }
    // Capture the Speed current when the batch starts, so a set-speed that
    // arrives mid-batch does not change this batch (R4.5, Property 5).
    const speed = this.#speed;
    try {
      // step() at Speed 1, else run_ticks(Speed). Both return the checksum of the
      // last tick of the batch (R4.3).
      this.#lastChecksum = speed === 1 ? this.#world.handle.step() : this.#world.handle.run_ticks(speed);
    } catch (e) {
      // A throw from step()/run_ticks() is a Rust panic: the instance is unusable.
      this.#toFatal(e);
      return;
    }
    const now = this.#clock.now();
    this.#tps.addSample(now, this.#world.handle.tick());
    // Post a status at most every 100 ms (R2.12, R5.4). The first batch after a
    // run (lastStatusTime null) always posts.
    if (this.#lastStatusTime === null || now - this.#lastStatusTime >= 100) {
      this.#lastStatusTime = now;
      this.#post({ type: 'status', snapshot: this.#snapshot(now) });
    }
    // Ask for the next Frame only now, so a slow batch delays the next one and
    // never causes catch-up batches (R4.3).
    this.#requestFrame();
  }

  #stopLoop(): void {
    if (this.#frame !== null) {
      this.#scheduler.cancel(this.#frame);
      this.#frame = null;
    }
  }

  /** Turn a throw from a SimHandle call into a fatal failure (R2.8 runtime path). */
  #toFatal(e: unknown): void {
    this.fail(errorText(e));
  }

  // --- snapshots and replies ------------------------------------------------

  /**
   * The current worker state as a Snapshot. `now` is used only for the
   * Ticks_Per_Second reading; every other field comes from worker memory.
   */
  #snapshot(now: number): Snapshot {
    const world = this.#world;
    const tick = world === null ? null : world.handle.tick().toString();
    return {
      worldId: world === null ? 0 : world.worldId,
      runState: this.#runState,
      tick,
      checksum: this.#lastChecksum,
      tps: this.#runState === 'running' ? this.#tps.ticksPerSecond(now) : null,
      speed: this.#speed,
    };
  }

  #okReply(req: Request): WorkerMessage {
    return { type: 'reply', id: req.id, ok: true, snapshot: this.#snapshot(this.#clock.now()) };
  }

  #failReply(req: Request, kind: ErrorKind, error: string): WorkerMessage {
    return { type: 'reply', id: req.id, ok: false, kind, error, snapshot: this.#snapshot(this.#clock.now()) };
  }

  #noWorldReply(req: Request): WorkerMessage {
    return this.#failReply(req, 'no-world', 'no world exists; create a world first');
  }
}

/** The message of a thrown value, as it would reach the page (R3.6, Error Handling). */
function errorText(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}
