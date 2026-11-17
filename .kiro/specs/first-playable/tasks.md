# Implementation Plan: first-playable

## Overview

Spec 6 makes the loop playable in the browser with rules only: a mid-life adult, stops with concrete Stakes, death, one template-text dream, a rebirth path chosen from slots whose status is spelled out, and a second life that keeps running. It adds the Narrator and Player_Nodes, the Intro_Debt with its Intro_Grace, Rebuilt_Body Customization, Path_Status, clock-paced play with the interactive advancement gate, the Town_View, four Scene_Templates and the panels, and the playthrough Smoke_Test.

The plan has six phases and four checkpoints. A checkpoint is a STOP: the executing agent stops there and reports, and does not start the next phase until the Author says so.

1. **Core spine (tasks 1 to 4).** Narrator, patterns, Intro_Debt, Customization. Checkpoint after task 4: the first life stops inside the band on the five Acceptance_Seeds, headless.
2. **Seams (tasks 5 to 6).** Snapshot, stops, replay format 5, the fixtures regenerated. Checkpoint after task 6: native and WASM checksums agree on the regenerated fixtures.
3. **Pace and the gate (tasks 7 to 8).** Clock pacing, then the interactive advancement gate. Checkpoint after task 8: the gate refuses an unanswered node on the Worker request path and advances once a choice is accepted. This is the P-1 execution scope checkpoint.
4. **Playable (tasks 9 to 11).** Town_View and panels, the four scenes and the Underworld_Panel, the Art_Trial. Checkpoint after task 11: the Author judges the art; the slice ships with placeholders if the decision is late.
5. **Proof (tasks 12 to 14).** Batch metrics and the `first_stop_band` gate, the Playthrough_Fixture and its seed search, the playthrough Smoke_Test.
6. **Close (tasks 15 to 16).** Fault injections, the comparison document, steering, the final check and Kiro's audit.

Window: 2026-11-16 to 2026-11-21 at the latest (3 to 5 days). The phases are the order of work; the dates are not allocated per task, because the checkpoint reports decide what the next day is spent on.

## Rules for the executing agent

The tasks are run one at a time by an external terminal coding agent. OMP (standing in for Kiro) does the planning, the checkpoint reviews and the final audit (task 16), and does not implement. These rules apply to every task:

- Read `.kiro/specs/first-playable/requirements.md`, `.kiro/specs/first-playable/design.md` and `.kiro/steering/*.md` before the first task, and follow them. The life-sim spec (`.kiro/specs/life-sim/`) and the underworld spec (`.kiro/specs/underworld/`) stay in force where this spec does not change them. The design is authoritative for names, types, numbers, option tables, formulas and step order; each task names the design section it follows. If the design and the code disagree, or the design leaves a needed choice open, stop and ask the Author. Do not invent a new rule silently.
- Requirement numbers `R<n>.<m>` refer to `.kiro/specs/first-playable/requirements.md`; `LS-R<n>.<m>` to `.kiro/specs/life-sim/requirements.md`; `UW-R<n>.<m>` to `.kiro/specs/underworld/requirements.md`.
- **Commits**: conventional commits. Make one commit per leaf task unless the task says otherwise. Stage files by name. Never use `--no-verify` or `--amend` after a hook failure; fix the problem and make a new commit.
- **Never** push, deploy, create a remote, change git config or install global dependencies. A push to `main` deploys the site automatically. If a task seems to need any of these, stop and ask the Author.
- **Never open** `eval/cards/cards/locked.jsonl`, `eval/cards/review/locked.md`, anything under `eval/cards/blind/`, or the root file `env`. Tests may read `eval/cards/cards/dev.jsonl` only.
- **R15.6**: `crates/sim-core/src/llm/` and `eval/probe/templates/decision.system_one.v1.txt` must stay byte-identical to the commit where this spec starts. Before every commit, run `git diff --exit-code 2cabbaa -- crates/sim-core/src/llm eval/probe/templates/decision.system_one.v1.txt`. It must exit 0. This is called the *R15.6 check* below. `2cabbaa` is the underworld close-out commit; if `HEAD` has moved, use the commit recorded as this spec's start in `docs/kiro-log.md` and say which.
- **Determinism** (steering `tech.md`): integers only, `checked_*`/`saturating_*` where overflow is possible, a stated rounding rule for every division, no `HashMap`/`HashSet`, ordered iteration, every random draw through `rng::draw` with a `StreamTag` and an ID-keyed entity, no clock, threads or env reads in `sim-core`. `crates/sim-core/tests/source_guard.rs` enforces part of this. `player_node_state` is a read: it takes no draw, changes no state and is never encoded.
- **Fixtures (R15.4)**: any commit that changes a per-tick Checksum recorded in `fixtures/parity/` must include the files regenerated with `scripts/regen-fixtures.sh` and the line `Parity fixtures regenerated with scripts/regen-fixtures.sh.` in its message. Run the script twice; the second run must leave `git status` unchanged. Never disable or loosen a test to get past a Checksum change.
- **`docs/kiro-log.md`**: append factual entries as events happen: every fault injection (the fault, the failure seen, the revert), every measurement, every surprise, every deviation from the design. Use the heading format `### Spec: first-playable — <topic> (<date>)`. Append only. Never edit or reword earlier entries, and never backfill.
- **Rust gates**: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`.
- **Full gates**: `scripts/gates.sh` exits 0. It takes several minutes (377 s baseline, 2026-11-16) and needs the system Chrome and `mise`.
- **STOP points**: at every task marked **STOP**, the agent stops and reports to OMP, who forwards the report to the Author. The agent does not start any later task until the Author's decision is recorded in the spec.

## Checkpoints

Each checkpoint is the proof that one phase works, and the point where the Author can cut scope if the window is closing. The report at each one says what is done, what is not, and the measured time.

- **C1, after task 4.** Headless only. A core/CLI run of the five Acceptance_Seeds runs past offset 900 and reports each first stop; the half-open band is `600 <= offset < 900` and offset 900 fails. It also reports IntroDebt Grace evidence. This checkpoint does not measure Worker wall time or apply the Worker unanswered-node gate; task 14 owns the Speed-1 measurement.
- **C2, after task 6.** The regenerated fixtures pass native/WASM parity, and a replay stream resolves a Player_Node by Rules_Default. No web change yet.
- **C3, after task 8.** The Worker gate: at the first node stop, a Worker-path `run` returns `node_unanswered` without advancing; after an accepted choice, `run` advances and resolves it; a rejected choice does not open the gate.
- **C4, after task 11.** The Author judges the Art_Trial and records adopt, adopt plus drawn gaps, or change in `docs/kiro-log.md`; the checkpoint blocks proof/close tasks. No pack file is committed before the decision; late decisions keep placeholders but still require the recorded checkpoint.

## Tasks

- [x] 1. Narrator skeleton: state, step 2c, step 13a, the `ChoosePlayer` input
  - [x] 1.1 Add the Narrator state, the two steps and the input
    - Files: `crates/sim-core/src/narrator/mod.rs` (new), `crates/sim-core/src/narrator/chronicle.rs` (new), `crates/sim-core/src/tick.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/opening.rs`, `crates/sim-core/src/testing.rs`, `crates/sim-core/src/input.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-core/src/lib.rs`, `crates/sim-core/src/params.rs`, `crates/sim-core/src/rng.rs`, `crates/sim-core/src/canon.rs`, `crates/sim-core/tests/replay.rs`, `crates/sim-core/tests/underworld_gen/mod.rs`, `fixtures/parity/*` (regenerated).
    - Follow design "Tick step order", "sim-core: narrator/ module", "Data Models", and the Chronicle contract. `PlayerFamily`, `PlayerOption` (the 24 IDs and tags 0..=23), `EntrySource`, `SkipReason`, `EffectPart::check`, `PreviewWhat`, `StakeUnit`, and the Chronicle hash-chain/Canon encoding are defined there; this task implements the complete closed enums and exact labels/tags.
    - `EffectPart::Repay` and its `check` contract are definition-only in this task: validate the open Debt, matching debtor and sufficient money, but do not move money, append a repayment, call `economy::repay`, or add a temporary local repayment path. Task 2.1 is the sole task that wires the checked effect to the shared `economy::repay` seam.
    - `World::narrator` with `pending: Option<PlayerNode>`, the hash-chained `Chronicle` and `life: Option<PlayerLife>`, encoded inside the Checksum after `nodes`. `CANON_VERSION` advances 3→4 at this task boundary. `Params` gains the narrator fields and `StreamTag::Narrator`; existing stream tags do not change.
    - `opening.rs` and `testing.rs` gain `narrator: Narrator::default()` only. No `intro_debt`, opening rule, body selection or added Debt is introduced here; task 3.1 owns `IntroDebt` and the next Canon boundary.
    - `InputPayload::ChoosePlayer { node, option }` and the matching `ReplayPayload` arm are implemented here. `ReplayPlayerOption` uses the same snake_case IDs and strict decimal-string Node ID, with `deny_unknown_fields`; the replay version remains baseline v4 in this task.
    - `crates/sim-core/tests/underworld_gen/mod.rs` is included because adding `ChoosePlayer` requires its exhaustive `InputPayload` match to compile. The underworld generator does not produce or submit `ChoosePlayer`/Player_Node payloads at this stage; keep that generation stream unchanged. Handle the new arm explicitly according to that strategy (an explicit unreachable/guarded branch stating that the generator never emits it), not as a silent no-op and not by implementing future Narrator behaviour.
    - Unit tests cover the exact Chronicle/SkipReason JSON and canonical round-trip, `ChoosePlayer` DTO round-trip, strict unknown/u64 rejection, and a v4 replay retaining its baseline header. Property 3 and Property 4 are owned by `crates/sim-core/tests/narrator.rs` in task 2.1.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 3.1, 3.7, 15.1_
    - Acceptance: fixture acceptance for Canon v4 (Rust gates, including compilation of `crates/sim-core/tests/underworld_gen/mod.rs`, wasm32 tests, short batch, passive acceptance batch, R15.6 check). Commit `feat(sim-core): add the narrator steps and the player choice input` with the regeneration line.

- [ ] 2. Patterns, options, salience and the budget
  - [ ] 2.1 Add the five Pattern families and the selection rule
    - Files: `crates/sim-core/src/narrator/patterns.rs` (new), `crates/sim-core/src/narrator/options.rs` (new), `crates/sim-core/src/narrator/salience.rs` (new), `crates/sim-core/src/social.rs`, `crates/sim-core/src/economy.rs`, `fixtures/parity/*` (regenerated).
    - Follow design "Pattern families", "Feud first crossing", "Salience" and the `run` steps in "sim-core: narrator/ module".
    - The five families in the order `family_death`, `inheritance`, `debt_due`, `feud`, `life_stage`, with the option tables, Stakes and priors exactly as the design table gives them. Life_Stage ages 2,190, 4,380, 5,840 with the three option rows.
    - Effects go through `social::apply_social`, the shared `economy::repay` seam, and the death module's forgive path. No option creates money (R2.5). Task 1.1 defines `EffectPart::Repay` and its `check` contract only; task 2.1 owns the real `economy::repay` execution and extraction from `process_repayments`. Task 1.1 must not add a temporary local repayment path.
    - Rules_Default: `score(o) = 10 × prior(o) + noise(o)` with `noise` drawn from `StreamTag::Narrator` in −5..=5, computed once at 13a and stored (R1.8).
    - Salience from the design formula with `min_salience = 30`. The Intro_Debt priority of R5.16 is wired here but does nothing until task 3 designates the Debt.
    - The feud crossing buffer: `social::move_relation` records a `Crossing` from the before and after values it sees; 13a reads it and clears it. The buffer is not encoded, and `Checksum::of` asserts it is empty at a boundary.
    - Property tests: Property 1 (lifecycle invariants), Property 2 (the applied option, covering a first node resolved by an accepted choice and one resolved by its Rules_Default), Property 5 (candidate shape), Property 6 (order and selection), Property 7 (salience), Property 8 (the Narrator stays inside its scope), Property 9 (life stage), Property 20 (feud crossings). Each tagged `// Feature: first-playable, Property N: <title>` with at least 100 cases.
    - Example tests: one constructed trigger per family, including a feud that crosses, stays below, and re-arms after returning to the threshold.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
    - Acceptance: fixture acceptance. Commit `feat(sim-core): add the narrator patterns and the interrupt budget` with the regeneration line.

- [ ] 3. Intro_Debt and Intro_Grace
  - [ ] 3.1 Designate the Intro_Debt and protect it
    - Files: `crates/sim-core/src/intro.rs` (new), `crates/sim-core/src/lib.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/opening.rs`, `crates/sim-core/src/testing.rs`, `crates/sim-core/src/economy.rs`, `crates/sim-core/src/narrator/patterns.rs`, `crates/sim-core/src/tick.rs`, `crates/sim-core/src/canon.rs`, `crates/sim-core/tests/narrator.rs`, `fixtures/parity/*` (regenerated).
    - Follow design "Opening" and "Intro_Debt and Intro_Grace". All exhaustive World literals/destructures, test-support mutations and Canon encoding are updated in this task.
    - `intro_debt: IntroDebt` is encoded after `debts`; `CANON_VERSION` advances 4→5 at this boundary. `Undesignated` is only the opening-construction value before step 9c and is never observed at a tick boundary, Checksum, replay, Snapshot or fixture. The first completed World is `Grace` or `Ended`; task-owned tests assert this and own C1's Property 19 evidence.
    - `IntroDebt` has `Undesignated`, `Grace { loan, body }`, and `Ended { loan }`; only opening writes `Grace`, only `intro::update` writes `Ended`, and no path writes `Undesignated` after construction. Step 9c designates the Debt; step 10 and Narrator priority use the state exactly as specified.
    - `opening.rs` step 9 chooses the body by the three-tier rule and step 9b adds one real `loan` at tick 0 when required; step 9c sets `Grace { loan, body }` once. The design's replay/Checksum boundary excludes the temporary `Undesignated` value.
    - Tests: Property 10 and Property 19, including designation on seeds 0..=999, each Grace end cause, open transfer with ongoing life, and the report-only loss count over seeds 0..=199.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16_
    - Acceptance: fixture acceptance for Canon v5. C1 first-stop/Grace evidence is collected here, not in task 1.1. Commit `feat(sim-core): add the intro debt and its grace` with the regeneration line.
- [ ] 4. Rebuilt_Body Customization and Path_Status
  - [ ] 4.1 Add Customization, the Rebuilt_Draw and Path_Status
    - Files: `crates/sim-core/src/underworld/customization.rs` (new), `crates/sim-core/src/underworld/slots.rs`, `crates/sim-core/src/underworld/player.rs`, `crates/sim-core/src/outsiders.rs`, `crates/sim-core/src/input.rs`, `crates/sim-core/src/replay.rs`, `crates/sim-core/src/world.rs`, `crates/sim-core/src/testing.rs`, `crates/sim-core/src/canon.rs`, `crates/sim-core/src/rng.rs`, `crates/sim-cli/src/auto_player.rs`, `crates/sim-core/tests/replay.rs`, `fixtures/parity/*` (regenerated).
    - Follow design "Customization and Base_Traits" and "Path_Status". `PlayerWait.rebuilt_draw` is the Canon boundary of this task: `CANON_VERSION` advances 5→6 and all exhaustive World construction/destruction and test-support mutation sites are updated here.
    - `InputPayload::ClaimSlot` gains `customization: Option<Customization>`, and `ReplayPayload::ClaimSlot` gains the matching optional DTO with `skip_serializing_if = Option::is_none`; this task keeps replay v4. `RejectReason` gains `BadCustomization` (tag 21) and `CustomizationNotAllowed` (tag 22).
    - `PlayerWait` gains `rebuilt_draw: Traits`, drawn once in `start_wait` from `StreamTag::RebuiltDraw` and never rewritten (R6.2). `claim_standing` applies `customize(base_traits(carry), c)` and skips the later `carry_over::apply`.
    - `slots::claim` splits into `check_claim` and `apply_claim`. `path_status` runs the same checks and sorts the reasons into `announced`, `claimable`, `affordable` and `needed` (R7.7). The Devoted Auto_Player sends `Set { piety, 3 }` with every Rebuilt_Body claim.
    - Tests own Properties 11–14, including DTO round-trips, Set/Adjust, Carry_Over overlap, stable draw and Path_Status prediction. Acceptance is fixture acceptance for Canon v6 plus the Devoted reachability gate.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 7.7_
    - Commit `feat(sim-core): add rebuilt body customization` with the regeneration line.
  - **STOP (checkpoint C1).** Report: the five Acceptance_Seeds run past offset 900 with the first stop offset and family of each, where an offset of 900 fails the band (checkpoint C1 above); the seeds 0..=199 loss count from task 3; the Devoted gate result. Do not start task 5 until the Author has seen it.

- [ ] 5. Snapshot, stops and checked submission
  - [ ] 5.1 Extend the Snapshot and return stops from the step
    - Files: `crates/sim-core/src/snapshot.rs`, `crates/sim-core/src/stops.rs` (new), `crates/sim-core/src/tick.rs`, `crates/sim-wasm/src/lib.rs`, `crates/sim-wasm/tests/parity.rs`.
    - Follow design "Stops and checked submission", "sim-wasm" and "Snapshot additions". This task provides the native/WASM API consumed by tasks 7.1 and 8.1: `StopSet`, `last_stops`, `run_until_stop`, `try_submit_all`, `submit_checked`, `checksums`, extended `snapshot`, and their exact JSON/reply shapes.
    - `StopSet` preserves all simultaneous reasons, resets after each stepped tick, stops on the stop tick itself, and never runs a tick after a stop. `run_until_stop` resolves unanswered nodes by the core default contract; it has no Worker gate. Snapshot and stop reads change no Checksum.
    - Tests own Properties 15 and 16, including native/WASM byte parity, multi-reason stops, stop reset, all-or-nothing submission, and no extra tick after a stop.
    - _Requirements: 7.1–7.8, 8.3, 8.4, 8.8_
    - Acceptance: Rust gates, wasm32 parity, and R15.6. A checksum change regenerates fixtures in this task; it is not deferred.

- [ ] 6. Replay format 5 and the fixture migration
  - [ ] 6.1 Raise the replay version and migrate every fixture
    - Files: `crates/sim-core/src/replay.rs`, `crates/sim-core/src/input.rs`, `crates/sim-core/tests/replay.rs`, `crates/sim-cli/src/auto_player.rs`, `crates/sim-cli/src/batch.rs`, `crates/sim-cli/src/commands.rs`, `fixtures/parity/*` (regenerated), `fixtures/parity/README.md`, `README.md`.
    - Consume the staged DTOs from tasks 1.1 and 4.1; do not redefine their arms. This is the only `REPLAY_VERSION` boundary: raise 4→5, reject versions 2, 3 and 4, migrate all fixtures and update baseline/target documentation. `customization` is omitted when `None`, and decode/encode is byte-identical.
    - Tests own Property 17: round trip, version rejection, and a replay resolving a first Player_Node by Rules_Default. One example rejects a version 4 file.
    - _Requirements: 15.2, 15.3, 15.4_
    - Acceptance: fixture migration and wasm32 parity. Commit `feat: raise the replay format to version 5` with the regeneration line.
  - **STOP (checkpoint C2).** Report: the parity result, and the tick and source of the Rules_Default resolution in the replay stream. Do not start task 7 until the Author has seen it.

- [ ] 7. Clock-paced play
  - [ ] 7.1 Replace ticks-per-frame with the pacer
    - Files: `web/src/shared/protocol.ts`, `web/src/shared/world-snapshot.ts` (new), `web/src/shared/speeds.ts`, `web/src/worker/pacer.ts` (new), `web/src/worker/controller.ts`, `web/src/worker/sim.worker.ts`, `web/tests/unit/pacer.test.ts` (new), `web/tests/unit/controller-*.test.ts`.
    - Consume task 5's `SimHandle` methods and define the protocol's discriminated request/reply/status types, `PauseReason`, World Snapshot and stop payload before wiring controller calls. `PLAY_RATE = 30`; Speed is a multiplier; the clock passes only tick counts, never clock/random values to WASM.
    - On each Frame run the bounded pacer through `run_until_stop`; re-anchor after more than one second of backlog. A stop posts exactly one unthrottled status with all reasons, tick, checksum and Snapshot; no tick follows the stop.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.11_
    - Acceptance: `pnpm --dir web run typecheck` and web unit tests pass; the protocol, controller and worker status types compile and Property 21 passes. Rust gates are unchanged. Commit `feat(web): pace the simulation by wall time`.

- [ ] 8. The interactive advancement gate
  - [ ] 8.1 Refuse to advance an unanswered Player_Node
    - Files: `crates/sim-core/src/tick.rs`, `crates/sim-wasm/src/lib.rs`, `web/src/shared/protocol.ts`, `web/src/worker/controller.ts`, `web/src/worker/sim.worker.ts`, `web/src/App.svelte`, `web/tests/unit/controller-stops.test.ts` (new).
    - Consume task 5's `player_node_state`, `submit_checked`, `run_until_stop` and task 7's protocol. Implement `choose`, `choose-and-run`, `world-snapshot`, `dream`, `claim`, `checksums`, and `player_node_state` with exactly one reply each; replace-world cancellation/stale callback handling is part of this task.
    - The gate is Worker-only: unanswered `run`/`step` returns `node_unanswered` without advancing; accepted choice permits exactly tick t+1; rejected choice leaves it unanswered. Core, CLI and replay keep the default-resolution contract.
    - Tests own Property 22 and cover no partial advance, rejected choice, choose-and-run and World reset.
    - _Requirements: 8.6, 8.7, 8.9_
    - Acceptance: web typecheck and unit tests pass; Rust gates and R15.6 pass. Commit `feat(web): refuse to advance an unanswered player node`.

- [ ] 9. Town_View, identity and the Choice and Chronicle panels
  - [ ] 9.1 Draw the town and show who the choice affects
    - Files: `web/src/main/view-model.ts` (new), `web/src/main/town-layout.ts` (new), `web/src/main/templates.ts` (new), `web/src/art/sprites.ts` (new), `web/src/ui/TownView.svelte` (new), `web/src/ui/IdentityPanel.svelte` (new), `web/src/ui/ChoicePanel.svelte` (new), `web/src/ui/ChroniclePanel.svelte` (new), `web/src/App.svelte`, `web/tests/unit/town-layout.test.ts` (new), `web/tests/unit/view-model.test.ts` (new), `web/tests/unit/templates.test.ts` (new).
    - Follow design "Layout at 1280×720", "Town_View", "Sprite interface" and "Scenes".
    - The Town_View draws one marker per living Resident at positions from Household and Person IDs only, through the placeholder `SpriteSet` (R9.1, R12.1). The Soul_Marker is one glyph and one colour used nowhere else (R9.3).
    - The identity panel shows the name, the age in whole years and the Origin, and the two tie lists labelled "Blood ties" and "Past-life ties" (R9.4, R9.5). The Choice_Panel shows Stakes and every Option_Preview exactly as the Snapshot gives them (R9.6, R9.7). The Chronicle_Panel lists entries newest first, with the fixed empty-state line (R10.7, R10.8).
    - The three-column layout puts the Soul_Marker, the current name, the Rememberer count, the Stakes and every Option_Preview in view at 1280×720 without scrolling (R9.8). The tie lists and the Chronicle scroll.
    - Tests: Property 23 (layout), Property 24 (displayed values), Property 26 (template text). All read the reducer state only and compute no outcome.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.3, 10.6, 10.7, 10.8, 12.1_
    - Acceptance: web typecheck and unit tests pass. Commit `feat(web): add the town view and the choice and chronicle panels`.

- [ ] 10. Scenes and the Underworld_Panel
  - [ ] 10.1 Stage the four scenes and the rebirth panel
    - Files: `web/src/main/scene-queue.ts` (new), `web/src/main/customization.ts` (new), `web/src/ui/scenes/Funeral.svelte` (new), `web/src/ui/scenes/Inheritance.svelte` (new), `web/src/ui/scenes/Dream.svelte` (new), `web/src/ui/scenes/Birth.svelte` (new), `web/src/ui/UnderworldPanel.svelte` (new), `web/src/App.svelte`, `web/tests/unit/scene-queue.test.ts` (new), `web/tests/unit/underworld-controls.test.ts` (new), `web/tests/unit/customization.test.ts` (new).
    - Follow design "Scenes" and "Underworld_Panel".
    - Exactly four Scene_Templates: `funeral`, `inheritance`, `dream`, `birth` (R10.1). `sceneQueue` orders one stop as funeral (own death), dream, birth, then the pending node's scene or the Choice_Panel (R10.9). No scene sends `run` or `step` (R10.10).
    - The Underworld_Panel shows the Joss_Balance, the dream price, the Connected_Persons, one row per slot with its Path_Status and Needed lines, the Carry_Over choice, and the Customization form on the Rebuilt_Body row only (R11.1, R11.3, R11.5). Claim controls are enabled only for an Executable_Path, and the Rebuilt_Body one also needs a complete form (R11.4). The dream control is disabled, with the reason, when the balance is below the price or nobody is connected (R11.10). No haunting control and no Bribe control (R11.8).
    - The Customization preview reads Base_Traits from the Snapshot and shows the base value, the customized value, the price and the override line (R11.6, R11.7). Cancelling sends nothing.
    - Tests: Property 25 (scene order), Property 27 (which controls are enabled), Property 28 (the preview matches the Rust `customize`, against shared golden vectors).
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.9, 10.10, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12_
    - Acceptance: web typecheck and unit tests pass. Commit `feat(web): add the scenes and the underworld panel`.

- [ ] 11. Art trial
  - [ ] 11.1 Show the Kenney pack on one screen and stop for the decision
    - Files: `docs/kiro-log.md` only. No pack file is added to the repository.
    - Follow design "Art_Trial".
    - Download the Kenney 1-Bit Pack outside the repository. Open the license file inside the download before anything else. Record its name and whether it permits use, modification and redistribution in a public web build without payment (R12.2). If it does not, or there is no license file, add nothing and record that (R12.5).
    - Render one representative screen in a scratch build: a Town_View with Households and Residents, the graveyard, the funeral scene with its props, and the state glyphs including the Soul_Marker. Record the coverage, the legibility at 1280×720 and a screenshot path (R12.3).
    - _Requirements: 12.2, 12.3, 12.4, 12.5_
    - Acceptance: one log entry `### Spec: first-playable — art trial (<date>)` with the license finding, the coverage and the screenshot path. No commit of any pack file. **STOP (checkpoint C4).** The Author decides adopt, adopt plus drawn gaps, or change (R12.4). If the decision is late, the slice keeps the placeholder sprites and this task closes on the log entry.

- [ ] 12. Batch metrics and the first-stop gate
  - [ ] 12.1 Report the narrator, the paths and the kin decay, and gate the first stop
    - Files: `crates/sim-cli/src/batch.rs`, `crates/sim-cli/src/auto_player.rs`, `crates/sim-core/src/invariants.rs`, `scripts/gates.sh`, `docs/kiro-log.md`.
    - Follow design "sim-cli" and "Batch report additions".
    - The `batch` report gains, per seed, the per-life narrator line, the `intro` line, the per-death Path_Status line, the kin decay lines and the Customization line, in the fixed text of the design block, so two runs with the same arguments are byte-identical (R13.1, R13.2, R13.3, R14.1, R14.2, R14.3).
    - `first_stop_band` joins the hard targets of the passive acceptance batch (R13.5). A failure names the seed, the offset, the band and the cause, and a transfer is not reported as closure (R13.7). The other new figures are report-only (R13.6, R14.4).
    - New invariants `N1` to `N6` in `invariants.rs`, run from `InvariantChecker::after_tick` (R13.8). A failure names the seed, the tick and the criterion (R13.9).
    - `PlayerAnswerer` answers a pending node by the largest kin affinity gain toward the body, ties to the Rules_Default and then the lowest option ID (R13.13). `--playthrough` runs the Playthrough_Branch. It is report-only and is added to `scripts/gates.sh` after the Devoted step.
    - The kin figures are computed by an accumulator that never writes World state, so a run's Checksums are identical with and without it (R14.5).
    - Tests: Property 18 (the kin figures). One unit test per invariant builds a violating World and sees its named criterion (the C1 half of R13.10).
    - _Requirements: 6.11, 8.10, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_
    - Acceptance: Rust gates pass; `scripts/gates.sh` exits 0 with the new batch in it. The log entry records the Playthrough_Branch wall time, the change in total gate time against the 377 s baseline, and the pooled kin figures beside the underworld H1 baseline with the sampling difference stated (R13.4, R14.6). Commit `feat(sim-cli): report the narrator and gate the first stop`.

- [ ] 13. The Playthrough_Fixture
  - [ ] 13.1 Search for the seed and record the fixture
    - Files: `crates/sim-cli/src/commands.rs`, `fixtures/parity/seedP-playthrough.replay.json` (new), `fixtures/parity/seedP-playthrough.stages.json` (new), `crates/sim-wasm/tests/parity.rs`, `docs/kiro-log.md`.
    - Follow design "Fixture seed search" and "Fixtures and parity".
    - `playthrough-search --seeds 1..=5000 --max-ticks 8000` runs the fixture script in ascending seed order with `Params::DEFAULT` and no balance edit, and lists the qualifying seeds (R15.8). The first is frozen into the fixture. The command and its full output go into the log.
    - The fixture's input stream holds only `ChoosePlayer`, `Dream`, `CarryOver` and `ClaimSlot`, with at least two applied Player_Node choices, one applied dream and one applied Imported_Vessel claim, and its last tick is at least one tick after the second body begins (R15.5).
    - If no seed qualifies, log the result and use `--step-fallback` (R15.9). The stage file then records the Step-click count, and no new Pause_Reason is added.
    - The parity test asserts native equals WASM on every tick of the fixture and names which of the four required parts is missing (R15.7). The Snapshot parity test adds the Snapshot at each stage tick.
    - _Requirements: 15.5, 15.7, 15.8, 15.9_
    - Acceptance: the wasm32 parity test passes on the new fixture; the log holds the search output. Commit `test: add the playthrough parity fixture`.

- [ ] 14. The playthrough Smoke_Test
  - [ ] 14.1 Play the fixture through the page
    - Files: `web/tests/smoke/playthrough.spec.ts` (new), `web/playwright.config.ts`, `docs/kiro-log.md`.
    - Follow design "Playthrough Smoke_Test" and "Smoke time bound".
    - The test plays the fixture's seed through the real controls: Speed 1 to the first stop, then Speed 365 and Run between stops, submitting each input by clicking or filling controls (R16.1, R16.2, R16.3). At the first `player_node` stop it sends one `run` through the Worker request path and asserts `node_unanswered` and that the tick did not advance (R8.9). It submits no input through the harness.
    - At each stage it asserts the Pause_Reason, the tick, the visible Soul_Marker and name, the two tie lists and, at a node, every Option_Preview (R16.4, R16.5). At the end it compares every worker Checksum from tick 1 to the fixture's last tick (R16.6).
    - The test timeout is `B` computed from the stage file, and `globalTimeout` becomes 170 s plus `B` (R16.8). The log records the measured wall time of the Speed 1 stage beside the 20 to 30 s target and `first_interrupt_min = 600` (R16.11). A time outside that range is reported to the Author rather than patched.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.11_
    - Acceptance: the Smoke_Test passes, and `scripts/gates.sh` exits 0. Commit `test(web): add the playthrough smoke test`.

- [ ] 15. Fault injections, the comparison document and steering
  - [ ] 15.1 Inject each new gate's fault once, write the comparison, update steering
    - Files: `docs/kiro-log.md`, `docs/rebuilt-body-comparison.md` (new), `.kiro/steering/structure.md`, `README.md`, `web/scripts/check-deploy.ts`, `web/assets/ASSETS.json` (new, empty list).
    - Follow design "Fault injections for new gates", "Comparison document" and "Asset gate".
    - For each row of the fault-injection table: inject the fault, run the gate, record the failing output, revert, run the gate again and record the pass. The advancement-gate row removes the controller's unanswered check and sends `run` through the Worker request path; it does not check the disabled button. After that revert, the Smoke_Test, the native and WASM parity tests and the fixture pass unchanged (R16.10).
    - `docs/rebuilt-body-comparison.md` from one seed of the Devoted batch that reaches a Rebuilt_Body-affordable wait, with the two branches, the shared Checksum at the claim tick, and no claim of overall superiority (R6.10).
    - `structure.md` gains the `narrator/` row and the spec 6 status line. `check-deploy.ts` gains the media-file check against `web/assets/ASSETS.json`; with placeholders the list is empty and the check passes (R12.7).
    - _Requirements: 6.10, 12.6, 12.7, 12.8, 12.9, 13.10, 16.9, 16.10_
    - Acceptance: every injection is logged with its failure and its revert; `scripts/gates.sh` exits 0 at the end. One commit `docs: record the first-playable gate injections and the rebuilt body comparison`.

- [ ] 16. Final check and audit
  - [ ] 16.1 Confirm the gates and hand over
    - Files: `docs/kiro-log.md` only.
    - Run `scripts/gates.sh` from a clean build and record the wall time against the 377 s baseline, the `first_stop_band` line, the Playthrough_Branch time and the Speed 1 first-stop measurement (R16.9, R13.4, R16.11).
    - Confirm the R15.6 check exits 0 and that no file under `crates/sim-core/src/llm/` or the System One template changed.
    - _Requirements: 15.6, 16.9_
    - Acceptance: one log entry `### Spec: first-playable — final check (<date>)` with the commands and the figures. **STOP.** Report the commit history and the figures to OMP for the audit. Do not push.

## Notes

- No task is marked optional. The property tests carry the semantic guarantees, and the audit depends on them.
- There is no red window. Tasks 1 to 4 and task 6 change the canonical encoding or the tick and regenerate the fixtures in their own commit. Task 5 is not expected to change a Checksum; if it does, it regenerates too.
- The interactive gate is task 8 and nowhere else. Tasks 1 to 7 leave the core resolving an unanswered node by R1.4, which is correct for them: the gate is a Worker rule, and `sim-cli` and the replay path never grow one.
- The Art_Trial (task 11) is the one task that blocks on the Author by design. Every other STOP is a review, and the Author can wave the work on.
- Design sections are cited by their headings in `.kiro/specs/first-playable/design.md`.

## Task Dependency Graph

The serial waves remain the execution order; the explicit interface edges below prevent an executing agent from guessing cross-task contracts:

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] }, { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1"] }, { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["5.1"] }, { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["7.1"] }, { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["9.1"] }, { "id": 9, "tasks": ["10.1"] },
    { "id": 10, "tasks": ["11.1"] }, { "id": 11, "tasks": ["12.1"] },
    { "id": 12, "tasks": ["13.1"] }, { "id": 13, "tasks": ["14.1"] },
    { "id": 14, "tasks": ["15.1"] }, { "id": 15, "tasks": ["16.1"] }
  ],
  "edges": [
    { "from": "1.1", "to": "2.1", "provides": "Narrator/Chronicle/PlayerOption and ChoosePlayer DTO" },
    { "from": "1.1", "to": "6.1", "provides": "ReplayPayload.ChoosePlayer; do not redefine" },
    { "from": "2.1", "to": "3.1", "provides": "patterns consumed by IntroDebt priority" },
    { "from": "3.1", "to": "4.1", "provides": "IntroDebt and Canon v5" },
    { "from": "4.1", "to": "6.1", "provides": "ClaimSlot Customization DTO; version-only closure" },
    { "from": "5.1", "to": "7.1", "provides": "StopSet/run_until_stop/submit_checked/checksums SimHandle" },
    { "from": "5.1", "to": "8.1", "provides": "player_node_state and checked submission" },
    { "from": "7.1", "to": "8.1", "provides": "protocol, pacer and worker status types" },
    { "from": "12.1", "to": "13.1", "provides": "batch strategy and playthrough search" },
    { "from": "13.1", "to": "14.1", "provides": "frozen replay/stage fixture" },
    { "from": "8.1", "to": "14.1", "provides": "interactive Worker gate" },
    { "from": "11.1", "to": "12.1", "provides": "C4 decision; proof phase remains blocked until recorded" }
  ]
}
```
