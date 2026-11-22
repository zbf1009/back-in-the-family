import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readClosedTree } from '../artifact-inputs.ts';
import type { CheckedInputs } from '../artifact-inputs.ts';
import type { PreparedPublication, PublicationOptions } from '../publish-artifact.ts';
import { digest } from '../../worker-api/scripts/bundle.ts';
import { consumerAPI, consumerCLI, independentArtifact } from './artifact-fixture.ts';

const ABSENT_OID = '0'.repeat(40);
// Each API call executes the real copied implementation in a fresh consumer.
function publishArtifact(options: PublicationOptions): Promise<string> {
  return consumerAPI<string>(options.projectRoot, 'publish', options);
}
function preparePublication(options: PublicationOptions): Promise<PreparedPublication> {
  return consumerAPI<PreparedPublication>(options.projectRoot, 'prepare-publication', options);
}
function publishPreparedLocal(options: PreparedPublication): Promise<string> {
  return consumerAPI<string>(options.projectRoot, 'publish-prepared', options);
}

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
  const artifact = await independentArtifact(owned, '61001', '2');
  const projectRoot = artifact.project;
  const inputDir = artifact.transport;
  const artifactRepository = join(owned, 'artifact.git');
  await mkdir(artifactRepository);
  git(artifactRepository, ['init', '--bare', '--initial-branch=fixture-unused']);
  const expectedPriorOID = existing ? commit(artifactRepository, git(artifactRepository, ['mktree'], '')) : ABSENT_OID;
  if (existing) git(artifactRepository, ['update-ref', artifactRef, expectedPriorOID, ABSENT_OID]);
  const expected = artifact.expected;
  assert.equal(git(projectRoot, ['remote']), '');
  assert.equal(git(artifactRepository, ['remote']), '');
  assert.equal(oid(projectRoot, 'refs/heads/main'), ABSENT_OID);
  assert.equal(oid(artifactRepository, 'refs/heads/main'), ABSENT_OID);
  return { projectRoot, inputDir, artifactRepository, artifactRef, sourceRef, expectedPriorOID, expected };
}

async function assertCommittedTree(options: PublicationOptions, commitOID: string): Promise<void> {
  await consumerAPI<CheckedInputs>(options.projectRoot, 'verify', options);
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
  await consumerAPI(options.projectRoot, 'check', { ...options, publicDir: checkedTree });
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
  const args = [join(options.projectRoot, 'scripts/publish-artifact.ts'), '--local',
    '--project-root', options.projectRoot, '--input', options.inputDir,
    '--artifact-repository', options.artifactRepository, '--artifact-ref', artifactRef,
    '--source-ref', sourceRef, '--source-commit', options.expected.identity.sourceCommit,
    '--run-id', options.expected.identity.runId, '--run-attempt', options.expected.identity.runAttempt,
    '--envelope-sha', options.expected.envelopeSHA];
  const missing = consumerCLI(options.projectRoot, args);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires --expected-prior-oid/);
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
  const result = consumerCLI(options.projectRoot, [...args, '--expected-prior-oid', options.expectedPriorOID]);
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
  await consumerAPI<CheckedInputs>(options.projectRoot, 'verify', options);
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
  await assert.rejects(consumerAPI(options.projectRoot, 'publish-ci', options), /explicit approved CI invocation|8\.1 approval/);
  assert.equal(oid(options.artifactRepository), options.expectedPriorOID);
});

