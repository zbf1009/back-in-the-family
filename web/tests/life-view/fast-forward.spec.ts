/// <reference lib="dom" />
// COMPONENT-ONLY: mount the production App at the existing life-view fixture entry.
// Controlled Worker_Protocol replies prove UI admission/order, not native gameplay.
import { expect, test, type Page } from '@playwright/test';
import type { ErrorKind, PauseReason, Request, Snapshot } from '../../src/shared/protocol.ts';
import { DEFAULT_SPEED, FAST_FORWARD_SPEED } from '../../src/shared/speeds.ts';

const COMPONENT = process.env.LIFE_PACE_COMPONENT_ORIGIN ?? 'http://localhost:5174';
interface PaceHarness {
  sent: Request[];
  snapshot: Snapshot;
  reply(id: number, patch?: Partial<Snapshot>, failure?: { kind: ErrorKind; error: string }, stop?: boolean | PauseReason): void;
  reject(id: number): void;
  failNext(type: Request['type']): void;
  status(patch: Partial<Snapshot>, stop?: boolean | PauseReason): void;
  fatal(type: 'fatal' | 'worker-error'): void;
  reset(): void;
}
declare const window: Window & { __paceHarness: PaceHarness };

async function openApp(page: Page, realTickets = false): Promise<void> {
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
import { SimClient } from '/src/main/sim-client.ts';
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
let failNextType = null;
const wire = new EventTarget();
wire.postMessage = request => {
  harness.sent.push(request);
  if (request.type === failNextType) { failNextType = null; throw Error('Controlled transport admission failure'); }
  if (request.type === 'decision-status' || request.type === 'world-snapshot') {
    queueMicrotask(() => wire.dispatchEvent(new MessageEvent('message', { data: { type: 'reply', id: request.id, ok: true,
      snapshot: structuredClone(harness.snapshot), ...(request.type === 'world-snapshot' ? { world } : {}) } })));
  } else pending.set(request.id, { request });
};
wire.terminate = () => {};
const harness = {
  sent: [],
  snapshot: { worldId: 0, runState: 'no-world', tick: null, checksum: null, tps: null,
    speed: ${DEFAULT_SPEED}, playerNode: { pending: false }, actions: [], playerLifecycle: [] },
  reset() { this.sent = []; },
  failNext(type) { failNextType = type; },
  reject(id) {
    const ticket = pending.get(id);
    if (!ticket?.reject) throw Error('Missing rejectable ticket ' + id);
    pending.delete(id);
    ticket.reject(Error('Controlled ticket rejection'));
  },
  reply(id, patch = {}, failure, stop = false) {
    const ticket = pending.get(id);
    if (!ticket) throw Error('Missing pending request ' + id);
    pending.delete(id);
    this.snapshot = { ...this.snapshot, ...patch };
    world.tick = this.snapshot.tick ?? world.tick;
    delete this.snapshot.stop;
    const snapshot = structuredClone(this.snapshot);
    if (stop) snapshot.stop = { reasons: [stop === true ? 'user' : stop], world };
    const message = failure
      ? { type: 'reply', id, ok: false, ...failure, snapshot }
      : { type: 'reply', id, ok: true, snapshot, ...(ticket.request.type === 'create-world' ? { world } : {}) };
    if (${realTickets}) wire.dispatchEvent(new MessageEvent('message', { data: message }));
    else ticket.resolve(message);
  },
  status(patch, stop = false) {
    this.snapshot = { ...this.snapshot, ...patch };
    world.tick = this.snapshot.tick ?? world.tick;
    delete this.snapshot.stop;
    const snapshot = structuredClone(this.snapshot);
    if (stop) snapshot.stop = { reasons: [stop === true ? 'user' : stop], world };
    if (${realTickets}) wire.dispatchEvent(new MessageEvent('message', { data: { type: 'status', snapshot } }));
    else bridge.dispatch({ type: 'status', snapshot });
  },
  fatal(type) { bridge.dispatch({ type, error: 'Controlled fatal worker failure' }); },
};
window.__paceHarness = harness;
const client = ${realTickets} ? new SimClient({
  onStatus: snapshot => bridge.dispatch({ type: 'status', snapshot }),
  onFatal: error => bridge.dispatch({ type: 'fatal', error }),
  onError: error => bridge.dispatch({ type: 'worker-error', error }),
}, wire) : { request(input) {
  const request = { ...input, id: ++nextId };
  harness.sent.push(request);
  if (input.type === 'decision-status' || input.type === 'world-snapshot') return {
    requestId: request.id, reply: Promise.resolve({ type: 'reply', id: request.id, ok: true,
      snapshot: structuredClone(harness.snapshot), ...(input.type === 'world-snapshot' ? { world } : {}) }),
  };
  const { promise, resolve, reject } = Promise.withResolvers();
  pending.set(request.id, { request, resolve, reject });
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
async function reply(page: Page, request: Request, patch: Partial<Snapshot> = {}, failure?: { kind: ErrorKind; error: string }, stop: boolean | PauseReason = false): Promise<void> {
  await page.evaluate(({ id, patch, failure, stop }) => window.__paceHarness.reply(id, patch, failure, stop), { id: request.id, patch, failure, stop });
}
async function status(page: Page, patch: Partial<Snapshot>, stop: boolean | PauseReason = false): Promise<void> {
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
async function startPlaying(page: Page, speed = 7): Promise<void> {
  await page.getByTestId('speed').selectOption(String(speed));
  await reply(page, await lastRequest(page, 'set-speed'), { speed });
  await page.getByTestId('run').click();
  await reply(page, await lastRequest(page, 'run'), { runState: 'running' });
  await expect(page.getByTestId('run')).toBeDisabled();
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.evaluate(() => window.__paceHarness.reset());
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

for (const completion of ['accepted', 'error', 'reject', 'timeout'] as const) {
  test(`pending Run ${completion} releases same-world admission only when the ticket ends`, async ({ page }) => {
    await openApp(page, completion === 'timeout'); await createWorld(page);
    if (completion === 'timeout') await page.clock.install();
    await page.getByTestId('run').click();
    const run = await lastRequest(page, 'run');
    await expect(page.getByTestId('run')).toBeDisabled();
    await expect(page.getByTestId('fast-forward')).toBeDisabled();
    await page.getByTestId('run').dispatchEvent('click');
    await page.getByTestId('fast-forward').dispatchEvent('click');
    expect(await requests(page)).toEqual([run]);
    if (completion === 'accepted') {
      await reply(page, run, { runState: 'running' });
      await expect(page.getByTestId('technical-run-state')).toHaveText('running');
      await status(page, { runState: 'paused', tick: '501' }, 'player_died');
    } else if (completion === 'error') await reply(page, run, {}, { kind: 'sim-error', error: 'Controlled Run failure' });
    else if (completion === 'reject') await page.evaluate(id => window.__paceHarness.reject(id), run.id);
    else await page.clock.fastForward(30_001);
    await expect(page.getByTestId('run')).toBeEnabled();
    await expect(page.getByTestId('fast-forward')).toBeEnabled();
    expect(await requests(page)).toEqual([run]);
    await page.getByTestId('run').click();
    await expect.poll(async () => (await requests(page)).filter(request => request.type === 'run').length).toBe(2);
  });
}

test('a pending Run survives a newer Pause ticket until its own completion', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('run').click();
  const run = await lastRequest(page, 'run');
  await status(page, { runState: 'running' });
  await page.getByTestId('pause').click();
  const pause = await lastRequest(page, 'pause');
  await reply(page, pause, { runState: 'paused' }, undefined, true);
  await expect(page.getByTestId('run')).toBeDisabled();
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await page.getByTestId('run').dispatchEvent('click');
  await page.getByTestId('fast-forward').dispatchEvent('click');
  expect(await requests(page)).toEqual([run, pause]);
  await reply(page, run, { runState: 'running' });
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await expect(page.getByTestId('run')).toBeEnabled();
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
});

test('World replacement releases pending Run admission without old-world completion releasing a new ticket', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('run').click();
  const oldRun = await lastRequest(page, 'run');
  await page.getByTestId('world-setup').locator(':scope > summary').click();
  await page.getByTestId('create').click();
  await reply(page, await lastRequest(page, 'create-world'), { worldId: 2, runState: 'paused' });
  await expect(page.getByTestId('run')).toBeEnabled();
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.getByTestId('run').click();
  const run = await lastRequest(page, 'run');
  expect(run.id).toBeGreaterThan(oldRun.id);
  await reply(page, oldRun, { worldId: 1, runState: 'running' });
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '2');
  await expect(page.getByTestId('run')).toBeDisabled();
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await page.getByTestId('run').dispatchEvent('click');
  expect((await requests(page)).filter(request => request.type === 'run')).toEqual([oldRun, run]);
  await reply(page, run, { worldId: 2, runState: 'running' });
  await expect(page.getByTestId('technical-run-state')).toHaveText('running');
  await status(page, { worldId: 2, runState: 'paused', tick: '501' }, 'player_died');
  await expect(page.getByTestId('run')).toBeEnabled();
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
});

test('fast-forward Run pending on the paused UI blocks Play button and direct handler activation', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  await reply(page, accelerate, { speed: FAST_FORWARD_SPEED });
  const run = await lastRequest(page, 'run');
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await expect(page.getByTestId('run')).toBeDisabled();
  await page.getByTestId('run').dispatchEvent('click');
  expect(await requests(page)).toEqual([accelerate, run]);
  await reply(page, run, { runState: 'running' });
  await expect(page.getByTestId('technical-run-state')).toHaveText('running');
  expect((await requests(page)).filter(request => request.type === 'run')).toEqual([run]);
});

test('a constructed One day natural stop does not seal the newer pending Run, and Status remains authoritative', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('step').click();
  const step = await lastRequest(page, 'step');
  await page.getByTestId('run').click();
  const run = await lastRequest(page, 'run');
  expect(run.id).toBeGreaterThan(step.id);
  // This is a controlled consumer schedule with the protocol's real reason, not native death evidence.
  await status(page, { runState: 'paused', tick: '501' }, 'player_died');
  await reply(page, step, { runState: 'paused', tick: '501', story: factualDelivery('9101') });
  await reply(page, run, { runState: 'running', tick: '501', story: factualDelivery('9102') });
  await expect(page.getByTestId('technical-run-state')).toHaveText('running');
  await expect(page.getByTestId('step')).toBeDisabled();
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download life facts', includeHidden: true }).dispatchEvent('click');
  const stream = await (await downloadPending).createReadStream();
  if (stream === null) throw Error('Life fact download has no readable stream');
  let bytes = '';
  for await (const chunk of stream) bytes += chunk.toString();
  const facts = JSON.parse(bytes);
  expect(Object.keys(facts.events)).toEqual(['9101', '9102']);
  await status(page, { runState: 'paused', tick: '501' });
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await expect(page.getByTestId('step')).toBeEnabled();
  expect(await requests(page)).toEqual([step, run]);
});

test('a first pending Run ACK from before a natural stop cannot resurrect the stopped frame', async ({ page }) => {
  await openApp(page); await createWorld(page);
  await page.getByTestId('run').click();
  const run = await lastRequest(page, 'run');
  await status(page, { runState: 'running' });
  await status(page, { runState: 'paused', tick: '501' }, 'player_died');
  await reply(page, run, { runState: 'running', tick: '500' });
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await expect(page.getByTestId('tick')).toHaveText('501');
  await expect(page.getByTestId('step')).toBeEnabled();
  expect((await requests(page)).filter(request => request.type === 'run')).toEqual([run]);
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
    await expect(page.getByTestId('use-rules-now')).toBeEnabled();
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
    await expect(page.getByTestId('technical-run-state')).toHaveText('failed');
    await expect(page.getByTestId('fast-forward')).toBeDisabled();
    await expect(page.getByTestId('speed')).toHaveValue(String(FAST_FORWARD_SPEED));
    await expect(page.getByTestId('restore-pace')).toHaveCount(0);
    await expect(page.getByTestId('speed')).toBeDisabled();
    await expect(page.getByTestId('error')).toHaveAttribute('data-error-kind', 'sim-error');
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
  await reply(page, restore, { speed: DEFAULT_SPEED, story: factualDelivery('9001') });
  await reply(page, accelerate, { speed: FAST_FORWARD_SPEED, runState: 'running', story: factualDelivery('9002') });
  await expect(page.getByTestId('speed')).toHaveValue(String(DEFAULT_SPEED));
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.getByTestId('technical-details').locator(':scope > summary').click();
  await expect(page.getByTestId('technical-details')).toContainText('2 records;');
  await expect(page.getByTestId('run-state')).toHaveText('Paused');
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
  test(`${started ? 'restart' : 'landing'} exposes only the current local validation category without changing the world`, async ({ page }) => {
    await openApp(page); if (started) await createWorld(page);
    const setup = page.getByTestId('world-setup');
    await setup.locator(':scope > summary').click();
    await expect(page.getByTestId('town-size')).toHaveAttribute('min', '40');
    await expect(page.getByTestId('town-size')).toHaveAttribute('max', '60');
    await page.getByTestId('seed').fill('1');
    await page.getByTestId('town-size').fill('50');
    await page.getByTestId('create').click();
    await reply(page, await lastRequest(page, 'create-world'), {}, { kind: 'sim-error', error: 'Prior worker diagnostic' });
    await expect(page.getByTestId('error')).toHaveAttribute('data-error-kind', 'sim-error');
    const before = await requests(page);
    const frame = async () => ({
      world: await page.getByTestId('life-app').getAttribute('data-world-id'),
      tick: await page.getByTestId('tick').textContent(),
      checksum: await page.getByTestId('checksum').textContent(),
    });
    const original = await frame();
    for (const [seed, size, category] of [
      ['not-a-seed', '50', 'seed'], ['1', '39', 'town-size'],
      ['not-a-seed', '39', 'seed'], ['1', '61', 'town-size'],
    ] as const) {
      await page.getByTestId('seed').fill(seed);
      await page.getByTestId('town-size').fill(size);
      await page.getByTestId('create').click();
      await setup.locator(':scope > summary').click();
      const localAlerts = page.locator('[role="alert"][data-validation-category]');
      await expect(localAlerts).toHaveCount(1);
      await expect(localAlerts).toBeVisible();
      await expect(localAlerts).toHaveAttribute('data-validation-category', category);
      if (category === 'town-size') {
        await expect(page.getByTestId('seed-message')).toHaveCount(0);
        await expect(localAlerts).toHaveAttribute('data-error-kind', 'validation');
        await expect(localAlerts).toContainText(/\b40\b/);
        await expect(localAlerts).toContainText(/\b60\b/);
      } else await expect(page.locator('[data-testid="error"][data-error-kind="validation"]')).toHaveCount(0);
      expect(await requests(page)).toEqual(before);
      expect(await frame()).toEqual(original);
      await setup.locator(':scope > summary').click();
      if (category === 'town-size') {
        await expect(page.getByTestId('town-size')).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByTestId('town-size')).toHaveAttribute('aria-describedby', 'local-validation-error');
      }
    }
    await page.getByTestId('seed').fill('1');
    await page.getByTestId('town-size').fill('50');
    await page.getByTestId('create').click();
    await expect(page.locator('[role="alert"][data-validation-category]')).toHaveCount(0);
    expect(await frame()).toEqual(original);
    expect((await requests(page)).slice(before.length).map(request => request.type)).toEqual(['create-world']);
  });
}

for (const failure of ['reply', 'reject', 'timeout'] as const) {
  for (const command of ['pause', 'set-speed'] as const) {
    test(`${failure} of recovery ${command} leaves a visible same-world manual restoration after a successful reply`, async ({ page }) => {
      await openApp(page, failure === 'timeout'); await createWorld(page); await beginFastForward(page);
      if (failure === 'timeout') await page.clock.install();
      if (command === 'pause') await page.getByTestId('pause').click();
      else await status(page, { runState: 'paused' }, true);
      const failed = await lastRequest(page, command);
      if (failure === 'reply') await reply(page, failed, {}, { kind: 'sim-error', error: 'Controlled recovery failure' });
      else if (failure === 'reject') await page.evaluate(id => window.__paceHarness.reject(id), failed.id);
      else await page.clock.fastForward(30_001);
      await expect(page.getByTestId('restore-pace')).toBeVisible();
      await status(page, { runState: 'paused' });
      await page.getByTestId('technical-details').locator(':scope > summary').click();
      await page.getByRole('button', { name: 'Export replay', exact: true }).click();
      await reply(page, await lastRequest(page, 'export-replay'));
      await expect(page.getByTestId('error')).toHaveCount(0);
      await expect(page.getByTestId('restore-pace')).toBeEnabled();
      const before = await requests(page);
      await page.getByTestId('restore-pace').click();
      const restore = await lastRequest(page, 'set-speed');
      expect(restore).toMatchObject({ speed: 7 });
      await expect(page.getByTestId('restore-pace')).toBeVisible();
      await expect(page.getByTestId('restore-pace')).toBeDisabled();
      await page.getByTestId('restore-pace').dispatchEvent('click');
      expect((await requests(page)).slice(before.length)).toEqual([restore]);
      await reply(page, restore, { speed: 7, runState: 'paused' });
      await expect(page.getByTestId('restore-pace')).toHaveCount(0);
      for (const control of ['run', 'step', 'speed', 'fast-forward']) await expect(page.getByTestId(control)).toBeEnabled();
      expect((await requests(page)).filter(request => request.type === 'run')).toHaveLength(1);
      expect((await requests(page)).filter(request => ['choose', 'dream', 'bribe', 'submit', 'step'].includes(request.type))).toEqual([]);
    });
  }
}

for (const stage of ['starting', 'selecting'] as const) {
  for (const failure of ['reject', 'timeout', 'admission'] as const) {
    test(`${stage} ${failure} retains the actual restoration target without sending Run`, async ({ page }) => {
      await openApp(page, failure !== 'reject'); await createWorld(page);
      if (stage === 'selecting') await beginFastForward(page);
      const target = stage === 'selecting' ? 1 : DEFAULT_SPEED;
      if (failure === 'timeout') await page.clock.install();
      if (failure === 'admission') await page.evaluate(() => window.__paceHarness.failNext('set-speed'));
      if (stage === 'selecting') await page.getByTestId('speed').selectOption('1');
      else await page.getByTestId('fast-forward').click();
      const failed = await lastRequest(page, 'set-speed');
      if (stage === 'selecting' && failure === 'timeout') {
        const pending = await requests(page);
        await status(page, { runState: 'paused' }, true);
        expect(await requests(page)).toEqual(pending);
      }
      if (failure === 'reject') await page.evaluate(id => window.__paceHarness.reject(id), failed.id);
      else if (failure === 'timeout') await page.clock.fastForward(30_001);
      await expect(page.getByTestId('restore-pace')).toBeEnabled();
      await expect(page.getByTestId('error')).toHaveAttribute('data-error-kind', 'sim-error');
      const before = await requests(page);
      await status(page, { runState: 'paused', speed: FAST_FORWARD_SPEED });
      expect(await requests(page)).toEqual(before);
      await page.getByTestId('restore-pace').click();
      const restore = await lastRequest(page, 'set-speed');
      expect(restore).toMatchObject({ speed: target });
      await expect(page.getByTestId('restore-pace')).toBeDisabled();
      await reply(page, restore, { runState: 'paused', speed: target });
      await expect(page.getByTestId('fast-forward')).toBeEnabled();
      await expect(page.getByTestId('speed')).toHaveValue(String(target));
      expect((await requests(page)).filter(request => request.type === 'run')).toHaveLength(stage === 'selecting' ? 1 : 0);
    });
  }
}

test('manual recovery sends only the still-owed Pause then speed, and remains disabled across both tickets', async ({ page }) => {
  await openApp(page); await createWorld(page); await beginFastForward(page);
  await page.getByTestId('pause').click();
  await page.evaluate(id => window.__paceHarness.reject(id), (await lastRequest(page, 'pause')).id);
  await expect(page.getByTestId('restore-pace')).toBeEnabled();
  const before = await requests(page);
  await page.getByTestId('restore-pace').click();
  const pause = await lastRequest(page, 'pause');
  await expect(page.getByTestId('restore-pace')).toBeDisabled();
  await page.getByTestId('restore-pace').dispatchEvent('click');
  expect((await requests(page)).slice(before.length)).toEqual([pause]);
  await reply(page, pause, { runState: 'paused' }, undefined, true);
  const restore = await lastRequest(page, 'set-speed');
  expect(restore).toMatchObject({ speed: 7 });
  await expect(page.getByTestId('restore-pace')).toBeDisabled();
  await reply(page, restore, { speed: 7 });
  await expect(page.getByTestId('run')).toBeEnabled();
  expect((await requests(page)).slice(before.length)).toEqual([pause, restore]);
});

test('manual restoration is blocked by decision hold and pending Create, and a new World cancels old obligations', async ({ page }) => {
  await openApp(page); await createWorld(page); await beginFastForward(page);
  await status(page, { runState: 'paused' }, true);
  const oldRestore = await lastRequest(page, 'set-speed');
  await page.evaluate(id => window.__paceHarness.reject(id), oldRestore.id);
  await expect(page.getByTestId('restore-pace')).toBeEnabled();
  const before = await requests(page);
  await status(page, { decision: decision(true) });
  await expect(page.getByTestId('restore-pace')).toBeDisabled();
  await page.getByTestId('restore-pace').dispatchEvent('click');
  expect(await requests(page)).toEqual(before);
  await status(page, { decision: decision(false) });
  await expect(page.getByTestId('restore-pace')).toBeEnabled();
  expect(await requests(page)).toEqual(before);
  await page.getByTestId('world-setup').locator(':scope > summary').click();
  await page.getByTestId('create').click();
  const create = await lastRequest(page, 'create-world');
  await expect(page.getByTestId('restore-pace')).toBeDisabled();
  await page.getByTestId('restore-pace').dispatchEvent('click');
  expect((await requests(page)).slice(before.length)).toEqual([create]);
  await reply(page, create, { worldId: 2, runState: 'paused', speed: DEFAULT_SPEED, decision: undefined });
  await expect(page.getByTestId('restore-pace')).toHaveCount(0);
  await status(page, { worldId: 1, runState: 'paused', speed: FAST_FORWARD_SPEED }, true);
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '2');
  await expect(page.getByTestId('speed')).toHaveValue(String(DEFAULT_SPEED));
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  expect((await requests(page)).slice(before.length)).toEqual([create]);
});

const factualDelivery = (id: string): NonNullable<Snapshot['story']> => [{
  worldId: 1,
  batch: {
    version: 1, opening: false,
    actors: [
      { person: 900, soulId: '900', name: 'Fact Sender', sex: 'male', origin: 'native' },
      { person: 901, soulId: '901', name: 'Fact Receiver', sex: 'female', origin: 'native' },
    ],
    events: [{ id, tick: '500', kind: { type: 'social', kind: 'gift', doer: 900, target: 901, intensity: 1 },
      causedBy: [], tags: 0, relevance: 'background', relevanceBasis: 'observed-day-start-end', actorContext: [] }],
    chronicle: [], dreams: [], cursors: { events: { start: id, end: id }, chronicle: { start: '0', end: '0' } },
  },
}];

test('natural stop before selected-speed ACK keeps the explicit target, paused state and late reply facts', async ({ page }) => {
  await openApp(page); await createWorld(page); await beginFastForward(page);
  await page.getByTestId('technical-details').locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Export replay', exact: true }).click();
  const older = await lastRequest(page, 'export-replay');
  await page.getByTestId('speed').selectOption('1');
  const selected = await lastRequest(page, 'set-speed');
  await status(page, { runState: 'paused' }, true);
  expect((await requests(page)).filter(request => request.type === 'set-speed')).toHaveLength(2);
  await reply(page, selected, { runState: 'running', speed: 1, story: factualDelivery('9001') });
  await expect(page.getByTestId('run-state')).toHaveText('Paused');
  await expect(page.getByTestId('speed')).toHaveValue('1');
  await reply(page, older, { runState: 'running', speed: FAST_FORWARD_SPEED, story: factualDelivery('9002') });
  await expect(page.getByTestId('run-state')).toHaveText('Paused');
  await expect(page.getByTestId('speed')).toHaveValue('1');
  await expect(page.getByTestId('technical-details')).toContainText('2 records;');
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
});

for (const pauseFirst of [false, true]) {
  test(`user Pause ${pauseFirst ? 'before' : 'after'} selected-speed ACK keeps the explicit pace and never restarts`, async ({ page }) => {
    await openApp(page); await createWorld(page); await beginFastForward(page);
    await page.getByTestId('speed').selectOption('1');
    const selected = await lastRequest(page, 'set-speed');
    await page.getByTestId('pause').click();
    const pause = await lastRequest(page, 'pause');
    if (pauseFirst) await reply(page, pause, { runState: 'paused' }, undefined, true);
    await reply(page, selected, { runState: 'running', speed: 1 });
    if (!pauseFirst) await reply(page, pause, { runState: 'paused', speed: 1 }, undefined, true);
    await expect(page.getByTestId('run-state')).toHaveText('Paused');
    await expect(page.getByTestId('speed')).toHaveValue('1');
    await expect(page.getByTestId('fast-forward')).toBeEnabled();
    expect((await requests(page)).map(request => request.type)).toEqual(['set-speed', 'run', 'set-speed', 'pause']);
  });
}

test('Playing Skip ahead changes only the existing loop speed and restores at the first natural stop', async ({ page }) => {
  await openApp(page); await createWorld(page); await startPlaying(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  expect(accelerate).toMatchObject({ speed: FAST_FORWARD_SPEED });
  await page.getByTestId('fast-forward').dispatchEvent('click');
  expect(await requests(page)).toEqual([accelerate]);
  await reply(page, accelerate, { runState: 'running', speed: FAST_FORWARD_SPEED });
  await expect(page.getByTestId('technical-run-state')).toHaveText('running');
  await expect(page.getByTestId('pause')).toBeEnabled();
  expect(await requests(page)).toEqual([accelerate]);
  await status(page, { runState: 'paused', tick: '501' }, 'player_died');
  const restore = await lastRequest(page, 'set-speed');
  expect(restore).toMatchObject({ speed: 7 });
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await reply(page, restore, { runState: 'paused', speed: 7 });
  await expect(page.getByTestId('speed')).toHaveValue('7');
  await expect(page.getByTestId('step')).toBeEnabled();
  expect(await requests(page)).toEqual([accelerate, restore]);
});

test('a paused acceleration ACK never resumes a Skip ahead initiated while Playing', async ({ page }) => {
  await openApp(page); await createWorld(page); await startPlaying(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  await reply(page, accelerate, { runState: 'paused', speed: FAST_FORWARD_SPEED });
  const restore = await lastRequest(page, 'set-speed');
  expect(restore).toMatchObject({ speed: 7 });
  await reply(page, restore, { runState: 'paused', speed: 7 });
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  expect(await requests(page)).toEqual([accelerate, restore]);
});

test('Playing Skip ahead waits for an explicit speed ACK and cannot overtake a pending Pause', async ({ page }) => {
  await openApp(page); await createWorld(page); await startPlaying(page);
  await page.getByTestId('speed').selectOption('1');
  const selected = await lastRequest(page, 'set-speed');
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await page.getByTestId('fast-forward').dispatchEvent('click');
  expect(await requests(page)).toEqual([selected]);
  await reply(page, selected, { runState: 'running', speed: 1 });
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.getByTestId('pause').click();
  const pause = await lastRequest(page, 'pause');
  await expect(page.getByTestId('fast-forward')).toBeDisabled();
  await page.getByTestId('fast-forward').dispatchEvent('click');
  expect(await requests(page)).toEqual([selected, pause]);
  await reply(page, pause, { runState: 'paused' }, undefined, true);
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
});

for (const pauseFirst of [false, true]) {
  test(`Playing manual Pause ${pauseFirst ? 'before' : 'after'} acceleration ACK restores the saved pace without another Run`, async ({ page }) => {
    await openApp(page); await createWorld(page); await startPlaying(page);
    await page.getByTestId('fast-forward').click();
    const accelerate = await lastRequest(page, 'set-speed');
    await page.getByTestId('pause').click();
    const pause = await lastRequest(page, 'pause');
    if (pauseFirst) await reply(page, pause, { runState: 'paused', speed: FAST_FORWARD_SPEED }, undefined, true);
    await reply(page, accelerate, { runState: 'running', speed: FAST_FORWARD_SPEED, story: factualDelivery('9201') });
    if (!pauseFirst) await reply(page, pause, { runState: 'paused' }, undefined, true);
    const restore = await lastRequest(page, 'set-speed');
    expect(restore).toMatchObject({ speed: 7 });
    await reply(page, restore, { runState: 'paused', speed: 7 });
    await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
    await expect(page.getByTestId('speed')).toHaveValue('7');
    await expect(page.getByTestId('fast-forward')).toBeEnabled();
    expect(await requests(page)).toEqual([accelerate, pause, restore]);
  });
}

test('Playing explicit target survives a natural stop and its late ACK retains facts without restart', async ({ page }) => {
  await openApp(page); await createWorld(page); await startPlaying(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  await reply(page, accelerate, { runState: 'running', speed: FAST_FORWARD_SPEED });
  await page.getByTestId('speed').selectOption('1');
  const selected = await lastRequest(page, 'set-speed');
  await status(page, { runState: 'paused', tick: '501' }, 'player_died');
  await reply(page, selected, { runState: 'running', speed: 1, story: factualDelivery('9202') });
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await expect(page.getByTestId('speed')).toHaveValue('1');
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.getByTestId('technical-details').locator(':scope > summary').click();
  await expect(page.getByTestId('technical-details')).toContainText('1 records;');
  expect(await requests(page)).toEqual([accelerate, selected]);
});

test('a new World cancels Playing acceleration and its old ACK cannot run or restore the replacement', async ({ page }) => {
  await openApp(page); await createWorld(page); await startPlaying(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  await page.getByTestId('world-setup').locator(':scope > summary').click();
  await page.getByTestId('create').click();
  const create = await lastRequest(page, 'create-world');
  await reply(page, create, { worldId: 2, runState: 'paused', speed: DEFAULT_SPEED });
  await reply(page, accelerate, { worldId: 1, runState: 'running', speed: FAST_FORWARD_SPEED });
  await expect(page.getByTestId('life-app')).toHaveAttribute('data-world-id', '2');
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await expect(page.getByTestId('speed')).toHaveValue(String(DEFAULT_SPEED));
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  expect(await requests(page)).toEqual([accelerate, create]);
});

test('Playing stop before acceleration ACK restores once and retains late facts without restarting', async ({ page }) => {
  await openApp(page); await createWorld(page); await startPlaying(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  await status(page, { runState: 'paused', speed: FAST_FORWARD_SPEED, tick: '501' }, 'player_died');
  const restore = await lastRequest(page, 'set-speed');
  await reply(page, restore, { runState: 'paused', speed: 7 });
  await reply(page, accelerate, { runState: 'running', speed: FAST_FORWARD_SPEED, story: factualDelivery('9203') });
  await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await expect(page.getByTestId('speed')).toHaveValue('7');
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  await page.getByTestId('technical-details').locator(':scope > summary').click();
  await expect(page.getByTestId('technical-details')).toContainText('1 records;');
  expect(await requests(page)).toEqual([accelerate, restore]);
});

test('Playing failed acceleration leaves manual Pause-and-pace recovery without retrying Run', async ({ page }) => {
  await openApp(page); await createWorld(page); await startPlaying(page);
  await page.getByTestId('fast-forward').click();
  const accelerate = await lastRequest(page, 'set-speed');
  await reply(page, accelerate, { runState: 'running' }, { kind: 'sim-error', error: 'Controlled acceleration failure' });
  await expect(page.getByTestId('restore-pace')).toBeEnabled();
  expect(await requests(page)).toEqual([accelerate]);
  await page.getByTestId('restore-pace').click();
  const pause = await lastRequest(page, 'pause');
  await expect(page.getByTestId('restore-pace')).toBeDisabled();
  await reply(page, pause, { runState: 'paused' }, undefined, true);
  const restore = await lastRequest(page, 'set-speed');
  expect(restore).toMatchObject({ speed: 7 });
  await reply(page, restore, { runState: 'paused', speed: 7 });
  await expect(page.getByTestId('restore-pace')).toHaveCount(0);
  await expect(page.getByTestId('fast-forward')).toBeEnabled();
  expect(await requests(page)).toEqual([accelerate, pause, restore]);
});
