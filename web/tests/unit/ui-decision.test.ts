import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controls, currentDecision, decisionBusy, decisionNotice, initialUiState, reduce, worldSnapshotNeeded } from '../../src/main/ui-state.ts';
import type { UiState } from '../../src/main/ui-state.ts';
import { sceneQueue } from '../../src/main/scene-queue.ts';
import type { DecisionStatus, Reply, Request, Snapshot } from '../../src/shared/protocol.ts';
import { pendingSnapshot, uiFor, waitingSnapshot } from './helpers/view.ts';
import { transportText } from '../../src/main/player-copy.ts';

function session(patch: Partial<DecisionStatus> = {}): DecisionStatus {
  return { config: 'ready', enabled: true, sessionCap: 40, spent: 1, waitSeconds: 10, pending: null, outcome: null, ...patch };
}
function snapshot(ui: UiState, decision: DecisionStatus): Snapshot {
  return { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum,
    tps: ui.tps, speed: ui.speed, actions: [], playerLifecycle: [], playerNode: ui.playerNode, decision };
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
  const choice = { ...uiFor(world), decision: ui.decision, scene: { worldId: 1, tick: world.tick, world, reasons: ['player_node'] as const,
    entries: sceneQueue(['player_node'], world, 1, []) } };
  assert.equal(currentDecision({ ...choice, scene: { ...choice.scene, reasons: ['player_node'] } }) !== null, false);
});

test('running hold retains native Run State while Pause is temporarily unavailable', () => {
  const ui = held('running');
  assert.deepEqual(controls(ui), { create: true, run: false, pause: false, step: false });
  assert.equal(ui.runState, 'running'); assert.equal(ui.scene, null);
});

test('Dream send has a narrow command hold before the pending status without locking Create', () => {
  const ui = reduce(uiFor(waitingSnapshot()), { type: 'request-sent', request: { type: 'dream', id: 1, dreamer: 1, intent: 'warn' } });
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
  const observed = reduce(done, { type: 'status', snapshot: snapshot(ui, ui.decision!) });
  assert.deepEqual(observed.decision, done.decision); assert.equal(decisionBusy(observed), false);
  assert.equal(observed.tick, done.tick); assert.equal(observed.world, done.world);
});

test('older outcome and read reply cannot overwrite a newer same-tick decision', () => {
  const ui = held();
  const newer = reduce(ui, { type: 'status', snapshot: snapshot(ui, session({
    pending: { requestId: 20, worldId: 1, tick: ui.tick!, trigger: '63' }, spent: 2,
  })) });
  const old = session({ outcome: { requestId: 12, worldId: 1, kind: 'fallback', reason: 'manual' } });
  const delayed = reply(newer, { type: 'dream', id: 12, dreamer: 1, intent: 'warn' }, old);
  assert.deepEqual(delayed.decision, newer.decision); assert.equal(delayed.tick, newer.tick);
  assert.equal(delayed.underworldRecorded, newer.underworldRecorded);
  const read = reply(newer, { type: 'world-snapshot', id: 13 }, old, { world: waitingSnapshot() });
  assert.deepEqual(read.decision, newer.decision); assert.equal(read.tick, newer.tick);
  const observed = reduce(newer, { type: 'status', snapshot: snapshot(ui, old) });
  assert.deepEqual(observed.decision, newer.decision); assert.equal(observed.tick, newer.tick);
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

test('typed Dream preview rejection keeps technical diagnostics separate from player copy and records no Dream', () => {
  for (const previewError of [{ kind: 'no_node' }, { kind: 'malformed' }, { kind: 'rejected', reason: 'provider secret' }] as const) {
    const ui = held();
    const next = reduce(ui, { type: 'reply', request: { type: 'dream', id: 12, dreamer: 1, intent: 'warn' },
      message: { type: 'reply', id: 12, ok: false, kind: 'preview-error', error: 'provider secret', previewError,
        snapshot: snapshot(ui, session()) } });
    assert.equal(next.error, 'provider secret', 'the technical diagnostic retains the actual failure');
    assert.equal(next.errorKind, 'preview-error');
    assert.equal(next.errorOperation, 'dream');
    const playerError = transportText(next.errorKind!, next.error ?? undefined, next.errorOperation);
    assert.ok(playerError.trim());
    assert.doesNotMatch(playerError, /provider secret|private detail/);
    assert.equal(next.actions[0]!.error, next.error);
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

for (const priorOutcome of [false, true]) {
  test(`rejected Dream ${priorOutcome ? 'with prior outcome' : 'without prior outcome'} keeps Run Pause Step and reads synchronized`, () => {
    let ui: UiState = { ...uiFor(waitingSnapshot()), checksum: '1111111111111111' };
    if (priorOutcome) {
      ui = reply(ui, { type: 'dream', id: 12, dreamer: 1, intent: 'warn' }, session({
        outcome: { requestId: 12, worldId: 1, kind: 'model', option: 'heed_warning', usage: null },
      }), { world: ui.world! });
      assert.equal(ui.decision?.outcome?.kind, 'model');
      ui = reply(ui, { type: 'step', id: 13 }, ui.decision!, {
        snapshot: { ...snapshot(ui, ui.decision!), tick: '501', checksum: '2222222222222222' },
        world: { ...ui.world!, tick: '501' },
      });
    } else {
      ui = reply(ui, { type: 'decision-status', id: 12 }, session({ spent: 0 }));
    }
    const before = ui;
    const retained = ui.decision!;
    const dream: Request = { type: 'dream', id: 20, dreamer: 1, intent: 'warn' };
    const sending = reduce(ui, { type: 'request-sent', request: dream });
    assert.equal(decisionBusy(sending), true);
    const failed: Extract<Reply, { ok: false }> = { type: 'reply', id: 20, ok: false,
      kind: 'rejected', error: 'private detail', previewError: { kind: 'rejected', reason: 'insufficient_joss' },
      snapshot: snapshot(before, retained) };
    ui = reduce(sending, { type: 'reply', request: dream, message: failed });
    assert.equal(ui.error, failed.error, 'technical diagnostics preserve the raw rejection');
    assert.equal(ui.errorKind, failed.kind);
    assert.equal(ui.errorOperation, dream.type);
    const playerError = transportText(ui.errorKind!, ui.error ?? undefined, ui.errorOperation);
    assert.ok(playerError.trim());
    assert.doesNotMatch(playerError, /provider secret|private detail/);
    assert.deepEqual(ui.world, before.world);
    assert.equal(ui.tick, before.tick); assert.equal(ui.checksum, before.checksum);
    assert.deepEqual(ui.decision, retained); assert.equal(ui.decisionRequestId, 20);
    assert.equal(decisionBusy(ui), false); assert.equal(decisionNotice(ui), null);
    assert.equal(ui.underworldRecorded, null); assert.equal(ui.scene, null);
    assert.equal(controls(ui).run, true); assert.equal(controls(ui).step, true);

    // An unchanged retained carrier is not permission to adopt an older reply.
    const oldRead = reply(ui, { type: 'world-snapshot', id: 13 }, retained, {
      snapshot: { ...snapshot(before, retained), tick: '499', checksum: 'aaaaaaaaaaaaaaaa' },
      world: { ...before.world!, tick: '499' },
    });
    assert.equal(oldRead.tick, ui.tick); assert.equal(oldRead.checksum, ui.checksum);
    assert.equal(oldRead.error, ui.error); assert.deepEqual(oldRead.decision, retained);
    const duplicate = reduce(ui, { type: 'reply', request: dream,
      message: { type: 'reply', id: 20, ok: true, snapshot: failed.snapshot } });
    assert.deepEqual(duplicate.decision, ui.decision); assert.equal(duplicate.error, ui.error);
    assert.equal(duplicate.actions.find(action => action.requestId === dream.id)?.phase, 'rejected');
    for (const decision of [
      { ...retained, pending: { requestId: 20, worldId: 1, tick: ui.tick!, trigger: '63' } },
      { ...retained, outcome: { requestId: 20, worldId: 1, kind: 'fallback' as const, reason: 'manual' as const } },
      { ...retained, outcome: { requestId: 10, worldId: 1, kind: 'fallback' as const, reason: 'manual' as const } },
      ...(priorOutcome ? [{ ...retained, pending: { requestId: 12, worldId: 1, tick: ui.tick!, trigger: '61' } }] : []),
    ]) {
      const observed = reduce(ui, { type: 'status', snapshot: snapshot(before, decision) });
      assert.deepEqual(observed.decision, ui.decision); assert.equal(observed.tick, ui.tick);
      assert.equal(observed.error, ui.error); assert.equal(decisionBusy(observed), false);
    }
    ui = reduce(ui, { type: 'status', snapshot: snapshot(before, retained) });
    assert.equal(ui.error, failed.error);

    const runSnapshot: Snapshot = { ...snapshot(before, retained), runState: 'running' };
    ui = reduce(ui, { type: 'request-sent', request: { type: 'run', id: 21 } });
    ui = reply(ui, { type: 'run', id: 21 }, retained, { snapshot: runSnapshot });
    assert.equal(ui.runState, runSnapshot.runState); assert.equal(ui.tick, runSnapshot.tick);
    assert.equal(ui.checksum, runSnapshot.checksum); assert.equal(ui.error, null);
    assert.equal(controls(ui).pause, true); assert.equal(controls(ui).run, false);
    const runningSnapshot: Snapshot = { ...runSnapshot, tick: '502', checksum: '3333333333333333', tps: 30 };
    ui = reduce(ui, { type: 'status', snapshot: runningSnapshot });
    assert.equal(ui.runState, runningSnapshot.runState); assert.equal(ui.tick, runningSnapshot.tick);
    assert.equal(ui.checksum, runningSnapshot.checksum); assert.equal(ui.tps, runningSnapshot.tps);
    const pauseSnapshot: Snapshot = { ...runningSnapshot, runState: 'paused', tick: '503', checksum: '4444444444444444' };
    ui = reply(ui, { type: 'pause', id: 22 }, retained, { snapshot: pauseSnapshot });
    assert.equal(ui.runState, pauseSnapshot.runState); assert.equal(ui.tick, pauseSnapshot.tick);
    assert.equal(ui.checksum, pauseSnapshot.checksum); assert.equal(controls(ui).step, true);
    const stepSnapshot: Snapshot = { ...pauseSnapshot, tick: '504', checksum: '5555555555555555' };
    ui = reduce(ui, { type: 'request-sent', request: { type: 'step', id: 23 } });
    assert.equal(controls(ui).step, false);
    ui = reply(ui, { type: 'step', id: 23 }, retained, { snapshot: stepSnapshot });
    assert.equal(ui.runState, stepSnapshot.runState); assert.equal(ui.tick, stepSnapshot.tick);
    assert.equal(ui.checksum, stepSnapshot.checksum); assert.equal(controls(ui).step, true);
    ui = reduce(ui, { type: 'request-sent', request: { type: 'world-snapshot', id: 24 } });
    const completedWorld = { ...before.world!, tick: stepSnapshot.tick! };
    ui = reply(ui, { type: 'world-snapshot', id: 24 }, retained, { snapshot: stepSnapshot, world: completedWorld });
    assert.deepEqual(ui.world, completedWorld); assert.equal(ui.worldRead, null);
    ui = reduce(ui, { type: 'status', snapshot: stepSnapshot });
    assert.equal(ui.tick, stepSnapshot.tick); assert.equal(ui.checksum, stepSnapshot.checksum);
    assert.deepEqual(ui.decision, retained); assert.equal(decisionNotice(ui), null);
    assert.equal(ui.underworldRecorded, null); assert.equal(ui.scene, null);

    const newer = reduce(ui, { type: 'status', snapshot: { ...stepSnapshot, decision: {
      ...retained, pending: { requestId: 25, worldId: 1, tick: ui.tick!, trigger: '65' },
    } } });
    assert.equal(decisionBusy(newer), true); assert.equal(controls(newer).run, false);
    const delayed = reduce(newer, { type: 'reply', request: dream, message: failed });
    assert.deepEqual(delayed.decision, newer.decision); assert.equal(delayed.tick, newer.tick);
    assert.equal(delayed.error, newer.error);
    const observed = reduce(newer, { type: 'status', snapshot: stepSnapshot });
    assert.deepEqual(observed.decision, newer.decision); assert.equal(decisionBusy(observed), true);
    const fresh = { ...stepSnapshot, worldId: 2, tick: '0', checksum: null, decision: { ...retained, pending: null, outcome: null } };
    const replaced = reply(newer, { type: 'create-world', id: 30, seed: '2', config: '{}' }, fresh.decision, { snapshot: fresh });
    assert.equal(replaced.worldId, 2); assert.equal(replaced.tick, '0'); assert.equal(replaced.checksum, null);
    assert.equal(decisionBusy(replaced), false); assert.equal(decisionNotice(replaced), null);
    assert.strictEqual(reduce(replaced, { type: 'reply', request: dream, message: failed }), replaced);
    assert.strictEqual(reduce(replaced, { type: 'status', snapshot: stepSnapshot }), replaced);
  });
}

test('LV-C2: stale decision subtrees preserve older same-world facts without rolling back the live World', () => {
  const world = pendingSnapshot('debt_due');
  let ui = uiFor(world);
  const terminal = session({ outcome: { requestId: 30, worldId: 1, kind: 'fallback', reason: 'manual' } });
  ui = reduce(ui, { type: 'status', snapshot: snapshot(ui, terminal) });
  const retainedDecision = ui.decision;
  const old = session({ pending: { requestId: 10, worldId: 1, tick: '499', trigger: '60' } });
  const action = { worldId: 1, requestId: null, input_seq: '70', tick: '499', kind: 'haunt' as const,
    state: 'rejected' as const, reason: 'rate_limited' as const, target: 1 };
  const fact = { event: '80', tick: '499', kind: 'death' as const, body: 20, name: 'Earlier Body', origin: 'native' as const };
  const carrier: Snapshot = { ...snapshot(ui, old), tick: '499', checksum: 'aaaaaaaaaaaaaaaa', actions: [action], playerLifecycle: [fact],
    stop: { reasons: ['player_died'], world: { ...world, tick: '499' } } };
  ui = reduce(ui, { type: 'status', snapshot: carrier });
  assert.equal(ui.world, world); assert.equal(ui.tick, '500'); assert.equal(ui.decision, retainedDecision);
  assert.deepEqual(ui.actions.map(row => row.result), [action]); assert.deepEqual(ui.playerLifecycle, [fact]);
  const read: Request = { type: 'world-snapshot', id: 40 };
  ui = reduce(ui, { type: 'reply', request: read, worldId: 1, message: {
    type: 'reply', id: 40, ok: true, snapshot: carrier, world: carrier.stop!.world,
  } });
  assert.equal(ui.world, world); assert.equal(ui.tick, '500'); assert.equal(ui.actions.length, 1);
  assert.equal(ui.playerLifecycle.length, 1); assert.equal(currentDecision(ui) !== null, true);
  const before = ui;
  ui = reduce(ui, { type: 'status', snapshot: { ...carrier, worldId: 0,
    actions: [{ ...action, worldId: 0, input_seq: '71' }], playerLifecycle: [{ ...fact, event: '81' }] } });
  assert.equal(ui, before);
});

test('LV-C2: a fresh live stop with a stale decision subtree still adopts its World and observations', () => {
  let ui = uiFor(pendingSnapshot('inheritance'));
  const terminal = session({ outcome: { requestId: 30, worldId: 1, kind: 'fallback', reason: 'manual' } });
  ui = reduce(ui, { type: 'status', snapshot: snapshot(ui, terminal) });
  const retainedDecision = ui.decision;
  const world = { ...waitingSnapshot(), tick: '501' };
  const fact = { event: '90', tick: '501', kind: 'death' as const, body: 20, name: 'Body', origin: 'native' as const };
  ui = reduce(ui, { type: 'status', snapshot: { ...snapshot(ui, session({
    pending: { requestId: 10, worldId: 1, tick: '499', trigger: '60' },
  })), tick: '501', playerNode: { pending: false }, playerLifecycle: [fact],
    stop: { reasons: ['player_died'], world } } });
  assert.equal(ui.tick, '501'); assert.equal(ui.world, world); assert.equal(ui.world!.player.place, 'waiting');
  assert.equal(ui.decision, retainedDecision); assert.deepEqual(ui.playerLifecycle, [fact]);
  assert.equal(ui.scene!.entries[0]!.kind, 'funeral'); assert.equal(currentDecision(ui) !== null, false);
});

test('LV-C2: stale Dream admission can enrich retained terminal metadata but cannot revive evicted requests or a newer hold', () => {
  let ui = uiFor(waitingSnapshot());
  for (let id = 1; id <= 25; id++) {
    const request: Request = { type: 'dream', id, dreamer: 1, intent: 'warn' };
    ui = reduce(ui, { type: 'request-sent', request, worldId: 1 });
    ui = reduce(ui, { type: 'reply', request, worldId: 1, message: { type: 'reply', id, ok: false,
      kind: id === 25 ? 'cancelled' : 'rejected', error: 'not recorded', snapshot: snapshot(ui, session()) } });
  }
  assert.equal(ui.actions.length, 20); assert.equal(ui.settledOmitted, 5);
  const holdRequest: Request = { type: 'bribe', id: 30, amount: '1' };
  ui = reduce(ui, { type: 'request-sent', request: holdRequest, worldId: 1 });
  ui = reduce(ui, { type: 'status', snapshot: snapshot(ui, session({
    pending: { requestId: 30, worldId: 1, tick: ui.tick!, trigger: '90' },
  })) });
  const retained = ui;
  for (const id of [1, 25]) {
    const request: Request = { type: 'dream', id, dreamer: 1, intent: 'warn' };
    ui = reduce(ui, { type: 'reply', request, worldId: 1, message: { type: 'reply', id, ok: true,
      snapshot: snapshot(ui, session({ outcome: { requestId: id, worldId: 1, kind: 'fallback', reason: 'manual' } })),
      submission: { tick: ui.tick!, seqs: [String(id)] } } });
  }
  assert.equal(ui.actions.length, 21); assert.equal(ui.settledOmitted, 5);
  assert.equal(ui.actions.some(row => row.requestId === 1), false);
  const terminal = ui.actions.find(row => row.requestId === 25)!;
  assert.equal(terminal.phase, 'cancelled'); assert.deepEqual(terminal.submission, { tick: ui.tick!, seqs: ['25'] });
  assert.equal(ui.decision, retained.decision); assert.equal(ui.decisionSendingRequestId, 30);
  assert.equal(decisionBusy(ui), true); assert.equal(ui.error, retained.error); assert.equal(ui.world, retained.world);
  assert.equal(retained.actions.find(row => row.requestId === 25)!.submission, null);
});
