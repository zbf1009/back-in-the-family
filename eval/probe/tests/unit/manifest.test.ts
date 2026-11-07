// Manifest_Check examples (llm-probe task 7.1; requirements 1.2, 1.3, 1.7 to 1.10).
// Each test works on a temporary copy of eval/cards (never the real directory) and passes
// the copy's own Manifest hash as the pinned value, so no real hash is written here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkManifest, formatManifestResult } from '../../src/manifest.ts';

const realCards = new URL('../../../cards/', import.meta.url).pathname;

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Copies the Card_Set to a temp dir and returns it with its Manifest hash. */
function withCopy(fn: (dir: string, pinned: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'probe-manifest-'));
    try {
      cpSync(realCards, dir, { recursive: true });
      await fn(dir, sha(readFileSync(path.join(dir, 'MANIFEST.sha256'))));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Rewrites the copy's Manifest and returns the new pinned hash. */
function setManifest(dir: string, text: string): string {
  writeFileSync(path.join(dir, 'MANIFEST.sha256'), text);
  return sha(text);
}

const HEX = 'a'.repeat(64);

test('pass: unchanged copy gives ok, 27 files, one pass line', withCopy(async (dir, pinned) => {
  const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
  assert.equal(r.ok, true);
  assert.equal(r.filesChecked, 27);
  assert.deepEqual(formatManifestResult(r, pinned), [`probe: manifest: ok ${pinned} (27 files checked)`]);
}));

test('wrong pinned hash: reports expected and actual', withCopy(async (dir, pinned) => {
  const wrong = pinned.replace(/^./, pinned[0] === '0' ? '1' : '0');
  const r = await checkManifest({ cardsDir: dir, pinnedHash: wrong });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, [{ kind: 'manifest_hash', expected: wrong, actual: pinned }]);
  const out = formatManifestResult(r, wrong).join('\n');
  assert.ok(out.includes(wrong) && out.includes(pinned));
}));

test('edited file: listed with expected and actual hash, others still checked', withCopy(async (dir, pinned) => {
  const file = path.join(dir, 'LOCK.md');
  const before = readFileSync(file);
  writeFileSync(file, Buffer.concat([before, Buffer.from('x')]));
  const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
  assert.equal(r.ok, false);
  assert.equal(r.filesChecked, 27);
  assert.deepEqual(r.failures, [
    { kind: 'mismatch', path: 'LOCK.md', expected: sha(before), actual: sha(Buffer.concat([before, Buffer.from('x')])) },
  ]);
}));

test('missing file: listed, and every other fault is reported too', withCopy(async (dir, pinned) => {
  rmSync(path.join(dir, 'LOCK.md'));
  writeFileSync(path.join(dir, 'README.md'), 'changed');
  const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
  assert.equal(r.ok, false);
  const kinds = r.failures.map((f) => `${f.kind}:${'path' in f ? f.path : ''}`).sort();
  assert.deepEqual(kinds, ['mismatch:README.md', 'missing:LOCK.md']);
}));

test('malformed line: line numbers reported, well-formed lines still checked', withCopy(async (dir) => {
  const pinned = setManifest(dir, `${HEX}  LOCK.md\nnot a hash line\n${HEX}  README.md\n\n`);
  const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
  assert.equal(r.ok, false);
  const bad = r.failures.filter((f) => f.kind === 'malformed_line').map((f) => f.line);
  assert.deepEqual(bad, [2, 4]);
  assert.ok(formatManifestResult(r, pinned).some((l) => l.includes('line 2')));
}));

test('uppercase hex is malformed', withCopy(async (dir) => {
  const pinned = setManifest(dir, `${'A'.repeat(64)}  LOCK.md\n`);
  const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
  assert.deepEqual(r.failures, [{ kind: 'malformed_line', line: 1 }]);
}));

test('absolute path: failure, file not read', withCopy(async (dir) => {
  const pinned = setManifest(dir, `${HEX}  /etc/hostname\n`);
  const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
  assert.equal(r.ok, false);
  assert.equal(r.filesChecked, 0);
  assert.deepEqual(r.failures, [{ kind: 'bad_path', line: 1, path: '/etc/hostname' }]);
}));

test('.. path: failure, file outside the card set not read', withCopy(async (dir) => {
  const outside = path.join(path.dirname(dir), `probe-outside-${path.basename(dir)}.txt`);
  writeFileSync(outside, 'outside');
  try {
    const pinned = setManifest(dir, `${sha('outside')}  ../${path.basename(outside)}\n${HEX}  sub/../../x\n`);
    const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
    assert.equal(r.ok, false);
    assert.equal(r.filesChecked, 0, 'no escaping path may be hashed, even when the hash would match');
    assert.deepEqual(
      r.failures.map((f) => f.kind),
      ['bad_path', 'bad_path'],
    );
  } finally {
    rmSync(outside, { force: true });
  }
}));

test('missing Manifest: one failure naming the Manifest', withCopy(async (dir) => {
  rmSync(path.join(dir, 'MANIFEST.sha256'));
  const r = await checkManifest({ cardsDir: dir, pinnedHash: HEX });
  assert.equal(r.ok, false);
  assert.equal(r.failures[0]?.kind, 'manifest_unreadable');
  assert.ok(formatManifestResult(r, HEX)[0]?.startsWith('probe: manifest: '));
}));

test('output never contains file content', withCopy(async (dir, pinned) => {
  const marker = 'SECRET-MARKER-7f3a';
  writeFileSync(path.join(dir, 'LOCK.md'), marker);
  const r = await checkManifest({ cardsDir: dir, pinnedHash: pinned });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(marker));
  assert.ok(!formatManifestResult(r, pinned).join('\n').includes(marker));
}));
