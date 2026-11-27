import { OBITUARY_MODEL, OBITUARY_PROMPT_SHA256, OBITUARY_PROMPT_VERSION, parseObituaryFacts, type FallbackReason, type ObituaryFactsV1, type ObituaryRecordV1, type ObituaryResultV1 } from '../shared/obituary.ts';
import { renderObituaryTemplate } from './obituary-template.ts';

export type ObituaryDeath = ObituaryRecordV1['death'];
export interface ObituaryEntry {
  readonly runId: string;
  readonly death: ObituaryDeath;
  readonly facts: ObituaryFactsV1;
  readonly template: string;
  readonly operationKey: string | null;
  readonly attempt: 'pending' | 'terminal';
  readonly result: ObituaryResultV1 | null;
  readonly ready: boolean;
}
interface MutableEntry extends Omit<ObituaryEntry, 'operationKey' | 'attempt' | 'result' | 'ready'> {
  operationKey: string | null;
  attempt: 'pending' | 'terminal';
  result: ObituaryResultV1 | null;
  ready: boolean;
}
function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key in value) if (Object.hasOwn(value, key)) freezeOwned(value[key]);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
export function obituaryTemplateResult(entry: ObituaryEntry, reason: FallbackReason, model: typeof OBITUARY_MODEL | null = null): ObituaryResultV1 {
  return { text: entry.template, source: 'template', fallbackReason: reason, model,
    promptVersion: OBITUARY_PROMPT_VERSION, promptSha256: OBITUARY_PROMPT_SHA256 };
}

/** 只属于当前页的一次游戏；账本从不进入 World、存储或 replay。 */
export class ObituaryRun {
  readonly runId: string;
  readonly worldId: number;
  #entries = new Map<string, MutableEntry>();
  constructor(worldId: number) {
    this.worldId = worldId;
    this.runId = crypto.randomUUID();
  }
  hasDeath(deathEvent: string): boolean { return this.#entries.has(deathEvent); }
  admit(death: ObituaryDeath, facts: ObituaryFactsV1): ObituaryEntry | null {
    const prior = this.#entries.get(death.eventId);
    if (prior !== undefined) {
      if (prior.death.personId !== death.personId || prior.death.tick !== death.tick || prior.death.lifeKey !== death.lifeKey) {
        throw new Error('An obituary Death identity changed within its run.');
      }
      return null;
    }
    if (death.lifeKey !== `${this.worldId}/life/${death.personId}` || parseObituaryFacts(facts) === null) {
      throw new Error('An obituary requires closed facts from its exact owned life.');
    }
    // pending 先入账，之后才能开始摘要计算和网络请求。
    const entry: MutableEntry = { runId: this.runId, death: freezeOwned(death), facts: freezeOwned(facts),
      template: renderObituaryTemplate(facts), operationKey: null, attempt: 'pending', result: null, ready: false };
    this.#entries.set(death.eventId, entry);
    return entry;
  }
  setOperationKey(entry: ObituaryEntry, operationKey: string): void {
    const current = this.#entries.get(entry.death.eventId);
    if (current !== entry || current.operationKey !== null || !/^[a-f0-9]{64}$/.test(operationKey)) {
      throw new Error('Invalid obituary operation ownership.');
    }
    current.operationKey = operationKey;
  }
  terminal(entry: ObituaryEntry, result: ObituaryResultV1): boolean {
    const current = this.#entries.get(entry.death.eventId);
    if (current !== entry || current.attempt === 'terminal') return false;
    if (current.operationKey === null) throw new Error('Obituary operation identity is not ready.');
    if (result.source === 'template' && result.text !== current.template) throw new Error('Obituary template words changed.');
    current.result = freezeOwned(result);
    current.attempt = 'terminal';
    return true;
  }
  markReady(deathEvent: string): boolean {
    const entry = this.#entries.get(deathEvent);
    if (entry === undefined || entry.ready) return false;
    entry.ready = true;
    return true;
  }
  entries(): readonly ObituaryEntry[] { return [...this.#entries.values()]; }
  visible(): readonly ObituaryEntry[] {
    return [...this.#entries.values()].filter(entry => entry.ready && entry.attempt === 'terminal');
  }
  archive(prefixTick: bigint): Extract<ObituaryRecordV1, { attempt: 'terminal' }>[] {
    const records: Extract<ObituaryRecordV1, { attempt: 'terminal' }>[] = [];
    for (const entry of this.#entries.values()) {
      if (BigInt(entry.death.tick) >= prefixTick) continue;
      if (entry.attempt !== 'terminal' || entry.result === null || entry.operationKey === null) {
        throw new Error('The exported replay prefix still has a pending obituary.');
      }
      records.push({ runId: entry.runId, death: entry.death, operationKey: entry.operationKey,
        facts: entry.facts, attempt: 'terminal', result: entry.result });
    }
    return records;
  }
}
