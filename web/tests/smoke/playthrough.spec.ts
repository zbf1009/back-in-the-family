// One real-control recorded-prefix proof explicitly selects Fast; it is not default-Life play.
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Reply, RequestTicket, WorkerMessage, PauseReason } from '../../src/shared/protocol.ts';
import type { PlayerLifecycleFact, TraitName, WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { DECISION_CONFIG_VERSION } from '../../src/shared/decision.ts';
import { traitLabel } from '../../src/main/player-copy.ts';
import type { LifeNotebookExport } from '../../src/main/life-journal.ts';
import type { DreamFact, StoryBatch } from '../../src/shared/story.ts';

const FIXTURE = 'seedP-playthrough.replay.json';
const SMOKE_EVIDENCE = new URL('../../../target/life-unfolds/lu-p1-smoke/', import.meta.url);
interface Input {
  tick: string;
  payload: {
    ChoosePlayer?: { node: string; option: string };
    Dream?: { dreamer: string; intent: string };
    CarryOver?: { trait_name: TraitName };
    ClaimSlot?: { slot: string };
  };
}
const fixture = JSON.parse(readFileSync(new URL(`../../../fixtures/parity/${FIXTURE}`, import.meta.url), 'utf8')) as {
  seed: string; config: unknown; ticks: string; inputs: Input[]; checksums: string[];
};
const stages = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seedP-playthrough.stages.json', import.meta.url), 'utf8')) as {
  last_tick: string; step_clicks: number; stages: { tick: string; reasons: PauseReason[] }[];
};
const B = 30_000 + Math.ceil(Number(stages.stages[0]!.tick) / 30) * 1000
  + Math.ceil((Number(stages.last_tick) - Number(stages.stages[0]!.tick)) / (30 * 365)) * 1000
  + 5000 * stages.stages.length + 100 * stages.step_clicks;
interface LongTask { startTime: number; duration: number }
interface Observer {
  observe(options: { type: string; buffered: boolean }): void;
  takeRecords(): LongTask[];
  disconnect(): void;
}
interface Observation {
  stops: { tick: string | null; reasons: PauseReason[] }[];
  lifecycle: { worldId: number; tick: string | null; facts: PlayerLifecycleFact[] }[];
  dreams: { worldId: number; fact: DreamFact; recipientName?: string }[];
  startedAt?: number;
  endedAt?: number;
  endStatusTick?: string;
  tasks: LongTask[];
  observer?: Observer;
}
// Node-only tsconfig: declare just the browser surface used by evaluate callbacks.
declare const window: {
  __simHarness?: { request(request: Record<string, unknown>): RequestTicket };
  __playthrough: Observation;
  Worker: new (url: string, options?: { type?: string }) => {
    addEventListener(type: 'message', listener: (event: { data: WorkerMessage }) => void): void;
  };
  performance: { now(): number };
};
declare const document: {
  querySelector(selector: string): {
    addEventListener(type: 'click', listener: () => void, options: { once: boolean; capture: boolean }): void;
  } | null;
};
declare const PerformanceObserver: new (callback: (list: { getEntries(): LongTask[] }) => void) => Observer;

async function request(page: Page, type: 'world-snapshot' | 'run' | 'checksums' | 'export-replay', extra: Record<string, unknown> = {}): Promise<Reply> {
  return page.evaluate(async (args) => {
    if (!window.__simHarness) throw new Error('test harness is missing');
    return window.__simHarness.request(args).reply;
  }, { type, ...extra });
}

async function revealControl(control: Locator): Promise<void> {
  await expect(control).toBeAttached();
  // XPath returns ancestors in document order: open outer disclosures first.
  const sections = control.locator('xpath=ancestor::details');
  for (let index = 0, count = await sections.count(); index < count; index++) {
    const section = sections.nth(index);
    if (await section.getAttribute('open') === null) await section.locator(':scope > summary').press('Enter');
    await expect(section).toHaveJSProperty('open', true);
  }
  await expect(control).toBeVisible();
}

async function downloadRetainedFacts(page: Page, world: WorldSnapshot, worldId: number): Promise<void> {
  const before = await request(page, 'world-snapshot');
  expect(before.ok).toBe(true);
  const replayBefore = await request(page, 'export-replay');
  if (!replayBefore.ok || replayBefore.replay === undefined) throw Error('Actual pre-download replay is missing');
  const beforeReplay: unknown = JSON.parse(replayBefore.replay);
  if (beforeReplay === null || typeof beforeReplay !== 'object' || !('inputs' in beforeReplay) || !Array.isArray(beforeReplay.inputs)) {
    throw Error('Actual pre-download replay has no input list');
  }
  const inputsBefore = beforeReplay.inputs;
  expect(world.player_wait?.ghost).toBeDefined();
  const ownDeath = await page.evaluate(({ worldId, ghost, tick }) => window.__playthrough.lifecycle
    .filter(report => report.worldId === worldId && report.tick === tick).flatMap(report => report.facts)
    .find(fact => fact.kind === 'death' && fact.body === ghost), { worldId, ghost: world.player_wait!.ghost, tick: world.tick });
  expect(ownDeath, 'the actual own-Death carrier must be available at this stop').toBeDefined();

  const downloadButton = page.getByRole('button', { name: 'Download life facts', exact: true, includeHidden: true });
  await revealControl(downloadButton);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  if (downloadedPath === null) throw Error('Actual life-facts download has no local file');
  const notebook: LifeNotebookExport = JSON.parse(await readFile(downloadedPath, 'utf8'));
  const native: { openingBatch: StoryBatch } = JSON.parse(readFileSync(new URL('../fixtures/journal-seed1205.json', import.meta.url), 'utf8'));
  const openingLoan = native.openingBatch.events.find(event => event.kind.type === 'loan')!;
  expect(openingLoan, 'the native fixture must supply the earliest opening loan').toBeDefined();
  expect(notebook.worldId).toBe(worldId);
  expect(notebook.events[openingLoan.id]).toEqual(openingLoan);
  expect(notebook.opening[`e:${openingLoan.id}`]).toBe(true);
  expect(notebook.identities).toContain(`e:${openingLoan.id}`);
  expect(notebook.events[ownDeath!.event]?.tick).toBe(ownDeath!.tick);
  expect(notebook.events[ownDeath!.event]?.kind).toEqual({ type: 'death', person: ownDeath!.body });
  expect(notebook.actors[ownDeath!.body]?.name).toBe(ownDeath!.name);
  expect(notebook.identities).toContain(`e:${ownDeath!.event}`);

  const town = page.getByRole('button', { name: 'Around town', exact: true });
  await town.click();
  await expect(town).toHaveAttribute('aria-pressed', 'true');
  const life = page.getByRole('button', { name: 'Your life', exact: true });
  await life.click();
  await expect(life).toHaveAttribute('aria-pressed', 'true');
  const after = await request(page, 'world-snapshot');
  expect(after.ok).toBe(true);
  expect(after.snapshot.tick).toBe(before.snapshot.tick);
  expect(after.snapshot.checksum).toBe(before.snapshot.checksum);
  expect(after.world?.tick).toBe(before.world?.tick);
  const replayAfter = await request(page, 'export-replay');
  if (!replayAfter.ok || replayAfter.replay === undefined) throw Error('Actual post-download replay is missing');
  const afterReplay: unknown = JSON.parse(replayAfter.replay);
  if (afterReplay === null || typeof afterReplay !== 'object' || !('inputs' in afterReplay) || !Array.isArray(afterReplay.inputs)) {
    throw Error('Actual post-download replay has no input list');
  }
  expect(afterReplay.inputs).toEqual(inputsBefore);
}


function personName(world: WorldSnapshot, id: number): string {
  const person = world.residents.find(person => person.id === id)
    ?? world.player.earlier_bodies.find(person => person.id === id)
    ?? world.person_names.find(person => person.id === id);
  expect(person, `${FIXTURE}: Snapshot must name person ${id}`).toBeDefined();
  return person!.name;
}

async function identityAndPreviews(page: Page, world: WorldSnapshot): Promise<void> {
  if (world.player.body !== null) {
    await expect(page.getByTestId('life-name')).toHaveText(personName(world, world.player.body));
    await expect(page.getByTestId('life-name')).toBeVisible();
  }
  if (world.player_node === null) return;
  for (const option of world.player_node.options) {
    await expect(page.getByTestId(`option-preview-${option.id}`)).toBeVisible();
    await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
  }
}

async function scene(page: Page, world: WorldSnapshot, _reasons: PauseReason[], worldId: number): Promise<void> {
  const keyScene = page.getByTestId('key-scene');
  if (await keyScene.count() > 0) {
    await expect(keyScene).toBeVisible();
    const identity = await keyScene.getAttribute('data-identity');
    const facts = await page.evaluate(worldId => window.__playthrough.lifecycle
      .filter(report => report.worldId === worldId).flatMap(report => report.facts), worldId);
    const fact = facts.find(fact => JSON.stringify([worldId, fact.event]) === identity);
    if (fact !== undefined) {
      await expect(keyScene).toContainText(fact.name);
      await expect(page.getByTestId('scene-close')).toBeEnabled();
      if (fact.kind === 'death' && world.player_wait?.ghost === fact.body) {
        const earlier = world.player.earlier_bodies.find(body => body.id === fact.body);
        expect(earlier?.death).toBe(fact.tick);
        expect(earlier?.name).toBe(fact.name);
        expect(world.player.place).toBe('waiting');
      }
    } else {
      const recordedDream = await page.evaluate(({ worldId, identity }) => window.__playthrough.dreams
        .find(report => report.worldId === worldId && JSON.stringify([worldId, report.fact.eventId]) === identity), { worldId, identity });
      if (recordedDream !== undefined) {
        expect(recordedDream.recipientName).toBeDefined();
        await expect(keyScene).toContainText(recordedDream.recipientName!);
        if (recordedDream.fact.interpretation !== undefined) {
          expect(recordedDream.fact.dreamer).toBe(world.last_dream?.dreamer);
          expect(recordedDream.fact.interpretation.applied).toBe(world.last_dream?.applied);
        }
        await expect(page.getByTestId('scene-close')).toBeEnabled();
      } else if (world.last_dream !== undefined && identity === JSON.stringify([worldId, 'dream', world.last_dream.tick])) {
        await expect(keyScene).toContainText(personName(world, world.last_dream.dreamer));
        await expect(page.getByTestId('scene-close')).toBeEnabled();
      } else {
        expect(world.player_node, 'a node scene must identify the current real choice').not.toBeNull();
        expect(identity).toBe(JSON.stringify([worldId, world.player_soul, world.player_node!.id]));
      }
    }
  }
  // Current choices remain usable independently of any retained historical performance.
  if (world.player_node !== null) {
    for (const option of world.player_node.options) await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
  }
}

async function customization(page: Page, world: WorldSnapshot): Promise<void> {
  const before = { tick: await page.getByTestId('tick').innerText(), checksum: await page.getByTestId('checksum').innerText() };
  await revealControl(page.getByTestId('carry-over'));
  const selected = await page.getByTestId('carry-over').inputValue();
  const base = world.underworld_view?.base_traits.find(entry => entry.carry_over === (selected || null))?.traits;
  expect(base, `Snapshot base_traits must include the selected Carry_Over ${selected || 'None'}`).toBeDefined();
  const traits = Object.keys(base!) as TraitName[];
  const first = traits.find(trait => base![trait] < 3);
  const second = traits.find(trait => trait !== first && base![trait] > -3);
  expect(first, 'fixture must permit an unclamped +1').toBeDefined();
  expect(second, 'fixture must permit a distinct unclamped -1').toBeDefined();
  expect(base![first!] + 1).toBeLessThanOrEqual(3);
  expect(base![second!] - 1).toBeGreaterThanOrEqual(-3);
  const price = world.underworld_view!.slots.find(slot => slot.slot === 'rebuilt_body')?.price;
  expect(price, 'Snapshot must give the Rebuilt_Body price').toBeDefined();
  await revealControl(page.getByTestId('customize'));
  await page.getByTestId('customize').click();
  await page.getByTestId('customization-kind').selectOption('Adjust');
  await page.getByTestId('customization-first').selectOption(first!);
  await page.getByTestId('customization-first-delta').selectOption('1');
  await page.getByTestId('customization-second').selectOption(second!);
  await page.getByTestId('customization-second-delta').selectOption('-1');
  await expect(page.getByTestId('customization-first')).toHaveValue(first!);
  await expect(page.getByTestId('customization-second')).toHaveValue(second!);
  await expect(page.getByTestId('customization-first-delta')).toHaveValue('1');
  await expect(page.getByTestId('customization-second-delta')).toHaveValue('-1');
  const preview = page.getByTestId('customization-preview');
  await expect(preview).toBeVisible();
  // Numeric preview facts are independent of its explanatory caption.
  const firstRow = preview.getByRole('row').filter({ has: page.getByRole('rowheader', { name: traitLabel(first!), exact: true }) });
  const secondRow = preview.getByRole('row').filter({ has: page.getByRole('rowheader', { name: traitLabel(second!), exact: true }) });
  expect(await firstRow.getByRole('cell').allTextContents()).toEqual([String(base![first!]), String(base![first!] + 1)]);
  expect(await secondRow.getByRole('cell').allTextContents()).toEqual([String(base![second!]), String(base![second!] - 1)]);
  await page.getByTestId('customization-cancel').click();
  await expect(page.getByTestId('underworld-error')).toHaveCount(0);
  await expect(page.getByTestId('customization-panel')).toHaveCount(0);
  await expect(page.getByTestId('tick')).toHaveText(before.tick);
  await expect(page.getByTestId('checksum')).toHaveText(before.checksum);
  console.log(`[playthrough] customization cancelled: tick=${before.tick} checksum=${before.checksum} unchanged; ${first}=${base![first!]}+1 ${second}=${base![second!]}-1 price=${price}`);
}

test(`${FIXTURE}: explicit Fast recorded-prefix controls play choices, death, Dream and rebirth`, async ({ page, baseURL }, testInfo) => {
  await mkdir(SMOKE_EVIDENCE, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  test.setTimeout(B);
  expect(stages.last_tick).toBe(fixture.ticks);
  expect(fixture.checksums).toHaveLength(Number(stages.last_tick));
  const offOrigin: string[] = [];
  const errors: string[] = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (new URL(url).origin === new URL(baseURL!).origin && new URL(url).pathname === '/api/decision/config') {
      await route.fulfill({ json: { version: DECISION_CONFIG_VERSION, enabled: false, session_cap: 40 } }); return;
    }
    if (url.startsWith('data:') || url.startsWith('blob:') || new URL(url).origin === new URL(baseURL!).origin) await route.continue();
    else { offOrigin.push(url); await route.abort(); }
  });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  // Read-only observation seam authorized for Pause_Reasons: world-snapshot
  // replies do not retain stop, and the page has no Pause_Reason test identifier.
  // No World/UI state is changed and no Worker request is injected here.
  await page.addInitScript(({ lastTick }) => {
    window.__playthrough = { stops: [], lifecycle: [], dreams: [], tasks: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string, options?: { type?: string }) {
        super(url, options);
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'status') return;
          const observation = window.__playthrough;
          const now = window.performance.now();
          if (data.snapshot.playerLifecycle.length > 0) {
            observation.lifecycle.push({ worldId: data.snapshot.worldId, tick: data.snapshot.tick, facts: data.snapshot.playerLifecycle });
          }
          for (const delivery of data.snapshot.story ?? []) {
            for (const fact of delivery.batch.dreams) observation.dreams.push({ worldId: delivery.worldId, fact,
              recipientName: delivery.batch.actors.find(actor => actor.person === fact.dreamer)?.name });
          }
          if (data.snapshot.stop) {
            observation.stops.push({ tick: data.snapshot.tick, reasons: data.snapshot.stop.reasons });
          }
          if (observation.endedAt === undefined && observation.startedAt !== undefined
            && data.snapshot.tick !== null && BigInt(data.snapshot.tick) >= BigInt(lastTick)) {
            observation.endedAt = now;
            observation.endStatusTick = data.snapshot.tick;
          }
        });
      }
    };
  }, { lastTick: stages.last_tick });
  await page.goto('/?harness=1');
  await page.waitForFunction(() => window.__simHarness !== undefined);
  const technical = page.getByTestId('technical-details');
  if (await technical.getAttribute('open') === null) await technical.locator(':scope > summary').click();
  const setup = page.getByTestId('world-setup');
  if (await setup.getAttribute('open') === null) await setup.locator(':scope > summary').click();
  await page.getByTestId('seed').fill(fixture.seed);
  await page.getByTestId('town-size').fill('50');
  await page.getByTestId('create').click();
  await expect(page.getByTestId('tick')).toHaveText('0');
  await page.getByTestId('speed').selectOption('1');
  await page.evaluate(() => {
    const observation = window.__playthrough;
    const observer = new PerformanceObserver(list => observation.tasks.push(...list.getEntries()));
    observation.observer = observer;
    observer.observe({ type: 'longtask', buffered: false });
    observation.startedAt = window.performance.now();
  });
  await page.getByTestId('run').click();
  let consumed = 0;
  for (const [index, stage] of stages.stages.entries()) {
    await test.step(`${FIXTURE}: stage ${index + 1} ${stage.reasons.join('+')} tick ${stage.tick}`, async () => {
      await expect(page.getByTestId('tick')).toHaveText(stage.tick, { timeout: B });
      await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
      const observed = await page.evaluate(() => window.__playthrough.stops);
      expect(observed).toEqual(stages.stages.slice(0, index + 1));
      const reply = await request(page, 'world-snapshot');
      expect(reply.ok, 'stage World Snapshot request succeeds').toBe(true);
      expect(reply.snapshot.tick).toBe(stage.tick);
      expect(reply.world?.tick).toBe(stage.tick);
      expect(reply.snapshot.speed).toBe(index === 0 ? 1 : 365);
      const world = reply.world!;
      const expectedChecksum = fixture.checksums[Number(stage.tick) - 1]!;
      const displayedChecksum = await page.getByTestId('checksum').innerText();
      console.log(`[playthrough] stage=${index + 1} reasons=${stage.reasons.join('+')} tick=${stage.tick} expected=${expectedChecksum} actual=${reply.snapshot.checksum} match=${reply.snapshot.checksum === expectedChecksum}`);
      if (displayedChecksum !== expectedChecksum || reply.snapshot.checksum !== expectedChecksum) {
        const prefix = await request(page, 'checksums', { from: '0', to: String(Number(stage.tick) - 1) });
        if (prefix.ok) {
          for (const [tickIndex, expected] of fixture.checksums.slice(0, Number(stage.tick)).entries()) {
            const actual = prefix.checksums?.[tickIndex];
            if (actual !== expected) {
              throw new Error(`${FIXTURE}: first differing tick ${tickIndex + 1}: expected ${expected}, actual ${actual ?? 'missing'}`);
            }
          }
        }
        throw new Error(`${FIXTURE}: stage tick ${stage.tick} checksum mismatch: expected ${expectedChecksum}, Snapshot ${reply.snapshot.checksum}, page ${displayedChecksum}`);
      }
      await scene(page, world, stage.reasons, reply.snapshot.worldId);
      // Close any non-node overlays in front of the options through real Close.
      if (index === 0) {
        while (await page.getByTestId('scene-close').isVisible()) await page.getByTestId('scene-close').press('Enter');
      }
      await identityAndPreviews(page, world);
      if (index === 0) {
        expect(BigInt(stage.tick)).toBeGreaterThanOrEqual(600n);
        expect(BigInt(stage.tick)).toBeLessThanOrEqual(900n);
        const refused = await request(page, 'run'); // Exactly one direct run; no harness input.
        expect(refused.ok).toBe(false);
        if (refused.ok) throw new Error(`${FIXTURE}: first player_node run unexpectedly succeeded`);
        expect(refused.kind).toBe('node_unanswered');
        expect(refused.snapshot.tick).toBe(stage.tick);
        expect(refused.snapshot.checksum).toBe(expectedChecksum);
        await expect(page.getByTestId('tick')).toHaveText(stage.tick);
        await expect(page.getByTestId('checksum')).toHaveText(expectedChecksum);
        console.log(`[playthrough] direct run refused=node_unanswered tick=${stage.tick} checksum=${expectedChecksum} unchanged`);
        await page.getByTestId('speed').selectOption('365');
        await expect(page.getByTestId('speed')).toHaveValue('365');
      }
      if (world.player_node !== null) {
        await expect(page.getByTestId('run')).toBeDisabled();
        await expect(page.getByTestId('step')).toBeDisabled();
        const input = fixture.inputs[consumed++]!;
        expect(input.tick).toBe(stage.tick);
        expect(input.payload.ChoosePlayer?.node).toBe(world.player_node.id);
        expect(world.player_node.choice_tick).toBe(input.tick);
        expect(world.player_node.options.map(option => option.id)).toContain(input.payload.ChoosePlayer?.option);
        const option = page.getByTestId(`option-${input.payload.ChoosePlayer!.option}`);
        await expect(option).toBeEnabled();
        await option.click();
        await revealControl(page.locator('[data-testid="operation-receipt"][data-kind="choose"][data-phase="received"]').first());
      }
      if (stage.reasons.includes('player_died')) {
        await downloadRetainedFacts(page, world, reply.snapshot.worldId);
        await expect(page.getByTestId('scene-close')).toBeVisible();
        await page.getByTestId('scene-close').press('Enter');
        await customization(page, world);
        const input = fixture.inputs[consumed++]!;
        expect(input.tick).toBe(stage.tick);
        expect(input.payload.Dream).toBeDefined();
        await revealControl(page.getByTestId(`dream-target-${input.payload.Dream!.dreamer}`));
        await page.getByTestId(`dream-target-${input.payload.Dream!.dreamer}`).check();
        await page.getByTestId(`dream-intent-${input.payload.Dream!.intent}`).click();
        await expect(page.getByTestId(`dream-target-${input.payload.Dream!.dreamer}`)).toBeChecked();
        await expect(page.getByTestId(`dream-intent-${input.payload.Dream!.intent}`)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('dream-send')).toBeEnabled();
        await page.getByTestId('dream-send').click();
        await revealControl(page.locator('[data-testid="operation-receipt"][data-kind="dream"][data-phase="received"]').first());
      }
      if (stage.reasons.includes('dream_resolved')) {
        let claimWorld = world;
        if (stages.step_clicks > 0) await test.step('test advance method: Step to claim tick', async () => {
          for (let n = 0; n < stages.step_clicks; n++) {
            const tick = String(Number(stage.tick) + n + 1);
            await page.getByTestId('step').click();
            await expect(page.getByTestId('tick')).toHaveText(tick);
          }
          const stepped = await request(page, 'world-snapshot');
          expect(stepped.ok, 'fallback claim Snapshot request succeeds').toBe(true);
          if (stepped.ok) claimWorld = stepped.world!;
        });
        const carry = fixture.inputs[consumed++]!;
        const claim = fixture.inputs[consumed++]!;
        expect(carry.tick).toBe(String(Number(stage.tick) + stages.step_clicks));
        expect(claim.tick).toBe(carry.tick);
        expect(carry.payload.CarryOver).toBeDefined();
        expect(claim.payload.ClaimSlot?.slot).toBe('ImportedVessel');
        const slot = claimWorld.underworld_view?.slots.find(slot => slot.slot === 'imported_vessel');
        expect(slot?.status.claimable).toBe(true);
        expect(slot?.status.affordable).toBe(true);
        await revealControl(page.getByTestId('carry-over'));
        await page.getByTestId('carry-over').selectOption(carry.payload.CarryOver!.trait_name);
        await expect(page.getByTestId('carry-over')).toHaveValue(carry.payload.CarryOver!.trait_name);
        await revealControl(page.getByTestId('claim-imported_vessel'));
        await expect(page.getByTestId('claim-imported_vessel')).toBeEnabled();
        await page.getByTestId('claim-imported_vessel').click();
        await revealControl(page.locator('[data-testid="operation-receipt"][data-kind="claim"][data-phase="received"]').first());
      }
      await expect(page.getByTestId('run')).toBeEnabled();
      await page.getByTestId('run').click();
    });
  }
  expect(consumed).toBe(fixture.inputs.length);
  // last_tick is a checksum-prefix endpoint, NOT an invented automatic stop.
  // Run past rebirth; stop observing at the first real status reaching that prefix.
  await page.waitForFunction(() => window.__playthrough.endedAt !== undefined, undefined, { timeout: B });
  await test.step('Pause beyond the checksum-prefix endpoint, unless native play has already stopped', async () => {
    const pause = page.getByTestId('pause');
    const runState = page.getByTestId('technical-run-state');
    // Keyboard activation avoids click's scrolling/actionability race. If a
    // native stop disables Pause first, the button does not activate; the
    // actual paused state below, not successful Pause submission, is required.
    if (await pause.isEnabled()) await pause.press('Enter');
    await expect(runState).toHaveText('paused');
    expect(BigInt(await page.getByTestId('tick').innerText())).toBeGreaterThanOrEqual(BigInt(stages.last_tick));
  });
  const stopsThroughEndpoint = await page.evaluate((lastTick) => window.__playthrough.stops.filter(
    stop => stop.tick !== null && BigInt(stop.tick) <= BigInt(lastTick),
  ), stages.last_tick);
  expect(stopsThroughEndpoint).toEqual(stages.stages);
  const measurement = await page.evaluate(() => {
    const observation = window.__playthrough;
    observation.tasks.push(...(observation.observer?.takeRecords() ?? []));
    observation.observer?.disconnect();
    const tasks = observation.tasks.filter(task => task.startTime >= observation.startedAt! && task.startTime <= observation.endedAt!);
    return { count: tasks.length, max: Math.max(0, ...tasks.map(task => task.duration)), endStatusTick: observation.endStatusTick };
  });
  // Report-only, before the checksum-history request; no assertion on these values.
  await testInfo.attach('long-task-count', { body: String(measurement.count), contentType: 'text/plain' });
  await testInfo.attach('longest-main-task-ms', { body: String(measurement.max), contentType: 'text/plain' });
  console.log(`[playthrough] long-task-count=${measurement.count} longest-main-task-ms=${measurement.max} endpoint=${stages.last_tick} first-reaching-status-tick=${measurement.endStatusTick} actual-final-pause-tick=${await page.getByTestId('tick').innerText()} (status-batch window may exceed prefix; report only)`);
  // History index 0 is the checksum of completed tick 1; bounds are inclusive.
  const history = await request(page, 'checksums', { from: '0', to: String(Number(stages.last_tick) - 1) });
  expect(history.ok).toBe(true);
  if (!history.ok) throw new Error(`${FIXTURE}: final checksum request failed: ${history.error}`);
  expect(history.checksums).toHaveLength(fixture.checksums.length);
  for (const [index, expected] of fixture.checksums.entries()) {
    const actual = history.checksums![index];
    expect(actual, `${FIXTURE}: final stage, first differing tick ${index + 1}: expected ${expected}, actual ${actual ?? 'missing'}`).toBe(expected);
  }
  console.log(`[playthrough] comparedChecksums=${fixture.checksums.length} ticks=1..${stages.last_tick} match=true`);
  const exported = await request(page, 'export-replay');
  if (!exported.ok || exported.replay === undefined) throw Error('Actual completed live playthrough export is missing');
  const live = JSON.parse(exported.replay) as { inputs: Input[]; checksums: string[] };
  expect(live.inputs.map(input => ({ tick: input.tick, payload: input.payload }))).toEqual(fixture.inputs.map(input => ({ tick: input.tick, payload: input.payload })));
  expect(live.checksums.slice(0, fixture.checksums.length)).toEqual(fixture.checksums);
  const replayPath = fileURLToPath(new URL('playthrough.replay.json', SMOKE_EVIDENCE));
  await writeFile(replayPath, exported.replay);
  await testInfo.attach('real-controls-playthrough-v5', { path: replayPath, contentType: 'application/json' });
  expect(offOrigin, 'off-preview requests').toEqual([]);
  expect(errors, 'page console/errors').toEqual([]);
});
