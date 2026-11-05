// UI state reducer (R2.9, R3.3, R3.5, R3.6, R3.7, R3.8, R4.7-R4.10, R5.1-R5.3,
// R5.6, R5.8, R5.9).
//
// This module is the single pure function that turns Worker_Protocol events and
// user actions into the state the page displays. It holds no DOM, no timers and
// no worker reference, so it is unit-testable in isolation (Properties 7 and 8,
// and the exhaustive controls table). `App.svelte` keeps one `UiState`, feeds it
// every event through `reduce`, derives the button enablement with `controls`,
// and renders the status fields through the formatters.
//
// It is Main_Thread code (lib DOM) and belongs to tsconfig.app.json. It imports
// only types from the shared protocol, the seed messages, and the reply message
// type from the client; every value import is erasable (type-only), so the file
// works unchanged under Vite and Node.

import type { Request, RunState, Snapshot, WorkerMessage } from '../shared/protocol.ts';
import { type SeedProblem, seedProblemMessage } from '../shared/seed.ts';

/**
 * A Worker_Protocol `reply` message, derived from the shared union. This is the
 * same type `sim-client.ts` exports as `ReplyMessage`; the reducer takes it from
 * the DOM-free shared protocol so that this module (and its unit test) type-check
 * without the DOM lib.
 */
type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;

/**
 * Everything the page displays, derived only from events. `tick`, `checksum`,
 * `tps` and `worldId` always come together from one snapshot, so a displayed
 * tick/checksum pair always belongs to one completed tick of the Sim_Worker
 * (R5.4). `null` stands for "nothing to show yet"; the formatters turn it into a
 * dash (R5.1-R5.3, R5.6). `error` and `seedMessage` are the two message areas;
 * `createPending` and `stepPending` gate the create and step controls (R3.8,
 * R4.10).
 */
export interface UiState {
  /** 0 = no world; +1 per successful create-world. Used to ignore stale status (R3.7). */
  worldId: number;
  runState: RunState;
  /** Decimal string with no separators, or `null` when no world exists (R5.1, R5.2). */
  tick: string | null;
  /** 16 lowercase hex, or `null` before the first tick of a world (R5.1, R5.3). */
  checksum: string | null;
  /** Ticks per second, or `null` until the world has been running for 1,000 ms (R5.6). */
  tps: number | null;
  /** The current Speed in ticks per Frame; carried across create, run and pause. */
  speed: number;
  /** Error area text; non-empty while the last reply-or-fatal event was a failure (R5.8). */
  error: string | null;
  /** Seed validation message; set by a rejected seed, cleared by a sent create-world (R3.3). */
  seedMessage: string | null;
  /** A create-world request is in flight; the Create control is disabled meanwhile (R3.8). */
  createPending: boolean;
  /** A step request is in flight; the Step control is disabled meanwhile (R4.10). */
  stepPending: boolean;
}

/**
 * The events the reducer folds over:
 * - `reply`: a Worker_Protocol reply arrived for a request the client sent. Both
 *   the originating `request` (to know which pending flag to clear) and the
 *   reply `message` (success or failure, with the snapshot) are carried.
 * - `status`: an unsolicited status from the running worker (R2.12).
 * - `fatal` / `worker-error`: the worker died or raised an uncaught error (R2.8, R2.9).
 * - `seed-invalid`: the Main_Thread rejected the seed field before sending (R3.3).
 * - `request-sent`: the client has just sent a request; used to set the create and
 *   step pending flags and to clear the seed message on a create-world (R3.8, R4.10).
 */
export type UiEvent =
  | { type: 'reply'; request: Request; message: ReplyMessage }
  | { type: 'status'; snapshot: Snapshot }
  | { type: 'fatal' | 'worker-error'; error: string }
  | { type: 'seed-invalid'; problem: SeedProblem }
  | { type: 'request-sent'; request: Request };

/** The initial display state: no world, Speed 1 selected, everything else empty (R4.4, R5.2). */
export function initialUiState(): UiState {
  return {
    worldId: 0,
    runState: 'no-world',
    tick: null,
    checksum: null,
    tps: null,
    speed: 1,
    error: null,
    seedMessage: null,
    createPending: false,
    stepPending: false,
  };
}

/**
 * Fold one event into the state and return the next state. Pure: it never reads
 * the clock, the DOM or the worker, and never mutates its argument.
 *
 * Invariants enforced here:
 * - A failure reply, a `fatal` or a `worker-error` never changes the displayed
 *   `tick`, `checksum` or `worldId` (R3.6, R5.9); it only sets `error` (and, for
 *   fatal/worker-error, `runState: 'failed'`).
 * - A successful reply copies the whole snapshot and clears `error` (R5.8).
 * - A `status` whose `worldId` differs from the current one is dropped, so a late
 *   status from a replaced world is never shown (R3.7).
 */
export function reduce(s: UiState, e: UiEvent): UiState {
  switch (e.type) {
    case 'request-sent': {
      // A create-world clears the seed message (the seed was accepted) and marks
      // the create control busy (R3.3, R3.8). A step marks the step control busy
      // (R4.10). Other requests do not touch these flags here.
      switch (e.request.type) {
        case 'create-world':
          return { ...s, seedMessage: null, createPending: true };
        case 'step':
          return { ...s, stepPending: true };
        default:
          return s;
      }
    }

    case 'reply': {
      // Clear whichever pending flag this reply answers, regardless of success.
      const cleared = clearPending(s, e.request);
      if (e.message.ok) {
        // Success: adopt the snapshot and clear the error area (R5.8).
        return { ...cleared, ...fromSnapshot(e.message.snapshot), error: null };
      }
      // Failure: keep tick, checksum, worldId and runState; only show the error
      // text (R3.6, R5.9). The worker left its state unchanged, so the snapshot
      // it echoes equals what we already show; we do not copy it, to be explicit
      // that nothing the worker did not complete is displayed.
      return { ...cleared, error: e.message.error };
    }

    case 'status': {
      // Drop a status from a world we have already replaced (R3.7).
      if (e.snapshot.worldId !== s.worldId) {
        return s;
      }
      // A status never carries an error and never clears one: the error area is
      // governed by replies and fatals only (R5.8). Adopt the live values.
      return { ...s, ...fromSnapshot(e.snapshot) };
    }

    case 'fatal':
    case 'worker-error': {
      // The worker can no longer be trusted. Go to `failed`, show the text, and
      // keep the last completed tick and checksum (R2.8, R2.9, R5.9).
      return { ...s, runState: 'failed', error: e.error };
    }

    case 'seed-invalid': {
      // The seed field was rejected before any request; name the problem and
      // leave the world, Run_State, tick and checksum untouched (R3.3).
      return { ...s, seedMessage: seedProblemMessage(e.problem) };
    }
  }
}

/**
 * Which controls are enabled in the given state (R3.8, R4.7-R4.10).
 *
 * - run, pause and step are all disabled in `no-world` and `failed` (R4.7).
 * - in `running`, only pause is enabled (R4.8).
 * - in `paused`, run and step are enabled and pause is disabled; step is also
 *   disabled while a step reply is outstanding (R4.9, R4.10).
 * - create is enabled except while a create-world is in flight or the worker has
 *   failed (R3.8); a failed worker is final for the page.
 */
export function controls(s: UiState): {
  create: boolean;
  run: boolean;
  pause: boolean;
  step: boolean;
} {
  const running = s.runState === 'running';
  const paused = s.runState === 'paused';
  return {
    create: !s.createPending && s.runState !== 'failed',
    run: paused,
    pause: running,
    step: paused && !s.stepPending,
  };
}

// --- status formatters (R5.1-R5.3, R5.6) -----------------------------------
//
// The reducer stores `null` for "nothing yet"; the view renders a dash. These
// helpers keep that one rule in one place (Property 8). The dash is an em dash.

/** The placeholder shown for an absent tick, checksum or Ticks_Per_Second value. */
export const DASH = '\u2014';

/** The tick as a decimal string with no separators, or a dash when absent (R5.1, R5.2). */
export function formatTick(s: UiState): string {
  return s.tick ?? DASH;
}

/** The checksum as 16 lowercase hex characters, or a dash before the first tick (R5.1, R5.3). */
export function formatChecksum(s: UiState): string {
  return s.checksum ?? DASH;
}

/** Ticks_Per_Second as a non-negative decimal integer, or a dash when absent (R5.1, R5.6). */
export function formatTps(s: UiState): string {
  return s.tps === null ? DASH : String(s.tps);
}

/** The Run_State name, always one of the four (R5.1). */
export function formatRunState(s: UiState): RunState {
  return s.runState;
}

// --- internals --------------------------------------------------------------

/** Copy the display fields a snapshot carries. Error and pending flags are not snapshot fields. */
function fromSnapshot(snap: Snapshot): Pick<
  UiState,
  'worldId' | 'runState' | 'tick' | 'checksum' | 'tps' | 'speed'
> {
  return {
    worldId: snap.worldId,
    runState: snap.runState,
    tick: snap.tick,
    checksum: snap.checksum,
    tps: snap.tps,
    speed: snap.speed,
  };
}

/** Clear the pending flag a reply answers, so the create/step control re-enables (R3.8, R4.10). */
function clearPending(s: UiState, request: Request): UiState {
  switch (request.type) {
    case 'create-world':
      return s.createPending ? { ...s, createPending: false } : s;
    case 'step':
      return s.stepPending ? { ...s, stepPending: false } : s;
    default:
      return s;
  }
}
