import type { DreamFact, StoryActor, StoryBatch, StoryChronicle, StoryDelivery, StoryEvent, StoryIdentity } from '../shared/story.ts';
import { formatAmount, formatMoney } from './calendar.ts';
import { compareDecimal, createJournalIndex, GroupMembers, JournalIndexWriter, type GroupMetadata, type JournalIndex } from './journal-index.ts';
import { renderStoryChronicle, renderStoryEvent, storyPerson, type JournalContext } from './journal-templates.ts';
import { keyedStore, PersistentSequence, type IndexedSequence, type PersistentTree } from './persistent-store.ts';
import type { WorldSnapshot } from '../shared/world-snapshot.ts';
import { createLifeContextIndex, LifeContextWriter, worldLifePhase, type EntryContext, type LifeContextIndex, type LifePhase, type StoryBinding } from './life-context.ts';
import { TECHNICAL_TEXT, supportedText } from './technical-text.ts';
export type { AdmittedChoiceContext, EntryContext, LifePhase, StoryBinding } from './life-context.ts';
export { renderStoryChronicle, renderStoryEvent } from './journal-templates.ts';

export interface LifeNotebook {
  readonly worldId: number;
  readonly actors: PersistentTree<number, StoryActor>;
  readonly events: PersistentTree<string, StoryEvent>;
  readonly chronicle: PersistentTree<string, StoryChronicle>;
  readonly dreams: PersistentTree<string, DreamFact>;
  readonly dreamsByInputSeq: PersistentTree<string, DreamFact>;
  readonly identities: PersistentSequence<StoryIdentity>;
  readonly opening: PersistentTree<StoryIdentity, boolean>;
  readonly cursors: StoryBatch['cursors'] | null;
  readonly journal: JournalIndex;
  /** Only roots read by historical rendering advance this revision, never the phase clock. */
  readonly renderRevision: number;
  readonly contexts: PersistentTree<StoryIdentity, EntryContext>;
  /** Only entries without a captured EntryContext retain a separate fallback actor root. */
  readonly actorRoots: PersistentTree<StoryIdentity, PersistentTree<number, StoryActor>>;
  readonly phaseActors: PersistentTree<string, PersistentTree<number, StoryActor>>;
  readonly phases: LifeContextIndex;
  readonly chronicleByNode: PersistentTree<string, StoryChronicle>;
}
/** The downloadable full-fact JSON contract deliberately excludes storage indexes. */
export interface LifeNotebookExport {
  readonly worldId: number;
  readonly actors: Readonly<Record<number, StoryActor>>;
  readonly events: Readonly<Record<string, StoryEvent>>;
  readonly chronicle: Readonly<Record<string, StoryChronicle>>;
  readonly dreams: Readonly<Record<string, DreamFact>>;
  readonly identities: readonly StoryIdentity[];
  readonly opening: Readonly<Record<StoryIdentity, boolean>>;
  readonly cursors: StoryBatch['cursors'] | null;
}
export interface JournalGroup {
  readonly id: string;
  readonly members: IndexedSequence<StoryIdentity>;
  readonly from: string;
  readonly to: string;
  readonly primary: boolean;
  readonly milestone: boolean;
  readonly opening: boolean;
  readonly phase: LifePhase | null;
  readonly text: string;
  readonly count: number;
  readonly sum?: string;
  readonly sumRole?: 'repayment';
}
export type JournalSection = 'life' | 'town' | 'all';
export const JOURNAL_RANGE_SIZE = 120;
export const JOURNAL_EXPANSION_SIZE = 24;

export function createNotebook(worldId: number): LifeNotebook {
  return { worldId, actors: keyedStore(), events: keyedStore(), chronicle: keyedStore(), dreams: keyedStore(), dreamsByInputSeq: keyedStore(), identities: new PersistentSequence(), opening: keyedStore(), cursors: null, journal: createJournalIndex(), renderRevision: 0, contexts: keyedStore(), actorRoots: keyedStore(), phaseActors: keyedStore(), phases: createLifeContextIndex(), chronicleByNode: keyedStore() };
}
/** Delivery epochs are checked here as well as at the client seam. Rebirth is not a new epoch. */
export function appendStory(notebook: LifeNotebook, deliveries: readonly StoryDelivery[], binding: StoryBinding = {}): LifeNotebook {
  let { actors, events, chronicle, dreams, dreamsByInputSeq, identities, opening, cursors, contexts, actorRoots, phaseActors, chronicleByNode } = notebook;
  const writer = new JournalIndexWriter(notebook.journal);
  const phaseWriter = new LifeContextWriter(notebook.worldId, notebook.phases, binding.world);
  const admitted = deliveries.filter(delivery => delivery.worldId === notebook.worldId);
  const lifecycle = [...binding.lifecycle ?? []].sort((a, b) => compareDecimal(a.tick, b.tick) || compareDecimal(a.event, b.event));
  const deliveredEvents = admitted.flatMap(delivery => delivery.batch.events);
  const eventsById = new Map(deliveredEvents.map(event => [event.id, event]));
  for (const fact of lifecycle) phaseWriter.lifecycle(fact, actors, eventsById.get(fact.event)?.actorContext);
  const roots: PersistentTree<number, StoryActor>[] = [];
  let changed = phaseWriter.index !== notebook.phases;
  for (const delivery of admitted) {
    const batch = delivery.batch;
    if (batch.version !== 1) throw new Error('The life journal could not read this delivery. Its record format is unsupported.');
    for (const actor of batch.actors) {
      const prior = actors.get(actor.person);
      if (prior && prior.soulId === actor.soulId && prior.name === actor.name && prior.sex === actor.sex && prior.origin === actor.origin && prior.birthDay === actor.birthDay && (actor.ageAtDeath === undefined || prior.ageAtDeath === actor.ageAtDeath)) continue;
      actors = actors.set(actor.person, prior && actor.ageAtDeath === undefined && prior.ageAtDeath !== undefined ? { ...actor, ageAtDeath: prior.ageAtDeath } : actor);
      changed = true;
    }
    roots.push(actors);
  }
  const boundaryEvents = admitted.flatMap(delivery => delivery.batch.opening ? [] : delivery.batch.events).filter(event => 'person' in event.kind && ['birth', 'death', 'possession', 'rebuild'].includes(event.kind.type)).sort((a, b) => compareDecimal(a.tick, b.tick) || compareDecimal(a.id, b.id));
  for (const event of boundaryEvents) phaseWriter.eventBoundary(event, actors, false);
  const capture = (record: StoryEvent | StoryChronicle, identity: StoryIdentity, root: PersistentTree<number, StoryActor>, batch: StoryBatch, linked?: EntryContext | null): EntryContext | null => {
    const choice = 'index' in record && record.node !== undefined ? binding.choices?.get(record.node) : undefined;
    let captured = phaseWriter.capture(record, root, batch.opening, linked, choice);
    if (captured) {
      const prior = phaseActors.get(captured.phase.key);
      if (!choice && !linked && prior && captured.phase.key !== phaseWriter.index.current?.key) {
        root = prior;
        for (const actor of batch.actors) if (!root.get(actor.person)) root = root.set(actor.person, actor);
        if ('id' in record && record.kind.type === 'death') {
          const person = record.kind.person;
          const deceased = batch.actors.find(actor => actor.person === person);
          const earlier = root.get(person);
          if (earlier && deceased?.ageAtDeath !== undefined && earlier.ageAtDeath !== deceased.ageAtDeath) root = root.set(person, { ...earlier, ageAtDeath: deceased.ageAtDeath });
        }
        captured = { ...captured, actors: root };
      }
      if (!choice && !linked) phaseActors = phaseActors.set(captured.phase.key, root);
      contexts = contexts.set(identity, captured);
    } else actorRoots = actorRoots.set(identity, root);
    return captured;
  };
  for (let index = 0; index < admitted.length; index++) {
    const batch = admitted[index]!.batch;
    const root = roots[index]!;
    for (const event of batch.events) {
      if (events.get(event.id)) continue;
      events = events.set(event.id, event);
      const identity: StoryIdentity = `e:${event.id}`;
      identities = identities.append(identity);
      opening = opening.set(identity, batch.opening);
      const captured = capture(event, identity, root, batch);
      writer.event(event, batch.opening, captured?.phase ?? null);
      changed = true;
    }
    for (const record of batch.chronicle) {
      if (chronicle.get(record.index)) continue;
      chronicle = chronicle.set(record.index, record);
      const identity: StoryIdentity = `c:${record.index}`;
      identities = identities.append(identity);
      opening = opening.set(identity, batch.opening);
      let linked: EntryContext | null = null;
      for (const id of record.appended) {
        linked = contexts.get(`e:${id}`) ?? null;
        if (linked) break;
      }
      const captured = capture(record, identity, root, batch, linked);
      writer.chronicle(record, batch.opening, events, opening, captured?.phase ?? null, contexts);
      if (record.node !== undefined) {
        const prior = chronicleByNode.get(record.node);
        if (!prior || compareDecimal(record.index, prior.index) < 0) chronicleByNode = chronicleByNode.set(record.node, record);
      }
      changed = true;
    }
    for (const dream of batch.dreams) {
      if (dreams.get(dream.eventId)) continue;
      dreams = dreams.set(dream.eventId, dream);
      const prior = dreamsByInputSeq.get(dream.inputSeq);
      if (!prior || compareDecimal(dream.eventId, prior.eventId) < 0) dreamsByInputSeq = dreamsByInputSeq.set(dream.inputSeq, dream);
      changed = true;
    }
    if (cursors === null || BigInt(batch.cursors.events.end) > BigInt(cursors.events.end) || BigInt(batch.cursors.chronicle.end) > BigInt(cursors.chronicle.end)) {
      cursors = batch.cursors;
      changed = true;
    }
  }
  const renderChanged = actors !== notebook.actors || events !== notebook.events || chronicle !== notebook.chronicle
    || dreams !== notebook.dreams || writer.index !== notebook.journal || contexts !== notebook.contexts || actorRoots !== notebook.actorRoots;
  const renderRevision = notebook.renderRevision + Number(renderChanged);
  return changed || phaseWriter.index !== notebook.phases ? { worldId: notebook.worldId, actors, events, chronicle, dreams, dreamsByInputSeq, identities, opening, cursors, journal: writer.index, renderRevision, contexts, actorRoots, phaseActors, phases: phaseWriter.index, chronicleByNode } : notebook;
}
export function exportNotebook(notebook: LifeNotebook): LifeNotebookExport {
  return { worldId: notebook.worldId, actors: Object.fromEntries(notebook.actors), events: Object.fromEntries(notebook.events), chronicle: Object.fromEntries(notebook.chronicle), dreams: Object.fromEntries(notebook.dreams), identities: [...notebook.identities], opening: Object.fromEntries(notebook.opening) as Record<StoryIdentity, boolean>, cursors: notebook.cursors };
}
export function entryContext(notebook: LifeNotebook, identity: StoryIdentity): EntryContext | null {
  return notebook.contexts.get(identity) ?? null;
}
export function currentLifePhase(notebook: LifeNotebook, world?: WorldSnapshot | null): LifePhase | null {
  return world ? worldLifePhase(notebook.worldId, world) : notebook.phases.current;
}
export function chronicleForNode(notebook: LifeNotebook, node: string): StoryChronicle | null {
  return notebook.chronicleByNode.get(node) ?? null;
}
function renderingContext(notebook: LifeNotebook, identity: StoryIdentity, fallback: JournalContext) {
  const captured = entryContext(notebook, identity);
  return { actors: captured?.actors ?? notebook.actorRoots.get(identity) ?? notebook.actors, context: captured ? { playerSoul: captured.playerSoul, currentBody: captured.focus, formerBodies: captured.formerBodies, dreams: notebook.dreams, actorContext: captured.actorContext } : fallback };
}
export function journalTownPromotion(notebook: LifeNotebook, event: StoryEvent, fallback: JournalContext): string {
  const rendering = renderingContext(notebook, `e:${event.id}`, fallback);
  return renderStoryEvent(event, rendering.actors, rendering.context);
}
function renderGroup(group: GroupMetadata, notebook: LifeNotebook, context: JournalContext): JournalGroup {
  const members = new GroupMembers(group);
  const base = { id: `${notebook.worldId}:${group.identity}`, members, from: group.from, to: group.to, primary: group.primary, milestone: group.milestone, opening: group.opening, phase: group.phase, count: members.length };
  if (group.identity.startsWith('c:')) {
    const record = notebook.chronicle.get(group.identity.slice(2))!;
    const rendering = renderingContext(notebook, group.identity, context);
    let text = renderStoryChronicle(record, rendering.actors, rendering.context);
    for (const reference of group.references.values()) {
      const event = notebook.events.get(reference.id)!;
      const rendering = renderingContext(notebook, reference.identity, context);
      const sentence = renderStoryEvent(event, rendering.actors, rendering.context);
      if (sentence) text += `${text ? ' ' : ''}${sentence}`;
    }
    return { ...base, text };
  }
  const first = notebook.events.get(group.totals.first!.id)!;
  if (group.totals.count === 1) {
    const rendering = renderingContext(notebook, `e:${first.id}`, context);
    return { ...base, text: renderStoryEvent(first, rendering.actors, rendering.context) };
  }
  const kind = first.kind;
  const count = formatAmount(String(group.totals.count));
  if (kind.type === 'repayment' && group.totals.repeat === group.totals.first!.repeat) {
    const rendering = renderingContext(notebook, `e:${first.id}`, context);
    const p = (id: number) => storyPerson(id, rendering.actors, rendering.context, rendering.context.actorContext ?? first.actorContext);
    const payer = p(kind.payer);
    const sum = group.totals.sum.toString();
    return { ...base, text: `${payer.charAt(0).toUpperCase()}${payer.slice(1)} paid ${p(kind.payee)} back ${formatMoney(sum)} over ${count} payments.`, sum, sumRole: 'repayment' };
  }
  return { ...base, text: supportedText(TECHNICAL_TEXT.journalStretch, { n: count })! };
}
export function journalGroupCount(notebook: LifeNotebook, section: JournalSection = 'all'): number {
  return notebook.journal[section].size;
}
/** Select an indexed section and exclusive endpoint before any story text is generated. */
export function journalRange(notebook: LifeNotebook, context: { playerSoul: string; currentBody: number | null }, section: JournalSection = 'all', end = journalGroupCount(notebook, section)): readonly JournalGroup[] {
  const groups = notebook.journal[section];
  const boundedEnd = Math.max(0, Math.min(groups.size, end));
  const rendering = { ...context, dreams: notebook.dreams };
  return groups.slice(Math.max(0, boundedEnd - JOURNAL_RANGE_SIZE), boundedEnd).map(group => renderGroup(group, notebook, rendering));
}
export function latestPrimaryIdentity(notebook: LifeNotebook): StoryIdentity | null {
  return notebook.journal.latestPrimary;
}
export function latestTownEvent(notebook: LifeNotebook, afterId: string | null): StoryEvent | null {
  const event = notebook.journal.promotion.at(-1);
  return event && (afterId === null || compareDecimal(event.id, afterId) > 0) ? event : null;
}
export function journalMemberLines(group: JournalGroup, notebook: LifeNotebook, context: { playerSoul: string; currentBody: number | null }, start = 0): { identity: StoryIdentity; tick: string; text: string }[] {
  const rendering = { ...context, dreams: notebook.dreams };
  return group.members.slice(Math.max(0, start), Math.max(0, start) + JOURNAL_EXPANSION_SIZE).map(identity => {
    const captured = renderingContext(notebook, identity, rendering);
    if (identity.startsWith('e:')) {
      const event = notebook.events.get(identity.slice(2))!;
      return { identity, tick: event.tick, text: renderStoryEvent(event, captured.actors, captured.context) };
    }
    const record = notebook.chronicle.get(identity.slice(2))!;
    return { identity, tick: record.tick, text: renderStoryChronicle(record, captured.actors, captured.context) };
  });
}
