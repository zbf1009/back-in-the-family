// Offline C1 proof over the actual native and wasm32 --nocapture trace logs.
// Usage: node web/scripts/check-decision-contract.ts <native.log> <wasm32.log>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  DECISION_CONTRACT,
  decisionFingerprint,
  decisionFingerprintInput,
} from '../src/shared/decision-contract.ts';

const [nativePath, wasmPath, ...extra] = process.argv.slice(2);
assert.ok(nativePath && wasmPath && extra.length === 0,
  'usage: node web/scripts/check-decision-contract.ts <native.log> <wasm32.log>');
const logs = [readFileSync(nativePath, 'utf8'), readFileSync(wasmPath, 'utf8')];

function trace(log: string, marker: string): string[] {
  return log.split(/\r?\n/).flatMap((line) => {
    const start = line.indexOf(`${marker} `);
    return start < 0 ? [] : [line.slice(start + marker.length + 1)];
  }).sort();
}

const contracts = logs.map((log) => trace(log, 'DECISION_CONTRACT_PARITY'));
for (const rows of contracts) assert.equal(rows.length, 1, 'one actual contract row per target');
assert.deepEqual(contracts[0], contracts[1], 'native/wasm32 contract JSON bytes');
const contractRow = contracts[0]![0]!;
assert.ok(contractRow.startsWith('contract\t'));
const contract: unknown = JSON.parse(contractRow.slice('contract\t'.length));
const production = readFileSync(new URL('../src/shared/system-one-v1.txt', import.meta.url));
const frozen = readFileSync(new URL('../../eval/probe/templates/decision.system_one.v1.txt', import.meta.url));
assert.deepEqual(production, frozen);
assert.equal(createHash('sha256').update(production).digest('hex'), DECISION_CONTRACT.mappingHash);
const mappingDigest = await crypto.subtle.digest('SHA-256', production);
assert.equal(Buffer.from(mappingDigest).toString('hex'), DECISION_CONTRACT.mappingHash);
assert.deepEqual(contract, {
  ...DECISION_CONTRACT,
  fingerprintInput: new TextDecoder().decode(decisionFingerprintInput()),
  mapping: production.toString('utf8'),
});
assert.equal(await decisionFingerprint(), DECISION_CONTRACT.fingerprint);

const previewLabels = [
  'dream', 'dream.render', 'dream.render_error', 'dream.validate', 'dream.illegal',
  'bribe', 'bribe.render', 'bribe.render_error', 'bribe.validate', 'bribe.illegal',
  'malformed', 'dream_rejected', 'bribe_rejected', 'no_node',
  'render_malformed', 'validate_malformed',
].sort();
const previews = logs.map((log) => trace(log, 'PREVIEW_PARITY'));
for (const rows of previews) {
  assert.deepEqual(rows.map((row) => row.split('\t')[0]), previewLabels,
    'all production preview/render/raw-choice/error rows exactly once');
}
assert.deepEqual(previews[0], previews[1], 'native/wasm32 production preview JSON bytes');
console.log('C1 production contract: 1 contract + 16 preview/render/validate rows match native/wasm32; mapping and fingerprint SHA-256 verified.');
