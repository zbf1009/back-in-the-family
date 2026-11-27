import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type * as WranglerTools from '../web/node_modules/wrangler';
import { PROJECT_REQUEST_BYTE_CAP } from '../web/src/shared/decision.ts';
import { assetInventoryOffenders, cardResultsMarkerOffenders, classifyBundle, sizeOffenders, tokenReferenceOffenders } from '../web/scripts/check-deploy.ts';
import { checkedWorkerBundle, digest, sourceDigests } from '../worker-api/scripts/bundle.ts';
import { root, validateSourceConfig } from '../worker-api/scripts/profile.ts';
import { requireTools } from '../worker-api/scripts/tools.ts';
import { checkArtifact } from './check-artifact.ts';
import { LICENSE_CATALOG, LICENSE_SOURCE_PATHS, losslessUtf8, validateLicenseClosure, validateLicenseSourceVersions } from './artifact-licenses.ts';
import type { LicenseClosure, LicenseEntry } from './artifact-licenses.ts';

export interface ReleaseIdentity { sourceCommit: string; runId: string; runAttempt: string }
export interface ArtifactExpectation { identity: ReleaseIdentity; envelopeSHA: string }
export interface ArtifactFile { path: string; size: number; sha256: string }
export interface CheckedInputs {
  version: 1;
  identity: ReleaseIdentity;
  sourceDigests: Record<string, string>;
  readonly licenseClosure: LicenseClosure;
  workerStamp: { version: 1; bundle: string; sources: Record<string, string> };
  assets: ArtifactFile[];
  wasm: { path: string; sha256: string };
  metadata: Record<string, string>;
  schemaSHA256: string;
  toolchain: { node: 'v26.7.0'; pnpm: '10.33.1'; wrangler: '4.157.0' };
}
export interface ArtifactBytes { path: string; bytes: Buffer }
const exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/;
export const SOURCE_INPUT_PATHS = ['Cargo.toml', 'Cargo.lock', 'crates/sim-core/Cargo.toml', 'crates/sim-wasm/Cargo.toml',
  'rust-toolchain.toml', 'mise.toml', '.cargo/config.toml', 'web/package.json', 'web/pnpm-lock.yaml',
  'web/vite.config.ts', 'web/tsconfig.app.json', 'web/tsconfig.worker.json', 'web/tsconfig.node.json', 'web/index.html',
  'web/wrangler.jsonc', 'worker-api/package.json', 'worker-api/wrangler.jsonc', 'worker-api/tsconfig.json', 'worker-api/runtime-configuration.d.ts',
  'scripts/wasm-build.sh', 'scripts/web-build.sh', 'scripts/worker-build.sh', 'scripts/gates.sh',
  'scripts/check-decision-contract.ts', 'scripts/tests/decision-contract.test.ts', 'scripts/artifact-inputs.ts',
  'scripts/artifact-licenses.ts', 'scripts/check-artifact.ts', 'scripts/artifact-sdk-lock.ts',
  'scripts/check-artifact-sdk.mjs', 'scripts/check-artifact-sdk-native.mjs', 'scripts/prepare-artifact-sdk-cache.mjs',
  'scripts/prepare-artifact-metadata.sh', 'scripts/stage-artifact.ts', 'LICENSE'];
export const SOURCE_INPUT_DIRECTORIES = ['web/src', 'web/public', 'web/assets', 'crates/sim-core/src', 'crates/sim-wasm/src', 'worker-api/src'];
export const METADATA_INPUT_PATHS = { 'package.json': 'worker-api/artifact-deploy/package.json',
  'pnpm-lock.yaml': 'worker-api/artifact-deploy/pnpm-lock.yaml', NOTICE: 'worker-api/artifact-deploy/NOTICE', LICENSE: 'LICENSE' };
const media = ['.png', '.gif', '.webp', '.jpg', '.svg', '.ttf', '.otf', '.woff', '.woff2', '.mp3', '.ogg', '.wav'];

export function assertSame(actual: unknown, expected: unknown, message: string): void {
  // Do not let assertion formatting echo untrusted file contents or credentials.
  assert.ok(JSON.stringify(actual) === JSON.stringify(expected), message);
}
export function validateIdentity(identity: ReleaseIdentity): void {
  assert.ok(identity !== null && typeof identity === 'object', 'Release identity must be an object');
  assertSame(Object.keys(identity).sort(), ['runAttempt', 'runId', 'sourceCommit'], 'Release identity fields are closed');
  assert.ok(/^[a-f0-9]{40}$/.test(identity.sourceCommit), 'Release source must be a full Git SHA');
  assert.ok(/^(local|[1-9][0-9]*)$/.test(identity.runId), 'Release run ID is invalid');
  assert.ok(/^[1-9][0-9]*$/.test(identity.runAttempt), 'Release run attempt is invalid');
}
export async function currentSourceCommit(projectRoot = root): Promise<string> {
  const { stdout } = await exec('git', ['-C', projectRoot, 'rev-parse', '--verify', 'HEAD']);
  const sha = stdout.trim();
  assert.ok(/^[a-f0-9]{40}$/.test(sha), 'Current source HEAD must be a full Git SHA');
  return sha;
}
export async function localIdentity(projectRoot = root): Promise<ReleaseIdentity> {
  return { sourceCommit: await currentSourceCommit(projectRoot), runId: 'local', runAttempt: '1' };
}
export function safeRelativePath(path: string): void {
  assert.ok(typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every(part => /^[A-Za-z0-9_@+.,-]+$/.test(part) && part !== '.' && part !== '..'), 'Artifact path is unsafe');
}
async function directoryIsRegular(path: string): Promise<void> {
  const absolute = resolve(path);
  assert.ok((await lstat(absolute)).isDirectory(), 'Artifact directory must be a real directory');
  assert.ok(await realpath(absolute) === absolute, 'Artifact directory ancestors must not be symlinks');
}
export async function readRegularFile(path: string): Promise<Buffer> {
  assert.ok((await lstat(path)).isFile(), 'Checked input must be a regular non-symlink file');
  assert.ok(await realpath(path) === resolve(path), 'Checked input ancestors must not be symlinks');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assert.ok((await file.stat()).isFile(), 'Checked input changed into a nonregular file');
    return await file.readFile();
  } finally { await file.close(); }
}
/** Closed, deterministic walk; unlike walkDir, it never follows symlinks. */
export async function readClosedTree(directory: string): Promise<ArtifactBytes[]> {
  await directoryIsRegular(directory);
  const files: ArtifactBytes[] = [];
  async function visit(relative: string): Promise<void> {
    for (const name of (await readdir(join(directory, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      safeRelativePath(path);
      const entry = await lstat(join(directory, path));
      assert.ok(!entry.isSymbolicLink(), 'Artifact symlink is forbidden');
      if (entry.isDirectory()) {
        assert.ok((await readdir(join(directory, path))).length > 0, 'Unexpected empty artifact directory');
        await visit(path);
      } else {
        assert.ok(entry.isFile(), 'Nonregular artifact entry is forbidden');
        files.push({ path, bytes: await readRegularFile(join(directory, path)) });
      }
    }
  }
  await visit('');
  return files;
}
export function manifest(files: readonly ArtifactBytes[]): ArtifactFile[] {
  return files.map(file => ({ path: file.path, size: file.bytes.byteLength, sha256: digest(file.bytes) }));
}
export function assertPrivateContent(files: readonly ArtifactBytes[]): void {
  assert.ok(tokenReferenceOffenders(files).length === 0 && cardResultsMarkerOffenders(files).length === 0,
    'Artifact contains forbidden credential or probe markers (contents redacted)');
  for (const file of files) {
    const text = file.bytes.toString('utf8');
    const explicit = /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|CF_API_(?:TOKEN|KEY)|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:eval|probe)\/(?:cards|results)|(?:^|[\s"'])\.env(?:[\s"']|$)/i;
    const assignment = /(?:["']?\b(?:[A-Za-z_][\w-]*[_-])?(?:secret|password|passwd|api[_-]?key|api[_-]?token|access[_-]?token|auth[_-]?token|credential|account[_-]?id|token)["']?)\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi;
    assert.ok(!explicit.test(text), 'Artifact contains forbidden private markers (contents redacted)');
    for (const match of text.matchAll(assignment)) {
      assert.ok(!/[A-Za-z0-9]/.test(match[1]!), 'Artifact contains a secret-looking assignment (contents redacted)');
    }
    assert.ok(!/\b(?:sk-(?:live-|test-)?[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,})\b/.test(text),
      'Artifact contains a secret-looking credential (contents redacted)');
  }
}
export function readWranglerConfig(path: string) {
  assert.ok(requireTools('wrangler/package.json').version === '4.157.0', 'Use the existing pinned Wrangler installation');
  const wrangler = requireTools('wrangler') as typeof WranglerTools;
  const args = { config: path };
  const options = { useRedirectIfAvailable: false, hideWarnings: true };
  // This is Wrangler's normalizer/validator plus our closed semantic assertions,
  // not a claim to execute an independent general-purpose JSON Schema engine.
  try {
    const loaded = wrangler.experimental_readRawConfig(args, options);
    assert.ok(loaded.configPath === path && !loaded.redirected, 'Wrangler must read the exact config without redirect');
    return { raw: loaded.rawConfig, config: wrangler.unstable_readConfig(args, options) };
  } catch { throw new Error('Pinned Wrangler config validation failed (contents redacted)'); }
}
export function artifactConfig(): Record<string, unknown> {
  return { name: 'back-in-the-family-decision', main: './worker.js', no_bundle: true,
    compatibility_date: '2026-11-10', send_metrics: false,
    assets: { directory: './dist', binding: 'ASSETS', run_worker_first: ['/api', '/api/*'], not_found_handling: 'single-page-application' },
    ai: { binding: 'AI', remote: false },
    vars: { INFERENCE_ENABLED: 'false', MAX_REQUEST_BYTES: String(PROJECT_REQUEST_BYTE_CAP) } };
}
export function jsonBytes(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
export function publicProvenance(inputs: CheckedInputs) {
  return { version: 1, identity: inputs.identity, workerSHA256: inputs.workerStamp.bundle,
    assetsSHA256: digest(jsonBytes(inputs.assets)), wasmSHA256: inputs.wasm.sha256,
    configSHA256: inputs.metadata['wrangler.jsonc'], metadataSHA256: digest(jsonBytes(inputs.metadata)),
    schemaSHA256: inputs.schemaSHA256, toolchain: inputs.toolchain };
}
export async function validateAssets(projectRoot: string, files: readonly ArtifactBytes[], wasmSHA: string, sourceCommit: string): Promise<void> {
  const entries = files.map(file => ({ path: file.path, size: file.bytes.byteLength }));
  assert.ok(sizeOffenders(entries).length === 0, 'Asset exceeds existing size limit');
  assert.ok(files.some(file => file.path === 'index.html' && file.bytes.byteLength > 0), 'SPA index is required');
  for (const file of files) {
    assert.ok(file.path === 'index.html' || file.path === 'credits.html' ||
      (file.path.startsWith('assets/') && ['.js', '.css', '.wasm', ...media].includes(extname(file.path))), 'Unexpected public asset type or source path');
    if (file.path === 'credits.html') {
      // Vite copies this single public HTML page unchanged; no other root HTML is authorized.
      assert.ok(digest(file.bytes) === digest(await readRegularFile(join(projectRoot, 'web/public/credits.html'))),
        'Credits page must match the checked public source');
    }
  }
  const wasm = files.filter(file => file.path.endsWith('.wasm'));
  assert.ok(wasm.length === 1 && digest(wasm[0]!.bytes) === wasmSHA, 'WASM must be the exact checked build module');
  const wasmName = wasm[0]!.path.split('/').pop()!;
  assert.ok(classifyBundle(files.filter(file => file.path.endsWith('.js')).map(file => ({ path: file.path,
    hasWbindgen: file.bytes.includes('__wbindgen'), hasWasmName: file.bytes.includes(wasmName) }))).offenders.length === 0, 'Main-thread/WASM bundle boundary is invalid');
  const inventory: unknown = JSON.parse((await readRegularFile(join(projectRoot, 'web/assets/ASSETS.json'))).toString('utf8'));
  assert.ok(/^[a-f0-9]{40}$/.test(sourceCommit), 'Media attribution requires the checked source commit');
  const { stdout: readme } = await exec('git', ['-C', projectRoot, 'show', `${sourceCommit}:README.md`], { maxBuffer: 1024 * 1024 });
  assert.ok(assetInventoryOffenders(entries, inventory, readme).length === 0, 'Asset media must match the checked licensed inventory and committed attribution facts');
  assertPrivateContent(files);
}
export async function checkedSource(projectRoot: string, identity: ReleaseIdentity, additionalPaths: readonly string[] = []) {
  validateIdentity(identity);
  assert.ok(await currentSourceCommit(projectRoot) === identity.sourceCommit, 'Checked source HEAD differs from release identity');
  assert.ok(process.version === 'v26.7.0', 'Use prepared pinned Node');
  const sourcePath = join(projectRoot, 'worker-api/wrangler.jsonc');
  await readRegularFile(sourcePath);
  try { validateSourceConfig(readWranglerConfig(sourcePath).raw); }
  catch { throw new Error('Source Worker config violates the closed disabled profile (contents redacted)'); }
  assert.ok(PROJECT_REQUEST_BYTE_CAP === 16384, 'The measured project transport policy must be explicit');
  for (const path of additionalPaths) safeRelativePath(path);
  const paths = [...SOURCE_INPUT_PATHS, ...Object.values(METADATA_INPUT_PATHS), ...additionalPaths];
  for (const directory of SOURCE_INPUT_DIRECTORIES) for (const file of await readClosedTree(join(projectRoot, directory))) paths.push(`${directory}/${file.path}`);
  const sources: Record<string, string> = {};
  const blobs: Record<string, string> = {};
  const licenseMetadata: Record<string, string> = {};
  for (const path of [...new Set(paths)].sort()) {
    const bytes = await readRegularFile(join(projectRoot, path));
    if (path === 'Cargo.lock' || path === 'rust-toolchain.toml' || path === 'web/package.json') licenseMetadata[path] = losslessUtf8(bytes);
    sources[path] = digest(bytes);
    blobs[path] = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
  }
  validateLicenseSourceVersions(licenseMetadata['Cargo.lock']!, licenseMetadata['rust-toolchain.toml']!, licenseMetadata['web/package.json']!);
  const tracked = await exec('git', ['-C', projectRoot, 'ls-tree', '-r', '-z', '--full-tree', identity.sourceCommit, '--',
    ...SOURCE_INPUT_PATHS, ...SOURCE_INPUT_DIRECTORIES, ...Object.values(METADATA_INPUT_PATHS), ...additionalPaths], { maxBuffer: 8 * 1024 * 1024 });
  const committed: Record<string, string> = {};
  for (const entry of tracked.stdout.split('\0').filter(Boolean)) {
    const match = /^100(?:644|755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    assert.ok(match, 'Committed source input must be a regular Git blob');
    committed[match[2]!] = match[1]!;
  }
  assertSame(Object.keys(committed).sort(), Object.keys(blobs).sort(), 'Checked source input paths differ from the source commit');
  for (const [path, blob] of Object.entries(blobs)) assert.ok(committed[path] === blob, 'Checked source bytes differ from source commit; commit reviewed inputs before preparing');
  const metadata: Record<string, string> = {};
  for (const [publicPath, path] of Object.entries(METADATA_INPUT_PATHS)) metadata[publicPath] = sources[path]!;
  metadata['wrangler.jsonc'] = digest(jsonBytes(artifactConfig()));
  const schemaSHA256 = digest(await readRegularFile(join(dirname(requireTools.resolve('wrangler/package.json')), 'config-schema.json')));
  return { sources, metadata, schemaSHA256 };
}
async function collectArtifactInputs(projectRoot: string, identity: ReleaseIdentity): Promise<CheckedInputs> {
  const { sources, metadata, schemaSHA256 } = await checkedSource(projectRoot, identity);
  const sourcePins = Object.fromEntries(LICENSE_SOURCE_PATHS.map(path => [path, sources[path]!])) as LicenseClosure['sourcePins'];
  const projectBytes = await readRegularFile(join(projectRoot, 'LICENSE'));
  const entries: LicenseEntry[] = [{ id: 'project', version: 'source', sourcePin: `git:${identity.sourceCommit}:LICENSE`,
    text: losslessUtf8(projectBytes), sha256: digest(projectBytes) }];
  const sveltePackage = await realpath(join(projectRoot, 'web/node_modules/svelte/package.json'));
  assert.ok(sveltePackage.startsWith(`${resolve(projectRoot, 'web/node_modules')}/`), 'Prepared Svelte license source must belong to the producer project');
  const svelte: unknown = JSON.parse(losslessUtf8(await readRegularFile(sveltePackage)));
  assert.ok(svelte !== null && typeof svelte === 'object' && 'version' in svelte && svelte.version === '5.57.3', 'Use the prepared pinned Svelte license source');
  const registry = join(projectRoot, 'target/gate-cache/cargo/registry/src/index.crates.io-1949cf8c6b5b557f');
  const rustc = losslessUtf8(await readRegularFile(join(projectRoot, 'target/gate-cache/rustc.path'))).trim();
  assert.ok(rustc.endsWith('/bin/rustc') && rustc.includes('/1.99.1-'), 'Use the prepared pinned Rust license sources');
  const rustLicenses = join(dirname(dirname(rustc)), 'share/doc/rust/licenses');
  for (const pinned of LICENSE_CATALOG) {
    const directory = pinned.source === 'cargo' ? registry : pinned.source === 'rust' ? rustLicenses :
      pinned.source === 'asset' ? projectRoot : dirname(sveltePackage);
    const bytes = await readRegularFile(join(directory, pinned.path));
    entries.push({ id: pinned.id, version: pinned.version, sourcePin: pinned.sourcePin, text: losslessUtf8(bytes), sha256: digest(bytes) });
  }
  entries.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const licenseClosure: LicenseClosure = { sourcePins, entries };
  validateLicenseClosure(licenseClosure, sources, identity.sourceCommit);
  const workerPath = join(projectRoot, 'target/decision-worker/worker.js');
  await readRegularFile(workerPath);
  await readRegularFile(join(projectRoot, 'target/decision-worker/build.json'));
  const bundle = await checkedWorkerBundle(projectRoot);
  const stamp = { version: 1 as const, bundle: digest(Buffer.from(bundle)), sources: await sourceDigests(projectRoot) };
  const wasmBytes = await readRegularFile(join(projectRoot, 'target/wasm-pkg/sim_wasm_bg.wasm'));
  const assets = await readClosedTree(join(projectRoot, 'web/dist'));
  await validateAssets(projectRoot, assets, digest(wasmBytes), identity.sourceCommit);
  assertPrivateContent([{ path: 'worker.js', bytes: Buffer.from(bundle) }]);
  return { version: 1, identity, sourceDigests: sources, licenseClosure, workerStamp: stamp, assets: manifest(assets),
    wasm: { path: 'target/wasm-pkg/sim_wasm_bg.wasm', sha256: digest(wasmBytes) }, metadata, schemaSHA256,
    toolchain: { node: 'v26.7.0', pnpm: '10.33.1', wrangler: '4.157.0' } };
}
function hashRecord(value: unknown): void {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected digest map');
  for (const [path, sha] of Object.entries(value)) { safeRelativePath(path); assert.ok(typeof sha === 'string' && SHA.test(sha), 'Invalid checked digest'); }
}
export function validateCheckedInputs(value: unknown): asserts value is CheckedInputs {
  assert.ok(value !== null && typeof value === 'object', 'Checked inputs must be an object');
  const inputs = value as CheckedInputs;
  assert.ok('licenseClosure' in inputs, 'License closure is required');
  assertSame(Object.keys(inputs).sort(), ['assets', 'identity', 'licenseClosure', 'metadata', 'schemaSHA256', 'sourceDigests', 'toolchain', 'version', 'wasm', 'workerStamp'], 'Checked envelope fields are closed');
  assert.ok(inputs.version === 1, 'Unsupported checked envelope version');
  validateIdentity(inputs.identity);
  hashRecord(inputs.sourceDigests); hashRecord(inputs.metadata);
  validateLicenseClosure(inputs.licenseClosure, inputs.sourceDigests, inputs.identity.sourceCommit);
  assertSame(Object.keys(inputs.metadata).sort(), ['LICENSE', 'NOTICE', 'package.json', 'pnpm-lock.yaml', 'wrangler.jsonc'], 'Metadata digest fields are closed');
  assert.ok(SHA.test(inputs.schemaSHA256), 'Invalid schema digest');
  assertSame(inputs.toolchain, { node: 'v26.7.0', pnpm: '10.33.1', wrangler: '4.157.0' }, 'Unexpected release toolchain');
  assertSame(Object.keys(inputs.workerStamp).sort(), ['bundle', 'sources', 'version'], 'Worker stamp fields are closed');
  assert.ok(inputs.workerStamp.version === 1 && SHA.test(inputs.workerStamp.bundle), 'Invalid Worker stamp');
  hashRecord(inputs.workerStamp.sources);
  assertSame(Object.keys(inputs.wasm).sort(), ['path', 'sha256'], 'WASM fields are closed');
  assert.ok(inputs.wasm.path === 'target/wasm-pkg/sim_wasm_bg.wasm' && SHA.test(inputs.wasm.sha256), 'Invalid checked WASM reference');
  assert.ok(Array.isArray(inputs.assets) && inputs.assets.length > 0, 'Asset manifest is required');
  let prior = '';
  for (const file of inputs.assets) {
    assertSame(Object.keys(file).sort(), ['path', 'sha256', 'size'], 'Asset manifest fields are closed');
    safeRelativePath(file.path);
    assert.ok(file.path > prior && Number.isSafeInteger(file.size) && file.size >= 0 && SHA.test(file.sha256), 'Asset manifest must be sorted and unique');
    prior = file.path;
  }
}
export async function freshDirectory(path: string): Promise<void> {
  await directoryIsRegular(dirname(resolve(path)));
  await mkdir(path); // Existing output is never reused or recursively removed.
}
export async function copyBytes(directory: string, files: readonly ArtifactBytes[]): Promise<void> {
  for (const file of files) {
    safeRelativePath(file.path);
    await mkdir(dirname(join(directory, file.path)), { recursive: true });
    await writeFile(join(directory, file.path), file.bytes, { flag: 'wx' });
  }
}
export async function prepareArtifact(projectRoot: string, outputDir: string, identity: ReleaseIdentity): Promise<string> {
  const inputs = await collectArtifactInputs(projectRoot, identity);
  await freshDirectory(outputDir);
  const tree = join(outputDir, 'tree');
  await mkdir(tree);
  const files = (await readClosedTree(join(projectRoot, 'web/dist'))).map(file => ({ ...file, path: `dist/${file.path}` }));
  files.push({ path: 'worker.js', bytes: await readRegularFile(join(projectRoot, 'target/decision-worker/worker.js')) },
    { path: 'wrangler.jsonc', bytes: jsonBytes(artifactConfig()) }, { path: 'provenance.json', bytes: jsonBytes(publicProvenance(inputs)) });
  for (const [path, source] of Object.entries(METADATA_INPUT_PATHS)) files.push({ path, bytes: await readRegularFile(join(projectRoot, source)) });
  await copyBytes(tree, files);
  const envelope = jsonBytes(inputs);
  await writeFile(join(outputDir, 'inputs.json'), envelope, { flag: 'wx' });
  const envelopeSHA = digest(envelope);
  await verifyArtifactInputs(projectRoot, outputDir, { identity, envelopeSHA });
  return envelopeSHA;
}
export async function verifyArtifactInputs(projectRoot: string, inputDir: string, expected: ArtifactExpectation): Promise<CheckedInputs> {
  assert.ok(typeof expected.envelopeSHA === 'string' && SHA.test(expected.envelopeSHA), 'Independent envelope SHA is required');
  validateIdentity(expected.identity);
  const files = await readClosedTree(inputDir);
  assert.ok(files.every(file => file.path === 'inputs.json' || file.path.startsWith('tree/')), 'Unexpected private transport path');
  const envelope = files.find(file => file.path === 'inputs.json');
  assert.ok(envelope && digest(envelope.bytes) === expected.envelopeSHA, 'Private envelope differs from independently expected SHA');
  let inputs: unknown;
  try { inputs = JSON.parse(losslessUtf8(envelope.bytes)); }
  catch { throw new Error('Private envelope JSON is invalid (contents redacted)'); }
  assert.ok(inputs !== null && typeof inputs === 'object' && !Array.isArray(inputs) && 'identity' in inputs, 'Checked envelope release identity is required');
  validateIdentity(inputs.identity as ReleaseIdentity);
  assertSame(inputs.identity, expected.identity, 'Checked envelope release identity differs from trusted context');
  validateCheckedInputs(inputs);
  await checkArtifact(projectRoot, join(inputDir, 'tree'), inputs, expected.identity);
  const current = await checkedSource(projectRoot, expected.identity);
  assertSame(inputs.sourceDigests, current.sources, 'Checked source/config/locks/metadata differ from current source');
  assertSame(inputs.metadata, current.metadata, 'Checked metadata differs from current source');
  assert.ok(inputs.schemaSHA256 === current.schemaSHA256, 'Checked Wrangler schema differs from installed pinned schema');
  assertSame(inputs.workerStamp.sources, await sourceDigests(projectRoot), 'Worker stamp source provenance differs from checked source');
  return inputs;
}
export type ArtifactCliContext = { identity: ReleaseIdentity; inputDir: string; outputDir: string } &
  ({ prepare: true; envelopeSHA?: never } | { prepare: false; envelopeSHA: string });
export async function artifactCliContext(args: readonly string[], projectRoot = root): Promise<ArtifactCliContext> {
  const flags = new Map<string, string>();
  let prepare = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === '--prepare') { assert.ok(!prepare, 'Duplicate prepare flag'); prepare = true; continue; }
    assert.ok(['--input', '--output', '--source-commit', '--run-id', '--run-attempt', '--envelope-sha'].includes(flag) && !flags.has(flag), 'Unexpected or duplicate artifact argument');
    const value = args[++index];
    assert.ok(value !== undefined && !value.startsWith('--'), 'Artifact argument value is missing');
    flags.set(flag, value);
  }
  const envelopeSHA = flags.get('--envelope-sha');
  if (prepare) assert.ok(envelopeSHA === undefined, 'Preparation cannot accept a supplied envelope digest');
  else assert.ok(typeof envelopeSHA === 'string' && SHA.test(envelopeSHA), 'Independent envelope SHA is required');
  const hasIdentity = ['--source-commit', '--run-id', '--run-attempt'].some(flag => flags.has(flag));
  assert.ok(!hasIdentity || ['--source-commit', '--run-id', '--run-attempt'].every(flag => flags.has(flag)), 'Trusted release identity must be complete');
  const identity = hasIdentity ? { sourceCommit: flags.get('--source-commit')!, runId: flags.get('--run-id')!, runAttempt: flags.get('--run-attempt')! } : await localIdentity(projectRoot);
  validateIdentity(identity);
  const paths = { identity, inputDir: resolve(projectRoot, flags.get('--input') ?? 'target/artifact-release'),
    outputDir: resolve(projectRoot, flags.get('--output') ?? 'target/artifact-release') };
  return prepare ? { ...paths, prepare: true } : { ...paths, prepare: false, envelopeSHA: envelopeSHA! };
}
