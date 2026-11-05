// Type_Check gate (R8.1-R8.5, R10.1), run by `pnpm --dir web run typecheck`.
//
// Order of operations:
//   1. Confirm the wasm-bindgen declarations for Sim_Wasm exist. If they are
//      absent the whole check fails with a clear message (R8.5), rather than
//      letting TypeScript fall back to treating `sim-wasm` as untyped.
//   2. Run the three project type checks that together cover every first-party
//      .ts and .svelte file (R8.1):
//        - svelte-check --tsconfig tsconfig.app.json  (Main_Thread + App.svelte + shared)
//        - tsc -p tsconfig.worker.json --noEmit        (Sim_Worker + shared, checked
//          against the generated sim_wasm.d.ts via the `sim-wasm/*` paths entry, R8.4)
//        - tsc -p tsconfig.node.json --noEmit          (vite.config.ts, scripts, tests)
//
// Every check runs even when an earlier one fails, so a single invocation shows
// all errors. The gate exits non-zero if ANY check reports an error; warnings
// (svelte-check only) do not change the status (R8.2, R8.3).
//
// Run directly by Node 26 (type-stripping); no compile step. Spawns the local
// svelte-check and tsc binaries from web/node_modules/.bin.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Directories, resolved from this file so the script works from any cwd.
const webDir = fileURLToPath(new URL('..', import.meta.url)); // web/
const binDir = fileURLToPath(new URL('../node_modules/.bin/', import.meta.url));
// The generated declarations live at the repo's target/wasm-pkg. Keep the
// repo-relative strings for the human-facing message (R8.5).
const declRepoPath = 'target/wasm-pkg/sim_wasm.d.ts';
const declFsPath = fileURLToPath(new URL('../../target/wasm-pkg/sim_wasm.d.ts', import.meta.url));

// R8.5: the Sim_Wasm declarations must be present. Without them the worker code
// would type-check against an untyped `sim-wasm`, hiding exactly the mismatches
// this gate exists to catch (R8.4). Fail loudly and point at the build script.
if (!existsSync(declFsPath)) {
  console.error(
    `Sim_Wasm declarations missing at ${declRepoPath}; run scripts/wasm-build.sh`,
  );
  process.exit(1);
}

const bin = (name: string): string => `${binDir}${name}`;

// One type check: a label for the summary and the command to run.
interface Check {
  label: string;
  command: string;
  args: string[];
}

const checks: Check[] = [
  {
    label: 'svelte-check --tsconfig tsconfig.app.json',
    command: bin('svelte-check'),
    args: ['--tsconfig', 'tsconfig.app.json'],
  },
  {
    label: 'tsc -p tsconfig.worker.json --noEmit',
    command: bin('tsc'),
    args: ['-p', 'tsconfig.worker.json', '--noEmit'],
  },
  {
    label: 'tsc -p tsconfig.node.json --noEmit',
    command: bin('tsc'),
    args: ['-p', 'tsconfig.node.json', '--noEmit'],
  },
];

let failed = false;
for (const check of checks) {
  console.log(`==> ${check.label}`);
  // Inherit stdio so the file and line of every error reaches the gate's
  // console output unchanged (R8.2).
  const result = spawnSync(check.command, check.args, {
    cwd: webDir,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`failed to run ${check.label}: ${result.error.message}`);
    failed = true;
    continue;
  }
  // A non-zero exit from tsc or a svelte-check run with >0 errors means the
  // check reported errors. svelte-check exits 0 when it found only warnings, so
  // warnings alone never reach here (R8.3).
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  console.error('Type_Check found errors.');
  process.exit(1);
}

console.log('Type_Check passed.');
