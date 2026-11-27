import { initialUiState, reduce, type UiState } from '../../src/main/ui-state.ts';
import { TRAITS } from '../../src/main/customization.ts';
import type { Request, Snapshot } from '../../src/shared/protocol.ts';
import type { ActorContext, StoryBatch, StoryChronicle, StoryEvent } from '../../src/shared/story.ts';
import type { PlayerNode, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

// COMPONENT-ONLY: the seed-1 native snapshot supplies residents and household shape.
// All subsequent events, exact causal IDs, node choices, age-at-death metadata,
// delivery timing and lifecycle transitions below are constructed carriers, not
// recorded gameplay or evidence that these events occurred in seed 1.
export const carrierSource = {
  mode: 'COMPONENT-ONLY',
  baseline: 'fixtures/parity/seed1-pairwise.snapshot-500.json',
  modifiedFields: ['Legacy Soul IDs normalized to decimal strings', 'Constructed nodes, facts, causal links and delivery order',
    'Constructed age-at-death metadata, waiting and borrowed-body transitions'],
  limits: 'Production reducer and components only; no App, WASM, model, replay execution or genuine gameplay claim.',
} as const;

export function livingWorld(baseline: WorldSnapshot): WorldSnapshot {
  const world = structuredClone(baseline);
  const canonical = (value: string) => value.startsWith('S-') ? BigInt(value.slice(2)).toString() : value;
  world.player_soul = canonical(world.player_soul);
  for (const person of world.residents) person.soul_id = canonical(person.soul_id);
  world.magistrate.soul_id = canonical(world.magistrate.soul_id);
  for (const soul of world.souls) soul.soul_id = canonical(soul.soul_id);
  for (const account of world.joss) account.soul_id = canonical(account.soul_id);
  return world;
}

export function actorContext(focus = 2): ActorContext[] {
  return [{ relativeTo: focus, basis: 'observed-day-start', actors: [{ person: focus }, { person: 1, kinRole: 'spouse' }] }];
}

export function batch(patch: Partial<StoryBatch> = {}): StoryBatch {
  return { version: 1, opening: false, actors: [], events: [], chronicle: [], dreams: [],
    cursors: { events: { start: '0', end: '0' }, chronicle: { start: '0', end: '0' } }, ...patch };
}

export function carrierSnapshot(ui: UiState, patch: Partial<Snapshot> = {}): Snapshot {
  return { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum,
    tps: ui.tps, speed: ui.speed, playerNode: ui.playerNode, actions: [], playerLifecycle: [], ...patch };
}

export function createCarrierState(baseline: WorldSnapshot, worldId = 1): UiState {
  const world = livingWorld(baseline);
  const opening = batch({ opening: true, actors: [...world.residents, world.magistrate].map(person => ({
    person: person.id, soulId: person.soul_id, name: person.name, sex: person.sex, origin: person.origin,
  })) });
  return reduce(initialUiState(), { type: 'reply', request: { type: 'create-world', id: 1, seed: '1', config: '{}' },
    message: { type: 'reply', id: 1, ok: true, world,
      snapshot: { worldId, runState: 'paused', tick: world.tick, checksum: '1111111111111111', tps: null,
        speed: 1 / 30, playerNode: { pending: false }, actions: [], playerLifecycle: [], story: [{ worldId, batch: opening }] } } });
}

export function deliver(ui: UiState, facts: StoryBatch, world?: WorldSnapshot, patch: Partial<Snapshot> = {}): UiState {
  return reduce(ui, { type: 'status', snapshot: carrierSnapshot(ui, {
    story: [{ worldId: ui.worldId, batch: facts }],
    ...(world === undefined ? {} : { tick: world.tick, stop: { reasons: ['user'], world } }), ...patch,
  }) });
}

export function choiceNode(id = '120', focus = 2): PlayerNode {
  return { id, family: 'debt_due', fired: '499', choice_tick: '500', resolves: '500',
    stakes: { who: [focus, 1], amount: '640', unit: 'money', by: '501' },
    options: [{ id: 'repay_now', preview: [] }, { id: 'ignore_it', preview: [] }], rules_default: 'repay_now' };
}

export function offerChoice(ui: UiState, node = choiceNode()): UiState {
  const world = { ...ui.world!, player_node: node };
  return deliver(ui, batch(), world, { playerNode: { pending: true, node: node.id, answered: false },
    stop: { reasons: ['player_node'], world } });
}

export function admitChoice(ui: UiState, id = 10): UiState {
  const node = ui.world!.player_node!;
  const request: Request = { type: 'choose', id, node: node.id, option: 'ignore_it' };
  const sent = reduce(ui, { type: 'request-sent', request });
  return reduce(sent, { type: 'reply', request, message: { type: 'reply', id, ok: true,
    submission: { tick: ui.tick!, seqs: [String(id)] },
    snapshot: carrierSnapshot(sent, { playerNode: { pending: true, node: node.id, answered: true } }) } });
}

export function choiceChronicle(node = '120', index = '0', patch: Partial<StoryChronicle> = {}): StoryChronicle {
  return { index, node, tick: '500', family: 'debt_due', stakes: choiceNode(node).stakes, applied: 'ignore_it',
    source: 'external', chooserAbsent: false, skipped: [], appended: [], actorContext: actorContext(), ...patch };
}

export function kinDeath(id = '900', patch: Partial<StoryEvent> = {}): StoryEvent {
  return { id, tick: '500', kind: { type: 'death', person: 1 }, causedBy: [], tags: 0,
    relevance: 'circle', relevanceBasis: 'observed-day-start-end', actorContext: actorContext(), ...patch };
}

export function estate(id = '901', patch: Partial<StoryEvent> = {}): StoryEvent {
  return { id, tick: '500', kind: { type: 'inheritance', deceased: 1, heir: 2, amount: '73007' },
    causedBy: ['900'], tags: 0, relevance: 'self', relevanceBasis: 'observed-day-start-end', actorContext: actorContext(), ...patch };
}

export function memorialFacts(ui: UiState, events = [kinDeath()]): StoryBatch {
  const actor = ui.notebook.actors.get(1)!;
  return batch({ actors: [{ ...actor, ageAtDeath: '38' }], events });
}

export function waitingWorld(world: WorldSnapshot): WorldSnapshot {
  const body = world.residents.find(person => person.id === world.player.body)!;
  return { ...world, tick: '501', player_node: null,
    residents: world.residents.filter(person => person.id !== body.id),
    households: world.households.map(house => ({ ...house, members: house.members.filter(id => id !== body.id) })),
    souls: world.souls.map(soul => soul.soul_id === world.player_soul ? { ...soul, place: { waiting: { since: '500' } } } : soul),
    player: { place: 'waiting', body: null, earlier_bodies: [{ id: body.id, name: body.name, origin: body.origin, death: '500' }],
      blood_ties: [], relations: [], past_life_ties: [] },
    joss: world.joss.map(account => account.soul_id === world.player_soul ? { ...account, balance: '500' } : account),
    standing_slots: [{ kind: 'imported_vessel', price: '100' }, { kind: 'rebuilt_body', price: '400' }],
    underworld_view: { dream_price: '20', connected: [1, 3], ghost_traits: body.traits,
      actions: { version: 1, capped_spend: { cap_year: '1', yearly_cap: '120', spent: '0', remaining: '120' },
        bribe: { min_amount: '1', max_amount: '500', availability: { eligible: true, reason: null } },
        haunt: { price: '40', targets: [1, 3].map(target => ({ target, availability: { eligible: true as const, reason: null } })) } },
      slots: [...world.birth_slots.map(slot => ({ slot: `birth:${slot.id}` as const, kind: 'birth_slot' as const,
        price: slot.price, birth: slot.birth, status: { announced: true, claimable: false, affordable: true,
          needed: [{ kind: 'wait_until' as const, tick: slot.birth }] } })),
        { slot: 'imported_vessel', kind: 'imported_vessel', price: '100', birth: null,
          status: { announced: true, claimable: true, affordable: true, needed: [] } },
        { slot: 'rebuilt_body', kind: 'rebuilt_body', price: '400', birth: null,
          status: { announced: true, claimable: true, affordable: true, needed: [] } }],
      base_traits: [null, ...TRAITS].map(carry_over => ({ carry_over, traits: body.traits })) },
    player_wait: { ghost: body.id, access_from: '500', claim: null, carry_over: null } };
}

export function rebornWorld(world: WorldSnapshot): WorldSnapshot {
  const vessel = world.residents.find(person => person.id === 4)!;
  return { ...world, tick: '502', player_wait: null, player_node: null,
    underworld_view: null,
    residents: world.residents.map(person => person.id === vessel.id ? { ...person, soul_id: world.player_soul, origin: 'possessed' as const } : person),
    souls: world.souls.map(soul => soul.soul_id === world.player_soul ? { ...soul, place: { body: vessel.id } }
      : soul.soul_id === vessel.soul_id ? { ...soul, place: { waiting: { since: '501' } } } : soul),
    player: { ...world.player, place: 'body', body: vessel.id, blood_ties: [], relations: [], past_life_ties: [] } };
}

export function playerDeath(ui: UiState): UiState {
  const body = ui.world!.residents.find(person => person.id === ui.world!.player.body)!;
  const event = kinDeath('910', { kind: { type: 'death', person: body.id }, relevance: 'self', actorContext: actorContext(body.id) });
  const world = waitingWorld(ui.world!);
  const waitingFact = kinDeath('911', { kind: { type: 'appeal', ghost: body.id, magistrate: ui.world!.magistrate.id },
    relevance: 'self', actorContext: [{ relativeTo: body.id, basis: 'observed-day-end', actors: [{ person: body.id }] }] });
  return deliver(ui, batch({ events: [event, waitingFact] }), world, { playerNode: { pending: false },
    playerLifecycle: [{ event: event.id, tick: event.tick, kind: 'death', body: body.id, name: body.name, origin: body.origin }],
    stop: { reasons: ['player_died'], world } });
}

export function playerRebirth(ui: UiState): UiState {
  const world = rebornWorld(ui.world!);
  const event = kinDeath('912', { tick: '501', kind: { type: 'possession', person: 4, price: '100' },
    relevance: 'self', actorContext: [{ relativeTo: 2, basis: 'observed-day-start', actors: [{ person: 2 }, { person: 4 }] },
      { relativeTo: 4, basis: 'observed-day-end', actors: [{ person: 4 }] }] });
  const person = world.residents.find(person => person.id === 4)!;
  return deliver(ui, batch({ actors: [{ person: person.id, soulId: world.player_soul, name: person.name, sex: person.sex, origin: 'possessed' }],
    events: [event] }), world, { playerNode: { pending: false },
    playerLifecycle: [{ event: event.id, tick: event.tick, kind: 'possession', body: 4, name: person.name, origin: 'possessed' }],
    stop: { reasons: ['player_reborn'], world } });
}
