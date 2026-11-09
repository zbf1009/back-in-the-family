// Feature: llm-probe, Property 51: A Derived_Run is a pure function of its stored source, never overwritten, byte-exact under
// `--verify`, and refused unless the source is complete
// Validates: Requirements 20.7, 20.9, 20.11
//
// Feature: llm-probe, Property 52: A derived file's flip Metric is by_construction and its other Metrics equal the Metrics
// computed from its grades
// Validates: Requirements 20.7, 20.12, 20.13
//
// Fake sources are built from the Dev_Card option IDs (rendered through Sim_Wasm); the "locked" split is never used here.
// Each case derives into a fresh temp repo, so the number of cases is small.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { derive, type DeriveOptions } from '../../src/derive.ts';
import { regrade } from '../../src/ingest.ts';
import { BY_CONSTRUCTION_PASS_LABEL, computeMetrics, metricCardFromLoaded, passLabel } from '../../src/metrics.ts';
import { gradesPathFor, readGradesFile, readResultsFile, type ResultRecord } from '../../src/results.ts';
import { buildPlan } from '../../src/run.ts';
import { gradeRecords } from '../../src/run-grading.ts';
import { capture } from './run.helpers.ts';
import { cardsOf, derivedFile, makeDeriveEnv, writeSource, type DeriveEnv, type SourceSpec } from './derive.helpers.ts';

const decisionCards = cardsOf('dev').filter((c) => c.task === 'decision');
const PLAN = buildPlan(decisionCards, ['decision']);
const INDEX = new Map(PLAN.map((p, i) => [`${p.card.id}\u0000${p.permutation}`, i] as const));

/** Per planned call: five weights 0..9 (the lexeme is `0.<w>`), and a rare Timeout. */
const arbCalls = fc.array(fc.record({ w: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 5, maxLength: 5 }), timeout: fc.integer({ min: 0, max: 39 }).map((n) => n === 0) }), { minLength: PLAN.length, maxLength: PLAN.length });
type Calls = { w: number[]; timeout: boolean }[];

/** The option ID in sorted position k gets weight w[k]; every Permutation of a Card shows the same IDs. */
const specOf = (calls: Calls): SourceSpec => (cardId, permutation, index) => {
  const c = calls[index] as Calls[number];
  void cardId;
  void permutation;
  return c.timeout ? { kind: 'timeout' } : { kind: 'ok', lexeme: (id, all) => `0.${c.w[[...all].sort().indexOf(id)] ?? 0}` };
};

const opts = (d: DeriveEnv, over: Partial<DeriveOptions> = {}): DeriveOptions => ({ combo: d.permAvg.id, split: 'dev', approval: 'DM-P01', verify: false, ...over });

/** Reference: integer sums of the weights per sorted option position; ties go to the smallest option ID. Null when any call timed out. */
function reference(calls: Calls, rec: ResultRecord): string | null {
  const field = rec.perm_avg;
  assert.ok(field !== undefined);
  const perms = PLAN.filter((p) => p.card.id === rec.card_id).map((p) => p.permutation);
  if (perms.some((p) => (calls[INDEX.get(`${rec.card_id}\u0000${p}`) as number] as Calls[number]).timeout)) return null;
  const ids = field.sums?.options.map((o) => o.id) ?? [];
  const sorted = [...ids].sort();
  const sums = new Map<string, number>(sorted.map((id) => [id, 0] as [string, number]));
  for (const p of perms) {
    const c = calls[INDEX.get(`${rec.card_id}\u0000${p}`) as number] as Calls[number];
    sorted.forEach((id, k) => sums.set(id, (sums.get(id) ?? 0) + (c.w[k] ?? 0)));
  }
  let best = sorted[0] as string;
  for (const id of sorted) if ((sums.get(id) as number) > (sums.get(best) as number)) best = id;
  return best;
}

test('Property 51: derive is a pure function of the stored source, byte-exact under --verify, and never overwrites', async () => {
  await fc.assert(
    fc.asyncProperty(arbCalls, async (calls) => {
      const d = makeDeriveEnv();
      const src = writeSource(d, specOf(calls));
      const first = await capture(() => derive(d.deps, opts(d)));
      assert.equal(first.value, 0, first.err);
      const file = derivedFile(d, 'dev', src.runId);
      const bytes = fs.readFileSync(file);
      const gradeBytes = fs.readFileSync(gradesPathFor(file));

      // The answer is the reference argmax; a Timeout in any call of a Card makes the Card Illegal.
      const results = readResultsFile(file);
      for (const rec of results.records) {
        const want = reference(calls, rec);
        if (want === null) assert.ok(rec.outcome.kind === 'error' && rec.outcome.code === 'perm_avg_illegal');
        else assert.deepEqual(rec.outcome, { kind: 'text', text: want });
      }

      // A second run is `unchanged`, writes nothing and gives the same bytes; --verify holds; no verify writes.
      const again = await capture(() => derive(d.deps, opts(d)));
      assert.equal(again.value, 0, again.err);
      assert.match(again.out, /unchanged/);
      assert.deepEqual(fs.readFileSync(file), bytes);
      assert.deepEqual(fs.readFileSync(gradesPathFor(file)), gradeBytes);
      assert.equal((await capture(() => derive(d.deps, opts(d, { verify: true })))).value, 0);

      // A changed source (same run ID) is never merged into the existing file.
      fs.rmSync(src.file);
      const flipped = calls.map((c, i) => (i === 0 ? { ...c, timeout: !c.timeout, w: c.w } : c));
      writeSource(d, specOf(flipped), { runId: src.runId });
      const conflict = await capture(() => derive(d.deps, opts(d)));
      assert.notEqual(conflict.value, 0);
      assert.match(conflict.err, /derived_conflict/);
      assert.deepEqual(fs.readFileSync(file), bytes);
      assert.notEqual((await capture(() => derive(d.deps, opts(d, { verify: true })))).value, 0);
    }),
    { numRuns: 12 },
  );
});

test('Property 51: a source with any planned Card x Permutation missing is refused and nothing is written', async () => {
  await fc.assert(
    fc.asyncProperty(fc.uniqueArray(fc.integer({ min: 0, max: PLAN.length - 1 }), { minLength: 1, maxLength: 4 }), async (missing) => {
      const d = makeDeriveEnv();
      writeSource(d, specOf(PLAN.map(() => ({ w: [9, 0, 0, 0, 0], timeout: false }))), { skip: new Set(missing.map((i) => `${(PLAN[i] as (typeof PLAN)[number]).card.id}\u0000${(PLAN[i] as (typeof PLAN)[number]).permutation}`)) });
      const r = await capture(() => derive(d.deps, opts(d)));
      assert.notEqual(r.value, 0);
      assert.match(r.err, /derive: source_incomplete/);
      assert.ok(!fs.existsSync(path.join(d.env.root, 'eval/results/derived')));
    }),
    { numRuns: 12 },
  );
});

test('Property 52: the flip row is by_construction and the other Metrics are those of the grades; evidence never reaches a Metric', async () => {
  await fc.assert(
    fc.asyncProperty(arbCalls, async (calls) => {
      const d = makeDeriveEnv();
      const src = writeSource(d, specOf(calls));
      assert.equal((await capture(() => derive(d.deps, opts(d)))).value, 0);
      const file = derivedFile(d, 'dev', src.runId);
      const results = readResultsFile(file);
      const grades = readGradesFile(gradesPathFor(file));
      const cards = cardsOf('dev').map(metricCardFromLoaded);
      const input = { cards, records: results.records, grades: grades.grades, contrasts: grades.contrasts, tasks: ['decision' as const] };
      const m = computeMetrics({ ...input, flip: 'by_construction' }).tasks[0];
      const plain = computeMetrics(input).tasks[0];
      assert.ok(m !== undefined && plain !== undefined);

      // The flip row: no numerator, denominator or verdict; passes is the conjunction of the other three verdicts.
      assert.deepEqual(m.flip, { mode: 'by_construction' });
      assert.equal(m.passes, [m.acceptable.verdict, m.severe.verdict, m.contrast.verdict].every((v) => v === 'pass'));
      assert.equal(passLabel(m), m.passes ? BY_CONSTRUCTION_PASS_LABEL : passLabel(m));
      assert.equal(passLabel(m).startsWith('pass'), m.passes);
      assert.deepEqual([m.cards, m.acceptable, m.severe, m.illegal, m.contrast, m.randomBaseline], [plain.cards, plain.acceptable, plain.severe, plain.illegal, plain.contrast, plain.randomBaseline]);

      // Illegal Cards: not acceptable, not severe, Illegal, and still in the denominator.
      for (const rec of results.records) {
        const pc = m.perCard.find((c) => c.cardId === rec.card_id);
        if (pc === undefined || rec.outcome.kind !== 'error') continue;
        assert.deepEqual([pc.acceptable, pc.severe, pc.illegal], [false, false, true]);
      }
      assert.equal(m.perCard.length, m.cards);

      // Replacing every piece of per-call evidence leaves grades and Metrics unchanged.
      const blanked = results.records.map((r): ResultRecord => ({ ...r, perm_avg: { scope: r.perm_avg?.scope ?? 'scored', rule_version: 1, chosen: null, sums: null, calls: [], positions: null } }));
      const regraded = gradeRecords(cardsOf('dev'), blanked, ['decision'], 'raw_choice');
      assert.deepEqual(regraded.grades, grades.grades);
      assert.deepEqual(computeMetrics({ ...input, records: blanked, flip: 'by_construction' }), computeMetrics({ ...input, flip: 'by_construction' }));

      // `regrade` accepts the derived file and reproduces its grades byte for byte.
      const g = await capture(() => regrade({ paths: d.deps.paths, pinnedManifestHash: d.deps.pinnedManifestHash }, file));
      assert.equal(g.value, 0, g.err);
    }),
    { numRuns: 12 },
  );
});
