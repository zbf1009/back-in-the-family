import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendStory, chronicleForNode, createNotebook, currentLifePhase, entryContext, exportNotebook, journalMemberLines, journalRange, JOURNAL_EXPANSION_SIZE, JOURNAL_RANGE_SIZE, type AdmittedChoiceContext, type LifeNotebook } from '../../src/main/life-journal.ts';
import { keyedStore } from '../../src/main/persistent-store.ts';
import { renderStoryEvent } from '../../src/main/journal-templates.ts';
import type { ActorContext, StoryActor, StoryBatch, StoryChronicle, StoryEvent } from '../../src/shared/story.ts';
import type { PlayerLifecycleFact, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const native: { actors: StoryActor[]; events: StoryEvent[]; chronicle: StoryChronicle[]; openingBatch: StoryBatch } = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
const baseline: WorldSnapshot = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205-opening.world.json', import.meta.url), 'utf8'));
const deathProof: { world: WorldSnapshot; facts: { actors: StoryActor[]; death: StoryEvent & { kind: { type: 'death'; person: number } } } } = JSON.parse(readFileSync(new URL('../fixtures/art-sample-seed1205.json', import.meta.url), 'utf8'));
const self = native.actors.find(actor => actor.person === 10)!;
const next = native.actors.find(actor => actor.person === 61)!;
// These modified DTOs are consumer-boundary probes, not native gameplay witnesses.
function batch(events: StoryEvent[] = [], chronicle: StoryChronicle[] = [], actors: StoryActor[] = native.actors): StoryBatch {
  return { version: 1, opening: false, actors, events, chronicle, dreams: [], cursors: { events: { start: '0', end: '0' }, chronicle: { start: '0', end: '0' } } };
}
function contexts(start: number, end = start): ActorContext[] {
  return [{ relativeTo: start, basis: 'observed-day-start', actors: [{ person: 10 }, { person: 61 }, { person: 11, kinRole: 'child' }] }, { relativeTo: end, basis: 'observed-day-end', actors: [{ person: 10 }, { person: 61 }, { person: 11, kinRole: 'parent' }] }];
}
function event(id: string, tick: string, kind: StoryEvent['kind'], actorContext = contexts(10)): StoryEvent {
  return { id, tick, kind, actorContext, causedBy: [], tags: 0, relevance: 'self', relevanceBasis: 'observed-day-start-end' };
}
const death = event('9007199254740993', '5', { type: 'death', person: 10 }, contexts(10, 61));
const arrival = event('9007199254740995', '5', { type: 'possession', person: 61, price: '10' }, contexts(10, 61));
const lifecycle: PlayerLifecycleFact[] = [{ event: death.id, tick: death.tick, kind: 'death', body: 10, name: self.name, origin: 'native' }, { event: arrival.id, tick: arrival.tick, kind: 'possession', body: 61, name: next.name, origin: 'possessed' }];
function add(notebook: LifeNotebook, facts: StoryBatch, binding: Parameters<typeof appendStory>[2] = {}): LifeNotebook {
  return appendStory(notebook, [{ worldId: notebook.worldId, batch: facts }], binding);
}
function initial(): LifeNotebook {
  return add(createNotebook(7), batch(), { world: baseline });
}

test('Same-day lifecycle Event IDs close life, retain waiting facts, and then open the new body', () => {
  const before = event('9007199254740992', '5', { type: 'social', kind: 'help', doer: 10, target: 11, intensity: 50 }, contexts(10, 61));
  const waiting = event('9007199254740994', '5', { type: 'haunting', ghost: 10, target: 11, intensity: '50', price: '2' }, contexts(10, 61));
  const after = event('9007199254740996', '5', { type: 'social', kind: 'gift', doer: 61, target: 11, intensity: 50 }, contexts(10, 61));
  const notebook = add(initial(), batch([after, arrival, waiting, death, before]), { lifecycle: [...lifecycle].reverse() });
  assert.deepEqual([before, death, waiting, arrival, after].map(record => entryContext(notebook, `e:${record.id}`)!.phase.key), ['7/life/10', '7/life/10', '7/waiting/10', '7/life/61', '7/life/61']);
  for (const record of [before, death, waiting, arrival, after]) {
    const captured = entryContext(notebook, `e:${record.id}`)!;
    assert.ok(captured.actorContext.every(context => context.relativeTo === captured.focus));
    assert.equal(notebook.events.get(record.id), record);
    assert.equal(record.actorContext.length, 2, 'render filtering never rewrites raw ActorContexts');
  }
  const ghost = entryContext(notebook, `e:${waiting.id}`)!;
  assert.equal(ghost.focus, 10);
  const rendering = { ...waiting, actorContext: [...ghost.actorContext] };
  assert.equal(journalRange(notebook, { playerSoul: self.soulId, currentBody: 61 }).find(group => group.members.at(0) === `e:${waiting.id}`)!.text, renderStoryEvent(rendering, ghost.actors, { playerSoul: ghost.playerSoul, currentBody: ghost.focus, formerBodies: ghost.formerBodies }));
  assert.equal(currentLifePhase(notebook)!.key, '7/life/61');
});

test('Entry-local roots and names survive rebirth, late history and PersonSoul reassignment', () => {
  const old = event('1', '1', { type: 'social', kind: 'help', doer: 10, target: 11, intensity: 50 });
  const original = add(initial(), batch([old]));
  const captured = entryContext(original, 'e:1')!;
  const oldText = journalRange(original, { playerSoul: self.soulId, currentBody: 10 })[0]!.text;
  const reborn = add(original, batch([death, arrival], [], [{ ...self, soulId: 'another-soul', name: 'Later assigned name', sex: 'male' }, next]), { lifecycle });
  assert.equal(entryContext(reborn, 'e:1'), captured);
  assert.equal(captured.actors.get(10)!.name, self.name);
  assert.equal(captured.actors.get(10)!.soulId, self.soulId);
  assert.equal(captured.actors.get(10)!.sex, self.sex);
  assert.equal(reborn.actors.get(10)!.sex, 'male');
  assert.equal(journalRange(reborn, { playerSoul: self.soulId, currentBody: 61 }).find(group => group.members.at(0) === 'e:1')!.text, oldText);
  assert.equal(original.events.size, 1);
  const late = event('2', '2', { type: 'marriage', a: 10, b: 11 });
  const after = add(reborn, batch([late], [], []));
  assert.equal(entryContext(after, 'e:2')!.phase.key, '7/life/10');
  assert.equal(entryContext(after, 'e:2')!.actors.get(10)!.name, self.name);
  assert.equal(after.actors.get(10)!.name, 'Later assigned name');
  assert.equal(entryContext(after, `e:${arrival.id}`)!.formerBodies.get(10)!.person, 10);
  assert.equal(captured.formerBodies.get(61), undefined, 'future lives cannot become earlier selves in an old entry');
});

test('Chronicle empty appended uses exact admitted node, while unadmitted next-day ghost context stays waiting', () => {
  const record: StoryChronicle = { ...native.chronicle[0]!, index: '9007199254740993', node: 'new-body-node', tick: '5', applied: 'ask_for_nothing', source: 'external', appended: [], actorContext: contexts(10, 61) };
  const alive = initial();
  const transitioned = add(alive, batch([death, arrival]), { lifecycle });
  const phase = currentLifePhase(transitioned)!;
  const admission: AdmittedChoiceContext = { phase, playerSoul: self.soulId, focus: 61, actors: alive.actors };
  const choices = keyedStore<string, AdmittedChoiceContext>().set(record.node!, admission);
  const reborn = add(alive, batch([death, arrival], [record]), { lifecycle, choices });
  assert.equal(chronicleForNode(reborn, record.node!), record);
  assert.equal(chronicleForNode(reborn, 'unrelated-node'), null);
  const captured = entryContext(reborn, `c:${record.index}`)!;
  assert.equal(captured.phase, phase);
  assert.equal(captured.focus, 61);
  assert.equal(captured.actors, admission.actors);
  assert.ok(captured.actorContext.every(context => context.relativeTo === 61));
  assert.equal(record.appended.length, 0);
  const waitingNotebook = add(initial(), batch([death]), { lifecycle: lifecycle.slice(0, 1) });
  const ghostRecord = { ...record, index: '2', node: 'ghost-node', tick: '6', actorContext: contexts(10) };
  const ghost = add(waitingNotebook, batch([], [ghostRecord]));
  assert.equal(entryContext(ghost, 'c:2')!.phase.key, '7/waiting/10');
  const closingRecord = { ...record, index: '3', node: 'closing-node', actorContext: contexts(10, 61) };
  const closing = add(reborn, batch([], [closingRecord]));
  assert.equal(entryContext(closing, 'c:3')!.phase.key, '7/life/10');
  const earlier = { ...record, index: '1' };
  const duplicateNode = add(reborn, batch([], [earlier]));
  assert.equal(chronicleForNode(duplicateNode, record.node!), earlier);
  assert.equal(chronicleForNode(reborn, record.node!), record);
});
test('A next-day Chronicle retains the native dead body ID as its waiting focus without an explicit admission or latest World', () => {
  const alive = add(createNotebook(7), native.openingBatch, { world: baseline });
  const dead = add(alive, batch([deathProof.facts.death], [], deathProof.facts.actors));
  const record = { ...native.chronicle[0]!, index: '100', tick: deathProof.world.tick, node: 'unadmitted-wait', appended: [], actorContext: deathProof.facts.death.actorContext };
  const notebook = add(dead, batch([], [record], []));
  const captured = entryContext(notebook, `c:${record.index}`)!;
  assert.equal(captured.phase.kind, deathProof.world.player.place);
  assert.equal(captured.focus, deathProof.world.player_wait!.ghost);
  assert.equal(captured.phase.person, entryContext(notebook, `e:${deathProof.facts.death.id}`)!.phase.person);
  assert.notEqual(captured.phase.key, entryContext(notebook, `e:${deathProof.facts.death.id}`)!.phase.key);
  assert.equal(currentLifePhase(notebook)!.key, captured.phase.key);
});

test('A newly admitted native Death enriches only its old-life actor root with native age at death', () => {
  const alive = add(createNotebook(7), native.openingBatch, { world: baseline });
  const identity = alive.identities.at(0)!;
  const previous = entryContext(alive, identity)!;
  const actor = deathProof.facts.actors.find(candidate => candidate.person === deathProof.facts.death.kind.person)!;
  const notebook = add(alive, batch([deathProof.facts.death], [], deathProof.facts.actors), { world: deathProof.world });
  const captured = entryContext(notebook, `e:${deathProof.facts.death.id}`)!;
  assert.equal(previous.actors.get(actor.person)!.ageAtDeath, undefined);
  assert.equal(entryContext(notebook, identity), previous);
  assert.equal(captured.actors.get(actor.person)!.ageAtDeath, actor.ageAtDeath);
  assert.deepEqual(captured.actors.get(actor.person), actor);
  assert.equal(captured.phase.kind, 'life');
  const group = journalRange(notebook, { playerSoul: self.soulId, currentBody: null }).find(group => group.members.at(0) === `e:${deathProof.facts.death.id}`)!;
  assert.ok(group.text.includes(actor.ageAtDeath!));
});

test('Exact get-only node admission outranks a native linked waiting event, which outranks day-start life', () => {
  const alive = add(createNotebook(7), native.openingBatch, { world: baseline });
  const living = entryContext(alive, alive.identities.at(0)!)!;
  const offering = native.events.find(record => record.kind.type === 'offering' && record.tick === deathProof.facts.death.tick)!;
  const dead = add(alive, batch([deathProof.facts.death, offering], [], native.actors));
  const linked = entryContext(dead, `e:${offering.id}`)!;
  assert.equal(linked.phase.kind, 'waiting');
  const record = { ...native.chronicle[0]!, index: '100', tick: offering.tick, node: 'admitted-native-focus', appended: [offering.id], actorContext: offering.actorContext };
  const fromLink = add(dead, batch([], [record], []));
  const linkedRecord = entryContext(fromLink, `c:${record.index}`)!;
  assert.equal(linkedRecord.phase, linked.phase);
  assert.equal(linkedRecord.actors, linked.actors);
  assert.equal(linkedRecord.focus, linked.focus);
  const admission: AdmittedChoiceContext = { phase: living.phase, playerSoul: living.playerSoul, focus: living.focus,
    actors: living.actors, actorContext: living.actorContext, formerBodies: living.formerBodies };
  const reads: string[] = [];
  const exact = { ...record, index: '101' };
  const notebook = add(fromLink, batch([], [exact], []), { choices: { get(node) { reads.push(node); return node === exact.node ? admission : undefined; } } });
  const captured = entryContext(notebook, `c:${exact.index}`)!;
  assert.deepEqual(reads, [exact.node]);
  assert.equal(captured.phase, admission.phase);
  assert.equal(captured.actors, admission.actors);
  assert.equal(captured.formerBodies, admission.formerBodies);
  assert.equal(captured.actors.get(self.person)!.ageAtDeath, undefined);
  assert.equal(captured.formerBodies.get(self.person), undefined);
  assert.ok(captured.actorContext.every(context => context.relativeTo === admission.focus));
  assert.equal(notebook.chronicle.get(exact.index), exact);
});



test('Same-week repeat and weekly groups never cross life/wait/new-life boundaries', () => {
  const records = Array.from({ length: 18 }, (_, index) => {
    const id = index < 6 ? String(index + 1) : index < 12 ? String(21 + index) : String(41 + index);
    return event(id, '5', { type: 'social', kind: index % 2 ? 'gift' : 'help', doer: 11, target: 10, intensity: 50 }, contexts(10, 61));
  });
  const d = { ...death, id: '20' }, a = { ...arrival, id: '50' };
  const own = [{ ...lifecycle[0]!, event: d.id }, { ...lifecycle[1]!, event: a.id }];
  const notebook = add(initial(), batch([...records, d, a]), { lifecycle: own });
  const groups = journalRange(notebook, { playerSoul: self.soulId, currentBody: 61 });
  const stretches = groups.filter(group => !group.milestone);
  assert.equal(stretches.length, 3);
  assert.deepEqual(stretches.map(group => group.phase!.key), ['7/life/10', '7/waiting/10', '7/life/61']);
  assert.ok(stretches.every(group => group.count === 6));
  assert.equal(new Set(groups.flatMap(group => [...group.members])).size, notebook.identities.length);
});

test('Late linked facts retain their own context, raw export, old roots and bounded read selection', () => {
  const record = { ...native.chronicle[0]!, index: '1', node: 'late-node', tick: '2', appended: ['9007199254740993'], actorContext: contexts(10) };
  const before = add(initial(), batch([], [record]));
  const fact = event(record.appended[0]!, '2', { type: 'social', kind: 'help', doer: 10, target: 11, intensity: 50 });
  const after = add(before, batch([fact]));
  assert.equal(before.events.size, 0);
  assert.equal(before.journal.chronicles.get('1')!.missing, 1);
  assert.equal(after.journal.chronicles.get('1')!.missing, 0);
  assert.equal(entryContext(after, 'c:1'), entryContext(before, 'c:1'));
  assert.equal(entryContext(after, `e:${fact.id}`)!.phase.key, '7/life/10');
  const events = Array.from({ length: 360 }, (_, index) => event(String(index + 1), String(index + 10), { type: 'marriage', a: 10, b: 11 }));
  const full = add(after, batch(events));
  const reads: string[] = [];
  const tracked = { ...full, events: new Proxy(full.events, { get(target, property, receiver) { if (property === 'get') return (id: string) => { reads.push(id); return target.get(id); }; if (property === Symbol.iterator || property === 'values') return () => { throw Error('No historical enumeration during rendering'); }; return Reflect.get(target, property, receiver); } }) };
  const groups = journalRange(tracked, { playerSoul: self.soulId, currentBody: 61 }, 'life');
  assert.equal(groups.length, JOURNAL_RANGE_SIZE);
  assert.equal(reads.length, JOURNAL_RANGE_SIZE);
  const joined = journalRange(after, { playerSoul: self.soulId, currentBody: 61 })[0]!;
  assert.ok(journalMemberLines(joined, after, { playerSoul: self.soulId, currentBody: 61 }).length <= JOURNAL_EXPANSION_SIZE);
  const exported = exportNotebook(full);
  assert.deepEqual(Object.keys(exported).sort(), ['worldId', 'actors', 'events', 'chronicle', 'dreams', 'identities', 'opening', 'cursors'].sort());
  assert.equal(exported.events[fact.id], fact);
  assert.equal(exported.chronicle['1'], record);
  const newBody = add(full, batch([arrival]), { lifecycle: lifecycle.slice(1) });
  assert.equal(add(newBody, batch(), { world: baseline }).phases.current!.key, newBody.phases.current!.key, 'an older native World cannot roll current identity back');
  assert.equal(appendStory(full, [{ worldId: 8, batch: batch([fact]) }]), full);
});
