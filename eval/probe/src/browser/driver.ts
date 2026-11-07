// Browser driver (design: Browser driver; R9.4 to R9.6, R10.1, R10.6, R14.4 to R14.10).
//
// Headless measurement of ONE in-browser Combination in the system Chrome, on a Fresh_Profile:
//   prepare()  launch Chrome on the Fresh_Profile, open the Probe_Page, check the WebGPU adapter, check the
//              storage quota against `size.expected_download_bytes`. Sends no request to a Runtime and
//              downloads no model, so a failure here happens before the ledger `start` entry.
//   load()     start the memory measurement, run the empty-cache cold start (model download), freeze the
//              byte counters, `page.reload()` in the same context, run the warm-cache cold start. Or, on a
//              resume that already has a perf record, only create the engine.
//   runPrompt  one Card prompt through `window.__probe.runPrompt` (the page owns the timing state machine).
//   finish()   stop the memory measurement (after the last Card request) and rebuild the perf record.
//   close()    close Chrome and the static server and delete the Fresh_Profile, whatever happened.
//
// Everything that touches Playwright, the file system, nvidia-smi or /proc is behind an interface in
// `SessionDeps`, so the unit tests run this class offline with fakes. The real Playwright launcher imports
// `@playwright/test` lazily, so Node code that never starts a browser does not need one.
import type { AdapterCheck, AdapterInfo } from '../adapters/gpu.ts';
import { parsePlacement, WEBLLM_PLACEMENT, type Placement } from '../adapters/placement.ts';
import type { OutputConstraint, Prompt } from '../adapters/interface.ts';
import type { Combination } from '../phase.ts';
import type { JsonObject, PerfRecord } from '../results.ts';
import { checkPinnedFetch } from './pinned-fetch.ts';
import {
  ByteCounter,
  buildPerfRecord,
  classifyRequest,
  memoryMeasurementFor,
  nodeScheduler,
  nvidiaSmiReader,
  parseComputeApps,
  parseNvidiaSmiTable,
  type GpuProcess,
  type ExecFn,
  type IntervalScheduler,
  type MemoryMeasurement,
  type MemoryRecord,
  type ProcFs,
} from './perf.ts';
import { FreshProfile, nodeProfileFs, type ProfileFs } from './profile.ts';
import { startStaticServer, type StaticServer, type StaticServerFactory } from './server.ts';

/** The Headless_Launch_Flags (design: Launch flags). Exactly these three, in this order. */
export const HEADLESS_LAUNCH_FLAGS: readonly string[] = Object.freeze(['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan']);

// ---------------------------------------------------------------- injectable browser surface

/** The part of a Playwright page the driver uses. */
export interface DriverPage {
  goto(url: string): Promise<void>;
  /** `page.reload()` in the same context: the HTTP cache and Cache Storage of the Fresh_Profile stay. */
  reload(): Promise<void>;
  /** Evaluates a JavaScript expression in the page and awaits a returned promise. */
  evaluate<R>(expression: string): Promise<R>;
  onRequest(handler: (url: string) => void): void;
  /** `bodyBytes()` resolves to the response body size on the wire. */
  onRequestFinished(handler: (url: string, bodyBytes: () => Promise<number>) => void): void;
  onConsole(handler: (text: string) => void): void;
  onCrash(handler: () => void): void;
}

export interface DriverContext {
  page(): Promise<DriverPage>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  readonly userDataDir: string;
  readonly args: readonly string[];
}

export interface BrowserLauncher {
  launch(options: LaunchOptions): Promise<DriverContext>;
}

/** System Chrome through Playwright's `chromium.launchPersistentContext`; imported lazily, no browser download. */
export const playwrightLauncher: BrowserLauncher = {
  async launch({ userDataDir, args }) {
    const { chromium } = await import('@playwright/test');
    const context = await chromium.launchPersistentContext(userDataDir, { channel: 'chrome', headless: true, args: [...args] });
    return {
      async page() {
        const page = context.pages()[0] ?? (await context.newPage());
        return {
          goto: async (url) => void (await page.goto(url)),
          reload: async () => void (await page.reload()),
          evaluate: <R>(expression: string) => page.evaluate(expression) as Promise<R>,
          onRequest: (h) => void page.on('request', (r) => h(r.url())),
          onRequestFinished: (h) =>
            void page.on('requestfinished', (r) =>
              h(r.url(), async () => {
                const sizes = await r.sizes();
                return sizes.responseBodySize;
              }),
            ),
          onConsole: (h) => void page.on('console', (m) => h(m.text())),
          onCrash: (h) => void page.on('crash', () => h()),
        };
      },
      close: () => context.close(),
    };
  },
};

export interface SessionDeps {
  readonly launcher: BrowserLauncher;
  readonly profileFs: ProfileFs;
  readonly serverFactory: StaticServerFactory;
  /** Directory of the built Probe_Page (eval/probe/dist). */
  readonly distDir: string;
  readonly exec: ExecFn;
  readonly proc: ProcFs;
  readonly scheduler: IntervalScheduler;
  /** Monotonic milliseconds. */
  readonly now: () => number;
}

// ---------------------------------------------------------------- results

export type LoadFailureCode = 'model_load_failed' | 'out_of_memory' | 'gpu_unavailable' | 'software_adapter' | 'backend_not_webgpu' | 'placement_not_logged';

/** A failure of prepare or load that becomes a failure record. */
export class BrowserLoadError extends Error {
  readonly code: LoadFailureCode;
  constructor(code: LoadFailureCode, detail: string) {
    super(detail);
    this.name = 'BrowserLoadError';
    this.code = code;
  }
}

export interface PrepareFailure {
  readonly code: LoadFailureCode;
  /** Short machine-readable reason: `quota`, `gpu_unavailable`, `software_adapter`, `launch_failed`, ... */
  readonly reason: string;
  readonly detail: string;
  readonly extra: JsonObject;
}

export type PrepareResult =
  | { readonly ok: true; readonly adapter: AdapterInfo; readonly quotaBytes: number; readonly expectedDownloadBytes: number }
  | { readonly ok: false; readonly failure: PrepareFailure };

export interface LoadOutcome {
  /** Present when the cold-start measurements ran (the perf record of this run). */
  readonly perf: PerfRecord | null;
  readonly placement: Placement;
}

export interface PromptRunView {
  readonly outcome: { readonly kind: 'text'; readonly text: string } | { readonly kind: 'timeout' } | { readonly kind: 'error'; readonly code: string; readonly detail: string };
  readonly latency_ms: number;
  readonly late: { readonly kind: 'late'; readonly text: string; readonly latency_ms: number } | { readonly kind: 'none'; readonly reason: string } | null;
}

/** The page's view of the VRAM_Preflight request (`window.__probe.runPreflight`). */
export interface PreflightRunView {
  readonly outcome: PromptRunView['outcome'];
  readonly latency_ms: number;
  /** The adapter reported `truncated`: generation ran to `max_new_tokens` with the EOS stop suppressed. */
  readonly reached_limit: boolean;
}

export interface PreflightMeasurement {
  readonly adapter: AdapterInfo;
  readonly placement: Placement;
  /** NVIDIA sampler figure: peak minus the idle baseline, from before the engine is created to the end of the request. */
  readonly memory: MemoryRecord;
  /** Processes `nvidia-smi` listed on the card before the engine was created (names and MiB; hybrid-GPU context). */
  readonly otherProcesses?: OtherProcesses;
  readonly run: { readonly ok: true; readonly view: PreflightRunView } | { readonly ok: false; readonly error: string };
}

export interface OtherProcesses {
  /** `--query-compute-apps` rows. May be empty even when graphics processes use the card. */
  readonly compute_apps: readonly GpuProcess[];
  /** Rows of the plain `nvidia-smi` process table (graphics and compute). */
  readonly table: readonly GpuProcess[];
  /** Whole-card `memory.used,memory.total` line before the idle series. */
  readonly card: string | null;
}

/** Idle series for the preflight: 9 readings 250 ms apart (about 2 s). */
export const PREFLIGHT_IDLE_READS = 9;

export interface WarmUpView {
  readonly task: 'decision' | 'synthesis';
  readonly text: string;
  readonly latencyMs: number;
}

export const OOM =
  /out of memory|\boom\b|device (?:was )?lost|memory allocation failed|ErrorOutOfMemory|exceeds the maximum|OUT_OF_DEVICE_MEMORY|OUT_OF_HOST_MEMORY|Failed to allocate memory/i;

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The first console line that names an out-of-memory or device-lost condition (Dawn / Vulkan / ORT), ANSI colours
 * removed and cut to 300 characters; `null` when there is none. The page error after such a condition often says
 * only "Invalid Buffer ... previous error", so the preflight judge also looks here (Author, 2026-11-07).
 */
export function consoleOomLine(lines: readonly string[]): string | null {
  for (const l of lines) {
    const t = l.replace(ANSI, '').trim();
    if (OOM.test(t)) return t.slice(0, 300);
  }
  return null;
}

export const powerPreferenceOf = (combo: Combination): 'high-performance' | 'low-power' => (combo['power_preference'] === 'low-power' ? 'low-power' : 'high-performance');

/** `Chrome/137.0.7151.55` -> `137.0.7151.55`; otherwise the whole user agent. */
export function browserVersionOf(userAgent: string): string {
  return /\b(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/.exec(userAgent)?.[1] ?? (userAgent === '' ? 'unknown' : userAgent);
}

const NETWORK_EXPRESSION = `(navigator.connection ? (navigator.connection.type || navigator.connection.effectiveType || 'unknown') : 'unknown')`;
const QUOTA_EXPRESSION = `navigator.storage.estimate().then((e) => (typeof e.quota === 'number' ? e.quota : null))`;

// ---------------------------------------------------------------- the session

export class BrowserSession {
  private readonly deps: SessionDeps;
  private readonly combo: Combination;
  private readonly kind: 'locked' | 'dev';

  private profile: FreshProfile | null = null;
  private server: StaticServer | null = null;
  private context: DriverContext | null = null;
  private page: DriverPage | null = null;
  private preparing: Promise<PrepareResult> | null = null;
  private prepared: PrepareResult | null = null;
  private closed = false;
  private crashed = false;

  private readonly counter = new ByteCounter();
  private readonly consoleLines: string[] = [];
  private readonly requestUrls: string[] = [];
  private userAgent = '';
  private memory: MemoryMeasurement | null = null;
  private measured: { emptyMs: number; warmMs: number; download: ReturnType<ByteCounter['figures']>; network: string; placement: Placement } | null = null;
  private placementValue: Placement | null = null;
  private extras: JsonObject | null = null;

  constructor(deps: SessionDeps, combo: Combination, kind: 'locked' | 'dev') {
    this.deps = deps;
    this.combo = combo;
    this.kind = kind;
  }

  get hasCrashed(): boolean {
    return this.crashed;
  }

  get userAgentString(): string {
    return this.userAgent;
  }

  get adapterInfo(): AdapterInfo | null {
    return this.prepared !== null && this.prepared.ok ? this.prepared.adapter : null;
  }

  get placement(): Placement | null {
    return this.placementValue;
  }

  /**
   * The page-side Model_Fingerprint fields (`chat_template_kwargs`, `seed`, `constraint_used`, ...), read from
   * `window.__probe.fingerprintExtras()` during `prepare()`. `null` until the session is prepared (R12.12).
   */
  get fingerprintExtras(): JsonObject | null {
    return this.extras;
  }

  // ---------------------------------------------------------------- prepare (before the ledger entry)

  /** Idempotent: the second call returns the first call's result. */
  prepare(): Promise<PrepareResult> {
    this.preparing ??= this.doPrepare().then((r) => {
      this.prepared = r;
      return r;
    });
    return this.preparing;
  }

  private async doPrepare(): Promise<PrepareResult> {
    const fail = (code: LoadFailureCode, reason: string, detail: string, extra: JsonObject = {}): PrepareResult => ({ ok: false, failure: { code, reason, detail, extra } });
    let page: DriverPage;
    try {
      this.profile = await FreshProfile.create(this.deps.profileFs);
      this.server = await this.deps.serverFactory(this.deps.distDir);
      this.context = await this.deps.launcher.launch({ userDataDir: this.profile.dir, args: HEADLESS_LAUNCH_FLAGS });
      page = await this.context.page();
      this.page = page;
      this.attach(page, this.server.origin);
      await page.goto(`${this.server.url}?combo=${encodeURIComponent(this.combo.id)}`);
      this.userAgent = await page.evaluate<string>('navigator.userAgent');
    } catch (e) {
      return fail('model_load_failed', 'launch_failed', `could not start Chrome and open the Probe_Page: ${message(e)}`);
    }

    // Adapter check (R9.5, R9.6, R10.6): no fallback to another backend.
    let check: AdapterCheck;
    try {
      check = await page.evaluate<AdapterCheck>('window.__probe.checkAdapter()');
    } catch (e) {
      return fail('gpu_unavailable', 'gpu_unavailable', `adapter check failed: ${message(e)}`);
    }
    if (!check.ok) return fail(check.code, check.code, check.detail, { adapter: check.info === null ? null : { ...check.info } });

    // Storage quota check against the published download size (R14.9), before any download.
    const expected = this.combo.size?.expected_download_bytes ?? null;
    if (expected === null) {
      return fail('model_load_failed', 'quota', 'size.expected_download_bytes is not recorded; run `probe screen` first', { expected_download_bytes: null });
    }
    let quota: number | null;
    try {
      quota = await page.evaluate<number | null>(QUOTA_EXPRESSION);
    } catch (e) {
      return fail('model_load_failed', 'quota', `navigator.storage.estimate() failed: ${message(e)}`, { expected_download_bytes: expected });
    }
    if (quota === null || !(quota > expected)) {
      return fail('model_load_failed', 'quota', `storage quota ${quota ?? 'unknown'} bytes is not above the expected download of ${expected} bytes`, {
        quota,
        expected_download_bytes: expected,
      });
    }
    // The adapter-side fingerprint fields. Reading them builds the page's runtime object but starts no download.
    try {
      const extras = await page.evaluate<unknown>('window.__probe.fingerprintExtras()');
      if (typeof extras !== 'object' || extras === null || Array.isArray(extras)) throw new Error('it returned no object');
      this.extras = extras as JsonObject;
    } catch (e) {
      return fail('model_load_failed', 'fingerprint_extras', `window.__probe.fingerprintExtras() failed (rebuild the Probe_Page?): ${message(e)}`);
    }
    return { ok: true, adapter: check.info, quotaBytes: quota, expectedDownloadBytes: expected };
  }

  private attach(page: DriverPage, localOrigin: string): void {
    page.onRequest((url) => {
      this.requestUrls.push(url);
      const cls = classifyRequest(url, localOrigin);
      if (cls !== null) this.counter.noteStart(cls, this.deps.now());
    });
    page.onRequestFinished((url, bodyBytes) => {
      const cls = classifyRequest(url, localOrigin);
      if (cls === null || this.counter.isFrozen) return;
      void bodyBytes().then(
        (n) => this.counter.add(cls, n, this.deps.now()),
        () => undefined, // a request without a size (aborted, cached) adds nothing
      );
    });
    page.onConsole((text) => this.consoleLines.push(text));
    page.onCrash(() => {
      this.crashed = true;
    });
  }

  // ---------------------------------------------------------------- load (after the ledger entry)

  private ready(): { page: DriverPage; adapter: AdapterInfo; quotaBytes: number; expectedDownloadBytes: number } {
    if (this.page === null || this.prepared === null || !this.prepared.ok) throw new BrowserLoadError('model_load_failed', 'the browser session was not prepared');
    return { page: this.page, adapter: this.prepared.adapter, quotaBytes: this.prepared.quotaBytes, expectedDownloadBytes: this.prepared.expectedDownloadBytes };
  }

  private async evalLoad<R>(page: DriverPage, expression: string): Promise<R> {
    try {
      return await page.evaluate<R>(expression);
    } catch (e) {
      const text = message(e);
      if (this.crashed) throw new BrowserLoadError('model_load_failed', `the page crashed while loading the model: ${text}`);
      const prefixed = /^(gpu_unavailable|software_adapter): /.exec(text);
      if (prefixed !== null) throw new BrowserLoadError(prefixed[1] as LoadFailureCode, text);
      throw new BrowserLoadError(OOM.test(text) ? 'out_of_memory' : 'model_load_failed', text);
    }
  }

  private assertPinned(): void {
    const pin = { revision: this.combo.revision, model_lib_url: typeof this.combo.model_lib_url === 'string' ? this.combo.model_lib_url : null };
    const r = checkPinnedFetch(this.requestUrls, pin);
    if (!r.ok) throw new BrowserLoadError('model_load_failed', `${r.detail}: ${r.offending.slice(0, 3).join(', ')}`);
  }

  private placementOf(lines: readonly string[]): Placement {
    if (this.combo.runtime === 'webllm') return WEBLLM_PLACEMENT;
    const r = parsePlacement(lines);
    if (!r.ok) throw new BrowserLoadError(r.code, r.detail);
    return r.placement;
  }

  /**
   * Loads the engine. `coldStart` true: empty-cache cold start, reload, warm-cache cold start, and a perf
   * record. False (a resume that already has its perf record): create the engine and run the Warm_Up_Prompts.
   */
  async load(coldStart: boolean): Promise<LoadOutcome> {
    const { page, adapter } = this.ready();
    const profile = this.profile as FreshProfile;
    this.memory = memoryMeasurementFor(adapter.vendor, {
      reader: nvidiaSmiReader(this.deps.exec),
      scheduler: this.deps.scheduler,
      proc: this.deps.proc,
      profileDir: profile.dir,
    });
    await this.memory.start(); // NVIDIA: idle baseline, then sampling every 250 ms, before the engine is created

    if (!coldStart) {
      await this.evalLoad<WarmUpView[]>(page, 'window.__probe.createEngine()');
      this.assertPinned();
      this.placementValue = this.placementOf(this.consoleLines);
      return { perf: null, placement: this.placementValue };
    }

    const emptyMs = await this.evalLoad<number>(page, `window.__probe.coldStart('empty')`);
    this.counter.freeze(); // R14.5: byte counts come from the empty-cache phase only
    const download = this.counter.figures();
    const emptyPhaseConsole = [...this.consoleLines]; // ORT's placement block of the first session creation
    this.assertPinned();
    const network = await page.evaluate<string>(NETWORK_EXPRESSION).catch(() => 'unknown');
    try {
      await page.reload();
    } catch (e) {
      throw new BrowserLoadError('model_load_failed', `page.reload() failed: ${message(e)}`);
    }
    const warmMs = await this.evalLoad<number>(page, `window.__probe.coldStart('warm')`);
    this.assertPinned();
    const placement = this.placementOf(emptyPhaseConsole);
    this.placementValue = placement;
    this.measured = { emptyMs, warmMs, download, network, placement };
    return { perf: await this.perfRecord(await this.memory.snapshot()), placement };
  }

  private async perfRecord(memory: MemoryRecord): Promise<PerfRecord> {
    const m = this.measured;
    const { quotaBytes, expectedDownloadBytes } = this.ready();
    if (m === null) throw new Error('no cold-start measurement');
    return buildPerfRecord({
      runKind: this.kind,
      emptyCacheMs: m.emptyMs,
      warmCacheMs: m.warmMs,
      quotaBytes,
      expectedDownloadBytes,
      download: m.download,
      memory,
      network: { connection: m.network },
      placement: { method: m.placement.method, cpu_nodes: m.placement.cpu_nodes.map((n) => ({ op_type: n.op_type, count: n.count })) },
    });
  }

  /** Stops the memory measurement (call after the last Card request) and returns the final perf record, if one was measured. */
  async finish(): Promise<PerfRecord | null> {
    if (this.memory === null) return null;
    const memory = await this.memory.stop();
    return this.measured === null ? null : this.perfRecord(memory);
  }

  // ---------------------------------------------------------------- VRAM_Preflight (R9.9, R9.16)

  /**
   * The VRAM_Preflight on this prepared session: NVIDIA idle baseline, engine create (with the Warm_Up_Prompts,
   * which are not built from any Card), the pinned-fetch check, placement, then ONE request that generates
   * exactly `maxNewTokens` tokens, then the sampler peak. Only the NVIDIA adapter is measured: the figure is
   * compared with the 2,600 MiB limit and an Intel figure would mean something else (`gpu_unavailable`).
   * A load failure throws BrowserLoadError; a failure of the request itself is returned as `run.ok = false`.
   */
  async preflight(prompt: Prompt, o: { readonly maxNewTokens: number; readonly minNewTokens: number; readonly timeoutMs: number }): Promise<PreflightMeasurement> {
    const { page, adapter } = this.ready();
    if (adapter.vendor.toLowerCase() !== 'nvidia') {
      throw new BrowserLoadError('gpu_unavailable', `the VRAM_Preflight is measured on the NVIDIA adapter; the browser gave "${adapter.vendor}" (check power_preference and the Headless_Launch_Flags)`);
    }
    const profile = this.profile as FreshProfile;
    // Two-session placement method (design: Placement detection, 2026-11-07): the verbose placement-only session
    // is created and released BEFORE the sampler starts, so its memory never counts; the peak is the quiet session's.
    if (this.combo.runtime === 'transformers.js') await this.evalLoad<void>(page, 'window.__probe.probePlacement()');
    this.assertPinned();
    const placement = this.placementOf(this.consoleLines);
    this.placementValue = placement;
    const otherProcesses = await this.readOtherProcesses();
    this.memory = memoryMeasurementFor(adapter.vendor, {
      reader: nvidiaSmiReader(this.deps.exec),
      scheduler: this.deps.scheduler,
      proc: this.deps.proc,
      profileDir: profile.dir,
      idle: { reads: PREFLIGHT_IDLE_READS, wait: (ms) => new Promise<void>((r) => setTimeout(r, ms)) },
    });
    await this.memory.start();
    await this.evalLoad<WarmUpView[]>(page, 'window.__probe.createEngine()');
    this.assertPinned();
    // The page's runtime now reports the placement check (probe and measured key hashes and files).
    const extras = await page.evaluate<unknown>('window.__probe.fingerprintExtras()').catch(() => null);
    if (typeof extras === 'object' && extras !== null && !Array.isArray(extras)) this.extras = extras as JsonObject;
    const runConsoleStart = this.consoleLines.length;
    const args = `${JSON.stringify(prompt)}, ${JSON.stringify({ maxNewTokens: o.maxNewTokens, minNewTokens: o.minNewTokens, timeoutMs: o.timeoutMs })}`;
    let run: PreflightMeasurement['run'];
    try {
      run = { ok: true, view: await page.evaluate<PreflightRunView>(`window.__probe.runPreflight(${args})`) };
    } catch (e) {
      run = { ok: false, error: this.crashed ? `the page crashed: ${message(e)}` : message(e) };
    }
    const memory = await this.memory.stop();
    const oomLine = consoleOomLine(this.consoleLines.slice(runConsoleStart));
    if (oomLine !== null) {
      const before = run.ok ? `generation ended (${run.view.outcome.kind})` : run.error;
      run = { ok: false, error: `${before}; console: ${oomLine}` };
    }
    return { adapter, placement, memory, otherProcesses, run };
  }

  private async readOtherProcesses(): Promise<OtherProcesses> {
    const run = async (args: readonly string[]): Promise<string> => this.deps.exec('nvidia-smi', args).catch(() => '');
    const [apps, table, card] = await Promise.all([
      run(['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits']),
      run([]),
      run(['--query-gpu=memory.used,memory.total', '--format=csv,noheader']),
    ]);
    return { compute_apps: parseComputeApps(apps), table: parseNvidiaSmiTable(table), card: card.trim() === '' ? null : card.trim() };
  }

  // ---------------------------------------------------------------- inference and rebuild

  /** One prompt through the page's adapter. The page applies the Timeout, Late_Answer and Idle_Cap rules. */
  async runPrompt(prompt: Prompt, task: 'decision' | 'synthesis', timeoutMs: number, constraint: OutputConstraint): Promise<PromptRunView> {
    const { page } = this.ready();
    if (this.crashed) throw new Error('the page crashed');
    const args = `${JSON.stringify(prompt)}, ${JSON.stringify({ task, timeoutMs, constraint })}`;
    return page.evaluate<PromptRunView>(`window.__probe.runPrompt(${args})`);
  }

  /** Rebuild after an Idle_Cap hit: reload the page, create the engine and run both Warm_Up_Prompts. */
  async rebuildEngine(): Promise<WarmUpView[]> {
    const { page } = this.ready();
    if (this.crashed) throw new Error('the page crashed; it cannot be rebuilt');
    await page.reload();
    return page.evaluate<WarmUpView[]>('window.__probe.createEngine()');
  }

  // ---------------------------------------------------------------- close

  /** Closes Chrome and the server, then deletes the Fresh_Profile. Idempotent; never throws. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.memory?.stop();
    } catch {
      // nothing to report: the run is over
    }
    try {
      await this.context?.close();
    } catch {
      // Chrome may already be gone (crash)
    }
    try {
      await this.server?.close();
    } catch {
      // the server may already be closed
    }
    await this.profile?.dispose();
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The real machine: system Chrome, node:http, `nvidia-smi`, `/proc`. Built lazily by the CLI wiring only. */
export async function realSessionDeps(distDir: string): Promise<SessionDeps> {
  const { execFile } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  return {
    launcher: playwrightLauncher,
    profileFs: nodeProfileFs,
    serverFactory: startStaticServer,
    distDir,
    exec: (command, args) =>
      new Promise<string>((resolve, reject) => {
        execFile(command, [...args], { timeout: 5_000 }, (err, stdout) => (err === null ? resolve(stdout) : reject(err)));
      }),
    proc: {
      listPids: async () => (await fs.readdir('/proc')).filter((n) => /^\d+$/.test(n)).map(Number),
      cmdline: async (pid) => (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).replaceAll('\0', ' '),
      status: async (pid) => fs.readFile(`/proc/${pid}/status`, 'utf8').catch(() => ''),
    },
    scheduler: nodeScheduler,
    now: () => performance.now(),
  };
}
