import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { createFakeClock } from '../../src/adapters/fake.ts';
import type { AdapterResult, Prompt, RequestOptions, SamplingParams } from '../../src/adapters/interface.ts';
import {
  budgetInputs,
  parseResponse,
  toBudgetUsage,
  workersAiPrices,
  WorkersAiAdapter,
  type FetchInit,
  type FetchLike,
} from '../../src/adapters/workers-ai.ts';
import { estimateNeurons } from '../../src/budget.ts';
import { parseCombinations, type Combination } from '../../src/phase.ts';
import { Secret } from '../../src/redact.ts';

// Feature: llm-probe, Property 39: Workers AI responses yield content text or a named error
// **Validates: Requirements 11.15, 11.16, 11.17, 11.18, 11.19**

const TOKEN = 'tok-SECRET-0123456789';
const ACCOUNT = 'acct-SECRET-abcdef';
const MARK = 'ZZMARKZZ';

const prompt: Prompt = { system: 'sys', user: 'usr' };
const sampling = (max: number): SamplingParams => ({ temperature: 0, topP: null, maxOutputTokens: max, seed: null, chatTemplateKwargs: null, constraint: { kind: 'none' } });
const opts = (max: number, timeoutMs = 10_000): RequestOptions => ({ timeoutMs, sampling: sampling(max) });

function combo(shape: 'chat' | 'text', param: 'max_tokens' | 'max_completion_tokens' = 'max_tokens'): Combination {
  return {
    id: `workers-ai/fake-${shape}`,
    runtime: 'workers-ai',
    model_id: '@cf/fake/model',
    quantization: '',
    revision: 'server-side, not pinnable',
    phase1_locked: false,
    response_shape: shape,
    max_output_param: { name: param, source: 'x' },
    prices: { input: 1000, output: 2000, source: 'x', read_on: '2026-11-06' },
  };
}

interface Call {
  url: string;
  init: FetchInit;
}
function fakeFetch(status: number, body: unknown): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
  };
  return { fetch, calls };
}
function adapterFor(c: Combination, fetch: FetchLike, clock = createFakeClock()): WorkersAiAdapter {
  return new WorkersAiAdapter({ combo: c, token: new Secret(TOKEN), accountId: new Secret(ACCOUNT), fetch, clock });
}
const run = (c: Combination, status: number, body: unknown, max = 64): Promise<AdapterResult> => adapterFor(c, fakeFetch(status, body).fetch).complete(prompt, opts(max));

// ---------------------------------------------------------------- generators

type Content = { tag: 'string'; v: string } | { tag: 'empty' } | { tag: 'null' } | { tag: 'absent' } | { tag: 'object'; v: unknown } | { tag: 'array'; v: unknown };
const contentArb: fc.Arbitrary<Content> = fc.oneof(
  fc.string({ unit: 'binary', minLength: 1, maxLength: 60 }).map((v): Content => ({ tag: 'string', v })),
  fc.constant<Content>({ tag: 'empty' }),
  fc.constant<Content>({ tag: 'null' }),
  fc.constant<Content>({ tag: 'absent' }),
  fc.dictionary(fc.string({ maxLength: 5 }), fc.integer()).map((v): Content => ({ tag: 'object', v })),
  fc.array(fc.integer(), { maxLength: 3 }).map((v): Content => ({ tag: 'array', v })),
);
const contentValue = (c: Content): { present: boolean; value?: unknown } => {
  switch (c.tag) {
    case 'string':
      return { present: true, value: c.v };
    case 'empty':
      return { present: true, value: '' };
    case 'null':
      return { present: true, value: null };
    case 'absent':
      return { present: false };
    default:
      return { present: true, value: c.v };
  }
};

const usageArb = fc.option(
  fc.record({
    prompt: fc.nat(5000),
    completion: fc.nat(5000),
    reasoning: fc.option(fc.nat(5000), { nil: undefined }),
    nested: fc.boolean(),
  }),
  { nil: undefined },
);
type UsageGen = typeof usageArb extends fc.Arbitrary<infer T> ? T : never;
function usageJson(u: UsageGen): Record<string, unknown> | undefined {
  if (u === undefined) return undefined;
  const o: Record<string, unknown> = { prompt_tokens: u.prompt, completion_tokens: u.completion, total_tokens: u.prompt + u.completion };
  if (u.reasoning !== undefined) {
    if (u.nested) o['completion_tokens_details'] = { reasoning_tokens: u.reasoning };
    else o['reasoning_tokens'] = u.reasoning;
  }
  return o;
}

const finishArb = fc.constantFrom<string | undefined>('stop', 'length', 'tool_calls', 'content_filter', undefined);
const marker = (tag: string): string => `${MARK}${tag}`;
const envelope = (result: unknown): unknown => ({ success: true, errors: [], messages: [], result });

// ---------------------------------------------------------------- chat shape

test('P39 chat: text is exactly message.content; truncation first; empty/null -> empty_content; object -> non_text_response', () => {
  fc.assert(
    fc.property(contentArb, finishArb, usageArb, fc.boolean(), (content, finish, usage, extras) => {
      const message: Record<string, unknown> = { role: 'assistant' };
      const cv = contentValue(content);
      if (cv.present) message['content'] = cv.value;
      if (extras) {
        message['reasoning_content'] = marker('rc');
        message['reasoning'] = marker('r');
        message['reasoning_details'] = [{ text: marker('rd') }];
        message['tool_calls'] = [{ function: { name: marker('tc') } }];
      }
      const choice: Record<string, unknown> = { index: 0, message };
      if (finish !== undefined) choice['finish_reason'] = finish;
      const result: Record<string, unknown> = { choices: [choice], unknownField: marker('u') };
      const uj = usageJson(usage);
      if (uj !== undefined) result['usage'] = uj;

      const p = parseResponse('chat', 200, JSON.stringify(envelope(result)), 64);
      if (finish === 'length') {
        assert.equal(p.kind === 'error' && p.code, 'truncated');
      } else if (content.tag === 'string') {
        assert.equal(p.kind, 'text');
        if (p.kind === 'text') {
          assert.equal(p.text, content.v); // byte for byte
          assert.ok(!p.text.includes(MARK) || content.v.includes(MARK));
        }
      } else if (content.tag === 'empty' || content.tag === 'null' || content.tag === 'absent') {
        assert.equal(p.kind === 'error' && p.code, 'empty_content');
      } else {
        assert.equal(p.kind === 'error' && p.code, 'non_text_response');
        if (p.kind === 'error') assert.ok(!p.detail.includes(JSON.stringify(content.v)) || JSON.stringify(content.v).length < 3);
      }
      // usage mapping is exact (R11.17)
      if (usage === undefined) assert.equal(p.usage, null);
      else assert.deepEqual(p.usage, { inputTokens: usage.prompt, outputTokens: usage.completion, reasoningTokens: usage.reasoning ?? null });
    }),
    { numRuns: 300 },
  );
});

test('P39 chat: a parsed object content never becomes JSON text', () => {
  const body = envelope({ choices: [{ message: { content: { a: 1, b: 'x' } }, finish_reason: 'stop' }] });
  const p = parseResponse('chat', 200, JSON.stringify(body), 64);
  assert.equal(p.kind, 'error');
  if (p.kind === 'error') {
    assert.equal(p.code, 'non_text_response');
    assert.ok(!p.detail.includes('"a"'));
  }
});

// ---------------------------------------------------------------- text shape

test('P39 text: text is exactly `response`; completion_tokens >= max_tokens -> truncated; empty/null -> empty_content; object -> non_text_response', () => {
  fc.assert(
    fc.property(contentArb, usageArb, fc.integer({ min: 1, max: 5000 }), fc.boolean(), (content, usage, max, extras) => {
      const result: Record<string, unknown> = { unknownField: marker('u') };
      const cv = contentValue(content);
      if (cv.present) result['response'] = cv.value;
      if (extras) {
        result['reasoning_content'] = marker('rc');
        result['choices'] = [{ message: { content: marker('c') } }];
      }
      const uj = usageJson(usage);
      if (uj !== undefined) result['usage'] = uj;

      const p = parseResponse('text', 200, JSON.stringify(envelope(result)), max);
      if (usage !== undefined && usage.completion >= max) {
        assert.equal(p.kind === 'error' && p.code, 'truncated');
      } else if (content.tag === 'string') {
        assert.equal(p.kind === 'text' && p.text, content.v);
      } else if (content.tag === 'empty' || content.tag === 'null' || content.tag === 'absent') {
        assert.equal(p.kind === 'error' && p.code, 'empty_content');
      } else {
        assert.equal(p.kind === 'error' && p.code, 'non_text_response');
      }
      if (usage === undefined) assert.equal(p.usage, null);
      else assert.deepEqual(p.usage, { inputTokens: usage.prompt, outputTokens: usage.completion, reasoningTokens: usage.reasoning ?? null });
    }),
    { numRuns: 300 },
  );
});

// ---------------------------------------------------------------- HTTP errors through the adapter

test('P39 HTTP status >= 400: error carries status + first API error code only; one call, never retried', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 400, max: 599 }),
      fc.array(fc.record({ code: fc.integer({ min: 1000, max: 99999 }), message: fc.constantFrom(`msg ${TOKEN}`, `acct ${ACCOUNT}`, marker('msg')) }), { maxLength: 3 }),
      fc.constantFrom<'chat' | 'text'>('chat', 'text'),
      async (status, errors, shape) => {
        const { fetch, calls } = fakeFetch(status, { success: false, errors, messages: [{ message: marker('m') }], result: null });
        const r = await adapterFor(combo(shape), fetch).complete(prompt, opts(64));
        assert.equal(calls.length, 1);
        assert.equal(r.kind, 'error');
        if (r.kind !== 'error') return;
        const first = errors[0]?.code;
        assert.equal(r.code, status === 429 ? 'rate_limited' : 'remote_error');
        assert.deepEqual(r.remote, { status, code: first === undefined ? null : String(first) });
        assert.equal(r.detail, `HTTP ${status}${first === undefined ? '' : ` api error ${first}`}`);
        const all = JSON.stringify(r);
        for (const s of [TOKEN, ACCOUNT, MARK, 'Bearer']) assert.ok(!all.includes(s), `leaked ${s}`);
      },
    ),
    { numRuns: 100 },
  );
});

test('P39 request: Authorization only in headers, URL carries the model, param name follows the Combination', async () => {
  for (const [shape, param] of [['chat', 'max_completion_tokens'], ['text', 'max_tokens']] as const) {
    const { fetch, calls } = fakeFetch(200, envelope({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], response: 'ok' }));
    const r = await adapterFor(combo(shape, param), fetch).complete(prompt, opts(77));
    assert.equal(r.kind, 'text');
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.ok(call.url.endsWith('/ai/run/@cf/fake/model'));
    const body = JSON.parse(call.init.body) as Record<string, unknown>;
    assert.equal(body[param], 77);
    assert.equal(body['temperature'], 0);
    assert.ok(!call.init.body.includes(TOKEN));
  }
});

test('P39 timeout: the request is aborted, the result is a timeout with late = none (aborted)', async () => {
  const clock = createFakeClock();
  let signal: AbortSignal | undefined;
  const fetch: FetchLike = (_u, init) => {
    signal = init.signal;
    return new Promise(() => undefined);
  };
  const pending = adapterFor(combo('chat', 'max_completion_tokens'), fetch, clock).complete(prompt, opts(64, 5000));
  await clock.advance(5000);
  const r = await pending;
  assert.equal(r.kind, 'timeout');
  assert.equal(signal?.aborted, true);
  if (r.kind === 'timeout') assert.deepEqual(await r.late, { kind: 'none', reason: 'aborted' });
});

// ---------------------------------------------------------------- the real combinations.json

test('P39 real combinations.json: the three Workers AI entries feed the adapter helpers', async () => {
  const text = readFileSync(path.join(import.meta.dirname, '..', '..', 'combinations.json'), 'utf8');
  const workers = parseCombinations(text).filter((c) => c.runtime === 'workers-ai');
  assert.deepEqual(
    workers.map((c) => c.model_id).sort(),
    ['@cf/google/gemma-4-26b-a4b-it', '@cf/ibm-granite/granite-4.0-h-micro', '@cf/zai-org/glm-4.7-flash'],
  );
  for (const c of workers) {
    assert.equal(typeof c.max_output_param, 'object');
    const name = c.max_output_param?.name;
    assert.ok(name === 'max_tokens' || name === 'max_completion_tokens');
    assert.ok(c.response_shape === 'chat' || c.response_shape === 'text');

    const prices = workersAiPrices(c);
    assert.equal(prices.inputPrice, c.prices?.input);
    assert.equal(prices.outputPrice, c.prices?.output);
    assert.ok(Number.isInteger(prices.inputPrice) && Number.isInteger(prices.outputPrice));

    const max = (c['sampling'] as { max_output_tokens: { decision: number } }).max_output_tokens.decision;
    const s: SamplingParams = {
      temperature: 0,
      topP: null,
      maxOutputTokens: max,
      seed: null,
      chatTemplateKwargs: (c['chat_template_kwargs'] as Record<string, boolean> | null) ?? null,
      constraint: { kind: 'none' },
    };
    const b = budgetInputs(c, prompt, s);
    assert.equal(b.maxOutputTokens, max);
    assert.equal(b.estimate, estimateNeurons({ promptBytes: 6, maxOutputTokens: max, inputPrice: prices.inputPrice, outputPrice: prices.outputPrice }));

    const { fetch, calls } = fakeFetch(200, envelope(c.response_shape === 'chat' ? { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] } : { response: 'hi' }));
    const r = await adapterFor(c, fetch).complete(prompt, { timeoutMs: 1000, sampling: s });
    assert.equal(r.kind, 'text');
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    assert.equal(body[name!], max);
    assert.equal(Object.keys(body).filter((k) => k === 'max_tokens' || k === 'max_completion_tokens').length, 1);
    if (s.chatTemplateKwargs !== null) assert.deepEqual(body['chat_template_kwargs'], s.chatTemplateKwargs);
  }
  assert.deepEqual(toBudgetUsage({ inputTokens: 1, outputTokens: 2, reasoningTokens: 3 }), { promptTokens: 1, completionTokens: 2, reasoningTokens: 3 });
});
