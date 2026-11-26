// Feature: web-shell, controller example tests (task 2.12)
//
// Validates: Requirements 2.8, 2.12, 3.6, 4.5
//
// These are example-based (node:test, no fast-check): concrete scenarios that
// pin down four behaviours the properties cover only in aggregate.
//
//   - A WASM load failure (R2.8): a controller that never loaded answers every
//     queued and every later request with a `load-failed` reply carrying the load
//     error text, posts exactly one `fatal`, and reports Run_State `failed`.
//   - Status cadence: ordinary story facts remain throttled, while action and
//     lifecycle facts publish immediately; no running window goes silent for over a second.
//   - A fresh create-world returns to the Life playback rate.
//   - create-world while running with a bad config (R3.6, R3.7): the failed create
//     leaves the old world running with its worldId.
//
// The status-cadence, speed and bad-config cases use the real WasmSim from
// target/wasm-pkg (loaded by the wasm helper), with a hand-driven
// FakeFrameScheduler and FakeClock and a messageCollector for `post` (R6.6). The
// load-failure case needs no WASM: the controller never loads, so createSim is a
// stub that is never called.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import type { Request, WorkerMessage } from '../../src/shared/protocol.ts';
import { createSim as realCreateSim, loadWasm } from './helpers/wasm.ts';
import { FakeClock, FakeFrameScheduler, messageCollector } from './helpers/fakes.ts';

/** A reply message (ok true or false), narrowed from WorkerMessage. */
type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;
/** A status message, narrowed from WorkerMessage. */
type StatusMessage = Extract<WorkerMessage, { type: 'status' }>;

/** The config every real-world case here creates from (same shape as the fixture). */
const CONFIG = '{"opening_residents":45}';

// --- R2.8: WASM load failure --------------------------------------------------

// A controller whose WASM never loads must answer every request (the ones already
// queued and every one that arrives later) with a `load-failed` reply that carries
// the load error text, post exactly one `fatal` with that text, and report
// Run_State `failed`. Load failure is modelled by never calling ready() and calling
// fail(error) while requests are still queued (design: the worker entry calls
// fail() when init() rejects).
test('a WASM load failure answers every queued and later request with load-failed and posts fatal', () => {
  const { post, messages } = messageCollector<WorkerMessage>();
  // createSim must never be called: the WASM never loaded, so no request is
  // dispatched. A throwing stub proves that.
  const createSim = (): SimHandle => {
    throw new Error('createSim must not be called when the WASM failed to load');
  };
  const controller = new SimController({
    createSim,
    scheduler: new FakeFrameScheduler(),
    clock: new FakeClock(0),
    post,
  });

  // Never call ready(): the WASM is still "loading". Send a few requests; they
  // queue (no reply yet).
  const queued: Request[] = [
    { type: 'create-world', id: 1, seed: '42', config: CONFIG },
    { type: 'run', id: 2 },
    { type: 'step', id: 3 },
  ];
  for (const req of queued) {
    controller.handle(req);
  }
  assert.equal(messages.length, 0, 'queued requests get no reply until load ends');

  // The WASM load fails.
  const loadError = 'load error';
  controller.fail(loadError);

  // Exactly one fatal message, carrying the load error text (R2.8).
  const fatals = messages.filter((m) => m.type === 'fatal');
  assert.equal(fatals.length, 1, 'exactly one fatal message is posted');
  assert.equal(fatals[0].error, loadError, 'the fatal carries the load error text');

  // Every queued request now has exactly one load-failed reply, in order.
  const queuedReplies = messages.filter((m): m is ReplyMessage => m.type === 'reply');
  assert.deepEqual(
    queuedReplies.map((r) => r.id),
    [1, 2, 3],
    'every queued request gets one reply, in order',
  );
  for (const reply of queuedReplies) {
    assertLoadFailed(reply, loadError);
  }

  // A request that arrives AFTER the failure also gets a load-failed reply with
  // the load error text (R2.8: every later request).
  controller.handle({ type: 'pause', id: 4 });
  const later = messages.filter((m): m is ReplyMessage => m.type === 'reply' && m.id === 4);
  assert.equal(later.length, 1, 'the later request gets exactly one reply');
  assertLoadFailed(later[0], loadError);

  // Run_State is `failed` on every reply snapshot after the failure.
  for (const reply of messages.filter((m): m is ReplyMessage => m.type === 'reply')) {
    assert.equal(reply.snapshot.runState, 'failed', `reply ${reply.id} reports Run_State failed`);
  }

  // No further fatal is posted by the later request (fatal is final, posted once).
  assert.equal(
    messages.filter((m) => m.type === 'fatal').length,
    1,
    'fatal is posted exactly once, not repeated for later requests',
  );
});

/** Assert a reply is a load-failed failure carrying the given load error text (R2.8). */
function assertLoadFailed(reply: ReplyMessage, loadError: string): void {
  assert.equal(reply.ok, false, `reply ${reply.id} is a failure`);
  // Narrow to the failure arm of the union.
  if (reply.ok !== false) {
    return;
  }
  assert.equal(reply.kind, 'load-failed', `reply ${reply.id} has kind load-failed`);
  assert.equal(reply.error, loadError, `reply ${reply.id} carries the load error text`);
}

// --- R2.12 + design: status cadence ------------------------------------------

// Ordinary story statuses respect cadence; only action/lifecycle facts bypass it.
test('running status cadence remains bounded while ordinary story facts respect the throttle', () => {
  loadWasm();
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const { post, messages } = messageCollector<WorkerMessage>();
  const times: number[] = [];
  const controller = new SimController({ createSim: realCreateSim, scheduler, clock,
    post: message => { post(message); if (message.type === 'status') times.push(clock.now()); } });
  controller.ready();

  // Create a world and start running.
  controller.handle({ type: 'create-world', id: 1, seed: '7', config: CONFIG });
  controller.handle({ type: 'run', id: 2 });

  // A 60 Hz loop: advance the clock 16 ms per frame and fire the one outstanding
  // frame each time. Fire enough frames that total elapsed time exceeds 1,000 ms
  // several times over (120 frames = ~1,920 ms).
  const frameMs = 16;
  const frames = 120;
  for (let i = 0; i < frames; i++) {
    clock.advance(frameMs);
    assert.ok(scheduler.flush(), `frame ${i} had an outstanding callback to fire`);
  }
  const totalMs = frames * frameMs;
  assert.ok(totalMs > 1_000, 'the loop advanced well past 1,000 ms');

  const statuses = messages.filter((m): m is StatusMessage => m.type === 'status');
  assert.ok(statuses.length >= 2, 'running for ~1.9 s produces several status messages');
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap <= 1_000, `running status gap ${gap} ms must be <= 1000`);
    const current = statuses[i]!.snapshot;
    if (current.actions.length === 0 && current.playerLifecycle.length === 0) {
      assert.ok(gap >= 100, `ordinary status gap ${gap} ms must respect the throttle`);
    }
  }

  // The time from the run start (t=0) to the first status is within 1,000 ms too,
  // so no window of running goes more than 1,000 ms without a status (R2.12).
  assert.ok(times[0] <= 1_000, `first status at ${times[0]} ms must be within 1000 ms of the run start`);
});

// --- Fresh world playback ----------------------------------------------------

test('creating a fresh world resets temporary playback to Life and starts paused', () => {
  loadWasm();
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const { post, messages } = messageCollector<WorkerMessage>();
  const controller = new SimController({ createSim: realCreateSim, scheduler, clock, post });
  controller.ready();

  const nonDefaultSpeed = 7;

  // set-speed needs a world first (set-speed in no-world replies no-world).
  controller.handle({ type: 'create-world', id: 1, seed: '1', config: CONFIG });
  controller.handle({ type: 'set-speed', id: 2, speed: nonDefaultSpeed });

  const afterSetSpeed = replyFor(messages, 2);
  assert.equal(afterSetSpeed.ok, true, 'set-speed with a valid Speed succeeds');
  assert.equal(afterSetSpeed.snapshot.speed, nonDefaultSpeed, 'the Speed is now the non-default value');

  // A new generation starts at Life rather than inheriting temporary playback.
  controller.handle({ type: 'create-world', id: 3, seed: '2', config: CONFIG });
  const afterCreate = replyFor(messages, 3);
  assert.equal(afterCreate.ok, true, 'the second create-world succeeds');
  assert.equal(
    afterCreate.snapshot.speed,
    1 / 6,
    'a fresh world returns to Life playback',
  );
  // The new world is a fresh world (worldId incremented, paused, no checksum yet).
  assert.equal(afterCreate.snapshot.runState, 'paused', 'the new world starts paused');
  assert.equal(afterCreate.snapshot.checksum, null, 'the new world has no checksum yet');
});

// --- R3.6 / R3.7: create-world while running with a bad config ---------------

// A create-world with a valid seed but a config `new WasmSim` rejects must fail
// with a `sim-error` and leave the running world running with its worldId: the
// loop is stopped only after the new instance is constructed, so a failed create
// never disturbs the old world (R3.6, R3.7).
test('create-world while running with a bad config leaves the old world running', () => {
  loadWasm();
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const { post, messages } = messageCollector<WorkerMessage>();
  const controller = new SimController({ createSim: realCreateSim, scheduler, clock, post });
  controller.ready();

  // Create and run a world, then fire a frame so it has advanced a tick.
  controller.handle({ type: 'create-world', id: 1, seed: '99', config: CONFIG });
  const created = replyFor(messages, 1);
  assert.equal(created.ok, true, 'the first world is created');
  const worldId = created.snapshot.worldId;
  assert.ok(worldId > 0, 'the running world has a non-zero worldId');

  controller.handle({ type: 'run', id: 2 });
  clock.advance(200); // one day at the fresh Life playback rate
  assert.ok(scheduler.flush(), 'one frame ran for the running world');

  // A create-world with a valid seed but an invalid config: new WasmSim throws, so
  // the controller replies sim-error and changes nothing (R3.6).
  controller.handle({ type: 'create-world', id: 3, seed: '123', config: 'not valid json' });
  const failed = replyFor(messages, 3);
  assert.equal(failed.ok, false, 'the bad create-world fails');
  if (failed.ok === false) {
    assert.equal(failed.kind, 'sim-error', 'the failure is a sim-error (the constructor threw)');
    assert.ok(failed.error.length > 0, 'the failure carries the Sim_Error text');
  }

  // The prior world is still running with its original worldId (R3.6, R3.7).
  assert.equal(failed.snapshot.runState, 'running', 'the old world is still running');
  assert.equal(failed.snapshot.worldId, worldId, 'the old world keeps its worldId');

  // The loop is still live: another frame advances the old world further, and a
  // pause then reports a tick greater than the one before the failed create.
  const tickBeforeFailed = tickNum(failed.snapshot.tick);
  clock.advance(200);
  assert.ok(scheduler.flush(), 'the old world is still scheduling frames');
  controller.handle({ type: 'pause', id: 4 });
  const paused = replyFor(messages, 4);
  assert.equal(paused.ok, true, 'pause succeeds on the still-running old world');
  assert.equal(paused.snapshot.worldId, worldId, 'still the same world after pause');
  assert.ok(
    tickNum(paused.snapshot.tick) > tickBeforeFailed,
    'the old world kept advancing after the failed create',
  );
});

/** The single reply with the given request id; fails if absent or duplicated. */
function replyFor(messages: readonly WorkerMessage[], id: number): ReplyMessage {
  const replies = messages.filter((m): m is ReplyMessage => m.type === 'reply' && m.id === id);
  assert.equal(replies.length, 1, `exactly one reply for request id ${id}`);
  return replies[0];
}

/** Parse a non-null snapshot tick to a number (ticks here are far below 2^53). */
function tickNum(tick: string | null): number {
  assert.notEqual(tick, null, 'snapshot tick is non-null for a world with ticks');
  return Number(tick);
}
