// Feature: first-playable, Property 25: Scene order and scene actions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import type { PauseReason, Request, Snapshot } from '../../src/shared/protocol.ts';
import type { PlayerFamily, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { sceneQueue } from '../../src/main/scene-queue.ts';
import { controls, nodeOptionsEnabled, reduce, type UiState } from '../../src/main/ui-state.ts';
import { underworldView } from '../../src/main/view-model.ts';
import { pendingSnapshot, snapshot, uiFor, waitingSnapshot } from './helpers/view.ts';

const RUNS = 1000;
function status(ui: UiState): Snapshot {
  return { worldId: ui.worldId, runState: ui.runState, tick: ui.tick, checksum: ui.checksum, tps: ui.tps, speed: ui.speed, playerNode: ui.playerNode };
}
function stop(world: WorldSnapshot, reasons: PauseReason[]): UiState {
  const ui = uiFor(world);
  return reduce(ui, { type: 'status', snapshot: { ...status(ui), stop: { reasons, world } } });
}

test('Property 25: stop order and accepted actions keep one current entry without advancing', () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.constantFrom<PauseReason>('player_died', 'dream_resolved', 'player_reborn', 'player_node'), { maxLength: 4 }),
    fc.option(fc.constantFrom<PlayerFamily>('family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'), { nil: null }),
    fc.array(fc.constantFrom('close', 'accept', 'reject'), { maxLength: 20 }),
    (reasons, family, actions) => {
      const world = family === null ? snapshot : pendingSnapshot(family);
      const expected = [
        ...(reasons.includes('player_died') ? [{ kind: 'funeral', node: null }] : []),
        ...(reasons.includes('dream_resolved') ? [{ kind: 'dream', node: null }] : []),
        ...(reasons.includes('player_reborn') ? [{ kind: 'birth', node: null }] : []),
        ...(family === null ? [] : [{ kind: family === 'family_death' ? 'funeral' : family === 'inheritance' ? 'inheritance' : 'choice', node: '12' }]),
      ];
      assert.deepEqual(sceneQueue(reasons, world), expected);
      let ui = stop(world, reasons);
      let left = expected.slice();
      let answered = false;
      const requests: Request[] = [];
      for (const action of actions) {
        assert.deepEqual(ui.scene?.entries ?? [], left);
        assert.equal(nodeOptionsEnabled(ui), left[0]?.node === '12' && !answered);
        assert.deepEqual(controls(ui), controls({ ...ui, scene: null }), 'an overlay changes no Run/Step enablement');
        const before = ui;
        if (action === 'close') {
          ui = reduce(ui, { type: 'scene-close' });
          if (left[0]?.node === null) left.shift();
        } else if (nodeOptionsEnabled(ui)) {
          const request: Request = { type: 'choose', id: requests.length + 1, node: '12', option: world.player_node!.options[0]!.id };
          requests.push(request);
          ui = reduce(ui, { type: 'reply', request, message: action === 'accept'
            ? { type: 'reply', id: request.id, ok: true, world, snapshot: { ...status(ui), playerNode: { pending: true, node: '12', answered: true } } }
            : { type: 'reply', id: request.id, ok: false, kind: 'rejected', error: 'option_not_in_set', snapshot: status(ui) } });
          if (action === 'accept') { left.shift(); answered = true; }
          else assert.equal(ui.scene, before.scene);
        }
        assert.equal(ui.tick, '500');
        assert.equal(ui.world, world);
      }
      assert.deepEqual(ui.scene?.entries ?? [], left);
      assert.ok(requests.every(request => request.type === 'choose'));
    }), { numRuns: RUNS });
});

test('R10.12: Run with a dream overlay open expires it on a later tick, not the Run reply', () => {
  const world = { ...snapshot, last_dream: { tick: '499', dreamer: 1, applied: 'heed_warning' as const } };
  let ui = stop(world, ['dream_resolved']);
  ui = reduce(ui, { type: 'reply', request: { type: 'run', id: 1 }, message: { type: 'reply', id: 1, ok: true, snapshot: { ...status(ui), runState: 'running' } } });
  assert.equal(ui.scene?.entries[0]!.kind, 'dream');
  ui = reduce(ui, { type: 'status', snapshot: { ...status(ui), tick: '501' } });
  assert.equal(ui.scene, null);
});

test('R10.12: a Step stop status replaces the queue before its reply without clearing the new stop', () => {
  let ui = stop(snapshot, ['player_reborn']);
  const world = { ...pendingSnapshot('inheritance'), tick: '501' };
  const stopped: Snapshot = { ...status(ui), tick: '501', playerNode: { pending: true, node: '12', answered: false } };
  ui = reduce(ui, { type: 'status', snapshot: { ...stopped, stop: { reasons: ['player_node'], world } } });
  const queue = ui.scene;
  ui = reduce(ui, { type: 'reply', request: { type: 'step', id: 1 }, message: { type: 'reply', id: 1, ok: true, snapshot: stopped } });
  assert.equal(ui.scene, queue);
  assert.equal(ui.scene!.entries[0]!.kind, 'inheritance');
  assert.equal(nodeOptionsEnabled(ui), true);
});

test('R10.12/R11.13: an accepted Dream fallback records with the funeral open and no control disablement', () => {
  const world = waitingSnapshot(5);
  let ui = stop(world, ['player_died']);
  const before = underworldView(ui);
  const queue = ui.scene;
  const enabled = controls(ui);
  assert.equal(enabled.run, true);
  assert.equal(enabled.step, true);
  const request: Request = { type: 'dream', id: 1, dreamer: 1, intent: 'warn' };
  const outcome = { requestId: request.id, worldId: ui.worldId, kind: 'fallback' as const, reason: 'rate_limited' as const };
  ui = reduce(ui, { type: 'request-sent', request });
  ui = reduce(ui, { type: 'reply', request, message: { type: 'reply', id: request.id, ok: true, world,
    snapshot: { ...status(ui), decision: { config: 'ready', enabled: true, sessionCap: 40, spent: 1,
      waitSeconds: 10, pending: null, outcome } } } });
  assert.strictEqual(ui.scene, queue);
  assert.equal(ui.scene?.entries[0]!.kind, 'funeral');
  assert.deepEqual(underworldView(ui), before);
  assert.deepEqual(ui.underworldRecorded, { worldId: 1, tick: '500' });
  assert.deepEqual(ui.decision?.outcome, outcome);
  assert.equal(ui.error, null);
  assert.equal(ui.tick, '500');
  assert.equal(ui.runState, 'paused');
  assert.deepEqual(controls(ui), enabled);
  ui = reduce(ui, { type: 'status', snapshot: { ...status(ui), tick: '501', runState: 'running' } });
  assert.equal(ui.scene, null);
  assert.equal(ui.underworldRecorded, null);
});

test('R10.9/R11.9: same-tick rebirth and death retain the waiting panel and ordered causes', () => {
  const ui = stop(waitingSnapshot(), ['player_died', 'player_reborn']);
  assert.deepEqual(ui.scene!.entries.map(entry => entry.kind), ['funeral', 'birth']);
  assert.ok(underworldView(ui));
});

test('R10.12: creating another World drops the remaining scene queue', () => {
  let ui = stop(snapshot, ['player_reborn']);
  ui = reduce(ui, { type: 'reply', request: { type: 'create-world', id: 1, seed: '2', config: '{}' }, message: {
    type: 'reply', id: 1, ok: true, snapshot: { ...status(ui), worldId: 2, tick: '0' },
  } });
  assert.equal(ui.scene, null);
});
