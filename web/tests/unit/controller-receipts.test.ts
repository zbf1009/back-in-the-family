import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WasmSim } from '../../../target/wasm-pkg/sim_wasm.js';
import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import { DecisionBridge } from '../../src/worker/decision-bridge.ts';
import type { CheckedSubmission, Reply, RequestWithoutId, RunUntilStopResult, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import type { CoreActionResult, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { FakeClock, FakeFrameScheduler } from './helpers/fakes.ts';
import { checkedReceipt, loadWasm } from './helpers/wasm.ts';
import { ControlledDecisionClient, DecisionClock, config, mapping, modelDecision, settle, waitingSim, wasm } from './helpers/decision.ts';

function rig(sim: SimHandle, options: {
  post?: (message: WorkerMessage) => void;
  createSim?: (seed: bigint, config: string) => SimHandle;
  decision?: ConstructorParameters<typeof SimController>[0]['decision'];
} = {}) {
  const clock = new FakeClock();
  const scheduler = new FakeFrameScheduler();
  const messages: WorkerMessage[] = [];
  let creates = 0;
  const controller = new SimController({
    createSim: options.createSim ?? ((seed, value) => creates++ === 0 ? sim : new WasmSim(seed, value)),
    clock, scheduler, decision: options.decision,
    post: message => { options.post?.(message); messages.push(message); },
  });
  controller.ready();
  let id = 0;
  const send = (request: RequestWithoutId): Reply => {
    const requestId = ++id;
    controller.handle({ ...request, id: requestId });
    const replies = messages.filter((message): message is Reply => message.type === 'reply' && message.id === requestId);
    assert.equal(replies.length, 1, 'the issued synchronous request has exactly one reply');
    return replies[0]!;
  };
  send({ type: 'create-world', seed: '1205', config: '{}' });
  return { controller, clock, scheduler, messages, send };
}

function world(sim: WasmSim): WorldSnapshot { return JSON.parse(sim.snapshot()); }
function targetOf(sim: WasmSim): number {
  const view = world(sim).underworld_view;
  assert.ok(view);
  const target = view.actions.haunt.targets.find(entry => entry.availability.eligible && entry.target !== 1);
  assert.ok(target, 'the unchanged seedP prefix supplies a real eligible connected target');
  return target.target;
}
function queued(sim: WasmSim, reply: Reply, payloads: unknown[]): string[] {
  assert.ok(reply.ok && reply.submission);
  const receipt = reply.submission;
  const inputs = JSON.parse(sim.export_replay()).inputs.filter((input: { seq: string }) => receipt.seqs.includes(input.seq)) as {
    tick: string; seq: string; payload: unknown;
  }[];
  assert.equal(sim.tick().toString(), receipt.tick, 'acceptance does not advance the actual WASM tick');
  assert.deepEqual(inputs.map(input => input.payload), payloads);
  assert.deepEqual(inputs.map(input => input.tick), payloads.map(() => receipt.tick));
  assert.deepEqual(receipt.seqs, inputs.map(input => input.seq));
  assert.equal(receipt.seqs.length, payloads.length);
  return receipt.seqs;
}
function statuses(messages: WorkerMessage[]) {
  return messages.filter((message): message is Extract<WorkerMessage, { type: 'status' }> => message.type === 'status');
}
function wrapped(actions: CoreActionResult[], worldId: number, requestIds: (number | null)[]) {
  return actions.map((action, index) => ({ ...action, worldId, requestId: requestIds[index] }));
}
function raw(sim: WasmSim, payload: unknown): string { return JSON.stringify({ tick: sim.tick().toString(), payload }); }

test('actual WASM paused Step publishes Bribe and Haunt immediately without a stop or a receipt-only delivery', () => {
  const live = waitingSim(); const direct = waitingSim();
  try {
    const h = rig(live); const target = targetOf(live);
    const bribePayload = { Bribe: { amount: '1' } }; const hauntPayload = { Haunt: { target: String(target) } };
    const bribe = h.send({ type: 'bribe', amount: '1' });
    const haunt = h.send({ type: 'haunt', target });
    queued(live, bribe, [bribePayload]); queued(live, haunt, [hauntPayload]);
    assert.ok(bribe.ok && haunt.ok);
    assert.deepEqual(bribe.submission, checkedReceipt(direct, [bribePayload]));
    assert.deepEqual(haunt.submission, checkedReceipt(direct, [hauntPayload]));
    const before = h.messages.length;
    const reply = h.send({ type: 'step' });
    const native: RunUntilStopResult = JSON.parse(direct.run_until_stop(1));
    assert.deepEqual(native.stops, []); assert.equal(native.ran, 1);
    assert.deepEqual(native.actions.map(action => [action.kind, action.state]), [['bribe', 'applied'], ['haunt', 'applied']]);
    const posted = h.messages.slice(before);
    assert.equal(posted.length, 2); const status = posted[0]!;
    assert.ok(status.type === 'status'); assert.equal(posted[1], reply);
    assert.equal(status.snapshot.runState, 'paused'); assert.equal(status.snapshot.stop, undefined);
    assert.equal(status.snapshot.tick, '5375'); assert.equal(status.snapshot.checksum, native.checksum);
    assert.deepEqual(status.snapshot.actions, wrapped(native.actions, 1, [bribe.id, haunt.id]));
    assert.deepEqual(status.snapshot.playerLifecycle, native.player_lifecycle);
    assert.deepEqual(reply.snapshot.actions, []); assert.deepEqual(reply.snapshot.playerLifecycle, []);
    assert.equal(live.export_replay(), direct.export_replay());
    const applied = status.snapshot.actions[0]!;
    assert.ok(applied.kind === 'bribe' && applied.state === 'applied' && applied.ruling);
    assert.equal(applied.ruling.source, 'rules_default');
    assert.match(applied.ruling.node, /^\d+$/);
    assert.match(applied.offering_event, /^\d+$/); assert.match(applied.appeal_event, /^\d+$/);
  } finally { live.free(); direct.free(); }
});

test('actual WASM one rebirth stop Status owns both action and playerLifecycle leaves before the empty Step Reply', () => {
  const live = waitingSim(); const direct = waitingSim();
  try {
    const h = rig(live);
    const claim = h.send({ type: 'claim', slot: 'imported_vessel', carryOver: null });
    const payload = { ClaimSlot: { slot: 'ImportedVessel' } };
    queued(live, claim, [payload]); assert.ok(claim.ok);
    assert.deepEqual(claim.submission, checkedReceipt(direct, [payload]));
    const rejectedPayload = { Bribe: { amount: '0' } };
    const submitted = h.send({ type: 'submit', input: raw(live, rejectedPayload) });
    assert.ok(submitted.ok); assert.equal(submitted.submission, undefined);
    direct.submit(raw(direct, rejectedPayload));
    const before = h.messages.length;
    const reply = h.send({ type: 'step' });
    const native: RunUntilStopResult = JSON.parse(direct.run_until_stop(1));
    assert.ok(native.stops.includes('player_reborn'));
    assert.equal(native.actions.length, 1); assert.equal(native.actions[0]!.state, 'rejected');
    assert.ok(native.player_lifecycle.some(fact => fact.kind === 'possession'));
    const posted = h.messages.slice(before); const stopStatuses = statuses(posted);
    assert.equal(stopStatuses.length, 1); assert.equal(posted[0], stopStatuses[0]); assert.equal(posted[1], reply);
    const snapshot = stopStatuses[0]!.snapshot;
    assert.deepEqual(snapshot.stop, { reasons: native.stops, world: world(live) });
    assert.deepEqual(snapshot.actions, wrapped(native.actions, 1, [null]));
    assert.deepEqual(snapshot.playerLifecycle, native.player_lifecycle);
    assert.equal(snapshot.runState, 'paused');
    assert.deepEqual(reply.snapshot.actions, []); assert.deepEqual(reply.snapshot.playerLifecycle, []);
    assert.equal(live.export_replay(), direct.export_replay());
  } finally { live.free(); direct.free(); }
});

test('actual WASM running action facts bypass the cadence throttle and posted arrays remain immutable', () => {
  const live = waitingSim(); const direct = waitingSim();
  try {
    const h = rig(live); h.send({ type: 'run' });
    h.clock.advance(34); h.scheduler.flush(); direct.run_until_stop(1);
    const earlier = statuses(h.messages).at(-1)!; const saved = JSON.stringify(earlier);
    const target = targetOf(live); const payload = { Haunt: { target: String(target) } };
    const accepted = h.send({ type: 'haunt', target }); queued(live, accepted, [payload]);
    assert.ok(accepted.ok); assert.deepEqual(accepted.submission, checkedReceipt(direct, [payload]));
    const before = h.messages.length;
    h.clock.advance(34); h.scheduler.flush();
    const native: RunUntilStopResult = JSON.parse(direct.run_until_stop(1));
    const current = statuses(h.messages.slice(before));
    assert.equal(current.length, 1, 'facts publish at 68 ms, inside the 100 ms cadence window');
    assert.equal(current[0]!.snapshot.runState, 'running'); assert.equal(current[0]!.snapshot.stop, undefined);
    assert.deepEqual(current[0]!.snapshot.actions, wrapped(native.actions, 1, [accepted.id]));
    const delivered = JSON.stringify(current[0]);
    h.clock.advance(34); h.scheduler.flush(); direct.run_until_stop(1);
    h.send({ type: 'world-snapshot' });
    assert.equal(JSON.stringify(earlier), saved); assert.equal(JSON.stringify(current[0]), delivered);
    assert.equal(live.export_replay(), direct.export_replay());
    h.send({ type: 'pause' });
  } finally { live.free(); direct.free(); }
});

test('actual WASM a throwing post retains facts until an explicit read posts successfully without retry or fake success', () => {
  for (const running of [false, true]) {
    const live = waitingSim();
    try {
      const failure = new Error('transport post failed'); let throwStatus = true;
      let attempted: Snapshot | null = null;
      const h = rig(live, { post: message => {
        if (message.type === 'status' && throwStatus) { attempted = message.snapshot; throw failure; }
      } });
      const target = targetOf(live);
      const accepted = h.send({ type: 'haunt', target }); queued(live, accepted, [{ Haunt: { target: String(target) } }]);
      if (running) {
        h.send({ type: 'run' }); h.clock.advance(34);
        assert.throws(() => h.scheduler.flush(), error => error === failure);
      } else assert.throws(() => h.send({ type: 'step' }), error => error === failure);
      assert.equal(live.tick(), 5375n);
      assert.equal(statuses(h.messages).length, 0); assert.equal(h.messages.some(message => message.type === 'fatal'), false);
      assert.ok(attempted); const captured = attempted as Snapshot;
      assert.equal(captured.actions.length, 1); assert.equal(captured.actions[0]!.requestId, accepted.id);
      assert.equal(captured.actions[0]!.state, 'applied');
      const saved = JSON.stringify(captured.actions);
      throwStatus = false;
      const read = h.send({ type: 'decision-status' });
      assert.equal(read.snapshot.actions, captured.actions, 'the next explicit successful post transfers the retained array');
      assert.equal(read.snapshot.playerLifecycle, captured.playerLifecycle);
      assert.equal(read.snapshot.tick, '5375'); assert.equal(live.tick(), 5375n, 'the read does not rerun the batch');
      const empty = h.send({ type: 'decision-status' });
      assert.deepEqual(empty.snapshot.actions, []); assert.deepEqual(empty.snapshot.playerLifecycle, []);
      assert.equal(JSON.stringify(read.snapshot.actions), saved); assert.equal(statuses(h.messages).length, 0);
      if (running) h.send({ type: 'pause' });
    } finally { live.free(); }
  }
});

test('actual WASM early applied and rejected actions survive a later empty tick in one Worker batch with raw null IDs', () => {
  const live = waitingSim(); const direct = waitingSim();
  try {
    const h = rig(live); const target = targetOf(live);
    const bribe = h.send({ type: 'bribe', amount: '1' }); const haunt = h.send({ type: 'haunt', target });
    const bribePayload = { Bribe: { amount: '1' } }; const hauntPayload = { Haunt: { target: String(target) } };
    queued(live, bribe, [bribePayload]); queued(live, haunt, [hauntPayload]);
    checkedReceipt(direct, [bribePayload]); checkedReceipt(direct, [hauntPayload]);
    for (const payload of [hauntPayload, { Bribe: { amount: '0' } }]) {
      const reply = h.send({ type: 'submit', input: raw(live, payload) });
      assert.ok(reply.ok); assert.equal(reply.submission, undefined); direct.submit(raw(direct, payload));
    }
    h.send({ type: 'set-speed', speed: 7 });
    h.send({ type: 'run' }); const before = h.messages.length;
    // 15 ms at 210 ticks/s admits three ticks, below the existing eleven-tick cap.
    h.clock.advance(15); h.scheduler.flush();
    const native: RunUntilStopResult = JSON.parse(direct.run_until_stop(3));
    assert.equal(native.ran, 3); assert.deepEqual(native.stops, []); assert.equal(live.tick(), 5377n);
    assert.deepEqual(native.actions.map(action => action.state), ['applied', 'applied', 'rejected', 'rejected']);
    const rateLimited = native.actions[2]!; const badAmount = native.actions[3]!;
    assert.ok(rateLimited.state === 'rejected' && badAmount.state === 'rejected');
    assert.equal(rateLimited.reason, 'rate_limited'); assert.equal(badAmount.reason, 'bad_amount');
    assert.ok(native.actions.every(action => action.tick === '5374'));
    const current = statuses(h.messages.slice(before)); assert.equal(current.length, 1);
    assert.deepEqual(current[0]!.snapshot.actions, wrapped(native.actions, 1, [bribe.id, haunt.id, null, null]));
    assert.equal(current[0]!.snapshot.checksum, native.checksum);
    const delivered = JSON.stringify(current[0]);
    h.clock.advance(100); h.scheduler.flush(); const later: RunUntilStopResult = JSON.parse(direct.run_until_stop(11));
    assert.equal(later.ran, 11, 'the later cadence batch uses the same seven-speed frame cap');
    assert.deepEqual(later.actions, []); assert.deepEqual(later.player_lifecycle, []);
    assert.deepEqual(statuses(h.messages).at(-1)!.snapshot.actions, []);
    assert.equal(JSON.stringify(current[0]), delivered); assert.equal(live.export_replay(), direct.export_replay());
    h.send({ type: 'pause' });
  } finally { live.free(); direct.free(); }
});

test('actual WASM failed Create preserves pending request binding and successful Create clears old-world bindings', () => {
  const live = waitingSim(); const replacement = waitingSim();
  try {
    const h = rig(live, { createSim: (_seed, value) => {
      if (value === 'bad') return new WasmSim(1205n, value);
      return value === 'replacement' ? replacement : live;
    } });
    const target = targetOf(live);
    const accepted = h.send({ type: 'haunt', target }); queued(live, accepted, [{ Haunt: { target: String(target) } }]);
    const replay = live.export_replay();
    const failed = h.send({ type: 'create-world', seed: '1205', config: 'bad' });
    assert.ok(!failed.ok); assert.equal(failed.kind, 'sim-error'); assert.equal(failed.snapshot.worldId, 1);
    assert.equal(live.export_replay(), replay); assert.equal(failed.snapshot.tick, '5374');
    h.send({ type: 'step' });
    const applied = statuses(h.messages).at(-1)!.snapshot.actions[0]!;
    assert.equal(applied.requestId, accepted.id); assert.equal(applied.worldId, 1); assert.equal(applied.state, 'applied');
    const pending = h.send({ type: 'bribe', amount: '1' }); queued(live, pending, [{ Bribe: { amount: '1' } }]);
    const created = h.send({ type: 'create-world', seed: '1205', config: 'replacement' });
    assert.ok(created.ok); assert.equal(created.snapshot.worldId, 2);
    assert.deepEqual(created.snapshot.actions, []); assert.deepEqual(created.snapshot.playerLifecycle, []);
    for (let index = 0; index < 2; index++) h.send({ type: 'submit', input: raw(replacement, { Bribe: { amount: '0' } }) });
    h.send({ type: 'step' });
    const actions = statuses(h.messages).at(-1)!.snapshot.actions;
    assert.equal(actions.length, 2); assert.ok(pending.ok && pending.submission);
    assert.ok(actions.some(action => action.input_seq === pending.submission!.seqs[0]), 'the new raw input reuses an old pending sequence');
    assert.ok(actions.every(action => action.worldId === 2 && action.requestId === null && action.state === 'rejected'));
  } finally { live.free(); replacement.free(); }
});

test('actual WASM successful Create discards only old-world undelivered buffers after a throwing publication', () => {
  const live = waitingSim(); const replacement = waitingSim();
  try {
    let throws = true;
    const h = rig(live, { createSim: (_seed, value) => value === 'replacement' ? replacement : live,
      post: message => { if (message.type === 'status' && throws) throw Error('post failed'); } });
    h.send({ type: 'haunt', target: targetOf(live) });
    assert.throws(() => h.send({ type: 'step' }), /post failed/);
    throws = false;
    const created = h.send({ type: 'create-world', seed: '1205', config: 'replacement' });
    assert.equal(created.snapshot.worldId, 2); assert.deepEqual(created.snapshot.actions, []);
    assert.deepEqual(created.snapshot.playerLifecycle, []);
    assert.deepEqual(h.send({ type: 'decision-status' }).snapshot.actions, []);
  } finally { live.free(); replacement.free(); }
});

test('actual WASM rejected model pair binds Bribe only to the final accepted fallback receipt and request', async () => {
  const live = waitingSim(); const direct = waitingSim();
  const client = new ControlledDecisionClient(); const timing = new DecisionClock();
  const bridge = new DecisionBridge(client, wasm, mapping, timing);
  const attempts: { payloads: unknown[]; result: CheckedSubmission; replay: string }[] = [];
  const submit = live.submit_checked.bind(live);
  live.submit_checked = input => {
    const payloads = JSON.parse(input);
    // Inject a legal Dream option into the Bribe pair: serde parses it, then
    // actual Rust admission rejects index 1 because it is outside that node's set.
    if (payloads.length === 2) payloads[1].Choose.option = 'heed_warning';
    const result = submit(JSON.stringify(payloads));
    attempts.push({ payloads, result: JSON.parse(result), replay: live.export_replay() });
    return result;
  };
  try {
    client.prefetched.resolve(config()); await settle();
    assert.equal(bridge.fallbackReason(), null, 'the real bridge is ready before issuing the model decision');
    const h = rig(live, { decision: { bridge, timing, previewNode: (sim, payload) => (sim as WasmSim).preview_node(payload),
      exportReplay: sim => (sim as WasmSim).export_replay() } });
    const before = live.export_replay(); const preview = JSON.parse(live.preview_node('{"Bribe":{"amount":"1"}}'));
    assert.equal(preview.ok, true); assert.equal(preview.family, 'magistrate_ruling');
    h.controller.handle({ type: 'bribe', id: 90, amount: '1' });
    assert.equal(live.export_replay(), before); assert.equal(client.attempts.length, 1);
    client.attempts[0]!.response.resolve(modelDecision(preview.rules_default)); await settle();
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0]!.result, { ok: false, index: 1, reason: 'option_not_in_set' });
    assert.equal(attempts[0]!.replay, before, 'the actual rejected atomic pair allocates no sequence or partial trigger');
    assert.ok(attempts[1]!.result.ok); assert.equal(attempts[1]!.payloads.length, 1);
    const reply = h.messages.find((message): message is Reply => message.type === 'reply' && message.id === 90)!;
    const seqs = queued(live, reply, [{ Bribe: { amount: '1' } }]);
    assert.ok(reply.ok); assert.deepEqual(reply.submission, checkedReceipt(direct, [{ Bribe: { amount: '1' } }]));
    assert.equal(reply.snapshot.decision?.outcome?.kind, 'fallback');
    h.send({ type: 'step' }); const native: RunUntilStopResult = JSON.parse(direct.run_until_stop(1));
    const action = statuses(h.messages).at(-1)!.snapshot.actions[0]!;
    assert.deepEqual(action, { ...native.actions[0], worldId: 1, requestId: 90 });
    assert.equal(action.input_seq, seqs[0]); assert.ok(action.kind === 'bribe' && action.state === 'applied' && action.ruling);
    assert.equal(action.ruling.source, 'rules_default'); assert.equal(live.export_replay(), direct.export_replay());
  } finally { bridge.dispose(); live.free(); direct.free(); }
});

test('actual WASM missing required batch leaves and obsolete checked success are explicit interface errors', () => {
  loadWasm();
  for (const leaf of ['actions', 'player_lifecycle']) {
    const sim = new WasmSim(1n, '{"opening_residents":50}');
    try {
      const run = sim.run_until_stop.bind(sim);
      sim.run_until_stop = max => { const result = JSON.parse(run(max)); delete result[leaf]; return JSON.stringify(result); };
      const h = rig(sim); const reply = h.send({ type: 'step' });
      assert.ok(!reply.ok); assert.match(reply.error, /WASM interface error: required actions\/player_lifecycle/);
      assert.equal(h.messages.filter(message => message.type === 'fatal').length, 1);
      assert.equal(statuses(h.messages).length, 0);
    } finally { sim.free(); }
  }
  const sim = waitingSim();
  try {
    sim.submit_checked = () => '{"ok":true}';
    const h = rig(sim); const before = sim.export_replay();
    const reply = h.send({ type: 'haunt', target: targetOf(sim) });
    assert.ok(!reply.ok); assert.equal(reply.kind, 'sim-error');
    assert.match(reply.error, /WASM interface error: required checked tick\/seqs receipt/);
    assert.equal(sim.export_replay(), before); assert.deepEqual(reply.snapshot.actions, []);
  } finally { sim.free(); }
});

test('actual WASM missing or version-mismatched ActionView leaves throw explicit interface errors without invented prices', () => {
  const sim = waitingSim(); const snapshot = sim.snapshot.bind(sim);
  const mutations: ((view: Record<string, any>) => void)[] = [
    view => { delete view.actions; },
    view => { view.actions.version = 2; },
    view => { delete view.actions.haunt.price; },
    view => { delete view.actions.haunt.targets; },
    view => { delete view.actions.bribe.max_amount; },
    view => { delete view.actions.capped_spend.remaining; },
    view => { delete view.actions.bribe.availability.reason; },
    view => { delete view.actions.haunt.targets[0].availability.eligible; },
  ];
  try {
    const h = rig(sim); const before = sim.export_replay();
    for (const mutate of mutations) {
      sim.snapshot = () => { const data = JSON.parse(snapshot()); mutate(data.underworld_view); return JSON.stringify(data); };
      const count = h.messages.length;
      assert.throws(() => h.send({ type: 'world-snapshot' }), /WASM interface error: required ActionView version 1 leaves/);
      assert.equal(h.messages.length, count, 'no fabricated success or fallback ActionView is posted');
      assert.equal(sim.export_replay(), before);
    }
  } finally { sim.free(); }
});

test('actual WASM a throwing stop post retains both leaves for the next explicit successful read', () => {
  const live = waitingSim();
  try {
    let throws = true; let attempted: Snapshot | null = null;
    const h = rig(live, { post: message => {
      if (message.type === 'status' && throws) { attempted = message.snapshot; throw Error('stop post failed'); }
    } });
    h.send({ type: 'claim', slot: 'imported_vessel', carryOver: null });
    h.send({ type: 'submit', input: raw(live, { Bribe: { amount: '0' } }) });
    assert.throws(() => h.send({ type: 'step' }), /stop post failed/);
    assert.ok(attempted); const captured = attempted as Snapshot;
    assert.ok(captured.stop?.reasons.includes('player_reborn'));
    assert.equal(captured.actions.length, 1); assert.ok(captured.playerLifecycle.length > 0);
    const retained = JSON.stringify([captured.actions, captured.playerLifecycle]);
    throws = false;
    const read = h.send({ type: 'world-snapshot' });
    assert.equal(read.snapshot.actions, captured.actions); assert.equal(read.snapshot.playerLifecycle, captured.playerLifecycle);
    assert.equal(read.snapshot.stop, undefined); assert.equal(read.snapshot.runState, 'paused');
    const empty = h.send({ type: 'decision-status' });
    assert.deepEqual(empty.snapshot.actions, []); assert.deepEqual(empty.snapshot.playerLifecycle, []);
    assert.equal(JSON.stringify([read.snapshot.actions, read.snapshot.playerLifecycle]), retained);
    assert.equal(statuses(h.messages).length, 0, 'the failed stop was not retried or labeled delivered');
  } finally { live.free(); }
});

test('actual WASM undelivered observations are not capped at the settled display history limit', () => {
  const live = waitingSim();
  try {
    let throws = true;
    const h = rig(live, { post: message => { if (message.type === 'status' && throws) throw Error('batch post failed'); } });
    for (let index = 0; index < 25; index++) h.send({ type: 'submit', input: raw(live, { Bribe: { amount: '0' } }) });
    assert.throws(() => h.send({ type: 'step' }), /batch post failed/);
    throws = false;
    const read = h.send({ type: 'decision-status' });
    assert.equal(read.snapshot.actions.length, 25);
    assert.equal(new Set(read.snapshot.actions.map(action => action.input_seq)).size, 25);
    assert.ok(read.snapshot.actions.every(action => action.kind === 'bribe' && action.state === 'rejected' &&
      action.reason === 'bad_amount' && action.worldId === 1 && action.requestId === null && action.tick === '5374'));
    assert.deepEqual(h.send({ type: 'decision-status' }).snapshot.actions, []);
    assert.equal(read.snapshot.actions.length, 25);
  } finally { live.free(); }
});
