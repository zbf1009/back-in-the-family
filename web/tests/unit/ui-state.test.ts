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
import {
  initialUiState,
  reduce,
  type UiEvent,
  type UiState,
} from '../../src/main/ui-state.ts';
import type { Request, RunState, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';

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
    speed: fc.constantFrom(1, 7, 30, 90, 365),
  });
}

/** An arbitrary originating request (the request a reply answers / request-sent carries). */
function requestArb(): fc.Arbitrary<Request> {
  return fc.oneof(
    fc.record({ type: fc.constant('create-world' as const), id: fc.nat(), seed: fc.string(), config: fc.string() }),
    fc.record({ type: fc.constant('run' as const), id: fc.nat() }),
    fc.record({ type: fc.constant('pause' as const), id: fc.nat() }),
    fc.record({ type: fc.constant('step' as const), id: fc.nat() }),
    fc.record({ type: fc.constant('set-speed' as const), id: fc.nat(), speed: fc.constantFrom(1, 7, 30, 90, 365) }),
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
            if (e.message.ok) {
              // A successful reply adopts the whole snapshot and clears the error (R5.8).
              const snap = e.message.snapshot;
              assert.equal(next.tick, snap.tick, 'ok reply must adopt snapshot tick');
              assert.equal(next.checksum, snap.checksum, 'ok reply must adopt snapshot checksum');
              assert.equal(next.worldId, snap.worldId, 'ok reply must adopt snapshot worldId');
              assert.equal(next.runState, snap.runState, 'ok reply must adopt snapshot runState');
              assert.equal(next.speed, snap.speed, 'ok reply must adopt snapshot speed');
              assert.equal(next.error, null, 'ok reply must clear the error area (R5.8)');
              adopted = snapPair(snap);
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
              assert.equal(next.stepPending, prev.stepPending, 'reply to create-world leaves stepPending');
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
            if (e.snapshot.worldId !== prev.worldId) {
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

  // A fatal first, to put an error on screen and go to failed.
  s = reduce(s, { type: 'fatal', error: 'boom' });
  assert.equal(s.runState, 'failed');
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
  };
  s = reduce(s, { type: 'reply', request: { type: 'create-world', id: 1, seed: '7', config: '{}' }, message: { type: 'reply', id: 1, ok: true, snapshot: snap } });
  assert.equal(s.error, null, 'success clears the error');
  assert.equal(s.createPending, false, 'success clears createPending');
  assert.equal(s.tick, '0');
  assert.equal(s.worldId, 1);

  // Step forward via a matching status to a real checksum.
  const running: Snapshot = { worldId: 1, runState: 'running', tick: '5', checksum: 'a1b2c3d4e5f60718', tps: 3, speed: 1 };
  s = reduce(s, { type: 'status', snapshot: running });
  assert.equal(s.tick, '5');
  assert.equal(s.checksum, 'a1b2c3d4e5f60718');

  // A failure reply must keep tick 5 / that checksum and only set the error (R5.9).
  const before = { tick: s.tick, checksum: s.checksum, worldId: s.worldId };
  s = reduce(s, {
    type: 'reply',
    request: { type: 'step', id: 2 },
    message: { type: 'reply', id: 2, ok: false, kind: 'invalid-state', error: 'cannot step while running', snapshot: { worldId: 9, runState: 'paused', tick: '999', checksum: '0000000000000000', tps: null, speed: 1 } },
  });
  assert.equal(s.tick, before.tick, 'failure keeps the tick');
  assert.equal(s.checksum, before.checksum, 'failure keeps the checksum');
  assert.equal(s.worldId, before.worldId, 'failure keeps the worldId');
  assert.equal(s.error, 'cannot step while running');

  // A status for a different world (worldId 2) is dropped entirely (R3.7).
  const stale = { ...s };
  s = reduce(s, { type: 'status', snapshot: { worldId: 2, runState: 'running', tick: '42', checksum: 'ffffffffffffffff', tps: 10, speed: 7 } });
  assert.deepEqual(s, stale, 'mismatched status changes nothing');
});
