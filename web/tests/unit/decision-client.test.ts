import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSameOriginDecisionClient, DecisionBridge, DecisionFailure } from '../../src/worker/decision-bridge.ts';
import { DECISION_ERROR_VERSION, type DecisionFallbackReason } from '../../src/shared/decision.ts';
import { DecisionClock, config, mapping, modelDecision, realPreviews, request, settle, wasm } from './helpers/decision.ts';

const origin = 'https://game.test';
function json(value: unknown, status = 200, contentType = 'application/json; charset=utf-8'): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': contentType } });
}
async function rejects(promise: Promise<unknown>, kind: DecisionFallbackReason): Promise<void> {
  await assert.rejects(promise, error => error instanceof DecisionFailure && error.kind === kind && error.message === kind);
}

test('production adapter fixes same-origin routes/methods and disables redirect/CORS dependencies', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init! });
    return calls.length === 1 ? json(config()) : json(modelDecision());
  };
  const client = createSameOriginDecisionClient(origin, fetcher);
  const signal = new AbortController().signal;
  assert.deepEqual(await client.config(signal), config());
  assert.deepEqual(await client.decide(request, signal), modelDecision());
  assert.deepEqual(calls.map(call => [call.url, call.init.method]), [
    [`${origin}/api/decision/config`, 'GET'], [`${origin}/api/decision`, 'POST'],
  ]);
  for (const call of calls) {
    assert.equal(call.init.signal, signal);
    assert.equal(call.init.mode, 'same-origin');
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
  }
  assert.equal(calls[0]!.init.body, undefined);
  assert.deepEqual(JSON.parse(calls[1]!.init.body as string), request);
  assert.equal(new Headers(calls[1]!.init.headers).get('Content-Type'), 'application/json; charset=utf-8');
  for (const invalidOrigin of ['https://game.test/path', 'https://user:password@game.test', 'file:///tmp/game']) {
    assert.throws(() => createSameOriginDecisionClient(invalidOrigin, fetcher), DecisionFailure);
  }
});

test('adapter accepts disabled config, zero/max cap and canonical null/two-counter success', async () => {
  for (const value of [config(0), config(Number.MAX_SAFE_INTEGER), config(40, false)]) {
    const client = createSameOriginDecisionClient(origin, async () => json(value));
    assert.deepEqual(await client.config(new AbortController().signal), value);
  }
  for (const usage of [null, { input_tokens: 123, output_tokens: 4 }]) {
    const value = { ...modelDecision(), usage, session_cap: 99 };
    const client = createSameOriginDecisionClient(origin, async () => json(value));
    assert.deepEqual(await client.decide(request, new AbortController().signal), value);
  }
});

test('unsupported versions/fields, media types, success statuses and contract mismatch are invalid_response', async () => {
  const successes: unknown[] = [
    { ...modelDecision(), version: 'other' }, { ...modelDecision(), extra: 'private' },
    { ...modelDecision(), mapping_hash: '0'.repeat(64) }, { ...modelDecision(), fingerprint: '0'.repeat(64) },
    { ...modelDecision(), choice: 'not_an_option' }, { ...modelDecision(), usage: {} },
    { ...modelDecision(), usage: { input_tokens: 1 } },
    { ...modelDecision(), usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } },
    { ...modelDecision(), usage: { input_tokens: -1, output_tokens: 0 } },
    { ...modelDecision(), usage: { input_tokens: 1, output_tokens: Number.MAX_SAFE_INTEGER + 1 } },
  ];
  const absent = { ...modelDecision() } as Record<string, unknown>;
  delete absent.usage;
  successes.push(absent);
  for (const value of successes) {
    await rejects(createSameOriginDecisionClient(origin, async () => json(value)).decide(request, new AbortController().signal), 'invalid_response');
  }
  for (const value of [{ ...config(), version: 'other' }, { ...config(), session_cap: '40' },
    { ...config(), session_cap: -1 }, { ...config(), session_cap: 0.5 },
    { ...config(), session_cap: Number.MAX_SAFE_INTEGER + 1 }, { ...config(), enabled: 1 },
    { ...config(), extra: true }, { version: config().version, enabled: true }]) {
    await rejects(createSameOriginDecisionClient(origin, async () => json(value)).config(new AbortController().signal), 'invalid_response');
  }
  for (const response of [json(config(), 201), json(config(), 200, 'text/html'),
    new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
    new Response(null, { status: 204 }), json(modelDecision(), 500)]) {
    await rejects(createSameOriginDecisionClient(origin, async () => response).config(new AbortController().signal), 'invalid_response');
  }
  const mediaParameters = createSameOriginDecisionClient(origin, async () => json(config(), 200, 'APPLICATION/JSON; charset=utf-8'));
  assert.deepEqual(await mediaParameters.config(new AbortController().signal), config());
});

test('typed HTTP errors use independent fixed status pairs; malformed errors never leak text', async () => {
  const pairs = [['malformed_request', 400], ['not_found', 404], ['method_not_allowed', 405],
    ['payload_too_large', 413], ['model_error', 502], ['invalid_response', 502],
    ['disabled', 503], ['unavailable', 503], ['quota', 429], ['rate_limited', 429]] as const;
  for (const [kind, status] of pairs) {
    const wire = { version: DECISION_ERROR_VERSION, error: { kind } };
    const client = createSameOriginDecisionClient(origin, async () => json(wire, status));
    await rejects(client.decide(request, new AbortController().signal), kind);
    await rejects(createSameOriginDecisionClient(origin, async () => json(wire, 200)).decide(request, new AbortController().signal), 'invalid_response');
    await rejects(createSameOriginDecisionClient(origin, async () => json(wire, 418)).decide(request, new AbortController().signal), 'invalid_response');
    const extra = { ...wire, error: { kind, message: 'provider secret and prompt' } };
    await rejects(createSameOriginDecisionClient(origin, async () => json(extra, status)).decide(request, new AbortController().signal), 'invalid_response');
  }
  await rejects(createSameOriginDecisionClient(origin, async () => json({ error: { kind: 'disabled' } }, 503))
    .config(new AbortController().signal), 'invalid_response');
});

test('actual response bytes enforce inclusive 4096 bound without trusting Content-Length', async () => {
  for (const bytes of [4096, 4097]) {
    let cancelled = false;
    const text = JSON.stringify(config());
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.enqueue(new TextEncoder().encode(' '.repeat(bytes - new TextEncoder().encode(text).byteLength)));
        if (bytes === 4096) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const response = new Response(stream, { headers: { 'Content-Type': 'application/json' } });
    assert.equal(response.headers.has('Content-Length'), false);
    const result = createSameOriginDecisionClient(origin, async () => response).config(new AbortController().signal);
    if (bytes === 4096) assert.deepEqual(await result, config());
    else {
      await rejects(result, 'invalid_response');
      assert.equal(cancelled, true);
    }
  }
  const lie = new Response(JSON.stringify(config()) + ' '.repeat(4096), {
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
  });
  await rejects(createSameOriginDecisionClient(origin, async () => lie).config(new AbortController().signal), 'invalid_response');
});

test('invalid local request performs zero fetch; network failures and abort are distinct', async () => {
  let fetches = 0;
  const client = createSameOriginDecisionClient(origin, async () => { fetches += 1; throw Error('untrusted network text'); });
  await rejects(client.decide({ ...request, state: 'é'.repeat(32768) + 'a' }, new AbortController().signal), 'malformed_request');
  assert.equal(fetches, 0);
  await rejects(client.config(new AbortController().signal), 'network');
  assert.equal(fetches, 1);
  const aborted = new AbortController();
  aborted.abort();
  await rejects(client.decide(request, aborted.signal), 'cancelled');
  assert.equal(fetches, 1);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const signal = new AbortController();
  const bodyClient = createSameOriginDecisionClient(origin, async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }));
  const reading = bodyClient.config(signal.signal);
  await settle();
  signal.abort();
  await rejects(reading, 'cancelled');
  assert.equal(cancelled, true);
});

test('redirected/cross-origin public responses are never consumed as decisions', async () => {
  for (const fields of [{ redirected: true }, { url: 'https://other.test/api/decision' }]) {
    const response = json(modelDecision());
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(response, key, { value });
    await rejects(createSameOriginDecisionClient(origin, async () => response).decide(request, new AbortController().signal), 'invalid_response');
  }
});

test('prefetch bounds delayed headers and ignores valid HTTP response arriving after closure', async () => {
  const headers = Promise.withResolvers<Response>();
  let fetches = 0;
  let signal: AbortSignal | undefined;
  const client = createSameOriginDecisionClient(origin, async (_input, init) => {
    fetches += 1;
    signal = init!.signal!;
    return headers.promise;
  });
  const clock = new DecisionClock();
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  clock.advance(3000);
  await settle();
  assert.equal(signal!.aborted, true);
  assert.equal(bridge.status().config, 'unavailable');
  headers.resolve(json(config()));
  await settle();
  assert.equal(bridge.status().config, 'unavailable');
  assert.deepEqual(await bridge.decide(realPreviews()[0]!, new AbortController().signal), { kind: 'fallback', reason: 'unavailable' });
  assert.equal(fetches, 1);
  bridge.dispose();
});

test('partial config body never resets prefetch timer and is cancelled at 3000 ms', async () => {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; }, cancel() { cancelled = true; },
  });
  const clock = new DecisionClock();
  const client = createSameOriginDecisionClient(origin, async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  await settle();
  clock.advance(2000);
  controller!.enqueue(new TextEncoder().encode('{"version":"decision-config-v1",'));
  await settle();
  clock.advance(999);
  assert.equal(bridge.status().config, 'pending');
  clock.advance(1);
  await settle();
  assert.equal(cancelled, true);
  assert.equal(bridge.status().config, 'unavailable');
  assert.equal(clock.timers.size, 0);
  bridge.dispose();
});

test('POST deadline covers delayed response body rather than stopping at successful headers', async () => {
  let postCancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { postCancelled = true; } });
  const client = createSameOriginDecisionClient(origin, async (_input, init) => init!.method === 'GET'
    ? json(config()) : new Response(body, { headers: { 'Content-Type': 'application/json' } }));
  const clock = new DecisionClock();
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  await settle();
  bridge.setWaitSeconds(1);
  const operation = bridge.decide(realPreviews()[0]!, new AbortController().signal);
  await settle();
  clock.advance(1000);
  assert.deepEqual(await operation, { kind: 'fallback', reason: 'timeout' });
  assert.equal(postCancelled, true);
  assert.equal(bridge.status().spent, 1);
  bridge.dispose();
});
