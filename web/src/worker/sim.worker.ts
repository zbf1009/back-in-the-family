// Sim_Worker entry (R2.1, R2.8, R6.1, R6.2, R8.4).
//
// This is the thin glue the design calls for: it loads Sim_Wasm, wires a
// SimController to the real scheduler, clock and `postMessage`, and routes load
// failures and uncaught worker errors to `fail()`. All request handling lives in
// SimController; this file holds no simulation state.

import init, { WasmSim, llm_render_system_one, llm_validate } from 'sim-wasm/sim_wasm.js';
import wasmUrl from 'sim-wasm/sim_wasm_bg.wasm?url';
import type { Request } from '../shared/protocol.ts';
import { SimController, type FrameScheduler } from './controller.ts';
import { createSameOriginDecisionClient, DecisionBridge, type DecisionTiming } from './decision-bridge.ts';
import mapping from '../shared/system-one-v1.txt?raw';

const timing: DecisionTiming = {
  now: () => performance.now(),
  schedule: (callback, milliseconds) => {
    const handle = self.setTimeout(callback, milliseconds);
    return () => self.clearTimeout(handle);
  },
};
const decisionBridge = new DecisionBridge(createSameOriginDecisionClient(self.location.origin),
  { llm_render_system_one, llm_validate }, mapping, timing);

// Frame frequency does not set simulation speed: the controller's pacer uses
// performance.now() at Speed × 30 ticks/s. Fall back to a ~60 Hz timer if needed.
const scheduler: FrameScheduler =
  typeof self.requestAnimationFrame === 'function'
    ? { request: (cb) => self.requestAnimationFrame(cb), cancel: (h) => self.cancelAnimationFrame(h) }
    : { request: (cb) => self.setTimeout(cb, 16), cancel: (h) => self.clearTimeout(h) };

const controller = new SimController({
  createSim: (seed, config) => new WasmSim(seed, config),
  scheduler,
  clock: { now: () => performance.now() },
  post: (m) => self.postMessage(m),
  decision: {
    bridge: decisionBridge, timing,
    previewNode: (sim, payload) => (sim as WasmSim).preview_node(payload),
    exportReplay: sim => (sim as WasmSim).export_replay(),
  },
});

self.onmessage = (ev: MessageEvent<Request>) => controller.handle(ev.data);
self.addEventListener('error', (ev) => controller.fail(ev.message));
self.addEventListener('unhandledrejection', (ev) => controller.fail(String(ev.reason)));

// Load the WASM, then drain any requests that queued while loading (R2.7). A load
// failure becomes a `fatal` and `load-failed` replies for every request (R2.8).
init({ module_or_path: wasmUrl }).then(
  () => controller.ready(),
  (e: unknown) => controller.fail(e instanceof Error ? e.message : String(e)),
);
