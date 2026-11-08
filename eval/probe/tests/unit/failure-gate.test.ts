// Phase gate and failure records (Author's gate fix, 2026-11-08): only a non-transient failure of a
// Locked_Run finishes Phase_1; Dev_Run failures and transient network errors never do. Includes the
// append-only correction of the legacy 2026-11-08T03:22Z record.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { hasFailure, phase1Finish, phase1Pending, type Combination, type PhaseState } from '../../src/phase.ts';
import { appendFailure, appendFailureCorrection, countsForGate, effectiveFailure, readFailures, SCHEMA, type FailureRecord } from '../../src/results.ts';
import { isTransientNetworkError } from '../../src/transient.ts';

const COMBO: Combination = { id: 'webllm/m/nvidia', runtime: 'webllm', model_id: 'M', quantization: 'q4', revision: 'a'.repeat(40), phase1_locked: true };

const state = (failures: FailureRecord[]): PhaseState => ({
  combinations: [COMBO],
  entries: [],
  failures,
  exclusions: [],
  smoke: [],
  approvals: { approved: true, approvals: [] },
  passes: new Map(),
  overLimit: new Set(),
});
const fail = (extra: Record<string, string | boolean | number | null>): FailureRecord => ({ schema: SCHEMA.failure, combination: COMBO.id, kind: 'model_load_failed', ...extra });

test('(a) a transient failure during a dev run does not finish Phase_1', () => {
  const f = fail({ run_kind: 'dev', transient: true, detail: 'TypeError: Failed to fetch' });
  assert.equal(hasFailure(COMBO, state([f])), false);
  assert.equal(phase1Finish(COMBO, state([f])), null);
  assert.equal(phase1Pending(state([f])).length, 1);
});

test('a non-transient dev failure and a transient locked failure do not finish Phase_1 either', () => {
  assert.equal(phase1Finish(COMBO, state([fail({ run_kind: 'dev', transient: false })])), null);
  assert.equal(phase1Finish(COMBO, state([fail({ run_kind: 'locked', transient: true })])), null);
});

test('(b) a non-transient failure during a locked run finishes Phase_1', () => {
  const f = fail({ run_kind: 'locked', transient: false, detail: 'out of memory' });
  assert.equal(phase1Finish(COMBO, state([f])), 'failure');
  assert.equal(phase1Pending(state([f])).length, 0);
});

test('legacy records with no run_kind: dev- run IDs read as dev, anything else as locked; transient comes from the matcher', () => {
  assert.deepEqual(effectiveFailure(fail({ run_id: 'dev-20261108T032118Z-x', detail: 'Failed to fetch' })), { run_kind: 'dev', transient: true });
  assert.deepEqual(effectiveFailure(fail({ run_id: '20261108T040000Z-x', detail: 'weights missing' })), { run_kind: 'locked', transient: false });
  assert.deepEqual(effectiveFailure(fail({})), { run_kind: 'locked', transient: false });
});

test('(c) a correction record is appended, the original line is untouched, and the legacy record reads as dev + transient', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'failures-'));
  const file = path.join(dir, 'failures.jsonl');
  // A legacy line: no run_kind, no transient, a run ID that does not start with dev- (a worst case for inference).
  const original = JSON.stringify({ schema: SCHEMA.failure, at: '2026-11-08T03:22:28.525Z', combination: COMBO.id, kind: 'model_load_failed', detail: 'page.evaluate: TypeError: Failed to fetch' }) + '\n';
  writeFileSync(file, original);
  assert.equal(countsForGate(readFailures(file)[0] as FailureRecord), false); // matcher already says transient, but run_kind reads locked
  assert.equal(effectiveFailure(readFailures(file)[0] as FailureRecord).run_kind, 'locked');
  appendFailureCorrection(file, {
    schema: SCHEMA.failureCorrection,
    combination: COMBO.id,
    target_at: '2026-11-08T03:22:28.525Z',
    run_kind: 'dev',
    transient: true,
    reason: 'test',
    at: '2026-11-08T09:00:00.000Z',
  });
  assert.ok(fs.readFileSync(file, 'utf8').startsWith(original), 'the original line is byte-identical and first');
  const read = readFailures(file);
  assert.equal(read.length, 1, 'correction lines are not returned as failures');
  assert.deepEqual(effectiveFailure(read[0] as FailureRecord), { run_kind: 'dev', transient: true });
  assert.equal(phase1Finish(COMBO, state(read)), null);
  // A correction for another timestamp changes nothing.
  appendFailureCorrection(file, { schema: SCHEMA.failureCorrection, combination: COMBO.id, target_at: '2026-01-01T00:00:00.000Z', run_kind: 'locked', transient: false, reason: 'other', at: '2026-11-08T09:01:00.000Z' });
  assert.deepEqual(effectiveFailure(readFailures(file)[0] as FailureRecord), { run_kind: 'dev', transient: true });
});

test('the committed failures.jsonl: the 03:22Z record is dev + transient and the original line is still there', () => {
  const file = path.resolve(import.meta.dirname, '../../../results/failures.jsonl');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('"at":"2026-11-08T03:22:28.525Z"') && text.includes('TypeError: Failed to fetch'));
  const rec = readFailures(file).find((f) => f['at'] === '2026-11-08T03:22:28.525Z') as FailureRecord;
  assert.deepEqual(effectiveFailure(rec), { run_kind: 'dev', transient: true });
  assert.equal(countsForGate(rec), false);
});

test('appendFailure sets the transient flag from the matcher when the caller gave none', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'failures-'));
  const file = path.join(dir, 'f.jsonl');
  appendFailure(file, fail({ run_kind: 'locked', detail: 'net::ERR_INTERNET_DISCONNECTED' }));
  appendFailure(file, fail({ run_kind: 'locked', detail: 'weights missing' }));
  appendFileSync(file, '');
  const [a, b] = readFailures(file);
  assert.equal(a?.['transient'], true);
  assert.equal(b?.['transient'], false);
});

test('property: the gate counts a record exactly when run_kind is locked and transient is false', () => {
  const kinds = fc.constantFrom('dev', 'locked');
  fc.assert(
    fc.property(kinds, fc.boolean(), fc.string(), (run_kind, transient, detail) => {
      const f = fail({ run_kind, transient, detail });
      assert.equal(hasFailure(COMBO, state([f])), run_kind === 'locked' && !transient);
    }),
  );
});

test('property: for records with no flags the gate follows the run ID prefix and the matcher', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.constantFrom('Failed to fetch', 'ECONNRESET', 'net::ERR_X', 'weights missing', 'out of memory'), (dev, detail) => {
      const f = fail({ run_id: dev ? 'dev-2026' : '2026-entry', detail });
      assert.equal(countsForGate(f), !dev && !isTransientNetworkError(detail));
    }),
  );
});
