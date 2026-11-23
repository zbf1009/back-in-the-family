import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { constants, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { root } from '../../worker-api/scripts/profile.ts';
import { METADATA_INPUT_PATHS, SOURCE_INPUT_DIRECTORIES, SOURCE_INPUT_PATHS, copyBytes, currentSourceCommit, prepareArtifact, readClosedTree } from '../artifact-inputs.ts';
import type { ArtifactExpectation, CheckedInputs, ReleaseIdentity } from '../artifact-inputs.ts';
import { selectSdkLock } from '../artifact-sdk-lock.ts';

const cliPaths = ['scripts/artifact-inputs.ts', 'scripts/artifact-licenses.ts', 'scripts/check-artifact.ts',
  'scripts/artifact-sdk-lock.ts', 'scripts/check-artifact-sdk.mjs', 'scripts/check-artifact-sdk-native.mjs',
  'scripts/prepare-artifact-sdk-cache.mjs', 'scripts/prepare-artifact-metadata.sh',
  'scripts/stage-artifact.ts', 'scripts/publish-artifact.ts', 'scripts/tests/artifact-consumer.ts',
  'scripts/check-decision-contract.ts', 'scripts/tests/decision-contract.test.ts',
  'worker-api/scripts/profile.ts', 'worker-api/scripts/bundle.ts', 'worker-api/scripts/tools.ts', 'web/scripts/check-deploy.ts'];
const cargoLicenses = ['arrayvec-0.7.8/LICENSE-MIT', 'cfg-if-1.0.5/LICENSE-MIT', 'wasm-bindgen-0.2.130/LICENSE-MIT',
  'wasm-bindgen-shared-0.2.130/LICENSE-MIT', 'serde-1.0.229/LICENSE-MIT', 'memchr-2.8.3/LICENSE-MIT',
  'constant_time_eq-0.4.2/LICENSE-MIT0', 'unicode-ident-1.0.27/LICENSE-UNICODE', 'blake3-1.8.7/LICENSE_A2'];

async function copiedFile(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_FICLONE);
  await chmod(destination, (await lstat(source)).mode & 0o777);
}

/** Copy only the already installed checker graph; never borrow source modules. */
async function checkerSDK(project: string): Promise<void> {
  const original = await realpath(join(root, 'web/node_modules'));
  const sdk = join(project, 'web/node_modules');
  const copied = new Set<string>();
  async function copy(source: string): Promise<void> {
    const path = relative(original, source);
    assert.ok(path !== '..' && !path.startsWith('../') && !path.startsWith('/'), 'Installed SDK link escapes the prepared module root');
    assert.ok(!path.startsWith('.pnpm/svelte@') && !path.startsWith('svelte/'), 'Consumer SDK must not contain Svelte license-source recovery inputs');
    if (copied.has(source)) return;
    copied.add(source);
    const destination = join(sdk, path);
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) {
      const target = await realpath(source);
      await copy(target);
      await mkdir(dirname(destination), { recursive: true });
      await symlink(relative(dirname(destination), join(sdk, relative(original, target))), destination);
    } else if (stat.isDirectory()) {
      await mkdir(destination, { recursive: true });
      for (const name of await readdir(source)) await copy(join(source, name));
    } else {
      assert.ok(stat.isFile(), 'Prepared SDK contains a nonregular input');
      await copiedFile(source, destination);
    }
  }
  await mkdir(sdk, { recursive: true });
  for (const [name, version] of [['wrangler', '4.157.0'], ['typescript', '6.0.3'], ['yaml', '2.8.1']] as const) {
    const installed = join(original, name);
    assert.equal(JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).version, version, `Missing prepared pinned ${name}@${version}; do not install during QA`);
    await copy(installed);
  }
  // pnpm puts a package's dependencies beside it, not inside its own directory.
  // Follow each reached package's sibling links to complete the actual SDK graph.
  async function siblings(): Promise<void> {
    let prior = -1;
    while (prior !== copied.size) {
      prior = copied.size;
      for (const source of [...copied]) {
        const path = relative(original, source);
        if (!path.startsWith('.pnpm/') || !path.includes('/node_modules/')) continue;
        const modules = join(original, path.slice(0, path.indexOf('/node_modules/') + '/node_modules'.length));
        await copy(modules);
      }
    }
  }
  await siblings();
  await assertSDK(sdk);
}

async function assertSDK(sdk: string): Promise<void> {
  async function walk(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = await realpath(path);
      const within = relative(sdk, target);
      assert.ok(within !== '..' && !within.startsWith('../') && !within.startsWith('/'), 'Consumer SDK symlink escapes its owned graph');
    } else if (stat.isDirectory()) {
      for (const name of await readdir(path)) await walk(join(path, name));
    }
  }
  await walk(sdk);
  await assert.rejects(access(join(sdk, 'svelte')), /ENOENT/, 'Consumer must not recover Svelte source licenses');
}

/** Commit actual source copies before preparation; builds/licenses are private. */
export async function fixtureProject(parent: string, additionalPaths: readonly string[] = []): Promise<string> {
  const project = join(parent, 'source');
  await mkdir(project);
  const paths = [...new Set([...SOURCE_INPUT_PATHS, ...Object.values(METADATA_INPUT_PATHS), 'README.md', ...cliPaths, ...additionalPaths])];
  for (const path of paths) await copiedFile(join(root, path), join(project, path));
  for (const directory of SOURCE_INPUT_DIRECTORIES) {
    await mkdir(join(project, directory), { recursive: true });
    await copyBytes(join(project, directory), await readClosedTree(join(root, directory)));
  }
  // JSON is plain safe YAML; bind a complete selection before the source commit.
  const sdkLock = selectSdkLock(await readFile(join(project, 'web/pnpm-lock.yaml'), 'utf8'),
    await readFile(join(project, 'worker-api/artifact-deploy/package.json'), 'utf8'));
  await writeFile(join(project, 'worker-api/artifact-deploy/pnpm-lock.yaml'), `${JSON.stringify(sdkLock, null, 2)}\n`);
  const files = await readClosedTree(project);
  execFileSync('/usr/bin/git', ['init', '--quiet', '--initial-branch=fixture-source', project]);
  const hashes = execFileSync('/usr/bin/git', ['-C', project, 'hash-object', '-w', '--stdin-paths'], {
    input: files.map(file => file.path).join('\n') + '\n', encoding: 'utf8',
  }).trim().split('\n');
  execFileSync('/usr/bin/git', ['-C', project, 'update-index', '--index-info'], {
    input: files.map((file, index) => `100644 ${hashes[index]}\t${file.path}`).join('\n') + '\n',
  });
  const tree = execFileSync('/usr/bin/git', ['-C', project, 'write-tree'], { encoding: 'utf8' }).trim();
  const sha = execFileSync('/usr/bin/git', ['-C', project, 'commit-tree', tree], {
    input: 'Actual checked-input fixture\n', encoding: 'utf8', env: {
      PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Artifact Test', GIT_AUTHOR_EMAIL: 'artifact-test@example.invalid',
      GIT_COMMITTER_NAME: 'Artifact Test', GIT_COMMITTER_EMAIL: 'artifact-test@example.invalid',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    },
  }).trim();
  execFileSync('/usr/bin/git', ['-C', project, 'update-ref', 'refs/heads/fixture-source', sha]);
  for (const path of ['target/decision-worker/worker.js', 'target/decision-worker/build.json', 'target/wasm-pkg/sim_wasm_bg.wasm']) {
    await copiedFile(join(root, path), join(project, path));
  }
  await mkdir(join(project, 'web/dist'), { recursive: true });
  await copyBytes(join(project, 'web/dist'), await readClosedTree(join(root, 'web/dist')));
  const registry = 'target/gate-cache/cargo/registry/src/index.crates.io-1949cf8c6b5b557f';
  for (const path of cargoLicenses) await copiedFile(join(root, registry, path), join(project, registry, path));
  const originalRustc = (await readFile(join(root, 'target/gate-cache/rustc.path'), 'utf8')).trim();
  const rustc = join(project, 'target/prepared-rust/1.99.1-owned/bin/rustc');
  for (const name of ['Unicode-3.0.txt', 'LLVM-exception.txt']) {
    await copiedFile(join(dirname(dirname(originalRustc)), 'share/doc/rust/licenses', name),
      join(dirname(dirname(rustc)), 'share/doc/rust/licenses', name));
  }
  await writeFile(join(project, 'target/gate-cache/rustc.path'), `${rustc}\n`);
  const svelte = await realpath(join(root, 'web/node_modules/svelte'));
  for (const path of ['package.json', 'LICENSE.md']) await copiedFile(join(svelte, path), join(project, 'web/node_modules/svelte', path));
  return project;
}

export interface IndependentArtifact {
  owned: string;
  producer: string;
  project: string;
  transport: string;
  expected: ArtifactExpectation;
  envelopeBytes: Buffer;
  inputs: CheckedInputs;
}

/** Producer's prepare return is recorded once, outside the immutable transport. */
export async function independentArtifact(owned: string, runId = '62001', runAttempt = '1', additionalPaths: readonly string[] = []): Promise<IndependentArtifact> {
  const producer = await fixtureProject(owned, additionalPaths);
  const identity: ReleaseIdentity = { sourceCommit: await currentSourceCommit(producer), runId, runAttempt };
  const transport = join(owned, 'transport');
  const envelopeSHA = await prepareArtifact(producer, transport, identity);
  const envelopeBytes = await readFile(join(transport, 'inputs.json'));
  const project = join(owned, 'consumer');
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', '--no-hardlinks', producer, project]);
  execFileSync('/usr/bin/git', ['-C', project, 'remote', 'remove', 'origin']);
  await checkerSDK(project);
  await mkdir(join(owned, 'bin'));
  await copiedFile(process.execPath, join(owned, 'bin/node'));
  await symlink('/usr/bin/git', join(owned, 'bin/git'));
  for (const path of ['target', 'web/dist', 'web/node_modules/svelte']) await assert.rejects(access(join(project, path)), /ENOENT/);
  assert.equal(await currentSourceCommit(project), identity.sourceCommit);
  return { owned, producer, project, transport, expected: { identity, envelopeSHA }, envelopeBytes, inputs: JSON.parse(envelopeBytes.toString('utf8')) as CheckedInputs };
}

/** Real env-i child, copied Node, copied CLI, private user/net/mount namespaces. */
export function consumerCLI(project: string, args: string[]) {
  assert.ok(args[0]?.startsWith(`${project}/scripts/`), 'Consumer must execute a copied source CLI, never the original module root');
  const owned = dirname(project);
  // Workerd still initializes TLS for its denied internet service. Supply only
  // the already installed public trust bundle, never host /etc or caller env.
  const certificates = readFileSync(realpathSync('/etc/ssl/certs/ca-certificates.crt'));
  assert.ok(certificates.includes('-----BEGIN CERTIFICATE-----') && !certificates.includes('PRIVATE KEY'), 'Installed public CA bundle is unavailable');
  const home = mkdtempSync(join(owned, 'consumer-home-'));
  mkdirSync(join(home, 'tmp'));
  const certificatePath = join(home, 'ca-certificates.crt');
  const parentNet = readlinkSync('/proc/self/ns/net');
  const parentUser = readlinkSync('/proc/self/ns/user');
  const node = join(owned, 'bin/node');
  const path = join(owned, 'bin');
  const preflight = `const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
    assert.deepEqual(Object.keys(os.networkInterfaces()).sort(),['lo']);
    assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.argv[1]);
    assert.notEqual(fs.readlinkSync('/proc/self/ns/user'),process.argv[2]);
    assert.equal(process.env.PATH,process.argv[3]);
    for(const key of Object.keys(process.env)) assert.ok(!/^(?:CARGO|RUSTUP|RUSTC|NODE_OPTIONS|NODE_PATH|LD_|CLOUDFLARE_API|CF_API|GITHUB_TOKEN|GH_TOKEN|AWS_|HTTPS?_PROXY|ALL_PROXY)/.test(key),'Forbidden child environment');
    for(const name of ['.git/HEAD','scripts/check-artifact.ts','web/node_modules','target/gate-cache']) assert.equal(fs.existsSync(process.argv[4]+'/'+name),false,'Original repository inputs must be hidden');
    for(const name of ['LICENSE','target','web/node_modules/svelte']) assert.equal(fs.existsSync(process.argv[5]+'/'+name),false,'Producer licenses/builds must be hidden');
    for(const name of ['cargo','rustc','rustup','pnpm']) assert.equal(fs.existsSync(process.env.PATH+'/'+name),false);
    assert.equal(process.version,'v26.7.0');`;
  const certificatePreflight = `const fs=require('node:fs'),assert=require('node:assert/strict');
    assert.equal(process.env.NODE_EXTRA_CA_CERTS,process.env.HOME+'/ca-certificates.crt');
    assert.equal(process.env.SSL_CERT_FILE,process.env.NODE_EXTRA_CA_CERTS);
    assert.ok(fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS).includes('-----BEGIN CERTIFICATE-----'));`;
  try {
    writeFileSync(certificatePath, certificates, { mode: 0o600, flag: 'wx' });
    const result = spawnSync('/usr/bin/env', ['-i', `PATH=${path}`, `HOME=${home}`, `TMPDIR=${join(home, 'tmp')}`,
      `XDG_CONFIG_HOME=${join(home, 'config')}`, `XDG_CACHE_HOME=${join(home, 'cache')}`,
      'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null', 'GIT_TERMINAL_PROMPT=0',
      'WRANGLER_SEND_METRICS=false', 'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false', 'CLOUDFLARE_INCLUDE_PROCESS_ENV=false',
      `NODE_EXTRA_CA_CERTS=${certificatePath}`, `SSL_CERT_FILE=${certificatePath}`,
      '/usr/bin/bwrap', '--die-with-parent', '--unshare-user', '--uid', '0', '--gid', '0', '--unshare-net', '--unshare-pid',
      '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
      '--ro-bind', certificatePath, '/etc/ssl/certs/ca-certificates.crt', '--ro-bind', certificatePath, '/etc/ssl/cert.pem',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', owned, owned, '--tmpfs', join(owned, 'source'), '--chdir', project,
      '/bin/bash', '-euc', '/usr/bin/ip link set lo up; "$1" -e "$2" "$3" "$4" "$5" "$6" "$7"; "$1" -e "$8"; shift 8; exec "$@"',
      'consumer-proof', node, preflight, parentNet, parentUser, path, root, join(owned, 'source'), certificatePreflight, node, ...args],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: {} });
    assert.equal(result.error, undefined, 'Consumer requires already installed bwrap/ip/git and the pinned copied Node SDK');
    assert.equal(result.signal, null, 'Independent consumer must terminate normally');
    return result;
  } finally { rmSync(home, { recursive: true, force: true }); }
}

export async function consumerAPI<T>(project: string, action: string, value: unknown): Promise<T> {
  const result = consumerCLI(project, [join(project, 'scripts/tests/artifact-consumer.ts'), action, JSON.stringify(value)]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as T;
}
