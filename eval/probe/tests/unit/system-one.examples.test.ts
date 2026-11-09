// Example tests for the System_One adapter and the Decision_Model records (llm-probe task 29; R19.18, R19.19).
// A fake `fetch`, no network, no `env` read, no locked.jsonl.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { createFakeClock } from '../../src/adapters/fake.ts';
import type { AdapterResult, DecisionRequest } from '../../src/adapters/interface.ts';
import {
  buildSystemOneBody,
  bodyBytesOf,
  inputTokenLowerBound,
  isOverContext,
  overContextCardIds,
  postCheckTruncation,
  systemOneBudgetInputs,
  systemOneFingerprint,
} from '../../src/adapters/system-one.ts';
import { BudgetSession, estimateSystemOneNeurons, isRefusal, systemOneUsageNeurons } from '../../src/budget.ts';
import type { WorkersAiEnv } from '../../src/env.ts';
import { isSystemOne, parseCombinations, type Combination, type SystemOneCombination } from '../../src/phase.ts';
import { Secret } from '../../src/redact.ts';
import { fingerprintId, readSmoke, ResultsWriter, SCHEMA, type ResultRecord } from '../../src/results.ts';
import { gateRun } from '../../src/run.ts';
import { clearSecrets } from '../../src/sink.ts';
import { llmValidate } from '../../src/simwasm.ts';
import { checkSystemOneShape, bytesPerTokenOf, smokeCommand, smokeFileOf, type SmokeDeps } from '../../src/smoke.ts';
import { capture, makeEnv } from './run.helpers.ts';
import { baseState, dm, smokeRec } from './decision-gate.helpers.ts';
import { ACCOUNT, adapterFor, answerBody, comboWith, devDecisionRequests, fakeFetch, MAPPING, realCombo, TOKEN } from './system-one.helpers.ts';

afterEach(() => clearSecrets());

const REQUESTS = devDecisionRequests(true);
const FIRST = REQUESTS[0]!;
const COMBO = comboWith({ window: 1_000_000, k: 1_000_000 }); // no truncation condition fires unless a test asks for it
const OPTS = { timeoutMs: 5000 };

const send = (combo: SystemOneCombination, status: number, body: string, request: DecisionRequest = FIRST.request) => {
  const f = fakeFetch(status, body);
  return adapterFor(combo, f.fetch).complete(request, OPTS).then((r) => ({ r, calls: f.calls }));
};
const verdictOf = (text: string): { kind: string; reason?: string } =>
  (JSON.parse(llmValidate(JSON.stringify({ frozen_context: FIRST.frozenContext, raw: text }), 'raw_choice', FIRST.cardId)) as { verdict: { kind: string; reason?: string } }).verdict;
const errorOf = (r: AdapterResult): Extract<AdapterResult, { kind: 'error' }> => {
  assert.equal(r.kind, 'error');
  return r as Extract<AdapterResult, { kind: 'error' }>;
};

// ---------------------------------------------------------------- 29.1 records

describe('29.1 Decision_Model Combination records', () => {
  const flash = realCombo('workers-ai/clef-flash');
  const clef = realCombo('workers-ai/clef');

  test('the two committed records carry the verified Clef facts', () => {
    assert.equal(flash.model_id, '@cf/cloudflare/clef-flash');
    assert.equal(flash.context_window_tokens, 24576);
    assert.equal(flash.prices.input, 3455);
    assert.equal(clef.model_id, '@cf/cloudflare/clef');
    assert.equal(clef.context_window_tokens, 65536);
    assert.equal(clef.prices.input, 21818);
    for (const c of [flash, clef]) {
      assert.equal(c.response_shape, 'system_one');
      assert.equal(c.validator_mode, 'raw_choice');
      assert.equal(c.max_bytes_per_token, 8);
      assert.equal(c.phase1_locked, false);
      assert.equal(c['task_subset_allowed'], 'D');
      assert.equal(c.prices.output, 0);
      assert.ok(isSystemOne(c));
    }
  });

  test('parseCombinations refuses a system_one record without validator_mode, and bad numbers', () => {
    const rec = JSON.parse(JSON.stringify(flash)) as Record<string, unknown>;
    const parse = (o: Record<string, unknown>): Combination[] => parseCombinations(JSON.stringify([o]));
    assert.doesNotThrow(() => parse(rec));
    assert.throws(() => parse({ ...rec, validator_mode: undefined }), /validator_mode/);
    assert.throws(() => parse({ ...rec, validator_mode: 'json' }), /validator_mode/);
    assert.throws(() => parse({ ...rec, context_window_tokens: 0 }), /context_window_tokens/);
    assert.throws(() => parse({ ...rec, max_bytes_per_token: 1.5 }), /max_bytes_per_token/);
    assert.throws(() => parse({ ...rec, task_subset_allowed: 'DS' }), /task_subset_allowed/);
    assert.throws(() => parse({ ...rec, response_shape: 'other' }), /response_shape/);
  });

  test('a system_one Combination without validator_mode fails the type check', () => {
    // The `@ts-expect-error` line is checked by the Type_Check gate: if the field became optional, tsc would report an unused directive.
    // @ts-expect-error validator_mode is required for a SystemOneCombination
    const missing: SystemOneCombination = { ...flash, validator_mode: undefined };
    assert.equal(missing.validator_mode, undefined);
  });

  test('max_bytes_per_token is part of the Model_Fingerprint: a changed value is a different fingerprint ID', () => {
    const a = fingerprintId(systemOneFingerprint(comboWith({ k: 8 })));
    assert.equal(a, fingerprintId(systemOneFingerprint(comboWith({ k: 8 }))));
    assert.notEqual(a, fingerprintId(systemOneFingerprint(comboWith({ k: 6 }))));
    assert.notEqual(a, fingerprintId(systemOneFingerprint(comboWith({ window: 65536 }))));
    const fp = systemOneFingerprint(flash) as Record<string, unknown>;
    assert.equal(JSON.stringify(fp).includes(TOKEN), false);
    assert.deepEqual(fp['system_one'], {
      response_shape: 'system_one',
      model_selector: 'clef-flash',
      question_id: 'decision',
      context_window_tokens: 24576,
      max_bytes_per_token: 8,
      lower_bound_rule: 'floor(body_bytes / max_bytes_per_token)',
    });
  });
});

// ---------------------------------------------------------------- 29.2 request and response

describe('29.2 the request', () => {
  test('URL path, members of the body, no generative parameter, criteria in Permutation order', async () => {
    const { r, calls } = await send(COMBO, 200, answerBody({ choice: FIRST.optionIds[0]!, inputTokens: 100 }));
    assert.equal(r.kind, 'text');
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef-flash`);
    assert.equal(call.init.method, 'POST');
    const body = JSON.parse(call.init.body) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ['model', 'state', 'questions']);
    assert.equal(body['model'], 'clef-flash');
    const questions = body['questions'] as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(questions), ['decision']);
    assert.deepEqual(Object.keys(questions['decision']!), ['type', 'instructions', 'criteria']);
    assert.equal(questions['decision']!['type'], 'choice');
    for (const banned of ['temperature', 'seed', 'response_format', 'chat_template_kwargs', 'max_tokens', 'messages']) assert.equal(banned in body, false);
    assert.equal(call.init.body, buildSystemOneBody('clef-flash', FIRST.request));
  });

  test('every option ID of every Dev_Card keeps its order in criteria, in every Permutation', () => {
    const all = devDecisionRequests();
    assert.ok(all.length > REQUESTS.length, 'the Scored_Cards add permutations');
    for (const x of all) {
      const body = JSON.parse(buildSystemOneBody('clef', x.request)) as { questions: { decision: { criteria: Record<string, string> } } };
      assert.deepEqual(Object.keys(body.questions.decision.criteria), [...x.optionIds], `${x.cardId} ${x.permutation}`);
      assert.deepEqual(
        Object.entries(body.questions.decision.criteria),
        x.request.options.map((o) => [o.id, o.label]),
      );
    }
  });

  test('an integer-like or repeated option ID is refused when the body is built', () => {
    const mk = (ids: string[]): DecisionRequest => ({ kind: 'decision', state: 's', instructions: 'i', questionId: 'decision', options: ids.map((id) => ({ id, label: id })) });
    assert.throws(() => buildSystemOneBody('clef', mk(['a', '12'])), /integer-like/);
    assert.throws(() => buildSystemOneBody('clef', mk(['a', 'a'])), /twice/);
  });
});

describe('29.2 the response (R19.8, R19.9)', () => {
  const ids = FIRST.optionIds;
  test('a valid Raw_Choice is the text outcome, byte for byte, and is accepted by the validator', async () => {
    const { r } = await send(COMBO, 200, answerBody({ choice: ids[0]!, inputTokens: 90, outputTokens: 4 }));
    assert.equal(r.kind, 'text');
    if (r.kind !== 'text') return;
    assert.equal(r.text, ids[0]);
    assert.deepEqual(r.usage, { inputTokens: 90, outputTokens: 4, reasoningTokens: null });
    assert.equal(verdictOf(r.text).kind, 'decision');
  });

  test('a choice outside the set is returned as text; the validator calls it OutOfSetOption', async () => {
    for (const choice of ['', `${ids[0]!} `, ids[0]!.toUpperCase(), 'not_an_option']) {
      const { r } = await send(COMBO, 200, answerBody({ choice, inputTokens: 90 }));
      assert.equal(r.kind, 'text');
      if (r.kind !== 'text') continue;
      assert.equal(r.text, choice);
      const v = verdictOf(r.text);
      assert.equal(v.kind, 'illegal');
      assert.equal(v.reason, 'out_of_set_option'); // OutOfSetOption
    }
  });

  test('a missing answers, decision or choice, or a non-string choice, is system_one_shape', async () => {
    const wrap = (result: string): string => `{"success":true,"result":${result}}`;
    const cases: [string, RegExp][] = [
      [wrap('{"model":"m"}'), /answers missing/],
      [wrap('{"answers":{}}'), /answers\.decision missing/],
      [wrap('{"answers":{"decision":{"type":"choice"}}}'), /choice missing/],
      [wrap('{"answers":{"decision":{"choice":7}}}'), /not a string \(number\)/],
      [wrap('{"answers":{"decision":{"choice":null}}}'), /not a string \(null\)/],
      [wrap('{"answers":{"decision":{"choice":["a"]}}}'), /not a string \(array\)/],
      [wrap('{"answers":[]}'), /answers is not an object/],
      ['{"answers":{"decision":{"choice":"a"}}}', /result missing/], // a top-level object without `result`
      ['[1,2]', /not a JSON object/],
    ];
    for (const [body, detail] of cases) {
      const e = errorOf((await send(COMBO, 200, body)).r);
      assert.equal(e.code, 'system_one_shape', body);
      assert.match(e.detail, detail);
      assert.equal(e.systemOne?.responseText, body, 'the body is kept verbatim');
    }
  });

  test('confidence and probabilities are stored with their original lexemes, outside the outcome', async () => {
    const body = answerBody({ choice: ids[0]!, confidence: '0.10', probabilities: '{"a":0.30,"b":0.700}', inputTokens: 90 });
    const { r } = await send(COMBO, 200, body);
    assert.equal(r.kind, 'text');
    if (r.kind !== 'text') return;
    assert.equal(r.systemOne?.responseText, body);
    assert.ok(r.systemOne?.responseText.includes('"confidence":0.10'));
    assert.ok(r.systemOne?.responseText.includes('0.700'));
    assert.equal(r.systemOne?.usageReported, true);
    assert.equal(r.text, ids[0]);
  });

  test('a missing or partial usage sets usage_reported false and is not a fault', async () => {
    const a = await send(COMBO, 200, answerBody({ choice: ids[0]!, inputTokens: null }));
    assert.equal(a.r.kind, 'text');
    if (a.r.kind === 'text') {
      assert.equal(a.r.usage, null);
      assert.equal(a.r.systemOne?.usageReported, false);
    }
    const partial = answerBody({ choice: ids[0]!, extra: ',"usage":{"input_tokens":5}' });
    const b = await send(COMBO, 200, partial);
    assert.equal(b.r.kind, 'text');
    if (b.r.kind === 'text') assert.equal(b.r.systemOne?.usageReported, false);
    const frac = await send(COMBO, 200, answerBody({ choice: ids[0]!, extra: ',"usage":{"input_tokens":5.5,"output_tokens":1}' }));
    assert.equal(frac.r.kind, 'text');
    if (frac.r.kind === 'text') assert.equal(frac.r.usage, null);
  });
});

describe('29.2 HTTP failures, rate limit, plan or billing error, timeout', () => {
  test('429 is rate_limited with the status and first API error code; no retry', async () => {
    const f = fakeFetch(429, JSON.stringify({ success: false, errors: [{ code: 3040, message: 'x' }] }));
    const r = errorOf(await adapterFor(COMBO, f.fetch).complete(FIRST.request, OPTS));
    assert.equal(r.code, 'rate_limited');
    assert.deepEqual(r.remote, { status: 429, code: '3040' });
    assert.equal(f.calls.length, 1);
  });

  test('a plan or billing error is remote_error with the status and code, and no message text', async () => {
    const body = JSON.stringify({ success: false, errors: [{ code: 4006, message: `quota for ${TOKEN} exceeded` }] });
    const r = errorOf((await send(COMBO, 403, body)).r);
    assert.equal(r.code, 'remote_error');
    assert.deepEqual(r.remote, { status: 403, code: '4006' });
    assert.equal(r.detail.includes('quota'), false);
    assert.equal(r.detail.includes(TOKEN), false);
  });

  test('success=false in a 2xx body is remote_error', async () => {
    const r = errorOf((await send(COMBO, 200, JSON.stringify({ success: false, errors: [{ code: 7003 }] }))).r);
    assert.equal(r.code, 'remote_error');
  });

  test('a network error carries the error name only', async () => {
    const adapter = adapterFor(COMBO, () => Promise.reject(Object.assign(new Error(`boom ${TOKEN}`), { name: 'TypeError' })));
    const r = errorOf(await adapter.complete(FIRST.request, OPTS));
    assert.equal(r.code, 'remote_error');
    assert.equal(r.detail, 'network error (TypeError)');
  });

  test('a timeout aborts the request and the Late_Answer is none (aborted)', async () => {
    const clock = createFakeClock();
    const adapter = adapterFor(COMBO, (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), clock);
    const pending = adapter.complete(FIRST.request, OPTS);
    await clock.advance(5000);
    const r = await pending;
    assert.equal(r.kind, 'timeout');
    if (r.kind === 'timeout') assert.deepEqual(await r.late, { kind: 'none', reason: 'aborted' });
    assert.equal(adapter.state(), 'idle');
  });

  test('a chat request to a Decision_Model is refused without sending', async () => {
    const f = fakeFetch(200, '{}');
    const r = errorOf(await adapterFor(COMBO, f.fetch).complete({ system: 's', user: 'u' }, OPTS));
    assert.equal(r.code, 'runtime_error');
    assert.equal(f.calls.length, 0);
  });
});

// ---------------------------------------------------------------- 29.3 truncation

describe('29.3 truncation pre-check and post-check', () => {
  /** A request whose serialized body is exactly `bytes` long (ASCII padding in the state). */
  function requestOfBytes(selector: string, bytes: number): DecisionRequest {
    const base: DecisionRequest = { kind: 'decision', state: '', instructions: 'i', questionId: 'decision', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
    const empty = bodyBytesOf(buildSystemOneBody(selector, base));
    assert.ok(bytes >= empty);
    return { ...base, state: 'x'.repeat(bytes - empty) };
  }

  for (const id of ['workers-ai/clef-flash', 'workers-ai/clef'] as const) {
    const combo = realCombo(id);
    const W = combo.context_window_tokens;
    test(`${id}: a body of exactly ${W} bytes is accepted, one byte more is refused with nothing sent`, async () => {
      const exact = requestOfBytes(combo.model_selector, W);
      assert.equal(bodyBytesOf(buildSystemOneBody(combo.model_selector, exact)), W);
      const ok = fakeFetch(200, answerBody({ choice: 'a', inputTokens: Math.floor(W / 8) + 1 }));
      assert.equal((await adapterFor(combo, ok.fetch).complete(exact, OPTS)).kind, 'text');
      assert.equal(ok.calls.length, 1);

      const over = fakeFetch(200, answerBody({ choice: 'a', inputTokens: 5 }));
      const r = errorOf(await adapterFor(combo, over.fetch).complete(requestOfBytes(combo.model_selector, W + 1), OPTS));
      assert.equal(r.code, 'over_context');
      assert.equal(over.calls.length, 0, 'a refused request sends nothing');
      assert.match(r.detail, /nothing sent/);
    });
  }

  test('the pure pre-check and the Card ID list for a Locked_Run refusal', () => {
    assert.equal(isOverContext(24576, 24576), false);
    assert.equal(isOverContext(24577, 24576), true);
    const refused = overContextCardIds(
      [
        { cardId: 'D-a-001', bodyBytes: 100 },
        { cardId: 'D-a-002', bodyBytes: 101 },
        { cardId: 'D-a-002', bodyBytes: 200 },
        { cardId: 'D-a-003', bodyBytes: 300 },
      ],
      100,
    );
    assert.deepEqual(refused, ['D-a-002', 'D-a-003']);
  });

  test('the truncated flag is a truncated_state engine fault (envelope, result and usage positions)', async () => {
    const id = FIRST.optionIds[0]!;
    const bodies = [
      answerBody({ choice: id, inputTokens: 100, extra: ',"truncated":true' }),
      answerBody({ choice: id, inputTokens: 100 }).replace('"success":true', '"success":true,"truncated":true'),
      answerBody({ choice: id, inputTokens: null, extra: ',"usage":{"truncated":true}' }),
    ];
    for (const body of bodies) {
      const e = errorOf((await send(COMBO, 200, body)).r);
      assert.equal(e.code, 'truncated_state');
      assert.match(e.detail, /condition=truncated_flag/);
      assert.equal(e.systemOne?.responseText, body);
    }
    // `truncated: false` is no fault.
    assert.equal((await send(COMBO, 200, answerBody({ choice: id, inputTokens: 100, extra: ',"truncated":false' }))).r.kind, 'text');
  });

  test('input usage below floor(body_bytes / K) or above W is truncated_state; equality at either bound is not', async () => {
    const bytes = bodyBytesOf(buildSystemOneBody('clef-flash', FIRST.request));
    const combo = comboWith({ window: 10_000, k: 8 });
    const lower = inputTokenLowerBound(bytes, 8);
    assert.ok(lower > 1);
    const id = FIRST.optionIds[0]!;
    const kind = async (n: number): Promise<string> => {
      const r = (await send(combo, 200, answerBody({ choice: id, inputTokens: n }))).r;
      return r.kind === 'error' ? r.code : r.kind;
    };
    assert.equal(await kind(lower - 1), 'truncated_state');
    assert.equal(await kind(lower), 'text');
    assert.equal(await kind(10_000), 'text');
    assert.equal(await kind(10_001), 'truncated_state');
    const below = errorOf((await send(combo, 200, answerBody({ choice: id, inputTokens: lower - 1 }))).r);
    assert.match(below.detail, new RegExp(`body_bytes=${bytes} input_tokens=${lower - 1} condition=input_below_lower_bound`));
    assert.deepEqual(below.usage, { inputTokens: lower - 1, outputTokens: 1, reasoningTokens: null });
  });

  test('a response without usage is not a fault by itself and the post-check is skipped', () => {
    assert.deepEqual(postCheckTruncation({ bodyBytes: 800, maxBytesPerToken: 8, contextWindowTokens: 1000, inputTokens: null, truncatedFlag: false }), { fault: false });
    assert.equal(postCheckTruncation({ bodyBytes: 800, maxBytesPerToken: 8, contextWindowTokens: 1000, inputTokens: null, truncatedFlag: true }).fault, true);
  });

  test('a truncated_state record has no output: it is not a text, never counts as answered, and the ledger still misses it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-trunc-'));
    const combo = comboWith({ window: 10_000, k: 8 });
    const header = {
      schema: SCHEMA.header, run_id: 'dev-x', split: 'dev' as const, combination: combo.id,
      model_key: { runtime: combo.runtime, model_id: combo.model_id, quantization: '', revision: combo.revision },
      task_subset: 'D' as const, fingerprint: systemOneFingerprint(combo), template_hashes: { decision: 'ab' }, timeout_ms: 5000, placement: null,
    };
    const w = ResultsWriter.create(dir, header);
    const record: ResultRecord = {
      schema: SCHEMA.result, run_id: 'dev-x', split: 'dev', card_id: FIRST.cardId, permutation: 'base',
      outcome: { kind: 'engine_fault', code: 'truncated_state', detail: 'body_bytes=1 input_tokens=0 condition=input_below_lower_bound' },
      latency_ms: null, timeout_ms: 5000, requested_at: '2026-11-10T10:00:00.000Z', template_hash: 'ab', fingerprint_id: w.fingerprintId, usage: null, late: null, source: 'node',
      system_one: { response_text: '{"a":0.10}', usage_reported: false },
    };
    w.append(record);
    const { readResultsFile } = await import('../../src/results.ts');
    const { missingRuns } = await import('../../src/ledger.ts');
    const { hasOutput } = await import('../../src/run-grading.ts');
    const read = readResultsFile(w.file).records;
    assert.deepEqual(read[0], record, 'the verbatim body round-trips with its lexeme');
    assert.equal(hasOutput(read[0]!), false);
    assert.equal(missingRuns([{ card_id: FIRST.cardId, permutation: 'base', task: 'decision' }], read).length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------- 29.4 budget

describe('29.4 budget estimate', () => {
  test('reservation is ceil((b + 256) x price / 1e6) for both prices, with no output term', () => {
    assert.equal(estimateSystemOneNeurons({ bodyBytes: 4000, inputPrice: 3455 }), Math.ceil((4256 * 3455) / 1e6));
    assert.equal(estimateSystemOneNeurons({ bodyBytes: 4000, inputPrice: 21818 }), Math.ceil((4256 * 21818) / 1e6));
    assert.equal(estimateSystemOneNeurons({ bodyBytes: 0, inputPrice: 3455 }), 1); // ceil(256 x 3455 / 1e6) = ceil(0.88)
    assert.equal(systemOneUsageNeurons(1000, 21818), 22);
    assert.equal(systemOneUsageNeurons(0, 21818), 0);
    const inputs = systemOneBudgetInputs(realCombo('workers-ai/clef'), buildSystemOneBody('clef', FIRST.request));
    assert.equal(inputs.estimate, estimateSystemOneNeurons({ bodyBytes: inputs.bodyBytes, inputPrice: 21818 }));
  });

  test('the usage-based cost replaces the reservation; without usage the reservation stays; the 9,000 cap still applies', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-budget-'));
    const file = path.join(dir, 'budget.json');
    const now = (): number => Date.UTC(2026, 10, 10, 9);
    const s = BudgetSession.open({ file, now });
    const a = s.reserve({ smoke: false, estimate: 1000 });
    assert.ok(!isRefusal(a));
    if (isRefusal(a)) return;
    assert.equal(s.counter('2026-11-10').neurons, 1000);
    assert.equal(s.settleSystemOne(a, 40_000, 21818), 873); // ceil(40000 x 21818 / 1e6)
    assert.equal(s.counter('2026-11-10').neurons, 873);
    const b = s.reserve({ smoke: false, estimate: 500 });
    assert.ok(!isRefusal(b));
    if (isRefusal(b)) return;
    assert.equal(s.settleSystemOne(b, null, 21818), 1373, 'no usage: the reservation stays');
    const over = s.reserve({ smoke: false, estimate: 9000 - 1373 + 1 });
    assert.ok(isRefusal(over));
    if (isRefusal(over)) assert.equal(over.cap, 'neuron');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------- 29.5 smoke

describe('29.5 Smoke_Call shape check', () => {
  const valid = (): Record<string, unknown> => ({
    success: true,
    result: { model: 'clef-flash', answers: { decision: { type: 'choice', choice: 'a', probabilities: { a: 0.6, b: 0.4 }, confidence: 0.6 } }, usage: { input_tokens: 90, output_tokens: 2 } },
  });
  const check = (o: unknown, status = 200) => checkSystemOneShape(status, JSON.stringify(o));

  test('ok exactly when every member is present with its type', () => {
    assert.equal(check(valid()).check, 'ok');
    const mutate = (f: (r: any) => void): unknown => {
      const v = valid() as any;
      f(v.result);
      return v;
    };
    const bad: [string, unknown][] = [
      ['model', mutate((r) => (r.model = 3))],
      ['no model', mutate((r) => delete r.model)],
      ['type', mutate((r) => (r.answers.decision.type = 'text'))],
      ['choice', mutate((r) => (r.answers.decision.choice = 1))],
      ['probabilities', mutate((r) => (r.answers.decision.probabilities = { a: '0.6' }))],
      ['no probabilities', mutate((r) => delete r.answers.decision.probabilities)],
      ['confidence', mutate((r) => (r.answers.decision.confidence = '0.6'))],
      ['input_tokens', mutate((r) => (r.usage.input_tokens = 1.5))],
      ['output_tokens', mutate((r) => delete r.usage.output_tokens)],
      ['no usage', mutate((r) => delete r.usage)],
      ['top-level, no result', { model: 'x', answers: {} }],
    ];
    for (const [name, body] of bad) assert.equal(check(body).check, 'mismatch', name);
    assert.equal(check({ success: false, errors: [] }, 200).check, 'not_checked');
    assert.equal(check(valid(), 429).check, 'not_checked');
    assert.equal(checkSystemOneShape(null, null).check, 'not_checked');
    assert.equal(checkSystemOneShape(200, 'nope').check, 'mismatch');
  });

  test('bytes_per_token is an exact fraction of integers', () => {
    assert.deepEqual(bytesPerTokenOf(1234, 307), { numerator: 1234, denominator: 307 });
    assert.equal(bytesPerTokenOf(1234, null), null);
    assert.equal(bytesPerTokenOf(1234, 0), null);
  });
});

describe('29.5 smoke command on a Decision_Model (fake fetch, no approval)', () => {
  const DAY = '2026-11-10';
  function rig(respond?: (n: number) => { status: number; body: string }, combo: SystemOneCombination = COMBO) {
    const env = makeEnv();
    fs.mkdirSync(path.join(env.root, 'eval/probe/templates'), { recursive: true });
    fs.writeFileSync(path.join(env.root, 'eval/probe/templates/decision.system_one.v1.txt'), MAPPING);
    let envReads = 0;
    const sent: string[] = [];
    const fetch = fakeFetch((n, call) => {
      sent.push(call.init.body);
      return respond?.(n) ?? { status: 200, body: answerBody({ choice: REQUESTS[n]!.optionIds[0]!, inputTokens: 300, outputTokens: 2 }) };
    }).fetch;
    let t = Date.parse(`${DAY}T10:00:00.000Z`);
    const base = env.deps({ factory: undefined as never, calls: [], engine: [] });
    const deps: SmokeDeps = {
      paths: base.paths,
      pinnedManifestHash: base.pinnedManifestHash,
      combinations: [combo as Combination],
      fetch,
      loadEnv: (): WorkersAiEnv => {
        envReads += 1;
        return { token: new Secret(TOKEN), accountId: new Secret(ACCOUNT) };
      },
      now: () => (t += 1000),
    };
    return { env, deps, sent, envReads: () => envReads };
  }
  const records = (r: ReturnType<typeof rig>) => readSmoke(smokeFileOf(r.deps.paths, DAY));

  test('sends D Dev_Cards only, needs no approvals file, and records shape_check, declared_shape, status and bytes_per_token', async () => {
    const r = rig();
    const out = await capture(() => smokeCommand(['--combo', COMBO.id, '--count', '3'], r.deps));
    assert.equal(out.value, 0, out.err);
    assert.equal(r.sent.length, 3);
    const recs = records(r);
    assert.equal(recs.length, 3);
    for (const [i, rec] of recs.entries()) {
      assert.equal(rec['task'], 'decision');
      assert.equal(rec['permutation'], 'base');
      assert.equal(rec['shape_check'], 'ok');
      assert.equal(rec['declared_shape'], 'system_one');
      assert.equal(rec['http_status'], 200);
      assert.equal(rec['verdict'], 'decision');
      const bytes = Buffer.byteLength(r.sent[i]!, 'utf8');
      assert.deepEqual(rec['bytes_per_token'], { numerator: bytes, denominator: 300 });
      assert.equal(rec['body_bytes'], bytes);
      assert.equal(rec['usage_reported'], true);
    }
    const counter = JSON.parse(fs.readFileSync(r.deps.paths.budgetFile, 'utf8')) as { days: Record<string, { smoke: number; requests: number; neurons: number }> };
    assert.equal(counter.days[DAY]?.smoke, 3);
    assert.equal(counter.days[DAY]?.requests, 3);
    assert.equal(r.envReads(), 1);
    assert.deepEqual(fs.readdirSync(path.join(r.env.root, 'eval/results')).sort(), ['budget', 'smoke']);
  });

  test('a mismatching response is recorded as such and the command still finishes', async () => {
    const r = rig(() => ({ status: 200, body: JSON.stringify({ success: true, result: { model: 'm', answers: { decision: { type: 'choice', choice: 'a' } } } }) }));
    const out = await capture(() => smokeCommand(['--combo', COMBO.id, '--count', '2'], r.deps));
    assert.equal(out.value, 0);
    assert.ok(records(r).every((x) => x['shape_check'] === 'mismatch' && x['declared_shape'] === 'system_one'));
    assert.match(out.out, /shape mismatches 2/);
  });

  test('--task S and --max-tokens are refused before anything is read or sent', async () => {
    const r = rig();
    const s = await capture(() => smokeCommand(['--combo', COMBO.id, '--task', 'S'], r.deps));
    assert.equal(s.value, 1);
    assert.match(s.err, /accepts Task_Type D only/);
    const m = await capture(() => smokeCommand(['--combo', COMBO.id, '--max-tokens', '5'], r.deps));
    assert.equal(m.value, 1);
    assert.equal(r.sent.length, 0);
    assert.equal(r.envReads(), 0);
    assert.equal(fs.existsSync(r.deps.paths.budgetFile), false);
  });

  test('an over-context body stops the Smoke_Calls before anything is reserved or sent', async () => {
    const r = rig(undefined, comboWith({ window: 50 }));
    const out = await capture(() => smokeCommand(['--combo', COMBO.id, '--count', '2'], r.deps));
    assert.equal(out.value, 1);
    assert.match(out.err, /over_context/);
    assert.equal(r.sent.length, 0);
    assert.equal(r.envReads(), 0);
    assert.equal(fs.existsSync(r.deps.paths.budgetFile), false);
  });

  test('a 429 is recorded without shape_check and the call still counts', async () => {
    const r = rig(() => ({ status: 429, body: JSON.stringify({ success: false, errors: [{ code: 3040 }] }) }));
    await capture(() => smokeCommand(['--combo', COMBO.id, '--count', '1'], r.deps));
    const [rec] = records(r);
    assert.equal(rec?.['http_status'], 429);
    assert.equal(rec?.['outcome'], 'rate_limited');
    assert.equal('shape_check' in (rec ?? {}), false);
    assert.equal(rec?.['usage_reported'], false);
  });

  test('a truncated_state response is recorded as an engine fault, not graded', async () => {
    const r = rig((n) => ({ status: 200, body: answerBody({ choice: REQUESTS[n]!.optionIds[0]!, inputTokens: 300, extra: ',"truncated":true' }) }));
    await capture(() => smokeCommand(['--combo', COMBO.id, '--count', '1'], r.deps));
    const [rec] = records(r);
    assert.equal(rec?.['outcome'], 'truncated_state');
    assert.equal(rec?.['verdict'], 'engine_fault');
  });
});

// ---------------------------------------------------------------- run gate for a Decision_Model

describe('the run gate for a Decision_Model (allowDecisionModel in the dev and locked steps)', () => {
  const combo = realCombo('workers-ai/clef-flash');

  function gateDeps(approvals: ReturnType<typeof dm>[], smoke = [smokeRec(combo as Combination, 'ok')]) {
    const env = makeEnv();
    fs.mkdirSync(path.join(env.root, 'eval/probe/templates'), { recursive: true });
    fs.writeFileSync(path.join(env.root, 'eval/probe/templates/decision.system_one.v1.txt'), MAPPING);
    const state = baseState({ combinations: [combo as Combination], approvals: { approved: true, approvals }, smoke });
    return { deps: { ...env.deps({ factory: undefined as never, calls: [], engine: [] }), phaseState: () => Promise.resolve(state) }, root: env.root };
  }

  test('refused without an approval, allowed with a matching one, refused for a count over max_requests or another id', async () => {
    const { deps } = gateDeps([]);
    const none = await gateRun(deps, 'dev', combo, 'D', 'DM-1', 74);
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.reason, /no unwithdrawn decision_model dev approval/);

    const withEntry = gateDeps([dm('DM-1', combo as Combination, 'dev', 74)]);
    assert.deepEqual(await gateRun(withEntry.deps, 'dev', combo, 'D', 'DM-1', 74), { ok: true, value: { approval: 'DM-1' } });
    const tooMany = await gateRun(withEntry.deps, 'dev', combo, 'D', 'DM-1', 75);
    assert.equal(tooMany.ok, false);
    const wrongId = await gateRun(withEntry.deps, 'dev', combo, 'D', 'DM-2', 74);
    assert.equal(wrongId.ok, false);
    const noId = await gateRun(withEntry.deps, 'dev', combo, 'D', null, 74);
    assert.equal(noId.ok, false);
    const subsetS = await gateRun(withEntry.deps, 'dev', combo, 'S', 'DM-1', 74);
    assert.equal(subsetS.ok, false);
  });
});
