import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  guard,
  llmAggregatePermAvg,
  llmContrast,
  llmGrade,
  llmIdentity,
  llmParseCard,
  llmPermutations,
  llmRenderPrompt,
  llmRenderSystemOne,
  llmValidate,
  wasmSha256,
  withMode,
} from '../../src/simwasm.ts';

test('wasmSha256 is 64 lowercase hex characters', () => {
  assert.match(wasmSha256, /^[0-9a-f]{64}$/);
});

test('every export answers a bad input with an ok:false envelope', () => {
  const calls = [llmParseCard, llmPermutations, llmRenderPrompt, llmRenderSystemOne, (input: string) => llmValidate(input, 'json'), llmGrade, llmIdentity, llmContrast, llmAggregatePermAvg];
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

test('withMode inserts the mode member and leaves every other byte alone', () => {
  assert.equal(withMode('{"a":1}', 'raw_choice'), '{"mode":"raw_choice","a":1}');
  assert.equal(withMode(' {}', 'json'), ' {"mode":"json"}');
  assert.equal(withMode('{ }', 'json'), '{"mode":"json" }');
  assert.equal(withMode('not json', 'json'), 'not json');
  assert.equal(withMode('', 'json'), '');
});
