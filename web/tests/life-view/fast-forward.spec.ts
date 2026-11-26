/// <reference lib="dom" />
// COMPONENT-ONLY: mount the production App at the existing life-view fixture entry.
// Controlled Worker_Protocol replies prove UI admission/order, not native gameplay.
import { expect, test, type Page } from '@playwright/test';
import type { ErrorKind, Request, Snapshot } from '../../src/shared/protocol.ts';
import { DEFAULT_SPEED, FAST_FORWARD_SPEED } from '../../src/shared/speeds.ts';

const COMPONENT = process.env.LIFE_PACE_COMPONENT_ORIGIN ?? 'http://localhost:5174';
interface PaceHarness {
  sent: Request[];
  snapshot: Snapshot;
  reply(id: number, patch?: Partial<Snapshot>, failure?: { kind: ErrorKind; error: string }, stop?: boolean): void;
  status(patch: Partial<Snapshot>, stop?: boolean): void;
  fatal(type: 'fatal' | 'worker-error'): void;
  reset(): void;
}
declare const window: Window & { __paceHarness: PaceHarness };

async function openApp(page: Page): Promise<void> {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== COMPONENT && !['data:', 'blob:'].includes(url.protocol)) { await route.abort(); return; }
    if (url.pathname !== '/tests/fixtures/life-view.ts') { await route.continue(); return; }
    const response = await route.fetch();
    const source = await response.text();
    const mountImport = source.match(/^import\s+\{[^\n]*\bmount\b[^\n]*\}\s+from\s+['"][^'"]+['"];?/m)?.[0];
    const baselineImport = source.match(/^import\s+baselineBytes\s+from\s+['"][^'"]+['"];?/m)?.[0];
    if (!mountImport || !baselineImport) throw Error('Existing life-view fixture imports are missing');
    await route.fulfill({ response, contentType: 'application/javascript', body: `${mountImport}
${baselineImport}
import App from '/src/App.svelte';
const world = JSON.parse(baselineBytes);
const soulId = value => /^S-[0-9]+$/.test(value) ? BigInt(value.slice(2)).toString() : value;
world.player_soul = soulId(world.player_soul);
for (const person of world.residents) person.soul_id = soulId(person.soul_id);
world.magistrate.soul_id = soulId(world.magistrate.soul_id);
for (const soul of world.souls) soul.soul_id = soulId(soul.soul_id);
for (const account of world.joss) account.soul_id = soulId(account.soul_id);
world.player_node = null;
const bridge = { dispatch: null };
let nextId = 0;
const pending = new Map();
const harness = {
  sent: [],
  snapshot: { worldId: 0, runState: 'no-world', tick: null, checksum: null, tps: null,
    speed: ${DEFAULT_SPEED}, playerNode: { pending: false }, actions: [], playerLifecycle: [] },
  reset() { this.sent = []; },
  reply(id, patch = {}, failure, stop = false) {
    const ticket = pending.get(id);
    if (!ticket) throw Error('Missing pending request ' + id);
    pending.delete(id);
    this.snapshot = { ...this.snapshot, ...patch };
    delete this.snapshot.stop;
    const snapshot = structuredClone(this.snapshot);
    if (stop) snapshot.stop = { reasons: ['user'], world };
    ticket.resolve(failure
      ? { type: 'reply', id, ok: false, ...failure, snapshot }
      : { type: 'reply', id, ok: true, snapshot, ...(ticket.request.type === 'create-world' ? { world } : {}) });
  },
  status(patch, stop = false) {
    this.snapshot = { ...this.snapshot, ...patch };
    delete this.snapshot.stop;
    const snapshot = structuredClone(this.snapshot);
    if (stop) snapshot.stop = { reasons: ['user'], world };
    bridge.dispatch({ type: 'status', snapshot });
  },
  fatal(type) { bridge.dispatch({ type, error: 'Controlled fatal worker failure' }); },
};
window.__paceHarness = harness;
const client = { request(input) {
  const request = { ...input, id: ++nextId };
  harness.sent.push(request);
  if (input.type === 'decision-status' || input.type === 'world-snapshot') return {
    requestId: request.id, reply: Promise.resolve({ type: 'reply', id: request.id, ok: true,
      snapshot: structuredClone(harness.snapshot), ...(input.type === 'world-snapshot' ? { world } : {}) }),
  };
  const { promise, resolve } = Promise.withResolvers();
  pending.set(request.id, { request, resolve });
  return { requestId: request.id, reply: promise };
} };
mount(App, { target: document.getElementById('fixture'), props: { client, bridge } });
` });
  });
  await page.goto(`${COMPONENT}/life-view-fixture.html?state=living`);
  await expect(page.getByTestId('create')).toBeEnabled();
}
async function requests(page: Page): Promise<Request[]> {
  return page.evaluate(() => window.__paceHarness.sent.filter(request => !['decision-status', 'world-snapshot'].includes(request.type)));
}
async function lastRequest(page: Page, type: Request['type']): Promise<Request> {
  await expect.poll(async () => (await requests(page)).filter(request => request.type === type).length).toBeGreaterThan(0);
  return (await requests(page)).filter(request => request.type === type).at(-1)!;
}
async function reply(page: Page, request: Request, patch: Partial<Snapshot> = {}, failure?: { kind: ErrorKind; error: string }, stop = false): Promise<void> {
  await page.evaluate(({ id, patch, failure, stop }) => window.__paceHarness.reply(id, patch, failure, stop), { id: request.id, patch, failure, stop });
}
async function status(page: Page, patch: Partial<Snapshot>, stop = false): Promise<void> {
  await page.evaluate(({ patch, stop }) => window.__paceHarness.status(patch, stop), { patch, stop });
}
async function createWorld(page: Page): Promise<void> {
  await page.getByTestId('create').click();
  const create = await lastRequest(page, 'create-world');
  await reply(page, create, { worldId: 1, runState: 'paused', tick: '500', checksum: '0123456789abcdef' });
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.evaluate(() => window.__paceHarness.reset());
}
async function beginFastForward(page: Page, speed = 7): Promise<Request> {
  await page.getByTestId('speed').selectOption(String(speed));
  await reply(page, await lastRequest(page, 'set-speed'), { speed });
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.evaluate(() => window.__paceHarness.reset());
  await page.getByTestId('fast-forward').click();
  const accelerated = await lastRequest(page, 'set-speed');
  expect(accelerated).toMatchObject({ speed: FAST_FORWARD_SPEED });
  await reply(page, accelerated, { speed: FAST_FORWARD_SPEED });
  const run = await lastRequest(page, 'run');
  await reply(page, run, { runState: 'running' });
  await expect(page.getByTestId('run-state')).toHaveText('Playing');
  return run;
}
async function exportFailure(page: Page): Promise<void> {
  await page.getByTestId('technical-details').locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Export replay', exact: true }).click();
  await reply(page, await lastRequest(page, 'export-replay'), {}, { kind: 'sim-error', error: 'Controlled recoverable failure' });
}
const decision = (pending: boolean): NonNullable<Snapshot['decision']> => ({
  config: 'ready', enabled: true, sessionCap: 40, spent: 1, waitSeconds: 10,
  pending: pending ? { requestId: 1000, worldId: 1, tick: '500', trigger: 'dream_interpretation' } : null,
  outcome: pending ? null : { kind: 'fallback', reason: 'manual', requestId: 1000, worldId: 1 },
});

test('pending Create blocks fast-forward in both the button and handler', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('world-setup').locator(':scope > summary').click();
  await page.getByTestId('create').click();
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await page.getByTestId('fast-forward').dispatchEvent('click');
  expect((await requests(page)).map(request => request.type)).toEqual(['create-world']);
});

test('recoverable running error waits for real Pause, then restores and blocks reentry until speed ACK', async ({ page }) => {
  await openApp(page); await createWorld(page); await beginFastForward(page);
  await exportFailure(page);
  const pause = await lastRequest(page, 'pause');
  await expect(page.getByTestId('run-state')).toHaveText('Playing');
  expect((await requests(page)).map(request => request.type)).toEqual(['set-speed', 'run', 'export-replay', 'pause']);
  await reply(page, pause, { runState: 'paused' }, undefined, true);
  const restore = await lastRequest(page, 'set-speed');
  expect(restore).toMatchObject({ speed: 7 });
  await expect(page.getByTestId('run-state')).toHaveText('Paused');
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await page.getByTestId('fast-forward').dispatchEvent('click');
  expect((await requests(page)).map(request => request.type)).toEqual(['set-speed', 'run', 'export-replay', 'pause', 'set-speed']);
  await reply(page, restore, { speed: 7 });
  await expect(page.getByTestId('speed')).toHaveValue('7');
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
});

for (const rejectedCommand of ['pause', 'set-speed'] as const) {
  test(`decision hold rejecting ${rejectedCommand} defers recovery until hold ends, without repeating gameplay`, async ({ page }) => {
    await openApp(page); await createWorld(page); await beginFastForward(page);
    if (rejectedCommand === 'pause') await page.getByTestId('pause').click();
    else await status(page, { runState: 'paused' }, true);
    const rejected = await lastRequest(page, rejectedCommand);
    await reply(page, rejected, { decision: decision(true) }, { kind: 'decision_pending', error: 'Controlled decision hold' });
    await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'pending');
    const heldRequests = await requests(page);
    await page.getByTestId('fast-forward').dispatchEvent('click');
    expect(await requests(page)).toEqual(heldRequests);
    await status(page, { decision: decision(false) });
    if (rejectedCommand === 'pause') {
      await expect.poll(async () => (await requests(page)).filter(request => request.type === 'pause').length).toBe(2);
      await reply(page, await lastRequest(page, 'pause'), { runState: 'paused' }, undefined, true);
    } else await expect.poll(async () => (await requests(page)).filter(request => request.type === 'set-speed').length).toBe(3);
    const restored = await lastRequest(page, 'set-speed');
    expect(restored).toMatchObject({ speed: 7 });
    await expect(page.getByTestId('fast-forward')).toBeDisabled();
    await reply(page, restored, { speed: 7 });
    await expect(page.getByTestId('fast-forward')).toBeEnabled();
    expect((await requests(page)).filter(request => request.type === 'run')).toHaveLength(1);
    expect((await requests(page)).filter(request => ['choose', 'dream', 'bribe', 'submit'].includes(request.type))).toEqual([]);
  });
}

for (const fatal of ['fatal', 'worker-error'] as const) {
  test(`${fatal} does not pretend Pause or restoration succeeded`, async ({ page }) => {
    await openApp(page); await createWorld(page); await beginFastForward(page);
    const before = await requests(page);
    await page.evaluate(type => window.__paceHarness.fatal(type), fatal);
    await expect(page.getByTestId('run-state')).toHaveText('Unable to continue');
    await expect(page.getByTestId('fast-forward')).toBeDisabled();
    await expect(page.getByTestId('speed')).toHaveValue(String(FAST_FORWARD_SPEED));
    expect(await requests(page)).toEqual(before);
  });
}

for (const createSucceeds of [false, true]) {
  test(`stop during pending Create ${createSucceeds ? 'discards only the old-world pace on success' : 'restores the old-world pace after failure'}`, async ({ page }) => {
    await openApp(page); await createWorld(page); await beginFastForward(page);
    await page.getByTestId('world-setup').locator(':scope > summary').click();
    await page.getByTestId('create').click();
    const create = await lastRequest(page, 'create-world');
    await status(page, { runState: 'paused' }, true);
    expect((await requests(page)).filter(request => request.type === 'set-speed')).toHaveLength(1);
    if (createSucceeds) {
      await reply(page, create, { worldId: 2, runState: 'paused', speed: DEFAULT_SPEED });
      await status(page, { worldId: 1, speed: FAST_FORWARD_SPEED }, true);
      await expect(page.getByTestId('speed')).toHaveValue(String(DEFAULT_SPEED));
      expect((await requests(page)).filter(request => request.type === 'set-speed')).toHaveLength(1);
    } else {
      await reply(page, create, {}, { kind: 'invalid-seed', error: 'Controlled Create failure' });
      await expect.poll(async () => (await requests(page)).filter(request => request.type === 'set-speed').length).toBe(2);
      const restore = await lastRequest(page, 'set-speed');
      expect(restore).toMatchObject({ speed: 7 });
      await reply(page, restore, { speed: 7 });
      await expect(page.getByTestId('speed')).toHaveValue('7');
    }
    await expect(page.getByTestId('fast-forward')).toBeEnabled();
  });
}

test('a late old Run ACK cannot resurrect a confirmed Pause, while real Status remains authoritative', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('fast-forward').click();
  await reply(page, await lastRequest(page, 'set-speed'), { speed: FAST_FORWARD_SPEED });
  const run = await lastRequest(page, 'run');
  await status(page, { runState: 'running' });
  await exportFailure(page);
  await reply(page, await lastRequest(page, 'pause'), { runState: 'paused' }, undefined, true);
  const restore = await lastRequest(page, 'set-speed');
  await reply(page, restore, { speed: DEFAULT_SPEED });
  await reply(page, run, { runState: 'running', speed: FAST_FORWARD_SPEED });
  await expect(page.getByTestId('run-state')).toHaveText('Paused');
  await expect(page.getByTestId('speed')).toHaveValue(String(DEFAULT_SPEED));
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await status(page, { runState: 'running', speed: 7 });
  await expect(page.getByTestId('run-state')).toHaveText('Playing');
  await expect(page.getByTestId('speed')).toHaveValue('7');
});

test('rejected Pause remains running with restoration owed and sends no generic retry', async ({ page }) => {
  await openApp(page); await createWorld(page); await beginFastForward(page);
  await exportFailure(page);
  await reply(page, await lastRequest(page, 'pause'), {}, { kind: 'sim-error', error: 'Controlled Pause failure' });
  const before = await requests(page);
  await status(page, { runState: 'running' });
  await expect(page.getByTestId('run-state')).toHaveText('Playing');
  await expect(page.getByTestId('speed')).toHaveValue(String(FAST_FORWARD_SPEED));
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  expect(await requests(page)).toEqual(before);
  expect(before.filter(request => request.type === 'set-speed')).toHaveLength(1);
});

test('manual speed selection during fast-forward preserves running and settles only on its ACK', async ({ page }) => {
  await openApp(page); await createWorld(page); await beginFastForward(page);
  await page.getByTestId('speed').selectOption('1');
  const selected = await lastRequest(page, 'set-speed');
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await expect(page.getByTestId('run-state')).toHaveText('Playing');
  await reply(page, selected, { speed: 1 });
  await status(page, { runState: 'paused' }, true);
  await expect(page.getByTestId('speed')).toHaveValue('1');
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  expect((await requests(page)).map(request => request.type)).toEqual(['set-speed', 'run', 'set-speed']);
});

test('stop before acceleration ACK retains restoration and cannot send a delayed Run', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  await status(page, { runState: 'paused', speed: FAST_FORWARD_SPEED }, true);
  await expect.poll(async () => (await requests(page)).filter(request => request.type === 'set-speed').length).toBe(2);
  const restore = await lastRequest(page, 'set-speed');
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await reply(page, restore, { speed: DEFAULT_SPEED });
  await reply(page, accelerate, { speed: FAST_FORWARD_SPEED });
  await expect(page.getByTestId('speed')).toHaveValue(String(DEFAULT_SPEED));
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  expect((await requests(page)).filter(request => request.type === 'run')).toEqual([]);
});

test('latest manual speed wins over older speed and Run acknowledgements', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('run').click();
  const run = await lastRequest(page, 'run');
  await page.getByTestId('speed').selectOption('1');
  const first = await lastRequest(page, 'set-speed');
  await page.getByTestId('speed').selectOption('7');
  const latest = await lastRequest(page, 'set-speed');
  await reply(page, latest, { speed: 7 });
  await reply(page, first, { speed: 1 });
  await reply(page, run, { speed: DEFAULT_SPEED, runState: 'running' });
  await expect(page.getByTestId('speed')).toHaveValue('7');
  await expect(page.getByTestId('run-state')).toHaveText('Playing');
});

for (const started of [false, true]) {
  test(`${started ? 'restart' : 'landing'} exposes seed errors and raw town-size validation after transport errors`, async ({ page }) => {
    await openApp(page); if (started) await createWorld(page);
    await page.getByTestId('world-setup').locator(':scope > summary').click();
    await page.getByTestId('seed').fill('not-a-seed');
    await page.getByTestId('create').click();
    await page.getByTestId('world-setup').locator(':scope > summary').click();
    await expect(page.getByTestId('seed-message')).toBeVisible();
    await expect(page.getByTestId('seed-message')).toHaveText('Seed must contain only the digits 0-9 (no spaces, sign, decimal point or exponent).');
    await page.getByTestId('world-setup').locator(':scope > summary').click();
    await page.getByTestId('seed').fill('1');
    for (const size of ['39', '61']) {
      await page.getByTestId('town-size').fill('50');
      await page.getByTestId('create').click();
      await reply(page, await lastRequest(page, 'create-world'), {}, { kind: 'sim-error', error: 'Prior worker diagnostic' });
      await expect(page.getByTestId('error')).not.toHaveText('Prior worker diagnostic');
      const before = await requests(page);
      await page.getByTestId('town-size').fill(size);
      await page.getByTestId('create').click();
      await expect(page.getByTestId('error')).toHaveText('Town size must be a whole number from 40 to 60.');
      expect(await requests(page)).toEqual(before);
    }
  });
}
