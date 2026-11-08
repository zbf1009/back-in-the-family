// VRAM_Preflight and the `preflight` command (llm-probe task 16.9; R9.3, R9.9, R9.10, R9.16, R9.17).
//
// For one transformers.js Combination, on the Target_Machine: load the pinned model on WebGPU in a
// Fresh_Profile, send ONE fixed synthetic prompt that is not built from any Card, generate exactly 1,024
// tokens with the end-of-sequence stop suppressed (`min_new_tokens` = `max_new_tokens` = 1,024; the only place
// that parameter is ever sent), and record the NVIDIA sampler peak (peak minus idle baseline, MiB).
//
//   - writes `eval/results/preflight/<combo>.json` (`llm-probe-preflight-v1`), never a Results record;
//   - writes an Exclusion_Record (`exclusions.jsonl`) when the model fails to load on WebGPU, runs out of
//     memory, or peaks above 2,600 MiB (R9.10, R9.17).
//
// The only card content read is the Dev_Cards, to render them and find the longest prompt (the length rule,
// R9.16): L = max(8,000, 2 x the longest rendered Dev_Card prompt over all Permutations) bytes. The Locked_Card
// prompts are never rendered. The synthetic prompt is rendered from an invented Frozen_Context (8 events,
// 6 persons, IDs that are not in the Card_Set) with the real synthesis template, then padded with fixed filler.
//
// Everything that touches the machine is behind `PreflightSession` (the real one is `BrowserSession`), so the
// unit tests run this offline.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AdapterInfo } from './adapters/gpu.ts';
import type { Prompt } from './adapters/interface.ts';
import { splitCpuNodes, type Placement } from './adapters/placement.ts';
import { loadCards } from './cards.ts';
import { BrowserLoadError, BrowserSession, OOM, type LoadFailureCode, type PrepareResult, type PreflightMeasurement } from './browser/driver.ts';
import { fingerprintOf } from './browser/factory.ts';
import type { Combination } from './phase.ts';
import { REVISION_RE, VRAM_LIMIT_MIB } from './screen.ts';
import {
  SCHEMA,
  appendExclusionOnce,
  appendPreflightAttempt,
  writePreflight,
  type ExclusionRecord,
  type JsonObject,
  type JsonValue,
  type PreflightRecord,
} from './results.ts';
import { RunLogger } from './run-logger.ts';
import { buildPlan, loadSchemas, loadTemplates, renderPlan, runManifestCheck, type RunDeps } from './run.ts';
import { wasmSha256, llmRenderPrompt } from './simwasm.ts';
import { printErrorLine, printLine } from './sink.ts';

// ---------------------------------------------------------------- fixed parameters (design: VRAM_Preflight)

export const PREFLIGHT_MAX_NEW_TOKENS = 1024;
/** Equal to the maximum: the EOS stop is suppressed and exactly 1,024 tokens are generated. Used here only. */
export const PREFLIGHT_MIN_NEW_TOKENS = 1024;
export const PREFLIGHT_LENGTH_FLOOR_BYTES = 8000;
export const PREFLIGHT_LENGTH_FACTOR = 2;
/** 1,024 tokens at a few tokens a second on a laptop GPU take minutes; this is the page timer, not a result. */
export const PREFLIGHT_TIMEOUT_MS = 900_000;
/** Total memory of the Target_Machine's NVIDIA card, and the headroom below which the absolute peak is flagged. */
export const CARD_TOTAL_MIB = 4096;
export const LOW_HEADROOM_MIB = 300;
/** An idle spread or run-time dip larger than this means other processes were moving memory: repeat once. */
export const NOISE_MIB = 150;

/**
 * The hybrid-GPU facts of one measurement: baseline and idle spread, absolute peak against the card, and the
 * other processes on the card. `flags` names every condition worth a line in the log.
 */
export function memoryDetail(m: PreflightMeasurement): JsonObject {
  const mem = m.memory as Record<string, unknown>;
  const num = (k: string): number | null => (typeof mem[k] === 'number' ? (mem[k] as number) : null);
  const baseline = num('baseline_mib');
  const idleMin = num('idle_min_mib');
  const idleMax = num('idle_max_mib');
  const runMin = num('run_min_mib');
  const abs = num('absolute_peak_mib');
  const flags: string[] = [];
  if (abs !== null && abs > CARD_TOTAL_MIB) flags.push(`absolute peak ${abs} MiB exceeds the card's ${CARD_TOTAL_MIB} MiB`);
  else if (abs !== null && CARD_TOTAL_MIB - abs < LOW_HEADROOM_MIB) flags.push(`absolute peak ${abs} MiB leaves ${CARD_TOTAL_MIB - abs} MiB headroom (< ${LOW_HEADROOM_MIB})`);
  if (idleMin !== null && idleMax !== null && idleMax - idleMin > NOISE_MIB) flags.push(`idle baseline drifted ${idleMax - idleMin} MiB (> ${NOISE_MIB})`);
  if (baseline !== null && runMin !== null && baseline - runMin > NOISE_MIB) flags.push(`memory.used fell ${baseline - runMin} MiB below the baseline during the run (> ${NOISE_MIB}): other processes freed memory, so the delta may be understated`);
  const o = m.otherProcesses;
  // Names only: the first two words of the command line (no flags, no profile paths).
  const proc = (p: { pid: number; type: string | null; name: string; mib: number | null }): JsonObject => ({ pid: p.pid, type: p.type, name: p.name.split(/\s+/).slice(0, 2).join(' '), mib: p.mib });
  return {
    baseline_mib: baseline,
    idle_min_mib: idleMin,
    idle_max_mib: idleMax,
    idle_samples: num('idle_samples'),
    run_min_mib: runMin,
    absolute_peak_mib: abs,
    card_total_mib: CARD_TOTAL_MIB,
    other_processes: o === undefined ? null : { card_before: o.card, compute_apps: o.compute_apps.map(proc), table: o.table.map(proc) },
    memory_flags: flags,
    diagnostics: m.diagnostics === undefined ? null : { ...m.diagnostics, model_files: [...m.diagnostics.model_files] },
  };
}

// ---------------------------------------------------------------- the prompt

export const promptBytes = (p: Prompt): number => Buffer.byteLength(p.system, 'utf8') + Buffer.byteLength(p.user, 'utf8');

/** L = max(8,000, 2 x the longest rendered Dev_Card prompt) (R9.16). */
export const preflightLength = (longestDevPromptBytes: number): number =>
  Math.max(PREFLIGHT_LENGTH_FLOOR_BYTES, PREFLIGHT_LENGTH_FACTOR * longestDevPromptBytes);

/**
 * The invented Frozen_Context: a grudge-detection synthesis context with 6 persons (IDs 9701 to 9706) and 8 events
 * (e9701 to e9708), none of which occur in the Card_Set. Valid for `llm_render_prompt`: events are sorted by tick,
 * actors follow the order the template documents (lender before borrower, promisor before promisee, ...).
 */
export function syntheticFrozenContext(): JsonObject {
  const traits = (t: Partial<Record<'greed' | 'loyalty' | 'pride' | 'warmth' | 'temper' | 'vindictiveness' | 'piety', number>>): JsonObject => ({
    greed: 0,
    loyalty: 0,
    pride: 0,
    warmth: 0,
    temper: 0,
    vindictiveness: 0,
    piety: 0,
    ...t,
  });
  const person = (id: number, name: string, age: number, sex: 'female' | 'male', wealth: number, t: JsonObject): JsonObject => ({
    id,
    name,
    age,
    sex,
    alive: true,
    origin: 'native',
    traits: t,
    wealth,
    soul_id: `S-${id}`,
  });
  const event = (id: number, tick: number, type: string, actors: number[], magnitude: number, caused_by: string[], tags: string[], due_tick?: number): JsonObject => ({
    id: `e${id}`,
    tick,
    type,
    actors,
    magnitude,
    caused_by,
    tags,
    ...(due_tick === undefined ? {} : { due_tick }),
  });
  return {
    task: 'synthesis',
    family: 'grudge_detection',
    output_schema: 'grudge_v1',
    tick: 5200,
    subject: null,
    people: [
      person(9701, 'Orla Finch', 52, 'female', 4100, traits({ greed: 1, pride: 2, vindictiveness: 1 })),
      person(9702, 'Dov Lintel', 47, 'male', 900, traits({ temper: 2, loyalty: -1 })),
      person(9703, 'Marta Quill', 39, 'female', 2300, traits({ warmth: 2, piety: 1 })),
      person(9704, 'Teague Rowan', 61, 'male', 15000, traits({ greed: 2, pride: 1 })),
      person(9705, 'Ines Pell', 28, 'female', 300, traits({ temper: 1, vindictiveness: 2 })),
      person(9706, 'Corin Ashby', 34, 'male', 1200, traits({ loyalty: 2, warmth: 1 })),
    ],
    relations: [
      { from: 9701, to: 9702, affinity: -30, trust: -45, tags: ['neighbor'] },
      { from: 9702, to: 9701, affinity: -20, trust: -10, tags: ['neighbor'] },
      { from: 9703, to: 9704, affinity: 40, trust: 35, tags: ['parent'] },
      { from: 9705, to: 9701, affinity: -60, trust: -50, tags: ['rival'] },
      { from: 9706, to: 9702, affinity: 55, trust: 60, tags: ['friend'] },
      { from: 9706, to: 9704, affinity: 10, trust: 20, tags: ['employer'] },
    ],
    events: [
      event(9701, 4800, 'loan', [9701, 9702], 300, [], ['verbal', 'cash'], 5000),
      event(9702, 4900, 'repayment', [9702, 9701], 120, ['e9701'], ['cash', 'partial']),
      event(9703, 4950, 'promise', [9703, 9704], 0, [], ['verbal', 'witnessed']),
      event(9704, 5000, 'insult', [9705, 9701], 40, [], ['public']),
      event(9705, 5050, 'help', [9704, 9703], 30, ['e9703'], ['private']),
      event(9706, 5100, 'gift', [9706, 9702], 25, [], ['private']),
      event(9707, 5150, 'quarrel', [9701, 9705], 60, ['e9704'], ['public', 'witnessed']),
      event(9708, 5180, 'apology', [9705, 9701], 25, ['e9707'], ['verbal']),
    ],
    situation: 'Orla Finch lent Dov Lintel money and is still owed part of it. Ines Pell and Orla Finch have quarrelled in public.',
    player_input: null,
  };
}

const FILLER = 'Town ledger note: a routine entry with no bearing on the people or events above; ignore it.';

/** Appends fixed filler lines to the user text until the prompt is at least `minBytes` long. Deterministic. */
export function padPrompt(base: Prompt, minBytes: number): Prompt {
  if (!Number.isSafeInteger(minBytes) || minBytes < 0) throw new Error(`padPrompt: bad length ${minBytes}`);
  let user = base.user;
  if (promptBytes({ system: base.system, user }) >= minBytes) return base;
  user += '\nRoutine town ledger notes (not part of the facts):';
  for (let n = 1; promptBytes({ system: base.system, user }) < minBytes; n++) user += `\nNote ${n}: ${FILLER}`;
  return { system: base.system, user };
}

export interface PreflightPrompt {
  readonly prompt: Prompt;
  /** UTF-8 bytes of system + user, the same measure the length rule uses. */
  readonly bytes: number;
  /** L, the minimum length the rule demanded. */
  readonly targetBytes: number;
  readonly longestDevPromptBytes: number;
  readonly eventCount: number;
  readonly personCount: number;
  readonly sha256: string;
}

/** The synthetic prompt for a given longest Dev_Card prompt length. `renderSynthetic` is Sim_Wasm's `llm_render_prompt`. */
export function buildPreflightPrompt(a: {
  readonly longestDevPromptBytes: number;
  readonly synthesisTemplate: string;
  readonly schemaText: string;
  readonly render?: (input: string) => string;
}): PreflightPrompt {
  const context = syntheticFrozenContext();
  const render = a.render ?? ((input: string): string => llmRenderPrompt(input));
  const env = JSON.parse(render(JSON.stringify({ frozen_context: context, template: a.synthesisTemplate, schema_text: a.schemaText, permutation: 'base' }))) as {
    ok?: boolean;
    system?: string;
    user?: string;
    error?: { message?: string };
  };
  if (env.ok !== true || typeof env.system !== 'string' || typeof env.user !== 'string') {
    throw new Error(`the synthetic Frozen_Context did not render: ${env.error?.message ?? 'render error'}`);
  }
  const targetBytes = preflightLength(a.longestDevPromptBytes);
  const prompt = padPrompt({ system: env.system, user: env.user }, targetBytes);
  const people = context['people'] as JsonValue[];
  const events = context['events'] as JsonValue[];
  return {
    prompt,
    bytes: promptBytes(prompt),
    targetBytes,
    longestDevPromptBytes: a.longestDevPromptBytes,
    eventCount: events.length,
    personCount: people.length,
    sha256: createHash('sha256').update(`${prompt.system}\n${prompt.user}`).digest('hex'),
  };
}

// ---------------------------------------------------------------- judging one attempt

export type PreflightAttempt =
  | { readonly kind: 'load_failed'; readonly code: LoadFailureCode; readonly message: string }
  | { readonly kind: 'measured'; readonly measurement: PreflightMeasurement }
  /** The session could not start, or the browser step threw something that is not a load failure. */
  | { readonly kind: 'session_failed'; readonly message: string };

export interface JudgeInput {
  readonly combo: Combination;
  readonly at: string;
  readonly prompt: PreflightPrompt;
  readonly attempt: PreflightAttempt;
  readonly versions: JsonObject;
  /** Browser block of the fingerprint (`fingerprintOf`), for the record. */
  readonly browser: JsonObject;
  /** `chat_template_kwargs` and the other adapter facts from the page. */
  readonly adapterFacts: JsonObject;
  readonly adapter: AdapterInfo | null;
}

/**
 * `pass` and `excluded` are verdicts on the model; `no_verdict` means the attempt says nothing about the model
 * (environment failure, no NVIDIA reading, a generation failure that is not out of memory). Every attempt yields
 * a record (Author, 2026-11-07): nothing is silent.
 */
export type PreflightVerdictKind = 'pass' | 'excluded' | 'no_verdict';

export interface PreflightVerdict {
  readonly kind: 'record';
  readonly verdict: PreflightVerdictKind;
  readonly record: PreflightRecord;
  readonly exclusion: ExclusionRecord | null;
}

const ENVIRONMENT_CODES: readonly LoadFailureCode[] = ['gpu_unavailable', 'software_adapter'];

/**
 * A fetch that died on the wire (`TypeError: network error`, `Failed to fetch`, a reset or timed-out connection)
 * says nothing about the model: the weights never arrived. Such a load failure is a `no_verdict` record, never an
 * exclusion (Author, 2026-11-07, after a transient error wrongly excluded Qwen3.5-2B).
 */
const TRANSIENT_NETWORK_RE = /network error|failed to fetch|networkerror|net::err_|econnreset|etimedout|enotfound|eai_again|socket hang up/i;
export const isTransientNetworkError = (message: string): boolean => TRANSIENT_NETWORK_RE.test(message);

const placementJson = (p: Placement | null): JsonValue =>
  p === null ? null : { method: p.method, cpu_nodes: p.cpu_nodes.map((n) => ({ op_type: n.op_type, count: n.count })) };

/** The full CPU-node list in two classes (Author, 2026-11-07): shape computation vs compute operators such as `Scan`. */
function cpuClasses(p: Placement | null): JsonObject {
  if (p === null) return {};
  const { shape, compute } = splitCpuNodes(p.cpu_nodes);
  const j = (ns: readonly { op_type: string; count: number }[]): JsonValue => ns.map((n) => ({ op_type: n.op_type, count: n.count }));
  return { cpu_nodes_shape: j(shape), cpu_nodes_compute: j(compute) };
}

/** Hash of the session options shared by the placement and measured sessions, from the page's placement check. */
function placementCheckFacts(facts: JsonObject): JsonObject {
  const c = facts['placement_check'];
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return { placement_options_sha256: null, placement_options_match: null };
  const o = c as JsonObject;
  const probe = typeof o['probe_sha256'] === 'string' ? o['probe_sha256'] : null;
  const measured = typeof o['measured_sha256'] === 'string' ? o['measured_sha256'] : null;
  return { placement_options_sha256: probe, placement_options_match: probe !== null && measured !== null ? probe === measured : null };
}

/**
 * Decides what one attempt records. Exclusion (R9.10): the model did not load on WebGPU (load failure, not on the
 * WebGPU provider, or no placement log), the peak is above 2,600 MiB, or generation failed by running out of memory
 * (the page error or a console line matching `OOM`). Anything else that fails is a `no_verdict` record with the
 * raw error text, so a rerun is possible and nothing is lost.
 */
export function judgePreflight(i: JudgeInput): PreflightVerdict {
  const exclusion = (check: ExclusionRecord['check'], value: number | string, limit: number | string | null): ExclusionRecord => ({
    schema: SCHEMA.exclusion,
    combination: i.combo.id,
    model: i.combo.model_id,
    check,
    value,
    limit,
    at: i.at,
  });
  const base = {
    schema: SCHEMA.preflight,
    combination: i.combo.id,
    model_id: i.combo.model_id,
    runtime: i.combo.runtime,
    revision: i.combo.revision,
    prompt_bytes: i.prompt.bytes,
    prompt_target_bytes: i.prompt.targetBytes,
    longest_dev_prompt_bytes: i.prompt.longestDevPromptBytes,
    prompt_sha256: i.prompt.sha256,
    event_count: i.prompt.eventCount,
    person_count: i.prompt.personCount,
    max_new_tokens: PREFLIGHT_MAX_NEW_TOKENS,
    min_new_tokens: PREFLIGHT_MIN_NEW_TOKENS,
    eos_disabled: true as const,
    versions: i.versions,
    browser: i.browser,
    adapter: i.adapter === null ? null : { ...i.adapter },
    adapter_facts: i.adapterFacts,
    at: i.at,
  };
  const out = (verdict: PreflightVerdictKind, rec: typeof base & { new_tokens: number } & JsonObject, ex: ExclusionRecord | null): PreflightVerdict => ({
    kind: 'record',
    verdict,
    record: { ...rec, verdict } satisfies PreflightRecord,
    exclusion: ex,
  });
  const notStarted = { ...base, new_tokens: 0, peak_vram_mib: null, loaded_on_webgpu: false, placement: null, generation: 'not_started' };

  const a = i.attempt;
  if (a.kind === 'session_failed') return out('no_verdict', { ...notStarted, error: `session_failed: ${a.message}` }, null);
  if (a.kind === 'load_failed') {
    const rec = { ...notStarted, error: `${a.code}: ${a.message}` };
    if (ENVIRONMENT_CODES.includes(a.code) || (a.code === 'model_load_failed' && isTransientNetworkError(a.message))) return out('no_verdict', rec, null);
    return out('excluded', rec, exclusion('preflight_load', a.code, 'loaded on WebGPU'));
  }

  const m = a.measurement;
  const peak = m.memory.gpu === 'nvidia' ? m.memory.peak_mib : null;
  let generationError: string | null = null;
  if (!m.run.ok) generationError = m.run.error;
  else if (!m.run.view.reached_limit) {
    const o = m.run.view.outcome;
    generationError = o.kind === 'error' ? `${o.code}: ${o.detail}` : `generation stopped before ${PREFLIGHT_MAX_NEW_TOKENS} tokens (${o.kind}); the end-of-sequence stop was not suppressed`;
  }
  const common = {
    ...base,
    peak_vram_mib: peak,
    memory_quantity: m.memory.quantity,
    ...memoryDetail(m),
    loaded_on_webgpu: true,
    placement: placementJson(m.placement),
    ...cpuClasses(m.placement),
    ...placementCheckFacts(i.adapterFacts),
  };
  if (peak === null) {
    const why = `no NVIDIA memory reading (${m.memory.reason ?? 'unknown reason'}); the peak cannot be established`;
    return out('no_verdict', { ...common, new_tokens: 0, generation: generationError === null ? 'completed' : 'failed', error: generationError === null ? why : `${why}; ${generationError}` }, null);
  }
  if (generationError !== null) {
    const oom = OOM.test(generationError);
    // The raw text stays in `error`; `failure_class` says which kind it was (a console OOM line is part of the text).
    const rec = { ...common, new_tokens: 0, generation: 'failed', error: generationError, failure_class: oom ? 'out_of_memory' : 'runtime_error' };
    if (!oom && peak <= VRAM_LIMIT_MIB) return out('no_verdict', rec, null);
    return out('excluded', rec, exclusion('preflight_vram', peak > VRAM_LIMIT_MIB ? peak : `out of memory during generation (peak ${peak} MiB so far)`, VRAM_LIMIT_MIB));
  }
  const rec = { ...common, new_tokens: PREFLIGHT_MAX_NEW_TOKENS, generation: 'completed', error: null, latency_ms: m.run.ok ? m.run.view.latency_ms : null };
  return peak > VRAM_LIMIT_MIB ? out('excluded', rec, exclusion('preflight_vram', peak, VRAM_LIMIT_MIB)) : out('pass', rec, null);
}

// ---------------------------------------------------------------- the command

/** The part of `BrowserSession` the preflight uses; tests give a fake. */
export interface PreflightSession {
  prepare(): Promise<PrepareResult>;
  preflight(prompt: Prompt, o: { readonly maxNewTokens: number; readonly minNewTokens: number; readonly timeoutMs: number }): Promise<PreflightMeasurement>;
  close(): Promise<void>;
  readonly adapterInfo: AdapterInfo | null;
  readonly userAgentString: string;
  readonly fingerprintExtras: JsonObject | null;
}

export interface PreflightDeps extends Pick<RunDeps, 'paths' | 'pinnedManifestHash' | 'combinations'> {
  readonly engineVersions: { readonly transformers: string };
  /** Opens the Fresh_Profile session of one Combination. Default: `BrowserSession` on `sessionDeps`. */
  readonly openSession: (combo: Combination) => Promise<PreflightSession>;
  /** Reads `schemas/<name>.json` (a schema, not a card). Default: the file under `paths.cardsDir`. */
  readonly readSchema?: (name: string) => string;
  /** Milliseconds since the epoch. */
  readonly now?: () => number;
  readonly logger?: RunLogger;
}

/** `eval/results/preflight/<combo>.json`; `/` in the Combination ID becomes `__`. */
export const preflightFileName = (comboId: string): string => `${comboId.replace(/[^A-Za-z0-9._-]/g, '__')}.json`;
export const preflightPath = (resultsDir: string, comboId: string): string => path.join(resultsDir, 'preflight', preflightFileName(comboId));
/** Every attempt, with its verdict (`pass`, `excluded`, `no_verdict`); the report reads only `<combo>.json`. */
export const attemptsPath = (resultsDir: string): string => path.join(resultsDir, 'preflight', 'attempts.jsonl');

export interface PreflightOptions {
  readonly combo: string;
  /** Replace an existing preflight file of the Combination. */
  readonly force?: boolean;
}

export function parsePreflightArgs(argv: readonly string[]): { readonly ok: true; readonly options: PreflightOptions } | { readonly ok: false; readonly message: string } {
  try {
    const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { combo: { type: 'string' }, force: { type: 'boolean' } } });
    if (positionals.length > 0) return { ok: false, message: `unexpected argument "${positionals[0]}"` };
    if (values.combo === undefined || values.combo === '') return { ok: false, message: '--combo <id> is required' };
    return { ok: true, options: { combo: values.combo, ...(values.force === true ? { force: true } : {}) } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Finds L's input: the longest rendered Dev_Card prompt over all Permutations. Reads only `dev.jsonl`. */
export function longestDevPromptBytes(deps: Pick<PreflightDeps, 'paths'>, combo: Combination): number {
  const cards = loadCards({ cardsDir: deps.paths.cardsDir, splits: ['dev'] }).cards.dev;
  const templates = loadTemplates(deps.paths);
  const plan = buildPlan(cards, ['decision', 'synthesis']);
  const rendered = renderPlan(plan, templates, loadSchemas(deps.paths.cardsDir, plan), combo);
  if (rendered.errors.length > 0) throw new Error(`${rendered.errors.length} Dev_Card prompt(s) did not render, so the length rule cannot be applied`);
  return Math.max(0, ...plan.map((p) => (p.prompt === null ? 0 : promptBytes(p.prompt))));
}

const fail = (message: string): number => {
  printErrorLine(`probe: preflight: ${message}`);
  return 1;
};

/** Runs the VRAM_Preflight for one Combination. Returns the exit code (0 only when a passing record was written). */
export async function preflightRun(deps: PreflightDeps, opts: PreflightOptions): Promise<number> {
  const logger = deps.logger ?? new RunLogger();
  const nowMs = (): number => (deps.now ?? Date.now)();
  let session: PreflightSession | null = null;
  try {
    const combo = deps.combinations.find((c) => c.id === opts.combo);
    if (combo === undefined) return fail(`unknown Combination "${opts.combo}"`);
    if (combo.runtime !== 'transformers.js') {
      return fail(`${combo.id} is a ${combo.runtime} Combination; the VRAM_Preflight is for transformers.js candidates (a WebLLM model lists vram_required_MB)`);
    }
    if (!REVISION_RE.test(combo.revision)) return fail(`${combo.id} has no Pinned_Revision (revision is "${combo.revision}"); pin it first`);
    const file = preflightPath(deps.paths.resultsDir, combo.id);
    if (fs.existsSync(file) && opts.force !== true) return fail(`${path.relative(deps.paths.repoDir, file)} already exists (use --force to replace it)`);

    // The Dev_Cards are read to apply the length rule, so the Manifest_Check comes first (R1.1).
    await runManifestCheck(deps, logger);
    const longest = longestDevPromptBytes(deps, combo);
    const templates = loadTemplates(deps.paths);
    const readSchema = deps.readSchema ?? ((name: string): string => fs.readFileSync(path.join(deps.paths.cardsDir, 'schemas', `${name}.json`), 'utf8'));
    const prompt = buildPreflightPrompt({ longestDevPromptBytes: longest, synthesisTemplate: templates.texts.synthesis.text, schemaText: readSchema('grudge_v1') });
    printLine(
      `probe: preflight: ${combo.id}: prompt ${prompt.bytes} bytes (rule L = max(${PREFLIGHT_LENGTH_FLOOR_BYTES}, ${PREFLIGHT_LENGTH_FACTOR} x ${longest}) = ${prompt.targetBytes}), ${prompt.eventCount} events, ${prompt.personCount} persons; ${PREFLIGHT_MAX_NEW_TOKENS} new tokens, EOS stop suppressed`,
    );

    session = await deps.openSession(combo);
    const prepared = await session.prepare();

    let attempt: PreflightAttempt;
    if (!prepared.ok) attempt = { kind: 'session_failed', message: `the browser session could not start: ${prepared.failure.reason}: ${prepared.failure.detail}` };
    else {
      try {
        const measurement = await session.preflight(prompt.prompt, { maxNewTokens: PREFLIGHT_MAX_NEW_TOKENS, minNewTokens: PREFLIGHT_MIN_NEW_TOKENS, timeoutMs: PREFLIGHT_TIMEOUT_MS });
        attempt = { kind: 'measured', measurement };
      } catch (e) {
        attempt = e instanceof BrowserLoadError ? { kind: 'load_failed', code: e.code, message: e.message } : { kind: 'session_failed', message: e instanceof Error ? e.message : String(e) };
      }
    }

    const fp = fingerprintOf(session, combo);
    const verdict = judgePreflight({
      combo,
      at: new Date(nowMs()).toISOString(),
      prompt,
      attempt,
      versions: {
        transformers: deps.engineVersions.transformers,
        browser: ((fp['browser'] ?? null) as { version?: JsonValue } | null)?.version ?? null,
        sim_wasm_sha256: wasmSha256,
        synthesis_template_sha256: templates.hashes.synthesis,
      },
      browser: (fp['browser'] ?? null) as JsonObject,
      adapterFacts: session.fingerprintExtras ?? {},
      adapter: session.adapterInfo,
    });

    // Every attempt is appended to preflight/attempts.jsonl; only a verdict on the model gets the <combo>.json file.
    const attempts = attemptsPath(deps.paths.resultsDir);
    appendPreflightAttempt(attempts, verdict.record);
    const r = verdict.record;
    if (verdict.verdict === 'no_verdict') {
      return fail(`no verdict on the model, attempt recorded in ${path.relative(deps.paths.repoDir, attempts)}: ${String(r['error'])}`);
    }
    writePreflight(file, verdict.record, opts.force === true);
    printLine(
      `probe: preflight: ${combo.id}: loaded on WebGPU ${r['loaded_on_webgpu'] === true ? 'yes' : 'no'}, peak VRAM ${r['peak_vram_mib'] ?? 'unknown'} MiB (limit ${VRAM_LIMIT_MIB}), written ${path.relative(deps.paths.repoDir, file)}`,
    );
    const flags = r['memory_flags'];
    if (Array.isArray(flags)) for (const f of flags) printErrorLine(`probe: preflight: ${combo.id}: NOTE ${String(f)}`);
    printLine(
      `probe: preflight: ${combo.id}: baseline ${r['baseline_mib'] ?? '?'} MiB (idle ${r['idle_min_mib'] ?? '?'}..${r['idle_max_mib'] ?? '?'}), absolute peak ${r['absolute_peak_mib'] ?? '?'} MiB of ${CARD_TOTAL_MIB}`,
    );
    if (verdict.exclusion !== null) {
      const wrote = appendExclusionOnce(deps.paths.exclusions, verdict.exclusion);
      printErrorLine(`probe: preflight: ${combo.id}: EXCLUDED (${verdict.exclusion.check}: ${verdict.exclusion.value}, limit ${verdict.exclusion.limit})${wrote ? '' : ' [already in exclusions.jsonl]'}`);
      return 1;
    }
    return 0;
  } catch (e) {
    return fail(`${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await session?.close();
  }
}

/** `probe preflight --combo <id> [--force]`. */
export async function preflightCommand(argv: readonly string[], deps: PreflightDeps): Promise<number> {
  const parsed = parsePreflightArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: preflight: ${parsed.message}`);
    return 2;
  }
  return preflightRun(deps, parsed.options);
}

/** Default wiring: the real session on system Chrome, the repository paths and the pinned engine versions. */
export async function defaultPreflightDeps(repoDir: string): Promise<PreflightDeps> {
  const { defaultRunDeps, readEngineVersions } = await import('./run-command.ts');
  const { realSessionDeps } = await import('./browser/driver.ts');
  const run = defaultRunDeps(repoDir);
  const distDir = path.join(repoDir, 'eval/probe/dist');
  return {
    paths: run.paths,
    pinnedManifestHash: run.pinnedManifestHash,
    combinations: run.combinations,
    engineVersions: readEngineVersions(repoDir),
    openSession: async (combo) => new BrowserSession(await realSessionDeps(distDir), combo, 'dev'),
  };
}

