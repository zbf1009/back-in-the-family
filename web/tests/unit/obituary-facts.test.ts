import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildObituaryFacts } from '../../src/main/obituary-facts.ts';
import { appendStory, createNotebook, type LifeNotebook } from '../../src/main/life-journal.ts';
import type { OwnDeathKinSummaryV1 } from '../../src/shared/obituary.ts';
import type { StoryActor, StoryBatch, StoryChronicle, StoryEvent } from '../../src/shared/story.ts';
import type { PlayerLifecycleFact } from '../../src/shared/world-snapshot.ts';

const witness: { openingBatch: StoryBatch; observedBatches: { story: StoryBatch; player_lifecycle: PlayerLifecycleFact[] }[]; completedTicks: string; seed: string; checksum: string } = JSON.parse(readFileSync(new URL('../fixtures/obituary-seed1205-native-witness.json', import.meta.url), 'utf8'));
const death = witness.observedBatches.flatMap(report => report.player_lifecycle).find(fact => fact.kind === 'death')!;
const openingActor = witness.openingBatch.actors.find(actor => actor.person === death.body)!;
const initialPhase = { key: `7/life/${openingActor.person}`, worldId: 7, kind: 'life' as const, person: openingActor.person, name: openingActor.name };
let base = createNotebook(7);
// Bind the native opening body/soul directly into the journal context index;
// neither a synthetic World nor a final-World relationship projection is used.
base = { ...base, phases: { ...base.phases, playerSoul: openingActor.soulId, initial: initialPhase, current: initialPhase, currentTick: '0', lives: base.phases.lives.set(openingActor.person, initialPhase) } };
base = appendStory(base, [{ worldId: 7, batch: witness.openingBatch }]);
for (const report of witness.observedBatches) base = appendStory(base, [{ worldId: 7, batch: report.story }], { lifecycle: report.player_lifecycle });
const nativeSummary = base.ownDeathSummaries.get(death.event)!;
// Consumer-only complete-empty input. This does not assert Nadine had no family;
// the separately retained complete native witness is the positive kin authority.
const emptySummary: OwnDeathKinSummaryV1 = { deathEvent: death.event, body: death.body, tick: death.tick, spouse: [], livingChildren: [], livingGrandchildren: [], deceasedSpouses: [], deceasedParents: [], deceasedChildren: [], deceasedSiblings: [] };
const context = base.contexts.get(`e:${death.event}`)!;
function eventInput(notebook: LifeNotebook, event: StoryEvent): LifeNotebook {
  return { ...notebook, events: notebook.events.set(event.id, event), contexts: notebook.contexts.set(`e:${event.id}`, { ...context }) };
}
function choiceInput(notebook: LifeNotebook, record: StoryChronicle): LifeNotebook {
  return { ...notebook, chronicle: notebook.chronicle.set(record.index, record), contexts: notebook.contexts.set(`c:${record.index}`, { ...context }) };
}
const eventFrame = base.events.get('2369')!;
const choiceFrame = [...base.chronicle.values()].find(record => record.applied === 'demand_payment')!;
function cleanDebtInputs(): LifeNotebook {
  let notebook = base;
  for (const record of notebook.chronicle.values()) if (record.applied === 'demand_payment' || record.applied === 'forgive_debt') notebook = { ...notebook, chronicle: notebook.chronicle.delete(record.index) };
  for (const event of notebook.events.values()) if (event.kind.type === 'repayment' && event.kind.payee === death.body) notebook = { ...notebook, events: notebook.events.delete(event.id) };
  return notebook;
}
function loan(id = '9000'): StoryEvent {
  return { ...eventFrame, id, tick: '100', kind: { type: 'loan', lender: death.body, borrower: 27, amount: '100', due: '200' }, causedBy: [] };
}
function repayment(id: string, cause: string[]): StoryEvent {
  return { ...eventFrame, id, tick: '200', kind: { type: 'repayment', payer: 27, payee: death.body, amount: '10' }, causedBy: cause };
}

test('exact own Death and mandatory frozen native identity are defects when unavailable or mismatched', () => {
  assert.throws(() => buildObituaryFacts(base, death, undefined as unknown as OwnDeathKinSummaryV1), /complete native kin summary/u);
  for (const summary of [{ ...emptySummary, body: 12 }, { ...emptySummary, deathEvent: '2369' }, { ...emptySummary, tick: '5373' }, { ...emptySummary, deceasedSiblings: undefined }]) assert.throws(() => buildObituaryFacts(base, death, summary as OwnDeathKinSummaryV1));
  assert.throws(() => buildObituaryFacts(base, { ...death, kind: 'birth' }, emptySummary));
  assert.throws(() => buildObituaryFacts({ ...base, contexts: base.contexts.delete(`e:${death.event}`) }, death, emptySummary));
  assert.throws(() => buildObituaryFacts({ ...base, opening: base.opening.set(`e:${death.event}`, true) }, death, emptySummary));
  for (const actor of [{ ...context.actors.get(10)!, ageAtDeath: undefined }, { ...context.actors.get(10)!, ageAtDeath: '121' }, { ...context.actors.get(10)!, sex: undefined }, { ...context.actors.get(10)!, name: 'Marcus Bradley' }, { ...context.actors.get(10)!, soulId: 'S-0012' }]) {
    const root = base.actors.set(10, actor as StoryActor);
    assert.throws(() => buildObituaryFacts({ ...base, contexts: base.contexts.set(`e:${death.event}`, { ...context, actors: root }) }, death, emptySummary));
  }
});

test('complete empty arrays are known empty and freeze only the closed extracted facts', () => {
  const facts = buildObituaryFacts(base, death, emptySummary);
  assert.deepEqual(facts.survivors, []); assert.deepEqual(facts.precededInDeath, []);
  assert.deepEqual(facts.deceased, { fullName: 'Nadine Bradley', sex: 'female', ageYears: 60, deathDate: { year: '15', day: 263, label: 'Year 15, Day 263' }, origin: 'born in town' });
  for (const value of [facts, facts.deceased, facts.deceased.deathDate, facts.survivors, facts.precededInDeath, facts.debtActions, facts.collections, facts.estate, facts.estate?.heirs, facts.estate?.heirs[0]]) if (value !== null && value !== undefined) assert.ok(Object.isFrozen(value));
  assert.equal(Object.isFrozen(context.actors.get(10)), false, 'does not freeze the shared notebook actor');
  const changed = { ...base, actors: base.actors.set(10, { ...base.actors.get(10)!, name: 'Marcus Bradley', ageAtDeath: '99' }) };
  assert.deepEqual(buildObituaryFacts(changed, death, emptySummary).deceased, facts.deceased, 'never reads a latest actor root');
});

test('all three native origins retain their exact frozen opening identity', () => {
  for (const origin of ['native', 'possessed', 'rebuilt'] as const) {
    const root = base.actors.set(10, { ...context.actors.get(10)!, origin });
    const notebook = { ...base, contexts: base.contexts.set(`e:${death.event}`, { ...context, actors: root }) };
    assert.equal(buildObituaryFacts(notebook, { ...death, origin }, emptySummary).deceased.origin, origin === 'native' ? 'born in town' : origin === 'possessed' ? 'borrowed body' : 'rebuilt body');
  }
});

test('four actual selected demands concern three people, independently of collections', () => {
  const facts = buildObituaryFacts(base, death, emptySummary);
  assert.equal(facts.debtActions.demandsMade, '4'); assert.equal(facts.debtActions.peopleAskedForPayment, '3');
  assert.equal(facts.debtActions.forgivenDebts, '0');
  assert.equal(facts.collections.debtsPaidOn, '4', 'four distinct Loan IDs have actual repayments, independently of four choices');
});

test('demand choices preserve each source and separate count from missing actual target evidence', () => {
  for (const source of ['external', 'rules_default', 'auto_resolved'] as const) {
    const notebook = choiceInput(cleanDebtInputs(), { ...choiceFrame, source });
    const facts = buildObituaryFacts(notebook, death, emptySummary);
    assert.equal(facts.debtActions.demandsMade, '1'); assert.equal(facts.debtActions.peopleAskedForPayment, '1'); assert.equal(facts.collections.debtsPaidOn, '0');
    const missing = choiceInput(notebook, { ...choiceFrame, source, appended: [] });
    assert.equal(buildObituaryFacts(missing, death, emptySummary).debtActions.peopleAskedForPayment, null);
    assert.equal(buildObituaryFacts(missing, death, emptySummary).debtActions.demandsMade, '1');
    const skipped = choiceInput(notebook, { ...choiceFrame, source, skipped: [{ part: 0, reason: 'dead_person' }] });
    assert.equal(buildObituaryFacts(skipped, death, emptySummary).debtActions.demandsMade, '0');
    const earlier = { ...notebook, contexts: notebook.contexts.set(`c:${choiceFrame.index}`, { ...context, phase: { ...context.phase, key: '7/life/9', person: 9 } }) };
    assert.equal(buildObituaryFacts(earlier, death, emptySummary).debtActions.demandsMade, '0');
  }
});

test('successful selected forgiveness joins one original Loan and excludes death cleanup and skipped part zero', () => {
  const action: StoryEvent = { ...eventFrame, id: '9001', tick: '200', kind: { type: 'debt_forgiven', creditor: 10, debtor: 27, amount: '100' }, causedBy: ['9000'] };
  const record: StoryChronicle = { ...choiceFrame, index: '9000', tick: '200', applied: 'forgive_debt', appended: [action.id] };
  let notebook = eventInput(eventInput(cleanDebtInputs(), loan()), action);
  notebook = choiceInput(notebook, record);
  assert.equal(buildObituaryFacts(notebook, death, emptySummary).debtActions.forgivenDebts, '1');
  assert.equal(buildObituaryFacts(choiceInput(notebook, { ...record, index: '9001' }), death, emptySummary).debtActions.forgivenDebts, '1', 'same original loan counted once');
  assert.equal(buildObituaryFacts(choiceInput(notebook, { ...record, skipped: [{ part: 0, reason: 'missing_debt' }] }), death, emptySummary).debtActions.forgivenDebts, '0');
  assert.equal(buildObituaryFacts(choiceInput(notebook, { ...record, skipped: [{ part: 1, reason: 'dead_person' }] }), death, emptySummary).debtActions.forgivenDebts, '1');
  assert.equal(buildObituaryFacts(choiceInput(notebook, { ...record, appended: [] }), death, emptySummary).debtActions.forgivenDebts, null);
  assert.equal(buildObituaryFacts(eventInput(notebook, { ...action, causedBy: ['9000', death.event] }), death, emptySummary).debtActions.forgivenDebts, null);
  const earlier = { ...notebook, contexts: notebook.contexts.set(`c:${record.index}`, { ...context, phase: { ...context.phase, key: '7/life/9', person: 9 } }) };
  assert.equal(buildObituaryFacts(earlier, death, emptySummary).debtActions.forgivenDebts, '0');
  assert.equal(buildObituaryFacts({ ...notebook, events: notebook.events.delete('9000') }, death, emptySummary).debtActions.forgivenDebts, null);
});

test('partial collections count distinct original loans once; unknown or ambiguous causes remain null', () => {
  let notebook = eventInput(eventInput(eventInput(cleanDebtInputs(), loan()), repayment('9001', ['9000'])), repayment('9002', ['9000']));
  assert.equal(buildObituaryFacts(notebook, death, emptySummary).collections.debtsPaidOn, '1');
  assert.equal(buildObituaryFacts(eventInput(notebook, repayment('9003', [])), death, emptySummary).collections.debtsPaidOn, null);
  assert.equal(buildObituaryFacts(eventInput(notebook, repayment('9003', ['9999'])), death, emptySummary).collections.debtsPaidOn, null);
  notebook = eventInput(notebook, loan('8999'));
  assert.equal(buildObituaryFacts(eventInput(notebook, repayment('9003', ['9000', '8999'])), death, emptySummary).collections.debtsPaidOn, null);
  const earlier = { ...notebook, contexts: notebook.contexts.set('e:9001', { ...context, phase: { ...context.phase, key: '7/life/9', person: 9 } }).set('e:9002', { ...context, phase: { ...context.phase, key: '7/life/9', person: 9 } }) };
  assert.equal(buildObituaryFacts(earlier, death, emptySummary).collections.debtsPaidOn, '0');
});

test('estate is the exact Death-caused asset valuation with actual heirs, never an invented no-heir zero', () => {
  const facts = buildObituaryFacts(base, death, emptySummary);
  assert.equal(facts.estate?.valueDollars, '229012');
  assert.deepEqual(facts.estate?.heirs.map(heir => heir.fullName), ['Marcus Bradley', 'Marvin Jenkins']);
  let none = base;
  for (const event of base.events.values()) if (event.kind.type === 'inheritance' && event.causedBy.includes(death.event)) none = { ...none, events: none.events.delete(event.id) };
  assert.equal(buildObituaryFacts(none, death, emptySummary).estate, null);
  const exact = base.events.get('2369')!;
  assert.equal(buildObituaryFacts(eventInput(none, { ...exact, causedBy: [] }), death, emptySummary).estate, null);
  assert.equal(buildObituaryFacts(eventInput(none, { ...exact, tick: '5373' }), death, emptySummary).estate, null);
  if (exact.kind.type !== 'inheritance') throw new Error('selected native inheritance is missing');
  assert.equal(buildObituaryFacts(eventInput(base, { ...exact, kind: { ...exact.kind, amount: '18446744073709551615' } }), death, emptySummary).estate, null);
  assert.equal(buildObituaryFacts(eventInput(base, { ...exact, kind: { ...exact.kind, amount: '18446744073709551614' } }), death, emptySummary).estate, null, 'distributed total beyond u64 unavailable');
  assert.equal(buildObituaryFacts(eventInput(none, { ...exact, kind: { ...exact.kind, amount: '9007199254740993' } }), death, emptySummary).estate?.valueDollars, '9007199254740993', 'never converts money through Number');
});

test('burners are distinct positive actual offerers to this body on this Death tick, including zero credit', () => {
  const offering = base.events.get('2372')!;
  if (offering.kind.type !== 'offering') throw new Error('selected native offering is missing');
  const noOffering = { ...base, events: base.events.delete('2372').delete('2373') };
  assert.equal(buildObituaryFacts(noOffering, death, emptySummary).jossBurnersOnDeathDay, '0');
  const one = eventInput(noOffering, { ...offering, kind: { ...offering.kind, credited: '0' } });
  assert.equal(buildObituaryFacts(one, death, emptySummary).jossBurnersOnDeathDay, '1');
  const repeated = eventInput(one, { ...offering, id: '9000', kind: { ...offering.kind, credited: '0' } });
  assert.equal(buildObituaryFacts(repeated, death, emptySummary).jossBurnersOnDeathDay, '1');
  for (const other of [{ ...offering, tick: '5373' }, { ...offering, kind: { ...offering.kind, ghost: 12 } }, { ...offering, kind: { ...offering.kind, amount: '0' } }]) assert.equal(buildObituaryFacts(eventInput(noOffering, other), death, emptySummary).jossBurnersOnDeathDay, '0');
});

test('complete native witness reconciles every Author acceptance fact without fabricated kin', () => {
  const positive = JSON.parse(readFileSync(new URL('../fixtures/obituary-seed1205-positive.json', import.meta.url), 'utf8'));
  assert.equal(witness.seed, '1205'); assert.equal(witness.completedTicks, '5373');
  assert.equal(witness.checksum, positive.sourceChecksum);
  const facts = buildObituaryFacts(base, death, nativeSummary);
  assert.deepEqual(facts, positive.facts);
  assert.deepEqual(nativeSummary.deceasedParents, []); assert.deepEqual(nativeSummary.deceasedChildren, []); assert.deepEqual(nativeSummary.deceasedSiblings, []);
  assert.deepEqual(facts.survivors.map(person => [person.fullName, person.sex, person.relation]), [
    ['Marvin Jenkins', 'male', 'husband'], ['Marcus Bradley', 'male', 'son'],
    ['Ben Rhodes', 'male', 'grandson'], ['Leo Rhodes', 'male', 'grandson'],
  ]);
  assert.deepEqual(facts.precededInDeath.map(person => [person.fullName, person.sex, person.relation]), [['Clifford Bradley', 'male', 'husband']]);
  assert.deepEqual(buildObituaryFacts(base, death, { ...nativeSummary, livingGrandchildren: [...nativeSummary.livingGrandchildren].reverse() }), facts, 'people order is stable native ID order, not arrival order');
});

test('consumer kin-sex variants preserve native identity strings and reject unknown sex', () => {
  const spouse = nativeSummary.spouse[0]!;
  const femaleInput = { ...nativeSummary, spouse: [{ ...spouse, sex: 'female' as const }] };
  const femaleFacts = buildObituaryFacts(base, death, femaleInput);
  assert.equal(femaleFacts.survivors[0]!.relation, 'wife'); assert.equal(femaleFacts.survivors[0]!.sex, 'female');
  assert.equal(femaleFacts.survivors[0]!.fullName, spouse.name);
  assert.throws(() => buildObituaryFacts(base, death, { ...nativeSummary, spouse: [{ ...spouse, sex: undefined }] } as unknown as OwnDeathKinSummaryV1));
  assert.throws(() => buildObituaryFacts(base, death, { ...nativeSummary, spouse: [spouse, spouse] }));
});

test('missing aggregate entry ownership stays unavailable rather than inventing zero', () => {
  const missingChoice = { ...base, contexts: base.contexts.delete(`c:${choiceFrame.index}`) };
  const facts = buildObituaryFacts(missingChoice, death, nativeSummary);
  assert.equal(facts.debtActions.demandsMade, null); assert.equal(facts.debtActions.peopleAskedForPayment, null);
  const payment = [...base.events.values()].find(event => event.kind.type === 'repayment' && event.kind.payee === death.body)!;
  assert.equal(buildObituaryFacts({ ...base, contexts: base.contexts.delete(`e:${payment.id}`) }, death, nativeSummary).collections.debtsPaidOn, null);
});
