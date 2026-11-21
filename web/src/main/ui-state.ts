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

import type { DecisionStatus, Request, RunState, Snapshot, WorkerMessage } from '../shared/protocol.ts';
import { type SeedProblem, seedProblemMessage } from '../shared/seed.ts';
import type { WorldSnapshot } from '../shared/world-snapshot.ts';
import { nextScene, sceneQueue, type SceneQueue } from './scene-queue.ts';
import { initialUnderworldForm, type UnderworldForm } from './customization.ts';

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
  /** The playback multiplier; carried across create, run and pause. */
  speed: number;
  /** Last Worker read of the pending node's accepted-choice state. */
  playerNode: Snapshot['playerNode'];
  /** Latest completed World Snapshot; presentation never computes an outcome. */
  world: WorldSnapshot | null;
  /** One outstanding read, or the tick whose read failed; never both. */
  worldRead: { state: 'pending' | 'failed'; worldId: number; tick: string } | null;
  /** Running statuses since a World carrier or the last read request, capped at ten. */
  worldStatuses: number;
  scene: SceneQueue | null;
  underworldRecorded: { worldId: number; tick: string } | null;
  underworldForm: UnderworldForm;
  /** Worker-owned page-session preference, budget and request/World binding. */
  decision: DecisionStatus | null;
  decisionRequestId: number;
  /** Only the brief interval before the worker announces a decision or replies. */
  decisionSending: number | null;
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
  | { type: 'request-sent'; request: Request }
  | { type: 'world-read-failed'; worldId: number; tick: string; error: string }
  | { type: 'scene-close' }
  | { type: 'underworld-form'; form: UnderworldForm };

/** The initial display state: no world, Speed 1 selected, everything else empty (R4.4, R5.2). */
export function initialUiState(): UiState {
  return {
    worldId: 0,
    runState: 'no-world',
    tick: null,
    checksum: null,
    tps: null,
    speed: 1,
    playerNode: { pending: false },
    world: null,
    worldRead: null,
    worldStatuses: 0,
    scene: null,
    underworldRecorded: null,
    underworldForm: initialUnderworldForm(),
    decision: null,
    decisionRequestId: 0,
    decisionSending: null,
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
      // (R4.10). A World read records its origin before App sends the request.
      switch (e.request.type) {
        case 'create-world':
          return { ...s, seedMessage: null, createPending: true };
        case 'step':
          return { ...s, stepPending: true };
        case 'dream':
        case 'bribe':
          return { ...s, decisionSending: s.worldId };
        case 'world-snapshot':
          return s.worldRead?.state === 'pending' || s.tick === null ? s : {
            ...s, worldRead: { state: 'pending', worldId: s.worldId, tick: s.tick }, worldStatuses: 0,
          };
        default:
          return s;
      }
    }

    case 'reply': {
      const triggerReply = e.request.type === 'dream' || e.request.type === 'bribe';
      const decisionReply = triggerReply || ['use-rules-now', 'decision-status', 'set-decision-wait', 'export-replay'].includes(e.request.type);
      if (decisionReply && e.message.snapshot.worldId !== s.worldId) return s;
      const read = e.request.type === 'world-snapshot' ? s.worldRead : null;
      const cleared = e.request.type === 'world-snapshot' ? { ...s, worldRead: null } : clearPending(s, e.request);
      if (triggerReply ? e.message.id < s.decisionRequestId : staleDecision(s, e.message.snapshot)) return cleared;
      // Finish the old read without adopting its values or error after replacement.
      if (e.request.type === 'world-snapshot'
        && (e.message.snapshot.worldId !== s.worldId || (read !== null && read.worldId !== s.worldId))) {
        return cleared;
      }
      if (e.message.ok) {
        const replaced = e.message.snapshot.worldId !== s.worldId;
        const next = {
          ...cleared, ...fromSnapshot(e.message.snapshot), ...decisionFields(s, e.message.snapshot, triggerReply ? e.message.id : 0), error: null,
          world: replaced ? null : s.world,
          worldStatuses: replaced ? 0 : cleared.worldStatuses,
          worldRead: replaced && cleared.worldRead?.state === 'failed' ? null : cleared.worldRead,
          underworldForm: replaced ? initialUnderworldForm() : cleared.underworldForm,
          decisionSending: replaced || e.request.type === 'dream' || e.request.type === 'bribe' ? null : cleared.decisionSending,
        };
        const world = e.message.world ?? e.message.snapshot.stop?.world;
        let adopted = expirePresentation(world === undefined ? next : withWorld(next, world));
        if (e.request.type === 'choose' && adopted.scene?.entries[0]?.node === e.request.node) {
          adopted = { ...adopted, scene: nextScene(adopted.scene) };
        }
        if ((e.request.type === 'dream' || e.request.type === 'claim') && adopted.tick !== null) {
          adopted = { ...adopted, underworldRecorded: { worldId: adopted.worldId, tick: adopted.tick } };
        }
        return adopted;
      }
      // Failures keep the completed display; a failed read is not retried at its tick.
      const tick = read?.tick ?? s.tick;
      return {
        ...cleared, ...decisionFields(s, e.message.snapshot, triggerReply ? e.message.id : 0),
        decisionSending: e.request.type === 'dream' || e.request.type === 'bribe' ? null : cleared.decisionSending,
        error: e.request.type === 'dream' ? dreamFailure(e.message) : e.message.error,
        worldRead: e.request.type === 'world-snapshot' && tick !== null
          ? { state: 'failed', worldId: s.worldId, tick } : cleared.worldRead,
      };
    }

    case 'status': {
      // Drop a status from a world we have already replaced (R3.7).
      if (e.snapshot.worldId !== s.worldId || staleDecision(s, e.snapshot)) {
        return s;
      }
      // A status never carries an error and never clears one: the error area is
      // governed by replies and fatals only (R5.8). Adopt the live values.
      const next = {
        ...s, ...fromSnapshot(e.snapshot), ...decisionFields(s, e.snapshot),
        worldStatuses: e.snapshot.runState === 'running' && e.snapshot.stop === undefined
          ? Math.min(s.worldStatuses + 1, 10) : s.worldStatuses,
      };
      const adopted = expirePresentation(e.snapshot.stop === undefined ? next : withWorld(next, e.snapshot.stop.world));
      if (e.snapshot.stop === undefined) return adopted;
      const entries = sceneQueue(e.snapshot.stop.reasons, e.snapshot.stop.world);
      return { ...adopted, scene: entries.length === 0 ? null : {
        worldId: e.snapshot.worldId, tick: e.snapshot.tick!, world: e.snapshot.stop.world, reasons: e.snapshot.stop.reasons, entries,
      } };
    }

    case 'fatal':
    case 'worker-error': {
      // The worker can no longer be trusted. Go to `failed`, show the text, and
      // keep the last completed tick and checksum (R2.8, R2.9, R5.9).
      return { ...s, runState: 'failed', error: e.error, decisionSending: null,
        decision: s.decision === null ? null : { ...s.decision, pending: null } };
    }

    case 'seed-invalid': {
      // The seed field was rejected before any request; name the problem and
      // leave the world, Run_State, tick and checksum untouched (R3.3).
      return { ...s, seedMessage: seedProblemMessage(e.problem) };
    }
    case 'world-read-failed': {
      const read = s.worldRead;
      if (read?.state !== 'pending' || read.worldId !== e.worldId || read.tick !== e.tick) return s;
      if (e.worldId !== s.worldId) return { ...s, worldRead: null };
      return { ...s, error: e.error, worldRead: { state: 'failed', worldId: e.worldId, tick: e.tick } };
    }
    case 'scene-close':
      return s.scene?.entries[0]?.node === null ? { ...s, scene: nextScene(s.scene) } : s;
    case 'underworld-form':
      return { ...s, underworldForm: e.form };
  }
}

/** The page asks for a read only from this reducer state (first-playable R9.9). */
export function worldSnapshotNeeded(s: UiState): boolean {
  if (s.worldId === 0 || s.tick === null || s.worldRead?.state === 'pending') return false;
  if (s.worldRead?.state === 'failed' && s.worldRead.worldId === s.worldId && s.worldRead.tick === s.tick) return false;
  if (s.runState === 'paused') return s.world === null || s.world.tick !== s.tick;
  return s.runState === 'running' && s.worldStatuses === 10;
}

/** A World carrier is authoritative and starts a new running-status allowance. */
function withWorld(s: UiState, world: WorldSnapshot): UiState {
  let form = s.underworldForm;
  if (s.world?.player_wait?.ghost !== world.player_wait?.ghost) {
    form = { ...initialUnderworldForm(), carryOver: world.player_wait?.carry_over ?? null };
  }
  const connected = world.underworld_view?.connected ?? [];
  if (form.dreamer === null || !connected.includes(form.dreamer)) {
    form = { ...form, dreamer: connected[0] ?? null };
  }
  return { ...s, world, worldStatuses: 0, underworldForm: form };
}

function expirePresentation(s: UiState): UiState {
  const scene = s.scene !== null && (s.scene.worldId !== s.worldId || s.scene.tick !== s.tick) ? null : s.scene;
  const recorded = s.underworldRecorded !== null
    && (s.underworldRecorded.worldId !== s.worldId || s.underworldRecorded.tick !== s.tick) ? null : s.underworldRecorded;
  return scene === s.scene && recorded === s.underworldRecorded ? s : { ...s, scene, underworldRecorded: recorded };
}

export function nodeOptionsEnabled(s: UiState): boolean {
  return !decisionBusy(s) && s.world?.player_node !== null && s.world?.player_node !== undefined
    && s.scene?.entries[0]?.node === s.world.player_node.id && s.playerNode.pending && !s.playerNode.answered;
}

/**
 * Which controls are enabled in the given state (R3.8, R4.7-R4.10).
 *
 * - run, pause and step are all disabled in `no-world` and `failed` (R4.7).
 * - in `running`, only pause is enabled (R4.8).
 * - in `paused`, run and step need no unanswered Player_Node; step is also
 *   disabled while a step reply is outstanding (R4.10, first-playable R8.9).
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
  const unanswered = s.playerNode.pending && !s.playerNode.answered;
  const held = decisionBusy(s);
  return {
    create: !s.createPending && s.runState !== 'failed',
    run: paused && !unanswered && !held,
    pause: running && !held,
    step: paused && !unanswered && !s.stepPending && !held,
  };
}

/** No new pause state: only competing commands are held; Create and reads remain available. */
export function decisionBusy(s: UiState): boolean {
  return s.decisionSending === s.worldId || s.decision?.pending?.worldId === s.worldId;
}

/** Fixed UI copy never includes provider text, options, usage, or quality claims. */
export function decisionNotice(s: UiState): string | null {
  if (decisionBusy(s)) return null;
  const outcome = s.decision?.outcome;
  if (outcome == null || outcome.worldId !== s.worldId || outcome.requestId !== s.decisionRequestId) return null;
  return outcome.kind === 'model' ? 'Decision recorded.'
    : outcome.kind === 'fallback' ? 'Rules recorded.' : 'Decision cancelled.';
}

function staleDecision(s: UiState, snapshot: Snapshot): boolean {
  if (snapshot.worldId !== s.worldId) return false;
  const decision = snapshot.decision;
  if (decision === undefined) return false;
  const id = decision.pending?.requestId ?? decision.outcome?.requestId ?? 0;
  return id < s.decisionRequestId
    || (decision.pending !== null && id === s.decisionRequestId && s.decision?.outcome?.requestId === id);
}

function decisionFields(s: UiState, snapshot: Snapshot, requestId = 0): Pick<UiState, 'decision' | 'decisionRequestId'> {
  if (snapshot.decision === undefined) return {
    decision: snapshot.worldId === s.worldId ? s.decision : null,
    decisionRequestId: Math.max(snapshot.worldId === s.worldId ? s.decisionRequestId : 0, requestId),
  };
  const decision = snapshot.decision;
  return { decision, decisionRequestId: Math.max(snapshot.worldId === s.worldId ? s.decisionRequestId : 0,
    decision.pending?.requestId ?? decision.outcome?.requestId ?? 0, requestId) };
}

function dreamFailure(message: Extract<ReplyMessage, { ok: false }>): string {
  if (message.kind === 'cancelled') return 'Decision cancelled.';
  if (message.previewError?.kind === 'no_node') return 'Dream was not recorded: no decision is available.';
  if (message.previewError?.kind === 'malformed') return 'Dream was not recorded: decision data is unavailable.';
  return 'Dream was not recorded. Check the available dreamer and joss paper.';
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
  'worldId' | 'runState' | 'tick' | 'checksum' | 'tps' | 'speed' | 'playerNode'
> {
  return {
    worldId: snap.worldId,
    runState: snap.runState,
    tick: snap.tick,
    checksum: snap.checksum,
    tps: snap.tps,
    speed: snap.speed,
    playerNode: snap.playerNode,
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
