/// <reference lib="dom" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { UiState } from '../../src/main/ui-state.ts';
import { test, expect, nativeZoomMetrics, nativeZoomScreenshot } from './native-zoom.ts';
import {
  scenarios, openOperations, restoreScenario, worldRead, replayRead, probeRead, saveOperation,
} from './operations-fixture.ts';

const ROOT = new URL('../../../', import.meta.url);
const EVIDENCE = new URL('target/life-in-view-evidence/', ROOT);
interface ComponentEvidence { mode: string; scenario: string; ui: UiState; callbacks: Record<string, unknown>[]; assetState: string }
declare const window: Window & { __lifeViewFixture?: { read(): ComponentEvidence } };
async function componentRead(page: Page): Promise<ComponentEvidence> {
  return page.evaluate(() => {
    if (!window.__lifeViewFixture) throw Error('Read-only production-component evidence is missing');
    return window.__lifeViewFixture.read();
  });
}
async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function focusReadable(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const focus = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      visible: element.matches(':focus-visible'), outline: parseFloat(style.outlineWidth),
      unobscured: top !== null && element.contains(top),
      contained: rect.x >= -1 && rect.y >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
    };
  });
  expect(focus).toMatchObject({ visible: true, unobscured: true, contained: true });
  expect(focus.outline).toBeGreaterThan(0);
}
async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toHaveCount(1);
  const count = await page.evaluate(() => document.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]').length);
  for (let index = 0; index < count * 2 + 4; index++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      await focusReadable(target); return;
    }
    await page.keyboard.press('Tab');
  }
  throw Error('A current control is not reachable through the actual Tab sequence');
}
async function selectWithKeys(page: Page, id: string, value: string): Promise<void> {
  const control = page.getByTestId(id);
  await tabTo(page, control);
  const options = await control.locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value));
  const index = options.indexOf(value);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Home');
  for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown');
  await expect(control).toHaveValue(value);
}
async function capture(page: Page, info: TestInfo, name: string, facts: Record<string, unknown>): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  const paths = [
    'web/src/App.svelte', 'web/src/ui/LifeSurface.svelte', 'web/src/ui/KeyScene.svelte',
    'web/src/ui/ScenePicture.svelte', 'web/src/ui/life.css', 'web/src/main/key-scene.ts',
    'web/src/main/scene-queue.ts', 'web/src/main/ui-state.ts', 'web/tests/life-view/native-zoom.ts',
    'web/tests/life-view/zoom.spec.ts',
  ];
  const sources = paths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(new URL(path, ROOT))).digest('hex') }));
  const stem = `c4-native-zoom-${name}`;
  const png = new URL(`${stem}.png`, EVIDENCE); const json = new URL(`${stem}.json`, EVIDENCE);
  await writeFile(png, await nativeZoomScreenshot(page));
  await writeFile(json, JSON.stringify({
    version: 1, test: info.title, url: page.url(), viewport: page.viewportSize(),
    browserZoom: 2, mechanism: 'Actual Chrome Settings Page zoom control in a private profile',
    captureMethod: 'Native CDP viewport capture without a CSS-coordinate clip; no image manipulation',
    metrics: await nativeZoomMetrics(page), screenshot: `${stem}.png`, sources, ...facts,
  }, null, 2) + '\n');
  await info.attach(stem, { path: png.pathname, contentType: 'image/png' });
  await info.attach(`${stem}-facts`, { path: json.pathname, contentType: 'application/json' });
}
async function openComponent(page: Page, state: string): Promise<ComponentEvidence> {
  const outside: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' && ['4173', '5174'].includes(url.port)) return route.continue();
    outside.push(url.href); return route.abort();
  });
  await page.goto(`http://localhost:5174/life-view-fixture.html?state=${state}`);
  await expect(page.getByTestId('component-fixture')).toHaveAttribute('data-assets', 'ready');
  await nativeZoomMetrics(page); await noOverflow(page);
  expect(outside).toEqual([]);
  return componentRead(page);
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 640 }]) {
  test.describe(`Actual 200% browser zoom at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    test('COMPONENT-ONLY full Needed, all slots and keyboard Set/Adjust remain reachable', async ({ page }, info) => {
      const before = await openComponent(page, 'waiting-large');
      const world = before.ui.world!; const view = world.underworld_view!;
      for (const slot of view.slots) {
        await expect(page.getByTestId(`claim-${slot.slot}`)).toHaveCount(1);
        const needed = page.getByTestId(`path-${slot.slot}`);
        await expect(needed.locator('li')).toHaveCount(slot.status.needed.length);
        for (const part of slot.status.needed) await expect(needed).toContainText(part.kind === 'named' ? part.name : part.kind === 'wait_until' ? part.tick : part.amount);
      }
      for (const [id, entries] of [
        ['blood-ties', world.player.blood_ties], ['past-life-ties', world.player.past_life_ties], ['earlier-lives', world.player.earlier_bodies],
      ] as const) await expect(page.getByTestId(id).locator('li')).toHaveCount(entries.length);
      await expect(page.getByTestId('chronicle-entry')).toHaveCount(world.chronicle.length);
      await capture(page, info, `${viewport.width}-waiting-first`, { layer: 'COMPONENT-ONLY', fixture: before, scope: 'Constructed stress carrier, not a configured maximum or live operation' });
      await selectWithKeys(page, 'carry-over', 'piety');
      await tabTo(page, page.getByTestId('customize')); await page.keyboard.press('Enter');
      await selectWithKeys(page, 'customization-trait', 'greed');
      await selectWithKeys(page, 'customization-value', '-3');
      await tabTo(page, page.getByTestId('claim-rebuilt_body'));
      await noOverflow(page);
      await capture(page, info, `${viewport.width}-set-focus`, { layer: 'COMPONENT-ONLY', fixture: await componentRead(page), interaction: 'Real Tab/keyboard selection; Set confirmation focused, visible and unobscured' });
      await page.keyboard.press('Enter');
      expect((await componentRead(page)).callbacks.at(-1)).toMatchObject({
        kind: 'claim', request: { slot: 'rebuilt_body', carryOver: 'piety', customization: { Set: { trait_name: 'greed', value: -3 } } },
      });
      await selectWithKeys(page, 'customization-kind', 'Adjust');
      await selectWithKeys(page, 'customization-first', 'greed');
      await selectWithKeys(page, 'customization-first-delta', '1');
      await selectWithKeys(page, 'customization-second', 'loyalty');
      await selectWithKeys(page, 'customization-second-delta', '-1');
      await expect(page.getByTestId('customization-preview').locator('tbody tr')).toHaveCount(2);
      await tabTo(page, page.getByTestId('claim-rebuilt_body'));
      await noOverflow(page);
      await capture(page, info, `${viewport.width}-adjust-focus`, { layer: 'COMPONENT-ONLY', fixture: await componentRead(page), interaction: 'Keyboard-only two-row Adjust form and confirmation focus' });
      await page.keyboard.press('Enter');
      expect((await componentRead(page)).callbacks.at(-1)).toMatchObject({
        kind: 'claim', request: { customization: { Adjust: { first: { trait_name: 'greed', delta: 1 }, second: { trait_name: 'loyalty', delta: -1 } } } },
      });
      await tabTo(page, page.getByTestId('customization-cancel')); await page.keyboard.press('Enter');
      await expect(page.getByTestId('customization-panel')).toHaveCount(0);
      const last = view.slots.filter(slot => slot.kind === 'birth_slot').at(-1)!;
      await tabTo(page, page.getByTestId(`claim-${last.slot}`));
      await capture(page, info, `${viewport.width}-last-slot-focus`, { layer: 'COMPONENT-ONLY', fixture: await componentRead(page), interaction: 'Last offered birth slot reached through actual Tab sequence', slot: last.slot });
      await page.keyboard.press('Enter');
      const after = await componentRead(page);
      expect(after.callbacks.at(-1)).toMatchObject({ kind: 'claim', slot: last.slot, request: { carryOver: 'piety' } });
      expect(after.ui.world).toEqual(world);
      expect(after.ui.tick).toBe(before.ui.tick);
      await capture(page, info, `${viewport.width}-waiting-callbacks`, { layer: 'COMPONENT-ONLY', fixture: after, interaction: 'Post-click callback identity only; no native admission or lifecycle claim' });
    });
    test('COMPONENT-ONLY complete large choices and consequences preserve keyboard identity', async ({ page }, info) => {
      const before = await openComponent(page, 'choice-large'); const node = before.ui.world!.player_node!;
      for (const option of node.options) {
        const preview = option.preview;
        await expect(page.getByTestId(`option-preview-${option.id}`).locator('li')).toHaveCount(preview.length);
        for (const part of preview) await expect(page.getByTestId(`option-preview-${option.id}`)).toContainText(part.delta);
        await tabTo(page, page.getByTestId(`option-${option.id}`));
        await noOverflow(page);
        await capture(page, info, `${viewport.width}-choice-${option.id}`, { layer: 'COMPONENT-ONLY', fixture: await componentRead(page), option, interaction: 'Complete original previews; current option reached through actual keyboard Tab' });
        await page.keyboard.press('Enter');
        expect((await componentRead(page)).callbacks.at(-1)).toEqual({ kind: 'choose', worldId: before.ui.worldId, node: node.id, option: option.id });
      }
      expect((await componentRead(page)).ui.world).toEqual(before.ui.world);
    });
    test('actual Worker/WASM choices, Skip and rejected Bribe operate without a zoom-dependent wait', async ({ page }, info) => {
      const finish = await openOperations(page); await nativeZoomMetrics(page);
      const nodeScenario = scenarios().find(record => record.kind === 'node');
      if (!nodeScenario) throw Error('Prepared real node scenario is missing');
      const choice = await restoreScenario(page, nodeScenario); const node = choice.player_node!;
      const beforeSkip = await replayRead(page); const probeBefore = await probeRead(page);
      await tabTo(page, page.getByRole('button', { name: 'Skip animation', exact: true }));
      await page.keyboard.press('Enter'); await page.keyboard.press('Space');
      expect((await replayRead(page)).bytes).toBe(beforeSkip.bytes);
      const probeAfter = await probeRead(page);
      expect(probeAfter.sent.filter(message => !['world-snapshot', 'export-replay'].includes(message.type)))
        .toEqual(probeBefore.sent.filter(message => !['world-snapshot', 'export-replay'].includes(message.type)));
      for (const option of node.options) await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
      await capture(page, info, `${viewport.width}-live-choice`, { layer: 'ACTUAL-WORKER-WASM-UI', world: choice, scenario: nodeScenario, interaction: 'Repeated real keyboard Skip leaves recorded inputs/checksums/tick unchanged' });
      await tabTo(page, page.getByTestId(`option-${node.options[0]!.id}`)); await page.keyboard.press('Enter');
      await expect(page.getByTestId('step')).toBeEnabled();
      await tabTo(page, page.getByTestId('step')); await page.keyboard.press('Enter');
      await expect(page.getByTestId('tick')).toHaveText(String(BigInt(choice.tick) + 1n));
      await saveOperation(page, info, `zoom-${viewport.width}-choose`, { layer: 'ACTUAL-WORKER-WASM-UI', scenario: nodeScenario, before: choice, after: await worldRead(page), interaction: 'Actual keyboard Choose followed by one explicit keyboard Step' });
      await capture(page, info, `${viewport.width}-live-choice-applied`, { layer: 'ACTUAL-WORKER-WASM-UI', world: await worldRead(page), scenario: nodeScenario, replay: (await replayRead(page)).replay, interaction: 'Native viewport after actual keyboard Choose and one explicit Step' });
      const waitingScenario = scenarios().find(record => record.key === 'waiting-actions');
      if (!waitingScenario) throw Error('Prepared real Waiting scenario is missing');
      const waiting = await restoreScenario(page, waitingScenario);
      const beforeBribe = await replayRead(page);
      await tabTo(page, page.getByTestId('bribe-amount')); await page.keyboard.press('Control+A'); await page.keyboard.type('0');
      await tabTo(page, page.getByTestId('bribe-send')); await page.keyboard.press('Enter');
      await expect(page.getByText(/bad_amount/).first()).toBeVisible();
      expect((await replayRead(page)).bytes).toBe(beforeBribe.bytes);
      expect((await worldRead(page)).tick).toBe(waiting.tick);
      await capture(page, info, `${viewport.width}-live-bribe-rejection`, { layer: 'ACTUAL-WORKER-WASM-UI', world: await worldRead(page), scenario: waitingScenario, probe: await probeRead(page), interaction: 'Real keyboard canonical zero submission reaches core bad_amount; no sequence, Run or Step' });
      finish();
    });
  });
}
