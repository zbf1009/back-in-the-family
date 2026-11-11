# Implementation Plan: life-sim

## Overview

This plan replaces the skeleton model in `sim-core` with the life simulation and soul-identity core described in `design.md`, then adapts `sim-cli`, `sim-wasm`, the web unit tests and the Parity_Fixtures, adds the Context_Builder and the Snapshot, calibrates the Params, and adds the 80-year acceptance gate.

The plan has five phases:

1. **Foundations (tasks 1 to 2).** New modules are added next to the skeleton. Every gate stays green.
2. **Model swap window (tasks 3 to 5).** The skeleton `World` is replaced and every downstream crate is adapted. The workspace does not fully build between the start of task 3.1 and the end of task 4.4, so the gates are red in that window. Do nothing else in the window and close it as soon as possible. The window ends at checkpoint 5, where `scripts/gates.sh` must pass again.
3. **Tick steps (tasks 6 to 7).** The tick steps are filled in one family at a time. Each task changes the Checksums, regenerates the Parity_Fixtures and keeps the gates green.
4. **Property tests, Context_Builder, Snapshot (tasks 8 to 11).**
5. **Calibration, acceptance gate, docs, hand-off (tasks 12 to 16).**

The language is Rust (edition 2024) for `crates/`, and TypeScript only where existing web unit tests change.

## Rules for the executing agent

The tasks are run one at a time by an external terminal coding agent. Kiro does only the final audit (task 16). These rules apply to every task:

- Read `.kiro/specs/life-sim/requirements.md`, `.kiro/specs/life-sim/design.md` and `.kiro/steering/*.md` (`tech.md`, `structure.md`, `product.md`) before the first task, and follow them. The design is authoritative for names, types, numbers and step order. If the design and the code disagree, or the design leaves a needed choice open, stop and ask the Author. Do not invent a new rule silently.
- **Commits**: conventional commits (`feat(sim-core): ...`, `test(sim-core): ...`, `chore(fixtures): ...`, `docs: ...`). Make one commit per leaf task unless the task says otherwise. Stage files by name. Never use `--no-verify` or `--amend` after a hook failure.
- **Never** push, deploy, create a remote, change git config or install global dependencies. A push to `main` deploys the site automatically. If a task seems to need one of these, stop and ask the Author.
- **Never open** `eval/cards/cards/locked.jsonl`, `eval/cards/review/locked.md`, anything under `eval/cards/blind/`, or the root file `env`.
- **R15.8**: `crates/sim-core/src/llm/` and `eval/probe/templates/decision.system_one.v1.txt` must stay byte-identical. Before every commit, run `git diff --exit-code afaf87c -- crates/sim-core/src/llm eval/probe/templates/decision.system_one.v1.txt`. It must exit 0.
- **Determinism** (tech.md): integers only, no `HashMap`/`HashSet`, ordered iteration, every random draw through `rng::draw` with a `StreamTag`, no clock, threads or env reads in `sim-core`. `crates/sim-core/tests/source_guard.rs` enforces part of this.
- **Fixtures (R19.2)**: any commit that changes a per-tick Checksum recorded in `fixtures/parity/` must include the files regenerated with `scripts/regen-fixtures.sh`. Its commit message must contain the line `Parity fixtures regenerated with scripts/regen-fixtures.sh.` Run the script twice: the second run must leave `git status` unchanged.
- **`docs/kiro-log.md`**: append factual entries as events happen (fault injections, calibration runs, measurements, surprises, deviations from the design). Use the existing heading format (`### Spec: life-sim — <topic> (<date>)`). Append only. Never edit or reword earlier entries, and never backfill.
- **Standard Rust check**, referred to below as *Rust gates*: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`.
- **Full gates**: `scripts/gates.sh` exits 0. It takes several minutes and needs the system Chrome and `mise`.
- Property tests use `proptest` with at least 100 cases. Mark each with the comment `// Feature: life-sim, Property <n>: <title>`.

## Tasks

- [x] 1. Foundations: IDs, random streams, Params, names, value types
  - [x] 1.1 Add the new ID newtypes and stream tags
    - Files: `crates/sim-core/src/ids.rs`, `crates/sim-core/src/rng.rs`, `crates/sim-core/src/canon.rs`.
    - Add `PersonId`, `HouseholdId`, `SoulId`, `EventId`, `PropertyId` as `u64` newtypes deriving `Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Debug` (no `Hash`). Give each a `fn rng_key(self) -> EntityId`. Add `Canon` impls. Keep `EntityId` and the existing `IdCounter`. Leave the skeleton types alone for now.
    - In `rng.rs`, add permanent `StreamTag` values 4..=14 (design "Module layout" and "Opening_World generation"). Use one tag per draw family: opening world, traits, names, mortality, births, outsiders, marriage, loans, repayments, social, economy/wages. Document each tag. Do not rename tags 1 and 2 yet; task 3.1 retires them. The existing pinned `draw` test values must stay unchanged.
    - _Requirements: 2.5, 16.1_
    - Acceptance: Rust gates pass, and `git diff afaf87c -- crates/sim-core/src/rng.rs` shows only added tags and docs.
  - [x] 1.2 Add `params.rs`
    - Files: `crates/sim-core/src/params.rs` (new), `crates/sim-core/src/lib.rs`.
    - Implement `Params` as a plain integer struct with every value in design "Parameters and calibration": the mortality table with `mortality_ppm(age)`, where age 120 is certain; `birth_ppm` married and unmarried; `MAX_WAIT` 1,095; `INITIAL_WAITING` 2; `marriage_ppm`; loan ppm and thresholds; `social_ppm` and rolls per day; wage range and upkeep; `GRUDGE_THRESHOLD` -40; `FRIEND_AT` 50; initial kin scores; `SPOUSE_AFFINITY`; rebuilt share 200,000 ppm; outsider age 18..=40. Add `Params::DEFAULT`, `Params::stress()` behind `#[cfg(any(test, feature = "test-support"))]` (rates raised so 240-tick runs hit deaths, births, releases, debts at death and remarriage), and a `Canon` impl.
    - Unit tests: mortality lookup at every band edge (0, 1, 17, 18, 39, 40, ..., 119, 120), and every `DEFAULT` value pinned.
    - _Requirements: 6.1, 16.3_
    - Acceptance: Rust gates pass, and `cargo test -p sim-core params` passes.
  - [x] 1.3 Add `names.rs` with the Name_List and the picker
    - Files: `crates/sim-core/src/names.rs` (new), `crates/sim-core/src/lib.rs`, `README.md`.
    - Write by hand 80 female first names, 80 male first names and 60 surnames as `const` arrays. Use single ASCII words, all distinct within each list. Do not copy from any dataset or website (R13.2). Add `FullName { first: u16, surname: u16 }` with `Canon`, and the probing picker from design "Name_List and picker", which takes an occupied set as a `&BTreeSet<FullName>`.
    - `README.md`: add the Name_List to the licenses/third-party section as "project's own, written for this project, Apache-2.0 (same as the repository)".
    - Unit tests: list sizes, no duplicates, ASCII-only, the picker probes forward and wraps to the next surname.
    - _Requirements: 13.1, 13.2, 19.5_
    - Acceptance: Rust gates pass, and `cargo test -p sim-core names` passes.
  - [x] 1.4 Property test: Property 13 (the name picker always finds a free name)
    - File: `crates/sim-core/src/names.rs` (`#[cfg(test)] mod tests`, proptest).
    - Generate at most 61 occupied full names, a sex, a surname index and a draw. Assert that the result is in the Name_List and not occupied. Include a generated case where all 80 first names of the start surname are taken.
    - **Property 13: The name picker always finds a free name.** **Validates: Requirements 13.1, 13.3**
    - Acceptance: `cargo test -p sim-core names` passes with at least 100 cases.
  - [x] 1.5 Add the range-checked value types
    - Files: `crates/sim-core/src/values.rs` (new), `crates/sim-core/src/lib.rs`.
    - Implement the value types from design "Data Models": `Score` (-100..=100, `Score::clamped(i64)`), `Trait` (-3..=3), `Intensity` (1..=100, `Intensity::new(u8) -> Option<Self>`), `Mood` (-100..=100, `add_clamped(i64)`), `Sex`, `Origin` (`Native`, `Possessed`, `Rebuilt`), `Traits`, `RelTags` (bitset in card tag order, with Kinship_Tag helpers), `SocialKind`, and `Canon` impls with explicit `u8` enum tags. Each has a private field and constructors that clamp or refuse.
    - Design lists these under `world.rs`. Put them in `values.rs` instead and re-export them from `world` in task 3.1, so the design's paths stay valid. Record this placement in task 14.2 (structure.md).
    - Unit tests: clamping at bounds, refusal of out-of-range values, card tag names round trip, canonical tags distinct.
    - _Requirements: 2.2, 4.1, 5.9, 14.1_
    - Acceptance: Rust gates pass.
  - [x] 1.6 Add `events.rs` with the Event_Log and its digest
    - Files: `crates/sim-core/src/events.rs` (new), `crates/sim-core/src/lib.rs`.
    - Implement `EventKind` (exactly the variants in design "Events"), `CausedBy`, `EventTags`, `Event` and `EventLog`. `events[i].id == EventId(i + 1)`. The digest fold is `digest_0 = [0; 32]`, `digest_{n+1} = blake3(digest_n || encode(event_{n+1}))`. Also implement:
      - `pub(crate) fn push` as the only mutator;
      - `recompute_digest()`;
      - `Canon` for `EventLog`, which writes `len as u32` and then the digest;
      - `actors()`, `card_type()`, `magnitude()` and `is_afterlife()` as pure functions;
      - `mood_delta(kind, actor_position) -> i64`, a pure table from design "Parameters and calibration" (Mood row).
    - There is no remove method and no `&mut` access to stored events (R5.2).
    - Unit tests: the stored digest equals `recompute_digest()` after many pushes; `card_type` names match the card event-type list in `eval/cards/README.md` "Field set"; actor counts and order match the card table; magnitude rules (R5.4); `due` only on `Loan` (R5.5).
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.9, 5.10, 14.2_
    - Acceptance: Rust gates pass.

- [x] 2. Checkpoint: foundations green
  - Run the full gates. `scripts/gates.sh` must exit 0, and the skeleton behaviour and fixtures must be unchanged (`git status fixtures/` is clean). Ensure all tests pass, ask the user if questions arise.

- [x] 3. Model swap in sim-core (start of the red window: crates other than `sim-core` stop building)
  - Tasks 3.1 to 3.3 are one unit. `sim-core` may not compile between them. Make **one commit at the end of 3.3** (`feat(sim-core)!: replace the skeleton model with the life-sim world`), with the body line `Workspace build is red until the sim-cli, sim-wasm and web adaptation (tasks 4.1 to 4.4).`
  - [x] 3.1 Rewrite `world.rs` and add the world-level pieces
    - Files: `crates/sim-core/src/world.rs` (rewritten), `crates/sim-core/src/economy.rs` (new, with only `economy::flow` and `FlowTotals`), `crates/sim-core/src/opening.rs` (new), `crates/sim-core/src/rng.rs` (rename tags 1 and 2 to `RetiredDrift` and `RetiredAffinity`, never drawn), `crates/sim-core/src/canon.rs` (`CANON_VERSION = 2`), `crates/sim-core/src/lib.rs`.
    - Delete `Entity`, `Workload`, Light and Pairwise. Implement `WorldConfig::try_new` (40..=60), `ConfigError` (`OpeningResidentsOutOfRange`, `Generation(&'static str)`), `Person`, `Life`, `Household`, `Property`, `PropertyKind`, `Relation`, `Debt`, `SoulPlace`, `Souls`, `Rejections`, `World` and `Derived`, exactly as in design "Data Models". All four ID counters start at 1 (OP-10).
    - Add the public accessors listed in design "Public API": `age_years` per R2.3 (floor division), `wealth` per OP-1 A, `household_members`, `rebuild_derived`, and `discard_derived` under test-support.
    - Add the canonical encoding in the order of design "Canonical encoding of the World", with `derived: _` skipped explicitly. Add `World::append` with the checks and the order of design "Event append" (`AppendRefused`). It applies `mood_delta` to living actors and updates `Derived`.
    - `economy::flow(world, Flow, amount)` is the only writer of balances. It covers every row of design "Money_Flow list", uses `checked_add`, skips a flow whole on overflow, and updates `flows`.
    - `opening.rs`: implement design "Opening_World generation" steps 1 to 10, with the opening history at tick 0 (OP-7 A). Return `ConfigError::Generation` instead of panicking.
    - `World::new(seed, config)` uses `Params::DEFAULT`. `new_with_params` exists under test-support.
    - Unit tests in `opening.rs`: generation succeeds for seeds 0..=999 and every N in 40..=60 (generation only, no ticks). Household 1 is a couple with a child. A grudge, an opening loan with `due_tick > 0`, and a Player_Soul aged 20..=50 exist.
    - _Requirements: 1.1, 2.1, 2.3, 2.5, 3.1, 3.3, 3.4, 4.1, 5.6, 5.7, 5.8, 9.4, 9.6, 12.1, 12.2, 12.3, 12.4, 12.5, 13.1, 14.1, 16.3_
    - Acceptance: completed together with 3.3.
  - [x] 3.2 Rewrite inputs, the tick and the replay format
    - Files: `crates/sim-core/src/input.rs`, `crates/sim-core/src/tick.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-core/src/social.rs` (new, with only `apply_social` and the effect table), `crates/sim-core/src/death.rs`, `births.rs`, `outsiders.rs` (new, each with an empty step function that is filled in task 6 or 7).
    - `InputPayload::Act { kind, actor, target, intensity }` and `RejectReason`, with the validation order of design "Inputs and replay format". Invalid inputs go to `rejections` (count and `last`).
    - `World::step` runs the 13 steps of design "The tick" in order. Steps 1, 2, 12 and 13 work now. Steps 3 to 11 call the step functions of their modules, which do nothing until tasks 6 to 7 fill them. Add a comment block in `tick.rs` that lists the 13 steps (R16.2). `apply_social` implements the effect table and the friend and rival thresholds (R4.8) and is shared with step 9 later.
    - Replay format version 3 (`REPLAY_VERSION = 3`): `ReplayConfig` with `#[serde(deny_unknown_fields)] { opening_residents: u16 }`, the new payload JSON shape from the design example, and version 2 rejected as `UnsupportedVersion`. `Sim`, `record`, `verify`, `ReplayFile` and `SubmitInput` keep their signatures.
    - Unit tests in `replay.rs`: a config with `workload` is rejected with "unknown field `workload`" and no World is created (R1.3); a version 2 file is rejected; the payload round trip works; each `RejectReason` is produced by a matching input.
    - _Requirements: 1.3, 1.4, 1.5, 4.8, 6.5, 16.2, 16.6_
    - Acceptance: completed together with 3.3.
  - [x] 3.3 Add the invariant checker and rewrite the test-support code and existing sim-core tests
    - Files: `crates/sim-core/src/invariants.rs` (new), `crates/sim-core/src/testing.rs` (rewritten), `crates/sim-core/tests/replay.rs`, `crates/sim-core/tests/properties.rs` (rewritten, minimal for now), `crates/sim-core/tests/source_guard.rs`.
    - `InvariantChecker::new(world)` and `after_tick(world)`, which return `Violation { criterion, tick, detail }`. They check every invariant of R17.6 (3.1, 3.2, 3.5, 4.2 to 4.6, 5.6 to 5.8, 9.1 to 9.3, 11.3, 20.1) plus the structural checks of Property 2 and the log digest (stored equals recomputed). The checker is stateful: it keeps the previous total money, the previous log length and the previous Player_Soul place. `criterion` is the requirement number as text, for example `"9.3"`.
    - `testing.rs`: `Mutation` covers every World field, including changing, adding or dropping one stored Event. `apply` changes exactly one field.
    - `tests/replay.rs`: record and verify a 500-tick run with Act inputs; a tampered checksum is reported at its tick.
    - `tests/properties.rs`: remove the skeleton properties. Leave one simple test that runs `Sim` for 240 ticks with the `InvariantChecker`. Task 8 adds the life-sim properties to their own files.
    - `source_guard.rs`: add a check that `Workload`, `Entity` and `SetValue` do not appear in `sim-core/src` (R1.1). `EntityId` is allowed, so match whole identifiers.
    - _Requirements: 1.1, 5.10, 17.6, 19.1_
    - Acceptance: `cargo fmt --check`, `cargo clippy -p sim-core --all-targets -- -D warnings` and `cargo test -p sim-core` pass. The R15.8 diff check exits 0. Then commit 3.1 to 3.3 as one commit (see the message above). `cargo build --workspace` is still expected to fail in `sim-cli` and `sim-wasm`.

- [x] 4. Adapt sim-cli, sim-wasm, the web unit tests and the fixtures (closes the red window)
  - [x] 4.1 Adapt the sim-cli `record`, `replay` and `inputs`
    - Files: `crates/sim-cli/src/commands.rs`, `crates/sim-cli/src/inputs.rs`, `crates/sim-cli/src/args.rs` (if needed), `crates/sim-cli/tests/cli.rs`.
    - The default config is `{"opening_residents":50}`, and the help text describes it. Rewrite `generate_inputs` per design "sim-cli" `inputs.rs`: 12 roll buckets of `Act` inputs (0..=7 valid-looking, 8 unknown person, 9 self target, 10 intensity 0 or 101..=255, 11 actor from `1..=N`). Update the module doc table. Update `cli.rs` so that every test uses the new config and payload shape, and add a test that `--config` with a `workload` field exits 2 with the unknown-field message.
    - _Requirements: 1.2, 1.3, 6.5_
    - Acceptance: `cargo test -p sim-cli` passes, except the batch and measure tests that 4.2 and 4.3 rewrite. Commit.
  - [x] 4.2 Rewrite the sim-cli `batch` report
    - Files: `crates/sim-cli/src/batch.rs`, `crates/sim-cli/tests/cli.rs`.
    - Implement design "sim-cli" **`batch`**: `--require-targets`, default `--random-inputs 60`, the `InvariantChecker` after every tick, statistics, one stepped run plus `verify` of the replay built from it, and a from-scratch digest recompute at the end. Use the exact per-seed line format of the design (`residents_min`, `residents_max`, `band_40_60_ticks`, `queue_final`, `max_wait_npc`, `max_wait_player`, `births`, `deaths`, `imported`, `rebuilt`, `origin_final`, `arrivals`, `events`, `relations_max`, `rejections`, `invariants`, `pop_35_65`, `band_95`, `outsiders_le_births`), the `FAIL tick=<t> criterion=<R> detail: ...` line with exit status 1, and `FAIL targets: ...` under `--require-targets`. The deterministic output contains no timing.
    - Tests in `cli.rs`: batch output is byte-identical on two runs (R17.4); `--require-targets` turns a failing target into `FAIL targets` (use a tiny seed range); the line format is parsed field by field. Test the violation path with a unit test in `batch.rs` that injects a failing checker closure and asserts the criterion, the tick and exit 1 (R17.6, R17.7).
    - _Requirements: 17.3, 17.4, 17.6, 17.7_
    - Acceptance: `cargo test -p sim-cli batch` passes, and `cargo run -q --release -p sim-cli -- batch --seeds 1..=3 --ticks 2000` prints 3 `ok` lines and `batch: 3/3 seeds ok`. Commit.
  - [x] 4.3 Rewrite the sim-cli `measure`
    - Files: `crates/sim-cli/src/measure.rs`.
    - `--residents N` (40..=60, default 60) replaces `--entities` and the `Workload`. The report rows stay as they are, and the params line says `residents=60`. Each run is a Life_Run (29,200 ticks) with no inputs. The checksum is timed on the World after one simulated year (365 ticks). Ticks per second are reported outside the batch report (R17.5).
    - Update the unit tests in `measure.rs`. A test checks that every labelled row is printed.
    - _Requirements: 17.5_
    - Acceptance: `cargo test -p sim-cli measure` passes, `cargo clippy -p sim-cli --all-targets -- -D warnings` passes, and `cargo run -q --release -p sim-cli -- measure --runs 1 --residents 60` prints every row. Commit.
  - [x] 4.4 Adapt sim-wasm, the configs and fixtures, and the web unit tests; regenerate the fixtures
    - Files: `crates/sim-wasm/src/lib.rs` (module docs and examples for the new config and payload JSON), `crates/sim-wasm/tests/parity.rs`, `crates/sim-wasm/tests/bench.rs`, `scripts/measure-wasm.mjs`, `scripts/measure-wasm.sh`, `fixtures/configs/pairwise.json` (`{"opening_residents":50}`), `fixtures/parity/*.replay.json` (regenerated), `fixtures/parity/README.md`, `web/tests/unit/helpers/gen.ts`, `web/tests/unit/helpers/reference.ts`, `web/tests/unit/controller.test.ts`, `controller-rejects.test.ts`, `controller-speed.test.ts`, `controller-frames.test.ts`, `controller-clock.test.ts`.
    - `parity.rs`: switch to the new config and payloads, and add a comment that the fixture names `pairwise` and `seedbig-pairwise` are kept from the skeleton era and no longer describe a workload. `fixtures/parity/README.md`: use a config column instead of workload and entities, state format version 3, and add the same naming note.
    - Web helpers: `configArb` becomes `{ opening_residents: 40..=60 }`; the payload arbitrary becomes `Act` (kinds `help`, `gift`, `quarrel`, `insult`, `theft`, `apology`; actor and target as decimal strings; intensity 0..=255, so some are invalid); invalid config examples include one with a `workload` field; update the doc comments. Replace every config string and payload literal in the five controller tests. Do **not** change `web/src` or `web/tests/smoke/*` (R18.4). The stale type annotation in the smoke specs stays as it is.
    - Run `scripts/regen-fixtures.sh` twice. The second run leaves `git status` unchanged.
    - _Requirements: 1.2, 16.7, 18.4, 19.2, 19.3_
    - Acceptance: Rust gates pass; `cargo test -p sim-wasm --target wasm32-unknown-unknown` and `cargo test -p sim-wasm --features bench --test bench` pass; `mise exec -- pnpm --dir web run typecheck` and `mise exec -- pnpm --dir web run test:unit` pass. Commit as `chore: adapt sim-cli, sim-wasm and web tests to the life-sim model`, with the line `Parity fixtures regenerated with scripts/regen-fixtures.sh.`

- [x] 5. Checkpoint: end of the red window
  - `scripts/gates.sh` must exit 0 from a clean build (`cargo clean` first is acceptable but not required). The R15.8 diff check exits 0. Append a `docs/kiro-log.md` entry with the date the window opened and closed and any gate that needed an unplanned fix, and commit it. Ensure all tests pass, ask the user if questions arise.

- [x] 6. Tick steps: economy, social life, debts, marriage
  - Each leaf task below changes Checksums: it ends with `scripts/regen-fixtures.sh` (twice, the second run with no diff) and a commit that contains the regeneration line. Per-task acceptance: Rust gates, `cargo test -p sim-wasm --target wasm32-unknown-unknown`, `cargo run -q --release -p sim-cli -- batch --seeds 1..=20 --ticks 2000` (all `ok`), and the R15.8 check.
  - [x] 6.1 Implement the economy step (step 10)
    - Files: `crates/sim-core/src/economy.rs`, `crates/sim-core/src/tick.rs`.
    - Wage for Residents aged 18..=67 (source `Wage`) and `min(balance, UPKEEP)` for Residents aged 18+ (sink `Upkeep`), in Person ID order, all through `economy::flow`.
    - Unit tests: one test per Money_Flow kind in design "Money_Flow list": balances and `flows` change as documented, and transfers conserve money. Include an overflow-skip test using a test-support setter.
    - _Requirements: 3.3, 3.4, 3.5_
  - [x] 6.2 Implement social events (step 9) and relation decay (step 11)
    - Files: `crates/sim-core/src/social.rs`, `crates/sim-core/src/tick.rs`.
    - Social rolls with actor and target selection, the weight table with clamping to at least 1, `apology` only when the actor's affinity toward the target is below 0, `caused_by` from `last_grievance`, and intensity 10..=60, through `World::append` and `apply_social`. Decay runs only when `T % 30 == 29` and moves affinity one point toward 0 for every Relation whose `from` is a Resident (including Relations toward the dead), except negative affinity held by a `from` with `vindictiveness >= 2`.
    - Unit tests: weight table at trait extremes, apology eligibility, decay skip for vindictive holders, decay applies to a living-to-dead Relation.
    - _Requirements: 4.8, 5.6, 16.4_
  - [x] 6.3 Property test: Property 8 (social effects stay within their bounds)
    - File: `crates/sim-core/src/social.rs` (`#[cfg(test)]`, proptest).
    - Generate two distinct Residents, any prior Relations (including none), any kind and any intensity in 1..=100. Assert that only the two Relations between the actors change, each change is within the table bound for its kind and direction, the results are in -100..=100, and the friend and rival tags match the thresholds.
    - **Property 8: Social effects stay within their bounds.** **Validates: Requirements 4.8**
    - Acceptance: `cargo test -p sim-core social` passes. No fixture change, so commit without regeneration.
  - [x] 6.4 Implement loans (step 7) and repayments (step 8)
    - Files: `crates/sim-core/src/economy.rs`, `crates/sim-core/src/tick.rs`.
    - Implement design "Loans" and "Repayments": eligibility, amount and due-date draws, the `Loan` and `Repayment` flows, Debts keyed by the `loan` Event ID, tags, `ceil(principal / 3)` as `(principal + 2) / 3` with a checked add, closing at 0, and overdue Debts kept open.
    - Unit tests: a repayment on the anniversary only, a partial repayment carries the `partial` tag, the Debt closes at 0, an overdue Debt stays open, and a debtor with balance 0 makes no repayment.
    - _Requirements: 5.1, 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 6.5 Implement marriage (step 6)
    - Files: `crates/sim-core/src/social.rs`, `crates/sim-core/src/tick.rs`.
    - Implement design "Marriage": candidates with no living spouse, the partner filter (no Kinship_Tag in either direction, affinity >= 0 both ways), `spouse` tags both ways with affinity raised to at least `SPOUSE_AFFINITY`, a new Household with both spouses and their children under 18, removal of emptied Households, and a `marriage` Event tagged `public`. A widowed Resident keeps the `spouse` tag toward the dead spouse.
    - Unit tests: a widowed Resident remarries, and both `spouse` Relations to the dead spouse are unchanged (R4.9); kin are never paired; the emptied old Household is removed.
    - _Requirements: 3.1, 3.6, 4.3, 4.6, 4.7, 4.9, 5.1_

- [x] 7. Tick steps: deaths, births, outsiders
  - Same per-task rules and acceptance as task 6, including fixture regeneration.
  - [x] 7.1 Implement deaths, inheritance and debts at death (step 4)
    - Files: `crates/sim-core/src/death.rs`, `crates/sim-core/src/tick.rs`.
    - Implement design "Deaths" sub-steps 1 to 7: mortality rolls against the state at the start of the step, then processing in Person ID order; `Life::Dead`; Household removal; the `death` Event; the Soul waiting; heirs by class order with an equal split, the remainder one dollar each in heir order and property round-robin; `Escheat` when there is no heir; one `inheritance` Event per heir who received anything, with the tags; debtor Debts transferred to the first heir or forgiven; creditor Debts forgiven; the deceased's non-kin outgoing Relations removed; Relations toward the deceased kept.
    - Unit tests (design "Unit and example tests", `death.rs`): 10 dollars to 3 heirs gives 4, 3, 3; no heir leads to escheat and removed property; a first heir who is the creditor gets the Debt forgiven; a creditor's death forgives the Debt; Relations at death (a living Resident's `rival` and `friend` toward the deceased are kept with their scores and tags; the deceased's non-kin Relations are removed; kin Relations are kept in both directions); age 120 always dies.
    - _Requirements: 2.4, 3.2, 3.6, 4.7, 5.1, 5.8, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2_
  - [x] 7.2 Implement births (step 5)
    - Files: `crates/sim-core/src/births.rs`, `crates/sim-core/src/tick.rs`.
    - Implement design "Births" sub-steps 1 to 4: candidate mothers aged 18..=45; a stop when only the Player_Soul waits; selection by longest wait, ties by lower Soul ID; the newborn's fields; traits copied or drawn per trait from streams keyed by the newborn's ID; the mother's surname and a picked first name; kinship with living parents, siblings and grandparents only; the soul placed; the `birth` Event.
    - Unit tests: only the Player_Soul waiting gives no birth (R10.2); a tie on wait goes to the lower Soul ID; a dead grandparent gets no Relation.
    - _Requirements: 5.1, 9.1, 9.2, 10.1, 10.2, 10.3, 10.4, 10.5, 13.3, 20.3_
  - [x] 7.3 Implement outsider releases (step 3)
    - Files: `crates/sim-core/src/outsiders.rs`, `crates/sim-core/src/tick.rs`.
    - Implement design "Outsiders": every non-player Soul with `T - since > MAX_WAIT`, in Soul ID order; the kind rolled per Soul (rebuilt share 200,000 ppm); age 18..=40; the `ArrivalEndowment` source; a new single-person Household; no Relations; the `possession` or `rebuild` Event.
    - Unit tests: a waiting Player_Soul past Max_Wait is not released (R20.2); a Soul at exactly Max_Wait is not released, and one day later it is.
    - _Requirements: 5.1, 7.3, 9.3, 11.1, 11.2, 11.3, 11.4, 20.1, 20.2_
  - [x] 7.4 Append the first full-model batch figures to the log
    - Files: `docs/kiro-log.md`.
    - Run `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200` (no `--require-targets`). Paste the five seed lines and the wall time (`time`) into a new log entry. Do not tune anything yet; task 12 does that. Commit as `docs: log first life-sim batch figures`.
    - _Requirements: 17.3_
    - Acceptance: the batch exits 0 (invariants pass). If an invariant fails, fix the bug in the step that caused it, add a regression unit test and log the cause before you continue.

- [x] 8. Property tests for the tick invariants
  - Each test uses the shared generator from 8.1 and runs 240 ticks per case, with `Params::stress()` in 3 cases of 4 and `Params::DEFAULT` otherwise (design "Testing Strategy"). Acceptance for each: `cargo test -p sim-core --test <file>` passes, and Rust gates pass. Commit each with `test(sim-core): ...`.
  - [x] 8.1 Add the shared run generator and the blake3 dev profile
    - Files: `crates/sim-core/tests/life_gen/mod.rs` (new), `Cargo.toml` (workspace root: `[profile.dev.package.blake3] opt-level = 3`).
    - The scenario strategy covers a seed, N in 40..=60, the Params choice, and a list of Act inputs with valid and invalid ones mixed as in `sim-cli` `inputs.rs`. Add a helper that steps a `Sim` and yields `(before, after)` World pairs per tick.
    - Measure `time cargo test -p sim-core` before and after the profile change, and log both numbers in `docs/kiro-log.md`.
    - _Requirements: 19.1_
  - [x] 8.2 Property test: Property 1 (core invariants hold at the end of every tick)
    - File: `crates/sim-core/tests/invariants.rs` (new). Use `InvariantChecker` (the same code as `sim-cli batch`) and also assert each of the six R19.1 invariants directly, so a checker bug cannot hide them.
    - **Property 1: Core invariants hold at the end of every tick.** **Validates: Requirements 3.1, 3.5, 4.4, 5.8, 6.4, 9.1, 9.2, 9.3, 19.1, 20.4**
  - [x] 8.3 Property test: Property 2 (structural invariants hold at the end of every tick)
    - File: `crates/sim-core/tests/invariants.rs`.
    - **Property 2: Structural invariants hold at the end of every tick.** **Validates: Requirements 2.2, 3.3, 3.6, 4.2, 4.3, 4.5, 4.6, 5.6, 5.7, 6.2, 6.4, 7.3, 8.3, 8.4, 11.3, 13.3, 20.2**
  - [x] 8.4 Property test: Property 3 (history is preserved across ticks)
    - File: `crates/sim-core/tests/history.rs` (new).
    - **Property 3: History is preserved across ticks.** **Validates: Requirements 2.4, 2.5, 4.7, 4.9, 5.2, 6.4, 9.4, 9.5, 9.6, 20.1**
  - [x] 8.5 Property test: Property 4 (every death is settled in its own tick)
    - File: `crates/sim-core/tests/history.rs`.
    - **Property 4: Every death is settled in its own tick.** **Validates: Requirements 5.1, 6.3, 7.1, 7.2**
  - [x] 8.6 Property test: Property 5 (births and arrivals use waiting Souls correctly)
    - File: `crates/sim-core/tests/history.rs`.
    - **Property 5: Births and arrivals use waiting Souls correctly.** **Validates: Requirements 5.1, 10.1, 10.3, 10.4, 11.1, 11.2, 11.4, 20.2, 20.3**
  - [x] 8.7 Property test: Property 6 (debts follow their Events)
    - File: `crates/sim-core/tests/history.rs`.
    - **Property 6: Debts follow their Events.** **Validates: Requirements 5.1, 8.1, 8.2, 8.4, 8.5**
  - [x] 8.8 Property test: Property 7 (Mood changes only through Events)
    - File: `crates/sim-core/tests/history.rs`.
    - **Property 7: Mood changes only through Events.** **Validates: Requirements 14.2, 14.3**
  - [x] 8.9 Property tests: Property 9 (a valid Act changes the Checksum) and Property 10 (an invalid input is skipped and recorded)
    - File: `crates/sim-core/tests/inputs.rs` (new). Write one `proptest!` per property.
    - **Property 9: A valid Act changes the Checksum.** **Validates: Requirements 1.4**
    - **Property 10: An invalid input is skipped and recorded.** **Validates: Requirements 1.5, 6.5**
  - [x] 8.10 Property test: Property 11 (age is whole years rounded down)
    - File: `crates/sim-core/src/world.rs` (`#[cfg(test)]`, proptest over `birth_day` including negative values and `e >= b`).
    - **Property 11: Age is whole years rounded down.** **Validates: Requirements 2.3**
  - [x] 8.11 Property test: Property 12 (the Opening_World is valid and reproducible)
    - File: `crates/sim-core/tests/opening.rs` (new).
    - **Property 12: The Opening_World is valid and reproducible.** **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**
  - [x] 8.12 Property tests: Property 14 (every state field reaches the Checksum) and Property 16 (rebuilding Derived_State changes nothing)
    - File: `crates/sim-core/tests/properties.rs` (replace the minimal test from 3.3).
    - **Property 14: Every state field reaches the Checksum.** **Validates: Requirements 5.10**
    - **Property 16: Rebuilding Derived_State changes nothing.** **Validates: Requirements 16.5**
  - [x] 8.13 Property test: Property 17 (replays reproduce every Checksum)
    - File: `crates/sim-core/tests/replay.rs`.
    - **Property 17: Replays reproduce every Checksum.** **Validates: Requirements 16.6**

- [x] 9. Fault injection for the six core invariants (R19.4)
  - [x] 9.1 Inject, observe and revert each core-invariant fault, and log it
    - Files: temporary edits only (reverted); `docs/kiro-log.md` (appended).
    - For each row of design "Fault injection" (soul conservation 9.3, one soul one place 9.1/9.2, one Household per Resident 3.1, no actions by the dead 5.8/6.4, acyclic kinship 4.4, money conservation 3.5):
      1. Make the injected edit.
      2. Run `cargo test -p sim-core --test invariants` and `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 2000`.
      3. Confirm that both fail with the expected criterion. Copy the failing criterion, tick and seed or proptest case.
      4. Revert with `git checkout -- <file>`, then confirm that `git status` is clean and the two commands pass again.
      5. Append one log entry per fault: the fault, the failure seen and the revert.
    - If a fault is **not** caught, stop. Log it, strengthen the check (`invariants.rs` or the property), commit the fix separately as `test(sim-core): ...`, and repeat the injection.
    - _Requirements: 19.1, 19.4_
    - Acceptance: six log entries; `git status` shows only `docs/kiro-log.md`; commit as `docs: log life-sim invariant fault injections`.

- [x] 10. Checkpoint: full model and properties green
  - `scripts/gates.sh` must exit 0. The R15.8 diff check exits 0. Ensure all tests pass, ask the user if questions arise.

- [x] 11. Context_Builder and Snapshot
  - [x] 11.1 Implement the Context_Builder
    - Files: `crates/sim-core/src/context_builder.rs` (new), `crates/sim-core/src/lib.rs`.
    - Implement design "Context_Builder" steps 1 to 7: `build_decision_context` and `debt_repayment_node` (Family `DebtRepayment`; options `repay`, `stall`, `refuse` with the design's labels; the fixed situation template). Person IDs are the live IDs; events are `e1..=eN` by ascending live ID; `caused_by` entries outside the context are dropped; Souls render as `S-{:04}`; dead persons have `alive = false`, age at death and `wealth` 0. Build `llm::FrozenContext` through its public fields only. **Do not edit anything under `src/llm/`.**
    - Unit tests: `BuildError` for a dead subject, an unknown loan, and 0, 1 or 6 options; a dead creditor appears with `alive = false`; the situation has at most 80 words.
    - _Requirements: 15.1, 15.2, 15.3, 15.8_
    - Acceptance: Rust gates pass, the R15.8 diff check exits 0, and `cargo test -p sim-core context_builder` passes. Commit.
  - [x] 11.2 Property test: Property 15 (contexts built from the live World are valid cards)
    - File: `crates/sim-core/tests/context_builder.rs` (new). Read the committed `eval/probe/templates/decision.system_one.v1.txt` with `include_str!` or `std::fs` relative to `CARGO_MANIFEST_DIR`. For generated runs, check every open Debt with a Resident debtor at a sampled tick: the JSON round trip, `render_system_one` for every permutation from `render::permutations`, `validate_raw_choice` gives `Decision` for each exact option ID and `Illegal(OutOfSetOption)` for other generated strings, every value is inside the card ranges, and the IDs match the formats.
    - **Property 15: Contexts built from the live World are valid cards.** **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7**
    - Acceptance: `cargo test -p sim-core --test context_builder` passes. Commit.
  - [x] 11.3 Implement the Snapshot, the WASM export and the native snapshot fixture
    - Files: `crates/sim-core/src/snapshot.rs` (new), `crates/sim-core/src/lib.rs`, `crates/sim-wasm/src/lib.rs` (`WasmSim::snapshot()` taking `&self`, plus the plain twin `snapshot_string`), `crates/sim-cli/src/commands.rs` and `crates/sim-cli/src/lib.rs` (new subcommand `snapshot --replay <file> --at <tick> --out <file>`, which replays the file's seed, config and inputs up to `<tick>` and writes `snapshot_json`), `scripts/regen-fixtures.sh` (one added line that writes `fixtures/parity/seed1-pairwise.snapshot-500.json`), `fixtures/parity/seed1-pairwise.snapshot-500.json` (new), `fixtures/parity/README.md`, `crates/sim-wasm/tests/parity.rs`, `crates/sim-cli/tests/cli.rs`.
    - DTOs and field order exactly as in the design "Snapshot" JSON example; `serde_json::to_string`; lists in ascending ID order. The `snapshot` subcommand and the fixture file are not named in the design, which only says "a snapshot recorded natively at tick 500"; they are the chosen way to produce that file. Note this in the log entry and in `fixtures/parity/README.md`.
    - Tests: in `sim-wasm/tests/parity.rs`, under both native and `wasm-bindgen-test`, the snapshot at tick 500 of `seed1-pairwise` is byte-identical to the committed file (R18.3), and `snapshot()` equals `snapshot_json` for the same World. A unit test in `snapshot.rs` pins the `wealth` bound below 2^53. A `cli.rs` test covers the subcommand.
    - _Requirements: 18.1, 18.2, 18.3_
    - Acceptance: Rust gates pass, `cargo test -p sim-wasm --target wasm32-unknown-unknown` passes, and `scripts/regen-fixtures.sh` run twice leaves `git status` clean. Commit. The replay fixtures do not change; if they do, stop and investigate.
  - [x] 11.4 Property test: Property 18 (snapshots are faithful and read-only)
    - File: `crates/sim-core/tests/snapshot.rs` (new).
    - **Property 18: Snapshots are faithful and read-only.** **Validates: Requirements 18.1, 18.2**
    - Acceptance: `cargo test -p sim-core --test snapshot` passes. Commit.

- [x] 12. Calibration of the Params (OP-5)
  - [x] 12.1 Calibrate against the primary metrics and record the result
    - Files: `crates/sim-core/src/params.rs` (only if values change), `fixtures/parity/*` (regenerated if values change), `.kiro/specs/life-sim/design.md` (append a dated note under "Parameters and calibration"; do not rewrite existing text), `docs/kiro-log.md`.
    - Follow the "Calibration procedure" in the design exactly. Run `cargo run --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200`, and also `--seeds 1..=20` for a wider look, which is not gated. Change one parameter at a time, in the design's order. The primary metrics are `outsiders_le_births` (R17.8) and `max_wait_npc`. `pop_35_65`, `band_95`, `residents_min` and `band_40_60_ticks` are confirmed only, never tuned against. Also check `deaths` (40 to 70), `events` (under 20,000) and `relations_max` (expected near 4,500).
    - Decide on the tighter arrival ratio (design step 5). Adopt it only if all five seeds meet it with the final values. If adopted, add it as a target in `batch` and its test, and say so in the note.
    - The design note (`### Calibration result (YYYY-MM-DD)`) lists the final value of every changed parameter with the value it replaced, and the final five batch lines. Log each tuning run (parameter, value, key metrics) in `docs/kiro-log.md` as it happens.
    - If a primary target cannot be met by tuning, stop and ask the Author. Do not weaken a target.
    - _Requirements: 17.1, 17.2, 17.3, 17.8, 17.9_
    - Acceptance: `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets` exits 0 with five `ok` lines and every target `=pass`. Rust gates pass. If Params changed, the fixtures are regenerated and the commit message has the regeneration line. Commit as `feat(sim-core): calibrate life-sim params`.

- [ ] 13. Acceptance gate and measurements
  - [ ] 13.1 Add the acceptance batch to the gates and prove that it fails on a fault
    - Files: `scripts/gates.sh`, `docs/kiro-log.md`, `.kiro/specs/life-sim/design.md` (dated note under "Gate run time").
    - Add, right after the existing short batch line, the comment and `run cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets` from design "Gate run time". Time the step with `time`. If it exceeds 60 s, apply the first fallback of the design (skip record-and-verify for the Life_Runs only, keep the per-tick invariant checks), behind a flag such as `--no-verify-replay`, used only in this gate line, and log it. Reducing the seed count needs the Author: stop and ask.
    - Fault injection (R19.4): scale the mortality table by 30 in `params.rs`, run `scripts/gates.sh` and confirm that it stops at the acceptance step with `FAIL targets: ...band_95=fail` (or the target that fails first; copy the actual line). Revert, and confirm that `git status` is clean. Log the fault, the failure seen and the revert.
    - Design note `### Measured gate time (YYYY-MM-DD)`: the acceptance step time, the short batch time and the full `scripts/gates.sh` time.
    - _Requirements: 17.1, 17.8, 17.9, 19.3, 19.4_
    - Acceptance: `scripts/gates.sh` exits 0. Commit as `ci: add the 80-year acceptance batch to the gates`.
  - [x] 13.2 Measure ticks per second and record them
    - Files: `docs/kiro-log.md`, `.kiro/specs/life-sim/design.md` (dated note under "Baseline measurement").
    - Run `cargo run --release -p sim-cli -- measure --runs 5 --residents 60` and `scripts/measure-wasm.sh`. Record ticks per second, checksum ns per call, checksum share and canonical state bytes, next to the skeleton baseline in the design (22,620 ticks/s, 34,544 ns, 36,878 bytes). Report only; there is no threshold (OP-8 A).
    - _Requirements: 17.5_
    - Acceptance: both commands exit 0, and the numbers appear in both files. Commit as `docs: record life-sim measurements`.

- [ ] 14. README and steering layout
  - [x] 14.1 Update `README.md`
    - Files: `README.md`.
    - Check that the Name_List entry from 1.3 is present. Confirm that no third-party library was added: compare `Cargo.lock` and both `pnpm-lock.yaml` files with `afaf87c` (`git diff afaf87c -- Cargo.lock web/pnpm-lock.yaml eval/probe/pnpm-lock.yaml`). For any new crate or package, add its name and license. Update any README text that describes the skeleton model, the `workload` config or the `measure --entities` flag.
    - _Requirements: 19.5_
    - Acceptance: `git diff afaf87c -- Cargo.lock` shows no new package, or each new package is listed in `README.md`. Commit as `docs: update README for life-sim`.
  - [ ] 14.2 Update the planned layout in `.kiro/steering/structure.md`
    - Files: `.kiro/steering/structure.md`.
    - Edit only the layout and the module table. Under `crates/sim-core/` list the new modules (`params`, `names`, `values`, `events`, `opening`, `economy`, `social`, `death`, `births`, `outsiders`, `invariants`, `context_builder`, `snapshot`), the new test files (`tests/life_gen/`, `invariants.rs`, `history.rs`, `inputs.rs`, `opening.rs`, `context_builder.rs`, `snapshot.rs`), the `sim-cli snapshot` subcommand, and `fixtures/parity/seed1-pairwise.snapshot-500.json`. Mark spec 4 `life-sim` as done in "Next steps", with the open item "push pending the Author's approval". Do not change any other steering file.
    - Acceptance: the file lists every new file that exists under `crates/sim-core/src` (`ls crates/sim-core/src`). Commit as `docs(steering): update structure for life-sim`.

- [ ] 15. Final checkpoint and hand-off
  - [ ] 15.1 Run the full gates from a clean build and stop before pushing
    - Run `cargo clean`, then `scripts/gates.sh`. It must exit 0. Run the R15.8 diff check: it must exit 0. Run `git status`: it must be clean. Run `git log --oneline origin/main..main` and save the list.
    - **STOP AND ASK THE AUTHOR before any push.** A green push to `main` deploys the site automatically. The push would also carry the two local docs commits `c0d718d` and `0c9251b`, the life-sim requirements and design commits, and every commit of this plan. Give the Author the commit list and the gate result, and wait. Do not push, open a pull request or deploy unless the Author explicitly says so.
    - Append a log entry with the date, the gate result and "stopped for the Author's push decision". Commit it.
    - _Requirements: 19.3_
    - Acceptance: `scripts/gates.sh` exits 0, the working tree is clean, and the Author has been asked.

- [ ] 16. Kiro audit (assigned to Kiro, NOT executed by the terminal agent)
  - [ ] 16.1 Placeholder: Kiro writes `docs/life-sim-audit.md`
    - Kiro checks every requirement criterion against code, tests and logs, as in the earlier spec audits (`docs/llm-probe-audit.md`). This covers the review-only criteria R13.2, R16.2, R17.2, R19.2, R19.4 and R19.5, and the deviations noted in this plan (`values.rs` placement, the `sim-cli snapshot` subcommand and fixture, any gate fallback). The terminal agent skips this task.
    - _Requirements: 13.2, 16.2, 17.2, 19.2, 19.4, 19.5_

## Notes

- No task is marked optional. The property tests carry R19.1 and most of the semantic guarantees, and the Kiro audit depends on them.
- The red window is tasks 3.1 to 4.4. Between the commit of 3.3 and the commit of 4.4, `cargo build --workspace` fails in `sim-cli` and `sim-wasm`. Every other commit in the plan leaves the Rust gates green.
- From task 6.1 to 7.3, each tick-step task changes the Checksums and regenerates the Parity_Fixtures in its own commit. This keeps native/WASM parity and the Smoke_Test green after each step, instead of one large regeneration at the end.
- Design sections are cited by their headings in `.kiro/specs/life-sim/design.md`. Requirement numbers refer to `.kiro/specs/life-sim/requirements.md`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4", "1.5"] },
    { "id": 4, "tasks": ["1.6"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["4.1"] },
    { "id": 9, "tasks": ["4.2"] },
    { "id": 10, "tasks": ["4.3"] },
    { "id": 11, "tasks": ["4.4"] },
    { "id": 12, "tasks": ["6.1"] },
    { "id": 13, "tasks": ["6.2"] },
    { "id": 14, "tasks": ["6.3", "6.4"] },
    { "id": 15, "tasks": ["6.5"] },
    { "id": 16, "tasks": ["7.1"] },
    { "id": 17, "tasks": ["7.2"] },
    { "id": 18, "tasks": ["7.3"] },
    { "id": 19, "tasks": ["7.4"] },
    { "id": 20, "tasks": ["8.1"] },
    { "id": 21, "tasks": ["8.2", "8.4", "8.9", "8.10", "8.11", "8.12", "8.13"] },
    { "id": 22, "tasks": ["8.3", "8.5"] },
    { "id": 23, "tasks": ["8.6", "9.1"] },
    { "id": 24, "tasks": ["8.7"] },
    { "id": 25, "tasks": ["8.8"] },
    { "id": 26, "tasks": ["11.1"] },
    { "id": 27, "tasks": ["11.2", "11.3"] },
    { "id": 28, "tasks": ["11.4"] },
    { "id": 29, "tasks": ["12.1"] },
    { "id": 30, "tasks": ["13.1"] },
    { "id": 31, "tasks": ["13.2", "14.1"] },
    { "id": 32, "tasks": ["14.2"] },
    { "id": 33, "tasks": ["15.1"] },
    { "id": 34, "tasks": ["16.1"] }
  ]
}
```
