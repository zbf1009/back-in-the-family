// Test gates for `derive`: the real gate is `variantDeriveGate`; most tests inject an allowing one.
import type { DeriveGate } from '../../src/derive.ts';

/** Allows every step; tests of the refusal inject their own refusing gate. */
export const allowingGate: DeriveGate = () => ({ ok: true });
