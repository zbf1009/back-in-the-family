import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock, createFakeEngine } from '../../src/adapters/fake.ts';
import type { Prompt, SamplingParams } from '../../src/adapters/interface.ts';

const prompt: Prompt = { system: 's', user: 'u' };
const sampling: SamplingParams = {
  temperature: 0,
  topP: null,
  maxOutputTokens: 10,
  seed: null,
  chatTemplateKwargs: null,
  constraint: { kind: 'none' },
};

test('fake clock fires timers in time order only when advanced', async () => {
  const clock = createFakeClock();
  const order: number[] = [];
  clock.setTimer(20, () => order.push(20));
  clock.setTimer(10, () => order.push(10));
  assert.deepEqual(order, []);
  await clock.advance(15);
  assert.deepEqual(order, [10]);
  assert.equal(clock.now(), 15);
  await clock.advance(5);
  assert.deepEqual(order, [10, 20]);
});

test('fake engine completes after tokens/second duration', async () => {
  const clock = createFakeClock();
  const engine = createFakeEngine(clock, { generate: { text: 'ok', outputTokens: 5, tokensPerSecond: 10 } });
  await engine.create();
  const p = engine.generate(prompt, sampling);
  assert.equal(engine.state(), 'generating');
  await clock.advance(499);
  assert.equal(engine.state(), 'generating');
  await clock.advance(1);
  const r = await p;
  assert.equal(r.text, 'ok');
  assert.equal(r.interrupted, false);
  assert.equal(engine.state(), 'idle');
});

test('fake engine honours or ignores interrupt', async () => {
  const clock = createFakeClock();
  const honour = createFakeEngine(clock, {
    generate: { text: 'abcd', outputTokens: 4, completionMs: 1000, interrupt: { kind: 'honour', idleDelayMs: 50 } },
  });
  await honour.create();
  const p = honour.generate(prompt, sampling);
  honour.interrupt();
  assert.equal(honour.state(), 'interrupting');
  await clock.advance(50);
  assert.equal((await p).interrupted, true);
  assert.equal(honour.state(), 'idle');

  const stuck = createFakeEngine(clock, {
    generate: { text: 'abcd', outputTokens: 4, completionMs: 1000, interrupt: { kind: 'ignore' } },
  });
  await stuck.create();
  void stuck.generate(prompt, sampling);
  stuck.interrupt();
  await clock.advance(10_000);
  assert.equal(stuck.state(), 'stuck');
});

test('fake engine create and warm-up failures', async () => {
  const clock = createFakeClock();
  const e1 = createFakeEngine(clock, { createFails: 'no gpu', generate: { text: '', outputTokens: 0 } });
  await assert.rejects(e1.create(), /no gpu/);
  const e2 = createFakeEngine(clock, { warmUpFails: 'warm', generate: { text: '', outputTokens: 0 } });
  await e2.create();
  await assert.rejects(e2.warmUp(), /warm/);
});
