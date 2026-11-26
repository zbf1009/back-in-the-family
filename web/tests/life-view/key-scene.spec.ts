/// <reference lib="dom" />
// Production components with constructed or native-produced carriers. These
// tests prove factual binding and callback isolation, not gameplay or visual acceptance.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { UiState } from '../../src/main/ui-state.ts';
import type { PlayerFamily, PlayerLifecycleFact, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const ORIGIN = 'http://localhost:5174';
test.use({ viewport: { width: 1280, height: 720 } });
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
});
test.afterEach(({ page }) => {
  expect(failures.get(page)?.forbidden).toEqual([]);
  expect(failures.get(page)?.errors).toEqual([]);
});
const families: PlayerFamily[] = ['family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'];
interface FixtureEvidence {
  ui: UiState;
  callbacks: Record<string, unknown>[];
  draws: { method: 'resident' | 'grave'; canvas: string | undefined; visual: string | null }[];
}
declare const window: Window & { __lifeViewFixture?: { read(): unknown } };
async function readFixture(page: Page): Promise<FixtureEvidence> {
  return page.evaluate(() => {
    if (!window.__lifeViewFixture) throw Error('Read-only component fixture is missing');
    return window.__lifeViewFixture.read();
  }) as Promise<FixtureEvidence>;
}
async function open(page: Page, state: string): Promise<FixtureEvidence> {
  await page.goto(`${ORIGIN}/life-view-fixture.html?state=${state}`);
  await expect(page.getByTestId('component-fixture')).toHaveAttribute('data-assets', 'ready');
  return readFixture(page);
}
async function fixtureControls(page: Page): Promise<void> {
  const controls = page.getByTestId('fixture-motion-controls');
  if (await controls.getAttribute('open') === null) await controls.locator(':scope > summary').press('Enter');
}
async function legalOptions(page: Page, world: WorldSnapshot): Promise<void> {
  for (const option of world.player_node!.options) await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
}

for (const family of families) {
  test(`Current ${family} options submit their unchanged node and option`, async ({ page }) => {
    const initial = await open(page, `motion-${family}`);
    const node = initial.ui.world!.player_node!;
    await legalOptions(page, initial.ui.world!);
    await page.getByTestId(`option-${node.options[0]!.id}`).press('Enter');
    const after = await readFixture(page);
    expect(after.callbacks.at(-1)).toEqual({ kind: 'choose', worldId: initial.ui.worldId, node: node.id, option: node.options[0]!.id });
    expect(after.ui.world).toEqual(initial.ui.world);
    expect(after.ui.tick).toBe(initial.ui.tick);
  });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 640 }]) {
  test(`Repeated Skip preserves facts, choice and callback state at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const initial = await open(page, 'motion-joined');
    const skip = page.getByTestId('scene-skip');
    await skip.press('Enter');
    await skip.focus();
    for (let index = 0; index < 8; index++) await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await skip.press('Space');
    const after = await readFixture(page);
    expect(after.ui).toEqual(initial.ui);
    expect(after.callbacks).toEqual([]);
    await legalOptions(page, initial.ui.world!);
  });
}

test('Non-head rejection preserves history; admission retires only its exact node', async ({ page }) => {
  const initial = await open(page, 'motion-joined');
  const node = initial.ui.world!.player_node!;
  await page.getByTestId('scene-skip').press('Enter');
  await page.getByTestId(`option-${node.options[0]!.id}`).press('Enter');
  await fixtureControls(page);
  await page.getByTestId('fixture-reject-choice').press('Enter');
  const rejected = await readFixture(page);
  expect(rejected.ui.scene!.entries).toEqual(initial.ui.scene!.entries);
  await legalOptions(page, initial.ui.world!);
  await page.getByTestId(`option-${node.options[1]!.id}`).press('Enter');
  await page.getByTestId('fixture-accept-choice').press('Enter');
  const admitted = await readFixture(page);
  expect(admitted.ui.scene!.entries).toEqual(initial.ui.scene!.entries.filter(entry => entry.node !== node.id));
  expect(admitted.ui.world).toEqual(initial.ui.world);
  expect(admitted.ui.tick).toBe(initial.ui.tick);
  expect(admitted.callbacks.filter(callback => callback.kind === 'choose')).toHaveLength(2);
});

test('Node-head rejection preserves the choice and admission retires it', async ({ page }) => {
  const initial = await open(page, 'motion-debt_due');
  const node = initial.ui.world!.player_node!;
  await page.getByTestId(`option-${node.options[0]!.id}`).press('Enter');
  await fixtureControls(page);
  await page.getByTestId('fixture-reject-choice').press('Enter');
  expect((await readFixture(page)).ui.scene!.entries).toEqual(initial.ui.scene!.entries);
  await page.getByTestId(`option-${node.options[1]!.id}`).press('Enter');
  await page.getByTestId('fixture-accept-choice').press('Enter');
  expect((await readFixture(page)).ui.scene).toBeNull();
});

test('Close and duplicate carriers cannot consume the next scene or cross a World', async ({ page }) => {
  const initial = await open(page, 'motion-joined');
  await page.getByTestId('scene-close').press('Enter');
  const closed = await readFixture(page);
  expect(closed.ui.scene!.entries).toEqual(initial.ui.scene!.entries.slice(1));
  expect(closed.callbacks.at(-1)).toMatchObject({ kind: 'close', identity: initial.ui.scene!.entries[0]!.identity });
  await fixtureControls(page);
  await page.getByTestId('fixture-late-close').press('Enter');
  await page.getByTestId('fixture-duplicate-stop').press('Enter');
  expect((await readFixture(page)).ui.scene!.entries).toEqual(closed.ui.scene!.entries);
  await page.getByTestId('fixture-next-world').press('Enter');
  const next = await readFixture(page);
  await page.getByTestId('fixture-late-close').press('Enter');
  expect((await readFixture(page)).ui.scene).toEqual(next.ui.scene);
  expect(next.ui.worldId).toBe(initial.ui.worldId + 1);
});

for (const change of ['node', 'world'] as const) {
  test(`Stale Choose callback cannot retire a new ${change}`, async ({ page }) => {
    const initial = await open(page, 'motion-feud');
    const node = initial.ui.world!.player_node!;
    await page.getByTestId(`option-${node.options[0]!.id}`).press('Enter');
    await fixtureControls(page);
    await page.getByTestId(`fixture-next-${change}`).press('Enter');
    const before = await readFixture(page);
    await page.getByTestId('fixture-accept-choice').press('Enter');
    const after = await readFixture(page);
    expect(after.ui.worldId).toBe(before.ui.worldId);
    expect(after.ui.world).toEqual(before.ui.world);
    expect(after.ui.scene!.entries).toEqual(before.ui.scene!.entries);
    await legalOptions(page, after.ui.world!);
  });
}

test('Unknown referenced person never borrows another standing actor or grave', async ({ page }) => {
  const initial = await open(page, 'motion-unknown');
  const people = initial.ui.scene!.entries[0]!.keyScene!.people;
  expect(people).toContainEqual(expect.objectContaining({ id: 999999, age: null, lifeStatus: 'unknown' }));
  expect(people.map(person => person.id)).toEqual([...new Set([initial.ui.world!.player.body!, 999999])]);
});

test.describe('Actual tab visibility', () => {
  test.use({ headless: false, launchOptions: { args: ['--window-position=-10000,-10000'] } });
  test('Hidden return keeps latest facts and submits no simulation action', async ({ page, context }) => {
    const initial = await open(page, 'motion-feud');
    const cdp = await context.newCDPSession(page);
    const connection = Reflect.get(page, '_connection');
    const primary = connection?.toImpl?.(page)?.delegate?._mainFrameSession?._client;
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
    await page.getByTestId('fixture-motion-controls').locator(':scope > summary').press('Enter');
    await page.getByTestId('fixture-next-node').press('Enter');
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
    const latest = await readFixture(page);
    expect(latest.ui.world!.player_node!.id).not.toBe(initial.ui.world!.player_node!.id);
    expect(latest.ui.tick).toBe(initial.ui.tick);
    expect(latest.ui.actions).toEqual([]);
    expect(latest.callbacks).toEqual(initial.callbacks);
    await legalOptions(page, latest.ui.world!);
    await otherCdp.detach();
    await other.close();
    await cdp.detach();
  });
});


test('Native-produced props bind each historical body and preserve latest current state', async ({ page }) => {
  const artifact = JSON.parse(readFileSync(new URL('../../../fixtures/life-view/c4-native-lifecycle-props.json', import.meta.url), 'utf8')) as {
    cases: { id: string; world: WorldSnapshot; playerLifecycle: PlayerLifecycleFact[] }[];
  };
  for (const value of artifact.cases) {
    const initial = await open(page, `motion-native&case=${encodeURIComponent(value.id)}`);
    expect(initial.ui.world).toEqual(value.world);
    expect(initial.ui.playerLifecycle).toEqual(value.playerLifecycle);
    const ordered = [...value.playerLifecycle].sort((a, b) => BigInt(a.event) < BigInt(b.event) ? -1 : BigInt(a.event) > BigInt(b.event) ? 1 : 0);
    expect(initial.ui.scene!.entries.map(entry => entry.keyScene!.lifecycle)).toEqual(ordered);
    for (const fact of ordered) {
      const before = await readFixture(page);
      const view = before.ui.scene!.entries[0]!.keyScene!;
      expect(view.lifecycle).toEqual(fact);
      expect(view.people[0]).toMatchObject({ id: fact.body, name: fact.name, age: fact.kind === 'birth' ? 0 : null, origin: fact.origin });
      await page.getByTestId('scene-close').press('Enter');
      expect((await readFixture(page)).ui.world).toEqual(value.world);
    }
  }
});

test('Dream Close is presentation-only', async ({ page }) => {
  const initial = await open(page, 'motion-dream');
  await page.getByTestId('scene-close').press('Enter');
  const after = await readFixture(page);
  expect(after.ui.scene).toBeNull();
  expect(after.ui.world).toEqual(initial.ui.world);
  expect(after.ui.tick).toBe(initial.ui.tick);
  expect(after.callbacks.at(-1)).toMatchObject({ kind: 'close', identity: initial.ui.scene!.entries[0]!.identity });
});
