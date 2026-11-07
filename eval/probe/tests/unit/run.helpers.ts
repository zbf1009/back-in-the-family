// Test support for the run flow (task 13.2): a SYNTHETIC card set in a temp directory, a fake
// Runtime and output capture. The real eval/results, the real ledger and the real locked.jsonl are
// never touched: the "locked" split here is built from the dev lines with new IDs.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AdapterResult, Prompt, RequestOptions, RuntimeAdapter } from '../../src/adapters/interface.ts';
import { DEFAULT_CARDS_DIR } from '../../src/cards.ts';
import { RunLogger } from '../../src/run-logger.ts';
import { RuntimeLoadError, type RunDeps, type RuntimeFactory, type RuntimeHandle } from '../../src/run.ts';
import { parseCombinations, type Combination } from '../../src/phase.ts';
import { TEMPLATES_DIR, WARMUP_DIR } from '../../src/templates.ts';

export const REVISION = 'a'.repeat(40);

const realDevLines = readFileSync(path.join(DEFAULT_CARDS_DIR, 'cards', 'dev.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

function rowFor(lines: string[]): string {
  let d = 0;
  let s = 0;
  let z = 0;
  for (const l of lines) {
    const c = JSON.parse(l) as { task: string; scored: boolean };
    if (!c.scored) z++;
    else if (c.task === 'decision') d++;
    else s++;
  }
  return `${lines.length} | ${d} | ${s} | ${z}`;
}

export interface TestCards {
  readonly dir: string;
  readonly pinnedHash: string;
  readonly lockedIds: string[];
  readonly devIds: string[];
}

/** A temp Card_Set: the real dev lines, plus a synthetic "locked" split made from them (new IDs). */
export function makeCardSet(): TestCards {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-cards-'));
  mkdirSync(path.join(dir, 'cards'));
  cpSync(path.join(DEFAULT_CARDS_DIR, 'schemas'), path.join(dir, 'schemas'), { recursive: true });
  const dev = realDevLines;
  const lockedObjs = dev.map((l) => {
    const c = JSON.parse(l) as { id: string; split: string };
    // Synthetic IDs: the number part moves to 9xx, so no ID repeats a dev ID.
    return { ...c, id: c.id.replace(/-(\d{3})$/, (_m, n: string) => `-${900 + Number(n)}`), split: 'locked' };
  });
  const locked = lockedObjs.map((c) => JSON.stringify(c));
  writeFileSync(path.join(dir, 'cards', 'dev.jsonl'), dev.join('\n') + '\n');
  writeFileSync(path.join(dir, 'cards', 'locked.jsonl'), locked.join('\n') + '\n');
  writeFileSync(
    path.join(dir, 'LOCK.md'),
    '# Lock\n\n## Contents\n\n| Split | Cards | Scored D | Scored S | Sanity (unscored) | Scenario groups | Contrast pairs (D / S) | sha256 |\n|---|---|---|---|---|---|---|---|\n' +
      `| dev | ${rowFor(dev)} | 1 | x | \`h\` |\n| locked | ${rowFor(locked)} | 1 | x | \`h\` |\n` +
      '\n## Voided cards\n\n| Date | Card | Reason |\n|---|---|---|\n| none | | |\n',
  );
  const listed = ['LOCK.md', 'cards/dev.jsonl', 'cards/locked.jsonl', ...readdirSync(path.join(dir, 'schemas')).sort().map((n) => `schemas/${n}`)];
  const manifest = listed.map((rel) => `${sha256(readFileSync(path.join(dir, rel)))}  ${rel}\n`).join('');
  writeFileSync(path.join(dir, 'MANIFEST.sha256'), manifest);
  return {
    dir,
    pinnedHash: sha256(manifest),
    lockedIds: lockedObjs.map((c) => c.id),
    devIds: dev.map((l) => (JSON.parse(l) as { id: string }).id),
  };
}

export const FAKE_COMBO: Combination = parseCombinations(
  JSON.stringify([
    {
      id: 'fake/in-browser',
      runtime: 'fake-runtime',
      model_id: 'Fake-1B',
      quantization: 'q4',
      revision: REVISION,
      phase1_locked: true,
      sampling: { temperature: 0, top_p: null, seed: 7, max_output_tokens: { decision: 64, synthesis: 1024 } },
      chat_template_kwargs: { enable_thinking: false },
      constraint: 'json_schema',
    },
  ]),
)[0] as Combination;

export const WORKERS_COMBO: Combination = parseCombinations(
  JSON.stringify([
    {
      id: 'workers-ai/fake',
      runtime: 'workers-ai',
      model_id: '@cf/fake/model',
      quantization: 'unknown',
      revision: 'server-side, not pinnable',
      phase1_locked: false,
      response_shape: 'chat',
      prices: { input: 1000, output: 2000, source: 'test', read_on: '2026-11-07' },
      sampling: { temperature: 0, top_p: null, seed: 7, max_output_tokens: { decision: 64, synthesis: 1024 } },
      chat_template_kwargs: null,
      constraint: 'json_schema',
    },
  ]),
)[0] as Combination;

/** The answer a well-behaved model gives: the first listed option for D, an empty family answer for S. */
export function defaultAnswer(prompt: Prompt): string {
  const opt = /^- ([A-Za-z0-9_]+):/m.exec(prompt.user);
  if (opt !== null) return JSON.stringify({ option: opt[1] });
  const schema = /"const"\s*:\s*"([a-z_0-9]+)"/.exec(prompt.user);
  return JSON.stringify({ schema: schema?.[1] ?? 'x', items: [] });
}

export interface FakeRuntimeOptions {
  /** Result of the call with this 0-based index; default: a valid answer. */
  readonly script?: (index: number, prompt: Prompt, options: RequestOptions) => AdapterResult | Promise<AdapterResult>;
  /** After these call indices the adapter reports `stuck` until a rebuild finishes. */
  readonly stuckAfter?: readonly number[];
  /** The next `n` engine creates (rebuilds) fail. */
  readonly failRebuilds?: number;
  readonly loadError?: RuntimeLoadError;
}

export interface FakeRuntime {
  readonly factory: RuntimeFactory;
  /** Prompts sent to the Runtime, in order. */
  readonly calls: Prompt[];
  /** `load`, `create`, `warmup`, `dispose` in order. */
  readonly engine: string[];
}

export function createFakeRuntime(opts: FakeRuntimeOptions = {}): FakeRuntime {
  const calls: Prompt[] = [];
  const engine: string[] = [];
  let stuck = false;
  let rebuildFailures = opts.failRebuilds ?? 0;
  const factory: RuntimeFactory = async () => {
    const adapter: RuntimeAdapter = {
      identity: () => ({ runtime: 'fake-runtime', runtimeVersion: '1.0.0', modelId: 'Fake-1B', modelRevision: REVISION, quantization: 'q4' }),
      state: () => (stuck ? 'stuck' : 'idle'),
      async complete(prompt, options) {
        const index = calls.length;
        calls.push(prompt);
        const result = opts.script !== undefined ? await opts.script(index, prompt, options) : ({ kind: 'text', text: defaultAnswer(prompt), latencyMs: 5, usage: { inputTokens: 10, outputTokens: 4, reasoningTokens: null } } as AdapterResult);
        if (opts.stuckAfter?.includes(index) === true) stuck = true;
        return result;
      },
    };
    const handle: RuntimeHandle = {
      adapter,
      load: async () => {
        engine.push('load');
        if (opts.loadError !== undefined) throw opts.loadError;
      },
      lifecycle: {
        engine: {
          create: async () => {
            engine.push('create');
            if (rebuildFailures > 0) {
              rebuildFailures -= 1;
              throw new Error('engine create failed');
            }
          },
          generate: async () => {
            engine.push('warmup');
            return undefined;
          },
          dispose: () => {
            engine.push('dispose');
          },
        },
        onReady: () => {
          stuck = false;
        },
      },
    };
    return handle;
  };
  return { factory, calls, engine };
}

export interface TestEnv {
  readonly root: string;
  readonly cards: TestCards;
  readonly deps: (runtime: FakeRuntime, extra?: Partial<RunDeps>) => RunDeps;
  readonly tick: () => number;
}

/** Fresh temp repo (results, ledger, budget) over one synthetic card set. Time advances 1 s per call. */
export function makeEnv(cards: TestCards = makeCardSet()): TestEnv {
  const root = mkdtempSync(path.join(tmpdir(), 'run-repo-'));
  let t = Date.parse('2026-11-07T10:00:00.000Z');
  const tick = (): number => {
    t += 1000;
    return t;
  };
  return {
    root,
    cards,
    tick,
    deps: (runtime, extra = {}) => ({
      paths: {
        repoDir: root,
        cardsDir: cards.dir,
        resultsDir: path.join(root, 'eval/results'),
        ledger: path.join(root, 'eval/results/ledger.jsonl'),
        failures: path.join(root, 'eval/results/failures.jsonl'),
        exclusions: path.join(root, 'eval/results/exclusions.jsonl'),
        budgetFile: path.join(root, 'eval/results/budget/workers-ai.json'),
      },
      pinnedManifestHash: cards.pinnedHash,
      combinations: [FAKE_COMBO, WORKERS_COMBO],
      createRuntime: runtime.factory,
      now: tick,
      logger: new RunLogger(),
      ...extra,
    }),
  };
}

/** Runs `fn` while capturing everything written to stdout and stderr. */
export async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; out: string; err: string }> {
  let out = '';
  let err = '';
  const o = process.stdout.write;
  const e = process.stderr.write;
  // Only strings are captured (the sink writes strings); the test runner's own binary reports pass through.
  process.stdout.write = ((s: string | Uint8Array, ...rest: unknown[]) =>
    typeof s === 'string' ? ((out += s), true) : (o as (...a: unknown[]) => boolean).call(process.stdout, s, ...rest)) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array, ...rest: unknown[]) =>
    typeof s === 'string' ? ((err += s), true) : (e as (...a: unknown[]) => boolean).call(process.stderr, s, ...rest)) as typeof process.stderr.write;
  try {
    const value = await fn();
    return { value, out, err };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

/** A copy of the committed templates directory, optionally with one file rewritten. */
export function templatesCopy(rewrite?: { file: string; map: (text: string) => string }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-tpl-'));
  cpSync(TEMPLATES_DIR, dir, { recursive: true });
  if (rewrite !== undefined) {
    const f = path.join(dir, rewrite.file);
    writeFileSync(f, rewrite.map(readFileSync(f, 'utf8')));
  }
  return dir + path.sep;
}

export { TEMPLATES_DIR, WARMUP_DIR };
