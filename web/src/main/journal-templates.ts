import type { ActorContext, DreamFact, SocialKind, StoryActor, StoryBatch, StoryChronicle, StoryEvent } from '../shared/story.ts';
import { dateLabel, formatAmount, formatMoney } from './calendar.ts';
import { dreamIntentLabel, dreamResponseLabel, familyLabel, kinshipLabel, nameLabel, optionLabel, SKIP_LABELS } from './player-copy.ts';

export type JournalActors = Pick<ReadonlyMap<number, StoryActor>, 'get'>;
export interface JournalContext {
  playerSoul: string;
  currentBody: number | null;
  dreams?: Pick<ReadonlyMap<string, DreamFact>, 'get'>;
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
function chosenContext(contexts: readonly ActorContext[], actors: JournalActors, context: JournalContext): ActorContext | undefined {
  const relevant = contexts.filter(candidate => actors.get(candidate.relativeTo)?.soulId === context.playerSoul);
  const matching = relevant.filter(candidate => candidate.actors.some(actor => actor.person === candidate.relativeTo));
  return matching.find(candidate => candidate.relativeTo === context.currentBody && candidate.basis === 'observed-day-end')
    ?? matching.find(candidate => candidate.basis === 'observed-day-end')
    ?? matching.find(candidate => candidate.basis === 'observed-day-start')
    ?? matching.find(candidate => candidate.basis === 'opening-current')
    ?? relevant.find(candidate => candidate.basis === 'observed-day-end')
    ?? relevant.find(candidate => candidate.basis === 'observed-day-start')
    ?? relevant.find(candidate => candidate.basis === 'opening-current');
}
function kinNoun(role: NonNullable<ActorContext['actors'][number]['kinRole']>, actor: StoryActor | undefined): string {
  if (actor) {
    switch (role) {
      case 'parent': return actor.sex === 'female' ? 'mother' : 'father';
      case 'child': return actor.sex === 'female' ? 'daughter' : 'son';
      case 'sibling': return actor.sex === 'female' ? 'sister' : 'brother';
      case 'grandparent': return actor.sex === 'female' ? 'grandmother' : 'grandfather';
      case 'grandchild': return actor.sex === 'female' ? 'granddaughter' : 'grandson';
    }
  }
  return kinshipLabel(role).toLowerCase();
}
export function storyPerson(person: number, actors: JournalActors, context: JournalContext, contexts: readonly ActorContext[]): string {
  const actor = actors.get(person);
  const name = nameLabel(actor?.name);
  const focus = chosenContext(contexts, actors, context);
  const ownContext = contexts.find(candidate => candidate.relativeTo === person && actor?.soulId === context.playerSoul);
  if (ownContext) return person === context.currentBody ? 'you' : `you (in your earlier life as ${name})`;
  const kinRole = focus?.actors.find(candidate => candidate.person === person)?.kinRole;
  if (!kinRole || !focus) return name;
  const historical = focus.relativeTo === context.currentBody ? '' : ` in your life as ${nameLabel(actors.get(focus.relativeTo)?.name)}`;
  const basis = focus.basis === 'opening-current' ? 'at the opening' : focus.basis === 'observed-day-start' ? "at the day's start" : 'at the time';
  return `your ${kinNoun(kinRole, actor)} ${name} (${basis}${historical})`;
}
function possessive(text: string): string {
  if (text === 'you') return 'your';
  if (text.startsWith('you (')) return `your ${text.slice(4)}`;
  return `${text}'s`;
}
function pastBe(text: string): string { return text === 'you' || text.startsWith('you (') ? 'were' : 'was'; }
function tagsText(event: StoryEvent): string {
  const clauses: string[] = [];
  if (event.tags & 1) clauses.push('It became public knowledge.');
  if (event.tags & 4) clauses.push('Someone witnessed it.');
  if (event.tags & 4096) clauses.push('It happened at a deathbed.');
  return clauses.length ? ` ${clauses.join(' ')}` : '';
}
function socialSentence(event: StoryEvent & { kind: Extract<StoryEvent['kind'], { type: 'social' }> }, p: (id: number) => string, variant: number): string {
  const { doer, target, kind, intensity } = event.kind;
  const a = p(doer), b = p(target), band = socialBand(intensity);
  const degree = band === 'low' ? 'a little' : band === 'medium' ? '' : 'a great deal';
  switch (kind) {
    case 'help': return [
      `${cap(a)} helped ${b}${degree ? ` ${degree}` : ''}. Help deserves a little space in the town paper, too.`,
      `${cap(b)} had ${band === 'low' ? 'a little help' : band === 'high' ? 'considerable help' : 'help'} from ${a}. The town is not entirely a collection of other people's problems.`,
      `${cap(a)} lent ${b} ${band === 'low' ? 'a little help' : band === 'high' ? 'considerable help' : 'a hand'}. A hand makes a better loan than a headache.`,
    ][variant]!;
    case 'gift': return [
      `${cap(a)} gave ${b} a gift${band === 'low' ? ', in a small gesture' : band === 'high' ? ', in a pronounced gesture' : ''}. The town is not exclusively a lending library.`,
      `A gift went from ${a} to ${b}${band === 'low' ? ' in a small gesture' : band === 'high' ? ' in a pronounced gesture' : ''}. Even this town has exchanges without a due date.`,
      `${cap(b)} received a gift from ${a}${band === 'low' ? ': a small gesture' : band === 'high' ? ': a pronounced gesture' : ''}. The debt column can sit this one out.`,
    ][variant]!;
    case 'quarrel': return [
      `${cap(a)} ${band === 'low' ? 'quarreled mildly' : band === 'high' ? 'quarreled fiercely' : 'quarreled'} with ${b}. Agreement will have to look elsewhere for its headline.`,
      `${cap(a)} and ${b} had ${band === 'low' ? 'a minor' : band === 'high' ? 'a fierce' : 'a'} quarrel. A small town has ample room for disagreement.`,
      `Between ${a} and ${b}, ${band === 'low' ? 'a small' : band === 'high' ? 'an intense' : 'a'} quarrel took place. Harmony does not get this headline.`,
    ][variant]!;
    case 'insult': return [
      `${cap(a)} ${band === 'low' ? 'mildly insulted' : band === 'high' ? 'harshly insulted' : 'insulted'} ${b}. The compliment column is an entirely different department.`,
      `${cap(b)} ${pastBe(b)} on the receiving end of ${band === 'low' ? 'a mild' : band === 'high' ? 'a harsh' : 'an'} insult from ${a}. Courtesy would file this under other business.`,
      `${cap(a)} directed ${band === 'low' ? 'a mild' : band === 'high' ? 'a harsh' : 'an'} insult at ${b}. Politeness is not the headline here.`,
    ][variant]!;
    case 'theft': return [
      `${band === 'low' ? 'A minor theft' : band === 'high' ? 'A pronounced theft' : 'Theft'}: ${a} stole from ${b}. The word “borrowed” is not doing any favors here.`,
      `${cap(a)} stole from ${b}${band === 'low' ? ' in a minor theft' : band === 'high' ? ' in a pronounced theft' : ''}. A theft does not become a loan by changing the heading.`,
      `${cap(b)} ${pastBe(b)} the target of ${band === 'low' ? 'a minor' : band === 'high' ? 'a pronounced' : 'a'} theft by ${a}. Taking is a poor substitute for asking.`,
    ][variant]!;
    case 'apology': return [
      `${cap(a)} ${band === 'low' ? 'apologized mildly' : band === 'high' ? 'apologized emphatically' : 'apologized'} to ${b}. An apology earns its own line in a small town.`,
      `${cap(b)} received ${band === 'low' ? 'a mild' : band === 'high' ? 'an emphatic' : 'an'} apology from ${a}. The town's vocabulary does extend beyond insults.`,
      `${cap(a)} offered ${b} ${band === 'low' ? 'a mild' : band === 'high' ? 'an emphatic' : 'an'} apology. The apology column is open for business.`,
    ][variant]!;
  }
}
function eventSentence(event: StoryEvent, actors: JournalActors, context: JournalContext, variant: number): string {
  const p = (id: number) => storyPerson(id, actors, context, event.actorContext);
  const k = event.kind;
  switch (k.type) {
    case 'birth': return [`${cap(p(k.person))} ${pastBe(p(k.person))} born. A new life has begun in town.`, `A new life begins with ${p(k.person)}, who ${pastBe(p(k.person))} born. The beginning deserves a whole line.`, `${cap(p(k.person))} entered the world by birth. The town's story has a new beginning.`][variant]!;
    case 'death': {
      const age = actors.get(k.person)?.ageAtDeath;
      const detail = age === undefined ? '' : ` at age ${formatAmount(age)}`;
      return [`${cap(p(k.person))} died${detail}. A life ends; its place in this town's story remains.`, `The town's death notices now include ${p(k.person)}, who died${detail}.`, `This life reached its last day: ${p(k.person)} died${detail}. The notebook keeps the name.`][variant]!;
    }
    case 'marriage': return [`${cap(p(k.a))} and ${p(k.b)} married. Two names share this headline.`, `${cap(p(k.a))} married ${p(k.b)}. The marriage column has another pair of names.`, `A marriage joins ${p(k.a)} and ${p(k.b)}. The town's story now has a joint entry.`][variant]!;
    case 'loan': return [`${cap(p(k.lender))} lent ${p(k.borrower)} ${formatMoney(k.amount)}, due ${dateLabel(k.due)}. The calendar has a long memory.`, `${cap(p(k.borrower))} borrowed ${formatMoney(k.amount)} from ${p(k.lender)}; repayment is due ${dateLabel(k.due)}. A loan puts the calendar to work.`, `${formatMoney(k.amount)} went on loan from ${p(k.lender)} to ${p(k.borrower)}. The due date is ${dateLabel(k.due)}—the calendar gets a say.`][variant]!;
    case 'repayment': return [`${cap(p(k.payer))} repaid ${formatMoney(k.amount)} to ${p(k.payee)}. This time, the money is coming back.`, `${cap(p(k.payee))} received a repayment of ${formatMoney(k.amount)} from ${p(k.payer)}. The debt has a payment to its name.`, `A payment toward debt: ${p(k.payer)} repaid ${p(k.payee)} ${formatMoney(k.amount)}. The repayment column is doing its job.`][variant]!;
    case 'debt_transfer': return [`${cap(p(k.to))} took over ${formatMoney(k.amount)} of ${possessive(p(k.from))} debt. The obligation has a new name attached.`, `${formatMoney(k.amount)} in debt passed from ${p(k.from)} to ${p(k.to)}. Debts, too, can change addresses.`, `${cap(p(k.from))} passed an obligation of ${formatMoney(k.amount)} to ${p(k.to)}. Even an obligation can find a new owner.`][variant]!;
    case 'debt_forgiven': return [`${cap(p(k.creditor))} forgave ${formatMoney(k.amount)} of ${possessive(p(k.debtor))} debt. A debt gets a shorter ending.`, `${formatMoney(k.amount)} of ${possessive(p(k.debtor))} debt was forgiven by ${p(k.creditor)}. The town's arithmetic occasionally knows when to stop.`, `${cap(p(k.debtor))} had ${formatMoney(k.amount)} in debt forgiven by ${p(k.creditor)}. Forgiven is a useful word for a debt.`][variant]!;
    case 'inheritance': return [`${cap(p(k.heir))} inherited an estate valued at ${formatMoney(k.amount)} from ${p(k.deceased)}. A life leaves more than one kind of entry behind.`, `${cap(p(k.deceased))} left ${p(k.heir)} an estate valued at ${formatMoney(k.amount)} by inheritance. The obituary and the arithmetic meet on this page.`, `An estate valued at ${formatMoney(k.amount)} passed from ${p(k.deceased)} to ${p(k.heir)} by inheritance. Some legacies come with a valuation.`][variant]!;
    case 'possession': return [`${cap(p(k.person))} arrived in a borrowed body, at a price of ${formatAmount(k.price)} joss paper. Death may be a change of address; bodies still come at a price.`, `A borrowed-body arrival brought ${p(k.person)} to town, with ${formatAmount(k.price)} joss paper spent. The Underworld's idea of a fresh start has familiar paperwork.`, `${cap(p(k.person))} came to town in a borrowed body. The price was ${formatAmount(k.price)} joss paper. A different body still belongs to the same small town.`][variant]!;
    case 'rebuild': return [`${cap(p(k.person))} arrived in a rebuilt body, for ${formatAmount(k.price)} joss paper. A fresh body is a rather thorough amendment.`, `A rebuilt-body arrival brought ${p(k.person)} to town, at a price of ${formatAmount(k.price)} joss paper. The Underworld takes new beginnings literally.`, `${cap(p(k.person))} arrived in a rebuilt body, with ${formatAmount(k.price)} joss paper spent. Some fresh starts are rebuilt from the ground up.`][variant]!;
    case 'offering': return [`${cap(p(k.offerer))} burned ${formatAmount(k.amount)} in joss paper for ${p(k.ghost)}; ${formatAmount(k.credited)} was credited. An offering has its own place in the town's story.`, `For ${p(k.ghost)}, ${p(k.offerer)} burned ${formatAmount(k.amount)} in joss paper. The credited amount was ${formatAmount(k.credited)}.`, `${cap(p(k.offerer))} made an offering for ${p(k.ghost)}, burning ${formatAmount(k.amount)} in joss paper. The credit came to ${formatAmount(k.credited)}.`][variant]!;
    case 'bribe_offering': return [`${cap(p(k.ghost))} spent ${formatAmount(k.amount)} joss paper on a bribe to ${p(k.magistrate)}. The Underworld's manners have a price tag.`, `A bribe to ${p(k.magistrate)} cost ${p(k.ghost)} ${formatAmount(k.amount)} joss paper. A payment gets its own line; a ruling gets its own say.`, `${cap(p(k.ghost))} paid ${p(k.magistrate)} a bribe of ${formatAmount(k.amount)} joss paper. The bureaucracy can be very particular about its courtesies.`][variant]!;
    case 'dream': {
      const annotation = context.dreams?.get(event.id);
      const intent = annotation ? ` Intended message: ${dreamIntentLabel(annotation.intent)}.` : ' The message intent is not on this page.';
      const response = annotation?.interpretation ? ` Recorded response: ${dreamResponseLabel(annotation.interpretation.applied)}. Its effects are a separate matter.` : ' No response is on file with this message.';
      const sentence = [`${cap(p(k.ghost))} sent ${p(k.dreamer)} a dream, spending ${formatAmount(k.price)} joss paper. Even dreams have expenses down here.`, `A dream went from ${p(k.ghost)} to ${p(k.dreamer)}, at a price of ${formatAmount(k.price)} joss paper. The Underworld puts a price on reaching out.`, `${cap(p(k.dreamer))} ${pastBe(p(k.dreamer))} sent a dream by ${p(k.ghost)}. Sending it cost ${formatAmount(k.price)} joss paper; correspondence takes unusual forms down here.`][variant]!;
      return sentence + intent + response;
    }
    case 'haunting': return [`${cap(p(k.ghost))} haunted ${p(k.target)}, spending ${formatAmount(k.price)} joss paper. Its strength was ${formatAmount(k.intensity)}; the petition takes a less conversational form.`, `A haunting from ${p(k.ghost)} targeted ${p(k.target)} at strength ${formatAmount(k.intensity)}. It cost ${formatAmount(k.price)} joss paper; subtlety has its own department.`, `${cap(p(k.target))} ${pastBe(p(k.target))} the target of ${possessive(p(k.ghost))} haunting. Its strength was ${formatAmount(k.intensity)}, and its price was ${formatAmount(k.price)} joss paper. The Underworld offers more than one way to get in touch.`][variant]!;
    case 'appeal': return [`${cap(p(k.ghost))} appealed to ${p(k.magistrate)}. Even down here, there is another line to write.`, `An appeal from ${p(k.ghost)} reached ${p(k.magistrate)}. The bureaucracy has room for another request.`, `${cap(p(k.ghost))} made an appeal to ${p(k.magistrate)}. Requests have a place in the Underworld's paperwork; answers have another.`][variant]!;
    case 'social': return socialSentence({ ...event, kind: k }, p, variant);
  }
}
export function renderEventFrame(frame: TemplateFrame, event: StoryEvent, actors: JournalActors, context: JournalContext): string | undefined {
  if (!frameEligible(frame, event)) return undefined;
  return eventSentence(event, actors, context, frame.variant) + tagsText(event);
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
/** One factual sentence for the quiet-town teaser; complete accounts remain in the notebook. */
export function renderTownPromotion(event: StoryEvent, actors: JournalActors, context: JournalContext): string {
  const sentence = renderStoryEvent(event, actors, context);
  const boundary = sentence.indexOf('. ');
  return boundary < 0 ? sentence : sentence.slice(0, boundary + 1);
}
export function renderChronicleFrame(variant: 0 | 1 | 2, record: StoryChronicle, actors: JournalActors, context: JournalContext): string {
  const participants = record.stakes.who.map(person => storyPerson(person, actors, context, record.actorContext));
  const situation = familyLabel(record.family).toLowerCase();
  const choice = optionLabel(record.applied);
  const source = record.source === 'external' ? 'The choice on file' : record.source === 'rules_default' ? 'The default answer' : 'The automatic answer';
  const lead = [
    `${source} for ${situation} was “${choice}.”`,
    `For ${situation}, “${choice}” was recorded${record.source === 'rules_default' ? ' as the default answer' : record.source === 'auto_resolved' ? ' automatically' : ' as the choice on file'}.`,
    `${cap(situation)}: ${source.toLowerCase()} was “${choice}.” One answer on the page, with its actual results below.`,
  ][variant]!;
  const who = participants.length ? ` This concerned ${participants.join(' and ')}.` : '';
  const absent = record.chooserAbsent ? ' The chooser was absent when it was resolved.' : '';
  const skipped = record.skipped.map(part => ` One part was skipped: ${SKIP_LABELS[part.reason].replace(/[.!]$/, '')}.`).join('');
  const noEvents = record.appended.length === 0 ? ' No linked event was appended; this alone does not say whether other parts applied.' : '';
  return lead + who + absent + skipped + noEvents;
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
