import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  guard,
  llmContrast,
  llmGrade,
  llmIdentity,
  llmParseCard,
  llmPermutations,
  llmRenderPrompt,
  llmValidate,
  wasmSha256,
} from '../../src/simwasm.ts';

test('wasmSha256 is 64 lowercase hex characters', () => {
  assert.match(wasmSha256, /^[0-9a-f]{64}$/);
});

test('every export answers a bad input with an ok:false envelope', () => {
  const calls = [llmParseCard, llmPermutations, llmRenderPrompt, llmValidate, llmGrade, llmIdentity, llmContrast];
  for (const call of calls) {
    const out = JSON.parse(call('not json')) as { ok: boolean };
    assert.equal(out.ok, false, call.name);
  }
});

test('a WebAssembly.RuntimeError exits with status 2 naming export and Card ID', () => {
  let code = -1;
  const written: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((s: string) => (written.push(String(s)), true)) as typeof process.stderr.write;
  try {
    guard('llm_grade', 'dev-07', () => { throw new WebAssembly.RuntimeError('unreachable'); },
      (c) => { code = c; return undefined as never; });
  } finally {
    process.stderr.write = orig;
  }
  assert.equal(code, 2);
  assert.match(written.join(''), /llm_grade.*dev-07/);
});
