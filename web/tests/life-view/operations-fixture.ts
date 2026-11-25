/// <reference lib="dom" />
// Test-only native setup and read-only evidence, never component-prop injection.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { Reply, Request, RequestTicket, RequestWithoutId, WorkerMessage } from '../../src/shared/protocol.ts';
import type { PlayerFamily, PlayerOption, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { DECISION_CONFIG_VERSION } from '../../src/shared/decision.ts';

const DIRECTORY = new URL('../../../target/life-in-view-evidence/c4-scenarios/', import.meta.url);
const EVIDENCE = new URL('../../../target/life-in-view-evidence/', import.meta.url);
export interface Scenario {
  key: string; kind: string; replay: string; world: string; tick: string; seed: string; config: unknown; sha256: string;
  family?: PlayerFamily; optionLabels?: PlayerOption[]; slot?: string; path?: string; target?: number;
}
interface ClaimBaselineRecord {
  path: 'birth_slot' | 'imported_vessel'; sourceKey: string; sourceSha256: string; slot: string;
  replay: string; world: string; sha256: string; completedTick: string; body: number;
}
export interface Replay {
  version: number; seed: string; config: unknown; ticks: string; checksums: string[];
  inputs: { seq: string; tick: string; payload: Record<string, unknown> }[];
}
export interface Probe { sent: Request[]; received: WorkerMessage[]; recording: boolean; setup?: { scenario: string; replay: string; checksumsCompared: number; inputCount: number } }
declare const window: Window & typeof globalThis & {
  __simHarness?: { request(value: RequestWithoutId): RequestTicket };
  __c4Operations?: Probe;
};
export function scenarios(): Scenario[] {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIRECTORY), 'utf8')) as { version: number; missing: string[]; records: Scenario[] };
  if (manifest.version !== 1 || manifest.missing.length) throw Error(`Incomplete real scenario preparation: ${manifest.missing.join(', ')}`);
  return manifest.records;
}
/** Actual completed no-carry World, not Rebuilt_Body's preview projection. */
export function claimBaseline(scenario: Scenario): { body: WorldSnapshot['residents'][number]; provenance: ClaimBaselineRecord } {
  const manifest = JSON.parse(readFileSync(new URL('claim-expectations.json', DIRECTORY), 'utf8')) as {
    version: number; layer: string; records: ClaimBaselineRecord[];
  };
  if (manifest.version !== 1 || manifest.layer !== 'ACTUAL-WASM-RECORDED-NO-CARRY-CLAIM-BASELINES') throw Error('Actual claim baseline manifest is missing or invalid');
  const record = manifest.records.find(record => record.sourceKey === scenario.key);
  if (record === undefined || record.sourceSha256 !== scenario.sha256 || record.slot !== scenario.slot) throw Error('Actual claim baseline does not match this recorded prefix/slot');
  const bytes = readFileSync(new URL(record.replay, DIRECTORY), 'utf8');
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw Error('Actual completed claim baseline replay hash changed');
  const world = JSON.parse(readFileSync(new URL(record.world, DIRECTORY), 'utf8')) as WorldSnapshot;
  const body = world.residents.find(person => person.id === record.body);
  if (world.player.place !== 'body' || world.player.body !== record.body || body === undefined
    || body.origin !== (record.path === 'birth_slot' ? 'native' : 'possessed')) throw Error('Actual completed claim baseline body is invalid');
  return { body, provenance: record };
}
export async function workerRequest(page: Page, value: RequestWithoutId): Promise<Reply> {
  return page.evaluate(async value => {
    if (!window.__simHarness) throw Error('Actual page Worker harness is missing');
    return window.__simHarness.request(value).reply;
  }, value);
}
export async function worldRead(page: Page): Promise<WorldSnapshot> {
  const reply = await workerRequest(page, { type: 'world-snapshot' });
  if (!reply.ok || !reply.world) throw Error(`Actual World read failed: ${JSON.stringify(reply)}`);
  return reply.world;
}
export async function replayRead(page: Page): Promise<{ bytes: string; replay: Replay }> {
  const reply = await workerRequest(page, { type: 'export-replay' });
  if (!reply.ok || reply.replay === undefined) throw Error('Actual WASM export is missing');
  return { bytes: reply.replay, replay: JSON.parse(reply.replay) as Replay };
}
export async function probeRead(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    if (!window.__c4Operations) throw Error('Read-only Worker observer is missing');
    return window.__c4Operations;
  });
}
export async function disclosure(page: Page, id: string, open: boolean): Promise<void> {
  const element = page.getByTestId(id);
  if ((await element.getAttribute('open') !== null) !== open) await element.locator(':scope > summary').click();
  await expect(element).toHaveJSProperty('open', open);
}
export async function openOperations(page: Page): Promise<() => void> {
  const outside: string[] = []; const posts: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    if (url.origin !== 'http://localhost:4173') { outside.push(url.href); return route.abort(); }
    if (url.pathname === '/api/decision/config') return route.fulfill({ json: { version: DECISION_CONFIG_VERSION, enabled: false, session_cap: 40 } });
    if (url.pathname.startsWith('/api/')) { posts.push(url.pathname); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__c4Operations = { sent: [], received: [], recording: true };
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent<WorkerMessage>) => { if (window.__c4Operations!.recording) window.__c4Operations!.received.push(event.data); });
      }
      override postMessage(message: Request, options?: StructuredSerializeOptions | Transferable[]): void {
        if (window.__c4Operations!.recording) window.__c4Operations!.sent.push(message);
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await page.goto('/?harness=1');
  await page.waitForFunction(() => window.__simHarness !== undefined);
  return () => { expect(outside).toEqual([]); expect(posts).toEqual([]); expect(errors).toEqual([]); };
}
export async function restoreScenario(page: Page, scenario: Scenario): Promise<WorldSnapshot> {
  const bytes = readFileSync(new URL(scenario.replay, DIRECTORY), 'utf8');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(scenario.sha256);
  const replay = JSON.parse(bytes) as Replay;
  await disclosure(page, 'world-setup', true);
  await page.getByTestId('seed').fill(replay.seed);
  await page.getByTestId('config').fill(JSON.stringify(replay.config));
  await page.getByTestId('create').click();
  await expect(page.getByTestId('tick')).toHaveText('0');
  // Setup only: submit the source's assigned-seq order and reproduce each prefix.
  // Only this test's passive recorder is disabled during the large setup prefix.
  // Create and all claimed UI actions retain real protocol messages; setup bytes
  // and every compared prefix remain in the separately bound source replay.
  await page.evaluate(() => { window.__c4Operations!.recording = false; });
  await page.evaluate(async replay => {
    const harness = window.__simHarness;
    if (!harness) throw Error('Actual Worker harness is missing');
    for (const input of [...replay.inputs].sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq)))) {
      const reply = await harness.request({ type: 'submit', input: JSON.stringify({ tick: input.tick, payload: input.payload }) }).reply;
      if (!reply.ok) throw Error(`Recorded setup input failed: ${JSON.stringify(reply)}`);
    }
    for (let tick = 0; tick < Number(replay.ticks) - 1; tick++) {
      const reply = await harness.request({ type: 'step' }).reply;
      if (!reply.ok) throw Error(`Recorded setup Step ${tick + 1} failed: ${JSON.stringify(reply)}`);
      if (reply.snapshot.checksum !== replay.checksums[tick]) throw Error(`Setup checksum diverged at tick ${tick + 1}`);
    }
  }, replay);
  await page.evaluate(setup => {
    window.__c4Operations!.recording = true;
    window.__c4Operations!.setup = setup;
  }, { scenario: scenario.key, replay: scenario.replay, checksumsCompared: Number(replay.ticks) - 1, inputCount: replay.inputs.length });
  // The real final Step is a claimed UI operation, not a harness advancement.
  await page.getByTestId('speed').selectOption('1');
  await expect(page.getByTestId('tick')).toHaveText(String(Number(replay.ticks) - 1));
  await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText(replay.ticks);
  await expect(page.getByTestId('checksum')).toHaveText(replay.checksums.at(-1)!);
  const world = await worldRead(page);
  expect(world).toEqual(JSON.parse(readFileSync(new URL(scenario.world, DIRECTORY), 'utf8')));
  await expect(page.getByTestId('run-state')).toHaveText('paused');
  return world;
}
export async function explicitStep(page: Page): Promise<WorldSnapshot> {
  const before = await worldRead(page);
  await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText(String(BigInt(before.tick) + 1n));
  await expect(page.getByTestId('run-state')).toHaveText('paused');
  return worldRead(page);
}
export async function saveOperation(page: Page, info: TestInfo, name: string, facts: Record<string, unknown>): Promise<void> {
  const exported = await replayRead(page);
  const stem = `c4-operation-${name}`;
  await mkdir(EVIDENCE, { recursive: true });
  const replay = new URL(`${stem}.replay.json`, EVIDENCE);
  const png = new URL(`${stem}.png`, EVIDENCE);
  const manifest = new URL(`${stem}.json`, EVIDENCE);
  await writeFile(replay, exported.bytes);
  await page.screenshot({ path: fileURLToPath(png) });
  await writeFile(manifest, `${JSON.stringify({ version: 1, layer: 'ACTUAL-LOCAL-UI-WORKER-WASM-RULES-ONLY',
    name, test: info.title, viewport: page.viewportSize(), replay: fileURLToPath(replay),
    sha256: createHash('sha256').update(exported.bytes).digest('hex'), completedTicks: exported.replay.ticks,
    world: await worldRead(page), protocol: await probeRead(page), ...facts }, null, 2)}\n`);
  await info.attach(stem, { path: fileURLToPath(manifest), contentType: 'application/json' });
}
