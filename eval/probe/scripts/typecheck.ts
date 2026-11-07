// Probe Type_Check gate (R16.1), run by `pnpm --dir eval/probe run typecheck`.
//
// Fails clearly when the wasm-bindgen declarations are missing, instead of letting
// TypeScript report unresolved `sim-wasm/*` imports. Then runs
// `tsc -p tsconfig.node.json --noEmit`. Also runs tsconfig.page.json (browser Probe_Page).
// Run directly by Node (type-stripping).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const probeDir = fileURLToPath(new URL('..', import.meta.url));
const tsc = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));
const declFsPath = fileURLToPath(new URL('../../../target/wasm-pkg/sim_wasm.d.ts', import.meta.url));

if (!existsSync(declFsPath)) {
  console.error('Sim_Wasm declarations missing at target/wasm-pkg/sim_wasm.d.ts; run scripts/wasm-build.sh');
  process.exit(1);
}

const projects = ['tsconfig.node.json', 'tsconfig.page.json'];
let failed = false;
for (const project of projects) {
  console.log(`==> tsc -p ${project} --noEmit`);
  const result = spawnSync(tsc, ['-p', project, '--noEmit'], { cwd: probeDir, stdio: 'inherit' });
  if (result.error) {
    console.error(`failed to run tsc: ${result.error.message}`);
    failed = true;
  } else if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  console.error('Probe Type_Check found errors.');
  process.exit(1);
}
console.log('Probe Type_Check passed.');
