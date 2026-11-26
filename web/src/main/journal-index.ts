import type { StoryChronicle, StoryEvent, StoryIdentity } from '../shared/story.ts';
import { keyedStore, PersistentTree, type IndexedSequence, type TreeConfig } from './persistent-store.ts';

export function compareDecimal(a: string, b: string): number {
  const left = BigInt(a), right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
export function repeatedKey(event: StoryEvent): string | undefined {
  const kind = event.kind;
  if (kind.type === 'social') return `social:${kind.kind}:${kind.doer}:${kind.target}`;
  if (kind.type === 'repayment' && event.causedBy.length) return `repayment:${kind.payer}:${kind.payee}:${[...event.causedBy].sort(compareDecimal).join(',')}`;
  return undefined;
}
export interface EventReference {
  readonly identity: StoryIdentity;
  readonly id: string;
  readonly tick: string;
  readonly repeat: string | undefined;
  readonly amount: bigint;
}
interface Totals {
  readonly count: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly first: EventReference | null;
  readonly repeat: string | undefined | null;
  readonly sum: bigint;
}
const emptyTotals: Totals = { count: 0, from: null, to: null, first: null, repeat: undefined, sum: 0n };
function combineTotals(left: Totals, right: Totals): Totals {
  if (!left.count) return right;
  if (!right.count) return left;
  return { count: left.count + right.count, from: compareDecimal(left.from!, right.from!) < 0 ? left.from : right.from, to: compareDecimal(left.to!, right.to!) > 0 ? left.to : right.to, first: compareReference(left.first!, right.first!) < 0 ? left.first : right.first, repeat: left.repeat === right.repeat ? left.repeat : null, sum: left.sum + right.sum };
}
function compareReference(a: EventReference, b: EventReference): number {
  return compareDecimal(a.tick, b.tick) || compareDecimal(a.id, b.id);
}
const refConfig: TreeConfig<EventReference, EventReference, Totals> = {
  compare: compareReference, empty: emptyTotals,
  combine: (left, value, right) => combineTotals(combineTotals(left, { count: 1, from: value.tick, to: value.tick, first: value, repeat: value.repeat, sum: value.amount }), right),
};
type References = PersistentTree<EventReference, EventReference, Totals>;
const chronicleRefConfig = { ...refConfig, compare: (a: EventReference, b: EventReference) => compareDecimal(a.id, b.id) };
export interface GroupMetadata {
  readonly identity: StoryIdentity;
  readonly identityTick?: string;
  readonly from: string;
  readonly to: string;
  readonly primary: boolean;
  readonly milestone: boolean;
  readonly opening: boolean;
  readonly totals: Totals;
  readonly references: References;
  readonly constituents: Candidates | null;
  readonly missing: number;
  readonly repeatBucket?: string;
}
function compareGroup(a: GroupMetadata, b: GroupMetadata): number {
  return compareDecimal(a.from, b.from) || compareDecimal(a.identity.slice(2), b.identity.slice(2)) || a.identity.localeCompare(b.identity);
}
const candidateConfig: TreeConfig<GroupMetadata, GroupMetadata, Totals> = {
  compare: compareGroup, empty: emptyTotals,
  combine: (left, value, right) => combineTotals(combineTotals(left, value.totals), right),
};
type Candidates = PersistentTree<GroupMetadata, GroupMetadata, Totals>;
const finalConfig: TreeConfig<GroupMetadata, GroupMetadata, undefined> = { compare: compareGroup, empty: undefined, combine: () => undefined };
type FinalGroups = PersistentTree<GroupMetadata, GroupMetadata>;
export interface JournalIndex {
  readonly claims: PersistentTree<string, string>;
  readonly links: PersistentTree<string, PersistentTree<string, true>>;
  readonly chronicles: PersistentTree<string, GroupMetadata>;
  readonly repeats: PersistentTree<string, References>;
  readonly weeks: PersistentTree<string, Candidates>;
  readonly life: FinalGroups;
  readonly town: FinalGroups;
  readonly all: FinalGroups;
  readonly promotion: PersistentTree<string, StoryEvent>;
  readonly latestPrimary: StoryIdentity | null;
}
export function createJournalIndex(): JournalIndex {
  return { claims: keyedStore(), links: keyedStore(), chronicles: keyedStore(), repeats: keyedStore(), weeks: keyedStore(), life: new PersistentTree(finalConfig), town: new PersistentTree(finalConfig), all: new PersistentTree(finalConfig), promotion: new PersistentTree({ compare: compareDecimal, empty: undefined, combine: () => undefined }), latestPrimary: null };
}
function eventReference(event: StoryEvent): EventReference {
  return { identity: `e:${event.id}`, id: event.id, tick: event.tick, repeat: repeatedKey(event), amount: event.kind.type === 'repayment' ? BigInt(event.kind.amount) : 0n };
}
function eventGroup(event: StoryEvent, opening: boolean): GroupMetadata {
  const reference = eventReference(event);
  const references = new PersistentTree(refConfig).set(reference, reference);
  const milestone = ['birth', 'death', 'marriage', 'inheritance', 'possession', 'rebuild'].includes(event.kind.type);
  const primary = event.relevance !== 'background';
  const repeatBucket = !milestone && reference.repeat ? `${primary}:${opening}:${event.kind.type === 'repayment' ? 'loan-span' : BigInt(event.tick) / 7n}:${reference.repeat}:${JSON.stringify(event.actorContext)}` : undefined;
  return { identity: reference.identity, from: event.tick, to: event.tick, primary, milestone, opening, references, totals: references.aggregate, constituents: null, missing: 0, repeatBucket };
}
function repeatedGroup(references: References, template: GroupMetadata): GroupMetadata {
  const totals = references.aggregate;
  return { ...template, identity: references.at(0)!.identity, from: totals.from!, to: totals.to!, totals, references };
}
function weekKey(group: GroupMetadata): string | undefined {
  if (group.milestone || BigInt(group.from) / 7n !== BigInt(group.to) / 7n) return undefined;
  return `${group.primary}:${group.opening}:${BigInt(group.from) / 7n}`;
}
function weekOutput(candidates: Candidates): GroupMetadata | null {
  const first = candidates.at(0);
  if (!first) return null;
  if (candidates.size < 2 || candidates.aggregate.count < 6) return null;
  const totals = candidates.aggregate;
  return { ...first, from: totals.from!, to: totals.to!, totals, constituents: candidates };
}
/** A local writer owns only new roots; every tree and group in an older index stays immutable. */
export class JournalIndexWriter {
  index: JournalIndex;
  constructor(index: JournalIndex) { this.index = index; }
  private final(group: GroupMetadata, add: boolean): void {
    const section = group.primary ? 'life' : 'town';
    this.index = { ...this.index, [section]: add ? this.index[section].set(group, group) : this.index[section].delete(group), all: add ? this.index.all.set(group, group) : this.index.all.delete(group) };
  }
  private candidate(group: GroupMetadata, add: boolean): void {
    const key = weekKey(group);
    if (key === undefined) { this.final(group, add); return; }
    const before = this.index.weeks.get(key) ?? new PersistentTree(candidateConfig);
    const oldOutput = weekOutput(before);
    const after = add ? before.set(group, group) : before.delete(group);
    const newOutput = weekOutput(after);
    if (oldOutput) this.final(oldOutput, false);
    if (newOutput) {
      if (!oldOutput) for (const prior of before.values()) this.final(prior, false);
      this.final(newOutput, true);
    } else {
      if (oldOutput) for (const next of after.values()) this.final(next, true);
      else this.final(group, add);
    }
    this.index = { ...this.index, weeks: after.size ? this.index.weeks.set(key, after) : this.index.weeks.delete(key) };
  }
  private unclaimed(event: StoryEvent, opening: boolean, add: boolean): void {
    const group = eventGroup(event, opening);
    const key = group.repeatBucket;
    if (key === undefined) this.candidate(group, add);
    else {
      const before = this.index.repeats.get(key) ?? new PersistentTree(refConfig);
      const ref = group.references.at(0)!;
      if (before.size) this.candidate(repeatedGroup(before, group), false);
      const after = add ? before.set(ref, ref) : before.delete(ref);
      if (after.size) this.candidate(repeatedGroup(after, group), true);
      this.index = { ...this.index, repeats: after.size ? this.index.repeats.set(key, after) : this.index.repeats.delete(key) };
    }
    if (!group.primary && !opening) this.index = { ...this.index, promotion: add ? this.index.promotion.set(event.id, event) : this.index.promotion.delete(event.id) };
  }
  private updateChronicle(index: string, change: (group: GroupMetadata) => GroupMetadata): void {
    const before = this.index.chronicles.get(index)!;
    this.final(before, false);
    const after = change(before);
    this.index = { ...this.index, chronicles: this.index.chronicles.set(index, after) };
    this.final(after, true);
  }
  private chronicleEvent(group: GroupMetadata, event: StoryEvent, add: boolean): GroupMetadata {
    const ref = eventReference(event);
    const references = add ? group.references.set(ref, ref) : group.references.delete(ref);
    const totals = references.aggregate;
    // The Chronicle's own tick participates in its bounds even with no linked facts.
    const recordTick = group.identityTick!;
    return { ...group, references, totals, from: totals.from === null || compareDecimal(recordTick, totals.from) < 0 ? recordTick : totals.from, to: totals.to === null || compareDecimal(recordTick, totals.to) > 0 ? recordTick : totals.to };
  }
  event(event: StoryEvent, opening: boolean): void {
    if (event.relevance !== 'background') this.index = { ...this.index, latestPrimary: `e:${event.id}` };
    const interested = this.index.links.get(event.id);
    if (interested) {
      for (const [index] of interested) this.updateChronicle(index, group => ({ ...group, missing: group.missing - 1 }));
      this.index = { ...this.index, links: this.index.links.delete(event.id) };
    }
    const owner = this.index.claims.get(event.id);
    if (owner !== undefined) this.updateChronicle(owner, group => this.chronicleEvent(group, event, true));
    else this.unclaimed(event, opening, true);
  }
  chronicle(record: StoryChronicle, opening: boolean, events: Pick<ReadonlyMap<string, StoryEvent>, 'get'>, qualifications: Pick<ReadonlyMap<StoryIdentity, boolean>, 'get'>): void {
    const references = new PersistentTree(chronicleRefConfig);
    let group: GroupMetadata = { identity: `c:${record.index}`, identityTick: record.tick, from: record.tick, to: record.tick, primary: true, milestone: true, opening, totals: references.aggregate, references, constituents: null, missing: 0 };
    for (const id of new Set(record.appended)) {
      const event = events.get(id);
      if (!event) {
        const interested = this.index.links.get(id) ?? keyedStore<string, true>();
        this.index = { ...this.index, links: this.index.links.set(id, interested.set(record.index, true)) };
        group = { ...group, missing: group.missing + 1 };
      }
      const owner = this.index.claims.get(id);
      if (owner !== undefined && compareDecimal(owner, record.index) <= 0) continue;
      if (event) {
        if (owner !== undefined) this.updateChronicle(owner, prior => this.chronicleEvent(prior, event, false));
        else this.unclaimed(event, qualifications.get(`e:${id}`) === true, false);
        group = this.chronicleEvent(group, event, true);
      }
      this.index = { ...this.index, claims: this.index.claims.set(id, record.index) };
    }
    this.index = { ...this.index, chronicles: this.index.chronicles.set(record.index, group), latestPrimary: group.identity };
    this.final(group, true);
  }
}

/** Weekly groups share constituent member trees rather than copying a long repayment. */
export class GroupMembers implements IndexedSequence<StoryIdentity> {
  readonly group: GroupMetadata;
  constructor(group: GroupMetadata) { this.group = group; }
  get length(): number { return this.group.totals.count + (this.group.identity.startsWith('c:') ? 1 : 0); }
  at(index: number): StoryIdentity | undefined {
    if (index < 0) index += this.length;
    return index < 0 || index >= this.length ? undefined : this.slice(index, index + 1)[0];
  }
  slice(start = 0, end = this.length): StoryIdentity[] {
    start = start < 0 ? Math.max(0, this.length + start) : Math.min(this.length, start);
    end = end < 0 ? Math.max(0, this.length + end) : Math.min(this.length, end);
    if (end <= start) return [];
    const result: StoryIdentity[] = [];
    if (this.group.identity.startsWith('c:')) {
      if (start === 0) result.push(this.group.identity);
      start = Math.max(0, start - 1); end--;
    }
    for (const reference of this.references(start, end)) result.push(reference.identity);
    return result;
  }
  private *references(start: number, end: number): IterableIterator<EventReference> {
    if (!this.group.constituents) { yield* this.group.references.values(start, end); return; }
    const parts = [...this.group.constituents.values()].map(group => ({ root: group.references, low: 0, high: group.references.size, position: 0 }));
    // Locate the first requested rank once; subsequent members share successor cursors.
    if (start > 0) while (true) {
      const pivots = parts.filter(part => part.low < part.high).map(part => ({ part, reference: part.root.at(Math.floor((part.low + part.high) / 2))! })).sort((a, b) => compareReference(a.reference, b.reference));
      const pivot = pivots[Math.floor(pivots.length / 2)]!;
      let before = 0;
      for (const part of parts) { part.position = part.root.rank(pivot.reference); before += part.position; }
      if (before === start) break;
      for (const part of parts) {
        if (before < start) part.low = Math.max(part.low, part.position + (part === pivot.part ? 1 : 0));
        else part.high = Math.min(part.high, part.position);
      }
    }
    const heap: { cursor: IterableIterator<EventReference>; reference: EventReference }[] = [];
    for (const part of parts) {
      const cursor = part.root.values(part.position);
      const next = cursor.next();
      if (next.done) continue;
      const entry = { cursor, reference: next.value };
      let index = heap.length;
      heap.push(entry);
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (compareReference(heap[parent]!.reference, entry.reference) <= 0) break;
        heap[index] = heap[parent]!; index = parent;
      }
      heap[index] = entry;
    }
    for (let rank = start; rank < end && heap.length; rank++) {
      const first = heap[0]!;
      yield first.reference;
      if (rank + 1 >= end) return;
      const next = first.cursor.next();
      if (next.done) {
        const last = heap.pop()!;
        if (!heap.length) return;
        heap[0] = last;
      } else first.reference = next.value;
      const entry = heap[0]!;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && compareReference(heap[child + 1]!.reference, heap[child]!.reference) < 0) child++;
        if (compareReference(entry.reference, heap[child]!.reference) <= 0) break;
        heap[index] = heap[child]!; index = child;
      }
      heap[index] = entry;
    }
  }
  *[Symbol.iterator](): IterableIterator<StoryIdentity> {
    if (this.group.identity.startsWith('c:')) yield this.group.identity;
    for (const reference of this.references(0, this.group.totals.count)) yield reference.identity;
  }
}
