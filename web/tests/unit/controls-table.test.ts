// Feature: web-shell, controls table (task 3.6)
//
// Validates: Requirements 3.8, 4.7, 4.8, 4.9, 4.10
//
// `controls(s)` (ui-state.ts) derives which of the four buttons -- Create, Run,
// Pause, Step -- are enabled from the current UiState. The design (ui-state.ts)
// fixes the rules:
//   - Run, Pause and Step are all disabled in `no-world` and `failed` (R4.7).
//   - In `running`, only Pause is enabled; Run and Step are disabled (R4.8).
//   - In `paused`, Run and Step are enabled and Pause is disabled; Step is also
//     disabled while a step reply is outstanding (`stepPending`) (R4.9, R4.10).
//   - Create is enabled except while a create-world is in flight (`createPending`)
//     or the worker has failed (R3.8).
//
// This test is exhaustive rather than randomized: `controls` reads exactly three
// fields -- `runState`, `stepPending`, `createPending` -- so the full input space
// is the 4 x 2 x 2 = 16 combinations of their legal values. Each combination is
// checked against an independently stated expectation (`expected` below), so a
// change to the enablement rules in `ui-state.ts` fails here rather than slipping
// through. The remaining UiState fields are filled with legal placeholder values
// that `controls` never reads; varying them cannot change the result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controls, type UiState } from '../../src/main/ui-state.ts';
import type { RunState } from '../../src/shared/protocol.ts';

/** The four Run_States, the full domain of the first axis (R4.7-R4.9). */
const RUN_STATES: readonly RunState[] = ['no-world', 'paused', 'running', 'failed'];
/** The two boolean axes. */
const BOOLS: readonly boolean[] = [false, true];

/** The enabled set `controls` returns, restated here for the expectation. */
interface Controls {
  create: boolean;
  run: boolean;
  pause: boolean;
  step: boolean;
}

/**
 * The expected enabled set for a combination, written independently of
 * `controls` so that the two must agree:
 *   - Create: on unless a create is pending or the worker failed (R3.8).
 *   - Run:    on only when paused (R4.7-R4.9).
 *   - Pause:  on only when running (R4.7-R4.9).
 *   - Step:   on only when paused and no step reply is outstanding (R4.9, R4.10),
 *             and therefore off in every other Run_State (R4.7, R4.8).
 */
function expected(runState: RunState, stepPending: boolean, createPending: boolean): Controls {
  return {
    create: !createPending && runState !== 'failed',
    run: runState === 'paused',
    pause: runState === 'running',
    step: runState === 'paused' && !stepPending,
  };
}

/**
 * Build a UiState for a combination. Only the three fields `controls` reads are
 * set from the combination; the rest are legal placeholders the function never
 * looks at (a mid-run snapshot with a real tick and checksum), chosen so the
 * placeholders cannot accidentally match the expectation.
 */
function stateFor(runState: RunState, stepPending: boolean, createPending: boolean): UiState {
  return {
    worldId: 1,
    runState,
    tick: '42',
    checksum: 'a1b2c3d4e5f60718',
    tps: 123,
    speed: 365,
    error: null,
    seedMessage: null,
    createPending,
    stepPending,
  };
}

test('controls table: every Run_State x stepPending x createPending combination (16) matches the rules', () => {
  const seen: string[] = [];

  for (const runState of RUN_STATES) {
    for (const stepPending of BOOLS) {
      for (const createPending of BOOLS) {
        const label = `${runState} step=${stepPending} create=${createPending}`;
        seen.push(label);

        const got = controls(stateFor(runState, stepPending, createPending));
        const want = expected(runState, stepPending, createPending);
        assert.deepEqual(got, want, `controls mismatch for ${label}`);
      }
    }
  }

  // The enumeration covered every combination exactly once (4 x 2 x 2 = 16).
  assert.equal(seen.length, 16, 'exactly 16 combinations enumerated');
  assert.equal(new Set(seen).size, 16, 'all 16 combinations are distinct');
});

// Spot checks of the four Run_States, stated directly rather than via `expected`,
// so the table above is anchored to concrete truths.
test('controls table: no-world and failed disable run, pause and step (R4.7)', () => {
  for (const runState of ['no-world', 'failed'] as const) {
    for (const stepPending of BOOLS) {
      for (const createPending of BOOLS) {
        const c = controls(stateFor(runState, stepPending, createPending));
        assert.equal(c.run, false, `${runState}: run disabled`);
        assert.equal(c.pause, false, `${runState}: pause disabled`);
        assert.equal(c.step, false, `${runState}: step disabled`);
      }
    }
  }
});

test('controls table: running enables only pause (R4.8)', () => {
  for (const stepPending of BOOLS) {
    for (const createPending of BOOLS) {
      const c = controls(stateFor('running', stepPending, createPending));
      assert.equal(c.run, false, 'running: run disabled');
      assert.equal(c.step, false, 'running: step disabled');
      assert.equal(c.pause, true, 'running: pause enabled');
    }
  }
});

test('controls table: paused enables run and step, step gated by stepPending (R4.9, R4.10)', () => {
  for (const createPending of BOOLS) {
    const idle = controls(stateFor('paused', false, createPending));
    assert.equal(idle.run, true, 'paused: run enabled');
    assert.equal(idle.pause, false, 'paused: pause disabled');
    assert.equal(idle.step, true, 'paused, no step pending: step enabled');

    const pending = controls(stateFor('paused', true, createPending));
    assert.equal(pending.run, true, 'paused: run still enabled while a step is pending');
    assert.equal(pending.pause, false, 'paused: pause disabled');
    assert.equal(pending.step, false, 'paused, step pending: step disabled (R4.10)');
  }
});

test('controls table: create is on except while pending or failed (R3.8)', () => {
  for (const runState of RUN_STATES) {
    for (const stepPending of BOOLS) {
      // createPending false: on unless failed.
      const notPending = controls(stateFor(runState, stepPending, false));
      assert.equal(notPending.create, runState !== 'failed', `${runState}: create on iff not failed`);

      // createPending true: always off.
      const pending = controls(stateFor(runState, stepPending, true));
      assert.equal(pending.create, false, `${runState}: create off while a create is pending`);
    }
  }
});
