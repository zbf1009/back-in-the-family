// Browser Smoke_Test against the native Parity_Fixture (task 5.2).
//
// Drives the BUILT page (web/dist) served by Local_Preview in the system Chrome
// and checks the shipped bundle end to end:
//
//   - R7.7  the served `.wasm` file responds with Content-Type application/wasm.
//   - R3.1  the World_Config field equals fixtures/configs/pairwise.json, and
//     R9.11 no replay / verify / input control exists (only create/run/pause/
//     step/speed).
//   - R16.12 protocol/reference runs step to 2,000 or node_unanswered, require
//     at least 600 ticks, compare every obtained checksum, and never answer nodes.
//   - R9.8 page Create/Step displays tick 1 and its no-input reference checksum.
//   - R9.9 page Speed 1 user pause and Speed 365 automatic stop preserve the
//     displayed tick/checksum across 500 ms and match that same reference prefix.
//
// Shared setup (R9.4, R9.10): block and record any non-preview origin; fail on
// page console errors and every failed harness reply except node_unanswered step.
//
// Budget (R9.13, <180 s): the two 2,000-step runs and the 120 submits are the
// heavy parts. They are driven INSIDE the page with a single page.evaluate loop
// that calls window.__simHarness.request in a JS loop, so there is one
// Playwright<->page round-trip per run instead of one per tick; the per-request
// worker postMessage and the one-step-per-tick semantics still match the
// reference exactly (R6.6). The heavy evaluate returns the collected checksums
// in one array.
//
// Run directly by Node (type-stripping); covered by tsconfig.node.json.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { readFixture } from './global-setup.ts';

// --- browser-side types for page.evaluate callbacks -------------------------
//
// The evaluate callbacks below run in the browser, but this spec is type-checked
// under tsconfig.node.json (Node lib, no DOM), so the browser globals they touch
// are declared here with just the surface this file uses. The real shapes are
// the Worker_Protocol reply (src/main/sim-client.ts) and the harness
// (src/main/harness.ts), which belong to the DOM tsconfig; redeclaring the
// minimal subset keeps this Node-checked file self-contained without pulling the
// DOM lib into the shared config.

/** The Worker_Protocol reply, as the harness resolves it (subset used here). */
type HarnessReply =
  | { ok: true; snapshot: { tick: string | null; checksum: string | null } }
  | { ok: false; kind: string; error: string; snapshot: { tick: string | null; checksum: string | null } };

/** window.__simHarness as installed with ?harness=1 (subset used here). */
interface BrowserWindow {
  __simHarness?: {
    request(req: Record<string, unknown>): Promise<HarnessReply>;
  };
}
declare const window: BrowserWindow;
declare const document: {
  querySelector(selectors: string): { textContent: string | null } | null;
};

// --- fixture shape ----------------------------------------------------------

const FIXTURE_NAME = 'seedbig-pairwise.replay.json';

interface ReplayFixture {
  seed: string;
  config: { entity_count: number; workload: string };
  ticks: string;
  inputs: { tick: string; seq: string; payload: unknown }[];
  checksums: string[];
}

const fixture = readFixture() as ReplayFixture;
// R16.12 permits only the unanswered-node refusal to end the parity prefix.
const FIXTURE_TICKS = Number(fixture.ticks);
// The World_Config passed to new WasmSim is the JSON string of fixture.config,
// which equals {"entity_count":50,"workload":"Pairwise"} (design Data Models).
const CONFIG_JSON = JSON.stringify(fixture.config);
// Inputs submitted in file order as {tick, payload} -- no seq, sim-core assigns
// it (design Data Models; crates/sim-wasm/tests/parity.rs does the same).
const INPUT_STRINGS = fixture.inputs.map((input) =>
  JSON.stringify({ tick: input.tick, payload: input.payload }),
);

// Path to the config file whose text the page must prefill (R3.1). This file is
// web/tests/smoke/, so the repo root is three levels up.
const pairwiseConfigPath = fileURLToPath(
  new URL('../../../fixtures/configs/pairwise.json', import.meta.url),
);
// Path to the built Deploy_Directory assets, to find the served .wasm (R7.7).
const distAssetsDir = fileURLToPath(new URL('../../dist/assets', import.meta.url));

// --- shared page setup (R9.4, R9.10) ----------------------------------------

/**
 * Wire one page for the Smoke_Test and open it at /?harness=1:
 *   - R9.4: block and record any request whose origin is not the preview origin;
 *     a recorded off-origin request fails the test.
 *   - R9.10: collect page console errors and fail the test if any occurred.
 * Returns a `finish()` to assert no off-origin request and no console error were
 * seen; call it at the end of the test.
 */
async function openHarnessPage(
  page: Page,
  baseURL: string | undefined,
): Promise<{ finish: () => void }> {
  if (baseURL === undefined) {
    throw new Error('baseURL is not configured');
  }
  const previewOrigin = new URL(baseURL).origin;
  const offOrigin: string[] = [];
  const consoleErrors: string[] = [];

  // R9.4: allow only the preview origin; abort and record anything else.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      void route.continue();
      return;
    }
    if (new URL(url).origin === previewOrigin) {
      void route.continue();
      return;
    }
    offOrigin.push(url);
    void route.abort();
  });

  // R9.10: any console error fails the test.
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  // An uncaught page exception is also a failure.
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto('/?harness=1');
  // The harness is installed only with ?harness=1; wait for it before any run.
  await page.waitForFunction(() => typeof window.__simHarness !== 'undefined');

  return {
    finish() {
      expect(offOrigin, `off-preview-origin requests: ${offOrigin.join(', ')}`).toEqual([]);
      expect(consoleErrors, `page console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    },
  };
}

// --- in-page harness runs (R9.5-R9.7) ---------------------------------------
//
// These run entirely inside the page in one page.evaluate each, so the 120
// submits and the 2,000 steps cost one Playwright<->page round-trip per run, not
// one per tick (budget, R9.13). Only node_unanswered ends a run early; every
// other failed reply is surfaced as a test failure. Requests use the same client
// Sim_Worker as the page controls (DA-3), one worker postMessage per request, so
// the semantics equal a reference run that submits before the tick and steps once
// per tick (R6.6).

/**
 * Create, submit every input in file order, and step to `tickCount` or the first
 * node_unanswered refusal. Return every completed tick's checksum; never answer.
 */
async function protocolRun(
  page: Page,
  args: { seed: string; config: string; inputs: string[]; tickCount: number },
): Promise<(string | null)[]> {
  return page.evaluate(async ({ seed, config, inputs, tickCount }) => {
    const harness = window.__simHarness;
    if (harness === undefined) {
      throw new Error('window.__simHarness is not installed');
    }

    const created = await harness.request({ type: 'create-world', seed, config });
    if (!created.ok) throw new Error(`harness reply ok:false for create-world: ${created.error}`);

    for (let i = 0; i < inputs.length; i++) {
      const reply = await harness.request({ type: 'submit', input: inputs[i]! });
      if (!reply.ok) throw new Error(`harness reply ok:false for submit #${i}: ${reply.error}`);
    }

    const checksums: (string | null)[] = [];
    for (let n = 0; n < tickCount; n++) {
      const reply = await harness.request({ type: 'step' });
      if (!reply.ok) {
        if (reply.kind === 'node_unanswered') break;
        throw new Error(`harness reply ok:false for step #${n + 1}: ${reply.error}`);
      }
      checksums.push(reply.snapshot.checksum);
    }
    return checksums;
  }, args);
}

/**
 * Create a fresh world with NO inputs and step to `tickCount` or node_unanswered,
 * collecting the no-input checksum of every completed tick.
 */
async function referenceRun(
  page: Page,
  args: { seed: string; config: string; tickCount: number },
): Promise<(string | null)[]> {
  return page.evaluate(async ({ seed, config, tickCount }) => {
    const harness = window.__simHarness;
    if (harness === undefined) {
      throw new Error('window.__simHarness is not installed');
    }
    const created = await harness.request({ type: 'create-world', seed, config });
    if (!created.ok) {
      throw new Error(`harness reply ok:false for reference create-world: ${created.error}`);
    }
    const checksums: (string | null)[] = [];
    for (let n = 0; n < tickCount; n++) {
      const reply = await harness.request({ type: 'step' });
      if (!reply.ok) {
        if (reply.kind === 'node_unanswered') break;
        throw new Error(`harness reply ok:false for reference step #${n + 1}: ${reply.error}`);
      }
      checksums.push(reply.snapshot.checksum);
    }
    return checksums;
  }, args);
}


// --- the test ---------------------------------------------------------------

test('built page matches the native fixture and the page controls advance it', async ({
  page,
  baseURL,
}) => {
  const { finish } = await openHarnessPage(page, baseURL);

  // 1. R7.7: the served .wasm responds with Content-Type application/wasm. Find
  //    the single .wasm asset in the built Deploy_Directory and request its URL.
  const wasmFiles = readdirSync(distAssetsDir).filter((name) => name.endsWith('.wasm'));
  expect(wasmFiles, `expected exactly one .wasm in dist/assets, found ${wasmFiles.join(', ')}`)
    .toHaveLength(1);
  const wasmResponse = await page.request.get(`/assets/${wasmFiles[0]!}`);
  expect(wasmResponse.ok()).toBe(true);
  expect(wasmResponse.headers()['content-type']).toBe('application/wasm');

  // 2. R3.1: the config textarea equals the fixture config file text.
  const pairwiseConfigText = readFileSync(pairwiseConfigPath, 'utf8');
  // Vite's ?raw yields the file bytes verbatim; the textarea binds that value.
  // The file ends with a trailing newline, which the textarea preserves.
  await expect(page.getByTestId('config')).toHaveValue(pairwiseConfigText);

  //    R9.11: there is no replay / verify / input control on the page. Only
  //    create/run/pause/step/speed controls exist.
  const buttonTestIds = await page.locator('button[data-testid]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-testid')),
  );
  expect(new Set(buttonTestIds)).toEqual(new Set(['create', 'run', 'pause', 'step']));
  // No control mentions replay, verify, submit or input anywhere in its text.
  await expect(page.getByRole('button', { name: /replay|verify|submit|input/i })).toHaveCount(0);

  // 3. R9.5, R9.6: protocol run vs the native fixture.
  const protocolChecksums = await protocolRun(page, {
    seed: fixture.seed,
    config: CONFIG_JSON,
    inputs: INPUT_STRINGS,
    tickCount: FIXTURE_TICKS,
  });
  expect(protocolChecksums.length, `${FIXTURE_NAME}: protocol must reach first_interrupt_min`).toBeGreaterThanOrEqual(600);
  expect(protocolChecksums.length).toBeLessThanOrEqual(FIXTURE_TICKS);
  console.log(`[fixture] protocol: stoppedTick=${protocolChecksums.length} comparedChecksums=${protocolChecksums.length}`);
  // Compare every tick; report the first difference (R9.6).
  let firstDiff = -1;
  for (let n = 1; n <= protocolChecksums.length; n++) {
    const expectedChecksum = fixture.checksums[n - 1]!;
    const actualChecksum = protocolChecksums[n - 1];
    if (actualChecksum !== expectedChecksum) {
      firstDiff = n;
      expect(
        actualChecksum,
        `${FIXTURE_NAME}: first difference at tick ${n}: expected ${expectedChecksum}, actual ${
          actualChecksum ?? 'missing'
        }`,
      ).toBe(expectedChecksum);
      break;
    }
  }
  expect(firstDiff, 'protocol run matched the native fixture at every tick').toBe(-1);

  // 4. R16.12: no-input reference reaches the fixture end or first refusal.
  const reference = await referenceRun(page, {
    seed: fixture.seed,
    config: CONFIG_JSON,
    tickCount: FIXTURE_TICKS,
  });
  expect(reference.length, 'reference must reach first_interrupt_min').toBeGreaterThanOrEqual(600);
  expect(reference.length).toBeLessThanOrEqual(FIXTURE_TICKS);
  console.log(`[fixture] reference: stoppedTick=${reference.length} collectedChecksums=${reference.length}`);
  expect(reference[0], 'reference run produced a tick-1 checksum').not.toBeNull();

  // 5. R9.8: page controls -- Create then Step once -> tick 1 and reference
  //    checksum for tick 1 within 5 s. This re-creates the fixture world through
  //    the page buttons (no inputs), so the page shows the no-input reference.
  await page.getByTestId('seed').fill(fixture.seed);
  await page.getByTestId('config').fill(CONFIG_JSON);
  await page.getByTestId('create').click();
  // After a successful create the page shows tick 0 and Run_State paused (R3.5).
  await expect(page.getByTestId('tick')).toHaveText('0', { timeout: 5_000 });
  await expect(page.getByTestId('run-state')).toHaveText('paused', { timeout: 5_000 });

  await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText('1', { timeout: 5_000 });
  await expect(page.getByTestId('checksum')).toHaveText(reference[0]!, { timeout: 5_000 });

  // 6. R16.12 preserves both WS-R9.9 paths: a user pause at Speed 1 before
  // tick 600, followed by the required automatic stop at Speed 365.
  const checkPaused = async (label: string, runMs: number): Promise<number> => {
    await expect(page.getByTestId('run-state')).toHaveText('paused', { timeout: 5_000 });
    const tickAfterPause = Number(await page.getByTestId('tick').textContent());
    const checksumAfterPause = (await page.getByTestId('checksum').textContent()) ?? '';
    expect(tickAfterPause, `${label}: displayed tick after pause is greater than 1`).toBeGreaterThan(1);

    await page.waitForTimeout(500);
    expect(Number(await page.getByTestId('tick').textContent())).toBe(tickAfterPause);
    expect((await page.getByTestId('checksum').textContent()) ?? '').toBe(checksumAfterPause);

    expect(tickAfterPause, `${label}: pause must lie within the acquired reference`).toBeLessThanOrEqual(reference.length);
    const expectedAtPause = reference[tickAfterPause - 1]!;
    expect(checksumAfterPause,
      `${label}: paused at tick ${tickAfterPause}: expected ${expectedAtPause ?? 'null'}, displayed ${checksumAfterPause}`,
    ).toBe(expectedAtPause);
    console.log(`[fixture] ${label}: pausedTick=${tickAfterPause} runToPauseMs=${runMs}`);
    return tickAfterPause;
  };

  await test.step('Speed 1: pause through the page control before the first interrupt', async () => {
    await page.getByTestId('speed').selectOption('1');
    const started = Date.now();
    await page.getByTestId('run').click();
    await expect.poll(async () => Number(await page.getByTestId('tick').textContent()),
      { timeout: 5_000 }).toBeGreaterThan(1);
    await page.getByTestId('pause').click();
    const tick = await checkPaused('Speed 1 user pause', Date.now() - started);
    expect(tick, 'the user pause precedes first_interrupt_min').toBeLessThan(600);
  });

  await test.step('Speed 365: stop automatically with the Pause control disabled', async () => {
    await page.getByTestId('speed').selectOption('365');
    const started = Date.now();
    await page.getByTestId('run').click();
    await page.waitForFunction(() => {
      const value = Number(document.querySelector('[data-testid="tick"]')?.textContent);
      return Number.isFinite(value) && value >= 365;
    }, undefined, { timeout: 10_000 });
    await expect(page.getByTestId('run-state')).toHaveText('paused',
      { timeout: Math.max(1, 10_000 - (Date.now() - started)) });
    await expect(page.getByTestId('pause')).toBeDisabled();
    const elapsed = Date.now() - started;
    expect(elapsed, 'Speed 365 reaches its automatic stop within 10 seconds').toBeLessThanOrEqual(10_000);
    await checkPaused('Speed 365 automatic stop', elapsed);
  });

  // No off-origin request (R9.4) and no page console error (R9.10) occurred.
  finish();
});
