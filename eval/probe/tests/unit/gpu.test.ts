import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAdapter, type GpuLike, type GpuAdapterLike } from '../../src/adapters/gpu.ts';

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
