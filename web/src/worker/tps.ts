// Ticks_Per_Second window (R2.12, R5.6).
//
// The Sim_Worker reports how many ticks it completed during the most recent
// 1,000 ms of wall-clock time while running. This module keeps the samples the
// worker needs to answer that question and nothing else. It reads no clock of
// its own: every `now` is passed in by the caller (the run loop), so the window
// is pure and testable, and no wall-clock value ever reaches the simulation
// (R6.5).
//
// A sample is a pair (time, tick): the wall-clock time in milliseconds and the
// completed tick count at that time. The run start is recorded as the first
// sample, and one sample is added after each batch. Ticks are counted as
// `bigint` so a tick count above 2^53 is exact; the returned ticks-per-second
// value is bounded by the batch rate and stays far below 2^53, so it is
// converted to a `number` for display.

interface Sample {
  /** Wall-clock time in milliseconds, as read from the worker's clock. */
  readonly time: number;
  /** Completed tick count at that time. */
  readonly tick: bigint;
}

/**
 * A sliding window over the ticks completed in the last 1,000 ms.
 *
 * Usage: call `reset(startTime, startTick)` when the run starts, then
 * `addSample(time, tick)` after each batch, then `ticksPerSecond(now)` to read
 * the current rate. The window keeps only the samples needed to answer
 * `ticksPerSecond`: the latest sample at or before `now - 1000` and every
 * sample after it.
 */
export class TpsWindow {
  /** Samples in time order (oldest first), as added by the run loop. */
  #samples: Sample[] = [];
  /** The time of the first sample of the current run, or null before `reset`. */
  #runStart: number | null = null;

  /**
   * Begin a new run. Records the run start time and the first sample
   * (startTime, startTick), and drops every sample from any previous run.
   */
  reset(startTime: number, startTick: bigint): void {
    this.#runStart = startTime;
    this.#samples = [{ time: startTime, tick: startTick }];
  }

  /**
   * Record a sample taken after a batch. Then drop samples older than the one
   * just before `time - 1000`, so the window never grows without bound while a
   * run continues. Must be called with non-decreasing `time` and `tick` (the
   * run loop only moves forward).
   */
  addSample(time: number, tick: bigint): void {
    this.#samples.push({ time, tick });
    this.#prune(time);
  }

  /**
   * The number of ticks completed in the most recent 1,000 ms, or null when the
   * run has been going for less than 1,000 ms (R5.6). The value is
   * `tickNow - tickAt(now - 1000)`, where `tickNow` is the latest sample's tick
   * and `tickAt(t)` is the tick of the latest sample at or before `t`.
   */
  ticksPerSecond(now: number): number | null {
    if (this.#runStart === null || now - this.#runStart < 1000) {
      return null;
    }
    const tickNow = this.#samples[this.#samples.length - 1]!.tick;
    const tickThen = this.#tickAt(now - 1000);
    return Number(tickNow - tickThen);
  }

  /** The tick of the latest sample whose time is at or before `t`. */
  #tickAt(t: number): bigint {
    // Samples are in time order; take the last one at or before `t`. The first
    // sample (the run start) is always at or before any `t >= runStart`, and
    // `ticksPerSecond` only calls this with `t = now - 1000 >= runStart`, so a
    // match always exists.
    let tick = this.#samples[0]!.tick;
    for (const s of this.#samples) {
      if (s.time <= t) {
        tick = s.tick;
      } else {
        break;
      }
    }
    return tick;
  }

  /**
   * Drop samples older than the one just before `now - 1000`: keep the latest
   * sample at or before `now - 1000` and every sample after it. This preserves
   * the exact answer of `tickAt(now - 1000)` while bounding the stored samples.
   */
  #prune(now: number): void {
    const cutoff = now - 1000;
    // Index of the latest sample at or before the cutoff. Everything before it
    // is strictly older than the sample `tickAt(cutoff)` reads, so it can go.
    let keepFrom = 0;
    for (let i = 0; i < this.#samples.length; i++) {
      if (this.#samples[i]!.time <= cutoff) {
        keepFrom = i;
      } else {
        break;
      }
    }
    if (keepFrom > 0) {
      this.#samples = this.#samples.slice(keepFrom);
    }
  }
}
