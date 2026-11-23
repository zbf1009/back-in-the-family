import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { workerProfile } from './profile.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const profile = workerProfile(process.argv.slice(2));
const declarations = profile === 'judge' ? 'judge-configuration.d.ts' : 'worker-configuration.d.ts';
if (!existsSync(new URL(`../${declarations}`, import.meta.url)) || !existsSync(new URL('../runtime-configuration.d.ts', import.meta.url))) {
  console.error(`Generate worker-api/${declarations} and shared runtime declarations with the pinned Wrangler first.`);
  process.exit(1);
}
const generated = spawnSync(process.execPath, [
  fileURLToPath(new URL('./wrangler.ts', import.meta.url)), 'types:check', '--profile', profile,
], { cwd: packageDir, stdio: 'inherit' });
if (generated.error) throw generated.error;
if (generated.status !== 0) process.exit(1);
let failed = false;
for (const config of profile === 'judge' ? ['tsconfig.judge.json', 'tsconfig.judge.unit.json', 'tsconfig.judge.node.json'] : ['tsconfig.json', 'tsconfig.node.json']) {
  console.log(`==> ${profile} Worker Type_Check ${config}`);
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../../web/node_modules/typescript/bin/tsc', import.meta.url)),
    '-p', config, '--noEmit',
  ], { cwd: packageDir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log('Worker Type_Check passed.');
