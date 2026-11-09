// llm-probe task 25.3: the one `loadPhaseState` (DA-23) loads pass results, so the run gate and `phase-status`
// compute the same branch. SYNTHETIC card set and results in temp dirs; the real eval/results and locked.jsonl
// are never touched, and no Workers AI request is made.
// **Validates: Requirements 18.2, 11.20.**
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readLedger } from '../../src/ledger.ts';
import { phaseStatus } from '../../src/phase.ts';
import { readPhaseState } from '../../src/phase-commands.ts';
import { loadPhaseState, reportPaths } from '../../src/report-command.ts';
import { gradesPathFor } from '../../src/results.ts';
import { devRun, lockedRun } from '../../src/run.ts';
import { capture, createFakeRuntime, FAKE_COMBO, makeEnv } from './run.helpers.ts';

/** Marks every stored grade acceptable, not severe, flip-free and contrast-consistent, so the run passes R13.4 whatever the fake model said. */
function makeGradesPerfect(file: string): void {
  const out = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const rec = JSON.parse(l) as { grade?: Record<string, unknown>; identity?: unknown; contrast?: Record<string, unknown> };
      if (rec.grade !== undefined) Object.assign(rec.grade, { acceptable: true, illegal: false, severe: false, severe_conditions: [] });
      // One identity for every Permutation (no Flip), and every Contrast_Pair consistent.
      if (rec.identity !== undefined) rec.identity = { kind: 'option', option: 'same' };
      if (rec.contrast !== undefined) rec.contrast.consistent = true;
      return JSON.stringify(rec);
    });
  fs.writeFileSync(file, out.join('\n') + '\n');
}

test('loadPhaseState loads pass results: an in-browser Combination that passes gives branch A; the pass-less state recomputes B', async () => {
  const env = makeEnv();
  const deps = env.deps(createFakeRuntime());
  fs.mkdirSync(path.join(env.root, 'eval/probe'), { recursive: true });
  const paths = reportPaths(env.root);
  fs.writeFileSync(paths.combinations, JSON.stringify([{ ...FAKE_COMBO }]));
  const dev = await capture(() => devRun(deps, { combo: FAKE_COMBO.id, task: 'DS' }));
  assert.equal(dev.value, 0, dev.err);
  const run = await capture(() => lockedRun(env.deps(createFakeRuntime()), { combo: FAKE_COMBO.id, task: 'DS' }));
  assert.equal(run.value, 0, run.err);
  const [entry] = readLedger(paths.ledger).entries;
  assert.ok(entry && entry.status === 'complete');
  makeGradesPerfect(gradesPathFor(path.join(env.root, 'eval/results/locked', `${entry.entry_id}.jsonl`)));

  const loaded = await loadPhaseState({ ...paths, cardsDir: env.cards.dir });
  assert.deepEqual(loaded.passes.get(entry.entry_id), { decision: true, synthesis: true });
  const status = phaseStatus(loaded);
  assert.equal(status.ended, true);
  assert.equal(status.branch, 'A');

  // The old gate state had no pass results, so it always recomputed branch B.
  const bare = await readPhaseState(paths);
  assert.equal(bare.passes.size, 0);
  assert.equal(phaseStatus(bare).branch, 'B');
});

test('loadPhaseState does not open the Card_Set when no entry is complete', async () => {
  const env = makeEnv();
  const paths = reportPaths(env.root);
  fs.mkdirSync(path.dirname(paths.combinations), { recursive: true });
  fs.writeFileSync(paths.combinations, JSON.stringify([{ ...FAKE_COMBO }]));
  const state = await loadPhaseState({ ...paths, cardsDir: path.join(env.root, 'no-such-cards') });
  assert.equal(state.passes.size, 0);
});
