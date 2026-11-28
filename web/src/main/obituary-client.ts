import { OBITUARY_CLIENT_TIMEOUT_MS, OBITUARY_MODEL, OBITUARY_PROMPT_SHA256, OBITUARY_PROMPT_VERSION,
  OBITUARY_RAW_RESPONSE_BYTE_CAP, OBITUARY_REQUEST_BYTE_CAP, parseObituaryCapability, parseObituaryError,
  parseObituaryReply, validateObituaryText, type FallbackReason, type ObituaryCapabilityV1 } from '../shared/obituary.ts';
import { ObituaryRun, obituaryTemplateResult, type ObituaryEntry } from './obituary-store.ts';

export interface ObituaryCapabilityState { capability: ObituaryCapabilityV1 | null; reason: FallbackReason | null }
export interface ObituaryTransport {
  fetch: typeof fetch;
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(handle: number): void;
}
const browserTransport: ObituaryTransport = { fetch: (...args) => fetch(...args), now: () => performance.now(),
  setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds), clearTimeout: handle => window.clearTimeout(handle) };
const encoder = new TextEncoder();

async function readJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new Error('Empty obituary response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > OBITUARY_RAW_RESPONSE_BYTE_CAP) {
        await reader.cancel();
        throw new Error('Oversized obituary response.');
      }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { reader.releaseLock(); }
}
export async function fetchObituaryCapability(transport: ObituaryTransport = browserTransport): Promise<ObituaryCapabilityState> {
  try {
    const response = await transport.fetch('/api/judge/obituary/config', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    });
    if (response.status === 404) return { capability: null, reason: 'public' };
    if (response.status === 401) return { capability: null, reason: 'anonymous' };
    if (!response.ok) return { capability: null, reason: 'capability_unavailable' };
    const capability = parseObituaryCapability(await readJson(response));
    return capability === null ? { capability: null, reason: 'capability_unavailable' } : { capability, reason: null };
  } catch { return { capability: null, reason: 'capability_unavailable' }; }
}

/** 调用者先同步 admit；此处不持有模拟票据、时钟或场景选择权。 */
export async function startObituaryAttempt(run: ObituaryRun, entry: ObituaryEntry, capability: ObituaryCapabilityState | Promise<ObituaryCapabilityState>,
  changed: () => void, transport: ObituaryTransport = browserTransport): Promise<void> {
  const started = transport.now();
  const bytes = encoder.encode(`${run.runId}\0${entry.death.eventId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const operationKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  run.setOperationKey(entry, operationKey);
  const fallback = (reason: FallbackReason, attempted = false): void => {
    if (run.terminal(entry, obituaryTemplateResult(entry, reason, attempted ? OBITUARY_MODEL : null))) changed();
  };
  const expired = (): boolean => transport.now() - started >= OBITUARY_CLIENT_TIMEOUT_MS;
  const terminal = (): boolean => entry.attempt === 'terminal';
  const remaining = OBITUARY_CLIENT_TIMEOUT_MS - (transport.now() - started);
  if (remaining <= 0) { fallback('timeout'); return; }
  let attempted = false;
  let resolveDeadline!: (value: null) => void;
  const deadline = new Promise<null>(resolve => { resolveDeadline = resolve; });
  const timer = transport.setTimeout(() => { fallback('timeout', attempted); resolveDeadline(null); }, remaining);
  try {
    let eligibility: ObituaryCapabilityState | null;
    try { eligibility = await Promise.race([capability, deadline]); }
    catch { fallback(expired() ? 'timeout' : 'capability_unavailable'); return; }
    if (eligibility === null || expired() || terminal()) { fallback('timeout'); return; }
    const current = eligibility.capability;
    if (current === null) { fallback(eligibility.reason ?? 'capability_unavailable'); return; }
    if (!current.enabled) {
      fallback(current.disabledReason === 'quota_exhausted' ? 'quota_exhausted' : 'disabled');
      return;
    }
    const body = JSON.stringify({ version: 1, operationKey, facts: entry.facts });
    if (encoder.encode(body).byteLength > OBITUARY_REQUEST_BYTE_CAP) { fallback('request_too_large'); return; }
    attempted = true;
    let response: Response;
    try {
      response = await transport.fetch('/api/obituary', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', headers: { 'Content-Type': 'application/json' }, body });
    } catch { fallback(expired() ? 'timeout' : 'network', true); return; }
    if (expired() || terminal()) { fallback('timeout', true); return; }
    let value: unknown;
    try { value = await readJson(response); }
    catch { fallback(expired() ? 'timeout' : 'invalid_output', true); return; }
    if (expired() || terminal()) { fallback('timeout', true); return; }
    if (!response.ok) {
      const error = parseObituaryError(value);
      fallback(error?.error ?? 'invalid_output');
      return;
    }
    const reply = parseObituaryReply(value);
    if (reply === null || reply.operationKey !== operationKey || reply.result.promptVersion !== OBITUARY_PROMPT_VERSION
      || reply.result.promptSha256 !== OBITUARY_PROMPT_SHA256) { fallback('invalid_output', true); return; }
    if (reply.result.source === 'template') {
      if (reply.result.text !== entry.template) { fallback('invalid_output', true); return; }
    } else {
      const text = validateObituaryText(reply.result.text, entry.facts);
      if (!text.ok) { fallback(text.reason, true); return; }
      if (text.text !== reply.result.text) { fallback('invalid_output', true); return; }
    }
    if (run.terminal(entry, reply.result)) changed();
  } finally { transport.clearTimeout(timer); }
}
