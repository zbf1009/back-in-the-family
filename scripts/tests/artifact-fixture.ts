import { execFileSync } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { root } from '../../worker-api/scripts/profile.ts';
import { METADATA_INPUT_PATHS, SOURCE_INPUT_DIRECTORIES, SOURCE_INPUT_PATHS, copyBytes, readClosedTree } from '../artifact-inputs.ts';

/** Commit only copied actual inputs in an owned disposable source repository. */
export async function fixtureProject(parent: string, withCli = false): Promise<string> {
  const project = join(parent, 'source');
  await mkdir(project);
  const paths = [...new Set([...SOURCE_INPUT_PATHS, ...Object.values(METADATA_INPUT_PATHS), 'README.md',
    'target/decision-worker/worker.js', 'target/decision-worker/build.json', 'target/wasm-pkg/sim_wasm_bg.wasm',
    ...(withCli ? ['scripts/artifact-inputs.ts', 'scripts/check-artifact.ts', 'scripts/stage-artifact.ts',
      'worker-api/scripts/profile.ts', 'worker-api/scripts/bundle.ts', 'worker-api/scripts/tools.ts',
      'web/scripts/check-deploy.ts'] : [])])];
  async function copyFile(path: string): Promise<void> {
    await mkdir(dirname(join(project, path)), { recursive: true });
    await writeFile(join(project, path), await readFile(join(root, path)), { flag: 'wx' });
  }
  for (const path of paths) await copyFile(path);
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
  if (withCli) {
    // Private fixture tooling never enters the transport/public tree. Node resolves
    // package licenses to their real installed paths; closed file reads still
    // require copied cache license files rather than following cache symlinks.
    await symlink(join(root, 'web/node_modules'), join(project, 'web/node_modules'), 'dir');
    await copyFile('target/gate-cache/rustc.path');
    const registry = 'target/gate-cache/cargo/registry/src/index.crates.io-1949cf8c6b5b557f';
    for (const relative of ['arrayvec-0.7.8/LICENSE-MIT', 'cfg-if-1.0.5/LICENSE-MIT', 'wasm-bindgen-0.2.130/LICENSE-MIT',
      'wasm-bindgen-shared-0.2.130/LICENSE-MIT', 'serde-1.0.229/LICENSE-MIT', 'memchr-2.8.3/LICENSE-MIT',
      'constant_time_eq-0.4.2/LICENSE-MIT0', 'unicode-ident-1.0.27/LICENSE-UNICODE', 'blake3-1.8.7/LICENSE_A2']) {
      await copyFile(`${registry}/${relative}`);
    }
  }
  return project;
}
