import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionMetrics } from '../../src/shared/decision-metrics.ts';

const dream = 'dream_interpretation';
test('metrics expose finite ordinal buckets and separate validated from checked acceptance', () => {
  const metrics = new DecisionMetrics();
  metrics.eligible(dream); metrics.attempt(dream);
  metrics.validatedModel(dream, 1, false); metrics.responseUsage(dream, { input_tokens: 12, output_tokens: 3 });
  metrics.attemptFinished(dream, 'model', 250);
  metrics.checkedFallback(dream, 'invalid_response', 0);
  const report = metrics.report(); const family = report.families[dream];
  assert.equal(report.scope, 'page-session'); assert.equal(report.appliedEvidence, 'native-v5-audit-only');
  assert.equal(family.validatedModelChoices, 1); assert.equal(family.checkedModelChoices, 0);
  assert.equal(family.checkedRulesFallbacks, 1); assert.equal(family.checkedFallbacksByReason.invalid_response, 1);
  assert.deepEqual(family.options.validatedModel, [0, 1, 0, 0, 0]);
  assert.deepEqual(family.options.checkedRulesDefault, [1, 0, 0, 0, 0]);
  assert.equal(family.agreement.validatedDiverge, 1); assert.equal(family.agreement.checkedDiverge, 0);
  assert.equal(family.latencyBuckets.lt_1000_ms, 1);
  assert.deepEqual(family.usage, { knownResponses: 1, unknownResponses: 0, inputTokens: 12, outputTokens: 3 });
  assert.equal(report.families.magistrate_ruling.eligibleNodes, 0);
});

test('usage is unknown without both strict known counters and never converted into neurons', () => {
  const metrics = new DecisionMetrics();
  for (const usage of [null, { input_tokens: 3 }, { input_tokens: 1, output_tokens: 1, neurons: 9 },
    { input_tokens: -1, output_tokens: 0 }, { input_tokens: 0.5, output_tokens: 0 }]) {
    metrics.responseUsage(dream, usage as Parameters<DecisionMetrics['responseUsage']>[1]);
  }
  assert.deepEqual(metrics.report().families[dream].usage,
    { knownResponses: 0, unknownResponses: 5, inputTokens: null, outputTokens: null });
  metrics.responseUsage(dream, { input_tokens: 0, output_tokens: 0 });
  assert.deepEqual(metrics.report().families[dream].usage,
    { knownResponses: 1, unknownResponses: 5, inputTokens: 0, outputTokens: 0 });
  assert.equal(JSON.stringify(metrics.report()).includes('neurons'), false);
});

test('integer counters saturate with an honest sticky lower-bound overflow marker', () => {
  const metrics = new DecisionMetrics();
  metrics.responseUsage(dream, { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 });
  assert.equal(metrics.report().overflowed, false);
  metrics.responseUsage(dream, { input_tokens: 1, output_tokens: Number.MAX_SAFE_INTEGER });
  metrics.responseUsage(dream, { input_tokens: 0, output_tokens: 1 });
  const report = metrics.report();
  assert.equal(report.counterLimit, Number.MAX_SAFE_INTEGER); assert.equal(report.overflowed, true);
  assert.equal(report.families[dream].usage.inputTokens, Number.MAX_SAFE_INTEGER);
  assert.equal(report.families[dream].usage.outputTokens, Number.MAX_SAFE_INTEGER);
  assert.equal(report.families[dream].usage.knownResponses, 3);
});

test('latencies have exact fixed edges; invalid timing has its own unknown bucket', () => {
  const metrics = new DecisionMetrics();
  for (const elapsed of [0, 249, 250, 999, 1000, 2999, 3000, 9999, 10000, Infinity, NaN, -1]) {
    metrics.attempt(dream); metrics.attemptFinished(dream, 'timeout', elapsed);
  }
  assert.deepEqual(metrics.report().families[dream].latencyBuckets,
    { lt_250_ms: 2, lt_1000_ms: 2, lt_3000_ms: 2, lt_10000_ms: 2, gte_10000_ms: 1, unknown: 3 });
});

test('report copies cannot alter counters and unknown defaults stay explicitly unknown', () => {
  const metrics = new DecisionMetrics(); metrics.eligible(dream); metrics.skip(dream, 'disabled');
  metrics.checkedFallback(dream, 'disabled', null);
  const copy = metrics.report(); copy.families[dream].eligibleNodes = 999;
  copy.families[dream].options.checkedRulesDefault[0] = 999;
  assert.equal(metrics.report().families[dream].eligibleNodes, 1);
  assert.deepEqual(metrics.report().families[dream].options.checkedRulesDefault, [0, 0, 0, 0, 0]);
  assert.equal(metrics.report().families[dream].agreement.unknownCheckedRulesDefault, 1);
});
