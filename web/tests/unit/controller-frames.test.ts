// Feature: web-shell, Property 5: Frame discipline
//
// Validates: Requirements 4.3, 4.5, 4.6
//
// Property 5 (design.md): For any command sequence as in Property 4, at most one
// frame request is outstanding at any time; it is outstanding only while Run_State
// is `running`; each fired frame callback while `running` advances the tick by
// exactly the Speed that was current when the callback started; and after a pause
// reply (or a successful create-world) firing any number of frames leaves the tick
// unchanged.
//
// This is the property the task-2.14 Unit_Tests fault injection targets: injecting
// `Speed + 1` ticks per batch in controller.ts must make THIS test fail. So the
// per-batch tick count is checked concretely: around every fired frame we read the
// real WasmSim's tick() (a read-only call, R6.1) before and after the flush and
// require the delta to equal exactly the Speed captured when that batch started.
//
// What the design's worker loop guarantees, and how each is checked here:
//
//   * At most one frame request outstanding (R4.3). The FakeFrameScheduler throws
//     on a second request while one is pending; a correct controller only ever
//     requests the next frame from inside the previous frame's callback, after
//     clearing the handle, so it never triggers the throw. The test asserts the
//     controller never triggers it (any throw fails the property) and that
//     `scheduler.isPending` is true exactly while Run_State is `running` and false
//     when paused, no-world or failed.
//
//   * Each running batch advances the tick by exactly the Speed in effect when the
//     batch STARTED (R4.3). step() counts as 1 tick, run_ticks(n) as n; the design
//     captures the Speed at batch start so a set-speed mid-run does not change the
//     batch in progress. We measure the tick() delta across each flush and compare
//     it to the Speed we expect that batch to use.
//
//   * A set-speed mid-run takes effect only from the NEXT batch (R4.5). We model
//     the expected per-batch Speed exactly as the loop does: the Speed used by a
//     batch is the stored Speed at the instant the batch starts. A set-speed
//     request changes the stored Speed immediately, but because a batch runs
//     atomically inside one flush, a set-speed issued between flushes only affects
//     batches fired afterwards.
//
//   * After a pause (or a successful create-world) no further batch runs until run
//     again (R4.6): once paused, firing frames runs no step/run_ticks and leaves
//     the tick unchanged. We assert the mutating-call count and the tick() value do
//     not move across flushes while not running.
//
//   * No catch-up: firing one frame runs exactly one batch, not several (R4.3). A
//     single flush() fires exactly one callback (the FakeFrameScheduler holds one
//     pending callback), and we check exactly one new batch's worth of mutating
//     calls appears per flush that runs a batch.
//
// Setup (R6.6): a RecordingSimHandle wrapping the real WasmSim from target/wasm-pkg,
// a hand-driven FakeFrameScheduler, a FakeClock and a messageCollector. The clock
// advances only for pacing/tps and never reaches the simulation (R6.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import type { Request, WorkerMessage } from '../../src/shared/protocol.ts';
import { SPEEDS } from '../../src/shared/speeds.ts';
import { createSim as realCreateSim, loadWasm } from './helpers/wasm.ts';
import {
  FakeClock,
  FakeFrameScheduler,
  RecordingSimHandle,
  messageCollector,
  type RecordedCall,
} from './helpers/fakes.ts';
import { configJsonArb, seedBigIntArb } from './helpers/gen.ts';

const RUNS = 1000;

/** The per-case tick cap (as in Property 4): keeps 1000 runs fast. */
const TICK_BUDGET = 3_000;

/**
 * A command the test drives. create-world runs once at the start of each case;
 * the sequence here varies pacing plus set-speed. `fire-frames` fires k frames on
 * the fake scheduler. Only valid Speed values appear: Property 5 is about correct
 * pacing, not rejection (that is Property 3), and an invalid set-speed would not
 * change the stored Speed anyway.
 */
type Command =
  | { kind: 'run' }
  | { kind: 'pause' }
  | { kind: 'step' }
  | { kind: 'set-speed'; speed: number }
  | { kind: 'fire-frames'; count: number };

interface FrameCase {
  seed: bigint;
  config: string;
  commands: Command[];
}

const validSpeedArb: fc.Arbitrary<number> = fc.constantFrom(...SPEEDS);

/**
 * A command sequence whose worst-case tick total stays under TICK_BUDGET. Each
 * fired frame runs at most max(SPEEDS) = 365 ticks and each step one, so we bound
 * the number of fire-frames commands (each firing 1..8 frames) and the steps. The
 * mix includes set-speed between frames (varying Speed mid-run) so the "next batch"
 * rule is exercised.
 */
const commandsArb: fc.Arbitrary<Command[]> = (() => {
  const maxSpeed = Math.max(...SPEEDS); // 365
  const maxFramesPerCommand = 8;
  const maxFrameTicks = Math.floor(TICK_BUDGET * 0.9);
  const maxFrameCommands = Math.max(1, Math.floor(maxFrameTicks / (maxSpeed * maxFramesPerCommand)));
  const maxSteps = TICK_BUDGET - maxFrameTicks;

  const one = fc.oneof(
    { arbitrary: fc.constant<Command>({ kind: 'run' }), weight: 4 },
    { arbitrary: fc.constant<Command>({ kind: 'pause' }), weight: 2 },
    { arbitrary: fc.constant<Command>({ kind: 'step' }), weight: 1 },
    { arbitrary: validSpeedArb.map((speed): Command => ({ kind: 'set-speed', speed })), weight: 3 },
    {
      arbitrary: fc
        .integer({ min: 1, max: maxFramesPerCommand })
        .map((count): Command => ({ kind: 'fire-frames', count })),
      weight: 5,
    },
  );

  return fc.array(one, { minLength: 0, maxLength: 40 }).map((cmds) => {
    let frameCommands = 0;
    let steps = 0;
    const kept: Command[] = [];
    for (const c of cmds) {
      if (c.kind === 'fire-frames') {
        if (frameCommands >= maxFrameCommands) continue;
        frameCommands++;
      } else if (c.kind === 'step') {
        if (steps >= maxSteps) continue;
        steps++;
      }
      kept.push(c);
    }
    return kept;
  });
})();

const caseArb: fc.Arbitrary<FrameCase> = fc.record({
  seed: seedBigIntArb,
  config: configJsonArb,
  commands: commandsArb,
});

/** Number of ticks a recorded mutating call represents: step() = 1, run_ticks(n) = n. */
function callTicks(call: RecordedCall): number {
  if (call.method === 'step') return 1;
  if (call.method === 'run_ticks') return call.n;
  // submit and tick do not advance ticks; they must not appear inside a running
  // batch, but counting them as 0 keeps the slicing below robust.
  return 0;
}

// Property 5: frame discipline.
test('controller runs at most one frame at a time and each batch advances by exactly its start Speed', () => {
  // Load once up front so the first property run is not timed out by WASM init.
  loadWasm();

  fc.assert(
    fc.property(caseArb, (c) => {
      const scheduler = new FakeFrameScheduler();
      const clock = new FakeClock(0);
      const { post, messages } = messageCollector<WorkerMessage>();

      // Wrap the real WasmSim so we can read tick() directly and count batches by
      // mutating calls. The controller only ever sees the recording handle.
      let recorder: RecordingSimHandle | null = null;
      const createSim = (seed: bigint, config: string): SimHandle => {
        recorder = new RecordingSimHandle(realCreateSim(seed, config));
        return recorder;
      };

      const controller = new SimController({ createSim, scheduler, clock, post });
      controller.ready();

      // Read Run_State from the replies/statuses the controller posts, so the
      // "isPending only while running" invariant is checked against the controller's
      // own reported state. The latest non-fatal snapshot's runState is
      // authoritative. A function (not a stored variable) so the strict-assert
      // narrowing below never pins its static type to one literal.
      const runStateNow = (): string => {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.type !== 'fatal') {
            return m.snapshot.runState;
          }
        }
        return 'no-world';
      };

      // The Speed the controller has stored right now (what the NEXT batch to start
      // will use). Mirrors the controller: starts at SPEEDS[0], changes immediately
      // on a valid set-speed, and is unchanged by run/pause/create.
      let storedSpeed: number = SPEEDS[0];

      let nextId = 1;

      // One world under test.
      controller.handle({ type: 'create-world', id: nextId++, seed: c.seed.toString(), config: c.config });
      assert.ok(recorder !== null, 'create-world must build a sim handle');
      // After a successful create-world the loop is stopped: no frame outstanding.
      assert.equal(
        scheduler.isPending,
        false,
        'no frame request may be outstanding right after a successful create-world (R4.6)',
      );
      assert.equal(runStateNow(), 'paused', 'create-world leaves Run_State paused');

      // `mutatingCalls.length` consumed so far, so we can slice out the calls a
      // single flush added and measure that one batch.
      let consumedCalls = 0;

      const rec = (): RecordingSimHandle => {
        assert.ok(recorder !== null, 'sim handle exists');
        return recorder;
      };

      /** Fire one frame and verify exactly one batch ran (or none, if not running). */
      const fireOneFrame = (): void => {
        const wasRunning = runStateNow() === 'running';
        const pendingBefore = scheduler.isPending;

        // While running, a frame must be outstanding; while not running, none.
        if (wasRunning) {
          assert.equal(
            pendingBefore,
            true,
            'a frame request must be outstanding while Run_State is running (R4.3)',
          );
        } else {
          assert.equal(
            pendingBefore,
            false,
            `no frame request may be outstanding while Run_State is ${runStateNow()} (R4.3, R4.6)`,
          );
        }

        const tickBefore = rec().tick();
        const callsBefore = rec().mutatingCalls.length;

        // A single flush fires exactly one callback (no catch-up); request() throws
        // if the controller ever tries to keep two frames pending, which fails the
        // property.
        const fired = scheduler.flush();

        const tickAfter = rec().tick();
        const callsAfter = rec().mutatingCalls.length;
        const newCalls = rec().mutatingCalls.slice(callsBefore, callsAfter);

        if (!pendingBefore) {
          // Nothing was outstanding: flush did nothing.
          assert.equal(fired, false, 'flush with no pending frame must fire nothing');
          assert.equal(
            tickAfter,
            tickBefore,
            'firing a frame while not running must not advance the tick (R4.6)',
          );
          assert.equal(newCalls.length, 0, 'firing a frame while not running must run no batch (R4.6)');
          return;
        }

        // A frame was outstanding and fired.
        assert.equal(fired, true, 'a pending frame must fire');

        if (!wasRunning) {
          // The callback was outstanding but Run_State was not running: a pause or
          // create between request and fire cancels the batch. The loop callback
          // returns at once, running no batch and advancing no tick.
          assert.equal(
            tickAfter,
            tickBefore,
            'a frame fired while not running must advance no tick (R4.6)',
          );
          assert.equal(
            newCalls.length,
            0,
            'a frame fired while not running must run no step/run_ticks (R4.6)',
          );
          return;
        }

        // Running: exactly one batch ran. The batch is a single step() (Speed 1) or
        // a single run_ticks(Speed) (Speed > 1) — at most one mutating call, no
        // catch-up.
        assert.ok(
          newCalls.length <= 1,
          `one fired frame must run at most one batch call, saw ${newCalls.length} (no catch-up, R4.3)`,
        );
        assert.ok(newCalls.length >= 1, 'a running frame must run exactly one batch');

        const batchCall = newCalls[0];
        // The Speed this batch used is the stored Speed captured when the batch
        // started. No set-speed happens inside a flush, so it equals `storedSpeed`.
        const expectedSpeed = storedSpeed;

        // Shape: Speed 1 -> step(); Speed > 1 -> run_ticks(expectedSpeed).
        if (expectedSpeed === 1) {
          assert.equal(
            batchCall.method,
            'step',
            `Speed 1 batch must call step(), saw ${batchCall.method}`,
          );
        } else {
          assert.equal(
            batchCall.method,
            'run_ticks',
            `Speed ${expectedSpeed} batch must call run_ticks(), saw ${batchCall.method}`,
          );
          assert.equal(
            (batchCall as { method: 'run_ticks'; n: number }).n,
            expectedSpeed,
            `run_ticks argument must equal the batch's start Speed ${expectedSpeed}`,
          );
        }

        // The concrete per-batch tick count (this is what the 2.14 injection breaks):
        // the tick() delta across the batch must equal exactly the start Speed.
        const advanced = Number(tickAfter - tickBefore);
        assert.equal(
          advanced,
          expectedSpeed,
          `batch advanced the tick by ${advanced} but its start Speed was ${expectedSpeed} ` +
            `(R4.3: a batch runs exactly Speed ticks; a Speed+1 injection fails here) ` +
            `[call ${JSON.stringify(batchCall)}]`,
        );
        // Belt-and-braces: the recorded call's own tick count agrees.
        assert.equal(
          callTicks(batchCall),
          expectedSpeed,
          `recorded batch call represents ${callTicks(batchCall)} ticks, expected ${expectedSpeed}`,
        );

        // After the batch the loop requests the next frame (still running) or stops
        // (should not happen without a pause/create, but a fatal could): a running
        // controller keeps exactly one frame outstanding.
        if (runStateNow() === 'running') {
          assert.equal(
            scheduler.isPending,
            true,
            'while running, the next frame must be requested after each batch (one outstanding, R4.3)',
          );
        }

        consumedCalls = callsAfter;
      };

      for (const cmd of c.commands) {
        switch (cmd.kind) {
          case 'run': {
            controller.handle({ type: 'run', id: nextId++ });
            // Running: exactly one frame outstanding.
            if (runStateNow() === 'running') {
              assert.equal(
                scheduler.isPending,
                true,
                'run must leave exactly one frame request outstanding (R4.3)',
              );
            }
            break;
          }
          case 'pause': {
            const wasRunning = runStateNow() === 'running';
            controller.handle({ type: 'pause', id: nextId++ });
            assert.equal(runStateNow(), 'paused', 'pause leaves Run_State paused');
            // Pause cancels the outstanding frame: none pending after pause (R4.6).
            assert.equal(
              scheduler.isPending,
              false,
              'no frame request may be outstanding after pause (R4.6)',
            );
            // After pause, firing frames runs no batch and leaves the tick unchanged.
            if (wasRunning) {
              const tickAtPause = rec().tick();
              const callsAtPause = rec().mutatingCalls.length;
              for (let i = 0; i < 3; i++) {
                clock.advance(16);
                const fired = scheduler.flush();
                assert.equal(fired, false, 'no frame may fire after pause (R4.6)');
              }
              assert.equal(
                rec().tick(),
                tickAtPause,
                'the tick must not change while paused and no step is activated (R4.6)',
              );
              assert.equal(
                rec().mutatingCalls.length,
                callsAtPause,
                'no batch may run while paused (R4.6)',
              );
            }
            break;
          }
          case 'step': {
            // step is only valid while paused; it runs exactly one tick and does not
            // start the loop. Not the focus here, but we keep the stored tick model
            // consistent by not touching storedSpeed.
            controller.handle({ type: 'step', id: nextId++ });
            // step never starts a frame.
            if (runStateNow() !== 'running') {
              assert.equal(
                scheduler.isPending,
                false,
                'step must not start a frame request (R4.6)',
              );
            }
            break;
          }
          case 'set-speed': {
            controller.handle({ type: 'set-speed', id: nextId++, speed: cmd.speed });
            // A valid set-speed changes the stored Speed immediately; a batch already
            // in progress is atomic within a flush, so this only affects the NEXT
            // fired batch (R4.5). We update our mirror of the stored Speed now; the
            // per-batch check reads it at the instant each batch starts.
            storedSpeed = cmd.speed;
            // set-speed does not start, stop or change the loop.
            break;
          }
          case 'fire-frames': {
            for (let i = 0; i < cmd.count; i++) {
              clock.advance(16);
              fireOneFrame();
            }
            break;
          }
        }
      }

      // Final invariant: isPending is true iff Run_State is running.
      const endState = runStateNow();
      assert.equal(
        scheduler.isPending,
        endState === 'running',
        `at end, a frame is outstanding (${scheduler.isPending}) iff Run_State is running (${endState})`,
      );

      void consumedCalls;
    }),
    { numRuns: RUNS },
  );
});

// Focused example: a set-speed issued mid-run takes effect only from the NEXT batch
// (R4.5). We run at Speed 1, fire one frame (a 1-tick batch), then set Speed to 365
// and fire again; the second batch must advance exactly 365, and a third exactly 365.
test('a set-speed mid-run changes only the batches that start after it (R4.5)', () => {
  loadWasm();

  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const { post } = messageCollector<WorkerMessage>();

  let recorder: RecordingSimHandle | null = null;
  const createSim = (seed: bigint, config: string): SimHandle => {
    recorder = new RecordingSimHandle(realCreateSim(seed, config));
    return recorder;
  };
  const controller = new SimController({ createSim, scheduler, clock, post });
  controller.ready();

  let id = 1;
  controller.handle({ type: 'create-world', id: id++, seed: '7', config: '{"entity_count":5,"workload":"Light"}' });
  assert.ok(recorder !== null);
  const rec = recorder as unknown as RecordingSimHandle;

  // Run at the default Speed 1.
  controller.handle({ type: 'run', id: id++ });
  assert.equal(scheduler.isPending, true, 'running: one frame outstanding');

  // First batch at Speed 1: advances exactly 1 tick.
  let before = rec.tick();
  clock.advance(16);
  scheduler.flush();
  assert.equal(Number(rec.tick() - before), 1, 'first batch at Speed 1 advances 1 tick');

  // Change Speed to 365 mid-run. The batch in progress has already finished (atomic
  // flush), so this only affects batches fired afterwards (R4.5).
  controller.handle({ type: 'set-speed', id: id++, speed: 365 });

  // Next batch uses the new Speed 365.
  before = rec.tick();
  clock.advance(16);
  scheduler.flush();
  assert.equal(Number(rec.tick() - before), 365, 'the batch after set-speed 365 advances 365 ticks');

  // And the one after it, too (the Speed persists).
  before = rec.tick();
  clock.advance(16);
  scheduler.flush();
  assert.equal(Number(rec.tick() - before), 365, 'Speed 365 persists for later batches');

  // Pause: no frame outstanding, firing does nothing.
  controller.handle({ type: 'pause', id: id++ });
  assert.equal(scheduler.isPending, false, 'paused: no frame outstanding (R4.6)');
  const atPause = rec.tick();
  clock.advance(16);
  assert.equal(scheduler.flush(), false, 'no frame fires while paused');
  assert.equal(rec.tick(), atPause, 'tick unchanged while paused');
});

// Focused example: firing frames while paused or in no-world runs no batch, and the
// controller never keeps two frame requests pending (the FakeFrameScheduler would
// throw). This makes the "one outstanding, no catch-up" claim concrete.
test('no batch runs while not running, and the scheduler never holds two frames (R4.3, R4.6)', () => {
  loadWasm();

  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const { post } = messageCollector<WorkerMessage>();

  let recorder: RecordingSimHandle | null = null;
  const createSim = (seed: bigint, config: string): SimHandle => {
    recorder = new RecordingSimHandle(realCreateSim(seed, config));
    return recorder;
  };
  const controller = new SimController({ createSim, scheduler, clock, post });
  controller.ready();

  // no-world: run is rejected, no frame scheduled.
  controller.handle({ type: 'run', id: 1 });
  assert.equal(scheduler.isPending, false, 'no-world: run schedules no frame (R4.6)');
  assert.equal(scheduler.flush(), false, 'no-world: nothing to fire');

  controller.handle({ type: 'create-world', id: 2, seed: '1', config: '{"entity_count":4,"workload":"Light"}' });
  assert.ok(recorder !== null);
  const rec = recorder as unknown as RecordingSimHandle;

  // paused (just created): firing does nothing.
  assert.equal(scheduler.isPending, false, 'paused after create: no frame outstanding');
  const beforeCalls = rec.mutatingCalls.length;
  const beforeTick = rec.tick();
  for (let i = 0; i < 5; i++) {
    clock.advance(16);
    assert.equal(scheduler.flush(), false, 'paused: no frame fires');
  }
  assert.equal(rec.mutatingCalls.length, beforeCalls, 'paused: no batch runs');
  assert.equal(rec.tick(), beforeTick, 'paused: tick unchanged');

  // Run, then fire several frames: each flush fires exactly one callback and the
  // controller re-requests exactly one frame, so the scheduler never holds two
  // (request() throws if it ever does, which would surface as an exception here).
  controller.handle({ type: 'run', id: 3 });
  for (let i = 0; i < 10; i++) {
    assert.equal(scheduler.isPending, true, 'running: exactly one frame outstanding');
    clock.advance(16);
    scheduler.flush();
  }
  assert.equal(scheduler.isPending, true, 'still running: one frame outstanding');

  // A Request type reference keeps the import honest for the type-checker.
  const _r: Request = { type: 'pause', id: 4 };
  controller.handle(_r);
  assert.equal(scheduler.isPending, false, 'paused: frame cancelled (R4.6)');
});
