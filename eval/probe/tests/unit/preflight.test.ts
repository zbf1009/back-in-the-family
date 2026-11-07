// VRAM_Preflight and `probe screen` (llm-probe task 16.9), light: the length rule, the synthetic prompt, the
// verdicts, the command with a fake session, the page-side preflight request and the screen command with a fake
// fetch. The example tests proper are task 16.10. No browser, no network, no nvidia-smi.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import type { AdapterResult, RuntimeAdapter } from '../../src/adapters/interface.ts';
import type { Placement } from '../../src/adapters/placement.ts';
import { BrowserLoadError, type PreflightMeasurement } from '../../src/browser/driver.ts';
import type { Combination } from '../../src/phase.ts';
import {
  PREFLIGHT_LENGTH_FLOOR_BYTES,
  PREFLIGHT_MAX_NEW_TOKENS,
  PREFLIGHT_MIN_NEW_TOKENS,
  buildPreflightPrompt,
  judgePreflight,
  padPrompt,
  parsePreflightArgs,
  preflightLength,
  preflightPath,
  preflightRun,
  promptBytes,
  syntheticFrozenContext,
  type PreflightSession,
} from '../../src/preflight.ts';
import { parsePreflightRecord, readExclusions, readPreflight } from '../../src/results.ts';
import { VRAM_LIMIT_MIB } from '../../src/screen.ts';
import { parseScreenArgs, readTree, repoOf, screenAll, screenRun, withDownloadBytes, type TreeFetch } from '../../src/screen-command.ts';
import { loadTemplate } from '../../src/templates.ts';
import { createProbeController, type PageDeps, type PageRuntime } from '../../page/probe-core.ts';
import { capture, FAKE_COMBO, makeCardSet, makeEnv, REVISION } from './run.helpers.ts';

const cardSet = makeCardSet();
const TF: Combination = {
  ...FAKE_COMBO,
  id: 'transformers.js/test-model-q4/nvidia',
  runtime: 'transformers.js',
  model_id: 'org/Test-Model-ONNX',
  quantization: 'q4',
  revision: REVISION,
  size: { expected_download_bytes: 1000, download_source: 't', params: 1_000_000_000, params_source: 't', vram_mib: null, vram_source: 'preflight' },
};
const SCHEMA_TEXT = fs.readFileSync(path.join(cardSet.dir, 'schemas', 'grudge_v1.json'), 'utf8');
const SYNTHESIS = loadTemplate('synthesis').text;
const PLACEMENT: Placement = { method: 'onnxruntime_node_placements', cpu_nodes: [{ op_type: 'Shape', count: 2 }] };

// ---------------------------------------------------------------- the length rule and the prompt

test('L = max(8,000, 2 x the longest Dev_Card prompt)', () => {
  assert.equal(preflightLength(0), PREFLIGHT_LENGTH_FLOOR_BYTES);
  assert.equal(preflightLength(4000), 8000);
  assert.equal(preflightLength(4001), 8002);
  fc.assert(fc.property(fc.nat(100_000), (n) => preflightLength(n) === Math.max(8000, 2 * n)));
});

test('the synthetic context has at least 8 events and 6 persons and renders with the real synthesis template', () => {
  const ctx = syntheticFrozenContext();
  assert.ok((ctx['events'] as unknown[]).length >= 8);
  assert.ok((ctx['people'] as unknown[]).length >= 6);
  const p = buildPreflightPrompt({ longestDevPromptBytes: 1000, synthesisTemplate: SYNTHESIS, schemaText: SCHEMA_TEXT });
  assert.ok(p.eventCount >= 8 && p.personCount >= 6);
  assert.ok(p.bytes >= 8000 && p.bytes === promptBytes(p.prompt));
  assert.match(p.prompt.user, /#9701 Orla Finch/);
  // IDs outside the dev Card_Set (checked on the dev lines, which are allowed): no dev card names these events.
  const dev = fs.readFileSync(path.join(cardSet.dir, 'cards', 'dev.jsonl'), 'utf8');
  assert.ok(!/"e97\d\d"/.test(dev) && !/"id":97\d\d/.test(dev) && !/S-97\d\d/.test(dev));
});

test('padding is deterministic and reaches the target; a longer rule gives a longer prompt', () => {
  const a = buildPreflightPrompt({ longestDevPromptBytes: 7000, synthesisTemplate: SYNTHESIS, schemaText: SCHEMA_TEXT });
  const b = buildPreflightPrompt({ longestDevPromptBytes: 7000, synthesisTemplate: SYNTHESIS, schemaText: SCHEMA_TEXT });
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.targetBytes, 14_000);
  assert.ok(a.bytes >= 14_000 && a.bytes < 14_000 + 200);
  fc.assert(fc.property(fc.nat(30_000), (n) => promptBytes(padPrompt({ system: 'sys', user: 'user' }, n)) >= n));
});

test('--combo is required; --force is the only other flag', () => {
  assert.equal(parsePreflightArgs([]).ok, false);
  assert.deepEqual(parsePreflightArgs(['--combo', 'x', '--force']), { ok: true, options: { combo: 'x', force: true } });
  assert.equal(parsePreflightArgs(['--combo', 'x', '--bogus']).ok, false);
});

// ---------------------------------------------------------------- verdicts

const prompt = buildPreflightPrompt({ longestDevPromptBytes: 1000, synthesisTemplate: SYNTHESIS, schemaText: SCHEMA_TEXT });

function measurement(over: Partial<PreflightMeasurement> & { peak?: number | null } = {}): PreflightMeasurement {
  const { peak = 1800, ...rest } = over;
  return {
    adapter: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', is_fallback_adapter: false },
    placement: PLACEMENT,
    memory: { gpu: 'nvidia', quantity: 'NVIDIA device memory.used delta', peak_mib: peak, reason: peak === null ? 'no reading' : null },
    run: { ok: true, view: { outcome: { kind: 'error', code: 'truncated', detail: 'max_new_tokens reached' }, latency_ms: 60_000, reached_limit: true } },
    ...rest,
  };
}

const judge = (attempt: Parameters<typeof judgePreflight>[0]['attempt']) =>
  judgePreflight({ combo: TF, at: '2026-11-08T00:00:00.000Z', prompt, attempt, versions: { transformers: '4.3.2' }, browser: { version: '155' }, adapterFacts: { seed: null }, adapter: null });

test('a completed run under the limit records a passing result with the fixed fields and no exclusion', () => {
  const v = judge({ kind: 'measured', measurement: measurement() });
  assert.equal(v.kind, 'record');
  if (v.kind !== 'record') return;
  assert.equal(v.exclusion, null);
  const r = parsePreflightRecord(JSON.parse(JSON.stringify(v.record)));
  assert.equal(r['eos_disabled'], true);
  assert.equal(r['new_tokens'], PREFLIGHT_MAX_NEW_TOKENS);
  assert.equal(r['max_new_tokens'], 1024);
  assert.equal(r['min_new_tokens'], 1024);
  assert.equal(r['peak_vram_mib'], 1800);
  assert.equal(r['loaded_on_webgpu'], true);
  assert.deepEqual(r['placement'], { method: 'onnxruntime_node_placements', cpu_nodes: [{ op_type: 'Shape', count: 2 }] });
  assert.equal(r['prompt_bytes'], prompt.bytes);
  assert.equal(r['revision'], REVISION);
});

test('a peak above 2,600 MiB excludes; exactly 2,600 does not', () => {
  const over = judge({ kind: 'measured', measurement: measurement({ peak: VRAM_LIMIT_MIB + 1 }) });
  assert.equal(over.kind === 'record' ? over.exclusion?.check : null, 'preflight_vram');
  assert.equal(over.kind === 'record' ? over.exclusion?.value : null, 2601);
  const at = judge({ kind: 'measured', measurement: measurement({ peak: VRAM_LIMIT_MIB }) });
  assert.equal(at.kind === 'record' ? at.exclusion : 'x', null);
});

test('a load failure excludes with preflight_load; a missing GPU or NVIDIA reading records nothing', () => {
  const lf = judge({ kind: 'load_failed', code: 'model_load_failed', message: 'weights missing' });
  assert.equal(lf.kind === 'record' ? lf.exclusion?.check : null, 'preflight_load');
  assert.equal(lf.kind === 'record' ? lf.record['loaded_on_webgpu'] : null, false);
  const nw = judge({ kind: 'load_failed', code: 'backend_not_webgpu', message: 'cpu only' });
  assert.equal(nw.kind === 'record' ? nw.exclusion?.check : null, 'preflight_load');
  assert.equal(judge({ kind: 'load_failed', code: 'software_adapter', message: 'swiftshader' }).kind, 'no_record');
  assert.equal(judge({ kind: 'measured', measurement: measurement({ peak: null }) }).kind, 'no_record');
});

test('generation that stops early or fails: out of memory excludes, anything else records nothing', () => {
  const early = measurement({ run: { ok: true, view: { outcome: { kind: 'text', text: 'x' }, latency_ms: 5, reached_limit: false } } });
  assert.equal(judge({ kind: 'measured', measurement: early }).kind, 'no_record');
  const oom = measurement({ run: { ok: false, error: 'GPUOutOfMemoryError: out of memory' } });
  const v = judge({ kind: 'measured', measurement: oom });
  assert.equal(v.kind === 'record' ? v.exclusion?.check : null, 'preflight_vram');
  assert.equal(judge({ kind: 'measured', measurement: measurement({ run: { ok: false, error: 'page closed' } }) }).kind, 'no_record');
});

// ---------------------------------------------------------------- the command with a fake session

function fakeSession(m: PreflightMeasurement | BrowserLoadError, seen: { prompt?: string; max?: number; min?: number; closed: number }): PreflightSession {
  return {
    prepare: async () => ({ ok: true, adapter: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', is_fallback_adapter: false }, quotaBytes: 1e12, expectedDownloadBytes: 1000 }),
    preflight: async (p, o) => {
      seen.prompt = `${p.system}\n${p.user}`;
      seen.max = o.maxNewTokens;
      seen.min = o.minNewTokens;
      if (m instanceof BrowserLoadError) throw m;
      return m;
    },
    close: async () => void (seen.closed += 1),
    adapterInfo: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', is_fallback_adapter: false },
    userAgentString: 'Mozilla/5.0 Chrome/155.0.1.2',
    fingerprintExtras: { seed: null, chat_template_kwargs: { enable_thinking: false, add_generation_prompt: true } },
  };
}

test('preflight command: writes preflight/<combo>.json, no Results record, sends 1,024 new tokens twice (max and min)', async () => {
  const env = makeEnv(cardSet);
  const seen = { closed: 0 } as { prompt?: string; max?: number; min?: number; closed: number };
  const deps = { ...env.deps({} as never), combinations: [TF], engineVersions: { transformers: '4.3.2' }, openSession: async () => fakeSession(measurement(), seen) };
  const { value } = await capture(() => preflightRun(deps, { combo: TF.id }));
  assert.equal(value, 0);
  assert.equal(seen.max, PREFLIGHT_MAX_NEW_TOKENS);
  assert.equal(seen.min, PREFLIGHT_MIN_NEW_TOKENS);
  assert.equal(seen.closed, 1);
  const file = preflightPath(deps.paths.resultsDir, TF.id);
  const rec = readPreflight(file);
  assert.equal(rec['combination'], TF.id);
  assert.ok((rec['prompt_bytes'] as number) >= 8000);
  assert.ok(Buffer.byteLength(seen.prompt as string, 'utf8') >= (rec['prompt_target_bytes'] as number));
  // No Results, no ledger, no exclusion.
  assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/dev')) && !fs.existsSync(path.join(env.root, 'eval/results/locked')));
  assert.ok(!fs.existsSync(deps.paths.ledger) && !fs.existsSync(deps.paths.exclusions));
  // A second run refuses to replace the file.
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 1);
});

test('preflight command: a peak above the limit writes the record and an Exclusion_Record; a load failure too', async () => {
  const env = makeEnv(cardSet);
  const seen = { closed: 0 };
  const over = { ...env.deps({} as never), combinations: [TF], engineVersions: { transformers: '4.3.2' }, openSession: async () => fakeSession(measurement({ peak: 3100 }), seen) };
  assert.equal((await capture(() => preflightRun(over, { combo: TF.id }))).value, 1);
  assert.equal(readPreflight(preflightPath(over.paths.resultsDir, TF.id))['peak_vram_mib'], 3100);
  const ex = readExclusions(over.paths.exclusions);
  assert.deepEqual(ex.map((e) => [e.combination, e.check, e.value, e.limit]), [[TF.id, 'preflight_vram', 3100, 2600]]);

  const env2 = makeEnv(cardSet);
  const failing = { ...env2.deps({} as never), combinations: [TF], engineVersions: { transformers: '4.3.2' }, openSession: async () => fakeSession(new BrowserLoadError('model_load_failed', 'no weights'), seen) };
  assert.equal((await capture(() => preflightRun(failing, { combo: TF.id }))).value, 1);
  assert.equal(readExclusions(failing.paths.exclusions)[0]?.check, 'preflight_load');
});

test('preflight command refuses a WebLLM or unpinned Combination before any browser is opened', async () => {
  const env = makeEnv(cardSet);
  const opened = { n: 0 };
  const open = async () => {
    opened.n += 1;
    return fakeSession(measurement(), { closed: 0 });
  };
  const web = { ...TF, id: 'webllm/x', runtime: 'webllm' };
  const unpinned = { ...TF, id: 'transformers.js/unpinned', revision: 'unpinned' };
  const deps = { ...env.deps({} as never), combinations: [web, unpinned], engineVersions: { transformers: '4.3.2' }, openSession: open };
  assert.equal((await capture(() => preflightRun(deps, { combo: web.id }))).value, 1);
  assert.equal((await capture(() => preflightRun(deps, { combo: unpinned.id }))).value, 1);
  assert.equal(opened.n, 0);
});

// ---------------------------------------------------------------- the page side

test('page: fingerprintExtras reports the adapter fingerprint without loading; runPreflight sends max and min and reports the limit', async () => {
  let loads = 0;
  const calls: { min: number; max: number }[] = [];
  const deps: PageDeps = {
    gpu: { requestAdapter: async () => ({ info: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' } }) },
    userAgent: 'Chrome/155.0.1.2',
    clock: { now: () => 0, setTimer: () => () => undefined },
    wallNow: () => 0,
    combinations: [TF],
    warmups: { decision: { system: 's', user: 'u' }, synthesis: { system: 's', user: 'u' } },
    store: { get: () => null, set: () => undefined },
    log: () => undefined,
    makeRuntime(combo): PageRuntime {
      const adapter: RuntimeAdapter = {
        identity: () => ({ runtime: combo.runtime, runtimeVersion: '1', modelId: combo.model_id, modelRevision: combo.revision, quantization: 'q4' }),
        state: () => 'idle',
        complete: async () => ({ kind: 'text', text: '', latencyMs: 0, usage: null }),
      };
      return {
        adapter,
        preflight: {
          complete: async (_p, o, min): Promise<AdapterResult> => {
            calls.push({ min, max: o.sampling.maxOutputTokens });
            return { kind: 'error', code: 'truncated', detail: 'max_new_tokens reached', elapsedMs: 10, remote: null };
          },
        },
        load: async () => {
          loads += 1;
          return [];
        },
        fingerprint: () => ({ chat_template_kwargs: { enable_thinking: false, add_generation_prompt: true }, seed: null }),
        close: () => undefined,
      };
    },
  };
  const probe = createProbeController(deps);
  probe.selectCombination(TF.id);
  assert.deepEqual(probe.fingerprintExtras(), { chat_template_kwargs: { enable_thinking: false, add_generation_prompt: true }, seed: null });
  assert.equal(loads, 0);
  await probe.createEngine();
  const run = await probe.runPreflight({ system: 's', user: 'u' }, { maxNewTokens: 1024, minNewTokens: 1024, timeoutMs: 1000 });
  assert.deepEqual(calls, [{ min: 1024, max: 1024 }]);
  assert.equal(run.reached_limit, true);
});

// ---------------------------------------------------------------- screen

const treeOf = (files: Record<string, number>): unknown[] => Object.entries(files).map(([p, size]) => ({ type: 'file', path: p, size }));
const okFetch = (byUrl: Record<string, unknown[]>, seen: string[] = []): TreeFetch => async (url) => {
  seen.push(url);
  const body = byUrl[url];
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body, headers: { get: () => null } };
};

test('screen reads the API tree at each revision, follows paging and writes sizes only with --write', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'screen-'));
  const pinned = { ...TF, id: 'tf/pinned', size: { ...TF.size!, expected_download_bytes: null, params: 1_000_000_000 } } as Combination;
  const unpinned = { ...pinned, id: 'tf/unpinned', revision: 'unpinned' } as Combination;
  const file = path.join(dir, 'combinations.json');
  fs.writeFileSync(file, `${JSON.stringify([pinned, unpinned], null, 2)}\n`);
  const url = `https://huggingface.co/api/models/${repoOf(pinned)}/tree/${REVISION}?recursive=true`;
  assert.equal(url, `https://huggingface.co/api/models/org/Test-Model-ONNX/tree/${REVISION}?recursive=true`);
  const seen: string[] = [];
  const fetchTree = okFetch({ [url]: treeOf({ 'config.json': 100, 'onnx/model_q4.onnx': 5000, 'onnx/model_fp16.onnx': 90_000, 'README.md': 50 }) }, seen);
  const deps = { combinationsFile: file, exclusionsFile: path.join(dir, 'exclusions.jsonl'), preflightDir: path.join(dir, 'preflight'), fetch: fetchTree, now: () => 0 };

  const dry = await capture(() => screenRun(deps, { write: false }));
  assert.equal(dry.value, 1); // the unpinned Combination is excluded in the table
  assert.equal(seen.length, 1); // the unpinned one was not fetched
  assert.ok(!fs.existsSync(deps.exclusionsFile));
  assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify([pinned, unpinned], null, 2)}\n`); // unchanged

  await capture(() => screenRun(deps, { write: true }));
  const after = JSON.parse(fs.readFileSync(file, 'utf8')) as Combination[];
  assert.equal(after[0]?.size?.expected_download_bytes, 5100); // config.json + the q4 file
  assert.equal(after[1]?.size?.expected_download_bytes, null);
  // The unpinned Combination gets no terminal Exclusion_Record unless asked.
  assert.ok(!fs.existsSync(deps.exclusionsFile));
  await capture(() => screenRun(deps, { write: true, excludeUnpinned: true }));
  assert.deepEqual(readExclusions(deps.exclusionsFile).map((e) => [e.combination, e.check]), [['tf/unpinned', 'download']]);
});

test('screen: a failed tree request is never turned into an Exclusion_Record', async () => {
  const pinned = { ...TF, id: 'tf/pinned', size: { ...TF.size!, expected_download_bytes: null } } as Combination;
  const report = await screenAll([pinned], okFetch({}), '2026-11-08T00:00:00.000Z');
  assert.equal(report.fetchErrors.size, 1);
  const dir = mkdtempSync(path.join(tmpdir(), 'screen-'));
  const file = path.join(dir, 'combinations.json');
  fs.writeFileSync(file, `${JSON.stringify([pinned], null, 2)}\n`);
  const deps = { combinationsFile: file, exclusionsFile: path.join(dir, 'exclusions.jsonl'), preflightDir: path.join(dir, 'p'), fetch: okFetch({}), now: () => 0 };
  assert.equal((await capture(() => screenRun(deps, { write: true }))).value, 1);
  assert.ok(!fs.existsSync(deps.exclusionsFile));
});

test('readTree follows Link headers; withDownloadBytes never overwrites a stored figure and keeps the layout', async () => {
  const pages: Record<string, { body: unknown[]; link: string | null }> = {
    'https://huggingface.co/api/models/o/m/tree/r?recursive=true': { body: treeOf({ 'a.json': 1 }), link: '<https://huggingface.co/next>; rel="next"' },
    'https://huggingface.co/next': { body: [...treeOf({ 'b.json': 2 }), { type: 'directory', path: 'onnx' }], link: null },
  };
  const files = await readTree(async (u) => ({ ok: true, status: 200, json: async () => pages[u]!.body, headers: { get: () => pages[u]!.link } }), 'o/m', 'r');
  assert.deepEqual(files, [{ path: 'a.json', size: 1 }, { path: 'b.json', size: 2 }]);
  const text = `${JSON.stringify([{ id: 'a', size: { expected_download_bytes: null } }, { id: 'b', size: { expected_download_bytes: 7 } }], null, 2)}\n`;
  const out = JSON.parse(withDownloadBytes(text, new Map([['a', 11], ['b', 99]]))) as { size: { expected_download_bytes: number } }[];
  assert.deepEqual(out.map((c) => c.size.expected_download_bytes), [11, 7]);
  assert.throws(() => withDownloadBytes('[{"id":"a"}]', new Map()), /canonical/);
  assert.deepEqual(parseScreenArgs(['--write']), { ok: true, options: { write: true } });
  assert.equal(parseScreenArgs(['--nope']).ok, false);
});
