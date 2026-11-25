// Browser Smoke_Test for main-thread responsiveness and display cadence (task 5.3).
//
// Validates: web-shell Requirements 5.4, 5.5 and first-playable R16.13.
//
// Drives the BUILT page (web/dist) served by Local_Preview in the system Chrome
// and checks, while the simulation fast-forwards at every Speed, that:
//
//   - R16.13 no Main_Thread task lasts longer than 50 ms from before Run until
//     500 ms after the first automatic stop or the user pause at 10 s. Speed 1
//     must run the full 10 s; higher Speeds may stop before a running sample.
//   - R5.4  while the Run_State is `running`, the displayed tick advances at
//     least once every 250 ms. Measured in-page by sampling the `tick` and
//     `run-state` data-testids on a short interval across the running period and
//     checking that, between consecutive samples that are both `running`, the
//     displayed tick never stays unchanged for longer than 250 ms. The last
//     sample before pause is allowed not to advance (a batch may be in flight or
//     the run has just been paused), so the cadence is asserted only over
//     windows that both begin and end while `running`.
//
// The run is driven through the PAGE CONTROLS (seed input, config textarea,
// Speed select, Create / Run / Pause buttons), exactly as a developer would, so
// the page's own UiState is the world being measured and its `run-state` becomes
// `running`. (The harness feeds the same SimClient, but the page reducer only
// adopts worker status for the world the PAGE created, so page controls are the
// right driver for a display-cadence check.) The long-task observer and the
// display sampling run in page.evaluate; the control clicks are Playwright
// locator actions between them.
//
// All five Speeds are exercised inside the unchanged 120 s / 170 s bounds.
//
// Run directly by Node (type-stripping); covered by tsconfig.node.json (Node
// lib, no DOM), so the browser globals the evaluate callbacks touch are declared
// below with just the surface this file uses.

import { test, expect, type Page } from '@playwright/test';
import { readFixture } from './global-setup.ts';
import { SPEEDS } from '../../src/shared/speeds.ts';

// --- browser-side types for page.evaluate callbacks -------------------------
//
// These callbacks run in the browser, but this spec is type-checked under
// tsconfig.node.json (no DOM lib), so the browser surface they use is declared
// here with just the parts touched: a long-task buffer stashed on `window`, the
// PerformanceObserver long-task entry, `performance.now`, `setTimeout`, and the
// one document query that reads a data-testid.

interface LongTaskEntry {
  readonly duration: number;
  readonly startTime: number;
}
interface ObservedList {
  getEntries(): LongTaskEntry[];
}
interface BrowserWindow {
  /** Long-task durations (ms) collected by the observer installed before Run. */
  __longTasks?: number[];
  __longTaskObserver?: { disconnect(): void };
  __runStartedAt?: number;
  performance: { now(): number };
  setTimeout(handler: () => void, timeout: number): number;
}
declare const window: BrowserWindow;
declare const document: {
  querySelector(selectors: string): {
    textContent: string | null;
    addEventListener(type: 'click', listener: () => void, options: { once: boolean; capture: boolean }): void;
  } | null;
};
declare const PerformanceObserver: {
  new (callback: (list: ObservedList) => void): {
    observe(options: { type: string; buffered: boolean }): void;
    disconnect(): void;
  };
};

// --- fixture shape (seed + config only) -------------------------------------

interface ReplayFixture {
  seed: string;
  config: { entity_count: number; workload: string };
}

const fixture = readFixture() as ReplayFixture;
// A valid seed and config: reuse the fixture's, as the task allows.
const SEED = fixture.seed;
const CONFIG_JSON = JSON.stringify(fixture.config);

// --- measurement parameters -------------------------------------------------

// R16.13 measures to the first stop or 10 s; Speed 1 must reach the full limit.
const RUN_MS = 10_000;
// R5.5: fail on any main-thread long task over this many milliseconds.
const LONGTASK_LIMIT_MS = 50;
// R5.4: the displayed tick must advance at least this often while running.
const CADENCE_LIMIT_MS = 250;
// How often the in-page loop samples the display. Well under CADENCE_LIMIT_MS so
// a stall longer than 250 ms is caught, but not so tight that the sampling loop
// itself dominates the main thread.
const SAMPLE_INTERVAL_MS = 50;

/** The display-cadence result one in-page sampling run returns for one speed. */
interface CadenceResult {
  /**
   * The longest gap (ms) during which the displayed tick did not advance while
   * the Run_State was `running`, measured only over windows that both start and
   * end `running`. -1 if the tick advanced on every running sample.
   */
  worstCadenceGapMs: number;
  /** Diagnostics only: a high-Speed stop need not leave a running sample. */
  runningSamples: number;
  /** The last tick value seen while running (decimal string or null). */
  lastRunningTick: string | null;
  endedBy: 'stop' | 'limit';
  elapsedMs: number;
}

/** Observe only this run's tasks, including the post-stop Snapshot delivery. */
async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__longTaskObserver?.disconnect();
    delete window.__runStartedAt;
    window.__longTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks!.push(entry.duration);
      }
    });
    window.__longTaskObserver = observer;
    observer.observe({ type: 'longtask', buffered: false });
    const run = document.querySelector('[data-testid="run"]');
    if (run === null) throw new Error('Run control is missing');
    run.addEventListener('click', () => { window.__runStartedAt = window.performance.now(); },
      { once: true, capture: true });
  });
}

/**
 * Sample the page display every SAMPLE_INTERVAL_MS for `runMs`, tracking the
 * longest stretch the displayed tick stays unchanged across two consecutive
 * samples that are both `running` (R5.4). Runs in the page so each sample reads
 * the DOM directly and the awaited timer yields the event loop between samples,
 * keeping the main thread free.
 */
async function sampleCadence(
  page: Page,
  args: { runMs: number; sampleMs: number },
): Promise<CadenceResult> {
  return page.evaluate(
    async ({ runMs, sampleMs }) => {
      const readTestId = (id: string): string | null =>
        document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

      let worstCadenceGapMs = -1;
      let runningSamples = 0;
      // The tick value seen in the previous running sample, to detect advances.
      let prevRunningTick: string | null = null;
      // The last tick value seen while running, returned for reporting.
      let lastRunningTick: string | null = null;
      // The time (performance.now) at which the current unchanged-tick window
      // began; used to measure how long the displayed tick stays unchanged.
      let lastTickSeenAt = 0;
      // Whether the previous sample was running (so a window is running->running).
      let prevWasRunning = false;

      const start = window.__runStartedAt;
      if (start === undefined) throw new Error('Run activation was not observed');
      for (;;) {
        const now = window.performance.now();

        const isRunning = readTestId('run-state') === 'running';
        const tickText = readTestId('tick');
        const stopped = readTestId('run-state') === 'paused' && Number(tickText) > 0;
        if (stopped || now - start >= runMs) {
          return { worstCadenceGapMs, runningSamples, lastRunningTick,
            endedBy: stopped ? 'stop' : 'limit', elapsedMs: now - start };
        }

        if (isRunning) {
          runningSamples++;
          lastRunningTick = tickText;
          if (!prevWasRunning) {
            // First running sample, or first after a non-running gap: open a new
            // window; do not measure a gap that spans a non-running stretch.
            lastTickSeenAt = now;
          } else if (tickText !== prevRunningTick) {
            // The tick advanced since the previous running sample; close the window.
            lastTickSeenAt = now;
          } else {
            // Both this and the previous sample were running and the displayed
            // tick is unchanged: the gap is how long it has stayed unchanged.
            const gap = now - lastTickSeenAt;
            if (gap > worstCadenceGapMs) worstCadenceGapMs = gap;
          }
          prevRunningTick = tickText;
        }
        prevWasRunning = isRunning;

        await new Promise<void>((resolve) => window.setTimeout(resolve, sampleMs));
      }

    },
    args,
  );
}

/** Read and reset the collected long-task durations (ms) from the page buffer. */
async function readLongTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const tasks = window.__longTasks ?? [];
    window.__longTaskObserver?.disconnect();
    window.__longTasks = [];
    return tasks;
  });
}
async function openWorldSetup(page: Page): Promise<void> {
  const disclosure = page.getByTestId('world-setup');
  if (await disclosure.getAttribute('open') === null) await disclosure.locator('summary').click();
}

// --- shared page setup (same shape as fixture.spec) -------------------------

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

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto('/?harness=1');
  const technical = page.getByTestId('technical-details');
  if (await technical.getAttribute('open') === null) await technical.locator('summary').click();

  return {
    finish() {
      expect(offOrigin, `off-preview-origin requests: ${offOrigin.join(', ')}`).toEqual([]);
      expect(consoleErrors, `page console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    },
  };
}

// --- per-speed driver -------------------------------------------------------

/**
 * Create at tick 0, Run to the first stop or 10 s, and observe through paused
 * plus 500 ms. Only the time-limit branch activates the Pause control.
 */
async function measureSpeed(
  page: Page,
  speed: number,
): Promise<{ longTasks: number[]; cadence: CadenceResult; pausedTick: number; runToPauseMs: number }> {
  // Create a fresh world from the page (seed + config + Create).
  await openWorldSetup(page);
  await page.getByTestId('seed').fill(SEED);
  await page.getByTestId('config').fill(CONFIG_JSON);
  await page.getByTestId('create').click();
  await expect(page.getByTestId('run-state')).toHaveText('paused', { timeout: 5_000 });
  await expect(page.getByTestId('tick')).toHaveText('0', { timeout: 5_000 });

  // Select the Speed from the fixed list (R4.4) before running.
  await page.getByTestId('speed').selectOption(String(speed));

  // Install the long-task observer BEFORE Run so the whole running period is
  // covered (R5.5).
  await installLongTaskObserver(page);

  // Do not await running: the stop may already be visible when click returns.
  await page.getByTestId('run').click();

  const cadence = await sampleCadence(page, { runMs: RUN_MS, sampleMs: SAMPLE_INTERVAL_MS });

  if (speed === 1) {
    expect(cadence.endedBy, 'Speed 1 must run for the full 10 s').toBe('limit');
    expect(cadence.elapsedMs).toBeGreaterThanOrEqual(RUN_MS);
    await expect(page.getByTestId('run-state')).toHaveText('running');
  }
  if (cadence.endedBy === 'limit') await page.getByTestId('pause').click();
  await expect(page.getByTestId('run-state')).toHaveText('paused', { timeout: 5_000 });
  const pausedTick = Number(await page.getByTestId('tick').textContent());
  expect(pausedTick, 'paused at a positive tick proves Run advanced').toBeGreaterThan(0);
  const runToPauseMs = await page.evaluate(() => {
    if (window.__runStartedAt === undefined) throw new Error('Run activation was not observed');
    return window.performance.now() - window.__runStartedAt;
  });
  await page.waitForTimeout(500);
  const longTasks = await readLongTasks(page);

  return { longTasks, cadence, pausedTick, runToPauseMs };
}

// --- the test ---------------------------------------------------------------

test('main thread stays responsive and the display keeps cadence at every speed', async ({
  page,
  baseURL,
}) => {
  const testStarted = Date.now();
  const { finish } = await openHarnessPage(page, baseURL);

  for (const speed of SPEEDS) {
    const { longTasks, cadence, pausedTick, runToPauseMs } = await measureSpeed(page, speed);
    const maxLongTaskMs = longTasks.reduce((max, d) => (d > max ? d : max), 0);
    // Diagnostic line (not an assertion): the per-speed measurement summary.
    console.log(
      `[responsive] speed ${speed}: maxLongTask=${maxLongTaskMs.toFixed(1)}ms ` +
        `longTasks=${longTasks.length} worstCadenceGap=${cadence.worstCadenceGapMs.toFixed(1)}ms ` +
        `runningSamples=${cadence.runningSamples} lastTick=${cadence.lastRunningTick ?? 'null'} ` +
        `end=${cadence.endedBy === 'stop' ? 'automatic' : 'user'} pausedTick=${pausedTick} ` +
        `runToPauseMs=${runToPauseMs.toFixed(1)}`,
    );


    // R16.13: the bound includes the stop and its Snapshot plus 500 ms.
    // The simulation runs in the worker, so this should hold with margin; a
    // violation is a real responsiveness problem (do not weaken the bound).
    expect(
      maxLongTaskMs,
      `speed ${speed}: longest main-thread task ${maxLongTaskMs.toFixed(
        1,
      )} ms exceeds the ${LONGTASK_LIMIT_MS} ms bound (long tasks: ${longTasks
        .map((d) => d.toFixed(1))
        .join(', ')})`,
    ).toBeLessThanOrEqual(LONGTASK_LIMIT_MS);

    // R5.4: while running, the displayed tick advanced at least every 250 ms.
    // worstCadenceGapMs is the longest the tick stayed unchanged across two
    // consecutive running samples; -1 means it advanced on every running sample.
    // The final tick not advancing when paused is allowed: only running->running
    // windows are measured (see sampleCadence).
    expect(
      cadence.worstCadenceGapMs,
      `speed ${speed}: displayed tick stayed unchanged for ${cadence.worstCadenceGapMs.toFixed(
        1,
      )} ms while running, longer than the ${CADENCE_LIMIT_MS} ms cadence bound (last tick ${
        cadence.lastRunningTick ?? 'null'
      })`,
    ).toBeLessThanOrEqual(CADENCE_LIMIT_MS);
  }

  finish();
  console.log(`[responsive] totalMs=${Date.now() - testStarted}`);
});
