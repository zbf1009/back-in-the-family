// Task 14.1: one real-control playthrough; the harness never submits an input.
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { Reply, WorkerMessage, PauseReason } from '../../src/shared/protocol.ts';
import type { TraitName, WorldSnapshot } from '../../src/shared/world-snapshot.ts';

const FIXTURE = 'seedP-playthrough.replay.json';
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
const SCENES = ['funeral', 'inheritance', 'dream', 'birth'] as const;
type Scene = typeof SCENES[number];
interface LongTask { startTime: number; duration: number }
interface Observer {
  observe(options: { type: string; buffered: boolean }): void;
  takeRecords(): LongTask[];
  disconnect(): void;
}
interface Observation {
  stops: { tick: string | null; reasons: PauseReason[] }[];
  startedAt?: number;
  firstStopMs?: number;
  endedAt?: number;
  endStatusTick?: string;
  tasks: LongTask[];
  observer?: Observer;
}
// Node-only tsconfig: declare just the browser surface used by evaluate callbacks.
declare const window: {
  __simHarness?: { request(request: Record<string, unknown>): Promise<Reply> };
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

async function request(page: Page, type: 'world-snapshot' | 'run' | 'checksums', extra: Record<string, unknown> = {}): Promise<Reply> {
  return page.evaluate(async (args) => {
    if (!window.__simHarness) throw new Error('test harness is missing');
    return window.__simHarness.request(args);
  }, { type, ...extra });
}

async function denylist(page: Page): Promise<void> {
  // These are the only role queries. Every other element lookup uses a test id.
  await expect(page.getByRole('button', { name: /replay|verif/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /replay|verif/i })).toHaveCount(0);
  const ids = await page.getByTestId(/.*/).evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')));
  expect(ids.filter(id => /replay|verif/i.test(id ?? ''))).toEqual([]);
}

function personName(world: WorldSnapshot, id: number): string {
  const person = world.residents.find(person => person.id === id)
    ?? world.player.earlier_bodies.find(person => person.id === id)
    ?? world.person_names.find(person => person.id === id);
  expect(person, `${FIXTURE}: Snapshot must name person ${id}`).toBeDefined();
  return person!.name;
}

async function identityAndPreviews(page: Page, world: WorldSnapshot): Promise<void> {
  await expect(page.getByTestId('soul-marker')).toBeVisible();
  if (world.player.body !== null) {
    await expect(page.getByTestId('current-name')).toHaveText(personName(world, world.player.body));
    await expect(page.getByTestId('current-name')).toBeVisible();
  }
  await expect(page.getByTestId('blood-ties')).toBeVisible();
  await expect(page.getByTestId('past-life-ties')).toBeVisible();
  for (const tie of world.player.blood_ties) {
    await expect(page.getByTestId('blood-ties')).toContainText(`${personName(world, tie.person)} · ${tie.kinship.join(', ')}`);
  }
  for (const tie of world.player.past_life_ties) {
    await expect(page.getByTestId('past-life-ties')).toContainText(
      `${personName(world, tie.rememberer)} remembers ${personName(world, tie.earlier_body)} · ${tie.affinity} affinity`,
    );
  }
  const node = world.player_node;
  if (node === null) return;
  for (const option of node.options) {
    const preview = page.getByTestId(`option-preview-${option.id}`);
    await expect(preview).toBeVisible();
    // Build only fact formatting from the wire DTO, never from a production template.
    const effects = option.preview.map(effect => {
      const delta = BigInt(effect.delta) < 0n ? effect.delta : `+${effect.delta}`;
      const unit = effect.what.startsWith('trait:') ? 'trait_points' : effect.what === 'debt' ? 'money' : effect.what;
      const detail = effect.what.startsWith('trait:') ? ` (${effect.what})` : effect.what === 'debt' ? ' (debt)' : '';
      return `${personName(world, effect.person)}: ${delta} ${unit}${detail}`;
    });
    expect((await preview.innerText()).split('\n').filter(Boolean)).toEqual([option.id, ...(effects.length ? effects : ['No effects.'])]);
  }
  const stakes = page.getByTestId('stakes');
  for (const who of node.stakes.who) await expect(stakes).toContainText(personName(world, who));
  await expect(stakes).toContainText(`${node.stakes.amount} ${node.stakes.unit}`);
  await expect(stakes).toContainText(`By tick ${node.stakes.by}`);
}

async function scene(page: Page, world: WorldSnapshot, reasons: PauseReason[]): Promise<Scene | null> {
  const node = world.player_node;
  const kind: Scene | null = reasons.includes('player_died') ? 'funeral'
    : reasons.includes('dream_resolved') ? 'dream' : reasons.includes('player_reborn') ? 'birth'
    : node?.family === 'family_death' ? 'funeral' : node?.family === 'inheritance' ? 'inheritance' : null;
  for (const candidate of SCENES) {
    await expect(page.getByTestId(`scene-${candidate}`)).toHaveCount(candidate === kind ? 1 : 0);
  }
  if (kind === null) {
    await expect(page.getByTestId('choice-panel')).toBeVisible();
    return null;
  }
  const overlay = page.getByTestId(`scene-${kind}`);
  await expect(overlay).toBeVisible();
  if (reasons.includes('player_died')) {
    const ghost = world.player_wait?.ghost;
    expect(ghost, 'own funeral Snapshot must identify the ghost').toBeDefined();
    const body = world.player.earlier_bodies.find(body => body.id === ghost);
    expect(body, 'own funeral Snapshot must give this body and its death tick').toBeDefined();
    await expect(overlay).toContainText(body!.name);
    await expect(overlay).toContainText(`tick ${body!.death}`);
  } else if (kind === 'dream') {
    expect(world.last_dream, 'dream Snapshot must identify the resolved dream').toBeDefined();
    await expect(overlay).toContainText(personName(world, world.last_dream!.dreamer));
    await expect(overlay).toContainText(`tick ${world.last_dream!.tick}`);
  } else if (kind === 'birth') {
    expect(world.player.body, 'birth Snapshot must identify the new body').not.toBeNull();
    await expect(overlay).toContainText(personName(world, world.player.body!));
  } else {
    expect(node, 'node scene must have a pending node').not.toBeNull();
    await expect(overlay).toContainText(personName(world, node!.stakes.who[0]!));
    await expect(overlay).toContainText(`tick ${node!.fired}`);
  }
  return kind;
}

async function customization(page: Page, world: WorldSnapshot): Promise<void> {
  const before = { tick: await page.getByTestId('tick').innerText(), checksum: await page.getByTestId('checksum').innerText() };
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
  // Read rows through the table's test id, without depending on tags or layout.
  expect((await preview.innerText()).split('\n')).toEqual([
    'Trait\tBase\tCustomized\tPrice',
    `${first}\t${base![first!]}\t${base![first!] + 1}\t${price}`,
    `${second}\t${base![second!]}\t${base![second!] - 1}\t${price}`,
  ]);
  await page.getByTestId('customization-cancel').click();
  await expect(page.getByTestId('underworld-recorded')).toHaveCount(0);
  await expect(page.getByTestId('underworld-error')).toHaveCount(0);
  await expect(page.getByTestId('customization-panel')).toHaveCount(0);
  await expect(page.getByTestId('tick')).toHaveText(before.tick);
  await expect(page.getByTestId('checksum')).toHaveText(before.checksum);
  console.log(`[playthrough] customization cancelled: tick=${before.tick} checksum=${before.checksum} unchanged; ${first}=${base![first!]}+1 ${second}=${base![second!]}-1 price=${price}`);
}

test(`${FIXTURE}: real controls play choices, death, dream and Imported_Vessel rebirth`, async ({ page, baseURL }, testInfo) => {
  test.setTimeout(B);
  expect(stages.last_tick).toBe(fixture.ticks);
  expect(fixture.checksums).toHaveLength(Number(stages.last_tick));
  const offOrigin: string[] = [];
  const errors: string[] = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:') || new URL(url).origin === new URL(baseURL!).origin) await route.continue();
    else { offOrigin.push(url); await route.abort(); }
  });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  // Read-only observation seam authorized for Pause_Reasons: world-snapshot
  // replies do not retain stop, and the page has no Pause_Reason test identifier.
  // No World/UI state is changed and no Worker request is injected here.
  await page.addInitScript(({ lastTick }) => {
    window.__playthrough = { stops: [], tasks: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string, options?: { type?: string }) {
        super(url, options);
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'status') return;
          const observation = window.__playthrough;
          const now = window.performance.now();
          if (data.snapshot.stop) {
            observation.stops.push({ tick: data.snapshot.tick, reasons: data.snapshot.stop.reasons });
            if (observation.firstStopMs === undefined && observation.startedAt !== undefined) {
              observation.firstStopMs = now - observation.startedAt;
            }
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
  await page.getByTestId('seed').fill(fixture.seed);
  await page.getByTestId('config').fill(JSON.stringify(fixture.config));
  await page.getByTestId('create').click();
  await expect(page.getByTestId('tick')).toHaveText('0');
  await expect(page.getByTestId('speed')).toHaveValue('1');
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
      await expect(page.getByTestId('run-state')).toHaveText('paused');
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
      await denylist(page);
      await scene(page, world, stage.reasons);
      // Close any non-node overlays in front of the options through real Close.
      if (index === 0) {
        while (await page.getByTestId('scene-close').isVisible()) await page.getByTestId('scene-close').click();
      }
      await identityAndPreviews(page, world);
      if (index === 0) {
        const firstStopMs = await page.evaluate(() => window.__playthrough.firstStopMs);
        expect(firstStopMs).toBeDefined();
        await testInfo.attach('first-stop-ms', { body: String(firstStopMs), contentType: 'text/plain' });
        console.log(`[playthrough] first-stop-ms=${firstStopMs} target=20000..30000 first_interrupt_min=600 within-target=${firstStopMs! >= 20_000 && firstStopMs! <= 30_000} B-ms=${B}`);
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
        await expect(page.getByTestId('choice-recorded')).toBeVisible();
      }
      if (stage.reasons.includes('player_died')) {
        await expect(page.getByTestId('scene-close')).toBeVisible();
        await page.getByTestId('scene-close').click();
        await expect(page.getByTestId('scene-funeral')).toHaveCount(0);
        await customization(page, world);
        const input = fixture.inputs[consumed++]!;
        expect(input.tick).toBe(stage.tick);
        expect(input.payload.Dream).toBeDefined();
        await page.getByTestId('dreamer').selectOption(input.payload.Dream!.dreamer);
        await page.getByTestId(`dream-intent-${input.payload.Dream!.intent}`).click();
        await expect(page.getByTestId('dreamer')).toHaveValue(input.payload.Dream!.dreamer);
        await expect(page.getByTestId(`dream-intent-${input.payload.Dream!.intent}`)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('dream-send')).toBeEnabled();
        await page.getByTestId('dream-send').click();
        await expect(page.getByTestId('underworld-recorded')).toBeVisible();
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
        await page.getByTestId('carry-over').selectOption(carry.payload.CarryOver!.trait_name);
        await expect(page.getByTestId('carry-over')).toHaveValue(carry.payload.CarryOver!.trait_name);
        await expect(page.getByTestId('claim-imported_vessel')).toBeEnabled();
        await page.getByTestId('claim-imported_vessel').click();
        await expect(page.getByTestId('underworld-recorded')).toBeVisible();
        // With no fallback Step the dream overlay remains open through the claim;
        // a public Step advances the tick and the UI correctly expires that scene.
        if (stages.step_clicks === 0) await expect(page.getByTestId('scene-dream')).toBeVisible();
      }
      await expect(page.getByTestId('run')).toBeEnabled();
      await page.getByTestId('run').click();
    });
  }
  expect(consumed).toBe(fixture.inputs.length);
  // last_tick is a checksum-prefix endpoint, NOT an invented automatic stop.
  // Run past rebirth; stop observing at the first real status reaching that prefix.
  await page.waitForFunction(() => window.__playthrough.endedAt !== undefined, undefined, { timeout: B });
  if (await page.getByTestId('pause').isEnabled()) await page.getByTestId('pause').click();
  await expect(page.getByTestId('run-state')).toHaveText('paused');
  const stopsThroughEndpoint = await page.evaluate((lastTick) => window.__playthrough.stops.filter(
    stop => stop.tick !== null && BigInt(stop.tick) <= BigInt(lastTick),
  ), stages.last_tick);
  expect(stopsThroughEndpoint).toEqual(stages.stages);
  await denylist(page);
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
  expect(offOrigin, 'off-preview requests').toEqual([]);
  expect(errors, 'page console/errors').toEqual([]);
});
