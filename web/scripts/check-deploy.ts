// Deploy_Directory checks (R2.3, R7.3, R7.4, R7.5, R7.9), run by
// `pnpm --dir web run check-deploy` and from `scripts/web-build.sh`.
//
// Three checks run over `web/dist`, IN THIS ORDER. Each check prints ALL of its
// offenders (not just the first), then the script exits 1 if ANY check failed,
// and exits 0 only when all three pass:
//
//   1. Size (R7.4, R7.5): every file at any subdirectory depth must be at or
//      below the Size_Limit of 26,214,400 bytes. A file of exactly 26,214,400
//      bytes passes; strictly greater fails. Each offender is printed as
//      `<path relative to dist> <size> bytes > 26214400`.
//   2. WASM identity (R7.3): `dist` must contain exactly one `.wasm` file and
//      its SHA-256 must equal that of `target/wasm-pkg/sim_wasm_bg.wasm` (the
//      file `scripts/wasm-build.sh` produced in the same run).
//   3. Main-bundle boundary (R2.3): the worker chunk is the one `.js` file that
//      contains BOTH the wasm-bindgen marker `__wbindgen` AND the hashed `.wasm`
//      file name. Every other `.js` file must contain NEITHER marker, so the
//      Main_Thread bundle never imports Sim_Wasm or requests the `.wasm` file.
//
// Run directly by Node 26 (type-stripping); no compile step. The pure functions
// `sizeOffenders` and `classifyBundle` are exported so the Property 10 unit test
// (task 4.3) can exercise them without building a real `dist`.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Size_Limit: 25 MiB. A file of exactly this many bytes is within the limit;
// strictly greater is an offender.
export const SIZE_LIMIT = 26_214_400;

/** One file in the Deploy_Directory: its path relative to `dist` and its size. */
export interface FileEntry {
  /** Path relative to `dist`, using `/` separators. */
  path: string;
  /** Size in bytes. */
  size: number;
}

/** A file over the Size_Limit, reported by the size check. */
export interface SizeOffender {
  path: string;
  size: number;
}

/**
 * PURE size check (R7.4, R7.5). Given the (path, size) entries of the
 * Deploy_Directory, return every entry strictly larger than the Size_Limit, in
 * the order the entries were given. A file of exactly SIZE_LIMIT bytes passes.
 */
export function sizeOffenders(entries: readonly FileEntry[]): SizeOffender[] {
  const offenders: SizeOffender[] = [];
  for (const entry of entries) {
    if (entry.size > SIZE_LIMIT) {
      offenders.push({ path: entry.path, size: entry.size });
    }
  }
  return offenders;
}

/** One `.js` file as seen by the boundary classifier. */
export interface JsFile {
  /** Path relative to `dist`, using `/` separators. */
  path: string;
  /** Whether the file contains the wasm-bindgen marker `__wbindgen`. */
  hasWbindgen: boolean;
  /** Whether the file contains the hashed `.wasm` file name. */
  hasWasmName: boolean;
}

/** Result of classifying the `.js` files for the main-bundle boundary (R2.3). */
export interface BundleClassification {
  /** Path of the single worker chunk, or null if there is not exactly one. */
  workerChunk: string | null;
  /**
   * `.js` files that violate the boundary: either a non-worker chunk that
   * contains a marker, or a count of worker chunks other than one.
   */
  offenders: BundleOffender[];
}

/** A `.js` file (or chunk-count problem) that breaks the main-bundle boundary. */
export interface BundleOffender {
  path: string;
  reason: string;
}

/**
 * PURE main-bundle boundary classifier (R2.3). The worker chunk is the one
 * `.js` file that contains BOTH markers (`__wbindgen` and the hashed `.wasm`
 * name). Every other `.js` file must contain NEITHER marker.
 *
 * Offenders are:
 *   - any non-worker `.js` file that contains either marker (the Main_Thread
 *     bundle must not import Sim_Wasm or name the `.wasm` file), and
 *   - a count of worker chunks (files with both markers) that is not exactly
 *     one, reported as a single offender describing the count.
 *
 * Offenders are returned in the order the files were given (chunk-count
 * problems, when present, come first so the failure is obvious).
 */
export function classifyBundle(files: readonly JsFile[]): BundleClassification {
  const workerChunks = files.filter((f) => f.hasWbindgen && f.hasWasmName);
  const offenders: BundleOffender[] = [];

  // Exactly one worker chunk is expected (D3: Vite emits one ES worker chunk
  // that imports the glue and the `.wasm` url).
  if (workerChunks.length !== 1) {
    offenders.push({
      path: workerChunks.map((f) => f.path).join(', ') || '(none)',
      reason:
        `expected exactly one worker chunk (a .js with both __wbindgen and the ` +
        `hashed .wasm name), found ${workerChunks.length}`,
    });
  }
  const workerChunk = workerChunks.length === 1 ? workerChunks[0].path : null;

  // Every file that is not the sole worker chunk must contain NEITHER marker.
  for (const file of files) {
    if (file.path === workerChunk) continue;
    if (file.hasWbindgen || file.hasWasmName) {
      const markers: string[] = [];
      if (file.hasWbindgen) markers.push('__wbindgen');
      if (file.hasWasmName) markers.push('the hashed .wasm name');
      offenders.push({
        path: file.path,
        reason: `non-worker .js contains ${markers.join(' and ')}`,
      });
    }
  }

  return { workerChunk, offenders };
}

// ---------------------------------------------------------------------------
// Directory walk and real-dist run below. Everything above is pure and tested
// by task 4.3; everything below reads the filesystem and prints/exits.
// ---------------------------------------------------------------------------

/**
 * Walk `dir` recursively (any depth) and return one FileEntry per regular file,
 * with paths relative to `dir` using `/` separators. Directories themselves are
 * not entries. The walk is ordered (sorted names) so output is deterministic.
 */
export function walkDir(dir: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const recurse = (current: string): void => {
    const names = readdirSync(current).sort();
    for (const name of names) {
      const full = join(current, name);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        recurse(full);
      } else if (stats.isFile()) {
        const rel = relative(dir, full).split(sep).join('/');
        entries.push({ path: rel, size: stats.size });
      }
    }
  };
  recurse(dir);
  return entries;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main(): void {
  const distDir = fileURLToPath(new URL('../dist', import.meta.url));
  const referenceWasm = fileURLToPath(
    new URL('../../target/wasm-pkg/sim_wasm_bg.wasm', import.meta.url),
  );

  const entries = walkDir(distDir);
  let failed = false;

  // --- Check 1: size (R7.4, R7.5). Print every offender. ---
  const overLimit = sizeOffenders(entries);
  for (const offender of overLimit) {
    console.error(`${offender.path} ${offender.size} bytes > ${SIZE_LIMIT}`);
  }
  if (overLimit.length > 0) {
    failed = true;
  }

  // --- Check 2: WASM identity (R7.3). Print every offender. ---
  const wasmFiles = entries.filter((e) => e.path.endsWith('.wasm'));
  if (wasmFiles.length !== 1) {
    console.error(
      `expected exactly one .wasm file in dist, found ${wasmFiles.length}: ` +
        `${wasmFiles.map((f) => f.path).join(', ') || '(none)'}`,
    );
    failed = true;
  } else {
    const distWasm = join(distDir, ...wasmFiles[0].path.split('/'));
    const distHash = sha256(distWasm);
    const referenceHash = sha256(referenceWasm);
    if (distHash !== referenceHash) {
      console.error(
        `.wasm identity mismatch: ${wasmFiles[0].path} (SHA-256 ${distHash}) ` +
          `differs from target/wasm-pkg/sim_wasm_bg.wasm (SHA-256 ${referenceHash})`,
      );
      failed = true;
    }
  }

  // --- Check 3: main-bundle boundary (R2.3). Print every offender. ---
  // The hashed `.wasm` name is just the base name of the single wasm file, used
  // to detect references to it in the Main_Thread bundle.
  const wasmBaseName =
    wasmFiles.length === 1 ? wasmFiles[0].path.split('/').pop()! : null;
  const jsFiles: JsFile[] = entries
    .filter((e) => e.path.endsWith('.js'))
    .map((e) => {
      const content = readFileSync(join(distDir, ...e.path.split('/')), 'utf8');
      return {
        path: e.path,
        hasWbindgen: content.includes('__wbindgen'),
        hasWasmName: wasmBaseName !== null && content.includes(wasmBaseName),
      };
    });
  const bundle = classifyBundle(jsFiles);
  for (const offender of bundle.offenders) {
    console.error(`main-bundle boundary: ${offender.path}: ${offender.reason}`);
  }
  if (bundle.offenders.length > 0) {
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    `check-deploy passed: ${entries.length} files, ` +
      `.wasm ${wasmFiles[0]?.path ?? '(none)'} matches target/wasm-pkg, ` +
      `worker chunk ${bundle.workerChunk ?? '(none)'}.`,
  );
}

// Only run the real-dist check when executed as a script, not when imported by
// the unit test (which imports only the pure functions).
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
