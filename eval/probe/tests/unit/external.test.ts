// Examples for `ingest-reference` (llm-probe task 31.1; R19.15, R19.18, R3.1). SYNTHETIC card set in temp directories;
// the real eval/results and the real locked.jsonl are never touched. The property is Property 46 (external.property.test.ts).
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FIGURE_NAMES, parseExternalRecord, readExternalRecords } from '../../src/external.ts';
import { acceptedLines, ingestReferenceCommand, parseIngestReferenceArgs } from '../../src/external-command.ts';
import { renderPromptCalls } from '../../src/simwasm.ts';
import { capture } from './run.helpers.ts';
import { makeRepo, oracleFigures, rawLinesOf, rewriteReference, snapshot, writeReference, zeroFigures } from './external.helpers.ts';

const LINES = rawLinesOf('D', [
  { card: 0, permutation: 'base', kind: 'valid', option: 0 },
  { card: 1, permutation: 'base', kind: 'junk', option: 0 },
  { card: 2, permutation: 'base', kind: 'badoption', option: 0 },
  { card: 3, permutation: 'reversed', kind: 'valid', option: 1 },
]);

test('a valid file with raw outputs is accepted, re-graded, and stored under its label only', async () => {
  const { env, deps } = makeRepo();
  const figures = oracleFigures('D', 'json', LINES);
  const r = writeReference({ task: 'D', lines: LINES, figures, pinned: deps.pinnedManifestHash });
  const before = snapshot(env.root);
  const rendered = renderPromptCalls.length;
  const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.equal(run.value, 0, run.err);
  assert.equal(renderPromptCalls.length, rendered, 'no prompt is rendered from a Locked_Card (R3.1)');
  assert.match(run.out, /probe: external_reference: accepted teacher-upper-bound \(Task_Type D/);
  assert.match(run.out, /re-graded 4 raw outputs through Sim_Wasm: match/);
  const added = [...snapshot(env.root).keys()].filter((p) => !before.has(p)).map((p) => path.relative(env.root, p));
  assert.deepEqual(added.sort(), ['config.json', 'ledger.jsonl', 'raw-outputs.jsonl', 'record.json', 'reference.json', 'results.jsonl'].map((n) => `eval/results/external/teacher-upper-bound/${n}`));
  const [rec] = readExternalRecords(path.join(env.root, 'eval/results'));
  assert.equal(rec?.regrade, 'match');
  assert.deepEqual(rec?.supplied, figures);
  assert.deepEqual(rec?.differing, []);
  assert.ok((rec?.supplied.scored_cards ?? 0) > 0 && rec?.raw_output_count === 4);
});

test('a re-grade that differs from the supplied figures is stored as mismatch with the differing names, and the exit status is 0', async () => {
  const { env, deps } = makeRepo();
  const figures = oracleFigures('D', 'json', LINES);
  const r = writeReference({ task: 'D', lines: LINES, figures: { ...figures, acceptable: figures.acceptable + 3, flips: figures.flips + 1 }, pinned: deps.pinnedManifestHash });
  const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.equal(run.value, 0, run.err);
  assert.match(run.out, /MISMATCH in acceptable, flips/);
  const [rec] = readExternalRecords(path.join(env.root, 'eval/results'));
  assert.equal(rec?.regrade, 'mismatch');
  assert.deepEqual(rec?.differing, ['acceptable', 'flips']);
  assert.deepEqual(rec?.regrade_figures, figures);
  assert.equal(rec?.supplied.acceptable, figures.acceptable + 3, 'the supplied figures are stored as given');
});

test('a file without raw outputs is accepted with its figures as supplied', async () => {
  const { env, deps } = makeRepo();
  const figures = { ...zeroFigures(), acceptable: 40, scored_cards: 50, pairs: 10, consistent_pairs: 9 };
  const r = writeReference({ task: 'S', lines: null, figures, pinned: deps.pinnedManifestHash, label: 'figures-only' });
  const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.equal(run.value, 0, run.err);
  assert.match(run.out, /no raw outputs supplied; nothing was re-graded/);
  const [rec] = readExternalRecords(path.join(env.root, 'eval/results'));
  assert.equal(rec?.regrade, null);
  assert.equal(rec?.raw_outputs, null);
  assert.deepEqual(Object.keys(rec?.supplied ?? {}), [...FIGURE_NAMES]);
});

test('a wrong Pinned_Manifest_Hash rejects the whole file and writes nothing', async () => {
  const { env, deps } = makeRepo();
  const r = writeReference({ task: 'D', lines: LINES, figures: oracleFigures('D', 'json', LINES), pinned: 'a'.repeat(64) });
  const before = snapshot(env.root);
  const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.equal(run.value, 1);
  assert.match(run.err, /^probe: external_reference: pinned_manifest_hash: differs from the Pinned_Manifest_Hash of the Card_Set/m);
  assert.deepEqual(snapshot(env.root), before);
});

test('a wrong file hash rejects the whole file naming the member, and writes nothing', async () => {
  const { env, deps } = makeRepo();
  const r = writeReference({ task: 'D', lines: LINES, figures: oracleFigures('D', 'json', LINES), pinned: deps.pinnedManifestHash });
  fs.appendFileSync(r.files.results, '{"tampered":true}\n');
  const before = snapshot(env.root);
  const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.equal(run.value, 1);
  assert.match(run.err, /^probe: external_reference: results\.sha256: differs from the sha256 of "results\.jsonl"/m);
  assert.deepEqual(snapshot(env.root), before);
});

test('the Manifest_Check runs first: a Card_Set that differs from the pinned hash stops the command before the file is read', async () => {
  const { env, deps } = makeRepo();
  const r = writeReference({ task: 'D', lines: LINES, figures: oracleFigures('D', 'json', LINES), pinned: deps.pinnedManifestHash });
  const before = snapshot(env.root);
  const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], { ...deps, pinnedManifestHash: 'b'.repeat(64) }));
  assert.notEqual(run.value, 0);
  assert.match(run.err, /probe: manifest: /);
  assert.doesNotMatch(run.err, /external_reference/);
  assert.deepEqual(snapshot(env.root), before);
});

test('a Card ID that is not a Locked_Card of the Task_Type rejects the file naming the line and the ID only', async () => {
  const { env, deps } = makeRepo();
  const bad = [...LINES, { card_id: 'NO-SUCH-CARD', permutation: 'base', raw: '{"option":"x"}' }];
  const r = writeReference({ task: 'D', lines: bad, figures: zeroFigures(), pinned: deps.pinnedManifestHash });
  const before = snapshot(env.root);
  const run = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.equal(run.value, 1);
  assert.match(run.err, /raw_outputs\.content: line 5: Card ID "NO-SUCH-CARD" is not a Locked_Card of Task_Type D/);
  assert.deepEqual(snapshot(env.root), before);
});

test('raw_choice applies to Task_Type D only, and a repeated Card ID and permutation is a format fault', async () => {
  const { deps } = makeRepo();
  const s = writeReference({ task: 'S', lines: [], mode: 'raw_choice', figures: zeroFigures(), pinned: deps.pinnedManifestHash });
  const run1 = await capture(() => ingestReferenceCommand(['--file', s.refPath], deps));
  assert.equal(run1.value, 1);
  assert.match(run1.err, /raw_outputs\.answer_mode: raw_choice applies to Task_Type D only/);

  const dup = writeReference({ task: 'D', lines: [LINES[0] as (typeof LINES)[number], LINES[0] as (typeof LINES)[number]], figures: zeroFigures(), pinned: deps.pinnedManifestHash });
  const run2 = await capture(() => ingestReferenceCommand(['--file', dup.refPath], deps));
  assert.equal(run2.value, 1);
  assert.match(run2.err, /raw_outputs\.content: line 2 repeats Card ID/);
});

test('an unreadable file, a file that is not JSON and an unknown member are rejected naming the field', async () => {
  const { deps } = makeRepo();
  const missing = await capture(() => ingestReferenceCommand(['--file', '/nonexistent/ref.json'], deps));
  assert.equal(missing.value, 1);
  assert.match(missing.err, /external_reference: file: cannot read the reference file/);

  const r = writeReference({ task: 'D', lines: LINES, figures: zeroFigures(), pinned: deps.pinnedManifestHash });
  fs.writeFileSync(r.refPath, 'not json');
  const notJson = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.match(notJson.err, /external_reference: file: is not valid JSON/);

  rewriteReference(r, { ...r.ref, extra: 1 });
  const extra = await capture(() => ingestReferenceCommand(['--file', r.refPath], deps));
  assert.match(extra.err, /external_reference: extra: is not a member of the format/);
});

test('the flags: --file is required, one positional argument is refused, the exit status is 2', async () => {
  assert.deepEqual(parseIngestReferenceArgs([]), { ok: false, message: '--file <external-reference.json> is required' });
  assert.equal(parseIngestReferenceArgs(['x.json']).ok, false);
  const ok = parseIngestReferenceArgs(['--file', 'a/b.json']);
  assert.ok(ok.ok && path.isAbsolute(ok.options.file));
  const { deps } = makeRepo();
  const run = await capture(() => ingestReferenceCommand([], deps));
  assert.equal(run.value, 2);
});

test('a stored record that is malformed is refused by the reader, naming the problem', () => {
  assert.throws(() => parseExternalRecord({ schema: 'llm-probe-external-v1' }), /label must be a non-empty string|task_type must be D or S/);
  assert.throws(() => parseExternalRecord(null), /record must be an object/);
  const lines = acceptedLines(
    {
      schema: 'llm-probe-external-v1',
      label: 'x',
      reference_model: 'm',
      task_type: 'D',
      pinned_manifest_hash: 'a'.repeat(64),
      reference_sha256: 'b'.repeat(64),
      config: { file: 'c', sha256: 'c'.repeat(64) },
      ledger: { file: 'l', sha256: 'd'.repeat(64) },
      results: { file: 'r', sha256: 'e'.repeat(64) },
      raw_outputs: null,
      supplied: zeroFigures(),
      regrade: null,
      regrade_figures: null,
      differing: [],
      raw_output_count: null,
    },
    'eval/results/external/x',
  );
  assert.equal(lines.length, 3);
});
