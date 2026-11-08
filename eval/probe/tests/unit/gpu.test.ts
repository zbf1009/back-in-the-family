import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAdapter, pinLowPowerAdapter, type GpuLike, type GpuAdapterLike } from '../../src/adapters/gpu.ts';

const gpuOf = (adapter: GpuAdapterLike | null, seen: unknown[] = []): GpuLike => ({
  requestAdapter: async (o) => {
    seen.push(o);
    return adapter;
  },
});

test('hardware adapter: strings recorded as reported, powerPreference passed through', async () => {
  const seen: unknown[] = [];
  const info = { vendor: 'nvidia', architecture: 'ada', device: '', description: 'NVIDIA GeForce RTX 4060' };
  const r = await checkAdapter(gpuOf({ info }, seen), 'high-performance');
  assert.deepEqual(seen, [{ powerPreference: 'high-performance' }]);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.info, { ...info, is_fallback_adapter: false });
});

test('missing navigator.gpu and a null adapter are gpu_unavailable', async () => {
  for (const gpu of [undefined, null, gpuOf(null)]) {
    const r = await checkAdapter(gpu, 'low-power');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'gpu_unavailable');
  }
});

test('google/swiftshader and isFallbackAdapter are software_adapter', async () => {
  const sw = await checkAdapter(gpuOf({ info: { vendor: 'google', architecture: 'swiftshader' } }), 'high-performance');
  const fb = await checkAdapter(gpuOf({ info: { vendor: 'intel', architecture: 'gen-12lp', isFallbackAdapter: true } }), 'low-power');
  const fbOld = await checkAdapter(gpuOf({ isFallbackAdapter: true, requestAdapterInfo: async () => ({ vendor: 'x' }) }), 'low-power');
  for (const r of [sw, fb, fbOld]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'software_adapter');
  }
});

test('google with another architecture is accepted; legacy requestAdapterInfo is read', async () => {
  const r = await checkAdapter(gpuOf({ requestAdapterInfo: async () => ({ vendor: 'google', architecture: 'other' }) }), 'low-power');
  assert.equal(r.ok, true);
});

test('requestAdapter throwing is gpu_unavailable', async () => {
  const r = await checkAdapter({ requestAdapter: async () => { throw new Error('boom'); } }, 'low-power');
  assert.equal(r.ok === false && r.code, 'gpu_unavailable');
});

test('pinLowPowerAdapter forces low-power on later engine calls; high-performance Combinations are untouched', async () => {
  const seen: unknown[] = [];
  const gpu = gpuOf({ info: { vendor: 'intel' } }, seen);
  assert.equal(pinLowPowerAdapter(gpu, 'high-performance'), false);
  await gpu.requestAdapter();
  assert.deepEqual(seen, [undefined]); // not wrapped

  assert.equal(pinLowPowerAdapter(gpu, 'low-power'), true);
  assert.equal(pinLowPowerAdapter(gpu, 'low-power'), false); // idempotent
  await gpu.requestAdapter(); // what WebLLM does with no argument
  await gpu.requestAdapter({ powerPreference: 'high-performance' }); // what WebLLM's detectGPUDevice does
  assert.deepEqual(seen.slice(1), [{ powerPreference: 'low-power' }, { powerPreference: 'low-power' }]);
  assert.equal(pinLowPowerAdapter(undefined, 'low-power'), false);
});
