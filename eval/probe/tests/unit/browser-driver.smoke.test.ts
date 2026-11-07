// Smoke tests of the browser driver's pure helpers and of one offline session with fakes (task 16.8).
// No browser is started, no request is made and nvidia-smi is not run. The example tests are task 16.10.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Combination } from '../../src/phase.ts';
import { fingerprintOf } from '../../src/browser/factory.ts';
import { BrowserSession, HEADLESS_LAUNCH_FLAGS, type DriverPage, type SessionDeps } from '../../src/browser/driver.ts';
import {
  ByteCounter,
  INTEL_MEMORY_QUANTITY,
  NvidiaPeakSampler,
  classifyRequest,
  findGpuProcessPid,
  parseNvidiaSmiMemoryUsed,
  parseVmHwmMib,
  peakDeltaMib,
} from '../../src/browser/perf.ts';
import { resolveRequestPath } from '../../src/browser/server.ts';

const LOCAL = 'http://127.0.0.1:4000';

test('the headless launch flags are exactly the three documented ones', () => {
  assert.deepEqual([...HEADLESS_LAUNCH_FLAGS], ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan']);
});

test('byte classification by host and local asset name', () => {
  assert.equal(classifyRequest('https://huggingface.co/o/m/resolve/abc/model.onnx', LOCAL), 'model');
  assert.equal(classifyRequest('https://cdn-lfs-us-1.hf.co/repos/x', LOCAL), 'model');
  assert.equal(classifyRequest('https://cas-bridge.xethub.hf.co/y', LOCAL), 'model');
  assert.equal(classifyRequest('https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/sha/lib.wasm', LOCAL), 'runtime');
  assert.equal(classifyRequest(`${LOCAL}/assets/ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm`, LOCAL), 'runtime');
  assert.equal(classifyRequest(`${LOCAL}/assets/lib-BkBIntl4.js`, LOCAL), 'runtime');
  assert.equal(classifyRequest(`${LOCAL}/assets/index-cy4ixN6L.js`, LOCAL), 'local');
  assert.equal(classifyRequest(`${LOCAL}/`, LOCAL), 'local');
  assert.equal(classifyRequest('data:text/plain,hi', LOCAL), null);
  assert.equal(classifyRequest('https://evilhuggingface.co/x', LOCAL), 'runtime');
});

test('a frozen counter ignores later requests', () => {
  const c = new ByteCounter();
  c.noteStart('model', 100);
  c.add('model', 1000, 600);
  c.freeze();
  c.add('model', 5000, 900);
  assert.deepEqual(c.figures(), { model_bytes: 1000, runtime_bytes: 0, local_bytes: 0, duration_ms: 500 });
});

test('sampler peak is the largest reading minus the idle baseline', async () => {
  const readings = [500, 900, 1400, 1100, 800];
  let ticks: (() => void) | null = null;
  const sampler = new NvidiaPeakSampler(
    { read: async () => readings.shift() ?? null },
    { every: (_ms, fn) => ((ticks = fn), () => undefined) },
  );
  await sampler.start(); // baseline 500
  for (let i = 0; i < 3; i++) {
    (ticks as unknown as () => void)();
    await new Promise((r) => setImmediate(r));
  }
  const r = await sampler.stop(); // reads 1100
  assert.equal(r.peak_mib, 900); // 1400 - 500
  assert.equal(r.quantity, 'NVIDIA device memory.used delta');
  assert.equal(peakDeltaMib(500, []), null);
  assert.equal(peakDeltaMib(500, [300]), 0);
});

test('nvidia-smi and /proc parsing', async () => {
  assert.equal(parseNvidiaSmiMemoryUsed('1234\n'), 1234);
  assert.equal(parseNvidiaSmiMemoryUsed('N/A\n'), null);
  assert.equal(parseVmHwmMib('Name:\tchrome\nVmHWM:\t  2048 kB\n'), 2);
  const pid = await findGpuProcessPid(
    {
      listPids: async () => [10, 20, 30],
      cmdline: async (p) => (p === 20 ? 'chrome --type=gpu-process --user-data-dir=/tmp/p1 x' : p === 30 ? 'chrome --type=gpu-process --user-data-dir=/tmp/other' : 'chrome'),
      status: async () => '',
    },
    '/tmp/p1',
  );
  assert.equal(pid, 20);
  assert.match(INTEL_MEMORY_QUANTITY, /excludes unmapped GEM buffers/);
});

test('static server path resolution stays below the root', () => {
  assert.equal(resolveRequestPath('/srv/dist', '/'), '/srv/dist/index.html');
  assert.equal(resolveRequestPath('/srv/dist', '/assets/a.js?x=1'), '/srv/dist/assets/a.js');
  assert.equal(resolveRequestPath('/srv/dist', '/../etc/passwd'), null);
  assert.equal(resolveRequestPath('/srv/dist', '/%2e%2e/etc/passwd'), null);
});

// ---------------------------------------------------------------- one offline session

function fakeDeps(opts: { quota: number; calls: string[]; removed: string[] }): SessionDeps {
  const handlers: { request: ((u: string) => void)[]; finished: ((u: string, b: () => Promise<number>) => void)[] } = { request: [], finished: [] };
  const page: DriverPage = {
    goto: async () => void opts.calls.push('goto'),
    reload: async () => void opts.calls.push('reload'),
    evaluate: async <R,>(expr: string): Promise<R> => {
      opts.calls.push(expr);
      if (expr === 'navigator.userAgent') return 'Mozilla/5.0 Chrome/155.0.1.2' as R;
      if (expr.includes('checkAdapter')) return { ok: true, info: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', is_fallback_adapter: false } } as R;
      if (expr.includes('storage.estimate')) return opts.quota as R;
      if (expr.includes('coldStart')) {
        const u = 'https://huggingface.co/o/m/resolve/abc/model.onnx';
        handlers.request.forEach((h) => h(u));
        handlers.finished.forEach((h) => h(u, async () => 2048));
        await new Promise((r) => setImmediate(r));
        return (expr.includes('empty') ? 4000 : 900) as R;
      }
      if (expr.includes('fingerprintExtras')) return { chat_template_kwargs: { enable_thinking: false, add_generation_prompt: true }, seed: 20261104, model_url: 'https://huggingface.co/o/m/resolve/abc/' } as R;
      if (expr.includes('navigator.connection')) return 'unknown' as R;
      return undefined as R;
    },
    onRequest: (h) => void handlers.request.push(h),
    onRequestFinished: (h) => void handlers.finished.push(h),
    onConsole: (h) => h('Node placements'),
    onCrash: () => undefined,
  };
  return {
    launcher: { launch: async () => ({ page: async () => page, close: async () => void opts.calls.push('close-browser') }) },
    profileFs: { makeDir: async (p) => `/tmp/${p}x`, removeDir: async (d) => void opts.removed.push(d) },
    serverFactory: async () => ({ url: `${LOCAL}/`, origin: LOCAL, close: async () => void opts.calls.push('close-server') }),
    distDir: '/dist',
    exec: async () => '100\n',
    proc: { listPids: async () => [], cmdline: async () => '', status: async () => '' },
    scheduler: { every: () => () => undefined },
    now: (() => {
      let t = 0;
      return () => (t += 100);
    })(),
  };
}

const combo = {
  id: 'c',
  runtime: 'webllm',
  model_id: 'm',
  quantization: 'q',
  revision: 'abc',
  phase1_locked: true,
  size: { expected_download_bytes: 1000 },
} as unknown as Combination;

test('quota not above the expected download fails before any model download', async () => {
  const calls: string[] = [];
  const removed: string[] = [];
  const s = new BrowserSession(fakeDeps({ quota: 1000, calls, removed }), combo, 'dev');
  const r = await s.prepare();
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.failure.reason, 'quota');
  assert.ok(!calls.some((c) => c.includes('coldStart') || c.includes('createEngine')));
  await s.close();
  assert.equal(removed.length, 1); // the Fresh_Profile is deleted
});

test('cold start: empty cache, reload, warm cache; bytes from the empty phase only; profile deleted', async () => {
  const calls: string[] = [];
  const removed: string[] = [];
  const s = new BrowserSession(fakeDeps({ quota: 10_000, calls, removed }), combo, 'locked');
  assert.equal((await s.prepare()).ok, true);
  const out = await s.load(true);
  const perf = out.perf as NonNullable<typeof out.perf>;
  assert.deepEqual(perf['cold_start'], { empty_cache_ms: 4000, warm_cache_ms: 900 });
  assert.equal((perf['download'] as { model_bytes: number }).model_bytes, 2048); // the warm phase fetch is not counted
  assert.equal((perf['memory'] as { gpu: string }).gpu, 'nvidia');
  const order = calls.filter((c) => c === 'reload' || c.includes('coldStart'));
  assert.deepEqual(order, [`window.__probe.coldStart('empty')`, 'reload', `window.__probe.coldStart('warm')`]);
  await s.close();
  await s.close();
  assert.equal(removed.length, 1);
});

test('prepare reads the page-side fingerprint fields and the browser fingerprint carries them (R12.12)', async () => {
  const s = new BrowserSession(fakeDeps({ quota: 10_000, calls: [], removed: [] }), combo, 'dev');
  assert.equal(s.fingerprintExtras, null); // not known before prepare
  assert.equal((await s.prepare()).ok, true);
  const fp = fingerprintOf(s, combo);
  assert.deepEqual(fp['chat_template_kwargs'], { enable_thinking: false, add_generation_prompt: true });
  assert.equal(fp['seed'], 20261104);
  assert.equal(fp['measurement'], 'headless');
  assert.ok(fp['browser'] !== null && fp['webgpu'] !== null);
  await s.close();
});

test('a Probe_Page without fingerprintExtras fails prepare before any model download', async () => {
  const calls: string[] = [];
  const deps = fakeDeps({ quota: 10_000, calls, removed: [] });
  const launcher = deps.launcher;
  const wrapped: SessionDeps = {
    ...deps,
    launcher: {
      launch: async (o) => {
        const ctx = await launcher.launch(o);
        return { ...ctx, page: async () => ({ ...(await ctx.page()), evaluate: async <R,>(e: string): Promise<R> => (e.includes('fingerprintExtras') ? (undefined as R) : (await ctx.page()).evaluate<R>(e)) }) };
      },
    },
  };
  const s = new BrowserSession(wrapped, combo, 'dev');
  const r = await s.prepare();
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.failure.reason, 'fingerprint_extras');
  assert.ok(!calls.some((c) => c.includes('coldStart') || c.includes('createEngine')));
  await s.close();
});
