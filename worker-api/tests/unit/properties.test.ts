import assert from 'node:assert/strict';
import test from 'node:test';
import fc from '../../../web/node_modules/fast-check/lib/fast-check.js';
import { handleRequest } from '../../src/handler.ts';
import { DECISION_WIRE_BOUNDS, isDecisionRequest, isModelDecision } from '../../../web/src/shared/decision.ts';
import { decisionRequest, enabledVariables, expectError, post, publicBody } from '../helpers/decision.ts';

const text = fc.array(fc.constantFrom('a', '界', '😀'), { minLength: 1, maxLength: 40 }).map(parts => parts.join(''));

test('Property 6: generated closed requests accept exact bytes and reject malformed or over-bound input with zero additional AI', async () => {
  await fc.assert(fc.asyncProperty(text, text, fc.integer({ min: 2, max: 5 }), async (state, instructions, count) => {
    const request = { ...decisionRequest(), state, instructions,
      criteria: Array.from({ length: count }, (_, i) => ({ id: 'a' + '_'.repeat(i), label: state })),
    };
    assert.ok(isDecisionRequest(request));
    let calls = 0;
    const AI = { async run(_model: unknown, _input: unknown, options: unknown) {
      assert.deepEqual(options, { returnRawResponse: true });
      calls += 1;
      return new Response(JSON.stringify({ model: 'provider', answers: { decision: { type: 'choice', choice: 'a' } } }));
    } };
    const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
    const env = { ...enabledVariables(), MAX_REQUEST_BYTES: bytes, AI };
    let admissions = 0;
    const admission = async () => { admissions += 1; return 'admitted' as const; };
    const response = await handleRequest(post(request), env, undefined, admission);
    assert.equal(response.status, 200);
    assert.ok(isModelDecision(await publicBody(response), request));
    assert.equal(calls, 1);
    assert.equal(admissions, 1);
    await expectError(await handleRequest(post(request), { ...env, MAX_REQUEST_BYTES: bytes - 1 }, undefined, admission), 'payload_too_large', 413);
    for (const invalid of [
      { ...request, extra: true }, { ...request, metadata: {} }, { ...request, mapping_hash: 'wrong' },
      { ...request, criteria: [request.criteria[0], request.criteria[0]] },
      { ...request, criteria: [{ id: 'INVALID', label: state }, request.criteria[1]] },
      { ...request, metadata: { bridge_version: { a: { b: { c: {} } } } } },
    ]) {
      await expectError(await handleRequest(post(invalid), { ...env, MAX_REQUEST_BYTES: DECISION_WIRE_BOUNDS.requestBytesCeiling }, undefined, admission), 'malformed_request', 400);
    }
    assert.equal(calls, 1);
    assert.equal(admissions, 1);
  }), { numRuns: 100, seed: 73106 });
});

test('Property 7: generated native selected projections produce only the pinned complete public success', async () => {
  await fc.assert(fc.asyncProperty(text.map(value => value.slice(0, 30)), fc.boolean(),
    fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    fc.jsonValue(), async (model, present, inputTokens, outputTokens, ignored) => {
      const request = decisionRequest();
      const raw = { model, answers: { decision: { type: 'choice', choice: request.criteria[0]!.id,
        probabilities: ignored, confidence: ignored }, extra: ignored }, provider_extra: ignored,
        ...(present ? { usage: { input_tokens: inputTokens, output_tokens: outputTokens } } : {}),
      };
      let calls = 0;
      const env = { ...enabledVariables(), SESSION_CAP: 0, AI: { async run() {
        calls += 1;
        return new Response(JSON.stringify(raw));
      } } };
      const response = await handleRequest(post(request), env);
      assert.equal(response.status, 200);
      const body = await publicBody(response);
      assert.ok(isModelDecision(body, request));
      assert.deepEqual(body.usage, present ? { input_tokens: inputTokens, output_tokens: outputTokens } : null);
      assert.equal(body.session_cap, 0);
      assert.equal(calls, 1);
      const bad = { ...raw, usage: { input_tokens: inputTokens, output_tokens: outputTokens, ignored } };
      await expectError(await handleRequest(post(request), { ...env, AI: { async run() {
        calls += 1;
        return new Response(JSON.stringify(bad));
      } } }), 'invalid_response', 502);
      assert.equal(calls, 2);
    }), { numRuns: 100, seed: 73107 });
});
