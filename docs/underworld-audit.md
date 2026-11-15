# underworld: requirement audit (task 13.1)

Audited 2026-11-15 by Kiro against commit `06813b4` (HEAD, working tree clean, 63 commits ahead of `origin/main`, nothing pushed). Implementation was done by the external terminal agent; this audit is Kiro's. Evidence comes from the design's Correctness Properties and their `Validates:` lines, named tests, `scripts/gates.sh`, `git log` and `docs/kiro-log.md`. Rows that rest on inspection say so. `eval/cards/cards/locked.jsonl`, `eval/cards/review/locked.md`, `eval/cards/blind/*` and the root `env` were not opened. No source was changed.

Status values: `met`, `met with note`, `not met`.

## Checks run in this audit

- `scripts/gates.sh` in a fresh clone of `06813b4` under `/tmp` (no `env` file, clean `target/`): exit 0, `All gates passed.`, wall time 1,258 s. Short batch `20/20 seeds ok`. Passive acceptance batch `5/5 seeds ok`, final checksums `b7d43807a7b10c1c`, `60aac25e66d04ee4`, `d42c8597714be26a`, `8827a29693a6db43`, `24761c26dae6c515` (equal to the 6.18, 10.1 and 10.3 entries); totals `dreams=1 hauntings=0 bribes=2 birth_claims=2 imported_claims=0 rebuilt_claims=0 carry_overs=6 nodes_dream_interpretation=1 nodes_magistrate_ruling=2`. Devoted gate `5/5 seeds ok`, final checksums `6aab26584ea42cd5`, `5324c9766084c792`, `08116b4277f98f89`, `3241b96e371af404`, `0b0f19d6f5972a90`, per-seed Player_Wait credit 124, 500, 331, 770, 500 (equal to 9.5 and 10.3); totals `dreams=5 hauntings=5 bribes=5 birth_claims=2 imported_claims=1 rebuilt_claims=2 carry_overs=5 nodes_dream_interpretation=5 nodes_magistrate_ruling=5`, `afford_candidates=dream:5,haunting:5,bribe:5,imported:4,rebuilt:3` reported separately. Smoke_Test `2 passed`.
- R14.4: `git diff --exit-code afaf87c -- crates/sim-core/src/llm eval/probe/templates/decision.system_one.v1.txt` exits 0; `tests/source_guard.rs` pins the protected file set and hashes.
- Properties 1 to 23 each have a test carrying `// Feature: underworld, Property <n>` (`crates/sim-core/tests/underworld.rs`, `crates/sim-cli/tests/auto_player.rs`, `crates/sim-cli/tests/batch_gate.rs`).
- Commits since `46e4428` that change a per-tick Checksum recorded in `fixtures/parity/` carry the regeneration line. `7e40319` changes only the Snapshot fixture (not a per-tick Checksum) and `05fbd88` only the fixture README; neither needs it under R14.5.
- No package added (`git diff 46e4428 HEAD -- Cargo.lock` adds no `name`), no change under `web/src`, no `HashMap`, `HashSet` or float in `sim-core/src/underworld` or `sim-cli/src/{auto_player,batch}.rs`.
- `docs/kiro-log.md`: no commit since `1e4193d` deletes a line (20 commits checked, `del=0` each). Findings 2 and 3.

## Table

| ID | Criterion (short) | Status | Evidence |
|---|---|---|---|
| R1.1 to R1.4 | Joss_Balance per Soul, ledger, conservation, no credit while embodied | met | Property 1, Property 18; per-tick `U1.2`, `U1.3`; C1 `u1_3_flags_a_balance_that_differs_from_the_log`, `u1_2_flags_a_credit_with_no_owning_soul`; C2 U1.3 (target label, batch reached). |
| R2.1 to R2.8 | Offerings, cap on credits and capped spends, magnitude, no money | met | Property 2, Property 3; `U2.5`, `U2.6`; C1 `u2_5_…`, `u2_6_…`; C2 U2.5 (earlier `offerings.rs:165` assertion; Devoted re-run first guard `U1.3`), U2.6 (target label, and on the Devoted re-run). Formula unchanged by the Author's OP-U15 decision. |
| R3.1 to R3.10 | Decision_Node convention | met | Property 4, 5, 7, 8, 10, 14, 18. |
| R3.11 | Partial effects at resolution | met | Unit test `magistrate.rs::a_standing_claim_after_a_bribe_skips_the_effect_and_keeps_the_record`; documented in `dreams.rs`, `carry_over.rs`, `underworld/mod.rs`. |
| R4.1 to R4.7 | Dreams | met | Property 8, 14, 7; `U4.3`; C1 `u4_3_…`; C2 U4.3. R4.2 by the `InputPayload::Dream { dreamer, intent }` type (inspection). |
| R5.1 to R5.4 | Hauntings | met | Property 9, 14; `U5.3`; C1 `u5_3_…`; C2 U5.3 (handler checks bypassed only, append and checker intact); R11.15 test `a_haunting_applies_and_changes_only_mood`. |
| R6.1, R6.2, R6.4 to R6.7 | Bribes and ruling | met with note | Property 5, 6, 10, 14. Atomicity fixed in 6.18 (`World::check_append` shared by `append` and `append_all`; tests `a_bribe_on_a_near_exhausted_event_counter_is_rejected_atomically`, `append_all_refuses_a_swapped_appeal_and_writes_nothing`, `a_bribe_with_a_swapped_appeal_spends_nothing_and_fires_no_node`; checksums and fixtures unchanged). Note: finding 4. |
| R6.3 | Exactly three ruling options | met with note | Inspection: `RULING_OPTIONS` is the only source of the option set; tests check membership only. Finding 5. |
| R7.1 to R7.10 | Birth_Slots and Standing_Slots | met | Property 11, 14, 17, 19; R7.3 unit test `slots.rs::a_second_claim_is_rejected_claim_held_and_the_first_is_slot_claimed`; `U7.10`, C1 and C2 U7.10; R11.15 tests `an_imported_claim_creates_the_vessel`, `a_birth_slot_claim_places_the_player_at_birth`. |
| R7.11 | Rebuilt_Body same body as Imported_Vessel | met with note | `a_rebuilt_claim_creates_an_imported_shaped_body` (function-only). Note: no unique benefit by design (Author, option A); customization is the committed spec 6 node in `structure.md`. |
| R8.1 to R8.4 | Player_Soul maximum wait | met | Property 11, 12; `U8.3`; C1 and C2 U8.3 (batch reached). |
| R9.1 to R9.5 | Carry-over | met | Property 13, 14, 21. |
| R10.1 to R10.3 | NPC Souls | met | Property 1, 2, 19. |
| R11.1 to R11.6, R11.10, R11.11, R11.14 | Auto_Player, report | met | Property 20, 21, 22, 23; R11.9/R11.12 superseded by the Author's OP-U14 decision (passive counts report-only). |
| R11.7, R11.8 | LS-R17 on the Acceptance_Seeds, passive gate | met | Passive gate in this audit's gate run. |
| R11.13, R11.15 | Targeted functional tests | met | The four named tests in `tests/underworld.rs`, doc comments say function-only. |
| R11.16, R11.17 | Devoted reachability gate, candidates vs success | met | Devoted gate in this audit's gate run; `DEVOTED_ZERO_COUNT_LIST` (eight applied counts), `birth_claims` and `afford_candidates` report-only; C2 faults never-haunts, drop-RebuiltBody, skip-CarryOver each print the expected `FAIL zero counts:` line (kiro-log 10.2). |
| R12.1 to R12.3 | Per-tick checks, first violation, proptest failure | met | `invariants.rs` additions; batch and proptest run the same checker. |
| R12.4 | C1 checker recognition | met | `tests/underworld_checker.rs` (U1.2, U1.3, U2.5, U2.6, U4.3, U5.3, U7.10, U8.3) and `invariants.rs` unit tests (U15.1, U15.4 to U15.8, 5.8). |
| R12.5, R12.6 | C2 system detection, records judged one by one | met with note | kiro-log 6.15b table and U15.8 closure, 10.2 extra re-runs; Kiro's review entry. Note: finding 6. |
| R13.1 to R13.5 | Snapshot | met | Property 17; `parity.rs` snapshot fixture native and WASM. |
| R14.1 to R14.3 | Determinism, replay, card format | met | Property 16, 18, 19; native and WASM parity tests. |
| R14.4 | `llm/` and template byte-identical | met | Diff check and `source_guard.rs` hash test. |
| R14.5 | Regeneration stated | met | Commit scan above. |
| R14.6 | A fixture with an applied External_Choice | met | `fixtures/parity/seedU-underworld.replay.json` (seed 45, `Choose` at tick 765); `parity.rs` asserts an External `NodeRecord`. |
| R14.7 | Gates from a clean build | met with note | This audit (1,258 s) and kiro-log 12.1 (1,239 s). Note: finding 7. |
| R15.1 to R15.14 | The Magistrate | met | Property 7, 14, 15, 17; `U15.1`, `U15.4` to `U15.8` with C1 tests; C2 U15.8 (append refusal, half-applied Bribe found by Property 14 before 6.18). |

## Findings

1. **Task checkboxes.** 10.1 and 12.1 are unchecked although their acceptance is logged (`aa02308`, `06813b4`); the agent did not change checkboxes for those leaves. Parents 3, 6, 9, 10, 11 and 12 are unchecked although every leaf under them is checked. Leaves 6.15, 6.18, 9.4 and 9.6 start at column 0, so they render as top-level tasks (formatting only).
2. **Log integrity.** No committed line was deleted or changed. The WIP archive `a7b6ddf` appended three earlier uncommitted entries (6.15 continuations of 2026-11-14 and 2026-11-15, 10.1 calibration runs) at the end of the file; Kiro compared them with its own copy of the working tree taken at 12:02 on 2026-11-15 and found each section byte-identical. They sit out of chronological order with their original dates, and the reason is in the commit message only. The archived `underworld.proptest-regressions` line is kept without independent reproduction, as the agent says.
3. **Duplicated log entries.** Four entries appear twice, verbatim: "6.16 function-only Rebuilt_Body acceptance" and "6.15a C1 checker-recognition acceptance" (first in `3fa9b64`, again in `e49f8fd`), "task 9.6 split zero-count lists" (`07f7915`, again in `df68c09`), "task 11.1 external-choice fixture search" (`4441879`, again in `bc5df09`). Append-only rules forbid deleting them; a note entry naming them is enough. Process cause shared by Kiro: Kiro committed its own entries five times with an index-only patch while the agent's entries stayed uncommitted in the same file, which made the later archive necessary.
4. **U15.8 before 6.18.** With the Appeal actor swap, the passive 80-year release batch exited 0 with `bribes=0`: every Bribe left a BribeOffering and a spend behind a rejected input, and no per-tick check sees that. 6.18 removed the path (atomic `append_all`). Recorded as evidence that the release batch alone cannot detect half-applied inputs.
5. **R6.3 test.** No test asserts that the ruling option set equals exactly `grant_next_slot`, `grant_later_slot`, `deny`; it holds by the single constant `RULING_OPTIONS`.
6. **Fault table error (Kiro's design).** The prescribed U2.5 fault (`credit` ignores the cap) cannot reach the U2.5 checker, because the offering Event caps its `credited` field before calling `credit`; the earlier assertion (debug) or U1.3 (release, and on the Devoted re-run) catches it instead. C1 covers the U2.5 label.
7. **Gate time.** 1,258 s here, 1,239 s in 12.1, against 346 s at the end of life-sim. `cargo test --workspace` takes about 1,030 s of it in debug: `tests/underworld.rs` 635 s, `sim-cli` `tests/auto_player.rs` 140 s, `tests/cli.rs` 80 s. The two 80-year steps take about 48 s together. The CI job has `timeout-minutes: 45`; the last CI run took 1.3 times the local time, so about 27 minutes is expected. No optimization was made.
8. **Rebuilt_Body.** No unique benefit in this spec, by the Author's decision; the spec 6 node with acceptance targets (a) to (d) is in `structure.md` and the rebirth roles are in `product.md`. Passive players never claim one; the Devoted gate shows two applied claims on normal mechanics.
9. **Target date.** Kiro's log entry of 2026-11-15 ("The underworld target date 2026-11-15 is missed") was premature: implementation and the final gate run finished on 2026-11-15 (`06813b4`, 22:06); audit and push remain.
10. **Open for later specs.** The 3.66-year median to first zero for positive kin Relations is to be watched in spec 6 (OP-U15). A precise append-refusal mapping (F1 residual) is a later design. Task 13.1 stays unchecked until the Author has reviewed these findings.
