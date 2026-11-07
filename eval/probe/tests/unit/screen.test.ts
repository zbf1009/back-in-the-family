import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Combination, CombinationSize } from '../../src/phase.ts';
import { screenCombinations, screenOne, sumTreeBytes, type ScreenOptions } from '../../src/screen.ts';

const REV = 'c'.repeat(40);
const LIB = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${'d'.repeat(40)}/m.wasm`;
const MIB = 1024 * 1024;
const AT = '2026-11-07T00:00:00Z';

type SizeOverride = { [K in keyof CombinationSize]?: CombinationSize[K] };
const combo = (o: Omit<Partial<Combination>, 'size'> & { size?: SizeOverride } = {}): Combination => {
  const { size, ...rest } = o;
  return {
    id: 'webllm/x', runtime: 'webllm', model_id: 'M', quantization: 'q4f32_1', revision: REV, model_lib_url: LIB, phase1_locked: true,
    size: { expected_download_bytes: 500 * MIB, download_source: '', params: 800_000_000, params_source: '', vram_mib: 1894.19, vram_source: '', ...size },
    ...rest,
  } as Combination;
};

test('a fully known, pinned, small Combination passes', () => {
  assert.equal(screenOne(combo(), 500 * MIB, AT), null);
});

test('limits are inclusive; first failed check wins with its value', () => {
  assert.equal(screenOne(combo({ size: { vram_mib: 2600 } }), 1536 * MIB, AT), null);
  const r = screenOne(combo({ size: { vram_mib: 2600.5, params: 9e9 } }), 1, AT);
  assert.deepEqual([r?.check, r?.value, r?.limit, r?.model, r?.combination], ['vram', 2600.5, 2600, 'M', 'webllm/x']);
  assert.equal(screenOne(combo({ size: { params: 2_300_000_001 } }), 1, AT)?.check, 'params');
  assert.deepEqual([screenOne(combo(), 1536 * MIB + 1, AT)?.check, screenOne(combo(), 1536 * MIB + 1, AT)?.value], ['download', 1536 * MIB + 1]);
});

test('unknown figures are exclusions with value "unknown"', () => {
  assert.equal(screenOne(combo({ size: { vram_mib: null } }), 1, AT)?.value, 'unknown');
  assert.equal(screenOne(combo({ size: { params: null } }), 1, AT)?.value, 'unknown');
  assert.deepEqual([screenOne(combo(), null, AT)?.check, screenOne(combo(), null, AT)?.value], ['download', 'unknown']);
});

test('unpinned revision and model library URL', () => {
  const a = screenOne(combo({ revision: 'unpinned' }), 1, AT);
  assert.deepEqual([a?.check, a?.value], ['unpinned', 'unpinned']);
  const b = screenOne(combo({ model_lib_url: null as unknown as string }), 1, AT);
  assert.deepEqual([b?.check, b?.value], ['unpinned', 'unknown']);
  const c = screenOne(combo({ model_lib_url: 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/m.wasm' }), 1, AT);
  assert.equal(c?.check, 'unpinned');
  // transformers.js needs no model library URL
  assert.equal(screenOne(combo({ runtime: 'transformers.js', model_lib_url: null as unknown as string, size: { vram_mib: 1000 } }), 1, AT), null);
});

test('transformers.js without a VRAM figure waits for the preflight', () => {
  const t = combo({ id: 't', runtime: 'transformers.js', size: { vram_mib: null } });
  assert.equal(screenOne(t, 1, AT), null);
  assert.equal(screenOne(t, 1, AT, { loaded_on_webgpu: true, peak_vram_mib: 2000 }), null);
  assert.equal(screenOne(t, 1, AT, { loaded_on_webgpu: false, peak_vram_mib: null })?.check, 'preflight_load');
  assert.deepEqual([screenOne(t, 1, AT, { loaded_on_webgpu: true, peak_vram_mib: 2601 })?.check, screenOne(t, 1, AT, { loaded_on_webgpu: true, peak_vram_mib: 2601 })?.value], ['preflight_vram', 2601]);
});

test('screenCombinations: injected fetch only for pinned, unsized Combinations; Workers AI skipped; one record each', async () => {
  const calls: string[] = [];
  const opts: ScreenOptions = { at: AT, fetchDownloadBytes: async (c) => { calls.push(c.id); if (c.id === 'boom') throw new Error('net'); return c.id === 'big' ? 2000 * MIB : 100 * MIB; } };
  const list = [
    combo({ id: 'ok', size: { expected_download_bytes: null } }),
    combo({ id: 'big', size: { expected_download_bytes: null } }),
    combo({ id: 'boom', size: { expected_download_bytes: null } }),
    combo({ id: 'unp', revision: 'unpinned', size: { expected_download_bytes: null } }),
    { id: 'w', runtime: 'workers-ai', model_id: 'W', quantization: '', revision: '', phase1_locked: false } as Combination,
  ];
  const res = await screenCombinations(list, opts);
  assert.deepEqual(calls, ['ok', 'big', 'boom']);
  assert.deepEqual(res.map((r) => [r.combination.id, r.exclusion?.check ?? null, r.exclusion?.value ?? null]), [
    ['ok', null, null], ['big', 'download', 2000 * MIB], ['boom', 'download', 'unknown'], ['unp', 'download', 'unknown'],
  ]);
});

test('sumTreeBytes: WebLLM sums repo files; transformers.js only the q4 text path', () => {
  const files = [
    { path: 'a.json', size: 1 }, { path: 'README.md', size: 10 }, { path: '.gitattributes', size: 10 },
    { path: 'onnx/decoder_model_merged_q4.onnx', size: 100 }, { path: 'onnx/decoder_model_merged_q4.onnx_data', size: 1000 },
    { path: 'onnx/embed_tokens_q4.onnx', size: 7 }, { path: 'onnx/embed_tokens_q4.onnx_data_1', size: 70 },
    { path: 'onnx/vision_encoder_q4.onnx', size: 300 }, { path: 'onnx/vision_encoder_q4.onnx_data', size: 3000 },
    { path: 'onnx/decoder_model_merged_fp16.onnx', size: 5000 },
  ];
  assert.equal(sumTreeBytes('webllm', files), 9478);
  assert.equal(sumTreeBytes('transformers.js', files), 1178);
});

test('sumTreeBytes: LFM2.5 layout counts the single model_q4 files', () => {
  const files = [{ path: 'tokenizer.json', size: 5 }, { path: 'onnx/model_q4.onnx', size: 50 }, { path: 'onnx/model_q4.onnx_data', size: 500 }, { path: 'onnx/model_fp16.onnx', size: 9000 }];
  assert.equal(sumTreeBytes('transformers.js', files), 555);
});
