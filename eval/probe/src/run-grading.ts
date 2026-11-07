// Grading of a run's Results records (llm-probe task 13.2; design "Grades file", R6.2, R6.3).
//
// ALL decisions come from Sim_Wasm: `llm_validate` gives the verdict, `llm_grade` the grade,
// `llm_identity` the Identity_Value and `llm_contrast` the contrast decision. This module only
// builds the JSON inputs, checks the `ok` envelope and arranges the grade lines. It holds no
// validation, option-membership or scoring logic.
import type { LoadedCard, TaskType } from './cards.ts';
import {
  SCHEMA,
  type ContrastLine,
  type ExcludedLine,
  type GradeLine,
  type JsonValue,
  type ResultRecord,
} from './results.ts';
import { llmContrast, llmGrade, llmIdentity, llmValidate } from './simwasm.ts';

/** Facts read from a card's `llm_parse_card` result. */
export interface CardFacts {
  readonly card: LoadedCard;
  readonly frozenContext: JsonValue;
  readonly pairId: string | null;
  readonly role: 'a' | 'b' | null;
  /** The family output schema name for S cards (`grudge_v1`), or null for D. */
  readonly outputSchema: string | null;
}

export class GradingError extends Error {
  readonly cardId: string;
  constructor(cardId: string, what: string) {
    super(`grading failed for Card ID ${cardId}: ${what}`);
    this.name = 'GradingError';
    this.cardId = cardId;
  }
}

type Envelope = { ok: boolean; error?: { kind?: string; message?: string }; [member: string]: unknown };

function parseEnvelope(text: string, cardId: string, what: string): Envelope {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new GradingError(cardId, `${what} returned text that is not JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new GradingError(cardId, `${what} returned a non-object`);
  const env = value as Envelope;
  if (env.ok !== true) throw new GradingError(cardId, `${what} refused its input (${env.error?.kind ?? 'unknown'})`);
  return env;
}

export function cardFacts(card: LoadedCard): CardFacts {
  const env = JSON.parse(card.parsed) as {
    frozen_context: JsonValue;
    meta: { pair_id: string | null; role: 'a' | 'b' | null };
  };
  const ctx = env.frozen_context as { output_schema?: unknown };
  return {
    card,
    frozenContext: env.frozen_context,
    pairId: env.meta.pair_id,
    role: env.meta.role,
    outputSchema: typeof ctx.output_schema === 'string' ? ctx.output_schema : null,
  };
}

/** True for a record that holds an answer to grade: text, timeout or error (R12.9, R8.13). */
export const hasOutput = (r: ResultRecord): boolean => r.outcome.kind === 'text' || r.outcome.kind === 'timeout' || r.outcome.kind === 'error';

function validateInput(facts: CardFacts, r: ResultRecord): string {
  const o = r.outcome;
  if (o.kind === 'text') return JSON.stringify({ frozen_context: facts.frozenContext, raw: o.text });
  if (o.kind === 'timeout') return JSON.stringify({ frozen_context: facts.frozenContext, outcome: { kind: 'timeout' } });
  if (o.kind === 'error') {
    // R11.18: a non-text response is a parse failure with that detail.
    const outcome =
      o.code === 'non_text_response'
        ? { kind: 'error', code: 'parse_failure', detail: 'non_text_response' }
        : { kind: 'error', code: o.code, detail: o.detail };
    return JSON.stringify({ frozen_context: facts.frozenContext, outcome });
  }
  throw new GradingError(facts.card.id, `a ${o.kind} record has no output`);
}

function verdictOf(facts: CardFacts, input: string): JsonValue {
  const env = parseEnvelope(llmValidate(input, facts.card.id), facts.card.id, 'llm_validate');
  return env['verdict'] as JsonValue;
}

function gradeOf(facts: CardFacts, verdict: JsonValue): JsonValue {
  const env = parseEnvelope(llmGrade(JSON.stringify({ card: facts.card.text, verdict }), facts.card.id), facts.card.id, 'llm_grade');
  return env['grade'] as JsonValue;
}

function identityOf(facts: CardFacts, verdict: JsonValue): JsonValue {
  const env = parseEnvelope(llmIdentity(JSON.stringify({ card: facts.card.text, verdict }), facts.card.id), facts.card.id, 'llm_identity');
  return env['identity'] as JsonValue;
}

export interface GradedRun {
  readonly grades: GradeLine[];
  readonly contrasts: ContrastLine[];
  readonly excluded: ExcludedLine['excluded'];
}

/**
 * Grades every record that has an output, then every complete Contrast_Pair on base-permutation
 * verdicts, and lists the excluded cards and pairs (R2.8). `records` may hold several records for one
 * Card x Permutation (a resumed run); the last one with an output wins.
 */
export function gradeRecords(cards: readonly LoadedCard[], records: readonly ResultRecord[], tasks: readonly TaskType[]): GradedRun {
  const factsById = new Map(cards.map((c) => [c.id, cardFacts(c)] as const));
  const lastOutput = new Map<string, ResultRecord>();
  for (const r of records) if (hasOutput(r)) lastOutput.set(`${r.card_id}\u0000${r.permutation}`, r);

  const grades: GradeLine[] = [];
  const baseVerdicts = new Map<string, JsonValue>();
  for (const r of lastOutput.values()) {
    const facts = factsById.get(r.card_id);
    if (facts === undefined) throw new GradingError(r.card_id, 'the record names a card that is not in the loaded set');
    const verdict = verdictOf(facts, validateInput(facts, r));
    if (r.permutation === 'base') baseVerdicts.set(r.card_id, verdict);
    let lateGrade: JsonValue | null = null;
    if (r.outcome.kind === 'timeout' && r.late?.kind === 'late') {
      const lateVerdict = verdictOf(facts, JSON.stringify({ frozen_context: facts.frozenContext, raw: r.late.text }));
      lateGrade = gradeOf(facts, lateVerdict);
    }
    grades.push({
      schema: SCHEMA.grade,
      card_id: r.card_id,
      permutation: r.permutation,
      verdict,
      grade: gradeOf(facts, verdict),
      identity: identityOf(facts, verdict),
      late_grade: lateGrade,
    });
  }

  const inScope = cards.filter((c) => tasks.includes(c.task));
  const excluded: ExcludedLine['excluded'] = [];
  for (const c of inScope) {
    if (c.void) excluded.push({ id: c.id, reason: 'void' });
    else if (!c.scored) excluded.push({ id: c.id, reason: 'sanity' });
  }

  const contrasts: ContrastLine[] = [];
  const pairs = new Map<string, { a?: CardFacts; b?: CardFacts }>();
  for (const c of inScope) {
    const f = factsById.get(c.id) as CardFacts;
    if (f.pairId === null || f.role === null) continue;
    const slot = pairs.get(f.pairId) ?? {};
    slot[f.role] = f;
    pairs.set(f.pairId, slot);
  }
  for (const [pairId, { a, b }] of [...pairs].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    if (a === undefined || b === undefined) continue;
    if (a.card.void || b.card.void) {
      excluded.push({ id: pairId, reason: 'void' });
      continue;
    }
    if (!a.card.scored || !b.card.scored) {
      excluded.push({ id: pairId, reason: 'sanity' });
      continue;
    }
    const va = baseVerdicts.get(a.card.id);
    const vb = baseVerdicts.get(b.card.id);
    if (va === undefined || vb === undefined) continue;
    const env = parseEnvelope(
      llmContrast(JSON.stringify({ card_a: a.card.text, verdict_a: va, card_b: b.card.text, verdict_b: vb }), a.card.id),
      a.card.id,
      'llm_contrast',
    );
    contrasts.push({ schema: SCHEMA.contrast, pair_id: pairId, contrast: env['contrast'] as JsonValue });
  }
  return { grades, contrasts, excluded };
}
