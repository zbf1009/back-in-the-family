import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  appendAbort,
  appendComplete,
  appendResume,
  appendStart,
  chooseReportEntries,
  decideOverlap,
  LedgerError,
  makeEntryId,
  planResume,
  readLedger,
  type PlannedRun,
  type StartRequest,
} from '../../src/ledger.ts';
import { ResultsFormatError, SCHEMA, type ModelKey, type ResultRecord, type TaskSubset } from '../../src/results.ts';

const root = mkdtempSync(path.join(tmpdir(), 'probe-ledger-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => path.join(root, `ledger-${n++}.jsonl`);
const read = (f: string): string => readFileSync(f, 'utf8');

const KEY: ModelKey = { runtime: 'webllm', model_id: 'Qwen3.5-2B-q4f32_1-MLC', quantization: 'q4f32_1', revision: 'a'.repeat(40) };
const FP = { engine: 'x', version: '1' };
const HASHES = { decision: 'h1', synthesis: 'h2' };

function req(id: string, subset: TaskSubset, at: string, extra: Partial<StartRequest> = {}): StartRequest {
  return {
    entry_id: id,
    model_key: KEY,
    combination: 'webllm/qwen3.5-2b-q4f32/nvidia',
    task_subset: subset,
    fingerprint: FP,
    template_hashes: HASHES,
    started_at: at,
    approval: null,
    planned: subset === 'D' ? { decision: 2 } : subset === 'S' ? { synthesis: 1 } : { decision: 2, synthesis: 1 },
    ...extra,
  };
}

const PLAN_DS: PlannedRun[] = [
  { card_id: 'c1', permutation: 'base', task: 'decision' },
  { card_id: 'c1', permutation: 'rot', task: 'decision' },
  { card_id: 's1', permutation: 'base', task: 'synthesis' },
];

function rec(card: string, perm: string, kind: 'text' | 'not_run' | 'timeout' | 'engine_fault'): ResultRecord {
  const outcome =
    kind === 'text'
      ? { kind, text: 'x' }
      : kind === 'timeout'
        ? { kind }
        : kind === 'engine_fault'
          ? { kind, code: 'runtime_stuck' as const, detail: '' }
          : { kind, reason: 'budget' as const, detail: '' };
  return {
    schema: SCHEMA.result, run_id: 'r', split: 'locked', card_id: card, permutation: perm, outcome: outcome as ResultRecord['outcome'],
    latency_ms: kind === 'not_run' || kind === 'engine_fault' ? null : 5, timeout_ms: 10000, requested_at: '2026-11-07T09:00:00.000Z',
    template_hash: 'h', fingerprint_id: 'fp', usage: null, late: kind === 'timeout' ? { kind: 'none', reason: 'error' } : null, source: 'headless',
  };
}
const ALL_OUT = [rec('c1', 'base', 'text'), rec('c1', 'rot', 'timeout'), rec('s1', 'base', 'text')];
const DONE = { ended_at: '2026-11-07T09:30:00.000Z', results: 'eval/results/locked/x.jsonl', requests_sent: 3 };

test('start then complete: status derived, start is the first line', () => {
  const f = fresh();
  const s = appendStart(f, req('L1', 'DS', '2026-11-07T09:00:00Z'));
  assert.equal(s.rerun_of, null);
  assert.deepEqual(s.overlaps, []);
  assert.equal(readLedger(f).entries[0]?.status, 'incomplete');
  appendComplete(f, 'L1', DONE, PLAN_DS, ALL_OUT);
  const l = readLedger(f);
  assert.equal(l.entries[0]?.status, 'complete');
  assert.equal(l.events.length, 2);
  assert.equal(read(f).split('\n').length, 3);
});

test('start, abort, resume, complete', () => {
  const f = fresh();
  appendStart(f, req('L1', 'DS', '2026-11-07T09:00:00Z'));
  appendAbort(f, 'L1', '2026-11-07T09:10:00Z', 'budget');
  let e = readLedger(f).entries[0];
  assert.equal(e?.status, 'incomplete');
  assert.equal(e?.abort_reason, 'budget');
  appendResume(f, 'L1', '2026-11-07T10:00:00Z', { model_key: KEY, fingerprint: FP, template_hashes: HASHES });
  e = readLedger(f).entries[0];
  assert.equal(e?.abort_reason, null);
  assert.equal(e?.resumes, 1);
  appendComplete(f, 'L1', DONE, PLAN_DS, ALL_OUT);
  assert.equal(readLedger(f).entries[0]?.status, 'complete');
  assert.throws(() => appendAbort(f, 'L1', '2026-11-07T11:00:00Z', 'x'), (e: unknown) => e instanceof LedgerError && e.kind === 'bad_state');
});

test('refuses a second run on a complete or incomplete overlapping entry and leaves the ledger unchanged', () => {
  for (const finish of [true, false]) {
    const f = fresh();
    appendStart(f, req('L1', 'DS', '2026-11-07T09:00:00Z'));
    if (finish) appendComplete(f, 'L1', DONE, PLAN_DS, ALL_OUT);
    const before = read(f);
    // Different hashes, sampling and Combination ID do not matter; a whitespace reason is no reason.
    const other = req('L2', 'S', '2026-11-08T09:00:00Z', { template_hashes: { decision: 'zz', synthesis: 'yy' }, combination: 'other/combo', rerun_reason: '   ' });
    assert.throws(
      () => appendStart(f, other),
      (e: unknown) => e instanceof LedgerError && e.kind === 'overlap' && e.entryIds.join() === 'L1' && e.message.includes('L1') && e.message.includes('--resume L1') === !finish,
    );
    assert.equal(read(f), before);
  }
});

test('re-run with a reason records rerun_of (latest start) and overlaps; earlier lines unchanged', () => {
  const f = fresh();
  appendStart(f, req('L1', 'D', '2026-11-07T09:00:00Z'));
  appendComplete(f, 'L1', DONE, PLAN_DS.slice(0, 2), ALL_OUT);
  appendStart(f, req('L2', 'D', '2026-11-08T09:00:00Z', { rerun_reason: 'fixed a template typo' }));
  const before = read(f);
  const s = appendStart(f, req('L3', 'DS', '2026-11-09T09:00:00Z', { rerun_reason: ' again ' }));
  assert.equal(s.rerun_of, 'L2');
  assert.deepEqual(s.overlaps, ['L1', 'L2']);
  assert.equal(s.rerun_reason, ' again ');
  assert.ok(read(f).startsWith(before));
  assert.equal(readLedger(f).entries.length, 3);
});

test('disjoint subsets (D then S) are not a re-run; a different Model_Key is not either', () => {
  const f = fresh();
  appendStart(f, req('L1', 'D', '2026-11-07T09:00:00Z'));
  const s = appendStart(f, req('L2', 'S', '2026-11-07T10:00:00Z'));
  assert.equal(s.rerun_of, null);
  assert.deepEqual(s.overlaps, []);
  const o = appendStart(f, req('L3', 'DS', '2026-11-07T11:00:00Z', { rerun_reason: 'r' }));
  assert.deepEqual(o.overlaps, ['L1', 'L2']);
  const entries = readLedger(f).entries;
  const d = decideOverlap(entries, { ...KEY, revision: 'b'.repeat(40) }, 'DS', null);
  assert.equal(d.kind, 'new');
});

test('resume mismatch on fingerprint, template hash or Model_Key; nothing appended', () => {
  const f = fresh();
  appendStart(f, req('L1', 'DS', '2026-11-07T09:00:00Z'));
  const before = read(f);
  const cases = [
    { model_key: KEY, fingerprint: { ...FP, version: '2' }, template_hashes: HASHES },
    { model_key: KEY, fingerprint: FP, template_hashes: { ...HASHES, decision: 'changed' } },
    { model_key: { ...KEY, revision: 'c'.repeat(40) }, fingerprint: FP, template_hashes: HASHES },
  ];
  for (const c of cases) {
    assert.throws(
      () => appendResume(f, 'L1', '2026-11-07T10:00:00Z', c),
      (e: unknown) => e instanceof LedgerError && e.kind === 'resume_mismatch' && /re-run/.test(e.message) && /not a resume/.test(e.message),
    );
  }
  assert.equal(read(f), before);
  assert.throws(() => appendResume(f, 'nope', '2026-11-07T10:00:00Z', cases[0]!), (e: unknown) => e instanceof LedgerError && e.kind === 'unknown_entry');
});

test('resume plan lists only runs without an output record; not_run and engine_fault count as missing', () => {
  const plan = planResume(PLAN_DS, [rec('c1', 'base', 'text'), rec('c1', 'rot', 'not_run'), rec('s1', 'base', 'engine_fault'), rec('zz', 'base', 'text')]);
  assert.deepEqual(plan.map((p) => `${p.card_id}/${p.permutation}`), ['c1/rot', 's1/base']);
  // A later output record for the same pair clears the not_run.
  assert.deepEqual(planResume(PLAN_DS, [...ALL_OUT, rec('c1', 'rot', 'not_run')]), []);
});

test('complete is refused while any planned run lacks an output record', () => {
  const f = fresh();
  appendStart(f, req('L1', 'DS', '2026-11-07T09:00:00Z'));
  const before = read(f);
  const partial = [rec('c1', 'base', 'text'), rec('c1', 'rot', 'not_run'), rec('s1', 'base', 'text')];
  assert.throws(() => appendComplete(f, 'L1', DONE, PLAN_DS, partial), (e: unknown) => e instanceof LedgerError && e.kind === 'incomplete_run' && e.message.includes('c1/rot'));
  assert.throws(() => appendComplete(f, 'L1', DONE, PLAN_DS.slice(0, 2), ALL_OUT), (e: unknown) => e instanceof LedgerError && e.kind === 'incomplete_run');
  assert.equal(read(f), before);
});

test('report entry is the earliest-started complete entry per Model_Key and Task_Type', () => {
  const f = fresh();
  appendStart(f, req('L1', 'D', '2026-11-07T09:00:00Z'));
  appendAbort(f, 'L1', '2026-11-07T09:05:00Z', 'oom');
  appendStart(f, req('L2', 'D', '2026-11-08T09:00:00Z', { rerun_reason: 'r' }));
  appendComplete(f, 'L2', DONE, PLAN_DS.slice(0, 2), ALL_OUT);
  appendStart(f, req('L3', 'DS', '2026-11-09T09:00:00Z', { rerun_reason: 'r' }));
  appendComplete(f, 'L3', DONE, PLAN_DS, ALL_OUT);
  const choice = chooseReportEntries(readLedger(f).entries);
  const d = choice.find((c) => c.task === 'decision');
  const s = choice.find((c) => c.task === 'synthesis');
  assert.equal(d?.used, 'L2');
  assert.deepEqual(d?.others, [{ entry_id: 'L1', label: 'incomplete' }, { entry_id: 'L3', label: 'rerun, not used' }]);
  assert.equal(s?.used, 'L3');
  assert.deepEqual(s?.others, []);
});

test('strict reader: unknown event, unknown field and bad sequence name file and line; file unchanged', () => {
  const f = fresh();
  appendStart(f, req('L1', 'D', '2026-11-07T09:00:00Z'));
  const good = read(f);
  const cases: [string, number][] = [
    [JSON.stringify({ schema: 'llm-probe-ledger-v1', event: 'pause', entry_id: 'L1', at: '2026-11-07T10:00:00Z' }), 2],
    [JSON.stringify({ schema: 'llm-probe-ledger-v1', event: 'resume', entry_id: 'L1', at: '2026-11-07T10:00:00Z', extra: 1 }), 2],
    [JSON.stringify({ schema: 'llm-probe-ledger-v1', event: 'resume', entry_id: 'L9', at: '2026-11-07T10:00:00Z' }), 2],
    ['not json', 2],
  ];
  for (const [line, lineNo] of cases) {
    writeFileSync(f, `${good}${line}\n`);
    const text = read(f);
    assert.throws(() => readLedger(f), (e: unknown) => e instanceof ResultsFormatError && e.file === f && e.line === lineNo);
    assert.equal(read(f), text);
  }
  assert.throws(() => appendStart(f, req('L5', 'S', '2026-11-08T09:00:00Z')), ResultsFormatError);
});

test('missing ledger is empty; makeEntryId is stable', () => {
  assert.deepEqual(readLedger(path.join(root, 'absent.jsonl')).entries, []);
  assert.equal(makeEntryId('2026-11-07T09:00:00Z', 'webllm/Qwen3.5 2B'), 'L-20261107T090000Z-webllm-qwen3-5-2b');
});
