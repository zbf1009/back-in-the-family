/// <reference lib="dom" />
// Constructed component-only carriers exercise the production scene bundle and
// guarded callbacks. Actual Chromium tab visibility is never overridden.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { UiState } from '../../src/main/ui-state.ts';
import type { SceneEntry } from '../../src/main/scene-queue.ts';

const ORIGIN = process.env.LIFE_HIDDEN_BUNDLE_COMPONENT_ORIGIN ?? 'http://localhost:5174';
interface FixtureEvidence {
  mode: 'COMPONENT-ONLY';
  source: { baseline: string; modifiedFields: string[]; limits: string };
  ui: Pick<UiState, 'worldId' | 'tick' | 'checksum' | 'world' | 'scene' | 'settledScene' | 'actions'>;
  callbacks: Record<string, unknown>[];
}
interface AnimationEvidence { identity: string | null; category: string | null }
declare const window: Window & {
  __hiddenBundleFixture?: { read(): FixtureEvidence };
  __hiddenBundleAnimations?: AnimationEvidence[];
};

// Match the existing pinned-Chromium actual-visibility fixture: a second tab in
// the same real window backgrounds this page, with Playwright focus emulation off.
test.use({ headless: false, reducedMotion: 'no-preference', viewport: { width: 1280, height: 720 },
  launchOptions: { args: ['--window-position=-10000,-10000'] } });
const failures = new WeakMap<Page, { errors: string[]; forbidden: string[] }>();
test.beforeEach(async ({ page }) => {
  const result = { errors: [] as string[], forbidden: [] as string[] };
  failures.set(page, result);
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === ORIGIN && !url.pathname.startsWith('/api/')) return route.continue();
    result.forbidden.push(route.request().url());
    await route.abort();
  });
  await page.addInitScript(() => {
    window.__hiddenBundleAnimations = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes: Parameters<Element['animate']>[0], options?: Parameters<Element['animate']>[1]): Animation {
      const scene = this.closest('[data-testid="key-scene"]');
      if (scene !== null) window.__hiddenBundleAnimations!.push({ identity: scene.getAttribute('data-identity'), category: scene.getAttribute('data-category') });
      return original.call(this, keyframes, options);
    };
  });
});
test.afterEach(({ page }) => {
  expect(failures.get(page)?.forbidden).toEqual([]);
  expect(failures.get(page)?.errors).toEqual([]);
});

async function readFixture(page: Page): Promise<FixtureEvidence> {
  return page.evaluate(() => {
    if (window.__hiddenBundleFixture === undefined) throw Error('Read-only hidden bundle fixture is missing');
    return window.__hiddenBundleFixture.read();
  });
}
async function animationCalls(page: Page): Promise<AnimationEvidence[]> {
  return page.evaluate(() => window.__hiddenBundleAnimations ?? []);
}
async function disableFocusEmulation(page: Page): Promise<void> {
  const connection = Reflect.get(page, '_connection');
  const primary = connection?.toImpl?.(page)?.delegate?._mainFrameSession?._client;
  if (typeof primary?.send !== 'function') throw Error('Pinned Chromium FrameSession is unavailable');
  await primary.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}
async function background(page: Page, context: BrowserContext): Promise<Page> {
  const cdp = await context.newCDPSession(page);
  const originalWindow = await cdp.send('Browser.getWindowForTarget');
  const other = await context.newPage();
  await disableFocusEmulation(other);
  const otherCdp = await context.newCDPSession(other);
  expect((await otherCdp.send('Browser.getWindowForTarget')).windowId).toBe(originalWindow.windowId);
  await other.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
  await otherCdp.detach();
  await cdp.detach();
  return other;
}
async function open(page: Page, arrivalOnly = false): Promise<FixtureEvidence> {
  await disableFocusEmulation(page);
  await page.goto(`${ORIGIN}/hidden-bundle-fixture.html${arrivalOnly ? '?state=arrival-only' : ''}`);
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
  await expect(page.getByTestId('hidden-bundle-fixture')).toHaveAttribute('data-assets', 'ready');
  await expect.poll(async () => (await animationCalls(page)).length).toBeGreaterThan(0);
  await expect(page.getByTestId('key-scene')).not.toHaveAttribute('data-beat', 'settled');
  const fixture = await readFixture(page);
  expect(fixture.mode).toBe('COMPONENT-ONLY');
  expect(fixture.source.limits).toContain('Not live App/WASM');
  return fixture;
}
async function sceneFacts(page: Page, entry: SceneEntry, settledText = false): Promise<void> {
  const scene = page.getByTestId('key-scene');
  const view = entry.keyScene!;
  expect(entry.identity).toBe(JSON.stringify(view.identity));
  await expect(scene).toHaveAttribute('data-identity', entry.identity);
  await expect(scene).toHaveAttribute('data-category', view.category);
  await expect(scene).toHaveAccessibleName(view.title);
  for (const line of view.lines) {
    await expect(scene.locator('.accessible-facts')).toContainText(line);
    if (settledText) await expect(scene.locator('.scene-paragraphs')).toContainText(line);
  }
  for (const field of view.document.fields) {
    await expect(scene.locator('.accessible-facts')).toContainText(field.label);
    await expect(scene.locator('.accessible-facts')).toContainText(field.value);
  }
}
function unchangedWorld(fixture: FixtureEvidence, baseline: FixtureEvidence): void {
  expect(fixture.ui.worldId).toBe(baseline.ui.worldId);
  expect(fixture.ui.tick).toBe(baseline.ui.tick);
  expect(fixture.ui.checksum).toBe(baseline.ui.checksum);
  expect(fixture.ui.world).toEqual(baseline.ui.world);
  expect(fixture.ui.actions).toEqual([]);
  expect(fixture.callbacks.filter(callback => ['choose', 'dream', 'claim', 'bribe', 'haunt'].includes(String(callback.kind)))).toEqual([]);
}
async function finalScene(page: Page, entry: SceneEntry, expectedCalls: number, baseline: FixtureEvidence): Promise<void> {
  const scene = page.getByTestId('key-scene');
  await expect(scene).toHaveAttribute('data-beat', 'settled');
  await sceneFacts(page, entry, true);
  expect((await animationCalls(page)).length).toBe(expectedCalls);
  expect(await scene.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  const fixture = await readFixture(page);
  expect(fixture.ui.settledScene?.entry.identity).toBe(entry.identity);
  expect(fixture.callbacks.filter(callback => callback.kind === 'settled' && callback.identity === entry.identity).at(-1)).toMatchObject({ accepted: true });
  unchangedWorld(fixture, baseline);
}

test('Hidden arrival/death bundle stays final through Continue; visible tick and World bundles still perform', async ({ page, context }, testInfo) => {
  const initial = await open(page);
  const [arrival, death] = initial.ui.scene!.entries;
  expect(initial.ui.scene!.entries).toHaveLength(2);
  expect([arrival!.keyScene!.category, death!.keyScene!.category]).toEqual(['rebirth', 'death']);
  const calls = (await animationCalls(page)).length;
  const other = await background(page, context);
  await finalScene(page, arrival!, calls, initial);
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
  await finalScene(page, arrival!, calls, initial);
  await expect(page.getByTestId('scene-close')).toHaveText('Continue');
  await page.getByTestId('scene-close').press('Enter');
  await finalScene(page, death!, calls, initial);
  const continued = await readFixture(page);
  expect(continued.ui.scene!.entries.map(entry => entry.identity)).toEqual([death!.identity]);
  expect(continued.callbacks.filter(callback => callback.kind === 'close')).toEqual([
    { kind: 'close', identity: arrival!.identity, settled: true, accepted: true },
  ]);
  await page.getByTestId('scene-close').press('Enter');
  await expect(page.getByTestId('key-scene')).toHaveCount(0);
  const closed = await readFixture(page);
  expect(closed.ui.scene).toBeNull();
  expect(closed.callbacks.filter(callback => callback.kind === 'close')).toEqual([
    { kind: 'close', identity: arrival!.identity, settled: true, accepted: true },
    { kind: 'close', identity: death!.identity, settled: true, accepted: true },
  ]);
  unchangedWorld(closed, initial);

  await page.getByTestId('fixture-next-bundle').press('Enter');
  await expect.poll(async () => (await animationCalls(page)).length).toBeGreaterThan(calls);
  const nextTick = await readFixture(page);
  expect(nextTick.ui.worldId).toBe(initial.ui.worldId);
  expect(nextTick.ui.tick).not.toBe(initial.ui.tick);
  await expect(page.getByTestId('key-scene')).not.toHaveAttribute('data-beat', 'settled');
  await sceneFacts(page, nextTick.ui.scene!.entries[0]!);
  expect((await animationCalls(page)).slice(calls)).toContainEqual({
    identity: nextTick.ui.scene!.entries[0]!.identity, category: nextTick.ui.scene!.entries[0]!.keyScene!.category,
  });
  expect(nextTick.ui.checksum).toBe(initial.ui.checksum);
  expect(nextTick.ui.actions).toEqual([]);

  const tickCalls = (await animationCalls(page)).length;
  await page.getByTestId('fixture-next-world').press('Enter');
  await expect.poll(async () => (await animationCalls(page)).length).toBeGreaterThan(tickCalls);
  const nextWorld = await readFixture(page);
  expect(nextWorld.ui.worldId).toBe(initial.ui.worldId + 1);
  expect(nextWorld.ui.tick).toBe(nextTick.ui.tick);
  await expect(page.getByTestId('key-scene')).not.toHaveAttribute('data-beat', 'settled');
  await sceneFacts(page, nextWorld.ui.scene!.entries[0]!);
  expect((await animationCalls(page)).slice(tickCalls)).toContainEqual({
    identity: nextWorld.ui.scene!.entries[0]!.identity, category: nextWorld.ui.scene!.entries[0]!.keyScene!.category,
  });
  expect(nextWorld.ui.checksum).toBe(initial.ui.checksum);
  expect(nextWorld.ui.actions).toEqual([]);
  await testInfo.attach('component-only-hidden-bundle-evidence', {
    body: JSON.stringify({ initial, continued, closed, nextTick, nextWorld, animationCalls: await animationCalls(page) }, null, 2), contentType: 'application/json',
  });
  await other.close();
});

test('A death entry delivered while truly hidden joins the settled bundle without replaying on Continue', async ({ page, context }, testInfo) => {
  const initial = await open(page, true);
  expect(initial.ui.scene!.entries).toHaveLength(1);
  const calls = (await animationCalls(page)).length;
  const other = await background(page, context);
  await page.getByTestId('fixture-append-death').press('Enter');
  await expect.poll(async () => (await readFixture(page)).ui.scene!.entries.length).toBe(2);
  expect(await page.evaluate(() => document.hidden)).toBe(true);
  const appended = await readFixture(page);
  const [arrival, death] = appended.ui.scene!.entries;
  expect(arrival!.identity).toBe(initial.ui.scene!.entries[0]!.identity);
  expect(death!.keyScene!.category).toBe('death');
  await finalScene(page, arrival!, calls, initial);
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
  await page.getByTestId('scene-close').press('Enter');
  await finalScene(page, death!, calls, initial);
  const continued = await readFixture(page);
  expect(continued.callbacks.filter(callback => callback.kind === 'close').at(-1)).toMatchObject({ identity: arrival!.identity, settled: true, accepted: true });
  expect(continued.ui.scene!.entries.map(entry => entry.identity)).toEqual([death!.identity]);
  await page.getByTestId('scene-close').press('Enter');
  await expect(page.getByTestId('key-scene')).toHaveCount(0);
  const closed = await readFixture(page);
  expect(closed.ui.scene).toBeNull();
  expect(closed.callbacks.filter(callback => callback.kind === 'close')).toEqual([
    { kind: 'close', identity: arrival!.identity, settled: true, accepted: true },
    { kind: 'close', identity: death!.identity, settled: true, accepted: true },
  ]);
  unchangedWorld(closed, initial);
  await testInfo.attach('component-only-hidden-arrival-evidence', {
    body: JSON.stringify({ initial, appended, continued, closed, animationCalls: await animationCalls(page) }, null, 2), contentType: 'application/json',
  });
  await other.close();
});
