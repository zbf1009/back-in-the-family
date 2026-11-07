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
import type { Placement } from './adapters/placement.ts';
import { loadCards } from './cards.ts';
import { BrowserLoadError, BrowserSession, OOM, type LoadFailureCode, type PrepareResult, type PreflightMeasurement } from './browser/driver.ts';
import { fingerprintOf } from './browser/factory.ts';
import type { Combination } from './phase.ts';
import { REVISION_RE, VRAM_LIMIT_MIB } from './screen.ts';
import {
  SCHEMA,
  appendExclusionOnce,
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
  | { readonly kind: 'measured'; readonly measurement: PreflightMeasurement };

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

export type PreflightVerdict =
  | { readonly kind: 'record'; readonly record: PreflightRecord; readonly exclusion: ExclusionRecord | null }
  /** Nothing is recorded: the environment failed or the measurement is unusable, not the model. */
  | { readonly kind: 'no_record'; readonly reason: string };

const ENVIRONMENT_CODES: readonly LoadFailureCode[] = ['gpu_unavailable', 'software_adapter'];

const placementJson = (p: Placement | null): JsonValue =>
  p === null ? null : { method: p.method, cpu_nodes: p.cpu_nodes.map((n) => ({ op_type: n.op_type, count: n.count })) };

/**
 * Decides what one attempt records. Exclusion (R9.10): the model did not load on WebGPU (load failure, not on the
 * WebGPU provider, or no placement log), the peak is above 2,600 MiB, or generation failed by running out of memory.
 * A failure that says nothing about the model (no hardware GPU, no NVIDIA reading, a generation that stopped early
 * for another reason) records nothing, so a rerun is possible and the screen does not see a half result.
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

  const a = i.attempt;
  if (a.kind === 'load_failed') {
    if (ENVIRONMENT_CODES.includes(a.code)) return { kind: 'no_record', reason: `${a.code}: ${a.message}` };
    const record: PreflightRecord = {
      ...base,
      new_tokens: 0,
      peak_vram_mib: null,
      loaded_on_webgpu: false,
      placement: null,
      generation: 'not_started',
      error: `${a.code}: ${a.message}`,
    };
    return { kind: 'record', record, exclusion: exclusion('preflight_load', a.code, 'loaded on WebGPU') };
  }

  const m = a.measurement;
  const peak = m.memory.gpu === 'nvidia' ? m.memory.peak_mib : null;
  if (peak === null) {
    return { kind: 'no_record', reason: `no NVIDIA memory reading (${m.memory.reason ?? 'unknown reason'}); the peak cannot be established` };
  }
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
    loaded_on_webgpu: true,
    placement: placementJson(m.placement),
  };
  if (generationError !== null) {
    const oom = OOM.test(generationError);
    if (!oom && peak <= VRAM_LIMIT_MIB) return { kind: 'no_record', reason: `generation did not complete: ${generationError}` };
    const record: PreflightRecord = { ...common, new_tokens: 0, generation: 'failed', error: generationError };
    return {
      kind: 'record',
      record,
      exclusion: exclusion('preflight_vram', peak > VRAM_LIMIT_MIB ? peak : `out of memory during generation (peak ${peak} MiB so far)`, VRAM_LIMIT_MIB),
    };
  }
  const record: PreflightRecord = {
    ...common,
    new_tokens: PREFLIGHT_MAX_NEW_TOKENS,
    generation: 'completed',
    error: null,
    latency_ms: m.run.ok ? m.run.view.latency_ms : null,
  };
  return { kind: 'record', record, exclusion: peak > VRAM_LIMIT_MIB ? exclusion('preflight_vram', peak, VRAM_LIMIT_MIB) : null };
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
    if (!prepared.ok) return fail(`the browser session could not start: ${prepared.failure.reason}: ${prepared.failure.detail}`);

    let attempt: PreflightAttempt;
    try {
      const measurement = await session.preflight(prompt.prompt, { maxNewTokens: PREFLIGHT_MAX_NEW_TOKENS, minNewTokens: PREFLIGHT_MIN_NEW_TOKENS, timeoutMs: PREFLIGHT_TIMEOUT_MS });
      attempt = { kind: 'measured', measurement };
    } catch (e) {
      if (!(e instanceof BrowserLoadError)) throw e;
      attempt = { kind: 'load_failed', code: e.code, message: e.message };
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

    if (verdict.kind === 'no_record') return fail(`nothing recorded: ${verdict.reason}`);
    writePreflight(file, verdict.record, opts.force === true);
    const r = verdict.record;
    printLine(
      `probe: preflight: ${combo.id}: loaded on WebGPU ${r['loaded_on_webgpu'] === true ? 'yes' : 'no'}, peak VRAM ${r['peak_vram_mib'] ?? 'unknown'} MiB (limit ${VRAM_LIMIT_MIB}), written ${path.relative(deps.paths.repoDir, file)}`,
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

