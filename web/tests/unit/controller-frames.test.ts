// Feature: web-shell, Property 5: Frame discipline
// The replaced per-frame Speed assertion is now the bounded wall-time budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import type { PauseReason, WorkerMessage } from '../../src/shared/protocol.ts';
import { PLAY_RATE, SPEEDS, type Speed } from '../../src/shared/speeds.ts';
import { createSim, loadWasm } from './helpers/wasm.ts';
import { FakeClock, FakeFrameScheduler, RecordingSimHandle, messageCollector } from './helpers/fakes.ts';
import { configJsonArb, seedBigIntArb } from './helpers/gen.ts';
import { PacingReference } from './helpers/reference.ts';

const RUNS = 1000;
type Command = { kind: 'run' | 'pause' | 'step' } |
  { kind: 'set-speed'; speed: Speed } | { kind: 'frame'; elapsed: number };
const commands = fc.array(fc.oneof(
  fc.constantFrom<Command>({ kind: 'run' }, { kind: 'pause' }, { kind: 'step' }),
  fc.constantFrom(...SPEEDS).map((speed): Command => ({ kind: 'set-speed', speed })),
  fc.integer({ min: 0, max: 1500 }).map((elapsed): Command => ({ kind: 'frame', elapsed })),
), { maxLength: 40 });

test('controller keeps one outstanding frame and advances by its bounded paced budget', () => {
  loadWasm();
  fc.assert(fc.property(seedBigIntArb, configJsonArb, commands, (seed, config, sequence) => {
    const scheduler = new FakeFrameScheduler();
    const clock = new FakeClock();
    const { post, messages } = messageCollector<WorkerMessage>();
    const rec = new RecordingSimHandle(createSim(seed, config));
    const controller = new SimController({ createSim: () => rec, scheduler, clock, post });
    controller.ready();
    let id = 1;
    controller.handle({ type: 'create-world', id: id++, seed: seed.toString(), config });
    const reference = new PacingReference();
    let running = false;
    let speed: Speed = 1;
    const currentState = () => {
      const last = messages.at(-1)!;
      assert.notEqual(last.type, 'fatal');
      return last.type === 'fatal' ? 'failed' : last.snapshot.runState;
    };
    for (const cmd of sequence) {
      assert.equal(scheduler.isPending, running, 'one outstanding frame iff running');
      const before = rec.tick();
      const callsBefore = rec.mutatingCalls.length;
      if (cmd.kind === 'frame') {
        clock.advance(cmd.elapsed);
        const expected: number = running ? reference.frame(clock.now(), speed) : 0;
        assert.equal(scheduler.flush(), running);
        const calls = rec.mutatingCalls.slice(callsBefore);
        assert.ok(calls.length <= 1, 'one callback cannot run multiple catch-up batches');
        assert.equal(calls.length, expected === 0 ? 0 : 1);
        if (expected > 0) {
          assert.deepEqual(calls[0], { method: 'run_until_stop', n: expected });
          const advanced = Number(rec.tick() - before);
          // A real core stop may shorten a budget, but cannot run beyond it.
          assert.ok(advanced > 0 && advanced <= expected);
          if (advanced !== expected) assert.equal(currentState(), 'paused');
          reference.recordActual(expected, advanced);
        } else {
          assert.equal(rec.tick(), before, 'idle/re-anchor/paused frames advance nothing');
        }
        // Stops are unthrottled; normal status may be throttled, so use the
        // scheduler as the authoritative indication of automatic pause.
        running = scheduler.isPending;
      } else if (cmd.kind === 'set-speed') {
        controller.handle({ type: 'set-speed', id: id++, speed: cmd.speed });
        if (running && speed !== cmd.speed) reference.reset(clock.now());
        speed = cmd.speed;
        assert.equal(rec.tick(), before);
        assert.equal(rec.mutatingCalls.length, callsBefore);
      } else {
        controller.handle({ type: cmd.kind, id: id++ });
        if (cmd.kind === 'run') {
          if (!running) reference.reset(clock.now());
          running = true;
          assert.equal(rec.tick(), before, 'run schedules but does not step');
        } else if (cmd.kind === 'pause') {
          running = false;
          assert.equal(rec.tick(), before);
          assert.equal(rec.mutatingCalls.length, callsBefore);
        } else {
          assert.equal(rec.tick() - before, running ? 0n : 1n);
        }
      }
      assert.equal(scheduler.isPending, running);
    }
    // A successful replacement cancels the loop; queued stale-callback stamps
    // and cancellation of old-world requests are owned by task 8.1.
    controller.handle({ type: 'create-world', id: id++, seed: seed.toString(), config });
    const atCreate = rec.tick();
    assert.equal(scheduler.isPending, false);
    for (let i = 0; i < 3; i++) assert.equal(scheduler.flush(), false);
    assert.equal(rec.tick(), atCreate);
  }), { numRuns: RUNS });
});

test('set-speed re-anchors so slowing down does not stall and speeding up stays bounded', () => {
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock();
  const rec = new RecordingSimHandle(createSim(7n, '{"opening_residents":45}'));
  const controller = new SimController({ createSim: () => rec, scheduler, clock, post: () => {} });
  controller.ready();
  controller.handle({ type: 'create-world', id: 1, seed: '7', config: '{}' });
  controller.handle({ type: 'set-speed', id: 2, speed: 365 });
  controller.handle({ type: 'run', id: 3 });
  clock.advance(40);
  scheduler.flush();
  assert.equal(rec.tick(), 438n);
  controller.handle({ type: 'set-speed', id: 4, speed: 1 });
  clock.advance(40);
  scheduler.flush();
  assert.equal(rec.tick(), 439n, 'lower speed starts advancing within its first tick interval');
  controller.handle({ type: 'set-speed', id: 5, speed: 365 });
  const before = rec.tick();
  clock.advance(100);
  scheduler.flush();
  assert.equal(rec.runUntilStopArgs.at(-1), Math.ceil(365 * PLAY_RATE / 20));
  assert.ok(rec.tick() - before <= BigInt(Math.ceil(365 * PLAY_RATE / 20)));
});

test('no batch runs in no-world or paused, and resume excludes paused wall time', () => {
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock();
  const rec = new RecordingSimHandle(createSim(1n, '{"opening_residents":40}'));
  const controller = new SimController({ createSim: () => rec, scheduler, clock, post: () => {} });
  controller.ready();
  controller.handle({ type: 'run', id: 1 });
  assert.equal(scheduler.flush(), false);
  controller.handle({ type: 'create-world', id: 2, seed: '1', config: '{}' });
  assert.equal(scheduler.flush(), false);
  assert.equal(rec.mutatingCalls.length, 0);
  controller.handle({ type: 'run', id: 3 });
  clock.advance(40);
  scheduler.flush();
  assert.equal(rec.tick(), 1n);
  controller.handle({ type: 'pause', id: 4 });
  clock.advance(10_000);
  assert.equal(scheduler.flush(), false);
  controller.handle({ type: 'run', id: 5 });
  scheduler.flush();
  assert.equal(rec.tick(), 1n);
  clock.advance(40);
  scheduler.flush();
  assert.equal(rec.tick(), 2n);
});

/** Real Snapshot/read seams, with a scripted stop injected at one tick. */
class ScriptedStopHandle extends RecordingSimHandle {
  readonly stopTick: bigint;
  readonly reasons: PauseReason[];
  constructor(inner: SimHandle, stopTick: bigint, reasons: PauseReason[]) {
    super(inner);
    this.stopTick = stopTick;
    this.reasons = reasons;
  }
  override run_until_stop(max: number): string {
    const remaining = this.stopTick - this.tick();
    const result = JSON.parse(super.run_until_stop(remaining > 0n ? Math.min(max, Number(remaining)) : max));
    if (this.tick() === this.stopTick) result.stops = this.reasons;
    return JSON.stringify(result);
  }
}

for (const reasons of [
  ['player_node'], ['player_died'], ['dream_resolved'], ['player_reborn'],
  ['player_node', 'player_died', 'dream_resolved', 'player_reborn'],
] satisfies PauseReason[][]) {
  test(`a frame stop ${reasons.join('+')} posts one unthrottled post-tick Snapshot and runs no later tick`, () => {
    const scheduler = new FakeFrameScheduler();
    const clock = new FakeClock();
    const { post, messages } = messageCollector<WorkerMessage>();
    const sim = new ScriptedStopHandle(createSim(3n, '{"opening_residents":40}'), 5n, reasons);
    const controller = new SimController({ createSim: () => sim, scheduler, clock, post });
    controller.ready();
    controller.handle({ type: 'create-world', id: 1, seed: '3', config: '{}' });
    controller.handle({ type: 'set-speed', id: 2, speed: 7 });
    controller.handle({ type: 'run', id: 3 });
    clock.advance(10);
    scheduler.flush();
    const messagesBeforeStop = messages.length;
    clock.advance(20); // inside the 100 ms throttle, budget reaches beyond tick 5
    scheduler.flush();
    const posted = messages.slice(messagesBeforeStop);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, 'status');
    const status = posted[0];
    assert.ok(status.type === 'status');
    assert.equal(status.snapshot.runState, 'paused');
    assert.equal(status.snapshot.tick, '5');
    assert.equal(status.snapshot.checksum, JSON.parse(sim.checksums(4n, 4n))[0]);
    assert.deepEqual(status.snapshot.stop, { reasons, world: JSON.parse(sim.snapshot()) });
    assert.equal(status.snapshot.stop?.world.tick, '5');
    assert.equal(scheduler.isPending, false);
    const calls = sim.mutatingCalls.length;
    for (let i = 0; i < 5; i++) { clock.advance(1000); assert.equal(scheduler.flush(), false); }
    assert.equal(sim.tick(), 5n);
    assert.equal(sim.mutatingCalls.length, calls);
    assert.equal(messages.length, messagesBeforeStop + 1);
  });
}

test('step posts its stop only in one status before its sole reply; pause reports user', () => {
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock();
  const { post, messages } = messageCollector<WorkerMessage>();
  const reasons: PauseReason[] = ['player_died', 'player_reborn'];
  const sim = new ScriptedStopHandle(createSim(4n, '{"opening_residents":40}'), 1n, reasons);
  const controller = new SimController({ createSim: () => sim, scheduler, clock, post });
  controller.ready();
  controller.handle({ type: 'create-world', id: 1, seed: '4', config: '{}' });
  controller.handle({ type: 'step', id: 2 });
  const replies = messages.filter((m) => m.type === 'reply' && m.id === 2);
  assert.equal(replies.length, 1);
  const reply = replies[0];
  assert.ok(reply.type === 'reply' && reply.ok);
  assert.equal(reply.snapshot.stop, undefined, 'the tick stop has only one carrier');
  const statuses = messages.filter((m) => m.type === 'status');
  assert.equal(statuses.length, 1);
  assert.deepEqual(statuses[0].snapshot.stop, { reasons, world: JSON.parse(sim.snapshot()) });
  assert.equal(messages.indexOf(statuses[0]) < messages.indexOf(reply), true);
  assert.equal(sim.tick(), 1n);
  controller.handle({ type: 'run', id: 3 });
  controller.handle({ type: 'pause', id: 4 });
  const pause = messages.at(-1)!;
  assert.ok(pause.type === 'reply' && pause.ok);
  assert.deepEqual(pause.snapshot.stop, { reasons: ['user'], world: JSON.parse(sim.snapshot()) });
  assert.equal(pause.snapshot.runState, 'paused');
  assert.equal(scheduler.isPending, false);
  assert.equal(sim.tick(), 1n);
  controller.handle({ type: 'pause', id: 5 });
  const alreadyPaused = messages.at(-1)!;
  assert.ok(alreadyPaused.type === 'reply' && alreadyPaused.ok);
  assert.equal(alreadyPaused.snapshot.stop, undefined, 'stop is reported only once');
});

class CountingClock extends FakeClock {
  reads = 0;
  override now(): number {
    this.reads++;
    return super.now();
  }
}

test('same-speed set-speed preserves the running anchor and accumulated target', () => {
  const clock = new CountingClock();
  const scheduler = new FakeFrameScheduler();
  const sim = createSim(1n, '{"opening_residents":40}');
  const controller = new SimController({ createSim: () => sim, scheduler, clock, post: () => {} });
  controller.ready();
  controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
  controller.handle({ type: 'set-speed', id: 2, speed: 7 });
  controller.handle({ type: 'run', id: 3 });
  clock.advance(10);
  scheduler.flush();
  assert.equal(sim.tick(), 2n);
  clock.advance(10);
  const reads = clock.reads;
  controller.handle({ type: 'set-speed', id: 4, speed: 7 });
  assert.equal(clock.reads - reads, 1, 'only the reply clock read, no pacing reset');
  clock.advance(10);
  scheduler.flush();
  assert.equal(sim.tick(), 6n, 'target stays anchored at run start, not the repeated Speed');
});

test('paused set-speed leaves the pacer alone until the accepted run re-anchors', () => {
  const clock = new CountingClock();
  const scheduler = new FakeFrameScheduler();
  const sim = createSim(1n, '{"opening_residents":40}');
  const controller = new SimController({ createSim: () => sim, scheduler, clock, post: () => {} });
  controller.ready();
  controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
  controller.handle({ type: 'run', id: 2 });
  controller.handle({ type: 'pause', id: 3 });
  clock.advance(1000);
  const reads = clock.reads;
  controller.handle({ type: 'set-speed', id: 4, speed: 30 });
  assert.equal(clock.reads - reads, 1, 'only the reply clock read, no pacing reset');
  assert.equal(scheduler.isPending, false);
  assert.equal(sim.tick(), 0n);
  clock.advance(1000);
  controller.handle({ type: 'run', id: 5 });
  scheduler.flush();
  assert.equal(sim.tick(), 0n, 'paused wall time is not credited');
  clock.advance(10);
  scheduler.flush();
  assert.equal(sim.tick(), 9n);
});

test('a rejected no-world run does not establish a pacing anchor or schedule advancement', () => {
  const clock = new CountingClock(555);
  const scheduler = new FakeFrameScheduler();
  const { post, messages } = messageCollector<WorkerMessage>();
  let creates = 0;
  const controller = new SimController({
    createSim: (seed, config) => { creates++; return createSim(seed, config); },
    scheduler, clock, post,
  });
  controller.ready();
  controller.handle({ type: 'run', id: 1 });
  const rejected = messages[0];
  assert.ok(rejected.type === 'reply' && !rejected.ok);
  assert.equal(rejected.kind, 'no-world');
  assert.equal(clock.reads, 1, 'only the failure reply reads the clock');
  assert.equal(creates, 0);
  assert.equal(scheduler.isPending, false);
  clock.advance(10_000);
  controller.handle({ type: 'create-world', id: 2, seed: '1', config: '{"opening_residents":40}' });
  controller.handle({ type: 'run', id: 3 });
  scheduler.flush();
  const unchanged = messages.at(-1)!;
  assert.ok(unchanged.type === 'status');
  assert.equal(unchanged.snapshot.tick, '0');
  clock.advance(50);
  scheduler.flush();
  controller.handle({ type: 'pause', id: 4 });
  const paused = messages.at(-1)!;
  assert.ok(paused.type === 'reply' && paused.ok);
  assert.equal(paused.snapshot.tick, '1');
});
