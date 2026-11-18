// Feature: first-playable, Property 23: Town layout depends only on IDs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { layoutTown, townDrawList } from '../../src/main/town-layout.ts';
import { initialUiState } from '../../src/main/ui-state.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const RUNS = 1000;
const base: WorldSnapshot = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seed1-pairwise.snapshot-500.json', import.meta.url), 'utf8'));
const householdsArb = fc.uniqueArray(fc.record({
  id: fc.bigInt({ min: 1n, max: 2n ** 64n - 1n }).map(String),
  count: fc.integer({ min: 1, max: 18 }),
}), { selector: house => house.id, minLength: 1, maxLength: 30 }).map(houses => {
  let person = 1;
  return houses.map(house => ({ id: house.id, members: Array.from({ length: house.count }, () => person++) }));
});

test('Property 23: permutations preserve distinct living positions and the unique soul marker', () => {
  fc.assert(fc.property(householdsArb, fc.boolean(), fc.nat(), (households, embodied, chooser) => {
    const members = households.flatMap(house => house.members);
    const body = members[chooser % members.length]!;
    const ui = { ...initialUiState(), world: {
      ...base, households,
      residents: households.flatMap(house => house.members.map(id => ({ ...base.residents[0]!, id, household: house.id }))),
      player: { ...base.player, place: embodied ? 'body' as const : 'waiting' as const, body: embodied ? body : null },
    } };
    const before = JSON.stringify(ui.world);
    const drawing = townDrawList(ui.world);
    const permutation = households.slice().reverse().map(house => ({ ...house, members: house.members.slice().reverse() }));
    assert.deepEqual(layoutTown(permutation), layoutTown(households));
    assert.equal(drawing.residents.length, members.length);
    assert.deepEqual(drawing.residents.map(marker => marker.person).sort((a, b) => a - b), members.slice().sort((a, b) => a - b));
    assert.equal(new Set(drawing.residents.map(marker => `${marker.x},${marker.y}`)).size, members.length);
    assert.deepEqual(drawing.residents.filter(marker => marker.soul).map(marker => marker.person), embodied ? [body] : []);
    assert.equal(JSON.stringify(ui.world), before);
    assert.deepEqual(townDrawList({ ...ui.world, households: permutation }), drawing);
  }), { numRuns: RUNS });
});

test('Town draw list excludes dead household members; an empty town draws no markers', () => {
  const ui = { ...initialUiState(), world: { ...base,
    residents: base.residents.map(person => ({ ...person, alive: person.id !== base.player.body })),
    player: { ...base.player, place: 'waiting' as const, body: null },
  } };
  const drawing = townDrawList(ui.world);
  assert.equal(drawing.residents.length, base.residents.length - 1);
  assert.equal(drawing.residents.some(marker => marker.person === base.player.body), false);
  assert.deepEqual(layoutTown([]), { houses: [], residents: [], height: 20 });
});
