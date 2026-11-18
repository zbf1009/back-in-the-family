// Controller test helper: fast-check generators (R6.6).
//
// These build the inputs for the controller properties (tasks 2.7-2.12): small
// World_Configs, seeds biased to the interesting u64 boundaries, protocol inputs
// in the SubmitInput JSON shape, and command sequences capped so any single case
// runs at most ~3,000 ticks (Property 4's bound), keeping 100 runs fast.
//
// Shapes verified against sim-core:
//   - ReplayConfig / WorldConfig (crates/sim-core/src/world.rs, replay.rs):
//     {"opening_residents": N}, a u16 in 40..=60 (R12.1). The generator uses the
//     whole legal range, because the skeleton's small entities/workload configs are
//     gone (R1.1, R1.2).
//   - SubmitInput (crates/sim-core/src/replay.rs):
//     {"tick":"<u64>","payload":{"Act":{"kind":"help","actor":"3","target":"17",
//     "intensity":40}}}. `tick`, `actor` and `target` are decimal strings; `kind` is
//     one of the six card event names; `intensity` is a JSON number 0..=255, so some
//     generated inputs are invalid on purpose.
//   - The parity fixture (fixtures/parity/seedbig-pairwise.replay.json) uses this
//     exact payload shape.

import fc from 'fast-check';
import type { RequestWithoutId } from '../../../src/shared/protocol.ts';
import { PLAY_RATE, SPEEDS } from '../../../src/shared/speeds.ts';
import type { ReferenceInput } from './reference.ts';

/** The maximum u64 value, for the seed generator. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** The six card social kinds, as sim-core's SocialKind (input.rs, values.rs). */
export const SOCIAL_KINDS = ['help', 'gift', 'quarrel', 'insult', 'theft', 'apology'] as const;

/** A World_Config object with any legal opening resident count (40..=60, R12.1). */
export const configArb: fc.Arbitrary<{ opening_residents: number }> = fc.record({
  opening_residents: fc.integer({ min: 40, max: 60 }),
});

/** A World_Config as the JSON string `new WasmSim` receives. */
export const configJsonArb: fc.Arbitrary<string> = configArb.map((c) => JSON.stringify(c));

/**
 * A valid u64 seed as a `bigint`, biased to the boundaries Property 1 cares about:
 * 0, around 2^53 (the JS safe-integer edge), and 2^64 - 1. The create-world
 * request carries the seed as its decimal string.
 */
export const seedBigIntArb: fc.Arbitrary<bigint> = fc.oneof(
  { arbitrary: fc.bigInt({ min: 0n, max: U64_MAX }), weight: 3 },
  {
    arbitrary: fc.constantFrom(
      0n,
      1n,
      9_007_199_254_740_991n, // 2^53 - 1
      9_007_199_254_740_992n, // 2^53
      9_007_199_254_740_993n, // 2^53 + 1
      U64_MAX,
    ),
    weight: 2,
  },
);

/** A seed as the decimal string carried over the protocol. */
export const seedStringArb: fc.Arbitrary<string> = seedBigIntArb.map((n) => n.toString());

/** A Person ID as a decimal string (u64), biased small so Acts often hit a live Person. */
const personStringArb = fc.oneof(
  { arbitrary: fc.integer({ min: 1, max: 60 }).map((n) => n.toString()), weight: 3 },
  { arbitrary: fc.bigInt({ min: 0n, max: U64_MAX }).map((n) => n.toString()), weight: 1 },
);

/** One SubmitInput `payload` object: an `Act` (replay.rs shape). */
export const payloadArb: fc.Arbitrary<unknown> = fc.record({
  Act: fc.record({
    kind: fc.constantFrom(...SOCIAL_KINDS),
    actor: personStringArb,
    target: personStringArb,
    // 0..=255, so values outside the valid 1..=100 are generated on purpose.
    intensity: fc.integer({ min: 0, max: 255 }),
  }),
});

/**
 * A protocol input bound to a tick in `[0, maxTick)`, as the reference and the
 * controller both consume it. The tick is where the input is submitted before.
 */
export function referenceInputArb(maxTick: number): fc.Arbitrary<ReferenceInput> {
  return fc.record({
    tick: fc.integer({ min: 0, max: Math.max(0, maxTick - 1) }),
    payload: payloadArb,
  });
}

/** The SubmitInput JSON string for a `submit` request (no `seq`; strict u64 strings). */
export function submitJsonArb(maxTick: number): fc.Arbitrary<string> {
  return referenceInputArb(maxTick).map((i) => JSON.stringify({ tick: String(i.tick), payload: i.payload }));
}

/**
 * A command in a controller command sequence. `fire-frames` fires `k` frames on
 * the fake scheduler; the others map onto protocol requests (the test assigns the
 * request `id`). `set-speed` and `submit` carry both valid and arbitrary values so
 * the rejection paths (Property 3) are exercised too.
 */
export type Command =
  | { kind: 'create-world'; seed: string; config: string }
  | { kind: 'run' }
  | { kind: 'pause' }
  | { kind: 'step' }
  | { kind: 'set-speed'; speed: number }
  | { kind: 'submit'; input: string }
  | { kind: 'unsupported'; request: RequestWithoutId }
  | { kind: 'fire-frames'; count: number };

/**
 * Build a command-sequence generator whose total possible ticks stay under
 * `tickBudget` (default 3,000, Property 4's cap). The budget is enforced by
 * bounding the worst case with the largest integer paced batch cap, plus steps.
 * We do this by limiting the number and size of `fire-frames` commands.
 */
export function commandsArb(tickBudget = 3_000): fc.Arbitrary<Command[]> {
  const maxBatch = Math.ceil(Math.max(...SPEEDS) * PLAY_RATE / 20);
  // Keep a wide margin so even all-at-max-speed frames stay under budget: at most
  // `maxFrameTicks` ticks come from frames, leaving room for steps.
  const maxFrameTicks = Math.floor(tickBudget * 0.9);
  // Include real frame commands even with a small budget; each batch is bounded.
  const maxFramesPerCommand = Math.max(1, Math.min(8, Math.floor(maxFrameTicks / maxBatch)));
  const maxFrameCommands = Math.floor(maxFrameTicks / (maxBatch * maxFramesPerCommand));

  const createArb = fc
    .record({ seed: seedStringArb, config: configJsonArb })
    .map((c): Command => ({ kind: 'create-world', seed: c.seed, config: c.config }));
  // Also sometimes an invalid create (bad seed or bad config) to exercise rejection.
  const badCreateArb = fc
    .record({
      seed: fc.oneof(fc.string(), fc.constantFrom('', ' 1', '-1', '1e3', '99999999999999999999999')),
      config: fc.oneof(
        configJsonArb,
        fc.constantFrom(
          '',
          '{}',
          'not json',
          '{"opening_residents":39}',
          '{"opening_residents":61}',
          '{"opening_residents":50,"workload":"Pairwise"}',
        ),
      ),
    })
    .map((c): Command => ({ kind: 'create-world', seed: c.seed, config: c.config }));

  const speedArb = fc
    .oneof(
      { arbitrary: fc.constantFrom(...SPEEDS), weight: 3 },
      { arbitrary: fc.integer({ min: -10, max: 1000 }), weight: 1 }, // often invalid
    )
    .map((speed): Command => ({ kind: 'set-speed', speed }));

  const submitArb = fc
    .oneof(
      { arbitrary: submitJsonArb(tickBudget), weight: 3 },
      { arbitrary: fc.oneof(fc.string(), fc.constantFrom('', '{}', '{"tick":"x"}')), weight: 1 },
    )
    .map((input): Command => ({ kind: 'submit', input }));

  const frameArb = fc
    .integer({ min: 1, max: maxFramesPerCommand })
    .map((count): Command => ({ kind: 'fire-frames', count }));

  const newRequestArb = fc.constantFrom<RequestWithoutId>(
    { type: 'world-snapshot' },
    { type: 'choose', node: '12', option: 'repay_now' },
    { type: 'choose-and-run', node: '12', option: 'repay_now' },
    { type: 'dream', dreamer: 9, intent: 'reassure' },
    { type: 'claim', slot: 'imported_vessel', carryOver: null },
    { type: 'checksums', from: '0', to: '10' },
    { type: 'player_node_state' },
  ).map((request): Command => ({ kind: 'unsupported', request }));

  const commandArb = fc.oneof(
    { arbitrary: createArb, weight: 2 },
    { arbitrary: badCreateArb, weight: 1 },
    { arbitrary: fc.constant<Command>({ kind: 'run' }), weight: 3 },
    { arbitrary: fc.constant<Command>({ kind: 'pause' }), weight: 2 },
    { arbitrary: fc.constant<Command>({ kind: 'step' }), weight: 2 },
    { arbitrary: speedArb, weight: 2 },
    { arbitrary: submitArb, weight: 2 },
    { arbitrary: newRequestArb, weight: 2 },
    { arbitrary: frameArb, weight: 4 },
  );

  return fc.array(commandArb, { minLength: 0, maxLength: 40 }).map((commands) => {
    // Enforce the tick budget: drop extra fire-frames commands past the cap and
    // clamp step count, so the worst case stays under `tickBudget`.
    let frameCommands = 0;
    let steps = 0;
    const kept: Command[] = [];
    for (const cmd of commands) {
      if (cmd.kind === 'fire-frames') {
        if (frameCommands >= maxFrameCommands) {
          continue; // over the frame budget: skip
        }
        frameCommands++;
      } else if (cmd.kind === 'step') {
        if (steps >= tickBudget - maxFrameTicks) {
          continue; // over the step budget: skip
        }
        steps++;
      }
      kept.push(cmd);
    }
    return kept;
  });
}
