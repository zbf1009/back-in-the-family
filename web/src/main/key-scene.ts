import type { Origin, PlayerFamily, PlayerLifecycleFact, PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
import type { DreamFact, StoryActor, StoryEvent } from '../shared/story.ts';
import type { JournalActors } from './journal-templates.ts';
import { resolveVisualKey, type LifeTile, type Tint, type VisualKey } from '../art/sprites.ts';
import { DREAM_INTENT_TEXT, dreamResponseLabel, familyLabel, nameLabel } from './player-copy.ts';
import { dateLabel, formatAmount, formatMoney } from './calendar.ts';
import { CHOICE_DOCUMENT_TEXT, CHOICE_SCENE_TEXT, LIFE_SCENE_TEXT, supportedText } from './technical-text.ts';

export interface PicturePerson {
  id: number;
  name: string;
  age: number | null;
  sex?: 'female' | 'male';
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
  memorial?: true;
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
    const retainedAge = actor?.ageAtDeath === undefined ? null : BigInt(actor.ageAtDeath);
    const eventAge = node === null ? null : actorAgeAtTick(actor, node.fired);
    const recordedAge = node === null && person !== undefined ? null : eventAge ?? retainedAge;
    const age = recordedAge === null ? person?.age ?? null
      : recordedAge >= 0n && recordedAge <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(recordedAge) : null;
    return {
      id, name: nameLabel(person?.name ?? earlier?.name ?? retainedName?.name ?? actor?.name),
      age, sex: person?.sex ?? actor?.sex, origin: person?.origin ?? earlier?.origin ?? actor?.origin ?? null,
      lifeStatus: earlier !== undefined || retainedName !== undefined || person?.alive === false ? 'deceased'
        : person?.alive === true ? 'alive' : 'unknown',
      soul: world.player.place === 'body' && world.player.body === id,
      visual: resolveVisualKey(id, age),
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
  const named = (id: number | undefined): string | undefined => id === undefined ? undefined
    : world.residents.find(person => person.id === id)?.name
      ?? world.person_names.find(person => person.id === id)?.name ?? actors?.get(id)?.name;
  const capitalized = (name: string | undefined) => name === undefined ? undefined : name.charAt(0).toUpperCase() + name.slice(1);
  const other = named(node.stakes.who[0]);
  const title = familyLabel(node.family);
  const document: SceneDocument = { title: CHOICE_DOCUMENT_TEXT[node.family], fields: [],
    ...(other === undefined ? {} : { name: capitalized(other) }) };
  let lines: (string | null)[];
  let props: LifeTile[];
  switch (node.family) {
    case 'family_death':
      lines = CHOICE_SCENE_TEXT.family_death.map(line => supportedText(line, {
        D: capitalized(other), M: capitalized(named(node.stakes.who[1])),
      }));
      props = ['coffin', 'candle'];
      break;
    case 'inheritance': {
      const coheirs = node.stakes.who.slice(1).filter(id => id !== chooser);
      const names = coheirs.map(named);
      lines = [supportedText(CHOICE_SCENE_TEXT.inheritance[0], { D: capitalized(other), $: formatMoney(node.stakes.amount) }),
        coheirs.length === 0 || names.some(name => name === undefined) ? null
          : supportedText(CHOICE_SCENE_TEXT.inheritance[1], { Names: names.join(', ') })];
      props = ['will', 'table'];
      break;
    }
    case 'debt_due': {
      const borrower = node.options.some(option => option.id === 'repay_now');
      lines = [supportedText(CHOICE_SCENE_TEXT.debt_due[borrower ? 0 : 1], {
        o: other, O: capitalized(other), $: formatMoney(node.stakes.amount), date: dateLabel(node.stakes.by),
      })];
      props = ['register', 'seal'];
      break;
    }
    case 'feud':
      lines = [supportedText(CHOICE_SCENE_TEXT.feud[0], { o: other })];
      props = ['affected_marker'];
      break;
    case 'life_stage': {
      const person = people.find(person => person.id === chooser);
      const stage = node.options.some(option => option.id === 'ask_for_a_toy') ? 0
        : node.options.some(option => option.id === 'stand_up_to_bully') ? 1 : 2;
      document.name = person?.name;
      lines = [supportedText(CHOICE_SCENE_TEXT.life_stage[stage], {
        n: person?.age === null || person?.age === undefined ? undefined : formatAmount(String(person.age)),
      })];
      props = ['register'];
      break;
    }
  }
  return { identity: [worldId, world.player_soul, node.id], source: { kind: 'node', nodeId: node.id }, category: node.family,
    node, lifecycle: null, world, title, date: node.fired, lines: lines.filter((line): line is string => line !== null), people, props, document,
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
  const numericAge = knownAge !== null && knownAge >= 0n && knownAge <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(knownAge) : null;
  const age = fact.kind === 'birth' ? 0 : numericAge;
  const visualAge = arrival && age !== null && age < 3 ? null : age;
  const name = fact.name || 'Name unavailable';
  const eventResident = BigInt(world.tick) >= BigInt(fact.tick) && BigInt(world.tick) <= BigInt(fact.tick) + 1n
    ? world.residents.find(person => person.id === fact.body) : undefined;
  const sex = actor?.sex ?? eventResident?.sex;
  const people = picturePeople(world, [fact.body], null, actors).map(person => ({
    ...person, name, origin: fact.origin, age, sex, visual: resolveVisualKey(person.id, visualAge), soul: false,
    lifeStatus: death ? 'deceased' as const : person.lifeStatus,
  }));
  const props: LifeTile[] = death ? ['coffin', 'candle'] : fact.kind === 'birth' ? ['cradle'] : ['register', 'seal'];
  const date = dateLabel(fact.tick);
  const copy = LIFE_SCENE_TEXT[fact.kind];
  const arrivalEvent = events.find(event => event.id === fact.event && event.kind.type === fact.kind
    && (event.kind.type === 'possession' || event.kind.type === 'rebuild') && event.kind.person === fact.body);
  const price = arrivalEvent !== undefined && (arrivalEvent.kind.type === 'possession' || arrivalEvent.kind.type === 'rebuild') ? arrivalEvent.kind.price : undefined;
  const lines = copy.lines.map(line => supportedText(line, { 'Full Name': fact.name || undefined,
    n: ageAtDeath === undefined ? undefined : formatAmount(ageAtDeath), date })).filter((line): line is string => line !== null);
  const document: SceneDocument = { title: copy.document,
    fields: [{ label: copy.fields[0], value: name }, { label: copy.fields[1], value: date }],
    ...(death ? { note: LIFE_SCENE_TEXT.death.footer } : {}) };
  if (ageAtDeath !== undefined) document.fields.push({ label: LIFE_SCENE_TEXT.death.fields[2], value: formatAmount(ageAtDeath) });
  if (ageAtArrival !== null) document.fields.push({ label: LIFE_SCENE_TEXT.possession.fields[2], value: formatAmount(ageAtArrival.toString()) });
  if (price !== undefined) document.fields.push({ label: LIFE_SCENE_TEXT.possession.fields[3], value: formatAmount(price) });
  if (fact.kind === 'birth' && world.player.body === fact.body && BigInt(world.tick) <= BigInt(fact.tick) + 1n) {
    const parents = world.player.blood_ties.filter(tie => tie.kinship.includes('parent')).map(tie =>
      world.residents.find(person => person.id === tie.person)?.name ?? actors?.get(tie.person)?.name);
    if (parents.length > 0 && parents.every(name => name !== undefined)) {
      document.fields.push({ label: LIFE_SCENE_TEXT.birth.fields[2], value: parents.join(', ') });
    }
  }
  return {
    identity: [worldId, fact.event], source: { kind: 'event', eventId: fact.event }, category: death ? 'death' : 'rebirth', node: null, lifecycle: fact, world,
    title: copy.title, date: fact.tick, lines, document,
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
    const age = knownAge !== null && knownAge >= 0n && knownAge <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(knownAge) : null;
    return { ...person, age, sex: actor?.sex, visual: resolveVisualKey(person.id, age), soul: actor?.soulId === world.player_soul };
  });
  const recipient = people.find(person => person.id === fact.dreamer)?.name;
  const knownRecipient = world.residents.find(person => person.id === fact.dreamer)?.name ?? actors?.get(fact.dreamer)?.name;
  const copy = LIFE_SCENE_TEXT.dream;
  const response = fact.interpretation === undefined ? copy.noReply
    : supportedText(dreamResponseLabel(fact.interpretation.applied), { B: knownRecipient });
  const fields: SceneDocument['fields'] = [{ label: copy.fields[0], value: recipient ?? 'Name unavailable' },
    { label: copy.fields[1], value: dateLabel(fact.tick) }, { label: copy.fields[2], value: formatAmount(fact.price) }];
  if (response !== null) fields.push({ label: copy.fields[3], value: response, role: 'response' });
  const line = supportedText(copy.line, { b: knownRecipient, intent: DREAM_INTENT_TEXT[fact.intent] });
  return { identity: [worldId, fact.eventId], source: { kind: 'event', eventId: fact.eventId }, category: 'dream',
    node: null, lifecycle: null, dream: fact, world, title: copy.title, date: fact.tick, people,
    props: ['cloud', 'will'], focal: { kind: 'prop', id: 'will' }, document: { title: copy.document, fields },
    lines: [line, response].filter((line): line is string => line !== null) };
}

/** The permitted fallback contains only captured resolution facts and its own World. */
export function dreamResolutionKeyScene(worldId: number, world: WorldSnapshot,
  resolution: NonNullable<WorldSnapshot['last_dream']>): KeySceneView {
  const people = picturePeople(world, [resolution.dreamer], null).map(person => ({ ...person, age: null, visual: resolveVisualKey(person.id, null), soul: false }));
  const name = world.residents.find(person => person.id === resolution.dreamer)?.name
    ?? world.person_names.find(person => person.id === resolution.dreamer)?.name;
  const copy = LIFE_SCENE_TEXT.dreamReply;
  const response = supportedText(dreamResponseLabel(resolution.applied), { B: name });
  const lines = [supportedText(copy.line, { B: name }), response].filter((line): line is string => line !== null);
  return { identity: [worldId, 'dream', resolution.tick], source: { kind: 'dream-resolution', tick: resolution.tick, dreamer: resolution.dreamer, applied: resolution.applied },
    category: 'dream', node: null, lifecycle: null, dreamResolution: { ...resolution }, world,
    title: copy.title, date: resolution.tick, people, props: ['cloud', 'will'], focal: { kind: 'prop', id: 'will' }, lines,
    document: { title: copy.document, fields: [{ label: copy.fields[0], value: name ?? 'Name unavailable' },
      { label: copy.fields[1], value: dateLabel(resolution.tick) }, ...(response === null ? [] : [{ label: copy.fields[2], value: response, role: 'response' as const }])] } };
}
