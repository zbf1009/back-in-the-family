import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { digest } from '../../worker-api/scripts/bundle.ts';
import { root } from '../../worker-api/scripts/profile.ts';
import { assertWorkerTools } from '../../worker-api/scripts/tools.ts';
import { jsonBytes, prepareArtifact, readClosedTree } from '../artifact-inputs.ts';
import type { CheckedInputs } from '../artifact-inputs.ts';
import { consumerCLI, independentArtifact } from './artifact-fixture.ts';

type MutableInputs = Omit<CheckedInputs, 'licenseClosure'> & {
  licenseClosure: { sourcePins: Record<string, string>; entries: { id: string; version: string; sourcePin: string; text: string; sha256: string }[] };
};
function mutableFixtureInputs(inputs: CheckedInputs): MutableInputs {
  const copy = structuredClone(inputs);
  return { ...copy, licenseClosure: {
    sourcePins: { ...copy.licenseClosure.sourcePins },
    entries: copy.licenseClosure.entries.map(entry => ({ ...entry })),
  } };
}

test('Artifact_Check actual CLI: independent actual inputs pass, each isolated mutation rejects, restored bytes pass', async t => {
  assertWorkerTools();
  const owned = await mkdtemp(join(tmpdir(), 'bif-artifact-gate-'));
  try {
    const fixture = await independentArtifact(owned);
    const { project, transport, inputs: expectedInputs, envelopeBytes: expectedBytes } = fixture;
    const { identity, envelopeSHA } = fixture.expected;
    const tree = join(transport, 'tree');
    const context = ['--source-commit', identity.sourceCommit, '--run-id', identity.runId, '--run-attempt', identity.runAttempt];
    const checkArgs = [join(project, 'scripts/check-artifact.ts'), '--input', transport, ...context, '--envelope-sha', envelopeSHA];
    function cli(args: string[]) { return consumerCLI(project, args); }
    function pass(): void {
      const result = cli(checkArgs);
      assert.equal(result.status, 0, 'Actual check CLI must accept independently pinned restored inputs');
      assert.deepEqual(JSON.parse(result.stdout), { identity, envelopeSHA, checked: true });
    }
    async function unchangedEnvelope(): Promise<void> {
      assert.ok((await readFile(join(transport, 'inputs.json'))).equals(expectedBytes), 'Mutation must not change the independent private manifest');
    }
    assert.equal(digest(expectedBytes), envelopeSHA, 'Only the producer prepare return supplies the external trust anchor');
    await unchangedEnvelope();
    pass();
    t.diagnostic('check/stage commands execute copied consumer CLI in env-i + fresh bwrap user/net/mount namespaces; only loopback is available');
    // Byte identities come from the current checked root outputs, not toy JS/WASM.
    assert.equal(digest(await readFile(join(tree, 'worker.js'))), digest(await readFile(join(root, 'target/decision-worker/worker.js'))));
    assert.deepEqual(expectedInputs.assets, (await readClosedTree(join(root, 'web/dist'))).map(file => ({ path: file.path, size: file.bytes.byteLength, sha256: digest(file.bytes) })));
    assert.equal(expectedInputs.wasm.sha256, digest(await readFile(join(root, 'target/wasm-pkg/sim_wasm_bg.wasm'))));
    assert.ok(!(await readClosedTree(tree)).some(file => /(?:^|\/)(?:node_modules|gate-cache|inputs\.json)(?:\/|$)/.test(file.path)));

    async function boundary(name: string, reason: RegExp, mutate: () => Promise<void>, restore: () => Promise<void>, redactedValue?: string): Promise<void> {
      await t.test(name, async () => {
        pass();
        try {
          await mutate();
          const result = cli(checkArgs);
          assert.equal(result.status, 1, 'Actual check CLI must reject a single isolated mutation');
          if (redactedValue !== undefined) assert.ok(!`${result.stdout}${result.stderr}`.includes(redactedValue), 'CLI must never disclose inert secret-looking test values');
          assert.ok(reason.test(result.stderr), `Actual CLI must reject at ${reason.source}, not an incidental digest mismatch`);
          assert.ok(!/independently expected SHA/.test(result.stderr), 'Public mutation must not modify or self-trust the private expected manifest');
        } finally {
          await restore();
          await unchangedEnvelope();
          pass();
        }
        t.diagnostic(`${name}: pass -> rejected mutation -> restored pass; seam=${reason.source}`);
      });
    }
    async function replace(name: string, path: string, replacement: Buffer, reason: RegExp, redactedValue?: string): Promise<void> {
      const target = join(tree, path);
      const original = await readFile(target);
      await boundary(name, reason, () => writeFile(target, replacement), () => writeFile(target, original), redactedValue);
    }
    async function missing(name: string, path: string): Promise<void> {
      const target = join(tree, path);
      const original = await readFile(target);
      await boundary(name, /Public artifact path set differs/, () => rm(target), () => writeFile(target, original));
    }
    async function added(name: string, path: string, reason: RegExp): Promise<void> {
      const target = join(tree, path);
      const parentExists = path.startsWith('dist/');
      await boundary(name, reason, async () => {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, 'inert offline path fixture\n', { flag: 'wx' });
      }, async () => {
        await rm(target, { force: true });
        if (!parentExists && path.includes('/')) await rm(join(tree, path.split('/')[0]!), { recursive: true });
      });
    }
    const worker = join(tree, 'worker.js');
    await missing('missing Worker', 'worker.js');
    for (const [name, path, reason] of [
      ['moved Worker', 'moved-worker.js', /forbidden or unlisted root path/],
      ['Worker inside dist', 'dist/worker.js', /Public artifact path set differs/],
    ] as const) {
      const moved = join(tree, path);
      await boundary(name, reason, () => rename(worker, moved), () => rename(moved, worker));
    }
    const config = JSON.parse(await readFile(join(tree, 'wrangler.jsonc'), 'utf8')) as Record<string, unknown>;
    for (const [name, mutate] of [
      ['missing AI binding', (copy: Record<string, unknown>) => { delete copy.ai; }],
      ['missing exact /api Worker-first route', (copy: Record<string, unknown>) => { (copy.assets as Record<string, unknown>).run_worker_first = ['/api/*']; }],
      ['missing wildcard /api/* Worker-first route', (copy: Record<string, unknown>) => { (copy.assets as Record<string, unknown>).run_worker_first = ['/api']; }],
      ['broken SPA fallback', (copy: Record<string, unknown>) => { (copy.assets as Record<string, unknown>).not_found_handling = '404-page'; }],
    ] as const) {
      const copy = structuredClone(config);
      mutate(copy);
      await replace(name, 'wrangler.jsonc', jsonBytes(copy), /Artifact config must match the exact disabled source-aligned API\/SPA contract/);
    }
    await missing('missing NOTICE', 'NOTICE');
    const notice = await readFile(join(tree, 'NOTICE'), 'utf8');
    for (const [name, pattern, replacement] of [
      ['missing own-account statement', /own account/g, 'account'],
      ['missing shared-quota statement', /shared\s+allocation\./, 'allocation.'],
      ['missing Free-exhaustion statement', /Free quota may be exhausted;/, 'Free quota is available;'],
      ['missing Paid-charges statement', /Paid usage may incur charges\./, 'Paid usage is available.'],
      ['missing Rules_Default fallback statement', /Rules_Default fallback keeps gameplay working/, 'Rules are available'],
    ] as const) {
      const changed = notice.replace(pattern, replacement);
      assert.notEqual(changed, notice, 'Actual NOTICE fixture must contain the boundary being removed');
      await replace(name, 'NOTICE', Buffer.from(changed), /NOTICE is missing required account\/quota\/default\/policy statements/);
    }
    for (const [name, path] of [
      ['unlisted source', 'src/index.ts'], ['Rust source in public tree', 'crates/sim-core/src/lib.rs'],
      ['eval/probe in public tree', 'eval/probe/data.json'], ['root env in public tree', 'env'],
      ['secrets in public tree', 'secrets.json'], ['target in public tree', 'target/worker.js'],
      ['node_modules in public tree', 'node_modules/pkg/index.js'], ['CI workflow in public tree', '.github/workflows/deploy.yml'],
    ] as const) await added(name, path, /forbidden or unlisted root path/);
    await added('unlisted media', 'dist/assets/unlisted.png', /Public artifact path set differs/);
    await added('source inside dist', 'dist/assets/source.ts', /Public artifact path set differs/);
    const workerBytes = await readFile(worker);
    const inertValue = 'inert-secret-for-offline-gate-test-12345';
    await replace('inert secret-looking assignment reaches privacy guard', 'worker.js', Buffer.concat([workerBytes, Buffer.from(`\nconst API_KEY = "${inertValue}";\n`)]), /secret-looking assignment \(contents redacted\)/, inertValue);
    await replace('private credential marker reaches privacy guard', 'worker.js', Buffer.concat([workerBytes, Buffer.from('\n// BEGIN PRIVATE KEY\n')]), /forbidden private markers \(contents redacted\)/);
    const savedWorker = join(owned, 'saved-worker.js');
    await boundary('symlink Worker rejects through actual CLI walk', /Artifact symlink is forbidden/, async () => {
      await rename(worker, savedWorker);
      await symlink(savedWorker, worker);
    }, async () => { await rm(worker); await rename(savedWorker, worker); });
    const index = await readFile(join(tree, 'dist/index.html'));
    await replace('encoded traversal rejects through actual CLI reference guard', 'dist/index.html', Buffer.concat([index, Buffer.from('\n<script src="/assets/%2e%2e/worker.js"></script>\n')]), /Traversal in artifact reference is forbidden/);
    await replace('missing referenced asset rejects through actual CLI reference guard', 'dist/index.html', Buffer.concat([index, Buffer.from('\n<script src="/assets/missing.js"></script>\n')]), /Referenced artifact asset is missing/);
    const wasmPath = `dist/${expectedInputs.assets.find(file => file.path.endsWith('.wasm'))!.path}`;
    const wasm = await readFile(join(tree, wasmPath));
    await replace('modified actual WASM rejects at checked module identity', wasmPath, Buffer.concat([wasm, Buffer.from([0])]), /WASM must be the exact checked build module/);
    // Semantically valid edits still cannot evade independent exact metadata pins.
    for (const path of ['NOTICE', 'wrangler.jsonc', 'package.json', 'pnpm-lock.yaml']) {
      const bytes = await readFile(join(tree, path));
      await replace(`semantically valid ${path} edit rejects at independent metadata digest`, path, Buffer.concat([bytes, Buffer.from('\n')]), /Public metadata differs from independent checked digest/);
    }
    const sourcePath = join(project, 'mise.toml');
    const sourceBytes = await readFile(sourcePath);
    await boundary('uncommitted actual source edit rejects committed provenance', /Checked source bytes differ from source commit/, () => writeFile(sourcePath, Buffer.concat([sourceBytes, Buffer.from('\n# inert uncommitted source change\n')])), () => writeFile(sourcePath, sourceBytes));
    await t.test('private envelope cannot replace the independent expected digest', async () => {
      pass();
      const path = join(transport, 'inputs.json');
      try {
        const changed = structuredClone(expectedInputs);
        changed.sourceDigests['mise.toml'] = '0'.repeat(64);
        await writeFile(path, jsonBytes(changed));
        const result = cli(checkArgs);
        assert.equal(result.status, 1);
        assert.ok(/Private envelope differs from independently expected SHA/.test(result.stderr), 'CLI must reject private self-claims against the unchanged external expectation');
      } finally { await writeFile(path, expectedBytes); await unchangedEnvelope(); pass(); }
      t.diagnostic('private envelope: pass -> rejected mutation -> restored pass; seam=independently expected SHA');
    });
    // Malformed fixtures get an external digest before invocation. This is
    // distinct from tampering a successful producer's unchanged trust anchor.
    const catalogIDs = ['arrayvec', 'blake3', 'cfg-if', 'constant_time_eq', 'memchr', 'project', 'rust-llvm-exception',
      'rust-unicode', 'serde', 'svelte', 'unicode-ident', 'wasm-bindgen', 'wasm-bindgen-shared'];
    assert.deepEqual(expectedInputs.licenseClosure.entries.map(entry => entry.id), catalogIDs);
    assert.deepEqual(Object.keys(expectedInputs.licenseClosure.sourcePins).sort(), ['Cargo.lock', 'LICENSE', 'rust-toolchain.toml', 'web/package.json', 'web/pnpm-lock.yaml']);
    for (const [path, sha] of Object.entries(expectedInputs.licenseClosure.sourcePins)) assert.equal(sha, expectedInputs.sourceDigests[path]);
    const svelte = expectedInputs.licenseClosure.entries.find(entry => entry.id === 'svelte')!;
    assert.equal(svelte.version, '5.57.3');
    assert.equal(svelte.sourcePin, 'npm:svelte@5.57.3/LICENSE.md');
    await replace('full root Apache LICENSE bytes remain mandatory in the independent consumer', 'LICENSE', Buffer.from('Apache License Version 2.0\n'), /Project LICENSE must be copied intact/);
    for (const entry of expectedInputs.licenseClosure.entries) {
      if (entry.id === 'project') continue;
      let terms = entry.text.trim();
      if (entry.id === 'blake3') terms = terms.slice(terms.indexOf("Copyright 2019 Jack O'Connor and Samuel Neves"));
      else if (!['svelte', 'rust-unicode', 'rust-llvm-exception'].includes(entry.id)) {
        const permission = terms.indexOf('Permission is hereby granted');
        if (permission > 0) terms = terms.slice(0, permission).trim();
      }
      const pattern = terms.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const changed = notice.replace(new RegExp(pattern, 'g'), 'Removed complete license attribution for offline test');
      assert.notEqual(changed, notice, `Actual public NOTICE must include the prepared ${entry.id} terms`);
      await replace(`public NOTICE preserves complete ${entry.id} terms and distinct attribution`, 'NOTICE', Buffer.from(changed), /NOTICE must preserve|LICENSE and NOTICE must preserve/);
    }
    await t.test('consumer API requires external SHA before any absent transport/source/license lookup', async () => {
      const result = cli([join(project, 'scripts/tests/artifact-consumer.ts'), 'verify', JSON.stringify({
        projectRoot: project, inputDir: join(owned, 'missing-api-transport'), expected: { identity },
      })]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Independent envelope SHA is required/);
      assert.doesNotMatch(result.stderr, /ENOENT|Svelte|rustc|Cargo|build/i);
    });
    await t.test('prepare CLI cannot accept a consumer-supplied envelope SHA or collect missing producer inputs', async () => {
      const result = cli([join(project, 'scripts/stage-artifact.ts'), '--prepare', '--output', join(owned, 'must-not-prepare'), '--envelope-sha', envelopeSHA]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Preparation cannot accept a supplied envelope digest/);
      assert.doesNotMatch(result.stderr, /ENOENT|rustc|Svelte|Cargo|build/i);
    });
    async function malformed(name: string, mutate: (value: MutableInputs) => void, reason: RegExp): Promise<void> {
      await t.test(name, async () => {
        const changed = mutableFixtureInputs(expectedInputs);
        mutate(changed);
        const bytes = jsonBytes(changed);
        const independentlyPinnedMalformedSHA = digest(bytes);
        assert.notEqual(independentlyPinnedMalformedSHA, envelopeSHA);
        const args = [...checkArgs.slice(0, -1), independentlyPinnedMalformedSHA];
        try {
          await writeFile(join(transport, 'inputs.json'), bytes);
          const result = cli(args);
          assert.equal(result.status, 1, 'Independently authenticated malformed closure must reject');
          assert.match(result.stderr, reason, 'The intended schema/text boundary must run');
          assert.doesNotMatch(result.stderr, /independently expected SHA/, 'Malformed fixture is externally pinned, not a digest-mismatch test');
        } finally { await writeFile(join(transport, 'inputs.json'), expectedBytes); }
      });
    }
    await malformed('null mandatory closure rejects', value => { value.licenseClosure = null as unknown as MutableInputs['licenseClosure']; }, /License closure is required/);
    await malformed('extra closure field rejects', value => { Object.assign(value.licenseClosure, { unexpected: true }); }, /License closure fields are closed/);
    await malformed('missing catalog ID rejects', value => { value.licenseClosure.entries.pop(); }, /License catalog IDs must be exact, sorted and unique/);
    await malformed('extra catalog ID rejects', value => { value.licenseClosure.entries.push({ ...value.licenseClosure.entries[0]!, id: 'unlisted-runtime' }); }, /License catalog version or source pin differs/);
    await malformed('duplicate catalog ID rejects', value => { value.licenseClosure.entries.push({ ...value.licenseClosure.entries[0]! }); }, /License catalog IDs must be exact, sorted and unique/);
    await malformed('unsorted fixed IDs reject', value => { value.licenseClosure.entries.reverse(); }, /License catalog IDs must be exact, sorted and unique/);
    await malformed('extra license entry field rejects', value => { Object.assign(value.licenseClosure.entries[0]!, { unexpected: true }); }, /License entry fields are closed/);
    await malformed('missing required license entry field rejects', value => { delete (value.licenseClosure.entries[0] as Partial<MutableInputs['licenseClosure']['entries'][number]>).version; }, /License entry fields are closed/);
    await malformed('empty catalog rejects', value => { value.licenseClosure.entries = []; }, /License catalog IDs must be exact, sorted and unique/);
    await malformed('wrong envelope version rejects', value => { value.version = 2 as unknown as 1; }, /Unsupported checked envelope version/);
    await malformed('wrong runtime version rejects', value => { value.licenseClosure.entries.find(entry => entry.id === 'svelte')!.version = '5.57.4'; }, /License catalog version or source pin differs/);
    await malformed('wrong runtime logical source pin rejects', value => { value.licenseClosure.entries.find(entry => entry.id === 'svelte')!.sourcePin = 'npm:svelte@5.57.3/README.md'; }, /License catalog version or source pin differs/);
    await malformed('wrong project source pin rejects', value => { value.licenseClosure.entries.find(entry => entry.id === 'project')!.sourcePin = `git:${'0'.repeat(40)}:LICENSE`; }, /Project license source identity differs/);
    await malformed('wrong project version rejects', value => { value.licenseClosure.entries.find(entry => entry.id === 'project')!.version = '1'; }, /Project license source identity differs/);
    await malformed('missing one of exact five source pins rejects', value => { delete value.licenseClosure.sourcePins['Cargo.lock']; }, /License source pin fields are closed/);
    await malformed('extra source pin rejects', value => { value.licenseClosure.sourcePins['mise.toml'] = value.sourceDigests['mise.toml']!; }, /License source pin fields are closed/);
    await malformed('source pin not equal to checked digest rejects', value => { value.licenseClosure.sourcePins['Cargo.lock'] = '0'.repeat(64); }, /License source pins differ from checked source digests/);
    await malformed('license raw text SHA mismatch rejects', value => { value.licenseClosure.entries[0]!.sha256 = '0'.repeat(64); }, /License text differs from its raw SHA256/);
    await malformed('empty license text rejects', value => { value.licenseClosure.entries[0]!.text = ''; value.licenseClosure.entries[0]!.sha256 = digest(Buffer.alloc(0)); }, /License text must be complete nonempty UTF-8/);
    for (const [name, text, reason] of [
      ['unpaired high surrogate', '\ud800', /License text contains invalid Unicode/],
      ['unpaired low surrogate', '\udfff', /License text contains invalid Unicode/],
      ['lossy replacement text', '\ufffd', /License text differs from the complete pinned runtime source/],
      ['incomplete but internally rehashed text', 'Permission is hereby granted', /License text differs from the complete pinned runtime source/],
    ] as const) {
      await malformed(`${name} rejects through authenticated closure`, value => {
        value.licenseClosure.entries[0]!.text = text;
        value.licenseClosure.entries[0]!.sha256 = digest(Buffer.from(text, 'utf8'));
      }, reason);
    }
    await malformed('truncated actual source text rejects despite recomputed inner SHA', value => {
      const entry = value.licenseClosure.entries.find(entry => entry.id === 'svelte')!;
      entry.text = entry.text.slice(0, -16); entry.sha256 = digest(Buffer.from(entry.text, 'utf8'));
    }, /License text differs from the complete pinned runtime source/);
    await t.test('invalid raw UTF-8 in externally pinned envelope rejects lossless decoding', async () => {
      const marker = Buffer.from('Apache');
      const position = expectedBytes.indexOf(marker);
      assert.ok(position >= 0);
      const bytes = Buffer.from(expectedBytes); bytes[position] = 0xff;
      const externallyPinnedSHA = digest(bytes);
      try {
        await writeFile(join(transport, 'inputs.json'), bytes);
        const result = cli([...checkArgs.slice(0, -1), externallyPinnedSHA]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Private envelope JSON is invalid/);
        assert.doesNotMatch(result.stderr, /independently expected SHA/);
      } finally { await writeFile(join(transport, 'inputs.json'), expectedBytes); }
    });
    for (const field of ['sourceCommit', 'runId', 'runAttempt'] as const) {
      await t.test(`wrong trusted ${field} rejects before malformed closure`, async () => {
        const changed = mutableFixtureInputs(expectedInputs);
        delete (changed as Partial<MutableInputs>).licenseClosure;
        const bytes = jsonBytes(changed);
        const malformedSHA = digest(bytes);
        const wrong = { ...identity, [field]: field === 'sourceCommit' ? '0'.repeat(40) : '9' };
        try {
          await writeFile(join(transport, 'inputs.json'), bytes);
          const result = cli([join(project, 'scripts/check-artifact.ts'), '--input', transport,
            '--source-commit', wrong.sourceCommit, '--run-id', wrong.runId, '--run-attempt', wrong.runAttempt, '--envelope-sha', malformedSHA]);
          assert.equal(result.status, 1);
          assert.match(result.stderr, /release identity differs from trusted context/);
          assert.doesNotMatch(result.stderr, /closure|fields are closed|license text/i);
        } finally { await writeFile(join(transport, 'inputs.json'), expectedBytes); }
      });
    }
    await t.test('tampered license text and rehashed entire envelope cannot replace unchanged external SHA', async () => {
      const changed = mutableFixtureInputs(expectedInputs);
      const entry = changed.licenseClosure.entries.find(entry => entry.id === 'svelte')!;
      entry.text = entry.text.slice(0, -16); entry.sha256 = digest(Buffer.from(entry.text, 'utf8'));
      const completeRehashedEnvelope = jsonBytes(changed);
      assert.notEqual(digest(completeRehashedEnvelope), envelopeSHA);
      try {
        await writeFile(join(transport, 'inputs.json'), completeRehashedEnvelope);
        const result = cli(checkArgs);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Private envelope differs from independently expected SHA/);
        assert.doesNotMatch(result.stderr, /License text|License catalog/);
      } finally { await writeFile(join(transport, 'inputs.json'), expectedBytes); }
    });
    await t.test('tampered closure pins and rehashed entire JSON cannot replace unchanged external SHA', async () => {
      const changed = mutableFixtureInputs(expectedInputs);
      changed.licenseClosure.sourcePins['Cargo.lock'] = '0'.repeat(64);
      const rehashedEnvelope = jsonBytes(changed);
      assert.notEqual(digest(rehashedEnvelope), envelopeSHA);
      try {
        await writeFile(join(transport, 'inputs.json'), rehashedEnvelope);
        const result = cli(checkArgs);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Private envelope differs from independently expected SHA/);
        assert.doesNotMatch(result.stderr, /License source pin/);
      } finally { await writeFile(join(transport, 'inputs.json'), expectedBytes); }
    });
    for (const script of ['check-artifact.ts', 'stage-artifact.ts']) {
      for (const explicitIdentity of [false, true]) {
        for (const supplied of [undefined, 'not-a-sha']) {
          await t.test(`${script} rejects ${supplied === undefined ? 'missing' : 'invalid'} external SHA with ${explicitIdentity ? 'explicit' : 'local default'} identity before absent transport/build lookup`, async () => {
            const args = [join(project, 'scripts', script), '--input', join(owned, 'missing-transport'),
              ...(script === 'stage-artifact.ts' ? ['--output', join(owned, 'must-not-stage')] : []), ...(explicitIdentity ? context : []),
              ...(supplied === undefined ? [] : ['--envelope-sha', supplied])];
            const result = cli(args);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /Independent envelope SHA is required/);
            assert.doesNotMatch(result.stderr, /ENOENT|rustc|Svelte|Cargo|build/i);
          });
        }
      }
    }
    await unchangedEnvelope();
    pass();
    await t.test('different Node-only source checkout checks and stages immutable transport without producer license/build inputs', async () => {
      const output = join(owned, 'public-node-only');
      const result = cli([join(project, 'scripts/stage-artifact.ts'), '--input', transport, '--output', output, ...context, '--envelope-sha', envelopeSHA]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { identity, envelopeSHA });
      assert.deepEqual(await readClosedTree(output), await readClosedTree(tree));
      assert.ok(!(await readClosedTree(output)).some(file => file.path === 'inputs.json' || /licenseClosure/.test(file.path)));
      pass();
      await unchangedEnvelope();
    });
    await t.test('local default identity checks and stages with independently captured producer SHA', async () => {
      const localIdentity = { ...identity, runId: 'local', runAttempt: '1' };
      const localTransport = join(owned, 'local-transport');
      const externalSHA = await prepareArtifact(fixture.producer, localTransport, localIdentity);
      const checked = cli([join(project, 'scripts/check-artifact.ts'), '--input', localTransport, '--envelope-sha', externalSHA]);
      assert.equal(checked.status, 0, checked.stderr);
      assert.deepEqual(JSON.parse(checked.stdout), { identity: localIdentity, envelopeSHA: externalSHA, checked: true });
      const output = join(owned, 'local-public');
      const staged = cli([join(project, 'scripts/stage-artifact.ts'), '--input', localTransport, '--output', output, '--envelope-sha', externalSHA]);
      assert.equal(staged.status, 0, staged.stderr);
      assert.deepEqual(JSON.parse(staged.stdout), { identity: localIdentity, envelopeSHA: externalSHA });
      assert.deepEqual(await readClosedTree(output), await readClosedTree(join(localTransport, 'tree')));
      assert.equal(digest(await readFile(join(localTransport, 'inputs.json'))), externalSHA);
    });
  } finally { await rm(owned, { recursive: true, force: true }); }
});

test('Node-only consumer rejects an authenticated envelope missing required license closure', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'bif-missing-closure-'));
  try {
    const fixture = await independentArtifact(owned);
    const { identity, envelopeSHA } = fixture.expected;
    const args = [join(fixture.project, 'scripts/check-artifact.ts'), '--input', fixture.transport,
      '--source-commit', identity.sourceCommit, '--run-id', identity.runId, '--run-attempt', identity.runAttempt, '--envelope-sha', envelopeSHA];
    const baseline = consumerCLI(fixture.project, args);
    assert.equal(baseline.status, 0, baseline.stderr);
    assert.deepEqual(JSON.parse(baseline.stdout), { identity, envelopeSHA, checked: true });
    const oldInputs: Partial<MutableInputs> = mutableFixtureInputs(fixture.inputs);
    delete oldInputs.licenseClosure;
    assert.deepEqual({ ...oldInputs, licenseClosure: fixture.inputs.licenseClosure }, fixture.inputs, 'Only the required closure is removed from the valid producer envelope');
    const legacyBytes = jsonBytes(oldInputs);
    const independentlyPinnedLegacySHA = digest(legacyBytes);
    assert.notEqual(independentlyPinnedLegacySHA, envelopeSHA);
    try {
      await writeFile(join(fixture.transport, 'inputs.json'), legacyBytes);
      const rejected = consumerCLI(fixture.project, [...args.slice(0, -1), independentlyPinnedLegacySHA]);
      assert.equal(rejected.status, 1, 'Consumer must reject an externally authenticated envelope lacking its required closure');
      assert.doesNotMatch(rejected.stderr, /independently expected SHA/, 'This exercises required closure validation, not transport authentication failure');
    } finally { await writeFile(join(fixture.transport, 'inputs.json'), fixture.envelopeBytes); }
    const restored = consumerCLI(fixture.project, args);
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout), { identity, envelopeSHA, checked: true });
  } finally { await rm(owned, { recursive: true, force: true }); }
});
