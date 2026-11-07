import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  BudgetError,
  BudgetSession,
  BUDGET_SCHEMA,
  billedOutputTokens,
  estimateNeurons,
  isRefusal,
  parseBudget,
  usageNeurons,
  utcDay,
  type Refusal,
  type Reservation,
} from '../../src/budget.ts';

const root = mkdtempSync(path.join(tmpdir(), 'probe-budget-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => path.join(root, `b${n++}`, 'workers-ai.json');
const T = Date.UTC(2026, 10, 6, 12, 0, 0);
const DAY = '2026-11-06';
const PRICES = { inputPrice: 1_542, outputPrice: 10_158 };

function seed(file: string, day: { requests: number; smoke: number; neurons: number }): void {
  writeFileSync(file, JSON.stringify({ schema: BUDGET_SCHEMA, days: { [DAY]: day } }));
}
function setup(day: { requests: number; smoke: number; neurons: number }, runCount = 0): { file: string; s: BudgetSession } {
  const file = fresh();
  mkdirSync(path.dirname(file), { recursive: true });
  seed(file, day);
  return { file, s: BudgetSession.open({ file, now: () => T, runCount }) };
}
const asRefusal = (x: Reservation | Refusal): Refusal => {
  assert.ok(isRefusal(x), 'expected a refusal');
  return x;
};
const asReservation = (x: Reservation | Refusal): Reservation => {
  assert.ok(!isRefusal(x), 'expected a reservation');
  return x;
};
const counter = (file: string) => JSON.parse(readFileSync(file, 'utf8')).days[DAY];

test('utcDay uses the UTC calendar day of the injected clock', () => {
  assert.equal(utcDay(Date.UTC(2026, 10, 6, 23, 59, 59, 999)), '2026-11-06');
  assert.equal(utcDay(Date.UTC(2026, 10, 7, 0, 0, 0, 0)), '2026-11-07');
});

test('estimateNeurons: ceil(((bytes + 256) × in + max_out × out) / 1e6) with BigInt', () => {
  // (1256 × 1542 + 64 × 10158) = 2,586,864 -> 3
  assert.equal(estimateNeurons({ promptBytes: 1000, maxOutputTokens: 64, ...PRICES }), 3);
  assert.equal(estimateNeurons({ promptBytes: 0, maxOutputTokens: 0, inputPrice: 0, outputPrice: 0 }), 0);
  // exact multiple does not round up: 256 × 1,000,000 / 1e6 = 256
  assert.equal(estimateNeurons({ promptBytes: 0, maxOutputTokens: 0, inputPrice: 1_000_000, outputPrice: 0 }), 256);
  // beyond 2^53 intermediates stay exact
  assert.equal(estimateNeurons({ promptBytes: 4, maxOutputTokens: 1, inputPrice: 1, outputPrice: 1_000_000 }), 2);
});

test('usageNeurons adds reasoning tokens only when larger than completion_tokens', () => {
  assert.equal(billedOutputTokens({ promptTokens: 1, completionTokens: 100, reasoningTokens: 40 }), 100);
  assert.equal(billedOutputTokens({ promptTokens: 1, completionTokens: 100, reasoningTokens: 100 }), 100);
  assert.equal(billedOutputTokens({ promptTokens: 1, completionTokens: 100, reasoningTokens: 101 }), 201);
  assert.equal(billedOutputTokens({ promptTokens: 1, completionTokens: 100 }), 100);
  // 1000 × 1542 + 201 × 10158 = 3,583,758 -> 4
  assert.equal(usageNeurons({ promptTokens: 1000, completionTokens: 100, reasoningTokens: 101 }, PRICES), 4);
});

test('a counter file with a missing neurons field is refused and left byte-identical', () => {
  const file = fresh();
  mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify({ schema: BUDGET_SCHEMA, days: { [DAY]: { requests: 3, smoke: 1 } } });
  writeFileSync(file, bytes);
  assert.throws(() => BudgetSession.open({ file, now: () => T }), BudgetError);
  assert.equal(readFileSync(file, 'utf8'), bytes);
  assert.deepEqual(readdirSync(path.dirname(file)), ['workers-ai.json']);
});

test('unparsable, wrong-schema and non-integer counters are refused and untouched', () => {
  const bad = [
    '{not json',
    '[]',
    JSON.stringify({ days: {} }),
    JSON.stringify({ schema: 'other', days: {} }),
    JSON.stringify({ schema: BUDGET_SCHEMA }),
    JSON.stringify({ schema: BUDGET_SCHEMA, days: { [DAY]: { requests: 1, smoke: 0, neurons: 1.5 } } }),
    JSON.stringify({ schema: BUDGET_SCHEMA, days: { [DAY]: { requests: 1, smoke: 0, neurons: '5' } } }),
    JSON.stringify({ schema: BUDGET_SCHEMA, days: { [DAY]: { requests: 1, smoke: 0, neurons: -1 } } }),
    JSON.stringify({ schema: BUDGET_SCHEMA, days: { 'yesterday': { requests: 1, smoke: 0, neurons: 1 } } }),
  ];
  for (const text of bad) {
    const file = fresh();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    assert.throws(() => BudgetSession.open({ file, now: () => T }), BudgetError, text);
    assert.equal(readFileSync(file, 'utf8'), text);
  }
  assert.throws(() => parseBudget(''), BudgetError);
});

test('a missing counter file is an empty counter and creates nothing until a reservation', () => {
  const file = fresh();
  const s = BudgetSession.open({ file, now: () => T });
  assert.equal(existsSync(file), false);
  asReservation(s.reserve({ smoke: false, estimate: 5 }));
  assert.deepEqual(counter(file), { requests: 1, smoke: 0, neurons: 5 });
});

test('the reservation is persisted before reserve returns: requests+1, smoke+1, neurons+estimate in one write', () => {
  const { file, s } = setup({ requests: 12, smoke: 4, neurons: 318 });
  asReservation(s.reserve({ smoke: true, estimate: 20 }));
  assert.deepEqual(counter(file), { requests: 13, smoke: 5, neurons: 338 });
  asReservation(s.reserve({ smoke: false, estimate: 7 }));
  assert.deepEqual(counter(file), { requests: 14, smoke: 5, neurons: 345 });
  assert.deepEqual(readdirSync(path.dirname(file)), ['workers-ai.json']); // no temp file left
  assert.equal(readFileSync(file, 'utf8').endsWith('\n'), true);
});

test('per-run cap 410: the 410th request is allowed, the 411th refused naming the cap and value, nothing counted', () => {
  const { file, s } = setup({ requests: 0, smoke: 0, neurons: 0 }, 409);
  asReservation(s.reserve({ smoke: false, estimate: 1 }));
  const before = readFileSync(file, 'utf8');
  const r = asRefusal(s.reserve({ smoke: false, estimate: 1 }));
  assert.equal(r.cap, 'per-run');
  assert.equal(r.value, 410);
  assert.match(r.message, /per-run/);
  assert.match(r.message, /410/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(s.requestsThisRun, 410);
});

test('daily cap 600 counts across runs: the 600th is allowed, the 601st refused', () => {
  const { file, s } = setup({ requests: 599, smoke: 0, neurons: 0 });
  asReservation(s.reserve({ smoke: false, estimate: 1 }));
  const r = asRefusal(s.reserve({ smoke: false, estimate: 1 }));
  assert.equal(r.cap, 'daily');
  assert.equal(r.value, 600);
  assert.match(r.message, /daily/);
  assert.match(r.message, /600/);
  assert.equal(counter(file).requests, 600);
});

test('smoke cap 10 per UTC day: the 10th Smoke_Call is allowed, the 11th refused, normal requests still allowed', () => {
  const { file, s } = setup({ requests: 9, smoke: 9, neurons: 0 });
  asReservation(s.reserve({ smoke: true, estimate: 1 }));
  const r = asRefusal(s.reserve({ smoke: true, estimate: 1 }));
  assert.equal(r.cap, 'smoke');
  assert.equal(r.value, 10);
  assert.match(r.message, /smoke/);
  assert.match(r.message, /10/);
  asReservation(s.reserve({ smoke: false, estimate: 1 }));
  assert.deepEqual(counter(file), { requests: 11, smoke: 10, neurons: 2 });
});

test('Neuron_Cap boundary: exactly 9,000 is allowed; 9,001 is refused and so is every later request that day', () => {
  const ok = setup({ requests: 0, smoke: 0, neurons: 8_990 });
  asReservation(ok.s.reserve({ smoke: false, estimate: 10 }));
  assert.equal(counter(ok.file).neurons, 9_000);
  const r0 = asRefusal(ok.s.reserve({ smoke: false, estimate: 1 }));
  assert.equal(r0.cap, 'neuron');

  const { file, s } = setup({ requests: 0, smoke: 0, neurons: 8_991 });
  const r = asRefusal(s.reserve({ smoke: false, estimate: 10 }));
  assert.equal(r.cap, 'neuron');
  assert.equal(r.value, 9_000);
  assert.match(r.message, /Neuron_Cap/);
  assert.match(r.message, /9000/);
  // a later, much smaller request that would fit is still refused that UTC day
  const later = asRefusal(s.reserve({ smoke: false, estimate: 1 }));
  assert.equal(later.cap, 'neuron');
  const smoke = asRefusal(s.reserve({ smoke: true, estimate: 0 }));
  assert.equal(smoke.cap, 'neuron');
  assert.deepEqual(counter(file), { requests: 0, smoke: 0, neurons: 8_991 });
});

test('after a Neuron_Cap refusal, a new UTC day starts fresh', () => {
  const file = fresh();
  mkdirSync(path.dirname(file), { recursive: true });
  seed(file, { requests: 0, smoke: 0, neurons: 8_999 });
  let now = T;
  const s = BudgetSession.open({ file, now: () => now });
  asRefusal(s.reserve({ smoke: false, estimate: 5 }));
  now = Date.UTC(2026, 10, 7, 0, 0, 1);
  asReservation(s.reserve({ smoke: false, estimate: 5 }));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).days['2026-11-07'], { requests: 1, smoke: 0, neurons: 5 });
});

test('settle replaces the estimate with the usage-based cost; reasoning > completion is added', () => {
  const { file, s } = setup({ requests: 0, smoke: 0, neurons: 100 });
  const r = asReservation(s.reserve({ smoke: false, estimate: 50 }));
  assert.equal(counter(file).neurons, 150);
  // 1000 × 1542 + 201 × 10158 = 3,583,758 -> 4 (reasoning 101 > completion 100)
  const after = s.settle(r, { promptTokens: 1000, completionTokens: 100, reasoningTokens: 101 }, PRICES);
  assert.equal(after, 104);
  assert.deepEqual(counter(file), { requests: 1, smoke: 0, neurons: 104 });

  const r2 = asReservation(s.reserve({ smoke: false, estimate: 50 }));
  // reasoning 40 <= completion 100: 1000 × 1542 + 100 × 10158 = 2,557,800 -> 3
  s.settle(r2, { promptTokens: 1000, completionTokens: 100, reasoningTokens: 40 }, PRICES);
  assert.equal(counter(file).neurons, 107);
});

test('settle may record an actual cost above the estimate', () => {
  const { file, s } = setup({ requests: 0, smoke: 0, neurons: 0 });
  const r = asReservation(s.reserve({ smoke: false, estimate: 1 }));
  s.settle(r, { promptTokens: 1_000_000, completionTokens: 0 }, { inputPrice: 5, outputPrice: 0 });
  assert.equal(counter(file).neurons, 5);
});

test('without usage (timeout, HTTP error, rate limit) the estimate stays and the request still counts', () => {
  const { file, s } = setup({ requests: 0, smoke: 0, neurons: 0 });
  const r = asReservation(s.reserve({ smoke: false, estimate: 42 }));
  const before = readFileSync(file, 'utf8');
  s.settle(r, null, PRICES);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.deepEqual(counter(file), { requests: 1, smoke: 0, neurons: 42 });
});

test('a fresh session over the same file sees the persisted counts (cap holds across runs)', () => {
  const { file, s } = setup({ requests: 0, smoke: 0, neurons: 8_000 });
  asReservation(s.reserve({ smoke: false, estimate: 900 }));
  const s2 = BudgetSession.open({ file, now: () => T });
  asReservation(s2.reserve({ smoke: false, estimate: 100 }));
  assert.equal(counter(file).neurons, 9_000);
  asRefusal(s2.reserve({ smoke: false, estimate: 1 }));
});
