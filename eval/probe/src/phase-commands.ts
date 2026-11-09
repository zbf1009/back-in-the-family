// I/O side of `phase-status` and `ledger` (R18.2). Reads the ledger, failure and exclusion
// records, Smoke_Call records, `combinations.json` and approvals from git `HEAD`; reads no card
// content. Pass results per ledger entry come from an injected loader, because grading needs the
// Card_Set and these commands never open it. All output goes through sink.ts.
import * as fs from 'node:fs';
import path from 'node:path';
import { loadApprovals } from './approvals.ts';
import { readLedger } from './ledger.ts';
import { formatDecisionModels, formatLedger, formatPhaseStatus, parseCombinations, phase2ResultLines, phaseStatus, techRuntimeWarning, type DevRunInfo, type EntryPasses, type PhaseState } from './phase.ts';
import { readExclusions, readFailures, readResultsFile, readSmoke } from './results.ts';
import { printErrorLine, printLine } from './sink.ts';
import type { LedgerEntry } from './ledger.ts';

export interface PhasePaths {
  readonly repoDir: string;
  readonly ledger: string;
  readonly failures: string;
  readonly exclusions: string;
  readonly smokeDir: string;
  readonly combinations: string;
  /** Dev_Run Results directory; read for the Decision_Model gate. */
  readonly devDir?: string;
}

export function defaultPaths(repoDir: string): PhasePaths {
  return {
    repoDir,
    ledger: path.join(repoDir, 'eval/results/ledger.jsonl'),
    failures: path.join(repoDir, 'eval/results/failures.jsonl'),
    exclusions: path.join(repoDir, 'eval/results/exclusions.jsonl'),
    smokeDir: path.join(repoDir, 'eval/results/smoke'),
    combinations: path.join(repoDir, 'eval/probe/combinations.json'),
    devDir: path.join(repoDir, 'eval/results/dev'),
  };
}

/** Pass per Task_Type for each `complete` ledger entry, from stored grades; injected. */
export type PassLoader = (entries: readonly LedgerEntry[]) => ReadonlyMap<string, EntryPasses>;

/** Default: no pass data (the grading wiring arrives with the run and report commands). */
export const noPasses: PassLoader = () => new Map();

const ifExists = <T>(file: string, read: (f: string) => T[]): T[] => (fs.existsSync(file) ? read(file) : []);

function readSmokeDir(dir: string): ReturnType<typeof readSmoke> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) => readSmoke(path.join(dir, f)));
}

/** Dev_Run headers in file-name order (oldest first), as the Dev_Run precondition reads them (R3.12). Unreadable files are skipped here. */
function readDevRuns(dir: string | undefined): DevRunInfo[] {
  if (dir === undefined || !fs.existsSync(dir)) return [];
  const out: DevRunInfo[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl') && !n.endsWith('.grades.jsonl')).sort()) {
    try {
      const h = readResultsFile(path.join(dir, name));
      const attempted = h.records.length === 0 || h.records.some((r) => !(r.outcome.kind === 'not_run' && r.outcome.reason === 'not_approved'));
      out.push({ run_id: h.header.run_id, combination: h.header.combination, task_subset: h.header.task_subset, template_hashes: h.header.template_hashes, attempted });
    } catch {
      // The Dev_Run precondition reports unreadable files; the gate then finds no matching header and refuses.
    }
  }
  return out;
}

/** Low level: the state with an injected pass loader. Callers that need pass results use `loadPhaseState` in report-command.ts. */
export async function readPhaseState(paths: PhasePaths, loadPasses: PassLoader = noPasses): Promise<PhaseState> {
  const combinations = parseCombinations(fs.readFileSync(paths.combinations, 'utf8'));
  const { entries } = readLedger(paths.ledger);
  const approvals = await loadApprovals({ repoDir: paths.repoDir, print: printErrorLine });
  return {
    combinations,
    entries,
    failures: ifExists(paths.failures, readFailures),
    exclusions: ifExists(paths.exclusions, readExclusions),
    smoke: readSmokeDir(paths.smokeDir),
    approvals,
    passes: loadPasses(entries),
    overLimit: new Set(),
    devRuns: readDevRuns(paths.devDir),
  };
}

/** Prints the `phase-status` lines for a state. */
export function printPhaseStatus(state: PhaseState, techText: string | null = null): void {
  for (const line of formatPhaseStatus(phaseStatus(state))) printLine(line);
  for (const line of phase2ResultLines(state)) printLine(line);
  for (const line of formatDecisionModels(state)) printLine(line);
  const warning = techRuntimeWarning(state, techText);
  if (warning !== null) printErrorLine(`phase-status: warning: ${warning}`);
  printLine('Scope: the D and S lines above are the Phase_1 in-browser result only (R18.2); Workers AI Locked_Runs appear in the Phase_2 lines and in the Report.');
}

/** Text of `.kiro/steering/tech.md`, or null when it cannot be read (only the hold warning uses it). */
export function readTechMd(repoDir: string): string | null {
  try {
    return fs.readFileSync(path.join(repoDir, '.kiro/steering/tech.md'), 'utf8');
  } catch {
    return null;
  }
}

/** `phase-status`: prints the per-Task_Type result and the branch that follows. Returns the exit code. */
export async function phaseStatusCommand(paths: PhasePaths, loadPasses: PassLoader = noPasses): Promise<number> {
  try {
    const state = await readPhaseState(paths, loadPasses);
    if (loadPasses === noPasses && state.entries.some((e) => e.status === 'complete')) {
      printErrorLine('phase-status: warning: no pass results are loaded, so no complete entry counts as a pass yet');
    }
    printPhaseStatus(state, readTechMd(paths.repoDir));
    return 0;
  } catch (error) {
    printErrorLine(`probe: phase-status: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** `ledger`: lists entries with Task_Type_Subset and derived status. Returns the exit code. */
export function ledgerCommand(paths: PhasePaths): number {
  try {
    for (const line of formatLedger(readLedger(paths.ledger).entries)) printLine(line);
    return 0;
  } catch (error) {
    printErrorLine(`probe: ledger: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
