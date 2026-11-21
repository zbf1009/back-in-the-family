// One static production D contract for the browser and future Decision_Worker.
// No probe import, runtime template read, request DTO or network dependency.
export const DECISION_CONTRACT = Object.freeze({
  provider: 'cloudflare_workers_ai',
  model: '@cf/cloudflare/clef',
  mappingVersion: 'system-one-v1',
  mappingHash: 'e275f397327b91dc1b6f69290535d6ef72c6bb712021ff130ed9da43589b337d',
  responseSchema: 'clef-system-one-choice-v1',
  fingerprint: '6ffb8d3a255dbc1d066ba3b4a1c38291b1adfda5aa1f4e3c65a9adafbd243a32',
} as const);

/** Fixed UTF-8 fields, four NUL separators, and no trailing NUL. */
export function decisionFingerprintInput(): Uint8Array<ArrayBuffer> {
  const { provider, model, mappingVersion, mappingHash, responseSchema } = DECISION_CONTRACT;
  const text = [provider, model, mappingVersion, mappingHash, responseSchema].join('\0');
  // The fixed contract fields and NUL separators are ASCII: one byte each.
  const bytes = new Uint8Array(text.length);
  new TextEncoder().encodeInto(text, bytes);
  return bytes;
}

/** Recompute the fixed contract with the platform SHA-256 implementation. */
export async function decisionFingerprint(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', decisionFingerprintInput());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
