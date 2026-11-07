// Fallback chain examples (llm-probe task 12.4; requirements 8.7, 8.8, 8.9). Fake adapters, no
// network. Validation is the real sim-wasm llm_validate on a Dev_Card's frozen context.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type {
  AdapterResult,
  Prompt,
  RequestOptions,
  RuntimeAdapter,
} from '../../src/adapters/interface.ts';
import { runChain, type ChainInput } from '../../src/chain.ts';
import { llmParseCard } from '../../src/simwasm.ts';

const devPath = new URL('../../../../eval/cards/cards/dev.jsonl', import.meta.url);
const line = readFileSync(devPath, 'utf8')
  .split('\n')
  .find((l) => l.startsWith('{"id":"D-dream_interpretation-001"'));
assert.ok(line !== undefined);
const parsed = JSON.parse(llmParseCard(line, 'D-dream_interpretation-001')) as { frozen_context: unknown };
const frozenContext = JSON.stringify(parsed.frozen_context);

const prompt: Prompt = { system: 's', user: 'u' };
const options: RequestOptions = {
  timeoutMs: 1000,
  sampling: {
    temperature: 0,
    topP: null,
    maxOutputTokens: 64,
    seed: null,
    chatTemplateKwargs: null,
    constraint: { kind: 'none' },
  },
};

function fake(result: AdapterResult, calls: { n: number }): RuntimeAdapter {
  return {
    identity: () => ({
      runtime: 'fake',
      runtimeVersion: '0',
      modelId: 'unknown',
      modelRevision: 'unknown',
      quantization: 'unknown',
    }),
    state: () => 'idle',
    complete: async () => {
      calls.n++;
      return result;
    },
  };
}

const text = (t: string): AdapterResult => ({ kind: 'text', text: t, latencyMs: 1, usage: null });
const timeout: AdapterResult = {
  kind: 'timeout',
  timeoutMs: 1000,
  elapsedMs: 1000,
  late: Promise.resolve({ kind: 'none', reason: 'idle_cap' } as never),
};
const error = (code: 'gpu_unavailable' | 'credentials_missing' | 'budget_exhausted' | 'remote_error'): AdapterResult => ({
  kind: 'error',
  code,
  detail: '',
  elapsedMs: 0,
  remote: null,
});
const GOOD = '{"option":"heed_warning"}';
const BAD = 'I think the answer is probably the first one.';

function run(a: AdapterResult, b: AdapterResult): Promise<{ r: Awaited<ReturnType<typeof runChain>>; ca: number; cb: number }> {
  const ca = { n: 0 };
  const cb = { n: 0 };
  const input: ChainInput = {
    links: { inBrowser: fake(a, ca), server: fake(b, cb), rulesDefault: { option: 'dismiss_dream' } },
    frozenContext,
    cardId: 'D-dream_interpretation-001',
    prompt,
    options,
  };
  return runChain(input).then((r) => ({ r, ca: ca.n, cb: cb.n }));
}

test('valid answer from the first link stops the chain', async () => {
  const { r, cb } = await run(text(GOOD), text(GOOD));
  assert.equal(r.producedBy, 'in_browser');
  assert.deepEqual(r.attempts, [{ link: 'in_browser', kind: 'valid' }]);
  assert.equal(cb, 0);
});

test('valid answer from the second link after a timeout', async () => {
  const { r } = await run(timeout, text(GOOD));
  assert.equal(r.producedBy, 'server');
  assert.deepEqual(r.attempts, [
    { link: 'in_browser', kind: 'timeout' },
    { link: 'server', kind: 'valid' },
  ]);
});

test('illegal text moves on to the next link', async () => {
  const { r } = await run(text(BAD), text(GOOD));
  assert.equal(r.producedBy, 'server');
  assert.deepEqual(r.attempts[0], { link: 'in_browser', kind: 'illegal' });
});

test('a link that cannot accept a request is recorded with its code and skipped', async () => {
  const { r } = await run(error('gpu_unavailable'), error('credentials_missing'));
  assert.equal(r.producedBy, 'rules_default');
  assert.deepEqual(r.attempts, [
    { link: 'in_browser', kind: 'error', code: 'gpu_unavailable' },
    { link: 'server', kind: 'error', code: 'credentials_missing' },
    { link: 'rules_default', kind: 'valid' },
  ]);
});

test('every model link failing returns the caller default', async () => {
  const { r } = await run(text(BAD), error('remote_error'));
  assert.equal(r.producedBy, 'rules_default');
  assert.deepEqual('answer' in r && r.answer, { option: 'dismiss_dream' });
  assert.equal(r.attempts.length, 3);
});
