// Probe_Page build config, `page-serve` helper and import boundaries (llm-probe task 16.7;
// R10.2, R10.7, R10.11, DA-4 A).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import config, { PROBE_PAGE_DIST, PROBE_PAGE_PORT, PROBE_PAGE_ROOT } from '../../vite.config.ts';
import { deleteCommand, pageServe, shellQuote, type PageServeDeps } from '../../src/page-serve.ts';

const probeDir = fileURLToPath(new URL('../../', import.meta.url));
const repoDir = path.resolve(probeDir, '../..');

test('vite config builds into eval/probe/dist, never web/dist, with no COOP/COEP headers', () => {
  assert.equal(PROBE_PAGE_DIST, `${probeDir}dist/`);
  assert.equal(PROBE_PAGE_ROOT, `${probeDir}page/`);
  assert.equal(path.resolve(config.build?.outDir ?? ''), path.resolve(probeDir, 'dist'));
  assert.equal(config.build?.emptyOutDir, true);
  assert.ok(!path.resolve(config.build?.outDir ?? '').startsWith(path.join(repoDir, 'web')));
  assert.equal(PROBE_PAGE_PORT, 4318);
  assert.equal(config.preview?.port, 4318);
  assert.equal(config.preview?.host, 'localhost');
  assert.equal(config.server?.headers, undefined);
  assert.equal(config.preview?.headers, undefined);
  assert.equal(JSON.stringify(config).match(/cross-origin|coop|coep|require-corp/i), null);
  assert.equal(existsSync(`${repoDir}/web/public/_headers`), false);
});

function sourcesUnder(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|html)$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(path.join(dir, f), 'utf8') }));
}

const specifiers = (text: string): string[] => [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((m) => m[1] as string);

test('no source under eval/probe/page imports Node modules, eval/cards, web/ or a non-adapter runner module at runtime', () => {
  const files = sourcesUnder(`${probeDir}page`);
  assert.ok(files.length >= 4);
  for (const { file, text: whole } of files) {
    // Comments may name the rule; code and strings may not.
    const text = whole.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(text, /locked\.jsonl|dev\.jsonl|eval\/cards/, `${file} names a card file`);
    for (const spec of specifiers(text)) {
      assert.doesNotMatch(spec, /^node:/, `${file} imports ${spec}`);
      assert.doesNotMatch(spec, /cards\/|\/web\/|^\.\.\/\.\.\/web|^web\//, `${file} imports ${spec}`);
      const resolved = spec.startsWith('.') ? path.resolve(probeDir, 'page', spec.split('?')[0] as string) : null;
      if (resolved !== null) assert.ok(!resolved.startsWith(path.join(repoDir, 'eval', 'cards')) && !resolved.startsWith(path.join(repoDir, 'web')), `${file} reaches ${resolved}`);
    }
    // Runtime (non-type) imports from ../src may only be the engine-neutral adapter modules.
    for (const m of text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.\.\/src\/[^']+)'/gms)) {
      assert.match(m[1] as string, /^\.\.\/src\/adapters\/(gpu|webllm|transformers)\.ts$/, `${file} runtime-imports ${m[1]}`);
    }
  }
});

test('no source under web/src imports the probe page or its dist (the game cannot load it)', () => {
  const web = path.join(repoDir, 'web', 'src');
  for (const { file, text } of sourcesUnder(web)) {
    assert.doesNotMatch(text, /eval\/probe|probe\/dist/, file);
  }
});

// ---------------------------------------------------------------- page-serve

interface Rec {
  deps: PageServeDeps;
  printed: string[];
  errors: string[];
  made: string[];
  removed: string[];
  log: string[];
}

function rec(over: Partial<PageServeDeps> = {}): Rec {
  const r: Rec = { deps: null as never, printed: [], errors: [], made: [], removed: [], log: [] };
  r.deps = {
    makeProfileDir: async (prefix) => {
      const d = `/tmp/${prefix}XYZ123`;
      r.made.push(d);
      r.log.push('profile');
      return d;
    },
    removeDir: async (d) => void r.removed.push(d),
    build: async () => void r.log.push('build'),
    serve: async () => {
      r.log.push('serve');
      return { url: 'http://localhost:4318/', close: async () => void r.log.push('close') };
    },
    waitForStop: async () => void r.log.push('stop'),
    print: (l) => void r.printed.push(l),
    printError: (l) => void r.errors.push(l),
    ...over,
  };
  return r;
}

test('page-serve: new profile first, then build, then serve; prints the profile, the Chrome command and the delete command', async () => {
  const r = rec();
  assert.equal(await pageServe(r.deps), 0);
  assert.deepEqual(r.log, ['profile', 'build', 'serve', 'stop', 'close']);
  const out = r.printed.join('\n');
  assert.match(out, /http:\/\/localhost:4318\//);
  assert.match(out, /Fresh_Profile \(new, empty\): \/tmp\/llm-probe-profile-XYZ123/);
  assert.match(out, /google-chrome --user-data-dir='\/tmp\/llm-probe-profile-XYZ123'/);
  assert.match(out, /rm -rf -- '\/tmp\/llm-probe-profile-XYZ123'/);
  assert.deepEqual(r.removed, [], 'the profile is kept for the Author; the printed command deletes it');
});

test('page-serve: a build failure exits non-zero, serves nothing and removes the empty profile', async () => {
  const r = rec({ build: async () => Promise.reject(new Error('rolldown: boom')) });
  assert.equal(await pageServe(r.deps), 1);
  assert.deepEqual(r.errors, ['page-serve: rolldown: boom']);
  assert.deepEqual(r.removed, r.made);
  assert.ok(!r.log.includes('serve'));
});

test('shell quoting keeps a hostile path inside one word', () => {
  assert.equal(shellQuote("/tmp/a b'c"), `'/tmp/a b'\\''c'`);
  assert.equal(deleteCommand('/tmp/x'), "rm -rf -- '/tmp/x'");
});
