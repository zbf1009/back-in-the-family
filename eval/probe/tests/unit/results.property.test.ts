// Feature: llm-probe, Property 32: Results records round trip byte-exact
// Validates: Requirements 12.1, 12.2, 12.4, 12.10, 12.11
//
// Records of every kind are written through ResultsWriter / writeGradesFile into a temp
// directory (never under eval/) and read back. Raw text must survive byte for byte, every
// line must carry an `llm-probe-` schema, and malformed files are rejected with the file and
// line named, leaving the file byte-identical.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import {
  LATE_NONE_REASONS,
  NOT_RUN_REASONS,
  ResultsFormatError,
  ResultsWriter,
  SCHEMA,
  SCHEMA_PREFIX,
  fingerprintId,
  readGradesFile,
  readResultsFile,
  serializeLine,
  writeGradesFile,
  type ContrastLine,
  type ExcludedLine,
  type GradeLine,
  type JsonObject,
  type JsonValue,
  type Late,
  type Outcome,
  type ResultRecord,
  type ResultsHeader,
  type Usage,
} from '../../src/results.ts';

// ---------------------------------------------------------------- generators

/** Any UTF-16 string: control characters, lone surrogates, astral code points, empty. */
const rawText: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.constantFrom(' ', '\n', '\r\n', '\t', ' \n ', '\u0000', '\u2028', '\u2029', '\ufeff', '\ud800', '\udfff'),
  fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)), maxLength: 80 }),
  fc.string({ unit: 'binary', maxLength: 80 }),
  fc.string({ unit: 'grapheme', maxLength: 40 }),
);

const word = fc.stringMatching(/^[A-Za-z0-9_.-]{1,12}$/);
const uint = fc.integer({ min: 0, max: 2 ** 31 });
const timestamp = fc.date({ min: new Date('1971-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z'), noInvalidDate: true }).map((d) => d.toISOString());

const jsonValue: fc.Arbitrary<JsonValue> = fc.letrec<{ v: JsonValue }>((tie) => ({
  v: fc.oneof(
    { depthSize: 'small', maxDepth: 2 },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    rawText,
    fc.array(tie('v'), { maxLength: 3 }),
    fc.dictionary(word.map((k) => `k${k}`), tie('v'), { maxKeys: 3 }),
  ),
})).v;

const jsonObject: fc.Arbitrary<JsonObject> = fc.dictionary(word.map((k) => `k${k}`), jsonValue, { maxKeys: 4 });

const outcomeArb: fc.Arbitrary<Outcome> = fc.oneof(
  rawText.map((text): Outcome => ({ kind: 'text', text })),
  fc.constant<Outcome>({ kind: 'timeout' }),
  fc.record({ kind: fc.constant('error' as const), code: word, detail: rawText, remote: fc.boolean() }),
  fc.record({ kind: fc.constant('engine_fault' as const), code: fc.constant('runtime_stuck' as const), detail: rawText }),
  fc.record({ kind: fc.constant('not_run' as const), reason: fc.constantFrom(...NOT_RUN_REASONS), detail: rawText }),
);

const lateArb: fc.Arbitrary<Late> = fc.oneof(
  fc.record({ kind: fc.constant('late' as const), text: rawText, latency_ms: uint }),
  fc.record({ kind: fc.constant('none' as const), reason: fc.constantFrom(...LATE_NONE_REASONS) }),
);

const usageArb: fc.Arbitrary<Usage | null> = fc.option(
  fc.record({ input_tokens: fc.option(uint, { nil: null }), output_tokens: fc.option(uint, { nil: null }), reasoning_tokens: fc.option(uint, { nil: null }) }),
  { nil: null },
);

const headerArb: fc.Arbitrary<ResultsHeader> = fc.record({
  schema: fc.constant(SCHEMA.header),
  run_id: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/),
  split: fc.constantFrom('dev' as const, 'locked' as const),
  combination: word,
  model_key: fc.record({ runtime: word, model_id: word, quantization: fc.oneof(fc.constant(''), word), revision: word }),
  task_subset: fc.constantFrom('D' as const, 'S' as const, 'DS' as const),
  fingerprint: jsonObject,
  template_hashes: fc.dictionary(word, rawText, { maxKeys: 3 }),
  timeout_ms: fc.integer({ min: 1, max: 10 ** 7 }),
  placement: fc.option(
    fc.record({ method: word, cpu_nodes: fc.array(fc.record({ op_type: word, count: uint }), { maxLength: 3 }) }),
    { nil: null },
  ),
});

/** A record that satisfies the cross-field rules (latency/late per outcome) for `header`. */
function recordArb(header: ResultsHeader): fc.Arbitrary<ResultRecord> {
  const fpId = fingerprintId(header.fingerprint);
  return fc
    .record({
      outcome: outcomeArb,
      latency: uint,
      late: lateArb,
      card_id: word,
      permutation: word,
      requested_at: timestamp,
      template_hash: rawText,
      usage: usageArb,
      source: fc.constantFrom('headless' as const, 'probe_page' as const, 'node' as const),
      nullEngineLatency: fc.boolean(),
    })
    .map((x): ResultRecord => {
      const latency_ms = x.outcome.kind === 'not_run' ? null : x.outcome.kind === 'engine_fault' && x.nullEngineLatency ? null : x.latency;
      return {
        schema: SCHEMA.result,
        run_id: header.run_id,
        split: header.split,
        card_id: x.card_id,
        permutation: x.permutation,
        outcome: x.outcome,
        latency_ms,
        timeout_ms: header.timeout_ms,
        requested_at: x.requested_at,
        template_hash: x.template_hash,
        fingerprint_id: fpId,
        usage: x.usage,
        late: x.outcome.kind === 'timeout' ? x.late : null,
        source: x.source,
      };
    });
}

const fileArb = headerArb.chain((header) => fc.record({ header: fc.constant(header), records: fc.array(recordArb(header), { minLength: 1, maxLength: 5 }) }));

const gradeLineArb: fc.Arbitrary<GradeLine> = fc.record({
  schema: fc.constant(SCHEMA.grade),
  card_id: word,
  permutation: word,
  verdict: jsonValue,
  grade: jsonValue,
  identity: jsonValue,
  late_grade: fc.option(jsonValue, { nil: null }),
});
const contrastLineArb: fc.Arbitrary<ContrastLine> = fc.record({ schema: fc.constant(SCHEMA.contrast), pair_id: word, contrast: jsonValue });
const excludedArb: fc.Arbitrary<ExcludedLine['excluded']> = fc.array(
  fc.record({ id: word, reason: fc.constantFrom('void' as const, 'sanity' as const) }),
  { maxLength: 4 },
);

// ---------------------------------------------------------------- helpers

/** fast-check builds null-prototype objects; compare against plain-object copies. */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function withTemp<T>(f: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-results-prop-'));
  try {
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fileLines(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  assert.ok(text.endsWith('\n'), 'file ends with a newline');
  return text.slice(0, -1).split('\n');
}

function checkRoundTrip(dir: string, header: ResultsHeader, records: ResultRecord[]): string {
  const w = ResultsWriter.create(dir, header);
  for (const r of records) w.append(r);
  const back = readResultsFile(w.file);
  assert.deepStrictEqual(back.header, plain(header));
  assert.deepStrictEqual(back.records, plain(records));
  back.records.forEach((r, i) => {
    const original = records[i];
    assert.ok(original !== undefined);
    if (r.outcome.kind === 'text' && original.outcome.kind === 'text') {
      assert.ok(Buffer.from(r.outcome.text, 'utf16le').equals(Buffer.from(original.outcome.text, 'utf16le')), 'raw text byte-identical');
    }
  });
  const lines = fileLines(w.file);
  assert.equal(lines.length, records.length + 1);
  for (const l of lines) {
    const schema = (JSON.parse(l) as { schema?: unknown }).schema;
    assert.equal(typeof schema, 'string');
    assert.ok((schema as string).startsWith(SCHEMA_PREFIX));
  }
  assert.equal(`${lines[0]}\n`, serializeLine(back.header));
  back.records.forEach((r, i) => assert.equal(`${lines[i + 1]}\n`, serializeLine(r)));
  return w.file;
}

// ---------------------------------------------------------------- properties

test('Property 32: Results records of every kind round trip byte-exact', () => {
  fc.assert(
    fc.property(fileArb, ({ header, records }) => {
      withTemp((dir) => {
        checkRoundTrip(dir, header, records);
      });
    }),
    { numRuns: 80 },
  );
});

test('Property 32 regression (seed 286421559): a template_hashes key named __proto__ survives the round trip', () => {
  // `parseHeader` used to build the map with `map[k] = v`, which sets the prototype for this key and drops it.
  withTemp((dir) => {
    const header: ResultsHeader = {
      schema: SCHEMA.header, run_id: 'proto', split: 'dev', combination: 'c',
      model_key: { runtime: 'r', model_id: 'm', quantization: '', revision: 'v' },
      task_subset: 'D', fingerprint: { a: 1 }, template_hashes: JSON.parse('{"__proto__":"","decision":"h"}') as { [name: string]: string },
      timeout_ms: 1000, placement: null,
    };
    assert.deepEqual(Object.keys(header.template_hashes), ['__proto__', 'decision']);
    const file = checkRoundTrip(dir, header, []);
    assert.deepEqual(Object.keys(readResultsFile(file).header.template_hashes), ['__proto__', 'decision']);
  });
});

test('Property 32: 1 MB+ raw text and late text round trip byte-exact', () => {
  const pieces = ['x', '\n', '\u0000', '\ud800', '日本語', '😀', '\\"', ' '];
  fc.assert(
    fc.property(fc.constantFrom(...pieces), fc.constantFrom(...pieces), (a, b) => {
      const big = (a + b + 'é').repeat(Math.ceil(1_100_000 / (a + b + 'é').length));
      assert.ok(big.length >= 1_048_576);
      withTemp((dir) => {
        const header: ResultsHeader = {
          schema: SCHEMA.header, run_id: 'big', split: 'dev', combination: 'c',
          model_key: { runtime: 'r', model_id: 'm', quantization: '', revision: 'v' },
          task_subset: 'DS', fingerprint: { a: 1 }, template_hashes: {}, timeout_ms: 1000, placement: null,
        };
        const base = {
          schema: SCHEMA.result, run_id: 'big', split: 'dev' as const, card_id: 'c1', permutation: 'p1',
          timeout_ms: 1000, requested_at: '2026-11-07T00:00:00.000Z', template_hash: 'h',
          fingerprint_id: fingerprintId(header.fingerprint), usage: null, source: 'node' as const,
        };
        const text: ResultRecord = { ...base, outcome: { kind: 'text', text: big }, latency_ms: 5, late: null };
        const timeout: ResultRecord = { ...base, outcome: { kind: 'timeout' }, latency_ms: 1000, late: { kind: 'late', text: big, latency_ms: 2000 } };
        checkRoundTrip(dir, header, [text, timeout]);
      });
    }),
    { numRuns: 3 },
  );
});

test('Property 32: grades, contrast and excluded lines round trip', () => {
  fc.assert(
    fc.property(fc.array(gradeLineArb, { maxLength: 4 }), fc.array(contrastLineArb, { maxLength: 3 }), excludedArb, (grades, contrasts, excluded) => {
      withTemp((dir) => {
        const file = path.join(dir, 'run.grades.jsonl');
        writeGradesFile(file, grades, contrasts, excluded);
        const back = readGradesFile(file);
        assert.deepStrictEqual(back.grades, plain(grades));
        assert.deepStrictEqual(back.contrasts, plain(contrasts));
        assert.deepStrictEqual(back.excluded, plain(excluded));
        const lines = fileLines(file);
        assert.equal(lines.length, grades.length + contrasts.length + 1);
        const reserialized = [...back.grades, ...back.contrasts, { schema: SCHEMA.excluded, excluded: back.excluded }].map((l) => serializeLine(l)).join('');
        assert.equal(readFileSync(file, 'utf8'), reserialized);
        for (const l of lines) assert.ok(((JSON.parse(l) as { schema: string }).schema).startsWith(SCHEMA_PREFIX));
      });
    }),
    { numRuns: 50 },
  );
});

type Mutation = 'no_schema' | 'foreign_schema' | 'bad_prefix_case' | 'header_as_record' | 'record_as_header' | 'unknown_kind' | 'grade_in_results';

test('Property 32: malformed Results files are rejected naming file and line, file untouched', () => {
  fc.assert(
    fc.property(
      fileArb,
      fc.constantFrom<Mutation>('no_schema', 'foreign_schema', 'bad_prefix_case', 'header_as_record', 'record_as_header', 'unknown_kind', 'grade_in_results'),
      fc.nat(),
      (parts, mutation, pick) => {
        withTemp((dir) => {
          const good = ResultsWriter.create(path.join(dir, 'src'), parts.header);
          for (const r of parts.records) good.append(r);
          const lines = fileLines(good.file);
          // Target line: 0-based index into `lines`; the header is line 1.
          const target = pick % lines.length;
          const parsed = JSON.parse(lines[target] as string) as Record<string, unknown>;
          let expectedLine = target + 1;
          switch (mutation) {
            case 'no_schema':
              delete parsed.schema;
              break;
            case 'foreign_schema':
              parsed.schema = 'other-v1';
              break;
            case 'bad_prefix_case':
              parsed.schema = String(parsed.schema).replace('llm-probe-', 'LLM-Probe-');
              break;
            case 'header_as_record': {
              // Header text where a record belongs (line 2+).
              expectedLine = 2;
              lines[1] = lines[0] as string;
              break;
            }
            case 'record_as_header': {
              expectedLine = 1;
              lines[0] = lines[1] as string;
              break;
            }
            case 'unknown_kind': {
              if (target === 0) {
                parsed.split = 'neither';
              } else {
                parsed.outcome = { kind: 'bogus' };
              }
              break;
            }
            case 'grade_in_results': {
              if (target === 0) expectedLine = 1;
              parsed.schema = SCHEMA.grade;
              break;
            }
          }
          if (mutation !== 'header_as_record' && mutation !== 'record_as_header') lines[target] = JSON.stringify(parsed);
          const bad = path.join(dir, 'bad.jsonl');
          writeFileSync(bad, `${lines.join('\n')}\n`);
          const before = readFileSync(bad);
          assert.throws(
            () => readResultsFile(bad),
            (e: unknown) => {
              assert.ok(e instanceof ResultsFormatError);
              assert.equal(e.file, bad);
              assert.equal(e.line, expectedLine);
              assert.ok(e.message.includes(bad));
              assert.ok(e.message.includes(`${bad}:${expectedLine}`));
              return true;
            },
          );
          assert.ok(readFileSync(bad).equals(before), 'file byte-identical after a rejected read');
        });
      },
    ),
    { numRuns: 80 },
  );
});

test('Property 32: grades lines without or with a foreign schema are rejected, file untouched', () => {
  fc.assert(
    fc.property(
      fc.array(gradeLineArb, { minLength: 1, maxLength: 3 }),
      excludedArb,
      fc.constantFrom('missing', 'foreign', 'results_schema'),
      fc.nat(),
      (grades, excluded, kind, pick) => {
        withTemp((dir) => {
          const good = path.join(dir, 'good.grades.jsonl');
          writeGradesFile(good, grades, [], excluded);
          const lines = fileLines(good);
          const target = pick % lines.length;
          const o = JSON.parse(lines[target] as string) as Record<string, unknown>;
          if (kind === 'missing') delete o.schema;
          else if (kind === 'foreign') o.schema = 'foreign-v1';
          else o.schema = SCHEMA.result;
          lines[target] = JSON.stringify(o);
          const bad = path.join(dir, 'bad.grades.jsonl');
          writeFileSync(bad, `${lines.join('\n')}\n`);
          const before = readFileSync(bad);
          assert.throws(
            () => readGradesFile(bad),
            (e: unknown) => {
              assert.ok(e instanceof ResultsFormatError);
              assert.equal(e.file, bad);
              assert.equal(e.line, target + 1);
              return true;
            },
          );
          assert.ok(readFileSync(bad).equals(before));
        });
      },
    ),
    { numRuns: 50 },
  );
});
