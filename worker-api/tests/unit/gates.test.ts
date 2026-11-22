import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { root, sourceConfig, validateSourceConfig } from '../../scripts/profile.ts';

const require = createRequire(import.meta.url);
const { validatePrepared } = require(join(root, 'scripts/gate-tools.mjs')) as {
  validatePrepared(manifest: unknown, inputs: unknown): void;
};

test('the same source guard used by Worker_Build rejects enabled inference missing or mismatched project caps and broken native/router profiles', async () => {
  const source = await sourceConfig();
  validateSourceConfig(source);
  for (const fault of ['inference', 'missing-ai', 'exact', 'wildcard', 'spa', 'date', 'remote', 'missing-byte-cap', 'byte-cap', 'numeric-byte-cap']) {
    const config = structuredClone(source);
    switch (fault) {
      case 'inference': config.vars.INFERENCE_ENABLED = 'true'; break;
      case 'missing-ai': delete config.ai; break;
      case 'exact': config.assets.run_worker_first = ['/api/*']; break;
      case 'wildcard': config.assets.run_worker_first = ['/api']; break;
      case 'spa': config.assets.not_found_handling = 'none'; break;
      case 'date': Object.assign(config, { compatibility_date: '2026-11-21' }); break;
      case 'remote': Object.assign(config.ai!, { remote: true }); break;
      case 'missing-byte-cap': delete config.vars.MAX_REQUEST_BYTES; break;
      case 'byte-cap': config.vars.MAX_REQUEST_BYTES = '1048576'; break;
      case 'numeric-byte-cap': config.vars.MAX_REQUEST_BYTES = 16384; break;
    }
    assert.throws(() => validateSourceConfig(config), { name: 'AssertionError' }, fault);
  }
});

test('actual cache preflight rejects changed inputs missing launchers and version bootstrap shims', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'target/gate-cache/prepared.json'), 'utf8')) as {
    version: number; inputs: Record<string, string>; tools: Record<string, string>;
  };
  validatePrepared(manifest, manifest.inputs);
  const changed = structuredClone(manifest);
  changed.inputs['Cargo.lock'] = 'changed';
  assert.throws(() => validatePrepared(changed, manifest.inputs), /inputs changed/);
  const incomplete = structuredClone(manifest);
  delete incomplete.tools.pnpm;
  assert.throws(() => validatePrepared(incomplete, manifest.inputs), /Incomplete prepared tool launchers/);
  const missing = structuredClone(manifest);
  missing.tools.node = '/nonexistent-prepared-node';
  assert.throws(() => validatePrepared(missing, manifest.inputs));
  const shim = structuredClone(manifest);
  shim.tools.node = '/unprepared/shims/node';
  assert.throws(() => validatePrepared(shim, manifest.inputs), /version-bootstrap shims/);
});

test('the actual offline launcher refuses unsanitized reentry before executing its target', () => {
  for (const extra of [{ CARGO_NET_OFFLINE: 'false' }, { CLOUDFLARE_API_TOKEN: 'inert-gate-fixture' }]) {
    const result = spawnSync('/bin/bash', [join(root, 'scripts/offline-gates.sh'),
      'node', '--eval', 'console.log("TARGET_SHOULD_NOT_RUN")'], {
      cwd: root, env: { ...process.env, ...extra, BIF_OFFLINE_GATES: '1' }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, 'Invalid offline environment must fail the real launcher');
    assert.ok(!result.stdout.includes('TARGET_SHOULD_NOT_RUN'));
  }
});

test('the actual offline launcher rejects absent invalid and matching parent namespace identities before executing its target', () => {
  for (const parentNamespace of [undefined, '', 'not-a-network-namespace', readlinkSync('/proc/self/ns/net')]) {
    const result = spawnSync('/bin/bash', [join(root, 'scripts/offline-gates.sh'),
      'node', '--eval', 'console.log("TARGET_SHOULD_NOT_RUN")'], {
      cwd: root, env: { ...process.env, BIF_OFFLINE_GATES: '1', BIF_OFFLINE_PARENT_NET_NS: parentNamespace }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, 'The real launcher must reject an invalid parent namespace identity');
    assert.match(result.stderr, /captured parent network namespace identity|outside the initiating network namespace/);
    assert.ok(!result.stdout.includes('TARGET_SHOULD_NOT_RUN'));
  }
});

test('actual pinned pnpm package reentry preserves explicit bootstrap disablement and executes its target', async () => {
  const manifest = JSON.parse(readFileSync(join(root, 'target/gate-cache/prepared.json'), 'utf8')) as {
    tools: { pnpm: string };
  };
  const directory = await mkdtemp(join(tmpdir(), 'gate-pnpm-reentry-'));
  try {
    const target = "if (process.env.npm_config_manage_package_manager_versions !== 'false') throw new Error('bootstrap disablement was not normalized'); console.log('SAFE_REENTRY_TARGET')";
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: 'gate-pnpm-reentry', private: true, packageManager: 'pnpm@10.33.1',
      scripts: { probe: ['/bin/bash', JSON.stringify(join(root, 'scripts/offline-gates.sh')),
        JSON.stringify(process.execPath), '--eval', JSON.stringify(target)].join(' ') },
    }));
    const result = spawnSync(manifest.tools.pnpm, ['--dir', directory, 'run', 'probe'], {
      cwd: root, env: { ...process.env, npm_config_manage_package_manager_versions: 'false' }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split('\n').filter(line => line === 'SAFE_REENTRY_TARGET').length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('actual wrapper rejects absent and truthy bootstrap overrides before executing its target', () => {
  for (const value of [undefined, 'true', '1']) {
    const result = spawnSync('/bin/bash', [join(root, 'scripts/offline-gates.sh'),
      'node', '--eval', 'console.log("TARGET_SHOULD_NOT_RUN")'], {
      cwd: root, env: { ...process.env, BIF_OFFLINE_GATES: '1', npm_config_manage_package_manager_versions: value }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Package-manager version bootstrap must be explicitly disabled/);
    assert.ok(!result.stdout.includes('TARGET_SHOULD_NOT_RUN'));
  }
});

