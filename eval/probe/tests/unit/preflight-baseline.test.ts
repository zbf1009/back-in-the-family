// Hybrid-GPU baseline detail of the VRAM_Preflight (llm-probe task 19.3): idle series median, idle spread,
// absolute peak, nvidia-smi process parsing, and the flags. No browser, no nvidia-smi.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PreflightMeasurement } from '../../src/browser/driver.ts';
import { NvidiaPeakSampler, medianMib, parseComputeApps, parseNvidiaSmiTable } from '../../src/browser/perf.ts';
import { memoryDetail } from '../../src/preflight.ts';

test('idle series: baseline is the median, spread and absolute peak are recorded', async () => {
  const readings = [310, 300, 305, 900, 1400, 1100, 800];
  let ticks: (() => void) | null = null;
  const sampler = new NvidiaPeakSampler(
    { read: async () => readings.shift() ?? null },
    { every: (_ms, fn) => ((ticks = fn), () => undefined) },
    250,
    3,
  );
  await sampler.start();
  for (let i = 0; i < 3; i++) {
    (ticks as (() => void) | null)?.();
    await new Promise((r) => setImmediate(r));
  }
  const r = (await sampler.stop()) as Record<string, unknown>;
  assert.equal(r['baseline_mib'], 305);
  assert.equal(r['idle_min_mib'], 300);
  assert.equal(r['idle_max_mib'], 310);
  assert.equal(r['absolute_peak_mib'], 1400);
  assert.equal(r['run_min_mib'], 800);
  assert.equal(r['peak_mib'], 1095); // 1400 - 305
});

test('medianMib handles odd and even counts', () => {
  assert.equal(medianMib([5, 1, 3]), 3);
  assert.equal(medianMib([1, 2]), 2);
});

test('nvidia-smi process parsing keeps names and MiB only', () => {
  assert.deepEqual(parseComputeApps('1234, /opt/google/chrome/chrome, 120\n'), [{ pid: 1234, type: 'C', name: '/opt/google/chrome/chrome', mib: 120 }]);
  assert.deepEqual(parseComputeApps(''), []);
  const table = ['| Processes:', '|    0   N/A  N/A      1500      G   /usr/lib/xorg/Xorg                 4MiB |', '|    0   N/A  N/A      2000    C+G   chrome --type=gpu          120MiB |'].join('\n');
  assert.deepEqual(parseNvidiaSmiTable(table), [
    { pid: 1500, type: 'G', name: '/usr/lib/xorg/Xorg', mib: 4 },
    { pid: 2000, type: 'C+G', name: 'chrome --type=gpu', mib: 120 },
  ]);
});

const meas = (mem: Record<string, unknown>): PreflightMeasurement =>
  ({ memory: { gpu: 'nvidia', quantity: 'q', peak_mib: 1, reason: null, ...mem } }) as unknown as PreflightMeasurement;

test('flags: over the card, low headroom, idle drift, dip during the run', () => {
  const ok = memoryDetail(meas({ baseline_mib: 100, idle_min_mib: 95, idle_max_mib: 105, run_min_mib: 90, absolute_peak_mib: 2000 }));
  assert.deepEqual(ok['memory_flags'], []);
  const low = memoryDetail(meas({ baseline_mib: 100, idle_min_mib: 100, idle_max_mib: 100, run_min_mib: 100, absolute_peak_mib: 3900 }));
  assert.equal((low['memory_flags'] as string[]).length, 1);
  assert.match((low['memory_flags'] as string[])[0] as string, /headroom/);
  const over = memoryDetail(meas({ baseline_mib: 100, idle_min_mib: 100, idle_max_mib: 100, run_min_mib: 100, absolute_peak_mib: 4100 }));
  assert.match((over['memory_flags'] as string[])[0] as string, /exceeds/);
  const noisy = memoryDetail(meas({ baseline_mib: 500, idle_min_mib: 300, idle_max_mib: 500, run_min_mib: 200, absolute_peak_mib: 2000 }));
  assert.equal((noisy['memory_flags'] as string[]).length, 2);
});

// ---------------------------------------------------------------- console OOM, CPU classes, options hash (Author, 2026-11-07)

import { consoleOomLine } from '../../src/browser/driver.ts';
import { judgePreflight, type PreflightPrompt } from '../../src/preflight.ts';
import type { Combination } from '../../src/phase.ts';

test('consoleOomLine finds Vulkan / Dawn / ORT memory lines, strips colours, ignores ordinary lines', () => {
  assert.equal(consoleOomLine(['Starting program "x"', 'ok']), null);
  assert.match(consoleOomLine(['a', '\u001b[31m[E] vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY\u001b[0m'])!, /^\[E\] vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY$/);
  assert.notEqual(consoleOomLine(['Failed to allocate memory for requested buffer']), null);
  assert.notEqual(consoleOomLine(['Dawn: Device lost: reason']), null);
});

test('the preflight record carries the CPU classes, the options hash and a failure_class', () => {
  const combo = { id: 'transformers.js/x/nvidia', runtime: 'transformers.js', model_id: 'o/x', revision: 'a'.repeat(40) } as unknown as Combination;
  const prompt = { prompt: { system: 's', user: 'u' }, bytes: 9000, targetBytes: 9000, longestDevPromptBytes: 1, eventCount: 1, personCount: 1, sha256: '0'.repeat(64) } as PreflightPrompt;
  const cpu = [{ op_type: 'Gather', count: 64 }, { op_type: 'Scan', count: 18 }];
  const measurement = {
    adapter: { vendor: 'nvidia' },
    placement: { method: 'onnxruntime_node_placements', cpu_nodes: cpu },
    memory: { gpu: 'nvidia', quantity: 'q', peak_mib: 900, reason: null },
    run: { ok: false, error: 'Invalid Buffer is invalid due to a previous error' },
  } as unknown as PreflightMeasurement;
  const v = judgePreflight({
    combo, at: 't', prompt, attempt: { kind: 'measured', measurement }, versions: {}, browser: {}, adapter: null,
    adapterFacts: { placement_check: { probe_sha256: 'h', measured_sha256: 'h' } },
  });
  assert.equal(v.verdict, 'no_verdict');
  assert.deepEqual(v.record['cpu_nodes_shape'], [{ op_type: 'Gather', count: 64 }]);
  assert.deepEqual(v.record['cpu_nodes_compute'], [{ op_type: 'Scan', count: 18 }]);
  assert.equal(v.record['placement_options_sha256'], 'h');
  assert.equal(v.record['placement_options_match'], true);
  assert.equal(v.record['failure_class'], 'runtime_error');
  assert.match(String(v.record['error']), /previous error/);
});
