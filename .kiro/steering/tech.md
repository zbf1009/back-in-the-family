---
inclusion: always
---

# Tech

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Simulation core | Rust (edition 2024), plain structs and functions, **no ECS** | Small town (40–60 residents), daily settlement; ECS scheduling buys nothing in single-threaded WASM |
| Browser build | `wasm32-unknown-unknown` + `wasm-bindgen` | Every deployed file must stay under 25 MiB |
| Headless runner | Native Rust binary | Seed batches, replay checks, metrics |
| Frontend | Svelte 5 + Vite, all TypeScript (`web/`) | Chosen in the web-shell spec. The vertical slice adds the DOM + Canvas town view and scenes on top |
| Web package manager | pnpm, one exact version | Pinned in both `mise.toml` and `web/package.json` `packageManager`; the two must match (a gate enforces it). Install uses `--frozen-lockfile` |
| Hosting | Cloudflare Workers Static Assets (assets only, no Worker script), on a `*.workers.dev` subdomain | Wiring the Workers AI decision model (clef) needs a Worker script with an AI binding; that script is owned by a later spec, until then this stays assets-only. Deployed by the GitHub Actions Deploy_Workflow (`.github/workflows/deploy.yml`) on push to `main`, only after the gates pass. Deploy is enabled (web-shell task 10): every green push to `main` deploys automatically, so merge to `main` deliberately. **Ask before any manual or out-of-band deploy** |
| LLM runtime | Decided by the Author on 2026-11-10 (see [`docs/llm-probe.md`](../../docs/llm-probe.md) and `docs/kiro-log.md`). **D (closed-set decision)**: Rules_Default plus Workers AI `@cf/cloudflare/clef` (single variant, System One mapping `decision.system_one.v1.txt`, one request per node). Rules own facts, the legal option set, effect bounds, and personality-based priors and filtering; clef picks inside the rule-generated closed set. On by default in the hosted demo; on timeout, error, budget exhaustion or invalid output, fall back to Rules_Default. **This layer did NOT pass the probe's Thresholds** (contrast 4/15; acceptable cluster lower bound 76.4%); it is the Author's informed choice, and personality sensitivity is carried by the rule priors. The combination "rule priors + clef" was not measured on the cards; it is to be validated in the slow-think spec with in-simulation metrics. clef-flash is not adopted (acceptable 78.3%). **S (fact synthesis)**: Rules_Default only, no model call; all facts are computed by rules from the event log, and graded judgements (grudge intensity, direction of relationship change) use rule thresholds. **Generative LLM**: only presentation text (dialogue, dreams, obituaries), recorded as a presentation payload outside the checksum and not re-requested on replay; template text on failure; outside the probe's evaluation scope. **In-browser LLM**: not adopted; the front end loads neither WebLLM nor transformers.js. Rules default is always the last fallback |
| Property-based tests | `proptest` (Rust), `fast-check` on the TS side | fast-check is wired into the web Unit_Tests gate with Node's test runner |

Tick granularity: **1 day per tick**. Decided by the author on 2026-11-04, after the measurements and design comparison in `docs/tick-granularity.md`. Main reasons from that comparison: "due within N days" stakes are exact (weekly ticks would round short stakes up to a whole week), the calendar is a plain 365 days, and events seldom share a tick, so cause and effect keep their order. Performance did not decide it: both options are fast. Accepted cost: 7x more ticks per life than weekly (29,200 per 80 years), mostly checksum work, and larger replay files (about 0.55 MB per life). Every duration in the game is therefore written in days.

## Determinism rules (mandatory in all simulation code)

1. **Integers only.** No `f32`/`f64` in simulation state or logic. Money, affinity, joss paper and stress are integers with documented ranges. Use explicit `checked_*` or `saturating_*` arithmetic where overflow is possible; define rounding for every division.
2. **One seeded PRNG design.** Each random stream is derived as `hash(world_seed, entity_id, stream_tag)`, never from spawn or call order. No OS randomness, no `thread_rng`, no time-based seeds.
3. **Stable IDs.** Persons, souls, households and events carry monotonic IDs from dedicated counters. Never rely on allocation order or memory addresses.
4. **Ordered iteration only.** Use `BTreeMap`/`BTreeSet` or sort by ID before any iteration that can change state. Never iterate a `HashMap`/`HashSet` in simulation logic. Use stable sorts unless the key is globally unique.
5. **Explicit system order.** One tick runs a fixed, written-down sequence of steps.
6. **No ambient inputs.** No wall clock, no threads, no environment reads inside the simulation. Time is the tick counter.
7. **Everything external is a `TickInput`.** Player choices and decision-model results enter only through the recorded input stream, each with the tick it applies on. Replays read the stream and never call a model.
8. **Checksum every tick** over a canonical serialization of simulation state. Native and WASM builds must produce identical checksums for the same seed and input stream; a test enforces this.
9. Make invalid states unrepresentable: fields that must change together go into one `Option<(A, B)>` or enum, not two fields kept in sync by convention.
10. Derived or cached state must be rebuilt after loading a save and must not enter the checksum.

## LLM boundary

- Two task types, only one of which goes to a model:
  - **Closed-set decision (D)**: the decision model (Workers AI clef) picks one option ID from 2–5 rule-generated options for a key NPC. Rules supply the options, personality priors and filtering.
  - **Structured fact synthesis (S)**: computed by rules from the event log (causal pointers, closed enums, event-ID evidence); graded judgements use rule thresholds. No model call.
- Validation before use (decision-model output): the output parses; option IDs are in the set; every referenced person and event exists; enum values are legal. Invalid output falls back to the rules default.
- Effects are clamped to rule-computed bounds. Survival guarantees are outside the model's reach. State is re-validated at apply time.
- Context is frozen when the node fires and rendered to text from simulation state.
- **Waiting**: inference is async. At a node the simulation is paused anyway (the scene is playing); the presentation layer waits up to **10 s by default**, then uses the rules default. Players can change the limit or turn waiting off (then the default applies as soon as the scene ends).
- **Recording**: every decision-model result that the simulation consumes goes into `TickInput` with the node ID, the chosen option, and a model fingerprint. Flavor text (dialogue, dreams, obituaries) is recorded as a presentation payload excluded from the checksum, so replays show the same words.
- **Request budget** (server inference): one decision-model request per node; per-session rate limit; daily cap; rules default when the budget runs out.

## Quality gates

- Rust: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
- Web (`web/`) and probe (`eval/probe/`), run by `scripts/gates.sh` after the Rust gates and the `sim-cli batch` step (and `scripts/wasm-build.sh`), in this order:
  - pnpm version check (`scripts/check-pnpm-version.sh`): `mise.toml` and `web/package.json` `packageManager` present and equal (the probe's `packageManager` is checked too).
  - frozen-lockfile install: `pnpm --dir web install --frozen-lockfile`.
  - Probe frozen-lockfile install: `pnpm --dir eval/probe install --frozen-lockfile`.
  - Manifest_Check: `probe check-manifest` (the `eval/cards` Manifest must hash to the pinned value). Local only: no network, no GPU, no token, never reads the root `env`.
  - Type_Check: `svelte-check` plus `tsc` over the three tsconfigs, covering every first-party `.ts`/`.svelte` file and the wasm-bindgen declarations.
  - Unit_Tests: Node's test runner (`node --test`) with `fast-check` property tests.
  - Probe Type_Check and Probe Unit_Tests (`pnpm --dir eval/probe run typecheck`, `run test:unit`); they need `target/wasm-pkg` from the wasm-build step.
  - Import gate: `probe check-web-imports` (no file under `web/src` may import from `eval/`; the Deploy_Directory half of the leak check is in `web/scripts/check-deploy.ts`).
  - Web_Build (`scripts/web-build.sh`): `scripts/wasm-build.sh`, then `vite build` into `web/dist`, then the deploy-directory checks (per-file size limit, `.wasm` byte-identity with the wasm-build output, the main-bundle boundary that keeps WASM out of the main thread, and no `eval/` or probe content in the output).
  - Smoke_Test: `@playwright/test` on the system Chrome (`channel: 'chrome'`, no browser download) against `web/dist` served by the local preview, comparing worker checksums to a native parity fixture.
  - The probe gates send no request and read no `env`; Workers AI runs (`smoke`, `dev-run`, `locked-run`) are never part of `scripts/gates.sh`.
- Replay check: fixed seed, record N ticks, replay, compare per-tick checksums.
- Any new gate must be shown to fail at least once by injecting the fault it guards against (e.g. a `HashMap` iteration, an OS random call, a type error, an oversized deploy file, a wrong fixture checksum), then the injection is reverted. Record this in `docs/kiro-log.md`.
- Watch for "deterministically wrong" bugs: checksums stay green while behavior is wrong. Guard important behavior with semantic assertions (e.g. "a soul is in exactly one place").

## Process

- Every probe or feature starts with a spec in `.kiro/specs/<name>/`.
- Conventional commits. Ask the user before creating a remote, pushing, making the repo public, deploying, or installing global dependencies.
- Everything in this repository is in English.
- `.kiro/` is always tracked; never add it to `.gitignore`.
- No code from any other project. Third-party libraries and assets must have clear licenses and be listed in `README.md`.
- Log real Kiro usage as it happens in `docs/kiro-log.md` (spec iterations, hook catches, steering fixes). Never backfill or embellish.
- Web research: use Exa MCP first, prefer official sources.
