import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  DECISION_ERROR_VERSION, isDecisionConfig, isDecisionError,
  isDecisionRequest, isModelDecision, withinDecisionDepth,
} from '../../src/shared/decision.ts';
import { config, modelDecision, request } from './helpers/decision.ts';

const clone = <T>(value: T): T => structuredClone(value);

test('config requires its exact version, boolean and safe-integer cap including disabled/zero/max', () => {
  for (const enabled of [false, true]) {
    for (const cap of [0, 40, Number.MAX_SAFE_INTEGER]) assert.ok(isDecisionConfig(config(cap, enabled)));
  }
  for (const cap of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '40', null]) {
    assert.equal(isDecisionConfig({ ...config(), session_cap: cap }), false);
  }
  for (const bad of [undefined, null, [], {}, { ...config(), enabled: 1 },
    { ...config(), version: 'decision-config-v2' }, { ...config(), request_cap: 99 }]) {
    assert.equal(isDecisionConfig(bad), false);
  }
  for (const key of Object.keys(config())) {
    const bad = { ...config() } as Record<string, unknown>;
    delete bad[key];
    assert.equal(isDecisionConfig(bad), false);
  }
});

test('request validates every key/literal, criteria cardinality, duplicate IDs and ASCII grammar', () => {
  assert.ok(isDecisionRequest(request));
  for (const key of Object.keys(request)) {
    const bad = clone(request) as unknown as Record<string, unknown>;
    delete bad[key];
    assert.equal(isDecisionRequest(bad), false, key);
  }
  for (const bad of [
    { ...request, extra: true }, { ...request, version: 'decision-request-v2' },
    { ...request, family: 'synthesis' }, { ...request, question_id: 'other' },
    { ...request, mapping_version: 'other' }, { ...request, mapping_hash: request.mapping_hash.toUpperCase() },
    { ...request, metadata: {} }, { ...request, metadata: { bridge_version: 'slow-think-v1', extra: true } },
    { ...request, criteria: [] }, { ...request, criteria: request.criteria.slice(0, 1) },
    { ...request, criteria: [...request.criteria, ...request.criteria, ...request.criteria] },
    { ...request, criteria: [request.criteria[0], request.criteria[0]] },
    { ...request, criteria: [{ id: 'one', label: 'One', extra: true }, request.criteria[1]] },
    { ...request, criteria: [{ id: 'one' }, request.criteria[1]] },
  ]) assert.equal(isDecisionRequest(bad), false);
  for (const id of ['', 'A', '_a', 'a1', '1', 'a-b', 'é', 'a'.repeat(65)]) {
    assert.equal(isDecisionRequest({ ...request, criteria: [{ id, label: 'One' }, request.criteria[1]] }), false);
  }
  for (const id of ['a', 'a_b', 'a'.repeat(64)]) {
    assert.ok(isDecisionRequest({ ...request, criteria: [{ id, label: 'One' }, request.criteria[1]] }));
  }
  const five = clone(request);
  five.criteria = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id }));
  assert.ok(isDecisionRequest(five));
});

test('decoded UTF-8 field limits are inclusive, independently of UTF-16/JSON escapes', () => {
  for (const [field, maximum] of [['state', 65536], ['instructions', 8192]] as const) {
    assert.ok(isDecisionRequest({ ...request, [field]: 'é'.repeat(maximum / 2) }));
    assert.equal(isDecisionRequest({ ...request, [field]: 'é'.repeat(maximum / 2) + 'a' }), false);
    assert.equal(isDecisionRequest({ ...request, [field]: '' }), false);
    assert.ok(isDecisionRequest(JSON.parse(JSON.stringify({ ...request, [field]: '\n'.repeat(maximum) }))));
  }
  assert.ok(isDecisionRequest({ ...request, criteria: [{ id: 'a', label: '😀'.repeat(256) }, request.criteria[1]] }));
  assert.equal(isDecisionRequest({ ...request, criteria: [{ id: 'a', label: '😀'.repeat(256) + 'a' }, request.criteria[1]] }), false);
  assert.equal(isDecisionRequest({ ...request, criteria: [{ id: 'a', label: '' }, request.criteria[1]] }), false);
});

test('depth counts containers only, stopping before traversal below level four', () => {
  assert.ok(withinDecisionDepth({ a: [{ b: { c: 1 } }] }));
  assert.equal(withinDecisionDepth({ a: [{ b: { c: [] } }] }), false);
  let touched = false;
  const fifth = Object.defineProperty({}, 'bad', { enumerable: true, get() { touched = true; throw Error('walked too far'); } });
  assert.equal(withinDecisionDepth([[[[fifth]]]]), false);
  assert.equal(touched, false);
  const bad = { ...request, metadata: { bridge_version: { a: { b: { c: [] } } } } };
  assert.equal(isDecisionRequest(bad), false);
});

test('success requires pinned contract, membership, complete null/two-counter usage and diagnostic cap', () => {
  const success = modelDecision();
  assert.ok(isModelDecision(success, request));
  assert.ok(isModelDecision({ ...success, session_cap: 0 }, request));
  assert.ok(isModelDecision({ ...success, usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 } }, request));
  for (const key of Object.keys(success)) {
    const bad = { ...success } as Record<string, unknown>;
    delete bad[key];
    assert.equal(isModelDecision(bad, request), false, key);
  }
  for (const bad of [{ ...success, extra: true }, { ...success, version: 'other' },
    { ...success, model: 'clef' }, { ...success, mapping_version: 'other' },
    { ...success, mapping_hash: '0'.repeat(64) }, { ...success, fingerprint: '0'.repeat(64) },
    { ...success, choice: 'not_an_option' }, { ...success, choice: success.choice.toUpperCase() },
    { ...success, session_cap: -1 }]) assert.equal(isModelDecision(bad, request), false);
  for (const usage of [undefined, {}, [], 1, { input_tokens: 1 }, { output_tokens: 0 },
    { input_tokens: 1, output_tokens: 0, neurons: 1 },
    { input_tokens: 1, output_tokens: 0, reasoning_tokens: 1 },
    { input_tokens: -1, output_tokens: 0 }, { input_tokens: 0.1, output_tokens: 0 },
    { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 0 },
    { input_tokens: 1, output_tokens: '0' }]) {
    assert.equal(isModelDecision({ ...success, usage }, request), false);
  }
});

test('errors require exact closed versioned envelope and fixed HTTP pairing', () => {
  const pairs = [['malformed_request', 400], ['not_found', 404], ['method_not_allowed', 405],
    ['payload_too_large', 413], ['model_error', 502], ['invalid_response', 502],
    ['disabled', 503], ['unavailable', 503], ['quota', 429], ['rate_limited', 429]] as const;
  for (const [kind, status] of pairs) {
    const wire = { version: DECISION_ERROR_VERSION, error: { kind } };
    assert.ok(isDecisionError(wire, status));
    assert.equal(isDecisionError(wire, 200), false);
    assert.equal(isDecisionError(wire, status + 1), false);
    assert.equal(isDecisionError({ ...wire, message: 'private' }, status), false);
    assert.equal(isDecisionError({ ...wire, error: { kind, message: 'private' } }, status), false);
  }
  assert.equal(isDecisionError({ version: DECISION_ERROR_VERSION, error: { kind: 'timeout' } }, 503), false);
  assert.equal(isDecisionError({ error: { kind: 'disabled' } }, 503), false);
});

test('Property 6: unknown keys and duplicate option IDs cannot pass request validation', () => {
  fc.assert(fc.property(fc.string(), fc.jsonValue(), (key, value) => {
    const unknown = `unknown_${key}`;
    assert.equal(isDecisionRequest({ ...request, [unknown]: value }), false);
    assert.equal(isDecisionRequest({ ...request, metadata: { ...request.metadata, [unknown]: value } }), false);
    assert.equal(isDecisionRequest({ ...request, criteria: [{ ...request.criteria[0], [unknown]: value }, request.criteria[1]] }), false);
    assert.equal(isDecisionRequest({ ...request, criteria: [request.criteria[0], request.criteria[0]] }), false);
  }), { numRuns: 100 });
});

test('Property 7: fractional/negative/unsafe usage cannot become unavailable public usage', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 100000 }), fc.constantFrom('input_tokens', 'output_tokens'), (magnitude, field) => {
    for (const invalid of [-magnitude, magnitude + 0.5, Number.MAX_SAFE_INTEGER + magnitude]) {
      assert.equal(isModelDecision({ ...modelDecision(), usage: { input_tokens: 1, output_tokens: 0, [field]: invalid } }, request), false);
    }
  }), { numRuns: 100 });
});
