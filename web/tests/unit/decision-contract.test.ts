import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  DECISION_CONTRACT,
  decisionFingerprint,
  decisionFingerprintInput,
} from '../../src/shared/decision-contract.ts';

const FIXED_VECTOR = '6ffb8d3a255dbc1d066ba3b4a1c38291b1adfda5aa1f4e3c65a9adafbd243a32';
const FIXED_INPUT = 'cloudflare_workers_ai\0@cf/cloudflare/clef\0system-one-v1\0'
  + 'e275f397327b91dc1b6f69290535d6ef72c6bb712021ff130ed9da43589b337d\0'
  + 'clef-system-one-choice-v1';

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('production mapping is byte-identical to the frozen template and SHA-256 pin', async () => {
  const production = readFileSync(new URL('../../src/shared/system-one-v1.txt', import.meta.url));
  const frozen = readFileSync(new URL('../../../eval/probe/templates/decision.system_one.v1.txt', import.meta.url));
  assert.deepEqual(production, frozen);
  assert.equal(production.length, 1879);
  assert.equal(sha256(production), DECISION_CONTRACT.mappingHash);
  const digest = await crypto.subtle.digest('SHA-256', production);
  assert.equal(Buffer.from(digest).toString('hex'), DECISION_CONTRACT.mappingHash);
});

test('the shared production contract is fixed and safe for NUL-delimited hashing', () => {
  assert.ok(Object.isFrozen(DECISION_CONTRACT));
  assert.deepEqual(DECISION_CONTRACT, {
    provider: 'cloudflare_workers_ai',
    model: '@cf/cloudflare/clef',
    mappingVersion: 'system-one-v1',
    mappingHash: 'e275f397327b91dc1b6f69290535d6ef72c6bb712021ff130ed9da43589b337d',
    responseSchema: 'clef-system-one-choice-v1',
    fingerprint: FIXED_VECTOR,
  });
  assert.ok(Object.values(DECISION_CONTRACT).every((field) => !field.includes('\0')));
  assert.match(DECISION_CONTRACT.mappingHash, /^[0-9a-f]{64}$/);
  assert.match(DECISION_CONTRACT.fingerprint, /^[0-9a-f]{64}$/);
});

test('fingerprint input has the exact UTF-8 order, four NULs, and no terminal NUL', () => {
  const actual = decisionFingerprintInput();
  const expected = new TextEncoder().encode(FIXED_INPUT);
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 146);
  assert.equal(actual.filter((byte) => byte === 0).length, 4);
  assert.notEqual(actual.at(-1), 0);
  assert.equal(sha256(actual), FIXED_VECTOR);
});

test('platform WebCrypto recomputes the fixed cross-language fingerprint', async () => {
  assert.equal(await decisionFingerprint(), FIXED_VECTOR);
  assert.equal(await decisionFingerprint(), DECISION_CONTRACT.fingerprint);
});

test('delimiter, order, and mapping-hash case mutations do not match the vector', () => {
  const fields = FIXED_INPUT.split('\0');
  const reordered = [...fields];
  [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
  const uppercaseHash = [...fields];
  uppercaseHash[3] = uppercaseHash[3]!.toUpperCase();
  const misplacedNul = FIXED_INPUT.replace('\0', '') + '\0';
  for (const mutated of [
    FIXED_INPUT + '\0',
    fields.join(''),
    fields.join('\n'),
    fields.join('\\0'),
    reordered.join('\0'),
    uppercaseHash.join('\0'),
    misplacedNul,
  ]) {
    assert.notEqual(sha256(mutated), FIXED_VECTOR);
  }
  // Same byte count and separator count still cannot disguise the wrong boundary.
  assert.equal(Buffer.byteLength(misplacedNul), 146);
  assert.equal(misplacedNul.split('\0').length - 1, 4);
  assert.notDeepEqual(new TextEncoder().encode(misplacedNul), decisionFingerprintInput());
});
