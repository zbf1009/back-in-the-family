// Property 40 (llm-probe task 13.6): engine faults never reach a Metric.
// **Validates: Requirements 8.5, 8.13, 15.7.**
// Locked_Runs of a fake Runtime on a synthetic card set in temp dirs; the real eval/results and
// locked.jsonl are never touched. Idle_Cap hits, rebuild failures and forced runtime_stuck refusals
// are scripted; Metrics and the Report are computed over the Results the runner produced.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import type { AdapterResult } from '../../src/adapters/interface.ts';
import { loadCards } from '../../src/cards.ts';
import { deriveEntries, readLedger } from '../../src/ledger.ts';
import { computeMetrics, metricCardFromLoaded, type MetricCard } from '../../src/metrics.ts';
import { analyzeRun, buildReport, scanFaults } from '../../src/report.ts';
import { gradesPathFor, readFailures, readGradesFile, readResultsFile, SCHEMA, type GradeLine, type ResultRecord } from '../../src/results.ts';
import { devRun, lockedRun } from '../../src/run.ts';
import { capture, createFakeRuntime, defaultAnswer, FAKE_COMBO, makeCardSet, makeEnv } from './run.helpers.ts';

const cardSet = makeCardSet();
const metricCards: MetricCard[] = loadCards({ cardsDir: cardSet.dir, splits: ['locked'] }).cards.locked.map(metricCardFromLoaded);
const N = 74; // D requests per run (Card x Permutation)
const REBUILD = ['dispose', 'create', 'warmup', 'warmup'];

interface Plan {
  /** Offset in the Locked_Run -> whether the engine is still busy (stuck) at the Idle_Cap. */
  readonly timeouts: ReadonlyMap<number, boolean>;
  readonly refusals: ReadonlySet<number>;
  readonly failRebuild: boolean;
}

const planArb: fc.Arbitrary<Plan> = fc
  .record({
    timeouts: fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: N - 2 }), fc.boolean()), { maxLength: 4, selector: (t) => t[0] }),
    refusals: fc.uniqueArray(fc.integer({ min: 0, max: N - 2 }), { maxLength: 3 }),
    failRebuild: fc.boolean(),
  })
  .map((p) => {
    const taken = new Set(p.timeouts.map((t) => t[0]));
    return { timeouts: new Map(p.timeouts), refusals: new Set(p.refusals.filter((o) => !taken.has(o))), failRebuild: p.failRebuild };
  });

/** What the runner must do, request by request, for a plan. */
function expected(plan: Plan): { sent: number; abortAt: number | null; engine: string[]; hits: number[] } {
  const engine: string[] = ['load', ...Array<string>(N).fill('call'), 'load'];
  const hits: number[] = [];
  let first = true;
  for (let o = 0; o < N; o++) {
    engine.push('call');
    if (plan.timeouts.get(o) === true) {
      hits.push(o);
      if (plan.failRebuild && first) return { sent: o + 1, abortAt: o, engine: [...engine, 'dispose', 'create'], hits };
      engine.push(...REBUILD);
      first = false;
    }
  }
  return { sent: N, abortAt: null, engine, hits };
}

/** Stub grade lines for the records that have an output (an aborted run has no grades file). */
function stubGrades(records: readonly ResultRecord[]): GradeLine[] {
  return records
    .filter((r) => r.outcome.kind === 'text' || r.outcome.kind === 'timeout' || r.outcome.kind === 'error')
    .map((r) => ({ schema: SCHEMA.grade, card_id: r.card_id, permutation: r.permutation, verdict: null, grade: { acceptable: true, severe: false, illegal: r.outcome.kind !== 'text' }, identity: { kind: 'invalid' }, late_grade: null }));
}

const numbers = (m: ReturnType<typeof computeMetrics>) =>
  m.tasks.map((t) => [t.cards, t.acceptable.num, t.acceptable.den, t.severe.count, t.severe.den, t.illegal.num, t.illegal.den, t.flip.num, t.flip.den, t.contrast.num, t.contrast.den]);

test('Property 40: engine faults never reach a Metric', async () => {
  await fc.assert(
    fc.asyncProperty(planArb, async (plan) => {
      const env = makeEnv(cardSet);
      const timeout: AdapterResult = { kind: 'timeout', timeoutMs: 10_000, elapsedMs: 10_001, late: Promise.resolve({ kind: 'none', reason: 'idle_cap' }) };
      const stuck: AdapterResult = { kind: 'error', code: 'runtime_stuck', detail: 'forced', elapsedMs: 0, remote: null };
      let log: string[] = [];
      const stuckAfter = [...plan.timeouts].filter(([, busy]) => busy).map(([o]) => N + o);
      const rt = createFakeRuntime({
        failRebuilds: plan.failRebuild ? 1 : 0,
        stuckAfter,
        script: (i, p) => {
          log.push('call');
          const o = i - N;
          if (o >= 0 && plan.timeouts.has(o)) return timeout;
          if (o >= 0 && plan.refusals.has(o)) return stuck;
          return { kind: 'text', text: defaultAnswer(p), latencyMs: 1, usage: null };
        },
      });
      // Interleave engine events and calls in one log (the fake appends engine events to rt.engine).
      const engineLog = rt.engine;
      log = engineLog;

      assert.equal((await capture(() => devRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }))).value, 0);
      const ledgerFile = path.join(env.root, 'eval/results/ledger.jsonl');
      const run = await capture(() => lockedRun(env.deps(rt), { combo: FAKE_COMBO.id, task: 'D' }));
      const exp = expected(plan);
      const { events, entries } = readLedger(ledgerFile);
      const entry = entries[0]!;
      const file = path.join(env.root, 'eval/results/locked', `${entry.entry_id}.jsonl`);
      const { records } = readResultsFile(file);

      // (a) call order on the fake engine: after each Idle_Cap hit, rebuild + both warm-ups, then the next prompt.
      assert.deepEqual(engineLog, exp.engine);
      assert.equal(rt.calls.length - N, exp.sent);
      const outcomes = records.slice(0, exp.sent).map((r) => r.outcome.kind);
      for (const o of plan.timeouts.keys()) if (o < exp.sent) assert.equal(outcomes[o], 'timeout');
      if (exp.abortAt === null) {
        // no runtime_stuck record is written for a hit; only forced refusals produce engine_fault
        assert.equal(outcomes.filter((k) => k === 'engine_fault').length, plan.refusals.size);
      } else {
        assert.equal(outcomes.filter((k) => k === 'engine_fault').length, [...plan.refusals].filter((o) => o < exp.sent).length);
      }

      const faults = scanFaults(records);
      if (exp.abortAt !== null) {
        // (b) one rebuild_failed failure record, an abort event, not_run for all the rest, no grades file
        assert.equal(run.value, 1);
        const failures = readFailures(path.join(env.root, 'eval/results/failures.jsonl'));
        assert.equal(failures.filter((f) => f.kind === 'rebuild_failed').length, 1);
        assert.equal(failures.length, 1);
        assert.deepEqual(events.map((e) => e.event), ['start', 'abort']);
        assert.equal(entry.abort_reason, 'rebuild_failed');
        assert.equal(records.length, N);
        const rest = records.slice(exp.sent);
        assert.equal(rest.length, N - exp.sent);
        assert.ok(rest.every((r) => r.outcome.kind === 'not_run' && r.outcome.reason === 'rebuild_failed'));
        assert.equal(faults.filter((f) => f.kind === 'rebuild_failed').length, rest.length);
        assert.ok(!fs.existsSync(gradesPathFor(file)));

        // (d) the Combination is failed and listed; the entry stays incomplete and is resumable.
        const metrics = computeMetrics({ cards: metricCards, records, grades: stubGrades(records), contrasts: [], tasks: ['decision'] });
        assert.equal(metrics.combinationFailed, true);
        assert.ok(metrics.tasks.every((t) => !t.usableForMark));
        assert.equal(entry.status, 'incomplete');
        const report = buildReport({
          generated_on: '2026-11-10',
          environment: { targetMachine: 'Test machine', workersEndpoint: null },
          state: { combinations: [FAKE_COMBO], entries: deriveEntries(events), failures, exclusions: [], smoke: [], approvals: { approved: true, approvals: [] } },
          lockedRuns: [],
          incompleteFaults: new Map([[entry.entry_id, faults]]),
          devRuns: [],
          preflights: new Map(),
          runtimeLibraries: [],
        });
        assert.match(report, new RegExp(`${FAKE_COMBO.id}: failure record rebuild_failed`));
        assert.match(report, new RegExp(`entry ${entry.entry_id}\\): engine rebuild failed \\(rebuild_failed\\) for ${rest.length} request`));
        assert.match(report, new RegExp(`${entry.entry_id} \\(${FAKE_COMBO.id}, subset D\\): incomplete, aborted: rebuild_failed`));
        // The aborted entry is not graded card by card: no Illegal is made up for a not_run record. A Timeout is an Illegal
        // only on a Card the Metrics count: Sanity_Cards and Void_Cards stay out of every Metric (R2.8), so a Timeout on
        // one of them (for example at offset 72 of the fake plan) adds nothing to the numerator.
        const counted = new Set(metricCards.filter((c) => c.task === 'decision' && c.scored && !c.void).map((c) => c.id));
        assert.equal(metrics.tasks[0]!.illegal.num, records.filter((r) => r.outcome.kind === 'timeout' && r.permutation === 'base' && counted.has(r.card_id)).length);
        if (plan.refusals.size === 0) {
          const resumed = await capture(() => lockedRun(env.deps(rt), { resume: entry.entry_id }));
          assert.equal(resumed.value, 0, resumed.err);
          assert.equal(readLedger(ledgerFile).entries[0]?.status, 'complete');
        }
        return;
      }

      // (c) forced refusals: engine_fault, no grade line, in faults[] and section 10, in no numerator.
      // An engine_fault keeps the entry incomplete (R3.8), so it is reported from the Results file.
      const refused = records.filter((r) => r.outcome.kind === 'engine_fault');
      assert.equal(refused.length, [...plan.refusals].filter((o) => o < exp.sent).length);
      if (refused.length === 0) {
        assert.equal(run.value, 0, run.err);
        assert.equal(entry.status, 'complete');
        const grades = readGradesFile(gradesPathFor(file));
        for (const r of records.filter((x) => x.outcome.kind === 'timeout')) {
          const g = grades.grades.find((x) => x.card_id === r.card_id && x.permutation === r.permutation);
          assert.equal((g?.grade as { illegal: boolean }).illegal, true);
        }
        const analysis = analyzeRun({ kind: 'locked', id: entry.entry_id, cards: metricCards, header: readResultsFile(file).header, records, grades, perf: null });
        assert.equal(analysis.faults.length, 0);
        assert.equal(analysis.combinationFailed, false);
        return;
      }
      assert.equal(entry.status, 'incomplete');
      const grades = stubGrades(records);
      for (const r of refused) assert.ok(!grades.some((g) => g.card_id === r.card_id && g.permutation === r.permutation));
      const withFaults = computeMetrics({ cards: metricCards, records, grades, contrasts: [], tasks: ['decision'] });
      const without = computeMetrics({ cards: metricCards, records: records.filter((r) => r.outcome.kind !== 'engine_fault'), grades, contrasts: [], tasks: ['decision'] });
      assert.deepEqual(numbers(withFaults), numbers(without));
      assert.equal(withFaults.faults.filter((f) => f.kind === 'engine_fault').length, refused.length);
      assert.ok(withFaults.tasks.every((t) => !t.usableForMark));
      const report = buildReport({
        generated_on: '2026-11-10',
        environment: { targetMachine: 'Test machine', workersEndpoint: null },
        state: { combinations: [FAKE_COMBO], entries, failures: [], exclusions: [], smoke: [], approvals: { approved: true, approvals: [] } },
        lockedRuns: [],
        incompleteFaults: new Map([[entry.entry_id, faults]]),
        devRuns: [],
        preflights: new Map(),
        runtimeLibraries: [],
      });
      assert.match(report.slice(report.indexOf('### Engine faults')), new RegExp(`entry ${entry.entry_id}\\): runtime_stuck engine fault on ${refused.length} request`));
    }),
    {
      numRuns: 12,
      // Regression: seed 1120750890 shrank to this plan. The Timeout at offset 72 is on a Card the Metrics do not count.
      examples: [[{ timeouts: new Map([[72, true]]), refusals: new Set<number>(), failRebuild: true }]],
    },
  );
});
