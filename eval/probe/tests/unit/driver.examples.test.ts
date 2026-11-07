// Browser driver example tests (llm-probe task 16.10; R9.9, R14.5, R14.9). Offline: the page, the launcher, the
// static server, nvidia-smi and /proc are fakes. The fake page evaluates the driver's own quota expression against
// a fake `navigator.storage.estimate()`, so the real expression is what is tested. What the light smoke tests of 16.8
// (browser-driver.smoke.test.ts) already cover is not repeated: this file adds the quota boundary with the evidence
// that nothing was downloaded, the byte classes through a whole session, the frozen counter, and the cold-start order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserSession, type DriverPage, type SessionDeps } from '../../src/browser/driver.ts';
import { classifyRequest } from '../../src/browser/perf.ts';
import type { Combination } from '../../src/phase.ts';

const LOCAL = 'http://127.0.0.1:4000';
const HF = 'https://huggingface.co/o/m/resolve/abc/model.onnx';
const CDN = 'https://cdn-lfs-us-1.hf.co/repos/ab/cd/weights';
const LIB = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/sha/lib.wasm';
const ORT = `${LOCAL}/assets/ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm`;
const INDEX_HTML = `${LOCAL}/`;
const ENTRY = `${LOCAL}/assets/index-cy4ixN6L.js`;

const combo = {
  id: 'c',
  runtime: 'webllm',
  model_id: 'm',
  quantization: 'q',
  revision: 'abc',
  model_lib_url: LIB,
  phase1_locked: true,
  size: { expected_download_bytes: 1000 },
} as unknown as Combination;

interface Log {
  /** Every expression the driver evaluated, plus 'goto', 'reload' and 'close-browser' in call order. */
  calls: string[];
  /** Every request the page made, in order. */
  requests: string[];
  removed: string[];
}

/** A `navigator` whose storage estimate reports the given quota. */
const fakeNavigator = (quota: number | undefined): unknown => ({ storage: { estimate: async () => ({ quota, usage: 0 }) } });

function fakeDeps(quota: number | undefined, log: Log): SessionDeps {
  const handlers: { request: ((u: string) => void)[]; finished: ((u: string, b: () => Promise<number>) => void)[] } = { request: [], finished: [] };
  const fetch = async (url: string, bytes: number): Promise<void> => {
    log.requests.push(url);
    handlers.request.forEach((h) => h(url));
    handlers.finished.forEach((h) => h(url, async () => bytes));
    await new Promise((r) => setImmediate(r));
  };
  const page: DriverPage = {
    goto: async () => {
      log.calls.push('goto');
      await fetch(INDEX_HTML, 40);
      await fetch(ENTRY, 60);
    },
    reload: async () => {
      log.calls.push('reload');
      await fetch(INDEX_HTML, 40);
      await fetch(ENTRY, 60);
    },
    evaluate: async <R,>(expr: string): Promise<R> => {
      log.calls.push(expr);
      if (expr === 'navigator.userAgent') return 'Mozilla/5.0 Chrome/155.0.1.2' as R;
      if (expr.includes('checkAdapter')) return { ok: true, info: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', is_fallback_adapter: false } } as R;
      if (expr.includes('storage.estimate')) return (await (new Function('navigator', `return ${expr};`)(fakeNavigator(quota)) as Promise<number | null>)) as R;
      if (expr.includes('fingerprintExtras')) return { chat_template_kwargs: null, seed: null } as R;
      if (expr.includes('navigator.connection')) return 'unknown' as R;
      if (expr.includes(`coldStart('empty')`)) {
        await fetch(HF, 2048);
        await fetch(CDN, 4096);
        await fetch(LIB, 300);
        await fetch(ORT, 500);
        return 4000 as R;
      }
      if (expr.includes(`coldStart('warm')`)) {
        // The warm phase re-reads the same files; none of these may reach the figures.
        await fetch(HF, 2048);
        await fetch(CDN, 4096);
        await fetch(LIB, 300);
        await fetch(ORT, 500);
        return 900 as R;
      }
      return undefined as R;
    },
    onRequest: (h) => void handlers.request.push(h),
    onRequestFinished: (h) => void handlers.finished.push(h),
    onConsole: () => undefined,
    onCrash: () => undefined,
  };
  return {
    launcher: { launch: async () => ({ page: async () => page, close: async () => void log.calls.push('close-browser') }) },
    profileFs: { makeDir: async (p) => `/tmp/${p}x`, removeDir: async (d) => void log.removed.push(d) },
    serverFactory: async () => ({ url: `${LOCAL}/`, origin: LOCAL, close: async () => void log.calls.push('close-server') }),
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

const newLog = (): Log => ({ calls: [], requests: [], removed: [] });
const downloadStarted = (log: Log): boolean => log.requests.some((u) => classifyRequest(u, LOCAL) === 'model' || u === LIB);
const engineStarted = (log: Log): boolean => log.calls.some((c) => c.includes('coldStart') || c.includes('createEngine'));

// ---------------------------------------------------------------- quota (R14.9)

test('quota below the expected download: model_load_failed with reason quota, and nothing was downloaded', async () => {
  const log = newLog();
  const s = new BrowserSession(fakeDeps(999, log), combo, 'locked');
  const r = await s.prepare();
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.code, 'model_load_failed');
  assert.equal(r.failure.reason, 'quota');
  assert.equal(r.failure.extra['quota'], 999);
  assert.equal(r.failure.extra['expected_download_bytes'], 1000);
  assert.ok(!downloadStarted(log), `a download request was made: ${log.requests.join(', ')}`);
  assert.ok(!engineStarted(log));
  // The quota was read, so the check ran before anything else that could start a model.
  assert.ok(log.calls.some((c) => c.includes('storage.estimate')));
  await s.close();
  assert.equal(log.removed.length, 1);
});

test('quota equal to the expected download fails too: R14.9 needs a quota strictly greater (design: `!(quota > expected)`)', async () => {
  const log = newLog();
  const s = new BrowserSession(fakeDeps(1000, log), combo, 'locked');
  const r = await s.prepare();
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.failure.reason, 'quota');
  assert.ok(!downloadStarted(log) && !engineStarted(log));
  await s.close();
});

test('quota one byte above the expected download proceeds, and the session then downloads', async () => {
  const log = newLog();
  const s = new BrowserSession(fakeDeps(1001, log), combo, 'locked');
  const r = await s.prepare();
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.quotaBytes, 1001);
    assert.equal(r.expectedDownloadBytes, 1000);
  }
  assert.ok(!downloadStarted(log)); // prepare itself still downloads nothing
  await s.load(true);
  assert.ok(downloadStarted(log));
  await s.close();
});

test('an unreported quota (null) or an estimate that throws fails with reason quota', async () => {
  const unknown = newLog();
  const a = await new BrowserSession(fakeDeps(undefined, unknown), combo, 'locked').prepare();
  assert.equal(a.ok ? '' : a.failure.reason, 'quota');
  assert.ok(!engineStarted(unknown));

  const deps = fakeDeps(5000, newLog());
  const broken: SessionDeps = {
    ...deps,
    launcher: {
      launch: async (o) => {
        const ctx = await deps.launcher.launch(o);
        return { ...ctx, page: async () => ({ ...(await ctx.page()), evaluate: async <R,>(e: string): Promise<R> => (e.includes('storage.estimate') ? Promise.reject(new Error('no storage API')) : (await ctx.page()).evaluate<R>(e)) }) };
      },
    },
  };
  const b = await new BrowserSession(broken, combo, 'locked').prepare();
  assert.equal(b.ok ? '' : b.failure.reason, 'quota');
});

// ---------------------------------------------------------------- byte classification by host (R14.5)

test('classification by host: huggingface.co and its CDN redirect hosts are model bytes', () => {
  for (const u of [HF, CDN, 'https://cas-bridge.xethub.hf.co/y', 'https://www.huggingface.co/x', 'https://cdn-lfs.huggingface.co/z']) assert.equal(classifyRequest(u, LOCAL), 'model', u);
});

test('classification: the model library host and non-entry /assets/ files are runtime; index.html and the entry chunk are local', () => {
  assert.equal(classifyRequest(LIB, LOCAL), 'runtime');
  assert.equal(classifyRequest('https://cdn.jsdelivr.net/npm/x/dist/ort.wasm', LOCAL), 'runtime');
  assert.equal(classifyRequest(ORT, LOCAL), 'runtime');
  assert.equal(classifyRequest(`${LOCAL}/assets/lib-BkBIntl4.js`, LOCAL), 'runtime');
  assert.equal(classifyRequest(`${LOCAL}/assets/index-cy4ixN6L.css`, LOCAL), 'local');
  assert.equal(classifyRequest(ENTRY, LOCAL), 'local');
  assert.equal(classifyRequest(INDEX_HTML, LOCAL), 'local');
  assert.equal(classifyRequest(`${LOCAL}/index.html`, LOCAL), 'local');
  assert.equal(classifyRequest('blob:http://127.0.0.1:4000/abc', LOCAL), null);
});

test('a whole session sorts every request into its class, and the figures stop at the end of the empty-cache phase', async () => {
  const log = newLog();
  const s = new BrowserSession(fakeDeps(10_000, log), combo, 'locked');
  assert.equal((await s.prepare()).ok, true);
  const out = await s.load(true);
  const perf = out.perf as NonNullable<typeof out.perf>;
  const d = perf['download'] as { model_bytes: number; runtime_bytes: number; local_bytes: number };
  assert.equal(d.model_bytes, 2048 + 4096); // huggingface.co plus the CDN redirect host
  assert.equal(d.runtime_bytes, 300 + 500); // model library and /assets/ ORT wasm
  assert.equal(d.local_bytes, 40 + 60); // index.html and the entry chunk, loaded once before the cold start
  // The warm phase and the reload fetched all of these again; none of it was counted.
  assert.ok(log.requests.filter((u) => u === HF).length === 2);
  const again = (await s.finish()) as NonNullable<Awaited<ReturnType<typeof s.finish>>>;
  assert.deepEqual(again['download'], perf['download']); // still frozen when the run ends
  await s.close();
});

// ---------------------------------------------------------------- cold-start order

test('cold start runs empty cache, then page.reload(), then warm cache, and the cache phases are timed separately', async () => {
  const log = newLog();
  const s = new BrowserSession(fakeDeps(10_000, log), combo, 'locked');
  await s.prepare();
  const out = await s.load(true);
  const phases = log.calls.filter((c) => c === 'reload' || c.includes('coldStart'));
  assert.deepEqual(phases, [`window.__probe.coldStart('empty')`, 'reload', `window.__probe.coldStart('warm')`]);
  assert.deepEqual((out.perf as NonNullable<typeof out.perf>)['cold_start'], { empty_cache_ms: 4000, warm_cache_ms: 900 });
  // Nothing was evaluated for the model before the quota check.
  const quotaAt = log.calls.findIndex((c) => c.includes('storage.estimate'));
  const firstColdAt = log.calls.findIndex((c) => c.includes('coldStart'));
  assert.ok(quotaAt >= 0 && quotaAt < firstColdAt);
  await s.close();
});

test('a resume with its perf record already stored creates the engine only: no cold-start phases and no reload', async () => {
  const log = newLog();
  const s = new BrowserSession(fakeDeps(10_000, log), combo, 'locked');
  await s.prepare();
  const out = await s.load(false);
  assert.equal(out.perf, null);
  assert.ok(log.calls.includes('window.__probe.createEngine()'));
  assert.ok(!log.calls.some((c) => c.includes('coldStart') || c === 'reload'));
  await s.close();
});
