/// <reference lib="dom" />
// Native cases drive the built App through its real SimClient/Worker/WASM.
// Constructed-carrier cases mount actual production components and prove ONLY
// component rendering/callback contracts; they are never native action evidence.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { Reply, RequestTicket, RequestWithoutId } from '../../src/shared/protocol.ts';
import type { UiState } from '../../src/main/ui-state.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { DECISION_CONFIG_VERSION } from '../../src/shared/decision.ts';

const PREVIEW = 'http://localhost:4173';
const COMPONENT = 'http://localhost:5174';
const EVIDENCE = fileURLToPath(new URL('../../../target/life-in-view-evidence/', import.meta.url));
const TRAITS = ['greed', 'loyalty', 'pride', 'warmth', 'temper', 'vindictiveness', 'piety'] as const;
const MAX_U64 = '18446744073709551615';
const ABOVE_SAFE = '9007199254740993';
const MIN_I64 = '-9223372036854775808';
const MAX_I64 = '9223372036854775807';
const waitingFixture = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seedU-underworld.replay.json', import.meta.url), 'utf8')) as {
  seed: string; config: unknown; inputs: { tick: string; seq: string; payload: unknown }[];
};
const choiceFixture = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seedP-playthrough.replay.json', import.meta.url), 'utf8')) as { seed: string; config: unknown };
const choiceStages = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seedP-playthrough.stages.json', import.meta.url), 'utf8')) as { stages: { tick: string }[] };
interface FixtureEvidence {
  mode: 'COMPONENT-ONLY'; scenario: string; source: unknown; ui: UiState;
  callbacks: Record<string, unknown>[]; assetState: string;
}
declare const window: Window & {
  __simHarness?: { request(request: RequestWithoutId): RequestTicket };
  __lifeViewFixture?: { read(): unknown };
  __lifeViewPaint?: { counts: WeakMap<HTMLCanvasElement, number>; total: number };
};

async function offline(page: Page, failedAtlas?: string) {
  const offOrigin: string[] = []; const apiPosts: string[] = []; const pageErrors: string[] = [];
  const consoleErrors: string[] = []; const atlasRequests: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') { await route.continue(); return; }
    if (![PREVIEW, COMPONENT].includes(url.origin)) { offOrigin.push(request.url()); await route.abort(); return; }
    if (url.pathname === '/api/decision/config') {
      await route.fulfill({ json: { version: DECISION_CONFIG_VERSION, enabled: false, session_cap: 20 } }); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method() === 'POST') apiPosts.push(url.pathname);
      await route.abort(); return;
    }
    if (/\/assets\/life-view-[a-z]+\.png$/.test(url.pathname)) atlasRequests.push(url.pathname);
    if (url.pathname === failedAtlas) { await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Controlled LV-C3 atlas 404' }); return; }
    await route.continue();
  });
  return {
    atlasRequests, consoleErrors,
    finish() {
      expect(offOrigin, 'No non-loopback request is allowed').toEqual([]);
      expect(apiPosts, 'Rules-only cases must not post decision requests').toEqual([]);
      expect(pageErrors, 'No uncaught production/component exception').toEqual([]);
      if (failedAtlas === undefined) expect(consoleErrors, 'No unexpected browser console error').toEqual([]);
      else expect(consoleErrors.every(error => /404.*Not Found|Failed to load resource.*404/.test(error)), consoleErrors.join('\n')).toBe(true);
    },
  };
}
async function disclosure(page: Page, id: string, open: boolean): Promise<void> {
  const element = page.getByTestId(id);
  if ((await element.getAttribute('open') !== null) !== open) await element.locator(':scope > summary').click();
  await expect(element).toHaveJSProperty('open', open);
}
async function request(page: Page, value: RequestWithoutId): Promise<Reply> {
  return page.evaluate(async value => {
    if (!window.__simHarness) throw Error('Real Worker_Protocol harness is missing');
    return window.__simHarness.request(value).reply;
  }, value);
}
async function worldRead(page: Page): Promise<WorldSnapshot> {
  const reply = await request(page, { type: 'world-snapshot' });
  expect(reply.ok).toBe(true);
  if (!reply.ok || !reply.world) throw Error('Completed native World Snapshot is missing');
  return reply.world;
}
async function exportRead(page: Page): Promise<string> {
  const reply = await request(page, { type: 'export-replay' });
  expect(reply.ok).toBe(true);
  if (!reply.ok || reply.replay === undefined) throw Error('Exact native replay export is missing');
  return reply.replay;
}
async function fixtureRead(page: Page): Promise<FixtureEvidence> {
  return page.evaluate(() => {
    if (!window.__lifeViewFixture) throw Error('Read-only component fixture evidence is missing');
    return window.__lifeViewFixture.read();
  }) as Promise<FixtureEvidence>;
}
function personName(world: WorldSnapshot, id: number): string {
  const person = world.residents.find(person => person.id === id)
    ?? world.player.earlier_bodies.find(person => person.id === id)
    ?? world.person_names.find(person => person.id === id)
    ?? (world.magistrate.id === id ? world.magistrate : undefined);
  if (person === undefined) throw Error(`Carrier does not name Person ${id}`);
  return person.name;
}
async function noHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function atlasPixels(page: Page): Promise<void> {
  const canvas = page.getByTestId('scene-picture-canvas').first();
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    return colors.size;
  })).toBeGreaterThan(4);
  const scale = await canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement; const bounds = canvas.getBoundingClientRect();
    return { width: canvas.width, height: canvas.height, x: bounds.width / canvas.width, y: bounds.height / canvas.height, rendering: getComputedStyle(canvas).imageRendering };
  });
  expect(scale.width).toBe(256); expect(scale.height).toBe(80);
  expect(scale.x).toBe(scale.y); expect(Number.isInteger(scale.x)).toBe(true);
  expect(scale.rendering).toBe('pixelated');
}
async function capture(page: Page, info: TestInfo, stem: string, evidence: Record<string, unknown>): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  const sourcePaths = [
    'web/src/App.svelte', 'web/src/ui/LifeSurface.svelte', 'web/src/ui/life.css', 'web/src/ui/ScenePicture.svelte',
    'web/src/ui/ChoicePanel.svelte', 'web/src/ui/UnderworldPanel.svelte', 'web/src/ui/IdentityPanel.svelte', 'web/src/ui/ChroniclePanel.svelte',
    'web/src/art/sprites.ts', 'web/src/art/life-view-atlas.ts',
    'web/public/assets/life-view-urban.png', 'web/public/assets/life-view-roguelike.png', 'web/public/assets/life-view-original.png',
    'web/life-view-fixture.html', 'web/tests/fixtures/life-view.ts', 'web/tests/fixtures/LifeViewFixture.svelte',
    'fixtures/parity/seed1-pairwise.snapshot-500.json',
  ];
  const sources = sourcePaths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest('hex') }));
  const png = `${EVIDENCE}${stem}.png`; const json = `${EVIDENCE}${stem}.json`;
  await page.screenshot({ path: png }); // Actual rendered viewport, never a generated image.
  await writeFile(json, `${JSON.stringify({ version: 1, test: info.title, viewport: page.viewportSize(), url: page.url(), screenshot: `${stem}.png`, sources, ...evidence }, null, 2)}\n`);
  await info.attach(stem, { path: png, contentType: 'image/png' });
  await info.attach(`${stem}-facts`, { path: json, contentType: 'application/json' });
}
async function nativeCreate(page: Page, fixture: { seed: string; config: unknown }): Promise<void> {
  await disclosure(page, 'world-setup', true);
  await page.getByTestId('seed').fill(fixture.seed); await page.getByTestId('config').fill(JSON.stringify(fixture.config));
  await page.getByTestId('create').click();
  await expect(page.getByTestId('tick')).toHaveText('0');
  await expect(page.getByTestId('run-state')).toHaveText('paused');
  await expect(page.getByTestId('world-setup')).toHaveJSProperty('open', false);
}
async function nativeWaiting(page: Page): Promise<WorldSnapshot> {
  await nativeCreate(page, waitingFixture);
  const prefix = waitingFixture.inputs.filter(input => BigInt(input.seq) < 61n).map(input => ({ tick: input.tick, payload: input.payload }));
  await page.evaluate(async prefix => {
    const harness = window.__simHarness;
    if (!harness) throw Error('Real Worker_Protocol harness is missing');
    for (const input of prefix) {
      const reply = await harness.request({ type: 'submit', input: JSON.stringify(input) }).reply;
      if (!reply.ok) throw Error(`Native fixture submit failed: ${reply.kind}`);
    }
    for (let tick = 0; tick < 1653; tick++) {
      let reply = await harness.request({ type: 'step' }).reply;
      if (!reply.ok && reply.kind === 'node_unanswered') {
        const read = await harness.request({ type: 'world-snapshot' }).reply;
        if (!read.ok || !read.world?.player_node) throw Error('Native fixture node is missing');
        const node = read.world.player_node;
        const chosen = await harness.request({ type: 'choose', node: node.id, option: node.rules_default }).reply;
        if (!chosen.ok) throw Error('Native fixture default was rejected');
        reply = await harness.request({ type: 'step' }).reply;
      }
      if (!reply.ok) throw Error(`Native fixture step failed: ${reply.kind}`);
    }
    const read = await harness.request({ type: 'world-snapshot' }).reply;
    if (!read.ok) throw Error('Native fixture final read failed');
    if (read.snapshot.playerNode.pending && !read.snapshot.playerNode.answered) {
      const node = read.world?.player_node;
      if (!node) throw Error('Native fixture final node is missing');
      const chosen = await harness.request({ type: 'choose', node: node.id, option: node.rules_default }).reply;
      if (!chosen.ok) throw Error('Native fixture final default was rejected');
    }
  }, prefix);
  await page.getByTestId('speed').selectOption('1');
  await expect(page.getByTestId('tick')).toHaveText('1653');
  await expect(page.getByTestId('step')).toBeEnabled(); await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText('1654');
  await expect(page.getByTestId('underworld-panel')).toBeVisible();
  const world = await worldRead(page); expect(world.player.place).toBe('waiting');
  return world;
}
async function nativeChoice(page: Page): Promise<WorldSnapshot> {
  await nativeCreate(page, choiceFixture);
  const ticks = Number(choiceStages.stages[0]!.tick) - 1;
  await page.evaluate(async ticks => {
    const harness = window.__simHarness;
    if (!harness) throw Error('Real Worker_Protocol harness is missing');
    for (let tick = 0; tick < ticks; tick++) {
      const reply = await harness.request({ type: 'step' }).reply;
      if (!reply.ok) throw Error(`Native first-choice progression failed: ${reply.kind}`);
    }
  }, ticks);
  await page.getByTestId('speed').selectOption('1');
  await expect(page.getByTestId('tick')).toHaveText(String(ticks));
  await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText(choiceStages.stages[0]!.tick);
  const world = await worldRead(page); expect(world.player_node).not.toBeNull();
  return world;
}
async function verifyChoice(page: Page, world: WorldSnapshot): Promise<void> {
  const node = world.player_node!;
  await expect(page.getByTestId('choice-node')).toHaveText(node.id);
  await expect(page.getByTestId('choice-default')).toContainText(node.rules_default);
  for (const tick of [node.fired, node.choice_tick, node.resolves]) await expect(page.getByTestId('choice-timing')).toContainText(tick);
  for (const id of node.stakes.who) await expect(page.getByTestId('stakes')).toContainText(personName(world, id));
  await expect(page.getByTestId('stakes')).toContainText(node.stakes.amount);
  await expect(page.getByTestId('stakes')).toContainText(node.stakes.by);
  expect(await page.locator('[data-testid^="option-preview-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))))
    .toEqual(node.options.map(option => `option-preview-${option.id}`));
  for (const option of node.options) {
    await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
    const rows = await page.getByTestId(`option-preview-${option.id}`).locator('li').allTextContents();
    const expected = option.preview.map(effect => {
      const delta = BigInt(effect.delta) < 0n ? effect.delta : `+${effect.delta}`;
      const unit = effect.what.startsWith('trait:') ? 'trait_points' : effect.what === 'debt' ? 'money' : effect.what;
      const detail = effect.what.startsWith('trait:') ? ` (${effect.what})` : effect.what === 'debt' ? ' (debt)' : '';
      return `${personName(world, effect.person)}: ${delta} ${unit}${detail} · Person ${effect.person}`;
    });
    expect(rows).toEqual(expected.length ? expected : ['No numerical effects in this preview.']);
  }
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 640 }]) {
  test(`native App living, current choice and Waiting at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    const network = await offline(page); await page.setViewportSize(viewport); await page.goto('/?harness=1');
    await page.waitForFunction(() => window.__simHarness !== undefined);
    await expect(page.getByTestId('world-setup')).toHaveJSProperty('open', true);
    await expect(page.getByTestId('technical-details')).toHaveJSProperty('open', false);
    await nativeCreate(page, waitingFixture);
    await expect(page.getByTestId('life-app')).toHaveAttribute('data-assets', 'ready');
    const living = await worldRead(page); expect(living.player.body).not.toBeNull();
    await expect(page.getByTestId('life-name')).toHaveText(personName(living, living.player.body!));
    await expect(page.getByTestId('life-soul')).toContainText(living.player_soul);
    await expect(page.getByTestId('town-disclosure')).toHaveJSProperty('open', false);
    await atlasPixels(page); await noHorizontalOverflow(page); await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, info, `c3-native-${viewport.width}x${viewport.height}-living`, { mode: 'NATIVE-APP-RULES-ONLY', world: living, progression: 'Real Create controls; no fixture state injection' });

    const choice = await nativeChoice(page); await verifyChoice(page, choice);
    await expect(page.getByTestId('run')).toBeDisabled(); await expect(page.getByTestId('step')).toBeDisabled();
    await atlasPixels(page); await noHorizontalOverflow(page); await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, info, `c3-native-${viewport.width}x${viewport.height}-choice`, { mode: 'NATIVE-APP-RULES-ONLY', world: choice, fixture: 'fixtures/parity/seedP-playthrough.replay.json', progression: 'Native step prefix and real UI final Step; no Choose injected' });

    const waiting = await nativeWaiting(page);
    if (await page.getByTestId('scene-close').isVisible()) await page.getByTestId('scene-close').click();
    await expect(page.getByTestId('life-soul')).toContainText(waiting.player_soul);
    await expect(page.getByTestId('identity-state')).toContainText('Waiting between lives');
    const view = waiting.underworld_view!;
    expect(await page.locator('[data-testid^="slot-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(view.slots.map(slot => `slot-${slot.slot}`));
    expect(view.slots.filter(slot => slot.kind !== 'birth_slot').map(slot => slot.slot)).toEqual(['imported_vessel', 'rebuilt_body']);
    expect(await page.getByTestId('dreamer').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(view.connected.map(String));
    expect(await page.getByTestId('carry-over').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    for (const target of view.actions.haunt.targets) await expect(page.getByTestId(`haunt-target-${target.target}`)).toHaveCount(1);
    for (const slot of view.slots) await expect(page.getByTestId(`claim-${slot.slot}`)).toHaveCount(1);
    for (const id of ['dream-send', 'bribe-amount', 'bribe-send', 'haunt-send', 'customize']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('town-disclosure')).toHaveJSProperty('open', false);
    await atlasPixels(page); await noHorizontalOverflow(page); await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, info, `c3-native-${viewport.width}x${viewport.height}-waiting`, { mode: 'NATIVE-APP-RULES-ONLY', world: waiting, fixture: 'fixtures/parity/seedU-underworld.replay.json', prefixSeqExclusive: '61', progression: 'Same checked native Waiting helper as smoke decision.spec; actual UI final Step' });

    const before = await exportRead(page);
    await disclosure(page, 'town-disclosure', true); await expect(page.getByTestId('town-view')).toBeVisible();
    await page.getByTestId('life-surface').getByRole('link', { name: 'Back to current action', exact: true }).click();
    await disclosure(page, 'town-disclosure', false);
    await disclosure(page, 'world-setup', true); await disclosure(page, 'world-setup', false);
    await disclosure(page, 'technical-details', true); await disclosure(page, 'technical-details', false);
    await page.getByTestId('customize').click(); await page.getByTestId('customization-kind').selectOption('Adjust');
    await page.getByTestId('customization-cancel').click();
    expect(await exportRead(page), 'Map/disclosures/local Back/cancel do not submit or advance the native World').toBe(before);
    await expect(page.getByTestId('tick')).toHaveText(waiting.tick);
    await expect(page.getByTestId('decision-notice')).toHaveCount(1);
    expect(await page.getByTestId('decision-notice').evaluate(element => element.closest('details') === null)).toBe(true);
    network.finish();
  });
}

test('native syntax-valid zero reaches actual Core bad_amount without a fake success', async ({ page }, info) => {
  const network = await offline(page); await page.goto('/?harness=1');
  await page.waitForFunction(() => window.__simHarness !== undefined); const world = await nativeWaiting(page);
  expect(world.underworld_view!.actions.bribe.availability.eligible).toBe(true);
  const before = await exportRead(page);
  for (const invalid of ['01', ' 1', '1 ', '+1', '-1', '1e3', '1.0', '18446744073709551616']) {
    await page.getByTestId('bribe-amount').fill(invalid); await expect(page.getByTestId('bribe-send')).toBeDisabled();
    await expect(page.getByTestId('bribe-syntax-error')).toBeVisible(); await page.getByTestId('bribe-amount').press('Enter');
  }
  expect(await exportRead(page), 'Invalid amount syntax submits nothing').toBe(before);
  await page.getByTestId('bribe-amount').fill('0'); await expect(page.getByTestId('bribe-send')).toBeEnabled();
  await page.getByTestId('bribe-send').click();
  await expect(page.getByTestId('action-feedback').filter({ hasText: /bribe: rejected.*bad_amount/ })).toBeVisible();
  expect(await exportRead(page), 'Checked Core rejection does not add a replay input').toBe(before);
  await expect(page.getByTestId('tick')).toHaveText(world.tick);
  await capture(page, info, 'c3-native-zero-core-rejection', { mode: 'NATIVE-APP-RULES-ONLY', world, beforeReplaySha256: createHash('sha256').update(before).digest('hex'), feedback: await page.getByTestId('action-feedback').allTextContents(), operation: { type: 'bribe', amount: '0' }, expectedCoreRejection: 'bad_amount' });
  network.finish();
});

test('one controlled atlas 404 shows a material error while native facts and controls remain usable', async ({ page }, info) => {
  const failedAtlas = '/assets/life-view-urban.png'; const network = await offline(page, failedAtlas);
  await page.setViewportSize({ width: 1024, height: 640 }); await page.goto('/?harness=1');
  await page.waitForFunction(() => window.__simHarness !== undefined); await nativeCreate(page, waitingFixture);
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-assets', 'error');
  await expect(page.getByTestId('art-error')).toBeVisible(); await expect(page.getByTestId('art-error')).toContainText(/visual|asset/i);
  const world = await worldRead(page); await expect(page.getByTestId('life-name')).toHaveText(personName(world, world.player.body!));
  await expect(page.getByTestId('run')).toBeEnabled(); await expect(page.getByTestId('step')).toBeEnabled();
  const colors = await page.getByTestId('scene-picture-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement; const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    return colors.size;
  });
  expect(colors, 'No placeholder/fallback picture is painted after loader failure').toBeLessThanOrEqual(1);
  await page.getByTestId('step').click(); await expect(page.getByTestId('tick')).toHaveText('1');
  await expect(page.getByTestId('art-error')).toBeVisible();
  expect(network.atlasRequests.filter(path => path === failedAtlas), 'Failed atlas requested exactly once, including after a real Step').toHaveLength(1);
  expect(network.atlasRequests.filter(path => path !== failedAtlas).sort()).toEqual(['/assets/life-view-original.png', '/assets/life-view-roguelike.png']);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, info, 'c3-native-controlled-atlas-404', { mode: 'NATIVE-APP-CONTROLLED-ASSET-FAULT', controlledFault: { path: failedAtlas, status: 404 }, atlasRequests: network.atlasRequests, consoleErrors: network.consoleErrors, world: await worldRead(page), paintedColors: colors, limits: 'Controlled local material failure, not a naturally observed production outage.' });
  network.finish();
});

async function componentOpen(page: Page, scenario: string, viewport: { width: number; height: number }): Promise<FixtureEvidence> {
  await page.setViewportSize(viewport); await page.goto(`${COMPONENT}/life-view-fixture.html?state=${scenario}`);
  await expect(page.getByTestId('fixture-label')).toContainText('COMPONENT-ONLY');
  await expect(page.getByTestId('component-fixture')).toHaveAttribute('data-assets', 'ready');
  await atlasPixels(page); await noHorizontalOverflow(page);
  const evidence = await fixtureRead(page); expect(evidence.mode).toBe('COMPONENT-ONLY');
  return evidence;
}

for (const viewport of [{ width: 640, height: 360 }, { width: 512, height: 320 }]) {
  test(`COMPONENT-ONLY full Waiting rows and callback payloads reflow at ${viewport.width}px (200% equivalent)`, async ({ page }, info) => {
    const network = await offline(page); const original = await componentOpen(page, 'waiting-large', viewport); const world = original.ui.world!; const view = world.underworld_view!;
    expect(await page.locator('[data-testid^="slot-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(view.slots.map(slot => `slot-${slot.slot}`));
    const firstSlot = page.getByTestId(`path-${view.slots[0]!.slot}`);
    await expect(firstSlot.locator('li')).toHaveCount(view.slots[0]!.status.needed.length);
    for (const needed of view.slots[0]!.status.needed) await expect(firstSlot).toContainText(needed.kind === 'named' ? needed.name : needed.kind === 'wait_until' ? needed.tick : needed.amount);
    await expect(page.getByTestId('joss-balance')).toContainText(MAX_U64); await expect(page.getByTestId('capped-spend')).toContainText(ABOVE_SAFE);
    await expect(page.getByTestId('dream-price')).toHaveText(ABOVE_SAFE); await expect(page.getByTestId('haunt-price')).toHaveText(ABOVE_SAFE);
    await expect(page.getByTestId('identity-state')).toContainText(MAX_U64);
    for (const id of ['blood-ties', 'past-life-ties', 'earlier-lives']) {
      const entries = id === 'blood-ties' ? world.player.blood_ties : id === 'past-life-ties' ? world.player.past_life_ties : world.player.earlier_bodies;
      await expect(page.getByTestId(id).locator('li')).toHaveCount(entries.length);
      const last = page.getByTestId(id).locator('li').last(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
    }
    await expect(page.getByTestId('earlier-lives').locator('li').last()).toContainText(world.player.earlier_bodies.at(-1)!.name);
    await expect(page.getByTestId('chronicle-entry')).toHaveCount(100);
    await page.getByTestId('chronicle-entry').last().scrollIntoViewIfNeeded(); await expect(page.getByTestId('chronicle-entry').last()).toBeInViewport();
    await expect(page.getByTestId('chronicle')).toContainText(MIN_I64); await expect(page.getByTestId('chronicle')).toContainText(MAX_I64);
    await capture(page, info, `c3-component-${viewport.width}-history-last`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page), visibleEndpoint: 'Last of the real 100 Chronicle snapshot rows' });
    await firstSlot.scrollIntoViewIfNeeded();
    await capture(page, info, `c3-component-${viewport.width}-needed`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page), visibleEndpoint: 'Complete Needed variants and existing named reasons; constructed presentation combination' });
    const targetRows = await page.getByTestId('haunt-targets').locator('li').allTextContents();
    expect(targetRows.length).toBe(view.actions.haunt.targets.length);
    for (const [index, target] of view.actions.haunt.targets.entries()) expect(targetRows[index]).toContain(personName(world, target.target));
    const beforeMap = (await fixtureRead(page)).callbacks;
    await disclosure(page, 'town-disclosure', true); await page.getByRole('link', { name: 'Back to current action', exact: true }).click(); await disclosure(page, 'town-disclosure', false);
    expect((await fixtureRead(page)).callbacks).toEqual(beforeMap);

    const carry = page.getByTestId('carry-over');
    expect(await carry.locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    for (const value of ['', ...TRAITS]) { await carry.selectOption(value); expect((await fixtureRead(page)).ui.underworldForm.carryOver).toBe(value || null); }
    await page.getByTestId('customize').click();
    expect(await page.getByTestId('customization-panel').evaluate(element => element.closest('[data-testid="birth-slots"]') === null)).toBe(true);
    expect(await page.getByTestId('customization-trait').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    expect(await page.getByTestId('customization-value').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', '-3', '-2', '-1', '0', '1', '2', '3']);
    await expect(page.getByTestId('claim-rebuilt_body')).toBeDisabled();
    await carry.selectOption(''); await page.getByTestId('customization-trait').selectOption('greed'); await page.getByTestId('customization-value').selectOption('-3');
    expect(await page.getByTestId('customization-preview').locator('tbody tr').locator('th, td').allTextContents()).toEqual(['greed', String(view.base_traits.find(entry => entry.carry_over === null)!.traits.greed), '-3', MAX_U64]);
    for (const [index, trait] of TRAITS.entries()) {
      await carry.selectOption(trait); await page.getByTestId('customization-trait').selectOption(trait); await page.getByTestId('customization-value').selectOption(String(index - 3));
      await expect(page.getByTestId('customization-preview').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByTestId('customization-override')).toContainText(trait);
      expect(await page.getByTestId('customization-preview').locator('tbody tr').locator('th, td').allTextContents()).toEqual([trait, String(view.base_traits.find(entry => entry.carry_over === trait)!.traits[trait]), String(index - 3), MAX_U64]);
      await page.getByTestId('claim-rebuilt_body').click();
      const last = (await fixtureRead(page)).callbacks.at(-1)!;
      expect(last).toMatchObject({ kind: 'claim', worldId: original.ui.worldId, slot: 'rebuilt_body', request: { type: 'claim', slot: 'rebuilt_body', carryOver: trait, customization: { Set: { trait_name: trait, value: index - 3 } } } });
    }
    await page.getByTestId('customization-preview').scrollIntoViewIfNeeded();
    await capture(page, info, `c3-component-${viewport.width}-set`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page), visibleEndpoint: 'Set form and exact base/customized/price; outside birth-slot scroller' });
    await page.getByTestId('customization-kind').selectOption('Adjust');
    for (const id of ['customization-first', 'customization-second']) expect(await page.getByTestId(id).locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    for (const id of ['customization-first-delta', 'customization-second-delta']) expect(await page.getByTestId(id).locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', '1', '-1']);
    await page.getByTestId('customization-first').selectOption('greed'); await page.getByTestId('customization-first-delta').selectOption('1');
    await page.getByTestId('customization-second').selectOption('greed'); await page.getByTestId('customization-second-delta').selectOption('-1');
    await expect(page.getByTestId('claim-rebuilt_body')).toBeDisabled();
    await page.getByTestId('customization-second').selectOption('loyalty');
    const adjustBase = view.base_traits.find(entry => entry.carry_over === 'piety')!.traits;
    const adjustRows = await page.getByTestId('customization-preview').locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('th, td')].map(cell => cell.textContent)));
    expect(adjustRows).toEqual([
      ['greed', String(adjustBase.greed), String(Math.min(3, Math.max(-3, adjustBase.greed + 1))), MAX_U64],
      ['loyalty', String(adjustBase.loyalty), String(Math.min(3, Math.max(-3, adjustBase.loyalty - 1))), MAX_U64],
    ]);
    await page.getByTestId('customization-preview').scrollIntoViewIfNeeded();
    await capture(page, info, `c3-component-${viewport.width}-adjust`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page), visibleEndpoint: 'Complete two-row Adjust preview and real clamped values' });
    await page.getByTestId('claim-rebuilt_body').click();
    expect((await fixtureRead(page)).callbacks.at(-1)).toMatchObject({ kind: 'claim', request: { customization: { Adjust: { first: { trait_name: 'greed', delta: 1 }, second: { trait_name: 'loyalty', delta: -1 } } } } });
    await page.getByTestId('customization-cancel').click(); await expect(page.getByTestId('customization-panel')).toHaveCount(0);
    const lastBirth = view.slots.filter(slot => slot.kind === 'birth_slot').at(-1)!;
    await page.getByTestId(`claim-${lastBirth.slot}`).scrollIntoViewIfNeeded(); await expect(page.getByTestId(`claim-${lastBirth.slot}`)).toBeInViewport();
    await capture(page, info, `c3-component-${viewport.width}-birth-last`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page), visibleEndpoint: lastBirth.slot });
    await page.getByTestId(`claim-${lastBirth.slot}`).click();
    expect((await fixtureRead(page)).callbacks.at(-1)).toMatchObject({ kind: 'claim', slot: lastBirth.slot, request: { type: 'claim', slot: lastBirth.slot, carryOver: 'piety' } });
    await page.getByTestId('claim-imported_vessel').click(); expect((await fixtureRead(page)).callbacks.at(-1)).toMatchObject({ kind: 'claim', request: { type: 'claim', slot: 'imported_vessel' } });
    for (const amount of [ABOVE_SAFE, MAX_U64, '0']) {
      await page.getByTestId('bribe-amount').fill(amount); await expect(page.getByTestId('bribe-amount')).toHaveValue(amount); await page.getByTestId('bribe-send').click();
      expect((await fixtureRead(page)).callbacks.at(-1)).toEqual({ kind: 'bribe', worldId: original.ui.worldId, amount });
    }
    const beforeInvalid = (await fixtureRead(page)).callbacks.length;
    for (const amount of ['', '01', ' 1', '1 ', '+1', '-1', '1e3', '1.0', '18446744073709551616', '９']) {
      await page.getByTestId('bribe-amount').fill(amount); await expect(page.getByTestId('bribe-send')).toBeDisabled();
      if (amount !== '') await expect(page.getByTestId('bribe-syntax-error')).toBeVisible();
      await page.getByTestId('bribe-amount').press('Enter');
    }
    expect((await fixtureRead(page)).callbacks.length).toBe(beforeInvalid);
    const lastTarget = view.actions.haunt.targets.at(-1)!.target;
    await page.getByTestId(`haunt-target-${lastTarget}`).check(); await page.getByTestId('haunt-send').click();
    expect((await fixtureRead(page)).callbacks.at(-1)).toEqual({ kind: 'haunt', worldId: original.ui.worldId, target: lastTarget });
    await page.getByTestId('dreamer').selectOption(String(view.connected.at(-1)!)); await page.getByTestId('dream-intent-urge').click(); await page.getByTestId('dream-send').click();
    expect((await fixtureRead(page)).callbacks.at(-1)).toMatchObject({ kind: 'dream', request: { type: 'dream', dreamer: view.connected.at(-1), intent: 'urge' } });
    await page.getByTestId('bribe-amount').fill('1'); await page.getByTestId('bribe-amount').focus(); await page.keyboard.press('Tab');
    await expect(page.getByTestId('bribe-send')).toBeFocused();
    const focus = await page.getByTestId('bribe-send').evaluate(element => ({ visible: element.matches(':focus-visible'), width: getComputedStyle(element).outlineWidth, color: getComputedStyle(element).outlineColor }));
    expect(focus.visible).toBe(true); expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2); expect(focus.color).not.toBe('rgba(0, 0, 0, 0)');
    await noHorizontalOverflow(page);
    await capture(page, info, `c3-component-${viewport.width}-keyboard-focus`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page), keyboardFocus: focus });
    const final = await fixtureRead(page); expect(final.ui.world).toEqual(original.ui.world); expect(final.ui.tick).toBe(original.ui.tick);
    await disclosure(page, 'fixture-records', true); await expect(page.getByTestId('fixture-callbacks')).toContainText(ABOVE_SAFE); await expect(page.getByTestId('fixture-callbacks')).toContainText(MAX_U64);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, info, `c3-component-${viewport.width}-waiting`, { mode: 'COMPONENT-ONLY', equivalentZoom: { percent: 200, baseWidth: viewport.width * 2, baseHeight: viewport.height * 2 }, fixture: final, keyboardFocus: focus, limits: 'Callback intent and reflow only. No admission, native action, lifetime maximum or C4 motion proof.' });
    network.finish();
  });

  test(`COMPONENT-ONLY all choice previews, names, history and last options reflow at ${viewport.width}px`, async ({ page }, info) => {
    const network = await offline(page); const original = await componentOpen(page, 'choice-large', viewport); const world = original.ui.world!;
    await verifyChoice(page, world); await expect(page.getByTestId('stakes')).toContainText(MIN_I64); await expect(page.getByTestId('stakes')).toContainText(MAX_U64);
    await expect(page.getByTestId('current-name')).toHaveText(personName(world, world.player.body!));
    await expect(page.getByTestId('current-relations').locator('li')).toHaveCount(world.player.relations.length);
    await expect(page.getByTestId('chronicle-entry')).toHaveCount(world.chronicle.length);
    for (const id of ['current-relations', 'earlier-lives', 'past-life-ties', 'chronicle']) {
      const last = page.getByTestId(id).locator('li').last(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
    }
    for (const option of world.player_node!.options) {
      const last = page.getByTestId(`option-preview-${option.id}`).locator('li').last(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
      if (option.id === world.player_node!.options.at(-1)!.id) await capture(page, info, `c3-component-${viewport.width}-choice-preview-last`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page), visibleEndpoint: `Last Preview row for ${option.id}` });
      await page.getByTestId(`option-${option.id}`).focus(); await page.getByTestId(`option-${option.id}`).press('Enter');
      expect((await fixtureRead(page)).callbacks.at(-1)).toEqual({ kind: 'choose', worldId: original.ui.worldId, node: world.player_node!.id, option: option.id });
    }
    await noHorizontalOverflow(page); const final = await fixtureRead(page); expect(final.ui).toEqual(original.ui);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, info, `c3-component-${viewport.width}-choice`, { mode: 'COMPONENT-ONLY', equivalentZoom: { percent: 200, baseWidth: viewport.width * 2, baseHeight: viewport.height * 2 }, fixture: final, limits: 'Constructed complete existing carrier fields, not native or invented context/bounds/deltas.' });
    network.finish();
  });
}

test('COMPONENT-ONLY target selection invalidates removed/ineligible targets and generation, not an unchanged tick advance', async ({ page }, info) => {
  const network = await offline(page); await componentOpen(page, 'waiting', { width: 1024, height: 640 });
  const initial = await fixtureRead(page); const first = initial.ui.world!.underworld_view!.actions.haunt.targets[0]!.target;
  const second = initial.ui.world!.underworld_view!.actions.haunt.targets[1]!.target;
  const selected = page.getByTestId(`haunt-target-${first}`);
  await selected.check(); await page.getByTestId('bribe-amount').fill(ABOVE_SAFE);
  await disclosure(page, 'fixture-carrier-controls', true);
  await page.getByTestId('fixture-advance').click(); await expect(selected).toBeChecked(); await expect(page.getByTestId('bribe-amount')).toHaveValue(ABOVE_SAFE);
  await page.getByTestId('fixture-block-target').click(); await expect(selected).toBeDisabled(); await expect(selected).not.toBeChecked(); await expect(page.getByTestId('haunt-send')).toBeDisabled();
  await expect(page.getByTestId(`haunt-target-${second}`)).toBeEnabled();
  for (const id of ['dream-send', 'bribe-send', 'claim-imported_vessel', 'customize']) await expect(page.getByTestId(id)).toBeEnabled();
  await page.getByTestId('fixture-restore-target').click(); await expect(selected).toBeEnabled(); await expect(selected).not.toBeChecked();
  await selected.check(); await page.getByTestId('fixture-remove-target').click(); await expect(selected).toHaveCount(0);
  await expect(page.getByTestId(`haunt-target-${second}`)).toBeEnabled();
  for (const id of ['dream-send', 'claim-imported_vessel', 'customize']) await expect(page.getByTestId(id)).toBeEnabled();
  await page.getByTestId('fixture-restore-target').click(); await expect(selected).not.toBeChecked();
  await selected.check(); await page.getByTestId('fixture-generation').click(); await expect(selected).not.toBeChecked(); await expect(page.getByTestId('bribe-amount')).toHaveValue('');
  await page.getByTestId(`haunt-target-${second}`).check(); await expect(page.getByTestId('haunt-send')).toBeEnabled();
  await expect(page.getByTestId('dream-send')).toBeEnabled(); await expect(page.getByTestId('claim-imported_vessel')).toBeEnabled();
  await page.getByTestId('customize').click(); await page.getByTestId('customization-trait').selectOption('piety'); await page.getByTestId('customization-value').selectOption('3'); await expect(page.getByTestId('claim-rebuilt_body')).toBeEnabled();
  const final = await fixtureRead(page); expect(final.callbacks.filter(callback => !['form', 'fixture-carrier-change'].includes(String(callback.kind)))).toEqual([]);
  await capture(page, info, 'c3-component-selection-invalidation', { mode: 'COMPONENT-ONLY', fixture: final, transitions: ['unchanged eligible + tick retains selection', 'ineligible then restored stays unselected', 'removed then restored stays unselected', 'new generation clears target and amount'], limits: 'Explicit constructed prop changes, not natural Worker/Core events.' });
  network.finish();
});

test('COMPONENT-ONLY unchanged constructed ticks cache the primary picture and do not draw a closed town map', async ({ page }) => {
  const network = await offline(page);
  await page.addInitScript(() => {
    const paint = { counts: new WeakMap<HTMLCanvasElement, number>(), total: 0 };
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
      original.call(this, x, y, width, height);
      paint.counts.set(this.canvas, (paint.counts.get(this.canvas) ?? 0) + 1);
      paint.total += 1;
    };
    window.__lifeViewPaint = paint;
  });
  const initial = await componentOpen(page, 'waiting', { width: 1024, height: 640 });
  const world = initial.ui.world!;
  expect(world.player.place).toBe('waiting');
  const primary = page.getByTestId('scene-picture-canvas');
  await expect(primary).toHaveCount(1);
  const primaryCanvas = await primary.elementHandle();
  if (primaryCanvas === null) throw Error('Actual primary scene canvas is missing');
  const readPrimary = () => primaryCanvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return {
      current: canvas === document.querySelector('[data-testid="scene-picture-canvas"]'),
      clears: window.__lifeViewPaint!.counts.get(canvas) ?? 0,
      picture: canvas.toDataURL(),
    };
  });
  const totalClears = () => page.evaluate(() => window.__lifeViewPaint!.total);
  // componentOpen also checks actual atlas pixels (>4 colors), not a blank canvas.
  const initialPaint = await readPrimary();
  expect(initialPaint.current).toBe(true); expect(initialPaint.clears).toBeGreaterThan(0);
  await expect(page.getByTestId('town-disclosure')).toHaveJSProperty('open', false);
  const town = page.getByTestId('town-view');
  await expect(town).toHaveCount(0);
  const initialTotal = await totalClears();
  const observed = page.getByTestId('underworld-observed-tick');
  const observation = (tick: string) => `Applied World values as of tick ${tick}. Queued inputs do not reserve or subtract these amounts.`;
  await expect(observed).toHaveText(observation(world.tick));
  await disclosure(page, 'fixture-carrier-controls', true);
  await page.getByTestId('fixture-advance').click();
  const firstTick = String(BigInt(world.tick) + 1n);
  await expect(observed).toHaveText(observation(firstTick));
  const advanced = await fixtureRead(page);
  expect(advanced.ui.tick).toBe(firstTick); expect(advanced.ui.world).toEqual({ ...world, tick: firstTick });
  const firstAdvance = { kind: 'fixture-carrier-change', change: 'advance', oldWorldId: initial.ui.worldId, worldId: initial.ui.worldId, tick: firstTick };
  expect(advanced.callbacks).toEqual([...initial.callbacks, firstAdvance]);
  expect(await readPrimary(), 'Same mounted primary canvas, unchanged real pixels and clear count after an explicit constructed tick').toEqual(initialPaint);
  expect(await totalClears()).toBe(initialTotal); await expect(town).toHaveCount(0);

  await disclosure(page, 'town-disclosure', true); await expect(town).toBeVisible();
  await expect.poll(() => town.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
    return colors.size;
  })).toBeGreaterThan(4);
  const townCanvas = await town.elementHandle();
  if (townCanvas === null) throw Error('Actual opened town canvas is missing');
  const readTown = () => townCanvas.evaluate(element => ({
    connected: element.isConnected,
    clears: window.__lifeViewPaint!.counts.get(element as HTMLCanvasElement) ?? 0,
  }));
  const townPaint = await readTown();
  expect(townPaint.connected).toBe(true); expect(townPaint.clears).toBeGreaterThan(0);
  expect(await readPrimary()).toEqual(initialPaint);
  await disclosure(page, 'town-disclosure', false); await expect(town).toHaveCount(0);
  expect(await readTown()).toEqual({ ...townPaint, connected: false });
  const closedTotal = await totalClears();

  await page.getByTestId('fixture-advance').click();
  const secondTick = String(BigInt(firstTick) + 1n);
  await expect(observed).toHaveText(observation(secondTick));
  const closedAdvance = await fixtureRead(page);
  expect(closedAdvance.ui.tick).toBe(secondTick); expect(closedAdvance.ui.world).toEqual({ ...world, tick: secondTick });
  expect(closedAdvance.callbacks).toEqual([...initial.callbacks, firstAdvance, { ...firstAdvance, tick: secondTick }]);
  await expect(page.getByTestId('town-disclosure')).toHaveJSProperty('open', false); await expect(town).toHaveCount(0);
  expect(await readTown(), 'The removed real map canvas receives no further clear').toEqual({ ...townPaint, connected: false });
  expect(await totalClears(), 'No canvas, including any hidden or replacement map, is redrawn on the closed-map tick').toBe(closedTotal);
  expect(await readPrimary(), 'Primary canvas identity, actual image and render count stay cached').toEqual(initialPaint);
  network.finish();
});

test('test-only mounting entry is absent from the default production deployment', async ({ page }) => {
  const network = await offline(page);
  expect(existsSync(new URL('../../dist/life-view-fixture.html', import.meta.url))).toBe(false);
  const response = await page.request.get(`${PREVIEW}/life-view-fixture.html`);
  expect(await response.text()).not.toContain('/tests/fixtures/life-view.ts');
  await page.goto('/'); await expect(page.getByTestId('fixture-label')).toHaveCount(0); await expect(page.getByTestId('world-setup')).toBeVisible();
  network.finish();
});
