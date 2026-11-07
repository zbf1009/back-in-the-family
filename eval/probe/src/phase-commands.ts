// I/O side of `phase-status` and `ledger` (R18.2). Reads the ledger, failure and exclusion
// records, Smoke_Call records, `combinations.json` and approvals from git `HEAD`; reads no card
// content. Pass results per ledger entry come from an injected loader, because grading needs the
// Card_Set and these commands never open it. All output goes through sink.ts.
import * as fs from 'node:fs';
import path from 'node:path';
import { loadApprovals } from './approvals.ts';
import { readLedger } from './ledger.ts';
import { formatLedger, formatPhaseStatus, parseCombinations, phaseStatus, type EntryPasses, type PhaseState } from './phase.ts';
import { readExclusions, readFailures, readSmoke } from './results.ts';
import { printErrorLine, printLine } from './sink.ts';
import type { LedgerEntry } from './ledger.ts';

export interface PhasePaths {
  readonly repoDir: string;
  readonly ledger: string;
  readonly failures: string;
  readonly exclusions: string;
  readonly smokeDir: string;
  readonly combinations: string;
}

export function defaultPaths(repoDir: string): PhasePaths {
  return {
    repoDir,
    ledger: path.join(repoDir, 'eval/results/ledger.jsonl'),
    failures: path.join(repoDir, 'eval/results/failures.jsonl'),
    exclusions: path.join(repoDir, 'eval/results/exclusions.jsonl'),
    smokeDir: path.join(repoDir, 'eval/results/smoke'),
    combinations: path.join(repoDir, 'eval/probe/combinations.json'),
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

export async function loadPhaseState(paths: PhasePaths, loadPasses: PassLoader = noPasses): Promise<PhaseState> {
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
  };
}

/** `phase-status`: prints the per-Task_Type result and the branch that follows. Returns the exit code. */
export async function phaseStatusCommand(paths: PhasePaths, loadPasses: PassLoader = noPasses): Promise<number> {
  try {
    const state = await loadPhaseState(paths, loadPasses);
    if (loadPasses === noPasses && state.entries.some((e) => e.status === 'complete')) {
      printErrorLine('phase-status: warning: no pass results are loaded, so no complete entry counts as a pass yet');
    }
    for (const line of formatPhaseStatus(phaseStatus(state))) printLine(line);
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
