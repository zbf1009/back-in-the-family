import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WasmSim, llm_render_system_one, llm_validate,
} from '../../../../target/wasm-pkg/sim_wasm.js';
import { loadWasm } from './wasm.ts';
import { DECISION_CONTRACT } from '../../../src/shared/decision-contract.ts';
import { DECISION_CONFIG_VERSION, DECISION_REQUEST_VERSION, isDecisionRequest,
  type DecisionConfig, type DecisionRequest, type ModelDecision } from '../../../src/shared/decision.ts';
import { createSameOriginDecisionClient, DecisionBridge,
  type DecisionClient, type DecisionPreview, type DecisionTiming, type DecisionWasm } from '../../../src/worker/decision-bridge.ts';
import { handleRequest, type DecisionAI } from '../../../../worker-api/src/handler.ts';

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
/** Existing real-WASM decision fixture with its interactive gate answered through Rust. */
export function actualSim(): WasmSim {
  loadWasm();
  const replay = JSON.parse(readFileSync(new URL('../../../../fixtures/parity/seedU-underworld.replay.json', import.meta.url), 'utf8')) as {
    seed: string; config: unknown; inputs: { tick: string; seq: string; payload: unknown }[];
  };
  const sim = new WasmSim(BigInt(replay.seed), JSON.stringify(replay.config));
  for (const input of replay.inputs) {
    if (BigInt(input.seq) >= 61n) break;
    sim.submit(JSON.stringify({ tick: input.tick, payload: input.payload }));
  }
  sim.run_ticks(1654);
  const gate = JSON.parse(sim.player_node_state());
  if (gate.pending && !gate.answered) {
    const node = JSON.parse(sim.snapshot()).player_node;
    assert.deepEqual(JSON.parse(sim.submit_checked(JSON.stringify([
      { ChoosePlayer: { node: gate.node, option: node.rules_default } },
    ]))), { ok: true });
  }
  return sim;
}

/** Native fake AI behind the real HTTP adapter and production request handler; never live inference. */
export class HandlerDecisionClient implements DecisionClient {
  readonly prefetched = Promise.withResolvers<DecisionConfig>();
  readonly configSignals: AbortSignal[] = [];
  readonly attempts: { request: DecisionRequest; signal: AbortSignal; completed: Promise<void> }[] = [];
  readonly posts: { body: string; headers: Headers; status: number; result: unknown }[] = [];
  readonly aiCalls: Parameters<DecisionAI['run']>[] = [];
  private readonly transport: DecisionClient;
  constructor(clock: DecisionClock, choice: string, options: {
    inferenceEnabled: boolean; requestByteCap: number | undefined; sessionCap: number;
  }) {
    const ai: DecisionAI = { run: async (model, input, runOptions) => {
      this.aiCalls.push([model, input, runOptions]);
      return Response.json({ model: 'offline-transport-fixture',
        answers: { decision: { type: 'choice', choice } }, usage: { input_tokens: 23, output_tokens: 2 } });
    } };
    const environment = { INFERENCE_ENABLED: options.inferenceEnabled, SESSION_CAP: options.sessionCap,
      ...(options.requestByteCap === undefined ? {} : { MAX_REQUEST_BYTES: options.requestByteCap }) };
    const fetcher: typeof fetch = async (input, init) => {
      const incoming = new Request(input, init);
      if (incoming.method !== 'POST') return handleRequest(incoming, environment, ai);
      assert.equal(typeof init?.body, 'string');
      const body = init!.body as string;
      assert.ok(isDecisionRequest(JSON.parse(body)), 'padding must remain a valid production-schema request');
      assert.equal(incoming.headers.has('content-length'), false, 'the handler must count actual streamed bytes');
      const response = await handleRequest(incoming, environment, ai);
      this.posts.push({ body, headers: incoming.headers, status: response.status, result: await response.clone().json() });
      clock.advance(125);
      return response;
    };
    this.transport = createSameOriginDecisionClient('https://decision.test', fetcher);
  }
  config(signal: AbortSignal): Promise<DecisionConfig> {
    this.configSignals.push(signal);
    return this.transport.config(signal).then(value => {
      this.prefetched.resolve(value); return value;
    }, error => { this.prefetched.reject(error); throw error; });
  }
  decide(request: DecisionRequest, signal: AbortSignal): Promise<ModelDecision> {
    const completed = Promise.withResolvers<void>();
    this.attempts.push({ request, signal, completed: completed.promise });
    return this.transport.decide(request, signal).finally(() => { completed.resolve(); });
  }
}

/**
 * Transport-only padding, not a real game-world size or a worst-case corpus claim.
 * Calibrate with the existing bridge's actual serialization, not a second wire builder.
 * Rust still supplies the complete context, criteria, option order and validation.
 */
export async function transportPaddedWasm(preview: DecisionPreview, targetBytes: number): Promise<DecisionWasm> {
  const client = new ControlledDecisionClient(); const clock = new DecisionClock();
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  try {
    client.prefetched.resolve(config()); await settle();
    const pending = bridge.decide(preview, new AbortController().signal);
    const attempt = client.attempts[0]!;
    assert.ok(attempt, 'the unmodified Rust renderer must be eligible');
    const original = attempt.request;
    const bytes = new TextEncoder().encode(JSON.stringify(original)).byteLength;
    attempt.response.resolve(modelDecision(preview.rules_default));
    assert.equal((await pending).kind, 'model', 'calibration must retain real Rust legality');
    const marker = '\n[transport-fixture padding; not game-world worst-case]\n' + 'é🙂"\\\n'.repeat(200);
    const markerBytes = new TextEncoder().encode(JSON.stringify(marker)).byteLength - 2;
    assert.ok(targetBytes >= bytes + markerBytes, 'the genuine fixture must fit without truncating world data');
    const padding = marker + 'x'.repeat(targetBytes - bytes - markerBytes);
    return { ...wasm, llm_render_system_one: input => {
      const rendered = JSON.parse(wasm.llm_render_system_one(input));
      assert.equal(rendered.ok, true);
      assert.equal(rendered.state, original.state, 'the controller must preview the same authoritative Rust context');
      assert.deepEqual(rendered.criteria, original.criteria);
      rendered.state += padding;
      return JSON.stringify(rendered);
    } };
  } finally { bridge.dispose(); }
}
