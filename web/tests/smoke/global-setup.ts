// Playwright global setup for the Smoke_Test (R9.3, R9.12), run once before any
// smoke spec and before Playwright's `webServer` opens the page.
//
// Two checks, IN THIS ORDER, both performed BEFORE launching the page:
//
//   1. R9.12 (fixture first): read and JSON.parse
//      `fixtures/parity/seedbig-pairwise.replay.json`. If it cannot be read or
//      parsed, throw
//        cannot read fixture seedbig-pairwise.replay.json: <reason>
//      This runs first, so a missing or corrupt fixture fails the run before
//      any browser is launched.
//   2. R9.3 (system Chrome present): launch the system Chrome through Playwright's
//      `chromium.launch({ channel: 'chrome' })` to confirm it exists, then close
//      it immediately. On failure, rethrow as
//        system Chrome not found (Playwright channel 'chrome'): <message>
//      so a machine without Chrome fails with a clear message and a non-zero exit.
//
// This file stays focused on those two checks. Per-test wiring (blocking
// non-preview origins, failing on console errors and `ok: false` replies) lives
// in the spec files / a test-fixtures helper added in task 5.2.
//
// Run directly by Node (type-stripping); no compile step. Covered by
// tsconfig.node.json (tests/**/*.ts).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type FullConfig } from '@playwright/test';

// Repo-root path of the Parity_Fixture. This file is web/tests/smoke/, so the
// repo root is three levels up; the fixture lives at fixtures/parity/.
const FIXTURE_NAME = 'seedbig-pairwise.replay.json';
const fixturePath = fileURLToPath(
  new URL(`../../../fixtures/parity/${FIXTURE_NAME}`, import.meta.url),
);

/**
 * Read and parse the Parity_Fixture (R9.12). Exported so the spec files (task
 * 5.2) can reuse the same path and parsed shape. Throws
 * `cannot read fixture <name>: <reason>` on any read or parse failure, before
 * any browser is launched.
 */
export function readFixture(): unknown {
  let text: string;
  try {
    text = readFileSync(fixturePath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot read fixture ${FIXTURE_NAME}: ${reason}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot read fixture ${FIXTURE_NAME}: ${reason}`);
  }
}

/**
 * Confirm the system Chrome launches through Playwright's `chrome` channel
 * (R9.3). Launches and immediately closes a browser; leaves nothing running.
 * Rethrows any failure as `system Chrome not found (Playwright channel
 * 'chrome'): <message>`.
 */
export async function assertSystemChrome(): Promise<void> {
  try {
    const browser = await chromium.launch({ channel: 'chrome' });
    await browser.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`system Chrome not found (Playwright channel 'chrome'): ${message}`);
  }
}

// Playwright calls the default export once before the test run. The parameter is
// unused here; the two checks need no config.
export default async function globalSetup(_config: FullConfig): Promise<void> {
  // 1. Fixture first (R9.12), before launching Chrome.
  readFixture();
  // 2. System Chrome present (R9.3).
  await assertSystemChrome();
}
