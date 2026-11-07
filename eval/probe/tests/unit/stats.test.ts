import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SplitMix64,
  bootstrapUnits,
  intraGroupCorrelation,
  latencySummary,
  weakEvidenceLabel,
  wilsonInterval,
} from '../../src/stats.ts';

test('SplitMix64 matches the reference sequence for seed 0', () => {
  const r = new SplitMix64(0n);
  assert.equal(r.next(), 0xe220a8397b1dcdafn);
  assert.equal(r.next(), 0x6e789e6aa1b965f4n);
});

test('Wilson 8 of 10, 0 of 10, 10 of 10', () => {
  const a = wilsonInterval(8, 10)!;
  assert.ok(Math.abs(a.lower - 0.4902) < 0.0005 && Math.abs(a.upper - 0.9433) < 0.0005);
  assert.equal(wilsonInterval(0, 10)!.lower, 0);
  assert.equal(wilsonInterval(10, 10)!.upper, 1);
  assert.equal(wilsonInterval(0, 0), null);
});

test('bootstrap is reproducible and bounded', () => {
  const units = [
    { k: 2, m: 3 },
    { k: 3, m: 3 },
    { k: 1, m: 2 },
    { k: 0, m: 1 },
  ];
  const a = bootstrapUnits(units, 1000)!;
  const b = bootstrapUnits(units, 1000)!;
  assert.deepEqual(a, b);
  assert.ok(a.lowerRate <= a.upperRate);
  assert.equal(bootstrapUnits([]), null);
});

test('weak-evidence labels at the margin', () => {
  assert.equal(weakEvidenceLabel({ k: 4, m: 5 }, 80), 'pass');
  assert.equal(weakEvidenceLabel({ k: 7, m: 10 }, 80), 'pass (interval overlaps threshold)');
  assert.equal(weakEvidenceLabel({ k: 69, m: 100 }, 80), 'pass with weak evidence');
});

test('intra-group correlation: estimable and not estimable', () => {
  const r = intraGroupCorrelation([{ k: 3, m: 3 }, { k: 0, m: 3 }, { k: 3, m: 3 }, { k: 0, m: 3 }]);
  assert.equal(r.kind, 'estimable');
  if (r.kind === 'estimable') assert.ok(Math.abs(r.value - 1) < 1e-9);
  assert.equal(intraGroupCorrelation([{ k: 1, m: 3 }]).kind, 'not_estimable');
  assert.equal(intraGroupCorrelation([{ k: 3, m: 3 }, { k: 2, m: 2 }]).kind, 'not_estimable');
});

test('latency percentiles use text outcomes only', () => {
  const s = [];
  for (let i = 1; i <= 60; i++) s.push({ outcome: { kind: 'text' }, latency_ms: i });
  s.push({ outcome: { kind: 'timeout' }, latency_ms: 99999 }, { outcome: { kind: 'error' }, latency_ms: 5 });
  const l = latencySummary(s);
  assert.deepEqual(l, { covered: 60, timeouts: 1, errors: 1, p50: 30, p95: 57 });
  const none = latencySummary([{ outcome: { kind: 'timeout' }, latency_ms: 1 }]);
  assert.equal(none.p50, 'no data');
  assert.equal(none.timeouts, 1);
});
