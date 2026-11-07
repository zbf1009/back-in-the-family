// Property 34 (llm-probe task 13.9): ingest accepts only complete, consistent exports.
// **Validates: Requirements 10.3, 10.4, 10.5, 12.5.**
// A SYNTHETIC card set in temp dirs (the real eval/results, ledger and locked.jsonl are never touched).
// - A well-formed, complete export (any entry order, any mix of on-time text, late text, timeout, error) is
//   accepted: one Results record per bundle Card x Permutation, same fields as a headless run; late text,
//   timeout markers and error markers are recorded and graded Illegal (accepted, not rejected).
// - Any single injected fault rejects the WHOLE file: exit 1, the first failing entry and the reason are
//   named, and the results directory is byte-identical before and after (nothing written).
// - An already-ingested run is refused and changes nothing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { ingest, PAGE_EXPORT_SCHEMA, readBundle, writeBundle, type Bundle } from '../../src/ingest.ts';
import { gradesPathFor, readGradesFile, readResultsFile } from '../../src/results.ts';
import { devRun } from '../../src/run.ts';
import { capture, createFakeRuntime, defaultAnswer, FAKE_COMBO, makeCardSet, makeEnv, REVISION, type TestEnv } from './run.helpers.ts';

const cardSet = makeCardSet();
const NO_RUNTIME = createFakeRuntime({ script: () => Promise.reject(new Error('a bundle must not call the Runtime')) });
const TIMEOUT = 10_000;

const FINGERPRINT = {
  runtime: { name: 'fake-runtime', version: '1.0.0' },
  model: { id: 'Fake-1B', revision: REVISION, model_lib_url: null, quantization: 'q4' },
  model_key: { runtime: 'fake-runtime', model_id: 'Fake-1B', quantization: 'q4', revision: REVISION },
  sampling: { temperature: 0, top_p: null, seed: 7, max_output_tokens: { decision: 64, synthesis: 1024 } },
  chat_template_kwargs: { enable_thinking: false },
  constraint: 'json_schema',
  browser: { version: '155.0.8059.84', headless: false, flags: [] },
  webgpu: { power_preference: 'high-performance', vendor: 'nvidia', architecture: 'ampere', device: '', description: 'NVIDIA synthetic adapter' },
  measurement: 'probe_page',
};

type Json = Record<string, unknown>;
type Kind = 'text' | 'late_text' | 'timeout_none' | 'timeout_late' | 'error';

async function devSetup(): Promise<{ env: TestEnv; bundle: Bundle; deps: ReturnType<TestEnv['deps']> }> {
  const env = makeEnv(cardSet);
  const deps = env.deps(NO_RUNTIME, { createRuntime: () => Promise.reject(new Error('no Runtime for a bundle')) });
  const { value, err } = await capture(() => devRun(deps, { combo: FAKE_COMBO.id, pageBundle: (d) => void writeBundle(deps.paths.resultsDir, d) }));
  assert.equal(value, 0, err);
  const [name] = fs.readdirSync(path.join(env.root, 'eval/results/bundles'));
  return { env, bundle: readBundle(deps.paths.resultsDir, (name as string).replace(/\.json$/, '')), deps };
}

/** A complete, valid export; `kinds[i % kinds.length]` picks how entry i (bundle order) came back. */
function exportFor(bundle: Bundle, kinds: readonly Kind[] = ['text']): Json {
  return {
    schema: PAGE_EXPORT_SCHEMA,
    run_id: bundle.run_id,
    split: bundle.split,
    template_hashes: { ...bundle.template_hashes },
    pinned_manifest_hash: bundle.pinned_manifest_hash,
    fingerprint: JSON.parse(JSON.stringify(FINGERPRINT)) as Json,
    cold_start: { empty_cache_ms: 41250, warm_cache_ms: 6120 },
    entries: bundle.requests.map((r, i) => {
      const kind = kinds[i % kinds.length] as Kind;
      const base = { card_id: r.card_id, permutation: r.permutation, requested_at: '2026-11-07T10:15:02.118Z' };
      const text = defaultAnswer(r.prompt);
      switch (kind) {
        case 'text':
          return { ...base, outcome: { kind: 'text', text }, latency_ms: 50 + (i % 9_000), late: null };
        case 'late_text':
          return { ...base, outcome: { kind: 'text', text }, latency_ms: TIMEOUT + 1 + (i % 500), late: null };
        case 'timeout_none':
          return { ...base, outcome: { kind: 'timeout' }, latency_ms: TIMEOUT, late: { kind: 'none', reason: 'aborted' } };
        case 'timeout_late':
          return { ...base, outcome: { kind: 'timeout' }, latency_ms: TIMEOUT, late: { kind: 'late', text, latency_ms: TIMEOUT + 2_000 } };
        default:
          return { ...base, outcome: { kind: 'error', code: 'model_load_failed', detail: 'GPU lost' }, latency_ms: 5, late: null };
      }
    }),
  };
}

function writeExport(exp: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ingest-prop-'));
  const file = path.join(dir, 'export.json');
  fs.writeFileSync(file, JSON.stringify(exp));
  return file;
}

/** Relative path -> sha256 of every file under `dir`, with the directory names themselves. */
function snapshot(dir: string): string {
  const lines: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        lines.push(`D ${path.relative(dir, p)}`);
        walk(p);
      } else lines.push(`F ${path.relative(dir, p)} ${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`);
    }
  };
  walk(dir);
  return lines.join('\n');
}

const entriesOf = (exp: Json): Json[] => exp['entries'] as Json[];
const isIllegal = (g: unknown): boolean => ((g as { grade: { illegal: boolean } }).grade).illegal;

// ---------------------------------------------------------------- accepted

test('Property 34 (accepted): a complete, consistent export is recorded entry for entry; late, timeout and error entries become Illegal', async () => {
  // The key sets of a headless run's records and header (R10.4, R12.5).
  const headlessEnv = makeEnv(cardSet);
  assert.equal((await capture(() => devRun(headlessEnv.deps(createFakeRuntime()), { combo: FAKE_COMBO.id }))).value, 0);
  const hdir = path.join(headlessEnv.root, 'eval/results/dev');
  const hfile = path.join(hdir, fs.readdirSync(hdir).find((f) => f.endsWith('.jsonl') && !f.endsWith('.grades.jsonl') && !f.endsWith('.perf.jsonl')) as string);
  const headless = readResultsFile(hfile);
  const recordKeys = Object.keys(headless.records[0]!).sort();
  const headerKeys = Object.keys(headless.header).sort();

  const kindsArb = fc.array(fc.constantFrom<Kind>('text', 'text', 'late_text', 'timeout_none', 'timeout_late', 'error'), { minLength: 1, maxLength: 8 });
  let accepted = 0;
  await fc.assert(
    fc.asyncProperty(kindsArb, fc.nat(), async (kinds, rot) => {
      const { env, bundle, deps } = await devSetup();
      const exp = exportFor(bundle, kinds);
      // Any entry order is fine: rotate and reverse.
      const es = entriesOf(exp);
      const k = rot % es.length;
      exp['entries'] = [...es.slice(k), ...es.slice(0, k)].reverse();
      const file = writeExport(exp);
      const { value, err } = await capture(() => ingest(deps, file));
      assert.equal(value, 0, err);

      const results = path.join(env.root, 'eval/results/dev', `${bundle.run_id}.jsonl`);
      const { header, records } = readResultsFile(results);
      assert.deepEqual(Object.keys(header).sort(), headerKeys);
      assert.deepEqual(header.fingerprint, exp['fingerprint']);
      assert.deepEqual(header.template_hashes, bundle.template_hashes);
      assert.equal(records.length, bundle.requests.length);
      assert.deepEqual(records.map((r) => [r.card_id, r.permutation]), bundle.requests.map((r) => [r.card_id, r.permutation]));
      const grades = readGradesFile(gradesPathFor(results)).grades;
      assert.equal(grades.length, bundle.requests.length);
      bundle.requests.forEach((r, i) => {
        const rec = records[i]!;
        assert.deepEqual(Object.keys(rec).sort(), recordKeys);
        assert.equal(rec.source, 'probe_page');
        const kind = kinds[i % kinds.length] as Kind;
        const lat = (es.find((e) => e['card_id'] === r.card_id && e['permutation'] === r.permutation) as Json)['latency_ms'];
        assert.equal(rec.latency_ms, lat);
        switch (kind) {
          case 'text':
            assert.equal(rec.outcome.kind, 'text');
            assert.equal(rec.late, null);
            break;
          case 'late_text':
            assert.deepEqual(rec.outcome, { kind: 'timeout' });
            assert.equal(rec.late?.kind, 'late');
            assert.ok(isIllegal(grades[i]), `late text of entry ${i} must be Illegal`);
            break;
          case 'timeout_none':
          case 'timeout_late':
            assert.deepEqual(rec.outcome, { kind: 'timeout' });
            assert.ok(isIllegal(grades[i]));
            break;
          default:
            assert.equal(rec.outcome.kind, 'error');
            assert.ok(isIllegal(grades[i]));
        }
      });
      // The export is stored byte for byte; an already-ingested run is refused and nothing changes.
      assert.equal(fs.readFileSync(path.join(env.root, 'eval/results/ingest', `${bundle.run_id}.json`), 'utf8'), fs.readFileSync(file, 'utf8'));
      const before = snapshot(path.join(env.root, 'eval/results'));
      const again = await capture(() => ingest(deps, file));
      assert.equal(again.value, 1);
      assert.match(again.err, /already ingested/);
      assert.equal(snapshot(path.join(env.root, 'eval/results')), before);
      accepted++;
    }),
    { numRuns: 6 },
  );
  assert.ok(accepted > 0);
});

// ---------------------------------------------------------------- rejected

interface Fault {
  readonly name: string;
  /** Mutates the export; `i` is a valid entry index. Returns what the rejection must name. */
  readonly apply: (e: Json, i: number) => { entry: RegExp; reason: RegExp };
}

const FAULTS: readonly Fault[] = [
  { name: 'schema violation: wrong schema id', apply: (e) => ((e['schema'] = 'llm-probe-page-export-v0'), { entry: /schema/, reason: /must be "llm-probe-page-export-v1"/ }) },
  { name: 'schema violation: missing top-level field', apply: (e) => (delete e['cold_start'], { entry: /export/, reason: /missing the field "cold_start"/ }) },
  { name: 'schema violation: unknown top-level field', apply: (e) => ((e['extra'] = 1), { entry: /export/, reason: /unknown field "extra"/ }) },
  { name: 'schema violation: fingerprint without browser version', apply: (e) => (delete ((e['fingerprint'] as Json)['browser'] as Json)['version'], { entry: /fingerprint\.browser\.version/, reason: /must be a string/ }) },
  { name: 'schema violation: fingerprint without adapter description', apply: (e) => (delete ((e['fingerprint'] as Json)['webgpu'] as Json)['description'], { entry: /fingerprint\.webgpu\.description/, reason: /must be a string/ }) },
  { name: 'schema violation: fractional latency', apply: (e, i) => ((entriesOf(e)[i]!['latency_ms'] = 12.5), { entry: new RegExp(`entries\\[${i}\\]`), reason: /whole number of milliseconds/ }) },
  { name: 'schema violation: negative latency', apply: (e, i) => ((entriesOf(e)[i]!['latency_ms'] = -1), { entry: new RegExp(`entries\\[${i}\\]`), reason: /non-negative whole number/ }) },
  { name: 'schema violation: bad timestamp', apply: (e, i) => ((entriesOf(e)[i]!['requested_at'] = '2026-11-07 10:00'), { entry: new RegExp(`entries\\[${i}\\]`), reason: /millisecond precision/ }) },
  { name: 'schema violation: unknown outcome kind', apply: (e, i) => ((entriesOf(e)[i]!['outcome'] = { kind: 'maybe' }), { entry: new RegExp(`entries\\[${i}\\]`), reason: /text, timeout or error/ }) },
  {
    name: 'late set on a non-timeout entry',
    apply: (e, from) => {
      const es = entriesOf(e);
      // The nearest entry at or after `from` (wrapping) whose outcome is not a timeout.
      const i = [...es.keys()].map((k) => (from + k) % es.length).find((k) => (es[k]!['outcome'] as Json)['kind'] !== 'timeout') as number;
      es[i]!['late'] = { kind: 'none', reason: 'aborted' };
      return { entry: new RegExp(`entries\\[${i}\\]`), reason: /null unless the outcome is a timeout/ };
    },
  },
  { name: 'unknown Card ID', apply: (e, i) => ((entriesOf(e)[i]!['card_id'] = 'D-nope-001'), { entry: new RegExp(`entries\\[${i}\\] \\(Card ID "D-nope-001"`), reason: /not part of the run/ }) },
  { name: 'unknown Permutation', apply: (e, i) => ((entriesOf(e)[i]!['permutation'] = 'perm-that-does-not-exist'), { entry: new RegExp(`entries\\[${i}\\].*perm-that-does-not-exist`), reason: /not part of the run/ }) },
  { name: 'missing entry', apply: (e, i) => (entriesOf(e).splice(i, 1), { entry: /missing entry \(Card ID/, reason: /no entry for this Card ID and Permutation/ }) },
  {
    name: 'duplicate entry',
    apply: (e, i) => {
      const n = entriesOf(e).length;
      entriesOf(e).push({ ...entriesOf(e)[i]! });
      return { entry: new RegExp(`entries\\[${n}\\]`), reason: /second entry for the same Card ID and Permutation/ };
    },
  },
  { name: 'changed Template_Hash', apply: (e) => (((e['template_hashes'] as Json)['decision'] = 'f'.repeat(64)), { entry: /template_hashes\.decision/, reason: /Template_Hash differs/ }) },
  { name: 'changed Pinned_Manifest_Hash', apply: (e) => ((e['pinned_manifest_hash'] = '0'.repeat(64)), { entry: /pinned_manifest_hash/, reason: /Pinned_Manifest_Hash differs/ }) },
  { name: 'wrong split', apply: (e) => ((e['split'] = 'locked'), { entry: /split/, reason: /but the run's is "dev"/ }) },
  { name: 'run without a bundle', apply: (e) => ((e['run_id'] = 'dev-19990101T000000Z-nothing'), { entry: /run_id/, reason: /no bundle for run/ }) },
];

test('Property 34 (rejected): any single fault rejects the whole file, names the entry and reason, and writes nothing', async () => {
  const { env, bundle, deps } = await devSetup();
  const resultsDir = path.join(env.root, 'eval/results');
  const pristine = snapshot(resultsDir);
  const seen = new Set<string>();
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...FAULTS), fc.nat(), async (fault, pick) => {
      const exp = exportFor(bundle, ['text', 'late_text', 'timeout_late', 'error']);
      const i = pick % bundle.requests.length;
      const expected = fault.apply(exp, i);
      const { value, err } = await capture(() => ingest(deps, writeExport(exp)));
      assert.equal(value, 1, `${fault.name} (entry ${i}) must exit non-zero`);
      const line = err.split('\n').find((l) => l.includes('rejected:')) as string;
      assert.ok(line, `${fault.name}: no "rejected:" line in ${err}`);
      assert.match(line, expected.entry);
      assert.match(line, expected.reason);
      assert.equal(snapshot(resultsDir), pristine, `${fault.name} (entry ${i}) must write nothing`);
      seen.add(fault.name);
    }),
    { numRuns: 80 },
  );
  assert.ok(seen.size >= FAULTS.length - 4, `coverage: only ${seen.size} of ${FAULTS.length} faults were drawn`);
});

test('Property 34 (rejected): every listed fault is rejected, one by one, at the first and the last entry', async () => {
  const { env, bundle, deps } = await devSetup();
  const resultsDir = path.join(env.root, 'eval/results');
  const pristine = snapshot(resultsDir);
  for (const fault of FAULTS) {
    for (const i of [0, bundle.requests.length - 1]) {
      const exp = exportFor(bundle);
      const expected = fault.apply(exp, i);
      const { value, err } = await capture(() => ingest(deps, writeExport(exp)));
      assert.equal(value, 1, fault.name);
      const line = err.split('\n').find((l) => l.includes('rejected:')) as string;
      assert.match(line, expected.entry, fault.name);
      assert.match(line, expected.reason, fault.name);
      assert.equal(snapshot(resultsDir), pristine, `${fault.name} must write nothing`);
    }
  }
  // The untouched export is still accepted afterwards: rejection left no state behind.
  assert.equal((await capture(() => ingest(deps, writeExport(exportFor(bundle))))).value, 0);
});
