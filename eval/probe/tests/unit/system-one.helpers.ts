// Test support for the System_One adapter (llm-probe task 29). A fake `fetch`, a test mapping and requests
// rendered from the real Dev_Cards through Sim_Wasm. No network, no `env`, no locked.jsonl.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createFakeClock, type FakeClock } from '../../src/adapters/fake.ts';
import { decisionRequestFrom, SystemOneAdapter } from '../../src/adapters/system-one.ts';
import type { DecisionRequest } from '../../src/adapters/interface.ts';
import type { FetchInit, FetchLike } from '../../src/adapters/workers-ai.ts';
import { DEFAULT_CARDS_DIR, loadCards } from '../../src/cards.ts';
import { parseCombinations, type Combination, type SystemOneCombination } from '../../src/phase.ts';
import { Secret } from '../../src/redact.ts';
import type { JsonValue } from '../../src/results.ts';
import { cardFacts } from '../../src/run-grading.ts';
import { llmPermutations, llmRenderSystemOne } from '../../src/simwasm.ts';

export const TOKEN = 'tok-SECRET-0123456789';
export const ACCOUNT = 'acct-SECRET-abcdef';

/** A System_One_Mapping in the documented format (the real v1 file arrives with task 30). */
export const MAPPING = `[meta]
format_version: 1
question_id: decision
criteria: option id -> option label, in the order of the Permutation
[instructions]
How to read the facts: IDs are exact. One tick is one day.
How to choose: pick the one option that fits best.
[state]
Today is day {{tick}}.
{{situation}}
People:
{{people}}
Relations:
{{relations}}
Events:
{{events}}
Input: {{player_input}}
Subject: {{subject}}
`;

const here = path.dirname(new URL(import.meta.url).pathname);
export const COMBINATIONS_FILE = path.join(here, '../../combinations.json');

/** The committed records of the two Decision_Models. */
export function realCombo(id: 'workers-ai/clef-flash' | 'workers-ai/clef'): SystemOneCombination {
  const found = parseCombinations(readFileSync(COMBINATIONS_FILE, 'utf8')).find((c) => c.id === id);
  if (found === undefined) throw new Error(`${id} is not in combinations.json`);
  return found as SystemOneCombination;
}

/** A Decision_Model record with the given window and byte cap, for boundary tests. */
export function comboWith(over: { window?: number; k?: number; price?: number; selector?: string } = {}): SystemOneCombination {
  const base = realCombo('workers-ai/clef-flash');
  return {
    ...base,
    model_selector: over.selector ?? base.model_selector,
    context_window_tokens: over.window ?? base.context_window_tokens,
    max_bytes_per_token: over.k ?? base.max_bytes_per_token,
    prices: { ...base.prices, input: over.price ?? base.prices.input },
  } as SystemOneCombination;
}

export interface Call {
  readonly url: string;
  readonly init: FetchInit;
}

export function fakeFetch(respond: number | ((n: number, call: Call) => { status: number; body: string }), body?: string): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    const r = typeof respond === 'number' ? { status: respond, body: body ?? '{}' } : respond(calls.length - 1, call);
    return Promise.resolve({ status: r.status, text: () => Promise.resolve(r.body) });
  };
  return { fetch, calls };
}

export function adapterFor(combo: SystemOneCombination, fetch: FetchLike, clock: FakeClock = createFakeClock()): SystemOneAdapter {
  return new SystemOneAdapter({ combo, token: new Secret(TOKEN), accountId: new Secret(ACCOUNT), fetch, clock });
}

/** A System One answer body as the service sends it (usage given as the lexemes to print, or omitted). */
export function answerBody(a: { choice: string; confidence?: string; probabilities?: string; inputTokens?: number | null; outputTokens?: number; model?: string; extra?: string }): string {
  const usage = a.inputTokens === null || a.inputTokens === undefined ? '' : `,"usage":{"input_tokens":${a.inputTokens},"output_tokens":${a.outputTokens ?? 1}}`;
  return (
    `{"success":true,"errors":[],"messages":[],"result":{"model":${JSON.stringify(a.model ?? 'clef-flash')},` +
    `"answers":{"decision":{"type":"choice","choice":${JSON.stringify(a.choice)},"probabilities":${a.probabilities ?? '{"a":0.6,"b":0.4}'},"confidence":${a.confidence ?? '0.6'}}}` +
    `${usage}${a.extra ?? ''}}}`
  );
}

export interface RenderedRequest {
  readonly cardId: string;
  readonly permutation: string;
  readonly request: DecisionRequest;
  readonly frozenContext: JsonValue;
  readonly optionIds: readonly string[];
}

/** One decision request per Dev_Card D x Permutation (Scored_Cards in every Permutation), rendered by Sim_Wasm. */
export function devDecisionRequests(basePermutationOnly = false): RenderedRequest[] {
  const { cards } = loadCards({ cardsDir: DEFAULT_CARDS_DIR, splits: ['dev'] });
  const out: RenderedRequest[] = [];
  for (const card of cards.dev.filter((c) => c.task === 'decision' && !c.void)) {
    const facts = cardFacts(card);
    let perms = ['base'];
    if (card.scored && !basePermutationOnly) {
      const env = JSON.parse(llmPermutations(JSON.stringify({ frozen_context: facts.frozenContext }), card.id)) as { permutations: string[] };
      perms = env.permutations;
    }
    for (const permutation of perms) {
      const env = JSON.parse(llmRenderSystemOne(JSON.stringify({ frozen_context: facts.frozenContext, mapping: MAPPING, permutation }), card.id)) as {
        ok: boolean;
        state: string;
        instructions: string;
        question_id: string;
        criteria: { id: string; label: string }[];
      };
      if (!env.ok) throw new Error(`render failed for ${card.id}`);
      out.push({ cardId: card.id, permutation, request: decisionRequestFrom(env), frozenContext: facts.frozenContext, optionIds: env.criteria.map((c) => c.id) });
    }
  }
  return out;
}

export const asCombination = (c: SystemOneCombination): Combination => c;
