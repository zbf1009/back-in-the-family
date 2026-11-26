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

import type { DecisionStatus, ErrorKind, Request, RunState, Snapshot, WorkerMessage } from '../shared/protocol.ts';
import { type SeedProblem, seedProblemMessage } from '../shared/seed.ts';
import type { ActionResult, PlayerLifecycleFact, SubmissionReceipt, WorldSnapshot } from '../shared/world-snapshot.ts';
import type { DreamFact } from '../shared/story.ts';
import { closeScene, retireNode, sceneQueue, type SceneClose, type SceneQueue } from './scene-queue.ts';
import { initialUnderworldForm, type UnderworldForm } from './customization.ts';
import { addObservation, emptyObservationIndex, hasObservation, type ObservationIndex } from './observation-index.ts';
import { DEFAULT_SPEED } from '../shared/speeds.ts';
import { appendStory, createNotebook, type LifeNotebook } from './life-journal.ts';
import { sourceLabel } from './player-copy.ts';

/**
 * A Worker_Protocol `reply` message, derived from the shared union. This is the
 * same type `sim-client.ts` exports as `ReplyMessage`; the reducer takes it from
 * the DOM-free shared protocol so that this module (and its unit test) type-check
 * without the DOM lib.
 */
type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;

export type ActionPhase = 'sending' | 'deciding' | 'queued' | 'unknown' | 'applied' | 'rejected' | 'cancelled';
export interface UiAction {
  worldId: number;
  requestId: number | null;
  inputSeq: string | null;
  request: Request | null;
  phase: ActionPhase;
  submission: SubmissionReceipt | null;
  result: ActionResult | null;
  error: string | null;
  dream?: DreamFact;
}

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
  /** Full current-world history; render ranges never evict these facts. */
  notebook: LifeNotebook;
  /** One outstanding read, or the tick whose read failed; never both. */
  worldRead: ({ state: 'pending'; worldId: number; tick: string; requestId: number }
    | { state: 'failed'; worldId: number; tick: string; requestId?: number }) | null;
  /** Running statuses since a World carrier or the last read request, capped at ten. */
  worldStatuses: number;
  scene: SceneQueue | null;
  settledScene: SceneClose | null;
  sceneEpisode: { worldId: number; tick: string; seen: string[] } | null;
  lastDreamKey: string | null;
  actions: UiAction[];
  settledOmitted: number;
  observedActions: ObservationIndex;
  settledRequests: ObservationIndex;
  playerLifecycle: PlayerLifecycleFact[];
  observedLifecycle: ObservationIndex;
  lifecycleEpisode: string | null;
  underworldRecorded: { worldId: number; tick: string } | null;
  underworldForm: UnderworldForm;
  /** Worker-owned page-session preference, budget and request/World binding. */
  decision: DecisionStatus | null;
  /** Newest observed pending/handled trigger; rejection may retain an older carrier. */
  decisionRequestId: number;
  /** Only the brief interval before the worker announces a decision or replies. */
  decisionSendingRequestId: number | null;
  /** Error area text; non-empty while the last reply-or-fatal event was a failure (R5.8). */
  error: string | null;
  errorKind?: ErrorKind | 'validation';
  errorOperation?: Request['type'];
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
  | { type: 'reply'; request: Request; message: ReplyMessage; worldId?: number }
  | { type: 'status'; snapshot: Snapshot }
  | { type: 'fatal' | 'worker-error'; error: string }
  | { type: 'seed-invalid'; problem: SeedProblem }
  | { type: 'request-sent'; request: Request; worldId?: number }
  | { type: 'request-failed'; request: Request; worldId: number; error: string }
  | { type: 'request-start-failed'; worldId: number; operation: Request['type']; error: string }
  | { type: 'world-read-start-failed'; worldId: number; tick: string; error: string }
  | { type: 'validation-error'; error: string }
  | { type: 'scene-close'; expected: SceneClose }
  | { type: 'scene-settled'; expected: SceneClose }
  | { type: 'underworld-form'; form: UnderworldForm };

/** A paused new game starts at Life pace; history begins on successful Create. */
export function initialUiState(): UiState {
  return {
    worldId: 0,
    runState: 'no-world',
    tick: null,
    checksum: null,
    tps: null,
    speed: DEFAULT_SPEED,
    playerNode: { pending: false },
    world: null,
    notebook: createNotebook(0),
    worldRead: null,
    worldStatuses: 0,
    scene: null,
    settledScene: null,
    sceneEpisode: null,
    lastDreamKey: null,
    actions: [],
    settledOmitted: 0,
    observedActions: emptyObservationIndex(),
    settledRequests: emptyObservationIndex(),
    playerLifecycle: [],
    observedLifecycle: emptyObservationIndex(),
    lifecycleEpisode: null,
    underworldRecorded: null,
    underworldForm: initialUnderworldForm(),
    decision: null,
    decisionRequestId: 0,
    decisionSendingRequestId: null,
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
      const worldId = e.worldId ?? s.worldId;
      if (worldId !== s.worldId || s.runState === 'failed') return s;
      let next = recordSent(s, e.request, worldId);
      switch (e.request.type) {
        case 'create-world': return { ...next, seedMessage: null, createPending: true,
          error: next.errorKind === 'validation' ? null : next.error,
          errorKind: next.errorKind === 'validation' ? undefined : next.errorKind,
          errorOperation: next.errorKind === 'validation' ? undefined : next.errorOperation };
        case 'step': return { ...next, stepPending: true };
        case 'dream':
        case 'bribe':
          if (e.request.id <= s.decisionRequestId && s.decision?.pending?.requestId !== e.request.id
            || hasObservation(s.settledRequests, String(e.request.id))
            || next.actions.some(action => action.requestId === e.request.id && terminal(action.phase))) return next;
          return { ...next, decisionSendingRequestId: e.request.id };
        case 'world-snapshot':
          return s.worldRead?.state === 'pending' || s.tick === null ? next : {
            ...next, worldRead: { state: 'pending', worldId, tick: s.tick, requestId: e.request.id }, worldStatuses: 0,
          };
        default: return next;
      }
    }
    case 'reply': {
      const message = e.message;
      const replacing = e.request.type === 'create-world' && message.ok && message.snapshot.worldId > s.worldId;
      if (e.request.type === 'world-snapshot' && message.snapshot.worldId !== s.worldId
        && s.worldRead?.worldId === message.snapshot.worldId && s.worldRead.requestId === e.request.id) return { ...s, worldRead: null };
      if (!replacing && (message.snapshot.worldId < s.worldId || message.ok && message.snapshot.worldId !== s.worldId
        || e.worldId !== undefined && e.worldId !== s.worldId)) return s;
      if (s.runState === 'failed') return s;
      const read = e.request.type === 'world-snapshot' && s.worldRead?.requestId === e.request.id ? s.worldRead : null;
      let next = clearPending(s, e.request);
      if (read !== null) next = { ...next, worldRead: null };
      if (replacing) next = {
        ...next, worldId: message.snapshot.worldId, world: null,
        notebook: createNotebook(message.snapshot.worldId), lastDreamKey: null,
        tick: null, checksum: null, tps: null, playerNode: { pending: false },
        worldRead: next.worldRead?.state === 'pending' ? next.worldRead : null, worldStatuses: 0,
        stepPending: false,
        scene: null, settledScene: null, sceneEpisode: null, underworldRecorded: null, underworldForm: initialUnderworldForm(),
        actions: [], settledOmitted: 0, observedActions: emptyObservationIndex(), settledRequests: emptyObservationIndex(),
        playerLifecycle: [], observedLifecycle: emptyObservationIndex(), lifecycleEpisode: null,
        decision: null, decisionRequestId: 0, decisionSendingRequestId: null,
      };
      if (message.snapshot.worldId === next.worldId) next = ingest(next, message.snapshot);
      next = recordReply(next, e.request, message);
      const trigger = e.request.type === 'dream' || e.request.type === 'bribe';
      const staleTrigger = trigger && (message.id < next.decisionRequestId
        || message.id === next.decisionRequestId && next.decision?.pending?.requestId !== message.id);
      if (!staleTrigger && message.snapshot.worldId === next.worldId) {
        next = { ...next, ...decisionFields(next, message.snapshot, trigger ? message.id : 0) };
      }
      if (next.decisionSendingRequestId === message.id) next = { ...next, decisionSendingRequestId: null };
      if (message.ok) {
        if (message.snapshot.worldId !== next.worldId) return next;
        const oldFrame = olderFrame(next, message.snapshot);
        if (!oldFrame) next = { ...next, ...fromSnapshot(message.snapshot),
          playerNode: retainedPlayerNode(next, message.snapshot) };
        const world = message.world ?? message.snapshot.stop?.world;
        if (world !== undefined) next = withWorld(next, world);
        next = expirePresentation(next);
        if (!oldFrame) next = bindPresentation(next, message.snapshot);
        if (e.request.type === 'choose') next = { ...next, scene: retireNode(next.scene, e.request.node) };
        if (!staleTrigger && (e.request.type === 'dream' || e.request.type === 'claim') && next.tick !== null && !oldFrame) {
          next = { ...next, underworldRecorded: { worldId: next.worldId, tick: next.tick } };
        }
        return { ...next, error: oldFrame || staleTrigger ? s.error : null,
          errorKind: oldFrame || staleTrigger ? s.errorKind : undefined,
          errorOperation: oldFrame || staleTrigger ? s.errorOperation : undefined };
      }
      if (staleTrigger) return next;
      const tick = read?.tick ?? s.tick;
      return { ...next, error: message.error, errorKind: message.kind, errorOperation: e.request.type,
        worldRead: e.request.type === 'world-snapshot' && tick !== null && (s.worldRead === null || read !== null)
          ? { state: 'failed', worldId: s.worldId, tick, requestId: e.request.id } : next.worldRead };
    }
    case 'status': {
      if (e.snapshot.worldId !== s.worldId || s.runState === 'failed') return s;
      let next = ingest(s, e.snapshot);
      next = { ...next, ...decisionFields(next, e.snapshot) };
      if (olderFrame(next, e.snapshot)) return next;
      next = { ...next, ...fromSnapshot(e.snapshot),
        playerNode: retainedPlayerNode(next, e.snapshot),
        worldStatuses: e.snapshot.runState === 'running' && e.snapshot.stop === undefined
          ? Math.min(s.worldStatuses + 1, 10) : s.worldStatuses };
      if (e.snapshot.stop !== undefined) next = withWorld(next, e.snapshot.stop.world);
      return bindPresentation(expirePresentation(next), e.snapshot);
    }
    case 'request-failed': {
      if (e.request.type === 'world-snapshot' && e.worldId !== s.worldId && s.worldRead?.worldId === e.worldId
        && s.worldRead.requestId === e.request.id) {
        return { ...s, worldRead: null };
      }
      if (e.worldId !== s.worldId || s.runState === 'failed') return s;
      if (e.request.type === 'world-snapshot' && s.worldRead?.requestId !== e.request.id) return s;
      let next = clearPending(s, e.request);
      const action = next.actions.find(row => row.requestId === e.request.id);
      if (action !== undefined && terminal(action.phase)) return next;
      next = { ...next, actions: next.actions.map<UiAction>(row => row.requestId === e.request.id && !terminal(row.phase)
        ? { ...row, phase: 'unknown', error: e.error } : row) };
      if (next.decisionSendingRequestId === e.request.id) next = { ...next, decisionSendingRequestId: null };
      if (e.request.type === 'world-snapshot' && next.worldRead?.worldId === e.worldId && next.worldRead.requestId === e.request.id) {
        next = { ...next, worldRead: { ...next.worldRead, state: 'failed' } };
      }
      return gameplay(e.request) ? next : { ...next, error: 'Completion unknown. No retry was sent.',
        errorKind: 'sim-error', errorOperation: e.request.type };
    }
    case 'request-start-failed':
      return e.worldId !== s.worldId || s.runState === 'failed' ? s
        : { ...s, error: e.error, errorKind: 'sim-error', errorOperation: e.operation };
    case 'world-read-start-failed':
      if (e.worldId !== s.worldId || e.tick !== s.tick || s.runState === 'failed' || s.worldRead?.state === 'pending') return s;
      return { ...s, error: e.error, errorKind: 'sim-error', errorOperation: 'world-snapshot',
        worldRead: { state: 'failed', worldId: e.worldId, tick: e.tick }, worldStatuses: 0 };
    case 'fatal':
    case 'worker-error':
      return { ...s, runState: 'failed', error: e.error, errorKind: 'sim-error', errorOperation: undefined,
        createPending: false, stepPending: false, worldRead: null,
        actions: s.actions.filter(action => terminal(action.phase)), decisionSendingRequestId: null,
        decision: s.decision === null ? null : { ...s.decision, pending: null } };
    case 'seed-invalid': return { ...s, seedMessage: seedProblemMessage(e.problem),
      error: s.errorKind === 'validation' ? null : s.error,
      errorKind: s.errorKind === 'validation' ? undefined : s.errorKind,
      errorOperation: s.errorKind === 'validation' ? undefined : s.errorOperation };
    case 'validation-error': return { ...s, error: e.error, errorKind: 'validation', errorOperation: undefined, seedMessage: null };
    case 'scene-close': {
      const scene = closeScene(s.scene, e.expected);
      return scene === s.scene ? s : { ...s, scene, settledScene: null };
    }
    case 'scene-settled':
      return s.scene?.worldId === e.expected.worldId && s.scene.tick === e.expected.tick
        && s.scene.entries[0] === e.expected.entry && e.expected.entry.node === null
        ? { ...s, settledScene: e.expected } : s;
    case 'underworld-form': return { ...s, underworldForm: e.form };
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
  if (s.world !== null && BigInt(world.tick) < BigInt(s.world.tick)) return s;
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
  let scene = s.scene !== null && (s.scene.worldId !== s.worldId || s.runState === 'failed') ? null : s.scene;
  if (scene !== null) {
    for (const entry of scene.entries) {
      if (entry.node !== null && (!s.playerNode.pending || s.playerNode.node !== entry.node || s.playerNode.answered
        || s.world?.player_node?.id !== entry.node)) scene = retireNode(scene, entry.node);
    }
  }
  const sceneEpisode = s.sceneEpisode !== null
    && (s.sceneEpisode.worldId !== s.worldId || s.scene === null && s.sceneEpisode.tick !== s.tick) ? null : s.sceneEpisode;
  const recorded = s.underworldRecorded !== null
    && (s.underworldRecorded.worldId !== s.worldId || s.underworldRecorded.tick !== s.tick) ? null : s.underworldRecorded;
  return scene === s.scene && recorded === s.underworldRecorded && sceneEpisode === s.sceneEpisode ? s
    : { ...s, scene, sceneEpisode, underworldRecorded: recorded };
}

/** One stop-local FIFO retains history until Close; closed/retired identities stay excluded in this episode. */
function bindPresentation(s: UiState, snapshot: Snapshot): UiState {
  const world = s.world;
  if (world === null || s.tick === null || world.tick !== s.tick || s.runState === 'failed') return s;
  const reasons = snapshot.stop?.reasons ?? [];
  const facts = s.lifecycleEpisode === s.tick ? s.playerLifecycle : [];
  const deliveries = snapshot.story?.filter(delivery => delivery.worldId === s.worldId) ?? [];
  const dreams = deliveries.flatMap(delivery => delivery.batch.dreams);
  const events = deliveries.flatMap(delivery => delivery.batch.events);
  const candidates = sceneQueue(reasons, snapshot.stop?.world ?? world, s.worldId, facts,
    s.notebook.actors, dreams, events);
  const previous = s.sceneEpisode?.seen ?? [];
  const seen = new Set(previous);
  const retired = snapshot.stop !== undefined && s.scene !== null && s.scene.tick !== s.tick
    && s.settledScene?.entry === s.scene.entries[0]
    && candidates.some(candidate => !seen.has(candidate.identity)) ? s.settledScene.entry : null;
  const pending = new Map(s.scene?.entries.filter(entry => entry !== retired).map(entry => [entry.identity, entry]) ?? []);
  let lastDreamKey = s.lastDreamKey;
  const entries: SceneQueue['entries'] = [];
  for (const candidate of [...pending.values(), ...candidates]) {
    if (candidate.kind === 'dream' && candidate !== pending.get(candidate.identity)) {
      if (candidate.identity === lastDreamKey) continue;
      lastDreamKey = candidate.identity;
    }
    const retained = pending.get(candidate.identity);
    if (candidate.node !== null && (!s.playerNode.pending || s.playerNode.node !== candidate.node || s.playerNode.answered
      || s.actions.some(action => action.worldId === s.worldId && action.request?.type === 'choose'
        && action.request.node === candidate.node && action.phase === 'queued'))) {
      seen.add(candidate.identity);
      continue;
    }
    if (retained === candidate) {
      entries.push(retained);
      pending.delete(candidate.identity);
    } else if (!seen.has(candidate.identity)) entries.push(candidate);
    seen.add(candidate.identity);
  }
  if (s.sceneEpisode !== null && seen.size === previous.length && lastDreamKey === s.lastDreamKey
    && entries.length === (s.scene?.entries.length ?? 0) && entries.every((entry, index) => entry === s.scene!.entries[index])) return s;
  return { ...s, lastDreamKey, settledScene: retired === null ? s.settledScene : null,
    sceneEpisode: { worldId: s.worldId, tick: s.tick, seen: [...seen] },
    scene: entries.length === 0 ? null : { worldId: s.worldId,
      tick: entries[0]!.world.tick, world: entries[0]!.world, reasons, entries } };
}

/** One coherent live-world decision, independent of historical presentation. */
export function currentDecision(s: UiState): WorldSnapshot['player_node'] {
  const node = s.world?.player_node;
  if (s.worldId === 0 || s.runState === 'failed' || s.createPending || decisionBusy(s) || node == null
    || !s.playerNode.pending || s.playerNode.node !== node.id || s.playerNode.answered
    || s.actions.some(action => action.worldId === s.worldId && action.request?.type === 'choose'
      && action.request.node === node.id && !terminal(action.phase))) return null;
  return node;
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
  return s.decisionSendingRequestId !== null || s.decision?.pending?.worldId === s.worldId;
}

/** Fixed UI copy never includes provider text, options, usage, or quality claims. */
export function decisionNotice(s: UiState): string | null {
  if (decisionBusy(s)) return null;
  const outcome = s.decision?.outcome;
  if (outcome == null || outcome.worldId !== s.worldId || outcome.requestId !== s.decisionRequestId) return null;
  return outcome.kind === 'model' ? sourceLabel('external')
    : outcome.kind === 'fallback' ? sourceLabel('rules_default') : 'Decision cancelled.';
}

function staleDecision(s: UiState, snapshot: Snapshot): boolean {
  if (snapshot.worldId !== s.worldId) return false;
  const decision = snapshot.decision;
  if (decision === undefined) return false;
  const id = decision.pending?.requestId ?? decision.outcome?.requestId ?? 0;
  // A rejected trigger closes its request without creating an outcome. The
  // retained carrier (including no outcome) still accompanies fresh clock
  // snapshots, but no closed pending or other older decision may replace it.
  // Replies also check their own IDs; statuses have only this carrier binding.
  const retainedId = s.decision?.pending?.requestId ?? s.decision?.outcome?.requestId ?? 0;
  return id <= s.decisionRequestId && (id !== retainedId
    || (decision.pending !== null && s.decision?.pending?.requestId !== id));
}

function decisionFields(s: UiState, snapshot: Snapshot, requestId = 0): Pick<UiState, 'decision' | 'decisionRequestId'> {
  const completedCurrent = requestId !== 0 && requestId === s.decision?.pending?.requestId && snapshot.decision?.pending === null;
  if (!completedCurrent && staleDecision(s, snapshot)) return { decision: s.decision, decisionRequestId: Math.max(s.decisionRequestId, requestId) };
  if (snapshot.decision === undefined) return {
    decision: snapshot.worldId === s.worldId ? s.decision : null,
    decisionRequestId: Math.max(snapshot.worldId === s.worldId ? s.decisionRequestId : 0, requestId),
  };
  const decision = snapshot.decision;
  return { decision, decisionRequestId: Math.max(snapshot.worldId === s.worldId ? s.decisionRequestId : 0,
    decision.pending?.requestId ?? decision.outcome?.requestId ?? 0, requestId) };
}


function terminal(phase: ActionPhase): boolean { return phase === 'applied' || phase === 'rejected' || phase === 'cancelled'; }

function gameplay(request: Request): boolean {
  return ['choose', 'choose-and-run', 'dream', 'bribe', 'haunt', 'claim', 'carry-over', 'submit'].includes(request.type);
}

function recordSent(s: UiState, request: Request, worldId: number): UiState {
  if (!gameplay(request)) return s;
  const prior = s.actions.find(action => action.requestId === request.id);
  if (prior === undefined && hasObservation(s.settledRequests, String(request.id))) return s;
  return { ...s, actions: prior === undefined ? [...s.actions, {
    worldId, requestId: request.id, inputSeq: null, request,
    phase: request.type === 'dream' || request.type === 'bribe' ? 'deciding' : 'sending',
    submission: null, result: null, error: null,
  }] : s.actions.map(action => action === prior ? { ...action, request } : action) };
}

function recordReply(s: UiState, request: Request, message: ReplyMessage): UiState {
  if (!gameplay(request) || message.snapshot.worldId !== s.worldId) return s;
  let next = recordSent(s, request, s.worldId);
  next = { ...next, actions: next.actions.map<UiAction>(action => {
    if (action.requestId !== request.id) return action;
    if (terminal(action.phase)) return message.ok ? { ...action, submission: message.submission ?? action.submission } : action;
    return message.ok ? { ...action, phase: 'queued', submission: message.submission ?? null,
      inputSeq: message.submission?.seqs[0] ?? action.inputSeq, error: null }
      : { ...action, phase: message.kind === 'cancelled' ? 'cancelled' : 'rejected',
        error: message.error };
  }) };
  if (!message.ok) next = { ...next, settledRequests: addObservation(next.settledRequests, String(request.id)) };
  return request.type === 'dream' && message.ok ? settleDreams(next) : limitSettled(next);
}

function limitSettled(s: UiState): UiState {
  const settled = s.actions.filter(action => terminal(action.phase));
  if (settled.length <= 20) return s;
  const remove = new Set(settled.slice(0, settled.length - 20));
  return { ...s, actions: s.actions.filter(action => !remove.has(action)), settledOmitted: s.settledOmitted + remove.size };
}

/** Settle exact successful input sequences; presentation never upgrades queued receipts. */
function settleDreams(s: UiState): UiState {
  let actions = s.actions;
  let settledRequests = s.settledRequests;
  for (let index = 0; index < s.actions.length; index++) {
    const action = s.actions[index]!;
    if (action.request?.type !== 'dream' || terminal(action.phase)) continue;
    const sequences = action.submission?.seqs ?? (action.inputSeq === null ? [] : [action.inputSeq]);
    let dream: DreamFact | undefined;
    for (const sequence of sequences) {
      dream = s.notebook.dreamsByInputSeq.get(sequence);
      if (dream !== undefined) break;
    }
    if (dream === undefined) continue;
    if (actions === s.actions) actions = s.actions.slice();
    actions[index] = { ...action, inputSeq: dream.inputSeq, dream, phase: 'applied', error: null };
    if (action.requestId !== null) settledRequests = addObservation(settledRequests, String(action.requestId));
  }
  return limitSettled(actions === s.actions ? s : { ...s, actions, settledRequests,
    decisionSendingRequestId: s.decisionSendingRequestId !== null
      && hasObservation(settledRequests, String(s.decisionSendingRequestId)) ? null : s.decisionSendingRequestId });
}

/** Observations are merged before either decision or live-frame freshness gates. */
function ingest(s: UiState, snapshot: Snapshot): UiState {
  if (snapshot.worldId !== s.worldId) return s;
  const notebook = appendStory(s.notebook, snapshot.story ?? []);
  if (snapshot.actions.length === 0 && snapshot.playerLifecycle.length === 0) {
    const next = notebook === s.notebook ? s : { ...s, notebook };
    return notebook.dreamsByInputSeq === s.notebook.dreamsByInputSeq ? next : settleDreams(next);
  }
  let actions = s.actions;
  let settledOmitted = s.settledOmitted;
  let settledRequests = s.settledRequests;
  let observedActions = s.observedActions;
  let buffer: UiAction[] | null = null;
  type Link = { position: number; previous: Link | null; next: Link | null };
  type Chain = { first: Link; last: Link };
  const bySeq = new Map<string, Chain>();
  const byRequest = new Map<number, Chain>();
  const seqLinks: (Link | null)[] = [];
  const requestLinks: (Link | null)[] = [];
  const removed = new Set<number>();
  let settledCount = 0;
  function append<K>(index: Map<K, Chain>, key: K, position: number): Link {
    const chain = index.get(key);
    const link: Link = { position, previous: chain?.last ?? null, next: null };
    if (chain === undefined) index.set(key, { first: link, last: link });
    else { chain.last.next = link; chain.last = link; }
    return link;
  }
  function unlink<K>(index: Map<K, Chain>, key: K, link: Link): void {
    const chain = index.get(key)!;
    if (link.previous !== null) link.previous.next = link.next;
    else if (link.next !== null) chain.first = link.next;
    if (link.next !== null) link.next.previous = link.previous;
    else if (link.previous !== null) chain.last = link.previous;
    if (link.previous === null && link.next === null) index.delete(key);
  }
  function indexRow(row: UiAction, position: number): void {
    seqLinks.push(row.inputSeq === null ? null : append(bySeq, row.inputSeq, position));
    requestLinks.push(row.requestId === null ? null : append(byRequest, row.requestId, position));
    if (terminal(row.phase)) settledCount++;
  }
  for (const result of snapshot.actions) {
    if (result.worldId !== s.worldId || hasObservation(observedActions, result.input_seq)) continue;
    if (buffer === null) {
      buffer = s.actions.slice();
      for (let position = 0; position < buffer.length; position++) indexRow(buffer[position]!, position);
    }
    if (result.requestId !== null) settledRequests = addObservation(settledRequests, String(result.requestId));
    observedActions = addObservation(observedActions, result.input_seq);
    const seqPosition = bySeq.get(result.input_seq)?.first.position;
    const requestPosition = result.requestId === null ? undefined : byRequest.get(result.requestId)?.first.position;
    // Match either identity, retaining the first row in current delivery order.
    const position = seqPosition === undefined ? requestPosition
      : requestPosition === undefined ? seqPosition : Math.min(seqPosition, requestPosition);
    const prior = position === undefined ? undefined : buffer[position];
    if (position !== undefined && prior !== undefined) {
      removed.add(position);
      if (prior.inputSeq !== null) unlink(bySeq, prior.inputSeq, seqLinks[position]!);
      if (prior.requestId !== null) unlink(byRequest, prior.requestId, requestLinks[position]!);
      if (terminal(prior.phase)) settledCount--;
    }
    const settled: UiAction = { worldId: result.worldId, requestId: result.requestId, inputSeq: result.input_seq,
      request: prior?.request ?? null, phase: result.state, submission: prior?.submission ?? null, result,
      ...(prior?.dream === undefined ? {} : { dream: prior.dream }),
      error: result.state === 'rejected' ? result.reason : null };
    indexRow(settled, buffer.length);
    buffer.push(settled);
  }
  if (buffer !== null) {
    let discard = Math.max(0, settledCount - 20);
    settledOmitted += discard;
    let retained = 0;
    for (let position = 0; position < buffer.length; position++) {
      if (removed.has(position)) continue;
      const row = buffer[position]!;
      if (discard > 0 && terminal(row.phase)) { discard--; continue; }
      buffer[retained++] = row;
    }
    buffer.length = retained;
    actions = buffer;
  }
  let observedLifecycle = s.observedLifecycle;
  const fresh: PlayerLifecycleFact[] = [];
  for (const fact of snapshot.playerLifecycle) {
    const root = addObservation(observedLifecycle, fact.event);
    if (root === observedLifecycle) continue;
    observedLifecycle = root;
    fresh.push(fact);
  }
  // A delivered batch may contain birth and death at different ticks. Keep its complete episode.
  const newEpisode = fresh.length > 0 && snapshot.tick !== null
    && (s.lifecycleEpisode === null || BigInt(snapshot.tick) > BigInt(s.lifecycleEpisode));
  const playerLifecycle = fresh.length === 0 ? s.playerLifecycle : [...(newEpisode ? [] : s.playerLifecycle), ...fresh]
    .sort((a, b) => BigInt(a.event) < BigInt(b.event) ? -1 : BigInt(a.event) > BigInt(b.event) ? 1 : 0);
  const sendingSettled = s.decisionSendingRequestId !== null && hasObservation(settledRequests, String(s.decisionSendingRequestId));
  if (actions === s.actions && observedLifecycle === s.observedLifecycle && !sendingSettled && notebook === s.notebook) return s;
  const next = { ...s, notebook, actions, settledOmitted, observedActions, settledRequests, playerLifecycle, observedLifecycle,
    lifecycleEpisode: newEpisode ? snapshot.tick : s.lifecycleEpisode,
    decisionSendingRequestId: sendingSettled ? null : s.decisionSendingRequestId };
  return notebook.dreamsByInputSeq === s.notebook.dreamsByInputSeq ? next : settleDreams(next);
}

function olderFrame(s: UiState, snapshot: Snapshot): boolean {
  return s.tick !== null && snapshot.tick !== null && BigInt(snapshot.tick) < BigInt(s.tick);
}

/** An accepted exact-node answer cannot be rolled back by a delayed same-tick carrier. */
function retainedPlayerNode(s: UiState, snapshot: Snapshot): Snapshot['playerNode'] {
  if (s.tick === snapshot.tick && s.playerNode.pending && s.playerNode.answered && snapshot.playerNode.pending
    && s.playerNode.node === snapshot.playerNode.node) return s.playerNode;
  return snapshot.playerNode;
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
