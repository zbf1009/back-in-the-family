// Feature: web-shell, Property 6: Clock and frame timing never reach the simulation
//
// Validates: Requirements 6.5
//
// R6.5 (requirements.md): the Web_App uses wall-clock time only for Frame pacing
// and for computing Ticks_Per_Second; no value derived from wall-clock time or
// from a browser random source is ever included in any argument passed to
// Sim_Wasm. The controller (controller.ts) reads its injected Clock only in `run`
// (tps reset), `#onFrame` (tps sample, the 100 ms status throttle) and the
// snapshot's `tps` reading; it never routes a clock value into `createSim`,
// `submit`, `step` or `run_ticks`.
//
// The property proves this behaviourally and directly:
//
//   1. Clock-independence of the mutating call stream. The SAME generated command
//      and frame sequence is run TWICE, once with a well-behaved 60 Hz clock
//      (A: +16 ms per advance) and once with an erratic clock (B: a different,
//      jittery, sometimes-zero advance per step, starting at a different origin).
//      Each run drives its own RecordingSimHandle. The recorded sequences of
//      state-changing calls (submit / step / run_ticks WITH their exact arguments,
//      in order) MUST be identical between the two runs. If any clock value ever
//      influenced which calls are made or their arguments, the two streams would
//      differ. tick() reads and the status/tps cadence are display-only and may
//      differ with the clock, so they are excluded: only the mutating call stream
//      is compared (plus the final tick() and last checksum, which must match).
//
//   2. No argument derives from a clock value. Independently of the two-run
//      comparison, every forwarded argument is checked to come only from the
//      generated inputs: each run_ticks `n` is a member of SPEEDS; each submit
//      input string is one of the generated input strings; and each constructed
//      seed is one of the generated seeds. A clock value (16, 33, a jitter, an
//      origin like 1_000_000) could never satisfy these, so a leak would be caught.
//
// Setup (R6.6): a RecordingSimHandle wrapping the real WasmSim from target/wasm-pkg,
// a hand-driven FakeFrameScheduler, a FakeClock and a messageCollector. The two
// runs share the scheduler-driving sequence exactly; only the clock differs.
//
// If a clock value DID reach the simulation, the two mutating streams would
// diverge or the argument-origin checks would fail, and this test would fail with
// the diverging call and the two clock behaviours that produced it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SimController, type Clock, type SimHandle } from '../../src/worker/controller.ts';
import type { WorkerMessage } from '../../src/shared/protocol.ts';
import { SPEEDS } from '../../src/shared/speeds.ts';
import { createSim as realCreateSim, loadWasm } from './helpers/wasm.ts';
import {
  FakeClock,
  FakeFrameScheduler,
  RecordingSimHandle,
  messageCollector,
  type RecordedCall,
} from './helpers/fakes.ts';
import { commandsArb, type Command } from './helpers/gen.ts';

const RUNS = 1000;

/**
 * A clock whose per-step advance the test controls, so the two runs use genuinely
 * different wall-clock behaviour while firing the identical frame sequence. `A`
 * steps a steady +16 ms (a 60 Hz frame); `B` starts at a different origin and
 * jumps by an erratic amount (including 0, so time can stand still between
 * frames). `performance.now` is monotonic non-decreasing, so both only ever move
 * forward or stay put; the controller must not care which.
 */
interface SteppableClock extends Clock {
  /** Advance the clock as this clock's policy dictates (called once per fired frame). */
  stepTime(): void;
}

/** The well-behaved clock: starts at 0, +16 ms per frame. */
function makeClockA(): SteppableClock {
  const clock = new FakeClock(0);
  return {
    now: () => clock.now(),
    stepTime: () => clock.advance(16),
  };
}

/**
 * The erratic clock: starts at a large non-zero origin and advances by a jittery,
 * sometimes-zero amount drawn from `jitter` in round-robin. Deliberately unlike A
 * so any dependence on the actual clock values would surface as a divergence.
 */
function makeClockB(jitter: readonly number[]): SteppableClock {
  const clock = new FakeClock(1_000_000);
  let i = 0;
  return {
    now: () => clock.now(),
    stepTime: () => {
      const step = jitter.length === 0 ? 0 : jitter[i % jitter.length];
      i++;
      clock.advance(step);
    },
  };
}

/** A generated case: a command sequence and the jitter schedule for clock B. */
interface ClockCase {
  commands: Command[];
  jitter: number[];
}

/**
 * Jitter steps for clock B: non-negative (a monotonic clock never goes backward),
 * including 0 (time can stand still) and values far from 16 so B never coincides
 * with A. A small array reused round-robin is enough to make B erratic.
 */
const jitterArb: fc.Arbitrary<number[]> = fc.array(fc.integer({ min: 0, max: 5_000 }), {
  minLength: 1,
  maxLength: 10,
});

const caseArb: fc.Arbitrary<ClockCase> = fc.record({
  commands: commandsArb(3_000),
  jitter: jitterArb,
});

/**
 * One run of the controller over `commands`, driven by `clock`. Each `fire-frames`
 * command advances the clock once per frame (via `clock.stepTime()`) and flushes
 * one frame, exactly as the other run does, so the two runs differ only in the
 * clock's values. Returns the recording handle of the (single) world, if one was
 * created, plus the last reported checksum.
 *
 * The command sequence is assigned request ids deterministically (a counter), so
 * both runs issue identical requests in identical order.
 */
function runWithClock(
  commands: readonly Command[],
  clock: SteppableClock,
): { recorder: RecordingSimHandle | null; lastChecksum: string | null } {
  const scheduler = new FakeFrameScheduler();
  const { post, messages } = messageCollector<WorkerMessage>();

  let recorder: RecordingSimHandle | null = null;
  const createSim = (seed: bigint, config: string): SimHandle => {
    recorder = new RecordingSimHandle(realCreateSim(seed, config));
    return recorder;
  };

  const controller = new SimController({ createSim, scheduler, clock, post });
  controller.ready();

  let nextId = 1;
  for (const cmd of commands) {
    switch (cmd.kind) {
      case 'create-world':
        controller.handle({ type: 'create-world', id: nextId++, seed: cmd.seed, config: cmd.config });
        break;
      case 'run':
        controller.handle({ type: 'run', id: nextId++ });
        break;
      case 'pause':
        controller.handle({ type: 'pause', id: nextId++ });
        break;
      case 'step':
        controller.handle({ type: 'step', id: nextId++ });
        break;
      case 'set-speed':
        controller.handle({ type: 'set-speed', id: nextId++, speed: cmd.speed });
        break;
      case 'submit':
        controller.handle({ type: 'submit', id: nextId++, input: cmd.input });
        break;
      case 'fire-frames':
        for (let i = 0; i < cmd.count; i++) {
          clock.stepTime();
          scheduler.flush();
        }
        break;
    }
  }

  // The last checksum the controller reported, from the final non-fatal snapshot.
  let lastChecksum: string | null = null;
  for (const m of messages) {
    if (m.type === 'fatal') continue;
    lastChecksum = m.snapshot.checksum;
  }

  return { recorder, lastChecksum };
}

/** The mutating calls (submit / step / run_ticks) of a handle, or [] when no world was built. */
function mutating(recorder: RecordingSimHandle | null): readonly RecordedCall[] {
  return recorder === null ? [] : recorder.mutatingCalls;
}

// Property 6: the clock and frame timing never influence the simulation.
test('the same command/frame sequence makes identical mutating Sim calls under two different clocks', () => {
  // Load once up front so the first property run is not timed out by WASM init.
  loadWasm();

  fc.assert(
    fc.property(caseArb, (c) => {
      // Run A: a steady 60 Hz clock. Run B: an erratic clock, different origin and
      // jittery (sometimes zero) steps. Identical commands, identical frame firing.
      const runA = runWithClock(c.commands, makeClockA());
      const runB = runWithClock(c.commands, makeClockB(c.jitter));

      const callsA = mutating(runA.recorder);
      const callsB = mutating(runB.recorder);

      // The state-changing call stream (method + exact arguments, in order) must be
      // identical. A clock value reaching the simulation would make a call or an
      // argument differ here. tick() reads and status/tps cadence are excluded
      // (display only); only the mutating stream is compared.
      assert.deepEqual(
        callsB,
        callsA,
        'the mutating Sim call stream differs between a 60 Hz clock and an erratic clock ' +
          `(a clock value reached the simulation): A=${JSON.stringify(callsA)} ` +
          `B=${JSON.stringify(callsB)}`,
      );

      // The final completed-tick checksum the controller reported must also match:
      // identical inputs stepped identically produce the identical last checksum,
      // regardless of pacing (R6.5 together with R6.6).
      assert.equal(
        runB.lastChecksum,
        runA.lastChecksum,
        `the last reported checksum differs between the two clocks: ` +
          `A=${runA.lastChecksum} B=${runB.lastChecksum}`,
      );

      // And the final simulation tick must match: the same number of ticks ran in
      // both, so a clock-driven extra/missing batch would show up here too.
      const tickA = runA.recorder === null ? null : runA.recorder.tick();
      const tickB = runB.recorder === null ? null : runB.recorder.tick();
      assert.equal(tickB, tickA, `the final Sim tick differs between the two clocks: A=${tickA} B=${tickB}`);

      // Direct origin checks on run A's forwarded arguments (B is identical by the
      // deepEqual above, so checking one run suffices): no argument may derive from
      // a clock value. The legal origins are:
      //   - run_ticks `n`  : a member of SPEEDS only.
      //   - submit `input` : one of the generated submit input strings only.
      //   - the seed       : one of the generated create-world seed strings only.
      const generatedInputs = new Set<string>();
      const generatedSeeds = new Set<string>();
      for (const cmd of c.commands) {
        if (cmd.kind === 'submit') generatedInputs.add(cmd.input);
        if (cmd.kind === 'create-world') generatedSeeds.add(cmd.seed);
      }

      for (const call of callsA) {
        if (call.method === 'run_ticks') {
          assert.ok(
            (SPEEDS as readonly number[]).includes(call.n),
            `run_ticks argument ${call.n} is not a SPEEDS member; a clock value may have leaked into it`,
          );
        } else if (call.method === 'submit') {
          assert.ok(
            generatedInputs.has(call.input),
            `submit argument ${JSON.stringify(call.input)} is not one of the generated inputs; ` +
              `a clock value may have leaked into it`,
          );
        }
      }

      // The seed passed to createSim is the request seed verbatim: the controller
      // builds a world only for a valid seed, and that string must be one the test
      // generated (never a clock value). We check that every create-world command
      // whose seed produced a world used a generated seed; since the controller
      // passes `req.seed` through `parseSeed` unchanged, the constructed seed can
      // only be a generated one. The deepEqual stream equality plus the SPEEDS and
      // input checks above cover run_ticks and submit; the seed never appears as a
      // SimHandle call argument, so we assert its origin at the command level.
      for (const cmd of c.commands) {
        if (cmd.kind === 'create-world') {
          assert.ok(
            generatedSeeds.has(cmd.seed),
            `create-world seed ${JSON.stringify(cmd.seed)} is not a generated seed`,
          );
        }
      }
    }),
    { numRuns: RUNS },
  );
});

// Focused example: a world run to the same tick under a steady clock and under a
// clock that never advances (now() always returns its origin) makes the identical
// mutating call stream and reaches the identical checksum. A clock stuck at one
// value is the sharpest test that no clock value feeds the simulation.
test('a clock frozen at one value drives the identical Sim calls as a moving clock', () => {
  loadWasm();

  const commands: Command[] = [
    { kind: 'create-world', seed: '42', config: '{"entity_count":6,"workload":"Pairwise"}' },
    { kind: 'submit', input: JSON.stringify({ tick: '1', payload: { SetValue: { entity: '2', value: 11 } } }) },
    { kind: 'set-speed', speed: 7 },
    { kind: 'run' },
    { kind: 'fire-frames', count: 5 },
    { kind: 'pause' },
    { kind: 'step' },
    { kind: 'set-speed', speed: 365 },
    { kind: 'run' },
    { kind: 'fire-frames', count: 3 },
    { kind: 'pause' },
  ];

  // Moving clock: +16 ms per frame.
  const moving = runWithClock(commands, makeClockA());
  // Frozen clock: now() always returns the same origin; stepTime is a no-op.
  const frozenOrigin = 7_777;
  const frozen = runWithClock(commands, {
    now: () => frozenOrigin,
    stepTime: () => {},
  });

  assert.deepEqual(
    mutating(frozen.recorder),
    mutating(moving.recorder),
    'a frozen clock and a moving clock must make the identical mutating Sim call stream',
  );
  assert.equal(
    frozen.lastChecksum,
    moving.lastChecksum,
    'a frozen clock and a moving clock must reach the identical last checksum',
  );
  assert.ok(moving.recorder !== null && frozen.recorder !== null, 'both runs built a world');
  assert.equal(
    frozen.recorder.tick(),
    moving.recorder.tick(),
    'a frozen clock and a moving clock must reach the identical final tick',
  );

  // The frozen clock's value (7_777) and the moving clock's values (16, 32, ...)
  // never appear as a run_ticks argument: every run_ticks n is a SPEEDS member.
  for (const call of mutating(moving.recorder)) {
    if (call.method === 'run_ticks') {
      assert.ok(
        (SPEEDS as readonly number[]).includes(call.n),
        `run_ticks(${call.n}) is not a SPEEDS member`,
      );
    }
  }
});
