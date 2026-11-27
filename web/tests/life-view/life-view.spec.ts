/// <reference lib="dom" />
// Native cases drive the built App through its real SimClient/Worker/WASM.
// Constructed-carrier cases mount actual production components and prove ONLY
// component rendering/callback contracts; they are never native action evidence.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { Reply, Request, RequestTicket, RequestWithoutId, Snapshot } from '../../src/shared/protocol.ts';
import type { UiAction, UiState } from '../../src/main/ui-state.ts';
import type { Needed, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import type { StoryDelivery, StoryEventKind } from '../../src/shared/story.ts';
import { DECISION_CONFIG_VERSION } from '../../src/shared/decision.ts';
import type { LifeNotebookExport, LifePhase } from '../../src/main/life-journal.ts';
import type { ChoiceCapture, ChoiceResultView } from '../../src/main/choice-result.ts';
import type { OperationState } from '../../src/shared/operation-state.ts';
import { previewLabel } from '../../src/main/player-copy.ts';
import { formatAmount } from '../../src/main/calendar.ts';
import { PORTRAIT_ATLAS, PORTRAIT_CELL, portraitId } from '../../src/art/portraits.ts';

const PREVIEW = 'http://localhost:4173';
const COMPONENT = 'http://localhost:5174';
const EVIDENCE = fileURLToPath(new URL('../../../target/life-unfolds/lu-p1-polish/', import.meta.url));
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
// Harness tickets have a different reply owner from App.sendRequest. Keep their
// actual IDs/requests outside the page so the Story oracle can prove that boundary.
const harnessRequests = new WeakMap<Page, Request[]>();
interface NativeStoryMessage {
  type: 'reply' | 'status'; requestId: number | null; ok: boolean | null;
  worldId: number; tick: string | null; runState: Snapshot['runState']; deliveries: StoryDelivery[];
}
interface FixtureEvidence {
  mode: 'COMPONENT-ONLY'; scenario: string; source: unknown;
  ui: Pick<UiState, 'worldId' | 'runState' | 'tick' | 'checksum' | 'tps' | 'speed' | 'playerNode' | 'world'
    | 'scene' | 'settledScene' | 'memorial' | 'settledMemorial' | 'sceneEpisode' | 'playerLifecycle' | 'underworldForm'
    | 'settledOmitted' | 'decision' | 'error' | 'errorKind' | 'errorOperation' | 'seedMessage' | 'createPending' | 'stepPending'> & {
    notebook: LifeNotebookExport;
    actions: (Omit<UiAction, 'choice'> & { choice?: Pick<ChoiceCapture, 'node' | 'phase' | 'playerSoul' | 'focus' | 'actorContext'> })[];
    phase: LifePhase | null; result: ChoiceResultView | null; slips: OperationState[];
  };
  callbacks: Record<string, unknown>[]; assetState: string;
  draws: { method: 'resident' | 'grave'; canvas: string | undefined; visual: string | null }[];
  portraitDraws: { canvas: string | undefined; id: number; x: number; y: number; scale: number }[];
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
    if (url.pathname === failedAtlas) { await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Controlled local atlas 404' }); return; }
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
  if ((await element.getAttribute('open') !== null) !== open) await element.locator(':scope > summary').press('Enter');
  await expect(element).toHaveJSProperty('open', open);
}
async function request(page: Page, value: RequestWithoutId): Promise<Reply> {
  const reply = await page.evaluate(async value => {
    if (!window.__simHarness) throw Error('Real Worker_Protocol harness is missing');
    return window.__simHarness.request(value).reply;
  }, value);
  harnessRequests.get(page)?.push({ ...value, id: reply.id } as Request);
  return reply;
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
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some(channel => channel !== 0);
  })).toBe(true);
  const scale = await canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement; const bounds = canvas.getBoundingClientRect();
    return { x: bounds.width / canvas.width, y: bounds.height / canvas.height };
  });
  expect(scale.x).toBeGreaterThan(0); expect(scale.x).toBe(scale.y); expect(Number.isInteger(scale.x)).toBe(true);
  for (const layer of await page.getByTestId('scene-picture').first().locator('canvas').all()) {
    const actual = await layer.evaluate(element => {
      const canvas = element as HTMLCanvasElement; const bounds = canvas.getBoundingClientRect();
      return { x: bounds.width / canvas.width, y: bounds.height / canvas.height };
    });
    expect(actual, 'All portrait and scenery source pixels share one integer stage scale').toEqual(scale);
  }
}
async function capture(page: Page, info: TestInfo, stem: string, evidence: Record<string, unknown>): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  const sourcePaths = [
    'web/src/App.svelte', 'web/src/ui/LifeSurface.svelte', 'web/src/ui/life.css', 'web/src/ui/ScenePicture.svelte',
    'web/src/ui/ChoicePanel.svelte', 'web/src/ui/UnderworldPanel.svelte', 'web/src/ui/IdentityPanel.svelte', 'web/src/ui/LifeJournal.svelte',
    'web/src/ui/Portrait.svelte', 'web/src/art/portraits.ts', 'web/src/art/sprites.ts', 'web/src/art/life-view-atlas.ts',
    'web/src/art/stage-paint.ts', 'web/src/art/office-interior.ts', 'web/public/assets/life-portraits.png',
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
  const config = fixture.config as { opening_residents: number };
  await page.getByTestId('seed').fill(fixture.seed); await page.getByTestId('town-size').fill(String(config.opening_residents));
  await page.getByTestId('create').click();
  await disclosure(page, 'technical-details', true);
  await expect(page.getByTestId('tick')).toHaveText('0');
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  expect(JSON.parse(await page.getByTestId('config').textContent() ?? '')).toEqual(fixture.config);
  await disclosure(page, 'world-setup', false);
}
async function nativeAdvance(page: Page, ticks: number, answerFinal = false): Promise<void> {
  // DOM activation invokes App.onStep/onChoose -> sendRequest -> request-sent
  // and the matching reply dispatch. Calling the harness for those operations
  // only resolves the test's Promise and permanently consumes unseen Story.
  const reads = await page.evaluate(async ({ ticks, answerFinal }) => {
    const app = document.querySelector('[data-testid="life-app"]');
    const step = document.querySelector<HTMLButtonElement>('[data-testid="step"]');
    const tickLabel = document.querySelector('[data-testid="tick"]');
    if (!app || !step || !tickLabel || !window.__simHarness) throw Error('Native UI progression controls are missing');
    const harness = window.__simHarness;
    const reads: Request[] = [];
    const waitFor = (ready: () => boolean): Promise<void> => {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => { observer.disconnect(); reject(Error(`Native UI progression did not settle at tick ${tickLabel.textContent}`)); }, 30_000);
      function check() {
        if (!ready()) return;
        observer.disconnect(); clearTimeout(timeout); resolve();
      }
      observer.observe(app, { subtree: true, childList: true, attributes: true, characterData: true });
      check();
      return promise;
    };
    const answer = async (): Promise<void> => {
      const value = { type: 'world-snapshot' } as const;
      const ticket = harness.request(value); reads.push({ ...value, id: ticket.requestId });
      const reply = await ticket.reply;
      if (!reply.ok || !reply.world) throw Error('Native current node read failed');
      if (!reply.snapshot.playerNode.pending || reply.snapshot.playerNode.answered) return;
      const node = reply.world.player_node;
      if (!node) throw Error('Native current node is missing');
      const option = () => document.querySelector<HTMLButtonElement>(`[data-testid="option-${node.rules_default}"]`);
      await waitFor(() => option() !== null && !option()!.disabled);
      option()!.click();
      await waitFor(() => !step.disabled);
    };
    const start = Number(tickLabel.textContent);
    if (!Number.isSafeInteger(start)) throw Error('Native current tick is missing');
    for (let tick = start; tick < start + ticks; tick++) {
      await waitFor(() => !step.disabled || document.querySelector('button[data-testid^="option-"]:not(:disabled)') !== null);
      if (step.disabled) await answer();
      step.click();
      await waitFor(() => tickLabel.textContent === String(tick + 1));
    }
    if (answerFinal) await answer();
    return reads;
  }, { ticks, answerFinal });
  harnessRequests.get(page)?.push(...reads);
}
async function nativeWaiting(page: Page): Promise<WorldSnapshot> {
  await nativeCreate(page, waitingFixture);
  const prefix = waitingFixture.inputs.filter(input => BigInt(input.seq) < 61n).map(input => ({ tick: input.tick, payload: input.payload }));
  for (const input of prefix) {
    const reply = await request(page, { type: 'submit', input: JSON.stringify(input) });
    if (!reply.ok) throw Error(`Native fixture submit failed: ${reply.kind}`);
  }
  await nativeAdvance(page, 1653, true);
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
  await nativeAdvance(page, ticks);
  await page.getByTestId('speed').selectOption('1');
  await expect(page.getByTestId('tick')).toHaveText(String(ticks));
  await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText(choiceStages.stages[0]!.tick);
  const world = await worldRead(page); expect(world.player_node).not.toBeNull();
  return world;
}
async function verifyChoice(page: Page, world: WorldSnapshot): Promise<void> {
  const node = world.player_node!;
  expect(await page.locator('[data-testid^="option-preview-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))))
    .toEqual(node.options.map(option => `option-preview-${option.id}`));
  for (const option of node.options) {
    await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
    const preview = page.getByTestId(`option-preview-${option.id}`);
    const rows = preview.locator('[data-person][data-unit][data-delta]');
    expect(await rows.evaluateAll(elements => elements.map(element => ({
      person: Number(element.getAttribute('data-person')), what: element.getAttribute('data-unit'), delta: element.getAttribute('data-delta'),
    })))).toEqual(option.preview);
    for (const [index, effect] of option.preview.entries()) {
      const row = rows.nth(index);
      // Labels come from production's actual unit mapping, not frozen copy.
      await expect(row).toContainText(previewLabel(effect.what));
      await expect(row).toContainText(`${BigInt(effect.delta) >= 0n ? '+' : '−'}${formatAmount(effect.delta).replace(/^-/, '')}`);
      if (effect.person !== world.player.body) await expect(row).toContainText(personName(world, effect.person));
    }
  }
}
async function openDesk(page: Page): Promise<void> {
  for (const id of ['dream-section', 'bribe-section', 'haunt-section', 'carry-section', 'rebirth-section']) await disclosure(page, id, true);
}
async function archiveDownload(page: Page, trigger: () => Promise<unknown>): Promise<LifeNotebookExport> {
  const downloaded = page.waitForEvent('download');
  await trigger();
  const stream = await (await downloaded).createReadStream();
  if (stream === null) throw Error('Full-fact download stream is missing');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as LifeNotebookExport;
}
async function observeNativeStory(page: Page) {
  // Passive observers at BOTH transport ends retain exact requests and ACKs.
  // Neither the Worker constructor/postMessage nor client/reducer is patched.
  const nativeWorkers = page.workers();
  expect(nativeWorkers).toHaveLength(1);
  const sent = await nativeWorkers[0]!.evaluateHandle(() => {
    const requests: Request[] = [];
    const listener = (event: MessageEvent<Request>) => requests.push(structuredClone(event.data));
    globalThis.addEventListener('message', listener);
    return { requests, stop() { globalThis.removeEventListener('message', listener); } };
  });
  harnessRequests.set(page, []);
  const session = await page.context().newCDPSession(page);
  const prototype = await session.send('Runtime.evaluate', { expression: 'Worker.prototype' });
  const workers = await session.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId! });
  const observed = await session.send('Runtime.callFunctionOn', {
    objectId: workers.objects.objectId!,
    functionDeclaration: `function () {
      if (this.length !== 1) throw Error('Expected the one real SimClient Worker');
      const worker = this[0]; const messages = [];
      const listener = event => {
        const message = event.data;
        if (message.type === 'fatal') throw Error(message.error);
        messages.push({ type: message.type, requestId: message.type === 'reply' ? message.id : null,
          ok: message.type === 'reply' ? message.ok : null, worldId: message.snapshot.worldId,
          tick: message.snapshot.tick, runState: message.snapshot.runState,
          deliveries: structuredClone(message.snapshot.story ?? []) });
      };
      worker.addEventListener('message', listener);
      return { messages, stop() { worker.removeEventListener('message', listener); } };
    }`,
  });
  if (observed.exceptionDetails !== undefined || observed.result.objectId === undefined) throw Error('Read-only native Story observer could not attach');
  await session.send('Runtime.releaseObject', { objectId: prototype.result.objectId! });
  await session.send('Runtime.releaseObject', { objectId: workers.objects.objectId! });
  return {
    async read() {
      const requests = await sent.evaluate(observer => observer.requests);
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: observed.result.objectId!, functionDeclaration: 'function () { return this.messages; }', returnByValue: true,
      });
      if (result.exceptionDetails !== undefined) throw Error('Read-only native Story evidence could not be read');
      const messages = result.result.value as NativeStoryMessage[];
      const testRequests = harnessRequests.get(page)!;
      const requestById = new Map(requests.map(request => [request.id, request]));
      const testById = new Map(testRequests.map(request => [request.id, request]));
      expect(requestById.size).toBe(requests.length);
      expect(testById.size).toBe(testRequests.length);
      for (const request of testRequests) {
        expect(requestById.get(request.id), 'Harness ownership binds the exact transported request, not archive membership').toEqual(request);
        expect(['submit', 'world-snapshot', 'export-replay']).toContain(request.type);
        expect(messages.filter(message => message.requestId === request.id)).toHaveLength(1);
      }
      const deliveries: StoryDelivery[] = [];
      let currentWorld = 0;
      for (const message of messages) {
        expect(message.runState, 'Ordinary native requests must not fail the Worker').not.toBe('failed');
        if (message.type === 'reply') {
          const request = requestById.get(message.requestId!);
          if (request === undefined) {
            // An already issued mount-time decision-status ACK can race attach.
            expect(message.deliveries, 'An unknown request cannot supply Story evidence').toEqual([]);
            continue;
          }
          if (testById.has(request.id)) {
            // Harness replies settle ONLY their caller (SimClient.#flushReplies).
            // Fixture submissions/read-only reads must not steal any Story.
            expect(message.deliveries, `Test-owned ${request.type} ${request.id} must not bypass Story admission`).toEqual([]);
            continue;
          }
          // All other requests originate in App.sendRequest, which dispatches
          // request-sent and this exact ACK; create success establishes the epoch.
          if (request.type === 'create-world' && message.ok && message.worldId > currentWorld) currentWorld = message.worldId;
        }
        // main.ts forwards status; reduce admits only the current World. Old
        // frames are still facts, so there is deliberately no tick-freshness gate.
        if (message.worldId === currentWorld) deliveries.push(...message.deliveries);
      }
      return { requests, harnessRequests: testRequests, messages, deliveries, currentWorld };
    },
    async dispose(): Promise<void> {
      await sent.evaluate(observer => observer.stop());
      await sent.dispose();
      harnessRequests.delete(page);
      await session.send('Runtime.callFunctionOn', { objectId: observed.result.objectId!, functionDeclaration: 'function () { this.stop(); }' });
      await session.send('Runtime.releaseObject', { objectId: observed.result.objectId! });
      await session.detach();
    },
  };
}
function verifyNativeArchive(archive: LifeNotebookExport, deliveries: readonly StoryDelivery[]): void {
  const admitted = deliveries.filter(delivery => delivery.worldId === archive.worldId).map(delivery => delivery.batch);
  expect(admitted.length, 'The independent Worker observer saw this actual World').toBeGreaterThan(0);
  expect(admitted[0]!.opening, 'The actual fresh-create opening is observed before any progression').toBe(true);
  expect(admitted.filter(batch => batch.opening)).toHaveLength(1);
  const firstEvents = new Map<string, LifeNotebookExport['events'][string]>();
  const firstChronicle = new Map<string, LifeNotebookExport['chronicle'][string]>();
  const firstDreams = new Map<string, LifeNotebookExport['dreams'][string]>();
  const identities: LifeNotebookExport['identities'][number][] = [];
  const opening: Record<string, boolean> = {};
  for (const batch of admitted) {
    expect(batch.version).toBe(1);
    for (const event of batch.events) if (!firstEvents.has(event.id)) {
      firstEvents.set(event.id, event); identities.push(`e:${event.id}`); opening[`e:${event.id}`] = batch.opening;
    }
    for (const record of batch.chronicle) if (!firstChronicle.has(record.index)) {
      firstChronicle.set(record.index, record); identities.push(`c:${record.index}`); opening[`c:${record.index}`] = batch.opening;
    }
    for (const dream of batch.dreams) if (!firstDreams.has(dream.eventId)) firstDreams.set(dream.eventId, dream);
  }
  // Equality covers every native field, including raw (not necessarily
  // materialized) causes, original IDs/ticks, tags, roles and ActorContext.
  expect(archive.events).toEqual(Object.fromEntries(firstEvents));
  expect(archive.chronicle).toEqual(Object.fromEntries(firstChronicle));
  expect(archive.dreams).toEqual(Object.fromEntries(firstDreams));
  expect(archive.identities).toEqual(identities); expect(archive.opening).toEqual(opening);
  const actorFacts = admitted.flatMap(batch => batch.actors);
  const people = [...new Set(actorFacts.map(actor => actor.person))];
  expect(Object.keys(archive.actors).map(Number).sort((a, b) => a - b)).toEqual(people.sort((a, b) => a - b));
  for (const person of people) {
    const observations = actorFacts.filter(actor => actor.person === person);
    const latest = observations.at(-1)!;
    const death = observations.reverse().find(actor => actor.ageAtDeath !== undefined);
    expect(archive.actors[person], `Person ${person} keeps original native metadata and its late death annotation`)
      .toEqual(death === undefined ? latest : { ...latest, ageAtDeath: death.ageAtDeath });
  }
  let furthest = admitted[0]!.cursors;
  for (const batch of admitted.slice(1)) {
    for (const kind of ['events', 'chronicle'] as const) {
      expect(BigInt(batch.cursors[kind].start)).toBe(BigInt(furthest[kind].end));
      expect(BigInt(batch.cursors[kind].end)).toBeGreaterThanOrEqual(BigInt(batch.cursors[kind].start));
    }
    if (BigInt(batch.cursors.events.end) > BigInt(furthest.events.end)
      || BigInt(batch.cursors.chronicle.end) > BigInt(furthest.chronicle.end)) furthest = batch.cursors;
  }
  expect(archive.cursors, 'Original native cursor envelopes are retained exactly').toEqual(furthest);
}
function verifyArchive(archive: LifeNotebookExport, world: WorldSnapshot): void {
  expect(archive.identities).toHaveLength(Object.keys(archive.events).length + Object.keys(archive.chronicle).length);
  expect(new Set(archive.identities).size).toBe(archive.identities.length);
  for (const identity of archive.identities) {
    expect(identity.startsWith('e:') ? archive.events[identity.slice(2)] : archive.chronicle[identity.slice(2)]).toBeDefined();
    expect(typeof archive.opening[identity]).toBe('boolean');
  }
  // Native Story delivers fact roles and observed focus identities, not a World census.
  const roles = {
    birth: ['person'], death: ['person'], marriage: ['a', 'b'], loan: ['lender', 'borrower'],
    repayment: ['payer', 'payee'], debt_transfer: ['from', 'to'], debt_forgiven: ['creditor', 'debtor'],
    inheritance: ['deceased', 'heir'], possession: ['person'], rebuild: ['person'],
    offering: ['offerer', 'ghost'], bribe_offering: ['ghost', 'magistrate'], dream: ['ghost', 'dreamer'],
    haunting: ['ghost', 'target'], appeal: ['ghost', 'magistrate'], social: ['doer', 'target'],
  } satisfies Record<StoryEventKind['type'], readonly string[]>;
  const referenced = new Set<number>();
  for (const [id, event] of Object.entries(archive.events)) {
    expect(event.id).toBe(id); expect(event.tick).toMatch(/^\d+$/);
    for (const role of roles[event.kind.type]) {
      const person: unknown = Reflect.get(event.kind, role);
      expect(typeof person, `${event.kind.type}.${role} retains its Person identity`).toBe('number');
      referenced.add(person as number);
    }
    // CausedBy is a raw native ID vector, not a guarantee of a materialized parent.
    // Native cases compare the entire event to independently observed Worker facts.
    if (event.kind.type === 'death') expect(archive.actors[event.kind.person]?.ageAtDeath).toMatch(/^\d+$/);
  }
  for (const [index, record] of Object.entries(archive.chronicle)) {
    expect(record.index).toBe(index); expect(record.tick).toMatch(/^\d+$/);
    for (const person of record.stakes.who) referenced.add(person);
    for (const id of record.appended) expect(archive.events[id], 'Every raw Chronicle appended event remains available').toBeDefined();
  }
  for (const record of [...Object.values(archive.events), ...Object.values(archive.chronicle)]) {
    for (const context of record.actorContext) {
      referenced.add(context.relativeTo);
      for (const actor of context.actors) referenced.add(actor.person);
    }
  }
  for (const [id, dream] of Object.entries(archive.dreams)) {
    expect(dream.eventId).toBe(id); expect(dream.tick).toMatch(/^\d+$/); expect(dream.inputSeq).toMatch(/^\d+$/);
    expect(archive.events[id]?.kind).toMatchObject({ type: 'dream', ghost: dream.ghost, dreamer: dream.dreamer, price: dream.price });
    referenced.add(dream.ghost); referenced.add(dream.dreamer);
  }
  for (const person of referenced) expect(archive.actors[person], `Referenced Person ${person} retains native actor metadata`).toBeDefined();
  for (const [id, actor] of Object.entries(archive.actors)) {
    expect(actor.person).toBe(Number(id)); expect(actor.name.length).toBeGreaterThan(0);
    const resident = world.residents.find(resident => resident.id === actor.person)
      ?? (world.magistrate.id === actor.person ? world.magistrate : undefined);
    if (resident !== undefined) expect(actor).toMatchObject({ person: resident.id, name: resident.name, sex: resident.sex, soulId: resident.soul_id, origin: resident.origin });
    const earlier = world.player.earlier_bodies.find(body => body.id === actor.person);
    if (earlier !== undefined) expect(actor).toMatchObject({ name: earlier.name, origin: earlier.origin, soulId: world.player_soul });
  }
  expect(archive.cursors).not.toBeNull();
  for (const kind of ['events', 'chronicle'] as const) {
    const cursor = archive.cursors![kind]; expect(cursor.start).toMatch(/^\d+$/); expect(cursor.end).toMatch(/^\d+$/);
    expect(BigInt(cursor.start) <= BigInt(cursor.end)).toBe(true);
    expect(BigInt(cursor.end), `The full raw ${kind} prefix reaches the native cursor`).toBe(BigInt(Object.keys(archive[kind]).length));
  }
  for (const record of world.chronicle) expect(Object.values(archive.chronicle)).toEqual(expect.arrayContaining([expect.objectContaining({
    tick: record.tick, family: record.family, applied: record.applied, source: record.source,
    stakes: record.stakes, chooserAbsent: record.chooser_absent, skipped: record.skipped,
  })]));
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 640 }]) {
  test(`native App living, choice and Waiting consumer facts at ${viewport.width}px`, async ({ page }, info) => {
    const network = await offline(page); await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/?harness=1');
    await page.waitForFunction(() => window.__simHarness !== undefined);
    const story = await observeNativeStory(page);
    try {
    await expect(page.getByTestId('world-setup')).toHaveJSProperty('open', false);
    await expect(page.getByTestId('technical-details')).toHaveJSProperty('open', false);
    await nativeCreate(page, waitingFixture); await expect(page.getByTestId('life-app')).toHaveAttribute('data-assets', 'ready');
    const living = await worldRead(page); expect(living.player.body).not.toBeNull();
    await expect(page.getByTestId('life-name')).toHaveText(personName(living, living.player.body!)); await expect(page.getByTestId('life-soul')).toHaveText(living.player_soul);
    await atlasPixels(page); await noHorizontalOverflow(page);
    await capture(page, info, `lu-p1-native-${viewport.width}-living`, { mode: 'NATIVE-APP-RULES-ONLY', world: living });
    const choice = await nativeChoice(page); await verifyChoice(page, choice);
    await expect(page.getByTestId('run')).toBeDisabled(); await expect(page.getByTestId('step')).toBeDisabled(); await atlasPixels(page); await noHorizontalOverflow(page);
    await capture(page, info, `lu-p1-native-${viewport.width}-choice`, { mode: 'NATIVE-APP-RULES-ONLY', world: choice });
    const beforeChoice = JSON.parse(await exportRead(page)) as { inputs: unknown[] }; const node = choice.player_node!;
    await page.getByTestId(`option-${node.options[0]!.id}`).focus(); await page.keyboard.press('Enter');
    await expect(page.getByTestId(`option-${node.options[0]!.id}`)).toHaveCount(0);
    const chosen = JSON.parse(await exportRead(page)) as { inputs: { tick: string; payload: unknown }[] };
    expect(chosen.inputs).toHaveLength(beforeChoice.inputs.length + 1);
    expect(chosen.inputs.at(-1)).toMatchObject({ tick: choice.tick, payload: { ChoosePlayer: { node: node.id, option: node.options[0]!.id } } });
    const waiting = await nativeWaiting(page);
    if (await page.getByTestId('scene-close').isVisible()) await page.getByTestId('scene-close').click();
    await openDesk(page); await expect(page.getByTestId('life-soul')).toHaveText(waiting.player_soul);
    const view = waiting.underworld_view!;
    expect(await page.locator('[data-testid^="slot-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(view.slots.map(slot => `slot-${slot.slot}`));
    expect(await page.getByTestId('dream-targets').getByRole('radio').evaluateAll(elements => elements.map(element => Number((element as HTMLInputElement).value)))).toEqual(view.connected);
    expect(await page.getByTestId('carry-over').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    for (const target of view.actions.haunt.targets) await expect(page.getByTestId(`haunt-target-${target.target}`)).toHaveCount(1);
    for (const slot of view.slots) { await expect(page.getByTestId(`slot-${slot.slot}`).locator('[data-price]')).toHaveAttribute('data-price', slot.price); await expect(page.getByTestId(`claim-${slot.slot}`)).toHaveCount(1); }
    await expect(page.getByTestId('joss-balance')).toHaveAttribute('data-amount', waiting.joss.find(account => account.soul_id === waiting.player_soul)!.balance);
    await expect(page.getByTestId('capped-spend')).toHaveAttribute('data-remaining', view.actions.capped_spend.remaining); await expect(page.getByTestId('capped-spend')).toHaveAttribute('data-cap', view.actions.capped_spend.yearly_cap);
    await atlasPixels(page); await noHorizontalOverflow(page); await capture(page, info, `lu-p1-native-${viewport.width}-waiting`, { mode: 'NATIVE-APP-RULES-ONLY', world: waiting, fixture: 'fixtures/parity/seedU-underworld.replay.json', prefixSeqExclusive: '61' });
    const before = await exportRead(page);
    await disclosure(page, 'town-disclosure', true); await expect(page.getByTestId('town-view')).toBeVisible(); await disclosure(page, 'town-disclosure', false);
    await disclosure(page, 'people-files', true); await page.getByTestId('people-files').getByRole('img', { name: personName(waiting, waiting.player_wait!.ghost), exact: true }).first().click(); await disclosure(page, 'people-files', false);
    for (const id of ['world-setup', 'technical-details', 'dream-section', 'haunt-section']) { await disclosure(page, id, false); await disclosure(page, id, true); }
    await disclosure(page, 'rebirth-section', true);
    await expect(page.getByTestId('customize')).toBeVisible();
    await page.getByTestId('customize').click(); await page.getByTestId('customization-kind').selectOption('Adjust'); await page.getByTestId('customization-cancel').click();
    const downloadButton = page.getByRole('button', { name: 'Download life facts', exact: true, includeHidden: true });
    const rawFacts = page.getByTestId('technical-details').locator('details').filter({ has: downloadButton });
    if (await rawFacts.getAttribute('open') === null) await rawFacts.locator(':scope > summary').press('Enter');
    await expect(rawFacts).toHaveJSProperty('open', true); await expect(downloadButton).toBeVisible();
    const archive = await archiveDownload(page, () => downloadButton.click());
    expect(archive.worldId).toBe(Number(await page.getByTestId('life-app').getAttribute('data-world-id')));
    const admission = await story.read(); const { deliveries } = admission;
    expect(admission.currentWorld).toBe(archive.worldId);
    const currentWorld = deliveries.filter(delivery => delivery.worldId === archive.worldId);
    const rawEventIds = new Set(currentWorld.flatMap(delivery => delivery.batch.events.map(event => event.id)));
    const unmaterializedCauses = currentWorld.flatMap(delivery => delivery.batch.events.flatMap(event =>
      event.causedBy.filter(cause => !rawEventIds.has(cause)).map(cause => ({ worldId: delivery.worldId, identity: `e:${event.id}`, tick: event.tick, opening: delivery.batch.opening, cause }))));
    await info.attach('actual-worker-story-deliveries-and-archive', { body: Buffer.from(JSON.stringify({ layer: 'ACTUAL-REQUEST-ACK-STORY-ADMISSION', ...admission, unmaterializedCauses, archive })), contentType: 'application/json' });
    verifyNativeArchive(archive, deliveries); verifyArchive(archive, waiting);
    const ghost = archive.actors[waiting.player_wait!.ghost]!; expect(ghost.name).toBe(personName(waiting, waiting.player_wait!.ghost)); expect(ghost.ageAtDeath).toBeDefined();
    expect(await exportRead(page), 'Local disclosures, portrait clicks, cancellation and full-fact download do not submit native input').toBe(before); await expect(page.getByTestId('tick')).toHaveText(waiting.tick);
    network.finish();
    } finally { await story.dispose(); }
  });
}

test('native syntax-valid zero reaches actual Core bad_amount without replay input', async ({ page }, info) => {
  const network = await offline(page); await page.goto('/?harness=1'); await page.waitForFunction(() => window.__simHarness !== undefined);
  const world = await nativeWaiting(page); await disclosure(page, 'bribe-section', true); expect(world.underworld_view!.actions.bribe.availability.eligible).toBe(true);
  const before = await exportRead(page);
  for (const invalid of ['01', ' 1', '1 ', '+1', '-1', '1e3', '1.0', '18446744073709551616']) {
    await page.getByTestId('bribe-amount').fill(invalid); await expect(page.getByTestId('bribe-send')).toBeDisabled(); await expect(page.getByTestId('bribe-amount')).toHaveAttribute('aria-invalid', 'true'); await page.getByTestId('bribe-amount').press('Enter');
  }
  expect(await exportRead(page)).toBe(before); await page.getByTestId('bribe-amount').fill('0'); await expect(page.getByTestId('bribe-send')).toBeEnabled(); await page.getByTestId('bribe-send').click();
  await expect(page.getByTestId('error')).toHaveAttribute('data-error-kind', 'rejected'); await expect(page.getByTestId('technical-details')).toContainText('bad_amount');
  expect(await exportRead(page), 'Checked Core rejection does not add a replay input').toBe(before); await expect(page.getByTestId('tick')).toHaveText(world.tick);
  await capture(page, info, 'lu-p1-native-zero-core-rejection', { mode: 'NATIVE-APP-RULES-ONLY', world, operation: { type: 'bribe', amount: '0' }, expectedCoreRejection: 'bad_amount' }); network.finish();
});

test('controlled atlas failure preserves native facts and controls without a painted fallback', async ({ page }, info) => {
  const failedAtlas = '/assets/life-view-urban.png'; const network = await offline(page, failedAtlas); await page.setViewportSize({ width: 1024, height: 640 }); await page.goto('/?harness=1');
  await page.waitForFunction(() => window.__simHarness !== undefined); await nativeCreate(page, waitingFixture); await expect(page.getByTestId('life-app')).toHaveAttribute('data-assets', 'error'); await expect(page.getByTestId('art-error')).toBeVisible();
  const world = await worldRead(page); await expect(page.getByTestId('life-name')).toHaveText(personName(world, world.player.body!)); await expect(page.getByTestId('run')).toBeEnabled(); await expect(page.getByTestId('step')).toBeEnabled();
  const painted = await page.getByTestId('scene-picture-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement; return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some(channel => channel !== 0);
  });
  expect(painted, 'Loader failure does not substitute artwork').toBe(false);
  await page.getByTestId('step').click(); await expect(page.getByTestId('tick')).toHaveText('1'); await expect(page.getByTestId('art-error')).toBeVisible(); expect(network.atlasRequests.filter(path => path === failedAtlas)).toHaveLength(1);
  await capture(page, info, 'lu-p1-native-controlled-atlas-404', { mode: 'NATIVE-APP-CONTROLLED-ASSET-FAULT', controlledFault: { path: failedAtlas, status: 404 }, world: await worldRead(page), painted }); network.finish();
});

async function componentOpen(page: Page, scenario: string, viewport: { width: number; height: number }): Promise<FixtureEvidence> {
  await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(`${COMPONENT}/life-view-fixture.html?state=${scenario}`);
  await expect(page.getByTestId('fixture-label')).toContainText('COMPONENT-ONLY');
  await expect(page.getByTestId('component-fixture')).toHaveAttribute('data-assets', 'ready');
  await atlasPixels(page); await noHorizontalOverflow(page);
  const evidence = await fixtureRead(page); expect(evidence.mode).toBe('COMPONENT-ONLY');
  return evidence;
}
for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 640 }]) {
  for (const family of ['funeral', 'inheritance'] as const) {
    test(`COMPONENT-ONLY ${family} retained people and every option callback at ${viewport.width}px`, async ({ page }, info) => {
      const network = await offline(page);
      for (const history of [false, true]) {
        const original = await componentOpen(page, `event-${family}${history ? '-history' : ''}`, viewport); const world = original.ui.world!; const node = world.player_node!;
        expect(world.residents.some(person => person.id === 100)).toBe(false); expect(world.player.earlier_bodies.some(person => person.id === 100)).toBe(false);
        await verifyChoice(page, world);
        if (await page.getByTestId('scene-close').isVisible()) await page.getByTestId('scene-close').click();
        for (const person of node.stakes.who) await expect(page.getByTestId('scene-picture').first()).toContainText(personName(world, person));
        await atlasPixels(page); await noHorizontalOverflow(page); await capture(page, info, `lu-p1-event-${family}-${viewport.width}${history ? '-history' : ''}`, { mode: 'COMPONENT-ONLY', fixture: await fixtureRead(page) });
        for (const option of node.options) { await page.getByTestId(`option-${option.id}`).focus(); await page.keyboard.press('Enter'); expect((await fixtureRead(page)).callbacks.at(-1)).toEqual({ kind: 'choose', worldId: original.ui.worldId, node: node.id, option: option.id }); }
        const after = await fixtureRead(page); expect(after.ui.world).toEqual(world); expect(after.ui.tick).toBe(original.ui.tick);
      }
      network.finish();
    });
  }
}


async function verifyPeople(page: Page, evidence: FixtureEvidence): Promise<void> {
  const world = evidence.ui.world!;
  await disclosure(page, 'people-files', true);
  for (const [id, people] of [
    ['blood-ties', world.player.blood_ties.map(tie => ({ person: tie.person, relationship: tie.affinity }))],
    ['current-relations', world.player.relations.filter(tie => !world.player.blood_ties.some(family => family.person === tie.person)).map(tie => ({ person: tie.person, relationship: tie.affinity }))],
    ['past-life-ties', world.player.past_life_ties.map(tie => ({ person: tie.rememberer, relationship: tie.affinity }))],
    ['earlier-lives', world.player.earlier_bodies.map(body => ({ person: body.id, relationship: null }))],
  ] as const) {
    const group = page.getByTestId(id); if (await group.getAttribute('open') === null) await group.locator('summary').click();
    const cards = group.getByTestId('people-card');
    expect(await cards.evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-person'))))).toEqual(people.map(entry => entry.person));
    for (const [index, entry] of people.entries()) {
      const resident = world.residents.find(person => person.id === entry.person); const actor = evidence.ui.notebook.actors[entry.person];
      const card = cards.nth(index);
      await expect(card).toContainText(personName(world, entry.person));
      await expect(card).toHaveAttribute('data-sex', resident?.sex ?? actor?.sex ?? 'unknown');
      await expect(card).toHaveAttribute('data-age', String(resident?.age ?? actor?.ageAtDeath ?? 'unknown'));
      if (entry.relationship !== null) await expect(card).toHaveAttribute('data-relationship', String(entry.relationship));
      await expect(card.getByRole('img')).toHaveAccessibleName(personName(world, entry.person));
    }
    if (people.length > 0) { await cards.last().scrollIntoViewIfNeeded(); await expect(cards.last()).toBeInViewport(); }
  }
}
async function verifyPaintedCell(canvas: Locator, id: number, scale: number, x = 0, y = 0, visibleRows = PORTRAIT_CELL): Promise<void> {
  expect(Number.isInteger(scale) && scale > 0).toBe(true);
  let screenshot: Buffer | undefined;
  let screenSourceScale = 0;
  if (visibleRows === PORTRAIT_CELL) {
    await mkdir(EVIDENCE, { recursive: true });
    const stem = `lu-p1-portrait-${test.info().title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    await canvas.scrollIntoViewIfNeeded();
    const geometry = await canvas.evaluate(element => {
      const actual = element as HTMLCanvasElement; const bounds = actual.getBoundingClientRect(); const css = getComputedStyle(actual);
      return { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width, height: bounds.height,
        intrinsicWidth: actual.width, intrinsicHeight: actual.height, dpr: devicePixelRatio,
        computedWidth: css.width, computedHeight: css.height, transform: css.transform, imageRendering: css.imageRendering };
    });
    const cssScale = Math.round(geometry.width / geometry.intrinsicWidth);
    const physicalScale = scale * cssScale * geometry.dpr;
    screenSourceScale = Math.round(physicalScale);
    expect(screenSourceScale).toBeGreaterThan(0); expect(physicalScale).toBeCloseTo(screenSourceScale, 6);
    // Locator screenshots enclose fractional origins with floor/ceil, adding a
    // border pixel. Capture the actual device-aligned cell, without resampling.
    const clip = { x: Math.round(geometry.x * geometry.dpr) / geometry.dpr, y: Math.round(geometry.y * geometry.dpr) / geometry.dpr,
      width: PORTRAIT_CELL * screenSourceScale / geometry.dpr, height: visibleRows * screenSourceScale / geometry.dpr };
    screenshot = await canvas.page().screenshot({ path: `${EVIDENCE}${stem}.png`, fullPage: true, clip, animations: 'disabled' });
    await test.info().attach(`${stem}-geometry`, { body: Buffer.from(JSON.stringify({ ...geometry, clip, screenSourceScale })), contentType: 'application/json' });
    await test.info().attach(stem, { body: screenshot, contentType: 'image/png' });
  }
  const result = await canvas.evaluate(async (element, input) => {
    const actual = element as HTMLCanvasElement; const image = new Image(); image.src = new URL(input.atlas.path, document.baseURI).href; await image.decode();
    const extent = input.cell * input.scale; const height = input.visibleRows * input.scale;
    const reference = document.createElement('canvas'); reference.width = extent; reference.height = extent;
    const ctx = reference.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, input.id % input.atlas.columns * input.cell, Math.floor(input.id / input.atlas.columns) * input.cell, input.cell, input.cell, 0, 0, extent, extent);
    const expected = ctx.getImageData(0, 0, extent, height).data; const painted = actual.getContext('2d')!.getImageData(input.x, input.y, extent, height).data;
    let mismatches = 0; let opaque = 0; let screenMismatches = 0;
    for (let index = 0; index < expected.length; index += 4) {
      if (expected[index + 3] !== 255) continue;
      opaque++;
      for (let channel = 0; channel < 4; channel++) if (painted[index + channel] !== expected[index + channel]) mismatches++;
    }
    if (input.screenshot !== null) {
      const screen = new Image(); screen.src = `data:image/png;base64,${input.screenshot}`; await screen.decode();
      const screenScale = input.screenSourceScale;
      if (screen.width !== input.cell * screenScale || screen.height !== input.visibleRows * screenScale) throw Error('The actual portrait screenshot is not integer source-pixel replication');
      const raster = document.createElement('canvas'); raster.width = screen.width; raster.height = screen.height;
      const rasterCtx = raster.getContext('2d')!; rasterCtx.drawImage(screen, 0, 0); const pixels = rasterCtx.getImageData(0, 0, screen.width, screen.height).data;
      for (let sy = 0; sy < input.visibleRows; sy++) for (let sx = 0; sx < input.cell; sx++) {
        const source = (sy * input.scale * extent + sx * input.scale) * 4; if (expected[source + 3] !== 255) continue;
        for (let dy = 0; dy < screenScale; dy++) for (let dx = 0; dx < screenScale; dx++) {
          const target = ((sy * screenScale + dy) * screen.width + sx * screenScale + dx) * 4;
          for (let channel = 0; channel < 4; channel++) if (pixels[target + channel] !== expected[source + channel]) screenMismatches++;
        }
      }
    }
    const bounds = actual.getBoundingClientRect(); return { mismatches, screenMismatches, opaque, width: actual.width, height: actual.height, cssX: bounds.width / actual.width, cssY: bounds.height / actual.height };
  }, { id, scale, x, y, visibleRows, atlas: PORTRAIT_ATLAS, cell: PORTRAIT_CELL, screenSourceScale, screenshot: screenshot?.toString('base64') ?? null });
  expect(result.opaque).toBeGreaterThan(0); expect(result.mismatches, 'Actual canvas pixels match the selected licensed source cell').toBe(0);
  expect(result.screenMismatches, 'Real browser screenshot preserves the same integer-replicated source pixels').toBe(0);
  const cssScale = Math.round(result.cssX);
  expect(cssScale).toBeGreaterThan(0);
  // Chromium layout quantizes authored integer lengths; actual raster equality
  // above still rejects fractional scaling, interpolation and clipped edges.
  expect(Math.abs(result.cssX - cssScale) * result.width).toBeLessThanOrEqual(1 / 64);
  expect(Math.abs(result.cssY - cssScale) * result.height).toBeLessThanOrEqual(1 / 64);
}
async function verifyFixturePortraits(page: Page, evidence: FixtureEvidence): Promise<void> {
  const world = evidence.ui.world!; const person = world.player.body ?? world.player_wait!.ghost;
  const resident = world.residents.find(resident => resident.id === person); const actor = evidence.ui.notebook.actors[person];
  const age = resident?.age ?? (actor?.ageAtDeath === undefined ? null : Number(actor.ageAtDeath)); const sex = resident?.sex ?? actor?.sex ?? null;
  const expected = portraitId({ person, sex, age });
  const portrait = page.getByTestId('people-files').getByTestId('portrait').filter({ has: page.getByTestId('portrait-canvas') }).and(page.locator(`[data-person="${person}"]`)).first();
  await portrait.scrollIntoViewIfNeeded(); await expect(portrait).toHaveAttribute('data-portrait-id', String(expected));
  const scale = Number(await portrait.getAttribute('data-pixel-scale')); await verifyPaintedCell(portrait.getByTestId('portrait-canvas'), expected, scale);
  const stageDraw = (await fixtureRead(page)).portraitDraws.filter(draw => draw.canvas === 'scene-picture-people').at(-1);
  if (stageDraw === undefined) throw Error('The actual stage portrait draw is missing');
  // Both approved stage frames cover the bottom two source rows with a real rail.
  // Verify every still-exposed source pixel; the separate people card proves the complete cell.
  expect(stageDraw.id).toBe(expected); await verifyPaintedCell(page.getByTestId('scene-picture-people').first(), stageDraw.id, stageDraw.scale, stageDraw.x, stageDraw.y, PORTRAIT_CELL - 2);
}
async function verifyTraitRows(page: Page, base: Record<(typeof TRAITS)[number], number>, changed: Partial<Record<(typeof TRAITS)[number], number>>, price: string): Promise<void> {
  const table = page.getByTestId('customization-preview');
  expect(await table.locator('[data-trait]').evaluateAll(elements => elements.map(element => element.getAttribute('data-trait')))).toEqual([...TRAITS]);
  for (const trait of TRAITS) expect(await table.locator(`[data-trait="${trait}"]`).locator('td').allTextContents()).toEqual([String(base[trait]), String(changed[trait] ?? base[trait])]);
  await expect(page.getByTestId('customization-price')).toHaveAttribute('data-amount', price);
}
function decodeDisplayedAmount(text: string): string {
  const amount = BigInt(text.replaceAll(',', ''));
  expect(text, 'Displayed amounts retain exact decimal digits and grouping').toBe(amount.toLocaleString('en-US'));
  return amount.toString();
}
function decodeDisplayedDate(text: string): string {
  const match = /^Year (-?\d+), Day (\d+)( — Halloween)?$/.exec(text);
  if (match === null) throw Error(`Unrecognized displayed date: ${text}`);
  const day = BigInt(match[2]!);
  expect(day).toBeGreaterThanOrEqual(1n); expect(day).toBeLessThanOrEqual(365n);
  expect(match[3] !== undefined).toBe(day === 1n);
  return ((BigInt(match[1]!) - 1n) * 365n + day - 1n).toString();
}
function decodeNeeded(text: string): Needed {
  const opening = /^Opens (.+)\.$/.exec(text);
  if (opening !== null) return { kind: 'wait_until', tick: decodeDisplayedDate(opening[1]!) };
  const joss = /^You are ([\d,]+) joss paper short\.$/.exec(text);
  if (joss !== null) return { kind: 'joss_short', amount: decodeDisplayedAmount(joss[1]!) };
  const cap = /^Your yearly allowance is ([\d,]+) short\.$/.exec(text);
  if (cap !== null) return { kind: 'cap_room_short', amount: decodeDisplayedAmount(cap[1]!) };
  // Decode the six actual named conditions in the constructed stress carrier,
  // independently of the renderer's expected-copy function.
  const named: Record<string, string> = {
    "That isn't a personality we can build.": 'bad_customization',
    'Adjustments are for rebuilt bodies only.': 'customization_not_allowed',
    'That opening has closed.': 'slot_closed',
    'That one is already yours.': 'claimed_by_you',
    "One opening per soul. You're holding one.": 'claim_held',
    "The town's books are full.": 'id_exhausted',
  };
  const name = named[text];
  if (name === undefined) throw Error(`Unrecognized displayed requirement: ${text}`);
  return { kind: 'named', name };
}

for (const viewport of [{ width: 640, height: 360 }, { width: 512, height: 320 }]) {
  test(`COMPONENT-ONLY full Waiting targets, traits, slots and raw archive at ${viewport.width}px`, async ({ page }, info) => {
    const network = await offline(page); const original = await componentOpen(page, 'waiting-large', viewport); const world = original.ui.world!; const view = world.underworld_view!;
    await openDesk(page); await verifyPeople(page, original); await verifyFixturePortraits(page, original);
    expect(await page.getByTestId('dream-targets').getByRole('radio').evaluateAll(elements => elements.map(element => Number((element as HTMLInputElement).value)))).toEqual(view.connected);
    expect(await page.getByTestId('haunt-targets').getByRole('radio').evaluateAll(elements => elements.map(element => Number((element as HTMLInputElement).value)))).toEqual(view.actions.haunt.targets.map(target => target.target));
    for (const [id, value] of [['joss-balance', MAX_U64], ['dream-price', ABOVE_SAFE], ['haunt-price', ABOVE_SAFE]] as const) { await expect(page.getByTestId(id)).toHaveAttribute('data-amount', value); await expect(page.getByTestId(id)).toContainText(formatAmount(value)); }
    await expect(page.getByTestId('capped-spend')).toHaveAttribute('data-remaining', view.actions.capped_spend.remaining); await expect(page.getByTestId('capped-spend')).toHaveAttribute('data-cap', view.actions.capped_spend.yearly_cap);
    await expect(page.getByTestId('capped-spend')).toContainText(formatAmount(view.actions.capped_spend.remaining)); await expect(page.getByTestId('capped-spend')).toContainText(formatAmount(view.actions.capped_spend.yearly_cap));
    const beforeLocal = (await fixtureRead(page)).callbacks;
    await disclosure(page, 'town-disclosure', true); await disclosure(page, 'town-disclosure', false); await page.getByTestId('people-files').getByRole('img').first().click();
    expect((await fixtureRead(page)).callbacks).toEqual(beforeLocal);
    const carry = page.getByTestId('carry-over'); expect(await carry.locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    for (const trait of TRAITS) await expect(carry.locator(`option[value="${trait}"]`)).toContainText(String(view.ghost_traits[trait]));
    for (const value of ['', ...TRAITS]) { await carry.selectOption(value); expect((await fixtureRead(page)).ui.underworldForm.carryOver).toBe(value || null); }
    await page.getByTestId('customize').click(); await expect(page.getByTestId('claim-rebuilt_body')).toBeDisabled();
    expect(await page.getByTestId('customization-trait').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    expect(await page.getByTestId('customization-value').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', '-3', '-2', '-1', '0', '1', '2', '3']);
    const price = view.slots.find(slot => slot.slot === 'rebuilt_body')!.price;
    await carry.selectOption(''); await page.getByTestId('customization-trait').selectOption('greed'); await page.getByTestId('customization-value').selectOption('-3'); await verifyTraitRows(page, view.base_traits.find(entry => entry.carry_over === null)!.traits, { greed: -3 }, price);
    for (const [index, trait] of TRAITS.entries()) {
      await carry.selectOption(trait); await page.getByTestId('customization-trait').selectOption(trait); await page.getByTestId('customization-value').selectOption(String(index - 3));
      await verifyTraitRows(page, view.base_traits.find(entry => entry.carry_over === trait)!.traits, { [trait]: index - 3 }, price); await page.getByTestId('claim-rebuilt_body').click();
      expect((await fixtureRead(page)).callbacks.at(-1)).toMatchObject({ kind: 'claim', worldId: original.ui.worldId, slot: 'rebuilt_body', request: { type: 'claim', slot: 'rebuilt_body', carryOver: trait, customization: { Set: { trait_name: trait, value: index - 3 } } } });
    }
    await page.getByTestId('customization-kind').selectOption('Adjust');
    for (const id of ['customization-first', 'customization-second']) expect(await page.getByTestId(id).locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', ...TRAITS]);
    for (const id of ['customization-first-delta', 'customization-second-delta']) expect(await page.getByTestId(id).locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value))).toEqual(['', '1', '-1']);
    await page.getByTestId('customization-first').selectOption('greed'); await page.getByTestId('customization-first-delta').selectOption('1'); await page.getByTestId('customization-second').selectOption('greed'); await page.getByTestId('customization-second-delta').selectOption('-1'); await expect(page.getByTestId('claim-rebuilt_body')).toBeDisabled();
    const base = view.base_traits.find(entry => entry.carry_over === 'piety')!.traits;
    for (const [index, first] of TRAITS.entries()) {
      const second = TRAITS[(index + 1) % TRAITS.length]!; await page.getByTestId('customization-first').selectOption(first); await page.getByTestId('customization-second').selectOption(second);
      await verifyTraitRows(page, base, { [first]: Math.min(3, base[first] + 1), [second]: Math.max(-3, base[second] - 1) }, price); await page.getByTestId('claim-rebuilt_body').click();
      expect((await fixtureRead(page)).callbacks.at(-1)).toMatchObject({ kind: 'claim', request: { customization: { Adjust: { first: { trait_name: first, delta: 1 }, second: { trait_name: second, delta: -1 } } } } });
    }
    await page.getByTestId('customization-cancel').click();
    expect(await page.locator('[data-testid^="slot-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(view.slots.map(slot => `slot-${slot.slot}`));
    for (const slot of view.slots) {
      const row = page.getByTestId(`slot-${slot.slot}`); const priceRow = row.locator('[data-price]');
      await expect(priceRow).toHaveAttribute('data-price', slot.price);
      const displayed = /^([\d,]+) joss paper(?: · (.+))?$/.exec(await priceRow.innerText());
      if (displayed === null) throw Error(`Slot ${slot.slot} has no complete displayed price/date`);
      expect(decodeDisplayedAmount(displayed[1]!)).toBe(slot.price);
      expect(displayed[2] === undefined ? null : decodeDisplayedDate(displayed[2])).toBe(slot.birth);
      expect(slot.kind).toBe(slot.slot.startsWith('birth:') ? 'birth_slot' : slot.slot);
      const birth = world.birth_slots.find(birth => `birth:${birth.id}` === slot.slot);
      const household = world.households.find(home => home.id === birth?.household);
      const name = slot.kind === 'birth_slot' ? household!.members.map(person => personName(world, person)).join(', ')
        : slot.kind === 'imported_vessel' ? 'Borrow a body' : 'Build a body';
      await expect(row.locator('strong')).toHaveText(name);
      const needed = row.getByRole('list', { name: 'Application requirements', exact: true }).getByRole('listitem');
      await expect(needed).toHaveCount(slot.status.needed.length);
      for (const [index, requirement] of slot.status.needed.entries()) expect(decodeNeeded(await needed.nth(index).innerText())).toEqual(requirement);
      const button = page.getByTestId(`claim-${slot.slot}`);
      // Rebuilt orders were exercised above for every Set/Adjust trait. Without
      // a completed order this path is genuinely unavailable after cancellation.
      if (!slot.status.claimable || slot.slot === 'rebuilt_body') { await expect(button).toBeDisabled(); continue; }
      const beforeClaim = (await fixtureRead(page)).callbacks.length; await button.focus(); await page.keyboard.press('Enter');
      const afterClaim = await fixtureRead(page); expect(afterClaim.callbacks).toHaveLength(beforeClaim + 1);
      expect(afterClaim.callbacks.at(-1)).toMatchObject({ kind: 'claim', worldId: original.ui.worldId, slot: slot.slot });
      expect(afterClaim.callbacks.at(-1)!.request).toEqual({ type: 'claim', slot: slot.slot, carryOver: 'piety' });
    }
    for (const amount of [ABOVE_SAFE, MAX_U64, '0']) { await page.getByTestId('bribe-amount').fill(amount); await page.getByTestId('bribe-send').click(); expect((await fixtureRead(page)).callbacks.at(-1)).toEqual({ kind: 'bribe', worldId: original.ui.worldId, amount }); }
    const beforeInvalid = (await fixtureRead(page)).callbacks.length;
    for (const amount of ['', '01', ' 1', '1 ', '+1', '-1', '1e3', '1.0', '18446744073709551616', '９']) { await page.getByTestId('bribe-amount').fill(amount); await expect(page.getByTestId('bribe-send')).toBeDisabled(); await expect(page.getByTestId('bribe-amount')).toHaveAttribute('aria-invalid', String(amount !== '')); await page.getByTestId('bribe-amount').press('Enter'); }
    expect((await fixtureRead(page)).callbacks.length).toBe(beforeInvalid);
    for (const [index, target] of view.actions.haunt.targets.entries()) {
      const radio = page.getByTestId(`haunt-target-${target.target}`);
      const name = personName(world, target.target);
      await expect(radio).toHaveAccessibleName(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await expect(page.getByTestId('haunt-targets').getByTestId('portrait').and(page.locator(`[data-person="${target.target}"]`))).toHaveAccessibleName(name);
      if (index === 0) { await radio.focus(); await page.keyboard.press('Space'); }
      else { await page.getByTestId(`haunt-target-${view.actions.haunt.targets[index - 1]!.target}`).focus(); await page.keyboard.press('ArrowDown'); }
      await expect(radio).toBeFocused(); await expect(radio).toBeChecked(); await page.getByTestId('haunt-send').click(); expect((await fixtureRead(page)).callbacks.at(-1)).toEqual({ kind: 'haunt', worldId: original.ui.worldId, target: target.target });
    }
    await page.getByTestId('dream-intent-urge').click();
    for (const [index, person] of view.connected.entries()) {
      const radio = page.getByTestId(`dream-target-${person}`);
      const name = personName(world, person);
      await expect(radio).toHaveAccessibleName(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await expect(page.getByTestId('dream-targets').getByTestId('portrait').and(page.locator(`[data-person="${person}"]`))).toHaveAccessibleName(name);
      if (index === 0) { await radio.focus(); await page.keyboard.press('Space'); }
      else { await page.getByTestId(`dream-target-${view.connected[index - 1]!}`).focus(); await page.keyboard.press('ArrowDown'); }
      await expect(radio).toBeFocused(); await expect(radio).toBeChecked(); expect((await fixtureRead(page)).ui.underworldForm.dreamer).toBe(person); await page.getByTestId('dream-send').click(); expect((await fixtureRead(page)).callbacks.at(-1)).toMatchObject({ kind: 'dream', request: { type: 'dream', dreamer: person, intent: 'urge' } });
    }
    await page.getByTestId('bribe-amount').fill('1'); await page.getByTestId('bribe-amount').focus(); await page.keyboard.press('Tab'); await expect(page.getByTestId('bribe-send')).toBeFocused();
    await disclosure(page, 'fixture-records', true); const archive = await archiveDownload(page, () => page.getByTestId('fixture-export-facts').click()); expect(archive).toEqual(original.ui.notebook); verifyArchive(archive, world); expect(Object.keys(archive.chronicle)).toHaveLength(100);
    expect(JSON.stringify(archive)).toContain(MIN_I64); expect(JSON.stringify(archive)).toContain(MAX_I64);
    const final = await fixtureRead(page); expect(final.ui.world).toEqual(world); expect(final.ui.tick).toBe(original.ui.tick); await noHorizontalOverflow(page); await capture(page, info, `lu-p1-component-${viewport.width}-waiting`, { mode: 'COMPONENT-ONLY', equivalentZoom: 200, fixture: final, archive }); network.finish();
  });
  test(`COMPONENT-ONLY every choice Preview unit, person and option at ${viewport.width}px`, async ({ page }, info) => {
    const network = await offline(page); const original = await componentOpen(page, 'choice-large', viewport); const world = original.ui.world!;
    await verifyChoice(page, world); await verifyPeople(page, original); await verifyFixturePortraits(page, original);
    for (const option of world.player_node!.options) { const last = page.getByTestId(`option-preview-${option.id}`).locator('[data-person]').last(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport(); await page.getByTestId(`option-${option.id}`).focus(); await page.keyboard.press('Enter'); expect((await fixtureRead(page)).callbacks.at(-1)).toEqual({ kind: 'choose', worldId: original.ui.worldId, node: world.player_node!.id, option: option.id }); }
    await disclosure(page, 'fixture-records', true); const archive = await archiveDownload(page, () => page.getByTestId('fixture-export-facts').click()); expect(archive).toEqual(original.ui.notebook); verifyArchive(archive, world);
    const final = await fixtureRead(page); expect(final.ui).toEqual(original.ui); await noHorizontalOverflow(page); await capture(page, info, `lu-p1-component-${viewport.width}-choice`, { mode: 'COMPONENT-ONLY', equivalentZoom: 200, fixture: final, archive }); network.finish();
  });
}

test('COMPONENT-ONLY target selection invalidates removed/ineligible targets and generation, not an unchanged tick advance', async ({ page }, info) => {
  const network = await offline(page); await componentOpen(page, 'waiting', { width: 1024, height: 640 });
  const initial = await fixtureRead(page); const first = initial.ui.world!.underworld_view!.actions.haunt.targets[0]!.target;
  const second = initial.ui.world!.underworld_view!.actions.haunt.targets[1]!.target;
  await openDesk(page);
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
  expect(final.ui.notebook.worldId).toBe(final.ui.worldId);
  await capture(page, info, 'lu-p1-component-selection-invalidation', { mode: 'COMPONENT-ONLY', fixture: final, transitions: ['unchanged eligible + tick retains selection', 'ineligible then restored stays unselected', 'removed then restored stays unselected', 'new generation clears target and amount'], limits: 'Explicit constructed prop changes, not natural Worker/Core events.' });
  network.finish();
});

test('COMPONENT-ONLY unchanged ticks retain scene pixels while the closed map does not repaint', async ({ page }) => {
  const network = await offline(page);
  await page.addInitScript(() => {
    const paint = { counts: new WeakMap<HTMLCanvasElement, number>(), total: 0 }; const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
      original.call(this, x, y, width, height); paint.counts.set(this.canvas, (paint.counts.get(this.canvas) ?? 0) + 1); paint.total += 1;
    }; window.__lifeViewPaint = paint;
  });
  const initial = await componentOpen(page, 'waiting', { width: 1024, height: 640 }); const primary = page.getByTestId('scene-picture-canvas');
  const picture = () => primary.evaluate(element => ({ picture: (element as HTMLCanvasElement).toDataURL(), clears: window.__lifeViewPaint!.counts.get(element as HTMLCanvasElement) })); const initialPaint = await picture();
  await disclosure(page, 'fixture-carrier-controls', true); await page.getByTestId('fixture-advance').click(); expect((await fixtureRead(page)).ui.world).toEqual({ ...initial.ui.world!, tick: String(BigInt(initial.ui.tick!) + 1n) }); expect(await picture()).toEqual(initialPaint);
  await disclosure(page, 'town-disclosure', true); await expect(page.getByTestId('town-view')).toBeVisible();
  const town = await page.getByTestId('town-view').elementHandle(); if (town === null) throw Error('Opened real town canvas is missing');
  const townClears = await town.evaluate(element => window.__lifeViewPaint!.counts.get(element as HTMLCanvasElement)); expect(townClears).toBeGreaterThan(0);
  await disclosure(page, 'town-disclosure', false); await page.getByTestId('fixture-advance').click(); expect(await town.evaluate(element => window.__lifeViewPaint!.counts.get(element as HTMLCanvasElement))).toBe(townClears); expect(await picture()).toEqual(initialPaint); network.finish();
});

