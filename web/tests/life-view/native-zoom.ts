/// <reference lib="dom" />
// Use a private Chrome profile and the real browser Page zoom control.
// CSS zoom, deviceScaleFactor and pinch/pageScale emulation are not browser zoom.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
declare const chrome: {
  settingsPrivate: { getDefaultZoom(callback: (value: number) => void): void };
};

export { expect };
export const test = base.extend({
  context: async ({ viewport, baseURL }, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'life-c4-native-zoom-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: true, viewport, baseURL,
    });
    try {
      const settings = await context.newPage();
      await settings.goto('chrome://settings/appearance');
      await settings.getByRole('combobox', { name: 'Page zoom', exact: true }).selectOption({ label: '200%' });
      await expect.poll(() => settings.evaluate(() => {
        const { promise, resolve } = Promise.withResolvers<number>();
        chrome.settingsPrivate.getDefaultZoom(resolve);
        return promise;
      })).toBe(2);
      await settings.close();
      await use(context);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
});

export async function nativeZoomMetrics(page: Page): Promise<{
  innerWidth: number; innerHeight: number; devicePixelRatio: number; viewportScale: number;
}> {
  const metrics = await page.evaluate(() => ({
    innerWidth, innerHeight, devicePixelRatio, viewportScale: visualViewport!.scale,
  }));
  const viewport = page.viewportSize()!;
  expect(metrics).toEqual({
    innerWidth: viewport.width / 2, innerHeight: viewport.height / 2,
    devicePixelRatio: 2, viewportScale: 1,
  });
  return metrics;
}

export async function nativeZoomScreenshot(page: Page): Promise<Buffer> {
  const session = await page.context().newCDPSession(page);
  try {
    // Native page zoom changes CSS coordinates. Capture the actual viewport,
    // not Playwright's CSS-coordinate clip translated through that zoom.
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    const bytes = Buffer.from(data, 'base64');
    const viewport = page.viewportSize()!;
    expect(bytes.readUInt32BE(16)).toBe(viewport.width);
    expect(bytes.readUInt32BE(20)).toBe(viewport.height);
    return bytes;
  } finally {
    await session.detach();
  }
}
