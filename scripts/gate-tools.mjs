import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, 'target/gate-cache');
const inputs = ['mise.toml', 'rust-toolchain.toml', 'Cargo.lock', 'web/package.json', 'web/pnpm-lock.yaml', 'eval/probe/package.json', 'eval/probe/pnpm-lock.yaml', 'worker-api/package.json'];
const hashes = Object.fromEntries(inputs.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
const paths = ['node', 'pnpm', 'cargo', 'rustc', 'rustfmt', 'cargo-clippy', 'clippy-driver', 'wasm-bindgen', 'wasm-bindgen-test-runner'];

export function validatePrepared(manifest, currentHashes) {
  assert.equal(manifest.version, 1, 'Prepare the gate dependency cache first');
  assert.deepEqual(manifest.inputs, currentHashes, 'Gate inputs changed; rerun the separate pinned dependency preparation');
  assert.deepEqual(Object.keys(manifest.tools).sort(), [...paths].sort(), 'Incomplete prepared tool launchers');
  for (const [name, path] of Object.entries(manifest.tools)) {
    assert.equal(typeof path, 'string');
    assert.ok(path.startsWith('/') && !path.includes('/shims/'), 'Offline launchers must be absolute installed binaries, not version-bootstrap shims');
    assert.equal(realpathSync(readFileSync(join(cache, `${name}.path`), 'utf8').trim()), path, `Prepared ${name} launcher changed`);
    accessSync(path, constants.X_OK);
  }
  assert.equal(realpathSync(manifest.tools.node), realpathSync(process.execPath), 'Use the prepared pinned Node binary');
  assert.equal(process.version, 'v26.7.0');
  for (const packageDir of ['web', 'eval/probe']) {
    assert.ok(readFileSync(join(root, packageDir, 'pnpm-lock.yaml')).equals(readFileSync(join(root, packageDir, 'node_modules/.pnpm/lock.yaml'))), `${packageDir} installed lock differs; prepare frozen dependencies outside gates`);
    const pkg = JSON.parse(readFileSync(join(root, packageDir, 'package.json'), 'utf8'));
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.equal(JSON.parse(readFileSync(join(root, packageDir, 'node_modules', name, 'package.json'), 'utf8')).version, version, `${packageDir} installed ${name} differs from the exact pin`);
    }
  }
  const workerRequire = createRequire(realpathSync(join(root, 'web/node_modules/wrangler/package.json')));
  for (const [name, version] of Object.entries({ wrangler: '4.157.0', miniflare: '5.20261103.0-beta', workerd: '1.20261103.1', esbuild: '0.28.2' })) {
    assert.equal(workerRequire(`${name}/package.json`).version, version, `Unprepared ${name} version`);
  }
  for (const name of ['workerd/bin/workerd', 'esbuild/bin/esbuild']) accessSync(workerRequire.resolve(name), constants.X_OK);
  assert.ok(existsSync(join(cache, 'cargo/registry')) && existsSync(join(cache, 'pnpm')), 'Offline dependency stores are missing');
  assert.ok(['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].some(path => existsSync(path)), 'System Chrome is required; no browser download in gates');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifestPath = join(cache, 'prepared.json');
  if (process.argv[2] === 'record') {
    const tools = Object.fromEntries(paths.map(name => [name, realpathSync(readFileSync(join(cache, `${name}.path`), 'utf8').trim())]));
    const manifest = { version: 1, tools, inputs: hashes };
    validatePrepared(manifest, hashes);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  } else {
    assert.equal(process.argv[2], 'check');
    validatePrepared(JSON.parse(readFileSync(manifestPath, 'utf8')), hashes);
    assert.deepEqual(Object.keys(networkInterfaces()).sort(), ['lo'], 'Offline gates require only loopback in a real network namespace');
    assert.ok(networkInterfaces().lo?.every(address => address.internal), 'Loopback must be up');
    const parentNamespace = process.env.BIF_OFFLINE_PARENT_NET_NS;
    assert.match(parentNamespace ?? '', /^net:\[[0-9]+\]$/, 'A valid captured parent network namespace identity is required');
    const currentNamespace = readlinkSync('/proc/self/ns/net');
    assert.match(currentNamespace, /^net:\[[0-9]+\]$/, 'Invalid current network namespace identity');
    assert.notEqual(currentNamespace, parentNamespace, 'Gates must run outside the initiating network namespace');
    assert.equal(process.env.CARGO_NET_OFFLINE, 'true');
    assert.equal(process.env.WRANGLER_SEND_METRICS, 'false');
    assert.equal(process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false');
    assert.equal(process.env.npm_config_manage_package_manager_versions, 'false', 'Package-manager version bootstrap must be explicitly disabled');
    assert.ok(!Object.keys(process.env).some(name => /^(CLOUDFLARE_(API|ACCOUNT)|CF_(API|ACCOUNT)|NODE_OPTIONS|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(name)), 'Credentials, external proxies and injected Node loaders must not enter offline gates');
  }
}
