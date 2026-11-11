# life-sim: requirement audit (task 16.1)

Audited 2026-11-11 by Kiro against commit `e115870` (HEAD, working tree clean). Implementation (tasks 1.1 to 15.1) was done by the external terminal agent; this audit is Kiro's (division of labor, kiro-log 2026-11-10). Evidence comes from the `Validates:` mapping of the design's Correctness Properties, the test files, `scripts/gates.sh`, `git log` and `docs/kiro-log.md`. Rows that rest on inspection say so. `eval/cards/cards/locked.jsonl`, `eval/cards/review/locked.md`, `eval/cards/blind/*` and the root `env` were not opened. No source was changed.

Status values: `met`, `met with note`, `not met`.

## Checks run in this audit

- `scripts/gates.sh` in a fresh clone of `e115870` under `/tmp` (no `env` file): ended with `All gates passed.` The short batch printed `batch: 20/20 seeds ok`; the acceptance batch (`--seeds 1..=5 --ticks 29200 --require-targets`) printed `batch: 5/5 seeds ok` with final checksums `0b75afbd35cf9e3b`, `fe6084a6bbbac176`, `46a8b40a7d8c34f0`, `b786e54976e82b1b`, `8ce9509847022d99`, equal to the design note "Calibration result (2026-11-11)". Smoke_Test `2 passed`. The wall time of this run was not captured (the `time` output was lost); the agent's clean-build figure is 311 s (kiro-log task 15.1).
- R15.8: `git diff --exit-code afaf87c -- crates/sim-core/src/llm eval/probe/templates/decision.system_one.v1.txt` exits 0.
- Every commit after `89c71c8` that changed a file under `fixtures/parity/` says "regenerated" in its message, except `1ac6234`, which adds the new snapshot fixture and regenerates nothing.
- Properties 1 to 18 each have a test that names them: P1 `tests/invariants.rs`, P2 `tests/invariants.rs` + `tests/life_gen`, P3 to P7 `tests/history.rs`, P8 `src/social.rs`, P9 and P10 `tests/inputs.rs`, P11 `src/world.rs`, P12 `tests/opening.rs`, P13 `src/names.rs`, P14 and P16 `tests/properties.rs`, P15 `tests/context_builder.rs`, P17 `tests/replay.rs`, P18 `tests/snapshot.rs`.
- No rule keyed on a population bound in `crates/sim-core/src` (grep for the 35/40/60/65 constants finds them only in `sim-cli` reporting).

## Table

| ID | Criterion (short) | Status | Evidence |
|---|---|---|---|
| R1.1 | No `Entity`, `Workload`, Light/Pairwise, placeholder step | met | Model swap `0a2af4b`; `grep` finds `workload` only in rejection code and tests. |
| R1.2 | Configs without `workload` | met | `fixtures/configs/*.json`, web unit tests adapted in `dac3d47`. |
| R1.3 | A `workload` field is rejected | met | `replay.rs` unit test, `tests/replay.rs::a_config_with_a_workload_field_is_rejected_and_no_world_is_created`, `cli.rs` (exit 2), `sim-wasm/tests/parity.rs`. |
| R1.4 | `InputPayload` acts on the life model, a valid one changes the Checksum | met | Property 9. |
| R1.5 | Invalid input skipped and recorded in the Checksum | met | Property 10. |
| R2.1, R2.4 | Person fields; death keeps the record | met | Types in `world.rs` (`Life` enum carries the death tick); Property 3. |
| R2.2 | Traits in -3..=3 | met | `values::Trait` newtype; Property 2. |
| R2.3 | Age rounded down | met | Property 11. |
| R2.5 | Monotonic counters | met | Property 3. |
| R3.1 to R3.6 | Households, money, property | met | Property 1 (3.1, 3.5), Property 2 (3.3, 3.6); 3.2 by construction (members derived from `Life::Alive`); 3.4 by `economy::flow` being the only balance writer (inspection) and Property 1's conservation check. |
| R4.1 to R4.9 | Relations and kinship | met | Property 1 (4.4), Property 2 (4.2, 4.3, 4.5, 4.6), Property 3 (4.7, 4.9), Property 8 (4.8); 4.1 by the `Score`/`RelTags` types. Sign defect found and fixed during task 6.3 (kiro-log "social effects applied in the wrong direction"). |
| R5.1 to R5.10 | Event log | met | Properties 4, 5, 6 (5.1), 3 (5.2), 2 (5.6, 5.7), 1 (5.8), 14 (5.10); 5.3, 5.4, 5.5, 5.9 by construction: each `EventKind` variant carries exactly its card actors, magnitude and `due_tick` (`events.rs`). |
| R6.1 to R6.5 | Aging and death | met with note | Properties 1, 2, 4, 10. Note: the write order inside one death settlement differs from the design (finding 4). |
| R7.1 to R7.3 | Inheritance and debts at death | met | Property 4 (7.1, 7.2), Property 2 (7.3). |
| R8.1 to R8.5 | Debts | met | Property 6, Property 2 (8.3, 8.4). The Property 6 expectation was corrected in `f058096` (a same-tick `debt_transfer` changes the payer); not logged in kiro-log, only in the commit message. |
| R9.1 to R9.6 | Soul identity | met | Property 1 (9.1 to 9.3), Property 3 (9.4 to 9.6). Fault injections strengthened the checker twice (`fb14b5c`, `ae51670`; kiro-log). |
| R10.1, R10.3, R10.4 | Births | met | Property 5. |
| R10.2 | No birth when only the Player_Soul waits | met | Unit test `births.rs::only_the_player_soul_waiting_gives_no_birth`. |
| R10.5 | Newborn Traits from streams keyed by the newborn | met with note | `births.rs::inherit_traits`. The copy-or-fresh probability (1/2 with one parent, 2/3 with two) was chosen by the agent; the design fixes none (finding 5). |
| R11.1, R11.2, R11.4 | Outsiders | met with note | Property 5. The outsider's surname is a uniform draw over all 60 surnames, so an outsider can share a local family's surname; the design is silent (finding 6). |
| R11.3 | Wait at most Max_Wait | met with note | Property 2 and the batch checker pass. The batch report's `max_wait_npc` counts one day more than the checker (finding 1). |
| R12.1 to R12.6 | Opening world | met | Property 12. |
| R13.1, R13.3 | Names | met | Property 13, Property 2 (13.3). |
| R13.2 | Name_List written for the project | met with note | Inspection only: three hand-written `const` arrays in `names.rs`; common given names and surnames, no dataset import found. Provenance cannot be proved from the repository. |
| R14.1 to R14.3 | Mood | met | `values::Mood`; Property 7. |
| R15.1 to R15.7 | Card-format compatibility | met | Property 15 (contexts every sampled tick, round trip, System One rendering for every permutation, `validate_raw_choice` in and out of set). |
| R15.8 | `llm/` and the v1 template byte-identical | met | `git diff --exit-code afaf87c` (above). |
| R16.1, R16.3, R16.4 | Streams, integers, ordered iteration | met | `rng::draw` keyed by IDs and `StreamTag`; crate-level `deny` lints in `lib.rs`, `clippy.toml`, `tests/source_guard.rs`, clippy gate. |
| R16.2 | Fixed written tick order | met | `tick.rs` numbered steps 1 to 13 match design "Tick order" (inspection). |
| R16.5 to R16.7 | Derived_State rebuild, replay, native/WASM parity | met | Property 16, Property 17, `sim-wasm/tests/parity.rs` on native and wasm32, Smoke_Test. |
| R17.1, R17.8, R17.9 | Population band, arrival ratio | met | Acceptance batch in this audit: band 47..52 on every tick, `band_40_60_ticks=29200`, arrivals 0 to 4. |
| R17.2 | No hard cap | met | Inspection and grep (above). |
| R17.3, R17.4 | Report fields, byte-identical | met with note | `batch.rs` and its unit test `output_is_identical_across_runs`. Note: `max_wait_npc` off by one (finding 1). |
| R17.5 | Ticks per second outside the report | met | `sim-cli measure` (kiro-log task 13.2: 23,777 ticks/s native, 10,245 WASM). |
| R17.6, R17.7 | Per-tick checks, first violation, non-zero exit | met | `invariants.rs`; batch unit tests `a_failing_seed_is_reported_and_the_rest_still_run`; six fault injections in kiro-log. |
| R18.1, R18.2 | Snapshot content, read-only | met | Property 18. |
| R18.3 | Native and WASM Snapshot byte-identical | met with note | `parity.rs::snapshot_at_tick_500_matches_the_committed_file` against `fixtures/parity/seed1-pairwise.snapshot-500.json`, produced by the new `sim-cli snapshot` subcommand. The producer and file were not in the design (finding 2). |
| R18.4 | No new UI, Smoke_Test passes | met | Smoke_Test `2 passed`; `git diff --stat 89c71c8 HEAD -- web/src` is empty. |
| R19.1 | proptest for the six core invariants | met | Property 1 over `life_gen` with an independent implementation of the checks. |
| R19.2 | Regeneration stated in commit messages | met | Commit scan (above). |
| R19.3 | Gates pass from a clean build | met | This audit (fresh clone) and kiro-log task 15.1 (`cargo clean`, 311 s). |
| R19.4 | Fault injection for the six invariants and new gates | met with note | Six injections logged, each failing both Property 1 and `sim-cli batch`, reverted. The acceptance-gate injection fails the acceptance command alone, but a full `scripts/gates.sh` run under that fault stops at an earlier gate (finding 9). |
| R19.5 | README lists the Name_List; no new library | met | `README.md` line 162; no dependency added (`git diff 89c71c8 HEAD -- Cargo.lock` adds or removes no package). |
| R20.1 to R20.4 | Player_Soul waiting | met | Property 3 (20.1), Property 2 (20.2), Property 5 (20.3), Property 1 (20.4); unit test `outsiders.rs::a_waiting_player_soul_past_max_wait_is_not_released`. |

## Findings

1. **New: `max_wait_npc` is one day longer than the checker's wait.** `batch.rs` `after_tick` computes the wait as `world.tick() - since`, where `world.tick()` is already advanced to the next tick (step 12 of `tick.rs`). The invariant checker uses `completed_tick = world.tick() - 1`. So a Soul released on the first day past Max_Wait shows `max_wait_npc=1096` in the report while R11.3 passes at 1,095. The doc comment example in `batch.rs` line 12 shows `1095`. Calibration step 2 read 1,096 as "at Max_Wait", which is the right reading, but the report contradicts R11.3 on its face. Fix: use the completed tick in `after_tick` (changes report lines and the design note's figures, not checksums).
2. **`sim-cli snapshot` and the snapshot fixture** (planned in tasks, not in design). Built as planned; `--help`, `fixtures/parity/README.md` and kiro-log describe them. No design sync note exists.
3. **Short batch at 1,000 ticks before task 7.3.** A plan error by Kiro: the tasks asked for `--ticks 2000` from task 4.2, but two Souls wait from tick 0 and Max_Wait is 1,095, so R11.3 must fail before the release step exists. The agent ran 1,000 ticks for tasks 4.2 to 7.2 and restored 2,000 in task 7.3 (`561b203`); `scripts/gates.sh` now runs 2,000 (checked). Task text unchanged. Closed.
4. **Death settlement write order.** Design "Deaths" sets `Life::Dead` first; the code settles the estate and Debts first and flips `Life` last, because a dead Person has no balance for `economy::flow` to move. Final state and Event order match the design. Design text not synced.
5. **Newborn trait inheritance probabilities** chosen by the agent: each trait picks uniformly among the mother, her living spouse (if any) and a fresh draw. Not in the design; an Author decision is needed to keep or change it.
6. **Outsider surname** is a uniform draw over the 60 surnames, so an outsider can carry a local family's surname with no kinship. This works against the product target "who is related to whom" being clear at a glance. Design silent; Author decision.
7. **Calibration.** Births doubled (500/50 to 1,000/100 ppm), everything else unchanged. Results reproduce exactly in this audit. On the 20-seed wide look 4 seeds still reach the Max_Wait bound. `relations_max` came out near 2,500, about half the design estimate of 4,500.
8. **The one-third arrival target.** Adopted by the agent under design calibration step 5 ("adopted only if all five seeds meet it"), and now enforced by `--require-targets` as `outsiders_le_births_third`. It follows the written procedure, but design OP-5 says "no tighter ratio unless measurement shows it is easy to meet", and the target was checked on the same five seeds it gates (the 20-seed look also passes). It is stricter than R17.8 and was not put to the Author.
9. **Acceptance-gate fault injection under the full gates.** Any `Params` change moves every checksum, so the committed fixtures fail first and a full `scripts/gates.sh` run never reaches the acceptance step. The acceptance command was shown to fail on its own (exit 1). The gate still has a real job: a defect that shows only after the 2,000 ticks covered by the fixtures and the short batch would pass every earlier step. A full-chain demonstration is possible by regenerating the fixtures under the fault in a scratch clone.
10. **Values placement.** Value types live in `values.rs`; the task asked for a re-export from `world` so the design's paths stay valid, but `world.rs` only `use`s them and `lib.rs` exposes `values` as its own module. `structure.md` lists `values.rs`. Harmless; the design's module paths are out of date.
11. **Agent edits to design.md.** The agent added the dated notes "Measured baseline", "Calibration result" and "Measured gate time", which tasks 12.1 to 13.2 asked for. No other design, requirement or steering text was changed by the agent except `structure.md` (task 14.2).
12. **Task 16.1** stays unchecked until the Author has reviewed these findings.
   - Update (2026-11-11): checked after the 17.x review below.

## Follow-up review (tasks 17.1 to 17.5, 2026-11-11)

Reviewed by Kiro against `a446e74` (working tree clean, nothing pushed). The Author's decisions on findings 1 to 9 are recorded in kiro-log ("Author's audit decisions, design sync and follow-up tasks") and in design notes marked "(Author, 2026-11-11, audit)".

Checks run in this review:

- Code read: `23c533e` (outsider surname), `23f549b` (`max_wait_*` from the completed tick), `e5f17c1` (one-third target report-only), `crates/sim-cli/Cargo.toml` (dev-dependency on the same path crate with `test-support`; `Cargo.lock` unchanged).
- `cargo test -p sim-cli`: all pass (29 and 23 tests in the two test binaries).
- `sim-cli batch --seeds 1..=5 --ticks 29200 --require-targets` with a release build: `batch: 5/5 seeds ok`, final checksums `0b75afbd35cf9e3b`, `fe6084a6bbbac176`, `f5daa246698a3229`, `b786e54976e82b1b`, `8ce9509847022d99`; `max_wait_npc` 762, 917, 1,095, 773, 331; `outsiders_le_births_third=pass` on every seed. Equal to the agent's task 17.5 lines.
- R15.8 diff check exits 0.
- Full gates from a clean build: not re-run by Kiro; the agent's task 17.5 run (`cargo clean`, `All gates passed.`, 5 min 46 s) is the evidence.

| Finding | Decision | Result |
|---|---|---|
| 1 `max_wait_npc` one day long | fix (A) | closed. `after_tick` uses `world.tick() - 1`; new unit test `a_release_past_max_wait_reports_exactly_max_wait` (birth rates 0, 1,100 ticks) reports exactly 1,095. Design correction note appended. |
| 2 snapshot subcommand | sync design | closed. Design sync note. |
| 3 short batch before 7.3 | none | closed earlier. |
| 4 death write order | sync design | closed. Design sync note. |
| 5 newborn trait inheritance | keep (A), write into design | closed. Design "Births" states the rule. |
| 6 outsider surname | change (A) | closed. Free surnames in ascending index, `below(draw, count)` keyed by the Soul, fallback to all 60; unit tests for both branches and determinism. Only seed 3's final checksum moved (the only acceptance seed with arrivals); the parity and snapshot fixtures did not change because no release happens within their 2,000 ticks. Design correction note appended. |
| 7 calibration | none | as recorded. |
| 8 one-third target | report-only (B) | closed. `--require-targets` checks R17.1, R17.8, R17.9 only; unit tests cover a seed failing only the third target (exit 0) and one failing R17.8 (non-zero). Design correction note appended. |
| 9 acceptance-gate fault injection | accept as note (A) | closed. Design note. |
| 10 values path | sync design | closed. Design sync note: `sim_core::values`, not re-exported from `world`. |
| Property 6 log gap | log late | closed. kiro-log entry for `f058096`, marked as written late. |

Notes from this review:

- The 17.1 commit message says "Parity fixtures regenerated with scripts/regen-fixtures.sh", but the commit changes no fixture: the script was run twice and produced no diff (kiro-log 17.1 entry). R19.2 requires the line only when a recorded Checksum changes, so this is a wording slip, not a gap.
- Rows R11.1/R11.2 (surname note), R11.3 and R17.3/R17.4 (off-by-one note) in the table above are now `met`; R19.4 stays `met with note` by the Author's choice.

Task 16 and 16.1 are checked.
