/// <reference lib="dom" />
// Prepared LV-C4 operations consume the frozen local scenario records.
// Prefixes are setup; all operations named below activate real page controls.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlayerNode, WorldSnapshot, TraitName } from '../../src/shared/world-snapshot.ts';
import { DREAM_INTENTS, type WorkerMessage } from '../../src/shared/protocol.ts';
import { dateLabel, formatAmount } from '../../src/main/calendar.ts';
import { OPERATION_PHASE_LABELS, previewLabel, rulingLabel } from '../../src/main/player-copy.ts';
import { TECHNICAL_TEXT } from '../../src/main/technical-text.ts';
import type { OperationState } from '../../src/shared/operation-state.ts';
import type { LifeNotebookExport } from '../../src/main/life-journal.ts';
import { scenarios, claimBaseline, openOperations, restoreScenario, worldRead, replayRead, probeRead, workerRequest, explicitStep, disclosure, saveOperation, type Scenario } from './operations-fixture.ts';

const records = scenarios();
const traits: readonly TraitName[] = ['greed', 'loyalty', 'pride', 'warmth', 'temper', 'vindictiveness', 'piety'];
function required(key: string): Scenario {
  const record = records.find(record => record.key === key);
  if (!record) throw Error(`Actual recorded scenario ${key} is missing`);
  return record;
}
function personName(world: WorldSnapshot, id: number): string {
  const person = world.residents.find(person => person.id === id) ?? world.player.earlier_bodies.find(person => person.id === id)
    ?? world.person_names.find(person => person.id === id) ?? (world.magistrate.id === id ? world.magistrate : undefined);
  if (!person) throw Error(`Actual DTO does not name Person ${id}`);
  return person.name;
}
async function fullPreview(page: Page, world: WorldSnapshot, node: PlayerNode): Promise<void> {
  // Exact native CurrentNode, including every stake and timing field, remains
  // authoritative even though the copy deck no longer prints technical IDs.
  expect((await worldRead(page)).player_node).toEqual(node);
  const status = await workerRequest(page, { type: 'decision-status' });
  expect(status.ok).toBe(true);
  expect(status.snapshot.playerNode).toEqual({ pending: true, node: node.id, answered: false });
  expect(await page.locator('[data-testid^="option-preview-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))))
    .toEqual(node.options.map(option => `option-preview-${option.id}`));
  for (const option of node.options) {
    await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
    const expected = option.preview.map(effect => {
      const delta = `${BigInt(effect.delta) < 0n ? '−' : '+'}${formatAmount(effect.delta).replace(/^-/, '')}`;
      const name = effect.person === world.player.body ? TECHNICAL_TEXT.previewYou : personName(world, effect.person);
      return `${name}: ${previewLabel(effect.what)} ${delta}`;
    });
    const rows = page.getByTestId(`option-preview-${option.id}`).getByRole('listitem');
    await expect(rows).toHaveText(expected.length ? expected : [TECHNICAL_TEXT.noPreview]);
    for (const [index, effect] of option.preview.entries()) {
      await expect(rows.nth(index)).toHaveAttribute('data-person', String(effect.person));
      await expect(rows.nth(index)).toHaveAttribute('data-unit', effect.what);
      await expect(rows.nth(index)).toHaveAttribute('data-delta', effect.delta);
    }
  }
}
async function chronicle(page: Page, world: WorldSnapshot): Promise<void> {
  const current = await worldRead(page);
  expect(current.chronicle).toEqual(world.chronicle);
  for (const entry of world.chronicle) {
    for (const id of entry.stakes.who) expect(personName(current, id)).toBe(personName(world, id));
  }
}
function receipt(page: Page, kind: OperationState['kind'], phase: OperationState['phase']): Locator {
  return page.getByTestId('operation-receipt').and(page.locator(`[data-kind="${kind}"][data-phase="${phase}"]`));
}
async function received(page: Page, kind: OperationState['kind']): Promise<void> {
  await expect(receipt(page, kind, 'received')).toBeVisible();
  await expect(receipt(page, kind, 'received')).toContainText(OPERATION_PHASE_LABELS.received);
  await expect(receipt(page, kind, 'processed')).toHaveCount(0);
}
async function refused(page: Page, kind: 'bribe' | 'haunt', reason: string): Promise<void> {
  await expect(receipt(page, kind, 'refused')).toBeVisible();
  const probe = await probeRead(page);
  let request: (typeof probe.sent)[number] | undefined;
  for (let index = probe.sent.length - 1; index >= 0; index--) {
    if (probe.sent[index]!.type === kind) { request = probe.sent[index]; break; }
  }
  if (request === undefined) throw Error(`Missing actual ${kind} request`);
  expect(probe.received.find(message => message.type === 'reply' && message.id === request.id))
    .toMatchObject({ type: 'reply', id: request.id, ok: false, kind: 'rejected', error: reason });
}
async function downloadFacts(page: Page): Promise<{ facts: LifeNotebookExport; bytes: string }> {
  await disclosure(page, 'technical-details', true);
  const details = page.getByTestId('technical-details').locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Unmerged life facts$/ }) });
  if (await details.getAttribute('open') === null) {
    await details.locator(':scope > summary').focus();
    await details.locator(':scope > summary').press('Enter');
  }
  await expect(details).toHaveJSProperty('open', true);
  const downloaded = page.waitForEvent('download');
  await details.getByRole('button', { name: 'Download life facts', exact: true }).click();
  const stream = await (await downloaded).createReadStream();
  if (stream === null) throw Error('Native life facts download is unreadable');
  stream.setEncoding('utf8');
  let bytes = '';
  for await (const chunk of stream) bytes += chunk;
  return { facts: JSON.parse(bytes) as LifeNotebookExport, bytes };
}
for (const scenario of records.filter(record => record.kind === 'node')) {
  for (const [index, option] of scenario.optionLabels!.entries()) {
    test(`actual ${scenario.key} Choose ${option}`, async ({ page }, info) => {
      test.setTimeout(180_000);
      await page.setViewportSize(index % 2 ? { width: 1024, height: 640 } : { width: 1280, height: 720 });
      const finish = await openOperations(page); const before = await restoreScenario(page, scenario);
      const node = before.player_node!; await fullPreview(page, before, node);
      await expect(page.getByTestId('run')).toBeDisabled(); await expect(page.getByTestId('step')).toBeDisabled();
      const inputsBefore = (await replayRead(page)).replay.inputs;
      // A single real option activation is admission, not application or Run.
      await page.getByTestId(`option-${option}`).click();
      await received(page, 'choose');
      await expect(page.getByTestId('choice-result')).toHaveAttribute('data-result-kind', 'filed');
      await expect(page.getByTestId('choice-result')).toContainText(TECHNICAL_TEXT.choiceFiled);
      expect((await workerRequest(page, { type: 'decision-status' })).snapshot.playerNode)
        .toEqual({ pending: true, node: node.id, answered: true });
      await expect(page.getByTestId('tick')).toHaveText(before.tick);
      const admission = await replayRead(page);
      expect(admission.replay.inputs.slice(inputsBefore.length).map(input => input.payload))
        .toEqual([{ ChoosePlayer: { node: node.id, option } }]);
      const after = await explicitStep(page); await chronicle(page, after);
      const reported = after.chronicle.filter(entry => BigInt(entry.tick) >= BigInt(before.tick) && entry.family === node.family);
      expect(reported.some(entry => entry.applied === option && entry.source === 'external')).toBe(true);
      expect(after.player_node?.id).not.toBe(node.id);
      await saveOperation(page, info, `choose-${scenario.family}-${option}-${records.indexOf(scenario)}`, {
        scenario, setup: 'Actual recorded prefix with every checksum; final UI Step', controls: [`Choose ${option}`, 'Step'],
        before, admission: admission.replay.inputs.slice(inputsBefore.length), terminal: reported,
        resultPolicy: 'Chronicle supplied facts only; no invented node IDs or preview-attributed deltas',
      });
      finish();
    });
  }
}
for (const path of ['birth_slot', 'imported_vessel', 'rebuilt_body'] as const) {
  const scenario = required(`path:${path}`);
  for (const [index, carry] of [null, ...traits].entries()) {
    test(`actual ${path} claim carry ${carry ?? 'None'} ${path === 'rebuilt_body' ? index % 2 ? 'Adjust' : 'Set' : ''}`, async ({ page }, info) => {
      test.setTimeout(180_000);
      await page.setViewportSize(index % 2 ? { width: 1024, height: 640 } : { width: 1280, height: 720 });
      const finish = await openOperations(page); const before = await restoreScenario(page, scenario);
      const view = before.underworld_view!; const slot = view.slots.find(slot => slot.slot === scenario.slot)!;
      expect(slot.status.claimable && slot.status.affordable).toBe(true);
      await disclosure(page, 'carry-section', true);
      await disclosure(page, 'rebirth-section', true);
      expect(await page.getByTestId('carry-over').locator('option').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value)))
        .toEqual(['', ...traits]);
      // Every delivered memory/carry-over option is activated in an independent
      // genuine World branch. There is no separate memory-list API to invent.
      await page.getByTestId('carry-over').selectOption(carry ?? '');
      const baseline = path === 'rebuilt_body' ? null : claimBaseline(scenario);
      const base = baseline === null ? view.base_traits.find(entry => entry.carry_over === carry)!.traits : baseline.body.traits;
      const expected = { ...base };
      // Birth/Imported preserve their actual native body's own draw except for
      // the single selected Trait copied from the actual previous ghost.
      if (baseline !== null && carry !== null) expected[carry] = view.ghost_traits[carry];
      let customization: unknown = null;
      if (path === 'rebuilt_body') {
        await page.getByTestId('customize').click();
        if (index % 2) {
          await page.getByTestId('customization-kind').selectOption('Adjust');
          await page.getByTestId('customization-first').selectOption('warmth');
          await page.getByTestId('customization-first-delta').selectOption('1');
          await page.getByTestId('customization-second').selectOption('loyalty');
          await page.getByTestId('customization-second-delta').selectOption('-1');
          expected.warmth = Math.min(3, base.warmth + 1); expected.loyalty = Math.max(-3, base.loyalty - 1);
          customization = { Adjust: { first: { trait_name: 'warmth', delta: 1 }, second: { trait_name: 'loyalty', delta: -1 } } };
        } else {
          const trait = traits[index % traits.length]!; const value = index % 7 - 3;
          await page.getByTestId('customization-trait').selectOption(trait);
          await page.getByTestId('customization-value').selectOption(String(value));
          expected[trait] = value; customization = { Set: { trait_name: trait, value } };
        }
        await expect(page.getByTestId('customization-price')).toHaveAttribute('data-amount', slot.price);
        await expect(page.getByTestId('customization-price')).toContainText(formatAmount(slot.price));
        for (const trait of traits) {
          await expect(page.getByTestId('customization-preview').locator(`[data-trait="${trait}"]`).getByRole('cell'))
            .toHaveText([String(base[trait]), String(expected[trait])]);
        }
      }
      const inputsBefore = (await replayRead(page)).replay.inputs;
      await page.getByTestId(`claim-${slot.slot}`).click();
      await received(page, 'claim');
      await expect(page.getByTestId('technical-run-state')).toHaveText('paused'); await expect(page.getByTestId('tick')).toHaveText(before.tick);
      const admission = (await replayRead(page)).replay.inputs.slice(inputsBefore.length);
      expect(admission.filter(input => 'CarryOver' in input.payload).map(input => input.payload))
        .toEqual(carry === null ? [] : [{ CarryOver: { trait_name: carry } }]);
      expect(admission.filter(input => 'ClaimSlot' in input.payload)).toHaveLength(1);
      if (customization !== null) {
        const payload = admission.find(input => 'ClaimSlot' in input.payload)!.payload.ClaimSlot;
        if (payload === null || typeof payload !== 'object' || !('customization' in payload)) throw Error('Recorded rebuilt customization is missing');
        expect(payload.customization).toEqual(customization);
      }
      let after = await explicitStep(page);
      if (path === 'birth_slot') {
        const slotId = slot.slot.slice('birth:'.length);
        expect(after.player_wait?.claim).toBe(slotId);
        expect(after.birth_slots.find(candidate => candidate.id === slotId)?.claimant).toBe(before.player_soul);
        await page.getByTestId('speed').selectOption('365');
        const receivedBeforeRun = (await probeRead(page)).received.length;
        await page.getByTestId('run').click();
        // Paused alone can still be the pre-Run state. Wait for this operation's
        // real native birth stop before reading its terminal World.
        await expect.poll(async () => (await probeRead(page)).received.slice(receivedBeforeRun).some(message =>
          message.type === 'status' && message.snapshot.stop?.reasons.includes('player_reborn')
          && message.snapshot.playerLifecycle.some(fact => fact.kind === 'birth' && fact.tick === slot.birth)),
        { intervals: [25, 50, 75], timeout: 30_000 }).toBe(true);
        await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
        await expect(page.getByTestId('tick')).toHaveText(String(BigInt(slot.birth!) + 1n));
        after = await worldRead(page);
      }
      expect(after.player_soul).toBe(before.player_soul); expect(after.player.place).toBe('body');
      const body = after.residents.find(person => person.id === after.player.body)!;
      expect(body.origin).toBe(path === 'birth_slot' ? 'native' : path === 'imported_vessel' ? 'possessed' : 'rebuilt');
      if (baseline !== null) expect(body.id).toBe(baseline.body.id);
      expect(body.traits).toEqual(expected);
      await expect(page.getByTestId('life-name')).toHaveText(body.name); await expect(page.getByTestId('life-soul')).toContainText(before.player_soul);
      const lifecycle = (await probeRead(page)).received.flatMap(message => message.type === 'status' || message.type === 'reply' ? message.snapshot.playerLifecycle : [])
        .filter(fact => fact.body === body.id);
      expect(lifecycle.some(fact => fact.kind === (path === 'birth_slot' ? 'birth' : path === 'imported_vessel' ? 'possession' : 'rebuild'))).toBe(true);
      await saveOperation(page, info, `claim-${path}-${carry ?? 'none'}`, { scenario, before, admission, lifecycle,
        controls: ['Carry over', ...(customization === null ? [] : ['Customize', index % 2 ? 'Adjust fields' : 'Set fields']), `Claim ${slot.slot}`, 'Step', ...(path === 'birth_slot' ? ['Speed 365', 'Run'] : [])],
        expectedTraits: expected, nativeBaseline: baseline?.provenance ?? null, customization });
      finish();
    });
  }
}
for (const intent of DREAM_INTENTS) {
  test(`actual Dream ${intent} resolves from real inputs without a choice`, async ({ page }, info) => {
    const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
    const view = before.underworld_view!; const dreamer = view.connected[0]!;
    await disclosure(page, 'dream-section', true);
    await page.getByTestId(`dream-target-${dreamer}`).check(); await expect(page.getByTestId(`dream-target-${dreamer}`)).toBeChecked();
    await page.getByTestId(`dream-intent-${intent}`).click();
    await expect(page.getByTestId(`dream-intent-${intent}`)).toHaveAttribute('aria-pressed', 'true');
    const prior = (await replayRead(page)).replay.inputs.length;
    await page.getByTestId('dream-send').click(); await received(page, 'dream');
    await expect(page.getByTestId('tick')).toHaveText(before.tick);
    const admission = (await replayRead(page)).replay.inputs.slice(prior);
    expect(admission.some(input => JSON.stringify(input.payload) === JSON.stringify({ Dream: { dreamer: String(dreamer), intent } }))).toBe(true);
    const after = await explicitStep(page);
    expect(after.last_dream?.dreamer).toBe(dreamer); expect(after.last_dream?.tick).toBe(before.tick);
    const dreamScene = page.getByTestId('key-scene');
    await expect(dreamScene).toHaveAttribute('data-category', 'dream');
    await expect(dreamScene).toContainText(personName(after, dreamer));
    await expect(dreamScene).toContainText(dateLabel(before.tick));
    expect(admission.some(input => 'ChoosePlayer' in input.payload)).toBe(false);
    await expect(page.getByTestId('choice-panel')).toHaveCount(0);
    const beforeClose = await replayRead(page); await page.getByTestId('scene-close').click();
    expect((await replayRead(page)).bytes).toBe(beforeClose.bytes);
    await saveOperation(page, info, `dream-${intent}`, { before, admission, terminal: after.last_dream, controls: ['Dreamer', intent, 'Send dream', 'Step', 'Close scene'] });
    finish();
  });
}
for (const amount of ['9007199254740993', '18446744073709551615', '0']) {
  test(`actual exact Bribe field and protocol ${amount} receives core rejection`, async ({ page }, info) => {
    const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
    await disclosure(page, 'bribe-section', true);
    const replay = await replayRead(page); const start = (await probeRead(page)).sent.length;
    await page.getByTestId('bribe-amount').fill(amount); await expect(page.getByTestId('bribe-amount')).toHaveValue(amount);
    await page.getByTestId('bribe-send').click();
    const reason = amount === '0' ? 'bad_amount' : 'insufficient_joss';
    await refused(page, 'bribe', reason);
    expect((await probeRead(page)).sent.slice(start).filter(request => request.type === 'bribe')).toEqual([expect.objectContaining({ type: 'bribe', amount })]);
    expect((await replayRead(page)).bytes).toBe(replay.bytes); await expect(page.getByTestId('tick')).toHaveText(before.tick);
    await expect(page.getByTestId('bribe-amount')).toHaveValue(amount);
    await saveOperation(page, info, `bribe-rejected-${amount}`, { before, amount, reason, controls: ['Amount in joss paper', 'Submit bribe'],
      limits: 'Actual checked-admission rejection allocates no seq; successful high-u64 receipts retain source-qualified C1 native proof.' });
    finish();
  });
}
test('actual invalid Bribe syntax submits no protocol request', async ({ page }, info) => {
  const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
  await disclosure(page, 'bribe-section', true);
  const replay = await replayRead(page); const start = (await probeRead(page)).sent.length;
  const invalid = ['', '01', '00', ' 1', '1 ', '+1', '-1', '1.0', '1e3', '1_000', '18446744073709551616'];
  for (const value of invalid) {
    await page.getByTestId('bribe-amount').fill(value); await expect(page.getByTestId('bribe-send')).toBeDisabled();
    await page.getByTestId('bribe-amount').press('Enter');
  }
  expect((await probeRead(page)).sent.slice(start).filter(request => request.type === 'bribe')).toEqual([]);
  expect((await replayRead(page)).bytes).toBe(replay.bytes);
  await saveOperation(page, info, 'bribe-invalid', { before, invalid, controls: ['Amount field', 'Enter'], submittedBribes: 0 }); finish();
});
for (const kind of ['bribe', 'haunt'] as const) {
  test(`actual ${kind} queued to applied through paused Step without stop Status`, async ({ page }, info) => {
    const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
    const view = before.underworld_view!;
    const target = view.actions.haunt.targets.find(target => target.availability.eligible && target.target !== 1)!.target;
    const beforeInputs = (await replayRead(page)).replay.inputs.length;
    await disclosure(page, `${kind}-section`, true);
    if (kind === 'bribe') await page.getByTestId('bribe-amount').fill('1');
    else await page.getByTestId(`haunt-target-${target}`).check();
    await page.getByTestId(`${kind}-send`).click();
    await received(page, kind);
    await expect(page.getByTestId('tick')).toHaveText(before.tick); await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
    const queued = await replayRead(page); const admission = queued.replay.inputs.slice(beforeInputs);
    const input = admission.find(input => kind === 'bribe' ? 'Bribe' in input.payload : 'Haunt' in input.payload)!;
    expect(input).toBeDefined();
    if (kind === 'haunt') {
      // The stale applied-World view still has an eligible target while the first
      // Haunt is queued. A second real click must reach queued-prefix admission,
      // reject rate_limited without a seq, and leave the first action queued.
      await page.getByTestId('haunt-send').click();
      await refused(page, 'haunt', 'rate_limited');
      await expect(receipt(page, 'haunt', 'received')).toBeVisible();
      await expect(receipt(page, 'haunt', 'processed')).toHaveCount(0);
      expect((await replayRead(page)).replay.inputs).toEqual(queued.replay.inputs);
    }
    const readBeforeStep = (await probeRead(page)).received.length;
    const after = await explicitStep(page);
    await expect(receipt(page, kind, 'processed')).toHaveAttribute('data-inputs', input.seq);
    await expect(receipt(page, kind, 'processed')).toContainText(OPERATION_PHASE_LABELS.processed);
    const messages = (await probeRead(page)).received.slice(readBeforeStep);
    const statuses = messages.filter(message => message.type === 'status');
    expect(statuses.some(message => message.snapshot.actions.some(action => action.input_seq === input.seq))).toBe(true);
    expect(statuses.every(message => message.snapshot.stop === undefined)).toBe(true);
    const results = statuses.flatMap(message => message.snapshot.actions).filter(action => action.input_seq === input.seq);
    expect(results).toHaveLength(1); const result = results[0]!;
    expect(result.kind).toBe(kind); expect(result.state).toBe('applied'); expect(result.requestId).not.toBeNull();
    if (result.kind === 'haunt' && result.state === 'applied') {
      expect(result.target).toBe(target); expect(result.price).toBe(view.actions.haunt.price); expect(result.mood_delta).toBe('-15');
      expect(BigInt(after.underworld_view!.actions.capped_spend.spent)).toBe(BigInt(view.actions.capped_spend.spent) + BigInt(result.price));
    }
    if (result.kind === 'bribe' && result.state === 'applied') {
      expect(result.amount).toBe('1'); expect(result.ruling).not.toBeNull(); expect(result.ruling!.source).toBe('rules_default');
      await expect(page.getByTestId('bribe-controls')).toContainText(rulingLabel(result.ruling!.applied));
      expect(after.underworld_view!.actions.capped_spend).toEqual(view.actions.capped_spend);
    }
    await saveOperation(page, info, `${kind}-paused-applied`, { before, admission, terminal: result, after,
      controls: kind === 'bribe' ? ['Amount 1', 'Submit bribe', 'Step'] : [`Connected target ${target}`, 'Haunt selected target', 'Step'],
      delivery: 'Ordinary no-stop Status independently of Step reply; run state remains paused' });
    finish();
  });
}
test('actual negative connected target is actionable and no-eligible branch preserves other actions', async ({ page }, info) => {
  const finish = await openOperations(page);
  const before = await restoreScenario(page, required('negative-target'));
  const target = required('negative-target').target!;
  expect(before.player.past_life_ties.some(tie => tie.rememberer === target && tie.affinity < 0)).toBe(true);
  await disclosure(page, 'haunt-section', true);
  const inputsBefore = (await replayRead(page)).replay.inputs.length;
  await page.getByTestId(`haunt-target-${target}`).check(); await page.getByTestId('haunt-send').click();
  await received(page, 'haunt');
  const admission = (await replayRead(page)).replay.inputs.slice(inputsBefore);
  const input = admission.find(input => 'Haunt' in input.payload)!;
  expect(input).toBeDefined();
  const receivedBeforeStep = (await probeRead(page)).received.length;
  const after = await explicitStep(page);
  await expect(receipt(page, 'haunt', 'processed')).toHaveAttribute('data-inputs', input.seq);
  const results = (await probeRead(page)).received.slice(receivedBeforeStep).flatMap(message =>
    message.type === 'reply' || message.type === 'status' ? message.snapshot.actions : []).filter(action => action.input_seq === input.seq);
  expect(results).toContainEqual(expect.objectContaining({ kind: 'haunt', state: 'applied', target }));
  await saveOperation(page, info, 'negative-target-applied', { before, after, target, admission, terminal: results, controls: ['Negative connected target', 'Haunt selected target', 'Step'] });
  const blocked = await restoreScenario(page, required('no-eligible-target'));
  expect(blocked.underworld_view!.actions.haunt.targets.every(target => !target.availability.eligible)).toBe(true);
  for (const section of ['haunt', 'bribe', 'dream', 'carry']) await disclosure(page, `${section}-section`, true);
  await expect(page.getByTestId('haunt-send')).toBeDisabled(); await expect(page.getByTestId('bribe-amount')).toBeVisible();
  await expect(page.getByTestId('dream-controls')).toBeVisible(); await expect(page.getByTestId('carry-over')).toBeVisible();
  await saveOperation(page, info, 'no-eligible-target', { before: blocked, controls: [], limits: 'No eligible action claimed; source-qualified changed/cut carrier cases belong to component/native layers.' });
  finish();
});
test('actual map Chronicle disclosures cancel and Create preserve explicit input ownership', async ({ page }, info) => {
  const finish = await openOperations(page);
  const session = await page.context().newCDPSession(page);
  const prototype = await session.send('Runtime.evaluate', { expression: 'Worker.prototype' });
  const workers = await session.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId! });
  const observed = await session.send('Runtime.callFunctionOn', {
    objectId: workers.objects.objectId!,
    functionDeclaration: `function () {
      if (this.length !== 1) throw Error('Expected the one actual Worker');
      const worker = this[0]; const statuses = [];
      const listener = event => { if (event.data.type === 'status') statuses.push(structuredClone(event.data)); };
      worker.addEventListener('message', listener);
      return { statuses, stop() { worker.removeEventListener('message', listener); } };
    }`,
  });
  if (observed.exceptionDetails !== undefined || observed.result.objectId === undefined) throw Error('Actual setup Status observer did not attach');
  await session.send('Runtime.releaseObject', { objectId: prototype.result.objectId! });
  await session.send('Runtime.releaseObject', { objectId: workers.objects.objectId! });
  let before: WorldSnapshot;
  let setupStatuses: WorkerMessage[];
  try {
    before = await restoreScenario(page, required('waiting-actions'));
    const result = await session.send('Runtime.callFunctionOn', {
      objectId: observed.result.objectId!, functionDeclaration: 'function () { return this.statuses; }', returnByValue: true,
    });
    if (result.exceptionDetails !== undefined) throw Error('Actual setup Status evidence could not be read');
    setupStatuses = result.result.value as WorkerMessage[];
  } finally {
    await session.send('Runtime.callFunctionOn', { objectId: observed.result.objectId!, functionDeclaration: 'function () { this.stop(); }' });
    await session.send('Runtime.releaseObject', { objectId: observed.result.objectId! });
    await session.detach();
  }
  const replay = await replayRead(page);
  const transport = await probeRead(page);
  const creates = transport.sent.filter(request => request.type === 'create-world');
  expect(creates).toHaveLength(1);
  const createdReply = transport.received.find(message => message.type === 'reply' && message.id === creates[0]!.id);
  if (createdReply?.type !== 'reply' || !createdReply.ok) throw Error('Actual UI Create admission is missing');
  const worldId = createdReply.snapshot.worldId;
  // harness 回包只归测试调用方；停止时独立广播的 Status 仍由 App 接收，不能随大前缀录像一起漏掉。
  const admittedStory = [...transport.received, ...setupStatuses].flatMap(message => message.type === 'reply' || message.type === 'status'
    ? (message.snapshot.story ?? []).filter(delivery => delivery.worldId === worldId) : []);
  expect(admittedStory.some(delivery => delivery.batch.opening)).toBe(true);
  const events = new Map<string, LifeNotebookExport['events'][string]>();
  const records = new Map<string, LifeNotebookExport['chronicle'][string]>();
  for (const { batch } of admittedStory) {
    for (const event of batch.events) if (!events.has(event.id)) events.set(event.id, event);
    for (const record of batch.chronicle) if (!records.has(record.index)) records.set(record.index, record);
  }
  expect(events.size, 'Actual admitted native facts make the navigation preservation check nonempty').toBeGreaterThan(0);
  await disclosure(page, 'town-disclosure', true); await expect(page.getByTestId('town-view')).toBeVisible();
  await page.getByTestId('life-surface').getByRole('link', { name: TECHNICAL_TEXT.jumpToScene, exact: true }).click();
  await disclosure(page, 'town-disclosure', false); await disclosure(page, 'technical-details', true);
  await page.getByTestId('decision-wait').selectOption('0'); await page.getByTestId('decision-wait').press('Tab');
  await expect(page.getByTestId('decision-wait')).toHaveValue('0');
  await disclosure(page, 'rebirth-section', true);
  await page.getByTestId('customize').click(); await page.getByTestId('customization-kind').selectOption('Adjust'); await page.getByTestId('customization-cancel').click();
  const downloaded = await downloadFacts(page);
  await info.attach('native-life-facts', { body: downloaded.bytes, contentType: 'application/json' });
  await page.locator('#life-journal-accounts').scrollIntoViewIfNeeded();
  expect(downloaded.facts.worldId).toBe(worldId);
  expect(downloaded.facts.events).toEqual(Object.fromEntries(events));
  expect(downloaded.facts.chronicle).toEqual(Object.fromEntries(records));
  const cursors = admittedStory.map(delivery => delivery.batch.cursors);
  const furthest = cursors.reduce((latest, cursor) => BigInt(cursor.events.end) > BigInt(latest.events.end)
    || BigInt(cursor.chronicle.end) > BigInt(latest.chronicle.end) ? cursor : latest);
  expect(downloaded.facts.cursors).toEqual(furthest);
  await chronicle(page, before); expect((await replayRead(page)).bytes).toBe(replay.bytes);
  await disclosure(page, 'world-setup', true); await page.getByTestId('seed').fill('9007199254740993');
  await page.getByTestId('town-size').fill('40'); await page.getByTestId('create').click();
  await expect(page.getByTestId('tick')).toHaveText('0'); const created = await replayRead(page);
  expect(created.replay.seed).toBe('9007199254740993'); expect(created.replay.config).toEqual({ opening_residents: 40 }); expect(created.replay.inputs).toEqual([]);
  await page.getByTestId('run').click(); await expect(page.getByTestId('technical-run-state')).toHaveText('running');
  await page.getByTestId('pause').click(); await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  await explicitStep(page);
  await saveOperation(page, info, 'navigation-create-controls', { before, controls: ['Town map', TECHNICAL_TEXT.jumpToScene, 'Technical details', 'Decision wait 0', 'Customize Adjust', 'Cancel', 'Unmerged life facts Enter', 'Download life facts', 'Your life journal scroll', 'Seed', 'Town size 40', 'Create', 'Run', 'Pause', 'Step'],
    presentationInputsBeforeCreate: 0, admittedStory, setupStatuses, setupStoryScope: 'Recorded harness replies are independently replay-bound setup; their ordinary Status broadcasts remain App-admitted facts.', created: created.replay }); finish();
});
test('actual own death Skip and Close do not consume a gameplay input or Step', async ({ page }, info) => {
  const finish = await openOperations(page); const before = await restoreScenario(page, required('own-death'));
  expect(before.player.place).toBe('waiting');
  const facts = (await probeRead(page)).received.flatMap(message => message.type === 'reply' || message.type === 'status' ? message.snapshot.playerLifecycle : []);
  const death = facts.find(fact => fact.kind === 'death')!;
  expect(death).toBeDefined(); await expect(page.getByTestId('key-scene')).toHaveAttribute('data-category', 'death');
  await expect(page.getByTestId('key-scene')).toContainText(death.name);
  await expect(page.getByTestId('life-header')).toContainText(TECHNICAL_TEXT.waiting);
  const replay = await replayRead(page); const identity = await page.getByTestId('key-scene').getAttribute('data-identity');
  const skip = page.getByTestId('scene-skip');
  await skip.focus(); await skip.press('Space'); await skip.press('Space');
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-identity', identity!);
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-beat', 'settled');
  expect((await replayRead(page)).bytes).toBe(replay.bytes);
  await page.getByTestId('scene-close').click();
  expect((await replayRead(page)).bytes).toBe(replay.bytes);
  await saveOperation(page, info, 'own-death-skip-close', { before, death, identity, controls: ['Skip animation Space twice', 'Close scene'], presentationInputs: 0 }); finish();
});
test('actual running older same-generation ActionView permits a real Haunt', async ({ page }, info) => {
  const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
  const target = before.underworld_view!.actions.haunt.targets.find(target => target.availability.eligible)!.target;
  const priorInputs = (await replayRead(page)).replay.inputs.length;
  await disclosure(page, 'haunt-section', true);
  await page.getByTestId(`haunt-target-${target}`).check(); await page.getByTestId('run').click();
  await expect(page.getByTestId('technical-run-state')).toHaveText('running');
  let observedTick = ''; let displayedTick = '';
  await expect.poll(async () => {
    const probe = await probeRead(page);
    let observation: (typeof probe.received)[number] | undefined;
    for (let index = probe.received.length - 1; index >= 0; index--) {
      const message = probe.received[index]!;
      if (message.type === 'reply' && message.ok && message.world !== undefined) { observation = message; break; }
    }
    if (observation?.type !== 'reply' || !observation.ok || observation.world === undefined) return false;
    observedTick = observation.world.tick; displayedTick = await page.getByTestId('tick').innerText();
    return BigInt(displayedTick) > BigInt(observedTick);
  }, { intervals: [25, 50, 75], timeout: 5_000 }).toBe(true);
  const sentBeforeHaunt = (await probeRead(page)).sent.length;
  await expect(page.getByTestId('haunt-send')).toBeEnabled(); await page.getByTestId('haunt-send').click();
  await expect(receipt(page, 'haunt', 'processed')).toBeVisible();
  const probe = await probeRead(page);
  const request = probe.sent.slice(sentBeforeHaunt).find(request => request.type === 'haunt')!;
  expect(request).toMatchObject({ type: 'haunt', target });
  const results = probe.received.flatMap(message => message.type === 'reply' || message.type === 'status' ? message.snapshot.actions : [])
    .filter(action => action.requestId === request.id);
  expect(results).toContainEqual(expect.objectContaining({ kind: 'haunt', state: 'applied', target }));
  const admission = (await replayRead(page)).replay.inputs.slice(priorInputs);
  expect(admission.filter(input => 'Haunt' in input.payload)).toHaveLength(1);
  await page.getByTestId('pause').click(); await expect(page.getByTestId('technical-run-state')).toHaveText('paused');
  const after = await worldRead(page);
  await saveOperation(page, info, 'running-older-view-haunt', { before, after, observedTick, displayedTick, target, admission, terminal: results,
    controls: ['Connected target', 'Run', 'Haunt selected target while running with older observed tick', 'Pause'],
    limits: 'An older current-generation observation is not an old World; actual checked admission/application remains authoritative.' }); finish();
});

// Register only genuinely discovered carriers. manifest.nonHeadDiscovery records
// the bounded search and producer constraints even when no such stop is reached;
// component props are never silently registered as a live joined-node scenario.
for (const scenario of records.filter(record => record.kind === 'joined-node')) {
  test('actual joined historical head preserves full independent CurrentDecision on Choose admission', async ({ page }, info) => {
    const finish = await openOperations(page); const before = await restoreScenario(page, scenario);
    const node = before.player_node!; await fullPreview(page, before, node);
    const keyScene = page.getByTestId('key-scene');
    await expect(keyScene).toBeVisible();
    const identity = await keyScene.getAttribute('data-identity');
    const historicalText = await keyScene.locator('.accessible-facts').innerText();
    expect(await keyScene.getAttribute('data-category')).not.toBe(node.family);
    const replayBefore = await replayRead(page);
    await page.getByTestId('scene-skip').click();
    await expect(keyScene).toHaveAttribute('data-identity', identity!);
    expect((await replayRead(page)).bytes).toBe(replayBefore.bytes);
    await page.getByTestId(`option-${node.options[0]!.id}`).click();
    await received(page, 'choose');
    expect((await workerRequest(page, { type: 'decision-status' })).snapshot.playerNode)
      .toEqual({ pending: true, node: node.id, answered: true });
    await expect(page.getByTestId('tick')).toHaveText(before.tick);
    await expect(keyScene).toHaveAttribute('data-identity', identity!);
    await expect(keyScene.locator('.accessible-facts')).toHaveText(historicalText);
    await expect(page.locator('[data-testid^="option-preview-"]')).toHaveCount(0);
    const queued = await replayRead(page);
    expect(queued.replay.inputs.slice(replayBefore.replay.inputs.length).map(input => input.payload))
      .toEqual([{ ChoosePlayer: { node: node.id, option: node.options[0]!.id } }]);
    await info.attach('actual-joined-head-at-admission', { body: await page.screenshot(), contentType: 'image/png' });
    const after = await explicitStep(page); await chronicle(page, after);
    await saveOperation(page, info, 'joined-nonhead-choose', { scenario, before, after,
      controls: ['Skip', `Choose ${node.options[0]!.id}`, 'Step'],
      admission: queued.replay.inputs.slice(replayBefore.replay.inputs.length), preservedHistoricalHead: { identity, historicalText },
      rejectionBoundary: 'App currentDecision suppresses a second sending/queued activation; this accepted operation is not claimed as pending-node rejection proof.' });
    finish();
  });
}
