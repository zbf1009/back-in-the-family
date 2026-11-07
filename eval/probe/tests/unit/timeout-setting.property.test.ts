// Feature: llm-probe, Property 30: Only positive whole Timeouts start a run
// **Validates: Requirements 8.3, 8.4**
//
// parseTimeoutMs accepts exactly the positive safe integers (as numbers or digit strings), defaults to
// 10,000 when absent, and refuses everything else. Through devRun/lockedRun with the fake Runtime on a
// SYNTHETIC card set: an invalid Timeout starts nothing; a valid one is recorded in the header and with
// every record. Nothing here touches the real eval/results or locked.jsonl.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import fc from 'fast-check';
import { readLedger } from '../../src/ledger.ts';
import { readResultsFile } from '../../src/results.ts';
import { DEFAULT_TIMEOUT_MS, devRun, lockedRun, parseTimeoutMs, RunError } from '../../src/run.ts';
import { capture, createFakeRuntime, FAKE_COMBO, makeCardSet, makeEnv, type TestEnv } from './run.helpers.ts';

const refused = (e: unknown): boolean => e instanceof RunError && e.code === 'invalid_timeout';

// ------------------------------------------------------------------ parseTimeoutMs

const validArb: fc.Arbitrary<number> = fc.oneof(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }));

const invalidNumberArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: 0 }),
  fc.double({ noInteger: true, noNaN: true, min: -1e6, max: 1e6 }),
  fc.integer({ min: 1, max: 1000 }).map((n) => Number.MAX_SAFE_INTEGER + n * 2), // unsafe integers
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, Number.MAX_VALUE),
);

const invalidStringArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('', ' ', '0', '00', '-1', '+5', ' 7', '7 ', '1.5', '1.0', '1e4', '1E4', '0x10', 'NaN', 'Infinity', '-Infinity', '١٢٣', '1_000'),
  fc.integer({ min: 1, max: 1000 }).map((n) => `-${n}`),
  fc.integer({ min: 1, max: 1000 }).map((n) => `+${n}`),
  fc.integer({ min: 1, max: 1000 }).map((n) => ` ${n}`),
  fc.integer({ min: 1, max: 1000 }).map((n) => `${n} `),
  fc.tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 })).map(([a, b]) => `${a}.${b}`),
  fc.tuple(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 0, max: 20 })).map(([a, b]) => `${a}e${b}`),
  fc.integer({ min: 1, max: 1000 }).map((n) => String(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(n))), // unsafe digits
  fc.stringMatching(/^[0-9]{17,30}$/).filter((s) => !Number.isSafeInteger(Number(s))),
  fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/^[0-9]+$/.test(s)),
);

test('Property 30: every positive safe integer is accepted, as a number and as digits', () => {
  fc.assert(
    fc.property(validArb, fc.nat({ max: 3 }), (n, zeros) => {
      assert.equal(parseTimeoutMs(n), n);
      assert.equal(parseTimeoutMs(String(n)), n);
      assert.equal(parseTimeoutMs('0'.repeat(zeros) + String(n)), n); // still a string of digits for a positive whole number
    }),
    { numRuns: 300 },
  );
});

test('Property 30: absent means the 10,000 ms default', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 10_000);
  assert.equal(parseTimeoutMs(undefined), 10_000);
  assert.equal(parseTimeoutMs(null), 10_000);
});

test('Property 30: numbers that are not positive safe integers are refused, naming the value', () => {
  fc.assert(
    fc.property(invalidNumberArb, (n) => {
      assert.throws(
        () => parseTimeoutMs(n),
        (e) => refused(e) && (e as RunError).args.value === String(n),
        String(n),
      );
    }),
    { numRuns: 300 },
  );
});

test('Property 30: strings that are not plain digits of a positive safe integer are refused, naming the value', () => {
  fc.assert(
    fc.property(invalidStringArb, (s) => {
      assert.throws(
        () => parseTimeoutMs(s),
        (e) => refused(e) && (e as RunError).args.value === s,
        JSON.stringify(s),
      );
    }),
    { numRuns: 400 },
  );
});

test('Property 30: parseTimeoutMs agrees with the model "positive safe integer" on arbitrary input', () => {
  fc.assert(
    fc.property(fc.oneof(fc.integer(), fc.double(), fc.string({ maxLength: 8 }), fc.stringMatching(/^[0-9]{1,18}$/)), (raw) => {
      const model = typeof raw === 'number' ? (Number.isSafeInteger(raw) && raw >= 1 ? raw : null) : /^[0-9]+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= 1 ? Number(raw) : null;
      if (model === null) assert.throws(() => parseTimeoutMs(raw), refused);
      else assert.equal(parseTimeoutMs(raw), model);
    }),
    { numRuns: 400 },
  );
});

// ------------------------------------------------------------------ devRun / lockedRun with the fake Runtime

const cleanup: string[] = [];
after(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

const cards = makeCardSet();
const lsDir = (env: TestEnv, sub: string): string[] => (fs.existsSync(path.join(env.root, sub)) ? fs.readdirSync(path.join(env.root, sub)).sort() : []);
const newEnv = (): TestEnv => {
  const env = makeEnv(cards);
  cleanup.push(env.root);
  return env;
};

// A fixed handful of bad values keeps the end-to-end cases fast (each one builds a temp repo).
const badRaw: fc.Arbitrary<number | string> = fc.constantFrom<number | string>('0', '-5', '1.5', '1e4', '', 'abc', ' 7', '+5', '9007199254740993', 0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2);

test('Property 30: an invalid Timeout starts no Dev_Run or Locked_Run: no request, no Results, no ledger entry, error names the value', async () => {
  // A Dev_Run first (valid), so the Locked_Run's own Timeout check is the only thing standing in the way.
  const env = newEnv();
  const okRt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(okRt), { combo: FAKE_COMBO.id, task: 'S' }))).value, 0);
  const resultsBefore = lsDir(env, 'eval/results/dev');
  await fc.assert(
    fc.asyncProperty(badRaw, fc.boolean(), async (raw, locked) => {
      const rt = createFakeRuntime();
      const run = await capture(() => (locked ? lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'S', timeoutMs: raw }) : devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'S', timeoutMs: raw })));
      assert.notEqual(run.value, 0);
      assert.match(run.err, /invalid_timeout/);
      assert.ok(run.err.includes(typeof raw === 'string' ? JSON.stringify(raw) : String(raw)), `error names ${String(raw)}: ${run.err}`);
      assert.equal(rt.calls.length, 0);
      assert.deepEqual(rt.engine, []); // not even a Runtime was loaded
      assert.deepEqual(lsDir(env, 'eval/results/dev'), resultsBefore);
      assert.deepEqual(lsDir(env, 'eval/results/locked'), []);
      assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')), 'no ledger entry');
    }),
    { numRuns: 30 },
  );
});

test('Property 30: a valid Timeout is recorded in the Results header and with every record, Dev_Run and Locked_Run', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 600_000 }), fc.boolean(), async (timeoutMs, asString) => {
      const env = newEnv();
      const rt = createFakeRuntime();
      const raw = asString ? String(timeoutMs) : timeoutMs;
      const dev = await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'S', timeoutMs: raw }));
      assert.equal(dev.value, 0, dev.err);
      const devDir = path.join(env.root, 'eval/results/dev');
      const devFile = fs.readdirSync(devDir).find((f) => !f.endsWith('.grades.jsonl')) as string;
      const devResults = readResultsFile(path.join(devDir, devFile));
      assert.equal(devResults.header.timeout_ms, timeoutMs);
      assert.ok(devResults.records.length > 0 && devResults.records.every((r) => r.timeout_ms === timeoutMs));

      const locked = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'S', timeoutMs: raw }));
      assert.equal(locked.value, 0, locked.err);
      const entry = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!;
      const lockedResults = readResultsFile(path.join(env.root, entry.complete?.results as string));
      assert.equal(lockedResults.header.timeout_ms, timeoutMs);
      assert.ok(lockedResults.records.length > 0 && lockedResults.records.every((r) => r.timeout_ms === timeoutMs));
    }),
    { numRuns: 6 },
  );
});

test('Property 30: with no Timeout given, the default is recorded', async () => {
  const env = newEnv();
  const rt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'S' }))).value, 0);
  const dir = path.join(env.root, 'eval/results/dev');
  const { header, records } = readResultsFile(path.join(dir, fs.readdirSync(dir).find((f) => !f.endsWith('.grades.jsonl')) as string));
  assert.equal(header.timeout_ms, 10_000);
  assert.ok(records.every((r) => r.timeout_ms === 10_000));
});
