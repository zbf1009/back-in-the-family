// Playwright configuration for the Smoke_Test (R9.1, R9.2, R9.4, R9.10, R9.13).
//
// The Smoke_Test drives the BUILT page (web/dist) served by Local_Preview in the
// system Chrome, and compares the Sim_Worker's checksums with a native-recorded
// Parity_Fixture. This file wires:
//
//   - channel: 'chrome' (R9.1): use the system Google Chrome, not a downloaded
//     Playwright browser. Combined with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
//     (exported by scripts/gates.sh) nothing is downloaded (R9.2).
//   - workers: 1 (R6.6): one page, one Sim_Worker, one WasmSim at a time.
//   - testDir: tests/smoke and a globalSetup that reads the fixture first, then
//     confirms Chrome exists, both before any page opens (R9.3, R9.12).
//   - webServer: Local_Preview (scripts/preview.ts via the `preview` script),
//     serving web/dist on http://localhost:4173. reuseExistingServer is false so
//     the test never attaches to an unrelated server, and the server must start
//     within 30 s (R9.4, R9.13). baseURL points at the same origin.
//   - existing specs keep 120 s; playthrough derives B from its stage sidecar.
//     The whole suite has the existing 170 s plus B (first-playable R16.8).
//
// Run directly by Node (type-stripping); no compile step. Covered by
// tsconfig.node.json (playwright.config.ts).

import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';

// R9.4: the preview origin. Local_Preview serves web/dist here with --strictPort,
// so this is the only origin the page is allowed to reach.
const PREVIEW_PORT = 4173;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

// Existing fixture/responsive bounds stay unchanged. Task 14 adds the design's
// stage-derived playthrough allowance B to the overall suite budget only.
const PREVIEW_START_TIMEOUT_MS = 30_000;
const PER_TEST_TIMEOUT_MS = 120_000;
const playthrough = JSON.parse(readFileSync(new URL('../fixtures/parity/seedP-playthrough.stages.json', import.meta.url), 'utf8')) as {
  last_tick: string; stages: { tick: string }[]; step_clicks: number;
};
const firstTick = Number(playthrough.stages[0]!.tick);
const PLAYTHROUGH_TIMEOUT_MS = 30_000 + Math.ceil(firstTick / 30) * 1000
  + Math.ceil((Number(playthrough.last_tick) - firstTick) / (30 * 365)) * 1000
  + 5000 * playthrough.stages.length + 100 * playthrough.step_clicks;
const GLOBAL_TIMEOUT_MS = 170_000 + PLAYTHROUGH_TIMEOUT_MS;

export default defineConfig({
  testDir: 'tests/smoke',
  // R9.3, R9.12: read/parse the fixture, then confirm the system Chrome, both
  // before Chrome opens the page.
  globalSetup: './tests/smoke/global-setup.ts',
  // R6.6: a single world. One worker also keeps the preview server unshared.
  workers: 1,
  fullyParallel: false,
  // CI must not silently pass on an accidental `test.only`.
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  // Existing per-test bound; playthrough overrides it with B in its spec.
  timeout: PER_TEST_TIMEOUT_MS,
  globalTimeout: GLOBAL_TIMEOUT_MS,
  use: {
    baseURL: BASE_URL,
    // R9.1: the system Chrome via the 'chrome' channel (no downloaded browser).
    channel: 'chrome',
  },
  // R9.4, R9.13: serve the Deploy_Directory with Local_Preview and wait for it.
  // `mise exec` reaches the pnpm version pinned in mise.toml (the pnpm on PATH may
  // differ), matching how scripts/gates.sh runs every web step. reuseExistingServer
  // is false so the run always starts a fresh preview of the just-built web/dist.
  webServer: {
    command: 'mise exec -- pnpm --dir web run preview',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: PREVIEW_START_TIMEOUT_MS,
    // Run from the repo root so `--dir web` resolves and the preview serves
    // web/dist; this config lives in web/, so go one level up.
    cwd: '..',
  },
});
