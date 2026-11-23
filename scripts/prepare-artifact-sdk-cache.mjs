import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const yamlIntegrity = 'sha512-lcYcMxX2PO9XMGvAJkJ3OsNMw+/7FKes7/hgerGUYWIoWu5j/+YQqcZr5JnPZWzOsEBgMbSbiSTn/dv/69Mkpw==';
const fixedRoots = { '@types/node': '26.6.6', wrangler: '4.157.0' };
const hash = (bytes, algorithm = 'sha512') => createHash(algorithm).update(bytes).digest();
function sri(integrity) {
  assert.ok(typeof integrity === 'string' && integrity.startsWith('sha512-'), 'Only fixed SHA512 npm package content is permitted');
  const digest = Buffer.from(integrity.slice(7), 'base64');
  assert.equal(digest.length, 64, 'Invalid locked package integrity');
  assert.equal(digest.toString('base64'), integrity.slice(7), 'Noncanonical package integrity');
  return digest;
}
function safePath(path) {
  assert.ok(typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && posix.normalize(path) === path && !path.split('/').some(part => part === '..' || part === '.' || part === ''), 'Unsafe npm tarball or store path');
}
function packageFact(key, record) {
  assert.ok(!key.includes('(') && !key.includes(':') && !key.includes('\\'), 'Only registry package records may be prepared');
  const at = key.lastIndexOf('@');
  assert.ok(at > 0, 'Fixed package key requires a name and version');
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  assert.ok(version && !version.includes('/') && !version.includes('@') && !version.includes(' '), 'Invalid fixed npm version');
  const pieces = name.split('/');
  assert.ok((name.startsWith('@') && pieces.length === 2 && pieces.every(Boolean)) || (!name.startsWith('@') && pieces.length === 1), 'Invalid fixed npm package name');
  const basename = pieces.at(-1);
  const url = `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
  const integrity = record.resolution?.integrity;
  sri(integrity);
  assert.ok(!record.resolution.tarball || record.resolution.tarball === url, 'Preparation forbids alternate tarball hosts or URLs');
  return { name, version, integrity, url };
}
function indexPath(store, fact) {
  const hex = sri(fact.integrity).toString('hex').slice(0, 64);
  return join(store, 'v10/index', hex.slice(0, 2), `${hex.slice(2)}-${`${fact.name}@${fact.version}`.replaceAll('/', '+')}.json`);
}
function payloadPath(store, entry) {
  const hex = sri(entry.integrity).toString('hex');
  return join(store, 'v10/files', hex.slice(0, 2), hex.slice(2) + ((entry.mode & 0o111) ? '-exec' : ''));
}
async function regularBytes(path) {
  assert.ok((await lstat(path)).isFile(), 'Package payload must be a regular file, not a symlink');
  return readFile(path);
}
// Readiness means every indexed file exists and its complete bytes match SRI,
// not merely an index entry or a package.json in an old installation.
export async function inspectSdkCache(packageRecords, store) {
  const ready = [];
  const missing = [];
  let verifiedFiles = 0;
  const verified = new Set();
  for (const [key, record] of Object.entries(packageRecords)) {
    const fact = packageFact(key, record);
    try {
      const index = JSON.parse(await regularBytes(indexPath(store, fact)));
      assert.equal(index.name, fact.name);
      assert.equal(index.version, fact.version);
      assert.ok(index.files && Object.keys(index.files).length > 0 && index.files['package.json'], 'Incomplete package file index');
      for (const [path, entry] of Object.entries(index.files)) {
        safePath(path);
        assert.ok(Number.isInteger(entry.mode) && Number.isInteger(entry.size) && entry.size >= 0, 'Invalid package payload metadata');
        const content = payloadPath(store, entry);
        if (!verified.has(content)) {
          const bytes = await regularBytes(content);
          assert.equal(bytes.length, entry.size);
          assert.ok(hash(bytes).equals(sri(entry.integrity)), 'Cached package payload differs from its complete file SRI');
          verified.add(content);
          verifiedFiles++;
        }
      }
      const manifest = JSON.parse(await regularBytes(payloadPath(store, index.files['package.json'])));
      assert.equal(manifest.name, fact.name);
      assert.equal(manifest.version, fact.version);
      ready.push(fact);
    } catch (error) { missing.push({ ...fact, reason: error.message }); }
  }
  return { ready, missing, verifiedFiles };
}
// npm tarballs are data only. No extraction process or lifecycle script runs.
// Reject links/devices and support npm's PAX long paths without trusting paths.
function tarFiles(tgz) {
  const bytes = gunzipSync(tgz, { maxOutputLength: 512 * 1024 * 1024 });
  const files = new Map();
  let extendedPath;
  let pendingPax = {};
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').split('\0')[0];
    const octal = (start, length) => {
      const value = text(start, length).trim();
      assert.ok(value && [...value].every(char => char >= '0' && char <= '7'), 'Invalid npm tar header');
      return parseInt(value, 8);
    };
    const size = octal(124, 12);
    const mode = octal(100, 8) & 0o777;
    let checksum = 0;
    for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(checksum, octal(148, 8), 'Invalid npm tar header checksum');
    assert.ok(offset + 512 + size <= bytes.length, 'Truncated npm tarball');
    const data = bytes.subarray(offset + 512, offset + 512 + size);
    const type = text(156, 1);
    const prefix = text(345, 155);
    let path = extendedPath ?? pendingPax.path ?? (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pendingPax = {};
      for (let position = 0; position < data.length;) {
        const space = data.indexOf(32, position);
        assert.ok(space > position, 'Invalid npm PAX record');
        const length = Number(data.subarray(position, space).toString('ascii'));
        assert.ok(Number.isInteger(length) && length > space - position && position + length <= data.length, 'Invalid npm PAX length');
        const field = data.subarray(space + 1, position + length - 1).toString('utf8');
        const equals = field.indexOf('=');
        assert.ok(equals > 0, 'Invalid npm PAX field');
        pendingPax[field.slice(0, equals)] = field.slice(equals + 1);
        position += length;
      }
      continue;
    }
    if (type === 'L') { extendedPath = data.toString('utf8').split('\0')[0]; continue; }
    assert.ok(type === '0' || type === '' || type === '5', 'npm tarball links and nonregular payloads are forbidden');
    extendedPath = undefined;
    pendingPax = {};
    if (type === '5') continue;
    assert.ok(path.startsWith('package/'), 'npm payload must be rooted at package/');
    path = path.slice(8);
    safePath(path);
    assert.ok(!files.has(path), 'Duplicate npm tarball file');
    files.set(path, { bytes: data, mode });
  }
  assert.ok(files.has('package.json') && files.size > 1, 'Incomplete npm tarball');
  return files;
}
function verifiedTarball(bytes, fact) {
  assert.ok(hash(bytes).equals(sri(fact.integrity)), `Tarball does not match fixed lock integrity: ${fact.name}@${fact.version}`);
  const files = tarFiles(bytes);
  const manifest = JSON.parse(files.get('package.json').bytes);
  assert.equal(manifest.name, fact.name);
  assert.equal(manifest.version, fact.version);
  if (fact.name === 'yaml') {
    assert.equal(fact.integrity, yamlIntegrity);
    assert.equal(manifest.license, 'ISC');
    assert.ok(!manifest.dependencies || Object.keys(manifest.dependencies).length === 0);
    assert.ok(files.has('dist/index.d.ts'));
    for (const script of ['install', 'preinstall', 'postinstall', 'prepare']) assert.ok(!manifest.scripts?.[script], 'YAML must not contain lifecycle scripts');
  }
  return { files, manifest };
}
async function importTarball(store, fact, tarball) {
  const { files, manifest } = verifiedTarball(tarball, fact);
  const entries = {};
  for (const [path, { bytes, mode }] of files) {
    const entry = { checkedAt: Date.now(), integrity: `sha512-${hash(bytes).toString('base64')}`, mode, size: bytes.length };
    const target = payloadPath(store, entry);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: (mode & 0o111) ? 0o755 : 0o644 });
    entries[path] = entry;
  }
  const target = indexPath(store, fact);
  await mkdir(dirname(target), { recursive: true });
  const scripts = Object.keys(manifest.scripts ?? {});
  await writeFile(target, `${JSON.stringify({ name: fact.name, version: fact.version, requiresBuild: scripts.some(name => ['preinstall', 'install', 'postinstall'].includes(name)) || files.has('binding.gyp'), files: entries })}\n`);
  return { ...fact, tarballSHA256: hash(tarball, 'sha256').toString('hex'), files: files.size, declaredLifecycleScripts: scripts.filter(name => ['preinstall', 'install', 'postinstall', 'prepare'].includes(name)), lifecycleScriptsExecuted: 0 };
}
async function publicNpmTarball(fact) {
  const url = new URL(fact.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'registry.npmjs.org');
  assert.equal(url.port, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  return new Promise((resolveRequest, reject) => {
    const request = https.get(url, { agent: false, headers: { Accept: 'application/octet-stream' }, timeout: 60_000 }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Public npm returned ${response.statusCode} for ${fact.name}@${fact.version}; redirects and fallback hosts are forbidden`)); return; }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > 256 * 1024 * 1024) { request.destroy(new Error('Fixed npm tarball exceeds preparation bound')); return; } chunks.push(chunk); });
      response.on('end', () => resolveRequest(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Public npm fixed-tarball preparation timed out')));
    request.on('error', reject);
  });
}
async function selectedPackages(flags) {
  const lockText = await readFile(flags.get('--source-lock'), 'utf8');
  const packageText = await readFile(flags.get('--package'), 'utf8');
  assert.deepEqual(JSON.parse(packageText).devDependencies, fixedRoots, 'Preparation is rooted only in the existing two public SDK dependencies');
  const yamlFact = packageFact('yaml@2.8.1', { resolution: { integrity: yamlIntegrity } });
  let temporary;
  try {
    let helper = join(root, 'scripts/artifact-sdk-lock.ts');
    let yamlRequire = createRequire(join(root, 'web/package.json'));
    if (flags.has('--yaml-module')) {
      assert.ok(flags.has('--yaml-tarball'), 'Preparatory YAML requires independently SRI-verified tarball bytes');
      const { files } = verifiedTarball(await regularBytes(flags.get('--yaml-tarball')), yamlFact);
      const modulePath = await realpath(flags.get('--yaml-module'));
      const packageDirectory = resolve(dirname(modulePath), '..');
      assert.equal(modulePath, join(packageDirectory, 'dist/index.js'));
      for (const [path, { bytes }] of files) assert.ok(bytes.equals(await regularBytes(join(packageDirectory, path))), 'Explicit preparatory YAML differs from its verified tarball');
      temporary = await mkdtemp(join(root, 'target/sdk-cache-selector.'));
      await mkdir(join(temporary, 'scripts'));
      await cp(helper, join(temporary, 'scripts/artifact-sdk-lock.ts'));
      assert.ok((await regularBytes(helper)).equals(await regularBytes(join(temporary, 'scripts/artifact-sdk-lock.ts'))), 'Preparatory helper must exactly match the shared source helper bytes');
      await mkdir(join(temporary, 'web/node_modules/yaml'), { recursive: true });
      for (const [path, { bytes, mode }] of files) {
        const target = join(temporary, 'web/node_modules/yaml', path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { mode });
      }
      await writeFile(join(temporary, 'web/package.json'), '{}\n');
      helper = join(temporary, 'scripts/artifact-sdk-lock.ts');
      yamlRequire = createRequire(join(temporary, 'web/package.json'));
    }
    assert.equal(yamlRequire('yaml/package.json').version, '2.8.1');
    const { selectSdkLock } = await import(pathToFileURL(helper).href);
    const selected = selectSdkLock(lockText, packageText);
    const packageRecords = { ...selected.packages, 'yaml@2.8.1': { resolution: { integrity: yamlIntegrity } } };
    return { packages: Object.entries(packageRecords).map(([key, value]) => packageFact(key, value)), packageRecords, sourceLockSHA256: hash(Buffer.from(lockText), 'sha256').toString('hex'), packageSHA256: hash(Buffer.from(packageText), 'sha256').toString('hex') };
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  assert.ok(mode === '--plan' || mode === '--prepare', 'Use --plan for offline inventory or separately approved --prepare for bounded public npm preparation');
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    assert.ok(['--source-lock', '--package', '--store-dir', '--output', '--approved-plan', '--yaml-module', '--yaml-tarball'].includes(flag) && !flags.has(flag));
    assert.ok(args[index + 1] && !args[index + 1].startsWith('--'));
    flags.set(flag, resolve(args[index + 1]));
  }
  for (const flag of ['--source-lock', '--package', '--store-dir', '--output']) assert.ok(flags.has(flag), `Required cache preparation argument: ${flag}`);
  assert.equal(process.version, 'v26.7.0');
  assert.ok(Object.keys(process.env).every(key => key === 'PATH'), 'Run fixed cache preparation with env -i PATH=/usr/bin:/bin: no HOME/config, credentials, proxies, TLS overrides or injected loaders');
  const selected = await selectedPackages(flags);
  const sourceStore = await realpath(flags.get('--store-dir'));
  const inventory = await inspectSdkCache(selected.packageRecords, sourceStore);
  const facts = inventory.missing.map(({ reason, ...fact }) => fact);
  const plan = { version: 1, sourceLockSHA256: selected.sourceLockSHA256, packageSHA256: selected.packageSHA256, sourceStore, output: flags.get('--output'), packages: selected.packages, missing: facts, inventory: { verifiedFiles: inventory.verifiedFiles, readyPackages: inventory.ready.length, missingPackages: facts.length, reasons: inventory.missing }, registry: 'https://registry.npmjs.org', scriptsExecuted: 0 };
  if (mode === '--plan') { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); return; }
  assert.ok(flags.has('--approved-plan'), 'Online preparation requires the exact previously reviewed offline package plan');
  const approved = JSON.parse(await regularBytes(flags.get('--approved-plan')));
  assert.deepEqual({ ...approved, inventory: undefined }, { ...plan, inventory: undefined }, 'Approved preparation plan changed; no online request is allowed');
  const output = flags.get('--output');
  assert.ok(output.startsWith(`${root}target/`) && output !== sourceStore && !output.startsWith(`${sourceStore}/`) && !sourceStore.startsWith(`${output}/`), 'Writable preparation output must be a new owned target directory, separate from the source store');
  await mkdir(output); // exclusive new output; never an implicit shared-store write
  const store = join(output, 'store');
  await cp(sourceStore, store, { recursive: true, dereference: false, force: false, errorOnExist: true });
  const results = [];
  const startedAt = new Date().toISOString();
  for (const fact of facts) {
    const localYaml = fact.name === 'yaml' && flags.has('--yaml-tarball');
    const tarball = localYaml ? await regularBytes(flags.get('--yaml-tarball')) : await publicNpmTarball(fact);
    results.push({ ...await importTarball(store, fact, tarball), networkRequest: !localYaml });
  }
  const endedAt = new Date().toISOString();
  const complete = await inspectSdkCache(selected.packageRecords, store);
  assert.deepEqual(complete.missing, [], 'Fixed package preparation did not produce complete verified payloads');
  const evidence = { ...plan, store, result: 'prepared', phase: 'separate public npm preparation; no selector generation/install/gate network fallback', startedAt, endedAt, requests: results.filter(result => result.networkRequest).length, downloads: results.filter(result => result.networkRequest).length, results, verifiedPackages: complete.ready.length, verifiedFiles: complete.verifiedFiles, lifecycleScriptsExecuted: 0, globalInstalls: 0, modelCalls: 0 };
  await writeFile(join(output, 'preparation.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`SDK cache preparation failed: ${error.message}\n`); process.exitCode = 1; });
}
