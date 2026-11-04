# Requirements: sim-core-skeleton

## Introduction

This spec builds the deterministic foundation that every later feature runs on: a Rust workspace, a tick loop, the `TickInput` stream, a per-tick checksum, a record-and-replay check, a native-vs-WASM checksum test, and a quick measurement that informs the tick granularity decision (1 day vs 1 week).

The world in this spec holds placeholder content only (anonymous entities with integer state and PRNG-driven changes). Its job is to exercise every determinism rule in `tech.md`, not to simulate town life.

## Glossary

- **World**: the complete simulation state for one seed.
- **Tick**: one step of the simulation. Time inside the simulation is the tick counter only.
- **TickInput**: one external input (player choice, later LLM result) tagged with the tick it applies on.
- **Input stream**: the ordered list of all `TickInput`s for a run.
- **Checksum**: a hash over the canonical serialization of the World after a tick.
- **Replay file**: seed, world config, input stream, and the recorded per-tick checksums of one run.
- **Derived state**: caches and indexes that can be rebuilt from the World; excluded from the checksum.

## Requirements

### R1. Workspace skeleton

**User story:** As the developer, I want a Rust workspace with the quality gates wired up, so that every later spec starts from a green, guarded baseline.

1. THE workspace SHALL use Rust edition 2024 and contain the crates chosen in the design phase.
2. THE simulation crate SHALL have no dependency on rendering, networking, threads, clocks, or browser APIs.
3. WHEN `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` run, THEY SHALL all pass.
4. EVERY third-party crate added SHALL have a clear license and be listed in `README.md`.

### R2. Deterministic world and tick loop

**User story:** As the developer, I want a World that advances one tick at a time through a fixed sequence of steps, so that the same seed and inputs always produce the same history.

1. THE World SHALL be created from a world seed and a world config (including the placeholder entity count, default within 40–60).
2. WHEN the World is stepped, THE World SHALL apply the inputs for the current tick, run the tick steps in a fixed order that is written down in code and docs, compute the checksum, and advance the tick counter by exactly one.
3. THE simulation state and logic SHALL use integers only; every division SHALL have a defined rounding rule, and arithmetic that can overflow SHALL use `checked_*` or `saturating_*`.
4. EVERY entity SHALL carry a stable ID from a dedicated monotonic counter; IDs SHALL never be reused.
5. ANY iteration that can change state SHALL go over `BTreeMap`/`BTreeSet` or a list sorted by ID.
6. THE placeholder tick steps SHALL change state every tick using the PRNG, so that the checksum sequence is non-trivial.

### R3. Seeded random streams

**User story:** As the developer, I want each random stream derived from `(world_seed, entity_id, stream_tag)`, so that adding or removing one entity never shifts another entity's random numbers.

1. THE simulation SHALL derive every random stream from `hash(world_seed, entity_id, stream_tag)` and SHALL NOT depend on spawn order or call order across entities.
2. THE simulation SHALL NOT use OS randomness, `thread_rng`, or time-based seeds.
3. THE hash and PRNG algorithms SHALL be implemented or pinned so that their output is identical on native and `wasm32-unknown-unknown`.

### R4. TickInput stream

**User story:** As the developer, I want all external inputs to enter through a recorded stream tagged by tick, so that a replay can reproduce a run without a player or a model.

1. EACH `TickInput` SHALL carry the tick it applies on and a payload from a closed set of variants (this spec defines placeholder variants only).
2. WHEN a `TickInput` is submitted for a tick earlier than the current tick, THE World SHALL reject it with an error and leave the state unchanged.
3. WHEN several inputs apply on the same tick, THE World SHALL apply them in a deterministic order defined in the design.
4. WHEN an input is invalid at apply time (for example it targets a missing entity), THE World SHALL skip it deterministically and record the rejection in state that enters the checksum.
5. THE input stream SHALL be serializable to and from a file format defined in the design.

### R5. Per-tick checksum

**User story:** As the developer, I want a checksum after every tick, so that any divergence is caught at the tick it happens.

1. THE checksum SHALL be computed over a canonical serialization of the World with fixed field order, fixed-width integers, and fixed byte order.
2. THE checksum SHALL NOT depend on `std::hash::Hash`, `HashMap` order, memory addresses, or anything that varies by platform, process, or compiler version.
3. Derived state SHALL be excluded from the checksum.
4. WHEN any field of the canonical World state changes, THE checksum SHALL change (with overwhelming probability).

### R6. Record and replay check

**User story:** As the developer, I want to record a run and replay it, so that I can prove a seed plus input stream reproduces the same per-tick checksums.

1. THE native runner SHALL record a run of N ticks for a given seed and input stream into a replay file.
2. WHEN the runner replays a replay file, IT SHALL re-run the simulation from the seed and inputs only and compare the checksum of every tick.
3. IF any checksum differs, THEN THE runner SHALL report the first divergent tick with expected and actual checksums and exit with a non-zero status.
4. THE replay check SHALL run as part of `cargo test --workspace` on at least one fixed seed.

### R7. Native vs WASM checksum consistency

**User story:** As the developer, I want proof that native and browser builds compute the same history, so that seed batches run natively are valid for replays in the browser.

1. THE workspace SHALL build the simulation for `wasm32-unknown-unknown` through `wasm-bindgen` bindings that can create a World, submit input, step, and read the checksum.
2. AN automated test SHALL run the same seed and input stream natively and in WASM and assert that the per-tick checksum sequences are identical.
3. THE test SHALL also check that every built WASM artifact is under 25 MiB.

### R8. Determinism guards

**User story:** As the developer, I want forbidden constructs rejected by tooling, so that determinism does not rely on code review alone.

1. THE gates SHALL reject floating-point types, `HashMap`/`HashSet`, wall-clock time, threads, and OS randomness in the simulation crate.
2. EACH new gate (static guard, replay check, native-vs-WASM test) SHALL be shown to fail at least once by injecting the fault it guards against; the injection SHALL then be reverted and the result recorded in `docs/kiro-log.md`.

### R9. Property-based tests

**User story:** As the developer, I want `proptest` properties over random seeds and input streams, so that determinism holds beyond a few hand-picked cases.

THE test suite SHALL include `proptest` properties for at least:

1. **Reproducibility**: same seed, config and input stream give identical per-tick checksums across two independent runs.
2. **Replay round-trip**: recording a run, serializing the replay file, parsing it and replaying gives a match on every tick.
3. **Serialization round-trip**: the input stream and replay file survive encode → decode unchanged.
4. **Stream independence**: adding an entity does not change the random draws of any existing entity.
5. **Checksum sensitivity**: mutating one field of the canonical state changes the checksum.
6. **ID monotonicity**: IDs issued by a counter are strictly increasing and never reused within a run.
7. **Semantic invariant** (guarding "deterministically wrong" bugs): the placeholder state keeps its documented ranges after every tick.

### R10. Tick granularity measurement

**User story:** As the designer, I want a quick measurement of 1-day vs 1-week ticks, so that I can choose the granularity on design needs with the cost known.

1. THE runner SHALL measure, for both granularities, with 60 placeholder entities and a placeholder per-entity workload: ticks per second natively and in WASM, wall time to simulate one full lifetime of 80 years, and the share of tick time spent on the checksum.
2. THE results SHALL be written to a document in the repository together with a short comparison on design needs (resolution of "due within N days" stakes, events per tick, narrator node pacing for a 5–10 minute life).
3. THE choice SHALL be made by the author; after the choice, `tech.md` SHALL be updated to record it.

### R11. Kiro hooks

**User story:** As the developer, I want Kiro hooks that run the determinism checks while the agent works, so that divergence and behavior drift are caught when they are introduced, not at the end of a task.

1. WHEN the agent saves a Rust file under `crates/sim-core/`, A hook SHALL run the fixed-seed replay check and report a divergence to the agent.
2. WHEN a spec task finishes, A hook SHALL run a seed batch through `sim-cli` and report its metrics, failing on any invariant violation.
3. EACH hook SHALL be shown to catch an injected fault at least once (R8.2), and every real catch SHALL be recorded in `docs/kiro-log.md` when it happens.
4. THE hooks SHALL be added only after the native-vs-WASM parity test exists (R7).

## Out of scope

- Save and load (rule 10's rebuild-after-load is tested once saves exist).
- Real life-sim, underworld, narrator, or LLM content and their `TickInput` variants.
- The presentation-payload side channel for flavor text.
- The web shell and any deployment.

## Resolved decisions

1. **Toolchain (author chose A1 + B1 + C1).**
   - `rust-toolchain.toml` pins Rust `1.99.1` with `rustfmt`, `clippy` and the `wasm32-unknown-unknown` target.
   - `mise.toml` pins `wasm-bindgen-cli` `0.2.130` (official prebuilt release binary via `github:wasm-bindgen/wasm-bindgen`) and Node `26.7.0`. The `wasm-bindgen` crate version in `Cargo.toml` SHALL equal the CLI version.
   - WASM tests run under Node through `wasm-bindgen-test-runner`; no other WASM runtime.
2. **Lifetime used in R10:** 80 years (29,200 daily ticks or 4,160 weekly ticks).
