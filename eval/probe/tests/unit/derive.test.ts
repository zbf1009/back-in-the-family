// llm-probe task 41.3, example tests for `probe derive` (R20.7, R20.9, R20.11, RC-18, RC-24; DA-26).
// Fake sources only: no network, no `env`, no Runtime; the synthetic "locked" split of run.helpers.ts stands in for locked.jsonl.
// **Validates: Requirements 20.7, 20.9, 20.11, 20.12, 20.13**
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { derive, deriveCommand, parseDeriveArgs, refusingDeriveGate, type DeriveDeps, type DeriveOptions } from '../../src/derive.ts';
import { comboModelKey } from '../../src/phase.ts';
import { regrade } from '../../src/ingest.ts';
import { BY_CONSTRUCTION_PASS_LABEL, computeMetrics, isByConstruction, metricCardFromLoaded, passLabel } from '../../src/metrics.ts';
import { gradesPathFor, readGradesFile, readResultsFile, SCHEMA, type ResultRecord } from '../../src/results.ts';
import { capture } from './run.helpers.ts';
import { cardsOf, derivedFile, firstWins, makeDeriveEnv, registryOf, RULE_REL, writeSource, type DeriveEnv } from './derive.helpers.ts';

const devOpts: DeriveOptions = { combo: 'workers-ai/clef-flash/perm_avg', split: 'dev', approval: 'DM-P01', verify: false };
const run = (d: DeriveEnv, over: Partial<DeriveOptions> = {}, deps: DeriveDeps = d.deps) => capture(() => derive(deps, { ...devOpts, combo: d.permAvg.id, ...over }));
const treeBytes = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : []);

test('derive writes one base record per decision Card and a grades file; both are ordinary Results files', async () => {
  const d = makeDeriveEnv();
  const src = writeSource(d, firstWins);
  const r = await run(d);
  assert.equal(r.value, 0, r.err);
  const file = derivedFile(d, 'dev', src.runId);
  const results = readResultsFile(file);
  const decisionCards = cardsOf('dev').filter((c) => c.task === 'decision');
  assert.deepEqual(results.records.map((x) => x.card_id), decisionCards.map((c) => c.id));
  assert.ok(results.records.every((x) => x.permutation === 'base' && x.source === 'derived' && x.perm_avg !== undefined && x.usage === null && x.late === null));
  assert.equal(results.header.variant, 'perm_avg');
  assert.equal(results.header.model_key, null);
  assert.equal(results.header.validator_mode, 'raw_choice');
  assert.deepEqual(Object.keys(results.header.template_hashes).sort(), ['aggregation', 'decision']);
  const from = results.header.derived_from;
  assert.ok(from !== undefined);
  assert.equal(from.combination, d.single.id);
  assert.equal(from.run_id, src.runId);
  assert.equal(from.ledger_entry, null);
  assert.equal(from.results_sha256, (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(src.file)).digest('hex'));
  assert.equal(from.pinned_manifest_hash, d.deps.pinnedManifestHash);
  // The derived answer is the option of the stored probabilities (the smallest option ID wins in firstWins).
  for (const rec of results.records) assert.ok(rec.outcome.kind === 'text' && rec.perm_avg?.chosen === rec.outcome.text);
  const grades = readGradesFile(gradesPathFor(file));
  assert.equal(grades.grades.length, results.records.length);
  // No clock value, no ledger line, no budget counter, nothing in locked/ or dev/.
  assert.ok(!fs.existsSync(path.join(d.env.root, 'eval/results/ledger.jsonl')));
  assert.ok(!fs.existsSync(path.join(d.env.root, 'eval/results/budget')));
  // The existing `regrade` accepts a derived file byte for byte (Property 52).
  const g = await capture(() => regrade({ paths: d.deps.paths, pinnedManifestHash: d.deps.pinnedManifestHash }, file));
  assert.equal(g.value, 0, g.err);
});

test('a second derive on an unchanged source writes nothing and says unchanged; --verify passes and a changed byte fails it', async () => {
  const d = makeDeriveEnv();
  const src = writeSource(d, firstWins);
  assert.equal((await run(d)).value, 0);
  const file = derivedFile(d, 'dev', src.runId);
  const before = fs.readFileSync(file);
  const again = await run(d);
  assert.equal(again.value, 0);
  assert.match(again.out, /unchanged/);
  assert.deepEqual(fs.readFileSync(file), before);
  const ok = await run(d, { verify: true });
  assert.equal(ok.value, 0, ok.err);
  assert.match(ok.out, /verified/);
  fs.writeFileSync(file, before.toString('utf8').replace('"permutation":"base"', '"permutation":"basf"'));
  const bad = await run(d, { verify: true });
  assert.notEqual(bad.value, 0);
  assert.match(bad.err, /verify_failed/);
  assert.equal(fs.readFileSync(file, 'utf8').includes('basf'), true, 'verify never rewrites the file');
});

test('a derived file is never overwritten: a source that changed gives derived_conflict and leaves the file as it was', async () => {
  const d = makeDeriveEnv();
  const src = writeSource(d, firstWins);
  assert.equal((await run(d)).value, 0);
  const file = derivedFile(d, 'dev', src.runId);
  const before = fs.readFileSync(file);
  // Same run ID, different stored probabilities: a different source hash.
  fs.rmSync(src.file);
  writeSource(d, (id, perm, i) => (i === 0 ? { kind: 'ok', lexeme: () => '0.3' } : firstWins(id, perm, i)), { runId: src.runId });
  const r = await run(d);
  assert.notEqual(r.value, 0);
  assert.match(r.err, /^probe: derive: derived_conflict: .+\.jsonl$/m);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('a source that is not complete is refused and nothing is written (RC-24): missing record, not_run, engine_fault', async () => {
  const cases: { name: string; options: Parameters<typeof writeSource>[2] }[] = [
    { name: 'missing record', options: { skip: new Set([`${cardsOf('dev').filter((c) => c.task === 'decision')[0]?.id}\u0000base`]) } },
    {
      name: 'not_run record',
      options: { extra: (h) => [{ schema: SCHEMA.result, run_id: h.run_id, split: h.split, card_id: cardsOf('dev')[0]?.id as string, permutation: 'base', outcome: { kind: 'not_run', reason: 'budget', detail: 'x' }, latency_ms: null, timeout_ms: h.timeout_ms, requested_at: '2026-11-09T10:10:00.000Z', template_hash: 'x', fingerprint_id: h.fingerprint_id, usage: null, late: null, source: 'headless' }] },
    },
    {
      name: 'engine_fault record',
      options: { extra: (h) => [{ schema: SCHEMA.result, run_id: h.run_id, split: h.split, card_id: cardsOf('dev')[0]?.id as string, permutation: 'base', outcome: { kind: 'engine_fault', code: 'truncated_state', detail: 'x' }, latency_ms: null, timeout_ms: h.timeout_ms, requested_at: '2026-11-09T10:10:00.000Z', template_hash: 'x', fingerprint_id: h.fingerprint_id, usage: null, late: null, source: 'headless' } as ResultRecord] },
    },
  ];
  for (const c of cases) {
    const d = makeDeriveEnv();
    writeSource(d, firstWins, c.options);
    const r = await run(d);
    assert.notEqual(r.value, 0, c.name);
    assert.match(r.err, /derive: source_incomplete/, c.name);
    assert.deepEqual(treeBytes(path.join(d.env.root, 'eval/results/derived')), [], c.name);
  }
});

test('the refusing gate stub refuses before anything is read or written; --task other than D is refused first', async () => {
  const d = makeDeriveEnv(refusingDeriveGate);
  writeSource(d, firstWins);
  const r = await run(d);
  assert.notEqual(r.value, 0);
  assert.match(r.err, /^probe: gate: derive_dev of .+ is refused/m);
  assert.deepEqual(treeBytes(path.join(d.env.root, 'eval/results/derived')), []);
  assert.deepEqual(parseDeriveArgs(['--combo', 'c', '--split', 'dev', '--approval', 'a', '--task', 'S']), { ok: false, message: '--task must be D (a Derived_Run is for Task_Type D only)' });
  const cli = await capture(() => deriveCommand(['--combo', 'c', '--split', 'dev', '--approval', 'a', '--task', 'DS'], d.deps));
  assert.equal(cli.value, 2);
  assert.match(cli.err, /--task must be D/);
});

test('V18: a rule file whose rule_version differs from the export is refused before any Results file is read', async () => {
  const text = fs.readFileSync(path.join(new URL('../../../../', import.meta.url).pathname, RULE_REL), 'utf8').replace('rule_version: 1', 'rule_version: 2');
  const d = makeDeriveEnv(undefined, { ruleText: text, rulePinVersion: 2 });
  // No source at all: a source error would show if the order were wrong.
  const r = await run(d);
  assert.notEqual(r.value, 0);
  assert.match(r.err, /derive: rule_version: .*rule_version 2/);
});

test('a rule file that differs from the pinned Aggregation_Hash is refused', async () => {
  const d = makeDeriveEnv();
  fs.appendFileSync(path.join(d.env.root, RULE_REL), '\n');
  const r = await run(d);
  assert.notEqual(r.value, 0);
  assert.match(r.err, /derive: rule_hash/);
});

test('the registry check refuses a registry that differs from the earliest Dev_Run header of the model (R20.1)', async () => {
  const d = makeDeriveEnv();
  writeSource(d, firstWins, { registry: registryOf(d).slice(0, 1) });
  const r = await run(d);
  assert.notEqual(r.value, 0);
  assert.match(r.err, /^probe: variant: registry changed after the first Dev_Run result \(R20\.1\); needs a recorded Author amendment$/m);
});

test('a timeout in one call makes that Card Illegal with detail "<reason> <permutation>"; the other Cards are answered', async () => {
  const d = makeDeriveEnv();
  const first = cardsOf('dev').find((c) => c.task === 'decision' && c.scored) as { id: string };
  const src = writeSource(d, (id, perm, i) => (id === first.id && perm === 'reversed' ? { kind: 'timeout' } : firstWins(id, perm, i)));
  const r = await run(d);
  assert.equal(r.value, 0, r.err);
  assert.match(r.out, new RegExp(`Illegal Card ID ${first.id}: call_timeout reversed`));
  const results = readResultsFile(derivedFile(d, 'dev', src.runId));
  const rec = results.records.find((x) => x.card_id === first.id) as ResultRecord;
  assert.deepEqual(rec.outcome, { kind: 'error', code: 'perm_avg_illegal', detail: 'call_timeout reversed', remote: false });
  assert.equal(rec.perm_avg?.chosen, null);
  const grades = readGradesFile(gradesPathFor(derivedFile(d, 'dev', src.runId)));
  const g = grades.grades.find((x) => x.card_id === first.id);
  assert.deepEqual((g?.grade as { acceptable: boolean; illegal: boolean }).illegal, true);
  assert.deepEqual((g?.grade as { acceptable: boolean }).acceptable, false);
});

test('a perm_avg id that is unknown or a single id is refused', async () => {
  const d = makeDeriveEnv();
  assert.match((await run(d, { combo: 'nope' })).err, /derive: unknown_combination/);
  assert.match((await run(d, { combo: d.single.id })).err, /derive: not_perm_avg/);
});

test('derive of the locked split needs the Dev derived file; its source is the first complete ledger entry (R20.11)', async () => {
  const d = makeDeriveEnv();
  const dev = writeSource(d, firstWins);
  const lockedSrc = writeSource(d, firstWins, { split: 'locked', runId: 'L-20261109T110000Z-clef-flash', registry: registryOf(d) });
  const key = comboModelKey(d.single);
  const planned = lockedSrc.planSize;
  const start = { schema: 'llm-probe-ledger-v1', event: 'start', entry_id: 'L-20261109T110000Z-clef-flash', model_key: key, combination: d.single.id, task_subset: 'D', fingerprint: { fake: true }, template_hashes: { decision: d.mappingHash }, started_at: '2026-11-09T11:00:00.000Z', rerun_of: null, rerun_reason: null, overlaps: [], approval: null, planned: { decision: planned } };
  const complete = { schema: 'llm-probe-ledger-v1', event: 'complete', entry_id: start.entry_id, ended_at: '2026-11-09T11:30:00.000Z', results: `eval/results/locked/${lockedSrc.runId}.jsonl`, requests_sent: planned };
  fs.mkdirSync(path.join(d.env.root, 'eval/results'), { recursive: true });
  fs.writeFileSync(path.join(d.env.root, 'eval/results/ledger.jsonl'), `${JSON.stringify(start)}\n${JSON.stringify(complete)}\n`);
  const ledgerBefore = fs.readFileSync(path.join(d.env.root, 'eval/results/ledger.jsonl'));

  const tooEarly = await run(d, { split: 'locked' });
  assert.notEqual(tooEarly.value, 0);
  assert.match(tooEarly.err, /derive: dev_derived_missing/);

  assert.equal((await run(d)).value, 0);
  const ok = await run(d, { split: 'locked' });
  assert.equal(ok.value, 0, ok.err);
  assert.match(ok.out, /docs\/kiro-log\.md entry to paste/);
  const file = derivedFile(d, 'locked', lockedSrc.runId);
  const results = readResultsFile(file);
  assert.equal(results.header.derived_from?.ledger_entry, start.entry_id);
  assert.deepEqual(results.records.map((x) => x.card_id), cardsOf('locked').filter((c) => c.task === 'decision').map((c) => c.id));
  // No ledger line was added and the dev derived file is untouched.
  assert.deepEqual(fs.readFileSync(path.join(d.env.root, 'eval/results/ledger.jsonl')), ledgerBefore);
  assert.equal((await run(d, { split: 'locked', verify: true })).value, 0);
  assert.ok(dev.runId.length > 0);
});

test('metrics: the flip row of a derived file is by_construction, the pass label is the R20.13 label, and passes ignores the flip', async () => {
  const d = makeDeriveEnv();
  const src = writeSource(d, firstWins);
  assert.equal((await run(d)).value, 0);
  const file = derivedFile(d, 'dev', src.runId);
  const results = readResultsFile(file);
  const grades = readGradesFile(gradesPathFor(file));
  const cards = cardsOf('dev').map(metricCardFromLoaded);
  const input = { cards, records: results.records, grades: grades.grades, contrasts: grades.contrasts, tasks: ['decision' as const] };
  const byC = computeMetrics({ ...input, flip: 'by_construction' }).tasks[0];
  const measured = computeMetrics(input).tasks[0];
  assert.ok(byC !== undefined && measured !== undefined);
  assert.deepEqual(byC.flip, { mode: 'by_construction' });
  assert.equal(isByConstruction(byC.flip), true);
  assert.equal(byC.severeOtherPermutations, 0);
  assert.deepEqual([byC.acceptable, byC.severe, byC.contrast, byC.illegal], [measured.acceptable, measured.severe, measured.contrast, measured.illegal]);
  assert.equal(byC.passes, [byC.acceptable.verdict, byC.severe.verdict, byC.contrast.verdict].every((v) => v === 'pass'));
  assert.equal(passLabel(byC), byC.passes ? BY_CONSTRUCTION_PASS_LABEL : passLabel(byC));
  assert.equal(passLabel({ ...byC, passes: true }), 'pass (flip guaranteed by construction, not measured)');
  assert.equal(passLabel({ ...measured, passes: true }), 'pass');
  assert.match(passLabel({ ...byC, passes: false, acceptable: { ...byC.acceptable, verdict: 'fail' } }), /^fail \(acceptable rate/);
});
