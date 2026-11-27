import type { ActorContext, StoryEvent } from '../shared/story.ts';
import type { PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
import type { EntryContext, LifePhase } from './life-context.ts';
import type { KeySceneView, PicturePerson } from './key-scene.ts';
import { resolveVisualKey } from '../art/sprites.ts';
import type { SceneEntry } from './scene-queue.ts';
import { kinshipNoun, nameLabel } from './player-copy.ts';
import { dateLabel, formatAmount, formatMoney } from './calendar.ts';
import { TECHNICAL_TEXT, supportedText } from './technical-text.ts';

export interface MemorialCapture {
  readonly worldId: number;
  readonly eventId: string;
  readonly date: string;
  readonly deceased: number;
  readonly name: string | null;
  readonly nativeAge: string | null;
  readonly kinRole: 'spouse' | 'parent' | 'child' | 'sibling';
  readonly sex: 'female' | 'male' | undefined;
  readonly firstName: string | null;
  readonly playerBody: number;
  readonly heir: number;
  readonly phaseKey: string;
  readonly identity: readonly [number, string];
  readonly world: WorldSnapshot;
  readonly people: PicturePerson[];
  readonly estate?: { readonly eventId: string; readonly amount: string };
}

/** Death-day start is the preferred recorded basis; no latest-World relationship is inferred. */
function observedContext(context: EntryContext): ActorContext | undefined {
  const matching = context.actorContext.filter(candidate => candidate.relativeTo === context.focus);
  return matching.find(candidate => candidate.basis === 'observed-day-start')
    ?? matching.find(candidate => candidate.basis === 'observed-day-end');
}

export function captureMemorial(input: { worldId: number; world: WorldSnapshot; event: StoryEvent;
  context: EntryContext | null; currentPhase: LifePhase | null; opening: boolean }): MemorialCapture | null {
  const { worldId, world, event, context, currentPhase, opening } = input;
  if (opening || event.relevanceBasis === 'opening-current' || event.kind.type !== 'death' || context === null
    || context.phase.kind !== 'life' || currentPhase?.kind !== 'life' || currentPhase.worldId !== worldId
    || context.phase.worldId !== worldId || context.phase.key !== currentPhase.key
    || context.focus !== context.phase.person || context.focus !== currentPhase.person
    || context.playerSoul !== world.player_soul || event.kind.person === context.focus) return null;
  const deceased = event.kind.person;
  const role = observedContext(context)?.actors.find(actor => actor.person === deceased)?.kinRole;
  if (role !== 'spouse' && role !== 'parent' && role !== 'child' && role !== 'sibling') return null;
  const actor = context.actors.get(deceased);
  const name = actor?.name.trim() || null;
  const nativeAge = actor?.ageAtDeath ?? null;
  const numericAge = nativeAge !== null && BigInt(nativeAge) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(nativeAge) : null;
  const people: PicturePerson[] = [{ id: deceased, name: nameLabel(name), age: numericAge, origin: actor?.origin ?? null,
    sex: actor?.sex,
    lifeStatus: 'deceased', soul: false, visual: resolveVisualKey(deceased, numericAge), tint: 'kin' }];
  return { worldId, eventId: event.id, date: event.tick, deceased, name, nativeAge, kinRole: role,
    sex: actor?.sex, firstName: name?.split(/\s/u, 1)[0] ?? null, playerBody: context.focus, heir: context.focus,
    phaseKey: context.phase.key, identity: [worldId, event.id], world, people };
}

/** Only a genuinely offered node for this exact Death replaces the separate memorial. */
export function offeredFamilyDeathNode(capture: MemorialCapture, offeredWorldId: number, node: PlayerNode | null): PlayerNode | null {
  return offeredWorldId === capture.worldId && node?.family === 'family_death'
    && node.fired === capture.date && node.stakes.who[0] === capture.deceased ? node : null;
}

/** Estate amounts are recorded asset value, not newly available cash. */
export function enrichMemorial(capture: MemorialCapture, worldId: number, events: readonly StoryEvent[]): MemorialCapture {
  if (worldId !== capture.worldId || capture.estate !== undefined) return capture;
  const estate = events.find(event => event.kind.type === 'inheritance' && event.tick === capture.date
    && event.kind.deceased === capture.deceased && event.kind.heir === capture.heir && event.causedBy.includes(capture.eventId));
  return estate?.kind.type === 'inheritance' ? { ...capture, estate: { eventId: estate.id, amount: estate.kind.amount } } : capture;
}

export function memorialKeyScene(capture: MemorialCapture): KeySceneView {
  const fields: KeySceneView['document']['fields'] = [{ label: TECHNICAL_TEXT.memorialName, value: nameLabel(capture.name) },
    { label: TECHNICAL_TEXT.memorialDate, value: dateLabel(capture.date) }];
  if (capture.nativeAge !== null) fields.push({ label: TECHNICAL_TEXT.memorialAge, value: formatAmount(capture.nativeAge) });
  const line = supportedText(TECHNICAL_TEXT.memorialLine, { kin: kinshipNoun(capture.kinRole, capture.sex),
    'First name': capture.firstName ?? undefined, n: capture.nativeAge === null ? undefined : formatAmount(capture.nativeAge) });
  const lines = line === null ? [] : [line];
  if (capture.estate !== undefined) lines.push(supportedText(TECHNICAL_TEXT.memorialEstate, { $: formatMoney(capture.estate.amount) })!);
  return { identity: capture.identity, category: 'family_death', node: null, lifecycle: null, world: capture.world,
    title: TECHNICAL_TEXT.memorialTitle, date: capture.date, lines, people: capture.people, props: ['coffin', 'candle'],
    focal: { kind: 'prop', id: 'candle' }, source: { kind: 'event', eventId: capture.eventId },
    document: { title: TECHNICAL_TEXT.memorialDocument, fields }, memorial: true };
}

export function memorialSceneEntry(capture: MemorialCapture): SceneEntry {
  return { kind: 'funeral', node: null, identity: JSON.stringify(capture.identity), keyScene: memorialKeyScene(capture), world: capture.world };
}
