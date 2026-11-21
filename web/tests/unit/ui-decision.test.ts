import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controls, decisionBusy, decisionNotice, initialUiState, nodeOptionsEnabled, reduce, worldSnapshotNeeded } from '../../src/main/ui-state.ts';
import type { UiState } from '../../src/main/ui-state.ts';
import type { DecisionStatus, Reply, Request, Snapshot } from '../../src/shared/protocol.ts';
import { pendingSnapshot, uiFor, waitingSnapshot } from './helpers/view.ts';

function session(patch: Partial<DecisionStatus> = {}): DecisionStatus {
  return { config: 'ready', enabled: true, sessionCap: 40, spent: 1, waitSeconds: 10, pending: null, outcome: null, ...patch };
}
function snapshot(ui: UiState, decision: DecisionStatus): Snapshot {
  return { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum,
    tps: ui.tps, speed: ui.speed, playerNode: ui.playerNode, decision };
}
function held(runState: 'paused' | 'running' = 'paused'): UiState {
  const ui = { ...uiFor(waitingSnapshot()), runState };
  return reduce(ui, { type: 'status', snapshot: snapshot(ui, session({
    pending: { requestId: 12, worldId: 1, tick: ui.tick!, trigger: '61' },
  })) });
}
function reply(ui: UiState, request: Request, decision: DecisionStatus, extra: Partial<Extract<Reply, { ok: true }>> = {}): UiState {
  return reduce(ui, { type: 'reply', request, message: { type: 'reply', id: request.id, ok: true,
    snapshot: snapshot(ui, decision), ...extra } });
}

test('decision diagnostics start absent without pretending config is ready', () => {
  const ui = initialUiState();
  assert.equal(ui.decision, null); assert.equal(decisionBusy(ui), false); assert.equal(decisionNotice(ui), null);
  const next = reply(ui, { type: 'decision-status', id: 1 }, session({ config: 'pending', enabled: false, sessionCap: null, spent: 0 }));
  assert.equal(next.decision?.config, 'pending'); assert.equal(next.decision?.waitSeconds, 10);
  assert.equal(next.runState, 'no-world'); assert.equal(next.world, null);
});

test('paused decision disables competing Run Step and choices but not Create or World reads', () => {
  const ui = held();
  assert.deepEqual(controls(ui), { create: true, run: false, pause: false, step: false });
  assert.equal(decisionBusy(ui), true); assert.equal(ui.runState, 'paused');
  assert.equal(worldSnapshotNeeded({ ...ui, world: null }), true);
  const world = pendingSnapshot('debt_due');
  const choice = { ...uiFor(world), decision: ui.decision, scene: { worldId: 1, tick: world.tick, world, reasons: ['player_node'] as const, entries: [{ kind: 'choice' as const, node: world.player_node!.id }] } };
  assert.equal(nodeOptionsEnabled({ ...choice, scene: { ...choice.scene, reasons: ['player_node'] } }), false);
});

test('running hold retains native Run State while Pause is temporarily unavailable', () => {
  const ui = held('running');
  assert.deepEqual(controls(ui), { create: true, run: false, pause: false, step: false });
  assert.equal(ui.runState, 'running'); assert.equal(ui.scene, null);
});

test('Dream send has a narrow command hold before the pending status without locking Create', () => {
  const ui = reduce(uiFor(waitingSnapshot()), { type: 'request-sent', request: { type: 'dream', id: 0, dreamer: 1, intent: 'warn' } });
  assert.equal(decisionBusy(ui), true); assert.equal(controls(ui).create, true);
  assert.equal(ui.scene, null); assert.equal(ui.underworldRecorded, null);
});

test('future wait remains editable during a hold and preserves the request binding and completed tick', () => {
  const ui = held(); const decision = { ...ui.decision!, waitSeconds: 0 };
  const next = reply(ui, { type: 'set-decision-wait', id: 13, seconds: 0 }, decision);
  assert.equal(next.decision?.waitSeconds, 0); assert.deepEqual(next.decision?.pending, ui.decision?.pending);
  assert.equal(next.tick, ui.tick); assert.equal(next.checksum, ui.checksum); assert.equal(decisionBusy(next), true);
});

test('accepted decision records at the held tick but does not open Dream scene or advance time', () => {
  const ui = held();
  const next = reply(ui, { type: 'dream', id: 12, dreamer: 1, intent: 'warn' }, session({
    outcome: { requestId: 12, worldId: 1, kind: 'model', option: 'heed_warning', usage: { input_tokens: 9, output_tokens: 1 } },
  }), { world: ui.world! });
  assert.equal(decisionBusy(next), false); assert.equal(next.tick, ui.tick); assert.equal(next.scene, null);
  assert.equal(next.underworldRecorded?.tick, ui.tick); assert.equal(controls(next).step, true);
  assert.ok(decisionNotice(next)); assert.doesNotMatch(decisionNotice(next)!, /heed_warning|tokens|quality|personality/i);
});

test('manual rules completion leaves paused playback paused and uses only a fixed outcome notice', () => {
  const ui = held();
  const next = reply(ui, { type: 'dream', id: 12, dreamer: 1, intent: 'warn' }, session({
    outcome: { requestId: 12, worldId: 1, kind: 'fallback', reason: 'manual' },
  }));
  assert.equal(next.runState, 'paused'); assert.equal(next.tick, ui.tick); assert.equal(decisionBusy(next), false);
  assert.ok(decisionNotice(next)); assert.equal(controls(next).run, true);
});

test('completed request cannot be resurrected by a stale pending status', () => {
  const ui = held();
  const done = reply(ui, { type: 'dream', id: 12, dreamer: 1, intent: 'warn' }, session({
    outcome: { requestId: 12, worldId: 1, kind: 'fallback', reason: 'timeout' },
  }));
  assert.strictEqual(reduce(done, { type: 'status', snapshot: snapshot(ui, ui.decision!) }), done);
});

test('older outcome and read reply cannot overwrite a newer same-tick decision', () => {
  const ui = held();
  const newer = reduce(ui, { type: 'status', snapshot: snapshot(ui, session({
    pending: { requestId: 20, worldId: 1, tick: ui.tick!, trigger: '63' }, spent: 2,
  })) });
  const old = session({ outcome: { requestId: 12, worldId: 1, kind: 'fallback', reason: 'manual' } });
  assert.strictEqual(reply(newer, { type: 'dream', id: 12, dreamer: 1, intent: 'warn' }, old), newer);
  const read = reply(newer, { type: 'world-snapshot', id: 13 }, old, { world: waitingSnapshot() });
  assert.deepEqual(read.decision, newer.decision); assert.equal(read.tick, newer.tick);
  assert.strictEqual(reduce(newer, { type: 'status', snapshot: snapshot(ui, old) }), newer);
});

test('World replacement clears outcome and hold but retains worker-owned wait cap and spent', () => {
  const ui = held();
  const fresh: Snapshot = { ...snapshot(ui, session({ waitSeconds: 2, sessionCap: 1, spent: 1 })), worldId: 2, tick: '0', checksum: null };
  const next = reduce(ui, { type: 'reply', request: { type: 'create-world', id: 13, seed: '2', config: '{}' },
    message: { type: 'reply', id: 13, ok: true, snapshot: fresh } });
  assert.equal(next.worldId, 2); assert.equal(next.decision?.waitSeconds, 2); assert.equal(next.decision?.spent, 1);
  assert.equal(next.decision?.sessionCap, 1); assert.equal(decisionBusy(next), false); assert.equal(decisionNotice(next), null);
  assert.strictEqual(reduce(next, { type: 'status', snapshot: snapshot(ui, ui.decision!) }), next);
  assert.strictEqual(reply(next, { type: 'dream', id: 12, dreamer: 1, intent: 'warn' }, ui.decision!, { snapshot: snapshot(ui, ui.decision!) }), next);
});

test('typed Dream preview rejection never displays arbitrary error text or records a Dream', () => {
  for (const previewError of [{ kind: 'no_node' }, { kind: 'malformed' }, { kind: 'rejected', reason: 'provider secret' }] as const) {
    const ui = held();
    const next = reduce(ui, { type: 'reply', request: { type: 'dream', id: 12, dreamer: 1, intent: 'warn' },
      message: { type: 'reply', id: 12, ok: false, kind: 'preview-error', error: 'provider secret', previewError,
        snapshot: snapshot(ui, session()) } });
    assert.ok(next.error); assert.doesNotMatch(next.error!, /provider secret/);
    assert.equal(next.tick, ui.tick); assert.equal(next.underworldRecorded, null); assert.equal(next.scene, null);
  }
});

test('worker failure releases only UI decision hold without inventing another pause reason', () => {
  const next = reduce(held(), { type: 'worker-error', error: 'worker stopped' });
  assert.equal(next.runState, 'failed'); assert.equal(decisionBusy(next), false); assert.equal(controls(next).create, false);
});

test('terminal Dream failure without an outcome releases the current hold and hides the older notice', () => {
  const ui = held();
  const next = reduce(ui, { type: 'reply', request: { type: 'dream', id: 12, dreamer: 1, intent: 'warn' },
    message: { type: 'reply', id: 12, ok: false, kind: 'invalid-state', error: 'private detail', snapshot: snapshot(ui, session()) } });
  assert.equal(decisionBusy(next), false); assert.equal(decisionNotice(next), null); assert.ok(next.error);
  assert.equal(next.tick, ui.tick); assert.equal(next.decisionRequestId, 12);
});
