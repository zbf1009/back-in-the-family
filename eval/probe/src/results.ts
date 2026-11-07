// Results files, grades files and the other `llm-probe-*` records under eval/results/
// (R12.1-R12.5, R12.7-R12.12, R2.8). Every record is one canonical JSON line with a
// `schema` that starts with the Schema_Prefix. All writes go through sink.ts.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { appendTextFile, writeTextFile } from './sink.ts';

export const SCHEMA_PREFIX = 'llm-probe-';

export const SCHEMA = {
  header: 'llm-probe-results-header-v1',
  result: 'llm-probe-result-v1',
  grade: 'llm-probe-grade-v1',
  contrast: 'llm-probe-contrast-v1',
  excluded: 'llm-probe-excluded-v1',
  smoke: 'llm-probe-smoke-v1',
  perf: 'llm-probe-perf-v1',
  preflight: 'llm-probe-preflight-v1',
  exclusion: 'llm-probe-exclusion-v1',
  failure: 'llm-probe-failure-v1',
} as const;

// ---------------------------------------------------------------- types

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type Split = 'dev' | 'locked';
export type TaskSubset = 'D' | 'S' | 'DS';
export type Source = 'headless' | 'probe_page' | 'node';

export const NOT_RUN_REASONS = ['budget', 'not_approved', 'render_error', 'load_failed', 'oom', 'rebuild_failed'] as const;
export type NotRunReason = (typeof NOT_RUN_REASONS)[number];
export const LATE_NONE_REASONS = ['generation_cap', 'idle_cap', 'aborted', 'error'] as const;
export type LateNoneReason = (typeof LATE_NONE_REASONS)[number];

export type Outcome =
  | { kind: 'text'; text: string }
  | { kind: 'timeout' }
  | { kind: 'error'; code: string; detail: string; remote: boolean }
  | { kind: 'engine_fault'; code: 'runtime_stuck'; detail: string }
  | { kind: 'not_run'; reason: NotRunReason; detail: string };

export type Late = { kind: 'late'; text: string; latency_ms: number } | { kind: 'none'; reason: LateNoneReason };

export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
}

export interface ModelKey {
  runtime: string;
  model_id: string;
  quantization: string;
  revision: string;
}

export interface Placement {
  method: string;
  cpu_nodes: { op_type: string; count: number }[];
}

export interface ResultsHeader {
  schema: typeof SCHEMA.header;
  run_id: string;
  split: Split;
  combination: string;
  model_key: ModelKey;
  task_subset: TaskSubset;
  /** The complete Model_Fingerprint (design: Model_Fingerprint). */
  fingerprint: JsonObject;
  template_hashes: { [name: string]: string };
  timeout_ms: number;
  placement: Placement | null;
}

export interface ResultRecord {
  schema: typeof SCHEMA.result;
  run_id: string;
  split: Split;
  card_id: string;
  permutation: string;
  outcome: Outcome;
  /** Whole milliseconds; `null` for `not_run` (R12.9) and possibly for `engine_fault`. */
  latency_ms: number | null;
  timeout_ms: number;
  requested_at: string;
  template_hash: string;
  fingerprint_id: string;
  usage: Usage | null;
  late: Late | null;
  source: Source;
}

export interface GradeLine {
  schema: typeof SCHEMA.grade;
  card_id: string;
  permutation: string;
  verdict: JsonValue;
  grade: JsonValue;
  identity: JsonValue;
  late_grade: JsonValue | null;
}

export interface ContrastLine {
  schema: typeof SCHEMA.contrast;
  pair_id: string;
  contrast: JsonValue;
}

export type ExcludedReason = 'void' | 'sanity';
export interface ExcludedLine {
  schema: typeof SCHEMA.excluded;
  excluded: { id: string; reason: ExcludedReason }[];
}

export type GradesLine = GradeLine | ContrastLine | ExcludedLine;

export interface ExclusionRecord {
  schema: typeof SCHEMA.exclusion;
  combination: string;
  model: string;
  check: 'vram' | 'download' | 'params' | 'unpinned' | 'preflight_load' | 'preflight_vram';
  value: number | string;
  limit: number | string | null;
  at: string;
}

/** Free-form records: only the schema and a few anchor fields are fixed here. */
export interface FailureRecord extends JsonObject {
  schema: typeof SCHEMA.failure;
  combination: string;
  kind: string;
}
export interface SmokeRecord extends JsonObject {
  schema: typeof SCHEMA.smoke;
}
export interface PerfRecord extends JsonObject {
  schema: typeof SCHEMA.perf;
  run_kind: 'locked' | 'dev';
  fresh_profile: boolean;
}
export interface PreflightRecord extends JsonObject {
  schema: typeof SCHEMA.preflight;
  prompt_bytes: number;
  event_count: number;
  person_count: number;
  new_tokens: number;
  eos_disabled: true;
}

// ---------------------------------------------------------------- errors

/** A file could not be parsed or a record does not match its schema (R12.7). */
export class ResultsFormatError extends Error {
  readonly file: string;
  /** 1-based line number of the first failing record; 0 when no single line applies. */
  readonly line: number;
  readonly problem: string;
  constructor(file: string, line: number, problem: string) {
    super(`${file}${line > 0 ? `:${line}` : ''}: ${problem}`);
    this.name = 'ResultsFormatError';
    this.file = file;
    this.line = line;
    this.problem = problem;
  }
}

class SchemaFault extends Error {}
function fault(message: string): never {
  throw new SchemaFault(message);
}

// ---------------------------------------------------------------- canonical JSON

function canonicalValue(value: unknown, where: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      // JSON.stringify escapes control characters and lone surrogates, so every
      // UTF-16 string survives the round trip.
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new SchemaFault(`${where}: number is not finite`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => canonicalValue(v, `${where}[${i}]`)).join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      // `schema` first, the other keys in code-unit order.
      if (keys.includes('schema')) keys.splice(keys.indexOf('schema'), 1), keys.unshift('schema');
      const parts: string[] = [];
      for (const k of keys) {
        if (obj[k] === undefined) throw new SchemaFault(`${where}.${k}: undefined is not JSON`);
        parts.push(`${JSON.stringify(k)}:${canonicalValue(obj[k], `${where}.${k}`)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new SchemaFault(`${where}: ${typeof value} is not JSON`);
  }
}

/** Canonical JSON: keys sorted (`schema` first), no whitespace. Throws on non-JSON values. */
export function canonicalJson(value: unknown): string {
  try {
    return canonicalValue(value, '$');
  } catch (e) {
    if (e instanceof SchemaFault) throw new Error(`canonicalJson: ${e.message}`);
    throw e;
  }
}

/** Fingerprint ID: `fp-` plus the sha256 (hex) of the fingerprint's canonical JSON. */
export function fingerprintId(fingerprint: JsonObject): string {
  return `fp-${createHash('sha256').update(canonicalJson(fingerprint), 'utf8').digest('hex')}`;
}

// ---------------------------------------------------------------- type guards

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown, where: string): Obj {
  if (!isPlainObject(v)) fault(`${where} must be an object`);
  return v;
}
function exactKeys(o: Obj, keys: readonly string[], where: string): void {
  for (const k of keys) if (!(k in o)) fault(`${where} is missing field "${k}"`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) fault(`${where} has unknown field "${k}"`);
}
function str(v: unknown, where: string): string {
  if (typeof v !== 'string') fault(`${where} must be a string`);
  return v;
}
function nonEmptyStr(v: unknown, where: string): string {
  if (str(v, where) === '') fault(`${where} must not be empty`);
  return v as string;
}
function int(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fault(`${where} must be a non-negative integer`);
  return v;
}
function intOrNull(v: unknown, where: string): number | null {
  return v === null ? null : int(v, where);
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fault(`${where} must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}
function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') fault(`${where} must be a boolean`);
  return v;
}
function json(v: unknown, where: string): JsonValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fault(`${where} must be a finite number`);
    return v;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => json(x, `${where}[${i}]`));
    return v as JsonValue;
  }
  if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) json(x, `${where}.${k}`);
    return v as JsonObject;
  }
  return fault(`${where} is not JSON`);
}
function jsonObject(v: unknown, where: string): JsonObject {
  return json(obj(v, where), where) as JsonObject;
}

function checkSchemaField(o: Obj, expected: string): void {
  const s = o.schema;
  if (typeof s !== 'string') fault('record has no "schema" field');
  if (!s.startsWith(SCHEMA_PREFIX)) fault(`schema "${s}" does not start with "${SCHEMA_PREFIX}"`);
  if (s !== expected) fault(`schema "${s}" is not "${expected}"`);
}

const SPLITS = ['dev', 'locked'] as const;
const SUBSETS = ['D', 'S', 'DS'] as const;
const SOURCES = ['headless', 'probe_page', 'node'] as const;

function parseModelKey(v: unknown, where: string): ModelKey {
  const o = obj(v, where);
  exactKeys(o, ['runtime', 'model_id', 'quantization', 'revision'], where);
  return {
    runtime: nonEmptyStr(o.runtime, `${where}.runtime`),
    model_id: nonEmptyStr(o.model_id, `${where}.model_id`),
    quantization: str(o.quantization, `${where}.quantization`),
    revision: nonEmptyStr(o.revision, `${where}.revision`),
  };
}

function parsePlacement(v: unknown, where: string): Placement | null {
  if (v === null) return null;
  const o = obj(v, where);
  exactKeys(o, ['method', 'cpu_nodes'], where);
  if (!Array.isArray(o.cpu_nodes)) fault(`${where}.cpu_nodes must be an array`);
  return {
    method: str(o.method, `${where}.method`),
    cpu_nodes: o.cpu_nodes.map((n, i) => {
      const e = obj(n, `${where}.cpu_nodes[${i}]`);
      exactKeys(e, ['op_type', 'count'], `${where}.cpu_nodes[${i}]`);
      return { op_type: str(e.op_type, `${where}.cpu_nodes[${i}].op_type`), count: int(e.count, `${where}.cpu_nodes[${i}].count`) };
    }),
  };
}

/** Validates a header object (also used by writers before writing). */
export function parseHeader(v: unknown): ResultsHeader {
  const o = obj(v, 'header');
  checkSchemaField(o, SCHEMA.header);
  exactKeys(o, ['schema', 'run_id', 'split', 'combination', 'model_key', 'task_subset', 'fingerprint', 'template_hashes', 'timeout_ms', 'placement'], 'header');
  const hashes = obj(o.template_hashes, 'header.template_hashes');
  const template_hashes: { [name: string]: string } = {};
  for (const [k, h] of Object.entries(hashes)) template_hashes[k] = str(h, `header.template_hashes.${k}`);
  const timeout = int(o.timeout_ms, 'header.timeout_ms');
  if (timeout < 1) fault('header.timeout_ms must be positive');
  return {
    schema: SCHEMA.header,
    run_id: nonEmptyStr(o.run_id, 'header.run_id'),
    split: oneOf(o.split, SPLITS, 'header.split'),
    combination: nonEmptyStr(o.combination, 'header.combination'),
    model_key: parseModelKey(o.model_key, 'header.model_key'),
    task_subset: oneOf(o.task_subset, SUBSETS, 'header.task_subset'),
    fingerprint: jsonObject(o.fingerprint, 'header.fingerprint'),
    template_hashes,
    timeout_ms: timeout,
    placement: parsePlacement(o.placement, 'header.placement'),
  };
}

function parseOutcome(v: unknown, where: string): Outcome {
  const o = obj(v, where);
  const kind = oneOf(o.kind, ['text', 'timeout', 'error', 'engine_fault', 'not_run'] as const, `${where}.kind`);
  switch (kind) {
    case 'text':
      exactKeys(o, ['kind', 'text'], where);
      return { kind, text: str(o.text, `${where}.text`) };
    case 'timeout':
      exactKeys(o, ['kind'], where);
      return { kind };
    case 'error':
      exactKeys(o, ['kind', 'code', 'detail', 'remote'], where);
      return { kind, code: nonEmptyStr(o.code, `${where}.code`), detail: str(o.detail, `${where}.detail`), remote: bool(o.remote, `${where}.remote`) };
    case 'engine_fault':
      exactKeys(o, ['kind', 'code', 'detail'], where);
      return { kind, code: oneOf(o.code, ['runtime_stuck'] as const, `${where}.code`), detail: str(o.detail, `${where}.detail`) };
    case 'not_run':
      exactKeys(o, ['kind', 'reason', 'detail'], where);
      return { kind, reason: oneOf(o.reason, NOT_RUN_REASONS, `${where}.reason`), detail: str(o.detail, `${where}.detail`) };
  }
}

function parseLate(v: unknown, where: string): Late | null {
  if (v === null) return null;
  const o = obj(v, where);
  const kind = oneOf(o.kind, ['late', 'none'] as const, `${where}.kind`);
  if (kind === 'late') {
    exactKeys(o, ['kind', 'text', 'latency_ms'], where);
    return { kind, text: str(o.text, `${where}.text`), latency_ms: int(o.latency_ms, `${where}.latency_ms`) };
  }
  exactKeys(o, ['kind', 'reason'], where);
  return { kind, reason: oneOf(o.reason, LATE_NONE_REASONS, `${where}.reason`) };
}

function parseUsage(v: unknown, where: string): Usage | null {
  if (v === null) return null;
  const o = obj(v, where);
  exactKeys(o, ['input_tokens', 'output_tokens', 'reasoning_tokens'], where);
  return {
    input_tokens: intOrNull(o.input_tokens, `${where}.input_tokens`),
    output_tokens: intOrNull(o.output_tokens, `${where}.output_tokens`),
    reasoning_tokens: intOrNull(o.reasoning_tokens, `${where}.reasoning_tokens`),
  };
}

/** Validates one Results record object (R12.1, R12.9, R12.10). */
export function parseResultRecord(v: unknown): ResultRecord {
  const o = obj(v, 'record');
  checkSchemaField(o, SCHEMA.result);
  exactKeys(o, ['schema', 'run_id', 'split', 'card_id', 'permutation', 'outcome', 'latency_ms', 'timeout_ms', 'requested_at', 'template_hash', 'fingerprint_id', 'usage', 'late', 'source'], 'record');
  const outcome = parseOutcome(o.outcome, 'record.outcome');
  const latency_ms = intOrNull(o.latency_ms, 'record.latency_ms');
  if (outcome.kind === 'not_run') {
    if (latency_ms !== null) fault('record.latency_ms must be null for a not_run record');
  } else if (latency_ms === null && outcome.kind !== 'engine_fault') {
    fault(`record.latency_ms must be a whole number for outcome "${outcome.kind}"`);
  }
  const late = parseLate(o.late, 'record.late');
  if (outcome.kind === 'timeout') {
    if (late === null) fault('record.late is required for a timeout (R12.10)');
  } else if (late !== null) {
    fault('record.late must be null unless the outcome is a timeout');
  }
  const timeout = int(o.timeout_ms, 'record.timeout_ms');
  if (timeout < 1) fault('record.timeout_ms must be positive');
  const requested_at = str(o.requested_at, 'record.requested_at');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(requested_at)) {
    fault('record.requested_at must be a UTC timestamp with millisecond precision');
  }
  return {
    schema: SCHEMA.result,
    run_id: nonEmptyStr(o.run_id, 'record.run_id'),
    split: oneOf(o.split, SPLITS, 'record.split'),
    card_id: nonEmptyStr(o.card_id, 'record.card_id'),
    permutation: nonEmptyStr(o.permutation, 'record.permutation'),
    outcome,
    latency_ms,
    timeout_ms: timeout,
    requested_at,
    template_hash: str(o.template_hash, 'record.template_hash'),
    fingerprint_id: nonEmptyStr(o.fingerprint_id, 'record.fingerprint_id'),
    usage: parseUsage(o.usage, 'record.usage'),
    late,
    source: oneOf(o.source, SOURCES, 'record.source'),
  };
}

/** Validates one line of a grades file. */
export function parseGradesLine(v: unknown): GradesLine {
  const o = obj(v, 'line');
  if (typeof o.schema !== 'string') fault('record has no "schema" field');
  if (!o.schema.startsWith(SCHEMA_PREFIX)) fault(`schema "${o.schema}" does not start with "${SCHEMA_PREFIX}"`);
  switch (o.schema) {
    case SCHEMA.grade:
      exactKeys(o, ['schema', 'card_id', 'permutation', 'verdict', 'grade', 'identity', 'late_grade'], 'line');
      return {
        schema: SCHEMA.grade,
        card_id: nonEmptyStr(o.card_id, 'line.card_id'),
        permutation: nonEmptyStr(o.permutation, 'line.permutation'),
        verdict: json(o.verdict, 'line.verdict'),
        grade: json(o.grade, 'line.grade'),
        identity: json(o.identity, 'line.identity'),
        late_grade: json(o.late_grade, 'line.late_grade'),
      };
    case SCHEMA.contrast:
      exactKeys(o, ['schema', 'pair_id', 'contrast'], 'line');
      return { schema: SCHEMA.contrast, pair_id: nonEmptyStr(o.pair_id, 'line.pair_id'), contrast: json(o.contrast, 'line.contrast') };
    case SCHEMA.excluded: {
      exactKeys(o, ['schema', 'excluded'], 'line');
      if (!Array.isArray(o.excluded)) fault('line.excluded must be an array');
      return {
        schema: SCHEMA.excluded,
        excluded: o.excluded.map((e, i) => {
          const x = obj(e, `line.excluded[${i}]`);
          exactKeys(x, ['id', 'reason'], `line.excluded[${i}]`);
          return { id: nonEmptyStr(x.id, `line.excluded[${i}].id`), reason: oneOf(x.reason, ['void', 'sanity'] as const, `line.excluded[${i}].reason`) };
        }),
      };
    }
    default:
      return fault(`schema "${o.schema}" is not a grades-file schema`);
  }
}

export function parseExclusionRecord(v: unknown): ExclusionRecord {
  const o = obj(v, 'record');
  checkSchemaField(o, SCHEMA.exclusion);
  exactKeys(o, ['schema', 'combination', 'model', 'check', 'value', 'limit', 'at'], 'record');
  const num = (x: unknown, where: string): number | string => {
    if (typeof x === 'string') return x;
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    return fault(`${where} must be a number or a string`);
  };
  return {
    schema: SCHEMA.exclusion,
    combination: nonEmptyStr(o.combination, 'record.combination'),
    model: nonEmptyStr(o.model, 'record.model'),
    check: oneOf(o.check, ['vram', 'download', 'params', 'unpinned', 'preflight_load', 'preflight_vram'] as const, 'record.check'),
    value: num(o.value, 'record.value'),
    limit: o.limit === null ? null : num(o.limit, 'record.limit'),
    at: nonEmptyStr(o.at, 'record.at'),
  };
}

function freeRecord<T extends JsonObject>(v: unknown, schema: string, check: (o: Obj) => void): T {
  const o = obj(v, 'record');
  checkSchemaField(o, schema);
  json(o, 'record');
  check(o);
  return o as T;
}

export function parseFailureRecord(v: unknown): FailureRecord {
  return freeRecord<FailureRecord>(v, SCHEMA.failure, (o) => {
    nonEmptyStr(o.combination, 'record.combination');
    nonEmptyStr(o.kind, 'record.kind');
  });
}
export function parseSmokeRecord(v: unknown): SmokeRecord {
  return freeRecord<SmokeRecord>(v, SCHEMA.smoke, () => {});
}
export function parsePerfRecord(v: unknown): PerfRecord {
  return freeRecord<PerfRecord>(v, SCHEMA.perf, (o) => {
    oneOf(o.run_kind, ['locked', 'dev'] as const, 'record.run_kind');
    bool(o.fresh_profile, 'record.fresh_profile');
  });
}
export function parsePreflightRecord(v: unknown): PreflightRecord {
  return freeRecord<PreflightRecord>(v, SCHEMA.preflight, (o) => {
    for (const k of ['prompt_bytes', 'event_count', 'person_count', 'new_tokens']) int(o[k], `record.${k}`);
    if (o.eos_disabled !== true) fault('record.eos_disabled must be true');
    if (o.verdict !== undefined) oneOf(o.verdict, ['pass', 'excluded', 'no_verdict'] as const, 'record.verdict');
  });
}

// ---------------------------------------------------------------- reading

function wrap<T>(file: string, line: number, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof SchemaFault) throw new ResultsFormatError(file, line, e.message);
    throw e;
  }
}

/** Reads a JSON Lines file and applies `parse` to each line; stops at the first failing line. */
export function readJsonLines<T>(file: string, parse: (v: unknown, lineNo: number) => T): T[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ResultsFormatError(file, 0, `cannot read file (${e instanceof Error ? e.message : String(e)})`);
  }
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, i) => {
    const lineNo = i + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ResultsFormatError(file, lineNo, 'line is not valid JSON');
    }
    return wrap(file, lineNo, () => parse(value, lineNo));
  });
}

export interface ResultsFile {
  header: ResultsHeader;
  records: ResultRecord[];
  /** `fp-…` ID of the header's fingerprint. */
  fingerprintId: string;
}

function checkRecordAgainstHeader(header: ResultsHeader, r: ResultRecord, fpId: string): void {
  if (r.run_id !== header.run_id) fault(`run_id "${r.run_id}" differs from the header's "${header.run_id}"`);
  if (r.split !== header.split) fault(`split "${r.split}" differs from the header's "${header.split}" (a Results file never mixes splits, R12.3)`);
  if (r.fingerprint_id !== fpId) fault('fingerprint_id does not resolve to the header fingerprint');
  if (r.timeout_ms !== header.timeout_ms) fault(`timeout_ms ${r.timeout_ms} differs from the header's ${header.timeout_ms}`);
}

/** The split directory a Results file lives in (`dev` or `locked`), or null elsewhere. */
function splitOfPath(file: string): Split | null {
  const dir = path.basename(path.dirname(file));
  return dir === 'dev' || dir === 'locked' ? dir : null;
}

/**
 * Reads and validates a Results file. Stops at the first failing record with an error that
 * names the file and line; never modifies the file (R12.7). A file in a `dev/` or `locked/`
 * directory must carry a header of that split.
 */
export function readResultsFile(file: string): ResultsFile {
  let header: ResultsHeader | undefined;
  let fpId = '';
  const records: ResultRecord[] = [];
  readJsonLines(file, (v, lineNo) => {
    if (lineNo === 1) {
      const o = obj(v, 'header');
      if (typeof o.schema !== 'string' || !o.schema.startsWith(SCHEMA_PREFIX)) {
        checkSchemaField(o, SCHEMA.header);
      }
      header = parseHeader(v);
      fpId = fingerprintId(header.fingerprint);
      const dirSplit = splitOfPath(file);
      if (dirSplit !== null && dirSplit !== header.split) {
        fault(`header split "${header.split}" does not match the "${dirSplit}" directory`);
      }
      return undefined;
    }
    const r = parseResultRecord(v);
    checkRecordAgainstHeader(header as ResultsHeader, r, fpId);
    records.push(r);
    return undefined;
  });
  if (header === undefined) throw new ResultsFormatError(file, 0, 'file is empty: the first line must be the header');
  return { header, records, fingerprintId: fpId };
}

export interface GradesFile {
  grades: GradeLine[];
  contrasts: ContrastLine[];
  excluded: ExcludedLine['excluded'];
}

/** Reads a grades file: grade lines, contrast lines, then exactly one final excluded line. */
export function readGradesFile(file: string): GradesFile {
  const lines = readJsonLines(file, (v) => parseGradesLine(v));
  const out: GradesFile = { grades: [], contrasts: [], excluded: [] };
  let seenExcluded = false;
  lines.forEach((l, i) => {
    wrap(file, i + 1, () => {
      if (seenExcluded) fault('the excluded line must be the last line');
      if (l.schema === SCHEMA.grade) out.grades.push(l);
      else if (l.schema === SCHEMA.contrast) out.contrasts.push(l);
      else {
        seenExcluded = true;
        out.excluded = l.excluded;
      }
    });
  });
  if (!seenExcluded) throw new ResultsFormatError(file, lines.length, 'grades file has no final llm-probe-excluded-v1 line');
  return out;
}

// ---------------------------------------------------------------- writing

/** Serializes one record as a canonical JSON line (newline-terminated). */
export function serializeLine(record: unknown): string {
  try {
    return `${canonicalJson(record)}\n`;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

function validated<T>(parse: (v: unknown) => T, record: unknown, what: string): T {
  try {
    return parse(record);
  } catch (e) {
    if (e instanceof SchemaFault) throw new Error(`invalid ${what}: ${e.message}`);
    throw e;
  }
}

/** `<root>/<split>/<run_id>.jsonl`; `root` is `eval/results`. */
export function resultsPath(root: string, split: Split, runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new Error(`invalid run_id "${runId}"`);
  return path.join(root, split, `${runId}.jsonl`);
}

/** `<run>.grades.jsonl` next to a Results file. */
export function gradesPathFor(resultsFile: string): string {
  return resultsFile.replace(/\.jsonl$/, '') + '.grades.jsonl';
}

/**
 * Append-only writer for one Results file. A run only ever holds the writer of its own file
 * (R12.8); `create` refuses to touch an existing file, `open` re-reads and checks it first.
 */
export class ResultsWriter {
  readonly file: string;
  readonly header: ResultsHeader;
  readonly fingerprintId: string;
  private constructor(file: string, header: ResultsHeader) {
    this.file = file;
    this.header = header;
    this.fingerprintId = fingerprintId(header.fingerprint);
  }

  /** Creates the run's file under `<root>/<split>/` and writes the header line. */
  static create(root: string, header: ResultsHeader): ResultsWriter {
    const h = validated(parseHeader, header, 'header');
    const file = resultsPath(root, h.split, h.run_id);
    if (fs.existsSync(file)) throw new Error(`${file} already exists; a run never reuses or rewrites a Results file`);
    appendTextFile(file, serializeLine(h));
    return new ResultsWriter(file, h);
  }

  /** Re-opens an existing file of this run for appending (resume); validates it first. */
  static open(file: string): ResultsWriter {
    const { header } = readResultsFile(file);
    return new ResultsWriter(file, header);
  }

  /** Appends one record after checking it against the schema and the header. */
  append(record: ResultRecord): void {
    const r = validated(parseResultRecord, record, 'Results record');
    try {
      checkRecordAgainstHeader(this.header, r, this.fingerprintId);
    } catch (e) {
      if (e instanceof SchemaFault) throw new Error(`invalid Results record: ${e.message}`);
      throw e;
    }
    appendTextFile(this.file, serializeLine(r));
  }
}

/** Writes a complete grades file (exclusive create): grades, contrasts, then the excluded line. */
export function writeGradesFile(
  file: string,
  grades: readonly GradeLine[],
  contrasts: readonly ContrastLine[],
  excluded: ExcludedLine['excluded'],
): void {
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  const lines: GradesLine[] = [...grades, ...contrasts, { schema: SCHEMA.excluded, excluded: [...excluded] }];
  const text = lines.map((l) => serializeLine(validated(parseGradesLine, l, 'grades line'))).join('');
  writeTextFile(file, text);
}

/** Appends one record to a JSON Lines file that collects one kind of record. */
function appendChecked<T>(file: string, parse: (v: unknown) => T, record: unknown, what: string): void {
  appendTextFile(file, serializeLine(validated(parse, record, what)));
}

export const appendFailure = (file: string, r: FailureRecord): void => appendChecked(file, parseFailureRecord, r, 'failure record');
export const appendExclusion = (file: string, r: ExclusionRecord): void => appendChecked(file, parseExclusionRecord, r, 'exclusion record');
/** Appends an Exclusion_Record unless one for the same Combination and check is already there. Returns whether it wrote. */
export function appendExclusionOnce(file: string, r: ExclusionRecord): boolean {
  if (fs.existsSync(file) && readJsonLines(file, (v) => parseExclusionRecord(v)).some((x) => x.combination === r.combination && x.check === r.check)) return false;
  appendExclusion(file, r);
  return true;
}
export const appendPreflightAttempt = (file: string, r: PreflightRecord): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  appendChecked(file, parsePreflightRecord, r, 'preflight attempt');
};
export const readPreflightAttempts = (file: string): PreflightRecord[] => readJsonLines(file, (v) => parsePreflightRecord(v));
export const appendSmoke = (file: string, r: SmokeRecord): void => appendChecked(file, parseSmokeRecord, r, 'smoke record');

/** Writes a one-object JSON file (perf, preflight), refusing to replace an existing file. */
function writeSingle<T>(file: string, parse: (v: unknown) => T, record: unknown, what: string, overwrite: boolean): void {
  if (!overwrite && fs.existsSync(file)) throw new Error(`${file} already exists`);
  writeTextFile(file, serializeLine(validated(parse, record, what)));
}
export const writePerf = (file: string, r: PerfRecord, overwrite = false): void => writeSingle(file, parsePerfRecord, r, 'perf record', overwrite);
export const writePreflight = (file: string, r: PreflightRecord, overwrite = false): void =>
  writeSingle(file, parsePreflightRecord, r, 'preflight record', overwrite);

export const readFailures = (file: string): FailureRecord[] => readJsonLines(file, (v) => parseFailureRecord(v));
export const readExclusions = (file: string): ExclusionRecord[] => readJsonLines(file, (v) => parseExclusionRecord(v));
export const readSmoke = (file: string): SmokeRecord[] => readJsonLines(file, (v) => parseSmokeRecord(v));
export const readPerf = (file: string): PerfRecord => {
  const [r] = readJsonLines(file, (v) => parsePerfRecord(v));
  if (r === undefined) throw new ResultsFormatError(file, 0, 'file is empty');
  return r;
};
export const readPreflight = (file: string): PreflightRecord => {
  const [r] = readJsonLines(file, (v) => parsePreflightRecord(v));
  if (r === undefined) throw new ResultsFormatError(file, 0, 'file is empty');
  return r;
};
