// CLI side of `page-bundle`, `ingest` and `regrade` (llm-probe task 13.7): flag parsing and wiring.
//
// Flags:
//   page-bundle --combo <id> --split dev|locked --task D|S|DS [--timeout-ms N] [--rerun-reason "..."]
//   ingest      --file <export.json>
//   regrade     --results <results.jsonl>
//
// Relative file paths are relative to the current directory (`pnpm --dir eval/probe` runs in eval/probe),
// so an absolute path is the safe choice. Each command runs the Manifest_Check itself before it reads a
// card (R1.1), exactly as `dev-run` and `locked-run` do.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ingest, regrade, writeBundle, type IngestDeps } from './ingest.ts';
import type { TaskSubset } from './results.ts';
import { devRun, lockedRun, type PageBundleHook, type RunDeps } from './run.ts';
import type { ParsedArgs } from './run-command.ts';
import { printErrorLine, printLine } from './sink.ts';

export interface PageBundleOptions {
  readonly combo: string;
  readonly split: 'dev' | 'locked';
  readonly task: TaskSubset;
  readonly timeoutMs?: string;
  readonly rerunReason?: string | null;
}

type Values = Record<string, string | undefined>;

function parse(argv: readonly string[], names: readonly string[]): { values: Values } | { error: string } {
  try {
    const options: Record<string, { type: 'string' }> = {};
    for (const n of names) options[n] = { type: 'string' };
    const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options });
    if (positionals.length > 0) return { error: `unexpected argument "${positionals[0]}"` };
    return { values: values as Values };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function parsePageBundleArgs(argv: readonly string[]): ParsedArgs<PageBundleOptions> {
  const r = parse(argv, ['combo', 'split', 'task', 'timeout-ms', 'rerun-reason']);
  if ('error' in r) return { ok: false, message: r.error };
  const { combo, split, task, 'timeout-ms': timeout, 'rerun-reason': rerun } = r.values;
  if (combo === undefined || combo === '') return { ok: false, message: '--combo <id> is required' };
  if (split !== 'dev' && split !== 'locked') return { ok: false, message: '--split must be dev or locked' };
  if (task !== 'D' && task !== 'S' && task !== 'DS') return { ok: false, message: '--task must be D, S or DS' };
  if (split === 'dev' && rerun !== undefined) return { ok: false, message: '--rerun-reason applies to --split locked only' };
  return { ok: true, options: { combo, split, task, ...(timeout === undefined ? {} : { timeoutMs: timeout }), rerunReason: rerun ?? null } };
}

export function parseIngestArgs(argv: readonly string[]): ParsedArgs<{ readonly file: string }> {
  const r = parse(argv, ['file']);
  if ('error' in r) return { ok: false, message: r.error };
  if (r.values['file'] === undefined || r.values['file'] === '') return { ok: false, message: '--file <export.json> is required' };
  return { ok: true, options: { file: path.resolve(r.values['file']) } };
}

export function parseRegradeArgs(argv: readonly string[]): ParsedArgs<{ readonly results: string }> {
  const r = parse(argv, ['results']);
  if ('error' in r) return { ok: false, message: r.error };
  if (r.values['results'] === undefined || r.values['results'] === '') return { ok: false, message: '--results <results.jsonl> is required' };
  return { ok: true, options: { results: path.resolve(r.values['results']) } };
}

/** `page-bundle`. Dev: render and write the bundle. Locked: the locked run flow up to the ledger `start`, then write the bundle. */
export async function pageBundleCommand(argv: readonly string[], deps: RunDeps): Promise<number> {
  const parsed = parsePageBundleArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: page-bundle: ${parsed.message}`);
    return 2;
  }
  const o = parsed.options;
  const pageBundle: PageBundleHook = (data) => {
    const file = writeBundle(deps.paths.resultsDir, data);
    printLine(`probe: bundle written ${path.relative(deps.paths.repoDir, file)} (${data.requests.length} requests, run ${data.runId})`);
  };
  const timeout = o.timeoutMs === undefined ? {} : { timeoutMs: o.timeoutMs };
  if (o.split === 'dev') return devRun(deps, { combo: o.combo, task: o.task, ...timeout, pageBundle });
  return lockedRun(deps, { combo: o.combo, task: o.task, rerunReason: o.rerunReason ?? null, ...timeout, pageBundle });
}

/** `ingest`. */
export async function ingestCommand(argv: readonly string[], deps: IngestDeps): Promise<number> {
  const parsed = parseIngestArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: ingest: ${parsed.message}`);
    return 2;
  }
  return ingest(deps, parsed.options.file);
}

/** `regrade`. */
export async function regradeCommand(argv: readonly string[], deps: IngestDeps): Promise<number> {
  const parsed = parseRegradeArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: regrade: ${parsed.message}`);
    return 2;
  }
  return regrade(deps, parsed.options.results);
}
