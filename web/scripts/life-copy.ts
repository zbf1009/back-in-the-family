// Render the review copy from unchanged native replay facts, never invented examples.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, type AST } from 'svelte/compiler';
import ts from 'typescript';
import * as copy from '../src/main/player-copy.ts';
import * as technicalCopy from '../src/main/technical-text.ts';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { WorldSnapshot } from '../src/shared/world-snapshot.ts';
import { currentLifePhase, entryContext, type LifeNotebookExport } from '../src/main/life-journal.ts';
import { factualCopy, groupedCopy, nativeDeathScene, openingIdentityCopy, readObservations, sceneCopy, OBSERVATION_KINDS,
  type NativeArtSample, type StorySample } from './life-copy-facts.ts';
import { captureMemorial, enrichMemorial, memorialKeyScene } from '../src/main/memorial.ts';

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

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  integrated: { type: 'boolean' }, observed: { type: 'string' }, 'opening-world': { type: 'string' },
} });
if (values.integrated !== true) throw new Error('Generate only after the parent hands off completed shared copy/phase integration; pass --integrated at that handoff');
const repository = fileURLToPath(new URL('../../', import.meta.url));
const input = resolve(repository, positionals[0] ?? 'target/life-unfolds/story-sample-complete.json');
const output = resolve(repository, positionals[1] ?? 'target/life-unfolds/copy-review-lu-p1.txt');
if (output !== join(repository, 'target/life-unfolds/copy-review-lu-p1.txt')) throw new Error('Preserve the old review/evidence; the only output target is copy-review-lu-p1.txt');
const artInput = join(repository, 'web/tests/fixtures/art-sample-seed1205.json');
const factsInput = join(repository, 'target/life-unfolds/default-play-facts.json');
const memorialInput = join(repository, 'target/life-unfolds/lu-p1-memorial.world.json');
const memorialProvenanceInput = join(repository, 'target/life-unfolds/lu-p1-memorial.provenance.json');
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const [sampleBytes, artBytes, factsBytes, memorialBytes, memorialProvenanceBytes] = await Promise.all([
  readFile(input, 'utf8'), readFile(artInput, 'utf8'), readFile(factsInput, 'utf8'),
  readFile(memorialInput, 'utf8'), readFile(memorialProvenanceInput, 'utf8'),
]);
const sample = JSON.parse(sampleBytes) as StorySample;
const artSample = JSON.parse(artBytes) as NativeArtSample;
const nativeFacts = JSON.parse(factsBytes) as LifeNotebookExport;
if (hash(factsBytes) !== artSample.source.factsSha256) throw new Error('The native default-play facts no longer match the preserved art-sample provenance');
const openingInput = values['opening-world'] === undefined ? undefined : resolve(repository, values['opening-world']);
const openingBytes = openingInput === undefined ? undefined : await readFile(openingInput, 'utf8');
const openingWorld = openingBytes === undefined ? undefined : JSON.parse(openingBytes) as WorldSnapshot;
const observed = values.observed === undefined ? { seed: '1205' as const, observations: [] }
  : readObservations(JSON.parse(await readFile(resolve(repository, values.observed), 'utf8')));
const factual = factualCopy(sample, nativeFacts.dreams, openingWorld);
const deathView = nativeDeathScene(artSample);
const memorialWorld = JSON.parse(memorialBytes) as WorldSnapshot;
const memorialProvenance = JSON.parse(memorialProvenanceBytes) as {
  mode: string; seed: string; tick: string; checksum: string; recordedChecksum: string;
  sourceReplay: string; sourceReplaySHA256: string; wasmSHA256: string;
};
if (memorialProvenance.seed !== sample.seed || memorialProvenance.tick !== memorialWorld.tick
  || memorialProvenance.checksum !== memorialProvenance.recordedChecksum
  || memorialProvenance.sourceReplaySHA256 !== artSample.source.replaySha256
  || memorialProvenance.wasmSHA256 !== artSample.source.wasmSha256) throw new Error('The memorial World must retain its actual recorded native-prefix provenance');
const memorialEvent = factual.notebook.events.get('1998');
if (memorialEvent === undefined) throw new Error('Actual Clifford Death Event 1998 is required for the native memorial');
const memorialContext = entryContext(factual.notebook, `e:${memorialEvent.id}`);
const memorialCapture = captureMemorial({ worldId: factual.notebook.worldId, world: memorialWorld, event: memorialEvent,
  context: memorialContext, currentPhase: currentLifePhase(factual.notebook, memorialWorld), opening: false });
if (memorialCapture === null) throw new Error('Actual event-local context and native memorial World must admit the Clifford memorial');
const sameDayEvents = Object.values(nativeFacts.events).filter(event => event.tick === memorialEvent.tick);
const memorial = enrichMemorial(memorialCapture, factual.notebook.worldId, sameDayEvents);
if (memorial.estate === undefined) throw new Error('The exact same-day Death-caused player-heir estate fact is required for this native memorial');
const memorialView = memorialKeyScene(memorial);
const lines = [
  'LIFE UNFOLDS — MECHANICAL IMPLEMENTED-COPY EXPORT',
  'For Author/Spec review, not an editorial draft or approval checkpoint. Rendered sentences are not rewritten.',
  `Actual story: ${relative(repository, input)}; SHA256 ${hash(sampleBytes)}; replay ${sample.sourceReplay}; seed ${sample.seed}; ${sample.ticks} completed days.`,
  'Each Event/Chronicle uses its admitted entryContext phase, body, actor root and native actorContext. No final World is used to relabel history.',
  'Only the production-selected sentence is rendered for each EventId/Chronicle index; alternative dictionary/frame literals are not claimed as observed events.',
  `Supplemental exact Dream facts: ${relative(repository, factsInput)}; SHA256 ${hash(factsBytes)}. Annotation joins require matching EventId, day, ghost, recipient and postage.`,
  `Native certificate: ${relative(repository, artInput)}; SHA256 ${hash(artBytes)}; replay ${artSample.source.replay}; replay SHA256 ${artSample.source.replaySha256}; WASM SHA256 ${artSample.source.wasmSha256}; completed tick ${artSample.source.completedTicks}; checksum ${artSample.source.checksum}.`,
  artSample.source.mode,
  '', 'OPENING IDENTITY ON RECORDED OPENING FACTS', ...openingIdentityCopy(sample),
  '', 'NATIVE PLAYER DEATH / SHARED PRODUCTION SCENE COPY',
  `Death ${artSample.facts.death.id}; event day ${artSample.facts.death.tick}; deceased ${artSample.facts.death.kind.type === 'death' ? artSample.facts.death.kind.person : 'unavailable'}.`,
  'Current production sample browser screenshot: target/life-unfolds/lu-p1-art-expanded.webp.',
  'The certificate name/date/native age and full lines below are mechanically rendered by the shared production lifecycle text. Screenshots are sample-render evidence, not proof of ordinary recovery/hold states.',
  ...sceneCopy(deathView),
  technicalCopy.TECHNICAL_TEXT.showAll, technicalCopy.TECHNICAL_TEXT.skip, technicalCopy.TECHNICAL_TEXT.close,
  'Other full lifecycle cards: unavailable without their preserved event-local World or actual browser text; their actual Event sentences remain below.',
  '', 'NATIVE FACTUAL MEMORIAL / EXACT ESTATE RENDER — NOT BROWSER INPUT PROOF',
  `World ${relative(repository, memorialInput)}; SHA256 ${hash(memorialBytes)}; native tick ${memorialWorld.tick}.`,
  `Provenance ${relative(repository, memorialProvenanceInput)}; SHA256 ${hash(memorialProvenanceBytes)}; replay ${memorialProvenance.sourceReplay}; recorded-prefix checksum ${memorialProvenance.checksum}.`,
  memorialProvenance.mode,
  `Death e:${memorial.eventId}; day ${memorial.date}; deceased ${memorial.deceased}; event-local phase ${memorial.phaseKey}; player heir ${memorial.heir}; exact linked estate e:${memorial.estate.eventId}; estate value ${memorial.estate.amount}.`,
  'Production captureMemorial → enrichMemorial → memorialKeyScene rendering on the actual event-local World and frozen entry context. This is not a browser scene-admission, control-action or transport proof.',
  ...sceneCopy(memorialView),
  '', 'ACTUAL EVENT / CHRONICLE SENTENCES WITH FROZEN ENTRY CONTEXT', ...factual.lines,
  '', 'PRODUCTION NOTEBOOK GROUPS AND FROZEN LIFE HEADINGS', ...groupedCopy(factual.notebook),
  '', 'ACTUAL CURRENT-BROWSER TEXT — ONLY SUPPLIED OBSERVATIONS',
];
if (openingInput !== undefined && openingBytes !== undefined) lines.push(`Native opening World input: ${relative(repository, openingInput)}; SHA256 ${hash(openingBytes)}; bound only to the actual opening delivery.`);
if (values.observed !== undefined) lines.push(`Observation input: ${values.observed}. Text is copied without normalization or sentence rewriting.`);
for (const observation of observed.observations) lines.push('', observation.kind, `Source: ${observation.source}`, `Provenance: ${observation.provenance}`, observation.text);
lines.push('', 'UNAVAILABLE SEED-1205 BROWSER STATE EXAMPLES',
  'A recorded event or a static implemented label is not evidence that its transient UI state was observed. No controlled values, invented World, dictionary-only interpolation or UI mutation supplies a missing example.');
for (const kind of OBSERVATION_KINDS) if (kind !== 'lifecycle' && !observed.observations.some(observation => observation.kind === kind)) {
  lines.push(kind === 'memorial' || kind === 'memorial-share'
    ? `${kind}: native factual rendering supplied above; actual browser DOM/input proof not supplied.`
    : `${kind}: unavailable — no corresponding actual seed-1205 browser text/provenance supplied.`);
}
lines.push('', 'ABSENT NATIVE EVENT KINDS');
const eventKinds = new Set<string>([...factual.notebook.events.values()].map(event => event.kind.type));
for (const kind of ['birth', 'death', 'marriage', 'loan', 'repayment', 'debt_transfer', 'debt_forgiven', 'inheritance', 'possession', 'rebuild', 'offering', 'bribe_offering', 'dream', 'haunting', 'appeal', 'social']) {
  if (!eventKinds.has(kind)) lines.push(`${kind}: unavailable — no matching actual seed-1205 Event.`);
}
lines.push('', 'STATIC IMPLEMENTED LABEL / TEMPLATE INVENTORY — NOT OBSERVED RENDER EVIDENCE',
  'The following source strings and literal fragments are separately qualified inventory only. They do not demonstrate a transient state or fill an unavailable factual rendering.',
  'Unresolved placeholders remain unfilled. Dynamic fragments are never joined into invented facts.');
const seenLabels = new Set<string>();
function inventory(name: string, value: unknown): void {
  if (typeof value === 'string') {
    if (!seenLabels.has(value)) lines.push('', name, value);
    seenLabels.add(value);
  } else if (Array.isArray(value)) value.forEach((item, index) => inventory(`${name}[${index}]`, item));
  else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) inventory(`${name}.${key}`, item);
}
for (const [module, exports] of [['player-copy', copy], ['technical-text', technicalCopy]] as const) {
  for (const [name, value] of Object.entries(exports)) inventory(`${module}.${name}`, value);
}
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
await mkdir(dirname(output), { recursive: true });
await writeFile(output, lines.join('\n') + '\n');
console.log(`Wrote actual seed-1205 implemented copy to ${relative(repository, output)}`);
