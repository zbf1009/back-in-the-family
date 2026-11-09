// llm-probe task 40.1 (R20.1, R20.2, R20.8, DA-26, DA-27): the four Decision_Variant records, their validation, the
// registry and the Model_Fingerprints. No network, no `env`, no card file.
// **Validates: Requirements 20.1, 20.2, 20.8, 19.1, 3.12**
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { systemOneFingerprint } from '../../src/adapters/system-one.ts';
import { isDecisionModel, isPermAvg, isSystemOne, parseCombinations, variantOf, variantRegistry, type AggregationReader, type Combination } from '../../src/phase.ts';
import { fingerprintId } from '../../src/results.ts';
import { derivedFingerprint } from '../../src/variants.ts';

const HERE = new URL('.', import.meta.url).pathname;
const FILE_TEXT = readFileSync(`${HERE}../../combinations.json`, 'utf8');
const RULE_BYTES = readFileSync(`${HERE}../../templates/aggregation.perm_avg.v1.txt`);
const AGGREGATION_HASH = '05acd24f84c1d16ba1ef67bd752e18347f38fe4c13f2c8fc125c9499bc15cf23';

type Rec = Record<string, unknown>;
const records = (): Rec[] => JSON.parse(FILE_TEXT) as Rec[];
const parse = (list: Rec[], reader?: AggregationReader): Combination[] => parseCombinations(JSON.stringify(list), reader);
const byId = (list: Rec[], id: string): Rec => list.find((c) => c['id'] === id) as Rec;
const PA = 'workers-ai/clef-flash/perm_avg';

test('the committed file has the two single and the two perm_avg records, and the pin equals the rule file hash', () => {
  assert.equal(createHash('sha256').update(RULE_BYTES).digest('hex'), AGGREGATION_HASH);
  const list = parseCombinations(FILE_TEXT);
  for (const model of ['clef-flash', 'clef']) {
    const single = list.find((c) => c.id === `workers-ai/${model}`) as Combination;
    const pa = list.find((c) => c.id === `workers-ai/${model}/perm_avg`) as Combination;
    assert.equal(single.variant, 'single');
    assert.equal(pa.variant, 'perm_avg');
    assert.equal(pa.derives_from, single.id);
    assert.equal(pa.sends_requests, false);
    assert.deepEqual(pa.aggregation, { file: 'eval/probe/templates/aggregation.perm_avg.v1.txt', rule_version: 1, sha256: AGGREGATION_HASH });
    assert.equal(pa.task_subset_allowed, 'D');
    assert.equal(pa.validator_mode, 'raw_choice');
    assert.equal(pa.phase1_locked, false);
    // The repeated model fields equal the source record's (DA-27).
    for (const k of ['runtime', 'model_id', 'model_selector', 'quantization', 'revision', 'question_id', 'mapping', 'license']) assert.deepEqual(pa[k], single[k], k);
    // Nothing a Runtime needs is on the derived record.
    for (const k of ['sampling', 'prices', 'context_window_tokens', 'max_bytes_per_token']) assert.equal(pa[k], undefined, k);
    assert.ok(isSystemOne(single) && isDecisionModel(single));
    assert.ok(isPermAvg(pa) && !isSystemOne(pa) && !isDecisionModel(pa));
  }
  assert.equal(variantOf(list.find((c) => c.id === 'webllm/qwen3.5-0.8b-q4f32/nvidia') as Combination), 'single');
});

test('a perm_avg record without a usable derives_from is refused', () => {
  const missing = records();
  delete byId(missing, PA)['derives_from'];
  assert.throws(() => parse(missing), /derives_from must name the "single" record/);

  const unknown = records();
  byId(unknown, PA)['derives_from'] = 'workers-ai/nope';
  assert.throws(() => parse(unknown), /derives_from "workers-ai\/nope" is not a record/);

  const toPermAvg = records();
  byId(toPermAvg, PA)['derives_from'] = 'workers-ai/clef/perm_avg';
  assert.throws(() => parse(toPermAvg), /is not a "single" record/);

  const otherModel = records();
  byId(otherModel, PA)['derives_from'] = 'workers-ai/clef';
  assert.throws(() => parse(otherModel), /model_id differs from the derives_from record/);

  const notSystemOne = records();
  byId(notSystemOne, PA)['derives_from'] = 'workers-ai/gemma-4-26b-a4b-it';
  assert.throws(() => parse(notSystemOne), /is not a System_One record/);
});

test('a perm_avg record whose aggregation hash differs from the rule file, or whose rule or flags are wrong, is refused', () => {
  const bad = records();
  (byId(bad, PA)['aggregation'] as Rec)['sha256'] = '0'.repeat(64);
  assert.throws(() => parse(bad), /aggregation\.sha256 does not equal the sha256 of/);

  const malformed = records();
  (byId(malformed, PA)['aggregation'] as Rec)['sha256'] = 'ABC';
  assert.throws(() => parse(malformed), /64 lowercase hex digits/);

  const version = records();
  (byId(version, PA)['aggregation'] as Rec)['rule_version'] = 2;
  assert.throws(() => parse(version), /rule_version 2 differs from the rule_version line/);

  const unreadable: AggregationReader = () => null;
  assert.throws(() => parse(records(), unreadable), /cannot be read/);

  const sends = records();
  byId(sends, PA)['sends_requests'] = true;
  assert.throws(() => parse(sends), /sends_requests must be false/);

  const priced = records();
  byId(priced, PA)['prices'] = { input: 1, output: 0, source: 's', read_on: 'd' };
  assert.throws(() => parse(priced), /prices is not allowed on a "perm_avg" record/);

  const locked = records();
  byId(locked, PA)['phase1_locked'] = true;
  assert.throws(() => parse(locked), /phase1_locked must be false/);

  const noAgg = records();
  delete byId(noAgg, PA)['aggregation'];
  assert.throws(() => parse(noAgg), /aggregation must be an object/);

  const changedMapping = records();
  (byId(changedMapping, PA)['mapping'] as Rec)['format_version'] = 2;
  assert.throws(() => parse(changedMapping), /mapping differs from the derives_from record/);
});

test('a single record with derives_from or aggregation, or an unknown variant, is refused; an absent variant still means single', () => {
  const withFrom = records();
  byId(withFrom, 'workers-ai/clef-flash')['derives_from'] = 'workers-ai/clef';
  assert.throws(() => parse(withFrom), /derives_from is not allowed on a "single" record/);

  const withAgg = records();
  byId(withAgg, 'workers-ai/clef')['aggregation'] = { file: 'x', rule_version: 1, sha256: '0'.repeat(64) };
  assert.throws(() => parse(withAgg), /aggregation is not allowed on a "single" record/);

  const unknown = records();
  byId(unknown, 'workers-ai/clef')['variant'] = 'mean';
  assert.throws(() => parse(unknown), /variant must be "single" or "perm_avg"/);

  const absent = records();
  delete byId(absent, 'workers-ai/clef')['variant'];
  const list = parse(absent);
  assert.equal(variantOf(list.find((c) => c.id === 'workers-ai/clef') as Combination), 'single');
  assert.ok(isSystemOne(list.find((c) => c.id === 'workers-ai/clef') as Combination));
});

test('variantRegistry lists the variants of one model in file order with the rule file hash', () => {
  const list = parseCombinations(FILE_TEXT);
  assert.deepEqual(variantRegistry(list, '@cf/cloudflare/clef-flash'), [
    { id: 'workers-ai/clef-flash', variant: 'single', aggregation_hash: null },
    { id: PA, variant: 'perm_avg', aggregation_hash: AGGREGATION_HASH },
  ]);
  assert.deepEqual(variantRegistry(list, '@cf/cloudflare/clef').map((e) => e.id), ['workers-ai/clef', 'workers-ai/clef/perm_avg']);
  assert.deepEqual(variantRegistry(list, '@cf/google/gemma-4-26b-a4b-it'), []);
  // A changed rule byte is visible in the registry (what the registry check of task 42 compares).
  const changed = variantRegistry(list, '@cf/cloudflare/clef-flash', () => ({ sha256: '1'.repeat(64), ruleVersion: 1 }));
  assert.notDeepEqual(changed, variantRegistry(list, '@cf/cloudflare/clef-flash'));
});

test('fingerprints: single gains variant "single"; perm_avg adds variant, derived, aggregation and template_hashes.aggregation; IDs differ', () => {
  const list = parseCombinations(FILE_TEXT);
  const single = list.find((c) => c.id === 'workers-ai/clef-flash') as Combination;
  const permAvg = list.find((c) => c.id === PA) as Combination;
  const sf = systemOneFingerprint(single as never);
  assert.equal(sf['variant'], 'single');
  // The single fingerprint ID changes with the new member (no single Dev_Run or Locked_Run exists yet, so no stored file is affected).
  const { variant: _v, ...old } = sf;
  assert.notEqual(fingerprintId(sf), fingerprintId(old));

  const mappingHash = 'a'.repeat(64);
  const input = { permAvg, single, mappingHash, aggregationHash: AGGREGATION_HASH, ruleVersion: 1, pinnedManifestHash: 'm', simWasmSha256: 'b'.repeat(64) };
  const df = derivedFingerprint(input);
  assert.equal(df['variant'], 'perm_avg');
  assert.equal(df['derived'], true);
  assert.deepEqual(df['aggregation'], { rule_version: 1, hash: AGGREGATION_HASH });
  assert.deepEqual(df['template_hashes'], { decision: mappingHash, aggregation: AGGREGATION_HASH });
  assert.equal(df['model_key'], null);
  assert.equal(df['sim_wasm_sha256'], 'b'.repeat(64));
  assert.deepEqual(df['system_one'], sf['system_one']);
  assert.notEqual(fingerprintId(df), fingerprintId(sf));
  // The Aggregation_Hash is part of the identity (R3.10, R3.12, R20.8); so is the code that computed the answer.
  assert.notEqual(fingerprintId(derivedFingerprint({ ...input, aggregationHash: 'c'.repeat(64) })), fingerprintId(df));
  assert.notEqual(fingerprintId(derivedFingerprint({ ...input, simWasmSha256: 'd'.repeat(64) })), fingerprintId(df));
  assert.throws(() => derivedFingerprint({ ...input, single: permAvg }), /not a "single" System_One record/);
});

test('the stored Smoke_Call records carry no fingerprint, so the added members change no stored identity', () => {
  const smoke = readFileSync(`${HERE}../../../results/smoke/2026-11-09.jsonl`, 'utf8');
  assert.ok(!/fingerprint|"fp-/.test(smoke));
});
