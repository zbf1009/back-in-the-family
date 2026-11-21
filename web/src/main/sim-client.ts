// Main_Thread client (R2.2, R2.9, R6.2, R9.13).
//
// SimClient is the Main_Thread's only link to the simulation. It starts the one
// Sim_Worker as a module worker, numbers every Request, keeps a map of pending
// replies, and resolves each caller's Promise when the matching `reply` arrives
// (or rejects it after 30 s naming the request, R9.13). Worker-initiated
// messages -- `status`, `fatal`, the worker `error` event and `messageerror` --
// are fanned out to subscriber callbacks; the UI state reducer (task 3.3)
// consumes these.
//
// This is DOM / Main_Thread code: it never imports Sim_Wasm, never holds a
// WasmSim and never calls any Sim_Wasm function. It reaches the simulation only
// by sending Worker_Protocol messages to the Sim_Worker (R2.2, R2.3, R6.2). It
// therefore belongs to tsconfig.app.json (lib DOM).

import type { Request, RequestWithoutId, Snapshot, WorkerMessage } from '../shared/protocol.ts';

/** A `reply` message from the worker: the resolved value of every request Promise. */
export type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;

/**
 * The caller-supplied fields of a Request: everything except the discriminant
 * `type` (fixed by the method chosen) and the `id` (assigned by the client).
 */
type RequestArgs<R extends Request> = Omit<R, 'id' | 'type'>;

/**
 * The time the client waits for a reply before rejecting the caller's Promise
 * (R9.13). Thirty seconds is far longer than any legitimate request: even a
 * create-world or a step that constructs or advances the WASM returns in
 * milliseconds, so a lapse this long means the worker is wedged or gone.
 */
export const REPLY_TIMEOUT_MS = 30_000;

/** Callbacks the client fans worker-initiated events out to (R2.9). */
export interface SimClientHandlers {
  /** A `status` message from the running worker (R2.12). */
  onStatus?: (snapshot: Snapshot) => void;
  /** A `fatal` message: the worker went to a failed state (R2.8, R2.9). */
  onFatal?: (error: string) => void;
  /**
   * An uncaught worker `error` event or a `messageerror` (a message that could
   * not be deserialized). Both mean the worker can no longer be trusted (R2.9).
   */
  onError?: (error: string) => void;
}

/** One request waiting for its reply, with the timer that enforces R9.13. */
interface Pending {
  resolve: (reply: ReplyMessage) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  /** A human-readable label for the request, used in the timeout message. */
  label: string;
  type: Request['type'];
}

/**
 * The Main_Thread client. Construct one per page; it owns the single Sim_Worker.
 * Typed methods send each Request kind and return a Promise that resolves with
 * the matching reply message (whether `ok: true` or `ok: false`) or rejects on
 * the 30 s timeout. A failure reply is a resolved Promise, not a rejection: the
 * reducer decides how to display it (R2.9, R5.8). The Promise rejects only when
 * no reply ever arrives.
 */
export class SimClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  readonly #handlers: SimClientHandlers;
  #nextId = 1;
  readonly #replies = new Map<number, ReplyMessage>();
  #decision: { requestId: number; worldId: number } | null = null;
  #worldId = 0;
  #failure: string | null = null;

  constructor(handlers: SimClientHandlers = {}, worker?: Worker) {
    this.#handlers = handlers;
    // Module worker with a relative URL resolved against this module, so the
    // bundler (Vite) can find and build the worker entry (design D-open-6).
    this.#worker = worker ?? new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.#worker.addEventListener('message', (ev: MessageEvent<WorkerMessage>) => {
      this.#onMessage(ev.data);
    });
    // An uncaught error inside the worker surfaces here as an ErrorEvent.
    this.#worker.addEventListener('error', (ev: ErrorEvent) => {
      if (this.#failure !== null) return;
      this.#settleFailure(ev.message || 'worker error');
      this.#handlers.onError?.(ev.message || 'worker error');
    });
    // A message the structured-clone layer could not deserialize.
    this.#worker.addEventListener('messageerror', () => {
      if (this.#failure !== null) return;
      this.#settleFailure('worker message could not be deserialized');
      this.#handlers.onError?.('worker message could not be deserialized');
    });
  }

  // --- typed request methods -----------------------------------------------

  /** Create a world from a Seed (decimal string) and a World_Config text (R2.6, R3.2). */
  createWorld(args: RequestArgs<Extract<Request, { type: 'create-world' }>>): Promise<ReplyMessage> {
    return this.#send({ type: 'create-world', ...args });
  }

  /** Start running ticks (R4.2). */
  run(): Promise<ReplyMessage> {
    return this.#send({ type: 'run' });
  }

  /** Stop running ticks (R4.6). */
  pause(): Promise<ReplyMessage> {
    return this.#send({ type: 'pause' });
  }

  /** Run exactly one tick (R4.1). */
  step(): Promise<ReplyMessage> {
    return this.#send({ type: 'step' });
  }

  /** Set the playback multiplier (first-playable R8.1). */
  setSpeed(args: RequestArgs<Extract<Request, { type: 'set-speed' }>>): Promise<ReplyMessage> {
    return this.#send({ type: 'set-speed', ...args });
  }

  /** Submit one input in the `input_json` shape `WasmSim.submit` accepts (R2.6). */
  submit(args: RequestArgs<Extract<Request, { type: 'submit' }>>): Promise<ReplyMessage> {
    return this.#send({ type: 'submit', ...args });
  }

  /** Forward a complete typed protocol request through the same Worker path. */
  request(req: RequestWithoutId): Promise<ReplyMessage> {
    return this.#send(req);
  }

  /** Read-only status and future-operation wait preference for the Dream UI. */
  decisionStatus(): Promise<ReplyMessage> { return this.#send({ type: 'decision-status' }); }
  setDecisionWait(seconds: number): Promise<ReplyMessage> { return this.#send({ type: 'set-decision-wait', seconds }); }
  useRulesNow(requestId: number, worldId: number): Promise<ReplyMessage> {
    return this.#send({ type: 'use-rules-now', requestId, worldId });
  }
  /** Actual live v5 export for local evidence, not a reconstructed replay. */
  exportReplay(): Promise<ReplyMessage> { return this.#send({ type: 'export-replay' }); }

  /** Terminate the worker and reject every still-pending request (page teardown). */
  dispose(): void {
    this.#settleFailure('sim client disposed');
    this.#worker.terminate();
  }

  // --- internals ------------------------------------------------------------

  /**
   * Assign the next id, register a pending entry with its 30 s timeout, post the
   * request to the worker, and return the Promise that settles on the reply
   * (R2.7, R9.13).
   */
  #send(req: RequestWithoutId): Promise<ReplyMessage> {
    if (this.#failure !== null) return Promise.reject(new Error(this.#failure));
    const id = this.#nextId++;
    const full = { ...req, id } as Request;
    const label = requestLabel(full);
    return new Promise<ReplyMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // The caller never got a reply; drop the entry so a late reply is ignored.
        this.#pending.delete(id);
        this.#replies.delete(id);
        if (this.#decision?.requestId === id) this.#decision = null;
        this.#flushReplies();
        reject(new Error(`sim worker did not reply to ${label} within ${REPLY_TIMEOUT_MS} ms`));
      }, REPLY_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timeout, label, type: full.type });
      this.#worker.postMessage(full);
    });
  }

  #settleFailure(error: string): void {
    if (this.#failure !== null) return;
    this.#failure = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(error));
    }
    this.#pending.clear();
    this.#replies.clear();
    this.#decision = null;
  }

  #observeDecision(snapshot: Snapshot): boolean {
    const pending = snapshot.decision?.pending;
    if (pending == null) return true;
    const request = this.#pending.get(pending.requestId);
    if (pending.worldId !== snapshot.worldId || this.#replies.has(pending.requestId)
      || (request?.type !== 'dream' && request?.type !== 'bribe')
      || (this.#decision !== null && (this.#decision.requestId !== pending.requestId || this.#decision.worldId !== pending.worldId))) return false;
    this.#decision = { requestId: pending.requestId, worldId: pending.worldId };
    return true;
  }

  #flushReplies(): void {
    while (this.#pending.size > 0) {
      const first = this.#pending.keys().next().value!;
      let id = first;
      let reply = this.#replies.get(first);
      if (reply === undefined && this.#decision?.requestId === first) {
        // Only the outstanding decision may be overtaken, and only by a reply
        // carrying that same live request/World binding. Normal requests stay FIFO.
        for (const [candidateId, candidate] of this.#replies) {
          const pending = candidate.snapshot.decision?.pending;
          const type = this.#pending.get(candidateId)!.type;
          const allowed = ['world-snapshot', 'checksums', 'player_node_state', 'decision-status',
            'set-decision-wait', 'use-rules-now', 'create-world', 'export-replay'].includes(type)
            || (!candidate.ok && candidate.kind === 'decision_pending');
          if (allowed && pending?.requestId === first && pending.worldId === this.#decision.worldId
            && candidate.snapshot.worldId === this.#decision.worldId) {
            id = candidateId;
            reply = candidate;
            break;
          }
        }
      }
      if (reply === undefined) return;
      const pending = this.#pending.get(id)!;
      this.#pending.delete(id);
      this.#replies.delete(id);
      if (this.#decision?.requestId === id) this.#decision = null;
      clearTimeout(pending.timeout);
      this.#worldId = Math.max(this.#worldId, reply.snapshot.worldId);
      pending.resolve(reply);
    }
  }

  /** Route one message from the worker: settle a pending reply or fan out an event. */
  #onMessage(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'reply': {
        const pending = this.#pending.get(msg.id);
        if (pending === undefined) {
          // No entry: the request already timed out (and was dropped) or an id
          // was reused by a buggy worker. Either way there is no caller to settle.
          return;
        }
        if (this.#replies.has(msg.id)) return;
        this.#observeDecision(msg.snapshot);
        this.#replies.set(msg.id, msg);
        this.#flushReplies();
        return;
      }
      case 'status':
        if (this.#failure !== null || msg.snapshot.worldId < this.#worldId || !this.#observeDecision(msg.snapshot)) return;
        this.#worldId = msg.snapshot.worldId;
        this.#flushReplies();
        this.#handlers.onStatus?.(msg.snapshot);
        return;
      case 'fatal':
        if (this.#failure !== null) return;
        this.#settleFailure(msg.error);
        this.#handlers.onFatal?.(msg.error);
        return;
    }
  }
}

/** A short label for a Request, used in the timeout rejection message (R9.13). */
function requestLabel(req: Request): string {
  switch (req.type) {
    case 'create-world':
      return `create-world (id ${req.id})`;
    case 'set-speed':
      return `set-speed ${req.speed} (id ${req.id})`;
    case 'submit':
      return `submit (id ${req.id})`;
    default:
      return `${req.type} (id ${req.id})`;
  }
}
