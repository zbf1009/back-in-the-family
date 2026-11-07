// `probe screen [--write]` (llm-probe task 16.9; R9.3, R9.8, R9.15, R9.17).
//
// Reads the Hugging Face API tree of every pinned in-browser Combination at its Pinned_Revision, sums the files
// its loader fetches (screen.ts `sumTreeBytes`), and screens each Combination against the In_Browser_Size_Limits
// and the pinning check (screen.ts `screenCombinations`). It reads no card and no env file.
//
// The network is touched only when the Author runs this command (the fetch is injectable for the tests).
//
// Without `--write` it prints a table and the Exclusion_Records it WOULD write, and changes no file.
// With `--write` it makes two deliberate writes, and nothing else:
//   - `size.expected_download_bytes` of each Combination whose tree was read and whose stored value is null,
//     in `combinations.json` (a committed input; the file keeps its 2-space JSON layout, so the diff is those lines);
//   - one Exclusion_Record per failing Combination in `exclusions.jsonl` (once per Combination and check).
// An Exclusion_Record is a terminal Phase_1 state, so one is never written for a Combination whose revision is
// not pinned yet (its sizes are simply not read yet): pin the revisions first. `--exclude-unpinned` overrides that
// on purpose, to record the R9.15 `unpinned` exclusion once pinning was due.
// A tree that could not be read (network or API error) is never turned into an Exclusion_Record: that figure is
// unknown only because the fetch failed, so the Combination stays unscreened and the command exits 1.
import * as fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseCombinations, type Combination } from './phase.ts';
import { appendExclusionOnce, readPreflight, type ExclusionRecord } from './results.ts';
import { REVISION_RE, isInBrowser, screenCombinations, sumTreeBytes, type PreflightOutcome, type ScreenResult, type TreeFile } from './screen.ts';
import { printErrorLine, printLine, writeTextFileAtomic } from './sink.ts';

/** The part of `fetch`'s Response the tree reader uses. */
export interface TreeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  readonly headers: { get(name: string): string | null };
}
export type TreeFetch = (url: string) => Promise<TreeResponse>;

export interface ScreenDeps {
  readonly combinationsFile: string;
  readonly exclusionsFile: string;
  readonly preflightDir: string;
  /** Default: the global `fetch`. */
  readonly fetch?: TreeFetch;
  readonly now?: () => number;
}

export interface ScreenOptions {
  readonly write: boolean;
  /** Also write Exclusion_Records for Combinations whose revision is not pinned. */
  readonly excludeUnpinned?: boolean;
}

/** `huggingface.co/<repo>`: WebLLM models live under `mlc-ai/`; transformers.js model IDs are full repo names. */
export const repoOf = (c: Combination): string => (c.runtime === 'webllm' ? `mlc-ai/${c.model_id}` : c.model_id);

export const treeUrl = (repo: string, revision: string): string => `https://huggingface.co/api/models/${repo}/tree/${revision}?recursive=true`;

/** Reads every page of a tree (the API pages at 1,000 entries and names the next page in a `Link` header). */
export async function readTree(fetchTree: TreeFetch, repo: string, revision: string): Promise<TreeFile[]> {
  const files: TreeFile[] = [];
  let url: string | null = treeUrl(repo, revision);
  for (let page = 0; url !== null; page++) {
    if (page >= 50) throw new Error(`${repo}: more than 50 tree pages`);
    const res = await fetchTree(url);
    if (!res.ok) throw new Error(`${repo}@${revision}: the tree request returned HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`${repo}@${revision}: the tree response is not a list`);
    for (const e of body as unknown[]) {
      const o = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
      if (o['type'] === 'file' && typeof o['path'] === 'string' && typeof o['size'] === 'number') files.push({ path: o['path'], size: o['size'] });
    }
    const link = res.headers.get('link');
    const next: string | null = link === null ? null : (/<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null);
    url = next;
  }
  return files;
}

export interface ScreenReport {
  readonly results: readonly ScreenResult[];
  /** Combinations whose tree could not be read, with the reason. */
  readonly fetchErrors: ReadonlyMap<string, string>;
}

/** Fetches trees and screens; pure apart from `fetchTree`. Unpinned Combinations are screened without a fetch. */
export async function screenAll(combos: readonly Combination[], fetchTree: TreeFetch, at: string, preflight?: ReadonlyMap<string, PreflightOutcome>): Promise<ScreenReport> {
  const fetchErrors = new Map<string, string>();
  const results = await screenCombinations(combos, {
    at,
    ...(preflight === undefined ? {} : { preflight }),
    fetchDownloadBytes: async (combo) => {
      try {
        return sumTreeBytes(combo.runtime, await readTree(fetchTree, repoOf(combo), combo.revision));
      } catch (e) {
        fetchErrors.set(combo.id, e instanceof Error ? e.message : String(e));
        return null;
      }
    },
  });
  return { results, fetchErrors };
}

const mib = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

export function formatTable(report: ScreenReport): string[] {
  const rows = report.results.map((r) => {
    const c = r.combination;
    const pinned = REVISION_RE.test(c.revision) ? c.revision.slice(0, 8) : 'unpinned';
    const dl = r.download_bytes === null ? 'unknown' : `${mib(r.download_bytes)} MiB`;
    const err = report.fetchErrors.get(c.id);
    const verdict = err !== undefined ? `FETCH FAILED: ${err}` : r.exclusion === null ? 'ok' : `EXCLUDED ${r.exclusion.check}: ${r.exclusion.value} (limit ${r.exclusion.limit})`;
    return [c.id, pinned, dl, verdict];
  });
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => (r[i] as string).length), ['combination', 'revision', 'download'][i]?.length ?? 0));
  const line = (cols: readonly string[]): string => `${cols.slice(0, 3).map((v, i) => v.padEnd(widths[i] ?? 0)).join('  ')}  ${cols[3] ?? ''}`;
  return [line(['combination', 'revision', 'download', 'result']), ...rows.map(line)];
}

/** `combinations.json` with `size.expected_download_bytes` filled in for the given Combinations; layout unchanged. */
export function withDownloadBytes(text: string, bytes: ReadonlyMap<string, number>): string {
  const list = JSON.parse(text) as Record<string, unknown>[];
  if (`${JSON.stringify(list, null, 2)}\n` !== text) {
    throw new Error('combinations.json is not in the canonical 2-space JSON layout, so a rewrite would change unrelated lines; format it first');
  }
  for (const c of list) {
    const n = bytes.get(c['id'] as string);
    if (n === undefined) continue;
    const size = c['size'] as Record<string, unknown> | undefined;
    if (size === undefined || size['expected_download_bytes'] !== null) continue; // never overwrite a stored figure
    size['expected_download_bytes'] = n;
  }
  return `${JSON.stringify(list, null, 2)}\n`;
}

function loadPreflightOutcomes(dir: string): Map<string, PreflightOutcome> {
  const out = new Map<string, PreflightOutcome>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const r = readPreflight(path.join(dir, f));
    const id = r['combination'];
    if (typeof id === 'string') out.set(id, { loaded_on_webgpu: r['loaded_on_webgpu'] === true, peak_vram_mib: typeof r['peak_vram_mib'] === 'number' ? r['peak_vram_mib'] : null });
  }
  return out;
}

export function parseScreenArgs(argv: readonly string[]): { readonly ok: true; readonly options: ScreenOptions } | { readonly ok: false; readonly message: string } {
  try {
    const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { write: { type: 'boolean' }, 'exclude-unpinned': { type: 'boolean' } } });
    if (positionals.length > 0) return { ok: false, message: `unexpected argument "${positionals[0]}"` };
    return { ok: true, options: { write: values.write === true, ...(values['exclude-unpinned'] === true ? { excludeUnpinned: true } : {}) } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs the screen. Returns the exit code: 0 when every tree was read and no Combination fails a check, else 1. */
export async function screenRun(deps: ScreenDeps, opts: ScreenOptions): Promise<number> {
  const text = fs.readFileSync(deps.combinationsFile, 'utf8');
  const combos = parseCombinations(text).filter(isInBrowser);
  const fetchTree: TreeFetch = deps.fetch ?? ((url) => fetch(url, { headers: { accept: 'application/json' } }));
  const at = new Date((deps.now ?? Date.now)()).toISOString();
  const report = await screenAll(combos, fetchTree, at, loadPreflightOutcomes(deps.preflightDir));

  for (const l of formatTable(report)) printLine(l);
  const decided = report.results.flatMap((r) => (r.exclusion === null || report.fetchErrors.has(r.combination.id) ? [] : [r.exclusion]));
  const pinned = (e: ExclusionRecord): boolean => REVISION_RE.test(combos.find((c) => c.id === e.combination)?.revision ?? '');
  const exclusions: ExclusionRecord[] = opts.excludeUnpinned === true ? decided : decided.filter(pinned);
  if (exclusions.length < decided.length) {
    printLine(`probe: screen: ${decided.length - exclusions.length} unpinned Combination(s) are not recorded as excluded (pin the revisions first, or pass --exclude-unpinned)`);
  }
  const fetched = new Map<string, number>();
  for (const r of report.results) {
    if (r.download_bytes !== null && !report.fetchErrors.has(r.combination.id) && r.combination.size?.expected_download_bytes === null) fetched.set(r.combination.id, r.download_bytes);
  }

  if (!opts.write) {
    printLine(`probe: screen: dry run. With --write it would set size.expected_download_bytes for ${fetched.size} Combination(s) and append ${exclusions.length} Exclusion_Record(s):`);
    for (const e of exclusions) printLine(JSON.stringify(e));
  } else {
    if (fetched.size > 0) writeTextFileAtomic(deps.combinationsFile, withDownloadBytes(text, fetched));
    let wrote = 0;
    for (const e of exclusions) if (appendExclusionOnce(deps.exclusionsFile, e)) wrote += 1;
    printLine(`probe: screen: wrote size.expected_download_bytes for ${fetched.size} Combination(s) in ${path.basename(deps.combinationsFile)} and ${wrote} new Exclusion_Record(s)`);
  }
  if (report.fetchErrors.size > 0) {
    printErrorLine(`probe: screen: ${report.fetchErrors.size} tree(s) could not be read; those Combinations are not screened`);
    return 1;
  }
  return decided.length > 0 ? 1 : 0;
}

export async function screenCommand(argv: readonly string[], deps: ScreenDeps): Promise<number> {
  const parsed = parseScreenArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: screen: ${parsed.message}`);
    return 2;
  }
  return screenRun(deps, parsed.options);
}

export function defaultScreenDeps(repoDir: string): ScreenDeps {
  return {
    combinationsFile: path.join(repoDir, 'eval/probe/combinations.json'),
    exclusionsFile: path.join(repoDir, 'eval/results/exclusions.jsonl'),
    preflightDir: path.join(repoDir, 'eval/results/preflight'),
  };
}
