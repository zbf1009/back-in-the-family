// Locked_Run transient load rules (Author's condition 2, 2026-11-08), on a SYNTHETIC card set.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readLedger } from '../../src/ledger.ts';
import { countsForGate, readFailures, readPerf, SCHEMA, type PerfRecord } from '../../src/results.ts';
import { devRun, lockedRun, LOCKED_LOAD_BACKOFF_MS, LOCKED_LOAD_RETRIES, RuntimeLoadError, type RuntimeFactory } from '../../src/run.ts';
import { capture, createFakeRuntime, FAKE_COMBO, makeCardSet, makeEnv } from './run.helpers.ts';

const cardSet = makeCardSet();
const perf = (marker: number): PerfRecord => ({ schema: SCHEMA.perf, run_kind: 'locked', fresh_profile: true, marker });

/** A factory whose n-th handle (0-based) fails `load` with the given error, else returns perf marked with n. */
function flaky(base: ReturnType<typeof createFakeRuntime>, failing: (n: number) => RuntimeLoadError | null, made: { count: number; closed: number }): RuntimeFactory {
  return async (ctx) => {
    const n = made.count++;
    const h = await base.factory(ctx);
    return {
      ...h,
      load: async () => {
        const e = failing(n);
        if (e !== null) throw e;
        return { perf: perf(n) };
      },
      close: () => {
        made.closed++;
      },
    };
  };
}

const transient = (): RuntimeLoadError => new RuntimeLoadError('model_load_failed', 'TypeError: network error');

async function devFirst(env: ReturnType<typeof makeEnv>): Promise<void> {
  assert.equal((await capture(() => devRun(env.deps(createFakeRuntime()), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
}

test('the retry rules are the documented ones: 3 retries, backoff 5 s / 15 s / 45 s', () => {
  assert.equal(LOCKED_LOAD_RETRIES, 3);
  assert.deepEqual([...LOCKED_LOAD_BACKOFF_MS], [5000, 15000, 45000]);
});

test('two transient load failures, then success: new Fresh_Profile per retry, perf from the successful load only, failure records ignored by the gate', async () => {
  const env = makeEnv(cardSet);
  await devFirst(env);
  const base = createFakeRuntime();
  const made = { count: 0, closed: 0 };
  const sleeps: number[] = [];
  const deps = env.deps(base, { createRuntime: flaky(base, (n) => (n < 2 ? transient() : null), made), sleep: async (ms) => void sleeps.push(ms) });
  let profiles = 0;
  const freshProfile = async () => (profiles++, { ok: true as const });
  const { value } = await capture(() => lockedRun({ ...deps, freshProfile }, { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 0);
  assert.deepEqual(sleeps, [5000, 15000]);
  assert.equal(made.count, 3);
  assert.equal(profiles, 3, 'one Fresh_Profile for the first handle and one per retry');
  const entry = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!;
  assert.equal(entry.status, 'complete');
  const perfFile = path.join(env.root, 'eval/results/locked', `${entry.entry_id}.perf.json`);
  const p = readPerf(perfFile);
  assert.equal(p['marker'], 2, 'the figures are from the third handle, the first that loaded');
  assert.equal(p['load_attempts'], 3);
  const failures = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
  assert.equal(failures.length, 2);
  for (const f of failures) {
    assert.equal(f['run_kind'], 'locked');
    assert.equal(f['transient'], true);
    assert.equal(f['will_retry'], true);
    assert.equal(countsForGate(f), false);
  }
});

test('a first-try load writes no load_attempts and the perf of that load', async () => {
  const env = makeEnv(cardSet);
  await devFirst(env);
  const base = createFakeRuntime();
  const made = { count: 0, closed: 0 };
  assert.equal((await capture(() => lockedRun(env.deps(base, { createRuntime: flaky(base, () => null, made) }), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
  const entry = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!;
  const p = readPerf(path.join(env.root, 'eval/results/locked', `${entry.entry_id}.perf.json`));
  assert.equal(p['marker'], 0);
  assert.equal(p['load_attempts'], undefined);
});

test('transient failures beyond the retry limit stop the run: aborted entry, final record locked + transient, the gate ignores all of them', async () => {
  const env = makeEnv(cardSet);
  await devFirst(env);
  const base = createFakeRuntime();
  const made = { count: 0, closed: 0 };
  const sleeps: number[] = [];
  const deps = env.deps(base, { createRuntime: flaky(base, () => transient(), made), sleep: async (ms) => void sleeps.push(ms) });
  assert.equal((await capture(() => lockedRun(deps, { combo: FAKE_COMBO.id, task: 'D' }))).value, 1);
  assert.deepEqual(sleeps, [5000, 15000, 45000]);
  assert.equal(made.count, 4);
  assert.equal(base.calls.length, 0);
  const entry = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!;
  assert.equal(entry.abort_reason, 'model_load_failed');
  assert.equal(fs.existsSync(path.join(env.root, 'eval/results/locked', `${entry.entry_id}.perf.json`)), false, 'no perf from failed loads');
  const failures = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
  assert.equal(failures.length, 4);
  assert.ok(failures.every((f) => f['run_kind'] === 'locked' && f['transient'] === true && !countsForGate(f)));
});

test('a non-transient load failure is not retried and counts for the gate', async () => {
  const env = makeEnv(cardSet);
  await devFirst(env);
  const base = createFakeRuntime();
  const made = { count: 0, closed: 0 };
  const sleeps: number[] = [];
  const deps = env.deps(base, { createRuntime: flaky(base, () => new RuntimeLoadError('model_load_failed', 'weights missing'), made), sleep: async (ms) => void sleeps.push(ms) });
  assert.equal((await capture(() => lockedRun(deps, { combo: FAKE_COMBO.id, task: 'D' }))).value, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(made.count, 1);
  const failures = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
  assert.equal(failures.length, 1);
  assert.ok(countsForGate(failures[0]!));
});

test('a mid-run transient error stops the run, is flagged transient, and is not counted by the gate', async () => {
  const env = makeEnv(cardSet);
  await devFirst(env);
  const rt = createFakeRuntime({ script: (i, p) => (i === 3 ? { kind: 'error', code: 'model_load_failed', detail: 'net::ERR_NETWORK_CHANGED', elapsedMs: 5, remote: null } : { kind: 'text', text: JSON.stringify({ option: /^- ([A-Za-z0-9_]+):/m.exec(p.user)?.[1] }), latencyMs: 5, usage: null }) });
  const { value } = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(value, 1);
  const failures = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
  assert.ok(failures.length >= 1);
  assert.ok(failures.every((f) => f['run_kind'] === 'locked' && f['transient'] === true && !countsForGate(f)));
});
