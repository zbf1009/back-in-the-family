// llm-probe task 27: example tests for the Decision_Model gate, the approvals reader and the phase-status block.
// **Validates: Requirements 19.1, 19.4, 19.5, 19.17, 11.20**
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseApprovals } from '../../src/approvals.ts';
import { allowDecisionModel, formatDecisionModels, techRuntimeWarning } from '../../src/phase.ts';
import { baseState, DM_A, GEMMA, devRunInfo, dm, smokeRec, withdrawal } from './decision-gate.helpers.ts';

const wrap = (...entries: unknown[]): string => JSON.stringify({ schema: 'llm-probe-approvals-v1', approvals: entries });
const DM_ENTRY = { id: 'DM-001', kind: 'decision_model', step: 'dev', combination: 'workers-ai/clef-flash', task_subset: 'D', max_requests: 74, approved_on: '2026-11-10', note: 'n' };
const PLAN = { count: 74, mappingHash: 'h1' };

test('an S or DS subset is refused first, names the model and the Task_Type, and touches no state', () => {
  const state = baseState({ approvals: { approved: true, approvals: [dm('DM-1', DM_A, 'dev', 74)] } });
  const before = JSON.stringify(state, (_k, v) => (v instanceof Map || v instanceof Set ? [...v] : v));
  for (const subset of ['S', 'DS'] as const) {
    const r = allowDecisionModel('dev', DM_A, subset, state, PLAN);
    assert.equal(r.outcome, 'wrong_subset');
    assert.match(r.reason, /workers-ai\/clef-flash accepts Task_Type D only; requested (S|DS)/);
  }
  assert.equal(JSON.stringify(state, (_k, v) => (v instanceof Map || v instanceof Set ? [...v] : v)), before);
});

test('the reader rejects a smoke step, another step, a missing field, a non-D subset and a phase2 member', () => {
  assert.equal(parseApprovals(wrap(DM_ENTRY)).length, 1);
  assert.throws(() => parseApprovals(wrap({ ...DM_ENTRY, step: 'smoke' })), /smoke/);
  assert.throws(() => parseApprovals(wrap({ ...DM_ENTRY, step: 'resume' })), /step/);
  for (const k of ['combination', 'step', 'task_subset', 'max_requests', 'approved_on']) {
    const { [k]: _gone, ...rest } = DM_ENTRY as Record<string, unknown>;
    assert.throws(() => parseApprovals(wrap(rest)), new RegExp(`missing ${k}`));
  }
  for (const subset of ['S', 'DS', null]) assert.throws(() => parseApprovals(wrap({ ...DM_ENTRY, task_subset: subset })), /task_subset/);
  assert.throws(() => parseApprovals(wrap({ ...DM_ENTRY, phase2: 'P2-001' })), /phase2/);
});

test('the reader accepts a withdrawal of a decision_model entry and rejects one that names nothing or something else', () => {
  const W = { id: 'DM-W01', kind: 'withdrawal', withdraws: ['DM-001'], withdrawn_on: '2026-11-11', note: 'n' };
  assert.equal(parseApprovals(wrap(DM_ENTRY, W)).length, 2);
  assert.throws(() => parseApprovals(wrap(DM_ENTRY, { ...W, withdraws: ['nope'] })), /not a decision_model entry/);
  assert.throws(() => parseApprovals(wrap(DM_ENTRY, { ...W, withdraws: [] })), /withdraws/);
  assert.throws(() => parseApprovals(wrap(DM_ENTRY, { ...W, withdrawn_on: undefined })), /missing withdrawn_on/);
});

test('the committed approvals.json reads unchanged with the new reader', () => {
  const text = fs.readFileSync(path.join(import.meta.dirname, '../../approvals.json'), 'utf8');
  assert.deepEqual(parseApprovals(text), (JSON.parse(text) as { approvals: unknown[] }).approvals);
});

test('a branch-B approval and the existence of the set allow no Decision_Model step', () => {
  const approvals = [
    { id: 'P2-001', kind: 'phase2' as const, branch: 'B', model: GEMMA.model_id, task_subset: 'DS', approved_on: '2026-11-08' },
    { id: 'A-001', kind: 'dev' as const, combination: GEMMA.id, task_subset: 'DS', max_requests: 104, phase2: 'P2-001', approved_on: '2026-11-08' },
    { id: 'A-002', kind: 'locked' as const, combination: DM_A.id, task_subset: 'D', max_requests: 999, phase2: 'P2-001', approved_on: '2026-11-08' },
  ];
  const state = baseState({ approvals: { approved: true, approvals }, smoke: [smokeRec(DM_A, 'ok')], devRuns: [devRunInfo(DM_A, 'dev-1', 'h1')] });
  for (const step of ['dev', 'locked'] as const) assert.equal(allowDecisionModel(step, DM_A, 'D', state, PLAN).outcome, 'refused');
  // A smoke needs no approval at all (RC-10).
  assert.equal(allowDecisionModel('smoke', DM_A, 'D', state).outcome, 'allowed');
});

test('a full dev then locked sequence is allowed in order, and each condition refuses when it fails', () => {
  const ok = baseState({
    approvals: { approved: true, approvals: [dm('DM-1', DM_A, 'dev', 74), dm('DM-2', DM_A, 'locked', 236)] },
    smoke: [smokeRec(DM_A, 'ok')],
    devRuns: [devRunInfo(DM_A, 'dev-1', 'h1')],
  });
  assert.equal(allowDecisionModel('dev', DM_A, 'D', ok, PLAN).outcome, 'allowed');
  assert.equal(allowDecisionModel('locked', DM_A, 'D', ok, { count: 236, mappingHash: 'h1' }).outcome, 'allowed');
  assert.match((allowDecisionModel('dev', DM_A, 'D', ok, { count: 75, mappingHash: 'h1' }) as { reason: string }).reason, /exceed max_requests/);
  assert.match((allowDecisionModel('locked', DM_A, 'D', ok, { count: 236, mappingHash: 'h2' }) as { reason: string }).reason, /Template_Hash/);
  assert.match((allowDecisionModel('dev', DM_A, 'D', { ...ok, smoke: [] }, PLAN) as { reason: string }).reason, /Smoke_Call/);
  assert.match((allowDecisionModel('dev', DM_A, 'D', { ...ok, entries: [] }, PLAN) as { reason: string }).reason, /Phase_1 has not ended/);
  const withdrawn = { ...ok, approvals: { approved: true as const, approvals: [dm('DM-1', DM_A, 'dev', 74), withdrawal('W-1', 'DM-1')] } };
  assert.match((allowDecisionModel('dev', DM_A, 'D', withdrawn, PLAN) as { reason: string }).reason, /no unwithdrawn/);
});

test('phase-status block: none, then on hold with an approval, and the tech.md warning', () => {
  assert.deepEqual(formatDecisionModels(baseState()).slice(-1), ['runtime decision: not on hold']);
  const held = baseState({ approvals: { approved: true, approvals: [dm('DM-1', DM_A, 'dev', 74)] } });
  const text = formatDecisionModels(held).join('\n');
  assert.match(text, /decision_models:\n  workers-ai\/clef-flash  approvals dev: DM-1 \(max 74\); locked: none  ledger: none/);
  assert.match(text, /runtime decision: ON HOLD \(R19\.17\)/);
  assert.equal(techRuntimeWarning(held, '| LLM runtime | Pending. The shipped default | x |\n'), null);
  assert.match(techRuntimeWarning(held, '| LLM runtime | WebLLM Qwen | x |\n') ?? '', /no longer starts with "Pending"/);
  assert.equal(techRuntimeWarning(baseState(), '| LLM runtime | WebLLM | x |'), null);
});
