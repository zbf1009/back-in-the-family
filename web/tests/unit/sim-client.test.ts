/// <reference lib="dom" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLY_TIMEOUT_MS, SimClient } from '../../src/main/sim-client.ts';
import type { DecisionStatus, Reply, Request, RequestTicket, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import { settle } from './helpers/decision.ts';
import { installHarness } from '../../src/main/harness.ts';
import { reduce } from '../../src/main/ui-state.ts';
import { uiFor, waitingSnapshot } from './helpers/view.ts';

class WorkerPort extends EventTarget {
  readonly requests: Request[] = [];
  terminated = false;
  postMessage(request: Request): void { this.requests.push(request); }
  terminate(): void { this.terminated = true; }
  emit(message: WorkerMessage): void { this.dispatchEvent(new MessageEvent('message', { data: message })); }
}
const snapshot: Snapshot = { worldId: 1, tick: '0', checksum: null, runState: 'paused', speed: 1, tps: null, actions: [], playerLifecycle: [], playerNode: { pending: false } };
const decision: DecisionStatus = { config: 'ready', enabled: true, sessionCap: 40, spent: 1, waitSeconds: 10,
  pending: { requestId: 1, worldId: 1, tick: '0', trigger: '61' }, outcome: null };
function reply(id: number, pending = false): Reply {
  return { type: 'reply', id, ok: true, snapshot: pending ? { ...snapshot, decision } : snapshot };
}

test('client keeps normal replies FIFO even when transport delivers them out of order', async () => {
  const worker = new WorkerPort(); const client = new SimClient({}, worker as unknown as Worker);
  const order: number[] = [];
  const first = client.run().reply.then(result => order.push(result.id));
  const second = client.pause().reply.then(result => order.push(result.id));
  worker.emit(reply(2)); await settle(); assert.deepEqual(order, []);
  worker.emit(reply(1)); await Promise.all([first, second]); assert.deepEqual(order, [1, 2]); client.dispose();
});

test('only outstanding decision allows matching reads and competing rejections to overtake', async () => {
  const worker = new WorkerPort(); const client = new SimClient({}, worker as unknown as Worker);
  const order: number[] = [];
  const original = client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply.then(result => order.push(result.id));
  const read = client.request({ type: 'world-snapshot' }).reply.then(result => order.push(result.id));
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  worker.emit(reply(2, true)); await read; assert.deepEqual(order, [2]);
  const mutation = client.step().reply.then(result => { assert.equal(result.ok, false); order.push(result.id); });
  worker.emit({ type: 'reply', id: 3, ok: false, kind: 'decision_pending', error: 'decision_pending', snapshot: { ...snapshot, decision } });
  await mutation;
  worker.emit(reply(1)); await original; assert.deepEqual(order, [2, 3, 1]);
  const next = client.run().reply.then(result => order.push(result.id));
  const later = client.pause().reply.then(result => order.push(result.id));
  worker.emit(reply(5)); await settle(); assert.deepEqual(order, [2, 3, 1]);
  worker.emit(reply(4)); await Promise.all([next, later]); assert.deepEqual(order, [2, 3, 1, 4, 5]); client.dispose();
});

test('stale world binding and duplicate terminals never release another request or overwrite status', async () => {
  const worker = new WorkerPort(); let statuses = 0;
  const client = new SimClient({ onStatus: () => { statuses++; } }, worker as unknown as Worker);
  let readSettled = false;
  const original = client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply;
  const read = client.decisionStatus().reply.then(() => { readSettled = true; });
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  const stale = { ...decision, pending: { ...decision.pending!, worldId: 99 } };
  worker.emit({ type: 'reply', id: 2, ok: true, snapshot: { ...snapshot, decision: stale } });
  await settle(); assert.equal(readSettled, false);
  worker.emit(reply(1)); await Promise.all([original, read]);
  worker.emit(reply(1, true)); worker.emit(reply(2)); await settle();
  assert.equal(statuses, 1); client.dispose();
});

test('reply timeouts unblock normal FIFO and ignore late replies without unlocking later normal requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new WorkerPort(); const client = new SimClient({}, worker as unknown as Worker);
  const first = assert.rejects(client.run().reply, /run \(id 1\).*30000 ms/);
  t.mock.timers.tick(1);
  const order: number[] = [];
  const emptyOrder: number[] = [];
  const second = client.pause().reply.then(result => order.push(result.id));
  worker.emit(reply(2)); await settle(); assert.deepEqual(order, emptyOrder);
  t.mock.timers.tick(REPLY_TIMEOUT_MS - 1);
  await Promise.all([first, second]); assert.deepEqual(order, [2]);
  worker.emit(reply(1, true));
  const next = client.run().reply.then(result => order.push(result.id));
  const later = client.pause().reply.then(result => order.push(result.id));
  worker.emit(reply(4)); await settle(); assert.deepEqual(order, [2]);
  worker.emit(reply(3)); await Promise.all([next, later]); assert.deepEqual(order, [2, 3, 4]);
  client.dispose();
});

test('fatal worker messages immediately settle all clients exactly once and suppress late results', async () => {
  const worker = new WorkerPort(); let fatals = 0;
  const client = new SimClient({ onFatal: () => { fatals++; } }, worker as unknown as Worker);
  const promises = [client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply, client.decisionStatus().reply];
  const settled = Promise.allSettled(promises);
  worker.emit({ type: 'fatal', error: 'panic' });
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.message === 'panic'));
  worker.emit({ type: 'fatal', error: 'duplicate panic' });
  worker.dispatchEvent(new Event('messageerror'));
  worker.emit(reply(1)); worker.emit(reply(2));
  assert.throws(() => client.run(), /panic/); assert.equal(worker.requests.length, 2); assert.equal(fatals, 1);
  client.dispose(); assert.equal(worker.terminated, true);
});

test('worker error and messageerror events reject outstanding requests without waiting thirty seconds', async () => {
  for (const event of ['error', 'messageerror']) {
    const worker = new WorkerPort(); let errors = 0;
    const client = new SimClient({ onError: () => { errors++; } }, worker as unknown as Worker);
    const pending = client.step().reply; const settled = Promise.allSettled([pending]);
    worker.dispatchEvent(new Event(event));
    assert.equal((await settled)[0]!.status, 'rejected'); assert.equal(errors, 1); client.dispose();
  }
});

test('a decision cannot let matching later replies overtake an earlier ordinary request', async () => {
  const worker = new WorkerPort(); const client = new SimClient({}, worker as unknown as Worker);
  const order: number[] = [];
  const first = client.run().reply.then(result => order.push(result.id));
  const original = client.request({ type: 'bribe', amount: '1' }).reply.then(result => order.push(result.id));
  const read = client.decisionStatus().reply.then(result => order.push(result.id));
  const binding = { ...decision, pending: { ...decision.pending!, requestId: 2 } };
  worker.emit({ type: 'reply', id: 3, ok: true, snapshot: { ...snapshot, decision: binding } });
  await settle(); assert.deepEqual(order, []);
  worker.emit(reply(1)); await Promise.all([first, read]); assert.deepEqual(order, [1, 3]);
  worker.emit(reply(2)); await original; assert.deepEqual(order, [1, 3, 2]); client.dispose();
});

test('nondecision and mismatched snapshot bindings cannot open the overtaking window', async () => {
  const worker = new WorkerPort(); let statuses = 0;
  const client = new SimClient({ onStatus: () => { statuses++; } }, worker as unknown as Worker);
  const order: number[] = [];
  const emptyOrder: number[] = [];
  const first = client.run().reply.then(result => order.push(result.id));
  const read = client.decisionStatus().reply.then(result => order.push(result.id));
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  worker.emit(reply(2, true)); await settle(); assert.deepEqual(order, emptyOrder); assert.equal(statuses, 1);
  worker.emit(reply(1)); await Promise.all([first, read]);
  const original = client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply.then(result => order.push(result.id));
  const query = client.decisionStatus().reply.then(result => order.push(result.id));
  const binding = { ...decision, pending: { ...decision.pending!, requestId: 3 } };
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision: binding } });
  worker.emit({ type: 'reply', id: 4, ok: true, snapshot: { ...snapshot, worldId: 99, decision: binding } });
  await settle(); assert.deepEqual(order, [1, 2]);
  worker.emit(reply(3)); await Promise.all([original, query]); assert.deepEqual(order, [1, 2, 3, 4]);
  client.dispose();
});

test('stale decision subtrees do not suppress same-world statuses while old worlds remain rejected', async () => {
  const worker = new WorkerPort(); const statuses: Snapshot[] = [];
  const client = new SimClient({ onStatus: value => statuses.push(value) }, worker as unknown as Worker);
  const original = client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply;
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  worker.emit(reply(1)); await original;
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  const replacement = client.createWorld({ seed: '2', config: '{}' }).reply;
  worker.emit({ type: 'reply', id: 2, ok: true, snapshot: { ...snapshot, worldId: 2 } }); await replacement;
  worker.emit({ type: 'status', snapshot });
  worker.emit({ type: 'status', snapshot: { ...snapshot, worldId: 2 } });
  assert.deepEqual(statuses.map(value => value.worldId), [1, 1, 2]);
  assert.equal(statuses[1]!.decision, undefined); client.dispose();
});

test('failed creation and stale manual control overtake only their matching live decision; successful replacement settles both once', async () => {
  const worker = new WorkerPort(); const client = new SimClient({}, worker as unknown as Worker);
  const order: number[] = [];
  const original = client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply.then(result => order.push(result.id));
  const failed = client.createWorld({ seed: '2', config: 'bad' }).reply.then(result => { assert.equal(result.ok, false); order.push(result.id); });
  worker.emit({ type: 'reply', id: 2, ok: false, kind: 'sim-error', error: 'bad config', snapshot: { ...snapshot, decision } });
  await failed; assert.deepEqual(order, [2]);
  const stale = client.useRulesNow(99, 1).reply.then(result => { assert.equal(result.ok, false); order.push(result.id); });
  worker.emit({ type: 'reply', id: 3, ok: false, kind: 'invalid-state', error: 'no matching pending decision', snapshot: { ...snapshot, decision } });
  await stale; assert.deepEqual(order, [2, 3]);
  const replacement = client.createWorld({ seed: '2', config: '{}' }).reply.then(result => order.push(result.id));
  worker.emit({ type: 'reply', id: 1, ok: false, kind: 'cancelled', error: 'cancelled', snapshot });
  worker.emit({ type: 'reply', id: 4, ok: true, snapshot: { ...snapshot, worldId: 2 } });
  await Promise.all([original, replacement]); assert.deepEqual(order, [2, 3, 1, 4]);
  worker.emit(reply(1)); worker.emit(reply(4)); await settle(); assert.deepEqual(order, [2, 3, 1, 4]); client.dispose();
});

test('matching manual fallback delivers exactly one terminal to the original caller and the control', async () => {
  const worker = new WorkerPort(); const client = new SimClient({}, worker as unknown as Worker);
  const order: number[] = [];
  const original = client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply.then(result => order.push(result.id));
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  const manual = client.useRulesNow(1, 1).reply.then(result => order.push(result.id));
  worker.emit(reply(1)); worker.emit(reply(2)); await Promise.all([original, manual]);
  worker.emit(reply(1, true)); worker.emit(reply(2)); await settle(); assert.deepEqual(order, [1, 2]);
  client.dispose();
});

test('a timed-out decision cannot leave unconditional unordered mode or accept a stale pending status', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new WorkerPort(); let statuses = 0;
  const client = new SimClient({ onStatus: () => { statuses++; } }, worker as unknown as Worker);
  const original = assert.rejects(client.request({ type: 'dream', dreamer: 31, intent: 'urge' }).reply, /dream \(id 1\)/);
  worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  t.mock.timers.tick(1);
  const query = client.decisionStatus().reply; worker.emit(reply(2, true)); await query;
  t.mock.timers.tick(REPLY_TIMEOUT_MS - 1); await original;
  worker.emit(reply(1, true)); worker.emit({ type: 'status', snapshot: { ...snapshot, decision } });
  const order: number[] = [];
  const first = client.run().reply.then(result => order.push(result.id));
  const later = client.pause().reply.then(result => order.push(result.id));
  worker.emit(reply(4)); await settle(); assert.deepEqual(order, []); assert.equal(statuses, 2);
  worker.emit(reply(3)); await Promise.all([first, later]); assert.deepEqual(order, [3, 4]); client.dispose();
});

test('LV-C2: every convenience and all three harness methods expose the sole real issued ID', async () => {
  const worker = new WorkerPort();
  const client = new SimClient({}, worker as unknown as Worker);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  try {
    installHarness(client);
    const methods: (() => RequestTicket)[] = [
      () => client.createWorld({ seed: '1', config: '{}' }), () => client.run(), () => client.pause(),
      () => client.step(), () => client.setSpeed({ speed: 7 }), () => client.submit({ input: '{}' }),
      () => client.request({ type: 'haunt', target: 1 }), () => client.decisionStatus(),
      () => client.setDecisionWait(0), () => client.useRulesNow(1, 1), () => client.exportReplay(),
      () => window.__simHarness!.request({ type: 'player_node_state' }),
      () => window.__simHarness!.exportReplay(), () => window.__simHarness!.decisionMetrics(),
    ];
    for (const [index, issue] of methods.entries()) {
      const ticket = issue();
      const sent = worker.requests[index]!;
      assert.equal(ticket.requestId, index + 1);
      assert.equal(ticket.requestId, sent.id);
      assert.deepEqual(Object.keys(ticket).sort(), ['reply', 'requestId']);
      worker.emit(reply(sent.id));
      assert.equal((await ticket.reply).id, sent.id);
    }
    assert.deepEqual(worker.requests.map(request => request.type), ['create-world', 'run', 'pause', 'step',
      'set-speed', 'submit', 'haunt', 'decision-status', 'set-decision-wait', 'use-rules-now', 'export-replay',
      'player_node_state', 'export-replay', 'decision-metrics']);
  } finally {
    client.dispose();
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', originalWindow);
  }
});

test('LV-C2: pre-issuance transport failure throws without a ticket or pending FIFO entry', async () => {
  class ThrowingPort extends WorkerPort {
    fail = true;
    override postMessage(request: Request): void {
      if (this.fail) { this.fail = false; throw new Error('clone failed'); }
      super.postMessage(request);
    }
  }
  const worker = new ThrowingPort();
  const client = new SimClient({}, worker as unknown as Worker);
  assert.throws(() => client.step(), /clone failed/);
  assert.equal(worker.requests.length, 0);
  const ticket = client.pause();
  assert.equal(ticket.requestId, worker.requests[0]!.id);
  assert.equal(ticket.requestId, 2);
  worker.emit(reply(ticket.requestId));
  assert.equal((await ticket.reply).ok, true);
  client.dispose();
  assert.throws(() => client.step(), /disposed/);
  assert.equal(worker.requests.length, 1);
});

test('LV-C2: a timed-out real action settles from later Status without a retry or advancement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new WorkerPort();
  let ui = uiFor(waitingSnapshot());
  const client = new SimClient({ onStatus: snapshot => { ui = reduce(ui, { type: 'status', snapshot }); } }, worker as unknown as Worker);
  const ticket = client.request({ type: 'haunt', target: 1 });
  const request = worker.requests[0]!;
  ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
  const timeout = assert.rejects(ticket.reply, /haunt \(id 1\)/);
  t.mock.timers.tick(REPLY_TIMEOUT_MS); await timeout;
  ui = reduce(ui, { type: 'request-failed', request, worldId: 1, error: 'reply timeout' });
  assert.equal(ui.actions[0]!.phase, 'unknown');
  const result = { kind: 'haunt' as const, state: 'applied' as const, worldId: 1, requestId: ticket.requestId,
    input_seq: '18446744073709551614', tick: '501', target: 1, ghost: 2, event: '90',
    price: '40', intensity: '5', mood_delta: '-15' };
  worker.emit({ type: 'status', snapshot: { ...snapshot, tick: '501', actions: [result] } });
  assert.equal(ui.actions[0]!.phase, 'applied');
  assert.equal(ui.actions[0]!.inputSeq, result.input_seq);
  assert.equal(ui.actions[0]!.result, result);
  worker.emit(reply(ticket.requestId));
  assert.equal(ui.actions[0]!.phase, 'applied');
  assert.deepEqual(worker.requests.map(request => request.type), ['haunt']);
  client.dispose();
});

test('LV-C2: client filters only a closed decision subtree and preserves action lifecycle and stop World leaves', async () => {
  const worker = new WorkerPort();
  const statuses: Snapshot[] = [];
  const client = new SimClient({ onStatus: snapshot => statuses.push(snapshot) }, worker as unknown as Worker);
  const ticket = client.request({ type: 'dream', dreamer: 1, intent: 'warn' });
  worker.emit(reply(ticket.requestId)); await ticket.reply;
  const action = { worldId: 1, requestId: null, input_seq: '70', tick: '1', kind: 'haunt' as const,
    state: 'rejected' as const, reason: 'rate_limited' as const, target: 1 };
  const fact = { event: '80', tick: '1', kind: 'death' as const, body: 2, name: 'Body', origin: 'native' as const };
  const world = { ...waitingSnapshot(), tick: '1' };
  const carrier: Snapshot = { ...snapshot, tick: '1', decision, actions: [action], playerLifecycle: [fact],
    stop: { reasons: ['player_died'], world } };
  worker.emit({ type: 'status', snapshot: carrier });
  assert.equal(statuses.length, 1); assert.equal(statuses[0]!.decision, undefined);
  assert.equal(statuses[0]!.actions, carrier.actions); assert.equal(statuses[0]!.playerLifecycle, carrier.playerLifecycle);
  assert.equal(statuses[0]!.stop!.world, world); assert.equal(statuses[0]!.tick, '1');
  const replacement = client.createWorld({ seed: '2', config: '{}' });
  worker.emit({ type: 'reply', id: replacement.requestId, ok: true, snapshot: { ...snapshot, worldId: 2 } });
  await replacement.reply;
  worker.emit({ type: 'status', snapshot: carrier });
  assert.equal(statuses.length, 1); client.dispose();
});
