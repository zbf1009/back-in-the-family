// Output of the run commands (R3.11). Dev_Runs and Locked_Runs print through this class only.
//
// The class has NO method that accepts prompt text, model output or card text. Every method takes
// fixed codes, numbers, Card IDs, entry IDs, Combination IDs, hashes, or error objects whose
// messages are built by program code from those values (manifest, ledger, card-load failures).
// Progress lines are counts only: `D 120/244 S 40/164`.
import type { CardFailure } from './cards.ts';
import { printErrorLine, printLine } from './sink.ts';
import type { LedgerError } from './ledger.ts';

/** Done and total requests of one Task_Type, or null when the Task_Type is not in the run. */
export type TaskProgress = readonly [done: number, total: number] | null;

export function formatProgress(d: TaskProgress, s: TaskProgress): string {
  const parts: string[] = [];
  if (d !== null) parts.push(`D ${d[0]}/${d[1]}`);
  if (s !== null) parts.push(`S ${s[0]}/${s[1]}`);
  return parts.join(' ');
}

/** The R17.6 `docs/kiro-log.md` entry fields: identifiers, hashes and counts only. */
export interface DocEntry {
  readonly kind: 'start' | 'resume';
  readonly entryId: string;
  readonly combination: string;
  readonly taskSubset: string;
  readonly modelKey: string;
  readonly fingerprintId: string;
  readonly templateHashes: Readonly<Record<string, string>>;
  readonly planned: Readonly<Record<string, number>>;
  readonly approval: string | null;
  readonly rerunOf: string | null;
  readonly startedAt: string;
}

export type RenderReasonCategory = 'option_count' | 'repeated_option_id' | 'unknown_placeholder' | 'other';

/** Reduces a Rust render error message to a category, so no option ID or card text is printed. */
export function renderReasonCategory(message: string): RenderReasonCategory {
  if (/options, need 2 to 5/.test(message)) return 'option_count';
  if (/repeated option ID/.test(message)) return 'repeated_option_id';
  if (/unknown placeholder/.test(message)) return 'unknown_placeholder';
  return 'other';
}

const RENDER_REASON_TEXT: Readonly<Record<RenderReasonCategory, string>> = {
  option_count: 'a decision has fewer than 2 or more than 5 options',
  repeated_option_id: 'a decision repeats an option ID',
  unknown_placeholder: 'the template has an unknown placeholder',
  other: 'the prompt could not be rendered',
};

export type FailureCode =
  | 'invalid_timeout'
  | 'unknown_combination'
  | 'invalid_arguments'
  | 'card_load'
  | 'not_pinned'
  | 'excluded'
  | 'gate_refused'
  | 'dev_run_missing'
  | 'template_mismatch'
  | 'render_errors'
  | 'fresh_profile_failed'
  | 'runtime_unavailable'
  | 'budget_unreadable'
  | 'ledger_write_failed'
  | 'results_write_failed'
  | 'load_failed'
  | 'rebuild_failed'
  | 'budget_stop'
  | 'not_approved_stop'
  | 'grading_failed'
  | 'run_incomplete'
  | 'resume_unknown'
  | 'internal';

const FAILURE_TEXT: Readonly<Record<FailureCode, string>> = {
  invalid_timeout: 'invalid Timeout value (need a positive whole number of milliseconds)',
  unknown_combination: 'unknown Combination',
  invalid_arguments: 'invalid arguments',
  card_load: 'cards could not be loaded',
  not_pinned: 'the Combination has no Pinned_Revision (R9.15)',
  excluded: 'the Combination has an Exclusion_Record',
  gate_refused: 'the Workers AI phase gate refused this run',
  dev_run_missing: 'no Dev_Run covers a Task_Type of this Locked_Run (R3.12)',
  template_mismatch: 'a Prompt_Template differs from the most recent Dev_Run (R3.12)',
  render_errors: 'pre-render failed; nothing was written (R3.15)',
  fresh_profile_failed: 'the Fresh_Profile checks failed before the ledger entry',
  runtime_unavailable: 'the Runtime could not be created',
  budget_unreadable: 'the Request_Budget counter is unreadable (R11.12)',
  ledger_write_failed: 'the ledger could not be written; no request was sent (R3.4)',
  results_write_failed: 'the Results file could not be created',
  load_failed: 'the Runtime failed to load',
  rebuild_failed: 'the engine rebuild failed; remaining runs are not_run (R8.13)',
  budget_stop: 'the Request_Budget refused a request; remaining runs are not_run',
  not_approved_stop: 'the Runtime refused for a missing approval; remaining runs are not_run',
  grading_failed: 'grading through Sim_Wasm failed',
  run_incomplete: 'not every Card x Permutation has an output; the entry stays incomplete',
  resume_unknown: 'the entry cannot be resumed',
  internal: 'internal error',
};

export interface FailureArgs {
  readonly cardId?: string;
  readonly entryId?: string;
  readonly combination?: string;
  readonly count?: number;
  /** A value the user supplied on the command line (for example the invalid Timeout), or a hash. */
  readonly value?: string | number;
}

export class RunLogger {
  /** Counts only: `D 120/244 S 40/164`. */
  progress(d: TaskProgress, s: TaskProgress): void {
    printLine(`probe: progress ${formatProgress(d, s)}`);
  }

  /** `probe: run: <label> <ids and counts>`: a short fixed status line. */
  status(label: 'dev-run start' | 'locked-run start' | 'resume' | 'results written' | 'grades written' | 'complete' | 'aborted', args: FailureArgs = {}): void {
    printLine(`probe: ${label}${formatArgs(args)}`);
  }

  failure(code: FailureCode, args: FailureArgs = {}): void {
    printErrorLine(`probe: ${code}: ${FAILURE_TEXT[code]}${formatArgs(args)}`);
  }

  /** Manifest_Check lines: paths, hashes and counts only (R1.7). */
  manifest(lines: readonly string[], ok: boolean): void {
    for (const line of lines) (ok ? printLine : printErrorLine)(line);
  }

  /** A ledger refusal; the message names entry IDs only. */
  ledgerError(error: LedgerError): void {
    printErrorLine(`probe: ledger: ${error.message}`);
  }

  /** Card-load failures; a parse failure prints split, line and Card ID, never the parser's message. */
  cardLoad(failures: readonly CardFailure[]): void {
    printErrorLine(`probe: card_load: ${FAILURE_TEXT.card_load}`);
    for (const f of failures) {
      if (f.kind === 'parse_failure') {
        printErrorLine(`probe: cards: ${f.split}.jsonl line ${f.line}${f.cardId === undefined ? '' : ` (Card ID: ${f.cardId})`}: card could not be parsed`);
      } else if (f.kind === 'file_unreadable') {
        printErrorLine(`probe: cards: cannot read ${f.path}`);
      } else {
        printErrorLine(`probe: cards: ${f.kind}${'id' in f ? ` (Card ID: ${f.id})` : ''}`);
      }
    }
  }

  /** One pre-render error: Card ID, permutation and a category (R3.15). */
  renderError(cardId: string, permutation: string, category: RenderReasonCategory): void {
    printErrorLine(`probe: render: Card ID ${cardId} (${permutation}): ${RENDER_REASON_TEXT[category]}`);
  }

  /**
   * `ingest` rejected a Probe_Page export: the first failing entry and the reason (R10.5). Both are built by
   * program code from field names and IDs found in the export; neither holds model output or card text.
   */
  ingestRejected(entry: string, reason: string): void {
    printErrorLine(`probe: ingest: rejected: ${entry}: ${reason}`);
  }

  /** `regrade` succeeded: counts only (R12.6). It sent no request to any Runtime. */
  regradeOk(file: string, records: number, gradeLines: number): void {
    printLine(`probe: regrade: ${file}: ${records} records re-graded, ${gradeLines} grades lines byte-equal, Metrics and intervals identical, 0 Runtime requests`);
  }

  /** A Results file or grades file that cannot be read (R12.7): file and first failing record, no content. */
  resultsError(message: string): void {
    printErrorLine(`probe: results: ${message}`);
  }

  /** Gate refusal text from `allowWorkersAi` or the approval check (program-built from IDs and counts). */
  gateRefusal(reason: string): void {
    printErrorLine(`probe: gate: ${reason}`);
  }

  /** Dev_Run precondition lines: names Combination IDs, Task_Types, template file names and hashes. */
  precondition(lines: readonly string[]): void {
    for (const line of lines) printErrorLine(`probe: ${line}`);
  }

  /** The text for `docs/kiro-log.md` (R17.6), without card content. The developer pastes it. */
  docEntry(e: DocEntry): void {
    const hashes = Object.entries(e.templateHashes)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const planned = Object.entries(e.planned)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    printLine('probe: docs/kiro-log.md entry to paste (no card content):');
    printLine(
      `- Locked_Run ${e.kind}: entry ${e.entryId}, Combination ${e.combination}, Task_Type_Subset ${e.taskSubset}, Model_Key ${e.modelKey}, ` +
        `fingerprint ${e.fingerprintId}, Template_Hashes ${hashes}, planned requests ${planned}, ` +
        `approval ${e.approval ?? 'none'}${e.rerunOf === null ? '' : `, re-run of ${e.rerunOf}`}, at ${e.startedAt}.`,
    );
  }

  /** Final counts of a run. */
  summary(c: { readonly total: number; readonly withOutput: number; readonly notRun: number; readonly engineFaults: number }): void {
    printLine(`probe: records ${c.total}, with output ${c.withOutput}, not_run ${c.notRun}, engine_fault ${c.engineFaults}`);
  }
}

function formatArgs(a: FailureArgs): string {
  const parts: string[] = [];
  if (a.combination !== undefined) parts.push(`Combination ${a.combination}`);
  if (a.entryId !== undefined) parts.push(`entry ${a.entryId}`);
  if (a.cardId !== undefined) parts.push(`Card ID ${a.cardId}`);
  if (a.count !== undefined) parts.push(`count ${a.count}`);
  if (a.value !== undefined) parts.push(`value ${JSON.stringify(a.value)}`);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}
