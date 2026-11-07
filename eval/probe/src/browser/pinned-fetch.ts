// Pinned-fetch check (design: In-browser adapters, Pinned weights; R9.15). The driver feeds it the
// URLs seen through `page.on('request')`; it is a pure function so it tests offline.
//   - every request to huggingface.co contains `/resolve/<revision>/`;
//   - every model-library request equals the Combination's `model_lib_url`.
// Redirect targets on Hugging Face's storage CDN (other hosts) are allowed and not checked.
// Revised 2026-11-07 (task 19.3, first VRAM_Preflight): huggingface.co now answers `/resolve/<rev>/<file>` with a
// same-host redirect to `/api/resolve-cache/models/<repo>/<commit>/<file>?...`. Such a target is pinned when its
// path names the pinned commit; a resolve-cache path naming any other commit is not.

export interface PinnedFetchPin {
  readonly revision: string;
  /** WebLLM only; null for a Combination that loads no model library. */
  readonly model_lib_url: string | null;
}

export type PinnedFetchResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'model_load_failed'; readonly detail: 'unpinned_fetch'; readonly offending: readonly string[] };

const HF_HOSTS: ReadonlySet<string> = new Set(['huggingface.co', 'www.huggingface.co']);
const LIB_REPO = 'binary-mlc-llm-libs';

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** A request to the MLC model-library repository (raw or github host). */
export function isModelLibRequest(url: string): boolean {
  const u = parse(url);
  return u !== null && (u.hostname === 'raw.githubusercontent.com' || u.hostname === 'github.com') && u.pathname.includes(`/${LIB_REPO}/`);
}

export const isHuggingFaceRequest = (url: string): boolean => HF_HOSTS.has(parse(url)?.hostname ?? '');

const RESOLVE_CACHE = /^\/api\/resolve-cache\/models\/[^/]+\/[^/]+\/([0-9a-f]{40})\//;

/** True when this one request is allowed under the pin. */
export function requestIsPinned(url: string, pin: PinnedFetchPin): boolean {
  if (isHuggingFaceRequest(url)) {
    if (pin.revision === '') return false;
    const u = parse(url) as URL;
    const cache = RESOLVE_CACHE.exec(u.pathname);
    if (cache !== null) return cache[1] === pin.revision;
    return u.pathname.includes(`/resolve/${pin.revision}/`);
  }
  if (isModelLibRequest(url)) return pin.model_lib_url !== null && url === pin.model_lib_url;
  return true;
}

/** Fails exactly when some Hugging Face request lacks `/resolve/<revision>/` or some library request differs from `model_lib_url`. */
export function checkPinnedFetch(requestUrls: readonly string[], pin: PinnedFetchPin): PinnedFetchResult {
  const offending = requestUrls.filter((u) => !requestIsPinned(u, pin));
  return offending.length === 0 ? { ok: true } : { ok: false, code: 'model_load_failed', detail: 'unpinned_fetch', offending };
}
