/// <reference lib="dom" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { UiState } from '../../src/main/ui-state.ts';
import type { Needed, Preview, Traits, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import type { LifeNotebookExport } from '../../src/main/life-journal.ts';
import { TRAITS } from '../../src/main/customization.ts';
import { REJECTION_LABELS, TRAIT_LABELS, UNIT_LABELS } from '../../src/main/player-copy.ts';
import { test, expect, nativeZoomMetrics, nativeZoomScreenshot } from './native-zoom.ts';
import {
  scenarios, openOperations, restoreScenario, worldRead, replayRead, probeRead, saveOperation,
} from './operations-fixture.ts';

const ROOT = new URL('../../../', import.meta.url);
const EVIDENCE = new URL('target/life-unfolds/lu-p1-zoom/', ROOT);
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
async function disclosureWithKeys(page: Page, id: string, open: boolean): Promise<void> {
  const disclosure = page.getByTestId(id);
  if ((await disclosure.getAttribute('open') !== null) !== open) {
    await tabTo(page, disclosure.locator(':scope > summary'));
    await page.keyboard.press('Enter');
  }
  await expect(disclosure).toHaveJSProperty('open', open);
}
function decimal(text: string): bigint {
  expect(text).toMatch(/^[+−-]?(?:\d{1,3}(?:,\d{3})+|\d+)$/);
  return BigInt(text.replace(/,/g, '').replace('−', '-'));
}
function decodeNeeded(text: string): Needed {
  const date = /^Opens Year (-?\d+), Day (\d+)(?: — Halloween)?\.$/.exec(text);
  if (date !== null) {
    const day = BigInt(date[2]!);
    expect(day >= 1n && day <= 365n).toBe(true);
    return { kind: 'wait_until', tick: ((BigInt(date[1]!) - 1n) * 365n + day - 1n).toString() };
  }
  const joss = /^You are ([\d,]+) joss paper short\.$/.exec(text);
  if (joss !== null) return { kind: 'joss_short', amount: decimal(joss[1]!).toString() };
  const cap = /^Your yearly allowance is ([\d,]+) short\.$/.exec(text);
  if (cap !== null) return { kind: 'cap_room_short', amount: decimal(cap[1]!).toString() };
  const named = Object.entries(REJECTION_LABELS).find(([, label]) => label === text);
  if (named === undefined) throw Error(`An application requirement lost its factual identity: ${text}`);
  return { kind: 'named', name: named[0] };
}
function personName(world: WorldSnapshot, person: number): string {
  const name = world.residents.find(record => record.id === person)?.name
    ?? world.player.earlier_bodies.find(record => record.id === person)?.name
    ?? world.person_names.find(record => record.id === person)?.name;
  if (name === undefined) throw Error(`The source World has no name for person ${person}`);
  return name;
}
async function verifyPreview(container: Locator, preview: readonly Preview[], world: WorldSnapshot): Promise<void> {
  const rows = container.locator('[data-person][data-unit][data-delta]');
  const rendered = await rows.evaluateAll(elements => elements.map(element => ({
    person: Number(element.getAttribute('data-person')), what: element.getAttribute('data-unit'), delta: element.getAttribute('data-delta'),
    text: (element as HTMLElement).innerText, visible: element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible',
  })));
  expect(rendered.map(({ person, what, delta }) => ({ person, what, delta }))).toEqual(preview);
  for (const [index, effect] of preview.entries()) {
    const row = rendered[index]!;
    expect(row.visible).toBe(true);
    const unit = effect.what.startsWith('trait:') ? TRAIT_LABELS[effect.what.slice(6) as keyof Traits] : UNIT_LABELS[effect.what as keyof typeof UNIT_LABELS];
    expect(row.text).toContain(unit);
    expect(row.text).toContain(effect.person === world.player.body ? 'You:' : personName(world, effect.person));
    const signed = /([+−-](?:\d{1,3}(?:,\d{3})+|\d+))\s*$/.exec(row.text);
    expect(signed).not.toBeNull();
    expect(decimal(signed![1]!)).toBe(BigInt(effect.delta));
    expect(signed![1]!.startsWith('+')).toBe(BigInt(effect.delta) >= 0n);
  }
}
async function verifyTraitPreview(page: Page, base: Traits, changed: Partial<Traits>, price: string): Promise<void> {
  const table = page.getByTestId('customization-preview');
  expect(await table.locator('[data-trait]').evaluateAll(elements => elements.map(element => element.getAttribute('data-trait')))).toEqual(TRAITS);
  for (const trait of TRAITS) {
    const row = table.locator(`[data-trait="${trait}"]`);
    await expect(row).toContainText(TRAIT_LABELS[trait]);
    expect(await row.locator('td').allTextContents()).toEqual([String(base[trait]), String(changed[trait] ?? base[trait])]);
  }
  const amount = page.getByTestId('customization-price');
  await expect(amount).toHaveAttribute('data-amount', price);
  expect(decimal(await amount.locator('strong').innerText())).toBe(BigInt(price));
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
      await disclosureWithKeys(page, 'rebirth-section', true);
      expect(await page.locator('[data-testid^="slot-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))))
        .toEqual(view.slots.map(slot => `slot-${slot.slot}`));
      for (const slot of view.slots) {
        const row = page.getByTestId(`slot-${slot.slot}`);
        const amount = row.locator('[data-price]');
        await expect(amount).toHaveAttribute('data-price', slot.price);
        expect(decimal((await amount.innerText()).split(' joss paper')[0]!)).toBe(BigInt(slot.price));
        const needed = row.getByRole('list', { name: 'Application requirements', exact: true }).getByRole('listitem');
        expect((await needed.allTextContents()).map(text => decodeNeeded(text.trim()))).toEqual(slot.status.needed);
        const apply = page.getByTestId(`claim-${slot.slot}`);
        await expect(apply).toHaveCount(1);
        if (!slot.status.claimable || !slot.status.affordable || slot.slot === 'rebuilt_body') await expect(apply).toBeDisabled();
        else await expect(apply).toBeEnabled();
      }
      await disclosureWithKeys(page, 'people-files', true);
      for (const [id, entries] of [
        ['blood-ties', world.player.blood_ties.map(tie => ({ person: tie.person, affinity: tie.affinity }))],
        ['past-life-ties', world.player.past_life_ties.map(tie => ({ person: tie.rememberer, affinity: tie.affinity, earlier: tie.earlier_body }))],
        ['earlier-lives', world.player.earlier_bodies.map(body => ({ person: body.id }))],
      ] as const) {
        await disclosureWithKeys(page, id, true);
        const cards = page.getByTestId(id).getByTestId('people-card');
        expect(await cards.evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-person'))))).toEqual(entries.map(entry => entry.person));
        for (const [index, entry] of entries.entries()) {
          const card = cards.nth(index);
          await expect(card).toContainText(personName(world, entry.person));
          if ('affinity' in entry) await expect(card).toHaveAttribute('data-relationship', String(entry.affinity));
          if ('earlier' in entry) {
            expect(typeof entry.earlier).toBe('number');
            await expect(card).toContainText(personName(world, entry.earlier as number));
          }
        }
      }
      await disclosureWithKeys(page, 'fixture-records', true);
      await tabTo(page, page.getByTestId('fixture-export-facts'));
      const pendingDownload = page.waitForEvent('download');
      await page.keyboard.press('Enter');
      const download = await pendingDownload;
      const archivePath = await download.path();
      if (archivePath === null) throw Error('The factual archive download is missing');
      const archive = JSON.parse(readFileSync(archivePath, 'utf8')) as LifeNotebookExport;
      expect(archive.worldId).toBe(before.ui.worldId);
      expect(Object.values(archive.chronicle).map(record => ({
        tick: record.tick, family: record.family, stakes: record.stakes, applied: record.applied,
        source: record.source, chooser_absent: record.chooserAbsent, skipped: record.skipped,
      }))).toEqual(world.chronicle);
      await disclosureWithKeys(page, 'fixture-records', false);
      for (const [id, targets] of [
        ['dream', view.connected], ['haunt', view.actions.haunt.targets.map(target => target.target)],
      ] as const) {
        await disclosureWithKeys(page, `${id}-section`, true);
        const radios = page.getByTestId(`${id}-targets`).getByRole('radio');
        expect(await radios.evaluateAll(elements => elements.map(element => Number((element as HTMLInputElement).value)))).toEqual(targets);
        for (const target of targets) await expect(page.getByTestId(`${id}-target-${target}`)).toHaveAccessibleName(new RegExp(personName(world, target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        await disclosureWithKeys(page, `${id}-section`, false);
      }
      await disclosureWithKeys(page, 'carry-section', true);
      expect(await page.getByTestId('carry-over').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
      for (const trait of TRAITS) {
        const option = page.getByTestId('carry-over').locator(`option[value="${trait}"]`);
        await expect(option).toContainText(TRAIT_LABELS[trait]);
        expect(decimal((await option.textContent())!.split(': ')[1]!)).toBe(BigInt(view.ghost_traits[trait]));
      }
      await capture(page, info, `${viewport.width}-waiting-first`, { layer: 'COMPONENT-ONLY', fixture: before, scope: 'Constructed stress carrier, not a configured maximum or live operation' });
      await selectWithKeys(page, 'carry-over', 'piety');
      await tabTo(page, page.getByTestId('customize')); await page.keyboard.press('Enter');
      await selectWithKeys(page, 'customization-trait', 'greed');
      await selectWithKeys(page, 'customization-value', '-3');
      const base = view.base_traits.find(entry => entry.carry_over === 'piety')!.traits;
      const rebuiltPrice = view.slots.find(slot => slot.slot === 'rebuilt_body')!.price;
      await verifyTraitPreview(page, base, { greed: -3 }, rebuiltPrice);
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
      await verifyTraitPreview(page, base, { greed: Math.min(3, base.greed + 1), loyalty: Math.max(-3, base.loyalty - 1) }, rebuiltPrice);
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
        await verifyPreview(page.getByTestId(`option-preview-${option.id}`), option.preview, before.ui.world!);
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
      await tabTo(page, page.getByTestId('scene-skip'));
      await page.keyboard.press('Enter'); await page.keyboard.press('Space');
      expect((await replayRead(page)).bytes).toBe(beforeSkip.bytes);
      expect(await worldRead(page)).toEqual(choice);
      await expect(page.getByTestId('checksum')).toHaveText(beforeSkip.replay.checksums.at(-1)!);
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
      await disclosureWithKeys(page, 'bribe-section', true);
      expect((await replayRead(page)).bytes).toBe(beforeBribe.bytes);
      await tabTo(page, page.getByTestId('bribe-amount')); await page.keyboard.press('Control+A'); await page.keyboard.type('0');
      await tabTo(page, page.getByTestId('bribe-send')); await page.keyboard.press('Enter');
      await expect(page.getByTestId('error')).toHaveAttribute('data-error-kind', 'rejected');
      await disclosureWithKeys(page, 'technical-details', true);
      await expect(page.getByTestId('technical-details')).toContainText('bad_amount');
      const bribeProbe = await probeRead(page);
      const request = bribeProbe.sent.filter(message => message.type === 'bribe').at(-1);
      expect(request).toMatchObject({ type: 'bribe', amount: '0' });
      const reply = bribeProbe.received.find(message => message.type === 'reply' && message.id === request!.id);
      expect(reply).toMatchObject({ type: 'reply', ok: false, kind: 'rejected', error: 'bad_amount' });
      if (reply?.type !== 'reply') throw Error('The rejected Bribe reply is missing');
      expect(reply.snapshot.tick).toBe(waiting.tick);
      expect(reply.snapshot.checksum).toBe(beforeBribe.replay.checksums.at(-1));
      const receipt = page.getByTestId('operation-receipt').and(page.locator(`[data-kind="bribe"][data-request="${request!.id}"]`));
      await expect(receipt).toBeVisible();
      await expect(receipt).toHaveAttribute('data-phase', 'refused');
      await expect(receipt).toHaveAttribute('data-world', String(reply.snapshot.worldId));
      await expect(receipt).toHaveAttribute('data-inputs', '');
      expect((await replayRead(page)).bytes).toBe(beforeBribe.bytes);
      expect((await worldRead(page)).tick).toBe(waiting.tick);
      await expect(page.getByTestId('checksum')).toHaveText(beforeBribe.replay.checksums.at(-1)!);
      await noOverflow(page);
      await capture(page, info, `${viewport.width}-live-bribe-rejection`, { layer: 'ACTUAL-WORKER-WASM-UI', world: await worldRead(page), scenario: waitingScenario, probe: await probeRead(page), interaction: 'Real keyboard canonical zero submission reaches core bad_amount; no sequence, Run or Step' });
      finish();
    });
  });
}
