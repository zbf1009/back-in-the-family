// Light smoke tests for the Workers AI adapter (task 17.1). A fake fetch and a fake clock; no network,
// no real env file. Property 39 is task 17.2, the example tests are task 17.3.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createFakeClock } from '../../src/adapters/fake.ts';
import type { Prompt, RequestOptions, SamplingParams } from '../../src/adapters/interface.ts';
import {
  createWorkersAiRuntime,
  buildRequestBody,
  parseResponse,
  WorkersAiAdapter,
  WORKERS_AI_REVISION,
  type FetchInit,
  type FetchLike,
} from '../../src/adapters/workers-ai.ts';
import { EnvError, loadWorkersAiEnv } from '../../src/env.ts';
import type { Combination } from '../../src/phase.ts';
import { Secret } from '../../src/redact.ts';
import { clearSecrets, scrub } from '../../src/sink.ts';

const TOKEN = 'tok-SECRET-1234';
const ACCOUNT = 'acct0123456789abcdef';
const PROMPT: Prompt = { system: 'sys', user: 'usr' };

const combo = (over: Record<string, unknown> = {}): Combination =>
  ({
    id: 'wai-test',
    runtime: 'workers-ai',
    model_id: '@cf/google/gemma-4-26b-a4b-it',
    quantization: 'n/a',
    revision: WORKERS_AI_REVISION,
    phase1_locked: false,
    response_shape: 'chat',
    max_output_param: { name: 'max_completion_tokens', source: 'x' },
    prices: { input: 100, output: 200, source: 'x', read_on: '2026-11-06' },
    chat_template_kwargs: { enable_thinking: false },
    ...over,
  }) as Combination;

const sampling = (over: Partial<SamplingParams> = {}): SamplingParams => ({
  temperature: 0,
  topP: null,
  maxOutputTokens: 64,
  seed: null,
  chatTemplateKwargs: { enable_thinking: false },
  constraint: { kind: 'none' },
  ...over,
});
const opts = (over: Partial<SamplingParams> = {}, timeoutMs = 10_000): RequestOptions => ({ timeoutMs, sampling: sampling(over) });

const reply = (status: number, body: unknown): FetchLike => () => Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) });
const chatBody = (message: unknown, finish = 'stop', usage: unknown = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  success: true,
  result: { choices: [{ message: { content: message }, finish_reason: finish }], usage },
});

function adapter(fetch: FetchLike, c: Combination = combo(), clock = createFakeClock()): WorkersAiAdapter {
  return new WorkersAiAdapter({ combo: c, token: new Secret(TOKEN), accountId: new Secret(ACCOUNT), fetch, clock });
}

afterEach(() => clearSecrets());

test('request: URL, Authorization, body fields from the Combination', async () => {
  let seen: { url: string; init: FetchInit } | null = null;
  const fetch: FetchLike = (url, init) => {
    seen = { url, init };
    return reply(200, chatBody('{"option":"a"}'))(url, init);
  };
  const res = await adapter(fetch).complete(PROMPT, opts({ constraint: { kind: 'json_schema', schema: { type: 'object' } } }));
  assert.equal(res.kind, 'text');
  const s = seen as unknown as { url: string; init: FetchInit };
  assert.equal(s.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/google/gemma-4-26b-a4b-it`);
  assert.equal(s.init.headers['Authorization'], `Bearer ${TOKEN}`);
  const body = JSON.parse(s.init.body) as Record<string, unknown>;
  assert.equal(body['temperature'], 0);
  assert.equal(body['seed'], 20261104);
  assert.equal(body['max_completion_tokens'], 64);
  assert.equal('max_tokens' in body, false);
  assert.deepEqual(body['chat_template_kwargs'], { enable_thinking: false });
  assert.deepEqual(body['response_format'], { type: 'json_schema', json_schema: { type: 'object' } });
});

test('request: no response_format unless asked, no kwargs for granite', () => {
  const body = buildRequestBody(PROMPT, sampling({ chatTemplateKwargs: null }), 'max_tokens') as unknown as Record<string, unknown>;
  assert.equal('response_format' in body, false);
  assert.equal('chat_template_kwargs' in body, false);
  assert.equal(body['max_tokens'], 64);
});

test('request: response_format carries the schema without uniqueItems (API grammar rejects it); the input is not mutated', () => {
  const schema = {
    type: 'object',
    properties: { uniqueItems: { type: 'string' }, evidence: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: '^e[0-9]+$' } } },
  };
  const before = JSON.stringify(schema);
  const body = buildRequestBody(PROMPT, sampling({ constraint: { kind: 'json_schema', schema } }), 'max_completion_tokens') as unknown as { response_format: { type: string; json_schema: unknown } };
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.response_format.json_schema, {
    type: 'object',
    properties: { uniqueItems: { type: 'string' }, evidence: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^e[0-9]+$' } } },
  });
  assert.equal(JSON.stringify(schema), before);
});

test('chat shape: text, usage and reasoning tokens', async () => {
  const usage = { prompt_tokens: 12, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 3 } };
  const res = await adapter(reply(200, chatBody('hello', 'stop', usage))).complete(PROMPT, opts());
  assert.equal(res.kind, 'text');
  if (res.kind === 'text') {
    assert.equal(res.text, 'hello');
    assert.deepEqual(res.usage, { inputTokens: 12, outputTokens: 7, reasoningTokens: 3 });
  }
});

test('chat shape: truncated first, then empty_content, then non_text_response', () => {
  const p = (b: unknown) => parseResponse('chat', 200, JSON.stringify(b), 64);
  assert.equal((p(chatBody('cut off', 'length')) as { code: string }).code, 'truncated');
  assert.equal((p(chatBody('', 'length')) as { code: string }).code, 'truncated');
  assert.equal((p(chatBody(null)) as { code: string }).code, 'empty_content');
  assert.equal((p(chatBody('')) as { code: string }).code, 'empty_content');
  assert.equal((p(chatBody({ option: 'a' })) as { code: string }).code, 'non_text_response');
});

test('chat shape: a reasoning field is never read into the text', () => {
  const b = { success: true, result: { choices: [{ message: { content: 'answer', reasoning_content: 'SECRET THOUGHTS' }, finish_reason: 'stop' }] } };
  const r = parseResponse('chat', 200, JSON.stringify(b), 64);
  assert.deepEqual(r, { kind: 'text', text: 'answer', usage: null });
});

test('text shape: result.response, truncation by completion_tokens', () => {
  const ok = parseResponse('text', 200, JSON.stringify({ result: { response: 'hi', usage: { prompt_tokens: 3, completion_tokens: 2 } } }), 64);
  assert.equal(ok.kind, 'text');
  const cut = parseResponse('text', 200, JSON.stringify({ result: { response: 'hi', usage: { prompt_tokens: 3, completion_tokens: 64 } } }), 64);
  assert.equal((cut as { code: string }).code, 'truncated');
  const obj = parseResponse('text', 200, JSON.stringify({ result: { response: { option: 'a' } } }), 64);
  assert.equal((obj as { code: string }).code, 'non_text_response');
  const empty = parseResponse('text', 200, JSON.stringify({ result: { response: '' } }), 64);
  assert.equal((empty as { code: string }).code, 'empty_content');
});

test('HTTP error and rate limit: status and first API code, no retry, no secrets', async () => {
  let calls = 0;
  const echo: FetchLike = () => {
    calls += 1;
    return Promise.resolve({
      status: 429,
      text: () => Promise.resolve(JSON.stringify({ success: false, errors: [{ code: 3036, message: `limit for /accounts/${ACCOUNT} token ${TOKEN}` }, { code: 1 }] })),
    });
  };
  const res = await adapter(echo).complete(PROMPT, opts());
  assert.equal(calls, 1);
  assert.equal(res.kind, 'error');
  if (res.kind === 'error') {
    assert.equal(res.code, 'rate_limited');
    assert.deepEqual(res.remote, { status: 429, code: '3036' });
    assert.ok(!res.detail.includes(ACCOUNT) && !res.detail.includes(TOKEN));
  }
  const srv = await adapter(reply(500, { success: false, errors: [] })).complete(PROMPT, opts());
  assert.equal(srv.kind === 'error' && srv.code, 'remote_error');
});

test('a network failure echoing the account ID is redacted', async () => {
  const boom: FetchLike = () => Promise.reject(Object.assign(new Error(`failed ${ACCOUNT} ${TOKEN}`), { name: `E${ACCOUNT}` }));
  const res = await adapter(boom).complete(PROMPT, opts());
  assert.equal(res.kind, 'error');
  if (res.kind === 'error') assert.ok(!res.detail.includes(ACCOUNT) && !res.detail.includes(TOKEN));
});

test('timeout aborts the request: late = none (aborted)', async () => {
  const clock = createFakeClock();
  let aborted = false;
  const hang: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    });
  const pending = adapter(hang, combo(), clock).complete(PROMPT, opts({}, 5000));
  await clock.advance(5000);
  const res = await pending;
  assert.equal(res.kind, 'timeout');
  assert.ok(aborted);
  if (res.kind === 'timeout') {
    assert.equal(res.elapsedMs, 5000);
    assert.deepEqual(await res.late, { kind: 'none', reason: 'aborted' });
  }
});

test('identity: server-side, not pinnable', () => {
  const id = adapter(reply(200, {})).identity();
  assert.equal(id.modelRevision, 'server-side, not pinnable');
  assert.equal(id.runtime, 'workers-ai');
});

test('factory: reads env lazily, registers secrets, redacts via sink; EnvError propagates', async () => {
  let loads = 0;
  const factory = createWorkersAiRuntime({
    loadEnv: () => {
      loads += 1;
      return loadWorkersAiEnv({ readFile: () => `WORKERS_AI_TOKEN=${TOKEN}\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n` });
    },
    fetch: reply(200, chatBody('x')),
  });
  assert.equal(loads, 0);
  const ctx = { combo: combo(), kind: 'dev', resume: false, timeoutMs: 10_000 } as never;
  const h = await factory(ctx);
  await factory(ctx);
  assert.equal(loads, 1);
  assert.equal(h.source, 'node');
  assert.equal(scrub(`${TOKEN} ${ACCOUNT}`), '[redacted] [redacted]');
  assert.ok(!JSON.stringify(h.fingerprint).includes(ACCOUNT));

  clearSecrets();
  const missing = createWorkersAiRuntime({ loadEnv: () => loadWorkersAiEnv({ readFile: () => '' }) });
  await assert.rejects(missing(ctx), EnvError);
});

test('granite live shape (V4): chat envelope with finish_reason length is truncated even when completion_tokens equals max_tokens', () => {
  const b = { success: true, result: { choices: [{ message: { content: '{"opt' }, finish_reason: 'length' }], usage: { prompt_tokens: 775, completion_tokens: 5 } } };
  const r = parseResponse('chat', 200, JSON.stringify(b), 5);
  assert.equal(r.kind, 'error');
  if (r.kind === 'error') assert.equal(r.code, 'truncated');
});
