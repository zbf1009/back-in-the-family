// Feature: first-playable, Property 28: The Customization preview matches the core
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import type { Customization } from '../../src/shared/protocol.ts';
import type { TraitName, Traits } from '../../src/shared/world-snapshot.ts';
import { TRAITS, blankCustomization, customizationInput, customizationPreview, type CustomizationForm } from '../../src/main/customization.ts';
import { uiFor, waitingSnapshot } from './helpers/view.ts';

const RUNS = 1000;
function form(input: Customization): CustomizationForm {
  return 'Set' in input ? { kind: 'Set', trait: input.Set.trait_name, value: input.Set.value }
    : { kind: 'Adjust', first: input.Adjust.first.trait_name, firstDelta: input.Adjust.first.delta,
      second: input.Adjust.second.trait_name, secondDelta: input.Adjust.second.delta };
}
const traits = fc.record(Object.fromEntries(TRAITS.map(name => [name, fc.integer({ min: -3, max: 3 })])) as Record<TraitName, fc.Arbitrary<number>>);
const input: fc.Arbitrary<Customization> = fc.oneof(
  fc.record({ Set: fc.record({ trait_name: fc.constantFrom(...TRAITS), value: fc.integer({ min: -3, max: 3 }) }, { noNullPrototype: true }) }, { noNullPrototype: true }),
  fc.tuple(fc.uniqueArray(fc.constantFrom(...TRAITS), { minLength: 2, maxLength: 2 }), fc.constantFrom(-1 as const, 1 as const), fc.constantFrom(-1 as const, 1 as const))
    .map(([names, first, second]) => ({ Adjust: { first: { trait_name: names[0]!, delta: first }, second: { trait_name: names[1]!, delta: second } } })),
);

test('Property 28: generated previews use the selected Snapshot base, clamp and carry override', () => {
  fc.assert(fc.property(traits, traits, fc.option(fc.constantFrom(...TRAITS), { nil: null }), input,
    fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), (draw, ghost, carryOver, customization, price) => {
      const world = waitingSnapshot(0, {
        ghost_traits: ghost,
        base_traits: [null, ...TRAITS].map(carry_over => ({ carry_over, traits: carry_over === null ? { ...draw } : { ...draw, [carry_over]: ghost[carry_over] } })),
      });
      world.underworld_view!.slots = world.underworld_view!.slots.map(slot => slot.slot === 'rebuilt_body' ? { ...slot, price: String(price) } : slot);
      const ui = uiFor(world);
      ui.underworldForm = { ...ui.underworldForm, carryOver, customization: form(customization) };
      const before = JSON.stringify(ui.world);
      const preview = customizationPreview(ui.world!, ui.underworldForm)!;
      const base = world.underworld_view!.base_traits.find(entry => entry.carry_over === carryOver)!.traits;
      const expected = { ...base };
      const changed = 'Set' in customization ? [customization.Set.trait_name] : [customization.Adjust.first.trait_name, customization.Adjust.second.trait_name];
      if ('Set' in customization) expected[customization.Set.trait_name] = customization.Set.value;
      else for (const part of [customization.Adjust.first, customization.Adjust.second]) expected[part.trait_name] = Math.max(-3, Math.min(3, base[part.trait_name] + part.delta));
      assert.deepEqual(preview.values.map(row => row.trait), changed);
      assert.deepEqual({ ...base, ...Object.fromEntries(preview.values.map(row => [row.trait, row.customized])) }, expected);
      for (const row of preview.values) assert.equal(row.base, base[row.trait]);
      assert.equal(preview.price, String(price));
      assert.equal(preview.override !== null, carryOver !== null && changed.includes(carryOver));
      if (preview.override !== null) assert.equal(preview.override, `Customization overrides the carried value on ${carryOver}.`);
      assert.equal(JSON.stringify(ui.world), before);
      assert.deepEqual(customizationInput(ui.underworldForm.customization), customization);
    }), { numRuns: RUNS });
});

test('Every shared Rust golden vector gives the same seven-Trait preview', () => {
  const cases: { base: Traits; customization: Customization; expected: Traits }[] = JSON.parse(readFileSync(new URL('../../../fixtures/customization/golden.json', import.meta.url), 'utf8'));
  for (const [index, entry] of cases.entries()) {
    for (const carryOver of [null, 'pride'] as const) {
      const world = waitingSnapshot(0, { ghost_traits: entry.base,
        base_traits: [null, ...TRAITS].map(carry_over => ({ carry_over, traits: entry.base })) });
      const ui = uiFor(world);
      ui.underworldForm = { ...ui.underworldForm, carryOver, customization: form(entry.customization) };
      const preview = customizationPreview(world, ui.underworldForm)!;
      assert.deepEqual({ ...entry.base, ...Object.fromEntries(preview.values.map(row => [row.trait, row.customized])) }, entry.expected, `vector ${index}`);
    }
  }
  assert.ok(cases.length > 0);
});

test('Cancelling or an incomplete form computes no preview and mutates no Snapshot', () => {
  const ui = uiFor(waitingSnapshot());
  const before = JSON.stringify(ui.world);
  for (const customization of [null, blankCustomization('Set'), blankCustomization('Adjust')]) {
    assert.equal(customizationPreview(ui.world!, { ...ui.underworldForm, customization }), null);
  }
  assert.equal(JSON.stringify(ui.world), before);
});
