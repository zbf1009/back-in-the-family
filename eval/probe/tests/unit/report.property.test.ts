// Property 37 (llm-probe task 10.3): support marks follow completed passing runs.
// Fully synthetic ledgers, Results and grades: no real card is loaded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import type { TaskType } from '../../src/cards.ts';
import { deriveEntries, LEDGER_SCHEMA, type LedgerEvent } from '../../src/ledger.ts';
import type { MetricCard } from '../../src/metrics.ts';
import { IN_BROWSER_DOWNLOAD_LIMIT_BYTES, type Combination } from '../../src/phase.ts';
import { analyzeRun, buildReport, type ReportInput, type RunAnalysis } from '../../src/report.ts';
import {
  SCHEMA,
  type ContrastLine,
  type ExclusionRecord,
  type FailureRecord,
  type GradeLine,
  type JsonValue,
  type PerfRecord,
  type ResultRecord,
  type ResultsHeader,
  type SmokeRecord,
  type TaskSubset,
} from '../../src/results.ts';

const REV = 'b'.repeat(40);
const combo = (id: string, runtime: string, extra: Partial<Combination> = {}): Combination => ({
  id,
  runtime,
  model_id: `Model-${id}`,
  quantization: runtime === 'workers-ai' ? '' : 'q4',
  revision: runtime === 'workers-ai' ? 'server-side, not pinnable' : REV,
  phase1_locked: runtime !== 'workers-ai',
  ...(runtime === 'workers-ai' ? { response_shape: 'chat' as const } : {}),
  ...extra,
});
const COMBOS: readonly Combination[] = [combo('web/a', 'webllm'), combo('web/b', 'webllm'), combo('tjs/c', 'transformers.js'), combo('wai/w', 'workers-ai')];
const TASKS: readonly TaskType[] = ['decision', 'synthesis'];
const L = (t: TaskType): string => (t === 'decision' ? 'D' : 'S');

/** Eight scored cards of one Task_Type in four pairs. */
function cardsOf(task: TaskType): MetricCard[] {
  const t = L(task);
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

const analysisCache = new Map<string, RunAnalysis>();
/** A Locked_Run analysis; `good` decides whether every Threshold passes. Memoised (the bootstrap is slow). */
function runOf(entryId: string, c: Combination, task: TaskType, good: boolean, over: boolean): RunAnalysis {
  const key = `${c.id}|${task}|${good}|${over}`;
  let base = analysisCache.get(key);
  if (base === undefined) {
    const cards = cardsOf(task);
    const header: ResultsHeader = {
      schema: SCHEMA.header,
      run_id: 'x',
      split: 'locked',
      combination: c.id,
      model_key: { runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision },
      task_subset: task === 'decision' ? 'D' : 'S',
      fingerprint: { runtime: { name: c.runtime, version: '1.0.0' }, webgpu: { vendor: 'nvidia' } },
      template_hashes: {},
      timeout_ms: 10000,
      placement: { method: 'test', cpu_nodes: [] },
    };
    const grade: JsonValue = { acceptable: good, severe: false, illegal: false, severe_conditions: [] };
    const perms = cards.flatMap((card) => ['base', 'reversed'].map((permutation) => ({ card, permutation })));
    const records: ResultRecord[] = perms.map(({ card, permutation }) => ({
      schema: SCHEMA.result,
      run_id: 'x',
      split: 'locked',
      card_id: card.id,
      permutation,
      outcome: { kind: 'text', text: '{}' },
      latency_ms: 100,
      timeout_ms: 10000,
      requested_at: '2026-11-07T09:00:00.000Z',
      template_hash: 'h',
      fingerprint_id: 'fp',
      usage: null,
      late: null,
      source: 'headless',
    }));
    const grades: GradeLine[] = perms.map(({ card, permutation }) => ({
      schema: SCHEMA.grade,
      card_id: card.id,
      permutation,
      verdict: null,
      grade,
      identity: { kind: 'option', option: 'a' },
      late_grade: null,
    }));
    const contrasts: ContrastLine[] = [...new Set(cards.map((x) => x.pairId as string))].map((pair_id) => ({
      schema: SCHEMA.contrast,
      pair_id,
      contrast: { consistent: good },
    }));
    const perf: PerfRecord | null = over
      ? { schema: SCHEMA.perf, run_kind: 'locked', fresh_profile: true, download: { model_bytes: IN_BROWSER_DOWNLOAD_LIMIT_BYTES + 1 } }
      : null;
    base = analyzeRun({ kind: 'locked', id: 'x', cards, header, records, grades: { grades, contrasts, excluded: [] }, perf });
    analysisCache.set(key, base);
  }
  return { ...base, id: entryId, header: { ...base.header, run_id: entryId } };
}

// ---------------------------------------------------------------- the synthetic world

interface Spec {
  complete: boolean;
  good: boolean;
}
interface World {
  /** Entries per Combination index and Task_Type, in start order. */
  specs: Spec[][][];
  excluded: boolean[];
  over: boolean[];
  failed: boolean[];
  smokeSent: number;
  smokeOk: number;
}

const genSpecs = fc.array(fc.record({ complete: fc.boolean(), good: fc.boolean() }), { maxLength: 3 });
const genWorld: fc.Arbitrary<World> = fc
  .record({
    specs: fc.tuple(...COMBOS.map(() => fc.tuple(genSpecs, genSpecs))),
    excluded: fc.tuple(...COMBOS.map(() => fc.boolean())),
    over: fc.tuple(...COMBOS.map(() => fc.boolean())),
    failed: fc.tuple(...COMBOS.map(() => fc.boolean())),
    smokeSent: fc.integer({ min: 0, max: 6 }),
    smokeBad: fc.integer({ min: 0, max: 6 }),
  })
  .map((w) => ({
    specs: w.specs as Spec[][][],
    // The Workers AI Combination is never excluded or over a browser limit.
    excluded: w.excluded.map((x, i) => x && COMBOS[i]?.runtime !== 'workers-ai'),
    over: w.over.map((x, i) => x && COMBOS[i]?.runtime !== 'workers-ai'),
    failed: [...w.failed],
    smokeSent: w.smokeSent,
    smokeOk: Math.max(0, w.smokeSent - w.smokeBad),
  }));

interface Built {
  input: ReportInput;
  /** entry id -> description */
  used: Map<string, string>;
  /** Per Combination index and task: id of the first complete entry, or null. */
  first: (string | null)[][];
  reruns: string[];
  incompletes: string[];
  /** Per Combination index and task: all the entry IDs. */
  ids: string[][][];
}

const iso = (n: number): string => new Date(Date.UTC(2026, 10, 7, 0, n)).toISOString();
const smokeOf = (sent: number, ok: number): SmokeRecord[] =>
  Array.from({ length: sent }, (_, i) => ({ schema: SCHEMA.smoke, combination: 'wai/w', verdict: { kind: i < ok ? 'decision' : 'illegal' } }) as SmokeRecord);

function build(w: World, smoke: SmokeRecord[]): Built {
  const events: LedgerEvent[] = [];
  const runs: RunAnalysis[] = [];
  const first: (string | null)[][] = COMBOS.map(() => [null, null]);
  const ids: string[][][] = COMBOS.map(() => [[], []]);
  const reruns: string[] = [];
  const incompletes: string[] = [];
  let n = 0;
  COMBOS.forEach((c, ci) => {
    TASKS.forEach((task, ti) => {
      const subset: TaskSubset = task === 'decision' ? 'D' : 'S';
      for (const spec of w.specs[ci]?.[ti] ?? []) {
        n++;
        const id = `E-${String(n).padStart(3, '0')}`;
        ids[ci]?.[ti]?.push(id);
        events.push({
          schema: LEDGER_SCHEMA,
          event: 'start',
          entry_id: id,
          model_key: { runtime: c.runtime, model_id: c.model_id, quantization: c.quantization, revision: c.revision },
          combination: c.id,
          task_subset: subset,
          fingerprint: {},
          template_hashes: {},
          started_at: iso(n),
          rerun_of: null,
          rerun_reason: null,
          overlaps: [],
          approval: null,
          planned: subset === 'D' ? { decision: 8 } : { synthesis: 8 },
        });
        if (spec.complete) {
          events.push({ schema: LEDGER_SCHEMA, event: 'complete', entry_id: id, ended_at: iso(n), results: 'x', requests_sent: 8 });
          runs.push(runOf(id, c, task, spec.good, w.over[ci] === true));
          const row = first[ci] as (string | null)[];
          if (row[ti] === null) row[ti] = id;
          else reruns.push(id);
        } else incompletes.push(id);
      }
    });
  });
  const exclusions: ExclusionRecord[] = COMBOS.flatMap((c, ci) =>
    w.excluded[ci] === true ? [{ schema: SCHEMA.exclusion, combination: c.id, model: c.model_id, check: 'vram' as const, value: 3000, limit: 2600, at: '2026-11-05T00:00:00Z' }] : [],
  );
  const failures: FailureRecord[] = COMBOS.flatMap((c, ci) => (w.failed[ci] === true ? [{ schema: SCHEMA.failure, combination: c.id, kind: 'load_error' }] : []));
  const input: ReportInput = {
    generated_on: '2026-11-09',
    environment: { targetMachine: 'Test machine', workersEndpoint: null },
    state: {
      combinations: COMBOS,
      entries: deriveEntries(events),
      failures,
      exclusions,
      smoke,
      approvals: { approved: true, approvals: [{ id: 'P2-001', kind: 'phase2', branch: 'A', task_subset: null, approved_on: '2026-11-08', note: '' }] },
    },
    lockedRuns: runs,
    incompleteFaults: new Map(),
    devRuns: [],
    preflights: new Map(),
    runtimeLibraries: [],
  };
  return { input, used: new Map(), first, reruns, incompletes, ids };
}

// ---------------------------------------------------------------- independent oracle

/** Does the Combination count as a pass for the task? Entry used = first complete one. */
function oracle(w: World, b: Built, ci: number, ti: number): string | null {
  const used = b.first[ci]?.[ti] ?? null;
  if (used === null) return null;
  const idx = b.ids[ci]?.[ti]?.indexOf(used) ?? -1;
  const spec = w.specs[ci]?.[ti]?.[idx];
  if (spec?.good !== true) return null;
  if (COMBOS[ci]?.runtime !== 'workers-ai' && (w.excluded[ci] === true || w.over[ci] === true)) return null;
  return used;
}

function section(report: string, from: string, to: string | null): string {
  const a = report.indexOf(`\n## ${from}`);
  assert.ok(a >= 0, `section ${from} missing`);
  const b = to === null ? -1 : report.indexOf(`\n## ${to}`, a + 1);
  return b < 0 ? report.slice(a) : report.slice(a, b);
}

/** Support rows of section 8: `D|In-browser: webllm` -> [mark, evidence]. */
function supportRows(report: string): Map<string, { mark: string; evidence: string }> {
  const out = new Map<string, { mark: string; evidence: string }>();
  for (const line of section(report, '8. ', '9. ').split('\n')) {
    if (!line.startsWith('| D |') && !line.startsWith('| S |')) continue;
    const cells = line.slice(2, -2).split(' | ');
    out.set(`${cells[0]}|${cells[1]}`, { mark: cells[2] ?? '', evidence: cells[3] ?? '' });
  }
  return out;
}

const hasId = (text: string, id: string): boolean => new RegExp(`\\b${id}\\b`).test(text);

// Feature: llm-probe, Property 37: Support marks follow completed passing runs
test('Property 37: support marks follow completed passing runs', () => {
  fc.assert(
    fc.property(genWorld, (w) => {
      const b = build(w, smokeOf(w.smokeSent, w.smokeOk));
      const report = buildReport(b.input);
      const rows = supportRows(report);
      const s9 = section(report, '9. ', '10. ');
      const s7 = section(report, '7. ', '8. ');

      TASKS.forEach((task, ti) => {
        const t = L(task);
        const browserPassing: { ci: number; entry: string }[] = [];
        for (const rt of ['webllm', 'transformers.js']) {
          const cis = COMBOS.flatMap((c, ci) => (c.runtime === rt ? [ci] : []));
          const passing = cis.flatMap((ci) => {
            const e = oracle(w, b, ci, ti);
            return e === null ? [] : [{ ci, entry: e }];
          });
          browserPassing.push(...passing);
          const row = rows.get(`${t}|In-browser: ${rt}`);
          assert.ok(row !== undefined, `row ${t} ${rt}`);
          // A Runtime link is supported exactly when some Combination of it passed in its used entry.
          assert.equal(row.mark, passing.length > 0 ? 'supported' : 'not supported');
          if (passing.length > 0) {
            // Every mark cites ledger entry IDs: the passing entries.
            for (const p of passing) assert.ok(row.evidence.includes(`${COMBOS[p.ci]?.id}: entry ${p.entry}`), row.evidence);
          } else {
            for (const ci of cis) assert.ok(row.evidence.includes(COMBOS[ci]?.id ?? '?'), `evidence names ${COMBOS[ci]?.id}`);
          }
          // Re-runs, incomplete entries and unused entries are never cited as evidence.
          for (const id of [...b.reruns, ...b.incompletes]) assert.ok(!hasId(row.evidence, id), `${id} cited in ${t} ${rt}`);
        }

        // Workers AI link.
        const wi = COMBOS.findIndex((c) => c.runtime === 'workers-ai');
        const wPass = oracle(w, b, wi, ti);
        const wUsed = b.first[wi]?.[ti] ?? null;
        const wrow = rows.get(`${t}|Workers AI`);
        assert.ok(wrow !== undefined);
        if (wPass !== null) {
          assert.equal(wrow.mark, 'supported');
          assert.ok(wrow.evidence.includes(`entry ${wPass}`));
        } else if (wUsed !== null) assert.equal(wrow.mark, 'not supported');
        else if (browserPassing.length > 0) {
          assert.equal(wrow.mark, 'not measured (browser passed)');
          for (const p of browserPassing) assert.ok(wrow.evidence.includes(`${COMBOS[p.ci]?.id}: ${p.entry}`), wrow.evidence);
          assert.ok(wrow.evidence.includes(`Smoke_Calls sent: ${w.smokeSent}; accepted by the Output_Validator: ${w.smokeOk}`), wrow.evidence);
        } else assert.equal(wrow.mark, 'not measured');
        for (const id of [...b.reruns, ...b.incompletes]) assert.ok(!hasId(wrow.evidence, id));

        // Rules_Default is always supported.
        assert.equal(rows.get(`${t}|Rules_Default`)?.mark, 'supported');

        // Recommendation: the Rules_Default alone exactly when nothing passed; otherwise a chain from used entries only.
        const heading = `### Task_Type ${t} (${task})`;
        const start = s9.indexOf(heading);
        assert.ok(start >= 0);
        const next = s9.indexOf('\n### ', start + 1);
        const block = next < 0 ? s9.slice(start) : s9.slice(start, next);
        const anyPass = browserPassing.length > 0 || wPass !== null;
        if (!anyPass) {
          assert.ok(block.includes(`Recommendation for ${t}: **Rules_Default alone.**`), block);
          // Failed Thresholds listed for every Combination with a used entry that did not meet them.
          COMBOS.forEach((c, ci) => {
            const used = b.first[ci]?.[ti] ?? null;
            if (used === null) return;
            assert.ok(block.includes(`- ${c.id} (entry ${used}): `), `${c.id} listed in ${t}`);
            const idx = b.ids[ci]?.[ti]?.indexOf(used) ?? -1;
            if (w.specs[ci]?.[ti]?.[idx]?.good === false) assert.match(block, new RegExp(`- ${c.id.replace('/', '\\/')} \\(entry ${used}\\): [^\\n]*acceptable rate 0\\/8 = 0\\.0%, below 80%`));
          });
        } else {
          assert.ok(!block.includes('Rules_Default alone'), block);
          assert.match(block, /Recommended chain for/);
        }
        // The recommendation uses only the first complete entry of each Model_Key x Task_Type.
        for (const id of [...b.reruns, ...b.incompletes]) assert.ok(!hasId(block, id), `${id} used in recommendation ${t}`);
      });

      // Re-runs are listed as "re-run, not used"; incomplete entries as "incomplete".
      for (const id of b.reruns) {
        const line = s7.split('\n').find((l) => hasId(l, id));
        assert.ok(line?.includes('re-run, not used'), `${id}: ${line}`);
      }
      for (const id of b.incompletes) {
        const line = s7.split('\n').find((l) => hasId(l, id));
        assert.ok(line?.includes('| incomplete |'), `${id}: ${line}`);
      }
    }),
    { numRuns: 40 },
  );
});

// Feature: llm-probe, Property 37: Smoke_Call results never change a Metric, interval or pass mark
test('Property 37: Smoke_Call results change no Metric, interval or mark', () => {
  fc.assert(
    fc.property(genWorld, (w) => {
      const keep = (text: string): string[] => text.split('\n').filter((l) => !l.includes('Smoke_Call'));
      const none = keep(buildReport(build(w, []).input));
      const some = keep(buildReport(build(w, smokeOf(w.smokeSent, w.smokeOk)).input));
      assert.deepStrictEqual(some, none);
    }),
    { numRuns: 25 },
  );
});
