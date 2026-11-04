---
inclusion: always
---

# Tech

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Simulation core | Rust (edition 2024), plain structs and functions, **no ECS** | Small town (40–60 residents), daily settlement; ECS scheduling buys nothing in single-threaded WASM |
| Browser build | `wasm32-unknown-unknown` + `wasm-bindgen` | Every deployed file must stay under 25 MiB |
| Headless runner | Native Rust binary | Seed batches, replay checks, metrics for hooks |
| Frontend | TypeScript web app (DOM + Canvas) | Framework chosen in the web-shell spec |
| Hosting | Cloudflare (Workers static assets or Pages) | Ask before any deploy |
| LLM runtime | Decided by the W1 probe | Candidates: in-browser (WebLLM or transformers.js) and server-side (Cloudflare Workers AI). Rules default is always the last fallback |
| Property-based tests | `proptest` (Rust), `fast-check` if needed on the TS side | |

Tick granularity: **1 day per tick**. Decided by the author on 2026-11-04, after the measurements and design comparison in `docs/tick-granularity.md`. Main reasons from that comparison: "due within N days" stakes are exact (weekly ticks would round short stakes up to a whole week), the calendar is a plain 365 days, and events seldom share a tick, so cause and effect keep their order. Performance did not decide it: both options are fast. Accepted cost: 7x more ticks per life than weekly (29,200 per 80 years), mostly checksum work, and larger replay files (about 0.55 MB per life). Every duration in the game is therefore written in days.

## Determinism rules (mandatory in all simulation code)

1. **Integers only.** No `f32`/`f64` in simulation state or logic. Money, affinity, joss paper and stress are integers with documented ranges. Use explicit `checked_*` or `saturating_*` arithmetic where overflow is possible; define rounding for every division.
2. **One seeded PRNG design.** Each random stream is derived as `hash(world_seed, entity_id, stream_tag)`, never from spawn or call order. No OS randomness, no `thread_rng`, no time-based seeds.
3. **Stable IDs.** Persons, souls, households and events carry monotonic IDs from dedicated counters. Never rely on allocation order or memory addresses.
4. **Ordered iteration only.** Use `BTreeMap`/`BTreeSet` or sort by ID before any iteration that can change state. Never iterate a `HashMap`/`HashSet` in simulation logic. Use stable sorts unless the key is globally unique.
5. **Explicit system order.** One tick runs a fixed, written-down sequence of steps.
6. **No ambient inputs.** No wall clock, no threads, no environment reads inside the simulation. Time is the tick counter.
7. **Everything external is a `TickInput`.** Player choices and LLM results enter only through the recorded input stream, each with the tick it applies on. Replays read the stream and never call a model.
8. **Checksum every tick** over a canonical serialization of simulation state. Native and WASM builds must produce identical checksums for the same seed and input stream; a test enforces this.
9. Make invalid states unrepresentable: fields that must change together go into one `Option<(A, B)>` or enum, not two fields kept in sync by convention.
10. Derived or cached state must be rebuilt after loading a save and must not enter the checksum.

## LLM boundary

- Two task types:
  - **Closed-set decision**: pick one option ID from 2–5 rule-generated options for a key NPC.
  - **Structured fact synthesis**: read an event log excerpt with causal pointers and return conclusions in a fixed JSON schema (closed enums plus event-ID evidence).
- Validation before use: the output parses; option IDs are in the set; every referenced person and event exists; enum values are legal. Invalid output falls back to the rules default.
- Effects are clamped to rule-computed bounds. Survival guarantees are outside the LLM's reach. State is re-validated at apply time.
- Context is frozen when the node fires and rendered to text from simulation state.
- **Waiting**: inference is async. At a node the simulation is paused anyway (the scene is playing); the presentation layer waits up to **10 s by default**, then uses the rules default. Players can change the limit or turn waiting off (then the default applies as soon as the scene ends).
- **Recording**: every LLM result that the simulation consumes goes into `TickInput` with the node ID, the chosen option or structured result, and a model fingerprint. Flavor text (dialogue, dreams, obituaries) is recorded as a presentation payload excluded from the checksum, so replays show the same words.
- **Request budget** (server inference): one request per node, with all NPCs involved in that node batched into one prompt; per-session rate limit; daily cap; rules default when the budget runs out.

## Quality gates

- Rust: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
- TS: type check with no errors.
- Replay check: fixed seed, record N ticks, replay, compare per-tick checksums.
- Any new gate must be shown to fail at least once by injecting the fault it guards against (e.g. a `HashMap` iteration, an OS random call), then the injection is reverted. Record this in `docs/kiro-log.md`.
- Watch for "deterministically wrong" bugs: checksums stay green while behavior is wrong. Guard important behavior with semantic assertions (e.g. "a soul is in exactly one place").

## Process

- Every probe or feature starts with a spec in `.kiro/specs/<name>/`.
- Conventional commits. Ask the user before creating a remote, pushing, making the repo public, deploying, or installing global dependencies.
- Everything in this repository is in English.
- `.kiro/` is always tracked; never add it to `.gitignore`.
- No code from any other project. Third-party libraries and assets must have clear licenses and be listed in `README.md`.
- Log real Kiro usage as it happens in `docs/kiro-log.md` (spec iterations, hook catches, steering fixes). Never backfill or embellish.
- Web research: use Exa MCP first, prefer official sources.
