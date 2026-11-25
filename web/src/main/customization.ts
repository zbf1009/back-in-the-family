import type { Customization, DreamIntent, RequestWithoutId } from '../shared/protocol.ts';
import { DREAM_INTENTS } from '../shared/protocol.ts';
import type { Slot, TraitName, WorldSnapshot } from '../shared/world-snapshot.ts';

export const TRAITS: readonly TraitName[] = ['greed', 'loyalty', 'pride', 'warmth', 'temper', 'vindictiveness', 'piety'];
export type CustomizationForm =
  | { kind: 'Set'; trait: TraitName | null; value: number | null }
  | { kind: 'Adjust'; first: TraitName | null; firstDelta: -1 | 1 | null; second: TraitName | null; secondDelta: -1 | 1 | null };
export interface UnderworldForm {
  dreamer: number | null;
  intent: DreamIntent;
  carryOver: TraitName | null;
  customization: CustomizationForm | null;
}

export function parseBribeAmount(value: string): { ok: true; value: string } | { ok: false; error: string } {
  if (value.length === 0 || (value.length > 1 && value[0] === '0') || /[^0-9]/.test(value)) {
    return { ok: false, error: 'Use a canonical decimal amount: digits only, without spaces, signs or leading zeros.' };
  }
  if (value.length > 20 || BigInt(value) > 18446744073709551615n) {
    return { ok: false, error: 'The amount exceeds the maximum u64 value (18446744073709551615).' };
  }
  return { ok: true, value };
}

export function blankCustomization(kind: 'Set' | 'Adjust'): CustomizationForm {
  return kind === 'Set' ? { kind, trait: null, value: null }
    : { kind, first: null, firstDelta: null, second: null, secondDelta: null };
}

export function initialUnderworldForm(): UnderworldForm {
  return { dreamer: null, intent: DREAM_INTENTS[0], carryOver: null, customization: null };
}

export function customizationInput(form: CustomizationForm | null): Customization | null {
  if (form === null) return null;
  if (form.kind === 'Set') {
    if (form.trait === null || !TRAITS.includes(form.trait) || form.value === null
      || !Number.isInteger(form.value) || form.value < -3 || form.value > 3) return null;
    return { Set: { trait_name: form.trait, value: form.value } };
  }
  if (form.first === null || form.second === null || form.first === form.second
    || !TRAITS.includes(form.first) || !TRAITS.includes(form.second)
    || (form.firstDelta !== -1 && form.firstDelta !== 1)
    || (form.secondDelta !== -1 && form.secondDelta !== 1)) return null;
  return { Adjust: { first: { trait_name: form.first, delta: form.firstDelta }, second: { trait_name: form.second, delta: form.secondDelta } } };
}

export function customizationPreview(world: WorldSnapshot, form: UnderworldForm) {
  const input = customizationInput(form.customization);
  if (input === null || world.underworld_view === null) return null;
  const base = world.underworld_view.base_traits.find(entry => entry.carry_over === form.carryOver)!.traits;
  const values = 'Set' in input
    ? [{ trait: input.Set.trait_name, base: base[input.Set.trait_name], customized: input.Set.value }]
    : [input.Adjust.first, input.Adjust.second].map(part => ({
      trait: part.trait_name, base: base[part.trait_name], customized: Math.min(3, Math.max(-3, base[part.trait_name] + part.delta)),
    }));
  const overrides = form.carryOver !== null && values.some(row => row.trait === form.carryOver);
  return {
    values,
    price: world.underworld_view.slots.find(slot => slot.slot === 'rebuilt_body')!.price,
    override: overrides ? `Customization overrides the carried value on ${form.carryOver}.` : null,
  };
}

export function claimRequest(form: UnderworldForm, slot: Slot): RequestWithoutId | null {
  if (slot !== 'rebuilt_body') return { type: 'claim', slot, carryOver: form.carryOver };
  const customization = customizationInput(form.customization);
  return customization === null ? null : { type: 'claim', slot, carryOver: form.carryOver, customization };
}

export function dreamRequest(world: WorldSnapshot, form: UnderworldForm): RequestWithoutId | null {
  if (form.dreamer === null || !world.underworld_view?.connected.includes(form.dreamer)) return null;
  return { type: 'dream', dreamer: form.dreamer, intent: form.intent };
}
