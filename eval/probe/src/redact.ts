// Redaction (R11.3). Leaf module: no imports, never touches env.
// `Secret` is an opaque holder; only `reveal()` returns the value, and only the
// Workers AI adapter and the redactor may call it.
import { inspect } from 'node:util';

export const REDACTED = '[redacted]';

export class Secret {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toString(): string {
    return REDACTED;
  }
  toJSON(): string {
    return REDACTED;
  }
  [inspect.custom](): string {
    return REDACTED;
  }
}

export type SecretLike = string | Secret;

function plain(s: SecretLike): string {
  return typeof s === 'string' ? s : s.reveal();
}

/** The raw string plus its URL-encoded variants, empty strings dropped. */
export function secretVariants(secret: SecretLike): string[] {
  const raw = plain(secret);
  if (raw === '') return [];
  const out = new Set<string>([raw, encodeURIComponent(raw), encodeURI(raw), encodeURIComponent(raw).replace(/%20/g, '+')]);
  // Percent-encodings may be written in lowercase hex.
  for (const v of [...out]) out.add(v.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()));
  return [...out].filter((v) => v !== '');
}

/** Replaces every occurrence of each secret (and its URL-encoded variants) with `[redacted]`. */
export function redact(text: string, secrets: readonly SecretLike[]): string {
  const variants = secrets.flatMap(secretVariants).sort((a, b) => b.length - a.length);
  let out = text;
  for (const v of variants) out = out.split(v).join(REDACTED);
  return out;
}
