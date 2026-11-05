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
import fc from 'fast-check';
import {
  SIZE_LIMIT,
  sizeOffenders,
  classifyBundle,
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
