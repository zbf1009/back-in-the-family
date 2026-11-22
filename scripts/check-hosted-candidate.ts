import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as WranglerTools from '../web/node_modules/wrangler';
import { PROJECT_REQUEST_BYTE_CAP, decisionObject } from '../web/src/shared/decision.ts';
import {
  assetInventoryOffenders, cardResultsMarkerOffenders, classifyBundle,
  sizeOffenders, tokenReferenceOffenders, walkDir,
} from '../web/scripts/check-deploy.ts';
import { checkedWorkerBundle, digest } from '../worker-api/scripts/bundle.ts';
import { root, validateSourceConfig } from '../worker-api/scripts/profile.ts';
import type { SourceConfig } from '../worker-api/scripts/profile.ts';
import { assertWorkerTools, requireTools } from '../worker-api/scripts/tools.ts';

// These are the existing approved static path, not a new release-authority protocol.
// Any workflow/config change requires separate review; this preparatory checker
// cannot approve a target, select the candidate, enable inference, or deploy.
const STATIC_WORKFLOW = 'b487e475c7a0a87572cfb99c308c39eff319a3b90a29a511d31c73267c2bc2a4';
const STATIC_CONFIG = '19bbf6907bd2c275f23b494a6683f1511124d33bfadc15080c06486238533cd3';
export interface HostedCandidate extends SourceConfig { no_bundle: true }
export interface StaticDeployment { cwd: string; command: string; configPath: string }
export interface HostedCandidateCheck {
  candidate: HostedCandidate;
  bundle: string;
  assets: Record<string, string>;
  production: StaticDeployment;
}

export function validateHostedCandidate(config: unknown): asserts config is HostedCandidate {
  assert.ok(decisionObject(config), 'Hosted candidate must be an object');
  assert.equal(config.name, 'back-in-the-family-decision-draft', 'Candidate is a draft, not the static production target');
  assert.equal(config.main, '../target/decision-worker/worker.js', 'Candidate must consume the checked Worker bundle');
  assert.equal(config.no_bundle, true, 'Candidate must not run a second bundling step');
  const { no_bundle: _noBundle, ...sourceShape } = config;
  validateSourceConfig({ ...sourceShape, name: 'back-in-the-family-decision', main: './src/index.ts' });
}

function readConfig(path: string) {
  const wrangler = requireTools('wrangler') as typeof WranglerTools;
  const args = { config: path };
  const options = { useRedirectIfAvailable: false, hideWarnings: true };
  const loaded = wrangler.experimental_readRawConfig(args, options);
  assert.equal(loaded.configPath, path, 'Wrangler must read the exact requested config');
  assert.ok(!loaded.redirected, 'Redirected config must not substitute checked inputs');
  return { raw: loaded.rawConfig, config: wrangler.unstable_readConfig(args, options) };
}

export async function currentStaticDeployment(projectRoot = root): Promise<StaticDeployment> {
  const workflow = await readFile(join(projectRoot, '.github/workflows/deploy.yml'));
  assert.equal(digest(workflow), STATIC_WORKFLOW,
    'Production CI changed: no hosted release authority exists in this preparation; candidate selection is not approved');
  const configPath = join(projectRoot, 'web/wrangler.jsonc');
  assert.equal(digest(await readFile(configPath)), STATIC_CONFIG, 'The approved static production config must remain byte-exact');
  // Consume the actual checked workflow tail, not a second deployment convention.
  const tail = /working-directory: (web)\n[\s\S]*?\n        run: ([^\n]+)\s*$/.exec(workflow.toString('utf8'));
  assert.ok(tail, 'Expected the current production deployment tail');
  assert.equal(tail[2], 'mise exec -- pnpm exec wrangler deploy');
  const { config } = readConfig(configPath);
  assert.equal(config.main, undefined, 'Current production must remain assets-only');
  assert.equal(config.ai, undefined);
  assert.equal(config.assets?.binding, undefined);
  assert.equal(config.assets?.run_worker_first, undefined);
  assert.equal(config.assets?.not_found_handling, undefined, 'Static production must retain its 404 behavior');
  assert.equal(resolve(dirname(configPath), config.assets?.directory ?? ''), join(projectRoot, 'web/dist'));
  return { cwd: join(projectRoot, tail[1]), command: tail[2], configPath };
}

async function checkedAssets(projectRoot: string): Promise<Record<string, string>> {
  const directory = join(projectRoot, 'web/dist');
  const entries = walkDir(directory);
  assert.deepEqual(sizeOffenders(entries), [], 'Hosted assets exceed the existing per-file limit');
  assert.ok((await readFile(join(directory, 'index.html'))).byteLength > 0, 'Hosted SPA index must be nonempty');
  const files = await Promise.all(entries.map(async entry => ({
    path: entry.path, bytes: await readFile(join(directory, entry.path)),
  })));
  const wasm = files.filter(file => file.path.endsWith('.wasm'));
  assert.equal(wasm.length, 1, 'Hosted assets must contain exactly one WASM module');
  assert.equal(digest(wasm[0].bytes), digest(await readFile(join(projectRoot, 'target/wasm-pkg/sim_wasm_bg.wasm'))),
    'Hosted WASM identity differs from the checked WASM build');
  const wasmName = wasm[0].path.split('/').pop()!;
  assert.deepEqual(classifyBundle(files.filter(file => file.path.endsWith('.js')).map(file => ({
    path: file.path, hasWbindgen: file.bytes.includes('__wbindgen'), hasWasmName: file.bytes.includes(wasmName),
  }))).offenders, [], 'Hosted assets violate the existing main-bundle boundary');
  assert.deepEqual(tokenReferenceOffenders(files), [], 'Hosted assets contain a token/API reference');
  assert.deepEqual(cardResultsMarkerOffenders(files), [], 'Hosted assets contain probe Card/Results markers');
  assert.deepEqual(assetInventoryOffenders(entries,
    JSON.parse(await readFile(join(projectRoot, 'web/assets/ASSETS.json'), 'utf8')),
    await readFile(join(projectRoot, 'README.md'), 'utf8')), [], 'Hosted assets violate the existing media inventory');
  return Object.fromEntries(files.map(file => [file.path, digest(file.bytes)]));
}

/** Offline preparation only; never rebuilds or invokes a deployment command. */
export async function checkHostedCandidate(projectRoot = root): Promise<HostedCandidateCheck> {
  assertWorkerTools();
  const path = join(projectRoot, 'worker-api/hosted-candidate.jsonc');
  const { raw, config } = readConfig(path);
  validateHostedCandidate(raw);
  const source = readConfig(join(projectRoot, 'worker-api/wrangler.jsonc')).raw;
  validateSourceConfig(source);
  assert.equal(config.main, join(projectRoot, 'target/decision-worker/worker.js'));
  assert.equal(config.no_bundle, true);
  assert.equal(config.compatibility_date, source.compatibility_date);
  assert.equal(config.send_metrics, false);
  assert.deepEqual(config.ai, source.ai);
  assert.deepEqual(config.vars, { INFERENCE_ENABLED: 'false', MAX_REQUEST_BYTES: String(PROJECT_REQUEST_BYTE_CAP) });
  assert.equal(resolve(dirname(path), config.assets?.directory ?? ''), join(projectRoot, 'web/dist'));
  assert.equal(config.assets?.binding, 'ASSETS');
  assert.deepEqual(config.assets?.run_worker_first, ['/api', '/api/*']);
  assert.equal(config.assets?.not_found_handling, 'single-page-application');
  const production = await currentStaticDeployment(projectRoot);
  assert.notEqual(production.configPath, path, 'Production must not select the candidate');
  const bundle = digest(Buffer.from(await checkedWorkerBundle(projectRoot)));
  const assets = await checkedAssets(projectRoot);
  return { candidate: raw, bundle, assets, production };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  assert.equal(process.argv.length, 2, 'This checker accepts no release, deployment or inference selectors');
  const checked = await checkHostedCandidate();
  console.log(`Hosted candidate checked offline: Worker SHA-256 ${checked.bundle}, ${Object.keys(checked.assets).length} checked assets; inference disabled, production remains static. No activation authorized.`);
}
