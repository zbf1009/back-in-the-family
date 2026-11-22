import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../../src/handler.ts';
import { DECISION_CONTRACT, decisionFingerprint } from '../../../web/src/shared/decision-contract.ts';
import {
  DECISION_WIRE_BOUNDS, PROJECT_REQUEST_BYTE_CAP, decisionObject, isDecisionConfig, isDecisionRequest, isModelDecision, withinDecisionDepth,
} from '../../../web/src/shared/decision.ts';
import {
  decisionRequest, enabledVariables, expectError, nativeResult, post, publicBody,
} from '../helpers/decision.ts';
import { sourceConfig } from '../../scripts/profile.ts';

function binding(result: unknown = nativeResult(), error?: unknown) {
  const calls: { model: unknown; input: unknown }[] = [];
  const AI = {
    async run(model: unknown, input: unknown, options: unknown): Promise<Response> {
      calls.push({ model, input });
      assert.deepEqual(options, { returnRawResponse: true });
      if (error !== undefined) throw error;
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    },
  };
  return { calls, env: { ...enabledVariables(), AI } };
}
const get = () => new Request('https://decision.test/api/decision/config');

test('GET readiness matches POST and missing session cap defaults to 40 without AI', async () => {
  for (const cap of [undefined, 0, 40, Number.MAX_SAFE_INTEGER, '0', '40', String(Number.MAX_SAFE_INTEGER)]) {
    const fake = binding();
    const env = { ...fake.env, ...(cap === undefined ? {} : { SESSION_CAP: cap }) };
    const response = await handleRequest(get(), env);
    const body = await publicBody(response);
    assert.equal(response.status, 200);
    assert.ok(isDecisionConfig(body));
    assert.deepEqual(body, { version: 'decision-config-v1', enabled: true, session_cap: cap === undefined ? 40 : Number(cap) });
    assert.equal(fake.calls.length, 0);
    assert.equal((await handleRequest(post(), env)).status, 200);
    assert.equal(fake.calls.length, 1);
  }
});

test('explicit invalid session cap never defaults or permits AI', async () => {
  for (const cap of [null, undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '', ' 40', '40 ', '+40', '01', '1e2', '1.0', 'NaN', '9007199254740992', true, {}, []]) {
    const fake = binding();
    const env = { ...fake.env, SESSION_CAP: cap };
    await expectError(await handleRequest(get(), env), 'disabled', 503);
    await expectError(await handleRequest(post(), env), 'disabled', 503);
    assert.equal(fake.calls.length, 0);
  }
});

test('off and every missing invalid cap or AI binding closes POST before parsing', async () => {
  const cases: Record<string, unknown>[] = [
    { INFERENCE_ENABLED: false }, { INFERENCE_ENABLED: 'false' }, { INFERENCE_ENABLED: undefined },
    { INFERENCE_ENABLED: '1' }, { INFERENCE_ENABLED: 1 },
    ...[undefined, null, 0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
      DECISION_WIRE_BOUNDS.requestBytesCeiling + 1, '', ' 1', '1.0', '1e3', true, {}, []]
      .map(MAX_REQUEST_BYTES => ({ MAX_REQUEST_BYTES })),
    ...[undefined, null, {}, { run: 3 }].map(AI => ({ AI })),
  ];
  for (const change of cases) {
    const fake = binding();
    const env = { ...fake.env, ...change };
    const response = await handleRequest(get(), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await publicBody(response), { version: 'decision-config-v1', enabled: false, session_cap: 40 });
    await expectError(await handleRequest(new Request('https://decision.test/api/decision', {
      method: 'POST', body: '{',
    }), env), 'disabled', 503);
    assert.equal(fake.calls.length, 0);
  }
});

test('valid request calls native binding once with selected fictional fields only', async () => {
  const fake = binding();
  const request = decisionRequest();
  const response = await handleRequest(post(request), fake.env);
  assert.equal(response.status, 200);
  const body = await publicBody(response);
  assert.ok(isModelDecision(body, request));
  assert.equal(await decisionFingerprint(), DECISION_CONTRACT.fingerprint);
  assert.deepEqual(fake.calls, [{ model: '@cf/cloudflare/clef', input: {
    model: 'clef', state: request.state, questions: { decision: {
      type: 'choice', instructions: request.instructions,
      criteria: { heed_warning: 'Heed the warning.', dismiss_dream: 'Dismiss the dream.' },
    } },
  } }]);
  assert.deepEqual(body, {
    version: DECISION_CONTRACT.responseSchema, choice: 'heed_warning', model: DECISION_CONTRACT.model,
    mapping_version: DECISION_CONTRACT.mappingVersion, mapping_hash: DECISION_CONTRACT.mappingHash,
    fingerprint: DECISION_CONTRACT.fingerprint, usage: { input_tokens: 23, output_tokens: 1 }, session_cap: 40,
  });
});

test('absent native usage projects required null and ignores deep provider fields', async () => {
  const raw = nativeResult();
  delete raw.usage;
  raw.model = '界'.repeat(42) + 'ab';
  raw.provider_text = 'PRIVATE_PROVIDER_SENTINEL';
  raw.answers = { decision: {
    type: 'choice', choice: 'heed_warning', confidence: 'unconsumed',
    probabilities: { a: { b: { c: { d: { e: 'PRIVATE_PROVIDER_SENTINEL' } } } } },
  }, ignored: { a: { b: { c: { d: {} } } } } };
  const fake = binding(raw);
  const response = await handleRequest(post(), fake.env);
  assert.equal(response.status, 200);
  const body = await publicBody(response);
  assert.ok(isModelDecision(body, decisionRequest()));
  assert.equal(body.usage, null);
  assert.equal(body.model, DECISION_CONTRACT.model);
  assert.ok(!JSON.stringify(body).includes('PRIVATE_PROVIDER_SENTINEL'));
  assert.equal(fake.calls.length, 1);
});

test('present native usage must be exact valid two-counter safe integers', async () => {
  const invalid = [null, false, '23', [], {}, { input_tokens: 1 }, { output_tokens: 1 },
    ...['reasoning_tokens', 'total_tokens', 'neurons', 'extra'].map(key => ({ input_tokens: 1, output_tokens: 1, [key]: 0 })),
    ...[-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null].flatMap(value => [
      { input_tokens: value, output_tokens: 1 }, { input_tokens: 1, output_tokens: value },
    ])];
  for (const usage of invalid) {
    const fake = binding({ ...nativeResult(), usage });
    await expectError(await handleRequest(post(), fake.env), 'invalid_response', 502);
    assert.equal(fake.calls.length, 1);
  }
  for (const usage of [{ input_tokens: 0, output_tokens: 0 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: Number.MAX_SAFE_INTEGER }]) {
    const fake = binding({ ...nativeResult(), usage });
    const body = await publicBody(await handleRequest(post(), fake.env));
    assert.ok(isModelDecision(body, decisionRequest()));
    assert.deepEqual(body.usage, usage);
  }
});

test('invalid consumed provider model answer membership and REST envelope close', async () => {
  const valid = nativeResult();
  const bad = [null, [], {}, { result: valid, success: true },
    ...[undefined, null, '', 1, 'a'.repeat(129), '界'.repeat(43)].map(model => ({ ...valid, model })),
    ...[undefined, null, [], {}, { decision: [] }, { decision: {} },
      { decision: { type: 'score', choice: 'heed_warning' } },
      ...['unknown', 'Heed_warning', 'a1', 'a'.repeat(65), '', null].map(choice => ({ decision: { type: 'choice', choice } })),
    ].map(answers => ({ ...valid, answers }))];
  for (const raw of bad) {
    const fake = binding(raw);
    await expectError(await handleRequest(post(), fake.env), 'invalid_response', 502);
    assert.equal(fake.calls.length, 1);
  }
  for (const model of ['different-provider-name', 'a'.repeat(128), '界'.repeat(42) + 'ab']) {
    const fake = binding({ ...valid, model });
    assert.equal((await handleRequest(post(), fake.env)).status, 200);
  }
});

test('malformed JSON stream failures invalid UTF8 and no body are 400 zero AI', async () => {
  const fake = binding();
  for (const request of [new Request('https://decision.test/api/decision', { method: 'POST' }),
    new Request('https://decision.test/api/decision', { method: 'POST', body: '{' }),
    new Request('https://decision.test/api/decision', { method: 'POST', body: new Uint8Array([0xff]) }),
    streamRequest(new ReadableStream({ start(controller) { controller.error(new Error('PRIVATE_INPUT')); } }))]) {
    await expectError(await handleRequest(request, fake.env), 'malformed_request', 400);
  }
  assert.equal(fake.calls.length, 0);
});

function streamRequest(body: ReadableStream<Uint8Array>, headers?: Record<string, string>): Request {
  const init = { method: 'POST', body, duplex: 'half', headers };
  return new Request('https://decision.test/api/decision', init);
}
function byteStream(bytes: Uint8Array, chunkSize = 17): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset === bytes.byteLength) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset += Math.min(chunkSize, bytes.byteLength - offset)));
  } });
}

test('actual UTF8 bytes enforce exact and over limit independently of Content-Length', async () => {
  const value = decisionRequest();
  value.state = '界😀';
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  for (const headers of [undefined, { 'Content-Length': '1' }, { 'Content-Length': String(bytes.length + 1000) }]) {
    const fake = binding();
    const env = { ...fake.env, MAX_REQUEST_BYTES: bytes.length };
    const exact = streamRequest(byteStream(bytes), headers);
    if (headers === undefined) assert.equal(exact.headers.get('content-length'), null);
    assert.equal((await handleRequest(exact, env)).status, 200);
    assert.equal(fake.calls.length, 1);
    await expectError(await handleRequest(streamRequest(byteStream(bytes), headers),
      { ...env, MAX_REQUEST_BYTES: bytes.length - 1 }), 'payload_too_large', 413);
    assert.equal(fake.calls.length, 1);
  }
  const fake = binding();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  });
  await expectError(await handleRequest(streamRequest(body), { ...fake.env, MAX_REQUEST_BYTES: 7 }), 'payload_too_large', 413);
  assert.ok(cancelled);
  assert.equal(fake.calls.length, 0);
});

test('project policy accepts valid 16384-byte multibyte and escaped JSON only when ready; 16385 bytes never reach AI', async () => {
  const source = await sourceConfig();
  const encoder = new TextEncoder();
  for (const escaped of [false, true]) {
    const value = decisionRequest();
    value.state = '界😀é';
    const serialize = () => {
      const body = JSON.stringify(value);
      return escaped ? body.replaceAll('界', '\\u754c').replaceAll('😀', '\\ud83d\\ude00') : body;
    };
    value.state += 'a'.repeat(PROJECT_REQUEST_BYTE_CAP - encoder.encode(serialize()).byteLength);
    const exactValue = structuredClone(value);
    const exactBytes = encoder.encode(serialize());
    value.state += 'a';
    const overBytes = encoder.encode(serialize());
    assert.ok(isDecisionRequest(exactValue));
    assert.ok(isDecisionRequest(value));
    assert.equal(exactBytes.byteLength, 16384);
    assert.equal(overBytes.byteLength, 16385);
    for (const cap of [PROJECT_REQUEST_BYTE_CAP, String(PROJECT_REQUEST_BYTE_CAP)]) {
      const fake = binding();
      const env = { ...source.vars, INFERENCE_ENABLED: 'true', MAX_REQUEST_BYTES: cap, AI: fake.env.AI };
      assert.deepEqual(await publicBody(await handleRequest(get(), env)),
        { version: 'decision-config-v1', enabled: true, session_cap: 40 });
      assert.equal(fake.calls.length, 0);
      const over = streamRequest(byteStream(overBytes));
      assert.equal(over.headers.get('content-length'), null);
      await expectError(await handleRequest(over, env), 'payload_too_large', 413);
      assert.equal(fake.calls.length, 0);
      const exact = streamRequest(byteStream(exactBytes));
      assert.equal(exact.headers.get('content-length'), null);
      const response = await handleRequest(exact, env);
      assert.equal(response.status, 200);
      assert.ok(isModelDecision(await publicBody(response), exactValue));
      assert.equal(fake.calls.length, 1);
      const input = fake.calls[0]!.input;
      assert.ok(decisionObject(input));
      assert.equal(input.state, exactValue.state);
    }
    const off = binding();
    const env = { ...source.vars, AI: off.env.AI };
    assert.deepEqual(await publicBody(await handleRequest(get(), env)),
      { version: 'decision-config-v1', enabled: false, session_cap: 40 });
    for (const bytes of [exactBytes, overBytes]) {
      await expectError(await handleRequest(streamRequest(byteStream(bytes)), env), 'disabled', 503);
    }
    assert.equal(off.calls.length, 0);
  }
});

test('actual byte cap omission never falls back to the selected project policy', async () => {
  const fake = binding();
  const env: Record<string, unknown> = { ...fake.env };
  delete env.MAX_REQUEST_BYTES;
  assert.equal(Object.hasOwn(env, 'MAX_REQUEST_BYTES'), false);
  assert.deepEqual(await publicBody(await handleRequest(get(), env)),
    { version: 'decision-config-v1', enabled: false, session_cap: 40 });
  await expectError(await handleRequest(post(), env), 'disabled', 503);
  assert.equal(fake.calls.length, 0);
});

test('decoded field UTF8 limits accept exact and reject one byte over including escaped JSON', async () => {
  for (const [field, maximum] of [['state', 65536], ['instructions', 8192], ['label', 1024]] as const) {
    for (const escaped of [false, true]) {
      const fake = binding();
      const value = decisionRequest();
      const exact = '界'.repeat(Math.floor(maximum / 3)) + 'a'.repeat(maximum % 3);
      if (field === 'label') value.criteria[0]!.label = exact;
      else value[field] = exact;
      const serialize = () => escaped ? JSON.stringify(value).replaceAll('界', '\\u754c') : JSON.stringify(value);
      const raw = () => new Request('https://decision.test/api/decision', { method: 'POST', body: serialize() });
      assert.equal((await handleRequest(raw(), fake.env)).status, 200);
      if (field === 'label') value.criteria[0]!.label += 'a';
      else value[field] += 'a';
      await expectError(await handleRequest(raw(), fake.env), 'malformed_request', 400);
      assert.equal(fake.calls.length, 1);
    }
  }
});

test('shared exact shape literals metadata mapping and criterion domains reject zero AI', async () => {
  const base = decisionRequest();
  const cases: unknown[] = [null, [], {}, { ...base, extra: 1 },
    ...Object.keys(base).map(key => Object.fromEntries(Object.entries(base).filter(([name]) => name !== key))),
    ...['version', 'family', 'mapping_version', 'mapping_hash', 'question_id'].map(key => ({ ...base, [key]: 'wrong' })),
    ...[{}, { bridge_version: 'wrong' }, { bridge_version: 'slow-think-v1', extra: 1 }, []].map(metadata => ({ ...base, metadata })),
    ...['state', 'instructions'].flatMap(key => ['', null, 1, []].map(value => ({ ...base, [key]: value }))),
    ...[[], [base.criteria[0]], Array.from({ length: 6 }, (_, i) => ({ id: 'a' + '_'.repeat(i), label: 'valid' })),
      [base.criteria[0], base.criteria[0]],
      ...['', 'A', 'a1', '_a', 'a-b', 'a'.repeat(65)].map(id => [{ id, label: 'valid' }, base.criteria[1]]),
      ...[{}, { id: 'a' }, { label: 'a' }, { id: 'a', label: '' }, { id: 'a', label: 'a', extra: 1 }].map(item => [item, base.criteria[1]]),
    ].map(criteria => ({ ...base, criteria }))];
  const fake = binding();
  for (const value of cases) await expectError(await handleRequest(post(value), fake.env), 'malformed_request', 400);
  assert.equal(fake.calls.length, 0);
  for (const family of ['dream_interpretation', 'magistrate_ruling']) {
    for (const count of [2, 5]) {
      const value = { ...base, family, criteria: Array.from({ length: count }, (_, i) => ({ id: 'a' + '_'.repeat(63 - i), label: 'valid' })) };
      const accepted = binding({ ...nativeResult(), answers: {
        decision: { type: 'choice', choice: value.criteria[0]!.id },
      } });
      const response = await handleRequest(post(value), accepted.env);
      assert.equal(response.status, 200);
      assert.ok(isModelDecision(await publicBody(response), { ...base, criteria: value.criteria }));
      assert.equal(accepted.calls.length, 1);
    }
  }
});

test('depth counts containers only and stops before visiting over-bound children', async () => {
  assert.ok(withinDecisionDepth({ a: [{ b: { leaf: 'primitive' } }] }));
  assert.ok(!withinDecisionDepth({ a: [{ b: { leaf: {} } }] }));
  const tooDeep = Object.defineProperty({}, 'neverRead', { enumerable: true, get() { throw new Error('visited depth 5'); } });
  assert.equal(withinDecisionDepth({ a: [{ b: { leaf: tooDeep } }] }), false);
  const fake = binding();
  await expectError(await handleRequest(post({ ...decisionRequest(), metadata: { bridge_version: { a: { b: {} } } } }), fake.env), 'malformed_request', 400);
  assert.equal(fake.calls.length, 0);
});

test('API paths methods fixed Allow errors and native failures are redacted without retries', async () => {
  const fake = binding();
  for (const path of ['/api', '/api/', '/api/unknown', '/api/decision/', '/api/decision/config/']) {
    await expectError(await handleRequest(new Request('https://decision.test' + path), fake.env), 'not_found', 404);
  }
  for (const [path, allow] of [['/api/decision', 'POST'], ['/api/decision/config', 'GET']]) {
    for (const method of ['GET', 'POST', 'PUT', 'HEAD', 'OPTIONS', 'DELETE'].filter(method => method !== allow)) {
      const response = await handleRequest(new Request('https://decision.test' + path, { method }), fake.env);
      assert.equal(response.headers.get('allow'), allow);
      await expectError(response, 'method_not_allowed', 405);
    }
  }
  assert.equal(fake.calls.length, 0);
  for (const [error, kind, status] of [
    [new Error('PRIVATE_PROVIDER_SENTINEL'), 'model_error', 502],
    [{ status: 429, code: 3036, message: 'PRIVATE_PROVIDER_SENTINEL' }, 'model_error', 502],
    [{ code: 3036, message: 'daily quota PRIVATE_PROVIDER_SENTINEL' }, 'model_error', 502],
  ] as const) {
    const failed = binding(undefined, error);
    await expectError(await handleRequest(post(), failed.env), kind, status);
    assert.equal(failed.calls.length, 1);
  }
});

test('request-owned native 429 and 200 remain independent under concurrent calls and stale shared diagnostics', async () => {
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  let cancelled = false;
  const AI = {
    lastRequestHttpStatusCode: 429,
    lastRequestId: 'expired-shared-diagnostic',
    async run(_model: unknown, input: unknown, options: unknown): Promise<Response> {
      assert.deepEqual(options, { returnRawResponse: true });
      assert.ok(typeof input === 'object' && input !== null && 'state' in input);
      calls += 1;
      if (calls === 2) gate.resolve();
      await gate.promise;
      if (input.state === 'rate-limit') {
        return new Response(new ReadableStream({
          pull(controller) { controller.enqueue(new TextEncoder().encode('PRIVATE_PROVIDER_3036_QUOTA')); },
          cancel() { cancelled = true; },
        }), { status: 429 });
      }
      return new Response(JSON.stringify(nativeResult()));
    },
  };
  const env = { ...enabledVariables(), AI };
  const rate = { ...decisionRequest(), state: 'rate-limit' };
  const [limited, successful] = await Promise.all([handleRequest(post(rate), env), handleRequest(post(), env)]);
  await expectError(limited, 'rate_limited', 429);
  assert.equal(successful.status, 200);
  assert.ok(isModelDecision(await publicBody(successful), decisionRequest()));
  assert.equal(calls, 2);
  assert.ok(cancelled);
});

test('native non-200 provider bodies are discarded and malformed successful transport is invalid_response', async () => {
  for (const status of [400, 403, 500, 503]) {
    let cancelled = false;
    const env = { ...enabledVariables(), AI: {
      async run() {
        return new Response(new ReadableStream({
          pull(controller) { controller.enqueue(new TextEncoder().encode('PRIVATE_PROVIDER_SENTINEL')); },
          cancel() { cancelled = true; },
        }), { status });
      },
    } };
    await expectError(await handleRequest(post(), env), 'model_error', 502);
    assert.ok(cancelled);
  }
  for (const result of [new Response('{'), new Response(null), nativeResult()]) {
    const env = { ...enabledVariables(), AI: { async run() { return result; } } };
    await expectError(await handleRequest(post(), env), 'invalid_response', 502);
  }
});

test('explicit byte safety endpoints are readiness bounds not a default or server session quota', async () => {
  for (const cap of [1, '1', DECISION_WIRE_BOUNDS.requestBytesCeiling, String(DECISION_WIRE_BOUNDS.requestBytesCeiling)]) {
    const fake = binding();
    const env = { ...fake.env, INFERENCE_ENABLED: true, MAX_REQUEST_BYTES: cap, SESSION_CAP: 0 };
    const response = await handleRequest(get(), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await publicBody(response), { version: 'decision-config-v1', enabled: true, session_cap: 0 });
    assert.equal(fake.calls.length, 0);
    const decision = await handleRequest(post(), env);
    if (Number(cap) === 1) {
      await expectError(decision, 'payload_too_large', 413);
      assert.equal(fake.calls.length, 0);
    } else {
      assert.equal(decision.status, 200);
      const body = await publicBody(decision);
      assert.ok(isModelDecision(body, decisionRequest()));
      assert.equal(body.session_cap, 0);
      assert.equal(fake.calls.length, 1);
    }
  }
});
