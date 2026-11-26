import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  DEFAULT_TOWN_SIZE, SEED_MAX, TOWN_SIZE_MAX, TOWN_SIZE_MIN,
  parseSeed, randomSeed, seedForStart, townConfig,
} from '../../src/shared/seed.ts';

function entropy(value: bigint) {
  let calls = 0;
  const source: Pick<Crypto, 'getRandomValues'> = {
    getRandomValues: ((words: Uint32Array) => {
      assert.equal(words.length, 2);
      calls++;
      words[0] = Number(value >> 32n);
      words[1] = Number(value & 0xffff_ffffn);
      return words;
    }) as Crypto['getRandomValues'],
  };
  return { source, calls: () => calls };
}

test('external crypto words produce the exact u64 seed, including zero and maximum', () => {
  fc.assert(fc.property(fc.bigInt({ min: 0n, max: SEED_MAX }), value => {
    const random = entropy(value);
    assert.equal(randomSeed(random.source), value.toString());
    assert.equal(random.calls(), 1);
  }));
  for (const value of [0n, 9007199254740993n, SEED_MAX]) {
    assert.equal(randomSeed(entropy(value).source), value.toString());
  }
});

test('blank Start seed consumes entropy once; every custom seed retains strict existing admission', () => {
  const random = entropy(SEED_MAX);
  assert.deepEqual(seedForStart('', random.source), { ok: true, value: SEED_MAX });
  assert.equal(random.calls(), 1);
  for (const text of ['0007', '0', '9007199254740993', SEED_MAX.toString(), ' ', '-1', '1e3', (SEED_MAX + 1n).toString()]) {
    assert.deepEqual(seedForStart(text, random.source), parseSeed(text));
  }
  assert.equal(random.calls(), 1, 'custom values never consume randomness or silently become a different seed');
});

test('Town size serializes the actual WorldConfig shape and preserves all legal sizes', () => {
  assert.equal(DEFAULT_TOWN_SIZE, 50);
  assert.deepEqual(JSON.parse(townConfig()), { opening_residents: 50 });
  for (let size = TOWN_SIZE_MIN; size <= TOWN_SIZE_MAX; size++) {
    assert.deepEqual(JSON.parse(townConfig(size)), { opening_residents: size });
  }
  for (const size of [39, 61, 49.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => townConfig(size), RangeError);
  }
});
