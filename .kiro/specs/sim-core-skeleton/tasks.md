# Tasks: sim-core-skeleton

Each task ends with the gates green (`scripts/gates.sh` once it exists) and one local conventional commit. Fault injections are run, shown to fail, reverted, and logged in `docs/kiro-log.md` in the same task. Nothing is pushed.

Execution notes for the orchestrator:
- Tasks run strictly one at a time, in numeric order (see "Task Dependency Graph" at the end). They edit the same files (`Cargo.toml`, `scripts/gates.sh`, `README.md`, `docs/kiro-log.md`), so they must not run in parallel.
- Delegate each task to the `spec-task-execution` sub-agent if it exists in the registry. In this setup it has been rejected with "not found in registry"; in that case delegate to `general-task-execution` with the full task text, and read `requirements.md`, `design.md` and `.kiro/steering/*.md` first.
- Task 11 ended with the author's decision on tick granularity: 1 day per tick, recorded in `tech.md`. Task 12 applies it to the code; task 13 is the final check.

- [x] 1. Workspace scaffold
  - Root `Cargo.toml`: workspace with `crates/sim-core`, `crates/sim-wasm`, `crates/sim-cli`; resolver 3; edition 2024; shared `[workspace.lints]`.
  - Empty crates that build: `sim-core` (lib, `#![forbid(unsafe_code)]`), `sim-wasm` (`cdylib` + `rlib`), `sim-cli` (bin).
  - `.cargo/config.toml`: `runner = "wasm-bindgen-test-runner"` for `wasm32-unknown-unknown`.
  - `scripts/gates.sh`: `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo clippy -p sim-core -p sim-wasm --target wasm32-unknown-unknown -- -D warnings`; `cargo test --workspace`. Later tasks extend it.
  - Update `structure.md` planned layout with `fixtures/`, `scripts/`, `rust-toolchain.toml`, `mise.toml` (steering change, logged).
  - Commit `rust-toolchain.toml` and `mise.toml` (installed earlier) with the scaffold.
  - _Requirements: R1.1, R1.2, R1.3_

- [x] 2. Determinism guards for sim-core
  - `crates/sim-core/clippy.toml`: `disallowed-types` (`f32`, `f64`, `HashMap`, `HashSet`, `Instant`, `SystemTime`) and `disallowed-methods` (`Instant::now`, `SystemTime::now`, `thread::spawn`, `env::var`, `env::vars`).
  - Deny in sim-core: `clippy::float_arithmetic`, `clippy::arithmetic_side_effects`, `clippy::cast_possible_truncation`.
  - `tests/source_guard.rs`: comment-stripped scan of `sim-core/src` for float literals and banned names.
  - `gates.sh`: fail if `cargo tree -p sim-core -e normal` lists `rand` or `getrandom`.
  - Fault injections 1 (HashMap field), 2 (float literal under `#[allow]`), 5 (`rand` dependency): show each gate fails, revert, log.
  - _Requirements: R8.1, R8.2, R2.3_

- [x] 3. IDs and counter-based random streams
  - `ids.rs`: `Tick`, `EntityId`, `InputSeq`, `IdCounter` with checked increment and `IdExhausted`.
  - `rng.rs`: `StreamTag` with fixed values, `draw`, `below`, `in_range`; bias bound documented.
  - Unit tests: pinned outputs for a few fixed inputs; `in_range` stays inside bounds at the extremes; changing any one of the five `draw` inputs changes the output for sample values.
  - _Requirements: R2.4, R3.1, R3.2, R3.3_

- [x] 4. Canonical encoding and checksum
  - Add `blake3` 1.8.7 (`default-features = false`, `pure`); verify license on crates.io; list it in `README.md`.
  - `canon.rs`: `Canon`, `CanonWriter`, impls for integers, `bool`, `Option`, `Vec`, `BTreeMap`; `u32` lengths via checked conversion; `CANON_VERSION`.
  - `checksum.rs`: `Checksum(u64)` from the first 8 bytes of BLAKE3, hex display and parse.
  - Unit tests: encoded bytes for sample values match hand-written expectations; BLAKE3 matches an official test vector (empty input).
  - _Requirements: R5.1, R5.2, R1.4_

- [x] 5. World, input stream and tick loop
  - `world.rs`: `WorldConfig` (validated), `Workload`, `Entity`, `World`, `Rejections`, `RejectReason`, `check_invariants`; `Canon` impls with exhaustive destructuring.
  - `input.rs`: `TickInput`, `InputPayload`, `InputStream::submit` (rejects past ticks, assigns `seq`), `for_tick`.
  - `tick.rs`: the five steps in fixed order, documented as the module doc.
  - `Sim` driver: `new`, `submit`, `step`.
  - Unit tests: past-tick submission rejected with state unchanged; each invalid input kind is skipped and counted; despawn removes inbound affinity; same-tick inputs apply in `seq` order.
  - _Requirements: R2.1, R2.2, R2.5, R2.6, R4.1, R4.2, R4.3, R4.4, R5.3_

- [x] 6. Replay file and replay check
  - Add `serde` and `serde_json` (check versions and licenses; list in `README.md`).
  - `replay.rs`: `ReplayFile` JSON with `u64` as decimal strings, format and version checks, `record`, `verify` returning the first `Divergence`.
  - `tests/replay.rs`: record and verify in-process for fixed seeds; a tampered checksum is reported at the right tick; wrong checksum count and unknown version are rejected.
  - Fault injection 3 (HashMap iteration in the drift step): show the replay test fails, revert, log.
  - _Requirements: R4.5, R6.2, R6.4_

- [x] 7. Property-based tests
  - Add `proptest` 1.12.0 as a dev-dependency; list in `README.md`.
  - Test-only mutation API behind `#[cfg(any(test, feature = "test-support"))]`.
  - `tests/properties.rs`: P1–P7 as specified in the design.
  - _Requirements: R9.1–R9.7, R5.4_

- [x] 8. sim-cli and parity fixtures
  - `record`, `replay`, `check-size` subcommands with hand-parsed arguments and the documented exit codes.
  - Generate `fixtures/parity/` (two seeds × `days_per_tick` 1 and 7, `Pairwise`, 2,000 ticks, random inputs including invalid ones).
  - `sim-core/tests/replay.rs` also verifies every fixture.
  - Manual check: `sim-cli replay` on a hand-edited fixture exits 1 and names the tick.
  - _Requirements: R6.1, R6.2, R6.3_

- [x] 9. sim-wasm bindings and native-vs-WASM parity
  - Add `wasm-bindgen` `=0.2.130` and `wasm-bindgen-test` (check version; list both in `README.md`).
  - `WasmSim` and `verify_replay` as in the design.
  - `tests/parity.rs`: verify every fixture under `wasm-bindgen-test` in Node.
  - `scripts/wasm-build.sh`: release build, `wasm-bindgen --target web`, `sim-cli check-size` at 25 MiB.
  - `gates.sh`: add `cargo test -p sim-wasm --target wasm32-unknown-unknown` and `wasm-build.sh`.
  - Fault injection 4 (`usize` length encoding): show native tests pass and the WASM parity test fails, revert, log.
  - _Requirements: R7.1, R7.2, R7.3_

- [x] 10. Kiro hooks (only after task 9 is done)
  - `sim-cli batch`: seed range, ticks, generated random inputs; invariant check after every tick; in-memory record and verify; per-seed line and summary as in the design; exit 1 on violation or divergence.
  - `scripts/hook-replay.sh` and `scripts/hook-seed-batch.sh`.
  - `.kiro/hooks/replay-on-save.json`: `PostFileSave`, matcher `crates/sim-core/.*\.rs$`, runs `scripts/hook-replay.sh`.
  - `.kiro/hooks/seed-batch-after-task.json`: `PostTaskExec`, runs `scripts/hook-seed-batch.sh`.
  - Confirm the three open hook behaviors listed in the design (agent-only file triggers, where failure output lands, whether `PostTaskExec` fires for this workflow). If a hook cannot report to the agent as designed, stop and give the author options.
  - Fault injection for `replay-on-save`: save a sim-core file with a `HashMap` iteration in the drift step; show the hook reports the divergence; revert; log.
  - Fault injection for `seed-batch-after-task`: break the drift clamp so values leave `0..=1000`; show the hook reports the invariant violation; revert; log.
  - From here on, every real hook catch is logged in `docs/kiro-log.md` when it happens.
  - _Requirements: R11.1, R11.2, R11.3, R11.4_

- [x] 11. Tick granularity measurement
  - `sim-cli measure`: native ticks per second, lifetime wall time, checksum time per tick; best of 5; release build.
  - `bench` feature in sim-wasm with `bench_checksum`; `scripts/measure-wasm.mjs` with the same three numbers.
  - Write `docs/tick-granularity.md`: numbers, machine and tool versions, design comparison.
  - **Stop for the author's choice**, then record it in `tech.md` (steering change, logged).
  - _Requirements: R10.1, R10.2, R10.3_

- [-] 12. Apply the tick granularity decision (daily ticks)
  - Context: the author chose 1 day per tick (`docs/tick-granularity.md` section 5, `tech.md`). The weekly option is removed from the code. `docs/tick-granularity.md` stays as the record of the measurement and is only annotated, not rewritten.
  - sim-core: remove `days_per_tick` from `WorldConfig` (field, validation, `ConfigError::InvalidDaysPerTick`, `Default`, `try_new`, `Canon` encoding). Drift becomes a plain +-10 per tick. Remove `Mutation::ConfigDaysPerTick` from the test API; update unit tests and the property generators (they no longer choose a granularity).
  - Replay format: drop `days_per_tick` from `ReplayConfig` and bump `REPLAY_VERSION` to 2, since the format changes; version 1 files must be rejected by the existing unsupported-version error. Update the format docs in `replay.rs`, tests, and the JSON examples and help text in sim-cli and sim-wasm.
  - Fixtures: regenerate them (an intentional change; say so in the commit message). Remove the two `d7` fixtures and `fixtures/configs/pairwise-d7.json`, drop `d1` from the remaining names (for example `seed1-pairwise`, `seedbig-pairwise`) and add a third seed so parity coverage does not shrink. Update `fixtures/parity/README.md`, `scripts/regen-fixtures.sh`, and the native and WASM parity tests, which assert the exact file names.
  - Tooling: `sim-cli measure` and `scripts/measure-wasm.mjs` stay as a performance benchmark of the single granularity (daily lifetime of 29,200 ticks only; drop the weekly column). Update `batch`, `record` and `--config` examples.
  - Docs: update `README.md` where it mentions the old options; add one dated note at the top of `docs/tick-granularity.md` saying weekly tick support was removed in this task and the numbers reproduce at commit `bac46e3`.
  - Do not change the canonical encoding rules, the hash, or anything not listed. All gates pass. Record in `docs/kiro-log.md` what the `replay-on-save` hook did while sim-core files were being edited, and where (if anywhere) its output appeared.
  - _Requirements: R2.1, R6.2, R7.2, R10.3_

- [~] 13. Final check
  - Run `scripts/gates.sh` from a clean `target/`.
  - Sync the spec documents with what was built, without rewriting history: `design.md` (the checksum builds the canonical encoding into a buffer and then hashes it, not a stream into the hasher (D4); P4 became P4a and P4b; `bench_checksum` returns a hex string and uses a wrapping sum as its sink; the input and config JSON shapes; the sim-cli flags; replay format version 2 without `days_per_tick`; the observed hook behavior) and `requirements.md` (R2 and R10 mention two granularities: record the decision and keep R10 as the measurement that led to it).
  - Correct `docs/tick-granularity.md` section 3: the 36,879-byte state is 3,540 affinity entries x 10 bytes (8-byte id + 2-byte value) = 35,400, plus 60 entities x 24 bytes = 1,440, plus 39 bytes of header and rejections; the sentence that says "60 entities x 59 affinities x 2 bytes" is wrong.
  - Re-read requirements R1–R11 and confirm each criterion against the code and test output; note any gap.
  - Update `README.md` (build and test instructions, third-party list) and `structure.md` "Next steps".
  - _Requirements: all_

## Task Dependency Graph

Every task depends on the files the previous task left in place (shared `Cargo.toml`, `scripts/gates.sh`, README, kiro-log), so each is its own wave. No parallel execution.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1. Workspace scaffold"] },
    { "id": 1, "tasks": ["2. Determinism guards for sim-core"] },
    { "id": 2, "tasks": ["3. IDs and counter-based random streams"] },
    { "id": 3, "tasks": ["4. Canonical encoding and checksum"] },
    { "id": 4, "tasks": ["5. World, input stream and tick loop"] },
    { "id": 5, "tasks": ["6. Replay file and replay check"] },
    { "id": 6, "tasks": ["7. Property-based tests"] },
    { "id": 7, "tasks": ["8. sim-cli and parity fixtures"] },
    { "id": 8, "tasks": ["9. sim-wasm bindings and native-vs-WASM parity"] },
    { "id": 9, "tasks": ["10. Kiro hooks (only after task 9 is done)"] },
    { "id": 10, "tasks": ["11. Tick granularity measurement"] },
    { "id": 11, "tasks": ["12. Apply the tick granularity decision (daily ticks)"] },
    { "id": 12, "tasks": ["13. Final check"] }
  ]
}
```
