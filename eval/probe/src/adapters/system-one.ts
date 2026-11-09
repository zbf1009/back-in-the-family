// System One adapter for the Decision_Models (llm-probe task 29; design "Decision_Model adapter and
// System_One_Mapping", R19.6, R19.8, R19.9, R19.11, R19.12; DA-16, DA-19, DA-20). Runs in the Node process and
// sends one `POST /ai/run/@cf/cloudflare/<model>` per decision request.
//
// Rules this file keeps (the fetch and timeout glue and the HTTP error mapping are those of workers-ai.ts):
//   - fetch and the clock are injected; nothing here reads the environment or the `env` file.
//   - The body is built from an ordered list, serialized once, and its UTF-8 length is the `body_bytes` of the
//     truncation checks and of the budget reservation. No sampling member is sent: System One has none.
//   - The Raw_Choice is `result.answers.decision.choice` and nothing else reaches the outcome. `confidence` and
//     `probabilities` are not read at all; the byte-exact body text goes to the separate `systemOne` field.
//   - Before sending: a body longer than the context window is refused (`over_context`, nothing sent).
//     After the response: a truncation flag, an input count below `floor(body_bytes / K)` or above `W` is
//     `truncated_state` and the response is never read for a choice (R19.11).
//   - Budget reserve/settle belongs to the run flow; `systemOneBudgetInputs` gives it what it needs.
import { estimateSystemOneNeurons } from '../budget.ts';
import { EnvError, loadWorkersAiEnv, type WorkersAiEnv } from '../env.ts';
import { isSystemOne, type Combination, type SystemOneCombination } from '../phase.ts';
import { redact, type Secret } from '../redact.ts';
import type { RuntimeContext, RuntimeFactory, RuntimeHandle } from '../run.ts';
import type { JsonObject } from '../results.ts';
import { printErrorLine, registerSecrets } from '../sink.ts';
import type {
  AdapterRequest,
  AdapterResult,
  AdapterState,
  DecisionAdapter,
  DecisionRequest,
  Prompt,
  RuntimeIdentity,
  SystemOneExtra,
  TimeoutOptions,
  Usage,
} from './interface.ts';
import {
  openEnvelope,
  postJson,
  realClock,
  requestUrl,
  runWithTimeout,
  WORKERS_AI_REVISION,
  WORKERS_AI_RUNTIME_VERSION,
  type AdapterClock,
  type FetchLike,
} from './workers-ai.ts';

export const SYSTEM_ONE_QUESTION_ID = 'decision';
export const LOWER_BOUND_RULE = 'floor(body_bytes / max_bytes_per_token)';

const asObject = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------- request body

/** A key that JavaScript would move to the front of an object (a canonical array index): it would break the Permutation order. */
const INTEGER_LIKE = /^(0|[1-9][0-9]*)$/;

/**
 * The serialized request body (design: `{ model, state, questions: { decision: { type: "choice", instructions,
 * criteria } } }`). `criteria` maps option ID to label in the Permutation's order. Throws on an integer-like or
 * repeated option ID: the object would not keep the order (or would lose an option).
 */
export function buildSystemOneBody(modelSelector: string, request: DecisionRequest): string {
  const criteria: Record<string, string> = {};
  for (const o of request.options) {
    if (INTEGER_LIKE.test(o.id)) throw new Error(`option ID "${o.id}" is integer-like and would not keep the Permutation order in criteria`);
    if (has(criteria, o.id)) throw new Error(`option ID "${o.id}" appears twice`);
    criteria[o.id] = o.label;
  }
  const body = {
    model: modelSelector,
    state: request.state,
    questions: { [request.questionId]: { type: 'choice', instructions: request.instructions, criteria } },
  };
  return JSON.stringify(body);
}

/** UTF-8 length of a serialized body: the `body_bytes` of R19.11 and R19.12. */
export const bodyBytesOf = (body: string): number => Buffer.byteLength(body, 'utf8');

/**
 * Builds the `decision` request from the pieces `llm_render_system_one` returns (its `criteria` is an array of
 * `{id, label}` in the Permutation's order).
 */
export function decisionRequestFrom(rendered: {
  readonly state: string;
  readonly instructions: string;
  readonly question_id: string;
  readonly criteria: readonly { readonly id: string; readonly label: string }[];
}): DecisionRequest {
  return { kind: 'decision', state: rendered.state, instructions: rendered.instructions, questionId: rendered.question_id, options: rendered.criteria.map((c) => ({ id: c.id, label: c.label })) };
}

// ---------------------------------------------------------------- truncation checks (R19.11, pure)

/** Pre-check: true when the body is refused. Exactly `W` bytes is accepted; one more is refused. */
export const isOverContext = (bodyBytes: number, contextWindowTokens: number): boolean => bodyBytes > contextWindowTokens;

/**
 * Card IDs (first appearance order, each once) of the requests the pre-check refuses. A Locked_Run with any such
 * Card refuses before the ledger `start` entry and lists them all (R3.15, RC-11); a Dev_Run records them `not_run`.
 */
export function overContextCardIds(requests: readonly { readonly cardId: string; readonly bodyBytes: number }[], contextWindowTokens: number): string[] {
  const out: string[] = [];
  for (const r of requests) if (isOverContext(r.bodyBytes, contextWindowTokens) && !out.includes(r.cardId)) out.push(r.cardId);
  return out;
}

/** Lower bound of the input tokens a complete request must show: `floor(body_bytes / K)`. */
export const inputTokenLowerBound = (bodyBytes: number, maxBytesPerToken: number): number => Math.floor(bodyBytes / maxBytesPerToken);

export type TruncationCondition = 'truncated_flag' | 'input_below_lower_bound' | 'input_above_window';

export type PostCheck = { readonly fault: false } | { readonly fault: true; readonly condition: TruncationCondition; readonly detail: string };

/**
 * Post-check from the response: a fault exactly when the response flags `truncated: true`, or
 * `input_tokens < floor(body_bytes / K)`, or `input_tokens > W`. Equality at either boundary is no fault.
 * `inputTokens` null (usage not reported) skips the two token conditions.
 */
export function postCheckTruncation(a: {
  readonly bodyBytes: number;
  readonly maxBytesPerToken: number;
  readonly contextWindowTokens: number;
  readonly inputTokens: number | null;
  readonly truncatedFlag: boolean;
}): PostCheck {
  const shown = `body_bytes=${a.bodyBytes} input_tokens=${a.inputTokens === null ? 'none' : a.inputTokens}`;
  if (a.truncatedFlag) return { fault: true, condition: 'truncated_flag', detail: `${shown} condition=truncated_flag` };
  if (a.inputTokens === null) return { fault: false };
  const lower = inputTokenLowerBound(a.bodyBytes, a.maxBytesPerToken);
  if (a.inputTokens < lower) return { fault: true, condition: 'input_below_lower_bound', detail: `${shown} condition=input_below_lower_bound lower_bound=${lower}` };
  if (a.inputTokens > a.contextWindowTokens) return { fault: true, condition: 'input_above_window', detail: `${shown} condition=input_above_window window=${a.contextWindowTokens}` };
  return { fault: false };
}

// ---------------------------------------------------------------- response

/** `result.usage.input_tokens` and `output_tokens`; null unless both are non-negative integers (R11.17). */
export function parseSystemOneUsage(result: Record<string, unknown>): Usage | null {
  const u = asObject(result['usage']);
  if (u === null || !isCount(u['input_tokens']) || !isCount(u['output_tokens'])) return null;
  return { inputTokens: u['input_tokens'], outputTokens: u['output_tokens'], reasoningTokens: null };
}

/** True when the envelope, `result` or `result.usage` has a member `truncated` equal to `true` (undocumented, defensive). */
export function truncatedFlagOf(envelope: Record<string, unknown>, result: Record<string, unknown> | null): boolean {
  const usage = result === null ? null : asObject(result['usage']);
  return envelope['truncated'] === true || result?.['truncated'] === true || usage?.['truncated'] === true;
}

const typeName = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** The Raw_Choice of `result.answers.decision.choice`, or the missing or mistyped member (R19.9). */
export function readRawChoice(result: Record<string, unknown>, questionId: string = SYSTEM_ONE_QUESTION_ID): { readonly ok: true; readonly choice: string } | { readonly ok: false; readonly detail: string } {
  const answers = asObject(result['answers']);
  if (answers === null) return { ok: false, detail: has(result, 'answers') ? `answers is not an object (${typeName(result['answers'])})` : 'answers missing' };
  if (!has(answers, questionId)) return { ok: false, detail: `answers.${questionId} missing` };
  const entry = asObject(answers[questionId]);
  if (entry === null) return { ok: false, detail: `answers.${questionId} is not an object (${typeName(answers[questionId])})` };
  if (!has(entry, 'choice')) return { ok: false, detail: `answers.${questionId}.choice missing` };
  const choice = entry['choice'];
  if (typeof choice !== 'string') return { ok: false, detail: `answers.${questionId}.choice is not a string (${typeName(choice)})` };
  return { ok: true, choice };
}

// ---------------------------------------------------------------- budget helpers (used by the run flow)

/** Reservation inputs of one request: the body length and the neuron estimate `ceil((bytes + 256) × price / 1e6)` (R19.12). */
export function systemOneBudgetInputs(combo: SystemOneCombination, body: string): { readonly bodyBytes: number; readonly estimate: number } {
  const bodyBytes = bodyBytesOf(body);
  return { bodyBytes, estimate: estimateSystemOneNeurons({ bodyBytes, inputPrice: combo.prices.input }) };
}

// ---------------------------------------------------------------- adapter

export interface SystemOneAdapterOptions {
  readonly combo: SystemOneCombination;
  readonly token: Secret;
  readonly accountId: Secret;
  readonly fetch: FetchLike;
  readonly clock?: AdapterClock;
}

export class SystemOneAdapter implements DecisionAdapter {
  readonly #combo: SystemOneCombination;
  readonly #token: Secret;
  readonly #accountId: Secret;
  readonly #fetch: FetchLike;
  readonly #clock: AdapterClock;
  #inFlight = 0;

  constructor(o: SystemOneAdapterOptions) {
    if (!isSystemOne(o.combo as Combination)) throw new Error(`"${o.combo.id}" is not a System_One Combination`);
    this.#combo = o.combo;
    this.#token = o.token;
    this.#accountId = o.accountId;
    this.#fetch = o.fetch;
    this.#clock = o.clock ?? realClock;
  }

  identity(): RuntimeIdentity {
    return {
      runtime: this.#combo.runtime,
      runtimeVersion: WORKERS_AI_RUNTIME_VERSION,
      modelId: this.#combo.model_id,
      modelRevision: WORKERS_AI_REVISION, // R11.21
      quantization: this.#combo.quantization,
    };
  }

  state(): AdapterState {
    return this.#inFlight > 0 ? 'busy' : 'idle';
  }

  async complete(request: Prompt | AdapterRequest, options: TimeoutOptions): Promise<AdapterResult> {
    this.#inFlight += 1;
    try {
      return await runWithTimeout(this.#clock, options.timeoutMs, (signal, elapsed) => this.#send(request, signal, elapsed));
    } finally {
      this.#inFlight -= 1;
    }
  }

  /** Never rejects: every failure becomes an `error` result with a redacted detail. */
  async #send(request: Prompt | AdapterRequest, signal: AbortSignal, elapsed: () => number): Promise<AdapterResult> {
    const secrets = [this.#token, this.#accountId];
    const fail = (code: Extract<AdapterResult, { kind: 'error' }>['code'], detail: string, extra: { usage?: Usage | null; systemOne?: SystemOneExtra; remote?: { status: number; code: string | null } | null } = {}): AdapterResult => ({
      kind: 'error',
      code,
      detail: redact(detail, secrets),
      elapsedMs: elapsed(),
      remote: extra.remote ?? null,
      ...(extra.usage === undefined ? {} : { usage: extra.usage }),
      ...(extra.systemOne === undefined ? {} : { systemOne: extra.systemOne }),
    });
    if (!('kind' in request) || request.kind !== 'decision') return fail('runtime_error', 'a Decision_Model takes a decision request');

    let body: string;
    try {
      body = buildSystemOneBody(this.#combo.model_selector, request);
    } catch (e) {
      return fail('runtime_error', `request body: ${e instanceof Error ? e.message : 'invalid'}`);
    }
    const bytes = bodyBytesOf(body);
    if (isOverContext(bytes, this.#combo.context_window_tokens)) {
      return fail('over_context', `body_bytes=${bytes} context_window_tokens=${this.#combo.context_window_tokens}; nothing sent`);
    }

    const posted = await postJson(this.#fetch, requestUrl(this.#accountId, this.#combo.model_id), this.#token, body, signal);
    if (posted.kind === 'network_error') return fail('remote_error', `network error (${posted.name})`);

    const opened = openEnvelope(posted.status, posted.text);
    const ok2xx = posted.status >= 200 && posted.status <= 299;
    if (opened.kind === 'error') {
      // A 2xx body that is no JSON object cannot be a System_One answer.
      if (ok2xx && opened.code === 'non_text_response') return fail('system_one_shape', 'body is not a JSON object', { systemOne: { responseText: redact(posted.text, secrets), usageReported: false } });
      return fail(opened.code, opened.detail, { remote: opened.remote });
    }

    const result = opened.result;
    const usage = result === null ? null : parseSystemOneUsage(result);
    const systemOne: SystemOneExtra = { responseText: redact(posted.text, secrets), usageReported: usage !== null };

    // Truncation first: a possibly cut request is never read for a choice (R19.11).
    const post = postCheckTruncation({
      bodyBytes: bytes,
      maxBytesPerToken: this.#combo.max_bytes_per_token,
      contextWindowTokens: this.#combo.context_window_tokens,
      inputTokens: usage === null ? null : usage.inputTokens,
      truncatedFlag: truncatedFlagOf(opened.envelope, result),
    });
    if (post.fault) return fail('truncated_state', post.detail, { usage, systemOne });

    if (result === null) return fail('system_one_shape', 'result missing', { usage, systemOne });
    const choice = readRawChoice(result, request.questionId);
    if (!choice.ok) return fail('system_one_shape', choice.detail, { usage, systemOne });
    return { kind: 'text', text: choice.choice, latencyMs: elapsed(), usage, systemOne };
  }
}

// ---------------------------------------------------------------- Runtime factory

export interface SystemOneRuntimeOptions {
  /** Default: `loadWorkersAiEnv()` (the root `env` file). Called once, when the first Decision_Model starts. */
  readonly loadEnv?: () => WorkersAiEnv;
  /** Default: the global `fetch`. */
  readonly fetch?: FetchLike;
  readonly clock?: AdapterClock;
}

/**
 * Model_Fingerprint members of a Decision_Model run (design: Decision_Model Combination records and fingerprint).
 * `max_bytes_per_token` is part of it, so a changed value is a different fingerprint ID (R3.10). Credentials and
 * the account ID are not in it. The other members (`sampling` with nulls, `constraint`, `chat_template_kwargs`)
 * come from the Combination record.
 */
export function systemOneFingerprint(combo: SystemOneCombination): JsonObject {
  return {
    measurement: 'node',
    seed: null,
    response_shape: 'system_one',
    // R20.1: each Decision_Variant is its own Combination with its own fingerprint; this is the `single` one.
    variant: 'single',
    max_output_param: null,
    endpoint: 'ai/run',
    response_format_sent: false,
    placement: 'n/a',
    revision_note: WORKERS_AI_REVISION,
    system_one: {
      response_shape: 'system_one',
      model_selector: combo.model_selector,
      question_id: SYSTEM_ONE_QUESTION_ID,
      context_window_tokens: combo.context_window_tokens,
      max_bytes_per_token: combo.max_bytes_per_token,
      lower_bound_rule: LOWER_BOUND_RULE,
    },
  };
}

/** True for a Combination this factory serves. */
export const isSystemOneCombination = (c: Combination): c is SystemOneCombination => isSystemOne(c);

/**
 * RuntimeFactory for the Decision_Models. Reads the credentials lazily, only when a Decision_Model starts
 * (R11.2); a missing file or variable prints the message (it names the file or variable only) and rethrows.
 * It sends nothing itself.
 */
export function createSystemOneRuntime(options: SystemOneRuntimeOptions = {}): RuntimeFactory {
  let env: WorkersAiEnv | null = null;
  return async (ctx: RuntimeContext): Promise<RuntimeHandle> => {
    if (!isSystemOne(ctx.combo)) throw new Error(`"${ctx.combo.id}" is not a System_One Combination`);
    if (env === null) {
      let loaded: WorkersAiEnv;
      try {
        loaded = (options.loadEnv ?? loadWorkersAiEnv)();
      } catch (e) {
        if (e instanceof EnvError) printErrorLine(e.message);
        throw e;
      }
      registerSecrets(loaded.token, loaded.accountId);
      env = loaded;
    }
    const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const adapter = new SystemOneAdapter({
      combo: ctx.combo,
      token: env.token,
      accountId: env.accountId,
      fetch: fetchImpl,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    return {
      adapter,
      source: 'node',
      fingerprint: systemOneFingerprint(ctx.combo),
      placement: null,
      // Nothing to download or warm up: the model runs on Cloudflare's side.
      load: () => Promise.resolve(),
    };
  };
}
