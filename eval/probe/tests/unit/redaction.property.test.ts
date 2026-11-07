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
import { ACCOUNT_VARIABLE, EnvError, loadWorkersAiEnv, TOKEN_VARIABLE } from '../../src/env.ts';
import { REDACTED, Secret, secretVariants } from '../../src/redact.ts';
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
