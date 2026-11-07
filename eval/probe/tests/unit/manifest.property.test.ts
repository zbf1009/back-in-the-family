// Feature: llm-probe, Property 16: The Manifest_Check reports exactly the faults
// Validates: Requirements 1.2, 1.3, 1.5, 1.7, 1.8, 1.9, 1.10, 16.10
//
// Each case builds a fresh Card_Set copy under the OS temp directory (never under eval/cards/):
// the files the real Manifest lists are copied byte for byte, a random marker is appended to
// each copy, and a Manifest for the marked copy is written. Faults are then injected into the
// copy. The real Card_Set is only read as bytes by copyFileSync and never written. No card
// content is read as text here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { checkManifest, formatManifestResult, MANIFEST_NAME } from '../../src/manifest.ts';

const REAL_CARDS = new URL('../../../cards/', import.meta.url).pathname;

// The list of listed paths comes from the Manifest only (path column), never from card files.
const LISTED: string[] = readFileSync(path.join(REAL_CARDS, MANIFEST_NAME), 'utf8')
  .split('\n')
  .filter((l) => l !== '')
  .map((l) => l.slice(66));

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

type Fault = 'none' | 'edit' | 'delete' | 'unreadable' | 'absolute' | 'dotdot' | 'malformed';
const faultArb: fc.Arbitrary<Fault> = fc.oneof(
  { weight: 6, arbitrary: fc.constant<Fault>('none') },
  { weight: 1, arbitrary: fc.constant<Fault>('edit') },
  { weight: 1, arbitrary: fc.constant<Fault>('delete') },
  { weight: 1, arbitrary: fc.constant<Fault>('unreadable') },
  { weight: 1, arbitrary: fc.constant<Fault>('absolute') },
  { weight: 1, arbitrary: fc.constant<Fault>('dotdot') },
  { weight: 1, arbitrary: fc.constant<Fault>('malformed') },
);

const MALFORMED = ['garbage line', `${'A'.repeat(64)}  x`, `${'a'.repeat(63)}  x`, 'nohash'];

/** Relative path -> "dir" or the sha256 of the file; a sorted listing of the whole tree. */
function snapshot(root: string, rel = ''): [string, string][] {
  const out: [string, string][] = [];
  for (const name of readdirSync(path.join(root, rel)).sort()) {
    const r = rel === '' ? name : `${rel}/${name}`;
    const full = path.join(root, r);
    if (statSync(full).isDirectory()) {
      out.push([r, 'dir'], ...snapshot(root, r));
    } else {
      out.push([r, sha(readFileSync(full))]);
    }
  }
  return out;
}

async function withCapturedOutput<T>(fn: () => Promise<T>): Promise<{ value: T; printed: string }> {
  let printed = '';
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown): boolean => {
    printed += String(chunk);
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    return { value: await fn(), printed };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

test('Property 16: the Manifest_Check reports exactly the faults', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(faultArb, { minLength: LISTED.length, maxLength: LISTED.length }),
      fc.boolean(),
      fc.stringMatching(/^[0-9a-f]{24}$/),
      async (faults, wrongHash, marker) => {
        const tmp = mkdtempSync(path.join(tmpdir(), 'probe-manifest-'));
        try {
          const cards = path.join(tmp, 'cards');
          const outside = path.join(tmp, 'outside.txt');
          writeFileSync(outside, `outside ${marker}\n`);
          const outsideHash = sha(readFileSync(outside));

          // Copy the listed files and write a marker into each copy.
          const hashes: string[] = [];
          for (const rel of LISTED) {
            const dest = path.join(cards, rel);
            mkdirSync(path.dirname(dest), { recursive: true });
            copyFileSync(path.join(REAL_CARDS, rel), dest);
            appendFileSync(dest, `\n${marker}\n`);
            hashes.push(sha(readFileSync(dest)));
          }

          // Manifest for the marked copy, with line-level faults.
          const expected: string[] = [];
          const lines = LISTED.map((rel, i) => {
            const line = i + 1;
            const f = faults[i] as Fault;
            const hash = hashes[i] as string;
            switch (f) {
              case 'absolute':
                expected.push(`bad_path:${line}`);
                return `${outsideHash}  ${outside}`;
              case 'dotdot':
                expected.push(`bad_path:${line}`);
                return `${outsideHash}  ../outside.txt`;
              case 'malformed':
                expected.push(`malformed_line:${line}`);
                return MALFORMED[i % MALFORMED.length] as string;
              case 'edit':
                expected.push(`mismatch:${rel}`);
                return `${hash}  ${rel}`;
              case 'delete':
                expected.push(`missing:${rel}`);
                return `${hash}  ${rel}`;
              case 'unreadable':
                expected.push(`unreadable:${rel}`);
                return `${hash}  ${rel}`;
              case 'none':
                return `${hash}  ${rel}`;
            }
          });
          const manifest = `${lines.join('\n')}\n`;
          writeFileSync(path.join(cards, MANIFEST_NAME), manifest);
          const pinnedHash = wrongHash ? '0'.repeat(64) : sha(manifest);
          if (wrongHash) expected.push('manifest_hash');

          // File-level faults on the copy.
          LISTED.forEach((rel, i) => {
            const full = path.join(cards, rel);
            const f = faults[i] as Fault;
            if (f === 'edit') appendFileSync(full, 'x');
            if (f === 'delete') rmSync(full);
            if (f === 'unreadable') {
              rmSync(full);
              mkdirSync(full);
            }
          });

          const before = snapshot(tmp);
          const { value: result, printed } = await withCapturedOutput(() =>
            checkManifest({ cardsDir: cards, pinnedHash }),
          );
          const after = snapshot(tmp);

          // Exactly the injected faults, nothing else.
          const reported = result.failures.map((f) => {
            switch (f.kind) {
              case 'bad_path':
              case 'malformed_line':
                return `${f.kind}:${f.line}`;
              case 'mismatch':
              case 'missing':
              case 'unreadable':
                return `${f.kind}:${f.path}`;
              case 'manifest_hash':
                return 'manifest_hash';
              case 'manifest_unreadable':
                return 'manifest_unreadable';
            }
          });
          assert.deepEqual([...reported].sort(), [...expected].sort());
          assert.equal(result.ok, expected.length === 0);

          // Output: pass line only without faults; never any file content.
          const output = formatManifestResult(result, pinnedHash);
          if (expected.length === 0) {
            assert.equal(result.filesChecked, LISTED.length);
            assert.deepEqual(output, [
              `probe: manifest: ok ${pinnedHash} (${LISTED.length} files checked)`,
            ]);
          } else {
            assert.equal(output.length, expected.length);
            assert.ok(output.every((l) => !l.includes(': ok ')));
          }
          const everything = `${printed}\n${output.join('\n')}\n${JSON.stringify(result)}`;
          assert.ok(!everything.includes(marker), 'a file marker leaked into the output');

          // The run changed no byte of the copy.
          assert.deepEqual(after, before);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: 200 },
  );
});
