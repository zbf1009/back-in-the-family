// Property 46 (llm-probe task 31.3): an External_Reference is accepted only whole and never touches a mark.
// **Validates: Requirements 19.15, 19.16, 3.1**
// A SYNTHETIC card set in temp directories (the real eval/results and locked.jsonl are never touched). Each case writes a
// reference file and the files it names, injects at most one fault, and runs the real `ingest-reference` command.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { differingFigures, FIGURE_NAMES, readExternalRecords, type Figures } from '../../src/external.ts';
import { ingestReferenceCommand } from '../../src/external-command.ts';
import { buildReport, type ReportInput } from '../../src/report.ts';
import { capture } from './run.helpers.ts';
import {
  cardContentStrings,
  makeRepo,
  oracleFigures,
  rawLinesOf,
  rewriteReference,
  sha,
  snapshot,
  writeReference,
  type RawSpec,
  type RefFiles,
} from './external.helpers.ts';

type Member = 'config' | 'ledger' | 'results' | 'raw_outputs';
const MEMBERS: readonly Member[] = ['config', 'ledger', 'results', 'raw_outputs'];

/** One injected fault and the field the command must name. `needsRaw` faults only apply when raw outputs are supplied. */
interface Fault {
  readonly name: string;
  readonly field: string;
  readonly needsRaw: boolean;
  readonly apply: (r: RefFiles, ref: Record<string, unknown>) => Record<string, unknown>;
}

const set = (ref: Record<string, unknown>, k: string, v: unknown): Record<string, unknown> => ({ ...ref, [k]: v });
const drop = (ref: Record<string, unknown>, k: string): Record<string, unknown> => Object.fromEntries(Object.entries(ref).filter(([key]) => key !== k));
const nested = (ref: Record<string, unknown>, k: string, patch: Record<string, unknown>): Record<string, unknown> => set(ref, k, { ...(ref[k] as Record<string, unknown>), ...patch });
const WRONG_HEX = 'f'.repeat(64);

const FAULTS: readonly Fault[] = [
  { name: 'wrong pinned_manifest_hash', field: 'pinned_manifest_hash', needsRaw: false, apply: (_r, ref) => set(ref, 'pinned_manifest_hash', WRONG_HEX) },
  ...MEMBERS.flatMap((m): Fault[] => {
    const needsRaw = m === 'raw_outputs';
    return [
      { name: `wrong sha256 of ${m}`, field: `${m}.sha256`, needsRaw, apply: (_r, ref) => nested(ref, m, { sha256: WRONG_HEX }) },
      { name: `absolute path for ${m}`, field: `${m}.file`, needsRaw, apply: (r, ref) => nested(ref, m, { file: r.files[m] ?? '/etc/hostname' }) },
      { name: `.. path for ${m}`, field: `${m}.file`, needsRaw, apply: (r, ref) => nested(ref, m, { file: `../${path.basename(r.dir)}/${path.relative(r.dir, r.files[m] ?? r.refPath)}` }) },
    ];
  }),
  ...['schema', 'label', 'reference_model', 'task_type', 'pinned_manifest_hash', 'config', 'ledger', 'results', 'raw_outputs', 'figures'].map(
    (k): Fault => ({ name: `missing ${k}`, field: k, needsRaw: false, apply: (_r, ref) => drop(ref, k) }),
  ),
  { name: 'missing ledger.sha256', field: 'ledger.sha256', needsRaw: false, apply: (_r, ref) => nested(ref, 'ledger', { sha256: undefined }) },
  { name: 'missing figures.flips', field: 'figures.flips', needsRaw: false, apply: (_r, ref) => nested(ref, 'figures', { flips: undefined }) },
  { name: 'schema of the wrong value', field: 'schema', needsRaw: false, apply: (_r, ref) => set(ref, 'schema', 'llm-probe-external-reference-v0') },
  { name: 'label of the wrong type', field: 'label', needsRaw: false, apply: (_r, ref) => set(ref, 'label', 5) },
  { name: 'reference_model of the wrong type', field: 'reference_model', needsRaw: false, apply: (_r, ref) => set(ref, 'reference_model', ['x']) },
  { name: 'task_type of the wrong value', field: 'task_type', needsRaw: false, apply: (_r, ref) => set(ref, 'task_type', 'DS') },
  { name: 'pinned_manifest_hash of the wrong type', field: 'pinned_manifest_hash', needsRaw: false, apply: (_r, ref) => set(ref, 'pinned_manifest_hash', 7) },
  { name: 'config of the wrong type', field: 'config', needsRaw: false, apply: (_r, ref) => set(ref, 'config', 'config.json') },
  { name: 'ledger.sha256 of the wrong type', field: 'ledger.sha256', needsRaw: false, apply: (_r, ref) => nested(ref, 'ledger', { sha256: 5 }) },
  { name: 'results of the wrong type', field: 'results', needsRaw: false, apply: (_r, ref) => set(ref, 'results', null) },
  { name: 'raw_outputs of the wrong type', field: 'raw_outputs', needsRaw: false, apply: (_r, ref) => set(ref, 'raw_outputs', 'raw-outputs.jsonl') },
  { name: 'figures of the wrong type', field: 'figures', needsRaw: false, apply: (_r, ref) => set(ref, 'figures', 'many') },
  { name: 'a figure that is not an integer', field: 'figures.acceptable', needsRaw: false, apply: (_r, ref) => nested(ref, 'figures', { acceptable: 1.5 }) },
  { name: 'ledger line that is not valid JSON', field: 'ledger.content', needsRaw: false, apply: (r, ref) => withContent(r, ref, 'ledger', '{"event":"start"}\nthis is not json\n') },
  { name: 'results line that is not an object', field: 'results.content', needsRaw: false, apply: (r, ref) => withContent(r, ref, 'results', '[1,2]\n') },
  { name: 'raw-output line that is not valid JSON', field: 'raw_outputs.content', needsRaw: true, apply: (r, ref) => withContent(r, ref, 'raw_outputs', 'garbage\n') },
  { name: 'raw-output line without raw', field: 'raw_outputs.content', needsRaw: true, apply: (r, ref) => withContent(r, ref, 'raw_outputs', '{"card_id":"x","permutation":"base"}\n') },
];

/** Replaces a named file's content and fixes its sha256, so that only the content is wrong. */
function withContent(r: RefFiles, ref: Record<string, unknown>, member: Member, text: string): Record<string, unknown> {
  fs.writeFileSync(r.files[member] as string, text);
  return nested(ref, member, { sha256: sha(text) });
}

const rawSpecArb: fc.Arbitrary<RawSpec> = fc.record({
  card: fc.nat(200),
  permutation: fc.constantFrom('base' as const, 'reversed' as const, 'rot1' as const),
  kind: fc.constantFrom('valid' as const, 'valid' as const, 'junk' as const, 'badoption' as const),
  option: fc.nat(4),
});

const caseArb = fc.record({
  task: fc.constantFrom('D' as const, 'D' as const, 'S' as const),
  withRaw: fc.boolean(),
  specs: fc.array(rawSpecArb, { minLength: 0, maxLength: 24 }),
  honest: fc.boolean(),
  bump: fc.constantFrom(...FIGURE_NAMES),
  loose: fc.array(fc.nat(50), { minLength: 8, maxLength: 8 }),
  mode: fc.constantFrom('json' as const, 'raw_choice' as const),
  fault: fc.nat(FAULTS.length),
  injectFault: fc.boolean(),
});

const REPORT_BASE: ReportInput = {
  generated_on: '2026-11-09',
  environment: { targetMachine: 'Test machine', workersEndpoint: null },
  state: { combinations: [], entries: [], failures: [], exclusions: [], smoke: [], approvals: { approved: true, approvals: [] } },
  lockedRuns: [],
  incompleteFaults: new Map(),
  devRuns: [],
  preflights: new Map(),
  runtimeLibraries: [],
};

const sectionsOf = (report: string): string[] => report.split(/\n(?=## )/);

test('Property 46: an External_Reference is accepted only whole, writes only under its label, and never touches a mark', async () => {
  const contentStrings = cardContentStrings();
  assert.ok(contentStrings.length > 20, 'the synthetic cards must give content strings to look for');
  let accepted = 0;
  let rejected = 0;
  let regraded = 0;
  let mismatches = 0;
  const faultsSeen = new Set<string>();

  await fc.assert(
    fc.asyncProperty(caseArb, async (c) => {
      const { env, deps } = makeRepo();
      const mode = c.task === 'D' ? c.mode : 'json';
      const lines = c.withRaw ? rawLinesOf(c.task, c.specs) : null;
      const oracle = lines === null ? null : oracleFigures(c.task, mode, lines);
      const loose = Object.fromEntries(FIGURE_NAMES.map((n, i) => [n, c.loose[i] as number])) as unknown as Figures;
      const supplied: Figures = oracle === null ? loose : c.honest ? oracle : { ...oracle, [c.bump]: oracle[c.bump] + 1 };
      const r = writeReference({ task: c.task, lines, mode, figures: supplied, pinned: deps.pinnedManifestHash, label: 'ref-a' });

      const candidates = FAULTS.filter((f) => !f.needsRaw || lines !== null);
      const fault = c.injectFault ? (candidates[c.fault % candidates.length] as Fault) : null;
      if (fault !== null) {
        faultsSeen.add(fault.name);
        rewriteReference(r, fault.apply(r, r.ref));
      }

      const before = snapshot(env.root);
      const ledgerBefore = fs.readFileSync(deps.paths.ledger, 'utf8');
      const budgetBefore = fs.readFileSync(deps.paths.budgetFile, 'utf8');
      const reportBefore = buildReport({ ...REPORT_BASE, external: [] });
      const realFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = (() => {
        requests++;
        return Promise.reject(new Error('no request may be sent'));
      }) as typeof fetch;
      let run;
      try {
        run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
      } finally {
        globalThis.fetch = realFetch;
      }
      assert.equal(requests, 0, 'the ingest sends no request');
      const output = run.out + run.err;
      for (const s of contentStrings) assert.ok(!output.includes(s), 'the ingest prints no Card content');

      const after = snapshot(env.root);
      assert.equal(fs.readFileSync(deps.paths.ledger, 'utf8'), ledgerBefore, 'the ledger bytes are unchanged');
      assert.equal(fs.readFileSync(deps.paths.budgetFile, 'utf8'), budgetBefore, 'the budget counter is unchanged');

      if (fault !== null) {
        rejected++;
        assert.equal(run.value, 1, output);
        assert.ok(run.err.includes(`probe: external_reference: ${fault.field}: `), `expected field ${fault.field} for "${fault.name}", got: ${run.err}`);
        assert.deepEqual(after, before, 'a rejected file writes nothing');
        assert.ok(!fs.existsSync(path.join(env.root, 'eval/results/external')));
        return;
      }

      accepted++;
      assert.equal(run.value, 0, output);
      const dir = path.join(env.root, 'eval/results/external/ref-a');
      const added = [...after.keys()].filter((p) => !before.has(p));
      assert.ok(added.length > 0 && added.every((p) => p.startsWith(`${dir}${path.sep}`)), 'only files under eval/results/external/<label>/ are added');
      assert.deepEqual([...before].filter(([p, h]) => after.get(p) !== h), [], 'no existing file changes');
      const expectedNames = ['reference.json', 'record.json', 'config.json', 'ledger.jsonl', 'results.jsonl', ...(lines === null ? [] : ['raw-outputs.jsonl'])].sort();
      assert.deepEqual(fs.readdirSync(dir).sort(), expectedNames);
      assert.equal(sha(fs.readFileSync(path.join(dir, 'reference.json'))), sha(fs.readFileSync(r.refPath)), 'the reference file is stored unchanged');
      assert.equal(sha(fs.readFileSync(path.join(dir, 'ledger.jsonl'))), sha(fs.readFileSync(r.files.ledger)), 'a named file is stored unchanged');

      const [record] = readExternalRecords(path.join(env.root, 'eval/results'));
      assert.ok(record !== undefined);
      assert.deepEqual(record.supplied, supplied);
      assert.equal(record.config.sha256, sha(fs.readFileSync(r.files.config)));
      if (oracle === null || lines === null) {
        assert.equal(record.regrade, null);
        assert.equal(record.regrade_figures, null);
        assert.deepEqual(record.differing, []);
      } else {
        regraded++;
        assert.deepEqual(record.regrade_figures, oracle, 'the stored re-grade equals the Metrics computed on the same outputs');
        const differ = differingFigures(supplied, oracle);
        assert.deepEqual(record.differing, differ);
        assert.equal(record.regrade, differ.length === 0 ? 'match' : 'mismatch');
        assert.equal(record.raw_output_count, lines.length);
        if (differ.length > 0) {
          mismatches++;
          assert.ok(run.out.includes('MISMATCH') && differ.every((n) => run.out.includes(n)), 'the command prints the differing names');
        }
      }

      // The Report: section 12 lists the reference with its hashes; no other section mentions it; nothing else changes.
      const reportAfter = buildReport({ ...REPORT_BASE, external: readExternalRecords(path.join(env.root, 'eval/results')) });
      const [secsBefore, secsAfter] = [sectionsOf(reportBefore), sectionsOf(reportAfter)];
      const s12 = secsAfter.find((s) => s.startsWith('## 12. ')) as string;
      for (const h of [record.reference_sha256, record.config.sha256, record.ledger.sha256, record.results.sha256, record.pinned_manifest_hash]) assert.ok(s12.includes(h), `section 12 shows ${h}`);
      assert.ok(s12.includes('ref-a') && s12.includes('not a repo Combination'));
      const others = secsAfter.filter((s) => !s.startsWith('## 12. '));
      assert.deepEqual(others, secsBefore.filter((s) => !s.startsWith('## 12. ')), 'every mark, link mark, recommendation and the branch text is unchanged');
      for (const s of others) assert.ok(!/ref-a|external reference/i.test(s), 'no other section mentions it');

      // A second reference with the same label is refused and changes nothing.
      const again = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
      assert.equal(again.value, 1);
      assert.ok(again.err.includes('probe: external_reference: label: '));
      assert.deepEqual(snapshot(env.root), after);
    }),
    { numRuns: 80 },
  );

  assert.ok(accepted >= 10 && rejected >= 10, `coverage: accepted ${accepted}, rejected ${rejected}`);
  assert.ok(regraded >= 5 && mismatches >= 1, `coverage: re-graded ${regraded}, mismatches ${mismatches}`);
  assert.ok(faultsSeen.size >= 15, `coverage: ${faultsSeen.size} different faults`);
});

test('Property 46: with several faults the first failing field in the documented order is named', async () => {
  const lines = rawLinesOf('D', [{ card: 0, permutation: 'base', kind: 'valid', option: 0 }]);
  const base = oracleFigures('D', 'json', lines);
  const cases: { faults: string[]; field: string }[] = [
    { faults: ['wrong pinned_manifest_hash', 'wrong sha256 of config'], field: 'pinned_manifest_hash' },
    { faults: ['wrong sha256 of config', 'absolute path for ledger'], field: 'ledger.file' },
    { faults: ['wrong sha256 of raw_outputs', 'wrong sha256 of ledger'], field: 'ledger.sha256' },
    { faults: ['ledger line that is not valid JSON', 'wrong sha256 of results'], field: 'results.sha256' },
    { faults: ['raw-output line that is not valid JSON', 'ledger line that is not valid JSON'], field: 'ledger.content' },
    { faults: ['missing figures.flips', 'wrong pinned_manifest_hash'], field: 'figures.flips' },
  ];
  for (const c of cases) {
    const { env, deps } = makeRepo();
    const r = writeReference({ task: 'D', lines, figures: base, pinned: deps.pinnedManifestHash });
    let ref = r.ref;
    for (const name of c.faults) ref = (FAULTS.find((f) => f.name === name) as Fault).apply(r, ref);
    rewriteReference(r, ref);
    const before = snapshot(env.root);
    const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
    assert.equal(run.value, 1);
    assert.ok(run.err.includes(`probe: external_reference: ${c.field}: `), `${c.faults.join(' + ')} -> ${run.err}`);
    assert.deepEqual(snapshot(env.root), before);
  }
});
