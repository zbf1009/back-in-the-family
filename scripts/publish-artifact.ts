import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArtifact } from './check-artifact.ts';
import { stageArtifact } from './stage-artifact.ts';
import { verifyArtifactInputs } from './artifact-inputs.ts';
import type { ArtifactExpectation } from './artifact-inputs.ts';
import { assertWorkerTools } from '../worker-api/scripts/tools.ts';

export const ABSENT_OID = '0'.repeat(40);
const OID = /^[a-f0-9]{40}$/;
const script = fileURLToPath(import.meta.url);

export interface PublicationOptions {
  projectRoot: string;
  inputDir: string;
  artifactRepository: string;
  artifactRef: string;
  sourceRef: string;
  expectedPriorOID: string;
  expected: ArtifactExpectation;
}
export interface PreparedPublication extends PublicationOptions { commitOID: string }

function git(repository: string, args: string[], input?: Uint8Array | string, extraEnv?: NodeJS.ProcessEnv): string {
  const result = spawnSync('/usr/bin/git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-C', repository, ...args,
  ], {
    input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1',
      GIT_AUTHOR_NAME: 'Artifact publisher', GIT_AUTHOR_EMAIL: 'artifact-publisher@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'Artifact publisher', GIT_COMMITTER_EMAIL: 'artifact-publisher@users.noreply.github.com',
      ...extraEnv,
    },
  });
  // Git can echo a remote URL or an authentication diagnostic. Never forward it.
  assert.equal(result.status, 0, `Artifact Git operation failed (${args[0]}); no publication completed`);
  return result.stdout.trim();
}

function validateRef(repository: string, ref: string): void {
  assert.ok(ref.startsWith('refs/heads/'), 'An explicit full branch ref is required');
  assert.notEqual(ref, 'refs/heads/main', 'The source branch main is protected from artifact writes');
  git(repository, ['check-ref-format', ref]);
}

function refOID(repository: string, ref: string): string {
  const result = spawnSync('/usr/bin/git', ['-C', repository, 'rev-parse', '--verify', '--quiet', ref], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  if (result.status === 1 && result.stdout === '') return ABSENT_OID;
  assert.equal(result.status, 0, 'Cannot read the expected artifact predecessor');
  const oid = result.stdout.trim();
  assert.match(oid, OID);
  return oid;
}

function checkSource(options: PublicationOptions): void {
  assert.match(options.expected.identity.sourceCommit, OID, 'Checked source commit must be an exact Git SHA');
  assert.ok(options.sourceRef === 'HEAD' || options.sourceRef.startsWith('refs/heads/'), 'An explicit source ref is required');
  if (options.sourceRef !== 'HEAD') git(options.projectRoot, ['check-ref-format', options.sourceRef]);
  assert.equal(git(options.projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}']), options.expected.identity.sourceCommit,
    'Stale source: current checked-out HEAD differs from the checked source SHA');
  assert.equal(git(options.projectRoot, ['rev-parse', '--verify', `${options.sourceRef}^{commit}`]), options.expected.identity.sourceCommit,
    'Stale source: the current source branch has advanced beyond the checked source SHA');
}

async function checkRepository(options: PublicationOptions): Promise<void> {
  validateRef(options.artifactRepository, options.artifactRef);
  assert.notEqual(options.artifactRef, options.sourceRef, 'Artifact and source refs must be distinct');
  assert.equal(typeof options.expectedPriorOID, 'string', 'Explicit expected prior OID is required');
  assert.match(options.expectedPriorOID, OID, 'Explicit expected prior OID is required; use the zero OID for an absent ref');
  assert.equal(git(options.artifactRepository, ['rev-parse', '--is-bare-repository']), 'true',
    'Local publication requires an explicitly owned bare artifact repository');
  assert.equal(git(options.artifactRepository, ['remote']), '', 'Local artifact repositories must have no remotes');
  assert.notEqual(await realpath(options.artifactRepository), await realpath(options.projectRoot),
    'Artifact publication must not write into the source repository');
  assert.equal(refOID(options.artifactRepository, options.artifactRef), options.expectedPriorOID,
    'Unexpected artifact predecessor; no staging or publication allowed');
  if (options.expectedPriorOID !== ABSENT_OID) {
    assert.equal(git(options.artifactRepository, ['cat-file', '-t', options.expectedPriorOID]), 'commit', 'Prior artifact OID must be a commit');
  }
  checkSource(options);
}

async function writeTree(repository: string, directory: string, checkedCopy: string): Promise<string> {
  await mkdir(checkedCopy);
  const records: string[] = [];
  const entries = (await readdir(directory)).sort();
  for (const name of entries) {
    const path = join(directory, name);
    const info = await lstat(path);
    assert.ok(!info.isSymbolicLink(), 'Artifact Git tree must contain no symlinks');
    if (info.isDirectory()) {
      const oid = await writeTree(repository, path, join(checkedCopy, name));
      records.push(`040000 tree ${oid}\t${name}\0`);
    } else {
      assert.ok(info.isFile(), 'Artifact Git tree must contain only regular files');
      const bytes = await readFile(path);
      const oid = git(repository, ['hash-object', '-w', '--stdin'], bytes);
      await writeFile(join(checkedCopy, name), bytes);
      records.push(`100644 blob ${oid}\t${name}\0`);
    }
  }
  return git(repository, ['mktree', '-z'], records.join(''));
}

/** Real packaging and immutable Git objects; no branch is changed by this phase. */
export async function preparePublication(options: PublicationOptions): Promise<PreparedPublication> {
  await checkRepository(options);
  const work = await mkdtemp(join(tmpdir(), 'artifact-publication-'));
  try {
    const tree = join(work, 'tree');
    const checked = await stageArtifact(options.projectRoot, options.inputDir, tree, options.expected);
    await checkArtifact(options.projectRoot, tree, checked, options.expected.identity);
    const checkedCopy = join(work, 'git-bytes');
    const treeOID = await writeTree(options.artifactRepository, tree, checkedCopy);
    // Check the bytes fed to hash-object, not just a mutable staging directory.
    await checkArtifact(options.projectRoot, checkedCopy, checked, options.expected.identity);
    const parents = options.expectedPriorOID === ABSENT_OID ? [] : ['-p', options.expectedPriorOID];
    const commitOID = git(options.artifactRepository, ['commit-tree', treeOID, ...parents],
      `Checked artifact for ${options.expected.identity.sourceCommit}\n\nRun ${options.expected.identity.runId}, attempt ${options.expected.identity.runAttempt}\n`);
    assert.match(commitOID, OID);
    checkSource(options);
    return { ...options, commitOID };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Final atomic local CAS. Races between preparation and this call cannot overwrite a ref. */
export async function publishPreparedLocal(prepared: PreparedPublication): Promise<string> {
  validateRef(prepared.artifactRepository, prepared.artifactRef);
  await verifyArtifactInputs(prepared.projectRoot, prepared.inputDir, prepared.expected);
  checkSource(prepared);
  git(prepared.artifactRepository, ['update-ref', '--no-deref', prepared.artifactRef, prepared.commitOID, prepared.expectedPriorOID]);
  return prepared.commitOID;
}

export async function publishArtifact(options: PublicationOptions): Promise<string> {
  return publishPreparedLocal(await preparePublication(options));
}

function requireCIApproval(artifactRef: string, expected: ArtifactExpectation): string {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Remote publication is available only to an explicit approved CI invocation');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Only checked main pushes may publish');
  assert.equal(process.env.BIF_ARTIFACT_PUBLICATION_APPROVED, '8.1', 'Permanent publication requires separate 8.1 approval');
  assert.equal(process.env.BIF_ARTIFACT_TARGET_REF, artifactRef, 'Target ref must match the separately approved permanent input');
  assert.notEqual(artifactRef, 'refs/heads/main', 'The source branch main is protected from artifact writes');
  assert.match(artifactRef, /^refs\/heads\/.+/);
  assert.deepEqual(expected.identity, {
    sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  }, 'Source/run identity must come from this trusted workflow run');
  assert.match(expected.envelopeSHA, /^[a-f0-9]{64}$/);
  assert.match(process.env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(process.env.GITHUB_TOKEN, 'The future writer requires an ephemeral job token');
  assert.ok(!Object.keys(process.env).some(name => /^(CLOUDFLARE_(API|ACCOUNT)|CF_(API|ACCOUNT))/i.test(name)),
    'Production Cloudflare credentials must not enter the publisher job');
  return `https://github.com/${process.env.GITHUB_REPOSITORY}.git`;
}

async function withRemoteGit<T>(artifactRef: string, expected: ArtifactExpectation,
  operation: (repository: string, remote: string, env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const remote = requireCIApproval(artifactRef, expected);
  const work = await mkdtemp(join(tmpdir(), 'artifact-ci-'));
  try {
    const askpass = join(work, 'askpass.sh');
    await writeFile(askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" x-access-token ;; *Password*) printf "%s\\n" "$GITHUB_TOKEN" ;; *) exit 1 ;; esac\n',
      { mode: 0o700 });
    const repository = join(work, 'objects.git');
    await mkdir(repository);
    git(repository, ['init', '--bare', '--initial-branch=fixture-unused']);
    validateRef(repository, artifactRef);
    const env = { GIT_ASKPASS: askpass, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
    return await operation(repository, remote, env);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function remoteRefs(repository: string, remote: string, artifactRef: string, env: NodeJS.ProcessEnv): Map<string, string> {
  const output = git(repository, ['ls-remote', '--refs', remote, 'refs/heads/main', artifactRef], undefined, env);
  const refs = new Map<string, string>();
  for (const line of output.split('\n').filter(Boolean)) {
    const [oid, ref] = line.split('\t');
    assert.ok(ref === 'refs/heads/main' || ref === artifactRef, 'Unexpected remote ref response');
    assert.ok(oid !== undefined && OID.test(oid));
    assert.ok(!refs.has(ref), 'Duplicate remote ref response');
    refs.set(ref, oid);
  }
  return refs;
}

/** Future CI discovery is read-only and still requires approval and explicit first-publication absence. */
export async function captureRemotePrior(artifactRef: string, expected: ArtifactExpectation): Promise<string> {
  return withRemoteGit(artifactRef, expected, async (repository, remote, env) => {
    const refs = remoteRefs(repository, remote, artifactRef, env);
    assert.equal(refs.get('refs/heads/main'), expected.identity.sourceCommit, 'Stale source main; publication rejected');
    const prior = refs.get(artifactRef);
    if (prior === undefined) assert.equal(process.env.BIF_ARTIFACT_EXPECT_ABSENT, 'true', 'First publication requires an explicit absent-ref expectation');
    return prior ?? ABSENT_OID;
  });
}

/** Future remote writer: checker runs offline; credentials reach only Git transport. Never called by local tests. */
export async function publishArtifactCI(options: Omit<PublicationOptions, 'artifactRepository' | 'sourceRef'>): Promise<string> {
  assert.match(options.expectedPriorOID, OID, 'An explicit captured expected predecessor is required');
  if (options.expectedPriorOID === ABSENT_OID) {
    assert.equal(process.env.BIF_ARTIFACT_EXPECT_ABSENT, 'true', 'First publication requires explicit absence approval');
  }
  return withRemoteGit(options.artifactRef, options.expected, async (repository, remote, env) => {
    const initial = remoteRefs(repository, remote, options.artifactRef, env);
    assert.equal(initial.get('refs/heads/main'), options.expected.identity.sourceCommit, 'Stale source main; publication rejected');
    assert.equal(initial.get(options.artifactRef) ?? ABSENT_OID, options.expectedPriorOID, 'Unexpected artifact predecessor before staging');
    if (options.expectedPriorOID !== ABSENT_OID) {
      git(repository, ['fetch', '--no-tags', '--no-write-fetch-head', remote, `${options.artifactRef}:${options.artifactRef}`], undefined, env);
      assert.equal(refOID(repository, options.artifactRef), options.expectedPriorOID,
        'Artifact predecessor changed during object download');
    }
    // Detached CI checkouts compare HEAD only; the outer process checks remote main before and after staging.
    const work = await mkdtemp(join(tmpdir(), 'artifact-ci-check-'));
    try {
      const result = spawnSync('/usr/bin/unshare', [
        '--user', '--map-root-user', '--net', '--fork', '/bin/bash', '-c',
        'set -euo pipefail; /usr/bin/ip link set lo up; exec "$@"', 'artifact-offline', process.execPath, script,
        '--prepare-only', '--project-root', options.projectRoot, '--input', options.inputDir,
        '--artifact-repository', repository, '--artifact-ref', options.artifactRef, '--source-ref', 'HEAD',
        '--expected-prior-oid', options.expectedPriorOID, '--source-commit', options.expected.identity.sourceCommit,
        '--run-id', options.expected.identity.runId, '--run-attempt', options.expected.identity.runAttempt,
        '--envelope-sha', options.expected.envelopeSHA,
      ], {
        encoding: 'utf8', env: {
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: work, TMPDIR: work,
          WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
          CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', npm_config_manage_package_manager_versions: 'false',
        },
      });
      assert.equal(result.status, 0, 'Offline artifact preparation failed; remote ref remains unchanged');
      const prepared = JSON.parse(result.stdout) as { commitOID: string };
      assert.match(prepared.commitOID, OID);
      assert.equal(git(options.projectRoot, ['rev-parse', 'HEAD^{commit}']), options.expected.identity.sourceCommit,
        'Stale checked-out source before publication');
      const final = remoteRefs(repository, remote, options.artifactRef, env);
      assert.equal(final.get('refs/heads/main'), options.expected.identity.sourceCommit, 'Stale source main immediately before publication');
      assert.equal(final.get(options.artifactRef) ?? ABSENT_OID, options.expectedPriorOID, 'Unexpected predecessor immediately before publication');
      const lease = options.expectedPriorOID === ABSENT_OID ? '' : options.expectedPriorOID;
      git(repository, ['push', '--porcelain', `--force-with-lease=${options.artifactRef}:${lease}`,
        remote, `${prepared.commitOID}:${options.artifactRef}`], undefined, env);
      return prepared.commitOID;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}

function argumentsOf(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    assert.ok(key?.startsWith('--') && value !== undefined && !value.startsWith('--'), 'Publisher flags require explicit values');
    assert.ok(!args.has(key), 'Duplicate publisher flag');
    args.set(key, value);
  }
  return args;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === script) {
  const mode = process.argv[2];
  assert.ok(mode === '--local' || mode === '--prepare-only' || mode === '--ci' || mode === '--ci-capture-prior',
    'Choose explicit --local, --prepare-only, --ci-capture-prior or approved --ci mode');
  const args = argumentsOf(process.argv.slice(3));
  const take = (key: string): string => {
    const value = args.get(key);
    assert.ok(value, `Publisher requires ${key}`);
    args.delete(key);
    return value;
  };
  const artifactRef = take('--artifact-ref');
  const expected: ArtifactExpectation = {
    identity: { sourceCommit: take('--source-commit'), runId: take('--run-id'), runAttempt: take('--run-attempt') },
    envelopeSHA: take('--envelope-sha'),
  };
  if (mode === '--ci-capture-prior') {
    assert.equal(args.size, 0, 'Unknown publisher selector');
    console.log(`oid=${await captureRemotePrior(artifactRef, expected)}`);
  } else {
    const common = {
      projectRoot: resolve(take('--project-root')), inputDir: resolve(take('--input')), artifactRef,
      expectedPriorOID: take('--expected-prior-oid'), expected,
    };
    if (mode === '--ci') {
      assert.equal(args.size, 0, 'Unknown publisher selector');
      console.log(JSON.stringify({ sourceCommit: expected.identity.sourceCommit, commitOID: await publishArtifactCI(common) }));
    } else {
      const options = { ...common, artifactRepository: resolve(take('--artifact-repository')), sourceRef: take('--source-ref') };
      assert.equal(args.size, 0, 'Unknown publisher selector');
      assertWorkerTools();
      const prepared = await preparePublication(options);
      const commitOID = mode === '--local' ? await publishPreparedLocal(prepared) : prepared.commitOID;
      console.log(JSON.stringify({ sourceCommit: expected.identity.sourceCommit, commitOID }));
    }
  }
}
