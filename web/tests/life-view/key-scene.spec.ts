/// <reference lib="dom" />
// Actual production components and real browser pictures. Constructed carriers
// prove presentation only; native-produced props retain their separate source layer.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type CDPSession, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { UiState } from '../../src/main/ui-state.ts';
import type { PlayerFamily, PlayerLifecycleFact, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const ORIGIN = 'http://localhost:5174';
const EVIDENCE = fileURLToPath(new URL('../../../target/life-in-view-evidence/', import.meta.url));
test.use({ viewport: { width: 1280, height: 720 }, headless: false, launchOptions: { args: ['--window-position=-10000,-10000'] } });
const families: PlayerFamily[] = ['family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'];
const categories = [...families, 'death', 'rebirth'] as const;
interface FixtureEvidence {
  mode: 'COMPONENT-ONLY'; scenario: string; source: unknown; ui: UiState; callbacks: Record<string, unknown>[]; assetState: string;
  draws: { method: 'resident' | 'grave'; canvas: string | undefined; visual: string | null }[];
}
declare const window: Window & { __lifeViewFixture?: { read(): unknown } };
async function readFixture(page: Page): Promise<FixtureEvidence> {
  return page.evaluate(() => {
    if (!window.__lifeViewFixture) throw Error('Read-only component evidence is missing');
    return window.__lifeViewFixture.read();
  }) as Promise<FixtureEvidence>;
}
async function offline(page: Page): Promise<() => void> {
  const errors: string[] = []; const forbidden: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.origin !== ORIGIN || url.pathname.startsWith('/api/')) {
      forbidden.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  return () => { expect(forbidden).toEqual([]); expect(errors).toEqual([]); };
}
async function open(page: Page, state: string, slow = false): Promise<{ initial: FixtureEvidence; finish(): void; cdp: CDPSession | null }> {
  const finish = await offline(page);
  const cdp = slow ? await page.context().newCDPSession(page) : null;
  if (cdp !== null) {
    await cdp.send('Animation.enable');
    // DevTools slows the actual native animation timeline. No DOM, app state,
    // semantic beat, World, receipt or animation frame is synthesized.
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 });
  }
  await page.goto(`${ORIGIN}/life-view-fixture.html?state=${state}`);
  await expect(page.getByTestId('component-fixture')).toHaveAttribute('data-assets', 'ready');
  return { initial: await readFixture(page), finish, cdp };
}
async function motionControls(page: Page): Promise<void> {
  const controls = page.getByTestId('fixture-motion-controls');
  if (await controls.getAttribute('open') === null) await controls.locator(':scope > summary').click();
}
async function pictureRead(stage: Locator) {
  return stage.evaluate(element => ({
    identity: element.getAttribute('data-identity'), beat: element.getAttribute('data-beat'), category: element.getAttribute('data-category'),
    roles: [...element.querySelectorAll('[data-testid="scene-event-role"]')].map(line => line.textContent),
    layers: [...element.querySelectorAll('canvas')].map(canvas => {
      const style = getComputedStyle(canvas);
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0; for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) painted++;
      return { id: canvas.dataset.testid, transform: style.transform, opacity: style.opacity, willChange: style.willChange,
        painted, width: canvas.width, height: canvas.height, activeAnimations: canvas.getAnimations().filter(animation => animation.playState === 'running').length };
    }),
    animatedTargets: element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').map(animation => {
      const effect = animation.effect as KeyframeEffect | null;
      return { tag: effect?.target instanceof Element ? effect.target.tagName : null,
        id: effect?.target instanceof HTMLElement ? effect.target.dataset.testid : null,
        properties: effect?.getKeyframes().map(frame => Object.keys(frame).filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))) };
    }),
  }));
}
async function capture(page: Page, info: TestInfo, stem: string, extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  const stage = page.getByTestId('key-scene');
  if (await stage.count() === 1) await stage.getByTestId('scene-picture-canvas').scrollIntoViewIfNeeded();
  const before = await stage.count() === 1 ? await pictureRead(stage) : null;
  const fixture = await readFixture(page);
  const sources = ['web/src/main/key-scene.ts', 'web/src/main/scene-queue.ts', 'web/src/main/ui-state.ts', 'web/src/main/templates.ts',
    'web/src/ui/KeyScene.svelte', 'web/src/ui/ScenePicture.svelte', 'web/src/ui/LifeSurface.svelte', 'web/tests/fixtures/life-view.ts', 'web/tests/fixtures/LifeViewFixture.svelte']
    .map(path => ({ path, sha256: createHash('sha256').update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest('hex') }));
  if (fixture.scenario === 'motion-native') {
    const path = 'fixtures/life-view/c4-native-lifecycle-props.json';
    sources.push({ path, sha256: createHash('sha256').update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest('hex') });
  }
  const png = `${EVIDENCE}${stem}.png`; const json = `${EVIDENCE}${stem}.json`;
  await page.screenshot({ path: png, animations: 'allow' });
  const after = await stage.count() === 1 ? await pictureRead(stage) : null;
  if (before !== null && after !== null) { expect(after.identity).toBe(before.identity); expect(after.beat).toBe(before.beat); }
  await writeFile(json, `${JSON.stringify({ version: 1, layer: 'COMPONENT-ONLY-PRODUCTION-RENDER', test: info.title, url: page.url(),
    viewport: page.viewportSize(), screenshot: `${stem}.png`, fixture, beforePicture: before, afterPicture: after, sources, ...extra }, null, 2)}\n`);
  await info.attach(stem, { path: png, contentType: 'image/png' });
  await info.attach(`${stem}-facts`, { path: json, contentType: 'application/json' });
}
async function completeChoice(page: Page, world: WorldSnapshot): Promise<void> {
  const node = world.player_node!;
  await expect(page.getByTestId('choice-node')).toHaveText(node.id);
  await expect(page.getByTestId('stakes')).toContainText(node.stakes.amount);
  await expect(page.getByTestId('stakes')).toContainText(node.stakes.by);
  for (const option of node.options) {
    await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
    const rows = page.getByTestId(`option-preview-${option.id}`).locator('li');
    await expect(rows).toHaveCount(Math.max(1, option.preview.length));
    for (const [index, effect] of option.preview.entries()) {
      await expect(rows.nth(index)).toContainText(effect.delta);
      await expect(rows.nth(index)).toContainText(`Person ${effect.person}`);
    }
  }
}
function scenario(category: typeof categories[number]): string {
  return category === 'rebirth' ? 'motion-birth' : `motion-${category}`;
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 640 }]) {
  for (const category of categories) {
    test(`LV-C4 finite picture: ${category} has complete first-frame facts and distinct focal/final pictures at ${viewport.width}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      const { initial, finish, cdp } = await open(page, scenario(category), true);
      const stage = page.getByTestId('key-scene');
      await expect(stage).toHaveAttribute('data-category', category);
      await expect(stage).toHaveAttribute('data-beat', 'establish');
      const head = initial.ui.scene!.entries[0]!;
      await expect(stage).toHaveAttribute('data-identity', head.identity);
      for (const line of head.keyScene!.lines) await expect(stage).toContainText(line);
      if (head.node !== null) await completeChoice(page, initial.ui.world!);
      else await expect(stage.getByRole('button', { name: 'Close scene', exact: true })).toBeEnabled();
      const first = await pictureRead(stage);
      expect(first.layers.map(layer => layer.id)).toEqual(['scene-picture-canvas', 'scene-picture-people', 'scene-picture-focal']);
      expect(first.layers[0]!.painted).toBeGreaterThan(0);
      await capture(page, info, `c4-motion-${category}-${viewport.width}-first`, { timeline: 'Real native WAAPI at DevTools playbackRate 0.05; all DOM facts/options already available' });
      await expect(stage).toHaveAttribute('data-beat', 'focus');
      const mid = await pictureRead(stage);
      expect(mid.animatedTargets.length).toBeGreaterThan(0);
      for (const target of mid.animatedTargets) {
        expect(target.tag).toBe('CANVAS');
        expect(target.properties!.flat().every(property => ['transform', 'opacity'].includes(property))).toBe(true);
      }
      expect(mid.layers.find(layer => layer.id === 'scene-picture-focal')!.painted).toBeGreaterThan(0);
      expect(mid.layers.map(layer => [layer.transform, layer.opacity])).not.toEqual(first.layers.map(layer => [layer.transform, layer.opacity]));
      if (head.node !== null) await completeChoice(page, initial.ui.world!);
      await capture(page, info, `c4-motion-${category}-${viewport.width}-mid`, { focal: head.keyScene!.focal });
      await expect(stage).toHaveAttribute('data-beat', 'settled', { timeout: 15000 });
      const final = await pictureRead(stage);
      expect(final.roles).toEqual(first.roles); expect(final.identity).toBe(first.identity);
      expect(final.layers.every(layer => layer.activeAnimations === 0 && !layer.willChange.includes('transform') && !layer.willChange.includes('opacity'))).toBe(true);
      expect((await readFixture(page)).ui.world).toEqual(initial.ui.world);
      expect((await readFixture(page)).callbacks).toEqual([]);
      await capture(page, info, `c4-motion-${category}-${viewport.width}-final`);
      await cdp!.detach(); finish();
    });
  }
  test(`LV-C4 repeated Skip and held Space preserve the same head, node, tick and callback state at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const { initial, finish, cdp } = await open(page, 'motion-joined', true);
    const stage = page.getByTestId('key-scene'); const skip = stage.getByRole('button', { name: 'Skip animation', exact: true });
    await expect(stage).toHaveAttribute('data-beat', 'establish');
    await capture(page, info, `c4-motion-skip-${viewport.width}-before`);
    await skip.click(); await expect(stage).toHaveAttribute('data-beat', 'settled');
    await skip.click(); await skip.focus();
    for (let index = 0; index < 8; index++) await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await skip.press('Space'); await skip.press('Enter');
    await expect(skip).toBeFocused(); await expect(stage).toHaveAttribute('data-identity', initial.ui.scene!.entries[0]!.identity);
    const after = await readFixture(page);
    expect(after.ui).toEqual(initial.ui); expect(after.callbacks).toEqual([]);
    await completeChoice(page, initial.ui.world!);
    await capture(page, info, `c4-motion-skip-${viewport.width}-after`, { beforeCallbacks: initial.callbacks, afterCallbacks: after.callbacks, heldSpace: 'Eight real keydown repeats and keyup, then independent Space/Enter activations' });
    await cdp!.detach(); finish();
  });
}

for (const category of categories) {
  test(`LV-C4 reduced motion: ${category} immediately renders the complete final picture without active animation`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { initial, finish } = await open(page, scenario(category));
    const stage = page.getByTestId('key-scene');
    await expect(stage).toHaveAttribute('data-beat', 'settled');
    await expect(stage).toHaveAttribute('data-identity', initial.ui.scene!.entries[0]!.identity);
    const picture = await pictureRead(stage);
    expect(picture.animatedTargets).toEqual([]); expect(picture.layers[0]!.painted).toBeGreaterThan(0);
    for (const line of initial.ui.scene!.entries[0]!.keyScene!.lines) await expect(stage).toContainText(line);
    if (initial.ui.world!.player_node !== null) await completeChoice(page, initial.ui.world!);
    await capture(page, info, `c4-motion-${category}-reduced`, { reducedMotion: true });
    finish();
  });
}

test('LV-C4 non-head action: rejection never replays; local acknowledgment retires only the exact node', async ({ page }, info) => {
  const { initial, finish, cdp } = await open(page, 'motion-joined', true);
  const stage = page.getByTestId('key-scene'); const node = initial.ui.world!.player_node!;
  await expect(stage).toHaveCount(1); await completeChoice(page, initial.ui.world!);
  const vignette = page.locator('#current-action').getByTestId('scene-picture');
  await expect(vignette).toHaveCount(1);
  expect(await vignette.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await stage.getByRole('button', { name: 'Skip animation', exact: true }).click();
  await capture(page, info, 'c4-motion-nonhead-before-choice');
  await page.getByTestId(`option-${node.options[0]!.id}`).click();
  expect((await readFixture(page)).callbacks.at(-1)).toEqual({ kind: 'choose', worldId: initial.ui.worldId, node: node.id, option: node.options[0]!.id });
  await capture(page, info, 'c4-motion-nonhead-after-callback', { operationLayer: 'COMPONENT-ONLY callback intent; no native admission' });
  await motionControls(page); await page.getByTestId('fixture-reject-choice').click();
  await completeChoice(page, initial.ui.world!); await expect(stage).toHaveAttribute('data-beat', 'settled');
  await expect(stage).toHaveAttribute('data-identity', initial.ui.scene!.entries[0]!.identity);
  expect((await readFixture(page)).ui.scene!.entries).toEqual(initial.ui.scene!.entries);
  await page.getByTestId(`option-${node.options[1]!.id}`).click();
  await page.getByTestId('fixture-accept-choice').click();
  const after = await readFixture(page);
  expect(after.ui.scene!.entries).toEqual(initial.ui.scene!.entries.filter(entry => entry.node !== node.id));
  expect(after.ui.world).toEqual(initial.ui.world); expect(after.ui.tick).toBe(initial.ui.tick);
  expect(after.callbacks.filter(callback => callback.kind === 'choose')).toHaveLength(2);
  await expect(page.getByTestId(`option-${node.options[0]!.id}`)).toHaveCount(0);
  await expect(stage).toHaveAttribute('data-identity', initial.ui.scene!.entries[0]!.identity);
  await capture(page, info, 'c4-motion-nonhead-local-ack', { operationLayer: 'COMPONENT-ONLY reducer acknowledgment props; no Worker receipt, native admission or applied result' });
  await cdp!.detach(); finish();
});

test('LV-C4 node-head rejection preserves settled identity and admitted presentation cancels node-only work', async ({ page }, info) => {
  const { initial, finish, cdp } = await open(page, 'motion-debt_due', true);
  const stage = page.getByTestId('key-scene'); const node = initial.ui.world!.player_node!;
  await stage.getByRole('button', { name: 'Skip animation', exact: true }).click();
  await page.getByTestId(`option-${node.options[0]!.id}`).click();
  await motionControls(page); await page.getByTestId('fixture-reject-choice').click();
  await expect(stage).toHaveAttribute('data-beat', 'settled'); await expect(stage).toHaveAttribute('data-identity', initial.ui.scene!.entries[0]!.identity);
  await page.getByTestId(`option-${node.options[1]!.id}`).click(); await page.getByTestId('fixture-accept-choice').click();
  await expect(stage).toHaveCount(0);
  expect((await readFixture(page)).ui.scene).toBeNull();
  expect(await page.locator('[data-testid^="scene-picture-"]').evaluateAll(elements => elements.flatMap(element => element.getAnimations()).length)).toBe(0);
  await capture(page, info, 'c4-motion-node-local-ack-cancelled', { operationLayer: 'COMPONENT-ONLY reducer props' });
  await cdp!.detach(); finish();
});

test('LV-C4 guarded Close and duplicate episode carriers cannot consume the next scene or replay a closed scene', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { initial, finish } = await open(page, 'motion-joined');
  await capture(page, info, 'c4-motion-close-before');
  await page.getByTestId('key-scene').getByRole('button', { name: 'Close scene', exact: true }).press('Enter');
  const afterClose = await readFixture(page);
  expect(afterClose.ui.scene!.entries).toEqual(initial.ui.scene!.entries.slice(1));
  expect(afterClose.callbacks.at(-1)).toMatchObject({ kind: 'close', identity: initial.ui.scene!.entries[0]!.identity });
  await capture(page, info, 'c4-motion-close-after-callback');
  await motionControls(page); await page.getByTestId('fixture-late-close').click(); await page.getByTestId('fixture-duplicate-stop').click();
  expect((await readFixture(page)).ui.scene!.entries).toEqual(afterClose.ui.scene!.entries);
  const retained = (await readFixture(page)).ui.scene!.entries[0]!.identity;
  await page.getByTestId('fixture-next-world').click(); await page.getByTestId('fixture-late-close').click();
  const next = await readFixture(page);
  expect(next.ui.worldId).toBe(initial.ui.worldId + 1); expect(next.ui.scene!.entries[0]!.identity).not.toBe(retained);
  expect(next.ui.scene!.entries).toHaveLength(initial.ui.scene!.entries.length);
  await capture(page, info, 'c4-motion-close-stale-world', { operationLayer: 'COMPONENT-ONLY captured callback guard' });
  finish();
});

for (const change of ['node', 'world'] as const) {
  test(`LV-C4 stale Choose callback after a new ${change} cannot retire the replacement node`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { initial, finish } = await open(page, 'motion-feud');
    const node = initial.ui.world!.player_node!;
    await page.getByTestId(`option-${node.options[0]!.id}`).click(); await motionControls(page);
    await page.getByTestId(`fixture-next-${change}`).click();
    const before = await readFixture(page);
    await page.getByTestId('fixture-accept-choice').click();
    const after = await readFixture(page);
    expect(after.ui.worldId).toBe(before.ui.worldId); expect(after.ui.world).toEqual(before.ui.world);
    expect(after.ui.scene!.entries).toEqual(before.ui.scene!.entries);
    await completeChoice(page, after.ui.world!);
    await capture(page, info, `c4-motion-stale-choose-${change}`, { operationLayer: 'COMPONENT-ONLY late callback props', beforeCallbacks: before.callbacks, afterCallbacks: after.callbacks });
    finish();
  });
}

test('LV-C4 unknown person keeps factual reference but never draws a standing actor or grave', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { finish } = await open(page, 'motion-unknown');
  await expect(page.getByTestId('key-scene')).toContainText('Person 999999');
  const calls = (await readFixture(page)).draws.filter(call => ['scene-picture-canvas', 'scene-picture-people', 'scene-picture-focal'].includes(call.canvas ?? ''));
  expect(calls).toEqual([]);
  await capture(page, info, 'c4-motion-unknown-reference'); finish();
});

test.describe('Actual tab visibility', () => {
test('LV-C4 hidden tab settles decorative work and returns to the latest constructed node without simulation actions', async ({ page, context }, info) => {
  const { initial, finish, cdp } = await open(page, 'motion-feud', true);
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-beat', 'establish');
  // Playwright enables focus emulation for every main frame. Disable that
  // override so native tab activation, not emulated visibility, owns this test.
  const connection = Reflect.get(page, '_connection');
  const primary = connection?.toImpl?.(page)?.delegate?._mainFrameSession?._client;
  if (typeof primary?.send !== 'function') throw Error('Pinned Playwright in-process primary Chromium session is unavailable');
  await primary.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  const originalWindow = await cdp!.send('Browser.getWindowForTarget');
  const other = await context.newPage();
  const otherCdp = await context.newCDPSession(other);
  const otherConnection = Reflect.get(other, '_connection');
  const otherPrimary = otherConnection?.toImpl?.(other)?.delegate?._mainFrameSession?._client;
  if (typeof otherPrimary?.send !== 'function') throw Error('Second tab primary Chromium session is unavailable');
  await otherPrimary.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const otherWindow = await otherCdp.send('Browser.getWindowForTarget');
  expect(otherWindow.windowId, 'Actual activation must switch tabs in the same Chrome window').toBe(originalWindow.windowId);
  await other.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-beat', 'settled');
  await page.getByTestId('fixture-motion-controls').locator(':scope > summary').press('Enter');
  await page.getByTestId('fixture-next-node').press('Enter');
  await page.bringToFront(); await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  const latest = await readFixture(page);
  expect(latest.ui.world!.player_node!.id).not.toBe(initial.ui.world!.player_node!.id);
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-identity', JSON.stringify([latest.ui.worldId, latest.ui.world!.player_soul, latest.ui.world!.player_node!.id]));
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-beat', 'settled');
  await completeChoice(page, latest.ui.world!);
  expect(latest.ui.tick).toBe(initial.ui.tick); expect(latest.ui.actions).toEqual([]);
  await capture(page, info, 'c4-motion-hidden-latest', { visibilityPath: 'Actual same-window second-tab activation after disabling Playwright primary-agent focus emulation; no synthetic visibility event',
    focusEmulation: false, focusAgent: 'Pinned in-process Playwright primary Chromium FrameSession', windows: { original: originalWindow.windowId, other: otherWindow.windowId }, beforeCallbacks: initial.callbacks, afterCallbacks: latest.callbacks });
  await otherCdp.detach(); await other.close(); await cdp!.detach(); finish();
});
});

test('LV-C4 actual-native-produced props preserve each event body and truthful current living/Waiting state', async ({ page }, info) => {
  const file = new URL('../../../fixtures/life-view/c4-native-lifecycle-props.json', import.meta.url);
  const artifact = JSON.parse(readFileSync(file, 'utf8')) as { version: number; layer: string; cases: { id: string; world: WorldSnapshot; playerLifecycle: PlayerLifecycleFact[]; producer: unknown }[] };
  expect(artifact.layer).toBe('ACTUAL-NATIVE-PRODUCED-COMPONENT-PROPS'); expect(artifact.version).toBe(1);
  expect(artifact.cases.length).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const finish = await offline(page);
  for (const value of artifact.cases) {
    const sameStopDeath = value.playerLifecycle.some(fact => fact.kind === 'death');
    expect(value.playerLifecycle.some(fact => fact.kind !== 'death')).toBe(true);
    if (sameStopDeath) expect(value.world.player.place).toBe('waiting');
    try {
      await page.goto(`${ORIGIN}/life-view-fixture.html?state=motion-native&case=${encodeURIComponent(value.id)}`);
      await expect(page.getByTestId('component-fixture')).toHaveAttribute('data-assets', 'ready');
    } catch (error) {
      finish(); // Surface the captured page/module/network error before timeout.
      throw error;
    }
    const initial = await readFixture(page);
    expect(initial.ui.world).toEqual(value.world); expect(initial.ui.playerLifecycle).toEqual(value.playerLifecycle);
    const ordered = [...value.playerLifecycle].sort((a, b) => BigInt(a.event) < BigInt(b.event) ? -1 : BigInt(a.event) > BigInt(b.event) ? 1 : 0);
    const summary = page.getByTestId('stop-lifecycle-facts').locator('li');
    await expect(summary).toHaveCount(ordered.length);
    for (const [index, fact] of ordered.entries()) await expect(summary.nth(index)).toContainText(`event ${fact.event}`);
    for (const entry of initial.ui.scene!.entries.filter(entry => entry.keyScene?.lifecycle != null)) {
      const fact = entry.keyScene!.lifecycle!;
      await expect(page.getByTestId('identity-state')).toContainText(value.world.player.place === 'waiting' ? 'Waiting' : `Current body ${value.world.player.body}`);
      await expect(page.getByTestId('key-scene')).toHaveAttribute('data-identity', JSON.stringify([initial.ui.worldId, fact.event]));
      await expect(page.getByTestId('key-scene')).toContainText(fact.name);
      await expect(page.getByTestId('key-scene')).toContainText(`Body ${fact.body}`);
      await expect(page.getByTestId('key-scene')).toContainText('age unknown');
      if (fact.kind === 'possession' || fact.kind === 'rebuild') await expect(page.getByTestId('key-scene')).toContainText('not biological birth');
      await capture(page, info, `c4-motion-native-props-${value.id}-${fact.event}-before-close`, { layer: artifact.layer, producer: value.producer,
        limits: 'Actual native-produced props, production component rendering and real Close callback; not a live App/WASM operation or default-Params replay' });
      await page.getByTestId('key-scene').getByRole('button', { name: 'Close scene', exact: true }).click();
      const after = await readFixture(page);
      expect(after.callbacks.at(-1)).toMatchObject({ kind: 'close', identity: entry.identity });
      expect(after.ui.world).toEqual(value.world);
      await capture(page, info, `c4-motion-native-props-${value.id}-${fact.event}-after-close`, { layer: artifact.layer, producer: value.producer,
        operationLayer: 'COMPONENT-ONLY Close callback with actual native-produced historical props' });
    }
  }
  finish();
});

test('LV-C4 normal browser timing runs the shared finite picture without a DevTools playback override', async ({ page }, info) => {
  const cdp = await page.context().newCDPSession(page);
  const starts: { duration: number | null; observedAt: number }[] = [];
  await cdp.send('Animation.enable');
  cdp.on('Animation.animationStarted', event => starts.push({ duration: event.animation.source?.duration ?? null, observedAt: Date.now() }));
  const { initial, finish } = await open(page, 'motion-feud');
  const stage = page.getByTestId('key-scene');
  await expect(stage).toHaveAttribute('data-beat', 'settled');
  expect((await cdp.send('Animation.getPlaybackRate')).playbackRate).toBe(1);
  expect(starts.some(animation => animation.duration !== null && Number.isFinite(animation.duration) && animation.duration > 0)).toBe(true);
  const finalPicture = await pictureRead(stage);
  expect(finalPicture.animatedTargets).toEqual([]);
  expect(finalPicture.layers.every(layer => layer.activeAnimations === 0 && !layer.willChange.includes('transform') && !layer.willChange.includes('opacity'))).toBe(true);
  for (const line of initial.ui.scene!.entries[0]!.keyScene!.lines) await expect(stage).toContainText(line);
  await completeChoice(page, initial.ui.world!);
  expect((await readFixture(page)).ui).toEqual(initial.ui);
  expect((await readFixture(page)).callbacks).toEqual([]);
  await capture(page, info, 'c4-motion-normal-timing', { timeline: 'Normal browser native WAAPI, no CDP Animation playback rate and no fake clock', actualAnimationStarts: starts });
  await cdp.detach(); finish();
});

test('LV-C4 Dream remains a static delivered scene with independent Close and no picture performance', async ({ page }, info) => {
  const { initial, finish } = await open(page, 'motion-dream');
  await expect(page.getByTestId('key-scene')).toHaveCount(0);
  await expect(page.getByTestId('scene-dream')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip animation', exact: true })).toHaveCount(0);
  expect(await page.getByTestId('scene-dream').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.getByRole('button', { name: 'Close scene', exact: true }).press('Enter');
  const after = await readFixture(page);
  expect(after.ui.scene).toBeNull(); expect(after.ui.world).toEqual(initial.ui.world); expect(after.ui.tick).toBe(initial.ui.tick);
  expect(after.callbacks.at(-1)).toMatchObject({ kind: 'close', identity: initial.ui.scene!.entries[0]!.identity });
  await capture(page, info, 'c4-motion-static-dream-after-close', { operationLayer: 'COMPONENT-ONLY static scene Close callback' });
  finish();
});
