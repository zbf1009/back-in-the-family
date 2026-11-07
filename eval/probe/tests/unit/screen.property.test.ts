import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { checkAdapter, type GpuAdapterInfoLike } from '../../src/adapters/gpu.ts';
import { parsePlacement } from '../../src/adapters/placement.ts';
import { checkPinnedFetch } from '../../src/browser/pinned-fetch.ts';
import { deriveEntries, LEDGER_SCHEMA, type LedgerEvent } from '../../src/ledger.ts';
import { browserPass, overDownloadLimit, type Combination, type PhaseState } from '../../src/phase.ts';
import { screenCombinations, screenOne, type PreflightOutcome } from '../../src/screen.ts';

// Feature: llm-probe, Property 36: Only hardware WebGPU and fitting models run
// **Validates: Requirements 9.3, 9.6, 9.8, 9.10, 9.11, 9.15, 9.17, 10.6**

const MIB = 1024 * 1024;
const AT = '2026-11-07T00:00:00Z';
const hex40 = fc.stringMatching(/^[0-9a-f]{40}$/);
const LIB_OK = (sha: string): string => `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${sha}/m.wasm`;

// ---------------------------------------------------------------- (a), (b) screening

const figure = (limit: number): fc.Arbitrary<number | null> =>
  fc.oneof({ weight: 1, arbitrary: fc.constant(null) }, { weight: 2, arbitrary: fc.constantFrom(limit, limit + 1, limit - 1) }, { weight: 3, arbitrary: fc.integer({ min: 0, max: limit * 2 }) });

const comboArb = fc
  .record({
    runtime: fc.constantFrom('webllm', 'transformers.js'),
    vram: figure(2600),
    params: figure(2_300_000_000),
    revision: fc.oneof(hex40, fc.constantFrom('unpinned', '', 'main', 'a'.repeat(39))),
    lib: fc.oneof(hex40.map(LIB_OK), fc.constantFrom('', 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/m.wasm'), fc.constant(null)),
    dl: fc.oneof(fc.constant(null), fc.constantFrom(1536 * MIB, 1536 * MIB + 1), fc.integer({ min: 0, max: 3000 * MIB })),
    pre: fc.option(fc.record({ loaded_on_webgpu: fc.boolean(), peak_vram_mib: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 5200 })) }), { nil: undefined }),
  })
  .map(({ runtime, vram, params, revision, lib, dl, pre }) => ({
    combo: {
      id: `${runtime}/x`, runtime, model_id: 'M', quantization: 'q4', revision, model_lib_url: lib, phase1_locked: true,
      size: { expected_download_bytes: dl, download_source: '', params, params_source: '', vram_mib: vram, vram_source: '' },
    } as unknown as Combination,
    dl,
    pre: pre as PreflightOutcome | undefined,
  }));

/** Independent statement of the rule: the first failed check, or null (run), or 'pending'. */
function oracle(c: Combination, dl: number | null, pre: PreflightOutcome | undefined): [string, number | string] | null | 'pending' {
  const tjs = c.runtime === 'transformers.js';
  const vram = c.size?.vram_mib ?? null;
  if (!(tjs && vram === null) && (vram === null || vram > 2600)) return ['vram', vram ?? 'unknown'];
  const params = c.size?.params ?? null;
  if (params === null || params > 2_300_000_000) return ['params', params ?? 'unknown'];
  if (dl === null || dl > 1536 * MIB) return ['download', dl ?? 'unknown'];
  if (!/^[0-9a-f]{40}$/.test(c.revision)) return ['unpinned', c.revision === '' ? 'unknown' : c.revision];
  if (c.runtime === 'webllm' && !(typeof c.model_lib_url === 'string' && /^https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/[0-9a-f]{40}\//.test(c.model_lib_url))) {
    return ['unpinned', typeof c.model_lib_url === 'string' && c.model_lib_url !== '' ? c.model_lib_url : 'unknown'];
  }
  if (tjs && vram === null) {
    if (pre === undefined) return 'pending';
    if (!pre.loaded_on_webgpu) return ['preflight_load', 'not loaded on WebGPU'];
    if (pre.peak_vram_mib === null || pre.peak_vram_mib > 2600) return ['preflight_vram', pre.peak_vram_mib ?? 'unknown'];
  }
  return null;
}

test('screenOne: runs exactly when every check passes; else one record naming the first failed check', () => {
  fc.assert(
    fc.property(comboArb, ({ combo, dl, pre }) => {
      const want = oracle(combo, dl, pre);
      const got = screenOne(combo, dl, AT, pre);
      if (want === null || want === 'pending') assert.equal(got, null);
      else {
        assert.notEqual(got, null);
        assert.deepEqual([got?.check, got?.value], want);
      }
    }),
    { numRuns: 300 },
  );
});

test('screenCombinations: one record per failing in-browser Combination, Workers AI never screened', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(comboArb, { minLength: 1, maxLength: 6 }), fc.boolean(), async (items, withWai) => {
      const combos = items.map((it, i) => ({ ...it.combo, id: `c${i}` }));
      const wai = { id: 'wai', runtime: 'workers-ai', model_id: '@cf/a', quantization: '', revision: 'server-side, not pinnable', phase1_locked: false, size: { vram_mib: 99999, params: 9e12 } } as unknown as Combination;
      const all = withWai ? [...combos, wai] : combos;
      const preflight = new Map<string, PreflightOutcome>();
      items.forEach((it, i) => it.pre && preflight.set(`c${i}`, it.pre));
      const res = await screenCombinations(all, { at: AT, preflight });
      assert.equal(res.length, combos.length);
      assert.ok(res.every((r) => r.combination.id !== 'wai'));
      res.forEach((r, i) => {
        const it = items[i]!;
        const dl = it.combo.size?.expected_download_bytes ?? null;
        const want = oracle(combos[i]!, dl, it.pre);
        if (want === null || want === 'pending') assert.equal(r.exclusion, null);
        else assert.deepEqual([r.exclusion?.check, r.exclusion?.value, r.exclusion?.combination], [want[0], want[1], `c${i}`]);
      });
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------- (a) adapter

const strArb = fc.constantFrom('', 'google', 'swiftshader', 'nvidia', 'ada', 'intel', 'gen-12');
test('checkAdapter accepts only an existing, non-software, non-fallback adapter', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(fc.constant('missing' as const), fc.constant('null' as const), fc.constant('adapter' as const)),
      fc.record({ vendor: strArb, architecture: strArb, isFallbackAdapter: fc.boolean() }),
      fc.boolean(),
      async (kind, info, topLevelFlag) => {
        const adapter = kind === 'adapter' ? { info: info as GpuAdapterInfoLike, isFallbackAdapter: topLevelFlag } : null;
        const gpu = kind === 'missing' ? undefined : { requestAdapter: async () => adapter };
        const r = await checkAdapter(gpu, 'high-performance');
        const software = info.isFallbackAdapter || topLevelFlag || (info.vendor === 'google' && info.architecture === 'swiftshader');
        assert.equal(r.ok, kind === 'adapter' && !software);
        if (kind !== 'adapter') assert.equal(!r.ok && r.code, 'gpu_unavailable');
        else if (software) assert.equal(!r.ok && r.code, 'software_adapter');
      },
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------- (c) over-limit download

test('a Combination whose measured download is over the limit is never a browser pass', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 3000 * MIB }), fc.constantFrom(1536 * MIB, 1536 * MIB + 1), (measured, edge) => {
      const combo = { id: 'webllm/p', runtime: 'webllm', model_id: 'P', quantization: 'q4', revision: 'a'.repeat(40), phase1_locked: true } as Combination;
      const events: LedgerEvent[] = [
        { schema: LEDGER_SCHEMA, event: 'start', entry_id: 'L-1', model_key: { runtime: combo.runtime, model_id: combo.model_id, quantization: combo.quantization, revision: combo.revision }, combination: combo.id, task_subset: 'DS', fingerprint: {}, template_hashes: {}, started_at: '2026-11-01T09:00:00Z', rerun_of: null, rerun_reason: null, overlaps: [], approval: null, planned: { decision: 1, synthesis: 1 } } as LedgerEvent,
        { schema: LEDGER_SCHEMA, event: 'complete', entry_id: 'L-1', ended_at: '2026-11-01T09:00:00Z', results: 'x', requests_sent: 2 } as LedgerEvent,
      ];
      for (const m of [measured, edge]) {
        const over = overDownloadLimit(m);
        assert.equal(over, m > 1536 * MIB);
        const state = {
          combinations: [combo], entries: deriveEntries(events), failures: [], exclusions: [], smoke: [], approvals: { approved: true, approvals: [] },
          passes: new Map([['L-1', { decision: true, synthesis: true }]]), overLimit: new Set(over ? [combo.id] : []),
        } as unknown as PhaseState;
        assert.equal(browserPass(combo, 'decision', state), !over);
        assert.equal(browserPass(combo, 'synthesis', state), !over);
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------- (d) placement

const P = '[V:onnxruntime:, session_state.cc:1598 VerifyEachNodeIsAssignedToAnEp] ';
const opArb = fc.constantFrom('Shape', 'Gather', 'Cast', 'Reshape', 'Add');
test('placement: no block, no WebGPU, and CPU-placed nodes flagged with exact counts but still run', () => {
  assert.deepEqual(parsePlacement([]), { ok: false, code: 'placement_not_logged', detail: 'no "Node placements" block in the console log' });
  fc.assert(
    fc.property(fc.array(opArb, { maxLength: 12 }), fc.integer({ min: 1, max: 500 }), fc.boolean(), fc.boolean(), (cpuOps, nWeb, webgpu, prefix) => {
      const pre = prefix ? P : '';
      const lines = [`${pre}Node placements`];
      if (cpuOps.length > 0) {
        lines.push(`${pre} Node(s) placed on [CPUExecutionProvider]. Number of nodes: ${cpuOps.length}`);
        cpuOps.forEach((op, i) => lines.push(`${pre}  ${op} (/n/${i})`));
      }
      lines.push(`${pre} Node(s) placed on [${webgpu ? 'WebGpuExecutionProvider' : 'XnnpackExecutionProvider'}]. Number of nodes: ${nWeb}`);
      const r = parsePlacement(lines);
      if (!webgpu) {
        assert.equal(r.ok, false);
        assert.equal(!r.ok && r.code, 'backend_not_webgpu');
      } else {
        const counts = new Map<string, number>();
        for (const op of cpuOps) counts.set(op, (counts.get(op) ?? 0) + 1);
        const want = [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([op_type, count]) => ({ op_type, count }));
        assert.equal(r.ok, true); // CPU nodes are flagged, not failed (R9.1)
        assert.deepEqual(r.ok && r.placement.cpu_nodes, want);
      }
    }),
    { numRuns: 150 },
  );
});

// ---------------------------------------------------------------- (e) pinned fetch

test('pinned fetch fails exactly on an unpinned huggingface.co or model-library request', () => {
  fc.assert(
    fc.property(
      hex40, hex40, hex40,
      fc.array(fc.constantFrom('hf-ok', 'hf-bad', 'hf-other-rev', 'lib-ok', 'lib-bad', 'cdn', 'other'), { maxLength: 8 }),
      (rev, otherRev, sha, kinds) => {
        fc.pre(rev !== otherRev);
        const lib = LIB_OK(sha);
        const url = (k: string, i: number): string => {
          switch (k) {
            case 'hf-ok': return `https://huggingface.co/org/m/resolve/${rev}/f${i}.bin`;
            case 'hf-bad': return `https://huggingface.co/org/m/resolve/main/f${i}.bin`;
            case 'hf-other-rev': return `https://huggingface.co/org/m/resolve/${otherRev}/f${i}.bin`;
            case 'lib-ok': return lib;
            case 'lib-bad': return `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/m${i}.wasm`;
            case 'cdn': return `https://cdn-lfs.hf.co/repos/ab/f${i}?X-Amz=1`;
            default: return `https://example.com/page${i}`;
          }
        };
        const urls = kinds.map(url);
        const bad = kinds.filter((k) => k === 'hf-bad' || k === 'hf-other-rev' || k === 'lib-bad').length;
        const r = checkPinnedFetch(urls, { revision: rev, model_lib_url: lib });
        assert.equal(r.ok, bad === 0);
        if (!r.ok) {
          assert.deepEqual([r.code, r.detail, r.offending.length], ['model_load_failed', 'unpinned_fetch', bad]);
        }
      },
    ),
    { numRuns: 150 },
  );
});
