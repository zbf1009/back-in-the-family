# Implementation Plan: underworld

## Overview

This plan adds the thin underworld from `design.md` to `sim-core` on top of the life-sim model: joss paper accounts, the Magistrate, Birth_Slots and Standing_Slots, the Player_Soul wait, the carry-over, offerings, dreams, hauntings, Bribes, and the Decision_Node convention with `dream_interpretation` and `magistrate_ruling`. It then extends the invariant checker, the Snapshot and `sim-cli` (Auto_Player, report, zero-count gate), calibrates the Params against the 80-year acceptance batch, and adds the Parity_Fixture with an applied External_Choice.

The plan has six phases:

1. **Foundations (tasks 1 to 2).** IDs, Params, stream tags, Event kinds, joss accounts, input plumbing, the version bumps and the Magistrate.
2. **Slots and mechanics (tasks 3 to 5).** Birth_Slots and the births rewrite, the Player_Soul wait and claims, then offerings, nodes, dreams, hauntings and Bribes.
3. **Invariants, properties and Snapshot (tasks 6 to 8).**
4. **Auto_Player and batch report (task 9).**
5. **Calibration, gate and fixtures (tasks 10 to 11).**
6. **Final check and hand-off (tasks 12 to 13).**

There is **no red-gate window**. Every leaf task leaves `scripts/gates.sh` passing. A task that changes the canonical encoding or a recorded per-tick Checksum (most tasks in phases 1 and 2) regenerates the Parity_Fixtures in the same commit. `CANON_VERSION` 3 (task 1.1) and `REPLAY_VERSION` 4 (task 1.4) land in separate small commits, each with its fixtures regenerated. New `InputPayload` variants are added together with the code that applies them, and each such task updates `sim-cli` and `sim-wasm` in the same commit so the workspace always builds.

The language is Rust (edition 2024). `web/src` and `web/tests/smoke/*` are not changed (R14.7).

Update (2026-11-15), following the design's "Overview" update and its "Implementation notes" ("Next order"): task 10.1 stopped under calibration step 6. The remaining order is the R11.13 test (6.16), task 6.15 under the C1/C2 contract (6.15a, 6.15b, **STOP**), the offering diagnosis (9.5, **STOP**), and then, after the Author decides OP-U14 and OP-U15, the blocked tasks 9.6, 10.1 to 10.3, 11.1, 11.2 and 12.1.

Update (2026-11-15, after the 9.5 diagnosis), following the design's "Next order after the 9.5 diagnosis", "Gate split (decided)", the OP-U14 and OP-U15 decisions and the calibration decision note. Tasks 6.16, 6.15a and 9.5 are done (commits `59e6092`, `3fa9b64`, `e49f8fd`). OP-U14 and OP-U15 are decided, so every "Blocked: OP-U14/OP-U15" mark below is lifted; each such mark stays visible with "Unblocked 2026-11-15" appended, and superseded leaf text stays with a dated decision line below it. The remaining order is: 6.15b (independent branch, **STOP**); the R11.15 path tests (6.17); 9.6; the 10.1 close; 10.3 (**STOP** on a reproduction mismatch or a zero Devoted total); 10.2; 11.1; 11.2; 12.1 (also after Kiro has closed the 6.15b review; **STOP**); then Kiro's audit 13.1.

Decision (Author, 2026-11-15; Kiro's review of the 6.15b C2 verdicts): the review is closed (all nine C2 verdicts accepted) and a new leaf 6.18 (F1/F2 fixes) is added. The remaining order is now strictly serial: 6.15b (the `U15.8` 80-year faulted batch, then check it), 6.17, 6.18, 9.6, 10.1, 10.3, 10.2 (with the extra `U2.5`/`U2.6` Devoted re-runs), 11.1, 11.2, 12.1 (**STOP**), 13.1. This replaces the order above where they differ.

## Rules for the executing agent

The tasks are run one at a time by an external terminal coding agent. Kiro does only the final audit (task 13). These rules apply to every task:

- Read `.kiro/specs/underworld/requirements.md`, `.kiro/specs/underworld/design.md` and `.kiro/steering/*.md` (`tech.md`, `structure.md`, `product.md`) before the first task, and follow them. The life-sim spec (`.kiro/specs/life-sim/`) stays in force where this spec does not change it. The design is authoritative for names, types, numbers, option tables, formulas and step order; each task names the design section it follows. If the design and the code disagree, or the design leaves a needed choice open, stop and ask the Author. Do not invent a new rule silently.
- Requirement numbers `R<n>.<m>` refer to `.kiro/specs/underworld/requirements.md`; `LS-R<n>.<m>` refer to `.kiro/specs/life-sim/requirements.md`.
- **Commits**: conventional commits (`feat(sim-core): ...`, `feat(sim-cli): ...`, `test(sim-core): ...`, `chore(fixtures): ...`, `docs: ...`). Make one commit per leaf task unless the task says otherwise. Stage files by name. Never use `--no-verify` or `--amend` after a hook failure; fix the problem and make a new commit.
- **Never** push, deploy, create a remote, change git config or install global dependencies. A push to `main` deploys the site automatically. The local commits `f8939ad`, `b679466` and the underworld spec commits (`35fc39d`, `ed6f94d`) are intentionally unpushed; the Author decides when to push. If a task seems to need any of these actions, stop and ask the Author.
- **Never open** `eval/cards/cards/locked.jsonl`, `eval/cards/review/locked.md`, anything under `eval/cards/blind/`, or the root file `env`. Tests may read `eval/cards/cards/dev.jsonl` only.
- **LS-R15.8 / R14.4**: `crates/sim-core/src/llm/` and `eval/probe/templates/decision.system_one.v1.txt` must stay byte-identical. Before every commit, run `git diff --exit-code afaf87c -- crates/sim-core/src/llm eval/probe/templates/decision.system_one.v1.txt`. It must exit 0. This is called the *R14.4 check* below.
- **Determinism** (tech.md): integers only, `checked_*`/`saturating_*` where overflow is possible, a stated rounding rule for every division, no `HashMap`/`HashSet`, ordered iteration, every random draw through `rng::draw` with a `StreamTag` and ID-keyed entity, no clock, threads or env reads in `sim-core`. `crates/sim-core/tests/source_guard.rs` enforces part of this. The Auto_Player draws only from `StreamTag::AutoPlayer` and never from a simulation stream (R11.1).
- **Fixtures (R14.5)**: any commit that changes a per-tick Checksum recorded in `fixtures/parity/` must include the files regenerated with `scripts/regen-fixtures.sh` (including `seed1-pairwise.snapshot-500.json`, and `seedU-underworld.replay.json` once task 11.1 has added it). Its commit message must contain the line `Parity fixtures regenerated with scripts/regen-fixtures.sh.` Run the script twice: the second run must leave `git status` unchanged. Never disable or loosen a test to get past a Checksum change.
- **`docs/kiro-log.md`**: append factual entries as events happen: every fault injection (R12.4: the fault, the failure seen, the revert), every calibration run (parameter, value, key figures, the `batch: totals` line), measurements, surprises, and deviations from the design. Use the heading format `### Spec: underworld — <topic> (<date>)`. Append only. Never edit or reword earlier entries, and never backfill.
- **Rust gates**: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`.
- **Full gates**: `scripts/gates.sh` exits 0. It takes several minutes and needs the system Chrome and `mise`.
- **Fixture acceptance** (for every task that regenerates fixtures): Rust gates; `cargo test -p sim-wasm --target wasm32-unknown-unknown`; `cargo run -q --release -p sim-cli -- batch --seeds 1..=20 --ticks 2000` (all `ok`); `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets` exits 0; the R14.4 check.
- **Calibration**: the 80-year acceptance batch with `--require-targets` is a hard gate throughout. If a task makes it fail, follow design "Parameters and calibration" (one parameter at a time, in the design's order, each run logged). If the design's procedure cannot make it pass, stop and report to the Author. Never weaken a target or a check.
- Property tests use `proptest` with at least 100 cases (Property 6 and Property 23: 1,000). Mark each with the comment `// Feature: underworld, Property <n>: <title>`. Generated runs run the extended `InvariantChecker` after every tick.
- **STOP points**: at every task marked **STOP**, the agent stops and reports to Kiro, who forwards the report to the Author. The agent does not start any later task until the Author's decision is recorded in the spec (`requirements.md` or `design.md`). Tasks marked "Blocked: OP-U14/OP-U15" stay blocked until the Author's decisions on OP-U14 and OP-U15 are recorded in `design.md`.
- Update (2026-11-15, after the 9.5 diagnosis): the OP-U14 and OP-U15 decisions are recorded in `design.md`, so the "Blocked: OP-U14/OP-U15" marks no longer hold (each is marked "Unblocked 2026-11-15"). The STOP rule above still applies to 6.15b, 10.3 and 12.1. Where a leaf carries a line "Decision (Author, 2026-11-15, after the 9.5 diagnosis)", that line holds over the leaf's earlier text where they differ.

## Tasks

- [x] 1. Foundations: IDs, Params, Event kinds, joss accounts, inputs, the Magistrate
  - [x] 1.1 Add the new IDs, stream tags and Params, and bump `CANON_VERSION` to 3
    - Files: `crates/sim-core/src/ids.rs`, `crates/sim-core/src/rng.rs`, `crates/sim-core/src/params.rs`, `crates/sim-core/src/canon.rs`, `crates/sim-core/src/death.rs`, `fixtures/parity/*` (regenerated).
    - Follow design "Data Models" (`ids.rs additions`), "Module layout" (`rng.rs` row) and "Parameters and calibration".
    - `BirthSlotId(u64)` and `NodeId(u64)` with the same derives and `Canon` as the life-sim IDs (no `Hash`); counters start at 1.
    - Permanent `StreamTag` values `Nodes = 15`, `Offerings = 16`, `AutoPlayer = 17`, each documented (`AutoPlayer` is tooling only, like `ToolingInputs`; `Offerings` is reserved and unused). Existing pinned `draw` test values stay unchanged.
    - Every new `Params` field of the design table with its initial value, in the canonical encoding, including `mortality_floor_ppm` (default 0) and the magistrate and dream constants. The mortality step uses `max(mortality_ppm(age), mortality_floor_ppm)` (OP-D7 A). `Params::stress_underworld()` behind `#[cfg(any(test, feature = "test-support"))]` with exactly the values of the design paragraph.
    - `CANON_VERSION` 3 (OP-D4 A).
    - Unit tests: every new `DEFAULT` value pinned; `stress_underworld()` values pinned; the mortality floor raises a low band and leaves a higher band unchanged.
    - _Requirements: 2.5, 2.6, 3.1, 7.1, 8.1, 14.1, LS-R16.1_
    - Acceptance: fixture acceptance (see Rules). Commit as `feat(sim-core): add underworld ids, stream tags and params` with the regeneration line.
  - [x] 1.2 Add the new Event kinds and the ledger fields
    - Files: `crates/sim-core/src/events.rs`, `crates/sim-core/src/outsiders.rs`, `crates/sim-core/src/invariants.rs` (only if a match needs the new kinds), `fixtures/parity/*` (regenerated).
    - Follow design "Data Models" (the new Event kinds table) and OP-D3 A. Add `Offering { offerer, ghost, amount, credited }`, `BribeOffering { ghost, magistrate, amount }`, `Dream { ghost, dreamer, price }`, `Haunting { ghost, target, intensity, price }`, `Appeal { ghost, magistrate }`, and a `price: u64` on `Possession` and `Rebuild` (0 for NPC releases). Extend `actors()`, `card_type()`, `magnitude()` (the `offering` change of R2.7), the tags (`joss_paper`, `private` for the Bribe offering), `is_afterlife()` (adds the five kinds) and the `mood_delta` `haunting` row (target -15). Canonical encoding with new explicit tags.
    - Unit tests: card types and tags are in the card lists of `eval/cards/README.md`; actor order per the table; `offering` magnitude equals the amount; `is_afterlife` covers the five kinds; the haunting Mood row.
    - _Requirements: 1.2, 2.2, 2.7, 5.2, 6.1, 14.3, LS-R5.3, LS-R5.4, LS-R5.8, LS-R5.9_
    - Acceptance: fixture acceptance. Commit as `feat(sim-core): add underworld event kinds` with the regeneration line.
  - [x] 1.3 Add joss accounts
    - Files: `crates/sim-core/src/underworld/mod.rs` (new), `crates/sim-core/src/underworld/joss.rs` (new), `crates/sim-core/src/lib.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/opening.rs`, `crates/sim-core/src/testing.rs`, `fixtures/parity/*` (regenerated).
    - Follow design OP-D1 A (directory module), OP-U2 and "Data Models" (`JossAccount`). `cap_year(T) = T / 365`; `credit(account, amount, T) -> u64` returns `min(amount, yearly_cap - credited)` after the lazy reset; `spend(account, price)` uses checked subtraction; `capped_spend_allowed(account, price, T)` for hauntings and Rebuilt_Body claims. `World.joss: BTreeMap<SoulId, JossAccount>` with one account per Soul created at opening, in the canonical encoding after the life-sim fields, and a public read accessor. Extend `testing::Mutation` with a Joss_Balance and a cap-counter mutation.
    - Unit tests: credit at the cap boundary and above it (credit 0, magnitude unchanged); lazy reset in a later Cap_Year; spend cap at `yearly_cap`; one account per Soul after opening.
    - _Requirements: 1.1, 2.4, 2.5, 2.6_
    - Acceptance: fixture acceptance. Commit as `feat(sim-core): add joss paper accounts` with the regeneration line.
  - [x] 1.4 Extend rejections, add input outcomes and bump `REPLAY_VERSION` to 4
    - Files: `crates/sim-core/src/input.rs`, `crates/sim-core/src/tick.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-cli/src/batch.rs` (rejection list), `crates/sim-cli/tests/cli.rs`, `crates/sim-wasm/src/lib.rs` (docs only, if they state the version), `fixtures/parity/*` (regenerated), `fixtures/parity/README.md`.
    - Follow design "Inputs" (rejection table, "Input outcomes") and OP-D4 A. Add the 15 `RejectReason` variants with their labels and `Canon` tags 5..=19 in the design order; the batch report's `rejections=` field lists all 20 reasons. Add `InputOutcome { seq, result }`, `World::step_with_outcomes(inputs) -> (Checksum, Vec<InputOutcome>)` (`World::step` keeps its signature), and `Sim::last_outcomes()`. The outcome vector is never encoded or checksummed. `REPLAY_VERSION` 4; a version 3 file is rejected `UnsupportedVersion`. No new payload kind yet.
    - Unit tests: `last_outcomes()` lists every input of the last tick in `(tick, seq)` order with its result; it is empty after loading a run; a version 3 file is rejected.
    - _Requirements: 11.5, 14.1, 14.2, LS-R1.5, LS-R16.5, LS-R16.6_
    - Acceptance: fixture acceptance. Commit as `feat(sim-core): add input outcomes and replay format 4` with the regeneration line.
  - [x] 1.5 Add the Magistrate
    - Files: `crates/sim-core/src/underworld/magistrate.rs` (new), `crates/sim-core/src/underworld/mod.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/opening.rs`, `crates/sim-core/src/input.rs`, `crates/sim-core/src/testing.rs`, `crates/sim-cli/src/inputs.rs` (doc table only, if the unknown-person bucket can now hit the Magistrate's ID), `fixtures/parity/*` (regenerated).
    - Follow design OP-U1 A and its fixed-details table. `Magistrate { id, traits }` in `World`, created at the end of Opening_World generation with the next Person ID (`N + 1`) and Traits from `draw(seed, magistrate_id.rng_key(), Traits, Tick(0), i)` for `i` in 0..=6 in card trait order; name **Orrin Vell**, male, nominal age 600, Soul ID text `S-0000` as constants. Canonical encoding (`magistrate` first among the underworld fields). `World::append` accepts the Magistrate's ID only as the second actor of `BribeOffering` and `Appeal`, else `AppendRefused::UnknownActor`. Any input Person field naming the Magistrate is rejected `official_person` before any other check (R15.9), including `Act`. Extend `testing::Mutation` with a Magistrate-traits mutation.
    - Unit tests: `magistrate_is_created_once_with_fixed_fields`; Residents keep IDs `1..=N`; an `Act` naming the Magistrate as actor or as target is rejected `official_person`; `append` refuses the Magistrate as first actor or in any other kind; the Magistrate's full name differs from every Resident's.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.14_
    - Acceptance: fixture acceptance; existing life-sim opening tests still pass. Commit as `feat(sim-core): add the magistrate` with the regeneration line.

- [x] 2. Checkpoint: foundations green
  - Run the full gates: `scripts/gates.sh` must exit 0. Run the R14.4 check. Ensure all tests pass, ask the user if questions arise.

- [x] 3. Birth_Slots, the Player_Soul wait, claims and carry-over
  - [x] 3.1 Announce Birth_Slots and give birth from them
    - Files: `crates/sim-core/src/underworld/slots.rs` (new), `crates/sim-core/src/births.rs`, `crates/sim-core/src/death.rs`, `crates/sim-core/src/tick.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/testing.rs`, `crates/sim-core/tests/history.rs` (Property 5 expectation), `fixtures/parity/*` (regenerated).
    - Follow design "The tick (revised)" steps 6 and 7, "Birth_Slots", OP-U7 A and OP-U13 A. `BirthSlot { id, mother, announced, birth }`; `World.slot_ids` and `World.slots` (open slots only) in the canonical encoding. `births::process_announcements` (step 7): candidate mothers aged 18..=45 without an open slot, rolled only while the number of waiting Souls (the Player_Soul included) exceeds the number of open Birth_Slots; a success opens a slot with `birth = T + birth_lead_days`. `births::process_slot_births` (step 6): every slot with `birth == T` in slot ID order; the Soul is chosen at the birth tick (longest wait, ties lower Soul ID, LS-R10.1); no newborn if none waits (LS-R10.2); `bear(world, mother, soul)` takes the Soul instead of choosing it; the second parent is the mother's living spouse at the birth tick; the slot closes either way. `slots::close_for_mother` in the death settlement closes the dying mother's open slots. The claimed-slot branch is added in 3.3. Write the revised step list in the `tick.rs` comment block (LS-R16.2).
    - Update the life-sim tests whose expectations the design changes (Property 5: the Soul is chosen at the slot's birth tick; the births unit test "only the Player_Soul waiting gives no birth" under the OP-U13 A gate). Name each changed test in the commit body.
    - Unit tests in `slots.rs` / `births.rs`: a slot opens with the documented birth tick; the mother's death closes it with no birth; an unclaimed slot gives the longest-waiting non-player Soul; no newborn when no Soul waits.
    - Calibration: births now happen `birth_lead_days` after the roll. If the acceptance batch fails a target, apply design "Re-calibration" steps 1 to 3 here and log each run.
    - _Requirements: 7.1, 7.5, 14.1, LS-R10.1, LS-R10.2, LS-R10.3, LS-R10.4, LS-R10.5, LS-R16.2_
    - Acceptance: fixture acceptance. Commit as `feat(sim-core): announce birth slots before births` with the regeneration line.
  - [x] 3.2 Add the Player_Soul wait and the forced placement
    - Files: `crates/sim-core/src/underworld/player.rs` (new), `crates/sim-core/src/underworld/ghosts.rs` (new), `crates/sim-core/src/underworld/mod.rs`, `crates/sim-core/src/outsiders.rs`, `crates/sim-core/src/death.rs`, `crates/sim-core/src/tick.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/invariants.rs`, `crates/sim-core/src/testing.rs`, `crates/sim-core/tests/history.rs` (Property 3 expectation), `fixtures/parity/*` (regenerated).
    - Follow design "Player wait", OP-U4 A, OP-U8 A, OP-U10 A and "The tick" step 3. `PlayerWait { ghost, access_from, claim, carry_over }` and `World.player_wait` in the canonical encoding. `player::start_wait` at the Player_Soul's death: `ghost` is the latest body, `access_from = T + register_wait`. `ghosts.rs`: `ghosts(world)`, `is_connected(world, resident, ghost)` (any Relation toward the Ghost), `connected(world, ghost)`, all in Person ID order. `outsiders::create_outsider(world, soul, origin, price)` shared by NPC releases (kind still rolled by the caller, R10.3) and the forced placement. `underworld::place_player_if_overdue` runs after NPC releases in step 3: if `T - since > player_max_wait`, release any claim, call `create_outsider(.., Possessed, 0)` and clear `player_wait`.
    - Invariants (design "Invariant checker additions"): replace life-sim check `20.1` with `U7.10` (`player_wait` is `Some` exactly while the Player_Soul waits with a Ghost; a claim names an open slot; the Player_Soul leaves the queue only with a `birth`, `possession` or `rebuild` Event for it in this tick) and add `U8.3`. Update Property 3 per Property 19 ("leaves only by a claimed birth, a Standing_Slot claim or the R8.1 placement"). Extend `testing::Mutation` with a `player_wait` mutation.
    - Unit tests in `player.rs`: forced placement at exactly `player_max_wait + 1` and not at `player_max_wait`; the placement's `possession` Event has `price` 0; the acting Ghost is the latest body (ties higher Person ID).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 10.3, LS-R11.2, LS-R11.4_
    - Acceptance: fixture acceptance. Commit as `feat(sim-core): bound the player soul's wait` with the regeneration line.
  - [x] 3.3 Add slot claims and the carry-over
    - Files: `crates/sim-core/src/input.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-core/src/underworld/slots.rs`, `crates/sim-core/src/underworld/carry_over.rs` (new), `crates/sim-core/src/underworld/player.rs`, `crates/sim-core/src/births.rs`, `crates/sim-core/src/tick.rs`, `crates/sim-cli/src/*` and `crates/sim-wasm/src/lib.rs` (only where a `match` on `InputPayload` needs the new arms), `fixtures/parity/*` (only if Checksums change).
    - Follow design "Inputs" (payload enum, rejection table, replay JSON examples), "Standing_Slots", "Carry-over", OP-U7 A (claims are final and free), OP-U8 A and OP-U9 A. Add `SlotRef`, `TraitName`, `InputPayload::ClaimSlot { slot }` and `InputPayload::CarryOver { trait_name }`, with the matching `ReplayPayload` arms (`deny_unknown_fields`). Checks in the table order. A Birth claim sets `player_wait.claim`. A Standing claim spends the price (attributed to the `Possession`/`Rebuild` Event's `price`; the Rebuilt price counts against the spend cap), calls `create_outsider` with the claimed kind, clears `player_wait` and applies the carry-over. Add the claimed branch of `process_slot_births`: the newborn holds the Player_Soul, `player_wait` is cleared, the carry-over applies. `carry_over::apply_carry_over` copies the stored Trait from the Ghost; no stored Trait means no change. The R8.1 placement from 3.2 also calls it.
    - Unit tests: claim before `access_from` (`register_wait`); second claim (`claim_held`); a claim on the slot already held (`slot_claimed`); a closed slot (`slot_closed`); a mother dies with a claimed slot (slot closed, claim released, the Player_Soul still waits); Standing claim with too little joss (`insufficient_joss`) and over the cap (`yearly_cap`); carry-over fallback (no change); a later `CarryOver` replaces the earlier one; one replay round trip per new payload kind.
    - _Requirements: 7.2, 7.3, 7.4, 7.6, 7.7, 7.8, 7.10, 9.1, 9.2, 9.3, 9.4, 9.5, 10.2_
    - Acceptance: Rust gates; `cargo test -p sim-wasm --target wasm32-unknown-unknown`; the R14.4 check. The random-input fixtures contain only `Act` inputs, so Checksums should not change; if `scripts/regen-fixtures.sh` changes them, follow the fixture rule and explain why in the commit body. Commit as `feat(sim-core): add slot claims and carry-over`.

- [x] 4. Offerings, Decision_Nodes, dreams, hauntings and Bribes
  - [x] 4.1 Add offerings (step 5)
    - Files: `crates/sim-core/src/underworld/offerings.rs` (new), `crates/sim-core/src/underworld/mod.rs`, `crates/sim-core/src/tick.rs`, `fixtures/parity/*` (regenerated).
    - Follow design "Offerings" and OP-U3 A. `underworld::process_offerings` in step 5: Ghosts in Person ID order; occasion factor (funeral 2, anniversary 1, Halloween on `T % 365 == halloween_day` 1, the largest on a shared tick); eligible offerers aged 12+ with affinity at least `offer_min_affinity`, in Person ID order; `offering_amount` exactly as the design formula (floor, 0..=500); an amount of at least 1 appends `Offering` with `credited` from `joss::credit`. No money moves (R2.8). A reborn Soul's dead body gets nothing.
    - Unit tests: the formula at 0, 1 and 500; funeral and Halloween on the same tick count once with factor 2; a reborn Soul's dead body gets no offering; no money balance changes; the credit stops at the cap while `magnitude` stays the full amount.
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 10.1_
    - Acceptance: fixture acceptance. Commit as `feat(sim-core): add offerings by the living` with the regeneration line.
  - [x] 4.2 Add `build_node_context`
    - Files: `crates/sim-core/src/context_builder.rs`.
    - Follow design "Contexts and LS-R15". `build_node_context(world, subject, focus, family, options, situation, player_input)`: the subject may be a Resident or the Magistrate (`BuildError::DeadSubject` for a dead subject); events are the last 12 listing any `focus` Person (OP-D5 A); `card_person_any` renders the Magistrate as `official`, alive, age 600, wealth 0, `S-0000`. `build_decision_context` becomes `build_node_context(.., &[subject], .., None)` with unchanged output. **Do not edit anything under `src/llm/`.**
    - Unit tests: the life-sim `debt_repayment_node` context is byte-identical to before (compare against the JSON from the existing test or a pinned string); a Magistrate-subject context passes `frozen_context_from_json(frozen_context_to_json(ctx)) == ctx`; a dead subject is refused.
    - _Requirements: 3.9, 15.12, LS-R15.1, LS-R15.2, LS-R15.3, LS-R15.8_
    - Acceptance: Rust gates; `cargo test -p sim-core --test context_builder`; the R14.4 check. No Checksum change. Commit as `feat(sim-core): build node contexts with a focus set`.
  - [x] 4.3 Add the Decision_Node core and dreams
    - Files: `crates/sim-core/src/underworld/nodes.rs` (new), `crates/sim-core/src/underworld/dreams.rs` (new), `crates/sim-core/src/underworld/mod.rs`, `crates/sim-core/src/input.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-core/src/tick.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/testing.rs`, `crates/sim-cli/src/*` and `crates/sim-wasm/src/lib.rs` (only for new `match` arms).
    - Follow design "Decision_Node convention", "Rules_Default formulas" (`dream_default`), OP-U11 A, OP-U12 A (node addressing and `NodeOption` encoding), OP-D2 A and "Dreams". Add `NodeFamily`, `NodeOption` (snake_case IDs), `NodeRef::Trigger { seq }`, `ChoiceSource`, `PendingNode`, `NodeRecord`, `Nodes` and `World.nodes` in the canonical encoding (pending contexts encoded as `frozen_context_to_json` text). `nodes::fire`, `nodes::attach_choice`, `underworld::resolve_pending` (step 2b, Node ID order), `clamp_effect`. Add `DreamIntent`, `InputPayload::Dream { dreamer, intent }` and `InputPayload::Choose { node, option }` with replay arms. Dream checks in table order, including `rate_limited` (one applied dream per tick, OP-U5 A); spend, `Dream` Event, fire; option sets, effects (bounds of OP-U11), situation and content templates exactly as the design. R3.11 partial effects: each effect part re-checks its state. Extend `testing::Mutation` with a node-record mutation.
    - Unit tests: `dream_default_agrees_with_dev_cards` for every noise value in -10..=10 (reads `eval/cards/cards/dev.jsonl`, cards D-dream_interpretation-001 to 003, role mapping as in the design); one option-set test per intent; `Choose` before its trigger in the tick (`unknown_node`), twice (`already_chosen`), with an option outside the set (`option_not_in_set`); an applied External_Choice is recorded with source `External`; without one the Rules_Default applies with source `RulesDefault`; no node is pending after the tick; replay round trips for `Dream` and `Choose`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.2_
    - Acceptance: Rust gates; `cargo test -p sim-wasm --target wasm32-unknown-unknown`; the R14.4 check. Regenerate fixtures only if Checksums change (the empty `nodes` field changes the encoding, so expect a change), with the regeneration line. Commit as `feat(sim-core): add decision nodes and dreams`.
  - [x] 4.4 Add hauntings
    - Files: `crates/sim-core/src/underworld/hauntings.rs` (new), `crates/sim-core/src/underworld/mod.rs`, `crates/sim-core/src/input.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-cli/src/*` and `crates/sim-wasm/src/lib.rs` (only for new `match` arms).
    - Follow design "Hauntings" and OP-U5 A. `InputPayload::Haunt { target }` with its replay arm; checks in table order (`rate_limited`, `insufficient_joss`, `yearly_cap`); spend `haunt_price` against the spend cap; append `Haunting { ghost, target, intensity: haunt_intensity, price }`; the Mood change comes only from the `mood_delta` row.
    - Unit tests: the target's Mood moves by -15 and clamps at -100; a non-connected target is rejected `not_connected`; a second haunting in the tick is rejected `rate_limited`; the spend cap rejects with `yearly_cap`; replay round trip.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 2.6_
    - Acceptance: Rust gates; `cargo test -p sim-wasm --target wasm32-unknown-unknown`; the R14.4 check. Commit as `feat(sim-core): add hauntings`.
  - [x] 4.5 Add Bribes and the magistrate ruling
    - Files: `crates/sim-core/src/underworld/magistrate.rs`, `crates/sim-core/src/underworld/nodes.rs`, `crates/sim-core/src/input.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-cli/src/*` and `crates/sim-wasm/src/lib.rs` (only for new `match` arms).
    - Follow design "Bribes", "Rules_Default formulas" (`magistrate_default`), OP-U6 A and the `magistrate_ruling` row of the context table. `InputPayload::Bribe { amount }` with its replay arm; checks in table order (`bad_amount`, `insufficient_joss`, `node_pending`); append `BribeOffering` then `Appeal`, then fire the node with the Magistrate as subject and options exactly `grant_next_slot`, `grant_later_slot`, `deny`. Effects: `access_from = min(access_from, T)` or `min(access_from, T + grant_later_delay)`, clamped to `T..=current`; `deny` changes nothing; no refund; skipped when the Player_Soul has left the queue (R3.11, R6.7).
    - Unit tests: `magistrate_default_agrees_with_dev_pair_p006`; each grant moves `access_from` as documented and never later; a Bribe followed in the same tick by a Standing_Slot claim resolves with the effect part skipped and the record written (R3.11 example); a Bribe with amount 0 or above the balance appends no Event; replay round trip.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 3.10, 3.11, 15.11_
    - Acceptance: Rust gates; `cargo test -p sim-wasm --target wasm32-unknown-unknown`; the R14.4 check. Commit as `feat(sim-core): add bribes and the magistrate ruling`.
  - [x] 4.6 Add `Sim::preview_node`
    - Files: `crates/sim-core/src/underworld/nodes.rs`, `crates/sim-core/src/replay.rs` or the file that defines `Sim`.
    - Follow design "Decision_Node convention" (`NodeSpec`, `preview_node`, "Seam for the decision model"). Clone the World, run step 1 and step 2a for the inputs already submitted for the current tick, then the given payload with the next `seq`; return `NodeSpec` or `PreviewError::Rejected(reason)` / `PreviewError::NoNode`. The run is unchanged.
    - Unit tests: the preview equals the node fired by submitting the same payload (context, options, Rules_Default, trigger `seq`); the Checksum and the input queue are unchanged by a preview; a payload that would be rejected gives `Rejected` with the reason; a `Haunt` gives `NoNode`.
    - _Requirements: 3.1, 3.2, 3.7, 14.2_
    - Acceptance: Rust gates; the R14.4 check. Commit as `feat(sim-core): add node preview for external choices`.

- [x] 5. Checkpoint: mechanics green
  - `scripts/gates.sh` must exit 0, and the R14.4 check exits 0. Ensure all tests pass, ask the user if questions arise.

- [x] 6. Invariants, generator and property tests
  - [x] 6.1 Extend the invariant checker
    - Files: `crates/sim-core/src/invariants.rs`.
    - Follow design "Invariant checker additions". Add `U1.2`, `U1.3`, `U2.5`, `U2.6`, `U4.3`, `U5.3`, `U15.1` and `U15.4` to `U15.8` (`U7.10` and `U8.3` exist from 3.2), with the stateful parts (previous balances, per-Soul cap counters folded from the log, the opening Magistrate). Life-sim check `5.8` keeps its code and uses the extended Afterlife set.
    - Unit tests: each new check fires on a hand-built violating World or Event (through `testing::Mutation` or test-support setters) with its label and tick.
    - _Requirements: 12.1, 12.2, 1.1, 1.2, 1.3, 2.5, 2.6, 4.3, 5.3, 15.1, 15.4, 15.5, 15.6, 15.7, 15.8_
    - Acceptance: Rust gates; `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets` exits 0. Commit as `feat(sim-core): check underworld invariants every tick`.
  - [x] 6.2 Add the underworld run generator
    - Files: `crates/sim-core/tests/underworld_gen/mod.rs` (new), `crates/sim-core/tests/life_gen/mod.rs` (only to share helpers).
    - Follow design "Correctness Properties" ("Generated underworld run"): a seed, `opening_residents` in 40..=60, `Params::stress_underworld()` in 3 cases of 4 and `Params::DEFAULT` otherwise, 400 ticks, and per tick a state-aware mix of valid underworld inputs built from the World and invalid ones (wrong dreamer, the Magistrate's ID, zero or excessive Bribe, closed slot, `Choose` with a wrong trigger or option), plus life-sim `Act` inputs. Valid `Choose` inputs use `preview_node`. A stepping helper yields `(before, after, outcomes)` per tick and runs the extended `InvariantChecker`. Add a smoke test that, over 20 generated runs, at least one dream, haunting, Bribe, Birth claim, Standing claim and forced placement occurs (so the properties are not vacuous).
    - _Requirements: 12.1, 12.3_
    - Acceptance: `cargo test -p sim-core --test underworld` passes (the smoke test lives in `tests/underworld.rs`, new). Commit as `test(sim-core): add the underworld run generator`.
  - [x] 6.3 Property tests: Property 1 (the log is the joss ledger) and Property 2 (the Yearly_Cap holds)
    - File: `crates/sim-core/tests/underworld.rs`. One `proptest!` per property.
    - **Property 1: The log is the joss ledger.** **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 10.2**
    - **Property 2: The Yearly_Cap holds.** **Validates: Requirements 2.4, 2.5, 2.6, 10.1**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit as `test(sim-core): ...`.
  - [x] 6.4 Property test: Property 3 (offerings follow the occasions and the formula)
    - File: `crates/sim-core/tests/underworld.rs`.
    - **Property 3: Offerings follow the occasions and the formula.** **Validates: Requirements 2.1, 2.2, 2.3, 2.7, 2.8**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.5 Property tests: Property 4 (every Decision_Node fires, resolves once and is recorded) and Property 5 (Rules_Defaults depend only on the context and the node's draws)
    - File: `crates/sim-core/tests/underworld.rs`.
    - **Property 4: Every Decision_Node fires, resolves once and is recorded.** **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.8**
    - **Property 5: Rules_Defaults depend only on the context and the node's draws.** **Validates: Requirements 3.7, 6.4**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.6 Property test: Property 6 (the magistrate ruling is monotone in the amount)
    - File: `crates/sim-core/tests/underworld.rs`. Pure-function test over traits, noise values and amounts `a <= b`, 1,000 cases.
    - **Property 6: The magistrate ruling is monotone in the amount.** **Validates: Requirements 6.5**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.7 Property test: Property 7 (node contexts are valid cards)
    - File: `crates/sim-core/tests/underworld.rs`. Read the committed `eval/probe/templates/decision.system_one.v1.txt` relative to `CARGO_MANIFEST_DIR`, as `tests/context_builder.rs` does; use `render::permutations` and `validate_raw_choice`.
    - **Property 7: Node contexts are valid cards.** **Validates: Requirements 3.9, 4.4, 15.11, 15.12**
    - Acceptance: `cargo test -p sim-core --test underworld` passes; the R14.4 check. Commit.
  - [x] 6.8 Property tests: Property 8 (dreams), Property 9 (hauntings) and Property 10 (Bribes and rulings)
    - File: `crates/sim-core/tests/underworld.rs`. The "World differs only in ..." parts compare the tick with and without the input on cloned `Sim`s.
    - **Property 8: Dreams spend, fire and change only what the option names.** **Validates: Requirements 4.1, 4.5, 4.6, 4.7, 3.10**
    - **Property 9: Hauntings change only the target's Mood.** **Validates: Requirements 5.1, 5.2, 5.4**
    - **Property 10: Bribes and rulings change only access.** **Validates: Requirements 6.1, 6.6, 6.7, 3.10**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.9 Property tests: Property 11 (slots), Property 12 (the wait bound) and Property 13 (the carry-over)
    - File: `crates/sim-core/tests/underworld.rs`.
    - **Property 11: Slots open, are claimed and are born correctly.** **Validates: Requirements 7.1, 7.2, 7.4, 7.5, 7.6, 7.7, 7.10, 8.4**
    - **Property 12: The Player_Soul's wait is bounded.** **Validates: Requirements 8.1, 8.2, 8.3**
    - **Property 13: The carry-over changes at most one Trait.** **Validates: Requirements 9.1, 9.3, 9.4, 9.5**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.10 Property test: Property 14 (invalid underworld inputs are skipped and recorded)
    - File: `crates/sim-core/tests/underworld.rs`.
    - **Property 14: Invalid underworld inputs are skipped and recorded.** **Validates: Requirements 3.4, 4.3, 5.3, 6.2, 7.8, 9.2, 15.9**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.11 Property test: Property 15 (the Magistrate stays fixed and outside the town)
    - File: `crates/sim-core/tests/underworld.rs`.
    - **Property 15: The Magistrate stays fixed and outside the town.** **Validates: Requirements 15.1, 15.2, 15.3, 15.5, 15.6, 15.7, 15.8, 15.10, 15.14**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.12 Property test: Property 16 (replays with External_Choices reproduce every Checksum)
    - File: `crates/sim-core/tests/underworld.rs`. Filter to runs with at least one applied External_Choice; use `record` and `verify`, and tamper one recorded Checksum.
    - **Property 16: Replays with External_Choices reproduce every Checksum.** **Validates: Requirements 14.1, 14.2**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.13 Property test: Property 18 (every new state field reaches the Checksum)
    - File: `crates/sim-core/tests/underworld.rs`. Use the extended `testing::Mutation` (Joss_Balance, cap counter, slot, `player_wait`, node record, Magistrate traits).
    - **Property 18: Every new state field reaches the Checksum.** **Validates: Requirements 1.1, 3.6, 14.1**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.
  - [x] 6.14 Property test: Property 19 (life-sim properties keep holding)
    - Files: `crates/sim-core/tests/underworld.rs`, `crates/sim-core/tests/life_gen/mod.rs` (move the per-tick check bodies of life-sim Properties 1 to 7 out of `invariants.rs` and `history.rs` into shared helpers if needed, with no behaviour change), `crates/sim-core/tests/invariants.rs`, `crates/sim-core/tests/history.rs`.
    - Run the life-sim checks on generated underworld runs, with the Property 3 and Property 5 changes made in 3.1 and 3.2.
    - **Property 19: Life-sim properties keep holding.** **Validates: Requirements 7.10, 14.3, 10.3**
    - Acceptance: `cargo test -p sim-core` passes. Commit.
  - [x] 6.16 Targeted Rebuilt_Body functional test (R11.13; runs before 6.15)
    - Files: `crates/sim-core/tests/underworld.rs`, `docs/kiro-log.md` (appended).
    - Follow design "Rebuilt_Body scope" and "Gate split" (R11.13 bullet). Add the example test `a_rebuilt_claim_creates_an_imported_shaped_body`: build a test-support World with the Player_Soul waiting and its Joss_Balance at least `rebuilt_price` with cap room, clone it, apply `ClaimSlot { slot: RebuiltBody }` to one copy and `ClaimSlot { slot: ImportedVessel }` to the other in the same tick, and check R7.7 (the price is spent and attributed to the `Rebuild` Event; the Player_Soul left the Waiting_Queue; the outsider body holds it) and R7.11 (the two new bodies are equal in every field except the Origin; the spends differ only by price; only the Rebuilt spend raises `capped_spent`).
    - The test's doc comment and its `docs/kiro-log.md` record both say, labelled function-only: "proves the Rebuilt_Body path works; says nothing about whether a Rebuilt_Body is affordable through normal play".
    - No production change is expected. If the test finds a difference between the two bodies other than Origin, price and cap accounting, stop and report to Kiro.
    - _Requirements: 7.7, 7.11, 11.13_
    - Acceptance: `cargo test -p sim-core --test underworld a_rebuilt_claim_creates_an_imported_shaped_body` passes; Rust gates; the R14.4 check; the log record contains the function-only wording. Commit as `test(sim-core): prove the rebuilt body path works`.
  - [x] 6.15 Checker and fault evidence under the C1/C2 contract (R12.4 to R12.6)
      - Follow design "Checker and fault evidence (C1/C2, R12.4 to R12.6)". The earlier "Fault injections" table and the earlier 6.15 contract are superseded; the earlier 6.15 log entries stay as written and are re-judged in 6.15b. Leave 6.15 unchecked until 6.15a and 6.15b are both done.
      - [x] 6.15a C1: checker recognition tests
        - Files: `crates/sim-core/tests/underworld_checker.rs` (new; or, where a check needs private state, a unit test in `crates/sim-core/src/invariants.rs` next to the existing `U15.x` tests, as the design allows), `docs/kiro-log.md` (appended).
        - One test per checker label in the design's C1 column: `U1.3`, `U1.2`, `U2.5`, `U2.6`, `U4.3`, `U5.3`, `U7.10`, `U8.3`, `U15.1` and `U15.4` to `U15.8`, extended `5.8`. Each test builds the illegal state or tick transition directly through the `test-support` feature (for example `testing::apply(world, Mutation::..)` or a hand-built Event list), runs the `InvariantChecker` on it and asserts the exact criterion label. The design's test names are proposals; record the names used. Rows the design marks "existing" (`U15.1`, `U15.4` to `U15.8`, and `5.8` if `a_dead_actor_outside_afterlife_events_is_caught` already asserts `5.8` on such an Event) need no new test, only a log line naming the test and its label.
        - No production code change.
        - _Requirements: 12.4, 12.6_
        - Acceptance: `cargo test -p sim-core --test underworld_checker` passes; Rust gates; the R14.4 check. Spot-check one test: change its asserted label, confirm the test fails, revert, and record the test, the changed label and the failure in the log. The log lists every C1 test name with its label. Commit as `test(sim-core): add underworld checker recognition tests`.
      - [x] 6.15b C2: system detection of each production fault, and re-judging the earlier records **STOP**
        - Files: temporary edits only (reverted before any commit); `docs/kiro-log.md` (appended).
        - For each row of the design's C2 column (`U1.3`, `U2.5`, `U2.6`, `U4.3`, `U5.3`, `U7.10`, `U8.3`, `U15.8`, extended `5.8`): inject the listed production fault, run `cargo test -p sim-core --test underworld`, and, where the design's last column marks the fault reachable after the Auto_Player ("expected" or "to be observed": `U1.3`, `U2.5`, `U5.3`, `U7.10`, `U8.3`, `U15.8`, extended `5.8`), also run `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200`. Record the first guard that fired (one of the guards the row allows), its tick and case or seed, and the causal link to the fault. Record batch reachability as observed, never as a general claim from a shorter run.
        - Compile errors, timeouts, interrupted runs and failures unrelated to the fault do not count. Never disable or weaken another production guard to reach a label. Revert the edit, preserve unrelated WIP, and confirm both commands pass and `git status` shows only the log.
        - Re-judge each earlier 6.15 log record (2026-11-14 and 2026-11-15) one by one against R12.5, using the design's provisional re-judging table; confirm or reject each with evidence from the saved logs, one log line per record. Re-run where the earlier record does not establish causality, for example extended `5.8`: confirm that `World::append` refuses the `dream` Event with a dead Ghost once `Dream` is not afterlife and that this refusal causes the smoke-test failure; for `U15.8`, confirm that the Property 14 `event logs differ` failure comes from the refused Appeal. Rows where the 80-year faulted batch is still to run (`U1.3`, `U7.10`, `U8.3`) get that run.
        - If a fault produces no failure caused by it, log what was observed and include it in the STOP report as "no evidence"; do not change checks or properties in this task.
        - _Requirements: 12.5, 12.6_
        - Acceptance: one verdict per row (`U1.3`, `U2.5`, `U2.6`, `U4.3`, `U5.3`, `U7.10`, `U8.3`, `U15.8`, extended `5.8`), each with the fault, the commands, the first guard fired, the causal link, the batch result or "not run (design: not reachable)", and the verdict (counts / does not count, with the earlier record confirmed or rejected). Both commands pass after the final revert. Commit the log as `docs: record underworld fault evidence under C1/C2`.
        - **STOP.** Report the per-row verdict table to Kiro for review. Do not start a later task until the review is recorded.
        - Update (2026-11-15, after the 9.5 diagnosis): contract unchanged. Executable now and independent of 6.17, 9.6, 10.1 to 10.3, 11.1 and 11.2, which may run before or after it; the STOP above blocks only 12.1, which waits until Kiro has closed this review.
        - Decision (Author, 2026-11-15): the Author accepted all nine C2 verdicts (Kiro's review, "Kiro's review of the 6.15b C2 verdicts" in `docs/kiro-log.md`), so the review is closed. One step remains before 6.15b is checked: the faulted 80-year batch for `U15.8`. Inject the prescribed fault (the swapped `Appeal` actors, as the design's `U15.8` row states), run `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200` (Bribes are applied in the passive run, so the path is reachable), and record the actual result in `docs/kiro-log.md`, whether it fails or passes (exit status, first guard, seed and tick if it fails). Revert the edit, confirm `git diff` shows no source change (only the log), then commit the log and check 6.15b. No other 6.15b row is re-run. Run this before task 6.18, because it records the behaviour before the F1/F2 fixes.
  - [x] 6.17 Targeted path tests for haunting, Imported_Vessel claim and Birth_Slot claim (R11.15)
    - Files: `crates/sim-core/tests/underworld.rs`, `docs/kiro-log.md` (appended).
    - Follow design "Gate split (decided)" ("Functional acceptance (R11.15)") and "Testing Strategy" (the R11.15 addition). Add three example tests next to `a_rebuilt_claim_creates_an_imported_shaped_body` (6.16). Each builds a test-support World with the Player_Soul waiting, sets the state the path needs directly, applies one valid input and checks its outcomes:
      - `a_haunting_applies_and_changes_only_mood` (R5.2, R5.4): a Connected_Person target and a Joss_Balance of at least `haunt_price` with cap room; after the tick the price is spent and attributed to one `haunting` Event with actors (Ghost, target), the target's Mood moved by `haunt_intensity` within its range, and, compared with a clone of the World stepped without the input, no other field of the target differs.
      - `an_imported_claim_creates_the_vessel` (R7.7): a Joss_Balance of at least `imported_price`; the price is spent and attributed to the `Possession` Event with `price > 0`, the Player_Soul left the Waiting_Queue, and a new outsider body with Origin imported holds it.
      - `a_birth_slot_claim_places_the_player_at_birth` (R7.2, R7.4): an open, unclaimed Birth_Slot and `access_from` reached; the claim is recorded on the slot; at the slot's birth tick the newborn holds the Player_Soul's Soul ID, the Player_Soul left the Waiting_Queue, and one `birth` Event names the newborn.
    - Each test's doc comment and its `docs/kiro-log.md` record say, labelled function-only: "proves the path works; says nothing about whether it is affordable through normal play". One log entry lists the three test names with their requirement numbers.
    - No production change is expected. If a test shows that one is needed, stop and report to Kiro; do not change production code in this task.
    - _Requirements: 11.15, 5.2, 5.4, 7.2, 7.4, 7.7_
    - Acceptance: `cargo test -p sim-core --test underworld -- a_haunting_applies_and_changes_only_mood an_imported_claim_creates_the_vessel a_birth_slot_claim_places_the_player_at_birth` passes and runs exactly these three tests; Rust gates; the R14.4 check; the log record contains the function-only wording. Commit as `test(sim-core): prove the haunting, imported and birth claim paths work`.
  - [x] 6.18 Fix bribe atomicity (F2) and assert append-refusal mapping (F1)
      - Added (Author, 2026-11-15; Kiro's review of the 6.15b C2 verdicts). Runs after 6.15b (its `U15.8` batch records the behaviour before this fix) and 6.17, and before 9.6.
      - Files: `crates/sim-core/src/events.rs` (a crate-private query for room for `n` more Event IDs, as the design states), `crates/sim-core/src/underworld/magistrate.rs`, `crates/sim-core/src/underworld/dreams.rs`, `crates/sim-core/src/underworld/hauntings.rs`, `docs/kiro-log.md` (appended).
      - Follow design "Append refusals in the input handlers (F1, F2), Author 2026-11-15" under "Error Handling".
      - F2: in `magistrate::apply`, after the existing validation and before any append or spend, check that the Event ID counter has room for both Events (`BribeOffering` and `Appeal`); if not, reject `IdExhausted` and write nothing. The query matches `IdCounter::next` (room for two Events means `peek() + 2` does not overflow).
      - F1: at each site in these handlers that maps a `world.append(..)` refusal to `RejectReason::IdExhausted`, match on the error and add a `debug_assert!` that the refusal is `AppendRefused::IdExhausted`. The mapping stays. The `slots.rs` "no joss account" branch and the Offering append in `offerings.rs` keep their current behaviour.
      - Unit test: with a near-exhausted Event ID counter (`IdCounter::starting_at`, as the existing exhaustion test in `events.rs` does), a Bribe is rejected `IdExhausted` with no new Event, no spend and no node fired.
      - _Requirements: 6.1, 6.2, LS-R1.5_
      - Acceptance: Rust gates; `cargo test -p sim-core --test underworld` passes; `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200` prints final Checksums unchanged from the committed baseline; `scripts/regen-fixtures.sh` leaves `git status` unchanged; the R14.4 check. If any Checksum or fixture changes, stop and report to Kiro. Log entry in `docs/kiro-log.md` (the change, the test name, the batch Checksums compared). Commit as `fix(sim-core): make the bribe atomic and assert append refusals`.
      - Decision (Author, 2026-11-15): full atomicity; supersedes the ID-room-only F2 steps above. Follow design "Correction (Author, 2026-11-15): F2 requires full atomicity" under "Error Handling". The steps below replace the Files, F2, Unit test and Acceptance steps above; the F1 step stays as written.
        - Files: `crates/sim-core/src/world.rs` (`World::check_append`, extracted from `World::append`, which calls it; `World::append_all`), `crates/sim-core/src/events.rs` (crate-private `EventLog::has_room(n)`; test helper `exhaust_ids_leaving`), `crates/sim-core/src/underworld/magistrate.rs` (`commit_bribe`), `crates/sim-core/src/underworld/dreams.rs` and `crates/sim-core/src/underworld/hauntings.rs` (F1 `debug_assert!` only), `docs/kiro-log.md` (appended).
        - Actor validation exists once: `append` and `append_all` share `check_append`. `append` accepts and refuses exactly as before (same refusals, same order, same effects).
        - `commit_bribe` order: validate the input, then `append_all` with both Events (`BribeOffering` and `Appeal`), then spend the joss paper, then fire the node. If `append_all` refuses, the input is rejected with no Event, no spend and no node.
        - F1 `debug_assert!` is a diagnostic guard only; atomicity comes from `append_all`, in debug and release builds.
        - Tests: `a_bribe_on_a_near_exhausted_event_counter_is_rejected_atomically` (Event ID room 0 and room 1); `append_all_refuses_a_swapped_appeal_and_writes_nothing`; `a_bribe_with_a_swapped_appeal_spends_nothing_and_fires_no_node` (debug: the F1 assertion panics; release: rejected `IdExhausted`; in both: no Event, no spend, no node, Checksum unchanged).
        - _Requirements: 6.1, 6.2, LS-R1.5_
        - Acceptance: Rust gates; `cargo test -p sim-core --test underworld` passes; the three tests pass in debug, and `cargo test --release -p sim-core` passes the third; `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200` prints final Checksums equal to the committed baseline; `scripts/regen-fixtures.sh` leaves `git status` unchanged; the R14.4 diff check exits 0. **STOP** and report to Kiro if any Checksum or fixture changes, or if `append`'s accept/refuse behaviour would have to change. The task is not done if only Event ID room is guaranteed. Log entry in `docs/kiro-log.md` (the change, the test names, the batch Checksums compared). Commit as `fix(sim-core): make the bribe atomic and assert append refusals`.

- [x] 7. Snapshot
  - [x] 7.1 Extend the Snapshot
    - Files: `crates/sim-core/src/snapshot.rs`, `crates/sim-wasm/tests/parity.rs` (only if a test needs a change), `fixtures/parity/seed1-pairwise.snapshot-500.json` (regenerated), `fixtures/parity/README.md`.
    - Follow design "Snapshot": after `souls`, the fields `magistrate`, `joss` (Soul ID order), `birth_slots` (slot ID order; `household`, `birth`, `price` `"0"`, `claimant`), `standing_slots` (Imported first, present exactly while the Player_Soul waits), `player_wait` and `pending_nodes` (always empty under OP-U11), with the field order and string encodings of the JSON example. The Magistrate is in no Resident, Household or Soul list.
    - Unit tests: `standing_slots` is empty and `player_wait` null while the Player_Soul lives; both present with prices 100 and 400 while it waits; the Magistrate field matches the fixed details.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 7.9, 15.13, LS-R18.1, LS-R18.2, LS-R18.3_
    - Acceptance: Rust gates; `cargo test -p sim-wasm --target wasm32-unknown-unknown`; `scripts/regen-fixtures.sh` run twice changes only the snapshot file on the first run and nothing on the second; the R14.4 check. Commit as `feat(sim-core): show the underworld in the snapshot` with the regeneration line.
  - [x] 7.2 Property test: Property 17 (the extended Snapshot is faithful and read-only)
    - File: `crates/sim-core/tests/underworld.rs`.
    - **Property 17: The extended Snapshot is faithful and read-only.** **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 15.13, 7.9**
    - Acceptance: `cargo test -p sim-core --test underworld` passes. Commit.

- [x] 8. Checkpoint: invariants, properties and Snapshot green
  - `scripts/gates.sh` must exit 0, and the R14.4 check exits 0. Ensure all tests pass, ask the user if questions arise.

- [x] 9. Auto_Player and batch report
  - [x] 9.1 Add the Auto_Player and `record --auto-player`
    - Files: `crates/sim-cli/src/auto_player.rs` (new), `crates/sim-cli/src/lib.rs`, `crates/sim-cli/src/commands.rs`, `crates/sim-cli/src/args.rs`, `crates/sim-cli/tests/cli.rs`.
    - Follow design "Auto_Player and batch report" (reading of R11.10, strategy rotation, steps 1 to 5) and OP-U12 A. `AutoPlayer { waits_seen, per_wait }` and `fn plan(&mut self, sim: &Sim) -> Vec<InputPayload>`, called before every step; draws `d(i) = draw(seed, player_soul.rng_key(), StreamTag::AutoPlayer, T, i)`; `strategy = STRATEGIES[(world_seed % 3 + k) % 3]` with `STRATEGIES = [ImportedVessel, Birth, RebuiltBody]`; reads only public accessors and `preview_node`; the claim is the last input of the tick. `record --auto-player` (opt-in, OP-D8 A) writes the plan's inputs into the replay file.
    - Tests in `cli.rs`: `record --auto-player` writes at least one `Choose` input on a `stress_underworld` world (or a seed found to die early) and `replay`/`verify` passes on it.
    - _Requirements: 11.1, 11.2, 11.10, 11.12, 14.2_
    - Acceptance: Rust gates. Commit as `feat(sim-cli): add the auto player`.
  - [x] 9.2 Run the Auto_Player in `batch` and extend the report
    - Files: `crates/sim-cli/src/batch.rs`, `crates/sim-cli/src/lib.rs` (help text), `crates/sim-cli/tests/cli.rs`, `docs/kiro-log.md` (if calibration runs happen).
    - Follow design "Batch report additions" and OP-D8 A. `batch` always runs the Auto_Player. Each `ok` line gets, before `invariants=`, the fields `offerings`, `dreams`, `hauntings`, `bribes`, `claims=birth:..,imported:..,rebuilt:..`, `auto_placed`, `carry_overs`, `nodes=..`, `max_wait_player`, `player_lives=..`, from the sources in the design table (claims and carry-overs from `Sim::last_outcomes()`, cross-checked against Events). After the seed lines, print the `batch: totals ...` line with the nine totals. Add the pure `zero_count_failures(&Totals) -> Vec<&'static str>` in the design order, **but do not wire it into the exit status yet**; task 10.1 wires it after calibration, so the gate stays green in between. The exit status still reads only invariants and the life-sim targets.
    - Tests in `cli.rs`: the report is byte-identical on two runs (R11.6); the new fields parse in order; `player_lives` prints `alive` for a living body.
    - Calibration: if the acceptance batch now fails a life-sim target (R11.7), apply design "Re-calibration" steps 1 to 3 in this task and log each run.
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.7, 11.11_
    - Acceptance: Rust gates; `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets` exits 0 and prints the totals line; paste the totals line into a `docs/kiro-log.md` entry. Commit as `feat(sim-cli): play the underworld in batch runs`.
  - [x] 9.3 Property tests: Property 20, Property 21 and Property 22
    - Files: `crates/sim-cli/tests/auto_player.rs` (new), `crates/sim-cli/Cargo.toml` (dev-dependency `sim-core` with `test-support` already exists; add `proptest` as a dev-dependency only if missing, and list it nowhere new since it is already a workspace dependency).
    - Runs on `stress_underworld` worlds of 400 ticks, 100 cases each; the rotation half of Property 21 is a pure-function proptest over `(world_seed, k)`. Add the example tests `rotation_covers_every_kind_on_acceptance_seeds` and the 3 fixed seeds on `Params::DEFAULT` over 29,200 ticks (Property 20 example).
    - **Property 20: The Auto_Player is reproducible and meets R11.10 exactly.** **Validates: Requirements 11.1, 11.2, 11.10**
    - **Property 21: The strategy rotation covers every slot kind and every wait applies one Carry_Over.** **Validates: Requirements 11.12, 11.5, 9.1**
    - **Property 22: The batch report counts equal the recorded facts.** **Validates: Requirements 11.3, 11.4, 11.5, 11.6**
    - Acceptance: `cargo test -p sim-cli --test auto_player` passes; Rust gates. Commit as `test(sim-cli): ...`.
  - [x] 9.4 Property test: Property 23 (the zero-count gate fails exactly on a zero total)
      - File: `crates/sim-cli/tests/batch_gate.rs` (new). Pure-function proptest over generated `Totals`, 1,000 cases.
      - **Property 23: The zero-count gate fails exactly on a zero total.** **Validates: Requirements 11.9, 11.11**
      - Acceptance: `cargo test -p sim-cli --test batch_gate` passes. Commit.
  - [x] 9.5 Offering diagnosis (H1–H5) **STOP**
    - Executable now, after 6.16. Independent of 6.15: the agent may run it before or after 6.15a/6.15b (the dependency graph places it after 6.15b, following the design's "Next order").
    - Files: none committed except `docs/kiro-log.md` (appended). The diagnostic program is isolated: a scratch program outside the committed tree, or a throwaway file removed after the run. It reads the simulation only through public `sim-core` and `sim-cli` APIs (`test-support` allowed) and submits inputs only as TickInputs. Output files stay outside the repository (for example under `/tmp/`).
    - Follow design "Offering diagnosis (H1–H5)" exactly. Run setup: `Params::DEFAULT` at the current commit, Acceptance_Seeds 1..=5, 29,200 ticks each, two branches per seed: the **passive branch** (the current Auto_Player inputs exactly as `batch` submits them) and the **Devoted_Branch** (the passive inputs plus the H4 social acts, nothing else changed: at most one legal `Act` every 30 days while the Player_Soul's body lives, `Help` first per body then alternating with `Gift`, intensity 100, round-robin over living kin of the body in Person ID order, else the living Resident with the highest affinity toward the body, ties lower ID).
    - Sanity check: the passive branch's per-tick Checksums (or the final digest per seed, if `batch` prints it) equal the committed baseline `batch` at the same commit, seeds and ticks. A mismatch invalidates the run: stop and report.
    - Measure and report, per seed and as totals over the five seeds, for both branches: per Player_Wait the absolute joss paper credited and the zero-credit flag, and the zero-income share; the investment (Devoted_Branch acts submitted, applied, rejected by reason, and money moved by applied acts); affordability per wait of dream, haunting, Bribe, Imported_Vessel and Rebuilt_Body at some start-of-tick state, and spends by kind (H5); H1 incoming-Relation counts by sign × kin at every Offering_Occasion and every death, the change-source decomposition of every zero or negative Relation, its class (never warm / decayed from warm / netted to zero by events), kin time-to-zero next to `initial / 12` years, and every unattributed change; the H2 social-event rate per directed Relation per year (median, quartiles, zero share, kin / non-kin); the H3 attribution shares of negative values; the H3b counts of offerers lost by death (kin / non-kin); the NPC Ghost income distribution per wait (median, zero share, share reaching `yearly_cap`); and the passive-branch Checksum sanity result. No thresholds, no pass/fail.
    - No Params, mechanism, gate or committed source change.
    - _Requirements: 11.14 (first measurement only; the committed report is task 10.3)_
    - Acceptance: one `docs/kiro-log.md` entry with the sha256 of the diagnostic source, the commit it ran on, the exact commands, the output paths, the per-seed and total figures listed above, and the passive checksums equal to the baseline; `git status` shows only the log before the commit; the scratch source is not in the tree. Commit as `docs: log the underworld offering diagnosis`.
    - **STOP.** Report the figures to Kiro. The Author then decides OP-U15 (the offering mechanism) and OP-U14 (the zero-count list and the Devoted_Branch thresholds). No later task starts until both decisions are recorded in `design.md`.
  - [x] 9.6 Revisit 9.4: introduce `ZERO_COUNT_LIST` (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
      - Files: `crates/sim-cli/src/batch.rs`, `crates/sim-cli/tests/batch_gate.rs`.
      - Follow design "Gate split" and the Property 23 correction. Add `ZERO_COUNT_LIST: &[&str]` in `batch.rs` with the list the Author sets in OP-U14; it replaces the nine names and never contains `rebuilt_claims` (which stays in `Totals` and the `batch: totals` line as report-only) or `auto_placed`. `zero_count_failures(&Totals) -> Vec<&'static str>` keeps its signature and returns the zero names of `ZERO_COUNT_LIST` in list order. Update Property 23's test in `batch_gate.rs` to read the constant and to check that `rebuilt_claims`, `player_lives`, `auto_placed` and `max_wait_player` never change the result. Not wired into the exit status here (task 10.2). Task 9.4 and its text stay as recorded.
      - **Property 23 (revised): The zero-count gate fails exactly on a zero count of `ZERO_COUNT_LIST`.** **Validates: Requirements 11.9, 11.11**
      - Acceptance: `cargo test -p sim-cli --test batch_gate` passes (1,000 cases); Rust gates. Commit as `feat(sim-cli): set the zero-count list`.
      - Decision (Author, 2026-11-15, after the 9.5 diagnosis): follow design "Gate split (decided)" ("`zero_count_failures` with an explicit list") and Property 23 (decision paragraph); this replaces the `ZERO_COUNT_LIST` text above, which stays for the record. Runs after 6.17.
        - Files: `crates/sim-cli/src/batch.rs` (including its unit test `zero_count_failures_use_design_order_and_ignore_report_only_fields`), `crates/sim-cli/tests/batch_gate.rs`, and any other caller of `zero_count_failures` in `crates/sim-cli/` (update the call only).
        - No `ZERO_COUNT_LIST` constant. Add two explicit constants in `batch.rs`: `PASSIVE_ZERO_COUNT_LIST: &[&str] = &[]` and `DEVOTED_ZERO_COUNT_LIST` = `dreams`, `hauntings`, `bribes`, `imported_claims`, `rebuilt_claims`, `carry_overs`, `nodes_dream_interpretation`, `nodes_magistrate_ruling`, in that order. `birth_claims` and `auto_placed` are on neither list.
        - The signature becomes `pub fn zero_count_failures(t: &Totals, list: &[&'static str]) -> Vec<&'static str>`: it returns, in list order, the names in `list` whose `Totals` field is zero. A name that is not one of the nine `Totals` count fields is a programming error: `debug_assert!`, plus a unit test that every name of both constants is a known field.
        - Example tests: `PASSIVE_ZERO_COUNT_LIST` is empty; `DEVOTED_ZERO_COUNT_LIST` equals the eight names in the documented order.
        - **Property 23 (decided): for any `Totals` value, `zero_count_failures(&t, DEVOTED_ZERO_COUNT_LIST)` returns exactly the names of `DEVOTED_ZERO_COUNT_LIST` whose count is zero, in list order, and its result does not change when `birth_claims`, `player_lives`, `auto_placed` or `max_wait_player` change.** The test reads the constants. Keep the existing 1,000 cases (the minimum is 100). The invariance over the LS-R17 target results and the `afford_candidates` figures is added in 10.3, when those figures enter the report types (they are not in `Totals` before 10.3). **Validates: Requirements 11.16, 11.17, 11.11**
        - The `afford_candidates=` labelling (R11.17) is not part of this task; it belongs to the `devoted` line and lands in 10.3.
        - Not wired into any exit status here: the passive exit status does not call `zero_count_failures` (it reads invariants and LS-R17 only, as today), and the Devoted exit status is added in 10.3. No Checksum change, no fixture change.
        - Acceptance: `cargo test -p sim-cli --test batch_gate` passes (1,000 cases); `cargo test -p sim-cli --lib batch` passes; Rust gates; `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets` exits 0 with output byte-identical to the run before the change. Commit as `feat(sim-cli): set the passive and devoted zero-count lists`.
      - Decision (Author, 2026-11-15; Kiro's review of the 6.15b C2 verdicts): runs after 6.18 (which runs after 6.17); content unchanged.

- [x] 10. Calibration and the zero-count gate (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
  - [x] 10.1 Resume calibration under OP-U15 (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
    - Files: `crates/sim-core/src/params.rs` (only if values change), the files of any mechanism change OP-U15 picks (for example `crates/sim-core/src/underworld/offerings.rs`, `crates/sim-core/src/social.rs`), `fixtures/parity/*` (regenerated if Checksums change), `.kiro/specs/underworld/design.md` (append a dated note `### Calibration result (<date>)` under "Parameters and calibration"; do not rewrite existing text), `docs/kiro-log.md`.
    - Status: design "Re-calibration (OP-U13)" steps 1 to 3 hold from the earlier 10.1 runs; steps 4 to 6 are suspended until OP-U15. After OP-U15, implement the mechanism change it picks (if any) and resume steps 4 to 6 against the target the Author sets with OP-U15; the 160-credit median of step 4 is not assumed to stand. Step 5's "all nine totals" is replaced by `ZERO_COUNT_LIST`. Concrete steps, levers and targets: to be detailed after OP-U14/OP-U15.
    - Rules that already apply: one parameter at a time in the design's order; log every run with its `batch: totals` line; never change the rotation formula; if a listed total stays zero or a life-sim target cannot be met, stop and report to the Author. The zero-count gate is not wired here (task 10.2).
    - _Requirements: 11.7, 11.8, 11.12_
    - Acceptance: to be detailed after OP-U14/OP-U15. At least: `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets` exits 0 with five `ok` lines and every target `=pass`; Rust gates; fixture acceptance if Checksums changed (with the regeneration line).
    - Decision (Author, 2026-11-15, after the 9.5 diagnosis): follow design "Parameters and calibration" (decision note) and OP-U15 (decision). This replaces the "resume" text above, which stays for the record. Task 10.1 closes with **no Params change**: OP-U15 chose none of M-A, M-B or M-C, so no mechanism change is implemented, and calibration steps 4 to 6 are **cancelled**, not suspended. Runs after 9.6.
      - Files: `docs/kiro-log.md` (appended) only. No change to `params.rs`, any mechanism file, `fixtures/parity/*` or `design.md` (the design already carries the decision note, so no `### Calibration result` note is added).
      - Run the passive acceptance batch on the committed `Params::DEFAULT` (`birth_ppm_married` 1,000, `birth_ppm_unmarried` 100 at the time of writing; read the actual values from `params.rs` and log them): `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets`. It must exit 0 with five `ok` lines and every LS-R17 target (LS-R17.1, LS-R17.8, LS-R17.9) passing.
      - Log one entry `### Spec: underworld — task 10.1 closed (<date>)` stating: the Author's decision (OP-U15: no mechanism, R2 and every Params value unchanged), that calibration steps 4 to 6 are cancelled, the Params values the run used, the exact command, the exit status, the five `ok` lines and the `batch: totals` line exactly as printed.
      - If the batch fails an LS-R17 target or an invariant, **stop and report** to Kiro with the failing lines; do not change a Params value, a target or a check.
      - _Requirements: 11.7, 11.8_
      - Acceptance: the batch above exits 0 on the committed defaults; `git status` shows only the log before the commit; the R14.4 check. Commit as `docs: close underworld calibration with no params change`.
  - [x] 10.2 Wire the zero-count gate, gather the Auto_Player fault evidence, and measure the gate time (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
    - Files: `crates/sim-cli/src/batch.rs`, `crates/sim-cli/src/lib.rs` (help text), `crates/sim-cli/tests/cli.rs`; temporary edits only for the faults (reverted); `docs/kiro-log.md`; `.kiro/specs/underworld/design.md` (dated note `### Measured gate time (<date>)` under "Gates").
    - Wire `zero_count_failures` over `ZERO_COUNT_LIST` into `--require-targets`, only after OP-U14: any zero listed count prints `batch: FAIL zero counts: <names>` and exit status 1. Update `BATCH_USAGE`. Test in `cli.rs` (or a `batch.rs` unit test with constructed `Totals`): a zero listed count gives the FAIL line and exit 1; `rebuilt_claims`, `player_lives`, `auto_placed` and `max_wait_player` never affect the exit status.
    - Auto_Player faults, per design "Checker and fault evidence" (last three bullets), each injected, observed under the C2 rules of 6.15b, reverted and logged:
      - Rotation drops `RebuiltBody` (two-entry table): C2 evidence for the rotation half of Property 21; `cargo test -p sim-cli --test auto_player` must fail because three consecutive waits no longer form a permutation. No batch run is needed. It is no evidence for R11.13.
      - Skips `CarryOver`: C2 evidence for Property 21 (every wait applies exactly one Carry_Over), and for the zero-count gate only if OP-U14 keeps `carry_overs` on the list.
      - Never haunts: C2 evidence for the zero-count gate only if OP-U14 keeps `hauntings` on the list; otherwise dropped.
      - The exact gate runs and expected FAIL lines: to be detailed after OP-U14/OP-U15.
    - Time the acceptance step and the full `scripts/gates.sh` with `time`, and compare with the life-sim figure (about 20 s for the acceptance step). Report only; if the acceptance step exceeds 60 s, stop and ask the Author before changing the gate.
    - _Requirements: 11.8, 11.9, 11.11, 12.5, 12.6_
    - Acceptance: `scripts/gates.sh` exits 0 after the reverts; one log entry per fault with its verdict; the design note. Commits: `feat(sim-cli): require the zero-count list in the acceptance batch`, then `docs: log underworld gate fault evidence and gate time`.
    - Decision (Author, 2026-11-15, after the 9.5 diagnosis): follow design "Gate split (decided)", "Checker and fault evidence (C1/C2)" (decision paragraph and its table) and "Gates" (decision note). This replaces the text above where they differ; that text stays for the record. **Runs after 10.3** (it needs `--devoted --require-reachability`).
      - Files: `scripts/gates.sh`, `crates/sim-cli/src/batch.rs` and `crates/sim-cli/tests/cli.rs` (only if the passive exit path needs a test or a change), temporary edits in `crates/sim-cli/src/auto_player.rs` for the faults (reverted), `docs/kiro-log.md`, `.kiro/specs/underworld/design.md` (dated note `### Measured gate time (<date>)` under "Gates", appended).
      - Passive exit: confirm, with a test in `cli.rs` or a `batch.rs` unit test, that `--require-targets` reads only the invariant results and the LS-R17 targets and never calls `zero_count_failures` (for example a `batch.rs` unit test of the exit decision: constructed `Totals` with every count zero, passing invariants and passing targets, gives exit 0). The passive command and its `scripts/gates.sh` step stay unchanged.
      - Devoted gate: add one step to `scripts/gates.sh`, `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --devoted --require-reachability`, directly after the passive 80-year step (`--require-targets`) and before `scripts/wasm-build.sh`, using the script's existing `run` helper.
      - Auto_Player faults (tech.md rule: a new gate must be shown to fail once). Each is a temporary edit in `auto_player.rs`, followed by the Devoted gate command, then reverted before any commit; observe under the C2 rules of 6.15b and log the fault, the command, the printed FAIL line, the exit status and the revert:

        | Fault | Expected on `--devoted --require-reachability` |
        |---|---|
        | The Auto_Player never haunts | `batch: FAIL zero counts: hauntings`, exit 1 |
        | The rotation drops `RebuiltBody` (two-entry table) | `batch: FAIL zero counts: rebuilt_claims`, exit 1 |
        | The Auto_Player skips the `CarryOver` input | `batch: FAIL zero counts: carry_overs`, exit 1 |

        A FAIL line that names further counts still counts if the expected name is on it and the fault explains the others. Property 21's rotation half failing under the `RebuiltBody` fault may be logged as an extra observation. The earlier bullets that move the `RebuiltBody` row to Property 21 or drop the haunting row are withdrawn.
      - If the Devoted gate on the unfaulted tree reports any `DEVOTED_ZERO_COUNT_LIST` total as zero, **stop and report**; change neither Params nor the list.
      - Time the passive acceptance step, the Devoted gate step and the full `scripts/gates.sh` with `time`; compare with the life-sim figure (about 20 s for the acceptance step) and the design's estimate (about 20 s extra). Report only; if either 80-year step exceeds 60 s, stop and ask the Author before changing the gate.
      - _Requirements: 11.7, 11.11, 11.16, 12.5, 12.6_
      - Acceptance: `scripts/gates.sh` exits 0 after the reverts, with the new step; `git diff` after the reverts shows no change in `auto_player.rs`; one log entry per fault with its verdict and one entry with the timings; the design note. Commits: `chore(gates): run the devoted reachability gate`, then `docs: log underworld gate fault evidence and gate time`.
    - Decision (Author, 2026-11-15; Kiro's review of the 6.15b C2 verdicts): follow design "Checker and fault evidence (C1/C2)" (decision note on the `U2.5`/`U2.6` Devoted re-runs). After the Devoted gate step is wired, also re-run the `U2.5` and `U2.6` production faults of the C2 table, each injected exactly as written there, on `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --devoted --require-reachability`. This is extra evidence only: no change to Params, seeds, gates, the zero-count rules or the injections. Judge each run under the C2 rules of 6.15b and record the result in `docs/kiro-log.md` as observed (exit status, first guard, seed and tick if it fails); a pass is logged as a pass, not as unreachability. Revert each edit before any commit and confirm `git diff` shows no source change.
  - [x] 10.3 Add the `batch --devoted` report (R11.14) (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
    - Files: `crates/sim-cli/src/batch.rs`, `crates/sim-cli/src/auto_player.rs` (or a new module for the Devoted_Branch acts), `crates/sim-cli/src/args.rs`, `crates/sim-cli/src/lib.rs` (help text), `crates/sim-cli/tests/cli.rs`.
    - Follow design "Gate split" (R11.14 bullet) and "Offering diagnosis (H1–H5)" H4/H5: `batch --devoted` runs each seed a second time as the Devoted_Branch with the H4 strategy and prints, per seed, one `devoted` line with per-Player_Wait fields `joss=<credited>`, `zero=<0|1>`, `acts=<applied social acts during the preceding Player_Life>`, `affordable=<subset of dream,haunting,bribe,imported,rebuilt>`, plus the share of zero-credit waits. The flag never changes the exit status; `--devoted` is not part of `scripts/gates.sh`. Thresholds, if any, and the tests: to be detailed after OP-U14/OP-U15.
    - _Requirements: 11.14_
    - Acceptance: to be detailed after OP-U14/OP-U15. At least: Rust gates; the `devoted` figures agree with the 9.5 diagnosis at the same commit and Params.
    - Decision (Author, 2026-11-15, after the 9.5 diagnosis): follow design "Gate split (decided)" (Devoted reachability gate, Devoted strategy, flag rules, reproduction check, R11.17 report) and Property 22 (Devoted half and its correction). This replaces the text above where they differ ("runs each seed a second time" becomes "runs each seed once, as the Devoted_Branch"; `affordable=` becomes `afford_candidates=`); that text stays for the record. **Runs after 10.1 and before 10.2.**
      - Files: `crates/sim-cli/src/auto_player.rs` (`DevotedLiving`), `crates/sim-cli/src/batch.rs`, `crates/sim-cli/src/args.rs`, `crates/sim-cli/src/lib.rs` (help text, `BATCH_USAGE`), `crates/sim-cli/tests/cli.rs`, `crates/sim-cli/tests/auto_player.rs`, `crates/sim-cli/tests/batch_gate.rs`, `docs/kiro-log.md`. No `sim-core` change.
      - `DevotedLiving` in `auto_player.rs`, exactly the H4 strategy as the design states it: while the Player_Soul's body is a living Resident, at most one legal `Act` every 30 days (the first on the body's first living day with a valid target; a scheduled day with no valid target submits nothing and keeps the 30-day step); kind `Help` first per body, then alternating with `Gift`; intensity 100; actor the player's body; target round-robin in Person ID order over the living Residents holding a Kinship_Tag toward the body, else the living Resident with the highest affinity toward the body (ties lower ID). Reads the World only through public accessors and draws nothing. The tick's inputs are the passive inputs unchanged and in the same order, followed by the `DevotedLiving` act. Where the design leaves an encoding detail open, the 9.5 scratch source (SHA-256 in the 9.5 log entry) is the reference and the reproduction check decides.
      - `batch --devoted` runs each seed once, as the Devoted_Branch only, and prints the usual per-seed `ok` line with all report fields, one `devoted` line per seed with per-Player_Wait fields `joss=<credited>`, `zero=<0|1>`, `acts=<applied social acts during the preceding Player_Life>`, `afford_candidates=<subset of dream,haunting,bribe,imported,rebuilt>` (start-of-tick reading: balance at least the price, with spend-cap room for the haunting and the Rebuilt_Body, balance at least 1 for the Bribe), plus the share of zero-credit waits, and the totals. The Devoted totals print the candidate counts in their own labelled field (for example `afford_candidates=dream:5,haunting:5,bribe:5,imported:4,rebuilt:3`, waits with that candidate), apart from the applied counts (R11.17). LS-R17 targets are printed (`=ok` / `=fail`) but do not affect the Devoted exit status.
      - `--require-reachability`: the exit status reads only the invariant results and `zero_count_failures(&totals, DEVOTED_ZERO_COUNT_LIST)` over the five seeds; a non-empty result prints `batch: FAIL zero counts: <names>` (list order) and exits 1. No candidate is read by any exit-status code. `--devoted` alone exits from the invariants only.
      - Usage errors (`EXIT_USAGE_OR_MALFORMED`): `--require-reachability` without `--devoted`; `--devoted` together with `--require-targets`. Passive `batch` output without `--devoted` stays byte-identical.
      - Tests: unit or `cli.rs` tests for both usage errors, for `afford_candidates=` being printed apart from the applied counts and read by no exit code, and for the FAIL line on constructed Devoted totals with a zero listed count. Extend Property 23 in `batch_gate.rs`: the result of `zero_count_failures(&t, DEVOTED_ZERO_COUNT_LIST)` does not change when the LS-R17 target results or any `afford_candidates` figure change (1,000 cases kept). Add the Devoted half of Property 22 in `auto_player.rs`: for any generated run driven by the Auto_Player plus `DevotedLiving` on `stress_underworld` worlds of 400 ticks (100 cases), each Player_Wait's `joss`, `zero`, `acts` and `afford_candidates` equal the values recomputed from the Event_Log, the input outcomes and the start-of-tick balances and cap counters, and the `devoted` line is byte-identical on a second run. Tag: `// Feature: underworld, Property 22: The batch report counts equal the recorded facts`. **Validates: Requirements 11.14, 11.16, 11.17**
      - Reproduction check (after the tests pass): run `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --devoted --require-reachability` and the passive `cargo run -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets`. Compare with the 9.5 figures: per-seed Player_Wait credits 124, 500, 331, 770 and 500 (seeds 1 to 5, one wait each); 4,829 applied social acts (961, 968, 968, 964, 968) with none rejected; 2 applied Rebuilt_Body claims (seeds 2 and 5) and 1 applied Imported_Vessel claim (seed 3). Confirm the passive final Checksums are unchanged: seed 1 `b7d43807a7b10c1c`, 2 `60aac25e66d04ee4`, 3 `d42c8597714be26a`, 4 `8827a29693a6db43`, 5 `24761c26dae6c515`. Log the commands, both outputs (the `ok`, `devoted` and totals lines exactly as printed), and the comparison row by row.
      - **STOP and report** to Kiro if any reproduced figure or passive Checksum differs, or if any `DEVOTED_ZERO_COUNT_LIST` total is zero. Do not adjust `DevotedLiving` to hit the numbers, and change neither Params nor either list. Commit the code and tests before stopping only if the Rust gates pass; when stopped, leave 10.3 unchecked until Kiro records the review.
      - _Requirements: 11.14, 11.16, 11.17_
      - Acceptance: Rust gates; `cargo test -p sim-cli --test cli --test auto_player --test batch_gate` passes; the reproduction check matches every figure and every passive Checksum; the Devoted command exits 0; the R14.4 check; the log entry. Commits: `feat(sim-cli): add the devoted batch run`, then `docs: log the devoted batch reproduction check`.
    - Decision (Author, 2026-11-15; Kiro's review of the 6.15b C2 verdicts): 6.18 (F1/F2) must be done before 10.3 starts, so the Devoted batch work runs on the fixed handlers; content unchanged.

- [x] 11. Parity fixture with an External_Choice, docs and steering (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
  - [x] 11.1 Add the `seedU-underworld` Parity_Fixture (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
    - Runs after 10.1: the seed search uses the calibrated Params and any mechanism change of OP-U15, so it is not started before 10.1 is done.
    - Files: `scripts/regen-fixtures.sh`, `fixtures/parity/seedU-underworld.replay.json` (new), `fixtures/parity/README.md`, `crates/sim-wasm/tests/parity.rs`, `docs/kiro-log.md`.
    - Follow design OP-D6 A: run the one-off `cargo run -q --release -p sim-cli -- batch --seeds 1..=200 --ticks 7300` once and pick the seed with the earliest Player_Soul death (from `player_lives`); ticks = that death tick + 400; record with `record --auto-player`. Write the seed and tick count into `regen-fixtures.sh` and log the search (command, chosen seed, death tick). Add the fixture to the native and WASM parity list in `parity.rs`, plus a native test that at least one `NodeRecord` after replaying it has `source == External` (R14.6). If no applied External_Choice occurs in the chosen run, take the next-earliest seed and log why.
    - _Requirements: 14.5, 14.6, 14.7_
    - Acceptance: fixture acceptance; `scripts/regen-fixtures.sh` run twice leaves `git status` unchanged after the commit; `cargo test -p sim-wasm --target wasm32-unknown-unknown` covers the new fixture. Commit as `test(fixtures): add a parity fixture with external choices`.
    - Decision (Author, 2026-11-15, after the 9.5 diagnosis): runs after 10.1, 10.3 and 10.2 are done (10.x). The "calibrated Params and any mechanism change of OP-U15" above are now the committed `Params::DEFAULT` unchanged, with no mechanism change (OP-U15 decision; 10.1 closed with no Params change). The seed search, the recording with `record --auto-player` (the passive Auto_Player, not `DevotedLiving`) and the rest of the task are unchanged. Fixture acceptance stays as the Rules define it; any `scripts/gates.sh` run now also includes the Devoted gate step that 10.2 added.
  - [x] 11.2 Add the source guard for R14.4, and update README and structure.md (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
    - Files: `crates/sim-core/tests/source_guard.rs`, `README.md`, `.kiro/steering/structure.md`.
    - `source_guard.rs`: a test that the files under `crates/sim-core/src/llm/` and `eval/probe/templates/decision.system_one.v1.txt` hash-equal pinned blake3 values of their committed contents (design "Example and unit tests", last bullet).
    - `README.md`: confirm no new third-party package (`git diff ed6f94d -- Cargo.lock web/pnpm-lock.yaml eval/probe/pnpm-lock.yaml`); list any new one with its license; note that the Magistrate's name is the project's own. Update any text that describes the batch report or the replay format version.
    - `structure.md`: edit only the layout, the module table and "Next steps": add `src/underworld/` (its files), `tests/underworld.rs`, `tests/underworld_gen/`, `sim-cli/src/auto_player.rs`, `sim-cli/tests/auto_player.rs`, `batch_gate.rs`, `tests/underworld_checker.rs`, `fixtures/parity/seedU-underworld.replay.json`; mark spec 5 `underworld` as done pending the Kiro audit and the Author's push decision. Do not change any other steering file.
    - _Requirements: 14.4_
    - Acceptance: Rust gates; the R14.4 check; `structure.md` lists every file under `crates/sim-core/src/underworld/` (`ls`). Commit as `docs: update README and structure for underworld` (the source guard may be a separate `test(sim-core): ...` commit).
    - Decision (Author, 2026-11-15, after the 9.5 diagnosis): runs after 11.1; content unchanged. "Text that describes the batch report" in `README.md` includes `batch --devoted` once 10.3 has added it.

- [x] 12. Final checkpoint and hand-off (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
  - [x] 12.1 Run the full gates from a clean build and stop for Kiro's audit (Blocked: OP-U14/OP-U15; Unblocked 2026-11-15)
    - Files: `docs/kiro-log.md` (append only).
    - Run `cargo clean`, then `time scripts/gates.sh`. It must exit 0. Run the R14.4 check: it must exit 0. Run `git status`: it must be clean before the log entry. Run `git log --oneline origin/main..main` and save the list.
    - Append `### Spec: underworld — final check (task 12.1, <date>)` with the gate result, the wall time, the R14.4 result, the five acceptance-batch `ok` lines and the `batch: totals` line from this gate run exactly as printed, the unpushed commit list, and "stopped for Kiro's audit (task 13.1)". Commit it.
    - **STOP.** Hand back to Kiro. Do not push, open a pull request or deploy; a green push to `main` deploys the site, and the Author decides when to push. Do not check task 13.1.
    - _Requirements: 14.7, 14.4_
    - Acceptance: `scripts/gates.sh` exits 0 from a clean build, the R14.4 check exits 0, and after the log commit `git status` is clean. Commit as `docs: record the underworld final gate run`.
    - Decision (Author, 2026-11-15, after the 9.5 diagnosis): runs after 11.2 **and** only after Kiro has closed the 6.15b review (the 6.15b STOP; the review is recorded in the spec and 6.15 is checked). If that review is not closed, stop and say so instead of starting. The log entry also contains, exactly as printed by this gate run, the Devoted gate's five `ok` lines, its `devoted` lines and its totals line (with `afford_candidates=`), next to the passive acceptance lines. The STOP and the push rule above are unchanged.

- [ ] 13. Kiro audit (assigned to Kiro, NOT executed by the terminal agent)
  - [ ] 13.1 Placeholder: Kiro writes `docs/underworld-audit.md`
    - Kiro checks every requirement criterion against code, tests and logs, as in `docs/life-sim-audit.md`. This covers the review-only criteria R10.3 (`create_outsider` reads no joss), R11.11 (exit-status code), R12.4 and R14.5 (process), the calibration result, the fault-injection entries, and every deviation logged during this plan. The terminal agent skips this task.
    - _Requirements: 10.3, 11.11, 12.4, 14.5_
    - Decision (Author, 2026-11-15): 13.1 is checked by Kiro after 14.1 is reported and the final audit record is written.

- [ ] 14. Audit follow-ups (Author decisions 2026-11-15, docs/underworld-audit.md)
  - [x] 14.1 Direct contract test for the magistrate option set (R6.3, audit finding 5)
    - Executed by the terminal agent. Files: `crates/sim-core/tests/underworld.rs` (or `crates/sim-core/src/underworld/magistrate.rs` tests), `docs/kiro-log.md`.
    - Add a test, e.g. `a_fired_magistrate_ruling_offers_exactly_the_three_options_in_order`, that fires a real `magistrate_ruling` node through a valid Bribe input (and/or `Sim::preview_node` for a Bribe) and asserts that the options actually offered by that node — the node's option list and the Frozen_Context's options — are exactly `grant_next_slot`, `grant_later_slot`, `deny`, in this order. The order is part of the contract: R6.3 lists the options in this order, the `RULING_OPTIONS` doc comment says "in this order", and ties in a Rules_Default go to the earlier option. The test must read the fired node or its context, not repeat the `RULING_OPTIONS` constant as the expected value source (write the expected IDs as literals).
    - No functional change. If the test fails, stop and report to Kiro; do not change production code.
    - _Requirements: 6.3, 3.2_
    - Acceptance: the new test passes in `cargo test -p sim-core --test underworld <name>` (or the module path used); Rust gates pass; R14.4 diff check exits 0; append a log entry `### Spec: underworld — audit follow-up 14.1 R6.3 contract test (<date>)` with the test name, command and result; commit `test(sim-core): pin the magistrate ruling option set` (one commit; stage files by name). Then STOP and report the commit hash and results to Kiro.

## Notes

- No task is marked optional. The property tests carry R12.1 and most of the semantic guarantees, and the Kiro audit depends on them.
- There is no red window. The version bumps (1.1, 1.4) and every encoding or tick-logic change regenerate the fixtures in their own commit. New payload kinds come with their handlers and with the `sim-cli`/`sim-wasm` match arms in the same commit.
- The zero-count check is added as a pure function in 9.2 and wired into the exit status in 10.1, after calibration, so the acceptance gate never goes red between commits.
- Update (2026-11-15): under the design's "Gate split", `ZERO_COUNT_LIST` (task 9.6) replaces the nine names and never contains `rebuilt_claims`; the gate is wired into the exit status in task 10.2, only after OP-U14. Until then the acceptance batch gates the invariants and the life-sim targets only. `batch --devoted` (10.3) and the H1–H5 diagnosis (9.5) are never part of `scripts/gates.sh`.
- Update (2026-11-15, after the 9.5 diagnosis), per design "Gate split (decided)": there is no `ZERO_COUNT_LIST`. The passive acceptance batch has the empty `PASSIVE_ZERO_COUNT_LIST` and gates invariants and LS-R17 only. The Devoted reachability gate (`batch --devoted --require-reachability`, built in 10.3) gates invariants and `DEVOTED_ZERO_COUNT_LIST` (which includes `rebuilt_claims` and `imported_claims`), and 10.2 adds it to `scripts/gates.sh` after the passive 80-year step. `--devoted` without `--require-reachability` stays report-only, and the H1–H5 diagnosis still never runs in the gates.
- Life-sim tests whose expectations the design changes (Property 3, Property 5, the R10.2 births test) are updated in the task that changes the behaviour (3.1, 3.2), and the commit body names them.
- Design sections are cited by their headings in `.kiro/specs/underworld/design.md`.
- Dependency graph (updated 2026-11-15, after the 9.5 diagnosis): 6.15b is a parallel branch in the same wave as 6.17; the main chain is 6.17 → 9.6 → 10.1 → 10.3 → 10.2 → 11.1 → 11.2 → 12.1 → 13.1, and 12.1 also waits for 6.15b and Kiro's review of it. 6.15b and 6.17 both append to `docs/kiro-log.md` (under separate headings), and 6.15b makes temporary production edits; in one working tree, run them one after the other, in either order, never interleaved with another task's test run.
- Decision (Author, 2026-11-15; Kiro's review of the 6.15b C2 verdicts): the dependency graph is now one chain, 6.15b (`U15.8` batch) → 6.17 → 6.18 → 9.6 → 10.1 → 10.3 → 10.2 → 11.1 → 11.2 → 12.1 → 13.1. 6.15b runs first because its `U15.8` batch records the behaviour before the 6.18 fix. 6.18 must be done before 10.3. 6.17 has no design dependency on 6.18, but both run in the same working tree, so they run one after the other. This replaces the graph description above where they differ.
- Decision (Author, 2026-11-15): build profiles stay unchanged in this spec; test-time optimization (gate time 1,258 s, `cargo test --workspace` about 1,030 s) is separate later work, not part of this spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["1.5"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["4.1", "4.2"] },
    { "id": 9, "tasks": ["4.3"] },
    { "id": 10, "tasks": ["4.4"] },
    { "id": 11, "tasks": ["4.5"] },
    { "id": 12, "tasks": ["4.6"] },
    { "id": 13, "tasks": ["6.1"] },
    { "id": 14, "tasks": ["6.2"] },
    { "id": 15, "tasks": ["6.3"] },
    { "id": 16, "tasks": ["6.4"] },
    { "id": 17, "tasks": ["6.5"] },
    { "id": 18, "tasks": ["6.6"] },
    { "id": 19, "tasks": ["6.7"] },
    { "id": 20, "tasks": ["6.8"] },
    { "id": 21, "tasks": ["6.9"] },
    { "id": 22, "tasks": ["6.10"] },
    { "id": 23, "tasks": ["6.11"] },
    { "id": 24, "tasks": ["6.12"] },
    { "id": 25, "tasks": ["6.13"] },
    { "id": 26, "tasks": ["6.14", "7.1"] },
    { "id": 27, "tasks": ["7.2", "9.1"] },
    { "id": 28, "tasks": ["9.2"] },
    { "id": 29, "tasks": ["9.3", "9.4"] },
    { "id": 30, "tasks": ["6.16"] },
    { "id": 31, "tasks": ["6.15a"] },
    { "id": 32, "tasks": ["9.5"] },
    { "id": 33, "tasks": ["6.15b"] },
    { "id": 34, "tasks": ["6.17"] },
    { "id": 35, "tasks": ["6.18"] },
    { "id": 36, "tasks": ["9.6"] },
    { "id": 37, "tasks": ["10.1"] },
    { "id": 38, "tasks": ["10.3"] },
    { "id": 39, "tasks": ["10.2"] },
    { "id": 40, "tasks": ["11.1"] },
    { "id": 41, "tasks": ["11.2"] },
    { "id": 42, "tasks": ["12.1"] },
    { "id": 43, "tasks": ["14.1"] },
    { "id": 44, "tasks": ["13.1"] }
  ]
}
```
