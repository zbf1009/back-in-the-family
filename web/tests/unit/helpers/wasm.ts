// Controller test helper: load the real Sim_Wasm into Node (R6.6).
//
// The controller property and example tests (tasks 2.7-2.12) run the real
// `WasmSim` from `target/wasm-pkg`, not a mock, so the model-conformance
// properties (Property 4) are checked against the shipped simulation. The
// `--target web` glue is built for the browser: it exports a default async
// `init(module_or_path)` that fetches the `.wasm`, and a synchronous
// `initSync(module)` for callers that already hold the bytes or a compiled
// module. There is no `fetch` for a local file in Node, so the tests read the
// `.wasm` bytes with `node:fs` and call `initSync` once per process.
//
// init signature (wasm-bindgen 0.2.130, verified empirically against the
// generated `target/wasm-pkg/sim_wasm.js`): `initSync` takes ONE argument that
// is either `{ module: SyncInitInput }` (the current form) or a bare
// `SyncInitInput` (bytes or a `WebAssembly.Module`, deprecated with a console
// warning). `SyncInitInput = BufferSource | WebAssembly.Module`. We pass the
// current form, `initSync({ module: bytes })`, so no deprecation warning is
// printed. The glue guards against a second init (`if (wasm !== undefined)
// return wasm;`), so calling `loadWasm()` more than once per process is safe and
// initialises the module only once.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The glue is plain JavaScript with a companion .d.ts; Node runs it directly and
// the type-checker reads `sim_wasm.d.ts` for the types below.
import initSyncDefault, { initSync, WasmSim } from '../../../../target/wasm-pkg/sim_wasm.js';
import type { SimHandle } from '../../../src/worker/controller.ts';

// `initSyncDefault` is the async default export; we only use the named
// `initSync`. Referencing the default keeps the import used and documents that
// the module also exposes it.
void initSyncDefault;

/** Absolute path to the wasm-bindgen output byte file produced by scripts/wasm-build.sh. */
const WASM_BYTES_PATH = fileURLToPath(
  new URL('../../../../target/wasm-pkg/sim_wasm_bg.wasm', import.meta.url),
);

let initialised = false;

/**
 * Initialise Sim_Wasm from the on-disk bytes, once per process. Safe to call
 * repeatedly: both this guard and the glue's own guard make later calls no-ops.
 * Throws if `target/wasm-pkg/sim_wasm_bg.wasm` is missing (scripts/wasm-build.sh
 * must have run; the gates run it before the unit tests).
 */
export function loadWasm(): void {
  if (initialised) {
    return;
  }
  const bytes = readFileSync(WASM_BYTES_PATH);
  // Current (non-deprecated) signature: a single object with a `module` field.
  initSync({ module: bytes });
  initialised = true;
}

/**
 * A `createSim` backed by the real `WasmSim`, for the controller's `createSim`
 * dependency. Loads the module on first use. The returned handle is a real
 * `WasmSim`, which satisfies `SimHandle` structurally (R6.1): `submit`, `step`,
 * `run_ticks` and the read-only `tick`.
 */
export function createSim(seed: bigint, config: string): SimHandle {
  loadWasm();
  return new WasmSim(seed, config);
}
