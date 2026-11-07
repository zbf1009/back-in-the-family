import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock, type FakeClock } from '../../src/adapters/fake.ts';
import type { Prompt, SamplingParams } from '../../src/adapters/interface.ts';
import {
  QWEN35_OVERRIDES,
  buildChatRequest,
  createWebLlmRuntime,
  stripPattern,
  type WebLlmChatRequest,
  type WebLlmChatResponse,
  type WebLlmEngineConfig,
  type WebLlmEngineLike,
} from '../../src/adapters/webllm.ts';
import { DECISION_SCHEMA } from '../../src/run.ts';

const REV = 'b'.repeat(40);
const LIB = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${'c'.repeat(40)}/web-llm-models/v0_2_87/Qwen3.5-0.8B-q4f32_1-ctx4k_cs1k-webgpu.wasm`;
const kwargs = { enable_thinking: false, add_generation_prompt: true };

const S_SCHEMA = {
  type: 'object',
  properties: { evidence: { type: 'array', items: { type: 'string', pattern: '^e[0-9]{1,4}$' } }, reason: { type: 'string' } },
  required: ['evidence'],
};
const samplingD: SamplingParams = {
  temperature: 0,
  topP: null,
  maxOutputTokens: 64,
  seed: 20261104,
  chatTemplateKwargs: { enable_thinking: false },
  constraint: { kind: 'json_schema', schema: DECISION_SCHEMA },
};
const samplingS: SamplingParams = { ...samplingD, maxOutputTokens: 1024, constraint: { kind: 'json_schema', schema: S_SCHEMA } };
const warmups = { decision: { system: 'wd-s', user: 'wd-u' }, synthesis: { system: 'ws-s', user: 'ws-u' } };
const card: Prompt = { system: 'card-s', user: 'card-u' };

interface Script {
  /** per create call: content, finish_reason, duration (fake ms) */
  content?: string | null;
  finish?: string | null;
  durationMs?: number;
  hangUntilInterrupt?: boolean;
}

function makeFake(clock: FakeClock, script: () => Script = () => ({})) {
  const requests: WebLlmChatRequest[] = [];
  const events: string[] = [];
  const configs: { modelId: string; config: WebLlmEngineConfig }[] = [];
  let unloads = 0;
  let abort: (() => void) | null = null;
  const factory = async (modelId: string, config: WebLlmEngineConfig): Promise<WebLlmEngineLike> => {
    configs.push({ modelId, config });
    events.push('create');
    return {
      chat: {
        completions: {
          create(req: WebLlmChatRequest): Promise<WebLlmChatResponse> {
            requests.push(req);
            events.push(`req:${req.messages[0]?.content}`);
            const s = script();
            const respond = (finish: string | null, content: string | null): WebLlmChatResponse => ({
              choices: [{ message: { content }, finish_reason: finish }],
              usage: { prompt_tokens: 7, completion_tokens: 3 },
            });
            return new Promise((resolve) => {
              const done = (): void => resolve(respond(s.finish === undefined ? 'stop' : s.finish, s.content === undefined ? '{"option":"a"}' : s.content));
              if (s.hangUntilInterrupt === true) {
                abort = () => resolve(respond('abort', '{"opt'));
                return;
              }
              clock.setTimer(s.durationMs ?? 0, done);
              if ((s.durationMs ?? 0) === 0) void clock.advance(0);
            });
          },
        },
      },
      interruptGenerate() {
        events.push('interrupt');
        abort?.();
      },
      async unload() {
        unloads++;
        events.push('unload');
      },
    };
  };
  return { factory, requests, events, configs, unloads: () => unloads };
}

function runtime(clock: FakeClock, fake: ReturnType<typeof makeFake>) {
  return createWebLlmRuntime({
    factory: fake.factory,
    model: {
      modelId: 'Qwen3.5-0.8B-q4f32_1-MLC',
      revision: REV,
      modelLibUrl: LIB,
      vramRequiredMB: 1894.19,
      quantization: 'q4f32_1',
      runtimeVersion: '0.2.87',
    },
    clock,
    warmups,
    samplings: { decision: samplingD, synthesis: samplingS },
  });
}

test('request body: temperature 0, seed, enable_thinking false, schema as a JSON string', () => {
  const d = buildChatRequest(card, samplingD);
  assert.equal(d.temperature, 0);
  assert.equal(d.max_tokens, 64);
  assert.equal(d.seed, 20261104);
  assert.deepEqual(d.extra_body, { enable_thinking: false });
  assert.deepEqual(d.messages, [
    { role: 'system', content: 'card-s' },
    { role: 'user', content: 'card-u' },
  ]);
  assert.equal(d.response_format?.type, 'json_object');
  assert.equal(typeof d.response_format?.schema, 'string');
  assert.equal(
    d.response_format?.schema,
    '{"type":"object","properties":{"option":{"type":"string"}},"required":["option"],"additionalProperties":false}',
  );
  const s = buildChatRequest(card, samplingS);
  assert.equal(typeof s.response_format?.schema, 'string');
  const parsed = JSON.parse(s.response_format?.schema ?? '') as typeof S_SCHEMA;
  assert.equal('pattern' in parsed.properties.evidence.items, false);
  assert.equal(parsed.properties.evidence.items.type, 'string');
  const none = buildChatRequest(card, { ...samplingD, seed: null, constraint: { kind: 'none' } });
  assert.equal('response_format' in none, false);
  assert.equal('seed' in none, false);
});

test('stripPattern removes pattern at any depth and leaves the input untouched', () => {
  assert.equal(JSON.stringify(S_SCHEMA).includes('pattern'), true);
  assert.equal(JSON.stringify(stripPattern(S_SCHEMA)).includes('pattern'), false);
  assert.equal(S_SCHEMA.properties.evidence.items.pattern, '^e[0-9]{1,4}$');
  // a property NAMED "pattern" is not a keyword and stays
  assert.deepEqual(stripPattern({ properties: { pattern: { type: 'string' } } }), { properties: { pattern: { type: 'string' } } });
});

test('custom model_list entry: pinned resolve URL, model_lib_url, vram, overrides', async () => {
  const clock = createFakeClock();
  const fake = makeFake(clock);
  const rt = runtime(clock, fake);
  await rt.load();
  const cfg = fake.configs[0]!;
  assert.equal(cfg.modelId, 'Qwen3.5-0.8B-q4f32_1-MLC');
  assert.deepEqual(cfg.config.appConfig.model_list, [
    {
      model: `https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f32_1-MLC/resolve/${REV}/`,
      model_id: 'Qwen3.5-0.8B-q4f32_1-MLC',
      model_lib: LIB,
      vram_required_MB: 1894.19,
      overrides: { context_window_size: 4096, max_history_size: 1, conv_config: { stop_token_ids: [248046, 248044] } },
    },
  ]);
  assert.deepEqual(QWEN35_OVERRIDES.conv_config.stop_token_ids, [248046, 248044]);
  assert.throws(
    () => createWebLlmRuntime({ ...{ factory: fake.factory, clock, warmups, samplings: { decision: samplingD, synthesis: samplingS } }, model: { modelId: 'm', revision: 'main', modelLibUrl: LIB, vramRequiredMB: 1, quantization: 'q', runtimeVersion: 'v' } }),
    /40-hex/,
  );
});

test('fingerprint records chat_template_kwargs, seed and the pinned URLs', async () => {
  const clock = createFakeClock();
  const rt = runtime(clock, makeFake(clock));
  const fp = rt.fingerprint();
  assert.deepEqual(fp['chat_template_kwargs'], kwargs);
  assert.equal(fp['seed'], 20261104);
  assert.equal(fp['model_lib_url'], LIB);
  assert.equal(fp['model_url'], `https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f32_1-MLC/resolve/${REV}/`);
  assert.deepEqual(rt.adapter.identity(), {
    runtime: 'webllm',
    runtimeVersion: '0.2.87',
    modelId: 'Qwen3.5-0.8B-q4f32_1-MLC',
    modelRevision: REV,
    quantization: 'q4f32_1',
  });
});

test('warm-ups run D then S after create and after a rebuild, before the first Card prompt', async () => {
  const clock = createFakeClock();
  const fake = makeFake(clock);
  const rt = runtime(clock, fake);
  const records = await rt.load();
  assert.deepEqual(fake.events, ['create', 'req:wd-s', 'req:ws-s']);
  assert.deepEqual(records.map((r) => r.task), ['decision', 'synthesis']);
  // D warm-up carries the one-schema, S warm-up the family schema
  assert.equal(fake.requests[0]?.response_format?.schema, JSON.stringify(DECISION_SCHEMA));
  assert.equal(fake.requests[1]?.response_format?.schema.includes('pattern'), false);
  assert.equal(fake.requests[1]?.max_tokens, 1024);
  for (const r of fake.requests) {
    assert.deepEqual(r.extra_body, { enable_thinking: false });
    assert.equal(r.seed, 20261104);
    assert.equal(r.temperature, 0);
  }

  const r1 = await rt.adapter.complete(card, { timeoutMs: 10_000, sampling: samplingD });
  assert.equal(r1.kind, 'text');
  fake.events.length = 0;
  await rt.rebuild();
  assert.deepEqual(fake.events, ['unload', 'create', 'req:wd-s', 'req:ws-s']);
  assert.equal(fake.unloads(), 1);
  await rt.adapter.complete(card, { timeoutMs: 10_000, sampling: samplingS });
  assert.equal(fake.events.at(-1), 'req:card-s');
});

test('text result maps usage; length → truncated; empty → empty_content', async () => {
  const clock = createFakeClock();
  let next: Script = {};
  const fake = makeFake(clock, () => next);
  const rt = runtime(clock, fake);
  await rt.load();
  const ok = await rt.adapter.complete(card, { timeoutMs: 10_000, sampling: samplingD });
  assert.deepEqual(ok, { kind: 'text', text: '{"option":"a"}', latencyMs: 0, usage: { inputTokens: 7, outputTokens: 3, reasoningTokens: null } });
  next = { finish: 'length', content: '{"option":' };
  const cut = await rt.adapter.complete(card, { timeoutMs: 10_000, sampling: samplingD });
  assert.equal(cut.kind === 'error' && cut.code, 'truncated');
  next = { content: '' };
  const empty = await rt.adapter.complete(card, { timeoutMs: 10_000, sampling: samplingD });
  assert.equal(empty.kind === 'error' && empty.code, 'empty_content');
  next = { content: null };
  const nul = await rt.adapter.complete(card, { timeoutMs: 10_000, sampling: samplingD });
  assert.equal(nul.kind === 'error' && nul.code, 'empty_content');
});

test('complete before load is a runtime_error and sends nothing', async () => {
  const clock = createFakeClock();
  const fake = makeFake(clock);
  const r = await runtime(clock, fake).adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal(r.kind === 'error' && r.code, 'runtime_error');
  assert.equal(fake.requests.length, 0);
});

test('interrupt at the Generation_Cap ends a late generation as none(generation_cap)', async () => {
  const clock = createFakeClock();
  let hang = false;
  const fake = makeFake(clock, () => (hang ? { hangUntilInterrupt: true } : {}));
  const rt = runtime(clock, fake);
  await rt.load();
  hang = true;
  const p = rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  await clock.advance(0); // let the request reach the engine and arm its timers
  await clock.advance(1000);
  const r = await p;
  assert.equal(r.kind, 'timeout');
  assert.equal(fake.events.includes('interrupt'), false);
  await clock.advance(60_000); // Generation_Cap = Timeout + 60 s
  assert.equal(fake.events.at(-1), 'interrupt');
  assert.deepEqual(await (r.kind === 'timeout' ? r.late : Promise.reject(new Error('no late'))), { kind: 'none', reason: 'generation_cap' });
  assert.equal(rt.adapter.state(), 'idle');
});
