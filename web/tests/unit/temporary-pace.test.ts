import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionTemporaryPace, type PaceEvent } from '../../src/main/temporary-pace.ts';
import { DEFAULT_SPEED, FAST_FORWARD_SPEED, SPEEDS } from '../../src/shared/speeds.ts';

test('each ordinary pace remains owed until its same-world restoration acknowledgement', () => {
  for (const speed of SPEEDS) {
    const begun = transitionTemporaryPace(null, 4, speed, { kind: 'begin', worldId: 4 });
    assert.equal(begun.speed, FAST_FORWARD_SPEED);
    for (const kind of ['stop', 'pause', 'cancel', 'error'] as const) {
      const stopped = transitionTemporaryPace(begun.fastForward, 4, begun.speed, { kind, worldId: 4 });
      assert.equal(stopped.fastForward?.phase, 'stopping');
      assert.equal(stopped.fastForward?.previousSpeed, speed);
      const restoring = transitionTemporaryPace(stopped.fastForward, 4, begun.speed, { kind: 'restore', worldId: 4 });
      assert.equal(restoring.speed, speed);
      const sent = transitionTemporaryPace(restoring.fastForward, 4, begun.speed, { kind: 'request-sent', worldId: 4, requestId: 12 });
      assert.notEqual(sent.fastForward, null);
      assert.deepEqual(transitionTemporaryPace(sent.fastForward, 4, begun.speed, { kind: 'accepted', worldId: 4, requestId: 11 }), sent);
      assert.deepEqual(transitionTemporaryPace(sent.fastForward, 4, speed, { kind: 'accepted', worldId: 4, requestId: 12 }), { fastForward: null, speed });
    }
  }
});

test('repeated begin preserves original pace and cannot interrupt restoration', () => {
  const begun = transitionTemporaryPace(null, 8, DEFAULT_SPEED, { kind: 'begin', worldId: 8 });
  const stopping = transitionTemporaryPace(begun.fastForward, 8, begun.speed, { kind: 'stop', worldId: 8 });
  for (const state of [begun, stopping]) {
    const repeated = transitionTemporaryPace(state.fastForward, 8, state.speed, { kind: 'begin', worldId: 8 });
    assert.deepEqual(repeated, state);
    assert.strictEqual(repeated.fastForward, state.fastForward);
  }
});

test('manual selection retains the saved pace until its own ACK, and rejection restores the original', () => {
  const begun = transitionTemporaryPace(null, 8, DEFAULT_SPEED, { kind: 'begin', worldId: 8 });
  const selected = transitionTemporaryPace(begun.fastForward, 8, begun.speed, { kind: 'select', worldId: 8, speed: 7 });
  assert.equal(selected.fastForward?.phase, 'selecting');
  assert.equal(selected.fastForward?.previousSpeed, DEFAULT_SPEED);
  const sent = transitionTemporaryPace(selected.fastForward, 8, begun.speed, { kind: 'request-sent', worldId: 8, requestId: 20 });
  assert.deepEqual(transitionTemporaryPace(sent.fastForward, 8, 7, { kind: 'accepted', worldId: 8, requestId: 20 }), { fastForward: null, speed: 7 });
  const failed = transitionTemporaryPace(sent.fastForward, 8, begun.speed, { kind: 'error', worldId: 8 });
  assert.equal(failed.speed, DEFAULT_SPEED);
  assert.equal(failed.fastForward?.phase, 'stopping');
});

test('Pause acknowledgement advances recovery but does not settle the saved speed', () => {
  const begun = transitionTemporaryPace(null, 4, 7, { kind: 'begin', worldId: 4 });
  const stopped = transitionTemporaryPace(begun.fastForward, 4, begun.speed, { kind: 'error', worldId: 4 });
  const sent = transitionTemporaryPace(stopped.fastForward, 4, begun.speed, { kind: 'request-sent', worldId: 4, requestId: 10 });
  const paused = transitionTemporaryPace(sent.fastForward, 4, begun.speed, { kind: 'accepted', worldId: 4, requestId: 10 });
  assert.equal(paused.fastForward?.phase, 'restoring');
  assert.equal(paused.fastForward?.requestId, null);
  assert.equal(paused.speed, 7);
});

test('failed Create preserves restoration; new World and stale callbacks are epoch-bound', () => {
  const begun = transitionTemporaryPace(null, 5, DEFAULT_SPEED, { kind: 'begin', worldId: 5 });
  const stopping = transitionTemporaryPace(begun.fastForward, 5, begun.speed, { kind: 'stop', worldId: 5 });
  assert.deepEqual(transitionTemporaryPace(stopping.fastForward, 5, stopping.speed, { kind: 'create-failed', worldId: 5 }), stopping);
  const stale: PaceEvent[] = [
    ...(['begin', 'stop', 'error', 'pause', 'cancel', 'create-failed', 'world-created', 'restore'] as const).map(kind => ({ kind, worldId: 4 })),
    { kind: 'select', speed: 90, worldId: 4 },
    { kind: 'accepted', requestId: 1, worldId: 4 },
    { kind: 'request-sent', requestId: 1, worldId: 4 },
  ];
  for (const event of stale) assert.deepEqual(transitionTemporaryPace(stopping.fastForward, 5, stopping.speed, event), stopping);
  assert.deepEqual(transitionTemporaryPace(stopping.fastForward, 6, stopping.speed, { kind: 'world-created', worldId: 6 }), { fastForward: null, speed: DEFAULT_SPEED });
});
