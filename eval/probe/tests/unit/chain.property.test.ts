// Property 31: The fallback chain stops at the first valid link.
// **Validates: Requirements 8.7, 8.8**
// Scripted fake adapters; validation is the real sim-wasm llm_validate on a Dev_Card context.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import fc from 'fast-check';
import type {
  AdapterErrorCode,
  AdapterResult,
  Prompt,
  RequestOptions,
  RuntimeAdapter,
} from '../../src/adapters/interface.ts';
import { runChain, type Attempt } from '../../src/chain.ts';
import { llmParseCard } from '../../src/simwasm.ts';

const cardId = 'D-dream_interpretation-001';
const line = readFileSync(new URL('../../../../eval/cards/cards/dev.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .find((l) => l.startsWith(`{"id":"${cardId}"`));
assert.ok(line !== undefined);
const card = JSON.parse(llmParseCard(line, cardId)) as { frozen_context: unknown };
const frozenContext = JSON.stringify(card.frozen_context);

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

const codes: AdapterErrorCode[] = [
  'gpu_unavailable', 'software_adapter', 'backend_not_webgpu', 'placement_not_logged',
  'model_load_failed', 'out_of_memory', 'runtime_stuck', 'credentials_missing', 'budget_exhausted',
  'not_approved', 'remote_error', 'rate_limited', 'constraint_unmet', 'empty_content', 'truncated',
  'non_text_response', 'runtime_error',
];
const validTexts = ['{"option":"heed_warning"}', '{"option":"dismiss_dream"}'];
const illegalTexts = ['I think the answer is probably the first one.', '', '{"option":"no_such_option"}'];

type Step =
  | { k: 'valid'; text: string }
  | { k: 'illegal'; text: string }
  | { k: 'timeout' }
  | { k: 'error'; code: AdapterErrorCode };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.constantFrom(...validTexts).map((text): Step => ({ k: 'valid', text })),
  fc.constantFrom(...illegalTexts).map((text): Step => ({ k: 'illegal', text })),
  fc.constant<Step>({ k: 'timeout' }),
  fc.constantFrom(...codes).map((code): Step => ({ k: 'error', code })),
);
// A link is absent (null) or scripted with a non-empty sequence of results; only the first is used.
const linkArb = fc.option(fc.array(stepArb, { minLength: 1, maxLength: 3 }), { nil: null });

function toResult(s: Step): AdapterResult {
  switch (s.k) {
    case 'valid':
    case 'illegal':
      return { kind: 'text', text: s.text, latencyMs: 1, usage: null };
    case 'timeout':
      return {
        kind: 'timeout',
        timeoutMs: 1000,
        elapsedMs: 1000,
        late: Promise.resolve({ kind: 'none', reason: 'idle_cap' } as never),
      };
    case 'error':
      return { kind: 'error', code: s.code, detail: '', elapsedMs: 0, remote: null };
  }
}

function scripted(steps: Step[], calls: { n: number }): RuntimeAdapter {
  return {
    identity: () => ({
      runtime: 'fake', runtimeVersion: '0', modelId: 'unknown', modelRevision: 'unknown', quantization: 'unknown',
    }),
    state: () => 'idle',
    complete: async () => {
      const step = steps[Math.min(calls.n, steps.length - 1)];
      calls.n++;
      return toResult(step);
    },
  };
}

function expectedAttempt(link: 'in_browser' | 'server', s: Step): Attempt {
  if (s.k === 'error') return { link, kind: 'error', code: s.code };
  return { link, kind: s.k };
}

test('Property 31: the chain stops at the first valid link', async () => {
  await fc.assert(
    fc.asyncProperty(linkArb, linkArb, fc.jsonValue(), async (a, b, dflt) => {
      const ca = { n: 0 };
      const cb = { n: 0 };
      const r = await runChain({
        links: {
          inBrowser: a === null ? null : scripted(a, ca),
          server: b === null ? null : scripted(b, cb),
          rulesDefault: dflt,
        },
        frozenContext,
        cardId,
        prompt,
        options,
      });

      const expected: Attempt[] = [];
      let producer: 'in_browser' | 'server' | 'rules_default' = 'rules_default';
      const calls = { in_browser: 0, server: 0 };
      for (const [link, steps] of [['in_browser', a], ['server', b]] as const) {
        if (steps === null) continue;
        calls[link] = 1;
        expected.push(expectedAttempt(link, steps[0]));
        if (steps[0].k === 'valid') {
          producer = link;
          break;
        }
      }
      if (producer === 'rules_default') expected.push({ link: 'rules_default', kind: 'valid' });

      assert.deepEqual(r.attempts, expected);
      assert.equal(r.producedBy, producer);
      assert.equal(ca.n, calls.in_browser);
      assert.equal(cb.n, calls.server);
      if (r.producedBy === 'rules_default') {
        assert.deepEqual(r.answer, dflt);
      } else {
        const steps = r.producedBy === 'in_browser' ? a : b;
        assert.ok(steps !== null && steps[0].k === 'valid');
        assert.equal(r.text, steps[0].text);
        assert.notEqual(r.verdict.kind, 'illegal');
      }
    }),
    { numRuns: 100 },
  );
});
