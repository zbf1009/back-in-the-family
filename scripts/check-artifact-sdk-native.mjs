import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readlinkSync, realpathSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import childProcess from 'node:child_process';

// This helper is copied into, and executes only inside, the fresh SDK namespace.
const workspace = '/workspace';
const sdk = join(workspace, 'sdk');
const evidence = { commands: [], nativeProcesses: [], versions: {}, paths: {}, counts: {} };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function owned(path) {
  const actual = realpathSync(path);
  assert.ok(actual.startsWith(`${sdk}/`) || actual.startsWith(`${workspace}/store/`), `SDK dependency escaped the owned graph: ${actual}`);
  return actual;
}
function command(file, args, cwd = sdk) {
  const result = childProcess.spawnSync(file, args, { cwd, env: process.env, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  evidence.commands.push({ file, args, cwd, exit: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `SDK command failed: ${file} ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}
function tree(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), 'Public tree must not contain symlinks');
    if (entry.isDirectory()) return tree(join(directory, entry.name), `${path}/`);
    assert.ok(entry.isFile(), 'Public tree must contain only regular files');
    const bytes = readFileSync(join(directory, entry.name));
    return [{ path, size: bytes.length, sha256: hash(bytes) }];
  });
}
try {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v26.7.0');
  const glibc = process.report.getReport().header.glibcVersionRuntime;
  assert.ok(glibc, 'Fresh public SDK acceptance requires glibc');
  const namespace = { net: readlinkSync('/proc/self/ns/net'), mount: readlinkSync('/proc/self/ns/mnt'), parentNet: process.env.BIF_SDK_PARENT_NET_NS, parentMount: process.env.BIF_SDK_PARENT_MOUNT_NS };
  assert.notEqual(namespace.net, namespace.parentNet);
  assert.notEqual(namespace.mount, namespace.parentMount);
  assert.ok(Object.values(networkInterfaces()).flat().every(address => address.internal), 'External network interface entered SDK acceptance');
  assert.ok(!existsSync('/home') && !existsSync('/root') && !existsSync('/repo'), 'Host repositories and HOME must not be mounted');
  assert.ok(!Object.keys(process.env).some(key => /^(NODE_PATH|NODE_OPTIONS|LD_|DYLD_|ESBUILD_BINARY_PATH|WORKERD_BINARY_PATH|SHARP_|VIPS_|CARGO|RUST|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|CF_|CLOUDFLARE_(API|ACCOUNT)|NPM_TOKEN|NODE_AUTH_TOKEN)/i.test(key)), 'Native overrides, loaders, proxies or credentials entered acceptance');
  const before = tree(join(workspace, 'public'));
  assert.deepEqual(before, JSON.parse(readFileSync(join(workspace, 'before.json'), 'utf8')));
  const pnpmVersion = command('/tools/pnpm', ['--version']);
  assert.equal(pnpmVersion, '10.33.1');
  command('/tools/pnpm', ['install', '--frozen-lockfile', '--offline', '--ignore-scripts', '--optional=true', '--store-dir', `${workspace}/store`, '--package-import-method=copy', '--verify-store-integrity', '--side-effects-cache=false', '--manage-package-manager-versions=false']);
  assert.ok(readFileSync(join(sdk, 'package.json')).equals(readFileSync(join(workspace, 'public/package.json'))));
  assert.ok(readFileSync(join(sdk, 'pnpm-lock.yaml')).equals(readFileSync(join(workspace, 'public/pnpm-lock.yaml'))));
  const rootRequire = createRequire(join(sdk, 'package.json'));
  const wranglerManifest = owned(rootRequire.resolve('wrangler/package.json'));
  const wranglerRequire = createRequire(wranglerManifest);
  const miniflareManifest = owned(wranglerRequire.resolve('miniflare/package.json'));
  const miniflareRequire = createRequire(miniflareManifest);
  const sharpEntry = owned(miniflareRequire.resolve('sharp'));
  const sharpManifest = owned(join(dirname(sharpEntry), '..', 'package.json'));
  const sharpRequire = createRequire(sharpManifest);
  const packagePaths = { wrangler: wranglerManifest, '@types/node': owned(rootRequire.resolve('@types/node/package.json')), workerd: owned(wranglerRequire.resolve('workerd/package.json')), esbuild: owned(wranglerRequire.resolve('esbuild/package.json')), sharp: sharpManifest, '@img/sharp-libvips-linux-x64': owned(sharpRequire.resolve('@img/sharp-libvips-linux-x64/package')) };
  const fixed = { wrangler: '4.157.0', '@types/node': '26.6.6', workerd: '1.20261103.1', esbuild: '0.28.2', sharp: '0.35.5', '@img/sharp-libvips-linux-x64': '1.3.4' };
  for (const [name, path] of Object.entries(packagePaths)) {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, fixed[name]);
    evidence.versions[name] = pkg.version;
  }
  evidence.paths.packages = packagePaths;
  const wranglerCLI = owned(join(wranglerManifest, '..', 'bin/wrangler.js'));
  const wranglerVersion = command('/tools/node', [wranglerCLI, '--version']);
  assert.match(wranglerVersion, /\b4\.157\.0\b/);
  const workerd = wranglerRequire('workerd');
  const workerdBinary = owned(workerd.binPath);
  const nativeWorkerd = command(workerdBinary, ['--version']);
  assert.match(nativeWorkerd, /2026-11-03|20261103/);
  const esbuildManifest = packagePaths.esbuild;
  const esbuildRequire = createRequire(esbuildManifest);
  const esbuildBinary = owned(esbuildRequire.resolve('@esbuild/linux-x64/bin/esbuild'));
  assert.equal(command(esbuildBinary, ['--version']), '0.28.2');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function(file, args, options) {
    evidence.nativeProcesses.push({ file: owned(file), args });
    return originalSpawn.call(this, file, args, options);
  };
  const esbuild = wranglerRequire('esbuild');
  assert.equal(esbuild.version, '0.28.2');
  const transformed = await esbuild.transform('const answer: number = 42;', { loader: 'ts' });
  assert.match(transformed.code, /const answer = 42/);
  assert.ok(!transformed.code.includes(': number'));
  assert.ok(evidence.nativeProcesses.some(child => child.file === esbuildBinary), 'Actual esbuild transform must spawn its installed native binary');
  esbuild.stop();
  childProcess.spawn = originalSpawn;
  const sharp = miniflareRequire('sharp');
  const image = await sharp({ create: { width: 2, height: 3, channels: 4, background: { r: 7, g: 11, b: 13, alpha: 1 } } }).png().toBuffer();
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 3);
  assert.equal(metadata.format, 'png');
  const sharedObjects = process.report.getReport().sharedObjects;
  const sharpNative = sharedObjects.filter(path => path.endsWith('.node') && path.includes('sharp'));
  const libvips = sharedObjects.filter(path => path.includes('libvips') && path.includes('.so'));
  assert.ok(sharpNative.length > 0 && libvips.length > 0, 'Sharp must actually load its installed native addon and libvips shared object');
  const libvipsRoot = realpathSync(join(packagePaths['@img/sharp-libvips-linux-x64'], '..'));
  for (const path of [...sharpNative, ...libvips]) owned(path);
  assert.ok(libvips.every(path => realpathSync(path).startsWith(`${libvipsRoot}/`)), 'Loaded libvips must belong to the fixed nested installed package');
  evidence.paths.native = { workerd: workerdBinary, esbuild: esbuildBinary, sharp: sharpNative, libvips };
  evidence.operations = { esbuild: { input: 'const answer: number = 42;', loader: 'ts', output: transformed.code }, sharp: { operation: 'create 2x3 RGBA → PNG → metadata', pngSHA256: hash(image), width: metadata.width, height: metadata.height, libvipsVersion: sharp.versions.vips } };
  const config = JSON.parse(readFileSync(join(workspace, 'public/wrangler.jsonc'), 'utf8'));
  assert.equal(config.no_bundle, true);
  command('/tools/node', [wranglerCLI, 'deploy', '--config', `${workspace}/public/wrangler.jsonc`, '--dry-run', '--outdir', `${workspace}/out`]);
  const packaged = tree(join(workspace, 'out'));
  assert.ok(packaged.length > 0, 'Actual Wrangler dry-run must produce packaging output');
  assert.ok(packaged.some(file => file.sha256 === before.find(publicFile => publicFile.path === 'worker.js').sha256), 'no_bundle packaging must retain the exact prebuilt Worker bytes');
  evidence.packaged = packaged;
  const after = tree(join(workspace, 'public'));
  assert.deepEqual(after, before, 'Public Worker/assets/WASM/package/lock bytes changed during SDK acceptance');
  const network = readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2).map(line => {
    const [name, values] = line.trim().split(':');
    const counters = values.trim().split(/\s+/).map(Number);
    assert.equal(name.trim(), 'lo', 'Only isolated loopback may exist');
    assert.equal(counters[0], 0, 'SDK acceptance must transmit no network bytes');
    assert.equal(counters[8], 0, 'SDK acceptance must transmit no network bytes');
    return { interface: name.trim(), received: counters[0], sent: counters[8] };
  });
  evidence.network = network;
  evidence.counts = { commands: evidence.commands.length, nativeProcesses: evidence.nativeProcesses.length, publicFiles: before.length, wasmFiles: before.filter(file => file.path.endsWith('.wasm')).length, downloads: 0, egressBytes: 0, modelCalls: 0 };
  evidence.enforcement = { offlineInstall: true, scriptsIgnored: true, network: 'new network namespace; no external interface; zero RX/TX counters', models: 'only version/native operations and deploy --dry-run; no live binding or server operation', hostInputs: 'empty mount root; only OS libraries, direct tools and owned workspace are mounted' };
  evidence.platform = { os: process.platform, arch: process.arch, libc: 'glibc', glibc, node: process.version, pnpm: pnpmVersion };
  evidence.namespace = namespace;
  evidence.before = before;
  evidence.after = after;
  evidence.result = 'pass';
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} catch (error) {
  evidence.result = 'fail';
  evidence.error = error.message;
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = 1;
}
