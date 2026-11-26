import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendStory, createNotebook, exportNotebook, journalGroupCount, journalMemberLines, journalRange, latestPrimaryIdentity, latestTownEvent, JOURNAL_EXPANSION_SIZE, JOURNAL_RANGE_SIZE, type LifeNotebook } from '../../src/main/life-journal.ts';
import { keyedStore, PersistentSequence } from '../../src/main/persistent-store.ts';
import type { DreamFact, StoryActor, StoryBatch, StoryChronicle, StoryEvent } from '../../src/shared/story.ts';

const native: { events: StoryEvent[]; chronicle: StoryChronicle[]; actors: StoryActor[] } = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
const context = { playerSoul: 'S-0010', currentBody: 10 };
// These are consumer-boundary probes derived from native fact shapes, not gameplay evidence.
const repayment = native.events.find(event => event.kind.type === 'repayment' && event.causedBy.length)!;
const social = native.events.find(event => event.kind.type === 'social')!;
const milestone = native.events.find(event => event.kind.type === 'death' && event.kind.person === 10)!;
const record = native.chronicle[0]!;
function batch(events: StoryEvent[] = [], chronicle: StoryChronicle[] = [], opening = false): StoryBatch {
  return { version: 1, opening, actors: [], events, chronicle, dreams: [], cursors: { events: { start: '0', end: '0' }, chronicle: { start: '0', end: '0' } } };
}
function add(notebook: LifeNotebook, facts: StoryBatch): LifeNotebook {
  return appendStory(notebook, [{ worldId: notebook.worldId, batch: facts }]);
}
function payment(id: string, tick: string): StoryEvent {
  return { ...repayment, id, tick, relevance: 'background', kind: { type: 'repayment', payer: 10, payee: 11, amount: '9007199254740993' }, causedBy: ['18446744073709551615', '9007199254740993'], actorContext: [] };
}

test('Persistent keyed stores and identity sequences share untouched paths and preserve old roots', () => {
  let store = keyedStore<number, object>();
  let sequence = new PersistentSequence<number>();
  for (let index = 0; index < 1024; index++) { store = store.set(index, { index }); sequence = sequence.append(index); }
  const oldStore = store, oldSequence = sequence;
  const changed = { index: 1024 };
  store = store.set(1024, changed);
  sequence = sequence.append(1024);
  assert.equal(store.root!.left, oldStore.root!.left);
  assert.equal(sequence.tree.root!.left, oldSequence.tree.root!.left);
  assert.equal(oldStore.get(1024), undefined);
  assert.equal(oldSequence.at(1024), undefined);
  assert.equal(oldStore.size, 1024);
  assert.equal(oldSequence.length, 1024);
  assert.equal(store.set(1024, changed), store);
  assert.equal(store.delete(-1), store);
  assert.deepEqual(sequence.slice(1000, 1004), [1000, 1001, 1002, 1003]);
  assert.equal(sequence.at(-1), 1024);
});

test('Late Chronicle claims steal from repeated/weekly groups in native Chronicle order without changing prior roots', () => {
  const events = Array.from({ length: 5 }, (_, index) => payment(String(index + 1), '1'));
  events.push({ ...social, id: '6', tick: '2', relevance: 'background', actorContext: [] });
  const before = add(createNotebook(9), batch(events));
  const beforeExport = exportNotebook(before);
  assert.equal(journalGroupCount(before, 'town'), 1);
  assert.equal(journalRange(before, context, 'town')[0]!.id, '9:e:1');
  const later = add(before, batch([], [{ ...record, index: '9007199254740994', tick: '3', appended: ['1', '2'] }]));
  assert.equal(journalGroupCount(later, 'town'), 2);
  assert.deepEqual([...journalRange(later, context, 'life')[0]!.members], ['c:9007199254740994', 'e:1', 'e:2']);
  const earlier = add(later, batch([], [{ ...record, index: '9007199254740993', tick: '4', appended: ['2'] }]));
  const groups = journalRange(earlier, context, 'life');
  const firstOwner = groups.find(group => group.id === '9:c:9007199254740993')!;
  const laterOwner = groups.find(group => group.id === '9:c:9007199254740994')!;
  assert.deepEqual([...firstOwner.members], ['c:9007199254740993', 'e:2']);
  assert.deepEqual([...laterOwner.members], ['c:9007199254740994', 'e:1']);
  assert.deepEqual(exportNotebook(before), beforeExport);
  assert.deepEqual([...journalRange(later, context, 'life')[0]!.members], ['c:9007199254740994', 'e:1', 'e:2']);
  assert.deepEqual(new Set(journalRange(earlier, context).flatMap(group => [...group.members])), new Set(earlier.identities));
});

test('Late linked events clear every missing notice but join only the earliest claimant', () => {
  const pending = add(createNotebook(9), batch([], [
    { ...record, index: '9', tick: '20', appended: ['9007199254740994', '9007199254740993'] },
    { ...record, index: '8', tick: '20', appended: ['9007199254740993'] },
  ]));
  assert.ok(journalRange(pending, context).every(group => /not reached/.test(group.text)));
  const complete = add(pending, batch([
    payment('9007199254740994', '18'), payment('9007199254740993', '19'),
  ]));
  const groups = journalRange(complete, context);
  assert.ok(groups.every(group => !/not reached/.test(group.text)));
  assert.deepEqual([...groups.find(group => group.id === '9:c:8')!.members], ['c:8', 'e:9007199254740993']);
  assert.deepEqual([...groups.find(group => group.id === '9:c:9')!.members], ['c:9', 'e:9007199254740994']);
  assert.equal(groups.find(group => group.id === '9:c:9')!.from, '18');
  assert.ok(journalRange(pending, context).every(group => /not reached/.test(group.text)));
});

test('Cross-week repayment extension removes only its old weekly contribution and retains exact aggregates', () => {
  const payments = Array.from({ length: 5 }, (_, index) => payment(String(index + 1), '1'));
  const other = { ...social, id: '6', tick: '2', relevance: 'background' as const, actorContext: [] };
  const before = add(createNotebook(9), batch([...payments, other]));
  assert.equal(journalGroupCount(before, 'town'), 1);
  const after = add(before, batch([payment('7', '8')]));
  const groups = journalRange(after, context, 'town');
  assert.equal(groups.length, 2);
  const merged = groups.find(group => group.id === '9:e:1')!;
  assert.equal(merged.count, 6);
  assert.equal(merged.sum, (6n * 9007199254740993n).toString());
  assert.equal(merged.from, '1'); assert.equal(merged.to, '8');
  assert.deepEqual([...merged.members], ['e:1', 'e:2', 'e:3', 'e:4', 'e:5', 'e:7']);
  assert.equal(journalRange(before, context, 'town')[0]!.count, 6);
  const singleBucket = add(createNotebook(9), batch(Array.from({ length: 6 }, (_, index) => payment(String(index + 1), '1'))));
  assert.equal(journalRange(singleBucket, context, 'town')[0]!.sum, (6n * 9007199254740993n).toString(), 'one repeated constituent is not rewritten as a weekly stretch');
});

test('Opening and observed contexts remain distinct, and weekly members retain native tick/ID order', () => {
  let notebook = add(createNotebook(9), batch([payment('1', '1')], [], true));
  notebook = add(notebook, batch([payment('2', '1')]));
  assert.equal(journalGroupCount(notebook, 'town'), 2);
  assert.deepEqual(journalRange(notebook, context, 'town').map(group => group.opening), [true, false]);
  const contextual = { ...payment('3', '1'), actorContext: repayment.actorContext };
  notebook = add(notebook, batch([contextual]));
  assert.equal(journalGroupCount(notebook, 'town'), 3);
  const interleaved = Array.from({ length: 12 }, (_, index) => ({ ...social, id: String(index + 1), tick: String(index % 6), relevance: 'background' as const, actorContext: [], kind: { type: 'social' as const, kind: index % 2 ? 'gift' as const : 'help' as const, doer: 10, target: 11, intensity: 20 } }));
  const weekly = add(createNotebook(9), batch(interleaved));
  const group = journalRange(weekly, context, 'town')[0]!;
  const expected = [...interleaved].sort((a, b) => Number(BigInt(a.tick) - BigInt(b.tick)) || Number(BigInt(a.id) - BigInt(b.id))).map(event => `e:${event.id}`);
  assert.deepEqual([...group.members], expected);
  assert.deepEqual(journalMemberLines(group, weekly, context, 3).map(line => line.identity), expected.slice(3));
});

test('Section and endpoint are selected before rendering; body/actor changes touch visible text only', () => {
  const events = Array.from({ length: 360 }, (_, index) => ({ ...milestone, id: String(index + 1), tick: String(index), relevance: index % 2 ? 'self' as const : 'background' as const }));
  const original = add(createNotebook(9), batch(events));
  const reads: string[] = [];
  const tracked: LifeNotebook = { ...original, events: new Proxy(original.events, {
    get(target, property, receiver) {
      if (property === 'get') return (id: string) => { reads.push(id); return target.get(id); };
      if (property === 'values' || property === Symbol.iterator) return () => { throw new Error('Rendering must not enumerate retained facts'); };
      return Reflect.get(target, property, receiver);
    },
  }) };
  const page = journalRange(tracked, context, 'life', JOURNAL_RANGE_SIZE);
  assert.equal(page.length, JOURNAL_RANGE_SIZE);
  assert.deepEqual(reads, events.filter(event => event.relevance === 'self').slice(0, JOURNAL_RANGE_SIZE).map(event => event.id));
  reads.length = 0;
  const next = journalRange(tracked, { ...context, currentBody: 61 }, 'town');
  assert.equal(next.length, JOURNAL_RANGE_SIZE);
  assert.deepEqual(reads, events.filter(event => event.relevance === 'background').slice(-JOURNAL_RANGE_SIZE).map(event => event.id));
  assert.equal(journalRange(tracked, context, 'life', 0).length, 0);
  const actor = native.actors.find(actor => actor.person === 10)!;
  const renamed = add(original, { ...batch(), actors: [{ ...actor, name: 'Late native name', ageAtDeath: '60' }] });
  assert.equal(renamed.journal, original.journal);
  assert.equal(renamed.identities, original.identities);
  assert.equal(renamed.events, original.events);
  assert.notEqual(journalRange(renamed, { ...context, currentBody: 61 }, 'life')[0]!.text, journalRange(original, { ...context, currentBody: 61 }, 'life')[0]!.text);
});

test('Long repayment append does not read old facts and summary/expansion materialize only their requested facts', () => {
  const events = Array.from({ length: 4096 }, (_, index) => payment(String(index + 1), String(index)));
  const original = add(createNotebook(9), batch(events));
  const reads: string[] = [];
  const tracked: LifeNotebook = { ...original, events: new Proxy(original.events, {
    get(target, property, receiver) {
      if (property === 'get') return (id: string) => { reads.push(id); return target.get(id); };
      if (property === 'values' || property === Symbol.iterator) return () => { throw new Error('A repayment append must not enumerate history'); };
      return Reflect.get(target, property, receiver);
    },
  }) };
  const after = add(tracked, batch([payment('4097', '4096')]));
  assert.deepEqual(reads, ['4097']);
  assert.equal(journalRange(original, context, 'town')[0]!.count, 4096);
  assert.equal(journalRange(after, context, 'town')[0]!.count, 4097);
  reads.length = 0;
  const group = journalRange(tracked, context, 'town')[0]!;
  assert.deepEqual(reads, ['1']);
  assert.equal(group.sum, (4096n * 9007199254740993n).toString());
  reads.length = 0;
  const lines = journalMemberLines(group, tracked, context, 4000);
  assert.equal(lines.length, JOURNAL_EXPANSION_SIZE);
  assert.deepEqual(reads, Array.from({ length: JOURNAL_EXPANSION_SIZE }, (_, index) => String(4001 + index)));
  assert.equal(group.members.at(-1), 'e:4096');
});

test('Dream sequence receipts index raw facts directly and export retains only the complete old JSON shape', () => {
  const dream: DreamFact = { eventId: '17', inputSeq: '4', tick: '5', ghost: 10, dreamer: 11, intent: 'warn', price: '2', interpretation: { node: 'dream-17', applied: 'dismiss_dream', source: 'rules_default', rulesDefault: 'dismiss_dream' } };
  const dreamEvent: StoryEvent = { ...milestone, id: dream.eventId, tick: dream.tick, kind: { type: 'dream', ghost: dream.ghost, dreamer: dream.dreamer, price: dream.price }, relevance: 'self', actorContext: [] };
  const before = add(createNotebook(9), batch([dreamEvent]));
  const beforeText = journalRange(before, context)[0]!.text;
  const after = add(before, { ...batch(), dreams: [dream], actors: native.actors });
  assert.equal(after.dreams.get(dream.eventId), dream);
  assert.equal(after.dreamsByInputSeq.get(dream.inputSeq), dream);
  assert.equal(before.dreamsByInputSeq.get(dream.inputSeq), undefined);
  assert.equal(after.identities, before.identities);
  assert.equal(after.journal, before.journal, 'late annotations do not rebuild any grouping or offscreen story text');
  assert.notEqual(journalRange(after, context)[0]!.text, beforeText);
  assert.equal(journalRange(before, context)[0]!.text, beforeText);
  assert.equal(add(after, { ...batch(), dreams: [dream] }), after);
  const exported = exportNotebook(after);
  assert.deepEqual(Object.keys(exported).sort(), ['worldId', 'actors', 'events', 'chronicle', 'dreams', 'identities', 'opening', 'cursors'].sort());
  assert.deepEqual(exported.dreams[dream.eventId], dream);
  assert.deepEqual(JSON.parse(JSON.stringify(exported)), exported);
});

test('Latest primary uses arrival order while promotion uses eligible unclaimed native IDs', () => {
  let notebook = add(createNotebook(9), batch([{ ...milestone, id: '9007199254740994', tick: '1', relevance: 'self' }]));
  notebook = add(notebook, batch([{ ...milestone, id: '2', tick: '2', relevance: 'self' }]));
  assert.equal(latestPrimaryIdentity(notebook), 'e:2');
  notebook = add(notebook, batch([payment('9007199254740994', '3')])); // Duplicate identity cannot alter relevance.
  notebook = add(notebook, batch([payment('9007199254740993', '3')], [], true));
  notebook = add(notebook, batch([payment('9007199254740992', '3'), payment('9007199254740991', '3')]));
  assert.equal(latestTownEvent(notebook, null)!.id, '9007199254740992');
  assert.equal(latestTownEvent(notebook, '9007199254740992'), null);
  const prior = notebook;
  notebook = add(notebook, batch([], [{ ...record, index: '1', tick: '4', appended: ['9007199254740992'] }]));
  assert.equal(latestTownEvent(notebook, null)!.id, '9007199254740991');
  assert.equal(latestTownEvent(prior, null)!.id, '9007199254740992');
  assert.equal(latestPrimaryIdentity(notebook), 'c:1');
});
