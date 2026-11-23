import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_REQUEST_BYTE_CAP, decisionObject } from '../../web/src/shared/decision.ts';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export type WorkerProfile = 'generic' | 'judge';

export function workerProfile(args: readonly string[]): WorkerProfile {
  if (args.length === 0) return 'generic';
  assert.equal(args.length, 2, 'Expected only --profile generic or --profile judge');
  assert.equal(args[0], '--profile');
  assert.ok(args[1] === 'generic' || args[1] === 'judge', 'Unknown Worker profile');
  return args[1];
}
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

export interface JudgeSourceConfig extends SourceConfig {
  workers_dev: true;
  preview_urls: false;
  durable_objects: { bindings: [{ name: 'JUDGE_GATE'; class_name: 'JudgeGate' }] };
  exports: { JudgeGate: { type: 'durable-object'; storage: 'sqlite' } };
}

export interface JudgeHostedConfig extends JudgeSourceConfig {
  no_bundle: true;
}

function validateJudgeConfig(config: unknown, variant: 'source' | 'enabled' | 'disabled'): asserts config is JudgeSourceConfig {
  assert.ok(decisionObject(config), 'Judge config must be an object');
  const hosted = variant !== 'source';
  assert.deepEqual(Object.keys(config).sort(), ['$schema', 'name', 'main', 'compatibility_date', 'send_metrics', 'workers_dev', 'preview_urls', 'assets', 'ai', 'vars', 'durable_objects', 'exports', ...(hosted ? ['no_bundle'] : [])].sort(), 'Unexpected Judge profile fields');
  assert.equal(config.$schema, variant === 'disabled' ? '../../web/node_modules/wrangler/config-schema.json' : '../web/node_modules/wrangler/config-schema.json');
  assert.equal(config.name, 'back-in-the-family-judge');
  assert.equal(config.main, variant === 'source' ? './src/judge.ts' : variant === 'enabled' ? '../target/judge-worker/worker.js' : './worker.js');
  assert.equal(config.compatibility_date, '2026-11-10');
  assert.equal(config.send_metrics, false);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  if (hosted) assert.equal(config.no_bundle, true);
  assert.deepEqual(config.assets, {
    directory: variant === 'disabled' ? '../../web/dist' : '../web/dist', binding: 'ASSETS',
    run_worker_first: ['/', '/api', '/api/*', '/judge/login'], not_found_handling: 'single-page-application',
  });
  assert.deepEqual(config.ai, { binding: 'AI', remote: false });
  assert.deepEqual(config.vars, {
    INFERENCE_ENABLED: variant === 'disabled' ? 'false' : 'true', MAX_REQUEST_BYTES: String(PROJECT_REQUEST_BYTE_CAP),
    SESSION_CAP: '10', JUDGE_DAILY_CAP: '40', JUDGE_SESSION_TTL_SECONDS: '86400',
  });
  assert.deepEqual(config.durable_objects, { bindings: [{ name: 'JUDGE_GATE', class_name: 'JudgeGate' }] });
  assert.deepEqual(config.exports, { JudgeGate: { type: 'durable-object', storage: 'sqlite' } });
}

export function validateJudgeSourceConfig(config: unknown): asserts config is JudgeSourceConfig {
  validateJudgeConfig(config, 'source');
}

export function validateJudgeHostedConfig(config: unknown, variant: 'enabled' | 'disabled' = 'enabled'): asserts config is JudgeHostedConfig {
  validateJudgeConfig(config, variant);
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

export function sourceConfig(): Promise<SourceConfig>;
export function sourceConfig(profile: 'generic'): Promise<SourceConfig>;
export function sourceConfig(profile: 'judge'): Promise<JudgeSourceConfig>;
export function sourceConfig(profile: WorkerProfile): Promise<SourceConfig | JudgeSourceConfig>;
export async function sourceConfig(profile: WorkerProfile = 'generic'): Promise<SourceConfig | JudgeSourceConfig> {
  const config: unknown = JSON.parse(await readFile(join(root, profile === 'judge' ? 'worker-api/judge.jsonc' : 'worker-api/wrangler.jsonc'), 'utf8'));
  if (profile === 'judge') validateJudgeSourceConfig(config);
  else validateSourceConfig(config);
  return config;
}
