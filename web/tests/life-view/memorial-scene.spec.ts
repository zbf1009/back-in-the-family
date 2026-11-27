/// <reference lib="dom" />
// Constructed facts drive production KeyScene/ScenePicture; no Worker or rule input is created.
import { expect, test, type Page } from '@playwright/test';
import type { StoryEvent } from '../../src/shared/story.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const ORIGIN = 'http://localhost:5174';
test.use({ headless: false, launchOptions: { args: ['--window-position=-10000,-10000'] } });
interface Evidence { world: WorldSnapshot; facts: StoryEvent[]; identity: readonly [number, string]; lines: string[];
  closeCount: number; settledCount: number; ordinaryTicks: number; inputs: unknown[] }
declare const window: Window & { __memorialSceneFixture?: { read(): Evidence }; __memorialAnimationStarts: number };
async function readFixture(page: Page): Promise<Evidence> {
  return page.evaluate(() => {
    if (window.__memorialSceneFixture === undefined) throw Error('Memorial component evidence is unavailable');
    return window.__memorialSceneFixture.read();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let starts = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) { starts++; return animate.apply(this, args); };
    Object.defineProperty(window, '__memorialAnimationStarts', { get: () => starts });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === ORIGIN && !url.pathname.startsWith('/api/')) return route.continue();
    throw Error(`Unexpected memorial fixture request: ${url}`);
  });
});

for (const control of ['show-all', 'skip', 'truncate', 'elapsed', 'reduced'] as const) {
  test(`Memorial ${control} settles without Close, input or lost facts`, async ({ page }) => {
    if (control === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (control === 'elapsed') await page.clock.install();
    await page.goto(`${ORIGIN}/memorial-scene-fixture.html`);
    const scene = page.getByTestId('key-scene');
    await expect(scene).toBeVisible();
    const initial = await readFixture(page);
    if (control === 'show-all') await scene.getByRole('button', { name: 'Show all', exact: true }).press('Enter');
    if (control === 'skip') await scene.getByTestId('scene-skip').press('Enter');
    if (control === 'truncate') await page.getByTestId('fixture-truncate').press('Enter');
    if (control === 'elapsed') await page.clock.fastForward(5100);
    await expect(scene).toHaveAttribute('data-beat', 'settled');
    await page.getByTestId('fixture-tick').press('Enter');
    await expect(scene).toBeVisible();
    const after = await readFixture(page);
    expect(after.world).toEqual(initial.world);
    expect(after.facts).toEqual(initial.facts);
    expect(after.identity).toEqual(initial.identity);
    expect(after.closeCount).toBe(0);
    expect(after.settledCount).toBe(1);
    expect(after.inputs).toEqual([]);
    expect(after.ordinaryTicks).toBe(1);
    await expect(scene.getByTestId('scene-close')).toBeEnabled();
    await scene.getByTestId('scene-close').press('Enter');
    await expect(scene).toHaveCount(0);
    expect((await readFixture(page)).closeCount).toBe(1);
  });
}

test('Late estate preserves active animation and exact Death identity without a second performance', async ({ page }) => {
  await page.goto(`${ORIGIN}/memorial-scene-fixture.html`);
  const scene = page.getByTestId('key-scene');
  await expect(scene).toHaveAttribute('data-beat', 'establish');
  const initial = await readFixture(page);
  const animationStarts = await page.evaluate(() => window.__memorialAnimationStarts);
  expect(animationStarts).toBeGreaterThan(0);
  await page.getByTestId('fixture-estate').press('Enter');
  const after = await readFixture(page);
  expect(after.identity).toEqual(initial.identity);
  expect(after.world).toEqual(initial.world);
  expect(after.facts.map(event => event.id)).toEqual(['9007199254740993', '9007199254740994']);
  expect(after.lines.some(line => line.includes('Olive') && line.includes('60'))).toBe(true);
  expect(after.lines.some(line => line.includes('$640'))).toBe(true);
  expect(after.settledCount).toBe(0);
  expect(after.closeCount).toBe(0);
  expect(after.inputs).toEqual([]);
  expect(await page.evaluate(() => window.__memorialAnimationStarts)).toBe(animationStarts);
  await scene.getByTestId('scene-skip').press('Enter');
  const settled = await readFixture(page);
  await page.getByTestId('fixture-estate').press('Enter');
  expect((await readFixture(page)).settledCount).toBe(settled.settledCount);
  expect(await page.evaluate(() => window.__memorialAnimationStarts)).toBe(animationStarts);
});

test('Estate delivered after explicit Close retains raw facts but does not reopen the card', async ({ page }) => {
  await page.goto(`${ORIGIN}/memorial-scene-fixture.html`);
  await page.getByTestId('scene-close').press('Enter');
  const closed = await readFixture(page);
  await page.getByTestId('fixture-estate').press('Enter');
  await expect(page.getByTestId('key-scene')).toHaveCount(0);
  const after = await readFixture(page);
  expect(after.closeCount).toBe(closed.closeCount);
  expect(after.lines).toEqual(closed.lines);
  expect(after.facts).toHaveLength(2);
  expect(after.inputs).toEqual([]);
  expect(after.world).toEqual(closed.world);
});

test('Full facts are available to accessibility immediately and the memorial has no decision controls', async ({ page }) => {
  await page.goto(`${ORIGIN}/memorial-scene-fixture.html`);
  const scene = page.getByTestId('key-scene');
  await expect(scene).toBeVisible();
  await expect(scene.getByRole('button')).toHaveCount(3);
  await expect(scene.getByRole('button', { name: 'Show all', exact: true })).toBeEnabled();
  await expect(scene.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
  await expect(scene.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  const accessible = await scene.ariaSnapshot();
  expect(accessible).toContain('Your mother Olive died. 60 years old.');
  expect(accessible).toContain('Olive Cooper');
  expect(accessible).toContain('Age');
  expect(accessible).toContain('60');
  expect((await readFixture(page)).inputs).toEqual([]);
});

test.describe('Actual memorial tab visibility', () => {
  test('Hidden settlement and return retain the card and both facts without input', async ({ page, context }) => {
    await page.goto(`${ORIGIN}/memorial-scene-fixture.html`);
    const scene = page.getByTestId('key-scene');
    await expect(scene).toBeVisible();
    await page.getByTestId('fixture-estate').press('Enter');
    const initial = await readFixture(page);
    const cdp = await context.newCDPSession(page);
    const primary = Reflect.get(page, '_connection')?.toImpl?.(page)?.delegate?._mainFrameSession?._client;
    if (typeof primary?.send !== 'function') throw Error('Pinned Chromium FrameSession is unavailable');
    await primary.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
    const originalWindow = await cdp.send('Browser.getWindowForTarget');
    const other = await context.newPage();
    const otherCdp = await context.newCDPSession(other);
    const otherPrimary = Reflect.get(other, '_connection')?.toImpl?.(other)?.delegate?._mainFrameSession?._client;
    if (typeof otherPrimary?.send !== 'function') throw Error('Second Chromium FrameSession is unavailable');
    await otherPrimary.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    expect((await otherCdp.send('Browser.getWindowForTarget')).windowId).toBe(originalWindow.windowId);
    await other.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
    await expect(scene).toBeVisible();
    await expect(scene).toHaveAttribute('data-beat', 'settled');
    const after = await readFixture(page);
    expect(after.facts).toEqual(initial.facts);
    expect(after.world).toEqual(initial.world);
    expect(after.identity).toEqual(initial.identity);
    expect(after.closeCount).toBe(0);
    expect(after.inputs).toEqual([]);
    await otherCdp.detach();
    await other.close();
    await cdp.detach();
  });
});
