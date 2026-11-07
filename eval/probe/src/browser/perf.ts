// Performance measurement helpers for the browser driver (design: Browser driver, Performance record;
// R14.4, R14.5, R14.7, R14.8, R14.10). Everything that touches the machine (nvidia-smi, /proc, timers) is
// behind an injected interface, so the unit tests run offline with fakes. Floating point is allowed here
// (design: Determinism): nothing in this file feeds back into sim-core.
//
// BYTE CLASSIFICATION (R14.5). Each finished request of the empty-cache phase is counted once, by URL:
//   model    host is huggingface.co, hf.co or a subdomain of either. That covers the model files and the
//            storage-CDN hosts Hugging Face redirects to (cdn-lfs*.huggingface.co, cas-bridge.xethub.hf.co).
//   local    the Probe_Page's own files from the local static server: index.html and the entry chunk
//            `assets/index-<hash>.{js,css}`.
//   runtime  everything the engines themselves bring, from any host:
//              - every request to a host other than the local server and Hugging Face (for example the
//                WebLLM model library on raw.githubusercontent.com);
//              - every file the local server serves from `/assets/` that is not the entry chunk: the Vite
//                vendor chunks (the WebLLM and transformers.js bundles) and the ONNX Runtime web
//                `ort-wasm-*.wasm` binary (about 26.9 MB). These are the engine's code, not the page's.
// This differs from the design's one-line wording ("local_bytes are the Probe_Page's own assets from
// localhost"): the large ORT wasm is served locally but is runtime weight, and counting it as page weight
// would hide it from the Runtime column. Requests that are not http(s) (data:, blob:) are not counted.
// Bytes are the response body size on the wire (Playwright `request.sizes().responseBodySize`), so a
// compressed response counts as transferred.
import { INTEL_MEMORY_QUANTITY } from '../report.ts';
import { SCHEMA, type JsonObject, type PerfRecord } from '../results.ts';

export type ByteClass = 'model' | 'runtime' | 'local';

const MODEL_HOST_SUFFIXES: readonly string[] = ['huggingface.co', 'hf.co'];

function parseUrl(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export const isModelHost = (host: string): boolean => MODEL_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));

/** True for a path served from `/assets/` that is not the Probe_Page's own entry chunk (`index-<hash>.js|css`). */
export function isLocalRuntimeAsset(pathname: string): boolean {
  if (!pathname.startsWith('/assets/')) return false;
  const base = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !/^index[-.]/.test(base);
}

/** Classifies a request URL; `null` when it is not an http(s) request. `localOrigin` is the static server's origin. */
export function classifyRequest(url: string, localOrigin: string): ByteClass | null {
  const u = parseUrl(url);
  if (u === null) return null;
  if (isModelHost(u.hostname)) return 'model';
  if (u.origin === localOrigin) return isLocalRuntimeAsset(u.pathname) ? 'runtime' : 'local';
  return 'runtime';
}

export interface DownloadFigures {
  readonly model_bytes: number;
  readonly runtime_bytes: number;
  readonly local_bytes: number;
  /** First model request start to last model request finish; 0 when no model file was fetched. */
  readonly duration_ms: number;
}

/** Adds finished requests by class. Freeze it at the end of the empty-cache phase (R14.5). */
export class ByteCounter {
  private readonly bytes: Record<ByteClass, number> = { model: 0, runtime: 0, local: 0 };
  private firstModelStart: number | null = null;
  private lastModelEnd: number | null = null;
  private frozen = false;

  noteStart(cls: ByteClass, atMs: number): void {
    if (this.frozen || cls !== 'model') return;
    if (this.firstModelStart === null) this.firstModelStart = atMs;
  }

  add(cls: ByteClass, bytes: number, atMs: number): void {
    if (this.frozen || !Number.isFinite(bytes) || bytes < 0) return;
    this.bytes[cls] += Math.round(bytes);
    if (cls === 'model') this.lastModelEnd = Math.max(this.lastModelEnd ?? atMs, atMs);
  }

  /** Later `add` calls are ignored: the warm-cache phase must not change the figures. */
  freeze(): void {
    this.frozen = true;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  figures(): DownloadFigures {
    const span = this.firstModelStart !== null && this.lastModelEnd !== null ? Math.max(0, Math.round(this.lastModelEnd - this.firstModelStart)) : 0;
    return { model_bytes: this.bytes.model, runtime_bytes: this.bytes.runtime, local_bytes: this.bytes.local, duration_ms: span };
  }
}

/** Measured download bandwidth in Mbit/s: model bytes over the model download window; null without both. */
export function measuredMbitPerSecond(d: DownloadFigures): number | null {
  if (d.model_bytes <= 0 || d.duration_ms <= 0) return null;
  return Math.round(((d.model_bytes * 8) / 1e6 / (d.duration_ms / 1000)) * 100) / 100;
}

// ---------------------------------------------------------------- memory

export const NVIDIA_MEMORY_QUANTITY = 'NVIDIA device memory.used delta';
export { INTEL_MEMORY_QUANTITY };
export const SAMPLE_INTERVAL_MS = 250;
const BYTES_PER_MIB = 1024 * 1024;

export interface MemoryRecord extends JsonObject {
  gpu: 'nvidia' | 'intel' | null;
  quantity: string | null;
  peak_mib: number | null;
  reason: string | null;
}

export const unmeasuredMemory = (gpu: MemoryRecord['gpu'], quantity: string | null, reason: string): MemoryRecord => ({ gpu, quantity, peak_mib: null, reason });

/** Peak minus idle baseline, rounded up to whole MiB, never negative. `null` when there is nothing to compare. */
export function peakDeltaMib(baselineMib: number | null, samplesMib: readonly number[]): number | null {
  if (baselineMib === null || samplesMib.length === 0) return null;
  return Math.max(0, Math.ceil(Math.max(...samplesMib) - baselineMib));
}

/** One reading of a memory figure in MiB; `null` when it cannot be read right now. */
export interface MemoryReader {
  read(): Promise<number | null>;
}

export interface IntervalScheduler {
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
}

export const nodeScheduler: IntervalScheduler = {
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

export interface MemoryMeasurement {
  /** Takes the idle baseline (NVIDIA) and starts sampling. Call before the engine is created. */
  start(): Promise<void>;
  /** The figure so far; sampling continues. */
  snapshot(): Promise<MemoryRecord>;
  /** Stops sampling and returns the final figure. Call after the last Card request. */
  stop(): Promise<MemoryRecord>;
}

/**
 * NVIDIA: `nvidia-smi` memory.used sampled every 250 ms; the figure is the peak minus the idle baseline read
 * just before the engine is created (R14.7). Quantity "NVIDIA device memory.used delta".
 */
export class NvidiaPeakSampler implements MemoryMeasurement {
  private baseline: number | null = null;
  private readonly samples: number[] = [];
  private stopTimer: (() => void) | null = null;
  private reading = false;

  private readonly reader: MemoryReader;
  private readonly scheduler: IntervalScheduler;
  private readonly intervalMs: number;

  constructor(reader: MemoryReader, scheduler: IntervalScheduler, intervalMs: number = SAMPLE_INTERVAL_MS) {
    this.reader = reader;
    this.scheduler = scheduler;
    this.intervalMs = intervalMs;
  }

  private async sample(): Promise<void> {
    if (this.reading) return; // never queue reads behind a slow nvidia-smi
    this.reading = true;
    try {
      const v = await this.reader.read();
      if (v !== null) this.samples.push(v);
    } catch {
      // a failed reading is a missing sample, not a failed run
    } finally {
      this.reading = false;
    }
  }

  async start(): Promise<void> {
    try {
      this.baseline = await this.reader.read();
    } catch {
      this.baseline = null;
    }
    this.stopTimer = this.scheduler.every(this.intervalMs, () => void this.sample());
  }

  private record(): MemoryRecord {
    if (this.baseline === null) return unmeasuredMemory('nvidia', NVIDIA_MEMORY_QUANTITY, 'nvidia-smi gave no idle baseline reading');
    const peak = peakDeltaMib(this.baseline, this.samples);
    if (peak === null) return unmeasuredMemory('nvidia', NVIDIA_MEMORY_QUANTITY, 'nvidia-smi gave no reading during the run');
    return { gpu: 'nvidia', quantity: NVIDIA_MEMORY_QUANTITY, peak_mib: peak, reason: null };
  }

  async snapshot(): Promise<MemoryRecord> {
    await this.sample();
    return this.record();
  }

  async stop(): Promise<MemoryRecord> {
    this.stopTimer?.();
    this.stopTimer = null;
    await this.sample();
    return this.record();
  }
}

/** `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits` output -> MiB of the first GPU line. */
export function parseNvidiaSmiMemoryUsed(output: string): number | null {
  for (const line of output.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return null;
}

export const NVIDIA_SMI_ARGS: readonly string[] = ['--query-gpu=memory.used', '--format=csv,noheader,nounits'];

/** Runs a command and returns its stdout; rejects on a non-zero exit. */
export type ExecFn = (command: string, args: readonly string[]) => Promise<string>;

export const nvidiaSmiReader = (exec: ExecFn): MemoryReader => ({
  async read() {
    return parseNvidiaSmiMemoryUsed(await exec('nvidia-smi', NVIDIA_SMI_ARGS));
  },
});

/** The slice of /proc the Intel reading needs. */
export interface ProcFs {
  listPids(): Promise<number[]>;
  /** `/proc/<pid>/cmdline` with NUL separators replaced by spaces; '' when unreadable. */
  cmdline(pid: number): Promise<string>;
  /** `/proc/<pid>/status` text; '' when unreadable. */
  status(pid: number): Promise<string>;
}

/** The Chrome GPU process of this Fresh_Profile: `--type=gpu-process` with this profile's `--user-data-dir`. */
export async function findGpuProcessPid(proc: ProcFs, profileDir: string): Promise<number | null> {
  const wanted = `--user-data-dir=${profileDir}`;
  for (const pid of (await proc.listPids()).sort((a, b) => a - b)) {
    const cmd = await proc.cmdline(pid);
    if (cmd.includes('--type=gpu-process') && cmd.includes(wanted)) return pid;
  }
  return null;
}

/** `VmHWM:   123456 kB` -> MiB, rounded up. */
export function parseVmHwmMib(status: string): number | null {
  const m = /^VmHWM:\s+(\d+)\s*kB\s*$/m.exec(status);
  return m === null ? null : Math.ceil(Number(m[1]) / 1024);
}

/**
 * Intel iGPU: no per-process GPU counter is available without root, so the figure is the kernel's peak
 * resident set (VmHWM) of this profile's Chrome GPU process. It excludes unmapped GEM buffers, and the
 * quantity says so (R14.7). It is a peak, not a delta, and is reported in its own column.
 */
export class IntelGpuProcessPeak implements MemoryMeasurement {
  private pid: number | null = null;
  private peak: number | null = null;
  private stopped = false;

  private readonly proc: ProcFs;
  private readonly profileDir: string;

  constructor(proc: ProcFs, profileDir: string) {
    this.proc = proc;
    this.profileDir = profileDir;
  }

  async start(): Promise<void> {
    this.pid = null;
    this.peak = null;
    this.stopped = false;
  }

  private async read(): Promise<void> {
    if (this.stopped) return;
    try {
      this.pid ??= await findGpuProcessPid(this.proc, this.profileDir);
      if (this.pid === null) return;
      const v = parseVmHwmMib(await this.proc.status(this.pid));
      if (v !== null) this.peak = Math.max(this.peak ?? 0, v);
    } catch {
      // the process may have exited between listing and reading
    }
  }

  private record(): MemoryRecord {
    if (this.pid === null) return unmeasuredMemory('intel', INTEL_MEMORY_QUANTITY, 'no Chrome GPU process found for this profile');
    if (this.peak === null) return unmeasuredMemory('intel', INTEL_MEMORY_QUANTITY, `could not read VmHWM of process ${this.pid}`);
    return { gpu: 'intel', quantity: INTEL_MEMORY_QUANTITY, peak_mib: this.peak, reason: null };
  }

  async snapshot(): Promise<MemoryRecord> {
    await this.read();
    return this.record();
  }

  async stop(): Promise<MemoryRecord> {
    await this.read();
    const r = this.record();
    this.stopped = true;
    return r;
  }
}

/** No measurement is possible (for example an adapter that is neither NVIDIA nor Intel). */
export class NoMemoryMeasurement implements MemoryMeasurement {
  private readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
  async start(): Promise<void> {}
  async snapshot(): Promise<MemoryRecord> {
    return unmeasuredMemory(null, null, this.reason);
  }
  async stop(): Promise<MemoryRecord> {
    return unmeasuredMemory(null, null, this.reason);
  }
}

/** Picks the measurement from the adapter vendor string the browser reported (`nvidia`, `intel`). */
export function memoryMeasurementFor(
  vendor: string,
  deps: { readonly reader: MemoryReader; readonly scheduler: IntervalScheduler; readonly proc: ProcFs; readonly profileDir: string },
): MemoryMeasurement {
  const v = vendor.toLowerCase();
  if (v === 'nvidia') return new NvidiaPeakSampler(deps.reader, deps.scheduler);
  if (v === 'intel') return new IntelGpuProcessPeak(deps.proc, deps.profileDir);
  return new NoMemoryMeasurement(`no memory measurement for adapter vendor "${vendor}"`);
}

// ---------------------------------------------------------------- perf record

export interface NetworkConditions {
  /** `navigator.connection.type` or `effectiveType`, or "unknown" when the browser reports none. */
  readonly connection: string;
}

export interface PerfInput {
  readonly runKind: 'locked' | 'dev';
  readonly emptyCacheMs: number | null;
  readonly warmCacheMs: number | null;
  readonly quotaBytes: number;
  readonly expectedDownloadBytes: number;
  readonly download: DownloadFigures;
  readonly memory: MemoryRecord;
  readonly network: NetworkConditions;
  readonly placement: JsonObject | null;
}

/** The `llm-probe-perf-v1` record (design: Performance record). */
export function buildPerfRecord(i: PerfInput): PerfRecord {
  return {
    schema: SCHEMA.perf,
    run_kind: i.runKind,
    fresh_profile: true,
    cold_start: { empty_cache_ms: i.emptyCacheMs, warm_cache_ms: i.warmCacheMs },
    storage: { quota_bytes: i.quotaBytes, expected_download_bytes: i.expectedDownloadBytes },
    download: { ...i.download },
    memory: { ...i.memory },
    network: { connection: i.network.connection, throttling: 'none', measured_mbit_s: measuredMbitPerSecond(i.download) },
    placement: i.placement,
  };
}

export const bytesToMib = (bytes: number): number => bytes / BYTES_PER_MIB;
