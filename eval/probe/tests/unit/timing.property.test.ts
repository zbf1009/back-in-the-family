import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { createFakeClock, createFakeEngine, type InterruptBehaviour } from '../../src/adapters/fake.ts';
import type { AdapterResult, Prompt, RequestOptions } from '../../src/adapters/interface.ts';
import { createTimedRunner, IDLE_CAP_MS, LATE_WINDOW_MS, type TimedEngine } from '../../src/adapters/timing.ts';

// Feature: llm-probe, Property 29: Timeouts are prompt and final; late answers follow the caps
// **Validates: Requirements 8.1, 8.2, 8.12, 8.13, 9.12, 12.10**
//
// Not covered here (9.12/9.13 warm-up prompts write no Results records): the timed runner has no
// warm-up or Results layer; `reset()` only clears the stuck flag and emits nothing. That clause is
// checked with the runner in task 12.6.

const prompt: Prompt = { system: 's', user: 'u' };
const SECRET = 'SECRET-late-text';

function opts(T: number, maxOutputTokens: number): RequestOptions {
  return {
    timeoutMs: T,
    sampling: { temperature: 0, topP: null, maxOutputTokens, seed: null, chatTemplateKwargs: null, constraint: { kind: 'none' } },
  };
}

interface Scenario {
  T: number;
  startMs: number;
  maxTokens: number;
  /** Engine generation duration, computed the way the fake computes it. */
  C: number;
  script: { completionMs?: number; tokensPerSecond?: number };
  outputTokens: number;
  interrupt: InterruptBehaviour;
}

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    T: fc.integer({ min: 1, max: 120_000 }),
    startMs: fc.constantFrom(0, 0.5, 1000.25, 123_456.75),
    maxTokens: fc.integer({ min: 1, max: 4096 }),
    pick: fc.integer({ min: 0, max: 6 }),
    frac: fc.double({ min: 0, max: 1, noNaN: true }),
    tokens: fc.integer({ min: 1, max: 3000 }),
    tps: fc.integer({ min: 1, max: 5000 }),
    honour: fc.boolean(),
    // Straddle the Idle_Cap: idle delay after interrupt up to 60 s, avoiding the exact 30 s tie.
    idleDelay: fc.oneof(fc.integer({ min: 0, max: 29_999 }), fc.integer({ min: 30_001, max: 60_000 })),
  })
  .map((r): Scenario => {
    const { T } = r;
    const q = (lo: number, hi: number): number => Math.max(1, Math.round((lo + (hi - lo) * r.frac) * 4) / 4);
    let C: number;
    let script: Scenario['script'];
    let outputTokens = r.tokens;
    if (r.pick === 6) {
      // tokens-per-second path
      C = Math.ceil((r.tokens * 1000) / r.tps);
      script = { tokensPerSecond: r.tps };
    } else {
      const ranges: [number, number][] = [
        [0.25, T], // before T
        [T, T], // at T
        [T + 0.25, T + LATE_WINDOW_MS], // late window
        [T + LATE_WINDOW_MS, T + LATE_WINDOW_MS], // at the Generation_Cap
        [T + LATE_WINDOW_MS + 0.25, T + 200_000], // after the cap
        [1e9, 1e9], // never
      ];
      const [lo, hi] = ranges[r.pick]!;
      C = q(lo, hi);
      script = { completionMs: C };
      outputTokens = Math.max(1, Math.min(r.tokens, r.maxTokens));
    }
    const interrupt: InterruptBehaviour = r.honour ? { kind: 'honour', idleDelayMs: r.idleDelay } : { kind: 'ignore' };
    return { T, startMs: r.startMs, maxTokens: r.maxTokens, C, script, outputTokens, interrupt };
  });

test('Property 29: timeouts are prompt and final; late answers follow the caps', async () => {
  await fc.assert(
    fc.asyncProperty(scenario, async (s) => {
      const { T, C } = s;
      const clock = createFakeClock(s.startMs);
      const fake = createFakeEngine(clock, {
        generate: { ...s.script, text: SECRET, outputTokens: s.outputTokens, interrupt: s.interrupt },
      });
      await fake.create();
      // (e) record the real engine state each time the runner sends a request.
      const stateAtSend: string[] = [];
      const engine: TimedEngine = {
        generate(p, sampling) {
          stateAtSend.push(fake.state());
          return fake.generate(p, sampling);
        },
        interrupt: () => fake.interrupt(),
      };
      const runner = createTimedRunner(engine, clock);
      const options = opts(T, s.maxTokens);
      const t0 = clock.now();

      let first: AdapterResult | null = null;
      const p1 = runner.complete(prompt, options).then((r) => {
        first = r;
      });
      const get = (): AdapterResult | null => first;
      await clock.advance(0); // let the runner reach the engine and arm its timers at t0

      if (C <= T) {
        // (f) latency = ceil of the clock difference; text arrives at completion.
        await clock.advance(C - 0.25 >= 0 ? C - 0.25 : 0);
        if (C >= 0.25) assert.equal(get(), null);
        await clock.advance(C - (clock.now() - t0));
        await p1;
        const r = get()!;
        assert.equal(r.kind, 'text');
        if (r.kind === 'text') {
          assert.equal(r.text, SECRET);
          assert.equal(r.latencyMs, Math.ceil(clock.now() - t0));
          assert.equal(r.latencyMs, Math.ceil(C));
        }
        assert.equal(runner.state(), 'idle');
        assert.deepEqual(stateAtSend, ['idle']);
        return;
      }

      // (a) not yet at T - 0.25: nothing returned; exactly at T: Timeout, no text.
      await clock.advance(T - 0.25);
      assert.equal(get(), null);
      await clock.advance(0.25);
      await p1;
      const r1 = get()!;
      assert.equal(r1.kind, 'timeout');
      if (r1.kind !== 'timeout') return;
      assert.equal(clock.now() - t0, T);
      assert.ok(r1.elapsedMs >= T && r1.elapsedMs <= T + 500);
      assert.equal(r1.timeoutMs, T);
      assert.ok(!JSON.stringify({ ...r1, late: null }).includes(SECRET));

      // A second request issued while the first is still in the engine.
      let second: AdapterResult | null = null;
      const p2 = runner.complete(prompt, options).then((r) => {
        second = r;
      });
      await clock.advance(0);

      const lateWindowOk = C <= T + LATE_WINDOW_MS;
      const idleDelay = s.interrupt.kind === 'honour' ? s.interrupt.idleDelayMs : Infinity;
      const stuckExpected = !lateWindowOk && idleDelay > IDLE_CAP_MS - LATE_WINDOW_MS;

      await clock.advance(LATE_WINDOW_MS + IDLE_CAP_MS + 200_000);
      const late = await r1.late;
      if (lateWindowOk) {
        // (b) Late_Answer carries the text, latency from request start.
        assert.equal(late.kind, 'late');
        if (late.kind === 'late') {
          assert.equal(late.text, SECRET);
          assert.equal(late.latencyMs, Math.ceil(C));
        }
        assert.equal(runner.state() === 'stuck', false);
      } else if (stuckExpected) {
        // (d) not idle by T + 90 s.
        assert.deepEqual(late, { kind: 'none', reason: 'idle_cap' });
        assert.equal(runner.state(), 'stuck');
      } else {
        // (c) capped generation, interrupted at T + 60 s.
        assert.deepEqual(late, { kind: 'none', reason: 'generation_cap' });
        assert.equal(runner.state() === 'stuck', false);
      }
      if (late.kind !== 'late') assert.ok(!JSON.stringify(late).includes(SECRET));

      await p2;
      // (e) never sent while the engine was busy.
      assert.ok(stateAtSend.every((st) => st === 'idle'), `sent while engine ${stateAtSend.join(',')}`);
      if (stuckExpected) {
        // (d) later requests are refused and never reach the engine, until reset().
        assert.equal(stateAtSend.length, 1);
        const r2 = second as AdapterResult | null;
        assert.equal(r2?.kind, 'error');
        if (r2?.kind === 'error') assert.equal(r2.code, 'runtime_stuck');
        const r3 = await runner.complete(prompt, options);
        assert.equal(r3.kind, 'error');
        if (r3.kind === 'error') assert.equal(r3.code, 'runtime_stuck');
        assert.equal(stateAtSend.length, 1);
        runner.reset();
        assert.equal(runner.state(), 'idle');
      } else {
        // The second request started exactly when the first left the engine.
        assert.equal(stateAtSend.length, 2);
        const firstLeft = lateWindowOk ? t0 + C : t0 + T + LATE_WINDOW_MS + idleDelay;
        assert.equal(fake.calls[1]!.startedAtMs, firstLeft);
      }
    }),
    { numRuns: 300 },
  );
});
