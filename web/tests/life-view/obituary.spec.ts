/// <reference lib="dom" />
// Actual production App/SimClient/LifeSurface with deterministic local transport.
// Recorded native facts qualify input; these tests are NOT live Worker or AI proof.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { renderObituaryTemplate } from '../../src/main/obituary-template.ts';
import { TECHNICAL_TEXT } from '../../src/main/technical-text.ts';
import { OBITUARY_MODEL, OBITUARY_PROMPT_SHA256, OBITUARY_PROMPT_VERSION, parseObituarySidecar } from '../../src/shared/obituary.ts';
import { act, create, download, latestRequest, openApp, posts, readFixture, records, resolve, revealTechnical, terminal } from './obituary-fixture.ts';
import type { StoryBatch } from '../../src/shared/story.ts';
import type { LifeNotebookExport } from '../../src/main/life-journal.ts';

const nativeFacts: { openingBatch: StoryBatch; observedBatches: { story: StoryBatch }[];
  continuation: { afterDeath: { story: StoryBatch }[] } } = JSON.parse(readFileSync(new URL('../fixtures/obituary-native.json', import.meta.url), 'utf8'));

declare const window: Window & { __obituaryFixture: { reply(id: number): void; oldStatus(worldId: number): void } };
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
const errors = new WeakMap<object, string[]>();
test.beforeEach(({ page }) => {
  const values: string[] = [];
  errors.set(page, values);
  page.on('pageerror', error => values.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('only a complete own Death attempts narration; summary-first and lifecycle-later correlate once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page); await create(page);
  // Setup contains real nonplayer Deaths, including Clifford, and the whole
  // earlier story/Chronicle. None may acquire a player obituary attempt.
  expect(await posts(page)).toEqual([]);
  expect(await records(page)).toEqual([]);
  await act(page, 'summaryFirst');
  expect(await posts(page)).toEqual([]);
  expect(await records(page)).toEqual([]);
  await act(page, 'lifecycleAfterSummary');
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  await act(page, 'lifecycleAfterSummary'); await act(page, 'redeliver');
  expect((await posts(page)).length).toBe(1);
  expect((await records(page)).length).toBe(1);
  const request = (await posts(page))[0]!;
  expect(request.facts.survivors.map(person => person.fullName)).toEqual(['Marvin Jenkins', 'Marcus Bradley', 'Ben Rhodes', 'Leo Rhodes']);
  expect(request.facts.precededInDeath.map(person => person.fullName)).toEqual(['Clifford Bradley']);
  await resolve(page);
  await terminal(page, 'model');
  await expect(page.getByTestId('obituary')).toHaveCount(1);
});

test('missing complete summary is an explicit integration defect, never a familyless obituary', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page); await create(page); await act(page, 'death', false);
  await revealTechnical(page);
  await expect(page.getByTestId('obituary-error')).toContainText(/summary/i);
  expect(await records(page)).toEqual([]);
  expect(await posts(page)).toEqual([]);
  await expect(page.getByTestId('obituary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: TECHNICAL_TEXT.obituaryExport, exact: true })).toBeDisabled();
  const replay = await download(page, 'Export replay');
  expect(replay.bytes.toString('utf8')).toBe((await readFixture(page)).replayBytes);
  // A subsequently completed native observation repairs the transport defect.
  await act(page, 'redeliver');
  await expect.poll(async () => (await posts(page)).length).toBe(1);
});

for (const settlement of ['natural finish', 'Skip', 'reduced motion'] as const) {
  test(`terminal-before-settlement remains invisible until ${settlement}`, async ({ page }, info) => {
    await openApp(page, '', true); await create(page); await act(page, 'death');
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-category', 'death');
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-beat', 'establish');
    await expect.poll(async () => (await posts(page)).length).toBe(1);
    await resolve(page);
    const record = await terminal(page, 'model');
    expect(record.ready).toBe(false);
    await expect(page.getByTestId('obituary')).toHaveCount(0);
    if (settlement === 'natural finish') await page.clock.runFor(7001);
    else if (settlement === 'Skip') await page.getByTestId('scene-skip').press('Enter');
    else await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByTestId('obituary')).toHaveCount(1);
    expect(await page.getByTestId('obituary').locator('p').textContent()).toBe(record.result!.text);
    expect((await records(page))[0]?.ready).toBe(true);
    await act(page, 'redeliver');
    await expect(page.getByTestId('obituary')).toHaveCount(1);
    expect((await posts(page)).length).toBe(1);
    if (settlement === 'Skip') await page.screenshot({ path: info.outputPath('obituary-production-app-settled.png'), fullPage: true });
  });
}

test('terminal-after-settlement appears once and preserves original guarded Close and legal inputs', async ({ page }) => {
  await openApp(page, '', true); await create(page); await act(page, 'death');
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  await page.getByTestId('scene-skip').press('Enter');
  expect((await records(page))[0]?.ready).toBe(true);
  await expect(page.getByTestId('obituary')).toHaveCount(0);
  const before = await readFixture(page);
  await page.getByTestId('scene-close').dispatchEvent('click', { detail: 2 });
  await expect(page.getByTestId('key-scene')).toHaveCount(1);
  await page.getByTestId('scene-close').press('Enter');
  await expect(page.getByTestId('key-scene')).toHaveCount(0);
  expect((await readFixture(page)).sent).toEqual(before.sent);
  await revealTechnical(page);
  await expect(page.getByRole('button', { name: TECHNICAL_TEXT.obituaryExport, exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export replay', exact: true })).toBeEnabled();
  await expect(page.getByTestId('run')).toBeEnabled();
  await expect(page.getByTestId('speed')).toBeEnabled();
  const replayWhilePending = await download(page, 'Export replay');
  expect(replayWhilePending.bytes.toString('utf8')).toBe((await readFixture(page)).replayBytes);
  expect((await records(page))[0]?.attempt).toBe('pending');
  await page.getByTestId('bribe-section').locator(':scope > summary').press('Enter');
  await page.getByTestId('bribe-amount').fill('1');
  await expect(page.getByTestId('bribe-send')).toBeEnabled();
  await page.getByTestId('bribe-send').press('Enter');
  const bribe = await latestRequest(page, 'bribe');
  expect(bribe).toMatchObject({ type: 'bribe', amount: '1' });
  await page.evaluate(id => window.__obituaryFixture.reply(id), bribe.id);
  expect((await posts(page)).length).toBe(1);
  await resolve(page);
  const record = await terminal(page, 'model');
  await expect(page.getByTestId('obituary')).toHaveCount(1);
  expect(await page.getByTestId('obituary').locator('p').textContent()).toBe(record.result!.text);
  await expect(page.getByRole('button', { name: TECHNICAL_TEXT.obituaryExport, exact: true })).toBeEnabled();
});

test('public capability 404 uses the local template with zero POSTs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'capability=public'); await create(page); await act(page, 'death');
  const record = await terminal(page, 'template');
  expect(record.result?.fallbackReason).toBe('public');
  expect(record.result?.model).toBeNull();
  expect(record.result?.text).toBe(renderObituaryTemplate(record.facts));
  await expect(page.getByTestId('obituary')).toHaveCount(1);
  expect(await posts(page)).toEqual([]);
});

test('eligible local judge transport accepts one verbatim 40–110-word paragraph and binds sidecar to original download bytes', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page); await create(page); await act(page, 'death');
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  await resolve(page);
  const record = await terminal(page, 'model');
  const fixture = await readFixture(page);
  const words = fixture.acceptedText.split(/\s+/u).length;
  expect(words).toBeGreaterThanOrEqual(40); expect(words).toBeLessThanOrEqual(110);
  expect(record.result).toEqual({ text: fixture.acceptedText, source: 'model', fallbackReason: null,
    model: OBITUARY_MODEL, promptVersion: OBITUARY_PROMPT_VERSION, promptSha256: OBITUARY_PROMPT_SHA256 });
  await expect(page.getByTestId('obituary')).toHaveCount(1);
  expect(await page.getByTestId('obituary').locator('p').textContent()).toBe(fixture.acceptedText);
  await act(page, 'redeliver');
  expect((await posts(page)).length).toBe(1);
  const original = await download(page, 'Export replay');
  expect(original.filename).toBe('world-1.replay.json');
  expect(original.bytes.toString('utf8')).toBe(fixture.replayBytes);
  const archive = await download(page, TECHNICAL_TEXT.obituaryExport);
  expect(archive.filename).toBe('world-1.obituaries.json');
  const digest = createHash('sha256').update(original.bytes).digest('hex');
  const sidecar = parseObituarySidecar(JSON.parse(archive.bytes.toString('utf8')), digest);
  expect(sidecar).not.toBeNull();
  expect(sidecar?.replaySha256).toBe(digest);
  const { ready: _ready, ...archived } = record;
  expect(sidecar?.records).toEqual([archived]);
  expect(record.operationKey).toBe(createHash('sha256').update(`${record.runId}\0${record.death.eventId}`, 'utf8').digest('hex'));
  // Independent digesting must reject even whitespace-only original-byte changes.
  expect(parseObituarySidecar(sidecar, createHash('sha256').update(Buffer.concat([original.bytes, Buffer.from(' ')] )).digest('hex'))).toBeNull();
  const again = await download(page, 'Export replay');
  expect(again.bytes.equals(original.bytes)).toBe(true);
  await info.attach('original-replay', { body: original.bytes, contentType: 'application/json' });
  await info.attach('obituary-sidecar', { body: archive.bytes, contentType: 'application/json' });
});

for (const failure of ['timeout', 'invalid', 'provider-error'] as const) {
  test(`${failure} terminates in the exact local template without a late overwrite or retry`, async ({ page }) => {
    await openApp(page, '', true); await create(page); await act(page, 'death');
    await expect.poll(async () => (await posts(page)).length).toBe(1);
    await page.getByTestId('scene-skip').press('Enter');
    if (failure === 'timeout') await page.clock.runFor(10001);
    else await resolve(page, failure);
    const first = await terminal(page, 'template');
    expect(first.result?.fallbackReason).toBe(failure === 'invalid' ? 'invalid_output' : failure === 'provider-error' ? 'provider_error' : 'timeout');
    expect(first.result?.text).toBe(renderObituaryTemplate(first.facts));
    if (failure === 'timeout') await resolve(page);
    await act(page, 'redeliver'); await page.clock.runFor(10001);
    expect((await records(page))[0]).toEqual(first);
    expect((await posts(page)).length).toBe(1);
    expect(await page.getByTestId('obituary').locator('p').textContent()).toBe(first.result!.text);
    const archive = await download(page, TECHNICAL_TEXT.obituaryExport);
    expect(JSON.parse(archive.bytes.toString('utf8')).records[0].result).toEqual(first.result);
  });
}

test('failed Create preserves the pending run; successful Create isolates late old-World callbacks; refresh drops memory', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page); await create(page); await act(page, 'death');
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  const pending = (await records(page))[0]!;
  await create(page, false);
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '1');
  expect((await records(page))[0]?.runId).toBe(pending.runId);
  await resolve(page);
  const completed = await terminal(page, 'model');
  expect(completed.runId).toBe(pending.runId);
  await expect(page.getByTestId('obituary')).toHaveCount(1);
  await create(page);
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '2');
  expect(await records(page)).toEqual([]);
  await act(page, 'death');
  await expect.poll(async () => (await posts(page)).length).toBe(2);
  const oldPending = (await records(page))[0]!;
  await create(page);
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '3');
  await resolve(page, 'accepted', 1);
  await page.evaluate(() => window.__obituaryFixture.oldStatus(2));
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '3');
  await expect(page.getByTestId('life-name')).toContainText('Nadine Bradley');
  expect(await records(page)).toEqual([]);
  await expect(page.getByTestId('obituary')).toHaveCount(0);
  await act(page, 'death');
  await expect.poll(async () => (await posts(page)).length).toBe(3);
  expect((await records(page))[0]?.runId).not.toBe(oldPending.runId);
  await resolve(page, 'accepted', 2); await terminal(page, 'model');
  await page.reload();
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '0');
  await expect(page.getByTestId('life-surface')).toHaveCount(0);
  expect(await records(page)).toEqual([]);
  expect(await posts(page)).toEqual([]);
});

for (const timing of ['before rebirth', 'after rebirth'] as const) {
  test(`same-run actual native continuation retains Nadine historical life when narration ends ${timing}`, async ({ page }, info) => {
    await openApp(page, '', true); await create(page); await act(page, 'death');
    await expect.poll(async () => (await posts(page)).length).toBe(1);
    await page.getByTestId('scene-close').press('Enter');
    const admitted = (await records(page))[0]!;
    expect(admitted.death).toEqual({ eventId: '2368', personId: 10, tick: '5372', lifeKey: '1/life/10' });
    if (timing === 'before rebirth') {
      await resolve(page); await terminal(page, 'model');
      await expect(page.getByTestId('obituary')).toHaveCount(1);
    }
    await act(page, 'rebirth');
    await expect(page.getByTestId('life-name')).toContainText('Edmund Rowe');
    // The earlier Dream is a genuine same-run entry, not discarded to force
    // the later rebirth to the front of the presentation queue.
    for (let count = 0; await page.getByTestId('key-scene').getAttribute('data-category') !== 'rebirth' && count < 3; count++) {
      await page.getByTestId('scene-close').press('Enter');
    }
    const sceneIdentity = await page.getByTestId('key-scene').getAttribute('data-identity');
    await expect(page.getByTestId('key-scene')).toContainText('Edmund');
    if (timing === 'after rebirth') {
      await expect(page.getByTestId('obituary')).toHaveCount(0);
      await resolve(page); await terminal(page, 'model');
    }
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-identity', sceneIdentity!);
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-category', 'rebirth');
    await expect(page.getByTestId('life-name')).toContainText('Edmund Rowe');
    const card = page.getByTestId('obituary');
    // Use the production journal's real phase heading and range navigation.
    // A card detached under a second synthetic life title does not pass.
    const older = page.locator('.history-range').getByRole('button', { name: TECHNICAL_TEXT.journalEarlier, exact: true });
    for (let count = 0; await card.count() === 0 && count < 30; count++) {
      await expect(older).toBeEnabled(); await older.press('Enter');
    }
    await expect(card).toHaveCount(1);
    expect(await card.locator('p').textContent()).toBe((await readFixture(page)).acceptedText);
    await expect(card.locator('xpath=parent::li').locator(':scope > .phase-heading')).toHaveText('Your life as Nadine Bradley');
    const archive = await download(page, TECHNICAL_TEXT.obituaryExport);
    const replay = await download(page, 'Export replay');
    const sidecar = parseObituarySidecar(JSON.parse(archive.bytes.toString('utf8')), createHash('sha256').update(replay.bytes).digest('hex'));
    expect(sidecar?.records[0]?.death.lifeKey).toBe('1/life/10');
    expect(sidecar?.records[0]?.facts).toEqual(admitted.facts);
    expect(sidecar?.records[0]?.result.text).toBe((await readFixture(page)).acceptedText);
    const facts: LifeNotebookExport = JSON.parse((await download(page, 'Download life facts')).bytes.toString('utf8'));
    expect(facts.events['2368']!.kind).toEqual({ type: 'death', person: 10 });
    expect(facts.events['2376']!.kind).toEqual({ type: 'possession', person: 61, price: '100' });
    expect(facts.actors['61']!.name).toBe('Edmund Rowe');
    expect(facts.actors['10']!.name).toBe('Nadine Bradley');
    expect(facts.ownDeathSummaries['2368']!.livingGrandchildren.map(person => person.name)).toEqual(['Ben Rhodes', 'Leo Rhodes']);
    if (facts.cursors === null) throw Error('Actual native story export lost its complete cursors');
    expect(facts.cursors.events.end).toBe('2376');
    expect(facts.cursors.chronicle.end).toBe('7');
    const completeBatches = [nativeFacts.openingBatch, ...nativeFacts.observedBatches.map(value => value.story), ...nativeFacts.continuation.afterDeath.map(value => value.story)];
    expect(facts.events).toEqual(Object.fromEntries(completeBatches.flatMap(value => value.events.map(event => [event.id, event]))));
    expect(facts.chronicle).toEqual(Object.fromEntries(completeBatches.flatMap(value => value.chronicle.map(record => [record.index, record]))));
    expect(facts.dreams).toEqual(Object.fromEntries(completeBatches.flatMap(value => value.dreams.map(dream => [dream.eventId, dream]))));
    expect((await posts(page)).length).toBe(1);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`obituary-production-app-history-${timing.replaceAll(' ', '-')}.png`), fullPage: true });
  });
}
