import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPinnedFetch } from '../../src/browser/pinned-fetch.ts';

const REV = 'a'.repeat(40);
const LIB = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${'b'.repeat(40)}/qwen.wasm`;
const pin = { revision: REV, model_lib_url: LIB };
const hf = (r: string) => `https://huggingface.co/mlc-ai/m/resolve/${r}/params.bin`;

test('pinned requests, other hosts and CDN redirect targets pass', () => {
  const urls = [hf(REV), LIB, 'http://localhost:4173/index.html', 'https://cdn-lfs.huggingface.co/x/y', 'data:text/plain,hi'];
  assert.deepEqual(checkPinnedFetch(urls, pin), { ok: true });
  assert.deepEqual(checkPinnedFetch([], pin), { ok: true });
});

test('a huggingface.co request without /resolve/<revision>/ fails with unpinned_fetch', () => {
  for (const bad of [hf('main'), 'https://huggingface.co/api/models/x', `https://huggingface.co/mlc-ai/m/resolve/${REV}`]) {
    assert.deepEqual(checkPinnedFetch([hf(REV), bad], pin), { ok: false, code: 'model_load_failed', detail: 'unpinned_fetch', offending: [bad] });
  }
});

test('a model-library request that differs from model_lib_url fails', () => {
  const other = LIB.replace('qwen.wasm', 'other.wasm');
  const r = checkPinnedFetch([other], pin);
  assert.equal(r.ok, false);
  assert.equal(checkPinnedFetch([LIB], { revision: REV, model_lib_url: null }).ok, false);
});

test('a same-host resolve-cache redirect target passes only with the pinned commit in its path (real form, 2026-11-07)', () => {
  const rc = (sha: string, q: string) => `https://huggingface.co/api/resolve-cache/models/org/M-ONNX/${sha}/tokenizer_config.json?%2Forg%2FM-ONNX%2Fresolve%2F${q}%2Ftokenizer_config.json=&etag=%221a%22`;
  assert.deepEqual(checkPinnedFetch([rc(REV, REV)], pin), { ok: true });
  const other = rc('c'.repeat(40), 'main');
  assert.equal(checkPinnedFetch([other], pin).ok, false);
  // `/resolve/<rev>/` only counts in the path, not in an encoded query
  const q = `https://huggingface.co/api/models/x?u=/resolve/${REV}/`;
  assert.equal(checkPinnedFetch([q], pin).ok, false);
});
