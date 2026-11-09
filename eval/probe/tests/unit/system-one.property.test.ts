// Properties 43, 44 and 45 of the System_One adapter (llm-probe task 29). fast-check, 200 runs each, a fake
// `fetch`, no network, no `env`, no locked.jsonl.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import fc from 'fast-check';
import type { AdapterResult, DecisionRequest } from '../../src/adapters/interface.ts';
import { bodyBytesOf, buildSystemOneBody, inputTokenLowerBound, isOverContext, overContextCardIds, postCheckTruncation, systemOneFingerprint } from '../../src/adapters/system-one.ts';
import { BudgetSession, estimateNeurons, estimateSystemOneNeurons, isRefusal, NEURON_CAP, readBudgetFile, usageNeurons, utcDay } from '../../src/budget.ts';
import { fingerprintId } from '../../src/results.ts';
import { llmValidate } from '../../src/simwasm.ts';
import { checkSystemOneShape } from '../../src/smoke.ts';
import { adapterFor, answerBody, comboWith, devDecisionRequests, fakeFetch } from './system-one.helpers.ts';

const RUNS = { numRuns: 200 };
const REQUESTS = devDecisionRequests(true);
const OPTS = { timeoutMs: 5000 };

// ---------------------------------------------------------------- Property 43

// Feature: llm-probe, Property 43: A System_One response yields a Raw_Choice or a named error, and confidence never leaks
// **Validates: Requirements 19.6, 19.8, 19.9, 11.15, 11.17, 11.18, 12.2, 11.19**

const MARK = 'ZZMARKZZ';
type ChoiceSpec = { tag: 'string'; v: string } | { tag: 'option'; i: number } | { tag: 'null' } | { tag: 'number'; v: number } | { tag: 'object' } | { tag: 'array' } | { tag: 'absent' };
type AnswersSpec = 'ok' | 'no_answers' | 'answers_array' | 'no_decision' | 'decision_array';
type UsageSpec = { tag: 'ok'; input: number; output: number } | { tag: 'missing' } | { tag: 'only_input'; input: number } | { tag: 'fractional' } | { tag: 'string_count' } | { tag: 'negative' };

const choiceArb: fc.Arbitrary<ChoiceSpec> = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 30 }).map((v): ChoiceSpec => ({ tag: 'string', v })),
  fc.constant<ChoiceSpec>({ tag: 'string', v: '' }),
  fc.nat(10).map((i): ChoiceSpec => ({ tag: 'option', i })),
  fc.constant<ChoiceSpec>({ tag: 'null' }),
  fc.integer().map((v): ChoiceSpec => ({ tag: 'number', v })),
  fc.constant<ChoiceSpec>({ tag: 'object' }),
  fc.constant<ChoiceSpec>({ tag: 'array' }),
  fc.constant<ChoiceSpec>({ tag: 'absent' }),
);
const answersArb = fc.constantFrom<AnswersSpec>('ok', 'ok', 'ok', 'no_answers', 'answers_array', 'no_decision', 'decision_array');
const usageArb: fc.Arbitrary<UsageSpec> = fc.oneof(
  fc.record({ tag: fc.constant('ok' as const), input: fc.integer({ min: 0, max: 60_000 }), output: fc.nat(5000) }),
  fc.constant<UsageSpec>({ tag: 'missing' }),
  fc.nat(60_000).map((input): UsageSpec => ({ tag: 'only_input', input })),
  fc.constant<UsageSpec>({ tag: 'fractional' }),
  fc.constant<UsageSpec>({ tag: 'string_count' }),
  fc.constant<UsageSpec>({ tag: 'negative' }),
);
// Number lexemes, kept as text so trailing zeros survive in the body.
const lexemeArb = fc.constantFrom('0', '1', '0.10', '0.500', '0.3300', '1.0', '1e-3', '0.0001', '12', '0.99999');
const probsArb = fc.array(fc.tuple(fc.constantFrom('a', 'b', 'c', 'ZZMARKZZ'), lexemeArb), { maxLength: 4 }).map((kv) => `{${[...new Map(kv).entries()].map(([k, v]) => `"${k}":${v}`).join(',')}}`);
const confArb = fc.tuple(lexemeArb, probsArb);

function bodyOf(options: readonly string[], choice: ChoiceSpec, answers: AnswersSpec, usage: UsageSpec, conf: readonly [string, string], extra: boolean): string {
  const choiceJson =
    choice.tag === 'string' ? JSON.stringify(choice.v)
    : choice.tag === 'option' ? JSON.stringify(options[choice.i % options.length])
    : choice.tag === 'null' ? 'null'
    : choice.tag === 'number' ? String(choice.v)
    : choice.tag === 'object' ? `{"${MARK}":1}`
    : choice.tag === 'array' ? `["${MARK}"]`
    : undefined;
  const decision = `{"type":"choice"${choiceJson === undefined ? '' : `,"choice":${choiceJson}`},"probabilities":${conf[1]},"confidence":${conf[0]}${extra ? `,"note":"${MARK}"` : ''}}`;
  const answersJson =
    answers === 'ok' ? `{"decision":${decision}}`
    : answers === 'no_decision' ? `{"other":${decision}}`
    : answers === 'decision_array' ? `{"decision":[${decision}]}`
    : answers === 'answers_array' ? `[${decision}]`
    : undefined;
  const usageJson =
    usage.tag === 'ok' ? `,"usage":{"input_tokens":${usage.input},"output_tokens":${usage.output}}`
    : usage.tag === 'only_input' ? `,"usage":{"input_tokens":${usage.input}}`
    : usage.tag === 'fractional' ? ',"usage":{"input_tokens":10.5,"output_tokens":2}'
    : usage.tag === 'string_count' ? ',"usage":{"input_tokens":"10","output_tokens":2}'
    : usage.tag === 'negative' ? ',"usage":{"input_tokens":-1,"output_tokens":2}'
    : '';
  return `{"success":true,"errors":[],"messages":["${MARK}"],"result":{"model":"clef-flash"${answersJson === undefined ? '' : `,"answers":${answersJson}`}${usageJson}${extra ? `,"${MARK}":true` : ''}}}`;
}

// No truncation condition can fire: the lower bound is 0 and the window is as large as the usage range.
const OPEN = comboWith({ window: 1_000_000, k: 1_000_000_000 });
const verdictOf = (r: (typeof REQUESTS)[number], text: string): string =>
  JSON.stringify((JSON.parse(llmValidate(JSON.stringify({ frozen_context: r.frozenContext, raw: text }), 'raw_choice', r.cardId)) as { verdict: unknown }).verdict);

/** The outcome without the verbatim body, for the isolation comparison. */
const withoutBody = (r: AdapterResult): unknown => JSON.parse(JSON.stringify(r, (k, v: unknown) => (k === 'systemOne' ? undefined : k === 'late' ? undefined : v)));

test('Property 43: a System_One response yields a Raw_Choice or a named error, and confidence never leaks', async () => {
  await fc.assert(
    fc.asyncProperty(fc.nat(REQUESTS.length - 1), choiceArb, answersArb, usageArb, confArb, confArb, fc.boolean(), async (ri, choice, answers, usage, conf1, conf2, extra) => {
      const req = REQUESTS[ri]!;
      const body1 = bodyOf(req.optionIds, choice, answers, usage, conf1, extra);
      const body2 = bodyOf(req.optionIds, choice, answers, usage, conf2, extra);
      const f1 = fakeFetch(200, body1);
      const r1 = await adapterFor(OPEN, f1.fetch).complete(req.request, OPTS);
      const r2 = await adapterFor(OPEN, fakeFetch(200, body2).fetch).complete(req.request, OPTS);

      const isString = answers === 'ok' && (choice.tag === 'string' || choice.tag === 'option');
      if (isString) {
        assert.equal(r1.kind, 'text');
        if (r1.kind === 'text') {
          const expected = choice.tag === 'string' ? choice.v : req.optionIds[choice.i % req.optionIds.length]!;
          assert.equal(r1.text, expected, 'the Raw_Choice byte for byte');
          assert.equal(r1.text.includes(MARK), false);
        }
      } else {
        assert.equal(r1.kind, 'error');
        if (r1.kind === 'error') {
          assert.equal(r1.code, 'system_one_shape');
          assert.equal(r1.detail.includes(MARK), false, 'no marker from another member in the outcome');
        }
      }

      // The verbatim body is kept, with the original lexemes; the original is not parsed and re-serialized.
      const kept1 = r1.kind === 'text' || r1.kind === 'error' ? r1.systemOne : undefined;
      assert.equal(kept1?.responseText, body1);
      if (answers !== 'no_answers') {
        assert.ok(kept1?.responseText.includes(`"confidence":${conf1[0]}`));
        assert.ok(kept1?.responseText.includes(`"probabilities":${conf1[1]}`));
      }

      // Usage maps input and output tokens; reasoning is null; missing or non-integer usage is not reported.
      const usageOf = r1.kind === 'text' || r1.kind === 'error' ? r1.usage : undefined;
      if (usage.tag === 'ok') {
        assert.deepEqual(usageOf, { inputTokens: usage.input, outputTokens: usage.output, reasoningTokens: null });
        assert.equal(kept1?.usageReported, true);
      } else {
        assert.ok(usageOf === null || usageOf === undefined);
        assert.equal(kept1?.usageReported, false);
      }

      // Replacing confidence and probabilities changes nothing but the stored body: outcome, verdict, grade input.
      assert.deepEqual(withoutBody(r1), withoutBody(r2));
      if (r1.kind === 'text' && r2.kind === 'text') assert.equal(verdictOf(req, r1.text), verdictOf(req, r2.text));
    }),
    RUNS,
  );
});

test('Property 43 (smoke): the shape check is ok exactly when every member is present with the right type', () => {
  const valid = (): any => ({
    success: true,
    result: { model: 'clef', answers: { decision: { type: 'choice', choice: 'a', probabilities: { a: 0.5, b: 0.5 }, confidence: 0.5 } }, usage: { input_tokens: 10, output_tokens: 2 } },
  });
  // For each member: values that are never valid for it.
  const badCount: unknown[] = [null, 1.5, '1', {}, []];
  const slots: { path: string[]; bad: unknown[] }[] = [
    { path: ['result', 'model'], bad: [null, 5, {}, []] },
    { path: ['result', 'answers'], bad: [null, 'x', [], 5] },
    { path: ['result', 'answers', 'decision'], bad: [null, 'x', [], 5] },
    { path: ['result', 'answers', 'decision', 'type'], bad: ['text', null, 1] },
    { path: ['result', 'answers', 'decision', 'choice'], bad: [null, 1, {}, []] },
    { path: ['result', 'answers', 'decision', 'probabilities'], bad: [null, 'x', [], { a: '1' }, { a: null }] },
    { path: ['result', 'answers', 'decision', 'confidence'], bad: [null, '0.5', {}, []] },
    { path: ['result', 'usage', 'input_tokens'], bad: badCount },
    { path: ['result', 'usage', 'output_tokens'], bad: badCount },
    { path: ['result', 'usage'], bad: [null, 'x', [], 5] },
    { path: ['result'], bad: [null, 'x', [], 5] },
  ];
  fc.assert(
    fc.property(fc.nat(slots.length - 1), fc.constantFrom('delete', 'replace'), fc.nat(10), fc.boolean(), fc.boolean(), (si, op, wi, corrupt, extras) => {
      const body = valid();
      if (extras) {
        body.result.answers.decision.note = 'extra';
        body.result.extra = { a: 1 };
      }
      if (!corrupt) {
        assert.equal(checkSystemOneShape(200, JSON.stringify(body)).check, 'ok');
        return;
      }
      const slot = slots[si]!;
      const parent = slot.path.slice(0, -1).reduce((o: any, k) => o[k], body);
      const key = slot.path[slot.path.length - 1]!;
      if (op === 'delete') delete parent[key];
      else parent[key] = slot.bad[wi % slot.bad.length];
      assert.equal(checkSystemOneShape(200, JSON.stringify(body)).check, 'mismatch');
    }),
    RUNS,
  );
});

// ---------------------------------------------------------------- Property 44

// Feature: llm-probe, Property 44: Truncation checks are exact at the boundary and never grade a possibly cut request
// **Validates: Requirements 19.11, 3.5, 3.15, 13.1, 14.1, 12.9**

const stateArb = fc.string({ unit: fc.constantFrom('a', 'b', ' ', 'é', '漢', '🙂', '"', '\\', '\n'), maxLength: 200 });
const optionsArb = fc.array(fc.constantFrom('keep', 'sell', 'burn', 'wait', 'ask'), { minLength: 2, maxLength: 5 }).map((a) => [...new Set(a)]).filter((a) => a.length >= 2);

test('Property 44: the pre-check accepts exactly body_bytes <= W and a refused request sends nothing', async () => {
  await fc.assert(
    fc.asyncProperty(stateArb, optionsArb, fc.constantFrom(-3, -2, -1, 0, 1, 2, 3), fc.integer({ min: 1, max: 10 }), async (state, ids, delta, k) => {
      const req: DecisionRequest = { kind: 'decision', state, instructions: 'i', questionId: 'decision', options: ids.map((id) => ({ id, label: id })) };
      const bytes = bodyBytesOf(buildSystemOneBody('clef-flash', req));
      const W = bytes + delta;
      fc.pre(W >= 1);
      const combo = comboWith({ window: W, k });
      assert.equal(isOverContext(bytes, W), bytes > W);
      const f = fakeFetch(200, answerBody({ choice: ids[0]!, inputTokens: Math.min(W, Math.max(inputTokenLowerBound(bytes, k), 1)) }));
      const r = await adapterFor(combo, f.fetch).complete(req, OPTS);
      if (bytes > W) {
        assert.equal(f.calls.length, 0, 'a refused request sends nothing');
        assert.equal(r.kind, 'error');
        if (r.kind === 'error') assert.equal(r.code, 'over_context');
      } else {
        assert.equal(f.calls.length, 1);
        assert.notEqual(r.kind === 'error' ? r.code : '', 'over_context');
      }
    }),
    RUNS,
  );
});

test('Property 44: the post-check is a truncated_state fault exactly on the flag, below floor(bytes / K) or above W', async () => {
  await fc.assert(
    fc.asyncProperty(
      stateArb,
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 0, max: 400 }),
      fc.constantFrom<'below2' | 'below' | 'lower' | 'above_lower' | 'w_minus' | 'w' | 'w_plus' | 'none' | 'any'>('below2', 'below', 'lower', 'above_lower', 'w_minus', 'w', 'w_plus', 'none', 'any'),
      fc.nat(100_000),
      fc.constantFrom('none', 'top', 'result', 'usage', 'false'),
      async (state, k, slack, where, anyN, flag) => {
        const req: DecisionRequest = { kind: 'decision', state, instructions: 'i', questionId: 'decision', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
        const bytes = bodyBytesOf(buildSystemOneBody('clef', req));
        const W = bytes + slack;
        const lower = inputTokenLowerBound(bytes, k);
        const n: number | null =
          where === 'below2' ? lower - 2 : where === 'below' ? lower - 1 : where === 'lower' ? lower : where === 'above_lower' ? lower + 1
          : where === 'w_minus' ? W - 1 : where === 'w' ? W : where === 'w_plus' ? W + 1 : where === 'none' ? null : anyN;
        fc.pre(n === null || n >= 0);
        const flagged = flag === 'top' || flag === 'result' || flag === 'usage';
        let body = answerBody({ choice: 'a', inputTokens: n });
        if (flag === 'top') body = body.replace('"success":true', '"success":true,"truncated":true');
        if (flag === 'result') body = body.replace('"result":{', '"result":{"truncated":true,');
        if (flag === 'usage') body = n === null ? body.replace(/\}\}$/, ',"usage":{"truncated":true}}}') : body.replace('"usage":{', '"usage":{"truncated":true,');
        if (flag === 'false') body = body.replace('"result":{', '"result":{"truncated":false,');

        const expectFault = flagged || (n !== null && (n < lower || n > W));
        const pure = postCheckTruncation({ bodyBytes: bytes, maxBytesPerToken: k, contextWindowTokens: W, inputTokens: n, truncatedFlag: flagged });
        assert.equal(pure.fault, expectFault);

        const combo = comboWith({ window: W, k, selector: 'clef' });
        const r = await adapterFor(combo, fakeFetch(200, body).fetch).complete(req, OPTS);
        if (expectFault) {
          assert.equal(r.kind, 'error');
          if (r.kind === 'error') assert.equal(r.code, 'truncated_state');
        } else {
          assert.equal(r.kind, 'text');
          if (r.kind === 'text' && n === null) assert.equal(r.systemOne?.usageReported, false);
        }
      },
    ),
    RUNS,
  );
});

test('Property 44: a Locked_Run refusal lists every over-context Card ID once; K is part of the fingerprint ID', () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.constantFrom('D-a-001', 'D-a-002', 'D-a-003', 'D-a-004'), fc.integer({ min: 0, max: 300 })), { maxLength: 12 }),
      fc.integer({ min: 1, max: 300 }),
      fc.integer({ min: 1, max: 40 }),
      fc.integer({ min: 1, max: 40 }),
      (rows, W, k1, k2) => {
        const listed = overContextCardIds(rows.map(([cardId, bodyBytes]) => ({ cardId, bodyBytes })), W);
        const expected = [...new Set(rows.filter(([, b]) => b > W).map(([c]) => c))];
        assert.deepEqual([...listed].sort(), [...expected].sort());
        assert.equal(new Set(listed).size, listed.length);

        const fp = (k: number): string => fingerprintId(systemOneFingerprint(comboWith({ k })));
        assert.equal(fp(k1) === fp(k2), k1 === k2);
      },
    ),
    RUNS,
  );
});

// ---------------------------------------------------------------- Property 45

// Feature: llm-probe, Property 45: The System One budget estimate is an exact byte-based upper bound with no output term
// **Validates: Requirements 19.12, 11.5, 11.6, 11.13, 11.14, 11.17**

const root = mkdtempSync(path.join(tmpdir(), 'probe-so-budget-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => path.join(root, `p${n++}`, 'workers-ai.json');

const refCeil = (num: bigint, den: bigint): bigint => {
  const q = num / den;
  return num % den === 0n ? q : q + 1n;
};
const priceArb = fc.oneof(fc.constantFrom(3455, 21818), fc.integer({ min: 1, max: 40_000 }));

test('Property 45: the reservation is ceil((b + 256) x p / 1e6), monotone in b, with no output term, and an upper bound for every t <= b + 256', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 200_000 }), fc.integer({ min: 0, max: 200_000 }), priceArb, fc.nat(1_000_000), fc.nat(256), (b, extra, p, outputTokens, back) => {
      const est = estimateSystemOneNeurons({ bodyBytes: b, inputPrice: p });
      assert.equal(BigInt(est), refCeil((BigInt(b) + 256n) * BigInt(p), 1_000_000n));
      assert.ok(estimateSystemOneNeurons({ bodyBytes: b + extra, inputPrice: p }) >= est, 'non-decreasing in b');
      // The generative estimate with a zero output price is the same number, whatever the output cap.
      assert.equal(estimateNeurons({ promptBytes: b, maxOutputTokens: outputTokens, inputPrice: p, outputPrice: 0 }), est);
      const t = b + 256 - back;
      assert.ok(BigInt(est) >= refCeil(BigInt(t) * BigInt(p), 1_000_000n), 'an upper bound for every t <= b + 256');
    }),
    RUNS,
  );
});

type Step =
  | { kind: 'so'; bytes: number; usage: { input: number; output: number } | null; price: number }
  | { kind: 'other'; bytes: number; maxOut: number; usage: { input: number; output: number } | null; pin: number; pout: number };
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('so' as const),
    bytes: fc.integer({ min: 0, max: 70_000 }),
    usage: fc.option(fc.record({ input: fc.integer({ min: 0, max: 70_000 }), output: fc.nat(5000) }), { nil: null }),
    price: priceArb,
  }),
  fc.record({
    kind: fc.constant('other' as const),
    bytes: fc.integer({ min: 0, max: 20_000 }),
    maxOut: fc.integer({ min: 1, max: 1024 }),
    usage: fc.option(fc.record({ input: fc.nat(20_000), output: fc.nat(1024) }), { nil: null }),
    pin: fc.integer({ min: 1, max: 5000 }),
    pout: fc.integer({ min: 1, max: 12_000 }),
  }),
);

test('Property 45: after a response with usage the counted cost replaces the reservation; the counter equals settled costs plus open reservations; the 9,000 cap stops the day', () => {
  fc.assert(
    fc.property(fc.array(stepArb, { minLength: 1, maxLength: 25 }), (steps) => {
      const file = fresh();
      const now = Date.UTC(2026, 10, 10, 9);
      const day = utcDay(now);
      const s = BudgetSession.open({ file, now: () => now, caps: { perRun: 10_000, daily: 10_000, smoke: 10, neurons: NEURON_CAP } });
      let expected = 0n; // settled costs plus open reservations
      let locked = false;
      for (const st of steps) {
        const estimate =
          st.kind === 'so'
            ? estimateSystemOneNeurons({ bodyBytes: st.bytes, inputPrice: st.price })
            : estimateNeurons({ promptBytes: st.bytes, maxOutputTokens: st.maxOut, inputPrice: st.pin, outputPrice: st.pout });
        const r = s.reserve({ smoke: false, estimate });
        if (expected + BigInt(estimate) > BigInt(NEURON_CAP) || locked) {
          // No request is sent over the cap, and none later that UTC day.
          assert.ok(isRefusal(r));
          if (isRefusal(r)) assert.equal(r.cap, 'neuron');
          locked = true;
        } else {
          assert.ok(!isRefusal(r));
          if (isRefusal(r)) continue;
          expected += BigInt(estimate);
          assert.equal(BigInt(readBudgetFile(file).days[day]!.neurons), expected, 'the reservation is persisted before the request');
          if (st.kind === 'so') {
            // output_tokens never enters the cost
            const settled = s.settleSystemOne(r, st.usage === null ? null : st.usage.input, st.price);
            if (st.usage !== null) expected += refCeil(BigInt(st.usage.input) * BigInt(st.price), 1_000_000n) - BigInt(estimate);
            assert.equal(BigInt(settled), expected);
          } else {
            const settled = s.settle(r, st.usage === null ? null : { promptTokens: st.usage.input, completionTokens: st.usage.output }, { inputPrice: st.pin, outputPrice: st.pout });
            if (st.usage !== null) expected += BigInt(usageNeurons({ promptTokens: st.usage.input, completionTokens: st.usage.output }, { inputPrice: st.pin, outputPrice: st.pout })) - BigInt(estimate);
            assert.equal(BigInt(settled), expected);
          }
        }
        assert.equal(BigInt(readBudgetFile(file).days[day]?.neurons ?? 0), expected, 'the persisted count equals settled costs plus open reservations');
      }
    }),
    RUNS,
  );
});
