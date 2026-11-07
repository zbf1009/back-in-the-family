// Tests for the `smoke` command (task 17.4). A synthetic Card_Set in a temp directory, a fake fetch and a fake
// env reader: no request is sent, the real `env` file and the real locked.jsonl are never opened.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { EnvError, type WorkersAiEnv } from '../../src/env.ts';
import type { FetchLike } from '../../src/adapters/workers-ai.ts';
import { parseCombinations, type Combination } from '../../src/phase.ts';
import { Secret } from '../../src/redact.ts';
import { readSmoke } from '../../src/results.ts';
import { renderPromptCalls } from '../../src/simwasm.ts';
import { clearSecrets } from '../../src/sink.ts';
import { apiErrorOf, checkResponseShape, finishReasonOf, parseSmokeArgs, requestFactsOf, responseKeysOf, smokeCommand, smokeFileOf, usageDetailOf, type SmokeDeps } from '../../src/smoke.ts';
import { FAKE_COMBO, capture, createFakeRuntime, defaultAnswer, makeEnv, WORKERS_COMBO } from './run.helpers.ts';

afterEach(() => clearSecrets());

const CHAT: Combination = parseCombinations(
  JSON.stringify([
    {
      id: 'workers-ai/smoke-chat',
      runtime: 'workers-ai',
      model_id: '@cf/fake/chat-model',
      quantization: '',
      revision: 'server-side, not pinnable',
      phase1_locked: false,
      response_shape: 'chat',
      max_output_param: { name: 'max_completion_tokens', source: 'test' },
      prices: { input: 1000, output: 2000, source: 'test', read_on: '2026-11-07' },
      sampling: { temperature: 0, top_p: null, seed: 7, max_output_tokens: { decision: 64, synthesis: 1024 } },
      chat_template_kwargs: { enable_thinking: false },
      constraint: 'json_schema',
    },
  ]),
)[0] as Combination;

const TEXT: Combination = {
  ...CHAT,
  id: 'workers-ai/smoke-text',
  response_shape: 'text',
  max_output_param: { name: 'max_tokens', source: 'test' },
} as Combination;

const DAY = '2026-11-07';

interface Sent {
  readonly body: { messages: { role: string; content: string }[]; [k: string]: unknown };
}

const chatBody = (content: string | null, finish = 'stop'): string =>
  JSON.stringify({ success: true, errors: [], result: { choices: [{ message: { role: 'assistant', content }, finish_reason: finish }], usage: { prompt_tokens: 50, completion_tokens: 8 } } });

function rig(fetchImpl?: (n: number, sent: Sent) => { status: number; body: string }) {
  const env = makeEnv();
  const sent: Sent[] = [];
  const fetch: FetchLike = (_url, init) => {
    const body = JSON.parse(init.body) as Sent['body'];
    const call: Sent = { body };
    sent.push(call);
    const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
    const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
    const r = fetchImpl !== undefined ? fetchImpl(sent.length - 1, call) : { status: 200, body: chatBody(defaultAnswer({ system, user })) };
    return Promise.resolve({ status: r.status, text: () => Promise.resolve(r.body) });
  };
  let envReads = 0;
  const loadEnv = (): WorkersAiEnv => {
    envReads += 1;
    return { token: new Secret('tok-SECRET-0001'), accountId: new Secret('acct-SECRET-0002') };
  };
  let t = Date.parse(`${DAY}T10:00:00.000Z`);
  const base = env.deps(createFakeRuntime());
  const deps: SmokeDeps = {
    paths: base.paths,
    pinnedManifestHash: base.pinnedManifestHash,
    combinations: [FAKE_COMBO, WORKERS_COMBO, CHAT, TEXT],
    fetch,
    loadEnv,
    now: () => (t += 1000),
  };
  return { env, deps, sent, envReads: () => envReads, root: env.root };
}

const records = (r: ReturnType<typeof rig>) => readSmoke(smokeFileOf(r.deps.paths, DAY));
const counter = (r: ReturnType<typeof rig>) => JSON.parse(fs.readFileSync(r.deps.paths.budgetFile, 'utf8')) as { days: Record<string, { requests: number; smoke: number; neurons: number }> };

test('parseSmokeArgs: defaults, bounds and the --max-tokens rule', () => {
  assert.deepEqual(parseSmokeArgs(['--combo', 'x']), { ok: true, options: { combo: 'x', count: 1, task: null, diagnose: false, timeoutMs: undefined, maxTokens: null } });
  assert.equal(parseSmokeArgs(['--combo', 'x', '--task', 'S']).ok, true);
  assert.equal(parseSmokeArgs(['--combo', 'x', '--task', 'Q']).ok, false);
  assert.equal(parseSmokeArgs(['--combo', 'x', '--task', 'S', '--max-tokens', '5']).ok, false);
  assert.equal(parseSmokeArgs([]).ok, false);
  assert.equal(parseSmokeArgs(['--combo', 'x', '--count', '0']).ok, false);
  assert.equal(parseSmokeArgs(['--combo', 'x', '--count', '1.5']).ok, false);
  assert.equal(parseSmokeArgs(['--combo', 'x', '--count', '2', '--max-tokens', '5']).ok, false);
  assert.equal(parseSmokeArgs(['--combo', 'x', '--max-tokens', '5']).ok, true);
  assert.equal(parseSmokeArgs(['--combo', 'x', 'extra']).ok, false);
});

test('checkResponseShape: chat, text, mismatch and not_checked', () => {
  assert.equal(checkResponseShape('chat', 200, chatBody('hi')).check, 'ok');
  assert.equal(checkResponseShape('chat', 200, chatBody(null)).check, 'ok');
  assert.equal(checkResponseShape('chat', 200, JSON.stringify({ success: true, result: { response: 'hi' } })).check, 'mismatch');
  assert.equal(checkResponseShape('chat', 200, JSON.stringify({ result: { choices: [{ message: { content: 'x' } }] } })).check, 'mismatch');
  assert.equal(checkResponseShape('chat', 200, JSON.stringify({ result: { choices: [{ message: { content: { a: 1 } }, finish_reason: 'stop' }] } })).check, 'mismatch');
  assert.equal(checkResponseShape('text', 200, JSON.stringify({ result: { response: 'hi' } })).check, 'ok');
  assert.equal(checkResponseShape('text', 200, JSON.stringify({ result: { response: { option: 'a' } } })).check, 'mismatch');
  assert.equal(checkResponseShape('text', 200, chatBody('hi')).check, 'mismatch');
  assert.equal(checkResponseShape('chat', 200, 'not json').check, 'mismatch');
  assert.equal(checkResponseShape('chat', 429, '{}').check, 'not_checked');
  assert.equal(checkResponseShape('chat', null, null).check, 'not_checked');
  assert.equal(finishReasonOf(chatBody('x', 'length')), 'length');
  assert.equal(finishReasonOf('nope'), null);
});

test('two invocations count against the same daily allowance; the third is refused at the cap', async () => {
  const r = rig();
  const a = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '4'], r.deps));
  assert.equal(a.value, 0);
  assert.equal(r.sent.length, 4);
  const b = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '6'], r.deps));
  assert.equal(b.value, 0);
  assert.equal(r.sent.length, 10);
  assert.equal(counter(r).days[DAY]?.smoke, 10);
  assert.equal(counter(r).days[DAY]?.requests, 10);
  const c = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1'], r.deps));
  assert.equal(c.value, 1);
  assert.match(c.err, /1 Smoke_Call\(s\) requested, 0 left of the 10/);
  assert.equal(r.sent.length, 10, 'nothing sent at the cap');
  assert.equal(records(r).length, 10);
});

test('count above the remaining allowance is refused before anything is sent', async () => {
  const r = rig();
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '7'], r.deps));
  const sentBefore = r.sent.length;
  const out = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '4'], r.deps));
  assert.equal(out.value, 1);
  assert.match(out.err, /4 Smoke_Call\(s\) requested, 3 left/);
  assert.equal(r.sent.length, sentBefore);
  assert.equal(counter(r).days[DAY]?.smoke, 7);
});

test('records land only in the smoke file, with the fields the phase gate reads', async () => {
  const r = rig();
  const out = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '4'], r.deps));
  assert.equal(out.value, 0);
  const recs = records(r);
  assert.equal(recs.length, 4);
  for (const rec of recs) {
    assert.equal(rec['schema'], 'llm-probe-smoke-v1');
    assert.equal(rec['combination'], CHAT.id);
    assert.equal(rec['shape_check'], 'ok');
    assert.equal(rec['declared_shape'], 'chat');
    assert.equal(rec['http_status'], 200);
    assert.equal(rec['max_tokens_override'], null);
  }
  // Alternating D, S, D, S in file order.
  assert.deepEqual(recs.map((x) => x['task']), ['decision', 'synthesis', 'decision', 'synthesis']);
  // Nothing outside eval/results/smoke and the budget counter was written.
  const written = fs.readdirSync(path.join(r.root, 'eval/results'));
  assert.deepEqual(written.sort(), ['budget', 'smoke']);
  assert.deepEqual(fs.readdirSync(path.join(r.root, 'eval/results/smoke')), [`${DAY}.jsonl`]);
});

test('the same calls pick the same cards every time (deterministic order)', async () => {
  const a = rig();
  const b = rig();
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '5'], a.deps));
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '5'], b.deps));
  assert.deepEqual(records(a).map((x) => x['card_id']), records(b).map((x) => x['card_id']));
});

test('a shape mismatch is recorded with the declared shape and the HTTP status', async () => {
  const r = rig(() => ({ status: 200, body: JSON.stringify({ success: true, result: { response: 'x', usage: { prompt_tokens: 5, completion_tokens: 1 } } }) }));
  const out = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '2'], r.deps));
  assert.equal(out.value, 0);
  const recs = records(r);
  assert.ok(recs.every((x) => x['shape_check'] === 'mismatch' && x['declared_shape'] === 'chat' && x['http_status'] === 200));
  assert.match(out.out, /shape mismatches 2/);
});

test('an HTTP error records the status and leaves shape_check out', async () => {
  const r = rig(() => ({ status: 429, body: JSON.stringify({ success: false, errors: [{ code: 3040 }] }) }));
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1'], r.deps));
  const [rec] = records(r);
  assert.equal(rec?.['http_status'], 429);
  assert.equal(rec?.['outcome'], 'rate_limited');
  assert.equal('shape_check' in (rec ?? {}), false);
  assert.equal(rec?.['verdict'], 'illegal');
  assert.equal(counter(r).days[DAY]?.smoke, 1, 'a failed call still counts');
});

test('the text shape is checked on result.response', async () => {
  const r = rig((_n, s) => {
    const user = s.body.messages.find((m) => m.role === 'user')?.content ?? '';
    return { status: 200, body: JSON.stringify({ success: true, result: { response: defaultAnswer({ system: '', user }), usage: { prompt_tokens: 5, completion_tokens: 3 } } }) };
  });
  await capture(() => smokeCommand(['--combo', TEXT.id, '--count', '1'], r.deps));
  const [rec] = records(r);
  assert.equal(rec?.['shape_check'], 'ok');
  assert.equal(rec?.['declared_shape'], 'text');
  assert.equal(r.sent[0]?.body['max_tokens'] !== undefined, true);
});

test('console output names the model, the count, the allowance and Card IDs only', async () => {
  const r = rig();
  const out = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '3'], r.deps));
  assert.match(out.out, /model @cf\/fake\/chat-model/);
  assert.match(out.out, /will send 3 Smoke_Call\(s\); remaining daily allowance 10 of 10/);
  for (const call of r.sent) {
    for (const m of call.body.messages) {
      for (const piece of m.content.split('\n').filter((l) => l.trim().length > 20)) {
        assert.equal((out.out + out.err).includes(piece), false, 'no prompt line is printed');
      }
    }
  }
  const ids = new Set(records(r).map((x) => String(x['card_id'])));
  for (const line of out.out.split('\n').filter((l) => l.includes(' outcome='))) {
    assert.ok([...ids].some((id) => line.includes(id)));
  }
});

test('only Dev_Cards are rendered', async () => {
  const r = rig();
  renderPromptCalls.length = 0;
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '4'], r.deps));
  assert.ok(renderPromptCalls.length > 0);
  for (const id of renderPromptCalls) assert.ok(r.env.cards.devIds.includes(id as string), `${String(id)} is a Dev_Card`);
  assert.ok(renderPromptCalls.every((id) => !r.env.cards.lockedIds.includes(id as string)));
});

test('browser Combinations and unknown Combinations are refused; nothing is read or sent', async () => {
  const r = rig();
  const out = await capture(() => smokeCommand(['--combo', FAKE_COMBO.id, '--count', '1'], r.deps));
  assert.equal(out.value, 1);
  assert.match(out.err, /not a Workers AI Combination/);
  const unknown = await capture(() => smokeCommand(['--combo', 'nope/none'], r.deps));
  assert.equal(unknown.value, 2);
  assert.equal(r.sent.length, 0);
  assert.equal(r.envReads(), 0, 'the env file is not read');
  assert.equal(fs.existsSync(r.deps.paths.budgetFile), false);
});

test('a missing env stops the command before any request, record or counter write', async () => {
  const r = rig();
  const deps: SmokeDeps = { ...r.deps, loadEnv: () => { throw new EnvError('probe: env: file "env" is missing or unreadable'); } };
  const out = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1'], deps));
  assert.equal(out.value, 1);
  assert.match(out.err, /file "env" is missing or unreadable/);
  assert.equal(r.sent.length, 0);
  assert.equal(fs.existsSync(smokeFileOf(r.deps.paths, DAY)), false);
  assert.equal(fs.existsSync(r.deps.paths.budgetFile), false);
});

test('an unreadable budget counter stops the command before any request, file untouched', async () => {
  const r = rig();
  fs.mkdirSync(path.dirname(r.deps.paths.budgetFile), { recursive: true });
  fs.writeFileSync(r.deps.paths.budgetFile, '{"schema":"llm-probe-budget-v1","days":{"2026-11-07":{"requests":1,"smoke":1}}}');
  const before = fs.readFileSync(r.deps.paths.budgetFile, 'utf8');
  const out = await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1'], r.deps));
  assert.equal(out.value, 1);
  assert.equal(r.sent.length, 0);
  assert.equal(fs.readFileSync(r.deps.paths.budgetFile, 'utf8'), before);
});

test('--max-tokens: one D call with the override sent and recorded', async () => {
  const r = rig();
  const bad = await capture(() => smokeCommand(['--combo', TEXT.id, '--count', '2', '--max-tokens', '5'], r.deps));
  assert.equal(bad.value, 2);
  assert.equal(r.sent.length, 0);
  const tooBig = await capture(() => smokeCommand(['--combo', TEXT.id, '--max-tokens', '65'], r.deps));
  assert.equal(tooBig.value, 1);
  assert.equal(r.sent.length, 0);
  const ok = await capture(() => smokeCommand(['--combo', TEXT.id, '--count', '1', '--max-tokens', '5'], r.deps));
  assert.equal(ok.value, 0);
  assert.equal(r.sent[0]?.body['max_tokens'], 5);
  const [rec] = records(r);
  assert.equal(rec?.['max_tokens_override'], 5);
  assert.equal(rec?.['task'], 'decision');
});

test('the budget counter holds the usage-based neurons after a response with usage', async () => {
  const r = rig();
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1'], r.deps));
  // usage 50 in + 8 out at 1000 / 2000 per million = ceil(66000 / 1e6) = 1
  assert.equal(counter(r).days[DAY]?.neurons, 1);
});

// ---------------------------------------------------------------- --diagnose (names and numbers only)

const REASONING_BODY = JSON.stringify({
  success: true,
  errors: [],
  result: {
    choices: [{ message: { role: 'assistant', content: 'SECRET-TEXT-VALUE', reasoning_content: 'SECRET-THOUGHTS' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 50, completion_tokens: 8, total_tokens: 58, completion_tokens_details: { reasoning_tokens: 3 }, note: 'not a number' },
  },
});

test('responseKeysOf and usageDetailOf return key names and numbers, never values', () => {
  const keys = responseKeysOf(REASONING_BODY);
  assert.deepEqual(keys, { top: ['errors', 'result', 'success'], result: ['choices', 'usage'], choice: ['finish_reason', 'message'], message: ['content', 'reasoning_content', 'role'] });
  assert.deepEqual(usageDetailOf(REASONING_BODY), { 'completion_tokens': 8, 'completion_tokens_details.reasoning_tokens': 3, 'prompt_tokens': 50, 'total_tokens': 58 });
  assert.equal(JSON.stringify(keys).includes('SECRET'), false);
  assert.equal(responseKeysOf('nope'), null);
  assert.equal(usageDetailOf('{"result":{}}'), null);
  assert.equal(responseKeysOf(null), null);
});

test('--diagnose adds response_keys and usage_detail to the smoke record; off by default', async () => {
  const on = rig(() => ({ status: 200, body: REASONING_BODY }));
  assert.equal((await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1', '--diagnose'], on.deps))).value, 0);
  const [rec] = records(on);
  assert.deepEqual(rec?.['response_keys'], { top: ['errors', 'result', 'success'], result: ['choices', 'usage'], choice: ['finish_reason', 'message'], message: ['content', 'reasoning_content', 'role'] });
  assert.deepEqual(rec?.['usage_detail'], { 'completion_tokens': 8, 'completion_tokens_details.reasoning_tokens': 3, 'prompt_tokens': 50, 'total_tokens': 58 });
  const raw = fs.readFileSync(smokeFileOf(on.deps.paths, DAY), 'utf8');
  assert.equal(raw.includes('SECRET-TEXT-VALUE') || raw.includes('SECRET-THOUGHTS'), false);

  const off = rig(() => ({ status: 200, body: REASONING_BODY }));
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1'], off.deps));
  const [plain] = records(off);
  assert.equal('response_keys' in (plain ?? {}), false);
  assert.equal('usage_detail' in (plain ?? {}), false);
});

// ---------------------------------------------------------------- --diagnose on an HTTP error

const ERR_BODY = JSON.stringify({ success: false, errors: [{ code: 5006, message: `bad schema ${'x'.repeat(400)} tok-SECRET-0001` }], messages: [], result: null });

test('apiErrorOf: first code and message text of a non-2xx body, truncated; null for 2xx', () => {
  const e = apiErrorOf(400, ERR_BODY);
  assert.equal(e?.code, '5006');
  assert.equal(e?.message?.length, 300);
  assert.deepEqual(apiErrorOf(400, 'not json'), { code: null, message: null });
  assert.deepEqual(apiErrorOf(400, JSON.stringify({ errors: [] })), { code: null, message: null });
  assert.equal(apiErrorOf(200, ERR_BODY), null);
  assert.equal(apiErrorOf(null, null), null);
});

test('requestFactsOf: names and numbers only, no prompt text', () => {
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'PROMPT-TEXT' }], max_completion_tokens: 1024, response_format: { type: 'json_schema', json_schema: { a: 1 } }, chat_template_kwargs: { enable_thinking: false } });
  const f = requestFactsOf(body, 777);
  assert.deepEqual(f, { response_format_sent: true, response_format_type: 'json_schema', chat_template_kwargs_sent: true, prompt_bytes: 777, max_tokens_param: 'max_completion_tokens', max_tokens_value: 1024 });
  assert.equal(JSON.stringify(f).includes('PROMPT-TEXT'), false);
  assert.deepEqual(requestFactsOf(JSON.stringify({ max_tokens: 5 }), 1), { response_format_sent: false, response_format_type: null, chat_template_kwargs_sent: false, prompt_bytes: 1, max_tokens_param: 'max_tokens', max_tokens_value: 5 });
  assert.equal(requestFactsOf(null, 1), null);
  assert.equal(requestFactsOf('nope', 1), null);
});

test('--diagnose records api_error (redacted, 300 chars) and request_facts on a 400; --task S sends exactly one S call', async () => {
  const r = rig(() => ({ status: 400, body: ERR_BODY }));
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1', '--task', 'S', '--diagnose'], r.deps));
  assert.equal(r.sent.length, 1);
  const [rec] = records(r);
  assert.equal(rec?.['task'], 'synthesis');
  assert.equal(rec?.['http_status'], 400);
  const api = rec?.['api_error'] as { code: string; message: string };
  assert.equal(api.code, '5006');
  assert.ok(api.message.length <= 300);
  const facts = rec?.['request_facts'] as Record<string, unknown>;
  assert.equal(facts['response_format_sent'], true);
  assert.equal(facts['response_format_type'], 'json_schema');
  assert.equal(facts['max_tokens_value'], 1024);
  assert.equal(facts['chat_template_kwargs_sent'], true);
  assert.equal(typeof facts['prompt_bytes'], 'number');
  const raw = fs.readFileSync(smokeFileOf(r.deps.paths, DAY), 'utf8');
  assert.equal(raw.includes('tok-SECRET-0001'), false);

  const off = rig(() => ({ status: 400, body: ERR_BODY }));
  await capture(() => smokeCommand(['--combo', CHAT.id, '--count', '1', '--task', 'S'], off.deps));
  assert.equal('api_error' in (records(off)[0] ?? {}), false);
});
