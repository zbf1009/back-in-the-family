import assert from 'node:assert/strict';
import { accessSync, constants, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { root } from './profile.ts';

export const requireTools = createRequire(realpathSync(join(root, 'web/node_modules/wrangler/package.json')));
export const PINS = { wrangler: '4.157.0', miniflare: '5.20261103.0-beta', workerd: '1.20261103.1', esbuild: '0.28.2' };

export function assertWorkerTools(): void {
  assert.equal(process.version, 'v26.7.0', 'Use the prepared pinned Node binary');
  assert.equal(process.env.WRANGLER_SEND_METRICS, 'false');
  assert.equal(process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false');
  assert.deepEqual(Object.keys(networkInterfaces()).sort(), ['lo'], 'Worker gates require a whole-process isolated network namespace with loopback up');
  for (const [name, version] of Object.entries(PINS)) {
    assert.equal(requireTools(`${name}/package.json`).version, version, `Unexpected ${name} version; prepare the locked dependencies before gates`);
  }
  for (const path of ['workerd/bin/workerd', 'esbuild/bin/esbuild']) {
    accessSync(requireTools.resolve(path), constants.X_OK);
  }
}
