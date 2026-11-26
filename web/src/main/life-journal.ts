import type { DreamFact, StoryActor, StoryBatch, StoryChronicle, StoryDelivery, StoryEvent, StoryIdentity } from '../shared/story.ts';
import { dateLabel, formatAmount, formatMoney } from './calendar.ts';
import { renderStoryChronicle, renderStoryEvent, storyPerson, type JournalContext } from './journal-templates.ts';
export { renderStoryChronicle, renderStoryEvent } from './journal-templates.ts';

export interface LifeNotebook {
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
  id: string;
  members: StoryIdentity[];
  from: string;
  to: string;
  primary: boolean;
  milestone: boolean;
  opening: boolean;
  text: string;
  count: number;
  sum?: string;
  sumRole?: 'repayment' | 'loan' | 'burned' | 'estate';
  events: StoryEvent[];
  chronicle: StoryChronicle[];
}
export const JOURNAL_RANGE_SIZE = 120;
export const JOURNAL_EXPANSION_SIZE = 24;

export function createNotebook(worldId: number): LifeNotebook {
  return { worldId, actors: {}, events: {}, chronicle: {}, dreams: {}, identities: [], opening: {} as Record<StoryIdentity, boolean>, cursors: null };
}
/** Delivery epochs are checked here as well as at the client seam. Rebirth is not a new epoch. */
export function appendStory(notebook: LifeNotebook, deliveries: readonly StoryDelivery[]): LifeNotebook {
  let actors = notebook.actors, events = notebook.events, chronicle = notebook.chronicle, dreams = notebook.dreams;
  let identities = notebook.identities, opening = notebook.opening, cursors = notebook.cursors;
  let changed = false;
  for (const delivery of deliveries) {
    if (delivery.worldId !== notebook.worldId) continue;
    const batch = delivery.batch;
    if (batch.version !== 1) throw new Error('The life journal could not read this delivery. Its record format is unsupported.');
    for (const actor of batch.actors) {
      const prior = actors[actor.person];
      if (prior && prior.soulId === actor.soulId && prior.name === actor.name && prior.sex === actor.sex && prior.origin === actor.origin && prior.birthDay === actor.birthDay && (actor.ageAtDeath === undefined || prior.ageAtDeath === actor.ageAtDeath)) continue;
      if (actors === notebook.actors) actors = { ...actors };
      (actors as Record<number, StoryActor>)[actor.person] = prior && actor.ageAtDeath === undefined && prior.ageAtDeath !== undefined ? { ...actor, ageAtDeath: prior.ageAtDeath } : actor;
      changed = true;
    }
    for (const event of batch.events) {
      if (events[event.id]) continue;
      if (events === notebook.events) events = { ...events };
      if (identities === notebook.identities) identities = [...identities];
      if (opening === notebook.opening) opening = { ...opening };
      (events as Record<string, StoryEvent>)[event.id] = event;
      const identity: StoryIdentity = `e:${event.id}`;
      (identities as StoryIdentity[]).push(identity);
      (opening as Record<StoryIdentity, boolean>)[identity] = batch.opening;
      changed = true;
    }
    for (const record of batch.chronicle) {
      if (chronicle[record.index]) continue;
      if (chronicle === notebook.chronicle) chronicle = { ...chronicle };
      if (identities === notebook.identities) identities = [...identities];
      if (opening === notebook.opening) opening = { ...opening };
      (chronicle as Record<string, StoryChronicle>)[record.index] = record;
      const identity: StoryIdentity = `c:${record.index}`;
      (identities as StoryIdentity[]).push(identity);
      (opening as Record<StoryIdentity, boolean>)[identity] = batch.opening;
      changed = true;
    }
    for (const dream of batch.dreams) {
      if (dreams[dream.eventId]) continue;
      if (dreams === notebook.dreams) dreams = { ...dreams };
      (dreams as Record<string, DreamFact>)[dream.eventId] = dream;
      changed = true;
    }
    if (cursors === null || BigInt(batch.cursors.events.end) > BigInt(cursors.events.end) || BigInt(batch.cursors.chronicle.end) > BigInt(cursors.chronicle.end)) {
      cursors = batch.cursors;
      changed = true;
    }
  }
  return changed ? { worldId: notebook.worldId, actors, events, chronicle, dreams, identities, opening, cursors } : notebook;
}
function compareDecimal(a: string, b: string): number {
  const left = BigInt(a), right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function dateRange(from: string, to: string): string {
  return from === to ? dateLabel(from) : `${dateLabel(from)} through ${dateLabel(to)}`;
}
function repeatedKey(event: StoryEvent): string | undefined {
  const k = event.kind;
  if (k.type === 'social') return `social:${k.kind}:${k.doer}:${k.target}`;
  // Missing causes are not evidence that two payments concern the same debt.
  if (k.type === 'repayment' && event.causedBy.length) return `repayment:${k.payer}:${k.payee}:${[...event.causedBy].sort(compareDecimal).join(',')}`;
  return undefined;
}
function groupedSentence(events: StoryEvent[], notebook: LifeNotebook, context: JournalContext, from: string, to: string): { text: string; sum?: string; sumRole?: JournalGroup['sumRole'] } {
  const first = events[0]!;
  const k = first.kind;
  const count = formatAmount(String(events.length));
  const dates = dateRange(from, to);
  const p = (id: number) => storyPerson(id, notebook.actors, context, first.actorContext);
  if (k.type === 'social' && events.every(event => repeatedKey(event) === repeatedKey(first))) {
    const actions = { help: 'acts of help', gift: 'gifts', quarrel: 'quarrels', insult: 'insults', theft: 'thefts', apology: 'apologies' };
    return { text: `${count} ${actions[k.kind]} from ${p(k.doer)} toward ${p(k.target)} were recorded, ${dates}. Each occurrence remains below; a count is not a claim about anyone's feelings.` };
  }
  if (k.type === 'repayment' && events.every(event => repeatedKey(event) === repeatedKey(first))) {
    const sum = events.reduce((total, event) => total + BigInt((event.kind as Extract<StoryEvent['kind'], { type: 'repayment' }>).amount), 0n).toString();
    return { text: `${count} repayments from ${p(k.payer)} to ${p(k.payee)} totaled ${formatMoney(sum)}, ${dates}. The repayment column has been doing some arithmetic.`, sum, sumRole: 'repayment' };
  }
  return { text: `The stretch from ${dates} brought ${count} recorded events. The individual accounts remain below, rather than competing for the same line.` };
}
function mergeGroups(groups: JournalGroup[], notebook: LifeNotebook, context: JournalContext): JournalGroup {
  const first = groups[0]!;
  const events = groups.flatMap(group => group.events).sort((a, b) => compareDecimal(a.tick, b.tick) || compareDecimal(a.id, b.id));
  const from = groups.reduce((min, group) => compareDecimal(group.from, min) < 0 ? group.from : min, first.from);
  const to = groups.reduce((max, group) => compareDecimal(group.to, max) > 0 ? group.to : max, first.to);
  const { sum: _sum, sumRole: _sumRole, ...base } = first;
  return { ...base, members: events.map<StoryIdentity>(event => `e:${event.id}`), from, to, events, count: events.length, ...groupedSentence(events, notebook, context, from, to) };
}
export function journalGroups(notebook: LifeNotebook, context: { playerSoul: string; currentBody: number | null }): JournalGroup[] {
  const rendering: JournalContext = { ...context, dreams: notebook.dreams };
  const groups: JournalGroup[] = [];
  const joined = new Set<string>();
  const records = Object.values(notebook.chronicle).sort((a, b) => compareDecimal(a.index, b.index));
  for (const record of records) {
    const events: StoryEvent[] = [];
    for (const eventId of record.appended) {
      if (joined.has(eventId)) continue;
      joined.add(eventId);
      const event = notebook.events[eventId];
      if (event) events.push(event);
    }
    events.sort((a, b) => compareDecimal(a.id, b.id));
    const identity: StoryIdentity = `c:${record.index}`;
    const from = events.reduce((min, event) => compareDecimal(event.tick, min) < 0 ? event.tick : min, record.tick);
    const to = events.reduce((max, event) => compareDecimal(event.tick, max) > 0 ? event.tick : max, record.tick);
    const missing = record.appended.some(id => !notebook.events[id]) ? ' Some linked event accounts have not reached the journal yet.' : '';
    groups.push({ id: `${notebook.worldId}:${identity}`, members: [identity, ...events.map(event => `e:${event.id}` as StoryIdentity)], from, to, primary: true, milestone: true, opening: notebook.opening[identity] === true, text: renderStoryChronicle(record, notebook.actors, rendering) + missing + events.map(event => ` ${renderStoryEvent(event, notebook.actors, rendering)}`).join(''), count: 1 + events.length, events, chronicle: [record] });
  }
  for (const event of Object.values(notebook.events)) {
    if (joined.has(event.id)) continue;
    const identity: StoryIdentity = `e:${event.id}`;
    const milestone = ['birth', 'death', 'marriage', 'inheritance', 'possession', 'rebuild'].includes(event.kind.type);
    groups.push({ id: `${notebook.worldId}:${identity}`, members: [identity], from: event.tick, to: event.tick, primary: event.relevance !== 'background', milestone, opening: notebook.opening[identity] === true, text: renderStoryEvent(event, notebook.actors, rendering), count: 1, events: [event], chronicle: [] });
  }
  groups.sort((a, b) => compareDecimal(a.from, b.from) || compareDecimal(a.members[0]!.slice(2), b.members[0]!.slice(2)) || a.id.localeCompare(b.id));
  // Never mix observed relationship contexts or opening history in a repeated account.
  // A loan's repayments can span weeks; their shared native cause is the grouping boundary.
  const repeated = new Map<string, JournalGroup[]>();
  for (const group of groups) {
    if (group.milestone || group.events.length !== 1) continue;
    const event = group.events[0]!;
    const key = repeatedKey(event);
    if (!key) continue;
    const week = event.kind.type === 'repayment' ? 'loan-span' : String(BigInt(event.tick) / 7n);
    const bucket = `${group.primary}:${group.opening}:${week}:${key}:${JSON.stringify(event.actorContext)}`;
    const members = repeated.get(bucket);
    if (members) members.push(group); else repeated.set(bucket, [group]);
  }
  const replacements = new Map<string, JournalGroup>();
  const consumed = new Set<string>();
  for (const members of repeated.values()) {
    if (members.length < 2) continue;
    replacements.set(members[0]!.id, mergeGroups(members, notebook, rendering));
    for (const group of members.slice(1)) consumed.add(group.id);
  }
  const repeatedGroups = groups.filter(group => !consumed.has(group.id)).map(group => replacements.get(group.id) ?? group);
  const stretches = new Map<string, JournalGroup[]>();
  for (const group of repeatedGroups) {
    if (group.milestone || BigInt(group.from) / 7n !== BigInt(group.to) / 7n) continue;
    const week = BigInt(group.from) / 7n;
    const key = `${group.primary}:${group.opening}:${week}`;
    const members = stretches.get(key);
    if (members) members.push(group); else stretches.set(key, [group]);
  }
  replacements.clear(); consumed.clear();
  for (const members of stretches.values()) {
    if (members.reduce((count, group) => count + group.events.length, 0) < 6 || members.length < 2) continue;
    replacements.set(members[0]!.id, mergeGroups(members, notebook, rendering));
    for (const group of members.slice(1)) consumed.add(group.id);
  }
  return repeatedGroups.filter(group => !consumed.has(group.id)).map(group => replacements.get(group.id) ?? group);
}
/** Presentation range only: neither this nor expansion changes the notebook. */
export function journalRange(groups: readonly JournalGroup[], end = groups.length): readonly JournalGroup[] {
  const boundedEnd = Math.max(0, Math.min(groups.length, end));
  return groups.slice(Math.max(0, boundedEnd - JOURNAL_RANGE_SIZE), boundedEnd);
}
export function journalMemberLines(group: JournalGroup, notebook: LifeNotebook, context: { playerSoul: string; currentBody: number | null }, start = 0): { identity: StoryIdentity; tick: string; text: string }[] {
  const rendering = { ...context, dreams: notebook.dreams };
  return group.members.slice(start, start + JOURNAL_EXPANSION_SIZE).map(identity => {
    const record = identity.startsWith('e:') ? notebook.events[identity.slice(2)]! : notebook.chronicle[identity.slice(2)]!;
    const text = identity.startsWith('e:') ? renderStoryEvent(record as StoryEvent, notebook.actors, rendering) : renderStoryChronicle(record as StoryChronicle, notebook.actors, rendering);
    return { identity, tick: record.tick, text };
  });
}
