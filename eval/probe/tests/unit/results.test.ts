import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  appendExclusion,
  appendFailure,
  appendSmoke,
  canonicalJson,
  fingerprintId,
  gradesPathFor,
  readExclusions,
  readFailures,
  readGradesFile,
  readPerf,
  readPreflight,
  readResultsFile,
  readSmoke,
  ResultsFormatError,
  ResultsWriter,
  SCHEMA,
  writeGradesFile,
  writePerf,
  writePreflight,
  type ResultRecord,
  type ResultsHeader,
} from '../../src/results.ts';

const root = mkdtempSync(path.join(tmpdir(), 'probe-results-'));
after(() => rmSync(root, { recursive: true, force: true }));

function header(split: 'dev' | 'locked', runId: string): ResultsHeader {
  return {
    schema: SCHEMA.header,
    run_id: runId,
    split,
    combination: 'webllm/qwen3.5-2b-q4f32/nvidia',
    model_key: { runtime: 'webllm', model_id: 'Qwen3.5-2B-q4f32_1-MLC', quantization: 'q4f32_1', revision: 'a'.repeat(40) },
    task_subset: 'DS',
    fingerprint: { runtime: { name: 'webllm', version: '0.2.87' }, sampling: { temperature: 0, top_p: null, seed: null } },
    template_hashes: { 'decision.v1': 'ab', 'synthesis.v1': 'cd' },
    timeout_ms: 10000,
    placement: { method: 'webgpu', cpu_nodes: [{ op_type: 'Gather', count: 2 }] },
  };
}

function record(h: ResultsHeader, over: Partial<ResultRecord> = {}): ResultRecord {
  return {
    schema: SCHEMA.result,
    run_id: h.run_id,
    split: h.split,
    card_id: 'D-x-001',
    permutation: 'base',
    outcome: { kind: 'text', text: ' {"option":"a"}\n\u0000\u2028 ' },
    latency_ms: 1834,
    timeout_ms: h.timeout_ms,
    requested_at: '2026-11-06T10:15:02.118Z',
    template_hash: 'ab',
    fingerprint_id: fingerprintId(h.fingerprint),
    usage: { input_tokens: 912, output_tokens: 9, reasoning_tokens: null },
    late: null,
    source: 'headless',
    ...over,
  };
}

function lines(file: string): string[] {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
}

test('every outcome kind round-trips, raw text byte for byte', () => {
  const h = header('dev', 'dev-1');
  const w = ResultsWriter.create(root, h);
  const recs: ResultRecord[] = [
    record(h),
    record(h, { card_id: 'D-x-002', outcome: { kind: 'text', text: '' } }),
    record(h, { card_id: 'D-x-003', outcome: { kind: 'text', text: 'lone \ud800 surrogate \udfff and 😀' } }),
    record(h, { card_id: 'D-x-004', outcome: { kind: 'timeout' }, latency_ms: 10000, late: { kind: 'late', text: ' late\r\n', latency_ms: 13120 } }),
    record(h, { card_id: 'D-x-005', outcome: { kind: 'timeout' }, latency_ms: 10000, late: { kind: 'none', reason: 'idle_cap' } }),
    record(h, { card_id: 'D-x-006', outcome: { kind: 'error', code: 'non_text_response', detail: 'x', remote: false }, usage: null }),
    record(h, { card_id: 'D-x-007', outcome: { kind: 'engine_fault', code: 'runtime_stuck', detail: 'stuck' }, latency_ms: null }),
    record(h, { card_id: 'D-x-008', outcome: { kind: 'not_run', reason: 'budget', detail: '' }, latency_ms: null, usage: null }),
    record(h, { card_id: 'D-x-009', outcome: { kind: 'text', text: 'x'.repeat(2_000_000) }, source: 'probe_page' }),
  ];
  for (const r of recs) w.append(r);
  const back = readResultsFile(w.file);
  assert.deepEqual(back.header, h);
  assert.deepEqual(back.records, recs);
  assert.equal(back.fingerprintId, fingerprintId(h.fingerprint));
  for (const l of lines(w.file)) assert.ok(l.startsWith('{"schema":"llm-probe-'));
});

test('not_run records need a null latency; timeouts need a late field; others a null late', () => {
  const h = header('dev', 'dev-2');
  const w = ResultsWriter.create(root, h);
  assert.throws(() => w.append(record(h, { outcome: { kind: 'not_run', reason: 'oom', detail: '' }, latency_ms: 5 })), /latency_ms/);
  assert.throws(() => w.append(record(h, { outcome: { kind: 'timeout' }, late: null })), /late/);
  assert.throws(() => w.append(record(h, { late: { kind: 'none', reason: 'error' } })), /late/);
  assert.throws(() => w.append(record(h, { split: 'locked' })), /split/);
  assert.throws(() => w.append(record(h, { fingerprint_id: 'fp-other' })), /fingerprint/);
  assert.deepEqual(readResultsFile(w.file).records, []);
});

test('a second create for the same run refuses; open appends to the same file', () => {
  const h = header('dev', 'dev-3');
  const w = ResultsWriter.create(root, h);
  w.append(record(h));
  assert.throws(() => ResultsWriter.create(root, h), /already exists/);
  const again = ResultsWriter.open(w.file);
  again.append(record(h, { card_id: 'D-x-010' }));
  assert.equal(readResultsFile(w.file).records.length, 2);
});

function brokenFile(name: string, mutate: (rec: Record<string, unknown>) => void): { file: string; before: string } {
  const h = header('dev', name);
  const w = ResultsWriter.create(root, h);
  w.append(record(h));
  const second = JSON.parse(lines(w.file)[1] as string) as Record<string, unknown>;
  mutate(second);
  writeFileSync(w.file, `${readFileSync(w.file, 'utf8')}${JSON.stringify(second)}\n`);
  return { file: w.file, before: readFileSync(w.file, 'utf8') };
}

for (const [label, mutate, pattern] of [
  ['a missing schema', (r: Record<string, unknown>) => void delete r.schema, /no "schema"/],
  ['a foreign schema', (r: Record<string, unknown>) => void (r.schema = 'other-v1'), /does not start with "llm-probe-"/],
  ['an unknown outcome kind', (r: Record<string, unknown>) => void (r.outcome = { kind: 'weird' }), /outcome\.kind/],
  ['an unknown not_run reason', (r: Record<string, unknown>) => void (r.outcome = { kind: 'not_run', reason: 'bored', detail: '' }), /reason/],
  ['a missing field', (r: Record<string, unknown>) => void delete r.latency_ms, /latency_ms/],
] as const) {
  test(`reader rejects ${label}, names file and line, leaves the file unchanged`, () => {
    const { file, before } = brokenFile(`bad-${label.replace(/\W+/g, '-')}`, mutate);
    assert.throws(
      () => readResultsFile(file),
      (e: unknown) => e instanceof ResultsFormatError && e.file === file && e.line === 3 && e.message.includes(file) && pattern.test(e.message),
    );
    assert.equal(readFileSync(file, 'utf8'), before);
  });
}

test('reader stops at the first failing record and rejects invalid JSON', () => {
  const { file } = brokenFile('bad-json', () => {});
  writeFileSync(file, `${readFileSync(file, 'utf8')}{not json\n{"schema":"x"}\n`);
  assert.throws(() => readResultsFile(file), (e: unknown) => e instanceof ResultsFormatError && e.line === 4);
});

test('a Results file with no header or a record in place of the header is rejected', () => {
  const h = header('dev', 'nohdr');
  const w = ResultsWriter.create(root, h);
  const [, recLine] = [lines(w.file)[0], JSON.stringify(record(h))];
  const file = path.join(root, 'dev', 'headless.jsonl');
  writeFileSync(file, `${recLine}\n`);
  assert.throws(() => readResultsFile(file), (e: unknown) => e instanceof ResultsFormatError && e.line === 1);
  writeFileSync(file, '');
  assert.throws(() => readResultsFile(file), ResultsFormatError);
});

test('dev and locked directories stay separate', () => {
  const dev = ResultsWriter.create(root, header('dev', 'sep-dev'));
  const locked = ResultsWriter.create(root, header('locked', 'sep-locked'));
  assert.equal(path.basename(path.dirname(dev.file)), 'dev');
  assert.equal(path.basename(path.dirname(locked.file)), 'locked');
  // A dev header inside locked/ and a locked header inside dev/ are rejected.
  const devHeaderLine = lines(dev.file)[0] as string;
  const lockedHeaderLine = lines(locked.file)[0] as string;
  const intoLocked = path.join(root, 'locked', 'wrong-1.jsonl');
  const intoDev = path.join(root, 'dev', 'wrong-2.jsonl');
  writeFileSync(intoLocked, `${devHeaderLine}\n`);
  writeFileSync(intoDev, `${lockedHeaderLine}\n`);
  assert.throws(() => readResultsFile(intoLocked), /does not match the "locked" directory/);
  assert.throws(() => readResultsFile(intoDev), /does not match the "dev" directory/);
  // A record of the other split inside a file is rejected too.
  const mixed = path.join(root, 'dev', 'wrong-3.jsonl');
  writeFileSync(mixed, `${devHeaderLine}\n${JSON.stringify(record(header('dev', 'sep-dev'), { split: 'locked' }))}\n`);
  assert.throws(() => readResultsFile(mixed), /split/);
});

test('grades file: grade, contrast and excluded lines round-trip; excluded must be last', () => {
  const file = path.join(root, 'dev', 'g.grades.jsonl');
  assert.equal(gradesPathFor('/a/dev/g.jsonl'), '/a/dev/g.grades.jsonl');
  const grades = [
    { schema: SCHEMA.grade, card_id: 'D-x-001', permutation: 'base', verdict: { kind: 'ok' }, grade: { acceptable: true }, identity: 'a', late_grade: null },
  ] as const;
  const contrasts = [{ schema: SCHEMA.contrast, pair_id: 'P-1', contrast: { consistent: true } }] as const;
  writeGradesFile(file, grades, contrasts, [{ id: 'D-x-009', reason: 'void' }, { id: 'P-1', reason: 'sanity' }]);
  const back = readGradesFile(file);
  assert.deepEqual(back.grades, grades);
  assert.deepEqual(back.contrasts, contrasts);
  assert.deepEqual(back.excluded, [{ id: 'D-x-009', reason: 'void' }, { id: 'P-1', reason: 'sanity' }]);
  assert.throws(() => writeGradesFile(file, grades, contrasts, []), /already exists/);
  const ls = lines(file);
  writeFileSync(file, `${ls[2]}\n${ls[0]}\n`);
  assert.throws(() => readGradesFile(file), (e: unknown) => e instanceof ResultsFormatError && e.line === 2);
  writeFileSync(file, `${ls[0]}\n`);
  assert.throws(() => readGradesFile(file), /excluded/);
  writeFileSync(file, `{"schema":"nope-v1"}\n`);
  assert.throws(() => readGradesFile(file), /does not start with "llm-probe-"/);
});

test('failure, exclusion, smoke, perf and preflight writers use the schema rule', () => {
  const failures = path.join(root, 'failures.jsonl');
  appendFailure(failures, { schema: SCHEMA.failure, combination: 'c', kind: 'model_load_failed', reason: 'quota' });
  appendFailure(failures, { schema: SCHEMA.failure, combination: 'c', kind: 'oom', reason: null });
  assert.equal(readFailures(failures).length, 2);
  assert.throws(() => appendFailure(failures, { schema: 'llm-probe-result-v1', combination: 'c', kind: 'k' } as never), /schema/);
  assert.throws(() => appendFailure(failures, { combination: 'c', kind: 'k' } as never), /schema/);
  assert.equal(readFailures(failures).length, 2);

  const exclusions = path.join(root, 'exclusions.jsonl');
  appendExclusion(exclusions, { schema: SCHEMA.exclusion, combination: 'c', model: 'm', check: 'vram', value: 'unknown', limit: 2600, at: '2026-11-06T00:00:00.000Z' });
  assert.equal(readExclusions(exclusions)[0]?.check, 'vram');
  assert.throws(() => appendExclusion(exclusions, { schema: SCHEMA.exclusion, check: 'bogus' } as never), /invalid exclusion record/);

  const smoke = path.join(root, 'smoke', '2026-11-06.jsonl');
  appendSmoke(smoke, { schema: SCHEMA.smoke, ok: true, status: 200 });
  assert.deepEqual(readSmoke(smoke), [{ schema: SCHEMA.smoke, ok: true, status: 200 }]);

  const perf = path.join(root, 'locked', 'r.perf.json');
  writePerf(perf, { schema: SCHEMA.perf, run_kind: 'locked', fresh_profile: true, cold_start: { empty_cache_ms: 1, warm_cache_ms: 2 } });
  assert.equal(readPerf(perf).run_kind, 'locked');
  assert.throws(() => writePerf(perf, { schema: SCHEMA.perf, run_kind: 'locked', fresh_profile: true }), /already exists/);

  const pre = path.join(root, 'preflight', 'c.json');
  const preRec = { schema: SCHEMA.preflight, prompt_bytes: 10, event_count: 3, person_count: 2, new_tokens: 1024, eos_disabled: true as const, peak_vram_mib: 2000 };
  writePreflight(pre, preRec);
  assert.deepEqual(readPreflight(pre), preRec);
  assert.throws(() => writePreflight(pre, { ...preRec, eos_disabled: false as never }, true), /eos_disabled/);
});

test('canonicalJson sorts keys with schema first and rejects non-JSON values', () => {
  assert.equal(canonicalJson({ b: 1, schema: 'llm-probe-x', a: [true, null] }), '{"schema":"llm-probe-x","a":[true,null],"b":1}');
  assert.throws(() => canonicalJson({ a: Number.NaN }), /not finite/);
  assert.throws(() => canonicalJson({ a: undefined }), /undefined/);
});
