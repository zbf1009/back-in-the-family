// C4 reuses the established offline preview/component servers and zero retries.
// The longer budget covers distinct real operation branches, not animation waits.
import { defineConfig } from '@playwright/test';
import lifeView from './playwright.life-view.config.ts';

export default defineConfig({
  ...lifeView,
  testIgnore: [],
  timeout: 180_000,
  globalTimeout: 1_800_000,
  outputDir: './test-results/life-c4',
});
