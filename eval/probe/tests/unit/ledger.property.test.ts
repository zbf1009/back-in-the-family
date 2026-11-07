import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import fc from 'fast-check';
import {
  appendAbort,
  appendComplete,
  appendResume,
  appendStart,
  LedgerError,
  planResume,
  readLedger,
  type PlannedRun,
} from '../../src/ledger.ts';
import {
  fingerprintId,
  readResultsFile,
  ResultsWriter,
  SCHEMA,
  type ModelKey,
  type ResultRecord,
  type ResultsHeader,
} from '../../src/results.ts';

// Feature: llm-probe, Property 24: The ledger is append-only and resumes the complement
// **Validates: Requirements 3.5, 3.7, 3.9, 12.8**

const root = mkdtempSync(path.join(tmpdir(), 'probe-ledger-prop-'));
after(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;

const FP = { engine: 'x', version: '1' };
const HASHES = { decision: 'h1' };
const identity = (key: ModelKey) => ({ model_key: key, fingerprint: FP, template_hashes: HASHES });

type RecKind = 'text' | 'timeout' | 'not_run' | 'engine_fault';
const isOutput = (k: RecKind): boolean => k === 'text' || k === 'timeout';

function record(h: ResultsHeader, run: PlannedRun, kind: RecKind): ResultRecord {
  const outcome =
    kind === 'text'
      ? { kind, text: 'x' }
      : kind === 'timeout'
        ? { kind }
        : kind === 'engine_fault'
          ? { kind, code: 'runtime_stuck', detail: '' }
          : { kind, reason: 'budget', detail: '' };
  const noLatency = kind === 'not_run' || kind === 'engine_fault';
  return {
    schema: SCHEMA.result,
    run_id: h.run_id,
    split: 'locked',
    card_id: run.card_id,
    permutation: run.permutation,
    outcome: outcome as ResultRecord['outcome'],
    latency_ms: noLatency ? null : 5,
    timeout_ms: h.timeout_ms,
    requested_at: '2026-11-07T09:00:00.000Z',
    template_hash: 'h1',
    fingerprint_id: fingerprintId(h.fingerprint),
    usage: null,
    late: kind === 'timeout' ? { kind: 'none', reason: 'error' } : null,
    source: 'headless',
  };
}

interface Run {
  id: string;
  key: ModelKey;
  header: ResultsHeader;
  writer: ResultsWriter;
  /** Kinds recorded so far per planned run, in append order (the model). */
  kinds: RecKind[][];
  running: boolean;
  complete: boolean;
}

type Op =
  | { e: 0 | 1; op: 'record'; run: number; kind: RecKind }
  | { e: 0 | 1; op: 'abort' | 'resume' | 'complete' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ e: fc.constantFrom<0 | 1>(0, 1), op: fc.constant('record' as const), run: fc.nat(99), kind: fc.constantFrom<RecKind>('text', 'timeout', 'not_run', 'engine_fault') }),
  fc.record({ e: fc.constantFrom<0 | 1>(0, 1), op: fc.constantFrom('abort' as const, 'resume' as const, 'complete' as const, 'complete' as const) }),
);

test('Property 24: ledger and Results files are append-only; resume plans exactly the runs without output; complete needs every output', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 2 }), fc.array(opArb, { maxLength: 30 }), (nCards, nPerms, ops) => {
      const dir = path.join(root, `case-${counter++}`);
      const ledger = path.join(dir, 'ledger.jsonl');
      const plan: PlannedRun[] = [];
      for (let c = 0; c < nCards; c++) for (let p = 0; p < nPerms; p++) plan.push({ card_id: `c${c}`, permutation: `p${p}`, task: 'decision' });

      // Two Locked_Runs with different Model_Keys (so the once-only rule does not interfere).
      const runs: Run[] = [0, 1].map((i) => {
        const key: ModelKey = { runtime: 'webllm', model_id: `m${i}`, quantization: 'q', revision: String(i).repeat(40) };
        const id = `L${i}`;
        const header: ResultsHeader = {
          schema: SCHEMA.header, run_id: id, split: 'locked', combination: `combo${i}`, model_key: key, task_subset: 'D',
          fingerprint: FP, template_hashes: HASHES, timeout_ms: 10000, placement: null,
        };
        appendStart(ledger, {
          entry_id: id, model_key: key, combination: `combo${i}`, task_subset: 'D', fingerprint: FP, template_hashes: HASHES,
          started_at: `2026-11-07T0${i}:00:00Z`, approval: null, planned: { decision: plan.length },
        });
        return { id, key, header, writer: ResultsWriter.create(dir, header), kinds: plan.map(() => []), running: true, complete: false };
      });

      const read = (f: string): string => readFileSync(f, 'utf8');
      const snap = (): string[] => [read(ledger), ...runs.map((r) => read(r.writer.file))];
      const outputs = (r: Run): boolean[] => r.kinds.map((ks) => ks.some(isOutput));
      const expectedMissing = (r: Run): PlannedRun[] => plan.filter((_, i) => !outputs(r)[i]);
      const fromFile = (r: Run): ResultRecord[] => readResultsFile(r.writer.file).records;

      let before = snap();
      for (const o of ops) {
        const r = runs[o.e] as Run;
        const touched = new Set<number>(); // 0 = ledger, 1.. = Results files
        if (o.op === 'record') {
          if (r.running && !r.complete) {
            const i = o.run % plan.length;
            r.writer.append(record(r.header, plan[i] as PlannedRun, o.kind));
            r.kinds[i]?.push(o.kind);
            touched.add(o.e + 1);
          }
        } else if (o.op === 'abort') {
          if (r.complete) {
            assert.throws(() => appendAbort(ledger, r.id, '2026-11-07T12:00:00Z', 'x'), (e: unknown) => e instanceof LedgerError && e.kind === 'bad_state');
          } else {
            appendAbort(ledger, r.id, '2026-11-07T12:00:00Z', 'budget');
            r.running = false;
            touched.add(0);
          }
        } else if (o.op === 'resume') {
          if (r.complete) {
            assert.throws(() => appendResume(ledger, r.id, '2026-11-07T13:00:00Z', identity(r.key)), (e: unknown) => e instanceof LedgerError && e.kind === 'bad_state');
          } else {
            appendResume(ledger, r.id, '2026-11-07T13:00:00Z', identity(r.key));
            r.running = true;
            touched.add(0);
            // Resume plans exactly the runs without an output record (not_run / engine_fault count as missing).
            const resumed = ResultsWriter.open(r.writer.file); // the same entry continues in the same file
            const records = fromFile(r);
            const missing = planResume(plan, records);
            assert.deepEqual(missing, expectedMissing(r));
            const kept = read(r.writer.file);
            for (const m of missing) {
              resumed.append(record(r.header, m, 'text'));
              r.kinds[plan.indexOf(m)]?.push('text');
            }
            if (missing.length > 0) touched.add(o.e + 1);
            // Recorded outputs are kept unchanged: the file only grew.
            assert.ok(read(r.writer.file).startsWith(kept));
            assert.deepEqual(planResume(plan, fromFile(r)), []);
          }
        } else if (r.complete) {
          assert.throws(() => appendComplete(ledger, r.id, { ended_at: '2026-11-07T14:00:00Z', results: 'x', requests_sent: 0 }, plan, fromFile(r)), (e: unknown) => e instanceof LedgerError && e.kind === 'bad_state');
        } else {
          const allOut = outputs(r).every(Boolean);
          const attempt = (): unknown => appendComplete(ledger, r.id, { ended_at: '2026-11-07T14:00:00Z', results: 'x', requests_sent: plan.length }, plan, fromFile(r));
          if (allOut) {
            attempt();
            r.complete = true;
            touched.add(0);
          } else {
            assert.throws(attempt, (e: unknown) => e instanceof LedgerError && e.kind === 'incomplete_run');
          }
        }

        // Prefix property for every file; untouched files are byte-identical (R12.8).
        const after_ = snap();
        after_.forEach((text, k) => {
          assert.ok(text.startsWith(before[k] as string), `file ${k} lost earlier bytes`);
          if (!touched.has(k)) assert.equal(text, before[k], `file ${k} changed without a write to it`);
        });
        before = after_;

        // Derived status is `complete` exactly when a `complete` event exists.
        const led = readLedger(ledger);
        for (const run of runs) {
          const entry = led.entries.find((x) => x.entry_id === run.id);
          assert.equal(entry?.status, run.complete ? 'complete' : 'incomplete');
          assert.equal(led.events.some((ev) => ev.event === 'complete' && ev.entry_id === run.id), run.complete);
          if (run.complete) assert.ok(outputs(run).every(Boolean), 'complete without an output for every planned run');
        }
      }
      assert.ok(existsSync(ledger));
    }),
    { numRuns: 60 },
  );
});
