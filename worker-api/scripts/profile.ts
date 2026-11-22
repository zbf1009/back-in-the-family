import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_REQUEST_BYTE_CAP, decisionObject } from '../../web/src/shared/decision.ts';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export interface SourceConfig {
  $schema: string;
  name: string;
  main: string;
  compatibility_date: '2026-11-10';
  send_metrics: false;
  assets: { directory: string; binding: string; run_worker_first: string[]; not_found_handling: string };
  ai?: { binding: string; remote: false };
  vars: Record<string, unknown>;
}

export function validateSourceConfig(config: unknown): asserts config is SourceConfig {
  assert.ok(decisionObject(config), 'Worker source config must be an object');
  assert.deepEqual(Object.keys(config).sort(), ['$schema', 'ai', 'assets', 'compatibility_date', 'main', 'name', 'send_metrics', 'vars'].sort(), 'Unexpected Worker profile fields or missing AI');
  assert.equal(config.$schema, '../web/node_modules/wrangler/config-schema.json');
  assert.equal(config.name, 'back-in-the-family-decision');
  assert.equal(config.main, './src/index.ts');
  assert.equal(config.compatibility_date, '2026-11-10', 'Use the source-aligned pinned runtime date');
  assert.equal(config.send_metrics, false, 'Worker telemetry must be disabled');
  assert.ok(decisionObject(config.assets));
  assert.deepEqual(Object.keys(config.assets).sort(), ['directory', 'binding', 'run_worker_first', 'not_found_handling'].sort());
  assert.equal(config.assets.directory, '../web/dist');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.deepEqual(config.assets.run_worker_first, ['/api', '/api/*'], 'Both exact and wildcard API routes must run Worker first');
  assert.equal(config.assets.not_found_handling, 'single-page-application', 'SPA fallback must be enabled');
  assert.deepEqual(config.ai, { binding: 'AI', remote: false }, 'Native non-remote AI binding is required');
  assert.deepEqual(config.vars, { INFERENCE_ENABLED: 'false', MAX_REQUEST_BYTES: String(PROJECT_REQUEST_BYTE_CAP) }, 'Ordinary source inference must be disabled with the explicit project transport policy, not a runtime default');
}

export async function sourceConfig(): Promise<SourceConfig> {
  const config: unknown = JSON.parse(await readFile(join(root, 'worker-api/wrangler.jsonc'), 'utf8'));
  validateSourceConfig(config);
  return config;
}
