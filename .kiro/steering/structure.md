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
    sim-wasm/     # wasm-bindgen bindings: create world, step, submit input, read snapshot
    sim-cli/      # native headless runner: seed batches, replay check, metrics
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
  eval/           # LLM probe: imported locked cards, prompt templates, runner, results
  fixtures/
    parity/       # golden replay files shared by native and WASM parity tests (seed1/seed2/seedbig-pairwise)
    configs/      # world config JSON used to record them
  scripts/        # gates.sh, wasm-build.sh, web-build.sh, measure-wasm.*, regen-fixtures.sh, check-wasm-bindgen.sh, check-pnpm-version.sh
  docs/
    kiro-log.md   # evidence log of Kiro usage
    tick-granularity.md          # measurement and design comparison behind the 1-day tick
    sim-core-skeleton-audit.md   # requirement-by-requirement audit of spec 1
    web-shell-audit.md           # requirement-by-requirement audit of spec 2
  .cargo/         # config.toml: wasm32 test runner
  .github/
    workflows/
      deploy.yml  # Deploy_Workflow: run gates on push to main, deploy web/dist to Cloudflare when green
  Cargo.toml      # workspace manifest
  rust-toolchain.toml  # pinned Rust version, components and wasm32 target
  mise.toml       # pinned project tools: wasm-bindgen-cli, Node
  .kiro/
    steering/  specs/  agents/
```

## Modules and boundaries

| Module | Lives in | Owns | Must not |
|---|---|---|---|
| life-sim | sim-core | Residents, households, relationships (numeric axes + tags), debts, property and inheritance, births and deaths, long-term mood and stress | Read anything outside the model; know about the player UI |
| underworld | sim-core | Souls of the dead, joss paper income and spending, dreams, hauntings, bribes, birth slots, imported vessels, rebuilt bodies | Give ghosts direct control of living residents |
| soul-identity | sim-core | Soul ID vs body identity, the one-soul-one-place invariant, carry-over rules | Let a soul exist in two places |
| event log | sim-core | Append-only events with participants, `caused_by` pointers, magnitude and tags; the single source of truth for history | Be edited after writing |
| narrator | sim-core | Pattern library that scans new events and their one-hop neighbors, produces nodes with concrete stakes (who, how much, by when), frequency budget, soul-centred salience | Interrupt without at least two defensible options |
| rules / options | sim-core | Closed option sets, legality, effect bounds, the rules default for every node | Depend on LLM availability |
| slow-think bridge | sim-core (pure part) + web (inference) | Rust: context rendering, output validation, clamping, building the `TickInput`. TS: calling the model, timeout, fallback chain | Let unvalidated model output reach the simulation |
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
4. Vertical slice: `life-sim`, `underworld`, `soul-identity`, `narrator`, `slow-think`, `scenes`, each thin at first.

## Next steps (as of 2026-11-05, after spec 2)

- Spec 1 (`sim-core-skeleton`) is done: gates pass from a clean build, and the audit is in `docs/sim-core-skeleton-audit.md`. Known open item from it: the weekly half of the tick measurement can only be re-run at commit `bac46e3`.
- Spec 2 (`web-shell`) is **fully done, including the live deploy.** The `web/` app, the Web_Build (`scripts/web-build.sh` → `web/dist`), the Type_Check / Unit_Tests / Smoke_Test gates, the `wrangler.jsonc` Static Assets config and `.github/workflows/deploy.yml` are all in place; gates pass from a clean build and in CI; and the audit is in `docs/web-shell-audit.md`. The site is live at <https://back-in-the-family.2290698778.workers.dev> (first deploy of commit `76ab0bb`, 2026-11-05). The Deploy_Workflow is **enabled**: a push to `main` runs the gates and, when they pass, deploys `web/dist` to Cloudflare Workers Static Assets automatically. The Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and the repo variable `DEPLOY_ENABLED=true` are set. The "ask before any deploy" spirit still holds for manual or out-of-band deploys, but pushing green commits to `main` now deploys on its own — merge to `main` deliberately.
- Next is spec 3, `llm-probe`: a runner for the locked evaluation cards (closed-set decision and fact synthesis) with latency, size and cold-start measurements for the candidate runtimes.
- Hooks were tried and removed on 2026-11-04 (output never reached the agent; see `docs/kiro-log.md`); `sim-cli batch` runs as a step in `scripts/gates.sh`. When a later spec changes tick logic, regenerate the fixtures on purpose (`scripts/regen-fixtures.sh`) and say so in the commit.
- Evaluation cards are still being authored and locked outside the repository. Import the locked set only when it arrives, and log its manifest hash in `docs/kiro-log.md` before any model run (spec 3, `llm-probe`).
