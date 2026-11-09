// Properties 54 and 55 (llm-probe task 42.4): the Report's perm_avg additions. Synthetic analyses and records only; no card
// content and no real file is read. Coverage is by pinned examples (passed to fast-check as `examples`), not by random luck.
// **Validates: Requirements 20.13, 20.14, 20.15, 20.16, 19.13, 19.17, 14.1**
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import type { Approval } from '../../src/approvals.ts';
import { deriveEntries } from '../../src/ledger.ts';
import type { TaskMetrics } from '../../src/metrics.ts';
import type { Combination, DerivedRunInfo } from '../../src/phase.ts';
import {
  buildReport,
  HOLD_BANNER_PREFIX,
  SELECTION_BIAS_NOTE,
  type DerivedRunView,
  type ReportInput,
  type RunAnalysis,
  type TaskAnalysis,
} from '../../src/report.ts';
import {
  FINE_TUNING_SENTENCE,
  multiplierDistribution,
  NON_INDEPENDENCE_SENTENCE,
  ONE_REQUEST_ALTERNATIVE,
  PERM_AVG_FLIP_CELL,
  permAvgMark,
  positionDistribution,
  PREREGISTRATION_SENTENCE,
  PRODUCTION_NOTE,
} from '../../src/report-variants.ts';
import type { ResultRecord } from '../../src/results.ts';
import { BY_CONSTRUCTION_PASS_LABEL } from '../../src/metrics.ts';
import { baseState, BROWSER, DM_A, entryEvents, GEMMA } from './decision-gate.helpers.ts';

const AGG = 'a'.repeat(64);
const SHA = 'c'.repeat(64);
const PA_A = {
  id: `${DM_A.id}/perm_avg`, runtime: DM_A.runtime, model_id: DM_A.model_id, quantization: '', revision: DM_A.revision, phase1_locked: false,
  response_shape: 'system_one', variant: 'perm_avg', derives_from: DM_A.id, sends_requests: false, aggregation: { file: 'x.txt', rule_version: 1, sha256: AGG },
} as unknown as Combination;
const COMBOS: readonly Combination[] = [BROWSER, GEMMA, DM_A, PA_A];
const PERMS = ['base', 'reversed', 'rotated_1', 'rotated_2'] as const;

// ---------------------------------------------------------------- synthetic analyses

interface CardSpec {
  calls: 1 | 2 | 4;
  illegal: boolean;
  original: number;
  shown: number[];
  latencies: number[];
}

const ratio = (num: number, den: number, verdict: 'pass' | 'fail' = 'pass'): Record<string, unknown> => ({ num, den, verdict });

function metricsOf(cards: readonly CardSpec[], passes: boolean, usable: boolean, byConstruction: boolean): TaskMetrics {
  const ids = cards.map((_, i) => `D-${i}`);
  return {
    task: 'decision',
    cards: cards.length,
    acceptable: ratio(18, 20, passes ? 'pass' : 'fail'),
    severe: { count: 0, den: 20, verdict: 'pass' },
    severeOtherPermutations: 0,
    illegal: { num: cards.filter((c) => c.illegal).length, den: Math.max(cards.length, 1) },
    flip: byConstruction ? { mode: 'by_construction' } : { num: 3, den: 60, verdict: 'pass' },
    contrast: ratio(10, 10),
    randomBaseline: null,
    passes,
    withoutTimeout: { acceptable: { num: 18, den: 20 }, severe: 0, illegal: { num: 0, den: 20 }, replaced: 0 },
    cardsWithoutBaseOutput: 0,
    faults: { engineFault: 0, rebuildFailed: 0 },
    usableForMark: usable,
    perCard: ids.map((cardId, i) => ({ cardId, scenarioGroup: `g${i}`, hasOutput: true, acceptable: true, severe: false, illegal: (cards[i] as CardSpec).illegal })),
    pairs: [],
  } as unknown as TaskMetrics;
}

function analysisOf(metrics: TaskMetrics): TaskAnalysis {
  return {
    metrics,
    acceptable: { cluster: null, wilson: null, icc: { kind: 'not_estimable', reason: 'no_data' } },
    illegal: { cluster: null, wilson: null, icc: { kind: 'not_estimable', reason: 'no_data' } },
    contrastInterval: null,
    latency: { covered: 0, timeouts: 0, errors: 0, p50: 'no data', p95: 'no data' },
    acceptableLabel: null,
    contrastLabel: null,
    acceptableMark: null,
    contrastMark: null,
  } as unknown as TaskAnalysis;
}

function runOf(id: string, combination: string, kind: 'dev' | 'locked', task: TaskAnalysis, derived: boolean): RunAnalysis {
  return {
    kind,
    id,
    combination,
    header: { run_id: id, combination, task_subset: 'D', fingerprint: {}, ...(derived ? { derived_from: { combination: DM_A.id, run_id: 'src', ledger_entry: kind === 'locked' ? 'L-77' : null, results_file: 'f', results_sha256: SHA } } : {}) },
    tasks: [task],
    sanity: [],
    excluded: [],
    excludedPairs: [],
    faults: [],
    combinationFailed: false,
    sources: [],
    perf: null,
  } as unknown as RunAnalysis;
}

function recordsOf(cards: readonly CardSpec[]): ResultRecord[] {
  return cards.map((c, i) => {
    const calls = PERMS.slice(0, c.calls).map((permutation, k) => ({ permutation, choice: 'o1', probabilities: [], latency_ms: c.latencies[k] ?? 0, input_tokens: 1 }));
    return {
      card_id: `D-${i}`,
      permutation: 'base',
      perm_avg: {
        scope: 'scored',
        rule_version: 1,
        chosen: c.illegal ? null : 'o1',
        sums: null,
        calls,
        positions: c.illegal ? null : { original: c.original, shown: PERMS.slice(0, c.calls).map((permutation, k) => ({ permutation, position: c.shown[k] ?? 1 })) },
      },
    } as unknown as ResultRecord;
  });
}

interface ReportSpec {
  cards: CardSpec[];
  passes: boolean;
  usable: boolean;
  split: 'dev' | 'locked';
  withSingle: boolean;
  hold: boolean;
  /** Whether the single variant has an attempted Dev_Run (feeds the candidate count). */
  singleDev: boolean;
}

function buildInput(spec: ReportSpec | null): ReportInput {
  const events = [...entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z')];
  if (spec?.withSingle === true) events.push(...entryEvents(DM_A, 'L-77', 'D', '2026-11-09T01:00:00Z'));
  const approvals: Approval[] =
    spec?.hold === true ? [{ id: 'H1', kind: 'decision_model', step: 'derive_locked', variant: 'perm_avg', combination: PA_A.id, task_subset: 'D', max_requests: 0, approved_on: '2026-11-10', note: '' }] : [];
  const derivedInfo: DerivedRunInfo[] = spec === null ? [] : [{ run_id: 'derived-1', combination: PA_A.id, split: spec.split, template_hashes: {} }];
  const lockedRuns: RunAnalysis[] = [];
  const derivedRuns: DerivedRunView[] = [];
  if (spec !== null) {
    if (spec.withSingle) lockedRuns.push(runOf('L-77', DM_A.id, 'locked', analysisOf(metricsOf(spec.cards, true, true, false)), false));
    derivedRuns.push({ split: spec.split, analysis: runOf('derived-1', PA_A.id, spec.split, analysisOf(metricsOf(spec.cards, spec.passes, spec.usable, true)), true), records: recordsOf(spec.cards) });
  }
  const base = baseState({
    combinations: COMBOS,
    entries: deriveEntries(events),
    approvals: { approved: true, approvals },
    devRuns: spec?.singleDev === true ? [{ run_id: 'dev-1', combination: DM_A.id, task_subset: 'D', template_hashes: {}, attempted: true }] : [],
    derived: derivedInfo,
  });
  const { passes: _p, overLimit: _o, ...state } = base;
  return { generated_on: '2026-11-10', environment: { targetMachine: 'Test machine', workersEndpoint: null }, state, lockedRuns, incompleteFaults: new Map(), devRuns: [], preflights: new Map(), runtimeLibraries: [], derivedRuns };
}

const section = (report: string, heading: string): string => {
  const start = report.indexOf(`\n## ${heading}`);
  assert.ok(start >= 0, `section ${heading} found`);
  const next = report.indexOf('\n## ', start + 4);
  return report.slice(start, next < 0 ? undefined : next);
};
const rows = (text: string): string[][] => text.split('\n').filter((l) => /^\| /.test(l) && !/^\| ---/.test(l)).map((l) => l.slice(2, -2).split(' | '));

// ---------------------------------------------------------------- generators

const cardArb: fc.Arbitrary<CardSpec> = fc
  .record({
    calls: fc.constantFrom<1 | 2 | 4>(1, 2, 4, 4),
    illegal: fc.constantFrom(false, false, false, true),
    original: fc.integer({ min: 1, max: 5 }),
    shown: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 4, maxLength: 4 }),
    latencies: fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 4, maxLength: 4 }),
  });
const specArb: fc.Arbitrary<ReportSpec> = fc.record({
  cards: fc.array(cardArb, { minLength: 1, maxLength: 12 }),
  passes: fc.boolean(),
  usable: fc.constantFrom(true, true, false),
  split: fc.constantFrom<'dev' | 'locked'>('dev', 'locked'),
  withSingle: fc.boolean(),
  hold: fc.boolean(),
  singleDev: fc.boolean(),
});

const C = (calls: 1 | 2 | 4, shown: number[], original = 1, illegal = false): CardSpec => ({ calls, illegal, original, shown, latencies: [10, 20, 30, 40] });
const FIXED_CARDS: CardSpec[] = [C(4, [1, 2, 3, 4], 1), C(4, [2, 1, 5, 3], 2), C(2, [3, 1], 3), C(1, [1], 1), C(4, [1, 1, 1, 1], 1, true)];
const PINNED: ReportSpec[] = [
  { cards: FIXED_CARDS, passes: true, usable: true, split: 'locked', withSingle: true, hold: true, singleDev: true },
  { cards: FIXED_CARDS, passes: false, usable: true, split: 'locked', withSingle: false, hold: false, singleDev: false },
  { cards: FIXED_CARDS, passes: true, usable: false, split: 'locked', withSingle: true, hold: false, singleDev: false },
  { cards: FIXED_CARDS, passes: true, usable: true, split: 'dev', withSingle: true, hold: true, singleDev: true },
];

// ---------------------------------------------------------------- Property 54

function checkMarks(spec: ReportSpec): void {
  const report = buildReport(buildInput(spec));
  const expectedMark = !spec.usable ? 'not used for a mark (missing outputs or engine faults)' : spec.passes ? BY_CONSTRUCTION_PASS_LABEL : 'fail';
  assert.equal(BY_CONSTRUCTION_PASS_LABEL, 'pass (flip guaranteed by construction, not measured)');

  // Section 4: a Locked derived file is marked; a Dev one is not (Dev_Run figures feed no mark).
  const s4 = section(report, '4. ');
  const heading = `### ${PA_A.id}, Task_Type D (decision), derived run derived-1`;
  if (spec.split === 'locked') {
    const block = s4.slice(s4.indexOf(heading));
    assert.ok(s4.includes(heading), 'derived block present');
    const end = block.indexOf('\n### ', 5);
    const text = end < 0 ? block : block.slice(0, end);
    assert.ok(text.includes(`Mark: **${expectedMark}**.`), text.split('\n').slice(0, 3).join('\n'));
    const flip = rows(text).find((r) => (r[0] ?? '').startsWith('Flip rate'));
    assert.deepEqual(flip?.slice(1, 3), [PERM_AVG_FLIP_CELL, 'not applicable']);
    assert.equal(flip?.[4], 'by construction (not measured)');
    assert.ok(text.includes('Derived from the stored records of `' + DM_A.id + '`, ledger entry L-77, source Results sha256 ' + SHA));
    assert.ok(text.includes('not an independent measurement from the `single` run'));
  } else {
    assert.ok(!s4.includes(heading), 'a Dev derived file is not a Locked_Run figure');
  }

  // Everywhere the pass label appears, it is the full label: the bare word "pass" is never the mark of a perm_avg block.
  for (const m of report.matchAll(/Mark: \*\*([^*]*)\*\*/g)) {
    const mark = m[1] as string;
    if (mark.startsWith('pass') && mark !== 'pass') assert.equal(mark, BY_CONSTRUCTION_PASS_LABEL);
  }

  // Section 4a: both variants side by side, the figures of one never in the other's column.
  const s4a = section(report, '4a. ');
  const t = rows(s4a);
  const rowOf = (name: string): string[] => t.find((r) => r[0] === name) as string[];
  const flipRow = rowOf('Flip rate');
  assert.ok(flipRow !== undefined);
  assert.equal(flipRow[2], spec.split === 'locked' ? PERM_AVG_FLIP_CELL : 'not measured (no Locked Derived_Run)');
  assert.ok(spec.withSingle ? (flipRow[1] as string).includes('3/60') : (flipRow[1] as string).startsWith('not measured'));
  const markRow = rowOf('Mark');
  assert.equal(markRow[2], spec.split === 'locked' ? expectedMark : 'not measured (no Locked Derived_Run)');
  assert.ok(!(markRow[1] as string).includes('guaranteed by construction'));
  if (spec.split === 'locked') assert.ok(!(flipRow[2] as string).includes('/'), 'no numbers in the perm_avg flip cell');

  // Section 2: the count of Phase_2 candidates, the note, and the two R20.13 sentences.
  const s2 = section(report, '2. ');
  const tried = [spec.withSingle || spec.singleDev ? DM_A.id : null, PA_A.id].filter((x): x is string => x !== null).sort();
  assert.ok(s2.includes(`Phase_2 candidates tried: ${tried.length} (${tried.join(', ')})`), s2);
  assert.equal(s2.includes(SELECTION_BIAS_NOTE), tried.length >= 2);
  assert.ok(s2.includes(PREREGISTRATION_SENTENCE) && s2.includes(NON_INDEPENDENCE_SENTENCE));

  // Section 9: the hold banner lists the variant by its own Combination ID.
  const s9 = section(report, '9. ');
  assert.equal(s9.includes(`${HOLD_BANNER_PREFIX}${PA_A.id}`), spec.hold && spec.split !== 'locked');
  // The perm_avg record is not a separate candidate row in the candidate table (section 3).
  assert.ok(!section(report, '3. ').includes(`| ${PA_A.id} |`));
}

test('Property 54 (pinned): marks, flip row, derivation line, side-by-side columns, count and banner', () => {
  for (const spec of PINNED) checkMarks(spec);
});

test('Property 54: the Report labels a perm_avg pass, shows the flip as by construction and never mixes variants', () => {
  fc.assert(fc.property(specArb, (spec) => checkMarks(spec)), { numRuns: 150, examples: PINNED.map((p) => [p] as [ReportSpec]) });
});

test('Property 54: permAvgMark is the only source of the mark and the derivation line, and refuses a measured flip', () => {
  const m = (passes: boolean, usable = true) => metricsOf(FIXED_CARDS, passes, usable, true);
  const src = { single: DM_A.id, ledgerEntry: 'L-9', sourceSha256: SHA };
  assert.equal(permAvgMark(m(true), src).mark, 'pass (flip guaranteed by construction, not measured)');
  assert.equal(permAvgMark(m(false), src).mark, 'fail');
  assert.match(permAvgMark(m(true, false), src).mark, /^not used for a mark/);
  assert.match(permAvgMark(m(true), src).derivationLine, /ledger entry L-9, source Results sha256 c{64}; no request was sent for it;.*not an independent measurement from the `single` run\.$/);
  assert.match(permAvgMark(m(true), { ...src, ledgerEntry: null }).derivationLine, /ledger entry none \(Dev_Run source\)/);
  assert.throws(() => permAvgMark(metricsOf(FIXED_CARDS, true, true, false), src), /by_construction/);
});

test('Property 54 (pinned): without any Derived_Run the 4a to 4c sections say "not measured" and the sentences of R20.13 are absent', () => {
  const report = buildReport(buildInput(null));
  assert.ok(section(report, '4b. ').includes('No Derived_Run yet (not measured).'));
  assert.ok(section(report, '4a. ').includes('not measured (no Locked Derived_Run)'));
  assert.ok(!report.includes(PREREGISTRATION_SENTENCE));
  assert.ok(!section(report, '3. ').includes(PA_A.id));
});

// ---------------------------------------------------------------- Property 55

const nearest = (sorted: number[], p: number): number | 'no data' => (sorted.length === 0 ? 'no data' : (sorted[Math.floor((p * sorted.length + 99) / 100) - 1] as number));

function checkCounts(spec: ReportSpec): void {
  const cards = spec.cards;
  const records = recordsOf(cards);
  const scored = new Set(cards.map((_, i) => `D-${i}`));
  const d = positionDistribution(records, scored);

  // Independent oracle, written out again.
  const expectedRows = new Map<string, number[]>();
  const expectedOriginal = [0, 0, 0, 0, 0];
  let illegal = 0;
  for (const c of cards) {
    if (c.illegal) {
      illegal++;
      continue;
    }
    expectedOriginal[c.original - 1]++;
    PERMS.slice(0, c.calls).forEach((p, k) => {
      const row = expectedRows.get(p) ?? [0, 0, 0, 0, 0];
      row[(c.shown[k] as number) - 1]++;
      expectedRows.set(p, row);
    });
  }
  assert.equal(d.illegal, illegal);
  assert.equal(d.total, cards.length);
  assert.deepEqual(d.original, expectedOriginal);
  for (const r of d.rows) assert.deepEqual(r.counts, expectedRows.get(r.permutation));
  assert.deepEqual(d.rows.map((r) => r.permutation), PERMS.filter((p) => expectedRows.has(p)));
  // Row sums plus Illegal equal the number of cards; the original row too.
  assert.equal(d.original.reduce((a, b) => a + b, 0) + d.illegal, d.total);
  const base = d.rows.find((r) => r.permutation === 'base');
  assert.equal((base?.counts.reduce((a, b) => a + b, 0) ?? 0) + d.illegal, d.total);

  const mult = multiplierDistribution(records, scored);
  const byCalls = new Map<number, number>();
  for (const c of cards) byCalls.set(c.calls, (byCalls.get(c.calls) ?? 0) + 1);
  assert.deepEqual(mult.byCalls, [...byCalls].sort(([a], [b]) => a - b).map(([calls, n]) => ({ calls, cards: n })));
  const sums = cards.map((c) => c.latencies.slice(0, c.calls).reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
  const maxes = cards.map((c) => Math.max(...c.latencies.slice(0, c.calls))).sort((a, b) => a - b);
  assert.deepEqual(mult.sum, { p50: nearest(sums, 50), p95: nearest(sums, 95) });
  assert.deepEqual(mult.max, { p50: nearest(maxes, 50), p95: nearest(maxes, 95) });

  // The printed tables are those figures.
  const report = buildReport(buildInput(spec));
  const s4b = section(report, '4b. ');
  const printed = rows(s4b);
  for (const r of d.rows) assert.deepEqual(printed.find((x) => x[0] === r.permutation), [r.permutation, ...r.counts.map(String)]);
  assert.deepEqual(printed.find((x) => x[0] === 'original position'), ['original position', ...d.original.map(String)]);
  assert.ok(s4b.includes(`Illegal answers (in no position cell): ${illegal}. Cards counted: ${cards.length}.`));
  const s4c = section(report, '4c. ');
  const t4c = rows(s4c);
  for (const r of mult.byCalls) assert.deepEqual(t4c.find((x) => x[0] === String(r.calls)), [String(r.calls), String(r.cards)]);
  assert.deepEqual(t4c.find((x) => (x[0] ?? '').startsWith('Sum of the calls')), ['Sum of the calls (in sequence)', String(mult.sum.p50), String(mult.sum.p95)]);
  assert.deepEqual(t4c.find((x) => (x[0] ?? '').startsWith('Maximum of the calls')), ['Maximum of the calls (in parallel)', String(mult.max.p50), String(mult.max.p95)]);

  // The production note and the one-request alternative are always printed with 4c (R20.15).
  assert.ok(s4c.includes(PRODUCTION_NOTE));
  assert.ok(s4c.includes(ONE_REQUEST_ALTERNATIVE) && /not measured/.test(ONE_REQUEST_ALTERNATIVE));
  assert.ok(report.includes(FINE_TUNING_SENTENCE));
}

test('Property 55 (pinned): fixed cards with 4, 2 and 1 calls and one Illegal answer', () => {
  checkCounts(PINNED[0] as ReportSpec);
  const d = positionDistribution(recordsOf(FIXED_CARDS), new Set(FIXED_CARDS.map((_, i) => `D-${i}`)));
  assert.equal(d.illegal, 1);
  assert.deepEqual(d.original, [2, 1, 1, 0, 0]);
  const m = multiplierDistribution(recordsOf(FIXED_CARDS), new Set(FIXED_CARDS.map((_, i) => `D-${i}`)));
  assert.deepEqual(m.byCalls, [{ calls: 1, cards: 1 }, { calls: 2, cards: 1 }, { calls: 4, cards: 3 }]);
});

test('Property 55 (pinned): a Card outside the scored set (a Sanity or Void Card) is in no count', () => {
  const records = recordsOf(FIXED_CARDS);
  const d = positionDistribution(records, new Set(['D-0', 'D-1']));
  assert.equal(d.total, 2);
  assert.equal(multiplierDistribution(records, new Set(['D-0', 'D-1'])).cards, 2);
  assert.deepEqual(multiplierDistribution([], new Set()).sum, { p50: 'no data', p95: 'no data' });
});

test('Property 55: position distributions and the Request_Multiplier are exact counts of the derived records', () => {
  fc.assert(fc.property(specArb, (spec) => checkCounts(spec)), { numRuns: 150, examples: PINNED.map((p) => [p] as [ReportSpec]) });
});
