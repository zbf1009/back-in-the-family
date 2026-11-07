// Manifest_Check (llm-probe task 7.1; requirements 1.1 to 1.10).
//
// Proves the Card_Set is the one the Author locked before any card is read or any model is
// called. Files are opened read-only (streams / readFileSync), hashed as bytes, and never
// printed: the output holds only paths, hashes, counts and line numbers (R1.7).
// This module imports only node built-ins. It reads no environment and makes no request (R1.6).
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';

/** The one place the accepted Manifest hash is written down (R1.4). Changing the Card_Set needs a code change. */
export const PINNED_MANIFEST_HASH =
  '9322729c727a8c975dc3273fb7cc2f239e8790ea66e1745493179aea6815b34f';

export const MANIFEST_NAME = 'MANIFEST.sha256';

export type ManifestFailure =
  | { kind: 'manifest_unreadable'; message: string }
  | { kind: 'manifest_hash'; expected: string; actual: string }
  | { kind: 'malformed_line'; line: number }
  | { kind: 'bad_path'; line: number; path: string }
  | { kind: 'missing'; path: string }
  | { kind: 'unreadable'; path: string }
  | { kind: 'mismatch'; path: string; expected: string; actual: string };

export interface ManifestResult {
  ok: boolean;
  /** sha256 of the Manifest file; empty when it could not be read. */
  manifestHash: string;
  /** Number of listed files that were hashed. */
  filesChecked: number;
  failures: ManifestFailure[];
}

export interface CheckManifestOptions {
  /** Directory holding MANIFEST.sha256 and the files it lists (`eval/cards`). */
  cardsDir: string;
  /** The accepted Manifest hash; production callers pass PINNED_MANIFEST_HASH. */
  pinnedHash: string;
}

const LINE_RE = /^([0-9a-f]{64}) +(\S.*)$/;

type Hashed = { kind: 'ok'; hash: string } | { kind: 'missing' } | { kind: 'unreadable' };

function hashFile(file: string): Promise<Hashed> {
  return new Promise((resolve) => {
    const h = createHash('sha256');
    const s = createReadStream(file, { flags: 'r' });
    s.on('data', (chunk) => h.update(chunk));
    s.on('error', (e: NodeJS.ErrnoException) =>
      resolve(e.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable' }),
    );
    s.on('end', () => resolve({ kind: 'ok', hash: h.digest('hex') }));
  });
}

/** True when `rel` is absolute, or resolves to something outside `root`. */
function escapes(root: string, rel: string): boolean {
  if (rel.includes('\0')) return true;
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return true;
  const inside = path.relative(root, path.resolve(root, rel));
  return inside === '' || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside);
}

/** Runs the Manifest_Check on `cardsDir`. Never throws for card-set faults; they come back in `failures`. */
export async function checkManifest(options: CheckManifestOptions): Promise<ManifestResult> {
  const root = path.resolve(options.cardsDir);
  const failures: ManifestFailure[] = [];

  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(root, MANIFEST_NAME));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'unknown';
    failures.push({ kind: 'manifest_unreadable', message: `cannot read ${MANIFEST_NAME} (${code})` });
    return { ok: false, manifestHash: '', filesChecked: 0, failures };
  }

  const manifestHash = createHash('sha256').update(bytes).digest('hex');
  if (manifestHash !== options.pinnedHash) {
    failures.push({ kind: 'manifest_hash', expected: options.pinnedHash, actual: manifestHash });
  }

  // Parse every line; report all malformed ones (R1.8). Only the final empty piece after the
  // closing newline is ignored.
  const lines = bytes.toString('utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const entries: { line: number; hash: string; rel: string }[] = [];
  lines.forEach((text, i) => {
    const m = LINE_RE.exec(text);
    if (m === null) failures.push({ kind: 'malformed_line', line: i + 1 });
    else entries.push({ line: i + 1, hash: m[1] as string, rel: m[2] as string });
  });

  let filesChecked = 0;
  for (const entry of entries) {
    if (escapes(root, entry.rel)) {
      failures.push({ kind: 'bad_path', line: entry.line, path: entry.rel });
      continue;
    }
    const result = await hashFile(path.resolve(root, entry.rel));
    filesChecked++;
    if (result.kind === 'missing') failures.push({ kind: 'missing', path: entry.rel });
    else if (result.kind === 'unreadable') failures.push({ kind: 'unreadable', path: entry.rel });
    else if (result.hash !== entry.hash) {
      failures.push({ kind: 'mismatch', path: entry.rel, expected: entry.hash, actual: result.hash });
    }
  }

  return { ok: failures.length === 0, manifestHash, filesChecked, failures };
}

/** Output lines for a result: all start with `probe: manifest:`; paths, hashes and counts only. */
export function formatManifestResult(result: ManifestResult, pinnedHash: string): string[] {
  if (result.ok) {
    return [`probe: manifest: ok ${pinnedHash} (${result.filesChecked} files checked)`];
  }
  return result.failures.map((f) => {
    switch (f.kind) {
      case 'manifest_unreadable':
        return `probe: manifest: ${f.message}`;
      case 'manifest_hash':
        return `probe: manifest: ${MANIFEST_NAME} hash differs: expected ${f.expected}, actual ${f.actual}`;
      case 'malformed_line':
        return `probe: manifest: ${MANIFEST_NAME} line ${f.line} is malformed`;
      case 'bad_path':
        return `probe: manifest: ${MANIFEST_NAME} line ${f.line}: path is absolute or outside the card set (not read): ${JSON.stringify(f.path)}`;
      case 'missing':
        return `probe: manifest: missing file: ${f.path}`;
      case 'unreadable':
        return `probe: manifest: unreadable file: ${f.path}`;
      case 'mismatch':
        return `probe: manifest: hash mismatch: ${f.path} (expected ${f.expected}, actual ${f.actual})`;
    }
  });
}
