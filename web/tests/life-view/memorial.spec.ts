/// <reference lib="dom" />
// Isolated COMPONENT-ONLY supported carriers, production UiState/LifeSurface/
// KeyScene. These cases qualify presentation and accessibility, not seed-1
// gameplay, App playback, WASM results, native input processing or replay parity.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { test as nativeTest, nativeZoomMetrics, nativeZoomScreenshot } from './native-zoom.ts';
import { OPERATION_LABELS, optionLabel } from '../../src/main/player-copy.ts';
import { TECHNICAL_TEXT } from '../../src/main/technical-text.ts';
import type { UiState } from '../../src/main/ui-state.ts';
import type { LifeNotebookExport, LifePhase } from '../../src/main/life-journal.ts';
import type { ChoiceResultView } from '../../src/main/choice-result.ts';
import type { MemorialCapture } from '../../src/main/memorial.ts';
import type { OperationState } from '../../src/shared/operation-state.ts';
import type { Request } from '../../src/shared/protocol.ts';

const ORIGIN = process.env.LIFE_LIFECYCLE_COMPONENT_ORIGIN ?? 'http://localhost:5174';
interface Evidence {
  source: { mode: string; baseline: string; modifiedFields: string[]; limits: string };
  assets: string;
  ui: Pick<UiState, 'worldId' | 'tick' | 'checksum' | 'runState' | 'world' | 'actions'> & {
    phase: LifePhase | null; notebook: LifeNotebookExport;
    memorial: { identity: string; capture: MemorialCapture; lines: string[] } | null;
    result: ChoiceResultView | null; slips: OperationState[];
  };
  callbacks: { kind: string; identity: string; tickBefore: string | null; tickAfter: string | null;
    actionsBefore: number; actionsAfter: number; accepted: boolean }[];
  requests: Request[];
}
declare const window: Window & { __lifecycleFixture?: { read(): Evidence } };

async function evidence(page: Page): Promise<Evidence> {
  return page.evaluate(() => {
    if (window.__lifecycleFixture === undefined) throw Error('Read-only component evidence is missing');
    return window.__lifecycleFixture.read();
  });
}

async function open(page: Page, state = 'memorial'): Promise<Evidence> {
  await page.bringToFront();
  await page.goto(`${ORIGIN}/lifecycle-fixture.html?state=${state}`);
  await expect(page.getByRole('heading', { name: /COMPONENT-ONLY lifecycle/ })).toBeVisible();
  await expect.poll(async () => (await evidence(page)).assets).toBe('ready');
  const initial = await evidence(page);
  expect(initial.source.mode).toBe('COMPONENT-ONLY');
  expect(initial.source.baseline).toBe('fixtures/parity/seed1-pairwise.snapshot-500.json');
  expect(initial.source.modifiedFields.length).toBeGreaterThan(0);
  expect(initial.ui.worldId).toBe(1);
  return initial;
}

async function carrier(page: Page, label: string): Promise<void> {
  const controls = page.getByRole('group', { name: 'Component-only factual deliveries' });
  if (!await controls.isVisible()) await page.getByText('Constructed carrier controls', { exact: true }).press('Enter');
  await controls.getByRole('button', { name: label, exact: true }).press('Enter');
}

async function revealControl(control: Locator): Promise<void> {
  const sections = control.locator('xpath=ancestor::details');
  for (let index = await sections.count() - 1; index >= 0; index--) {
    const section = sections.nth(index);
    if (await section.getAttribute('open') === null) await section.locator(':scope > summary').press('Enter');
    await expect(section).toHaveJSProperty('open', true);
  }
  await expect(control).toBeVisible();
}

function memorial(page: Page): Locator {
  return page.getByRole('region', { name: TECHNICAL_TEXT.memorialTitle, exact: true });
}

function unchangedInputsAndClock(after: Evidence, before: Evidence): void {
  expect(after.ui.worldId).toBe(before.ui.worldId);
  expect(after.ui.tick).toBe(before.ui.tick);
  expect(after.ui.checksum).toBe(before.ui.checksum);
  expect(after.ui.world).toEqual(before.ui.world);
  expect(after.ui.actions).toEqual(before.ui.actions);
  expect(after.requests.filter(request => !['run', 'pause'].includes(request.type))).toEqual(before.requests.filter(request => !['run', 'pause'].includes(request.type)));
  for (const callback of after.callbacks) {
    expect(callback.tickAfter).toBe(callback.tickBefore);
    expect(callback.actionsAfter).toBe(callback.actionsBefore);
  }
}

async function settledMemorial(page: Page, baseline: Evidence): Promise<void> {
  await expect.poll(() => memorial(page).evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), { timeout: 10_000 }).toBe(0);
  await expect.poll(async () => (await evidence(page)).callbacks.some(callback => callback.kind === 'settled' && callback.accepted)).toBe(true);
  await expect(memorial(page)).toBeVisible();
  await expect(memorial(page)).toContainText('John');
  await expect(memorial(page)).toContainText('38');
  const current = await evidence(page);
  expect(current.ui.memorial?.identity).toBe(baseline.ui.memorial?.identity);
  expect(current.ui.memorial?.capture.deceased).toBe(1);
  expect(current.ui.memorial?.capture.playerBody).toBe(2);
  unchangedInputsAndClock(current, baseline);
}

async function installGuards(page: Page): Promise<{ errors: string[]; forbidden: string[] }> {
  const failures = { errors: [] as string[], forbidden: [] as string[] };
  page.on('pageerror', error => failures.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN && !url.pathname.startsWith('/api/') || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    failures.forbidden.push(route.request().url());
    await route.abort();
  });
  return failures;
}

const failures = new WeakMap<Page, { errors: string[]; forbidden: string[] }>();
test.beforeEach(async ({ page }) => { failures.set(page, await installGuards(page)); });
test.afterEach(({ page }) => {
  expect(failures.get(page)?.errors).toEqual([]);
  expect(failures.get(page)?.forbidden).toEqual([]);
});
test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
test.use({ headless: false, launchOptions: { args: ['--window-position=-10000,-10000'] } });

test('natural settlement keeps the factual card and native facts until an explicit keyboard Close', async ({ page }, testInfo) => {
  const initial = await open(page);
  expect(initial.callbacks.some(callback => callback.kind === 'settled' && callback.accepted)).toBe(false);
  await settledMemorial(page, initial);
  await page.screenshot({ path: testInfo.outputPath('lu-p1-polish-memorial-settled.png'), fullPage: true });
  await memorial(page).getByRole('button', { name: TECHNICAL_TEXT.close, exact: true }).press('Enter');
  await expect(memorial(page)).toHaveCount(0);
  const closed = await evidence(page);
  expect(closed.ui.memorial).toBeNull();
  expect(closed.ui.notebook.events['900']?.kind).toEqual({ type: 'death', person: 1 });
  expect(closed.callbacks.filter(callback => callback.kind === 'close').at(-1)?.accepted).toBe(true);
  unchangedInputsAndClock(closed, initial);
  await carrier(page, 'Redeliver Death and Estate');
  await expect(memorial(page)).toHaveCount(0);
  expect((await evidence(page)).ui.notebook.events['901']?.kind.type).toBe('inheritance');
});

for (const control of [TECHNICAL_TEXT.showAll, TECHNICAL_TEXT.skip]) {
  test(`${control} settles only decoration, and Play/ordinary Stop keep the same card`, async ({ page }) => {
    const initial = await open(page);
    const button = memorial(page).getByRole('button', { name: control, exact: true });
    await button.focus();
    await expect(button).toBeFocused();
    await button.press('Space');
    await settledMemorial(page, initial);
    await carrier(page, 'Deliver Play acknowledgement');
    expect((await evidence(page)).ui.runState).toBe('running');
    await settledMemorial(page, initial);
    await carrier(page, 'Deliver ordinary Stop');
    expect((await evidence(page)).ui.runState).toBe('paused');
    await settledMemorial(page, initial);
    expect((await evidence(page)).callbacks.filter(callback => callback.kind === 'close')).toEqual([]);
  });
}

test('late exact Estate enriches the still-active Death without replay or unrelated-cause join', async ({ page }) => {
  const initial = await open(page);
  await memorial(page).getByRole('button', { name: TECHNICAL_TEXT.skip, exact: true }).press('Enter');
  await settledMemorial(page, initial);
  const settledCount = (await evidence(page)).callbacks.filter(callback => callback.kind === 'settled').length;
  await carrier(page, 'Deliver unrelated Estate');
  expect((await evidence(page)).ui.memorial?.capture.estate).toBeUndefined();
  await expect(memorial(page)).not.toContainText('73,007');
  await carrier(page, 'Deliver exact Estate');
  await expect(memorial(page)).toContainText('73,007');
  const enriched = await evidence(page);
  expect(enriched.ui.memorial?.identity).toBe(initial.ui.memorial?.identity);
  expect(enriched.ui.memorial?.capture.estate).toEqual({ eventId: '901', amount: '73007' });
  expect(enriched.callbacks.filter(callback => callback.kind === 'settled')).toHaveLength(settledCount);
  unchangedInputsAndClock(enriched, initial);
  await carrier(page, 'Redeliver Death and Estate');
  expect((await evidence(page)).callbacks.filter(callback => callback.kind === 'settled')).toHaveLength(settledCount);
});

for (const replacement of ['Deliver next choice', 'Deliver player death', 'Deliver replacement World']) {
  test(`${replacement} supersedes the card and redelivery cannot reopen it`, async ({ page }) => {
    await open(page);
    await carrier(page, replacement);
    await expect(memorial(page)).toHaveCount(0);
    if (replacement === 'Deliver next choice') {
      await expect(page.getByRole('button', { name: optionLabel('ignore_it'), exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Your next action' })).toBeVisible();
    }
    if (replacement !== 'Deliver replacement World') {
      await carrier(page, 'Redeliver Death and Estate');
      await expect(memorial(page)).toHaveCount(0);
      expect((await evidence(page)).ui.notebook.events['900']?.kind.type).toBe('death');
    }
  });
}

test('production choice buttons show admission, exact empty-appended result and no obsolete received slip', async ({ page }) => {
  await open(page, 'choice');
  const choice = page.getByRole('button', { name: optionLabel('ignore_it'), exact: true });
  await choice.focus();
  await expect(choice).toBeFocused();
  await choice.press('Enter');
  const current = page.getByRole('region', { name: 'Your next action' });
  await expect(current.getByRole('status')).toBeVisible();
  const filed = await evidence(page);
  expect(filed.ui.result?.kind).toBe('filed');
  const slip = filed.ui.slips.find(state => state.kind === 'choose' && state.worldId === filed.ui.worldId
    && state.requestId === filed.ui.result?.requestId);
  if (slip === undefined) throw Error('The admitted choice has no matching receipt');
  expect(slip.phase).toBe('received');
  expect(slip.requestId).toBe(filed.requests.at(-1)?.id);
  const receipt = current.getByRole('article', { name: `${OPERATION_LABELS.choose} receipt`, exact: true, includeHidden: true })
    .and(page.locator(`[data-world="${slip.worldId}"][data-request="${slip.requestId}"]`));
  await revealControl(receipt);
  await expect(receipt).toHaveAttribute('data-kind', slip.kind);
  await expect(receipt).toHaveAttribute('data-phase', slip.phase);
  await expect(receipt).toHaveAttribute('data-inputs', slip.inputSeqs.join(','));
  await carrier(page, 'Deliver unrelated Chronicle');
  const unrelated = await evidence(page);
  expect(unrelated.ui.result).toEqual(filed.ui.result);
  expect(unrelated.ui.slips).toContainEqual(slip);
  await expect(receipt).toBeVisible();
  await carrier(page, 'Deliver exact Chronicle');
  await expect(current.getByRole('status')).toBeVisible();
  await expect(receipt).toHaveCount(0);
  await expect(current.getByRole('article', { name: `${OPERATION_LABELS.choose} receipt`, exact: true, includeHidden: true })).toHaveCount(0);
  const exact = await evidence(page);
  expect(exact.ui.result?.kind).toBe('result');
  expect(exact.ui.result?.node).toBe('120');
  expect(exact.ui.notebook.chronicle['1']?.appended).toEqual([]);
  expect(exact.ui.actions[0]?.phase).toBe('queued');
  expect(exact.ui.actions[0]?.result).toBeNull();
  expect(exact.requests.map(request => request.type)).toEqual(['choose']);
  await carrier(page, 'Deliver next choice');
  await expect(page.getByRole('button', { name: optionLabel('ignore_it'), exact: true })).toBeVisible();
  await expect(current.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: optionLabel('ignore_it'), exact: true }).press('Space');
  expect((await evidence(page)).ui.result?.node).toBe('121');
  await carrier(page, 'Deliver player death');
  await expect(current.getByRole('status')).toHaveCount(0);
  expect((await evidence(page)).ui.slips).toEqual([]);
  await carrier(page, 'Deliver player rebirth');
  expect((await evidence(page)).ui.phase?.person).toBe(4);
  expect((await evidence(page)).ui.actions.map(action => action.phase)).toEqual(['queued', 'queued']);
  expect(Object.keys((await evidence(page)).ui.notebook.chronicle)).toEqual(['0', '1']);
});

test('reduced motion exposes complete facts and keeps the memorial rather than auto-closing it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const initial = await open(page);
  await settledMemorial(page, initial);
  await expect(memorial(page).getByRole('button', { name: TECHNICAL_TEXT.close, exact: true })).toBeEnabled();
  expect((await evidence(page)).callbacks.filter(callback => callback.kind === 'close')).toEqual([]);
});

async function disableFocusEmulation(page: Page): Promise<void> {
  // The pinned Chromium transport otherwise emulates focused visibility in every
  // tab. Disable that protocol behavior; never override document.hidden.
  const connection = Reflect.get(page, '_connection');
  const primary = connection?.toImpl?.(page)?.delegate?._mainFrameSession?._client;
  if (typeof primary?.send !== 'function') throw Error('Pinned Chromium FrameSession is unavailable');
  await primary.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}

async function background(page: Page, context: BrowserContext): Promise<Page> {
  const session = await context.newCDPSession(page);
  const mainWindow = await session.send('Browser.getWindowForTarget');
  const other = await context.newPage();
  await disableFocusEmulation(other);
  const otherSession = await context.newCDPSession(other);
  expect((await otherSession.send('Browser.getWindowForTarget')).windowId).toBe(mainWindow.windowId);
  await other.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
  await session.detach(); await otherSession.detach();
  return other;
}

test.describe('actual hidden Chromium tab', () => {
  test('backgrounding settles but does not remove or replay the card on return', async ({ page, context }) => {
    await disableFocusEmulation(page);
    const initial = await open(page);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    expect(initial.callbacks.some(callback => callback.kind === 'settled' && callback.accepted)).toBe(false);
    const other = await background(page, context);
    await settledMemorial(page, initial);
    const settledCount = (await evidence(page)).callbacks.filter(callback => callback.kind === 'settled').length;
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    await expect(memorial(page)).toBeVisible();
    expect((await evidence(page)).callbacks.filter(callback => callback.kind === 'settled')).toHaveLength(settledCount);
    unchangedInputsAndClock(await evidence(page), initial);
    await other.close();
  });
});

nativeTest.describe('real Chrome browser zoom', () => {
  nativeTest.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  nativeTest('200% keeps memorial facts and keyboard Close usable without horizontal clipping', async ({ page }, testInfo) => {
    const guard = await installGuards(page);
    const initial = await open(page);
    const metrics = await nativeZoomMetrics(page);
    await settledMemorial(page, initial);
    for (const name of [TECHNICAL_TEXT.showAll, TECHNICAL_TEXT.skip, TECHNICAL_TEXT.close]) {
      const button = memorial(page).getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await button.focus();
      await expect(button).toBeFocused();
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(metrics.innerWidth);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach('lu-p1-polish-native-200-memorial', { body: await nativeZoomScreenshot(page), contentType: 'image/png' });
    await memorial(page).getByRole('button', { name: TECHNICAL_TEXT.close, exact: true }).press('Space');
    await expect(memorial(page)).toHaveCount(0);
    unchangedInputsAndClock(await evidence(page), initial);
    expect(guard).toEqual({ errors: [], forbidden: [] });
  });

  nativeTest('200% keeps both offered choices usable and expires presentation through current waiting/reborn phases', async ({ page }, testInfo) => {
    const guard = await installGuards(page);
    await open(page, 'choice');
    await expect(page.getByRole('heading', { name: TECHNICAL_TEXT.life.replace('{Full Name}', 'Irene Carlson'), exact: true })).toBeVisible();
    await nativeZoomMetrics(page);
    for (const option of ['repay_now', 'ignore_it'] as const) await expect(page.getByRole('button', { name: optionLabel(option), exact: true })).toBeVisible();
    await page.getByRole('button', { name: optionLabel('ignore_it'), exact: true }).press('Enter');
    await carrier(page, 'Deliver exact Chronicle');
    await expect(page.getByRole('region', { name: 'Your next action' }).getByRole('status')).toBeVisible();
    await carrier(page, 'Deliver player death');
    await expect(page.getByRole('heading', { name: TECHNICAL_TEXT.waiting, exact: true })).toBeVisible();
    expect((await evidence(page)).ui.phase?.kind).toBe('waiting');
    expect((await evidence(page)).ui.result).toBeNull();
    const dreamSend = page.getByRole('button', { name: TECHNICAL_TEXT.dreamSend, exact: true, includeHidden: true });
    await revealControl(dreamSend);
    await carrier(page, 'Deliver player rebirth');
    const reborn = await evidence(page);
    expect(reborn.ui.phase?.kind).toBe('life');
    expect(reborn.ui.phase?.person).toBe(4);
    await expect(page.getByRole('heading', { name: TECHNICAL_TEXT.life.replace('{Full Name}', 'Abel Ramsey'), exact: true })).toBeVisible();
    expect(reborn.ui.actions[0]?.phase).toBe('queued');
    expect(reborn.ui.notebook.events['910']?.kind.type).toBe('death');
    expect(reborn.ui.notebook.events['912']?.kind.type).toBe('possession');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach('lu-p1-polish-native-200-reborn', { body: await nativeZoomScreenshot(page), contentType: 'image/png' });
    expect(guard).toEqual({ errors: [], forbidden: [] });
  });
});
