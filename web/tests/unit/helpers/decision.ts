import { readFileSync } from 'node:fs';
import {
  WasmSim, llm_render_system_one, llm_validate,
} from '../../../../target/wasm-pkg/sim_wasm.js';
import { loadWasm } from './wasm.ts';
import { DECISION_CONTRACT } from '../../../src/shared/decision-contract.ts';
import { DECISION_CONFIG_VERSION, DECISION_REQUEST_VERSION,
  type DecisionConfig, type DecisionRequest, type ModelDecision } from '../../../src/shared/decision.ts';
import type { DecisionClient, DecisionPreview, DecisionTiming } from '../../../src/worker/decision-bridge.ts';

export const request: DecisionRequest = {
  version: DECISION_REQUEST_VERSION, family: 'dream_interpretation',
  mapping_version: DECISION_CONTRACT.mappingVersion, mapping_hash: DECISION_CONTRACT.mappingHash,
  question_id: 'decision', metadata: { bridge_version: 'slow-think-v1' },
  state: 'Today is day 1654.', instructions: 'Choose one option.',
  criteria: [{ id: 'heed_warning', label: 'Heed the warning.' }, { id: 'dismiss_dream', label: 'Dismiss the dream.' }],
};
export function modelDecision(choice = request.criteria[0]!.id, session_cap = 40): ModelDecision {
  return { version: DECISION_CONTRACT.responseSchema, choice, model: DECISION_CONTRACT.model,
    mapping_version: DECISION_CONTRACT.mappingVersion, mapping_hash: DECISION_CONTRACT.mappingHash,
    fingerprint: DECISION_CONTRACT.fingerprint, usage: null, session_cap };
}
export function config(session_cap = 40, enabled = true): DecisionConfig {
  return { version: DECISION_CONFIG_VERSION, enabled, session_cap };
}
export class DecisionClock implements DecisionTiming {
  milliseconds = 0;
  private next = 0;
  readonly timers = new Map<number, { at: number; callback: () => void }>();
  now(): number { return this.milliseconds; }
  schedule(callback: () => void, milliseconds: number): () => void {
    const id = ++this.next;
    this.timers.set(id, { at: this.milliseconds + milliseconds, callback });
    return () => { this.timers.delete(id); };
  }
  advance(milliseconds: number): void {
    this.milliseconds += milliseconds;
    for (const [id, timer] of this.timers) {
      if (timer.at <= this.milliseconds) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}
export class ControlledDecisionClient implements DecisionClient {
  readonly prefetched = Promise.withResolvers<DecisionConfig>();
  readonly configSignals: AbortSignal[] = [];
  readonly attempts: { request: DecisionRequest; signal: AbortSignal;
    response: PromiseWithResolvers<ModelDecision> }[] = [];
  config(signal: AbortSignal): Promise<DecisionConfig> {
    this.configSignals.push(signal);
    return this.prefetched.promise;
  }
  decide(request: DecisionRequest, signal: AbortSignal): Promise<ModelDecision> {
    const response = Promise.withResolvers<ModelDecision>();
    this.attempts.push({ request, signal, response });
    return response.promise;
  }
}
/** Drain only microtasks, never real deadline timers. */
export async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
export const wasm = { llm_render_system_one, llm_validate };
export const mapping = readFileSync(new URL('../../../src/shared/system-one-v1.txt', import.meta.url), 'utf8');
let previews: DecisionPreview[] | undefined;
export function realPreviews(): DecisionPreview[] {
  if (previews !== undefined) return previews;
  loadWasm();
  const replay = JSON.parse(readFileSync(new URL('../../../../fixtures/parity/seedU-underworld.replay.json', import.meta.url), 'utf8')) as {
    seed: string; config: unknown; inputs: { tick: string; seq: string; payload: unknown }[];
  };
  const sim = new WasmSim(BigInt(replay.seed), JSON.stringify(replay.config));
  try {
    for (const input of replay.inputs) {
      if (BigInt(input.seq) >= 61n) break;
      sim.submit(JSON.stringify({ tick: input.tick, payload: input.payload }));
    }
    sim.run_ticks(1654);
    previews = ['{"Dream":{"dreamer":"31","intent":"urge"}}', '{"Bribe":{"amount":"1"}}']
      .map(payload => JSON.parse(sim.preview_node(payload)) as DecisionPreview);
    return previews;
  } finally {
    sim.free();
  }
}
