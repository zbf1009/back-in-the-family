// WebGPU adapter check (design: In-browser adapters; R9.5, R9.6, R10.6). Pure over a structural view
// of `navigator.gpu`, so it runs unchanged on the Probe_Page and in offline tests with a fake.
// It has no DOM types: the shapes below are the subset of the WebGPU API this check reads.

export type PowerPreference = 'high-performance' | 'low-power';

export interface GpuAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
  readonly isFallbackAdapter?: boolean;
}

export interface GpuAdapterLike {
  /** Current Chrome exposes `info`; older builds exposed `requestAdapterInfo()`. */
  readonly info?: GpuAdapterInfoLike;
  readonly isFallbackAdapter?: boolean;
  requestAdapterInfo?: () => Promise<GpuAdapterInfoLike>;
}

export interface GpuLike {
  requestAdapter(options?: { powerPreference?: PowerPreference }): Promise<GpuAdapterLike | null>;
}

/** The adapter strings exactly as the browser reports them (R9.5); '' when a string is not reported. */
export interface AdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly is_fallback_adapter: boolean;
}

export type AdapterCheck =
  | { readonly ok: true; readonly info: AdapterInfo }
  | { readonly ok: false; readonly code: 'gpu_unavailable'; readonly info: null; readonly detail: string }
  | { readonly ok: false; readonly code: 'software_adapter'; readonly info: AdapterInfo; readonly detail: string };

/** R9.6: Chrome's software WebGPU adapter is vendor `google`, architecture `swiftshader`. */
export function isSoftwareAdapter(info: AdapterInfo): boolean {
  return info.is_fallback_adapter || (info.vendor === 'google' && info.architecture === 'swiftshader');
}

async function readInfo(adapter: GpuAdapterLike): Promise<AdapterInfo> {
  let raw: GpuAdapterInfoLike | undefined = adapter.info;
  if (raw === undefined && typeof adapter.requestAdapterInfo === 'function') raw = await adapter.requestAdapterInfo();
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    vendor: str(raw?.vendor),
    architecture: str(raw?.architecture),
    device: str(raw?.device),
    description: str(raw?.description),
    is_fallback_adapter: raw?.isFallbackAdapter === true || adapter.isFallbackAdapter === true,
  };
}

/**
 * Requests the adapter with the Combination's `powerPreference` and classifies it. `gpu` is
 * `navigator.gpu` (undefined when the browser has no WebGPU). Never falls back to another path.
 */
export async function checkAdapter(gpu: GpuLike | undefined | null, powerPreference: PowerPreference): Promise<AdapterCheck> {
  if (gpu === undefined || gpu === null || typeof gpu.requestAdapter !== 'function') {
    return { ok: false, code: 'gpu_unavailable', info: null, detail: 'navigator.gpu is not available' };
  }
  let adapter: GpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference });
  } catch (e) {
    return { ok: false, code: 'gpu_unavailable', info: null, detail: `requestAdapter threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (adapter === null || adapter === undefined) {
    return { ok: false, code: 'gpu_unavailable', info: null, detail: `requestAdapter({ powerPreference: "${powerPreference}" }) returned null` };
  }
  const info = await readInfo(adapter);
  if (isSoftwareAdapter(info)) {
    return { ok: false, code: 'software_adapter', info, detail: `software or fallback adapter (vendor "${info.vendor}", architecture "${info.architecture}")` };
  }
  return { ok: true, info };
}
