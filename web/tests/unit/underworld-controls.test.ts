// Feature: first-playable, Property 27: Underworld controls enable only real paths
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { DREAM_INTENTS } from '../../src/shared/protocol.ts';
import { TRAITS, claimRequest, dreamRequest, type CustomizationForm } from '../../src/main/customization.ts';
import { underworldView } from '../../src/main/view-model.ts';
import { uiFor, waitingSnapshot } from './helpers/view.ts';

const RUNS = 1000;
const trait = fc.option(fc.constantFrom(...TRAITS), { nil: null });
const formArb: fc.Arbitrary<CustomizationForm | null> = fc.oneof(
  fc.constant(null),
  fc.record({ kind: fc.constant('Set' as const), trait, value: fc.option(fc.integer({ min: -4, max: 4 }), { nil: null }) }),
  fc.record({ kind: fc.constant('Adjust' as const), first: trait, second: trait,
    firstDelta: fc.constantFrom(-1 as const, 1 as const, null), secondDelta: fc.constantFrom(-1 as const, 1 as const, null) }),
);
function complete(form: CustomizationForm | null): boolean {
  if (form === null) return false;
  if (form.kind === 'Set') return form.trait !== null && form.value !== null && Number.isInteger(form.value) && form.value >= -3 && form.value <= 3;
  return form.first !== null && form.second !== null && form.first !== form.second
    && form.firstDelta !== null && form.secondDelta !== null;
}

test('Property 27: balances, Snapshot price, Path_Status and complete forms alone enable controls', () => {
  fc.assert(fc.property(
    fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
    fc.boolean(), fc.array(fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()), { minLength: 7, maxLength: 7 }),
    formArb, trait, fc.constantFrom(...DREAM_INTENTS),
    (balance, price, nobody, statuses, customization, carryOver, intent) => {
      const world = waitingSnapshot(5, { dream_price: String(price), connected: nobody ? [] : [1, 3] });
      world.joss = world.joss.map(account => account.soul_id === world.player_soul ? { ...account, balance: String(balance) } : account);
      world.underworld_view!.slots = world.underworld_view!.slots.map((slot, index) => ({ ...slot,
        status: { announced: statuses[index]![0], claimable: statuses[index]![1], affordable: statuses[index]![2], needed: [] } }));
      const ui = uiFor(world);
      ui.underworldForm = { ...ui.underworldForm, customization, carryOver, intent };
      const view = underworldView(ui)!;
      assert.equal(view.balance, String(balance));
      assert.equal(view.dreamPrice, String(price));
      assert.equal(view.dreamEnabled, balance >= price && !nobody);
      assert.deepEqual(underworldView({ ...ui, underworldRecorded: { worldId: 1, tick: world.tick } }), view,
        'recording an input changes no value or enablement before time runs');
      for (const row of view.slots) {
        assert.equal(row.claimEnabled, row.status.claimable && row.status.affordable && (row.slot !== 'rebuilt_body' || complete(customization)));
        const request = claimRequest(ui.underworldForm, row.slot);
        if (row.slot === 'rebuilt_body' && !complete(customization)) assert.equal(request, null);
        else {
          assert.ok(request?.type === 'claim');
          assert.equal(request.slot, row.slot);
          assert.equal(request.carryOver, carryOver);
          assert.equal(Object.hasOwn(request, 'customization'), row.slot === 'rebuilt_body');
        }
      }
      if (view.dreamEnabled) {
        const request = dreamRequest(world, ui.underworldForm);
        assert.ok(request?.type === 'dream');
        assert.equal(request.dreamer, world.underworld_view!.connected[0]);
        assert.equal(request.intent, intent);
      }
    }), { numRuns: RUNS });
});

test('Five Birth_Slots all remain in Snapshot order beside the fixed Standing_Slots', () => {
  const view = underworldView(uiFor(waitingSnapshot(5)))!;
  assert.deepEqual(view.slots.map(row => row.slot), ['birth:1', 'birth:2', 'birth:3', 'birth:4', 'birth:5', 'imported_vessel', 'rebuilt_body']);
  assert.equal(view.slots.filter(row => row.kind === 'birth_slot').length, 5);
});

test('Dream controls retain the Snapshot price and reject an empty recipient set', () => {
  const world = waitingSnapshot(0, { dream_price: '75', connected: [] });
  world.joss = world.joss.map(account => account.soul_id === world.player_soul ? { ...account, balance: '74' } : account);
  const view = underworldView(uiFor(world))!;
  assert.equal(view.dreamEnabled, false);
  assert.equal(view.balance, '74');
  assert.equal(view.dreamPrice, '75');
  assert.equal(view.connected.length, 0);
  assert.deepEqual(DREAM_INTENTS, ['warn', 'reassure', 'urge', 'reveal', 'request_offering', 'forbid']);
});

test('Incomplete or repeated-Trait customization cannot construct a Rebuilt claim', () => {
  const ui = uiFor(waitingSnapshot());
  assert.equal(claimRequest(ui.underworldForm, 'rebuilt_body'), null);
  ui.underworldForm.customization = { kind: 'Adjust', first: 'pride', second: 'pride', firstDelta: 1, secondDelta: -1 };
  assert.equal(claimRequest(ui.underworldForm, 'rebuilt_body'), null);
  assert.deepEqual(claimRequest(ui.underworldForm, 'imported_vessel'), { type: 'claim', slot: 'imported_vessel', carryOver: null });
});

test('LV-C2: world replacement and fatal state gate underworld inputs but an older same-generation tick does not', () => {
  const ui = uiFor(waitingSnapshot());
  const live = underworldView(ui)!;
  assert.equal(live.dreamEnabled, true);
  assert.ok(live.slots.some(slot => slot.claimEnabled));
  for (const blocked of [{ ...ui, createPending: true }, { ...ui, runState: 'failed' as const }, { ...ui, worldId: 0 }]) {
    const view = underworldView(blocked)!;
    assert.equal(view.dreamEnabled, false); assert.ok(view.slots.every(slot => !slot.claimEnabled));
    assert.equal(view.bribe.enabled, false); assert.ok(view.haunt.targets.every(target => !target.enabled));
    assert.equal(view.controlsAvailable, false);
    assert.equal(view.balance, live.balance); assert.equal(view.dreamPrice, live.dreamPrice);
  }
  const older = underworldView({ ...ui, tick: '501', runState: 'running' })!;
  assert.deepEqual(older, live);
});

test('Haunt consumers retain negative-affinity targets and invalidate removed or blocked targets independently', () => {
  const world = waitingSnapshot();
  const ghost = world.player_wait!.ghost;
  world.player.earlier_bodies = [...world.player.earlier_bodies, { id: 100, name: 'An earlier body', origin: 'native', death: '400' }];
  world.player.past_life_ties = [
    { rememberer: 1, earlier_body: ghost, affinity: -51 },
    { rememberer: 3, earlier_body: ghost, affinity: 29 },
    { rememberer: 1, earlier_body: 100, affinity: 88 },
  ];
  const actions = world.underworld_view!.actions;
  actions.haunt.price = '9007199254740993';
  actions.capped_spend = { cap_year: '18446744073709551615', yearly_cap: '18446744073709551615', spent: '18446744073709551606', remaining: '9' };
  const ui = uiFor(world);
  const before = JSON.stringify(ui);
  const initial = underworldView(ui)!;
  assert.deepEqual(initial.haunt.targets.map(target => [target.id, target.affinity, target.enabled]), [[1, -51, true], [3, 29, true]]);
  assert.equal(initial.haunt.price, '9007199254740993');
  assert.deepEqual(initial.cappedSpend, actions.capped_spend);
  assert.equal(initial.bribe.enabled, true, 'Bribe is not gated by the shared capped-spend room');
  const blockedWorld = { ...world, underworld_view: { ...world.underworld_view!, actions: { ...actions,
    haunt: { ...actions.haunt, targets: [
      { target: 1, availability: { eligible: false as const, reason: 'rate_limited' as const } },
      actions.haunt.targets[1]!,
    ] },
  } } };
  const blocked = underworldView({ ...ui, world: blockedWorld })!;
  assert.equal(blocked.haunt.targets[0]!.enabled, false);
  assert.equal(blocked.haunt.targets[0]!.availability.reason, 'rate_limited');
  assert.equal(blocked.haunt.targets[1]!.enabled, true);
  assert.equal(blocked.dreamEnabled, true);
  assert.ok(blocked.slots.some(slot => slot.claimEnabled));
  const removedWorld = { ...world, underworld_view: { ...world.underworld_view!, connected: [3], actions: { ...actions,
    haunt: { ...actions.haunt, targets: [actions.haunt.targets[1]!] },
  } } };
  const removed = underworldView({ ...ui, world: removedWorld })!;
  assert.deepEqual(removed.haunt.targets.map(target => target.id), [3]);
  assert.equal(removed.haunt.targets[0]!.enabled, true);
  assert.equal(JSON.stringify(ui), before);
});
