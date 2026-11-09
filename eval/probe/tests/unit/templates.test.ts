import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { parseCombinations } from '../../src/phase.ts';
import { llmParseCard, llmRenderPrompt } from '../../src/simwasm.ts';
import { loadTemplate, loadWarmup, templateHashes, warmupHashes } from '../../src/templates.ts';
import type { TaskType } from '../../src/cards.ts';
import { STATEMENTS } from './templates.statements.ts';

const TASKS: TaskType[] = ['decision', 'synthesis'];
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

for (const task of TASKS) {
  test(`${task} template states all five Author-steering facts`, () => {
    const { text } = loadTemplate(task);
    for (const [name, phrases] of Object.entries(STATEMENTS)) {
      for (const p of phrases) assert.ok(text.includes(p), `${task}: statement ${name} lacks phrase: ${p}`);
    }
  });

  test(`${task} template and warm-up carry no answer-key or card-meta words`, () => {
    const banned = /\b(gold|must_not_include|author_note|answer|severe|scenario_group|card_id|contrast|dev_card|locked|split|scored|family)\b/i;
    for (const { text } of [loadTemplate(task), loadWarmup(task)]) assert.doesNotMatch(text, banned);
  });

  test(`${task} hashes are sha256 of the exact file bytes`, () => {
    const file = task === 'decision' ? '../../templates/decision.v1.txt' : '../../templates/synthesis.v1.txt';
    assert.equal(templateHashes()[task], createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex'));
    assert.match(warmupHashes()[task], /^[0-9a-f]{64}$/);
  });
}

test('the renderer accepts both templates for a D and an S dev card', () => {
  const lines = readFileSync(new URL('../../../cards/cards/dev.jsonl', import.meta.url), 'utf8').split('\n').filter((l) => l !== '');
  const pick = (task: string): string => lines.find((l) => (JSON.parse(l) as { task: string }).task === task)!;
  for (const task of TASKS) {
    const parsed = JSON.parse(llmParseCard(pick(task))) as { ok: boolean; frozen_context: unknown };
    assert.equal(parsed.ok, true);
    const input = {
      frozen_context: parsed.frozen_context,
      template: loadTemplate(task).text,
      schema_text: task === 'synthesis' ? '(schema text)' : null,
      permutation: 'base',
    };
    const out = JSON.parse(llmRenderPrompt(JSON.stringify(input))) as { ok: boolean; system?: string; user?: string };
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.match(out.user ?? '', /^Today is day \d+\./);
    assert.doesNotMatch(`${out.system}${out.user}`, /\{\{/);
  }
});

test('the warm-up prompts render as literal [system]/[user] text with IDs outside the Card_Set', () => {
  for (const task of TASKS) {
    const { text } = loadWarmup(task);
    assert.match(text, /^\[system\]\n[\s\S]*\n\[user\]\n/);
    assert.doesNotMatch(text, /\{\{/);
    assert.match(text, /#901/);
  }
});

test('combinations.json parses; five locked in-browser Combinations, one Intel Dev_Run, three Workers AI candidates, two Decision_Models', () => {
  const list = parseCombinations(read('../../combinations.json'));
  assert.equal(list.length, 11);
  const intel = list.find((c) => c.id === 'webllm/qwen3.5-0.8b-q4f32/intel')!;
  const nvidia = list.find((c) => c.id === 'webllm/qwen3.5-0.8b-q4f32/nvidia')!;
  assert.equal(intel.phase1_locked, false);
  assert.equal(intel.power_preference, 'low-power');
  assert.equal(nvidia.power_preference, 'high-performance');
  // Same model pins, sampling and constraint as the NVIDIA Combination; only the id, power preference and lock flag differ.
  const rest = (c: typeof intel): unknown => ({ ...c, id: '', power_preference: '', phase1_locked: false });
  assert.deepEqual(rest(intel), rest(nvidia));
  const locked = list.filter((c) => c.phase1_locked);
  assert.deepEqual(locked.map((c) => c.runtime).sort(), ['transformers.js', 'transformers.js', 'transformers.js', 'webllm', 'webllm']);
  for (const c of locked) assert.match(c.revision, /^[0-9a-f]{40}$/);
  const wai = list.filter((c) => c.runtime === 'workers-ai' && c.response_shape !== 'system_one');
  assert.equal(wai.length, 3);
  const decisionModels = list.filter((c) => c.response_shape === 'system_one');
  assert.deepEqual(decisionModels.map((c) => c.id), ['workers-ai/clef-flash', 'workers-ai/clef']);
  for (const c of decisionModels) assert.equal(c.phase1_locked, false);
  for (const c of wai) {
    assert.equal(c.phase1_locked, false);
    assert.equal(c.revision, 'server-side, not pinnable');
    assert.ok(Number.isInteger(c.prices?.input) && Number.isInteger(c.prices?.output));
    assert.ok(c.max_output_param?.source.startsWith('https://'));
  }
  const lfm = list.find((c) => c.model_id.startsWith('LiquidAI/'))!;
  assert.deepEqual(lfm.license, { name: 'LFM Open License v1.0', osi: false, url: 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX/blob/main/LICENSE', declared_by: 'model', accepted: '2026-11-06' });
  assert.equal(list.find((c) => c.model_id === 'onnx-community/Qwen3.5-2B-ONNX')!.license?.declared_by, 'base_model');
});
