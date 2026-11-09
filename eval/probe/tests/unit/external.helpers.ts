// Fixtures for the External_Reference tests (llm-probe task 31). A SYNTHETIC card set in a temp directory (the "locked"
// split is made from the dev lines with new IDs), a temp repo and a temp directory holding the reference file and the
// files it names. The real eval/results, the real ledger and the real locked.jsonl are never touched.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCards, type LoadedCard } from '../../src/cards.ts';
import { EXTERNAL_FILE_SCHEMA, FIGURE_NAMES, regradeRawOutputs, type Figures, type RawLine } from '../../src/external.ts';
import type { ExternalCommandDeps } from '../../src/external-command.ts';
import { createFakeRuntime, makeCardSet, makeEnv, type TestCards, type TestEnv } from './run.helpers.ts';

export const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

export const cardSet: TestCards = makeCardSet();

/** The synthetic locked cards (parsed by Sim_Wasm through the real loader). */
export const lockedCards: LoadedCard[] = loadCards({ cardsDir: cardSet.dir, splits: ['dev', 'locked'] }).cards.locked;

interface RawCard {
  readonly id: string;
  readonly task: string;
  readonly options?: readonly { readonly id: string }[];
}
const rawCards: RawCard[] = fs
  .readFileSync(path.join(cardSet.dir, 'cards', 'locked.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as RawCard);

export const cardsOfTask = (task: 'D' | 'S'): RawCard[] => rawCards.filter((c) => c.task === (task === 'D' ? 'decision' : 'synthesis'));

export type RawKind = 'valid' | 'junk' | 'badoption';
export interface RawSpec {
  readonly card: number;
  readonly permutation: 'base' | 'reversed' | 'rot1';
  readonly kind: RawKind;
  readonly option: number;
}

/** Raw-output lines for a spec: unique (card, permutation) pairs, in spec order. */
export function rawLinesOf(task: 'D' | 'S', specs: readonly RawSpec[]): RawLine[] {
  const cards = cardsOfTask(task);
  const seen = new Set<string>();
  const out: RawLine[] = [];
  for (const s of specs) {
    const card = cards[s.card % cards.length] as RawCard;
    const key = `${card.id}/${s.permutation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let raw: string;
    if (s.kind === 'junk') raw = 'not an answer';
    else if (s.kind === 'badoption') raw = JSON.stringify({ option: 'zzz_no_such_option' });
    else if (task === 'D') raw = JSON.stringify({ option: (card.options as readonly { id: string }[])[s.option % (card.options?.length ?? 1)]?.id });
    else raw = JSON.stringify({ schema: 'x', items: [] });
    out.push({ card_id: card.id, permutation: s.permutation, raw });
  }
  return out;
}

/** The figures an honest reference would supply for these raw outputs (computed by the repository's own grading and Metrics code). */
export const oracleFigures = (task: 'D' | 'S', mode: 'json' | 'raw_choice', lines: readonly RawLine[]): Figures => regradeRawOutputs(lockedCards, task, mode, lines);

export const zeroFigures = (): Figures => Object.fromEntries(FIGURE_NAMES.map((n) => [n, 0])) as unknown as Figures;

export interface RefFiles {
  readonly dir: string;
  /** Absolute path of the reference file. */
  readonly refPath: string;
  /** The reference object as written (before any fault). */
  readonly ref: Record<string, unknown>;
  /** Absolute paths of the named files, by member. */
  readonly files: { readonly config: string; readonly ledger: string; readonly results: string; readonly raw_outputs: string | null };
}

export interface RefOptions {
  readonly label?: string;
  readonly task: 'D' | 'S';
  readonly lines: readonly RawLine[] | null;
  readonly mode?: 'json' | 'raw_choice';
  readonly figures: Figures;
  readonly pinned: string;
  readonly model?: string;
}

/** Writes a valid reference file and the files it names into a fresh temp directory. */
export function writeReference(o: RefOptions): RefFiles {
  const dir = mkdtempSync(path.join(tmpdir(), 'ext-ref-'));
  mkdirSync(path.join(dir, 'sub'));
  const config = '{"frozen":true,"note":"configuration of the reference run"}\n';
  const ledger = '{"event":"start","entry":"E-1"}\n{"event":"complete","entry":"E-1"}\n';
  const results = '{"card_id":"x","figure":1}\n';
  const rawText = o.lines === null ? null : o.lines.map((l) => JSON.stringify(l)).join('\n') + (o.lines.length > 0 ? '\n' : '');
  const paths = {
    config: path.join(dir, 'config.json'),
    ledger: path.join(dir, 'sub', 'ledger.jsonl'),
    results: path.join(dir, 'results.jsonl'),
    raw_outputs: rawText === null ? null : path.join(dir, 'raw-outputs.jsonl'),
  };
  writeFileSync(paths.config, config);
  writeFileSync(paths.ledger, ledger);
  writeFileSync(paths.results, results);
  if (rawText !== null && paths.raw_outputs !== null) writeFileSync(paths.raw_outputs, rawText);
  const ref: Record<string, unknown> = {
    schema: EXTERNAL_FILE_SCHEMA,
    label: o.label ?? 'teacher-upper-bound',
    reference_model: o.model ?? 'Reference Model 1',
    task_type: o.task,
    pinned_manifest_hash: o.pinned,
    config: { file: 'config.json', sha256: sha(config) },
    ledger: { file: 'sub/ledger.jsonl', sha256: sha(ledger) },
    results: { file: 'results.jsonl', sha256: sha(results) },
    raw_outputs: rawText === null ? null : { file: 'raw-outputs.jsonl', sha256: sha(rawText), answer_mode: o.mode ?? 'json' },
    figures: { ...o.figures },
  };
  const refPath = path.join(dir, 'reference.json');
  writeFileSync(refPath, `${JSON.stringify(ref, null, 2)}\n`);
  return { dir, refPath, ref, files: paths };
}

/** Rewrites the reference file from an object. */
export const rewriteReference = (r: RefFiles, ref: Record<string, unknown>): void => writeFileSync(r.refPath, `${JSON.stringify(ref, null, 2)}\n`);

/** A temp repo over the synthetic card set, with a ledger and a budget counter that must stay untouched. */
export function makeRepo(): { env: TestEnv; deps: ExternalCommandDeps } {
  const env = makeEnv(cardSet);
  const d = env.deps(createFakeRuntime());
  mkdirSync(path.dirname(d.paths.ledger), { recursive: true });
  writeFileSync(d.paths.ledger, '{"schema":"llm-probe-ledger-v1","note":"existing bytes"}\n');
  mkdirSync(path.dirname(d.paths.budgetFile), { recursive: true });
  writeFileSync(d.paths.budgetFile, '{"day":"2026-11-09","requests":3,"neurons":120}\n');
  return { env, deps: { paths: d.paths, pinnedManifestHash: d.pinnedManifestHash } };
}

/** Path -> sha256 of every file under `dir`. */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p, sha(fs.readFileSync(p)));
    }
  };
  walk(dir);
  return out;
}

/** String values of the synthetic locked cards that are card content (not IDs): none may appear in any output. */
export function cardContentStrings(): string[] {
  const out = new Set<string>();
  const ids = new Set(rawCards.map((c) => c.id));
  const walk = (v: unknown, key: string): void => {
    if (typeof v === 'string') {
      if (v.length >= 12 && !ids.has(v) && !['id', 'scenario_group', 'pair_id'].includes(key)) out.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  const lines = fs.readFileSync(path.join(cardSet.dir, 'cards', 'locked.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '');
  for (const l of lines) walk(JSON.parse(l), '');
  return [...out];
}
