// External_Reference_File and its ingest (llm-probe task 31.1; R19.15, R19.16, R3.1, RC-13; design DA-22).
//
// An External_Reference is a measurement run elsewhere (for example a teacher model's locked upper bound) with its
// own frozen configuration and ledger. It is handed over as one JSON file plus the files it names, all in the same
// directory. This module checks the whole hand-over, re-grades raw outputs through Sim_Wasm when they are supplied,
// and writes the checked copy under `eval/results/external/<label>/`. Nothing else.
//
// Isolation (R19.16, Property 46): this is the only module that reads or writes `eval/results/external/`, and only
// `external-command.ts` imports it (the CLI reaches it through that file). The phase gate, the ledger, the budget,
// the Metrics, the analysis, the marks, the recommendations and the Report builder do not import it: the Report gets
// the stored records as plain data (`ReportInput.external`). tests/unit/external-isolation.test.ts checks the graph.
//
// The ingest sends no request to any Runtime and reads no `env`: this file imports no adapter, no budget and no
// `env.ts`. It reads `locked.jsonl` for grading only (R3.1, RC-13): it calls `llm_validate`, `llm_grade`,
// `llm_identity` and `llm_contrast` through run-grading.ts and never `llm_render_prompt`. The messages it builds name
// field names, line numbers, hashes, Card IDs, `pair_id`s and scenario group IDs, and no other Card content.
//
// Order of checks. The first failure stops the ingest and names its field (`<field>: <reason>`); nothing is written:
//   0. Manifest_Check (the caller runs it first, R1.1)
//   1. schema identifier and the type of every member, in the order of the file format below
//   2. `pinned_manifest_hash` equals the constant of R1.4
//   3. each named path, in the order config, ledger, results, raw_outputs (relative, no `..`, inside the directory,
//      an existing regular file; the copy keeps the base name, so two members may not share one)
//   4. each given sha256 equals the sha256 of the file it names, same order
//   5. the format of each named file: ledger and results lines are JSON objects; raw-output lines have exactly
//      `card_id`, `permutation`, `raw`, and no (Card ID, permutation) repeats. `config` is a frozen configuration of
//      any format; only its hash is checked
//   6. raw outputs: every Card ID is a Locked_Card of the Task_Type, and grading through Sim_Wasm succeeds
//   7. `label`: nothing is stored under that label yet (a stored External_Reference is never replaced)
//
// Field names printed: schema, label, reference_model, task_type, pinned_manifest_hash, config.file, config.sha256,
// ledger.file, ledger.sha256, results.file, results.sha256, raw_outputs.file, raw_outputs.sha256,
// raw_outputs.answer_mode, figures.<name>, ledger.content, results.content, raw_outputs.content, and `file` for the
// reference file itself (unreadable, not JSON).
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { loadCards, type LoadedCard, type TaskType } from './cards.ts';
import { computeMetrics, metricCardFromLoaded } from './metrics.ts';
import { canonicalJson, SCHEMA, type ResultRecord } from './results.ts';
import { GradingError, gradeRecords } from './run-grading.ts';
import { copyFileUnchanged, writeTextFile } from './sink.ts';
import type { ValidateMode } from './simwasm.ts';

export const EXTERNAL_FILE_SCHEMA = 'llm-probe-external-reference-v1';
export const EXTERNAL_RECORD_SCHEMA = 'llm-probe-external-v1';

/** The Metric figure names (numerators and denominators, integers only); the same on the supplied side and the re-graded side. */
export const FIGURE_NAMES = ['acceptable', 'scored_cards', 'severe', 'illegal', 'flip_perms', 'flips', 'consistent_pairs', 'pairs'] as const;
export type FigureName = (typeof FIGURE_NAMES)[number];
export type Figures = { readonly [K in FigureName]: number };

export interface NamedFile {
  readonly file: string;
  readonly sha256: string;
}
export interface RawOutputsRef extends NamedFile {
  readonly answer_mode: 'json' | 'raw_choice';
}

export interface ExternalReferenceFile {
  readonly schema: typeof EXTERNAL_FILE_SCHEMA;
  readonly label: string;
  readonly reference_model: string;
  readonly task_type: 'D' | 'S';
  readonly pinned_manifest_hash: string;
  readonly config: NamedFile;
  readonly ledger: NamedFile;
  readonly results: NamedFile;
  readonly raw_outputs: RawOutputsRef | null;
  readonly figures: Figures;
}

/** The stored `record.json` of an ingested External_Reference. */
export interface ExternalRecord {
  readonly schema: typeof EXTERNAL_RECORD_SCHEMA;
  readonly label: string;
  readonly reference_model: string;
  readonly task_type: 'D' | 'S';
  readonly pinned_manifest_hash: string;
  /** sha256 of the reference file as handed over (stored as `reference.json`). */
  readonly reference_sha256: string;
  readonly config: NamedFile;
  readonly ledger: NamedFile;
  readonly results: NamedFile;
  readonly raw_outputs: RawOutputsRef | null;
  readonly supplied: Figures;
  /** `null` when no raw outputs were supplied. */
  readonly regrade: 'match' | 'mismatch' | null;
  readonly regrade_figures: Figures | null;
  /** Figure names where the re-grade differs from the supplied figures, in `FIGURE_NAMES` order; empty unless `mismatch`. */
  readonly differing: readonly FigureName[];
  /** Number of raw-output lines that were re-graded; `null` without raw outputs. */
  readonly raw_output_count: number | null;
}

/** The reference is rejected: `field` is the first failing field, `reason` says why. */
export class ExternalReferenceError extends Error {
  readonly field: string;
  readonly reason: string;
  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.name = 'ExternalReferenceError';
    this.field = field;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------- step 1: members and types

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const shown = (v: string): string => JSON.stringify(v.length > 80 ? `${v.slice(0, 77)}...` : v);

function fail(field: string, reason: string): never {
  throw new ExternalReferenceError(field, reason);
}

function member(o: Obj, key: string, where: string): unknown {
  if (!Object.hasOwn(o, key)) fail(where === '' ? key : `${where}.${key}`, 'is missing');
  return o[key];
}

function exactMembers(o: Obj, keys: readonly string[], where: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(where === '' ? k : `${where}.${k}`, 'is not a member of the format');
}

function stringMember(o: Obj, key: string, where: string): string {
  const v = member(o, key, where);
  const name = where === '' ? key : `${where}.${key}`;
  if (typeof v !== 'string') return fail(name, 'must be a string');
  if (v === '') return fail(name, 'must not be empty');
  return v;
}

function namedFile(o: Obj, key: 'config' | 'ledger' | 'results'): NamedFile {
  const v = member(o, key, '');
  if (!isObj(v)) return fail(key, 'must be an object with "file" and "sha256"');
  const file = stringMember(v, 'file', key);
  const sha256 = stringMember(v, 'sha256', key);
  if (!HEX64.test(sha256)) fail(`${key}.sha256`, 'must be 64 lowercase hex digits');
  exactMembers(v, ['file', 'sha256'], key);
  return { file, sha256 };
}

function rawOutputsRef(o: Obj, task: 'D' | 'S'): RawOutputsRef | null {
  const v = member(o, 'raw_outputs', '');
  if (v === null) return null;
  if (!isObj(v)) return fail('raw_outputs', 'must be null or an object with "file", "sha256" and "answer_mode"');
  const file = stringMember(v, 'file', 'raw_outputs');
  const sha256 = stringMember(v, 'sha256', 'raw_outputs');
  if (!HEX64.test(sha256)) fail('raw_outputs.sha256', 'must be 64 lowercase hex digits');
  const mode = member(v, 'answer_mode', 'raw_outputs');
  if (mode !== 'json' && mode !== 'raw_choice') fail('raw_outputs.answer_mode', 'must be "json" or "raw_choice"');
  if (mode === 'raw_choice' && task !== 'D') fail('raw_outputs.answer_mode', 'raw_choice applies to Task_Type D only');
  exactMembers(v, ['file', 'sha256', 'answer_mode'], 'raw_outputs');
  return { file, sha256, answer_mode: mode };
}

function figuresOf(o: Obj): Figures {
  const v = member(o, 'figures', '');
  if (!isObj(v)) return fail('figures', 'must be an object of integers');
  const out: Record<string, number> = {};
  for (const name of FIGURE_NAMES) {
    const x = member(v, name, 'figures');
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) fail(`figures.${name}`, 'must be a non-negative whole number');
    out[name] = x;
  }
  exactMembers(v, FIGURE_NAMES, 'figures');
  return out as Figures;
}

/** Step 1: the schema identifier and the type of every member, in the order of the format. */
export function parseReferenceFile(value: unknown): ExternalReferenceFile {
  if (!isObj(value)) return fail('file', 'must be a JSON object');
  const schema = member(value, 'schema', '');
  if (schema !== EXTERNAL_FILE_SCHEMA) fail('schema', `must be "${EXTERNAL_FILE_SCHEMA}"`);
  const label = stringMember(value, 'label', '');
  if (!LABEL.test(label)) fail('label', 'must be 1 to 64 characters: lowercase letters, digits, ".", "_", "-", starting with a letter or digit');
  const reference_model = stringMember(value, 'reference_model', '');
  const task = member(value, 'task_type', '');
  if (task !== 'D' && task !== 'S') fail('task_type', 'must be "D" or "S"');
  const pinned = stringMember(value, 'pinned_manifest_hash', '');
  if (!HEX64.test(pinned)) fail('pinned_manifest_hash', 'must be 64 lowercase hex digits');
  const config = namedFile(value, 'config');
  const ledger = namedFile(value, 'ledger');
  const results = namedFile(value, 'results');
  const raw_outputs = rawOutputsRef(value, task);
  const figures = figuresOf(value);
  exactMembers(value, ['schema', 'label', 'reference_model', 'task_type', 'pinned_manifest_hash', 'config', 'ledger', 'results', 'raw_outputs', 'figures'], '');
  return { schema: EXTERNAL_FILE_SCHEMA, label, reference_model, task_type: task, pinned_manifest_hash: pinned, config, ledger, results, raw_outputs, figures };
}

// ---------------------------------------------------------------- steps 3 to 5: named files

const RESERVED_NAMES: readonly string[] = ['reference.json', 'record.json'];
const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Why a named path is refused, or null. Looks at the text first, so an absolute or escaping name fails before any file is read. */
function pathFault(dir: string, rel: string): string | null {
  if (rel.includes('\0')) return 'must not contain a NUL character';
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel) || path.isAbsolute(rel) || path.win32.isAbsolute(rel)) return 'must be a relative path, not absolute or with a drive';
  if (rel.split(/[\\/]/).includes('..')) return 'must not contain ".."';
  const inside = (root: string, p: string): boolean => {
    const r = path.relative(root, p);
    return r !== '' && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r);
  };
  const abs = path.resolve(dir, rel);
  if (!inside(dir, abs)) return 'must stay inside the directory of the reference file';
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return 'names no existing file';
  }
  if (!inside(fs.realpathSync(dir), real)) return 'resolves outside the directory of the reference file';
  return fs.statSync(real).isFile() ? null : 'is not a regular file';
}

interface Loaded {
  readonly ref: NamedFile;
  readonly field: 'config' | 'ledger' | 'results' | 'raw_outputs';
  readonly abs: string;
  readonly bytes: Buffer;
}

const MEMBERS = ['config', 'ledger', 'results', 'raw_outputs'] as const;

/** Steps 3 and 4: every path first, then every hash. Returns the files read. */
function loadNamedFiles(dir: string, ref: ExternalReferenceFile): Loaded[] {
  const named = MEMBERS.flatMap((field) => {
    const r = ref[field];
    return r === null ? [] : [{ field, ref: r as NamedFile }];
  });
  const seen = new Set<string>(RESERVED_NAMES);
  for (const { field, ref: r } of named) {
    const fault = pathFault(dir, r.file);
    if (fault !== null) fail(`${field}.file`, fault);
    const base = path.basename(r.file);
    if (seen.has(base)) fail(`${field}.file`, `the base name ${shown(base)} is reserved or used by another member`);
    seen.add(base);
  }
  const loaded = named.map(({ field, ref: r }) => {
    const abs = path.resolve(dir, r.file);
    return { ref: r, field, abs, bytes: fs.readFileSync(abs) };
  });
  for (const f of loaded) {
    const actual = sha256Of(f.bytes);
    if (actual !== f.ref.sha256) fail(`${f.field}.sha256`, `differs from the sha256 of ${shown(f.ref.file)} (given ${f.ref.sha256}, file ${actual})`);
  }
  return loaded;
}

function jsonLines(bytes: Buffer): string[] {
  const lines = bytes.toString('utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export interface RawLine {
  readonly card_id: string;
  readonly permutation: string;
  readonly raw: string;
}

/** Step 5: the format of the named files. Returns the raw-output lines (empty without raw outputs). */
function checkFormats(files: readonly Loaded[]): RawLine[] {
  const rawLines: RawLine[] = [];
  for (const f of files) {
    if (f.field === 'config') continue;
    const lines = jsonLines(f.bytes);
    const seen = new Set<string>();
    lines.forEach((text, i) => {
      const where = `${f.field}.content`;
      let v: unknown;
      try {
        v = JSON.parse(text);
      } catch {
        return fail(where, `line ${i + 1} is not valid JSON`);
      }
      if (!isObj(v)) return fail(where, `line ${i + 1} is not a JSON object`);
      if (f.field !== 'raw_outputs') return;
      const keys = Object.keys(v).sort().join(',');
      if (keys !== 'card_id,permutation,raw') return fail(where, `line ${i + 1} must have exactly the members card_id, permutation and raw`);
      const { card_id, permutation, raw } = v as { card_id: unknown; permutation: unknown; raw: unknown };
      if (typeof card_id !== 'string' || card_id === '' || typeof permutation !== 'string' || permutation === '' || typeof raw !== 'string') {
        return fail(where, `line ${i + 1}: card_id and permutation must be non-empty strings and raw a string`);
      }
      const key = `${card_id}\u0000${permutation}`;
      if (seen.has(key)) return fail(where, `line ${i + 1} repeats Card ID ${shown(card_id)} with permutation ${shown(permutation)}`);
      seen.add(key);
      rawLines.push({ card_id, permutation, raw });
    });
  }
  return rawLines;
}

// ---------------------------------------------------------------- step 6: re-grade

const TASK_OF = { D: 'decision', S: 'synthesis' } as const satisfies Record<'D' | 'S', TaskType>;

/**
 * Re-grades raw outputs on the Locked_Cards of one Task_Type through Sim_Wasm (`llm_validate` in the stated mode,
 * `llm_grade`, `llm_identity`, `llm_contrast`) and counts them with the very Metrics code of the repository
 * (`computeMetrics`). Throws `ExternalReferenceError` for a Card ID that is not a Locked_Card of the Task_Type.
 */
export function regradeRawOutputs(lockedCards: readonly LoadedCard[], task: 'D' | 'S', mode: ValidateMode, lines: readonly RawLine[]): Figures {
  const taskType = TASK_OF[task];
  const byId = new Map(lockedCards.map((c) => [c.id, c] as const));
  lines.forEach((l, i) => {
    const card = byId.get(l.card_id);
    if (card === undefined || card.task !== taskType) fail('raw_outputs.content', `line ${i + 1}: Card ID ${shown(l.card_id)} is not a Locked_Card of Task_Type ${task}`);
  });
  const records: ResultRecord[] = lines.map((l) => ({
    schema: SCHEMA.result,
    run_id: 'external-regrade',
    split: 'locked',
    card_id: l.card_id,
    permutation: l.permutation,
    outcome: { kind: 'text', text: l.raw },
    latency_ms: 0,
    timeout_ms: 1,
    requested_at: '1970-01-01T00:00:00.000Z',
    template_hash: '',
    fingerprint_id: '',
    usage: null,
    late: null,
    source: 'node',
  }));
  let graded;
  try {
    graded = gradeRecords(lockedCards, records, [taskType], mode);
  } catch (e) {
    if (e instanceof GradingError) return fail('raw_outputs.content', e.message);
    throw e;
  }
  const metrics = computeMetrics({ cards: lockedCards.map(metricCardFromLoaded), records, grades: graded.grades, contrasts: graded.contrasts, tasks: [taskType] });
  const m = metrics.tasks[0];
  if (m === undefined) throw new Error('computeMetrics returned no Task_Type');
  return {
    acceptable: m.acceptable.num,
    scored_cards: m.acceptable.den,
    severe: m.severe.count,
    illegal: m.illegal.num,
    flip_perms: m.flip.den,
    flips: m.flip.num,
    consistent_pairs: m.contrast.num,
    pairs: m.contrast.den,
  };
}

export const differingFigures = (a: Figures, b: Figures): FigureName[] => FIGURE_NAMES.filter((n) => a[n] !== b[n]);

// ---------------------------------------------------------------- ingest

/** The paths the ingest needs. `RunDeps['paths']` fits. */
export interface ExternalPaths {
  readonly cardsDir: string;
  /** `eval/results`; the only directory written is `<resultsDir>/external/<label>/`. */
  readonly resultsDir: string;
}

export interface ExternalDeps {
  readonly paths: ExternalPaths;
  /** The constant of R1.4; the reference's `pinned_manifest_hash` must equal it. */
  readonly pinnedManifestHash: string;
}

export const externalDir = (resultsDir: string): string => path.join(resultsDir, 'external');

export interface IngestedReference {
  readonly record: ExternalRecord;
  /** The directory written. */
  readonly dir: string;
}

/**
 * Checks a reference file and the files it names, in the documented order, then stores them. The caller has run the
 * Manifest_Check. Throws `ExternalReferenceError` (nothing written) for a rejected file; a `CardLoadError` from the
 * Card_Set propagates as it is. A re-grade that differs from the supplied figures is not a rejection.
 */
export function ingestExternalReference(deps: ExternalDeps, referencePath: string): IngestedReference {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(referencePath);
  } catch {
    return fail('file', 'cannot read the reference file');
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail('file', 'is not valid JSON');
  }
  const ref = parseReferenceFile(value); // step 1
  if (ref.pinned_manifest_hash !== deps.pinnedManifestHash) fail('pinned_manifest_hash', `differs from the Pinned_Manifest_Hash of the Card_Set (given ${ref.pinned_manifest_hash}, pinned ${deps.pinnedManifestHash})`);
  const files = loadNamedFiles(path.dirname(path.resolve(referencePath)), ref); // steps 3 and 4
  const rawLines = checkFormats(files); // step 5

  let regrade: Figures | null = null;
  if (ref.raw_outputs !== null) {
    const locked = loadCards({ cardsDir: deps.paths.cardsDir, splits: ['dev', 'locked'] }).cards.locked;
    regrade = regradeRawOutputs(locked, ref.task_type, ref.raw_outputs.answer_mode, rawLines);
  }

  const target = path.join(externalDir(deps.paths.resultsDir), ref.label);
  if (fs.existsSync(target)) fail('label', `an External_Reference with the label ${shown(ref.label)} is already stored; it is never replaced`);

  const differing = regrade === null ? [] : differingFigures(ref.figures, regrade);
  const record: ExternalRecord = {
    schema: EXTERNAL_RECORD_SCHEMA,
    label: ref.label,
    reference_model: ref.reference_model,
    task_type: ref.task_type,
    pinned_manifest_hash: ref.pinned_manifest_hash,
    reference_sha256: sha256Of(bytes),
    config: ref.config,
    ledger: ref.ledger,
    results: ref.results,
    raw_outputs: ref.raw_outputs,
    supplied: ref.figures,
    regrade: regrade === null ? null : differing.length === 0 ? 'match' : 'mismatch',
    regrade_figures: regrade,
    differing,
    raw_output_count: ref.raw_outputs === null ? null : rawLines.length,
  };

  // Everything is checked. Write the copy; a failure while writing removes what this call created.
  try {
    fs.mkdirSync(target, { recursive: true });
    copyFileUnchanged(path.resolve(referencePath), path.join(target, 'reference.json'));
    for (const f of files) copyFileUnchanged(f.abs, path.join(target, path.basename(f.ref.file)));
    writeTextFile(path.join(target, 'record.json'), `${canonicalJson(record)}\n`);
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true });
    throw e;
  }
  return { record, dir: target };
}

// ---------------------------------------------------------------- reading stored records (Report section 12)

function parseFigures(v: unknown, where: string): Figures {
  if (!isObj(v)) throw new Error(`${where} must be an object`);
  const out: Record<string, number> = {};
  for (const n of FIGURE_NAMES) {
    const x = v[n];
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) throw new Error(`${where}.${n} must be a non-negative whole number`);
    out[n] = x;
  }
  return out as Figures;
}

function parseNamed(v: unknown, where: string): NamedFile {
  if (!isObj(v) || typeof v['file'] !== 'string' || typeof v['sha256'] !== 'string' || !HEX64.test(v['sha256'])) throw new Error(`${where} must hold "file" and a sha256`);
  return { file: v['file'], sha256: v['sha256'] };
}

/** Reads one stored `record.json`; throws an Error naming the problem. */
export function parseExternalRecord(v: unknown): ExternalRecord {
  if (!isObj(v)) throw new Error('record must be an object');
  if (v['schema'] !== EXTERNAL_RECORD_SCHEMA) throw new Error(`schema must be "${EXTERNAL_RECORD_SCHEMA}"`);
  const str = (k: string): string => {
    const x = v[k];
    if (typeof x !== 'string' || x === '') throw new Error(`${k} must be a non-empty string`);
    return x;
  };
  const task = v['task_type'];
  if (task !== 'D' && task !== 'S') throw new Error('task_type must be D or S');
  const raw = v['raw_outputs'];
  let raw_outputs: RawOutputsRef | null = null;
  if (raw !== null) {
    const named = parseNamed(raw, 'raw_outputs');
    const mode = (raw as Obj)['answer_mode'];
    if (mode !== 'json' && mode !== 'raw_choice') throw new Error('raw_outputs.answer_mode must be json or raw_choice');
    raw_outputs = { ...named, answer_mode: mode };
  }
  const regrade = v['regrade'];
  if (regrade !== null && regrade !== 'match' && regrade !== 'mismatch') throw new Error('regrade must be null, "match" or "mismatch"');
  const differing = v['differing'];
  if (!Array.isArray(differing) || !differing.every((n): n is FigureName => (FIGURE_NAMES as readonly unknown[]).includes(n))) throw new Error('differing must be a list of figure names');
  const count = v['raw_output_count'];
  if (count !== null && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) throw new Error('raw_output_count must be null or a whole number');
  return {
    schema: EXTERNAL_RECORD_SCHEMA,
    label: str('label'),
    reference_model: str('reference_model'),
    task_type: task,
    pinned_manifest_hash: str('pinned_manifest_hash'),
    reference_sha256: str('reference_sha256'),
    config: parseNamed(v['config'], 'config'),
    ledger: parseNamed(v['ledger'], 'ledger'),
    results: parseNamed(v['results'], 'results'),
    raw_outputs,
    supplied: parseFigures(v['supplied'], 'supplied'),
    regrade,
    regrade_figures: v['regrade_figures'] === null ? null : parseFigures(v['regrade_figures'], 'regrade_figures'),
    differing,
    raw_output_count: count,
  };
}

/** Every stored External_Reference, in label order. An absent directory gives an empty list. */
export function readExternalRecords(resultsDir: string): ExternalRecord[] {
  const root = externalDir(resultsDir);
  if (!fs.existsSync(root)) return [];
  const out: ExternalRecord[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = path.join(root, entry.name, 'record.json');
    try {
      out.push(parseExternalRecord(JSON.parse(fs.readFileSync(file, 'utf8'))));
    } catch (e) {
      throw new Error(`${path.relative(resultsDir, file)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
