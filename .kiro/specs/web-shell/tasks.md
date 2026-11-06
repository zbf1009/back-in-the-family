# Implementation Plan: web-shell

## Overview

The plan builds the web shell from the bottom up: pinned tooling and the `web/` package first, then the pure modules and the worker-side `SimController` with their property tests, then the worker entry, Main_Thread and page, then the Web_Build and Local_Preview, then the Playwright Smoke_Test. Each new gate is added to `scripts/gates.sh` in the task that makes it meaningful, in the R10.1 order, and is shown to fail once by injection in that same task. The Static Assets config and the GitHub Actions workflow come after the local gates are complete, with deploy disabled. A final check task audits the spec. The last task enables deploy and stops for the author's approval at every step that leaves the machine.

Each task ends with `scripts/gates.sh` green and one local conventional commit. Nothing is pushed, no secret is set and nothing is deployed until task 10, and there only with the author's explicit approval at that moment.

## Notes

Execution notes for the orchestrator:
- Tasks and sub-tasks run strictly one at a time, in numeric order (see "Task Dependency Graph" at the end). They edit the same files (`scripts/gates.sh`, `web/package.json`, `web/pnpm-lock.yaml`, `web/vite.config.ts`, `README.md`, `docs/kiro-log.md`), so they must not run in parallel.
- Delegate each task to the `spec-task-execution` sub-agent with `requirements.md`, `design.md` and `.kiro/steering/*.md` in context.
- Fault injections (R10.5 to R10.8): inject one fault, run the full `scripts/gates.sh`, show it exits non-zero and prints `gate failed: <command>` for the targeted gate, revert, re-run to exit 0, and write the `docs/kiro-log.md` entry right then (date, gate, fault, failure excerpt, revert, passing re-run). No injected fault may remain in any commit.
- Log real Kiro usage in `docs/kiro-log.md` as it happens: spec or design changes made during implementation, surprises (for example a tool behaving differently from the design), and agent misses. Never backfill.
- Dependencies: pnpm 10.33.1 through the project `mise.toml` and npm dev dependencies in `web/` are project-local and allowed. No global installs, no `playwright install`, no browser download. Whenever a task adds a dependency, it checks the license on the registry and adds the package, its resolved lockfile version and its SPDX license to `README.md` (R1.8, R12.7).
- Every version number in `design.md` "Research findings" is to be confirmed when the lockfile is created; the resolved versions go into `README.md`, and any deviation from the design (for example a peer-dependency conflict) is logged.
- Property tests use `fast-check` with `node:test`, at least 100 runs each, and carry the comment `// Feature: web-shell, Property N: <title>`. They run in the Unit_Tests gate. The controller tests load the real WASM from `target/wasm-pkg` with `initSync`, so they need `scripts/wasm-build.sh` to have run (the gates run it earlier).
- The only optional sub-task is 2.13; every other test sub-task feeds a gate or a fault injection and is required.

## Tasks

- [x] 1. Pinned tooling, `web/` package and the first two web gates
  - [x] 1.1 Pin pnpm and create the `web/` package
    - Add `pnpm = "10.33.1"` to `mise.toml`; create `web/package.json` with `"type": "module"`, `"packageManager": "pnpm@10.33.1"` and the design's dev dependencies except `wrangler` (added in task 7): `svelte` 5, `vite`, `@sveltejs/vite-plugin-svelte`, `svelte-check`, `typescript` 6.x, `@types/node`, `@playwright/test`, `fast-check`. Exact versions, no ranges.
    - Run `pnpm install` once to create `web/pnpm-lock.yaml` and commit it. If pnpm 10 reports ignored build scripts, record which packages and whether anything breaks; allow a build only if required (`pnpm.onlyBuiltDependencies`) and log the reason.
    - Create the skeleton the later tasks fill in: `web/index.html`, `web/vite.config.ts` (Svelte plugin only for now), `web/tsconfig.app.json`, `web/tsconfig.worker.json`, `web/tsconfig.node.json` (all with `erasableSyntaxOnly: true`, `noEmit`), a placeholder `web/src/main.ts` and `web/src/App.svelte` (`lang="ts"`), and the empty `web/public/`.
    - Ignore `web/node_modules/` and `web/.bundle-report.json`; confirm `web/dist` is already covered by `dist/`.
    - Check each direct dependency's license on the registry; add a `README.md` table with package, resolved version and SPDX license.
    - _Requirements: 1.1, 1.2, 1.4, 1.7, 1.8, 12.7_
  - [x] 1.2 Add `scripts/check-pnpm-version.sh` and wire the first web gates
    - The script reads the `pnpm` line of `mise.toml` and `packageManager` from `web/package.json` (via `node -p`), requires `x.y.z` / `pnpm@x.y.z`, and on a missing, malformed or differing value prints `mise.toml: <value|missing>` and `web/package.json packageManager: <value|missing>` and exits 1.
    - `scripts/gates.sh`: change `run` to print `gate failed: <command>` and exit with the command's status; export `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` at the top; after the existing `scripts/wasm-build.sh` line add `run scripts/check-pnpm-version.sh` and `run pnpm --dir web install --frozen-lockfile`.
    - Check R1.6 once by hand: add an unlisted dependency to `web/package.json` without updating the lockfile, run the install gate, confirm it fails with pnpm's outdated-lockfile error and the lockfile is unchanged (`git diff --stat`), revert, and note the result in `docs/kiro-log.md`.
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 1.7, 9.2, 10.1, 10.2, 10.3, 10.4_
  - [x] 1.3 Fault injection for the pnpm version check, then commit
    - Set `packageManager` to a different patch version than `mise.toml`; run the full gates; expect both values printed and `gate failed: scripts/check-pnpm-version.sh`. Revert, re-run to green, log in `docs/kiro-log.md`.
    - One conventional commit for task 1.
    - _Requirements: 1.3, 10.5, 10.6, 10.7, 10.8_

- [x] 2. Shared modules, `SimController` and the Unit_Tests gate
  - [x] 2.1 Write the shared modules
    - `web/src/shared/protocol.ts` (`RunState`, `Request`, `Snapshot`, `ErrorKind`, `WorkerMessage` exactly as in the design), `web/src/shared/speeds.ts` (`SPEEDS = [1, 7, 30, 90, 365] as const`), `web/src/shared/seed.ts` (`SEED_MAX`, `parseSeed`, `seedProblemMessage`; check order empty → non-digit → too-large; never through `Number`).
    - Add the `test:unit` script (`node --test tests/unit/`).
    - _Requirements: 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 4.4, 6.3_
  - [x] 2.2 Write property test for seed parsing
    - **Property 1: Seed parsing classifies every string and round-trips every u64**
    - `web/tests/unit/seed.test.ts`, with the design's examples (`""`, `" 1"`, `"-1"`, `"1e3"`, `"18446744073709551616"`) and their messages.
    - **Validates: Requirements 2.10, 3.2, 3.3, 3.4, 6.3, 6.4**
  - [x] 2.3 Write the Ticks_Per_Second window
    - `web/src/worker/tps.ts` as in the design (samples, drop rule, `null` before 1,000 ms, `bigint` ticks).
    - _Requirements: 2.12, 5.6_
  - [x] 2.4 Write property test for the Ticks_Per_Second window
    - **Property 9: Ticks_Per_Second window**
    - `web/tests/unit/tps.test.ts`.
    - **Validates: Requirements 5.6**
  - [x] 2.5 Write `SimController`
    - `web/src/worker/controller.ts` with `SimHandle`, `FrameScheduler`, `Clock` and the request-handling table from the design: validation before any `SimHandle` call, failure replies carrying the unchanged snapshot, the early-request queue, `fail()` for load failure and uncaught errors (`fatal`, then `invalid-state` / `load-failed` for later requests), one outstanding frame request, `step()` at Speed 1 and `run_ticks(Speed)` otherwise, `status` at most every 100 ms, create-world that stops the loop only after the new instance exists, Speed kept across run, pause and create. The worker state follows the design's table (`sim` and `worldId` in one field). Clock values are read only for pacing and `tps.ts`.
    - _Requirements: 2.1, 2.7, 2.8, 2.10, 2.11, 2.12, 3.4, 3.5, 3.7, 4.1, 4.2, 4.3, 4.5, 4.6, 4.11, 6.1, 6.3, 6.4, 6.5_
  - [x] 2.6 Write the controller test helpers
    - `web/tests/unit/helpers/`: load `target/wasm-pkg/sim_wasm_bg.wasm` with the glue's `initSync`; a fake `FrameScheduler` fired by hand; a fake `Clock`; a recording `SimHandle` wrapper; a reference-run helper that submits inputs before the same tick and calls `step()` once per tick; fast-check generators for small configs (1–20 entities, any workload), inputs and command sequences capped at 3,000 ticks per case.
    - _Requirements: 6.6_
  - [x] 2.7 Write property test for reply discipline
    - **Property 2: Exactly one well-formed reply per request, in order**
    - **Validates: Requirements 2.4, 2.5, 2.7**
  - [x] 2.8 Write property test for rejected requests
    - **Property 3: Rejected requests change nothing and never reach Sim_Wasm with bad arguments**
    - **Validates: Requirements 2.10, 2.11, 3.6, 4.11, 6.3, 6.4**
  - [x] 2.9 Write property test for speed independence
    - **Property 4: Reported checksums are independent of speed and pacing (model conformance)**
    - **Validates: Requirements 3.5, 3.7, 4.1, 4.2, 4.5, 5.4, 6.6**
  - [x] 2.10 Write property test for frame discipline
    - **Property 5: Frame discipline**
    - Required: this property is the target of the Unit_Tests fault injection in 2.14.
    - **Validates: Requirements 4.3, 4.5, 4.6**
  - [x] 2.11 Write property test for clock independence
    - **Property 6: Clock and frame timing never reach the simulation**
    - **Validates: Requirements 6.5**
  - [x] 2.12 Write controller example tests
    - In `web/tests/unit/controller.test.ts`: a load failure answers every queued and later request with `load-failed` and sends `fatal`; with a fake 60 Hz clock, the gap between `status` messages while running never exceeds 1,000 ms; Speed persists across create-world; create-world while running with a bad config leaves the old world running.
    - _Requirements: 2.8, 2.12, 3.6, 4.5_
  - [x] 2.13 Write a unit test for `check-pnpm-version.sh`
    - `web/tests/unit/pnpm-version.test.ts` runs the script against temporary copies with a missing value, a different version and a range, and checks the exit status and printed values. Optional because the injection in 1.3 already demonstrated R1.3.
    - _Requirements: 1.3_
  - [x] 2.14 Wire the Unit_Tests gate, inject its fault, commit
    - `scripts/gates.sh`: `run pnpm --dir web run test:unit` after the install gate (the Type_Check gate is inserted before it in task 3).
    - Injection: in `controller.ts` run `Speed + 1` ticks per batch; the full gates must fail with a Property 5 counterexample and `gate failed: pnpm --dir web run test:unit`. Revert, re-run to green, log.
    - One conventional commit for task 2.
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 10.8_

- [x] 3. Worker entry, Main_Thread, page and the Type_Check gate
  - [x] 3.1 Write the Sim_Worker entry
    - `web/src/worker/sim.worker.ts`: `import init, { WasmSim } from 'sim-wasm/sim_wasm.js'` and `import wasmUrl from 'sim-wasm/sim_wasm_bg.wasm?url'`; await `init({ module_or_path: wasmUrl })`; build `SimController` with `createSim: (s, c) => new WasmSim(s, c)`, a `requestAnimationFrame` scheduler with a `setTimeout(cb, 16)` fallback, `performance.now`, and `self.postMessage`; route load errors and the global `error` handler to `fail()`.
    - Add the `sim-wasm` alias and `worker.format: 'es'` to `vite.config.ts`, and the `paths` entry and `vite/client` types to `tsconfig.worker.json`.
    - _Requirements: 2.1, 2.8, 6.1, 6.2, 8.4_
  - [x] 3.2 Write the Main_Thread client
    - `web/src/main/sim-client.ts`: module worker via `new URL('../worker/sim.worker.ts', import.meta.url)`, request ids, pending map with 30 s timeouts that reject with an error naming the request, fan-out of `reply`, `status`, `fatal`, worker `error` and `messageerror`.
    - _Requirements: 2.2, 2.9, 6.2, 9.13_
  - [x] 3.3 Write the UI state reducer
    - `web/src/main/ui-state.ts`: `UiState`, `UiEvent`, `reduce`, `controls`, and the status formatters (dash for `null`), as in the design.
    - _Requirements: 2.9, 3.3, 3.5, 3.6, 3.7, 3.8, 4.7, 4.8, 4.9, 4.10, 5.1, 5.2, 5.3, 5.6, 5.8, 5.9_
  - [x] 3.4 Write property test for the UI reducer
    - **Property 7: UI reducer keeps the display honest**
    - `web/tests/unit/ui-state.test.ts`.
    - **Validates: Requirements 2.9, 3.6, 3.7, 5.8, 5.9**
  - [x] 3.5 Write property test for status formatting
    - **Property 8: Status formatting**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.6**
  - [x] 3.6 Write the exhaustive controls table test
    - Every Run_State × `stepPending` × `createPending` combination against the expected enabled controls.
    - _Requirements: 3.8, 4.7, 4.8, 4.9, 4.10_
  - [x] 3.7 Write the page, `main.ts` and the harness
    - `web/src/App.svelte`: seed `<input>`, config `<textarea>` prefilled from `fixtures/configs/pairwise.json` via `?raw`, Create/Run/Pause/Step buttons, Speed `<select>` from `SPEEDS` with 1 selected, four status fields with `data-testid`, error area, seed validation message. No control for inputs, replays or verification.
    - `web/src/main.ts` mounts the app and installs `web/src/main/harness.ts` (`window.__simHarness.request`) only when `location.search` contains `harness=1`.
    - _Requirements: 3.1, 3.2, 3.3, 4.4, 4.7, 4.8, 4.9, 4.10, 5.1, 5.8, 9.11_
  - [x] 3.8 Write the Type_Check, wire its gate, inject its fault, commit
    - `web/scripts/typecheck.ts` and the `typecheck` script: fail with `Sim_Wasm declarations missing at target/wasm-pkg/sim_wasm.d.ts; run scripts/wasm-build.sh` if the file is absent; otherwise run `svelte-check --tsconfig tsconfig.app.json`, `tsc -p tsconfig.worker.json`, `tsc -p tsconfig.node.json`; non-zero on any error, warnings ignored. Confirm the three tsconfigs together include every first-party `.ts` and `.svelte` file, including `scripts/`, `tests/`, `vite.config.ts` and `playwright.config.ts` once they exist.
    - `scripts/gates.sh`: `run pnpm --dir web run typecheck` between the install gate and the Unit_Tests gate.
    - Check R8.5 once by renaming `target/wasm-pkg/sim_wasm.d.ts`, confirming the message, and restoring it; note it in `docs/kiro-log.md`.
    - Injection: pass `Number(seed)` to `new WasmSim` in `sim.worker.ts`; expect TS2345 with file and line and `gate failed: pnpm --dir web run typecheck`. Revert, re-run to green, log.
    - One conventional commit for task 3.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 10.1, 10.2, 10.5, 10.6, 10.7, 10.8_

- [x] 4. Web_Build, deploy-directory checks and Local_Preview
  - [x] 4.1 Finish `vite.config.ts`
    - `build.assetsInlineLimit` as a function that never inlines `.wasm`; a small plugin that writes the `node_modules` packages present in the bundle to `web/.bundle-report.json` (outside `dist`).
    - _Requirements: 1.8, 7.3_
  - [x] 4.2 Write `web/scripts/check-deploy.ts`
    - A pure, exported size check over (relative path, size) entries plus the directory walk; then the `.wasm` count and SHA-256 identity with `target/wasm-pkg/sim_wasm_bg.wasm`; then the main-bundle boundary (no `__wbindgen` marker or hashed `.wasm` name outside the worker chunk). Checks run in this order, each prints all offenders, exit 1 if any failed. A file of exactly 26,214,400 bytes passes. Add the `check-deploy` script.
    - _Requirements: 2.3, 7.3, 7.4, 7.5, 7.9_
  - [x] 4.3 Write property test for the size check
    - **Property 10: Size check flags exactly the files above the limit**
    - `web/tests/unit/check-deploy.test.ts`, plus examples: one oversized file at depth 3; two `.wasm` files fail; a main chunk containing `__wbindgen` fails.
    - **Validates: Requirements 7.4, 7.5, 7.9**
  - [x] 4.4 Write `scripts/web-build.sh`
    - As in the design: steps `wasm-build`, `rm -rf web/dist`, `vite-build`, `check-deploy`, each failure naming its step. Check once by hand that a file placed in `web/dist` before the run is gone afterwards (R7.2) and that a failing step is named (R7.8); note both in `docs/kiro-log.md`.
    - _Requirements: 7.1, 7.2, 7.3, 7.8, 7.9_
  - [x] 4.5 Write Local_Preview
    - `web/scripts/preview.ts` and the `preview` script: exit 1 with `Deploy_Directory web/dist is missing or empty; run scripts/web-build.sh first` when `web/dist` is absent or empty; otherwise `vite preview --outDir dist --port 4173 --strictPort`. Do not start it as a long-running process from the agent; the Smoke_Test starts it through Playwright's `webServer` in task 5.
    - _Requirements: 7.6, 7.7, 7.10_
  - [x] 4.6 Wire the Web_Build gate, inject its fault, update README, commit
    - `scripts/gates.sh`: `run scripts/web-build.sh` after the Unit_Tests gate.
    - Injection: `truncate -s 26214401 web/public/oversize.bin`; expect `oversize.bin 26214401 bytes > 26214400`, `web-build: step 'check-deploy' failed` and `gate failed: scripts/web-build.sh`. Delete the file, re-run to green, log.
    - From `web/.bundle-report.json`, add every npm package whose code is in `web/dist` to the `README.md` table with resolved version and SPDX license (check each license).
    - One conventional commit for task 4.
    - _Requirements: 1.8, 7.4, 7.5, 10.1, 10.2, 10.5, 10.6, 10.7, 10.8_

- [x] 5. Browser Smoke_Test
  - [x] 5.1 Write the Playwright config and global setup
    - `web/playwright.config.ts`: `channel: 'chrome'`, `workers: 1`, `webServer` running `pnpm run preview` with a 30 s timeout, `timeout`/`globalTimeout` 180 s. `web/tests/smoke/global-setup.ts`: read and parse `fixtures/parity/seedbig-pairwise.replay.json` first (fail with `cannot read fixture seedbig-pairwise.replay.json: <reason>`), then launch Chrome and rethrow a failure as `system Chrome not found (Playwright channel 'chrome'): <message>`. Shared test setup: `context.route('**/*')` aborts and records any non-preview origin; page console errors and `ok: false` replies fail the test with their text. Add the `test:smoke` script.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.10, 9.12, 9.13_
  - [x] 5.2 Write `web/tests/smoke/fixture.spec.ts`
    - On `/?harness=1`, in order: `Content-Type: application/wasm` for the `.wasm` file in `web/dist`; config field equals `fixtures/configs/pairwise.json` and no replay or verify control exists; protocol run (create from the fixture's seed and `JSON.stringify(config)`, submit the 120 inputs in file order as `{tick, payload}`, step 2,000 times, compare every checksum with `checksums[n − 1]`, require exactly 2,000, report the first difference as in the design); no-input reference run of at least 2,000 steps; page controls: Create, Step, tick `1` and reference checksum 1 within 5 s; Speed 365, Run until tick ≥ 365 or 10 s, Pause, tick > 1, unchanged 500 ms later, checksum equals the reference (extend the reference through the harness if needed).
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.6, 5.7, 7.7, 9.5, 9.6, 9.7, 9.8, 9.9, 9.11, 9.13_
  - [x] 5.3 Write `web/tests/smoke/responsive.spec.ts`
    - For each Speed: create a world, run for 10 s, collect main-thread `longtask` entries with `PerformanceObserver`, fail on any entry over 50 ms; also check that the displayed tick changes at least every 250 ms while running.
    - _Requirements: 5.4, 5.5_
  - [x] 5.4 Wire the Smoke_Test gate, inject its fault, commit
    - `scripts/gates.sh`: `run pnpm --dir web run test:smoke` as the last gate. Record the Smoke_Test wall time and confirm it stays under 180 s.
    - Injection: in `fixture.spec.ts`, overwrite the in-memory expected checksum for tick 42 with `0000000000000000` (never edit the fixture file); expect `first difference at tick 42` and `gate failed: pnpm --dir web run test:smoke`. Revert, re-run to green, log.
    - Record in `docs/kiro-log.md` how R9.3 (Chrome missing) was checked, or that it could not be checked on this machine.
    - One conventional commit for task 5.
    - _Requirements: 9.13, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Static Assets configuration
  - [x] 7.1 Add Wrangler and `web/wrangler.jsonc`
    - Add `wrangler` as an exact-version dev dependency (check its license; add it to `README.md`); create `web/wrangler.jsonc` as in the design (`name`, `compatibility_date` set to the implementation date, `assets.directory: "./dist"`, `workers_dev: true`, no `main`, no bindings, no routes). Confirm it is the only Static Assets config in the repository.
    - Validate the config locally only with a command that needs no login and sends no request to Cloudflare (for example `wrangler deploy --dry-run` with `WRANGLER_SEND_METRICS=false`); if no such command exists, skip and log that. Record the added `pnpm install` time and size caused by Wrangler.
    - Gates green; one conventional commit.
    - _Requirements: 1.7, 1.8, 11.1, 12.7_

- [x] 8. GitHub Actions Deploy_Workflow with deploy disabled
  - [x] 8.1 Write `.github/workflows/deploy.yml`
    - As in the design: trigger on push to `main`, `permissions: contents: read`, `concurrency` group `deploy-main` with `cancel-in-progress: false`, `ubuntu-24.04`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, `WRANGLER_SEND_METRICS=false`, `actions/checkout` and `jdx/mise-action` pinned to full commit SHAs (look up the SHAs on the official repositories, tag in a comment), `rustup toolchain install`, `scripts/gates.sh`, the "Check deploy configuration" step (token, account ID and `DEPLOY_ENABLED == 'true'`, otherwise the "Deployment is not configured" message), and the deploy step `pnpm exec wrangler deploy` in `web/` with the two secrets only in that step's environment. No retry step.
    - Do not push, create a remote or set any variable or secret. Check the file against R11.2 to R11.5, R11.7, R11.10 and R11.11 by reading it, and parse it as YAML with a tool already available in the project, if there is one; note the result in `docs/kiro-log.md`.
    - Gates green; one conventional commit.
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.7, 11.10, 11.11_

- [x] 9. Final check
  - [x] 9.1 Run the gates from a clean build
    - Remove `target/`, `web/node_modules/` and `web/dist/` (build output only, no tracked files), then run `scripts/gates.sh` to exit 0 and record the total wall time.
    - _Requirements: 10.3_
  - [x] 9.2 Write `docs/web-shell-audit.md`
    - Same style as `docs/sim-core-skeleton-audit.md`: one row per acceptance criterion of R1 to R12 with status and evidence (test, gate, injection log entry or file). R11.6, R11.8 and R11.9 stay open until task 10; mark them so. List the gaps.
    - _Requirements: all_
  - [x] 9.3 Update the steering files
    - `.kiro/steering/tech.md`: Stack table (Svelte 5 with Vite, pnpm, Cloudflare Workers Static Assets deployed by the Deploy_Workflow from GitHub Actions; no row left undecided) and Quality gates (Type_Check, Unit_Tests, Smoke_Test). `.kiro/steering/structure.md`: `web/` layout, `scripts/web-build.sh`, `web/dist`, `.github/workflows/deploy.yml`, and "Next steps" (this spec done apart from enabling deploy in task 10; spec 3 `llm-probe` next). Log the steering changes.
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 9.4 Update `README.md` and run it from a fresh clone
    - Exact commands from the repository root for: installing the `mise.toml` tools and pnpm dependencies, the Web_Build, Local_Preview, and the Smoke_Test. Final third-party table (R1.8, R12.7) checked against `web/package.json`, the lockfile and `web/.bundle-report.json`. Then clone the repository into a temporary directory and run the four command sequences in order; Local_Preview is checked by the Smoke_Test's `webServer`, not left running. Record the result.
    - _Requirements: 1.8, 12.5, 12.6, 12.7_
  - [x] 9.5 Sync the spec documents with what was built
    - Update `design.md` where the implementation differs (resolved versions, any change to the scripts, gates, harness or workflow) with dated notes, without rewriting history; keep `requirements.md` criteria and add notes only. Run `validate_spec_format` on both files until clean.
    - Gates green; one conventional commit for task 9.
    - _Requirements: all_

- [x] 10. Enable deploy (author approval required at each step)
  - [x] 10.1 Stop and ask before pushing `main`
    - The remote `origin` (`zbf1009/back-in-the-family`, public) already exists; do not create another. Ask the author whether to push `main`, which carries the commits of tasks 1 to 9 and the new workflow. Do nothing until the author approves in that moment. With deploy still disabled, this push only runs the gates in CI; report the run's result and any CI-only difference (for example Chrome or mise behaviour on the runner) and log it.
    - _Requirements: 11.2, 11.4, 11.7, 11.8_
  - [x] 10.2 Stop and ask before secrets; check the token's permissions
    - The author creates the Cloudflare API token (custom token, one account, Account → Workers Scripts → Edit as the starting point, no zone or DNS permissions) and ensures the account has a `workers.dev` subdomain. The design's claim that this permission alone is enough is unverified; say so to the author. With approval, the agent runs `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID` reading the values from the author's input, never echoing them, never writing them to a file or the log.
    - Record the token's permission list as the author reports it (or as shown by a read-only Cloudflare API call, if the author approves) against R11.6.
    - _Requirements: 11.5, 11.6, 11.8_
  - [x] 10.3 Stop and ask before enabling deploy and running the first deploy
    - With approval, set the repository variable `DEPLOY_ENABLED=true` and trigger the first deploy by a push to `main` (approved separately). Watch the run. If the deploy step fails for a missing permission, report the exact error and ask the author to add only the named permission; log it. Do not retry automatically.
    - When it succeeds, record in `docs/kiro-log.md` the `*.workers.dev` URL, the full deployed commit hash and the date, and confirm the page loads at that URL.
    - _Requirements: 11.3, 11.8, 11.9, 11.10_
  - [x] 10.4 Close the audit and commit
    - Update the R11.6, R11.8 and R11.9 rows (and any other R11 row affected) in `docs/web-shell-audit.md` and the "Next steps" in `.kiro/steering/structure.md`; log the final token permissions. One conventional commit; push only with the author's approval.
    - _Requirements: 11.6, 11.8, 11.9, 12.4_

## Task Dependency Graph

Every sub-task depends on the files the previous one left in place (shared `scripts/gates.sh`, `web/package.json`, lockfile, `vite.config.ts`, README, kiro-log), so each is its own wave. No parallel execution.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["2.4"] },
    { "id": 7, "tasks": ["2.5"] },
    { "id": 8, "tasks": ["2.6"] },
    { "id": 9, "tasks": ["2.7"] },
    { "id": 10, "tasks": ["2.8"] },
    { "id": 11, "tasks": ["2.9"] },
    { "id": 12, "tasks": ["2.10"] },
    { "id": 13, "tasks": ["2.11"] },
    { "id": 14, "tasks": ["2.12"] },
    { "id": 15, "tasks": ["2.13"] },
    { "id": 16, "tasks": ["2.14"] },
    { "id": 17, "tasks": ["3.1"] },
    { "id": 18, "tasks": ["3.2"] },
    { "id": 19, "tasks": ["3.3"] },
    { "id": 20, "tasks": ["3.4"] },
    { "id": 21, "tasks": ["3.5"] },
    { "id": 22, "tasks": ["3.6"] },
    { "id": 23, "tasks": ["3.7"] },
    { "id": 24, "tasks": ["3.8"] },
    { "id": 25, "tasks": ["4.1"] },
    { "id": 26, "tasks": ["4.2"] },
    { "id": 27, "tasks": ["4.3"] },
    { "id": 28, "tasks": ["4.4"] },
    { "id": 29, "tasks": ["4.5"] },
    { "id": 30, "tasks": ["4.6"] },
    { "id": 31, "tasks": ["5.1"] },
    { "id": 32, "tasks": ["5.2"] },
    { "id": 33, "tasks": ["5.3"] },
    { "id": 34, "tasks": ["5.4"] },
    { "id": 35, "tasks": ["7.1"] },
    { "id": 36, "tasks": ["8.1"] },
    { "id": 37, "tasks": ["9.1"] },
    { "id": 38, "tasks": ["9.2"] },
    { "id": 39, "tasks": ["9.3"] },
    { "id": 40, "tasks": ["9.4"] },
    { "id": 41, "tasks": ["9.5"] },
    { "id": 42, "tasks": ["10.1"] },
    { "id": 43, "tasks": ["10.2"] },
    { "id": 44, "tasks": ["10.3"] },
    { "id": 45, "tasks": ["10.4"] }
  ]
}
```
