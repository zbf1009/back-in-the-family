// The Report prints the request-level D baseline and the position diagnosis next to Dev_Run scores
// (llm-probe task 20.6). Synthetic cards; no real card is loaded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecisionCardFacts } from '../../src/diagnosis.ts';
import type { MetricCard } from '../../src/metrics.ts';
import type { Combination } from '../../src/phase.ts';
import { analyzeRun, buildReport, DEV_D_FINDING, type ReportInput } from '../../src/report.ts';
import { SCHEMA, type GradeLine, type ResultRecord, type ResultsHeader } from '../../src/results.ts';

const QWEN: Combination = { id: 'webllm/qwen/nvidia', runtime: 'webllm', model_id: 'Model-q', quantization: 'q4f32_1', revision: 'b'.repeat(40), phase1_locked: true };

const facts: DecisionCardFacts[] = ['D-1', 'D-2'].map((id) => ({ id, scored: true, void: false, optionIds: ['a', 'b', 'c', 'd'], acceptableCount: 2 }));
const cards: MetricCard[] = facts.map((f, i) => ({ id: f.id, task: 'decision', scored: true, void: false, scenarioGroup: 'g', pairId: 'p', role: i === 0 ? 'a' : 'b', acceptableCount: 2, optionCount: 4 }));

function devReport(withFacts: boolean): string {
  const header: ResultsHeader = {
    schema: SCHEMA.header,
    run_id: 'dev-test',
    split: 'dev',
    combination: QWEN.id,
    model_key: { runtime: QWEN.runtime, model_id: QWEN.model_id, quantization: QWEN.quantization, revision: QWEN.revision },
    task_subset: 'D',
    fingerprint: { runtime: { name: 'webllm', version: '1' }, webgpu: { vendor: 'nvidia' } },
    template_hashes: {},
    timeout_ms: 10000,
    placement: { method: 'test', cpu_nodes: [] },
  };
  const perms = cards.flatMap((card) => ['base', 'reversed'].map((permutation) => ({ card, permutation })));
  const records: ResultRecord[] = perms.map(({ card, permutation }) => ({
    schema: SCHEMA.result, run_id: 'dev-test', split: 'dev', card_id: card.id, permutation, outcome: { kind: 'text', text: '{}' }, latency_ms: 100, timeout_ms: 10000,
    requested_at: '2026-11-08T09:00:00.000Z', template_hash: 'h', fingerprint_id: 'fp', usage: null, late: null, source: 'headless',
  }));
  const grades: GradeLine[] = perms.map(({ card, permutation }) => ({
    schema: SCHEMA.grade, card_id: card.id, permutation, verdict: null,
    grade: { acceptable: true, severe: false, illegal: false, severe_conditions: [] },
    identity: { kind: 'option', option: 'a' }, late_grade: null,
  }));
  const dev = analyzeRun({ kind: 'dev', id: 'dev-test', cards, header, records, grades: { grades, contrasts: [], excluded: [] }, perf: null, ...(withFacts ? { decisionCards: facts } : {}) });
  const input: ReportInput = {
    generated_on: '2026-11-09',
    environment: { targetMachine: 'Test machine', workersEndpoint: null },
    state: { combinations: [QWEN], entries: [], failures: [], exclusions: [], smoke: [], approvals: { approved: true, approvals: [] } },
    lockedRuns: [],
    incompleteFaults: new Map(),
    devRuns: [dev],
    preflights: new Map(),
    runtimeLibraries: [],
  };
  return buildReport(input);
}

test('the Dev section prints the computed random baseline, the shuffle counts and the Author finding', () => {
  const text = devReport(true);
  assert.ok(text.includes(DEV_D_FINDING));
  // The Dev table cell carries the card-level Random_Baseline next to the D score (2 of 4 options acceptable on every card).
  assert.match(text, /\| D \| 2\/2 \(100\.0%\); random baseline 50\.0% \|/);
  assert.match(text, /Dev_Run D, request level: acceptable 4\/4 \(100\.0%\) against a random baseline of 50\.0% \(expected 2\.0 of 4\)/);
  assert.match(text, /Dev_Run D, shuffle: 0 of 2 comparisons/);
  assert.match(text, /4-option cards, 4 valid picks: by original position 4 \/ 0 \/ 0 \/ 0; by shown position 2 \/ 0 \/ 0 \/ 2/);
});

test('without D card facts the Report leaves the diagnosis out instead of inventing a baseline', () => {
  const text = devReport(false);
  assert.ok(!text.includes('request level'));
  assert.ok(!text.includes(DEV_D_FINDING));
});
