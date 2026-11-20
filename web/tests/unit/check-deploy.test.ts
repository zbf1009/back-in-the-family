// Feature: web-shell, Property 10: Size check flags exactly the files above the limit
// Validates: Requirements 7.4, 7.5, 7.9
//
// Property 10 (design.md): For any list of (relative path at any depth, size)
// entries, with sizes biased to 26,214,399, 26,214,400 and 26,214,401, the size
// check (`sizeOffenders`) reports exactly the entries whose size is strictly
// greater than the Size_Limit (26,214,400), in input order, keeping every
// duplicate; a file of exactly the Size_Limit is within the limit; returns an
// empty list iff no entry is over the limit (R7.9: a build passes iff that set
// is empty).
//
// The classifyBundle example tests below exercise the main-bundle boundary
// (R2.3): the single worker chunk is the one `.js` that contains BOTH markers;
// every other `.js` must contain NEITHER; a worker-chunk count other than one
// is itself an offender.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import {
  SIZE_LIMIT,
  sizeOffenders,
  classifyBundle,
  tokenReferenceOffenders,
  cardResultsMarkerOffenders,
  assetInventoryOffenders,
  walkDir,
  type ByteFile,
  type FileEntry,
  type JsFile,
} from '../../scripts/check-deploy.ts';

const RUNS = 1000;

/**
 * Independent reference for `sizeOffenders`: keep, in input order, exactly the
 * entries whose size is strictly greater than the Size_Limit, mapped to the
 * `{ path, size }` offender shape. Duplicates are kept.
 */
function referenceOffenders(entries: readonly FileEntry[]): FileEntry[] {
  return entries
    .filter((e) => e.size > SIZE_LIMIT)
    .map((e) => ({ path: e.path, size: e.size }));
}

/** A path at an arbitrary subdirectory depth, using `/` separators. */
const pathArb = fc
  .array(
    fc.stringMatching(/^[A-Za-z0-9_.-]{1,12}$/),
    { minLength: 1, maxLength: 5 },
  )
  .map((segments) => segments.join('/'));

/**
 * A size biased toward the boundary (SIZE_LIMIT - 1, SIZE_LIMIT, SIZE_LIMIT + 1)
 * so the generated cases hammer the exact pass/fail edge, with a spread of other
 * values mixed in.
 */
const sizeArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(SIZE_LIMIT - 1, SIZE_LIMIT, SIZE_LIMIT + 1) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 60_000_000 }) },
);

const entryArb: fc.Arbitrary<FileEntry> = fc.record({
  path: pathArb,
  size: sizeArb,
});

// Property 10: `sizeOffenders` returns exactly the entries strictly over the
// Size_Limit, in input order and with every duplicate kept, matching an
// independent reference. This pins the > (not >=) comparison at the boundary and
// the order/multiplicity requirement.
test('sizeOffenders flags exactly the entries above the Size_Limit, in order', () => {
  fc.assert(
    fc.property(fc.array(entryArb, { minLength: 0, maxLength: 60 }), (entries) => {
      assert.deepEqual(sizeOffenders(entries), referenceOffenders(entries));
    }),
    { numRuns: RUNS },
  );
});

// Property 10 (boundary, standalone): a size of exactly SIZE_LIMIT is never an
// offender; SIZE_LIMIT - 1 is never an offender; SIZE_LIMIT + 1 always is. The
// path is arbitrary (any depth) so the boundary holds regardless of location.
test('sizeOffenders treats the Size_Limit boundary as pass, pass, fail', () => {
  fc.assert(
    fc.property(pathArb, (path) => {
      assert.deepEqual(sizeOffenders([{ path, size: SIZE_LIMIT - 1 }]), []);
      assert.deepEqual(sizeOffenders([{ path, size: SIZE_LIMIT }]), []);
      assert.deepEqual(sizeOffenders([{ path, size: SIZE_LIMIT + 1 }]), [
        { path, size: SIZE_LIMIT + 1 },
      ]);
    }),
    { numRuns: RUNS },
  );
});

// Example (design.md): one oversized file at subdirectory depth 3, among files
// at or below the limit, is the only flagged entry, reported with its path and
// size. The other entries sit exactly on the boundary (SIZE_LIMIT) and just
// under it, so only the depth-3 file at SIZE_LIMIT + 1 is an offender.
test('sizeOffenders flags a single oversized file at depth 3', () => {
  const entries: FileEntry[] = [
    { path: 'index.html', size: 1_024 },
    { path: 'assets/app.js', size: SIZE_LIMIT - 1 },
    { path: 'assets/wasm/sim_wasm_bg.wasm', size: SIZE_LIMIT },
    { path: 'a/b/c/huge.bin', size: SIZE_LIMIT + 1 },
    { path: 'assets/chunk.js', size: 2_048 },
  ];
  assert.deepEqual(sizeOffenders(entries), [
    { path: 'a/b/c/huge.bin', size: SIZE_LIMIT + 1 },
  ]);
});

// Example: the three boundary cases on their own. SIZE_LIMIT - 1 and SIZE_LIMIT
// pass; SIZE_LIMIT + 1 fails. An empty input produces no offenders (a build with
// no files passes the size check).
test('sizeOffenders handles the exact boundary values and the empty case', () => {
  assert.deepEqual(sizeOffenders([]), []);
  assert.deepEqual(sizeOffenders([{ path: 'under', size: SIZE_LIMIT - 1 }]), []);
  assert.deepEqual(sizeOffenders([{ path: 'at', size: SIZE_LIMIT }]), []);
  assert.deepEqual(sizeOffenders([{ path: 'over', size: SIZE_LIMIT + 1 }]), [
    { path: 'over', size: SIZE_LIMIT + 1 },
  ]);
});

// first-playable R12.7: recursive deployed media inventory and source attribution.
test('asset inventory accepts an empty list when no media ships', () => {
  assert.deepEqual(assetInventoryOffenders([], [], ''), []);
  assert.deepEqual(assetInventoryOffenders([
    { path: 'index.html', size: 10 },
    { path: 'assets/main.js', size: 20 },
    { path: 'assets/sim.wasm', size: 30 },
  ], [], ''), []);
});

test('asset inventory names every unlisted media extension at its exact path', () => {
  const paths = ['png', 'gif', 'webp', 'jpg', 'svg', 'ttf', 'otf', 'woff', 'woff2',
    'mp3', 'ogg', 'wav', 'PNG'].map((ext) => `a/b/c/asset.${ext}`);
  const entries = paths.map((path) => ({ path, size: 1 }));
  assert.deepEqual(assetInventoryOffenders(entries, [], ''),
    paths.map((path) => `unlisted media: ${path}`));
  assert.deepEqual(assetInventoryOffenders(entries,
    paths.map((path) => ({ path, source: 'project' })), ''), []);
});

test('asset inventory uses the recursive walk rather than only top-level media', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bitf-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  writeFileSync(join(root, 'x.png'), 'image');
  writeFileSync(join(root, 'a', 'b', 'font.woff2'), 'font');
  writeFileSync(join(root, 'a', 'main.js'), 'script');
  assert.deepEqual(assetInventoryOffenders(walkDir(root), [], ''), [
    'unlisted media: a/b/font.woff2',
    'unlisted media: x.png',
  ]);
});

const assetReadme = [
  '## Third-party libraries and assets',
  '',
  'Prose Pack is mentioned but not credited in a table.',
  '',
  '| Name | Source URL | License | Files |',
  '|---|---|---|---|',
  '| [`Example Pack`](https://example.invalid/pack) | source | CC0-1.0 | sprites |',
  '',
  '## Other material',
  '',
  '| Name | Source URL | License | Files |',
  '|---|---|---|---|',
  '| Outside Pack | source | CC0-1.0 | fonts |',
].join('\n');

test('asset inventory accepts project media and pack names credited in the README table', () => {
  assert.deepEqual(assetInventoryOffenders([
    { path: 'own.svg', size: 1 },
    { path: 'assets/sprite.png', size: 1 },
  ], [
    { path: 'own.svg', source: 'project' },
    { path: 'assets/sprite.png', source: 'Example Pack' },
  ], assetReadme), []);
});

test('asset inventory rejects sources absent from the third-party table, even if unused', () => {
  for (const source of ['Unknown Pack', 'Prose Pack', 'Outside Pack']) {
    assert.deepEqual(assetInventoryOffenders([{ path: 'font.ttf', size: 1 }], [
      { path: 'font.ttf', source },
      { path: 'unused.png', source },
    ], assetReadme), [
      `font.ttf: source ${JSON.stringify(source)} is not in a README third-party table`,
      `unused.png: source ${JSON.stringify(source)} is not in a README third-party table`,
      'unlisted media: font.ttf',
    ]);
  }
});

test('asset inventory requires exact deployed paths and rejects malformed entries', () => {
  assert.deepEqual(assetInventoryOffenders([{ path: 'a/b/icon.svg', size: 1 }], [
    { path: 'icon.svg', source: 'project' },
  ], ''), ['unlisted media: a/b/icon.svg']);
  assert.deepEqual(assetInventoryOffenders([], {}, ''), [
    'ASSETS.json must be a list of { path, source } entries',
  ]);
  assert.deepEqual(assetInventoryOffenders([{ path: 'x.png', size: 1 }], [
    null, { path: 'x.png' }, { path: '', source: 'project' },
  ], ''), [
    'ASSETS.json entry 0: expected nonempty path and source',
    'ASSETS.json entry 1: expected nonempty path and source',
    'ASSETS.json entry 2: expected nonempty path and source',
    'unlisted media: x.png',
  ]);
});

// ---------------------------------------------------------------------------
// classifyBundle examples (R2.3): the main-bundle boundary.
// ---------------------------------------------------------------------------

/** A worker chunk: the one `.js` that contains BOTH markers. */
function workerFile(path: string): JsFile {
  return { path, hasWbindgen: true, hasWasmName: true };
}

/** A clean main-thread chunk: contains NEITHER marker. */
function cleanFile(path: string): JsFile {
  return { path, hasWbindgen: false, hasWasmName: false };
}

// Example: a main chunk that contains `__wbindgen` (but not the hashed `.wasm`
// name) is NOT a worker chunk (that needs both markers), so with no worker chunk
// present it is flagged twice: once as a chunk-count problem (zero worker chunks)
// and once as a non-worker `.js` that carries a marker (R2.3 boundary violation).
test('classifyBundle flags a main chunk that carries the __wbindgen marker', () => {
  const files: JsFile[] = [
    cleanFile('index.js'),
    { path: 'main.js', hasWbindgen: true, hasWasmName: false },
  ];
  const result = classifyBundle(files);
  assert.equal(result.workerChunk, null);
  // Chunk-count offender first (zero worker chunks), then the marker-bearing
  // non-worker chunk.
  assert.equal(result.offenders.length, 2);
  assert.match(result.offenders[0]!.reason, /found 0/);
  assert.equal(result.offenders[1]!.path, 'main.js');
  assert.match(result.offenders[1]!.reason, /__wbindgen/);
});

// Example: exactly one worker chunk (both markers) with clean main chunks is
// accepted — the worker chunk is identified and there are no offenders.
test('classifyBundle accepts exactly one worker chunk with clean main chunks', () => {
  const files: JsFile[] = [
    cleanFile('index.js'),
    workerFile('assets/sim.worker-abc123.js'),
    cleanFile('assets/vendor.js'),
  ];
  const result = classifyBundle(files);
  assert.equal(result.workerChunk, 'assets/sim.worker-abc123.js');
  assert.deepEqual(result.offenders, []);
});

// Example: zero worker chunks is a chunk-count offender (found 0). With every
// other `.js` clean, that count problem is the only offender.
test('classifyBundle reports zero worker chunks as a chunk-count offender', () => {
  const files: JsFile[] = [cleanFile('index.js'), cleanFile('assets/vendor.js')];
  const result = classifyBundle(files);
  assert.equal(result.workerChunk, null);
  assert.equal(result.offenders.length, 1);
  assert.match(result.offenders[0]!.reason, /found 0/);
});

// Example: two worker chunks is a chunk-count offender (found 2). Because there
// is no single worker chunk, neither file is excluded, so both marker-bearing
// files are also reported as non-worker chunks carrying both markers.
test('classifyBundle reports two worker chunks as a chunk-count offender', () => {
  const files: JsFile[] = [
    workerFile('assets/worker-a.js'),
    workerFile('assets/worker-b.js'),
  ];
  const result = classifyBundle(files);
  assert.equal(result.workerChunk, null);
  // First offender: the chunk-count problem (found 2). Then each worker-marked
  // file as a non-worker boundary violation.
  assert.match(result.offenders[0]!.reason, /found 2/);
  assert.equal(result.offenders.length, 3);
  assert.deepEqual(
    result.offenders.slice(1).map((o) => o.path),
    ['assets/worker-a.js', 'assets/worker-b.js'],
  );
});

// Checks 4 and 5 (llm-probe R3.13, R11.10, R16.2): example tests.
const bytesOf = (path: string, text: string): ByteFile => ({
  path,
  bytes: new TextEncoder().encode(text),
});

test('tokenReferenceOffenders lists every file naming the token or API host', () => {
  const files = [
    bytesOf('a.js', 'x WORKERS_AI_TOKEN y'),
    bytesOf('b.txt', 'clean'),
    bytesOf('c/d.html', 'https://api.cloudflare.com/client'),
  ];
  assert.deepEqual(tokenReferenceOffenders(files), ['a.js', 'c/d.html']);
  assert.deepEqual(tokenReferenceOffenders([files[1]!]), []);
});

test('tokenReferenceOffenders finds a string inside binary bytes', () => {
  const needle = new TextEncoder().encode('WORKERS_AI_TOKEN');
  const bytes = new Uint8Array([0, 255, 1, ...needle, 0, 9]);
  assert.deepEqual(tokenReferenceOffenders([{ path: 'g.wasm', bytes }]), ['g.wasm']);
});

test('cardResultsMarkerOffenders flags quoted markers and the schema prefix only', () => {
  const files = [
    bytesOf('a.json', '{"author_note": 1}'),
    bytesOf('b.json', '{"severe_patterns": []}'),
    bytesOf('c.json', '{"schema":"llm-probe-report-v1"}'),
    bytesOf('d.js', 'author_note severe_patterns llm-probe'),
  ];
  assert.deepEqual(cardResultsMarkerOffenders(files), ['a.json', 'b.json', 'c.json']);
});

// ---------------------------------------------------------------------------
// Feature: llm-probe, Property 35 (Deploy_Directory half): the leak checks find
// every marker. The import half lives in eval/probe/tests/unit/
// check-web-imports.property.test.ts.
// **Validates: Requirements 3.13, 3.16, 11.10, 16.2**
//
// Markers are built at runtime so no test source carries a quoted marker literal.
// ---------------------------------------------------------------------------

const Q = '"';
const TOKEN_MARKERS: readonly string[] = ['WORKERS_AI_' + 'TOKEN', 'api.cloudflare' + '.com'];
const CARD_MARKERS: readonly string[] = [
  Q + 'author_' + 'note' + Q,
  Q + 'severe_' + 'patterns' + Q,
  'llm-' + 'probe-',
];
const LEAK_RUNS = 200;

/** Reference: does the latin1 view of the bytes contain a needle (exact bytes)? */
function hasAny(bytes: Uint8Array, needles: readonly string[]): boolean {
  const s = Buffer.from(bytes).toString('latin1');
  return needles.some((n) => s.includes(n));
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Random bytes (binary included) with an optional marker spliced in at a random offset. */
function fileArb(markers: readonly string[]): fc.Arbitrary<{ bytes: Uint8Array; planted: boolean }> {
  return fc
    .record({
      before: fc.uint8Array({ maxLength: 64 }),
      after: fc.uint8Array({ maxLength: 64 }),
      plant: fc.boolean(),
      marker: fc.constantFrom(...markers),
    })
    .map(({ before, after, plant, marker }) => {
      const mid = plant ? enc(marker) : new Uint8Array(0);
      const bytes = new Uint8Array(before.length + mid.length + after.length);
      bytes.set(before, 0);
      bytes.set(mid, before.length);
      bytes.set(after, before.length + mid.length);
      return { bytes, planted: plant };
    });
}

function fileSetArb(
  markers: readonly string[],
): fc.Arbitrary<{ files: ByteFile[]; planted: string[] }> {
  return fc
    .uniqueArray(pathArb, { maxLength: 12 })
    .chain((paths) =>
      fc.tuple(...paths.map((p) => fileArb(markers).map((f) => ({ p, ...f })))).map((entries) => ({
        files: entries.map((e) => ({ path: e.p, bytes: e.bytes })),
        planted: entries.filter((e) => e.planted).map((e) => e.p),
      })),
    );
}

function checkAgainstReference(
  check: (files: readonly ByteFile[]) => string[],
  markers: readonly string[],
): void {
  fc.assert(
    fc.property(fileSetArb(markers), ({ files, planted }) => {
      const got = check(files);
      const expected = files.filter((f) => hasAny(f.bytes, markers)).map((f) => f.path);
      assert.deepEqual(got, expected);
      // Every planted file is reported; only paths are returned (strings, no content).
      for (const p of planted) assert.ok(got.includes(p));
      if (expected.length === 0) assert.deepEqual(got, []);
    }),
    { numRuns: LEAK_RUNS },
  );
}

test('Property 35: tokenReferenceOffenders reports exactly the files containing a token marker', () => {
  checkAgainstReference(tokenReferenceOffenders, TOKEN_MARKERS);
});

test('Property 35: cardResultsMarkerOffenders reports exactly the files containing a card marker', () => {
  checkAgainstReference(cardResultsMarkerOffenders, CARD_MARKERS);
});

// Matching is on exact bytes: a different case, a marker split by a gap, or one byte
// changed never matches, and a marker straddling any boundary of random filler still does.
test('Property 35: near-miss variants of a marker are not reported', () => {
  const all = [...TOKEN_MARKERS, ...CARD_MARKERS];
  fc.assert(
    fc.property(
      fc.constantFrom(...all),
      fc.nat(),
      fc.uint8Array({ maxLength: 16 }),
      (marker, cut, filler) => {
        // Letter-only variants so the case change really differs.
        const flipped = marker.replace(/[A-Za-z]/, (c) =>
          c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(),
        );
        const at = 1 + (cut % (marker.length - 1));
        const split = marker.slice(0, at) + '\u0001' + marker.slice(at);
        for (const near of [flipped, split]) {
          const f = { path: 'x', bytes: Uint8Array.from([...filler, ...enc(near)]) };
          const expected = hasAny(f.bytes, all) ? ['x'] : [];
          assert.deepEqual(tokenReferenceOffenders([f]), hasAny(f.bytes, TOKEN_MARKERS) ? ['x'] : []);
          assert.deepEqual(cardResultsMarkerOffenders([f]), hasAny(f.bytes, CARD_MARKERS) ? ['x'] : []);
          void expected;
        }
        // Straddling: the marker preceded and followed by arbitrary bytes still matches.
        const hit = { path: 'y', bytes: Uint8Array.from([...filler, ...enc(marker), ...filler]) };
        const tokenHit = TOKEN_MARKERS.includes(marker);
        assert.deepEqual(tokenReferenceOffenders([hit]), tokenHit ? ['y'] : []);
        assert.deepEqual(cardResultsMarkerOffenders([hit]), tokenHit ? [] : ['y']);
      },
    ),
    { numRuns: LEAK_RUNS },
  );
});
