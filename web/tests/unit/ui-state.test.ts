// Feature: web-shell, Property 7: UI reducer keeps the display honest
//
// Validates: Requirements 2.9, 3.6, 3.7, 5.8, 5.9
//
// Property 7 (design.md): For any sequence of UI events (replies for any
// request, statuses with any worldId, fatal and worker-error events,
// seed-invalid events): a failure reply, a fatal or a worker-error event never
// changes the displayed tick, checksum or worldId; a status whose worldId
// differs from the current one changes nothing; the error area is non-empty iff
// the most recent reply-or-fatal event was a failure; and a successful reply
// clears it.
//
// This test folds arbitrary UiEvent sequences through `reduce` from
// `initialUiState()` and checks the per-step invariants listed in task 3.4
// against the state before and after each event. The central honesty invariant
// -- that the displayed (tick, checksum) pair is never a mix of two snapshots --
// is checked by tracking, outside the reducer, the last snapshot the worker is
// recorded as having completed (the last snapshot a successful reply or an
// accepted status adopted, or the null/null initial): after every event the
// displayed (tick, checksum) must equal that tracked snapshot's pair exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import type { ActionResult, PlayerLifecycleFact, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import {
  initialUiState,
  reduce,
  controls,
  worldSnapshotNeeded,
  currentDecision,
  type UiEvent,
  type UiState,
} from '../../src/main/ui-state.ts';
import { hasObservation } from '../../src/main/observation-index.ts';
import type { Request, RunState, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import { pendingSnapshot, uiFor, waitingSnapshot } from './helpers/view.ts';

import type { StoryBatch } from '../../src/shared/story.ts';

// The reply message type, derived from the shared Worker_Protocol union rather
// than imported from `src/main/sim-client.ts`. `sim-client.ts` is DOM-only
// Main_Thread code (lib DOM), but this test is checked under tsconfig.node.json
// (lib ES2022 + node), so importing from it would pull DOM globals into a
// DOM-less program. `ReplyMessage` there is itself `Extract<WorkerMessage,
// { type: 'reply' }>`, so this is the identical type and is what `reduce`
// accepts for a `reply` event's `message` field.
type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;

const RUNS = 1000;

const RUN_STATES: readonly RunState[] = ['no-world', 'paused', 'running', 'failed'];

/** An arbitrary tick: a decimal string with no separators, or null. */
const tickArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map((n) => n.toString()),
);

/** An arbitrary checksum: 16 lowercase hex characters, or null. */
const hex16Arb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 16, maxLength: 16 })
  .map((cs) => cs.join(''));
const checksumArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  hex16Arb,
);

/**
 * Arbitrary snapshots. The worldId is drawn from a small set so that `status`
 * events frequently both match and mismatch the current worldId, and so that
 * successful replies frequently move the world forward and backward.
 */
function snapshotArb(): fc.Arbitrary<Snapshot> {
  return fc.record({
    worldId: fc.integer({ min: 0, max: 4 }),
    runState: fc.constantFrom(...RUN_STATES),
    tick: tickArb,
    checksum: checksumArb,
    tps: fc.oneof(fc.constant<number | null>(null), fc.nat({ max: 100000 })),
    speed: fc.constantFrom(1 / 30, 1 / 6, 1, 7, 30, 90, 365),
    actions: fc.constant<Snapshot['actions']>([]),
    playerLifecycle: fc.constant<Snapshot['playerLifecycle']>([]),
    playerNode: fc.oneof(
      fc.constant({ pending: false } as const),
      fc.record({ pending: fc.constant(true as const), node: fc.nat().map(String), answered: fc.boolean() }),
    ),
  });
}

/** An arbitrary originating request (the request a reply answers / request-sent carries). */
function requestArb(): fc.Arbitrary<Request> {
  return fc.oneof(
    fc.record({ type: fc.constant('create-world' as const), id: fc.nat(), seed: fc.string(), config: fc.string() }),
    fc.record({ type: fc.constant('run' as const), id: fc.nat() }),
    fc.record({ type: fc.constant('pause' as const), id: fc.nat() }),
    fc.record({ type: fc.constant('step' as const), id: fc.nat() }),
    fc.record({ type: fc.constant('set-speed' as const), id: fc.nat(), speed: fc.constantFrom(1 / 30, 1 / 6, 1, 7, 30, 90, 365) }),
    fc.record({ type: fc.constant('submit' as const), id: fc.nat(), input: fc.string() }),
  );
}

/** A successful reply message carrying an arbitrary snapshot. */
function okReplyArb(): fc.Arbitrary<ReplyMessage> {
  return fc.record({
    type: fc.constant('reply' as const),
    id: fc.nat(),
    ok: fc.constant(true as const),
    snapshot: snapshotArb(),
  });
}

/** A failure reply message. It still echoes a snapshot, which the reducer must ignore. */
function failReplyArb(): fc.Arbitrary<ReplyMessage> {
  return fc.record({
    type: fc.constant('reply' as const),
    id: fc.nat(),
    ok: fc.constant(false as const),
    kind: fc.constantFrom('sim-error', 'invalid-seed', 'invalid-speed', 'no-world', 'invalid-state', 'load-failed'),
    error: fc.string({ minLength: 1 }),
    snapshot: snapshotArb(),
  });
}

/** The full event space: every UiEvent kind, each with arbitrary payloads. */
function eventArb(): fc.Arbitrary<UiEvent> {
  return fc.oneof(
    // reply ok / fail, with arbitrary originating requests.
    fc.record({ type: fc.constant('reply' as const), request: requestArb(), message: okReplyArb() }),
    fc.record({ type: fc.constant('reply' as const), request: requestArb(), message: failReplyArb() }),
    // status with matching-or-mismatching worldId (the snapshot's worldId is arbitrary).
    fc.record({ type: fc.constant('status' as const), snapshot: snapshotArb() }),
    // fatal and worker-error.
    fc.record({ type: fc.constant('fatal' as const), error: fc.string({ minLength: 1 }) }),
    fc.record({ type: fc.constant('worker-error' as const), error: fc.string({ minLength: 1 }) }),
    // seed-invalid.
    fc.record({ type: fc.constant('seed-invalid' as const), problem: fc.constantFrom('empty', 'non-digit', 'too-large') }),
    // request-sent, with arbitrary requests (create-world and step drive the pending flags).
    fc.record({ type: fc.constant('request-sent' as const), request: requestArb() }),
  );
}

/** The (tick, checksum) pair of a state, for the single-source honesty check. */
function pair(s: Pick<UiState, 'tick' | 'checksum'>): { tick: string | null; checksum: string | null } {
  return { tick: s.tick, checksum: s.checksum };
}

/** The (tick, checksum) pair of a snapshot. */
function snapPair(snap: Snapshot): { tick: string | null; checksum: string | null } {
  return { tick: snap.tick, checksum: snap.checksum };
}

test('Property 7: the reducer keeps the display honest over arbitrary event sequences', () => {
  fc.assert(
    fc.property(fc.array(eventArb(), { maxLength: 60 }), (events) => {
      let state = initialUiState();

      // The single snapshot whose (tick, checksum) the display currently shows.
      // It starts at the null/null initial pair and only moves to a snapshot the
      // worker actually completed: a successful reply's snapshot or a status we
      // accepted (matching worldId). Failures, fatals, worker-errors, dropped
      // statuses, seed-invalid and request-sent must never change it.
      let adopted: { tick: string | null; checksum: string | null } = {
        tick: state.tick,
        checksum: state.checksum,
      };

      for (const e of events) {
        const prev = state;
        const next = reduce(prev, e);
        state = next;

        switch (e.type) {
          case 'reply': {
            const snap = e.message.snapshot;
            const replacement = e.request.type === 'create-world' && e.message.ok && snap.worldId > prev.worldId;
            const ignored = prev.runState === 'failed' || snap.worldId < prev.worldId
              || e.message.ok && !replacement && snap.worldId !== prev.worldId;
            const older = !replacement && prev.tick !== null && snap.tick !== null && BigInt(snap.tick) < BigInt(prev.tick);
            if (ignored) {
              assert.strictEqual(next, prev, 'old generations and post-fatal callbacks cannot change the live state');
              break;
            }
            if (e.message.ok && !older) {
              assert.equal(next.tick, snap.tick, 'fresh ok reply must adopt snapshot tick');
              assert.equal(next.checksum, snap.checksum, 'fresh ok reply must adopt snapshot checksum');
              assert.equal(next.worldId, snap.worldId, 'fresh ok reply must adopt snapshot worldId');
              assert.equal(next.runState, snap.runState, 'fresh ok reply must adopt snapshot runState');
              assert.equal(next.speed, snap.speed, 'fresh ok reply must adopt snapshot speed');
              assert.equal(next.error, null, 'fresh ok reply must clear the error area (R5.8)');
              adopted = snapPair(snap);
            } else if (e.message.ok) {
              assert.deepEqual(pair(next), pair(prev), 'older frames never roll the completed display back');
              assert.equal(next.worldId, prev.worldId);
              assert.equal(next.runState, prev.runState);
              assert.equal(next.error, prev.error);
            } else {
              // A failure reply never changes the displayed tick/checksum/worldId
              // (R3.6, R5.9); it only sets the error text from the reply.
              assert.equal(next.tick, prev.tick, 'failure reply must not change tick (R5.9)');
              assert.equal(next.checksum, prev.checksum, 'failure reply must not change checksum (R5.9)');
              assert.equal(next.worldId, prev.worldId, 'failure reply must not change worldId (R3.6)');
              assert.equal(next.runState, prev.runState, 'failure reply must not change runState');
              assert.equal(next.error, e.message.error, 'failure reply must show the error text (R5.8)');
            }
            // A reply clears exactly the pending flag of the request it answers,
            // regardless of success (R3.8, R4.10).
            if (e.request.type === 'create-world') {
              assert.equal(next.createPending, false, 'reply to create-world clears createPending');
              assert.equal(next.stepPending, replacement ? false : prev.stepPending, 'replacement clears old-world Step; otherwise Create leaves it');
            } else if (e.request.type === 'step') {
              assert.equal(next.stepPending, false, 'reply to step clears stepPending');
              assert.equal(next.createPending, prev.createPending, 'reply to step leaves createPending');
            } else {
              assert.equal(next.createPending, prev.createPending, 'other reply leaves createPending');
              assert.equal(next.stepPending, prev.stepPending, 'other reply leaves stepPending');
            }
            break;
          }

          case 'status': {
            if (e.snapshot.worldId !== prev.worldId || prev.runState === 'failed'
              || prev.tick !== null && e.snapshot.tick !== null && BigInt(e.snapshot.tick) < BigInt(prev.tick)) {
              // A status from a replaced world is dropped: nothing changes (R3.7).
              assert.deepEqual(next, prev, 'status with mismatched worldId must change nothing (R3.7)');
            } else {
              // A matching status adopts the live snapshot values and never
              // touches the error area.
              assert.equal(next.tick, e.snapshot.tick, 'matching status adopts tick');
              assert.equal(next.checksum, e.snapshot.checksum, 'matching status adopts checksum');
              assert.equal(next.worldId, e.snapshot.worldId, 'matching status keeps worldId');
              assert.equal(next.error, prev.error, 'status never changes the error area');
              adopted = snapPair(e.snapshot);
            }
            break;
          }

          case 'fatal':
          case 'worker-error': {
            // The worker can no longer be trusted: go to failed and show the text,
            // but keep the last completed tick/checksum and worldId (R2.9, R5.9).
            assert.equal(next.runState, 'failed', 'fatal/worker-error sets runState failed');
            assert.equal(next.error, e.error, 'fatal/worker-error sets the error text');
            assert.equal(next.tick, prev.tick, 'fatal/worker-error must not change tick (R5.9)');
            assert.equal(next.checksum, prev.checksum, 'fatal/worker-error must not change checksum (R5.9)');
            assert.equal(next.worldId, prev.worldId, 'fatal/worker-error must not change worldId');
            break;
          }

          case 'seed-invalid': {
            // Only the seed message changes; the world, run state and display stay.
            assert.equal(next.tick, prev.tick, 'seed-invalid must not change tick');
            assert.equal(next.checksum, prev.checksum, 'seed-invalid must not change checksum');
            assert.equal(next.worldId, prev.worldId, 'seed-invalid must not change worldId');
            assert.equal(next.runState, prev.runState, 'seed-invalid must not change runState');
            assert.notEqual(next.seedMessage, null, 'seed-invalid sets a seed message');
            break;
          }

          case 'request-sent': {
            // create-world sets createPending (and clears the seed message); step
            // sets stepPending; neither touches the displayed tick/checksum/worldId
            // (R3.8, R4.10).
            if (prev.runState === 'failed') {
              assert.strictEqual(next, prev, 'post-fatal request callbacks are ignored');
              break;
            }
            if (e.request.type === 'create-world') {
              assert.equal(next.createPending, true, 'request-sent create-world sets createPending');
              assert.equal(next.seedMessage, null, 'request-sent create-world clears the seed message');
            } else if (e.request.type === 'step') {
              assert.equal(next.stepPending, true, 'request-sent step sets stepPending');
            }
            assert.equal(next.tick, prev.tick, 'request-sent must not change tick');
            assert.equal(next.checksum, prev.checksum, 'request-sent must not change checksum');
            assert.equal(next.worldId, prev.worldId, 'request-sent must not change worldId');
            break;
          }
        }

        // The central honesty invariant (R5.4, R5.9): the displayed (tick,
        // checksum) pair is never a mix. After every event it must equal the
        // single snapshot last adopted (or the null/null initial). Because
        // `adopted` is only moved on a successful reply or an accepted status --
        // the exact two cases where the reducer copies a whole snapshot -- a
        // reducer that ever copied tick from one snapshot and checksum from
        // another, or that left a stale tick beside a fresh checksum, would fail
        // here.
        assert.deepEqual(pair(next), adopted, 'displayed (tick, checksum) must come from a single adopted snapshot');
      }
    }),
    { numRuns: RUNS },
  );
});

// A focused example sequence: create-world in flight, a successful reply adopts a
// snapshot and clears a prior error, then a failure reply keeps that display and
// shows its error, and a mismatched status is ignored.
test('Property 7: example -- failure after success keeps the adopted tick/checksum', () => {
  let s = initialUiState();

  // Send a create-world: createPending set, seed message cleared.
  s = reduce(s, { type: 'request-sent', request: { type: 'create-world', id: 1, seed: '7', config: '{}' } });
  assert.equal(s.createPending, true);

  // A local failure is cleared only by a successful reply.
  s = reduce(s, { type: 'validation-error', error: 'boom' });
  assert.equal(s.runState, 'no-world');
  assert.equal(s.error, 'boom');
  assert.equal(s.tick, null);
  assert.equal(s.checksum, null);

  // The create-world succeeds: adopt the snapshot and clear the error (R5.8).
  const snap: Snapshot = {
    worldId: 1,
    runState: 'paused',
    tick: '0',
    checksum: null,
    tps: null,
    speed: 1,
    actions: [], playerLifecycle: [], playerNode: { pending: false },
  };
  s = reduce(s, { type: 'reply', request: { type: 'create-world', id: 1, seed: '7', config: '{}' }, message: { type: 'reply', id: 1, ok: true, snapshot: snap } });
  assert.equal(s.error, null, 'success clears the error');
  assert.equal(s.createPending, false, 'success clears createPending');
  assert.equal(s.tick, '0');
  assert.equal(s.worldId, 1);

  // Step forward via a matching status to a real checksum.
  const running: Snapshot = { worldId: 1, runState: 'running', tick: '5', checksum: 'a1b2c3d4e5f60718', tps: 3, speed: 1, actions: [], playerLifecycle: [], playerNode: { pending: false } };
  s = reduce(s, { type: 'status', snapshot: running });
  assert.equal(s.tick, '5');
  assert.equal(s.checksum, 'a1b2c3d4e5f60718');

  // A failure reply must keep tick 5 / that checksum and only set the error (R5.9).
  const before = { tick: s.tick, checksum: s.checksum, worldId: s.worldId };
  s = reduce(s, {
    type: 'reply',
    request: { type: 'step', id: 2 },
    message: { type: 'reply', id: 2, ok: false, kind: 'invalid-state', error: 'cannot step while running', snapshot: { worldId: 9, runState: 'paused', tick: '999', checksum: '0000000000000000', tps: null, speed: 1, actions: [], playerLifecycle: [], playerNode: { pending: false } } },
  });
  assert.equal(s.tick, before.tick, 'failure keeps the tick');
  assert.equal(s.checksum, before.checksum, 'failure keeps the checksum');
  assert.equal(s.worldId, before.worldId, 'failure keeps the worldId');
  assert.equal(s.error, 'cannot step while running');

  // A status for a different world (worldId 2) is dropped entirely (R3.7).
  const stale = { ...s };
  s = reduce(s, { type: 'status', snapshot: { worldId: 2, runState: 'running', tick: '42', checksum: 'ffffffffffffffff', tps: 10, speed: 7, actions: [], playerLifecycle: [], playerNode: { pending: false } } });
  assert.deepEqual(s, stale, 'mismatched status changes nothing');
});

test('R8.9: run and step disable exactly for an unanswered node in otherwise enabled states', () => {
  fc.assert(fc.property(snapshotArb(), fc.boolean(), fc.boolean(), (snap, stepPending, createPending) => {
    const s = { ...initialUiState(), ...snap, actions: [], stepPending, createPending };
    const buttons = controls(s);
    const unanswered = snap.playerNode.pending && !snap.playerNode.answered;
    assert.equal(buttons.run, snap.runState === 'paused' && !unanswered);
    assert.equal(buttons.step, snap.runState === 'paused' && !stepPending && !unanswered);
    assert.equal(buttons.pause, snap.runState === 'running');
    assert.equal(buttons.create, !createPending && snap.runState !== 'failed');
  }), { numRuns: 1000 });
});

test('R8.9: stop, accepted choice, rejection and replacement keep UI gate in sync', () => {
  let s: UiState = { ...initialUiState(), worldId: 1, runState: 'paused' };
  const snap: Snapshot = { worldId: 1, runState: 'paused', tick: '641', checksum: '048d7b26bfabc97c',
    speed: 1, tps: null, actions: [], playerLifecycle: [], playerNode: { pending: true, node: '1', answered: false } };
  s = reduce(s, { type: 'status', snapshot: snap });
  assert.equal(controls(s).run, false);
  assert.equal(controls(s).step, false);
  s = reduce(s, { type: 'reply', request: { type: 'choose', id: 1, node: '1', option: 'repay_now' },
    message: { type: 'reply', id: 1, ok: false, kind: 'rejected', error: 'option_not_in_set', snapshot: snap } });
  assert.equal(controls(s).run, false);
  s = reduce(s, { type: 'reply', request: { type: 'choose', id: 2, node: '1', option: 'repay_now' },
    message: { type: 'reply', id: 2, ok: true, snapshot: { ...snap, playerNode: { pending: true, node: '1', answered: true } } } });
  assert.equal(controls(s).run, true);
  assert.equal(controls(s).step, true);
  s = reduce(s, { type: 'reply', request: { type: 'create-world', id: 3, seed: '1', config: '{}' },
    message: { type: 'reply', id: 3, ok: true, snapshot: { ...snap, worldId: 2, tick: '0', checksum: null, playerNode: { pending: false } } } });
  s = reduce(s, { type: 'status', snapshot: snap });
  assert.deepEqual(s.playerNode, { pending: false });
  assert.equal(controls(s).run, true);
});

test('R9.2: reducer adopts only completed World carriers and preserves them between stops', () => {
  const world: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));
  const snapshot: Snapshot = { worldId: 1, runState: 'paused', tick: '500', checksum: 'a1b2c3d4e5f60718',
    speed: 1, tps: null, actions: [], playerLifecycle: [], playerNode: { pending: false } };
  const request: Request = { type: 'world-snapshot', id: 1 };
  let s = reduce({ ...initialUiState(), worldId: 1 }, { type: 'reply', request,
    message: { type: 'reply', id: 1, ok: true, snapshot, world } });
  assert.equal(s.world, world);
  const running: Snapshot = { ...snapshot, runState: 'running', tick: '550' };
  s = reduce(s, { type: 'status', snapshot: running });
  assert.equal(s.world, world, 'ordinary statuses do not invent a World');
  const stopped = { ...world, tick: '641' };
  s = reduce(s, { type: 'status', snapshot: { ...snapshot, tick: '641', stop: { reasons: ['player_node'], world: stopped } } });
  assert.equal(s.world, stopped);
  s = reduce(s, { type: 'reply', request, message: { type: 'reply', id: 1, ok: false, kind: 'rejected', error: 'option_not_in_set', snapshot } });
  assert.equal(s.world, stopped);
  s = reduce(s, { type: 'status', snapshot: { ...snapshot, worldId: 2, stop: { reasons: ['player_node'], world } } });
  assert.equal(s.world, stopped, 'stale-world status does not replace the display');
  s = reduce(s, { type: 'reply', request: { type: 'create-world', id: 2, seed: '1', config: '{}' },
    message: { type: 'reply', id: 2, ok: true, snapshot: { ...snapshot, worldId: 2, tick: '0', checksum: null } } });
  assert.equal(s.world, null, 'replacement without a World never retains the old town');
});

test('R9.9: a manual pause adopts stop.world and reply.world takes precedence', () => {
  const world: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));
  const paused: Snapshot = { worldId: 1, runState: 'paused', tick: '500', checksum: 'a1b2c3d4e5f60718',
    speed: 1, tps: null, actions: [], playerLifecycle: [], playerNode: { pending: false }, stop: { reasons: ['user'], world } };
  const running: UiState = { ...initialUiState(), worldId: 1, runState: 'running', tick: '400', world: { ...world, tick: '400' } };
  const request: Request = { type: 'pause', id: 1 };
  const stopped = reduce(running, { type: 'reply', request, message: { type: 'reply', id: 1, ok: true, snapshot: paused } });
  assert.equal(stopped.world, world);
  assert.equal(stopped.tick, world.tick);
  assert.equal(worldSnapshotNeeded(stopped), false);
  const preferred = { ...world };
  const both = reduce(running, { type: 'reply', request, message: { type: 'reply', id: 1, ok: true, snapshot: paused, world: preferred } });
  assert.equal(both.world, preferred);
});

const deliveryWorld: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));

function deliveryState(tick = '0', runState: RunState = 'paused'): UiState {
  return { ...initialUiState(), worldId: 1, tick, runState, world: { ...deliveryWorld, tick } };
}

function deliverySnapshot(s: UiState): Snapshot {
  return { worldId: s.worldId, runState: s.runState, tick: s.tick, checksum: s.checksum,
    tps: s.tps, speed: s.speed, actions: [], playerLifecycle: [], playerNode: s.playerNode };
}

function deliveryReply(s: UiState, request: Request, snapshot: Snapshot, world?: WorldSnapshot): UiState {
  return reduce(s, { type: 'reply', request, message: { type: 'reply', id: request.id, ok: true, snapshot, ...(world ? { world } : {}) } });
}

function startWorldRead(s: UiState): UiState {
  assert.equal(worldSnapshotNeeded(s), true);
  const next = reduce(s, { type: 'request-sent', request: { type: 'world-snapshot', id: 99 } });
  assert.deepEqual(next.worldRead, { state: 'pending', worldId: s.worldId, tick: s.tick, requestId: 99 });
  assert.equal(worldSnapshotNeeded(next), false);
  return next;
}

function finishWorldRead(s: UiState, ok = true): UiState {
  const read = s.worldRead!;
  assert.equal(read.state, 'pending');
  const tick = read.worldId === s.worldId ? s.tick! : read.tick;
  const snapshot = { ...deliverySnapshot(s), worldId: read.worldId, tick };
  const request: Request = { type: 'world-snapshot', id: 99 };
  return ok
    ? deliveryReply(s, request, snapshot, { ...deliveryWorld, tick })
    : reduce(s, { type: 'reply', request, message: { type: 'reply', id: 99, ok: false, kind: 'sim-error', error: 'read failed', snapshot } });
}

function runningStatus(s: UiState, advance = true): UiState {
  const tick = advance ? String(BigInt(s.tick!) + 1n) : s.tick;
  return reduce(s, { type: 'status', snapshot: { ...deliverySnapshot(s), runState: 'running', tick } });
}

test('R9.9: create requests one World and a non-stop Step requests the new tick', () => {
  const create: Request = { type: 'create-world', id: 1, seed: '1', config: '{}' };
  let s = deliveryReply(initialUiState(), create, deliverySnapshot(deliveryState()));
  assert.equal(s.world, null);
  s = startWorldRead(s);
  assert.equal(worldSnapshotNeeded(reduce(s, { type: 'seed-invalid', problem: 'empty' })), false);
  s = finishWorldRead(s);
  assert.equal(s.world!.tick, '0');
  assert.equal(worldSnapshotNeeded(s), false);
  s = deliveryReply(s, { type: 'step', id: 2 }, { ...deliverySnapshot(s), tick: '1' });
  assert.equal(s.world!.tick, '0');
  s = finishWorldRead(startWorldRead(s));
  assert.equal(s.world!.tick, '1');
  assert.equal(worldSnapshotNeeded(s), false);
});

test('R9.9: a stop Step takes its status World and its reply requests no second read', () => {
  let s = deliveryState();
  const world = { ...deliveryWorld, tick: '1' };
  s = reduce(s, { type: 'status', snapshot: { ...deliverySnapshot(s), tick: '1', stop: { reasons: ['player_node'], world } } });
  assert.equal(s.world, world);
  s = deliveryReply(s, { type: 'step', id: 1 }, deliverySnapshot(s));
  assert.equal(s.world, world);
  assert.equal(worldSnapshotNeeded(s), false);
});

test('R9.9: only the tenth running status requests a World; a carrier resets the count', () => {
  let s = deliveryState('0', 'running');
  for (let index = 1; index <= 9; index++) {
    s = runningStatus(s);
    assert.equal(worldSnapshotNeeded(s), false);
  }
  s = startWorldRead(runningStatus(s));
  assert.equal(s.worldStatuses, 0);
  s = finishWorldRead(s);
  assert.equal(s.world!.tick, '10');
  for (let index = 0; index < 9; index++) s = runningStatus(s);
  const carrier = { ...deliveryWorld, tick: s.tick! };
  s = deliveryReply(s, { type: 'choose', id: 2, node: '1', option: 'repay_now' }, deliverySnapshot(s), carrier);
  assert.equal(s.worldStatuses, 0);
  assert.equal(worldSnapshotNeeded(s), false);
});

test('R9.9: no second read while one is outstanding, even across statuses and a pause', () => {
  let s = { ...deliveryState('0', 'running'), worldStatuses: 10 };
  s = startWorldRead(s);
  const pending = s.worldRead;
  for (let index = 0; index < 20; index++) {
    s = runningStatus(s);
    assert.equal(worldSnapshotNeeded(s), false);
  }
  s = deliveryReply(s, { type: 'pause', id: 1 }, { ...deliverySnapshot(s), runState: 'paused' });
  assert.equal(s.worldRead, pending);
  assert.equal(worldSnapshotNeeded(s), false);
  s = finishWorldRead(s);
  assert.equal(s.world!.tick, s.tick);
  assert.equal(worldSnapshotNeeded(s), false);
});

test('R9.9: a failed running read consumes ten statuses before the next attempt', () => {
  let s = deliveryState('0', 'running');
  for (let index = 0; index < 10; index++) s = runningStatus(s);
  s = finishWorldRead(startWorldRead(s), false);
  assert.deepEqual(s.worldRead, { state: 'failed', worldId: 1, tick: '10', requestId: 99 });
  assert.equal(worldSnapshotNeeded(s), false);
  for (let index = 1; index <= 9; index++) {
    s = runningStatus(s);
    assert.equal(worldSnapshotNeeded(s), false, `status ${index} after failure cannot retry`);
  }
  s = runningStatus(s);
  assert.equal(s.tick, '20');
  assert.equal(worldSnapshotNeeded(s), true, 'the tenth status after failure permits the next tick read');
});

test('R9.9: failed reads are not repeated at the same paused or running tick', () => {
  let s = finishWorldRead(startWorldRead({ ...deliveryState('1'), world: null }), false);
  for (let index = 0; index < 3; index++) {
    s = reduce(s, { type: 'seed-invalid', problem: 'empty' });
    assert.equal(worldSnapshotNeeded(s), false);
  }
  s = deliveryReply(s, { type: 'step', id: 2 }, { ...deliverySnapshot(s), tick: '2' });
  assert.equal(worldSnapshotNeeded(s), true);
  s = deliveryState('0', 'running');
  for (let index = 0; index < 10; index++) s = runningStatus(s);
  s = finishWorldRead(startWorldRead(s), false);
  for (let index = 0; index < 10; index++) s = runningStatus(s, false);
  assert.equal(worldSnapshotNeeded(s), false, 'a frozen tick is not retried even after ten statuses');
  assert.equal(worldSnapshotNeeded(runningStatus(s)), true);
});

test('R9.9: replacement waits for the old read and ignores its World or rejection', () => {
  for (const ok of [true, false]) {
    let s = startWorldRead({ ...deliveryState('1'), world: null });
    const read = s.worldRead;
    s = deliveryReply(s, { type: 'create-world', id: 2, seed: '2', config: '{}' },
      { ...deliverySnapshot(s), worldId: 2, tick: '0' });
    assert.equal(s.world, null);
    assert.equal(s.worldRead, read);
    assert.equal(worldSnapshotNeeded(s), false);
    s = finishWorldRead(s, ok);
    assert.equal(s.worldId, 2);
    assert.equal(s.tick, '0');
    assert.equal(s.world, null);
    assert.equal(s.error, null);
    assert.equal(s.worldRead, null);
    s = finishWorldRead(startWorldRead(s));
    assert.equal(s.world!.tick, '0');
    assert.equal(worldSnapshotNeeded(s), false);
  }
});

test('R9.9: a transport failure marks its read tick and a stale failure cannot affect a new World', () => {
  let s = startWorldRead({ ...deliveryState('1'), world: null });
  s = reduce(s, { type: 'request-failed', request: { type: 'world-snapshot', id: 99 }, worldId: 1, error: 'reply timeout' });
  assert.equal(s.error, 'Completion unknown. No retry was sent.');
  assert.equal(worldSnapshotNeeded(s), false);
  s = startWorldRead({ ...deliveryState('1'), world: null });
  s = deliveryReply(s, { type: 'create-world', id: 2, seed: '2', config: '{}' }, { ...deliverySnapshot(s), worldId: 2, tick: '0' });
  s = reduce(s, { type: 'request-failed', request: { type: 'world-snapshot', id: 99 }, worldId: 1, error: 'old timeout' });
  assert.equal(s.error, null);
  assert.equal(worldSnapshotNeeded(s), true);
});

// Unnumbered R9.9 schedule property: no clock, simulation outcome or DOM is read.
test('R9.9: generated event sequences keep reads single-flight, spaced and paused Worlds covered', () => {
  const action = fc.oneof(
    { weight: 8, arbitrary: fc.constant('status') },
    { weight: 1, arbitrary: fc.constantFrom('run', 'pause', 'step', 'stop', 'create', 'read-ok', 'read-fail', 'transport-fail', 'stale-status') },
  );
  fc.assert(fc.property(fc.array(action, { maxLength: 120 }), actions => {
    let s = deliveryState();
    let outstanding: { worldId: number; tick: string } | null = null;
    let statuses = 0;
    let lastRunningRead = 0;
    for (const next of actions) {
      const snapshot = deliverySnapshot(s);
      switch (next) {
        case 'status':
          if (s.runState === 'running') { s = runningStatus(s); statuses++; }
          break;
        case 'run':
          s = deliveryReply(s, { type: 'run', id: 1 }, { ...snapshot, runState: 'running' });
          break;
        case 'pause':
          s = deliveryReply(s, { type: 'pause', id: 1 }, { ...snapshot, runState: 'paused',
            stop: { reasons: ['user'], world: { ...deliveryWorld, tick: s.tick! } } });
          break;
        case 'step':
          if (s.runState === 'paused') s = deliveryReply(s, { type: 'step', id: 1 }, { ...snapshot, tick: String(BigInt(s.tick!) + 1n) });
          break;
        case 'stop':
          s = reduce(s, { type: 'status', snapshot: { ...snapshot, runState: 'paused',
            stop: { reasons: ['player_node'], world: { ...deliveryWorld, tick: s.tick! } } } });
          break;
        case 'create':
          s = deliveryReply(s, { type: 'create-world', id: 1, seed: '1', config: '{}' },
            { ...snapshot, worldId: s.worldId + 1, tick: '0', runState: 'paused' });
          break;
        case 'read-ok':
        case 'read-fail':
          if (outstanding !== null) { s = finishWorldRead(s, next === 'read-ok'); outstanding = null; }
          break;
        case 'transport-fail':
          if (outstanding !== null) {
            s = reduce(s, { type: 'request-failed', request: { type: 'world-snapshot', id: 99 }, worldId: outstanding.worldId, error: 'reply timeout' });
            outstanding = null;
          }
          break;
        case 'stale-status': {
          const before = s;
          s = reduce(s, { type: 'status', snapshot: { ...snapshot, worldId: s.worldId + 100 } });
          assert.equal(s, before);
          break;
        }
      }
      if (worldSnapshotNeeded(s)) {
        assert.equal(outstanding, null, 'no request overlaps an outstanding read from any World');
        if (s.runState === 'running') {
          assert.ok(statuses - lastRunningRead >= 10, 'running reads are at least ten running statuses apart');
          lastRunningRead = statuses;
        }
        outstanding = { worldId: s.worldId, tick: s.tick! };
        s = startWorldRead(s);
      }
      assert.equal(s.worldRead?.state === 'pending', outstanding !== null);
      if (s.runState === 'paused' && (s.world === null || s.world.tick !== s.tick)) {
        assert.ok(outstanding !== null || (s.worldRead?.state === 'failed' && s.worldRead.worldId === s.worldId && s.worldRead.tick === s.tick),
          'a stale paused World has an outstanding read or a failure at this tick');
      }
    }
  }), { numRuns: RUNS });
});

test('LU-R3: current options remain available behind numerically ordered historical scenes without changing Run or Step', () => {
  const world = { ...waitingSnapshot(), last_dream: { tick: '499', dreamer: 1, applied: 'take_comfort' as const }, player_node: pendingSnapshot('inheritance').player_node };
  let ui = uiFor(world);
  const ghost = world.player.earlier_bodies[0]!;
  const playerLifecycle: PlayerLifecycleFact[] = [
    { event: '40', tick: world.tick, kind: 'death', body: ghost.id, name: ghost.name, origin: ghost.origin },
    { event: '41', tick: world.tick, kind: 'birth', body: ghost.id, name: ghost.name, origin: ghost.origin },
  ];
  const snapshot: Snapshot = { worldId: 1, runState: 'paused', tick: world.tick, checksum: null, speed: 1, tps: null, actions: [], playerLifecycle, playerNode: ui.playerNode };
  ui = reduce(ui, { type: 'status', snapshot: { ...snapshot, stop: { reasons: ['player_died', 'dream_resolved', 'player_reborn', 'player_node'], world } } });
  assert.equal(currentDecision(ui) !== null, true);
  const shell = controls(ui);
  for (let index = 0; index < 3; index++) {
    ui = reduce(ui, { type: 'scene-close', expected: { worldId: ui.scene!.worldId, tick: ui.scene!.tick, entry: ui.scene!.entries[0]! } });
    assert.deepEqual(controls(ui), shell);
  }
  assert.equal(currentDecision(ui) !== null, true);
  const before = ui.scene;
  ui = reduce(ui, { type: 'scene-close', expected: { worldId: ui.scene!.worldId, tick: ui.scene!.tick, entry: ui.scene!.entries[0]! } });
  assert.equal(ui.scene, before, 'a node scene has no independent close');
});

test('LV-C4: same-tick Run then user Pause retains unclosed Dream identity and FIFO until Close', () => {
  const world = { ...waitingSnapshot(), last_dream: { tick: '499', dreamer: 1, applied: 'take_comfort' as const } };
  let ui = uiFor(world);
  const ghost = world.player.earlier_bodies[0]!;
  const birth: PlayerLifecycleFact = { event: '40', tick: '498', kind: 'birth', body: ghost.id, name: ghost.name, origin: ghost.origin };
  const death: PlayerLifecycleFact = { event: '41', tick: '499', kind: 'death', body: ghost.id, name: ghost.name, origin: ghost.origin };
  const opening: Snapshot = { ...deliverySnapshot(ui), playerLifecycle: [birth], stop: { reasons: ['dream_resolved'], world } };
  ui = reduce(ui, { type: 'status', snapshot: opening });
  const [retainedBirth, dream] = ui.scene!.entries;
  assert.equal(dream!.identity, '[1,"dream","499"]');
  const closeBirth = { worldId: ui.scene!.worldId, tick: ui.scene!.tick, entry: retainedBirth! };

  const run: Request = { type: 'run', id: 1 };
  ui = reduce(ui, { type: 'request-sent', request: run });
  ui = deliveryReply(ui, run, { ...deliverySnapshot(ui), runState: 'running' });
  assert.equal(ui.runState, 'running');
  assert.equal(ui.tick, world.tick, 'Run has not advanced a tick');
  assert.equal(ui.scene!.entries[0], retainedBirth);
  assert.equal(ui.scene!.entries[1], dream);

  const pause: Request = { type: 'pause', id: 2 };
  ui = reduce(ui, { type: 'request-sent', request: pause });
  const paused: Snapshot = { ...deliverySnapshot(ui), runState: 'paused', playerLifecycle: [death], stop: { reasons: ['user'], world } };
  ui = deliveryReply(ui, pause, paused);
  assert.equal(ui.runState, 'paused');
  assert.equal(ui.tick, world.tick, 'Pause replies before the next completed tick');
  assert.equal(ui.scene!.entries[0], retainedBirth);
  assert.equal(ui.scene!.entries[1], dream);
  const funeral = ui.scene!.entries[2]!;
  const retained = ui;

  ui = reduce(ui, { type: 'scene-close', expected: closeBirth });
  assert.equal(ui.scene!.entries[0], dream);
  ui = reduce(ui, { type: 'scene-close', expected: { worldId: ui.scene!.worldId, tick: ui.scene!.tick, entry: dream! } });
  assert.equal(ui.scene!.entries[0], funeral);
  ui = reduce(ui, { type: 'status', snapshot: opening });
  ui = deliveryReply(ui, pause, paused);
  assert.equal(ui.scene!.entries[0], funeral, 'duplicate carriers cannot replay closed historical entries');

  const advanced = reduce(retained, { type: 'status', snapshot: { ...deliverySnapshot(retained), runState: 'running', tick: '501' } });
  assert.equal(advanced.scene, retained.scene, 'ordinary ticks cannot cancel an active historical performance');
  const late = reduce(advanced, { type: 'status', snapshot: opening });
  assert.equal(late.tick, '501');
  assert.equal(late.scene, advanced.scene, 'an older stop cannot replace the retained history');
  const closedAfterTick = reduce(advanced, { type: 'scene-close', expected: closeBirth });
  assert.equal(closedAfterTick.scene!.entries[0], dream, 'the exact historical entry stays closeable after ordinary ticks');

  const replaced = deliveryReply(retained, { type: 'create-world', id: 3, seed: '2', config: '{}' },
    { ...deliverySnapshot(retained), worldId: 2, tick: '0' });
  assert.equal(replaced.scene, null, 'World replacement invalidates unclosed history');
  assert.equal(replaced.sceneEpisode, null);
  assert.equal(reduce(replaced, { type: 'status', snapshot: opening }), replaced);
  const staleClose = reduce(replaced, { type: 'scene-close', expected: closeBirth });
  assert.equal(staleClose.worldId, replaced.worldId);
  assert.equal(staleClose.tick, replaced.tick);
  assert.deepEqual(staleClose.world, replaced.world);
  assert.deepEqual(staleClose.notebook, replaced.notebook);
  assert.equal(staleClose.scene, null);
});

test('R11.13: an accepted claim records its tick, rejection keeps it, and replacement clears it', () => {
  const world = waitingSnapshot();
  let ui = uiFor(world);
  const snapshot: Snapshot = { worldId: 1, runState: 'paused', tick: world.tick, checksum: null, speed: 1, tps: null, actions: [], playerLifecycle: [], playerNode: { pending: false } };
  const request: Request = { type: 'claim', id: 1, slot: 'imported_vessel', carryOver: null };
  ui = reduce(ui, { type: 'reply', request, message: { type: 'reply', id: 1, ok: true, snapshot, world } });
  assert.deepEqual(ui.underworldRecorded, { worldId: 1, tick: world.tick });
  assert.equal(ui.world, world);
  ui = reduce(ui, { type: 'reply', request, message: { type: 'reply', id: 1, ok: false, kind: 'rejected', error: 'claim_held', snapshot } });
  assert.deepEqual(ui.underworldRecorded, { worldId: 1, tick: world.tick });
  assert.equal(ui.world, world);
  ui = reduce(ui, { type: 'reply', request: { type: 'create-world', id: 2, seed: '2', config: '{}' }, message: {
    type: 'reply', id: 2, ok: true, snapshot: { ...snapshot, worldId: 2, tick: '0' },
  } });
  assert.equal(ui.underworldRecorded, null);
});

test('LV-C2: terminal action facts survive delayed queued replies and request-sent in either order', () => {
  for (const sendFirst of [false, true]) {
    let ui = uiFor(waitingSnapshot());
    const request: Request = { type: 'bribe', id: 23, amount: '18446744073709551614' };
    const action: ActionResult = { worldId: 1, requestId: 23, input_seq: '100', tick: '501', kind: 'bribe', state: 'applied',
      amount: request.amount, ghost: 2, offering_event: '90', appeal_event: '91',
      ruling: { node: '30', magistrate: 9, applied: 'deny', source: 'rules_default', rules_default: 'deny' } };
    if (sendFirst) ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
    ui = reduce(ui, { type: 'status', snapshot: { ...deliverySnapshot(ui), tick: '501', actions: [action] } });
    if (!sendFirst) ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
    assert.equal(ui.actions.length, 1); assert.equal(ui.actions[0]!.phase, 'applied');
    assert.equal(ui.decisionSendingRequestId, null);
    ui = reduce(ui, { type: 'reply', request, worldId: 1, message: {
      type: 'reply', id: 23, ok: true, submission: { tick: '500', seqs: ['100', '101'] },
      snapshot: { ...deliverySnapshot(ui), tick: '500' },
    } });
    assert.equal(ui.actions[0]!.phase, 'applied'); assert.equal(ui.actions[0]!.result, action);
    assert.equal(ui.actions[0]!.requestId, 23); assert.equal(ui.actions[0]!.inputSeq, '100');
    assert.deepEqual(ui.actions[0]!.submission, { tick: '500', seqs: ['100', '101'] });
    assert.equal(ui.tick, '501');
    const terminal = ui.actions[0]!.result;
    ui = reduce(ui, { type: 'request-failed', request, worldId: 1, error: 'late timeout' });
    assert.equal(ui.actions[0]!.phase, 'applied'); assert.equal(ui.actions[0]!.result, terminal);
  }
});

test('LV-C2: settled display retains twenty while pending and unknown actions remain unbounded and empty leaves are idempotent', () => {
  let ui = uiFor(waitingSnapshot());
  for (let index = 0; index < 60; index++) {
    const request: Request = { type: 'haunt', id: 100 + index, target: 1 };
    ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
    if (index % 2 === 0) ui = reduce(ui, { type: 'request-failed', request, worldId: 1, error: 'timeout' });
  }
  const actions: ActionResult[] = Array.from({ length: 25 }, (_, index) => ({
    worldId: 1, requestId: null, input_seq: String(index + 1), tick: '501', kind: 'haunt', state: 'rejected',
    reason: 'rate_limited', target: 1,
  }));
  const carrier = { ...deliverySnapshot(ui), tick: '501', actions };
  ui = reduce(ui, { type: 'status', snapshot: carrier });
  assert.equal(ui.actions.filter(action => action.phase === 'sending' || action.phase === 'unknown').length, 60);
  assert.equal(ui.actions.filter(action => action.phase === 'rejected').length, 20);
  assert.equal(ui.settledOmitted, 5);
  assert.deepEqual(ui.actions.filter(action => action.result !== null).map(action => action.inputSeq),
    Array.from({ length: 20 }, (_, index) => String(index + 6)));
  const retained = ui.actions;
  ui = reduce(ui, { type: 'status', snapshot: carrier });
  ui = reduce(ui, { type: 'status', snapshot: { ...carrier, tick: '502', actions: [], playerLifecycle: [] } });
  assert.deepEqual(ui.actions, retained); assert.equal(ui.settledOmitted, 5);
  for (const action of actions) assert.equal(hasObservation(ui.observedActions, action.input_seq), true);
  assert.equal(hasObservation(ui.observedActions, '26'), false); assert.equal(ui.tick, '502');
});

test('LV-C2: complete same-batch birth and death facts merge once without turning a waiting Soul into a living body', () => {
  let ui = uiFor(waitingSnapshot());
  const facts: PlayerLifecycleFact[] = [
    { event: '80', tick: '498', kind: 'birth', body: 20, name: 'New Body', origin: 'native' },
    { event: '81', tick: '500', kind: 'death', body: 20, name: 'New Body', origin: 'native' },
  ];
  const snapshot: Snapshot = { ...deliverySnapshot(ui), playerLifecycle: facts,
    stop: { reasons: ['player_died', 'player_reborn'], world: ui.world! } };
  ui = reduce(ui, { type: 'status', snapshot });
  const episode = ui.scene;
  ui = reduce(ui, { type: 'status', snapshot });
  ui = reduce(ui, { type: 'status', snapshot: { ...deliverySnapshot(ui), tick: '501' } });
  assert.deepEqual(ui.playerLifecycle, facts);
  for (const fact of facts) assert.equal(hasObservation(ui.observedLifecycle, fact.event), true);
  assert.equal(hasObservation(ui.observedLifecycle, '82'), false);
  assert.equal(ui.world!.player.place, 'waiting'); assert.equal(ui.world!.player.body, null);
});

test('LV-C2: successful Create resets old action form and lifecycle bindings while late callbacks cannot overwrite the new World', () => {
  let ui = uiFor(waitingSnapshot());
  const old: Request = { type: 'haunt', id: 1, target: 1 };
  ui = reduce(ui, { type: 'request-sent', request: old, worldId: 1 });
  ui = reduce(ui, { type: 'underworld-form', form: { ...ui.underworldForm, carryOver: 'greed',
    customization: { kind: 'Set', trait: 'warmth', value: 3 } } });
  const oldSnapshot = deliverySnapshot(ui);
  const create: Request = { type: 'create-world', id: 2, seed: '2', config: '{}' };
  const freshWorld = { ...deliveryWorld, tick: '0' };
  ui = reduce(ui, { type: 'reply', request: create, worldId: 1, message: {
    type: 'reply', id: 2, ok: true, snapshot: { ...oldSnapshot, worldId: 2, tick: '0' }, world: freshWorld,
  } });
  assert.equal(ui.worldId, 2); assert.equal(ui.world, freshWorld); assert.equal(ui.actions.length, 0);
  assert.equal(ui.underworldForm.customization, null); assert.equal(ui.underworldForm.carryOver, null);
  assert.equal(ui.playerLifecycle.length, 0); assert.equal(ui.decisionSendingRequestId, null);
  const replaced = ui;
  ui = reduce(ui, { type: 'request-failed', request: old, worldId: 1, error: 'old timeout' });
  ui = reduce(ui, { type: 'reply', request: old, worldId: 1, message: {
    type: 'reply', id: 1, ok: false, kind: 'rejected', error: 'old failure', snapshot: oldSnapshot,
  } });
  ui = reduce(ui, { type: 'status', snapshot: oldSnapshot });
  assert.equal(ui, replaced);
});

test('LV-C2: a stale issued read failure cannot fail or release a newer same-world read', () => {
  let ui = startWorldRead({ ...deliveryState('0'), world: null });
  ui = finishWorldRead(ui);
  ui = reduce(ui, { type: 'status', snapshot: { ...deliverySnapshot(ui), tick: '1' } });
  ui = reduce(ui, { type: 'request-sent', request: { type: 'world-snapshot', id: 100 }, worldId: 1 });
  const current = ui;
  ui = reduce(ui, { type: 'request-failed', request: { type: 'world-snapshot', id: 99 }, worldId: 1, error: 'old timeout' });
  assert.equal(ui, current);
  assert.deepEqual(ui.worldRead, { state: 'pending', worldId: 1, tick: '1', requestId: 100 });
});

test('LV-C2: an evicted terminal request cannot be resurrected by delayed sending or queued admission', () => {
  let ui = uiFor(waitingSnapshot());
  const actions: ActionResult[] = Array.from({ length: 25 }, (_, index) => ({
    worldId: 1, requestId: index + 1, input_seq: String(index + 1), tick: '501', kind: 'haunt', state: 'rejected',
    reason: 'rate_limited', target: 1,
  }));
  ui = reduce(ui, { type: 'status', snapshot: { ...deliverySnapshot(ui), tick: '501', actions } });
  const request: Request = { type: 'haunt', id: 1, target: 1 };
  ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
  ui = reduce(ui, { type: 'reply', request, worldId: 1, message: {
    type: 'reply', id: 1, ok: true, submission: { tick: '500', seqs: ['1'] },
    snapshot: { ...deliverySnapshot(ui), tick: '500' },
  } });
  assert.equal(ui.actions.length, 20); assert.equal(ui.settledOmitted, 5);
  assert.equal(ui.actions.some(action => action.requestId === 1), false);
  assert.ok(ui.actions.every(action => action.phase === 'rejected'));
  assert.equal(ui.tick, '501');
});

test('LV-C2: a thousand-result batch indexes pending rows once and keeps exact settled metadata', () => {
  let identityReads = 0;
  const pending = Array.from({ length: 1500 }, (_, index) => {
    const request: Request = { type: 'haunt', id: 2000 + index, target: 1 };
    return Object.freeze({
      worldId: 1, get requestId() { identityReads++; return request.id; },
      get inputSeq() { identityReads++; return null; }, request,
      phase: index % 2 === 0 ? 'sending' as const : 'unknown' as const,
      submission: null, result: null, error: index % 2 === 0 ? null : 'timeout',
    });
  });
  const admitted = Array.from({ length: 20 }, (_, index) => {
    const request: Request = { type: 'haunt', id: 981 + index, target: 1 };
    return Object.freeze({ worldId: 1, requestId: request.id, inputSeq: String(10980 + index), request,
      phase: 'queued' as const, submission: { tick: '499', seqs: [String(10980 + index)] }, result: null, error: null });
  });
  const previous: UiState = { ...deliveryState('502'), actions: [...pending, ...admitted] };
  Object.freeze(previous.actions);
  const results: ActionResult[] = Array.from({ length: 1000 }, (_, index) => ({
    worldId: 1, requestId: index + 1, input_seq: String(10000 + index), tick: '501', kind: 'haunt', state: 'rejected',
    reason: 'rate_limited', target: 1,
  }));
  const next = reduce(previous, { type: 'status', snapshot: { ...deliverySnapshot(previous), tick: '501',
    actions: [...results, results[0]!, { ...results[0]!, worldId: 2, input_seq: '99999' }] } });
  assert.ok(identityReads <= 8 * previous.actions.length, `pending identity reads ${identityReads} must be linear in retained rows`);
  assert.equal(next.actions.length, 1520); assert.equal(next.settledOmitted, 980);
  assert.deepEqual(next.actions.slice(0, pending.length), pending);
  assert.equal(next.actions.filter(row => row.phase === 'unknown').length, 750);
  for (let index = 0; index < 20; index++) {
    const row = next.actions[pending.length + index]!;
    assert.equal(row.request, admitted[index]!.request); assert.equal(row.submission, admitted[index]!.submission);
    assert.equal(row.result, results[980 + index]); assert.equal(row.inputSeq, String(10980 + index));
    assert.equal(row.requestId, 981 + index); assert.equal(row.phase, 'rejected'); assert.equal(row.error, 'rate_limited');
  }
  for (const result of results) {
    assert.equal(hasObservation(next.observedActions, result.input_seq), true);
    assert.equal(hasObservation(next.settledRequests, String(result.requestId)), true);
  }
  assert.equal(hasObservation(next.observedActions, '99999'), false);
  assert.equal(previous.actions.length, 1520); assert.equal(previous.actions[1500], admitted[0]);
  assert.equal(previous.settledOmitted, 0); assert.equal(previous.observedActions, null);
  assert.equal(next.tick, '502'); assert.equal(next.world, previous.world);
});

test('LV-C2: batch identity collisions retain first-match metadata and terminal delivery order', () => {
  const firstRequest: Request = { type: 'haunt', id: 40, target: 1 };
  const laterRequest: Request = { type: 'haunt', id: 50, target: 1 };
  const first = { worldId: 1, requestId: 40, inputSeq: '70', request: firstRequest, phase: 'queued' as const,
    submission: { tick: '499', seqs: ['70'] }, result: null, error: null };
  const later = { ...first, requestId: 50, inputSeq: '71', request: laterRequest, submission: { tick: '498', seqs: ['71'] } };
  const another = { ...later, inputSeq: '72', submission: { tick: '497', seqs: ['72'] } };
  const before: UiState = { ...deliveryState(), actions: [first, later, another] };
  const results: ActionResult[] = ['70', '73', '74'].map(input_seq => ({ worldId: 1, requestId: 50, input_seq,
    tick: '499', kind: 'haunt', state: 'rejected', reason: 'rate_limited', target: 1 }));
  const next = reduce(before, { type: 'status', snapshot: { ...deliverySnapshot(before), actions: [...results, results[0]!] } });
  assert.deepEqual(next.actions.map(row => row.inputSeq), ['70', '73', '74']);
  assert.deepEqual(next.actions.map(row => row.submission), [first.submission, later.submission, another.submission]);
  assert.deepEqual(next.actions.map(row => row.request), [firstRequest, laterRequest, laterRequest]);
  assert.deepEqual(next.actions.map(row => row.result), results);
  assert.deepEqual(before.actions, [first, later, another]);
});

test('LV-C2: immutable lifetime roots share duplicates and unrelated carriers without forgetting old facts', () => {
  const original = deliveryState();
  const action: ActionResult = { worldId: 1, requestId: 77, input_seq: '18446744073709551615', tick: '499', kind: 'haunt',
    state: 'rejected', reason: 'rate_limited', target: 1 };
  const fact: PlayerLifecycleFact = { event: '18446744073709551614', tick: '499', kind: 'death', body: 2, name: 'Body', origin: 'native' };
  const actionsOnly = reduce(original, { type: 'status', snapshot: { ...deliverySnapshot(original), actions: [action] } });
  assert.equal(actionsOnly.observedLifecycle, original.observedLifecycle);
  assert.equal(actionsOnly.playerLifecycle, original.playerLifecycle);
  const lifecycleOnly = reduce(actionsOnly, { type: 'status', snapshot: { ...deliverySnapshot(actionsOnly), playerLifecycle: [fact] } });
  assert.equal(lifecycleOnly.actions, actionsOnly.actions); assert.equal(lifecycleOnly.observedActions, actionsOnly.observedActions);
  assert.equal(lifecycleOnly.settledRequests, actionsOnly.settledRequests);
  const duplicate = reduce(lifecycleOnly, { type: 'status', snapshot: { ...deliverySnapshot(lifecycleOnly), actions: [action], playerLifecycle: [fact] } });
  assert.equal(duplicate.actions, lifecycleOnly.actions); assert.equal(duplicate.playerLifecycle, lifecycleOnly.playerLifecycle);
  assert.equal(duplicate.observedActions, lifecycleOnly.observedActions); assert.equal(duplicate.settledRequests, lifecycleOnly.settledRequests);
  assert.equal(duplicate.observedLifecycle, lifecycleOnly.observedLifecycle);
  const newerFact: PlayerLifecycleFact = { ...fact, event: '90', tick: '501', kind: 'birth' };
  const newEpisode = reduce(duplicate, { type: 'status', snapshot: { ...deliverySnapshot(duplicate), tick: '501', playerLifecycle: [newerFact] } });
  assert.deepEqual(newEpisode.playerLifecycle, [newerFact]);
  const late = reduce(newEpisode, { type: 'status', snapshot: { ...deliverySnapshot(newEpisode), tick: '499', actions: [action], playerLifecycle: [fact] } });
  assert.equal(late.actions, newEpisode.actions); assert.equal(late.playerLifecycle, newEpisode.playerLifecycle);
  assert.equal(hasObservation(late.observedLifecycle, fact.event), true);
  assert.equal(hasObservation(lifecycleOnly.observedLifecycle, newerFact.event), false);
  assert.equal(hasObservation(original.observedActions, action.input_seq), false);
  const sent = reduce(late, { type: 'request-sent', worldId: 1, request: { type: 'haunt', id: 78, target: 1 } });
  assert.equal(sent.observedActions, late.observedActions); assert.equal(sent.settledRequests, late.settledRequests);
  const failed = reduce(sent, { type: 'reply', worldId: 1, request: { type: 'haunt', id: 78, target: 1 }, message: {
    type: 'reply', id: 78, ok: false, kind: 'rejected', error: 'rate_limited', snapshot: deliverySnapshot(sent),
  } });
  assert.equal(failed.observedActions, sent.observedActions); assert.equal(failed.observedLifecycle, sent.observedLifecycle);
  assert.equal(hasObservation(failed.settledRequests, '77'), true); assert.equal(hasObservation(failed.settledRequests, '78'), true);
  assert.equal(hasObservation(sent.settledRequests, '78'), false);
  const failedAgain = reduce(failed, { type: 'reply', worldId: 1, request: { type: 'haunt', id: 78, target: 1 }, message: {
    type: 'reply', id: 78, ok: false, kind: 'rejected', error: 'rate_limited', snapshot: deliverySnapshot(failed),
  } });
  assert.equal(failedAgain.settledRequests, failed.settledRequests);
});

test('LV-C2: pre-issuance World read failure suppresses same-tick demand without a fabricated ticket', () => {
  const before = { ...deliveryState('10'), world: null };
  assert.equal(worldSnapshotNeeded(before), true);
  const failed = reduce(before, { type: 'world-read-start-failed', worldId: 1, tick: '10', error: 'transport unavailable' });
  assert.deepEqual(failed.worldRead, { state: 'failed', worldId: 1, tick: '10' });
  assert.equal(failed.error, 'transport unavailable'); assert.equal(worldSnapshotNeeded(failed), false);
  assert.equal(failed.actions, before.actions); assert.equal(failed.world, before.world); assert.equal(failed.tick, before.tick);
  const nextTick = reduce(failed, { type: 'status', snapshot: { ...deliverySnapshot(failed), tick: '11' } });
  assert.equal(worldSnapshotNeeded(nextTick), true);
  const pending = startWorldRead(nextTick);
  for (const event of [
    { type: 'world-read-start-failed' as const, worldId: 1, tick: '10', error: 'old tick' },
    { type: 'world-read-start-failed' as const, worldId: 2, tick: '11', error: 'old world' },
    { type: 'world-read-start-failed' as const, worldId: 1, tick: '11', error: 'pending read' },
  ]) assert.equal(reduce(pending, event), pending);
  const replaced = deliveryReply(failed, { type: 'create-world', id: 101, seed: '2', config: '{}' },
    { ...deliverySnapshot(failed), worldId: 2, tick: '10' });
  assert.equal(reduce(replaced, { type: 'world-read-start-failed', worldId: 1, tick: '10', error: 'old world' }), replaced);
  const fatal = reduce(before, { type: 'fatal', error: 'dead worker' });
  assert.equal(reduce(fatal, { type: 'world-read-start-failed', worldId: 1, tick: '10', error: 'late' }), fatal);
});

test('LV-C2: a pre-issuance running read failure retains the ten-status spacing and frozen-tick guard', () => {
  const before = { ...deliveryState('10', 'running'), worldStatuses: 10 };
  const failed = reduce(before, { type: 'world-read-start-failed', worldId: 1, tick: '10', error: 'transport unavailable' });
  assert.equal(failed.worldStatuses, 0); assert.equal(worldSnapshotNeeded(failed), false);
  let ui = failed;
  for (let index = 1; index <= 9; index++) { ui = runningStatus(ui); assert.equal(worldSnapshotNeeded(ui), false); }
  assert.equal(worldSnapshotNeeded(runningStatus(ui)), true);
  ui = failed;
  for (let index = 0; index < 10; index++) ui = runningStatus(ui, false);
  assert.equal(worldSnapshotNeeded(ui), false); assert.equal(worldSnapshotNeeded(runningStatus(ui)), true);
});

test('LU-R1: a fresh paused game keeps Life pace and has no pending answer', () => {
  const initial = initialUiState();
  assert.equal(initial.speed, 1 / 6);
  const created = deliveryReply(initial, { type: 'create-world', id: 1, seed: '1205', config: '{}' },
    { ...deliverySnapshot(initial), worldId: 1, tick: '0', runState: 'paused', speed: 1 / 6 });
  assert.equal(created.runState, 'paused');
  assert.equal(created.tick, '0');
  assert.equal(created.speed, 1 / 6);
  assert.equal(currentDecision(created), null);
  assert.deepEqual(created.playerNode, { pending: false });
});

test('LU-R2: ordinary Story deliveries retain old facts and actors through rebirth, failed Create and stale callbacks', () => {
  const native: { sampleTicks: string; openingBatch: StoryBatch; actors: StoryBatch['actors'];
    events: StoryBatch['events']; chronicle: StoryBatch['chronicle']; dreams: StoryBatch['dreams']; cursors: StoryBatch['cursors'];
  } = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
  const batch: StoryBatch = { version: 1, opening: false, actors: native.actors, events: native.events,
    chronicle: native.chronicle, dreams: native.dreams, cursors: native.cursors };
  // Successful Create binds the notebook to the same worker epoch as its deliveries.
  let ui = deliveryReply(initialUiState(), { type: 'create-world', id: 1, seed: '1205', config: '{}' },
    { ...deliverySnapshot(deliveryState()), tick: '0', story: [{ worldId: 1, batch: native.openingBatch }] });
  assert.equal(ui.notebook.worldId, ui.worldId);
  const delivered = { ...deliverySnapshot(ui), tick: native.sampleTicks, story: [{ worldId: ui.worldId, batch }] };
  ui = reduce(ui, { type: 'status', snapshot: delivered });
  const retained = ui.notebook;
  const expected = new Set([
    ...native.openingBatch.events.map(event => `e:${event.id}`), ...native.events.map(event => `e:${event.id}`),
    ...native.openingBatch.chronicle.map(record => `c:${record.index}`), ...native.chronicle.map(record => `c:${record.index}`),
  ]);
  assert.ok(expected.size > 120, 'actual native history exceeds the visible render range');
  assert.deepEqual(new Set(retained.identities), expected);
  for (const event of native.events) assert.deepEqual(retained.events[event.id], event);
  for (const record of native.chronicle) assert.deepEqual(retained.chronicle[record.index], record);
  for (const actor of native.actors) assert.deepEqual(retained.actors[actor.person], actor);
  const nextTick = String(BigInt(native.sampleTicks) + 1n);
  ui = reduce(ui, { type: 'status', snapshot: { ...deliverySnapshot(ui), tick: nextTick,
    stop: { reasons: ['player_reborn'], world: { ...deliveryWorld, tick: nextTick } } } });
  assert.equal(ui.notebook, retained, 'rebirth is not a new World');
  const create: Request = { type: 'create-world', id: 2, seed: 'bad', config: '{}' };
  ui = reduce(ui, { type: 'reply', request: create, message: { type: 'reply', id: 2, ok: false,
    kind: 'invalid-seed', error: 'invalid', snapshot: deliverySnapshot(ui) } });
  assert.equal(ui.notebook, retained, 'failed Create cannot evict history');
  ui = deliveryReply(ui, { ...create, seed: '2' }, { ...deliverySnapshot(ui), worldId: 2, tick: '0' });
  assert.equal(ui.notebook.worldId, 2);
  assert.equal(ui.notebook.identities.length, 0);
  assert.deepEqual(ui.notebook.actors, {});
  const fresh = ui;
  ui = reduce(ui, { type: 'status', snapshot: delivered });
  assert.equal(ui, fresh, 'old World story cannot repopulate the new notebook');
});

test('LU-R3: exact-node rejection retains its scene, admission and actual invalidation retire it', () => {
  const world = pendingSnapshot('debt_due');
  let ui = uiFor(world);
  const snapshot: Snapshot = { ...deliverySnapshot(ui), stop: { reasons: ['player_node'], world } };
  ui = reduce(ui, { type: 'status', snapshot });
  const original = ui;
  const entry = ui.scene!.entries[0]!;
  const request: Request = { type: 'choose', id: 1, node: world.player_node!.id, option: 'repay_now' };
  const rejected = reduce(ui, { type: 'reply', request, message: { type: 'reply', id: 1, ok: false,
    kind: 'rejected', error: 'option_not_in_set', snapshot } });
  assert.equal(rejected.scene!.entries[0], entry, 'refusal neither retires nor replays the scene');
  const invalidated = reduce(original, { type: 'status', snapshot: { ...deliverySnapshot(original), playerNode: { pending: false } } });
  assert.equal(invalidated.scene, null);
  const admitted = deliveryReply(original, request, { ...deliverySnapshot(original),
    playerNode: { pending: true, node: request.node, answered: true } });
  assert.equal(admitted.scene, null);
  assert.equal(admitted.tick, original.tick);
  assert.equal(admitted.checksum, original.checksum);
});

test('LU-R3: settled history waits for a genuinely new stop without delaying the next choice', () => {
  const native: { actors: StoryBatch['actors']; events: StoryBatch['events'] } =
    JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
  const death = native.events.find(event => event.kind.type === 'death' && event.kind.person === 10)!;
  const arrival = native.events.find(event => event.kind.type === 'possession' && event.kind.person === 61)!;
  assert.ok(death); assert.ok(arrival);
  const lifecycle: PlayerLifecycleFact[] = [death, arrival].map(event => {
    assert.ok('person' in event.kind);
    const person = event.kind.person;
    const kind = event.kind.type;
    assert.ok(kind === 'death' || kind === 'possession');
    const actor = native.actors.find(actor => actor.person === person)!;
    assert.ok(actor);
    const origin = actor.origin;
    assert.ok(origin !== 'official');
    return { event: event.id, tick: event.tick, kind, body: actor.person, name: actor.name, origin };
  });
  const tick = String(BigInt(arrival.tick) + 1n);
  const world = { ...deliveryWorld, tick };
  let ui = deliveryReply(initialUiState(), { type: 'create-world', id: 1, seed: '1205', config: '{}' },
    { ...deliverySnapshot(deliveryState(tick)), tick }, world);
  const opening: Snapshot = { ...deliverySnapshot(ui), playerLifecycle: lifecycle,
    stop: { reasons: ['player_reborn'], world } };
  ui = reduce(ui, { type: 'status', snapshot: opening });
  const unfinished = ui;
  const head = ui.scene!.entries[0]!;
  const tail = ui.scene!.entries[1]!;
  const expected = { worldId: ui.scene!.worldId, tick: ui.scene!.tick, entry: head };
  const identities = ui.scene!.entries.map(entry => entry.identity);
  const buttons = controls(ui);
  const factsBefore = { world: ui.world, notebook: ui.notebook, actions: ui.actions, tick: ui.tick, checksum: ui.checksum };

  for (const invalid of [
    { ...expected, worldId: expected.worldId + 1 },
    { ...expected, tick: String(BigInt(expected.tick) + 1n) },
    { ...expected, entry: { ...head } },
    { ...expected, entry: tail },
  ]) {
    const ignored = reduce(ui, { type: 'scene-settled', expected: invalid });
    assert.equal(ignored.settledScene, null);
    assert.deepEqual(ignored.scene!.entries.map(entry => entry.identity), identities);
  }
  ui = reduce(ui, { type: 'scene-settled', expected });
  assert.equal(ui.settledScene?.entry.identity, head.identity);
  assert.deepEqual(controls(ui), buttons);
  assert.deepEqual({ world: ui.world, notebook: ui.notebook, actions: ui.actions, tick: ui.tick, checksum: ui.checksum }, factsBefore,
    'settling presentation submits nothing and advances no day');

  ui = deliveryReply(ui, { type: 'pause', id: 2 }, { ...deliverySnapshot(ui), stop: { reasons: ['user'], world } });
  ui = deliveryReply(ui, { type: 'world-snapshot', id: 3 }, deliverySnapshot(ui), world);
  assert.deepEqual(ui.scene!.entries.map(entry => entry.identity), identities, 'same-tick Pause and reads retain settled history');
  const later = String(BigInt(tick) + 1n);
  ui = reduce(ui, { type: 'status', snapshot: { ...deliverySnapshot(ui), tick: later, runState: 'running' } });
  assert.deepEqual(ui.scene!.entries.map(entry => entry.identity), identities, 'ordinary ticks retain settled history');
  const quietWorld = { ...world, tick: later };
  ui = deliveryReply(ui, { type: 'pause', id: 4 }, { ...deliverySnapshot(ui), runState: 'paused', stop: { reasons: ['user'], world: quietWorld } });
  assert.deepEqual(ui.scene!.entries.map(entry => entry.identity), identities, 'a stop without a new candidate cannot retire history');
  assert.equal(ui.settledScene?.entry.identity, head.identity);
  const settled = ui;

  const choiceTick = String(BigInt(later) + 1n);
  const pending = pendingSnapshot('debt_due');
  const choiceWorld = { ...pending, tick: choiceTick, player_node: { ...pending.player_node!,
    fired: later, choice_tick: choiceTick, resolves: choiceTick } };
  const freshStop: Snapshot = { ...deliverySnapshot(ui), tick: choiceTick,
    playerNode: { pending: true, node: choiceWorld.player_node.id, answered: false },
    stop: { reasons: ['player_node'], world: choiceWorld } };
  const unplayed = reduce(unfinished, { type: 'status', snapshot: freshStop });
  assert.ok(unplayed.scene!.entries.some(entry => entry.identity === head.identity), 'a new stop cannot erase unfinished history');
  ui = reduce(ui, { type: 'status', snapshot: freshStop });
  assert.equal(ui.scene!.entries[0]!.identity, tail.identity, 'only the settled head retires');
  assert.ok(!ui.scene!.entries.some(entry => entry.identity === head.identity));
  const nodeEntry = ui.scene!.entries.find(entry => entry.node === choiceWorld.player_node.id)!;
  assert.ok(nodeEntry);
  assert.equal(currentDecision(ui)?.id, choiceWorld.player_node.id);
  assert.equal(ui.settledScene, null);
  const nodeOnly = reduce(ui, { type: 'scene-close', expected: { worldId: ui.scene!.worldId, tick: ui.scene!.tick, entry: tail } });
  assert.equal(nodeOnly.scene!.entries[0]!.node, choiceWorld.player_node.id);
  const nodeSettlement = reduce(nodeOnly, { type: 'scene-settled', expected: { worldId: nodeOnly.scene!.worldId, tick: nodeOnly.scene!.tick, entry: nodeEntry } });
  assert.equal(nodeSettlement.settledScene, null, 'an unresolved node is never settled away');
  assert.equal(currentDecision(nodeSettlement)?.id, choiceWorld.player_node.id);

  const replacement = deliveryReply(settled, { type: 'create-world', id: 5, seed: '2', config: '{}' },
    { ...deliverySnapshot(settled), worldId: 2, tick: '0' });
  assert.equal(replacement.settledScene, null);
  assert.equal(replacement.scene, null);
  const stale = reduce(replacement, { type: 'scene-settled', expected });
  assert.equal(stale.worldId, 2); assert.equal(stale.tick, '0');
  assert.equal(stale.settledScene, null); assert.equal(stale.scene, null);
});
