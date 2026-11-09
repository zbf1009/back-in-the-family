// Test support for `probe derive` (llm-probe task 41). Fake sources are built from the Dev_Card option IDs (rendered through
// Sim_Wasm) and written as ordinary Results files; no network, no `env`, and `locked.jsonl` of the real Card_Set is never opened
// (the "locked" split is the synthetic one of run.helpers.ts).
import * as fs from 'node:fs';
import path from 'node:path';
import { loadCards, type LoadedCard } from '../../src/cards.ts';
import { allowingGate } from './derive.gate.ts';
import { derivedRunId, type DeriveDeps, type DeriveGate } from '../../src/derive.ts';
import { comboModelKey, type Combination, type SystemOneCombination } from '../../src/phase.ts';
import { ResultsWriter, SCHEMA, type JsonObject, type ResultRecord, type Split } from '../../src/results.ts';
import { buildPlan } from '../../src/run.ts';
import { loadSystemOneMapping } from '../../src/templates.ts';
import { createFakeRuntime, makeCardSet, makeEnv, sha256, type TestEnv } from './run.helpers.ts';
import { answerBody, comboWith, devDecisionRequests, MAPPING } from './system-one.helpers.ts';

export const REPO = new URL('../../../../', import.meta.url).pathname;
export const MAPPING_REL = 'eval/probe/templates/decision.system_one.v1.txt';
export const RULE_REL = 'eval/probe/templates/aggregation.perm_avg.v1.txt';

export const cardSet = makeCardSet();

/** Option IDs of every Dev_Card D x Permutation, as the request would carry them (the real Dev_Cards, rendered by Sim_Wasm). */
const OPTIONS = new Map(devDecisionRequests().map((r) => [`${r.cardId}\u0000${r.permutation}`, r.optionIds] as const));

/** What one stored call says: the probabilities as number lexemes, or a Timeout. */
export type CallSpec = { readonly kind: 'ok'; readonly lexeme: (optionId: string, all: readonly string[]) => string } | { readonly kind: 'timeout' };
export type SourceSpec = (cardId: string, permutation: string, index: number) => CallSpec;

export interface DeriveEnv {
  readonly env: TestEnv;
  readonly single: SystemOneCombination;
  readonly permAvg: Combination;
  readonly deps: DeriveDeps;
  readonly ruleHash: string;
  readonly mappingHash: string;
}

/** A temp repo with the committed mapping and rule files, the two records of one model and a gate that allows (or `gate`). */
export function makeDeriveEnv(gate: DeriveGate = allowingGate, over: { ruleText?: string; rulePinVersion?: number } = {}): DeriveEnv {
  const env = makeEnv(cardSet);
  const mapping = loadSystemOneMapping(REPO, MAPPING_REL);
  fs.mkdirSync(path.join(env.root, path.dirname(MAPPING_REL)), { recursive: true });
  fs.writeFileSync(path.join(env.root, MAPPING_REL), mapping.text);
  const ruleBytes = over.ruleText === undefined ? fs.readFileSync(path.join(REPO, RULE_REL)) : Buffer.from(over.ruleText);
  fs.writeFileSync(path.join(env.root, RULE_REL), ruleBytes);
  const single = comboWith();
  const permAvg = {
    id: `${single.id}/perm_avg`, variant: 'perm_avg', derives_from: single.id, sends_requests: false,
    runtime: single.runtime, model_id: single.model_id, model_selector: single.model_selector, quantization: single.quantization, revision: single.revision,
    phase1_locked: false, task_subset_allowed: 'D', response_shape: 'system_one', validator_mode: 'raw_choice', question_id: 'decision', mapping: single['mapping'],
    aggregation: { file: RULE_REL, rule_version: over.rulePinVersion ?? 1, sha256: sha256(ruleBytes) },
  } as unknown as Combination;
  const base = env.deps(createFakeRuntime());
  const deps: DeriveDeps = { paths: base.paths, pinnedManifestHash: base.pinnedManifestHash, combinations: [single as Combination, permAvg], gate };
  return { env, single, permAvg, deps, ruleHash: sha256(ruleBytes), mappingHash: mapping.sha256 };
}

/** The registry a Decision_Model Dev_Run header records for these two records. */
export const registryOf = (d: Pick<DeriveEnv, 'single' | 'permAvg' | 'ruleHash'>): JsonObject[] => [
  { id: d.single.id, variant: 'single', aggregation_hash: null },
  { id: d.permAvg.id, variant: 'perm_avg', aggregation_hash: d.ruleHash },
];

export function cardsOf(split: Split): LoadedCard[] {
  return loadCards({ cardsDir: cardSet.dir, splits: [split] }).cards[split];
}

/** The probabilities body of one stored call: one lexeme per option, in the order of the request's criteria. */
export function bodyFor(options: readonly string[], lexeme: (optionId: string, all: readonly string[]) => string): string {
  const probabilities = `{${options.map((id) => `${JSON.stringify(id)}:${lexeme(id, options)}`).join(',')}}`;
  return answerBody({ choice: options[0] as string, probabilities, inputTokens: 900, outputTokens: 1 });
}

export interface WriteSourceOptions {
  readonly split?: Split;
  readonly runId?: string;
  readonly registry?: JsonObject[] | null;
  readonly mappingHash?: string;
  /** Extra records appended after the plan (for example a `not_run` or `engine_fault` record). */
  readonly extra?: (header: { run_id: string; split: Split; fingerprint_id: string; timeout_ms: number }) => ResultRecord[];
  /** Card × Permutation keys to leave out. */
  readonly skip?: ReadonlySet<string>;
}

/** Writes a complete (or deliberately damaged) `single` Results file for the split and returns its path and plan size. */
export function writeSource(d: DeriveEnv, spec: SourceSpec, o: WriteSourceOptions = {}): { file: string; runId: string; planSize: number } {
  const split = o.split ?? 'dev';
  const cards = cardsOf(split);
  const plan = buildPlan(cards.filter((c) => c.task === 'decision'), ['decision']);
  const runId = o.runId ?? `${split}-20261109T100000Z-source`;
  const registry = o.registry === undefined ? registryOf(d) : o.registry;
  const writer = ResultsWriter.create(path.join(d.env.root, 'eval/results'), {
    schema: SCHEMA.header,
    run_id: runId,
    split,
    combination: d.single.id,
    model_key: comboModelKey(d.single),
    task_subset: 'D',
    fingerprint: { variant: 'single', fake: true },
    template_hashes: { decision: o.mappingHash ?? d.mappingHash },
    timeout_ms: 10000,
    placement: null,
    response_shape: 'system_one',
    validator_mode: 'raw_choice',
    ...(registry === null ? {} : { variants: registry as never }),
  });
  let index = 0;
  for (const item of plan) {
    const key = `${item.card.id}\u0000${item.permutation}`;
    const i = index++;
    if (o.skip?.has(key)) continue;
    // A synthetic locked Card has a new ID but the option IDs of the Dev_Card it was made from.
    const options = OPTIONS.get(`${devIdOf(item.card.id)}\u0000${item.permutation}`) ?? [];
    const call = spec(item.card.id, item.permutation, i);
    const common = { schema: SCHEMA.result, run_id: runId, split, card_id: item.card.id, permutation: item.permutation, timeout_ms: 10000, requested_at: `2026-11-09T10:00:${String(i % 60).padStart(2, '0')}.000Z`, template_hash: o.mappingHash ?? d.mappingHash, fingerprint_id: writer.fingerprintId, source: 'headless' as const };
    if (call.kind === 'timeout') {
      writer.append({ ...common, outcome: { kind: 'timeout' }, latency_ms: 10000, usage: null, late: { kind: 'none', reason: 'generation_cap' } });
    } else {
      writer.append({
        ...common,
        outcome: { kind: 'text', text: options[0] as string },
        latency_ms: 300 + (i % 7),
        usage: { input_tokens: 900, output_tokens: 1, reasoning_tokens: null },
        late: null,
        system_one: { response_text: bodyFor(options, call.lexeme), usage_reported: true },
      });
    }
  }
  for (const r of o.extra?.({ run_id: runId, split, fingerprint_id: writer.fingerprintId, timeout_ms: 10000 }) ?? []) writer.append(r);
  return { file: writer.file, runId, planSize: plan.length };
}

/** The Dev_Card ID a synthetic locked Card ID was made from (run.helpers.ts moves the number part to 9xx). */
function devIdOf(id: string): string {
  const n = cardSet.lockedIds.indexOf(id);
  return n >= 0 ? (cardSet.devIds[n] as string) : id;
}

/** A source in which the smallest option ID is always clearly ahead, so the derived answer is that option for every Card. */
export const firstWins: SourceSpec = () => ({ kind: 'ok', lexeme: (id, all) => (id === [...all].sort()[0] ? '0.7' : '0.1') });

export const derivedFile = (d: DeriveEnv, split: Split, sourceRunId: string): string =>
  path.join(d.env.root, 'eval/results/derived', split, `${derivedRunId(split, sourceRunId, 1)}.jsonl`);
