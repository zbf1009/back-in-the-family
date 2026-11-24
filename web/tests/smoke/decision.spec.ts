// Built app + system Chrome + loopback-only OFFLINE FAKE, never live AI.
// Harness use is limited to real Worker_Protocol fixture progression and reads.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test';
import type { Reply, Request, RequestTicket, RequestWithoutId, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { DECISION_CONTRACT } from '../../src/shared/decision-contract.ts';
import { DECISION_CONFIG_VERSION, isDecisionRequest, isModelDecision, type DecisionRequest, type ModelDecision } from '../../src/shared/decision.ts';

const ORIGIN = 'http://localhost:4173';
const WAITING_TICK = 1654;
// Manifest replay paths stay repository-relative; artifacts belong to each test's outputPath.
const REPOSITORY_DIRECTORY = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/parity/seedU-underworld.replay.json', import.meta.url), 'utf8')) as {
  seed: string; config: unknown; inputs: { tick: string; seq: string; payload: unknown }[];
};
interface ReadFaultWorker {
  postMessage(message: Request, ...options: unknown[]): void;
  addEventListener(type: 'message', listener: (event: { data: WorkerMessage }) => void, options?: { capture: boolean }): void;
}
interface ReadFaultProbe {
  failWorldReads: boolean;
  sent: { id: number; type: Request['type'] }[];
  replies: { id: number; type: Request['type']; worldId: number; tick: string | null; ok: boolean }[];
  failures: { worldId: number; tick: string | null }[];
}
// Node-only typecheck: the actual protocol hook and controlled transport probe.
declare const window: {
  __simHarness?: { request(request: RequestWithoutId): RequestTicket; exportReplay(): RequestTicket };
  scrollTo(x: number, y: number): void;
  readonly scrollY: number;
  Worker: { prototype: ReadFaultWorker };
  __c2ReadFault?: ReadFaultProbe;
};

async function offlineFake(context: BrowserContext, options: {
  enabled?: boolean; cap?: number; holdConfig?: boolean; families?: readonly DecisionRequest['family'][];
} = {}) {
  const attempts: { route: Route; request: DecisionRequest }[] = [];
  const cap = options.cap ?? 40;
  let configRoute: Route | undefined;
  const config = { version: DECISION_CONFIG_VERSION, enabled: options.enabled ?? true, session_cap: cap };
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== ORIGIN) { await route.abort('blockedbyclient'); return; }
    if (url.pathname === '/api/decision/config') {
      expect(request.method()).toBe('GET'); configRoute = route;
      if (!options.holdConfig) await route.fulfill({ json: config });
      return;
    }
    if (url.pathname === '/api/decision') {
      expect(request.method()).toBe('POST');
      const value: unknown = request.postDataJSON();
      // Reuse the sole closed wire schema and pinned production contract.
      expect(isDecisionRequest(value)).toBe(true);
      if (!isDecisionRequest(value)) throw Error('offline fake received invalid request');
      expect(options.families ?? ['dream_interpretation']).toContain(value.family);
      attempts.push({ route, request: value }); return;
    }
    if (url.pathname.startsWith('/api/')) { await route.abort('blockedbyclient'); return; }
    await route.continue();
  });
  function accepted(index: number): ModelDecision {
    const attempt = attempts[index];
    if (!attempt) throw Error('offline fake attempt is missing');
    const value: ModelDecision = { version: DECISION_CONTRACT.responseSchema, choice: attempt.request.criteria[0]!.id,
      model: DECISION_CONTRACT.model, mapping_version: DECISION_CONTRACT.mappingVersion,
      mapping_hash: DECISION_CONTRACT.mappingHash, fingerprint: DECISION_CONTRACT.fingerprint,
      usage: null, session_cap: cap };
    expect(isModelDecision(value, attempt.request)).toBe(true); return value;
  }
  return {
    attempts,
    async releaseConfig() {
      await expect.poll(() => configRoute !== undefined).toBe(true);
      await configRoute!.fulfill({ json: config });
    },
    async accept(index = 0) {
      await expect.poll(() => attempts.length).toBeGreaterThan(index);
      await attempts[index]!.route.fulfill({ json: accepted(index) });
    },
    async late(index = 0) {
      const json = accepted(index);
      // Chromium may discard an already-aborted intercepted worker request.
      // Only transport cancellation is tolerated; schema/assertion failures aren't.
      try { await attempts[index]!.route.fulfill({ json }); }
      catch (error) { expect(String(error)).toMatch(/closed|cancel|handled|interception|Invalid Interception/i); }
    },
    async invalid(index = 0) {
      await expect.poll(() => attempts.length).toBeGreaterThan(index);
      await attempts[index]!.route.fulfill({ json: { choice: 'provider text must never be rendered' } });
    },
  };
}
async function request(page: Page, value: RequestWithoutId): Promise<Reply> {
  return page.evaluate(async value => {
    if (!window.__simHarness) throw Error('Worker_Protocol harness is missing');
    return window.__simHarness.request(value).reply;
  }, value);
}
async function readWorld(page: Page): Promise<WorldSnapshot> {
  const reply = await request(page, { type: 'world-snapshot' });
  expect(reply.ok).toBe(true);
  if (!reply.ok || !reply.world) throw Error('completed World Snapshot is missing');
  return reply.world;
}
async function create(page: Page): Promise<void> {
  await page.getByTestId('seed').fill(fixture.seed);
  await page.getByTestId('config').fill(JSON.stringify(fixture.config));
  await page.getByTestId('create').click();
  await expect(page.getByTestId('tick')).toHaveText('0');
  await expect(page.getByTestId('run-state')).toHaveText('paused');
}
async function waiting(page: Page): Promise<void> {
  await create(page);
  const prefix = fixture.inputs.filter(input => BigInt(input.seq) < 61n).map(input => ({ tick: input.tick, payload: input.payload }));
  await page.evaluate(async ({ prefix, ticks }) => {
    const harness = window.__simHarness;
    if (!harness) throw Error('Worker_Protocol harness is missing');
    for (const input of prefix) {
      const reply = await harness.request({ type: 'submit', input: JSON.stringify(input) }).reply;
      if (!reply.ok) throw Error(`fixture submit failed: ${reply.kind}`);
    }
    for (let tick = 0; tick < ticks; tick++) {
      let reply = await harness.request({ type: 'step' }).reply;
      if (!reply.ok && reply.kind === 'node_unanswered') {
        const read = await harness.request({ type: 'world-snapshot' }).reply;
        if (!read.ok || !read.world?.player_node) throw Error('fixture node is missing');
        const node = read.world.player_node;
        const chosen = await harness.request({ type: 'choose', node: node.id, option: node.rules_default }).reply;
        if (!chosen.ok) throw Error('native fixture default was rejected');
        reply = await harness.request({ type: 'step' }).reply;
      }
      if (!reply.ok) throw Error(`fixture step failed: ${reply.kind}`);
    }
    const finalRead = await harness.request({ type: 'world-snapshot' }).reply;
    if (!finalRead.ok) throw Error('fixture final read failed');
    if (finalRead.snapshot.playerNode.pending && !finalRead.snapshot.playerNode.answered) {
      const node = finalRead.world?.player_node;
      if (!node) throw Error('fixture final node is missing');
      const chosen = await harness.request({ type: 'choose', node: node.id, option: node.rules_default }).reply;
      if (!chosen.ok) throw Error('native final fixture default was rejected');
    }
  }, { prefix, ticks: WAITING_TICK - 1 });
  // Native speed reply synchronizes the UI to this worker's completed tick;
  // then actual Step reaches waiting. Neither writes DOM or app state.
  await page.getByTestId('speed').selectOption('1');
  await expect(page.getByTestId('tick')).toHaveText(String(WAITING_TICK - 1));
  await expect(page.getByTestId('step')).toBeEnabled(); await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText(String(WAITING_TICK));
  await expect(page.getByTestId('underworld-panel')).toBeVisible();
  await expect(page.getByTestId('dream-send')).toBeEnabled();
  await page.getByTestId('dreamer').selectOption('31'); await page.getByTestId('dream-intent-urge').click();
  const world = await readWorld(page);
  expect(world.player.place).toBe('waiting'); expect(world.underworld_view?.connected).toContain(31);
  await expect(page.getByTestId('scene-dream')).toHaveCount(0);
}
async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('/?harness=1');
  await page.waitForFunction(() => window.__simHarness !== undefined);
  await expect(page.getByLabel('Decision wait (seconds)')).toHaveValue('10');
}
async function start(page: Page): Promise<{ tick: string; checksum: string }> {
  const tick = await page.getByTestId('tick').innerText(); const checksum = await page.getByTestId('checksum').innerText();
  await page.getByTestId('dream-send').click();
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'pending');
  await expect(page.getByTestId('use-rules-now')).toBeVisible();
  for (const id of ['run', 'pause', 'step', 'speed', 'dream-send', 'claim-imported_vessel', 'claim-rebuilt_body']) {
    await expect(page.getByTestId(id)).toBeDisabled();
  }
  await expect(page.getByTestId('create')).toBeEnabled(); await expect(page.getByTestId('decision-wait')).toBeEnabled();
  await expect(page.getByTestId('scene-dream')).toHaveCount(0); expect((await readWorld(page)).tick).toBe(tick);
  return { tick, checksum };
}
async function recorded(page: Page, kind: 'model' | 'fallback', before: { tick: string; checksum: string }): Promise<void> {
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', kind);
  await expect(page.getByTestId('decision-notice')).not.toBeEmpty();
  await expect(page.getByTestId('decision-notice')).not.toContainText(/provider text|quality|personality/i);
  await expect(page.getByTestId('use-rules-now')).toHaveCount(0);
  await expect(page.getByTestId('tick')).toHaveText(before.tick); await expect(page.getByTestId('checksum')).toHaveText(before.checksum);
  await expect(page.getByTestId('run-state')).toHaveText('paused'); await expect(page.getByTestId('scene-dream')).toHaveCount(0);
  await expect(page.getByTestId('underworld-recorded')).toBeVisible(); await expect(page.getByTestId('step')).toBeEnabled();
}
async function resolve(page: Page): Promise<void> {
  await page.getByTestId('step').click(); await expect(page.getByTestId('tick')).toHaveText(String(WAITING_TICK + 1));
  await expect(page.getByTestId('scene-dream')).toBeVisible();
  const world = await readWorld(page); expect(world.last_dream?.dreamer).toBe(31); expect(world.last_dream?.tick).toBe(String(WAITING_TICK));
}
async function capture(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath(name), fullPage });
}

async function evidence(page: Page, info: TestInfo, kind: 'acceptance' | 'fallback'): Promise<void> {
  const exported = await page.evaluate(async () => {
    if (!window.__simHarness) throw Error('read-only export hook is missing');
    return window.__simHarness.exportReplay().reply;
  });
  expect(exported.ok).toBe(true);
  if (!exported.ok || exported.replay === undefined) throw Error('live WASM export is missing');
  const replay = JSON.parse(exported.replay) as { version: number; ticks: string; inputs: { seq: string; tick: string; payload: Record<string, unknown> }[]; checksums: string[] };
  expect(replay.version).toBe(5); expect(replay.ticks).toBe(String(WAITING_TICK + 1)); expect(replay.checksums.length).toBe(WAITING_TICK + 1);
  const dream = replay.inputs.find(input => input.tick === String(WAITING_TICK) && 'Dream' in input.payload);
  expect(dream).toBeDefined();
  const appended = replay.inputs.filter(input => BigInt(input.seq) >= BigInt(dream!.seq));
  expect(appended.map(input => Object.keys(input.payload)[0])).toEqual(kind === 'acceptance' ? ['Dream', 'Choose'] : ['Dream']);
  expect(appended.every(input => input.tick === String(WAITING_TICK))).toBe(true);
  expect(exported.replay).not.toMatch(/provider text|input_tokens|output_tokens|mapping_hash|instructions|criteria|telemetry/);
  const name = `dream-${kind}.replay.json`; const path = info.outputPath(name);
  await writeFile(path, exported.replay); // Exactly WASM export bytes, never HTTP or reconstructed inputs.
  const manifest = { version: 1, corpus: 'scope-3.3-built-browser', mode: 'offline-fake-not-live-ai', operation: 'dream', outcome: kind,
    replay: relative(REPOSITORY_DIRECTORY, path), sha256: createHash('sha256').update(exported.replay).digest('hex'),
    provenance: { fixture: 'fixtures/parity/seedU-underworld.replay.json', prefix_seq_exclusive: '61', seed: fixture.seed,
      progression: 'Worker_Protocol submit/step; checked native default for any Player_Node', decision_seq: dream!.seq,
      controls: ['Create', 'Dreamer 31', 'urge', 'Send dream', 'Step'],
      export: 'SimClient.exportReplay -> Sim_Worker -> WasmSim.export_replay', ticks: replay.ticks } };
  await writeFile(info.outputPath(`dream-${kind}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  await info.attach(`offline-fake-dream-${kind}-v5`, { path, contentType: 'application/json' });
  await capture(page, info, `dream-${kind}-1280x720.png`);
}

async function liveReplay(page: Page): Promise<{ bytes: string; inputs: { payload: Record<string, unknown> }[]; checksums: string[] }> {
  const exported = await request(page, { type: 'export-replay' });
  expect(exported.ok).toBe(true);
  if (!exported.ok || exported.replay === undefined) throw Error('live WASM export is missing');
  const replay = JSON.parse(exported.replay) as { inputs: { payload: Record<string, unknown> }[]; checksums: string[] };
  return { bytes: exported.replay, inputs: replay.inputs, checksums: replay.checksums };
}

// Read-only comparison: a running read may fall between throttled statuses.
// Retry the observation, never pause, echo a reply, or alter the native clock.
async function displayedSnapshot(page: Page, runningAfter?: string): Promise<Snapshot> {
  let matched: Snapshot | undefined;
  await expect.poll(async () => {
    const read = await request(page, { type: 'world-snapshot' });
    expect(read.ok).toBe(true);
    if (!read.ok || !read.world) throw Error('completed World Snapshot is missing');
    const displayed = await Promise.all(['run-state', 'tick', 'checksum'].map(id => page.getByTestId(id).innerText()));
    const snapshot = read.snapshot;
    const current = displayed[0] === snapshot.runState && displayed[1] === snapshot.tick && displayed[2] === snapshot.checksum
      && (runningAfter === undefined || (snapshot.runState === 'running' && BigInt(snapshot.tick!) > BigInt(runningAfter)));
    if (current) matched = snapshot;
    return current;
  }, { intervals: [25, 50, 75], timeout: 5_000 }).toBe(true);
  if (matched === undefined) throw Error('display never matched a live Worker Snapshot');
  return matched;
}

for (const priorOutcome of [false, true]) {
  test(`offline fake rejected UI Dream ${priorOutcome ? 'with prior outcome' : 'without prior outcome'} recovers Run Pause Step against live snapshots`, async ({ page, context }, info) => {
    const fake = await offlineFake(context); await open(page); await waiting(page);
    if (priorOutcome) {
      const held = await start(page); await fake.accept(); await recorded(page, 'model', held); await resolve(page);
    }
    const world = await readWorld(page);
    const balance = world.joss.find(account => account.soul_id === world.player_soul)?.balance;
    expect(balance).toBeDefined(); expect(BigInt(balance!)).toBeGreaterThanOrEqual(BigInt(world.underworld_view!.dream_price));
    const unprepared = await liveReplay(page);
    // This is a genuine queued expenditure, not a state override. Rust preview
    // applies current-tick queued inputs; the completed UI World still has its
    // original balance and legally exposes Send dream. The Bribe has no adapter
    // outcome because submit uses the ordinary WASM input-stream path.
    const queued = await request(page, { type: 'submit', input: JSON.stringify({
      tick: world.tick, payload: { Bribe: { amount: balance } },
    }) });
    expect(queued.ok).toBe(true); expect(queued.snapshot.tick).toBe(world.tick);
    await expect(page.getByTestId('dream-send')).toBeEnabled();
    const before = await request(page, { type: 'decision-status' }); expect(before.ok).toBe(true);
    expect(before.snapshot.decision?.pending).toBeNull();
    expect(before.snapshot.decision?.outcome?.kind ?? null).toBe(priorOutcome ? 'model' : null);
    const retainedOutcome = before.snapshot.decision?.outcome ?? null;
    const beforeReplay = await liveReplay(page);
    expect(beforeReplay.inputs).toHaveLength(unprepared.inputs.length + 1);
    expect(beforeReplay.inputs.at(-1)?.payload).toEqual({ Bribe: { amount: balance } });
    const posts = fake.attempts.length; expect(posts).toBe(priorOutcome ? 1 : 0);
    const dreams = await page.getByTestId('scene-dream').count();
    await expect(page.getByTestId('underworld-recorded')).toHaveCount(0);

    // The rejected operation itself always goes through the existing UI button.
    await page.getByTestId('dream-send').click();
    await expect(page.getByTestId('underworld-error')).toHaveText('Rejected: Dream was not recorded. Check the available dreamer and joss paper.');
    await expect(page.getByTestId('decision-notice')).toBeEmpty();
    await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', '');
    await expect(page.getByTestId('use-rules-now')).toHaveCount(0);
    await expect(page.getByTestId('underworld-recorded')).toHaveCount(0);
    await expect(page.getByTestId('scene-dream')).toHaveCount(dreams);
    await expect(page.getByTestId('run')).toBeEnabled(); await expect(page.getByTestId('step')).toBeEnabled();
    const rejected = await request(page, { type: 'decision-status' }); expect(rejected.ok).toBe(true);
    expect(rejected.snapshot.decision?.pending).toBeNull(); expect(rejected.snapshot.decision?.outcome ?? null).toEqual(retainedOutcome);
    expect(rejected.snapshot.decision?.spent).toBe(before.snapshot.decision?.spent);
    expect(rejected.snapshot.tick).toBe(before.snapshot.tick); expect(rejected.snapshot.checksum).toBe(before.snapshot.checksum);
    const rejectedReplay = await liveReplay(page);
    expect(rejectedReplay.bytes).toBe(beforeReplay.bytes); expect(fake.attempts).toHaveLength(posts);
    await expect(page.getByTestId('tick')).toHaveText(rejected.snapshot.tick!);
    await expect(page.getByTestId('checksum')).toHaveText(rejected.snapshot.checksum!);
    await expect(page.getByTestId('run-state')).toHaveText('paused');

    await page.getByTestId('run').click();
    await expect(page.getByTestId('run-state')).toHaveText('running');
    await expect(page.getByTestId('pause')).toBeEnabled();
    await expect(page.getByTestId('underworld-error')).toHaveCount(0);
    const running = await displayedSnapshot(page, rejected.snapshot.tick!);
    expect(running.checksum).not.toBe(rejected.snapshot.checksum);
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('run-state')).toHaveText('paused');
    const paused = await displayedSnapshot(page);
    expect(BigInt(paused.tick!)).toBeGreaterThanOrEqual(BigInt(running.tick!));
    await expect(page.getByTestId('step')).toBeEnabled(); await page.getByTestId('step').click();
    await expect(page.getByTestId('tick')).toHaveText(String(BigInt(paused.tick!) + 1n));
    const stepped = await displayedSnapshot(page);
    expect(stepped.runState).toBe('paused'); expect(stepped.checksum).not.toBe(paused.checksum);
    const recoveredReplay = await liveReplay(page);
    expect(recoveredReplay.inputs).toEqual(beforeReplay.inputs);
    expect(recoveredReplay.checksums.at(-1)).toBe(stepped.checksum);
    for (const snapshot of [running, paused, stepped]) {
      expect(snapshot.decision?.outcome ?? null).toEqual(retainedOutcome); expect(snapshot.decision?.pending).toBeNull();
      expect(snapshot.decision?.spent).toBe(before.snapshot.decision?.spent);
    }
    expect(fake.attempts).toHaveLength(posts);
    await expect(page.getByTestId('decision-notice')).toBeEmpty();
    await expect(page.getByTestId('underworld-recorded')).toHaveCount(0);
    await expect(page.getByTestId('underworld-error')).toHaveCount(0);
    await expect(page.getByTestId('scene-dream')).toHaveCount(0);

    // Only bounded counters and tick/checksum/outcome IDs leave this test.
    // Queued preparation input and rejected Dream are compared above, not saved.
    function mark(snapshot: Snapshot, replayInputs: number) {
      return { tick: snapshot.tick, checksum: snapshot.checksum, outcomeId: snapshot.decision?.outcome?.requestId ?? null,
        requestCounts: { posts: fake.attempts.length, decisions: snapshot.decision?.spent ?? 0, replayInputs } };
    }
    const name = `dream-rejected-${priorOutcome ? 'prior-outcome' : 'no-outcome'}.json`;
    const path = info.outputPath(name);
    await writeFile(path, `${JSON.stringify({ mode: 'offline-fake-not-live-ai',
      before: mark(before.snapshot, beforeReplay.inputs.length), rejected: mark(rejected.snapshot, rejectedReplay.inputs.length),
      recovered: { running: mark(running, recoveredReplay.inputs.length), paused: mark(paused, recoveredReplay.inputs.length),
        stepped: mark(stepped, recoveredReplay.inputs.length) },
    }, null, 2)}\n`);
    await info.attach(name, { path, contentType: 'application/json' });
  });
}

test('offline fake acceptance drives Dream controls and produces a completed live v5 export', async ({ page, context }, info) => {
  const fake = await offlineFake(context, { cap: 1 }); await open(page); await waiting(page);
  const before = await start(page);
  await capture(page, info, 'dream-pending-1280x720.png');
  const wait = page.getByLabel('Decision wait (seconds)');
  await wait.focus(); await expect(wait).toBeFocused(); await wait.selectOption('2'); await expect(wait).toHaveValue('2');
  await fake.accept(); await recorded(page, 'model', before); await resolve(page); await evidence(page, info, 'acceptance');
  await expect(page.getByTestId('decision-diagnostics')).toContainText('1/1');
  // Replacing the World retains cap and future wait. Exhaustion makes no new POST.
  await waiting(page); await expect(wait).toHaveValue('2');
  const replaced = { tick: await page.getByTestId('tick').innerText(), checksum: await page.getByTestId('checksum').innerText() };
  await page.getByTestId('dream-send').click(); await recorded(page, 'fallback', replaced); expect(fake.attempts).toHaveLength(1);
});

test('offline fake invalid response records rules and exports fallback without provider text', async ({ page, context }, info) => {
  const fake = await offlineFake(context); await open(page); await waiting(page);
  const before = await start(page); await fake.invalid(); await recorded(page, 'fallback', before);
  await resolve(page); await evidence(page, info, 'fallback'); expect(fake.attempts).toHaveLength(1);
});

test('offline fake manual cancellation binds the current request through a newer Dream', async ({ page, context }, info) => {
  const fake = await offlineFake(context); await open(page); await waiting(page);
  const first = await start(page); await expect.poll(() => fake.attempts.length).toBe(1);
  const button = page.getByRole('button', { name: 'Use rules now', exact: true });
  await button.focus(); await expect(button).toBeFocused(); await button.press('Enter'); await recorded(page, 'fallback', first);
  await waiting(page); const second = await start(page); await expect.poll(() => fake.attempts.length).toBe(2);
  await fake.late(0);
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'pending');
  await page.getByTestId('use-rules-now').click(); await recorded(page, 'fallback', second);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.getByTestId('decision-controls').boundingBox();
  expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await capture(page, info, 'dream-rules-mobile-390x844-fullpage.png', true);
});

test('offline fake World replacement cancels held Dream without locking Create or adopting stale result', async ({ page, context }) => {
  const fake = await offlineFake(context); await open(page); await waiting(page); await start(page);
  await expect.poll(() => fake.attempts.length).toBe(1);
  await page.getByTestId('decision-wait').selectOption('0'); await create(page);
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', '');
  await expect(page.getByTestId('decision-notice')).toBeEmpty(); await expect(page.getByTestId('use-rules-now')).toHaveCount(0);
  await expect(page.getByTestId('decision-wait')).toHaveValue('0'); await expect(page.getByTestId('decision-diagnostics')).toContainText('1/40');
  await fake.late();
  await expect(page.getByTestId('tick')).toHaveText('0'); await expect(page.getByTestId('run')).toBeEnabled();
  await expect(page.getByTestId('scene-dream')).toHaveCount(0); await waiting(page);
  const before = { tick: await page.getByTestId('tick').innerText(), checksum: await page.getByTestId('checksum').innerText() };
  await page.getByTestId('dream-send').click(); await recorded(page, 'fallback', before); expect(fake.attempts).toHaveLength(1);
});

test('offline fake deadline keeps the active wait after future preference changes to zero', async ({ page, context }) => {
  const fake = await offlineFake(context); await open(page); await waiting(page);
  await page.getByTestId('decision-wait').selectOption('10');
  const before = await start(page); await expect.poll(() => fake.attempts.length).toBe(1);
  await page.getByTestId('decision-wait').selectOption('0'); await expect(page.getByTestId('decision-wait')).toHaveValue('0');
  // Observe a real worker deadline; never fake its timers or app state.
  await page.waitForTimeout(300); await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'pending');
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'fallback', { timeout: 12_000 });
  await recorded(page, 'fallback', before); expect(fake.attempts).toHaveLength(1); await resolve(page);
});

test('offline fake pending config and disabled adapter keep rules-only Dream controls with zero POSTs', async ({ page, context }) => {
  const fake = await offlineFake(context, { holdConfig: true, enabled: false }); await open(page); await create(page);
  await expect(page.getByTestId('decision-diagnostics')).toContainText('pending');
  await page.getByTestId('decision-wait').selectOption('0'); await expect(page.getByTestId('decision-wait')).toHaveValue('0');
  await fake.releaseConfig(); await waiting(page); await expect(page.getByTestId('decision-diagnostics')).toContainText('disabled');
  const before = { tick: await page.getByTestId('tick').innerText(), checksum: await page.getByTestId('checksum').innerText() };
  await page.getByTestId('dream-send').click(); await recorded(page, 'fallback', before); await resolve(page);
  expect(fake.attempts).toHaveLength(0);
});

test('offline fake running Dream holds the native clock and resumes only to the resolution tick', async ({ page, context }) => {
  const fake = await offlineFake(context); await open(page); await waiting(page);
  await page.getByTestId('run').click(); await expect(page.getByTestId('run-state')).toHaveText('running');
  await page.getByTestId('dream-send').click();
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'pending');
  await expect.poll(() => fake.attempts.length).toBe(1);
  const status = await request(page, { type: 'decision-status' });
  expect(status.snapshot.runState).toBe('running'); expect(status.snapshot.decision?.pending).not.toBeNull();
  const tick = status.snapshot.tick!; const checksum = status.snapshot.checksum!;
  await expect(page.getByTestId('tick')).toHaveText(tick); await expect(page.getByTestId('tps')).toHaveText('—');
  await expect(page.getByTestId('pause')).toBeDisabled(); await expect(page.getByTestId('step')).toBeDisabled();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('tick')).toHaveText(tick); await expect(page.getByTestId('checksum')).toHaveText(checksum);
  await expect(page.getByTestId('scene-dream')).toHaveCount(0);
  await page.getByTestId('use-rules-now').click();
  await expect(page.getByTestId('run-state')).toHaveText('paused');
  await expect(page.getByTestId('tick')).toHaveText(String(Number(tick) + 1));
  await expect(page.getByTestId('scene-dream')).toBeVisible();
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'fallback');
});

test('offline fake both families share one completed tick with trigger-sequence attribution in the live v5 export', async ({ page, context }, info) => {
  const fake = await offlineFake(context, { families: ['dream_interpretation', 'magistrate_ruling'] });
  await open(page); await waiting(page);
  const before = await start(page);
  await expect.poll(() => fake.attempts.length).toBe(1);
  const dreamStatus = await request(page, { type: 'decision-status' });
  const dreamTrigger = dreamStatus.snapshot.decision?.pending?.trigger;
  expect(dreamTrigger).not.toBeNull(); expect(dreamTrigger).toBeDefined();
  expect(fake.attempts[0]!.request.family).toBe('dream_interpretation');
  await fake.accept(); await recorded(page, 'model', before);

  // No Step between these operations. The second Rust preview must account for
  // the queued CarryOver and the earlier Dream/Choose, not just the tick number.
  // Bribe stays internal: this is the typed SimClient/Worker_Protocol seam.
  const bribe = request(page, { type: 'bribe', amount: '1' });
  await expect.poll(() => fake.attempts.length).toBe(2);
  await expect(page.getByTestId('decision-notice')).toHaveAttribute('data-outcome', 'pending');
  const bribeStatus = await request(page, { type: 'decision-status' });
  const bribeTrigger = bribeStatus.snapshot.decision?.pending?.trigger;
  expect(bribeTrigger).not.toBeNull(); expect(bribeTrigger).toBeDefined();
  expect(bribeStatus.snapshot.tick).toBe(before.tick);
  expect(bribeStatus.snapshot.checksum).toBe(before.checksum);
  expect(BigInt(bribeTrigger!)).toBe(BigInt(dreamTrigger!) + 2n);
  expect(fake.attempts[1]!.request.family).toBe('magistrate_ruling');
  await fake.accept(1);
  const bribeReply = await bribe;
  expect(bribeReply.ok).toBe(true);
  const bribeOutcome = bribeReply.snapshot.decision?.outcome;
  expect(bribeOutcome?.kind).toBe('model');
  if (bribeOutcome?.kind !== 'model') throw Error('internal Bribe model terminal reply is missing');
  expect(bribeOutcome.requestId).toBe(bribeReply.id);
  expect(bribeOutcome.worldId).toBe(bribeReply.snapshot.worldId);
  expect(bribeOutcome.option).toBe(fake.attempts[1]!.request.criteria[0]!.id);
  expect(bribeReply.snapshot.decision?.pending).toBeNull();
  const terminal = await request(page, { type: 'decision-status' });
  expect(terminal.ok).toBe(true);
  expect(terminal.snapshot.decision?.pending).toBeNull();
  expect(terminal.snapshot.decision?.outcome).toEqual(bribeOutcome);
  expect(terminal.snapshot.decision?.spent).toBe(2);
  expect(terminal.snapshot.tick).toBe(before.tick);
  expect(terminal.snapshot.checksum).toBe(before.checksum);
  expect(terminal.snapshot.runState).toBe('paused');
  expect((await readWorld(page)).tick).toBe(before.tick);
  // The harness receives the internal Bribe reply, not App.onDream's settle
  // callback. Do not require a Dream UI completion notice for that internal
  // operation. Advance through the same controller's real typed Step instead;
  // its worker-initiated resolution status still renders the actual Dream scene.
  const completed = await request(page, { type: 'step' });
  expect(completed.ok).toBe(true);
  expect(completed.snapshot.tick).toBe(String(WAITING_TICK + 1));
  await expect(page.getByTestId('tick')).toHaveText(String(WAITING_TICK + 1));
  await expect(page.getByTestId('scene-dream')).toBeVisible();
  const resolved = await readWorld(page);
  expect(resolved.last_dream?.dreamer).toBe(31);
  expect(resolved.last_dream?.tick).toBe(before.tick);

  const exported = await page.evaluate(async () => {
    if (!window.__simHarness) throw Error('read-only export hook is missing');
    return window.__simHarness.exportReplay().reply;
  });
  expect(exported.ok).toBe(true);
  if (!exported.ok || exported.replay === undefined) throw Error('live WASM export is missing');
  const replay = JSON.parse(exported.replay) as {
    version: number; ticks: string; checksums: string[];
    inputs: { seq: string; tick: string; payload: Record<string, unknown> }[];
  };
  expect(replay.version).toBe(5); expect(replay.ticks).toBe(String(WAITING_TICK + 1));
  expect(replay.checksums).toHaveLength(WAITING_TICK + 1);
  expect(replay.checksums[WAITING_TICK]).toBe(completed.snapshot.checksum);
  const carryOver = replay.inputs.find(input => input.tick === before.tick && 'CarryOver' in input.payload);
  expect(carryOver).toBeDefined(); expect(BigInt(carryOver!.seq)).toBeLessThan(BigInt(dreamTrigger!));
  const paired = replay.inputs.filter(input => BigInt(input.seq) >= BigInt(dreamTrigger!));
  expect(paired.map(input => Object.keys(input.payload)[0])).toEqual(['Dream', 'Choose', 'Bribe', 'Choose']);
  expect(paired.every(input => input.tick === before.tick && BigInt(input.tick) < BigInt(replay.ticks))).toBe(true);
  expect(paired[0]!.seq).toBe(dreamTrigger); expect(paired[2]!.seq).toBe(bribeTrigger);
  for (const [offset, trigger] of [[1, dreamTrigger], [3, bribeTrigger]] as const) {
    const choose = paired[offset]!.payload.Choose as { node: { Trigger: { seq: string } }; option: string; fingerprint: string };
    expect(choose.node.Trigger.seq).toBe(trigger);
    expect(choose.fingerprint).toBe(DECISION_CONTRACT.fingerprint);
    expect(choose.option).toBe(fake.attempts[(offset - 1) / 2]!.request.criteria[0]!.id);
  }
  expect(exported.replay).not.toMatch(/input_tokens|output_tokens|mapping_hash|instructions|criteria|telemetry/);
  const path = info.outputPath('both-families.replay.json');
  await writeFile(path, exported.replay); // Exact completed live WASM bytes, not reconstructed inputs.
  const manifest = {
    version: 1, corpus: 'scope-4.1-built-browser-same-tick', mode: 'offline-fake-not-live-ai',
    replay: relative(REPOSITORY_DIRECTORY, path),
    sha256: createHash('sha256').update(exported.replay).digest('hex'),
    completed_ticks: replay.ticks, trigger_tick: before.tick,
    decisions: [
      { family: 'dream_interpretation', trigger_seq: dreamTrigger, outcome: 'offline-fake-model-accepted' },
      { family: 'magistrate_ruling', trigger_seq: bribeTrigger, outcome: 'offline-fake-model-accepted' },
    ],
    provenance: {
      fixture: 'fixtures/parity/seedU-underworld.replay.json', prefix_seq_exclusive: '61', seed: fixture.seed,
      earlier_same_tick_carry_over_seq: carryOver!.seq,
      progression: 'Worker_Protocol submit/step and checked Rust Player_Node defaults; no Step between Dream and Bribe; typed Step completes their shared firing tick',
      controls: ['Create', 'Dreamer 31', 'urge', 'Send dream', 'Step'],
      internal_operation: 'typed bribe amount 1 and resolution step through existing harness -> SimClient -> Sim_Worker',
      export: 'SimClient.exportReplay -> Sim_Worker -> WasmSim.export_replay',
    },
    limits: 'Offline fake choice acceptance only; native replay audit supplies resolved source/default comparisons, not request-attempt or error rates.',
  };
  await writeFile(info.outputPath('both-families.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await info.attach('offline-fake-both-families-v5', { path, contentType: 'application/json' });
});

test('LV-C2 controlled preissuance World-read transport fault stays bound to the paused tick without recursion or automatic retry', async ({ page, context }, info) => {
  await offlineFake(context, { enabled: false });
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const fault = 'controlled World-read postMessage failure';
  // Controlled synchronous transport fault, not a naturally observed failure.
  // All other messages still reach the page's actual SimClient/Worker/WASM.
  await page.addInitScript(({ fault }) => {
    const probe: ReadFaultProbe = window.__c2ReadFault = { failWorldReads: false, sent: [], replies: [], failures: [] };
    const attached = new WeakSet<ReadFaultWorker>();
    const frames = new WeakMap<ReadFaultWorker, { worldId: number; tick: string | null }>();
    const addEventListener = window.Worker.prototype.addEventListener;
    window.Worker.prototype.addEventListener = function(this: ReadFaultWorker, type, listener, options) {
      if (type === 'message' && !attached.has(this)) {
        attached.add(this);
        // Register first: capture does not reorder listeners on a Worker.
        // This only records native evidence; it never writes UiState or the DOM.
        addEventListener.call(this, 'message', ({ data }) => {
          if (data.type === 'fatal') return;
          frames.set(this, { worldId: data.snapshot.worldId, tick: data.snapshot.tick });
          if (data.type === 'reply') {
            const sent = probe.sent.find(entry => entry.id === data.id);
            if (sent !== undefined) probe.replies.push({ id: data.id, type: sent.type,
              worldId: data.snapshot.worldId, tick: data.snapshot.tick, ok: data.ok });
          }
        });
      }
      addEventListener.call(this, type, listener, options);
    };
    const postMessage = window.Worker.prototype.postMessage;
    window.Worker.prototype.postMessage = function(this: ReadFaultWorker, message, ...options) {
      probe.sent.push({ id: message.id, type: message.type });
      if (message.type === 'world-snapshot' && probe.failWorldReads) {
        const frame = frames.get(this);
        if (frame === undefined) throw Error('controlled World-read fault has no native frame');
        probe.failures.push(frame);
        throw Error(fault);
      }
      postMessage.call(this, message, ...options);
    };
  }, { fault });
  await open(page);
  await create(page);
  await expect(page.getByTestId('current-name')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__c2ReadFault!.replies.filter(reply => reply.type === 'world-snapshot').length)).toBe(1);
  await page.evaluate(() => { window.__c2ReadFault!.failWorldReads = true; });
  await page.getByTestId('step').click();
  await expect(page.getByTestId('tick')).toHaveText('1');
  await expect(page.getByTestId('run-state')).toHaveText('paused');
  await expect(page.getByTestId('error')).toHaveText(`Error: ${fault}`);
  await expect(page.getByTestId('world-as-of')).toHaveText('World resources and eligibility as of tick 0.');
  await expect(page.getByTestId('step')).toBeEnabled();
  await expect(page.getByTestId('run')).toBeEnabled();
  await expect(page.getByTestId('action-feedback')).toHaveCount(0);
  expect(await page.evaluate(() => window.__c2ReadFault!.failures)).toEqual([{ worldId: 1, tick: '1' }]);
  await capture(page, info, 'c2-preissue-read-fault-1280x720.png');

  // Real preference controls dispatch fresh request/reply events at this same
  // tick. The failed read demand must stay suppressed through every dispatch.
  await page.getByTestId('decision-wait').selectOption('0');
  await expect.poll(() => page.evaluate(() => window.__c2ReadFault!.replies.filter(reply => reply.type === 'set-decision-wait' && reply.ok).length)).toBe(1);
  await page.getByTestId('speed').selectOption('7');
  await expect.poll(() => page.evaluate(() => window.__c2ReadFault!.replies.filter(reply => reply.type === 'set-speed' && reply.ok).length)).toBe(1);
  const native = await request(page, { type: 'decision-status' });
  expect(native.ok).toBe(true);
  expect(native.snapshot.worldId).toBe(1);
  expect(native.snapshot.tick).toBe('1');
  expect(native.snapshot.runState).toBe('paused');
  await expect(page.getByTestId('checksum')).toHaveText(native.snapshot.checksum!);
  await expect(page.getByTestId('tick')).toHaveText('1');
  await expect(page.getByTestId('world-as-of')).toHaveText('World resources and eligibility as of tick 0.');
  const observed = await page.evaluate(() => window.__c2ReadFault!);
  expect(observed.failWorldReads).toBe(true);
  expect(observed.failures).toEqual([{ worldId: 1, tick: '1' }]);
  expect(observed.sent.filter(message => message.type === 'world-snapshot')).toHaveLength(2); // Initial successful read + exactly one failed start.
  expect(observed.sent.filter(message => message.type === 'create-world')).toHaveLength(1);
  expect(observed.sent.filter(message => message.type === 'step')).toHaveLength(1);
  expect(observed.sent.filter(message => message.type === 'run')).toHaveLength(0);
  expect(observed.replies.filter(reply => reply.type === 'step')).toEqual([
    { id: observed.sent.find(message => message.type === 'step')!.id, type: 'step', worldId: 1, tick: '1', ok: true },
  ]);
  expect(pageErrors).toEqual([]);
  await info.attach('controlled-preissuance-world-read-fault', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    mode: 'controlled-postMessage-fault-not-natural-production-trigger', observed, nativeSnapshot: native.snapshot,
  }, null, 2)) });
});
