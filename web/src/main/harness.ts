// Test access hook (DA-3, R9.5-R9.9, R9.13).
//
// When the page URL carries `?harness=1`, `main.ts` calls `installHarness` with
// the one SimClient the page already uses. This exposes `window.__simHarness`,
// a thin promise-returning wrapper that submits requests through that SAME
// SimClient and the SAME Sim_Worker as the page controls. The Smoke_Test drives
// the Worker_Protocol through it (to create a world, submit the fixture inputs,
// step and compare checksums) while the page-control checks drive the buttons;
// both therefore exercise one worker and one WasmSim (R2.1).
//
// Without `?harness=1` nothing is added to `window`, so the hook never ships in
// the normal page. It grants no capability beyond the existing protocol, which
// already runs entirely in the visitor's own tab.
//
// This is Main_Thread code (lib DOM) and belongs to tsconfig.app.json. It imports
// only types from the shared protocol and the client plus the SimClient value; the
// `window` typing is a module augmentation declared here with `declare global`.

import type { RequestWithoutId } from '../shared/protocol.ts';
import type { ReplyMessage, SimClient } from './sim-client.ts';

/** Caller fields of the shared, discriminated protocol request. */
type HarnessRequest = RequestWithoutId;

/** The shape exposed on `window.__simHarness`, used by the Smoke_Test (DA-3). */
export interface SimHarness {
  /**
   * Route one Worker_Protocol request through the page's own SimClient and
   * resolve with the worker's reply (whether `ok: true` or `ok: false`). Rejects
   * only on the client's 30 s timeout (R9.13). The `id` is assigned by the client.
   */
  request(req: HarnessRequest): Promise<ReplyMessage>;
  /** Read the live WASM v5 export; never reconstruct inputs in JavaScript. */
  exportReplay(): Promise<ReplyMessage>;
  /** Detached bounded page-session counters, outside the World and v5 replay. */
  decisionMetrics(): Promise<ReplyMessage>;
}

declare global {
  interface Window {
    /** Present only when the page was loaded with `?harness=1` (DA-3). */
    __simHarness?: SimHarness;
  }
}

/**
 * Install the harness on `window`, routing every request through `client` — the
 * same SimClient the page uses. Call this from `main.ts` only when
 * `location.search` contains `harness=1`.
 */
export function installHarness(client: SimClient): void {
  window.__simHarness = {
    request(req: HarnessRequest): Promise<ReplyMessage> {
      return client.request(req);
    },
    exportReplay(): Promise<ReplyMessage> {
      return client.exportReplay();
    },
    decisionMetrics(): Promise<ReplyMessage> {
      return client.request({ type: 'decision-metrics' });
    },
  };
}
