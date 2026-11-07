// Adapter example tests (llm-probe task 12.6; requirements 8.6, 8.9, 9.12, 9.13).
// The chain cases (Timeout, error, Illegal text, a Runtime that cannot accept a request, a valid
// answer from each of the first two links, all links failing) are in chain.test.ts. This file
// adds the engine-lifecycle cases: warm-up order and no Results record for warm-up prompts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock, createFakeEngine } from '../../src/adapters/fake.ts';
import type { Prompt, SamplingParams } from '../../src/adapters/interface.ts';
import { createEngineWithWarmUp, rebuildEngineWithWarmUp } from '../../src/adapters/lifecycle.ts';

const sampling: SamplingParams = {
  temperature: 0,
  topP: null,
  maxOutputTokens: 8,
  seed: null,
  chatTemplateKwargs: null,
  constraint: { kind: 'none' },
};
const warmups = {
  decision: { system: 'warm', user: 'WARM-D' } satisfies Prompt,
  synthesis: { system: 'warm', user: 'WARM-S' } satisfies Prompt,
};
const cardPrompt: Prompt = { system: 'card', user: 'CARD-1' };

function setup() {
  const clock = createFakeClock();
  const engine = createFakeEngine(clock, { generate: { text: 'x', outputTokens: 1 } });
  const log: string[] = [];
  const wrapped = {
    async create() {
      log.push('create');
      await engine.create();
    },
    async generate(p: Prompt, s: SamplingParams) {
      log.push(p.user);
      const pending = engine.generate(p, s);
      await clock.advance(1); // fake time: the scripted 1-token generation finishes
      return pending;
    },
    dispose() {
      log.push('dispose');
      engine.dispose();
    },
  };
  const records: unknown[] = []; // spy Results writer: only the run flow's Card path appends
  return { wrapped, log, records };
}

async function runFirstCard(s: ReturnType<typeof setup>): Promise<void> {
  const out = await s.wrapped.generate(cardPrompt, sampling);
  s.records.push(out);
}

test('create sends the D then the S warm-up before the first Card prompt; no records for them', async () => {
  const s = setup();
  let ready = 0;
  await createEngineWithWarmUp({ engine: s.wrapped, warmups, sampling, onReady: () => ready++ });
  assert.deepEqual(s.log, ['create', 'WARM-D', 'WARM-S']);
  assert.equal(s.records.length, 0);
  assert.equal(ready, 1);
  await runFirstCard(s);
  assert.deepEqual(s.log, ['create', 'WARM-D', 'WARM-S', 'CARD-1']);
  assert.equal(s.records.length, 1);
});

test('rebuild repeats create and both warm-ups before the next Card prompt; no records for them', async () => {
  const s = setup();
  await createEngineWithWarmUp({ engine: s.wrapped, warmups, sampling });
  await runFirstCard(s);
  const before = s.records.length;
  await rebuildEngineWithWarmUp({ engine: s.wrapped, warmups, sampling });
  assert.deepEqual(s.log.slice(4), ['dispose', 'create', 'WARM-D', 'WARM-S']);
  assert.equal(s.records.length, before);
  await runFirstCard(s);
  assert.equal(s.log.at(-1), 'CARD-1');
});

test('a failed create rejects and sends no warm-up prompt', async () => {
  const clock = createFakeClock();
  const engine = createFakeEngine(clock, { createFails: 'no gpu', generate: { text: '', outputTokens: 0 } });
  await assert.rejects(createEngineWithWarmUp({ engine, warmups, sampling }), /no gpu/);
  assert.equal(engine.calls.length, 0);
});
