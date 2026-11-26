import type { DreamFact, StoryActor, StoryBatch, StoryChronicle, StoryDelivery, StoryEvent, StoryIdentity } from '../shared/story.ts';
import { dateLabel, formatAmount, formatMoney } from './calendar.ts';
import { compareDecimal, createJournalIndex, GroupMembers, JournalIndexWriter, type GroupMetadata, type JournalIndex } from './journal-index.ts';
import { renderStoryChronicle, renderStoryEvent, storyPerson, type JournalContext } from './journal-templates.ts';
import { keyedStore, PersistentSequence, type IndexedSequence, type PersistentTree } from './persistent-store.ts';
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
  readonly text: string;
  readonly count: number;
  readonly sum?: string;
  readonly sumRole?: 'repayment';
}
export type JournalSection = 'life' | 'town' | 'all';
export const JOURNAL_RANGE_SIZE = 120;
export const JOURNAL_EXPANSION_SIZE = 24;

export function createNotebook(worldId: number): LifeNotebook {
  return { worldId, actors: keyedStore(), events: keyedStore(), chronicle: keyedStore(), dreams: keyedStore(), dreamsByInputSeq: keyedStore(), identities: new PersistentSequence(), opening: keyedStore(), cursors: null, journal: createJournalIndex() };
}
/** Delivery epochs are checked here as well as at the client seam. Rebirth is not a new epoch. */
export function appendStory(notebook: LifeNotebook, deliveries: readonly StoryDelivery[]): LifeNotebook {
  let { actors, events, chronicle, dreams, dreamsByInputSeq, identities, opening, cursors } = notebook;
  const writer = new JournalIndexWriter(notebook.journal);
  let changed = false;
  for (const delivery of deliveries) {
    if (delivery.worldId !== notebook.worldId) continue;
    const batch = delivery.batch;
    if (batch.version !== 1) throw new Error('The life journal could not read this delivery. Its record format is unsupported.');
    for (const actor of batch.actors) {
      const prior = actors.get(actor.person);
      if (prior && prior.soulId === actor.soulId && prior.name === actor.name && prior.sex === actor.sex && prior.origin === actor.origin && prior.birthDay === actor.birthDay && (actor.ageAtDeath === undefined || prior.ageAtDeath === actor.ageAtDeath)) continue;
      actors = actors.set(actor.person, prior && actor.ageAtDeath === undefined && prior.ageAtDeath !== undefined ? { ...actor, ageAtDeath: prior.ageAtDeath } : actor);
      changed = true;
    }
    for (const event of batch.events) {
      if (events.get(event.id)) continue;
      events = events.set(event.id, event);
      const identity: StoryIdentity = `e:${event.id}`;
      identities = identities.append(identity);
      opening = opening.set(identity, batch.opening);
      writer.event(event, batch.opening);
      changed = true;
    }
    for (const record of batch.chronicle) {
      if (chronicle.get(record.index)) continue;
      chronicle = chronicle.set(record.index, record);
      const identity: StoryIdentity = `c:${record.index}`;
      identities = identities.append(identity);
      opening = opening.set(identity, batch.opening);
      writer.chronicle(record, batch.opening, events, opening);
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
  return changed ? { worldId: notebook.worldId, actors, events, chronicle, dreams, dreamsByInputSeq, identities, opening, cursors, journal: writer.index } : notebook;
}
export function exportNotebook(notebook: LifeNotebook): LifeNotebookExport {
  return { worldId: notebook.worldId, actors: Object.fromEntries(notebook.actors), events: Object.fromEntries(notebook.events), chronicle: Object.fromEntries(notebook.chronicle), dreams: Object.fromEntries(notebook.dreams), identities: [...notebook.identities], opening: Object.fromEntries(notebook.opening) as Record<StoryIdentity, boolean>, cursors: notebook.cursors };
}
function renderGroup(group: GroupMetadata, notebook: LifeNotebook, context: JournalContext): JournalGroup {
  const members = new GroupMembers(group);
  const base = { id: `${notebook.worldId}:${group.identity}`, members, from: group.from, to: group.to, primary: group.primary, milestone: group.milestone, opening: group.opening, count: members.length };
  if (group.identity.startsWith('c:')) {
    const record = notebook.chronicle.get(group.identity.slice(2))!;
    const missing = group.missing ? ' Some linked event accounts have not reached the journal yet.' : '';
    let text = renderStoryChronicle(record, notebook.actors, context) + missing;
    for (const reference of group.references.values()) text += ` ${renderStoryEvent(notebook.events.get(reference.id)!, notebook.actors, context)}`;
    return { ...base, text };
  }
  const first = notebook.events.get(group.totals.first!.id)!;
  if (group.totals.count === 1) return { ...base, text: renderStoryEvent(first, notebook.actors, context) };
  const kind = first.kind;
  const count = formatAmount(String(group.totals.count));
  const dates = group.from === group.to ? dateLabel(group.from) : `${dateLabel(group.from)} through ${dateLabel(group.to)}`;
  const p = (id: number) => storyPerson(id, notebook.actors, context, first.actorContext);
  if (kind.type === 'social' && group.totals.repeat === group.totals.first!.repeat) {
    const actions = { help: 'acts of help', gift: 'gifts', quarrel: 'quarrels', insult: 'insults', theft: 'thefts', apology: 'apologies' };
    return { ...base, text: `${count} ${actions[kind.kind]} from ${p(kind.doer)} toward ${p(kind.target)} were recorded, ${dates}. Each occurrence remains below; a count is not a claim about anyone's feelings.` };
  }
  if (kind.type === 'repayment' && group.totals.repeat === group.totals.first!.repeat) {
    const sum = group.totals.sum.toString();
    return { ...base, text: `${count} repayments from ${p(kind.payer)} to ${p(kind.payee)} totaled ${formatMoney(sum)}, ${dates}. The repayment column has been doing some arithmetic.`, sum, sumRole: 'repayment' };
  }
  return { ...base, text: `The stretch from ${dates} brought ${count} recorded events. The individual accounts remain below, rather than competing for the same line.` };
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
    if (identity.startsWith('e:')) {
      const event = notebook.events.get(identity.slice(2))!;
      return { identity, tick: event.tick, text: renderStoryEvent(event, notebook.actors, rendering) };
    }
    const record = notebook.chronicle.get(identity.slice(2))!;
    return { identity, tick: record.tick, text: renderStoryChronicle(record, notebook.actors, rendering) };
  });
}
