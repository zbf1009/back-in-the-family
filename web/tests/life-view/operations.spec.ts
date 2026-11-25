/// <reference lib="dom" />
// Prepared LV-C4 operations. Run the local scenario generator first.
// Prefixes are setup; all operations named below activate real page controls.
import { expect, test, type Page } from '@playwright/test';
import type { PlayerNode, WorldSnapshot, TraitName } from '../../src/shared/world-snapshot.ts';
import { DREAM_INTENTS } from '../../src/shared/protocol.ts';
import { scenarios, claimBaseline, openOperations, restoreScenario, worldRead, replayRead, probeRead, explicitStep, disclosure, saveOperation, type Scenario } from './operations-fixture.ts';

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
  await expect(page.getByTestId('choice-node')).toHaveText(node.id);
  for (const tick of [node.fired, node.choice_tick, node.resolves]) await expect(page.getByTestId('choice-timing')).toContainText(tick);
  for (const id of node.stakes.who) await expect(page.getByTestId('stakes')).toContainText(personName(world, id));
  await expect(page.getByTestId('stakes')).toContainText(node.stakes.amount);
  await expect(page.getByTestId('stakes')).toContainText(node.stakes.by);
  expect(await page.locator('[data-testid^="option-preview-"]').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))))
    .toEqual(node.options.map(option => `option-preview-${option.id}`));
  for (const option of node.options) {
    await expect(page.getByTestId(`option-${option.id}`)).toBeEnabled();
    const expected = option.preview.map(effect => {
      const delta = BigInt(effect.delta) < 0n ? effect.delta : `+${effect.delta}`;
      const unit = effect.what.startsWith('trait:') ? 'trait_points' : effect.what === 'debt' ? 'money' : effect.what;
      const detail = effect.what.startsWith('trait:') ? ` (${effect.what})` : effect.what === 'debt' ? ' (debt)' : '';
      return `${personName(world, effect.person)}: ${delta} ${unit}${detail} · Person ${effect.person}`;
    });
    expect(await page.getByTestId(`option-preview-${option.id}`).locator('li').allTextContents())
      .toEqual(expected.length ? expected : ['No numerical effects in this preview.']);
  }
}
async function chronicle(page: Page, world: WorldSnapshot): Promise<void> {
  await expect(page.getByTestId('chronicle-entry')).toHaveCount(world.chronicle.length);
  const text = await page.getByTestId('chronicle').innerText();
  for (const entry of world.chronicle) {
    expect(text).toContain(entry.applied); expect(text).toContain(entry.source);
    for (const skipped of entry.skipped) expect(text).toContain(skipped.reason);
    for (const id of entry.stakes.who) expect(text).toContain(personName(world, id));
  }
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
      await expect(page.getByTestId('choice-recorded')).toContainText('not applied yet');
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
        await expect(page.getByTestId('customization-preview')).toContainText(slot.price);
        await expect(page.getByTestId('customization-preview')).toContainText('not applied');
      }
      const inputsBefore = (await replayRead(page)).replay.inputs;
      await page.getByTestId(`claim-${slot.slot}`).click();
      await expect(page.getByTestId('underworld-recorded')).toContainText('not applied yet');
      await expect(page.getByTestId('run-state')).toHaveText('paused'); await expect(page.getByTestId('tick')).toHaveText(before.tick);
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
        await expect(page.getByTestId('run-state')).toHaveText('paused');
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
  test(`actual Dream ${intent} remains static and resolves from real inputs`, async ({ page }, info) => {
    const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
    const view = before.underworld_view!; const dreamer = view.connected[0]!;
    await page.getByTestId('dreamer').selectOption(String(dreamer)); await page.getByTestId(`dream-intent-${intent}`).click();
    await expect(page.getByTestId(`dream-intent-${intent}`)).toHaveAttribute('aria-pressed', 'true');
    const prior = (await replayRead(page)).replay.inputs.length;
    await page.getByTestId('dream-send').click(); await expect(page.getByTestId('underworld-recorded')).toContainText('not applied yet');
    await expect(page.getByTestId('tick')).toHaveText(before.tick);
    const admission = (await replayRead(page)).replay.inputs.slice(prior);
    expect(admission.some(input => JSON.stringify(input.payload) === JSON.stringify({ Dream: { dreamer: String(dreamer), intent } }))).toBe(true);
    const after = await explicitStep(page);
    expect(after.last_dream?.dreamer).toBe(dreamer); expect(after.last_dream?.tick).toBe(before.tick);
    await expect(page.getByTestId('scene-dream')).toContainText(personName(after, dreamer));
    await expect(page.getByTestId('scene-dream')).toContainText(before.tick);
    expect(admission.some(input => 'Choose' in input.payload)).toBe(false);
    await expect(page.getByTestId('key-scene')).toHaveCount(0);
    const beforeClose = await replayRead(page); await page.getByRole('button', { name: 'Close scene', exact: true }).click();
    expect((await replayRead(page)).bytes).toBe(beforeClose.bytes);
    await saveOperation(page, info, `dream-${intent}`, { before, admission, terminal: after.last_dream, controls: ['Dreamer', intent, 'Send dream', 'Step', 'Close scene'] });
    finish();
  });
}
for (const amount of ['9007199254740993', '18446744073709551615', '0']) {
  test(`actual exact Bribe field and protocol ${amount} receives core rejection`, async ({ page }, info) => {
    const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
    const replay = await replayRead(page); const start = (await probeRead(page)).sent.length;
    await page.getByTestId('bribe-amount').fill(amount); await expect(page.getByTestId('bribe-amount')).toHaveValue(amount);
    await page.getByTestId('bribe-send').click();
    const reason = amount === '0' ? 'bad_amount' : 'insufficient_joss';
    await expect(page.getByTestId('action-feedback').filter({ hasText: new RegExp(`bribe: rejected.*${reason}`) })).toBeVisible();
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
    if (kind === 'bribe') await page.getByTestId('bribe-amount').fill('1');
    else await page.getByTestId(`haunt-target-${target}`).check();
    await page.getByTestId(`${kind}-send`).click();
    await expect(page.getByTestId('action-feedback').filter({ hasText: `${kind}: queued` })).toContainText('not applied');
    await expect(page.getByTestId('tick')).toHaveText(before.tick); await expect(page.getByTestId('run-state')).toHaveText('paused');
    const queued = await replayRead(page); const admission = queued.replay.inputs.slice(beforeInputs);
    const input = admission.find(input => kind === 'bribe' ? 'Bribe' in input.payload : 'Haunt' in input.payload)!;
    expect(input).toBeDefined();
    if (kind === 'haunt') {
      // The stale applied-World view still has an eligible target while the first
      // Haunt is queued. A second real click must reach queued-prefix admission,
      // reject rate_limited without a seq, and leave the first action queued.
      await page.getByTestId('haunt-send').click();
      await expect(page.getByTestId('action-feedback').filter({ hasText: /haunt: rejected.*rate_limited/ })).toBeVisible();
      expect((await replayRead(page)).replay.inputs).toEqual(queued.replay.inputs);
    }
    const readBeforeStep = (await probeRead(page)).received.length;
    const after = await explicitStep(page);
    await expect(page.getByTestId('action-feedback').filter({ hasText: `${kind}: applied` })).toContainText(input.seq);
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
      await expect(page.getByTestId('action-feedback').filter({ hasText: 'bribe: applied' })).toContainText(result.ruling!.applied);
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
  await page.getByTestId(`haunt-target-${target}`).check(); await page.getByTestId('haunt-send').click();
  await expect(page.getByTestId('action-feedback').filter({ hasText: 'haunt: queued' })).toBeVisible();
  const after = await explicitStep(page);
  await expect(page.getByTestId('action-feedback').filter({ hasText: 'haunt: applied' })).toBeVisible();
  await saveOperation(page, info, 'negative-target-applied', { before, after, target, controls: ['Negative connected target', 'Haunt selected target', 'Step'] });
  const blocked = await restoreScenario(page, required('no-eligible-target'));
  expect(blocked.underworld_view!.actions.haunt.targets.every(target => !target.availability.eligible)).toBe(true);
  await expect(page.getByTestId('haunt-send')).toBeDisabled(); await expect(page.getByTestId('bribe-amount')).toBeVisible();
  await expect(page.getByTestId('dream-controls')).toBeVisible(); await expect(page.getByTestId('carry-over')).toBeVisible();
  await saveOperation(page, info, 'no-eligible-target', { before: blocked, controls: [], limits: 'No eligible action claimed; source-qualified changed/cut carrier cases belong to component/native layers.' });
  finish();
});
test('actual map Chronicle disclosures cancel and Create preserve explicit input ownership', async ({ page }, info) => {
  const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
  const replay = await replayRead(page);
  await disclosure(page, 'town-disclosure', true); await expect(page.getByTestId('town-view')).toBeVisible();
  await page.getByTestId('life-surface').getByRole('link', { name: 'Back to current action', exact: true }).click();
  await disclosure(page, 'town-disclosure', false); await disclosure(page, 'technical-details', true);
  await page.getByTestId('decision-wait').selectOption('0'); await page.getByTestId('decision-wait').press('Tab');
  await expect(page.getByTestId('decision-wait')).toHaveValue('0');
  await page.getByTestId('customize').click(); await page.getByTestId('customization-kind').selectOption('Adjust'); await page.getByTestId('customization-cancel').click();
  await page.getByTestId('chronicle').scrollIntoViewIfNeeded();
  await chronicle(page, before); expect((await replayRead(page)).bytes).toBe(replay.bytes);
  await disclosure(page, 'world-setup', true); await page.getByTestId('seed').fill('9007199254740993');
  await page.getByTestId('config').fill('{"opening_residents":40}'); await page.getByTestId('create').click();
  await expect(page.getByTestId('tick')).toHaveText('0'); const created = await replayRead(page);
  expect(created.replay.seed).toBe('9007199254740993'); expect(created.replay.config).toEqual({ opening_residents: 40 }); expect(created.replay.inputs).toEqual([]);
  await page.getByTestId('run').click(); await expect(page.getByTestId('run-state')).toHaveText('running');
  await page.getByTestId('pause').click(); await expect(page.getByTestId('run-state')).toHaveText('paused');
  await explicitStep(page);
  await saveOperation(page, info, 'navigation-create-controls', { before, controls: ['Town map', 'Back to current action', 'Technical details', 'Decision wait 0', 'Customize Adjust', 'Cancel', 'Chronicle scroll', 'Seed', 'World_Config 40', 'Create', 'Run', 'Pause', 'Step'],
    presentationInputsBeforeCreate: 0, created: created.replay }); finish();
});
test('actual own death Skip and Close do not consume a gameplay input or Step', async ({ page }, info) => {
  const finish = await openOperations(page); const before = await restoreScenario(page, required('own-death'));
  expect(before.player.place).toBe('waiting');
  const facts = (await probeRead(page)).received.flatMap(message => message.type === 'reply' || message.type === 'status' ? message.snapshot.playerLifecycle : []);
  const death = facts.find(fact => fact.kind === 'death')!;
  expect(death).toBeDefined(); await expect(page.getByTestId('key-scene')).toHaveAttribute('data-category', 'death');
  await expect(page.getByTestId('key-scene')).toContainText(death.name);
  await expect(page.getByTestId('identity-state')).toContainText('Waiting between lives');
  const replay = await replayRead(page); const identity = await page.getByTestId('key-scene').getAttribute('data-identity');
  const skip = page.getByRole('button', { name: 'Skip animation', exact: true });
  await skip.focus(); await skip.press('Space'); await skip.press('Space');
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-identity', identity!);
  await expect(page.getByTestId('key-scene')).toHaveAttribute('data-beat', 'settled');
  expect((await replayRead(page)).bytes).toBe(replay.bytes);
  await page.getByRole('button', { name: 'Close scene', exact: true }).click();
  expect((await replayRead(page)).bytes).toBe(replay.bytes);
  await saveOperation(page, info, 'own-death-skip-close', { before, death, identity, controls: ['Skip animation Space twice', 'Close scene'], presentationInputs: 0 }); finish();
});
test('actual running older same-generation ActionView permits a real Haunt', async ({ page }, info) => {
  const finish = await openOperations(page); const before = await restoreScenario(page, required('waiting-actions'));
  const target = before.underworld_view!.actions.haunt.targets.find(target => target.availability.eligible)!.target;
  await page.getByTestId(`haunt-target-${target}`).check(); await page.getByTestId('run').click();
  await expect(page.getByTestId('run-state')).toHaveText('running');
  let observedTick = ''; let displayedTick = '';
  await expect.poll(async () => {
    const label = await page.getByTestId('underworld-observed-tick').innerText();
    observedTick = label.match(/as of tick (\d+)/)![1]!; displayedTick = await page.getByTestId('tick').innerText();
    return BigInt(displayedTick) > BigInt(observedTick);
  }, { intervals: [25, 50, 75], timeout: 5_000 }).toBe(true);
  await expect(page.getByTestId('haunt-send')).toBeEnabled(); await page.getByTestId('haunt-send').click();
  await expect(page.getByTestId('action-feedback').filter({ hasText: 'haunt: applied' })).toBeVisible();
  await page.getByTestId('pause').click(); await expect(page.getByTestId('run-state')).toHaveText('paused');
  const after = await worldRead(page);
  await saveOperation(page, info, 'running-older-view-haunt', { before, after, observedTick, displayedTick, target,
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
    const animatedHead = await keyScene.count() === 1;
    const identity = animatedHead ? await keyScene.getAttribute('data-identity') : null;
    const dream = page.getByTestId('scene-dream');
    const historicalText = animatedHead ? await keyScene.locator('figcaption').innerText() : await dream.innerText();
    if (animatedHead) expect(await keyScene.getAttribute('data-category')).not.toBe(node.family);
    else await expect(dream).toBeVisible();
    const replayBefore = await replayRead(page);
    if (animatedHead) {
      await page.getByRole('button', { name: 'Skip animation', exact: true }).click();
      await expect(keyScene).toHaveAttribute('data-identity', identity!);
      expect((await replayRead(page)).bytes).toBe(replayBefore.bytes);
    }
    await page.getByTestId(`option-${node.options[0]!.id}`).click();
    await expect(page.getByTestId('choice-recorded')).toContainText('not applied yet');
    await expect(page.getByTestId('tick')).toHaveText(before.tick);
    if (animatedHead) { await expect(keyScene).toHaveAttribute('data-identity', identity!); await expect(keyScene.locator('figcaption')).toHaveText(historicalText); }
    else await expect(dream).toHaveText(historicalText);
    await expect(page.locator('[data-testid^="option-preview-"]')).toHaveCount(0);
    const queued = await replayRead(page);
    expect(queued.replay.inputs.slice(replayBefore.replay.inputs.length).map(input => input.payload))
      .toEqual([{ ChoosePlayer: { node: node.id, option: node.options[0]!.id } }]);
    await info.attach('actual-joined-head-at-admission', { body: await page.screenshot(), contentType: 'image/png' });
    const after = await explicitStep(page); await chronicle(page, after);
    await saveOperation(page, info, 'joined-nonhead-choose', { scenario, before, after,
      controls: [...(animatedHead ? ['Skip animation'] : []), `Choose ${node.options[0]!.id}`, 'Step'],
      admission: queued.replay.inputs.slice(replayBefore.replay.inputs.length), preservedHistoricalHead: { identity, historicalText },
      rejectionBoundary: 'App currentDecision suppresses a second sending/queued activation; this accepted operation is not claimed as pending-node rejection proof.' });
    finish();
  });
}
