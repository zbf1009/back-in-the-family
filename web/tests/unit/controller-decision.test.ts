import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { WasmSim, verify_replay } from '../../../target/wasm-pkg/sim_wasm.js';
import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import { DecisionBridge, type DecisionWasm } from '../../src/worker/decision-bridge.ts';
import type { Reply, Request, WorkerMessage } from '../../src/shared/protocol.ts';
import { PLAY_RATE, SPEEDS } from '../../src/shared/speeds.ts';
import { ControlledDecisionClient, DecisionClock, config, mapping, modelDecision, realPreviews, settle, wasm } from './helpers/decision.ts';
import { FakeFrameScheduler } from './helpers/fakes.ts';
import { loadWasm } from './helpers/wasm.ts';

class Frames extends FakeFrameScheduler {
  readonly callbacks: (() => void)[] = [];
  override request(callback: () => void): number { this.callbacks.push(callback); return super.request(callback); }
}
class Port implements SimHandle {
  tickValue = 0n;
  readonly batches: unknown[][] = [];
  readonly raw: string[] = [];
  previews = 0;
  reject: string | null = null;
  previewResult: unknown = realPreviews()[0]!;
  snapshot(): string { return JSON.stringify({ tick: this.tickValue.toString() }); }
  tick(): bigint { return this.tickValue; }
  player_node_state(): string { return '{"pending":false}'; }
  checksums(): string { return '[]'; }
  submit(input: string): void { this.raw.push(input); }
  submit_checked(input: string): string {
    if (this.reject !== null) return JSON.stringify({ ok: false, index: 0, reason: this.reject });
    this.batches.push(JSON.parse(input)); return '{"ok":true}';
  }
  preview_node(): string { this.previews++; return JSON.stringify(this.previewResult); }
  step(): string { this.tickValue++; return '0000000000000001'; }
  run_ticks(n: number): string { this.tickValue += BigInt(n); return '0000000000000001'; }
  run_until_stop(n: number): string { this.tickValue += BigInt(n); return JSON.stringify({ ran: n, checksum: '0000000000000001', stops: [] }); }
  export_replay(): string { return JSON.stringify({ ticks: this.tickValue.toString(), inputs: this.batches }); }
}
async function setup(options: { ready?: boolean; enabled?: boolean; cap?: number; port?: Port; wasm?: DecisionWasm } = {}) {
  const port = options.port ?? new Port();
  const clock = new DecisionClock();
  const frames = new Frames();
  const client = new ControlledDecisionClient();
  const bridge = new DecisionBridge(client, options.wasm ?? wasm, mapping, clock);
  const messages: WorkerMessage[] = [];
  const controller = new SimController({ createSim: (_seed, value) => {
    if (value === 'bad') throw Error('bad config');
    return value === 'new' ? new Port() : port;
  }, scheduler: frames, clock, post: message => messages.push(message),
  decision: { bridge, timing: clock, previewNode: handle => (handle as Port).preview_node(),
    exportReplay: handle => (handle as Port).export_replay() } });
  controller.ready();
  controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
  if (options.ready !== false) { client.prefetched.resolve(config(options.cap, options.enabled)); await settle(); }
  const send = (request: Request) => controller.handle(request);
  const replies = () => messages.filter((message): message is Reply => message.type === 'reply');
  const reply = (id: number) => replies().find(message => message.id === id)!;
  const dream = (id = 2) => send({ type: 'dream', id, dreamer: 31, intent: 'urge' });
  return { port, clock, frames, client, bridge, messages, controller, send, replies, reply, dream };
}

test('decision holds every competing mutation unchanged while reads overtake and wait applies only later', async () => {
  const h = await setup();
  h.send({ type: 'run', id: 2 }); h.dream(3);
  const pending = h.messages.at(-1)!;
  assert.equal(pending.type, 'status');
  if (pending.type !== 'status') throw Error('missing pending status');
  const before = pending.snapshot;
  const requests: Request[] = [
    { type: 'run', id: 4 }, { type: 'pause', id: 5 }, { type: 'step', id: 6 },
    { type: 'set-speed', id: 7, speed: 8 }, { type: 'choose', id: 8, node: '1', option: 'send_flowers' },
    { type: 'choose-and-run', id: 9, node: '1', option: 'send_flowers' },
    { type: 'dream', id: 10, dreamer: 31, intent: 'warn' }, { type: 'bribe', id: 11, amount: '1' },
    { type: 'claim', id: 12, slot: 'imported_vessel', carryOver: null },
    { type: 'carry-over', id: 13, trait: 'warmth' }, { type: 'submit', id: 14, input: '{}' },
  ];
  for (const request of requests) {
    h.send(request); const reply = h.reply(request.id);
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.equal(reply.kind, 'decision_pending');
    assert.deepEqual(reply.snapshot, before);
  }
  h.send({ type: 'world-snapshot', id: 15 }); h.send({ type: 'checksums', id: 16, from: '0', to: '0' });
  h.send({ type: 'player_node_state', id: 17 }); h.send({ type: 'decision-status', id: 18 });
  h.send({ type: 'export-replay', id: 19 }); h.send({ type: 'set-decision-wait', id: 20, seconds: 0 });
  assert.equal(h.reply(3), undefined);
  assert.equal(h.reply(19).ok, true);
  h.clock.advance(100); assert.equal(h.port.tickValue, 0n);
  const status = h.messages.at(-1)!;
  assert.equal(status.type, 'status');
  if (status.type === 'status') {
    assert.equal(status.snapshot.tick, '0'); assert.equal(status.snapshot.tps, null);
    assert.equal(status.snapshot.checksum, before.checksum); assert.equal(status.snapshot.stop, undefined);
  }
  assert.equal(h.frames.isPending, false); assert.deepEqual(h.port.batches, []); assert.deepEqual(h.port.raw, []);
  h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  assert.equal(h.reply(3).ok, true); assert.equal(h.frames.isPending, true);
  assert.equal(h.port.tickValue, 0n); assert.equal(h.bridge.status().spent, 1); h.controller.fail('test teardown');
});

test('same-world queued frames cannot steal fresh restart or catch up time spent waiting', async () => {
  const h = await setup(); const speed = SPEEDS[1]; const rate = speed * PLAY_RATE;
  h.send({ type: 'set-speed', id: 2, speed }); assert.equal(h.reply(2).ok, true);
  h.send({ type: 'run', id: 3 });
  const stale = h.frames.callbacks[0]!; h.dream(4); stale();
  assert.equal(h.port.tickValue, 0n); assert.equal(h.frames.isPending, false);
  h.clock.advance(5000); h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  const fresh = h.frames.pendingHandle; stale();
  assert.equal(h.frames.pendingHandle, fresh); assert.equal(h.port.tickValue, 0n);
  h.frames.flush(); assert.equal(h.port.tickValue, 0n);
  // At 50 ms this budget fits the existing capped Frame batch.
  h.clock.advance(50); h.frames.flush(); assert.equal(h.port.tickValue, BigInt(Math.floor(rate * 50 / 1000)));
  h.controller.fail('test teardown');
});

test('paused completion never steps or schedules a frame and rejected fallback preserves Rust reason', async () => {
  const h = await setup(); h.port.reject = 'not_waiting'; h.dream();
  h.client.attempts[0]!.response.reject(Error('network')); await settle();
  const reply = h.reply(2); assert.equal(reply.ok, false);
  if (!reply.ok) { assert.equal(reply.kind, 'rejected'); assert.equal(reply.error, 'not_waiting'); }
  assert.equal(reply.snapshot.runState, 'paused'); assert.equal(h.frames.isPending, false);
  assert.equal(h.port.tickValue, 0n); assert.deepEqual(h.port.batches, []); h.bridge.dispose();
});

test('rejected and no-node previews produce original typed failure with no inference or submission', async () => {
  for (const error of [{ kind: 'rejected', reason: 'not_waiting' }, { kind: 'no_node' }, { kind: 'malformed' }]) {
    const h = await setup(); h.port.previewResult = { ok: false, error }; h.dream();
    assert.equal(h.reply(2).ok, false);
    const reply = h.reply(2); assert.deepEqual(!reply.ok && reply.previewError, error);
    assert.equal(h.client.attempts.length, 0); assert.deepEqual(h.port.batches, []);
    assert.equal(h.frames.isPending, false); h.bridge.dispose();
  }
});

test('unready config zero wait and exhausted budget leave the running frame and pacing untouched', async () => {
  for (const mode of ['pending', 'zero', 'cap'] as const) {
    const h = await setup({ ready: mode !== 'pending', cap: mode === 'cap' ? 0 : 40 });
    const speed = SPEEDS[0]; const rate = speed * PLAY_RATE;
    h.send({ type: 'set-speed', id: 10, speed }); assert.equal(h.reply(10).ok, true);
    if (mode === 'zero') h.send({ type: 'set-decision-wait', id: 2, seconds: 0 });
    h.send({ type: 'run', id: 3 }); const frame = h.frames.pendingHandle;
    h.clock.advance(100); h.dream(4);
    assert.equal(h.reply(4).ok, true); assert.equal(h.frames.pendingHandle, frame);
    assert.equal(h.port.previews, 0); assert.equal(h.client.attempts.length, 0);
    // A 100 ms gap owes more than one normal Frame batch. Neither the original
    // Frame nor its remaining debt may be lost by a no-POST operation.
    h.frames.flush(); h.frames.flush(); assert.equal(h.port.tickValue, BigInt(rate * 100 / 1000));
    h.controller.fail('test teardown');
  }
});

test('matching manual fallback closes both requests once and stale controls cannot close a newer decision', async () => {
  const h = await setup(); h.dream();
  h.send({ type: 'use-rules-now', id: 3, requestId: 2, worldId: 99 });
  assert.equal(h.reply(3).ok, false); assert.equal(h.reply(2), undefined);
  h.send({ type: 'use-rules-now', id: 4, requestId: 2, worldId: 1 });
  assert.equal(h.reply(2).ok, true); assert.equal(h.reply(4).ok, true);
  assert.equal(h.client.attempts[0]!.signal.aborted, true);
  assert.deepEqual(h.port.batches, [[{ Dream: { dreamer: '31', intent: 'urge' } }]]);
  h.dream(5); h.send({ type: 'use-rules-now', id: 6, requestId: 2, worldId: 1 });
  assert.equal(h.reply(6).ok, false); assert.equal(h.reply(5), undefined);
  h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  assert.equal(h.reply(5), undefined); assert.equal(h.port.batches.length, 1);
  h.send({ type: 'use-rules-now', id: 7, requestId: 5, worldId: 1 }); await settle();
  assert.deepEqual(h.replies().map(reply => reply.id), [1, 3, 2, 4, 6, 5, 7]); h.bridge.dispose();
});

test('failed replacement preserves pending world while success cancels before installation and ignores late result', async () => {
  const h = await setup(); h.dream();
  h.send({ type: 'create-world', id: 3, seed: '1', config: 'bad' });
  assert.equal(h.reply(3).snapshot.worldId, 1); assert.equal(h.reply(2), undefined);
  assert.equal(h.client.attempts[0]!.signal.aborted, false);
  h.send({ type: 'create-world', id: 4, seed: '1', config: 'new' });
  const cancelled = h.reply(2); assert.equal(cancelled.ok, false);
  if (!cancelled.ok) assert.equal(cancelled.kind, 'cancelled');
  assert.equal(cancelled.snapshot.worldId, 1); assert.equal(h.reply(4).snapshot.worldId, 2);
  assert.equal(h.reply(4).snapshot.runState, 'paused'); assert.equal(h.client.attempts[0]!.signal.aborted, true);
  const count = h.messages.length;
  h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  assert.equal(h.messages.length, count); assert.deepEqual(h.port.batches, []);
  assert.equal(h.bridge.status().spent, 1); assert.equal(h.client.configSignals.length, 1); h.bridge.dispose();
});

test('world replacement does not restart or abort pending configuration prefetch', async () => {
  const h = await setup({ ready: false });
  h.send({ type: 'create-world', id: 2, seed: '2', config: 'new' });
  assert.equal(h.client.configSignals[0]!.aborted, false); assert.equal(h.client.configSignals.length, 1);
  h.client.prefetched.resolve(config(1)); await settle(); h.dream(3);
  assert.equal(h.client.attempts.length, 1); h.send({ type: 'use-rules-now', id: 4, requestId: 3, worldId: 2 });
  await settle(); h.bridge.dispose();
});

test('worker fatal during pending inference aborts without fallback and late validation or status', async () => {
  let validates = 0;
  const h = await setup({ wasm: { ...wasm, llm_validate: input => { validates++; return wasm.llm_validate(input); } } });
  h.dream(); h.controller.fail('panic'); const count = h.messages.length;
  assert.equal(h.client.attempts[0]!.signal.aborted, true);
  h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  assert.equal(h.messages.length, count); assert.equal(validates, 0); assert.deepEqual(h.port.batches, []);
  assert.equal(h.messages.filter(message => message.type === 'fatal').length, 1);
});

test('WASM renderer and validator panics follow fatal path instead of submitting rules fallback', async () => {
  for (const method of ['llm_render_system_one', 'llm_validate'] as const) {
    const h = await setup({ wasm: { ...wasm, [method]: () => { throw new WebAssembly.RuntimeError('panic'); } } });
    h.dream();
    if (h.client.attempts.length > 0) h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
    await settle(); assert.deepEqual(h.port.batches, []);
    assert.equal(h.messages.filter(message => message.type === 'fatal').length, 1);
  }
});

test('Property: model timeout manual and replacement terminal permutations commit at most once without late validation', async () => {
  await fc.assert(fc.asyncProperty(fc.shuffledSubarray(['model', 'timeout', 'manual', 'replace'] as const,
    { minLength: 4, maxLength: 4 }), async actions => {
    let validations = 0;
    const h = await setup({ wasm: { ...wasm, llm_validate: input => {
      validations++; return wasm.llm_validate(input);
    } } });
    h.dream();
    for (const action of actions) {
      if (action === 'model') h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
      else if (action === 'timeout') h.clock.advance(10000);
      else if (action === 'manual') h.send({ type: 'use-rules-now', id: 3, requestId: 2, worldId: 1 });
      else h.send({ type: 'create-world', id: 4, seed: '1', config: 'new' });
      await settle();
    }
    for (const id of [1, 2, 3, 4]) assert.equal(h.replies().filter(reply => reply.id === id).length, 1);
    assert.equal(h.port.batches.length, actions[0] === 'replace' ? 0 : 1);
    assert.equal(validations, actions[0] === 'model' ? 1 : 0);
    assert.equal(h.client.attempts.length, 1);
    assert.equal(h.client.attempts[0]!.signal.aborted, actions[0] !== 'model');
    h.bridge.dispose();
  }), { numRuns: 48 });
});

function actualSim(): WasmSim {
  loadWasm();
  const replay = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seedU-underworld.replay.json', import.meta.url), 'utf8')) as {
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

test('actual WASM completed model/fallback streams match direct per-tick checksums and verify offline for both families', async () => {
  for (const family of ['dream', 'bribe'] as const) for (const accepted of [true, false]) {
    const live = actualSim(); const direct = actualSim(); const opposite = actualSim();
    const client = new ControlledDecisionClient(); const clock = new DecisionClock();
    const bridge = new DecisionBridge(client, wasm, mapping, clock);
    client.prefetched.resolve(config()); await settle();
    const messages: WorkerMessage[] = [];
    const controller = new SimController({ createSim: () => live, clock, scheduler: new Frames(), post: message => messages.push(message),
      decision: { bridge, timing: clock, previewNode: (sim, payload) => (sim as WasmSim).preview_node(payload),
        exportReplay: sim => (sim as WasmSim).export_replay() } });
    try {
      controller.ready(); controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
      const trigger = family === 'dream' ? { Dream: { dreamer: '31', intent: 'urge' } } : { Bribe: { amount: '1' } };
      const preview = JSON.parse(direct.preview_node(JSON.stringify(trigger)));
      assert.equal(preview.ok, true);
      assert.equal(preview.family, family === 'dream' ? 'dream_interpretation' : 'magistrate_ruling');
      controller.handle(family === 'dream' ? { type: 'dream', id: 2, dreamer: 31, intent: 'urge' } : { type: 'bribe', id: 2, amount: '1' });
      const choice = preview.rules_default;
      if (accepted) client.attempts[0]!.response.resolve(modelDecision(choice));
      else client.attempts[0]!.response.resolve(modelDecision('not_in_preview'));
      await settle();
      const decisionReply = messages.find((message): message is Reply => message.type === 'reply' && message.id === 2)!;
      assert.equal(decisionReply.ok, true);
      assert.equal(decisionReply.snapshot.decision?.outcome?.kind, accepted ? 'model' : 'fallback');
      const payloads = accepted ? [trigger, { Choose: { node: { Trigger: { seq: preview.trigger } }, option: choice,
        fingerprint: modelDecision(choice).fingerprint } }] : [trigger];
      assert.deepEqual(JSON.parse(direct.submit_checked(JSON.stringify(payloads))), { ok: true });
      assert.equal(live.tick(), direct.tick());
      const alternate = accepted ? [trigger] : [trigger, { Choose: {
        node: { Trigger: { seq: preview.trigger } }, option: choice, fingerprint: modelDecision(choice).fingerprint,
      } }];
      assert.deepEqual(JSON.parse(opposite.submit_checked(JSON.stringify(alternate))), { ok: true });
      controller.handle({ type: 'step', id: 3 });
      assert.equal(live.tick(), 1655n, 'the controller, not a direct test call, completed the firing tick');
      const checksum = direct.run_until_stop(1);
      const reply = messages.find((message): message is Reply => message.type === 'reply' && message.id === 3)!;
      assert.equal(reply.snapshot.tick, direct.tick().toString());
      assert.equal(reply.snapshot.checksum, JSON.parse(checksum).checksum);
      const liveSnapshot = JSON.parse(live.snapshot()); const directSnapshot = JSON.parse(direct.snapshot());
      assert.deepEqual(liveSnapshot, directSnapshot);
      if (family === 'dream') {
        const stopped = messages.find(message => message.type === 'status' && message.snapshot.stop !== undefined);
        assert.ok(stopped?.type === 'status' && stopped.snapshot.stop!.reasons.includes('dream_resolved'));
        assert.equal(liveSnapshot.last_dream.tick, '1654');
      }
      // NodeRecord.source is not exported by snapshot. Existing C1 Rust/WASM
      // enum assertions establish the source meaning; same-option checksums here
      // independently catch accidentally using the other source in the controller.
      assert.notEqual(JSON.parse(opposite.run_until_stop(1)).checksum, reply.snapshot.checksum);
      const liveReplay = JSON.parse(live.export_replay());
      const directReplay = JSON.parse(direct.export_replay());
      assert.deepEqual(liveReplay.checksums, directReplay.checksums);
      assert.deepEqual(liveReplay.inputs, directReplay.inputs);
      const decisionInputs = liveReplay.inputs.filter((input: { seq: string }) => BigInt(input.seq) >= BigInt(preview.trigger));
      assert.deepEqual(decisionInputs.map((input: { payload: unknown }) => input.payload), payloads);
      assert.equal(decisionInputs[0].seq, preview.trigger);
      assert.equal(decisionInputs[0].tick, '1654');
      if (accepted) {
        assert.equal(decisionInputs[1].seq, (BigInt(preview.trigger) + 1n).toString());
        assert.equal(decisionInputs[1].tick, decisionInputs[0].tick);
      }
      assert.ok(BigInt(liveReplay.ticks) > BigInt(decisionInputs[0].tick));
      assert.equal(liveReplay.ticks, reply.snapshot.tick);
      controller.handle({ type: 'export-replay', id: 4 });
      const exported = messages.find((message): message is Reply => message.type === 'reply' && message.id === 4)!;
      assert.equal(exported.ok && exported.replay, live.export_replay());
      assert.ok(exported.ok);
      assert.doesNotThrow(() => verify_replay(exported.replay!));
      assert.doesNotThrow(() => verify_replay(direct.export_replay()));
    } finally { bridge.dispose(); live.free(); direct.free(); opposite.free(); }
  }
});

test('rejected preview and local typed renderer failure preserve accumulated running tick debt and TPS', async () => {
  for (const mode of ['preview', 'renderer'] as const) {
    const h = await setup({ wasm: mode === 'renderer' ? {
      ...wasm, llm_render_system_one: () => '{"ok":false,"error":{"kind":"render"}}',
    } : wasm });
    if (mode === 'preview') h.port.previewResult = { ok: false, error: { kind: 'no_node' } };
    const speed = SPEEDS[0]; const rate = speed * PLAY_RATE;
    h.send({ type: 'set-speed', id: 10, speed }); assert.equal(h.reply(10).ok, true);
    h.send({ type: 'run', id: 2 });
    // Fifty-ms Frames deliver the full playback rate rather than hitting the
    // per-Frame cap on every 100-ms interval and artificially measuring 20 TPS.
    for (let index = 0; index < 24; index++) { h.clock.advance(50); h.frames.flush(); }
    h.send({ type: 'decision-status', id: 4 }); assert.equal(h.reply(4).snapshot.tps, rate);
    const count = h.messages.filter(message => message.type === 'status').length;
    h.clock.advance(100); h.dream(3); await settle();
    assert.equal(h.client.attempts.length, 0); assert.equal(h.bridge.status().spent, 0);
    assert.equal(h.reply(3).snapshot.runState, 'running'); assert.equal(h.port.tickValue, BigInt(rate * 1200 / 1000));
    assert.equal(h.messages.filter(message => message.type === 'status').length, count);
    h.frames.flush(); h.frames.flush(); assert.equal(h.port.tickValue, BigInt(rate * 1300 / 1000));
    h.send({ type: 'decision-status', id: 5 }); assert.equal(h.reply(5).snapshot.tps, rate);
    h.controller.fail('test teardown');
  }
});

test('disabled ready configuration uses rules without changing pending frame or running anchor', async () => {
  const h = await setup({ enabled: false }); const speed = SPEEDS[0]; const rate = speed * PLAY_RATE;
  h.send({ type: 'set-speed', id: 10, speed }); assert.equal(h.reply(10).ok, true);
  h.send({ type: 'run', id: 2 });
  const frame = h.frames.pendingHandle; h.clock.advance(100); h.dream(3);
  assert.equal(h.frames.pendingHandle, frame); assert.equal(h.port.previews, 0);
  assert.equal(h.reply(3).snapshot.decision?.outcome?.kind, 'fallback');
  h.frames.flush(); h.frames.flush(); assert.equal(h.port.tickValue, BigInt(rate * 100 / 1000));
  h.controller.fail('test teardown');
});

test('predicted trigger and tick binding prevent completion from committing to a changed transaction', async () => {
  for (const changed of ['tick', 'trigger'] as const) {
    const h = await setup(); h.dream();
    if (changed === 'tick') h.port.tickValue = 1n;
    else h.port.previewResult = { ...realPreviews()[0]!, trigger: '999' };
    h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
    assert.deepEqual(h.port.batches, []); assert.equal(h.reply(2).ok, false);
    assert.equal(h.replies().filter(reply => reply.id === 2).length, 1); h.bridge.dispose();
  }
});

test('preview and checked commit panics terminate without a second fallback submission', async () => {
  for (const method of ['preview_node', 'submit_checked'] as const) {
    const h = await setup();
    h.port[method] = () => { throw new WebAssembly.RuntimeError('panic'); };
    h.dream();
    if (h.client.attempts.length > 0) h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!));
    await settle();
    assert.deepEqual(h.port.batches, []); assert.equal(h.messages.filter(message => message.type === 'fatal').length, 1);
  }
});

test('atomic pair rejection falls back only to the original checked trigger', async () => {
  const h = await setup(); const attempted: unknown[][] = [];
  h.port.submit_checked = input => {
    const payloads: unknown[] = JSON.parse(input); attempted.push(payloads);
    if (payloads.length === 2) return '{"ok":false,"index":1,"reason":"illegal_option"}';
    h.port.batches.push(payloads); return '{"ok":true}';
  };
  h.dream(); h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  assert.equal(attempted.length, 2);
  assert.deepEqual(h.port.batches, [[{ Dream: { dreamer: '31', intent: 'urge' } }]]);
  assert.equal(h.reply(2).snapshot.decision?.outcome?.kind, 'fallback'); h.bridge.dispose();
});

test('wait preference rejects nonfinite values and clamps valid future settings without mutating current deadline', async () => {
  const h = await setup(); h.dream();
  for (const [id, seconds] of [[3, NaN], [4, Infinity], [5, -Infinity]]) {
    h.send({ type: 'set-decision-wait', id: id!, seconds: seconds! }); assert.equal(h.reply(id!).ok, false);
  }
  h.send({ type: 'set-decision-wait', id: 6, seconds: -1 }); assert.equal(h.bridge.status().waitSeconds, 0);
  h.clock.advance(9999); await settle(); assert.equal(h.reply(2), undefined);
  h.clock.advance(1); await settle();
  assert.equal(h.reply(2).snapshot.decision?.outcome?.kind, 'fallback');
  h.send({ type: 'set-decision-wait', id: 7, seconds: 20 }); assert.equal(h.bridge.status().waitSeconds, 10);
  h.bridge.dispose();
});

test('same-world running manual completion schedules exactly one fresh frame without stepping', async () => {
  const h = await setup(); h.send({ type: 'run', id: 2 }); h.dream(3);
  h.clock.advance(5000); h.send({ type: 'use-rules-now', id: 4, requestId: 3, worldId: 1 }); await settle();
  assert.equal(h.port.tickValue, 0n); assert.equal(h.frames.isPending, true);
  assert.equal(h.frames.callbacks.length, 2); h.frames.flush(); assert.equal(h.port.tickValue, 0n);
  h.controller.fail('test teardown');
});

test('the input and frame lock is already active inside the WASM preview call', async () => {
  const h = await setup(); h.send({ type: 'run', id: 2 });
  const stale = h.frames.callbacks[0]!;
  const preview = h.port.preview_node.bind(h.port);
  h.port.preview_node = () => {
    stale();
    h.send({ type: 'set-speed', id: 4, speed: 8 });
    h.send({ type: 'submit', id: 5, input: '{}' });
    assert.equal(h.frames.isPending, false);
    assert.equal(h.port.tickValue, 0n);
    assert.deepEqual(h.port.raw, []);
    for (const id of [4, 5]) {
      const rejected = h.reply(id);
      assert.ok(!rejected.ok && rejected.kind === 'decision_pending');
      assert.equal(rejected.snapshot.runState, 'running');
      assert.equal(rejected.snapshot.speed, 1);
      assert.equal(rejected.snapshot.decision?.pending?.requestId, 3);
    }
    return preview();
  };
  h.clock.advance(100); h.dream(3);
  // Restore before the authoritative pre-commit preview; competing attempts above
  // must not consume an input sequence or steal the original operation.
  h.port.preview_node = preview;
  h.send({ type: 'use-rules-now', id: 6, requestId: 3, worldId: 1 }); await settle();
  assert.equal(h.reply(3).ok, true); assert.equal(h.port.batches.length, 1);
  h.frames.flush(); assert.equal(h.port.tickValue, 0n); h.controller.fail('test teardown');
});

test('old-world frame and status callbacks cannot affect a new running world or its newer decision', async () => {
  let validations = 0;
  const h = await setup({ wasm: { ...wasm, llm_validate: input => {
    validations++; return wasm.llm_validate(input);
  } } });
  h.send({ type: 'run', id: 2 }); const staleFrame = h.frames.callbacks[0]!; h.dream(3);
  const staleStatus = [...h.clock.timers.values()].find(timer => timer.at === 100)!.callback;
  h.send({ type: 'create-world', id: 4, seed: '2', config: 'new' });
  h.send({ type: 'run', id: 5 }); const fresh = h.frames.pendingHandle;
  const count = h.messages.length; staleFrame(); staleStatus();
  assert.equal(h.frames.pendingHandle, fresh); assert.equal(h.messages.length, count);
  h.dream(6); staleFrame(); staleStatus();
  h.send({ type: 'use-rules-now', id: 10, requestId: 6, worldId: 1 });
  assert.equal(h.reply(10).ok, false); assert.equal(h.client.attempts[1]!.signal.aborted, false);
  h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  assert.equal(validations, 0); assert.equal(h.reply(6), undefined);
  h.send({ type: 'world-snapshot', id: 7 }); assert.equal(h.reply(7).snapshot.tick, '0');
  assert.deepEqual(h.port.batches, []);
  h.send({ type: 'use-rules-now', id: 8, requestId: 6, worldId: 2 }); await settle();
  assert.equal(h.reply(6).snapshot.worldId, 2); assert.equal(h.reply(6).snapshot.runState, 'running');
  h.frames.flush(); h.send({ type: 'world-snapshot', id: 9 }); assert.equal(h.reply(9).snapshot.tick, '0');
  h.controller.fail('test teardown');
});

test('true waiting resets a mature TPS window and running debt but no simulation tick', async () => {
  const h = await setup(); const speed = SPEEDS[0]; const rate = speed * PLAY_RATE;
  h.send({ type: 'set-speed', id: 10, speed }); assert.equal(h.reply(10).ok, true);
  h.send({ type: 'run', id: 2 });
  for (let index = 0; index < 24; index++) { h.clock.advance(50); h.frames.flush(); }
  h.send({ type: 'decision-status', id: 3 }); assert.equal(h.reply(3).snapshot.tps, rate);
  const before = h.port.tickValue; h.dream(4);
  h.clock.advance(5000);
  const hold = h.messages.at(-1)!;
  assert.ok(hold.type === 'status'); assert.equal(hold.snapshot.tick, before.toString());
  assert.equal(hold.snapshot.tps, null); assert.equal(hold.snapshot.checksum, h.reply(3).snapshot.checksum);
  h.client.attempts[0]!.response.resolve(modelDecision(realPreviews()[0]!.option_ids[0]!)); await settle();
  assert.equal(h.reply(4).snapshot.tps, null); assert.equal(h.port.tickValue, before);
  h.frames.flush(); assert.equal(h.port.tickValue, before);
  // Resume at the same regular cadence: no old waiting time may become debt,
  // and the new TPS window must measure only these completed ticks.
  for (let index = 0; index < 20; index++) { h.clock.advance(50); h.frames.flush(); }
  assert.equal(h.port.tickValue, before + BigInt(rate));
  const restarted = h.messages.at(-1)!; assert.ok(restarted.type === 'status'); assert.equal(restarted.snapshot.tps, rate);
  h.controller.fail('test teardown');
});

test('real WASM rejected preview accepts no input and leaves the actual replay byte-identical', async () => {
  const live = actualSim(); const clock = new DecisionClock(); const client = new ControlledDecisionClient();
  const bridge = new DecisionBridge(client, wasm, mapping, clock);
  client.prefetched.resolve(config()); await settle();
  const messages: WorkerMessage[] = [];
  const controller = new SimController({ createSim: () => live, clock, scheduler: new Frames(), post: message => messages.push(message),
    decision: { bridge, timing: clock, previewNode: (sim, payload) => (sim as WasmSim).preview_node(payload),
      exportReplay: sim => (sim as WasmSim).export_replay() } });
  try {
    controller.ready(); controller.handle({ type: 'create-world', id: 1, seed: '1', config: '{}' });
    const before = live.export_replay();
    controller.handle({ type: 'bribe', id: 2, amount: '0' });
    const rejected = messages.find((message): message is Reply => message.type === 'reply' && message.id === 2)!;
    assert.ok(!rejected.ok && rejected.kind === 'rejected'); assert.equal(rejected.error, 'bad_amount');
    assert.deepEqual(rejected.previewError, { kind: 'rejected', reason: 'bad_amount' });
    assert.equal(client.attempts.length, 0); assert.equal(live.export_replay(), before);
    assert.equal(live.tick(), 1654n);
  } finally { bridge.dispose(); live.free(); }
});

test('world replacement preserves the cached cap spent attempts and future wait preference', async () => {
  const h = await setup({ cap: 1 }); h.send({ type: 'set-decision-wait', id: 2, seconds: 2.5 });
  h.dream(3); h.send({ type: 'use-rules-now', id: 4, requestId: 3, worldId: 1 }); await settle();
  const session = h.bridge.status();
  assert.deepEqual(session, { config: 'ready', enabled: true, sessionCap: 1, spent: 1, waitSeconds: 2.5 });
  h.send({ type: 'create-world', id: 5, seed: '2', config: 'new' }); h.dream(6);
  assert.deepEqual(h.bridge.status(), session); assert.equal(h.client.configSignals.length, 1);
  assert.equal(h.client.configSignals[0]!.aborted, false); assert.equal(h.client.attempts.length, 1);
  const reply = h.reply(6); assert.equal(reply.ok, true);
  assert.ok(reply.snapshot.decision?.outcome?.kind === 'fallback');
  assert.equal(reply.snapshot.decision.outcome.reason, 'session_cap');
  assert.equal(reply.snapshot.decision.pending, null); assert.equal(reply.snapshot.worldId, 2);
  h.bridge.dispose();
});

