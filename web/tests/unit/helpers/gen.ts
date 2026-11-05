// Controller test helper: fast-check generators (R6.6).
//
// These build the inputs for the controller properties (tasks 2.7-2.12): small
// World_Configs, seeds biased to the interesting u64 boundaries, protocol inputs
// in the SubmitInput JSON shape, and command sequences capped so any single case
// runs at most ~3,000 ticks (Property 4's bound), keeping 100 runs fast.
//
// Shapes verified against sim-core:
//   - ReplayConfig / WorldConfig (crates/sim-core/src/world.rs, replay.rs): legal
//     `workload` values are exactly "Light" and "Pairwise"; `entity_count` is a
//     u16 (legal 0..=200). The generators use 1..20 per R6.6, "any workload".
//   - SubmitInput (crates/sim-core/src/replay.rs): {"tick":"<u64>","payload":P}
//     with no `seq`; P is one of SetValue {entity:"<u64>", value:i32},
//     Spawn {value:i32}, Despawn {entity:"<u64>"}. `value` is a JSON number;
//     `entity` and `tick` are decimal strings.
//   - The parity fixture (fixtures/parity/seedbig-pairwise.replay.json) uses this
//     exact payload shape, e.g. {"SetValue":{"entity":"37","value":264}}.

import fc from 'fast-check';
import type { Request } from '../../../src/shared/protocol.ts';
import { SPEEDS } from '../../../src/shared/speeds.ts';
import type { ReferenceInput } from './reference.ts';

/** The maximum u64 value, for the seed generator. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** Legal workload strings, as sim-core's ReplayWorkload enum (world.rs, replay.rs). */
export const WORKLOADS = ['Light', 'Pairwise'] as const;

/** A World_Config object with a small entity count (1..20) and any legal workload (R6.6). */
export const configArb: fc.Arbitrary<{ entity_count: number; workload: string }> = fc.record({
  entity_count: fc.integer({ min: 1, max: 20 }),
  workload: fc.constantFrom(...WORKLOADS),
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

/** An i32 `value`, within the i32 range so sim-core never rejects the shape itself. */
const valueArb = fc.integer({ min: -2_147_483_648, max: 2_147_483_647 });

/** An entity id as a decimal string (u64), biased small so SetValue/Despawn often hit a live entity. */
const entityStringArb = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 60 }).map((n) => n.toString()), weight: 3 },
  { arbitrary: fc.bigInt({ min: 0n, max: U64_MAX }).map((n) => n.toString()), weight: 1 },
);

/** One SubmitInput `payload` object: SetValue, Spawn or Despawn (replay.rs shape). */
export const payloadArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({ SetValue: fc.record({ entity: entityStringArb, value: valueArb }) }),
  fc.record({ Spawn: fc.record({ value: valueArb }) }),
  fc.record({ Despawn: fc.record({ entity: entityStringArb }) }),
);

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
  | { kind: 'fire-frames'; count: number };

/**
 * Build a command-sequence generator whose total possible ticks stay under
 * `tickBudget` (default 3,000, Property 4's cap). The budget is enforced by
 * bounding the worst case: each fired frame runs at most `maxSpeed` ticks and each
 * step runs one, so we cap `sum(fired frames) * maxSpeed + steps <= tickBudget`.
 * We do this by limiting the number and size of `fire-frames` commands.
 */
export function commandsArb(tickBudget = 3_000): fc.Arbitrary<Command[]> {
  const maxSpeed = Math.max(...SPEEDS); // 365
  // Keep a wide margin so even all-at-max-speed frames stay under budget: at most
  // `maxFrameTicks` ticks come from frames, leaving room for steps.
  const maxFrameTicks = Math.floor(tickBudget * 0.9);
  // Each fire-frames command fires 1..8 frames; worst case maxSpeed ticks each.
  const maxFramesPerCommand = 8;
  const maxFrameCommands = Math.max(
    0,
    Math.floor(maxFrameTicks / (maxSpeed * maxFramesPerCommand)),
  );

  const createArb = fc
    .record({ seed: seedStringArb, config: configJsonArb })
    .map((c): Command => ({ kind: 'create-world', seed: c.seed, config: c.config }));
  // Also sometimes an invalid create (bad seed or bad config) to exercise rejection.
  const badCreateArb = fc
    .record({
      seed: fc.oneof(fc.string(), fc.constantFrom('', ' 1', '-1', '1e3', '99999999999999999999999')),
      config: fc.oneof(configJsonArb, fc.constantFrom('', '{}', 'not json', '{"entity_count":99999}')),
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

  const commandArb = fc.oneof(
    { arbitrary: createArb, weight: 2 },
    { arbitrary: badCreateArb, weight: 1 },
    { arbitrary: fc.constant<Command>({ kind: 'run' }), weight: 3 },
    { arbitrary: fc.constant<Command>({ kind: 'pause' }), weight: 2 },
    { arbitrary: fc.constant<Command>({ kind: 'step' }), weight: 2 },
    { arbitrary: speedArb, weight: 2 },
    { arbitrary: submitArb, weight: 2 },
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
