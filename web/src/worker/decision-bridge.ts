/// <reference lib="es2024.promise" />
import { DECISION_CONTRACT } from '../shared/decision-contract.ts';
import {
  CONFIG_PREFETCH_TIMEOUT_MS, DEFAULT_DECISION_WAIT_SECONDS, DECISION_REQUEST_VERSION,
  DECISION_WIRE_BOUNDS, decisionObject, isDecisionConfig, isDecisionError,
  isDecisionRequest, isModelDecision,
  type DecisionConfig, type DecisionFamily, type DecisionFallbackReason, type DecisionOutcome,
  type DecisionRequest, type DecisionSessionStatus, type ModelDecision,
} from '../shared/decision.ts';

export interface DecisionClient {
  config(signal: AbortSignal): Promise<DecisionConfig>;
  decide(request: DecisionRequest, signal: AbortSignal): Promise<ModelDecision>;
}
export interface DecisionWasm {
  llm_render_system_one(input: string): string;
  llm_validate(input: string): string;
}
/** Read-only transport from WasmSim.preview_node; no TS option/default calculation. */
export interface DecisionPreview {
  ok: true;
  family: DecisionFamily;
  trigger: string;
  frozen_context: unknown;
  option_ids: string[];
  option_defs: unknown[];
  rules_default: string;
}
export interface DecisionTiming {
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}
const browserTiming: DecisionTiming = {
  now: () => performance.now(),
  schedule: (callback, milliseconds) => {
    const handle = globalThis.setTimeout(callback, milliseconds);
    return () => globalThis.clearTimeout(handle);
  },
};
/** Fixed classifications only; never propagate provider or prompt text. */
export class DecisionFailure extends Error {
  readonly kind: DecisionFallbackReason;
  constructor(kind: DecisionFallbackReason) {
    super(kind);
    this.name = 'DecisionFailure';
    this.kind = kind;
  }
}
/** A thrown WASM call is not a typed render/validation rejection. */
class DecisionWasmFailure extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'DecisionWasmFailure';
  }
}
function fail(kind: DecisionFallbackReason): never { throw new DecisionFailure(kind); }
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) fail('cancelled');
}

async function readPublicJson(response: Response, signal: AbortSignal): Promise<unknown> {
  checkAbort(signal);
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json' || response.body === null) {
    void response.body?.cancel().catch(() => {});
    fail('invalid_response');
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const bytes = new Uint8Array(DECISION_WIRE_BOUNDS.responseBytes);
  let length = 0;
  try {
    for (;;) {
      checkAbort(signal);
      const chunk = await reader.read();
      checkAbort(signal);
      if (chunk.done) break;
      if (chunk.value.byteLength > bytes.byteLength - length) {
        cancel();
        fail('invalid_response');
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
      checkAbort(signal);
      return value;
    } catch (error) {
      if (error instanceof DecisionFailure) throw error;
      fail('invalid_response');
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Origin comes from the owning worker's location, never from game data/config. */
export function createSameOriginDecisionClient(origin: string, fetcher: typeof fetch = globalThis.fetch): DecisionClient {
  const base = new URL(origin);
  if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.origin !== origin) {
    fail('unavailable');
  }
  async function send(path: string, signal: AbortSignal, request?: DecisionRequest): Promise<unknown> {
    checkAbort(signal);
    if (request !== undefined && !isDecisionRequest(request)) fail('malformed_request');
    const body = request === undefined ? undefined : JSON.stringify(request);
    if (body !== undefined && new TextEncoder().encode(body).byteLength > DECISION_WIRE_BOUNDS.requestBytesCeiling) {
      fail('payload_too_large');
    }
    let response: Response | undefined;
    try {
      response = await fetcher(new URL(path, base).href, {
        method: request === undefined ? 'GET' : 'POST', signal, body,
        headers: request === undefined ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' },
        mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      });
      checkAbort(signal);
      try {
        if (response.redirected || (response.url !== '' && new URL(response.url).origin !== base.origin)) fail('invalid_response');
      } catch {
        fail('invalid_response');
      }
      const value = await readPublicJson(response, signal);
      if (response.status !== 200) {
        if (isDecisionError(value, response.status)) fail(value.error.kind);
        fail('invalid_response');
      }
      return value;
    } catch (error) {
      if (response?.body !== null && response?.body !== undefined && !response.body.locked) {
        void response.body.cancel().catch(() => {});
      }
      if (signal.aborted) fail('cancelled');
      if (error instanceof DecisionFailure) throw error;
      fail('network');
    }
  }
  return {
    async config(signal) {
      const value = await send('/api/decision/config', signal);
      if (!isDecisionConfig(value)) fail('invalid_response');
      return value;
    },
    async decide(request, signal) {
      const value = await send('/api/decision', signal, request);
      if (!isModelDecision(value, request)) fail('invalid_response');
      return value;
    },
  };
}

/**
 * One instance per page document (Sim_Worker lifetime), not per World.
 * Owns only config, budget and wait preference. The controller must lock before
 * preview and own checked commit/cancellation; this module never mutates a Sim,
 * commits inputs, changes pacing or maintains a transaction lock.
 */
export class DecisionBridge {
  private readonly client: DecisionClient;
  private readonly wasm: DecisionWasm;
  private readonly mapping: string;
  private readonly timing: DecisionTiming;
  private readonly document = new AbortController();
  private configState: DecisionSessionStatus['config'] = 'pending';
  private configValue: DecisionConfig | null = null;
  private spent = 0;
  private waitSeconds = DEFAULT_DECISION_WAIT_SECONDS;

  constructor(client: DecisionClient, wasm: DecisionWasm, mapping: string, timing: DecisionTiming = browserTiming) {
    this.client = client;
    this.wasm = wasm;
    this.mapping = mapping;
    this.timing = timing;
    void this.deadline(async signal => {
      const config = await this.client.config(signal);
      checkAbort(signal);
      if (!isDecisionConfig(config)) fail('invalid_response');
      return { ...config };
    }, CONFIG_PREFETCH_TIMEOUT_MS).then(config => {
      if (this.document.signal.aborted) return;
      this.configValue = config;
      this.configState = 'ready';
    }, () => {
      if (!this.document.signal.aborted) this.configState = 'unavailable';
    });
  }

  status(): DecisionSessionStatus {
    return { config: this.configState, enabled: this.configValue?.enabled ?? false,
      sessionCap: this.configValue?.session_cap ?? null, spent: this.spent, waitSeconds: this.waitSeconds };
  }
  setWaitSeconds(seconds: number): void {
    // Invalid direct adapter calls leave the bounded future preference intact.
    if (Number.isFinite(seconds)) this.waitSeconds = Math.min(10, Math.max(0, seconds));
  }
  /** A synchronous readiness snapshot: callers need not preview/lock on fallback. */
  fallbackReason(): DecisionFallbackReason | null {
    if (this.document.signal.aborted) return 'cancelled';
    if (this.configState === 'pending') return 'config_pending';
    if (this.configValue === null) return 'unavailable';
    if (!this.configValue.enabled) return 'disabled';
    if (this.waitSeconds === 0) return 'zero_wait';
    if (this.spent >= this.configValue.session_cap) return 'session_cap';
    return null;
  }
  dispose(): void {
    this.configState = 'disposed';
    this.document.abort();
  }

  async decide(preview: DecisionPreview, signal: AbortSignal): Promise<DecisionOutcome> {
    const reason = signal.aborted ? 'cancelled' : this.fallbackReason();
    if (reason !== null) return { kind: 'fallback', reason };
    const waitMilliseconds = this.waitSeconds * 1000;
    let request: DecisionRequest;
    let renderedJson: string;
    try {
      renderedJson = this.wasm.llm_render_system_one(JSON.stringify({
        frozen_context: preview.frozen_context, mapping: this.mapping, permutation: 'base',
      }));
    } catch (error) {
      throw new DecisionWasmFailure(error);
    }
    try {
      const rendered: unknown = JSON.parse(renderedJson);
      if (!decisionObject(rendered) || rendered.ok !== true) fail('malformed_request');
      const candidate = {
        version: DECISION_REQUEST_VERSION, family: preview.family,
        mapping_version: DECISION_CONTRACT.mappingVersion, mapping_hash: DECISION_CONTRACT.mappingHash,
        question_id: rendered.question_id, metadata: { bridge_version: 'slow-think-v1' },
        state: rendered.state, instructions: rendered.instructions, criteria: rendered.criteria,
      };
      if (!isDecisionRequest(candidate)) fail('malformed_request');
      if (candidate.criteria.length !== preview.option_ids.length
        || candidate.criteria.some((criterion, index) => criterion.id !== preview.option_ids[index])) fail('malformed_request');
      if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > DECISION_WIRE_BOUNDS.requestBytesCeiling) fail('payload_too_large');
      request = candidate;
    } catch (error) {
      return { kind: 'fallback', reason: error instanceof DecisionFailure ? error.kind : 'malformed_request' };
    }
    if (signal.aborted || this.document.signal.aborted) return { kind: 'fallback', reason: 'cancelled' };
    // Compare before increment; GET is the sole cap source. No refund or retry.
    if (this.spent >= this.configValue!.session_cap) return { kind: 'fallback', reason: 'session_cap' };
    this.spent += 1;
    try {
      const started = this.timing.now();
      const decision = await this.deadline(async requestSignal => {
        const result = await this.client.decide(request, requestSignal);
        checkAbort(requestSignal);
        // An elapsed deadline also wins when the host has not fired its timer yet.
        if (this.timing.now() - started >= waitMilliseconds) fail('timeout');
        if (!isModelDecision(result, request)) fail('invalid_response');
        let validatedJson: string;
        try {
          validatedJson = this.wasm.llm_validate(JSON.stringify({
            frozen_context: preview.frozen_context, mode: 'raw_choice', raw: result.choice,
          }));
        } catch (error) {
          throw new DecisionWasmFailure(error);
        }
        try {
          const validated: unknown = JSON.parse(validatedJson);
          if (!decisionObject(validated) || validated.ok !== true || !decisionObject(validated.verdict)
            || validated.verdict.kind !== 'decision' || validated.verdict.option !== result.choice) fail('invalid_response');
        } catch {
          fail('invalid_response');
        }
        return { ...result, usage: result.usage === null ? null : { ...result.usage } };
      }, waitMilliseconds, signal);
      return { kind: 'model', decision };
    } catch (error) {
      if (error instanceof DecisionWasmFailure) throw error;
      return { kind: 'fallback', reason: error instanceof DecisionFailure ? error.kind : 'invalid_response' };
    }
  }

  private deadline<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const controller = new AbortController();
    let closed = false;
    let cancelTimer = () => {};
    const finish = (error: unknown, value?: T) => {
      if (closed) return;
      closed = true;
      cancelTimer();
      signal?.removeEventListener('abort', abort);
      this.document.signal.removeEventListener('abort', abort);
      if (error !== null) {
        controller.abort();
        reject(error);
      } else resolve(value as T);
    };
    const abort = () => finish(new DecisionFailure('cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    this.document.signal.addEventListener('abort', abort, { once: true });
    if (signal?.aborted || this.document.signal.aborted) {
      abort();
      return promise;
    }
    const start = this.timing.now();
    cancelTimer = this.timing.schedule(() => finish(new DecisionFailure('timeout')), milliseconds);
    try {
      void work(controller.signal).then(value => {
        if (this.timing.now() - start >= milliseconds) finish(new DecisionFailure('timeout'));
        else finish(null, value);
      }, error => {
        if (error instanceof DecisionWasmFailure) finish(error);
        else if (this.timing.now() - start >= milliseconds) finish(new DecisionFailure('timeout'));
        else finish(error instanceof DecisionFailure ? error : new DecisionFailure('network'));
      });
    } catch (error) {
      finish(error instanceof DecisionFailure || error instanceof DecisionWasmFailure ? error : new DecisionFailure('network'));
    }
    return promise;
  }
}
