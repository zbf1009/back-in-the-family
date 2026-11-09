// Locked_Run_Ledger (`eval/results/ledger.jsonl`, R3.3-R3.10, R18.5): append-only events,
// status derived from the events, the once-only overlap rule, resume planning and checks, and
// the entry the Report uses. The top half is pure (the property test drives it); the bottom
// half does the I/O. All writes go through sink.ts.
import * as fs from 'node:fs';
import { appendTextFile, appendTextFileDurable } from './sink.ts';
import type { TaskType } from './cards.ts';
import {
  canonicalJson,
  fingerprintId,
  readJsonLines,
  ResultsFormatError,
  serializeLine,
  type JsonObject,
  type JsonValue,
  type ModelKey,
  type ResultRecord,
  type TaskSubset,
} from './results.ts';

export const LEDGER_SCHEMA = 'llm-probe-ledger-v1';

// ---------------------------------------------------------------- types

export type Planned = { decision?: number; synthesis?: number };

export interface LedgerStart {
  schema: typeof LEDGER_SCHEMA;
  event: 'start';
  entry_id: string;
  model_key: ModelKey;
  combination: string;
  task_subset: TaskSubset;
  fingerprint: JsonObject;
  template_hashes: { [name: string]: string };
  started_at: string;
  rerun_of: string | null;
  rerun_reason: string | null;
  overlaps: string[];
  approval: string | null;
  planned: Planned;
}
export interface LedgerAbort {
  schema: typeof LEDGER_SCHEMA;
  event: 'abort';
  entry_id: string;
  at: string;
  reason: string;
}
export interface LedgerResume {
  schema: typeof LEDGER_SCHEMA;
  event: 'resume';
  entry_id: string;
  at: string;
}
export interface LedgerComplete {
  schema: typeof LEDGER_SCHEMA;
  event: 'complete';
  entry_id: string;
  ended_at: string;
  results: string;
  requests_sent: number;
}
export type LedgerEvent = LedgerStart | LedgerAbort | LedgerResume | LedgerComplete;

export type EntryStatus = 'complete' | 'incomplete';

/** An entry as derived from its events. */
export interface LedgerEntry {
  entry_id: string;
  start: LedgerStart;
  status: EntryStatus;
  /** Reason of an `abort` that no later `resume` has followed; null otherwise. */
  abort_reason: string | null;
  resumes: number;
  complete: LedgerComplete | null;
  /** Position of the `start` line in the ledger (tie-break for equal start times). */
  order: number;
}

/** One planned request: a Card × Permutation of a given Task_Type. */
export interface PlannedRun {
  card_id: string;
  permutation: string;
  task: TaskType;
}

export type LedgerErrorKind =
  | 'overlap'
  | 'resume_mismatch'
  | 'duplicate_id'
  | 'unknown_entry'
  | 'bad_state'
  | 'incomplete_run'
  | 'bad_event';

/** A refused ledger operation. The ledger and Results are left unchanged. */
export class LedgerError extends Error {
  readonly kind: LedgerErrorKind;
  /** Entry IDs the message names (the overlapping entries for `overlap`). */
  readonly entryIds: string[];
  constructor(kind: LedgerErrorKind, message: string, entryIds: string[] = []) {
    super(message);
    this.name = 'LedgerError';
    this.kind = kind;
    this.entryIds = entryIds;
  }
}

/** The event sequence is inconsistent; `index` is the 0-based position of the offending event. */
export class LedgerSequenceError extends Error {
  readonly index: number;
  constructor(index: number, message: string) {
    super(message);
    this.name = 'LedgerSequenceError';
    this.index = index;
  }
}

// ---------------------------------------------------------------- pure helpers

export function subsetTaskTypes(subset: TaskSubset): TaskType[] {
  return subset === 'D' ? ['decision'] : subset === 'S' ? ['synthesis'] : ['decision', 'synthesis'];
}

export function subsetsOverlap(a: TaskSubset, b: TaskSubset): boolean {
  const bs = subsetTaskTypes(b);
  return subsetTaskTypes(a).some((t) => bs.includes(t));
}

/** Model_Key identity: all four fields (R3.6). Stable string form, usable as a map key. */
export function modelKeyString(k: ModelKey): string {
  return canonicalJson([k.runtime, k.model_id, k.quantization, k.revision]);
}

export function modelKeysEqual(a: ModelKey, b: ModelKey): boolean {
  return modelKeyString(a) === modelKeyString(b);
}

function startTime(e: LedgerEntry): number {
  return Date.parse(e.start.started_at);
}

/** Orders entries by start time, then by ledger position. */
function byStart(a: LedgerEntry, b: LedgerEntry): number {
  return startTime(a) - startTime(b) || a.order - b.order;
}

/** `non-empty after trim` (R3.6). */
export function isValidRerunReason(reason: string | null | undefined): reason is string {
  return typeof reason === 'string' && reason.trim() !== '';
}

/** `L-<UTC stamp>-<slug>` entry ID from a start time and a label (for example the Combination). */
export function makeEntryId(startedAt: string, label: string): string {
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\.\d+/, '');
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `L-${stamp}${slug === '' ? '' : `-${slug}`}`;
}

/**
 * Folds events (in file order) into derived entries. Throws LedgerSequenceError when an event
 * names an unknown entry, an entry starts twice, or an event follows `complete` (R3.7).
 */
export function deriveEntries(events: readonly LedgerEvent[]): LedgerEntry[] {
  const entries = new Map<string, LedgerEntry>();
  events.forEach((ev, index) => {
    if (ev.event === 'start') {
      if (entries.has(ev.entry_id)) throw new LedgerSequenceError(index, `entry "${ev.entry_id}" starts twice`);
      for (const id of ev.overlaps) {
        if (!entries.has(id)) throw new LedgerSequenceError(index, `overlaps names "${id}", which has no earlier start`);
      }
      entries.set(ev.entry_id, { entry_id: ev.entry_id, start: ev, status: 'incomplete', abort_reason: null, resumes: 0, complete: null, order: index });
      return;
    }
    const entry = entries.get(ev.entry_id);
    if (entry === undefined) throw new LedgerSequenceError(index, `${ev.event} names unknown entry "${ev.entry_id}"`);
    if (entry.status === 'complete') throw new LedgerSequenceError(index, `${ev.event} follows complete for entry "${ev.entry_id}"`);
    if (ev.event === 'abort') entry.abort_reason = ev.reason;
    else if (ev.event === 'resume') {
      entry.abort_reason = null;
      entry.resumes += 1;
    } else {
      entry.status = 'complete';
      entry.abort_reason = null;
      entry.complete = ev;
    }
  });
  return [...entries.values()];
}

export type OverlapDecision =
  | { kind: 'new'; rerun_of: null; rerun_reason: null; overlaps: [] }
  | { kind: 'rerun'; rerun_of: string; rerun_reason: string; overlaps: string[] }
  | { kind: 'refused'; overlaps: string[]; resumable: string[]; message: string };

/**
 * The once-only rule (R3.6, R3.7, R18.5). `O` is every entry, complete or incomplete, with the
 * same Model_Key and a Task_Type_Subset sharing a Task_Type with the request. Template hashes,
 * sampling parameters and the Combination ID play no part.
 */
export function overlapSet(entries: readonly LedgerEntry[], modelKey: ModelKey, subset: TaskSubset): LedgerEntry[] {
  return entries.filter((e) => modelKeysEqual(e.start.model_key, modelKey) && subsetsOverlap(e.start.task_subset, subset)).sort((a, b) => a.order - b.order);
}

export function decideOverlap(entries: readonly LedgerEntry[], modelKey: ModelKey, subset: TaskSubset, rerunReason: string | null | undefined): OverlapDecision {
  const o = overlapSet(entries, modelKey, subset);
  if (o.length === 0) return { kind: 'new', rerun_of: null, rerun_reason: null, overlaps: [] };
  const ids = o.map((e) => e.entry_id);
  if (isValidRerunReason(rerunReason)) {
    const latest = [...o].sort(byStart)[o.length - 1] as LedgerEntry;
    return { kind: 'rerun', rerun_of: latest.entry_id, rerun_reason: rerunReason, overlaps: ids };
  }
  const resumable = o.filter((e) => e.status === 'incomplete').map((e) => e.entry_id);
  const hints = resumable.map((id) => `--resume ${id}`).join(', ');
  const message =
    `a Locked_Run of this Model_Key and Task_Type_Subset already has ledger entr${ids.length === 1 ? 'y' : 'ies'} ${ids.join(', ')}; ` +
    `to run it again pass --rerun-reason with a non-empty reason` +
    (hints === '' ? '' : `; to continue an incomplete entry use ${hints}`);
  return { kind: 'refused', overlaps: ids, resumable, message };
}

const missingOutcome = (r: ResultRecord): boolean => r.outcome.kind === 'not_run' || r.outcome.kind === 'engine_fault';

/**
 * The planned runs that still need a request: those without an output record. `not_run` and
 * `engine_fault` records do not count as output (R3.9, R3.5). Records outside the plan are ignored.
 */
export function missingRuns(planned: readonly PlannedRun[], records: readonly ResultRecord[]): PlannedRun[] {
  const have = new Set<string>();
  for (const r of records) if (!missingOutcome(r)) have.add(canonicalJson([r.card_id, r.permutation]));
  return planned.filter((p) => !have.has(canonicalJson([p.card_id, p.permutation])));
}

/** Resume plan: exactly the Card × Permutations without an output record, in plan order. */
export const planResume = missingRuns;

/** `complete` may be appended only when nothing is missing (R3.5). */
export function canComplete(planned: readonly PlannedRun[], records: readonly ResultRecord[]): { ok: boolean; missing: PlannedRun[] } {
  const missing = missingRuns(planned, records);
  return { ok: missing.length === 0, missing };
}

/** The part of a run that a resume must find unchanged (R3.10). */
export interface ResumeIdentity {
  model_key: ModelKey;
  fingerprint: JsonObject;
  template_hashes: { [name: string]: string };
}

export interface ResumeMismatch {
  field: 'model_key' | 'fingerprint_id' | 'template_hashes';
  recorded: string;
  current: string;
}

/** Empty when the resume is allowed. Compares Model_Key, fingerprint ID and every Template_Hash. */
export function checkResume(entry: LedgerEntry, current: ResumeIdentity): ResumeMismatch[] {
  const out: ResumeMismatch[] = [];
  if (!modelKeysEqual(entry.start.model_key, current.model_key)) {
    out.push({ field: 'model_key', recorded: modelKeyString(entry.start.model_key), current: modelKeyString(current.model_key) });
  }
  const recFp = fingerprintId(entry.start.fingerprint);
  const curFp = fingerprintId(current.fingerprint);
  if (recFp !== curFp) out.push({ field: 'fingerprint_id', recorded: recFp, current: curFp });
  const recH = canonicalJson(entry.start.template_hashes);
  const curH = canonicalJson(current.template_hashes);
  if (recH !== curH) out.push({ field: 'template_hashes', recorded: recH, current: curH });
  return out;
}

export function resumeMismatchMessage(entryId: string, mismatches: readonly ResumeMismatch[]): string {
  const what = mismatches.map((m) => `${m.field} (recorded ${m.recorded}, current ${m.current})`).join('; ');
  return (
    `cannot resume ${entryId}: ${what}. A changed Template_Hash or sampling parameter for the same Model_Key ` +
    'needs a re-run with --rerun-reason, not a resume'
  );
}

export interface ReportEntryChoice {
  model_key: ModelKey;
  task: TaskType;
  /** The `complete` entry with the earliest `started_at` covering `task`; null when none. */
  used: string | null;
  /** Every other overlapping entry, in start order, with why it is not used. */
  others: { entry_id: string; label: 'rerun, not used' | 'incomplete' }[];
}

/**
 * Per Model_Key and Task_Type, the entry the Report uses (R3.8): the earliest-started `complete`
 * entry whose subset contains the Task_Type. Sorted by Model_Key string, then `decision` first.
 */
export function chooseReportEntries(entries: readonly LedgerEntry[]): ReportEntryChoice[] {
  const groups = new Map<string, { key: ModelKey; task: TaskType; list: LedgerEntry[] }>();
  for (const e of entries) {
    for (const task of subsetTaskTypes(e.start.task_subset)) {
      const id = canonicalJson([modelKeyString(e.start.model_key), task]);
      const g = groups.get(id) ?? { key: e.start.model_key, task, list: [] };
      g.list.push(e);
      groups.set(id, g);
    }
  }
  const out: ReportEntryChoice[] = [];
  for (const g of groups.values()) {
    const list = [...g.list].sort(byStart);
    const used = list.find((e) => e.status === 'complete') ?? null;
    out.push({
      model_key: g.key,
      task: g.task,
      used: used === null ? null : used.entry_id,
      others: list.filter((e) => e !== used).map((e) => ({ entry_id: e.entry_id, label: e.status === 'complete' ? 'rerun, not used' : 'incomplete' })),
    });
  }
  return out.sort((a, b) => {
    const ka = modelKeyString(a.model_key);
    const kb = modelKeyString(b.model_key);
    return ka < kb ? -1 : ka > kb ? 1 : a.task === b.task ? 0 : a.task === 'decision' ? -1 : 1;
  });
}

// ---------------------------------------------------------------- strict parsing

class Bad extends Error {}
const bad = (m: string): never => {
  throw new Bad(m);
};
type Obj = Record<string, unknown>;

function asObj(v: unknown, w: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(`${w} must be an object`);
  return v as Obj;
}
function keys(o: Obj, allowed: readonly string[], w: string): void {
  for (const k of allowed) if (!(k in o)) bad(`${w} is missing field "${k}"`);
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${w} has unknown field "${k}"`);
}
function nes(v: unknown, w: string): string {
  if (typeof v !== 'string' || v === '') bad(`${w} must be a non-empty string`);
  return v as string;
}
function nesOrNull(v: unknown, w: string): string | null {
  return v === null ? null : nes(v, w);
}
function time(v: unknown, w: string): string {
  const s = nes(v, w);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) || Number.isNaN(Date.parse(s))) bad(`${w} must be a UTC timestamp`);
  return s;
}
function nat(v: unknown, w: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) bad(`${w} must be a non-negative integer`);
  return v as number;
}
function jsonVal(v: unknown, w: string): JsonValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : bad(`${w} must be finite`);
  if (Array.isArray(v)) return v.map((x, i) => jsonVal(x, `${w}[${i}]`));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonVal(x, `${w}.${k}`)]));
  return bad(`${w} is not JSON`);
}

function parseKey(v: unknown): ModelKey {
  const o = asObj(v, 'model_key');
  keys(o, ['runtime', 'model_id', 'quantization', 'revision'], 'model_key');
  if (typeof o.quantization !== 'string') bad('model_key.quantization must be a string');
  return { runtime: nes(o.runtime, 'model_key.runtime'), model_id: nes(o.model_id, 'model_key.model_id'), quantization: o.quantization as string, revision: nes(o.revision, 'model_key.revision') };
}

function parsePlanned(v: unknown, subset: TaskSubset): Planned {
  const o = asObj(v, 'planned');
  const want = subsetTaskTypes(subset);
  keys(o, want, 'planned');
  const out: Planned = {};
  for (const t of want) out[t] = nat(o[t], `planned.${t}`);
  return out;
}

/** Validates one ledger line. Strict: unknown events, unknown fields and bad shapes throw. */
export function parseLedgerEvent(v: unknown): LedgerEvent {
  try {
    const o = asObj(v, 'event');
    if (o.schema !== LEDGER_SCHEMA) bad(`schema must be "${LEDGER_SCHEMA}"`);
    switch (o.event) {
      case 'start': {
        keys(o, ['schema', 'event', 'entry_id', 'model_key', 'combination', 'task_subset', 'fingerprint', 'template_hashes', 'started_at', 'rerun_of', 'rerun_reason', 'overlaps', 'approval', 'planned'], 'start');
        if (o.task_subset !== 'D' && o.task_subset !== 'S' && o.task_subset !== 'DS') bad('start.task_subset must be D, S or DS');
        const subset = o.task_subset as TaskSubset;
        const hashesObj = asObj(o.template_hashes, 'start.template_hashes');
        // Own properties only (a `__proto__` key must survive; `map[k] = v` would drop it).
        const template_hashes: { [name: string]: string } = Object.fromEntries(Object.entries(hashesObj).map(([k, h]) => [k, nes(h, `start.template_hashes.${k}`)]));
        if (!Array.isArray(o.overlaps)) bad('start.overlaps must be an array');
        const overlaps = (o.overlaps as unknown[]).map((x, i) => nes(x, `start.overlaps[${i}]`));
        const rerun_of = nesOrNull(o.rerun_of, 'start.rerun_of');
        const rerun_reason = nesOrNull(o.rerun_reason, 'start.rerun_reason');
        if (rerun_reason !== null && !isValidRerunReason(rerun_reason)) bad('start.rerun_reason must not be whitespace only');
        if ((rerun_of === null) !== (rerun_reason === null) || (rerun_of === null) !== (overlaps.length === 0)) {
          bad('start.rerun_of, rerun_reason and overlaps must be set together (a re-run) or all empty');
        }
        if (rerun_of !== null && !overlaps.includes(rerun_of)) bad('start.rerun_of must be one of overlaps');
        return {
          schema: LEDGER_SCHEMA,
          event: 'start',
          entry_id: nes(o.entry_id, 'start.entry_id'),
          model_key: parseKey(o.model_key),
          combination: nes(o.combination, 'start.combination'),
          task_subset: subset,
          fingerprint: jsonVal(asObj(o.fingerprint, 'start.fingerprint'), 'start.fingerprint') as JsonObject,
          template_hashes,
          started_at: time(o.started_at, 'start.started_at'),
          rerun_of,
          rerun_reason,
          overlaps,
          approval: nesOrNull(o.approval, 'start.approval'),
          planned: parsePlanned(o.planned, subset),
        };
      }
      case 'abort':
        keys(o, ['schema', 'event', 'entry_id', 'at', 'reason'], 'abort');
        return { schema: LEDGER_SCHEMA, event: 'abort', entry_id: nes(o.entry_id, 'abort.entry_id'), at: time(o.at, 'abort.at'), reason: nes(o.reason, 'abort.reason') };
      case 'resume':
        keys(o, ['schema', 'event', 'entry_id', 'at'], 'resume');
        return { schema: LEDGER_SCHEMA, event: 'resume', entry_id: nes(o.entry_id, 'resume.entry_id'), at: time(o.at, 'resume.at') };
      case 'complete':
        keys(o, ['schema', 'event', 'entry_id', 'ended_at', 'results', 'requests_sent'], 'complete');
        return {
          schema: LEDGER_SCHEMA,
          event: 'complete',
          entry_id: nes(o.entry_id, 'complete.entry_id'),
          ended_at: time(o.ended_at, 'complete.ended_at'),
          results: nes(o.results, 'complete.results'),
          requests_sent: nat(o.requests_sent, 'complete.requests_sent'),
        };
      default:
        return bad(`unknown event ${JSON.stringify(o.event)}`);
    }
  } catch (e) {
    if (e instanceof Bad) throw new LedgerError('bad_event', `invalid ledger event: ${e.message}`);
    throw e;
  }
}

// ---------------------------------------------------------------- I/O

export interface Ledger {
  events: LedgerEvent[];
  entries: LedgerEntry[];
}

/**
 * Reads the ledger strictly. A missing file is an empty ledger. An unknown event, a bad shape or
 * an inconsistent sequence throws ResultsFormatError naming file and line; the file is never touched.
 */
export function readLedger(file: string): Ledger {
  if (!fs.existsSync(file)) return { events: [], entries: [] };
  const events = readJsonLines(file, (v, lineNo) => {
    try {
      return parseLedgerEvent(v);
    } catch (e) {
      if (e instanceof LedgerError) throw new ResultsFormatError(file, lineNo, e.message);
      throw e;
    }
  });
  try {
    return { events, entries: deriveEntries(events) };
  } catch (e) {
    if (e instanceof LedgerSequenceError) throw new ResultsFormatError(file, e.index + 1, e.message);
    throw e;
  }
}

export interface StartRequest {
  entry_id: string;
  model_key: ModelKey;
  combination: string;
  task_subset: TaskSubset;
  fingerprint: JsonObject;
  template_hashes: { [name: string]: string };
  started_at: string;
  approval: string | null;
  planned: Planned;
  /** `--rerun-reason`; only used when the once-only rule finds overlapping entries. */
  rerun_reason?: string | null;
}

/**
 * Applies the once-only rule, then appends the `start` line and `fsync`s it (R3.3). Throws
 * LedgerError('overlap') naming the entry IDs when refused; throws any I/O failure as it is, so
 * the caller can exit non-zero before sending a request (R3.4). On any throw nothing was appended
 * unless the failure happened inside the append itself.
 */
export function appendStart(file: string, req: StartRequest): LedgerStart {
  const { entries } = readLedger(file);
  if (entries.some((e) => e.entry_id === req.entry_id)) throw new LedgerError('duplicate_id', `ledger entry "${req.entry_id}" already exists`, [req.entry_id]);
  const decision = decideOverlap(entries, req.model_key, req.task_subset, req.rerun_reason);
  if (decision.kind === 'refused') throw new LedgerError('overlap', decision.message, decision.overlaps);
  const start: LedgerStart = parseLedgerEvent({
    schema: LEDGER_SCHEMA,
    event: 'start',
    entry_id: req.entry_id,
    model_key: req.model_key,
    combination: req.combination,
    task_subset: req.task_subset,
    fingerprint: req.fingerprint,
    template_hashes: req.template_hashes,
    started_at: req.started_at,
    rerun_of: decision.rerun_of,
    rerun_reason: decision.rerun_reason,
    overlaps: decision.overlaps,
    approval: req.approval,
    planned: req.planned,
  }) as LedgerStart;
  appendTextFileDurable(file, serializeLine(start));
  return start;
}

function requireIncomplete(entries: readonly LedgerEntry[], id: string): LedgerEntry {
  const e = entries.find((x) => x.entry_id === id);
  if (e === undefined) throw new LedgerError('unknown_entry', `no ledger entry "${id}"`, [id]);
  if (e.status === 'complete') throw new LedgerError('bad_state', `ledger entry "${id}" is already complete`, [id]);
  return e;
}

/** Records that a run stopped early (budget, load failure, out of memory); the entry stays incomplete. */
export function appendAbort(file: string, entryId: string, at: string, reason: string): LedgerAbort {
  requireIncomplete(readLedger(file).entries, entryId);
  const ev = parseLedgerEvent({ schema: LEDGER_SCHEMA, event: 'abort', entry_id: entryId, at, reason }) as LedgerAbort;
  appendTextFile(file, serializeLine(ev));
  return ev;
}

/**
 * `locked-run --resume <id>`: runs the resume check (R3.10) and appends `resume`. Not a re-run;
 * needs no reason. On a mismatch throws LedgerError('resume_mismatch') and appends nothing.
 */
export function appendResume(file: string, entryId: string, at: string, current: ResumeIdentity): LedgerResume {
  const entry = requireIncomplete(readLedger(file).entries, entryId);
  const mismatches = checkResume(entry, current);
  if (mismatches.length > 0) throw new LedgerError('resume_mismatch', resumeMismatchMessage(entryId, mismatches), [entryId]);
  const ev = parseLedgerEvent({ schema: LEDGER_SCHEMA, event: 'resume', entry_id: entryId, at }) as LedgerResume;
  appendTextFile(file, serializeLine(ev));
  return ev;
}

/**
 * Appends `complete` only when every planned Card × Permutation has an output record (R3.5) and
 * the plan matches the entry's `planned` counts; otherwise throws LedgerError('incomplete_run').
 */
export function appendComplete(
  file: string,
  entryId: string,
  fields: { ended_at: string; results: string; requests_sent: number },
  plan: readonly PlannedRun[],
  records: readonly ResultRecord[],
): LedgerComplete {
  const entry = requireIncomplete(readLedger(file).entries, entryId);
  for (const t of subsetTaskTypes(entry.start.task_subset)) {
    const n = plan.filter((p) => p.task === t).length;
    if (n !== entry.start.planned[t]) throw new LedgerError('incomplete_run', `plan has ${n} ${t} runs but ledger entry ${entryId} planned ${entry.start.planned[t]}`, [entryId]);
  }
  if (plan.some((p) => !subsetTaskTypes(entry.start.task_subset).includes(p.task))) {
    throw new LedgerError('incomplete_run', `plan holds a Task_Type outside subset ${entry.start.task_subset} of ${entryId}`, [entryId]);
  }
  const { ok, missing } = canComplete(plan, records);
  if (!ok) {
    const sample = missing.slice(0, 3).map((m) => `${m.card_id}/${m.permutation}`).join(', ');
    throw new LedgerError('incomplete_run', `cannot complete ${entryId}: ${missing.length} planned run(s) have no output record (for example ${sample})`, [entryId]);
  }
  const ev = parseLedgerEvent({ schema: LEDGER_SCHEMA, event: 'complete', entry_id: entryId, ...fields }) as LedgerComplete;
  appendTextFile(file, serializeLine(ev));
  return ev;
}
