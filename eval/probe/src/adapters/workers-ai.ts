// Workers AI adapter (llm-probe task 17.1; design "Workers AI adapter", R8.6, R11.1, R11.9, R11.11,
// R11.15-R11.18, R11.21). Runs in the Node process and sends one `POST /ai/run/<model>` per call.
//
// Rules this file keeps:
//   - fetch and the clock are injected; nothing here reads the environment or the `env` file.
//   - The Secret values are revealed only to build the URL and the Authorization header.
//   - Raw text comes from exactly one field of the declared Response_Shape. No parsed value is ever
//     serialized, and no reasoning field, tool call or other field reaches the outcome.
//   - An HTTP error or rate limit becomes an `error` with the status and the first API error code.
//     No headers, no token, no retry, and no response message text in `detail`.
//   - At the Timeout the request is aborted: `late = none (aborted)`, and the request still counts.
//   - Budget reserve/settle belongs to the run flow (run.ts); `budgetInputs` and `toBudgetUsage` give it
//     what it needs from a Combination and a result.
import { estimateNeurons, type Usage as BudgetUsage } from '../budget.ts';
import { isWorkersAi, type Combination, type ResponseShape } from '../phase.ts';
import { printErrorLine, registerSecrets } from '../sink.ts';
import { EnvError, loadWorkersAiEnv, type WorkersAiEnv } from '../env.ts';
import { redact, type Secret } from '../redact.ts';
import type { RuntimeContext, RuntimeFactory, RuntimeHandle } from '../run.ts';
import type { JsonObject } from '../results.ts';
import type {
  AdapterErrorCode,
  AdapterResult,
  AdapterState,
  Prompt,
  RequestOptions,
  RuntimeAdapter,
  RuntimeIdentity,
  SamplingParams,
  Usage,
} from './interface.ts';

export const WORKERS_AI_SEED = 20261104;
export const WORKERS_AI_REVISION = 'server-side, not pinnable';
export const WORKERS_AI_RUNTIME_VERSION = 'cloudflare-rest-v4';
export const API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
export const MAX_OUTPUT_PARAMS = ['max_tokens', 'max_completion_tokens'] as const;
export type MaxOutputParam = (typeof MAX_OUTPUT_PARAMS)[number];

// ---------------------------------------------------------------- injected capabilities

/** The subset of `Response` the adapter reads. The real `fetch` satisfies it. */
export interface FetchResponseLike {
  readonly status: number;
  text(): Promise<string>;
}
export interface FetchInit {
  readonly method: 'POST';
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

/** Time source and timer. `createFakeClock()` from adapters/fake.ts fits. */
export interface AdapterClock {
  now(): number;
  /** Calls `fn` after `ms`; the returned function cancels it. */
  setTimer(ms: number, fn: () => void): () => void;
}

export const realClock: AdapterClock = {
  now: () => performance.now(),
  setTimer(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

// ---------------------------------------------------------------- request

export interface RequestBody {
  readonly messages: readonly { readonly role: 'system' | 'user'; readonly content: string }[];
  readonly temperature: number;
  readonly seed: number;
  readonly [key: string]: unknown;
}

/**
 * Body of one request (design: `{ messages, temperature: 0, seed: 20261104, [max_output_param], response_format?,
 * chat_template_kwargs? }`). `response_format` is sent only when the Combination asks for a JSON schema
 * (its `constraint` is `json_schema`, which the Smoke_Calls must have confirmed first); `chat_template_kwargs`
 * only when the Combination has some.
 */
export function buildRequestBody(prompt: Prompt, sampling: SamplingParams, maxParam: MaxOutputParam): RequestBody {
  const body: Record<string, unknown> = {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: sampling.temperature,
    seed: sampling.seed ?? WORKERS_AI_SEED,
    [maxParam]: sampling.maxOutputTokens,
  };
  if (sampling.topP !== null) body['top_p'] = sampling.topP;
  if (sampling.constraint.kind === 'json_schema') body['response_format'] = { type: 'json_schema', json_schema: sampling.constraint.schema };
  if (sampling.chatTemplateKwargs !== null) body['chat_template_kwargs'] = sampling.chatTemplateKwargs;
  return body as unknown as RequestBody;
}

export function requestUrl(accountId: Secret, model: string): string {
  return `${API_BASE}/${accountId.reveal()}/ai/run/${model}`;
}

// ---------------------------------------------------------------- response

export type ParsedResponse =
  | { readonly kind: 'text'; readonly text: string; readonly usage: Usage | null }
  | {
      readonly kind: 'error';
      readonly code: AdapterErrorCode;
      readonly detail: string;
      readonly remote: { readonly status: number; readonly code: string | null } | null;
      readonly usage: Usage | null;
    };

const asObject = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** `usage.prompt_tokens`, `usage.completion_tokens`, and reasoning tokens when present (R11.17). */
export function parseUsage(result: unknown): Usage | null {
  const u = asObject(asObject(result)?.['usage']);
  if (u === null || !isCount(u['prompt_tokens']) || !isCount(u['completion_tokens'])) return null;
  const details = asObject(u['completion_tokens_details']);
  const reasoning = isCount(details?.['reasoning_tokens']) ? (details?.['reasoning_tokens'] as number) : isCount(u['reasoning_tokens']) ? (u['reasoning_tokens'] as number) : null;
  return { inputTokens: u['prompt_tokens'], outputTokens: u['completion_tokens'], reasoningTokens: reasoning };
}

/** First `errors[].code` of a Cloudflare error envelope, as a string; null when there is none. */
export function firstApiErrorCode(envelope: unknown): string | null {
  const errors = asObject(envelope)?.['errors'];
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const code = asObject(errors[0])?.['code'];
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Maps an HTTP status and body text to raw text or an error (design "Raw text", R11.9, R11.15, R11.16, R11.18).
 * `maxTokens` is the requested output limit (used for the `text` shape's truncation rule).
 */
export function parseResponse(shape: ResponseShape, status: number, bodyText: string, maxTokens: number): ParsedResponse {
  const envelope = tryParse(bodyText);
  if (status < 200 || status > 299) {
    const code = firstApiErrorCode(envelope);
    return {
      kind: 'error',
      code: status === 429 ? 'rate_limited' : 'remote_error',
      detail: `HTTP ${status}${code === null ? '' : ` api error ${code}`}`,
      remote: { status, code },
      usage: null,
    };
  }
  const env = asObject(envelope);
  if (env === null) return { kind: 'error', code: 'non_text_response', detail: 'unparsable_body', remote: { status, code: null }, usage: null };
  if (env['success'] === false) {
    const code = firstApiErrorCode(env);
    return { kind: 'error', code: 'remote_error', detail: `HTTP ${status} success=false${code === null ? '' : ` api error ${code}`}`, remote: { status, code }, usage: null };
  }
  const result = asObject(env['result']);
  if (result === null) return { kind: 'error', code: 'non_text_response', detail: 'missing_result', remote: null, usage: null };
  const usage = parseUsage(result);
  const fail = (code: AdapterErrorCode, detail: string): ParsedResponse => ({ kind: 'error', code, detail, remote: null, usage });

  if (shape === 'chat') {
    const choices = result['choices'];
    const choice = Array.isArray(choices) ? asObject(choices[0]) : null;
    if (choice === null) return fail('non_text_response', 'missing_choices');
    // finish_reason first, so a cut-off string is never graded as text.
    if (choice['finish_reason'] === 'length') return fail('truncated', 'finish_reason length');
    const content = asObject(choice['message'])?.['content'];
    if (content === null || content === undefined || content === '') return fail('empty_content', 'empty content');
    if (typeof content !== 'string') return fail('non_text_response', 'content is not a string');
    return { kind: 'text', text: content, usage };
  }

  // shape === 'text': granite has no finish_reason, so the token count decides truncation.
  if (usage !== null && usage.outputTokens >= maxTokens) return fail('truncated', 'completion_tokens reached max_tokens');
  const response = result['response'];
  if (response === null || response === undefined || response === '') return fail('empty_content', 'empty response');
  if (typeof response !== 'string') return fail('non_text_response', 'response is not a string');
  return { kind: 'text', text: response, usage };
}

// ---------------------------------------------------------------- budget helpers (used by the run flow)

/** Prices of a Workers AI Combination; throws when the Combination has none. */
export function workersAiPrices(combo: Combination): { readonly inputPrice: number; readonly outputPrice: number } {
  if (combo.prices === undefined) throw new Error(`combinations.json: ${combo.id}: prices are required for a Workers AI Combination`);
  return { inputPrice: combo.prices.input, outputPrice: combo.prices.output };
}

/** Neuron estimate of one request before it is sent (R11.13). */
export function budgetInputs(combo: Combination, prompt: Prompt, sampling: SamplingParams): { readonly promptBytes: number; readonly maxOutputTokens: number; readonly estimate: number } {
  const promptBytes = Buffer.byteLength(prompt.system, 'utf8') + Buffer.byteLength(prompt.user, 'utf8');
  const { inputPrice, outputPrice } = workersAiPrices(combo);
  return { promptBytes, maxOutputTokens: sampling.maxOutputTokens, estimate: estimateNeurons({ promptBytes, maxOutputTokens: sampling.maxOutputTokens, inputPrice, outputPrice }) };
}

/** Adapter usage -> the usage `BudgetSession.settle` takes. */
export function toBudgetUsage(u: Usage): BudgetUsage {
  return { promptTokens: u.inputTokens, completionTokens: u.outputTokens, reasoningTokens: u.reasoningTokens };
}

// ---------------------------------------------------------------- adapter

export interface WorkersAiAdapterOptions {
  readonly combo: Combination;
  readonly token: Secret;
  readonly accountId: Secret;
  readonly fetch: FetchLike;
  readonly clock?: AdapterClock;
}

function maxParamOf(combo: Combination): MaxOutputParam {
  const name = combo.max_output_param?.name;
  if (name !== 'max_tokens' && name !== 'max_completion_tokens') {
    throw new Error(`combinations.json: ${combo.id}: max_output_param.name must be max_tokens or max_completion_tokens`);
  }
  return name;
}

export class WorkersAiAdapter implements RuntimeAdapter {
  readonly #combo: Combination;
  readonly #shape: ResponseShape;
  readonly #maxParam: MaxOutputParam;
  readonly #token: Secret;
  readonly #accountId: Secret;
  readonly #fetch: FetchLike;
  readonly #clock: AdapterClock;
  #inFlight = 0;

  constructor(o: WorkersAiAdapterOptions) {
    if (!isWorkersAi(o.combo)) throw new Error(`"${o.combo.id}" is not a Workers AI Combination`);
    if (o.combo.response_shape === undefined) throw new Error(`combinations.json: ${o.combo.id}: response_shape is required`);
    this.#combo = o.combo;
    this.#shape = o.combo.response_shape;
    this.#maxParam = maxParamOf(o.combo);
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

  async complete(prompt: Prompt, options: RequestOptions): Promise<AdapterResult> {
    this.#inFlight += 1;
    const t0 = this.#clock.now();
    const elapsed = (): number => Math.max(0, Math.ceil(this.#clock.now() - t0));
    const controller = new AbortController();
    let cancelTimer: () => void = () => undefined;
    const timeout = new Promise<AdapterResult>((resolve) => {
      cancelTimer = this.#clock.setTimer(options.timeoutMs, () => {
        controller.abort();
        resolve({ kind: 'timeout', timeoutMs: options.timeoutMs, elapsedMs: elapsed(), late: Promise.resolve({ kind: 'none', reason: 'aborted' }) });
      });
    });
    try {
      return await Promise.race([this.#send(prompt, options, controller.signal, elapsed), timeout]);
    } finally {
      cancelTimer();
      this.#inFlight -= 1;
    }
  }

  /** Never rejects: every failure becomes an `error` result with a redacted detail. */
  async #send(prompt: Prompt, options: RequestOptions, signal: AbortSignal, elapsed: () => number): Promise<AdapterResult> {
    const secrets = [this.#token, this.#accountId];
    const body = JSON.stringify(buildRequestBody(prompt, options.sampling, this.#maxParam));
    let status: number;
    let text: string;
    try {
      const res = await this.#fetch(requestUrl(this.#accountId, this.#combo.model_id), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#token.reveal()}`, 'Content-Type': 'application/json' },
        body,
        signal,
      });
      status = res.status;
      text = await res.text();
    } catch (e) {
      const name = e instanceof Error ? e.name : typeof e;
      return { kind: 'error', code: 'remote_error', detail: redact(`network error (${name})`, secrets), elapsedMs: elapsed(), remote: null };
    }
    const parsed = parseResponse(this.#shape, status, text, options.sampling.maxOutputTokens);
    if (parsed.kind === 'text') return { kind: 'text', text: parsed.text, latencyMs: elapsed(), usage: parsed.usage };
    return { kind: 'error', code: parsed.code, detail: redact(parsed.detail, secrets), elapsedMs: elapsed(), remote: parsed.remote, usage: parsed.usage };
  }
}

// ---------------------------------------------------------------- Runtime factory

export interface WorkersAiRuntimeOptions {
  /** Default: `loadWorkersAiEnv()` (the root `env` file). Called once, when the first Workers AI Combination starts. */
  readonly loadEnv?: () => WorkersAiEnv;
  /** Default: the global `fetch`. */
  readonly fetch?: FetchLike;
  readonly clock?: AdapterClock;
}

/** Model_Fingerprint fields of a Workers AI run (no credentials, no account ID). */
export function workersAiFingerprint(combo: Combination): JsonObject {
  const param = maxParamOf(combo);
  return {
    measurement: 'node',
    seed: WORKERS_AI_SEED,
    response_shape: combo.response_shape ?? null,
    max_output_param: param,
    endpoint: 'ai/run',
    response_format_sent: combo['constraint'] === 'json_schema',
    placement: 'n/a',
    revision_note: WORKERS_AI_REVISION,
  };
}

/**
 * RuntimeFactory for `workers-ai`. It reads the credentials lazily, only when a Workers AI Combination starts
 * (R11.2). A missing file or variable prints the message (it names the file or variable only) and rethrows, so
 * the run ends with exit code 1 before any request or ledger entry (R11.4). It sends nothing itself.
 */
export function createWorkersAiRuntime(options: WorkersAiRuntimeOptions = {}): RuntimeFactory {
  let env: WorkersAiEnv | null = null;
  return async (ctx: RuntimeContext): Promise<RuntimeHandle> => {
    if (!isWorkersAi(ctx.combo)) throw new Error(`"${ctx.combo.runtime}" is not a Workers AI Runtime`);
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
    const adapter = new WorkersAiAdapter({
      combo: ctx.combo,
      token: env.token,
      accountId: env.accountId,
      fetch: fetchImpl,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    return {
      adapter,
      source: 'node',
      fingerprint: workersAiFingerprint(ctx.combo),
      placement: null,
      // Nothing to download or warm up: the model runs on Cloudflare's side.
      load: () => Promise.resolve(),
    };
  };
}
