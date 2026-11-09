// Property 48 (llm-probe task 31.5): the Report counts Phase_2 candidates and prints the selection-bias note.
// **Validates: Requirements 19.13, 19.17, 18.8**
// Synthetic ledger, Dev_Run, approval, failure and Exclusion content; no card content and no real file is read.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import type { Approval } from '../../src/approvals.ts';
import { deriveEntries, type LedgerEvent } from '../../src/ledger.ts';
import type { Combination, DevRunInfo } from '../../src/phase.ts';
import { additionalCandidateLines, buildReport, HOLD_BANNER_PREFIX, SELECTION_BIAS_NOTE, type ReportInput } from '../../src/report.ts';
import { SCHEMA, type ExclusionRecord, type FailureRecord, type SmokeRecord } from '../../src/results.ts';
import { baseState, BROWSER, DM_A, DM_B, GEMMA, dm, entryEvents, exclusion, failure, smokeRec, withdrawal } from './decision-gate.helpers.ts';

const GLM: Combination = { id: 'workers-ai/glm', runtime: 'workers-ai', model_id: '@cf/zai-org/glm-4.7-flash', quantization: '', revision: 'server-side, not pinnable', phase1_locked: false, response_shape: 'chat' } as Combination;
const COMBOS: readonly Combination[] = [BROWSER, GEMMA, DM_A, DM_B, GLM];
const WORKERS = [GEMMA, DM_A, DM_B, GLM] as const;

const flagsArb = fc.record({
  ledger: fc.constantFrom('none', 'complete', 'incomplete'),
  dev: fc.constantFrom('none', 'attempted', 'refused'),
  smokes: fc.nat(3),
  exclusion: fc.boolean(),
  lockedFailure: fc.boolean(),
  devFailure: fc.boolean(),
  devApproval: fc.boolean(),
  lockedApproval: fc.boolean(),
  withdrawDev: fc.boolean(),
  withdrawLocked: fc.boolean(),
});
const specArb = fc.record({
  gemma: flagsArb,
  a: flagsArb,
  b: flagsArb,
  glm: flagsArb,
  phase2: fc.boolean(),
  approvalsReadable: fc.boolean(),
  browserSmoke: fc.nat(2),
});
type Flags = typeof FLAG_SHAPE;
const FLAG_SHAPE = {
  ledger: 'none' as 'none' | 'complete' | 'incomplete',
  dev: 'none' as 'none' | 'attempted' | 'refused',
  smokes: 0,
  exclusion: false,
  lockedFailure: false,
  devFailure: false,
  devApproval: false,
  lockedApproval: false,
  withdrawDev: false,
  withdrawLocked: false,
};

interface Built {
  readonly input: ReportInput;
  readonly flagsOf: ReadonlyMap<string, Flags>;
  readonly approvals: readonly Approval[];
}

function build(spec: { gemma: Flags; a: Flags; b: Flags; glm: Flags; phase2: boolean; approvalsReadable: boolean; browserSmoke: number }): Built {
  const flagsOf = new Map<string, Flags>([
    [GEMMA.id, spec.gemma],
    [DM_A.id, spec.a],
    [DM_B.id, spec.b],
    [GLM.id, spec.glm],
  ]);
  const events: LedgerEvent[] = entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z');
  const devRuns: DevRunInfo[] = [];
  const failures: FailureRecord[] = [];
  const exclusions: ExclusionRecord[] = [];
  const smoke: SmokeRecord[] = [];
  const approvals: Approval[] = [];
  if (spec.phase2) approvals.push({ id: 'P2-001', kind: 'phase2', branch: 'B', combination: GEMMA.id, model: GEMMA.model_id, task_subset: 'DS', approved_on: '2026-11-08', note: '' });
  let n = 0;
  for (const c of WORKERS) {
    const f = flagsOf.get(c.id) as Flags;
    const isDm = c.id === DM_A.id || c.id === DM_B.id;
    n++;
    if (f.ledger !== 'none') events.push(...entryEvents(c, `W-${n}`, isDm ? 'D' : 'DS', `2026-11-09T0${n}:00:00Z`, f.ledger === 'complete'));
    if (f.dev !== 'none') devRuns.push({ run_id: `dev-${n}`, combination: c.id, task_subset: isDm ? 'D' : 'DS', template_hashes: {}, attempted: f.dev === 'attempted' });
    for (let i = 0; i < f.smokes; i++) smoke.push(smokeRec(c, 'ok', c.response_shape));
    if (f.exclusion) exclusions.push(exclusion(c));
    if (f.lockedFailure) failures.push(failure(c, 'locked', false));
    if (f.devFailure) failures.push(failure(c, 'dev', false));
    if (isDm) {
      const dev = `${c.id}-dev`;
      const locked = `${c.id}-locked`;
      if (f.devApproval) approvals.push(dm(dev, c, 'dev', 74));
      if (f.lockedApproval) approvals.push(dm(locked, c, 'locked', 236));
      const gone = [...(f.withdrawDev && f.devApproval ? [dev] : []), ...(f.withdrawLocked && f.lockedApproval ? [locked] : [])];
      if (gone.length > 0) approvals.push(withdrawal(`${c.id}-w`, ...gone));
    }
  }
  for (let i = 0; i < spec.browserSmoke; i++) smoke.push(smokeRec(BROWSER, 'ok', 'chat'));
  const input: ReportInput = {
    generated_on: '2026-11-09',
    environment: { targetMachine: 'Test machine', workersEndpoint: null },
    state: {
      combinations: COMBOS,
      entries: deriveEntries(events),
      failures,
      exclusions,
      smoke,
      approvals: spec.approvalsReadable ? { approved: true, approvals } : { approved: false, reason: 'test: unreadable' },
      devRuns,
    },
    lockedRuns: [],
    incompleteFaults: new Map(),
    devRuns: [],
    preflights: new Map(),
    runtimeLibraries: [],
  };
  return { input, flagsOf, approvals: spec.approvalsReadable ? approvals : [] };
}

const section = (report: string, from: string, to: string): string => {
  const start = report.indexOf(`\n## ${from}`);
  const end = report.indexOf(`\n## ${to}`);
  assert.ok(start >= 0 && end > start, `sections ${from} to ${to} found`);
  return report.slice(start, end);
};

test('Property 48: the Report counts Phase_2 candidates, prints the selection-bias note, the Additional_Candidate_Set and the hold banner', () => {
  const seen = { counts: new Set<number>(), banner: 0, noBanner: 0, notMeasured: 0 };
  fc.assert(
    fc.property(specArb, (spec) => {
      const b = build(spec as Parameters<typeof build>[0]);
      const report = buildReport(b.input);
      const s2 = section(report, '2. ', '3. ');

      // Independent oracle for the count: distinct Workers AI Combinations with a ledger entry or an attempted Dev_Run.
      const tried = WORKERS.filter((c) => {
        const f = b.flagsOf.get(c.id) as Flags;
        return f.ledger !== 'none' || f.dev === 'attempted';
      }).map((c) => c.id);
      const count = /Phase_2 candidates tried: (\d+)/.exec(s2);
      assert.ok(count !== null, 'section 2 states the count');
      assert.equal(Number(count[1]), tried.length);
      for (const id of tried) assert.ok(s2.includes(id));
      seen.counts.add(tried.length);

      // The note appears exactly when the count is 2 or more, in section 2 only, and says the Thresholds were not adjusted.
      assert.equal(s2.includes(SELECTION_BIAS_NOTE), tried.length >= 2);
      assert.equal(report.split(SELECTION_BIAS_NOTE).length - 1, tried.length >= 2 ? 1 : 0);
      assert.match(SELECTION_BIAS_NOTE, /The Thresholds were not adjusted for it\./);

      // The Additional_Candidate_Set: each Decision_Model with its approval IDs, or "not measured" with a reason.
      const gone = new Set(b.approvals.filter((a) => a.kind === 'withdrawal').flatMap((a) => a.withdraws ?? []));
      let anyHold = false;
      const pending: string[] = [];
      for (const c of [DM_A, DM_B]) {
        const f = b.flagsOf.get(c.id) as Flags;
        const line = s2.split('\n').find((l) => l.startsWith(`- ${c.id} (Task_Type D only)`));
        assert.ok(line !== undefined, `${c.id} has a line in section 2`);
        const live = b.approvals.filter((a) => a.kind === 'decision_model' && a.combination === c.id && !gone.has(a.id));
        const ended = (f.ledger === 'complete') || f.exclusion || f.lockedFailure;
        if (live.length > 0) {
          const listed = /approval IDs ([^;]*?)(?:;|\. Repeat)/.exec(line)?.[1] ?? '';
          for (const a of live) assert.ok(listed.includes(a.id), `${a.id} is listed`);
          for (const id of gone) assert.ok(!listed.includes(id), `withdrawn ${id} is not listed as an approval`);
        }
        if (live.length === 0 && !ended) {
          assert.match(line, /not measured: \S/);
          seen.notMeasured++;
        }
        assert.match(line, /Repeat-request determinism of `choice` \(V14\): not tested\./);
        if (live.length > 0 && !ended) {
          anyHold = true;
          pending.push(c.id);
        }
      }

      // The hold banner of section 9 appears exactly when some approved Decision_Model is not finished.
      const s9 = section(report, '9. ', '10. ');
      assert.equal(s9.includes(HOLD_BANNER_PREFIX), b.input.state.approvals.approved && anyHold);
      if (b.input.state.approvals.approved && anyHold) {
        assert.ok(s9.includes(`${HOLD_BANNER_PREFIX}${pending.join(', ')}`));
        seen.banner++;
      } else seen.noBanner++;
      assert.equal(report.split(HOLD_BANNER_PREFIX).length - 1, b.input.state.approvals.approved && anyHold ? 1 : 0, 'the banner is printed once, in section 9');

      // R18.8: the branch, the approval date and the branch-B model are printed as before.
      assert.match(s2, /Phase_1 \(in-browser Combinations\): ended\./);
      assert.match(s2, /Phase_2 branch taken: \*\*B\*\* \(Task_Type_Subset DS\)/);
      if (spec.phase2 && spec.approvalsReadable) assert.match(s2, /Author's Phase_2 approval: P2-001, approved on 2026-11-08, branch B, approved model @cf\/google\/gemma-4-26b-a4b-it, Task_Type_Subset DS\./);
      else if (spec.approvalsReadable) assert.match(s2, /Author's Phase_2 approval: none recorded; Phase_2 has not started\./);
    }),
    { numRuns: 400 },
  );
  assert.ok([0, 1, 2, 3].every((n) => seen.counts.has(n)), `coverage of counts: ${[...seen.counts].join(',')}`);
  assert.ok(seen.banner >= 10 && seen.noBanner >= 10 && seen.notMeasured >= 10, JSON.stringify(seen));
});

test('the Report of a repository-like state counts one Phase_2 candidate, prints no bias note, and lists the Decision_Models as not measured', () => {
  const events: LedgerEvent[] = [...entryEvents(BROWSER, 'L-1', 'DS', '2026-11-01T09:00:00Z'), ...entryEvents(GEMMA, 'L-9', 'DS', '2026-11-09T01:00:00Z')];
  const input: ReportInput = {
    generated_on: '2026-11-09',
    environment: { targetMachine: 'Test machine', workersEndpoint: null },
    state: { combinations: COMBOS, entries: deriveEntries(events), failures: [], exclusions: [], smoke: [smokeRec(GEMMA, 'ok', 'chat')], approvals: { approved: true, approvals: [] }, devRuns: [] },
    lockedRuns: [],
    incompleteFaults: new Map(),
    devRuns: [],
    preflights: new Map(),
    runtimeLibraries: [],
  };
  const report = buildReport(input);
  const s2 = section(report, '2. ', '3. ');
  assert.match(s2, /Phase_2 candidates tried: 1 \(workers-ai\/gemma\)/);
  assert.ok(!report.includes(SELECTION_BIAS_NOTE));
  assert.match(s2, /- workers-ai\/clef-flash \(Task_Type D only\): not measured: no Dev_Run or Locked_Run approval has been recorded for it/);
  assert.match(s2, /- workers-ai\/clef \(Task_Type D only\): not measured: /);
  assert.ok(!report.includes(HOLD_BANNER_PREFIX));
});

test('a Decision_Model whose newest Smoke_Call failed with an HTTP error is listed as not measured with that status (V13)', () => {
  const billing = { schema: SCHEMA.smoke, combination: DM_A.id, http_status: 403, outcome: 'remote_error' } as unknown as SmokeRecord;
  const state = baseState({ combinations: COMBOS, smoke: [billing] });
  const line = additionalCandidateLines(state).find((l) => l.startsWith(`- ${DM_A.id}`));
  assert.match(line ?? '', /not measured: the newest Smoke_Call failed with HTTP status 403 \(remote_error\)/);
});

test('section 12 says so when nothing is ingested, and flags a figure that differs from its re-grade', async () => {
  const { externalSectionLines } = await import('../../src/report.ts');
  assert.deepEqual(externalSectionLines([]), ['## 12. External reference (not a repo Combination)', '', 'No External_Reference has been ingested.', '']);
  const fig = { acceptable: 30, scored_cards: 40, severe: 0, illegal: 1, flip_perms: 20, flips: 1, consistent_pairs: 5, pairs: 6 };
  const text = externalSectionLines([
    {
      label: 'teacher',
      reference_model: 'Teacher 1',
      task_type: 'D',
      pinned_manifest_hash: 'a'.repeat(64),
      reference_sha256: 'b'.repeat(64),
      config: { file: 'config.json', sha256: 'c'.repeat(64) },
      ledger: { file: 'ledger.jsonl', sha256: 'd'.repeat(64) },
      results: { file: 'results.jsonl', sha256: 'e'.repeat(64) },
      raw_outputs: { file: 'raw.jsonl', sha256: 'f'.repeat(64), answer_mode: 'json' },
      supplied: fig,
      regrade: 'mismatch',
      regrade_figures: { ...fig, acceptable: 28 },
      differing: ['acceptable'],
      raw_output_count: 236,
    },
  ]).join('\n');
  assert.match(text, /This is an external reference measurement, not a Combination of this repository; it is not part of any mark, link mark, recommendation, Phase_2 branch logic or the Locked_Run_Ledger\./);
  assert.match(text, /\| Acceptable rate \| 30\/40 = 75\.0% \| 28\/40 = 70\.0% \| MISMATCH \|/);
  assert.match(text, /\| Severe count \| 0 of 40 cards \| 0 of 40 cards \| match \|/);
  assert.match(text, /\| Flip rate \| 1\/20 = 5\.0% \| 1\/20 = 5\.0% \| match \|/);
  assert.match(text, /Re-grade: MISMATCH in acceptable\./);
});
