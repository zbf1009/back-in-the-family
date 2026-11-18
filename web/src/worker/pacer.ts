import { PLAY_RATE, type Speed } from '../shared/speeds.ts';

/** Fifty milliseconds of ticks, rounded up so gaps up to 50 ms lose no tick. */
export function maxBatch(speed: Speed): number {
  return Math.ceil(speed * PLAY_RATE / 20);
}

/** Wall time controls only the integer tick budget, never simulation inputs. */
export function ticksDue(
  anchorMs: number,
  ranSinceAnchor: number,
  nowMs: number,
  speed: Speed,
): { run: number; reanchor: boolean } {
  const rate = speed * PLAY_RATE;
  const due = Math.floor((nowMs - anchorMs) * rate / 1000) - ranSinceAnchor;
  if (due > rate) {
    return { run: 0, reanchor: true };
  }
  return { run: Math.max(0, Math.min(due, maxBatch(speed))), reanchor: false };
}
