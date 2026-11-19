import { readFileSync } from 'node:fs';
import type { PlayerFamily, PlayerOption, TraitName, UnderworldView, WorldSnapshot } from '../../../src/shared/world-snapshot.ts';
import { initialUiState, type UiState } from '../../../src/main/ui-state.ts';
import { TRAITS } from '../../../src/main/customization.ts';

export const snapshot: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));

export function pendingSnapshot(family: PlayerFamily): WorldSnapshot {
  const ids: Record<PlayerFamily, [PlayerOption, PlayerOption]> = {
    family_death: ['comfort_mourner', 'stay_away'], inheritance: ['keep_it', 'thank_family'],
    debt_due: ['repay_now', 'ignore_it'], feud: ['apologize', 'let_it_go'], life_stage: ['get_a_job', 'help_at_home'],
  };
  return { ...snapshot, person_names: [{ id: 100, name: 'Deceased Resident' }], player_node: {
    id: '12', family, fired: '499', choice_tick: '500', resolves: '500',
    stakes: { who: family === 'family_death' ? [100, 1] : family === 'inheritance' ? [100, 1, 3] : [1], amount: '640', unit: 'money', by: '501' },
    options: ids[family].map((id, index) => ({ id, preview: index ? [] : [{ person: 1, what: 'affinity' as const, delta: '1' }] })),
    rules_default: ids[family][0],
  } };
}

export function waitingSnapshot(births = 0, patch: Partial<UnderworldView> = {}): WorldSnapshot {
  const ghost = snapshot.residents.find(person => person.id === snapshot.player.body)!;
  const slots: UnderworldView['slots'] = [
    ...Array.from({ length: births }, (_, index) => ({ slot: `birth:${index + 1}` as const, kind: 'birth_slot' as const, price: '0', birth: String(700 + index),
      status: { announced: true, claimable: true, affordable: true, needed: [] } })),
    { slot: 'imported_vessel', kind: 'imported_vessel', price: '100', birth: null, status: { announced: true, claimable: true, affordable: true, needed: [] } },
    { slot: 'rebuilt_body', kind: 'rebuilt_body', price: '400', birth: null, status: { announced: true, claimable: true, affordable: true, needed: [] } },
  ];
  return { ...snapshot,
    residents: snapshot.residents.filter(person => person.id !== ghost.id),
    households: snapshot.households.map(house => ({ ...house, members: house.members.filter(id => id !== ghost.id) })),
    souls: snapshot.souls.map(soul => soul.soul_id === snapshot.player_soul ? { soul_id: soul.soul_id, place: { waiting: { since: '499' } } } : soul),
    player: { ...snapshot.player, place: 'waiting', body: null,
      earlier_bodies: [{ id: ghost.id, name: ghost.name, origin: ghost.origin, death: '499' }], blood_ties: [], relations: [],
      past_life_ties: [{ rememberer: 1, earlier_body: ghost.id, affinity: 40 }, { rememberer: 3, earlier_body: ghost.id, affinity: 30 }] },
    player_wait: { ghost: ghost.id, access_from: '499', claim: null, carry_over: null },
    joss: snapshot.joss.map(account => account.soul_id === snapshot.player_soul ? { ...account, balance: '500' } : account),
    underworld_view: { dream_price: '20', connected: [1, 3], ghost_traits: ghost.traits, slots,
      base_traits: [null, ...TRAITS].map(carry_over => ({ carry_over: carry_over as TraitName | null, traits: { ...ghost.traits } })), ...patch },
  };
}

export function uiFor(world: WorldSnapshot): UiState {
  const ui = initialUiState();
  return { ...ui, worldId: 1, runState: 'paused', tick: world.tick, world,
    playerNode: world.player_node === null ? { pending: false } : { pending: true, node: world.player_node.id, answered: false },
    underworldForm: { ...ui.underworldForm, dreamer: world.underworld_view?.connected[0] ?? null, carryOver: world.player_wait?.carry_over ?? null },
  };
}
