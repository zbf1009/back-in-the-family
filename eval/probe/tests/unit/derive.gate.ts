// Test gates for `derive`: the real gate arrives with task 42.1, so tests inject an allowing one.
import type { DeriveGate } from '../../src/derive.ts';

/** Allows every step; tests of the refusal use `refusingDeriveGate` from the source instead. */
export const allowingGate: DeriveGate = () => ({ ok: true });
