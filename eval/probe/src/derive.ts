// `probe derive` and the Derived_Run (llm-probe task 41; R20.7, R20.9, R20.11, RC-18, RC-24; DA-26).
//
// A `perm_avg` Decision_Variant sends nothing. Its answer is computed from the stored Results of the `single` run of the
// same Decision_Model: for every Card, `llm_aggregate_perm_avg` (Sim_Wasm, the only place a probability is read) sums the
// stored `system_one.response_text` bodies of the Card's Permutations and names the option. The result is written as an
// ordinary Results file (one `base` record per Card, the per-call evidence in the separate `perm_avg` member) plus its
// grades file, under `eval/results/derived/<split>/`.
//
// Properties of the command (Property 51):
//   - no network, no `env`, no Request_Budget counter, no ledger line, no Runtime;
//   - the output is a pure function of the stored source: no clock value is written, so a second run on an unchanged
//     source is byte-identical, and `--verify` recomputes it in memory and compares bytes without writing;
//   - an existing derived file is never overwritten (`derived_conflict`);
//   - the source must be complete (RC-24) and the gate must allow the step.
// It reads `locked.jsonl` for grading only (RC-18): no prompt is rendered from a Locked_Card, and it prints only counts,
// Card IDs, reason codes and error messages.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CardLoadError, loadCards, type LoadedCard } from './cards.ts';
import { PINNED_MANIFEST_HASH } from './manifest.ts';
import {
  isPermAvg,
  parseCombinations,
  variantRegistry,
  type Combination,
  type VariantRegistryEntry,
} from './phase.ts';
import { gradesText } from './ingest.ts';
import { LedgerError, readLedger } from './ledger.ts';
import { RunLogger } from './run-logger.ts';
import {
  canonicalJson,
  fingerprintId,
  parseHeader,
  parseResultRecord,
  readResultsFile,
  ResultsFormatError,
  serializeLine,
  gradesPathFor,
  type DerivedFrom,
  type JsonValue,
  type PermAvgCall,
  type PermAvgField,
  type ResultRecord,
  type ResultsHeader,
  type Split,
} from './results.ts';
import { buildPlan, reportFailure, runManifestCheck, type RunDeps } from './run.ts';
import { defaultRunPaths } from './run-command.ts';
import { cardFacts, gradeRecords, hasOutput } from './run-grading.ts';
import { printErrorLine, printLine, writeTextFile } from './sink.ts';
import { llmAggregatePermAvg, wasmSha256 } from './simwasm.ts';
import { checkRuleVersion, loadAggregationRule, loadSystemOneMapping, ruleVersionOf } from './templates.ts';
import { derivedFingerprint } from './variants.ts';
import { fileURLToPath } from 'node:url';

const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));

// ---------------------------------------------------------------- gate

export type DeriveStep = 'derive_dev' | 'derive_locked';

export interface DeriveGateRequest {
  readonly step: DeriveStep;
  readonly combo: Combination;
  readonly approval: string | null;
  /** Always `D`: a Derived_Run is for Task_Type D only (R20.9). */
  readonly taskSubset: 'D';
}

export type DeriveGateDecision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** `allowDecisionVariant('derive_dev' | 'derive_locked', …)` of the design (task 42.1). */
export type DeriveGate = (request: DeriveGateRequest) => DeriveGateDecision;

/**
 * Placeholder until task 42.1 provides `allowDecisionVariant` (DA-27): it refuses every step, so `derive` cannot run
 * on real data before the variant gate and its approvals exist. Tests inject an allowing gate.
 */
export const refusingDeriveGate: DeriveGate = (r) => ({
  ok: false,
  reason: `${r.step} of ${r.combo.id} is refused: the Decision_Variant gate (allowDecisionVariant, task 42.1) is not available yet`,
});

// ---------------------------------------------------------------- errors, options

/** A refusal of `derive`; printed as `probe: derive: <code>: <detail>`. */
export class DeriveError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = 'DeriveError';
    this.code = code;
  }
}

export interface DeriveOptions {
  readonly combo: string;
  readonly split: Split;
  readonly approval: string | null;
  readonly verify: boolean;
}

export type DeriveDeps = Pick<RunDeps, 'paths' | 'pinnedManifestHash' | 'combinations' | 'logger'> & { readonly gate: DeriveGate };

type Parsed = { readonly ok: true; readonly options: DeriveOptions } | { readonly ok: false; readonly message: string };

/**
 * `derive --combo <perm_avg id> --split dev|locked --approval <id> [--verify]`. `--task` other than `D` is refused here,
 * before anything else is read (R20.9).
 */
export function parseDeriveArgs(argv: readonly string[]): Parsed {
  let values: Record<string, string | boolean | undefined>;
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: { combo: { type: 'string' }, split: { type: 'string' }, approval: { type: 'string' }, task: { type: 'string' }, verify: { type: 'boolean' } },
    });
    if (parsed.positionals.length > 0) return { ok: false, message: `unexpected argument "${parsed.positionals[0]}"` };
    values = parsed.values as Record<string, string | boolean | undefined>;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (values['task'] !== undefined && values['task'] !== 'D') return { ok: false, message: '--task must be D (a Derived_Run is for Task_Type D only)' };
  const combo = values['combo'];
  if (typeof combo !== 'string' || combo === '') return { ok: false, message: '--combo <perm_avg combination id> is required' };
  const split = values['split'];
  if (split !== 'dev' && split !== 'locked') return { ok: false, message: '--split must be dev or locked' };
  const approval = values['approval'];
  if (typeof approval !== 'string' || approval === '') return { ok: false, message: '--approval <id> is required' };
  return { ok: true, options: { combo, split, approval, verify: values['verify'] === true } };
}

// ---------------------------------------------------------------- source completeness (RC-24)

/** A Card × Permutation of the plan. */
export interface PlannedKey {
  readonly card_id: string;
  readonly permutation: string;
}

/**
 * Problems that make a source `complete` fail (RC-24, R20.11): a planned Card × Permutation without an output record
 * (`text`, `timeout` or `error`), and any `not_run` or `engine_fault` record. Empty when the source is complete. Names
 * Card IDs and permutations only.
 */
export function incompleteSource(plan: readonly PlannedKey[], records: readonly ResultRecord[]): string[] {
  const problems: string[] = [];
  const have = new Set(records.filter(hasOutput).map((r) => `${r.card_id}\u0000${r.permutation}`));
  const missing = plan.filter((p) => !have.has(`${p.card_id}\u0000${p.permutation}`));
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).map((m) => `${m.card_id}/${m.permutation}`).join(', ');
    problems.push(`${missing.length} planned Card x Permutation without an output record (${shown}${missing.length > 3 ? ', ...' : ''})`);
  }
  const notRun = records.filter((r) => r.outcome.kind === 'not_run');
  if (notRun.length > 0) problems.push(`${notRun.length} not_run record(s) (first: ${(notRun[0] as ResultRecord).card_id}/${(notRun[0] as ResultRecord).permutation})`);
  const faults = records.filter((r) => r.outcome.kind === 'engine_fault');
  if (faults.length > 0) problems.push(`${faults.length} engine_fault record(s) (first: ${(faults[0] as ResultRecord).card_id}/${(faults[0] as ResultRecord).permutation})`);
  return problems;
}

// ---------------------------------------------------------------- the derivation (pure)

export interface DeriveInput {
  readonly split: Split;
  /** The Cards of the split, in file order (all tasks; only Task_Type D is derived). */
  readonly cards: readonly LoadedCard[];
  readonly sourceHeader: ResultsHeader;
  readonly sourceRecords: readonly ResultRecord[];
  readonly permAvg: Combination;
  readonly single: Combination;
  readonly mappingHash: string;
  readonly aggregationHash: string;
  readonly ruleVersion: number;
  readonly pinnedManifestHash: string;
  readonly simWasmSha256: string;
  /** sha256 of the source Results file as read. */
  readonly sourceSha256: string;
  /** Repository-relative path of the source Results file. */
  readonly sourceFile: string;
  readonly ledgerEntry: string | null;
}

export interface IllegalCard {
  readonly cardId: string;
  /** `<reason> <permutation>` (DA-26), or the reason alone when the rule names no call. */
  readonly detail: string;
}

export interface DerivedRun {
  readonly header: ResultsHeader;
  readonly records: readonly ResultRecord[];
  readonly resultsText: string;
  readonly gradesText: string;
  readonly runId: string;
  readonly illegal: readonly IllegalCard[];
}

/** `derived-<split>-<source run_id>-perm_avg-v<rule_version>` (DA-26). */
export const derivedRunId = (split: Split, sourceRunId: string, ruleVersion: number): string => `derived-${split}-${sourceRunId}-perm_avg-v${ruleVersion}`;

const sha256Of = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

type CallStatus = 'ok' | 'timeout' | 'error' | 'engine_fault' | 'missing';

function callOf(permutation: string, r: ResultRecord | undefined): { permutation: string; status: CallStatus; response_text?: string } {
  if (r === undefined) return { permutation, status: 'missing' };
  switch (r.outcome.kind) {
    case 'text':
      return r.system_one === undefined ? { permutation, status: 'error' } : { permutation, status: 'ok', response_text: r.system_one.response_text };
    case 'timeout':
      return { permutation, status: 'timeout' };
    case 'error':
      return { permutation, status: 'error' };
    case 'engine_fault':
      return { permutation, status: 'engine_fault' };
    default:
      return { permutation, status: 'missing' };
  }
}

interface AggregateAnswer {
  kind: 'decision' | 'illegal';
  option?: string;
  reason?: string;
  call?: string | null;
}
interface AggregateResult {
  ok: boolean;
  answer: AggregateAnswer;
  sums: { scale: number; options: { id: string; sum: string }[] } | null;
  calls: { permutation: string; choice: string; probabilities: { id: string; lexeme: string }[] }[];
  positions: { original: number; shown: { permutation: string; position: number }[] } | null;
  rule_version: number;
}

/**
 * Computes the Derived_Run of one split from the stored source. Pure: the same input gives byte-identical texts, and no
 * clock value is read or written. Grades go through the ordinary path (`llm_validate` in `raw_choice` mode, `llm_grade`,
 * `llm_identity`, `llm_contrast` on the base verdicts).
 */
export function deriveRun(input: DeriveInput): DerivedRun {
  const decisionCards = input.cards.filter((c) => c.task === 'decision');
  const plan = buildPlan(decisionCards, ['decision']);
  const runId = derivedRunId(input.split, input.sourceHeader.run_id, input.ruleVersion);

  // The last record with an output wins for each Card × Permutation (a resumed run); else the last record.
  const byKey = new Map<string, ResultRecord>();
  for (const r of input.sourceRecords) {
    const k = `${r.card_id}\u0000${r.permutation}`;
    const prev = byKey.get(k);
    if (prev === undefined || hasOutput(r) || !hasOutput(prev)) byKey.set(k, r);
  }

  const fingerprint = derivedFingerprint({
    permAvg: input.permAvg,
    single: input.single,
    mappingHash: input.mappingHash,
    aggregationHash: input.aggregationHash,
    ruleVersion: input.ruleVersion,
    pinnedManifestHash: input.pinnedManifestHash,
    simWasmSha256: input.simWasmSha256,
  });
  const derivedFrom: DerivedFrom = {
    combination: input.single.id,
    run_id: input.sourceHeader.run_id,
    ledger_entry: input.ledgerEntry,
    results_file: input.sourceFile,
    results_sha256: input.sourceSha256,
    pinned_manifest_hash: input.pinnedManifestHash,
    aggregation_hash: input.aggregationHash,
    rule_version: input.ruleVersion,
    sim_wasm_sha256: input.simWasmSha256,
  };
  const header = parseHeader({
    schema: 'llm-probe-results-header-v1',
    run_id: runId,
    split: input.split,
    combination: input.permAvg.id,
    model_key: null,
    task_subset: 'D',
    fingerprint,
    template_hashes: { decision: input.mappingHash, aggregation: input.aggregationHash },
    timeout_ms: input.sourceHeader.timeout_ms,
    placement: null,
    response_shape: 'system_one',
    validator_mode: 'raw_choice',
    variant: 'perm_avg',
    derived_from: derivedFrom,
  });
  const fpId = fingerprintId(header.fingerprint);

  const records: ResultRecord[] = [];
  const illegal: IllegalCard[] = [];
  for (const card of decisionCards) {
    const facts = cardFacts(card);
    const perms = plan.filter((p) => p.card.id === card.id).map((p) => p.permutation);
    const sources = perms.map((p) => byKey.get(`${card.id}\u0000${p}`));
    const scope = card.scored ? 'scored' : 'sanity';
    const out = JSON.parse(
      llmAggregatePermAvg(
        JSON.stringify({ frozen_context: facts.frozenContext, scope, question_id: 'decision', calls: perms.map((p, i) => callOf(p, sources[i])) }),
        card.id,
      ),
    ) as AggregateResult;
    if (out.ok !== true) throw new DeriveError('aggregate_refused', `llm_aggregate_perm_avg refused its input (Card ID: ${card.id})`);
    if (out.rule_version !== input.ruleVersion) throw new DeriveError('rule_version', `the export returned rule_version ${out.rule_version}, not ${input.ruleVersion} (Card ID: ${card.id})`);

    const sourceByPerm = new Map(perms.map((p, i) => [p, sources[i]] as const));
    const calls: PermAvgCall[] = out.calls.map((c) => {
      const s = sourceByPerm.get(c.permutation);
      return {
        permutation: c.permutation,
        choice: c.choice,
        probabilities: c.probabilities.map((p) => ({ id: p.id, lexeme: p.lexeme })),
        latency_ms: s?.latency_ms ?? null,
        input_tokens: s?.usage?.input_tokens ?? null,
      };
    });
    const field: PermAvgField = {
      scope,
      rule_version: out.rule_version,
      chosen: out.answer.kind === 'decision' ? (out.answer.option ?? null) : null,
      sums: out.sums === null ? null : { scale: out.sums.scale, options: out.sums.options.map((o) => ({ id: o.id, sum: o.sum })) },
      calls,
      positions: out.positions === null ? null : { original: out.positions.original, shown: out.positions.shown.map((s) => ({ permutation: s.permutation, position: s.position })) },
    };

    // latency_ms of a derived record is the sum over the calls (a sequential decision); the maximum is in `perm_avg.calls`.
    const latency = sources.reduce((sum, s) => sum + (s?.latency_ms ?? 0), 0);
    const baseSource = sourceByPerm.get('base');
    let outcome: ResultRecord['outcome'];
    if (out.answer.kind === 'decision' && out.answer.option !== undefined) {
      outcome = { kind: 'text', text: out.answer.option };
    } else {
      const detail = `${out.answer.reason ?? 'illegal'}${out.answer.call == null ? '' : ` ${out.answer.call}`}`;
      illegal.push({ cardId: card.id, detail });
      outcome = { kind: 'error', code: 'perm_avg_illegal', detail, remote: false };
    }
    records.push(
      parseResultRecord({
        schema: 'llm-probe-result-v1',
        run_id: runId,
        split: input.split,
        card_id: card.id,
        permutation: 'base',
        outcome,
        latency_ms: latency,
        timeout_ms: header.timeout_ms,
        requested_at: baseSource?.requested_at ?? '1970-01-01T00:00:00.000Z',
        template_hash: input.mappingHash,
        fingerprint_id: fpId,
        usage: null,
        late: null,
        source: 'derived',
        perm_avg: field,
      }),
    );
  }

  const graded = gradeRecords(input.cards, records, ['decision'], 'raw_choice');
  return {
    header,
    records,
    resultsText: serializeLine(header) + records.map((r) => serializeLine(r)).join(''),
    gradesText: gradesText(graded),
    runId,
    illegal,
  };
}

// ---------------------------------------------------------------- latency evidence (R20.15)

export interface DecisionLatency {
  readonly cardId: string;
  /** Number of calls the decision needed (the Request_Multiplier of the Card). */
  readonly calls: number;
  readonly sumMs: number;
  readonly maxMs: number;
}

/**
 * Per-Card decision latency of a derived file: the sum and the maximum over the calls of the Card, and the call count.
 * The Report takes its latency figures from these (taken from the source `single` run's requests), never from a
 * request of its own; Metrics never read them.
 */
export function decisionLatencies(records: readonly ResultRecord[]): DecisionLatency[] {
  const out: DecisionLatency[] = [];
  for (const r of records) {
    if (r.perm_avg === undefined) continue;
    const ms = r.perm_avg.calls.map((c) => c.latency_ms ?? 0);
    out.push({ cardId: r.card_id, calls: r.perm_avg.calls.length, sumMs: ms.reduce((a, b) => a + b, 0), maxMs: ms.reduce((a, b) => Math.max(a, b), 0) });
  }
  return out;
}

// ---------------------------------------------------------------- source lookup

interface Source {
  readonly file: string;
  readonly relFile: string;
  readonly sha256: string;
  readonly header: ResultsHeader;
  readonly records: ResultRecord[];
  readonly ledgerEntry: string | null;
}

const relTo = (repoDir: string, file: string): string => path.relative(repoDir, file).split(path.sep).join('/');
const isResultsFile = (n: string): boolean => n.endsWith('.jsonl') && !n.endsWith('.grades.jsonl');

function listResults(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(isResultsFile).sort() : [];
}

function findSource(deps: DeriveDeps, split: Split, single: Combination, mappingHash: string, plan: readonly PlannedKey[]): Source {
  const { repoDir, resultsDir } = deps.paths;
  if (split === 'dev') {
    // The newest complete Dev_Run Results file of the source whose mapping Template_Hash equals the Combination's (DA-27).
    const dir = path.join(resultsDir, 'dev');
    const problems: string[] = [];
    let found: Source | undefined;
    for (const name of listResults(dir)) {
      const file = path.join(dir, name);
      const results = readResultsFile(file);
      if (results.header.combination !== single.id) continue;
      const hash = results.header.template_hashes['decision'];
      if (hash !== mappingHash) {
        problems.push(`${name}: mapping Template_Hash ${hash ?? 'none'} differs from the current ${mappingHash}`);
        continue;
      }
      const why = incompleteSource(plan, results.records);
      if (why.length > 0) {
        problems.push(`${name}: ${why.join('; ')}`);
        continue;
      }
      found = { file, relFile: relTo(repoDir, file), sha256: sha256Of(fs.readFileSync(file)), header: results.header, records: results.records, ledgerEntry: null };
    }
    if (found === undefined) {
      throw new DeriveError('source_incomplete', `no complete Dev_Run of ${single.id} (R20.11, RC-24)${problems.length === 0 ? ': none found' : `: ${problems.join(' | ')}`}`);
    }
    return found;
  }
  // Locked: the first `complete` ledger entry of the source's Model_Key for Task_Type D, the entry R3.8 uses.
  const key = JSON.stringify([single.runtime, single.model_id, single.quantization, single.revision]);
  const entries = readLedger(deps.paths.ledger).entries.filter((e) => JSON.stringify([e.start.model_key.runtime, e.start.model_key.model_id, e.start.model_key.quantization, e.start.model_key.revision]) === key && e.start.task_subset !== 'S');
  const used = [...entries].sort((a, b) => Date.parse(a.start.started_at) - Date.parse(b.start.started_at) || a.order - b.order).find((e) => e.status === 'complete');
  if (used === undefined || used.complete === null) throw new DeriveError('source_incomplete', `no complete Locked_Run ledger entry of ${single.id} for Task_Type D (R20.11, RC-24)`);
  const recorded = used.complete.results;
  const file = path.isAbsolute(recorded) ? recorded : path.join(repoDir, recorded);
  if (!fs.existsSync(file)) throw new DeriveError('source_incomplete', `the Results file of ledger entry ${used.entry_id} is missing`);
  const results = readResultsFile(file);
  const hash = results.header.template_hashes['decision'];
  if (hash !== mappingHash) throw new DeriveError('source_incomplete', `ledger entry ${used.entry_id}: mapping Template_Hash ${hash ?? 'none'} differs from the current ${mappingHash}`);
  const why = incompleteSource(plan, results.records);
  if (why.length > 0) throw new DeriveError('source_incomplete', `ledger entry ${used.entry_id}: ${why.join('; ')}`);
  return { file, relFile: relTo(repoDir, file), sha256: sha256Of(fs.readFileSync(file)), header: results.header, records: results.records, ledgerEntry: used.entry_id };
}

/** `derive_locked` needs the derived Dev_Run with equal mapping and aggregation Template_Hashes (R3.12, R20.11). */
function requireDerivedDev(deps: DeriveDeps, combo: Combination, mappingHash: string, aggregationHash: string): void {
  const dir = path.join(derivedRoot(deps), 'dev');
  const problems: string[] = [];
  for (const name of listResults(dir)) {
    const h = readResultsFile(path.join(dir, name)).header;
    if (h.combination !== combo.id) continue;
    if (h.template_hashes['decision'] === mappingHash && h.template_hashes['aggregation'] === aggregationHash) return;
    problems.push(`${name}: Template_Hashes differ from the current mapping and aggregation`);
  }
  throw new DeriveError('dev_derived_missing', `derive_locked needs the Derived_Run of the Dev split of ${combo.id} with equal Template_Hashes (R3.12, R20.11)${problems.length === 0 ? ': none found' : `: ${problems.join(' | ')}`}`);
}

/** R20.1: the variants of the model must equal the registry in the header of the earliest Decision_Model Dev_Run of the model. */
function checkRegistry(deps: DeriveDeps, combo: Combination, aggregationFileReader: Parameters<typeof variantRegistry>[2]): void {
  const dir = path.join(deps.paths.resultsDir, 'dev');
  let first: ResultsHeader | undefined;
  for (const name of listResults(dir)) {
    const h = readResultsFile(path.join(dir, name)).header;
    const c = deps.combinations.find((x) => x.id === h.combination);
    if (c === undefined || c.model_id !== combo.model_id || c.response_shape !== 'system_one' || h.variant === 'perm_avg') continue;
    first = h;
    break;
  }
  const current: VariantRegistryEntry[] = variantRegistry(deps.combinations, combo.model_id, aggregationFileReader);
  if (first === undefined || first.variants === undefined || canonicalJson(first.variants as unknown as JsonValue) !== canonicalJson(current as unknown as JsonValue)) {
    throw new DeriveError('registry', 'registry changed after the first Dev_Run result (R20.1); needs a recorded Author amendment');
  }
}

const derivedRoot = (deps: DeriveDeps): string => path.join(deps.paths.resultsDir, 'derived');

// ---------------------------------------------------------------- the command

/** Plan keys of the decision Cards of a split (used for the completeness check). */
const planKeys = (cards: readonly LoadedCard[]): PlannedKey[] => buildPlan(cards.filter((c) => c.task === 'decision'), ['decision']).map((p) => ({ card_id: p.card.id, permutation: p.permutation }));

/** Runs `derive` (or `derive --verify`). Returns the process exit code. */
export async function derive(deps: DeriveDeps, opts: DeriveOptions): Promise<number> {
  const logger = deps.logger ?? new RunLogger();
  try {
    // 1. Manifest_Check, on every invocation (R1.1).
    await runManifestCheck(deps, logger);

    // 2. The Combination and the gate (task 42.1 replaces the refusing stub).
    const combo = deps.combinations.find((c) => c.id === opts.combo);
    if (combo === undefined) throw new DeriveError('unknown_combination', `${opts.combo} is not in combinations.json`);
    if (!isPermAvg(combo)) throw new DeriveError('not_perm_avg', `${combo.id} is not a perm_avg Combination; derive takes a perm_avg id`);
    const step: DeriveStep = opts.split === 'dev' ? 'derive_dev' : 'derive_locked';
    const decision = deps.gate({ step, combo, approval: opts.approval, taskSubset: 'D' });
    if (!decision.ok) {
      logger.gateRefusal(decision.reason);
      return 1;
    }

    // 3. rule_version check (V18): the rule file, the pinned record and the export agree; the file is the pinned one.
    const pin = combo.aggregation;
    if (pin === undefined) throw new DeriveError('registry', `${combo.id} has no aggregation pin`);
    const rule = loadAggregationRule(deps.paths.repoDir, pin.file);
    if (rule.sha256 !== pin.sha256) throw new DeriveError('rule_hash', `the Aggregation_Rule file differs from the hash pinned for ${combo.id} (R20.8)`);
    const exportVersion = exportRuleVersion(deps.paths.cardsDir);
    try {
      checkRuleVersion(rule.text, exportVersion);
    } catch (e) {
      throw new DeriveError('rule_version', e instanceof Error ? e.message : String(e));
    }
    if (ruleVersionOf(rule.text) !== pin.rule_version) throw new DeriveError('rule_version', `the rule file says rule_version ${String(ruleVersionOf(rule.text))}, the record pins ${pin.rule_version}`);

    // 4. Registry check (R20.1).
    checkRegistry(deps, combo, (file) => {
      try {
        const r = loadAggregationRule(deps.paths.repoDir, file);
        return { sha256: r.sha256, ruleVersion: ruleVersionOf(r.text) };
      } catch {
        return null;
      }
    });

    // 5. Cards of the split (locked.jsonl is read for grading only, RC-18) and the source.
    const single = deps.combinations.find((c) => c.id === combo.derives_from);
    if (single === undefined) throw new DeriveError('unknown_combination', `${combo.id} derives from ${String(combo.derives_from)}, which is not in combinations.json`);
    const mappingFile = (single['mapping'] as { file?: unknown } | undefined)?.file;
    if (typeof mappingFile !== 'string') throw new DeriveError('registry', `${single.id} names no System_One_Mapping file`);
    const mappingHash = loadSystemOneMapping(deps.paths.repoDir, mappingFile).sha256;
    const loaded = loadCards({ cardsDir: deps.paths.cardsDir, splits: opts.split === 'dev' ? ['dev'] : ['dev', 'locked'] });
    const cards = loaded.cards[opts.split];
    const source = findSource(deps, opts.split, single, mappingHash, planKeys(cards));
    if (opts.split === 'locked') requireDerivedDev(deps, combo, mappingHash, pin.sha256);

    // 6. Derive, then write or compare.
    const run = deriveRun({
      split: opts.split,
      cards,
      sourceHeader: source.header,
      sourceRecords: source.records,
      permAvg: combo,
      single,
      mappingHash,
      aggregationHash: pin.sha256,
      ruleVersion: pin.rule_version,
      pinnedManifestHash: deps.pinnedManifestHash,
      simWasmSha256: wasmSha256,
      sourceSha256: source.sha256,
      sourceFile: source.relFile,
      ledgerEntry: source.ledgerEntry,
    });
    const file = path.join(derivedRoot(deps), opts.split, `${run.runId}.jsonl`);
    const gradesFile = gradesPathFor(file);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const existingGrades = fs.existsSync(gradesFile) ? fs.readFileSync(gradesFile, 'utf8') : null;
    const sameResults = existing === run.resultsText;
    const sameGrades = existingGrades === run.gradesText;

    if (opts.verify) {
      if (existing === null) throw new DeriveError('verify_failed', `no derived file to verify: ${file}`);
      if (!sameResults || !sameGrades) throw new DeriveError('verify_failed', `${file} differs from a re-derivation of its source`);
      printLine(`probe: derive: verified ${file}: ${run.records.length} Cards, byte-identical`);
      return 0;
    }
    if (existing !== null && !sameResults) throw new DeriveError('derived_conflict', file);
    if (existingGrades !== null && !sameGrades) throw new DeriveError('derived_conflict', gradesFile);
    if (existing !== null && existingGrades !== null) {
      printLine(`probe: derive: unchanged ${file}`);
    } else {
      if (existing === null) writeTextFile(file, run.resultsText);
      writeTextFile(gradesFile, run.gradesText);
      printLine(`probe: derive: wrote ${file}`);
    }
    printLine(`probe: derive: ${combo.id} ${opts.split}: ${run.records.length} Cards, ${run.records.length - run.illegal.length} answered, ${run.illegal.length} Illegal`);
    for (const i of run.illegal) printLine(`probe: derive: Illegal Card ID ${i.cardId}: ${i.detail}`);
    if (opts.split === 'locked') {
      // R17.4 / design variant gate item 4: the docs/kiro-log.md entry the developer pastes (identifiers and hashes only).
      printLine('probe: docs/kiro-log.md entry to paste (no card content):');
      printLine(
        `- Derived_Run: Combination ${combo.id}, split locked, source entry ${source.ledgerEntry ?? 'none'}, source Results sha256 ${source.sha256}, ` +
          `derived file sha256 ${sha256Of(run.resultsText)}, approval ${opts.approval ?? 'none'}.`,
      );
    }
    return 0;
  } catch (e) {
    return fail(logger, e);
  }
}

/** The `rule_version` the export returns, read with a probe call on the first Card of the Dev_Card_Set (no Locked_Card is touched). */
function exportRuleVersion(cardsDir: string): number {
  const dev = loadCards({ cardsDir, splits: ['dev'] }).cards.dev.find((c) => c.task === 'decision');
  if (dev === undefined) throw new DeriveError('rule_version', 'there is no decision Dev_Card to ask the export for its rule_version');
  const out = JSON.parse(llmAggregatePermAvg(JSON.stringify({ frozen_context: cardFacts(dev).frozenContext, scope: 'scored', question_id: 'decision', calls: [] }), dev.id)) as { ok: boolean; rule_version?: number };
  if (out.ok !== true || typeof out.rule_version !== 'number') throw new DeriveError('rule_version', 'the export returned no rule_version');
  return out.rule_version;
}

function fail(logger: RunLogger, e: unknown): number {
  if (e instanceof DeriveError) {
    if (e.code === 'registry' && e.message.startsWith('registry changed')) printErrorLine(`probe: variant: ${e.message}`);
    else printErrorLine(`probe: derive: ${e.code}: ${e.message}`);
    return 1;
  }
  if (e instanceof ResultsFormatError) {
    logger.resultsError(e.message);
    return 1;
  }
  if (e instanceof LedgerError) {
    logger.ledgerError(e);
    return 1;
  }
  if (e instanceof CardLoadError) {
    logger.cardLoad(e.failures);
    return 1;
  }
  return reportFailure(logger, e);
}

// ---------------------------------------------------------------- CLI wiring

/** Wiring for the real `probe derive`: the committed paths and records, and the gate stub until task 42.1. */
export function defaultDeriveDeps(repoDir: string = REPO_DIR, gate: DeriveGate = refusingDeriveGate): DeriveDeps {
  return {
    paths: defaultRunPaths(repoDir),
    pinnedManifestHash: PINNED_MANIFEST_HASH,
    combinations: parseCombinations(fs.readFileSync(path.join(repoDir, 'eval/probe/combinations.json'), 'utf8')),
    gate,
  };
}

/** `derive`. Returns the exit code. */
export async function deriveCommand(argv: readonly string[], deps: DeriveDeps): Promise<number> {
  const parsed = parseDeriveArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: derive: ${parsed.message}`);
    return 2;
  }
  return derive(deps, parsed.options);
}

