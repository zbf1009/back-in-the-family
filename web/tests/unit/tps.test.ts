// Feature: web-shell, Property 9: Ticks_Per_Second window
//
// Validates: Requirements 5.6 (and 2.12)
//
// Property 9 (design.md): For any run start time, sequence of batch samples with
// non-decreasing times and ticks, and query time `now`, `ticksPerSecond(now)` is
// `null` iff `now - runStart < 1000`, and otherwise equals the tick of the last
// sample minus the tick of the latest sample at or before `now - 1000` (the
// run-start sample if none is later).
//
// Usage contract (worker/tps.ts, controller run loop): the window is reset at
// run start, a sample is added after each batch, and `ticksPerSecond(now)` is
// read with the current clock. So `now` is always at or after the latest added
// sample, and successive queries never move backwards. The generators below
// respect that contract: every query time is >= the last sample's time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { TpsWindow } from '../../src/worker/tps.ts';

const RUNS = 1000;

/** A sample as the run loop would add it: a wall-clock time and a tick count. */
interface RefSample {
  readonly time: number;
  readonly tick: bigint;
}

/**
 * Independent reference for `ticksPerSecond`, computed over ALL samples (the
 * run-start sample plus every added sample), with no pruning. Because the window
 * under test prunes as it goes, a reference that keeps everything also checks
 * that pruning never changes an answer.
 *
 * `samples` must be in time order and non-empty (index 0 is the run start), and
 * `now` must be at or after the last sample's time (the usage contract), so the
 * latest sample at or before `now` is always the last sample.
 */
function referenceTps(samples: readonly RefSample[], now: number): number | null {
  const runStart = samples[0]!.time;
  if (now - runStart < 1000) {
    return null;
  }
  const cutoff = now - 1000;
  // The tick of the latest sample at or before the cutoff. Index 0 (the run
  // start) is at or before any `now - 1000 >= runStart`, so a match exists.
  let tickThen = samples[0]!.tick;
  for (const s of samples) {
    if (s.time <= cutoff) {
      tickThen = s.tick;
    } else {
      break;
    }
  }
  // `now >= last sample time`, so the latest sample at or before `now` is the
  // last one, matching the window's `tickNow`.
  const tickNow = samples[samples.length - 1]!.tick;
  return Number(tickNow - tickThen);
}

/**
 * Generate a monotonic run: a start time and start tick, then a list of
 * non-negative deltas that turn into non-decreasing (time, tick) samples. Zero
 * deltas exercise equal timestamps and stalled ticks.
 */
const runArb = fc
  .record({
    startTime: fc.integer({ min: 0, max: 1_000_000 }),
    startTick: fc.bigInt({ min: 0n, max: 10_000_000n }),
    deltas: fc.array(
      fc.record({
        dt: fc.integer({ min: 0, max: 400 }),
        dtick: fc.bigInt({ min: 0n, max: 5_000n }),
      }),
      { minLength: 0, maxLength: 40 },
    ),
  })
  .map(({ startTime, startTick, deltas }) => {
    const samples: RefSample[] = [{ time: startTime, tick: startTick }];
    let t = startTime;
    let tick = startTick;
    for (const { dt, dtick } of deltas) {
      t += dt;
      tick += dtick;
      samples.push({ time: t, tick });
    }
    return samples;
  });

// Property 9: for any monotonic run and any query at or after the last sample,
// the window's answer equals the independent reference, which pins both the
// null-before-1,000-ms rule and the `tickNow - tickAt(now - 1000)` value, and
// (because the reference keeps all samples while the window prunes) confirms
// pruning changes no answer. The query offset reaches past 1,000 ms so `now`
// falls on both sides of the boundary.
test('ticksPerSecond matches an independent reference over all samples', () => {
  fc.assert(
    fc.property(runArb, fc.integer({ min: 0, max: 20_000 }), (samples, nowOffset) => {
      const window = new TpsWindow();
      window.reset(samples[0]!.time, samples[0]!.tick);
      for (let i = 1; i < samples.length; i++) {
        window.addSample(samples[i]!.time, samples[i]!.tick);
      }
      // Query at or after the last sample time, as the run loop always does.
      const now = samples[samples.length - 1]!.time + nowOffset;
      const expected = referenceTps(samples, now);
      const actual = window.ticksPerSecond(now);
      assert.deepEqual(actual, expected);
    }),
    { numRuns: RUNS },
  );
});

// Property 9 (null rule, standalone): for any run, a query strictly less than
// 1,000 ms after the run start returns null, and a query at exactly the boundary
// returns a number. The query time is kept at or after the last sample.
test('ticksPerSecond is null strictly within 1,000 ms of the run start', () => {
  fc.assert(
    fc.property(runArb, fc.integer({ min: 0, max: 999 }), (samples, within) => {
      const window = new TpsWindow();
      window.reset(samples[0]!.time, samples[0]!.tick);
      for (let i = 1; i < samples.length; i++) {
        window.addSample(samples[i]!.time, samples[i]!.tick);
      }
      const runStart = samples[0]!.time;
      const lastTime = samples[samples.length - 1]!.time;
      // Strictly inside the first second and at or after the last sample: null.
      const nowInside = Math.max(runStart + within, lastTime);
      if (nowInside - runStart < 1000) {
        assert.equal(window.ticksPerSecond(nowInside), null);
      }
      // Exactly at 1,000 ms from the run start (and at or after the last
      // sample): a number, since the run-start sample is at or before the cutoff.
      const atBoundary = runStart + 1000;
      if (atBoundary >= lastTime) {
        assert.equal(typeof window.ticksPerSecond(atBoundary), 'number');
      }
    }),
    { numRuns: RUNS },
  );
});

// Example: a constant rate of 365 ticks per 16 ms frame. After at least 1,000 ms
// the window reports close to the true ticks per second (365 ticks / 16 ms ≈
// 22,812 ticks/s). The window counts the ticks in the most recent full second,
// so the reported value is within one frame's worth of ticks of the ideal.
test('ticksPerSecond is close to the true rate at a constant 365 ticks/16 ms', () => {
  const window = new TpsWindow();
  const frameMs = 16;
  const ticksPerFrame = 365n;
  const startTime = 100;
  window.reset(startTime, 0n);
  // Advance for 3 seconds of frames, querying at each frame's own time.
  let t = startTime;
  let tick = 0n;
  const samples: RefSample[] = [{ time: t, tick }];
  while (t - startTime < 3000) {
    t += frameMs;
    tick += ticksPerFrame;
    window.addSample(t, tick);
    samples.push({ time: t, tick });
  }
  const now = t;
  const value = window.ticksPerSecond(now);
  assert.notEqual(value, null);
  assert.ok(value !== null);

  // The window's answer must equal the independent reference exactly.
  assert.equal(value, referenceTps(samples, now));

  // And it must be close to the ideal: 365 ticks every 16 ms over one second.
  const ideal = Math.round((365 / 16) * 1000); // ≈ 22,812 ticks/s
  const oneFrameOfTicks = 365;
  assert.ok(
    Math.abs(value - ideal) <= oneFrameOfTicks,
    `expected ~${ideal} ticks/s, got ${value}`,
  );
});

// Example: pruning never changes a ticksPerSecond answer. Drive the pruning
// window and a pruning-free reference over the same long constant-rate stream,
// querying after each added sample (the run loop's monotonic query pattern). The
// window keeps only the samples around the last second while the reference keeps
// them all, yet every answer agrees. Querying 7 ms after each sample (still at or
// after it) moves `now - 1000` strictly between two sample times, exercising the
// "latest sample at or before the cutoff" selection on both sides.
test('pruning never changes a ticksPerSecond answer', () => {
  const window = new TpsWindow();
  const startTime = 0;
  window.reset(startTime, 0n);
  const all: RefSample[] = [{ time: startTime, tick: 0n }];

  const frameMs = 16;
  const ticksPerFrame = 365n;
  let t = startTime;
  let tick = 0n;
  // About 5 s of frames, enough that the window prunes many old samples while
  // the reference keeps them all.
  while (t - startTime < 5000) {
    t += frameMs;
    tick += ticksPerFrame;
    window.addSample(t, tick);
    all.push({ time: t, tick });
    // Query at the current sample time and 7 ms past it (both >= last sample).
    assert.equal(window.ticksPerSecond(t), referenceTps(all, t));
    assert.equal(window.ticksPerSecond(t + 7), referenceTps(all, t + 7));
  }
});
