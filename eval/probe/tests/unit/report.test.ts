// Smoke tests for the Report generator (llm-probe task 10.2). Fully synthetic: no real card is
// loaded and the locked split is never read. Property 37 and the full example tests are 10.3/10.4.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Approval } from '../../src/approvals.ts';
import type { TaskType } from '../../src/cards.ts';
import { deriveEntries, LEDGER_SCHEMA, type LedgerEvent } from '../../src/ledger.ts';
import type { MetricCard } from '../../src/metrics.ts';
import type { Combination } from '../../src/phase.ts';
import { analyzeRun, buildReport, DEV_SECTION_TITLE, type ReportInput, type RunAnalysis } from '../../src/report.ts';
import { SCHEMA, type ContrastLine, type GradeLine, type JsonValue, type ResultRecord, type ResultsHeader, type SmokeRecord, type TaskSubset } from '../../src/results.ts';

const REV = 'b'.repeat(40);
const combo = (id: string, extra: Partial<Combination> = {}): Combination => ({
  id,
  runtime: 'webllm',
  model_id: `Model-${id}`,
  quantization: 'q4f32_1',
  revision: REV,
  phase1_locked: true,
  ...extra,
});
const LFM = combo('transformers/lfm/nvidia', {
  runtime: 'transformers.js',
  license: { name: 'LFM Open License v1.0', osi: false, url: 'https://example.test/lfm', declared_by: 'base_model', accepted: '2026-11-06' },
});
const QWEN = combo('webllm/qwen/nvidia', { license: { name: 'Apache-2.0', osi: true, url: 'https://example.test/qwen', declared_by: 'model', accepted: null } });
const WAI = combo('workers-ai/gemma', { runtime: 'workers-ai', quantization: '', revision: 'server-side, not pinnable', phase1_locked: false, response_shape: 'chat' });

/** Eight cards of one Task_Type in four pairs; `good` decides whether the outputs are acceptable. */
function cardsOf(task: TaskType): MetricCard[] {
  const t = task === 'decision' ? 'D' : 'S';
  return Array.from({ length: 8 }, (_, i) => ({
    id: `${t}-${i + 1}`,
    task,
    scored: true,
    void: false,
    scenarioGroup: `${t}-g${Math.floor(i / 2) + 1}`,
    pairId: `${t}-pair${Math.floor(i / 2) + 1}`,
    role: i % 2 === 0 ? ('a' as const) : ('b' as const),
    acceptableCount: task === 'decision' ? 1 : null,
    optionCount: task === 'decision' ? 4 : null,
  }));
}

function run(entryId: string, c: Combination, task: TaskType, good: boolean): RunAnalysis {
  const subset: TaskSubset = task === 'decision' ? 'D' : 'S';
  const cards = cardsOf(task);
  const header: ResultsHeader = {
    schema: SCHEMA.header,
    run_id: entryId,
    split: 'locked',
    combination: c.id,
    model_key: { runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision },
    task_subset: subset,
    fingerprint: { runtime: { name: c.runtime, version: '1.0.0' }, webgpu: { vendor: 'nvidia' } },
    template_hashes: {},
    timeout_ms: 10000,
    placement: { method: 'test', cpu_nodes: [] },
  };
  const grade: JsonValue = { acceptable: good, severe: false, illegal: false, severe_conditions: [] };
  const perms = cards.flatMap((card) => ['base', 'reversed'].map((permutation) => ({ card, permutation })));
  const records: ResultRecord[] = perms.map(({ card, permutation }) => ({
    schema: SCHEMA.result,
    run_id: entryId,
    split: 'locked',
    card_id: card.id,
    permutation,
    outcome: { kind: 'text', text: '{}' },
    latency_ms: 100,
    timeout_ms: 10000,
    requested_at: '2026-11-07T09:00:00.000Z',
    template_hash: 'h',
    fingerprint_id: 'fp',
    usage: null,
    late: null,
    source: 'headless',
  }));
  const grades: GradeLine[] = perms.map(({ card, permutation }) => ({
    schema: SCHEMA.grade,
    card_id: card.id,
    permutation,
    verdict: null,
    grade,
    identity: { kind: 'option', option: 'a' },
    late_grade: null,
  }));
  const contrasts: ContrastLine[] = [...new Set(cards.map((x) => x.pairId as string))].map((pair_id) => ({
    schema: SCHEMA.contrast,
    pair_id,
    contrast: { consistent: good },
  }));
  return analyzeRun({ kind: 'locked', id: entryId, cards, header, records, grades: { grades, contrasts, excluded: [] }, perf: null });
}

function start(c: Combination, id: string, subset: TaskSubset, at: string): LedgerEvent[] {
  return [
    {
      schema: LEDGER_SCHEMA,
      event: 'start',
      entry_id: id,
      model_key: { runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision },
      combination: c.id,
      task_subset: subset,
      fingerprint: {},
      template_hashes: {},
      started_at: at,
      rerun_of: null,
      rerun_reason: null,
      overlaps: [],
      approval: null,
      planned: subset === 'D' ? { decision: 8 } : { synthesis: 8 },
    },
    { schema: LEDGER_SCHEMA, event: 'complete', entry_id: id, ended_at: at, results: 'x', requests_sent: 8 },
  ];
}

const P2_A: Approval = { id: 'P2-001', kind: 'phase2', branch: 'A', task_subset: null, approved_on: '2026-11-08', note: '' };
const SMOKE = (n: number, ok: boolean): SmokeRecord[] =>
  Array.from({ length: n }, () => ({ schema: SCHEMA.smoke, combination: WAI.id, verdict: { kind: ok ? 'decision' : 'illegal' } }) as SmokeRecord);

function input(good: boolean, over: Partial<ReportInput['state']> = {}): ReportInput {
  const runs = [run('L-1', QWEN, 'decision', good), run('L-2', QWEN, 'synthesis', good), run('L-3', LFM, 'decision', good), run('L-4', LFM, 'synthesis', good)];
  const events = [...start(QWEN, 'L-1', 'D', '2026-11-07T01:00:00Z'), ...start(QWEN, 'L-2', 'S', '2026-11-07T02:00:00Z'), ...start(LFM, 'L-3', 'D', '2026-11-07T03:00:00Z'), ...start(LFM, 'L-4', 'S', '2026-11-07T04:00:00Z')];
  return {
    generated_on: '2026-11-09',
    environment: { targetMachine: 'Test machine', workersEndpoint: null },
    state: { combinations: [QWEN, LFM, WAI], entries: deriveEntries(events), failures: [], exclusions: [], smoke: SMOKE(5, true), approvals: { approved: true, approvals: [P2_A] }, ...over },
    lockedRuns: runs,
    incompleteFaults: new Map(),
    devRuns: [],
    preflights: new Map(),
    runtimeLibraries: [],
  };
}

const HEADINGS = [
  '## 1. ',
  '## 2. ',
  '## 3. ',
  '## 4. ',
  '## 5. ',
  '## 6. ',
  '## 7. ',
  '## 8. ',
  '## 9. ',
  '## 10. ',
  '## 11. ',
];

test('the eleven sections come in order, followed by the without-timeout and Dev_Run sections', () => {
  const report = buildReport(input(true));
  let at = -1;
  for (const h of HEADINGS) {
    const next = report.indexOf(`\n${h}`);
    assert.ok(next > at, `section "${h}" missing or out of order`);
    at = next;
  }
  assert.ok(report.indexOf('## Quality without timeout') > at);
  assert.ok(report.includes(`## ${DEV_SECTION_TITLE}`));
});

test('when both Task_Types pass in the browser the Workers AI link is "not measured (browser passed)" with Smoke_Call counts', () => {
  const report = buildReport(input(true));
  assert.match(report, /not measured \(browser passed\)/);
  assert.match(report, /Smoke_Calls sent: 5; accepted by the Output_Validator: 5/);
  assert.match(report, /approved on 2026-11-08, branch A/);
  assert.match(report, /custom license, not OSI-approved/);
  assert.match(report, /accepted by the Author on 2026-11-06/);
  assert.match(report, /the conversion repository Model-transformers\/lfm\/nvidia declares no license/);
});

test('when nothing passes the recommendation is the Rules_Default alone, with the failed Thresholds', () => {
  const report = buildReport(input(false, { smoke: [] }));
  assert.match(report, /Recommendation for D: \*\*Rules_Default alone\.\*\*/);
  assert.match(report, /Recommendation for S: \*\*Rules_Default alone\.\*\*/);
  assert.match(report, /acceptable rate 0\/8 = 0\.0%, below 80%/);
  assert.doesNotMatch(report, /not measured \(browser passed\)/);
});

test('an Exclusion_Record removes a passing Combination from the support marks', () => {
  const base = input(true);
  const report = buildReport({
    ...base,
    state: { ...base.state, exclusions: [{ schema: SCHEMA.exclusion, combination: QWEN.id, model: QWEN.model_id, check: 'vram', value: 3000, limit: 2600, at: '2026-11-05T00:00:00Z' }] },
  });
  assert.match(report, /Exclusion_Record \(vram\)/);
  assert.match(report, /VRAM need \(MiB\): value 3000, limit 2600/);
  assert.doesNotMatch(report, /\*\*webllm\/qwen\/nvidia/);
});
