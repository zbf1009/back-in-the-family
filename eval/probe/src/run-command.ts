// CLI side of `dev-run` and `locked-run` (llm-probe task 13.2): flag parsing and the default wiring.
//
// Flags:
//   dev-run    --combo <id> [--task D|S|DS] [--timeout-ms N] [--approval <id>]
//   locked-run --combo <id> --task D|S|DS [--timeout-ms N] [--approval <id>] [--rerun-reason "..."]
//   locked-run --resume <entry-id> [--timeout-ms N] [--approval <id>]
//
// The real Runtime adapters arrive in tasks 16 and 17. Until then the default factory refuses with
// a clear message, before anything is written.
import * as fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PINNED_MANIFEST_HASH } from './manifest.ts';
import { parseCombinations } from './phase.ts';
import { defaultPaths, loadPhaseState } from './phase-commands.ts';
import type { TaskSubset } from './results.ts';
import { devRun, lockedRun, type DevRunOptions, type LockedRunOptions, type RunDeps, type RuntimeFactory } from './run.ts';
import { DEFAULT_CARDS_DIR } from './cards.ts';
import { printErrorLine } from './sink.ts';

const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));

export function defaultRunPaths(repoDir: string = REPO_DIR): RunDeps['paths'] {
  const resultsDir = path.join(repoDir, 'eval/results');
  return {
    repoDir,
    cardsDir: DEFAULT_CARDS_DIR,
    resultsDir,
    ledger: path.join(resultsDir, 'ledger.jsonl'),
    failures: path.join(resultsDir, 'failures.jsonl'),
    exclusions: path.join(resultsDir, 'exclusions.jsonl'),
    budgetFile: path.join(repoDir, 'eval/results/budget/workers-ai.json'),
  };
}

/** Until tasks 16 and 17 add the real adapters, no Runtime can be created. */
export const noRuntimeYet: RuntimeFactory = (ctx) =>
  Promise.reject(new Error(`no Runtime adapter for "${ctx.combo.runtime}" yet (tasks 16 and 17)`));

export function defaultRunDeps(repoDir: string = REPO_DIR, createRuntime: RuntimeFactory = noRuntimeYet): RunDeps {
  const paths = defaultRunPaths(repoDir);
  return {
    paths,
    pinnedManifestHash: PINNED_MANIFEST_HASH,
    combinations: parseCombinations(fs.readFileSync(path.join(repoDir, 'eval/probe/combinations.json'), 'utf8')),
    createRuntime,
    phaseState: () => loadPhaseState(defaultPaths(repoDir)),
  };
}

const SUBSETS: readonly string[] = ['D', 'S', 'DS'];

export type ParsedArgs<T> = { readonly ok: true; readonly options: T } | { readonly ok: false; readonly message: string };

function parse(argv: readonly string[]): { values: Record<string, string | undefined> } | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        combo: { type: 'string' },
        task: { type: 'string' },
        'timeout-ms': { type: 'string' },
        approval: { type: 'string' },
        'rerun-reason': { type: 'string' },
        resume: { type: 'string' },
      },
    });
    if (positionals.length > 0) return { error: `unexpected argument "${positionals[0]}"` };
    return { values: values as Record<string, string | undefined> };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function subsetOf(v: string | undefined): TaskSubset | undefined | 'bad' {
  if (v === undefined) return undefined;
  return SUBSETS.includes(v) ? (v as TaskSubset) : 'bad';
}

export function parseDevRunArgs(argv: readonly string[]): ParsedArgs<DevRunOptions> {
  const r = parse(argv);
  if ('error' in r) return { ok: false, message: r.error };
  const { combo, task, approval, resume, 'rerun-reason': rerun, 'timeout-ms': timeout } = r.values;
  if (resume !== undefined || rerun !== undefined) return { ok: false, message: 'dev-run takes no --resume or --rerun-reason' };
  if (combo === undefined || combo === '') return { ok: false, message: '--combo <id> is required' };
  const subset = subsetOf(task);
  if (subset === 'bad') return { ok: false, message: '--task must be D, S or DS' };
  return {
    ok: true,
    options: { combo, ...(subset === undefined ? {} : { task: subset }), ...(timeout === undefined ? {} : { timeoutMs: timeout }), approval: approval ?? null },
  };
}

export function parseLockedRunArgs(argv: readonly string[]): ParsedArgs<LockedRunOptions> {
  const r = parse(argv);
  if ('error' in r) return { ok: false, message: r.error };
  const { combo, task, approval, resume, 'rerun-reason': rerun, 'timeout-ms': timeout } = r.values;
  const subset = subsetOf(task);
  if (subset === 'bad') return { ok: false, message: '--task must be D, S or DS' };
  const common = { ...(timeout === undefined ? {} : { timeoutMs: timeout }), approval: approval ?? null };
  if (resume !== undefined) {
    if (combo !== undefined || task !== undefined || rerun !== undefined) {
      return { ok: false, message: '--resume cannot be combined with --combo, --task or --rerun-reason' };
    }
    return { ok: true, options: { resume, ...common } };
  }
  if (combo === undefined || combo === '' || subset === undefined) return { ok: false, message: 'locked-run needs --combo <id> and --task D|S|DS (or --resume <entry-id>)' };
  return { ok: true, options: { combo, task: subset, rerunReason: rerun ?? null, ...common } };
}

/** `dev-run`. Returns the exit code. */
export async function devRunCommand(argv: readonly string[], deps: RunDeps): Promise<number> {
  const parsed = parseDevRunArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: dev-run: ${parsed.message}`);
    return 2;
  }
  return devRun(deps, parsed.options);
}

/** `locked-run`. Returns the exit code. */
export async function lockedRunCommand(argv: readonly string[], deps: RunDeps): Promise<number> {
  const parsed = parseLockedRunArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: locked-run: ${parsed.message}`);
    return 2;
  }
  return lockedRun(deps, parsed.options);
}
