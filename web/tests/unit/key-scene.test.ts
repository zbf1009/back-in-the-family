import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dreamKeyScene, dreamResolutionKeyScene, lifecycleKeyScene, nodeKeyScene, picturePeople } from '../../src/main/key-scene.ts';
import { sceneQueue } from '../../src/main/scene-queue.ts';
import { currentDecision, reduce, type UiState } from '../../src/main/ui-state.ts';
import { identitySummary, viewModel } from '../../src/main/view-model.ts';
import type { Snapshot } from '../../src/shared/protocol.ts';
import type { PlayerFamily, PlayerLifecycleFact, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import type { DreamFact, StoryActor, StoryEvent } from '../../src/shared/story.ts';
import { pendingSnapshot, uiFor, waitingSnapshot } from './helpers/view.ts';
import { PERSON_TILES } from '../../src/art/life-view-atlas.ts';

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
    const actualIds = node.family === 'family_death' || world.player.body === null ? node.stakes.who : [world.player.body, ...node.stakes.who];
    assert.deepEqual(cue.people.map(person => person.id), [...new Set(actualIds)]);
    assert.equal(cue.date, node.fired);
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
    if (fact.kind !== 'death') {
      assert.ok(!cue.props.includes('cradle'), 'Arrival is not a biological newborn');
    }
  }
  assert.equal(identitySummary(ui)!.status, 'waiting'); assert.equal(viewModel(ui)!.body, null);
  assert.equal(JSON.stringify(world), before);
  const birth = { ...facts[0]!, event: '9007199254740998', kind: 'birth' as const, origin: 'native' as const };
  assert.ok(lifecycleKeyScene(7, world, birth).props.includes('cradle'));
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
      assert.deepEqual(cue.people.map(person => [person.id, person.name, person.age, person.origin]),
        [[fact.body, fact.name, fact.kind === 'birth' ? 0 : null, fact.origin]]);
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
      assert.deepEqual([historical.id, historical.name, historical.age],
        [fact.body, fact.name, fact.kind === 'birth' ? 0 : null]);
      if (fact.kind === 'possession' || fact.kind === 'rebuild') {
        const actor: StoryActor = { person: fact.body, soulId: world.player_soul, name: fact.name,
          sex: 'male', origin: fact.origin, birthDay: String(BigInt(fact.tick) - 38n * 365n) };
        const known = lifecycleKeyScene(7, world, fact, new Map([[actor.person, actor]]));
        assert.equal(known.people[0]!.age, 38, 'Recorded birth day wins over every later World age');
        assert.ok(!known.props.includes('cradle'));
        const young = lifecycleKeyScene(7, world, fact, new Map([[actor.person, { ...actor, birthDay: fact.tick }]]));
        assert.equal(young.people[0]!.age, 0);
        assert.ok(!PERSON_TILES.baby.some(visual => visual === young.people[0]!.visual), 'Arrival does not establish a newborn portrait');
        assert.ok(!young.props.includes('cradle'));
        assert.equal(lifecycleKeyScene(7, world, fact, new Map([[fact.body + 1, { ...actor, person: fact.body + 1 }]])).people[0]!.age, null);
      }
    }
  }
});

test('Death certificate uses only the matching native actor age, never a later resident age', () => {
  const fact = facts[1]!;
  const world = waitingSnapshot();
  const actor: StoryActor = { person: fact.body, soulId: world.player_soul, name: fact.name,
    sex: 'female', origin: fact.origin, birthDay: '-365', ageAtDeath: '9007199254740993' };
  const absent = lifecycleKeyScene(7, world, fact, new Map([[fact.body + 1, { ...actor, person: fact.body + 1 }]]));
  assert.deepEqual(absent.certificate, { name: fact.name, date: fact.tick });
  const known = lifecycleKeyScene(7, world, fact, new Map([[actor.person, actor]]));
  assert.deepEqual(known.certificate, { name: fact.name, date: fact.tick, age: actor.ageAtDeath });
  assert.equal(known.people[0]!.age, null, 'An unsafe numeric age is never rounded into the portrait');
  assert.deepEqual(lifecycleKeyScene(7, world, fact, new Map([[actor.person, { ...actor, ageAtDeath: '73' }]])).people[0]!.age, 73);
  const arrival = lifecycleKeyScene(7, world, { ...fact, kind: 'possession' }, new Map([[actor.person, actor]]));
  assert.equal(arrival.people[0]!.age, 2);
  assert.ok(!PERSON_TILES.baby.some(visual => visual === arrival.people[0]!.visual));
  assert.ok(!arrival.props.includes('cradle'));
});


test('Lifecycle performances preserve native EventId order independently of event family', () => {
  const world = { ...waitingSnapshot(), last_dream: { tick: '499', dreamer: 1, applied: 'take_comfort' as const }, player_node: pendingSnapshot('inheritance').player_node };
  const queue = sceneQueue(['player_died', 'dream_resolved', 'player_reborn', 'player_node'], world, 3, [facts[3]!, facts[0]!, facts[1]!, facts[2]!, facts[0]!]);
  assert.deepEqual(queue.flatMap(entry => entry.keyScene?.lifecycle === null || entry.keyScene?.lifecycle === undefined ? [] : [entry.keyScene.lifecycle.event]), facts.map(fact => fact.event));
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
  assert.equal(people[3]!.age, null); assert.equal(people[3]!.soul, false);
  assert.ok(!people.slice(0, 3).some(person => person.name === people[3]!.name));
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

test('Exact Dream scenes retain captured input, response date and numeric event order without last_dream inference', () => {
  const world = waitingSnapshot();
  const fact: DreamFact = { eventId: '9007199254740996', inputSeq: '71', tick: '498', ghost: 101, dreamer: 1,
    intent: 'warn', price: '9007199254740993', interpretation: { node: '72', tick: '499', applied: 'take_comfort', source: 'rules_default', rulesDefault: 'take_comfort' } };
  const view = dreamKeyScene(7, world, fact);
  assert.equal(view.world, world); assert.equal(view.dream, fact); assert.equal(view.date, fact.tick);
  assert.deepEqual(view.source, { kind: 'event', eventId: fact.eventId });
  assert.deepEqual(view.people.map(person => person.id), [fact.ghost, fact.dreamer]);
  assert.deepEqual(view.people.map(person => person.age), [null, null], 'Later World ages are not historical Dream ages');
  const actors = new Map<number, StoryActor>([
    [fact.ghost, { person: fact.ghost, soulId: world.player_soul, name: 'Recorded ghost', sex: 'female', origin: 'native', ageAtDeath: '60' }],
    [fact.dreamer, { person: fact.dreamer, soulId: 'recipient-soul', name: 'Recorded recipient', sex: 'male', origin: 'native', birthDay: '-15927' }],
  ]);
  assert.deepEqual(dreamKeyScene(7, world, fact, actors).people.map(person => person.age), [60, 45]);
  const later = { ...world, tick: '40000', residents: world.residents.map(person => ({ ...person, age: 90 })) };
  assert.deepEqual(dreamKeyScene(7, later, fact, actors).people.map(person => person.age), [60, 45]);
  assert.deepEqual(dreamKeyScene(7, later, fact, new Map([[fact.dreamer, { ...actors.get(fact.dreamer)!, birthDay: '499' }]])).people.map(person => person.age), [null, null]);
  const noDate = dreamKeyScene(7, world, { ...fact, interpretation: {
    node: fact.interpretation!.node, applied: fact.interpretation!.applied,
    source: fact.interpretation!.source, rulesDefault: fact.interpretation!.rulesDefault,
  } });
  assert.equal(noDate.dream!.interpretation!.tick, undefined);
  const entries = sceneQueue([], world, 7, [facts[3]!, facts[0]!], new Map(), [fact]);
  assert.deepEqual(entries.map(entry => entry.identity), [facts[0]!.event, fact.eventId, facts[3]!.event].map(event => JSON.stringify([7, event])));
});

test('Fallback Dream captures only resolution facts and its own stop World', () => {
  const world = { ...waitingSnapshot(), last_dream: { tick: '499', dreamer: 1, applied: 'take_comfort' as const } };
  const view = dreamResolutionKeyScene(7, world, world.last_dream);
  const old = lifecycleKeyScene(7, waitingSnapshot(), facts[1]!);
  assert.notEqual(view.world, old.world);
  assert.equal(view.world, world);
  assert.deepEqual(view.source, { kind: 'dream-resolution', ...world.last_dream });
  assert.equal(view.dream, undefined); assert.equal(view.lifecycle, null); assert.equal(view.arrivalPrice, undefined);
  assert.deepEqual(view.people.map(person => person.id), [world.last_dream.dreamer]);
});

test('Arrival price requires exact event, actual arrival kind and matching person', () => {
  const fact = facts[0]!;
  const world = waitingSnapshot();
  const event: StoryEvent = { id: fact.event, tick: fact.tick, kind: { type: 'possession', person: fact.body, price: '9007199254740993' },
    causedBy: [], tags: 0, relevance: 'self', relevanceBasis: 'observed-day-start-end', actorContext: [] };
  assert.equal(lifecycleKeyScene(7, world, fact, new Map(), [event]).arrivalPrice, '9007199254740993');
  for (const invalid of [{ ...event, id: '1' }, { ...event, kind: { type: 'rebuild' as const, person: fact.body, price: '5' } },
    { ...event, kind: { type: 'possession' as const, person: fact.body + 1, price: '5' } }]) {
    assert.equal(lifecycleKeyScene(7, world, fact, new Map(), [invalid]).arrivalPrice, undefined);
  }
});

