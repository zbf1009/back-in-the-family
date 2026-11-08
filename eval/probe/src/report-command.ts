// I/O side of `probe report` (llm-probe task 10.2; R3.1, R3.8, R15). Gathers the ledger, Results,
// grades, perf, failure, exclusion, Smoke_Call and preflight records, `combinations.json` and the
// approvals from `HEAD`, analyses each run, and writes `docs/llm-probe.md` through sink.ts.
//
// Cards: `locked.jsonl` is read through `loadCards`, which only parses each line with
// `llm_parse_card`; this file never renders a prompt. Grading itself was done by the Grader through
// Sim_Wasm when each run was written; the Report reads those stored grades (`regrade` checks them
// byte for byte, R12.6). The caller must run the Manifest_Check first (cli.ts does).
import * as fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CARDS_DIR, loadCards, type LoadedCard, type LoadedCards } from './cards.ts';
import { decisionFactsFromLoaded, type DecisionCardFacts } from './diagnosis.ts';
import { readLedger, type LedgerEntry } from './ledger.ts';
import { metricCardFromLoaded, type FaultRecord, type MetricCard } from './metrics.ts';
import { defaultPaths, loadPhaseState, type PhasePaths } from './phase-commands.ts';
import { analyzeRun, buildReport, scanFaults, TARGET_MACHINE, type ReportInput, type RunAnalysis, type RuntimeLibrary } from './report.ts';
import {
  gradesPathFor,
  readGradesFile,
  readPerf,
  readPreflight,
  readResultsFile,
  type PerfRecord,
  type PreflightRecord,
} from './results.ts';
import { printErrorLine, printLine, writeTextFile } from './sink.ts';

export interface ReportPaths extends PhasePaths {
  readonly resultsDir: string;
  readonly devDir: string;
  readonly preflightDir: string;
  readonly cardsDir: string;
  readonly runtimeLibraries: string;
  readonly reportFile: string;
}

export function reportPaths(repoDir: string): ReportPaths {
  const base = defaultPaths(repoDir);
  const resultsDir = path.join(repoDir, 'eval/results');
  return {
    ...base,
    resultsDir,
    devDir: path.join(resultsDir, 'dev'),
    preflightDir: path.join(resultsDir, 'preflight'),
    cardsDir: DEFAULT_CARDS_DIR,
    runtimeLibraries: path.join(repoDir, 'eval/probe/runtime-libraries.json'),
    reportFile: path.join(repoDir, 'docs/llm-probe.md'),
  };
}

export interface ReportCards {
  readonly dev: readonly MetricCard[];
  readonly locked: readonly MetricCard[];
  /** D card facts for the request-level baseline and position diagnosis. */
  readonly devDecision?: readonly DecisionCardFacts[];
  readonly lockedDecision?: readonly DecisionCardFacts[];
}

const decisionFacts = (cards: readonly LoadedCard[]): DecisionCardFacts[] => cards.flatMap((c) => decisionFactsFromLoaded(c) ?? []);

/** Converts loaded cards into the parsed facts the Metrics read; nothing is rendered. */
export function reportCardsFrom(loaded: LoadedCards): ReportCards {
  return {
    dev: loaded.cards.dev.map(metricCardFromLoaded),
    locked: loaded.cards.locked.map(metricCardFromLoaded),
    devDecision: decisionFacts(loaded.cards.dev),
    lockedDecision: decisionFacts(loaded.cards.locked),
  };
}

const perfPathFor = (resultsFile: string): string => resultsFile.replace(/\.jsonl$/, '') + '.perf.json';
const readPerfIfExists = (file: string): PerfRecord | null => (fs.existsSync(file) ? readPerf(file) : null);

function lockedResultsFile(paths: ReportPaths, e: LedgerEntry): string {
  const recorded = e.complete?.results;
  if (recorded !== undefined) return path.isAbsolute(recorded) ? recorded : path.join(paths.repoDir, recorded);
  return path.join(paths.resultsDir, 'locked', `${e.entry_id}.jsonl`);
}

function loadPreflights(dir: string): Map<string, PreflightRecord> {
  const out = new Map<string, PreflightRecord>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const rec = readPreflight(path.join(dir, f));
    const combination = rec['combination'];
    if (typeof combination === 'string') out.set(combination, rec);
  }
  return out;
}

function loadLibraries(file: string): RuntimeLibrary[] {
  if (!fs.existsSync(file)) {
    printErrorLine(`report: warning: ${path.basename(file)} not found, so no Runtime library licenses are listed (R15.6)`);
    return [];
  }
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${path.basename(file)} must be a list of {name, version, license, url}`);
  return value.map((v: unknown, i) => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    for (const k of ['name', 'version', 'license', 'url']) if (typeof o[k] !== 'string') throw new Error(`${path.basename(file)}[${i}].${k} must be a string`);
    return { name: o['name'] as string, version: o['version'] as string, license: o['license'] as string, url: o['url'] as string };
  });
}

/** Collects everything `buildReport` needs. Throws with a clear message on a bad file. */
export async function gatherReportInput(paths: ReportPaths, cards: ReportCards, today: string): Promise<ReportInput> {
  const { passes: _passes, overLimit: _overLimit, ...state } = await loadPhaseState(paths);
  const { entries } = readLedger(paths.ledger);

  const lockedRuns: RunAnalysis[] = [];
  const incompleteFaults = new Map<string, FaultRecord[]>();
  for (const e of entries) {
    const file = lockedResultsFile(paths, e);
    if (e.status === 'complete') {
      const results = readResultsFile(file);
      lockedRuns.push(
        analyzeRun({
          kind: 'locked',
          id: e.entry_id,
          cards: cards.locked,
          ...(cards.lockedDecision !== undefined ? { decisionCards: cards.lockedDecision } : {}),
          header: results.header,
          records: results.records,
          grades: readGradesFile(gradesPathFor(file)),
          perf: readPerfIfExists(perfPathFor(file)),
        }),
      );
    } else if (fs.existsSync(file)) {
      incompleteFaults.set(e.entry_id, scanFaults(readResultsFile(file).records));
    }
  }

  const devRuns: RunAnalysis[] = [];
  const invalidDevRuns = loadInvalidDevRuns(path.join(paths.devDir, '..', INVALID_DEV_RUNS_FILE));
  if (fs.existsSync(paths.devDir)) {
    const files = fs.readdirSync(paths.devDir).filter((n) => n.endsWith('.jsonl') && !n.endsWith('.grades.jsonl')).sort();
    for (const name of files) {
      const file = path.join(paths.devDir, name);
      if (!fs.existsSync(gradesPathFor(file))) {
        printErrorLine(`report: warning: Dev_Run ${name} has no grades file and is left out`);
        continue;
      }
      const results = readResultsFile(file);
      devRuns.push(
        analyzeRun({
          kind: 'dev',
          id: results.header.run_id,
          cards: cards.dev,
          ...(cards.devDecision !== undefined ? { decisionCards: cards.devDecision } : {}),
          header: results.header,
          records: results.records,
          grades: readGradesFile(gradesPathFor(file)),
          perf: markInvalid(readPerfIfExists(perfPathFor(file)), invalidDevRuns.has(results.header.run_id)),
        }),
      );
    }
  }

  return {
    generated_on: today,
    environment: { targetMachine: TARGET_MACHINE, workersEndpoint: null },
    state,
    lockedRuns,
    incompleteFaults,
    devRuns,
    preflights: loadPreflights(paths.preflightDir),
    runtimeLibraries: loadLibraries(paths.runtimeLibraries),
  };
}

/**
 * Dev_Runs the Author or the harness found to have run on another device than the one they report (listed by run ID
 * in `eval/results/invalid-dev-runs.json`, a JSON object run_id -> reason). The result files stay as written; the
 * Report treats a listed run as `device_mismatch`, so its figures never appear as figures of the reported GPU.
 */
export const INVALID_DEV_RUNS_FILE = 'invalid-dev-runs.json';

export function loadInvalidDevRuns(file: string): Map<string, string> {
  if (!fs.existsSync(file)) return new Map();
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = new Map<string, string>();
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) out.set(k, typeof v === 'string' ? v : '');
  }
  return out;
}

export function markInvalid(perf: PerfRecord | null, invalid: boolean): PerfRecord | null {
  if (!invalid || perf === null) return perf;
  const memory = typeof perf.memory === 'object' && perf.memory !== null && !Array.isArray(perf.memory) ? perf.memory : {};
  return { ...perf, memory: { ...memory, device_mismatch: true } };
}

/** `report`: writes `docs/llm-probe.md`. Returns the exit code. The Manifest_Check has already passed. */
export async function reportCommand(paths: ReportPaths): Promise<number> {
  try {
    const loaded = loadCards({ cardsDir: paths.cardsDir, splits: ['dev', 'locked'] });
    const input = await gatherReportInput(paths, reportCardsFrom(loaded), new Date().toISOString().slice(0, 10));
    writeTextFile(paths.reportFile, buildReport(input));
    printLine(`report: wrote ${path.relative(paths.repoDir, paths.reportFile)} (${input.lockedRuns.length} Locked_Run entries, ${input.devRuns.length} Dev_Runs)`);
    return 0;
  } catch (error) {
    printErrorLine(`probe: report: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
