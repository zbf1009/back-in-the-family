import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendStory, createNotebook, entryContext, exportNotebook, journalGroupCount, journalMemberLines, journalRange, latestPrimaryIdentity, latestTownEvent, JOURNAL_EXPANSION_SIZE, JOURNAL_RANGE_SIZE, type LifeNotebook } from '../../src/main/life-journal.ts';
import { keyedStore, PersistentSequence } from '../../src/main/persistent-store.ts';
import { formatMoney } from '../../src/main/calendar.ts';
import type { DreamFact, StoryActor, StoryBatch, StoryChronicle, StoryEvent } from '../../src/shared/story.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const native: { events: StoryEvent[]; chronicle: StoryChronicle[]; actors: StoryActor[] } = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
const openingWorld: WorldSnapshot = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205-opening.world.json', import.meta.url), 'utf8'));
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

test('Persistent value cursors bound ordered ranges and keep their captured root after updates', () => {
  let store = keyedStore<number, number>();
  for (let index = 1023; index >= 0; index--) store = store.set(index, index);
  const oldRoot = store.root;
  const cursor = store.values(1000, 1024);
  assert.equal(cursor.next().value, 1000);
  const changed = store.delete(1001).set(1024, 1024);
  assert.deepEqual([...cursor], Array.from({ length: 23 }, (_, index) => 1001 + index));
  assert.deepEqual([...store.values(1000, 1004)], [1000, 1001, 1002, 1003]);
  assert.deepEqual([...changed.values(1000, 1004)], [1000, 1002, 1003, 1004]);
  assert.deepEqual([...store.values(-3, 3)], [0, 1, 2]);
  assert.deepEqual([...store.values(1024, 1028)], []);
  assert.deepEqual([...store.values(12, 12)], []);
  assert.deepEqual([...store.values(12, 8)], []);
  assert.deepEqual(store.slice(1.5, 3), [2]);
  assert.deepEqual([...store.values(1.5, 3)], [2]);
  assert.equal(store.root, oldRoot);
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

test('Late linked events resolve missing facts and join only the earliest claimant', () => {
  const pending = appendStory(createNotebook(9), [{ worldId: 9, batch: { ...batch([], [
    { ...record, index: '9', tick: '20', appended: ['9007199254740994', '9007199254740993'] },
    { ...record, index: '8', tick: '20', appended: ['9007199254740993'] },
  ]), actors: native.actors } }], { world: openingWorld });
  const pendingExport = exportNotebook(pending);
  const pendingGroups = journalRange(pending, context);
  assert.deepEqual([...pending.journal.links.get('9007199254740993')!.values()], [true, true]);
  assert.equal(pending.journal.links.size, 2);
  assert.deepEqual(pendingGroups.map(group => [...group.members]), [['c:8'], ['c:9']]);
  const captured = entryContext(pending, 'c:9')!;
  assert.equal(captured.focus, context.currentBody);
  assert.equal(captured.phase.kind, 'life');
  assert.equal(captured.phase.person, context.currentBody);
  assert.deepEqual(captured.actorContext, record.actorContext);
  const first = payment('9007199254740994', '18'), shared = payment('9007199254740993', '19');
  const partial = add(pending, batch([first]));
  assert.equal(partial.journal.links.size, 1);
  assert.equal(partial.journal.links.get(first.id), undefined);
  assert.equal(partial.journal.chronicles.get('9')!.missing, 1);
  assert.equal(partial.journal.chronicles.get('8')!.missing, 1);
  const complete = add(partial, batch([shared]));
  assert.equal(complete.journal.links.size, 0);
  assert.equal(complete.journal.claims.get(shared.id), '8');
  assert.equal(complete.events.get(first.id), first);
  assert.equal(complete.events.get(shared.id), shared);
  assert.deepEqual(complete.chronicle.get('9')!.appended, ['9007199254740994', '9007199254740993']);
  assert.equal(entryContext(complete, `e:${first.id}`)!.phase.key, captured.phase.key);
  assert.equal(entryContext(complete, `e:${shared.id}`)!.focus, captured.focus);
  assert.equal(entryContext(complete, 'c:9'), captured);
  assert.equal(add(complete, batch([first, shared])), complete, 'duplicate facts do not notify resolved waiters again');
  const late = add(complete, batch([], [{ ...record, index: '7', tick: '21', appended: [shared.id, shared.id] }]));
  assert.equal(late.journal.links.size, 0, 'available linked facts never register a waiter');
  assert.equal(late.journal.claims.get(shared.id), '7');
  assert.equal(late.journal.chronicles.get('7')!.missing, 0);
  assert.equal(late.journal.chronicles.get('8')!.missing, 0);
  assert.deepEqual(late.chronicle.get('7')!.appended, [shared.id, shared.id]);
  const groups = journalRange(complete, context);
  const completeExport = exportNotebook(complete);
  assert.deepEqual([...groups.find(group => group.id === '9:c:8')!.members], ['c:8', 'e:9007199254740993']);
  assert.deepEqual([...groups.find(group => group.id === '9:c:9')!.members], ['c:9', 'e:9007199254740994']);
  assert.equal(groups.find(group => group.id === '9:c:9')!.from, '18');
  const lines = groups.flatMap(group => journalMemberLines(group, complete, context));
  assert.deepEqual(lines.map(line => line.identity), ['c:9', 'e:9007199254740994', 'c:8', 'e:9007199254740993']);
  for (const event of [first, shared]) {
    const line = lines.find(line => line.identity === `e:${event.id}`)!;
    assert.equal(line.tick, event.tick);
    assert.ok(line.text.includes(formatMoney('9007199254740993')));
    assert.deepEqual(completeExport.events[event.id], event);
  }
  assert.deepEqual(journalRange(complete, { ...context, currentBody: 61 }), groups, 'later body selection does not rewrite captured entries');
  assert.deepEqual(exportNotebook(complete), completeExport, 'rendering and expansion do not alter retained facts');
  assert.deepEqual(journalRange(pending, context), pendingGroups);
  assert.deepEqual(exportNotebook(pending), pendingExport);
  assert.equal(pending.journal.chronicles.get('9')!.missing, 2);
  assert.equal(pending.journal.chronicles.get('8')!.missing, 1);
  assert.equal(pending.journal.links.size, 2, 'resolved links leave old roots intact');
});

test('Cross-week repayment extension removes only its old weekly contribution and retains exact aggregates', () => {
  const payments = Array.from({ length: 5 }, (_, index) => payment(String(index + 1), '1'));
  const other = { ...social, id: '6', tick: '2', relevance: 'background' as const, actorContext: [] };
  const before = add(createNotebook(9), batch([...payments, other]));
  assert.equal(journalGroupCount(before, 'town'), 1);
  for (const section of ['life', 'town', 'all'] as const) assert.equal(before.journal[section].aggregate, undefined);
  const candidates = before.journal.town.at(0)!.constituents!;
  assert.equal(candidates.aggregate.count, 6);
  assert.equal(candidates.aggregate.sum, 5n * 9007199254740993n);
  assert.equal(candidates.at(0)!.references.aggregate.count, 5);
  assert.equal(candidates.at(0)!.references.aggregate.sum, 5n * 9007199254740993n);
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

test('Weekly expansion locates once per page and iteration shares native-order merge cursors', () => {
  const events = Array.from({ length: 4096 }, (_, index) => {
    const event = payment(String(9007199254740993n + BigInt(index)), String(index % 7));
    return { ...event, kind: { ...event.kind, type: 'repayment' as const, payer: 10, payee: 11 + index % 32, amount: '9007199254740993' } };
  });
  const notebook = add(createNotebook(9), batch([...events].reverse()));
  const original = notebook.journal.town.at(0)!;
  const expected = [...events].sort((a, b) => Number(BigInt(a.tick) - BigInt(b.tick)) || Number(BigInt(a.id) - BigInt(b.id))).map(event => `e:${event.id}`);
  let calls = { at: 0, rank: 0, cursors: 0 };
  let constituents = original.constituents!;
  const count = constituents.size;
  for (const group of original.constituents!.values()) {
    const references = new Proxy(group.references, {
      get(target, property, receiver) {
        if (property === 'get') return () => { throw new Error('Member selection must not look up every constituent at each rank'); };
        if (property === 'at') return (index: number) => { calls.at++; return target.at(index); };
        if (property === 'rank') return (reference: Parameters<typeof target.rank>[0]) => { calls.rank++; return target.rank(reference); };
        if (property === 'values') return (start?: number, end?: number) => { calls.cursors++; return target.values(start, end); };
        return Reflect.get(target, property, receiver);
      },
    });
    constituents = constituents.set(group, { ...group, references });
  }
  const metadata = { ...original, constituents };
  const tracked: LifeNotebook = { ...notebook, journal: { ...notebook.journal, town: notebook.journal.town.set(metadata, metadata) } };
  const group = journalRange(tracked, context, 'town')[0]!;
  assert.deepEqual(group.members.slice(3900, 3901), expected.slice(3900, 3901));
  const one = calls;
  calls = { at: 0, rank: 0, cursors: 0 };
  assert.deepEqual(journalMemberLines(group, tracked, context, 3900).map(line => line.identity), expected.slice(3900, 3900 + JOURNAL_EXPANSION_SIZE));
  assert.deepEqual(calls, one, 'a 24-member page shares the same positioning work as one member');
  assert.equal(calls.cursors, count);
  calls = { at: 0, rank: 0, cursors: 0 };
  assert.deepEqual([...group.members], expected);
  assert.deepEqual(calls, { at: 0, rank: 0, cursors: count }, 'iteration initializes each constituent only once');
  assert.deepEqual(group.members.slice(-24), expected.slice(-24));
  assert.equal(group.members.at(-1), expected.at(-1));
  assert.deepEqual(group.members.slice(4000, 3900), []);
  const cursor = group.members[Symbol.iterator]();
  assert.equal(cursor.next().value, expected[0]);
  const changed = add(notebook, batch([], [{ ...record, index: '1', tick: '8', appended: [events[0]!.id] }]));
  const remaining: string[] = [];
  for (let next = cursor.next(); !next.done; next = cursor.next()) remaining.push(next.value);
  assert.deepEqual(remaining, expected.slice(1));
  assert.deepEqual([...journalRange(notebook, context, 'town')[0]!.members], expected);
  assert.equal(journalGroupCount(changed, 'town'), 1);
  assert.deepEqual([...journalRange(changed, context, 'town')[0]!.members], expected.filter(identity => identity !== `e:${events[0]!.id}`));
  assert.equal(original.constituents!.aggregate.count, events.length);
  assert.equal(original.constituents!.aggregate.sum, BigInt(events.length) * 9007199254740993n);
});

test('Section and endpoint are selected before rendering; body/actor changes touch visible text only', () => {
  const events = Array.from({ length: 360 }, (_, index) => ({ ...milestone, id: String(index + 1), tick: String(index), relevance: index % 2 ? 'self' as const : 'background' as const }));
  const original = add(createNotebook(9), batch(events));
  for (const section of ['life', 'town', 'all'] as const) assert.equal(original.journal[section].aggregate, undefined);
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
  assert.equal(journalRange(renamed, { ...context, currentBody: 61 }, 'life')[0]!.text, journalRange(original, { ...context, currentBody: 61 }, 'life')[0]!.text);
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

test('Dream sequence receipts index raw facts directly and preserve complete raw JSON export', () => {
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
  assert.equal(after.renderRevision, before.renderRevision + 1, 'late Dream prose invalidates rendering without rebuilding grouping');
  assert.notEqual(journalRange(after, context)[0]!.text, beforeText);
  assert.equal(journalRange(before, context)[0]!.text, beforeText);
  assert.equal(add(after, { ...batch(), dreams: [dream] }), after);
  const exported = exportNotebook(after);
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

test('Clock-only native World updates advance the guard without revising bounded historical rendering', () => {
  const events = Array.from({ length: 360 }, (_, index) => ({ ...milestone, id: String(index + 1), tick: String(index), kind: { type: 'marriage' as const, a: 10, b: 11 } }));
  const original = appendStory(createNotebook(9), [{ worldId: 9, batch: { ...batch(events), actors: native.actors } }], { world: openingWorld });
  Object.freeze(original);
  Object.freeze(original.phases);
  const currentTick = (BigInt(openingWorld.tick) + 400n).toString();
  const advanced = appendStory(original, [], { world: { ...openingWorld, tick: currentTick } });
  assert.notEqual(advanced, original);
  assert.equal(advanced.phases.currentTick, currentTick);
  assert.equal(original.phases.currentTick, openingWorld.tick);
  assert.equal(advanced.phases.current, original.phases.current);
  assert.equal(advanced.renderRevision, original.renderRevision);
  for (const root of ['actors', 'events', 'chronicle', 'dreams', 'journal', 'contexts', 'actorRoots', 'phaseActors'] as const) assert.equal(advanced[root], original[root], root);
  const oldWorld: WorldSnapshot = { ...openingWorld, tick: (BigInt(currentTick) - 1n).toString(), player: { ...openingWorld.player, body: 61 } };
  assert.equal(appendStory(advanced, [], { world: oldWorld }), advanced, 'even a newer-than-original but older-than-current World cannot change the body');
  const before = journalRange(original, context, 'life', JOURNAL_RANGE_SIZE);
  assert.equal(before.length, JOURNAL_RANGE_SIZE);
  assert.deepEqual(journalRange(advanced, context, 'life', JOURNAL_RANGE_SIZE), before);
  const cursorOnly = add(advanced, { ...batch(), cursors: { events: { start: '0', end: '999' }, chronicle: { start: '0', end: '0' } } });
  assert.notEqual(cursorOnly.cursors, advanced.cursors);
  assert.equal(cursorOnly.renderRevision, advanced.renderRevision);
  const appended = add(cursorOnly, batch([{ ...events[0]!, id: '361', tick: currentTick }]));
  assert.equal(appended.renderRevision, cursorOnly.renderRevision + 1);
  assert.equal(journalRange(original, context, 'life', JOURNAL_RANGE_SIZE).length, JOURNAL_RANGE_SIZE);
});

test('EntryContext owns captured actors while mixed direct callers retain only their actual fallback roots', () => {
  const events = Array.from({ length: 360 }, (_, index) => ({ ...milestone, id: String(index + 1), tick: String(index), kind: { type: 'marriage' as const, a: 10, b: 11 } }));
  const captured = appendStory(createNotebook(9), [{ worldId: 9, batch: { ...batch(events), actors: native.actors } }], { world: openingWorld });
  assert.equal(captured.contexts.size, events.length);
  assert.equal(captured.actorRoots.size, 0);
  for (const identity of captured.identities) assert.equal(entryContext(captured, identity)!.actors, captured.actors);
  const direct = add(createNotebook(9), { ...batch([events[0]!]), actors: native.actors });
  assert.equal(direct.contexts.size, 0);
  assert.equal(direct.actorRoots.size, 1);
  const fallbackRoot = direct.actorRoots.get('e:1')!;
  const oldText = journalRange(direct, context)[0]!.text;
  const actor = native.actors.find(actor => actor.person === 10)!;
  const mixed = appendStory(direct, [{ worldId: 9, batch: { ...batch([events[1]!]), actors: [{ ...actor, name: 'Later assigned name' }] } }], { world: openingWorld });
  assert.equal(mixed.actorRoots, direct.actorRoots);
  assert.equal(mixed.actorRoots.get('e:1'), fallbackRoot);
  assert.equal(entryContext(mixed, 'e:1'), null);
  assert.ok(entryContext(mixed, 'e:2'));
  assert.equal(mixed.actorRoots.get('e:2'), undefined);
  assert.equal(journalRange(mixed, context).find(group => group.members.at(0) === 'e:1')!.text, oldText);
  assert.equal(direct.events.size, 1);
  assert.equal(mixed.events.get('1'), events[0]);
  assert.equal(mixed.events.get('2'), events[1]);
});

test('A direct exact-node admission captures EntryContext even before a World establishes the phase index', () => {
  const bound = appendStory(createNotebook(9), [{ worldId: 9, batch: { ...batch([milestone]), actors: native.actors } }], { world: openingWorld });
  const admission = entryContext(bound, `e:${milestone.id}`)!;
  const selected: StoryChronicle = { ...record, node: 'direct-admission', appended: [], actorContext: [] };
  const notebook = appendStory(createNotebook(9), [{ worldId: 9, batch: batch([], [selected]) }], { choices: { get: node => node === selected.node ? admission : undefined } });
  const captured = entryContext(notebook, `c:${selected.index}`)!;
  assert.equal(notebook.phases.playerSoul, null);
  assert.equal(captured.phase, admission.phase);
  assert.equal(captured.playerSoul, admission.playerSoul);
  assert.equal(captured.actors, admission.actors);
  assert.equal(captured.focus, admission.focus);
  assert.equal(notebook.contexts.size, 1);
  assert.equal(notebook.actorRoots.size, 0);
  assert.equal(notebook.chronicle.get(selected.index), selected);
});
