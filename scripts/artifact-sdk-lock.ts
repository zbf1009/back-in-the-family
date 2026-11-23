import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as YamlTools from '../web/node_modules/yaml';

const requireWeb = createRequire(new URL('../web/package.json', import.meta.url));
const moduleRoot = realpathSync(fileURLToPath(new URL('../web/node_modules', import.meta.url))) + sep;
for (const entry of ['yaml', 'yaml/package.json']) {
  assert.ok(realpathSync(requireWeb.resolve(entry)).startsWith(moduleRoot), 'SDK lock YAML must come from the checker project, not a host fallback');
}
assert.equal(requireWeb('yaml/package.json').version, '2.8.1', 'SDK lock requires the exact public yaml@2.8.1');
const yaml = requireWeb('yaml') as typeof YamlTools;

type Mapping = Record<string, unknown>;

function mapping(value: unknown, location: string): Mapping {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype, `SDK lock ${location} must be a mapping`);
  return value as Mapping;
}

function plainValue(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), 'SDK lock contains an unsafe YAML number');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) plainValue(item);
    return;
  }
  for (const item of Object.values(mapping(value, 'plain YAML value'))) plainValue(item);
}

function parseLock(text: string): Mapping {
  const document = yaml.parseDocument(text, {
    version: '1.2', schema: 'core', customTags: [], resolveKnownTags: false,
    merge: false, strict: true, uniqueKeys: true, prettyErrors: false, logLevel: 'silent',
  });
  assert.ok(document.errors.length === 0 && document.warnings.length === 0, 'SDK lock is invalid plain YAML (contents redacted)');
  assert.equal(document.directives.yaml.version, '1.2', 'SDK lock requires YAML 1.2');
  yaml.visit(document, {
    Node(_key, node) {
      assert.ok(!yaml.isAlias(node), 'SDK lock YAML aliases are forbidden');
      if (!yaml.isAlias(node)) assert.ok(!node.tag && !node.anchor, 'SDK lock YAML tags and anchors are forbidden');
    },
    Pair(_key, pair) {
      assert.ok(yaml.isScalar(pair.key) && typeof pair.key.value === 'string' && pair.key.value !== '<<', 'SDK lock YAML keys must be plain strings, without merges');
    },
  });
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  plainValue(value);
  const lock = mapping(value, 'document');
  assert.equal(lock.lockfileVersion, '9.0', 'SDK lock requires pnpm lockfile version 9.0');
  mapping(lock.settings, 'settings');
  mapping(lock.importers, 'importers');
  mapping(lock.packages, 'packages');
  mapping(lock.snapshots, 'snapshots');
  return lock;
}

function deployRoots(text: string): Mapping {
  const packageJson = mapping(JSON.parse(text) as unknown, 'deploy package');
  assert.equal(packageJson.packageManager, 'pnpm@10.33.1', 'SDK package manager pin mismatch');
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.ok(!Object.hasOwn(packageJson, field), 'Public SDK roots must remain devDependencies only');
  }
  const roots = mapping(packageJson.devDependencies, 'deploy devDependencies');
  assert.deepEqual(roots, { '@types/node': '26.6.6', wrangler: '4.157.0' }, 'Public SDK must retain exactly its two original fixed roots');
  return roots;
}

function stringMap(record: Mapping, field: string, location: string): Mapping {
  if (!Object.hasOwn(record, field)) return {};
  const values = mapping(record[field], `${location}.${field}`);
  for (const value of Object.values(values)) assert.ok(typeof value === 'string' && value.length > 0, `SDK lock ${location}.${field} must contain string references`);
  return values;
}

function registryKey(key: string): void {
  // Registry keys are checked as keys, never reparsed into dependency names.
  const base = key.slice(0, key.indexOf('(') < 0 ? key.length : key.indexOf('('));
  assert.ok(base.length > 0 && !base.includes(':') && !base.includes('\\') && !base.includes(' ') &&
    !base.startsWith('/') && !base.startsWith('.') && !base.includes(')') && !base.includes('#'), 'SDK lock selected nonregistry/local reference is forbidden');
  assert.ok(base.includes('@') && (!base.startsWith('@') || base.indexOf('@', 1) > 0), 'SDK lock selected registry key is invalid');
}

function peerContexts(key: string): string[] {
  const peers: string[] = [];
  let cursor = key.indexOf('(');
  if (cursor < 0) return peers;
  while (cursor < key.length) {
    assert.equal(key[cursor], '(', 'SDK lock peer context is malformed');
    const start = ++cursor;
    let depth = 1;
    while (cursor < key.length && depth > 0) {
      if (key[cursor] === '(') depth++;
      if (key[cursor] === ')') depth--;
      cursor++;
    }
    assert.equal(depth, 0, 'SDK lock peer context is unterminated');
    const peer = key.slice(start, cursor - 1);
    registryKey(peer);
    peers.push(peer);
  }
  return peers;
}

function resolution(record: Mapping, key: string): void {
  const value = mapping(record.resolution, `${key}.resolution`);
  assert.ok(typeof value.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value.integrity), `SDK lock ${key} requires locked sha512 integrity`);
  assert.equal(Buffer.from(value.integrity.slice(7), 'base64').toString('base64'), value.integrity.slice(7), 'SDK lock integrity must be canonical');
  for (const field of ['directory', 'type', 'repo', 'commit', 'path']) assert.ok(!Object.hasOwn(value, field), 'SDK lock selected nonregistry resolution is forbidden');
  if (Object.hasOwn(value, 'tarball')) {
    assert.ok(typeof value.tarball === 'string', 'SDK lock registry tarball must be a string');
    const url = new URL(value.tarball);
    assert.ok(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.port && !url.username && !url.password && !url.search && !url.hash, 'SDK lock tarball must use the public npm registry');
  }
  for (const field of ['cpu', 'os', 'libc']) {
    if (!Object.hasOwn(record, field)) continue;
    const values = record[field];
    assert.ok(Array.isArray(values) && values.length > 0 && values.every(value => typeof value === 'string' && value.length > 0), `SDK lock ${key}.${field} must be a nonempty platform list`);
  }
  stringMap(record, 'peerDependencies', key);
  if (Object.hasOwn(record, 'peerDependenciesMeta')) {
    for (const [name, metadata] of Object.entries(mapping(record.peerDependenciesMeta, `${key}.peerDependenciesMeta`))) {
      assert.ok(Object.hasOwn(stringMap(record, 'peerDependencies', key), name), 'SDK lock peer metadata lacks a declaration');
      const peer = mapping(metadata, `${key}.peerDependenciesMeta.${name}`);
      if (Object.hasOwn(peer, 'optional')) assert.equal(typeof peer.optional, 'boolean', 'SDK lock optional peer flag must be boolean');
    }
  }
}

function selectDocument(lock: Mapping, roots: Mapping): Mapping {
  const sourceImporter = mapping(mapping(lock.importers, 'importers')['.'], 'source root importer');
  const sourceRoots = mapping(sourceImporter.devDependencies, 'source devDependencies');
  const selectedRoots: Mapping = {};
  const packages = mapping(lock.packages, 'packages');
  const snapshots = mapping(lock.snapshots, 'snapshots');
  const reachedSnapshots = new Set<string>();
  const reachedPackages = new Set<string>();

  function dependency(name: string, reference: string): string {
    assert.ok(name.length > 0 && !name.includes(':') && !name.includes('(') && !name.includes(')'), 'SDK lock dependency name is invalid');
    const target = reference.startsWith('npm:') ? reference.slice(4) : reference;
    // pnpm registry aliases use the target's full key; ordinary references use
    // the structured dependency name plus their complete resolved reference.
    const namedKey = `${name}@${target}`;
    const key = Object.hasOwn(snapshots, namedKey) && !reference.startsWith('npm:') ? namedKey : target;
    registryKey(key);
    snapshot(key);
    return key;
  }

  function snapshot(key: string): void {
    registryKey(key);
    assert.ok(Object.hasOwn(snapshots, key), `SDK lock missing selected snapshot: ${key}`);
    if (reachedSnapshots.has(key)) return;
    reachedSnapshots.add(key);
    const peerStart = key.indexOf('(');
    const base = peerStart < 0 ? key : key.slice(0, peerStart);
    assert.ok(Object.hasOwn(packages, base), `SDK lock missing selected package record: ${base}`);
    const record = mapping(packages[base], base);
    if (!reachedPackages.has(base)) resolution(record, base);
    reachedPackages.add(base);
    const entry = mapping(snapshots[key], key);
    if (Object.hasOwn(entry, 'optional')) assert.equal(typeof entry.optional, 'boolean', 'SDK lock optional snapshot flag must be boolean');
    if (Object.hasOwn(entry, 'transitivePeerDependencies')) {
      assert.ok(Array.isArray(entry.transitivePeerDependencies) && entry.transitivePeerDependencies.every(name => typeof name === 'string'), 'SDK lock transitive peers must be a string list');
    }
    const resolved = new Map<string, string>();
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [name, reference] of Object.entries(stringMap(entry, field, key))) resolved.set(name, dependency(name, reference as string));
    }
    // Only peers actually encoded in the resolved key are edges. Optional
    // declarations and transitive peer names alone do not install anything.
    const peers = peerContexts(key);
    for (const peer of peers) snapshot(peer);
    const declarations = stringMap(record, 'peerDependencies', key);
    const metadata = Object.hasOwn(record, 'peerDependenciesMeta') ? mapping(record.peerDependenciesMeta, `${key}.peerDependenciesMeta`) : {};
    for (const name of Object.keys(declarations)) {
      const edge = resolved.get(name);
      const context = peers.find(peer => peer.startsWith(`${name}@`));
      const optional = Object.hasOwn(metadata, name) && mapping(metadata[name], `${key}.peerDependenciesMeta.${name}`).optional === true;
      assert.ok(optional || edge || context, `SDK lock mandatory peer is unresolved: ${key} -> ${name}`);
      if (edge) assert.equal(context, edge, `SDK lock resolved peer context is missing or inconsistent: ${key} -> ${name}`);
    }
  }

  for (const [name, specifier] of Object.entries(roots)) {
    const entry = mapping(sourceRoots[name], `source root ${name}`);
    assert.equal(entry.specifier, specifier, 'SDK lock source root specifier mismatch');
    assert.ok(typeof entry.version === 'string', 'SDK lock source root resolved reference is missing');
    assert.equal(entry.version, name === '@types/node' ? '26.6.6' : '4.157.0(@types/node@26.6.6)', 'SDK lock source root resolved pin/context mismatch');
    selectedRoots[name] = entry;
    dependency(name, entry.version);
  }
  const selected: Mapping = {
    ...lock,
    importers: { '.': { ...Object.fromEntries(Object.entries(sourceImporter).filter(([key]) => !['dependencies', 'optionalDependencies', 'devDependencies'].includes(key))), devDependencies: selectedRoots } },
    packages: Object.fromEntries(Object.entries(packages).filter(([key]) => reachedPackages.has(key))),
    snapshots: Object.fromEntries(Object.entries(snapshots).filter(([key]) => reachedSnapshots.has(key))),
  };
  nativeGraph(selected);
  return selected;
}

function nativeGraph(lock: Mapping): void {
  const packages = mapping(lock.packages, 'packages');
  const snapshots = mapping(lock.snapshots, 'snapshots');
  function fixedSnapshot(base: string): Mapping {
    const keys = Object.keys(snapshots).filter(key => key === base || key.startsWith(`${base}(`));
    assert.ok(keys.length > 0, `SDK lock missing fixed native parent: ${base}`);
    // All selected contexts have to retain their own complete native map.
    const entries = keys.map(key => mapping(snapshots[key], key));
    for (const entry of entries.slice(1)) assert.deepEqual(entry.optionalDependencies, entries[0]!.optionalDependencies, 'SDK lock native peer contexts have inconsistent platform maps');
    return entries[0]!;
  }
  function platformFamily(parent: Mapping, prefix: string, version: string, count: number): string[] {
    const optionals = stringMap(parent, 'optionalDependencies', prefix);
    const names = Object.keys(optionals).filter(name => name.startsWith(prefix));
    assert.equal(names.length, count, `SDK lock ${prefix} native platform map is incomplete`);
    for (const name of names) {
      assert.equal(optionals[name], version, 'SDK lock native version pin mismatch');
      const record = mapping(packages[`${name}@${version}`], name);
      const platform = name.slice(prefix.length);
      if (platform === 'wasm32') continue;
      if (platform === 'freebsd-wasm32') { assert.deepEqual(record.os, ['freebsd'], 'SDK lock native OS mismatch'); continue; }
      if (platform === 'webcontainers-wasm32') { assert.deepEqual(record.cpu, ['wasm32'], 'SDK lock native CPU mismatch'); continue; }
      const separator = platform.lastIndexOf('-');
      assert.ok(separator > 0, 'SDK lock native platform is invalid');
      const os = platform.slice(0, separator);
      const cpu = platform.slice(separator + 1);
      assert.deepEqual(record.cpu, [cpu === '64' ? 'x64' : cpu], 'SDK lock native CPU mismatch');
      assert.deepEqual(record.os, [os === 'windows' ? 'win32' : os === 'linuxmusl' ? 'linux' : os], 'SDK lock native OS mismatch');
      if (prefix.startsWith('@img/') && (os === 'linux' || os === 'linuxmusl')) assert.deepEqual(record.libc, [os === 'linuxmusl' ? 'musl' : 'glibc'], 'SDK lock native libc mismatch');
    }
    return names;
  }
  const workerd = fixedSnapshot('workerd@1.20261103.1');
  const esbuild = fixedSnapshot('esbuild@0.28.2');
  platformFamily(workerd, '@cloudflare/workerd-', '1.20261103.1', 5);
  platformFamily(esbuild, '@esbuild/', '0.28.2', 26);
  assert.equal(Object.keys(stringMap(workerd, 'optionalDependencies', 'workerd')).length, 5, 'SDK lock workerd has unexpected native alternatives');
  assert.equal(Object.keys(stringMap(esbuild, 'optionalDependencies', 'esbuild')).length, 26, 'SDK lock esbuild has unexpected native alternatives');
  const sharp = fixedSnapshot('sharp@0.35.5');
  const sharpOptionals = stringMap(sharp, 'optionalDependencies', 'sharp');
  const libvips = platformFamily(sharp, '@img/sharp-libvips-', '1.3.4', 10);
  const binaryNames = Object.keys(sharpOptionals).filter(name => name.startsWith('@img/sharp-') && !name.startsWith('@img/sharp-libvips-'));
  assert.equal(binaryNames.length, 15, 'SDK lock sharp native platform map is incomplete');
  platformFamily({ optionalDependencies: Object.fromEntries(binaryNames.map(name => [name, sharpOptionals[name]])) }, '@img/sharp-', '0.35.5', 15);
  for (const name of libvips) {
    const binary = name.replace('@img/sharp-libvips-', '@img/sharp-');
    const nested = mapping(snapshots[`${binary}@0.35.5`], binary);
    assert.equal(stringMap(nested, 'optionalDependencies', binary)[name], '1.3.4', 'SDK lock sharp to libvips nested edge is missing');
  }
  for (const binary of ['@img/sharp-freebsd-wasm32', '@img/sharp-webcontainers-wasm32']) {
    assert.equal(stringMap(mapping(snapshots[`${binary}@0.35.5`], binary), 'dependencies', binary)['@img/sharp-wasm32'], '0.35.5', 'SDK lock sharp wasm native edge is missing');
  }
  assert.equal(stringMap(fixedSnapshot('wrangler@4.157.0'), 'optionalDependencies', 'wrangler').fsevents, '2.3.3', 'SDK lock Wrangler fsevents optional edge is missing');
  assert.deepEqual(mapping(packages['fsevents@2.3.3'], 'fsevents').os, ['darwin'], 'SDK lock fsevents platform metadata is missing');
}

/** Select the complete public SDK graph from an independently trusted healthy lock. */
export function selectSdkLock(healthyLockText: string, deployPackageText: string): Record<string, unknown> {
  return selectDocument(parseLock(healthyLockText), deployRoots(deployPackageText));
}

/** Validate full document semantics against the independently trusted source selection. */
export function validateSdkLock(actualLockText: string, healthyLockText: string, deployPackageText: string): void {
  const roots = deployRoots(deployPackageText);
  const expected = selectDocument(parseLock(healthyLockText), roots);
  const actual = parseLock(actualLockText);
  assert.deepEqual(actual, selectDocument(actual, roots), 'SDK lock contains extra importers, application or unreachable records');
  assert.deepEqual(actual, expected, 'SDK lock differs from the complete trusted source SDK graph');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 6 && args[0] === '--source-lock' && args[2] === '--package' && args[4] === '--output', 'usage: artifact-sdk-lock.ts --source-lock PATH --package PATH --output PATH');
  const source = resolve(args[1]!);
  const packagePath = resolve(args[3]!);
  const output = resolve(args[5]!);
  assert.ok(output !== source && output !== packagePath, 'SDK lock output must not overwrite an input');
  for (const input of [source, packagePath]) assert.ok(lstatSync(input).isFile() && !lstatSync(input).isSymbolicLink(), 'SDK lock inputs must be regular files');
  try { assert.ok(lstatSync(output).isFile() && !lstatSync(output).isSymbolicLink(), 'SDK lock output must be a regular file'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const selected = selectSdkLock(readFileSync(source, 'utf8'), readFileSync(packagePath, 'utf8'));
  writeFileSync(output, yaml.stringify(selected, { aliasDuplicateObjects: false, lineWidth: 0 }), { flag: 'w' });
}
