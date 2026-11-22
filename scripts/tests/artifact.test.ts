import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { root } from '../../worker-api/scripts/profile.ts';
import { digest } from '../../worker-api/scripts/bundle.ts';
import { METADATA_INPUT_PATHS, SOURCE_INPUT_DIRECTORIES, SOURCE_INPUT_PATHS, assertPrivateContent,
  collectArtifactInputs, copyBytes, currentSourceCommit, jsonBytes, prepareArtifact, readClosedTree,
  safeRelativePath, validateCheckedInputs, verifyArtifactInputs } from '../artifact-inputs.ts';
import type { ArtifactExpectation, CheckedInputs, ReleaseIdentity } from '../artifact-inputs.ts';
import { checkArtifact, checkReferences, validateNotice } from '../check-artifact.ts';
import { stageArtifact } from '../stage-artifact.ts';

async function fixtureProject(parent: string): Promise<string> {
  const project = join(parent, 'source');
  await mkdir(project);
  const paths = [...new Set([...SOURCE_INPUT_PATHS, ...Object.values(METADATA_INPUT_PATHS), 'README.md',
    'target/decision-worker/worker.js', 'target/decision-worker/build.json', 'target/wasm-pkg/sim_wasm_bg.wasm'])];
  for (const path of paths) {
    await mkdir(dirname(join(project, path)), { recursive: true });
    await writeFile(join(project, path), await readFile(join(root, path)), { flag: 'wx' });
  }
  for (const directory of [...SOURCE_INPUT_DIRECTORIES, 'web/dist']) {
    await mkdir(join(project, directory), { recursive: true });
    await copyBytes(join(project, directory), await readClosedTree(join(root, directory)));
  }
  // Only explicitly owned disposable source refs; no main/remote operations.
  const files = await readClosedTree(project);
  execFileSync('git', ['init', '--quiet', '--initial-branch=fixture-source', project]);
  const pathsInput = files.map(file => file.path).join('\n') + '\n';
  const hashes = execFileSync('git', ['-C', project, 'hash-object', '-w', '--stdin-paths'], { input: pathsInput, encoding: 'utf8' }).trim().split('\n');
  const index = files.map((file, index) => `100644 ${hashes[index]}\t${file.path}`).join('\n') + '\n';
  execFileSync('git', ['-C', project, 'update-index', '--index-info'], { input: index });
  const tree = execFileSync('git', ['-C', project, 'write-tree'], { encoding: 'utf8' }).trim();
  const sha = execFileSync('git', ['-C', project, 'commit-tree', tree], { input: 'Actual checked-input fixture\n', encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Artifact Test', GIT_AUTHOR_EMAIL: 'artifact-test@example.invalid',
      GIT_COMMITTER_NAME: 'Artifact Test', GIT_COMMITTER_EMAIL: 'artifact-test@example.invalid',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' } }).trim();
  execFileSync('git', ['-C', project, 'update-ref', 'refs/heads/fixture-source', sha]);
  return project;
}

test('full actual checked inputs survive transport and stage; every uncertain boundary rejects then restores', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'bif-artifact-'));
  try {
    const project = await fixtureProject(parent);
    const identity: ReleaseIdentity = { sourceCommit: await currentSourceCommit(project), runId: '71', runAttempt: '2' };
    const transport = join(parent, 'transport');
    const envelopeSHA = await prepareArtifact(project, transport, identity);
    const expected: ArtifactExpectation = { identity, envelopeSHA };
    const inputs = await verifyArtifactInputs(project, transport, expected);
    assert.equal(envelopeSHA, digest(await readFile(join(transport, 'inputs.json'))));
    assert.equal(inputs.assets.length, (await readClosedTree(join(root, 'web/dist'))).length);
    assert.deepEqual(inputs, await collectArtifactInputs(project, identity));
    const stage = join(parent, 'public');
    assert.deepEqual(await stageArtifact(project, transport, stage, expected), inputs);
    await checkArtifact(project, stage, inputs, identity);
    assert.ok(!(await readClosedTree(stage)).some(file => file.path === 'inputs.json'));
    await assert.rejects(prepareArtifact(project, transport, identity), /EEXIST/);
    await assert.rejects(stageArtifact(project, transport, stage, expected), /EEXIST/);

    async function mutate(path: string, bytes: Buffer, reason: RegExp): Promise<void> {
      const target = join(transport, 'tree', path);
      const original = await readFile(target);
      try {
        await writeFile(target, bytes);
        await assert.rejects(verifyArtifactInputs(project, transport, expected), reason);
      } finally { await writeFile(target, original); }
      await verifyArtifactInputs(project, transport, expected);
    }
    await t.test('closed config semantics, independent of byte mismatch', async () => {
      const config = JSON.parse(await readFile(join(transport, 'tree/wrangler.jsonc'), 'utf8')) as Record<string, unknown>;
      for (const mutateConfig of [
        (copy: Record<string, unknown>) => { delete copy.ai; },
        (copy: Record<string, unknown>) => { (copy.assets as Record<string, unknown>).run_worker_first = ['/api/*']; },
        (copy: Record<string, unknown>) => { (copy.assets as Record<string, unknown>).run_worker_first = ['/api']; },
        (copy: Record<string, unknown>) => { (copy.assets as Record<string, unknown>).not_found_handling = '404-page'; },
        (copy: Record<string, unknown>) => { copy.compatibility_date = '2026-11-09'; },
        (copy: Record<string, unknown>) => { copy.main = './dist/worker.js'; },
      ]) {
        const copy = structuredClone(config); mutateConfig(copy);
        await mutate('wrangler.jsonc', jsonBytes(copy), /config|contract|profile/i);
      }
    });
    await t.test('NOTICE semantics and intact license terms', async () => {
      await mutate('NOTICE', Buffer.from('Rules-only artifact.\n'), /NOTICE/);
      const notice = await readFile(join(transport, 'tree/NOTICE'));
      await mutate('NOTICE', Buffer.from(notice.toString('utf8').replace(/own account/g, 'account')), /NOTICE/);
      await mutate('NOTICE', Buffer.from(notice.toString('utf8').replace(/Paid usage may incur charges\./, 'Paid usage is available.')), /NOTICE/);
      await mutate('NOTICE', Buffer.from(notice.toString('utf8').replace("Copyright 2019 Jack O'Connor and Samuel Neves", 'Copyright omitted')),
        /blake3-1\.8\.7\/LICENSE_A2/);
      await mutate('LICENSE', Buffer.from('Apache License Version 2.0\n'), /LICENSE|license/);
    });
    await t.test('contextual inert secrets reject at privacy guard without value disclosure', async () => {
      const marker = 'inert-secret-for-offline-test-12345';
      const worker = await readFile(join(transport, 'tree/worker.js'));
      const target = join(transport, 'tree/worker.js');
      try {
        await writeFile(target, Buffer.concat([worker, Buffer.from(`\nconst API_KEY = "${marker}";\n`)]));
        await assert.rejects(verifyArtifactInputs(project, transport, expected), error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /secret-looking assignment/);
          assert.ok(!error.message.includes(marker));
          return true;
        });
      } finally { await writeFile(target, worker); }
      await verifyArtifactInputs(project, transport, expected);
      assertPrivateContent([{ path: 'fingerprints.json', bytes: jsonBytes({ sha256: 'a'.repeat(64), workerSHA256: 'b'.repeat(64) }) }]);
    });
    await t.test('reference resolution rejects broken HTML/JS/CSS URLs', async () => {
      const index = await readFile(join(transport, 'tree/dist/index.html'));
      await mutate('dist/index.html', Buffer.from(index.toString('utf8').replace(/src="[^"]+"/, 'src="/assets/missing.js"')), /Referenced artifact asset/);
      for (const suffix of ['.js', '.css']) {
        const path = inputs.assets.find(file => file.path.endsWith(suffix))!.path;
        const bytes = await readFile(join(transport, 'tree/dist', path));
        const reference = suffix === '.js' ? '\nconst broken = new URL("./missing.wasm", import.meta.url);\n' : '\n.broken{background:url(./missing.png)}\n';
        await mutate(`dist/${path}`, Buffer.concat([bytes, Buffer.from(reference)]), /Referenced artifact asset/);
      }
    });
    await t.test('actual bundles distinguish inert module keys from true dependencies', async () => {
      const files = await readClosedTree(join(transport, 'tree'));
      const entry = files.find(file => file.path.startsWith('dist/') && file.path.endsWith('.js'))!;
      const ordinary = Buffer.from('\nconst importObject = {"./sim_wasm_bg.js": {}}; const downloadName = "replay.html"; const endpoints = ["/", "/api/config", "/api/choice"]; new URL("/", import.meta.url);\n');
      const withOrdinary = files.map(file => file.path === entry.path ? { ...file, bytes: Buffer.concat([file.bytes, ordinary]) } : file);
      checkReferences(withOrdinary);
      for (const dependency of ['import "./sim_wasm_bg.js";', 'import("./sim_wasm_bg.js");',
        'new URL("./sim_wasm_bg.js", import.meta.url);', 'new Worker("/assets/sim_wasm_bg.js");', 'fetch("/assets/sim_wasm_bg.js");']) {
        const withDependency = withOrdinary.map(file => file.path === entry.path ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from(`\n${dependency}\n`)]) } : file);
        assert.throws(() => checkReferences(withDependency), /Referenced artifact asset/);
      }
    });
    await t.test('media inventory remains independent of a supplied asset manifest', async () => {
      const relative = 'assets/unlisted.png';
      const target = join(transport, 'tree/dist', relative);
      const bytes = Buffer.from('inert offline media fixture');
      const supplied = structuredClone(inputs);
      supplied.assets.push({ path: relative, size: bytes.byteLength, sha256: digest(bytes) });
      supplied.assets.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      await writeFile(target, bytes);
      try { await assert.rejects(checkArtifact(project, join(transport, 'tree'), supplied, identity), /licensed inventory/); }
      finally { await rm(target); }
      await verifyArtifactInputs(project, transport, expected);
    });
    await t.test('closed paths reject source/media/Worker-in-dist and symlinks', async () => {
      for (const path of ['dist/worker.js', 'dist/assets/unlisted.png', 'src/index.ts', 'eval/probe/data.json', 'env', 'target/worker.js', 'node_modules/pkg.js']) {
        const target = join(transport, 'tree', path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, 'inert offline test bytes\n');
        await assert.rejects(verifyArtifactInputs(project, transport, expected), /path|unlisted|forbidden/);
        await rm(target);
        // Remove only the fresh directory introduced by this test.
        if (path.includes('/') && !path.startsWith('dist/')) await rm(join(transport, 'tree', path.split('/')[0]!), { recursive: true });
        await verifyArtifactInputs(project, transport, expected);
      }
      const worker = join(transport, 'tree/worker.js');
      const moved = join(parent, 'moved-worker.js');
      await rename(worker, moved);
      try { await assert.rejects(verifyArtifactInputs(project, transport, expected), /path set/); }
      finally { await rename(moved, worker); }
      await rename(worker, moved);
      await symlink(moved, worker);
      try { await assert.rejects(verifyArtifactInputs(project, transport, expected), /symlink/); }
      finally { await rm(worker); await rename(moved, worker); }
      await verifyArtifactInputs(project, transport, expected);
    });
    await t.test('independent envelope, source provenance and identity are not public self-claims', async () => {
      await assert.rejects(verifyArtifactInputs(project, transport, { identity, envelopeSHA: '0'.repeat(64) }), /independently expected SHA/);
      await assert.rejects(verifyArtifactInputs(project, transport, { identity: { ...identity, runAttempt: '3' }, envelopeSHA }), /identity/);
      const altered: CheckedInputs = structuredClone(inputs);
      altered.sourceDigests['mise.toml'] = '0'.repeat(64);
      const bytes = jsonBytes(altered);
      const original = await readFile(join(transport, 'inputs.json'));
      try {
        await writeFile(join(transport, 'inputs.json'), bytes);
        await assert.rejects(verifyArtifactInputs(project, transport, { identity, envelopeSHA: digest(bytes) }), /Checked source/);
      } finally { await writeFile(join(transport, 'inputs.json'), original); }
      await verifyArtifactInputs(project, transport, expected);
      const source = join(project, 'mise.toml');
      const originalSource = await readFile(source);
      try {
        await writeFile(source, Buffer.concat([originalSource, Buffer.from('\n# inert uncommitted source change\n')]));
        await assert.rejects(collectArtifactInputs(project, identity), /source bytes differ from source commit/);
      } finally { await writeFile(source, originalSource); }
      await verifyArtifactInputs(project, transport, expected);
    });
    await t.test('publisher source checkout does not rebuild or require source build directories', async () => {
      await rm(join(project, 'target'), { recursive: true });
      await rm(join(project, 'web/dist'), { recursive: true });
      await verifyArtifactInputs(project, transport, expected);
      const secondStage = join(parent, 'public-source-only');
      await stageArtifact(project, transport, secondStage, expected);
      await checkArtifact(project, secondStage, inputs, identity);
      await assert.rejects(collectArtifactInputs(project, identity), /ENOENT/);
    });
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('closed validation rejects ambiguous inputs and encoded traversal without secrets or hash false positives', () => {
  for (const path of ['../worker.js', '/worker.js', 'dist/../worker.js', 'dist\\worker.js', 'dist//worker.js']) assert.throws(() => safeRelativePath(path), /unsafe/);
  assert.throws(() => validateCheckedInputs({ version: 1, unexpected: true }), /closed/);
  assert.throws(() => checkReferences([{ path: 'dist/index.html', bytes: Buffer.from('<script src="/assets/%2e%2e/worker.js"></script>') }]), /Traversal/);
  assert.throws(() => checkReferences([{ path: 'dist/assets/edge.js', bytes: Buffer.from('new URL("./%2e%2e/worker.js", import.meta.url);') }]), /Traversal/);
  assert.throws(() => checkReferences([{ path: 'dist/assets/edge.js', bytes: Buffer.from('import "https://example.invalid/module.js?credential=redacted";') }]), /External runtime asset/);
  assert.throws(() => validateNotice('own account opt-in 16384 direct calls page cap shared quota Free quota Paid charges Rules_Default gameplay no model weights'), /NOTICE/);
});
