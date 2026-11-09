// Card loading (llm-probe task 7.3; requirements 2.1 to 2.7, 3.2).
//
// Cards are parsed by Sim_Wasm (`llm_parse_card`) only. This module splits lines, reads the
// envelope's `meta` (id, task, scored, split) and checks counts, duplicate IDs and the
// "Voided cards" table of LOCK.md. It holds no card-parsing rules of its own.
//
// A Dev_Run passes `splits: ['dev']` and never opens locked.jsonl (R3.2). A Locked_Run passes
// `['dev', 'locked']`, so the duplicate-ID check across splits sees both. Callers pass the
// card directory, so unit tests can point at temporary directories.
//
// Who may read locked.jsonl (R3.1, with RC-13): a Locked_Run (which also renders prompts from it), and, for grading and
// statistics only, never rendering a prompt and printing only Card IDs, pair_ids and scenario group IDs: `ingest` and
// `regrade` (ingest.ts), `report` and `phase-status` (report-command.ts) and `ingest-reference` (external.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { llmParseCard } from './simwasm.ts';

export type Split = 'dev' | 'locked';
export type CountName = 'total' | 'scored_decision' | 'scored_synthesis' | 'sanity';
export type TaskType = 'decision' | 'synthesis';

export const COUNT_NAMES: readonly CountName[] = [
  'total',
  'scored_decision',
  'scored_synthesis',
  'sanity',
];

export type Counts = Record<CountName, number>;

/** The real Card_Set directory (`eval/cards`). */
export const DEFAULT_CARDS_DIR = fileURLToPath(new URL('../../cards/', import.meta.url));

export interface LoadedCard {
  id: string;
  split: Split;
  /** 1-based line number in the split's .jsonl file. */
  line: number;
  task: TaskType;
  scored: boolean;
  /** True when LOCK.md's "Voided cards" table names this card. */
  void: boolean;
  /** The line exactly as read. */
  text: string;
  /** The `llm_parse_card` result (JSON text, unchanged). */
  parsed: string;
}

export type CardFailure =
  | { kind: 'file_unreadable'; path: string; message: string }
  | { kind: 'contents_missing'; split: Split }
  | { kind: 'parse_failure'; split: Split; line: number; cardId?: string; message: string }
  | {
      kind: 'duplicate_id';
      id: string;
      first: { split: Split; line: number };
      second: { split: Split; line: number };
    }
  | { kind: 'count_mismatch'; split: Split; count: CountName; expected: number; actual: number }
  | { kind: 'void_table_missing' }
  | { kind: 'void_row_malformed'; row: string }
  | { kind: 'void_unknown_id'; id: string };

export function formatCardFailure(f: CardFailure): string {
  switch (f.kind) {
    case 'file_unreadable':
      return `probe: cards: cannot read ${f.path}: ${f.message}`;
    case 'contents_missing':
      return `probe: cards: LOCK.md "Contents" table has no row for split ${f.split}`;
    case 'parse_failure':
      return (
        `probe: cards: ${f.split}.jsonl line ${f.line}` +
        `${f.cardId === undefined ? '' : ` (Card ID: ${f.cardId})`}: ${f.message}`
      );
    case 'duplicate_id':
      return (
        `probe: cards: duplicate Card ID ${f.id}: ` +
        `${f.first.split}.jsonl line ${f.first.line} and ${f.second.split}.jsonl line ${f.second.line}`
      );
    case 'count_mismatch':
      return (
        `probe: cards: split ${f.split}: count ${f.count}: ` +
        `expected ${f.expected}, actual ${f.actual}`
      );
    case 'void_table_missing':
      return 'probe: cards: LOCK.md has no "Voided cards" table';
    case 'void_row_malformed':
      return `probe: cards: LOCK.md "Voided cards" table: malformed row: ${f.row}`;
    case 'void_unknown_id':
      return `probe: cards: LOCK.md "Voided cards" table names unknown Card ID ${f.id}`;
  }
}

/** Thrown for every load failure; `failures` has the exact fields, `message` the printed lines. */
export class CardLoadError extends Error {
  readonly failures: CardFailure[];
  constructor(failures: CardFailure[]) {
    super(failures.map(formatCardFailure).join('\n'));
    this.name = 'CardLoadError';
    this.failures = failures;
  }
}

export interface LoadedCards {
  /** Loaded cards per requested split, in file order. */
  cards: Record<Split, LoadedCard[]>;
  /** Every loaded card, dev first. */
  all: LoadedCard[];
  /** Counts actually found, per loaded split. */
  counts: Partial<Record<Split, Counts>>;
  /** Counts recorded in LOCK.md, per loaded split. */
  expected: Partial<Record<Split, Counts>>;
  /** Card IDs marked void (all that were found in the loaded splits). */
  voidIds: string[];
  /**
   * Void-table IDs that are not in any loaded split. Non-empty only when a split was not
   * loaded (a Dev_Run does not read locked.jsonl, so it cannot tell a locked ID from a typo).
   */
  unverifiedVoidIds: string[];
}

export interface LoadCardsOptions {
  /** Directory holding LOCK.md and cards/<split>.jsonl. */
  cardsDir: string;
  /** Splits to read. A Dev_Run passes ['dev']. */
  splits: readonly Split[];
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    throw new CardLoadError([
      { kind: 'file_unreadable', path: file, message: e instanceof Error ? e.message : String(e) },
    ]);
  }
}

function tableCells(line: string): string[] {
  const t = line.trim();
  const inner = t.slice(t.startsWith('|') ? 1 : 0, t.endsWith('|') ? t.length - 1 : t.length);
  return inner.split('|').map((c) => c.trim());
}

const stripTicks = (s: string): string => s.replace(/^`+|`+$/g, '').trim();

/** Reads the expected counts of one split from the LOCK.md "Contents" table. */
export function parseContentsRow(lockText: string, split: Split): Counts | undefined {
  for (const line of lockText.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = tableCells(line);
    if (stripTicks(cells[0] ?? '') !== split) continue;
    const nums = [1, 2, 3, 4].map((i) => cells[i] ?? '');
    if (!nums.every((n) => /^\d+$/.test(n))) return undefined;
    const [total, d, s, sanity] = nums.map(Number) as [number, number, number, number];
    return { total, scored_decision: d, scored_synthesis: s, sanity };
  }
  return undefined;
}

export type VoidTable =
  | { ok: true; ids: string[] }
  | { ok: false; failure: CardFailure & ({ kind: 'void_table_missing' } | { kind: 'void_row_malformed' }) };

/** Reads the "Voided cards" table (R2.5, R2.6). */
export function parseVoidTable(lockText: string): VoidTable {
  const lines = lockText.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s+Voided cards\s*$/i.test(l.trim()));
  if (start < 0) return { ok: false, failure: { kind: 'void_table_missing' } };
  const rows: string[] = [];
  let seenTable = false;
  for (const l of lines.slice(start + 1)) {
    const t = l.trim();
    if (t.startsWith('|')) {
      seenTable = true;
      rows.push(t);
    } else if (seenTable || /^#{1,6}\s/.test(t)) {
      break;
    }
  }
  // header row, separator row, then data rows
  const header = rows[0] === undefined ? undefined : tableCells(rows[0]);
  const sep = rows[1];
  if (
    header === undefined ||
    header.length !== 3 ||
    sep === undefined ||
    !tableCells(sep).every((c) => /^:?-{3,}:?$/.test(c))
  ) {
    return { ok: false, failure: { kind: 'void_table_missing' } };
  }
  const data = rows.slice(2);
  if (data.length === 0) {
    return { ok: false, failure: { kind: 'void_row_malformed', row: '(no data rows)' } };
  }
  const ids: string[] = [];
  for (const row of data) {
    const cells = tableCells(row);
    const date = cells[0] ?? '';
    const card = stripTicks(cells[1] ?? '');
    const isNone = cells.length === 3 && date.toLowerCase() === 'none' && card === '';
    if (isNone) continue;
    if (cells.length !== 3 || date === '' || card === '' || /\s/.test(card) || date.toLowerCase() === 'none') {
      return { ok: false, failure: { kind: 'void_row_malformed', row } };
    }
    ids.push(card);
  }
  return { ok: true, ids };
}

/** Wrapper used for the `meta` members this module reads. */
function readEnvelope(parsed: string):
  | { ok: true; id: string; task: TaskType; scored: boolean }
  | { ok: false; message: string } {
  const env = JSON.parse(parsed) as {
    ok?: boolean;
    error?: { message?: string };
    meta?: { id?: string; task?: string; scored?: boolean };
  };
  if (env.ok !== true) return { ok: false, message: env.error?.message ?? 'parse failure' };
  const m = env.meta;
  if (
    m === undefined ||
    typeof m.id !== 'string' ||
    (m.task !== 'decision' && m.task !== 'synthesis') ||
    typeof m.scored !== 'boolean'
  ) {
    return { ok: false, message: 'parse failure: unexpected llm_parse_card result' };
  }
  return { ok: true, id: m.id, task: m.task, scored: m.scored };
}

/** The Card ID, when the line is valid JSON with a string `id` field (R2.3). */
function idOfLine(text: string): string | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const id = (v as Record<string, unknown>).id;
      if (typeof id === 'string') return id;
    }
  } catch {
    // not JSON: no Card ID
  }
  return undefined;
}

function countsOf(cards: readonly LoadedCard[]): Counts {
  return {
    total: cards.length,
    scored_decision: cards.filter((c) => c.scored && c.task === 'decision').length,
    scored_synthesis: cards.filter((c) => c.scored && c.task === 'synthesis').length,
    sanity: cards.filter((c) => !c.scored).length,
  };
}

/** Loads the requested splits; throws CardLoadError on any failure (nothing is written). */
export function loadCards(opts: LoadCardsOptions): LoadedCards {
  const lockText = readText(path.join(opts.cardsDir, 'LOCK.md'));
  const order: Split[] = (['dev', 'locked'] as const).filter((s) => opts.splits.includes(s));

  const expected: Partial<Record<Split, Counts>> = {};
  for (const split of order) {
    const row = parseContentsRow(lockText, split);
    if (row === undefined) throw new CardLoadError([{ kind: 'contents_missing', split }]);
    expected[split] = row;
  }

  const cards: Record<Split, LoadedCard[]> = { dev: [], locked: [] };
  for (const split of order) {
    const text = readText(path.join(opts.cardsDir, 'cards', `${split}.jsonl`));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = (lines[i] ?? '').replace(/\r$/, '');
      if (raw.trim() === '') continue;
      const line = i + 1;
      const parsed = llmParseCard(raw, idOfLine(raw));
      const env = readEnvelope(parsed);
      if (!env.ok) {
        const cardId = idOfLine(raw);
        throw new CardLoadError([
          {
            kind: 'parse_failure',
            split,
            line,
            ...(cardId === undefined ? {} : { cardId }),
            message: env.message,
          },
        ]);
      }
      cards[split].push({
        id: env.id,
        split,
        line,
        task: env.task,
        scored: env.scored,
        void: false,
        text: raw,
        parsed,
      });
    }
  }

  const all = order.flatMap((s) => cards[s]);

  const failures: CardFailure[] = [];

  // Duplicate IDs within and across the loaded splits (R2.4).
  const seen = new Map<string, LoadedCard>();
  for (const c of all) {
    const first = seen.get(c.id);
    if (first === undefined) {
      seen.set(c.id, c);
    } else {
      failures.push({
        kind: 'duplicate_id',
        id: c.id,
        first: { split: first.split, line: first.line },
        second: { split: c.split, line: c.line },
      });
    }
  }
  if (failures.length > 0) throw new CardLoadError(failures);

  // Counts against the Contents table (R2.1, R2.2).
  const counts: Partial<Record<Split, Counts>> = {};
  for (const split of order) {
    const actual = countsOf(cards[split]);
    counts[split] = actual;
    const want = expected[split] as Counts;
    for (const count of COUNT_NAMES) {
      if (actual[count] !== want[count]) {
        failures.push({ kind: 'count_mismatch', split, count, expected: want[count], actual: actual[count] });
      }
    }
  }
  if (failures.length > 0) throw new CardLoadError(failures);

  // Voided cards (R2.5 to R2.7).
  const table = parseVoidTable(lockText);
  if (!table.ok) throw new CardLoadError([table.failure]);
  const voidIds: string[] = [];
  const unverifiedVoidIds: string[] = [];
  const bothLoaded = order.length === 2;
  for (const id of [...new Set(table.ids)]) {
    const card = seen.get(id);
    if (card !== undefined) {
      card.void = true;
      voidIds.push(id);
    } else if (bothLoaded) {
      failures.push({ kind: 'void_unknown_id', id });
    } else {
      unverifiedVoidIds.push(id);
    }
  }
  if (failures.length > 0) throw new CardLoadError(failures);

  return { cards, all, counts, expected, voidIds, unverifiedVoidIds };
}
