// Feature: llm-probe, Property 25: The once-only rule follows the Model_Key
// **Validates: Requirements 3.6, 3.7, 3.8, 3.10, 3.12, 3.15, 18.5**
//
// Two parts. (1) The pure ledger functions (decideOverlap, checkResume, chooseReportEntries) against a
// plain model over random ledgers. (2) lockedRun with the fake Runtime on a SYNTHETIC card set in temp
// directories, driven by random request sequences. Neither part touches the real locked split or
// eval/results.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import fc from 'fast-check';
import {
  checkResume,
  chooseReportEntries,
  decideOverlap,
  deriveEntries,
  isValidRerunReason,
  LEDGER_SCHEMA,
  modelKeyString,
  readLedger,
  subsetTaskTypes,
  subsetsOverlap,
  type LedgerEntry,
  type LedgerEvent,
  type LedgerStart,
} from '../../src/ledger.ts';
import { comboModelKey, parseCombinations, type Combination } from '../../src/phase.ts';
import type { ModelKey, TaskSubset } from '../../src/results.ts';
import { devRun, lockedRun, RuntimeLoadError, type RunDeps } from '../../src/run.ts';
import type { TaskType } from '../../src/cards.ts';
import { capture, createFakeRuntime, makeCardSet, makeEnv, REVISION, templatesCopy, type TestEnv } from './run.helpers.ts';

const SUBSETS: readonly TaskSubset[] = ['D', 'S', 'DS'];
const REASONS: readonly (string | undefined)[] = [undefined, '', '   ', '\t\n ', 'fixing a thing', '  padded reason  '];
const hasReason = (r: string | undefined): boolean => isValidRerunReason(r);

// ------------------------------------------------------------------ part 1: pure functions

const KEYS: readonly ModelKey[] = [
  { runtime: 'r1', model_id: 'm1', quantization: 'q4', revision: 'a'.repeat(40) },
  { runtime: 'r1', model_id: 'm1', quantization: 'q8', revision: 'a'.repeat(40) },
  { runtime: 'r1', model_id: 'm2', quantization: 'q4', revision: 'a'.repeat(40) },
  { runtime: 'r1', model_id: 'm1', quantization: 'q4', revision: 'b'.repeat(40) },
  { runtime: 'r2', model_id: 'm1', quantization: 'q4', revision: 'a'.repeat(40) },
];

interface Spec {
  key: number;
  subset: TaskSubset;
  hash: number;
  slug: number;
  status: 'complete' | 'incomplete' | 'aborted';
}
const specArb: fc.Arbitrary<Spec> = fc.record({
  key: fc.integer({ min: 0, max: KEYS.length - 1 }),
  subset: fc.constantFrom(...SUBSETS),
  hash: fc.integer({ min: 0, max: 1 }),
  slug: fc.integer({ min: 0, max: 2 }),
  status: fc.constantFrom('complete', 'incomplete', 'aborted'),
});

function startEvent(i: number, s: Spec): LedgerStart {
  return {
    schema: LEDGER_SCHEMA,
    event: 'start',
    entry_id: `E${i}`,
    model_key: KEYS[s.key] as ModelKey,
    combination: `combo-${s.slug}`,
    task_subset: s.subset,
    fingerprint: { n: s.slug },
    template_hashes: { decision: `h${s.hash}`, synthesis: `h${s.hash}` },
    started_at: new Date(Date.parse('2026-11-07T00:00:00.000Z') + i * 1000).toISOString(),
    rerun_of: null,
    rerun_reason: null,
    overlaps: [],
    approval: null,
    planned: {},
  };
}

function ledgerOf(specs: readonly Spec[]): { entries: LedgerEntry[]; specs: readonly Spec[] } {
  const events: LedgerEvent[] = [];
  specs.forEach((s, i) => {
    events.push(startEvent(i, s));
    const at = new Date(Date.parse('2026-11-07T00:00:00.000Z') + i * 1000 + 500).toISOString();
    if (s.status === 'complete') events.push({ schema: LEDGER_SCHEMA, event: 'complete', entry_id: `E${i}`, ended_at: at, results: 'x', requests_sent: 1 });
    if (s.status === 'aborted') events.push({ schema: LEDGER_SCHEMA, event: 'abort', entry_id: `E${i}`, at, reason: 'budget' });
  });
  return { entries: deriveEntries(events), specs };
}

test('Property 25 (pure): refused iff an entry of the same Model_Key with an overlapping subset exists and the reason is not valid', () => {
  fc.assert(
    fc.property(fc.array(specArb, { maxLength: 12 }), fc.integer({ min: 0, max: KEYS.length - 1 }), fc.constantFrom(...SUBSETS), fc.constantFrom(...REASONS), (specs, k, subset, reason) => {
      const { entries } = ledgerOf(specs);
      const key = KEYS[k] as ModelKey;
      // Template hashes, Combination slugs and status play no part: only Model_Key and subset do.
      const ids = specs.flatMap((s, i) => (s.key === k && subsetsOverlap(s.subset, subset) ? [`E${i}`] : []));
      const d = decideOverlap(entries, key, subset, reason);
      if (ids.length === 0) {
        assert.deepEqual(d, { kind: 'new', rerun_of: null, rerun_reason: null, overlaps: [] });
      } else if (!hasReason(reason)) {
        assert.equal(d.kind, 'refused');
        assert.deepEqual(d.overlaps, ids);
        for (const id of ids) assert.ok(d.kind === 'refused' && d.message.includes(id));
      } else {
        assert.equal(d.kind, 'rerun');
        if (d.kind === 'rerun') {
          assert.equal(d.rerun_of, ids[ids.length - 1]); // start times grow with the index: the latest-started overlap
          assert.deepEqual(d.overlaps, ids);
          assert.equal(d.rerun_reason, reason);
        }
      }
    }),
    { numRuns: 300 },
  );
});

test('Property 25 (pure): disjoint subsets of one Model_Key are never re-runs, in either order', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: KEYS.length - 1 }), fc.constantFrom<[TaskSubset, TaskSubset]>(['D', 'S'], ['S', 'D']), fc.constantFrom('complete', 'incomplete', 'aborted'), fc.constantFrom(...REASONS), (k, [first, second], status, reason) => {
      const { entries } = ledgerOf([{ key: k, subset: first, hash: 0, slug: 0, status }]);
      assert.equal(decideOverlap(entries, KEYS[k] as ModelKey, second, reason).kind, 'new');
    }),
    { numRuns: 60 },
  );
});

test('Property 25 (pure): a resume is allowed exactly when Model_Key, fingerprint ID and every Template_Hash match', () => {
  fc.assert(
    fc.property(specArb, fc.integer({ min: 0, max: KEYS.length - 1 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 1 }), (spec, k, fpSlug, hash) => {
      const { entries } = ledgerOf([{ ...spec, status: 'incomplete' }]);
      const entry = entries[0] as LedgerEntry;
      const mismatches = checkResume(entry, {
        model_key: KEYS[k] as ModelKey,
        fingerprint: { n: fpSlug },
        template_hashes: { decision: `h${hash}`, synthesis: `h${hash}` },
      });
      const fields = mismatches.map((m) => m.field).sort();
      const expected = [...(k !== spec.key ? ['model_key'] : []), ...(fpSlug !== spec.slug ? ['fingerprint_id'] : []), ...(hash !== spec.hash ? ['template_hashes'] : [])].sort();
      assert.deepEqual(fields, expected);
    }),
    { numRuns: 200 },
  );
});

test('Property 25 (pure): the Report uses the earliest-started complete entry per Model_Key and Task_Type', () => {
  fc.assert(
    fc.property(fc.array(specArb, { maxLength: 12 }), (specs) => {
      const { entries } = ledgerOf(specs);
      const expected = new Map<string, string | null>();
      specs.forEach((s, i) => {
        for (const t of subsetTaskTypes(s.subset)) {
          const id = `${modelKeyString(KEYS[s.key] as ModelKey)}|${t}`;
          if (!expected.has(id)) expected.set(id, null);
          if (s.status === 'complete' && expected.get(id) === null) expected.set(id, `E${i}`); // first complete in start order
        }
      });
      const got = new Map(chooseReportEntries(entries).map((c) => [`${modelKeyString(c.model_key)}|${c.task}`, c.used] as const));
      assert.deepEqual(got, expected);
    }),
    { numRuns: 300 },
  );
});

// ------------------------------------------------------------------ part 2: lockedRun on a synthetic card set

const SAMPLING = { temperature: 0, top_p: null, seed: 7, max_output_tokens: { decision: 64, synthesis: 1024 } };
function mk(id: string, over: Record<string, unknown>, seed = 7): Combination {
  return parseCombinations(
    JSON.stringify([
      { id, runtime: 'fake-runtime', model_id: 'Fake-1B', quantization: 'q4', revision: REVISION, phase1_locked: true, sampling: { ...SAMPLING, seed }, chat_template_kwargs: { enable_thinking: false }, constraint: 'json_schema', ...over },
    ]),
  )[0] as Combination;
}
/** c0 and c1 share a Model_Key but differ in id, sampling and (via templatesDir) Template_Hash. */
const COMBOS: readonly Combination[] = [
  mk('fake/a', {}),
  mk('fake/a-alt', {}, 9),
  mk('fake/b', { model_id: 'Fake-2B' }),
  mk('fake/c', { quantization: 'q8' }),
  mk('fake/d', { revision: 'b'.repeat(40) }),
  mk('fake/e', { runtime: 'other-runtime' }),
];
const VARIANT = 1; // index of the Combination that runs with a changed decision template

let base: TestEnv;
let variantTemplates: string;
let cleanup: string[] = [];

function depsFor(env: TestEnv, rt: ReturnType<typeof createFakeRuntime>, combo: number): RunDeps {
  const d = env.deps(rt, { combinations: COMBOS });
  return combo === VARIANT ? { ...d, paths: { ...d.paths, templatesDir: variantTemplates } } : d;
}

before(async () => {
  variantTemplates = templatesCopy({ file: 'decision.v1.txt', map: (t) => `${t}\nExtra line.\n` });
  base = makeEnv(makeCardSet());
  cleanup.push(base.root);
  // One Dev_Run (DS) per Combination covers every Task_Type_Subset below.
  for (let i = 0; i < COMBOS.length; i++) {
    const r = await capture(() => devRun(depsFor(base, createFakeRuntime(), i), { combo: (COMBOS[i] as Combination).id, task: 'DS' }));
    assert.equal(r.value, 0, r.err);
  }
});

function freshEnv(): TestEnv {
  const env = makeEnv(base.cards);
  cpSync(path.join(base.root, 'eval/results'), path.join(env.root, 'eval/results'), { recursive: true });
  cleanup.push(env.root);
  return env;
}

function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir).sort()) {
      const f = path.join(dir, n);
      if (statSync(f).isDirectory()) walk(f);
      else out.set(path.relative(root, f), createHash('sha256').update(readFileSync(f)).digest('hex'));
    }
  };
  const top = path.join(root, 'eval/results');
  if (existsSync(top)) walk(top);
  return out;
}

function ledgerBytes(env: TestEnv): string {
  try {
    return readFileSync(path.join(env.root, 'eval/results/ledger.jsonl'), 'utf8');
  } catch {
    return '';
  }
}

type Op = { kind: 'new'; combo: number; subset: TaskSubset; reason: string | undefined; fail: boolean } | { kind: 'resume'; pick: number };
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant<'new'>('new'), combo: fc.constantFrom(0, 0, 1, 1, 2, 3, 4, 5), subset: fc.constantFrom(...SUBSETS), reason: fc.constantFrom(...REASONS), fail: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant<'resume'>('resume'), pick: fc.nat(8) }) },
);

interface ModelEntry {
  id: string;
  combo: number;
  subset: TaskSubset;
  complete: boolean;
}

const callsFor = (s: TaskSubset): number => (s === 'D' ? 74 : s === 'S' ? 30 : 104);

test('Property 25 (lockedRun): refusal, re-run records, disjoint subsets, resume and the Report entry follow the Model_Key', { timeout: 280_000 }, async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 5 }), async (ops) => {
      const env = freshEnv();
      const model: ModelEntry[] = [];
      for (const op of ops) {
        const before = snapshot(env.root);
        const ledgerBefore = ledgerBytes(env);
        const eventsBefore = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).events.length;
        if (op.kind === 'resume') {
          const open = model.filter((e) => !e.complete);
          if (open.length === 0) continue;
          const target = open[op.pick % open.length] as ModelEntry;
          const rt = createFakeRuntime();
          const r = await capture(() => lockedRun(depsFor(env, rt, target.combo), { resume: target.id }));
          assert.equal(r.value, 0, r.err);
          assert.equal(rt.calls.length, callsFor(target.subset)); // every request was missing; same entry continued
          const ledger = readLedger(path.join(env.root, 'eval/results/ledger.jsonl'));
          assert.deepEqual(ledger.events.slice(eventsBefore).map((e) => `${e.event}:${e.entry_id}`), [`resume:${target.id}`, `complete:${target.id}`]);
          assert.equal(ledger.entries.length, model.length); // no new start: a resume is not a re-run
          assert.ok(ledgerBytes(env).startsWith(ledgerBefore));
          for (const [file, hash] of before) if (!file.includes(target.id) && file !== 'eval/results/ledger.jsonl') assert.equal(snapshot(env.root).get(file), hash, file);
          target.complete = true;
          continue;
        }
        const key = modelKeyString(comboModelKey(COMBOS[op.combo] as Combination));
        const overlaps = model.filter((e) => modelKeyString(comboModelKey(COMBOS[e.combo] as Combination)) === key && subsetsOverlap(e.subset, op.subset));
        const rt = createFakeRuntime(op.fail ? { loadError: new RuntimeLoadError('model_load_failed', 'weights missing') } : {});
        const r = await capture(() => lockedRun(depsFor(env, rt, op.combo), { combo: (COMBOS[op.combo] as Combination).id, task: op.subset, rerunReason: op.reason }));
        const after = snapshot(env.root);
        if (overlaps.length > 0 && !hasReason(op.reason)) {
          assert.equal(r.value, 1);
          assert.equal(rt.calls.length, 0);
          assert.deepEqual(rt.engine, []); // not even a Runtime was created
          for (const e of overlaps) assert.ok(r.err.includes(e.id), `error names ${e.id}`);
          assert.deepEqual(after, before); // ledger and Results unchanged, byte for byte
          continue;
        }
        const ledger = readLedger(path.join(env.root, 'eval/results/ledger.jsonl'));
        assert.equal(r.value, op.fail ? 1 : 0, r.err);
        assert.equal(ledger.entries.length, model.length + 1);
        const start = ledger.entries[model.length]?.start as LedgerStart;
        assert.equal(start.combination, (COMBOS[op.combo] as Combination).id);
        assert.equal(start.task_subset, op.subset);
        assert.equal(modelKeyString(start.model_key), key);
        if (overlaps.length === 0) {
          assert.equal(start.rerun_of, null);
          assert.equal(start.rerun_reason, null);
          assert.deepEqual(start.overlaps, []);
        } else {
          assert.equal(start.rerun_of, overlaps[overlaps.length - 1]?.id); // latest-started overlap
          assert.deepEqual(start.overlaps, overlaps.map((e) => e.id));
          assert.equal(start.rerun_reason, op.reason);
        }
        // Earlier entries and their Results stay byte-identical; the ledger and failures only grow.
        assert.ok(ledgerBytes(env).startsWith(ledgerBefore));
        for (const [file, hash] of before) if (file !== 'eval/results/ledger.jsonl' && file !== 'eval/results/failures.jsonl') assert.equal(after.get(file), hash, file);
        model.push({ id: start.entry_id, combo: op.combo, subset: op.subset, complete: !op.fail });
        assert.equal(ledger.entries[model.length - 1]?.status, op.fail ? 'incomplete' : 'complete');
      }
      // The Report entry per Model_Key and Task_Type: the earliest-started complete entry covering it.
      const expected = new Map<string, string | null>();
      for (const e of model) {
        for (const t of subsetTaskTypes(e.subset) as TaskType[]) {
          const id = `${modelKeyString(comboModelKey(COMBOS[e.combo] as Combination))}|${t}`;
          if (!expected.has(id)) expected.set(id, null);
          if (e.complete && expected.get(id) === null) expected.set(id, e.id);
        }
      }
      const entries = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries;
      const got = new Map(chooseReportEntries(entries).map((c) => [`${modelKeyString(c.model_key)}|${c.task}`, c.used] as const));
      assert.deepEqual(got, expected);
    }),
    { numRuns: 25 },
  );
});

test('Property 25 (lockedRun): a failed Dev_Run precondition or pre-render writes no ledger entry and uses no once-only slot', async () => {
  const bogus = templatesCopy({ file: 'decision.v1.txt', map: (t) => t.replace('{{subject}}', '{{bogus}}') });
  const cases: { name: string; subset: TaskSubset; setup: 'none' | 'partial' | 'changed' | 'render' }[] = [];
  for (const subset of SUBSETS) {
    // The changed and broken template is the decision one, so those cases need D in the subset.
    for (const setup of ['none', 'changed', 'render'] as const) if (setup === 'none' || subset !== 'S') cases.push({ name: `${setup}/${subset}`, subset, setup });
  }
  cases.push({ name: 'partial/S', subset: 'S', setup: 'partial' }, { name: 'partial/DS', subset: 'DS', setup: 'partial' });
  for (const c of cases) {
    // Combination "fake/e" has a Model_Key of its own, so only this case's runs can touch its slot.
    const env = makeEnv(base.cards);
    cleanup.push(env.root);
    const rt = createFakeRuntime();
    const combo = COMBOS[5] as Combination;
    const plain = depsFor(env, rt, 5);
    const withBogus: RunDeps = { ...plain, paths: { ...plain.paths, templatesDir: bogus } };
    if (c.setup === 'partial') assert.equal((await capture(() => devRun(plain, { combo: combo.id, task: 'D' }))).value, 0);
    if (c.setup === 'changed') assert.equal((await capture(() => devRun(plain, { combo: combo.id, task: c.subset }))).value, 0);
    if (c.setup === 'render') assert.equal((await capture(() => devRun(withBogus, { combo: combo.id, task: c.subset }))).value, 0);
    const calls = rt.calls.length;
    const before = snapshot(env.root);
    const bad = c.setup === 'changed' ? depsFor(env, rt, VARIANT) : c.setup === 'render' ? withBogus : plain;
    const badDeps: RunDeps = c.setup === 'changed' ? { ...bad, paths: { ...bad.paths, templatesDir: variantTemplates } } : bad;
    const r = await capture(() => lockedRun(badDeps, { combo: combo.id, task: c.subset }));
    assert.equal(r.value, 1, c.name);
    assert.equal(rt.calls.length, calls, c.name);
    assert.deepEqual(snapshot(env.root), before, c.name);
    assert.equal(ledgerBytes(env), '', c.name);
    // The slot is still free: after a proper Dev_Run the same request starts a new Locked_Run, not a re-run.
    assert.equal((await capture(() => devRun(plain, { combo: combo.id, task: c.subset }))).value, 0, c.name);
    const ok = await capture(() => lockedRun(plain, { combo: combo.id, task: c.subset }));
    assert.equal(ok.value, 0, `${c.name}: ${ok.err}`);
    const entries = readLedger(path.join(env.root, 'eval/results/ledger.jsonl')).entries;
    assert.equal(entries.length, 1, c.name);
    assert.equal(entries[0]?.start.rerun_of, null, c.name);
  }
});

test('cleanup', async () => {
  const { rmSync } = await import('node:fs');
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
  cleanup = [];
});
