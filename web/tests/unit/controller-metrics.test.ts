import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { WasmSim, verify_replay } from '../../../target/wasm-pkg/sim_wasm.js';
import { DecisionMetrics, type DecisionMetricsReport } from '../../src/shared/decision-metrics.ts';
import { PROJECT_REQUEST_BYTE_CAP, type DecisionFamily, type ModelDecision } from '../../src/shared/decision.ts';
import type { Reply, Request, WorkerMessage } from '../../src/shared/protocol.ts';
import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import { DecisionBridge, DecisionFailure, type DecisionPreview, type DecisionWasm } from '../../src/worker/decision-bridge.ts';
import { actualSim, ControlledDecisionClient, DecisionClock, HandlerDecisionClient, config, mapping, modelDecision,
  realPreviews, settle, transportPaddedWasm, wasm } from './helpers/decision.ts';
import { FakeFrameScheduler } from './helpers/fakes.ts';
import { checkedReceipt } from './helpers/wasm.ts';

class Frames extends FakeFrameScheduler {
  readonly callbacks: (() => void)[] = [];
  override request(callback: () => void): number { this.callbacks.push(callback); return super.request(callback); }
}
class Port implements SimHandle {
  tickValue = 0n;
  nextSeq = 0n;
  readonly batches: unknown[][] = [];
  readonly checkedAttempts: unknown[][] = [];
  rejectPair = false;
  rejectTrigger = false;
  preview = realPreviews()[0]!;
  snapshot(): string { return JSON.stringify({ tick: this.tickValue.toString(), underworld_view: null }); }
  tick(): bigint { return this.tickValue; }
  player_node_state(): string { return '{"pending":false}'; }
  checksums(): string { return '[]'; }
  submit(): void { throw Error('the decision must use checked submission'); }
  submit_checked(input: string): string {
    const batch: unknown[] = JSON.parse(input); this.checkedAttempts.push(batch);
    if (this.rejectTrigger || (this.rejectPair && batch.length === 2)) return '{"ok":false,"index":0,"reason":"illegal_option"}';
    this.batches.push(batch);
    return JSON.stringify({ ok: true, tick: String(this.tickValue), seqs: batch.map(() => String(this.nextSeq++)) });
  }
  step(): string { this.tickValue++; return '0000000000000001'; }
  run_ticks(n: number): string { this.tickValue += BigInt(n); return '0000000000000001'; }
  run_until_stop(n: number): string { this.tickValue += BigInt(n); return JSON.stringify({ ran: n, checksum: '0000000000000001', stops: [], actions: [], player_lifecycle: [] }); }
  export_replay(): string { return JSON.stringify({ tick: this.tickValue.toString(), inputs: this.batches }); }
}
async function setup(options: { ready?: boolean; cap?: number; enabled?: boolean; wasm?: DecisionWasm } = {}) {
  const clock = new DecisionClock(); const frames = new Frames(); const client = new ControlledDecisionClient();
  const bridge = new DecisionBridge(client, options.wasm ?? wasm, mapping, clock);
  const ports: Port[] = []; const messages: WorkerMessage[] = [];
  const controller = new SimController({ createSim: (_seed, value) => {
    if (value === 'bad') throw Error('bad config');
    const port = new Port(); ports.push(port); return port;
  }, clock, scheduler: frames, post: message => messages.push(message),
  decision: { bridge, timing: clock, previewNode: handle => JSON.stringify((handle as Port).preview),
    exportReplay: handle => (handle as Port).export_replay() } });
  controller.ready(); controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
  if (options.ready !== false) { client.prefetched.resolve(config(options.cap, options.enabled)); await settle(); }
  let id = 1;
  const send = (request: Omit<Request, 'id'> | { type: 'dream'; dreamer: number; intent: 'urge' }
    | { type: 'create-world'; seed: string; config: string }
    | { type: 'bribe'; amount: string }
    | { type: 'use-rules-now'; requestId: number; worldId: number }
    | { type: 'set-decision-wait'; seconds: number }) => {
    const next = ++id; controller.handle({ ...request, id: next } as Request); return next;
  };
  const replies = () => messages.filter((message): message is Reply => message.type === 'reply');
  const reply = (requestId: number) => replies().find(message => message.id === requestId);
  const decide = (family: DecisionFamily = 'dream_interpretation') => {
    const port = ports.at(-1)!; port.preview = realPreviews()[family === 'dream_interpretation' ? 0 : 1]!;
    return send(family === 'dream_interpretation' ? { type: 'dream', dreamer: 31, intent: 'urge' } : { type: 'bribe', amount: '1' });
  };
  const report = () => {
    const result = reply(send({ type: 'decision-metrics' }));
    assert.ok(result?.ok && result.metrics); return result.metrics;
  };
  return { clock, frames, client, bridge, controller, ports, messages, send, replies, reply, decide, report };
}
const outcomeArbitrary = fc.constantFrom('model', 'timeout', 'malformed', 'wrong_option', 'quota', 'network', 'session_cap');
type ControlledOutcome = 'model' | 'timeout' | 'malformed' | 'wrong_option' | 'quota' | 'network' | 'session_cap' | 'rate_limited' | 'payload_too_large';
function finish(client: ControlledDecisionClient, clock: DecisionClock, outcome: ControlledOutcome, choice: string): void {
  const attempt = client.attempts.at(-1)!;
  if (outcome === 'timeout') clock.advance(10000);
  else if (outcome === 'network') attempt.response.reject(Error('private provider output must never appear in metrics'));
  else if (outcome === 'quota' || outcome === 'rate_limited' || outcome === 'payload_too_large') attempt.response.reject(new DecisionFailure(outcome));
  else if (outcome === 'malformed') attempt.response.resolve({ ...modelDecision(choice), usage: { input_tokens: 7 } } as ModelDecision);
  else attempt.response.resolve(modelDecision(outcome === 'wrong_option' ? 'not_in_preview' : choice));
}

/** Independent report consumer: every retained leaf must be a bounded counter or an allowlisted label. */
function assertRedacted(report: DecisionMetricsReport): void {
  assert.deepEqual(Object.keys(report).sort(), ['appliedEvidence', 'counterLimit', 'families', 'optionBuckets', 'overflowed', 'scope', 'version']);
  assert.equal(report.version, 'decision-metrics-v1'); assert.equal(report.scope, 'page-session');
  assert.equal(report.optionBuckets, 'frozen-rust-order-0-through-4'); assert.equal(report.appliedEvidence, 'native-v5-audit-only');
  assert.equal(report.counterLimit, Number.MAX_SAFE_INTEGER); assert.equal(typeof report.overflowed, 'boolean');
  assert.deepEqual(Object.keys(report.families).sort(), ['dream_interpretation', 'magistrate_ruling']);
  const reasons = ['malformed_request', 'not_found', 'method_not_allowed', 'payload_too_large', 'model_error',
    'invalid_response', 'disabled', 'unavailable', 'quota', 'rate_limited', 'timeout', 'network', 'session_cap',
    'cancelled', 'zero_wait', 'config_pending', 'manual'].sort();
  for (const family of Object.values(report.families)) {
    assert.deepEqual(Object.keys(family).sort(), ['eligibleNodes', 'postAttempts', 'validatedModelChoices', 'checkedModelChoices',
      'checkedRulesFallbacks', 'cancelledOperations', 'abortedOperations', 'rejectedTriggers', 'skipsByReason', 'attemptOutcomes',
      'checkedFallbacksByReason', 'latencyBuckets', 'usage', 'options', 'agreement'].sort());
    assert.deepEqual(Object.keys(family.skipsByReason).sort(), reasons);
    assert.deepEqual(Object.keys(family.checkedFallbacksByReason).sort(), reasons);
    assert.deepEqual(Object.keys(family.attemptOutcomes).sort(), [...reasons, 'model', 'wasm_failure'].sort());
    assert.deepEqual(Object.keys(family.latencyBuckets).sort(), ['lt_250_ms', 'lt_1000_ms', 'lt_3000_ms', 'lt_10000_ms', 'gte_10000_ms', 'unknown'].sort());
    assert.deepEqual(Object.keys(family.usage).sort(), ['knownResponses', 'unknownResponses', 'inputTokens', 'outputTokens'].sort());
    assert.deepEqual(Object.keys(family.options).sort(), ['validatedModel', 'checkedModel', 'checkedRulesDefault'].sort());
    for (const options of Object.values(family.options)) assert.equal(options.length, 5);
    assert.deepEqual(Object.keys(family.agreement).sort(), ['validatedAgree', 'validatedDiverge', 'checkedAgree', 'checkedDiverge', 'unknownCheckedRulesDefault'].sort());
    const visit = (value: unknown): void => {
      if (value === null) return;
      if (typeof value === 'object') { for (const leaf of Object.values(value)) visit(leaf); return; }
      assert.equal(typeof value, 'number'); assert.ok(Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= Number.MAX_SAFE_INTEGER);
    };
    visit(family);
  }
}

test('fixed error/skip matrix reports explicit per-family denominators rather than inferring replay failures', async () => {
  const h = await setup({ ready: false });
  try {
    h.decide(); // configuration pending, no POST
    h.client.prefetched.resolve(config(7)); await settle();
    h.send({ type: 'set-decision-wait', seconds: 0 }); h.decide();
    h.send({ type: 'set-decision-wait', seconds: 10 });
    for (const outcome of ['model', 'wrong_option', 'network', 'timeout', 'quota', 'rate_limited', 'payload_too_large'] as const) {
      h.decide(); finish(h.client, h.clock, outcome, realPreviews()[0]!.rules_default); await settle();
    }
    h.decide(); // cap reached, no POST
    const f = h.report().families.dream_interpretation;
    assert.equal(f.eligibleNodes, 10); assert.equal(f.postAttempts, 7);
    assert.equal(f.validatedModelChoices, 1); assert.equal(f.checkedModelChoices, 1); assert.equal(f.checkedRulesFallbacks, 9);
    assert.equal(f.skipsByReason.config_pending, 1); assert.equal(f.skipsByReason.zero_wait, 1); assert.equal(f.skipsByReason.session_cap, 1);
    for (const reason of ['invalid_response', 'network', 'timeout', 'quota', 'rate_limited', 'payload_too_large'] as const) {
      assert.equal(f.attemptOutcomes[reason], 1); assert.equal(f.checkedFallbacksByReason[reason], 1); assert.equal(f.skipsByReason[reason], 0);
    }
    assert.equal(f.attemptOutcomes.model, 1); assert.equal(f.usage.unknownResponses, 1);
    assert.equal(Object.values(f.attemptOutcomes).reduce((a, b) => a + b, 0), 7);
    assert.equal(Object.values(f.skipsByReason).reduce((a, b) => a + b, 0), 3);
    assert.equal(f.agreement.checkedAgree, 1); assert.equal(f.agreement.unknownCheckedRulesDefault, 3);
    assert.equal(h.report().families.magistrate_ruling.eligibleNodes, 0);
    assertRedacted(h.report());
  } finally { h.bridge.dispose(); }
});

test('manual fallback and World cancellation retain spent attempts but only manual queues a trigger', async () => {
  const h = await setup();
  try {
    const first = h.decide();
    h.send({ type: 'use-rules-now', requestId: first, worldId: 1 }); await settle();
    const second = h.decide(); h.send({ type: 'create-world', seed: '2', config: '{}' }); await settle();
    assert.equal(h.reply(first)?.ok, true); assert.equal(h.reply(second)?.ok, false);
    const f = h.report().families.dream_interpretation;
    assert.equal(f.eligibleNodes, 2); assert.equal(f.postAttempts, 2); assert.equal(h.bridge.status().spent, 2);
    assert.equal(f.attemptOutcomes.cancelled, 2); assert.equal(f.cancelledOperations, 1);
    assert.equal(f.checkedModelChoices, 0); assert.equal(f.checkedRulesFallbacks, 1);
    assert.equal(f.checkedFallbacksByReason.manual, 1); assert.equal(f.checkedFallbacksByReason.cancelled, 0);
    assert.equal(f.skipsByReason.manual, 0); assert.equal(h.ports[0]!.batches.length, 1);
    assert.deepEqual(h.ports[1]!.batches, []);
  } finally { h.bridge.dispose(); }
});

test('disabled, failed config and invalid local construction are eligibility skips, not inference errors', async () => {
  for (const mode of ['disabled', 'failed_config', 'local_invalid'] as const) {
    const h = await setup({ ready: mode !== 'failed_config', enabled: mode !== 'disabled',
      wasm: mode === 'local_invalid' ? { ...wasm, llm_render_system_one: () => '{"ok":false}' } : wasm });
    try {
      if (mode === 'failed_config') { h.client.prefetched.reject(Error('private config failure')); await settle(); }
      const id = h.decide('magistrate_ruling'); await settle(); assert.equal(h.reply(id)?.ok, true);
      const f = h.report().families.magistrate_ruling;
      const reason = mode === 'disabled' ? 'disabled' : mode === 'failed_config' ? 'unavailable' : 'malformed_request';
      assert.equal(f.eligibleNodes, 1); assert.equal(f.postAttempts, 0); assert.equal(f.skipsByReason[reason], 1);
      assert.equal(f.checkedFallbacksByReason[reason], 1); assert.equal(f.checkedRulesFallbacks, 1);
      assert.equal(Object.values(f.attemptOutcomes).reduce((a, b) => a + b, 0), 0);
      assert.equal(h.bridge.status().spent, 0);
    } finally { h.bridge.dispose(); }
  }
});

test('validated response rejected at atomic commit is not reported as a checked model choice', async () => {
  const h = await setup(); h.ports[0]!.rejectPair = true;
  try {
    h.decide(); const preview = realPreviews()[0]!;
    h.client.attempts[0]!.response.resolve({ ...modelDecision(preview.rules_default), usage: { input_tokens: 23, output_tokens: 2 } });
    await settle(); const f = h.report().families.dream_interpretation;
    assert.equal(f.validatedModelChoices, 1); assert.equal(f.checkedModelChoices, 0);
    assert.equal(f.checkedRulesFallbacks, 1); assert.equal(f.checkedFallbacksByReason.invalid_response, 1);
    assert.equal(f.attemptOutcomes.model, 1); assert.equal(f.attemptOutcomes.invalid_response, 0);
    assert.equal(f.agreement.validatedAgree, 1); assert.equal(f.agreement.checkedAgree, 0);
    assert.deepEqual(f.usage, { knownResponses: 1, unknownResponses: 0, inputTokens: 23, outputTokens: 2 });
    assert.deepEqual(h.ports[0]!.batches, [[{ Dream: { dreamer: '31', intent: 'urge' } }]]);
  } finally { h.bridge.dispose(); }
});

test('rejected triggers and fatal WASM errors commit neither model nor Rules_Default counters', async () => {
  for (const mode of ['rejected', 'renderer_panic', 'validator_panic'] as const) {
    const h = await setup({ wasm: { ...wasm,
      ...(mode === 'renderer_panic' ? { llm_render_system_one: () => { throw new WebAssembly.RuntimeError('private panic'); } } : {}),
      ...(mode === 'validator_panic' ? { llm_validate: () => { throw new WebAssembly.RuntimeError('private panic'); } } : {}) } });
    try {
      if (mode === 'rejected') h.ports[0]!.rejectTrigger = true;
      h.decide(); if (h.client.attempts.length > 0) finish(h.client, h.clock, 'model', realPreviews()[0]!.rules_default);
      await settle(); const f = h.bridge.metrics!.report().families.dream_interpretation;
      assert.equal(f.checkedModelChoices, 0); assert.equal(f.checkedRulesFallbacks, 0); assert.equal(h.ports[0]!.batches.length, 0);
      assert.equal(f.rejectedTriggers, mode === 'rejected' ? 1 : 0);
      assert.equal(f.abortedOperations, mode === 'rejected' ? 0 : 1);
      assert.equal(f.attemptOutcomes.wasm_failure, mode === 'validator_panic' ? 1 : 0);
      assertRedacted(h.bridge.metrics!.report());
    } finally { h.bridge.dispose(); }
  }
});

test('Property 4: every generated Worker outcome answers once and commits only a legal pair or checked trigger', async () => {
  await fc.assert(fc.asyncProperty(outcomeArbitrary, fc.constantFrom(...['dream_interpretation', 'magistrate_ruling'] as const),
    fc.boolean(), async (outcome, family, useDefault) => {
      const h = await setup({ cap: outcome === 'session_cap' ? 0 : 40 });
      try {
        const id = h.decide(family); const preview = h.ports[0]!.preview;
        const choice = useDefault ? preview.rules_default : preview.option_ids.find(option => option !== preview.rules_default)!;
        if (outcome !== 'session_cap') finish(h.client, h.clock, outcome, choice);
        await settle(); const terminal = h.reply(id); assert.equal(terminal?.ok, true);
        assert.equal(h.replies().filter(reply => reply.id === id).length, 1);
        const trigger = family === 'dream_interpretation' ? { Dream: { dreamer: '31', intent: 'urge' } } : { Bribe: { amount: '1' } };
        assert.deepEqual(h.ports[0]!.batches, [outcome === 'model' ? [trigger,
          { Choose: { node: { Trigger: { seq: preview.trigger } }, option: choice, fingerprint: modelDecision(choice).fingerprint } }] : [trigger]]);
        const f = h.report().families[family];
        assert.equal(f.checkedModelChoices, outcome === 'model' ? 1 : 0);
        assert.equal(f.checkedRulesFallbacks, outcome === 'model' ? 0 : 1);
        assert.equal(f.postAttempts, outcome === 'session_cap' ? 0 : 1);
        if (h.client.attempts.length > 0) h.client.attempts[0]!.response.resolve(modelDecision(preview.rules_default));
        h.clock.advance(10000); await settle();
        assert.equal(h.replies().filter(reply => reply.id === id).length, 1); assert.equal(h.ports[0]!.batches.length, 1);
      } finally { h.bridge.dispose(); }
    }), { numRuns: 100, seed: 4204 });
});

test('Property 5: delayed response Frame timeout creation and cancellation permutations cannot affect a replacement World', async () => {
  await fc.assert(fc.asyncProperty(fc.shuffledSubarray(['model', 'timeout', 'replace', 'manual', 'failed_create', 'frame'] as const,
    { minLength: 6, maxLength: 6 }), async actions => {
      const h = await setup();
      try {
        h.send({ type: 'run' }); const staleFrame = h.frames.callbacks[0]!;
        const id = h.decide(); const oldPort = h.ports[0]!; const requestIds = [1, 2, id];
        let replaced = false;
        for (const action of actions) {
          if (action === 'model') finish(h.client, h.clock, 'model', realPreviews()[0]!.rules_default);
          else if (action === 'timeout') h.clock.advance(10000);
          else if (action === 'frame') staleFrame();
          else if (action === 'replace') { requestIds.push(h.send({ type: 'create-world', seed: '2', config: '{}' })); replaced = true; }
          else if (action === 'manual') requestIds.push(h.send({ type: 'use-rules-now', requestId: id, worldId: 1 }));
          else {
            requestIds.push(h.send({ type: 'create-world', seed: '2', config: 'bad' }));
            if (!replaced && h.reply(id) === undefined) assert.equal(h.client.attempts[0]!.signal.aborted, false);
          }
          await settle();
          if (replaced) { assert.equal(h.ports.at(-1)!.tickValue, 0n); assert.deepEqual(h.ports.at(-1)!.batches, []); }
        }
        for (const requestId of requestIds) assert.equal(h.replies().filter(reply => reply.id === requestId).length, 1);
        assert.equal(h.bridge.status().spent, 1); assert.equal(h.client.configSignals.length, 1);
        const terminalAction = actions.find(action => ['model', 'timeout', 'replace', 'manual'].includes(action))!;
        assert.equal(oldPort.batches.length, terminalAction === 'replace' ? 0 : 1);
        const f = h.report().families.dream_interpretation;
        assert.equal(f.cancelledOperations, terminalAction === 'replace' ? 1 : 0);
        assert.equal(f.checkedModelChoices + f.checkedRulesFallbacks, terminalAction === 'replace' ? 0 : 1);
        const before = h.messages.length; staleFrame(); h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.rules_default));
        await settle(); assert.equal(h.messages.length, before);
        const finalStatus = h.reply(h.send({ type: 'decision-status' }))!.snapshot;
        assert.equal(finalStatus.worldId, 2); assert.equal(finalStatus.decision?.outcome, null); assert.equal(finalStatus.tick, '0');
      } finally { h.bridge.dispose(); }
    }), { numRuns: 100, seed: 4205 });
});

test('Property 8: exact session cap survives replacement without refund and late config affects future nodes only', async () => {
  await fc.assert(fc.asyncProperty(fc.oneof(fc.integer({ min: 0, max: 6 }), fc.constant(Number.MAX_SAFE_INTEGER)),
    fc.constantFrom(0, 2999, 3000), fc.array(fc.record({ outcome: outcomeArbitrary, replace: fc.boolean(), zeroWait: fc.boolean() }),
      { minLength: 1, maxLength: 10 }), async (cap, prefetchDelay, nodes) => {
      const h = await setup({ ready: false });
      try {
        const early = h.decide(); assert.equal(h.reply(early)?.ok, true); assert.equal(h.client.attempts.length, 0);
        h.send({ type: 'create-world', seed: '2', config: '{}' });
        assert.equal(h.client.configSignals[0]!.aborted, false);
        h.clock.advance(prefetchDelay); h.client.prefetched.resolve(config(cap)); await settle();
        let spent = 0;
        for (const node of nodes) {
          if (node.replace) h.send({ type: 'create-world', seed: '3', config: '{}' });
          h.send({ type: 'set-decision-wait', seconds: node.zeroWait ? 0 : 10 });
          const id = h.decide(spent % 2 === 0 ? 'dream_interpretation' : 'magistrate_ruling');
          const expectedAttempt = prefetchDelay < 3000 && !node.zeroWait && spent < cap;
          if (expectedAttempt) {
            spent++; assert.equal(h.bridge.status().spent, spent, 'spend is visible before POST settles');
            assert.equal(h.client.attempts.length, spent);
            if (node.outcome === 'session_cap') h.send({ type: 'create-world', seed: '4', config: '{}' });
            else finish(h.client, h.clock, node.outcome, h.ports.at(-1)!.preview.rules_default);
          }
          await settle(); assert.ok(h.reply(id)); assert.equal(h.replies().filter(reply => reply.id === id).length, 1);
          assert.equal(h.bridge.status().spent, spent);
          assert.equal(h.bridge.status().sessionCap, prefetchDelay < 3000 ? cap : null);
        }
        assert.equal(h.client.attempts.length, spent); assert.ok(spent <= cap); assert.equal(h.client.configSignals.length, 1);
        assert.equal(h.client.configSignals[0]!.aborted, prefetchDelay === 3000);
        const report = h.report(); assert.equal(Object.values(report.families).reduce((sum, family) => sum + family.postAttempts, 0), spent);
        assertRedacted(report);
      } finally { h.bridge.dispose(); }
    }), { numRuns: 100, seed: 4208 });
});

async function actualRun(family: DecisionFamily, outcome: ControlledOutcome | 'zero_wait', useDefault: boolean, metricsEnabled: boolean) {
  const sim = actualSim(); const clock = new DecisionClock(); const client = new ControlledDecisionClient();
  const bridge = new DecisionBridge(client, wasm, mapping, clock, metricsEnabled ? new DecisionMetrics() : null);
  const messages: WorkerMessage[] = [];
  const controller = new SimController({ createSim: () => sim, clock, scheduler: new Frames(), post: message => messages.push(message),
    decision: { bridge, timing: clock, previewNode: (handle, payload) => (handle as WasmSim).preview_node(payload),
      exportReplay: handle => (handle as WasmSim).export_replay() } });
  try {
    client.prefetched.resolve(config(outcome === 'session_cap' ? 0 : 40)); await settle();
    if (outcome === 'zero_wait') bridge.setWaitSeconds(0);
    controller.ready(); controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
    const trigger = family === 'dream_interpretation' ? { Dream: { dreamer: '31', intent: 'urge' } } : { Bribe: { amount: '1' } };
    const preview = JSON.parse(sim.preview_node(JSON.stringify(trigger)));
    assert.equal(preview.ok, true);
    const choice = useDefault ? preview.rules_default : preview.option_ids.find((option: string) => option !== preview.rules_default);
    const beforeRead = sim.export_replay(); controller.handle({ type: 'decision-metrics', id: 2 });
    assert.equal(sim.export_replay(), beforeRead, 'report reads cannot change input or checksum bytes');
    controller.handle(family === 'dream_interpretation' ? { type: 'dream', id: 3, dreamer: 31, intent: 'urge' } : { type: 'bribe', id: 3, amount: '1' });
    controller.handle({ type: 'decision-metrics', id: 4 }); // report during the held operation
    if (outcome !== 'session_cap' && outcome !== 'zero_wait') finish(client, clock, outcome, choice);
    await settle();
    const accepted = messages.find((message): message is Reply => message.type === 'reply' && message.id === 3)!;
    assert.equal(accepted.ok, true); assert.equal(accepted.snapshot.decision?.outcome?.kind, outcome === 'model' ? 'model' : 'fallback');
    const queued = sim.export_replay(); controller.handle({ type: 'decision-metrics', id: 5 });
    assert.equal(sim.export_replay(), queued);
    controller.handle({ type: 'step', id: 6 }); assert.equal(sim.tick(), 1655n);
    controller.handle({ type: 'export-replay', id: 7 }); controller.handle({ type: 'decision-metrics', id: 8 });
    const exported = messages.find((message): message is Reply => message.type === 'reply' && message.id === 7)!;
    const metricsReply = messages.find((message): message is Reply => message.type === 'reply' && message.id === 8)!;
    assert.ok(exported.ok && exported.replay); assert.ok(metricsReply.ok);
    assert.equal(exported.replay, sim.export_replay()); assert.doesNotThrow(() => verify_replay(exported.replay!));
    return { replay: exported.replay, queued, checksums: sim.checksums(0n, sim.tick()), snapshot: sim.snapshot(), report: metricsReply.metrics,
      selectedOrdinal: preview.option_ids.indexOf(choice), defaultOrdinal: preview.option_ids.indexOf(preview.rules_default) };
  } finally { bridge.dispose(); sim.free(); }
}

test('Property 9: generated actual-WASM bridge runs have identical checksum and v5 bytes with metrics enabled or disabled', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...['dream_interpretation', 'magistrate_ruling'] as const),
    fc.constantFrom('model', 'timeout', 'malformed', 'wrong_option', 'quota', 'network', 'session_cap', 'zero_wait'), fc.boolean(),
    async (family, outcome, useDefault) => {
      const enabled = await actualRun(family, outcome, useDefault, true);
      const disabled = await actualRun(family, outcome, useDefault, false);
      assert.equal(enabled.replay, disabled.replay); assert.equal(enabled.queued, disabled.queued);
      assert.equal(enabled.checksums, disabled.checksums); assert.equal(enabled.snapshot, disabled.snapshot);
      assert.equal(disabled.report, null); assert.ok(enabled.report); assertRedacted(enabled.report);
      const f = enabled.report.families[family];
      assert.equal(f.eligibleNodes, 1); assert.equal(f.checkedModelChoices, outcome === 'model' ? 1 : 0);
      assert.equal(f.checkedRulesFallbacks, outcome === 'model' ? 0 : 1);
      assert.equal(f.agreement.checkedAgree, outcome === 'model' && useDefault ? 1 : 0);
      assert.equal(f.agreement.checkedDiverge, outcome === 'model' && !useDefault ? 1 : 0);
      assert.equal(f.options.checkedModel.reduce((sum, count) => sum + count, 0), outcome === 'model' ? 1 : 0);
      if (outcome === 'model') assert.equal(f.options.checkedModel[enabled.selectedOrdinal], 1);
      else if (outcome !== 'session_cap' && outcome !== 'zero_wait') assert.equal(f.options.checkedRulesDefault[enabled.defaultOrdinal], 1);
    }), { numRuns: 100, seed: 4209 });
});

test('real WASM supported skips prove eligibility without a production preview and match direct trigger exports', async () => {
  for (const family of ['dream_interpretation', 'magistrate_ruling'] as const) {
    for (const mode of ['unready', 'disabled', 'zero_wait', 'session_cap'] as const) {
      const live = actualSim(); const direct = actualSim(); const clock = new DecisionClock();
      const client = new ControlledDecisionClient(); const frames = new Frames();
      const bridge = new DecisionBridge(client, wasm, mapping, clock); const messages: WorkerMessage[] = [];
      let productionPreviews = 0;
      const controller = new SimController({ createSim: () => live, clock, scheduler: frames, post: message => messages.push(message),
        decision: { bridge, timing: clock, previewNode: (handle, payload) => {
          productionPreviews++; return (handle as WasmSim).preview_node(payload);
        }, exportReplay: handle => (handle as WasmSim).export_replay() } });
      try {
        if (mode !== 'unready') {
          client.prefetched.resolve(config(mode === 'session_cap' ? 0 : 40, mode !== 'disabled')); await settle();
        }
        if (mode === 'zero_wait') bridge.setWaitSeconds(0);
        const trigger = family === 'dream_interpretation' ? { Dream: { dreamer: '31', intent: 'urge' } } : { Bribe: { amount: '1' } };
        const beforePreview = direct.export_replay();
        const spec = JSON.parse(direct.preview_node(JSON.stringify(trigger)));
        assert.equal(spec.ok, true); assert.equal(spec.family, family);
        assert.ok(spec.option_ids.includes(spec.rules_default)); assert.equal(direct.export_replay(), beforePreview);
        controller.ready(); controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
        controller.handle({ type: 'run', id: 2 }); const frame = frames.pendingHandle;
        clock.milliseconds = 500;
        controller.handle(family === 'dream_interpretation' ? { type: 'dream', id: 3, dreamer: 31, intent: 'urge' } : { type: 'bribe', id: 3, amount: '1' });
        await settle();
        assert.equal(productionPreviews, 0); assert.equal(frames.pendingHandle, frame); assert.equal(frames.callbacks.length, 1);
        assert.equal(live.tick(), 1654n); assert.equal(client.attempts.length, 0); assert.equal(bridge.status().spent, 0);
        const resolved = messages.find((message): message is Reply => message.type === 'reply' && message.id === 3)!;
        const reason = mode === 'unready' ? 'config_pending' : mode;
        assert.equal(resolved.ok, true); assert.equal(resolved.snapshot.runState, 'running');
        assert.equal(resolved.snapshot.decision?.pending, null);
        assert.ok(resolved.snapshot.decision?.outcome?.kind === 'fallback');
        assert.equal(resolved.snapshot.decision.outcome.reason, reason);
        const receipt = checkedReceipt(direct, [trigger]);
        assert.ok(resolved.ok);
        assert.deepEqual(resolved.submission, receipt);
        assert.equal(live.export_replay(), direct.export_replay(), 'checked skip queues only the real trigger');
        controller.handle({ type: 'decision-metrics', id: 4 });
        const metricsReply = messages.find((message): message is Reply => message.type === 'reply' && message.id === 4)!;
        assert.ok(metricsReply.ok && metricsReply.metrics); const f = metricsReply.metrics.families[family];
        assert.equal(f.eligibleNodes, 1); assert.equal(f.postAttempts, 0); assert.equal(f.checkedModelChoices, 0);
        assert.equal(f.checkedRulesFallbacks, 1); assert.equal(f.checkedFallbacksByReason[reason], 1); assert.equal(f.skipsByReason[reason], 1);
        assert.equal(f.agreement.unknownCheckedRulesDefault, 1); // no production preview means no invented option comparison
        assert.equal(Object.values(f.attemptOutcomes).reduce((sum, count) => sum + count, 0), 0);
        assert.equal(live.export_replay(), direct.export_replay(), 'read-only report preserves queued replay bytes');
        controller.handle({ type: 'pause', id: 5 }); controller.handle({ type: 'step', id: 6 });
        direct.run_until_stop(1); assert.equal(live.tick(), 1655n);
        assert.equal(live.checksums(0n, live.tick()), direct.checksums(0n, direct.tick()));
        assert.equal(live.snapshot(), direct.snapshot()); assert.equal(live.export_replay(), direct.export_replay());
        controller.handle({ type: 'export-replay', id: 7 });
        const exported = messages.find((message): message is Reply => message.type === 'reply' && message.id === 7)!;
        assert.ok(exported.ok && exported.replay); assert.equal(exported.replay, direct.export_replay());
        assert.doesNotThrow(() => verify_replay(exported.replay!)); assert.equal(productionPreviews, 0);
      } finally { bridge.dispose(); live.free(); direct.free(); }
    }
  }
});

test('real WASM rejected supported triggers in every skip mode count no eligibility and leave pacing and replay untouched', async () => {
  for (const family of ['dream_interpretation', 'magistrate_ruling'] as const) {
    for (const mode of ['unready', 'disabled', 'zero_wait', 'session_cap'] as const) {
      const live = actualSim(); const clock = new DecisionClock(); const client = new ControlledDecisionClient();
      const bridge = new DecisionBridge(client, wasm, mapping, clock); const frames = new Frames();
      const messages: WorkerMessage[] = []; let productionPreviews = 0;
      const controller = new SimController({ createSim: () => live, clock, scheduler: frames, post: message => messages.push(message),
        decision: { bridge, timing: clock, previewNode: (handle, payload) => {
          productionPreviews++; return (handle as WasmSim).preview_node(payload);
        }, exportReplay: handle => (handle as WasmSim).export_replay() } });
      try {
        if (mode !== 'unready') {
          client.prefetched.resolve(config(mode === 'session_cap' ? 0 : 40, mode !== 'disabled')); await settle();
        }
        if (mode === 'zero_wait') bridge.setWaitSeconds(0);
        const trigger = family === 'dream_interpretation' ? { Dream: { dreamer: '999999', intent: 'urge' } } : { Bribe: { amount: '0' } };
        const before = live.export_replay(); const rejectedSpec = JSON.parse(live.preview_node(JSON.stringify(trigger)));
        assert.equal(rejectedSpec.ok, false); assert.equal(rejectedSpec.error.kind, 'rejected'); assert.equal(live.export_replay(), before);
        controller.ready(); controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
        controller.handle({ type: 'run', id: 2 }); const frame = frames.pendingHandle; clock.milliseconds = 500;
        controller.handle(family === 'dream_interpretation' ? { type: 'dream', id: 3, dreamer: 999999, intent: 'urge' } : { type: 'bribe', id: 3, amount: '0' });
        await settle(); const reply = messages.find((message): message is Reply => message.type === 'reply' && message.id === 3)!;
        assert.equal(reply.ok, false); if (!reply.ok) { assert.equal(reply.kind, 'rejected'); assert.equal(reply.error, rejectedSpec.error.reason); }
        assert.equal(productionPreviews, 0); assert.equal(frames.pendingHandle, frame); assert.equal(frames.callbacks.length, 1);
        assert.equal(reply.snapshot.runState, 'running'); assert.equal(live.export_replay(), before);
        assert.equal(client.attempts.length, 0); assert.equal(bridge.status().spent, 0);
        controller.handle({ type: 'decision-metrics', id: 4 });
        const metricsReply = messages.find((message): message is Reply => message.type === 'reply' && message.id === 4)!;
        assert.ok(metricsReply.ok && metricsReply.metrics); const f = metricsReply.metrics.families[family];
        assert.equal(f.eligibleNodes, 0); assert.equal(f.postAttempts, 0); assert.equal(f.rejectedTriggers, 1);
        assert.equal(f.checkedModelChoices, 0); assert.equal(f.checkedRulesFallbacks, 0);
        assert.equal(Object.values(f.skipsByReason).reduce((sum, count) => sum + count, 0), 0);
        assert.equal(Object.values(f.checkedFallbacksByReason).reduce((sum, count) => sum + count, 0), 0);
        assert.equal(live.export_replay(), before); assert.equal(productionPreviews, 0);
      } finally { bridge.dispose(); live.free(); }
    }
  }
});

async function actualTransportRun(family: DecisionFamily, bytes: number, metricsEnabled: boolean) {
  const sim = actualSim(); const clock = new DecisionClock();
  const trigger = family === 'dream_interpretation' ? { Dream: { dreamer: '31', intent: 'urge' } } : { Bribe: { amount: '1' } };
  const preview = JSON.parse(sim.preview_node(JSON.stringify(trigger))) as DecisionPreview;
  assert.equal(preview.ok, true); assert.equal(preview.family, family);
  const selectedWasm = await transportPaddedWasm(preview, bytes);
  const client = new HandlerDecisionClient(clock, preview.rules_default, {
    inferenceEnabled: true, requestByteCap: PROJECT_REQUEST_BYTE_CAP, sessionCap: 1,
  });
  const bridge = new DecisionBridge(client, selectedWasm, mapping, clock, metricsEnabled ? new DecisionMetrics() : null);
  const messages: WorkerMessage[] = [];
  const controller = new SimController({ createSim: () => sim, clock, scheduler: new Frames(), post: message => messages.push(message),
    decision: { bridge, timing: clock, previewNode: (handle, payload) => (handle as WasmSim).preview_node(payload),
      exportReplay: handle => (handle as WasmSim).export_replay() } });
  try {
    await client.prefetched.promise; await settle();
    controller.ready(); controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
    const created = messages.find((message): message is Reply => message.type === 'reply' && message.id === 1)!;
    controller.handle(family === 'dream_interpretation' ? { type: 'dream', id: 2, dreamer: 31, intent: 'urge' } : { type: 'bribe', id: 2, amount: '1' });
    const held = sim.export_replay(); controller.handle({ type: 'decision-metrics', id: 3 });
    assert.equal(sim.export_replay(), held, 'metrics during real transport cannot mutate the held world');
    assert.equal(bridge.status().spent, 1);
    await client.attempts[0]!.completed; await settle();
    const terminal = messages.find((message): message is Reply => message.type === 'reply' && message.id === 2)!;
    assert.equal(terminal.ok, true);
    const exact = bytes === PROJECT_REQUEST_BYTE_CAP;
    assert.equal(terminal.snapshot.decision?.outcome?.kind, exact ? 'model' : 'fallback');
    if (!exact) assert.deepEqual(terminal.snapshot.decision?.outcome, {
      requestId: terminal.id, worldId: created.snapshot.worldId, kind: 'fallback', reason: 'payload_too_large',
    });
    assert.equal(client.posts.length, 1); assert.equal(client.posts[0]!.status, exact ? 200 : 413);
    assert.equal(new TextEncoder().encode(client.posts[0]!.body).byteLength, bytes);
    assert.equal(client.aiCalls.length, exact ? 1 : 0);
    const queued = sim.export_replay(); controller.handle({ type: 'decision-metrics', id: 4 });
    assert.equal(sim.export_replay(), queued, 'metrics after checked submission preserve exact queued v5 bytes');
    controller.handle({ type: 'step', id: 5 }); assert.equal(sim.tick(), 1655n);
    controller.handle({ type: 'export-replay', id: 6 }); controller.handle({ type: 'decision-metrics', id: 7 });
    const exported = messages.find((message): message is Reply => message.type === 'reply' && message.id === 6)!;
    const reported = messages.find((message): message is Reply => message.type === 'reply' && message.id === 7)!;
    assert.ok(exported.ok && exported.replay); assert.ok(reported.ok);
    assert.equal(exported.replay, sim.export_replay()); assert.equal(JSON.parse(exported.replay).version, 5);
    verify_replay(exported.replay);
    return { queued, replay: exported.replay, snapshot: sim.snapshot(), checksums: sim.checksums(0n, sim.tick()),
      report: reported.metrics, defaultOrdinal: preview.option_ids.indexOf(preview.rules_default) };
  } finally { bridge.dispose(); sim.free(); }
}

test('production 16384 success and 16385 payload_too_large telemetry keep separate denominators and actual-WASM v5 neutrality', async () => {
  for (const family of ['dream_interpretation', 'magistrate_ruling'] as const) {
    for (const bytes of [PROJECT_REQUEST_BYTE_CAP, PROJECT_REQUEST_BYTE_CAP + 1]) {
      const enabled = await actualTransportRun(family, bytes, true);
      const disabled = await actualTransportRun(family, bytes, false);
      assert.equal(enabled.queued, disabled.queued); assert.equal(enabled.replay, disabled.replay);
      assert.equal(enabled.snapshot, disabled.snapshot); assert.equal(enabled.checksums, disabled.checksums);
      assert.equal(disabled.report, null); assert.ok(enabled.report); assertRedacted(enabled.report);
      const f = enabled.report.families[family]; const exact = bytes === PROJECT_REQUEST_BYTE_CAP;
      assert.equal(f.eligibleNodes, 1); assert.equal(f.postAttempts, 1);
      assert.equal(f.validatedModelChoices, exact ? 1 : 0); assert.equal(f.checkedModelChoices, exact ? 1 : 0);
      assert.equal(f.checkedRulesFallbacks, exact ? 0 : 1); assert.equal(f.attemptOutcomes.model, exact ? 1 : 0);
      assert.equal(f.attemptOutcomes.payload_too_large, exact ? 0 : 1);
      assert.equal(f.checkedFallbacksByReason.payload_too_large, exact ? 0 : 1);
      assert.equal(f.skipsByReason.payload_too_large, 0, 'server 413 is an attempted outcome, never an eligibility skip');
      assert.equal(Object.values(f.skipsByReason).reduce((sum, count) => sum + count, 0), 0);
      assert.equal(Object.values(f.attemptOutcomes).reduce((sum, count) => sum + count, 0), 1);
      assert.equal(Object.values(f.checkedFallbacksByReason).reduce((sum, count) => sum + count, 0), exact ? 0 : 1);
      assert.equal(f.latencyBuckets.lt_250_ms, 1); assert.equal(f.latencyBuckets.unknown, 0);
      assert.deepEqual(f.usage, exact ? { knownResponses: 1, unknownResponses: 0, inputTokens: 23, outputTokens: 2 }
        : { knownResponses: 0, unknownResponses: 0, inputTokens: null, outputTokens: null });
      assert.equal(f.options.checkedModel[enabled.defaultOrdinal], exact ? 1 : 0);
      assert.equal(f.options.checkedRulesDefault[enabled.defaultOrdinal], exact ? 0 : 1);
      assert.equal(f.agreement.checkedAgree, exact ? 1 : 0); assert.equal(f.agreement.checkedDiverge, 0);
      assert.equal(f.agreement.unknownCheckedRulesDefault, 0, 'the checked fallback retains the actual Rust preview default');
      const other = enabled.report.families[family === 'dream_interpretation' ? 'magistrate_ruling' : 'dream_interpretation'];
      assert.equal(other.eligibleNodes, 0); assert.equal(other.postAttempts, 0);
    }
  }
});
