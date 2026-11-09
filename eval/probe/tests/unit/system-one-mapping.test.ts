// Task 30.2 (Property 41, real-file part): every decision.system_one.v*.txt keeps the five Author template rules in
// [instructions] + the "Today is day {{tick}}." line, and its Template_Hash is the sha256 of the file bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_CARDS_DIR } from '../../src/cards.ts';
import { llmParseCard, llmRenderSystemOne } from '../../src/simwasm.ts';
import { TEMPLATES_DIR, loadSystemOneMapping, loadTemplate } from '../../src/templates.ts';
import { STATEMENTS } from './templates.statements.ts';

const REPO = new URL('../../../../', import.meta.url).pathname;
const files = readdirSync(TEMPLATES_DIR).filter((n) => /^decision\.system_one\.v\d+\.txt$/.test(n)).sort();

/** The body of a `[name]` section, without the trailing line break. */
function section(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`[${name}]`);
  assert.ok(start >= 0, `section [${name}] is missing`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\[(meta|instructions|state|criteria)\]$/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').replace(/\n+$/, '');
}

test('at least one decision.system_one.v*.txt exists', () => assert.ok(files.length >= 1));

for (const file of files) {
  const text = readFileSync(`${TEMPLATES_DIR}${file}`, 'utf8');
  test(`${file}: [instructions] and the Today line state all five Author-steering facts`, () => {
    const checked = `${section(text, 'instructions')}\n${section(text, 'state').split('\n')[0]}`;
    for (const [name, phrases] of Object.entries(STATEMENTS)) {
      for (const p of phrases) assert.ok(checked.includes(p), `${file}: statement ${name} lacks phrase: ${p}`);
    }
  });

  test(`${file}: Template_Hash is the sha256 of the exact file bytes`, () => {
    const mapping = loadSystemOneMapping(REPO, `eval/probe/templates/${file}`);
    assert.equal(mapping.sha256, createHash('sha256').update(readFileSync(`${TEMPLATES_DIR}${file}`)).digest('hex'));
  });

  test(`${file}: carries no {{options}} or unknown placeholder, and renders a real D Dev_Card`, () => {
    const line = readFileSync(`${DEFAULT_CARDS_DIR}/cards/dev.jsonl`, 'utf8').split('\n').find((l) => l !== '' && (JSON.parse(l) as { task: string }).task === 'decision')!;
    const parsed = JSON.parse(llmParseCard(line)) as { ok: boolean; frozen_context: unknown };
    const out = JSON.parse(llmRenderSystemOne(JSON.stringify({ frozen_context: parsed.frozen_context, mapping: text, permutation: 'base' }))) as { ok: boolean; state: string; instructions: string; question_id: string };
    // The renderer rejects an unknown placeholder, {{options}} included, with an error that names it.
    assert.equal(out.ok, true, `render error: ${JSON.stringify(out)}`);
    assert.doesNotMatch(section(text, 'instructions'), /\{\{/);
    assert.doesNotMatch(text, /\{\{options\}\}/);
    assert.match(out.state, /^Today is day \d+\./);
    assert.doesNotMatch(out.state, /\{\{/);
    assert.equal(out.question_id, 'decision');
    assert.equal(out.instructions, section(text, 'instructions'));
  });
}

test('decision.system_one.v1.txt: [instructions] is the two named sections of decision.v1.txt, byte for byte', () => {
  const mapping = readFileSync(`${TEMPLATES_DIR}decision.system_one.v1.txt`, 'utf8');
  const system = loadTemplate('decision').text;
  const from = system.indexOf('How to read the facts:');
  const to = system.indexOf('How to reply:');
  assert.ok(from >= 0 && to > from);
  assert.equal(section(mapping, 'instructions'), system.slice(from, to).replace(/\n+$/, ''));
});
