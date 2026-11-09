# Implementation Plan: llm-probe

## Overview

The plan builds the probe in three stages and only then measures.

1. Offline foundations (tasks 1 to 14). The Rust LLM boundary in `sim_core::llm` comes first: strict JSON reader, Card parser, Output_Validator, Grader, Prompt_Renderer with permutations, and the JSON API, each with its `proptest` properties. Then the `sim-wasm` exports and the native/wasm32 grading parity fixture, then the TypeScript Probe_Runner package `eval/probe/` (Manifest_Check, card loading, Results / ledger / budget / approvals storage with redaction, statistics, phase gate, report generator) with its `fast-check` properties, the new gates and their fault injections, and finally the Adapter_Interface, timing state machine, fallback chain and run flow against a fake Runtime. Every one of these tasks ends with `scripts/gates.sh` green and one local conventional commit.
2. Real Runtimes (tasks 15 to 17). The Pre-run verification task (V1 to V8) is placed before the real adapters so that V8 (re-read WebLLM at the `v0.2.87` tag) happens before the WebLLM adapter is written; its other sub-tasks run later, at the points the dependency graph gives. Then the WebLLM and transformers.js adapters with the Probe_Page and the Playwright driver, then the Workers AI adapter and the Smoke_Call command.
3. Measurement (tasks 18 to 26). Each step has an explicit STOP-AND-ASK point: the agent does nothing for that step until the Author approves it in the conversation at that moment. Budget approval, screening and VRAM_Preflight, Dev_Runs with template tuning on Dev_Cards and the template freeze, the Phase_1 Locked_Runs (one approval per Combination), the Phase_1 checkpoint and Phase_2 decision, Phase_2, the Report, the Author's runtime decision with the steering update, and the final audit with the push.

Requirement 19 (added 2026-11-09, tasks 27 to 38) adds the two Workers AI Decision_Models and the External_Reference ingest. Its tasks are numbered after 26 but run before 25.1 completes, 25.2 and 26, and after 25.3 (see the graph); the Decision_Model Dev_Runs and Locked_Runs each wait for the Author's own named approval.

Requirement 20 (added 2026-11-09, tasks 39 to 50) registers two Decision_Variants per Decision_Model (`single` and `perm_avg`). Its implementation tasks 39 to 44 are numbered last but run right after 33.3 and before 34.1 completes, because R20.1 freezes the variant registry and the Aggregation_Hash from the first Decision_Model Dev_Run result. The derive runs (tasks 45 to 48) follow the single Dev_Runs and Locked_Runs, each under its own approval; RC-20 (task 50) stays open until the Author answers.

Model runs are never part of the gates. The gates stay offline: no network, no GPU, no `env` file, no Workers AI request (R16.4, R16.5).

## Notes

Execution notes for the orchestrator:
- Before task 1, commit the spec documents (`requirements.md`, `design.md`, `tasks.md`, `.config.kiro`) and the pending `docs/kiro-log.md` entries in one `docs(llm-probe)` commit.
- Tasks and sub-tasks run one at a time in the order of the "Task Dependency Graph" at the end. That order is the numeric order except for task 15 (Pre-run verification), whose sub-tasks are scheduled at the points where each item can be checked (see the graph and the "Runs" line of each sub-task). Most tasks edit shared files (`scripts/gates.sh`, `eval/probe/package.json`, its lockfile, `README.md`, `docs/kiro-log.md`, `eval/results/ledger.jsonl`), so nothing runs in parallel.
- Delegate each coding task to the `spec-task-execution` sub-agent with `requirements.md`, `design.md` and `.kiro/steering/*.md` in context.
- Fault injections (R16.6, R16.7): inject one fault in the working tree, run the full `scripts/gates.sh`, show it exits non-zero and prints `gate failed: <command>` for the targeted gate, revert, re-run to exit 0, and append the `docs/kiro-log.md` entry right then (date, gate, fault, failure excerpt, revert, passing re-run). No injected fault may remain in any commit. Never inject a fault by editing, creating or deleting a file under `eval/cards/` (R16.10).
- `git diff 091d1d7 -- eval/cards` must be empty at every commit (R17.7). Check it before each commit.
- Locked cards: the agent never opens `eval/cards/cards/locked.jsonl`, `eval/cards/review/locked.md`, `eval/cards/blind/*` or the root `env` file. Only the Probe_Runner reads `locked.jsonl`, and only inside a Locked_Run (prompts) or `ingest` / `regrade` / `report` (grading only) (R3.1). Gates, unit tests and the VRAM_Preflight use `dev.jsonl` only. During a Locked_Run, the agent passes on only progress counts, aggregate Metrics, Card IDs and error messages (R3.11).
- `docs/kiro-log.md` is append-only (R17.4, R17.5): log spec iterations, gate fault injections, Locked_Run start and end (R17.6), surprises and agent misses as they happen. Never backfill.
- Approvals (R17.1 to R17.3): ask the Author first, naming the action and its target, before any push (a push to `main` deploys, so ask for a deploy approval naming the commit), deploy, global install, remote resource, or Workers AI request beyond the Smoke_Calls allowed by the count (10 per UTC day). Entries in `eval/probe/approvals.json` are added only in a commit made after the Author approved that action in the conversation (DA-14, R11.20).
- Machine markers: **[Target_Machine]** means the task needs the Author's laptop (RTX 3050 Ti Laptop GPU, Intel UHD iGPU, system Chrome 155) and downloads model weights or uses the GPU. **[headed Chrome]** applies only if headless WebGPU with the Headless_Launch_Flags stops returning a hardware adapter (C3 second branch); then the Author runs the Probe_Page by hand. Tasks without a marker run on any machine and offline.
- Dependencies are project-local with exact versions (no ranges, no global installs, no `playwright install`, no browser download). Each new direct dependency gets a `README.md` row with name, version resolved in the lockfile and SPDX license, checked on the registry (R16.8).
- Property tests: Rust Properties 1 to 15 use `proptest` with at least the default 256 cases, in `crates/sim-core/tests/llm_properties.rs` (Property 15 in `crates/sim-wasm/tests/`), each tagged `// Feature: llm-probe, Property N: <title>`. Rust Properties 41 (mapping render) and 42 (Raw_Choice mode) are in `crates/sim-core/tests/llm_properties.rs`. TypeScript Properties 16 to 40 and 43 to 48 use `fast-check` with `numRuns: 200` under `node:test` in `eval/probe/tests/unit/`, with the same tag. Every property test is required: they run in the gates, several are demanded by the requirements (R2.10, R4.10, R5.15, R7.5, R12.6), and several are fault-injection targets.
- Optional sub-tasks (`*`): 6.8 and 16.13, plus 36.1 to 36.3 (the optional S candidate, only if the Author keeps one). 6.8 and 16.13 are extras whose behaviour is already demonstrated elsewhere.
- `fixtures/grading/dev-golden.json` is regenerated only on purpose with `scripts/regen-grading-golden.sh`, and the commit message says so. `fixtures/parity/` is never regenerated by this spec (R6.9).
- This spec changes no hosting configuration: `web/wrangler.jsonc` and `.github/workflows/deploy.yml` stay unchanged, and no Worker script is deployed (R11.1).

## Tasks

- [x] 1. `sim_core::llm` foundations: types, strict JSON reader and Card parser
  - [x] 1.1 Create the `llm` module skeleton and its types
    - `crates/sim-core/src/llm/{mod.rs, context.rs, key.rs}` with the types of the design (`PersonId`, `EventId`, `OptionId`, `Task`, `OutputSchema`, `FrozenContext`, `TaskSpec`, `Verdict`, `IllegalReason`, `SynthesisAnswer` and item structs, `AnswerKey`, `Pattern`, `PatternValue`, `Scalar`, `SevereCondition` in the stated `Ord`, `Grade`, `IdentityValue`, `ContrastDecision`). `FrozenContext` holds no answer-key field.
    - Module-level `deny` for `clippy::unwrap_used`, `clippy::expect_used`, `clippy::panic`, `clippy::indexing_slicing`; `BTreeMap`/`BTreeSet` or sorted `Vec` only; no float, clock, environment, randomness or I/O. Confirm `tests/source_guard.rs` scans the new files.
    - _Requirements: 4.1, 4.9, 5.1_
  - [x] 1.2 Write the strict JSON reader and canonical writer (`json.rs`)
    - Explicit-stack reader: input limit 1,048,576 bytes (`ParseFailure`, detail `too_large`), nesting limit 64 (`too_deep`), number lexemes kept (`-?(0|[1-9][0-9]*)` in `i64` for integer fields, `NonInteger` for fraction or exponent, `IntegerOutOfRange` outside `i64`), duplicate keys rejected (`duplicate_key`). Canonical writer: keys in byte order, no insignificant whitespace, minimal escapes, shortest integers.
    - Example tests in `crates/sim-core/tests/llm_examples.rs`: a 1 MiB input, 10,000 levels of `[`, a duplicate key, `1.0`, `1e2`, `99999999999999999999`.
    - _Requirements: 4.8, 4.12, 4.14, 6.6_
  - [x] 1.3 Write the Card parser (`card.rs`)
    - Split one card line into `(CardMeta, FrozenContext, AnswerKey, Option<Contrast>)`; `CardMeta` (`id`, `scenario_group`, `split`, `scored`, `author_note`) never reaches rendering or validation. Integer-only numeric fields; a non-integer number is a parse failure naming the line. Unknown severe conditions or pattern fields outside the family schema are an `answer_key` error (R5.11). Structural checks: 2 to 5 unique options for D, events sorted by tick.
    - _Requirements: 2.3, 2.9, 2.10, 4.9, 5.11_
  - [x] 1.4 Write the shared `proptest` generators
    - In `crates/sim-core/tests/llm_properties.rs` (or a helper module it includes): Frozen_Contexts and answer keys from the card schema (2 to 5 options, 1 to 12 people, 0 to 12 events with random same-tick blocks, optional fields `null`, absent or empty, `due_tick` present or absent), legal D and S answers built from a context, and the Dev_Cards loaded from `eval/cards/cards/dev.jsonl` (read only) as seeds.
    - _Requirements: 2.10, 5.15_
  - [x] 1.5 Write property test for the Card parser
    - **Property 1: Card parse round trip and integer-only numbers**
    - **Validates: Requirements 2.3, 2.9, 2.10**
  - [x] 1.6 Gates green and commit
    - Run `scripts/gates.sh` to exit 0; one conventional commit for task 1 (for example `feat(sim-core): add llm module types, strict JSON reader and card parser`).
    - _Requirements: 16.9_

- [x] 2. Output_Validator
  - [x] 2.1 Write the answer types and extraction (`answer.rs`)
    - Typed S items per schema and their canonical serialization; the DA-5 B extraction (strip ASCII whitespace, at most one Markdown fence `` ``` `` or `` ```json ``, then exactly one JSON value).
    - _Requirements: 4.2, 4.3, 4.10_
  - [x] 2.2 Write the Output_Validator (`validate.rs`)
    - D: card-independent schema first (object with only `option`, a string; otherwise `MissingRequiredField`, `UnknownField` or `WrongType` with path), then membership (`OutOfSetOption`); never assumed from decoding constraints. S: every check of R4.3 with the reason codes of R4.6 and the field path of the first failure; sorted, deduplicated missing-person and missing-event lists (person fields `from`, `to`, `debtor`, `creditor`, `transferred_from`, `promisor`, `promisee`, `a`, `b`; event fields `evidence`, `origin_event`, `promise_event`, `turning_point`). A `timeout` or `error` outcome maps to Illegal `Timeout` or `RuntimeError`, and `{"kind":"error","code":"parse_failure","detail":"non_text_response"}` to Illegal `ParseFailure`.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.11, 4.13, 4.14, 4.15, 8.5, 11.18_
  - [x] 2.3 Write property test for legal answers
    - **Property 2: Answers built from the context are legal**
    - **Validates: Requirements 4.2, 4.3, 4.11**
  - [x] 2.4 Write property test for single injected faults
    - **Property 3: One injected fault gives its own reason code and path**
    - **Validates: Requirements 4.4, 4.5, 4.6, 4.12, 4.14, 4.15**
  - [x] 2.5 Write property test for missing-reference lists
    - **Property 4: Missing-reference lists are exact**
    - **Validates: Requirements 4.7**
  - [x] 2.6 Write property test for totality and determinism
    - **Property 5: The validator is total and deterministic**
    - Include inputs of at least 1,048,576 bytes and at least 10,000 nesting levels.
    - **Validates: Requirements 4.8, 4.13, 5.2, 6.6**
  - [x] 2.7 Write property test for the S round trip
    - **Property 6: Canonical round trip of S answers**
    - **Validates: Requirements 4.10**
  - [x] 2.8 Write the validator example tests and the forbidden-literal scan, then commit
    - `llm_examples.rs`: one test per reason code (including `wrong_type`, `wrong_schema_const`, `integer_out_of_range` for a value below a schema `minimum`, `malformed_event_id` in an `evidence` entry); a test that scans every file under `crates/sim-core/src/llm/` and `crates/sim-wasm/src/` for the literals `"author_note"`, `"severe_patterns"` (quoted forms) and `llm-probe-`, and fails on any match.
    - Gates green; one conventional commit for task 2.
    - _Requirements: 3.13, 4.6, 4.15_

- [x] 3. Grader, Identity_Value and contrast decision
  - [x] 3.1 Write the Grader (`grade.rs`)
    - Pattern_Match (scalar equal, list "one of", `evidence_any` non-empty intersection, `relationship_shift_v1` tried with `a`/`b` swapped); D and Illegal grades; S acceptable from `must_include` / `must_not_include`; Automatic_Severe from the missing lists and the two person fields per schema; Pattern_Severe from `severe_patterns`; each condition only if listed in `severe_conditions`, once each, in `SevereCondition` order; canonical identity tuples (`relationship_shift_v1` as `(min(a,b), max(a,b), direction, turning_point)`) in a set; contrast decision with Illegal in neither subset.
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_
  - [x] 3.2 Write property test for D and Illegal grades
    - **Property 7: D and Illegal grades follow set membership**
    - **Validates: Requirements 5.3, 5.4, 8.5**
  - [x] 3.3 Write property test for S grades against a reference model
    - **Property 8: S grades agree with a reference model**
    - Required: this property is the target of the fault injection in 3.8.
    - **Validates: Requirements 5.5, 5.6, 5.7, 5.8, 5.11**
  - [x] 3.4 Write property test for order invariance
    - **Property 9: Order of items and evidence does not matter**
    - **Validates: Requirements 5.10, 5.12**
  - [x] 3.5 Write property test for contrast decisions
    - **Property 10: Contrast decisions follow the expected subsets**
    - **Validates: Requirements 5.9, 13.3**
  - [x] 3.6 Write property test for gold answers on every Dev_Card
    - **Property 11: Gold answers grade as acceptable on every Dev_Card**
    - **Validates: Requirements 5.13, 5.14**
  - [x] 3.7 Write the README grading examples
    - In `llm_examples.rs`: hand-built cards for each grading rule of `eval/cards/README.md`, including a `relationship_shift_v1` pattern matching only with `a`/`b` swapped, an item matching no pattern, and an answer-key error naming the card and the faulty entry.
    - _Requirements: 5.5, 5.6, 5.7, 5.11_
  - [x] 3.8 Fault injection for the Output_Validator and Grader tests, then commit
    - Inject: the Grader ignores `must_not_include`. The full gates must fail with a Property 8 counterexample and `gate failed: cargo test --workspace`. Revert, re-run to green, log in `docs/kiro-log.md`.
    - One conventional commit for task 3.
    - _Requirements: 5.15, 16.1, 16.3, 16.6, 16.7_

- [x] 4. Prompt rendering, permutations and the JSON API
  - [x] 4.1 Write the Prompt_Renderer and permutations (`render.rs`)
    - `render(ctx, template, schema_text, perm)`: `[system]` and `[user]` sections; placeholders `{{tick}}`, `{{situation}}`, `{{people}}`, `{{relations}}`, `{{events}}`, `{{options}}`, `{{player_input}}`, `{{subject}}`, `{{schema}}`; fixed block lines as in the design, `, due day N` for events with a `due_tick`; `none` for `null`, absent or empty `player_input`, `subject`, `relations`; structural render errors only, naming the Card ID and reason; IDs printed exactly as stored; `RENDERER_VERSION = 2`.
    - Permutations: candidates `reversed`, `rotated_1`, `rotated_2` with left rotation `xs[k..] ++ xs[..k]`, applied to same-tick blocks for S, duplicates of the base or an earlier kept candidate dropped; Sanity_Cards get base only.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.9, 7.10, 7.11_
  - [x] 4.2 Write property test for context-only prompts
    - **Property 12: Prompts depend only on the Frozen_Context**
    - **Validates: Requirements 4.9, 7.1, 7.2**
  - [x] 4.3 Write property test for permutation rules
    - **Property 13: Permutations follow the fixed rules**
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.8**
  - [x] 4.4 Write property test for verbatim IDs, tick and due days
    - **Property 14: Every ID, the tick and every due day appear verbatim in the prompt**
    - **Validates: Requirements 7.6, 7.9, 7.10, 7.11**
  - [x] 4.5 Write the JSON-in / JSON-out API (`api.rs`) and commit
    - Plain-Rust functions for `llm_parse_card`, `llm_permutations`, `llm_render_prompt`, `llm_validate`, `llm_grade`, `llm_identity`, `llm_contrast` with the input and result shapes of the design table, the `{"ok":true,…}` / `{"ok":false,"error":{"kind":"input"|"card"|"answer_key"|"render","message"}}` envelope, `random_baseline_parts` for D, and canonical JSON output. Error strings name answer-key fields bare.
    - Example test: the canonical JSON of each function's result for one Dev_Card.
    - Gates green; one conventional commit for task 4.
    - _Requirements: 6.1, 6.6, 6.7, 3.13_

- [x] 5. `sim-wasm` exports and the grading parity fixture
  - [x] 5.1 Write the `sim-wasm` exports
    - `crates/sim-wasm/src/llm.rs`: one `#[wasm_bindgen]` function per `api.rs` function, taking and returning one JSON string, never throwing. Existing exports (`WasmSim`, `submit`, `step`, `tick`, `run_ticks`, `verify_replay`) unchanged.
    - _Requirements: 6.1, 6.7, 6.9_
  - [x] 5.2 Write property test for bad input to the exports
    - **Property 15: Exports survive bad input**
    - In `crates/sim-wasm/tests/`, run natively and on wasm32 (the existing `cargo test -p sim-wasm --target wasm32-unknown-unknown` step).
    - **Validates: Requirements 6.7**
  - [x] 5.3 Write the synthetic grading fixtures and the regeneration script
    - A deterministic generator (location chosen at implementation, for example a `sim-cli` subcommand; log the choice) writes `fixtures/grading/dev-outputs.json`: for every Dev_Card, valid outputs from its acceptable options and gold patterns and Illegal outputs from a fixed list of mutations, at least one of each per card. No model output. `scripts/regen-grading-golden.sh` writes `fixtures/grading/dev-golden.json` (expected bytes of every export result) on purpose only.
    - _Requirements: 6.4_
  - [x] 5.4 Write the native and wasm32 grading parity test
    - `crates/sim-wasm/tests/llm_parity.rs`: every Dev_Card × fixture output × export must equal the golden bytes, natively under `cargo test --workspace` and on wasm32; a failure names the Card ID and the export.
    - _Requirements: 4.13, 6.4, 6.5_
  - [x] 5.5 Check the game build and the existing gates
    - Record the new `sim_wasm_bg.wasm` size against the Size_Limit (and against the 232 KB before this spec); confirm `fixtures/parity/` and the Smoke_Test files are unchanged (`git diff --stat`) and the existing parity tests and Smoke_Test pass; confirm the deploy-directory checks pass. Note the size in `docs/kiro-log.md`.
    - _Requirements: 6.8, 6.9, 10.8, 10.9, 16.9_
  - [x] 5.6 Fault injection for the grading parity test, then commit
    - Inject: change one byte of one expected verdict in `fixtures/grading/dev-golden.json`. The full gates must fail at `cargo test --workspace` with a message naming the Card ID and the export. With the injection still in place, also run `cargo test -p sim-wasm --target wasm32-unknown-unknown` alone and confirm it fails the same way. Revert, re-run the gates to green, log.
    - One conventional commit for task 5.
    - _Requirements: 6.5, 16.1, 16.3, 16.6, 16.7_

- [x] 6. Probe_Runner package `eval/probe/` and its first gates
  - [x] 6.1 Create the package
    - `eval/probe/package.json` (`"type": "module"`, `"packageManager": "pnpm@10.33.1"`, exact dev dependencies needed now: `typescript`, `@types/node`, `fast-check`; WebLLM, transformers.js, Vite and Playwright come in task 16), `pnpm install` once to create `eval/probe/pnpm-lock.yaml`, `tsconfig.node.json` (`erasableSyntaxOnly`, `noEmit`, paths to `target/wasm-pkg/sim_wasm.d.ts`), scripts `probe` (`node src/cli.ts`), `typecheck`, `test:unit` (`node --test tests/unit/`).
    - `.gitignore`: add `eval/results/budget/` and `eval/results/bundles/`; confirm `eval/probe/node_modules` and `eval/probe/dist` are covered.
    - `README.md`: one row per new direct dependency (version from the lockfile, SPDX license checked on the registry).
    - _Requirements: 16.8, 1.5_
  - [x] 6.2 Extend the pnpm pin check and add the probe frozen install gate
    - `scripts/check-pnpm-version.sh` also compares `eval/probe/package.json` `packageManager` with `mise.toml` and names the file on a mismatch. `scripts/gates.sh`: after `mise exec -- pnpm --dir web install --frozen-lockfile`, add `run mise exec -- pnpm --dir eval/probe install --frozen-lockfile`.
    - _Requirements: 16.1, 16.9_
  - [x] 6.3 Write `simwasm.ts`
    - Load `target/wasm-pkg/sim_wasm_bg.wasm` with the glue's `initSync({ module })`; one wrapper per `llm_*` export that passes and returns JSON text unchanged; a thrown `WebAssembly.RuntimeError` stops the run with exit status 2 naming the export and Card ID; expose the `.wasm` sha256 for the Model_Fingerprint. No validation or grading logic in TypeScript.
    - _Requirements: 6.2, 6.3_
  - [x] 6.4 Write the TS-side grading parity test
    - `eval/probe/tests/unit/parity.test.ts`: every case of `fixtures/grading/dev-golden.json` through `simwasm.ts` returns the golden bytes.
    - _Requirements: 6.2, 6.4_
  - [x] 6.5 Wire the Probe Type_Check and Unit_Tests gates
    - `typecheck` runs `tsc -p tsconfig.node.json` (task 16 adds `tsconfig.page.json`) against `target/wasm-pkg/sim_wasm.d.ts`. `scripts/gates.sh`: `run mise exec -- pnpm --dir eval/probe run typecheck` and then `run mise exec -- pnpm --dir eval/probe run test:unit`, after the probe install (task 7 inserts the Manifest_Check between the install and the Type_Check).
    - The Unit_Tests gate's fault injection is done in task 9.12 (Wilson `z` set to 1.0, the fault named in the design).
    - _Requirements: 16.1_
  - [x] 6.6 Fault injections for the pnpm pin check and the probe frozen install
    - pnpm pin: set `eval/probe/package.json` `packageManager` to `pnpm@10.33.0`; expect the check to name the file and `gate failed: scripts/check-pnpm-version.sh`. Revert, green, log.
    - Frozen install: add a dependency to `eval/probe/package.json` without updating the lockfile; expect `gate failed: mise exec -- pnpm --dir eval/probe install --frozen-lockfile` and an unchanged lockfile. Revert, green, log.
    - _Requirements: 16.3, 16.6, 16.7_
  - [x] 6.7 Fault injection for the Probe Type_Check, then commit
    - Inject: assign a string to a `number`-typed field in a first-party file (the design names `latencyMs`, which does not exist until task 12; use a number field in `simwasm.ts` and say which in the log). Expect a `tsc` error and `gate failed: mise exec -- pnpm --dir eval/probe run typecheck`. Revert, green, log.
    - One conventional commit for task 6.
    - _Requirements: 16.1, 16.3, 16.6, 16.7_
  - [ ]* 6.8 Write a unit test for the extended `check-pnpm-version.sh`
    - Run the script against temporary copies with a missing, different and range value in `eval/probe/package.json`; check exit status and printed file name. Optional: the injection in 6.6 already shows the behaviour.
    - _Requirements: 16.1_

- [x] 7. Manifest_Check and card loading
  - [x] 7.1 Write `manifest.ts` and the CLI skeleton
    - One exported constant `PINNED_MANIFEST_HASH` (the 64-hex value appears once in all Probe_Runner and Gates_Script source). Check: Manifest sha256 against the constant; every line `64 lowercase hex + path` (else line numbers); absolute or escaping paths are failures and are not read; every listed file hashed (all mismatches, missing and unreadable files listed); output only paths and hashes, never content; pass line with the hash and the file count (27). Files opened read-only.
    - `src/cli.ts` with `check-manifest`; every command that touches cards runs the Manifest_Check first and never reuses an earlier outcome; failures print `probe: manifest: …` and exit non-zero before any Results, ledger write or request. `check-manifest` imports nothing that reads `env`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_
  - [x] 7.2 Write property test for the Manifest_Check
    - **Property 16: The Manifest_Check reports exactly the faults**
    - Runs on temporary copies of the Card_Set outside `eval/cards/`, with a random marker written into each copied file; also check that the copy's bytes are unchanged after a run.
    - **Validates: Requirements 1.2, 1.3, 1.5, 1.7, 1.8, 1.9, 1.10, 16.10**
  - [x] 7.3 Write `cards.ts`
    - Load a split through `llm_parse_card`; check the four counts against the "Contents" table of `eval/cards/LOCK.md` (print split, count name, expected, actual); report the 1-based line and the Card ID when present on a parse failure; detect duplicate IDs within and across splits with both line numbers; read the "Voided cards" table (`none` row → zero Void_Cards; missing table, malformed row or unknown ID → exit). A Dev_Run loads `dev.jsonl` only.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2_
  - [x] 7.4 Write property test for card loading
    - **Property 17: Card loading finds duplicates and reads the void table**
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7**
  - [x] 7.5 Write the card-loading example test
    - Loading the real dev split gives 34 cards, 18 scored D, 12 scored S, 4 sanity and zero Void_Cards. Unit tests never load the locked split.
    - _Requirements: 2.1, 2.5_
  - [x] 7.6 Wire the Manifest_Check gate, inject its fault, commit
    - `scripts/gates.sh`: `run mise exec -- pnpm --dir eval/probe run probe check-manifest` right after the probe frozen install.
    - Injection: change one hex digit of `PINNED_MANIFEST_HASH`; expect `probe: manifest:` with the expected and actual hash and `gate failed: mise exec -- pnpm --dir eval/probe run probe check-manifest`. Revert, green, log. Confirm `git diff --stat 091d1d7 -- eval/cards` is empty.
    - One conventional commit for task 7.
    - _Requirements: 1.4, 1.6, 16.1, 16.3, 16.6, 16.7, 16.10, 17.7_

- [x] 8. Results, ledger, budget and approvals storage with redaction
  - [x] 8.1 Write `sink.ts`, `redact.ts` and `env.ts`
    - `env.ts` reads only the root `env` file, only when a Workers AI Combination starts; parses `KEY=value` lines without echoing; returns the token and account ID as opaque values whose `toString()`/`toJSON()` give `[redacted]`; a missing file, missing or empty variable exits non-zero naming only the file or variable. `redact.ts` replaces both secret strings with `[redacted]`. `sink.ts` is the only writer to files and console streams; every writer goes through it.
    - _Requirements: 11.2, 11.3, 11.4_
  - [x] 8.2 Write property test for redaction
    - **Property 27: The token and account ID never leave `env.ts` unredacted**
    - Uses fake outcome sequences and remote error texts that echo the account ID inside a URL; task 17.3 extends it with the real Workers AI adapter on a fake `fetch`. Uses a fake env reader; never reads the real `env`.
    - **Validates: Requirements 11.3, 11.4**
  - [x] 8.3 Write `results.ts`
    - Results files under `eval/results/dev/` and `eval/results/locked/`, one file per run, never shared between splits, append-only; header line `llm-probe-results-header-v1` (run, split, Combination, Model_Key, `task_subset`, fingerprint, template hashes, Timeout, placement); `llm-probe-result-v1` records with the outcome kinds `text`, `timeout`, `error`, `engine_fault`, `not_run` (reasons `budget`, `not_approved`, `render_error`, `load_failed`, `oom`, `rebuild_failed`), `late`, `usage`, `source`; raw text stored byte for byte; grades file lines (`llm-probe-grade-v1`, `llm-probe-contrast-v1`, `llm-probe-excluded-v1`); reader that rejects records without a `schema` starting with `llm-probe-` and stops on the first failing record naming the file, leaving it unchanged. Writers for failures, exclusions, smoke, perf and preflight records use the same schema rule.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 2.8_
  - [x] 8.4 Write property test for the Results round trip
    - **Property 32: Results records round trip byte-exact**
    - **Validates: Requirements 12.1, 12.2, 12.4, 12.10, 12.11**
  - [x] 8.5 Write `ledger.ts`
    - Append-only events (`start`, `abort`, `resume`, `complete`) in `eval/results/ledger.jsonl` with `fsync` on `start`; derived status; the once-only overlap set `O` keyed on the Model_Key (template hashes, sampling parameters and Combination ID play no part), `rerun_of` and `overlaps`; resume planning (Card × Permutations without an output record; `not_run` and `engine_fault` count as missing) and the resume check (Model_Key, fingerprint ID, template hashes); `complete` only when every planned Card × Permutation has an output record; the entry the Report uses per Model_Key and Task_Type (earliest-started `complete` entry covering it).
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 18.5_
  - [x] 8.6 Write property test for the ledger
    - **Property 24: The ledger is append-only and resumes the complement**
    - **Validates: Requirements 3.5, 3.7, 3.9, 12.8**
  - [x] 8.7 Write `budget.ts`
    - Counter `eval/results/budget/workers-ai.json` (`llm-probe-budget-v1`, per UTC day `requests`, `smoke`, `neurons`); unreadable or unparsable (including a missing or non-integer `neurons`) → exit before any request, file untouched; before each request: per-run cap 410, daily cap 600, smoke 10 per day, `BigInt` neuron estimate `ceil(((bytes + 256) × in + max_out × out) / 1,000,000)`, Neuron_Cap 9,000 (refuse this and every later request that UTC day); one atomic write (temp file, `fsync`, rename) before sending; after a response with usage, replace the estimate by the usage-based cost (reasoning tokens added when larger than `completion_tokens`); refusal messages name the cap and value.
    - _Requirements: 11.5, 11.6, 11.11, 11.12, 11.13, 11.14, 11.17_
  - [x] 8.8 Write property test and examples for the budget
    - **Property 28: Budget accounting is exact**
    - Plus the example: a counter file with a missing `neurons` field is refused and left byte-identical.
    - **Validates: Requirements 11.5, 11.6, 11.11, 11.12, 11.13, 11.14**
  - [x] 8.9 Write `approvals.ts` and commit
    - `git status --porcelain -- eval/probe/approvals.json` must print nothing and the content comes from `git show HEAD:eval/probe/approvals.json`, both through `execFile` with fixed arguments; any failure means not approved, with the reason printed. Create `eval/probe/approvals.json` with an empty `approvals` list (`llm-probe-approvals-v1`).
    - Unit tests on a temporary git repository in four states: committed and clean → accepted; modified, staged, untracked → not approved.
    - Gates green; one conventional commit for task 8.
    - _Requirements: 11.8, 11.20_

- [x] 9. Metrics and statistics
  - [x] 9.1 Write `metrics.ts`
    - Per Combination and Task_Type over base outputs of non-void Scored_Cards: acceptable rate and illegal rate with the full denominator (every non-void Scored_Card of the Task_Type, output or not), severe count, flip rate (Illegal permutation flips unless the base is `invalid`), contrast consistency with both counts, Random_Baseline from the cards only, integer Threshold tests, zero denominator → not computable and not passing, `excluded` list, Sanity_Cards apart, "quality without timeout" figures with the same denominators, `engine_fault` and `rebuild_failed` records outside every numerator.
    - _Requirements: 2.8, 8.5, 8.13, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.10, 13.12_
  - [x] 9.2 Write `stats.ts`
    - Wilson 95% interval; SplitMix64 (`BigInt`, seed 20261104) cluster bootstrap over scenario groups and pair bootstrap over Contrast_Pairs, 10,000 resamples, resample values kept as exact fractions, nearest-rank bounds at indices 249 and 9,749; weak-evidence labels by integer cross-multiplication; intra-group correlation (one-way ANOVA estimator, "not estimable" cases); latency p50/p95 with index `floor((p·n + 99) / 100) − 1` over `text` outcomes only, plus covered, timeout and error counts and "no data".
    - _Requirements: 13.7, 13.8, 13.9, 14.1, 14.2, 14.3_
  - [x] 9.3 Write property test for void and sanity cards
    - **Property 18: Void and sanity cards never move a Metric**
    - **Validates: Requirements 2.8, 13.10**
  - [x] 9.4 Write property test for Metric definitions
    - **Property 19: Metrics match their definitions**
    - **Validates: Requirements 8.5, 13.1, 13.2, 13.3, 13.5, 13.12**
  - [x] 9.5 Write property test for integer Thresholds and labels
    - **Property 20: Thresholds compare integers exactly**
    - **Validates: Requirements 13.4, 13.9**
  - [x] 9.6 Write property test for intervals
    - **Property 21: Intervals are well formed and reproducible**
    - **Validates: Requirements 13.7, 13.8**
  - [x] 9.7 Write property test for the Random_Baseline
    - **Property 22: The Random_Baseline depends only on the cards**
    - **Validates: Requirements 13.6**
  - [x] 9.8 Write property test for latency percentiles
    - **Property 23: Latency percentiles use returned text only**
    - **Validates: Requirements 14.1, 14.2, 14.3**
  - [x] 9.9 Write the Wilson and Metric example tests
    - Wilson 8 of 10 ≈ [0.4902, 0.9433], 0 of 10 lower 0, 10 of 10 upper 1, each within 0.0005; hand-computed Metrics with an Illegal output, a Void_Card, a Sanity_Card and a zero denominator.
    - _Requirements: 13.11_
  - [x] 9.10 Write the percentile and label example tests
    - Percentiles for n = 60 (indices 29 and 56) and n = 10,000 (4,999 and 9,499) on hand-built lists; labels at a lower bound exactly at the Threshold ("pass"), exactly 10 points under ("pass (interval overlaps threshold)") and one resample step more than 10 points under ("pass with weak evidence").
    - _Requirements: 13.13_
  - [x] 9.11 Write the dev Random_Baseline example test
    - The dev split's Random_Baseline equals 55.6% as recorded in `LOCK.md`.
    - _Requirements: 13.6_
  - [x] 9.12 Fault injection for the Probe Unit_Tests, then commit
    - Inject: Wilson `z` set to 1.0. Expect the Wilson example test to fail and `gate failed: mise exec -- pnpm --dir eval/probe run test:unit`. Revert, green, log.
    - One conventional commit for task 9.
    - _Requirements: 16.1, 16.3, 16.6, 16.7_

- [x] 10. Phase gate and Report generator
  - [x] 10.1 Write `phase.ts` and the `phase-status` and `ledger` commands
    - `allowWorkersAi(kind, combo, task_subset, state)` and `browserPass(combo, task, state)` from the ledger, `failures.jsonl`, `exclusions.jsonl`, smoke shape checks, `combinations.json` and approvals from `HEAD`: Phase_1 ends when every `phase1_locked` Combination has a `complete` D-and-S entry, a failure record or an Exclusion_Record; Phase_1 and branch A allow Smoke_Calls only; branch B allows `dev` and `locked` only for the one model and the failing Task_Type_Subset named in the `phase2` entry, with a matching `dev` or `locked` approval and an `ok` Response_Shape check; a branch recomputed differently from the `phase2` entry refuses every non-smoke run naming both values. `phase-status` prints per Task_Type the pass result with ledger entry IDs and the branch that follows; `ledger` lists entries with subset and derived status.
    - Example tests: `phase-status` on fixture ledgers for both branches and with an Exclusion_Record. (Property 38 is written in task 13, once `run.ts` exists.)
    - _Requirements: 9.17, 11.8, 11.19, 18.1, 18.2, 18.3, 18.4_
  - [x] 10.2 Write `report.ts` and the `report` command
    - Writes `docs/llm-probe.md` through `sink.ts` with the eleven sections of the design in order, the "Dev_Run figures (not used for the recommendation)" section and the "quality without timeout" section. Reads `locked.jsonl` only for grading and statistics (`llm_parse_card`, `llm_grade`, `llm_identity`, `llm_contrast`; never `llm_render_prompt` on a locked card) and emits no card content other than Card IDs, `pair_id`s and scenario group IDs. Uses the same `browserPass` as `phase.ts`.
    - _Requirements: 3.1, 3.8, 9.2, 9.3, 9.10, 9.11, 9.17, 10.10, 13.9, 13.10, 13.12, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.10, 15.11, 15.12, 18.6, 18.7, 18.8_
  - [x] 10.3 Write property test for support marks
    - **Property 37: Support marks follow completed passing runs**
    - **Validates: Requirements 3.8, 9.17, 15.4, 15.5, 18.6**
  - [x] 10.4 Write the Report example tests, then commit
    - Against a fixture ledger and fixture Results: Phase_2 branch and approval date; "not measured (browser passed)" with Smoke_Call counts; LFM line as custom, not OSI, accepted 2026-11-06; `Qwen3.5-2B-ONNX` citing the base model's license; NVIDIA and Intel memory in separate columns with the Intel quantity named; "not pure-WebGPU results" note on a CPU-flagged Combination; the "Risks" line only when a CPU-flagged Combination is recommended; rebuild-failure and `runtime_stuck` entries in section 10; re-runs listed as "re-run, not used"; Rules_Default alone when nothing passes.
    - Gates green; one conventional commit for task 10.
    - _Requirements: 3.8, 14.7, 15.4, 15.5, 15.6, 15.7, 15.11, 15.12, 18.6, 18.8_

- [x] 11. Deploy_Directory leak checks and the `web/`-imports-`eval/` gate
  - [x] 11.1 Extend `web/scripts/check-deploy.ts` with checks 4 and 5
    - Check 4 (token reference): any file in `web/dist` containing `WORKERS_AI_TOKEN` or `api.cloudflare.com`. Check 5 (Card and Results markers): `"author_note"`, `"severe_patterns"` or `llm-probe-`. Each prints every matching path; both run after the existing checks. Confirm the current `web/dist`, including the game's `.wasm` with the `llm_*` exports, passes.
    - _Requirements: 3.13, 11.10, 16.2_
  - [x] 11.2 Write `check-web-imports.ts` and the `check-web-imports` command
    - Scan every `.ts`, `.js`, `.svelte`, `.html` and config file under `web/` (excluding `web/node_modules` and `web/dist`) for `import … from`, `export … from`, `import(…)` and `new URL(…, import.meta.url)` specifiers; strip any `?query`; resolve relative and root-relative paths; fail on any path under `<repo>/eval/`, printing the importing file and the imported path. Imports nothing that reads `env`.
    - _Requirements: 3.16_
  - [x] 11.3 Write property test for the leak checks
    - **Property 35: The deploy leak checks find every marker and every `eval/` import**
    - The Deploy_Directory half lives in `web/tests/unit/check-deploy.test.ts` next to the web-shell Property 10, because `check-deploy.ts` is in `web/`; the import half in `eval/probe/tests/unit/`. Record this placement for the design sync in task 26.5.
    - **Validates: Requirements 3.13, 3.16, 11.10, 16.2**
  - [x] 11.4 Wire the import gate and run the leak-check fault injections
    - `scripts/gates.sh`: `run mise exec -- pnpm --dir eval/probe run probe check-web-imports` after the Probe Unit_Tests.
    - Injection 1 (R16.11): add `import cardsReadme from '../../../eval/cards/README.md?raw';` to a file under `web/src/`; expect the importing file and imported path and `gate failed: mise exec -- pnpm --dir eval/probe run probe check-web-imports`. Revert, green, log.
    - Injections 2 to 4, one full gates run each: `web/public/leak.txt` containing `WORKERS_AI_TOKEN`; then one containing `"author_note"`; then one containing `llm-probe-result-v1`. Each expects the path, `web-build: step 'check-deploy' failed` and `gate failed: scripts/web-build.sh`. Delete, green, log each.
    - _Requirements: 3.13, 3.16, 11.10, 16.1, 16.2, 16.3, 16.6, 16.7, 16.11_
  - [x] 11.5 Confirm unchanged web behaviour, then commit
    - The existing Smoke_Test files and the parity fixture checksums are unchanged and pass; the game page has no control that opens the Probe_Page.
    - One conventional commit for task 11.
    - _Requirements: 10.7, 10.9, 16.9_

- [x] 12. Adapter_Interface, timing state machine and fallback chain (fake Runtime)
  - [x] 12.1 Write `adapters/interface.ts` and `adapters/fake.ts`
    - The design's types (`Prompt`, `OutputConstraint`, `SamplingParams`, `RequestOptions`, `AdapterErrorCode`, `Usage`, `LateAnswer`, `AdapterResult`, `RuntimeIdentity`, `RuntimeAdapter`), transport-neutral; identity fields `unknown` when not determinable. `fake.ts`: a scriptable fake engine (completion time, tokens per second, interrupt behaviour, idle delay, create and warm-up failures) and a fake clock.
    - _Requirements: 8.1, 8.10, 8.11_
  - [x] 12.2 Write `adapters/timing.ts`
    - The timing state machine: Timeout result within 500 ms of `t0 + T` from a racing timer, never that request's text; Late_Answer if complete by `t0 + T + 60 s`; interrupt at the Generation_Cap; `none (idle_cap)` and state `stuck` at `t0 + T + 90 s`; `runtime_stuck` refusals until rebuild; next request only when idle; latency `Math.ceil` of `performance.now()` differences from `t0`.
    - _Requirements: 8.1, 8.2, 8.12, 8.13_
  - [x] 12.3 Write property test for timing
    - **Property 29: Timeouts are prompt and final; late answers follow the caps**
    - **Validates: Requirements 8.1, 8.2, 8.12, 8.13, 9.12, 12.10**
  - [x] 12.4 Write `chain.ts`
    - Links `[inBrowser, server, rulesDefault]`; each text result goes through `llm_validate`; stop at the first non-Illegal verdict; record the producing link and `{ link, kind, code? }` for every tried link; the Rules_Default returns a caller-supplied default.
    - _Requirements: 8.7, 8.8_
  - [x] 12.5 Write property test for the fallback chain
    - **Property 31: The fallback chain stops at the first valid link**
    - **Validates: Requirements 8.7, 8.8**
  - [x] 12.6 Write the adapter and chain example tests, then commit
    - With a fake Runtime and no network: a Timeout, an error, Illegal output text, a Runtime that cannot accept a request, a valid answer from each of the first two links, all model links failing and the Rules_Default used; an engine create and a rebuild each send the D and S Warm_Up_Prompts before the first Card prompt, and the Results writer receives no record for them.
    - Gates green; one conventional commit for task 12.
    - _Requirements: 8.6, 8.9, 9.12, 9.13_

- [x] 13. Run flow, ingest and re-grade (fake Runtime)
  - [x] 13.1 Write the initial Prompt_Templates, Warm_Up_Prompts and `combinations.json`
    - `eval/probe/templates/decision.v1.txt` and `synthesis.v1.txt` (both with `Today is day {{tick}}.`; D asks for `{"option":"<id>"}`, S for the family object), `eval/probe/warmup/decision.txt` and `synthesis.txt` (a short invented scene whose IDs are not in the Card_Set), Template_Hash and warm-up hashes as sha256 of the exact bytes.
    - **Template content rules (Author steering, 2026-11-07).** Both templates' system text SHALL state these facts, and a unit test SHALL check that each statement is present in the committed template files: (1) relation direction: `#1 -> #2 ... tags parent` means #2 is #1's parent, not the other way round (tags say what the `to` person is to the `from` person; `from` is the person who feels it); (2) `magnitude` units: dollars for money events, joss paper sheet counts for offerings, intensity 1 to 100 for social events; (3) for underworld officials `alive` means in office, not living; (4) one tick is one day, the current day is `{{tick}}`; (5) event actor order: lender before borrower, promisor before promisee (other event types follow `eval/cards/README.md` "Event"). Verified against `eval/cards/README.md` lines 79, 101, 112-113 before recording. Task 20 tunes wording on Dev_Cards only and must keep all five statements.
    - `eval/probe/combinations.json` with the five NVIDIA in-browser Combinations (`phase1_locked: true`), the Workers AI candidates (`phase1_locked: false`, `response_shape`, `max_output_param`, integer `prices` with source and date, `revision: "server-side, not pinnable"`) and license objects as in the design. In-browser `revision` and `model_lib_url` are filled in task 16.11; until then `screen` would exclude them as `unpinned`.
    - _Requirements: 7.7, 9.12, 9.15, 11.15, 15.6_
  - [x] 13.2 Write `run.ts` and the `dev-run` and `locked-run` commands
    - Dev_Run over `dev.jsonl` for the Task_Type_Subset (`--task D|S|DS`, default `DS`); Timeout validation (positive safe integer, default 10,000); render errors recorded as `not_run` (`render_error`) in a Dev_Run.
    - Locked run flow steps 1 to 11 of the design: Manifest_Check and loading, phase gate and approval, once-only check, Dev_Run precondition per Task_Type with matching template hashes, pre-render of every Card × Permutation (any error: print every Card ID and reason, exit, nothing written), Fresh_Profile hook (filled in task 16), ledger `start` with `fsync` before any Runtime request, printed `docs/kiro-log.md` entry text without card content, requests only for missing outputs, grading through Sim_Wasm, `complete` or `abort`. `--resume <entry-id>` and `--rerun-reason`.
    - Outcome mapping table of the design (Illegal, `not_run`, failure records, `engine_fault`); before each request check the adapter `state()` and rebuild on `stuck` (page reload, engine create, both Warm_Up_Prompts); a failed rebuild writes one `rebuild_failed` failure record, an `abort` event and `not_run` (`rebuild_failed`) for the rest.
    - The locked-run logger has no method that accepts prompt or output text; progress lines are counts only (`D 120/244 S 40/164`).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 3.12, 3.14, 3.15, 7.7, 7.9, 8.3, 8.4, 8.5, 8.13, 9.4, 12.1, 12.9, 12.10, 17.6_
  - [x] 13.3 Write property test for the once-only rule
    - **Property 25: The once-only rule follows the Model_Key**
    - **Validates: Requirements 3.6, 3.7, 3.8, 3.10, 3.12, 3.15, 18.5**
  - [x] 13.4 Write property test for the Timeout setting
    - **Property 30: Only positive whole Timeouts start a run**
    - **Validates: Requirements 8.3, 8.4**
  - [x] 13.5 Write property test for the phase gate and the Task_Type_Subset
    - **Property 38: The phase gate and the Task_Type_Subset bound every request**
    - **Validates: Requirements 3.14, 11.19, 18.1, 18.2, 18.3, 18.4**
  - [x] 13.6 Write property test for engine faults
    - **Property 40: Engine faults never reach a Metric**
    - **Validates: Requirements 8.5, 8.13, 15.7**
  - [x] 13.7 Write `ingest.ts` and the `page-bundle`, `ingest` and `regrade` commands
    - `page-bundle --combo --split --task` writes `eval/results/bundles/<run-id>.json` (`llm-probe-bundle-v1`); for `--split locked` it follows the locked run flow up to the ledger start entry. `ingest` checks an `llm-probe-page-export-v1` file (schema, unknown, missing or duplicate Card × Permutation, Template_Hash and Pinned_Manifest_Hash), rejects the whole file on the first failure naming the entry and reason, otherwise stores the export under `eval/results/ingest/`, writes Results records with the same fields as a headless run (latency above the Timeout or a timeout/error marker → Illegal) and grades them. `regrade` re-validates and re-grades stored Results with zero adapter calls and requires byte-equal grades lines and identical Metrics and intervals.
    - _Requirements: 3.1, 10.3, 10.4, 10.5, 10.11, 12.5, 12.6, 12.7_
  - [x] 13.8 Write property test for re-grading
    - **Property 33: Re-grading reproduces every Grade and Metric**
    - **Validates: Requirements 12.6**
  - [x] 13.9 Write property test for ingest
    - **Property 34: Ingest accepts only complete, consistent exports**
    - **Validates: Requirements 10.3, 10.4, 10.5, 12.5**
  - [x] 13.10 Write property test for silent locked runs
    - **Property 26: Locked runs print no card content**
    - Covers a fake locked run, `ingest`, `regrade` and `report` over locked-shaped fixtures built in the test (never the real `locked.jsonl`), and counts `llm_render_prompt` calls on locked cards in `ingest`, `regrade` and `report` (must be zero).
    - **Validates: Requirements 3.1, 3.11**
  - [x] 13.11 Write the run-flow example tests, then commit
    - Ledger `start` is written before the first request of any kind (warm-ups included); a ledger write failure sends nothing and exits non-zero; the start entry carries `task_subset`, `model_key`, fingerprint and template hashes; Idle_Cap with a fake engine that stays busy: Timeout (Illegal), rebuild with both Warm_Up_Prompts before the next Card prompt, no `runtime_stuck` record; rebuild failure: exactly one `rebuild_failed` failure record, an `abort` event, `not_run` for the rest, no per-card Illegal grade; a forced `runtime_stuck` refusal is an `engine_fault` with no grade line and no Metric change; a refused Workers AI Locked_Run writes no ledger entry.
    - Gates green; one conventional commit for task 13.
    - _Requirements: 3.3, 3.4, 8.5, 8.13, 18.1_

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Pre-run verification (V1 to V8 of the design)
  - Every sub-task below must be complete, with its conclusion appended to `docs/kiro-log.md`, before any Phase_1 Locked_Run (task 21). Each sub-task ends with its own `docs(llm-probe)` commit (with any design or code change it causes), because the sub-tasks run at different points of the plan. A changed design section gets a dated note.
  - [x] 15.1 V1: WebLLM issue 560 fixed in 0.2.87?
    - Runs: during the first WebLLM Dev_Run (task 20.2), which switches between the D schema and an S family schema on one engine.
    - Check: no "Module has already been disposed" or other schema-change error across the D and S requests.
    - If it fails: the design already uses the one card-independent D schema; record the conclusion (and, if a schema-change error appears, record it as `runtime_error` and revisit DA-6 with the Author before any Locked_Run, as the design states).
    - _Requirements: 4.15, 9.1_
  - [x] 15.2 V2: does `apply_chat_template` pass `enable_thinking` into the Qwen3.5 template?
    - Runs: during the first transformers.js Qwen3.5 Dev_Run (task 20.3); check the raw outputs for `<think>`.
    - If it fails: switch to a hand-built prompt for that model, record it in the Model_Fingerprint (`chat_template_kwargs` and a note), re-run that Dev_Run, and log.
    - _Requirements: 9.14, 12.12_
  - [x] 15.3 V3: do gemma-4 and glm-4.7 read `enable_thinking`, and does the API return extra reasoning fields?
    - Runs: after task 17, as Workers AI Smoke_Calls (`probe smoke`) within the 10-per-UTC-day count; no approval needed within the count (R17.1), but tell the Author the model and count before sending. **[Target_Machine]** only because the root `env` lives there; the agent never opens `env`.
    - Check: `usage.completion_tokens_details.reasoning_tokens` is 0 or absent, which fields the live response carries, and the shape check result.
    - If it fails: adjust `response_shape` (and `combinations.json`) to the actual structure, confirm with a later Smoke_Call, log.
    - _Requirements: 11.15, 11.17, 11.19, 18.1_
  - [x] 15.4 V4: granite has no `finish_reason`; is truncation judged by `completion_tokens >= max_tokens`?
    - Runs: after task 17, one Smoke_Call on `granite-4.0-h-micro` with a very small `max_tokens`, inside the same daily count as 15.3.
    - If it fails (or to record the basis either way): write the observed basis of the truncation rule into the design's Workers AI adapter section with a dated note, adjust the adapter and its Property 39 generator if needed, log.
    - _Requirements: 11.16, 11.19_
  - [x] 15.5 V5: recompute the DA-8 neuron estimates for the glm and granite rows
    - Runs: after 15.3 and 15.4 and before the budget approval (task 18). Offline arithmetic.
    - Recompute the glm-4.7-flash and granite-4.0-h-micro rows (and the gemma rows if the Smoke_Calls showed reasoning tokens billed beyond the cap) from the stated prices and assumptions; correct DA-8 with a dated note; log the figures.
    - _Requirements: 11.7, 11.13_
  - [x] 15.6 V6: can ONNX Runtime log which device each operator is placed on?
    - Runs: at the first transformers.js VRAM_Preflight (task 19.3). **[Target_Machine]**
    - Check: the "Node placements" block appears in the captured console with `logSeverityLevel: 0` and verbose log level; add a real captured sample to the placement-parser tests.
    - If it fails: the preflight stops at `placement_not_logged`; change the detection method in the design's Placement detection section (dated note, Author informed) and in `placement.ts`, re-run the preflight, log. No Dev_Run of a transformers.js Combination before this is resolved.
    - _Requirements: 9.1, 10.6_
  - [x] 15.7 V7: actual WebLLM download size at the pinned revisions
    - Runs: during the first WebLLM Dev_Runs (tasks 20.2 and 20.4), from the Dev_Run perf record, compared with the `probe screen` sum at the Pinned_Revision.
    - If over 1,536 MiB: handled by the exclusion rule (screen) or the over-limit mark at Locked_Run start (R9.11); record the figures.
    - _Requirements: 9.3, 9.11, 14.5_
  - [x] 15.8 V8: re-read the WebLLM interfaces at the `v0.2.87` tag
    - Runs: after task 14 and before task 16 (the WebLLM adapter).
    - Re-read at the `v0.2.87` tag (not `main`): `cleanModelUrl` in `src/support.ts` (keeps a `/resolve/<ref>/` URL), `extra_body.enable_thinking` and `ignore_eos` in `src/openai_api_protocols/chat_completion.ts`, `response_format` with a schema, `interruptGenerate`, `CreateMLCEngine` with a custom `appConfig.model_list`, and `vram_required_MB` of the two Qwen3.5 `q4f32_1` entries in `src/config.ts`. Use Exa first, official GitHub sources.
    - If anything differs: update the design's In-browser adapters section and Research findings with a dated note before writing the adapter; log the result either way.
    - _Requirements: 9.2, 9.14, 9.15_

- [x] 16. In-browser adapters, Probe_Page and browser driver
  - [x] 16.1 Add the in-browser dependencies
    - Exact versions in `eval/probe/package.json`: `@mlc-ai/web-llm` 0.2.87, `@huggingface/transformers` 4.3.2, `vite`, `@playwright/test` (system Chrome only; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). Check whether a structured-output package for transformers.js is published on npm (DA-6) and record the result; add it only if published, pinned and licensed. Add `tsconfig.page.json` and extend `typecheck` to it. README rows with versions and SPDX licenses. If pnpm reports ignored build scripts, record which and allow one only if required, with the reason.
    - _Requirements: 9.1, 16.8_
  - [x] 16.2 Write `gpu.ts`, `placement.ts`, `screen.ts` and the pinned-fetch check
    - `gpu.ts`: request the adapter with the Combination's `powerPreference`, record `vendor`, `architecture`, `device`, `description` as reported; `gpu_unavailable` for no `navigator.gpu` or a `null` adapter, `software_adapter` for `google`/`swiftshader` or `isFallbackAdapter`. `placement.ts`: parse ONNX Runtime "Node placements" log lines into `cpu_nodes: [{ op_type, count }]`, and the WebLLM record `{ method: "webllm_model_lib", cpu_nodes: [] }`. `screen.ts`: In_Browser_Size_Limits (VRAM ≤ 2,600 MiB, params ≤ 2,300,000,000, published download ≤ 1,536 MiB at the Pinned_Revision, 40-hex `revision`, commit-pinned `model_lib_url` for WebLLM), one Exclusion_Record per failing Combination naming the first failed check and its value or "unknown"; the Hugging Face tree fetch is injected so tests stay offline. Pinned-fetch check: every `huggingface.co` request contains `/resolve/<revision>/`, every model-library request equals `model_lib_url`.
    - _Requirements: 9.1, 9.3, 9.5, 9.6, 9.8, 9.15, 9.17, 10.6_
  - [x] 16.3 Write property test for hardware WebGPU and screening
    - **Property 36: Only hardware WebGPU and fitting models run**
    - **Validates: Requirements 9.3, 9.6, 9.8, 9.10, 9.11, 9.15, 9.17, 10.6**
  - [x] 16.4 Write the placement-parser example tests
    - Parse ONNX Runtime log samples (from the ONNX Runtime sources or docs at first; task 15.6 adds a real sample); no placement block → `placement_not_logged`; all nodes on another provider → `backend_not_webgpu`.
    - _Requirements: 9.1, 10.6_
  - [x] 16.5 Write the WebLLM adapter (`adapters/webllm.ts`)
    - As in the design, using the interfaces confirmed in task 15.8: custom `appConfig.model_list` entry with the pinned `resolve/<revision>/` URL and `model_lib_url`; `chat.completions.create` with `temperature: 0`, `max_tokens`, `seed: 20261104`, `response_format` (D: the one card-independent schema; S: the family schema without `pattern`), `extra_body: { enable_thinking: false }`; interrupt with `interruptGenerate()` at the Generation_Cap; warm-up after every create or rebuild; identity and fingerprint fields (`chat_template_kwargs: { enable_thinking: false, add_generation_prompt: true }`, seed).
    - Unit test with a fake engine: request bodies carry `enable_thinking: false` and the schemas; the fingerprint records `chat_template_kwargs` and `seed`.
    - _Requirements: 4.15, 9.1, 9.7, 9.12, 9.14, 9.15, 12.12_
  - [x] 16.6 Write the transformers.js adapter (`adapters/transformers.ts`)
    - `from_pretrained(modelId, { revision, device: 'webgpu', dtype: 'q4', session_options: { executionProviders: ['webgpu'], logSeverityLevel: 0, logVerbosityLevel: 0 } })` with `env.backends.onnx.logLevel = 'verbose'`; text path only for the multimodal Qwen3.5 exports; prompt via `apply_chat_template(messages, { add_generation_prompt: true, enable_thinking: false, tokenize: false })` (LFM2.5 without `enable_thinking`); `do_sample: false`, `max_new_tokens`; an interruptable stopping criterion set by the timing timer; `seed: null` in the fingerprint; constraint `none` unless 16.1 pinned a structured-output package.
    - Unit test with a fake pipeline: chat-template options, `seed: null`, `chat_template_kwargs` recorded, no `min_new_tokens` on any Dev_Run or Locked_Run request.
    - _Requirements: 9.1, 9.7, 9.12, 9.14, 9.16, 12.12_
  - [x] 16.7 Write the Probe_Page and `page-serve`
    - `eval/probe/page/index.html` and `page/main.ts` exposing `window.__probe` (adapter check, engine create, `coldStart()`, run one prompt, run a bundle, export); `eval/probe/vite.config.ts` building to `eval/probe/dist` (never `web/dist`); engines on the page's main thread; no COOP/COEP, no `web/public/_headers`. Headed mode loads a bundle and downloads one `llm-probe-page-export-v1` file; it reads no file under `eval/cards/`. `page-serve` builds and serves on `http://localhost:4318`, creates and prints a new empty `--user-data-dir` for the Author's headed Chrome (the Fresh_Profile) and the command to delete it. Do not start it as a long-running process from the agent.
    - _Requirements: 9.7, 10.2, 10.3, 10.7, 10.11, 14.4_
  - [x] 16.8 Write the browser driver, profile and perf code
    - `browser/driver.ts`, `server.ts`, `profile.ts`, `perf.ts` as in the design: `HEADLESS_LAUNCH_FLAGS` = exactly `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`; `chromium.launchPersistentContext(mkdtemp dir, { channel: 'chrome', headless: true, args })`; byte counting by host from `requestfinished` (model, runtime, local); pinned-fetch check on `request`; placement capture on `console`; adapter check; storage quota check against `size.expected_download_bytes` before any download (failure `model_load_failed`, reason `quota`); ledger start hook for Locked_Runs; empty-cache cold start, `page.reload()`, warm-cache cold start; `nvidia-smi` sampler every 250 ms (peak minus idle baseline) for NVIDIA and `VmHWM` of the Chrome GPU process for Intel, each with its named quantity; network conditions; page-crash failure records; Fresh_Profile deleted in `finally`. Wire it into `run.ts` for in-browser Combinations.
    - _Requirements: 9.4, 9.5, 9.6, 10.1, 10.6, 14.4, 14.5, 14.7, 14.8, 14.9, 14.10_
  - [x] 16.9 Write `preflight.ts` and the `preflight` and `screen` commands
    - Synthetic Frozen_Context with at least 8 events and 6 persons (IDs not in the Card_Set), padded to `L = max(8,000, 2 × longest rendered Dev_Card prompt over all Permutations)` bytes (Dev_Cards only); `max_new_tokens: 1024` and `min_new_tokens: 1024` here only; NVIDIA sampler peak; `eval/results/preflight/<combo>.json` (`llm-probe-preflight-v1`) with `prompt_bytes`, `event_count`, `person_count`, `new_tokens`, `eos_disabled: true`, `peak_vram_mib`, `loaded_on_webgpu`, `placement`, adapter info, versions and revision; no Results record; Exclusion_Record on load failure, `loaded_on_webgpu: false` or peak above 2,600 MiB. `screen` reads Hugging Face API trees at each Pinned_Revision and writes `size.expected_download_bytes`.
    - _Requirements: 9.3, 9.9, 9.10, 9.16, 9.17_
  - [x] 16.10 Write the preflight, quota and driver example tests
    - Preflight with a fake adapter: no card prompt, no Results record, prompt length and synthetic-context counts, 1,024 tokens with `min_new_tokens` 1,024, all record fields; quota check with a fake `navigator.storage.estimate()` below, equal to and above the expected download; byte classification by host.
    - _Requirements: 9.9, 9.16, 14.5, 14.9_
  - [x] 16.11 Pin the in-browser Combinations
    - Look up on the Hugging Face API the 40-hex commit sha of each in-browser model repository, and the commit of `mlc-ai/binary-mlc-llm-libs` for each WebLLM model library under `web-llm-models/v0_2_87/`; fill `revision`, `model_lib_url`, `size` sources and licenses in `combinations.json` (`declared_by: "base_model"` for repositories without a license tag; LFM custom license with `accepted: "2026-11-06"`). Read-only API requests; no weights downloaded.
    - _Requirements: 9.2, 9.15, 15.6_
  - [x] 16.12 Check the boundaries, then commit
    - Gates green and offline (no unit test starts a browser, makes a network request or reads `env`); `web/` gains no dependency and no import of `eval/`; `web/dist` gains no file from `eval/probe/`; the game page has no Probe_Page control. **[Target_Machine]** One manual check, not a gate: run the driver's adapter check only (no engine create, no download) with `high-performance` and `low-power`, confirm the NVIDIA and Intel hardware adapters, log.
    - One conventional commit for task 16.
    - _Requirements: 9.7, 10.1, 10.7, 10.8, 16.4, 16.5_
  - [ ]* 16.13 Measure Intel iGPU memory through i915 debugfs or `intel_gpu_top`
    - Only if it works without root on the day; otherwise the named RSS quantity stays. Optional: R14.7 is met by the named RSS quantity or "not measured".
    - _Requirements: 14.7_

- [x] 17. Workers AI adapter and Smoke_Calls
  - [x] 17.1 Write the Workers AI adapter (`adapters/workers-ai.ts`)
    - In the Node process; URL `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`; body with `temperature: 0`, `seed: 20261104`, `[max_output_param]`, `response_format` where the Smoke_Calls confirm it, `chat_template_kwargs` from the Combination; raw text only from the declared Response_Shape's content field (`chat`: `truncated` checked first, then `empty_content`, `non_text_response`; `text`: `response`, truncation by `completion_tokens ≥ max_tokens`), never `JSON.stringify` of model output, no reasoning field; usage mapping; HTTP error or rate limit → `error` with status and first API error code, no headers, no token, no retry; abort at the Timeout (`late = none (aborted)`); `model.revision = "server-side, not pinnable"`. No change to `web/wrangler.jsonc` or the deploy workflow.
    - _Requirements: 8.6, 11.1, 11.9, 11.11, 11.15, 11.16, 11.17, 11.18, 11.21_
  - [x] 17.2 Write property test for Workers AI responses
    - **Property 39: Workers AI responses yield content text or a named error**
    - **Validates: Requirements 11.15, 11.16, 11.17, 11.18, 11.19**
  - [x] 17.3 Write the Workers AI example tests and extend the redaction property
    - Fake `fetch` and fake env reader: chat success, text-shape success, HTTP 400, 429, timeout with `late = none (aborted)`, `content: null`, `finish_reason: "length"`, parsed-object `response` → `non_text_response`, a reasoning field that must not reach the text. Extend Property 27's run with this adapter in the loop.
    - _Requirements: 11.3, 11.9, 11.11, 11.16, 11.18_
  - [x] 17.4 Write the `smoke` command and wire budget, approvals and the phase gate
    - `smoke --combo --count N`: Smoke_Calls on Dev_Cards within the remaining daily smoke allowance, each through `budget.ts` and checked against the declared Response_Shape; records under `eval/results/smoke/<day>.jsonl` (`llm-probe-smoke-v1`, verdict, `shape_check`, `declared_shape`, HTTP status), never in a Dev_Run or Locked_Run file. Workers AI `dev-run` and `locked-run` go through `allowWorkersAi`, `--approval` matching combination, kind and subset, `max_requests`, and the Response_Shape gate; refused runs follow R11.8.
    - _Requirements: 11.5, 11.6, 11.7, 11.8, 11.19, 11.20, 18.1, 18.3, 18.4, 18.6_
  - [x] 17.5 Check the boundaries, then commit
    - `git diff` of `web/wrangler.jsonc` and `.github/workflows/deploy.yml` is empty; gates green with no `env` read; no request sent by any test.
    - One conventional commit for task 17.
    - _Requirements: 11.1, 16.4, 16.5_

- [x] 18. STOP-AND-ASK: approve the Request_Budget values
  - [x] 18.1 Ask the Author to approve the Request_Budget and Neuron_Cap
    - Precondition: task 15.5 (V5) is done. Present the per-run cap 410, the daily cap 600 per UTC day, 10 Smoke_Calls per UTC day without approval, the Neuron_Cap of 9,000 estimated neurons per UTC day, the expected cost of a full Locked_Run per candidate model and Task_Type_Subset from DA-8 (with the V5 corrections), and the branch-B schedule. Do nothing that depends on these values until the Author approves them in the conversation at that moment.
    - Record the approval and its date in `docs/kiro-log.md` and as a dated note in DA-8; if the Author changes a value, change `budget.ts`, its tests and the design, run the gates, then log. One `docs(llm-probe)` commit (or `feat` if code changed).
    - _Requirements: 11.7, 17.1, 17.2_

- [x] 19. STOP-AND-ASK: screening and VRAM_Preflight [Target_Machine]
  - [x] 19.1 Ask the Author before screening and preflight
    - Name the actions: `probe screen` (Hugging Face API reads at each Pinned_Revision) and `probe preflight` for the three transformers.js candidates (downloads of about 0.6 to 1.5 GiB each, GPU use). Do nothing until the Author approves.
    - _Requirements: 17.1, 17.2_
  - [x] 19.2 Run `probe screen`
    - Write Exclusion_Records for any Combination that fails the size limits or the pinning check; commit `eval/results/exclusions.jsonl` and the filled `size` fields; log the outcome.
    - _Requirements: 9.3, 9.8, 9.15, 9.17_
  - [x] 19.3 Run the VRAM_Preflights
    - One per transformers.js candidate that is not excluded, each in a Fresh_Profile with the Headless_Launch_Flags on the NVIDIA adapter. Task 15.6 (V6) is decided on the first one, before the others run. Commit `eval/results/preflight/*.json` and any Exclusion_Records; log peaks and exclusions. One `chore(llm-probe)` commit for task 19.
    - _Requirements: 9.9, 9.10, 9.16, 9.17_

- [x] 20. STOP-AND-ASK: Dev_Runs, template tuning and template freeze [Target_Machine]
  - [x] 20.1 Ask the Author before the Dev_Runs
    - List the in-browser Combinations that are not excluded, the expected downloads and GPU time. Phase_1 rules: in-browser only; Workers AI only Smoke_Calls within the count (R18.1). Do nothing until the Author approves. If headless WebGPU no longer returns a hardware adapter, stop and ask the Author to run the headed Probe_Page **[headed Chrome]** (`page-bundle`, `page-serve`, export, `ingest`).
    - _Requirements: 10.1, 10.2, 17.1, 18.1_
  - [x] 20.2 First WebLLM Dev_Run (dev smoke test)
    - `probe dev-run --combo webllm/qwen3.5-0.8b-q4f32/nvidia --task DS` in a Fresh_Profile. Check that WebLLM's `enable_thinking: false` leaves no thinking text in the outputs. Feeds 15.1 (V1) and 15.7 (V7). Commit the Dev_Run Results; log.
    - _Requirements: 3.2, 9.12, 9.14, 14.5_
  - [x] 20.3 First transformers.js Dev_Run
    - `probe dev-run` for the transformers.js Qwen3.5-0.8B Combination; confirm the text-path loading of the multimodal export. Feeds 15.2 (V2). Commit; log.
    - _Requirements: 3.2, 9.1, 9.14_
  - [x] 20.4 Remaining Dev_Runs
    - The other in-browser Combinations that are not excluded (WebLLM Qwen3.5-2B feeds 15.7 too). A load failure or out-of-memory writes a failure record and the next Combination continues. Commit; log.
    - _Requirements: 3.2, 9.4_
  - [x] 20.5 Tune the Prompt_Templates on Dev_Cards only
    - Change only the files under `eval/probe/templates/` (block-format changes need a Rust change and a `RENDERER_VERSION` bump with a regenerated golden file; avoid them). Re-run Dev_Runs; never use Locked_Cards; log each iteration with its Template_Hashes and Dev_Run Metrics (labelled Dev_Run).
    - _Requirements: 3.2, 7.7, 15.2_
  - [x] 20.6 Ask the Author to freeze the templates, then run the final Dev_Runs
    - Present the final templates and their Template_Hashes; do nothing until the Author approves the freeze. Then run one Dev_Run per Combination with the frozen hashes (the R3.12 precondition), plus the Intel iGPU Dev_Run (`low-power`) of the best NVIDIA model, added to `combinations.json` with `phase1_locked: false`. Commit Results and the frozen templates; log the hashes. One `chore(llm-probe)` commit.
    - _Requirements: 3.12, 7.7, 15.2, 17.1_

- [x] 21. STOP-AND-ASK: Phase_1 Locked_Runs [Target_Machine]
  - [x] 21.1 Check the preconditions
    - Tasks 15.1 to 15.8 are all done and logged; `probe phase-status` shows Phase_1; every `phase1_locked` Combination has a final Dev_Run with the frozen Template_Hashes or an Exclusion_Record or failure record; gates green; working tree clean. Report the list to the Author.
    - _Requirements: 3.12, 18.1_
  - [x] 21.2 Locked_Run: WebLLM Qwen3.5-0.8B (`q4f32_1`, NVIDIA)
    - Ask the Author to approve this Locked_Run (Combination, `--task DS`, at most 408 requests). Only after approval: append the `docs/kiro-log.md` start entry (Combination, Task_Type_Subset, Model_Fingerprint, Pinned_Manifest_Hash) before the first request, run `probe locked-run --combo … --task DS`, append the end entry (completed, aborted or failed, Results location), commit the Results, grades, perf record and ledger lines. If the Combination was excluded or failed earlier, record that instead and run nothing.
    - _Requirements: 3.3, 3.5, 3.11, 14.4, 14.10, 17.1, 17.6_
  - [x] 21.3 Locked_Run: WebLLM Qwen3.5-2B (`q4f32_1`, NVIDIA)
    - Same procedure as 21.2, with its own approval.
    - _Requirements: 3.3, 3.5, 3.11, 14.4, 14.10, 17.1, 17.6_
  - [x] 21.4 Locked_Run: transformers.js Qwen3.5-0.8B (`q4`, NVIDIA)
    - Same procedure as 21.2, with its own approval.
    - _Requirements: 3.3, 3.5, 3.11, 14.4, 14.10, 17.1, 17.6_
  - [x] 21.5 Locked_Run: transformers.js Qwen3.5-2B (`q4`, NVIDIA)
    - Same procedure as 21.2, with its own approval.
    - _Requirements: 3.3, 3.5, 3.11, 14.4, 14.10, 17.1, 17.6_
  - [x] 21.6 Locked_Run: transformers.js LFM2.5-1.2B-Instruct (`q4`, NVIDIA)
    - Same procedure as 21.2, with its own approval. An interrupted run is continued only with `locked-run --resume <entry-id>` after asking again; a re-run needs the Author's reason (`--rerun-reason`).
    - _Requirements: 3.3, 3.5, 3.6, 3.9, 3.11, 14.4, 14.10, 17.1, 17.6_

- [x] 22. STOP-AND-ASK: Phase_1 checkpoint and the Author's Phase_2 decision
  - [x] 22.1 Report the Phase_1 result and ask for the Phase_2 branch
    - Run `probe phase-status` (and, for the Author's reading, a draft `probe report`, not committed). Report per Task_Type whether an in-browser Combination passed, with ledger entry IDs, and the branch that follows (A: Smoke_Calls only; B: one Workers AI model on the failing Task_Type_Subset, default `@cf/google/gemma-4-26b-a4b-it`). Do nothing until the Author decides.
    - _Requirements: 18.2, 17.1_
  - [x] 22.2 Record the Phase_2 approval
    - After the Author's decision in the conversation, add the `phase2` entry (`branch`, and for B the model and `task_subset`, `approved_on`) to `eval/probe/approvals.json` and commit it; confirm `phase-status` reads it from `HEAD`; log.
    - _Requirements: 11.20, 18.2, 18.4, 18.8_

- [x] 23. STOP-AND-ASK: Phase_2 (exactly one branch)
  - [x] 23.1 Branch A: Smoke_Calls only
    - If branch A: up to 10 Smoke_Calls on the branch-B default model (for example 5 D and 5 S Dev_Cards) within the daily count, to show the link is reachable and returns output the Output_Validator accepts; no Workers AI Dev_Run or Locked_Run. Commit the smoke records; log sent and accepted counts. If branch B, mark this sub-task not applicable.
    - _Requirements: 18.3, 18.6_
  - [x] 23.2 Branch B: approved Dev_Run
    - If branch B: ask the Author to approve the `dev` run (combination, `task_subset`, `max_requests`); after approval add the `dev` entry to `approvals.json` in its own commit; confirm a current `ok` Response_Shape Smoke_Call; run `probe dev-run --combo … --task <subset> --approval <id>` within the budget; commit Results; log. If branch A, not applicable.
    - _Requirements: 11.5, 11.6, 11.7, 11.8, 11.13, 11.14, 11.19, 18.4, 17.1_
  - [x] 23.3 Branch B: approved Locked_Run
    - If branch B: ask the Author to approve the `locked` run; after approval add the `locked` entry in its own commit; append the start entry to `docs/kiro-log.md`, run `probe locked-run --combo … --task <subset> --approval <id>` (start at 00:00 UTC of a fresh day per the DA-8 schedule; a budget stop is resumed with `--resume` on a later UTC day after asking again), append the end entry, commit. If branch A, not applicable.
    - _Requirements: 3.9, 11.5, 11.13, 11.14, 17.1, 17.6, 18.4, 18.5_

- [x] 24. Report
  - [x] 24.1 Generate `docs/llm-probe.md`
    - Run `probe report`. Check it against R15.1 to R15.12 and R18.6 to R18.8: every section present, only Locked_Run figures in marks and recommendations, Dev_Run figures labelled, no card content other than IDs, licenses and the LFM acceptance, the Workers AI note. Run `probe regrade` on every Locked_Run Results file and confirm byte-equal grades and identical Metrics.
    - _Requirements: 12.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.10, 15.11, 15.12, 18.6, 18.7, 18.8_
  - [x] 24.2 STOP-AND-ASK: the Author reviews the Report
    - Present the Report and ask the Author to review it; apply only corrections to the generator or its inputs (never to Results), regenerate, then commit. Ask the Author to run a search for the exact token and account ID strings over `eval/results/`, `docs/`, the console logs and `web/dist` (the agent never opens `env`); record the result.
    - _Requirements: 11.3, 17.1_

- [ ] 25. STOP-AND-ASK: the Author's runtime decision and the steering update
  - [x] 25.1 Ask the Author for the runtime decision
    - Ask for the chosen Runtime and model per Task_Type, or Rules_Default only. Until the Author records it, `tech.md` keeps "Decided by the W1 probe" and no recommendation goes into the steering files.
    - _Requirements: 15.8, 15.9_
  - [~] 25.2 Update `tech.md` and `structure.md` in one change
    - `tech.md` "LLM runtime" row names the decision per Task_Type and links to `docs/llm-probe.md`; `structure.md` "Next steps" states the decision and links to the Report. Log the steering change; one `docs(llm-probe)` commit.
    - _Requirements: 15.8_
  - [x] 25.3 Fix the run gate's missing pass results (after 25.1)
    - The run gate in `eval/probe/src/run-command.ts` builds its PhaseState without pass results (grades), so it always recomputes Phase_2 branch B (fails safe: a real branch A shows a mismatch and refuses to run). Load pass results through the same analysis `phase-status` uses (fixed in commit 80f4d50); add a test that the gate computes branch A when an in-browser Combination passes; gates green; `fix(probe)` commit; log. Recorded at the Author's request during the 24.2 review. Scheduling note (2026-11-09, DA-23): this fix is scheduled in the Task Dependency Graph before tasks 27 to 38 and before 25.1 completes, not after 25.1; the Decision_Model gate of task 27 reuses its shared `loadPhaseState()`.
    - _Requirements: 18.2, 11.20_

- [ ] 26. Final audit
  - [~] 26.1 Run the gates from a clean build
    - Remove `target/`, `web/node_modules/`, `eval/probe/node_modules/`, `web/dist/` and `eval/probe/dist/` (build output only), run `scripts/gates.sh` to exit 0, record the wall time. Run them once more in a fresh clone in a temporary directory, which has no `env` file, to show R16.4 offline of secrets.
    - _Requirements: 16.4, 16.5, 16.9_
  - [~] 26.2 Write `docs/llm-probe-audit.md`
    - Same style as `docs/web-shell-audit.md`: one row per acceptance criterion of R1 to R18 with status and evidence (test, property, gate, injection log entry, Results file, ledger entry, Report section). List the gaps.
    - _Requirements: all_
  - [~] 26.3 Update `README.md`
    - Exact commands from the repository root for the probe: install, `check-manifest`, `screen`, `preflight`, `dev-run`, `locked-run`, `smoke`, `page-serve`, `ingest`, `regrade`, `phase-status`, `report`. Final third-party table checked against both `package.json` files, both lockfiles and `Cargo.lock`.
    - _Requirements: 16.8_
  - [~] 26.4 Update the steering files' layout and gates
    - `.kiro/steering/structure.md`: `eval/probe/`, `eval/results/`, `fixtures/grading/`, `scripts/regen-grading-golden.sh`, `docs/llm-probe.md`, `docs/llm-probe-audit.md`, and the module table row for the slow-think bridge. `.kiro/steering/tech.md` Quality gates: the new gates in order. Log the steering changes.
    - _Requirements: 15.8_
  - [~] 26.5 Sync the spec documents with what was built
    - Update `design.md` where the implementation differs (resolved versions, Property 35 placement, the V1 to V8 outcomes, any changed flag, method or schema) with dated notes, without rewriting history; keep `requirements.md` criteria and add notes only. Run `validate_spec_format` on both files until clean. Gates green; one conventional commit for task 26.
    - _Requirements: all_
  - [~] 26.6 STOP-AND-ASK before pushing `main`
    - Ask the Author for a deploy approval naming the commit to push, because a green push to `main` deploys `web/dist`. Do nothing until approved. After the push, report the CI result and any CI-only difference, and log it.
    - _Requirements: 17.1, 17.2, 17.3_

- [x] 27. Shared phase-state loader use and the Decision_Model gate (R19.1, R19.4, R19.5, R19.17; DA-21, DA-23)
  - [x] 27.1 Build `allowDecisionModel` on the single `loadPhaseState()` (after 25.3)
    - Precondition: 25.3 is done, so `phase-status`, the run gate and the new gate all call one `loadPhaseState()` (DA-23). Add `allowDecisionModel(step, combo, task_subset, state)` in the run-gate file, with the order of checks in the design ("Decision_Model gate"): (1) `task_subset` is exactly `D`; an S-containing subset exits non-zero naming the Decision_Model and the Task_Type and writes no Results, no `not_run`, no ledger line and no budget change, before anything else is read; (2) Phase_1 has ended (the branch and the `phase2` entry are not consulted); (3) an unwithdrawn `decision_model` entry from `HEAD` names this Combination and this step; (4) smoke, then Dev_Run, then Locked_Run order, with a `shape_check: "ok"` record for the declared shape and the same mapping Template_Hash in the newest Dev_Run; (5) planned count at most the entry's `max_requests`. A `smoke` request needs no approval entry (RC-10): allowed when the subset is `D` and the 10-per-UTC-day count and the budget caps allow it.
    - _Requirements: 19.1, 19.4, 19.5, 18.1, 18.3, 18.4, 11.8, 11.20_
  - [x] 27.2 Extend the approvals reader (`decision_model` and `withdrawal` kinds)
    - Schema id stays `llm-probe-approvals-v1`. A `decision_model` entry names one Combination and one `step` (`dev` or `locked`), `task_subset: "D"`, `max_requests`, `approved_on`; the reader rejects `step: "smoke"`, any other step, a missing field, a subset other than `D`, and a `phase2` member. A `withdrawal` entry names the approval it withdraws. Entries are still added only in a commit made after the Author approved in the conversation (DA-14, R11.20).
    - _Requirements: 19.4, 11.20_
  - [x] 27.3 `decisionHold(state)` and the `phase-status` block
    - `decisionHold(state)` is true exactly when some Decision_Model has an unwithdrawn `decision_model` entry and none of: a `complete` ledger entry for D, a non-transient locked failure record (DA-15 rule), an Exclusion_Record. `phase-status` prints the `decision_models:` block (approvals by step, latest ledger status) and the line `runtime decision: ON HOLD (R19.17)` or `runtime decision: not on hold`, plus a warning (not a gate) when the hold is on and the `tech.md` "LLM runtime" row no longer starts with its pending text.
    - _Requirements: 19.17, 15.8, 15.9_
  - [x] 27.4 Write property test for the Decision_Model gate
    - **Property 47: A Decision_Model step needs its own approval, its own order and Task_Type D**
    - Generators for ledgers, failure records, Exclusion_Records, smoke shape checks, `combinations.json` and `HEAD` approvals content (other Combinations, other steps, `phase2` entries, branch-B entries, withdrawals); plus example tests: an S subset writes nothing, a `smoke` step entry is rejected by the reader, a branch-B approval allows no step.
    - **Validates: Requirements 19.1, 19.4, 19.5, 19.17, 18.1, 18.3, 18.4, 11.8, 11.20**
  - [x] 27.5 Fault injection for the Decision_Model gate, gates green, commit
    - Inject: `allowDecisionModel` ignores a `withdrawal` entry. The full gates must fail at the Unit_Tests gate with a Property 47 counterexample. Revert, green, log in `docs/kiro-log.md`. One `feat(probe)` commit for task 27.
    - _Requirements: 16.1, 16.3, 16.6, 16.7, 16.9_

- [x] 28. sim-core Raw_Choice validator mode and `llm_render_system_one` export (R4.16, R19.7, R19.10; DA-17, DA-18)
  - [x] 28.1 Add the `raw_choice` mode to `llm_validate`
    - Optional `mode` member (`json` default, `raw_choice`) in `crates/sim-core/src/llm/{validate.rs,api.rs}`. In `raw_choice` mode the verdict is `Decision{option: s}` exactly when `s` equals an option ID byte for byte, else `Illegal{OutOfSetOption}`; no parse-failure reason is possible; an S context or an unknown `mode` gives the `input` error. Without `mode` or with `json` the results are unchanged. The TypeScript wrapper in `simwasm.ts` takes `mode` as a required argument. No float, clock or I/O; the module-level `deny` lints stay.
    - _Requirements: 4.16, 4.5, 4.8, 4.13_
  - [x] 28.2 Add `llm_render_system_one` to `api.rs` and `sim-wasm`
    - Reads a mapping text, a D Frozen_Context and a Permutation; returns `state`, `instructions` and `criteria` (option ID to the label the D prompt prints, in the Permutation's order), reusing the fact-block functions of `render.rs`; unknown placeholders (including `{{options}}`) are render errors naming the placeholder. Additive: `RENDERER_VERSION` stays 2 and no existing export result changes. One `#[wasm_bindgen]` function in `crates/sim-wasm/src/llm.rs` taking and returning one JSON string, never throwing; add the wrapper in `simwasm.ts`.
    - _Requirements: 19.7, 19.10, 7.1, 7.2, 7.3, 7.6, 7.10, 7.11_
  - [x] 28.3 Write property test for Raw_Choice validation
    - **Property 42: Raw_Choice validation is exact, total and mode-selected**
    - In `crates/sim-core/tests/llm_properties.rs`, with `s` drawn from option IDs with added spaces, newline, case change, trailing character, empty, whitespace only, up to 1 MiB, any Unicode; includes the check that `dev-golden.json` bytes are unchanged and that a `raw_choice` verdict grades like a `json` verdict naming the same option.
    - **Validates: Requirements 4.16, 4.5, 4.8, 4.13**
  - [x] 28.4 Write property test for the System_One_Mapping render
    - **Property 41: The System_One_Mapping depends only on the Frozen_Context, the mapping bytes and the Permutation**
    - Rust part: determinism, Card-only fields do not change the output, `criteria` order for the four D Permutations, verbatim IDs, `Today is day <tick>.`, `due day <N>`, `none` for empty fields, unknown placeholder errors, using a test mapping. The part on the real mapping file (Template_Hash and the five Author rules) is in 30.2.
    - **Validates: Requirements 19.7, 19.10, 7.1, 7.2, 7.3, 7.6, 7.10, 7.11**
  - [x] 28.5 Golden fixture and parity for the new exports
    - New golden file `fixtures/grading/system-one-golden.json` (written by `scripts/regen-grading-golden.sh` on purpose, commit message says so) covering `raw_choice` validation and `llm_render_system_one` for every Dev_Card; `crates/sim-wasm/tests/llm_parity.rs` compares native and wasm32 bytes and names the Card ID and the export on a failure; extend the Property 15 bad-input test to the new export and mode. Confirm `fixtures/grading/dev-golden.json` and `fixtures/parity/` are byte-identical (`git diff --stat`), the existing parity tests and Smoke_Test pass, and record the new `sim_wasm_bg.wasm` size against the Size_Limit.
    - _Requirements: 4.16, 6.4, 6.5, 6.7, 6.8, 6.9, 19.7_
  - [x] 28.6 Fault injection, gates green, commit
    - Inject: `raw_choice` mode trims ASCII whitespace before comparing. The full gates must fail with a Property 42 counterexample at `cargo test --workspace`. Revert, green, log. One conventional commit for task 28 (for example `feat(sim-core): add raw_choice validation and system_one render export`).
    - _Requirements: 16.1, 16.3, 16.6, 16.7_

- [x] 29. System One adapter (`eval/probe/src/adapters/system-one.ts`; R19.6, R19.8, R19.9, R19.11, R19.12, R19.18, R19.19; DA-16, DA-19, DA-20)
  - [x] 29.1 Extend the Combination type and add the two Decision_Model records
    - `combinations.json`: `workers-ai/clef-flash` (`@cf/cloudflare/clef-flash`, `context_window_tokens` 24,576, input price 3,455 neurons per million tokens) and `workers-ai/clef` (`@cf/cloudflare/clef`, 65,536, 21,818), each with Task_Type_Subset {D}, `response_shape: "system_one"`, required `validator_mode: "raw_choice"`, `max_bytes_per_token` provisional 8 (part of the Model_Fingerprint, so a changed value changes the fingerprint ID), `phase1_locked: false`. A `system_one` Combination without `validator_mode` fails the type check. Values and URLs are the ones recorded in the design's research section.
    - _Requirements: 19.1, 19.2, 19.6, 19.11, 4.16_
  - [x] 29.2 Write the adapter
    - Adapter_Interface request becomes the union of `chat` and `decision` requests (the `decision` kind has no Workers AI field). `system-one.ts` imports `env.ts`, `redact.ts`, `sink.ts`, `budget.ts` and the HTTP error mapping; the fetch and timeout glue is exported from `workers-ai.ts` unchanged (existing tests pass untouched). Path `/ai/run/@cf/cloudflare/<model>`, body `{model, state, questions}`; the response is read from `result` (V9: a top-level object makes the shape check `mismatch`). The Raw_Choice is `result.answers.decision.choice` and is the only text outcome; a missing `answers`, `decision` or `choice`, or a non-string `choice`, returns the error `system_one_shape`. `confidence` and `probabilities` are stored verbatim (original lexemes, via `system_one.response_text`) in a separate field and used for no validation, grade or Metric. `usage.input_tokens` and `output_tokens` map to input and output tokens, `reasoning_tokens` null; missing or non-integer usage sets `usage_reported: false`.
    - _Requirements: 19.6, 19.8, 19.9, 11.15, 11.17, 11.18, 12.2, 11.19_
  - [x] 29.3 Truncation checks (pre and post)
    - Pre-check: refuse when `body_bytes > context_window_tokens` (exactly equal is accepted); a Dev_Run records `not_run` with reason `over_context`, a Locked_Run refuses before the `start` entry listing every Card ID (step 5 of the locked run flow). Post-check: record `truncated_state` (an engine fault, not an Illegal) when the response flags `truncated: true`, or `usage.input_tokens < floor(body_bytes / K)`, or `usage.input_tokens > W`; no grade line, in every denominator as not acceptable, never `complete`; usage missing is stored with `usage_reported: false` and the Report says truncation rests on the pre-check alone.
    - _Requirements: 19.11, 3.5, 3.15, 13.1, 14.1, 12.9_
  - [x] 29.4 Budget estimate for `system_one`
    - In `budget.ts`: reservation `ceil((body_bytes + 256) × input_price / 1,000,000)` in `BigInt`, no output term; after a response with usage the counted cost is `ceil(input_tokens × input_price / 1,000,000)` and replaces the reservation; without usage the reservation stays; the Neuron_Cap, daily cap and per-run cap apply as before and a refusal marks every unsent Card × Permutation `not_run` with reason `budget`. Existing budget tests pass untouched.
    - _Requirements: 19.12, 11.5, 11.6, 11.13, 11.14, 11.17_
  - [x] 29.5 Smoke_Call shape check for `system_one`
    - The `smoke` command accepts a Decision_Model Combination with D Dev_Cards only; the shape check is `ok` exactly when `result.model` is a string, `answers.decision.type === "choice"`, `choice` is a string, `probabilities` is an object of numbers, `confidence` is a number, and `usage.input_tokens` and `output_tokens` are integers. The record stores `shape_check`, `declared_shape`, the HTTP status and the measured `bytes_per_token` as an exact fraction of integers.
    - _Requirements: 19.6, 11.19, 11.8_
  - [x] 29.6 Write property test for the adapter's Raw_Choice and confidence isolation
    - **Property 43: A System_One response yields a Raw_Choice or a named error, and confidence never leaks**
    - **Validates: Requirements 19.6, 19.8, 19.9, 11.15, 11.17, 11.18, 12.2, 11.19**
  - [x] 29.7 Write property test for the truncation checks
    - **Property 44: Truncation checks are exact at the boundary and never grade a possibly cut request**
    - **Validates: Requirements 19.11, 3.5, 3.15, 13.1, 14.1, 12.9**
  - [x] 29.8 Write property test for the budget estimate
    - **Property 45: The System One budget estimate is an exact byte-based upper bound with no output term**
    - **Validates: Requirements 19.12, 11.5, 11.6, 11.13, 11.14, 11.17**
  - [x] 29.9 Write the fake-Runtime example tests, extend redaction, inject a fault, commit
    - Example tests with a fake `fetch` and no network (R19.18, R19.19): a valid Raw_Choice, a `choice` outside the set, a missing `answers` entry, a truncation flag, an `over_context` refusal, a body of exactly the window (accepted) and one byte more (refused), input usage below the lower bound and above the window, a missing usage, a 429, a plan or billing error, a timeout. Extend Property 27 (redaction) to the new adapter; confirm the Deploy_Directory checks still pass.
    - Injection: change the pre-check from `>` to `>=`. The full gates must fail with a Property 44 counterexample at the Unit_Tests gate. Revert, green, log. One `feat(probe)` commit for task 29.
    - _Requirements: 19.18, 19.19, 11.3, 16.1, 16.3, 16.6, 16.7_

- [x] 30. System_One_Mapping file and Template_Hash (R19.7, R19.10; DA-18)
  - [x] 30.1 Write `eval/probe/templates/decision.system_one.v1.txt`
    - Sections `[state]` (fact block placeholders), `[instructions]` ("How to read the facts" and "How to choose" of `decision.v1.txt`, verbatim, in a separate file; the frozen `decision.v1.txt` is not touched), `[criteria]` (option ID to label mapping spec). No `{{options}}` or any unknown placeholder. Wire its sha256 into the Combination records as the Template_Hash through the existing template-hash code (R3.12 precondition applies to it).
    - _Requirements: 19.7, 19.10, 3.12, 7.7_
  - [x] 30.2 Write the mapping test (five Author rules and hash)
    - **Property 41 (real-file part): for every `decision.system_one.v*.txt` in the repository, `[instructions]` together with the `Today is day {{tick}}.` line satisfies the five Author template rules (the same rule checks the existing template test uses), and the Template_Hash equals the sha256 of the file bytes.**
    - **Validates: Requirements 19.7, 19.10, 7.1, 7.2, 7.3, 7.6, 7.10, 7.11**
  - [x] 30.3 Gates green, injection, commit
    - Inject: add `{{options}}` to the mapping file. The gates must fail at the Unit_Tests gate (render error naming the placeholder). Revert, green, log. One `feat(probe)` commit for task 30.
    - _Requirements: 16.1, 16.6, 16.7, 19.7_

- [x] 31. External_Reference ingest and Report amendments (R19.13, R19.15, R19.16; DA-22)
  - [x] 31.1 Write `external.ts` and `probe ingest-reference`
    - File format of the design ("External_Reference_File"): label, reference model name, Task_Type, `pinned_manifest_hash`, sha256 of `config`, `ledger`, `results` and the optional `raw_outputs`, integer figures; relative paths only (an absolute or `..` path is a fault). The command checks everything in the documented order and names the first failing field; a rejected file writes nothing under `eval/results/`; an accepted one writes only under `eval/results/external/<label>/`, sends no request, reads no `env`, prints no Card content other than Card IDs, `pair_id`s and scenario group IDs. With raw outputs present, re-grade through Sim_Wasm and store the re-grade next to the supplied figures, with `mismatch` and the differing names when they differ. The re-grade reads `locked.jsonl` for grading only: add the command to the R3.1 list (RC-13) in code and docs. Manifest_Check runs first.
    - _Requirements: 19.15, 3.1, 1.2, 12.6_
  - [x] 31.2 Write the import-graph isolation test
    - A test that fails if `external.ts` is imported by `phase-status`, the run gate, `analysis`, `ledger`, `metrics` or any pass/fail, link-mark, recommendation or Phase_2-branch code; only the CLI and the Report section 12 may import it.
    - _Requirements: 19.16, 18.8_
  - [x] 31.3 Write property test for the ingest
    - **Property 46: An External_Reference is accepted only whole and never touches a mark**
    - **Validates: Requirements 19.15, 19.16**
  - [x] 31.4 Report: Phase_2 candidate count, selection-bias note, Decision_Model statement, hold banner, section 12
    - Section 2: the number of distinct Workers AI Combinations with at least one Dev_Run or Locked_Run Results file or ledger entry made in Phase_2 (Smoke_Call-only Combinations not counted); the multiple-comparison note exactly when that count is 2 or more, saying the Thresholds were not adjusted; the Additional_Candidate_Set with each Decision_Model's approval IDs or its "not measured" reason; the R18.8 branch, approval date and branch-B model unchanged. Section 9: the hold banner exactly when `decisionHold(state)` is true. Section 12: each ingested External_Reference, labelled as external reference and not a repo Combination, with its hashes and per-Task_Type Metrics as supplied or re-graded; no other section mentions it. Decision_Model figures are Locked_Run figures only; Dev_Run figures stay labelled; V14 is printed as "not tested" unless measured.
    - _Requirements: 19.13, 19.16, 19.17, 15.1, 15.2, 18.8_
  - [x] 31.5 Write property test for the Report amendments
    - **Property 48: The Report counts Phase_2 candidates and prints the selection-bias note**
    - **Validates: Requirements 19.13, 19.17, 18.8**
  - [x] 31.6 Fault injections, gates green, commit
    - Injection 1: the ingest accepts a wrong `ledger` sha256 (R16.6). The gates must fail with a Property 46 counterexample at the Unit_Tests gate. Injection 2: import `external.ts` from the Phase_2 branch code; the import-graph test fails. Revert each, green, log each. One `feat(probe)` commit for task 31. Never edit a file under `eval/cards/`.
    - _Requirements: 19.15, 19.16, 16.1, 16.3, 16.6, 16.7, 16.10_

- [x] 32. Pre-run verifications V9 to V14 that can be done offline
  - [x] 32.1 Re-read the official Clef pages
    - With Exa MCP (official domains only; not preview mirrors), re-check the changelog, `developers.cloudflare.com/workers-ai/models/clef-flash/` and `…/clef/` and the pricing page against the design's research section (REST path, body, window sizes, rates, license link). If anything changed, add a dated note to `design.md` and stop to tell the Author before continuing. Log the retrieval date.
    - _Requirements: 19.2, 19.3_
  - [x] 32.2 Offline checks for V10 to V14
    - V10: the provisional `max_bytes_per_token` 8 is in the fingerprint and a changed value changes the fingerprint ID (test exists from 29). V11: recompute the reservation against the recorded gemma usage from the stored Dev_Run and Locked_Run Results (aggregate token counts only, no card content), showing the 256-token allowance is not already exceeded by a plausible wrapper. V12: confirm the runner has no retry (R11.9) and that a 429 produces the documented record. V13: confirm the plan or billing error path writes "not measured" and the Report lists it. V14: confirm the Report prints "not tested". Write each conclusion (done offline, or pending the first Smoke_Call) in `docs/kiro-log.md`; V9 and the online half of V10 to V13 are done in task 33.
    - _Requirements: 19.3, 19.11, 19.12, 11.9_
  - [x] 32.3 Gates green and commit
    - Run `scripts/gates.sh` to exit 0 from the working tree; confirm `git diff 091d1d7 -- eval/cards` is empty and no `env` read happened; one `docs(llm-probe)` commit (or `chore(llm-probe)` if code changed).
    - _Requirements: 16.4, 16.5, 16.9, 17.7_

- [x] 33. Smoke_Calls for the Decision_Models [Target_Machine]
  - [x] 33.1 Smoke_Calls: `clef-flash`
    - No approval is needed (RC-10), within the 10 Smoke_Calls per UTC day shared with every other Workers AI Smoke_Call. Before sending, tell the Author the model and the number of calls (at most 10, about 70 neurons at the planning bound) and check the day's count in the budget counter. Run `probe smoke` on D Dev_Cards only. If a call fails with a plan or billing error, stop, record the model as not measured with that reason (R19.3) and tell the Author. Commit the smoke records under `eval/results/smoke/`; log sent and `ok` counts.
    - _Requirements: 19.5, 19.3, 11.8, 11.19, 17.1_
  - [x] 33.2 Smoke_Calls: `clef`
    - Same procedure; the model is named to the Author first (at most 10 calls, about 440 neurons at the planning bound), within the day's count left after 33.1 (if 33.1 used the whole count, wait for the next UTC day). Commit; log.
    - _Requirements: 19.5, 19.3, 11.8, 11.19, 17.1_
  - [x] 33.3 Record the V9 to V13 conclusions
    - From the smoke records: V9 (result envelope, member types, `usage` fields; fix the declared shape if `mismatch`, and do not go on until the shape check is `ok`); V10 (tokens-per-byte lower bound: set `max_bytes_per_token` to `max(6, ceil(1.5 × max measured ratio))` or keep 8, update `combinations.json`, and the fingerprint changes); V11 (reservation versus usage-based cost; raise the allowance in `combinations.json` and Property 45 if exceeded); neuron rate observed; whether the same request repeated gives the same `choice` only if the Author asks for the optional V14 pair (otherwise "not tested"). If the mean input size is more than 25% from the DA-20 proxies, recompute and show the DA-20 figures again before any Dev_Run approval is asked. Add dated notes to `design.md`; gates green; one `chore(llm-probe)` commit.
    - _Requirements: 19.2, 19.3, 19.11, 19.12, 11.19, 16.9_

- [ ] 34. STOP-AND-ASK: Decision_Model Dev_Runs, mapping tuning and freeze [Target_Machine]
  - [x] 34.1 Ask for the `clef-flash` Dev_Run approval
    - Present the Combination, `task_subset: "D"`, `max_requests` (74), the expected neurons (about 249 typical, 518 planning bound, recomputed from 33.3 if needed), the Neuron_Cap, and that the mapping is tuned on Dev_Cards only. Do nothing until the Author approves in the conversation at that moment.
    - _Requirements: 19.4, 19.5, 17.1, 17.2_
  - [x] 34.2 Record the `clef-flash` `dev` approval
    - Add the `decision_model` entry (`step: "dev"`) to `eval/probe/approvals.json` in its own commit; confirm `phase-status` reads it from `HEAD`; log.
    - _Requirements: 19.4, 11.20_
  - [x] 34.3 Run the `clef-flash` Dev_Run
    - `probe dev-run --combo workers-ai/clef-flash --task D --approval <id>` within the budget; check `over_context`, `truncated_state`, V10 (final `max_bytes_per_token`) and V12 (rate-limit; a 429 pattern is a design change to ask the Author about, not a retry). Commit Results; log.
    - _Requirements: 19.5, 19.11, 19.12, 11.5, 11.6, 11.13, 11.14, 17.1_
  - [x] 34.4 Ask for the `clef` Dev_Run approval
    - Same as 34.1 for `clef` (74 requests, about 1,572 neurons typical, 3,256 planning bound). Its own approval: the `clef-flash` approval covers nothing here.
    - _Requirements: 19.4, 19.5, 17.1, 17.2_
  - [x] 34.5 Record the `clef` `dev` approval
    - As 34.2, for `clef`.
    - _Requirements: 19.4, 11.20_
  - [x] 34.6 Run the `clef` Dev_Run
    - As 34.3, for `clef` (on UTC day 1 together with the Smoke_Calls, or later; the Locked_Run goes on a later UTC day per DA-20).
    - _Requirements: 19.5, 19.11, 19.12, 11.5, 11.6, 11.13, 11.14, 17.1_
  - [~] 34.7 Tune the System_One_Mapping on Dev_Cards only
    - Change only files under `eval/probe/templates/` (a new `decision.system_one.v2.txt`; the five Author rules test must pass; never use Locked_Cards). A Dev_Run with a changed mapping needs a new `dev` approval entry for that Combination (ask first). Log each iteration with its Template_Hash and Dev_Run Metrics (labelled Dev_Run).
    - _Requirements: 19.7, 19.10, 3.2, 7.7, 15.2_
  - [~] 34.8 STOP-AND-ASK: freeze the mapping, then the final Dev_Runs
    - Present the final mapping and Template_Hash; do nothing until the Author approves the freeze. Then one Dev_Run per Decision_Model with the frozen hash (the R3.12 precondition), each under its own approval entry if the hash changed since its last Dev_Run. Commit Results and the frozen mapping; log the hashes. One `chore(llm-probe)` commit.
    - _Requirements: 19.10, 3.12, 17.1_

- [ ] 35. STOP-AND-ASK: Decision_Model Locked_Runs (D) [Target_Machine]
  - [~] 35.1 Check the preconditions
    - For each model: a `shape_check: "ok"` Smoke_Call for the declared shape; a final Dev_Run with the frozen Template_Hash; no `over_context` refusals; `probe phase-status` shows Phase_1 ended; gates green; working tree clean. Amended (R20): the four-record registry and the Aggregation_Hash are committed (task 44.2) and `phase-status` shows the registry check passing; the `single` Dev_Run is complete (no `not_run` or `engine_fault` record) so the later Dev derived file (tasks 45 and 46) can exist before `derive_locked`. Report to the Author.
    - _Requirements: 19.4, 19.5, 3.12, 18.1_
  - [~] 35.2 Locked_Run: `clef-flash` (D)
    - Ask the Author to approve this Locked_Run (Combination, `--task D`, 236 requests, about 877 neurons typical). Only after approval: add the `decision_model` entry (`step: "locked"`) in its own commit; append the `docs/kiro-log.md` start entry (Combination, Task_Type_Subset, Model_Fingerprint, Pinned_Manifest_Hash) before the first request; run `probe locked-run --combo workers-ai/clef-flash --task D --approval <id>`; append the end entry; commit Results, grades, perf record and ledger lines. The agent passes on only progress counts, aggregate Metrics, Card IDs and error messages (R3.11); it never opens `locked.jsonl`, `eval/cards/blind/*` or `env`.
    - _Requirements: 19.4, 19.5, 3.3, 3.5, 3.11, 14.4, 14.10, 17.1, 17.6_
  - [~] 35.3 Locked_Run: `clef` (D)
    - Same procedure, own approval (236 requests, about 5,539 neurons typical, 10,384 at the planning bound). Start at 00:00 UTC of a fresh day (day 2 after its Dev_Run, DA-20). If the Neuron_Cap stops the run, resume with `locked-run --resume <entry-id>` on the next UTC day after asking again (R3.9).
    - _Requirements: 19.4, 19.5, 19.12, 3.3, 3.5, 3.9, 3.11, 14.4, 14.10, 17.1, 17.6_

- [ ] 36. Optional S candidate `@cf/zai-org/glm-4.7-flash` (only if the Author keeps it; R19.14)
  - [ ]* 36.1 Ask the Author whether to keep an S candidate
    - If not kept, this task and its sub-tasks are not applicable. If kept, tell the Author that it needs its own verification, its own Combination record and its own approval, and that the gate for it (a generative model outside the branch-B model) must be settled in a short design note and a requirement note first; no other model is added.
    - _Requirements: 19.14, 17.1_
  - [ ]* 36.2 Verify, record and gate the S candidate
    - R19.2-style verification from official pages (availability, REST path, window, rates, `enable_thinking` behavior); the Combination record in `combinations.json`; the gate and approval kind agreed in 36.1, with tests and a fault injection; gates green; one commit.
    - _Requirements: 19.2, 19.14, 11.19, 11.20_
  - [ ]* 36.3 Dev_Run and Locked_Run for the S candidate
    - Each with its own approval entry in its own commit, the Response_Shape Smoke_Call first, the budget caps, and the start and end entries in `docs/kiro-log.md`; commit Results.
    - _Requirements: 19.14, 11.5, 11.6, 11.13, 11.14, 11.19, 17.1, 17.6_

- [ ] 37. Ingest the External_Reference when the Author hands it over [blocked on the Author]
  - [~] 37.1 Ingest the file
    - Amended 2026-11-09 (R20.18 to R20.20, DA-29): the chosen route is the checked-in `eval/results/external/teacher-upper-bound/author-supplied.json`, written and wired in task 43 and shown in Report section 12 as "Author-supplied, not verified by ingest". The Author's archive is not in the External_Reference_File format, so `probe ingest-reference` is not run on it (R19.15 amendment). Here: confirm the file is committed and unchanged since task 43 (sha256 in `docs/kiro-log.md`). Run `probe ingest-reference <file>` only if the Author later hands over a file in the R19.15 format with its three sibling files; on a rejection, report the first failing field and wait for a corrected file. RC-20 stays open until the Author answers it (task 50, before 38.2).
    - _Requirements: 19.15, 19.16, 20.18, 20.19, 20.20_
  - [~] 37.2 Check isolation after the ingest
    - Confirm `phase-status`, the ledger bytes, the budget counter and every pass or fail mark are identical before and after the ingest, and that the reference appears only in Report section 12; any difference is a defect to fix before the Report.
    - _Requirements: 19.16, 18.8_

- [ ] 38. Report regeneration and the Author's review for the Decision_Models
  - [~] 38.1 Regenerate `docs/llm-probe.md`
    - Run `probe report`. Check R19.13, R19.16 and R19.17 content: section 2 candidate count and selection-bias note, each Decision_Model's approval IDs and Locked_Run figures (or "not measured" with the reason), `truncated_state` and `over_context` counts, V14 "not tested", hold banner state in section 9, External_Reference only in section 12. Re-run the R24.1 checks: only Locked_Run figures in marks, Dev_Run labelled, no card content other than IDs; `probe regrade` on every new Locked_Run Results file gives byte-equal grades and identical Metrics. Amended (R20.13 to R20.16): the four Decision_Model Combinations appear with their variants, each `perm_avg` figure carries its label, the Request_Multiplier and the `by_construction` flip, the production note is present, the External reference (Author-supplied, not verified by ingest) is only in section 12, and `probe derive --verify` gives byte-equal files for every derived Results file.
    - _Requirements: 20.13, 20.14, 20.15, 20.16, 20.19, 19.13, 19.16, 19.17, 12.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.10, 15.11, 15.12, 18.6, 18.7, 18.8_
  - [~] 38.2 STOP-AND-ASK: the Author reviews the updated Report
    - Present the Report; apply only corrections to the generator or its inputs (never to Results), regenerate, then commit. Ask the Author to search the exact token and account ID strings over `eval/results/`, `docs/`, console logs and `web/dist` again (the agent never opens `env`); record the result.
    - _Requirements: 11.3, 17.1_
  - [~] 38.3 Confirm the decision hold state before 25.1 completes
    - Run `probe phase-status`. The hold line must read `not on hold` (every approved Decision_Model has a `complete` entry, a recorded failure or an Exclusion_Record, or the Author withdrew its approval, in which case add the `withdrawal` entry in its own commit). Amended (R20.10): the hold is per variant, so each approved `single` and `perm_avg` variant must be resolved. Log the state. 25.1 stays blocked on this line (R19.17).
    - _Requirements: 20.10, 19.17, 15.8, 15.9_

- [x] 39. R20 core: `llm_aggregate_perm_avg`, golden fixtures, parity and the rule text (R20.3 to R20.8, R20.17; DA-25, V18)
  - [x] 39.1 Write `crates/sim-core/src/llm/aggregate.rs` and its export
    - Digit-string Probability_Lexeme parser (JSON number grammar, value 0 to 1, at most 40 significant digits, decimal exponent not below -60; rejections as in R20.4), schoolbook decimal addition (no `f32`/`f64`, no `i128` shortcuts that can overflow; exact sums as decimal strings with their scale), selection of the highest sum with the tie broken by ascending UTF-8 bytes of the option ID (R20.5), the Illegal reasons of R20.6 (missing record, Timeout or error, `truncated_state`, no `probabilities`, `choice` outside the set, keys not exactly the option IDs, bad lexeme, base call missing), per-call positions, `RULE_VERSION`. Module-level `deny` lints as in task 1.1; `tests/source_guard.rs` needs no change.
    - `llm_aggregate_perm_avg` in `api.rs`; the one-JSON-string wrapper in `crates/sim-wasm/src/llm.rs` (never throws); the wrapper in `simwasm.ts`; the entry in `crates/sim-wasm/tests/llm_bad_input.rs`. Additive: no existing export result and no existing golden byte changes.
    - _Requirements: 20.3, 20.4, 20.5, 20.6, 20.7, 6.1, 6.7_
  - [x] 39.2 Write property tests for the aggregation (Properties 49 and 50)
    - **Property 49: The aggregation is exact, total and equals a test-only big-integer reference model**
    - **Property 50: The chosen option is invariant under Permutation order of the calls and under the call labels, and Illegal reasons are exact**
    - In `crates/sim-core/tests/llm_properties.rs`, each tagged `// Feature: llm-probe, Property N: <title>`; the reference model lives in the test file only. Example tests in `llm_examples.rs`: each accepted and rejected lexeme form (`0`, `1`, `0.5`, `5e-1`, `1e0`, `1.0000…` with 41 significant digits, `-0`, `1.01`, `.5`, `0x1`, exponent below -60), the tie case, sums that carry across 40-digit lexemes, a Card with fewer than four distinct Permutations, and a Sanity_Card with the base call only (RC-19).
    - **Validates: Requirements 20.4, 20.5, 20.6, 20.17**
  - [x] 39.3 Fixtures, regeneration, native and wasm32 parity, TS parity
    - `fixtures/grading/perm-avg-inputs.json` (synthetic, built from Dev_Card option IDs, no model output) and `fixtures/grading/perm-avg-golden.json`; extend `scripts/regen-grading-golden.sh` to write it on purpose only (the commit message says so). The parity test in `crates/sim-wasm/tests/llm_parity.rs` compares native and wasm32 bytes and names the Card ID and the export on a failure; the TS-side parity test in `eval/probe/tests/unit/parity.test.ts` reads the same file through `simwasm.ts`. `dev-golden.json`, `system-one-golden.json`, `dev-system-one-golden.json` and `fixtures/parity/` stay byte-identical (`git diff --stat`); record the new `sim_wasm_bg.wasm` size against the Size_Limit.
    - _Requirements: 20.7, 20.17, 6.4, 6.5, 6.8, 6.9_
  - [x] 39.4 Write the rule text, the `rule_version` check (V18) and the Aggregation_Hash
    - `eval/probe/templates/aggregation.perm_avg.v1.txt` states the Aggregation_Rule in words. A `rule_version` line in the file must equal the export's `RULE_VERSION`; a mismatch is a failure in the unit tests and at every `derive` (V18). Compute the sha256 of the file bytes (the Aggregation_Hash) and pin it in `combinations.json` in task 40.1 (R20.8). The rule text is not a prompt and is never sent to a Runtime.
    - _Requirements: 20.8, 20.1_
  - [x] 39.5 Gates green and commit
    - Run `scripts/gates.sh` to exit 0; `git diff 091d1d7 -- eval/cards` empty; one `feat(sim-core)` commit for task 39 (the commit message says the grading goldens were extended on purpose); log in `docs/kiro-log.md`.
    - _Requirements: 16.9, 17.7_

- [x] 40. R20 registry: variant Combination records, Results members and the fingerprint (R20.1, R20.2, R20.7; DA-24, DA-26, V16)
  - [x] 40.1 Extend `combinations.json` and `phase.ts` validation
    - New members `variant` (absent means `single`), `derives_from`, `aggregation` (rule file name, `rule_version`, pinned Aggregation_Hash) and `sends_requests` (`false` for `perm_avg`). Existing `workers-ai/clef-flash` and `workers-ai/clef` keep their IDs and gain `"variant": "single"`. Add `workers-ai/clef-flash/perm_avg` and `workers-ai/clef/perm_avg` with Task_Type_Subset {D}, `derives_from` naming the `single` record, `validator_mode: "raw_choice"`, `phase1_locked: false`. Validation rejects a `perm_avg` record whose `derives_from` is missing, is not a `single` record of the same model, or whose aggregation hash does not equal the rule file's sha256, and a `single` record with `derives_from`. The Model_Fingerprint builder gains `variant`, `derived` and `aggregation`, and `template_hashes.aggregation`; a `single` fingerprint ID keeps its value for the existing records unless the design says otherwise (check with a test against the stored Smoke_Call records).
    - _Requirements: 20.1, 20.2, 20.8, 19.1, 3.12_
  - [x] 40.2 Results additions in `results.ts` and `run.ts`
    - Additive members only: header `variant`, `derived_from`, `variants` (the frozen registry, written into every Decision_Model Dev_Run and Locked_Run header), `model_key: null` for a derived file; record members `perm_avg` (exact per-option sums as decimal strings with their scale, chosen option ID, per-call positions) and `source: "derived"`. Files written before this task still read unchanged. Extend the Property 32 round trip to the new members.
    - _Requirements: 20.1, 20.7, 12.1, 12.2, 12.4_
  - [x] 40.3 Write property test extension for the Results round trip
    - **Property 32 (extended): Results records, including derived-file members, round trip byte-exact**
    - **Validates: Requirements 20.7, 12.1, 12.2, 12.4, 12.10**
  - [x] 40.4 Gates green and commit
    - Run `scripts/gates.sh` to exit 0; one `feat(probe)` commit for task 40; log.
    - _Requirements: 16.9_

- [x] 41. `probe derive`, the Derived_Run and the metrics flip (R20.7, R20.9, R20.11, R20.12; DA-26, Properties 51, 52)
  - [x] 41.1 Write `eval/probe/src/derive.ts` and the `derive` command
    - `probe derive --combo <perm_avg id> --split dev|locked --approval <id> [--verify]`: no network, no `env`, no budget counter, no ledger line, no Runtime. Order: Manifest_Check; `allowDecisionVariant('derive_dev' | 'derive_locked', …)` (task 42.1 provides it; until then use a stub that always refuses, replaced in 42.1); `rule_version` check (V18); registry check; the source must be complete (R20.11 and RC-24: every Card × Permutation of the plan has an output record and no `not_run` or `engine_fault` record; a Locked source is complete by its ledger entry); `derive_locked` requires the Dev derived file; `--task` other than `D` is refused. For each Card call `llm_aggregate_perm_avg` on the stored `system_one.response_text` bodies, grade through `llm_validate` in `raw_choice` mode and `llm_grade`, write the Derived_Run Results file and the grades file (a refusal or a `perm_avg_illegal` Card is recorded as an Illegal base record with detail `<reason> <permutation>`). An existing derived file with a different source hash is never overwritten (`probe: derive: derived_conflict: <path>`). `--verify` recomputes from the stored source and compares bytes without writing. `dev-run` and `locked-run` refuse a `perm_avg` Combination with `probe: variant: …`. The command reads `locked.jsonl` for grading only (RC-18) and prints only counts, Card IDs and error messages.
    - _Requirements: 20.7, 20.9, 20.10, 20.11, 3.1, 3.11_
  - [x] 41.2 `metrics.ts`: flip `by_construction` and `passLabel`
    - For a derived file the flip Metric is `by_construction` (not measured, not a pass), the other three Metrics are computed as for any Locked_Run, the latency figures are taken from the source `single` run with the Request_Multiplier shown, and `passLabel` gives a pass the "perm_avg, order-invariant by construction" label (R20.13: it still counts as a pass under R13.4 with its label).
    - _Requirements: 20.12, 20.13, 13.4_
  - [x] 41.3 Write property tests for derive and the metrics flip (Properties 51 and 52)
    - **Property 51: A Derived_Run is a pure function of its stored source, never overwritten, byte-exact under `--verify`, and refused unless the source is complete**
    - **Property 52: A derived file's flip Metric is by_construction and its other Metrics equal the Metrics computed from its grades**
    - Fake sources built from the Dev_Card option IDs; example tests: incomplete source (a `not_run` record, an `engine_fault` record), a conflicting existing file, a `dev-run` request for a `perm_avg` Combination, a V18 mismatch.
    - **Validates: Requirements 20.7, 20.9, 20.11, 20.12, 20.13**
  - [x] 41.4 Gates green and commit
    - Run `scripts/gates.sh` to exit 0; one `feat(probe)` commit for task 41; log.
    - _Requirements: 16.9_

- [x] 42. Approvals, phase gate and Report for the variants (R20.1, R20.10, R20.13 to R20.16, R19.4; DA-27, DA-28, Properties 53 to 55)
  - [x] 42.1 `approvals.ts` and `phase.ts`: `variant`, `derive_dev`, `derive_locked`
    - The approvals reader accepts the `decision_model` kind with a `variant` member and the steps `derive_dev` and `derive_locked` for a `perm_avg` Combination only (and `dev`/`locked` for `single` only); a `derive_*` entry names its Combination and carries no `max_requests` above 0. `allowDecisionVariant(step, combo, state)`: Task_Type D, the Combination's registry entry equals the registry written in the `single` Dev_Run header (R20.1), the `single` source run exists and is complete, an unwithdrawn entry from `HEAD` for this variant and step, and `derive_locked` after a Dev derived file. Replace the stub of 41.1. Per-variant `decisionHoldPending` (R20.10, R19.17): each approved variant needs its own `complete` entry, failure record or Exclusion_Record, or a `withdrawal`; the Phase_2 candidate count includes derived files; `phase-status` prints the variant lines and the registry check.
    - _Requirements: 20.1, 20.10, 19.4, 19.17, 11.20_
  - [x] 42.2 Write property test for the variant gate (Property 53)
    - **Property 53: A variant step needs its own approval, registry match and complete source, and the hold is per variant**
    - Extend the generators of Property 47 with variants, `derive_*` entries, registry mismatches and withdrawals.
    - **Validates: Requirements 20.1, 20.10, 19.4, 19.17**
  - [x] 42.3 `report.ts`: sections 2, 4, 4a, 4b, 4c, 9, 12 and the `perm_avg_mark`
    - Section 2: four Decision_Model Combinations with their variants and the multiple-comparison count including derived files. Sections 4, 4a to 4c: the `single` and `perm_avg` figures side by side, the `perm_avg` flip shown as `by_construction`, the Request_Multiplier (up to 4 calls per decision) next to every `perm_avg` latency, and the production note of R20.15 (`tech.md` says one request per node; the one-request alternative is "not measured" unless V17 was run). Section 9: the per-variant hold banner. Section 12: the External reference (task 43). `perm_avg_mark(...)` is a pure function used for the pass label. The fine-tuning sentence of R20.16. Only Locked_Run figures in marks; Dev derived figures are labelled Dev_Run.
    - _Requirements: 20.13, 20.14, 20.15, 20.16, 15.1, 15.2_
  - [x] 42.4 Write property tests for the Report additions (Properties 54 and 55)
    - **Property 54: The Report labels a perm_avg pass, shows the Request_Multiplier and never marks a derived flip**
    - **Property 55: The Report prints the production note, the per-variant hold banner and the variant candidate count**
    - **Validates: Requirements 20.13, 20.14, 20.15, 20.16, 19.13, 19.17**
  - [x] 42.5 Gates green and commit
    - Run `scripts/gates.sh` to exit 0; one `feat(probe)` commit for task 42; log.
    - _Requirements: 16.9_

- [x] 43. Author-supplied External reference file (R20.18 to R20.20; DA-29, Property 56)
  - [x] 43.1 Write `eval/results/external/teacher-upper-bound/author-supplied.json` and its reader
    - Check in the file with the figures exactly as the Author supplied them (integers only), labelled "Author-supplied, not verified by ingest", with no claim that only the flip Threshold fails (RC-20 stays open, see task 50; do not guess its wording). Extend `external.ts` with a reader for this format (a distinct label from the External_Reference_File of R19.15; it sends no request, reads no `env`, writes nothing under `eval/results/` at read time). The Report section 12 shows it with that label and its sha256. The import-graph test of 31.2 is extended: the reader is imported only by the CLI and Report section 12. Never open `eval/cards/blind/*`, `locked.jsonl` or `env`.
    - _Requirements: 20.18, 20.19, 20.20, 19.16_
  - [x] 43.2 Write property test for the External reference (Property 56)
    - **Property 56: The Author-supplied External reference is shown only in section 12, with its label, and never touches a mark, the ledger, the budget or the Phase_2 branch**
    - **Validates: Requirements 20.18, 20.19, 20.20, 19.16**
  - [x] 43.3 Gates green and commit
    - Run `scripts/gates.sh` to exit 0; one `feat(probe)` commit for task 43; log.
    - _Requirements: 16.9_

- [x] 44. R20 fault injections, registry freeze check and gate wiring (R20.1, R20.17; V16, V18)
  - [x] 44.1 Fault injections for the R20 code
    - One at a time, each with the full `scripts/gates.sh`, revert, green, and a `docs/kiro-log.md` entry (date, gate, fault, failure excerpt, revert, passing re-run): (1) aggregation sums with `f64` or truncates a lexeme to 17 digits (Property 49 fails at `cargo test --workspace`); (2) tie broken by Permutation order instead of option ID bytes (Property 50 fails); (3) `perm-avg-golden.json` one byte changed (parity test names the Card ID and the export, also on wasm32 alone); (4) `derive` overwrites a conflicting file or accepts an incomplete source (Property 51 fails at the Unit_Tests gate); (5) the metrics flip reports a measured flip for a derived file (Property 52); (6) `allowDecisionVariant` ignores the registry check or the per-variant approval (Property 53); (7) the Report drops the Request_Multiplier or marks the External reference in a pass mark (Properties 54 to 56); (8) change one byte of `aggregation.perm_avg.v1.txt` without updating the pinned hash (the registry validation fails); (9) change `rule_version` in the file only (V18 test fails). No injected fault may remain in any commit, and none edits a file under `eval/cards/`.
    - _Requirements: 20.17, 16.1, 16.3, 16.6, 16.7, 16.10_
  - [x] 44.2 V16: confirm the registry is committed before any Decision_Model Dev_Run result
    - Check with `git log` that tasks 39 to 43 are committed, that `combinations.json` holds the four records and the pinned Aggregation_Hash, and that no Decision_Model Dev_Run Results file exists yet (`eval/results/dev/` listing, names and headers only). Run `probe phase-status` and `scripts/gates.sh` to exit 0. Record the Aggregation_Hash and the commit in `docs/kiro-log.md`. Task 34.1 may complete only after this sub-task (R20.1). If a Decision_Model Dev_Run result already exists, stop and tell the Author: a later change needs an Author amendment.
    - _Requirements: 20.1, 17.7_

- [x] 45. STOP-AND-ASK: derive the `clef-flash` Dev_Run into `perm_avg`
  - [x] 45.1 V15 over the first real `clef-flash` Dev_Run bodies
    - After 34.3. Read-only count over the stored `system_one.response_text` bodies (counts only, no Card content): `probabilities` present for every Permutation of every D Card, keys exactly equal to the Card's option IDs, every lexeme inside the accepted grammar (none above 1, none with more than 40 significant digits). Write the counts and the conclusion in `docs/kiro-log.md`. If V15 fails, stop and tell the Author; do not ask for the derive approval.
    - _Requirements: 20.3, 20.4, 20.6_
  - [x] 45.2 Ask for the `derive_dev` approval for `workers-ai/clef-flash/perm_avg`
    - Present the Combination, the source run and its hash, the Aggregation_Hash, 0 requests and 0 neurons, and that the figures are Dev_Run figures not used for a mark. Do nothing until the Author approves in the conversation at that moment. Its own approval: the `dev` approval of the `single` variant covers nothing here.
    - _Requirements: 20.9, 20.10, 17.1, 17.2_
  - [x] 45.3 Record the `derive_dev` approval
    - Add the entry to `eval/probe/approvals.json` in its own commit; confirm `phase-status` reads it from `HEAD`; log.
    - _Requirements: 20.10, 11.20_
  - [x] 45.4 Run `probe derive` for the Dev split and verify
    - `timeout 120 pnpm --dir eval/probe run probe derive --combo workers-ai/clef-flash/perm_avg --split dev --approval <id>` then the same with `--verify`. Read the Dev figures as Dev_Run figures. If the mapping is tuned later (34.7, 34.8), a derived file from the superseded source is not overwritten: ask the Author before deriving from the final Dev_Run. Commit the derived Results and grades; log.
    - _Requirements: 20.7, 20.9, 20.11, 20.12, 15.2_

- [ ] 46. STOP-AND-ASK: derive the `clef` Dev_Run into `perm_avg`
  - [x] 46.1 V15 over the first real `clef` Dev_Run bodies
    - After 34.6. Same read-only counts as 45.1 for `clef`. Log; stop and tell the Author on a failure.
    - _Requirements: 20.3, 20.4, 20.6_
  - [-] 46.2 Ask for the `derive_dev` approval for `workers-ai/clef/perm_avg`
    - As 45.2, for `clef`; its own approval.
    - _Requirements: 20.9, 20.10, 17.1, 17.2_
  - [~] 46.3 Record the `derive_dev` approval
    - As 45.3.
    - _Requirements: 20.10, 11.20_
  - [~] 46.4 Run `probe derive` for the Dev split and verify
    - As 45.4, for `clef`.
    - _Requirements: 20.7, 20.9, 20.11, 20.12, 15.2_

- [ ] 47. STOP-AND-ASK: derive the `clef-flash` Locked_Run into `perm_avg`
  - [~] 47.1 Ask for the `derive_locked` approval for `workers-ai/clef-flash/perm_avg`
    - After 35.2 (the `single` Locked_Run is `complete`). Present the source ledger entry, the Dev derived file, the Aggregation_Hash, 0 requests and 0 neurons. Do nothing until approved.
    - _Requirements: 20.9, 20.10, 17.1, 17.2_
  - [~] 47.2 Record the approval and run `probe derive --split locked`
    - Add the `derive_locked` entry in its own commit; append the start entry in `docs/kiro-log.md` (Combination, source ledger entry, Aggregation_Hash, Pinned_Manifest_Hash); run the command with `timeout`, then `--verify`; append the end entry; commit Results and grades. The agent passes on only progress counts, aggregate Metrics, Card IDs and error messages (R3.11); it never opens `locked.jsonl`, `eval/cards/blind/*` or `env`.
    - _Requirements: 20.9, 20.10, 20.11, 3.11, 17.6_

- [ ] 48. STOP-AND-ASK: derive the `clef` Locked_Run into `perm_avg`
  - [~] 48.1 Ask for the `derive_locked` approval for `workers-ai/clef/perm_avg`
    - After 35.3 (the `single` Locked_Run is `complete`). As 47.1, for `clef`; its own approval.
    - _Requirements: 20.9, 20.10, 17.1, 17.2_
  - [~] 48.2 Record the approval and run `probe derive --split locked`
    - As 47.2, for `clef`.
    - _Requirements: 20.9, 20.10, 20.11, 3.11, 17.6_

- [ ] 49. Optional: V17 one-request alternative (only if the Author asks; R20.15)
  - [ ]* 49.1 Ask the Author whether to measure the one-request alternative
    - If not asked, this task is not applicable and the Report says "not measured". If asked, at most two Smoke_Calls inside the day's count of 10, D Dev_Cards only, naming the model and the number of calls first (no approval needed, RC-10).
    - _Requirements: 20.15, 11.8, 17.1_
  - [ ]* 49.2 Run the V17 Smoke_Calls and record the conclusion
    - Check that several `choice` questions over one `state` are answered independently and keep the `criteria` key order; commit the smoke records; log. The production conflict with `tech.md` stays with the Author.
    - _Requirements: 20.15, 11.19_

- [ ] 50. STOP-AND-ASK: RC-20 stays open until the Author answers (R20.20)
  - [~] 50.1 Ask the Author for the RC-20 wording
    - Before 38.2: present the open RC-20 item and the current wording of Report section 12 ("Author-supplied, not verified by ingest", teacher figures as supplied, no claim that only the flip Threshold fails). Do nothing until the Author answers. If the Author asks to continue without an answer, record that in `docs/kiro-log.md` and leave RC-20 marked open in the Report.
    - _Requirements: 20.20, 17.1_
  - [~] 50.2 Apply the answer and regenerate the Report section 12
    - Apply only the wording the Author gave to `requirements.md` (as "Amendment (RC-20, date)") and the generator inputs; never edit Results; run `validate_spec_format`; gates green; one `docs(llm-probe)` commit; log.
    - _Requirements: 20.20, 19.16_

## Task Dependency Graph

Each leaf runs in its own wave because nearly every task edits shared files (`scripts/gates.sh`, `eval/probe/package.json` and its lockfile, `README.md`, `docs/kiro-log.md`, `eval/results/ledger.jsonl`). The order follows the numbers, except for the Pre-run verification sub-tasks: 15.8 (V8) runs before the WebLLM adapter work of task 16; 15.3, 15.4 and 15.5 (V3, V4, V5) run after the Workers AI adapter and before the budget approval; 15.6 (V6) runs at the first VRAM_Preflight; 15.1, 15.7 and 15.2 (V1, V7, V2) run during the first Dev_Runs. All of them are done before task 21. Requirement 19 (tasks 27 to 38) runs after 24.2: 25.3 first (the single `loadPhaseState()`), then 27 to 38 in numeric order, then, amended for Requirement 20 (tasks 39 to 50): 39 to 44 right after 33.3 (before 34.1 completes), the `derive_dev` tasks 45 and 46 after 34.3 and 34.6, the `derive_locked` tasks 47 and 48 after 35.2 and 35.3, 49 (optional) after 37, 50 (RC-20) after 38.1 and before 38.2. Then 25.1 (blocked until `phase-status` shows the decision hold is off, task 38.3), 25.2 and 26. 36 is optional, and 37 waits for the Author.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["1.5"] },
    { "id": 5, "tasks": ["1.6"] },
    { "id": 6, "tasks": ["2.1"] },
    { "id": 7, "tasks": ["2.2"] },
    { "id": 8, "tasks": ["2.3"] },
    { "id": 9, "tasks": ["2.4"] },
    { "id": 10, "tasks": ["2.5"] },
    { "id": 11, "tasks": ["2.6"] },
    { "id": 12, "tasks": ["2.7"] },
    { "id": 13, "tasks": ["2.8"] },
    { "id": 14, "tasks": ["3.1"] },
    { "id": 15, "tasks": ["3.2"] },
    { "id": 16, "tasks": ["3.3"] },
    { "id": 17, "tasks": ["3.4"] },
    { "id": 18, "tasks": ["3.5"] },
    { "id": 19, "tasks": ["3.6"] },
    { "id": 20, "tasks": ["3.7"] },
    { "id": 21, "tasks": ["3.8"] },
    { "id": 22, "tasks": ["4.1"] },
    { "id": 23, "tasks": ["4.2"] },
    { "id": 24, "tasks": ["4.3"] },
    { "id": 25, "tasks": ["4.4"] },
    { "id": 26, "tasks": ["4.5"] },
    { "id": 27, "tasks": ["5.1"] },
    { "id": 28, "tasks": ["5.2"] },
    { "id": 29, "tasks": ["5.3"] },
    { "id": 30, "tasks": ["5.4"] },
    { "id": 31, "tasks": ["5.5"] },
    { "id": 32, "tasks": ["5.6"] },
    { "id": 33, "tasks": ["6.1"] },
    { "id": 34, "tasks": ["6.2"] },
    { "id": 35, "tasks": ["6.3"] },
    { "id": 36, "tasks": ["6.4"] },
    { "id": 37, "tasks": ["6.5"] },
    { "id": 38, "tasks": ["6.6"] },
    { "id": 39, "tasks": ["6.7"] },
    { "id": 40, "tasks": ["6.8"] },
    { "id": 41, "tasks": ["7.1"] },
    { "id": 42, "tasks": ["7.2"] },
    { "id": 43, "tasks": ["7.3"] },
    { "id": 44, "tasks": ["7.4"] },
    { "id": 45, "tasks": ["7.5"] },
    { "id": 46, "tasks": ["7.6"] },
    { "id": 47, "tasks": ["8.1"] },
    { "id": 48, "tasks": ["8.2"] },
    { "id": 49, "tasks": ["8.3"] },
    { "id": 50, "tasks": ["8.4"] },
    { "id": 51, "tasks": ["8.5"] },
    { "id": 52, "tasks": ["8.6"] },
    { "id": 53, "tasks": ["8.7"] },
    { "id": 54, "tasks": ["8.8"] },
    { "id": 55, "tasks": ["8.9"] },
    { "id": 56, "tasks": ["9.1"] },
    { "id": 57, "tasks": ["9.2"] },
    { "id": 58, "tasks": ["9.3"] },
    { "id": 59, "tasks": ["9.4"] },
    { "id": 60, "tasks": ["9.5"] },
    { "id": 61, "tasks": ["9.6"] },
    { "id": 62, "tasks": ["9.7"] },
    { "id": 63, "tasks": ["9.8"] },
    { "id": 64, "tasks": ["9.9"] },
    { "id": 65, "tasks": ["9.10"] },
    { "id": 66, "tasks": ["9.11"] },
    { "id": 67, "tasks": ["9.12"] },
    { "id": 68, "tasks": ["10.1"] },
    { "id": 69, "tasks": ["10.2"] },
    { "id": 70, "tasks": ["10.3"] },
    { "id": 71, "tasks": ["10.4"] },
    { "id": 72, "tasks": ["11.1"] },
    { "id": 73, "tasks": ["11.2"] },
    { "id": 74, "tasks": ["11.3"] },
    { "id": 75, "tasks": ["11.4"] },
    { "id": 76, "tasks": ["11.5"] },
    { "id": 77, "tasks": ["12.1"] },
    { "id": 78, "tasks": ["12.2"] },
    { "id": 79, "tasks": ["12.3"] },
    { "id": 80, "tasks": ["12.4"] },
    { "id": 81, "tasks": ["12.5"] },
    { "id": 82, "tasks": ["12.6"] },
    { "id": 83, "tasks": ["13.1"] },
    { "id": 84, "tasks": ["13.2"] },
    { "id": 85, "tasks": ["13.3"] },
    { "id": 86, "tasks": ["13.4"] },
    { "id": 87, "tasks": ["13.5"] },
    { "id": 88, "tasks": ["13.6"] },
    { "id": 89, "tasks": ["13.7"] },
    { "id": 90, "tasks": ["13.8"] },
    { "id": 91, "tasks": ["13.9"] },
    { "id": 92, "tasks": ["13.10"] },
    { "id": 93, "tasks": ["13.11"] },
    { "id": 94, "tasks": ["15.8"] },
    { "id": 95, "tasks": ["16.1"] },
    { "id": 96, "tasks": ["16.2"] },
    { "id": 97, "tasks": ["16.3"] },
    { "id": 98, "tasks": ["16.4"] },
    { "id": 99, "tasks": ["16.5"] },
    { "id": 100, "tasks": ["16.6"] },
    { "id": 101, "tasks": ["16.7"] },
    { "id": 102, "tasks": ["16.8"] },
    { "id": 103, "tasks": ["16.9"] },
    { "id": 104, "tasks": ["16.10"] },
    { "id": 105, "tasks": ["16.11"] },
    { "id": 106, "tasks": ["16.12"] },
    { "id": 107, "tasks": ["16.13"] },
    { "id": 108, "tasks": ["17.1"] },
    { "id": 109, "tasks": ["17.2"] },
    { "id": 110, "tasks": ["17.3"] },
    { "id": 111, "tasks": ["17.4"] },
    { "id": 112, "tasks": ["17.5"] },
    { "id": 113, "tasks": ["15.3"] },
    { "id": 114, "tasks": ["15.4"] },
    { "id": 115, "tasks": ["15.5"] },
    { "id": 116, "tasks": ["18.1"] },
    { "id": 117, "tasks": ["19.1"] },
    { "id": 118, "tasks": ["19.2"] },
    { "id": 119, "tasks": ["19.3"] },
    { "id": 120, "tasks": ["15.6"] },
    { "id": 121, "tasks": ["20.1"] },
    { "id": 122, "tasks": ["20.2"] },
    { "id": 123, "tasks": ["15.1"] },
    { "id": 124, "tasks": ["20.3"] },
    { "id": 125, "tasks": ["15.2"] },
    { "id": 126, "tasks": ["20.4"] },
    { "id": 127, "tasks": ["15.7"] },
    { "id": 128, "tasks": ["20.5"] },
    { "id": 129, "tasks": ["20.6"] },
    { "id": 130, "tasks": ["21.1"] },
    { "id": 131, "tasks": ["21.2"] },
    { "id": 132, "tasks": ["21.3"] },
    { "id": 133, "tasks": ["21.4"] },
    { "id": 134, "tasks": ["21.5"] },
    { "id": 135, "tasks": ["21.6"] },
    { "id": 136, "tasks": ["22.1"] },
    { "id": 137, "tasks": ["22.2"] },
    { "id": 138, "tasks": ["23.1"] },
    { "id": 139, "tasks": ["23.2"] },
    { "id": 140, "tasks": ["23.3"] },
    { "id": 141, "tasks": ["24.1"] },
    { "id": 142, "tasks": ["24.2"] },
    { "id": 143, "tasks": ["25.3"] },
    { "id": 144, "tasks": ["27.1"] },
    { "id": 145, "tasks": ["27.2"] },
    { "id": 146, "tasks": ["27.3"] },
    { "id": 147, "tasks": ["27.4"] },
    { "id": 148, "tasks": ["27.5"] },
    { "id": 149, "tasks": ["28.1"] },
    { "id": 150, "tasks": ["28.2"] },
    { "id": 151, "tasks": ["28.3"] },
    { "id": 152, "tasks": ["28.4"] },
    { "id": 153, "tasks": ["28.5"] },
    { "id": 154, "tasks": ["28.6"] },
    { "id": 155, "tasks": ["29.1"] },
    { "id": 156, "tasks": ["29.2"] },
    { "id": 157, "tasks": ["29.3"] },
    { "id": 158, "tasks": ["29.4"] },
    { "id": 159, "tasks": ["29.5"] },
    { "id": 160, "tasks": ["29.6"] },
    { "id": 161, "tasks": ["29.7"] },
    { "id": 162, "tasks": ["29.8"] },
    { "id": 163, "tasks": ["29.9"] },
    { "id": 164, "tasks": ["30.1"] },
    { "id": 165, "tasks": ["30.2"] },
    { "id": 166, "tasks": ["30.3"] },
    { "id": 167, "tasks": ["31.1"] },
    { "id": 168, "tasks": ["31.2"] },
    { "id": 169, "tasks": ["31.3"] },
    { "id": 170, "tasks": ["31.4"] },
    { "id": 171, "tasks": ["31.5"] },
    { "id": 172, "tasks": ["31.6"] },
    { "id": 173, "tasks": ["32.1"] },
    { "id": 174, "tasks": ["32.2"] },
    { "id": 175, "tasks": ["32.3"] },
    { "id": 176, "tasks": ["33.1"] },
    { "id": 177, "tasks": ["33.2"] },
    { "id": 178, "tasks": ["33.3"] },
    { "id": 179, "tasks": ["39.1"] },
    { "id": 180, "tasks": ["39.2"] },
    { "id": 181, "tasks": ["39.3"] },
    { "id": 182, "tasks": ["39.4"] },
    { "id": 183, "tasks": ["39.5"] },
    { "id": 184, "tasks": ["40.1"] },
    { "id": 185, "tasks": ["40.2"] },
    { "id": 186, "tasks": ["40.3"] },
    { "id": 187, "tasks": ["40.4"] },
    { "id": 188, "tasks": ["41.1"] },
    { "id": 189, "tasks": ["41.2"] },
    { "id": 190, "tasks": ["41.3"] },
    { "id": 191, "tasks": ["41.4"] },
    { "id": 192, "tasks": ["42.1"] },
    { "id": 193, "tasks": ["42.2"] },
    { "id": 194, "tasks": ["42.3"] },
    { "id": 195, "tasks": ["42.4"] },
    { "id": 196, "tasks": ["42.5"] },
    { "id": 197, "tasks": ["43.1"] },
    { "id": 198, "tasks": ["43.2"] },
    { "id": 199, "tasks": ["43.3"] },
    { "id": 200, "tasks": ["44.1"] },
    { "id": 201, "tasks": ["44.2"] },
    { "id": 202, "tasks": ["34.1"] },
    { "id": 203, "tasks": ["34.2"] },
    { "id": 204, "tasks": ["34.3"] },
    { "id": 205, "tasks": ["45.1"] },
    { "id": 206, "tasks": ["45.2"] },
    { "id": 207, "tasks": ["45.3"] },
    { "id": 208, "tasks": ["45.4"] },
    { "id": 209, "tasks": ["34.4"] },
    { "id": 210, "tasks": ["34.5"] },
    { "id": 211, "tasks": ["34.6"] },
    { "id": 212, "tasks": ["46.1"] },
    { "id": 213, "tasks": ["46.2"] },
    { "id": 214, "tasks": ["46.3"] },
    { "id": 215, "tasks": ["46.4"] },
    { "id": 216, "tasks": ["34.7"] },
    { "id": 217, "tasks": ["34.8"] },
    { "id": 218, "tasks": ["35.1"] },
    { "id": 219, "tasks": ["35.2"] },
    { "id": 220, "tasks": ["47.1"] },
    { "id": 221, "tasks": ["47.2"] },
    { "id": 222, "tasks": ["35.3"] },
    { "id": 223, "tasks": ["48.1"] },
    { "id": 224, "tasks": ["48.2"] },
    { "id": 225, "tasks": ["36.1"] },
    { "id": 226, "tasks": ["36.2"] },
    { "id": 227, "tasks": ["36.3"] },
    { "id": 228, "tasks": ["37.1"] },
    { "id": 229, "tasks": ["37.2"] },
    { "id": 230, "tasks": ["49.1"] },
    { "id": 231, "tasks": ["49.2"] },
    { "id": 232, "tasks": ["38.1"] },
    { "id": 233, "tasks": ["50.1"] },
    { "id": 234, "tasks": ["50.2"] },
    { "id": 235, "tasks": ["38.2"] },
    { "id": 236, "tasks": ["38.3"] },
    { "id": 237, "tasks": ["25.1"] },
    { "id": 238, "tasks": ["25.2"] },
    { "id": 239, "tasks": ["26.1"] },
    { "id": 240, "tasks": ["26.2"] },
    { "id": 241, "tasks": ["26.3"] },
    { "id": 242, "tasks": ["26.4"] },
    { "id": 243, "tasks": ["26.5"] },
    { "id": 244, "tasks": ["26.6"] }
  ]
}
```
