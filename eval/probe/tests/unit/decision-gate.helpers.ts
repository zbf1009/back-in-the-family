// Fixtures for the Decision_Model gate tests (llm-probe task 27). Synthetic only; no card content.
import type { Approval } from '../../src/approvals.ts';
import { deriveEntries, LEDGER_SCHEMA, type LedgerEvent } from '../../src/ledger.ts';
import type { Combination, DevRunInfo, PhaseState } from '../../src/phase.ts';
import { SCHEMA, type ExclusionRecord, type FailureRecord, type SmokeRecord, type TaskSubset } from '../../src/results.ts';

const REV = 'a'.repeat(40);
export const BROWSER: Combination = { id: 'webllm/m1', runtime: 'webllm', model_id: 'Model-1', quantization: 'q4', revision: REV, phase1_locked: true };
const wai = (id: string, model: string, shape: string): Combination =>
  ({ id, runtime: 'workers-ai', model_id: model, quantization: '', revision: 'server-side, not pinnable', phase1_locked: false, response_shape: shape }) as unknown as Combination;
export const DM_A = wai('workers-ai/clef-flash', '@cf/cloudflare/clef-flash', 'system_one');
export const DM_B = wai('workers-ai/clef', '@cf/cloudflare/clef', 'system_one');
export const GEMMA = wai('workers-ai/gemma', '@cf/google/gemma-4-26b-a4b-it', 'chat');
export const COMBOS: readonly Combination[] = [BROWSER, DM_A, DM_B, GEMMA];

export function entryEvents(c: Combination, id: string, subset: TaskSubset, at: string, complete = true): LedgerEvent[] {
  const evs: LedgerEvent[] = [
    {
      schema: LEDGER_SCHEMA,
      event: 'start',
      entry_id: id,
      model_key: { runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision },
      combination: c.id,
      task_subset: subset,
      fingerprint: {},
      template_hashes: {},
      started_at: at,
      rerun_of: null,
      rerun_reason: null,
      overlaps: [],
      approval: null,
      planned: subset === 'DS' ? { decision: 1, synthesis: 1 } : subset === 'D' ? { decision: 1 } : { synthesis: 1 },
    },
  ];
  if (complete) evs.push({ schema: LEDGER_SCHEMA, event: 'complete', entry_id: id, ended_at: at, results: 'x', requests_sent: 1 });
  return evs;
}

/** Phase_1 has ended when the one browser Combination is complete for D and S; otherwise it is pending. */
export const phase1Entries = (ended: boolean) => deriveEntries(ended ? entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z') : []);

export const dm = (id: string, combination: Combination, step: 'dev' | 'locked', max: number): Approval => ({ id, kind: 'decision_model', step, combination: combination.id, task_subset: 'D', max_requests: max, approved_on: '2026-11-10', note: '' });
export const withdrawal = (id: string, ...ids: string[]): Approval => ({ id, kind: 'withdrawal', withdraws: ids, withdrawn_on: '2026-11-11', note: '' });
export const smokeRec = (c: Combination, check: string, declared = 'system_one'): SmokeRecord => ({ schema: SCHEMA.smoke, combination: c.id, shape_check: check, declared_shape: declared, http_status: 200 }) as SmokeRecord;
export const devRunInfo = (c: Combination, runId: string, hash: string): DevRunInfo => ({ run_id: runId, combination: c.id, task_subset: 'D', template_hashes: { decision: hash } });
export const exclusion = (c: Combination): ExclusionRecord => ({ schema: SCHEMA.exclusion, combination: c.id, model: c.model_id, check: 'vram', value: 3000, limit: 2600, at: '2026-11-05T00:00:00Z' });
export const failure = (c: Combination, runKind: 'dev' | 'locked', transient: boolean): FailureRecord =>
  ({ schema: SCHEMA.failure, combination: c.id, kind: 'http_error', run_kind: runKind, transient, run_id: `${runKind}-x` }) as FailureRecord;

export function baseState(over: Partial<PhaseState> = {}): PhaseState {
  return {
    combinations: COMBOS,
    entries: phase1Entries(true),
    failures: [],
    exclusions: [],
    smoke: [],
    approvals: { approved: true, approvals: [] },
    passes: new Map(),
    overLimit: new Set(),
    devRuns: [],
    ...over,
  };
}
