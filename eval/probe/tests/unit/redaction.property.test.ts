// Property 27: the token and account ID never leave env.ts unredacted.
// Task 17.3 extends this with the real Workers AI adapter on a fake fetch.
// Uses a fake env reader; never reads the real root `env` file.
// **Validates: Requirements 11.3, 11.4**
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { inspect } from 'node:util';
import fc from 'fast-check';
import { createFakeClock } from '../../src/adapters/fake.ts';
import type { DecisionAdapter, DecisionRequest, Prompt, RequestOptions } from '../../src/adapters/interface.ts';
import { createSystemOneRuntime } from '../../src/adapters/system-one.ts';
import {
  createWorkersAiRuntime,
  toBudgetUsage,
  WORKERS_AI_REVISION,
  workersAiPrices,
  type FetchLike,
  type FetchResponseLike,
} from '../../src/adapters/workers-ai.ts';
import { BudgetSession, isRefusal } from '../../src/budget.ts';
import { ACCOUNT_VARIABLE, EnvError, loadWorkersAiEnv, TOKEN_VARIABLE } from '../../src/env.ts';
import { appendAbort, appendResume, appendStart } from '../../src/ledger.ts';
import type { Combination } from '../../src/phase.ts';
import { appendFailure, ResultsWriter, SCHEMA, type Late, type ModelKey, type Outcome, type Usage as ResultUsage } from '../../src/results.ts';
import { REDACTED, Secret, secretVariants } from '../../src/redact.ts';
import { comboWith } from './system-one.helpers.ts';
import {
  appendTextFile,
  clearSecrets,
  printErrorLine,
  printLine,
  registerSecrets,
  scrub,
  writeTextFile,
  writeTextFileAtomic,
} from '../../src/sink.ts';

const SECRET_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./+= :';
const secretArb = fc
  .string({ unit: fc.constantFrom(...SECRET_CHARS), minLength: 12, maxLength: 40 })
  .filter((s) => s.trim() === s && !REDACTED.includes(s));
const pairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(secretArb, secretArb)
  .filter(([a, b]) => !a.includes(b) && !b.includes(a));

const SAFE = fc.string({ unit: fc.constantFrom(...'ghjkmnpqrstuvwxyz GHJKMNPQRSTUVWXYZ:,.!?'), maxLength: 20 });

type Form = 'raw' | 'component' | 'uri';
const formArb = fc.constantFrom<Form>('raw', 'component', 'uri');
const shape = (s: string, f: Form): string =>
  f === 'raw' ? s : f === 'component' ? encodeURIComponent(s) : encodeURI(s);

/** Remote error text that embeds both secrets in assorted shapes. */
function remoteTextArb(token: string, account: string) {
  return fc
    .tuple(SAFE, SAFE, formArb, formArb, fc.constantFrom('url', 'bearer', 'inline', 'path', 'json'))
    .map(([a, b, fa, fb, kind]) => {
      const acc = shape(account, fa);
      const tok = shape(token, fb);
      switch (kind) {
        case 'url':
          return `${a} https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/meta/model ${b}`;
        case 'bearer':
          return `${a} Authorization: Bearer ${tok} ${b}`;
        case 'path':
          return `${a}/client/v4/accounts/${acc}/ai/run/x?token=${tok}${b}`;
        case 'json':
          return JSON.stringify({ error: `${a}${acc}${b}`, t: tok });
        default:
          return `${a}${acc}${tok}${acc}${b}`;
      }
    });
}

const outcomeArb = fc.constantFrom('success', 'http-error', 'rate-limit', 'timeout', 'thrown');

let tmp: string;
let out: string[];
let err: string[];
let origOut: typeof process.stdout.write;
let origErr: typeof process.stderr.write;

beforeEach(() => {
  clearSecrets();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redaction-'));
  out = [];
  err = [];
  origOut = process.stdout.write;
  origErr = process.stderr.write;
  // Capture stdout/stderr (the sink writes through process.stdout/stderr).
  process.stdout.write = ((s: string | Uint8Array) => (out.push(String(s)), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => (err.push(String(s)), true)) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = origOut;
  process.stderr.write = origErr;
  clearSecrets();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const leaks = (text: string, secrets: string[]): boolean =>
  secrets.some((s) => secretVariants(s).some((v) => text.includes(v)));

describe('Property 27: redaction at the sink', () => {
  test('nothing written to stdout, stderr or files contains either secret', () => {
    fc.assert(
      fc.property(
        pairArb.chain(([token, account]) =>
          fc.tuple(
            fc.constant(token),
            fc.constant(account),
            fc.array(fc.tuple(outcomeArb, remoteTextArb(token, account)), { minLength: 1, maxLength: 5 }),
          ),
        ),
        ([token, account, outcomes]) => {
          out.length = 0;
          err.length = 0;
          clearSecrets();
          registerSecrets(new Secret(token), new Secret(account));
          const dir = fs.mkdtempSync(path.join(tmp, 'c-'));
          outcomes.forEach(([kind, text], i) => {
            printLine(`${kind}: ${text}`);
            printErrorLine(`${kind}: ${text}`);
            writeTextFile(path.join(dir, `w${i}.txt`), text);
            appendTextFile(path.join(dir, 'log.jsonl'), `${JSON.stringify({ kind, text })}\n`);
            writeTextFileAtomic(path.join(dir, `a${i}.json`), JSON.stringify({ kind, text }));
            assert.equal(leaks(scrub(text), [token, account]), false);
          });
          const all = [...out, ...err];
          for (const f of fs.readdirSync(dir)) all.push(fs.readFileSync(path.join(dir, f), 'utf8'));
          for (const s of all) assert.equal(leaks(s, [token, account]), false);
          // Each embedded occurrence became [redacted].
          assert.ok(out.join('').includes(REDACTED));
        },
      ),
      { numRuns: 100 },
    );
  });

  test('secrets embedded inside longer strings and path substrings are replaced in place', () => {
    fc.assert(
      fc.property(pairArb, SAFE, SAFE, ([token, account], pre, post) => {
        registerSecrets(token, account);
        const text = `${pre}https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${token}${post}`;
        const scrubbed = scrub(text);
        assert.equal(scrubbed, `${pre}https://api.cloudflare.com/client/v4/accounts/${REDACTED}/ai/run/${REDACTED}${post}`);
        clearSecrets();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------- task 17.3: the real Workers AI adapter in the loop

type Scenario =
  | 'ok_text'
  | 'http_400'
  | 'http_429'
  | 'http_500_html'
  | 'invalid_json'
  | 'network_reject'
  | 'non_error_throw'
  | 'sync_throw'
  | 'text_reject'
  | 'echo_url'
  | 'timeout';
const scenarioArb = fc.constantFrom<Scenario>(
  'ok_text', 'http_400', 'http_429', 'http_500_html', 'invalid_json', 'network_reject', 'non_error_throw', 'sync_throw', 'text_reject', 'echo_url', 'timeout',
);

const WAI_COMBO = {
  id: 'wai-redaction',
  runtime: 'workers-ai',
  model_id: '@cf/fake/model',
  quantization: 'n/a',
  revision: WORKERS_AI_REVISION,
  phase1_locked: false,
  response_shape: 'chat',
  max_output_param: { name: 'max_tokens', source: 'x' },
  prices: { input: 100, output: 200, source: 'x', read_on: '2026-11-06' },
} as unknown as Combination;
const WAI_OPTS: RequestOptions = {
  timeoutMs: 5000,
  sampling: { temperature: 0, topP: null, maxOutputTokens: 64, seed: null, chatTemplateKwargs: null, constraint: { kind: 'none' } },
};
const WAI_PROMPT: Prompt = { system: 'sys', user: 'usr' };

/** A fake fetch whose responses and failures echo the URL (account ID), the header (token) and generated remote text. */
function leakyFetch(scenario: Scenario, text: string): FetchLike {
  return (url, init) => {
    const echoed = `${text} ${url} ${init.headers['Authorization'] ?? ''}`;
    const respond = (status: number, body: string): Promise<FetchResponseLike> => Promise.resolve({ status, text: () => Promise.resolve(body) });
    const errors = (code: unknown) => JSON.stringify({ success: false, errors: [{ code, message: echoed }] });
    switch (scenario) {
      case 'ok_text':
        return respond(200, JSON.stringify({ success: true, result: { choices: [{ message: { content: echoed }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 6 } } }));
      case 'http_400':
        return respond(400, errors(echoed));
      case 'http_429':
        return respond(429, errors(1234));
      case 'http_500_html':
        return respond(500, `<html>${echoed}</html>`);
      case 'invalid_json':
        return respond(200, `{"result": ${echoed}`);
      case 'network_reject':
        return Promise.reject(Object.assign(new Error(echoed), { name: echoed.replace(/\s/g, '_') }));
      case 'non_error_throw':
        return Promise.reject(echoed);
      case 'sync_throw':
        throw new Error(echoed);
      case 'text_reject':
        return Promise.resolve({ status: 200, text: () => Promise.reject(new Error(echoed)) });
      case 'echo_url':
        return respond(403, errors(url));
      case 'timeout':
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error(echoed)));
        });
    }
  };
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

describe('Property 27: the real Workers AI adapter and factory in the loop (task 17.3)', () => {
  test('stdout, stderr, Results, ledger, budget counter, failure records and thrown messages hold neither secret', async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb.filter(([t, a]) => [t, a].every((v) => !/['"#\\]/.test(v))),
        fc.array(fc.tuple(scenarioArb, SAFE, formArb, formArb), { minLength: 1, maxLength: 4 }),
        async ([token, account], scenarios) => {
          out.length = 0;
          err.length = 0;
          clearSecrets();
          const thrown: string[] = [];
          const dir = fs.mkdtempSync(path.join(tmp, 'w-'));
          const mk = (file: string) => path.join(dir, file);
          const makeEnv = () => loadWorkersAiEnv({ readFile: () => `${TOKEN_VARIABLE}=${token}\n${ACCOUNT_VARIABLE}=${account}\n`, envPath: '/fake/env' });
          const probeEnv = makeEnv();
          fc.pre(probeEnv.token.reveal() === token && probeEnv.accountId.reveal() === account);

          const ledgerFile = mk('ledger.jsonl');
          const budget = BudgetSession.open({ file: mk('budget.json'), now: () => Date.UTC(2026, 10, 7, 9) });
          let writer: ResultsWriter | null = null;
          let started = false;

          for (const [i, [scenario, safe, fa, fb]] of scenarios.entries()) {
            const clock = createFakeClock();
            const factory = createWorkersAiRuntime({ loadEnv: makeEnv, fetch: leakyFetch(scenario, `${safe}${shape(account, fa)} ${shape(token, fb)}`), clock });
            const handle = await factory({ combo: WAI_COMBO, kind: 'dev', resume: false, timeoutMs: 5000 } as never);
            const fingerprint = handle.fingerprint ?? {};
            if (writer === null) {
              writer = ResultsWriter.create(dir, {
                schema: SCHEMA.header, run_id: 'wai', split: 'dev', combination: WAI_COMBO.id,
                model_key: { runtime: 'workers-ai', model_id: WAI_COMBO.model_id, quantization: 'n/a', revision: WORKERS_AI_REVISION },
                task_subset: 'D', fingerprint, template_hashes: { 'decision.v1': 'ab' }, timeout_ms: 5000, placement: null,
              });
            }
            if (!started) {
              appendStart(ledgerFile, {
                entry_id: 'E1', model_key: writer.header.model_key as ModelKey, combination: WAI_COMBO.id, task_subset: 'D', fingerprint,
                template_hashes: { 'decision.v1': 'ab' }, started_at: '2026-11-07T09:00:00.000Z', approval: null, planned: { decision: 4 },
              });
              started = true;
            }
            const reservation = budget.reserve({ smoke: false, estimate: 50 });
            assert.ok(!isRefusal(reservation));

            const pending = handle.adapter.complete(WAI_PROMPT, WAI_OPTS);
            if (scenario === 'timeout') await clock.advance(WAI_OPTS.timeoutMs);
            const res = await pending;
            if (!isRefusal(reservation)) budget.settle(reservation, res.kind === 'text' || res.kind === 'error' ? toBudgetUsage(res.usage ?? { inputTokens: 1, outputTokens: 1, reasoningTokens: null }) : null, workersAiPrices(WAI_COMBO));

            let outcome: Outcome;
            let late: Late | null = null;
            let usage: ResultUsage | null = null;
            let latency: number;
            if (res.kind === 'text') {
              outcome = { kind: 'text', text: res.text };
              latency = res.latencyMs;
              usage = res.usage === null ? null : { input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens, reasoning_tokens: res.usage.reasoningTokens };
            } else if (res.kind === 'error') {
              outcome = { kind: 'error', code: res.code, detail: res.detail, remote: res.remote !== null };
              latency = res.elapsedMs;
              printErrorLine(`${res.code}: ${res.detail} ${JSON.stringify(res.remote)}`);
              appendFailure(mk('failures.jsonl'), { schema: SCHEMA.failure, combination: WAI_COMBO.id, kind: res.code, detail: res.detail, remote: JSON.stringify(res.remote) });
              appendAbort(ledgerFile, 'E1', '2026-11-07T09:10:00.000Z', `${res.code}: ${res.detail}`);
              appendResume(ledgerFile, 'E1', '2026-11-07T09:11:00.000Z', {
                model_key: writer.header.model_key as ModelKey, fingerprint, template_hashes: { 'decision.v1': 'ab' },
              });
            } else {
              assert.deepEqual(await res.late, { kind: 'none', reason: 'aborted' });
              outcome = { kind: 'timeout' };
              late = { kind: 'none', reason: 'aborted' };
              latency = res.elapsedMs;
            }
            printLine(JSON.stringify(outcome));
            writer.append({
              schema: SCHEMA.result, run_id: 'wai', split: 'dev', card_id: `D-x-${String(i).padStart(3, '0')}`, permutation: 'base', outcome, latency_ms: latency,
              timeout_ms: 5000, requested_at: '2026-11-07T09:00:00.000Z', template_hash: 'ab', fingerprint_id: writer.fingerprintId, usage, late, source: 'node',
            });
            // A record that fails validation throws; its message must be clean too.
            try {
              writer.append({
                schema: SCHEMA.result, run_id: 'wai', split: 'dev', card_id: 'D-x-999', permutation: 'base', outcome: { kind: 'text', text: JSON.stringify(res) }, latency_ms: 1,
                timeout_ms: 5000, requested_at: '2026-11-07T09:00:00.000Z', template_hash: 'ab', fingerprint_id: writer.fingerprintId, usage: null,
                late: { kind: 'none', reason: 'aborted' }, source: 'node',
              });
            } catch (e) {
              thrown.push(e instanceof Error ? e.message : String(e));
            }
          }

          // A run with a missing variable prints only the variable name.
          clearSecrets();
          const missingToken = createWorkersAiRuntime({
            loadEnv: () => loadWorkersAiEnv({ readFile: () => `# ${token}\n${ACCOUNT_VARIABLE}=${account}\n`, envPath: '/fake/env' }),
          });
          await assert.rejects(missingToken({ combo: WAI_COMBO, kind: 'dev', resume: false, timeoutMs: 5000 } as never), (e: unknown) => {
            assert.ok(e instanceof EnvError);
            thrown.push(e.message);
            return true;
          });
          const missingMsg = err.join('');
          assert.ok(missingMsg.includes(TOKEN_VARIABLE));

          const all = [...out, ...err, ...thrown, ...listFiles(dir).map((f) => fs.readFileSync(f, 'utf8'))];
          for (const s of all) assert.equal(leaks(s, [token, account]), false);
          assert.ok(listFiles(dir).some((f) => f.endsWith('budget.json')));
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------- task 29.9: the System_One adapter in the loop

/** The leaky fetch of the chat loop, except that a successful answer is a System One body that echoes the generated text. */
function leakySystemOneFetch(scenario: Scenario, text: string): FetchLike {
  const chat = leakyFetch(scenario, text);
  return (url, init) => {
    if (scenario !== 'ok_text') return chat(url, init);
    const echoed = `${text} ${url} ${init.headers['Authorization'] ?? ''}`;
    const body = JSON.stringify({
      success: true,
      result: { model: 'clef-flash', answers: { decision: { type: 'choice', choice: echoed, probabilities: { a: 1 }, confidence: 1 } }, usage: { input_tokens: 100, output_tokens: 6 } },
    });
    return Promise.resolve({ status: 200, text: () => Promise.resolve(body) });
  };
}

describe('Property 27: the System_One adapter and factory in the loop (task 29.9)', () => {
  test('stdout, stderr, Results (with the verbatim body), budget counter and thrown messages hold neither secret', async () => {
    const combo = comboWith({ window: 65536, k: 1000 });
    const request: DecisionRequest = { kind: 'decision', state: 'Today is day 3.', instructions: 'Choose.', questionId: 'decision', options: [{ id: 'keep', label: 'Keep' }, { id: 'sell', label: 'Sell' }] };
    await fc.assert(
      fc.asyncProperty(
        pairArb.filter(([t, a]) => [t, a].every((v) => !/['"#\\]/.test(v))),
        fc.array(fc.tuple(scenarioArb, SAFE, formArb, formArb), { minLength: 1, maxLength: 4 }),
        async ([token, account], scenarios) => {
          out.length = 0;
          err.length = 0;
          clearSecrets();
          const dir = fs.mkdtempSync(path.join(tmp, 's1-'));
          const makeEnv = () => loadWorkersAiEnv({ readFile: () => `${TOKEN_VARIABLE}=${token}\n${ACCOUNT_VARIABLE}=${account}\n`, envPath: '/fake/env' });
          const probeEnv = makeEnv();
          fc.pre(probeEnv.token.reveal() === token && probeEnv.accountId.reveal() === account);
          const budget = BudgetSession.open({ file: path.join(dir, 'budget.json'), now: () => Date.UTC(2026, 10, 10, 9) });
          let writer: ResultsWriter | null = null;
          for (const [i, [scenario, safe, fa, fb]] of scenarios.entries()) {
            const clock = createFakeClock();
            const factory = createSystemOneRuntime({ loadEnv: makeEnv, fetch: leakySystemOneFetch(scenario, `${safe}${shape(account, fa)} ${shape(token, fb)}`), clock });
            const handle = await factory({ combo, kind: 'dev', resume: false, timeoutMs: 5000 } as never);
            const fingerprint = handle.fingerprint ?? {};
            assert.equal(leaks(JSON.stringify(fingerprint), [token, account]), false);
            writer ??= ResultsWriter.create(dir, {
              schema: SCHEMA.header, run_id: 'so', split: 'dev', combination: combo.id,
              model_key: { runtime: 'workers-ai', model_id: combo.model_id, quantization: '', revision: WORKERS_AI_REVISION },
              task_subset: 'D', fingerprint, template_hashes: { decision: 'ab' }, timeout_ms: 5000, placement: null,
            });
            const reservation = budget.reserve({ smoke: false, estimate: 5 });
            assert.ok(!isRefusal(reservation));
            const adapter = handle.adapter as DecisionAdapter;
            const pending = adapter.complete(request, { timeoutMs: 5000 });
            if (scenario === 'timeout') await clock.advance(5000);
            const res = await pending;
            if (!isRefusal(reservation)) budget.settleSystemOne(reservation, res.kind === 'text' || res.kind === 'error' ? (res.usage?.inputTokens ?? null) : null, combo.prices.input);

            let outcome: Outcome;
            let late: Late | null = null;
            let usage: ResultUsage | null = null;
            let latency: number;
            let system_one: { response_text: string; usage_reported: boolean } | undefined;
            if (res.kind === 'text') {
              outcome = { kind: 'text', text: res.text };
              latency = res.latencyMs;
              usage = res.usage === null ? null : { input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens, reasoning_tokens: res.usage.reasoningTokens };
              if (res.systemOne !== undefined) system_one = { response_text: res.systemOne.responseText, usage_reported: res.systemOne.usageReported };
            } else if (res.kind === 'error') {
              outcome = { kind: 'error', code: res.code, detail: res.detail, remote: res.remote !== null };
              latency = res.elapsedMs;
              printErrorLine(`${res.code}: ${res.detail} ${JSON.stringify(res.remote)}`);
              if (res.systemOne !== undefined) system_one = { response_text: res.systemOne.responseText, usage_reported: res.systemOne.usageReported };
            } else {
              assert.deepEqual(await res.late, { kind: 'none', reason: 'aborted' });
              outcome = { kind: 'timeout' };
              late = { kind: 'none', reason: 'aborted' };
              latency = res.elapsedMs;
            }
            printLine(JSON.stringify(outcome));
            writer.append({
              schema: SCHEMA.result, run_id: 'so', split: 'dev', card_id: `D-x-${String(i).padStart(3, '0')}`, permutation: 'base', outcome, latency_ms: latency,
              timeout_ms: 5000, requested_at: '2026-11-10T09:00:00.000Z', template_hash: 'ab', fingerprint_id: writer.fingerprintId, usage, late, source: 'node',
              ...(system_one === undefined ? {} : { system_one }),
            });
          }
          const all = [...out, ...err, ...listFiles(dir).map((f) => fs.readFileSync(f, 'utf8'))];
          for (const text of all) assert.equal(leaks(text, [token, account]), false);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('Property 27: Secret never reveals itself', () => {
  test('JSON.stringify, String, template, inspect and error messages show [redacted]', () => {
    fc.assert(
      fc.property(secretArb, (value) => {
        const s = new Secret(value);
        const holder = { token: s, list: [s], nested: { s } };
        const rendered = [
          JSON.stringify(s),
          JSON.stringify(holder),
          String(s),
          `${s}`,
          inspect(s),
          inspect(holder, { depth: 10 }),
          inspect(holder, { showHidden: true, depth: 10 }),
          Object.keys(s).join(','),
          JSON.stringify(Object.getOwnPropertyNames(s)),
        ];
        for (const r of rendered) assert.equal(leaks(r, [value]), false);
        assert.equal(String(s), REDACTED);
        assert.equal(s.reveal(), value);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 27: env.ts errors never contain values', () => {
  const missing = (name: string, token: string, account: string, empty: boolean): string => {
    const lines = [`# comment ${token}`, `OTHER=${token}${account}`];
    if (name !== TOKEN_VARIABLE) lines.push(`${TOKEN_VARIABLE}=${token}`);
    else if (empty) lines.push(`${TOKEN_VARIABLE}=`);
    if (name !== ACCOUNT_VARIABLE) lines.push(`${ACCOUNT_VARIABLE}=${account}`);
    else if (empty) lines.push(`${ACCOUNT_VARIABLE}=`);
    return lines.join('\n');
  };

  test('missing or empty variables name only the variable and file', () => {
    fc.assert(
      fc.property(
        pairArb,
        fc.constantFrom(TOKEN_VARIABLE, ACCOUNT_VARIABLE),
        fc.boolean(),
        ([token, account], name, empty) => {
          const text = missing(name, token, account, empty);
          assert.throws(
            () => loadWorkersAiEnv({ readFile: () => text, envPath: '/fake/env' }),
            (e: unknown) => {
              assert.ok(e instanceof EnvError);
              assert.ok(e.message.includes(name));
              assert.equal(leaks(e.message, [token, account]), false);
              return true;
            },
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test('an unreadable file reports the file name only, even if the reader error echoes content', () => {
    fc.assert(
      fc.property(pairArb, ([token, account]) => {
        assert.throws(
          () =>
            loadWorkersAiEnv({
              readFile: () => {
                throw new Error(`EACCES ${token} ${account}`);
              },
              envPath: '/fake/env',
            }),
          (e: unknown) => {
            assert.ok(e instanceof EnvError);
            assert.equal(leaks(e.message, [token, account]), false);
            return true;
          },
        );
      }),
      { numRuns: 100 },
    );
  });

  test('a valid file yields Secrets that do not reveal on serialization', () => {
    fc.assert(
      fc.property(
        pairArb.filter(([t, a]) => [t, a].every((v) => !/['"#]/.test(v) && v.trim() === v)),
        ([token, account]) => {
          const env = loadWorkersAiEnv({
            readFile: () => `${TOKEN_VARIABLE}=${token}\n${ACCOUNT_VARIABLE}=${account}\n`,
            envPath: '/fake/env',
          });
          assert.equal(env.token.reveal(), token);
          assert.equal(env.accountId.reveal(), account);
          const shown = JSON.stringify(env) + String(env.token) + inspect(env, { depth: 5 });
          assert.equal(leaks(shown, [token, account]), false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
