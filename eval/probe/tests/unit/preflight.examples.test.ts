// VRAM_Preflight example tests (llm-probe task 16.10; R9.9, R9.16). They run the `preflight` command end to end
// with a fake PreflightSession and check what the light tests of 16.9 (preflight.test.ts) do not: the prompt that
// reaches the session is the synthetic one and no Card text, nothing is written to Results, the length rule is applied
// with the exact numbers, the 1,024-token parameters, every field of the `llm-probe-preflight-v1` record, and the
// Exclusion_Record boundaries (load failure, not on WebGPU, peak 2,600 MiB passes, 2,601 MiB excludes).
// No browser, no network, no nvidia-smi.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Prompt } from '../../src/adapters/interface.ts';
import type { Placement } from '../../src/adapters/placement.ts';
import { BrowserLoadError, type PreflightMeasurement } from '../../src/browser/driver.ts';
import type { Combination } from '../../src/phase.ts';
import { attemptsPath, longestDevPromptBytes, preflightPath, preflightRun, promptBytes, type PreflightDeps, type PreflightSession } from '../../src/preflight.ts';
import { readExclusions, readPreflight } from '../../src/results.ts';
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
const ADAPTER = { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', is_fallback_adapter: false };
const PLACEMENT: Placement = { method: 'onnxruntime_node_placements', cpu_nodes: [{ op_type: 'Shape', count: 2 }] };

function measured(peak: number): PreflightMeasurement {
  return {
    adapter: ADAPTER,
    placement: PLACEMENT,
    memory: { gpu: 'nvidia', quantity: 'NVIDIA device memory.used delta', peak_mib: peak, reason: null },
    run: { ok: true, view: { outcome: { kind: 'error', code: 'truncated', detail: 'max_new_tokens reached' }, latency_ms: 60_000, reached_limit: true } },
  };
}

interface Seen {
  prompts: Prompt[];
  options: { maxNewTokens: number; minNewTokens: number; timeoutMs: number }[];
  closed: number;
}

function session(result: PreflightMeasurement | BrowserLoadError, seen: Seen): PreflightSession {
  return {
    prepare: async () => ({ ok: true, adapter: ADAPTER, quotaBytes: 1e12, expectedDownloadBytes: 1000 }),
    preflight: async (prompt, o) => {
      seen.prompts.push(prompt);
      seen.options.push({ ...o });
      if (result instanceof BrowserLoadError) throw result;
      return result;
    },
    close: async () => void (seen.closed += 1),
    adapterInfo: ADAPTER,
    userAgentString: 'Mozilla/5.0 Chrome/155.0.1.2',
    fingerprintExtras: { seed: null, chat_template_kwargs: { enable_thinking: false, add_generation_prompt: true } },
  };
}

function setup(result: PreflightMeasurement | BrowserLoadError): { deps: PreflightDeps; seen: Seen; root: string } {
  const env = makeEnv(cardSet);
  const seen: Seen = { prompts: [], options: [], closed: 0 };
  const deps: PreflightDeps = { ...env.deps({} as never), combinations: [TF], engineVersions: { transformers: '4.3.2' }, openSession: async () => session(result, seen) };
  return { deps, seen, root: env.root };
}

// ---------------------------------------------------------------- the prompt and the length rule

test('the prompt sent is the synthetic one: no Dev_Card id, no Dev_Card person, no Card marker text', async () => {
  const { deps, seen } = setup(measured(1800));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 0);
  assert.equal(seen.prompts.length, 1);
  const sent = `${seen.prompts[0]?.system}\n${seen.prompts[0]?.user}`;

  const devLines = fs.readFileSync(path.join(cardSet.dir, 'cards', 'dev.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
  assert.ok(devLines.length > 0);
  const names = new Set<string>();
  for (const line of devLines) {
    const card = JSON.parse(line) as { id: string; context?: { people?: { name: string; soul_id: string }[] } };
    assert.ok(!sent.includes(card.id), `the prompt contains Dev_Card id ${card.id}`);
    for (const p of card.context?.people ?? []) names.add(p.name);
  }
  for (const n of names) assert.ok(!sent.includes(n), `the prompt contains Dev_Card person ${n}`);
  assert.ok(!/\bD-[a-z_]+-\d{3}\b/.test(sent) && !/\bL-[a-z_]+-\d{3}\b/.test(sent), 'a Card id shape appears in the prompt');
  assert.match(sent, /Orla Finch/); // the invented Frozen_Context is what was rendered
});

test('the length rule: prompt_bytes >= max(8,000, 2 x the longest Dev_Card prompt), event_count >= 8, person_count >= 6', async () => {
  const { deps, seen } = setup(measured(1800));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 0);
  const longest = longestDevPromptBytes(deps, TF);
  assert.ok(longest > 0);
  const rule = Math.max(8000, 2 * longest);
  const rec = readPreflight(preflightPath(deps.paths.resultsDir, TF.id));
  assert.equal(rec['longest_dev_prompt_bytes'], longest);
  assert.equal(rec['prompt_target_bytes'], rule);
  assert.ok((rec['prompt_bytes'] as number) >= rule);
  assert.equal(rec['prompt_bytes'], promptBytes(seen.prompts[0] as Prompt)); // the record states what was actually sent
  assert.ok((rec['event_count'] as number) >= 8);
  assert.ok((rec['person_count'] as number) >= 6);
});

// ---------------------------------------------------------------- no Results record

test('a preflight writes only preflight/<combo>.json and preflight/attempts.jsonl: no Results, no ledger, no exclusion, no budget entry', async () => {
  const { deps, root } = setup(measured(1800));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 0);
  const results = path.join(root, 'eval/results');
  assert.deepEqual(fs.readdirSync(results).sort(), ['preflight']);
  assert.deepEqual(fs.readdirSync(path.join(results, 'preflight')).sort(), ['attempts.jsonl', path.basename(preflightPath(deps.paths.resultsDir, TF.id))].sort());
  assert.ok(!fs.existsSync(deps.paths.ledger) && !fs.existsSync(deps.paths.exclusions));
});

// ---------------------------------------------------------------- the 1,024-token request and the record

test('1,024 new tokens with min_new_tokens 1,024 are requested, and the record says so', async () => {
  const { deps, seen } = setup(measured(1800));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 0);
  assert.equal(seen.options.length, 1);
  assert.equal(seen.options[0]?.maxNewTokens, 1024);
  assert.equal(seen.options[0]?.minNewTokens, 1024);
  const rec = readPreflight(preflightPath(deps.paths.resultsDir, TF.id));
  assert.equal(rec['new_tokens'], 1024);
  assert.equal(rec['max_new_tokens'], 1024);
  assert.equal(rec['min_new_tokens'], 1024);
  assert.equal(rec['eos_disabled'], true);
});

test('every field of llm-probe-preflight-v1 is present and typed (completed run)', async () => {
  const { deps } = setup(measured(1800));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 0);
  const rec = readPreflight(preflightPath(deps.paths.resultsDir, TF.id));
  const str = (k: string): void => assert.equal(typeof rec[k], 'string', k);
  const int = (k: string): void => assert.ok(Number.isInteger(rec[k]), k);
  const obj = (k: string): void => assert.ok(typeof rec[k] === 'object' && rec[k] !== null && !Array.isArray(rec[k]), k);
  assert.equal(rec['schema'], 'llm-probe-preflight-v1');
  for (const k of ['combination', 'model_id', 'runtime', 'revision', 'prompt_sha256', 'memory_quantity', 'generation', 'at']) str(k);
  for (const k of ['prompt_bytes', 'prompt_target_bytes', 'longest_dev_prompt_bytes', 'event_count', 'person_count', 'max_new_tokens', 'min_new_tokens', 'new_tokens', 'peak_vram_mib', 'latency_ms']) int(k);
  for (const k of ['versions', 'browser', 'adapter', 'adapter_facts', 'placement']) obj(k);
  assert.equal(typeof rec['eos_disabled'], 'boolean');
  assert.equal(typeof rec['loaded_on_webgpu'], 'boolean');
  assert.equal(rec['loaded_on_webgpu'], true);
  assert.equal(rec['error'], null);
  assert.equal(rec['generation'], 'completed');
  assert.match(rec['prompt_sha256'] as string, /^[0-9a-f]{64}$/);
  assert.ok(!Number.isNaN(Date.parse(rec['at'] as string)));
  assert.equal(rec['combination'], TF.id);
  assert.equal(rec['model_id'], TF.model_id);
  assert.equal(rec['runtime'], 'transformers.js');
  assert.equal(rec['revision'], REVISION);
  assert.equal((rec['versions'] as Record<string, unknown>)['transformers'], '4.3.2');
});

// ---------------------------------------------------------------- Exclusion_Record boundaries

test('a peak of exactly 2,600 MiB passes with no Exclusion_Record; 2,601 MiB excludes', async () => {
  const at = setup(measured(2600));
  assert.equal((await capture(() => preflightRun(at.deps, { combo: TF.id }))).value, 0);
  assert.ok(!fs.existsSync(at.deps.paths.exclusions));
  assert.equal(readPreflight(preflightPath(at.deps.paths.resultsDir, TF.id))['peak_vram_mib'], 2600);

  const over = setup(measured(2601));
  assert.equal((await capture(() => preflightRun(over.deps, { combo: TF.id }))).value, 1);
  assert.deepEqual(
    readExclusions(over.deps.paths.exclusions).map((e) => [e.combination, e.check, e.value, e.limit]),
    [[TF.id, 'preflight_vram', 2601, 2600]],
  );
});

test('a model that fails to load writes loaded_on_webgpu false and a preflight_load Exclusion_Record', async () => {
  const { deps, seen } = setup(new BrowserLoadError('model_load_failed', 'weights missing'));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 1);
  const rec = readPreflight(preflightPath(deps.paths.resultsDir, TF.id));
  assert.equal(rec['loaded_on_webgpu'], false);
  assert.equal(rec['new_tokens'], 0);
  assert.equal(rec['peak_vram_mib'], null);
  assert.equal(rec['generation'], 'not_started');
  assert.equal(rec['eos_disabled'], true);
  const ex = readExclusions(deps.paths.exclusions);
  assert.deepEqual(ex.map((e) => [e.combination, e.check, e.model]), [[TF.id, 'preflight_load', TF.model_id]]);
  assert.equal(seen.closed, 1); // the session is closed whatever happened
});

test('a model that did not run on the WebGPU provider is excluded the same way', async () => {
  const { deps } = setup(new BrowserLoadError('backend_not_webgpu', 'CPU provider only'));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 1);
  assert.equal(readPreflight(preflightPath(deps.paths.resultsDir, TF.id))['loaded_on_webgpu'], false);
  assert.equal(readExclusions(deps.paths.exclusions)[0]?.check, 'preflight_load');
});

test('a transient network error during model load writes only an attempt record and no Exclusion_Record', async () => {
  const { deps, seen } = setup(new BrowserLoadError('model_load_failed', 'page.evaluate: TypeError: network error'));
  assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 1);
  assert.equal(fs.existsSync(deps.paths.exclusions) ? readExclusions(deps.paths.exclusions).length : 0, 0);
  assert.equal(fs.existsSync(preflightPath(deps.paths.resultsDir, TF.id)), false);
  const lines = fs.readFileSync(attemptsPath(deps.paths.resultsDir), 'utf8').split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(rec['verdict'], 'no_verdict');
  assert.match(String(rec['error']), /network error/);
  assert.equal(seen.closed, 1);
});
