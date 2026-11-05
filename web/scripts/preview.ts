// Local_Preview (R7.6, R7.7, R7.10), run by `pnpm --dir web run preview` and
// started by the Smoke_Test through Playwright's `webServer` (task 5).
//
// Two steps:
//   1. R7.10: if the Deploy_Directory `web/dist` is absent OR contains no files,
//      exit 1 with exactly:
//        Deploy_Directory web/dist is missing or empty; run scripts/web-build.sh first
//      "no files" means an empty walk of the tree (an empty dir, or one holding
//      only empty subdirectories, counts as empty; a `.gitkeep` or any regular
//      file at any depth counts as present).
//   2. Otherwise run `vite preview --outDir dist --port 4173 --strictPort` with
//      the same `vite.config.ts`. `vite preview` serves the built files
//      unchanged, contacts no remote host, and sends `Content-Type:
//      application/wasm` for `.wasm` (it uses the mrmime type table), which the
//      Smoke_Test asserts at runtime (R7.6, R7.7).
//
// A thin launcher: it does not start or manage a long-running server itself; it
// replaces this process with `vite preview` (via spawn + exit-code forwarding),
// so Playwright's `webServer` lifecycle owns it. Run directly by Node 26
// (type-stripping); no compile step.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// web/dist, resolved from this file so the script works from any cwd.
const webDir = fileURLToPath(new URL('..', import.meta.url)); // web/
const distDir = join(webDir, 'dist');
const viteBin = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url));

/**
 * Whether the directory tree rooted at `dir` holds at least one regular file at
 * any depth. Returns false when `dir` does not exist, is not a directory, or
 * contains only (possibly nested) empty directories (R7.10).
 */
function hasAnyFile(dir: string): boolean {
  let stats;
  try {
    stats = statSync(dir);
  } catch {
    return false;
  }
  if (!stats.isDirectory()) return false;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const child = statSync(full);
    if (child.isDirectory()) {
      if (hasAnyFile(full)) return true;
    } else if (child.isFile()) {
      return true;
    }
  }
  return false;
}

// R7.10: refuse to start when there is nothing built to serve.
if (!hasAnyFile(distDir)) {
  console.error(
    'Deploy_Directory web/dist is missing or empty; run scripts/web-build.sh first',
  );
  process.exit(1);
}

// R7.6, R7.7: serve web/dist unchanged with `vite preview`, using the same
// vite.config.ts (run from web/). `--strictPort` makes the chosen port fatal
// if taken, so the Smoke_Test never attaches to an unrelated server.
const result = spawnSync(
  viteBin,
  ['preview', '--outDir', 'dist', '--port', '4173', '--strictPort'],
  { cwd: webDir, stdio: 'inherit' },
);

if (result.error) {
  console.error(`failed to run vite preview: ${result.error.message}`);
  process.exit(1);
}
// Forward vite's exit status (including signal terminations) to the caller so
// Playwright's webServer sees the server end exactly as vite did.
if (result.signal !== null) {
  process.exit(1);
}
process.exit(result.status ?? 1);
