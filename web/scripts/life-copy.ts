// Render the review copy from unchanged native replay facts, never invented examples.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as copy from '../src/main/player-copy.ts';
import type { StoryBatch } from '../src/shared/story.ts';
import { renderTemplateCorpus } from '../src/main/journal-templates.ts';

const input = process.argv[2] ?? 'target/life-unfolds/story-sample.json';
const output = process.argv[3] ?? 'target/life-unfolds/copy-review.txt';
const sample = JSON.parse(await readFile(input, 'utf8')) as {
  seed: string; ticks: string; sourceReplay: string; batches: StoryBatch[];
};
const opening = sample.batches.find(batch => batch.opening);
const focus = opening?.events.flatMap(event => event.actorContext)[0]?.relativeTo;
const actor = opening?.actors.find(actor => actor.person === focus);
if (sample.seed !== '1205' || actor === undefined) throw new Error('The actual seed-1205 opening identity is required');
const corpus = renderTemplateCorpus(sample.batches, { playerSoul: actor.soulId, currentBody: actor.person });
const lines = [
  'LIFE UNFOLDS — COPY FOR ANNOTATION',
  `Actual source: ${sample.sourceReplay}; seed ${sample.seed}; ${sample.ticks} completed days.`,
  'This is wording review, not an approval checkpoint. Missing native examples are stated, never fabricated.',
  '', 'PREMISE', copy.LANDING_PREMISE,
];
for (const [name, value] of Object.entries(copy)) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
  lines.push('', name);
  for (const [key, label] of Object.entries(value)) if (typeof label === 'string') lines.push(`${key}: ${label}`);
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
