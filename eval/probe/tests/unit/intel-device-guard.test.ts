// The Intel iGPU run is guarded by an NVIDIA memory.used watch: a rise above DEVICE_MISMATCH_MIB means the work
// ran on the NVIDIA card although the browser reported the Intel adapter (llm-probe task 20.6).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markInvalid, loadInvalidDevRuns } from '../../src/report-command.ts';
import type { PerfRecord } from '../../src/results.ts';
import { DEVICE_MISMATCH_MIB, deviceMismatchOf, memoryMeasurementFor } from '../../src/browser/perf.ts';

async function intelRun(nvidiaReadings: Array<number | null>): Promise<Record<string, unknown>> {
  const readings = [...nvidiaReadings];
  let tick: (() => void) | null = null;
  const m = memoryMeasurementFor('intel', {
    reader: { read: async () => readings.shift() ?? null },
    scheduler: { every: (_ms, fn) => ((tick = fn), () => undefined) },
    proc: { listPids: async () => [7], cmdline: async () => 'chrome --type=gpu-process --user-data-dir=/p', status: async () => 'VmHWM:\t 800000 kB\n' },
    profileDir: '/p',
  });
  await m.start();
  for (let i = 0; i < nvidiaReadings.length - 2; i++) {
    (tick as unknown as () => void)();
    await new Promise((r) => setImmediate(r));
  }
  return (await m.stop()) as Record<string, unknown>;
}

test('NVIDIA memory flat during an Intel run: no mismatch, Intel figure kept', async () => {
  const r = await intelRun([44, 44, 58, 44, 44]);
  assert.equal(r['gpu'], 'intel');
  assert.equal(r['peak_mib'], 782); // 800000 kB = 781.25 MiB, rounded up
  assert.equal(r['device_mismatch'], false);
  assert.equal((r['nvidia_watch'] as Record<string, unknown>)['peak_delta_mib'], 14);
});

test('NVIDIA memory rising by the model size during an Intel run: device_mismatch', async () => {
  const r = await intelRun([44, 44, 900, 1813, 1813]);
  assert.equal(r['gpu'], 'intel');
  assert.equal(r['device_mismatch'], true);
  assert.equal((r['nvidia_watch'] as Record<string, unknown>)['peak_delta_mib'], 1769);
});

test('no nvidia-smi reading: the verdict is unknown (null), not a pass', async () => {
  const r = await intelRun([null, null, null, null]);
  assert.equal(r['device_mismatch'], null);
});

test('threshold edge', () => {
  assert.equal(deviceMismatchOf(DEVICE_MISMATCH_MIB), false);
  assert.equal(deviceMismatchOf(DEVICE_MISMATCH_MIB + 1), true);
  assert.equal(deviceMismatchOf(null), null);
});

test('a Dev_Run listed in invalid-dev-runs.json is marked device_mismatch for the Report; a missing file lists nothing', () => {
  const perf = { schema: 'llm-probe-perf-v1', run_kind: 'dev', fresh_profile: true, memory: { gpu: 'intel', quantity: 'q', peak_mib: 783, reason: null } } as unknown as PerfRecord;
  const marked = markInvalid(perf, true) as unknown as { memory: Record<string, unknown> };
  assert.equal(marked.memory['device_mismatch'], true);
  assert.equal(marked.memory['peak_mib'], 783); // the original figure stays in the record; the Report refuses to show it
  assert.equal(markInvalid(perf, false), perf);
  assert.equal(markInvalid(null, true), null);
  assert.equal(loadInvalidDevRuns('/nonexistent/invalid-dev-runs.json').size, 0);
});
