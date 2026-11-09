// TS-side grading parity (llm-probe task 6.4; requirements 6.2, 6.4).
// Mirrors crates/sim-wasm/tests/llm_parity.rs: every case of fixtures/grading/dev-golden.json,
// run through the simwasm.ts wrappers, must return the golden bytes. Inputs are rebuilt from
// the golden header as fixtures/grading/README.md describes. Only Dev_Cards are read; the
// fixtures are never written. This file builds inputs and compares strings: no grading logic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  llmAggregatePermAvg,
  llmContrast,
  llmGrade,
  llmIdentity,
  llmParseCard,
  llmPermutations,
  llmRenderPrompt,
  llmRenderSystemOne,
  llmValidate,
} from '../../src/simwasm.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const root = new URL('../../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const CARDS = read('eval/cards/cards/dev.jsonl');
const outputs = JSON.parse(read('fixtures/grading/dev-outputs.json')) as {
  cards: { card: string; outputs: Obj[] }[];
};
const golden = JSON.parse(read('fixtures/grading/dev-golden.json')) as {
  templates: { decision: string; synthesis: string };
  schema_text: string;
  cards: {
    card: string;
    parse_card: string;
    permutations: string;
    render_prompt: { permutation: Json; result: string }[];
    outputs: { output: string; validate: string; grade: string; identity: string }[];
  }[];
  contrast: {
    card_a: string;
    card_b: string;
    output_a: string;
    output_b: string;
    result: string;
  }[];
};

/** Compares one export result with its golden string; the message names card and export. */
function check(card: string, exp: string, detail: string, actual: string, expected: string): void {
  assert.equal(
    actual,
    expected,
    `card ${card}: export ${exp} (${detail}) differs from golden`,
  );
}

function ok(card: string, exp: string, text: string): Obj {
  const v = JSON.parse(text) as Obj;
  assert.equal(v.ok, true, `card ${card}: export ${exp} did not return ok:true`);
  return v;
}

test('every dev-golden.json case matches through simwasm.ts', () => {
  const lines = new Map<string, string>();
  for (const line of CARDS.split('\n').filter((l) => l.trim() !== '')) {
    const meta = ok('?', 'llm_parse_card', llmParseCard(line)).meta as Obj;
    lines.set(meta.id as string, line);
  }
  const sources = new Map<string, Obj>();
  for (const entry of outputs.cards) {
    for (const o of entry.outputs) sources.set(`${entry.card}\n${o.label as string}`, o);
  }
  assert.equal(golden.cards.length, lines.size, 'golden and dev.jsonl card counts');

  const verdicts = new Map<string, Json>();
  let checks = 0;

  for (const entry of golden.cards) {
    const id = entry.card;
    const line = lines.get(id);
    assert.ok(line !== undefined, `card ${id}: in the golden file but not in dev.jsonl`);

    const parsedText = llmParseCard(line, id);
    check(id, 'llm_parse_card', '', parsedText, entry.parse_card);
    const ctx = (JSON.parse(parsedText) as Obj).frozen_context as Json;

    check(
      id,
      'llm_permutations',
      '',
      llmPermutations(JSON.stringify({ frozen_context: ctx }), id),
      entry.permutations,
    );

    const isDecision = (JSON.parse(line) as Obj).task === 'decision';
    const template = isDecision ? golden.templates.decision : golden.templates.synthesis;
    const schema = isDecision ? null : golden.schema_text;
    for (const r of entry.render_prompt) {
      const input = JSON.stringify({
        frozen_context: ctx,
        template,
        schema_text: schema,
        permutation: r.permutation,
      });
      check(
        id,
        'llm_render_prompt',
        `permutation ${JSON.stringify(r.permutation)}`,
        llmRenderPrompt(input, id),
        r.result,
      );
      checks++;
    }

    for (const o of entry.outputs) {
      const src = sources.get(`${id}\n${o.output}`);
      assert.ok(src !== undefined, `card ${id}: golden output ${o.output} missing from dev-outputs.json`);
      const vin: Obj = { frozen_context: ctx };
      if (src.raw !== undefined) vin.raw = src.raw;
      else if (src.outcome !== undefined) vin.outcome = src.outcome;
      else assert.fail(`card ${id}: output ${o.output} needs raw or outcome`);

      const validated = llmValidate(JSON.stringify(vin), 'json', id);
      check(id, 'llm_validate', o.output, validated, o.validate);

      const verdict = ok(id, 'llm_validate', validated).verdict as Json;
      const gin = JSON.stringify({ card: line, verdict });
      check(id, 'llm_grade', o.output, llmGrade(gin, id), o.grade);
      check(id, 'llm_identity', o.output, llmIdentity(gin, id), o.identity);
      verdicts.set(`${id}\n${o.output}`, verdict);
      checks += 3;
    }
  }

  for (const c of golden.contrast) {
    const la = lines.get(c.card_a);
    const lb = lines.get(c.card_b);
    assert.ok(la !== undefined && lb !== undefined, `contrast ${c.card_a}/${c.card_b}: card missing from dev.jsonl`);
    const va = verdicts.get(`${c.card_a}\n${c.output_a}`);
    const vb = verdicts.get(`${c.card_b}\n${c.output_b}`);
    assert.ok(va !== undefined && vb !== undefined, `contrast ${c.card_a}/${c.card_b}: verdict missing`);
    const input = JSON.stringify({ card_a: la, verdict_a: va, card_b: lb, verdict_b: vb });
    check(
      `${c.card_a} + ${c.card_b}`,
      'llm_contrast',
      `${c.output_a} / ${c.output_b}`,
      llmContrast(input, c.card_a),
      c.result,
    );
    checks++;
  }
  assert.ok(checks > 0, 'no golden entries were checked');
});

test('every system-one-golden.json case matches through simwasm.ts (raw_choice mode and llm_render_system_one)', () => {
  const sys = JSON.parse(read('fixtures/grading/system-one-golden.json')) as {
    mapping: string;
    cards: {
      card: string;
      raw_choice: { label: string; raw: string; result: string }[];
      render_system_one: { permutation: string; result: string }[];
    }[];
  };
  const lines = new Map<string, string>();
  for (const line of CARDS.split('\n').filter((l) => l.trim() !== '')) {
    const meta = ok('?', 'llm_parse_card', llmParseCard(line)).meta as Obj;
    lines.set(meta.id as string, line);
  }
  assert.equal(sys.cards.length, lines.size, 'golden and dev.jsonl card counts');
  let checks = 0;
  for (const entry of sys.cards) {
    const line = lines.get(entry.card);
    assert.ok(line !== undefined, `card ${entry.card}: in the golden file but not in dev.jsonl`);
    const ctx = ok(entry.card, 'llm_parse_card', llmParseCard(line, entry.card)).frozen_context as Json;
    for (const r of entry.raw_choice) {
      const input = JSON.stringify({ frozen_context: ctx, raw: r.raw });
      check(entry.card, 'llm_validate', `raw_choice ${r.label}`, llmValidate(input, 'raw_choice', entry.card), r.result);
      checks++;
    }
    for (const r of entry.render_system_one) {
      const input = JSON.stringify({ frozen_context: ctx, mapping: sys.mapping, permutation: r.permutation });
      check(entry.card, 'llm_render_system_one', `permutation ${r.permutation}`, llmRenderSystemOne(input, entry.card), r.result);
      checks++;
    }
  }
  assert.ok(checks > 0, 'no system-one golden entries were checked');
});

test('every perm-avg-golden.json case matches through simwasm.ts (llm_aggregate_perm_avg)', () => {
  type Case = { label: string; scope: string; question_id: string; calls: Json[] };
  const inputs = JSON.parse(read('fixtures/grading/perm-avg-inputs.json')) as {
    cards: { card: string; frozen_context: Json; cases: Case[] }[];
  };
  const golden = JSON.parse(read('fixtures/grading/perm-avg-golden.json')) as {
    cards: { card: string; cases: { label: string; result: string }[] }[];
  };
  assert.equal(inputs.cards.length, golden.cards.length, 'inputs and golden card counts');
  let checks = 0;
  inputs.cards.forEach((entry, i) => {
    const expected = golden.cards[i];
    assert.ok(expected !== undefined && expected.card === entry.card, `card order at ${entry.card}`);
    assert.equal(expected.cases.length, entry.cases.length, `card ${entry.card}: case counts`);
    entry.cases.forEach((c, k) => {
      const want = expected.cases[k];
      assert.ok(want !== undefined && want.label === c.label, `card ${entry.card}: case order at ${c.label}`);
      const input = JSON.stringify({ frozen_context: entry.frozen_context, scope: c.scope, question_id: c.question_id, calls: c.calls });
      check(entry.card, 'llm_aggregate_perm_avg', c.label, llmAggregatePermAvg(input, entry.card), want.result);
      checks++;
    });
  });
  assert.ok(checks > 0, 'no perm_avg golden entries were checked');
});
