// Request_Budget for Workers AI (R11.5, R11.6, R11.11-R11.14, R11.17; design "Budget").
// The top half is pure (parsing, UTC day key from a millisecond timestamp, BigInt estimates,
// cap decisions); the bottom half does the thin I/O. All writes go through sink.ts.
import * as fs from 'node:fs';
import { writeTextFileAtomicDurable } from './sink.ts';

export const BUDGET_SCHEMA = 'llm-probe-budget-v1';
export const BUDGET_FILE = 'eval/results/budget/workers-ai.json';
export const PER_RUN_CAP = 410;
export const DAILY_CAP = 600;
export const SMOKE_CAP = 10;
export const NEURON_CAP = 9000;
/** Tokens of chat-template allowance added to the prompt's UTF-8 byte length (R11.13). */
export const TEMPLATE_ALLOWANCE = 256;

export interface DayCounter {
  requests: number;
  smoke: number;
  neurons: number;
}
export interface BudgetState {
  schema: typeof BUDGET_SCHEMA;
  days: { [day: string]: DayCounter };
}
export interface BudgetCaps {
  perRun: number;
  daily: number;
  smoke: number;
  neurons: number;
}
export const DEFAULT_CAPS: BudgetCaps = { perRun: PER_RUN_CAP, daily: DAILY_CAP, smoke: SMOKE_CAP, neurons: NEURON_CAP };

/** The counter exists but cannot be read or parsed (R11.12). The file is left untouched. */
export class BudgetError extends Error {}

// ---------------------------------------------------------------- pure

/** UTC calendar day `YYYY-MM-DD` of a millisecond timestamp (the clock is injected). */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function emptyBudget(): BudgetState {
  return { schema: BUDGET_SCHEMA, days: {} };
}

/** Parses the counter file text; throws BudgetError on anything unexpected (R11.12). */
export function parseBudget(text: string): BudgetState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BudgetError('Request_Budget counter is unreadable: not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BudgetError('Request_Budget counter is unreadable: top level is not an object');
  }
  const obj = raw as { [k: string]: unknown };
  if (obj.schema !== BUDGET_SCHEMA) {
    throw new BudgetError(`Request_Budget counter is unreadable: schema is not ${BUDGET_SCHEMA}`);
  }
  const days = obj.days;
  if (typeof days !== 'object' || days === null || Array.isArray(days)) {
    throw new BudgetError('Request_Budget counter is unreadable: "days" is not an object');
  }
  const out: BudgetState = emptyBudget();
  for (const [day, entry] of Object.entries(days as { [k: string]: unknown })) {
    if (!DAY_KEY.test(day)) throw new BudgetError(`Request_Budget counter is unreadable: bad day key "${day}"`);
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new BudgetError(`Request_Budget counter is unreadable: day ${day} is not an object`);
    }
    const e = entry as { [k: string]: unknown };
    for (const field of ['requests', 'smoke', 'neurons'] as const) {
      if (!isCount(e[field])) {
        throw new BudgetError(`Request_Budget counter is unreadable: day ${day} field "${field}" is missing or not a non-negative integer`);
      }
    }
    out.days[day] = { requests: e.requests as number, smoke: e.smoke as number, neurons: e.neurons as number };
  }
  return out;
}

/** Canonical text of the counter file (days sorted, trailing newline). */
export function serializeBudget(state: BudgetState): string {
  const days: { [d: string]: DayCounter } = {};
  for (const day of Object.keys(state.days).sort()) {
    const c = state.days[day]!;
    days[day] = { requests: c.requests, smoke: c.smoke, neurons: c.neurons };
  }
  return `${JSON.stringify({ schema: BUDGET_SCHEMA, days })}\n`;
}

function ceilDiv(n: bigint, d: bigint): bigint {
  return (n + d - 1n) / d;
}
function asCount(n: bigint): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new BudgetError('neuron figure exceeds the safe integer range');
  return Number(n);
}

/** Estimate (R11.13): `ceil(((bytes + 256) × in + max_out × out) / 1,000,000)`. Prices: neurons per million tokens. */
export function estimateNeurons(a: { promptBytes: number; maxOutputTokens: number; inputPrice: number; outputPrice: number }): number {
  const input = BigInt(a.promptBytes) + BigInt(TEMPLATE_ALLOWANCE);
  return asCount(ceilDiv(input * BigInt(a.inputPrice) + BigInt(a.maxOutputTokens) * BigInt(a.outputPrice), 1_000_000n));
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** Reasoning tokens when the response reports them separately. */
  reasoningTokens?: number | null;
}

/** Billed output tokens: reasoning is added only when larger than `completion_tokens` (design "Budget"). */
export function billedOutputTokens(u: Usage): number {
  const r = u.reasoningTokens ?? 0;
  return r > u.completionTokens ? u.completionTokens + r : u.completionTokens;
}

/** Usage-based cost: `ceil((in_tokens × in + billed_out × out) / 1,000,000)`. */
export function usageNeurons(u: Usage, prices: { inputPrice: number; outputPrice: number }): number {
  const n = BigInt(u.promptTokens) * BigInt(prices.inputPrice) + BigInt(billedOutputTokens(u)) * BigInt(prices.outputPrice);
  return asCount(ceilDiv(n, 1_000_000n));
}

export type CapName = 'per-run' | 'daily' | 'smoke' | 'neuron';
export interface Refusal {
  ok: false;
  cap: CapName;
  value: number;
  /** Names the cap and its value (R11.5, R11.14). */
  message: string;
}

/**
 * Decides whether one more request may be sent, in the design's order: request caps, then the
 * Neuron_Cap. `runCount` is the number of requests already sent in this run (ledger sum on resume).
 * Pure: it does not touch the state.
 */
export function checkRequest(
  state: BudgetState,
  day: string,
  runCount: number,
  req: { smoke: boolean; estimate: number },
  caps: BudgetCaps = DEFAULT_CAPS,
): { ok: true } | Refusal {
  const c = state.days[day] ?? { requests: 0, smoke: 0, neurons: 0 };
  if (runCount >= caps.perRun) {
    return { ok: false, cap: 'per-run', value: caps.perRun, message: `per-run cap of ${caps.perRun} requests reached` };
  }
  if (c.requests >= caps.daily) {
    return { ok: false, cap: 'daily', value: caps.daily, message: `daily cap of ${caps.daily} requests reached for UTC day ${day}` };
  }
  if (req.smoke && c.smoke >= caps.smoke) {
    return { ok: false, cap: 'smoke', value: caps.smoke, message: `smoke cap of ${caps.smoke} Smoke_Calls per UTC day reached for ${day}` };
  }
  if (c.neurons + req.estimate > caps.neurons) {
    return {
      ok: false,
      cap: 'neuron',
      value: caps.neurons,
      message: `Neuron_Cap of ${caps.neurons} estimated neurons reached for UTC day ${day} (counted ${c.neurons}, next estimate ${req.estimate})`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- I/O

/** Reads the counter. A missing file is an empty counter; any other failure is a BudgetError. */
export function readBudgetFile(file: string): BudgetState {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyBudget();
    throw new BudgetError(`Request_Budget counter is unreadable: ${(e as Error).message}`);
  }
  return parseBudget(text);
}

export interface Reservation {
  readonly day: string;
  readonly estimate: number;
  readonly smoke: boolean;
}

export interface BudgetOptions {
  file: string;
  /** Injected clock, milliseconds since the epoch. */
  now: () => number;
  /** Requests already sent in this run (ledger sum on a resume). */
  runCount?: number;
  caps?: BudgetCaps;
}

/**
 * One run's view of the counter. `open` fails (before any request, file untouched) when the file is
 * unreadable. `reserve` persists the request and its estimate BEFORE the caller sends; `settle`
 * replaces the estimate by the usage-based cost once a response with usage arrived.
 */
export class BudgetSession {
  private state: BudgetState;
  private runCount: number;
  private neuronLockedDay: string | null = null;
  private readonly file: string;
  private readonly now: () => number;
  private readonly caps: BudgetCaps;

  private constructor(o: BudgetOptions, state: BudgetState) {
    this.file = o.file;
    this.now = o.now;
    this.runCount = o.runCount ?? 0;
    this.caps = o.caps ?? DEFAULT_CAPS;
    this.state = state;
  }

  static open(o: BudgetOptions): BudgetSession {
    return new BudgetSession(o, readBudgetFile(o.file));
  }

  /** A snapshot of the counted figures for a UTC day. */
  counter(day: string): DayCounter {
    return { ...(this.state.days[day] ?? { requests: 0, smoke: 0, neurons: 0 }) };
  }

  get requestsThisRun(): number {
    return this.runCount;
  }

  /**
   * Returns a Reservation after the single durable write, or a Refusal (nothing written, nothing
   * counted). After a Neuron_Cap refusal every later request of that UTC day is refused.
   */
  reserve(req: { smoke: boolean; estimate: number }): Reservation | Refusal {
    const day = utcDay(this.now());
    if (this.neuronLockedDay === day) {
      return {
        ok: false,
        cap: 'neuron',
        value: this.caps.neurons,
        message: `Neuron_Cap of ${this.caps.neurons} estimated neurons already reached for UTC day ${day}`,
      };
    }
    const verdict = checkRequest(this.state, day, this.runCount, req, this.caps);
    if (!verdict.ok) {
      if (verdict.cap === 'neuron') this.neuronLockedDay = day;
      return verdict;
    }
    const c = this.counter(day);
    const next: BudgetState = {
      schema: BUDGET_SCHEMA,
      days: {
        ...this.state.days,
        [day]: { requests: c.requests + 1, smoke: c.smoke + (req.smoke ? 1 : 0), neurons: c.neurons + req.estimate },
      },
    };
    writeTextFileAtomicDurable(this.file, serializeBudget(next));
    this.state = next;
    this.runCount += 1;
    return { day, estimate: req.estimate, smoke: req.smoke };
  }

  /** Replaces the reserved estimate by the usage-based cost (a second atomic write). Without usage nothing changes. */
  settle(r: Reservation, usage: Usage | null, prices: { inputPrice: number; outputPrice: number }): number {
    const c = this.counter(r.day);
    if (usage === null) return c.neurons;
    const actual = usageNeurons(usage, prices);
    const neurons = asCount(BigInt(c.neurons) - BigInt(r.estimate) + BigInt(actual));
    const next: BudgetState = { schema: BUDGET_SCHEMA, days: { ...this.state.days, [r.day]: { ...c, neurons } } };
    writeTextFileAtomicDurable(this.file, serializeBudget(next));
    this.state = next;
    return neurons;
  }
}

export function isRefusal(x: Reservation | Refusal): x is Refusal {
  return 'ok' in x && x.ok === false;
}
