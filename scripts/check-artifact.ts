import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type * as TypeScriptTools from '../web/node_modules/typescript';
import { digest } from '../worker-api/scripts/bundle.ts';
import { root } from '../worker-api/scripts/profile.ts';
import { assertWorkerTools } from '../worker-api/scripts/tools.ts';
import { artifactCliContext, artifactConfig, assertPrivateContent, assertSame, currentSourceCommit,
  manifest, publicProvenance, readClosedTree, readRegularFile, readWranglerConfig, safeRelativePath,
  validateAssets, validateCheckedInputs, validateIdentity, verifyArtifactInputs } from './artifact-inputs.ts';
import type { ArtifactBytes, CheckedInputs, ReleaseIdentity } from './artifact-inputs.ts';
import type { LicenseClosure } from './artifact-licenses.ts';
import { validateSdkLock } from './artifact-sdk-lock.ts';

const publicRoots = ['worker.js', 'wrangler.jsonc', 'package.json', 'pnpm-lock.yaml', 'LICENSE', 'NOTICE', 'provenance.json'];
const referenceExtensions = /\.(?:js|css|wasm|html|png|gif|webp|jpg|svg|ttf|otf|woff2?|mp3|ogg|wav)(?:[?#].*)?$/i;
const requireWeb = createRequire(join(root, 'web/package.json'));
const exec = promisify(execFile);
function parsed(bytes: Buffer): unknown {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Artifact JSON is invalid (contents redacted)'); }
}
function fileBytes(files: readonly ArtifactBytes[], path: string): Buffer {
  const file = files.find(file => file.path === path);
  assert.ok(file, 'Required public artifact file is missing');
  return file.bytes;
}
/** Resolve local HTML, JS, CSS and WASM/media references against the exact tree. */
export function checkReferences(files: readonly ArtifactBytes[]): void {
  const paths = new Set(files.map(file => file.path));
  function reference(from: string, value: string): void {
    if (/^(?:data:|#)/i.test(value)) return;
    assert.ok(!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value), 'External runtime asset reference is forbidden');
    let path: string;
    try { path = decodeURIComponent(value.split(/[?#]/)[0]!); }
    catch { throw new Error('Invalid encoded artifact reference'); }
    assert.ok(!path.includes('\\') && !path.split('/').includes('..'), 'Traversal in artifact reference is forbidden');
    // Asset root URLs are relative to dist, not the public repository root.
    const target = path.startsWith('/') ? `dist/${path.slice(1)}` : posix.join(posix.dirname(from), path);
    safeRelativePath(target);
    assert.ok(paths.has(target), `Referenced artifact asset is missing: ${from} -> ${target}`);
  }
  for (const file of files) {
    if (!['.html', '.js', '.css'].includes(extname(file.path))) continue;
    const text = file.bytes.toString('utf8');
    if (file.path.endsWith('.html')) {
      for (const tag of text.matchAll(/<(?:script|link|img|audio|video|source|iframe)\b[^>]*>/gi)) {
        for (const attribute of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) reference(file.path, attribute[1]!);
      }
    }
    if (file.path.endsWith('.css')) for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) reference(file.path, match[1]!);
    if (file.path.endsWith('.js')) {
      assert.ok(requireWeb('typescript/package.json').version === '6.0.3', 'Use the existing pinned TypeScript parser');
      const ts = requireWeb('typescript') as typeof TypeScriptTools;
      const source = ts.createSourceFile(file.path, text, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);
      function isModuleBase(node: TypeScriptTools.Node): boolean {
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'url' && ts.isMetaProperty(node.expression) &&
          node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.expression.name.text === 'meta') return true;
        let found = false;
        ts.forEachChild(node, child => { if (isModuleBase(child)) found = true; });
        return found;
      }
      function visit(node: TypeScriptTools.Node): void {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
          reference(file.path, node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
          reference(file.path, node.arguments[0].text);
        } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
          const value = node.arguments?.[0];
          if (value && ts.isStringLiteralLike(value)) {
            if (node.expression.text === 'URL' && node.arguments?.[1] && isModuleBase(node.arguments[1]) && referenceExtensions.test(value.text)) {
              reference(file.path, value.text);
            } else if (node.expression.text === 'Worker' || node.expression.text === 'SharedWorker') {
              reference(file.path.startsWith('dist/') ? 'dist/index.html' : file.path, value.text);
            }
          }
        } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch' &&
          node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && referenceExtensions.test(node.arguments[0].text)) {
          reference(file.path.startsWith('dist/') ? 'dist/index.html' : file.path, node.arguments[0].text);
        }
        // Import-object keys, download names, API endpoints and ordinary root
        // strings are not module dependencies merely because they look like URLs.
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
export function validateNotice(text: string): void {
  const normalized = text.replace(/\s+/g, ' ');
  const requirements = [/\bown account\b/i, /opt[ -]in(?:to)?/i, /MAX_REQUEST_BYTES.{0,40}16384/, /direct calls.{0,80}(?:outside|bypass).{0,60}page cap/i,
    /shared.{0,80}(?:allocation|quota)/i, /Free.{0,80}(?:may|can).{0,80}exhaust/i,
    /Paid.{0,80}(?:may|possible).{0,80}(?:charge|cost)/i, /Rules_Default.{0,100}(?:play|game|fallback)/i,
    /no model weights/i, /(?:rules-only|inference.{0,30}disabled)/i];
  assert.ok(requirements.every(pattern => pattern.test(normalized)), 'NOTICE is missing required account/quota/default/policy statements');
}
function validateLicenseTerms(files: readonly ArtifactBytes[], closure: LicenseClosure): void {
  const license = fileBytes(files, 'LICENSE');
  const project = closure.entries.find(entry => entry.id === 'project')!;
  assert.ok(license.equals(Buffer.from(project.text, 'utf8')), 'Project LICENSE must be copied intact');
  const text = license.toString('utf8');
  assert.ok(/Apache License/.test(text) && /Version 2\.0/.test(text) && /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/.test(text) &&
    /END OF TERMS AND CONDITIONS/.test(text), 'Project license terms are incomplete');
  const notice = fileBytes(files, 'NOTICE').toString('utf8');
  validateNotice(notice);
  const normalizedNotice = notice.replace(/\s+/g, ' ').trim();
  for (const entry of closure.entries) {
    if (entry.id === 'project') continue;
    if (entry.id === 'svelte') {
      assert.ok(notice.includes(entry.text.trim()), 'NOTICE must preserve the actual distributed Svelte runtime license');
      continue;
    }
    if (entry.id === 'rust-unicode' || entry.id === 'rust-llvm-exception') {
      assert.ok(normalizedNotice.includes(entry.text.replace(/\s+/g, ' ').trim()), 'NOTICE must preserve the pinned standard-library license and exception terms');
      continue;
    }
    const terms = entry.text.trim();
    if (entry.id === 'blake3') {
      const copyright = terms.indexOf("Copyright 2019 Jack O'Connor and Samuel Neves");
      assert.ok(copyright > 0, 'Pinned BLAKE3 Apache notice boundary is missing');
      assert.ok(text.replace(/\s+/g, ' ').includes(terms.slice(0, copyright).replace(/\s+/g, ' ').trim()) &&
        normalizedNotice.includes(terms.slice(copyright).replace(/\s+/g, ' ').trim()),
      `LICENSE and NOTICE must preserve intact pinned runtime license terms: ${entry.sourcePin}`);
      continue;
    }
    // Shared MIT bodies stay complete; every distinct copyright stays intact.
    // Whitespace normalization is comparison-only, never closure capture.
    const permission = terms.indexOf('Permission is hereby granted');
    const parts = permission > 0 ? [terms.slice(0, permission), terms.slice(permission)] : [terms];
    assert.ok(parts.every(part => normalizedNotice.includes(part.replace(/\s+/g, ' ').trim())), `NOTICE must preserve intact pinned runtime license terms: ${entry.sourcePin}`);
  }
  assert.ok(/wasm-bindgen/i.test(notice) && /Rust/i.test(notice) && /Apache-2\.0|Apache License/.test(notice) && /MIT/.test(notice),
    'NOTICE must attribute the distributed WASM/Rust runtime terms');
}
async function validateDeployMetadata(projectRoot: string, files: readonly ArtifactBytes[], expectedEnvelope: CheckedInputs, identity: ReleaseIdentity): Promise<void> {
  const packageBytes = fileBytes(files, 'package.json');
  const pkg = parsed(packageBytes);
  assertSame(pkg, { name: 'back-in-the-family-artifact', version: '0.0.0', private: true, type: 'module',
    packageManager: 'pnpm@10.33.1', devDependencies: { '@types/node': '26.6.6', wrangler: '4.157.0' } },
  'Deploy package must be the exact Wrangler-only pinned metadata without application build scripts');
  assert.ok(await currentSourceCommit(projectRoot) === identity.sourceCommit, 'Checked source HEAD differs from release identity');
  const sourcePath = 'web/pnpm-lock.yaml';
  const healthy = await readRegularFile(join(projectRoot, sourcePath));
  assert.ok(digest(healthy) === expectedEnvelope.sourceDigests[sourcePath], 'Healthy SDK lock differs from independently checked source digest');
  const { stdout: committed } = await exec('git', ['-C', projectRoot, 'show', `${identity.sourceCommit}:${sourcePath}`],
    { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  assert.ok(healthy.equals(committed), 'Healthy SDK lock bytes differ from trusted source commit');
  validateSdkLock(fileBytes(files, 'pnpm-lock.yaml').toString('utf8'), healthy.toString('utf8'), packageBytes.toString('utf8'));
}
async function validateArtifactConfig(treeDir: string): Promise<void> {
  const path = join(treeDir, 'wrangler.jsonc');
  const { raw, config } = readWranglerConfig(path);
  assertSame(raw, artifactConfig(), 'Artifact config must match the exact disabled source-aligned API/SPA contract');
  assert.ok(config.main === join(treeDir, 'worker.js') && config.no_bundle === true, 'Artifact main must resolve to the checked in-root Worker without bundling');
  assert.ok(resolve(treeDir, config.assets?.directory ?? '') === join(treeDir, 'dist'), 'Artifact assets must resolve to in-root dist');
  assert.ok(config.compatibility_date === '2026-11-10' && config.send_metrics === false, 'Artifact runtime date/telemetry differ');
  assertSame(config.ai, { binding: 'AI', remote: false }, 'Artifact requires the native non-remote AI binding');
  assertSame(config.assets?.run_worker_first, ['/api', '/api/*'], 'Both API routing entries are required');
  assert.ok(config.assets?.binding === 'ASSETS' && config.assets.not_found_handling === 'single-page-application', 'Artifact assets binding/SPA fallback differ');
  assertSame(config.vars, { INFERENCE_ENABLED: 'false', MAX_REQUEST_BYTES: '16384' }, 'Artifact inference must be explicitly disabled at the measured transport policy');
}
/** Same public-tree checks used during preparation, staging and publication. */
export async function checkArtifact(projectRoot: string, treeDir: string, expectedEnvelope: CheckedInputs, identity: ReleaseIdentity): Promise<void> {
  validateIdentity(identity);
  assertSame(expectedEnvelope.identity, identity, 'Public check identity must come from trusted context');
  validateCheckedInputs(expectedEnvelope);
  const files = await readClosedTree(treeDir);
  assert.ok(files.every(file => publicRoots.includes(file.path) || file.path.startsWith('dist/')), 'Public tree contains a forbidden or unlisted root path');
  assertSame(files.map(file => file.path).sort(), [...publicRoots, ...expectedEnvelope.assets.map(file => `dist/${file.path}`)].sort(), 'Public artifact path set differs from checked manifest');
  // Semantic/privacy checks precede byte comparisons, so mutations exercise
  // their actual guard instead of being rejected only as a digest mismatch.
  assertPrivateContent(files);
  await validateArtifactConfig(treeDir);
  await validateDeployMetadata(projectRoot, files, expectedEnvelope, identity);
  validateLicenseTerms(files, expectedEnvelope.licenseClosure);
  const assets = files.filter(file => file.path.startsWith('dist/')).map(file => ({ ...file, path: file.path.slice(5) }));
  await validateAssets(projectRoot, assets, expectedEnvelope.wasm.sha256, identity.sourceCommit);
  checkReferences(files);
  assertSame(manifest(assets), expectedEnvelope.assets, 'Public assets differ in path, size or SHA256 from checked bytes');
  const worker = fileBytes(files, 'worker.js');
  assert.ok(worker.byteLength > 0 && worker.byteLength <= 26_214_400 && digest(worker) === expectedEnvelope.workerStamp.bundle, 'Public Worker differs from checked Worker stamp');
  for (const [path, sha] of Object.entries(expectedEnvelope.metadata)) assert.ok(digest(fileBytes(files, path)) === sha, 'Public metadata differs from independent checked digest');
  assertSame(parsed(fileBytes(files, 'provenance.json')), publicProvenance(expectedEnvelope), 'Public provenance differs from independently verified checked inputs');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    assertWorkerTools();
    const context = await artifactCliContext(process.argv.slice(2));
    assert.ok(!process.argv.includes('--output'), 'Check command cannot select a staging output');
    assert.ok(!context.prepare, 'Check command does not prepare or rebuild');
    const envelopeSHA = context.envelopeSHA;
    await verifyArtifactInputs(root, context.inputDir, { identity: context.identity, envelopeSHA });
    console.log(JSON.stringify({ identity: context.identity, envelopeSHA, checked: true }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Artifact check failed (contents redacted)');
    process.exitCode = 1;
  }
}
