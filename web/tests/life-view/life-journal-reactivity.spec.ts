/// <reference lib="dom" />
// COMPONENT-ONLY: production reducer -> reactive UiState parent -> LifeSurface -> LifeJournal.
// The existing Vite entry is routed only for this test. Function-entry probes count
// real executions and never replace a function, its arguments, return value or UI.
import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/shared/protocol.ts';
import type { StoryBatch } from '../../src/shared/story.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { verifyApplicationRequirements } from './application-requirements.ts';

const COMPONENT = process.env.LIFE_PACE_COMPONENT_ORIGIN ?? 'http://localhost:5174';
const functions = ['journalRange', 'journalMemberLines', 'journalTownPromotion'] as const;
type JournalFunction = typeof functions[number];
interface Call {
  revision: number;
  playerSoul: string;
  currentBody: number | null;
  section?: string;
  end?: number;
  start?: number;
  members?: number;
  event?: string;
}
type Calls = Record<JournalFunction, Call[]>;
type Counts = Record<JournalFunction, number>;
interface Evidence {
  snapshot: Snapshot;
  world: WorldSnapshot;
  renderRevision: number;
  transition: Record<string, boolean> | null;
}
declare const window: Window & {
  __journalCalls: Calls;
  __journalReactivity: { read(): Evidence; status(patch: Partial<Snapshot>): Promise<void> };
  __lifeViewFixture: { read(): { ui: { world: WorldSnapshot } } };
};

async function isolated(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== COMPONENT && !['data:', 'blob:'].includes(url.protocol)) {
      errors.push(`Off-origin request: ${url.origin}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return errors;
}

async function openJournal(page: Page): Promise<string[]> {
  const errors = await isolated(page);
  await page.addInitScript(() => {
    window.__journalCalls = { journalRange: [], journalMemberLines: [], journalTownPromotion: [] };
  });
  await page.route('**/src/main/life-journal.ts*', async route => {
    const response = await route.fetch();
    let source = await response.text();
    for (const name of functions) {
      const context = name === 'journalTownPromotion' ? 'fallback' : 'context';
      const extra = name === 'journalRange' ? ', section, end'
        : name === 'journalMemberLines' ? ', start, members: group.members.length' : ', event: event.id';
      // Vite has already stripped TypeScript. Insert a passive observation at
      // the actual entry; matching the declaration is instrumentation, not an oracle.
      const entry = new RegExp(`\\bfunction ${name}\\([^\\n]*\\)\\s*\\{`);
      let instrumented = false;
      source = source.replace(entry, declaration => {
        instrumented = true;
        return `${declaration}\nglobalThis.__journalCalls.${name}.push({ revision: notebook.renderRevision, playerSoul: ${context}.playerSoul, currentBody: ${context}.currentBody${extra} });`;
      });
      if (!instrumented) throw Error(`Cannot install the test-only ${name} entry probe`);
    }
    await route.fulfill({ response, contentType: 'application/javascript', body: source });
  });
  await page.route('**/tests/fixtures/life-view.ts', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const mountImport = source.match(/^import\s+\{[^\n]*\bmount\b[^\n]*\}\s+from\s+['"][^'"]+['"];?/m)?.[0];
    const baselineImport = source.match(/^import\s+baselineBytes\s+from\s+['"][^'"]+['"];?/m)?.[0];
    if (!mountImport || !baselineImport) throw Error('The existing Vite fixture entry imports are missing');
    await route.fulfill({ response, contentType: 'application/javascript', body: `${mountImport}
${baselineImport}
import JournalReactivityFixture from '/tests/fixtures/JournalReactivityFixture.svelte';
import { initialUiState } from '/src/main/ui-state.ts';
import { appendStory, createNotebook } from '/src/main/life-journal.ts';
import '/src/ui/life.css';
const world = JSON.parse(baselineBytes);
const soulId = value => /^S-[0-9]+$/.test(value) ? BigInt(value.slice(2)).toString() : value;
world.player_soul = soulId(world.player_soul);
for (const person of world.residents) person.soul_id = soulId(person.soul_id);
world.magistrate.soul_id = soulId(world.magistrate.soul_id);
for (const soul of world.souls) soul.soul_id = soulId(soul.soul_id);
for (const account of world.joss) account.soul_id = soulId(account.soul_id);
const focus = world.player.body;
const others = world.residents.filter(person => person.id !== focus);
const second = others[0].id;
const third = others[1].id;
const actorContext = [focus, third].map(relativeTo => ({ relativeTo, basis: 'observed-day-start', actors: [] }));
const event = (id, tick, kind, relevance = 'self', causedBy = []) => ({ id: String(id), tick: String(tick), kind,
  relevance, causedBy, tags: 0, relevanceBasis: 'observed-day-start-end', actorContext });
// Deliberately constructed facts: 121 milestones, a 30-member repayment span,
// and one promotable town dream. Ingest before the first World binding to cover
// the supported uncaptured-entry fallback as well as the real parent getter chain.
const batch = { version: 1, opening: false,
  actors: world.residents.map(person => ({ person: person.id, soulId: person.soul_id, name: person.name,
    sex: person.sex, origin: person.origin })),
  events: [
    ...Array.from({ length: 121 }, (_, index) => event(1000 + index, index + 1, { type: 'marriage', a: focus, b: second })),
    ...Array.from({ length: 30 }, (_, index) => event(2000 + index, 200 + index,
      { type: 'repayment', payer: focus, payee: second, amount: String(index + 1) }, 'self', ['800'])),
    event(3000, 240, { type: 'dream', ghost: focus, dreamer: second, price: '7' }, 'background'),
  ], chronicle: [], dreams: [],
  cursors: { events: { start: '0', end: '3001' }, chronicle: { start: '0', end: '0' } } };
const facts = appendStory(createNotebook(1), [{ worldId: 1, batch }]);
const notebook = appendStory(facts, [], { world });
const initialUi = { ...initialUiState(), worldId: 1, world, notebook, runState: 'running', tick: world.tick,
  checksum: '0123456789abcdef', tps: 10, speed: 1,
  playerNode: world.player_node === null ? { pending: false } : { pending: true, node: world.player_node.id, answered: false } };
mount(JournalReactivityFixture, { target: document.getElementById('fixture'), props: { initialUi } });
` });
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await page.goto(`${COMPONENT}/life-view-fixture.html?state=living`);
  await expect(page.getByTestId('life-surface')).toBeVisible();
  await expect(page.locator('#life-journal-accounts > ol > li')).toHaveCount(120);
  return errors;
}
async function read(page: Page): Promise<Evidence> {
  return page.evaluate(() => window.__journalReactivity.read());
}
async function status(page: Page, patch: Partial<Snapshot>): Promise<void> {
  await page.evaluate(patch => window.__journalReactivity.status(patch), patch);
}
async function calls(page: Page): Promise<Calls> {
  return page.evaluate(() => window.__journalCalls);
}
async function counts(page: Page): Promise<Counts> {
  const actual = await calls(page);
  return { journalRange: actual.journalRange.length, journalMemberLines: actual.journalMemberLines.length,
    journalTownPromotion: actual.journalTownPromotion.length };
}
function expectRecomputed(before: Counts, after: Counts): void {
  for (const name of functions) expect(after[name], `${name} executes again for a real rendering dependency`).toBeGreaterThan(before[name]);
}

test('ordinary Playing Status leaves actual journal executions unchanged, while identity and facts still render', async ({ page }, info) => {
  const errors = await openJournal(page);
  const notebook = page.locator('.notebook');
  const rows = page.locator('#life-journal-accounts > ol > li');
  const range = notebook.locator('.history-range');
  const latest = await rows.locator(':scope > .account-text').allTextContents();
  await range.getByRole('button', { name: 'Earlier', exact: true }).click();
  await expect(rows).toHaveCount(120);
  expect(await rows.locator(':scope > .account-text').allTextContents()).not.toEqual(latest);
  await range.getByRole('button', { name: 'Latest', exact: true }).click();
  await expect(rows).toHaveCount(120);
  expect(await rows.locator(':scope > .account-text').allTextContents()).toEqual(latest);

  await notebook.locator('.read-members').click();
  const members = notebook.locator('.member-accounts > ol > li');
  await expect(members).toHaveCount(24);
  const firstMemberPage = await members.allTextContents();
  const memberNavigation = notebook.locator('.member-navigation');
  await memberNavigation.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(members).toHaveCount(6);
  expect(await members.allTextContents()).not.toEqual(firstMemberPage);
  await memberNavigation.getByRole('button', { name: 'Earlier', exact: true }).click();
  await expect(members).toHaveCount(24);
  expect(await members.allTextContents()).toEqual(firstMemberPage);

  // Drive the production promotion interval; do not set its private state.
  await page.clock.runFor(5501);
  const promotion = notebook.locator('.town-note > p');
  await expect(promotion).toBeVisible();
  const initial = await read(page);
  const before = await counts(page);
  for (const name of functions) expect(before[name], `${name} must actually have been exercised`).toBeGreaterThan(0);
  const stages: { name: string; counts: Counts }[] = [{ name: 'expanded-and-promoted', counts: before }];
  const textBefore = { members: await members.allTextContents(), promotion: await promotion.innerText() };

  for (let frame = 1; frame <= 8; frame++) {
    await status(page, { runState: 'running', tick: String(500 + frame), tps: 10 + frame,
      checksum: (1000 + frame).toString(16).padStart(16, '0') });
    await expect(page.getByTestId('journal-status-tick')).toHaveText(String(500 + frame));
    expect((await read(page)).transition).toEqual({ rootChanged: true, worldSame: true, notebookSame: true,
      worldKeySame: true, soulSame: true, bodySame: true, revisionSame: true });
    expect(await counts(page), `ordinary Playing Status ${frame} adds zero executions`).toEqual(before);
  }
  expect(await members.allTextContents()).toEqual(textBefore.members);
  expect(await promotion.innerText()).toBe(textBefore.promotion);
  stages.push({ name: 'eight-ordinary-statuses', counts: await counts(page) });

  // A delayed frame must not roll back the clock, speed, body or prose roots.
  await status(page, { tick: '499', runState: 'paused', speed: 17,
    stop: { reasons: ['user'], world: { ...initial.world, tick: '499' } } });
  const afterOld = await read(page);
  expect(afterOld.snapshot).toMatchObject({ tick: '508', runState: 'running', speed: 1 });
  expect(afterOld.world).toEqual(initial.world);
  expect(afterOld.renderRevision).toBe(initial.renderRevision);
  expect(await counts(page)).toEqual(before);
  await status(page, { worldId: 0, tick: '900', runState: 'paused' });
  expect((await read(page)).snapshot).toEqual(afterOld.snapshot);
  expect(await counts(page)).toEqual(before);
  stages.push({ name: 'old-frame-and-foreign-world', counts: await counts(page) });

  const focus = initial.world.residents.find(person => person.id === initial.world.player.body)!;
  const others = initial.world.residents.filter(person => person.id !== focus.id);
  const nextBody = others[1]!;
  const changedWorld: WorldSnapshot = { ...initial.world, tick: '509', player_soul: nextBody.soul_id,
    player: { ...initial.world.player, body: nextBody.id } };
  await status(page, { tick: '509', runState: 'paused', stop: { reasons: ['user'], world: changedWorld } });
  const identity = await read(page);
  expect(identity.transition).toMatchObject({ rootChanged: true, worldSame: false, soulSame: false,
    bodySame: false, worldKeySame: true, revisionSame: true });
  expect(identity.world.player_soul).toBe(nextBody.soul_id);
  expect(identity.world.player.body).toBe(nextBody.id);
  const afterIdentity = await counts(page);
  expectRecomputed(before, afterIdentity);
  await expect(rows).toHaveCount(120);
  await expect(members).toHaveCount(24);
  await expect(notebook.locator('.member-accounts')).toContainText(focus.name);
  await expect(promotion).toContainText(focus.name);
  expect(await rows.locator(':scope > .account-text').allTextContents()).not.toEqual(latest);
  expect(await members.allTextContents()).not.toEqual(textBefore.members);
  expect(await promotion.innerText()).not.toBe(textBefore.promotion);
  stages.push({ name: 'actual-soul-and-body-change', counts: afterIdentity });

  // A new factual annotation changes a real visible town account without
  // introducing a new primary identity (which would intentionally dismiss it).
  const factual: StoryBatch = { version: 1, opening: false, actors: [], events: [], chronicle: [],
    dreams: [{ eventId: '3000', inputSeq: '1', tick: '240', ghost: focus.id,
      dreamer: others[0]!.id, intent: 'warn', price: '7' }],
    cursors: { events: { start: '3001', end: '3001' }, chronicle: { start: '0', end: '0' } } };
  const promotionBeforeFact = await promotion.innerText();
  await status(page, { tick: '510', story: [{ worldId: identity.snapshot.worldId, batch: factual }] });
  const revised = await read(page);
  expect(revised.renderRevision).toBe(identity.renderRevision + 1);
  expect(revised.transition).toMatchObject({ rootChanged: true, worldSame: true,
    worldKeySame: true, soulSame: true, bodySame: true, revisionSame: false });
  const afterFact = await counts(page);
  expectRecomputed(afterIdentity, afterFact);
  await expect(promotion).toBeVisible();
  expect(await promotion.innerText()).not.toBe(promotionBeforeFact);
  await expect(rows).toHaveCount(120);
  await expect(members).toHaveCount(24);
  stages.push({ name: 'new-factual-render-revision', counts: afterFact });
  const actualCalls = await calls(page);
  expect(actualCalls.journalMemberLines.every(call => call.members === 30 && [0, 24].includes(call.start!))).toBe(true);
  await info.attach('journal-actual-execution-counts', { contentType: 'application/json',
    body: JSON.stringify({ stages, ordinaryStatusDelta: Object.fromEntries(functions.map(name => [name, stages[1]!.counts[name] - before[name]])), calls: actualCalls }, null, 2) });
  expect(errors).toEqual([]);
});

test('waiting-large production requirements explain every named carrier condition visibly', async ({ page }) => {
  const errors = await isolated(page);
  await page.goto(`${COMPONENT}/life-view-fixture.html?state=waiting-large`);
  await expect(page.getByTestId('life-surface')).toHaveAttribute('data-place', 'waiting');
  const desk = page.getByTestId('rebirth-section');
  if (await desk.getAttribute('open') === null) await desk.locator(':scope > summary').press('Enter');
  await expect(desk).toHaveJSProperty('open', true);
  const world = await page.evaluate(() => window.__lifeViewFixture.read().ui.world);
  const slot = world.underworld_view!.slots.find(slot => slot.status.needed.some(needed => needed.kind === 'named'))!;
  expect(slot.status.needed.filter(needed => needed.kind === 'named')).toHaveLength(6);
  const requirements = page.getByTestId(`slot-${slot.slot}`).getByRole('list', { name: 'Application requirements', exact: true }).getByRole('listitem');
  // The shared helper inspects actual visible text, in addition to carrier
  // identity/amount/date attributes. No full-sentence or style pin is needed.
  await verifyApplicationRequirements(requirements, slot.status.needed);
  expect(errors).toEqual([]);
});
