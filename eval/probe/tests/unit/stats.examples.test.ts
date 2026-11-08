import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latencySummary, nearestRank, weakEvidenceLabel, wilsonInterval } from '../../src/stats.ts';

// Wilson 95% interval examples (llm-probe task 9.9; requirement 13.11).
// This file is the target of the 9.12 fault injection: with z set to 1.0 the 8-of-10 bounds
// move far outside the 0.0005 tolerance and these assertions must fail.
// Hand check, 8 of 10, z = 1.96: p = 0.8, z² = 3.8416, denom = 1 + 0.38416 = 1.38416,
// centre = (0.8 + 0.19208) / 1.38416 = 0.71674, half = 1.96·sqrt(0.016 + 0.009604) / 1.38416
// = 0.31362 / 1.38416 = 0.22659, so [0.49015, 0.94333].

const TOLERANCE = 0.0005;

test('Wilson 8 of 10 is about [0.4902, 0.9433], both bounds', () => {
  const w = wilsonInterval(8, 10);
  assert.notEqual(w, null);
  assert.ok(Math.abs(w!.lower - 0.4902) < TOLERANCE, `lower ${w!.lower}`);
  assert.ok(Math.abs(w!.upper - 0.9433) < TOLERANCE, `upper ${w!.upper}`);
});

test('Wilson 0 of 10 has lower bound exactly 0 and a positive upper bound', () => {
  const w = wilsonInterval(0, 10)!;
  assert.equal(w.lower, 0);
  assert.ok(w.upper > 0 && w.upper < 1);
});

test('Wilson 10 of 10 has upper bound exactly 1 and a lower bound below 1', () => {
  const w = wilsonInterval(10, 10)!;
  assert.equal(w.upper, 1);
  assert.ok(w.lower > 0 && w.lower < 1);
});

test('Wilson with n = 0 is null', () => {
  assert.equal(wilsonInterval(0, 0), null);
});

// Percentile and label examples (llm-probe task 9.9b; requirement 13.13).

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

test('nearest rank over 1..60 reads index 29 (value 30) and index 56 (value 57)', () => {
  const v = range(60);
  assert.equal(nearestRank(v, 50), 30);
  assert.equal(nearestRank(v, 95), 57);
  assert.equal(v[29], 30);
  assert.equal(v[56], 57);
});

test('nearest rank over 1..10000 reads index 4999 (value 5000) and index 9499 (value 9500)', () => {
  const v = range(10_000);
  assert.equal(nearestRank(v, 50), 5000);
  assert.equal(nearestRank(v, 95), 9500);
});

test('latencySummary sorts unordered text samples before taking percentiles', () => {
  const samples = range(60)
    .reverse()
    .map((latency_ms) => ({ outcome: { kind: 'text' }, latency_ms }));
  const s = latencySummary(samples);
  assert.equal(s.covered, 60);
  assert.equal(s.p50, 30);
  assert.equal(s.p95, 57);
});

test('label: lower bound exactly at the threshold is "pass"', () => {
  assert.equal(weakEvidenceLabel({ k: 8000, m: 10_000 }, 80), 'pass');
});

test('label: lower bound exactly 10 points under is "pass (interval overlaps threshold)"', () => {
  assert.equal(weakEvidenceLabel({ k: 7000, m: 10_000 }, 80), 'pass (interval overlaps threshold)');
});

test('label: one resample step more than 10 points under is "pass with weak evidence"', () => {
  assert.equal(weakEvidenceLabel({ k: 6999, m: 10_000 }, 80), 'pass with weak evidence');
});

test('label: one resample step under the threshold is "pass (interval overlaps threshold)"', () => {
  assert.equal(weakEvidenceLabel({ k: 7999, m: 10_000 }, 80), 'pass (interval overlaps threshold)');
});

test('nearest rank on 30 values takes the 15th and the 29th, not interpolated positions', () => {
  const v = Array.from({ length: 30 }, (_, i) => (i + 1) * 100);
  assert.equal(nearestRank(v, 50), 1500);
  assert.equal(nearestRank(v, 95), 2900);
});
