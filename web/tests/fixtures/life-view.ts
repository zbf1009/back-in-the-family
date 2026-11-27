/// <reference lib="dom" />
/// <reference types="vite/client" />
import { mount } from 'svelte';
import baselineBytes from '../../../fixtures/parity/seed1-pairwise.snapshot-500.json?raw';
import nativeLifecycleBytes from '../../../fixtures/life-view/c4-native-lifecycle-props.json?raw';
import { initialUiState, reduce, type UiState } from '../../src/main/ui-state.ts';
import { TRAITS } from '../../src/main/customization.ts';
import { appendStory, createNotebook } from '../../src/main/life-journal.ts';
import type { StoryActor, StoryBatch } from '../../src/shared/story.ts';
import type { ChronicleEntry, Needed, PlayerFamily, PlayerLifecycleFact, PlayerNode, PlayerOption, Preview, UnderworldView, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import type { PauseReason, Snapshot } from '../../src/shared/protocol.ts';
import LifeViewFixture from './LifeViewFixture.svelte';
import '../../src/ui/life.css';

const MAX_U64 = '18446744073709551615';
const ABOVE_SAFE = '9007199254740993';
const MIN_I64 = '-9223372036854775808';
const MAX_I64 = '9223372036854775807';
const baseline = JSON.parse(baselineBytes) as WorldSnapshot;
const scenario = new URLSearchParams(location.search).get('state') ?? 'living';
const families: PlayerFamily[] = ['family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'];
const motionStates = [...families.map(family => `motion-${family}`), 'motion-death', 'motion-birth', 'motion-possession', 'motion-rebuild', 'motion-joined', 'motion-unknown', 'motion-dream', 'motion-native'];
if (!['living', 'waiting', 'waiting-large', 'choice-large', 'event-funeral', 'event-inheritance', 'event-funeral-history', 'event-inheritance-history', ...motionStates].includes(scenario)) throw Error(`Unknown component fixture state: ${scenario}`);

// This old native baseline used display-style Soul IDs. Normalize only their
// representation to today's decimal-string carrier, without Number conversion.
function soulId(value: string): string {
  return /^S-[0-9]+$/.test(value) ? BigInt(value.slice(2)).toString() : value;
}
let world: WorldSnapshot = structuredClone(baseline);
world.player_soul = soulId(world.player_soul);
for (const person of world.residents) person.soul_id = soulId(person.soul_id);
world.magistrate.soul_id = soulId(world.magistrate.soul_id);
for (const soul of world.souls) soul.soul_id = soulId(soul.soul_id);
for (const account of world.joss) account.soul_id = soulId(account.soul_id);
const body = world.residents.find(person => person.id === world.player.body)!;
// The removed body's recorded baseline facts remain available to the notebook.
// Constructed earlier-body IDs and retained-name-only people do not acquire sex
// or age by borrowing an unrelated living resident's illustration.
const retainedBody = structuredClone(body);
const large = scenario.endsWith('-large');
const waiting = scenario.startsWith('waiting') || ['motion-death', 'motion-possession', 'motion-rebuild', 'motion-joined'].includes(scenario);
const modifiedFields = ['Soul ID representation: legacy S-000n to canonical decimal strings'];

if (large) {
  const oldSoul = world.player_soul;
  world.player_soul = MAX_U64;
  body.soul_id = MAX_U64;
  world.souls.find(soul => soul.soul_id === oldSoul)!.soul_id = MAX_U64;
  world.joss.find(account => account.soul_id === oldSoul)!.soul_id = MAX_U64;
  world.tick = String(BigInt(MAX_U64) - 100n);
  // The baseline's resident count supplies a deterministic stress size, not a
  // claimed core maximum. Earlier lives, ties and open slots have no fixed cap.
  for (const person of world.residents) person.name = `${person.name} — Similar household name / ${'full unabridged relationship name '.repeat(4)}Person ${person.id}`;
  world.magistrate.name = `${world.magistrate.name} — ${'full unabridged magistrate name '.repeat(4)}`;
  world.player.earlier_bodies = world.residents.map((person, index) => ({
    id: 500_000 + person.id, name: `${person.name} / earlier body ${index + 1}`, origin: index % 2 ? 'rebuilt' : 'possessed',
    death: String(BigInt(world.tick) - BigInt(index + 1)),
  }));
  const others = world.residents.filter(person => person.id !== body.id);
  world.player.blood_ties = others.map((person, index) => ({ person: person.id, affinity: index % 2 ? -100 : 100, kinship: ['cousin', 'in_law'] }));
  world.player.relations = others.map((person, index) => ({ person: person.id, affinity: index % 2 ? -99 : 99, kinship: ['former_spouse'] }));
  world.player.past_life_ties = others.map((person, index) => ({ rememberer: person.id, earlier_body: world.player.earlier_bodies[index]!.id, affinity: 100 }));
  const history: ChronicleEntry[] = Array.from({ length: 100 }, (_, index) => ({
    tick: String(BigInt(world.tick) - BigInt(index)), family: 'inheritance',
    stakes: { who: [body.id, others[index % others.length]!.id], amount: index % 2 ? MIN_I64 : MAX_I64, unit: 'money', by: MAX_U64 },
    applied: 'keep_it', source: index % 2 ? 'external' : 'rules_default', chooser_absent: index % 3 === 0,
    skipped: [{ part: index, reason: 'missing_person' }, { part: index + 1, reason: 'out_of_bounds' }],
  }));
  world.chronicle = history;
  modifiedFields.push('Constructed long/similar names, earlier bodies, ties, canonical u64/signed64 values; Chronicle uses the real 100-row snapshot bound');
}

if (waiting) {
  world.residents = world.residents.filter(person => person.id !== body.id);
  world.households = world.households.map(house => ({ ...house, members: house.members.filter(id => id !== body.id) }));
  world.souls.find(soul => soul.soul_id === world.player_soul)!.place = { waiting: { since: world.tick } };
  world.player.place = 'waiting';
  world.player.body = null;
  world.player.relations = [];
  world.player.earlier_bodies.unshift({ id: body.id, name: body.name, origin: body.origin, death: world.tick });
  world.player_wait = { ghost: body.id, access_from: world.tick, claim: null, carry_over: null };
  world.player_node = null;
  world.joss.find(account => account.soul_id === world.player_soul)!.balance = large ? MAX_U64 : '500';
  const connected = world.residents.map(person => person.id);
  const needed: Needed[] = large ? [
    { kind: 'wait_until', tick: MAX_U64 }, { kind: 'joss_short', amount: MAX_U64 }, { kind: 'cap_room_short', amount: ABOVE_SAFE },
    ...['bad_customization', 'customization_not_allowed', 'slot_closed', 'claimed_by_you', 'claim_held', 'id_exhausted'].map(name => ({ kind: 'named' as const, name })),
  ] : [];
  const offered = large ? world.residents.map((person, index) => ({
    id: String(900 + index), household: person.household, birth: String(BigInt(world.tick) + BigInt(index + 1)), price: '0', claimant: null,
  })) : world.birth_slots;
  world.birth_slots = offered;
  const slots: UnderworldView['slots'] = [
    ...offered.map((slot, index) => ({ slot: `birth:${slot.id}` as const, kind: 'birth_slot' as const, price: slot.price, birth: slot.birth,
      status: { announced: true, claimable: index !== 0 || !large, affordable: true, needed: index === 0 ? needed : [] } })),
    { slot: 'imported_vessel', kind: 'imported_vessel', price: large ? ABOVE_SAFE : '100', birth: null, status: { announced: true, claimable: true, affordable: true, needed: [] } },
    { slot: 'rebuilt_body', kind: 'rebuilt_body', price: large ? MAX_U64 : '400', birth: null, status: { announced: true, claimable: true, affordable: true, needed: [] } },
  ];
  world.standing_slots = slots.filter(slot => slot.kind !== 'birth_slot').map(slot => ({ kind: slot.kind as 'imported_vessel' | 'rebuilt_body', price: slot.price }));
  world.underworld_view = {
    dream_price: large ? ABOVE_SAFE : '20', connected, ghost_traits: { ...body.traits }, slots,
    actions: { version: 1, capped_spend: { cap_year: large ? ABOVE_SAFE : '1', yearly_cap: large ? MAX_U64 : '120', spent: large ? ABOVE_SAFE : '0', remaining: large ? MAX_U64 : '120' },
      bribe: { min_amount: '1', max_amount: large ? MAX_U64 : '500', availability: { eligible: true, reason: null } },
      haunt: { price: large ? ABOVE_SAFE : '40', targets: connected.map(target => ({ target, availability: { eligible: true, reason: null } })) },
    },
    base_traits: [null, ...TRAITS].map(carry_over => ({ carry_over, traits: { ...body.traits } })),
  };
  modifiedFields.push('Constructed Waiting carrier, all offered slots in order plus two standing paths, real seven Traits/None and eight base-trait previews');
  if (large) modifiedFields.push('All four Needed variants and existing named reasons are a presentation stress combination, not a claimed reachable core state');
}

if (scenario === 'choice-large') {
  const kinds: Preview['what'][] = ['money', 'debt', 'affinity', ...TRAITS.map(trait => `trait:${trait}` as const)];
  const node: PlayerNode = {
    id: ABOVE_SAFE, family: 'life_stage', fired: String(BigInt(world.tick) - 1n), choice_tick: world.tick, resolves: MAX_U64,
    stakes: { who: world.residents.map(person => person.id), amount: MIN_I64, unit: 'money', by: MAX_U64 },
    options: ['get_a_job', 'help_at_home', 'tend_the_shrine'].map(id => ({ id: id as 'get_a_job' | 'help_at_home' | 'tend_the_shrine',
      preview: kinds.flatMap(what => world.residents.map((person, index) => ({ person: person.id, what, delta: index % 2 ? MIN_I64 : MAX_I64 }))),
    })), rules_default: 'help_at_home',
  };
  world.player_node = node;
  modifiedFields.push('Constructed current choice with every existing Preview unit/trait, all offered options and exact raw signed64 strings');
}

if (scenario.startsWith('event-')) {
  const funeral = scenario.startsWith('event-funeral');
  for (const id of [1, 3]) {
    if (!world.residents.some(person => person.id === id && person.alive)) throw Error(`Event fixture needs living Person ${id}`);
  }
  world.residents = world.residents.filter(person => ![100, 101].includes(person.id));
  world.player.earlier_bodies = world.player.earlier_bodies.filter(person => ![100, 101].includes(person.id));
  world.person_names = [...world.person_names.filter(person => ![1, 3, 100, 101].includes(person.id)),
    { id: 100, name: 'Morgan Estate Keeper' }, { id: 101, name: 'Taylor Shared Heir' }];
  world.player_node = funeral ? {
    id: '830', family: 'family_death', fired: '499', choice_tick: world.tick, resolves: world.tick,
    stakes: { who: [100, 1, 3], amount: '640', unit: 'money', by: '501' },
    options: [{ id: 'comfort_mourner', preview: [{ person: 1, what: 'affinity', delta: '3' }] },
      { id: 'send_flowers', preview: [] }, { id: 'stay_away', preview: [] }], rules_default: 'comfort_mourner',
  } : {
    id: '831', family: 'inheritance', fired: '499', choice_tick: world.tick, resolves: world.tick,
    stakes: { who: [100, 1, 3, 101], amount: '640', unit: 'money', by: '501' },
    options: [{ id: 'keep_it', preview: [{ person: 1, what: 'money', delta: '640' }] },
      { id: 'thank_family', preview: [] }, { id: 'pay_debts', preview: [] }], rules_default: 'keep_it',
  };
  if (scenario.endsWith('-history')) world.last_dream = { tick: '499', dreamer: 1, applied: 'dismiss_dream' };
  modifiedFields.push('Current Funeral/Inheritance roles with retained-name-only deceased nonplayers, known living participants, and optional node-null historical Dream head');
}

const lifecycle: PlayerLifecycleFact[] = [];
const reasons: PauseReason[] = [];
if (scenario.startsWith('motion-') && scenario !== 'motion-native') {
  world.player_node = null;
  const family = scenario === 'motion-joined' ? 'inheritance' : scenario === 'motion-unknown' ? 'feud' : scenario.slice(7) as PlayerFamily;
  if (families.includes(family)) {
    const options: Record<PlayerFamily, PlayerOption[]> = {
      family_death: ['comfort_mourner', 'send_flowers', 'stay_away'],
      inheritance: ['keep_it', 'thank_family', 'pay_debts'],
      debt_due: ['repay_now', 'ask_for_time', 'ignore_it'],
      feud: ['apologize', 'retaliate', 'let_it_go'],
      life_stage: ['get_a_job', 'help_at_home', 'tend_the_shrine'],
    };
    const unknown = scenario === 'motion-unknown';
    const deceased = 100;
    world.person_names = [...world.person_names.filter(person => person.id !== deceased), { id: deceased, name: 'Morgan Estate Keeper' }];
    world.player_node = { id: ABOVE_SAFE, family, fired: '499', choice_tick: world.tick, resolves: world.tick,
      stakes: { who: unknown ? [999999] : family === 'family_death' || family === 'inheritance' ? [deceased, 1, 3] : [1, 3], amount: MIN_I64, unit: 'money', by: MAX_U64 },
      options: options[family].map(id => ({ id, preview: [{ person: unknown ? 999999 : 1, what: 'affinity', delta: '-3' }, { person: 3, what: 'money', delta: MAX_I64 }] })),
      rules_default: options[family][0]!,
    };
    reasons.push('player_node');
  }
  if (scenario === 'motion-death' || scenario === 'motion-joined') {
    lifecycle.push({ event: ABOVE_SAFE, tick: world.tick, kind: 'death', body: body.id, name: body.name, origin: body.origin });
    reasons.push('player_died');
  }
  if (['motion-birth', 'motion-possession', 'motion-rebuild', 'motion-joined'].includes(scenario)) {
    const kind = scenario === 'motion-birth' ? 'birth' : scenario === 'motion-rebuild' ? 'rebuild' : 'possession';
    const origin = kind === 'birth' ? 'native' : kind === 'rebuild' ? 'rebuilt' : 'possessed';
    const arrival = { event: '9007199254740995', tick: world.tick, kind, body: 500001, name: 'Alexandra Arrival — event-associated body', origin } as PlayerLifecycleFact;
    lifecycle.push(arrival);
    world.person_names.push({ id: arrival.body, name: arrival.name });
    if (scenario === 'motion-birth') {
      world.residents = world.residents.map(person => person.id === body.id ? { ...person, id: arrival.body, name: arrival.name, age: 0, origin } : person);
      world.player.body = arrival.body;
      world.households = world.households.map(house => ({ ...house, members: house.members.map(id => id === body.id ? arrival.body : id) }));
      world.souls.find(soul => soul.soul_id === world.player_soul)!.place = { body: arrival.body };
    } else {
      world.player.earlier_bodies.push({ id: arrival.body, name: arrival.name, origin, death: world.tick });
      lifecycle.push({ ...arrival, event: '9007199254740996', kind: 'death' });
      world.player_wait!.ghost = arrival.body;
      reasons.push('player_died');
    }
    reasons.push('player_reborn');
  }
  if (scenario === 'motion-joined' || scenario === 'motion-dream') {
    world.last_dream = { tick: String(BigInt(world.tick) - 1n), dreamer: 1, applied: 'take_comfort' };
    reasons.push('dream_resolved');
  }
  modifiedFields.push('COMPONENT-ONLY seven-category presentation props, exact lifecycle event/body tuples, complete legal options and signed previews; not native lifecycle receipt evidence');
}

let baselineSource = 'fixtures/parity/seed1-pairwise.snapshot-500.json';
if (scenario === 'motion-native') {
  const data = JSON.parse(nativeLifecycleBytes) as { version: number; layer: string; cases: { id: string; world: WorldSnapshot; playerLifecycle: PlayerLifecycleFact[]; producer: unknown }[] };
  if (data.version !== 1 || data.layer !== 'ACTUAL-NATIVE-PRODUCED-COMPONENT-PROPS') throw Error('Native props have the wrong evidence layer');
  const id = new URLSearchParams(location.search).get('case');
  const value = data.cases.find(value => value.id === id);
  if (value === undefined) throw Error(`Unknown actual native props case: ${id}`);
  world = value.world;
  lifecycle.push(...value.playerLifecycle);
  if (lifecycle.some(fact => fact.kind === 'death')) reasons.push('player_died');
  if (lifecycle.some(fact => fact.kind !== 'death')) reasons.push('player_reborn');
  if (world.player_node !== null) reasons.push('player_node');
  baselineSource = 'fixtures/life-view/c4-native-lifecycle-props.json';
  modifiedFields.splice(0, modifiedFields.length, `Unmodified actual native World/lifecycle props; producer: ${JSON.stringify(value.producer)}`);
}

const initial = initialUiState();
let ui: UiState = { ...initial, worldId: 1, runState: 'paused', tick: world.tick, world,
  playerNode: world.player_node === null ? { pending: false } : { pending: true, node: world.player_node.id, answered: false },
  underworldForm: { ...initial.underworldForm, dreamer: world.underworld_view?.connected[0] ?? null },
};
const focus = world.player.body ?? world.player_wait?.ghost;
const actors: StoryActor[] = world.residents.map(person => ({
  person: person.id, soulId: person.soul_id, name: person.name, sex: person.sex, origin: person.origin,
}));
if (scenario !== 'motion-native' && world.player.place === 'waiting' && focus === retainedBody.id) actors.push({
  person: retainedBody.id, soulId: world.player_soul, name: world.player.earlier_bodies.find(person => person.id === retainedBody.id)!.name,
  sex: retainedBody.sex, origin: retainedBody.origin, ageAtDeath: String(retainedBody.age),
});
const batch: StoryBatch = {
  version: 1, opening: true, actors, events: [], dreams: [],
  chronicle: world.chronicle.map((record, index) => ({
    index: String(index), tick: record.tick, family: record.family, stakes: record.stakes,
    applied: record.applied, source: record.source, chooserAbsent: record.chooser_absent,
    skipped: record.skipped, appended: [], actorContext: scenario === 'motion-native' || focus === undefined ? [] : [{ relativeTo: focus, basis: 'opening-current', actors: [] }],
  })),
  cursors: { events: { start: '0', end: '0' }, chronicle: { start: '0', end: String(world.chronicle.length) } },
};
ui = { ...ui, notebook: appendStory(createNotebook(ui.worldId), [{ worldId: ui.worldId, batch }], { world, lifecycle }) };
modifiedFields.push('Notebook component carrier indexes the full raw Chronicle snapshot with explicit World/lifecycle binding; it is not an original native StoryDelivery');
if (scenario.endsWith('-history') || scenario.startsWith('motion-')) {
  const snapshot: Snapshot = { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum, tps: ui.tps, speed: ui.speed,
    actions: [], playerLifecycle: lifecycle, playerNode: ui.playerNode,
    stop: { reasons: scenario.endsWith('-history') ? ['dream_resolved', 'player_node'] : reasons, world } };
  ui = reduce(ui, { type: 'status', snapshot });
}
const target = document.getElementById('fixture');
if (target === null) throw Error('Component fixture mount target is missing');
mount(LifeViewFixture, { target, props: { initialUi: ui, scenario, source: {
  baseline: baselineSource, modifiedFields,
  limits: scenario === 'motion-native'
    ? 'Actual native-controlled fixture props rendered by production components. Not live App/WASM, default-Params replay, native UI admission or gameplay result.'
    : 'COMPONENT-ONLY constructed data. Not a native replay, admitted operation, configured maximum, or gameplay result.',
  capacity: 'No fixed open-slot or earlier-body/tie display cap; one open slot per mother. Chronicle snapshot retains 100 rows. CarryOver is one of seven Traits or None.',
  capacitySources: ['crates/sim-core/src/underworld/slots.rs', 'crates/sim-core/src/snapshot.rs', 'crates/sim-core/src/params.rs'],
} } });
