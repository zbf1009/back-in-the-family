import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import type * as TypeScriptTools from '../../../web/node_modules/typescript';
import { digest } from '../../scripts/bundle.ts';
import { root, validateJudgeHostedConfig, validateJudgeSourceConfig } from '../../scripts/profile.ts';
import { requireTools } from '../../scripts/tools.ts';
import { JUDGE_MANIFEST_PATH, JUDGE_SOURCE_PATHS, judgeCliContext, validateJudgeExpectation, validateJudgeManifest } from '../../../scripts/check-judge-artifact.ts';
import type { JudgeExpectation, JudgeManifest } from '../../../scripts/check-judge-artifact.ts';
import { jsonBytes, readClosedTree } from '../../../scripts/artifact-inputs.ts';
import { selectSdkLock, validateSdkLock } from '../../../scripts/artifact-sdk-lock.ts';
import { consumerCLI, independentArtifact } from '../../../scripts/tests/artifact-fixture.ts';
import type { IndependentArtifact } from '../../../scripts/tests/artifact-fixture.ts';

let owned: string;
let fixture: IndependentArtifact;
let expected: JudgeExpectation;
let manifestBytes: Buffer;
let manifestSHA: string;
let value: JudgeManifest;
const snapshots = new Map<string, Buffer>();
function args(command: string, expectation = expected, sha?: string): string[] {
  return [join(fixture.project, 'scripts/check-judge-artifact.ts'), command, '--mode', expectation.mode,
    '--input', fixture.transport, '--archive', expectation.archivePath, '--archive-sha', expectation.upstream.archiveSHA256,
    '--artifact-id', expectation.upstream.artifactId, '--envelope-sha', expectation.upstream.envelopeSHA,
    '--source-commit', expectation.identity.sourceCommit, '--upstream-run-id', expectation.upstream.identity.runId,
    '--upstream-run-attempt', expectation.upstream.identity.runAttempt, '--run-id', expectation.identity.runId,
    '--run-attempt', expectation.identity.runAttempt, ...(sha === undefined ? [] : ['--manifest-sha', sha])];
}
function successful(command: string, sha?: string) {
  const result = consumerCLI(fixture.project, args(command, expected, sha));
  assert.equal(result.status, 0, result.stderr); return result;
}
async function checkMutation(change: (manifest: JudgeManifest) => void, message?: RegExp): Promise<void> {
  const mutation = structuredClone(value); change(mutation);
  const bytes = jsonBytes(mutation);
  await writeFile(join(fixture.project, JUDGE_MANIFEST_PATH), bytes);
  try {
    const result = consumerCLI(fixture.project, args('check', expected, digest(bytes)));
    assert.notEqual(result.status, 0, 'Actual copied checker must reject mutated manifest');
    if (message) assert.match(result.stderr, message);
  } finally { await writeFile(join(fixture.project, JUDGE_MANIFEST_PATH), manifestBytes); }
}
before(async () => {
  owned = await mkdtemp(join(tmpdir(), 'judge-artifact-owned-'));
  fixture = await independentArtifact(owned, 'local', '1', [...JUDGE_SOURCE_PATHS, 'scripts/check-hosted-candidate.ts']);
  const archivePath = join(owned, 'upstream-local.zip');
  // A real local ZIP is recorded independently, not labeled a remote GitHub artifact.
  execFileSync('/usr/bin/python3', ['-c',
    'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_STORED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file(): z.write(f,f.relative_to(p).as_posix())', fixture.transport, archivePath]);
  // Independently supplied judge and upstream identities must not share a mutable object.
  expected = { mode: 'local', archivePath, identity: { ...fixture.expected.identity },
    upstream: { identity: { ...fixture.expected.identity }, artifactId: 'local', archiveSHA256: digest(await readFile(archivePath)), envelopeSHA: fixture.expected.envelopeSHA } };
  successful('restore-upstream');
  for (const path of ['target/judge-worker/worker.js', 'target/judge-worker/build.json', 'target/judge-worker/deploy-disabled.jsonc']) {
    await mkdir(dirname(join(fixture.project, path)), { recursive: true });
    await copyFile(join(root, path), join(fixture.project, path));
    snapshots.set(path, await readFile(join(fixture.project, path)));
  }
  const prepared = successful('prepare');
  const record = JSON.parse(prepared.stdout.trim().split('\n').at(-1)!) as { manifestSHA: string };
  assert.match(record.manifestSHA, /^[a-f0-9]{64}$/); manifestSHA = record.manifestSHA;
  manifestBytes = await readFile(join(fixture.project, JUDGE_MANIFEST_PATH));
  assert.equal(digest(manifestBytes), manifestSHA);
  value = JSON.parse(manifestBytes.toString('utf8')) as JudgeManifest;
}, { timeout: 300_000 });
after(async () => { if (owned) await rm(owned, { recursive: true, force: true }); });

test('actual owned source/SDK/workerd manifest and immutable release round-trip', { timeout: 300_000 }, async () => {
  validateJudgeManifest(value); successful('check', manifestSHA); successful('pack', manifestSHA);
  const packet = join(fixture.project, 'target/judge-release');
  const files = await readClosedTree(packet);
  assert.ok(files.some(file => file.path === 'upstream.zip'));
  assert.ok(files.some(file => file.path === JUDGE_MANIFEST_PATH));
  assert.ok(files.some(file => file.path === 'target/judge-worker/worker.js'));
  assert.ok(!files.some(file => /(?:^|\/)\.env|\.dev\.vars|judge-code/.test(file.path)));
  // Reconsume the packet in a fresh copy of the committed source, not the checked producer outputs.
  const destination = join(owned, 'release-consumer');
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', '--no-hardlinks', fixture.project, destination]);
  // The existing SDK copier already made an owned independent graph; copy links and bytes, not a host fallback.
  execFileSync('/usr/bin/cp', ['-a', join(fixture.project, 'web/node_modules'), join(destination, 'web/node_modules')]);
  const releaseExpected = { ...expected, archivePath: join(packet, 'upstream.zip') };
  const restore = args('restore-judge', releaseExpected, manifestSHA);
  restore[0] = join(destination, 'scripts/check-judge-artifact.ts');
  restore.push('--packet', packet);
  const restored = consumerCLI(destination, restore);
  assert.equal(restored.status, 0, restored.stderr);
  const recheck = args('check', releaseExpected, manifestSHA);
  recheck[0] = join(destination, 'scripts/check-judge-artifact.ts');
  const checked = consumerCLI(destination, recheck);
  assert.equal(checked.status, 0, checked.stderr);
});

test('closed manifest fields, fixed paths, array order and digest formulas', async t => {
  for (const name of Object.keys(value) as (keyof JudgeManifest)[]) await t.test(`missing ${name}`, () => {
    const mutation = structuredClone(value) as Partial<JudgeManifest>; delete mutation[name];
    assert.throws(() => validateJudgeManifest(mutation));
  });
  const extraTargets: (manifest: JudgeManifest) => object[] = manifest => [manifest, manifest.identity, manifest.upstream,
    manifest.upstream.identity, manifest.worker, manifest.configs, manifest.configs.source, manifest.wasm,
    manifest.wasm.source, manifest.sources, manifest.sdk, manifest.sdk.healthyLock, manifest.sdk.schema,
    manifest.sdk.toolchain, manifest.exports, manifest.exports.JudgeGate, manifest.bindings,
    manifest.bindings.JUDGE_GATE, manifest.policy, ...manifest.assets];
  for (let index = 0; index < extraTargets(value).length; index++) await t.test(`extra nested field ${index}`, () => {
    const mutation = structuredClone(value); Object.assign(extraTargets(mutation)[index]!, { unexpected: true });
    assert.throws(() => validateJudgeManifest(mutation));
  });
  for (const change of [
    (m: JudgeManifest) => { m.worker.path = 'target/decision-worker/worker.js'; },
    (m: JudgeManifest) => { m.worker.size = -1; },
    (m: JudgeManifest) => { m.worker.sha256 = 'A'.repeat(64); },
    (m: JudgeManifest) => { m.assets.reverse(); m.assetsSHA256 = digest(jsonBytes(m.assets)); },
    (m: JudgeManifest) => { m.assets.push(structuredClone(m.assets[0]!)); m.assetsSHA256 = digest(jsonBytes(m.assets)); },
    (m: JudgeManifest) => { m.assetsSHA256 = 'f'.repeat(64); },
    (m: JudgeManifest) => { m.sources.sha256 = 'f'.repeat(64); },
    (m: JudgeManifest) => { delete m.sources.digests[JUDGE_SOURCE_PATHS[0]!]; m.sources.sha256 = digest(jsonBytes(m.sources.digests)); },
    (m: JudgeManifest) => { m.wasm.assetPath = 'assets/missing.wasm'; },
    (m: JudgeManifest) => { m.sdk.schema.path = '/host/schema.json'; },
  ]) { const mutation = structuredClone(value); change(mutation); assert.throws(() => validateJudgeManifest(mutation)); }
});

test('external identity/archive/envelope/manifest trust is mandatory and local cannot become CI', async () => {
  for (const change of [
    (e: JudgeExpectation) => { e.mode = 'ci'; },
    (e: JudgeExpectation) => { e.identity.runAttempt = '2'; },
    (e: JudgeExpectation) => { e.upstream.artifactId = '0'; },
    (e: JudgeExpectation) => { e.upstream.artifactId = '01'; },
    (e: JudgeExpectation) => { e.upstream.identity.sourceCommit = 'b'.repeat(40); },
    (e: JudgeExpectation) => { e.upstream.archiveSHA256 = ''; },
    (e: JudgeExpectation) => { e.upstream.envelopeSHA = ''; },
  ]) { const mutation = structuredClone(expected); change(mutation); assert.throws(() => validateJudgeExpectation(mutation)); }
  // A consistent but false source identity is structurally valid; only the actual
  // consumer can reject it against independently checked manifest/source bytes.
  const foreignSource = structuredClone(expected);
  foreignSource.identity.sourceCommit = 'b'.repeat(40);
  foreignSource.upstream.identity.sourceCommit = foreignSource.identity.sourceCommit;
  validateJudgeExpectation(foreignSource);
  const foreignCheck = consumerCLI(fixture.project, args('check', foreignSource, manifestSHA));
  assert.notEqual(foreignCheck.status, 0);
  assert.match(foreignCheck.stderr, /identity differs from trusted context/);
  for (const field of ['archiveSHA256', 'envelopeSHA'] as const) {
    const mutation = structuredClone(expected); mutation.upstream[field] = 'f'.repeat(64);
    const result = consumerCLI(fixture.project, args('check', mutation, manifestSHA)); assert.notEqual(result.status, 0);
  }
  assert.notEqual(consumerCLI(fixture.project, args('check', expected, 'f'.repeat(64))).status, 0);
  const full = args('check', expected, manifestSHA).slice(1);
  for (const flag of ['--mode', '--archive', '--archive-sha', '--artifact-id', '--envelope-sha', '--source-commit', '--upstream-run-id', '--upstream-run-attempt', '--run-id', '--run-attempt', '--manifest-sha']) {
    const missing = [...full]; const at = missing.indexOf(flag); missing.splice(at, 2);
    assert.throws(() => judgeCliContext(missing, fixture.project));
  }
  await checkMutation(m => { m.upstream.artifactId = '62099'; }, /trusted context/);
  await checkMutation(m => { m.identity.runId = '62099'; }, /trusted context/);
});

test('real checker rejects config/assets/WASM/schema/SDK/type/source digest mutations', { timeout: 300_000 }, async t => {
  for (const [name, change] of [
    ['source config', (m: JudgeManifest) => { m.configs.source.sha256 = 'f'.repeat(64); }],
    ['hosted config', (m: JudgeManifest) => { m.configs.hosted.sha256 = 'f'.repeat(64); }],
    ['disabled config', (m: JudgeManifest) => { m.configs.disabled.sha256 = 'f'.repeat(64); }],
    ['SDK graph', (m: JudgeManifest) => { m.sdk.graphSHA256 = 'f'.repeat(64); }],
    ['schema', (m: JudgeManifest) => { m.sdk.schema.sha256 = 'f'.repeat(64); }],
    ['healthy lock', (m: JudgeManifest) => { m.sdk.healthyLock.sha256 = 'f'.repeat(64); }],
    ['deploy lock', (m: JudgeManifest) => { m.sdk.deployLock.sha256 = 'f'.repeat(64); }],
    ['deploy package', (m: JudgeManifest) => { m.sdk.deployPackage.sha256 = 'f'.repeat(64); }],
    ['runtime types', (m: JudgeManifest) => { m.sdk.runtimeTypes.sha256 = 'f'.repeat(64); }],
    ['judge types', (m: JudgeManifest) => { m.sdk.judgeTypes.sha256 = 'f'.repeat(64); }],
    ['source digests', (m: JudgeManifest) => { m.sources.digests['worker-api/src/judge.ts'] = 'f'.repeat(64); m.sources.sha256 = digest(jsonBytes(m.sources.digests)); }],
    ['assets', (m: JudgeManifest) => { const asset = m.assets.find(a => !a.path.endsWith('.wasm'))!; asset.sha256 = 'f'.repeat(64); m.assetsSHA256 = digest(jsonBytes(m.assets)); }],
    ['WASM', (m: JudgeManifest) => { m.wasm.source.sha256 = 'f'.repeat(64); m.assets.find(a => a.path.endsWith('.wasm'))!.sha256 = 'f'.repeat(64); m.assetsSHA256 = digest(jsonBytes(m.assets)); }],
  ] as const) await t.test(name, () => checkMutation(change, /current verified source, outputs or SDK/));
});

test('source/hosted SQLite semantics and SDK graph negatives use actual owned source with consistent identity', async () => {
  const source = JSON.parse(await readFile(join(fixture.project, 'worker-api/judge.jsonc'), 'utf8')) as Record<string, unknown>;
  validateJudgeSourceConfig(source);
  for (const change of [
    (m: Record<string, unknown>) => { const assets = m.assets; assert.ok(assets && typeof assets === 'object'); Object.assign(assets, { run_worker_first: ['/api', '/api/*'] }); },
    (m: Record<string, unknown>) => { m.migrations = [{ tag: 'v1', new_sqlite_classes: ['JudgeGate'] }]; },
    (m: Record<string, unknown>) => { m.exports = { JudgeGate: { type: 'durable-object', storage: 'kv' } }; },
    (m: Record<string, unknown>) => { m.durable_objects = { bindings: [{ name: 'OTHER', class_name: 'JudgeGate' }] }; },
    (m: Record<string, unknown>) => { const ai = m.ai; assert.ok(ai && typeof ai === 'object'); Object.assign(ai, { remote: true }); },
    (m: Record<string, unknown>) => { m.preview_urls = true; },
  ]) { const mutation = structuredClone(source); change(mutation); assert.throws(() => validateJudgeSourceConfig(mutation)); }
  const hosted = JSON.parse(await readFile(join(fixture.project, 'worker-api/judge-hosted.jsonc'), 'utf8'));
  validateJudgeHostedConfig(hosted); assert.throws(() => validateJudgeHostedConfig({ ...hosted, no_bundle: false }));
  const disabled = JSON.parse(snapshots.get('target/judge-worker/deploy-disabled.jsonc')!.toString('utf8'));
  validateJudgeHostedConfig(disabled, 'disabled'); assert.throws(() => validateJudgeHostedConfig({ ...disabled, vars: { ...disabled.vars, INFERENCE_ENABLED: 'true' } }, 'disabled'));
  const healthy = await readFile(join(fixture.project, 'web/pnpm-lock.yaml'), 'utf8');
  const pkg = await readFile(join(fixture.project, 'worker-api/artifact-deploy/package.json'), 'utf8');
  const selected = selectSdkLock(healthy, pkg);
  validateSdkLock(jsonBytes(selected).toString('utf8'), healthy, pkg);
  const packages = selected.packages as Record<string, unknown>;
  delete packages[Object.keys(packages)[0]!];
  assert.throws(() => validateSdkLock(jsonBytes(selected).toString('utf8'), healthy, pkg));
});

test('fresh source/blob checks reject stale code and generated declaration bytes', async t => {
  for (const path of ['worker-api/src/judge.ts', 'worker-api/judge-configuration.d.ts', 'worker-api/runtime-configuration.d.ts']) await t.test(path, async () => {
    const original = await readFile(join(fixture.project, path));
    await writeFile(join(fixture.project, path), Buffer.concat([original, Buffer.from('\n// owned stale fixture\n')]));
    try { assert.notEqual(consumerCLI(fixture.project, args('check', expected, manifestSHA)).status, 0); }
    finally { await writeFile(join(fixture.project, path), original); }
  });
});

test('actual workerd export loading rejects missing default/Gate even when output digests and stamp agree', { timeout: 180_000 }, async t => {
  const ts = requireTools('typescript') as typeof TypeScriptTools;
  const workerPath = 'target/judge-worker/worker.js';
  const buildPath = 'target/judge-worker/build.json';
  const original = snapshots.get(workerPath)!;
  for (const exportName of ['default', 'JudgeGate']) await t.test(exportName, async () => {
    const parsed = ts.createSourceFile('worker.js', original.toString('utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    let removed = 0;
    const statements = parsed.statements.map(statement => {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) return statement;
      const elements = statement.exportClause.elements.filter(element => { if (element.name.text === exportName) { removed++; return false; } return true; });
      return ts.factory.updateExportDeclaration(statement, statement.modifiers, statement.isTypeOnly,
        ts.factory.updateNamedExports(statement.exportClause, elements), statement.moduleSpecifier, statement.attributes);
    });
    assert.equal(removed, 1, 'Mutation must remove an actual built native export');
    const mutated = Buffer.from(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, statements)));
    const stamp = JSON.parse(snapshots.get(buildPath)!.toString('utf8')); stamp.bundle = digest(mutated);
    await writeFile(join(fixture.project, workerPath), mutated); await writeFile(join(fixture.project, buildPath), jsonBytes(stamp));
    try { await checkMutation(m => { m.worker.sha256 = digest(mutated); m.worker.size = mutated.length; }); }
    finally { await writeFile(join(fixture.project, workerPath), original); await writeFile(join(fixture.project, buildPath), snapshots.get(buildPath)!); }
  });
});

test('closed packet and regular-file guards reject unlisted files and changed immutable bytes', async () => {
  const packet = join(fixture.project, 'target/judge-release');
  const extra = join(packet, 'unexpected.txt'); await writeFile(extra, 'not a checked release');
  try {
    const command = args('restore-judge', { ...expected, archivePath: join(packet, 'upstream.zip') }, manifestSHA);
    command.push('--packet', packet);
    const result = consumerCLI(fixture.project, command); assert.notEqual(result.status, 0); assert.match(result.stderr, /extra or missing paths/);
  } finally { await rm(extra); }
  const workerPath = join(packet, 'target/judge-worker/worker.js');
  const original = await readFile(workerPath);
  await writeFile(workerPath, Buffer.concat([original, Buffer.from('\n// changed immutable bytes\n')]));
  try {
    const command = args('restore-judge', { ...expected, archivePath: join(packet, 'upstream.zip') }, manifestSHA);
    command.push('--packet', packet);
    const result = consumerCLI(fixture.project, command); assert.notEqual(result.status, 0); assert.match(result.stderr, /checked judge bytes differ/);
  } finally { await writeFile(workerPath, original); }
  const link = join(packet, 'unlisted-link');
  await symlink('target/judge-worker/worker.js', link);
  try {
    const command = args('restore-judge', { ...expected, archivePath: join(packet, 'upstream.zip') }, manifestSHA);
    command.push('--packet', packet);
    const result = consumerCLI(fixture.project, command); assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink|regular/i);
  } finally { await rm(link); }
});
