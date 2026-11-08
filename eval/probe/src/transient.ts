// The one matcher for transient network errors (Author, 2026-11-07, after a transient error wrongly
// excluded Qwen3.5-2B; extended 2026-11-08). A fetch that died on the wire (`TypeError: network error`,
// `Failed to fetch`, a reset or timed-out connection) says nothing about the model: the weights never
// arrived. No imports, so `results.ts`, `preflight.ts` and `run.ts` can all use it.

const TRANSIENT_NETWORK_RE = /network error|failed to fetch|networkerror|net::err_|econnreset|etimedout|enotfound|eai_again|socket hang up/i;

export const isTransientNetworkError = (message: string): boolean => TRANSIENT_NETWORK_RE.test(message);
