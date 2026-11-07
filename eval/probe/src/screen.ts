// In_Browser_Size_Limits and pinning screen (design: Mechanical choices / screen.ts; R9.3, R9.8,
// R9.15, R9.17). Pure apart from the injected download-size fetch, so tests stay offline.
//
// One Exclusion_Record per failing in-browser Combination, naming the FIRST failed check in this
// order: vram, params, download, unpinned (revision, then model library URL), then the
// VRAM_Preflight result for transformers.js. A figure that is not known counts as failed, with
// value "unknown" (R9.3). A transformers.js candidate with no published VRAM figure is not
// excluded for that at screening: the VRAM_Preflight fills it (R9.9).
import { IN_BROWSER_DOWNLOAD_LIMIT_BYTES, isWorkersAi, type Combination } from './phase.ts';
import { SCHEMA, type ExclusionRecord } from './results.ts';

export const VRAM_LIMIT_MIB = 2600;
export const PARAMS_LIMIT = 2_300_000_000;
export { IN_BROWSER_DOWNLOAD_LIMIT_BYTES };

export const REVISION_RE = /^[0-9a-f]{40}$/;
export const MODEL_LIB_URL_RE = /^https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/[0-9a-f]{40}\/\S+$/;

export const isInBrowser = (c: Combination): boolean => !isWorkersAi(c);
const isWebLlm = (c: Combination): boolean => c.runtime === 'webllm';
const isTransformersJs = (c: Combination): boolean => c.runtime === 'transformers.js';

/** Result of one VRAM_Preflight (R9.9, R9.10), as `preflight/<combo>.json` records it. */
export interface PreflightOutcome {
  readonly loaded_on_webgpu: boolean;
  readonly peak_vram_mib: number | null;
}

export interface ScreenOptions {
  /** ISO time stamped on every Exclusion_Record. */
  readonly at: string;
  /**
   * Sum of the files the loader fetches at the Pinned_Revision, from the Hugging Face API tree.
   * Injected (and only called for a Combination whose `revision` is pinned and whose size is not
   * already stored); null or a throw means "unknown".
   */
  readonly fetchDownloadBytes?: (combo: Combination) => Promise<number | null>;
  /** VRAM_Preflight results by Combination ID. */
  readonly preflight?: ReadonlyMap<string, PreflightOutcome>;
}

export interface ScreenResult {
  readonly combination: Combination;
  /** `expected_download_bytes` used for the check: stored, fetched, or null. */
  readonly download_bytes: number | null;
  readonly exclusion: ExclusionRecord | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Pure first-failed-check decision; no I/O. Returns the record without checking anything else. */
export function screenOne(combo: Combination, downloadBytes: number | null, at: string, preflight?: PreflightOutcome): ExclusionRecord | null {
  const rec = (check: ExclusionRecord['check'], value: number | string, limit: number | string | null): ExclusionRecord => ({
    schema: SCHEMA.exclusion,
    combination: combo.id,
    model: combo.model_id,
    check,
    value,
    limit,
    at,
  });
  const vram = num(combo.size?.vram_mib);
  // R9.9: a transformers.js candidate with no published figure is decided by the preflight.
  if (!(isTransformersJs(combo) && vram === null)) {
    if (vram === null || vram > VRAM_LIMIT_MIB) return rec('vram', vram ?? 'unknown', VRAM_LIMIT_MIB);
  }
  const params = num(combo.size?.params);
  if (params === null || params > PARAMS_LIMIT) return rec('params', params ?? 'unknown', PARAMS_LIMIT);
  if (downloadBytes === null || downloadBytes > IN_BROWSER_DOWNLOAD_LIMIT_BYTES) {
    return rec('download', downloadBytes ?? 'unknown', IN_BROWSER_DOWNLOAD_LIMIT_BYTES);
  }
  const revision = typeof combo.revision === 'string' ? combo.revision : '';
  if (!REVISION_RE.test(revision)) return rec('unpinned', revision === '' ? 'unknown' : revision, 'revision: 40-hex Hugging Face commit sha');
  if (isWebLlm(combo)) {
    const lib = combo.model_lib_url;
    if (typeof lib !== 'string' || !MODEL_LIB_URL_RE.test(lib)) {
      return rec('unpinned', typeof lib === 'string' && lib !== '' ? lib : 'unknown', 'model_lib_url: raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/<40-hex sha>/…');
    }
  }
  if (isTransformersJs(combo) && vram === null) {
    if (preflight === undefined) return null; // preflight pending: neither run nor excluded yet
    if (!preflight.loaded_on_webgpu) return rec('preflight_load', 'not loaded on WebGPU', 'loaded on WebGPU');
    const peak = num(preflight.peak_vram_mib);
    if (peak === null || peak > VRAM_LIMIT_MIB) return rec('preflight_vram', peak ?? 'unknown', VRAM_LIMIT_MIB);
  }
  return null;
}

/** Screens every in-browser Combination (Workers AI ones are skipped); order of `combos` is kept. */
export async function screenCombinations(combos: readonly Combination[], opts: ScreenOptions): Promise<ScreenResult[]> {
  const out: ScreenResult[] = [];
  for (const combo of combos) {
    if (!isInBrowser(combo)) continue;
    let bytes = num(combo.size?.expected_download_bytes);
    if (bytes === null && REVISION_RE.test(combo.revision) && opts.fetchDownloadBytes !== undefined) {
      try {
        bytes = num(await opts.fetchDownloadBytes(combo));
      } catch {
        bytes = null;
      }
    }
    out.push({ combination: combo, download_bytes: bytes, exclusion: screenOne(combo, bytes, opts.at, opts.preflight?.get(combo.id)) });
  }
  return out;
}

/** One entry of the Hugging Face API tree (`/api/models/<repo>/tree/<revision>`). */
export interface TreeFile {
  readonly path: string;
  readonly size: number;
}

/**
 * Bytes a loader fetches from a repository tree. WebLLM fetches every file except dot files and
 * the README. transformers.js counts the TEXT PATH only (design.md "Research findings"):
 *   - top-level (no `/`) non-dot files except README.md (config, tokenizer, ...);
 *   - Qwen3.5 layout: `onnx/decoder_model_merged_q4.onnx*` and `onnx/embed_tokens_q4.onnx*`;
 *   - LFM2.5 layout: the single `onnx/model_q4.onnx*`;
 *   where `*` is an optional `_data` / `_data_<n>` external-weights suffix.
 * Vision and audio encoders (`vision_encoder_*`, `audio_encoder_*`, ...) and every non-q4 build stay OUT
 * of the screening sum. If the loader really fetches an encoder, the measured download at Locked_Run start
 * (R9.11, over 1,536 MiB -> not recommended / over-limit mark) is the safety net.
 */
export function sumTreeBytes(runtime: string, files: readonly TreeFile[]): number {
  const wanted = (f: TreeFile): boolean => {
    const base = f.path.split('/').pop() ?? f.path;
    if (base.startsWith('.') || base === 'README.md') return false;
    if (runtime !== 'transformers.js') return true;
    if (!f.path.startsWith('onnx/')) return !f.path.includes('/');
    return /^onnx\/(decoder_model_merged|embed_tokens|model)_q4\.onnx(_data(_\d+)?)?$/.test(f.path);
  };
  return files.filter(wanted).reduce((sum, f) => sum + f.size, 0);
}
