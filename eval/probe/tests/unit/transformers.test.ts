import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock, type FakeClock } from '../../src/adapters/fake.ts';
import type { Prompt, SamplingParams } from '../../src/adapters/interface.ts';
import {
  buildGenerateParams,
  createTransformersRuntime,
  partitionOptions,
  pinHubUrl,
  placementKeyHash,
  type ChatTemplateOptions,
  type InterruptableLike,
  type TransformersGenerateParams,
  type TransformersLoadConfig,
  type TransformersLoaded,
} from '../../src/adapters/transformers.ts';
import { DECISION_SCHEMA } from '../../src/run.ts';

const REV = 'd'.repeat(40);
const samplingD: SamplingParams = {
  temperature: 0,
  topP: null,
  maxOutputTokens: 64,
  seed: null,
  chatTemplateKwargs: { enable_thinking: false },
  constraint: { kind: 'none' },
};
const samplingS: SamplingParams = { ...samplingD, maxOutputTokens: 1024 };
const warmups = { decision: { system: 'wd-s', user: 'wd-u' }, synthesis: { system: 'ws-s', user: 'ws-u' } };
const card: Prompt = { system: 'card-s', user: 'card-u' };

interface Script {
  text?: string;
  outputTokens?: number;
  durationMs?: number;
  hangUntilInterrupt?: boolean;
}

const fakeFiles = { probe: ['config.json', 'onnx/model_q4.onnx'], measured: ['config.json', 'onnx/model_q4.onnx'] };

function makeFake(clock: FakeClock, script: () => Script = () => ({})) {
  const events: string[] = [];
  const loads: { modelId: string; config: TransformersLoadConfig }[] = [];
  const templateCalls: ChatTemplateOptions[] = [];
  const generateCalls: { text: string; params: TransformersGenerateParams }[] = [];
  let disposes = 0;
  let release: (() => void) | null = null;
  const loader = async (modelId: string, config: TransformersLoadConfig): Promise<TransformersLoaded> => {
    loads.push({ modelId, config });
    events.push('create');
    const stopping: InterruptableLike = {
      interrupt() {
        events.push('interrupt');
        release?.();
      },
      reset() {},
    };
    return {
      tokenizer: {
        apply_chat_template(messages, options) {
          templateCalls.push(options);
          return `T(${messages[0]?.content}|${messages[1]?.content})`;
        },
      },
      generate(text, params) {
        generateCalls.push({ text, params });
        events.push(`gen:${text}`);
        const s = script();
        const result = (text2: string) => ({ text: text2, inputTokens: 7, outputTokens: s.outputTokens ?? 3 });
        return new Promise((resolve) => {
          if (s.hangUntilInterrupt === true) {
            release = () => resolve(result('{"opt'));
            return;
          }
          const done = (): void => resolve(result(s.text ?? '{"option":"a"}'));
          clock.setTimer(s.durationMs ?? 0, done);
          if ((s.durationMs ?? 0) === 0) void clock.advance(0);
        });
      },
      stoppingCriteria: stopping,
      facts: { files: fakeFiles.measured },
      async dispose() {
        disposes++;
        events.push('dispose');
      },
    };
  };
  return { loader, events, loads, templateCalls, generateCalls, disposes: () => disposes };
}

function runtime(
  clock: FakeClock,
  fake: ReturnType<typeof makeFake>,
  over: { enableThinkingArg?: boolean; structured?: boolean; samplings?: { decision: SamplingParams; synthesis: SamplingParams } } = {},
) {
  return createTransformersRuntime({
    loader: fake.loader,
    model: { modelId: 'onnx-community/Qwen3.5-0.8B-ONNX', revision: REV, enableThinkingArg: over.enableThinkingArg ?? true, runtimeVersion: '4.3.2' },
    clock,
    warmups,
    samplings: over.samplings ?? { decision: samplingD, synthesis: samplingS },
    ...(over.structured === true
      ? { structuredOutput: { factory: (schema: unknown) => ({ processorFor: schema }), packageName: '@huggingface/transformers-structured-output', packageVersion: '4.3.2' } }
      : {}),
  });
}

test('from_pretrained config: revision, webgpu, q4, quiet measured session, verbose placement session', async () => {
  const clock = createFakeClock();
  const fake = makeFake(clock);
  await runtime(clock, fake).load();
  assert.equal(fake.loads[0]?.modelId, 'onnx-community/Qwen3.5-0.8B-ONNX');
  assert.deepEqual(fake.loads[0]?.config, {
    revision: REV,
    device: 'webgpu',
    dtype: 'q4',
    session_options: { executionProviders: ['webgpu'], logSeverityLevel: 2, logVerbosityLevel: 0 },
    placement_session_options: { executionProviders: ['webgpu'], logSeverityLevel: 0, logVerbosityLevel: 0 },
    onnxLogLevel: 'verbose',
  });
  assert.throws(
    () => createTransformersRuntime({ loader: fake.loader, model: { modelId: 'm', revision: 'main', enableThinkingArg: true, runtimeVersion: 'v' }, clock, warmups, samplings: { decision: samplingD, synthesis: samplingS } }),
    /40-hex/,
  );
});

test('chat template: enable_thinking false for Qwen3.5, absent for LFM2.5', async () => {
  const clock = createFakeClock();
  const qwen = makeFake(clock);
  const rtQ = runtime(clock, qwen);
  await rtQ.load();
  await rtQ.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal(qwen.templateCalls.length, 3);
  for (const o of qwen.templateCalls) assert.deepEqual(o, { add_generation_prompt: true, enable_thinking: false, tokenize: false });
  assert.deepEqual(rtQ.fingerprint()['chat_template_kwargs'], { enable_thinking: false, add_generation_prompt: true });

  const lfm = makeFake(clock);
  const rtL = runtime(clock, lfm, { enableThinkingArg: false });
  await rtL.load();
  for (const o of lfm.templateCalls) {
    assert.deepEqual(o, { add_generation_prompt: true, tokenize: false });
    assert.equal('enable_thinking' in o, false);
  }
  assert.deepEqual(rtL.fingerprint()['chat_template_kwargs'], { add_generation_prompt: true });
});

test('fingerprint: seed null, identity, no structured output by default', () => {
  const clock = createFakeClock();
  const rt = runtime(clock, makeFake(clock));
  const fp = rt.fingerprint();
  assert.equal(fp['seed'], null);
  assert.equal(fp['device'], 'webgpu');
  assert.equal(fp['dtype'], 'q4');
  assert.deepEqual(fp['constraint_used'], { decision: 'none', synthesis: 'none' });
  assert.equal(fp['structured_output_package'], null);
  assert.deepEqual(rt.adapter.identity(), {
    runtime: 'transformers.js',
    runtimeVersion: '4.3.2',
    modelId: 'onnx-community/Qwen3.5-0.8B-ONNX',
    modelRevision: REV,
    quantization: 'q4',
  });
});

test('no min_new_tokens on any normal request; only the preflight path sends it', async () => {
  const clock = createFakeClock();
  const fake = makeFake(clock);
  const rt = runtime(clock, fake);
  await rt.load();
  await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingS });
  for (const c of fake.generateCalls) {
    assert.equal('min_new_tokens' in c.params, false);
    assert.equal(c.params.do_sample, false);
  }
  assert.equal(fake.generateCalls.at(-1)?.params.max_new_tokens, 1024);
  // the builder takes it from the explicit option only
  const stop: InterruptableLike = { interrupt() {}, reset() {} };
  assert.equal('min_new_tokens' in buildGenerateParams(samplingD, stop), false);
  assert.equal(buildGenerateParams(samplingD, stop, { preflight: { minNewTokens: 50 } }).min_new_tokens, 50);

  const before = fake.generateCalls.length;
  const r = await rt.preflight.complete(card, { timeoutMs: 1000, sampling: samplingD }, 50);
  assert.equal(r.kind, 'text');
  assert.equal(fake.generateCalls[before]?.params.min_new_tokens, 50);
  await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal('min_new_tokens' in (fake.generateCalls.at(-1)?.params ?? {}), false);
});

test('warm-ups run D then S after create and after a rebuild, before the first Card prompt', async () => {
  const clock = createFakeClock();
  const fake = makeFake(clock);
  const rt = runtime(clock, fake);
  const records = await rt.load();
  assert.deepEqual(fake.events, ['create', 'gen:T(wd-s|wd-u)', 'gen:T(ws-s|ws-u)']);
  assert.deepEqual(records.map((r) => r.task), ['decision', 'synthesis']);
  assert.equal(fake.generateCalls[0]?.params.max_new_tokens, 64);
  assert.equal(fake.generateCalls[1]?.params.max_new_tokens, 1024);
  fake.events.length = 0;
  await rt.rebuild();
  assert.deepEqual(fake.events, ['dispose', 'create', 'gen:T(wd-s|wd-u)', 'gen:T(ws-s|ws-u)']);
  assert.equal(fake.disposes(), 1);
  await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal(fake.events.at(-1), 'gen:T(card-s|card-u)');
});

test('text result maps usage; max_new_tokens reached → truncated; empty → empty_content; before load → runtime_error', async () => {
  const clock = createFakeClock();
  let next: Script = {};
  const fake = makeFake(clock, () => next);
  const rt = runtime(clock, fake);
  const early = await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal(early.kind === 'error' && early.code, 'runtime_error');
  assert.equal(fake.generateCalls.length, 0);
  await rt.load();
  const ok = await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.deepEqual(ok, { kind: 'text', text: '{"option":"a"}', latencyMs: 0, usage: { inputTokens: 7, outputTokens: 3, reasoningTokens: null } });
  next = { outputTokens: 64, text: '{"option":' };
  const cut = await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal(cut.kind === 'error' && cut.code, 'truncated');
  next = { text: '' };
  const empty = await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal(empty.kind === 'error' && empty.code, 'empty_content');
});

test('interrupt via the stopping criterion at the Generation_Cap → none(generation_cap)', async () => {
  const clock = createFakeClock();
  let hang = false;
  const fake = makeFake(clock, () => (hang ? { hangUntilInterrupt: true } : {}));
  const rt = runtime(clock, fake);
  await rt.load();
  hang = true;
  const p = rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  await clock.advance(0);
  await clock.advance(1000);
  const r = await p;
  assert.equal(r.kind, 'timeout');
  assert.equal(fake.events.includes('interrupt'), false);
  await clock.advance(60_000);
  assert.equal(fake.events.at(-1), 'interrupt');
  assert.deepEqual(await (r.kind === 'timeout' ? r.late : Promise.reject(new Error('no late'))), { kind: 'none', reason: 'generation_cap' });
  assert.equal(rt.adapter.state(), 'idle');
});

test('structured output is opt-in: used only for json_schema requests, pattern stripped, recorded', async () => {
  const clock = createFakeClock();
  const schema = { type: 'object', properties: { id: { type: 'string', pattern: '^e[0-9]+$' } } };
  const samplings = {
    decision: { ...samplingD, constraint: { kind: 'json_schema' as const, schema: DECISION_SCHEMA } },
    synthesis: { ...samplingS, constraint: { kind: 'json_schema' as const, schema } },
  };
  // factory absent: json_schema requests run unconstrained and the fingerprint says so
  const plain = makeFake(clock);
  const rtPlain = runtime(clock, plain, { samplings });
  await rtPlain.load();
  assert.equal(plain.generateCalls.some((c) => 'logits_processor' in c.params), false);
  assert.deepEqual(rtPlain.fingerprint()['constraint_used'], { decision: 'none', synthesis: 'none' });

  const fake = makeFake(clock);
  const rt = runtime(clock, fake, { samplings, structured: true });
  await rt.load();
  assert.deepEqual(fake.generateCalls[0]?.params.logits_processor, { processorFor: DECISION_SCHEMA });
  assert.equal(JSON.stringify(fake.generateCalls[1]?.params.logits_processor).includes('pattern'), false);
  assert.deepEqual(rt.fingerprint()['constraint_used'], { decision: 'json_schema', synthesis: 'json_schema' });
  assert.equal(rt.fingerprint()['structured_output_package'], '@huggingface/transformers-structured-output@4.3.2');
  // a none request with the factory present stays unconstrained
  await rt.adapter.complete(card, { timeoutMs: 1000, sampling: samplingD });
  assert.equal('logits_processor' in (fake.generateCalls.at(-1)?.params ?? {}), false);
});

test('pinHubUrl rewrites only this repo\'s /resolve/main/ URLs to the pinned revision', () => {
  const m = 'onnx-community/X-ONNX';
  assert.equal(pinHubUrl(`https://huggingface.co/${m}/resolve/main/tokenizer_config.json`, m, REV), `https://huggingface.co/${m}/resolve/${REV}/tokenizer_config.json`);
  for (const u of [`https://huggingface.co/${m}/resolve/${REV}/onnx/a.onnx`, 'https://huggingface.co/other/repo/resolve/main/x.json', 'http://localhost:1/x']) {
    assert.equal(pinHubUrl(u, m, REV), u);
  }
});

test('two-session placement: probe first, same key hash passes and is fingerprinted; different files fail', async () => {
  const clock = createFakeClock();
  const fake = makeFake(clock);
  const probeCalls: TransformersLoadConfig[] = [];
  const make = () =>
    createTransformersRuntime({
      loader: fake.loader,
      placementProbe: async (_m, config) => (probeCalls.push(config), { files: [...fakeFiles.probe] }),
      model: { modelId: 'onnx-community/Qwen3.5-0.8B-ONNX', revision: REV, enableThinkingArg: true, runtimeVersion: '4.3.2' },
      clock,
      warmups,
      samplings: { decision: samplingD, synthesis: samplingS },
    });
  const rt = make();
  await rt.probePlacement();
  assert.equal(probeCalls[0]?.placement_session_options.logSeverityLevel, 0);
  await rt.load();
  const pc = rt.fingerprint()['placement_check'] as Record<string, unknown>;
  assert.match(String(pc['probe_sha256']), /^[0-9a-f]{64}$/);
  assert.equal(pc['probe_sha256'], pc['measured_sha256']);
  // the two option sets differ only in the log fields
  const c = rt.loadConfig();
  assert.deepEqual(partitionOptions(c.session_options), partitionOptions(c.placement_session_options));
  assert.notDeepEqual(c.session_options, c.placement_session_options);

  fakeFiles.measured = ['config.json', 'onnx/model_fp16.onnx'];
  try {
    const bad = make();
    await bad.probePlacement();
    await assert.rejects(bad.load(), /placement_session_mismatch/);
  } finally {
    fakeFiles.measured = [...fakeFiles.probe];
  }
});

test('the placement key hash ignores the log fields and file order, and sees every other option', async () => {
  const base = { modelId: 'm', revision: REV, device: 'webgpu', dtype: 'q4', files: ['b', 'a'] };
  const quiet = await placementKeyHash({ ...base, options: { executionProviders: ['webgpu'], logSeverityLevel: 2, logVerbosityLevel: 0 } });
  const loud = await placementKeyHash({ ...base, files: ['a', 'b'], options: { executionProviders: ['webgpu'], logSeverityLevel: 0, logVerbosityLevel: 0 } });
  assert.equal(quiet, loud);
  const other = await placementKeyHash({ ...base, options: { executionProviders: ['webgpu', 'wasm'], logSeverityLevel: 2, logVerbosityLevel: 0 } });
  assert.notEqual(quiet, other);
  assert.notEqual(quiet, await placementKeyHash({ ...base, revision: 'e'.repeat(40), options: { executionProviders: ['webgpu'], logSeverityLevel: 2, logVerbosityLevel: 0 } }));
});
