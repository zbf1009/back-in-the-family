import type { UiState } from './ui-state.ts';
import type { Needed, Preview, Stakes, WorldSnapshot } from '../shared/world-snapshot.ts';
import { customizationInput } from './customization.ts';

export function namesById(world: WorldSnapshot): ReadonlyMap<number, string> {
  return new Map([...world.person_names, ...world.player.earlier_bodies, ...world.residents]
    .map(person => [person.id, person.name]));
}

export function neededText(needed: Needed): string {
  switch (needed.kind) {
    case 'wait_until': return `wait until tick ${needed.tick}`;
    case 'joss_short': return `short by ${needed.amount} joss paper`;
    case 'cap_room_short': return `Yearly_Cap room short by ${needed.amount}`;
    case 'named': return needed.name;
  }
}

export function stakesView(stakes: Stakes, world: WorldSnapshot) {
  const names = namesById(world);
  return {
    who: stakes.who.map(id => names.get(id)!),
    amount: stakes.amount,
    unit: stakes.unit,
    by: stakes.by,
    days: (BigInt(stakes.by) - BigInt(world.tick)).toString(),
  };
}

export function previewView(preview: Preview, world: WorldSnapshot) {
  return {
    person: namesById(world).get(preview.person)!,
    delta: preview.delta.startsWith('-') ? preview.delta : `+${preview.delta}`,
    what: preview.what,
    unit: preview.what.startsWith('trait:') ? 'trait_points'
      : preview.what === 'debt' ? 'money' : preview.what,
  };
}

// Presentation only: Snapshot age is already whole years; only days are subtracted.
export function viewModel(ui: UiState) {
  const world = ui.world;
  if (world === null) return null;
  const names = namesById(world);
  const body = world.residents.find(person => person.id === world.player.body);
  return {
    body: body === undefined ? null : {
      id: body.id, name: body.name, age: body.age, origin: body.origin,
    },
    earlierBodies: world.player.earlier_bodies,
    rememberers: new Set(world.player.past_life_ties.map(tie => tie.rememberer)).size,
    bloodTies: world.player.blood_ties.map(tie => ({ ...tie, name: names.get(tie.person)! })),
    pastLifeTies: world.player.past_life_ties.map(tie => ({
      ...tie, name: names.get(tie.rememberer)!, earlierName: names.get(tie.earlier_body)!,
    })),
    choice: world.player_node === null ? null : {
      id: world.player_node.id,
      family: world.player_node.family,
      stakes: stakesView(world.player_node.stakes, world),
      options: world.player_node.options.map(option => ({
        id: option.id, preview: option.preview.map(entry => previewView(entry, world)),
      })),
    },
    needed: world.underworld_view?.slots.map(slot => ({
      slot: slot.slot, lines: slot.status.needed.map(neededText),
    })) ?? [],
  };
}

export function underworldView(ui: UiState) {
  const world = ui.world;
  if (world === null || world.underworld_view === null) return null;
  const view = world.underworld_view;
  const names = namesById(world);
  const balance = world.joss.find(account => account.soul_id === world.player_soul)!.balance;
  const low = BigInt(balance) < BigInt(view.dream_price);
  const nobody = view.connected.length === 0;
  return {
    balance, dreamPrice: view.dream_price,
    connected: view.connected.map(id => ({ id, name: names.get(id)! })),
    ghostTraits: view.ghost_traits,
    dreamEnabled: !low && !nobody,
    dreamReasons: [...(low ? ['Not enough joss paper for a dream.'] : []), ...(nobody ? ['No connected people.'] : [])],
    slots: view.slots.map(slot => ({
      ...slot, needed: slot.status.needed.map(neededText),
      claimEnabled: slot.status.claimable && slot.status.affordable
        && (slot.slot !== 'rebuilt_body' || customizationInput(ui.underworldForm.customization) !== null),
    })),
  };
}
