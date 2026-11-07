// Examples for page-bundle, ingest and regrade (llm-probe task 13.7). A SYNTHETIC card set in a temp
// directory; the real eval/results, the real ledger and the real locked.jsonl are never touched.
// The properties for ingest and regrade are tasks 13.8 and 13.9.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PAGE_EXPORT_SCHEMA, parseBundle, readBundle, writeBundle, ingest, regrade, type Bundle } from '../../src/ingest.ts';
import { ingestCommand, pageBundleCommand, parseIngestArgs, parsePageBundleArgs, parseRegradeArgs, regradeCommand } from '../../src/ingest-command.ts';
import { readLedger } from '../../src/ledger.ts';
import { gradesPathFor, readGradesFile, readResultsFile } from '../../src/results.ts';
import { devRun, lockedRun } from '../../src/run.ts';
import { capture, createFakeRuntime, defaultAnswer, FAKE_COMBO, makeCardSet, makeEnv, REVISION, WORKERS_COMBO, type TestEnv } from './run.helpers.ts';

const cardSet = makeCardSet();
const NO_RUNTIME = createFakeRuntime({ script: () => Promise.reject(new Error('a bundle must not call the Runtime')) });

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

/** A temp repo, a dev bundle for it and the deps to run the commands against it. */
async function devSetup(): Promise<{ env: TestEnv; bundle: Bundle; deps: ReturnType<TestEnv['deps']> }> {
  const env = makeEnv(cardSet);
  const deps = env.deps(NO_RUNTIME, { createRuntime: () => Promise.reject(new Error('no Runtime for a bundle')) });
  const { value, err } = await capture(() => devRun(deps, { combo: FAKE_COMBO.id, pageBundle: (d) => void writeBundle(deps.paths.resultsDir, d) }));
  assert.equal(value, 0, err);
  const dir = path.join(env.root, 'eval/results/bundles');
  const [name] = fs.readdirSync(dir);
  const bundle = readBundle(deps.paths.resultsDir, (name as string).replace(/\.json$/, ''));
  return { env, bundle, deps };
}

/** An export a well-behaved page would produce for a bundle. */
function goodExport(bundle: Bundle, patch: (e: Json) => void = () => {}): Json {
  const exp: Json = {
    schema: PAGE_EXPORT_SCHEMA,
    run_id: bundle.run_id,
    split: bundle.split,
    template_hashes: { ...bundle.template_hashes },
    pinned_manifest_hash: bundle.pinned_manifest_hash,
    fingerprint: JSON.parse(JSON.stringify(FINGERPRINT)) as Json,
    cold_start: { empty_cache_ms: 41250, warm_cache_ms: 6120 },
    entries: bundle.requests.map((r, i) => ({
      card_id: r.card_id,
      permutation: r.permutation,
      outcome: { kind: 'text', text: defaultAnswer(r.prompt) },
      latency_ms: 100 + i,
      requested_at: '2026-11-07T10:15:02.118Z',
      late: null,
    })),
  };
  patch(exp);
  return exp;
}

function writeExport(exp: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ingest-export-'));
  const file = path.join(dir, 'export.json');
  fs.writeFileSync(file, typeof exp === 'string' ? exp : JSON.stringify(exp));
  return file;
}

const filesIn = (root: string, sub: string): string[] => (fs.existsSync(path.join(root, sub)) ? fs.readdirSync(path.join(root, sub)).sort() : []);
const entriesOf = (exp: Json): Json[] => exp['entries'] as Json[];

// ---------------------------------------------------------------- page-bundle

test('page-bundle (dev) renders every prompt, writes llm-probe-bundle-v1 and creates no Runtime', async () => {
  const { env, bundle } = await devSetup();
  assert.equal(bundle.schema, 'llm-probe-bundle-v1');
  assert.equal(bundle.split, 'dev');
  assert.equal(bundle.task_subset, 'DS');
  assert.equal(bundle.timeout_ms, 10_000);
  assert.equal(bundle.requests.length, 104);
  assert.equal(bundle.combination.id, FAKE_COMBO.id);
  assert.deepEqual(Object.keys(bundle.template_hashes).sort(), ['decision', 'synthesis']);
  assert.ok(bundle.requests.every((r) => r.prompt.system.length > 0 && r.prompt.user.length > 0 && (r.constraint.kind === 'json_schema' || r.constraint.kind === 'none')));
  assert.equal(NO_RUNTIME.calls.length, 0);
  // Nothing but the bundle was written: no Results, no ledger.
  assert.deepEqual(filesIn(env.root, 'eval/results'), ['bundles']);
  assert.throws(() => parseBundle({ ...JSON.parse(fs.readFileSync(path.join(env.root, 'eval/results/bundles', `${bundle.run_id}.json`), 'utf8')), extra: 1 }), /unknown field/);
});

test('page-bundle refuses a Workers AI Combination and writes nothing', async () => {
  const env = makeEnv(cardSet);
  const deps = env.deps(NO_RUNTIME);
  const { value, err } = await capture(() => devRun(deps, { combo: WORKERS_COMBO.id, pageBundle: () => assert.fail('must not be called') }));
  assert.equal(value, 1);
  assert.match(err, /in-browser/);
  assert.deepEqual(filesIn(env.root, 'eval/results'), []);
});

test('page-bundle (locked) follows the locked flow up to the ledger start: refused without a Dev_Run, then start only', async () => {
  const env = makeEnv(cardSet);
  const deps = env.deps(createFakeRuntime());
  const hook = (d: Parameters<typeof writeBundle>[1]): void => void writeBundle(deps.paths.resultsDir, d);
  const refused = await capture(() => lockedRun(deps, { combo: FAKE_COMBO.id, task: 'D', pageBundle: hook }));
  assert.equal(refused.value, 1);
  assert.match(refused.err, /dev_run_missing/);
  assert.deepEqual(filesIn(env.root, 'eval/results'), []);

  const rt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id }))).value, 0);
  const calls = rt.calls.length;
  const ok = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D', pageBundle: hook }));
  assert.equal(ok.value, 0, ok.err);
  assert.equal(rt.calls.length, calls, 'page-bundle sends nothing to any Runtime');
  const { events, entries } = readLedger(path.join(env.root, 'eval/results/ledger.jsonl'));
  assert.deepEqual(events.map((e) => e.event), ['start']);
  const entry = entries[0]!;
  assert.equal(entry.status, 'incomplete');
  const bundle = readBundle(deps.paths.resultsDir, entry.entry_id);
  assert.equal(bundle.split, 'locked');
  assert.equal(bundle.requests.length, 74);
  assert.ok(bundle.requests.every((r) => cardSet.lockedIds.includes(r.card_id)));
  // The prompts are in the bundle only; the console shows counts and IDs (R3.11).
  const all = ok.out + ok.err;
  for (const secret of ['Today is day', 'People:', 'Harold', 'June Pike', 'ladder']) assert.ok(!all.includes(secret), `output leaked ${secret}`);
  assert.deepEqual(filesIn(env.root, 'eval/results/locked'), []);
});

// ---------------------------------------------------------------- ingest: accepted

test('ingest accepts a good export: Results have the form of a headless run, grades are written, the export is stored', async () => {
  const { env, bundle, deps } = await devSetup();
  const exp = goodExport(bundle);
  const file = writeExport(exp);
  const { value, err, out } = await capture(() => ingest(deps, file));
  assert.equal(value, 0, err);
  assert.match(out, /records 104, with output 104/);

  const results = path.join(env.root, 'eval/results/dev', `${bundle.run_id}.jsonl`);
  const { header, records } = readResultsFile(results);
  assert.equal(header.run_id, bundle.run_id);
  assert.equal(header.split, 'dev');
  assert.equal(header.combination, FAKE_COMBO.id);
  assert.equal(header.timeout_ms, 10_000);
  assert.deepEqual(header.template_hashes, bundle.template_hashes);
  assert.deepEqual(header.fingerprint, exp['fingerprint']);
  assert.equal(records.length, 104);
  assert.deepEqual(records.map((r) => [r.card_id, r.permutation]), bundle.requests.map((r) => [r.card_id, r.permutation]));
  assert.ok(records.every((r) => r.source === 'probe_page' && r.outcome.kind === 'text' && r.late === null && r.usage === null));
  assert.equal(readGradesFile(gradesPathFor(results)).grades.length, 104);
  // The export is kept byte for byte.
  assert.equal(fs.readFileSync(path.join(env.root, 'eval/results/ingest', `${bundle.run_id}.json`), 'utf8'), fs.readFileSync(file, 'utf8'));

  // Same fields as a headless run's records (R10.4, R12.5): only `source` differs in value.
  const headless = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(headless), { combo: FAKE_COMBO.id }))).value, 0);
  const devDir = path.join(env.root, 'eval/results/dev');
  const other = filesIn(env.root, 'eval/results/dev').find((f) => f.endsWith('.jsonl') && !f.endsWith('.grades.jsonl') && f !== `${bundle.run_id}.jsonl`) as string;
  const headlessRun = readResultsFile(path.join(devDir, other));
  assert.deepEqual(Object.keys(headlessRun.records[0]!).sort(), Object.keys(records[0]!).sort());
  assert.deepEqual(Object.keys(headlessRun.header).sort(), Object.keys(header).sort());
  assert.equal(headlessRun.records[0]!.source, 'node');
});

test('ingest records a late answer, a Timeout marker and an error marker as Illegal; stored form is the headless one', async () => {
  const { env, bundle, deps } = await devSetup();
  const exp = goodExport(bundle, (e) => {
    const es = entriesOf(e);
    es[0]!['latency_ms'] = 10_001; // text, but after the Timeout
    es[1]!['outcome'] = { kind: 'timeout' };
    es[1]!['latency_ms'] = 10_000;
    es[2]!['outcome'] = { kind: 'timeout' };
    es[2]!['late'] = { kind: 'late', text: 'too late', latency_ms: 12_000 };
    es[3]!['outcome'] = { kind: 'error', code: 'model_load_failed', detail: 'GPU lost' };
    es[4]!['latency_ms'] = 10_000; // exactly the Timeout is still on time
  });
  const { value, err } = await capture(() => ingest(deps, writeExport(exp)));
  assert.equal(value, 0, err);
  const results = path.join(env.root, 'eval/results/dev', `${bundle.run_id}.jsonl`);
  const { records } = readResultsFile(results);
  assert.deepEqual(records[0]!.outcome, { kind: 'timeout' });
  assert.deepEqual(records[0]!.late, { kind: 'late', text: defaultAnswer(bundle.requests[0]!.prompt), latency_ms: 10_001 });
  assert.equal(records[0]!.latency_ms, 10_001);
  assert.deepEqual(records[1]!.outcome, { kind: 'timeout' });
  assert.deepEqual(records[1]!.late, { kind: 'none', reason: 'aborted' });
  assert.deepEqual(records[2]!.late, { kind: 'late', text: 'too late', latency_ms: 12_000 });
  assert.deepEqual(records[3]!.outcome, { kind: 'error', code: 'model_load_failed', detail: 'GPU lost', remote: false });
  assert.equal(records[4]!.outcome.kind, 'text');
  const grades = readGradesFile(gradesPathFor(results)).grades;
  const illegal = (i: number): boolean => (grades[i]!.grade as { illegal: boolean }).illegal;
  for (const i of [0, 1, 2, 3]) assert.ok(illegal(i), `entry ${i} should grade Illegal: ${JSON.stringify(grades[i])}`);
  assert.ok(!illegal(4));
});

// ---------------------------------------------------------------- ingest: rejected

type Mutation = { name: string; patch: (e: Json) => void; entry: RegExp; reason: RegExp };
const mutations: Mutation[] = [
  { name: 'wrong schema', patch: (e) => void (e['schema'] = 'llm-probe-page-export-v0'), entry: /schema/, reason: /must be "llm-probe-page-export-v1"/ },
  { name: 'missing top-level field', patch: (e) => void delete e['cold_start'], entry: /export/, reason: /missing the field "cold_start"/ },
  { name: 'unknown top-level field', patch: (e) => void (e['extra'] = 1), entry: /export/, reason: /unknown field "extra"/ },
  { name: 'fingerprint without the browser version', patch: (e) => void delete ((e['fingerprint'] as Json)['browser'] as Json)['version'], entry: /fingerprint\.browser\.version/, reason: /must be a string/ },
  { name: 'fingerprint without the adapter description', patch: (e) => void delete ((e['fingerprint'] as Json)['webgpu'] as Json)['description'], entry: /fingerprint\.webgpu\.description/, reason: /must be a string/ },
  { name: 'non-integer latency', patch: (e) => void (entriesOf(e)[3]!['latency_ms'] = 12.5), entry: /entries\[3\] \(Card ID/, reason: /whole number of milliseconds/ },
  { name: 'bad timestamp', patch: (e) => void (entriesOf(e)[2]!['requested_at'] = '2026-11-07 10:00'), entry: /entries\[2\]/, reason: /millisecond precision/ },
  { name: 'unknown outcome kind', patch: (e) => void (entriesOf(e)[1]!['outcome'] = { kind: 'maybe' }), entry: /entries\[1\]/, reason: /text, timeout or error/ },
  { name: 'late answer on a text outcome', patch: (e) => void (entriesOf(e)[0]!['late'] = { kind: 'none', reason: 'aborted' }), entry: /entries\[0\]/, reason: /null unless the outcome is a timeout/ },
  { name: 'unknown Card ID', patch: (e) => void (entriesOf(e)[5]!['card_id'] = 'D-nope-001'), entry: /entries\[5\] \(Card ID "D-nope-001"/, reason: /not part of the run/ },
  { name: 'unknown Permutation', patch: (e) => void (entriesOf(e)[6]!['permutation'] = 'perm-that-does-not-exist'), entry: /entries\[6\].*perm-that-does-not-exist/, reason: /not part of the run/ },
  { name: 'missing entry', patch: (e) => void entriesOf(e).splice(7, 1), entry: /missing entry \(Card ID/, reason: /no entry for this Card ID and Permutation/ },
  { name: 'duplicate entry', patch: (e) => void entriesOf(e).push({ ...entriesOf(e)[8]! }), entry: /entries\[104\]/, reason: /second entry for the same Card ID and Permutation/ },
  { name: 'changed Template_Hash', patch: (e) => void ((e['template_hashes'] as Json)['decision'] = 'f'.repeat(64)), entry: /template_hashes\.decision/, reason: /Template_Hash differs/ },
  { name: 'Template_Hash for a Task_Type the run lacks', patch: (e) => void ((e['template_hashes'] as Json)['extra'] = 'a'), entry: /template_hashes\.extra/, reason: /Template_Hash differs/ },
  { name: 'changed Pinned_Manifest_Hash', patch: (e) => void (e['pinned_manifest_hash'] = '0'.repeat(64)), entry: /pinned_manifest_hash/, reason: /Pinned_Manifest_Hash differs/ },
  { name: 'wrong split', patch: (e) => void (e['split'] = 'locked'), entry: /split/, reason: /but the run's is "dev"/ },
  { name: 'run without a bundle', patch: (e) => void (e['run_id'] = 'dev-19990101T000000Z-nothing'), entry: /run_id/, reason: /no bundle for run/ },
];

for (const m of mutations) {
  test(`ingest rejects the whole file: ${m.name}`, async () => {
    const { env, bundle, deps } = await devSetup();
    const { value, err } = await capture(() => ingest(deps, writeExport(goodExport(bundle, m.patch))));
    assert.equal(value, 1);
    assert.match(err, /probe: ingest: rejected: /);
    const line = err.split('\n').find((l) => l.includes('rejected:')) as string;
    assert.match(line, m.entry);
    assert.match(line, m.reason);
    // No Results, no grades, no stored export.
    assert.deepEqual(filesIn(env.root, 'eval/results/dev'), []);
    assert.deepEqual(filesIn(env.root, 'eval/results/ingest'), []);
  });
}

test('ingest names the FIRST failing entry when several fail', async () => {
  const { bundle, deps } = await devSetup();
  const exp = goodExport(bundle, (e) => {
    entriesOf(e)[9]!['card_id'] = 'D-nope-001';
    entriesOf(e)[4]!['card_id'] = 'D-nope-002';
    entriesOf(e).splice(20, 1);
  });
  const { err } = await capture(() => ingest(deps, writeExport(exp)));
  assert.match(err, /entries\[4\] \(Card ID "D-nope-002"/);
  assert.ok(!err.includes('D-nope-001'));
  // A schema break comes before a consistency break, whatever their positions.
  const mixed = goodExport(bundle, (e) => {
    entriesOf(e)[2]!['card_id'] = 'D-nope-003';
    entriesOf(e)[30]!['latency_ms'] = -1;
  });
  const second = await capture(() => ingest(deps, writeExport(mixed)));
  assert.match(second.err, /entries\[30\]/);
});

test('ingest rejects a file that is not JSON or cannot be read', async () => {
  const { env, deps } = await devSetup();
  const bad = await capture(() => ingest(deps, writeExport('{ not json')));
  assert.equal(bad.value, 1);
  assert.match(bad.err, /rejected: file: the export is not valid JSON/);
  const gone = await capture(() => ingest(deps, path.join(env.root, 'no-such-export.json')));
  assert.equal(gone.value, 1);
  assert.match(gone.err, /cannot read the export file/);
});

test('ingest does not rewrite a run that was already ingested', async () => {
  const { env, bundle, deps } = await devSetup();
  const file = writeExport(goodExport(bundle));
  assert.equal((await capture(() => ingest(deps, file))).value, 0);
  const results = path.join(env.root, 'eval/results/dev', `${bundle.run_id}.jsonl`);
  const before = fs.readFileSync(results, 'utf8');
  const again = await capture(() => ingest(deps, file));
  assert.equal(again.value, 1);
  assert.match(again.err, /already ingested/);
  assert.equal(fs.readFileSync(results, 'utf8'), before);
});

// ---------------------------------------------------------------- ingest: locked

test('ingest of a locked bundle completes the ledger entry and prints no card content', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id }))).value, 0);
  const deps = env.deps(rt);
  const hook = (d: Parameters<typeof writeBundle>[1]): void => void writeBundle(deps.paths.resultsDir, d);
  assert.equal((await capture(() => lockedRun(deps, { combo: FAKE_COMBO.id, task: 'DS', pageBundle: hook }))).value, 0);
  const ledger = path.join(env.root, 'eval/results/ledger.jsonl');
  const entry = readLedger(ledger).entries[0]!;
  const bundle = readBundle(deps.paths.resultsDir, entry.entry_id);
  assert.equal(bundle.requests.length, 104);

  const file = writeExport(goodExport(bundle));
  const { value, out, err } = await capture(() => ingest(deps, file));
  assert.equal(value, 0, err);
  for (const secret of ['Today is day', 'People:', '{"option"', 'Harold', 'June Pike', 'ladder']) assert.ok(!(out + err).includes(secret), `output leaked ${secret}`);
  const after = readLedger(ledger);
  assert.deepEqual(after.events.map((e) => e.event), ['start', 'complete']);
  assert.equal(after.entries[0]!.status, 'complete');
  assert.equal(after.entries[0]!.complete?.requests_sent, 104);
  assert.equal(after.entries[0]!.complete?.results, path.join('eval/results/locked', `${entry.entry_id}.jsonl`));
  const results = path.join(env.root, 'eval/results/locked', `${entry.entry_id}.jsonl`);
  assert.equal(readResultsFile(results).header.split, 'locked');
  assert.equal(readGradesFile(gradesPathFor(results)).grades.length, 104);
  assert.deepEqual(filesIn(env.root, 'eval/results/dev').filter((f) => f.includes(entry.entry_id)), []);
  // regrade over locked Results works too and prints no card content.
  const re = await capture(() => regrade(deps, results));
  assert.equal(re.value, 0, re.err);
  for (const secret of ['Today is day', 'People:', 'Harold']) assert.ok(!(re.out + re.err).includes(secret));
});

test('ingest of a locked export needs an incomplete ledger entry', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id }))).value, 0);
  const deps = env.deps(rt);
  const hook = (d: Parameters<typeof writeBundle>[1]): void => void writeBundle(deps.paths.resultsDir, d);
  assert.equal((await capture(() => lockedRun(deps, { combo: FAKE_COMBO.id, task: 'D', pageBundle: hook }))).value, 0);
  const ledger = path.join(env.root, 'eval/results/ledger.jsonl');
  const entry = readLedger(ledger).entries[0]!;
  const bundle = readBundle(deps.paths.resultsDir, entry.entry_id);
  // Remove the ledger: no entry for this run.
  const saved = fs.readFileSync(ledger, 'utf8');
  fs.rmSync(ledger);
  const noEntry = await capture(() => ingest(deps, writeExport(goodExport(bundle))));
  assert.equal(noEntry.value, 1);
  assert.match(noEntry.err, /no ledger entry/);
  assert.deepEqual(filesIn(env.root, 'eval/results/locked'), []);
  fs.writeFileSync(ledger, saved);
  assert.equal((await capture(() => ingest(deps, writeExport(goodExport(bundle))))).value, 0);
});

// ---------------------------------------------------------------- regrade

async function ingested(): Promise<{ env: TestEnv; deps: ReturnType<TestEnv['deps']>; results: string; grades: string }> {
  const { env, bundle, deps } = await devSetup();
  assert.equal((await capture(() => ingest(deps, writeExport(goodExport(bundle))))).value, 0);
  const results = path.join(env.root, 'eval/results/dev', `${bundle.run_id}.jsonl`);
  return { env, deps, results, grades: gradesPathFor(results) };
}

test('regrade reproduces byte-equal grades lines and identical Metrics with zero Runtime requests', async () => {
  const { env, results, grades } = await ingested();
  const before = [fs.readFileSync(results, 'utf8'), fs.readFileSync(grades, 'utf8')];
  const rt = createFakeRuntime();
  const { value, out, err } = await capture(() => regrade(env.deps(rt), results));
  assert.equal(value, 0, err);
  assert.match(out, /regrade: .*104 records re-graded, \d+ grades lines byte-equal, Metrics and intervals identical, 0 Runtime requests/);
  assert.equal(rt.calls.length, 0);
  assert.deepEqual([fs.readFileSync(results, 'utf8'), fs.readFileSync(grades, 'utf8')], before, 'regrade writes nothing');
});

test('regrade also works on a headless Dev_Run', async () => {
  const env = makeEnv(cardSet);
  const rt = createFakeRuntime();
  assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id }))).value, 0);
  const results = path.join(env.root, 'eval/results/dev', filesIn(env.root, 'eval/results/dev').find((f) => !f.endsWith('.grades.jsonl')) as string);
  const calls = rt.calls.length;
  const { value, err } = await capture(() => regrade(env.deps(rt), results));
  assert.equal(value, 0, err);
  assert.equal(rt.calls.length, calls);
});

test('regrade detects a tampered Results record (changed answer) and a tampered grades line, and changes nothing', async () => {
  const { env, deps, results, grades } = await ingested();
  const original = fs.readFileSync(results, 'utf8');
  const lines = original.split('\n');
  // Line 2 is the first record; replace its answer text by one that grades differently.
  const rec = JSON.parse(lines[1]!) as { outcome: { kind: string; text?: string } };
  rec.outcome = { kind: 'text', text: 'not json at all' };
  lines[1] = JSON.stringify(rec);
  fs.writeFileSync(results, lines.join('\n'));
  const tampered = fs.readFileSync(results, 'utf8');
  const gradesBefore = fs.readFileSync(grades, 'utf8');
  const r = await capture(() => regrade(deps, results));
  assert.equal(r.value, 1);
  assert.match(r.err, /regrade differs from the stored grades at this line/);
  assert.match(r.err, new RegExp(`${path.basename(grades)}:1:`));
  assert.equal(fs.readFileSync(results, 'utf8'), tampered);
  assert.equal(fs.readFileSync(grades, 'utf8'), gradesBefore);

  // A tampered grades line.
  fs.writeFileSync(results, original);
  const gl = gradesBefore.split('\n');
  gl[0] = gl[0]!.replace('"acceptable"', '"severe"').replace('"illegal"', '"acceptable"');
  assert.notEqual(gl.join('\n'), gradesBefore, 'the test must change something');
  fs.writeFileSync(grades, gl.join('\n'));
  const g = await capture(() => regrade(env.deps(createFakeRuntime()), results));
  assert.equal(g.value, 1);
  assert.match(g.err, /regrade differs from the stored grades/);
});

test('regrade stops on a Results file that does not match the schema, naming file and record, and leaves it unchanged', async () => {
  const { deps, results } = await ingested();
  const lines = fs.readFileSync(results, 'utf8').split('\n');
  const rec = JSON.parse(lines[3]!) as Record<string, unknown>;
  delete rec['latency_ms'];
  lines[3] = JSON.stringify(rec);
  fs.writeFileSync(results, lines.join('\n'));
  const text = fs.readFileSync(results, 'utf8');
  const { value, err } = await capture(() => regrade(deps, results));
  assert.equal(value, 1);
  assert.match(err, new RegExp(`${path.basename(results)}:4:`));
  assert.equal(fs.readFileSync(results, 'utf8'), text);
});

test('regrade fails when the grades file is missing', async () => {
  const { deps, results, grades } = await ingested();
  fs.rmSync(grades);
  const { value, err } = await capture(() => regrade(deps, results));
  assert.equal(value, 1);
  assert.match(err, /no grades file to compare with/);
});

// ---------------------------------------------------------------- CLI

test('CLI flags: page-bundle, ingest and regrade', () => {
  const ok = parsePageBundleArgs(['--combo', 'x', '--split', 'locked', '--task', 'DS', '--rerun-reason', 'why']);
  assert.ok(ok.ok && ok.options.split === 'locked' && ok.options.task === 'DS' && ok.options.rerunReason === 'why');
  assert.ok(!parsePageBundleArgs(['--combo', 'x', '--split', 'both', '--task', 'D']).ok);
  assert.ok(!parsePageBundleArgs(['--combo', 'x', '--split', 'dev']).ok);
  assert.ok(!parsePageBundleArgs(['--split', 'dev', '--task', 'D']).ok);
  assert.ok(!parsePageBundleArgs(['--combo', 'x', '--split', 'dev', '--task', 'D', '--rerun-reason', 'why']).ok);
  assert.ok(!parsePageBundleArgs(['--combo', 'x', '--split', 'dev', '--task', 'D', '--approval', 'A-1']).ok);
  const ing = parseIngestArgs(['--file', '/tmp/e.json']);
  assert.ok(ing.ok && ing.options.file === '/tmp/e.json');
  assert.ok(!parseIngestArgs([]).ok);
  const re = parseRegradeArgs(['--results', '/tmp/r.jsonl']);
  assert.ok(re.ok && re.options.results === '/tmp/r.jsonl');
  assert.ok(!parseRegradeArgs(['--file', 'x']).ok);
});

test('the commands run end to end through their CLI entry points', async () => {
  const env = makeEnv(cardSet);
  const deps = env.deps(NO_RUNTIME, { createRuntime: () => Promise.reject(new Error('no Runtime for a bundle')) });
  const b = await capture(() => pageBundleCommand(['--combo', FAKE_COMBO.id, '--split', 'dev', '--task', 'D'], deps));
  assert.equal(b.value, 0, b.err);
  assert.match(b.out, /probe: bundle written eval\/results\/bundles\/dev-.*\.json \(74 requests, run dev-/);
  const bundle = readBundle(deps.paths.resultsDir, (filesIn(env.root, 'eval/results/bundles')[0] as string).replace(/\.json$/, ''));
  const file = writeExport(goodExport(bundle));
  assert.equal((await capture(() => ingestCommand(['--file', file], deps))).value, 0);
  const results = path.join(env.root, 'eval/results/dev', `${bundle.run_id}.jsonl`);
  assert.equal((await capture(() => regradeCommand(['--results', results], deps))).value, 0);
  assert.equal((await capture(() => ingestCommand([], deps))).value, 2);
});

test('ingest.ts never renders a prompt (R3.1): it does not import llm_render_prompt', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../../src/ingest.ts', import.meta.url)), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/llmRenderPrompt|llm_render_prompt|renderPlan/.test(code));
});
