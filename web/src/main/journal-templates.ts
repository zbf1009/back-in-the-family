import type { ActorContext, DreamFact, SocialKind, StoryActor, StoryBatch, StoryChronicle, StoryEvent } from '../shared/story.ts';
import { dateLabel, formatAmount, formatMoney } from './calendar.ts';
import { DREAM_INTENT_TEXT, dreamResponseLabel, kinshipNoun, SKIP_LABELS } from './player-copy.ts';
import { CHOICE_RESULT_TEXT, CHOICE_SOURCE_TEXT, supportedText } from './technical-text.ts';
import type { LifePhase } from './life-context.ts';

export type JournalActors = Pick<ReadonlyMap<number, StoryActor>, 'get'>;
export interface JournalContext {
  playerSoul: string;
  currentBody: number | null;
  dreams?: Pick<ReadonlyMap<string, DreamFact>, 'get'>;
  formerBodies?: Pick<ReadonlyMap<number, LifePhase>, 'get'>;
  actorContext?: readonly ActorContext[];
}
export type SocialBand = 'low' | 'medium' | 'high';
export interface TemplateFrame {
  id: string;
  kind: StoryEvent['kind']['type'];
  socialKind?: SocialKind;
  band?: SocialBand;
  requiredTag?: number;
  variant: number;
}
const EVENT_TYPES: StoryEvent['kind']['type'][] = ['birth', 'death', 'marriage', 'loan', 'repayment', 'debt_transfer', 'debt_forgiven', 'inheritance', 'possession', 'rebuild', 'offering', 'bribe_offering', 'dream', 'haunting', 'appeal', 'social'];
const SOCIAL_TYPES: SocialKind[] = ['help', 'gift', 'quarrel', 'insult', 'theft', 'apology'];
const BANDS: SocialBand[] = ['low', 'medium', 'high'];
/** Fixed order is part of replay-stable presentation, not simulation state. */
export const TEMPLATE_FRAMES: readonly TemplateFrame[] = EVENT_TYPES.flatMap((kind): TemplateFrame[] => {
  if (kind === 'social') return SOCIAL_TYPES.flatMap(socialKind => BANDS.flatMap(band => [0, 1, 2].map(variant => ({ id: `social.${socialKind}.${band}.${variant}`, kind, socialKind, band, variant }))));
  const general = [0, 1, 2].map(variant => ({ id: `${kind}.${variant}`, kind, variant }));
  return [...general, { id: `${kind}.public`, kind, variant: 1, requiredTag: 1 }, { id: `${kind}.witnessed`, kind, variant: 2, requiredTag: 4 }, { id: `${kind}.deathbed`, kind, variant: 0, requiredTag: 4096 }];
});
export const CHRONICLE_FRAMES = [
  { id: 'chronicle.0', variant: 0 }, { id: 'chronicle.1', variant: 1 }, { id: 'chronicle.2', variant: 2 },
] as const;
export function socialBand(intensity: number): SocialBand {
  return intensity <= 33 ? 'low' : intensity <= 66 ? 'medium' : 'high';
}
export function frameEligible(frame: TemplateFrame, event: StoryEvent): boolean {
  if (frame.kind !== event.kind.type || (frame.requiredTag !== undefined && (event.tags & frame.requiredTag) === 0)) return false;
  return event.kind.type !== 'social' || (frame.socialKind === event.kind.kind && frame.band === socialBand(event.kind.intensity));
}
function cap(text: string): string { return text.charAt(0).toUpperCase() + text.slice(1); }
function chosenContext(contexts: readonly ActorContext[], context: JournalContext): ActorContext | undefined {
  const relevant = contexts.filter(candidate => candidate.relativeTo === context.currentBody);
  const matching = relevant.filter(candidate => candidate.actors.some(actor => actor.person === candidate.relativeTo));
  return matching.find(candidate => candidate.basis === 'observed-day-end')
    ?? matching.find(candidate => candidate.basis === 'observed-day-start')
    ?? matching.find(candidate => candidate.basis === 'opening-current')
    ?? relevant.find(candidate => candidate.basis === 'observed-day-end')
    ?? relevant.find(candidate => candidate.basis === 'observed-day-start')
    ?? relevant.find(candidate => candidate.basis === 'opening-current');
}
export function storyPerson(person: number, actors: JournalActors, context: JournalContext, contexts: readonly ActorContext[]): string {
  const actor = actors.get(person);
  const name = actor?.name.trim() ? actor.name : 'someone';
  const focus = chosenContext(contexts, context);
  if (person === context.currentBody && contexts.some(candidate => candidate.relativeTo === person)) return 'you';
  const former = context.formerBodies?.get(person);
  if (person !== context.currentBody && former?.name?.trim()) return `your former self ${former.name}`;
  const kinRole = focus?.actors.find(candidate => candidate.person === person)?.kinRole;
  if (!kinRole || !focus) return name;
  const first = actor?.name.trim().split(/\s+/)[0];
  return first ? `your ${kinshipNoun(kinRole, actor?.sex)} ${first}` : name;
}
function possessive(text: string): string {
  if (text === 'you') return 'your';
  return `${text}'s`;
}
function socialSentence(event: StoryEvent & { kind: Extract<StoryEvent['kind'], { type: 'social' }> }, p: (id: number) => string, variant: number): string {
  const { doer, target, kind, intensity } = event.kind;
  const a = p(doer), b = p(target), A = cap(a), B = cap(b), band = socialBand(intensity);
  switch (kind) {
    case 'help': return ({
      low: [`${A} gave ${b} a hand. A small one.`, `${A} did ${b} a small favor.`, `${A} pitched in for ${b}, briefly.`],
      medium: [`${A} helped ${b} out.`, `${A} did ${b} a good turn.`, `${A} lent ${b} a hand.`],
      high: [`${A} came through for ${b} in a big way.`, `${A} did ${b} a favor. A big one.`, `${A} went well out of the way to help ${b}.`],
    })[band][variant]!;
    case 'gift': return ({
      low: [`${A} gave ${b} a little something.`, `${A} gave ${b} a small gift.`, `${A} handed ${b} a token of something.`],
      medium: [`${A} gave ${b} a gift.`, `${A} gave ${b} a present, no occasion given.`, `${B} got a gift from ${a}.`],
      high: [`${A} gave ${b} a gift, and not a small one.`, `${A} gave ${b} a handsome gift.`, `${A} went all out on a gift for ${b}.`],
    })[band][variant]!;
    case 'quarrel': return ({
      low: [`${A} and ${b} had words. Short ones.`, `${A} bickered with ${b}.`, `${A} and ${b} disagreed about something.`],
      medium: [`${A} and ${b} had an argument.`, `${A} picked a quarrel with ${b}.`, `${A} and ${b} had a frank exchange of views.`],
      high: [`${A} and ${b} had it out.`, `${A} and ${b} had a quarrel. Not a small one.`, `${A} went at it with ${b}.`],
    })[band][variant]!;
    case 'insult': return ({
      low: [`${A} made a remark to ${b}. It was not a compliment.`, `${A} got a little short with ${b}.`, `${A} needled ${b}.`],
      medium: [`${A} insulted ${b}.`, `${A} told ${b} a thing or two.`, `${A} had some choice words for ${b}.`],
      high: [`${A} insulted ${b}, thoroughly.`, `${A} tore into ${b}.`, `${A} let ${b} have it.`],
    })[band][variant]!;
    case 'theft': return ({
      low: [`${A} swiped something of ${possessive(b)}.`, `${A} lifted a little something from ${b}.`, `${A} stole from ${b}, in a small way.`],
      medium: [`${A} stole from ${b}.`, `${A} took something of ${possessive(b)}. Did not ask.`, `${B} had something stolen. ${A} did it.`],
      high: [`${A} stole from ${b}, and not a little.`, `${A} robbed ${b}.`, `${A} stole from ${b}. This was not petty.`],
    })[band][variant]!;
    case 'apology': return ({
      low: [`${A} offered ${b} a brief apology.`, `${A} told ${b} sorry.`, `${A} apologized to ${b}, a little.`],
      medium: [`${A} apologized to ${b}.`, `${A} said sorry to ${b}.`, `${A} made ${b} an apology.`],
      high: [`${A} apologized to ${b}, at length.`, `${A} apologized to ${b}. Thoroughly.`, `${A} made ${b} a full apology.`],
    })[band][variant]!;
  }
}
function eventSentence(event: StoryEvent, actors: JournalActors, context: JournalContext, variant: number): string {
  const p = (id: number) => storyPerson(id, actors, context, context.actorContext ?? event.actorContext);
  const k = event.kind;
  switch (k.type) {
    case 'birth': {
      const person = p(k.person);
      if (person === 'you') return 'You were born. Again.';
      if (person.startsWith('your ') && !person.startsWith('your former self ')) return `${cap(person)} was born.`;
      return [`Born: ${person}. The town is up one.`, `${cap(person)} was born. Welcome to town. You'll be staying.`, `A birth: ${person}. Arrived the usual way.`][variant]!;
    }
    case 'death': {
      const person = p(k.person), age = actors.get(k.person)?.ageAtDeath;
      const n = age === undefined ? undefined : formatAmount(age);
      if (person === 'you') return n === undefined ? '' : `You died at ${n}. Please hold for the Underworld.`;
      if (person.startsWith('your ') && !person.startsWith('your former self ')) return `${cap(person)} died.${n === undefined ? '' : ` ${n} years old.`}`;
      return [`${cap(person)} died${n === undefined ? '' : ` at ${n}`}. The Underworld has been notified; it usually is.`, `Died: ${person}${n === undefined ? '' : `, ${n}`}. Change of address pending.`, `${cap(person)} died${n === undefined ? '' : ` at ${n}`}. The town is down one, for now.`][variant]!;
    }
    case 'marriage': {
      const a = p(k.a), b = p(k.b);
      if (a === 'you' || b === 'you') return `You married ${a === 'you' ? b : a}.`;
      return [`Married: ${a} and ${b}. Till death, and in this town possibly after.`, `${cap(a)} married ${b}.`, `${cap(a)} and ${b} got married. Vows here run longer than most.`][variant]!;
    }
    case 'loan': return [`${cap(p(k.lender))} lent ${p(k.borrower)} ${formatMoney(k.amount)}, due ${dateLabel(k.due)}.`, `${cap(p(k.borrower))} borrowed ${formatMoney(k.amount)} from ${p(k.lender)}. Due ${dateLabel(k.due)}; the calendar has been informed.`, `${cap(p(k.lender))} lent ${p(k.borrower)} ${formatMoney(k.amount)}. It comes due ${dateLabel(k.due)}.`][variant]!;
    case 'repayment': return [`${cap(p(k.payer))} paid ${p(k.payee)} back ${formatMoney(k.amount)}.`, `${cap(p(k.payer))} repaid ${p(k.payee)} ${formatMoney(k.amount)}.`, `${cap(p(k.payee))} got ${formatMoney(k.amount)} back from ${p(k.payer)}.`][variant]!;
    case 'debt_transfer': return `${cap(p(k.to))} took on ${possessive(p(k.from))} ${formatMoney(k.amount)} debt.`;
    case 'debt_forgiven': return [`${cap(p(k.creditor))} forgave ${possessive(p(k.debtor))} ${formatMoney(k.amount)} debt.`, `${cap(p(k.creditor))} let ${p(k.debtor)} off the hook for ${formatMoney(k.amount)}.`, `${cap(p(k.creditor))} wrote off the ${formatMoney(k.amount)} ${p(k.debtor)} owed.`][variant]!;
    case 'inheritance': return [`${cap(p(k.heir))} inherited from ${p(k.deceased)}: a share valued at ${formatMoney(k.amount)}.`, `${cap(possessive(p(k.deceased)))} estate left ${p(k.heir)} a share valued at ${formatMoney(k.amount)}.`, `${cap(p(k.heir))} came into ${formatMoney(k.amount)} of ${possessive(p(k.deceased))} estate.`][variant]!;
    case 'possession':
    case 'rebuild': {
      const person = p(k.person), body = k.type === 'possession' ? 'borrowed body' : 'body built to order';
      if (person === 'you') return `You are back, in a ${body}. The Underworld charged ${formatAmount(k.price)} joss paper.`;
      return `A soul came back to town as ${person}, in a ${k.type === 'possession' ? 'borrowed' : 'rebuilt'} body.`;
    }
    case 'offering': {
      const sentence = [`${cap(p(k.offerer))} burned ${formatAmount(k.amount)} joss paper for ${p(k.ghost)}.`, `${cap(p(k.offerer))} sent ${p(k.ghost)} ${formatAmount(k.amount)} joss paper, by fire.`, `${cap(p(k.offerer))} made ${p(k.ghost)} an offering of ${formatAmount(k.amount)} joss paper.`][variant]!;
      return sentence + (BigInt(k.credited) === BigInt(k.amount) ? ' All of it arrived.' : BigInt(k.credited) === 0n ? ' None of it arrived; the Underworld has a yearly limit.' : ` ${formatAmount(k.credited)} of it arrived; the Underworld has a yearly limit.`);
    }
    case 'bribe_offering': return [`${cap(p(k.ghost))} put ${formatAmount(k.amount)} joss paper where the Magistrate would notice it.`, `${cap(p(k.ghost))} made the Magistrate a contribution of ${formatAmount(k.amount)} joss paper.`, `${cap(p(k.ghost))} paid ${formatAmount(k.amount)} joss paper toward the Magistrate's goodwill.`][variant]!;
    case 'dream': {
      const annotation = context.dreams?.get(event.id);
      const intent = annotation ? ` ${DREAM_INTENT_TEXT[annotation.intent]}` : '';
      const sentence = `${cap(p(k.ghost))} sent ${p(k.dreamer)} a dream${intent}. Postage: ${formatAmount(k.price)} joss paper.`;
      const reply = annotation?.interpretation ? supportedText(dreamResponseLabel(annotation.interpretation.applied), { B: cap(p(k.dreamer)) }) : null;
      return sentence + (reply ? ` ${reply}` : '');
    }
    case 'haunting': return [`${cap(p(k.ghost))} haunted ${p(k.target)}. Fee: ${formatAmount(k.price)} joss paper.`, `${cap(p(k.ghost))} paid ${p(k.target)} a visit of the unwelcome kind. Fee: ${formatAmount(k.price)} joss paper.`, `${cap(p(k.ghost))} made ${possessive(p(k.ghost))} presence known to ${p(k.target)}. Fee: ${formatAmount(k.price)} joss paper.`][variant]!;
    case 'appeal': return [`${cap(p(k.ghost))} put ${possessive(p(k.ghost))} case to the Magistrate.`, `${cap(possessive(p(k.ghost)))} case reached the Magistrate's desk.`, `${cap(p(k.ghost))} asked the Magistrate to take another look.`][variant]!;
    case 'social': return socialSentence({ ...event, kind: k }, p, variant);
  }
}
export function renderEventFrame(frame: TemplateFrame, event: StoryEvent, actors: JournalActors, context: JournalContext): string | undefined {
  if (!frameEligible(frame, event)) return undefined;
  return eventSentence(event, actors, context, frame.variant);
}
export function renderAllEventFrames(event: StoryEvent, actors: JournalActors, context: JournalContext): { frame: TemplateFrame; eligible: boolean; text?: string }[] {
  return TEMPLATE_FRAMES.filter(frame => frame.kind === event.kind.type && (event.kind.type !== 'social' || frame.socialKind === event.kind.kind)).map(frame => {
    const text = renderEventFrame(frame, event, actors, context);
    return { frame, eligible: text !== undefined, ...(text === undefined ? {} : { text }) };
  });
}
export function renderStoryEvent(event: StoryEvent, actors: JournalActors, context: JournalContext): string {
  const eligible = TEMPLATE_FRAMES.filter(frame => frameEligible(frame, event));
  const frame = eligible[Number(BigInt(event.id) % BigInt(eligible.length))]!;
  return renderEventFrame(frame, event, actors, context)!;
}
export function renderChronicleFrame(_variant: 0 | 1 | 2, record: StoryChronicle, actors: JournalActors, context: JournalContext): string {
  const p = (id: number | undefined) => id === undefined ? undefined : storyPerson(id, actors, context, context.actorContext ?? record.actorContext);
  const deceased = p(record.stakes.who[0]);
  const other = p(record.stakes.who.find(person => person !== context.currentBody));
  const sentence = supportedText(CHOICE_RESULT_TEXT[record.applied], { "d's": deceased === undefined ? undefined : possessive(deceased), m: p(record.stakes.who[1]), o: other, "o's": other === undefined ? undefined : possessive(other) });
  const source = CHOICE_SOURCE_TEXT[record.source];
  const lead = typeof source === 'string' ? source : source[Number(BigInt(record.index) % BigInt(source.length))]!;
  const absent = record.chooserAbsent ? CHOICE_SOURCE_TEXT.absent : '';
  const skipped = record.skipped.map(part => supportedText(CHOICE_SOURCE_TEXT.skipped, { reason: SKIP_LABELS[part.reason] }) ?? '').join('');
  return (sentence ? lead + sentence : '') + absent + skipped;
}
export function renderStoryChronicle(record: StoryChronicle, actors: JournalActors, context: JournalContext): string {
  return renderChronicleFrame(Number(BigInt(record.index) % 3n) as 0 | 1 | 2, record, actors, context);
}
export interface CorpusFrame {
  frame: TemplateFrame;
  eventId?: string;
  tick?: string;
  text?: string;
  absent?: 'no matching actual seed1205 fact';
}
/** The runner supplies native batches; absent variants are reported, never demonstrated with invented inputs. */
export function renderTemplateCorpus(batches: readonly StoryBatch[], context: { playerSoul: string; currentBody: number | null }): {
  events: CorpusFrame[];
  chronicle: { frameId: string; index: string; source: StoryChronicle['source']; chooserAbsent: boolean; skipped: StoryChronicle['skipped']; text: string }[];
} {
  const actors = new Map<number, StoryActor>();
  const dreams = new Map<string, DreamFact>();
  const events = batches.flatMap(batch => batch.events);
  for (const batch of batches) {
    for (const actor of batch.actors) actors.set(actor.person, { ...actors.get(actor.person), ...actor });
    for (const dream of batch.dreams) dreams.set(dream.eventId, dream);
  }
  const rendering = { ...context, dreams };
  return {
    events: TEMPLATE_FRAMES.map(frame => {
      const event = events.find(candidate => frameEligible(frame, candidate));
      return event ? { frame, eventId: event.id, tick: event.tick, text: renderEventFrame(frame, event, actors, rendering)! } : { frame, absent: 'no matching actual seed1205 fact' };
    }),
    chronicle: batches.flatMap(batch => batch.chronicle).flatMap(record => CHRONICLE_FRAMES.map(frame => ({ frameId: frame.id, index: record.index, source: record.source, chooserAbsent: record.chooserAbsent, skipped: record.skipped, text: renderChronicleFrame(frame.variant, record, actors, rendering) }))),
  };
}
