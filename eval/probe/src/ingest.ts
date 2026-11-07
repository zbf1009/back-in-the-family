// Probe_Page bundle, export check, `ingest` and `regrade` (llm-probe task 13.7; design "Probe_Page
// bundle and export", R10.3 to R10.5, R10.11, R12.5, R12.6, R3.1).
//
//   page-bundle  -> eval/results/bundles/<run-id>.json         (llm-probe-bundle-v1, gitignored)
//   ingest       -> eval/results/ingest/<run-id>.json          (the export, byte for byte)
//                   eval/results/<split>/<run-id>.jsonl        (Results, same form as a headless run)
//                   eval/results/<split>/<run-id>.grades.jsonl (graded through Sim_Wasm)
//   regrade      -> reads a Results file and its grades file, writes nothing
//
// Rules this file keeps:
// - The Probe_Page receives only runner-rendered prompts (R10.11). Nothing here reads a card to render.
// - `ingest` and `regrade` read the Card_Set for grading only (R3.1): they call llm_validate, llm_grade,
//   llm_identity and llm_contrast (through run-grading.ts) and never llm_render_prompt. They print counts,
//   run IDs and Card IDs only.
// - All checks of an export happen before anything is written. A rejected file writes no Results (R10.5).
// - All grading decisions come from Sim_Wasm; this file holds no validation or scoring logic.
import * as fs from 'node:fs';
import path from 'node:path';
import type { OutputConstraint, Prompt } from './adapters/interface.ts';
import { loadCards, type LoadedCard, type TaskType } from './cards.ts';
import { appendComplete, readLedger, subsetTaskTypes, type LedgerEntry, type PlannedRun } from './ledger.ts';
import { metricCardFromLoaded } from './metrics.ts';
import { comboModelKey, type Combination } from './phase.ts';
import { analyzeRun } from './report.ts';
import {
  canonicalJson,
  fingerprintId,
  gradesPathFor,
  LATE_NONE_REASONS,
  readGradesFile,
  readResultsFile,
  ResultsFormatError,
  ResultsWriter,
  resultsPath,
  SCHEMA,
  serializeLine,
  writeGradesFile,
  type JsonObject,
  type JsonValue,
  type Late,
  type Outcome,
  type ResultRecord,
  type ResultsHeader,
  type Split,
  type TaskSubset,
} from './results.ts';
import { gradeRecords, hasOutput } from './run-grading.ts';
import { RunLogger } from './run-logger.ts';
import { reportFailure, runManifestCheck, type PageBundleData, type RunDeps } from './run.ts';
import { writeTextFile } from './sink.ts';

export const BUNDLE_SCHEMA = 'llm-probe-bundle-v1';
export const PAGE_EXPORT_SCHEMA = 'llm-probe-page-export-v1';

/** What `ingest` and `regrade` need from the run wiring. `RunDeps` fits. */
export interface IngestDeps {
  readonly paths: RunDeps['paths'];
  readonly pinnedManifestHash: string;
  readonly now?: () => number;
  readonly logger?: RunLogger;
}

// ---------------------------------------------------------------- types

export interface BundleRequest {
  readonly card_id: string;
  readonly permutation: string;
  readonly task: TaskType;
  readonly prompt: Prompt;
  readonly constraint: OutputConstraint;
}

export interface Bundle {
  readonly schema: typeof BUNDLE_SCHEMA;
  readonly run_id: string;
  readonly split: Split;
  readonly task_subset: TaskSubset;
  readonly combination: Combination;
  readonly template_hashes: { readonly [name: string]: string };
  readonly pinned_manifest_hash: string;
  readonly timeout_ms: number;
  readonly requests: readonly BundleRequest[];
}

export type ExportOutcome =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'error'; readonly code: string; readonly detail: string };

export interface ExportEntry {
  readonly card_id: string;
  readonly permutation: string;
  readonly outcome: ExportOutcome;
  /** Whole milliseconds from the request being sent until the response completed or the page gave up. */
  readonly latency_ms: number;
  readonly requested_at: string;
  /** Only for a `timeout` outcome: the Late_Answer or the marker that none arrived (R12.10). */
  readonly late: Late | null;
}

export interface PageExport {
  readonly schema: typeof PAGE_EXPORT_SCHEMA;
  readonly run_id: string;
  readonly split: Split;
  readonly template_hashes: { readonly [name: string]: string };
  readonly pinned_manifest_hash: string;
  /** The full Model_Fingerprint, including `browser.version` and `webgpu.description` (R10.3). */
  readonly fingerprint: JsonObject;
  readonly cold_start: { readonly empty_cache_ms: number; readonly warm_cache_ms: number };
  readonly entries: readonly ExportEntry[];
}

/** An export or bundle is rejected. `entry` names the first failing entry (or the field), `reason` says why. */
export class IngestError extends Error {
  readonly entry: string;
  readonly reason: string;
  constructor(entry: string, reason: string) {
    super(`${entry}: ${reason}`);
    this.name = 'IngestError';
    this.entry = entry;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------- hand-written guards

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A short, printable form of an ID found in a file. */
const shown = (v: string): string => JSON.stringify(v.length > 80 ? `${v.slice(0, 77)}...` : v);

function need(cond: boolean, where: string, reason: string): asserts cond {
  if (!cond) throw new IngestError(where, reason);
}

function objectAt(v: unknown, where: string): Obj {
  need(isObj(v), where, 'must be an object');
  return v;
}

function exactKeys(o: Obj, keys: readonly string[], where: string): void {
  for (const k of keys) need(k in o, where, `is missing the field "${k}"`);
  for (const k of Object.keys(o)) need(keys.includes(k), where, `has the unknown field "${k}"`);
}

function stringAt(v: unknown, where: string): string {
  need(typeof v === 'string', where, 'must be a string');
  return v;
}

function nonEmptyAt(v: unknown, where: string): string {
  need(stringAt(v, where) !== '', where, 'must not be empty');
  return v as string;
}

function wholeMs(v: unknown, where: string): number {
  need(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0, where, 'must be a non-negative whole number of milliseconds');
  return v as number;
}

function isJson(v: unknown): v is JsonValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJson);
  return isObj(v) && Object.values(v).every(isJson);
}

function hashMapAt(v: unknown, where: string): { [name: string]: string } {
  const o = objectAt(v, where);
  const out: { [name: string]: string } = {};
  for (const [k, h] of Object.entries(o)) out[k] = stringAt(h, `${where}.${k}`);
  return out;
}

const SPLITS: readonly string[] = ['dev', 'locked'];
const SUBSETS: readonly string[] = ['D', 'S', 'DS'];
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REQUESTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function runIdAt(v: unknown, where: string): string {
  const id = stringAt(v, where);
  need(RUN_ID.test(id), where, 'must start with a letter or digit and hold only letters, digits, ".", "_" and "-"');
  return id;
}

// ---------------------------------------------------------------- bundle

function constraintAt(v: unknown, where: string): OutputConstraint {
  const o = objectAt(v, where);
  if (o['kind'] === 'none') {
    exactKeys(o, ['kind'], where);
    return { kind: 'none' };
  }
  need(o['kind'] === 'json_schema', `${where}.kind`, 'must be "none" or "json_schema"');
  exactKeys(o, ['kind', 'schema'], where);
  need(isJson(o['schema']), `${where}.schema`, 'must be JSON');
  return { kind: 'json_schema', schema: o['schema'] };
}

/** Validates a bundle read back from disk. Throws IngestError naming the bad field. */
export function parseBundle(v: unknown): Bundle {
  const o = objectAt(v, 'bundle');
  exactKeys(o, ['schema', 'run_id', 'split', 'task_subset', 'combination', 'template_hashes', 'pinned_manifest_hash', 'timeout_ms', 'requests'], 'bundle');
  need(o['schema'] === BUNDLE_SCHEMA, 'bundle.schema', `must be "${BUNDLE_SCHEMA}"`);
  need(typeof o['split'] === 'string' && SPLITS.includes(o['split']), 'bundle.split', 'must be dev or locked');
  need(typeof o['task_subset'] === 'string' && SUBSETS.includes(o['task_subset']), 'bundle.task_subset', 'must be D, S or DS');
  const combo = objectAt(o['combination'], 'bundle.combination');
  for (const k of ['id', 'runtime', 'model_id', 'revision']) nonEmptyAt(combo[k], `bundle.combination.${k}`);
  stringAt(combo['quantization'], 'bundle.combination.quantization');
  need(isJson(combo), 'bundle.combination', 'must be JSON');
  const timeout = wholeMs(o['timeout_ms'], 'bundle.timeout_ms');
  need(timeout >= 1, 'bundle.timeout_ms', 'must be positive');
  need(Array.isArray(o['requests']), 'bundle.requests', 'must be an array');
  const seen = new Set<string>();
  const requests = o['requests'].map((r: unknown, i): BundleRequest => {
    const where = `bundle.requests[${i}]`;
    const q = objectAt(r, where);
    exactKeys(q, ['card_id', 'permutation', 'task', 'prompt', 'constraint'], where);
    const prompt = objectAt(q['prompt'], `${where}.prompt`);
    exactKeys(prompt, ['system', 'user'], `${where}.prompt`);
    need(q['task'] === 'decision' || q['task'] === 'synthesis', `${where}.task`, 'must be decision or synthesis');
    const card_id = nonEmptyAt(q['card_id'], `${where}.card_id`);
    const permutation = nonEmptyAt(q['permutation'], `${where}.permutation`);
    const key = pairKey(card_id, permutation);
    need(!seen.has(key), where, 'repeats a Card ID and Permutation');
    seen.add(key);
    return {
      card_id,
      permutation,
      task: q['task'],
      prompt: { system: stringAt(prompt['system'], `${where}.prompt.system`), user: stringAt(prompt['user'], `${where}.prompt.user`) },
      constraint: constraintAt(q['constraint'], `${where}.constraint`),
    };
  });
  return {
    schema: BUNDLE_SCHEMA,
    run_id: runIdAt(o['run_id'], 'bundle.run_id'),
    split: o['split'] as Split,
    task_subset: o['task_subset'] as TaskSubset,
    combination: combo as unknown as Combination,
    template_hashes: hashMapAt(o['template_hashes'], 'bundle.template_hashes'),
    pinned_manifest_hash: stringAt(o['pinned_manifest_hash'], 'bundle.pinned_manifest_hash'),
    timeout_ms: timeout,
    requests,
  };
}

/** `<resultsDir>/bundles/<run-id>.json` */
export function bundlePath(resultsDir: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`invalid run_id "${runId}"`);
  return path.join(resultsDir, 'bundles', `${runId}.json`);
}

/** `<resultsDir>/ingest/<run-id>.json` */
export function ingestPath(resultsDir: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`invalid run_id "${runId}"`);
  return path.join(resultsDir, 'ingest', `${runId}.json`);
}

/** The bundle as JSON text (canonical, newline-terminated). */
export function serializeBundle(data: PageBundleData): string {
  const bundle: Bundle = {
    schema: BUNDLE_SCHEMA,
    run_id: data.runId,
    split: data.split,
    task_subset: data.taskSubset,
    combination: data.combination,
    template_hashes: data.templateHashes,
    pinned_manifest_hash: data.pinnedManifestHash,
    timeout_ms: data.timeoutMs,
    requests: data.requests,
  };
  return `${canonicalJson(bundle)}\n`;
}

/**
 * Writes `eval/results/bundles/<run-id>.json` and returns its path. The bundle holds rendered prompts
 * (for a locked run, rendered locked prompts), so the directory is gitignored. Refuses to replace a file.
 */
export function writeBundle(resultsDir: string, data: PageBundleData): string {
  const file = bundlePath(resultsDir, data.runId);
  if (fs.existsSync(file)) throw new Error(`${file} already exists; a bundle is never replaced`);
  parseBundle(JSON.parse(serializeBundle(data)));
  writeTextFile(file, serializeBundle(data));
  return file;
}

/** Reads the bundle of a run. Throws IngestError when it is missing or malformed. */
export function readBundle(resultsDir: string, runId: string): Bundle {
  const file = bundlePath(resultsDir, runId);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new IngestError('run_id', `no bundle for run ${shown(runId)} (run page-bundle first)`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new IngestError('bundle', 'the bundle file is not valid JSON');
  }
  const bundle = parseBundle(value);
  need(bundle.run_id === runId, 'bundle.run_id', 'differs from the file name');
  return bundle;
}

// ---------------------------------------------------------------- export: schema check

const pairKey = (cardId: string, permutation: string): string => `${cardId}\u0000${permutation}`;

function entryLabel(i: number, e: unknown): string {
  if (isObj(e) && typeof e['card_id'] === 'string' && typeof e['permutation'] === 'string') {
    return `entries[${i}] (Card ID ${shown(e['card_id'])}, permutation ${shown(e['permutation'])})`;
  }
  return `entries[${i}]`;
}

function exportOutcomeAt(v: unknown, where: string): ExportOutcome {
  const o = objectAt(v, where);
  need(typeof o['kind'] === 'string' && ['text', 'timeout', 'error'].includes(o['kind']), `${where}.kind`, 'must be text, timeout or error');
  switch (o['kind']) {
    case 'text':
      exactKeys(o, ['kind', 'text'], where);
      return { kind: 'text', text: stringAt(o['text'], `${where}.text`) };
    case 'timeout':
      exactKeys(o, ['kind'], where);
      return { kind: 'timeout' };
    default:
      exactKeys(o, ['kind', 'code', 'detail'], where);
      return { kind: 'error', code: nonEmptyAt(o['code'], `${where}.code`), detail: stringAt(o['detail'], `${where}.detail`) };
  }
}

function lateAt(v: unknown, where: string): Late | null {
  if (v === null) return null;
  const o = objectAt(v, where);
  need(o['kind'] === 'late' || o['kind'] === 'none', `${where}.kind`, 'must be late or none');
  if (o['kind'] === 'late') {
    exactKeys(o, ['kind', 'text', 'latency_ms'], where);
    return { kind: 'late', text: stringAt(o['text'], `${where}.text`), latency_ms: wholeMs(o['latency_ms'], `${where}.latency_ms`) };
  }
  exactKeys(o, ['kind', 'reason'], where);
  need(typeof o['reason'] === 'string' && (LATE_NONE_REASONS as readonly string[]).includes(o['reason']), `${where}.reason`, `must be one of ${LATE_NONE_REASONS.join(', ')}`);
  return { kind: 'none', reason: o['reason'] as (typeof LATE_NONE_REASONS)[number] };
}

function entryAt(v: unknown, i: number): ExportEntry {
  const label = entryLabel(i, v);
  const o = objectAt(v, label);
  exactKeys(o, ['card_id', 'permutation', 'outcome', 'latency_ms', 'requested_at', 'late'], label);
  const outcome = exportOutcomeAt(o['outcome'], `${label} outcome`);
  const late = lateAt(o['late'], `${label} late`);
  need(outcome.kind === 'timeout' || late === null, `${label} late`, 'must be null unless the outcome is a timeout');
  const requested = stringAt(o['requested_at'], `${label} requested_at`);
  need(REQUESTED_AT.test(requested), `${label} requested_at`, 'must be a UTC timestamp with millisecond precision');
  return {
    card_id: nonEmptyAt(o['card_id'], `${label} card_id`),
    permutation: nonEmptyAt(o['permutation'], `${label} permutation`),
    outcome,
    latency_ms: wholeMs(o['latency_ms'], `${label} latency_ms`),
    requested_at: requested,
    late,
  };
}

function fingerprintAt(v: unknown): JsonObject {
  const where = 'fingerprint';
  const o = objectAt(v, where);
  need(isJson(o), where, 'must be JSON');
  const key = objectAt(o['model_key'], `${where}.model_key`);
  for (const k of ['runtime', 'model_id', 'quantization', 'revision']) stringAt(key[k], `${where}.model_key.${k}`);
  const browser = objectAt(o['browser'], `${where}.browser`);
  nonEmptyAt(browser['version'], `${where}.browser.version`);
  const gpu = objectAt(o['webgpu'], `${where}.webgpu`);
  stringAt(gpu['description'], `${where}.webgpu.description`);
  return o as JsonObject;
}

/** The fixed schema check of an export (R10.5). Entries are checked in file order; the first failure is thrown. */
export function parseExport(v: unknown): PageExport {
  const o = objectAt(v, 'export');
  need(typeof o['schema'] === 'string', 'schema', 'is missing');
  need(o['schema'] === PAGE_EXPORT_SCHEMA, 'schema', `must be "${PAGE_EXPORT_SCHEMA}"`);
  exactKeys(o, ['schema', 'run_id', 'split', 'template_hashes', 'pinned_manifest_hash', 'fingerprint', 'cold_start', 'entries'], 'export');
  need(typeof o['split'] === 'string' && SPLITS.includes(o['split']), 'split', 'must be dev or locked');
  const cold = objectAt(o['cold_start'], 'cold_start');
  exactKeys(cold, ['empty_cache_ms', 'warm_cache_ms'], 'cold_start');
  need(Array.isArray(o['entries']), 'entries', 'must be an array');
  return {
    schema: PAGE_EXPORT_SCHEMA,
    run_id: runIdAt(o['run_id'], 'run_id'),
    split: o['split'] as Split,
    template_hashes: hashMapAt(o['template_hashes'], 'template_hashes'),
    pinned_manifest_hash: stringAt(o['pinned_manifest_hash'], 'pinned_manifest_hash'),
    fingerprint: fingerprintAt(o['fingerprint']),
    cold_start: { empty_cache_ms: wholeMs(cold['empty_cache_ms'], 'cold_start.empty_cache_ms'), warm_cache_ms: wholeMs(cold['warm_cache_ms'], 'cold_start.warm_cache_ms') },
    entries: o['entries'].map(entryAt),
  };
}

// ---------------------------------------------------------------- export: consistency with the run

/**
 * Checks a schema-valid export against its bundle: split, Template_Hash, Pinned_Manifest_Hash, then, in file
 * order, any entry whose Card ID and Permutation are not part of the run or repeat an earlier entry, then
 * the first Card x Permutation of the run (bundle order) that has no entry. Throws the first failure.
 */
export function checkExport(bundle: Bundle, exp: PageExport): void {
  need(exp.split === bundle.split, 'split', `is ${shown(exp.split)} but the run's is ${shown(bundle.split)}`);
  const names = [...new Set([...Object.keys(bundle.template_hashes), ...Object.keys(exp.template_hashes)])].sort();
  for (const name of names) {
    const mine = exp.template_hashes[name];
    const theirs = bundle.template_hashes[name];
    need(mine === theirs, `template_hashes.${name}`, `Template_Hash differs from the run's (export ${mine ?? 'none'}, run ${theirs ?? 'none'})`);
  }
  need(
    exp.pinned_manifest_hash === bundle.pinned_manifest_hash,
    'pinned_manifest_hash',
    `Pinned_Manifest_Hash differs from the run's (export ${exp.pinned_manifest_hash}, run ${bundle.pinned_manifest_hash})`,
  );
  const wanted = new Set(bundle.requests.map((r) => pairKey(r.card_id, r.permutation)));
  const seen = new Set<string>();
  exp.entries.forEach((e, i) => {
    const key = pairKey(e.card_id, e.permutation);
    const label = entryLabel(i, e);
    need(wanted.has(key), label, 'the Card ID and Permutation are not part of the run');
    need(!seen.has(key), label, 'a second entry for the same Card ID and Permutation');
    seen.add(key);
  });
  for (const r of bundle.requests) {
    need(seen.has(pairKey(r.card_id, r.permutation)), `missing entry (Card ID ${shown(r.card_id)}, permutation ${shown(r.permutation)})`, 'the run has no entry for this Card ID and Permutation');
  }
}

// ---------------------------------------------------------------- Results records from an export

/** Outcome, latency and late text of one entry as a headless run would have stored them (R10.4). */
function recordOutcome(e: ExportEntry, timeoutMs: number): { outcome: Outcome; late: Late | null } {
  const o = e.outcome;
  if (o.kind === 'error') return { outcome: { kind: 'error', code: o.code, detail: o.detail, remote: false }, late: null };
  if (o.kind === 'timeout') return { outcome: { kind: 'timeout' }, late: e.late ?? { kind: 'none', reason: 'aborted' } };
  // Text that arrived after the Timeout is a Timeout (Illegal); its text is the Late_Answer.
  if (e.latency_ms > timeoutMs) return { outcome: { kind: 'timeout' }, late: { kind: 'late', text: o.text, latency_ms: e.latency_ms } };
  return { outcome: { kind: 'text', text: o.text }, late: null };
}

/** The header and records `ingest` writes, in the bundle's request order. */
export function buildResults(bundle: Bundle, exp: PageExport): { header: ResultsHeader; records: ResultRecord[] } {
  const header: ResultsHeader = {
    schema: SCHEMA.header,
    run_id: bundle.run_id,
    split: bundle.split,
    combination: bundle.combination.id,
    model_key: comboModelKey(bundle.combination),
    task_subset: bundle.task_subset,
    fingerprint: exp.fingerprint,
    template_hashes: { ...bundle.template_hashes },
    timeout_ms: bundle.timeout_ms,
    placement: null,
  };
  const fpId = fingerprintId(exp.fingerprint);
  const byKey = new Map(exp.entries.map((e) => [pairKey(e.card_id, e.permutation), e] as const));
  const records = bundle.requests.map((r): ResultRecord => {
    const e = byKey.get(pairKey(r.card_id, r.permutation)) as ExportEntry;
    const { outcome, late } = recordOutcome(e, bundle.timeout_ms);
    return {
      schema: SCHEMA.result,
      run_id: bundle.run_id,
      split: bundle.split,
      card_id: r.card_id,
      permutation: r.permutation,
      outcome,
      latency_ms: e.latency_ms,
      timeout_ms: bundle.timeout_ms,
      requested_at: e.requested_at,
      template_hash: bundle.template_hashes[r.task] as string,
      fingerprint_id: fpId,
      usage: null,
      late,
      source: 'probe_page',
    };
  });
  return { header, records };
}

// ---------------------------------------------------------------- shared helpers

const logOf = (deps: IngestDeps): RunLogger => deps.logger ?? new RunLogger();

/** Cards of the split a Results file belongs to. A locked run also loads dev, as `locked-run` does. */
function cardsFor(deps: IngestDeps, split: Split): LoadedCard[] {
  return loadCards({ cardsDir: deps.paths.cardsDir, splits: split === 'dev' ? ['dev'] : ['dev', 'locked'] }).cards[split];
}

function tasksOf(subset: TaskSubset): TaskType[] {
  return subsetTaskTypes(subset);
}

function failure(logger: RunLogger, e: unknown): number {
  if (e instanceof IngestError) {
    logger.ingestRejected(e.entry, e.reason);
    return 1;
  }
  if (e instanceof ResultsFormatError) {
    logger.resultsError(e.message);
    return 1;
  }
  return reportFailure(logger, e);
}

function plannedOf(bundle: Bundle): PlannedRun[] {
  return bundle.requests.map((r) => ({ card_id: r.card_id, permutation: r.permutation, task: r.task }));
}

function lockedEntry(deps: IngestDeps, bundle: Bundle): LedgerEntry {
  const entry = readLedger(deps.paths.ledger).entries.find((e) => e.entry_id === bundle.run_id);
  need(entry !== undefined, 'run_id', `no ledger entry ${shown(bundle.run_id)} for this locked run`);
  need(entry.status === 'incomplete', 'run_id', `ledger entry ${shown(bundle.run_id)} is already complete`);
  need(entry.start.combination === bundle.combination.id && entry.start.task_subset === bundle.task_subset, 'run_id', `ledger entry ${shown(bundle.run_id)} is for a different Combination or Task_Type_Subset`);
  return entry;
}

// ---------------------------------------------------------------- ingest

/**
 * `ingest --file <export.json>` (R10.4, R10.5, R12.5). Order: Manifest_Check, read and schema check, bundle
 * lookup, consistency check, then (still before any write) the store and ledger preconditions and the grading
 * in memory. Only then are the export, the Results and the grades written. Returns the exit code.
 */
export async function ingest(deps: IngestDeps, file: string): Promise<number> {
  const logger = logOf(deps);
  try {
    await runManifestCheck(deps, logger);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      throw new IngestError('file', 'cannot read the export file');
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new IngestError('file', 'the export is not valid JSON');
    }
    const exp = parseExport(value);
    const bundle = readBundle(deps.paths.resultsDir, exp.run_id);
    checkExport(bundle, exp);

    // Nothing is written until everything below has passed.
    const stored = ingestPath(deps.paths.resultsDir, exp.run_id);
    const resultsFile = resultsPath(deps.paths.resultsDir, bundle.split, bundle.run_id);
    need(!fs.existsSync(stored) && !fs.existsSync(resultsFile), 'run_id', `run ${shown(exp.run_id)} was already ingested; Results are never rewritten`);
    const entry = bundle.split === 'locked' ? lockedEntry(deps, bundle) : null;
    const { header, records } = buildResults(bundle, exp);
    const graded = gradeRecords(cardsFor(deps, bundle.split), records, tasksOf(bundle.task_subset));

    writeTextFile(stored, text);
    const writer = ResultsWriter.create(deps.paths.resultsDir, header);
    for (const r of records) writer.append(r);
    writeGradesFile(gradesPathFor(writer.file), graded.grades, graded.contrasts, graded.excluded);
    logger.status('results written', { count: records.length });
    logger.status('grades written');
    if (entry !== null) {
      const ended = new Date((deps.now ?? Date.now)()).toISOString();
      appendComplete(deps.paths.ledger, entry.entry_id, { ended_at: ended, results: path.relative(deps.paths.repoDir, writer.file), requests_sent: records.filter(hasOutput).length }, plannedOf(bundle), records);
      logger.status('complete', { entryId: entry.entry_id });
    }
    logger.summary({ total: records.length, withOutput: records.filter(hasOutput).length, notRun: 0, engineFaults: 0 });
    return 0;
  } catch (e) {
    return failure(logger, e);
  }
}

// ---------------------------------------------------------------- regrade

/** Index (1-based) of the first line where two texts differ, or 0 when equal. */
function firstDifferingLine(a: string, b: string): number {
  if (a === b) return 0;
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 0;
}

/** The text `writeGradesFile` would write for these grades. */
export function gradesText(graded: ReturnType<typeof gradeRecords>): string {
  const lines = [...graded.grades, ...graded.contrasts, { schema: SCHEMA.excluded, excluded: [...graded.excluded] }];
  return lines.map((l) => serializeLine(l)).join('');
}

/**
 * `regrade --results <file>` (R12.6). Reads the stored Results and grades files, re-validates and re-grades every
 * record through Sim_Wasm, and requires (1) byte-equal grades lines and (2) identical Metrics, Cluster_Bootstrap
 * intervals and Wilson_Intervals computed from the stored and from the recomputed grades. It sends no request to
 * any Runtime and writes nothing. A Results file that cannot be read stops with an error naming file and record.
 */
export async function regrade(deps: IngestDeps, resultsFile: string): Promise<number> {
  const logger = logOf(deps);
  try {
    await runManifestCheck(deps, logger);
    const results = readResultsFile(resultsFile);
    const gradesFile = gradesPathFor(resultsFile);
    if (!fs.existsSync(gradesFile)) throw new ResultsFormatError(gradesFile, 0, 'there is no grades file to compare with');
    const stored = readGradesFile(gradesFile);
    const storedText = fs.readFileSync(gradesFile, 'utf8');

    const cards = cardsFor(deps, results.header.split);
    const tasks = tasksOf(results.header.task_subset);
    const graded = gradeRecords(cards, results.records, tasks);
    const again = gradesText(graded);
    const diff = firstDifferingLine(storedText, again);
    if (diff !== 0) {
      logger.resultsError(`${gradesFile}:${diff}: regrade differs from the stored grades at this line`);
      return 1;
    }

    const metricCards = cards.map(metricCardFromLoaded);
    const base = { kind: results.header.split, id: results.header.run_id, cards: metricCards, header: results.header, records: results.records, perf: null } as const;
    const fromStored = JSON.stringify(analyzeRun({ ...base, grades: stored }));
    const fromAgain = JSON.stringify(analyzeRun({ ...base, grades: { grades: graded.grades, contrasts: graded.contrasts, excluded: graded.excluded } }));
    if (fromStored !== fromAgain) {
      logger.resultsError(`${resultsFile}: regrade gives different Metrics or intervals than the stored grades`);
      return 1;
    }
    logger.regradeOk(resultsFile, results.records.length, graded.grades.length + graded.contrasts.length + 1);
    return 0;
  } catch (e) {
    return failure(logger, e);
  }
}
