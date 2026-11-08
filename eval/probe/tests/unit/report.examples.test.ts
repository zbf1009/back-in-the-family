// Example tests for the Report generator (llm-probe task 10.4; requirements 3.8, 14.7, 15.4 to
// 15.7, 15.11, 15.12, 18.6, 18.8). Everything is synthetic and in-test: no real card is loaded and
// the locked split is never read. Each case asserts on the generated Markdown.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Approval } from '../../src/approvals.ts';
import type { TaskType } from '../../src/cards.ts';
import { deriveEntries, LEDGER_SCHEMA, type LedgerEvent } from '../../src/ledger.ts';
import type { MetricCard } from '../../src/metrics.ts';
import type { Combination } from '../../src/phase.ts';
import { analyzeRun, buildReport, INTEL_MEMORY_QUANTITY, NVIDIA_MEMORY_COLUMN, PREFLIGHT_FINDINGS_TITLE, type ReportInput, type RunAnalysis } from '../../src/report.ts';
import {
  SCHEMA,
  type ContrastLine,
  type FailureRecord,
  type GradeLine,
  type JsonValue,
  type Outcome,
  type PerfRecord,
  type ResultRecord,
  type ResultsHeader,
  type SmokeRecord,
  type TaskSubset,
} from '../../src/results.ts';

// ---------------------------------------------------------------- fixtures

const REV = 'c'.repeat(40);
const combo = (id: string, extra: Partial<Combination> = {}): Combination => ({ id, runtime: 'webllm', model_id: `Model-${id}`, quantization: 'q4f32_1', revision: REV, phase1_locked: true, ...extra });

const LFM = combo('transformers/lfm/nvidia', {
  runtime: 'transformers.js',
  model_id: 'LFM2-1.2B-ONNX',
  license: { name: 'LFM Open License v1.0', osi: false, url: 'https://example.test/lfm', declared_by: 'base_model', accepted: '2026-11-06' },
});
const QWEN2B = combo('transformers/qwen35/nvidia', {
  runtime: 'transformers.js',
  model_id: 'Qwen3.5-2B-ONNX',
  license: { name: 'Apache-2.0', osi: true, url: 'https://example.test/qwen-base', declared_by: 'base_model', accepted: null },
});
const WAI = combo('workers-ai/gemma', { runtime: 'workers-ai', model_id: '@cf/example/gemma', quantization: '', revision: 'server-side, not pinnable', phase1_locked: false, response_shape: 'chat' });

function cardsOf(task: TaskType): MetricCard[] {
  const t = task === 'decision' ? 'D' : 'S';
  return Array.from({ length: 8 }, (_, i) => ({
    id: `${t}-${i + 1}`,
    task,
    scored: true,
    void: false,
    scenarioGroup: `${t}-g${Math.floor(i / 2) + 1}`,
    pairId: `${t}-pair${Math.floor(i / 2) + 1}`,
    role: i % 2 === 0 ? ('a' as const) : ('b' as const),
    acceptableCount: task === 'decision' ? 1 : null,
    optionCount: task === 'decision' ? 4 : null,
  }));
}

interface Spec {
  readonly id: string;
  readonly c: Combination;
  readonly task: TaskType;
  readonly good: boolean;
  readonly cpu?: number;
  readonly perf?: Record<string, JsonValue>;
  readonly rerunOf?: string;
  readonly rerunReason?: string;
  /** Outcome override for the base permutation of a card. */
  readonly outcome?: (cardId: string) => Outcome | undefined;
}

const subsetOf = (task: TaskType): TaskSubset => (task === 'decision' ? 'D' : 'S');

function analyse(s: Spec): RunAnalysis {
  const cards = cardsOf(s.task);
  const header: ResultsHeader = {
    schema: SCHEMA.header,
    run_id: s.id,
    split: 'locked',
    combination: s.c.id,
    model_key: { runtime: s.c.runtime, model_id: s.c.model_id, quantization: s.c.quantization, revision: s.c.revision },
    task_subset: subsetOf(s.task),
    fingerprint: { runtime: { name: s.c.runtime, version: '1.0.0' }, webgpu: { vendor: 'nvidia' } },
    template_hashes: {},
    timeout_ms: 10000,
    placement: { method: 'test', cpu_nodes: s.cpu === undefined ? [] : [{ op_type: 'Gather', count: s.cpu }] },
  };
  const grade: JsonValue = { acceptable: s.good, severe: false, illegal: false, severe_conditions: [] };
  const perms = cards.flatMap((card) => ['base', 'reversed'].map((permutation) => ({ card, permutation })));
  const records: ResultRecord[] = perms.map(({ card, permutation }) => ({
    schema: SCHEMA.result,
    run_id: s.id,
    split: 'locked',
    card_id: card.id,
    permutation,
    outcome: (permutation === 'base' ? s.outcome?.(card.id) : undefined) ?? { kind: 'text', text: '{}' },
    latency_ms: 100,
    timeout_ms: 10000,
    requested_at: '2026-11-07T09:00:00.000Z',
    template_hash: 'h',
    fingerprint_id: 'fp',
    usage: null,
    late: null,
    source: 'headless',
  }));
  const grades: GradeLine[] = perms
    .filter((_, i) => records[i]?.outcome.kind === 'text')
    .map(({ card, permutation }) => ({ schema: SCHEMA.grade, card_id: card.id, permutation, verdict: null, grade, identity: { kind: 'option', option: 'a' }, late_grade: null }));
  const contrasts: ContrastLine[] = [...new Set(cards.map((x) => x.pairId as string))].map((pair_id) => ({ schema: SCHEMA.contrast, pair_id, contrast: { consistent: s.good } }));
  const perf: PerfRecord | null = s.perf === undefined ? null : { schema: SCHEMA.perf, run_kind: 'locked', fresh_profile: true, ...s.perf };
  return analyzeRun({ kind: 'locked', id: s.id, cards, header, records, grades: { grades, contrasts, excluded: [] }, perf });
}

function events(specs: readonly Spec[]): LedgerEvent[] {
  return specs.flatMap((s, i): LedgerEvent[] => {
    const at = `2026-11-07T${String(10 + i).padStart(2, '0')}:00:00Z`;
    return [
      {
        schema: LEDGER_SCHEMA,
        event: 'start',
        entry_id: s.id,
        model_key: { runtime: s.c.runtime, model_id: s.c.model_id, quantization: s.c.quantization, revision: s.c.revision },
        combination: s.c.id,
        task_subset: subsetOf(s.task),
        fingerprint: {},
        template_hashes: {},
        started_at: at,
        rerun_of: s.rerunOf ?? null,
        rerun_reason: s.rerunReason ?? null,
        overlaps: [],
        approval: null,
        planned: s.task === 'decision' ? { decision: 8 } : { synthesis: 8 },
      },
      { schema: LEDGER_SCHEMA, event: 'complete', entry_id: s.id, ended_at: at, results: 'x', requests_sent: 8 },
    ];
  });
}

const smokeOf = (sent: number, accepted: number): SmokeRecord[] =>
  Array.from({ length: sent }, (_, i) => ({ schema: SCHEMA.smoke, combination: WAI.id, verdict: { kind: i < accepted ? 'decision' : 'illegal' } }) as SmokeRecord);

const P2_A: Approval = { id: 'P2-001', kind: 'phase2', branch: 'A', task_subset: null, approved_on: '2026-11-08', note: '' };
const P2_B: Approval = { id: 'P2-002', kind: 'phase2', branch: 'B', model: WAI.model_id, task_subset: 'S', approved_on: '2026-11-09', note: '' };

function build(specs: readonly Spec[], combos: readonly Combination[], over: Partial<ReportInput['state']> = {}, incomplete: ReportInput['incompleteFaults'] = new Map()): string {
  return buildReport({
    generated_on: '2026-11-10',
    environment: { targetMachine: 'Test machine', workersEndpoint: null },
    state: { combinations: combos, entries: deriveEntries(events(specs)), failures: [], exclusions: [], smoke: [], approvals: { approved: true, approvals: [] }, ...over },
    lockedRuns: specs.map(analyse),
    incompleteFaults: incomplete,
    devRuns: [],
    preflights: new Map(),
    runtimeLibraries: [],
  });
}

/** Both Task_Types for one Combination. */
const both = (idBase: string, c: Combination, good: boolean, extra: Partial<Spec> = {}): Spec[] => [
  { id: `${idBase}-D`, c, task: 'decision', good, ...extra },
  { id: `${idBase}-S`, c, task: 'synthesis', good, ...extra },
];

/** Text of section `n`, up to the next `## ` heading. */
function section(report: string, n: number): string {
  const start = report.indexOf(`\n## ${n}. `);
  assert.ok(start >= 0, `section ${n} missing`);
  const next = report.indexOf('\n## ', start + 1);
  return report.slice(start, next < 0 ? undefined : next);
}

const rows = (text: string): string[][] =>
  text
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| ---'))
    .map((l) => l.slice(2, -2).split(' | '));

// ---------------------------------------------------------------- tests

test('branch A: Phase_2 branch and approval date are stated, and the Workers AI link reads "not measured (browser passed)" with Smoke_Call counts (R18.6, R18.8)', () => {
  const report = build([...both('L-lfm', LFM, true), ...both('L-q', QWEN2B, true)], [LFM, QWEN2B, WAI], { smoke: smokeOf(5, 3), approvals: { approved: true, approvals: [P2_A] } });
  const plan = section(report, 2);
  assert.match(plan, /Phase_2 branch taken: \*\*A\*\*/);
  assert.match(plan, /Author's Phase_2 approval: P2-001, approved on 2026-11-08, branch A\./);
  assert.match(plan, /Smoke_Calls sent: 5; accepted by the Output_Validator: 3/);
  assert.doesNotMatch(plan, /Branch mismatch/);
  const workers = rows(section(report, 8)).filter((r) => r[1] === 'Workers AI');
  assert.equal(workers.length, 2);
  for (const r of workers) {
    assert.equal(r[2], 'not measured (browser passed)');
    assert.match(r[3] ?? '', /Smoke_Calls sent: 5; accepted by the Output_Validator: 3/);
  }
  assert.match(section(report, 9), /Workers AI: not measured \(browser passed\)/);
});

test('branch B: the Phase_2 approval names the model and subset, and only the browser-passed Task_Type reads "browser passed" (R18.8)', () => {
  const specs = [...both('L-lfm', LFM, true).slice(0, 1), ...both('L-lfm2', LFM, false).slice(1)];
  const report = build(specs, [LFM, WAI], { approvals: { approved: true, approvals: [P2_B] } });
  const plan = section(report, 2);
  assert.match(plan, /Phase_2 branch taken: \*\*B\*\* \(Task_Type_Subset S\)/);
  assert.match(plan, /P2-002, approved on 2026-11-09, branch B, approved model @cf\/example\/gemma, Task_Type_Subset S\./);
  const workers = rows(section(report, 8)).filter((r) => r[1] === 'Workers AI');
  assert.equal(workers.find((r) => r[0] === 'D')?.[2], 'not measured (browser passed)');
  assert.equal(workers.find((r) => r[0] === 'S')?.[2], 'not measured');
});

test('the LFM license is shown as custom, not OSI-approved, accepted 2026-11-06 (R9.17, R15.6)', () => {
  const report = build(both('L-lfm', LFM, true), [LFM, WAI]);
  const line = rows(section(report, 3)).find((r) => r[0] === LFM.id);
  assert.ok(line, 'LFM candidate row missing');
  const licence = line[6] ?? '';
  assert.match(licence, /LFM Open License v1\.0 — custom license, not OSI-approved/);
  assert.match(licence, /accepted by the Author on 2026-11-06/);
  assert.doesNotMatch(licence, /\(OSI-approved\)/);
});

test('Qwen3.5-2B-ONNX cites the base model\'s license, since the conversion repository declares none (R15.6)', () => {
  const report = build(both('L-q', QWEN2B, true), [QWEN2B, WAI]);
  const line = rows(section(report, 3)).find((r) => r[0] === QWEN2B.id);
  assert.ok(line, 'Qwen3.5-2B-ONNX candidate row missing');
  assert.match(line[1] ?? '', /Qwen3\.5-2B-ONNX/);
  assert.match(line[6] ?? '', /Apache-2\.0 \(OSI-approved\)/);
  assert.match(line[6] ?? '', /this is the base model's license; the conversion repository Qwen3\.5-2B-ONNX declares no license/);
});

test('NVIDIA and Intel memory sit in separate columns and the Intel quantity is named (R14.7, R15.11)', () => {
  const nv = combo('webllm/q/nvidia');
  const il = combo('webllm/q/intel');
  const specs: Spec[] = [
    { id: 'L-nv', c: nv, task: 'decision', good: true, perf: { memory: { gpu: 'nvidia', quantity: 'device memory.used delta', peak_mib: 2100 } } },
    { id: 'L-il', c: il, task: 'decision', good: true, perf: { memory: { gpu: 'intel', quantity: INTEL_MEMORY_QUANTITY, peak_mib: 812 } } },
  ];
  const perf = section(build(specs, [nv, il, WAI]), 6);
  const table = rows(perf);
  const head = table.find((r) => r.includes(NVIDIA_MEMORY_COLUMN));
  assert.ok(head, 'memory table header missing');
  const nvCol = head.indexOf(NVIDIA_MEMORY_COLUMN);
  const intelCol = head.findIndex((h) => h.startsWith('Intel iGPU peak memory'));
  assert.ok(intelCol > nvCol && nvCol >= 0, 'NVIDIA and Intel memory must be separate columns');
  const nvRow = table.find((r) => r.length === head.length && r[1] === 'L-nv');
  const ilRow = table.find((r) => r.length === head.length && r[1] === 'L-il');
  assert.equal(nvRow?.[nvCol], '2100');
  assert.equal(nvRow?.[intelCol], '—');
  assert.equal(ilRow?.[nvCol], '—');
  assert.equal(ilRow?.[intelCol], `812 — ${INTEL_MEMORY_QUANTITY}`);
});

test('a CPU-flagged Combination carries the "not pure-WebGPU results" note (R15.11)', () => {
  const cpu = combo('webllm/cpu/nvidia');
  const report = build([{ id: 'L-cpu', c: cpu, task: 'decision', good: true, cpu: 3 }], [cpu, WAI]);
  const row = rows(section(report, 6)).find((r) => r[0] === cpu.id && (r[7] ?? '') !== '' && r.length === 8);
  assert.ok(row, 'latency row missing');
  assert.equal(row[7], 'not pure-WebGPU results: 3 nodes placed on the CPU');
});

test('the "Risks" line appears only when a CPU-flagged Combination is recommended (R15.12)', () => {
  const cpu = combo('webllm/cpu/nvidia');
  const clean = combo('webllm/clean/nvidia');
  const recommended = build([{ id: 'L-cpu', c: cpu, task: 'decision', good: true, cpu: 2 }], [cpu, WAI]);
  assert.match(section(recommended, 9), /\*\*Risks:\*\* this Combination places 2 nodes on the CPU \(shape computation \(cheap, placed on the CPU on purpose\): Gather ×2\); its latency figures are not pure-WebGPU results\./);

  // The CPU-flagged Combination fails, so it is not recommended: the note stays in section 6 only.
  const notRecommended = build(
    [
      { id: 'L-cpu', c: cpu, task: 'decision', good: false, cpu: 2 },
      { id: 'L-clean', c: clean, task: 'decision', good: true },
    ],
    [cpu, clean, WAI],
  );
  assert.doesNotMatch(notRecommended, /Risks/);
  assert.match(section(notRecommended, 6), /not pure-WebGPU results/);
  assert.match(section(notRecommended, 9), /In-browser Runtime: \*\*webllm\/clean\/nvidia/);

  // No CPU placement at all: no Risks line either.
  assert.doesNotMatch(build([{ id: 'L-clean', c: clean, task: 'decision', good: true }], [clean, WAI]), /Risks/);
});

test('section 10 lists runtime_stuck engine faults and rebuild failures (R8.5, R8.13, R15.7)', () => {
  const c = combo('webllm/faulty/nvidia');
  const outcome = (cardId: string): Outcome | undefined =>
    cardId === 'D-1' ? { kind: 'engine_fault', code: 'runtime_stuck', detail: 'stuck' }
    : cardId === 'D-2' ? { kind: 'not_run', reason: 'rebuild_failed', detail: 'rebuild failed' }
    : undefined;
  const failure: FailureRecord = { schema: SCHEMA.failure, combination: c.id, kind: 'rebuild_failed', message: 'engine would not rebuild' };
  const report = build([{ id: 'L-f', c, task: 'decision', good: true, outcome }], [c, WAI], { failures: [failure] });
  const s10 = section(report, 10);
  assert.match(s10, /- webllm\/faulty\/nvidia \(entry L-f\): runtime_stuck engine fault on 1 request\(s\): D-1\/base;/);
  assert.match(s10, /- webllm\/faulty\/nvidia \(entry L-f\): engine rebuild failed \(rebuild_failed\) for 1 request\(s\): D-2\/base;/);
  assert.match(s10, /webllm\/faulty\/nvidia: failure record rebuild_failed \(message: engine would not rebuild\)/);
});

test('a re-run that is not used is listed as "re-run, not used" in sections 7 and 10 (R3.8)', () => {
  const c = combo('webllm/rerun/nvidia');
  const specs: Spec[] = [
    { id: 'L-first', c, task: 'decision', good: true },
    { id: 'L-second', c, task: 'decision', good: false, rerunOf: 'L-first', rerunReason: 'new driver' },
  ];
  const report = build(specs, [c, WAI]);
  const ledger = rows(section(report, 7));
  assert.equal(ledger.find((r) => r[2] === 'L-first')?.[4], 'used for marks and recommendation');
  assert.equal(ledger.find((r) => r[2] === 'L-second')?.[4], 're-run, not used');
  assert.match(section(report, 10), /- L-second: re-run of L-first \(reason: new driver\); re-run, not used/);
  // The used entry (the earliest complete one) decides the marks, so the worse re-run changes nothing.
  assert.match(section(report, 9), /In-browser Runtime: \*\*webllm\/rerun\/nvidia \(entry L-first/);
});

test('when nothing passes the recommendation is the Rules_Default alone for both Task_Types (R15.5)', () => {
  const report = build([...both('L-lfm', LFM, false)], [LFM, WAI], { smoke: smokeOf(2, 2) });
  const rec = section(report, 9);
  for (const t of ['D', 'S']) assert.match(rec, new RegExp(`Recommendation for ${t}: \\*\\*Rules_Default alone\\.\\*\\*`));
  assert.equal((rec.match(/In-browser Runtime: no recommended Combination/g) ?? []).length, 2);
  assert.doesNotMatch(rec, /Recommended chain/);
  assert.doesNotMatch(report, /Risks/);
  // Rules_Default stays the one supported link.
  const links = rows(section(report, 8)).filter((r) => r[1] === 'Rules_Default');
  assert.deepEqual(links.map((r) => r[2]), ['supported', 'supported']);
});

test('the Report states the VRAM_Preflight findings and their limits', () => {
  const md = build([], [LFM]);
  assert.ok(md.includes(`### ${PREFLIGHT_FINDINGS_TITLE}`));
  for (const needle of [
    'out_of_memory',
    '1.31.0-dev.20260914',
    'not a matter of model size',
    '18 gated-delta-net `Scan` nodes',
    'LinearAttention fused operator',
    'Per the Author',
    'The exclusion conclusion does not change',
    'only the Qwen3.5 family on WebLLM',
    'unmapped GEM buffers',
    'never share a column',
    'Prompt-length diagnosis',
  ]) {
    assert.ok(md.includes(needle), `missing: ${needle}`);
  }
});
