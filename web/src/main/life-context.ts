import type { ActorContext, StoryChronicle, StoryEvent } from '../shared/story.ts';
import type { PlayerLifecycleFact, WorldSnapshot } from '../shared/world-snapshot.ts';
import type { JournalActors } from './journal-templates.ts';
import { keyedStore, PersistentTree } from './persistent-store.ts';

export interface LifePhase {
  readonly key: string;
  readonly worldId: number;
  readonly kind: 'life' | 'waiting';
  readonly person: number;
  readonly name: string | null;
}
export interface EntryContext {
  readonly phase: LifePhase;
  readonly playerSoul: string;
  readonly focus: number;
  readonly actors: JournalActors;
  readonly actorContext: readonly ActorContext[];
  readonly formerBodies: Pick<ReadonlyMap<number, LifePhase>, 'get'>;
}
export interface AdmittedChoiceContext {
  readonly phase: LifePhase;
  readonly playerSoul: string;
  readonly focus: number;
  readonly actors: JournalActors;
  readonly actorContext?: readonly ActorContext[];
  readonly formerBodies?: Pick<ReadonlyMap<number, LifePhase>, 'get'>;
}
interface Position { readonly tick: string; readonly event: string }
interface Boundary extends Position { readonly before: LifePhase | null; readonly after: LifePhase }
export interface LifeContextIndex {
  readonly playerSoul: string | null;
  readonly initial: LifePhase | null;
  readonly current: LifePhase | null;
  readonly currentTick: string | null;
  readonly boundaries: PersistentTree<Position, Boundary>;
  readonly lives: PersistentTree<number, LifePhase>;
  readonly deaths: PersistentTree<number, Position>;
}
export interface StoryBinding {
  world?: WorldSnapshot;
  lifecycle?: readonly PlayerLifecycleFact[];
  choices?: Pick<ReadonlyMap<string, AdmittedChoiceContext>, 'get'>;
}
const decimal = (a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
const comparePosition = (a: Position, b: Position) => decimal(a.tick, b.tick) || decimal(a.event, b.event);
export function createLifeContextIndex(): LifeContextIndex {
  return { playerSoul: null, initial: null, current: null, currentTick: null, boundaries: new PersistentTree({ compare: comparePosition, empty: undefined, combine: () => undefined }), lives: keyedStore(), deaths: keyedStore() };
}
function phase(worldId: number, kind: LifePhase['kind'], person: number, name: string | null): LifePhase {
  return { key: `${worldId}/${kind}/${person}`, worldId, kind, person, name };
}
export function worldLifePhase(worldId: number, world: WorldSnapshot): LifePhase | null {
  const person = world.player.place === 'body' ? world.player.body : world.player_wait?.ghost;
  if (person === null || person === undefined) return null;
  const name = world.residents.find(actor => actor.id === person)?.name
    ?? world.player.earlier_bodies.find(actor => actor.id === person)?.name
    ?? world.person_names.find(actor => actor.id === person)?.name ?? null;
  return phase(worldId, world.player.place === 'body' ? 'life' : 'waiting', person, name);
}
function phaseAt(index: LifeContextIndex, position: Position): LifePhase | null {
  const exact = index.boundaries.get(position);
  if (exact) return exact.after;
  const rank = index.boundaries.rank(position);
  return (rank > 0 ? index.boundaries.at(rank - 1)?.after : null) ?? index.boundaries.at(rank)?.before ?? index.initial;
}
/** Only actual lifecycle facts and recorded player focuses define historical boundaries. */
export class LifeContextWriter {
  index: LifeContextIndex;
  readonly worldId: number;
  constructor(worldId: number, index: LifeContextIndex, world?: WorldSnapshot) {
    this.worldId = worldId;
    this.index = index;
    if (world && (index.currentTick === null || decimal(world.tick, index.currentTick) >= 0) && (index.currentTick !== world.tick || worldLifePhase(worldId, world)?.key !== index.current?.key)) {
      const current = worldLifePhase(worldId, world);
      const lives = current?.kind === 'life' && !index.lives.get(current.person) ? index.lives.set(current.person, current) : index.lives;
      this.index = { ...index, playerSoul: index.playerSoul ?? world.player_soul, initial: index.initial ?? current, current, currentTick: world.tick, lives };
    }
  }
  lifecycle(fact: PlayerLifecycleFact, actors: JournalActors, contexts: readonly ActorContext[] = []): void {
    const position = { tick: fact.tick, event: fact.event };
    if (this.index.boundaries.get(position)) return;
    const life = this.index.lives.get(fact.body) ?? phase(this.worldId, 'life', fact.body, fact.name || actors.get(fact.body)?.name || null);
    const prior = phaseAt(this.index, position);
    const start = contexts.find(context => context.basis === 'observed-day-start');
    const before = fact.kind === 'death' ? life : prior && prior.person !== fact.body ? prior
      : start && start.relativeTo !== fact.body ? phase(this.worldId, 'waiting', start.relativeTo, actors.get(start.relativeTo)?.name ?? null) : null;
    const after = fact.kind === 'death' ? phase(this.worldId, 'waiting', fact.body, life.name) : life;
    const boundaries = this.index.boundaries.set(position, { ...position, before, after });
    const newest = boundaries.at(-1)!;
    const advance = this.index.currentTick === null || decimal(newest.tick, this.index.currentTick) >= 0;
    this.index = { ...this.index, boundaries, current: advance ? newest.after : this.index.current, currentTick: advance ? newest.tick : this.index.currentTick, lives: this.index.lives.set(fact.body, life), deaths: fact.kind === 'death' ? this.index.deaths.set(fact.body, position) : this.index.deaths };
  }
  eventBoundary(event: StoryEvent, actors: JournalActors, opening: boolean): void {
    if (opening || !('person' in event.kind) || !['birth', 'death', 'possession', 'rebuild'].includes(event.kind.type)) return;
    const person = event.kind.person;
    if (!event.actorContext.some(context => context.relativeTo === person)) return;
    const actor = actors.get(person);
    this.lifecycle({ event: event.id, tick: event.tick, kind: event.kind.type as PlayerLifecycleFact['kind'], body: person, name: actor?.name ?? '', origin: actor?.origin === 'possessed' || actor?.origin === 'rebuilt' ? actor.origin : 'native' }, actors, event.actorContext);
  }
  capture(record: StoryEvent | StoryChronicle, actors: JournalActors, opening: boolean, linked?: EntryContext | null, admitted?: AdmittedChoiceContext): EntryContext | null {
    const soul = this.index.playerSoul;
    if (soul === null) return null;
    const contexts = record.actorContext;
    const isEvent = 'id' in record;
    const position = { tick: record.tick, event: isEvent ? record.id : '18446744073709551616' };
    const boundary = isEvent ? this.index.boundaries.get(position) : undefined;
    const start = contexts.find(context => context.basis === 'observed-day-start') ?? contexts[0];
    const dayStart = !isEvent && !admitted && !linked ? phaseAt(this.index, { tick: record.tick, event: '0' }) : null;
    let selected = admitted?.phase ?? linked?.phase ?? (opening ? this.index.current
      : !isEvent ? dayStart
      : boundary && record.kind.type === 'death' ? boundary.before : phaseAt(this.index, position));
    if (!admitted && !linked && start && (!isEvent ? selected?.person !== start.relativeTo : !contexts.some(context => context.relativeTo === selected?.person))) {
      const startPhase = isEvent ? phaseAt(this.index, { tick: record.tick, event: '0' }) : dayStart;
      if (startPhase?.person === start.relativeTo) selected = startPhase;
      else {
        const life = this.index.lives.get(start.relativeTo);
        const death = this.index.deaths.get(start.relativeTo);
        selected = death && comparePosition(death, position) < 0
          ? phase(this.worldId, 'waiting', start.relativeTo, life?.name ?? actors.get(start.relativeTo)?.name ?? null)
          : life ?? phase(this.worldId, 'life', start.relativeTo, actors.get(start.relativeTo)?.name ?? null);
      }
    }
    if (!selected) return null;
    const lives = this.index.lives, deaths = this.index.deaths;
    const formerBodies = admitted?.formerBodies ?? linked?.formerBodies ?? { get(person: number) { const death = deaths.get(person); return death && comparePosition(death, position) < 0 ? lives.get(person) : undefined; } };
    const focus = admitted?.focus ?? linked?.focus ?? selected.person;
    const actorContext = admitted?.actorContext ?? (contexts.length ? contexts : linked?.actorContext ?? contexts);
    return { phase: selected, playerSoul: admitted?.playerSoul ?? linked?.playerSoul ?? soul, focus, actors: admitted?.actors ?? linked?.actors ?? actors, actorContext: actorContext.filter(context => context.relativeTo === focus), formerBodies };
  }
}
