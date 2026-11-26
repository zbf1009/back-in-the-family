import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionTemporaryPace, type PaceEvent } from '../../src/main/temporary-pace.ts';
import { DEFAULT_SPEED, FAST_FORWARD_SPEED, SPEEDS } from '../../src/shared/speeds.ts';

test('every ordinary pace restores at the first same-world stop, pause, cancellation or error', () => {
  for (const speed of SPEEDS) {
    const begun = transitionTemporaryPace(null, 4, speed, { kind: 'begin', worldId: 4 });
    assert.equal(begun.speed, FAST_FORWARD_SPEED);
    assert.deepEqual(begun.fastForward, { worldId: 4, previousSpeed: speed });
    for (const kind of ['stop', 'pause', 'cancel', 'error'] as const) {
      const stopped = transitionTemporaryPace(begun.fastForward, 4, begun.speed, { kind, worldId: 4 });
      assert.deepEqual(stopped, { fastForward: null, speed });
      assert.deepEqual(transitionTemporaryPace(null, 4, speed, { kind, worldId: 4 }), stopped);
    }
  }
});

test('repeated fast-forward preserves the original pace, and explicit selection wins thereafter', () => {
  const begun = transitionTemporaryPace(null, 8, DEFAULT_SPEED, { kind: 'begin', worldId: 8 });
  const repeated = transitionTemporaryPace(begun.fastForward, 8, begun.speed, { kind: 'begin', worldId: 8 });
  assert.deepEqual(repeated, begun);
  assert.strictEqual(repeated.fastForward, begun.fastForward);
  for (const speed of SPEEDS) {
    const selected = transitionTemporaryPace(begun.fastForward, 8, begun.speed, { kind: 'select', worldId: 8, speed });
    assert.deepEqual(selected, { fastForward: null, speed });
    assert.deepEqual(transitionTemporaryPace(selected.fastForward, 8, selected.speed, { kind: 'stop', worldId: 8 }), selected);
  }
});

test('failed Create preserves the current temporary pace; successful new World discards it', () => {
  const begun = transitionTemporaryPace(null, 2, 7, { kind: 'begin', worldId: 2 });
  const failed = transitionTemporaryPace(begun.fastForward, 2, begun.speed, { kind: 'create-failed', worldId: 2 });
  assert.deepEqual(failed, begun);
  assert.strictEqual(failed.fastForward, begun.fastForward);
  const created = transitionTemporaryPace(begun.fastForward, 3, begun.speed, { kind: 'world-created', worldId: 3 });
  assert.deepEqual(created, { fastForward: null, speed: DEFAULT_SPEED });
  assert.deepEqual(transitionTemporaryPace(created.fastForward, 3, created.speed, { kind: 'stop', worldId: 2 }), created);
});

test('stale-epoch callbacks never change pace or clear current-world restoration state', () => {
  const begun = transitionTemporaryPace(null, 5, DEFAULT_SPEED, { kind: 'begin', worldId: 5 });
  const stale: PaceEvent[] = [
    ...(['begin', 'stop', 'error', 'pause', 'cancel', 'create-failed', 'world-created'] as const)
      .map(kind => ({ kind, worldId: 4 })),
    { kind: 'select', speed: 90, worldId: 4 },
  ];
  for (const event of stale) {
    const result = transitionTemporaryPace(begun.fastForward, 5, begun.speed, event);
    assert.deepEqual(result, begun);
    assert.strictEqual(result.fastForward, begun.fastForward);
  }
  // Even a current-world stop cannot use a saved pace from a different World.
  const foreign = { worldId: 4, previousSpeed: DEFAULT_SPEED } as const;
  assert.deepEqual(transitionTemporaryPace(foreign, 5, 1, { kind: 'stop', worldId: 5 }), { fastForward: foreign, speed: 1 });
});
