import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const ALLOWED = new Set(['env.ts', 'adapters/workers-ai.ts', 'adapters/system-one.ts', 'smoke.ts', 'run-command.ts']);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [],
  );
}

test('loadWorkersAiEnv is referenced only by the Workers AI wiring', () => {
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    if (/loadWorkersAiEnv/.test(readFileSync(file, 'utf8'))) {
      assert.ok(ALLOWED.has(rel), `${rel} must not reference loadWorkersAiEnv`);
    }
  }
});

test('only Workers AI paths import env.ts at runtime', () => {
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const text = readFileSync(file, 'utf8');
    const runtimeImport = /^import\s+(?!type\b)[^;]*from\s+'(\.\.?\/)+env(\.ts)?'/m.test(text);
    if (runtimeImport) assert.ok(ALLOWED.has(rel), `${rel} must not import env.ts`);
  }
});
