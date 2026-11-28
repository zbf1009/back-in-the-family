/// <reference lib="dom" />
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import type { Request, Snapshot } from '../../src/shared/protocol.ts';
import type { ObituaryFactsV1, ObituaryRequestV1, ObituaryResultV1 } from '../../src/shared/obituary.ts';
import type { Quota } from '../../../worker-api/src/judge-contract.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { TECHNICAL_TEXT } from '../../src/main/technical-text.ts';

export const ORIGIN = process.env.LIFE_OBITUARY_COMPONENT_ORIGIN ?? 'http://localhost:5174';
export interface ObituaryRecord {
  runId: string; death: { eventId: string; personId: number; tick: string; lifeKey: string };
  operationKey: string | null; facts: ObituaryFactsV1; attempt: string; result: ObituaryResultV1 | null; ready: boolean;
}
export interface FixtureEvidence {
  source: { mode: string; checksum: string; qualification: string;
    dream: { qualification: string; inputs: unknown[]; deathChecksum: string } }; sent: Request[];
  http: { method: string; path: string; body: ObituaryRequestV1 | null }[]; snapshot: Snapshot; world: WorldSnapshot;
  death: { event: string; body: number; tick: string }; acceptedText: string; replayBytes: string;
  exportReplies: { id: number; replay: string; tick: string | null }[];
  capabilityReplies: { status: number; quota: Quota | null }[];
}
interface Harness {
  read(): FixtureEvidence;
  create(id: number, success?: boolean): void;
  death(withSummary?: boolean): void;
  redeliver(): void;
  rebirth(): void;
  summaryFirst(): void;
  lifecycleAfterSummary(): void;
  resolve(kind?: string, index?: number): void;
  resolveCapability(kind?: string, index?: number): void;
  waitForOperationDigest(): Promise<void>;
  releaseExport(id: number): void;
  dream(id: number): void;
  reply(id: number): void;
  oldStatus(worldId: number): void;
}
declare const window: Window & { __obituaryFixture: Harness };
// Structural access avoids loading the browser entry (and its App mount) in Node.
export async function readFixture(page: Page): Promise<FixtureEvidence> {
  return page.evaluate(() => window.__obituaryFixture.read());
}
export async function act(page: Page, action: 'death' | 'redeliver' | 'summaryFirst' | 'lifecycleAfterSummary' | 'rebirth', withSummary = true): Promise<void> {
  await page.evaluate(({ action, withSummary }) => {
    const fixture = window.__obituaryFixture;
    if (action === 'death') fixture.death(withSummary); else fixture[action]();
  }, { action, withSummary });
}
export async function openApp(page: Page, query = '', frozen: boolean | Date = false): Promise<void> {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN && !url.pathname.startsWith('/api/') || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    return route.abort('blockedbyclient');
  });
  if (frozen) {
    const time = frozen instanceof Date ? frozen : new Date('2026-11-27T12:00:00Z');
    await page.clock.install({ time });
    await page.clock.pauseAt(new Date(time.getTime() + 1000));
  }
  await page.goto(`${ORIGIN}/obituary-fixture.html${query ? `?${query}` : ''}`);
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-assets', 'ready');
  await expect.poll(async () => (await readFixture(page)).http.filter(value => value.path === '/api/judge/obituary/config').length).toBe(1);
  // Capability resolution is a real App effect, not an injected capability prop.
  await page.evaluate(() => Promise.resolve());
}
export async function latestRequest(page: Page, type: Request['type']): Promise<Request> {
  await expect.poll(async () => (await readFixture(page)).sent.filter(request => request.type === type).length).toBeGreaterThan(0);
  return (await readFixture(page)).sent.filter(request => request.type === type).at(-1)!;
}
export async function create(page: Page, success = true): Promise<void> {
  const setup = page.getByTestId('world-setup');
  if (await setup.count() && await setup.getAttribute('open') === null) await setup.locator(':scope > summary').press('Enter');
  await page.getByTestId('create').press('Enter');
  const request = await latestRequest(page, 'create-world');
  await page.evaluate(({ id, success }) => window.__obituaryFixture.create(id, success), { id: request.id, success });
  if (success) await expect(page.getByTestId('life-name')).toContainText('Nadine Bradley');
}
export async function resolve(page: Page, kind = 'accepted', index = 0): Promise<void> {
  await page.evaluate(({ kind, index }) => window.__obituaryFixture.resolve(kind, index), { kind, index });
}
export async function resolveCapability(page: Page, kind = 'enabled', index = 0): Promise<void> {
  await page.evaluate(({ kind, index }) => window.__obituaryFixture.resolveCapability(kind, index), { kind, index });
}
export async function waitForOperationDigest(page: Page): Promise<void> {
  await page.evaluate(() => window.__obituaryFixture.waitForOperationDigest());
}
export async function releaseExport(page: Page, id: number): Promise<void> {
  await page.evaluate(id => window.__obituaryFixture.releaseExport(id), id);
}
export async function deliverDream(page: Page): Promise<void> {
  const section = page.getByTestId('dream-section');
  if (await section.getAttribute('open') === null) await section.locator(':scope > summary').press('Enter');
  await page.getByTestId('dream-target-39').check();
  await page.getByTestId('dream-intent-reassure').press('Enter');
  await expect(page.getByTestId('dream-send')).toBeEnabled();
  await page.getByTestId('dream-send').click();
  const request = await latestRequest(page, 'dream');
  expect(request).toMatchObject({ type: 'dream', dreamer: 39, intent: 'reassure' });
  await page.evaluate(id => window.__obituaryFixture.dream(id), request.id);
}
export async function posts(page: Page): Promise<ObituaryRequestV1[]> {
  return (await readFixture(page)).http.filter(value => value.method === 'POST').map(value => value.body!);
}
export async function records(page: Page): Promise<ObituaryRecord[]> {
  const value = page.getByTestId('obituary-records');
  return await value.count() ? JSON.parse((await value.textContent())!) as ObituaryRecord[] : [];
}
export async function terminal(page: Page, source: 'model' | 'template'): Promise<ObituaryRecord> {
  await expect.poll(async () => (await records(page))[0]?.attempt).toBe('terminal');
  const record = (await records(page))[0]!;
  expect(record.result?.source).toBe(source);
  return record;
}
export async function revealTechnical(page: Page): Promise<void> {
  const details = page.getByTestId('technical-details');
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').press('Enter');
}
export interface DownloadedFile { filename: string; bytes: Buffer }
export async function downloadButton(page: Page, label: string): Promise<Locator> {
  await revealTechnical(page);
  // Closed disclosures hide roles from accessibility queries. Locate the real
  // button while hidden so its actual ancestor disclosures can be opened first.
  const button = page.getByRole('button', { name: label, exact: true, includeHidden: true });
  const ancestors = button.locator('xpath=ancestor::details');
  for (let index = 0; index < await ancestors.count(); index++) {
    const section = ancestors.nth(index);
    if (await section.getAttribute('open') === null) await section.locator(':scope > summary').press('Enter');
  }
  await expect(button).toBeVisible();
  return button;
}
async function downloadBytes(file: Download): Promise<DownloadedFile> {
  const stream = await file.createReadStream();
  if (stream === null) throw Error('Unreachable obituary download bytes');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { filename: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
}
// Both listeners exist before the one archive click: downloading replay again
// would acquire a different prefix and cannot prove the sidecar's byte binding.
export async function downloadArchivePair(page: Page): Promise<{ replay: DownloadedFile; archive: DownloadedFile }> {
  const button = await downloadButton(page, TECHNICAL_TEXT.obituaryExport);
  const files: Download[] = [];
  const collect = (file: Download) => { files.push(file); };
  page.on('download', collect);
  try {
    await button.press('Enter');
    await expect.poll(() => files.length).toBe(2);
    const pair = await Promise.all(files.map(downloadBytes));
    const replay = pair.find(file => file.filename.endsWith('.replay.json'));
    const archive = pair.find(file => file.filename.endsWith('.obituaries.json'));
    if (replay === undefined || archive === undefined) throw Error('Archive did not deliver one replay/sidecar pair');
    return { replay, archive };
  } finally { page.off('download', collect); }
}
export async function download(page: Page, label: string): Promise<DownloadedFile> {
  if (label === TECHNICAL_TEXT.obituaryExport) return (await downloadArchivePair(page)).archive;
  const button = await downloadButton(page, label);
  const event = page.waitForEvent('download');
  await button.press('Enter');
  return downloadBytes(await event);
}
export async function tabTo(page: Page, target: Locator): Promise<void> {
  const count = await page.locator('button,input,select,a[href],summary,[tabindex]').count();
  for (let step = 0; step < count * 2 + 4; step++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      await expect(target).toBeFocused();
      const focus = await target.evaluate(element => {
        const box = element.getBoundingClientRect();
        return { visible: element.matches(':focus-visible'), outline: parseFloat(getComputedStyle(element).outlineWidth),
          contained: box.x >= -1 && box.y >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
          unobscured: element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      });
      expect(focus).toMatchObject({ visible: true, contained: true, unobscured: true });
      expect(focus.outline).toBeGreaterThan(0);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw Error('Production obituary control is unreachable through the real Tab sequence');
}
