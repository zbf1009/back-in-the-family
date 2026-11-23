import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactCliContext, copyBytes, manifest, readClosedTree, verifyArtifactInputs } from './artifact-inputs.ts';
import { selectSdkLock } from './artifact-sdk-lock.ts';
import { inspectSdkCache } from './prepare-artifact-sdk-cache.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const storeIndex = args.indexOf('--store-dir');
let storeDir = join(root, 'target/gate-cache/pnpm');
if (storeIndex !== -1) {
  assert.equal(args.lastIndexOf('--store-dir'), storeIndex, 'Duplicate SDK store argument');
  assert.ok(args[storeIndex + 1] && !args[storeIndex + 1].startsWith('--'), 'SDK store argument requires an explicit prefilled directory');
  storeDir = resolve(root, args[storeIndex + 1]);
  args.splice(storeIndex, 2);
}
assert.ok(!args.includes('--prepare') && !args.includes('--output'), 'SDK acceptance consumes verified transport, never prepares it');
const context = await artifactCliContext(args, root);
assert.equal(context.prepare, false);
const inputs = await verifyArtifactInputs(root, context.inputDir, { identity: context.identity, envelopeSHA: context.envelopeSHA });
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v26.7.0');
assert.ok(process.report.getReport().header.glibcVersionRuntime, 'SDK acceptance requires Linux x64 glibc');
const node = await realpath((await readFile(join(root, 'target/gate-cache/node.path'), 'utf8')).trim());
const pnpm = await realpath((await readFile(join(root, 'target/gate-cache/pnpm.path'), 'utf8')).trim());
assert.equal(node, await realpath(process.execPath), 'Use the fixed direct prepared Node launcher');
assert.ok(!node.includes('/shims/') && !pnpm.includes('/shims/'), 'SDK acceptance forbids tool bootstrappers');
assert.ok((await lstat('/usr/bin/bwrap')).isFile(), 'SDK acceptance requires system bubblewrap; no weak isolation fallback');
storeDir = await realpath(storeDir);
assert.ok((await lstat(storeDir)).isDirectory(), 'An explicit prefilled pnpm store is required');
const publicFiles = await readClosedTree(join(context.inputDir, 'tree'));
const publicDigests = manifest(publicFiles);
const parentNet = await readlink('/proc/self/ns/net');
const parentMount = await readlink('/proc/self/ns/mnt');
const workspace = await mkdtemp(join(root, 'target/artifact-sdk.'));
let evidence;
try {
  const selected = selectSdkLock(await readFile(join(root, 'web/pnpm-lock.yaml'), 'utf8'), await readFile(join(context.inputDir, 'tree/package.json'), 'utf8'));
  const cacheInventory = await inspectSdkCache(selected.packages, storeDir);
  evidence = { result: 'fail', cacheInventory };
  assert.equal(cacheInventory.missing.length, 0, `Missing complete fixed SDK cache payloads; run separately approved preparation only: ${JSON.stringify(cacheInventory.missing)}`);
  for (const directory of ['public', 'sdk', 'store', 'home', 'config', 'cache', 'tmp', 'logs', 'out', 'proof']) await mkdir(join(workspace, directory));
  await copyBytes(join(workspace, 'public'), publicFiles);
  await copyBytes(join(workspace, 'sdk'), publicFiles.filter(file => ['package.json', 'pnpm-lock.yaml'].includes(file.path)));
  // The existing store is read-only input; all pnpm writes land in this owned copy.
  await cp(storeDir, join(workspace, 'store'), { recursive: true, dereference: false, force: false, errorOnExist: true });
  await writeFile(join(workspace, 'before.json'), `${JSON.stringify(publicDigests)}\n`);
  await cp(join(root, 'scripts/check-artifact-sdk-native.mjs'), join(workspace, 'proof/check-artifact-sdk-native.mjs'));
  const libraryScan = spawnSync('/usr/bin/ldd', [node, pnpm, '/usr/bin/sh'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  assert.ifError(libraryScan.error);
  assert.equal(libraryScan.status, 0, 'Cannot determine the direct tools\' standard OS library dependencies');
  const libraries = new Set(libraryScan.stdout.split('\n').filter(line => !line.endsWith(':')).flatMap(line => line.match(/\/[^\s()]+/g) ?? []));
  const libc = [...libraries].find(path => basename(path) === 'libc.so.6');
  assert.ok(libc, 'glibc standard library path is required');
  libraries.add(join(dirname(libc), 'libresolv.so.2'));
  const namespaceArgs = ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv', '--proc', '/proc', '--dev', '/dev'];
  const directories = new Set(['/usr', '/usr/lib', '/usr/lib64', '/lib', '/lib64', '/tools', '/bin']);
  for (const library of libraries) {
    const actual = await realpath(library);
    assert.ok(actual.startsWith('/usr/lib/') || actual.startsWith('/lib/'), 'Only standard OS libraries may enter the namespace');
    directories.add(dirname(library));
  }
  for (const directory of [...directories].sort((a, b) => a.length - b.length)) namespaceArgs.push('--dir', directory);
  for (const library of libraries) namespaceArgs.push('--ro-bind', await realpath(library), library);
  namespaceArgs.push('--ro-bind', node, '/tools/node', '--ro-bind', pnpm, '/tools/pnpm', '--ro-bind', '/usr/bin/sh', '/bin/sh', '--bind', workspace, '/workspace', '--ro-bind', join(workspace, 'public'), '/workspace/public', '--chdir', '/workspace/sdk');
  const environment = { PATH: '/tools:/bin', HOME: '/workspace/home', TMPDIR: '/workspace/tmp', XDG_CONFIG_HOME: '/workspace/config', XDG_CACHE_HOME: '/workspace/cache', CI: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '/workspace/logs/wrangler.log', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', npm_config_offline: 'true', npm_config_manage_package_manager_versions: 'false', npm_config_package_manager_strict_version: 'true', npm_config_userconfig: '/dev/null', npm_config_globalconfig: '/dev/null', BIF_SDK_PARENT_NET_NS: parentNet, BIF_SDK_PARENT_MOUNT_NS: parentMount };
  for (const [name, value] of Object.entries(environment)) namespaceArgs.push('--setenv', name, value);
  namespaceArgs.push('/tools/node', '/workspace/proof/check-artifact-sdk-native.mjs');
  const result = spawnSync('/usr/bin/bwrap', namespaceArgs, { env: {}, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  const line = result.stdout?.trim().split('\n').at(-1);
  try { evidence = JSON.parse(line); }
  catch { evidence = { result: 'fail', error: 'SDK namespace failed before it could record native evidence', stdout: result.stdout, stderr: result.stderr }; }
  evidence.transport = { identity: context.identity, envelopeSHA: context.envelopeSHA, workerSHA256: inputs.workerStamp.bundle, publicFiles: publicDigests };
  evidence.launch = { isolation: 'bubblewrap --unshare-all with empty mount root', file: '/usr/bin/bwrap', args: namespaceArgs, exit: result.status, signal: result.signal, stderr: result.stderr, sourceStore: storeDir, ownedWorkspace: workspace, originalRepositoryMounted: false, originalSdkMounted: false };
  evidence.cacheInventory = cacheInventory;
  evidence.launch.osLibraries = [...libraries];
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Fresh public SDK proof failed; only separately approved fixed-package cache preparation can remedy missing content.\n${evidence.error ?? ''}\n${result.stderr}`);
  assert.equal(evidence.result, 'pass');
  assert.deepEqual(manifest(await readClosedTree(join(workspace, 'public'))), publicDigests, 'Owned public bytes changed');
  assert.deepEqual(manifest(await readClosedTree(join(context.inputDir, 'tree'))), publicDigests, 'Original public transport bytes changed');
} catch (error) {
  evidence ??= { result: 'fail' };
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  await rm(workspace, { recursive: true, force: true });
  if (evidence) { evidence.workspaceRemoved = true; process.stdout.write(`${JSON.stringify(evidence)}\n`); }
}
