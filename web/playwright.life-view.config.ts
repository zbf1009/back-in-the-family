// LV-C3: fresh production preview and a separate, test-only Vite HTML entry.
// The existing offline launcher pins tools and confines both servers to loopback.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/life-view',
  globalSetup: './tests/smoke/global-setup.ts',
  testIgnore: ['**/operations.spec.ts', '**/zoom.spec.ts', '**/key-scene.spec.ts'],
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  globalTimeout: 170_000,
  outputDir: './test-results/life-view',
  use: { baseURL: 'http://localhost:4173', channel: 'chrome' },
  webServer: [
    { command: 'pnpm --dir web run preview', url: 'http://localhost:4173', cwd: '..', reuseExistingServer: false, timeout: 30_000 },
    { command: 'pnpm --dir web exec vite --host localhost --port 5174 --strictPort', url: 'http://localhost:5174/life-view-fixture.html', cwd: '..', reuseExistingServer: false, timeout: 30_000 },
  ],
});
