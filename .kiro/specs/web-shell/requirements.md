# Requirements Document

## Introduction

This is spec 2 of Back in the Family. It adds the first browser front end: a minimal page that loads the `sim-wasm` build, runs the simulation in a dedicated Web Worker, and shows the current tick, the latest checksum and the measured ticks per second. It also adds the build that produces the deploy directory, two new gates (type check and a browser smoke test against a native parity fixture), and a GitHub Actions workflow that deploys the deploy directory to Cloudflare Workers Static Assets after the gates pass.

The page is a shell only. Scenes, the LLM adapter, the settings page, the replay gallery, the town view, a snapshot API and any in-page native-vs-WASM verify button are out of scope and belong to later specs. The `sim-wasm` API stays as it is after spec 1: `new WasmSim(seed, config_json)`, `submit(input_json)`, `step()`, `tick()`, `run_ticks(n)`, `verify_replay(json)`.

Author decisions already taken (not open for the design phase): Svelte 5 with Vite; the simulation runs in a dedicated Web Worker; pnpm pinned through `mise.toml` and `packageManager`; `@playwright/test` as a pnpm dev dependency driving the system Chrome (`channel: 'chrome'`) with no browser download; Cloudflare Workers Static Assets (assets only) on a `*.workers.dev` subdomain; deployment from GitHub Actions on push to `main`. Workers Builds was rejected because its build image has no Rust.

### Open points for the design phase

These are deliberately not decided here:

- D-open-1: Wrangler or the `cf` CLI for the deploy step in CI, and the form of the Static Assets configuration (the project has no Wrangler configuration yet).
- D-open-2: the exact pnpm version.
- D-open-3: how the Sim_Worker obtains the URL of the `.wasm` file under Vite (asset import, `new URL(..., import.meta.url)`, or similar), and how `target/wasm-pkg` is made visible to the Vite build.
- D-open-4: where the Deploy_Directory lives (for example `web/dist`) and what the build script is called.
- D-open-5: COOP/COEP headers. Not required by this spec; the design should leave room for spec 3 (`llm-probe`), whose in-browser LLM runtime may need cross-origin isolation.
- D-open-6: how the Smoke_Test reaches the Worker_Protocol inside the built page (for example a test-only entry point or a hook on `window` that exists only in a test build), and how pacing per frame is implemented inside the Sim_Worker.
- D-open-7: the exact list of Speed values beyond the required ones.

Resolved on 2026-11-05 in design.md: the author accepted the recommended options for DA-1 to DA-4.

Note on the Smoke_Test: every Parity_Fixture contains 120 recorded inputs, and the page has no control for submitting inputs. The native comparison (Requirement 9.5) therefore goes through the Worker_Protocol, which can submit inputs. The page-control checks (Requirements 9.8 and 9.9) compare against a no-input reference run made in the same Sim_Worker, which is anchored to native results only indirectly.

## Glossary

- **Web_App**: the Svelte 5 + Vite TypeScript application in `web/`, consisting of the Main_Thread code and the Sim_Worker.
- **Main_Thread**: the page's JavaScript running on the browser's main thread. It renders state and sends requests; it holds no simulation.
- **Sim_Worker**: the dedicated Web Worker that loads Sim_Wasm and owns the single live `WasmSim` instance.
- **Sim_Wasm**: the wasm-bindgen output of `crates/sim-wasm` produced by `scripts/wasm-build.sh` in `target/wasm-pkg` (`--target web`).
- **Worker_Protocol**: the typed set of messages exchanged between the Main_Thread and the Sim_Worker, defined in one TypeScript module shared by both sides.
- **Seed**: the world seed, an unsigned 64-bit integer (0 to 18,446,744,073,709,551,615), entered and transported as a decimal string and passed to Sim_Wasm as a `BigInt`.
- **World_Config**: the JSON text in the `ReplayConfig` shape accepted by `new WasmSim` (for example `{"entity_count":50,"workload":"Pairwise"}`).
- **Checksum**: the 16-character lowercase hexadecimal string returned by `WasmSim.step()` or `WasmSim.run_ticks(n)`.
- **Speed**: the number of ticks the Sim_Worker runs per Frame while running; a positive integer chosen from a fixed list.
- **Frame**: one display refresh interval of the browser (about 16.7 ms at 60 Hz).
- **Run_State**: one of `no-world`, `paused`, `running`, `failed`.
- **Ticks_Per_Second**: the number of ticks the Sim_Worker completed during the most recent 1,000 ms of wall-clock time while running, shown as an integer.
- **Sim_Error**: an error raised by Sim_Wasm (constructor, `submit`, or WASM loading) or an uncaught error in the Sim_Worker.
- **Web_Build**: the script that runs `scripts/wasm-build.sh`, then builds the Web_App, and writes the result to the Deploy_Directory.
- **Deploy_Directory**: the directory produced by the Web_Build that holds every file that is deployed, and nothing else.
- **Size_Limit**: 26,214,400 bytes (25 MiB), the maximum size of any single deployed file.
- **Local_Preview**: a command that serves the Deploy_Directory over HTTP on the developer's machine without contacting Cloudflare.
- **Parity_Fixture**: a native-recorded replay file in `fixtures/parity/` (seed, config, inputs, and the checksum of every tick).
- **Smoke_Test**: the `@playwright/test` browser test that runs against the Deploy_Directory served by Local_Preview, using the system Chrome.
- **Type_Check**: the TypeScript and Svelte type check of the Web_App (for example `svelte-check`).
- **Unit_Tests**: the web unit and property tests of the Web_App (run with Node's test runner and fast-check), run by the Gates_Script as their own gate.
- **Gates_Script**: `scripts/gates.sh`.
- **Deploy_Workflow**: the GitHub Actions workflow that runs the Gates_Script and then deploys the Deploy_Directory.
- **Cloudflare_Target**: a Cloudflare Worker with Static Assets only (no Worker script), served on a `*.workers.dev` subdomain.
- **Author**: the project owner, who approves deploys, secrets, remotes and pushes.

## Requirements

### Requirement 1: Web app skeleton

**User Story:** As the developer, I want a Svelte 5 + Vite TypeScript app in `web/` with pinned tooling, so that later specs (scenes, chronicle, settings, replay gallery) build on a working, reproducible front end.

#### Acceptance Criteria

1. THE Web_App SHALL live in `web/`, declare `svelte` with major version 5 and `vite` as dependencies in `web/package.json`, and write all Main_Thread and Sim_Worker source code as TypeScript (`.ts` files, or `.svelte` files whose script blocks declare `lang="ts"`).
2. THE repository SHALL pin pnpm to one exact version (a full `major.minor.patch` version with no range or tag) in `mise.toml` and in the `packageManager` field of `web/package.json`, with the same version in both places.
3. IF the pnpm version is missing from `mise.toml`, is missing from the `packageManager` field, or differs between the two, THEN THE Gates_Script SHALL exit with a non-zero status before installing any Web_App dependency, and SHALL print the value found in each place (or an indication that it is missing).
4. THE repository SHALL commit the pnpm lockfile for the Web_App.
5. THE Gates_Script SHALL install Web_App dependencies with a frozen lockfile, so that the install neither resolves new versions nor rewrites the lockfile.
6. IF the committed pnpm lockfile does not match the dependencies declared in `web/package.json`, THEN THE Gates_Script SHALL exit with a non-zero status, leave the lockfile unchanged, and print an error indicating that the lockfile is out of date.
7. THE Web_App setup SHALL obtain every tool invoked by the Gates_Script, the Web_Build, Local_Preview and the Smoke_Test from one of these sources only: `mise.toml`, `rust-toolchain.toml`, a pnpm dependency or dev dependency declared in `web/package.json`, or the system Chrome used by the Smoke_Test. The setup SHALL perform no global package install (no `npm install -g`, `pnpm add -g` or equivalent), and no browser download.
8. THE `README.md` SHALL list every direct dependency and dev dependency in `web/package.json`, and every npm package (direct or transitive) whose code is included in the Deploy_Directory. Each entry SHALL give the version resolved in the committed lockfile and the license as an SPDX identifier.

### Requirement 2: Simulation runs in a dedicated Web Worker

**User Story:** As the developer, I want the simulation to run in a dedicated Web Worker from the start, so that the page stays responsive while fast-forwarding and the final game's architecture is in place.

#### Acceptance Criteria

1. THE Sim_Worker SHALL load Sim_Wasm and own the only `WasmSim` instance of the page, so that at most one `WasmSim` instance exists in the page at any time.
2. THE Main_Thread SHALL interact with the simulation only by sending Worker_Protocol messages to the Sim_Worker and rendering the replies.
3. THE Main_Thread bundle SHALL contain no import of Sim_Wasm, and THE Main_Thread SHALL make no request for the Sim_Wasm `.wasm` file.
4. THE Worker_Protocol SHALL define every request and reply as a member of a TypeScript discriminated union in one module imported by both the Main_Thread and the Sim_Worker.
5. THE Worker_Protocol SHALL carry Seed values and tick values as decimal strings, and Checksum values as 16-character lowercase hexadecimal strings. Before the first tick of a world has run, the Checksum SHALL be reported as absent.
6. THE Worker_Protocol SHALL provide requests to create a world, run, pause, step once, set the Speed, and submit one input in the `input_json` shape accepted by `WasmSim.submit`.
7. WHEN the Sim_Worker finishes handling a request, THE Sim_Worker SHALL send exactly one reply for that request, in the order the requests were received. The reply SHALL report either success with the Run_State, the current tick and the latest Checksum, or failure with the Sim_Error text.
8. IF Sim_Wasm fails to load in the Sim_Worker, THEN THE Sim_Worker SHALL send a reply containing the load error text, and THE Main_Thread SHALL display that text and set the Run_State to `failed`.
9. IF the Sim_Worker raises an uncaught error, THEN THE Main_Thread SHALL display the error text and set the Run_State to `failed`.
10. IF a create-world request carries a Seed that is not a decimal integer from 0 to 18,446,744,073,709,551,615, or the `WasmSim` constructor or `WasmSim.submit` raises a Sim_Error, THEN THE Sim_Worker SHALL send a failure reply containing the error text and SHALL leave the existing `WasmSim` instance (if any), its tick, its latest Checksum and the Run_State unchanged.
11. IF a run, pause, step-once, set-Speed or submit request arrives while the Run_State is `no-world`, THEN THE Sim_Worker SHALL send a failure reply indicating that no world exists, and SHALL leave the Run_State at `no-world` without creating a `WasmSim` instance.
12. WHILE the Run_State is `running`, THE Sim_Worker SHALL send a status reply with the current tick, the latest Checksum and Ticks_Per_Second at least once per 1,000 ms of wall-clock time.

### Requirement 3: Create a world from a seed and a config

**User Story:** As the developer, I want to create a world from any u64 seed and a world config on the page, so that I can see the simulation start from known inputs, including seeds above 2^53.

#### Acceptance Criteria

1. WHEN the page finishes loading, THE Web_App SHALL show a seed field and a World_Config field, with the World_Config field prefilled with text identical to the content of `fixtures/configs/pairwise.json`.
2. WHEN the developer submits a seed field value that contains only the characters `0` to `9`, has at least one character and has a decimal value from 0 to 18,446,744,073,709,551,615, THE Main_Thread SHALL send one create-world request to the Sim_Worker. The request SHALL carry the Seed as the decimal string exactly as entered and the World_Config field text unchanged. The Main_Thread SHALL NOT parse or validate the World_Config text itself.
3. IF the submitted seed field value is empty, contains any character other than `0` to `9` (including whitespace, a sign, a decimal point or an exponent), or has a decimal value above 18,446,744,073,709,551,615, THEN THE Main_Thread SHALL display a validation message that names which of these three problems occurred, send no create-world request, and leave the current world, Run_State, tick and Checksum display unchanged.
4. WHEN the Sim_Worker receives a create-world request, THE Sim_Worker SHALL construct `WasmSim` with the Seed converted to a `BigInt` directly from its decimal string, with no intermediate JavaScript `number`, and with the World_Config text unchanged. As a result, a Seed of 18,446,744,073,709,551,615 or 9,007,199,254,740,993 reaches Sim_Wasm with that exact value.
5. WHEN the Sim_Worker reports that a create-world request succeeded, THE Web_App SHALL set the Run_State to `paused`, display tick 0, and display no Checksum, clearing any Checksum shown for a previous world.
6. IF `new WasmSim` raises a Sim_Error, including for an empty or malformed World_Config text, THEN THE Web_App SHALL display the Sim_Error text. It SHALL also keep the previous world, Run_State, displayed tick and displayed Checksum unchanged, and SHALL keep the Run_State `no-world` if no world existed before.
7. WHEN a create-world request succeeds while a world exists, THE Sim_Worker SHALL stop running and run no further ticks of the previous world. It SHALL replace the previous world with the new world, and after that it SHALL report tick and Checksum values only for the new world.
8. WHILE a create-world request has been sent and the Sim_Worker has not yet reported success or a Sim_Error for it, THE Main_Thread SHALL send no further create-world request.

### Requirement 4: Run, pause, step and speed

**User Story:** As the developer, I want to run, pause, single-step and change speed, so that I can watch the tick and checksum advance at a pace I choose.

#### Acceptance Criteria

1. WHILE the Run_State is `paused`, WHEN the developer activates the step control, THE Sim_Worker SHALL run exactly one tick, and THE Web_App SHALL display tick N+1 and the Checksum of tick N+1, where N is the tick displayed before the activation, and keep the Run_State `paused`.
2. WHILE the Run_State is `paused`, WHEN the developer activates the run control, THE Web_App SHALL set the Run_State to `running` and THE Sim_Worker SHALL start running ticks from the tick displayed at activation.
3. WHILE the Run_State is `running`, THE Sim_Worker SHALL run ticks in batches of exactly Speed ticks, with at most one batch started per Frame and no partial batch.
4. THE Web_App SHALL offer the Speed as a selection from a fixed list of positive integers that contains at least 1, 7, 30 and 365 ticks per Frame, with 1 selected when the page loads, and SHALL offer no way to enter a value outside that list.
5. WHEN the Sim_Worker receives a set-Speed request with a value from the Speed list, in any Run_State, THE Sim_Worker SHALL finish any batch in progress at the previous Speed and use the new Speed for every batch that starts afterwards, and SHALL keep that Speed across pause, run and world creation until the next set-Speed request.
6. WHILE the Run_State is `running`, WHEN the developer activates the pause control, THE Sim_Worker SHALL start no new batch after receiving the pause request and SHALL finish running ticks within 200 ms of the activation, and THE Web_App SHALL set the Run_State to `paused` and display the tick and Checksum of the last completed tick, which SHALL stay unchanged while the Run_State remains `paused` and no step control is activated.
7. WHILE the Run_State is `no-world` or `failed`, THE Web_App SHALL disable the run, pause and step controls.
8. WHILE the Run_State is `running`, THE Web_App SHALL disable the run and step controls and enable the pause control.
9. WHILE the Run_State is `paused`, THE Web_App SHALL enable the run and step controls and disable the pause control.
10. WHEN the developer activates the step control, THE Web_App SHALL keep the step control disabled until the Sim_Worker reply for that step request arrives.
11. IF the Sim_Worker receives a set-Speed request whose value is not a positive integer in the Speed list, THEN THE Sim_Worker SHALL reply with a Sim_Error message and keep the previous Speed, tick and Run_State unchanged.

### Requirement 5: Status display

**User Story:** As the developer, I want the page to show the tick, the checksum and the measured speed, so that I can confirm the simulation advances and how fast it runs in the browser.

#### Acceptance Criteria

1. THE Web_App SHALL display four status fields at all times: the current tick as a decimal integer with no separators, the latest Checksum as exactly 16 lowercase hexadecimal characters, the Run_State as one of `no-world`, `paused`, `running` or `failed`, and Ticks_Per_Second as a non-negative decimal integer, except where criteria 2, 3 and 6 call for a dash.
2. WHILE the Run_State is `no-world`, THE Web_App SHALL display a dash in place of the tick and the Checksum.
3. WHEN a world has been created and no tick has been stepped yet, THE Web_App SHALL display the tick as `0` and a dash in place of the Checksum.
4. WHILE the Run_State is `running`, THE Web_App SHALL update the displayed tick, Checksum and Ticks_Per_Second at least once every 250 ms, and each displayed tick and Checksum pair SHALL belong to the same completed tick of the Sim_Worker.
5. WHILE the Run_State is `running`, at every Speed in the fixed list, THE Main_Thread SHALL keep processing input events, and no single Main_Thread task caused by the Web_App SHALL last longer than 50 ms during a continuous running period of at least 10 s.
6. WHILE the Run_State is not `running`, or fewer than 1,000 ms have passed since the Run_State last became `running`, THE Web_App SHALL display Ticks_Per_Second as a dash instead of a number.
7. WHEN the Run_State changes from `running` to `paused`, THE Web_App SHALL, within 250 ms, display the tick and Checksum of the last tick the Sim_Worker completed, and SHALL leave them unchanged until the next request that changes the world.
8. WHEN a Sim_Error occurs, THE Web_App SHALL display the Sim_Error text in an error area. The area SHALL stay visible until the Sim_Worker completes the next Worker_Protocol request without a Sim_Error, and SHALL then be cleared.
9. IF a Sim_Error occurs, THEN THE Web_App SHALL keep the tick and Checksum that were displayed before the error unchanged, and SHALL NOT display a tick or Checksum that the Sim_Worker did not complete.

### Requirement 6: Determinism boundary

**User Story:** As the developer, I want the web layer to touch the simulation only through the WASM API, so that browser timing can never change simulation results.

#### Acceptance Criteria

1. THE Sim_Worker SHALL change simulation state only by calling `new WasmSim`, `WasmSim.submit`, `WasmSim.step` and `WasmSim.run_ticks`. Its only other calls on a `WasmSim` instance SHALL be the read-only `WasmSim.tick()`.
2. THE Main_Thread SHALL NOT load Sim_Wasm, hold a `WasmSim` instance, or call any Sim_Wasm function. It SHALL reach the simulation only by sending Worker_Protocol messages to the Sim_Worker.
3. WHEN the Sim_Worker calls Sim_Wasm, THE Sim_Worker SHALL pass the Seed as a `BigInt` in the range 0 to 18,446,744,073,709,551,615, each tick count passed to `WasmSim.run_ticks` as an integer from 0 to 4,294,967,295, the World_Config as a JSON string, and each input as an `input_json` string. It SHALL pass no other arguments.
4. IF a Seed or tick count received over the Worker_Protocol is not an integer within the range given in criterion 3, THEN THE Sim_Worker SHALL reject the request without calling Sim_Wasm, leave the simulation state and tick unchanged, and reply over the Worker_Protocol with an error indicating which value was invalid.
5. THE Web_App SHALL use wall-clock time only for Frame pacing and for computing Ticks_Per_Second. No value derived from wall-clock time or from a browser random source SHALL be included in any argument passed to Sim_Wasm.
6. FOR ALL Seeds, World_Configs, input sequences submitted through the Worker_Protocol, and sequences of run, pause, step and Speed changes, THE Checksum the Web_App displays or reports over the Worker_Protocol for tick N SHALL equal the Checksum of tick N in a reference run. The reference run uses the same Seed, World_Config and inputs (each submitted before the same tick) and calls `WasmSim.step()` once per tick (speed independence).

### Requirement 7: Build and deploy directory

**User Story:** As the developer, I want one script that builds the WASM and the web app into a deploy directory with every file checked against the size limit, so that what I deploy is exactly what was built and checked (closing audit deviation R7.3 for the deployed files).

#### Acceptance Criteria

1. WHEN the developer runs the Web_Build, THE Web_Build SHALL run `scripts/wasm-build.sh` to completion before it starts building the Web_App into the Deploy_Directory.
2. WHEN the Web_Build starts writing the Deploy_Directory, THE Web_Build SHALL first remove every file and subdirectory left in the Deploy_Directory by any earlier run, so that a file placed there before the run is absent afterwards.
3. WHEN the Web_Build finishes successfully, THE Deploy_Directory SHALL contain the Sim_Wasm `.wasm` file used by the Sim_Worker, byte-identical to the `.wasm` file that `scripts/wasm-build.sh` produced in the same run, together with its JavaScript glue.
4. WHEN the Web_App build finishes, THE Web_Build SHALL compare the size in bytes of every file in the Deploy_Directory, including files at any subdirectory depth, against the Size_Limit, where a file of exactly 26,214,400 bytes is within the limit.
5. IF any file in the Deploy_Directory is larger than 26,214,400 bytes, THEN THE Web_Build SHALL print the path relative to the Deploy_Directory and the size in bytes of every such file, and exit with a non-zero status.
6. WHEN the developer runs the Local_Preview, THE Local_Preview SHALL serve the files of the Deploy_Directory over HTTP on the developer's machine without rebuilding or modifying them and without sending any network request to Cloudflare.
7. WHEN Local_Preview serves a `.wasm` file, THE Local_Preview SHALL send the `Content-Type` header `application/wasm`.
8. IF `scripts/wasm-build.sh` or the Web_App build exits with a non-zero status, THEN THE Web_Build SHALL stop without running the size check and exit with a non-zero status that names which step failed.
9. WHEN every file in the Deploy_Directory is at or below the Size_Limit, THE Web_Build SHALL exit with status zero.
10. IF the Deploy_Directory does not exist or contains no files when the Local_Preview starts, THEN THE Local_Preview SHALL exit with a non-zero status and a message saying that the Web_Build must be run first.

### Requirement 8: Type check gate

**User Story:** As the developer, I want a type check of all TypeScript and Svelte code in the gates, so that type errors fail the build (tech.md quality gate).

#### Acceptance Criteria

1. THE Gates_Script SHALL run the Type_Check over every first-party `.ts` and `.svelte` file of the Web_App, including the Main_Thread code, the Worker_Protocol, the Sim_Worker, the Smoke_Test and any TypeScript build or test configuration files. Third-party dependencies and the generated Sim_Wasm output are the only files excluded.
2. IF the Type_Check reports one or more errors, THEN THE Gates_Script SHALL exit with a non-zero status, SHALL NOT report the gates as passed, and SHALL leave the Type_Check output, with the file and line of each error, in its console output.
3. WHEN the Type_Check reports zero errors, THE Gates_Script SHALL continue with its remaining gates. Type_Check warnings alone SHALL NOT change the exit status.
4. THE Type_Check SHALL check the Web_App against the TypeScript declarations that wasm-bindgen generated for Sim_Wasm in the same Gates_Script run. A call to a `WasmSim` member whose argument types do not match those declarations, such as a Seed passed as a `number` instead of a `BigInt`, SHALL be reported as a Type_Check error.
5. IF the Sim_Wasm TypeScript declarations are absent when the Type_Check runs, THEN THE Type_Check SHALL fail with an error indicating that the declarations are missing, and SHALL NOT treat Sim_Wasm as untyped.

### Requirement 9: Browser smoke test against a native fixture

**User Story:** As the developer, I want an automated browser test that runs the built page in Chrome and compares the worker's checksums with a native-recorded fixture, so that the deployed bundle is shown to load the WASM in a worker and to match native results.

#### Acceptance Criteria

1. THE Smoke_Test SHALL use `@playwright/test` as a pnpm dev dependency of `web/` and launch the system Chrome through `channel: 'chrome'`.
2. THE Web_App setup and the Gates_Script SHALL complete without running a Playwright browser install step and without downloading any browser binary.
3. IF the system Chrome is not installed, THEN THE Smoke_Test SHALL fail with a non-zero exit status and a message stating that the system Chrome was not found.
4. THE Smoke_Test SHALL load the page only from the Deploy_Directory served by Local_Preview, and SHALL make no request to Cloudflare.
5. WHEN the Smoke_Test runs, THE Smoke_Test SHALL create a world in the Sim_Worker from the Seed and World_Config of `fixtures/parity/seedbig-pairwise.replay.json`, submit each of the fixture's recorded inputs through the Worker_Protocol for the tick recorded with it, run as many ticks as the fixture records (2,000), and compare the Checksum of every one of those ticks with the fixture's Checksum for the same tick.
6. IF any tick's Checksum differs from the Parity_Fixture, or the Sim_Worker returns fewer Checksums than the fixture records, THEN THE Smoke_Test SHALL fail and report the fixture file name, the first differing or missing tick, the expected Checksum and the actual Checksum (or that it is missing).
7. WHEN the Smoke_Test runs, THE Smoke_Test SHALL record a reference run with no inputs, before the page-control checks of criteria 8 and 9, by creating a world through the Worker_Protocol from the fixture's Seed and World_Config and stepping one tick at a time for at least 2,000 ticks.
8. WHEN the Smoke_Test runs, THE Smoke_Test SHALL use the page controls to create a world from the fixture's Seed and World_Config, activate the step control once, and check that within 5 seconds the page displays tick 1 and the reference run's Checksum for tick 1.
9. WHEN the Smoke_Test runs, THE Smoke_Test SHALL use the page controls to run at Speed 365 until the displayed tick is at least 365 or 10 seconds have passed, then pause, and check that the displayed tick is greater than 1, that the displayed tick and Checksum are unchanged when read again 500 ms later, and that the displayed Checksum equals the reference run's Checksum for that tick (the reference run is extended if the tick reached is beyond its end).
10. IF a Sim_Error is reported during the Smoke_Test, THEN THE Smoke_Test SHALL fail and print the Sim_Error text.
11. THE Web_App SHALL offer no visible page control that runs a native-vs-WASM or replay verification.
12. IF the Parity_Fixture file is missing or cannot be parsed, THEN THE Smoke_Test SHALL fail before opening the page and report the fixture file name and that it could not be read.
13. IF Local_Preview does not serve the page within 30 seconds, or any Worker_Protocol request gets no reply within 30 seconds, or the whole Smoke_Test runs longer than 180 seconds, THEN THE Smoke_Test SHALL fail and name the step that timed out.

### Requirement 10: Gate wiring and fault injection

**User Story:** As the developer, I want the new checks in `scripts/gates.sh` and each shown to fail once, so that the gates guard what they claim to guard (tech.md rule).

#### Acceptance Criteria

1. WHEN the Gates_Script is run, THE Gates_Script SHALL run the new gates after all existing Rust gates and the existing `sim-cli batch` step, in this order: the pnpm version check, the frozen-lockfile install, the Type_Check, the Unit_Tests, the Web_Build (including the check that no file in the Deploy_Directory exceeds the Size_Limit), and the Smoke_Test.
2. IF any gate run by the Gates_Script exits with a non-zero status, THEN THE Gates_Script SHALL run no later gate, SHALL print the name of the failing gate, and SHALL exit with a non-zero status.
3. WHEN every gate run by the Gates_Script passes, THE Gates_Script SHALL exit with status 0.
4. IF a tool needed by a new gate is unavailable (the pnpm executable, or the system Chrome used by the Smoke_Test), THEN THE Gates_Script SHALL report that gate as failed and exit with a non-zero status, and SHALL NOT skip the gate or report it as passed.
5. THE implementation SHALL show each new gate failing once by injecting the fault that gate guards against, one fault at a time: a type error in Web_App source for the Type_Check; a failing property or unit assertion in Web_App code for the Unit_Tests; a file larger than 26,214,400 bytes in the Deploy_Directory for the size check; an expected Checksum that differs from the Parity_Fixture value for the Smoke_Test; and a pnpm version in `packageManager` that differs from the one pinned in `mise.toml` for the pnpm version check.
6. WHEN a fault is injected, THE implementation SHALL run the full Gates_Script and observe that it exits with a non-zero status and names the gate that the injection targets.
7. WHEN a fault injection has been shown, THE implementation SHALL revert the injection so that no injected fault remains in any commit, and SHALL re-run the full Gates_Script to an exit status of 0.
8. WHEN a fault injection has been shown and reverted, THE implementation SHALL add an entry to `docs/kiro-log.md` at that time (not backfilled) that records the date, the gate, the injected fault, an excerpt of the observed failure output, the revert, and the result of the passing re-run.

### Requirement 11: Deploy to Cloudflare from GitHub Actions

**User Story:** As the Author, I want pushes to `main` to run the full gates in GitHub Actions and deploy the deploy directory to Cloudflare Workers Static Assets only when the gates pass, so that the public demo always matches a green build.

#### Acceptance Criteria

1. THE repository SHALL contain exactly one Static Assets configuration for the Cloudflare_Target, which names the Deploy_Directory as the assets directory and defines no Worker script entry point.
2. WHEN a commit is pushed to `main`, THE Deploy_Workflow SHALL check out that commit, install the toolchain versions pinned in `rust-toolchain.toml` and `mise.toml` (without upgrading any of them), and then run the Gates_Script.
3. WHEN the Gates_Script exits with status 0 in a Deploy_Workflow run triggered by a push to `main`, THE Deploy_Workflow SHALL deploy to the Cloudflare_Target the same Deploy_Directory that the Gates_Script built and checked in that run, without rebuilding it.
4. IF the Gates_Script exits with a non-zero status in the Deploy_Workflow, THEN THE Deploy_Workflow SHALL skip the deploy step and finish the run with a failed status, and the Cloudflare_Target SHALL keep serving the previously deployed version.
5. THE Deploy_Workflow SHALL read the Cloudflare API token and account ID only from GitHub Actions secrets, and SHALL NOT write either value to the repository, the Deploy_Directory, or the workflow log in unmasked form.
6. THE Cloudflare API token SHALL be limited to the one Cloudflare account that hosts the Cloudflare_Target and SHALL hold only the permissions that the chosen deploy tool documents as required to deploy a Worker with Static Assets, with no zone-level or DNS permissions.
7. IF the Cloudflare API token secret or the account ID secret is missing or empty, THEN THE Deploy_Workflow SHALL run the Gates_Script, skip the deploy step, print a log message stating that deployment is not configured, and finish with a status that reflects only the Gates_Script result.
8. THE implementation SHALL obtain the Author's explicit approval before each of these actions: creating a git remote, pushing, creating GitHub secrets, enabling the Deploy_Workflow's deploy step, and running the first deploy.
9. WHEN the first deploy finishes successfully, THE implementation SHALL record in `docs/kiro-log.md` the `*.workers.dev` URL, the full commit hash that was deployed, and the date of the deploy.
10. IF the deploy step fails after the Gates_Script has passed, THEN THE Deploy_Workflow SHALL finish the run with a failed status and SHALL NOT retry automatically, and the Cloudflare_Target SHALL keep serving the previously deployed version.
11. WHILE a Deploy_Workflow run for an earlier commit on `main` is in its deploy step, THE Deploy_Workflow SHALL NOT start a deploy step for a later commit until the earlier one finishes, so that after all runs finish the Cloudflare_Target serves the Deploy_Directory of the latest pushed commit whose Gates_Script passed.

### Requirement 12: Documentation and steering updates

**User Story:** As the developer, I want the steering files and README to reflect what this spec built, so that later specs start from accurate project facts.

#### Acceptance Criteria

1. WHEN the last implementation task of this spec is marked complete, THE implementation SHALL have updated `.kiro/steering/tech.md` so that its Stack table names Svelte 5 with Vite as the frontend framework, pnpm as the package manager, and Cloudflare Workers Static Assets deployed by the Deploy_Workflow from GitHub Actions as the hosting path, and so that no row still describes the frontend framework or the hosting choice as undecided.
2. WHEN the last implementation task of this spec is marked complete, THE implementation SHALL have updated the Quality gates section of `.kiro/steering/tech.md` to list the Type_Check, the Unit_Tests and the Smoke_Test as gates run by the Gates_Script.
3. WHEN the last implementation task of this spec is marked complete, THE implementation SHALL have updated `.kiro/steering/structure.md` so that it shows the layout of `web/` (Main_Thread code, Sim_Worker, Worker_Protocol module, Smoke_Test), the Web_Build script, the Deploy_Directory and the Deploy_Workflow, using the names and locations chosen in the design phase.
4. WHEN the last implementation task of this spec is marked complete, THE implementation SHALL have updated the "Next steps" section of `.kiro/steering/structure.md` to state that this spec is done and that spec 3 (`llm-probe`) is next.
5. THE `README.md` SHALL contain, for each of these four tasks, the exact shell commands to run from the repository root: installing the pinned tools from `mise.toml` and the pnpm dependencies, running the Web_Build, starting Local_Preview, and running the Smoke_Test.
6. WHEN a tester runs the four README command sequences in order on a fresh clone with the system Chrome installed, THE commands SHALL complete without error, produce the Deploy_Directory, serve it through Local_Preview without contacting Cloudflare, and end with a passing Smoke_Test.
7. THE `README.md` SHALL list every third-party library or tool this spec adds as a direct dependency (at minimum Svelte, Vite, `@playwright/test`, pnpm, and the deploy CLI chosen in the design phase), each with its license name.
