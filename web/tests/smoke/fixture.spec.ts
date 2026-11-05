// Browser Smoke_Test against the native Parity_Fixture (task 5.2).
//
// Drives the BUILT page (web/dist) served by Local_Preview in the system Chrome
// and checks the shipped bundle end to end:
//
//   - R7.7  the served `.wasm` file responds with Content-Type application/wasm.
//   - R3.1  the World_Config field equals fixtures/configs/pairwise.json, and
//     R9.11 no replay / verify / input control exists (only create/run/pause/
//     step/speed).
//   - R9.5, R9.6  protocol run: through window.__simHarness create a world from
//     the fixture's seed and JSON.stringify(config), submit the 120 inputs in
//     file order as {tick, payload} (no seq -- sim-core assigns it), step 2,000
//     times, collect every tick's checksum, require exactly 2,000 and compare
//     each with checksums[n-1]; on any mismatch fail naming the fixture, the
//     first differing tick, expected and actual.
//   - R9.7  reference run: a fresh world (same seed/config, NO inputs) stepped
//     >= 2,000 times, giving the no-input checksums the page-control checks use.
//   - R9.8  page controls: Create via seed input + config textarea + Create
//     button, Step once, see tick 1 and the reference checksum for tick 1 within
//     5 s.
//   - R9.9 (+R4.6, R5.7)  page controls: Speed 365, Run until tick >= 365 or 10 s,
//     Pause, tick > 1, tick+checksum unchanged 500 ms later, and the displayed
//     checksum equals the reference run's checksum for that tick (the reference
//     is extended through the harness if the tick reached is past its end).
//
// Shared setup (R9.4, R9.10): block and record any non-preview origin; fail the
// test on any page console error or any harness reply with ok:false.
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
  | { ok: false; error: string; snapshot: { tick: string | null; checksum: string | null } };

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
// The fixture records exactly this many ticks; the protocol run must produce the
// same number of checksums (R9.5, R9.6).
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
// one per tick (budget, R9.13). Each helper throws inside the page on the first
// ok:false reply, which Playwright surfaces as a test failure naming the step
// (R9.10). The create/submit/step requests go through the same SimClient and
// Sim_Worker as the page controls (DA-3), one worker postMessage per request, so
// the semantics equal a reference run that submits before the tick and steps once
// per tick (R6.6).

/**
 * Create a world, submit every input in file order, then step `tickCount` times,
 * collecting the checksum reported after each step. Runs in the page. Throws on
 * any ok:false reply. Returns the collected checksums in tick order.
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
      if (!reply.ok) throw new Error(`harness reply ok:false for step #${n + 1}: ${reply.error}`);
      checksums.push(reply.snapshot.checksum);
    }
    return checksums;
  }, args);
}

/**
 * Create a fresh world with NO inputs and step `tickCount` times, collecting the
 * no-input checksum after each step. Runs in the page. Throws on ok:false.
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
        throw new Error(`harness reply ok:false for reference step #${n + 1}: ${reply.error}`);
      }
      checksums.push(reply.snapshot.checksum);
    }
    return checksums;
  }, args);
}

/**
 * Extend a no-input reference run to at least `targetTicks` by creating a fresh
 * world and stepping that many times (R9.9). Simpler and still deterministic:
 * the no-input run is a pure function of seed+config, so stepping further from a
 * fresh world reproduces the same prefix and adds the needed suffix.
 */
async function referenceChecksumAt(
  page: Page,
  reference: (string | null)[],
  tick: number,
): Promise<string | null> {
  if (tick <= reference.length) {
    return reference[tick - 1]!;
  }
  const extended = await referenceRun(page, {
    seed: fixture.seed,
    config: CONFIG_JSON,
    tickCount: tick,
  });
  return extended[tick - 1]!;
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
  // Exactly as many checksums as the fixture records (R9.6: too few is a failure).
  expect(
    protocolChecksums.length,
    `${FIXTURE_NAME}: expected ${FIXTURE_TICKS} checksums, got ${protocolChecksums.length}`,
  ).toBe(FIXTURE_TICKS);
  // Compare every tick; report the first difference (R9.6).
  let firstDiff = -1;
  for (let n = 1; n <= FIXTURE_TICKS; n++) {
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

  // 4. R9.7: no-input reference run of at least FIXTURE_TICKS steps.
  const reference = await referenceRun(page, {
    seed: fixture.seed,
    config: CONFIG_JSON,
    tickCount: FIXTURE_TICKS,
  });
  expect(reference.length).toBe(FIXTURE_TICKS);
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

  // 6. R9.9 (+R4.6, R5.7): Speed 365, Run until tick >= 365 or 10 s, Pause, tick
  //    > 1, unchanged 500 ms later, checksum equals the reference for that tick.
  await page.getByTestId('speed').selectOption('365');
  await page.getByTestId('run').click();
  // Wait until the displayed tick is at least 365, or 10 s pass.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="tick"]');
        const text = el?.textContent ?? '';
        const value = Number(text);
        return Number.isFinite(value) && value >= 365;
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {
      // 10 s elapsed without reaching 365; the pause check below still applies.
    });
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('run-state')).toHaveText('paused', { timeout: 5_000 });

  const tickAfterPause = Number(await page.getByTestId('tick').textContent());
  const checksumAfterPause = (await page.getByTestId('checksum').textContent()) ?? '';
  expect(tickAfterPause, 'displayed tick after pause is greater than 1').toBeGreaterThan(1);

  // Unchanged 500 ms later (R4.6, R5.7): paused means no further ticks.
  await page.waitForTimeout(500);
  expect(Number(await page.getByTestId('tick').textContent())).toBe(tickAfterPause);
  expect((await page.getByTestId('checksum').textContent()) ?? '').toBe(checksumAfterPause);

  // The displayed checksum equals the no-input reference for that tick (R9.9),
  // extending the reference through the harness if the tick is past its end.
  const expectedAtPause = await referenceChecksumAt(page, reference, tickAfterPause);
  expect(
    checksumAfterPause,
    `paused at tick ${tickAfterPause}: expected reference checksum ${
      expectedAtPause ?? 'null'
    }, displayed ${checksumAfterPause}`,
  ).toBe(expectedAtPause);

  // No off-origin request (R9.4) and no page console error (R9.10) occurred.
  finish();
});
