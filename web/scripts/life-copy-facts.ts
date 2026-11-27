import type { StoryActor, StoryBatch, StoryChronicle, StoryEvent, StoryIdentity, DreamFact } from '../src/shared/story.ts';
import type { WorldSnapshot } from '../src/shared/world-snapshot.ts';
import { appendStory, createNotebook, entryContext, journalGroupCount, journalRange, JOURNAL_RANGE_SIZE, type LifeNotebook } from '../src/main/life-journal.ts';
import { renderStoryChronicle, renderStoryEvent, type JournalContext } from '../src/main/journal-templates.ts';
import { lifecycleKeyScene, type KeySceneView } from '../src/main/key-scene.ts';
import { dateLabel, formatAmount } from '../src/main/calendar.ts';
import { TECHNICAL_TEXT, supportedText } from '../src/main/technical-text.ts';

export interface StorySample {
  seed: string;
  ticks: string;
  sourceReplay: string;
  batches: StoryBatch[];
}
export interface NativeArtSample {
  source: { seed: string; replay: string; replaySha256: string; wasmSha256: string; completedTicks: string; checksum: string; facts: string; factsSha256: string; mode: string };
  facts: { actors: StoryActor[]; death: StoryEvent };
  world: WorldSnapshot;
}
export const OBSERVATION_KINDS = [
  'opening', 'life-heading', 'lifecycle', 'memorial', 'memorial-share', 'named-buttons',
  'recovery-running', 'recovery-paused', 'bureau-hold-dream', 'bureau-hold-bribe',
] as const;
export type ObservationKind = typeof OBSERVATION_KINDS[number];
export interface BrowserCopyObservations {
  seed: '1205';
  observations: { kind: ObservationKind; source: string; provenance: string; text: string }[];
}
export function readObservations(value: unknown): BrowserCopyObservations {
  if (typeof value !== 'object' || value === null || !('seed' in value) || value.seed !== '1205'
    || !('observations' in value) || !Array.isArray(value.observations)) throw new Error('Browser copy observations require seed 1205 and an observations array');
  for (const observation of value.observations) {
    if (typeof observation !== 'object' || observation === null || !OBSERVATION_KINDS.includes(observation.kind)
      || !['source', 'provenance', 'text'].every(key => typeof observation[key] === 'string' && observation[key].trim().length > 0)) {
      throw new Error('Every browser observation requires a supported kind, source, provenance and unedited rendered text');
    }
  }
  return value as BrowserCopyObservations;
}
export function sampleIdentity(sample: StorySample): StoryActor {
  const opening = sample.batches.find(batch => batch.opening);
  const focuses = new Set(opening?.events.flatMap(event => event.actorContext.map(context => context.relativeTo)));
  const actor = opening?.actors.find(candidate => focuses.has(candidate.person));
  if (sample.seed !== '1205' || focuses.size !== 1 || actor === undefined) throw new Error('The unchanged seed-1205 opening identity is required');
  return actor;
}
export function sampleNotebook(sample: StorySample, openingWorld?: WorldSnapshot): LifeNotebook {
  const actor = sampleIdentity(sample);
  if (openingWorld !== undefined && (openingWorld.player_soul !== actor.soulId || openingWorld.player.body !== actor.person
    || openingWorld.tick !== sample.batches.find(batch => batch.opening)?.events[0]?.tick)) throw new Error('The supplied opening World does not match the actual opening identity/day');
  // Admit original native deliveries in their original order. Phase/name/kin roots belong to appendStory.
  let notebook = createNotebook(0);
  for (const batch of sample.batches) notebook = appendStory(notebook, [{ worldId: 0, batch }], batch.opening && openingWorld !== undefined ? { world: openingWorld } : {});
  return notebook;
}
function exactDreams(notebook: LifeNotebook, supplemental: Readonly<Record<string, DreamFact>>): ReadonlyMap<string, DreamFact> {
  const dreams = new Map(notebook.dreams);
  for (const fact of Object.values(supplemental)) {
    const event = notebook.events.get(fact.eventId);
    if (event?.kind.type === 'dream' && event.tick === fact.tick && event.kind.ghost === fact.ghost
      && event.kind.dreamer === fact.dreamer && event.kind.price === fact.price && !dreams.has(fact.eventId)) dreams.set(fact.eventId, fact);
  }
  return dreams;
}
export function factualCopy(sample: StorySample, supplementalDreams: Readonly<Record<string, DreamFact>> = {}, openingWorld?: WorldSnapshot): { notebook: LifeNotebook; lines: string[] } {
  let notebook = sampleNotebook(sample, openingWorld);
  const dreams = exactDreams(notebook, supplementalDreams);
  let annotations = notebook.dreams;
  for (const [eventId, fact] of dreams) if (!annotations.get(eventId)) annotations = annotations.set(eventId, fact);
  // Read-only exact native annotations also feed the production grouped renderer.
  if (annotations !== notebook.dreams) notebook = { ...notebook, dreams: annotations };
  const lines: string[] = [];
  for (const identity of notebook.identities) {
    const captured = entryContext(notebook, identity);
    if (captured === null) throw new Error(`No admitted entry-local context for ${identity}; do not substitute the final World`);
    const context: JournalContext = { playerSoul: captured.playerSoul, currentBody: captured.focus, formerBodies: captured.formerBodies, dreams, actorContext: captured.actorContext };
    const record = identity.startsWith('e:') ? notebook.events.get(identity.slice(2))! : notebook.chronicle.get(identity.slice(2))!;
    const text = identity.startsWith('e:') ? renderStoryEvent(record as StoryEvent, captured.actors, context)
      : renderStoryChronicle(record as StoryChronicle, captured.actors, context);
    lines.push('', `${identity}; day ${record.tick}; ${notebook.opening.get(identity) ? 'opening history' : 'observed history'}; phase ${captured.phase.key}; focus ${captured.focus}`,
      ...(identity.startsWith('c:') ? [`Source ${(record as StoryChronicle).source}; admitted node ${(record as StoryChronicle).node ?? 'none'}; chooser absent ${(record as StoryChronicle).chooserAbsent}`] : []),
      text || '[No supported complete sentence is rendered for this fact.]');
  }
  return { notebook, lines };
}
export function groupedCopy(notebook: LifeNotebook): string[] {
  const lines: string[] = [];
  const first = notebook.identities.at(0);
  const captured = first === undefined ? null : entryContext(notebook, first as StoryIdentity);
  if (captured === null) throw new Error('The opening entry-local context is required for notebook rendering');
  const fallback = { playerSoul: captured.playerSoul, currentBody: captured.focus };
  for (const section of ['life', 'town'] as const) {
    lines.push('', section === 'life' ? TECHNICAL_TEXT.journalLife : TECHNICAL_TEXT.journalTown);
    const count = journalGroupCount(notebook, section);
    let previousPhase: string | null = null;
    for (let start = 0; start < count; start += JOURNAL_RANGE_SIZE) {
      const end = Math.min(count, start + JOURNAL_RANGE_SIZE);
      // The first partial page begins at zero; subsequent pages are full-size production ranges.
      const groups = journalRange(notebook, fallback, section, end);
      for (const group of groups.slice(Math.max(0, groups.length - (end - start)))) {
        if (section === 'life' && group.phase !== null && group.phase.key !== previousPhase) {
          const heading = group.phase.kind === 'waiting' ? TECHNICAL_TEXT.waiting
            : supportedText(TECHNICAL_TEXT.life, { 'Full Name': group.phase.name ?? undefined });
          if (heading !== null) lines.push('', heading);
          previousPhase = group.phase.key;
        }
        lines.push('', `${group.id}; days ${group.from}–${group.to}; ${group.count} member(s)`,
          ...(group.opening ? [TECHNICAL_TEXT.journalBefore] : []), group.text);
      }
    }
  }
  return lines;
}
export function openingIdentityCopy(sample: StorySample): string[] {
  const actor = sampleIdentity(sample);
  const opening = sample.batches.find(batch => batch.opening)!;
  const day = opening.events[0]?.tick;
  if (day === undefined) throw new Error('The native opening day is required');
  const elapsed = actor.birthDay === undefined ? null : BigInt(day) - BigInt(actor.birthDay);
  const age = elapsed === null || elapsed < 0n ? undefined : formatAmount((elapsed / 365n).toString());
  const template = actor.origin === 'native' ? TECHNICAL_TEXT.openingNative
    : actor.origin === 'possessed' ? TECHNICAL_TEXT.openingBorrowed : actor.origin === 'rebuilt' ? TECHNICAL_TEXT.openingRebuilt : null;
  const line = template === null ? null : supportedText(template, { 'Full Name': actor.name, n: age });
  return [`Recorded opening actor ${actor.person}; soul ${actor.soulId}; birth day ${actor.birthDay}; opening day ${day}.`,
    'Identity sentence only, rendered from opening facts; this is not a full browser opening-card capture.',
    TECHNICAL_TEXT.openingHeading, dateLabel(day), ...(line === null ? [] : [line]), TECHNICAL_TEXT.openingFooter];
}
export function nativeDeathScene(sample: NativeArtSample): KeySceneView {
  const { death, actors } = sample.facts;
  const kind = death.kind;
  const deceased = kind.type === 'death' ? actors.find(actor => actor.person === kind.person) : undefined;
  if (sample.source.seed !== '1205' || kind.type !== 'death' || deceased === undefined || deceased.soulId !== sample.world.player_soul
    || sample.world.tick !== sample.source.completedTicks || BigInt(sample.world.tick) !== BigInt(death.tick) + 1n
    || !sample.world.player.earlier_bodies.some(body => body.id === deceased.person && body.death === death.tick)) {
    throw new Error('The preserved native art snapshot must contain the exact seed-1205 player Death');
  }
  return lifecycleKeyScene(0, sample.world, { event: death.id, tick: death.tick, kind: 'death', body: deceased.person,
    name: deceased.name, origin: deceased.origin === 'possessed' || deceased.origin === 'rebuilt' ? deceased.origin : 'native' },
  new Map(actors.map(actor => [actor.person, actor])), [death]);
}
export function sceneCopy(view: KeySceneView): string[] {
  return [view.title, dateLabel(view.date), ...view.lines, view.document.title,
    ...(view.document.name === undefined ? [] : [view.document.name]),
    ...view.document.fields.map(field => `${field.label}: ${field.value}`),
    ...(view.document.note === undefined ? [] : [view.document.note])];
}
