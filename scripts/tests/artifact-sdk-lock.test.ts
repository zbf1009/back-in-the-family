import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type * as YamlTools from '../../web/node_modules/yaml';
import { digest } from '../../worker-api/scripts/bundle.ts';
import { root } from '../../worker-api/scripts/profile.ts';
import { copyBytes, jsonBytes, publicProvenance, readClosedTree } from '../artifact-inputs.ts';
import type { ArtifactExpectation, CheckedInputs } from '../artifact-inputs.ts';
import { selectSdkLock } from '../artifact-sdk-lock.ts';
import { consumerCLI, independentArtifact } from './artifact-fixture.ts';

const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
assert.equal(requireWeb('yaml/package.json').version, '2.8.1');
const yaml = requireWeb('yaml') as typeof YamlTools;
type Entry = Record<string, unknown> & {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  resolution?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
};
type Lock = Record<string, unknown> & {
  importers: Record<string, Entry & { devDependencies: Record<string, { specifier: string; version: string }> }>;
  packages: Record<string, Entry>;
  snapshots: Record<string, Entry>;
};
const wranglerKey = 'wrangler@4.157.0(@types/node@26.6.6)';
const sharpKey = 'sharp@0.35.5(@types/node@26.6.6)';
const presetKey = '@cloudflare/unenv-preset@2.16.2(unenv@2.0.0-rc.24)(workerd@1.20261103.1)';
const workerdKey = 'workerd@1.20261103.1';
const esbuildKey = 'esbuild@0.28.2';
const linuxWorkerdKey = '@cloudflare/workerd-linux-64@1.20261103.1';
const linuxSharpKey = '@img/sharp-linux-x64@0.35.5';
const linuxVipsKey = '@img/sharp-libvips-linux-x64@1.3.4';
const fixtureGitEnv = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

async function sourceLock(): Promise<{ healthyText: string; healthy: Lock; packageText: string }> {
  const healthyText = await readFile(join(root, 'web/pnpm-lock.yaml'), 'utf8');
  const packageText = await readFile(join(root, 'worker-api/artifact-deploy/package.json'), 'utf8');
  return { healthyText, healthy: yaml.parse(healthyText) as Lock, packageText };
}

test('public SDK selector preserves every platform, exact roots, nested edges and actual optional peers', async () => {
  const { healthyText, healthy, packageText } = await sourceLock();
  const lock = selectSdkLock(healthyText, packageText) as Lock;
  assert.deepEqual(Object.keys(lock.importers), ['.']);
  assert.deepEqual(lock.importers['.']!.devDependencies, {
    '@types/node': { specifier: '26.6.6', version: '26.6.6' },
    wrangler: { specifier: '4.157.0', version: '4.157.0(@types/node@26.6.6)' },
  });
  assert.equal(lock.importers['.']!.dependencies, undefined);
  assert.equal(lock.importers['.']!.optionalDependencies, undefined);
  assert.deepEqual(lock.snapshots[workerdKey]!.optionalDependencies, Object.fromEntries([
    '@cloudflare/workerd-darwin-64', '@cloudflare/workerd-darwin-arm64', '@cloudflare/workerd-linux-64',
    '@cloudflare/workerd-linux-arm64', '@cloudflare/workerd-windows-64',
  ].map(name => [name, '1.20261103.1'])));
  assert.deepEqual(lock.snapshots[esbuildKey]!.optionalDependencies, Object.fromEntries([
    '@esbuild/aix-ppc64', '@esbuild/android-arm', '@esbuild/android-arm64', '@esbuild/android-x64',
    '@esbuild/darwin-arm64', '@esbuild/darwin-x64', '@esbuild/freebsd-arm64', '@esbuild/freebsd-x64',
    '@esbuild/linux-arm', '@esbuild/linux-arm64', '@esbuild/linux-ia32', '@esbuild/linux-loong64',
    '@esbuild/linux-mips64el', '@esbuild/linux-ppc64', '@esbuild/linux-riscv64', '@esbuild/linux-s390x',
    '@esbuild/linux-x64', '@esbuild/netbsd-arm64', '@esbuild/netbsd-x64', '@esbuild/openbsd-arm64',
    '@esbuild/openbsd-x64', '@esbuild/openharmony-arm64', '@esbuild/sunos-x64', '@esbuild/win32-arm64',
    '@esbuild/win32-ia32', '@esbuild/win32-x64',
  ].map(name => [name, '0.28.2'])));
  const sharpOptionals = lock.snapshots[sharpKey]!.optionalDependencies!;
  assert.equal(Object.keys(sharpOptionals).filter(name => name.startsWith('@img/sharp-libvips-')).length, 10);
  assert.equal(Object.keys(sharpOptionals).filter(name => name.startsWith('@img/sharp-') && !name.startsWith('@img/sharp-libvips-')).length, 15);
  for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-arm', 'linux-arm64', 'linux-ppc64', 'linux-riscv64',
    'linux-s390x', 'linux-x64', 'linuxmusl-arm64', 'linuxmusl-x64']) {
    const vips = `@img/sharp-libvips-${platform}`;
    assert.equal(sharpOptionals[vips], '1.3.4');
    assert.equal(lock.snapshots[`@img/sharp-${platform}@0.35.5`]!.optionalDependencies![vips], '1.3.4');
  }
  assert.equal(lock.snapshots[wranglerKey]!.optionalDependencies!.fsevents, '2.3.3');
  assert.deepEqual(lock.packages['fsevents@2.3.3']!.os, ['darwin']);
  assert.deepEqual(lock.snapshots[presetKey]!.dependencies, { unenv: '2.0.0-rc.24' });
  assert.deepEqual(lock.snapshots[presetKey]!.optionalDependencies, { workerd: '1.20261103.1' });
  assert.deepEqual(lock.packages['@cloudflare/unenv-preset@2.16.2']!.peerDependenciesMeta, { workerd: { optional: true } });
  assert.equal(lock.packages['wrangler@4.157.0']!.peerDependenciesMeta!['@cloudflare/workers-types']!.optional, true);
  assert.ok(!Object.keys(lock.packages).some(name => name.startsWith('@cloudflare/workers-types@')));
  assert.ok(!Object.keys(lock.snapshots).some(name => name.startsWith('@cloudflare/workers-types@')));
  assert.deepEqual(lock.snapshots['@cloudflare/kv-asset-handler@0.5.0'], {});
  for (const [key, record] of Object.entries(lock.packages)) assert.deepEqual(record, healthy.packages[key]);
  for (const [key, record] of Object.entries(lock.snapshots)) assert.deepEqual(record, healthy.snapshots[key]);
  for (const key of ['svelte@5.57.3', 'typescript@6.0.3', 'yaml@2.8.1']) assert.equal(lock.packages[key], undefined);
  assert.deepEqual(lock.settings, healthy.settings);
});

test('public selector accepts empty native leaves and registry aliases without merging resolved peer contexts', async () => {
  const { healthy, packageText } = await sourceLock();
  healthy.snapshots[linuxWorkerdKey] = {};
  healthy.snapshots['@esbuild/linux-x64@0.28.2'] = {};
  healthy.snapshots[linuxVipsKey] = {};
  const dependencies = healthy.snapshots[wranglerKey]!.dependencies!;
  delete dependencies['@cloudflare/kv-asset-handler'];
  dependencies['kv-runtime-alias'] = '@cloudflare/kv-asset-handler@0.5.0';
  const unresolvedPreset = '@cloudflare/unenv-preset@2.16.2(unenv@2.0.0-rc.24)';
  healthy.snapshots[unresolvedPreset] = { dependencies: { unenv: '2.0.0-rc.24' } };
  dependencies['unresolved-preset-alias'] = unresolvedPreset;
  healthy.packages['@cloudflare/unenv-preset@2.16.2']!.peerDependencies!['not-installed-native-peer'] = '*';
  healthy.packages['@cloudflare/unenv-preset@2.16.2']!.peerDependenciesMeta!['not-installed-native-peer'] = { optional: true };
  const lock = selectSdkLock(yaml.stringify(healthy), packageText) as Lock;
  for (const key of [linuxWorkerdKey, '@esbuild/linux-x64@0.28.2', linuxVipsKey]) assert.deepEqual(lock.snapshots[key], {});
  assert.equal(lock.snapshots[wranglerKey]!.dependencies!['kv-runtime-alias'], '@cloudflare/kv-asset-handler@0.5.0');
  assert.ok(Object.hasOwn(lock.packages, '@cloudflare/kv-asset-handler@0.5.0'));
  assert.deepEqual(lock.snapshots[unresolvedPreset], { dependencies: { unenv: '2.0.0-rc.24' } });
  assert.deepEqual(lock.snapshots[presetKey]!.optionalDependencies, { workerd: '1.20261103.1' });
  assert.ok(!Object.keys(lock.snapshots).some(key => key.startsWith('not-installed-native-peer@')));
});

/** Commit only the owned fixture's changed deploy metadata; the healthy source stays pristine. */
function committedFixtureLock(project: string, parent: string, bytes: Buffer): string {
  const git = (args: string[], input?: Buffer | string) => execFileSync('/usr/bin/git', ['-C', project, ...args], {
    input, encoding: 'utf8', env: {
      ...fixtureGitEnv,
      GIT_AUTHOR_NAME: 'Artifact Test', GIT_AUTHOR_EMAIL: 'artifact-test@example.invalid',
      GIT_COMMITTER_NAME: 'Artifact Test', GIT_COMMITTER_EMAIL: 'artifact-test@example.invalid',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    },
  }).trim();
  git(['read-tree', parent]);
  const blob = git(['hash-object', '-w', '--stdin'], bytes);
  git(['update-index', '--cacheinfo', `100644,${blob},worker-api/artifact-deploy/pnpm-lock.yaml`]);
  const tree = git(['write-tree']);
  const commit = git(['commit-tree', tree, '-p', parent], 'Independently pinned malformed SDK metadata fixture\n');
  git(['update-ref', 'HEAD', commit]);
  return commit;
}
function restoreFixtureCommit(project: string, commit: string): void {
  for (const args of [['read-tree', commit], ['update-ref', 'HEAD', commit]]) {
    execFileSync('/usr/bin/git', ['-C', project, ...args], { env: fixtureGitEnv });
  }
}
function checkCLI(project: string, transport: string, expected: ArtifactExpectation): void {
  const { identity, envelopeSHA } = expected;
  const result = consumerCLI(project, [join(project, 'scripts/check-artifact.ts'), '--input', transport,
    '--source-commit', identity.sourceCommit, '--run-id', identity.runId, '--run-attempt', identity.runAttempt, '--envelope-sha', envelopeSHA]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { identity, envelopeSHA, checked: true });
}

test('Artifact_Check rejects independently source-committed and externally SHA-pinned malformed SDK graphs then accepts restored inputs', async t => {
  const owned = await mkdtemp(join(tmpdir(), 'bif-sdk-graph-'));
  try {
    const fixture = await independentArtifact(owned, '62002');
    const { project, transport, inputs } = fixture;
    const originalCommit = fixture.expected.identity.sourceCommit;
    const healthyPath = join(project, 'web/pnpm-lock.yaml');
    const healthyBytes = await readFile(healthyPath);
    const sourceMetadataPath = join(project, 'worker-api/artifact-deploy/pnpm-lock.yaml');
    const originalLockBytes = await readFile(sourceMetadataPath);
    const lock = yaml.parse(originalLockBytes.toString('utf8')) as Lock;
    const healthy = yaml.parse(healthyBytes.toString('utf8')) as Lock;
    const baselineTree = await readClosedTree(join(transport, 'tree'));
    checkCLI(project, transport, fixture.expected);
    const cases: readonly (readonly [string, (copy: Lock) => void])[] = [
      ['empty workerd native parent', copy => { copy.snapshots[workerdKey] = {}; }],
      ['empty esbuild native parent', copy => { copy.snapshots[esbuildKey] = {}; }],
      ['empty sharp native parent', copy => { copy.snapshots[sharpKey] = {}; }],
      ['lost workerd optional platform map', copy => { delete copy.snapshots[workerdKey]!.optionalDependencies!['@cloudflare/workerd-linux-arm64']; }],
      ['lost esbuild optional platform map', copy => { delete copy.snapshots[esbuildKey]!.optionalDependencies!['@esbuild/darwin-arm64']; }],
      ['wrong optional dependency map classification', copy => {
        copy.snapshots[workerdKey]!.dependencies = copy.snapshots[workerdKey]!.optionalDependencies;
        delete copy.snapshots[workerdKey]!.optionalDependencies;
      }],
      ['lost sharp platform alternative', copy => { delete copy.snapshots[sharpKey]!.optionalDependencies!['@img/sharp-linuxmusl-x64']; }],
      ['lost nested sharp to libvips edge', copy => { delete copy.snapshots[linuxSharpKey]!.optionalDependencies!['@img/sharp-libvips-linux-x64']; }],
      ['lost sharp wasm nested edge', copy => { delete copy.snapshots['@img/sharp-freebsd-wasm32@0.35.5']!.dependencies!['@img/sharp-wasm32']; }],
      ['missing native package', copy => { delete copy.packages[linuxWorkerdKey]; }],
      ['missing native snapshot', copy => { delete copy.snapshots[linuxWorkerdKey]; }],
      ['missing libvips package', copy => { delete copy.packages[linuxVipsKey]; }],
      ['missing libvips snapshot', copy => { delete copy.snapshots[linuxVipsKey]; }],
      ['wrong native version', copy => { copy.snapshots[workerdKey]!.optionalDependencies!['@cloudflare/workerd-linux-64'] = '1.20261103.2'; }],
      ['wrong integrity', copy => { copy.packages[linuxWorkerdKey]!.resolution!.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`; }],
      ['missing integrity', copy => { delete copy.packages[linuxWorkerdKey]!.resolution!.integrity; }],
      ['wrong native cpu', copy => { copy.packages[linuxWorkerdKey]!.cpu = ['arm64']; }],
      ['wrong native os', copy => { copy.packages[linuxWorkerdKey]!.os = ['darwin']; }],
      ['wrong native libc', copy => { copy.packages[linuxVipsKey]!.libc = ['musl']; }],
      ['lost native optional flag', copy => { delete copy.snapshots[linuxWorkerdKey]!.optional; }],
      ['lost actual optional workerd peer edge', copy => { delete copy.snapshots[presetKey]!.optionalDependencies!.workerd; }],
      ['forced actual optional peer into mandatory map', copy => {
        copy.snapshots[presetKey]!.dependencies!.workerd = '1.20261103.1';
        delete copy.snapshots[presetKey]!.optionalDependencies!.workerd;
      }],
      ['lost actual peer context', copy => {
        const reduced = '@cloudflare/unenv-preset@2.16.2(unenv@2.0.0-rc.24)';
        copy.snapshots[reduced] = copy.snapshots[presetKey]!;
        delete copy.snapshots[presetKey];
        copy.snapshots[wranglerKey]!.dependencies!['@cloudflare/unenv-preset'] = '2.16.2(unenv@2.0.0-rc.24)';
      }],
      ['lost transitive peers', copy => { delete copy.snapshots[wranglerKey]!.transitivePeerDependencies; }],
      ['lost optional peer metadata', copy => { delete copy.packages['@cloudflare/unenv-preset@2.16.2']!.peerDependenciesMeta; }],
      ['changed registry alias', copy => {
        delete copy.snapshots[wranglerKey]!.dependencies!['@cloudflare/kv-asset-handler'];
        copy.snapshots[wranglerKey]!.dependencies!['kv-runtime-alias'] = '@cloudflare/kv-asset-handler@0.5.0';
      }],
      ['missing Wrangler fsevents edge', copy => { delete copy.snapshots[wranglerKey]!.optionalDependencies!.fsevents; }],
      ['wrong native engines', copy => { copy.packages[workerdKey]!.engines = { node: '>=99' }; }],
      ['lost native binary metadata', copy => { delete copy.packages[workerdKey]!.hasBin; }],
      ['changed lock settings', copy => { copy.settings = { autoInstallPeers: false, excludeLinksFromLockfile: false }; }],
      ['wrong exact importer version', copy => { copy.importers['.']!.devDependencies.wrangler!.version = '4.157.1(@types/node@26.6.6)'; }],
      ['extra application records', copy => {
        copy.packages['svelte@5.57.3'] = structuredClone(healthy.packages['svelte@5.57.3']!);
        copy.snapshots['svelte@5.57.3'] = structuredClone(healthy.snapshots['svelte@5.57.3']!);
      }],
      ...['file:../local-sdk', 'link:../local-sdk', 'workspace:*', 'https://example.invalid/sdk.tgz'].map(reference =>
        [`forbidden dependency reference ${reference.split(':')[0]}`, (copy: Lock) => {
          copy.snapshots[wranglerKey]!.dependencies!.workerd = reference;
        }] as const),
    ];
    let index = 0;
    for (const [name, mutate] of cases) {
      await t.test(name, async () => {
        checkCLI(project, transport, fixture.expected);
        const badTransport = join(owned, `bad-sdk-${++index}`);
        await mkdir(badTransport);
        await copyBytes(join(badTransport, 'tree'), baselineTree);
        const copy = structuredClone(lock);
        mutate(copy);
        const badLockBytes = Buffer.from(yaml.stringify(copy));
        assert.notDeepEqual(copy, lock, 'Mutation must change the intended graph record');
        try {
          await writeFile(sourceMetadataPath, badLockBytes);
          const sourceCommit = committedFixtureLock(project, originalCommit, badLockBytes);
          const changed: CheckedInputs = structuredClone(inputs);
          changed.identity = { ...fixture.expected.identity, sourceCommit };
          changed.sourceDigests['worker-api/artifact-deploy/pnpm-lock.yaml'] = digest(badLockBytes);
          changed.metadata['pnpm-lock.yaml'] = digest(badLockBytes);
          changed.licenseClosure = { ...changed.licenseClosure, entries: changed.licenseClosure.entries.map(entry =>
            entry.id === 'project' ? { ...entry, sourcePin: `git:${sourceCommit}:LICENSE` } : entry) };
          const envelopeBytes = jsonBytes(changed);
          const expected = { identity: changed.identity, envelopeSHA: digest(envelopeBytes) };
          await writeFile(join(badTransport, 'tree/pnpm-lock.yaml'), badLockBytes);
          await writeFile(join(badTransport, 'tree/provenance.json'), jsonBytes(publicProvenance(changed)));
          await writeFile(join(badTransport, 'inputs.json'), envelopeBytes);
          assert.equal(changed.sourceDigests['web/pnpm-lock.yaml'], digest(healthyBytes));
          assert.equal(changed.sourceDigests['worker-api/artifact-deploy/pnpm-lock.yaml'], changed.metadata['pnpm-lock.yaml']);
          assert.ok(execFileSync('/usr/bin/git', ['-C', project, 'show', `${sourceCommit}:worker-api/artifact-deploy/pnpm-lock.yaml`], { env: fixtureGitEnv }).equals(badLockBytes));
          assert.ok(execFileSync('/usr/bin/git', ['-C', project, 'show', `${sourceCommit}:web/pnpm-lock.yaml`], { env: fixtureGitEnv }).equals(healthyBytes));
          assert.equal(digest(await readFile(join(badTransport, 'inputs.json'))), expected.envelopeSHA);
          const { identity, envelopeSHA } = expected;
          const result = consumerCLI(project, [join(project, 'scripts/check-artifact.ts'), '--input', badTransport,
            '--source-commit', identity.sourceCommit, '--run-id', identity.runId, '--run-attempt', identity.runAttempt, '--envelope-sha', envelopeSHA]);
          assert.equal(result.status, 1, 'Actual Artifact_Check must reject the independently pinned bad graph');
          assert.match(result.stderr, /SDK lock/, 'Rejection must reach structured SDK graph validation');
          assert.doesNotMatch(result.stderr, /independently expected SHA|Public metadata differs|Healthy SDK lock differs|source commit|source HEAD|License/,
            'Authenticated graph fixture must not reject at an unrelated trust or digest boundary');
        } finally {
          await writeFile(sourceMetadataPath, originalLockBytes);
          restoreFixtureCommit(project, originalCommit);
        }
        assert.ok((await readFile(healthyPath)).equals(healthyBytes));
        assert.ok((await readFile(join(fixture.producer, 'web/pnpm-lock.yaml'))).equals(healthyBytes));
        assert.ok((await readFile(join(transport, 'inputs.json'))).equals(fixture.envelopeBytes));
        checkCLI(project, transport, fixture.expected);
        t.diagnostic(`${name}: good -> graph-rejected independently committed/SHA-pinned fixture -> restored good`);
      });
    }
  } finally { await rm(owned, { recursive: true, force: true }); }
});

test('Artifact_Check authenticates the healthy source digest and committed bytes before graph semantics', async t => {
  const owned = await mkdtemp(join(tmpdir(), 'bif-sdk-source-'));
  try {
    const fixture = await independentArtifact(owned, '62003');
    const { project, transport } = fixture;
    const healthyPath = join(project, 'web/pnpm-lock.yaml');
    const healthyBytes = await readFile(healthyPath);
    const treeLockPath = join(transport, 'tree/pnpm-lock.yaml');
    const treeLockBytes = await readFile(treeLockPath);
    const malformed = yaml.parse(treeLockBytes.toString('utf8')) as Lock;
    malformed.snapshots[workerdKey] = {};
    for (const matchDigest of [false, true]) {
      await t.test(matchDigest ? 'matching envelope source digest cannot replace the committed healthy lock' : 'unchanged external envelope requires the healthy source digest', async () => {
        checkCLI(project, transport, fixture.expected);
        const changedHealthy = Buffer.concat([healthyBytes, Buffer.from('\n# independent uncommitted source mutation\n')]);
        const changed = structuredClone(fixture.inputs);
        if (matchDigest) {
          changed.sourceDigests['web/pnpm-lock.yaml'] = digest(changedHealthy);
          changed.licenseClosure = { ...changed.licenseClosure, sourcePins: {
            ...changed.licenseClosure.sourcePins, 'web/pnpm-lock.yaml': digest(changedHealthy),
          } };
        }
        const envelopeBytes = matchDigest ? jsonBytes(changed) : fixture.envelopeBytes;
        const expectedSHA = matchDigest ? digest(envelopeBytes) : fixture.expected.envelopeSHA;
        try {
          await writeFile(healthyPath, changedHealthy);
          await writeFile(treeLockPath, yaml.stringify(malformed));
          await writeFile(join(transport, 'inputs.json'), envelopeBytes);
          const { identity } = fixture.expected;
          const result = consumerCLI(project, [join(project, 'scripts/check-artifact.ts'), '--input', transport,
            '--source-commit', identity.sourceCommit, '--run-id', identity.runId, '--run-attempt', identity.runAttempt, '--envelope-sha', expectedSHA]);
          assert.equal(result.status, 1);
          assert.match(result.stderr, matchDigest ? /Healthy SDK lock bytes differ from trusted source commit/ : /Healthy SDK lock differs from independently checked source digest/);
          assert.doesNotMatch(result.stderr, /SDK lock .*native|SDK lock missing|independently expected SHA/);
        } finally {
          await writeFile(healthyPath, healthyBytes);
          await writeFile(treeLockPath, treeLockBytes);
          await writeFile(join(transport, 'inputs.json'), fixture.envelopeBytes);
        }
        checkCLI(project, transport, fixture.expected);
        t.diagnostic(`healthy source ${matchDigest ? 'commit' : 'digest'}: good -> source-rejected mutation before malformed graph -> restored good`);
      });
    }
  } finally { await rm(owned, { recursive: true, force: true }); }
});
