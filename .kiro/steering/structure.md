---
inclusion: always
---

# Structure

## Planned layout

This is the initial proposal. Each part is created by its spec, and the spec may adjust names and boundaries; update this file when it does.

```
back-in-the-family/
  crates/
    sim-core/     # deterministic simulation: model, tick steps, event log, narrator, rules, TickInput, checksum
      src/        # params, names, values, events, world, opening, tick, economy, social, death,
                  # births, outsiders, invariants, context_builder, snapshot, replay; llm/ unchanged
        narrator/    # mod.rs, chronicle.rs, patterns.rs, options.rs, salience.rs
        underworld/  # mod.rs, carry_over.rs, dreams.rs, ghosts.rs, hauntings.rs,
                     # joss.rs, magistrate.rs, nodes.rs, offerings.rs, player.rs, slots.rs
      tests/      # life_gen/, invariants.rs, history.rs, inputs.rs, opening.rs, properties.rs,
                  # replay.rs, context_builder.rs, snapshot.rs, source_guard.rs,
                  # underworld.rs, underworld_checker.rs, underworld_gen/;
                  # llm_gen/, llm_examples.rs, llm_properties.rs (llm-probe)
    sim-wasm/     # wasm-bindgen bindings: create world, step, submit input, read snapshot
    sim-cli/      # native headless runner: record/replay/snapshot, seed batches, measure
      src/auto_player.rs  # deterministic waiting-Soul input planner
      tests/auto_player.rs  batch_gate.rs
  web/            # Svelte 5 + Vite TypeScript front end (web-shell spec)
    index.html
    vite.config.ts
    wrangler.jsonc          # the only Cloudflare Static Assets config (assets-only, workers.dev)
    playwright.config.ts
    tsconfig.app.json  tsconfig.worker.json  tsconfig.node.json
    package.json  pnpm-lock.yaml   # pnpm pinned via packageManager + mise.toml
    src/
      App.svelte  main.ts          # page and entry; main.ts installs the harness only with ?harness=1
      main/       # Main_Thread: sim-client.ts (worker client), ui-state.ts (reducer + formatters),
                  #   bridge.ts (worker events -> reducer), harness.ts (test-only window hook)
      worker/     # Sim_Worker: sim.worker.ts (entry, loads the WASM), controller.ts (SimController), tps.ts
      shared/     # Worker_Protocol: protocol.ts, seed.ts, speeds.ts (imported by both sides)
    scripts/      # typecheck.ts, check-deploy.ts (size/identity/boundary), preview.ts (Local_Preview)
    tests/
      unit/       # node:test + fast-check property tests (controller, ui-state, seed, tps, check-deploy)
      smoke/      # @playwright/test against web/dist: fixture.spec.ts, responsive.spec.ts, global-setup.ts
    dist/         # Deploy_Directory: the only files deployed (built by scripts/web-build.sh)
  eval/           # LLM probe (llm-probe spec): imported locked cards, prompt templates, runner, results
    cards/        # the locked Card_Set, Manifest (hash pinned in the runner); never edited, locked and blind files never opened
    probe/        # Probe_Runner: Node + TypeScript, own package.json and pnpm-lock.yaml (own frozen install)
      src/        # CLI (cli.ts), manifest, cards, run/ingest/derive/report/ledger/budget, adapters/, browser/
      page/       # Probe_Page for the in-browser runtimes (WebLLM, transformers.js); built and served by `probe page-serve`
      templates/  # frozen prompt templates: decision.v1, synthesis.v1, decision.system_one.v1, aggregation.perm_avg.v1
      tests/      # unit/ : node:test + fast-check (Properties of the probe design)
      scripts/    # typecheck.ts, prompt-diagnosis.ts
      combinations.json  approvals.json  runtime-libraries.json
    results/      # Results written by the runner; committed except budget/ and bundles/ (gitignored)
      dev/ locked/ derived/ external/ preflight/ smoke/   # per-run files; derived/ = perm_avg Derived_Runs; external/ = External_References
      ledger.jsonl  exclusions.jsonl  failures.jsonl  invalid-dev-runs.json
      budget/     # Workers AI Request_Budget counter (gitignored)
  fixtures/
    parity/       # golden native/WASM replay files (three pairwise plus seedU-underworld.replay.json)
                  # and seed1-pairwise.snapshot-500.json, the native Snapshot at tick 500
    configs/      # world config JSON used to record them
    grading/      # golden grading files (dev, System One, perm_avg) generated from the Dev_Cards by sim-cli; checked by Rust and probe tests (regenerate on purpose with scripts/regen-grading-golden.sh)
  scripts/        # gates.sh, wasm-build.sh, web-build.sh, measure-wasm.*, regen-fixtures.sh, regen-grading-golden.sh, check-wasm-bindgen.sh, check-pnpm-version.sh
  docs/
    kiro-log.md   # evidence log of Kiro usage
    tick-granularity.md          # measurement and design comparison behind the 1-day tick
    sim-core-skeleton-audit.md   # requirement-by-requirement audit of spec 1
    web-shell-audit.md           # requirement-by-requirement audit of spec 2
    llm-probe.md                 # the probe Report (generated by `probe report`; section 9 texts are the Author's)
    llm-probe-audit.md           # requirement-by-requirement audit of spec 3
    life-sim-audit.md            # requirement-by-requirement audit of spec 4
  .cargo/         # config.toml: wasm32 test runner
  .github/
    workflows/
      deploy.yml  # Deploy_Workflow: run gates on push to main, deploy web/dist to Cloudflare when green
  Cargo.toml      # workspace manifest
  rust-toolchain.toml  # pinned Rust version, components and wasm32 target
  mise.toml       # pinned project tools: wasm-bindgen-cli, Node
  .kiro/
    steering/  specs/
```

## Modules and boundaries

| Module | Lives in | Owns | Must not |
|---|---|---|---|
| life-sim | sim-core | Residents, households, relationships (numeric axes + tags), debts, property and inheritance, births and deaths, long-term mood and stress | Read anything outside the model; know about the player UI |
| underworld | `sim-core/src/underworld/` (`mod.rs`, `carry_over.rs`, `dreams.rs`, `ghosts.rs`, `hauntings.rs`, `joss.rs`, `magistrate.rs`, `nodes.rs`, `offerings.rs`, `player.rs`, `slots.rs`) | Waiting Souls, joss ledger, dreams, hauntings, Bribes, slots, rebirth and frozen decision nodes | Give ghosts direct control of living residents |
| Auto_Player and batch | `sim-cli/src/auto_player.rs`, `sim-cli/src/batch.rs`; `sim-cli/tests/auto_player.rs`, `batch_gate.rs` | Deterministic waiting-Soul inputs, passive life-sim acceptance and Devoted underworld reachability reporting | Change simulation state outside recorded inputs |
| soul-identity | sim-core | Soul ID vs body identity, the one-soul-one-place invariant, carry-over rules | Let a soul exist in two places |
| event log | sim-core | Append-only events with participants, `caused_by` pointers, magnitude and tags; the single source of truth for history | Be edited after writing |
| narrator | sim-core | Pattern library that scans new events and their one-hop neighbors, produces nodes with concrete stakes (who, how much, by when), frequency budget, soul-centred salience | Interrupt without at least two defensible options |
| rules / options | sim-core | Closed option sets, legality, effect bounds, the rules default for every node | Depend on LLM availability |
| slow-think bridge | sim-core (pure part) + web (inference) | Rust: D-node context rendering, rule candidates and personality priors, output validation, clamping, building the `TickInput`. Cloudflare Worker (AI binding): rate-limited calls to the Workers AI decision model, timeout, rules fallback. No S, no in-browser model | Let unvalidated model output reach the simulation |
| scenes | web | About four scene templates for the vertical slice (funeral, inheritance, dream, birth); staging and layout only | Compute outcomes |
| web-shell | web | Loading the WASM into the Sim_Worker and owning the only `WasmSim`; the Worker_Protocol; run/pause/step and Speed; showing tick, checksum and ticks-per-second; the Web_Build into `web/dist` and the GitHub Actions deploy. Scenes, the replay gallery and the settings page are later specs | Mutate simulation state except through the Worker_Protocol; load the WASM on the Main_Thread |

## Dependency direction

```
web (scenes, shell, LLM adapter) ──> sim-wasm ──> sim-core
sim-cli ──────────────────────────────────────> sim-core
eval runner ──> sim-core (context rendering + validation) and the LLM adapter
```

`sim-core` has no dependency on rendering, networking, threads, clocks, or the browser.

## Specs (planned order)

1. `sim-core-skeleton`: workspace, tick loop, `TickInput`, checksum, replay check, native-vs-WASM checksum test, tick granularity measurement.
2. `web-shell`: minimal page that loads the WASM and shows tick and checksum; deploy target.
3. `llm-probe`: runner for the locked evaluation cards (closed-set decision and fact synthesis), latency, size and cold-start measurements for the candidate runtimes.
4. `life-sim` (with the soul-identity core): done.
5. `underworld` (thin; target 2026-11-15): `sim-core` plus `sim-cli` and Snapshot extensions, no UI. Joss paper, offerings, dreams, hauntings, bribes as appeals, birth slots, rebirth with a small carry-over, and the decision-node convention (frozen context, rule-generated closed set, rules default with personality priors, an external choice taken from `TickInput` when present) with two nodes, `dream_interpretation` and `magistrate_ruling`. No model call.
6. First playable version: **in progress locally** (2026-11-20), with the Author's completion window extended through **2026-11-22** (2026-11-19 ruling). Tasks 1–14 provide the rules-only Narrator and Player_Node loop, paid Rebuilt_Body Set/Adjust Customization, clock pacing and the interactive advancement gate, Town_View, four template scenes and panels, batch reporting, the recorded playthrough and its browser Smoke_Test. The remaining close-out work is task 15's gate-injection evidence and same-state Rebuilt_Body/Imported_Vessel comparison, then task 16's final check and audit. The C4 decision is `change` (2026-11-19): keep the placeholder `SpriteSet`, no third-party media, and an empty `web/assets/ASSETS.json`. This status describes local implementation/evidence, not a deployment; the deployed baseline remains spec 5. Rebuilt_Body's unique benefit is control over named Traits, not a claim of overall superiority; Carry_Over is shared by all paths.
7. After spec 6: the rest of `slow-think` (validating rule priors plus a decision model with in-simulation metrics), and one spec for the Cloudflare Worker script (AI binding), the request budget (per-session rate limit, daily cap), wiring clef into the decision-node interface, and a one-click deploy button. No S (rule-computed).
8. Pending: a presentation-text layer (dialogue, dreams, obituaries, with caching); the first slice uses template text.

## Next steps (as of 2026-11-16, spec 5 `underworld` done and deployed; spec 6 starting)

- Spec 1 (`sim-core-skeleton`) is done: gates pass from a clean build, and the audit is in `docs/sim-core-skeleton-audit.md`. Known open item from it: the weekly half of the tick measurement can only be re-run at commit `bac46e3`.
- Spec 2 (`web-shell`) is **fully done, including the live deploy.** The `web/` app, the Web_Build (`scripts/web-build.sh` → `web/dist`), the Type_Check / Unit_Tests / Smoke_Test gates, the `wrangler.jsonc` Static Assets config and `.github/workflows/deploy.yml` are all in place; gates pass from a clean build and in CI; and the audit is in `docs/web-shell-audit.md`. The site is live at <https://back-in-the-family.2290698778.workers.dev> (first deploy of commit `76ab0bb`, 2026-11-05). The Deploy_Workflow is **enabled**: a push to `main` runs the gates and, when they pass, deploys `web/dist` to Cloudflare Workers Static Assets automatically. The Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and the repo variable `DEPLOY_ENABLED=true` are set. The "ask before any deploy" spirit still holds for manual or out-of-band deploys, but pushing green commits to `main` now deploys on its own — merge to `main` deliberately.
- Spec 3 (`llm-probe`) is done, audited (`docs/llm-probe-audit.md`) and deployed: commit `b121253` was pushed to `main` and CI run `42751453227` deployed it on 2026-11-10. The Report is `docs/llm-probe.md`; no Combination passed the Thresholds, and its recommendation was Rules_Default for both task types. The Author decided on 2026-11-10 (see the tech.md "LLM runtime" row and `docs/kiro-log.md`): D = Rules_Default plus Workers AI clef picking inside the rule-generated closed set (not Threshold-passing; an informed choice, to be validated in the slow-think spec with in-simulation metrics), S = rules only, a generative LLM for presentation text only, no in-browser LLM.
- Spec 4 (`life-sim`) is **done** (2026-11-11): the thin life simulation and soul-identity core replace the skeleton model in `sim-core`; the Context_Builder and the Snapshot are in; the 80-year acceptance batch runs in `scripts/gates.sh`; the Params are calibrated (births 1,000/100 ppm). The arrival ratio R17.8 (`outsiders <= births`) is the hard target; `outsiders <= births / 3` is reported only (Author, 2026-11-11, audit). Audited in `docs/life-sim-audit.md`; pushed to `main` and deployed by CI run `43134392006` on 2026-11-12.
- Spec 5 (`underworld`) is **done** (2026-11-16): the underworld mechanics, Auto_Player, passive and Devoted batches, checker tests and native/WASM underworld replay fixture are in place; audited in `docs/underworld-audit.md` (task 13.1, follow-ups 14.1 and 15.1). Gate time: task 15.1 (Author, option B) added `[profile.dev.package.sim-core] opt-level = 2` to the workspace `Cargo.toml` (debug assertions and overflow checks stay on) and raised the CI `timeout-minutes` from 45 to 60; `scripts/gates.sh` from a clean build fell from 1,258 s to 377 s with byte-identical batch output. Pushed to `main` and deployed by CI run `43789626782` on 2026-11-16 (about 10 minutes). Next is spec 6, the first playable version: the thinnest vertical slice (narrator, scenes, player interface, Rebuilt_Body customization), 2026-11-16 to at most 2026-11-21 for requirements, design, tasks and accepted implementation; the Kiroween final submission deadline is 2026-12-05 06:00 GMT+8, with time kept after spec 6 for filling gaps, the demo video, English materials and a buffer. The rest of `slow-think`, the Cloudflare Worker script, request budget, clef wiring and one-click deploy button follow after spec 6. A presentation-text layer (with caching) is pending.
- Hooks were tried and removed on 2026-11-04 (output never reached the agent; see `docs/kiro-log.md`); `sim-cli batch` runs as a step in `scripts/gates.sh`. When a later spec changes tick logic, regenerate the fixtures on purpose (`scripts/regen-fixtures.sh`) and say so in the commit.
