import type { Origin, PlayerFamily, PlayerLifecycleFact, PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
import type { DreamFact, StoryActor, StoryEvent } from '../shared/story.ts';
import type { JournalActors } from './journal-templates.ts';
import { resolveVisualKey, type LifeTile, type Tint, type VisualKey } from '../art/sprites.ts';
import { dreamIntentLabel, dreamResponseLabel, familyLabel, nameLabel, originLabel } from './player-copy.ts';
import { dateLabel, formatAmount, formatMoney } from './calendar.ts';

export interface PicturePerson {
  id: number;
  name: string;
  age: number | null;
  origin: Origin | 'official' | null;
  lifeStatus: 'alive' | 'deceased' | 'unknown';
  soul: boolean;
  visual: VisualKey;
  tint: Tint;
}

export interface SceneDocument {
  title: string;
  name?: string;
  fields: { label: string; value: string; role?: 'response' }[];
  note?: string;
}
export type SceneSource = { kind: 'event'; eventId: string } | { kind: 'node'; nodeId: string }
  | { kind: 'dream-resolution'; tick: string; dreamer: number; applied: NonNullable<WorldSnapshot['last_dream']>['applied'] };

export interface KeySceneView {
  identity: readonly [number, string] | readonly [number, string, string];
  category: PlayerFamily | 'death' | 'rebirth' | 'dream';
  node: PlayerNode | null;
  lifecycle: PlayerLifecycleFact | null;
  world: WorldSnapshot;
  title: string;
  lines: string[];
  people: PicturePerson[];
  props: LifeTile[];
  focal: { kind: 'person' | 'prop'; id: number | LifeTile };
  date: string;
  certificate?: { name: string; date: string; age?: string };
  source: SceneSource;
  document: SceneDocument;
  dream?: DreamFact;
  dreamResolution?: NonNullable<WorldSnapshot['last_dream']>;
  arrivalPrice?: string;
}

/** Current residents and retained references remain separate from historical ages. */
export function picturePeople(world: WorldSnapshot, ids: readonly number[], node: PlayerNode | null,
  actors?: JournalActors): PicturePerson[] {
  return [...new Set(ids)].map(id => {
    const person = world.residents.find(person => person.id === id)
      ?? (world.magistrate.id === id ? world.magistrate : undefined);
    const earlier = world.player.earlier_bodies.find(body => body.id === id);
    const retainedName = world.person_names.find(person => person.id === id);
    const actor = actors?.get(id);
    return {
      id, name: nameLabel(person?.name ?? earlier?.name ?? retainedName?.name ?? actor?.name),
      age: person?.age ?? null, origin: person?.origin ?? earlier?.origin ?? actor?.origin ?? null,
      lifeStatus: earlier !== undefined || retainedName !== undefined || person?.alive === false ? 'deceased'
        : person?.alive === true ? 'alive' : 'unknown',
      soul: world.player.place === 'body' && world.player.body === id,
      visual: resolveVisualKey(id, person?.age ?? null),
      tint: (world.player.body === id ? 'self' : node?.options.some(option => option.preview.some(preview => preview.person === id))
        ? 'affected' : world.player.blood_ties.some(tie => tie.person === id) ? 'kin'
          : world.player.past_life_ties.some(tie => tie.rememberer === id) ? 'rememberer' : 'neutral') as Tint,
    };
  });
}

export function nodeKeyScene(worldId: number, world: WorldSnapshot, node: PlayerNode,
  actors?: JournalActors): KeySceneView {
  const chooser = world.player.body;
  const ids = node.family === 'family_death' || chooser === null ? node.stakes.who : [chooser, ...node.stakes.who];
  const people = picturePeople(world, ids, node, actors);
  const named = (id: number | undefined) => people.find(person => person.id === id)?.name ?? nameLabel(undefined);
  const other = named(node.stakes.who[0]);
  const title = familyLabel(node.family);
  const document: SceneDocument = { title, fields: [{ label: 'Answer available', value: dateLabel(node.choice_tick) }] };
  let lines: string[];
  let props: LifeTile[];
  switch (node.family) {
    case 'family_death':
      document.title = 'A family memorial';
      document.name = other;
      document.fields.push({ label: 'People involved', value: node.stakes.who.slice(1).map(named).join(', ') || nameLabel(undefined) });
      lines = [`${other} has died. ${node.stakes.who.slice(1).map(named).join(', ') || nameLabel(undefined)} is named in the choice.`, 'You can offer comfort, send flowers or keep your distance when those answers are listed below.'];
      props = ['coffin', 'candle'];
      break;
    case 'inheritance':
      document.title = 'Inheritance papers';
      document.name = other;
      document.fields.push({ label: 'Listed inheritance', value: formatMoney(node.stakes.amount) });
      lines = [`An inheritance from ${other} brings a decision for you. The choice lists ${formatMoney(node.stakes.amount)}.`, 'Keep the inheritance or consider the other answers on file. Possible effects are listed below, not stamped as completed.'];
      props = ['will', 'table'];
      break;
    case 'debt_due': {
      const borrower = node.options.some(option => option.id === 'repay_now');
      document.title = 'Debt notice';
      document.name = other;
      document.fields.push({ label: 'Debt listed', value: formatMoney(node.stakes.amount) }, { label: 'Due', value: dateLabel(node.stakes.by) });
      lines = [borrower ? `Your debt to ${other} is coming due.` : `${other}'s debt to you is coming due.`,
        `The notice lists ${formatMoney(node.stakes.amount)}, due ${dateLabel(node.stakes.by)}. Your available answers are below.`];
      props = ['register', 'seal'];
      break;
    }
    case 'feud':
      document.title = 'A quarrel';
      document.name = other;
      lines = [`A quarrel involving you and ${other} needs an answer.`, 'Apologize, retaliate or let it go when listed below. The decision does not yet tell us what happened afterward.'];
      props = ['affected_marker'];
      break;
    case 'life_stage': {
      const person = people.find(person => person.id === chooser);
      document.title = node.options.some(option => option.id === 'ask_for_a_toy') ? 'A childhood page'
        : node.options.some(option => option.id === 'stand_up_to_bully') ? 'A school-age page' : 'An adult-life page';
      document.name = person?.name ?? nameLabel(undefined);
      if (person?.age !== null && person?.age !== undefined) document.fields.push({ label: 'Current age', value: formatAmount(String(person.age)) });
      lines = [`A new life-stage choice is available for ${document.name}.`, 'The next page is yours to answer. A possible job or personality change is not a completed result.'];
      props = ['register'];
      break;
    }
  }
  document.note = 'Choose an answer below';
  return { identity: [worldId, world.player_soul, node.id], source: { kind: 'node', nodeId: node.id }, category: node.family,
    node, lifecycle: null, world, title, date: node.fired, lines, people, props, document,
    focal: { kind: 'prop', id: props[0]! } };
}

/** Signed native birth day at the recorded event day, never a later World age. */
function actorAgeAtTick(actor: StoryActor | undefined, tick: string): bigint | null {
  if (actor?.birthDay === undefined) return null;
  const elapsed = BigInt(tick) - BigInt(actor.birthDay);
  return elapsed >= 0n ? elapsed / 365n : null;
}

/** The exact event body supplies the certificate; latest identity stays outside history. */
export function lifecycleKeyScene(worldId: number, world: WorldSnapshot, fact: PlayerLifecycleFact,
  actors?: JournalActors, events: readonly StoryEvent[] = []): KeySceneView {
  const death = fact.kind === 'death';
  const actor = actors?.get(fact.body);
  const ageAtDeath = death ? actor?.ageAtDeath : undefined;
  const arrival = fact.kind === 'possession' || fact.kind === 'rebuild';
  const ageAtArrival = arrival ? actorAgeAtTick(actor, fact.tick) : null;
  const knownAge = ageAtDeath === undefined ? ageAtArrival : BigInt(ageAtDeath);
  const numericAge = knownAge !== null && knownAge <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(knownAge) : null;
  const age = fact.kind === 'birth' ? 0 : numericAge;
  const visualAge = arrival && age !== null && age < 3 ? null : age;
  const name = nameLabel(fact.name);
  const people = picturePeople(world, [fact.body], null, actors).map(person => ({
    ...person, name, origin: fact.origin, age, visual: resolveVisualKey(person.id, visualAge), soul: false,
    lifeStatus: death ? 'deceased' as const : person.lifeStatus,
  }));
  const props: LifeTile[] = death ? ['coffin', 'candle'] : fact.kind === 'birth' ? ['cradle'] : ['register', 'seal'];
  const date = dateLabel(fact.tick);
  const frames = death ? [
    `${name}'s life ended ${date}${ageAtDeath === undefined ? '' : `, at age ${formatAmount(ageAtDeath)}`}.`,
    `${date} marks the death of ${name}${ageAtDeath === undefined ? '' : `, aged ${formatAmount(ageAtDeath)}`}.`,
    `${name} died ${date}${ageAtDeath === undefined ? '' : ` at age ${formatAmount(ageAtDeath)}`}.`,
  ] : [];
  const arrivalEvent = events.find(event => event.id === fact.event && event.kind.type === fact.kind
    && (event.kind.type === 'possession' || event.kind.type === 'rebuild') && event.kind.person === fact.body);
  const price = arrivalEvent !== undefined && (arrivalEvent.kind.type === 'possession' || arrivalEvent.kind.type === 'rebuild') ? arrivalEvent.kind.price : undefined;
  const lines = death ? [frames[Number(BigInt(fact.event) % BigInt(frames.length))]!,
    'Death is a change of address, not an exit. The Underworld has a desk for the next chapter.']
    : fact.kind === 'birth' ? [`${name} was born ${date}. A newborn life begins.`, 'A new family page opens. A former life does not mean this family recognizes the returning soul.']
      : [`${name} arrived ${date}. ${originLabel(fact.origin)}.`,
        `${price === undefined ? '' : `The recorded price is ${formatAmount(price)} joss paper. `}This is an arrival, not a biological birth.`];
  const document: SceneDocument = { title: death ? 'Death certificate' : fact.kind === 'birth' ? 'Birth certificate'
    : fact.kind === 'possession' ? 'Borrowed-body permit' : 'Rebuilt-body receipt', name,
    fields: [{ label: death ? 'Life ended' : fact.kind === 'birth' ? 'Born' : 'Arrived', value: date }],
    note: death ? 'Underworld paper bureau' : fact.kind === 'birth' ? 'A newborn life' : originLabel(fact.origin) };
  if (ageAtDeath !== undefined) document.fields.push({ label: 'Age', value: formatAmount(ageAtDeath) });
  if (ageAtArrival !== null) document.fields.push({ label: 'Age at arrival', value: formatAmount(ageAtArrival.toString()) });
  if (price !== undefined) document.fields.push({ label: 'Joss paper spent', value: formatAmount(price) });
  if (fact.kind === 'birth' && world.player.body === fact.body && BigInt(world.tick) <= BigInt(fact.tick) + 1n) {
    const parents = world.player.blood_ties.filter(tie => tie.kinship.includes('parent')).map(tie =>
      nameLabel(world.residents.find(person => person.id === tie.person)?.name ?? actors?.get(tie.person)?.name));
    if (parents.length > 0) {
      document.fields.push({ label: 'Parents on file', value: parents.join(', ') });
      lines.push(`The parent files name ${parents.join(', ')} as of ${dateLabel(world.tick)}.`);
    }
  }
  return {
    identity: [worldId, fact.event], source: { kind: 'event', eventId: fact.event }, category: death ? 'death' : 'rebirth', node: null, lifecycle: fact, world,
    title: death ? 'Your life ended' : 'A new life began', date: fact.tick, lines, document,
    ...(death ? { certificate: { name, date: fact.tick, ...(ageAtDeath === undefined ? {} : { age: ageAtDeath }) } } : {}),
    ...(price === undefined ? {} : { arrivalPrice: price }),
    people, props, focal: { kind: 'prop', id: death ? 'candle' : fact.kind === 'birth' ? 'cradle' : 'seal' },
  };
}

/** Exact successful input annotation, not a guess from the most recent response. */
export function dreamKeyScene(worldId: number, world: WorldSnapshot, fact: DreamFact,
  actors?: JournalActors): KeySceneView {
  const people = picturePeople(world, [fact.ghost, fact.dreamer], null, actors).map(person => {
    const actor = actors?.get(person.id);
    let knownAge: bigint | null = null;
    if (person.id === fact.ghost && actor?.ageAtDeath !== undefined) knownAge = BigInt(actor.ageAtDeath);
    else if (person.id === fact.dreamer) knownAge = actorAgeAtTick(actor, fact.tick);
    const age = knownAge !== null && knownAge <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(knownAge) : null;
    return { ...person, age, visual: resolveVisualKey(person.id, age), soul: actor?.soulId === world.player_soul };
  });
  const recipient = people.find(person => person.id === fact.dreamer)?.name ?? nameLabel(undefined);
  const ghost = people.find(person => person.id === fact.ghost)?.name ?? nameLabel(undefined);
  const sender = actors?.get(fact.ghost)?.soulId === world.player_soul ? 'You' : ghost;
  const response = fact.interpretation === undefined ? 'No response recorded' : dreamResponseLabel(fact.interpretation.applied);
  const fields: SceneDocument['fields'] = [{ label: 'Sent', value: dateLabel(fact.tick) }, { label: 'Message', value: dreamIntentLabel(fact.intent) },
    { label: 'Joss paper spent', value: formatAmount(fact.price) }, { label: 'Recorded response', value: response, role: 'response' }];
  if (fact.interpretation?.tick !== undefined) fields.push({ label: 'Answered', value: dateLabel(fact.interpretation.tick) });
  return { identity: [worldId, fact.eventId], source: { kind: 'event', eventId: fact.eventId }, category: 'dream',
    node: null, lifecycle: null, dream: fact, world, title: 'A dream message', date: fact.tick, people,
    props: ['cloud', 'will'], focal: { kind: 'prop', id: 'will' }, document: { title: 'Dream message', name: recipient, fields },
    lines: [`${sender} sent a dream to ${recipient} ${dateLabel(fact.tick)}. Message: ${dreamIntentLabel(fact.intent)}. The recorded price is ${formatAmount(fact.price)} joss paper.`,
      `Recorded response: ${response}${fact.interpretation?.tick === undefined ? '' : `, ${dateLabel(fact.interpretation.tick)}`}. A response is not proof of belief, obedience or an offering.`] };
}

/** The permitted fallback contains only captured resolution facts and its own World. */
export function dreamResolutionKeyScene(worldId: number, world: WorldSnapshot,
  resolution: NonNullable<WorldSnapshot['last_dream']>): KeySceneView {
  const people = picturePeople(world, [resolution.dreamer], null).map(person => ({ ...person, age: null, visual: resolveVisualKey(person.id, null), soul: false }));
  const name = people[0]?.name ?? nameLabel(undefined);
  const response = dreamResponseLabel(resolution.applied);
  const lines = [`${name}'s dream was answered ${dateLabel(resolution.tick)}.`,
    `Recorded response: ${response}. This record does not contain the sender, message intent or price, and does not prove an effect.`];
  return { identity: [worldId, 'dream', resolution.tick], source: { kind: 'dream-resolution', tick: resolution.tick, dreamer: resolution.dreamer, applied: resolution.applied },
    category: 'dream', node: null, lifecycle: null, dreamResolution: { ...resolution }, world,
    title: 'A dream answered', date: resolution.tick, people, props: ['cloud', 'will'], focal: { kind: 'prop', id: 'will' }, lines,
    document: { title: 'Dream response', name, fields: [{ label: 'Answered', value: dateLabel(resolution.tick) }, { label: 'Recorded response', value: response, role: 'response' }] } };
}
