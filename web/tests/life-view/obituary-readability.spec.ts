/// <reference lib="dom" />
// Real Chrome browser zoom and narrow production App screenshots. The same
// locally confined, actual-native-fact transport fixture is used throughout.
import { expect, test as ordinary } from '@playwright/test';
import { test as zoom, nativeZoomMetrics, nativeZoomScreenshot } from './native-zoom.ts';
import { act, create, openApp, posts, records, resolve, tabTo, terminal } from './obituary-fixture.ts';

zoom.describe('Production obituary at native browser zoom', () => {
zoom.use({ viewport: { width: 1280, height: 800 } });
zoom('200% browser zoom keeps the obituary readable and original keyboard controls reachable', async ({ page }, info) => {
  await openApp(page, '', true); await create(page); await act(page, 'death');
  await nativeZoomMetrics(page);
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  await resolve(page); const record = await terminal(page, 'model');
  expect(record.ready).toBe(false);
  const skip = page.getByTestId('scene-skip');
  await tabTo(page, skip);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('obituary')).toHaveCount(1);
  const close = page.getByTestId('scene-close');
  await tabTo(page, close);
  await info.attach('production-app-200-percent-keyboard-close', { body: await nativeZoomScreenshot(page), contentType: 'image/png' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('key-scene')).toHaveCount(0);
  const paragraph = page.getByTestId('obituary').locator('p');
  await paragraph.scrollIntoViewIfNeeded();
  expect(await paragraph.textContent()).toBe(record.result!.text);
  const metrics = await paragraph.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { left: rect.left, right: rect.right, viewport: innerWidth,
      width: element.clientWidth, content: element.scrollWidth,
      height: element.clientHeight, contentHeight: element.scrollHeight,
      font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
  });
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.content).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.contentHeight).toBeLessThanOrEqual(metrics.height + 1);
  expect(metrics.font).toBeGreaterThanOrEqual(18);
  expect(metrics.line).toBeGreaterThanOrEqual(metrics.font * 1.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await info.attach('production-app-200-percent-obituary', { body: await nativeZoomScreenshot(page), contentType: 'image/png' });
  await tabTo(page, page.getByTestId('run'));
  expect((await records(page))[0]).toEqual({ ...record, ready: true });
  expect((await posts(page)).length).toBe(1);
});
});

ordinary.describe('Production obituary on narrow screens', () => {
ordinary.use({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
ordinary('375px production App preserves every obituary word, factual death card and ordinary action', async ({ page }, info) => {
  await openApp(page, 'capability=public'); await create(page); await act(page, 'death');
  const record = await terminal(page, 'template');
  await expect(page.getByTestId('obituary')).toHaveCount(1);
  const paragraph = page.getByTestId('obituary').locator('p');
  expect(await paragraph.textContent()).toBe(record.result!.text);
  expect(await paragraph.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByTestId('obituary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('obituary-production-app-375px.png'), fullPage: true });
  await tabTo(page, page.getByTestId('scene-close'));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('key-scene')).toHaveCount(0);
  await expect(page.getByTestId('obituary')).toHaveCount(1);
  await expect(page.getByTestId('run')).toBeEnabled();
  expect(await posts(page)).toEqual([]);
});
});
