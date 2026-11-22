import { isDecisionUsage, type DecisionFamily, type DecisionFallbackReason, type DecisionUsage } from './decision.ts';

/** Report-only ordinal buckets use the frozen Rust option order, never arbitrary IDs. */
export const METRIC_FAMILIES = ['dream_interpretation', 'magistrate_ruling'] as const;
export const METRIC_REASONS = ['malformed_request', 'not_found', 'method_not_allowed',
  'payload_too_large', 'model_error', 'invalid_response', 'disabled', 'unavailable',
  'quota', 'rate_limited', 'timeout', 'network', 'session_cap', 'cancelled',
  'zero_wait', 'config_pending', 'manual'] as const;
export const METRIC_ATTEMPT_OUTCOMES = ['model', ...METRIC_REASONS, 'wasm_failure'] as const;
export const METRIC_LATENCIES = ['lt_250_ms', 'lt_1000_ms', 'lt_3000_ms',
  'lt_10000_ms', 'gte_10000_ms', 'unknown'] as const;
export type MetricReason = DecisionFallbackReason | 'manual';
export type MetricAttemptOutcome = typeof METRIC_ATTEMPT_OUTCOMES[number];
type Counts<K extends string> = Record<K, number>;
type OptionCounts = [number, number, number, number, number];
export interface FamilyDecisionMetrics {
  eligibleNodes: number;
  postAttempts: number;
  validatedModelChoices: number;
  checkedModelChoices: number;
  checkedRulesFallbacks: number;
  cancelledOperations: number;
  abortedOperations: number;
  rejectedTriggers: number;
  skipsByReason: Counts<MetricReason>;
  attemptOutcomes: Counts<MetricAttemptOutcome>;
  checkedFallbacksByReason: Counts<MetricReason>;
  latencyBuckets: Counts<typeof METRIC_LATENCIES[number]>;
  usage: { knownResponses: number; unknownResponses: number; inputTokens: number | null; outputTokens: number | null };
  options: { validatedModel: OptionCounts; checkedModel: OptionCounts; checkedRulesDefault: OptionCounts };
  agreement: { validatedAgree: number; validatedDiverge: number; checkedAgree: number; checkedDiverge: number;
    unknownCheckedRulesDefault: number };
}
export interface DecisionMetricsReport {
  version: 'decision-metrics-v1';
  scope: 'page-session';
  optionBuckets: 'frozen-rust-order-0-through-4';
  appliedEvidence: 'native-v5-audit-only';
  counterLimit: number;
  overflowed: boolean;
  families: Record<DecisionFamily, FamilyDecisionMetrics>;
}
function counts<K extends string>(keys: readonly K[]): Counts<K> {
  return Object.fromEntries(keys.map(key => [key, 0])) as Counts<K>;
}
function family(): FamilyDecisionMetrics {
  return { eligibleNodes: 0, postAttempts: 0, validatedModelChoices: 0, checkedModelChoices: 0,
    checkedRulesFallbacks: 0, cancelledOperations: 0, abortedOperations: 0, rejectedTriggers: 0,
    skipsByReason: counts(METRIC_REASONS), attemptOutcomes: counts(METRIC_ATTEMPT_OUTCOMES),
    checkedFallbacksByReason: counts(METRIC_REASONS), latencyBuckets: counts(METRIC_LATENCIES),
    usage: { knownResponses: 0, unknownResponses: 0, inputTokens: null, outputTokens: null },
    options: { validatedModel: [0, 0, 0, 0, 0], checkedModel: [0, 0, 0, 0, 0], checkedRulesDefault: [0, 0, 0, 0, 0] },
    agreement: { validatedAgree: 0, validatedDiverge: 0, checkedAgree: 0, checkedDiverge: 0, unknownCheckedRulesDefault: 0 } };
}
/** Fixed-size, integer-only counters. No events, timestamps, payloads, identities or text are retained.
 * checked* counts accepted queue submissions, NOT applied resolutions. The native v5 audit owns those.
 * Eligibility is a NodeSpec preview or a successful checked Dream/Bribe trigger:
 * both supported rules apply paths always fire a node in a valid World. It is not a NodeRecord/source observation.
 * Rate denominators are explicit: eligibleNodes for skips, postAttempts for attempt outcomes,
 * checkedModelChoices + checkedRulesFallbacks for checked resolutions, knownResponses for token totals.
 * overflowed means these are lower bounds, so consumers must not present exact rates then.
 */
export class DecisionMetrics {
  private overflowed = false;
  private readonly families: Record<DecisionFamily, FamilyDecisionMetrics> = {
    dream_interpretation: family(), magistrate_ruling: family(),
  };
  private add(value: number, amount = 1): number {
    if (amount > Number.MAX_SAFE_INTEGER - value) { this.overflowed = true; return Number.MAX_SAFE_INTEGER; }
    return value + amount;
  }
  eligible(node: DecisionFamily): void { const f = this.families[node]; f.eligibleNodes = this.add(f.eligibleNodes); }
  rejected(node: DecisionFamily): void { const f = this.families[node]; f.rejectedTriggers = this.add(f.rejectedTriggers); }
  cancelled(node: DecisionFamily): void { const f = this.families[node]; f.cancelledOperations = this.add(f.cancelledOperations); }
  aborted(node: DecisionFamily): void { const f = this.families[node]; f.abortedOperations = this.add(f.abortedOperations); }
  skip(node: DecisionFamily, reason: MetricReason): void {
    const f = this.families[node]; f.skipsByReason[reason] = this.add(f.skipsByReason[reason]);
  }
  attempt(node: DecisionFamily): void { const f = this.families[node]; f.postAttempts = this.add(f.postAttempts); }
  attemptFinished(node: DecisionFamily, outcome: MetricAttemptOutcome, elapsed: number): void {
    const f = this.families[node]; f.attemptOutcomes[outcome] = this.add(f.attemptOutcomes[outcome]);
    const bucket = !Number.isFinite(elapsed) || elapsed < 0 ? 'unknown' : elapsed < 250 ? 'lt_250_ms'
      : elapsed < 1000 ? 'lt_1000_ms' : elapsed < 3000 ? 'lt_3000_ms' : elapsed < 10000 ? 'lt_10000_ms' : 'gte_10000_ms';
    f.latencyBuckets[bucket] = this.add(f.latencyBuckets[bucket]);
  }
  responseUsage(node: DecisionFamily, usage: DecisionUsage | null): void {
    const f = this.families[node];
    if (!isDecisionUsage(usage)) { f.usage.unknownResponses = this.add(f.usage.unknownResponses); return; }
    f.usage.knownResponses = this.add(f.usage.knownResponses);
    f.usage.inputTokens = this.add(f.usage.inputTokens ?? 0, usage.input_tokens);
    f.usage.outputTokens = this.add(f.usage.outputTokens ?? 0, usage.output_tokens);
  }
  private option(buckets: OptionCounts, ordinal: number): void {
    if (Number.isInteger(ordinal) && ordinal >= 0 && ordinal < buckets.length) buckets[ordinal] = this.add(buckets[ordinal]!);
  }
  validatedModel(node: DecisionFamily, ordinal: number, agrees: boolean): void {
    const f = this.families[node]; f.validatedModelChoices = this.add(f.validatedModelChoices);
    this.option(f.options.validatedModel, ordinal);
    const key = agrees ? 'validatedAgree' : 'validatedDiverge'; f.agreement[key] = this.add(f.agreement[key]);
  }
  checkedModel(node: DecisionFamily, ordinal: number, agrees: boolean): void {
    const f = this.families[node]; f.checkedModelChoices = this.add(f.checkedModelChoices);
    this.option(f.options.checkedModel, ordinal);
    const key = agrees ? 'checkedAgree' : 'checkedDiverge'; f.agreement[key] = this.add(f.agreement[key]);
  }
  checkedFallback(node: DecisionFamily, reason: MetricReason, defaultOrdinal: number | null): void {
    const f = this.families[node]; f.checkedRulesFallbacks = this.add(f.checkedRulesFallbacks);
    f.checkedFallbacksByReason[reason] = this.add(f.checkedFallbacksByReason[reason]);
    if (defaultOrdinal === null) f.agreement.unknownCheckedRulesDefault = this.add(f.agreement.unknownCheckedRulesDefault);
    else this.option(f.options.checkedRulesDefault, defaultOrdinal);
  }
  /** A detached read-only value: changing a caller's copy cannot mutate the counters or Sim. */
  report(): DecisionMetricsReport {
    return { version: 'decision-metrics-v1', scope: 'page-session', optionBuckets: 'frozen-rust-order-0-through-4',
      appliedEvidence: 'native-v5-audit-only', counterLimit: Number.MAX_SAFE_INTEGER, overflowed: this.overflowed,
      families: structuredClone(this.families) };
  }
}
