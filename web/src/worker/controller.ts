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

import type { CheckedSubmission, ErrorKind, PlayerNodeState, Reply, Request, Snapshot, StopPayload, RunUntilStopResult, WorkerMessage } from '../shared/protocol.ts';
import type { WorldSnapshot } from '../shared/world-snapshot.ts';
import { parseSeed } from '../shared/seed.ts';
import { isSpeed, SPEEDS, type Speed } from '../shared/speeds.ts';
import { TpsWindow } from './tps.ts';
import { ticksDue } from './pacer.ts';

/** WasmSim's API, injected so tests can drive pacing without a real clock. */
export interface SimHandle {
  submit(input_json: string): void;
  step(): string;
  run_ticks(n: number): string;
  run_until_stop(max: number): string;
  snapshot(): string;
  /** Returns JSON; malformed payload arrays throw a JsError, not a fatal panic. */
  submit_checked(inputs_json: string): string;
  checksums(from: bigint, to: bigint): string;
  player_node_state(): string;
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
  #speed: Speed = SPEEDS[0];
  /** The checksum of the last completed tick, or null before the first tick (R2.5). Reset on create. */
  #lastChecksum: string | null = null;
  /** The one outstanding Frame request; non-null only while `running` (R4.3). */
  #frame: number | null = null;
  /** The Ticks_Per_Second window; reset on each run (R2.12, R5.6). */
  readonly #tps = new TpsWindow();
  /** Pacing state and cached tick; no clock value reaches the handle. */
  #anchorMs = 0;
  #ranSinceAnchor = 0;
  #lastTick = 0n;
  /** Last read of the input-stream-backed gate, not the World-only Snapshot. */
  #pending: PlayerNodeState = { pending: false };
  #lastSnapshotMs = 0;
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
      case 'world-snapshot':
        this.#worldSnapshot(req);
        return;
      case 'choose':
      case 'choose-and-run':
      case 'dream':
      case 'claim':
        this.#checkedSubmit(req);
        return;
      case 'checksums':
        this.#checksums(req);
        return;
      case 'player_node_state':
        if (this.#world === null) {
          this.#post(this.#noWorldReply(req));
        } else {
          this.#refreshPending();
          this.#post(this.#okReply(req));
        }
        return;
    }
    // Compile-time exhaustiveness, without adding a runtime malformed-message path.
    const unhandled: never = req;
    void unhandled;
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
    // Synchronous serial dispatch has no old-World request backlog; startup FIFO must retain every reply.
    this.#runState = 'paused';
    this.#lastChecksum = null; // no tick has run for the new world yet (R3.5)
    this.#lastTick = handle.tick();
    this.#refreshPending();
    this.#post(this.#okReply(req));
  }

  #run(req: Request & { type: 'run' }): void {
    if (this.#unanswered(req)) return;
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
    this.#anchorMs = now;
    this.#ranSinceAnchor = 0;
    this.#tps.reset(now, this.#lastTick);
    this.#lastStatusTime = null;
    this.#requestFrame();
    this.#post(this.#okReply(req));
  }

  #pause(req: Request & { type: 'pause' }): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    let stop: StopPayload | undefined;
    if (this.#runState === 'running') {
      this.#stopLoop();
      this.#runState = 'paused';
      try {
        stop = { reasons: ['user'], world: JSON.parse(this.#world.handle.snapshot()) };
      } catch (e) {
        this.fail(errorText(e));
        this.#post(this.#failReply(req, 'invalid-state', errorText(e)));
        return;
      }
    }
    this.#post(this.#okReply(req, stop));
  }

  #step(req: Request & { type: 'step' }): void {
    if (this.#unanswered(req)) return;
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
      this.#stepTick();
      this.#post(this.#okReply(req));
    } catch (e) {
      // A throw from run_until_stop() is a Rust panic: the instance is unusable.
      // Still answer the step request exactly once after entering the fatal path.
      this.fail(errorText(e));
      this.#post(this.#failReply(req, 'invalid-state', errorText(e)));
      return;
    }
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
    // Re-anchor on a changed running multiplier: otherwise slowing down can
    // stall while the wall clock catches up to the old, faster tick history.
    if (this.#speed !== req.speed && this.#runState === 'running') {
      this.#anchorMs = this.#clock.now();
      this.#ranSinceAnchor = 0;
    }
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
      this.#refreshPending();
    } catch (e) {
      this.#refreshPending();
      this.#post(this.#failReply(req, 'sim-error', errorText(e)));
      return;
    }
    this.#post(this.#okReply(req));
  }

  #unanswered(req: Request): boolean {
    if (!this.#pending.pending || this.#pending.answered) return false;
    this.#post(this.#unchangedReply(req, 'node_unanswered', 'node_unanswered'));
    return true;
  }

  #refreshPending(): void {
    this.#pending = this.#world === null ? { pending: false } :
      JSON.parse(this.#world.handle.player_node_state());
  }

  #worldSnapshot(req: Request): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    this.#post({ ...this.#okReply(req), world: JSON.parse(this.#world.handle.snapshot()) });
  }

  #checkedSubmit(req: Extract<Request, { type: 'choose' | 'choose-and-run' | 'dream' | 'claim' }>): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    if (req.type === 'choose-and-run' && this.#runState === 'running') {
      this.#post(this.#failReply(req, 'invalid-state', 'cannot choose-and-run while running'));
      return;
    }
    let payloads: unknown[];
    switch (req.type) {
      case 'choose':
      case 'choose-and-run':
        payloads = [{ ChoosePlayer: { node: req.node, option: req.option } }];
        break;
      case 'dream':
        payloads = [{ Dream: { dreamer: String(req.dreamer), intent: req.intent } }];
        break;
      case 'claim': {
        const slot = req.slot === 'imported_vessel' ? 'ImportedVessel' :
          req.slot === 'rebuilt_body' ? 'RebuiltBody' : { Birth: req.slot.slice('birth:'.length) };
        payloads = req.carryOver === null ? [] : [{ CarryOver: { trait_name: req.carryOver } }];
        payloads.push({ ClaimSlot: { slot, ...(req.slot === 'rebuilt_body' ? { customization: req.customization } : {}) } });
        break;
      }
    }
    let result: CheckedSubmission;
    try {
      result = JSON.parse(this.#world.handle.submit_checked(JSON.stringify(payloads)));
    } catch (e) {
      this.#refreshPending();
      this.#post(this.#failReply(req, 'sim-error', errorText(e)));
      return;
    }
    this.#refreshPending();
    if (!result.ok) {
      this.#post(this.#failReply(req, 'rejected', result.reason));
      return;
    }
    if (req.type === 'choose-and-run') {
      try {
        this.#stepTick();
      } catch (e) {
        this.fail(errorText(e));
        this.#post(this.#failReply(req, 'invalid-state', errorText(e)));
        return;
      }
    }
    this.#worldSnapshot(req);
  }

  #checksums(req: Extract<Request, { type: 'checksums' }>): void {
    const from = parseSeed(req.from);
    const to = parseSeed(req.to);
    if (!from.ok || !to.ok) {
      this.#post(this.#unchangedReply(req, 'invalid-tick', 'invalid checksum index'));
      return;
    }
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    const checksums: string[] = JSON.parse(this.#world.handle.checksums(from.value, to.value));
    this.#post({ ...this.#okReply(req), checksums });
  }

  #stepTick(): void {
    const result = this.#advance(1);
    if (result.stops.length > 0) {
      this.#runState = 'paused';
      this.#stopLoop();
      const stop = this.#stopPayload(result);
      this.#post({ type: 'status', snapshot: { ...this.#snapshot(this.#clock.now()), stop } });
    }
  }

  // --- run loop -------------------------------------------------------------

  #requestFrame(): void {
    // Only one Frame request is outstanding at a time (R4.3). A new one is asked
    // for only after the previous batch ended, in `#onFrame`.
    const worldId = this.#world!.worldId;
    this.#frame = this.#scheduler.request(() => this.#onFrame(worldId));
  }

  #onFrame(worldId: number): void {
    // Check before clearing #frame: an obsolete callback must not lose the new world's handle.
    if (this.#world?.worldId !== worldId) return;
    // The callback is no longer outstanding once it fires.
    this.#frame = null;
    if (this.#runState !== 'running' || this.#world === null) {
      return; // a pause or create between request and fire cancels the batch
    }
    const now = this.#clock.now();
    const budget = ticksDue(this.#anchorMs, this.#ranSinceAnchor, now, this.#speed);
    if (budget.reanchor) {
      this.#anchorMs = now;
      this.#ranSinceAnchor = 0;
    }
    try {
      if (budget.run > 0) {
        const result = this.#advance(budget.run);
        this.#ranSinceAnchor += result.ran;
        if (result.stops.length > 0) {
          this.#runState = 'paused';
          this.#stopLoop();
          const stop = this.#stopPayload(result);
          // A stop is exactly one status, even inside the normal throttle window.
          this.#post({ type: 'status', snapshot: { ...this.#snapshot(now), stop } });
          return;
        }
      }
    } catch (e) {
      this.#toFatal(e);
      return;
    }
    this.#tps.addSample(now, this.#lastTick);
    if (this.#lastStatusTime === null || now - this.#lastStatusTime >= 100) {
      this.#lastStatusTime = now;
      this.#post({ type: 'status', snapshot: this.#snapshot(now) });
    }
    this.#requestFrame();
  }

  #advance(max: number): RunUntilStopResult {
    const result: RunUntilStopResult = JSON.parse(this.#world!.handle.run_until_stop(max));
    if (result.ran > 0) this.#lastChecksum = result.checksum;
    this.#lastTick = this.#world!.handle.tick();
    this.#refreshPending();
    return result;
  }

  #stopPayload(result: RunUntilStopResult): StopPayload {
    const world: WorldSnapshot = JSON.parse(this.#world!.handle.snapshot());
    return { reasons: result.stops, world };
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
    this.#lastSnapshotMs = now;
    const tick = world === null ? null : this.#lastTick.toString();
    return {
      worldId: world === null ? 0 : world.worldId,
      runState: this.#runState,
      tick,
      checksum: this.#lastChecksum,
      tps: this.#runState === 'running' ? this.#tps.ticksPerSecond(now) : null,
      speed: this.#speed,
      playerNode: this.#pending,
    };
  }

  #okReply(req: Request, stop?: StopPayload): Extract<Reply, { ok: true }> {
    const snapshot = this.#snapshot(this.#clock.now());
    return {
      type: 'reply', id: req.id, ok: true,
      snapshot: stop === undefined ? snapshot : { ...snapshot, stop },
    };
  }

  #failReply(req: Request, kind: ErrorKind, error: string): WorkerMessage {
    return { type: 'reply', id: req.id, ok: false, kind, error, snapshot: this.#snapshot(this.#clock.now()) };
  }

  #unchangedReply(req: Request, kind: ErrorKind, error: string): Reply {
    return { type: 'reply', id: req.id, ok: false, kind, error, snapshot: this.#snapshot(this.#lastSnapshotMs) };
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
