import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedWorkerBundle, digest } from '../worker-api/scripts/bundle.ts';
import { root, validateJudgeSourceConfig, validateJudgeHostedConfig } from '../worker-api/scripts/profile.ts';
import { assertWorkerTools, requireTools } from '../worker-api/scripts/tools.ts';
import { judgeRuntimeFixture } from '../worker-api/tests/helpers/judge-runtime.ts';
import { assertPrivateContent, assertSame, checkedSource, copyBytes, freshDirectory, jsonBytes,
  manifest, readClosedTree, readRegularFile, readWranglerConfig, safeRelativePath, validateAssets,
  validateIdentity, verifyArtifactInputs } from './artifact-inputs.ts';
import type { ArtifactBytes, ArtifactFile, CheckedInputs, ReleaseIdentity } from './artifact-inputs.ts';
import { selectSdkLock, validateSdkLock } from './artifact-sdk-lock.ts';
import { currentStaticDeployment } from './check-hosted-candidate.ts';

const SHA = /^[a-f0-9]{64}$/;
export const JUDGE_MANIFEST_PATH = 'target/judge-worker/judge-manifest.json';
export const JUDGE_SOURCE_PATHS = [
  'worker-api/src/obituary.ts', 'web/src/shared/obituary.ts', 'web/src/main/obituary-template.ts', 'web/src/main/calendar.ts',
  'worker-api/judge.jsonc', 'worker-api/judge-hosted.jsonc', 'worker-api/judge-configuration.d.ts',
  'worker-api/worker-configuration.d.ts', 'worker-api/runtime-configuration.d.ts',
  'worker-api/tsconfig.judge.json', 'worker-api/tsconfig.judge.node.json', 'worker-api/tsconfig.judge.unit.json', 'worker-api/tsconfig.node.json',
  ...['profile', 'wrangler', 'bundle', 'typecheck', 'tools'].map(name => `worker-api/scripts/${name}.ts`),
  ...['runtime', 'judge-runtime', 'decision'].map(name => `worker-api/tests/helpers/${name}.ts`),
  ...['unit', 'runtime', 'artifact'].map(name => `worker-api/tests/judge/${name}.test.ts`),
  'scripts/judge-gates.sh', 'scripts/check-judge-artifact.ts',
  '.github/workflows/deploy.yml', '.github/workflows/deploy-judge.yml',
].sort();
const PATHS = {
  worker: 'target/judge-worker/worker.js', source: 'worker-api/judge.jsonc', hosted: 'worker-api/judge-hosted.jsonc',
  disabled: 'target/judge-worker/deploy-disabled.jsonc', wasm: 'target/wasm-pkg/sim_wasm_bg.wasm',
  healthyLock: 'web/pnpm-lock.yaml', deployPackage: 'worker-api/artifact-deploy/package.json',
  deployLock: 'worker-api/artifact-deploy/pnpm-lock.yaml', runtimeTypes: 'worker-api/runtime-configuration.d.ts',
  judgeTypes: 'worker-api/judge-configuration.d.ts',
} as const;
const TOOLCHAIN = { node: 'v26.7.0', pnpm: '10.33.1', wrangler: '4.157.0', miniflare: '5.20261103.0-beta', workerd: '1.20261103.1', esbuild: '0.28.2' } as const;
const EXPORTS = { default: 'fetch', JudgeGate: { type: 'durable-object', storage: 'sqlite' } } as const;
const BINDINGS = { AI: 'AI', ASSETS: 'ASSETS', JUDGE_GATE: { class_name: 'JudgeGate', pool_name: 'review-pool-v1' }, secretNames: ['JUDGE_CODE'] } as const;
const POLICY = { maxRequestBytes: 16384, loginRequestBytes: 256, dailyLimit: 40, sessionLimit: 10,
  sessionTtlSeconds: 86400, workerFirst: ['/', '/api', '/api/*', '/judge/login'], previewUrls: false } as const;
export interface JudgeExpectation {
  identity: ReleaseIdentity;
  upstream: { identity: ReleaseIdentity; artifactId: string; archiveSHA256: string; envelopeSHA: string };
  /** Raw authenticated archive; metadata authentication is the caller's responsibility. */
  archivePath: string;
  mode: 'local' | 'ci';
}
export interface JudgeManifest {
  version: 'judge-artifact-v1'; identity: ReleaseIdentity; upstream: JudgeExpectation['upstream'];
  worker: ArtifactFile; configs: { source: ArtifactFile; hosted: ArtifactFile; disabled: ArtifactFile };
  assets: ArtifactFile[]; assetsSHA256: string; wasm: { source: ArtifactFile; assetPath: string };
  sources: { digests: Record<string, string>; sha256: string };
  sdk: { toolchain: typeof TOOLCHAIN; healthyLock: ArtifactFile; deployPackage: ArtifactFile; deployLock: ArtifactFile;
    runtimeTypes: ArtifactFile; judgeTypes: ArtifactFile; graphSHA256: string; schema: { path: string; sha256: string } };
  exports: typeof EXPORTS; bindings: typeof BINDINGS; policy: typeof POLICY;
}
function object(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'Judge manifest object is required');
}
function keys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  object(value); assertSame(Object.keys(value).sort(), [...expected].sort(), 'Judge manifest fields are closed');
}
function sha(value: unknown): asserts value is string { assert.ok(typeof value === 'string' && SHA.test(value), 'Judge SHA256 is invalid'); }
function judgeIdentity(value: unknown): asserts value is ReleaseIdentity {
  keys(value, ['sourceCommit', 'runId', 'runAttempt']);
  const { sourceCommit, runId, runAttempt } = value;
  assert.ok(typeof sourceCommit === 'string' && typeof runId === 'string' && typeof runAttempt === 'string', 'Judge identity fields must be strings');
  validateIdentity({ sourceCommit, runId, runAttempt });
  if (runId === 'local') assert.ok(runAttempt === '1', 'Local judge attempt must be one');
}
function file(value: unknown, path?: string): asserts value is ArtifactFile {
  keys(value, ['path', 'size', 'sha256']);
  assert.ok(typeof value.path === 'string', 'Judge file path is required'); safeRelativePath(value.path);
  assert.ok(typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0, 'Judge file size is invalid'); sha(value.sha256);
  if (path !== undefined) assert.ok(value.path === path, 'Judge file path differs from fixed inventory');
}
export function validateJudgeExpectation(expected: JudgeExpectation): void {
  keys(expected, ['identity', 'upstream', 'archivePath', 'mode']);
  keys(expected.upstream, ['identity', 'artifactId', 'archiveSHA256', 'envelopeSHA']);
  assert.ok(expected.mode === 'local' || expected.mode === 'ci', 'Explicit judge trust mode is required');
  for (const identity of [expected.identity, expected.upstream.identity]) {
    judgeIdentity(identity);
    if (identity.runId === 'local') assert.ok(expected.mode === 'local' && identity.runAttempt === '1', 'Local judge identity requires attempt one and local mode');
    if (expected.mode === 'ci') assert.ok(/^[1-9][0-9]*$/.test(identity.runId), 'CI requires positive remote run IDs');
  }
  assert.ok(expected.identity.sourceCommit === expected.upstream.identity.sourceCommit, 'Judge and upstream source commits differ');
  assert.ok(typeof expected.upstream.artifactId === 'string' && (/^[1-9][0-9]*$/.test(expected.upstream.artifactId) || (expected.mode === 'local' && expected.upstream.artifactId === 'local')), 'Judge upstream artifact ID is invalid for trust mode');
  sha(expected.upstream.archiveSHA256); sha(expected.upstream.envelopeSHA);
  assert.ok(typeof expected.archivePath === 'string' && expected.archivePath.length > 0, 'Actual raw archive path is required');
}
export function validateJudgeManifest(value: unknown): asserts value is JudgeManifest {
  keys(value, ['version', 'identity', 'upstream', 'worker', 'configs', 'assets', 'assetsSHA256', 'wasm', 'sources', 'sdk', 'exports', 'bindings', 'policy']);
  assert.ok(value.version === 'judge-artifact-v1', 'Judge manifest version is invalid');
  judgeIdentity(value.identity);
  keys(value.upstream, ['identity', 'artifactId', 'archiveSHA256', 'envelopeSHA']);
  judgeIdentity(value.upstream.identity);
  assert.ok(value.identity.sourceCommit === value.upstream.identity.sourceCommit, 'Judge source identities differ');
  assert.ok(typeof value.upstream.artifactId === 'string' && /^(local|[1-9][0-9]*)$/.test(value.upstream.artifactId), 'Judge upstream artifact ID is invalid');
  sha(value.upstream.archiveSHA256); sha(value.upstream.envelopeSHA);
  file(value.worker, PATHS.worker); keys(value.configs, ['source', 'hosted', 'disabled']);
  for (const name of ['source', 'hosted', 'disabled'] as const) file(value.configs[name], PATHS[name]);
  assert.ok(Array.isArray(value.assets) && value.assets.length > 0, 'Complete judge assets are required');
  let prior = '';
  for (const entry of value.assets) { file(entry); assert.ok(entry.path > prior, 'Judge assets must be sorted and unique'); prior = entry.path; }
  sha(value.assetsSHA256); assert.ok(digest(jsonBytes(value.assets)) === value.assetsSHA256, 'Judge asset inventory digest differs');
  keys(value.wasm, ['source', 'assetPath']); file(value.wasm.source, PATHS.wasm);
  assert.ok(typeof value.wasm.assetPath === 'string', 'Judge WASM asset path is required'); safeRelativePath(value.wasm.assetPath);
  const wasm = value.assets.filter(entry => entry.path.endsWith('.wasm'));
  assert.ok(wasm.length === 1 && wasm[0]!.path === value.wasm.assetPath && wasm[0]!.sha256 === value.wasm.source.sha256 && wasm[0]!.size === value.wasm.source.size, 'Judge WASM inventory differs');
  keys(value.sources, ['digests', 'sha256']); object(value.sources.digests);
  const sourceDigests = value.sources.digests;
  const sourcePaths = Object.keys(sourceDigests);
  assertSame(sourcePaths, [...sourcePaths].sort(), 'Judge source digest keys must be sorted');
  for (const [path, hash] of Object.entries(value.sources.digests)) { safeRelativePath(path); sha(hash); }
  assert.ok(JUDGE_SOURCE_PATHS.every(path => path in sourceDigests), 'Judge fixed source inventory is incomplete');
  sha(value.sources.sha256); assert.ok(digest(jsonBytes(value.sources.digests)) === value.sources.sha256, 'Judge source inventory digest differs');
  keys(value.sdk, ['toolchain', 'healthyLock', 'deployPackage', 'deployLock', 'runtimeTypes', 'judgeTypes', 'graphSHA256', 'schema']);
  assertSame(value.sdk.toolchain, TOOLCHAIN, 'Judge SDK toolchain differs');
  for (const name of ['healthyLock', 'deployPackage', 'deployLock', 'runtimeTypes', 'judgeTypes'] as const) file(value.sdk[name], PATHS[name]);
  sha(value.sdk.graphSHA256); keys(value.sdk.schema, ['path', 'sha256']);
  assert.ok(value.sdk.schema.path === 'wrangler/config-schema.json', 'Judge schema path must resolve inside the pinned SDK'); sha(value.sdk.schema.sha256);
  assertSame(value.exports, EXPORTS, 'Judge native exports declaration differs');
  assertSame(value.bindings, BINDINGS, 'Judge binding declarations differ');
  assertSame(value.policy, POLICY, 'Judge release policy differs');
}
async function upstream(projectRoot: string, inputDir: string, expected: JudgeExpectation): Promise<CheckedInputs> {
  validateJudgeExpectation(expected); assertWorkerTools();
  assert.ok(digest(await readRegularFile(expected.archivePath)) === expected.upstream.archiveSHA256, 'Actual raw upstream archive differs from authenticated SHA256');
  return verifyArtifactInputs(projectRoot, inputDir, { identity: expected.upstream.identity, envelopeSHA: expected.upstream.envelopeSHA });
}
/** Real workerd module loading, default fetch and SQLite RPC; no string-search export proof. */
export async function proveJudgeNativeExports(projectRoot = root): Promise<void> {
  const fixture = await judgeRuntimeFixture({ projectRoot, variables: { JUDGE_CODE: randomBytes(32).toString('base64url') } });
  try {
    const response = await fixture.runtime.dispatchFetch('https://judge.local/', { redirect: 'manual' });
    assert.ok(response.status === 303 && response.headers.get('location') === '/judge/login', 'Actual judge default fetch does not gate root');
    if (response.body) await response.body.cancel();
    const status = await fixture.runtime.dispatchFetch('https://judge.local/api/judge/session');
    assert.ok(status.status === 200, 'Actual JudgeGate status RPC is unavailable');
    const session: unknown = await status.json();
    assertSame(session, { version: 'judge-session-v1', state: 'anonymous', expires_at_ms: null, quota: null }, 'Actual JudgeGate RPC export differs');
    const storage = await fixture.storage();
    // Only the approved additive narration claim table joins the unchanged budget tables;
    // the exact pinned system metadata names cannot hide any other application table.
    const tables = await storage.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV', '_cf_EXTERNALS', '_cf_METADATA', '_cf_ALARM', '__miniflare_do_name') ORDER BY name");
    assertSame(tables.map(row => row.name), ['daily', 'obituary_claims', 'sessions'], 'Actual JudgeGate SQLite application tables differ');
    const claims = await storage.exec<{ name: string; pk: number }>('PRAGMA table_info(obituary_claims)');
    assert.ok(claims.length === 2 && claims.some(row => row.name === 'token_sha256' && row.pk === 1)
      && claims.some(row => row.name === 'operation_key' && row.pk === 2), 'Narration claims must use the session/operation composite primary key');
    assert.ok(fixture.calls.length === 0, 'Native export proof must dispatch no AI');
  } finally { await fixture.dispose(); }
}
async function collect(projectRoot: string, inputDir: string, expected: JudgeExpectation): Promise<JudgeManifest> {
  const inputs = await upstream(projectRoot, inputDir, expected);
  const current = await checkedSource(projectRoot, expected.identity, JUDGE_SOURCE_PATHS);
  const digests = Object.fromEntries(Object.entries({ ...inputs.sourceDigests, ...current.sources }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  await currentStaticDeployment(projectRoot);
  for (const [name, variant] of [['source', 'source'], ['hosted', 'enabled'], ['disabled', 'disabled']] as const) {
    await readRegularFile(join(projectRoot, PATHS[name]));
    try {
      const { raw, config } = readWranglerConfig(join(projectRoot, PATHS[name]));
      if (variant === 'source') validateJudgeSourceConfig(raw); else validateJudgeHostedConfig(raw, variant);
      assert.ok(config.main === join(projectRoot, variant === 'source' ? 'worker-api/src/judge.ts' : PATHS.worker), 'Judge normalized main differs');
      assert.ok(resolve(dirname(join(projectRoot, PATHS[name])), config.assets?.directory ?? '') === join(projectRoot, 'web/dist'), 'Judge normalized assets differ');
    } catch { throw new Error('Judge config violates the closed checked profile (contents redacted)'); }
  }
  await readRegularFile(join(projectRoot, PATHS.worker));
  await readRegularFile(join(projectRoot, 'target/judge-worker/build.json'));
  const bundle = await checkedWorkerBundle(projectRoot, 'judge');
  assertPrivateContent([{ path: PATHS.worker, bytes: Buffer.from(bundle) }]);
  const healthy = await readRegularFile(join(projectRoot, PATHS.healthyLock));
  const pkg = await readRegularFile(join(projectRoot, PATHS.deployPackage));
  validateSdkLock((await readRegularFile(join(projectRoot, PATHS.deployLock))).toString('utf8'), healthy.toString('utf8'), pkg.toString('utf8'));
  const assets = await readClosedTree(join(projectRoot, 'web/dist'));
  const wasmBytes = await readRegularFile(join(projectRoot, PATHS.wasm));
  await validateAssets(projectRoot, assets, digest(wasmBytes), expected.identity.sourceCommit);
  assertSame(manifest(assets), inputs.assets, 'Judge assets must be the exact successful upstream gate bytes');
  assert.ok(digest(wasmBytes) === inputs.wasm.sha256, 'Judge WASM differs from upstream gate bytes');
  assert.ok(current.schemaSHA256 === inputs.schemaSHA256, 'Judge schema differs from upstream SDK schema');
  await proveJudgeNativeExports(projectRoot);
  async function entry(path: string): Promise<ArtifactFile> { const bytes = await readRegularFile(join(projectRoot, path)); return { path, size: bytes.length, sha256: digest(bytes) }; }
  const result: JudgeManifest = { version: 'judge-artifact-v1', identity: expected.identity, upstream: expected.upstream,
    worker: await entry(PATHS.worker), configs: { source: await entry(PATHS.source), hosted: await entry(PATHS.hosted), disabled: await entry(PATHS.disabled) },
    assets: manifest(assets), assetsSHA256: digest(jsonBytes(manifest(assets))),
    wasm: { source: await entry(PATHS.wasm), assetPath: assets.find(asset => asset.path.endsWith('.wasm'))!.path },
    sources: { digests, sha256: digest(jsonBytes(digests)) },
    sdk: { toolchain: TOOLCHAIN, healthyLock: await entry(PATHS.healthyLock), deployPackage: await entry(PATHS.deployPackage), deployLock: await entry(PATHS.deployLock),
      runtimeTypes: await entry(PATHS.runtimeTypes), judgeTypes: await entry(PATHS.judgeTypes), graphSHA256: digest(jsonBytes(selectSdkLock(healthy.toString('utf8'), pkg.toString('utf8')))),
      schema: { path: 'wrangler/config-schema.json', sha256: digest(await readRegularFile(join(dirname(requireTools.resolve('wrangler/package.json')), 'config-schema.json'))) } },
    exports: EXPORTS, bindings: BINDINGS, policy: POLICY };
  validateJudgeManifest(result); return result;
}
export async function prepareJudgeManifest(projectRoot: string, inputDir: string, expected: JudgeExpectation): Promise<string> {
  const value = await collect(projectRoot, inputDir, expected);
  const bytes = jsonBytes(value);
  await writeFile(join(projectRoot, JUDGE_MANIFEST_PATH), bytes, { flag: 'wx' });
  return digest(bytes);
}
export async function checkJudgeManifest(projectRoot: string, inputDir: string, expected: JudgeExpectation, manifestSHA: string): Promise<JudgeManifest> {
  sha(manifestSHA);
  const bytes = await readRegularFile(join(projectRoot, JUDGE_MANIFEST_PATH));
  assert.ok(digest(bytes) === manifestSHA, 'Judge manifest differs from independently recorded SHA256');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Judge manifest JSON is invalid (contents redacted)'); }
  validateJudgeManifest(value); validateJudgeExpectation(expected);
  assertSame(value.identity, expected.identity, 'Judge manifest identity differs from trusted context');
  assertSame(value.upstream, expected.upstream, 'Judge upstream identity/archive/envelope differs from trusted context');
  assertSame(value, await collect(projectRoot, inputDir, expected), 'Judge manifest differs from current verified source, outputs or SDK');
  return value;
}
export async function restoreJudgeUpstream(projectRoot: string, inputDir: string, expected: JudgeExpectation): Promise<void> {
  const inputs = await upstream(projectRoot, inputDir, expected);
  await mkdir(join(projectRoot, 'web/dist'), { recursive: true });
  const assets = await readClosedTree(join(inputDir, 'tree/dist'));
  await copyBytes(join(projectRoot, 'web/dist'), assets);
  await mkdir(join(projectRoot, 'target/wasm-pkg'), { recursive: true });
  const wasm = assets.find(asset => asset.path.endsWith('.wasm'))!;
  assert.ok(digest(wasm.bytes) === inputs.wasm.sha256, 'Restored upstream WASM differs');
  await writeFile(join(projectRoot, PATHS.wasm), wasm.bytes, { flag: 'wx' });
  await mkdir(join(projectRoot, 'target/decision-worker'), { recursive: true });
  await writeFile(join(projectRoot, 'target/decision-worker/worker.js'), await readRegularFile(join(inputDir, 'tree/worker.js')), { flag: 'wx' });
  await writeFile(join(projectRoot, 'target/decision-worker/build.json'), jsonBytes(inputs.workerStamp), { flag: 'wx' });
}
function releasePaths(value: JudgeManifest): string[] {
  return [...new Set([JUDGE_MANIFEST_PATH, 'target/judge-worker/build.json', ...Object.values(PATHS), ...value.assets.map(asset => `web/dist/${asset.path}`)])].sort();
}
export async function packJudgeRelease(projectRoot: string, inputDir: string, expected: JudgeExpectation, manifestSHA: string): Promise<void> {
  const value = await checkJudgeManifest(projectRoot, inputDir, expected, manifestSHA);
  const files: ArtifactBytes[] = [];
  for (const path of releasePaths(value)) files.push({ path, bytes: await readRegularFile(join(projectRoot, path)) });
  for (const file of await readClosedTree(inputDir)) files.push({ path: `upstream/${file.path}`, bytes: file.bytes });
  files.push({ path: 'upstream.zip', bytes: await readRegularFile(expected.archivePath) });
  const destination = join(projectRoot, 'target/judge-release');
  await freshDirectory(destination); await copyBytes(destination, files);
}
/** Restore generated outputs only after an independently bound manifest and closed packet inventory. */
export async function restoreJudgeRelease(projectRoot: string, packet: string, expected: JudgeExpectation, manifestSHA: string): Promise<void> {
  sha(manifestSHA); validateJudgeExpectation(expected);
  const files = await readClosedTree(packet);
  const bytes = files.find(file => file.path === JUDGE_MANIFEST_PATH)?.bytes;
  assert.ok(bytes && digest(bytes) === manifestSHA, 'Downloaded judge manifest differs from independent output');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Downloaded judge manifest JSON is invalid (contents redacted)'); }
  validateJudgeManifest(value);
  assertSame(value.identity, expected.identity, 'Downloaded judge identity differs'); assertSame(value.upstream, expected.upstream, 'Downloaded upstream context differs');
  const upstreamFiles = files.filter(file => file.path.startsWith('upstream/')).map(file => file.path);
  assertSame(files.map(file => file.path).sort(), [...releasePaths(value), ...upstreamFiles, 'upstream.zip'].sort(), 'Judge release packet has extra or missing paths');
  const checked = [value.worker, ...Object.values(value.configs), value.wasm.source, value.sdk.healthyLock, value.sdk.deployPackage, value.sdk.deployLock, value.sdk.runtimeTypes, value.sdk.judgeTypes,
    ...value.assets.map(file => ({ ...file, path: `web/dist/${file.path}` }))];
  for (const entry of checked) {
    const file = files.find(file => file.path === entry.path)!;
    assert.ok(file.bytes.length === entry.size && digest(file.bytes) === entry.sha256, 'Downloaded checked judge bytes differ');
    if (!entry.path.startsWith('target/') && !entry.path.startsWith('web/dist/')) assert.ok(file.bytes.equals(await readRegularFile(join(projectRoot, entry.path))), 'Downloaded source/config/SDK differs from exact source checkout');
  }
  await copyBytes(projectRoot, files.filter(file => file.path.startsWith('target/') || file.path.startsWith('web/dist/')));
}
export function judgeCliContext(args: readonly string[], projectRoot = root) {
  const flags = new Map<string, string>();
  const allowed = ['--mode', '--input', '--archive', '--archive-sha', '--artifact-id', '--envelope-sha', '--source-commit', '--upstream-run-id', '--upstream-run-attempt', '--run-id', '--run-attempt', '--manifest-sha', '--packet'];
  const command = args[0]; assert.ok(['prepare', 'check', 'restore-upstream', 'pack', 'restore-judge'].includes(command ?? ''), 'Expected explicit judge command');
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]!; assert.ok(allowed.includes(flag) && !flags.has(flag), 'Unexpected or duplicate judge argument');
    const value = args[++index]; assert.ok(value !== undefined && !value.startsWith('--'), 'Judge argument is missing'); flags.set(flag, value);
  }
  function required(flag: string): string { const value = flags.get(flag); assert.ok(value !== undefined, 'Explicit external judge trust input is missing'); return value; }
  const expected: JudgeExpectation = { mode: required('--mode') as JudgeExpectation['mode'], archivePath: resolve(projectRoot, required('--archive')),
    identity: { sourceCommit: required('--source-commit'), runId: required('--run-id'), runAttempt: required('--run-attempt') },
    upstream: { identity: { sourceCommit: required('--source-commit'), runId: required('--upstream-run-id'), runAttempt: required('--upstream-run-attempt') },
      artifactId: required('--artifact-id'), archiveSHA256: required('--archive-sha'), envelopeSHA: required('--envelope-sha') } };
  validateJudgeExpectation(expected);
  const manifestSHA = command === 'check' || command === 'pack' || command === 'restore-judge' ? required('--manifest-sha') : undefined;
  if (manifestSHA !== undefined) sha(manifestSHA); else assert.ok(!flags.has('--manifest-sha'), 'Manifest emission cannot accept a self-derived expected digest');
  const packet = command === 'restore-judge' ? resolve(projectRoot, required('--packet')) : undefined;
  if (packet === undefined) assert.ok(!flags.has('--packet'), 'Packet is only accepted for restore-judge');
  return { command, expected, inputDir: resolve(projectRoot, required('--input')), manifestSHA, packet };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const context = judgeCliContext(process.argv.slice(2));
    switch (context.command) {
      case 'prepare': console.log(JSON.stringify({ manifestSHA: await prepareJudgeManifest(root, context.inputDir, context.expected) })); break;
      case 'restore-upstream': await restoreJudgeUpstream(root, context.inputDir, context.expected); break;
      case 'restore-judge': await restoreJudgeRelease(root, context.packet!, context.expected, context.manifestSHA!); break;
      case 'pack': await packJudgeRelease(root, context.inputDir, context.expected, context.manifestSHA!); break;
      case 'check': await checkJudgeManifest(root, context.inputDir, context.expected, context.manifestSHA!); console.log(JSON.stringify({ checked: true, manifestSHA: context.manifestSHA })); break;
    }
  } catch (error) { console.error(error instanceof Error ? error.message : 'Judge artifact check failed (contents redacted)'); process.exitCode = 1; }
}
