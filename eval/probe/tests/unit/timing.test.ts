import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock, createFakeEngine, type GenerationScript } from '../../src/adapters/fake.ts';
import type { AdapterResult, Prompt, RequestOptions } from '../../src/adapters/interface.ts';
import { createTimedRunner } from '../../src/adapters/timing.ts';

const prompt: Prompt = { system: 's', user: 'u' };
const T = 10_000;
const options: RequestOptions = {
  timeoutMs: T,
  sampling: { temperature: 0, topP: null, maxOutputTokens: 100, seed: null, chatTemplateKwargs: null, constraint: { kind: 'none' } },
};

async function setup(script: GenerationScript) {
  const clock = createFakeClock();
  const engine = createFakeEngine(clock, { generate: script });
  await engine.create();
  const runner = createTimedRunner(engine, clock);
  let result: AdapterResult | null = null;
  const p = runner.complete(prompt, options).then((r) => {
    result = r;
  });
  return { clock, engine, runner, p, get result() { return result; } };
}

test('completes before T: text with ceil latency', async () => {
  const s = await setup({ completionMs: 1234, text: 'ok', outputTokens: 2 });
  await s.clock.advance(1233);
  assert.equal(s.result, null);
  await s.clock.advance(1);
  await s.p;
  assert.deepEqual(s.result, { kind: 'text', text: 'ok', latencyMs: 1234, usage: { inputTokens: 0, outputTokens: 2, reasoningTokens: null } });
  assert.equal(s.runner.state(), 'idle');
});

test('latency is the ceiling of fractional clock differences', async () => {
  const s = await setup({ completionMs: 1.5, text: 'ok', outputTokens: 1 });
  await s.clock.advance(1.5);
  await s.p;
  const r = s.result as AdapterResult | null;
  assert.equal(r?.kind, 'text');
  if (r?.kind === 'text') assert.equal(r.latencyMs, 2);
});

test('completes exactly at T: text, not timeout', async () => {
  const s = await setup({ completionMs: T, text: 'edge', outputTokens: 1 });
  await s.clock.advance(T);
  await s.p;
  const r = s.result as AdapterResult | null;
  assert.equal(r?.kind, 'text');
  if (r?.kind === 'text') assert.equal(r.latencyMs, T);
});

test('timeout at T, then a late answer by T+60 s', async () => {
  const s = await setup({ completionMs: T + 5_000, text: 'slow', outputTokens: 4 });
  await s.clock.advance(T);
  await s.p;
  const r = s.result as AdapterResult | null;
  assert.equal(r?.kind, 'timeout');
  if (r?.kind !== 'timeout') return;
  assert.equal(r.elapsedMs, T);
  assert.equal(s.runner.state(), 'busy');
  await s.clock.advance(5_000);
  assert.deepEqual(await r.late, {
    kind: 'late',
    text: 'slow',
    latencyMs: T + 5_000,
    usage: { inputTokens: 0, outputTokens: 4, reasoningTokens: null },
  });
  assert.equal(s.runner.state(), 'idle');
});

test('generation cap interrupts at T+60 s: late none generation_cap', async () => {
  const s = await setup({ completionMs: 500_000, text: 'never', outputTokens: 40, interrupt: { kind: 'honour', idleDelayMs: 1_000 } });
  await s.clock.advance(T);
  await s.p;
  const r = s.result as AdapterResult | null;
  assert.equal(r?.kind, 'timeout');
  if (r?.kind !== 'timeout') return;
  await s.clock.advance(60_000);
  assert.equal(s.engine.state(), 'interrupting');
  await s.clock.advance(1_000);
  assert.deepEqual(await r.late, { kind: 'none', reason: 'generation_cap' });
  assert.equal(s.runner.state(), 'idle');
});

test('idle cap: stuck at T+90 s, later calls refused runtime_stuck without sending, reset recovers', async () => {
  const s = await setup({ completionMs: 500_000, text: 'never', outputTokens: 40, interrupt: { kind: 'ignore' } });
  await s.clock.advance(T);
  await s.p;
  const r = s.result as AdapterResult | null;
  assert.equal(r?.kind, 'timeout');
  if (r?.kind !== 'timeout') return;
  await s.clock.advance(89_999);
  assert.notEqual(s.runner.state(), 'stuck');
  await s.clock.advance(1);
  assert.deepEqual(await r.late, { kind: 'none', reason: 'idle_cap' });
  assert.equal(s.runner.state(), 'stuck');
  const refused = await s.runner.complete(prompt, options);
  assert.equal(refused.kind, 'error');
  if (refused.kind === 'error') assert.equal(refused.code, 'runtime_stuck');
  assert.equal(s.engine.calls.length, 1);
  s.runner.reset();
  assert.equal(s.runner.state(), 'idle');
});

test('next request waits until the engine is idle, and its latency starts at its own t0', async () => {
  const s = await setup({ completionMs: T + 5_000, text: 'a', outputTokens: 1 });
  await s.clock.advance(T);
  await s.p;
  let second: AdapterResult | null = null;
  const p2 = s.runner.complete(prompt, options).then((r) => {
    second = r;
  });
  await s.clock.advance(1);
  assert.equal(s.engine.calls.length, 1);
  await s.clock.advance(4_999);
  assert.equal(s.engine.calls.length, 2);
  const startedAt = s.engine.calls[1]!.startedAtMs;
  assert.equal(startedAt, T + 5_000);
  await s.clock.advance(T + 5_000);
  await p2;
  assert.equal((second as AdapterResult | null)?.kind, 'timeout');
});
