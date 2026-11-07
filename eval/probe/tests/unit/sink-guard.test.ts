// Only sink.ts may write files or console streams (R11.3).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const FORBIDDEN =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|writeSync)\b|\bconsole\s*\.|process\s*\.\s*(stdout|stderr)/;

test('no module under src/ except sink.ts writes files or console streams directly', () => {
  const offenders: string[] = [];
  for (const entry of readdirSync(srcDir, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts') || entry === 'sink.ts') continue;
    const lines = readFileSync(`${srcDir}${entry}`, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line)) offenders.push(`${entry}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
