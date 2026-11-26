// Feature: first-playable, Property 22: The controller stops on stops and never feeds the clock to the simulation
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { SimController, type SimHandle } from '../../src/worker/controller.ts';
import type { PlayerNodeState, Reply, RequestWithoutId, RunUntilStopResult, WorkerMessage } from '../../src/shared/protocol.ts';
import { SPEEDS } from '../../src/shared/speeds.ts';
import { emptyStoryBatch, FakeClock, FakeFrameScheduler, RecordingSimHandle, messageCollector } from './helpers/fakes.ts';
import { createSim } from './helpers/wasm.ts';

class CountingClock extends FakeClock {
  reads = 0;
  override now(): number { this.reads++; return super.now(); }
}

// A callback can have left the scheduler queue before cancellation happens.
class QueuedScheduler extends FakeFrameScheduler {
  lastCallback: (() => void) | null = null;
  cancellations: number[] = [];
  override request(cb: () => void): number {
    this.lastCallback = cb;
    return super.request(cb);
  }
  override cancel(id: number): void { this.cancellations.push(id); super.cancel(id); }
}

// Deliberately synthetic state: generated stops need not wait 600 real ticks.
// Checksums have an independent recurrence in the property below; no fake
// handle is used for the C3 evidence example.
class StopSim implements SimHandle {
  current = 0n;
  history: string[] = [];
  inputs: unknown[] = [];
  acceptedAt: number[] = [];
  resolved: { tick: number; option: string }[] = [];
  pending: PlayerNodeState = { pending: false };
  checked: string[] = [];
  reject = false;
  choice: string | null = null;
  readonly interval: number;
  readonly reasons: RunUntilStopResult['stops'];
  constructor(interval: number, reasons: RunUntilStopResult['stops']) {
    this.interval = interval; this.reasons = reasons;
  }
  tick(): bigint { return this.current; }
  snapshot(): string { return JSON.stringify({ tick: String(this.current), chronicle: this.resolved, underworld_view: null }); }
  story_opening(): string { return JSON.stringify(emptyStoryBatch(true)); }
  player_node_state(): string { return JSON.stringify(this.pending); }
  checksums(from: bigint, to: bigint): string { return JSON.stringify(this.history.slice(Number(from), Number(to + 1n))); }
  submit(input: string): void {
    const decoded = JSON.parse(input);
    this.submit_checked(JSON.stringify([decoded.payload]));
  }
  submit_checked(input: string): string {
    this.checked.push(input);
    const payloads = JSON.parse(input);
    if (this.reject) return JSON.stringify({ ok: false, index: 0, reason: 'insufficient_joss' });
    const choose = payloads.find((p: { ChoosePlayer?: { node: string; option: string } }) => p.ChoosePlayer)?.ChoosePlayer;
    if (choose && (!this.pending.pending || choose.node !== this.pending.node)) return JSON.stringify({ ok: false, index: 0, reason: 'unknown_node' });
    if (choose && choose.option !== 'repay_now') return JSON.stringify({ ok: false, index: 0, reason: 'option_not_in_set' });
    if (choose && this.pending.pending && this.pending.answered) return JSON.stringify({ ok: false, index: 0, reason: 'already_chosen' });
    this.inputs.push(...payloads);
    if (choose) {
      this.choice = choose.option;
      this.pending = { pending: true, node: choose.node, answered: true };
      this.acceptedAt.push(Number(this.current));
    }
    return JSON.stringify({ ok: true, tick: String(this.current),
      seqs: payloads.map((_payload: unknown, index: number) => String(this.inputs.length - payloads.length + index)) });
  }
  step(): string { return JSON.parse(this.run_until_stop(1)).checksum; }
  run_ticks(n: number): string { for (let k = 0; k < n; k++) this.step(); return this.history.at(-1) ?? ''; }
  run_until_stop(max: number): string {
    let ran = 0;
    let stops: RunUntilStopResult['stops'] = [];
    while (ran < max) {
      if (this.pending.pending) {
        this.resolved.push({ tick: Number(this.current), option: this.choice ?? 'rules_default' });
        this.pending = { pending: false }; this.choice = null;
      }
      this.current++; ran++;
      // Cumulative accepted choices affect all subsequent checksums.
      this.history.push((Number(this.current) * 257 + this.acceptedAt.length).toString(16).padStart(16, '0'));
      if (Number(this.current) % this.interval === 0) {
        stops = this.reasons;
        if (stops.includes('player_node')) this.pending = { pending: true, node: String(this.current), answered: false };
        break;
      }
    }
    const result: RunUntilStopResult = {
      ran, checksum: this.history.at(-1) ?? '', stops, actions: [], player_lifecycle: [], story: emptyStoryBatch(),
    };
    return JSON.stringify(result);
  }
}

function rig(factory: (seed: bigint, config: string) => SimHandle, origin = 0) {
  const clock = new CountingClock(origin);
  const scheduler = new QueuedScheduler();
  const { post, messages } = messageCollector<WorkerMessage>();
  const handles: RecordingSimHandle[] = [];
  const controller = new SimController({
    createSim: (seed, config) => {
      const handle = new RecordingSimHandle(factory(seed, config)); handles.push(handle); return handle;
    }, scheduler, clock, post,
  });
  controller.ready();
  let id = 0;
  const send = (request: RequestWithoutId): Reply => {
    const sentId = ++id;
    const before = messages.length;
    controller.handle({ ...request, id: sentId });
    const replies = messages.slice(before).filter((m): m is Reply => m.type === 'reply');
    assert.equal(replies.length, 1, 'each request has exactly one reply');
    assert.equal(replies[0].id, sentId);
    return replies[0];
  };
  return { controller, send, clock, scheduler, messages, handles };
}

const scheduleArb = fc.array(fc.oneof(
// Requests are shared protocol values; only the frame event is test-owned.
  fc.constantFrom<RequestWithoutId>({ type: 'run' }, { type: 'pause' }, { type: 'step' },
    { type: 'choose', node: 'current', option: 'repay_now' },
    { type: 'choose', node: 'current', option: 'ignore_it' },
    { type: 'choose-and-run', node: 'current', option: 'repay_now' },
    { type: 'choose-and-run', node: 'current', option: 'ignore_it' },
    { type: 'create-world', seed: '1', config: '{}' }, { type: 'create-world', seed: '1', config: 'bad' }),
  fc.constantFrom(...SPEEDS).map((speed): RequestWithoutId => ({ type: 'set-speed', speed })),
  fc.integer({ min: 0, max: 1500 }).map((elapsed) => ({ type: 'frame' as const, elapsed })),
), { maxLength: 70 });

function generatedRun(interval: number, reasons: RunUntilStopResult['stops'], schedule: (RequestWithoutId | { type: 'frame'; elapsed: number })[], origin: number) {
  const sims: StopSim[] = [];
  const r = rig((_seed, config) => {
    if (config === 'bad') throw new Error('bad config');
    const sim = new StopSim(interval, reasons); sims.push(sim); return sim;
  }, origin);
  r.send({ type: 'create-world', seed: '1', config: '{}' });
  for (const cmd of schedule) {
    const sim = sims.at(-1)!;
    const rec = r.handles.at(-1)!;
    const beforeMessages = r.messages.length;
    const tick = sim.current;
    const history = [...sim.history];
    const inputs = [...sim.inputs];
    const pending = { ...sim.pending };
    const reads = r.clock.reads;
    const calls = rec.calls.length;
    const wasRunning = r.scheduler.isPending;
    const oldCallback = r.scheduler.lastCallback;
    const request = cmd.type === 'choose' || cmd.type === 'choose-and-run' ?
      { ...cmd, node: sim.pending.pending ? sim.pending.node : '0' } : cmd;
    let reply: Reply | undefined;
    if (request.type === 'frame') { r.clock.advance(request.elapsed); r.scheduler.flush(); }
    else reply = r.send(request);
    const posted = r.messages.slice(beforeMessages);
    const statuses = posted.filter((m) => m.type === 'status');
    if (reply) {
      assert.deepEqual(reply.snapshot.playerNode, sims.at(-1)!.pending);
      if (request.type !== 'pause') assert.equal(reply.snapshot.stop, undefined, 'tick stop never repeated in reply');
    }
    if ((request.type === 'run' || request.type === 'step') && pending.pending && !pending.answered) {
      assert.ok(reply && !reply.ok); assert.equal(reply.kind, 'node_unanswered');
      assert.equal(r.clock.reads, reads, 'gate reads no clock and cannot re-anchor');
      assert.equal(rec.calls.length, calls, 'gate reads/submits/advances nothing');
      assert.equal(reply.snapshot.runState, 'paused');
      assert.equal(sim.current, tick); assert.deepEqual(sim.history, history); assert.deepEqual(sim.inputs, inputs);
    }
    if (reply && !reply.ok && (request.type === 'choose' || request.type === 'choose-and-run')) {
      assert.equal(sim.current, tick); assert.deepEqual(sim.inputs, inputs); assert.deepEqual(sim.history, history);
      assert.deepEqual(sim.pending, pending);
    }
    if (reply?.ok && request.type === 'choose') {
      assert.equal(sim.current, tick); assert.equal(sim.pending.pending && sim.pending.answered, true);
      assert.equal(r.scheduler.isPending, wasRunning, 'choose leaves Run_State');
    }
    if (reply?.ok && request.type === 'choose-and-run') {
      assert.equal(sim.current, tick + 1n);
      assert.deepEqual(sim.resolved.at(-1), { tick: Number(tick), option: request.option });
      assert.deepEqual(rec.mutatingCalls.slice(-2), [
        { method: 'submit_checked', input: JSON.stringify([{ ChoosePlayer: { node: request.node, option: request.option } }]) },
        { method: 'run_until_stop', n: 1 },
      ], 'accepted choose-and-run submits then advances in one request');
    }
    if (sim.current > tick && pending.pending && pending.answered) {
      assert.deepEqual(sim.resolved.find((e) => e.tick === Number(tick)), { tick: Number(tick), option: 'repay_now' });
    }
    if (reply?.ok && (request.type === 'pause' || request.type === 'set-speed')) {
      assert.equal(sim.current, tick); assert.deepEqual(sim.inputs, inputs);
      if (request.type === 'pause') {
        assert.equal(statuses.length, 0);
        assert.deepEqual(reply.snapshot.stop, wasRunning ? { reasons: ['user'], world: JSON.parse(sim.snapshot()) } : undefined);
      }
    }
    if (reply?.ok && request.type === 'create-world') {
      assert.equal(r.scheduler.isPending, false); assert.deepEqual(reply.snapshot.playerNode, { pending: false });
      const n = r.messages.length;
      const oldCalls = rec.calls.length;
      oldCallback?.();
      assert.equal(r.messages.length, n); assert.equal(rec.calls.length, oldCalls);
      assert.equal(sims.at(-1)!.current, 0n);
    } else if (reply && !reply.ok && request.type === 'create-world') {
      assert.equal(r.scheduler.isPending, wasRunning); assert.equal(sim.current, tick);
    }
    if (sim.current > tick && Number(sim.current) % interval === 0) {
      assert.equal(statuses.length, 1, 'one unthrottled status on every stop');
      const status = statuses[0];
      assert.equal(status.snapshot.tick, String(sim.current));
      assert.equal(status.snapshot.checksum, sim.history.at(-1));
      assert.deepEqual(status.snapshot.stop, { reasons, world: JSON.parse(sim.snapshot()) });
      assert.deepEqual(status.snapshot.playerNode, sim.pending);
      assert.equal(status.snapshot.runState, 'paused'); assert.equal(r.scheduler.isPending, false);
      if (reply) assert.ok(posted.indexOf(status) < posted.indexOf(reply));
      const n = r.messages.length;
      r.scheduler.flush(); assert.equal(r.messages.length, n, 'no later tick/status until an advancing request');
    }
    for (let n = 1; n <= sim.history.length; n++) {
      const accepted = sim.acceptedAt.filter((t) => t < n).length;
      assert.equal(sim.history[n - 1], (n * 257 + accepted).toString(16).padStart(16, '0'), 'every tick matches the independent unpaced reference');
    }
  }
  for (const rec of r.handles) for (const call of rec.calls) {
    if (call.method === 'run_until_stop') assert.ok(Number.isInteger(call.n) && call.n >= 1 && call.n <= 548);
    if (call.method === 'submit_checked') assert.ok(Array.isArray(JSON.parse(call.input)));
    assert.notEqual(call.method, 'step'); assert.notEqual(call.method, 'run_ticks');
  }
  return { calls: r.handles.map((h) => h.calls), history: sims.map((s) => s.history) };
}

test('Property 22: generated stops, requests and clock origins preserve the gate and all reply carriers', () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 12 }),
    fc.subarray(['player_node', 'player_died', 'dream_resolved', 'player_reborn'] as const, { minLength: 1 }),
    scheduleArb, fc.integer({ min: 0, max: 10_000_000 }), (interval, reasons, schedule, origin) => {
      assert.deepEqual(generatedRun(interval, reasons, schedule, origin), generatedRun(interval, reasons, schedule, 0),
        'constant clock shifts produce identical handle calls and per-tick checksums');
    }), { numRuns: 1000 });
});

test('Property 22: every pending node refuses repeats and rejected choices; accepted choices resolve', () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 2, max: 8 }), (interval, nodes) => {
    const sim = new StopSim(interval, ['player_node']);
    const r = rig(() => sim);
    r.send({ type: 'create-world', seed: '1', config: '{}' });
    for (let k = 0; k < nodes; k++) {
      while (!sim.pending.pending) assert.equal(r.send({ type: 'step' }).ok, true);
      const tick = sim.tick(); const history = [...sim.history]; const inputs = [...sim.inputs];
      const calls = r.handles[0].calls.length; const reads = r.clock.reads;
      for (const type of ['run', 'step', 'run', 'step'] as const) {
        const reply = r.send({ type }); assert.ok(!reply.ok); assert.equal(reply.kind, 'node_unanswered');
      }
      assert.equal(r.clock.reads, reads); assert.equal(r.handles[0].calls.length, calls);
      assert.equal(sim.tick(), tick); assert.deepEqual(sim.history, history); assert.deepEqual(sim.inputs, inputs);
      const bad = r.send({ type: 'choose', node: sim.pending.node, option: 'ignore_it' });
      assert.ok(!bad.ok); assert.equal(bad.error, 'option_not_in_set');
      const refused = r.send({ type: 'run' }); assert.ok(!refused.ok); assert.equal(refused.kind, 'node_unanswered');
      assert.equal(r.send({ type: 'set-speed', speed: 365 }).ok, true);
      assert.equal(r.send({ type: 'pause' }).ok, true);
      assert.equal(sim.tick(), tick);
      const accepted = r.send({ type: 'choose', node: sim.pending.node, option: 'repay_now' });
      assert.ok(accepted.ok && accepted.world); assert.equal(accepted.snapshot.playerNode.pending && accepted.snapshot.playerNode.answered, true);
      assert.equal(r.send({ type: 'step' }).ok, true);
      assert.equal(sim.tick(), tick + 1n); assert.deepEqual(sim.resolved.at(-1), { tick: Number(tick), option: 'repay_now' });
    }
  }), { numRuns: 100 });
});

test('claim payload order, world carriers and checksum inclusive index semantics', () => {
  const sim = new StopSim(100, ['player_died']); const r = rig(() => sim);
  r.send({ type: 'create-world', seed: '1', config: '{}' });
  assert.ok(r.send({ type: 'world-snapshot' }).ok);
  for (const req of [
    { type: 'claim', slot: 'birth:3', carryOver: null },
    { type: 'claim', slot: 'imported_vessel', carryOver: 'warmth' },
    { type: 'claim', slot: 'rebuilt_body', carryOver: 'warmth', customization: { Set: { trait_name: 'warmth', value: 2 } } },
    { type: 'dream', dreamer: 9, intent: 'reassure' },
  ] satisfies RequestWithoutId[]) {
    const reply = r.send(req); assert.ok(reply.ok && reply.world);
    assert.deepEqual(reply.world, JSON.parse(sim.snapshot()));
  }
  assert.deepEqual(sim.checked.map((s) => JSON.parse(s)), [
    [{ ClaimSlot: { slot: { Birth: '3' } } }],
    [{ CarryOver: { trait_name: 'warmth' } }, { ClaimSlot: { slot: 'ImportedVessel' } }],
    [{ CarryOver: { trait_name: 'warmth' } }, { ClaimSlot: { slot: 'RebuiltBody', customization: { Set: { trait_name: 'warmth', value: 2 } } } }],
    [{ Dream: { dreamer: '9', intent: 'reassure' } }],
  ]);
  sim.reject = true;
  const inputs = [...sim.inputs];
  const rejected = r.send({ type: 'claim', slot: 'imported_vessel', carryOver: 'piety' });
  assert.ok(!rejected.ok); assert.equal(rejected.kind, 'rejected'); assert.deepEqual(sim.inputs, inputs, 'rejected claim leaves no partial CarryOver');
  for (let n = 0; n < 3; n++) r.send({ type: 'step' });
  const reply = r.send({ type: 'checksums', from: '1', to: '2' }); assert.ok(reply.ok);
  assert.deepEqual(reply.checksums, sim.history.slice(1, 3), 'index n is the tick advancing n to n+1');
  const state = r.send({ type: 'player_node_state' }); assert.ok(state.ok); assert.equal('world' in state, false); assert.equal('checksums' in state, false);
  for (const value of ['', '-1', ' 1', '1.0', '1e3', '18446744073709551616']) for (const field of ['from', 'to']) {
    const calls = r.handles[0].calls.length; const reads = r.clock.reads;
    const bad = r.send({ type: 'checksums', from: '0', to: '1', [field]: value });
    assert.ok(!bad.ok); assert.equal(bad.kind, 'invalid-tick'); assert.equal(r.handles[0].calls.length, calls); assert.equal(r.clock.reads, reads);
  }
});

test('world replacement ignores already-queued callbacks even after the new world starts running', () => {
  const sims: StopSim[] = [];
  const r = rig(() => { const sim = new StopSim(2, ['player_node']); sims.push(sim); return sim; });
  r.send({ type: 'create-world', seed: '1', config: '{}' });
  r.send({ type: 'set-speed', speed: 1 });
  r.send({ type: 'run' }); const old = r.scheduler.lastCallback!; const scheduled = r.scheduler.pendingHandle!;
  r.clock.advance(100); r.scheduler.flush();
  assert.equal(sims[0].pending.pending, true);
  r.send({ type: 'create-world', seed: '2', config: '{}' });
  assert.ok(r.scheduler.cancellations.includes(scheduled) || !r.scheduler.isPending);
  r.send({ type: 'run' }); const newHandle = r.scheduler.pendingHandle;
  const calls = r.handles.map((h) => h.calls.length); const messages = r.messages.length;
  old();
  assert.deepEqual(r.handles.map((h) => h.calls.length), calls); assert.equal(r.messages.length, messages);
  assert.equal(r.scheduler.pendingHandle, newHandle, 'stale callback cannot clear the new callback');
  r.clock.advance(200); r.scheduler.flush(); assert.equal(sims[1].tick(), 1n);
});

test('C3 real WASM: refusal at first stop, rejected choice stays shut, accepted choice resolves externally', () => {
  const r = rig(createSim);
  r.send({ type: 'create-world', seed: '18446744073709551557', config: '{"opening_residents":50}' });
  r.send({ type: 'set-speed', speed: 365 }); r.send({ type: 'run' });
  while (r.scheduler.isPending) { r.clock.advance(50); r.scheduler.flush(); }
  const stopped = r.send({ type: 'world-snapshot' }); assert.ok(stopped.ok && stopped.world);
  assert.equal(stopped.snapshot.tick, '641'); assert.equal(stopped.snapshot.checksum, '048d7b26bfabc97c');
  const rec = r.handles[0]; const history = JSON.parse(rec.checksums(0n, 18446744073709551615n));
  const calls = rec.calls.length; const reads = r.clock.reads;
  for (const type of ['run', 'step', 'run'] as const) {
    const reply = r.send({ type }); assert.ok(!reply.ok); assert.equal(reply.kind, 'node_unanswered');
    assert.deepEqual(reply.snapshot, stopped.snapshot);
  }
  assert.equal(rec.calls.length, calls); assert.equal(r.clock.reads, reads);
  assert.deepEqual(JSON.parse(rec.checksums(0n, 18446744073709551615n)), history); assert.equal(history.length, 641);
  const node = stopped.world.player_node!;
  const range = r.send({ type: 'checksums', from: '639', to: '640' }); assert.ok(range.ok);
  assert.deepEqual(range.checksums, history.slice(639, 641), 'real history index 640 is the 640→641 tick');
  const rejected = r.send({ type: 'choose', node: node.id, option: 'comfort_mourner' });
  assert.ok(!rejected.ok); assert.equal(rejected.kind, 'rejected'); assert.equal(rejected.error, 'option_not_in_set');
  const refused = r.send({ type: 'run' }); assert.ok(!refused.ok); assert.equal(refused.kind, 'node_unanswered');
  const malformed = r.send({ type: 'choose', node: 'not-decimal', option: 'repay_now' });
  assert.ok(!malformed.ok); assert.equal(malformed.kind, 'sim-error'); assert.equal(malformed.snapshot.tick, '641');
  assert.equal(r.send({ type: 'world-snapshot' }).ok, true, 'JsError is not fatal; world remains usable');
  const accepted = r.send({ type: 'choose', node: node.id, option: 'repay_now' });
  assert.ok(accepted.ok && accepted.world); assert.deepEqual(accepted.snapshot.playerNode, { pending: true, node: node.id, answered: true });
  assert.equal(accepted.snapshot.runState, 'paused'); assert.equal(accepted.snapshot.tick, '641');
  assert.equal(r.send({ type: 'step' }).ok, true);
  const resolved = r.send({ type: 'world-snapshot' }); assert.ok(resolved.ok && resolved.world);
  assert.equal(resolved.snapshot.tick, '642'); assert.deepEqual(resolved.snapshot.playerNode, { pending: false });
  const entry = resolved.world.chronicle.find((e) => e.tick === '641' && e.family === node.family);
  assert.ok(entry); assert.equal(entry.applied, 'repay_now'); assert.equal(entry.source, 'external');
  console.log(`[C3] stoppedTick=641 history=641 checksum=048d7b26bfabc97c run=node_unanswered clockReadsDelta=0 handleCallsDelta=0 rejected=option_not_in_set subsequentRun=node_unanswered resolvedTick=${entry.tick} displayedTick=${resolved.snapshot.tick} applied=${entry.applied} source=${entry.source}`);
});

test('C3 real WASM: run after an accepted choice advances Frames and resolves externally', () => {
  const seed = '18446744073709551557';
  const config = '{"opening_residents":50}';
  const r = rig((actualSeed, actualConfig) => {
    assert.equal(actualSeed, BigInt(seed));
    assert.equal(actualConfig, config, 'constructor receives only the request seed/config');
    return createSim(actualSeed, actualConfig);
  }, 987_654_321);
  r.send({ type: 'create-world', seed, config });
  const createReads = r.handles[0].calls.length;
  r.send({ type: 'set-speed', speed: 365 }); r.send({ type: 'run' });
  while (r.scheduler.isPending) { r.clock.advance(50); r.scheduler.flush(); }
  const stopped = r.send({ type: 'world-snapshot' }); assert.ok(stopped.ok && stopped.world);
  assert.equal(stopped.snapshot.tick, '641');
  const node = stopped.world.player_node!; assert.equal(node.id, '1');
  const option = 'repay_now';
  assert.ok(node.options.some((candidate) => candidate.id === option));
  const chosen = r.send({ type: 'choose', node: node.id, option });
  assert.ok(chosen.ok);
  assert.deepEqual(chosen.snapshot.playerNode, { pending: true, node: '1', answered: true });
  const resumed = r.send({ type: 'run' });
  assert.ok(resumed.ok); assert.equal(resumed.snapshot.runState, 'running');
  assert.equal(resumed.snapshot.tick, '641', 'run schedules rather than directly advancing');
  r.clock.advance(50); assert.equal(r.scheduler.flush(), true);
  const rec = r.handles[0]; assert.ok(rec.tick() > 641n);
  const firstFrameTick = rec.tick();
  const resolved = r.send({ type: 'world-snapshot' }); assert.ok(resolved.ok && resolved.world);
  const entry = resolved.world.chronicle.find((e) => e.tick === '641' && e.family === node.family);
  assert.ok(entry); assert.equal(entry.applied, option); assert.equal(entry.source, 'external');
  while (r.scheduler.isPending) { r.clock.advance(50); r.scheduler.flush(); }
  const nextStop = r.messages.filter((message) => message.type === 'status' && message.snapshot.stop).at(-1);
  assert.ok(nextStop && nextStop.type === 'status');
  assert.equal(rec.calls.filter(call => call.method === 'story_opening').length, 1);
  for (const [index, call] of rec.calls.entries()) {
    if (call.method === 'run_until_stop') {
      assert.ok(Number.isInteger(call.n) && call.n > 0 && call.n <= 548, 'only bounded tick counts cross the paced seam');
      assert.deepEqual(Object.keys(call).sort(), ['method', 'n']);
    } else if (call.method === 'submit_checked') {
      assert.deepEqual(call, { method: 'submit_checked', input: JSON.stringify([{ ChoosePlayer: { node: '1', option } }]) },
        'checked payload contains exactly the Snapshot node and selected option, no clock/random value');
    } else if (call.method === 'story_opening') {
      assert.ok(index < createReads, 'opening is read only during fresh Create, never during a later input or Frame');
      assert.deepEqual(call, { method: 'story_opening' });
    } else {
      assert.ok(call.method === 'tick' || call.method === 'snapshot' || call.method === 'player_node_state');
      assert.deepEqual(call, { method: call.method }, 'read seams receive no arguments');
    }
  }
  console.log(`[C3-run] runReply=${resumed.ok} runState=${resumed.snapshot.runState} firstFrameTick=${firstFrameTick} resolvedTick=${entry.tick} applied=${entry.applied} source=${entry.source} nextPauseTick=${nextStop.snapshot.tick} nextPauseReasons=${nextStop.snapshot.stop!.reasons.join('+')}`);
});

test('real WASM choose-and-run rejection is atomic, acceptance runs exactly one tick; plain submit opens gate', () => {
  for (const plain of [false, true]) {
    const r = rig(createSim);
    r.send({ type: 'create-world', seed: '18446744073709551557', config: '{"opening_residents":50}' });
    for (let n = 0; n < 641; n++) assert.equal(r.send({ type: 'step' }).ok, true);
    const before = r.send({ type: 'checksums', from: '0', to: '640' }); assert.ok(before.ok);
    const bad = r.send({ type: 'choose-and-run', node: '1', option: 'comfort_mourner' });
    assert.ok(!bad.ok); assert.equal(bad.kind, 'rejected'); assert.equal(bad.snapshot.tick, '641');
    const after = r.send({ type: 'checksums', from: '0', to: '640' }); assert.ok(after.ok); assert.deepEqual(after.checksums, before.checksums);
    const accepted = plain ? r.send({ type: 'submit', input: '{"tick":"641","payload":{"ChoosePlayer":{"node":"1","option":"repay_now"}}}' }) :
      r.send({ type: 'choose-and-run', node: '1', option: 'repay_now' });
    assert.ok(accepted.ok);
    if (plain) {
      assert.deepEqual(accepted.snapshot.playerNode, { pending: true, node: '1', answered: true });
      assert.equal(r.send({ type: 'step' }).ok, true);
    } else assert.ok(accepted.world);
    const read = r.send({ type: 'world-snapshot' }); assert.ok(read.ok && read.world);
    assert.equal(read.snapshot.tick, '642');
    assert.ok(read.world.chronicle.some((e) => e.tick === '641' && e.source === 'external' && e.applied === 'repay_now'));
    r.send({ type: 'run' });
    const calls = r.handles[0].calls.length;
    const running = r.send({ type: 'choose-and-run', node: '1', option: 'repay_now' });
    assert.ok(!running.ok); assert.equal(running.kind, 'invalid-state'); assert.equal(r.handles[0].calls.length, calls);
  }
});

test('Property 22: startup FIFO retains exactly one ordered reply and replacement cancels before replying', () => {
  fc.assert(fc.property(fc.array(fc.constantFrom<RequestWithoutId>(
    { type: 'run' }, { type: 'pause' }, { type: 'step' }, { type: 'player_node_state' },
    { type: 'create-world', seed: '3', config: '{}' },
  ), { maxLength: 25 }), (suffix) => {
    const scheduler = new QueuedScheduler(); const clock = new CountingClock();
    const messages: WorkerMessage[] = []; const handles: RecordingSimHandle[] = [];
    let firstCallback: (() => void) | null = null;
    const controller = new SimController({
      createSim: () => { const h = new RecordingSimHandle(new StopSim(3, ['player_node'])); handles.push(h); return h; },
      scheduler, clock,
      post: (message) => {
        if (message.type === 'reply' && message.id === 2) firstCallback = scheduler.lastCallback;
        if (message.type === 'reply' && message.id === 3) {
          assert.ok(scheduler.cancellations.length > 0, 'replacement cancelled before its reply');
          assert.equal(scheduler.isPending, false);
        }
        messages.push(message);
      },
    });
    const requests: RequestWithoutId[] = [
      { type: 'create-world', seed: '1', config: '{}' }, { type: 'run' },
      { type: 'create-world', seed: '2', config: '{}' }, ...suffix,
    ];
    requests.forEach((request, n) => controller.handle({ ...request, id: n + 1 }));
    assert.equal(messages.length, 0, 'startup waits for WASM ready');
    controller.ready();
    const replies = messages.filter((m): m is Reply => m.type === 'reply');
    assert.deepEqual(replies.map((m) => m.id), requests.map((_r, n) => n + 1));
    let worldId = 0;
    for (const message of messages) if (message.type !== 'fatal') {
      assert.ok(message.snapshot.worldId >= worldId, 'no old-world reply or status after a successful replacement');
      worldId = message.snapshot.worldId;
    }
    const calls = handles.map((h) => h.calls.length); const count = messages.length;
    assert.ok(firstCallback); (firstCallback as () => void)();
    assert.deepEqual(handles.map((h) => h.calls.length), calls);
    assert.equal(messages.length, count, 'already dequeued startup callback neither steps nor posts');
  }), { numRuns: 100 });
});

test('choose-and-run reports a simultaneous tick stop once, in status before its world reply', () => {
  const sim = new StopSim(1, ['player_node', 'player_died', 'dream_resolved', 'player_reborn']);
  const r = rig(() => sim);
  r.send({ type: 'create-world', seed: '1', config: '{}' });
  r.send({ type: 'step' });
  const before = r.messages.length;
  const reply = r.send({ type: 'choose-and-run', node: '1', option: 'repay_now' });
  assert.ok(reply.ok && reply.world); assert.equal(reply.snapshot.tick, '2');
  assert.equal(reply.snapshot.stop, undefined);
  const posted = r.messages.slice(before);
  assert.equal(posted.length, 2); assert.equal(posted[0].type, 'status'); assert.equal(posted[1], reply);
  const status = posted[0]; assert.ok(status.type === 'status');
  assert.deepEqual(status.snapshot.stop, { reasons: sim.reasons, world: JSON.parse(sim.snapshot()) });
  assert.deepEqual(status.snapshot.playerNode, { pending: true, node: '2', answered: false });
  assert.equal(status.snapshot.checksum, sim.history[1]);
});
