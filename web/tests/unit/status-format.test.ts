// Feature: web-shell, Property 8: Status formatting
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.6
//
// Property 8 (design.md): For any UiState, the formatted tick is a dash when
// `tick` is null and otherwise the decimal string with no separators; the
// formatted checksum is a dash when `checksum` is null and otherwise exactly 16
// lowercase hexadecimal characters; Ticks_Per_Second is a dash when `tps` is null
// and otherwise a non-negative decimal integer; and Run_State is one of the four
// names.
//
// The four formatters (`formatTick`, `formatChecksum`, `formatTps`,
// `formatRunState`) and the `DASH` placeholder live in `ui-state.ts`. This test
// builds arbitrary UiState values (the display fields drawn from their full legal
// ranges, including the null cases) and asserts, for every one of them:
//   - formatTick returns the tick decimal string verbatim when non-null -- no
//     thousands separators and no reformatting of a large u64 string -- and DASH
//     when null (R5.1, R5.2).
//   - formatChecksum returns the 16-hex checksum verbatim when non-null and DASH
//     when null (R5.1, R5.3).
//   - formatTps returns the integer string when tps is a non-negative integer and
//     DASH when null (R5.1, R5.6).
//   - formatRunState returns one of the four Run_State names (R5.1).
// and that DASH is the single placeholder used for every null field.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  DASH,
  formatChecksum,
  formatRunState,
  formatTick,
  formatTps,
  type UiState,
} from '../../src/main/ui-state.ts';
import type { RunState } from '../../src/shared/protocol.ts';

const RUNS = 1000;

const RUN_STATES: readonly RunState[] = ['no-world', 'paused', 'running', 'failed'];

/** The whole legal Run_State set, as a plain set for membership checks. */
const RUN_STATE_SET: ReadonlySet<string> = new Set(RUN_STATES);

/**
 * An arbitrary tick: a decimal string with no separators drawn from the full u64
 * range (so values above 2^53 appear), or null. The string carries no separators
 * and no sign by construction -- it is exactly what a BigInt stringifies to.
 */
const tickArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map((n) => n.toString()),
);

/** An arbitrary checksum: exactly 16 lowercase hex characters, or null. */
const hex16Arb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 16, maxLength: 16 })
  .map((cs) => cs.join(''));
const checksumArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  hex16Arb,
);

/** An arbitrary Ticks_Per_Second value: a non-negative integer, or null. */
const tpsArb: fc.Arbitrary<number | null> = fc.oneof(
  fc.constant<number | null>(null),
  fc.nat({ max: 10_000_000 }),
);

/**
 * An arbitrary UiState. Only the four fields the formatters read (`tick`,
 * `checksum`, `tps`, `runState`) are varied across their legal ranges; the rest
 * are filled with legal placeholder values the formatters never look at.
 */
const uiStateArb: fc.Arbitrary<UiState> = fc.record({
  worldId: fc.nat(),
  runState: fc.constantFrom(...RUN_STATES),
  tick: tickArb,
  checksum: checksumArb,
  tps: tpsArb,
  speed: fc.constantFrom(1, 7, 30, 90, 365),
  error: fc.oneof(fc.constant<string | null>(null), fc.string()),
  seedMessage: fc.oneof(fc.constant<string | null>(null), fc.string()),
  createPending: fc.boolean(),
  stepPending: fc.boolean(),
});

/** A matcher for exactly 16 lowercase hexadecimal characters. */
const HEX16 = /^[0-9a-f]{16}$/;
/** A matcher for a non-negative decimal integer with no separators or sign. */
const NON_NEG_INT = /^(0|[1-9][0-9]*)$/;

test('Property 8: formatters show the value verbatim or a single dash for every UiState', () => {
  fc.assert(
    fc.property(uiStateArb, (s) => {
      const tickOut = formatTick(s);
      const checksumOut = formatChecksum(s);
      const tpsOut = formatTps(s);
      const runStateOut = formatRunState(s);

      // --- tick (R5.1, R5.2) ---
      if (s.tick === null) {
        assert.equal(tickOut, DASH, 'null tick must format as the dash');
      } else {
        // Shown verbatim: the exact decimal string, no separators, no reformatting
        // (so a large u64 string is passed through unchanged).
        assert.equal(tickOut, s.tick, 'non-null tick must be shown verbatim');
        assert.doesNotMatch(tickOut, /[,._\s]/, 'tick must carry no separators');
        assert.match(tickOut, /^(0|[1-9][0-9]*)$/, 'tick is a bare decimal integer');
      }

      // --- checksum (R5.1, R5.3) ---
      if (s.checksum === null) {
        assert.equal(checksumOut, DASH, 'null checksum must format as the dash');
      } else {
        // Shown verbatim and already exactly 16 lowercase hex characters.
        assert.equal(checksumOut, s.checksum, 'non-null checksum must be shown verbatim');
        assert.match(checksumOut, HEX16, 'checksum is exactly 16 lowercase hex characters');
      }

      // --- Ticks_Per_Second (R5.1, R5.6) ---
      if (s.tps === null) {
        assert.equal(tpsOut, DASH, 'null tps must format as the dash');
      } else {
        assert.equal(tpsOut, String(s.tps), 'non-null tps is its decimal integer string');
        assert.match(tpsOut, NON_NEG_INT, 'tps is a non-negative decimal integer');
      }

      // --- Run_State (R5.1) ---
      assert.ok(RUN_STATE_SET.has(runStateOut), 'run state is one of the four names');
      assert.equal(runStateOut, s.runState, 'run state is passed through unchanged');

      // --- dash consistency: DASH is used for every null field and only there ---
      assert.equal(tickOut === DASH, s.tick === null, 'tick shows the dash iff tick is null');
      assert.equal(checksumOut === DASH, s.checksum === null, 'checksum shows the dash iff checksum is null');
      assert.equal(tpsOut === DASH, s.tps === null, 'tps shows the dash iff tps is null');
    }),
    { numRuns: RUNS },
  );
});

// A focused example: a brand-new world (R5.3) shows tick 0 and a dash for the
// checksum; the no-world initial (R5.2) shows a dash for both.
test('Property 8: example -- new world shows tick 0 and a dash checksum; no-world shows two dashes', () => {
  const base: UiState = {
    worldId: 0,
    runState: 'no-world',
    tick: null,
    checksum: null,
    tps: null,
    speed: 1,
    error: null,
    seedMessage: null,
    createPending: false,
    stepPending: false,
  };

  // no-world: tick and checksum are both the dash, tps is the dash (R5.2, R5.6).
  assert.equal(formatTick(base), DASH);
  assert.equal(formatChecksum(base), DASH);
  assert.equal(formatTps(base), DASH);
  assert.equal(formatRunState(base), 'no-world');

  // Just-created world: tick 0, checksum still a dash (R5.3).
  const created: UiState = { ...base, worldId: 1, runState: 'paused', tick: '0', checksum: null };
  assert.equal(formatTick(created), '0');
  assert.equal(formatChecksum(created), DASH);
  assert.equal(formatRunState(created), 'paused');
});

// A focused example: a large u64 tick and a real checksum are shown verbatim,
// with no thousands separators (R5.1).
test('Property 8: example -- a large u64 tick and a checksum are shown verbatim', () => {
  const s: UiState = {
    worldId: 1,
    runState: 'running',
    tick: '18446744073709551615',
    checksum: 'a1b2c3d4e5f60718',
    tps: 1234567,
    speed: 365,
    error: null,
    seedMessage: null,
    createPending: false,
    stepPending: false,
  };
  assert.equal(formatTick(s), '18446744073709551615', 'large u64 tick is not reformatted');
  assert.doesNotMatch(formatTick(s), /,/, 'no thousands separators');
  assert.equal(formatChecksum(s), 'a1b2c3d4e5f60718', 'checksum shown verbatim');
  assert.equal(formatTps(s), '1234567', 'tps shown as a bare integer');
  assert.equal(formatRunState(s), 'running');
});
