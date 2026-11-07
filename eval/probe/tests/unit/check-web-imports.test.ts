// Example tests for check-web-imports (llm-probe task 11.2, R3.16).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findWebImportViolations, type SourceFile } from '../../src/check-web-imports.ts';

const ROOT = '/repo';

function scan(files: SourceFile[]): string[] {
  return findWebImportViolations(files, ROOT).map((v) => `${v.file} -> ${v.resolved}`);
}

function one(file: string, text: string, extra: SourceFile[] = []): string[] {
  return scan([{ path: `/repo/web/${file}`, text }, ...extra]);
}

const HIT = (file: string, target: string): string => `/repo/web/${file} -> /repo/${target}`;

test('flags a relative import under eval/ with each quote style', () => {
  for (const q of ["'", '"', '`']) {
    assert.deepEqual(
      one('src/a.ts', `import x from ${q}../../eval/probe/src/cards.ts${q};`),
      [HIT('src/a.ts', 'eval/probe/src/cards.ts')],
    );
  }
});

test('flags multi-line imports, side-effect imports and export-from', () => {
  assert.deepEqual(
    one('src/a.ts', "import {\n  a,\n  b,\n} from '../../eval/x.ts';"),
    [HIT('src/a.ts', 'eval/x.ts')],
  );
  assert.deepEqual(one('src/a.ts', "import '../../eval/side.ts';"), [HIT('src/a.ts', 'eval/side.ts')]);
  assert.deepEqual(one('src/a.ts', "export * from '../../eval/all.ts';"), [HIT('src/a.ts', 'eval/all.ts')]);
  assert.deepEqual(
    one('src/a.ts', "export { q } from '../../eval/q.ts'; import type { T } from '../../eval/t.ts';"),
    [HIT('src/a.ts', 'eval/q.ts'), HIT('src/a.ts', 'eval/t.ts')],
  );
});

test('flags dynamic import and new URL(..., import.meta.url)', () => {
  assert.deepEqual(one('src/a.ts', "const m = await import('../../eval/dyn.ts');"), [HIT('src/a.ts', 'eval/dyn.ts')]);
  assert.deepEqual(
    one('src/a.ts', "const u = new URL('../../eval/cards/cards/dev.jsonl', import.meta.url);"),
    [HIT('src/a.ts', 'eval/cards/cards/dev.jsonl')],
  );
});

test('strips ?query and #hash suffixes before resolving', () => {
  assert.deepEqual(one('src/a.ts', "import t from '../../eval/t.txt?raw';"), [HIT('src/a.ts', 'eval/t.txt')]);
  assert.deepEqual(one('src/a.ts', "import t from '../../eval/t.txt?url#frag';"), [HIT('src/a.ts', 'eval/t.txt')]);
});

test('resolves .. segments that leave and re-enter eval/', () => {
  assert.deepEqual(one('src/a.ts', "import x from '../../web/../eval/y.ts';"), [HIT('src/a.ts', 'eval/y.ts')]);
  assert.deepEqual(one('src/a.ts', "import x from '../../eval/../crates/y.ts';"), []);
});

test('root-relative paths: /eval/... is flagged, /src/... (web root) is not', () => {
  assert.deepEqual(one('src/a.ts', "import x from '/eval/probe/z.ts';"), [HIT('src/a.ts', 'eval/probe/z.ts')]);
  assert.deepEqual(one('src/a.ts', "import x from '/src/main.ts';"), []);
  assert.deepEqual(one('index.html', '<script type="module" src="/src/main.ts"></script>'), []);
});

test('Svelte script blocks and HTML script/link attributes', () => {
  assert.deepEqual(
    one('src/App.svelte', "<script lang=\"ts\">\n  import c from '../../eval/c.ts';\n</script>\n<p>hi</p>"),
    [HIT('src/App.svelte', 'eval/c.ts')],
  );
  assert.deepEqual(
    one('index.html', '<script type="module" src="../eval/m.js"></script>\n<link rel="stylesheet" href="../eval/s.css?x=1">'),
    [HIT('index.html', 'eval/m.js'), HIT('index.html', 'eval/s.css')],
  );
});

test('ignores bare packages, URLs with a scheme and protocol-relative URLs', () => {
  assert.deepEqual(
    one(
      'src/a.ts',
      "import a from 'svelte'; import b from 'node:fs'; import c from 'https://x.test/eval/a.js'; import d from '//cdn.test/eval/a.js';",
    ),
    [],
  );
});

test('vite alias and tsconfig paths that map into eval/ are followed', () => {
  const vite: SourceFile = {
    path: '/repo/web/vite.config.ts',
    text: "export default { resolve: { alias: { 'probe-cards': fileURLToPath(new URL('../eval/cards', import.meta.url)) } } };",
  };
  // The config file itself is flagged too, because its alias target is under eval/.
  assert.deepEqual(one('src/a.ts', "import x from 'probe-cards/cards/dev.jsonl';", [vite]), [
    HIT('src/a.ts', 'eval/cards/cards/dev.jsonl'),
    HIT('vite.config.ts', 'eval/cards'),
  ]);
  const ts: SourceFile = {
    path: '/repo/web/tsconfig.app.json',
    text: '{ "compilerOptions": { "paths": { "ev/*": ["../eval"] } } }',
  };
  assert.deepEqual(one('src/a.ts', "import x from 'ev/probe/a.ts';", [ts]), [
    HIT('src/a.ts', 'eval/probe/a.ts'),
    HIT('tsconfig.app.json', 'eval'),
  ]);
});

test('the real sim-wasm alias maps to target/wasm-pkg and is not a violation', () => {
  const vite: SourceFile = {
    path: '/repo/web/vite.config.ts',
    text: "alias: { 'sim-wasm': fileURLToPath(new URL('../target/wasm-pkg', import.meta.url)) },",
  };
  assert.deepEqual(one('src/a.ts', "import init from 'sim-wasm/sim_wasm.js';", [vite]), []);
});

test('tsconfig extends / paths / references that point into eval/ are flagged', () => {
  const cfg: SourceFile = {
    path: '/repo/web/tsconfig.x.json',
    text: '{ "extends": "../eval/base.json", "references": [{ "path": "../eval/probe" }] }',
  };
  assert.deepEqual(scan([cfg]), [
    '/repo/web/tsconfig.x.json -> /repo/eval/base.json',
    '/repo/web/tsconfig.x.json -> /repo/eval/probe',
  ]);
});

test('a clean tree has no violations', () => {
  assert.deepEqual(
    scan([
      { path: '/repo/web/src/main.ts', text: "import App from './App.svelte';\nimport '../shared/x.ts';" },
      { path: '/repo/web/package.json', text: '{ "name": "web" }' },
    ]),
    [],
  );
});
