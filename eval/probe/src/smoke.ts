// `smoke --combo <id> [--count N] [--timeout-ms N] [--max-tokens N] [--diagnose]` (llm-probe task 17.4; R11.5-R11.8,
// R11.19, R11.20, R18.1, R18.3, R18.4, R18.6; design "Smoke_Call" and "Response_Shape check").
//
// A Smoke_Call is one Workers AI request on a Dev_Card. It confirms connectivity, the declared Response_Shape,
// the output-token parameter and that reasoning text stays out of the content field. Rules this file keeps:
//   - Workers AI Combinations only. A browser Combination is refused before anything is read or sent.
//   - Manifest_Check first, then only the Dev_Cards are loaded (`splits: ['dev']`); locked.jsonl is never opened.
//   - The count must fit the remaining daily allowance (10 Smoke_Calls per UTC day, budget.ts). Every call goes
//     through BudgetSession.reserve({ smoke: true }) before it is sent and BudgetSession.settle after the response.
//   - Each response is checked against the declared shape (`checkResponseShape`) and validated by llm_validate.
//   - Records go to eval/results/smoke/<UTC day>.jsonl only: never a Dev_Run or Locked_Run file, never a Metric.
//   - Console output names the model, the count, the allowance and Card IDs. No prompt, answer or card text.
//   - Smoke_Calls need no approval and are allowed in every phase (allowWorkersAi('smoke', ...) is always
//     `smoke_only`), so the command does not read approvals.json or the ledger.
//   - The credentials are read lazily by the Workers AI runtime factory, and only after every check that needs
//     no credentials has passed.
//
// Card choice (deterministic): among the non-void Dev_Cards in file order, take the base permutation of the first
// D card, then the first S card, then the second D, the second S, and so on (D first). When one Task_Type runs
// out, the other continues. `--max-tokens` is for the granite truncation probe (V4): only with `--count 1`, and
// then the single call is a D card.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { createWorkersAiRuntime, budgetInputs, toBudgetUsage, type AdapterClock, type FetchLike } from './adapters/workers-ai.ts';
import type { AdapterResult } from './adapters/interface.ts';
import { isRefusal, BudgetSession, SMOKE_CAP, utcDay } from './budget.ts';
import { CardLoadError, DEFAULT_CARDS_DIR, formatCardFailure, loadCards } from './cards.ts';
import type { WorkersAiEnv } from './env.ts';
import { checkManifest, formatManifestResult, PINNED_MANIFEST_HASH } from './manifest.ts';
import { isWorkersAi, parseCombinations, type Combination, type ResponseShape } from './phase.ts';
import { SCHEMA, appendSmoke, type JsonObject, type JsonValue, type SmokeRecord } from './results.ts';
import { buildPlan, loadSchemas, loadTemplates, parseTimeoutMs, renderPlan, samplingFor, RunError, type PlanItem, type RunPaths } from './run.ts';
import { printErrorLine, printLine, scrub } from './sink.ts';
import { llmValidate } from './simwasm.ts';

// ---------------------------------------------------------------- Response_Shape check (pure)

export type ShapeCheck =
  | { readonly check: 'ok'; readonly detail: string }
  | { readonly check: 'mismatch'; readonly detail: string }
  /** No response body to judge (HTTP error, timeout, network error): the newest Smoke_Call shape check stays as it was. */
  | { readonly check: 'not_checked'; readonly detail: string };

const asObject = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Checks a REST response against the declared Response_Shape (R11.19): the Cloudflare envelope, then
 * `choices[0].message.content` and `choices[0].finish_reason` for `chat`, or `response` for `text`.
 * A null content is accepted (the field exists; the adapter reports `empty_content`). A missing field or a
 * non-string, non-null value is a mismatch. Returns `not_checked` for a non-2xx status or a missing body.
 */
export function checkResponseShape(shape: ResponseShape, status: number | null, bodyText: string | null): ShapeCheck {
  if (status === null || bodyText === null) return { check: 'not_checked', detail: 'no response' };
  if (status < 200 || status > 299) return { check: 'not_checked', detail: 'http_error' };
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { check: 'mismatch', detail: 'body is not JSON' };
  }
  const env = asObject(body);
  if (env === null) return { check: 'mismatch', detail: 'body is not an object' };
  if (env['success'] === false) return { check: 'not_checked', detail: 'api_error' };
  const result = asObject(env['result']);
  if (result === null) return { check: 'mismatch', detail: 'envelope has no result object' };
  if (shape === 'chat') {
    const choices = result['choices'];
    const choice = Array.isArray(choices) ? asObject(choices[0]) : null;
    if (choice === null) return { check: 'mismatch', detail: 'result.choices[0] missing' };
    const message = asObject(choice['message']);
    if (message === null || !('content' in message)) return { check: 'mismatch', detail: 'choices[0].message.content missing' };
    const content = message['content'];
    if (content !== null && typeof content !== 'string') return { check: 'mismatch', detail: 'choices[0].message.content is not a string' };
    if (!('finish_reason' in choice)) return { check: 'mismatch', detail: 'choices[0].finish_reason missing' };
    return { check: 'ok', detail: 'chat' };
  }
  if (!('response' in result)) return { check: 'mismatch', detail: 'result.response missing' };
  const response = result['response'];
  if (response !== null && typeof response !== 'string') return { check: 'mismatch', detail: 'result.response is not a string' };
  return { check: 'ok', detail: 'text' };
}

/** `choices[0].finish_reason` when the body has one as a short string (a protocol value, never model text). */
export function finishReasonOf(bodyText: string | null): string | null {
  if (bodyText === null) return null;
  try {
    const choices = asObject(asObject(JSON.parse(bodyText))?.['result'])?.['choices'];
    const fr = Array.isArray(choices) ? asObject(choices[0])?.['finish_reason'] : undefined;
    return typeof fr === 'string' && fr.length <= 40 && /^[A-Za-z0-9_.-]+$/.test(fr) ? fr : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- --diagnose (dev only, names and numbers)

const KEY_NAME = /^[A-Za-z0-9_.-]{1,60}$/;
const safeKeys = (o: Record<string, unknown> | null): string[] => (o === null ? [] : Object.keys(o).filter((k) => KEY_NAME.test(k)).sort());

/**
 * The key NAMES of the response, level by level (envelope, result, choices[0], choices[0].message). Never a value.
 * Returns null when the body is not a JSON object.
 */
export function responseKeysOf(bodyText: string | null): JsonObject | null {
  if (bodyText === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const env = asObject(body);
  if (env === null) return null;
  const result = asObject(env['result']);
  const choices = result?.['choices'];
  const choice = Array.isArray(choices) ? asObject(choices[0]) : null;
  const message = asObject(choice?.['message']);
  return { top: safeKeys(env), result: safeKeys(result), choice: safeKeys(choice), message: safeKeys(message) };
}

/** Every numeric field of `result.usage`, nested objects flattened with dots (e.g. `completion_tokens_details.reasoning_tokens`). Numbers only. */
export function usageDetailOf(bodyText: string | null): JsonObject | null {
  if (bodyText === null) return null;
  let usage: Record<string, unknown> | null;
  try {
    usage = asObject(asObject(asObject(JSON.parse(bodyText))?.['result'])?.['usage']);
  } catch {
    return null;
  }
  if (usage === null) return null;
  const out: JsonObject = {};
  const walk = (o: Record<string, unknown>, prefix: string, depth: number): void => {
    for (const k of Object.keys(o).sort()) {
      if (!KEY_NAME.test(k)) continue;
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[`${prefix}${k}`] = v;
      else if (depth < 2 && asObject(v) !== null) walk(v as Record<string, unknown>, `${prefix}${k}.`, depth + 1);
    }
  };
  walk(usage, '', 0);
  return out;
}

// ---------------------------------------------------------------- arguments

export interface SmokeOptions {
  readonly combo: string;
  readonly count: number;
  readonly diagnose: boolean;
  readonly timeoutMs: number | string | undefined;
  readonly maxTokens: number | null;
}

export type ParsedSmokeArgs = { readonly ok: true; readonly options: SmokeOptions } | { readonly ok: false; readonly message: string };

const DIGITS = /^[0-9]+$/;

export function parseSmokeArgs(argv: readonly string[]): ParsedSmokeArgs {
  let values: Record<string, string | undefined>;
  let diagnose = false;
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: { combo: { type: 'string' }, count: { type: 'string' }, 'timeout-ms': { type: 'string' }, 'max-tokens': { type: 'string' }, diagnose: { type: 'boolean' } },
    });
    if (parsed.positionals.length > 0) return { ok: false, message: `unexpected argument "${parsed.positionals[0]}"` };
    values = parsed.values as Record<string, string | undefined>;
    diagnose = parsed.values['diagnose'] === true;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const combo = values['combo'];
  if (combo === undefined || combo === '') return { ok: false, message: '--combo <id> is required' };
  const rawCount = values['count'];
  if (rawCount !== undefined && !DIGITS.test(rawCount)) return { ok: false, message: '--count must be a positive integer' };
  const count = rawCount === undefined ? 1 : Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 1) return { ok: false, message: '--count must be a positive integer' };
  const rawMax = values['max-tokens'];
  let maxTokens: number | null = null;
  if (rawMax !== undefined) {
    if (!DIGITS.test(rawMax) || !Number.isSafeInteger(Number(rawMax)) || Number(rawMax) < 1) return { ok: false, message: '--max-tokens must be a positive integer' };
    if (count !== 1) return { ok: false, message: '--max-tokens is allowed only with --count 1 (the granite truncation probe)' };
    maxTokens = Number(rawMax);
  }
  return { ok: true, options: { combo, count, diagnose, timeoutMs: values['timeout-ms'], maxTokens } };
}

// ---------------------------------------------------------------- card choice (pure)

/**
 * The first `count` base-permutation items, alternating D and S (D first), from non-void cards in file order.
 * `plan` must already be in file order per Task_Type (buildPlan's order). Returns fewer than `count` when the
 * Dev_Cards run out; the caller refuses then.
 */
export function pickSmokeItems(plan: readonly PlanItem[], count: number, dOnly: boolean): PlanItem[] {
  const usable = plan.filter((p) => p.permutation === 'base' && !p.card.void);
  const d = usable.filter((p) => p.task === 'decision');
  const s = dOnly ? [] : usable.filter((p) => p.task === 'synthesis');
  const out: PlanItem[] = [];
  let i = 0;
  let j = 0;
  while (out.length < count && (i < d.length || j < s.length)) {
    if (i < d.length && out.length < count) out.push(d[i++] as PlanItem);
    if (j < s.length && out.length < count) out.push(s[j++] as PlanItem);
  }
  return out;
}

// ---------------------------------------------------------------- command

export interface SmokeDeps {
  readonly paths: RunPaths;
  readonly pinnedManifestHash: string;
  readonly combinations: readonly Combination[];
  /** Default: the global `fetch`. Tests give a fake: no test sends a real request. */
  readonly fetch?: FetchLike;
  /** Default: `loadWorkersAiEnv()`. Called lazily, once, by the Workers AI runtime factory. */
  readonly loadEnv?: () => WorkersAiEnv;
  readonly clock?: AdapterClock;
  /** Milliseconds since the epoch; default `Date.now`. */
  readonly now?: () => number;
}

export const smokeDirOf = (paths: RunPaths): string => path.join(paths.resultsDir, 'smoke');
export const smokeFileOf = (paths: RunPaths, day: string): string => path.join(smokeDirOf(paths), `${day}.jsonl`);

const fail = (message: string, code = 1): number => {
  printErrorLine(`probe: smoke: ${message}`);
  return code;
};

function outcomeLabel(r: AdapterResult): string {
  return r.kind === 'error' ? r.code : r.kind;
}

/** llm_validate input for an adapter result (same mapping as grading: a non-text response is a parse failure). */
function validateInputOf(frozenContext: JsonValue, r: AdapterResult): string {
  if (r.kind === 'text') return JSON.stringify({ frozen_context: frozenContext, raw: r.text });
  if (r.kind === 'timeout') return JSON.stringify({ frozen_context: frozenContext, outcome: { kind: 'timeout' } });
  const outcome = r.code === 'non_text_response' ? { kind: 'error', code: 'parse_failure', detail: 'non_text_response' } : { kind: 'error', code: r.code, detail: r.detail };
  return JSON.stringify({ frozen_context: frozenContext, outcome });
}

function verdictOf(frozenContext: JsonValue, r: AdapterResult, cardId: string): { kind: string; reason: string | null } {
  const env = JSON.parse(llmValidate(validateInputOf(frozenContext, r), cardId)) as { ok?: boolean; verdict?: { kind?: string; reason?: string } };
  if (env.ok !== true || typeof env.verdict?.kind !== 'string') throw new Error(`llm_validate refused the input for Card ID ${cardId}`);
  return { kind: env.verdict.kind, reason: typeof env.verdict.reason === 'string' ? env.verdict.reason : null };
}

/** `smoke`. Returns the exit code: 0 when every requested call was sent, 1 on a refusal or stop, 2 on bad arguments. */
export async function smokeCommand(argv: readonly string[], deps: SmokeDeps): Promise<number> {
  const parsed = parseSmokeArgs(argv);
  if (!parsed.ok) return fail(parsed.message, 2);
  const { count, maxTokens } = parsed.options;
  const now = deps.now ?? Date.now;

  const combo = deps.combinations.find((c) => c.id === parsed.options.combo);
  if (combo === undefined) return fail(`unknown combination "${parsed.options.combo}"`, 2);
  if (!isWorkersAi(combo)) return fail(`"${combo.id}" is not a Workers AI Combination; Smoke_Calls go to Workers AI only`);
  if (combo.response_shape === undefined || combo.prices === undefined) return fail(`${combo.id}: combinations.json needs response_shape and prices`);
  const shape: ResponseShape = combo.response_shape;

  let timeoutMs: number;
  try {
    timeoutMs = parseTimeoutMs(parsed.options.timeoutMs);
  } catch (e) {
    if (e instanceof RunError) return fail('--timeout-ms must be a positive integer', 2);
    throw e;
  }

  // Manifest_Check on every invocation (R1.1), then the Dev_Cards only.
  const manifest = await checkManifest({ cardsDir: deps.paths.cardsDir, pinnedHash: deps.pinnedManifestHash });
  for (const line of formatManifestResult(manifest, deps.pinnedManifestHash)) (manifest.ok ? printLine : printErrorLine)(line);
  if (!manifest.ok) return 1;

  // The counter is read before anything else is sent or rendered: an unreadable counter stops here (R11.12).
  let budget: BudgetSession;
  try {
    budget = BudgetSession.open({ file: deps.paths.budgetFile, now });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Request_Budget counter is unreadable');
  }
  const day = utcDay(now());
  const used = budget.counter(day).smoke;
  const remaining = Math.max(0, SMOKE_CAP - used);
  if (count > remaining) {
    return fail(`refused: ${count} Smoke_Call(s) requested, ${remaining} left of the ${SMOKE_CAP} allowed for UTC day ${day}; nothing sent`);
  }

  let items: PlanItem[];
  let templates: ReturnType<typeof loadTemplates>;
  try {
    const loaded = loadCards({ cardsDir: deps.paths.cardsDir, splits: ['dev'] });
    templates = loadTemplates(deps.paths);
    const plan = buildPlan(loaded.cards.dev, ['decision', 'synthesis']);
    items = pickSmokeItems(plan, count, maxTokens !== null);
    if (items.length < count) return fail(`only ${items.length} usable Dev_Card(s) for ${count} requested call(s); nothing sent`);
    const schemas = loadSchemas(deps.paths.cardsDir, items);
    const rendered = renderPlan(items, templates, schemas, combo);
    if (rendered.errors.length > 0) return fail(`${rendered.errors.length} prompt(s) failed to render; nothing sent`);
  } catch (e) {
    if (e instanceof CardLoadError) {
      for (const f of e.failures) printErrorLine(formatCardFailure(f));
      return 1;
    }
    return fail(e instanceof Error ? e.message : 'could not prepare the Smoke_Calls');
  }

  if (maxTokens !== null) {
    const limit = (items[0] as PlanItem).sampling?.maxOutputTokens ?? 0;
    if (maxTokens > limit) return fail(`--max-tokens ${maxTokens} is above the Combination's cap of ${limit}; nothing sent`);
  }

  // Capture status and body text of each response, in memory only, for the shape check. Never written.
  let last: { status: number; body: string } | null = null;
  const inner: FetchLike = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const capturing: FetchLike = async (url, init) => {
    last = null;
    const res = await inner(url, init);
    const body = await res.text();
    last = { status: res.status, body };
    return { status: res.status, text: () => Promise.resolve(body) };
  };

  const none = { kind: 'none' } as const;
  let handle;
  try {
    const factory = createWorkersAiRuntime({
      ...(deps.loadEnv === undefined ? {} : { loadEnv: deps.loadEnv }),
      fetch: capturing,
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    });
    handle = await factory({
      combo,
      kind: 'dev',
      resume: false,
      timeoutMs,
      samplings: { decision: samplingFor(combo, 'decision', none), synthesis: samplingFor(combo, 'synthesis', none) },
      warmups: templates.warmups,
    });
  } catch (e) {
    // EnvError already printed its message (it names the file or variable only).
    if (e instanceof Error && e.name !== 'EnvError') printErrorLine(`probe: smoke: cannot create the Workers AI runtime (${e.name})`);
    return 1;
  }

  printLine(`probe: smoke: model ${combo.model_id} (${combo.id})`);
  printLine(`probe: smoke: will send ${count} Smoke_Call(s); remaining daily allowance ${remaining} of ${SMOKE_CAP} (UTC day ${day})`);

  let sent = 0;
  let accepted = 0;
  let mismatches = 0;
  for (const item of items) {
    const prompt = item.prompt;
    const rendered = item.sampling;
    if (prompt === null || rendered === null) return fail('internal: unrendered item');
    const sampling = maxTokens === null ? rendered : { ...rendered, maxOutputTokens: maxTokens };
    const inputs = budgetInputs(combo, prompt, sampling);
    const reservation = budget.reserve({ smoke: true, estimate: inputs.estimate });
    if (isRefusal(reservation)) {
      printErrorLine(`probe: smoke: stopped after ${sent} call(s): ${reservation.message}`);
      return 1;
    }
    const result = await handle.adapter.complete(prompt, { timeoutMs, sampling });
    sent += 1;
    const captured = last as { status: number; body: string } | null;
    const usage = result.kind === 'text' || result.kind === 'error' ? (result.usage ?? null) : null;
    if (usage !== null) budget.settle(reservation, toBudgetUsage(usage), { inputPrice: combo.prices.input, outputPrice: combo.prices.output });

    const shapeResult = checkResponseShape(shape, captured?.status ?? null, captured?.body ?? null);
    const verdict = verdictOf(item.facts.frozenContext, result, item.card.id);
    if (verdict.kind !== 'illegal') accepted += 1;
    if (shapeResult.check === 'mismatch') mismatches += 1;

    const at = now();
    const record: JsonObject = {
      schema: SCHEMA.smoke,
      at: new Date(at).toISOString(),
      combination: combo.id,
      model_id: combo.model_id,
      card_id: item.card.id,
      task: item.task,
      permutation: item.permutation,
      outcome: outcomeLabel(result),
      verdict: verdict.kind,
      illegal_reason: verdict.reason,
      declared_shape: shape,
      shape_detail: shapeResult.detail,
      http_status: captured?.status ?? null,
      finish_reason: finishReasonOf(captured?.body ?? null),
      max_tokens: sampling.maxOutputTokens,
      max_tokens_override: maxTokens,
      latency_ms: result.kind === 'text' ? result.latencyMs : result.elapsedMs,
      estimated_neurons: inputs.estimate,
      usage: usage === null ? null : { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, reasoning_tokens: usage.reasoningTokens },
    };
    // `shape_check` is left out when no response body could be judged, so a 429 or a timeout never changes the gate.
    if (shapeResult.check !== 'not_checked') record['shape_check'] = shapeResult.check;
    if (parsed.options.diagnose) {
      // Names and numbers only; passed through scrub as well (a secret in a key name is impossible, but the rule holds).
      const keys = responseKeysOf(captured?.body ?? null);
      const detail = usageDetailOf(captured?.body ?? null);
      record['response_keys'] = keys === null ? null : (JSON.parse(scrub(JSON.stringify(keys))) as JsonObject);
      record['usage_detail'] = detail === null ? null : (JSON.parse(scrub(JSON.stringify(detail))) as JsonObject);
    }
    appendSmoke(smokeFileOf(deps.paths, utcDay(at)), record as SmokeRecord);
    printLine(`probe: smoke: ${item.card.id} (${item.task === 'decision' ? 'D' : 'S'}) outcome=${outcomeLabel(result)} verdict=${verdict.kind} shape=${shapeResult.check} http=${captured?.status ?? 'none'}`);
  }

  printLine(`probe: smoke: sent ${sent}; Output_Validator accepted ${accepted}; shape mismatches ${mismatches}`);
  return 0;
}

/** Real wiring: the committed Card_Set and combinations, the real `fetch` and the root `env` file (read lazily). */
export function defaultSmokeDeps(repoDir: string): SmokeDeps {
  const resultsDir = path.join(repoDir, 'eval/results');
  return {
    paths: {
      repoDir,
      cardsDir: DEFAULT_CARDS_DIR,
      resultsDir,
      ledger: path.join(resultsDir, 'ledger.jsonl'),
      failures: path.join(resultsDir, 'failures.jsonl'),
      exclusions: path.join(resultsDir, 'exclusions.jsonl'),
      budgetFile: path.join(resultsDir, 'budget/workers-ai.json'),
    },
    pinnedManifestHash: PINNED_MANIFEST_HASH,
    combinations: parseCombinations(fs.readFileSync(path.join(repoDir, 'eval/probe/combinations.json'), 'utf8')),
  };
}
