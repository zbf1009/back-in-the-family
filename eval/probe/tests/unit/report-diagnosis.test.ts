// The Report prints the request-level D baseline and the position diagnosis next to Dev_Run scores
// (llm-probe task 20.6). Synthetic cards; no real card is loaded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecisionCardFacts } from '../../src/diagnosis.ts';
import type { MetricCard } from '../../src/metrics.ts';
import type { Combination } from '../../src/phase.ts';
import { analyzeRun, buildReport, DEV_D_FINDING, INTEL_TIMEOUT_FINDING, type ReportInput } from '../../src/report.ts';
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

test('the Dev section states the position/content confound, and the note matches dev.jsonl', async () => {
  const { DEV_CONFOUND_NOTE } = await import('../../src/report.ts');
  assert.ok(devReport(false).includes(DEV_CONFOUND_NOTE));
  for (const needle of ['all 15 scored D cards', 'oversight on the card-authoring side', 'not changed', 'last 14, middle 26, first 7', 'Per the Author', 'Locked_Run results']) {
    assert.ok(DEV_CONFOUND_NOTE.includes(needle), needle);
  }
  // The dev facts the note states (dev.jsonl may be read; the locked split is not).
  const { readFileSync } = await import('node:fs');
  const { DEFAULT_CARDS_DIR } = await import('../../src/cards.ts');
  const dev = readFileSync(`${DEFAULT_CARDS_DIR}/cards/dev.jsonl`, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as { task: string; scored: boolean; options: { id: string }[]; severe: string[] });
  const withSevere = dev.filter((c) => c.task === 'decision' && c.scored && c.severe.length > 0);
  assert.equal(withSevere.length, 15);
  assert.ok(withSevere.every((c) => c.severe.length === 1 && c.options.findIndex((o) => o.id === c.severe[0]) === c.options.length - 1));
});

test('the Intel timeout finding is printed only when its Dev_Run is in the Report, and it does not claim an Intel quality figure', () => {
  assert.ok(!devReport(false).includes(INTEL_TIMEOUT_FINDING));
  for (const needle of ['all 74 D requests hit the 10 s timeout', '11,975 / 14,955 / 17,495 ms', 'no Intel quality figure', 'INVALID']) assert.ok(INTEL_TIMEOUT_FINDING.includes(needle), needle);
  assert.ok(!DEV_D_FINDING.includes('identical outputs, on the Intel iGPU'));
});
