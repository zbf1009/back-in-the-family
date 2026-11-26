import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Snapshot } from '../../src/shared/protocol.ts';
import type { DreamFact, StoryBatch } from '../../src/shared/story.ts';
import { createNotebook } from '../../src/main/life-journal.ts';
import { operationStates } from '../../src/main/operation-state.ts';
import { hasObservation } from '../../src/main/observation-index.ts';
import { reduce, type UiState } from '../../src/main/ui-state.ts';
import { uiFor, waitingSnapshot } from './helpers/view.ts';

function state(): UiState {
  return { ...uiFor(waitingSnapshot()), notebook: createNotebook(1) };
}
function snapshot(ui: UiState): Snapshot {
  return { worldId: ui.worldId, tick: ui.tick, checksum: ui.checksum, tps: ui.tps,
    speed: ui.speed, runState: ui.runState, playerNode: ui.playerNode, actions: [], playerLifecycle: [] };
}
function dream(sequence: string): DreamFact {
  return { eventId: String(100n + BigInt(sequence)), inputSeq: sequence, tick: '500',
    ghost: 10, dreamer: 1, intent: 'reassure', price: '20' };
}
function story(facts: DreamFact[]): StoryBatch {
  return { version: 1, opening: false, actors: [], events: [], chronicle: [], dreams: facts,
    cursors: { events: { start: '0', end: '0' }, chronicle: { start: '0', end: '0' } } };
}
function admit(ui: UiState, id: number, sequence: string, facts: DreamFact[] = []): UiState {
  const request: Request = { type: 'dream', id, dreamer: 1, intent: 'reassure' };
  const sent = reduce(ui, { type: 'request-sent', request, worldId: ui.worldId });
  return reduce(sent, { type: 'reply', request, worldId: ui.worldId,
    message: { type: 'reply', id, ok: true,
      submission: { tick: '500', seqs: [sequence] },
      snapshot: { ...snapshot(sent), story: [{ worldId: ui.worldId, batch: story(facts) }] } } });
}
function deliver(ui: UiState, facts: DreamFact[], worldId = ui.worldId): UiState {
  return reduce(ui, { type: 'status', snapshot: { ...snapshot(ui), worldId,
    story: [{ worldId, batch: story(facts) }] } });
}

test('Dream settlement requires the exact admitted same-world sequence, not another recipient match', () => {
  let ui = admit(state(), 1, '1');
  assert.equal(ui.actions[0]!.phase, 'queued');
  assert.equal(operationStates(ui)[0]!.phase, 'received');
  ui = deliver(ui, [dream('2')]);
  assert.equal(ui.actions[0]!.phase, 'queued');
  assert.equal(operationStates(ui)[0]!.dream, undefined);
  const beforeForeign = ui;
  ui = deliver(ui, [dream('1')], 2);
  assert.equal(ui, beforeForeign);
  ui = deliver(ui, [dream('1')]);
  assert.equal(ui.actions[0]!.phase, 'applied');
  assert.equal(ui.actions[0]!.dream, ui.notebook.dreamsByInputSeq.get('1'));
  assert.equal(hasObservation(ui.settledRequests, '1'), true);
  const projected = operationStates(ui)[0]!;
  assert.equal(projected.phase, 'processed');
  assert.equal(projected.dream?.inputSeq, '1');
  assert.equal(projected.asOf, '500');
  const settled = ui.actions[0];
  ui = deliver(ui, [dream('1')]);
  assert.equal(ui.actions[0], settled, 'duplicate delivery does not settle or replace the receipt again');
  assert.equal(ui.settledOmitted, 0);
});

test('Dream facts preceding or sharing their admission reply settle as soon as the sequence is known', () => {
  for (const sameReply of [false, true]) {
    const fact = dream('1');
    const ui = admit(sameReply ? state() : deliver(state(), [fact]), 1, '1', sameReply ? [fact] : []);
    assert.equal(ui.actions[0]!.phase, 'applied');
    assert.equal(ui.actions[0]!.dream, fact);
    assert.equal(operationStates(ui)[0]!.phase, 'processed');
    assert.equal(ui.decisionSendingRequestId, null);
  }
});

test('Processed Dream receipts share the twenty-terminal cap and survive fatal transport failure', () => {
  let ui = state();
  for (let id = 1; id <= 25; id++) ui = admit(ui, id, String(id), [dream(String(id))]);
  assert.deepEqual(ui.actions.map(action => action.requestId), Array.from({ length: 20 }, (_, index) => index + 6));
  assert.ok(ui.actions.every(action => action.phase === 'applied'));
  assert.equal(ui.settledOmitted, 5);
  assert.equal(ui.notebook.dreams.size, 25, 'receipt cap does not evict original facts');
  const receipts = ui.actions;
  const notebook = ui.notebook;
  for (const type of ['fatal', 'worker-error'] as const) {
    const failed = reduce(ui, { type, error: 'transport failed' });
    assert.deepEqual(failed.actions, receipts);
    assert.equal(failed.notebook, notebook);
    assert.ok(operationStates(failed).every(receipt => receipt.phase === 'processed'));
  }
  const late: Request = { type: 'dream', id: 1, dreamer: 1, intent: 'reassure' };
  const afterLate = reduce(ui, { type: 'reply', request: late, worldId: ui.worldId,
    message: { type: 'reply', id: 1, ok: true, submission: { tick: '500', seqs: ['1'] }, snapshot: snapshot(ui) } });
  assert.deepEqual(afterLate.actions, receipts, 'omitted completed request cannot re-enter via a delayed receipt');
  assert.equal(afterLate.settledOmitted, 5);
});

test('Local validation replaces stale transport classifications without changing the live frame', () => {
  const original = { ...state(), error: 'worker rejected the request', errorKind: 'invalid-state' as const,
    errorOperation: 'step' as const };
  const message = 'Town size must be a whole number from 40 to 60.';
  const validated = reduce(original, { type: 'validation-error', error: message });
  assert.equal(validated.error, message);
  assert.equal(validated.errorKind, 'validation');
  assert.equal(validated.errorOperation, undefined);
  assert.equal(validated.world, original.world);
  assert.equal(validated.tick, original.tick);
  assert.equal(validated.runState, original.runState);
  const failedRead = reduce(validated, { type: 'world-read-start-failed', worldId: validated.worldId,
    tick: validated.tick!, error: 'postMessage failed' });
  assert.equal(failedRead.errorKind, 'sim-error', 'a later transport fault cannot inherit local-validation presentation');
  assert.equal(failedRead.error, 'postMessage failed');
});
