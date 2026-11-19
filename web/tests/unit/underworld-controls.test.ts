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
      assert.equal(view.dreamReasons.length, Number(balance < price) + Number(nobody));
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

test('Dream controls name both disabled reasons and use a non-default Snapshot price', () => {
  const world = waitingSnapshot(0, { dream_price: '75', connected: [] });
  world.joss = world.joss.map(account => account.soul_id === world.player_soul ? { ...account, balance: '74' } : account);
  const view = underworldView(uiFor(world))!;
  assert.equal(view.dreamEnabled, false);
  assert.deepEqual(view.dreamReasons, ['Not enough joss paper for a dream.', 'No connected people.']);
  assert.deepEqual(DREAM_INTENTS, ['warn', 'reassure', 'urge', 'reveal', 'request_offering', 'forbid']);
});

test('Incomplete or repeated-Trait customization cannot construct a Rebuilt claim', () => {
  const ui = uiFor(waitingSnapshot());
  assert.equal(claimRequest(ui.underworldForm, 'rebuilt_body'), null);
  ui.underworldForm.customization = { kind: 'Adjust', first: 'pride', second: 'pride', firstDelta: 1, secondDelta: -1 };
  assert.equal(claimRequest(ui.underworldForm, 'rebuilt_body'), null);
  assert.deepEqual(claimRequest(ui.underworldForm, 'imported_vessel'), { type: 'claim', slot: 'imported_vessel', carryOver: null });
});
