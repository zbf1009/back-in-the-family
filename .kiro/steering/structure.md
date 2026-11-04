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
    sim-cli/      # native headless runner: seed batches, replay check, metrics for hooks
  web/            # TypeScript frontend: town view, scenes, chronicle, settings, LLM runtime adapter
  eval/           # LLM probe: imported locked cards, prompt templates, runner, results
  fixtures/
    parity/       # golden replay files shared by native and WASM parity tests (seed1/seed2/seedbig-pairwise)
    configs/      # world config JSON used to record them
  scripts/        # gates.sh, wasm-build.sh, measure-wasm.*, regen-fixtures.sh, hook-*.sh, check-wasm-bindgen.sh
  docs/
    kiro-log.md   # evidence log of Kiro usage
    tick-granularity.md          # measurement and design comparison behind the 1-day tick
    sim-core-skeleton-audit.md   # requirement-by-requirement audit of spec 1
  .cargo/         # config.toml: wasm32 test runner
  Cargo.toml      # workspace manifest
  rust-toolchain.toml  # pinned Rust version, components and wasm32 target
  mise.toml       # pinned project tools: wasm-bindgen-cli, Node
  .kiro/
    steering/  specs/  hooks/  agents/
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
| web-shell | web | Loading WASM, game loop, fast-forward, settings (LLM wait limit), replay gallery | Mutate simulation state except through `TickInput` |

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

## Next steps (as of 2026-11-04, after spec 1)

- Spec 1 (`sim-core-skeleton`) is done: gates pass from a clean build, and the audit is in `docs/sim-core-skeleton-audit.md`. Known open items from it: the two hooks fire, but whether a failing hook's output ever reaches the agent was not observed (R11), and the weekly half of the tick measurement can only be re-run at commit `bac46e3`.
- Next is spec 2, `web-shell`: load `sim-wasm` in a page, show tick and checksum, choose the deploy target. Ask before any deploy.
- Hooks are set up (`.kiro/hooks/`): `replay-on-save` and `seed-batch-after-task`. When a later spec changes tick logic, regenerate the fixtures on purpose (`scripts/regen-fixtures.sh`) and say so in the commit.
- Evaluation cards are still being authored and locked outside the repository. Import the locked set only when it arrives, and log its manifest hash in `docs/kiro-log.md` before any model run (spec 3, `llm-probe`).
