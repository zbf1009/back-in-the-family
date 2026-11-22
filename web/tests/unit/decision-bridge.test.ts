import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { DecisionBridge, DecisionFailure, type DecisionWasm } from '../../src/worker/decision-bridge.ts';
import { PROJECT_REQUEST_BYTE_CAP, isDecisionError, isDecisionRequest,
  type DecisionConfig, type ModelDecision } from '../../src/shared/decision.ts';
import { ControlledDecisionClient, DecisionClock, HandlerDecisionClient, config, mapping, modelDecision,
  realPreviews, settle, transportPaddedWasm, wasm } from './helpers/decision.ts';

async function ready(cap = 40, selectedWasm: DecisionWasm = wasm) {
  const client = new ControlledDecisionClient();
  const clock = new DecisionClock();
  const bridge = new DecisionBridge(client, selectedWasm, mapping, clock);
  client.prefetched.resolve(config(cap));
  await settle();
  return { client, clock, bridge };
}

test('prefetch does not block unready operations; late valid config affects only later operations', async () => {
  const client = new ControlledDecisionClient();
  const clock = new DecisionClock();
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  assert.equal(client.configSignals.length, 1);
  assert.equal(clock.timers.size, 1);
  assert.deepEqual(await bridge.decide(realPreviews()[0]!, new AbortController().signal), { kind: 'fallback', reason: 'config_pending' });
  assert.equal(client.attempts.length, 0);
  client.prefetched.resolve(config(1));
  await settle();
  assert.equal(clock.timers.size, 0);
  const operation = bridge.decide(realPreviews()[0]!, new AbortController().signal);
  assert.equal(bridge.status().spent, 1);
  client.attempts[0]!.response.resolve(modelDecision(client.attempts[0]!.request.criteria[0]!.id));
  assert.equal((await operation).kind, 'model');
  assert.equal(client.configSignals.length, 1);
  bridge.dispose();
});

test('independent prefetch deadline is exactly 3000 ms at both zero and ten-second decision settings', async () => {
  for (const wait of [0, 10]) {
    const client = new ControlledDecisionClient();
    const clock = new DecisionClock();
    const bridge = new DecisionBridge(client, wasm, mapping, clock);
    bridge.setWaitSeconds(wait);
    clock.advance(2999);
    assert.equal(bridge.status().config, 'pending');
    assert.equal(client.configSignals[0]!.aborted, false);
    clock.advance(1);
    await settle();
    assert.equal(client.configSignals[0]!.aborted, true);
    assert.equal(bridge.status().config, 'unavailable');
    client.prefetched.resolve(config());
    await settle();
    assert.equal(bridge.status().config, 'unavailable');
    assert.deepEqual(await bridge.decide(realPreviews()[0]!, new AbortController().signal), { kind: 'fallback', reason: 'unavailable' });
    assert.equal(client.configSignals.length, 1);
    assert.equal(client.attempts.length, 0);
    assert.equal(clock.timers.size, 0);
    bridge.dispose();
  }
});

test('config failure, invalid config and disabled readiness never spend or re-prefetch', async () => {
  for (const result of ['network', 'invalid', 'disabled'] as const) {
    const client = new ControlledDecisionClient();
    const clock = new DecisionClock();
    const bridge = new DecisionBridge(client, wasm, mapping, clock);
    if (result === 'network') client.prefetched.reject(Error('untrusted network detail'));
    else client.prefetched.resolve(result === 'disabled' ? config(40, false)
      : { ...config(), extra: true } as DecisionConfig);
    await settle();
    for (let index = 0; index < 3; index += 1) {
      const operation = await bridge.decide(realPreviews()[0]!, new AbortController().signal);
      assert.deepEqual(operation, { kind: 'fallback', reason: result === 'disabled' ? 'disabled' : 'unavailable' });
    }
    assert.equal(bridge.status().spent, 0);
    assert.equal(client.attempts.length, 0);
    assert.equal(client.configSignals.length, 1);
    bridge.dispose();
  }
});

test('config validation remains within the prefetch deadline even if the timer callback is queued', async () => {
  const clock = new DecisionClock();
  const client = new ControlledDecisionClient();
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  const value = config();
  Object.defineProperty(value, 'enabled', { enumerable: true, get() { clock.milliseconds = 3000; return true; } });
  client.prefetched.resolve(value);
  await settle();
  assert.equal(bridge.status().config, 'unavailable');
  assert.equal(client.configSignals[0]!.aborted, true);
  bridge.dispose();
});

test('document disposal aborts config and ignores late completion without another prefetch', async () => {
  const client = new ControlledDecisionClient();
  const clock = new DecisionClock();
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  bridge.dispose();
  assert.equal(client.configSignals[0]!.aborted, true);
  client.prefetched.resolve(config());
  await settle();
  assert.equal(bridge.status().config, 'disposed');
  assert.equal(clock.timers.size, 0);
  assert.equal(client.configSignals.length, 1);
});

test('zero cap and zero wait skip inference; wait clamps and does not reset document state', async () => {
  const { client, bridge } = await ready(0);
  assert.equal(bridge.status().waitSeconds, 10);
  assert.deepEqual(await bridge.decide(realPreviews()[0]!, new AbortController().signal), { kind: 'fallback', reason: 'session_cap' });
  bridge.setWaitSeconds(-5);
  assert.equal(bridge.status().waitSeconds, 0);
  assert.deepEqual(await bridge.decide(realPreviews()[0]!, new AbortController().signal), { kind: 'fallback', reason: 'zero_wait' });
  bridge.setWaitSeconds(99);
  assert.equal(bridge.status().waitSeconds, 10);
  bridge.setWaitSeconds(NaN);
  assert.equal(bridge.status().waitSeconds, 10);
  assert.equal(bridge.status().spent, 0);
  assert.equal(client.attempts.length, 0);
  assert.equal(client.configSignals.length, 1);
  bridge.dispose();
});

test('both real WASM families render and validate without committing any game input', async () => {
  const { client, bridge } = await ready();
  for (const preview of realPreviews()) {
    assert.equal(preview.ok, true);
    const operation = bridge.decide(preview, new AbortController().signal);
    const attempt = client.attempts.at(-1)!;
    assert.equal(attempt.request.family, preview.family);
    assert.deepEqual(attempt.request.criteria, preview.option_defs);
    assert.equal(Object.hasOwn(attempt.request, 'frozen_context'), false);
    attempt.response.resolve(modelDecision(preview.option_ids[0]!, 0));
    const outcome = await operation;
    assert.equal(outcome.kind, 'model');
    assert.equal(bridge.status().sessionCap, 40, 'different POST cap is diagnostic only');
  }
  assert.equal(bridge.status().spent, 2);
  bridge.dispose();
});

test('invalid local renderer/option contract makes no POST and spends no attempt', async () => {
  for (const render of [() => '{', () => '{"ok":false,"error":{"message":"private"}}',
    (input: string) => {
      const rendered = JSON.parse(wasm.llm_render_system_one(input));
      rendered.criteria[0].label = 'a'.repeat(1025);
      return JSON.stringify(rendered);
    }]) {
    const { bridge, client } = await ready(40, { ...wasm, llm_render_system_one: render });
    assert.deepEqual(await bridge.decide(realPreviews()[0]!, new AbortController().signal), { kind: 'fallback', reason: 'malformed_request' });
    assert.equal(client.attempts.length, 0);
    assert.equal(bridge.status().spent, 0);
    bridge.dispose();
  }
  const { bridge, client } = await ready();
  const preview = { ...realPreviews()[0]!, option_ids: ['not_an_option', 'another_option'] };
  assert.deepEqual(await bridge.decide(preview, new AbortController().signal), { kind: 'fallback', reason: 'malformed_request' });
  assert.equal(client.attempts.length, 0);
  bridge.dispose();
});

test('invalid public results and Rust validator errors always fall back without refund/retry', async () => {
  const { bridge, client } = await ready();
  const preview = realPreviews()[0]!;
  for (const mutate of [
    (value: ModelDecision) => ({ ...value, choice: 'not_an_option' }),
    (value: ModelDecision) => ({ ...value, mapping_hash: '0'.repeat(64) }),
    (value: ModelDecision) => ({ ...value, fingerprint: '0'.repeat(64) }),
    (value: ModelDecision) => ({ ...value, usage: undefined }),
    (value: ModelDecision) => ({ ...value, extra: 'private' }),
  ]) {
    const operation = bridge.decide(preview, new AbortController().signal);
    const attempt = client.attempts.at(-1)!;
    attempt.response.resolve(mutate(modelDecision(preview.option_ids[0]!)) as ModelDecision);
    assert.deepEqual(await operation, { kind: 'fallback', reason: 'invalid_response' });
  }
  assert.equal(client.attempts.length, 5);
  assert.equal(bridge.status().spent, 5);
  bridge.dispose();
  const broken = await ready(1, { ...wasm, llm_validate: () => '{"ok":false,"error":{"kind":"illegal_option"}}' });
  const operation = broken.bridge.decide(preview, new AbortController().signal);
  broken.client.attempts[0]!.response.resolve(modelDecision(preview.option_ids[0]!));
  assert.deepEqual(await operation, { kind: 'fallback', reason: 'invalid_response' });
  broken.bridge.dispose();
  // A valid request/wire choice with a different frozen Rust option set must still
  // be rejected by Rust rather than by a second TS legality implementation.
  const other = realPreviews()[1]!;
  const mismatchedWasm: DecisionWasm = { ...wasm, llm_validate: input => {
    const envelope = JSON.parse(input);
    return wasm.llm_validate(JSON.stringify({ ...envelope, frozen_context: other.frozen_context }));
  } };
  const illegal = await ready(1, mismatchedWasm);
  const illegalOperation = illegal.bridge.decide(preview, new AbortController().signal);
  illegal.client.attempts[0]!.response.resolve(modelDecision(preview.option_ids[0]!));
  assert.deepEqual(await illegalOperation, { kind: 'fallback', reason: 'invalid_response' });
  illegal.bridge.dispose();
});

test('budget is spent before send and survives failure/cancel plus different family previews', async () => {
  const { bridge, client } = await ready(2);
  const first = bridge.decide(realPreviews()[0]!, new AbortController().signal);
  assert.equal(bridge.status().spent, 1);
  client.attempts[0]!.response.reject(new DecisionFailure('quota'));
  assert.deepEqual(await first, { kind: 'fallback', reason: 'quota' });
  const abort = new AbortController();
  const second = bridge.decide(realPreviews()[1]!, abort.signal);
  assert.equal(bridge.status().spent, 2);
  abort.abort();
  assert.deepEqual(await second, { kind: 'fallback', reason: 'cancelled' });
  assert.equal(client.attempts[1]!.signal.aborted, true);
  client.attempts[1]!.response.resolve(modelDecision(realPreviews()[1]!.option_ids[0]!));
  await settle();
  assert.deepEqual(await bridge.decide(realPreviews()[0]!, new AbortController().signal), { kind: 'fallback', reason: 'session_cap' });
  assert.equal(client.attempts.length, 2);
  assert.equal(client.configSignals.length, 1);
  bridge.dispose();
});

test('wait is snapshotted per operation; timeout ignores late result and does not refund', async () => {
  const { bridge, clock, client } = await ready(2);
  bridge.setWaitSeconds(1.5);
  const pending = bridge.decide(realPreviews()[0]!, new AbortController().signal);
  bridge.setWaitSeconds(10);
  clock.advance(1499);
  assert.equal(client.attempts[0]!.signal.aborted, false);
  clock.advance(1);
  assert.deepEqual(await pending, { kind: 'fallback', reason: 'timeout' });
  assert.equal(client.attempts[0]!.signal.aborted, true);
  client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
  await settle();
  assert.equal(bridge.status().spent, 1);
  const next = bridge.decide(realPreviews()[1]!, new AbortController().signal);
  clock.advance(9999);
  assert.equal(client.attempts[1]!.signal.aborted, false);
  clock.advance(1);
  assert.deepEqual(await next, { kind: 'fallback', reason: 'timeout' });
  bridge.dispose();
});

test('decision deadline includes validation and document disposal aborts an outstanding request', async () => {
  const clock = new DecisionClock();
  const client = new ControlledDecisionClient();
  const bridge = new DecisionBridge(client, { ...wasm, llm_validate: input => {
    const result = wasm.llm_validate(input);
    clock.milliseconds = 10000;
    return result;
  } }, mapping, clock);
  client.prefetched.resolve(config());
  await settle();
  const pending = bridge.decide(realPreviews()[0]!, new AbortController().signal);
  client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
  assert.deepEqual(await pending, { kind: 'fallback', reason: 'timeout' });
  const next = bridge.decide(realPreviews()[1]!, new AbortController().signal);
  bridge.dispose();
  assert.deepEqual(await next, { kind: 'fallback', reason: 'cancelled' });
  assert.equal(client.attempts[1]!.signal.aborted, true);
  assert.equal(clock.timers.size, 0);
});

test('Property 8: every attempted outcome spends exactly once and never exceeds cached GET cap', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 6 }),
    fc.array(fc.constantFrom('model', 'network', 'rate_limited', 'timeout', 'cancelled'), { maxLength: 10 }),
    async (cap, outcomes) => {
      const { bridge, clock, client } = await ready(cap);
      bridge.setWaitSeconds(1);
      let expected = 0;
      for (const outcome of outcomes) {
        const abort = new AbortController();
        const preview = realPreviews()[expected % 2]!;
        const operation = bridge.decide(preview, abort.signal);
        if (expected >= cap) {
          assert.deepEqual(await operation, { kind: 'fallback', reason: 'session_cap' });
          continue;
        }
        expected += 1;
        assert.equal(bridge.status().spent, expected);
        const attempt = client.attempts.at(-1)!;
        if (outcome === 'model') attempt.response.resolve(modelDecision(preview.option_ids[0]!, cap + 20));
        else if (outcome === 'timeout') clock.advance(1000);
        else if (outcome === 'cancelled') abort.abort();
        else attempt.response.reject(new DecisionFailure(outcome));
        const result = await operation;
        assert.equal(result.kind, outcome === 'model' ? 'model' : 'fallback');
        assert.equal(bridge.status().sessionCap, cap);
      }
      assert.equal(client.attempts.length, Math.min(cap, outcomes.length));
      assert.equal(bridge.status().spent, expected);
      assert.equal(client.configSignals.length, 1);
      bridge.dispose();
    }), { numRuns: 100 });
});

test('concurrent advisory requests still spend before dispatch and obey a one-attempt cap', async () => {
  const { bridge, client } = await ready(1);
  const dispatch = client.decide.bind(client);
  client.decide = (request, signal) => {
    assert.equal(bridge.status().spent, 1, 'attempt is already spent inside the client dispatch');
    return dispatch(request, signal);
  };
  const first = bridge.decide(realPreviews()[0]!, new AbortController().signal);
  assert.deepEqual(await bridge.decide(realPreviews()[1]!, new AbortController().signal), { kind: 'fallback', reason: 'session_cap' });
  assert.equal(client.attempts.length, 1);
  assert.equal(bridge.status().spent, 1);
  client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
  assert.equal((await first).kind, 'model');
  bridge.dispose();
});

test('late model completion after timeout/cancel is ignored before invoking Rust validation', async () => {
  for (const terminal of ['timeout', 'cancelled'] as const) {
    let validations = 0;
    const { bridge, clock, client } = await ready(1, { ...wasm, llm_validate: input => {
      validations += 1;
      return wasm.llm_validate(input);
    } });
    const abort = new AbortController();
    const operation = bridge.decide(realPreviews()[0]!, abort.signal);
    if (terminal === 'timeout') clock.advance(10000);
    else abort.abort();
    assert.deepEqual(await operation, { kind: 'fallback', reason: terminal });
    client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
    await settle();
    assert.equal(validations, 0);
    assert.equal(bridge.status().spent, 1);
    assert.equal(client.attempts.length, 1);
    bridge.dispose();
  }
});

test('a response past the deadline cannot invoke Rust validation while its timer callback is still queued', async () => {
  let validations = 0;
  const { bridge, clock, client } = await ready(1, { ...wasm, llm_validate: input => {
    validations++;
    return wasm.llm_validate(input);
  } });
  const operation = bridge.decide(realPreviews()[0]!, new AbortController().signal);
  clock.milliseconds = 10000;
  client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
  assert.deepEqual(await operation, { kind: 'fallback', reason: 'timeout' });
  assert.equal(validations, 0);
  assert.equal(client.attempts[0]!.signal.aborted, true);
  assert.equal(bridge.status().spent, 1);
  bridge.dispose();
});

test('typed WASM failures fall back but thrown renderer or validator panics remain fatal to the owner', async () => {
  const preview = realPreviews()[0]!;
  for (const method of ['llm_render_system_one', 'llm_validate'] as const) {
    const { bridge, client } = await ready(1, { ...wasm, [method]: () => { throw new WebAssembly.RuntimeError('WASM panic'); } });
    const operation = bridge.decide(preview, new AbortController().signal);
    const rejected = assert.rejects(operation, /WASM panic/);
    if (client.attempts.length > 0) client.attempts[0]!.response.resolve(modelDecision(preview.option_ids[0]!));
    await rejected;
    assert.equal(client.attempts.length, method === 'llm_render_system_one' ? 0 : 1);
    bridge.dispose();
  }
});

test('production transport accepts 16384 bytes and rejects 16385 without AI, refund or retry for both Rust families', async () => {
  assert.equal(PROJECT_REQUEST_BYTE_CAP, 16_384);
  for (const preview of realPreviews()) for (const bytes of [PROJECT_REQUEST_BYTE_CAP, PROJECT_REQUEST_BYTE_CAP + 1]) {
    const selectedWasm = await transportPaddedWasm(preview, bytes);
    let validations = 0;
    const clock = new DecisionClock();
    const client = new HandlerDecisionClient(clock, preview.rules_default, {
      inferenceEnabled: true, requestByteCap: PROJECT_REQUEST_BYTE_CAP, sessionCap: 1,
    });
    const bridge = new DecisionBridge(client, { ...selectedWasm, llm_validate: input => {
      validations++; return wasm.llm_validate(input);
    } }, mapping, clock);
    try {
      await client.prefetched.promise; await settle();
      assert.equal(bridge.fallbackReason(), null);
      const pending = bridge.decide(preview, new AbortController().signal);
      assert.equal(bridge.status().spent, 1, 'the attempt is spent before the HTTP response settles');
      assert.equal(client.attempts.length, 1);
      const outcome = await pending;
      const exact = bytes === PROJECT_REQUEST_BYTE_CAP;
      assert.equal(client.posts.length, 1);
      const post = client.posts[0]!;
      assert.equal(new TextEncoder().encode(post.body).byteLength, bytes);
      assert.ok(new TextEncoder().encode(post.body).byteLength > post.body.length, 'multibyte bytes are not JS code units');
      assert.ok(post.body.includes('é🙂') && post.body.includes('\\"') && post.body.includes('\\\\') && post.body.includes('\\n'));
      assert.equal(post.headers.has('content-length'), false);
      assert.ok(isDecisionRequest(JSON.parse(post.body)), 'both boundary requests are otherwise valid');
      assert.equal(post.status, exact ? 200 : 413);
      assert.equal(client.aiCalls.length, exact ? 1 : 0);
      assert.equal(validations, exact ? 1 : 0, 'only accepted HTTP choices reach the actual Rust validator');
      if (exact) {
        assert.deepEqual(outcome, { kind: 'model', decision: {
          ...modelDecision(preview.rules_default, 1), usage: { input_tokens: 23, output_tokens: 2 },
        } });
        assert.equal(client.aiCalls[0]![0], modelDecision().model);
        assert.equal(client.aiCalls[0]![1].state, client.attempts[0]!.request.state);
        assert.deepEqual(client.aiCalls[0]![2], { returnRawResponse: true });
      } else {
        assert.ok(isDecisionError(post.result, 413));
        assert.deepEqual(outcome, { kind: 'fallback', reason: 'payload_too_large' });
      }
      assert.deepEqual(await bridge.decide(preview, new AbortController().signal), { kind: 'fallback', reason: 'session_cap' });
      clock.advance(10000); await settle();
      assert.equal(bridge.status().spent, 1); assert.equal(client.attempts.length, 1);
      assert.equal(client.configSignals.length, 1); assert.equal(client.posts.length, 1);
      assert.equal(client.aiCalls.length, exact ? 1 : 0); assert.equal(clock.timers.size, 0);
    } finally { bridge.dispose(); }
  }
});

test('production GET keeps explicit disablement or a missing byte cap ineligible even for an exact-cap transport fixture', async () => {
  for (const preview of realPreviews()) for (const mode of ['disabled', 'missing_cap'] as const) {
    const selectedWasm = await transportPaddedWasm(preview, PROJECT_REQUEST_BYTE_CAP);
    let renders = 0;
    const clock = new DecisionClock();
    const client = new HandlerDecisionClient(clock, preview.rules_default, {
      inferenceEnabled: mode !== 'disabled', requestByteCap: mode === 'missing_cap' ? undefined : PROJECT_REQUEST_BYTE_CAP, sessionCap: 1,
    });
    const bridge = new DecisionBridge(client, { ...selectedWasm, llm_render_system_one: input => {
      renders++; return selectedWasm.llm_render_system_one(input);
    } }, mapping, clock);
    try {
      assert.deepEqual(await client.prefetched.promise, config(1, false)); await settle();
      assert.deepEqual(await bridge.decide(preview, new AbortController().signal), { kind: 'fallback', reason: 'disabled' });
      assert.equal(renders, 0); assert.equal(client.attempts.length, 0); assert.equal(client.posts.length, 0);
      assert.equal(client.aiCalls.length, 0); assert.equal(bridge.status().spent, 0);
      assert.equal(client.configSignals.length, 1);
    } finally { bridge.dispose(); }
  }
});
