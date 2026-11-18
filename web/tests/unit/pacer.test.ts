// Feature: first-playable, Property 21: Clock pacing tracks Speed × Play_Rate
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { maxBatch, ticksDue } from '../../src/worker/pacer.ts';
import { PLAY_RATE, SPEEDS } from '../../src/shared/speeds.ts';
import { PacingReference } from './helpers/reference.ts';

const RUNS = 1000;
const speedArb = fc.constantFrom(...SPEEDS);

test('Property 21: every frame budget is integer, nonnegative, capped and re-anchors exactly above one second due', () => {
  fc.assert(fc.property(
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.integer({ min: 0, max: 100_000 }),
    fc.integer({ min: -10_000, max: 10_000 }), speedArb,
    (anchor, ran, elapsed, speed) => {
      const result = ticksDue(anchor, ran, anchor + elapsed, speed);
      const target = Math.floor(elapsed * speed * PLAY_RATE / 1000);
      assert.equal(result.reanchor, target > ran + speed * PLAY_RATE);
      assert.ok(Number.isInteger(result.run));
      assert.ok(result.run >= 0);
      assert.ok(result.run <= Math.ceil(speed * PLAY_RATE / 20));
      if (result.reanchor) assert.equal(result.run, 0);
      if (target <= ran) assert.equal(result.run, 0);
    }), { numRuns: RUNS });
});

test('Property 21: between re-anchors total ticks follow the independent per-frame total recurrence', () => {
  // "Total allowed by batch caps" means total_(k-1) + cap for this frame,
  // not the sum of every earlier cap: an idle frame cannot bank unused ticks.
  // The reference uses total_k = min(target_k, total_(k-1)+cap), independently
  // of ticksDue's incremental due calculation. Frame times are non-decreasing.
  fc.assert(fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), speedArb,
    fc.array(fc.integer({ min: 0, max: 1500 }), { minLength: 1, maxLength: 100 }),
    (origin, speed, elapsed) => {
      let now = origin;
      let anchor = origin;
      let total = 0;
      const reference = new PacingReference();
      reference.reset(origin);
      for (const ms of elapsed) {
        now += ms;
        const wasAnchor = reference.anchor;
        const expected = reference.frame(now, speed);
        const result = ticksDue(anchor, total, now, speed);
        assert.equal(result.reanchor, reference.anchor !== wasAnchor);
        assert.equal(result.run, expected);
        if (result.reanchor) { anchor = now; total = 0; }
        else total += result.run;
        assert.equal(total, reference.total);
        assert.equal(anchor, reference.anchor);
      }
    }), { numRuns: RUNS });
});

test('Property 21: backwards frame times and now before anchor never produce negative tick counts', () => {
  fc.assert(fc.property(speedArb, fc.integer({ min: 1, max: 10000 }), (speed, backwards) => {
    const anchor = 10000;
    assert.equal(ticksDue(anchor, 0, anchor - backwards, speed).run, 0);
    const ran = Math.floor(speed * PLAY_RATE / 2);
    assert.equal(ticksDue(anchor, ran, anchor + 500 - backwards, speed).run, 0);
  }), { numRuns: RUNS });
});

test('pacing has a strict one-second backlog boundary and re-anchors without a catch-up tick', () => {
  for (const speed of SPEEDS) {
    const rate = speed * PLAY_RATE;
    const exact = ticksDue(0, 0, 1000, speed);
    assert.equal(exact.reanchor, false);
    assert.equal(exact.run, Math.ceil(rate / 20));
    const behind = ticksDue(0, 0, 1000 + Math.ceil(1000 / rate), speed);
    assert.deepEqual(behind, { run: 0, reanchor: true });
    // It is the backlog, not elapsed time alone, that triggers re-anchoring.
    assert.equal(ticksDue(0, rate, 2000, speed).reanchor, false);
    assert.equal(ticksDue(0, rate, 2000 + Math.ceil(1000 / rate), speed).reanchor, true);
  }
});

test('literal upward-rounded batch caps and unused frame capacity are exact', () => {
  for (const [speed, cap] of [[1, 2], [7, 11], [30, 45], [90, 135], [365, 548]] as const) {
    assert.equal(maxBatch(speed), cap);
    assert.equal(ticksDue(0, 0, 500, speed).run, cap);
  }
  assert.equal(ticksDue(0, 0, 16, 1).run, 0);
  assert.equal(ticksDue(0, 0, 100, 1).run, 2);
});

test('R8.1: equal wall time at different display frame intervals yields exactly Speed × Play_Rate ticks', () => {
  const duration = 3200;
  for (const speed of SPEEDS) for (const interval of [4, 8, 16, 32]) {
    let total = 0;
    for (let now = interval; now <= duration; now += interval) {
      const budget = ticksDue(0, total, now, speed);
      assert.equal(budget.reanchor, false);
      total += budget.run;
    }
    assert.equal(total, Math.floor(duration * speed * PLAY_RATE / 1000), `speed ${speed}, interval ${interval}`);
  }
});

// Feature: first-playable, Property 21: Clock pacing tracks Speed × Play_Rate
test('Property 21: frame gaps from 0 to 50 ms keep every total equal to target without re-anchoring', () => {
  fc.assert(fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), speedArb,
    fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 100 }),
    (anchor, speed, gaps) => {
      let now = anchor;
      let total = 0;
      for (const gap of gaps) {
        now += gap;
        const budget = ticksDue(anchor, total, now, speed);
        assert.equal(budget.reanchor, false);
        total += budget.run;
        assert.equal(total, Math.floor((now - anchor) * speed * PLAY_RATE / 1000));
      }
    }), { numRuns: RUNS });
});
