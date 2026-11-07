import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inspect } from 'node:util';
import fc from 'fast-check';
import { EnvError, loadWorkersAiEnv, parseEnv } from '../../src/env.ts';
import { redact, Secret } from '../../src/redact.ts';
import { clearSecrets, registerSecrets, scrub } from '../../src/sink.ts';

const reader = (text: string) => () => text;

test('parses plain, quoted, commented, export and CRLF lines', () => {
  const text = '# c\r\nWORKERS_AI_TOKEN="tok en"\r\n\r\nexport CLOUDFLARE_ACCOUNT_ID=\'acc1\'\r\nOTHER=x\r\n';
  const env = loadWorkersAiEnv({ readFile: reader(text) });
  assert.equal(env.token.reveal(), 'tok en');
  assert.equal(env.accountId.reveal(), 'acc1');
  assert.equal(parseEnv('A=1\nA=2').get('A'), '2');
});

test('secrets are opaque', () => {
  const s = new Secret('sUperSecret');
  for (const out of [String(s), `${s}`, JSON.stringify({ s }), inspect(s), inspect({ s }, { depth: 5 })]) {
    assert.ok(!out.includes('sUperSecret'));
    assert.ok(out.includes('[redacted]'));
  }
});

test('missing file names only the file', () => {
  const read = () => {
    throw new Error('ENOENT /secret/path tokenvalue');
  };
  assert.throws(
    () => loadWorkersAiEnv({ readFile: read }),
    (e: Error) => e instanceof EnvError && e.message.includes('"env"') && !e.message.includes('tokenvalue') && !e.message.includes('ENOENT'),
  );
});

test('missing and empty variables name only the variable', () => {
  assert.throws(() => loadWorkersAiEnv({ readFile: reader('CLOUDFLARE_ACCOUNT_ID=abc\n') }), /WORKERS_AI_TOKEN/);
  assert.throws(
    () => loadWorkersAiEnv({ readFile: reader('WORKERS_AI_TOKEN=topsecret\nCLOUDFLARE_ACCOUNT_ID=\n') }),
    (e: Error) => /CLOUDFLARE_ACCOUNT_ID/.test(e.message) && !e.message.includes('topsecret'),
  );
});

test('reads a real temp file through the default reader', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-env-'));
  try {
    const file = path.join(dir, 'env');
    writeFileSync(file, 'WORKERS_AI_TOKEN=t1\nCLOUDFLARE_ACCOUNT_ID=a1\n');
    assert.equal(loadWorkersAiEnv({ envPath: file }).token.reveal(), 't1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redact replaces raw and URL-encoded variants; sink scrub uses registered secrets', () => {
  const secret = 'a b/c+d';
  const text = `x ${secret} y ${encodeURIComponent(secret)} z ${encodeURI(secret)}`;
  assert.ok(!redact(text, [secret]).includes('c+d') && !redact(text, [secret]).includes('%2B'));
  clearSecrets();
  registerSecrets(new Secret('zzTOPzz'));
  assert.equal(scrub('url /accounts/zzTOPzz/ai'), 'url /accounts/[redacted]/ai');
  clearSecrets();
});

test('property: no secret or variant survives redaction', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 4, maxLength: 20 }), fc.string(), fc.string(), (secret, a, b) => {
      for (const form of [secret, encodeURIComponent(secret)]) {
        const out = redact(`${a}${form}${b}`, [secret]);
        if (!a.includes(secret) && !b.includes(secret)) assert.ok(!out.includes(form) || form === '' || a.includes(form) || b.includes(form) || (a + '[redacted]' + b).includes(form));
      }
      assert.ok(!redact(`${a}${secret}${b}`, [new Secret(secret)]).includes(secret) || a.includes(secret) || b.includes(secret) || secret.includes('[redacted]') || '[redacted]'.includes(secret));
    }),
    { numRuns: 100 },
  );
});
