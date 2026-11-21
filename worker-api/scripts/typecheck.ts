import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(new URL('../worker-configuration.d.ts', import.meta.url))) {
  console.error('Generate worker-api/worker-configuration.d.ts with the pinned Wrangler first.');
  process.exit(1);
}
let failed = false;
for (const config of ['tsconfig.json', 'tsconfig.node.json']) {
  console.log(`==> Worker Type_Check ${config}`);
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../../web/node_modules/typescript/bin/tsc', import.meta.url)),
    '-p', config, '--noEmit',
  ], { cwd: packageDir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log('Worker Type_Check passed.');
