import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { checkArtifact } from '../check-artifact.ts';
import { METADATA_INPUT_PATHS, SOURCE_INPUT_DIRECTORIES, SOURCE_INPUT_PATHS, prepareArtifact,
  readClosedTree, verifyArtifactInputs } from '../artifact-inputs.ts';
import { ABSENT_OID, preparePublication, publishArtifact, publishArtifactCI, publishPreparedLocal } from '../publish-artifact.ts';
import type { PublicationOptions } from '../publish-artifact.ts';
import { digest } from '../../worker-api/scripts/bundle.ts';
import { root } from '../../worker-api/scripts/profile.ts';

const sourceRef = 'refs/heads/fixture-source';
const artifactRef = 'refs/heads/fixture-artifact';
function git(repository: string, args: string[], input?: string | Uint8Array): string {
  const result = spawnSync('/usr/bin/git', ['-C', repository, ...args], {
    input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Owned fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Owned fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function oid(repository: string, ref = artifactRef): string {
  const result = spawnSync('/usr/bin/git', ['-C', repository, 'rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8' });
  if (result.status === 1) return ABSENT_OID;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function commit(repository: string, tree: string, parent?: string): string {
  return git(repository, ['commit-tree', tree, ...(parent ? ['-p', parent] : [])], 'Owned fixture commit\n');
}

async function fixture(t: TestContext, existing = true): Promise<PublicationOptions> {
  const owned = await mkdtemp(join(tmpdir(), 'publisher-proof-'));
  t.after(async () => { await rm(owned, { recursive: true, force: true }); });
  const projectRoot = join(owned, 'source');
  const artifactRepository = join(owned, 'artifact.git');
  await mkdir(projectRoot);
  await mkdir(artifactRepository);
  const paths = [...new Set([...SOURCE_INPUT_PATHS, ...Object.values(METADATA_INPUT_PATHS), 'README.md'])];
  await Promise.all(paths.map(async path => {
    await mkdir(dirname(join(projectRoot, path)), { recursive: true });
    await copyFile(join(root, path), join(projectRoot, path));
  }));
  await Promise.all(SOURCE_INPUT_DIRECTORIES.map(async path => {
    await mkdir(dirname(join(projectRoot, path)), { recursive: true });
    await cp(join(root, path), join(projectRoot, path), { recursive: true });
  }));
  // Track the exact actual semantic source inputs using plumbing in this owned repo.
  // Neither the shared source repo nor main/remote refs are ever changed.
  const files = await readClosedTree(projectRoot);
  git(projectRoot, ['init', '--initial-branch=fixture-source']);
  const records = files.map(file => {
    const blob = git(projectRoot, ['hash-object', '-w', '--stdin'], file.bytes);
    return `100644 ${blob}\t${file.path}\0`;
  });
  git(projectRoot, ['update-index', '-z', '--index-info'], records.join(''));
  const sourceCommit = commit(projectRoot, git(projectRoot, ['write-tree']));
  git(projectRoot, ['update-ref', sourceRef, sourceCommit, ABSENT_OID]);
  await Promise.all(['web/dist', 'target/decision-worker', 'target/wasm-pkg'].map(async path => {
    await mkdir(dirname(join(projectRoot, path)), { recursive: true });
    await cp(join(root, path), join(projectRoot, path), { recursive: true });
  }));
  git(artifactRepository, ['init', '--bare', '--initial-branch=fixture-unused']);
  const expectedPriorOID = existing ? commit(artifactRepository, git(artifactRepository, ['mktree'], '')) : ABSENT_OID;
  if (existing) git(artifactRepository, ['update-ref', artifactRef, expectedPriorOID, ABSENT_OID]);
  const identity = { sourceCommit, runId: '61001', runAttempt: '2' };
  const inputDir = join(owned, 'transport');
  const envelopeSHA = await prepareArtifact(projectRoot, inputDir, identity);
  assert.equal(git(projectRoot, ['remote']), '');
  assert.equal(git(artifactRepository, ['remote']), '');
  assert.equal(oid(projectRoot, 'refs/heads/main'), ABSENT_OID);
  assert.equal(oid(artifactRepository, 'refs/heads/main'), ABSENT_OID);
  return { projectRoot, inputDir, artifactRepository, artifactRef, sourceRef, expectedPriorOID, expected: { identity, envelopeSHA } };
}

async function assertCommittedTree(options: PublicationOptions, commitOID: string): Promise<void> {
  const expected = await verifyArtifactInputs(options.projectRoot, options.inputDir, options.expected);
  const publicFiles = await readClosedTree(join(options.inputDir, 'tree'));
  const actualPaths = git(options.artifactRepository, ['ls-tree', '-r', '--name-only', commitOID]).split('\n');
  assert.deepEqual(actualPaths, publicFiles.map(file => file.path));
  const checkedTree = join(dirname(options.inputDir), 'committed-tree');
  await mkdir(checkedTree);
  for (const file of publicFiles) {
    const object = spawnSync('/usr/bin/git', ['-C', options.artifactRepository, 'cat-file', 'blob', `${commitOID}:${file.path}`], {
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(object.status, 0);
    assert.equal(digest(object.stdout), digest(file.bytes));
    await mkdir(dirname(join(checkedTree, file.path)), { recursive: true });
    await writeFile(join(checkedTree, file.path), object.stdout);
  }
  await checkArtifact(options.projectRoot, checkedTree, expected, options.expected.identity);
  assert.ok(!actualPaths.includes('inputs.json'), 'Private verification envelope is never published');
  assert.ok(!actualPaths.some(path => /^(?:target|web|worker-api|\.github|node_modules|eval)\//.test(path)));
}

test('successful real local CAS commits exactly the checked public bytes and preserves source refs', async t => {
  const options = await fixture(t);
  const sourceBefore = git(options.projectRoot, ['show-ref']);
  const commitOID = await publishArtifact(options);
  assert.notEqual(commitOID, options.expectedPriorOID);
  assert.equal(oid(options.artifactRepository), commitOID);
  assert.equal(git(options.artifactRepository, ['rev-parse', `${commitOID}^`]), options.expectedPriorOID);
  assert.equal(git(options.projectRoot, ['show-ref']), sourceBefore);
  await assertCommittedTree(options, commitOID);
});

test('full local CLI requires the predecessor input and publishes checked bytes without remote approval', async t => {
  const options = await fixture(t);
  const args = [join(root, 'scripts/publish-artifact.ts'), '--local',
    '--project-root', options.projectRoot, '--input', options.inputDir,
    '--artifact-repository', options.artifactRepository, '--artifact-ref', artifactRef,
    '--source-ref', sourceRef, '--source-commit', options.expected.identity.sourceCommit,
    '--run-id', options.expected.identity.runId, '--run-attempt', options.expected.identity.runAttempt,
    '--envelope-sha', options.expected.envelopeSHA];
  const missing = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires --expected-prior-oid/);
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
  const result = spawnSync(process.execPath, [...args, '--expected-prior-oid', options.expectedPriorOID], {
    encoding: 'utf8', env: process.env,
  });
  assert.equal(result.status, 0, result.stderr);
  const publication = JSON.parse(result.stdout) as { sourceCommit: string; commitOID: string };
  assert.equal(publication.sourceCommit, options.expected.identity.sourceCommit);
  assert.equal(oid(options.artifactRepository), publication.commitOID);
  assert.equal(oid(options.projectRoot, sourceRef), options.expected.identity.sourceCommit);
  await assertCommittedTree(options, publication.commitOID);
});

test('first publication requires an explicit absent-ref OID and protects main', async t => {
  const options = await fixture(t, false);
  await assert.rejects(publishArtifact({ ...options, expectedPriorOID: undefined as unknown as string }), /expected prior OID/);
  assert.equal(oid(options.artifactRepository), ABSENT_OID);
  await assert.rejects(publishArtifact({ ...options, artifactRef: 'refs/heads/main' }), /main is protected/);
  assert.equal(oid(options.artifactRepository, 'refs/heads/main'), ABSENT_OID);
  const commitOID = await publishArtifact(options);
  assert.equal(oid(options.artifactRepository), commitOID);
  assert.equal(git(options.artifactRepository, ['rev-list', '--parents', '-n', '1', commitOID]), commitOID);
  await assertCommittedTree(options, commitOID);
});

test('actual packaging failure leaves the prior artifact ref unchanged and restored inputs pass', async t => {
  const options = await fixture(t);
  const workerPath = join(options.inputDir, 'tree/worker.js');
  const worker = await readFile(workerPath);
  await rm(workerPath);
  await assert.rejects(publishArtifact(options));
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
  assert.equal(git(options.artifactRepository, ['cat-file', '-t', options.expectedPriorOID]), 'commit');
  await writeFile(workerPath, worker);
  await verifyArtifactInputs(options.projectRoot, options.inputDir, options.expected);
  const commitOID = await publishArtifact(options);
  assert.equal(oid(options.artifactRepository), commitOID);
});

test('stale checked-out source rejects before publication and does not roll back source state', async t => {
  const options = await fixture(t);
  const newer = commit(options.projectRoot, git(options.projectRoot, ['rev-parse', 'HEAD^{tree}']), options.expected.identity.sourceCommit);
  git(options.projectRoot, ['update-ref', sourceRef, newer, options.expected.identity.sourceCommit]);
  await assert.rejects(publishArtifact(options), /Stale source/);
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
  assert.equal(oid(options.projectRoot, sourceRef), newer);
});

test('source branch advancing after checked packaging leaves the artifact predecessor intact', async t => {
  const options = await fixture(t);
  const prepared = await preparePublication(options);
  // Detach the owned checkout so HEAD still matches but the source branch moves.
  git(options.projectRoot, ['update-ref', '--no-deref', 'HEAD', options.expected.identity.sourceCommit]);
  const newer = commit(options.projectRoot, git(options.projectRoot, ['rev-parse', 'HEAD^{tree}']), options.expected.identity.sourceCommit);
  git(options.projectRoot, ['update-ref', sourceRef, newer, options.expected.identity.sourceCommit]);
  await assert.rejects(publishPreparedLocal(prepared), /current source branch has advanced/);
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
  assert.equal(oid(options.projectRoot, sourceRef), newer);
});

test('unexpected prior OID rejects before staging even when packaging input is missing', async t => {
  const options = await fixture(t);
  const unexpected = commit(options.artifactRepository, git(options.artifactRepository, ['mktree'], ''), options.expectedPriorOID);
  await assert.rejects(publishArtifact({ ...options, expectedPriorOID: unexpected, inputDir: join(options.inputDir, 'missing') }),
    /Unexpected artifact predecessor/);
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
});

test('a real competing local ref update wins and the final atomic CAS cannot overwrite it', async t => {
  const options = await fixture(t);
  const prepared = await preparePublication(options);
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
  const contender = commit(options.artifactRepository, git(options.artifactRepository, ['mktree'], ''), options.expectedPriorOID);
  git(options.artifactRepository, ['update-ref', artifactRef, contender, options.expectedPriorOID]);
  await assert.rejects(publishPreparedLocal(prepared), /Git operation failed \(update-ref\)/);
  assert.equal(oid(options.artifactRepository), contender);
  assert.notEqual(contender, prepared.commitOID);
  assert.equal(oid(options.projectRoot, sourceRef), options.expected.identity.sourceCommit);
});

test('future remote writer fails closed without 8.1 approval before any Git transport', async t => {
  const options = await fixture(t);
  const approval = process.env.BIF_ARTIFACT_PUBLICATION_APPROVED;
  delete process.env.BIF_ARTIFACT_PUBLICATION_APPROVED;
  try {
    await assert.rejects(publishArtifactCI(options), /explicit approved CI invocation|8\.1 approval/);
    assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
  } finally {
    if (approval !== undefined) process.env.BIF_ARTIFACT_PUBLICATION_APPROVED = approval;
  }
});

