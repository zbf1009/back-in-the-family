// Guards D_CONTRAST_OBSERVATION (section 9) against going stale: the figures it quotes are recomputed from the stored
// Locked results (the same pipeline `probe report` uses) and from the Author-supplied External reference file.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCards } from '../../src/cards.ts';
import { gatherReportInput, reportCardsFrom, reportPaths } from '../../src/report-command.ts';
import { D_CONTRAST_OBSERVATION } from '../../src/report.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

test('D_CONTRAST_OBSERVATION figures match the stored Locked metrics', async () => {
  const paths = reportPaths(REPO);
  const input = await gatherReportInput(paths, reportCardsFrom(loadCards({ cardsDir: paths.cardsDir, splits: ['dev', 'locked'] })), '2026-11-10');
  const d = (needle: string): { num: number; den: number } => {
    const runs = input.lockedRuns.filter((r) => r.id.endsWith(needle));
    assert.equal(runs.length, 1, needle);
    const t = runs[0]!.tasks.find((x) => x.metrics.task === 'decision');
    assert.ok(t !== undefined, needle);
    return { num: t.metrics.contrast.num, den: t.metrics.contrast.den };
  };
  const got = {
    gemma: d('-workers-ai-gemma-4-26b-a4b-it'),
    clef: d('-workers-ai-clef'),
    clefFlash: d('-workers-ai-clef-flash'),
    qwen08: d('-webllm-qwen3-5-0-8b-q4f32-nvidia'),
    qwen2: d('-webllm-qwen3-5-2b-q4f32-nvidia'),
  };
  assert.deepEqual(got, {
    gemma: { num: 3, den: 15 },
    clef: { num: 4, den: 15 },
    clefFlash: { num: 3, den: 15 },
    qwen08: { num: 0, den: 15 },
    qwen2: { num: 0, den: 15 },
  });
  const ref = JSON.parse(fs.readFileSync(path.join(REPO, 'eval/results/external/teacher-upper-bound/author-supplied.json'), 'utf8')) as {
    tasks: { task_type: string; figures: { consistent_pairs: number; pairs: number } }[];
  };
  const refD = ref.tasks.find((t) => t.task_type === 'D')!.figures;
  assert.deepEqual([refD.consistent_pairs, refD.pairs], [11, 15]);
  assert.ok(D_CONTRAST_OBSERVATION.includes('(gemma-4-26b-a4b-it 3, clef 4, clef-flash 3)'));
  assert.ok(D_CONTRAST_OBSERVATION.includes('WebLLM Combinations reach 0 of 15'));
  assert.ok(D_CONTRAST_OBSERVATION.includes('(11 of 15)'));
});
