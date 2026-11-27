import { parseObituaryFacts, parseOwnDeathKinSummary, type NamedRelative, type NativeDeathKinPerson, type NativeSex, type ObituaryFactsV1, type OwnDeathKinSummaryV1, type Relation } from '../shared/obituary.ts';
import type { StoryEvent, StoryIdentity } from '../shared/story.ts';
import type { Kinship, PlayerLifecycleFact } from '../shared/world-snapshot.ts';
import type { EntryContext } from './life-context.ts';
import type { LifeNotebook } from './life-journal.ts';
import { dateLabel } from './calendar.ts';
import { kinshipNoun } from './player-copy.ts';

const U64_MAX = 18446744073709551615n;
function u64(value: string): bigint | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value) || value.length > 20) return null;
  const result = BigInt(value);
  return result <= U64_MAX ? result : null;
}
function relation(role: Kinship, sex?: NativeSex): Relation | null {
  if (role === 'cousin' || role === 'in_law') return null;
  return kinshipNoun(role === 'former_spouse' ? 'spouse' : role, sex) as Relation;
}
function relatives(people: readonly NativeDeathKinPerson[]): NamedRelative[] {
  return [...people].sort((a, b) => a.person - b.person).map(person => ({
    fullName: person.name, firstName: person.name.split(' ')[0]!, sex: person.sex,
    relation: relation(person.relation, person.sex)!,
  }));
}
function sameLife(notebook: LifeNotebook, identity: StoryIdentity, deathContext: EntryContext): boolean {
  const context = notebook.contexts.get(identity);
  return context?.phase.kind === 'life' && context.phase.worldId === notebook.worldId
    && context.phase.key === deathContext.phase.key && context.focus === deathContext.focus
    && context.playerSoul === deathContext.playerSoul;
}
/** A direct native Loan cause, not a guessed debt from matching people or amounts. */
function originalLoan(notebook: LifeNotebook, event: StoryEvent): string | null {
  let loan: string | null = null;
  for (const id of event.causedBy) {
    const cause = notebook.events.get(id);
    if (!cause) return null;
    if (cause.kind.type !== 'loan') continue;
    if (loan !== null && loan !== id) return null;
    if (BigInt(cause.tick) > BigInt(event.tick) || BigInt(cause.id) >= BigInt(event.id)) return null;
    loan = id;
  }
  return loan;
}
function count(size: number): string { return BigInt(size).toString(); }
function freezeFacts<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeFacts(child);
    Object.freeze(value);
  }
  return value;
}

/** Called once after the complete native death-day delivery, never from a later World. */
export function buildObituaryFacts(notebook: LifeNotebook, death: PlayerLifecycleFact, summary: OwnDeathKinSummaryV1): ObituaryFactsV1 {
  const event = notebook.events.get(death.event);
  const context = notebook.contexts.get(`e:${death.event}`);
  const kin = parseOwnDeathKinSummary(summary);
  if (death.kind !== 'death' || !event || event.kind.type !== 'death' || event.kind.person !== death.body
    || event.tick !== death.tick || notebook.opening.get(`e:${death.event}`) !== false
    || !kin || kin.deathEvent !== death.event || kin.body !== death.body || kin.tick !== death.tick
    || !context || context.phase.kind !== 'life' || context.phase.worldId !== notebook.worldId
    || context.phase.person !== death.body || context.focus !== death.body) {
    throw new Error('Obituary requires the exact captured own Death and complete native kin summary.');
  }
  const actor = context.actors.get(death.body);
  const tick = u64(event.tick);
  const age = actor?.ageAtDeath === undefined ? null : u64(actor.ageAtDeath);
  if (!actor || actor.soulId !== context.playerSoul || actor.name !== death.name || actor.origin !== death.origin
    || tick === null || age === null || age > 120n || (actor.sex !== 'female' && actor.sex !== 'male')
    || !['native', 'possessed', 'rebuilt'].includes(actor.origin)) {
    throw new Error('Obituary requires the frozen native deceased identity and age.');
  }
  const survivors = [...relatives(kin.spouse), ...relatives(kin.livingChildren), ...relatives(kin.livingGrandchildren)];
  const precededInDeath = [...relatives(kin.deceasedSpouses), ...relatives(kin.deceasedParents), ...relatives(kin.deceasedChildren), ...relatives(kin.deceasedSiblings)];
  const forgiven = new Set<string>();
  const paid = new Set<string>();
  const targets = new Set<number>();
  let forgivenessKnown = true, collectionsKnown = true, demandsKnown = true, targetsKnown = true;
  let demands = 0n;
  for (const record of notebook.chronicle.values()) {
    if ((record.applied !== 'forgive_debt' && record.applied !== 'demand_payment')
      || BigInt(record.tick) > tick || record.skipped.some(part => part.part === 0)) continue;
    if (!notebook.contexts.get(`c:${record.index}`) && record.actorContext.some(basis => basis.relativeTo === death.body)) {
      if (record.applied === 'forgive_debt') forgivenessKnown = false;
      else { demandsKnown = false; targetsKnown = false; }
      continue;
    }
    if (!sameLife(notebook, `c:${record.index}`, context)) continue;
    if (record.applied === 'demand_payment') {
      demands++;
      const target = record.stakes.who.length === 1 ? record.stakes.who[0] : undefined;
      const linked = record.appended.some(id => {
        const action = notebook.events.get(id);
        return action?.kind.type === 'social' && action.kind.kind === 'quarrel'
          && action.kind.doer === death.body && action.kind.target === target && action.tick === record.tick
          && sameLife(notebook, `e:${id}`, context);
      });
      if (target === undefined || target === death.body || !linked) targetsKnown = false;
      else targets.add(target);
      continue;
    }
    let linked = false;
    for (const id of record.appended) {
      const action = notebook.events.get(id);
      if (action?.kind.type !== 'debt_forgiven' || action.kind.creditor !== death.body
        || action.tick !== record.tick || !sameLife(notebook, `e:${id}`, context)
        || record.stakes.who.length !== 1 || action.kind.debtor !== record.stakes.who[0]
        || action.causedBy.some(cause => notebook.events.get(cause)?.kind.type === 'death')) continue;
      linked = true;
      const loan = originalLoan(notebook, action);
      if (loan === null) forgivenessKnown = false;
      else forgiven.add(loan);
    }
    if (!linked) forgivenessKnown = false;
  }
  const burners = new Set<number>();
  const inheritances: StoryEvent[] = [];
  for (const action of notebook.events.values()) {
    if (action.kind.type === 'repayment' && action.kind.payee === death.body && BigInt(action.tick) <= tick) {
      if (!notebook.contexts.get(`e:${action.id}`)) collectionsKnown = false;
      else if (sameLife(notebook, `e:${action.id}`, context)) {
        const amount = u64(action.kind.amount);
        const loan = originalLoan(notebook, action);
        if (amount === null || amount === 0n || loan === null) collectionsKnown = false;
        else paid.add(loan);
      }
    }
    if (action.tick !== event.tick) continue;
    if (action.kind.type === 'inheritance' && action.kind.deceased === death.body && action.causedBy.includes(event.id)) inheritances.push(action);
    if (action.kind.type === 'offering' && action.kind.ghost === death.body) {
      const amount = u64(action.kind.amount);
      if (amount === null) throw new Error('Obituary received an invalid native offering amount.');
      if (amount > 0n) burners.add(action.kind.offerer);
    }
  }
  let estate: ObituaryFactsV1['estate'] = null;
  if (inheritances.length) {
    let total = 0n, known = true;
    const heirs = new Map<number, NonNullable<ObituaryFactsV1['estate']>['heirs'][number]>();
    const survivorRoles = new Map<number, Relation>();
    for (const person of [...kin.spouse, ...kin.livingChildren, ...kin.livingGrandchildren]) survivorRoles.set(person.person, relation(person.relation, person.sex)!);
    for (const action of inheritances) {
      if (action.kind.type !== 'inheritance') continue;
      const heirId = action.kind.heir;
      const amount = u64(action.kind.amount);
      const heir = notebook.contexts.get(`e:${action.id}`)?.actors.get(action.kind.heir) ?? context.actors.get(action.kind.heir);
      if (amount === null || amount === U64_MAX || !heir) { known = false; continue; }
      total += amount;
      const observed = context.actorContext.find(basis => basis.basis === 'observed-day-start')
        ?? context.actorContext.find(basis => basis.basis === 'observed-day-end');
      const role = observed?.actors.find(person => person.person === heirId)?.kinRole;
      heirs.set(heirId, { fullName: heir.name, relation: survivorRoles.get(heirId) ?? (role ? relation(role, heir.sex) : null) });
    }
    if (known && total <= U64_MAX) estate = { valueDollars: total.toString(), heirs: [...heirs].sort(([a], [b]) => a - b).map(([, heir]) => heir) };
  }
  const facts: ObituaryFactsV1 = {
    version: 1,
    deceased: { fullName: actor.name, sex: actor.sex, ageYears: Number(age),
      deathDate: { year: (tick / 365n + 1n).toString(), day: Number(tick % 365n + 1n), label: dateLabel(event.tick) },
      origin: actor.origin === 'native' ? 'born in town' : actor.origin === 'possessed' ? 'borrowed body' : 'rebuilt body' },
    survivors, precededInDeath,
    debtActions: { forgivenDebts: forgivenessKnown ? count(forgiven.size) : null,
      demandsMade: demandsKnown && demands <= U64_MAX ? demands.toString() : null, peopleAskedForPayment: targetsKnown ? count(targets.size) : null },
    collections: { debtsPaidOn: collectionsKnown ? count(paid.size) : null },
    estate, jossBurnersOnDeathDay: count(burners.size),
  };
  if (parseObituaryFacts(facts) === null) throw new Error('Obituary native facts do not satisfy the closed model contract.');
  return freezeFacts(facts);
}
