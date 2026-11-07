// Example tests for the Workers AI adapter (task 17.3). Everything goes through the real factory
// `createWorkersAiRuntime` with a fake env reader and a fake fetch; no network, no real env file.
// Cases already covered at the helper level in workers-ai.test.ts (17.1) are repeated here only
// where the full adapter path (factory -> request -> parse -> AdapterResult) was not exercised.
// **Validates: Requirements 11.3, 11.9, 11.11, 11.16, 11.18**
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createFakeClock } from '../../src/adapters/fake.ts';
import type { AdapterResult, Prompt, RequestOptions, RuntimeAdapter } from '../../src/adapters/interface.ts';
import { createWorkersAiRuntime, WORKERS_AI_REVISION, type FetchLike } from '../../src/adapters/workers-ai.ts';
import { loadWorkersAiEnv } from '../../src/env.ts';
import type { Combination } from '../../src/phase.ts';
import { clearSecrets } from '../../src/sink.ts';

const TOKEN = 'tok-FAKE-0123456789';
const ACCOUNT = 'acct0123456789abcdef';
const PROMPT: Prompt = { system: 'sys', user: 'usr' };
const OPTS: RequestOptions = {
  timeoutMs: 5000,
  sampling: { temperature: 0, topP: null, maxOutputTokens: 64, seed: null, chatTemplateKwargs: null, constraint: { kind: 'none' } },
};

const combo = (shape: 'chat' | 'text'): Combination =>
  ({
    id: `wai-${shape}`,
    runtime: 'workers-ai',
    model_id: '@cf/fake/model',
    quantization: 'n/a',
    revision: WORKERS_AI_REVISION,
    phase1_locked: false,
    response_shape: shape,
    max_output_param: { name: shape === 'chat' ? 'max_completion_tokens' : 'max_tokens', source: 'x' },
    prices: { input: 100, output: 200, source: 'x', read_on: '2026-11-06' },
  }) as Combination;

async function adapterFor(shape: 'chat' | 'text', fetch: FetchLike, clock = createFakeClock()): Promise<RuntimeAdapter> {
  const factory = createWorkersAiRuntime({
    loadEnv: () => loadWorkersAiEnv({ readFile: () => `WORKERS_AI_TOKEN=${TOKEN}\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n` }),
    fetch,
    clock,
  });
  const handle = await factory({ combo: combo(shape), kind: 'dev', resume: false, timeoutMs: 5000 } as never);
  return handle.adapter;
}

const reply = (status: number, body: unknown): FetchLike => () =>
  Promise.resolve({ status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
const chat = (content: unknown, finish = 'stop', extra: Record<string, unknown> = {}) => ({
  success: true,
  result: { choices: [{ message: { content, ...extra }, finish_reason: finish }], usage: { prompt_tokens: 11, completion_tokens: 4 } },
});
const errorOf = (r: AdapterResult): Extract<AdapterResult, { kind: 'error' }> => {
  assert.equal(r.kind, 'error');
  return r as Extract<AdapterResult, { kind: 'error' }>;
};

afterEach(() => clearSecrets());

test('chat success: text is message.content, usage is read', async () => {
  const r = await (await adapterFor('chat', reply(200, chat('{"option":"a"}')))).complete(PROMPT, OPTS);
  assert.equal(r.kind, 'text');
  if (r.kind === 'text') {
    assert.equal(r.text, '{"option":"a"}');
    assert.deepEqual(r.usage, { inputTokens: 11, outputTokens: 4, reasoningTokens: null });
  }
});

test('text-shape success: text is result.response, usage is read', async () => {
  const body = { success: true, result: { response: 'plain answer', usage: { prompt_tokens: 7, completion_tokens: 3 } } };
  const r = await (await adapterFor('text', reply(200, body))).complete(PROMPT, OPTS);
  assert.equal(r.kind, 'text');
  if (r.kind === 'text') {
    assert.equal(r.text, 'plain answer');
    assert.deepEqual(r.usage, { inputTokens: 7, outputTokens: 3, reasoningTokens: null });
  }
});

test('HTTP 400: error with status and first API code, detail carries no secret', async () => {
  const body = { success: false, errors: [{ code: 5006, message: `bad ${ACCOUNT} ${TOKEN}` }] };
  const e = errorOf(await (await adapterFor('chat', reply(400, body))).complete(PROMPT, OPTS));
  assert.equal(e.code, 'remote_error');
  assert.deepEqual(e.remote, { status: 400, code: '5006' });
  assert.ok(!e.detail.includes(ACCOUNT) && !e.detail.includes(TOKEN));
});

test('HTTP 429: rate_limited with status and API code, one request only', async () => {
  let calls = 0;
  const fetch: FetchLike = (url, init) => {
    calls += 1;
    return reply(429, { success: false, errors: [{ code: 3036, message: 'limit' }] })(url, init);
  };
  const e = errorOf(await (await adapterFor('chat', fetch)).complete(PROMPT, OPTS));
  assert.equal(e.code, 'rate_limited');
  assert.deepEqual(e.remote, { status: 429, code: '3036' });
  assert.equal(calls, 1);
});

test('timeout: the request is aborted and late = none (aborted)', async () => {
  const clock = createFakeClock();
  let aborted = false;
  const hang: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    });
  const pending = (await adapterFor('chat', hang, clock)).complete(PROMPT, OPTS);
  await clock.advance(5000);
  const r = await pending;
  assert.equal(r.kind, 'timeout');
  assert.ok(aborted);
  if (r.kind === 'timeout') assert.deepEqual(await r.late, { kind: 'none', reason: 'aborted' });
});

test('content: null is empty_content, not text', async () => {
  const e = errorOf(await (await adapterFor('chat', reply(200, chat(null)))).complete(PROMPT, OPTS));
  assert.equal(e.code, 'empty_content');
});

test('finish_reason "length" is truncated, even when text came back', async () => {
  const e = errorOf(await (await adapterFor('chat', reply(200, chat('cut o', 'length')))).complete(PROMPT, OPTS));
  assert.equal(e.code, 'truncated');
});

test('a parsed-object response (text shape) is non_text_response, never JSON text', async () => {
  const body = { success: true, result: { response: { option: 'a' } } };
  const e = errorOf(await (await adapterFor('text', reply(200, body))).complete(PROMPT, OPTS));
  assert.equal(e.code, 'non_text_response');
});

test('a reasoning field never reaches the text, its tokens only the usage', async () => {
  const body = {
    success: true,
    result: {
      choices: [{ message: { content: 'final', reasoning_content: 'PRIVATE CHAIN', reasoning: 'PRIVATE TWO' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 6 } },
    },
  };
  const r = await (await adapterFor('chat', reply(200, body))).complete(PROMPT, OPTS);
  assert.equal(r.kind, 'text');
  if (r.kind === 'text') {
    assert.equal(r.text, 'final');
    assert.ok(!r.text.includes('PRIVATE'));
    assert.equal(r.usage?.reasoningTokens, 6);
  }
});
