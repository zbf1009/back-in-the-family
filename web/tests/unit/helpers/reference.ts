// Controller test helper: the speed-independent reference run (R6.6, Property 4).
//
// R6.6 defines the reference run that every reported checksum must match: a fresh
// `WasmSim` from the same seed, World_Config and inputs, with each input
// submitted before the same tick, calling `step()` ONCE per tick. "Before the
// same tick" means: before the `n`-th step (which runs tick `n`, zero-based), the
// reference submits every input whose tick equals `n`. This mirrors what the
// controller's run loop does regardless of Speed, so comparing against it proves
// speed and pacing never change results.
//
// Submission order within a tick follows the input list order, exactly as the
// controller submits inputs as they arrive: `WasmSim.submit` assigns the `seq`,
// so the order the reference submits in must match the order the controller
// submits in. Tests pass inputs in the same order to both.

import { createSim } from './wasm.ts';
import type { SimHandle } from '../../../src/worker/controller.ts';

/** One input as submitted through the protocol: a tick and the SubmitInput JSON payload. */
export interface ReferenceInput {
  /** The tick (0-based) before which this input is submitted. */
  readonly tick: number;
  /** The `payload` object of the SubmitInput JSON (SetValue / Spawn / Despawn). */
  readonly payload: unknown;
}

/**
 * Build the SubmitInput JSON string the controller would pass to `WasmSim.submit`
 * for one input: `{"tick":"<tick>","payload":{...}}`, with the tick as a decimal
 * string (the strict u64-string shape sim-core requires). This is the exact
 * string the tests submit through the controller too, so both paths submit
 * identical bytes.
 */
export function submitInputJson(input: ReferenceInput): string {
  return JSON.stringify({ tick: String(input.tick), payload: input.payload });
}

/**
 * Run the reference: a fresh `WasmSim` from `seed` and `config`, stepping one tick
 * at a time up to `ticks`. Before running tick `n` (0-based), every input with
 * `tick === n` is submitted in list order. Returns the checksum after each tick,
 * so `checksums[n]` is the checksum of tick `n` (matching `WasmSim.tick() === n+1`
 * after that step, and the fixture's `checksums[n]`).
 *
 * `config` is the World_Config JSON string (e.g. `{"entity_count":50,...}`),
 * the same string the controller receives. A caller holding a config object must
 * `JSON.stringify` it first.
 *
 * Inputs whose tick is >= `ticks` are never submitted (the run stops first); this
 * matches `record`/`verify` in sim-core, which keep but never apply such inputs.
 */
export function referenceRun(
  seed: bigint,
  config: string,
  inputs: readonly ReferenceInput[],
  ticks: number,
): string[] {
  const sim = createSim(seed, config);
  return stepReference(sim, inputs, 0, ticks);
}

/**
 * Extend an existing reference run from tick `from` to tick `to` on the same
 * handle, submitting any inputs for the ticks in `[from, to)` first. Used where a
 * run reaches a tick beyond the reference's current end (design: "extend the
 * reference through the harness if needed"). `inputs` must be the full list; only
 * those with `from <= tick < to` are submitted here.
 */
export function stepReference(
  sim: SimHandle,
  inputs: readonly ReferenceInput[],
  from: number,
  to: number,
): string[] {
  const checksums: string[] = [];
  for (let n = from; n < to; n++) {
    for (const input of inputs) {
      if (input.tick === n) {
        sim.submit(submitInputJson(input));
      }
    }
    checksums.push(sim.step());
  }
  return checksums;
}

/**
 * Convenience: create a reference handle and return both it and a stepper bound to
 * the input list, so a test can step incrementally and extend past the initial
 * length. The handle starts at tick 0.
 */
export function openReference(seed: bigint, config: string): SimHandle {
  return createSim(seed, config);
}
