// Render the review copy from unchanged native replay facts, never invented examples.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, type AST } from 'svelte/compiler';
import ts from 'typescript';
import * as copy from '../src/main/player-copy.ts';
import type { StoryBatch } from '../src/shared/story.ts';
import { renderTemplateCorpus } from '../src/main/journal-templates.ts';

// Only rendered text positions are inspected; scripts, conditions and machine attributes are not copy.
const textAttributes: Record<string, true> = {
  alt: true, 'aria-description': true, 'aria-label': true, 'aria-roledescription': true,
  'aria-valuetext': true, detail: true, label: true, placeholder: true, title: true,
};

function markupLiteral(expression: AST.ExpressionTag['expression'], add: (text: string) => void): void {
  switch (expression.type) {
    case 'Literal':
      if (typeof expression.value === 'string') add(expression.value);
      break;
    case 'ConditionalExpression':
      markupLiteral(expression.consequent, add);
      markupLiteral(expression.alternate, add);
      break;
    case 'LogicalExpression':
      if (expression.operator !== '&&') markupLiteral(expression.left, add);
      markupLiteral(expression.right, add);
      break;
    case 'TemplateLiteral':
      for (const part of expression.quasis) add(part.value.cooked ?? part.value.raw);
      for (const part of expression.expressions) markupLiteral(part, add);
      break;
  }
}

function svelteLabels(source: string, filename: string, add: (text: string) => void): void {
  function fragment(part: AST.Fragment | null | undefined): void {
    if (part == null) return;
    for (const node of part.nodes) {
      switch (node.type) {
        case 'Text': add(node.data); break;
        case 'ExpressionTag': markupLiteral(node.expression, add); break;
        case 'IfBlock': fragment(node.consequent); fragment(node.alternate); break;
        case 'EachBlock': fragment(node.body); fragment(node.fallback); break;
        case 'AwaitBlock': fragment(node.pending); fragment(node.then); fragment(node.catch); break;
        case 'SnippetBlock': fragment(node.body); break;
        default:
          if ('attributes' in node) {
            for (const attribute of node.attributes) {
              if (attribute.type !== 'Attribute' || textAttributes[attribute.name] !== true || attribute.value === true) continue;
              for (const value of Array.isArray(attribute.value) ? attribute.value : [attribute.value]) {
                if (value.type === 'Text') add(value.data);
                else markupLiteral(value.expression, add);
              }
            }
          }
          if ('fragment' in node) fragment(node.fragment);
      }
    }
  }
  fragment(parse(source, { filename, modern: true }).fragment);
}

function captionLiteral(expression: ts.Expression, add: (text: string) => void): void {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) add(expression.text);
  else if (ts.isParenthesizedExpression(expression)) captionLiteral(expression.expression, add);
  else if (ts.isConditionalExpression(expression)) {
    captionLiteral(expression.whenTrue, add);
    captionLiteral(expression.whenFalse, add);
  } else if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      captionLiteral(expression.left, add);
      captionLiteral(expression.right, add);
    } else if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) captionLiteral(expression.right, add);
  }
}

function keySceneLabels(source: string, filename: string, add: (text: string) => void): void {
  const captions: Record<string, true> = { title: true, label: true, note: true, footer: true, documentTitle: true };
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && captions[node.name.text] === true) {
      captionLiteral(node.initializer, add);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && captions[node.left.name.text] === true) {
      captionLiteral(node.right, add);
    }
    ts.forEachChild(node, visit);
  }
  // Do not collect value/name fields or interpolate sentence fragments into fictional records.
  visit(ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
}

async function svelteFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await svelteFiles(filename));
    else if (entry.isFile() && entry.name.endsWith('.svelte')) files.push(filename);
  }
  return files;
}

const input = process.argv[2] ?? 'target/life-unfolds/story-sample.json';
const output = process.argv[3] ?? 'target/life-unfolds/copy-review.txt';
const sample = JSON.parse(await readFile(input, 'utf8')) as {
  seed: string; ticks: string; sourceReplay: string; batches: StoryBatch[];
};
const opening = sample.batches.find(batch => batch.opening);
const focus = opening?.events.flatMap(event => event.actorContext)[0]?.relativeTo;
const actor = opening?.actors.find(actor => actor.person === focus);
if (sample.seed !== '1205' || actor === undefined) throw new Error('The actual seed-1205 opening identity is required');
const actors: Record<number, StoryBatch['actors'][number]> = {};
for (const batch of sample.batches) {
  for (const recorded of batch.actors) actors[recorded.person] = { ...actors[recorded.person], ...recorded };
}
let currentBody: number | null = actor.person;
const events = sample.batches.flatMap(batch => batch.events).sort((left, right) => {
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
});
for (const event of events) {
  const kind = event.kind;
  if (kind.type === 'death') {
    if (kind.person === currentBody) currentBody = null;
  } else if ((kind.type === 'birth' || kind.type === 'possession' || kind.type === 'rebuild')
    && actors[kind.person]?.soulId === actor.soulId) currentBody = kind.person;
}
const corpus = renderTemplateCorpus(sample.batches, { playerSoul: actor.soulId, currentBody });
const lines = [
  'LIFE UNFOLDS — COPY FOR ANNOTATION',
  `Actual source: ${sample.sourceReplay}; seed ${sample.seed}; ${sample.ticks} completed days.`,
  `Review context at the end of the actual sample: ${currentBody === null ? 'Between lives' : `current life, body ${currentBody}`}.`,
  'This is wording review, not an approval checkpoint. Missing native examples are stated, never fabricated.',
  '', 'PREMISE', copy.LANDING_PREMISE,
];
const seenLabels = new Set<string>([copy.LANDING_PREMISE]);
for (const [name, value] of Object.entries(copy)) {
  if (typeof value === 'string') {
    if (!seenLabels.has(value)) lines.push('', name, value);
    seenLabels.add(value);
    continue;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
  lines.push('', name);
  for (const [key, label] of Object.entries(value)) if (typeof label === 'string') {
    lines.push(`${key}: ${label}`);
    seenLabels.add(label);
  }
}
lines.push('', 'STATIC PRODUCTION UI COPY — REVIEW ONLY',
  'Source labels and literal branch fragments follow. They are not evidence that a branch occurred in the actual replay.',
  'Dynamic values are omitted; fragments are never joined into invented facts. Repeated labels appear only once.');
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
for (const filename of [...await svelteFiles(sourceRoot), join(sourceRoot, 'main', 'key-scene.ts')]) {
  const labels: string[] = [];
  const add = (label: string): void => {
    const text = label.replace(/\s+/gu, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(text) || seenLabels.has(text)) return;
    seenLabels.add(text);
    labels.push(text);
  };
  const source = await readFile(filename, 'utf8');
  if (filename.endsWith('.svelte')) svelteLabels(source, filename, add);
  else keySceneLabels(source, filename, add);
  if (labels.length > 0) lines.push('', `src/${relative(sourceRoot, filename)}`, ...labels);
}
lines.push('', 'JOURNAL SENTENCE FRAMES ON ACTUAL FACTS');
for (const item of corpus.events) {
  lines.push('', item.frame.id);
  if (item.text === undefined) lines.push(item.absent ?? 'No matching actual seed-1205 fact.');
  else lines.push(`Actual event ${item.eventId}, recorded day ${item.tick}:`, item.text);
}
lines.push('', 'RECORDED CHOICE FRAMES ON ACTUAL CHRONICLE');
for (const item of corpus.chronicle) {
  lines.push('', `${item.frameId} — actual Chronicle ${item.index}; ${item.source}; chooser absent ${item.chooserAbsent}`, item.text);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, lines.join('\n') + '\n');
console.log(`Wrote actual seed-1205 copy review to ${output}`);
