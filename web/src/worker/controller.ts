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

import type { CheckedSubmission, DecisionNotice, DecisionPreviewError, ErrorKind, PlayerNodeState, Reply, Request, Snapshot, StopPayload, RunUntilStopResult, WorkerMessage } from '../shared/protocol.ts';
import type { ActionResult, PlayerLifecycleFact, SubmissionReceipt, WorldSnapshot } from '../shared/world-snapshot.ts';
import { parseSeed } from '../shared/seed.ts';
import { isSpeed, SPEEDS, type Speed } from '../shared/speeds.ts';
import { TpsWindow } from './tps.ts';
import { ticksDue } from './pacer.ts';
import type { DecisionBridge, DecisionPreview, DecisionTiming } from './decision-bridge.ts';
import type { DecisionFamily, DecisionOutcome } from '../shared/decision.ts';

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
  /** Pure WASM adapters; the controller remains the sole owner of the handle. */
  decision?: {
    bridge: DecisionBridge;
    timing: DecisionTiming;
    previewNode: (sim: SimHandle, payload: string) => string;
    exportReplay: (sim: SimHandle) => string;
  };
}

/** The one live world and the id that moves with it (Data Models: `sim`). */
interface World {
  handle: SimHandle;
  worldId: number;
}

interface PendingDecision {
  request: Extract<Request, { type: 'dream' | 'bribe' }>;
  world: World;
  tick: bigint;
  trigger: string | null;
  payload: unknown;
  abort: AbortController;
  attempted: boolean;
  family: DecisionFamily;
  defaultOrdinal: number | null;
  modelOrdinal: number;
  modelAgrees: boolean;
}

export class SimController {
  readonly #createSim: Deps['createSim'];
  readonly #scheduler: FrameScheduler;
  readonly #clock: Clock;
  readonly #emit: (m: WorkerMessage) => void;

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
  #frameEpoch = 0;
  readonly #decision: Deps['decision'];
  #decisionPending: PendingDecision | null = null;
  #decisionOutcome: DecisionNotice | null = null;
  #actions: ActionResult[] = [];
  #playerLifecycle: PlayerLifecycleFact[] = [];
  readonly #actionRequests = new Map<string, { worldId: number; requestId: number }>();
  #cancelDecisionStatus: (() => void) | null = null;
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
    this.#emit = deps.post;
    this.#decision = deps.decision;
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
    if (this.#decisionPending !== null) this.#decision?.bridge.metrics?.aborted(this.#decisionPending.family);
    this.#decisionPending?.abort.abort();
    this.#decisionPending = null;
    this.#cancelDecisionStatus?.();
    this.#cancelDecisionStatus = null;
    this.#decision?.bridge.dispose();
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
    if (this.#decisionPending !== null && ![
      'create-world', 'world-snapshot', 'checksums', 'player_node_state',
      'decision-status', 'decision-metrics', 'set-decision-wait', 'use-rules-now', 'export-replay',
    ].includes(req.type)) {
      this.#post(this.#unchangedReply(req, 'decision_pending', 'decision_pending'));
      return;
    }
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
      case 'carry-over':
      case 'haunt':
      case 'claim':
        this.#checkedSubmit(req);
        return;
      case 'dream':
      case 'bribe':
        this.#startDecision(req);
        return;
      case 'decision-status':
        this.#post(this.#okReply(req));
        return;
      case 'decision-metrics':
        this.#post({ ...this.#okReply(req), metrics: this.#decision?.bridge.metrics?.report() ?? null });
        return;
      case 'set-decision-wait':
        if (typeof req.seconds !== 'number' || !Number.isFinite(req.seconds)) {
          this.#post(this.#unchangedReply(req, 'invalid-wait', 'invalid decision wait'));
        } else {
          this.#decision?.bridge.setWaitSeconds(req.seconds);
          this.#post(this.#okReply(req));
        }
        return;
      case 'use-rules-now': {
        const pending = this.#decisionPending;
        if (pending === null || req.requestId !== pending.request.id || req.worldId !== pending.world.worldId) {
          this.#post(this.#unchangedReply(req, 'invalid-state', 'no matching pending decision'));
          return;
        }
        pending.abort.abort();
        this.#finishDecision(pending, { kind: 'fallback', reason: 'cancelled' }, true);
        if (!this.#failed) this.#post(this.#okReply(req));
        return;
      }
      case 'export-replay':
        if (this.#world === null) this.#post(this.#noWorldReply(req));
        else if (this.#decision === undefined) this.#post(this.#failReply(req, 'invalid-state', 'replay adapter unavailable'));
        else this.#post({ ...this.#okReply(req), replay: this.#decision.exportReplay(this.#world.handle) });
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
    const pending = this.#decisionPending;
    if (pending !== null) {
      this.#closeDecision(pending, false);
      this.#decision?.bridge.metrics?.cancelled(pending.family);
      this.#decisionOutcome = { requestId: pending.request.id, worldId: pending.world.worldId, kind: 'cancelled' };
      this.#post(this.#failReply(pending.request, 'cancelled', 'cancelled'));
    }
    this.#stopLoop();
    this.#world = { handle, worldId: this.#nextWorldId++ };
    // Synchronous serial dispatch has no old-World request backlog; startup FIFO must retain every reply.
    this.#runState = 'paused';
    this.#lastChecksum = null; // no tick has run for the new world yet (R3.5)
    this.#decisionOutcome = null;
    this.#actions = [];
    this.#playerLifecycle = [];
    this.#actionRequests.clear();
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
        stop = { reasons: ['user'], world: this.#readWorld(this.#world.handle) };
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
    let result: RunUntilStopResult;
    try {
      result = this.#advance(1);
    } catch (e) {
      // A throw from run_until_stop() is a Rust panic or an interface error.
      this.fail(errorText(e));
      this.#post(this.#failReply(req, 'invalid-state', errorText(e)));
      return;
    }
    this.#publishAdvance(result, this.#clock.now());
    this.#post(this.#failed ? this.#failReply(req, 'invalid-state', this.#failError) : this.#okReply(req));
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

  #worldSnapshot(req: Request, submission?: SubmissionReceipt): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    this.#post({ ...this.#okReply(req), ...(submission === undefined ? {} : { submission }),
      world: this.#readWorld(this.#world.handle) });
  }

  #startDecision(req: Extract<Request, { type: 'dream' | 'bribe' }>): void {
    if (this.#world === null) {
      this.#post(this.#noWorldReply(req));
      return;
    }
    const payload = req.type === 'dream'
      ? { Dream: { dreamer: String(req.dreamer), intent: req.intent } }
      : { Bribe: { amount: req.amount } };
    const decision = this.#decision;
    const reason = decision?.bridge.fallbackReason() ?? (decision === undefined ? 'unavailable' : null);
    // An unavailable adapter never previews, locks, cancels a Frame or reanchors.
    if (decision === undefined || reason !== null) {
      this.#submitDecision(req, [payload], { requestId: req.id, worldId: this.#world.worldId, kind: 'fallback', reason: reason ?? 'unavailable' });
      return;
    }
    const pending: PendingDecision = {
      request: req, world: this.#world, tick: this.#lastTick, trigger: null, payload, abort: new AbortController(), attempted: false,
      family: req.type === 'dream' ? 'dream_interpretation' : 'magistrate_ruling',
      defaultOrdinal: null, modelOrdinal: -1, modelAgrees: false,
    };
    this.#decisionPending = pending;
    this.#stopLoop();
    let preview: DecisionPreview | { ok: false; error: DecisionPreviewError };
    try {
      preview = JSON.parse(decision.previewNode(pending.world.handle, JSON.stringify(payload)));
    } catch (error) {
      this.fail(errorText(error));
      return;
    }
    if (!preview.ok) {
      decision.bridge.metrics?.rejected(pending.family);
      this.#closeDecision(pending, true);
      this.#post({ ...this.#unchangedReply(req, preview.error.kind === 'rejected' ? 'rejected' : 'preview-error',
        preview.error.kind === 'rejected' ? preview.error.reason : preview.error.kind), previewError: preview.error });
      return;
    }
    pending.trigger = preview.trigger;
    pending.family = preview.family;
    pending.defaultOrdinal = preview.option_ids.indexOf(preview.rules_default);
    decision.bridge.metrics?.eligible(preview.family);
    const spent = decision.bridge.status().spent;
    const operation = decision.bridge.decide(preview, pending.abort.signal);
    pending.attempted = decision.bridge.status().spent > spent;
    void operation.then(
      outcome => this.#finishDecision(pending, outcome),
      error => { if (this.#decisionPending === pending) this.fail(errorText(error)); },
    );
    if (pending.attempted) {
      this.#decisionOutcome = null;
      this.#lastStatusTime = this.#clock.now();
      this.#post({ type: 'status', snapshot: this.#snapshot(this.#lastStatusTime) });
      this.#scheduleDecisionStatus(pending);
    }
  }

  #scheduleDecisionStatus(pending: PendingDecision): void {
    if (this.#runState !== 'running') return;
    this.#cancelDecisionStatus = this.#decision!.timing.schedule(() => {
      if (this.#decisionPending !== pending || this.#failed) return;
      this.#cancelDecisionStatus = null;
      this.#lastStatusTime = this.#clock.now();
      this.#post({ type: 'status', snapshot: this.#snapshot(this.#lastStatusTime) });
      this.#scheduleDecisionStatus(pending);
    }, 100);
  }

  #finishDecision(pending: PendingDecision, outcome: DecisionOutcome, manual = false): void {
    // Identity also distinguishes successive decisions in the same World/tick.
    if (this.#failed || this.#decisionPending !== pending || this.#world !== pending.world) return;
    let current: DecisionPreview | { ok: false; error: DecisionPreviewError } | undefined;
    let tick: bigint;
    try {
      tick = pending.world.handle.tick();
      if (tick === pending.tick && this.#lastTick === pending.tick && outcome.kind === 'model') {
        current = JSON.parse(this.#decision!.previewNode(pending.world.handle, JSON.stringify(pending.payload)));
      }
    } catch (error) {
      this.fail(errorText(error));
      return;
    }
    if (tick !== pending.tick || this.#lastTick !== pending.tick) {
      this.#closeDecision(pending, true);
      this.#decision?.bridge.metrics?.aborted(pending.family);
      this.#post(this.#failReply(pending.request, 'invalid-state', 'decision tick changed'));
      return;
    }
    let payloads = [pending.payload];
    let notice: DecisionNotice = { requestId: pending.request.id, worldId: pending.world.worldId,
      kind: 'fallback', reason: manual ? 'manual' : outcome.kind === 'fallback' ? outcome.reason : 'invalid_response' };
    if (outcome.kind === 'model') {
      // Preview guards the model choice; only checked acceptance binds input identity.
      if (current === undefined || !current.ok || current.trigger !== pending.trigger) {
        this.#closeDecision(pending, true);
        this.#decision?.bridge.metrics?.aborted(pending.family);
        this.#post(this.#failReply(pending.request, 'invalid-state', 'decision trigger changed'));
        return;
      }
      pending.modelOrdinal = current.option_ids.indexOf(outcome.decision.choice);
      pending.modelAgrees = outcome.decision.choice === current.rules_default;
      payloads = [pending.payload, { Choose: { node: { Trigger: { seq: pending.trigger } },
        option: outcome.decision.choice, fingerprint: outcome.decision.fingerprint } }];
      notice = { requestId: pending.request.id, worldId: pending.world.worldId, kind: 'model',
        option: outcome.decision.choice, usage: outcome.decision.usage };
    }
    this.#submitDecision(pending.request, payloads, notice, pending);
  }

  #submitDecision(req: Request, payloads: unknown[], notice: DecisionNotice, pending?: PendingDecision): void {
    const world = pending?.world ?? this.#world!;
    let result: CheckedSubmission;
    try {
      result = this.#checked(world, req, payloads);
      if (!result.ok && payloads.length === 2) {
        result = this.#checked(world, req, [payloads[0]]);
        notice = { requestId: req.id, worldId: world.worldId, kind: 'fallback', reason: 'invalid_response' };
      }
      this.#refreshPending();
    } catch (error) {
      this.fail(errorText(error));
      return;
    }
    const family = pending?.family ?? (req.type === 'dream' ? 'dream_interpretation' : 'magistrate_ruling');
    const metrics = this.#decision?.bridge.metrics;
    if (!result.ok) metrics?.rejected(family);
    else {
      // Queue acceptance proves the supported trigger's eligibility, not resolution.
      if (pending === undefined) metrics?.eligible(family);
      if (notice.kind === 'model' && pending !== undefined) {
        metrics?.checkedModel(family, pending.modelOrdinal, pending.modelAgrees);
      } else if (notice.kind === 'fallback') {
        metrics?.checkedFallback(family, notice.reason, pending?.defaultOrdinal ?? null);
        if (pending?.attempted !== true) metrics?.skip(family, notice.reason);
      }
    }
    this.#decisionOutcome = notice;
    if (pending !== undefined) this.#closeDecision(pending, true);
    if (!result.ok) {
      this.#post(this.#failReply(req, 'rejected', result.reason));
      return;
    }
    let snapshotWorld: WorldSnapshot;
    try {
      snapshotWorld = this.#readWorld(world.handle);
    } catch (error) {
      this.fail(errorText(error));
      return;
    }
    this.#post({ ...this.#okReply(req), submission: { tick: result.tick, seqs: result.seqs }, world: snapshotWorld });
  }

  #closeDecision(pending: PendingDecision, resume: boolean): void {
    if (this.#decisionPending !== pending) return;
    pending.abort.abort();
    this.#decisionPending = null;
    this.#cancelDecisionStatus?.();
    this.#cancelDecisionStatus = null;
    if (resume && this.#world === pending.world && this.#runState === 'running' && !this.#failed) {
      const now = this.#clock.now();
      if (pending.attempted) {
        this.#anchorMs = now;
        this.#ranSinceAnchor = 0;
        this.#tps.reset(now, this.#lastTick);
      }
      this.#requestFrame();
    }
  }

  #checkedSubmit(req: Extract<Request, { type: 'choose' | 'choose-and-run' | 'claim' | 'carry-over' | 'haunt' }>): void {
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
      case 'carry-over':
        payloads = [{ CarryOver: { trait_name: req.trait } }];
        break;
      case 'haunt':
        payloads = [{ Haunt: { target: String(req.target) } }];
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
      result = this.#checked(this.#world, req, payloads);
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
      let batch: RunUntilStopResult;
      try {
        batch = this.#advance(1);
      } catch (e) {
        this.fail(errorText(e));
        this.#post(this.#failReply(req, 'invalid-state', errorText(e)));
        return;
      }
      this.#publishAdvance(batch, this.#clock.now());
      if (this.#failed) {
        this.#post(this.#failReply(req, 'invalid-state', this.#failError));
        return;
      }
    }
    this.#worldSnapshot(req, { tick: result.tick, seqs: result.seqs });
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

  /** One publication owner for paused Step, choose-and-run and running batches. */
  #publishAdvance(result: RunUntilStopResult, now: number): boolean {
    if (result.stops.length > 0) {
      this.#runState = 'paused';
      this.#stopLoop();
      let stop: StopPayload;
      try {
        stop = this.#stopPayload(result);
      } catch (error) {
        this.fail(errorText(error));
        return true;
      }
      this.#post({ type: 'status', snapshot: { ...this.#snapshot(now), stop } });
      return true;
    }
    if (this.#actions.length > 0 || this.#playerLifecycle.length > 0) {
      this.#lastStatusTime = now;
      this.#post({ type: 'status', snapshot: this.#snapshot(now) });
    }
    return false;
  }

  // --- run loop -------------------------------------------------------------

  #requestFrame(): void {
    // Only one Frame request is outstanding at a time (R4.3). A new one is asked
    // for only after the previous batch ended, in `#onFrame`.
    const worldId = this.#world!.worldId;
    const epoch = this.#frameEpoch;
    this.#frame = this.#scheduler.request(() => this.#onFrame(worldId, epoch));
  }

  #onFrame(worldId: number, epoch: number): void {
    // Check before clearing: same-World callbacks queued before a hold are stale too.
    if (this.#world?.worldId !== worldId || epoch !== this.#frameEpoch || this.#decisionPending !== null) return;
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
    let result: RunUntilStopResult | undefined;
    try {
      if (budget.run > 0) {
        result = this.#advance(budget.run);
        this.#ranSinceAnchor += result.ran;
      }
    } catch (e) {
      this.#toFatal(e);
      return;
    }
    if (result === undefined || result.stops.length === 0) this.#tps.addSample(now, this.#lastTick);
    if (result !== undefined && this.#publishAdvance(result, now)) return;
    if (this.#lastStatusTime === null || now - this.#lastStatusTime >= 100) {
      this.#lastStatusTime = now;
      this.#post({ type: 'status', snapshot: this.#snapshot(now) });
    }
    this.#requestFrame();
  }

  #advance(max: number): RunUntilStopResult {
    const result: RunUntilStopResult = JSON.parse(this.#world!.handle.run_until_stop(max));
    if (!Array.isArray(result.actions) || !Array.isArray(result.player_lifecycle)) {
      throw new Error('WASM interface error: required actions/player_lifecycle batch leaves');
    }
    const worldId = this.#world!.worldId;
    for (const action of result.actions) {
      const binding = this.#actionRequests.get(action.input_seq);
      this.#actions.push({ ...action, worldId,
        requestId: binding?.worldId === worldId ? binding.requestId : null });
      this.#actionRequests.delete(action.input_seq);
    }
    for (const fact of result.player_lifecycle) this.#playerLifecycle.push(fact);
    if (result.ran > 0) this.#lastChecksum = result.checksum;
    this.#lastTick = this.#world!.handle.tick();
    this.#refreshPending();
    return result;
  }

  #stopPayload(result: RunUntilStopResult): StopPayload {
    const world = this.#readWorld(this.#world!.handle);
    return { reasons: result.stops, world };
  }

  #stopLoop(): void {
    this.#frameEpoch++;
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
  /** Successful transport transfers these arrays; construction alone never drains. */
  #post(message: WorkerMessage): void {
    this.#emit(message);
    if (message.type === 'fatal') return;
    if (message.snapshot.actions === this.#actions) this.#actions = [];
    if (message.snapshot.playerLifecycle === this.#playerLifecycle) this.#playerLifecycle = [];
  }

  #readWorld(handle: SimHandle): WorldSnapshot {
    const world: WorldSnapshot = JSON.parse(handle.snapshot());
    if (world.underworld_view !== null) {
      const actions = world.underworld_view?.actions;
      if (actions?.version !== 1 || actions.capped_spend == null ||
        actions.bribe == null || actions.haunt == null ||
        !Array.isArray(actions.haunt.targets) || typeof actions.haunt.price !== 'string' ||
        typeof actions.bribe.min_amount !== 'string' || typeof actions.bribe.max_amount !== 'string' ||
        actions.bribe.availability == null || typeof actions.bribe.availability.eligible !== 'boolean' ||
        actions.bribe.availability.reason === undefined ||
        ['cap_year', 'yearly_cap', 'spent', 'remaining'].some(key =>
          typeof actions.capped_spend[key as keyof typeof actions.capped_spend] !== 'string') ||
        actions.haunt.targets.some(target => target == null || typeof target.target !== 'number' ||
          target.availability == null || typeof target.availability.eligible !== 'boolean' ||
          target.availability.reason === undefined)) {
        throw new Error('WASM interface error: required ActionView version 1 leaves');
      }
    }
    return world;
  }

  #checked(world: World, req: Request, payloads: unknown[]): CheckedSubmission {
    const result: CheckedSubmission = JSON.parse(world.handle.submit_checked(JSON.stringify(payloads)));
    if (result.ok && (typeof result.tick !== 'string' || !Array.isArray(result.seqs) ||
      result.seqs.length !== payloads.length || result.seqs.some(seq => typeof seq !== 'string'))) {
      throw new Error('WASM interface error: required checked tick/seqs receipt');
    }
    if (result.ok && (req.type === 'bribe' || req.type === 'haunt')) {
      this.#actionRequests.set(result.seqs[0], { worldId: world.worldId, requestId: req.id });
    }
    return result;
  }

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
      tps: this.#runState === 'running' && this.#decisionPending === null ? this.#tps.ticksPerSecond(now) : null,
      speed: this.#speed,
      playerNode: this.#pending,
      actions: this.#actions,
      playerLifecycle: this.#playerLifecycle,
      ...(this.#decision === undefined ? {} : { decision: {
        ...this.#decision.bridge.status(),
        pending: this.#decisionPending === null ? null : {
          requestId: this.#decisionPending.request.id, worldId: this.#decisionPending.world.worldId,
          tick: this.#decisionPending.tick.toString(), trigger: this.#decisionPending.trigger,
        },
        outcome: this.#decisionOutcome,
      } }),
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

  #unchangedReply(req: Request, kind: ErrorKind, error: string): Extract<Reply, { ok: false }> {
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
