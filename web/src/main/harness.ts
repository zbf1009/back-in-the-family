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

import type { Request } from '../shared/protocol.ts';
import type { ReplyMessage, SimClient } from './sim-client.ts';

/**
 * Distributive omit: applies `Omit` to each member of a union separately, so the
 * result stays a discriminated union rather than collapsing into one merged shape.
 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/**
 * The caller-supplied fields of a Request: the `id` the SimClient assigns itself
 * is omitted. Distributive, so each member keeps its own shape (and discriminant),
 * which lets the `switch` below narrow it to the matching SimClient method.
 */
type HarnessRequest = DistributiveOmit<Request, 'id'>;

/** The shape exposed on `window.__simHarness`, used by the Smoke_Test (DA-3). */
export interface SimHarness {
  /**
   * Route one Worker_Protocol request through the page's own SimClient and
   * resolve with the worker's reply (whether `ok: true` or `ok: false`). Rejects
   * only on the client's 30 s timeout (R9.13). The `id` is assigned by the client.
   */
  request(req: HarnessRequest): Promise<ReplyMessage>;
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
      switch (req.type) {
        case 'create-world':
          return client.createWorld({ seed: req.seed, config: req.config });
        case 'run':
          return client.run();
        case 'pause':
          return client.pause();
        case 'step':
          return client.step();
        case 'set-speed':
          return client.setSpeed({ speed: req.speed });
        case 'submit':
          return client.submit({ input: req.input });
      }
    },
  };
}
