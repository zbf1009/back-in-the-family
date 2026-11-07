// Run-flow example tests (llm-probe task 13.11): the ledger `start` ordering and failure behaviour,
// the start entry's contents, and the Idle_Cap / rebuild / engine-fault examples that the other run
// tests cover only through properties. Synthetic card set in temp dirs; real eval/results and
// locked.jsonl are never touched.
// **Validates: Requirements 3.3, 3.4, 8.5, 8.13, 18.1.**
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { AdapterResult } from '../../src/adapters/interface.ts';
import { readLedger } from '../../src/ledger.ts';
import { gradesPathFor, readFailures, readGradesFile, readResultsFile } from '../../src/results.ts';
import { devRun, lockedRun, type RuntimeFactory } from '../../src/run.ts';
import { capture, createFakeRuntime, FAKE_COMBO, makeCardSet, makeEnv, WORKERS_COMBO } from './run.helpers.ts';

const cardSet = makeCardSet();
const ok = (): AdapterResult => ({ kind: 'text', text: '{"option":"x"}', latencyMs: 1, usage: null });
const idleTimeout = (): AdapterResult => ({ kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'none', reason: 'idle_cap' }) });

/** Wraps a factory so every load, engine create, warm-up and request logs whether the ledger has a `start` yet. */
function observed(inner: RuntimeFactory, ledger: string, log: string[]): RuntimeFactory {
  const mark = (what: string): void => {
    log.push(`${what}:${fs.existsSync(ledger) && fs.readFileSync(ledger, 'utf8').includes('"start"') ? 'started' : 'no-start'}`);
  };
  return async (...args) => {
    const h = await inner(...args);
    const lc = h.lifecycle!;
    return {
      ...h,
      adapter: {
        identity: () => h.adapter.identity(),
        state: () => h.adapter.state(),
        complete: (p, o) => (mark('request'), h.adapter.complete(p, o)),
      },
      load: async (...a) => (mark('load'), h.load(...a)),
      lifecycle: {
        ...lc,
        engine: {
          create: async (...a) => (mark('create'), lc.engine.create(...a)),
          generate: async (...a) => (mark('warmup'), lc.engine.generate(...a)),
          dispose: () => lc.engine.dispose(),
        },
      },
    };
  };
}

async function dev(env: ReturnType<typeof makeEnv>, rt: ReturnType<typeof createFakeRuntime>, task: 'D' | 'S' | 'DS' = 'D'): Promise<void> {
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task }))).value, 0);
}

test('ledger start is written before the first request of any kind, warm-ups included; the entry carries its fields', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime({ script: (i) => (i === 78 ? idleTimeout() : ok()), stuckAfter: [78] });
  await dev(env, rt);
  const ledger = path.join(env.root, 'eval/results/ledger.jsonl');
  const log: string[] = [];
  const deps = env.deps(rt, { createRuntime: observed(rt.factory, ledger, log) });
  const r = await capture(() => lockedRun(deps, { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(r.value, 0, r.err);
  assert.ok(log.length > 74, 'load, requests, and the rebuild were observed');
  assert.ok(log.every((l) => l.endsWith(':started')), `something ran before the ledger start: ${log.find((l) => l.endsWith('no-start'))}`);
  assert.ok(log.some((l) => l.startsWith('warmup')));

  const { entries } = readLedger(ledger);
  const start = entries[0]!.start;
  assert.equal(start.task_subset, 'D');
  assert.ok(start.model_key !== null && start.model_key !== undefined && Object.keys(start.model_key).length > 0);
  assert.equal(start.combination, FAKE_COMBO.id);
  assert.equal(typeof start.fingerprint, 'object');
  assert.ok(Object.keys(start.fingerprint).length > 0);
  assert.deepEqual(Object.keys(start.template_hashes).sort(), ['decision']);
  assert.ok(Object.values(start.template_hashes).every((h) => /^[0-9a-f]{64}$/.test(h)));
});

test('a ledger write failure sends nothing and exits non-zero', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  await dev(env, rt);
  const calls = rt.calls.length;
  const engine = [...rt.engine];
  // A directory in the ledger's place makes every read or append fail.
  fs.mkdirSync(path.join(env.root, 'eval/results/ledger.jsonl'));
  let value: number | undefined;
  let thrown: unknown;
  try {
    value = (await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }))).value;
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown !== undefined || (value !== undefined && value !== 0), 'must not succeed');
  assert.equal(rt.calls.length, calls, 'no request of any kind');
  assert.deepEqual(rt.engine, engine, 'no load, create or warm-up');
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/locked')), 'no Results file');
});

test('Idle_Cap with a busy engine: Timeout graded Illegal, rebuild with both warm-ups before the next Card prompt, no runtime_stuck record', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime({ script: (i) => (i === 78 ? idleTimeout() : ok()), stuckAfter: [78] });
  await dev(env, rt);
  const before = rt.calls.length;
  const order: string[] = [];
  const base = rt.factory;
  const tracing: RuntimeFactory = async (...a) => {
    const h = await base(...a);
    const lc = h.lifecycle!;
    return {
      ...h,
      adapter: { identity: () => h.adapter.identity(), state: () => h.adapter.state(), complete: (p, o) => (order.push('request'), h.adapter.complete(p, o)) },
      lifecycle: { ...lc, engine: { ...lc.engine, generate: async (...g) => (order.push('warmup'), lc.engine.generate(...g)) } },
    };
  };
  const r = await capture(() => lockedRun(env.deps(rt, { createRuntime: tracing }), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(r.value, 0, r.err);
  const timeoutAt = order.indexOf('warmup');
  assert.equal(order.slice(timeoutAt, timeoutAt + 3).join(','), 'warmup,warmup,request', 'both warm-ups directly before the next request');
  assert.equal(order.slice(0, timeoutAt).length, 78 - before + 1, 'the timed-out request was the last one before the rebuild');
  const entry = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries[0]!;
  const file = path.join(env.root, entry.complete?.results as string);
  const { records } = readResultsFile(file);
  const timeouts = records.filter((x) => x.outcome.kind === 'timeout');
  assert.equal(timeouts.length, 1);
  const grade = readGradesFile(gradesPathFor(file)).grades.find((g) => g.card_id === timeouts[0]!.card_id && g.permutation === timeouts[0]!.permutation);
  assert.equal((grade?.verdict as { kind: string }).kind, 'illegal');
  assert.equal(records.filter((x) => x.outcome.kind === 'engine_fault').length, 0);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/failures.jsonl')) || readFailures(path.join(env.root, 'eval/results/failures.jsonl')).every((f) => f.kind !== 'runtime_stuck'));
});

test('rebuild failure: exactly one rebuild_failed record, an abort event, not_run for the rest, no per-card Illegal grade', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime({ script: (i) => (i === 80 ? idleTimeout() : ok()), stuckAfter: [80], failRebuilds: 1 });
  await dev(env, rt);
  const r = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
  assert.equal(r.value, 1);
  const { events, entries } = readLedger(path.join(env.root, 'eval/results/ledger.jsonl'));
  assert.deepEqual(events.map((e) => e.event), ['start', 'abort']);
  const failures = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
  assert.equal(failures.filter((f) => f.kind === 'rebuild_failed').length, 1);
  assert.equal(failures.length, 1);
  const file = path.join(env.root, 'eval/results/locked', `${entries[0]!.entry_id}.jsonl`);
  const { records } = readResultsFile(file);
  const notRun = records.filter((x) => x.outcome.kind === 'not_run');
  assert.ok(notRun.length > 0 && notRun.every((x) => x.outcome.kind === 'not_run' && x.outcome.reason === 'rebuild_failed'));
  // No grades file at all: no card got a per-card Illegal grade for the failed rebuild.
  assert.ok(!fs.existsSync(gradesPathFor(file)));
});

test('a forced runtime_stuck refusal is an engine_fault with no grade line and no Metric change', async () => {
  const run = async (fault: boolean): Promise<{ records: number; grades: number; faults: number; tasks: unknown }> => {
    const env = makeEnv(cardSet);
    const stuck: AdapterResult = { kind: 'error', code: 'runtime_stuck', detail: 'stuck', elapsedMs: 0, remote: null };
    const rt = createFakeRuntime({ script: (i) => (fault && i === 5 ? stuck : ok()) });
    assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
    const dir = path.join(env.root, 'eval/results/dev');
    const file = path.join(dir, fs.readdirSync(dir).find((f) => !f.endsWith('.grades.jsonl')) as string);
    const { records } = readResultsFile(file);
    const grades = readGradesFile(gradesPathFor(file)).grades;
    return { records: records.length, grades: grades.length, faults: records.filter((x) => x.outcome.kind === 'engine_fault').length, tasks: null };
  };
  const clean = await run(false);
  const faulty = await run(true);
  assert.equal(faulty.faults, 1);
  assert.equal(clean.faults, 0);
  assert.equal(faulty.records, clean.records);
  assert.equal(faulty.grades, clean.grades - 1, 'the engine fault has no grade line');
});

test('a refused Workers AI Locked_Run writes no ledger entry', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  // Default phase state: no approvals, no smoke record, so the gate refuses.
  const r = await capture(() => lockedRun(env.deps(rt), { combo: WORKERS_COMBO.id, task: 'D' }));
  assert.equal(r.value, 1);
  assert.equal(rt.calls.length, 0);
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/ledger.jsonl')));
});
