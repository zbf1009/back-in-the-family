import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { dateLabel, formatAmount, formatMoney } from '../../src/main/calendar.ts';

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);

test('fictional dates keep exact years and Halloween across signed year boundaries', () => {
  for (const [tick, expected] of [
    ['0', 'Year 1, Day 1 — Halloween'], ['364', 'Year 1, Day 365'],
    ['365', 'Year 2, Day 1 — Halloween'], ['366', 'Year 2, Day 2'],
    ['-1', 'Year 0, Day 365'], ['-365', 'Year 0, Day 1 — Halloween'],
    ['-366', 'Year -1, Day 365'],
  ]) assert.equal(dateLabel(tick!), expected);
});

test('dates above Number precision preserve the actual day instead of a rounded neighbor', () => {
  for (const tick of [9007199254740993n, U64_MAX, I64_MIN]) {
    const cycle = tick >= 0n ? tick / 365n : (tick - 364n) / 365n;
    const day = tick - cycle * 365n + 1n;
    assert.equal(dateLabel(tick.toString()), `Year ${cycle + 1n}, Day ${day}${day === 1n ? ' — Halloween' : ''}`);
  }
  assert.notEqual(dateLabel('9007199254740992'), dateLabel('9007199254740993'));
});

test('a whole fictional year shifts only the exact year, for arbitrary signed dates', () => {
  fc.assert(fc.property(fc.bigInt({ min: I64_MIN, max: U64_MAX - 365n }), tick => {
    const before = /^Year (-?\d+), (.*)$/.exec(dateLabel(tick.toString()))!;
    const after = /^Year (-?\d+), (.*)$/.exec(dateLabel((tick + 365n).toString()))!;
    assert.equal(BigInt(after[1]!), BigInt(before[1]!) + 1n);
    assert.equal(after[2], before[2]);
  }));
});

test('signed money and amounts retain every native u64 and i64 digit', () => {
  assert.equal(formatAmount(U64_MAX.toString()), '18,446,744,073,709,551,615');
  assert.equal(formatMoney(U64_MAX.toString()), '$18,446,744,073,709,551,615');
  assert.equal(formatAmount(I64_MIN.toString()), '-9,223,372,036,854,775,808');
  assert.equal(formatMoney(I64_MIN.toString()), '-$9,223,372,036,854,775,808');
  for (const text of ['0', '-0', '+0', '0000']) {
    assert.equal(formatAmount(text), '0');
    assert.equal(formatMoney(text), '$0');
  }
  fc.assert(fc.property(fc.bigInt({ min: I64_MIN, max: U64_MAX }), value => {
    assert.equal(BigInt(formatAmount(value.toString()).replaceAll(',', '')), value);
    assert.equal(BigInt(formatMoney(value.toString()).replaceAll(',', '').replace('$', '')), value);
  }));
});
