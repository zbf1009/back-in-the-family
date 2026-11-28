/// <reference lib="dom" />
// Actual production App/SimClient/LifeSurface with deterministic local transport.
// Recorded native facts qualify input; these tests are NOT live Worker or AI proof.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { renderObituaryTemplate } from '../../src/main/obituary-template.ts';
import { TECHNICAL_TEXT } from '../../src/main/technical-text.ts';
import { OBITUARY_MODEL, OBITUARY_PROMPT_SHA256, OBITUARY_PROMPT_VERSION, parseObituarySidecar } from '../../src/shared/obituary.ts';
import { act, create, deliverDream, download, downloadArchivePair, downloadButton, latestRequest, openApp, posts, readFixture, records, releaseExport, resolve, resolveCapability, revealTechnical, terminal, waitForOperationDigest } from './obituary-fixture.ts';
import type { StoryBatch } from '../../src/shared/story.ts';
import type { LifeNotebookExport } from '../../src/main/life-journal.ts';

const nativeFacts: { openingBatch: StoryBatch; observedBatches: { story: StoryBatch }[];
  continuation: { afterDeath: { story: StoryBatch }[] } } = JSON.parse(readFileSync(new URL('../fixtures/obituary-native.json', import.meta.url), 'utf8'));

declare const window: Window & { __obituaryFixture: { reply(id: number): void; oldStatus(worldId: number): void } };
interface PreparedCapabilityHarness { prepareCapability(kind?: string, dailyRemaining?: number, index?: number): void }
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
const errors = new WeakMap<object, string[]>();
test.beforeEach(({ page }) => {
  const values: string[] = [];
  errors.set(page, values);
  page.on('pageerror', error => values.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });
async function historicalObituary(page: Page) {
  await expect(page.locator('.reading-lane > [data-testid="obituary"]')).toHaveCount(0);
  const card = page.getByTestId('obituary');
  const older = page.locator('.history-range').getByRole('button', { name: TECHNICAL_TEXT.journalEarlier, exact: true });
  for (let count = 0; await card.count() === 0 && count < 30; count++) {
    await expect(older).toBeEnabled(); await older.press('Enter');
  }
  await expect(card).toHaveCount(1);
  await expect(card.locator('xpath=parent::li').locator(':scope > .phase-heading')).toHaveText('Your life as Nadine Bradley');
  return card;
}

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
  const card = await historicalObituary(page);
  expect(await card.locator('p').textContent()).toBe(record.result!.text);
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

test('archive delivers matching raw replay and sidecar from one reply after a prior export and actual native continuation', async ({ page }, info) => {
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
  // This advances the same native run through its recorded Dream/Claim batches;
  // the transport is controlled, not a live simulation or provider assertion.
  await act(page, 'rebirth');
  const beforePair = await readFixture(page);
  const { replay, archive } = await downloadArchivePair(page);
  const afterPair = await readFixture(page);
  expect(afterPair.sent.filter(value => value.type === 'export-replay').length
    - beforePair.sent.filter(value => value.type === 'export-replay').length).toBe(1);
  expect(afterPair.exportReplies.length - beforePair.exportReplies.length).toBe(1);
  expect(afterPair.exportReplies.at(-1)?.replay).toBe(replay.bytes.toString('utf8'));
  expect(replay.filename).toBe('world-1.replay.json');
  expect(archive.filename).toBe('world-1.obituaries.json');
  expect(replay.bytes.toString('utf8')).toBe(beforePair.replayBytes);
  expect(replay.bytes.equals(original.bytes)).toBe(false);
  expect(JSON.parse(replay.bytes.toString('utf8')).ticks).toBe('5376');
  const digest = createHash('sha256').update(replay.bytes).digest('hex');
  const originalDigest = createHash('sha256').update(original.bytes).digest('hex');
  expect(digest).not.toBe(originalDigest);
  const sidecar = parseObituarySidecar(JSON.parse(archive.bytes.toString('utf8')), digest);
  expect(parseObituarySidecar(JSON.parse(archive.bytes.toString('utf8')), originalDigest)).toBeNull();
  expect(sidecar).not.toBeNull();
  expect(sidecar?.replaySha256).toBe(digest);
  const { ready: _ready, ...archived } = record;
  expect(sidecar?.records).toEqual([archived]);
  expect(record.operationKey).toBe(createHash('sha256').update(`${record.runId}\0${record.death.eventId}`, 'utf8').digest('hex'));
  // Independent digesting must reject even whitespace-only original-byte changes.
  expect(parseObituarySidecar(sidecar, createHash('sha256').update(Buffer.concat([replay.bytes, Buffer.from(' ')] )).digest('hex'))).toBeNull();
  const again = await download(page, 'Export replay');
  expect(again.bytes.equals(replay.bytes)).toBe(true);
  await info.attach('original-replay', { body: original.bytes, contentType: 'application/json' });
  await info.attach('paired-replay', { body: replay.bytes, contentType: 'application/json' });
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
      await historicalObituary(page);
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
      await expect(page.locator('.reading-lane > [data-testid="obituary"]')).toHaveCount(0);
      await resolve(page); await terminal(page, 'model');
    }
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-identity', sceneIdentity!);
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-category', 'rebirth');
    await expect(page.getByTestId('life-name')).toContainText('Edmund Rowe');
    const card = await historicalObituary(page);
    expect(await card.locator('p').textContent()).toBe((await readFixture(page)).acceptedText);
    const { archive, replay } = await downloadArchivePair(page);
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

test('an enabled archive click crossing a complete own Death keeps its diagnostic but becomes retryable after the original model terminal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'hold-export-replies=1', true); await create(page);
  const button = await downloadButton(page, TECHNICAL_TEXT.obituaryExport);
  await expect(button).toBeEnabled();
  const downloaded: string[] = [];
  page.on('download', file => downloaded.push(file.suggestedFilename()));
  await button.click();
  const exportRequest = await latestRequest(page, 'export-replay');
  expect((await readFixture(page)).exportReplies).toEqual([]);
  await act(page, 'death');
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  await expect(button).toBeDisabled();
  const pending = (await records(page))[0]!;
  expect(pending.attempt).toBe('pending');
  await releaseExport(page, exportRequest.id);
  await expect(page.getByTestId('obituary-export-error')).toContainText('pending obituary');
  expect(downloaded).toEqual([]);
  const failedReply = (await readFixture(page)).exportReplies[0]!;
  expect(failedReply.id).toBe(exportRequest.id);
  expect(BigInt(JSON.parse(failedReply.replay).ticks)).toBeGreaterThan(BigInt(pending.death.tick));
  const beforeRetryPosts = (await posts(page)).length;
  await resolve(page);
  const record = await terminal(page, 'model');
  await expect(button).toBeEnabled();
  await expect(page.getByTestId('obituary-export-error')).toContainText('pending obituary');
  const { archive, replay } = await downloadArchivePair(page);
  expect(downloaded).toEqual(['world-1.replay.json', 'world-1.obituaries.json']);
  const sidecar = parseObituarySidecar(JSON.parse(archive.bytes.toString('utf8')), createHash('sha256').update(replay.bytes).digest('hex'));
  expect(sidecar?.records[0]?.result).toEqual(record.result);
  expect(record.runId).toBe(pending.runId);
  expect(record.death).toEqual(pending.death);
  expect(sidecar?.records[0]?.operationKey).toBe(record.operationKey);
  expect((await posts(page))[0]?.operationKey).toBe(record.operationKey);
  expect((await posts(page)).length).toBe(beforeRetryPosts);
  await expect(page.getByTestId('obituary-export-error')).toHaveCount(0);
});

for (const outcome of ['eligible before deadline', 'POST exceeds shared deadline', 'late after deadline', 'failed initial GET'] as const) {
  test(`complete Death shares the pending initial capability GET: ${outcome}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, 'capability=deferred', true); await create(page); await act(page, 'death');
    await expect.poll(async () => (await records(page))[0]?.attempt).toBe('pending');
    await waitForOperationDigest(page);
    const pending = (await records(page))[0]!;
    expect(pending).toMatchObject({ attempt: 'pending', result: null });
    const expectedKey = createHash('sha256').update(`${pending.runId}\0${pending.death.eventId}`, 'utf8').digest('hex');
    expect(await posts(page)).toEqual([]);
    expect((await readFixture(page)).http.filter(value => value.path === '/api/judge/obituary/config')).toHaveLength(1);
    expect((await readFixture(page)).capabilityReplies).toEqual([]);
    await expect(page.getByTestId('obituary')).toHaveCount(0);
    await expect((await downloadButton(page, TECHNICAL_TEXT.obituaryExport))).toBeDisabled();
    if (outcome === 'eligible before deadline' || outcome === 'POST exceeds shared deadline') {
      await page.clock.runFor(8000);
      expect((await records(page))[0]?.attempt).toBe('pending');
      expect(await posts(page)).toEqual([]);
      await resolveCapability(page);
      await expect.poll(async () => (await posts(page)).length).toBe(1);
      expect((await posts(page))[0]?.operationKey).toBe(expectedKey);
      if (outcome === 'POST exceeds shared deadline') {
        await page.clock.runFor(2001);
        const record = await terminal(page, 'template');
        expect(record.result?.fallbackReason).toBe('timeout');
        expect(record.result?.model).toBe(OBITUARY_MODEL);
        expect(record.result?.text).toBe(renderObituaryTemplate(record.facts));
        await resolve(page); await act(page, 'redeliver'); await page.clock.runFor(10001);
        expect(await records(page)).toEqual([record]);
        expect((await posts(page)).length).toBe(1);
        await expect(page.getByTestId('obituary').locator('p')).toHaveText(record.result!.text);
      } else {
        await resolve(page);
        await terminal(page, 'model');
        await expect(page.getByTestId('obituary')).toHaveCount(1);
      }
    } else {
      if (outcome === 'late after deadline') await page.clock.runFor(10001);
      else await resolveCapability(page, 'failed');
      const record = await terminal(page, 'template');
      expect(record.result?.fallbackReason).toBe(outcome === 'late after deadline' ? 'timeout' : 'capability_unavailable');
      expect(record.result?.model).toBeNull();
      expect(record.result?.text).toBe(renderObituaryTemplate(record.facts));
      if (outcome === 'late after deadline') await resolveCapability(page);
      await act(page, 'redeliver'); await page.clock.runFor(10001);
      expect(await records(page)).toEqual([record]);
      expect(await posts(page)).toEqual([]);
      await expect(page.getByTestId('obituary').locator('p')).toHaveText(record.result!.text);
    }
    const evidence = await readFixture(page);
    expect(evidence.http.filter(value => value.path === '/api/judge/obituary/config')).toHaveLength(1);
    expect(evidence.capabilityReplies).toHaveLength(1);
  });
}

for (const outcome of ['fresh refresh within original deadline', 'refresh stalls past original deadline', 'initial reply arrives after original deadline'] as const) {
  test(`in-flight old-day exhausted quota is refreshed in the same Death attempt: ${outcome}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, 'capability=deferred', new Date('2026-11-27T23:59:58Z'));
    await page.clock.setSystemTime(new Date('2026-11-27T23:59:58Z'));
    await create(page);
    // Generate the actual Response before midnight, but leave its GET pending.
    // Delivery below must not regenerate quota using the later arrival clock.
    await page.evaluate(() => (window.__obituaryFixture as unknown as PreparedCapabilityHarness).prepareCapability());
    const oldDay = await readFixture(page);
    expect(await page.evaluate(() => Date.now())).toBe(Date.parse('2026-11-27T23:59:58Z'));
    expect(oldDay.capabilityReplies).toHaveLength(1);
    expect(oldDay.capabilityReplies[0]).toMatchObject({ status: 200, quota: {
      utc_day: '2026-11-27', reset_at_ms: Date.parse('2026-11-28T00:00:00Z'), daily_remaining: 0, session_remaining: 10,
    } });
    expect(await records(page)).toEqual([]);
    await page.clock.setSystemTime(new Date('2026-11-28T00:00:01Z'));
    expect((await readFixture(page)).http).toEqual(oldDay.http);
    expect((await readFixture(page)).snapshot).toEqual(oldDay.snapshot);
    await act(page, 'death');
    await expect.poll(async () => (await records(page))[0]?.attempt).toBe('pending');
    // Native crypto resolves before the continuation installs the original 10s
    // timer. Do not wait for the technical DOM's non-reactive pending key.
    await waitForOperationDigest(page);
    await page.evaluate(() => Promise.resolve());
    const pending = (await records(page))[0]!;
    expect(await records(page)).toHaveLength(1);
    expect(pending).toMatchObject({ attempt: 'pending', result: null, death: {
      eventId: oldDay.death.event, personId: oldDay.death.body, tick: oldDay.death.tick,
    } });
    const expectedKey = createHash('sha256').update(`${pending.runId}\0${pending.death.eventId}`, 'utf8').digest('hex');
    expect(await posts(page)).toEqual([]);
    expect((await readFixture(page)).http.map(value => [value.method, value.path])).toEqual([['GET', '/api/judge/obituary/config']]);

    if (outcome === 'initial reply arrives after original deadline') {
      await page.clock.runFor(9999);
      expect((await records(page))[0]?.attempt).toBe('pending');
      await page.clock.runFor(2);
    } else {
      await page.clock.runFor(8000);
      expect((await records(page))[0]).toMatchObject({ runId: pending.runId, death: pending.death, facts: pending.facts, attempt: 'pending', result: null });
      expect(await posts(page)).toEqual([]);
      await resolveCapability(page);
      await expect.poll(async () => (await readFixture(page)).http.filter(value => value.path === '/api/judge/obituary/config').length).toBe(2);
      // The exhausted old body must not terminalize or replace the original entry.
      expect(await records(page)).toHaveLength(1);
      expect((await records(page))[0]).toMatchObject({ runId: pending.runId, death: pending.death, facts: pending.facts, attempt: 'pending', result: null });
      expect((await readFixture(page)).capabilityReplies).toEqual(oldDay.capabilityReplies);
      expect(await posts(page)).toEqual([]);
      if (outcome === 'fresh refresh within original deadline') {
        await resolveCapability(page, 'enabled', 1);
        await expect.poll(async () => (await posts(page)).length).toBe(1);
        expect((await posts(page))[0]).toMatchObject({ operationKey: expectedKey, facts: pending.facts });
        await resolve(page);
      } else {
        await page.clock.runFor(1999);
        expect((await records(page))[0]?.attempt).toBe('pending');
        await page.clock.runFor(2);
      }
    }
    const successful = outcome === 'fresh refresh within original deadline';
    const record = await terminal(page, successful ? 'model' : 'template');
    expect(record).toMatchObject({ runId: pending.runId, death: pending.death, facts: pending.facts, operationKey: expectedKey });
    expect(record.result).toMatchObject({ model: successful ? OBITUARY_MODEL : null, fallbackReason: successful ? null : 'timeout',
      text: successful ? oldDay.acceptedText : renderObituaryTemplate(pending.facts) });
    if (!successful) await resolveCapability(page, 'enabled', outcome === 'initial reply arrives after original deadline' ? 0 : 1);
    await act(page, 'redeliver'); await page.clock.runFor(10001);
    expect(await records(page)).toEqual([record]);
    expect(await posts(page)).toHaveLength(successful ? 1 : 0);
    const settled = await readFixture(page);
    expect(settled.sent.filter(value => value.type === 'create-world')).toHaveLength(1);
    expect(settled.http.map(value => [value.method, value.path])).toEqual(outcome === 'initial reply arrives after original deadline'
      ? [['GET', '/api/judge/obituary/config']]
      : [['GET', '/api/judge/obituary/config'], ['GET', '/api/judge/obituary/config'], ...(successful ? [['POST', '/api/obituary']] : [])]);
    expect(settled.capabilityReplies[0]).toEqual(oldDay.capabilityReplies[0]);
    expect(settled.capabilityReplies).toHaveLength(outcome === 'initial reply arrives after original deadline' ? 1 : 2);
    if (outcome !== 'initial reply arrives after original deadline') expect(settled.capabilityReplies[1]).toMatchObject({ status: 200, quota: {
      utc_day: '2026-11-28', reset_at_ms: Date.parse('2026-11-29T00:00:00Z'), daily_remaining: 40,
      session_remaining: oldDay.capabilityReplies[0]!.quota!.session_remaining,
    } });
    await expect(page.getByTestId('obituary').locator('p')).toHaveText(record.result!.text);
  });
}

test('only a new Death refreshes expired daily quota after UTC reset without replacing the App session', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // This wall-clock interval remains inside one session lifetime; no sim steps,
  // polling request, session creation, or counter mutation advances the quota day.
  await openApp(page, 'capability=quota-reset', new Date('2026-11-27T23:59:58Z'));
  await create(page); await act(page, 'death');
  const first = await terminal(page, 'template');
  expect(first.result?.fallbackReason).toBe('quota_exhausted');
  expect(first.result?.model).toBeNull();
  expect(first.result?.text).toBe(renderObituaryTemplate(first.facts));
  expect(await posts(page)).toEqual([]);
  const beforeReset = await readFixture(page);
  expect(beforeReset.capabilityReplies).toHaveLength(1);
  expect(beforeReset.capabilityReplies[0]?.quota).toMatchObject({ utc_day: '2026-11-27', daily_remaining: 0, session_remaining: 8 });
  const firstArchive = await downloadArchivePair(page);
  const archivedFirst = parseObituarySidecar(JSON.parse(firstArchive.archive.bytes.toString('utf8')),
    createHash('sha256').update(firstArchive.replay.bytes).digest('hex'));
  expect(archivedFirst?.records[0]?.result).toEqual(first.result);
  await page.clock.setSystemTime(new Date('2026-11-28T00:00:01Z'));
  const afterClock = await readFixture(page);
  expect(afterClock.snapshot.tick).toBe(beforeReset.snapshot.tick);
  expect(afterClock.http).toEqual(beforeReset.http);
  await create(page);
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '2');
  const afterCreate = await readFixture(page);
  expect(afterCreate.http).toEqual(beforeReset.http);
  expect(await records(page)).toEqual([]);
  // The second source-qualified run repeats the actual native Death, not a
  // fabricated body, family, ID, or new judge session.
  await act(page, 'death');
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  const second = (await records(page))[0]!;
  expect(second.runId).not.toBe(first.runId);
  expect(second.death.eventId).toBe(first.death.eventId);
  expect(second.facts).toEqual(first.facts);
  await resolve(page);
  const secondTerminal = await terminal(page, 'model');
  expect(secondTerminal.runId).toBe(second.runId);
  expect(secondTerminal.death).toEqual(second.death);
  expect((await posts(page))[0]?.operationKey).toBe(secondTerminal.operationKey);
  expect((await posts(page))[0]?.operationKey).not.toBe(first.operationKey);
  await act(page, 'redeliver');
  const afterSecond = await readFixture(page);
  expect(afterSecond.http.filter(value => value.path === '/api/judge/obituary/config')).toHaveLength(2);
  expect(afterSecond.capabilityReplies).toHaveLength(2);
  expect(afterSecond.capabilityReplies[1]?.quota).toMatchObject({ utc_day: '2026-11-28', daily_remaining: 40, session_remaining: 8 });
  expect(afterSecond.http.map(value => [value.method, value.path])).toEqual([
    ['GET', '/api/judge/obituary/config'], ['GET', '/api/judge/obituary/config'], ['POST', '/api/obituary'],
  ]);
  expect((await posts(page)).length).toBe(1);
  await expect(page.getByTestId('obituary').locator('p')).toHaveText(afterSecond.acceptedText);
});

for (const timing of ['before Dream', 'after Dream'] as const) {
  test(`actual Dream-only continuation moves Nadine's obituary into her original history when the model ends ${timing}`, async ({ page }) => {
    await openApp(page, '', true); await create(page); await act(page, 'death');
    await expect.poll(async () => (await posts(page)).length).toBe(1);
    await page.getByTestId('scene-skip').press('Enter');
    const admitted = (await records(page))[0]!;
    const before = await readFixture(page);
    expect(before.world.player.place).toBe('waiting');
    expect(before.world.player_wait?.ghost).toBe(10);
    if (timing === 'before Dream') {
      await resolve(page); await terminal(page, 'model');
      await expect(page.locator('.reading-lane > [data-testid="obituary"]')).toHaveCount(1);
    }
    await deliverDream(page);
    if (await page.getByTestId('key-scene').getAttribute('data-category') === 'death') {
      await page.getByTestId('scene-close').press('Enter');
    }
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-category', 'dream');
    await expect(page.getByTestId('key-scene')).toContainText('A dream, delivered');
    const identity = await page.getByTestId('key-scene').getAttribute('data-identity');
    const dreamEvidence = await readFixture(page);
    expect(dreamEvidence.source.dream.deathChecksum).toBe(before.source.checksum);
    expect(dreamEvidence.source.dream.inputs).toHaveLength(4);
    expect(dreamEvidence.snapshot.tick).toBe('5375');
    expect(dreamEvidence.world.player.place).toBe(before.world.player.place);
    expect(dreamEvidence.world.player_wait?.ghost).toBe(before.world.player_wait?.ghost);
    expect(dreamEvidence.world.player_wait?.claim).toBeNull();
    expect(dreamEvidence.world.last_dream).toMatchObject({ dreamer: 39, applied: 'take_comfort' });
    expect(dreamEvidence.sent.filter(value => value.type === 'claim' || value.type === 'carry-over')).toEqual([]);
    await expect(page.getByTestId('life-name')).toContainText('Nadine Bradley');
    await expect(page.locator('.reading-lane > [data-testid="obituary"]')).toHaveCount(0);
    await expect(page.getByTestId('run')).toBeEnabled();
    await expect(page.getByTestId('speed')).toBeEnabled();
    await expect(page.getByTestId('dream-send')).toBeEnabled();
    if (timing === 'after Dream') {
      await resolve(page); await terminal(page, 'model');
    }
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-identity', identity!);
    await expect(page.getByTestId('key-scene')).toHaveAttribute('data-category', 'dream');
    await expect(page.getByTestId('run')).toBeEnabled();
    await expect(page.getByTestId('speed')).toBeEnabled();
    await expect(page.getByTestId('dream-send')).toBeEnabled();
    const card = await historicalObituary(page);
    await expect(card.locator('p')).toHaveText(dreamEvidence.acceptedText);
    expect((await records(page))[0]?.death).toEqual(admitted.death);
    expect((await posts(page)).length).toBe(1);
    const facts: LifeNotebookExport = JSON.parse((await download(page, 'Download life facts')).bytes.toString('utf8'));
    expect(facts.events['2374']?.kind).toEqual({ type: 'dream', ghost: 10, dreamer: 39, price: '20' });
    expect(facts.events['2376']).toBeUndefined();
    expect(facts.dreams['2374']).toMatchObject({ ghost: 10, dreamer: 39, intent: 'reassure', inputSeq: '3' });
    expect(facts.ownDeathSummaries['2368']?.livingGrandchildren.map(person => person.name)).toEqual(['Ben Rhodes', 'Leo Rhodes']);
  });
}
