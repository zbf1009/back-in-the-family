import { json } from './handler.ts';
import { readRequest } from './http.ts';
import type { ActiveJudgeSession, JudgeRPC } from './judge-contract.ts';
import { decisionObject } from '../../web/src/shared/decision.ts';
import {
  OBITUARY_CLIENT_TIMEOUT_MS, OBITUARY_MAX_TOKENS, OBITUARY_MODEL, OBITUARY_PROMPT_SHA256,
  OBITUARY_PROMPT_VERSION, OBITUARY_RAW_RESPONSE_BYTE_CAP, OBITUARY_REQUEST_BYTE_CAP,
  OBITUARY_SERVER_TIMEOUT_MS, OBITUARY_SYSTEM_PROMPT, OBITUARY_TEMPERATURE,
  parseObituaryRequest, parseObituaryReservation, validateObituaryText,
} from '../../web/src/shared/obituary.ts';
import type { FallbackReason, ObituaryCapabilityV1, ObituaryFactsV1, ObituaryReservation, ObituaryResultV1 } from '../../web/src/shared/obituary.ts';
import { renderObituaryTemplate } from '../../web/src/main/obituary-template.ts';

/** The native AI binding is checked at the judge boundary; no client options enter this port. */
export interface ObituaryAI {
  run(model: typeof OBITUARY_MODEL, input: {
    messages: { role: 'system' | 'user'; content: string }[];
    max_tokens: typeof OBITUARY_MAX_TOKENS;
    temperature: typeof OBITUARY_TEMPERATURE;
    stream: false;
  }, options: { returnRawResponse: true }): Promise<unknown>;
}

export function obituaryFailure(error: FallbackReason, status: number, allow?: string): Response {
  return json({ version: 1, error }, status, allow);
}

export function obituaryCapability(session: ActiveJudgeSession, inferenceEnabled: boolean): Response {
  const exhausted = session.quota.daily_remaining === 0 || session.quota.session_remaining === 0;
  const capability: ObituaryCapabilityV1 = {
    version: 1, enabled: inferenceEnabled && !exhausted, model: OBITUARY_MODEL,
    disabledReason: !inferenceEnabled ? 'disabled' : exhausted ? 'quota_exhausted' : null,
    timeout_ms: OBITUARY_CLIENT_TIMEOUT_MS, quota: session.quota,
  };
  return json(capability);
}

async function providerJson(response: Response): Promise<unknown> {
  if (response.status !== 200 || response.body === null) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Narration provider unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > OBITUARY_RAW_RESPONSE_BYTE_CAP) throw new Error('Narration provider unavailable');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('Narration provider unavailable');
  } finally { reader.releaseLock(); }
}

async function narrate(ai: ObituaryAI, facts: ObituaryFactsV1, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<ObituaryResultV1> {
  const identity = { model: OBITUARY_MODEL, promptVersion: OBITUARY_PROMPT_VERSION, promptSha256: OBITUARY_PROMPT_SHA256 };
  const template = (reason: FallbackReason): ObituaryResultV1 => ({
    ...identity, source: 'template', fallbackReason: reason, text: renderObituaryTemplate(facts),
  });
  const deadline = performance.now() + OBITUARY_SERVER_TIMEOUT_MS;
  const timeout = Promise.withResolvers<ObituaryResultV1>();
  const timer = setTimeout(() => timeout.resolve(template('timeout')), OBITUARY_SERVER_TIMEOUT_MS);
  const work = (async (): Promise<ObituaryResultV1> => {
    try {
      const response = await ai.run(OBITUARY_MODEL, {
        messages: [{ role: 'system', content: OBITUARY_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(facts) }],
        max_tokens: OBITUARY_MAX_TOKENS, temperature: OBITUARY_TEMPERATURE, stream: false,
      }, { returnRawResponse: true });
      if (!(response instanceof Response)) return template('provider_error');
      const raw = await providerJson(response);
      if (!decisionObject(raw) || typeof raw.response !== 'string'
        || (Object.hasOwn(raw, 'tool_calls') && (!Array.isArray(raw.tool_calls) || raw.tool_calls.length !== 0))) {
        return template('invalid_output');
      }
      const checked = validateObituaryText(raw.response, facts);
      return checked.ok ? { ...identity, source: 'model', fallbackReason: null, text: checked.text } : template(checked.reason);
    } catch { return template('provider_error'); }
  })();
  // Observe the whole provider/body operation even when the logical response wins first.
  ctx?.waitUntil(work.then(() => {}));
  try {
    const result = await Promise.race([work, timeout.promise]);
    // Delayed timers cannot admit prose that finished after the logical deadline.
    return performance.now() >= deadline ? template('timeout') : result;
  } finally { clearTimeout(timer); }
}

// workerd adds a native disposer symbol to RPC results. It is transport lifetime
// metadata, not a JSON wire field; every other own key still reaches the closed parser.
const rpcDisposeSymbol: unknown = Reflect.get(Symbol, 'dispose');
function rpcDataObject(value: unknown): Record<string, unknown> | null {
  if (!decisionObject(value)) return null;
  const keys = Reflect.ownKeys(value);
  let hasDisposer = false;
  for (const key of keys) {
    if (typeof key !== 'symbol') continue;
    if (key !== rpcDisposeSymbol || typeof Reflect.get(value, key) !== 'function') return null;
    hasDisposer = true;
  }
  return hasDisposer ? Object.fromEntries(keys.filter((key): key is string => typeof key === 'string')
    .map(key => [key, value[key]])) : value;
}
function reservationWire(value: unknown): ObituaryReservation | null {
  const wire = rpcDataObject(value);
  if (wire === null) return null;
  if (Object.hasOwn(wire, 'quota')) {
    const quota = rpcDataObject(wire.quota);
    if (quota === null) return null;
    if (quota !== wire.quota) return parseObituaryReservation({ ...wire, quota });
  }
  return parseObituaryReservation(wire);
}

/** Authentication/configuration and origin checks have already succeeded in the judge dispatcher. */
export async function handleObituaryPost(
  request: Request, ai: ObituaryAI, gate: JudgeRPC, tokenHash: string, epoch: string,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
  if (!/^\s*application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get('Content-Type') ?? '')) {
    return obituaryFailure('request_invalid', 400);
  }
  const body = await readRequest(request, OBITUARY_REQUEST_BYTE_CAP);
  if (!body.ok) return obituaryFailure(body.kind === 'payload_too_large' ? 'request_too_large' : 'request_invalid', body.kind === 'payload_too_large' ? 413 : 400);
  const parsed = parseObituaryRequest(body.value);
  if (parsed === null) return obituaryFailure('request_invalid', 400);
  let reserved: ObituaryReservation | null;
  let rawReservation: unknown;
  try {
    rawReservation = await gate.reserveObituary(tokenHash, epoch, parsed.operationKey);
    reserved = reservationWire(rawReservation);
  } catch { return obituaryFailure('admission_unavailable', 503); }
  finally {
    if (typeof rpcDisposeSymbol === 'symbol' && decisionObject(rawReservation)) {
      const dispose: unknown = Reflect.get(rawReservation, rpcDisposeSymbol);
      if (typeof dispose === 'function') Reflect.apply(dispose, rawReservation, []);
    }
  }
  if (reserved === null) return obituaryFailure('admission_unavailable', 503);
  if (reserved.kind === 'anonymous') return obituaryFailure('anonymous', 401);
  if (reserved.kind === 'duplicate') return obituaryFailure('duplicate', 409);
  if (reserved.kind === 'rate_limited') return obituaryFailure('quota_exhausted', 429);
  const result = await narrate(ai, parsed.facts, ctx);
  return json({ version: 1, operationKey: parsed.operationKey, result, quota: reserved.quota });
}
