// Import-graph isolation of the External_Reference code (llm-probe task 31.2; R19.16, R18.8; Property 46).
// `external.ts` may be imported only by `external-command.ts`, and that file only by the CLI. So the phase gate, the run
// gate, the ledger, the budget, the Metrics, the analysis, the marks, the link marks, the recommendations and the Phase_2
// branch code (all in phase.ts, phase-commands.ts, run*.ts, ledger.ts, budget.ts, approvals.ts, metrics.ts, stats.ts and
// report*.ts) cannot see an External_Reference. The Report gets the stored records as plain data (`ReportInput.external`).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');

/** Source text without block comments and full-line comments, so a sentence in a comment is not read as an import. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

/** Relative module specifiers of static imports, `export ... from` and dynamic `import('...')`, type-only ones included. */
function importsOf(file: string): string[] {
  const text = code(file);
  const specs = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m) => m[1] as string);
  return specs.map((s) => rel(path.resolve(path.dirname(file), s.endsWith('.ts') ? s : `${s}.ts`)));
}

const files = walk(SRC).map(rel).sort();
const graph = new Map(files.map((f) => [f, importsOf(path.join(SRC, f))] as const));

/** Files from which `target` can be reached by following imports, with the chain of the first path found. */
function reaches(from: string, target: string): string[] | null {
  const seen = new Set<string>([from]);
  const queue: string[][] = [[from]];
  while (queue.length > 0) {
    const chain = queue.shift() as string[];
    for (const next of graph.get(chain[chain.length - 1] as string) ?? []) {
      if (next === target) return [...chain, next];
      if (!seen.has(next) && graph.has(next)) {
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
  }
  return null;
}

const importersOf = (target: string): string[] => files.filter((f) => (graph.get(f) ?? []).includes(target));

test('the import-graph reader sees the real structure (guards against a reader that finds nothing)', () => {
  assert.ok(files.includes('external.ts') && files.includes('external-command.ts') && files.includes('phase.ts') && files.includes('report.ts'));
  assert.ok((graph.get('report-command.ts') ?? []).includes('report.ts'));
  assert.ok((graph.get('cli.ts') ?? []).includes('manifest.ts'));
  assert.ok(importersOf('metrics.ts').length >= 3);
});

test('only external-command.ts imports external.ts, and only cli.ts imports external-command.ts', () => {
  assert.deepEqual(importersOf('external.ts'), ['external-command.ts']);
  assert.deepEqual(importersOf('external-command.ts'), ['cli.ts']);
});

test('no module other than the CLI and the ingest command can reach external.ts', () => {
  const allowed = new Set(['cli.ts', 'external-command.ts', 'external.ts']);
  const offenders: string[] = [];
  for (const f of files) {
    if (allowed.has(f)) continue;
    const chain = reaches(f, 'external.ts');
    if (chain !== null) offenders.push(chain.join(' -> '));
  }
  assert.deepEqual(offenders, [], `these modules import external.ts, directly or through another module:\n${offenders.join('\n')}`);
});

test('the phase, run, ledger, budget, analysis, mark and Report code cannot reach external.ts', () => {
  const guarded = ['phase.ts', 'phase-commands.ts', 'run.ts', 'run-command.ts', 'ledger.ts', 'budget.ts', 'approvals.ts', 'metrics.ts', 'stats.ts', 'results.ts', 'report.ts', 'report-command.ts', 'diagnosis.ts', 'smoke.ts'];
  for (const g of guarded) {
    assert.ok(files.includes(g), `${g} is expected to exist`);
    assert.equal(reaches(g, 'external.ts'), null, `${g} must not import external.ts`);
  }
});

test('external.ts and external-command.ts send no request and read no env: no network, env, budget or adapter import', () => {
  const FORBIDDEN_IMPORTS = ['env.ts', 'budget.ts', 'approvals.ts', 'ledger.ts', 'phase.ts', 'smoke.ts', 'screen.ts', 'preflight.ts'];
  for (const f of ['external.ts', 'external-command.ts']) {
    const direct = graph.get(f) ?? [];
    for (const d of direct) {
      assert.ok(!d.startsWith('adapters/') && !d.startsWith('browser/'), `${f} must not import ${d}`);
      assert.ok(!FORBIDDEN_IMPORTS.includes(d), `${f} must not import ${d}`);
    }
    const text = code(path.join(SRC, f));
    assert.ok(!/\bfetch\s*\(|process\s*\.\s*env|loadWorkersAiEnv|XMLHttpRequest|WebSocket|node:https?|node:net/.test(text), `${f} must not use the network or the environment`);
  }
});

// Task 43 (R20.18 to R20.20, R19.16): the reader of the Author-supplied file lives in external.ts and is reached only through
// external-command.ts (and so only by the CLI). The Report gets its data as plain data and never imports external.ts.
test('the Author-supplied reader is named only in external.ts, external-command.ts and cli.ts (through the command module)', () => {
  const READERS = /\b(readAuthorSupplied|parseAuthorSupplied|AUTHOR_SUPPLIED_SCHEMA|AUTHOR_SUPPLIED_FILE)\b/;
  const users = files.filter((f) => READERS.test(code(path.join(SRC, f))));
  assert.deepEqual(users, ['external-command.ts', 'external.ts']);
  const loaderUsers = files.filter((f) => /\bloadAuthorSuppliedRecords\b/.test(code(path.join(SRC, f))));
  assert.deepEqual(loaderUsers, ['cli.ts', 'external-command.ts']);
  for (const g of ['report.ts', 'report-command.ts', 'report-variants.ts', 'phase.ts', 'phase-commands.ts', 'ledger.ts', 'budget.ts', 'approvals.ts', 'metrics.ts', 'run.ts', 'run-command.ts']) {
    assert.ok(files.includes(g), `${g} is expected to exist`);
    assert.equal(reaches(g, 'external.ts'), null, `${g} must not reach external.ts, so it cannot read the Author-supplied file`);
  }
});
