// Probe_Page logic (llm-probe task 16.7; R10.2, R10.3, R10.11, R14.4): bundle -> export mapping with a
// fake adapter, export schema validated by ingest.parseExport, copies pinned to their originals.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AdapterResult, Prompt, RuntimeAdapter } from '../../src/adapters/interface.ts';
import type { GpuLike } from '../../src/adapters/gpu.ts';
import { BUNDLE_SCHEMA, parseExport, type Bundle } from '../../src/ingest.ts';
import { parseCombinations, type Combination } from '../../src/phase.ts';
import { DECISION_SCHEMA as RUN_DECISION_SCHEMA, samplingFor } from '../../src/run.ts';
import { parseWarmupPrompt } from '../../src/templates.ts';
import {
  DECISION_SCHEMA,
  browserVersion,
  buildPageExport,
  checkBundleShape,
  createProbeController,
  parseWarmupText,
  readColdStart,
  recordColdStart,
  samplingForCombo,
  warmupSamplings,
  type KeyValueStore,
  type PageDeps,
  type PageRuntime,
} from '../../page/probe-core.ts';

const probeDir = fileURLToPath(new URL('../../', import.meta.url));
const combinations = parseCombinations(readFileSync(`${probeDir}combinations.json`, 'utf8'));
const inBrowser = combinations.filter((c) => c.runtime !== 'workers-ai');
const webllm = inBrowser.find((c) => c.runtime === 'webllm') as Combination;

const memoryStore = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

const hardwareGpu: GpuLike = {
  requestAdapter: async () => ({ info: { vendor: 'nvidia', architecture: 'ada', device: '', description: 'NVIDIA GeForce RTX 3050 Ti' } }),
};

function bundleOf(n: number, combo: Combination = webllm): Bundle {
  return {
    schema: BUNDLE_SCHEMA,
    run_id: 'run-1',
    split: 'dev',
    task_subset: 'DS',
    combination: combo,
    template_hashes: { decision: 'a'.repeat(64), synthesis: 'b'.repeat(64) },
    pinned_manifest_hash: 'c'.repeat(64),
    timeout_ms: 10_000,
    requests: Array.from({ length: n }, (_, i) => ({
      card_id: `D-${i}`,
      permutation: 'base',
      task: i % 2 === 0 ? ('decision' as const) : ('synthesis' as const),
      prompt: { system: `sys ${i}`, user: `user ${i}` },
      constraint: i % 2 === 0 ? { kind: 'json_schema' as const, schema: DECISION_SCHEMA } : { kind: 'none' as const },
    })),
  };
}

interface Fake {
  deps: PageDeps;
  seen: { prompt: Prompt; maxTokens: number; timeoutMs: number }[];
  closed: { n: number };
}

function fakeDeps(script: (i: number) => AdapterResult, opts: { gpu?: GpuLike | undefined; warmLatencies?: [number, number] } = {}): Fake {
  const seen: Fake['seen'] = [];
  const closed = { n: 0 };
  let t = 0;
  const [w1, w2] = opts.warmLatencies ?? [400, 100];
  const deps: PageDeps = {
    gpu: 'gpu' in opts ? opts.gpu : hardwareGpu,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.7151.55 Safari/537.36',
    clock: { now: () => t, setTimer: () => () => undefined },
    wallNow: () => Date.UTC(2026, 10, 8, 12, 0, 0, 123),
    combinations: inBrowser,
    warmups: { decision: { system: 's', user: 'u' }, synthesis: { system: 's2', user: 'u2' } },
    store: memoryStore(),
    log: () => undefined,
    makeRuntime(combo): PageRuntime {
      let i = 0;
      const adapter: RuntimeAdapter = {
        identity: () => ({ runtime: combo.runtime, runtimeVersion: '0.0.1', modelId: combo.model_id, modelRevision: combo.revision, quantization: combo.quantization }),
        state: () => 'idle',
        async complete(prompt, options) {
          seen.push({ prompt, maxTokens: options.sampling.maxOutputTokens, timeoutMs: options.timeoutMs });
          return script(i++);
        },
      };
      return {
        adapter,
        async load() {
          t += 5_000; // download + create; the clock only moves here
          t += w1 + w2;
          return [
            { task: 'decision', text: '{"option":"a"}', latencyMs: w1 },
            { task: 'synthesis', text: '{}', latencyMs: w2 },
          ];
        },
        fingerprint: () => ({ seed: null, device: 'webgpu' }),
        close: () => void closed.n++,
      };
    },
  };
  return { deps, seen, closed };
}

const text = (s: string, latencyMs = 100): AdapterResult => ({ kind: 'text', text: s, latencyMs, usage: null });

test('copies agree with their originals: sampling, warm-up samplings, decision schema, warm-up parser', () => {
  assert.deepEqual(DECISION_SCHEMA, RUN_DECISION_SCHEMA);
  for (const c of inBrowser) {
    for (const task of ['decision', 'synthesis'] as const) {
      const constraint = task === 'decision' ? ({ kind: 'json_schema', schema: DECISION_SCHEMA } as const) : ({ kind: 'none' } as const);
      assert.deepEqual(samplingForCombo(c, task, constraint), samplingFor(c, task, constraint), `${c.id} ${task}`);
    }
    assert.equal(warmupSamplings(c).decision.constraint.kind, c['constraint'] === 'json_schema' ? 'json_schema' : 'none');
  }
  for (const f of ['decision.txt', 'synthesis.txt']) {
    const raw = readFileSync(`${probeDir}warmup/${f}`, 'utf8');
    assert.deepEqual(parseWarmupText(raw), parseWarmupPrompt(raw));
  }
});

test('bundle -> export with a fake adapter parses as llm-probe-page-export-v1 and carries the bundle hashes', async () => {
  const f = fakeDeps((i) => text(`answer ${i}`, 123 + i));
  const probe = createProbeController(f.deps);
  probe.selectCombination(webllm.id);
  const cold = await probe.coldStart(); // empty
  assert.equal(cold, 5_400 + 100 - 100); // create + first warm-up only
  await probe.coldStart(); // warm
  probe.loadBundle(bundleOf(4));
  const entries = await probe.runBundle();
  assert.equal(entries.length, 4);
  const exp = parseExport(JSON.parse(probe.exportText()));
  assert.equal(exp.run_id, 'run-1');
  assert.deepEqual(exp.template_hashes, { decision: 'a'.repeat(64), synthesis: 'b'.repeat(64) });
  assert.equal(exp.pinned_manifest_hash, 'c'.repeat(64));
  assert.deepEqual(exp.cold_start, { empty_cache_ms: 5_400, warm_cache_ms: 5_400 });
  assert.equal((exp.fingerprint['browser'] as { version: string }).version, '137.0.7151.55');
  assert.equal((exp.fingerprint['webgpu'] as { description: string }).description, 'NVIDIA GeForce RTX 3050 Ti');
  assert.equal(exp.fingerprint['measurement'], 'probe_page');
  assert.deepEqual(exp.entries.map((e) => [e.card_id, e.latency_ms, e.requested_at]), [
    ['D-0', 123, '2026-11-08T12:00:00.123Z'],
    ['D-1', 124, '2026-11-08T12:00:00.123Z'],
    ['D-2', 125, '2026-11-08T12:00:00.123Z'],
    ['D-3', 126, '2026-11-08T12:00:00.123Z'],
  ]);
  // sampling comes from the Combination: decision 64 tokens, synthesis 1024 (D then S alternate)
  assert.deepEqual(f.seen.map((s) => s.maxTokens), [64, 1024, 64, 1024]);
  assert.ok(f.seen.every((s) => s.timeoutMs === 10_000));
});

test('timeout, late answer and error outcomes map to the export shapes', async () => {
  const script = (i: number): AdapterResult =>
    [
      { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'late', text: 'slow', latencyMs: 12_000.4 }) },
      { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_002, late: Promise.resolve({ kind: 'none', reason: 'generation_cap' }) },
      { kind: 'error', code: 'truncated', detail: 'finish_reason length', elapsedMs: 900, remote: null },
    ][i] as AdapterResult;
  const f = fakeDeps(script);
  const probe = createProbeController(f.deps);
  probe.selectCombination(webllm.id);
  await probe.coldStart('empty');
  await probe.coldStart('warm');
  probe.loadBundle(bundleOf(3));
  await probe.runBundle();
  const exp = parseExport(JSON.parse(probe.exportText()));
  assert.deepEqual(exp.entries[0]?.outcome, { kind: 'timeout' });
  assert.deepEqual(exp.entries[0]?.late, { kind: 'late', text: 'slow', latency_ms: 12_000 });
  assert.deepEqual(exp.entries[1]?.late, { kind: 'none', reason: 'generation_cap' });
  assert.deepEqual(exp.entries[2]?.outcome, { kind: 'error', code: 'truncated', detail: 'finish_reason length' });
  assert.equal(exp.entries[2]?.late, null);
});

test('export refuses until both cold-start figures exist and every request is answered', async () => {
  const f = fakeDeps(() => text('x'));
  const probe = createProbeController(f.deps);
  probe.selectCombination(webllm.id);
  await probe.coldStart();
  probe.loadBundle(bundleOf(2));
  await probe.runBundle();
  assert.throws(() => probe.export(), /both cold-start figures/);
  await probe.coldStart();
  probe.loadBundle(bundleOf(2));
  assert.throws(() => probe.export(), /every request answered/);
  await probe.runBundle();
  assert.equal(probe.export().entries.length, 2);
});

test('cold start: first figure is the empty-cache one, later ones the warm-cache one; explicit slot wins', () => {
  const s = memoryStore();
  assert.deepEqual(readColdStart(s, 'c'), { empty_cache_ms: null, warm_cache_ms: null });
  assert.equal(recordColdStart(s, 'c', 41_250.4).slot, 'empty');
  assert.equal(recordColdStart(s, 'c', 6_120).slot, 'warm');
  assert.deepEqual(readColdStart(s, 'c'), { empty_cache_ms: 41_250, warm_cache_ms: 6_120 });
  assert.equal(recordColdStart(s, 'c', 1, 'empty').slot, 'empty');
  assert.deepEqual(readColdStart(s, 'other'), { empty_cache_ms: null, warm_cache_ms: null });
});

test('engine creation is refused on a missing or software adapter, and no runtime is loaded', async () => {
  const none = fakeDeps(() => text('x'), { gpu: undefined });
  const p1 = createProbeController(none.deps);
  p1.selectCombination(webllm.id);
  await assert.rejects(p1.coldStart(), /gpu_unavailable/);
  const soft: GpuLike = { requestAdapter: async () => ({ info: { vendor: 'google', architecture: 'swiftshader' } }) };
  const sw = fakeDeps(() => text('x'), { gpu: soft });
  const p2 = createProbeController(sw.deps);
  p2.selectCombination(webllm.id);
  await assert.rejects(p2.createEngine(), /software_adapter/);
  assert.equal(p2.status().engine, 'none');
});

test('runPrompt returns the export view of one prompt; bundle shape check names the bad field', async () => {
  const f = fakeDeps(() => text('hello', 77));
  const probe = createProbeController(f.deps);
  probe.selectCombination(webllm.id);
  await probe.createEngine();
  const r = await probe.runPrompt({ system: 's', user: 'u' });
  assert.deepEqual(r, { outcome: { kind: 'text', text: 'hello' }, latency_ms: 77, requested_at: '2026-11-08T12:00:00.123Z', late: null });
  assert.throws(() => checkBundleShape({ schema: 'nope' }), /schema must be/);
  assert.throws(() => checkBundleShape({ ...bundleOf(1), requests: [{ card_id: 'x' }] }), /requests\[0\]/);
  assert.throws(() => buildPageExport({ bundle: bundleOf(0), fingerprint: {}, coldStart: { empty_cache_ms: 1, warm_cache_ms: null }, entries: [] }), /cold-start/);
});

test('browser version is read from the Chrome token', () => {
  assert.equal(browserVersion('Mozilla/5.0 Chrome/141.0.1.2 Safari/537.36'), '141.0.1.2');
  assert.equal(browserVersion('weird agent'), 'weird agent');
  assert.equal(browserVersion(''), 'unknown');
});
