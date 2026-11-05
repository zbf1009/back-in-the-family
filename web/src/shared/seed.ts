// Seed parsing (R2.5, R3.2, R3.3, R3.4, R6.3, R6.4). A Seed is an unsigned 64-bit
// integer carried as a decimal string. parseSeed classifies the entered text and,
// when valid, returns the value as a bigint. It never goes through a JavaScript
// `number`, so values above 2^53 keep their exact value.

export const SEED_MAX = 18_446_744_073_709_551_615n;

export type SeedProblem = 'empty' | 'non-digit' | 'too-large';

export type SeedResult = { ok: true; value: bigint } | { ok: false; problem: SeedProblem };

/**
 * Parse a seed field value. Checks, in this order:
 *   empty string            -> 'empty'
 *   any char outside 0-9    -> 'non-digit' (whitespace, sign, point, exponent)
 *   BigInt(text) > SEED_MAX -> 'too-large'
 * Leading zeros are accepted ("007" is 7). The value is produced with BigInt, never
 * through Number.
 */
export function parseSeed(text: string): SeedResult {
  if (text.length === 0) {
    return { ok: false, problem: 'empty' };
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // '0' is 48, '9' is 57.
    if (code < 48 || code > 57) {
      return { ok: false, problem: 'non-digit' };
    }
  }
  const value = BigInt(text);
  if (value > SEED_MAX) {
    return { ok: false, problem: 'too-large' };
  }
  return { ok: true, value };
}

/** A human-readable message naming the seed problem, shown by the Main_Thread (R3.3). */
export function seedProblemMessage(p: SeedProblem): string {
  switch (p) {
    case 'empty':
      return 'Seed is required: enter a whole number from 0 to 18446744073709551615.';
    case 'non-digit':
      return 'Seed must contain only the digits 0-9 (no spaces, sign, decimal point or exponent).';
    case 'too-large':
      return 'Seed is too large: the maximum is 18446744073709551615.';
  }
}
