import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { findWebImportViolations, type SourceFile } from '../../src/check-web-imports.ts';

// Feature: llm-probe, Property 35 (import half): the web import check finds every eval/ import
// **Validates: Requirements 3.16, 16.2**
// The Deploy_Directory half lives in web/tests/unit/check-deploy.test.ts.

const ROOT = '/repo';
const seg = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);
const suffixArb = fc.constantFrom('', '?raw', '?url', '?x=1#frag', '#hash');
const quoteArb = fc.constantFrom("'", '"', '`');

type Form = 'from' | 'type' | 'multi' | 'side' | 'star' | 'reexport' | 'dynamic' | 'url';
const formArb = fc.constantFrom<Form>(
  'from', 'type', 'multi', 'side', 'star', 'reexport', 'dynamic', 'url',
);

function statement(form: Form, q: string, spec: string): string {
  const s = `${q}${spec}${q}`;
  switch (form) {
    case 'from': return `import x from ${s};`;
    case 'type': return `import type { T } from ${s};`;
    case 'multi': return `import {\n  a,\n  b,\n} from ${s};`;
    case 'side': return `import ${s};`;
    case 'star': return `export * from ${s};`;
    case 'reexport': return `export { a } from ${s};`;
    case 'dynamic': return `const m = await import(${s});`;
    case 'url': return `const u = new URL(${s}, import.meta.url);`;
  }
}

// Target kinds: hit = under eval/, the rest must never be flagged.
type Kind = 'evalRel' | 'evalRoot' | 'evalAlias' | 'webRel' | 'nodeModules' | 'bare' | 'literal';
const kindArb = fc.constantFrom<Kind>(
  'evalRel', 'evalRoot', 'evalAlias', 'webRel', 'nodeModules', 'bare', 'literal',
);

const stmtArb = fc.record({
  kind: kindArb,
  form: formArb,
  q: quoteArb,
  segs: fc.array(seg, { minLength: 1, maxLength: 3 }),
  leaf: fc.constantFrom('a.ts', 'b.json', 'c.txt', 'd.svelte'),
  suffix: suffixArb,
});

const fileArb = fc.record({
  dir: fc.array(seg, { maxLength: 3 }),
  name: seg,
  stmts: fc.array(stmtArb, { maxLength: 6 }),
});

test('Property 35: the violation set equals exactly the eval/ imports', () => {
  fc.assert(
    fc.property(fc.uniqueArray(fileArb, { maxLength: 6, selector: (f) => `${f.dir.join('/')}/${f.name}` }), (specs) => {
      const files: SourceFile[] = [];
      const expected = new Set<string>();
      let usedAlias = false;
      for (const f of specs) {
        const file = path.posix.join(ROOT, 'web', 'src', ...f.dir, `${f.name}.ts`);
        const lines: string[] = [];
        for (const s of f.stmts) {
          const tail = [...s.segs, s.leaf].join('/');
          let spec: string | undefined;
          let hit: string | undefined;
          const rel = (target: string): string => {
            const r = path.posix.relative(path.posix.dirname(file), target);
            return r.startsWith('.') ? r : `./${r}`;
          };
          switch (s.kind) {
            case 'evalRel':
              hit = path.posix.join(ROOT, 'eval', tail);
              spec = rel(hit) + s.suffix;
              break;
            case 'evalRoot':
              hit = path.posix.join(ROOT, 'eval', tail);
              spec = `/eval/${tail}${s.suffix}`;
              break;
            case 'evalAlias':
              hit = path.posix.join(ROOT, 'eval', 'data', tail);
              spec = `evalx/${tail}${s.suffix}`;
              usedAlias = true;
              break;
            case 'webRel':
              spec = rel(path.posix.join(ROOT, 'web', 'src', tail)) + s.suffix;
              break;
            case 'nodeModules':
              spec = rel(path.posix.join(ROOT, 'web', 'node_modules', tail)) + s.suffix;
              break;
            case 'bare':
              spec = `evaluate/${tail}`;
              break;
            case 'literal':
              lines.push(`const s = ${s.q}../../eval/${tail}${s.q};`);
              continue;
          }
          lines.push(statement(s.form, s.q, spec));
          if (hit !== undefined) expected.add(`${file} -> ${hit}`);
        }
        files.push({ path: file, text: lines.join('\n') });
      }
      if (usedAlias) {
        const vite = path.posix.join(ROOT, 'web', 'vite.config.ts');
        files.push({
          path: vite,
          text: "alias: { 'evalx': fileURLToPath(new URL('../eval/data', import.meta.url)) },",
        });
        expected.add(`${vite} -> ${ROOT}/eval/data`);
      }
      const got = findWebImportViolations(files, ROOT).map((v) => `${v.file} -> ${v.resolved}`);
      assert.deepEqual([...got].sort(), [...expected].sort());
      for (const v of got) assert.ok(!v.includes('node_modules'));
    }),
    { numRuns: 300 },
  );
});
