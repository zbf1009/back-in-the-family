// Property 33 (llm-probe task 13.8): re-grading reproduces every Grade and Metric.
// **Validates: Requirements 12.6.**
// Dev_Runs and Locked_Runs of a fake Runtime on a synthetic card set in temp dirs (the real eval/results
// and locked.jsonl are never touched), with random scripted outputs: valid, illegal, timeout with and
// without a Late_Answer, error, engine faults and not_run (a failed engine rebuild). `regrade` then makes
// no Runtime call, finds the grades file byte-equal, finds identical Metrics and intervals, and writes
// nothing. One tampered Results record or grades line is detected and named by file and line.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import type { AdapterResult } from '../../src/adapters/interface.ts';
import { loadCards } from '../../src/cards.ts';
import { gradesText, regrade } from '../../src/ingest.ts';
import { computeMetrics, metricCardFromLoaded } from '../../src/metrics.ts';
import { analyzeRun } from '../../src/report.ts';
import { gradesPathFor, readGradesFile, readResultsFile } from '../../src/results.ts';
import { gradeRecords } from '../../src/run-grading.ts';
import { devRun, lockedRun, type RuntimeFactory } from '../../src/run.ts';
import { subsetTaskTypes } from '../../src/ledger.ts';
import { capture, createFakeRuntime, defaultAnswer, FAKE_COMBO, makeCardSet, makeEnv, type FakeRuntime } from './run.helpers.ts';

const cardSet = makeCardSet();

type Kind = 'valid' | 'illegal' | 'timeout_late' | 'timeout_none' | 'error' | 'engine_fault';
const KINDS: readonly Kind[] = ['valid', 'valid', 'valid', 'illegal', 'timeout_late', 'timeout_none', 'error', 'engine_fault'];

interface Plan {
  readonly kinds: readonly Kind[];
  /** Offset of a timeout whose engine stays busy and whose rebuild fails (rest of the run is not_run), or null. */
  readonly rebuildFailAt: number | null;
}

const planArb: fc.Arbitrary<Plan> = fc.record({
  kinds: fc.array(fc.constantFrom(...KINDS), { minLength: 1, maxLength: 9 }),
  rebuildFailAt: fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
});
const runsArb = fc.tuple(planArb, planArb);

function scripted(plan: Plan, base: number): FakeRuntime {
  return createFakeRuntime({
    failRebuilds: plan.rebuildFailAt === null ? 0 : 1,
    stuckAfter: plan.rebuildFailAt === null ? [] : [base + plan.rebuildFailAt],
    script: (i, p): AdapterResult => {
      const o = i - base;
      if (o === plan.rebuildFailAt) return { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'none', reason: 'idle_cap' }) };
      const kind = plan.kinds[o % plan.kinds.length] as Kind;
      switch (kind) {
        case 'valid':
          return { kind: 'text', text: defaultAnswer(p), latencyMs: 3 + (o % 7), usage: null };
        case 'illegal':
          return { kind: 'text', text: 'not json at all', latencyMs: 4, usage: null };
        case 'timeout_late':
          return { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'late', text: o % 2 === 0 ? defaultAnswer(p) : 'late junk', latencyMs: 12_000 }) };
        case 'timeout_none':
          return { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'none', reason: 'generation_cap' }) };
        case 'error':
          return { kind: 'error', code: 'runtime_error', detail: 'scripted', elapsedMs: 1, remote: null };
        default:
          return { kind: 'error', code: 'runtime_stuck', detail: 'forced', elapsedMs: 0, remote: null };
      }
    },
  });
}

/** Path -> sha256 of every file under `dir`. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p, createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

const numbersOf = (file: string) => {
  const { header, records } = readResultsFile(file);
  const cards = loadCards({ cardsDir: cardSet.dir, splits: header.split === 'dev' ? ['dev'] : ['dev', 'locked'] }).cards[header.split].map(metricCardFromLoaded);
  return { header, records, cards };
};

test('Property 33: re-grading reproduces every Grade and Metric', async () => {
  let regraded = 0;
  let tamperedResults = 0;
  let tamperedGrades = 0;
  await fc.assert(
    fc.asyncProperty(runsArb, fc.nat(), async ([devPlan, lockedPlan], pick) => {
      const env = makeEnv(cardSet);
      // A clean Dev_Run first (a Locked_Run needs one), then a scripted Dev_Run and a scripted Locked_Run.
      const clean = createFakeRuntime();
      assert.equal((await capture(() => devRun(env.deps(clean), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
      const dev = scripted(devPlan, 0);
      await capture(() => devRun(env.deps(dev), { combo: FAKE_COMBO.id, task: 'D' }));
      const locked = scripted(lockedPlan, 0);
      await capture(() => lockedRun(env.deps(locked), { combo: FAKE_COMBO.id, task: 'D' }));

      const resultsFiles = ['dev', 'locked'].flatMap((s) => {
        const dir = path.join(env.root, 'eval/results', s);
        return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.endsWith('.grades.jsonl') && !f.endsWith('.perf.jsonl')).map((f) => path.join(dir, f)) : [];
      });
      const withGrades = resultsFiles.filter((f) => fs.existsSync(gradesPathFor(f)));
      assert.ok(withGrades.length >= 1);

      for (const file of withGrades) {
        const grades = gradesPathFor(file);
        // A spy over the Runtime factory: a regrade must never create or call a Runtime.
        let factoryCalls = 0;
        const rt = createFakeRuntime();
        const spy: RuntimeFactory = async (...a) => {
          factoryCalls++;
          return rt.factory(...a);
        };
        const before = snapshot(env.root);
        const run = await capture(() => regrade(env.deps(rt, { createRuntime: spy }), file));
        assert.equal(run.value, 0, run.err);
        assert.equal(factoryCalls, 0);
        assert.equal(rt.calls.length, 0);
        assert.deepEqual(rt.engine, []);
        assert.deepEqual(snapshot(env.root), before, 'regrade writes or modifies no file');

        // Independent check of what regrade promises: byte-equal grades, identical Metrics and intervals.
        const { header, records, cards } = numbersOf(file);
        const cardsLoaded = loadCards({ cardsDir: cardSet.dir, splits: header.split === 'dev' ? ['dev'] : ['dev', 'locked'] }).cards[header.split];
        const again = gradeRecords(cardsLoaded, records, subsetTaskTypes(header.task_subset));
        assert.equal(gradesText(again), fs.readFileSync(grades, 'utf8'));
        const stored = readGradesFile(grades);
        assert.deepEqual(stored.grades, again.grades);
        const base = { kind: header.split, id: header.run_id, cards, header, records, perf: null } as const;
        assert.deepEqual(
          analyzeRun({ ...base, grades: stored }),
          analyzeRun({ ...base, grades: { grades: again.grades, contrasts: again.contrasts, excluded: again.excluded } }),
        );
        const tasks = subsetTaskTypes(header.task_subset);
        const m = (g: typeof again) => computeMetrics({ cards, records, grades: g.grades, contrasts: g.contrasts, tasks });
        assert.deepEqual(m({ grades: stored.grades, contrasts: stored.contrasts, excluded: stored.excluded }), m(again));
        regraded++;
      }

      // One tampered record or grades line is detected and named by file and line; nothing is changed.
      // Only a file with at least one graded line can be tampered with: a run of nothing but engine faults
      // writes no Grade (found by seed -1462293683). The clean Dev_Run always qualifies.
      const hasGrade = (f: string): boolean => fs.readFileSync(gradesPathFor(f), 'utf8').split('\n').some((l) => l.trim() !== '' && (JSON.parse(l) as { grade?: unknown }).grade != null);
      const tamperable = withGrades.filter(hasGrade);
      assert.ok(tamperable.length >= 1);
      const target = tamperable[pick % tamperable.length] as string;
      const gradesFile = gradesPathFor(target);
      const resultsText = fs.readFileSync(target, 'utf8');
      const gradesTextBefore = fs.readFileSync(gradesFile, 'utf8');
      const gradeLines = gradesTextBefore.split('\n');
      const parsed = gradeLines.map((l) => (l.trim() === '' ? null : (JSON.parse(l) as { card_id?: string; permutation?: string; grade?: { illegal: boolean } | null })));
      const legal = parsed.findIndex((g) => g?.grade != null && g.grade.illegal === false);
      const tamperResults = legal >= 0 && pick % 2 === 0;
      let expectLine: number;
      if (tamperResults) {
        // A valid answer replaced by text that is not an answer: its grade line must differ.
        const g = parsed[legal] as { card_id: string; permutation: string };
        const lines = resultsText.split('\n');
        const at = lines.findIndex((l, i) => {
          if (i === 0 || l.trim() === '') return false;
          const r = JSON.parse(l) as { card_id: string; permutation: string; outcome: { kind: string } };
          return r.card_id === g.card_id && r.permutation === g.permutation && r.outcome.kind === 'text';
        });
        assert.ok(at > 0);
        const rec = JSON.parse(lines[at] as string) as { outcome: unknown };
        rec.outcome = { kind: 'text', text: 'not json at all' };
        lines[at] = JSON.stringify(rec);
        fs.writeFileSync(target, lines.join('\n'));
        expectLine = legal + 1;
        tamperedResults++;
      } else {
        const idx = parsed.findIndex((g) => g?.grade != null);
        assert.ok(idx >= 0);
        const g = parsed[idx] as { grade: { illegal: boolean } };
        g.grade.illegal = !g.grade.illegal;
        gradeLines[idx] = JSON.stringify(g);
        fs.writeFileSync(gradesFile, gradeLines.join('\n'));
        expectLine = idx + 1;
        tamperedGrades++;
      }
      const tampered = snapshot(env.root);
      const rt = createFakeRuntime();
      const bad = await capture(() => regrade(env.deps(rt), target));
      assert.equal(bad.value, 1);
      assert.ok(bad.err.includes(`${path.basename(gradesFile)}:${expectLine}:`), bad.err);
      assert.equal(rt.calls.length, 0);
      assert.deepEqual(snapshot(env.root), tampered, 'a failed regrade changes no file');
    }),
    {
      numRuns: 12,
      examples: [
        // Regression (seed -1462293683): a scripted Dev_Run of engine faults only writes no Grade; the tamper
        // step must pick a file that has a graded line. Also pins grades tampering (odd pick).
        [[{ kinds: ['engine_fault'], rebuildFailAt: null }, { kinds: ['valid'], rebuildFailAt: 0 }], 9],
        // Pins results tampering (even pick, a legal answer exists), so coverage never depends on the random run.
        [[{ kinds: ['valid'], rebuildFailAt: null }, { kinds: ['valid', 'illegal'], rebuildFailAt: null }], 0],
      ],
    },
  );
  assert.ok(regraded > 0 && tamperedResults > 0 && tamperedGrades > 0, `coverage: regraded ${regraded}, results ${tamperedResults}, grades ${tamperedGrades}`);
});

test('Property 33 covers every outcome kind: a fixed plan with all of them re-grades cleanly', async () => {
  const env = makeEnv(cardSet);
  const plan: Plan = { kinds: ['valid', 'illegal', 'timeout_late', 'timeout_none', 'error', 'engine_fault', 'valid'], rebuildFailAt: 40 };
  await capture(() => devRun(env.deps(scripted(plan, 0)), { combo: FAKE_COMBO.id, task: 'D' }));
  const dir = path.join(env.root, 'eval/results/dev');
  const file = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.jsonl') && !f.endsWith('.grades.jsonl') && !f.endsWith('.perf.jsonl')) as string);
  const kinds = new Set(readResultsFile(file).records.map((r) => r.outcome.kind));
  for (const k of ['text', 'timeout', 'error', 'engine_fault', 'not_run']) assert.ok(kinds.has(k as 'text'), `missing outcome kind ${k}`);
  const run = await capture(() => regrade(env.deps(createFakeRuntime()), file));
  assert.equal(run.value, 0, run.err);
});
