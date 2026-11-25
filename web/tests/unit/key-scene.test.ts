import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lifecycleKeyScene, nodeKeyScene, picturePeople } from '../../src/main/key-scene.ts';
import { sceneQueue } from '../../src/main/scene-queue.ts';
import { currentDecision, reduce, type UiState } from '../../src/main/ui-state.ts';
import { identitySummary, viewModel } from '../../src/main/view-model.ts';
import type { Snapshot } from '../../src/shared/protocol.ts';
import type { PlayerFamily, PlayerLifecycleFact, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { pendingSnapshot, uiFor, waitingSnapshot } from './helpers/view.ts';

const families: PlayerFamily[] = ['family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'];
const facts: PlayerLifecycleFact[] = [
  { event: '9007199254740994', tick: '498', kind: 'possession', body: 101, name: 'First arrival', origin: 'possessed' },
  { event: '9007199254740995', tick: '499', kind: 'death', body: 101, name: 'First arrival', origin: 'possessed' },
  { event: '9007199254740996', tick: '500', kind: 'rebuild', body: 102, name: 'Second arrival', origin: 'rebuilt' },
  { event: '9007199254740997', tick: '500', kind: 'death', body: 102, name: 'Second arrival', origin: 'rebuilt' },
];
const nativeProps: { cases: { id: string; world: WorldSnapshot; playerLifecycle: PlayerLifecycleFact[] }[] } =
  JSON.parse(readFileSync(new URL('../../../fixtures/life-view/c4-native-lifecycle-props.json', import.meta.url), 'utf8'));
const nativeCases = nativeProps.cases;
function frame(ui: UiState): Snapshot {
  return { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum, tps: ui.tps, speed: ui.speed,
    actions: [], playerLifecycle: [], playerNode: ui.playerNode };
}

for (const family of families) {
  test(`LV-C4 node binding: ${family} preserves actual context, people, previews and identity`, () => {
    const world = pendingSnapshot(family);
    world.player_soul = '18446744073709551615';
    world.player_node!.id = '9007199254740993';
    const before = JSON.stringify(world);
    const node = world.player_node!;
    const cue = nodeKeyScene(7, world, node);
    assert.deepEqual(cue.identity, [7, world.player_soul, node.id]);
    assert.equal(cue.category, family);
    assert.equal(cue.node, node); assert.equal(cue.lifecycle, null); assert.equal(cue.world, world);
    assert.deepEqual(cue.people.map(person => person.id), [...new Set(node.stakes.who)]);
    const context = cue.lines.join('\n');
    for (const person of cue.people) assert.ok(context.includes(person.name));
    for (const value of [node.stakes.amount, node.stakes.by, node.choice_tick, node.resolves]) assert.ok(context.includes(value));
    const choice = viewModel(uiFor(world))!.choice!;
    assert.deepEqual(choice.options.map(option => option.id), node.options.map(option => option.id));
    for (const [index, option] of choice.options.entries()) assert.equal(option.preview.length, node.options[index]!.preview.length);
    assert.equal(JSON.stringify(world), before);
    assert.notDeepEqual(nodeKeyScene(8, world, node).identity, cue.identity);
    assert.notDeepEqual(nodeKeyScene(7, { ...world, player_soul: '1' }, node).identity, cue.identity);
    assert.notDeepEqual(nodeKeyScene(7, world, { ...node, id: '9007199254740994' }).identity, cue.identity);
  });
}

test('LV-C4 lifecycle binding: each event body remains historical while the latest current Soul is Waiting', () => {
  const world = waitingSnapshot();
  world.player.earlier_bodies.push(...facts.filter(fact => fact.kind === 'death').map(fact => ({ id: fact.body, name: fact.name, origin: fact.origin, death: fact.tick })));
  const ui = uiFor(world);
  const before = JSON.stringify(world);
  for (const fact of facts) {
    const cue = lifecycleKeyScene(7, world, fact);
    assert.deepEqual(cue.identity, [7, fact.event]);
    assert.equal(cue.category, fact.kind === 'death' ? 'death' : 'rebirth');
    assert.equal(cue.lifecycle, fact); assert.equal(cue.node, null);
    assert.deepEqual(cue.people.map(person => [person.id, person.name, person.age, person.origin]), [[fact.body, fact.name, null, fact.origin]]);
    assert.equal(cue.people[0]!.soul, false);
    assert.ok(cue.lines.join('\n').includes(fact.event));
    assert.ok(cue.lines.join('\n').includes(fact.name));
    if (fact.kind !== 'death') {
      assert.ok(!cue.props.includes('cradle'), 'Arrival is not a biological newborn');
      assert.ok(cue.lines.join('\n').includes('not biological birth'));
      assert.ok(!cue.lines.some(line => /age\s+0|newborn|You are .* now/.test(line)));
    }
  }
  assert.equal(identitySummary(ui)!.status, 'waiting'); assert.equal(viewModel(ui)!.body, null);
  assert.equal(JSON.stringify(world), before);
  const birth = { ...facts[0]!, event: '9007199254740998', kind: 'birth' as const, origin: 'native' as const };
  assert.ok(lifecycleKeyScene(7, world, birth).props.includes('cradle'));
  assert.ok(lifecycleKeyScene(7, world, birth).lines.join('\n').includes(birth.tick));
});

test('LV-C4 native lifecycle ages: biological Birth is a known newborn; Possession, Rebuild and death stay unknown', () => {
  const birthCase = nativeCases.find(value => value.id === 'birth')!;
  const birth = birthCase.playerLifecycle[0]!;
  assert.deepEqual([birth.body, birth.event, birth.tick, birth.kind, birth.origin], [42, '5', '2', 'birth', 'native']);
  assert.equal(birthCase.world.residents.find(person => person.id === birth.body)!.age, 0);
  for (const value of nativeCases) {
    const before = JSON.stringify(value.world);
    for (const fact of value.playerLifecycle) {
      const cue = lifecycleKeyScene(7, value.world, fact);
      assert.deepEqual(cue.identity, [7, fact.event]);
      assert.equal(cue.lifecycle, fact);
      assert.deepEqual(cue.people.map(person => [person.id, person.name, person.age, person.origin, person.visual]),
        [[fact.body, fact.name, fact.kind === 'birth' ? 0 : null, fact.origin, fact.kind === 'birth' ? 'baby' : 'unknown_age']]);
      assert.equal(cue.props.includes('cradle'), fact.kind === 'birth');
    }
    assert.equal(JSON.stringify(value.world), before);
  }
});

test('LV-C4 historical lifecycle ages never borrow a later current body age or infer infancy for other events', () => {
  const birthWorld = nativeCases.find(value => value.id === 'birth')!.world;
  for (const fact of nativeCases.flatMap(value => value.playerLifecycle)) {
    for (const age of [0, 8, 73]) {
      const world = { ...birthWorld, tick: String(BigInt(fact.tick) + BigInt(age) * 365n + 1n),
        residents: birthWorld.residents.map(person => person.id === fact.body ? { ...person, age, name: fact.name, origin: fact.origin } : person) };
      assert.equal(picturePeople(world, [fact.body], null)[0]!.age, age, 'The current-body projection still uses the current age');
      const historical = lifecycleKeyScene(7, world, fact).people[0]!;
      assert.deepEqual([historical.id, historical.name, historical.age, historical.visual],
        [fact.body, fact.name, fact.kind === 'birth' ? 0 : null, fact.kind === 'birth' ? 'baby' : 'unknown_age']);
    }
  }
});

test('LV-C4 closed coverage: real lifecycle ordering is event-local within funeral, Dream, arrival and node slots', () => {
  const world = { ...waitingSnapshot(), last_dream: { tick: '500', dreamer: 1, applied: 'take_comfort' as const }, player_node: pendingSnapshot('inheritance').player_node };
  const queue = sceneQueue(['player_died', 'dream_resolved', 'player_reborn', 'player_node'], world, 3, [facts[3]!, facts[0]!, facts[1]!, facts[2]!, facts[0]!]);
  assert.deepEqual(queue.map(entry => entry.keyScene?.lifecycle?.event ?? entry.kind), ['9007199254740995', '9007199254740997', 'dream', '9007199254740994', '9007199254740996', 'inheritance']);
  assert.equal(queue[2]!.keyScene, null, 'Dream remains static');
  assert.equal(new Set(queue.map(entry => entry.identity)).size, queue.length);
  assert.deepEqual(sceneQueue(['player_died', 'player_reborn'], { ...world, player_node: null, last_dream: undefined }, 3, []), [], 'Pause reasons alone cannot manufacture a lifecycle event');
  assert.deepEqual(sceneQueue([], { ...world, player_node: null }, 3, []), [], 'Ordinary World facts and Chronicle never acquire a performance');
});

test('LV-C4 picture references: unknown people never borrow a living actor or a deceased grave', () => {
  const world = pendingSnapshot('feud');
  world.player.earlier_bodies = [{ id: 101, name: 'Known earlier body', origin: 'rebuilt', death: '20' }];
  world.person_names = [{ id: 100, name: 'Known deceased name' }];
  const people = picturePeople(world, [1, 100, 101, 999999, 999999], world.player_node);
  assert.deepEqual(people.map(person => [person.id, person.lifeStatus]), [[1, 'alive'], [100, 'deceased'], [101, 'deceased'], [999999, 'unknown']]);
  assert.equal(people[3]!.name, 'Person 999999'); assert.equal(people[3]!.age, null); assert.equal(people[3]!.soul, false);
});

test('LV-C4 episode dedup: a closed scene cannot replay on duplicate stop or empty follow-up delivery', () => {
  const world = waitingSnapshot();
  let ui = uiFor(world);
  const snapshot: Snapshot = { ...frame(ui), playerLifecycle: facts, stop: { reasons: ['player_died', 'player_reborn'], world } };
  ui = reduce(ui, { type: 'status', snapshot });
  const entries = ui.scene!.entries;
  ui = reduce(ui, { type: 'scene-close', expected: { worldId: 1, tick: world.tick, entry: entries[0]! } });
  const remaining = ui.scene;
  ui = reduce(ui, { type: 'status', snapshot });
  assert.equal(ui.scene, remaining);
  while (ui.scene !== null) ui = reduce(ui, { type: 'scene-close', expected: { worldId: 1, tick: world.tick, entry: ui.scene.entries[0]! } });
  ui = reduce(ui, { type: 'status', snapshot });
  ui = reduce(ui, { type: 'status', snapshot: { ...snapshot, playerLifecycle: [] } });
  assert.equal(ui.scene, null); assert.equal(ui.tick, world.tick); assert.equal(currentDecision(ui), null);
  const newer = { ...world, tick: '501' };
  const next = { ...facts[0]!, event: '9007199254740998', tick: '501' };
  ui = reduce(ui, { type: 'status', snapshot: { ...frame(ui), tick: newer.tick, playerLifecycle: [next], stop: { reasons: ['player_reborn'], world: newer } } });
  assert.deepEqual(ui.scene!.entries.map(entry => entry.identity), [JSON.stringify([1, next.event])]);
});
