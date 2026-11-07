import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import fc from 'fast-check';
import {
  BUDGET_SCHEMA,
  BudgetSession,
  estimateNeurons,
  isRefusal,
  NEURON_CAP,
  usageNeurons,
  utcDay,
  type BudgetCaps,
  type Usage,
} from '../../src/budget.ts';

// Feature: llm-probe, Property 28: Budget accounting is exact
// **Validates: Requirements 11.5, 11.6, 11.11, 11.12, 11.13, 11.14**

const root = mkdtempSync(path.join(tmpdir(), 'probe-budget-prop-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => path.join(root, `p${n++}`, 'workers-ai.json');

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 10, 6, 0, 0, 0);

// ---------------------------------------------------------------- independent reference model
// Arbitrary-precision ceil without the (n + d - 1) / d trick the implementation uses.
const refCeil = (num: bigint, den: bigint): bigint => {
  const q = num / den;
  return num % den === 0n ? q : q + 1n;
};
const refEstimate = (bytes: number, maxOut: number, pin: number, pout: number): bigint =>
  refCeil((BigInt(bytes) + 256n) * BigInt(pin) + BigInt(maxOut) * BigInt(pout), 1_000_000n);
const refActual = (u: Usage, pin: number, pout: number): bigint => {
  const r = BigInt(u.reasoningTokens ?? 0);
  const c = BigInt(u.completionTokens);
  const out = r > c ? c + r : c;
  return refCeil(BigInt(u.promptTokens) * BigInt(pin) + out * BigInt(pout), 1_000_000n);
};

interface Cnt {
  requests: number;
  smoke: number;
  neurons: number;
}

interface Op {
  smoke: boolean;
  bytes: number;
  maxOut: number;
  pin: number;
  pout: number;
  outcome: 'usage' | 'error' | 'timeout';
  usage: Usage;
  daysForward: number;
}

const opArb: fc.Arbitrary<Op> = fc.record({
  smoke: fc.boolean(),
  bytes: fc.integer({ min: 0, max: 20_000 }),
  maxOut: fc.integer({ min: 0, max: 4_000 }),
  pin: fc.integer({ min: 0, max: 30_000 }),
  pout: fc.integer({ min: 0, max: 30_000 }),
  outcome: fc.constantFrom('usage', 'usage', 'error', 'timeout'),
  usage: fc.record({
    promptTokens: fc.integer({ min: 0, max: 30_000 }),
    completionTokens: fc.integer({ min: 0, max: 5_000 }),
    reasoningTokens: fc.option(fc.integer({ min: 0, max: 8_000 }), { nil: undefined }),
  }),
  daysForward: fc.constantFrom(0, 0, 0, 0, 0, 1, 2),
});

const capsArb: fc.Arbitrary<BudgetCaps> = fc.record({
  perRun: fc.integer({ min: 1, max: 60 }),
  daily: fc.integer({ min: 1, max: 60 }),
  smoke: fc.integer({ min: 0, max: 12 }),
  neurons: fc.constant(NEURON_CAP),
});

const startArb: fc.Arbitrary<Cnt> = fc.record({
  requests: fc.integer({ min: 0, max: 30 }),
  smoke: fc.integer({ min: 0, max: 8 }),
  neurons: fc.oneof(fc.integer({ min: 0, max: 9_000 }), fc.integer({ min: 8_500, max: 9_000 })),
});

const readDays = (file: string): { [d: string]: Cnt } => JSON.parse(readFileSync(file, 'utf8')).days;

test('Property 28: budget accounting is exact against an independent reference model', () => {
  fc.assert(
    fc.property(
      capsArb,
      startArb,
      fc.integer({ min: 0, max: 5 }),
      fc.array(opArb, { minLength: 1, maxLength: 60 }),
      (caps, start, runStart, ops) => {
        const file = fresh();
        mkdirSync(path.dirname(file), { recursive: true });
        // The starting counter is for the first day only; later days start empty.
        const model: { [d: string]: Cnt } = { [utcDay(START)]: { ...start } };
        writeFileSync(file, JSON.stringify({ schema: BUDGET_SCHEMA, days: model }));

        let clock = START;
        const session = BudgetSession.open({ file, now: () => clock, runCount: runStart, caps });
        let runCount = runStart;
        let lockedDay: string | null = null;

        for (const op of ops) {
          clock += op.daysForward * DAY_MS;
          const day = utcDay(clock);
          const cnt = model[day] ?? { requests: 0, smoke: 0, neurons: 0 };

          const est = refEstimate(op.bytes, op.maxOut, op.pin, op.pout);
          // The implementation's BigInt math agrees with the independent computation.
          assert.equal(BigInt(estimateNeurons({ promptBytes: op.bytes, maxOutputTokens: op.maxOut, inputPrice: op.pin, outputPrice: op.pout })), est);
          const estimate = Number(est);

          // Expected verdict from the reference model, in the design's order.
          let expectCap: string | null = null;
          let expectValue = 0;
          if (lockedDay === day) {
            expectCap = 'neuron';
            expectValue = caps.neurons;
          } else if (runCount >= caps.perRun) {
            expectCap = 'per-run';
            expectValue = caps.perRun;
          } else if (cnt.requests >= caps.daily) {
            expectCap = 'daily';
            expectValue = caps.daily;
          } else if (op.smoke && cnt.smoke >= caps.smoke) {
            expectCap = 'smoke';
            expectValue = caps.smoke;
          } else if (BigInt(cnt.neurons) + est > BigInt(caps.neurons)) {
            expectCap = 'neuron';
            expectValue = caps.neurons;
            lockedDay = day;
          }

          const before = readFileSync(file, 'utf8');
          const res = session.reserve({ smoke: op.smoke, estimate });

          if (expectCap !== null) {
            assert.ok(isRefusal(res), `expected a ${expectCap} refusal`);
            assert.equal(res.cap, expectCap);
            assert.equal(res.value, expectValue);
            assert.ok(res.message.includes(String(expectValue)), 'message names the cap value');
            assert.equal(readFileSync(file, 'utf8'), before, 'a refusal changes nothing');
            assert.deepEqual(session.counter(day), cnt);
            assert.equal(session.requestsThisRun, runCount);
            continue;
          }

          assert.ok(!isRefusal(res), 'expected a reservation');
          model[day] = cnt; // a day entry exists only once a request was reserved on it
          cnt.requests += 1;
          cnt.smoke += op.smoke ? 1 : 0;
          cnt.neurons += estimate;
          runCount += 1;
          assert.ok(cnt.neurons <= caps.neurons, 'never above the Neuron_Cap after an allowed request');

          // Crash-after-reserve: the file already holds the reservation before anything is sent.
          assert.deepEqual(readDays(file)[day], cnt);
          assert.equal(session.requestsThisRun, runCount);

          if (op.outcome === 'usage') {
            const actual = refActual(op.usage, op.pin, op.pout);
            assert.equal(BigInt(usageNeurons(op.usage, { inputPrice: op.pin, outputPrice: op.pout })), actual);
            cnt.neurons = cnt.neurons - estimate + Number(actual);
            const got = session.settle(res, op.usage, { inputPrice: op.pin, outputPrice: op.pout });
            assert.equal(got, cnt.neurons);
          } else {
            const same = readFileSync(file, 'utf8');
            session.settle(res, null, { inputPrice: op.pin, outputPrice: op.pout });
            assert.equal(readFileSync(file, 'utf8'), same, 'no usage keeps the estimate');
          }
          assert.deepEqual(readDays(file)[day], cnt);
        }

        // Final persisted counts per UTC day equal the model, and a fresh session sees them.
        assert.deepEqual(readDays(file), model);
        const again = BudgetSession.open({ file, now: () => clock, caps });
        for (const [d, c] of Object.entries(model)) assert.deepEqual(again.counter(d), c);
      },
    ),
    { numRuns: 100 },
  );
});

test('Property 28: exactly the Neuron_Cap is allowed, one above is refused and locks the day', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 9_000 }), fc.integer({ min: 1, max: 50 }), (head, extra) => {
      const file = fresh();
      mkdirSync(path.dirname(file), { recursive: true });
      const day = utcDay(START);
      writeFileSync(file, JSON.stringify({ schema: BUDGET_SCHEMA, days: { [day]: { requests: 0, smoke: 0, neurons: head } } }));
      const s = BudgetSession.open({ file, now: () => START });
      const exact = s.reserve({ smoke: false, estimate: 9_000 - head });
      assert.ok(!isRefusal(exact));
      assert.equal(s.counter(day).neurons, 9_000);
      const over = s.reserve({ smoke: false, estimate: extra });
      assert.ok(isRefusal(over) && over.cap === 'neuron' && over.value === 9_000);
      assert.equal(readDays(file)[day]!.neurons, 9_000);
    }),
    { numRuns: 50 },
  );
});
