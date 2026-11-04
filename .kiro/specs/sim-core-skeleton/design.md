# Design: sim-core-skeleton

Status: **decisions D1–D7 resolved** by the author on 2026-11-04, all with the recommended option: L1 crate layout, counter-based random streams, BLAKE3 truncated to 64 bits, hand-written `Canon` encoding, JSON replay files with `u64` as decimal strings, submission order within a tick, shared golden fixtures for parity. The option tables are kept below as the record of what was considered. `[Dn]` markers in the body point to the decision behind a section.

## Changes made during implementation

Added 2026-11-04 in the final check (task 13). The sections below are left as designed, with short "superseded" notes where they now describe something that no longer exists; this list is the record of what changed and why. The requirement-by-requirement check is in `docs/sim-core-skeleton-audit.md`.

- **Checksum builds a buffer, then hashes it (D4).** D4 says the encoding "streams into the hasher with no allocation". The code does `encode_to_vec` into a `Vec<u8>` and then `blake3::hash`es it (`Checksum::of`, about 36.9 KB allocated per tick for the 60-entity workload). The result is identical, because the hash is the same function of the same bytes; only the allocation differs. Whether streaming would be faster was not measured. The author decided to keep the buffer. Noticed in the task 4 report, accepted by the orchestrator without comment, and flagged again in task 11.
- **P4 became P4a and P4b.** The literal P4 (one extra `Spawn` at tick 0) passed under a fault that keyed affinity draws by loop position, because the new entity always gets the largest id and iterates last. P4b removes a low-id entity in one world so every other entity shifts position; both pass today. Found by fault injection in task 7.
- **`bench_checksum` returns a hex string** (`Result<String, JsError>`, plain-Rust twin `bench_checksum_hex`), not unit. Its sink is a running wrapping sum of the checksums; an XOR sink cancels for every even iteration count. `BENCH_WARMUP_TICKS = 100`.
- **`StreamTag::ToolingInputs = 3`** was added for `sim-cli record --random-inputs`; the simulation never draws from it.
- **sim-core additions for the wasm crate:** `replay::SubmitInput` (tick as a strict decimal string plus `ReplayPayload`, no `seq`) and `ReplayConfig::from_json_str`, so sim-wasm does not duplicate the strict `u64` string parser. Every exported wasm function has a plain-Rust twin returning `Result<_, String>` (`WasmSim::create`, `submit_json`, `step_hex`, `run_ticks_hex`, `verify_replay_str`) because `JsError` cannot be built or inspected on native.
- **`DRIFT_PER_TICK`** (was `DRIFT_PER_DAY` while the code still scaled drift by `days_per_tick`): drift is a plain +-10 per tick.
- **Tick granularity fixed at 1 day** (author decision 2026-11-04, `tech.md`, `docs/tick-granularity.md` section 5). Task 12 removed `days_per_tick` from `WorldConfig`, the canonical encoding and `ReplayConfig`; the replay format is **version 2 without `days_per_tick`**, and version 1 files are rejected with `UnsupportedVersion`. The "both granularities" measurement of R10 was done at commit `bac46e3` and led to the decision.
- **Fixtures renamed and a third seed added:** `seed1-pairwise`, `seed2-pairwise`, `seedbig-pairwise` (`fixtures/parity/*.replay.json`), one config `fixtures/configs/pairwise.json`; the four `d1`/`d7` files and `pairwise-d7.json` are gone. Regenerated with `scripts/regen-fixtures.sh` (intentional: config encoding and replay format changed).
- **Config and input JSON shapes as built.** Config (`ReplayConfig`, used by `--config` and by `WasmSim::new`): `{"entity_count":50,"workload":"Pairwise"}`. Wasm input: `{"tick":"5","payload":{"SetValue":{"entity":"3","value":500}}}`. Replay inputs are listed in submission order, the input at index `i` has `seq == i`, and unknown fields are rejected everywhere.
- **sim-cli as built:** `record --seed S --ticks N --out FILE [--config FILE] [--random-inputs K]`, `replay FILE...`, `check-size DIR [--max-bytes N]`, `batch --seeds A..=B --ticks N [--random-inputs K] [--config FILE]`, `measure [--runs N] [--entities N]`. Exit codes: 0 ok; 1 divergence (replay), failed self-verification (record), oversize file (check-size), violation or divergence (batch); 2 usage, malformed or unreadable file, bad config. `replay` with several files processes all of them and 2 wins over 1. Flags accept `--flag value` and `--flag=value`; `--ticks` is 1..=1,000,000.
- **Extra scripts:** `scripts/check-wasm-bindgen.sh` (CLI vs `Cargo.lock` version check, shared by `wasm-build.sh` and `measure-wasm.sh`), `scripts/measure-wasm.sh` and `scripts/measure-wasm.mjs` (R10 WASM timings; the production `wasm-build.sh` output has no `bench` code), `scripts/regen-fixtures.sh`, `scripts/hook-replay.sh`, `scripts/hook-seed-batch.sh`. `gates.sh` also runs the `bench` feature clippy and test steps.
- **Hooks as built, and what was observed.** Files are standalone `.kiro/hooks/<name>.json` in the `{"version":"v1","hooks":[...]}` format with `timeout` at hook level (120 s); `hook-replay.sh` runs `cargo test -p sim-core --test replay --quiet --release` (release, about 4 s, instead of 14.5 s in debug); `hook-seed-batch.sh` builds sim-cli in release and appends one marker line to `/tmp/hook-seed-batch-invoked.log` on every run. Observed: `PostFileSave` fired for a sub-agent's edit-tool saves and not for its shell writes; the failure summary (printed on stdout and stderr, exit 101 or 1) never appeared in the agent's tool results, and the edit was not blocked; `PostTaskExec` fired when the orchestrator called `task_update(completed)` (marker line with real event JSON on stdin) but not for a checkbox that changed without that call; whether a failing hook's output reaches an agent, whether manual edits fire the hook, and whether a failing `PostTaskExec` blocks anything are **not verified**. The three open questions listed in "Kiro hooks" below are therefore only partly answered (see the audit, R11).

## Decisions (resolved)

### D1. Crate layout

| Option | Crates | Pros | Cons |
|---|---|---|---|
| **L1 (chosen)** | `sim-core` (lib), `sim-wasm` (cdylib + wasm-bindgen), `sim-cli` (bin) | Matches `structure.md`. `sim-core` has no browser dependency at all. Each crate has one job. | Three crates to keep in sync. |
| L2 | `sim-core` with an optional `wasm` feature holding the bindings, plus `sim-cli` | One fewer crate. | `wasm-bindgen` becomes a (feature-gated) dependency of the core, which weakens "no browser dependency". Feature combinations complicate clippy and tests. |
| L3 | `sim-det` (PRNG, IDs, canonical encoding, checksum, input envelope, replay format), `sim-core` (world and tick steps), `sim-wasm`, `sim-cli` | The determinism kernel is small and can be guarded strictly; later game modules cannot bypass it. | A fourth crate boundary before there is game code; kernel APIs will churn across the boundary during the vertical slice. |

### D2. Random streams

| Option | How | Pros | Cons |
|---|---|---|---|
| **Counter-based (chosen)** | Every draw is a pure function `draw(world_seed, entity_id, stream_tag, tick, index) -> u64` built from a 64-bit mixer. No generator state. | No RNG state to store, serialize, checksum, or restore after load. Independence between entities holds by construction. Draws can happen in any order. | Each draw site must pick a distinct `index`; a draw site that reuses an index silently repeats a number. Mitigated by tests. |
| Stateful | One small generator (e.g. xoshiro256++) per `(entity, tag)`, seeded from `hash(world_seed, entity_id, stream_tag)`, stored in the World. | Familiar "call next()" API. | Generator state enters the checksum and every future save. Draw order inside one stream matters. |

Both satisfy tech.md rule 2. Neither uses the `rand` crate: its uniform-range algorithms can change between versions, which would change outcomes for the same seed.

### D3. Checksum hash

| Option | Pros | Cons |
|---|---|---|
| **BLAKE3 via `blake3` 1.8.7, `pure` feature, truncated to 64 bits (chosen)** | Fully specified with official test vectors. Strong diffusion, so the "checksum sensitivity" property holds for multi-field changes too. Pure Rust on both targets. License CC0-1.0 OR Apache-2.0. | One dependency. More work per byte than needed at our state size (unlikely to matter; R10 measures it). |
| xxh3-64 via `xxhash-rust` | Very fast, small. | Another dependency (BSL-1.0); non-cryptographic diffusion is still fine for accidental divergence. |
| FNV-1a 64, written in-house | Zero dependencies, about 10 lines. | Weak diffusion: any single-byte change is guaranteed to change the hash, but multi-byte changes can collide more easily than with the others. |

Truncating to 64 bits keeps replay files small (16 hex characters per tick). A 64-bit checksum is ample for catching accidental divergence; it is not a security measure.

### D4. Canonical encoding (what the checksum hashes)

| Option | Pros | Cons |
|---|---|---|
| **Hand-written `Canon` trait with exhaustive destructuring (chosen)** | Byte layout is explicit and owned by us. Each `encode` starts with `let Self { a, b, c } = self;`, so adding a field without encoding it fails to compile. Derived state is excluded by simply not being in the encoded structs. Streams into the hasher with no allocation. | Boilerplate per type. |
| `serde` + `postcard` | Little code. postcard's wire format is specified and stable within 1.x. | The checksum depends on serde attribute behavior and a second crate's format. Excluding derived state needs `#[serde(skip)]`, which is easy to forget. |

Implementation note (2026-11-04): the "streams into the hasher with no allocation" claim did not survive; the checksum encodes into a buffer and then hashes it. See "Changes made during implementation".

### D5. Input stream and replay file format

| Option | Pros | Cons |
|---|---|---|
| **JSON via `serde_json`, with every `u64` written as a decimal string (chosen)** | Readable and diffable in git, so fixtures and gallery replays can be reviewed. Loads directly in the browser. Strings for `u64` avoid JavaScript's 2^53 precision limit. | Larger than binary (an 80-year daily replay is about 0.6 MB of checksums). |
| postcard binary | Small and fast. | Not reviewable; the web shell needs the Rust decoder for any inspection. |
| JSON plus an optional binary form | Both benefits. | Two formats to keep in sync; not needed yet. |

### D6. Order of inputs within one tick

| Option | Rule | Pros | Cons |
|---|---|---|---|
| **Submission order (chosen)** | The input stream assigns each input a sequence number `seq` when it is accepted; inputs apply in `(tick, seq)` order. `seq` is recorded. | Simple; the recorded order is the order. Replays are exact. | Two live sessions with the same choices but different async arrival order (e.g. two LLM results landing in a different order) can diverge. Replays are unaffected. |
| Canonical key | Inputs apply in order of `(tick, payload kind rank, target ID, seq)`. | Live results do not depend on arrival timing. | The rank table must be maintained for every new input kind; harder to reason about which input "wins". |

Note: at a narrator node the simulation is paused while inputs arrive, so arrival-order races should be rare; the option can be revisited in the slow-think spec without changing the replay format.

### D7. Native vs WASM checksum test

| Option | How | Pros | Cons |
|---|---|---|---|
| **Shared golden fixtures (chosen)** | `sim-cli record` writes replay files to `fixtures/parity/`. A native test and a `wasm-bindgen-test` test (in Node) both replay the same files and must match every tick. | Runs through plain `cargo test` (native and `--target wasm32-unknown-unknown`); no extra tooling. Fixture diffs in git make intended behavior changes visible. | Every intentional change to tick logic requires regenerating fixtures (one command). |
| Live comparison through an `xtask` | An `xtask` crate builds both, runs native and Node, compares output. | No fixtures to regenerate. | A fourth crate (or fifth with L3) and a custom command outside `cargo test`; no history of checksum changes. |
| Both | Fixtures plus a live comparison. | Belt and braces. | Most work; the live check adds little once fixtures exist. |

## Overview

The recommended layout (L1):

```
Cargo.toml                 # workspace, resolver 3, edition 2024, shared lint settings
rust-toolchain.toml        # Rust 1.99.1 + wasm32-unknown-unknown (done)
mise.toml                  # wasm-bindgen-cli 0.2.130, Node 26.7.0 (done)
crates/
  sim-core/
    clippy.toml            # determinism bans, scoped to this crate only
    src/
      lib.rs               # #![forbid(unsafe_code)], public API
      ids.rs               # Tick, EntityId, InputSeq, IdCounter
      rng.rs               # counter-based draws, StreamTag        [D2]
      canon.rs             # Canon trait, CanonWriter              [D4]
      checksum.rs          # Checksum(u64), blake3 adapter         [D3]
      input.rs             # TickInput, InputPayload, InputStream  [D6]
      world.rs             # World, WorldConfig, Entity, invariants
      tick.rs              # the fixed step sequence
      replay.rs            # ReplayFile, record, replay, Divergence [D5]
      testing.rs           # test-only mutation API (feature `test-support`)   [added]
    tests/
      replay.rs            # record/replay in-process + fixture replay
      properties.rs        # proptest properties (R9)
      source_guard.rs      # backstop scan for banned constructs (R8)
  sim-wasm/
    src/lib.rs             # wasm-bindgen API
    tests/parity.rs        # wasm-bindgen-test: replay fixtures in Node   [D7]
    tests/bench.rs         # `bench` feature export test                  [added]
  sim-cli/
    src/main.rs            # record | replay | measure | check-size (as built: also batch; lib.rs, args.rs, commands.rs, inputs.rs, batch.rs, measure.rs)
fixtures/parity/*.replay.json                                        [D7]  (as built: seed1-pairwise, seed2-pairwise, seedbig-pairwise)
fixtures/configs/pairwise.json                                       [added]
scripts/
  gates.sh                 # every quality gate in one command (for hooks later)
  wasm-build.sh            # release build + wasm-bindgen + size check
  measure-wasm.mjs         # R10 WASM timing harness (Node)
  (as built, also: check-wasm-bindgen.sh, measure-wasm.sh, regen-fixtures.sh, hook-replay.sh, hook-seed-batch.sh)
docs/tick-granularity.md   # R10 results
docs/sim-core-skeleton-audit.md   # requirement audit (task 13)   [added]
.kiro/hooks/               # replay-on-save.json, seed-batch-after-task.json   [added]
```

Dependency direction: `sim-wasm -> sim-core`, `sim-cli -> sim-core`. `sim-core` depends only on `blake3` [D3], `serde` and `serde_json` [D5].

## Architecture

The crate layout and the dependency direction are described in the Overview above.

## Data Models

This section groups the simulation data model.

### Data model (sim-core)

All integer newtypes derive `Copy, Eq, Ord` and implement `Canon`. None derive `std::hash::Hash`; nothing in sim-core needs it.

```rust
pub struct Tick(pub u64);
pub struct EntityId(pub u64);
pub struct InputSeq(pub u64);

/// Monotonic counter; `next()` returns the current value then increments.
/// Never decrements, never reuses. Overflow is an error (`SimError::IdExhausted`).
pub struct IdCounter { next: u64 }

pub struct WorldConfig {
    pub entity_count: u16,      // initial placeholder entities; default 50, valid 0..=200
    pub workload: Workload,     // Light | Pairwise
}
// Superseded: the original design also had `days_per_tick: u8` (1 or 7). It was removed in
// task 12 when the author fixed the tick at 1 day; see "Changes made during implementation".

pub enum Workload {
    Light,     // value drift only
    Pairwise,  // plus an affinity update for every ordered pair (≈ relationship sim cost)
}

pub struct Entity {
    pub id: EntityId,
    pub value: i32,                          // invariant: 0..=1000
    pub affinity: BTreeMap<EntityId, i16>,   // invariant: -100..=100, keys exist, no self key
}

pub struct World {
    seed: u64,
    config: WorldConfig,
    tick: Tick,
    entity_ids: IdCounter,
    entities: BTreeMap<EntityId, Entity>,
    rejections: Rejections,
}

pub struct Rejections {
    pub count_by_reason: BTreeMap<RejectReason, u64>,
    pub last: Option<(Tick, InputSeq, RejectReason)>,   // rule 9: fields that change together
}

pub enum RejectReason { UnknownEntity, ValueOutOfRange, IdExhausted }
```

There is no derived state yet. The `Canon` impl for `World` encodes every field above; future caches will live outside these structs.

## Components and Interfaces

This section groups the simulation components and their interfaces.

### Random streams [D2: counter-based]

```rust
pub enum StreamTag { Drift = 1, Affinity = 2, ToolingInputs = 3 }   // values are permanent; never renumber (ToolingInputs added in task 8: tooling only, the simulation never draws from it)

pub fn draw(seed: u64, entity: EntityId, tag: StreamTag, tick: Tick, index: u64) -> u64;
pub fn below(x: u64, n: u64) -> u64;   // ((x as u128 * n as u128) >> 64) as u64
pub fn in_range(x: u64, lo: i64, hi: i64) -> i64;   // inclusive, built on below()
```

- `draw` folds the five inputs through a SplitMix64-style finalizer: `h = mix(h ^ input.wrapping_mul(K_i))` for each input in a fixed order, with a distinct odd constant `K_i` per position. Implemented from the published algorithm description, not copied code; unit tests pin known outputs so an accidental change is caught.
- `below` uses a 128-bit multiply with no rejection loop. Its bias is at most `n / 2^64`, documented in the code; all our ranges are under 2^16.
- Draw indexes: the drift step uses `index = 0`; the affinity step for pair `(a, b)` uses `index = b.0`, so adding an entity never changes the draws for existing pairs.

### Canonical encoding [D4] and checksum [D3]

```rust
pub trait Canon { fn encode<W: CanonWriter>(&self, w: &mut W); }
pub trait CanonWriter { fn bytes(&mut self, b: &[u8]); }
```

Rules:
- The stream starts with `CANON_VERSION: u16`.
- Integers: fixed width, little-endian. `usize` is never encoded (it is 4 bytes on wasm32 and 8 natively); lengths are encoded as `u32` after a checked conversion.
- `bool`: one byte, 0 or 1. `Option<T>`: tag byte 0/1 then the value. Enums: explicit `u8` tag per variant, written in code, then fields.
- `BTreeMap`/`Vec`: `u32` length, then elements in iteration order (key order for `BTreeMap`).
- Every `encode` destructures `Self` exhaustively.

`Checksum(u64)` is the first 8 bytes (little-endian) of the BLAKE3 hash of the canonical encoding. Displayed and stored as 16 lowercase hex characters.

### Input stream [D6: submission order]

```rust
pub struct TickInput { pub tick: Tick, pub seq: InputSeq, pub payload: InputPayload }

pub enum InputPayload {           // placeholder variants only
    SetValue { entity: EntityId, value: i32 },
    Spawn { value: i32 },
    Despawn { entity: EntityId },
}

pub struct InputStream { inputs: Vec<TickInput>, next_seq: IdCounter }
```

- `InputStream::submit(current_tick, tick, payload) -> Result<InputSeq, SubmitError>` rejects `tick < current_tick` with `SubmitError::PastTick` and changes nothing (R4.2). Accepted inputs get the next `seq` and are kept sorted by `(tick, seq)`.
- `InputStream::for_tick(tick) -> &[TickInput]` returns that tick's inputs in `seq` order.
- Validation against the World happens at apply time, not at submission (R4.4).

### Tick loop

`World::step(&mut self, inputs: &[TickInput]) -> Checksum` runs this fixed sequence. The same list is the module doc of `tick.rs`.

1. **Apply inputs** in the given `(tick, seq)` order. Invalid inputs are recorded in `rejections` and skipped:
   - `SetValue`: entity must exist; value must be in `0..=1000`.
   - `Spawn`: value in range; takes the next ID from `entity_ids`.
   - `Despawn`: entity must exist; also removes every affinity entry pointing at it.
2. **Drift**: for each entity in ID order, `value += in_range(draw(.., Drift, tick, 0), -10, 10)` clamped to `0..=1000`. (Originally `-10*d..10*d` with `d = days_per_tick`; superseded by task 12, one tick is one day.)
3. **Affinity** (only with `Workload::Pairwise`): for each ordered pair `(a, b)`, `a != b`, in ID order, `affinity[a][b] += in_range(draw(.., Affinity, tick, b), -3, 3)` clamped to `-100..=100`.
4. **Advance**: `tick += 1` (checked).
5. **Checksum** of the resulting state.

A driver ties the two together:

```rust
pub struct Sim { world: World, inputs: InputStream, checksums: Vec<Checksum> }
impl Sim {
    pub fn new(seed: u64, config: WorldConfig) -> Result<Sim, SimError>;
    pub fn submit(&mut self, tick: Tick, payload: InputPayload) -> Result<InputSeq, SubmitError>;
    pub fn step(&mut self) -> Checksum;
}
```

`World::check_invariants() -> Result<(), InvariantViolation>` checks the documented ranges, that affinity keys exist and are not self, and that every entity ID is below the counter. Tests call it after every tick (R9.7). It is not called inside `step`.

### Replay [D5: JSON]

```json
{
  "format": "back-in-the-family/replay",
  "version": 2,
  "seed": "1234567890123",
  "config": { "entity_count": 50, "workload": "Pairwise" },
  "ticks": "2000",
  "inputs": [ { "tick": "5", "seq": "0", "payload": { "SetValue": { "entity": "3", "value": 500 } } } ],
  "checksums": [ "9f2c0a7d41e3b856", "..." ]
}
```

(Superseded example: the original design showed `"version": 1` and `"days_per_tick": 1` in `config`. Format version 2 has no `days_per_tick`; version 1 files are rejected as `UnsupportedVersion`. Inputs are listed in submission order with `seq == index`; unknown fields are rejected.)

- `replay::record(seed, config, inputs, ticks) -> ReplayFile`.
- `replay::verify(&ReplayFile) -> Result<(), Divergence>` rebuilds from seed, config and inputs only, compares every tick, and stops at the first mismatch: `Divergence { tick, expected, actual }`. A file with the wrong number of checksums is an error too.
- Unknown `format` or `version` is rejected.

### sim-cli

Hand-parsed arguments (no CLI framework needed yet).

- `sim-cli record --seed S --ticks N [--config FILE] [--random-inputs K] --out FILE`: `--random-inputs` generates K inputs from the seed (valid and invalid mixed) using the same `draw` function under a tooling-only tag. `--config FILE` is JSON in the replay config shape (`{"entity_count":50,"workload":"Pairwise"}`); without it the world has 50 entities and `Pairwise`.
- `sim-cli replay FILE...`: prints `ok FILE` or the divergence; exit code 1 on mismatch, 2 on a malformed file (all files are processed, 2 wins over 1).
- `sim-cli batch --seeds A..=B --ticks N [--random-inputs K] [--config FILE]`: see "Kiro hooks".
- `sim-cli measure [--runs N] [--entities N]`: R10 native timings. As built after task 12 it measures only the daily lifetime (29,200 ticks); the weekly column of the original design is gone (superseded).
- `sim-cli check-size DIR [--max-bytes N]` (default 26214400): fails if any file is at or above the limit.
- Exit codes: 0 ok; 1 divergence, failed self-verification, oversize file or batch violation; 2 usage error, malformed or unreadable file, invalid config. Both `--flag value` and `--flag=value` are accepted.

`sim-cli` may use `std::time::Instant` for measurement; the bans in `crates/sim-core/clippy.toml` apply only to `sim-core`.

### sim-wasm

```rust
#[wasm_bindgen] pub struct WasmSim { inner: Sim }
#[wasm_bindgen] impl WasmSim {
    #[wasm_bindgen(constructor)] pub fn new(seed: u64, config_json: &str) -> Result<WasmSim, JsError>;
    pub fn submit(&mut self, input_json: &str) -> Result<(), JsError>;
    pub fn step(&mut self) -> String;             // checksum hex
    pub fn tick(&self) -> u64;
    pub fn run_ticks(&mut self, n: u32) -> String; // last checksum hex
}
#[wasm_bindgen] pub fn verify_replay(replay_json: &str) -> Result<(), JsError>;  // error names the tick
#[cfg(feature = "bench")] #[wasm_bindgen] pub fn bench_checksum(seed: u64, config_json: &str, iterations: u32) -> Result<String, JsError>;  // as built: hex of a wrapping-sum sink (was `-> ()` in the first design)
```

`config_json` is the replay config shape, e.g. `{"entity_count":50,"workload":"Pairwise"}` (no `days_per_tick` since task 12). `input_json` is `{"tick":"5","payload":{"SetValue":{"entity":"3","value":500}}}` with `u64` as decimal strings and no `seq`.

`u64` maps to JavaScript `BigInt` in wasm-bindgen. The `wasm-bindgen` crate is pinned with `=0.2.130` to match the CLI.

## Correctness Properties

This section groups the property-based tests.

#### Property-based tests (R9)

In `sim-core/tests/properties.rs`, native only, using `proptest` 1.12.0. Strategies generate a seed, a config (`entity_count` 0..=80, both workloads; the first design also chose both `days_per_tick` values, superseded), and an input stream (0..=40 inputs at ticks 0..=150, any payload, including invalid IDs and out-of-range values), then run 150 ticks. As built P4 is two tests (P4a, P4b) and P6 is two tests (P6a counter, P6b entity ids); cases per test: P1 128, P2 128, P3 128, P4a 64, P4b 64, P5 128, P6a 256, P6b 128, P7 128.

### Property 1: Reproducibility

Two independent `Sim`s give equal checksum vectors.

**Validates: Requirements 9.1**

### Property 2: Replay round-trip

`record` → JSON → parse → `verify` succeeds.

**Validates: Requirements 9.2**

### Property 3: Serialization round-trip

`InputStream` and `ReplayFile` decode to values equal to the originals.

**Validates: Requirements 9.3**

### Property 4: Stream independence

Same seed and inputs, plus one extra `Spawn` at tick 0 in world B: every original entity has the same `value` and the same affinity toward every other original entity in both worlds after each tick.

**Validates: Requirements 9.4**

### Property 5: Checksum sensitivity

After k ticks, apply one generated single-field mutation (entity value ±1 within range, one affinity ±1, tick +1, ID counter +1, a rejection counter +1): checksum changes. Uses a test-only mutation API behind `#[cfg(any(test, feature = "test-support"))]`.

**Validates: Requirements 9.5**

### Property 6: ID monotonicity

Spawned IDs are strictly increasing; a despawned ID never reappears.

**Validates: Requirements 9.6**

### Property 7: Semantic invariants

`check_invariants()` passes after every tick.

**Validates: Requirements 9.7**

## Testing Strategy

This section groups the parity test, determinism guards and measurement.

### Native vs WASM parity [D7: shared fixtures]

- `fixtures/parity/` holds replay files: as built, three seeds (`seed1-pairwise`, `seed2-pairwise`, `seedbig-pairwise`, the last above 2^53) × `Pairwise`, 2,000 ticks each, 50 entities, 120 generated inputs including invalid ones. (The first design had two seeds × both `days_per_tick` values, four files; superseded by task 12.)
- Native: `sim-core/tests/replay.rs` verifies every fixture.
- WASM: `sim-wasm/tests/parity.rs` embeds the same files with `include_str!` and calls `verify_replay` under `wasm-bindgen-test` in Node (`.cargo/config.toml` sets `runner = "wasm-bindgen-test-runner"` for `wasm32-unknown-unknown`).
- `scripts/wasm-build.sh` builds `sim-wasm` in release mode, runs `wasm-bindgen --target web`, and calls `sim-cli check-size` on the output (R7.3).

### Determinism guards (R8)

| Guard | Catches |
|---|---|
| `crates/sim-core/clippy.toml` `disallowed-types`: `f32`, `f64`, `std::collections::HashMap`, `std::collections::HashSet`, `std::time::Instant`, `std::time::SystemTime` | Banned types in signatures, fields, `use` items. Clippy supports primitive types in this list. |
| `disallowed-methods`: `Instant::now`, `SystemTime::now`, `std::thread::spawn`, `std::thread::scope`, `std::thread::Builder::spawn`, `std::thread::Builder::spawn_scoped`, `std::thread::Scope::spawn`, `std::thread::available_parallelism`, `std::env::var`, `std::env::vars` | Ambient inputs and threads. |
| `clippy::float_arithmetic` denied in sim-core | Float arithmetic on inferred types that `disallowed-types` cannot see. |
| `tests/source_guard.rs` | Backstop text scan of `sim-core/src` (comments stripped) for float literals and the banned names (also `thread::scope`, `thread::Builder`, `thread::available_parallelism`), including in code an `#[allow]` hides from clippy. |
| `scripts/gates.sh` checks `cargo tree -p sim-core -e normal` | `rand` or `getrandom` entering the dependency graph. |
| Replay check (`tests/replay.rs`) | Hidden nondeterminism within one platform. |
| Parity fixtures (native + WASM) | Platform-dependent behavior. |

Planned fault injections (each reverted after it is shown to fail, and logged):
1. Clippy: add a `HashMap` field to `World`.
2. Source guard: add `let x = 0.5;` behind `#[allow(clippy::all)]`.
3. Replay check: iterate a `HashMap` in the drift step (with lints allowed locally). Each `HashMap` gets its own random hash keys, so two in-process runs disagree.
4. Parity test: encode a length as `usize` instead of `u32`. Native writes 8 bytes and wasm32 writes 4, so checksums differ only across platforms.
5. Dependency check: add `rand` to `sim-core`.

### Tick granularity measurement (R10)

Superseded in part (2026-11-04): the weekly option and the weekly column no longer exist in the code (task 12). What follows is the measurement as designed and as run at commit `bac46e3`; `sim-cli measure` and `scripts/measure-wasm.mjs` now report only the daily lifetime. The author chose 1 day per tick (`tech.md`).

- Workload: 60 entities, `Pairwise` (60 × 59 = 3,540 pair updates per tick), as a stand-in for relationship updates.
- Lifetime: 80 years = 29,200 ticks at 1 day or 4,160 ticks at 1 week. Per-tick work is the same at both granularities; a weekly tick is not internally split into days.
- Native (`sim-cli measure`): ticks per second, wall time for one lifetime, checksum time per tick measured separately on the same state, best of 5 runs, release build.
- WASM (`scripts/measure-wasm.mjs`, Node, release build with the `bench` feature): the same three numbers, timed in JavaScript with `performance.now()` outside the simulation.
- `docs/tick-granularity.md` reports the numbers, the machine and versions, and a design comparison: resolution of "due within N days" stakes, events per tick at the narrator's 30–40 s interruption budget, and fast-forward time per in-game year. The author chooses; `tech.md` is updated.

## Kiro hooks (R11)

**Withdrawn 2026-11-04 (author decision).** Both hooks and their scripts were deleted in task 14 because their output never reached the agent. The text and tables below describe what was built and are kept as history. `sim-cli batch --seeds 1..=20 --ticks 2000` now runs as a release-build step in `scripts/gates.sh`.

Added after the parity test exists. Files live in `.kiro/hooks/` (tracked).

| Hook | Trigger and matcher | Command | Fails when |
|---|---|---|---|
| `replay-on-save` | `PostFileSave`, matcher `crates/sim-core/.*\.rs$` | `scripts/hook-replay.sh`: `cargo test -p sim-core --test replay --quiet --release` (as built: release, see "Changes made during implementation") | Any fixture or in-process replay diverges, or the crate does not compile. |
| `seed-batch-after-task` | `PostTaskExec` | `scripts/hook-seed-batch.sh`: `sim-cli batch --seeds 1..=20 --ticks 2000` (release build) | Any invariant violation, or any seed fails its record-and-verify round trip. |

`sim-cli batch` (new subcommand) runs each seed with generated random inputs, checks invariants after every tick, records and verifies a replay in memory, and prints one line per seed plus a summary: final checksum, entity count, rejections by reason, and min / max / mean (integer division, rounded down) of entity values. It exits 1 on any violation or divergence.

Hook behavior to confirm when the hooks are added, because the docs (kiro.dev/docs/hooks/types.md and actions.md, read 2026-11-04) leave it open:
- File triggers fire only for changes made by the agent, not manual edits.
- For non-blocking triggers such as `PostFileSave` and `PostTaskExec`, one passage says stderr from a non-zero exit is sent to the agent, another says the trigger "shows a warning and proceeds". The fault injection must show where the failure output actually lands. If the agent does not see it, the hook scripts print the failure summary on stdout as well, or the design is revised with the author.
- Whether `PostTaskExec` fires when the main agent works through `tasks.md` directly, or only through spec task execution.

Status of these three questions after tasks 10 to 13 (observed, not documented behavior): (1) File triggers fired for a sub-agent's edit-tool saves and not for its shell writes; manual edits were never tested. (2) Where a failing hook's output lands is **not answered**: the failure summary never appeared in the sub-agent's tool results, so the "print on stdout as well" fallback in the scripts has not been shown to help. (3) `PostTaskExec` fired when the orchestrator called `task_update(completed)` for task 10 (event JSON with `hook_event_name`, `session_id`, `cwd`, `spec_name` on stdin); it did not fire when a checkbox changed without that call (task 11). The design was not revised with the author on (2); the requirement R11.1 and R11.3 gaps are listed in `docs/sim-core-skeleton-audit.md`.

## Error handling

- `sim-core` never panics on external data. Inputs that are invalid at apply time become rejections; malformed files and configs return `SimError` / `ReplayError` variants.
- Arithmetic in tick steps uses `saturating_*` plus explicit clamps; ID counters and the tick counter use `checked_*` and surface `IdExhausted` / `TickOverflow`.
- Clippy lints `arithmetic_side_effects` and `cast_possible_truncation` are denied in sim-core so unchecked arithmetic and narrowing casts need an explicit justification.

## Dependencies to add (listed in README with licenses when added)

| Crate | Version | License | Used by |
|---|---|---|---|
| `blake3` (feature `pure`) | 1.8.7 | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception | sim-core [D3] |
| `serde`, `serde_json` | latest 1.x at implementation time | MIT OR Apache-2.0 | sim-core [D5] |
| `wasm-bindgen` | =0.2.130 | MIT OR Apache-2.0 | sim-wasm |
| `wasm-bindgen-test` | matching 0.3.x | MIT OR Apache-2.0 | sim-wasm (dev) |
| `proptest` | 1.12.0 | MIT OR Apache-2.0 | sim-core (dev) |

Versions and licenses for `serde`, `serde_json` and `wasm-bindgen-test` are checked on crates.io when they are added.
