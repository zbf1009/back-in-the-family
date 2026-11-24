import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addObservation, emptyObservationIndex, hasObservation, type ObservationIndex } from '../../src/main/observation-index.ts';

function freezeIndex(root: ObservationIndex): void {
  if (root === null || Object.isFrozen(root)) return;
  for (const child of Object.values(root.children)) freezeIndex(child!);
  Object.freeze(root.children); Object.freeze(root);
}

test('LV-C2: decimal identity insertion preserves exact prefixes, old roots and unmodified branches', () => {
  let root = emptyObservationIndex();
  const versions: ObservationIndex[] = [root];
  const ids = ['1', '10', '100', '11', '2', '20', '18446744073709551614', '18446744073709551615'];
  for (const id of ids) {
    freezeIndex(root);
    root = addObservation(root, id);
    versions.push(root);
  }
  for (let version = 0; version < versions.length; version++) {
    for (let index = 0; index < ids.length; index++) {
      assert.equal(hasObservation(versions[version]!, ids[index]!), index < version);
    }
  }
  for (const absent of ['0', '12', '101', '1844674407370955161', '18446744073709551613']) {
    assert.equal(hasObservation(root, absent), false);
  }
  freezeIndex(root);
  for (const id of ids) assert.equal(addObservation(root, id), root);
  const extended = addObservation(root, '299');
  assert.equal(extended!.children['1'], root!.children['1']);
  assert.notEqual(extended!.children['2'], root!.children['2']);
  assert.equal(hasObservation(root, '299'), false); assert.equal(hasObservation(extended, '299'), true);
});

test('LV-C2: thousands of distinct identities keep exact historical dedup without numeric narrowing', () => {
  const start = 18446744073709540000n;
  let root = emptyObservationIndex();
  for (let offset = 0n; offset < 4000n; offset++) root = addObservation(root, String(start + offset));
  const historic = root;
  freezeIndex(historic);
  for (let offset = 4000n; offset < 8000n; offset++) root = addObservation(root, String(start + offset));
  for (let offset = 0n; offset < 8000n; offset++) {
    const id = String(start + offset);
    assert.equal(hasObservation(root, id), true);
    assert.equal(hasObservation(historic, id), offset < 4000n);
    assert.equal(addObservation(root, id), root);
  }
  assert.equal(hasObservation(root, String(start - 1n)), false);
  assert.equal(hasObservation(root, String(start + 8000n)), false);
});
