// Feature: web-shell, Property 1: Seed parsing classifies every string and round-trips every u64
//
// Validates: Requirements 2.10, 3.2, 3.3, 3.4, 6.3, 6.4
//
// Property 1 (design.md): For any string s, parseSeed(s) returns 'empty' iff s is
// empty, otherwise 'non-digit' iff s contains a character outside 0-9, otherwise
// 'too-large' iff its decimal value exceeds 2^64 - 1, and otherwise ok with
// value === BigInt(s). For any bigint n in [0, 2^64 - 1] and any number of leading
// zeros z, parseSeed("0".repeat(z) + n.toString()) is ok with value n, and the
// create-world request text carries the text unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseSeed, seedProblemMessage, SEED_MAX, type SeedResult } from '../../src/shared/seed.ts';

const RUNS = 1000;

/**
 * Reference classifier computed independently of the implementation, following the
 * precedence stated in Property 1: empty, then non-digit, then too-large, then ok.
 */
function classify(s: string): SeedResult {
  if (s.length === 0) {
    return { ok: false, problem: 'empty' };
  }
  if (!/^[0-9]+$/.test(s)) {
    return { ok: false, problem: 'non-digit' };
  }
  const value = BigInt(s);
  if (value > SEED_MAX) {
    return { ok: false, problem: 'too-large' };
  }
  return { ok: true, value };
}

// Property 1a: parseSeed classifies every string exactly as the reference, with the
// empty -> non-digit -> too-large -> ok precedence respected.
test('parseSeed classifies every string (empty/non-digit/too-large/ok precedence)', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      const expected = classify(s);
      const actual = parseSeed(s);
      assert.deepEqual(actual, expected);
    }),
    { numRuns: RUNS },
  );
});

// Property 1b: for every u64 n (biased to the boundaries) and any count of leading
// zeros, the decimal string parses to ok and round-trips to exactly n.
test('parseSeed round-trips every u64 with any leading zeros', () => {
  const u64 = fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(0n, 1n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, SEED_MAX) },
    { weight: 6, arbitrary: fc.bigInt({ min: 0n, max: SEED_MAX }) },
  );
  fc.assert(
    fc.property(u64, fc.nat({ max: 8 }), (n, z) => {
      const text = '0'.repeat(z) + n.toString();
      const result = parseSeed(text);
      assert.equal(result.ok, true);
      assert.ok(result.ok);
      assert.equal(result.value, n);
      // No intermediate Number: the exact bigint is preserved even above 2^53.
      assert.equal(typeof result.value, 'bigint');
    }),
    { numRuns: RUNS },
  );
});

// Property 1c: any string containing a non-digit character (that is not empty) is
// classified 'non-digit', regardless of where the non-digit char sits.
test('parseSeed rejects any non-empty string with a non-digit character', () => {
  const nonDigitChar = fc
    .integer({ min: 0x20, max: 0x2fff })
    .map((cp) => String.fromCodePoint(cp))
    .filter((c) => c < '0' || c > '9');
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...'0123456789'.split('')), { maxLength: 6 }),
      nonDigitChar,
      fc.array(fc.constantFrom(...'0123456789'.split('')), { maxLength: 6 }),
      (before, bad, after) => {
        const s = before.join('') + bad + after.join('');
        const result = parseSeed(s);
        assert.equal(result.ok, false);
        assert.ok(!result.ok);
        assert.equal(result.problem, 'non-digit');
      },
    ),
    { numRuns: RUNS },
  );
});

// Property 1d: a pure-digit string whose value exceeds SEED_MAX is 'too-large'.
test('parseSeed rejects digit strings above SEED_MAX as too-large', () => {
  const tooLarge = fc.bigInt({ min: SEED_MAX + 1n, max: 2n ** 80n }).map((n) => n.toString());
  fc.assert(
    fc.property(tooLarge, fc.nat({ max: 4 }), (digits, z) => {
      const result = parseSeed('0'.repeat(z) + digits);
      assert.equal(result.ok, false);
      assert.ok(!result.ok);
      assert.equal(result.problem, 'too-large');
    }),
    { numRuns: RUNS },
  );
});

// Design example cases, with their exact problem classification and message text.
test('parseSeed example cases from the design', () => {
  const empty = parseSeed('');
  assert.deepEqual(empty, { ok: false, problem: 'empty' });

  for (const s of [' 1', '-1', '1e3']) {
    const r = parseSeed(s);
    assert.deepEqual(r, { ok: false, problem: 'non-digit' }, `expected non-digit for ${JSON.stringify(s)}`);
  }

  // One above SEED_MAX (2^64).
  const over = parseSeed('18446744073709551616');
  assert.deepEqual(over, { ok: false, problem: 'too-large' });

  // SEED_MAX itself (2^64 - 1) parses ok.
  const atMax = parseSeed('18446744073709551615');
  assert.equal(atMax.ok, true);
  assert.ok(atMax.ok);
  assert.equal(atMax.value, SEED_MAX);
});

// seedProblemMessage returns a distinct, non-empty message for each problem.
test('seedProblemMessage names each problem', () => {
  const messages = (['empty', 'non-digit', 'too-large'] as const).map(seedProblemMessage);
  for (const m of messages) {
    assert.ok(m.length > 0);
  }
  assert.equal(new Set(messages).size, messages.length, 'messages must be distinct');
});
