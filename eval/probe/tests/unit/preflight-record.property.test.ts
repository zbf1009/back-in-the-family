// Property 41 (llm-probe task 19.3, Author 2026-11-07): every VRAM_Preflight attempt yields a record.
// **Validates: Requirements 9.9, 9.10, 9.17.**
// judgePreflight over arbitrary attempts (any load failure code, session failures, any memory reading, any run
// outcome and error text) always returns a parseable record with a verdict, and an exclusion exactly when the
// verdict is `excluded`. A fault injection then checks the command: a session that throws a non-load error and a
// session that cannot start both leave a line in preflight/attempts.jsonl.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import type { LoadFailureCode, PreflightMeasurement } from '../../src/browser/driver.ts';
import type { Combination } from '../../src/phase.ts';
import { attemptsPath, judgePreflight, preflightRun, type PreflightAttempt, type PreflightPrompt, type PreflightSession } from '../../src/preflight.ts';
import { parsePreflightRecord, readPreflightAttempts } from '../../src/results.ts';
import { VRAM_LIMIT_MIB } from '../../src/screen.ts';
import { capture, FAKE_COMBO, makeCardSet, makeEnv, REVISION } from './run.helpers.ts';

const TF: Combination = {
  ...FAKE_COMBO,
  id: 'transformers.js/test-model-q4/nvidia',
  runtime: 'transformers.js',
  model_id: 'org/Test-Model-ONNX',
  quantization: 'q4',
  revision: REVISION,
};
const PROMPT: PreflightPrompt = { prompt: { system: 's', user: 'u' }, bytes: 9000, targetBytes: 9000, longestDevPromptBytes: 100, eventCount: 8, personCount: 6, sha256: '0'.repeat(64) };
const ADAPTER = { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', is_fallback_adapter: false };
const CODES: LoadFailureCode[] = ['model_load_failed', 'out_of_memory', 'gpu_unavailable', 'software_adapter', 'backend_not_webgpu', 'placement_not_logged'];

const errorText = fc.oneof(fc.string({ maxLength: 40 }), fc.constantFrom('out of memory', 'Invalid Buffer (unlabeled) is invalid due to a previous error', 'console: VK_ERROR_OUT_OF_DEVICE_MEMORY', 'device lost'));
const measurementArb: fc.Arbitrary<PreflightMeasurement> = fc.record({
  peak: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
  gpu: fc.constantFrom('nvidia' as const, 'intel' as const, null),
  run: fc.oneof(
    fc.record({ ok: fc.constant(true as const), view: fc.record({ outcome: fc.constant({ kind: 'error', code: 'truncated', detail: 'max' } as const), latency_ms: fc.nat(), reached_limit: fc.boolean() }) }),
    fc.record({ ok: fc.constant(false as const), error: errorText }),
  ),
}).map(({ peak, gpu, run }) => ({
  adapter: ADAPTER,
  placement: { method: 'onnxruntime_node_placements', cpu_nodes: [] },
  memory: { gpu, quantity: 'q', peak_mib: peak, reason: peak === null ? 'no reading' : null },
  run: run as PreflightMeasurement['run'],
}));
const attemptArb: fc.Arbitrary<PreflightAttempt> = fc.oneof(
  fc.record({ kind: fc.constant('load_failed' as const), code: fc.constantFrom(...CODES), message: fc.string({ maxLength: 20 }) }),
  fc.record({ kind: fc.constant('session_failed' as const), message: fc.string({ maxLength: 20 }) }),
  measurementArb.map((measurement) => ({ kind: 'measured' as const, measurement })),
);

test('Property 41: every preflight attempt yields a parseable record; an exclusion exactly when excluded', () => {
  fc.assert(
    fc.property(attemptArb, (attempt) => {
      const v = judgePreflight({ combo: TF, at: '2026-11-07T00:00:00.000Z', prompt: PROMPT, attempt, versions: {}, browser: {}, adapterFacts: {}, adapter: null });
      assert.equal(v.kind, 'record');
      const r = parsePreflightRecord(JSON.parse(JSON.stringify(v.record)));
      assert.equal(r['verdict'], v.verdict);
      assert.equal(v.exclusion !== null, v.verdict === 'excluded');
      if (v.verdict === 'pass') assert.ok((r['peak_vram_mib'] as number) <= VRAM_LIMIT_MIB);
      if (v.verdict === 'no_verdict') assert.notEqual(r['error'], null);
    }),
    { numRuns: 300 },
  );
});

test('fault injection: a throwing session and a session that cannot start still leave an attempt record', async () => {
  const cardSet = makeCardSet();
  const sessions: PreflightSession[] = [
    {
      prepare: async () => ({ ok: true, adapter: ADAPTER, quotaBytes: 1e12, expectedDownloadBytes: 1 }),
      preflight: async () => {
        throw new Error('injected: Invalid Buffer (unlabeled)');
      },
      close: async () => undefined,
      adapterInfo: ADAPTER,
      userAgentString: 'Chrome/155.0.0.0',
      fingerprintExtras: {},
    },
    {
      prepare: async () => ({ ok: false, failure: { reason: 'gpu_unavailable', detail: 'injected' } }) as never,
      preflight: async () => {
        throw new Error('not reached');
      },
      close: async () => undefined,
      adapterInfo: null,
      userAgentString: '',
      fingerprintExtras: null,
    },
  ];
  for (const [n, s] of sessions.entries()) {
    const env = makeEnv(cardSet);
    const deps = { ...env.deps({} as never), combinations: [TF], engineVersions: { transformers: '4.3.2' }, openSession: async () => s };
    assert.equal((await capture(() => preflightRun(deps, { combo: TF.id }))).value, 1);
    const lines = readPreflightAttempts(attemptsPath(deps.paths.resultsDir));
    assert.equal(lines.length, 1, `session ${n}`);
    assert.equal(lines[0]?.['verdict'], 'no_verdict');
    assert.match(String(lines[0]?.['error']), /injected/);
  }
});
