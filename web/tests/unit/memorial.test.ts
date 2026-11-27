import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActorContext, StoryActor, StoryEvent } from '../../src/shared/story.ts';
import type { Kinship } from '../../src/shared/world-snapshot.ts';
import type { EntryContext, LifePhase } from '../../src/main/life-context.ts';
import { captureMemorial, enrichMemorial, memorialKeyScene, memorialSceneEntry, offeredFamilyDeathNode } from '../../src/main/memorial.ts';
import { nodeKeyScene } from '../../src/main/key-scene.ts';
import { resolveVisualKey } from '../../src/art/sprites.ts';
import { pendingSnapshot, snapshot } from './helpers/view.ts';

function source(role: Kinship | null = 'parent', basis: ActorContext['basis'] = 'observed-day-start') {
  const world = structuredClone(snapshot);
  world.player_node = null;
  const body = world.player.body!;
  const deceased = 999999;
  const phase: LifePhase = { key: `7/life/${body}`, worldId: 7, kind: 'life', person: body, name: 'Current Player' };
  const actors = new Map<number, StoryActor>([
    [body, { person: body, soulId: world.player_soul, name: 'Current Player', sex: 'male', origin: 'native' }],
    [deceased, { person: deceased, soulId: '900', name: 'Olive Cooper', sex: 'female', origin: 'native', ageAtDeath: '60' }],
  ]);
  const actorContext: ActorContext[] = [{ relativeTo: body, basis, actors: [{ person: body }, { person: deceased, ...(role === null ? {} : { kinRole: role }) }] }];
  const event: StoryEvent = { id: '9007199254740993', tick: '499', kind: { type: 'death', person: deceased }, causedBy: [],
    tags: 0, relevance: 'circle', relevanceBasis: 'observed-day-start-end', actorContext };
  const context: EntryContext = { phase, playerSoul: world.player_soul, focus: body, actors, actorContext, formerBodies: new Map() };
  return { worldId: 7, world, event, context, currentPhase: phase, opening: false, actors, deceased, body };
}

for (const [role, sex, noun] of [
  ['spouse', 'female', 'wife'], ['spouse', 'male', 'husband'], ['parent', 'female', 'mother'], ['parent', 'male', 'father'],
  ['child', 'female', 'daughter'], ['child', 'male', 'son'], ['sibling', 'female', 'sister'], ['sibling', 'male', 'brother'],
] as const) {
  test(`Memorial selects event-local ${noun} and preserves exact Death identity`, () => {
    const input = source(role);
    input.actors.set(input.deceased, { ...input.actors.get(input.deceased)!, sex });
    const before = JSON.stringify(input.world);
    const capture = captureMemorial(input)!;
    assert.ok(capture);
    assert.deepEqual([capture.playerBody, capture.heir, capture.phaseKey], [input.body, input.body, input.currentPhase.key]);
    assert.deepEqual([capture.name, capture.date, capture.nativeAge, capture.kinRole, capture.sex], ['Olive Cooper', input.event.tick, '60', role, sex]);
    const entry = memorialSceneEntry(capture);
    assert.equal(entry.node, null); assert.equal(entry.kind, 'funeral');
    assert.deepEqual(entry.keyScene!.source, { kind: 'event', eventId: input.event.id });
    assert.deepEqual(entry.keyScene!.identity, [input.worldId, input.event.id]);
    assert.equal(entry.keyScene!.memorial, true); assert.equal(entry.keyScene!.lifecycle, null);
    assert.ok(entry.keyScene!.lines.some(line => line.includes('Olive') && line.includes('60')));
    assert.equal(JSON.stringify(input.world), before);
  });
}

test('Memorial excludes opening, ghosts, former lives, other focuses, own Death and non-Death', () => {
  const input = source();
  const waiting = { ...input.currentPhase, key: `7/waiting/${input.body}`, kind: 'waiting' as const };
  for (const invalid of [
    { ...input, opening: true },
    { ...input, event: { ...input.event, relevanceBasis: 'opening-current' as const } },
    { ...input, context: null },
    { ...input, currentPhase: null },
    { ...input, context: { ...input.context, phase: waiting }, currentPhase: waiting },
    { ...input, currentPhase: { ...input.currentPhase, key: '7/life/900', person: 900 } },
    { ...input, context: { ...input.context, focus: 900 } },
    { ...input, worldId: 8 },
    { ...input, event: { ...input.event, kind: { type: 'death' as const, person: input.body } } },
    { ...input, event: { ...input.event, kind: { type: 'birth' as const, person: input.deceased } } },
  ]) assert.equal(captureMemorial(invalid), null);
});

test('Memorial never promotes extended kin, affinity or another body context into a near-kin role', () => {
  for (const role of ['former_spouse', 'grandparent', 'grandchild', 'cousin', 'in_law', null] as const) {
    const input = source(role);
    input.world.player.relations = [{ person: input.deceased, affinity: 100, kinship: ['spouse'] }];
    input.world.player.blood_ties = [{ person: input.deceased, affinity: 100, kinship: ['parent'] }];
    assert.equal(captureMemorial(input), null);
  }
  assert.equal(captureMemorial(source('parent', 'opening-current')), null);
  const other = source();
  other.context = { ...other.context, actorContext: [{ ...other.context.actorContext[0]!, relativeTo: other.body + 1 }] };
  assert.equal(captureMemorial(other), null);
});

test('Death uses one consistent observed basis, not whichever yields an eligible kin', () => {
  const input = source('former_spouse');
  input.context = { ...input.context, actorContext: [...input.context.actorContext,
    { relativeTo: input.body, basis: 'observed-day-end', actors: [{ person: input.deceased, kinRole: 'spouse' }] }] };
  assert.equal(captureMemorial(input), null);
  assert.ok(captureMemorial(source('sibling', 'observed-day-end')));
});

test('Memorial freezes name/native age/visual without borrowing a current resident', () => {
  const input = source();
  const capture = captureMemorial(input)!;
  input.actors.set(input.deceased, { ...input.actors.get(input.deceased)!, name: 'Later Name', ageAtDeath: '90' });
  assert.deepEqual([capture.name, capture.nativeAge, capture.people[0]!.age], ['Olive Cooper', '60', 60]);
  assert.equal(capture.people[0]!.visual, resolveVisualKey(input.deceased, 60));
  const absent = source();
  const actor = absent.actors.get(absent.deceased)!;
  absent.actors.set(absent.deceased, { person: actor.person, soulId: actor.soulId, name: actor.name, sex: actor.sex, origin: actor.origin });
  const unknown = captureMemorial(absent)!;
  assert.equal(unknown.people[0]!.age, null);
  assert.deepEqual(memorialKeyScene(unknown).lines, []);
  assert.equal(memorialKeyScene(unknown).document.fields.some(field => field.label === 'Age'), false);
  absent.actors.set(absent.deceased, { ...actor, ageAtDeath: '9007199254740993' });
  const huge = captureMemorial(absent)!;
  assert.equal(huge.people[0]!.age, null);
  assert.equal(huge.nativeAge, '9007199254740993');
});

test('Only the same-world/day/deceased offered FamilyDeath node deduplicates the memorial', () => {
  const input = source();
  const capture = captureMemorial(input)!;
  const world = pendingSnapshot('family_death');
  const node = { ...world.player_node!, fired: input.event.tick, stakes: { ...world.player_node!.stakes, who: [input.deceased, input.body] } };
  assert.equal(offeredFamilyDeathNode(capture, 7, node), node);
  assert.equal(offeredFamilyDeathNode(capture, 8, node), null);
  assert.equal(offeredFamilyDeathNode(capture, 7, null), null);
  assert.equal(offeredFamilyDeathNode(capture, 7, { ...node, family: 'inheritance' }), null);
  assert.equal(offeredFamilyDeathNode(capture, 7, { ...node, fired: '500' }), null);
  assert.equal(offeredFamilyDeathNode(capture, 7, { ...node, stakes: { ...node.stakes, who: [input.deceased + 1] } }), null);
  const cue = nodeKeyScene(7, { ...input.world, player_node: node }, node, input.actors);
  assert.equal(cue.node, node); assert.equal(cue.memorial, undefined);
  assert.deepEqual(cue.lines, ['Olive Cooper has died.', `${input.world.residents.find(person => person.id === input.body)!.name} is left behind.`]);
});

test('Estate requires exact world/day/deceased/captured heir/Death cause and preserves animation identity', () => {
  const input = source();
  const capture = captureMemorial(input)!;
  const entry = memorialSceneEntry(capture);
  const estate: StoryEvent = { ...input.event, id: '9007199254740994', kind: { type: 'inheritance', deceased: input.deceased,
    heir: input.body, amount: '9007199254740993' }, causedBy: [input.event.id] };
  assert.equal(enrichMemorial(capture, 8, [estate]), capture);
  for (const invalid of [
    { ...estate, tick: '500' }, { ...estate, causedBy: [] }, { ...estate, causedBy: ['1'] },
    { ...estate, kind: { ...estate.kind, type: 'inheritance' as const, deceased: input.deceased + 1, heir: input.body, amount: '1' } },
    { ...estate, kind: { type: 'inheritance' as const, deceased: input.deceased, heir: input.body + 1, amount: '1' } },
  ]) assert.equal(enrichMemorial(capture, 7, [invalid]), capture);
  const enriched = enrichMemorial(capture, 7, [estate]);
  assert.deepEqual(enriched.estate, { eventId: estate.id, amount: '9007199254740993' });
  assert.equal(enriched.identity, capture.identity); assert.equal(enriched.people, capture.people); assert.equal(enriched.world, capture.world);
  assert.deepEqual(memorialKeyScene(enriched).identity, entry.keyScene!.identity);
  assert.deepEqual(memorialKeyScene(enriched).source, entry.keyScene!.source);
  assert.equal(enrichMemorial(enriched, 7, [estate]), enriched);
  assert.equal(memorialKeyScene(enriched).lines.length, 2);
  assert.equal(capture.estate, undefined);
});
