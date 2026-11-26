import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendStory, createNotebook, exportNotebook, journalGroupCount, journalMemberLines, journalRange, JOURNAL_EXPANSION_SIZE, JOURNAL_RANGE_SIZE, type JournalGroup, type LifeNotebook } from '../../src/main/life-journal.ts';
import { CHRONICLE_FRAMES, frameEligible, renderChronicleFrame, renderEventFrame, renderStoryEvent, renderTemplateCorpus, socialBand, storyPerson, TEMPLATE_FRAMES } from '../../src/main/journal-templates.ts';
import { formatAmount, formatMoney } from '../../src/main/calendar.ts';
import type { StoryActor, StoryBatch, StoryChronicle, StoryDelivery, StoryEvent } from '../../src/shared/story.ts';

// Selected facts from the actual native seed-1205 recorded replay traversal.
// This fixture is not a fabricated World or a claim that this selection is a complete suffix.
const fixture: {
  sourceReplay: string; seed: string; openingBatch: StoryBatch; actors: StoryActor[];
  events: StoryEvent[]; chronicle: StoryChronicle[]; dreams: StoryBatch['dreams']; cursors: StoryBatch['cursors'];
} = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
const facts: StoryBatch = { version: 1, opening: false, actors: fixture.actors, events: fixture.events, chronicle: fixture.chronicle, dreams: fixture.dreams, cursors: fixture.cursors };
const deliveries: StoryDelivery[] = [{ worldId: 7, batch: fixture.openingBatch }, { worldId: 7, batch: facts }];
const context = { playerSoul: 'S-0010', currentBody: 10 };

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function allGroups(notebook: LifeNotebook): JournalGroup[] {
  const groups: JournalGroup[] = [];
  const count = journalGroupCount(notebook);
  for (let start = 0; start < count; start += JOURNAL_RANGE_SIZE) {
    const end = Math.min(count, start + JOURNAL_RANGE_SIZE);
    groups.push(...journalRange(notebook, context, 'all', end).slice(-(end - start)));
  }
  return groups;
}
function groupEvents(group: JournalGroup, notebook: LifeNotebook): StoryEvent[] {
  return [...group.members].filter(identity => identity.startsWith('e:')).map(identity => notebook.events.get(identity.slice(2))!);
}
function groupChronicle(group: JournalGroup, notebook: LifeNotebook): StoryChronicle[] {
  return [...group.members].filter(identity => identity.startsWith('c:')).map(identity => notebook.chronicle.get(identity.slice(2))!);
}

test('Notebook retains every selected native identity, actor, cause and opening qualification without mutating earlier roots', () => {
  const start = freeze(createNotebook(7));
  const opening = freeze(appendStory(start, deliveries.slice(0, 1)));
  const complete = appendStory(opening, deliveries.slice(1));
  assert.equal(start.identities.length, 0);
  assert.equal(opening.identities.length, fixture.openingBatch.events.length);
  assert.equal(complete.identities.length, fixture.events.length + fixture.chronicle.length);
  assert.ok(complete.events.get('1')); assert.ok(complete.chronicle.get('1'));
  assert.ok([...complete.identities].includes('e:1')); assert.ok([...complete.identities].includes('c:1'));
  assert.equal(complete.opening.get('e:1'), true);
  for (const event of fixture.events) assert.deepEqual(complete.events.get(event.id), event);
  for (const record of fixture.chronicle) assert.deepEqual(complete.chronicle.get(record.index), record);
  for (const actor of fixture.actors) assert.deepEqual(complete.actors.get(actor.person), actor);
  assert.deepEqual(complete.cursors, fixture.cursors);
  freeze(complete);
  assert.equal(appendStory(complete, deliveries), complete, 'redelivery is not another narrative event');
  assert.equal(appendStory(complete, [{ worldId: 8, batch: facts }]), complete);
  const before = JSON.stringify(exportNotebook(complete));
  journalRange(complete, { ...context, currentBody: 61 });
  assert.equal(JSON.stringify(exportNotebook(complete)), before, 'a new body changes presentation, not notebook retention');
  assert.equal(createNotebook(8).identities.length, 0, 'only the caller creates a new-world notebook');
  assert.equal(complete.actors.get(10)!.ageAtDeath, '60');
});

test('Native Chronicle appended identities appear once, independently of delivery order and same-day neighbors', () => {
  const notebook = appendStory(createNotebook(7), deliveries);
  const groups = allGroups(notebook);
  const identities = groups.flatMap(group => [...group.members]);
  assert.equal(identities.length, new Set(identities).size);
  assert.deepEqual(new Set(identities), new Set(notebook.identities));
  for (const record of fixture.chronicle) {
    const joined = groups.find(group => [...group.members].includes(`c:${record.index}`))!;
    assert.equal(joined.primary, true); assert.equal(joined.milestone, true);
    for (const eventId of record.appended) {
      assert.ok([...joined.members].includes(`e:${eventId}`));
      assert.equal(groups.filter(group => [...group.members].includes(`e:${eventId}`)).length, 1);
    }
  }
  const firstRecord = fixture.chronicle.find(record => record.appended.length)!;
  const withoutChronicle = { ...facts, chronicle: [] };
  const eventsFirst = appendStory(createNotebook(7), [{ worldId: 7, batch: withoutChronicle }]);
  const withChronicle = appendStory(eventsFirst, [{ worldId: 7, batch: { ...facts, events: [], chronicle: [firstRecord] } }]);
  const joined = allGroups(withChronicle).find(group => [...group.members].includes(`c:${firstRecord.index}`))!;
  assert.deepEqual(groupEvents(joined, withChronicle).map(event => event.id), firstRecord.appended);
  assert.equal(eventsFirst.chronicle.get(firstRecord.index), undefined);
});

test('Selection follows native relevance, never the presence of a relationship or a town-news actor name', () => {
  const notebook = appendStory(createNotebook(7), deliveries);
  const groups = allGroups(notebook);
  const linked = new Set(fixture.chronicle.flatMap(record => record.appended));
  for (const event of fixture.events) {
    const group = groups.find(candidate => [...candidate.members].includes(`e:${event.id}`))!;
    assert.equal(group.primary, linked.has(event.id) || event.relevance !== 'background');
    if (['birth', 'death', 'marriage', 'inheritance', 'possession', 'rebuild'].includes(event.kind.type)) {
      assert.equal(group.milestone, true);
      if (!linked.has(event.id)) assert.equal(groupEvents(group, notebook).length, 1);
    }
  }
});

test('Actual repeated repayments retain causes, exact sums, counts and full dates; all group members remain inspectable', () => {
  const notebook = appendStory(createNotebook(7), deliveries);
  const groups = allGroups(notebook);
  const repayments = groups.filter(group => group.sumRole === 'repayment');
  assert.ok(repayments.length > 0, 'the actual sample must exercise same-cause grouping');
  for (const group of groups) {
    assert.equal(group.count, group.members.length);
    const ticks = [...groupEvents(group, notebook).map(event => event.tick), ...groupChronicle(group, notebook).map(record => record.tick)].map(BigInt);
    assert.equal(BigInt(group.from), ticks.reduce((a, b) => a < b ? a : b));
    assert.equal(BigInt(group.to), ticks.reduce((a, b) => a > b ? a : b));
  }
  for (const group of repayments) {
    const events = groupEvents(group, notebook);
    const first = events[0]!;
    assert.ok(first.causedBy.length > 0);
    assert.ok(events.every(event => event.kind.type === 'repayment'));
    const sum = events.reduce((amount, event) => {
      assert.deepEqual(event.causedBy, first.causedBy);
      assert.equal(event.kind.type, 'repayment');
      return amount + BigInt((event.kind as Extract<StoryEvent['kind'], { type: 'repayment' }>).amount);
    }, 0n).toString();
    assert.equal(group.sum, sum);
    assert.ok(group.text.includes(formatMoney(sum)));
  }
  const before = JSON.stringify(exportNotebook(notebook));
  assert.ok(groups.length > JOURNAL_RANGE_SIZE);
  assert.equal(journalRange(notebook, context).length, JOURNAL_RANGE_SIZE);
  assert.deepEqual(journalRange(notebook, context, 'all', JOURNAL_RANGE_SIZE), groups.slice(0, JOURNAL_RANGE_SIZE));
  for (const group of groups) {
    const inspected = [];
    for (let start = 0; start < group.members.length; start += JOURNAL_EXPANSION_SIZE) {
      const lines = journalMemberLines(group, notebook, context, start);
      assert.ok(lines.length <= JOURNAL_EXPANSION_SIZE);
      inspected.push(...lines.map(line => line.identity));
    }
    assert.deepEqual(inspected, [...group.members]);
  }
  assert.equal(JSON.stringify(exportNotebook(notebook)), before);
});

test('Actual event frame eligibility and modulo selection remain pure and exact, including high native Event IDs', () => {
  const notebook = appendStory(createNotebook(7), deliveries);
  const before = JSON.stringify(exportNotebook(notebook));
  for (const event of fixture.events) {
    const eligible = TEMPLATE_FRAMES.filter(frame => frameEligible(frame, event));
    assert.ok(eligible.length >= 3);
    const frame = eligible[Number(BigInt(event.id) % BigInt(eligible.length))]!;
    const text = renderStoryEvent(event, notebook.actors, context);
    assert.equal(text, renderEventFrame(frame, event, notebook.actors, context));
    assert.equal(renderStoryEvent(event, notebook.actors, context), text);
    if (event.kind.type === 'social') {
      const band = socialBand(event.kind.intensity);
      assert.ok(eligible.every(candidate => candidate.band === band));
      assert.equal(text.includes('$'), false, 'intensity is not a dollar amount');
    }
    if (event.kind.type === 'inheritance') assert.ok(text.includes(formatMoney(event.kind.amount)));
    if (event.kind.type === 'offering') {
      assert.ok(text.includes(formatAmount(event.kind.amount)));
      assert.ok(text.includes(formatAmount(event.kind.credited)));
    }
  }
  // Decimal-boundary probes exercise the consumer contract, not claimed gameplay examples.
  const actual = fixture.events.find(event => event.kind.type === 'inheritance')!;
  for (const id of ['9007199254740993', '18446744073709551615']) {
    const probe = { ...actual, id };
    const eligible = TEMPLATE_FRAMES.filter(frame => frameEligible(frame, probe));
    assert.equal(renderStoryEvent(probe, notebook.actors, context), renderEventFrame(eligible[Number(BigInt(id) % BigInt(eligible.length))]!, probe, notebook.actors, context));
  }
  assert.equal(JSON.stringify(exportNotebook(notebook)), before);
});

test('Actual names, native sex and observed kin orient historical narration without assigning it to the new body', () => {
  const notebook = appendStory(createNotebook(7), deliveries);
  const death = fixture.events.find(event => event.kind.type === 'death' && event.kind.person === 10)!;
  const currentText = renderStoryEvent(death, notebook.actors, context);
  const historicalText = renderStoryEvent(death, notebook.actors, { ...context, currentBody: 61 });
  assert.match(currentText, /\byou\b/i);
  assert.ok(historicalText.includes(notebook.actors.get(10)!.name));
  assert.match(historicalText, /earlier life/);
  const kinEvent = fixture.events.find(event => event.actorContext.some(boundary => boundary.actors.some(actor => actor.kinRole === 'child')))!;
  const boundary = kinEvent.actorContext.find(candidate => candidate.basis === 'observed-day-end')!;
  const child = boundary.actors.find(actor => actor.kinRole === 'child')!;
  const childActor = notebook.actors.get(child.person)!;
  const phrase = storyPerson(child.person, notebook.actors, context, kinEvent.actorContext);
  assert.ok(phrase.includes(childActor.name));
  assert.ok(phrase.includes(childActor.sex === 'female' ? 'daughter' : 'son'));
  assert.ok(storyPerson(child.person, notebook.actors, context, []).includes(childActor.name));
  assert.equal(storyPerson(child.person, new Map(), context, []), 'Name unavailable');
});

test('The full-frame corpus uses only matching actual facts and reports absent kinds, intensity bands and tags honestly', () => {
  const notebook = appendStory(createNotebook(7), deliveries);
  const corpus = renderTemplateCorpus([fixture.openingBatch, facts], context);
  assert.equal(corpus.events.length, TEMPLATE_FRAMES.length);
  for (const item of corpus.events) {
    if (item.eventId === undefined) { assert.equal(item.text, undefined); assert.ok(item.absent); continue; }
    const event = fixture.events.find(candidate => candidate.id === item.eventId)!;
    assert.ok(frameEligible(item.frame, event));
    assert.equal(item.text, renderEventFrame(item.frame, event, notebook.actors, context));
  }
  for (const kind of ['rebuild', 'bribe_offering', 'haunting', 'appeal']) assert.ok(corpus.events.filter(item => item.frame.kind === kind).every(item => item.absent));
  assert.ok(corpus.events.filter(item => item.frame.requiredTag === 4 || item.frame.requiredTag === 4096).every(item => item.absent));
  for (const record of fixture.chronicle) for (const frame of CHRONICLE_FRAMES) {
    const text = renderChronicleFrame(frame.variant, record, notebook.actors, context);
    assert.equal(corpus.chronicle.find(item => item.index === record.index && item.frameId === frame.id)!.text, text);
    assert.equal(text.includes('model-generated'), false);
    if (record.appended.length === 0) assert.doesNotMatch(text, /\bfailed\b|nothing happened|no effects applied/i);
  }
});
