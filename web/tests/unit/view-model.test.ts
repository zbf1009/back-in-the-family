// Feature: first-playable, Property 24: Displayed values are the Snapshot's values
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { viewModel, namesById } from '../../src/main/view-model.ts';
import { initialUiState } from '../../src/main/ui-state.ts';
import type { Needed, PlayerOption, Preview, StakeUnit, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const RUNS = 1000;
const base: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));
const integer = fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map(String);
const tick = fc.bigInt({ min: 1n, max: 2n ** 64n - 2n });
const what = fc.constantFrom<Preview['what']>('money', 'debt', 'affinity', 'trait:greed', 'trait:loyalty', 'trait:pride', 'trait:warmth', 'trait:temper', 'trait:vindictiveness', 'trait:piety');
const previews = fc.array(fc.record({ person: fc.constantFrom(...base.residents.map(person => person.id)), what, delta: integer }), { minLength: 1, maxLength: 5 });
const needed = fc.array(fc.oneof(
  tick.map(tick => ({ kind: 'wait_until' as const, tick: String(tick) })),
  fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map(amount => ({ kind: 'joss_short' as const, amount: String(amount) })),
  fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map(amount => ({ kind: 'cap_room_short' as const, amount: String(amount) })),
  fc.constantFrom('claim_held', 'claimed_by_you', 'slot_closed').map(name => ({ kind: 'named' as const, name })),
), { minLength: 1, maxLength: 8 });

function neededReference(item: Needed): string {
  switch (item.kind) {
    case 'wait_until': return `wait until tick ${item.tick}`;
    case 'joss_short': return `short by ${item.amount} joss paper`;
    case 'cap_room_short': return `Yearly_Cap room short by ${item.amount}`;
    case 'named': return item.name;
  }
}

test('Property 24: Snapshot whole years, signed previews, Stakes and Needed remain exact', () => {
  fc.assert(fc.property(tick, fc.nat({ max: 10000 }), integer, fc.constantFrom<StakeUnit>('money', 'joss_paper', 'affinity', 'trait_points'), previews, needed,
    (now, age, amount, unit, preview, missing) => {
      const options: PlayerOption[] = ['repay_now', 'ask_for_time', 'ignore_it'];
      const world: WorldSnapshot = { ...base, tick: String(now),
        residents: base.residents.map(person => person.id === base.player.body ? { ...person, age } : person),
        player_node: { id: '18446744073709551615', family: 'debt_due', fired: String(now - 1n), choice_tick: String(now), resolves: String(now),
          stakes: { who: preview.map(entry => entry.person), amount, unit, by: String(now + 1n) },
          options: options.map(id => ({ id, preview })), rules_default: 'ask_for_time' },
        underworld_view: null,
      };
      const ui = { ...initialUiState(), world };
      const before = JSON.stringify(ui);
      const view = viewModel(ui)!;
      assert.equal(view.body!.age, age, 'Snapshot age is already whole years (Property 24 alternative)');
      assert.equal(view.body!.name, world.residents.find(person => person.id === world.player.body)!.name);
      assert.equal(view.body!.origin, world.residents.find(person => person.id === world.player.body)!.origin);
      assert.deepEqual(view.choice!.stakes, { who: preview.map(entry => namesById(world).get(entry.person)), amount, unit, by: String(now + 1n), days: '1' });
      for (const option of view.choice!.options) {
        assert.deepEqual(option.preview, preview.map(entry => ({ person: namesById(world).get(entry.person),
          delta: entry.delta[0] === '-' ? entry.delta : '+' + entry.delta, what: entry.what,
          unit: entry.what.startsWith('trait:') ? 'trait_points' : entry.what === 'debt' ? 'money' : entry.what })));
      }
      const waiting: WorldSnapshot = { ...world, player_node: null,
        player: { ...world.player, place: 'waiting', body: null },
        underworld_view: { dream_price: '20', connected: [], ghost_traits: base.residents[0]!.traits, base_traits: [],
          slots: [{ slot: 'rebuilt_body', kind: 'rebuilt_body', price: '400', birth: null,
            status: { announced: true, claimable: false, affordable: false, needed: missing } }] },
      };
      assert.deepEqual(viewModel({ ...ui, world: waiting })!.needed, [{ slot: 'rebuilt_body', lines: missing.map(neededReference) }]);
      assert.equal(JSON.stringify(ui), before);
    }), { numRuns: RUNS });
});

test('Identity separates ties, counts distinct Rememberers and names non-resident Persons', () => {
  const world: WorldSnapshot = { ...base, player: { ...base.player,
    earlier_bodies: [{ id: 100, name: 'Earlier One', origin: 'native', death: '42' }, { id: 101, name: 'Earlier Two', origin: 'rebuilt', death: '80' }],
    past_life_ties: [{ rememberer: 1, earlier_body: 100, affinity: -19 }, { rememberer: 1, earlier_body: 101, affinity: 21 }],
  }, person_names: [{ id: 200, name: 'Deceased Creditor' }] };
  const view = viewModel({ ...initialUiState(), world })!;
  assert.equal(view.rememberers, 1);
  assert.equal(view.bloodTies.length, base.player.blood_ties.length);
  assert.deepEqual(view.pastLifeTies.map(tie => [tie.name, tie.earlierName, tie.affinity]), [['John Carlson', 'Earlier One', -19], ['John Carlson', 'Earlier Two', 21]]);
  assert.equal(namesById(world).get(200), 'Deceased Creditor');
  assert.equal(viewModel(initialUiState()), null);
});
