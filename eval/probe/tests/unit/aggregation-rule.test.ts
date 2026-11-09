// Task 39.4 (V18): the rule text file and the export agree on rule_version, and the Aggregation_Hash is the sha256 of the exact file bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { llmAggregatePermAvg } from '../../src/simwasm.ts';
import { AGGREGATION_RULE_FILE, checkRuleVersion, loadAggregationRule, ruleVersionOf } from '../../src/templates.ts';

const REPO = new URL('../../../../', import.meta.url).pathname;

/** The `rule_version` the export returns, read from the first case of the committed perm-avg inputs. */
function exportRuleVersion(): number {
  const inputs = JSON.parse(readFileSync(`${REPO}fixtures/grading/perm-avg-inputs.json`, 'utf8')) as {
    cards: { frozen_context: unknown; cases: { scope: string; question_id: string; calls: unknown[] }[] }[];
  };
  const entry = inputs.cards[0];
  const c = entry?.cases[0];
  assert.ok(entry !== undefined && c !== undefined, 'perm-avg-inputs.json has no case');
  const out = JSON.parse(llmAggregatePermAvg(JSON.stringify({ frozen_context: entry.frozen_context, scope: c.scope, question_id: c.question_id, calls: c.calls }))) as {
    ok: boolean;
    rule_version: number;
  };
  assert.equal(out.ok, true);
  return out.rule_version;
}

test('the rule file carries one rule_version line equal to the export RULE_VERSION', () => {
  const rule = loadAggregationRule(REPO);
  assert.equal((rule.text.match(/^rule_version: /gm) ?? []).length, 1);
  assert.equal(ruleVersionOf(rule.text), exportRuleVersion());
  checkRuleVersion(rule.text, exportRuleVersion());
});

test('a rule_version mismatch or a missing line is a failure', () => {
  const rule = loadAggregationRule(REPO);
  assert.throws(() => checkRuleVersion(rule.text, exportRuleVersion() + 1), /rule_version/);
  assert.throws(() => checkRuleVersion(rule.text.replace(/^rule_version: .*\n/m, ''), exportRuleVersion()), /no "rule_version/);
  assert.throws(() => checkRuleVersion(rule.text.replace('rule_version: 1', 'rule_version: 2'), exportRuleVersion()), /rule_version 2/);
});

test('the Aggregation_Hash is the sha256 of the exact file bytes, and the file is UTF-8 with LF only', () => {
  const bytes = readFileSync(`${REPO}${AGGREGATION_RULE_FILE}`);
  const rule = loadAggregationRule(REPO);
  assert.equal(rule.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.match(rule.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!bytes.includes(13), 'the rule file has a carriage return');
  assert.ok(bytes.at(-1) === 10, 'the rule file ends with a line feed');
});

test('every Illegal reason code of the export is listed in the [illegal] section', () => {
  const rule = loadAggregationRule(REPO).text;
  const listed = new Set([...rule.slice(rule.indexOf('[illegal]')).matchAll(/^([a-z_]+): /gm)].map((m) => m[1]));
  const golden = JSON.parse(readFileSync(`${REPO}fixtures/grading/perm-avg-golden.json`, 'utf8')) as {
    cards: { cases: { result: string }[] }[];
  };
  const seen = new Set<string>();
  for (const card of golden.cards) {
    for (const c of card.cases) {
      const a = (JSON.parse(c.result) as { answer: { kind: string; reason?: string } }).answer;
      if (a.kind === 'illegal' && a.reason !== undefined) seen.add(a.reason);
    }
  }
  assert.ok(seen.size > 0);
  for (const reason of seen) assert.ok(listed.has(reason), `reason ${reason} is not in the rule file`);
});
