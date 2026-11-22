import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { digest } from '../../worker-api/scripts/bundle.ts';
import { root } from '../../worker-api/scripts/profile.ts';
import { assertWorkerTools } from '../../worker-api/scripts/tools.ts';
import { collectArtifactInputs, currentSourceCommit, jsonBytes, readClosedTree } from '../artifact-inputs.ts';
import { fixtureProject } from './artifact-fixture.ts';

test('Artifact_Check actual CLI: independent actual inputs pass, each isolated mutation rejects, restored bytes pass', async t => {
  assertWorkerTools();
  const owned = await mkdtemp(join(tmpdir(), 'bif-artifact-gate-'));
  try {
    const project = await fixtureProject(owned, true);
    const identity = { sourceCommit: await currentSourceCommit(project), runId: '62001', runAttempt: '1' };
    // Independent expectation is derived before preparation from actual committed
    // sources, metadata, tool/schema pins and built inputs, never from public claims.
    const expectedInputs = await collectArtifactInputs(project, identity);
    const expectedBytes = jsonBytes(expectedInputs);
    const envelopeSHA = digest(expectedBytes);
    const transport = join(owned, 'transport');
    const tree = join(transport, 'tree');
    const context = ['--source-commit', identity.sourceCommit, '--run-id', identity.runId, '--run-attempt', identity.runAttempt];
    const prepareArgs = [join(project, 'scripts/stage-artifact.ts'), '--prepare', '--output', transport, ...context];
    const checkArgs = [join(project, 'scripts/check-artifact.ts'), '--input', transport, ...context, '--envelope-sha', envelopeSHA];
    function cli(args: string[]) {
      const result = spawnSync(process.execPath, args, { cwd: project, encoding: 'utf8', env: process.env, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.error, undefined, 'Actual artifact CLI must launch');
      assert.equal(result.signal, null, 'Actual artifact CLI must terminate normally');
      return result;
    }
    function pass(): void {
      const result = cli(checkArgs);
      assert.equal(result.status, 0, 'Actual check CLI must accept independently pinned restored inputs');
      assert.deepEqual(JSON.parse(result.stdout), { identity, envelopeSHA, checked: true });
    }
    async function unchangedEnvelope(): Promise<void> {
      assert.ok((await readFile(join(transport, 'inputs.json'))).equals(expectedBytes), 'Mutation must not change the independent private manifest');
    }
    const prepared = cli(prepareArgs);
    assert.equal(prepared.status, 0, 'Actual preparation CLI must accept the actual checked-input fixture');
    assert.deepEqual(JSON.parse(prepared.stdout), { identity, envelopeSHA });
    await unchangedEnvelope();
    pass();
    t.diagnostic(`prepare command: ${process.execPath} ${prepareArgs.join(' ')}`);
    t.diagnostic(`check command: ${process.execPath} ${checkArgs.join(' ')}`);
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
    await t.test('same actual check CLI consumes source-only transport without rebuild or install', async () => {
      await rm(join(project, 'target/decision-worker'), { recursive: true });
      await rm(join(project, 'target/wasm-pkg'), { recursive: true });
      await rm(join(project, 'web/dist'), { recursive: true });
      pass();
      await unchangedEnvelope();
      t.diagnostic('source-only consumer: actual check CLI passes with source build outputs absent; no rebuild/install');
    });
  } finally { await rm(owned, { recursive: true, force: true }); }
});
