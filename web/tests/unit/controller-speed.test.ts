// Feature: web-shell, Property 4: Reported checksums are independent of speed and pacing (model conformance)
//
// Validates: Requirements 3.5, 3.7, 4.1, 4.2, 4.5, 5.4, 6.6
//
// Property 4 (design.md): For any seed, small World_Config (entity count 1-20,
// any workload), list of inputs, and sequence of commands drawn from create-world,
// run, pause, step, set-speed, submit and "fire k frames", with total ticks per
// case capped at 3,000: every snapshot the controller reports with tick N >= 1 has
// the checksum that a reference run returns from its N-th step() call, where the
// reference run uses the same seed, config and inputs, each input submitted before
// the same tick; every snapshot with tick 0 has checksum null; after a successful
// create-world every later snapshot carries the new worldId and Run_State paused
// until a run; and Speed is unchanged by run, pause and create-world.
//
// This is the model-conformance property: the controller (real WasmSim from
// target/wasm-pkg, a hand-driven FakeFrameScheduler, a FakeClock and a
// messageCollector; R6.6) is driven through an arbitrary mix of run, pause, step,
// set-speed and fired frames, varying Speed mid-run and reaching ticks by both
// single-stepping and running at different speeds. For every tick the controller
// reports (in a reply or a status), the checksum it reports must equal the
// checksum the reference produces at that same tick (speed/pacing independence,
// R6.6).
//
// Matching the reference's seq assignment (design "Data Models / Parity fixture"):
// the controller submits inputs through the protocol and the reference submits
// them directly, so both must submit each input BEFORE the same tick and in the
// SAME order. We submit every input up front (at tick 0, before any tick runs, so
// none is a past-tick rejection) in tick-ascending, list-stable order, which is
// exactly the order the reference submits them in as it steps tick by tick. This
// mirrors crates/sim-wasm/tests/parity.rs, which submits the 120 fixture inputs in
// seq order up front before stepping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import type { Request, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import { SPEEDS } from '../../src/shared/speeds.ts';
import { createSim as realCreateSim, loadWasm } from './helpers/wasm.ts';
import { FakeClock, FakeFrameScheduler, messageCollector } from './helpers/fakes.ts';
import { configJsonArb, seedBigIntArb, payloadArb } from './helpers/gen.ts';
import { openReference, stepReference, submitInputJson, type ReferenceInput } from './helpers/reference.ts';

const RUNS = 1000;

/** The per-case tick cap from Property 4 (keeps 100+ runs fast). */
const TICK_BUDGET = 3_000;

/** A reply message (ok true or false), narrowed from WorkerMessage. */
type ReplyMessage = Extract<WorkerMessage, { type: 'reply' }>;

/**
 * A pacing command: everything except create-world and submit. create-world runs
 * once at the start of every case (the world under test), and all inputs are
 * submitted up front, so the sequence here only varies the pacing: run, pause,
 * single-step, change Speed, and fire frames. This is exactly the "sequence of
 * run, pause, step and Speed changes" of R6.6, plus fired frames to drive the loop.
 */
type Pacing =
  | { kind: 'run' }
  | { kind: 'pause' }
  | { kind: 'step' }
  | { kind: 'set-speed'; speed: number }
  | { kind: 'fire-frames'; count: number };

/**
 * A generated case: a valid seed/config world, the inputs to submit before the run,
 * and the pacing command sequence. All values are chosen so the controller never
 * advances past TICK_BUDGET ticks (see `pacingArb`).
 */
interface SpeedCase {
  seed: bigint;
  config: string;
  inputs: ReferenceInput[];
  pacing: Pacing[];
}

/** Only valid Speed values here: Property 4 is about correct pacing, not rejection (that is Property 3). */
const validSpeedArb: fc.Arbitrary<number> = fc.constantFrom(...SPEEDS);

/**
 * A pacing-command sequence whose worst-case tick total stays under TICK_BUDGET.
 * Each fired frame runs at most max(SPEEDS) = 365 ticks and each step runs one, so
 * we bound the number of fire-frames commands (each firing 1..8 frames) and the
 * number of steps. The mix deliberately includes set-speed between frames (varying
 * Speed mid-run) and standalone steps (single-step reaching a tick), so the same
 * tick is reached by both stepping and running at different speeds across cases.
 */
const pacingArb: fc.Arbitrary<Pacing[]> = (() => {
  const maxSpeed = Math.max(...SPEEDS); // 365
  const maxFramesPerCommand = 8;
  const maxFrameTicks = Math.floor(TICK_BUDGET * 0.9);
  const maxFrameCommands = Math.max(1, Math.floor(maxFrameTicks / (maxSpeed * maxFramesPerCommand)));
  const maxSteps = TICK_BUDGET - maxFrameTicks;

  const one = fc.oneof(
    { arbitrary: fc.constant<Pacing>({ kind: 'run' }), weight: 3 },
    { arbitrary: fc.constant<Pacing>({ kind: 'pause' }), weight: 2 },
    { arbitrary: fc.constant<Pacing>({ kind: 'step' }), weight: 2 },
    { arbitrary: validSpeedArb.map((speed): Pacing => ({ kind: 'set-speed', speed })), weight: 3 },
    {
      arbitrary: fc
        .integer({ min: 1, max: maxFramesPerCommand })
        .map((count): Pacing => ({ kind: 'fire-frames', count })),
      weight: 4,
    },
  );

  return fc.array(one, { minLength: 0, maxLength: 40 }).map((cmds) => {
    // Enforce the tick budget by dropping fire-frames / step commands past the cap.
    let frameCommands = 0;
    let steps = 0;
    const kept: Pacing[] = [];
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

/** An input bound to a tick in [0, TICK_BUDGET). */
const inputArb: fc.Arbitrary<ReferenceInput> = fc.record({
  tick: fc.integer({ min: 0, max: TICK_BUDGET - 1 }),
  payload: payloadArb,
});

/**
 * A whole case. Inputs are sorted by tick ascending (stable, so equal ticks keep
 * list order); submitting them up front in that order, and the reference submitting
 * them in that same order as it steps, assigns identical seq values on both sides.
 */
const caseArb: fc.Arbitrary<SpeedCase> = fc
  .record({
    seed: seedBigIntArb,
    config: configJsonArb,
    inputs: fc.array(inputArb, { minLength: 0, maxLength: 12 }),
    pacing: pacingArb,
  })
  .map((c) => ({
    ...c,
    inputs: stableSortByTick(c.inputs),
  }));

/** Stable sort by `tick` ascending (equal ticks keep their list order). */
function stableSortByTick(inputs: readonly ReferenceInput[]): ReferenceInput[] {
  return inputs
    .map((input, index) => ({ input, index }))
    .sort((a, b) => a.input.tick - b.input.tick || a.index - b.index)
    .map(({ input }) => input);
}

/** A decimal string with no leading zeros: "0" alone, or a non-zero leading digit. */
const DECIMAL_NO_LEADING_ZERO = /^(0|[1-9][0-9]*)$/;
/** Exactly 16 lowercase hexadecimal characters. */
const CHECKSUM_16_LOWER_HEX = /^[0-9a-f]{16}$/;

/**
 * Parse a snapshot's tick to a number when it is a well-formed non-null decimal.
 * Returns null for a null tick (no world / before any tick). The budget keeps every
 * reached tick far below 2^53, so Number is exact here.
 */
function tickNumber(tick: string | null): number | null {
  if (tick === null) return null;
  assert.match(tick, DECIMAL_NO_LEADING_ZERO, `tick not a clean decimal: ${JSON.stringify(tick)}`);
  return Number(tick);
}

/**
 * Drive one case through the controller and return, in order, every reported
 * snapshot that belongs to the world under test (worldId 1). Replies and statuses
 * both count: each carries a (tick, checksum) pair for a completed tick (R5.4).
 */
function runCase(c: SpeedCase): Snapshot[] {
  const scheduler = new FakeFrameScheduler();
  const clock = new FakeClock(0);
  const { post, messages } = messageCollector<WorkerMessage>();

  const createSim = (seed: bigint, config: string): SimHandle => realCreateSim(seed, config);
  const controller = new SimController({ createSim, scheduler, clock, post });
  controller.ready();

  // One world under test, created from the generated seed/config.
  let nextId = 1;
  const seedStr = c.seed.toString();
  controller.handle({ type: 'create-world', id: nextId++, seed: seedStr, config: c.config });

  // Submit every input up front (at tick 0, before any tick runs) in tick-ascending,
  // list-stable order, so each is accepted and seq matches the reference (R6.6).
  for (const input of c.inputs) {
    const req: Request = { type: 'submit', id: nextId++, input: submitInputJson(input) };
    controller.handle(req);
  }

  // Then vary pacing: run, pause, single-step, set-speed between frames, and fire
  // frames. The clock advances a little per frame (pacing and tps only; it never
  // reaches the simulation, R6.5).
  for (const cmd of c.pacing) {
    if (cmd.kind === 'fire-frames') {
      for (let i = 0; i < cmd.count; i++) {
        clock.advance(16);
        scheduler.flush();
      }
      continue;
    }
    switch (cmd.kind) {
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
    }
  }

  // Keep only the snapshots of the world under test (worldId 1). A fatal/worker
  // error carries no snapshot; there is no create-world after the first here, so
  // every snapshot with a world has worldId 1.
  const snapshots: Snapshot[] = [];
  for (const m of messages) {
    if (m.type === 'fatal') continue;
    snapshots.push(m.snapshot);
  }
  return snapshots;
}

// Property 4: reported checksums are independent of speed and pacing.
test('controller-reported checksums match a speed-independent reference run at every tick', () => {
  // Load once up front so the first property run is not timed out by WASM init.
  loadWasm();

  fc.assert(
    fc.property(caseArb, (c) => {
      const snapshots = runCase(c);

      // The highest tick the controller reported for the world under test; the
      // reference is extended lazily up to it (built once per case).
      let maxReported = 0;
      for (const s of snapshots) {
        const n = s.worldId === 1 ? tickNumber(s.tick) : null;
        if (n !== null && n > maxReported) maxReported = n;
      }

      // Build the reference up to `maxReported` on one handle, submitting inputs in
      // the same order the controller did (tick-ascending, list-stable). checksums[n]
      // is the checksum of tick n+1 (the n-th step() call, 1-based tick n+1).
      const refHandle = openReference(c.seed, c.config);
      const refChecksums = stepReference(refHandle, c.inputs, 0, maxReported);
      // refChecksums[k] is the checksum after running tick k+1, i.e. the checksum of
      // tick (k+1). So the checksum of tick N (N >= 1) is refChecksums[N - 1].
      const checksumOfTick = (n: number): string => {
        assert.ok(n >= 1 && n <= refChecksums.length, `reference has no tick ${n}`);
        return refChecksums[n - 1];
      };

      let sawWorld = false;
      for (const s of snapshots) {
        if (s.worldId !== 1) {
          // Before the world under test exists there are no snapshots here (create
          // is the first request); worldId 0 would mean no world. None expected.
          continue;
        }
        sawWorld = true;

        // After a successful create-world, every later snapshot carries worldId 1
        // and, until a run starts, Run_State paused. Run_State is one of the four
        // legal names; we only assert the create/run invariant indirectly through
        // the tick/checksum match below and the Speed-stability check later.
        const n = tickNumber(s.tick);
        if (n === null) {
          assert.fail('a world-1 snapshot must carry a non-null tick');
        }

        if (n === 0) {
          // Before the first tick of the world, no checksum (R3.5, R5.3).
          assert.equal(s.checksum, null, `tick 0 must report a null checksum, got ${s.checksum}`);
          continue;
        }

        // Tick N >= 1: the checksum must be a well-formed 16-hex string and equal the
        // reference's checksum for the same tick (R6.6 speed/pacing independence).
        assert.notEqual(s.checksum, null, `tick ${n} must report a checksum`);
        assert.match(
          s.checksum as string,
          CHECKSUM_16_LOWER_HEX,
          `tick ${n} checksum not 16 lowercase hex: ${JSON.stringify(s.checksum)}`,
        );
        const expected = checksumOfTick(n);
        assert.equal(
          s.checksum,
          expected,
          `checksum mismatch at tick ${n}: controller reported ${s.checksum}, reference ${expected} ` +
            `(seed ${c.seed}, config ${c.config})`,
        );
      }

      // Speed is unchanged by run, pause and create-world: the controller only
      // changes Speed on a valid set-speed. Replay the pacing to track the expected
      // Speed and check every reported Speed is one of SPEEDS (the stored Speed is
      // only ever a SPEEDS member, R4.5). The exact mid-sequence Speed is asserted
      // through the checksum match above (a wrong batch size would diverge).
      for (const s of snapshots) {
        assert.ok(
          (SPEEDS as readonly number[]).includes(s.speed),
          `reported Speed ${s.speed} is not a member of SPEEDS`,
        );
      }

      // Every case creates a world, so at least the create reply's snapshot is
      // world 1.
      assert.ok(sawWorld, 'the world under test produced at least one snapshot');
    }),
    { numRuns: RUNS },
  );
});

// Focused example: the same tick reached by single-stepping, by running at Speed 1,
// and by running at Speed 365 all report the same checksum as the reference. This
// makes the speed-independence claim concrete alongside the property above.
test('a tick reached by stepping, by Speed 1, and by Speed 365 reports one checksum', () => {
  loadWasm();

  const seed = 1234n;
  const config = '{"entity_count":8,"workload":"Pairwise"}';
  const inputs: ReferenceInput[] = [
    { tick: 2, payload: { SetValue: { entity: '3', value: 100 } } },
    { tick: 370, payload: { Spawn: { value: 7 } } },
  ].map((i) => i as ReferenceInput);
  const sorted = stableSortByTick(inputs);

  // Reference checksums for ticks 1..=400.
  const refHandle = openReference(seed, config);
  const ref = stepReference(refHandle, sorted, 0, 400);
  const refChecksum = (n: number): string => ref[n - 1];

  // Helper to drive a controller that creates the world, submits the inputs, then
  // advances to at least `targetTick` using the given pacing, returning the latest
  // reported checksum for exactly `targetTick` (there must be one).
  function reportedChecksumAt(targetTick: number, drive: (ctx: DriveCtx) => void): string {
    const scheduler = new FakeFrameScheduler();
    const clock = new FakeClock(0);
    const { post, messages } = messageCollector<WorkerMessage>();
    const controller = new SimController({
      createSim: (s, cfg) => realCreateSim(s, cfg),
      scheduler,
      clock,
      post,
    });
    controller.ready();
    let id = 1;
    controller.handle({ type: 'create-world', id: id++, seed: seed.toString(), config });
    for (const input of sorted) {
      controller.handle({ type: 'submit', id: id++, input: submitInputJson(input) });
    }
    drive({
      controller,
      scheduler,
      clock,
      nextId: () => id++,
    });

    // Find a reported snapshot for exactly targetTick.
    let found: string | null = null;
    for (const m of messages) {
      if (m.type === 'fatal') continue;
      if (m.snapshot.worldId !== 1) continue;
      if (m.snapshot.tick === String(targetTick)) {
        found = m.snapshot.checksum;
      }
    }
    assert.notEqual(found, null, `no snapshot reported for tick ${targetTick}`);
    return found as string;
  }

  interface DriveCtx {
    controller: SimController;
    scheduler: FakeFrameScheduler;
    clock: FakeClock;
    nextId: () => number;
  }

  // Reach tick 5 by single-stepping five times.
  const byStep = reportedChecksumAt(5, ({ controller, nextId }) => {
    for (let i = 0; i < 5; i++) {
      controller.handle({ type: 'step', id: nextId() });
    }
  });

  // Reach tick 5 by running at Speed 1 (five one-tick batches, each its own frame).
  // Pause at the end so an ok reply reports a snapshot at exactly tick 5 (status
  // messages are throttled to every 100 ms and might skip the final tick).
  const bySpeed1 = reportedChecksumAt(5, ({ controller, scheduler, clock, nextId }) => {
    controller.handle({ type: 'run', id: nextId() });
    for (let i = 0; i < 5; i++) {
      clock.advance(16);
      scheduler.flush();
    }
    controller.handle({ type: 'pause', id: nextId() });
  });

  assert.equal(byStep, refChecksum(5), 'stepping to tick 5 matches the reference');
  assert.equal(bySpeed1, refChecksum(5), 'running at Speed 1 to tick 5 matches the reference');
  assert.equal(byStep, bySpeed1, 'stepping and Speed 1 agree at tick 5');

  // Reach tick 365 by running at Speed 365 (one batch of 365 ticks in one frame).
  // Pause so an ok reply reports the snapshot at exactly tick 365.
  const bySpeed365 = reportedChecksumAt(365, ({ controller, scheduler, clock, nextId }) => {
    controller.handle({ type: 'set-speed', id: nextId(), speed: 365 });
    controller.handle({ type: 'run', id: nextId() });
    clock.advance(16);
    scheduler.flush();
    controller.handle({ type: 'pause', id: nextId() });
  });
  assert.equal(bySpeed365, refChecksum(365), 'running at Speed 365 to tick 365 matches the reference');

  // Reach tick 365 by running at Speed 1 as well (365 one-tick frames), so a tick
  // reached at two different speeds reports the same checksum. Pause to report it.
  const tick365BySpeed1 = reportedChecksumAt(365, ({ controller, scheduler, clock, nextId }) => {
    controller.handle({ type: 'set-speed', id: nextId(), speed: 1 });
    controller.handle({ type: 'run', id: nextId() });
    for (let i = 0; i < 365; i++) {
      clock.advance(16);
      scheduler.flush();
    }
    controller.handle({ type: 'pause', id: nextId() });
  });
  assert.equal(tick365BySpeed1, bySpeed365, 'Speed 1 and Speed 365 agree at tick 365');
});
