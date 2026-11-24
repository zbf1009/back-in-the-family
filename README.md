# Back in the Family

*Born here. Die here. Repeat.*

A reincarnation life-sim set in a small American town where, after a Halloween clerical error at the local branch of the underworld, everyone who dies in town can only be reborn into the town's own newborns.

Built for Kiroween 2026 (Frankenstein category). Development is done with Kiro CLI; the `.kiro/` directory (steering, specs) is part of this repository.

Baseline: spec 5, `underworld`, is done, audited (`docs/underworld-audit.md`) and deployed (2026-11-16): the deterministic life simulation includes Souls waiting for rebirth, joss paper, dreams, hauntings, Bribes, birth slots, imported vessels, rebuilt bodies and recorded external decision-node choices. That spec shipped replay version 4. The web shell (`web/`) is built — a Svelte 5 + Vite page that loads the WASM in a dedicated Web Worker and shows the tick, checksum and ticks-per-second, together with the Web_Build (into `web/dist`), the Type_Check, Unit_Tests and Smoke_Test gates, and the Cloudflare deploy workflow (enabled: every green push to `main` deploys to <https://back-in-the-family.2290698778.workers.dev>). The `llm-probe` spec is also built (the Probe_Runner in `eval/probe/`, the locked evaluation cards in `eval/cards/`, its Results in `eval/results/`, and the Report `docs/llm-probe.md`).

First-playable local status (2026-11-20): spec 6 is **accepted and audited locally**; see the [final audit](docs/first-playable-audit.md) and the gate and smoke evidence in `docs/kiro-log.md`. The rules-only browser loop includes the Narrator and Player_Node choices, Rebuilt_Body Set/Adjust Customization, Snapshot and stop seams, clock pacing, the unanswered-node advancement gate, Town_View, four template scenes, panels and the recorded playthrough. Replay version 5 (Canon version 6) consumes these inputs; versions 2, 3 and 4 are rejected, and native/WASM parity uses regenerated v5 fixtures. The browser Smoke_Test exercises choices, death, a template-text dream, Imported_Vessel rebirth and continued second-life play, comparing every recorded checksum. Spec 6 was pushed to `main` as `223cbf3`; the existing static production path is retained, and the main/static/publisher workflow succeeded for source `cab87be498a12cf4043c3c326b1dbc2ba1ff4991` (run `45321550513`, attempt `1`). The Spec 6 slice retains project-drawn placeholder shapes and includes no third-party media, model calls, generated presentation text, haunting or Bribe UI controls, or deploy button.

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zbf1009/back-in-the-family/tree/cloudflare-deploy)

Import the CI-published `cloudflare-deploy` artifact into **your own Cloudflare account**, not the `main` source tree or the private reviewer release. This is the single public deployment entry: one generic Worker with native `AI` and `ASSETS` bindings, prebuilt page/WASM/Worker bytes and the complete `LICENSE` and `NOTICE`. It needs no reviewer code, Secret or storage binding.

### Import settings

- Confirm the imported ref is `cloudflare-deploy` and choose a new Worker name in your copied configuration so deployment cannot overwrite an existing Worker.
- Use the imported repository root (`/`) and leave the **application build command empty**. No Rust, wasm-bindgen or Vite application build is needed; the checked application bytes are already included.
- Set Workers Builds environment variables `NODE_VERSION=26.7.0` and `PNPM_VERSION=10.33.1`. The root package also pins `pnpm@10.33.1` and Wrangler `4.157.0`; keep its supplied lockfile. Installing this pinned deployment SDK is expected, not an application build.
- Use `pnpm exec wrangler deploy` from that root. The supplied Wrangler configuration has `no_bundle: true`, deploys `./worker.js` and serves `./dist` through `ASSETS`; retain its native `AI` binding and Worker-first `/api` and `/api/*` routing.

The copy starts with `INFERENCE_ENABLED: "false"`: it is playable in rules-only mode using `Rules_Default`. Model use requires your explicit opt-in on your own account; it is not enabled by importing or clicking the button. Retain `MAX_REQUEST_BYTES: "16384"`, the cap on actual serialized UTF-8 request bytes—not a token/neuron conversion or a guarantee of ≤50 neurons.

The generic page-document default cap is **40 attempts**, not a server-enforced daily allowance. After opt-in, direct endpoint requests bypass that page cap and consume the account's shared Workers AI allocation; Free quota may be exhausted, Paid usage may incur charges, and provider/model availability is not guaranteed. This is separate from the private reviewer pool's **40 admissions per UTC day across all sessions**, **10 per session lifetime** and **86400-second session TTL**.

### Verified public delivery

The actual README button imported the permanent non-default ref into an owned disposable repository and deployed it through Workers Builds with an empty application build command and a pinned, SDK-only install. Real Create/Step/Run/Pause controls, checked page/WASM/Worker bytes, native AI/ASSETS, JSON API routing, disabled POST and SPA fallback were verified. The copy remained inference-disabled: **0 new model dispatches**, including **0 judge calls**. Its repository, Worker and Builds trigger/connection were cleaned up; the permanent button/ref and both production services were retained.

| Observed delivery | Identity / result |
|---|---|
| Source at import; successful main/static/publisher | `32100ed224595d0ec4d0645a0ae4e9cde640c7bf`; [run `45326300030/1`](https://github.com/zbf1009/back-in-the-family/actions/runs/45326300030/attempts/1) |
| Permanent artifact at import | [`83dd1ae56f46f2f18c60619f1d9121b79b1408a8`](https://github.com/zbf1009/back-in-the-family/commit/83dd1ae56f46f2f18c60619f1d9121b79b1408a8), on [`cloudflare-deploy`](https://github.com/zbf1009/back-in-the-family/tree/cloudflare-deploy) |
| Separate judge chain | [run `45328839414/1`](https://github.com/zbf1009/back-in-the-family/actions/runs/45328839414/attempts/1), success; original accepted judge identity remains `1701d2df26ede28c2a5ed422a6dbff0fcd7845dd` |
| Published delivery documentation; successful main/static/publisher | `b152d6fc81d26731c84ab759aea007cdcabb72e8`; [run `45354247253/1`](https://github.com/zbf1009/back-in-the-family/actions/runs/45354247253/attempts/1), with separate [judge run `45357996605/1`](https://github.com/zbf1009/back-in-the-family/actions/runs/45357996605/attempts/1) successful |
| Observed documentation artifact | [`899ad65f6c454311271d8f6e2d4b3f1e528ac5cf`](https://github.com/zbf1009/back-in-the-family/commit/899ad65f6c454311271d8f6e2d4b3f1e528ac5cf), after the import artifact above; deployment payload unchanged, excluding only provenance |

Two platform limits are disclosed rather than hidden: the import initially hit GitHub's anonymous rate-limit 403 and continued through the same UI after its real reset; the initial manual Build's `commit_hash` was blank, so the copied commit/tree and bytes were fetched independently. Also, `no_bundle` avoids an application rebuild, **not** auxiliary module discovery: the actual upload had seven multipart modules, including four SDK WASM/HTML auxiliaries. The public Git tree is closed and the main Worker/game WASM/page bytes are exact; no closed allowlist or single-module claim is made for Cloudflare's uploaded module tree.

See [permanent public delivery evidence and limitations](docs/slow-think-audit.md#permanent-public-delivery), including the local/ignored proof paths. Tasks **10.1–10.4 are execution-complete and ready for final Spec review**: delivery documentation was published and its main/static/publisher/judge CI success observed. **Final Spec acceptance remains pending**; this is not Spec 7 delivery PASS or a B/text implementation grant. The import and documentation identities above are observed; the next status-only closure commit/CI identity will come from Main's final handoff and is not invented here.

## Build and test

Prerequisites (Linux; commands below were run on Arch Linux):

- [`rustup`](https://rustup.rs). It reads `rust-toolchain.toml`, which pins Rust 1.99.1 with `rustfmt`, `clippy` and the `wasm32-unknown-unknown` target; if that toolchain is not installed yet, `rustup toolchain install` (run in the repository) installs it.
- [`mise`](https://mise.jdx.dev) with the project's `mise.toml`: `mise install` provides `wasm-bindgen-cli` 0.2.130 (it must equal the `wasm-bindgen` crate version in `Cargo.lock`; `scripts/check-wasm-bindgen.sh` checks this) and Node 26.7.0. Only the WASM steps need them.

Everything, in one command (several minutes from a clean `target/`, mostly the Rust test suite and the web gates):

```sh
scripts/gates.sh
```

It runs `cargo fmt --check`, a check that `sim-core`'s normal dependency tree has no `rand` or `getrandom`, `cargo clippy --workspace --all-targets -- -D warnings` (plus wasm32 clippy), `cargo test --workspace`, `sim-cli batch --seeds 1..=20 --ticks 2000` (release build; invariants after every tick and a record-and-verify round trip per seed), `sim-cli batch --seeds 1..=5 --ticks 29200 --require-targets` (passive 80-year runs: invariants and life-sim targets gated, underworld counts report-only), `sim-cli batch --seeds 1..=5 --ticks 29200 --devoted --require-reachability` (Devoted 80-year runs: invariants and eight applied underworld totals gated; birth claims, affordability candidates and life-sim targets report-only), the `bench`-feature test, `cargo test -p sim-wasm --target wasm32-unknown-unknown` (the fixtures replayed in Node), and `scripts/wasm-build.sh` (release build, `wasm-bindgen --target web` into `target/wasm-pkg`, and a check that every output file is under 25 MiB).

Tests only: `cargo test --workspace` (the property tests take about two and a half minutes in a debug build).

### Command-line runner

```sh
cargo run -p sim-cli -- --help
cargo run -p sim-cli -- record --seed 1 --ticks 2000 --random-inputs 120 --out /tmp/run.replay.json
cargo run -p sim-cli -- replay /tmp/run.replay.json      # exit 0 and "ok", or exit 1 and the first divergent tick
cargo run -p sim-cli -- snapshot --replay /tmp/run.replay.json --at 500 --out /tmp/snapshot.json  # read-only Snapshot JSON at tick 500
cargo run -p sim-cli -- batch --seeds 1..=20 --ticks 2000 # invariants after every tick, in-memory record and verify
cargo run -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets # passive: gate life-sim targets
cargo run -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --devoted --require-reachability # gate eight applied underworld totals
cargo run -p sim-cli -- check-size target/wasm-pkg --max-bytes 26214400
cargo run --release -p sim-cli -- measure                 # native timing of one 80-year lifetime (29,200 daily ticks)
```

`scripts/measure-wasm.sh` builds the WASM module with the `bench` feature and runs the same measurement in Node. One tick is one day.

### Fixtures

`fixtures/parity/*.replay.json` are four version 5 golden replay files: three 2,000-tick pairwise fixtures and `seedU-underworld.replay.json` (seed 185, 2,053 ticks), which records an external `Choose` for an underworld node. The native and WASM parity tests replay them and compare every tick's checksum. `fixtures/parity/seed1-pairwise.snapshot-500.json` is the native Snapshot at tick 500 of the first file, compared byte for byte by `crates/sim-wasm/tests/parity.rs`. Regenerate them only after an intentional change to tick logic, random streams, the canonical encoding or the replay format: `scripts/regen-fixtures.sh`, twice, then compare SHA-256 manifests and per-tick checksum arrays. A replay-version-only migration keeps simulation checksums unchanged. Details are in `fixtures/parity/README.md`.

Kiro hooks were tried and removed on 2026-11-04: they ran only on the agent's edit-tool saves and on task completions, and their output did not reach the agent. The evidence is in `docs/kiro-log.md` and `docs/sim-core-skeleton-audit.md`; `sim-cli batch` is now a gate step instead.

Other documents: `docs/tick-granularity.md` (measurement behind the 1-day tick), `docs/sim-core-skeleton-audit.md` (requirement-by-requirement check of the first spec), `docs/kiro-log.md` (how Kiro was used).

### Web app (`web/`)

The browser front end lives in `web/`. It needs Node and pnpm from `mise`, and the Smoke_Test needs the system Google Chrome (it is driven through `channel: 'chrome'` and downloads no browser of its own). Run each command from the repository root.

1. Install the pinned tools and the pnpm dependencies:

   ```sh
   mise install
   mise exec -- pnpm --dir web install --frozen-lockfile
   ```

2. Web_Build — build the WASM, then the web app into `web/dist`, with the per-file size, `.wasm` byte-identity, main-bundle boundary, leak and media-inventory checks. `web/assets/ASSETS.json` lists each deployed media file as `{ "path": "path/relative/to/dist.png", "source": "project" }` or names a pack credited in the third-party table below; the placeholder-only slice uses an empty list:

   ```sh
   scripts/web-build.sh
   ```

3. Local_Preview — serve `web/dist` on <http://localhost:4173> without contacting Cloudflare (Ctrl-C to stop):

   ```sh
   mise exec -- pnpm --dir web run preview
   ```

4. Smoke_Test — `@playwright/test` on the system Chrome against `web/dist` (no browser download); it starts its own preview server:

   ```sh
   mise exec -- pnpm --dir web run test:smoke
   ```

`scripts/gates.sh` runs offline against separately prepared pinned tools and dependency stores: the pnpm version check, Type_Check, Unit_Tests, Web_Build, Worker_Build and actual Worker runtime/router tests, then Artifact_Check and its built-input artifact/publisher consumer tests. Smoke_Test remains the last gate. Gates do not install dependencies or download tools.

#### Decision Worker transport policy (Spec 7)

The [Spec 7 design](.kiro/specs/slow-think/design.md) selects a project transport policy: [source Worker configuration](worker-api/wrangler.jsonc) explicitly sets `MAX_REQUEST_BYTES` to the string `"16384"` and `INFERENCE_ENABLED` to `false`. Same-origin, closed-schema Clef requests are capped by their actual serialized UTF-8 bytes; oversized requests return HTTP 413 `payload_too_large` and use the checked `Rules_Default` fallback. A missing cap is not filled with a default.

This is not a token/neuron conversion or a guarantee of ≤50 neurons. The page-document default of 40 attempts is not a server limit: after explicit own-account opt-in, direct calls consume the account's shared quota, may exhaust Free allocation, and may incur Paid charges. Production retains the Spec 6 static hosting path; the separately enabled artifact publisher does not select hosted inference or change the copied project's default-off policy.

#### Hosted candidate preparation and rollback (Spec 7, leaf 5.4)

[`worker-api/hosted-candidate.jsonc`](worker-api/hosted-candidate.jsonc) is an offline deploy candidate, not a selected production config. Its draft Worker name is **not an approved release target**. It consumes the already checked `target/decision-worker/worker.js` with `no_bundle: true` and the same checked `web/dist`; it retains the source runtime date `2026-11-10`, native non-remote AI, exact and wildcard API Worker-first routing, SPA fallback, telemetry off, `MAX_REQUEST_BYTES: "16384"` and `INFERENCE_ENABLED: "false"`.

After the existing builds are checked, `scripts/offline-gates.sh node scripts/check-hosted-candidate.ts` checks the pinned Wrangler config/API, source and bundle stamp, existing asset checks and production-path identity without rebuilding or deploying. Current production CI still runs `mise exec -- pnpm exec wrangler deploy` from `web/` with the byte-exact static `web/wrangler.jsonc`. Green `main`, existing `DEPLOY_ENABLED`, C3 or C4 acceptance, and permanent publisher approval do not select the candidate or enable inference; this checker grants no release authority.

Later activation requires separate explicit Author approval after verified 5.3 and green checks. That approval must name the actual hosted target, checked revision, measured 16,384-byte cap, inference enablement and **automatic deployment on green `main`**. No approval or default from another scope inherits these decisions. Any workflow/config selection or enabling-variable change must be part of that separately approved release, not this preparation.

The rollback plan is to turn hosted inference off and restore the prior assets-only `web/wrangler.jsonc` and `web/` static deployment path with its prior checked assets. Keep `Rules_Default` fallback while hosted inference is enabled. No push, deploy, activation or rollback command is currently authorized by leaf 5.4.

#### Offline artifact preparation and Artifact_Check (Spec 7, leaves 6.1–6.2)

The source tree builds and checks the application; an artifact tree contains only checked `dist/`, `worker.js` outside `dist`, in-root Wrangler config, pinned deploy metadata, `LICENSE`, [`NOTICE`](worker-api/artifact-deploy/NOTICE) and public provenance. It has no application build script, Rust/Vite dependencies, source, tests, probe data or model weights. The minimal private ESM package pins pnpm `10.33.1`, Wrangler `4.157.0` and its existing `@types/node` peer `26.6.6`.

Run the separate structured lock preparation from the repository root when deploy metadata changes. It uses the existing prepared `target/gate-cache/node.path` and a structured selector to copy the minimal package's complete reachable deployment SDK graph from the healthy `web/pnpm-lock.yaml`, preserving peer contexts, native/optional/platform edges and resolution metadata without application or unreachable nodes. An owned temporary workspace isolates HOME, credentials/proxies and the network. No package-manager bootstrap, dependency install, application build or package scripts run. It writes only the generated deploy lock back; the web lock and all pinned versions stay untouched. It is **not** an install inside a gate or Artifact_Check.

```sh
set -eu
bash scripts/prepare-artifact-metadata.sh
# After the existing Web_Build and Worker_Build have produced checked bytes:
artifact_work=$(mktemp -d target/artifact-example.XXXXXX)
trap 'rm -rf -- "$artifact_work"' EXIT
prepared=$(scripts/offline-gates.sh node scripts/stage-artifact.ts --prepare \
  --output "$artifact_work/transport")
envelope_sha=$(node -e 'const p=JSON.parse(process.argv[1]); if (!/^[a-f0-9]{64}$/.test(p.envelopeSHA)) throw new Error("Invalid checked envelope SHA"); process.stdout.write(p.envelopeSHA)' "$prepared")
scripts/offline-gates.sh node scripts/check-artifact.ts \
  --input "$artifact_work/transport" --envelope-sha "$envelope_sha"
scripts/offline-gates.sh node scripts/stage-artifact.ts \
  --input "$artifact_work/transport" --output "$artifact_work/candidate" \
  --envelope-sha "$envelope_sha"
```

Preparation requires a fresh output directory and is the only path that collects checked build inputs and runtime license sources. It writes a self-contained private `inputs.json` beside `tree/`, including the exact source-bound license closure; that closure is not a public artifact file and never appears in public provenance. Capture the digest from the successful producer's JSON stdout independently of the transferred envelope, as above; never recompute the expected digest from a received envelope or public provenance. Ordinary checking and staging require `--envelope-sha` even for the default local identity (actual HEAD, run `local`, attempt `1`). For CI identities, pass the complete `--source-commit`, `--run-id` and `--run-attempt` tuple to preparation and every consumer, along with the independently captured digest for consumers.

The commands above use the source checkout's general offline-gate wrapper and its prepared build tools. An independent consumer instead runs the copied check/stage/publish CLI from a fresh matching source checkout in a sanitized, loopback-only Node environment with its own prepared pinned checker SDK. It needs no Cargo executable or store, Rust toolchain or `rustc.path`, local Svelte license source, producer build outputs or borrowed dependency-directory links. Checking and staging validate the authenticated private closure and exact public bytes without collecting licenses, installing dependencies, rebuilding or contacting Cloudflare.

After Web_Build, Worker_Build and Worker runtime/router tests, `scripts/gates.sh` captures preparation stdout and passes its digest explicitly to Artifact_Check, followed by the built-input artifact, publisher and per-boundary CLI consumer tests. It removes only its fresh owned transport on exit and keeps Smoke_Test last. This wiring does not claim full clean-gate, C4 or live-release acceptance.

The gate/build job transports immutable checked bytes and an independently bound envelope digest to a separate publisher; the publisher never rebuilds. Its job and branch-write step are enabled under the separate permanent public deployment Author grant for tasks 10.1–10.4. Successful source workflow `45326300030/1` published the checked `refs/heads/cloudflare-deploy` at `83dd1ae56f46f2f18c60619f1d9121b79b1408a8`, bound to source `32100ed224595d0ec4d0645a0ae4e9cde640c7bf`, after predecessor `805ac01dfc7c66b2ccc8bcf109a3218a658f3045`; authenticated CI transport and the actual ref's closed public bytes were verified. The actual default-off button/import proof is recorded above and in the audit. Publication does not select the generic hosted candidate or alter the separate private reviewer release; any model opt-in uses the deployer's own account and shared Free/Paid quota, as described in NOTICE.

**Historical permanent rollout decision (8.1, before the public-delivery grant):** C4's functional checkpoint was accepted using the separately authorized real button/infrastructure and Clef-applied replay evidence. At that checkpoint, permanent publisher writes, its target ref and the README Deploy button were **not authorized**; both hard-false guards remained unchanged. The released next steps were final local offline verification and audit through C5, not hosted activation or publication. The later permanent public deployment grant is a separate rollout decision, not authority inherited from C4 or C5.

**Historical C5 local verification:** Complete offline gate coverage passed by continuous execution from a clean build, with the original failures retained and only affected checks resumed after local repairs—not a single-script exit-zero claim. Final real system-Chrome Smoke_Test passed 13/13; the checked Worker and WASM bytes still match accepted C4. The [independent audit](docs/slow-think-audit.md) separates local/fake evidence, retained real C3/C4 evidence and the release actions unauthorized in that historical scope. C5 made zero real model calls and no remote changes. Spec 6 was the last previously confirmed production release at C5; C5 did not query or deploy production. Its scope ended at C5 for review.

CI transport uses MIT-licensed [`actions/upload-artifact` v4.6.2](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/LICENSE) and [`actions/download-artifact` v4.3.0](https://github.com/actions/download-artifact/blob/d3f86a106a0bac45b974a628896c90dbdf5c8093/LICENSE), pinned to the exact revisions in those links. These CI actions are not distributed artifact runtime code.


#### Private-code reviewer release (`judge-demo-release`)

The separate [judge release](worker-api/judge.jsonc) adds private-code access to the existing native Decision demo while leaving the public rules-only game unchanged.

The reviewer pool permits **40 application admissions per UTC day shared across all sessions** and **10 per session lifetime**, with a session TTL of **86400 seconds**. UTC midnight resets only the shared daily allowance; refresh, repeated login and redeploy do not reset a session's lifetime count. The stable reviewer namespace/pool and counters are retained across this public-delivery continuation; no new balance equality is claimed. Model failure, invalid output, timeout or exhausted allowance uses the existing `Rules_Default` fallback; a reserved admission is not refunded when dispatch fails.

Reviewer code is delivered privately and kept outside the repository and artifacts; neither code nor session tokens belong in URLs or Web Storage. This independent judge release did not authorize the public button or permanent artifact publication; those are enabled by the later, separate public-delivery grant and use the generic default-off artifact, not the reviewer release. Local checks in `docs/kiro-log.md` are not a live-release acceptance claim.

### LLM probe (`eval/probe/`)

The probe runs the locked evaluation cards (`eval/cards/`) against the candidate runtimes and writes Results under `eval/results/`; the Report is `docs/llm-probe.md` and the requirement-by-requirement audit is `docs/llm-probe-audit.md`. Every command below runs from the repository root through `pnpm --dir eval/probe run probe <command>` (written `probe <command>` in the list; wrap it as shown in the first block). The package is separate from `web/` and nothing under `web/src` may import from `eval/` (the `check-web-imports` gate).

Never open or print the files under `eval/cards/` that are marked locked or blind, and never commit the root `env` file (it is gitignored; only the commands that call Workers AI read it, and only after every other check passed).

1. Install, then the local checks (no network, no token, no `env`):

   ```sh
   mise install
   mise exec -- pnpm --dir eval/probe install --frozen-lockfile
   mise exec -- pnpm --dir eval/probe run probe check-manifest        # the eval/cards Manifest must hash to the pinned value
   mise exec -- pnpm --dir eval/probe run typecheck
   mise exec -- pnpm --dir eval/probe run test:unit
   mise exec -- pnpm --dir eval/probe run probe check-web-imports     # no file under web/src imports from eval/
   ```

2. Screening and preflight (`--combo` takes a Combination ID from `eval/probe/combinations.json`, for example `workers-ai/clef`):

   ```sh
   mise exec -- pnpm --dir eval/probe run probe screen [--write] [--exclude-unpinned]
   mise exec -- pnpm --dir eval/probe run probe preflight --combo <id> [--force]
   ```

3. Workers AI Smoke_Calls on Dev_Cards only (needs the root `env` token):

   ```sh
   mise exec -- pnpm --dir eval/probe run probe smoke --combo <id> [--count <n>] [--task D|S] [--timeout-ms <ms>] [--max-tokens <n>] [--diagnose]
   ```

4. Runs. `dev-run` uses the Dev_Cards; `locked-run` uses the Locked_Cards, writes a ledger entry and needs an approval ID from `eval/probe/approvals.json`. A resumed run takes only `--resume`:

   ```sh
   mise exec -- pnpm --dir eval/probe run probe dev-run --combo <id> [--task D|S|DS] [--approval <id>] [--timeout-ms <ms>]
   mise exec -- pnpm --dir eval/probe run probe locked-run --combo <id> --task D|S|DS [--approval <id>] [--timeout-ms <ms>] [--rerun-reason <text>]
   mise exec -- pnpm --dir eval/probe run probe locked-run --resume <entry-id> [--approval <id>] [--timeout-ms <ms>]
   ```

5. Browser Combinations (WebLLM, transformers.js) run in the Probe_Page. `page-serve` builds and serves it on `localhost:4318` and prints a new empty Fresh_Profile directory (Ctrl-C to stop). `page-bundle` writes the cards bundle the page loads; `ingest` reads the JSON export the page produces; `regrade` re-grades a stored Results file:

   ```sh
   mise exec -- pnpm --dir eval/probe run probe page-serve
   mise exec -- pnpm --dir eval/probe run probe page-bundle --combo <id> --split dev|locked --task D|S|DS [--timeout-ms <ms>] [--rerun-reason <text>]
   mise exec -- pnpm --dir eval/probe run probe ingest --file <export.json>
   mise exec -- pnpm --dir eval/probe run probe regrade --results <results.jsonl>
   ```

6. Later commands. `derive` builds a `perm_avg` Derived_Run from the stored `single` Results (no network, no `env`, no budget, no ledger line; `--verify` is a boolean flag); `ingest-reference` stores an External_Reference_File under `eval/results/external/<label>/` (no request, no `env`); `ledger` prints the ledger:

   ```sh
   mise exec -- pnpm --dir eval/probe run probe derive --combo <perm_avg combination id> --split dev|locked --approval <id> [--task D] [--verify]
   mise exec -- pnpm --dir eval/probe run probe ingest-reference --file <external-reference.json>
   mise exec -- pnpm --dir eval/probe run probe ledger
   ```

7. Status and Report. `phase-status` prints the phase state and the pass results from the stored grades; `report` regenerates `docs/llm-probe.md` from the ledger, the Results and the approvals on `HEAD`:

   ```sh
   mise exec -- pnpm --dir eval/probe run probe phase-status
   mise exec -- pnpm --dir eval/probe run probe report
   ```

The grading golden file in `fixtures/grading/` is regenerated only on purpose with `scripts/regen-grading-golden.sh`; read the diff afterwards. `scripts/gates.sh` runs the probe install, `check-manifest`, Type_Check, Unit_Tests and `check-web-imports`; it sends no request and reads no `env`.

The licenses of the Clef models (`@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash`) are **unverified**: the Hugging Face license URL was not visible on the official model pages (audit gap 12 in `docs/llm-probe-audit.md`). Until the Author checks it, no license is claimed for them here.

## Prior work disclosure

- **Design notes.** The game concept was sketched in private notes before the
  submission period began. No code, assets, or text from those notes are in
  this repository.
- **Research consulted for ideas only, no code used:** *Talk of the Town*
  (James Ryan, *Curating Simulated Storyworlds*, 2018), *Neighborly*
  (Johnson-Bey et al., IEEE CoG 2022), and *Felt* (Kreminski et al.).
- **Verifiable history.** This repository started empty; its first commit
  contains only the license, this README, and `.gitignore`. All code was
  written during the Kiroween 2026 submission period and can be traced
  through the commit history.

## Third-party libraries and assets

The Name_List in `crates/sim-core/src/names.rs` is the project's own: written for this project, Apache-2.0 (same as the repository). It is not third-party data.
The Magistrate's name in `crates/sim-core/src/underworld/magistrate.rs` is also the project's own, not third-party data. The underworld implementation added no new third-party package; the only Rust lockfile change adds the already-listed `proptest` as a `sim-cli` test dependency.

| Name | Version | License | Used for |
|---|---|---|---|
| [`blake3`](https://crates.io/crates/blake3) (feature `pure`, default features off) | 1.8.7 | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception | Per-tick state checksum in `sim-core` (first 8 bytes of the BLAKE3 hash of the canonical encoding) |
| [`serde`](https://crates.io/crates/serde) (feature `derive`) | 1.0.229 | MIT OR Apache-2.0 | Replay file (de)serialization in `sim-core`, confined to the DTO types in `replay.rs` |
| [`serde_json`](https://crates.io/crates/serde_json) | 1.0.154 | MIT OR Apache-2.0 | Replay file JSON reading and writing in `sim-core`; reads the `--config` file in `sim-cli` |
| [`serde_core`](https://crates.io/crates/serde_core) | 1.0.229 | MIT OR Apache-2.0 | Transitive (`serde`, `serde_json`): serde's core traits |
| [`serde_derive`](https://crates.io/crates/serde_derive) | 1.0.229 | MIT OR Apache-2.0 | Transitive (`serde`): derive macros, build-time only |
| [`proc-macro2`](https://crates.io/crates/proc-macro2) | 1.0.107 | MIT OR Apache-2.0 | Transitive (`serde_derive`): proc-macro support, build-time only |
| [`quote`](https://crates.io/crates/quote) | 1.0.47 | MIT OR Apache-2.0 | Transitive (`serde_derive`): code generation, build-time only |
| [`syn`](https://crates.io/crates/syn) | 3.0.9 | MIT OR Apache-2.0 | Transitive (`serde_derive`): Rust parser, build-time only |
| [`unicode-ident`](https://crates.io/crates/unicode-ident) | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | Transitive (`proc-macro2`, `syn`): identifier tables, build-time only |
| [`itoa`](https://crates.io/crates/itoa) | 1.0.18 | MIT OR Apache-2.0 | Transitive (`serde_json`): integer formatting |
| [`memchr`](https://crates.io/crates/memchr) | 2.8.3 | Unlicense OR MIT | Transitive (`serde_json`): byte search |
| [`zmij`](https://crates.io/crates/zmij) | 1.0.23 | MIT | Transitive (`serde_json`): number formatting |
| [`arrayvec`](https://crates.io/crates/arrayvec) | 0.7.8 | MIT OR Apache-2.0 | Transitive (`blake3`): fixed-capacity vectors |
| [`cfg-if`](https://crates.io/crates/cfg-if) | 1.0.5 | MIT OR Apache-2.0 | Transitive (`blake3`): conditional compilation macro |
| [`constant_time_eq`](https://crates.io/crates/constant_time_eq) | 0.4.2 | CC0-1.0 OR MIT-0 OR Apache-2.0 | Transitive (`blake3`): constant-time comparison |
| [`cpufeatures`](https://crates.io/crates/cpufeatures) | 0.3.1 | MIT OR Apache-2.0 | Transitive (`blake3`): CPU feature detection |
| [`proptest`](https://crates.io/crates/proptest) | 1.12.0 | MIT OR Apache-2.0 | Dev/test only: property-based tests in `sim-core/tests/properties.rs` (generates test inputs; never used by the simulation) |
| [`rand`](https://crates.io/crates/rand) | 0.10.3 | MIT OR Apache-2.0 | Dev/test only; transitive (`proptest`): random test-input generation |
| [`rand_core`](https://crates.io/crates/rand_core) | 0.10.1 | MIT OR Apache-2.0 | Dev/test only; transitive (`rand`, `chacha20`, `getrandom`, `rand_xorshift`) |
| [`rand_xorshift`](https://crates.io/crates/rand_xorshift) | 0.5.0 | MIT OR Apache-2.0 | Dev/test only; transitive (`proptest`) |
| [`chacha20`](https://crates.io/crates/chacha20) | 0.10.2 | MIT OR Apache-2.0 | Dev/test only; transitive (`proptest`) |
| [`core_detect`](https://crates.io/crates/core_detect) | 1.0.0 | MIT/Apache-2.0 | Dev/test only; transitive (`proptest`) |
| [`getrandom`](https://crates.io/crates/getrandom) | 0.4.3 | MIT OR Apache-2.0 | Dev/test only; transitive (`rand`, `tempfile`) |
| [`bit-set`](https://crates.io/crates/bit-set) | 0.11.1 | Apache-2.0 OR MIT | Dev/test only; transitive (`proptest`) |
| [`bit-vec`](https://crates.io/crates/bit-vec) | 0.10.1 | Apache-2.0 OR MIT | Dev/test only; transitive (`bit-set`) |
| [`bitflags`](https://crates.io/crates/bitflags) | 2.13.2 | MIT OR Apache-2.0 | Dev/test only; transitive (`proptest`, `rustix`) |
| [`num-traits`](https://crates.io/crates/num-traits) | 0.2.19 | MIT OR Apache-2.0 | Dev/test only; transitive (`proptest`) |
| [`regex-syntax`](https://crates.io/crates/regex-syntax) | 0.8.11 | MIT OR Apache-2.0 | Dev/test only; transitive (`proptest`): regex-based string strategies |
| [`rusty-fork`](https://crates.io/crates/rusty-fork) | 0.3.1 | MIT/Apache-2.0 | Dev/test only; transitive (`proptest`): forked test runs |
| [`wait-timeout`](https://crates.io/crates/wait-timeout) | 0.2.1 | MIT/Apache-2.0 | Dev/test only; transitive (`rusty-fork`) |
| [`quick-error`](https://crates.io/crates/quick-error) | 1.2.3 | MIT/Apache-2.0 | Dev/test only; transitive (`rusty-fork`) |
| [`fnv`](https://crates.io/crates/fnv) | 1.0.7 | Apache-2.0 / MIT | Dev/test only; transitive (`rusty-fork`) |
| [`tempfile`](https://crates.io/crates/tempfile) | 3.27.0 | MIT OR Apache-2.0 | Dev/test only; transitive (`rusty-fork`) |
| [`fastrand`](https://crates.io/crates/fastrand) | 2.5.0 | Apache-2.0 OR MIT | Dev/test only; transitive (`tempfile`) |
| [`once_cell`](https://crates.io/crates/once_cell) | 1.21.4 | MIT OR Apache-2.0 | Dev/test only; transitive (`tempfile`) |
| [`errno`](https://crates.io/crates/errno) | 0.3.14 | MIT OR Apache-2.0 | Dev/test only; transitive (`rustix`) |
| [`rustix`](https://crates.io/crates/rustix) | 1.1.6 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | Dev/test only; transitive (`tempfile`) |
| [`linux-raw-sys`](https://crates.io/crates/linux-raw-sys) | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | Dev/test only; transitive (`rustix`), Linux only |
| [`unarray`](https://crates.io/crates/unarray) | 0.1.4 | MIT OR Apache-2.0 | Dev/test only; transitive (`proptest`) |
| [`r-efi`](https://crates.io/crates/r-efi) | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later | Dev/test only; transitive (`getrandom`), UEFI targets only; used under MIT OR Apache-2.0 |
| [`windows-sys`](https://crates.io/crates/windows-sys) | 0.61.2 | MIT OR Apache-2.0 | Dev/test only; transitive (`errno`, `rustix`, `tempfile`), Windows only |
| [`windows-link`](https://crates.io/crates/windows-link) | 0.2.1 | MIT OR Apache-2.0 | Dev/test only; transitive (`windows-sys`), Windows only |
| [`wasm-bindgen`](https://crates.io/crates/wasm-bindgen) | 0.2.130 | MIT OR Apache-2.0 | Rust/JavaScript bindings in `sim-wasm` (exact pin `=0.2.130`; the CLI from `mise.toml` must match). Compiled for the host too, but only meaningful on wasm32 |
| [`wasm-bindgen-macro`](https://crates.io/crates/wasm-bindgen-macro) | 0.2.130 | MIT OR Apache-2.0 | Transitive (`wasm-bindgen`): `#[wasm_bindgen]` proc macro, build-time only |
| [`wasm-bindgen-macro-support`](https://crates.io/crates/wasm-bindgen-macro-support) | 0.2.130 | MIT OR Apache-2.0 | Transitive (`wasm-bindgen-macro`): macro implementation, build-time only |
| [`wasm-bindgen-shared`](https://crates.io/crates/wasm-bindgen-shared) | 0.2.130 | MIT OR Apache-2.0 | Transitive (`wasm-bindgen`): schema shared with the CLI |
| [`bumpalo`](https://crates.io/crates/bumpalo) | 3.20.3 | MIT OR Apache-2.0 | Transitive (`wasm-bindgen-macro-support`): arena allocator, build-time only |
| [`rustversion`](https://crates.io/crates/rustversion) | 1.0.23 | MIT OR Apache-2.0 | Transitive (`wasm-bindgen`): rustc version cfgs, build-time only |
| [`wasm-bindgen-test`](https://crates.io/crates/wasm-bindgen-test) | 0.3.80 | MIT OR Apache-2.0 | Dev/test only: `sim-wasm/tests/parity.rs`, run natively and in Node via `wasm-bindgen-test-runner` |
| [`wasm-bindgen-test-macro`](https://crates.io/crates/wasm-bindgen-test-macro) | 0.3.80 | MIT OR Apache-2.0 | Dev/test only; transitive (`wasm-bindgen-test`): `#[wasm_bindgen_test]` proc macro |
| [`wasm-bindgen-test-shared`](https://crates.io/crates/wasm-bindgen-test-shared) | 0.2.130 | MIT OR Apache-2.0 | Dev/test only; transitive (`wasm-bindgen-test`): shared with the test runner |
| [`js-sys`](https://crates.io/crates/js-sys) | 0.3.107 | MIT OR Apache-2.0 | Dev/test only; transitive (`wasm-bindgen-test`, `wasm-bindgen-futures`): JavaScript built-in bindings (wasm32 targets) |
| [`wasm-bindgen-futures`](https://crates.io/crates/wasm-bindgen-futures) | 0.4.80 | MIT OR Apache-2.0 | Dev/test only; transitive (`wasm-bindgen-test`): async test support (wasm32 targets) |
| [`minicov`](https://crates.io/crates/minicov) | 0.3.8 | Apache-2.0/MIT | Dev/test only; transitive (`wasm-bindgen-test`): coverage runtime (wasm32 targets) |
| [`nu-ansi-term`](https://crates.io/crates/nu-ansi-term) | 0.50.3 | MIT | Dev/test only; transitive (`wasm-bindgen-test`): coloured test output |
| [`cast`](https://crates.io/crates/cast) | 0.3.0 | MIT OR Apache-2.0 | Dev/test only; transitive (`wasm-bindgen-test`): checked numeric casts |
| [`oorandom`](https://crates.io/crates/oorandom) | 11.1.5 | MIT | Dev/test only; transitive (`wasm-bindgen-test`): test-order shuffling (not used by the simulation) |
| [`libm`](https://crates.io/crates/libm) | 0.2.16 | MIT | Dev/test only; transitive (`wasm-bindgen-test`, `num-traits`): math routines |
| [`walkdir`](https://crates.io/crates/walkdir) | 2.5.0 | Unlicense/MIT | Dev/test only; transitive (`minicov`): directory walking |
| [`same-file`](https://crates.io/crates/same-file) | 1.0.6 | Unlicense/MIT | Dev/test only; transitive (`walkdir`) |
| [`winapi-util`](https://crates.io/crates/winapi-util) | 0.1.11 | Unlicense OR MIT | Dev/test only; transitive (`same-file`): Windows helpers |
| [`futures-util`](https://crates.io/crates/futures-util) | 0.3.34 | MIT OR Apache-2.0 | Dev/test only; transitive (`js-sys`) |
| [`futures-core`](https://crates.io/crates/futures-core) | 0.3.34 | MIT OR Apache-2.0 | Dev/test only; transitive (`futures-util`) |
| [`futures-task`](https://crates.io/crates/futures-task) | 0.3.34 | MIT OR Apache-2.0 | Dev/test only; transitive (`futures-util`) |
| [`pin-project-lite`](https://crates.io/crates/pin-project-lite) | 0.2.17 | Apache-2.0 OR MIT | Dev/test only; transitive (`futures-util`, `tokio`) |
| [`slab`](https://crates.io/crates/slab) | 0.4.12 | MIT | Dev/test only; transitive (`futures-util`) |
| [`tokio`](https://crates.io/crates/tokio) | 1.54.1 | MIT | Dev/test only; transitive (`wasm-bindgen-futures`): appears in the dev-dependency tree; not used by the simulation |
| [`cc`](https://crates.io/crates/cc) | 1.11.0 | MIT OR Apache-2.0 | Build-time only; transitive (`blake3`, `minicov`): C compiler driver for build scripts |
| [`find-msvc-tools`](https://crates.io/crates/find-msvc-tools) | 0.1.15 | MIT OR Apache-2.0 | Build-time only; transitive (`cc`) |
| [`shlex`](https://crates.io/crates/shlex) | 2.0.1 | MIT OR Apache-2.0 | Build-time only; transitive (`cc`) |
| [`autocfg`](https://crates.io/crates/autocfg) | 1.5.1 | Apache-2.0 OR MIT | Build-time only; transitive (`num-traits`) |
| [`libc`](https://crates.io/crates/libc) | 0.2.191 | MIT OR Apache-2.0 | Transitive (`cpufeatures`, `errno`, `getrandom`): C library bindings (native only) |
| [`borsh`](https://crates.io/crates/borsh) | 1.8.1 | MIT OR Apache-2.0 | Lockfile only, not compiled: optional dependency of `bit-vec` (feature off); `cargo tree --workspace --target all` does not list it |
| [`borsh-derive`](https://crates.io/crates/borsh-derive) | 1.8.1 | Apache-2.0 | Lockfile only, not compiled; transitive (`borsh`) |
| [`bytes`](https://crates.io/crates/bytes) | 1.12.1 | MIT | Lockfile only, not compiled; transitive (`borsh`) |
| [`cfg_aliases`](https://crates.io/crates/cfg_aliases) | 0.2.2 | MIT | Lockfile only, not compiled; transitive (`borsh`) |
| [`proc-macro-crate`](https://crates.io/crates/proc-macro-crate) | 3.5.0 | MIT OR Apache-2.0 | Lockfile only, not compiled; transitive (`borsh-derive`) |
| [`toml_edit`](https://crates.io/crates/toml_edit) | 0.25.18+spec-1.1.0 | MIT OR Apache-2.0 | Lockfile only, not compiled; transitive (`proc-macro-crate`) |
| [`toml_datetime`](https://crates.io/crates/toml_datetime) | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | Lockfile only, not compiled; transitive (`toml_edit`) |
| [`toml_parser`](https://crates.io/crates/toml_parser) | 1.1.5+spec-1.1.0 | MIT OR Apache-2.0 | Lockfile only, not compiled; transitive (`toml_edit`) |
| [`winnow`](https://crates.io/crates/winnow) | 1.0.4 | MIT | Lockfile only, not compiled; transitive (`toml_edit`, `toml_parser`) |
| [`indexmap`](https://crates.io/crates/indexmap) | 2.14.2 | Apache-2.0 OR MIT | Lockfile only, not compiled; transitive (`toml_edit`) |
| [`hashbrown`](https://crates.io/crates/hashbrown) | 0.17.1 | MIT OR Apache-2.0 | Lockfile only, not compiled; transitive (`indexmap`) |
| [`equivalent`](https://crates.io/crates/equivalent) | 1.0.3 | Apache-2.0 OR MIT | Lockfile only, not compiled; transitive (`indexmap`) |

The Rust rows match `Cargo.lock` (versions) and the crates' manifests (SPDX strings), checked on 2026-11-10. Nothing in the `llm-probe` spec added a Rust dependency; the twelve "lockfile only" rows were missing from this table and are the optional `borsh` branch of `bit-vec`.

More entries are added here as libraries and assets arrive.

### Web app (`web/`) dependencies

Resolved versions are from the committed `web/pnpm-lock.yaml`; licenses are the SPDX identifiers on the npm registry. All ten are dev dependencies. Transitive packages whose code reaches the Deploy_Directory are added from the build report in task 4; so far only `svelte` is bundled (`web/.bundle-report.json`), so `wrangler` is a dev/deploy tool and is not part of `web/dist`.

| Name | Version | License | Used for |
|---|---|---|---|
| [`svelte`](https://www.npmjs.com/package/svelte) | 5.57.3 | MIT | Main_Thread UI framework; the only direct dependency whose runtime code is bundled into `web/dist` |
| [`vite`](https://www.npmjs.com/package/vite) | 8.3.5 | MIT | Dev server and the Web_Build bundler |
| [`@sveltejs/vite-plugin-svelte`](https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte) | 7.3.1 | MIT | Compiles `.svelte` files under Vite (build-time only) |
| [`svelte-check`](https://www.npmjs.com/package/svelte-check) | 4.7.8 | MIT | Type_Check of `.svelte` and `.ts` files (dev/gate only) |
| [`typescript`](https://www.npmjs.com/package/typescript) | 6.0.3 | Apache-2.0 | `tsc` type check and the peer compiler for `svelte-check` (dev/gate only); pinned to 6.x because `svelte-check` 4.7.8 does not accept TypeScript 7 |
| [`@types/node`](https://www.npmjs.com/package/@types/node) | 26.6.6 | MIT | Node type declarations for scripts, configs and tests (dev/gate only) |
| [`@playwright/test`](https://www.npmjs.com/package/@playwright/test) | 1.64.1 | Apache-2.0 | Browser Smoke_Test driver using the system Chrome (dev/gate only; no browser download) |
| [`fast-check`](https://www.npmjs.com/package/fast-check) | 4.10.2 | MIT | Property-based testing in the web Unit_Tests (dev/test only) |
| [`wrangler`](https://www.npmjs.com/package/wrangler) | 4.157.0 | MIT OR Apache-2.0 | Deploy `web/dist` to Cloudflare Workers Static Assets (dev/deploy only). NOT bundled into `web/dist`; the Deploy_Workflow runs `pnpm exec wrangler deploy` from `web/` |
| [`yaml`](https://www.npmjs.com/package/yaml) | 2.8.1 | ISC | Structured source-lock selection and Artifact_Check validation (checker/dev only); not an application runtime dependency or a public deploy root |

The exact YAML [official tarball](https://registry.npmjs.org/yaml/-/yaml-2.8.1.tgz) was verified against `sha512-lcYcMxX2PO9XMGvAJkJ3OsNMw+/7FKes7/hgerGUYWIoWu5j/+YQqcZr5JnPZWzOsEBgMbSbiSTn/dv/69Mkpw==`. Its [manifest](https://registry.npmjs.org/yaml/2.8.1) and packaged [ISC license](https://github.com/eemeli/yaml/blob/1dc3c3ba06971613d0bcb772da4711ca25343dac/LICENSE) were inspected: built-in TypeScript types, Node >=14.6, no runtime dependencies and no install/preinstall/postinstall/prepare lifecycle script.



### Probe_Runner (`eval/probe/`) dependencies

Resolved versions are from the committed `eval/probe/pnpm-lock.yaml`; licenses are the SPDX identifiers on the npm registry. TypeScript, `@types/node`, `fast-check`, Vite and Playwright are dev dependencies pinned to the same versions as `web/`. The in-browser runtimes are used only by the Probe_Page and its adapters; none of these packages is in `web/`. Playwright drives the system Chrome and downloads no browser (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

| Name | Version | License | Used for |
|---|---|---|---|
| [`typescript`](https://www.npmjs.com/package/typescript) | 6.0.3 | Apache-2.0 | `tsc` type check of the Probe_Runner (dev/gate only) |
| [`@types/node`](https://www.npmjs.com/package/@types/node) | 26.6.6 | MIT | Node type declarations for the Probe_Runner and its tests (dev/gate only) |
| [`fast-check`](https://www.npmjs.com/package/fast-check) | 4.10.2 | MIT | Property-based testing in the Probe_Runner unit tests (dev/test only) |
| [`@mlc-ai/web-llm`](https://www.npmjs.com/package/@mlc-ai/web-llm) | 0.2.87 | Apache-2.0 | WebLLM in-browser runtime for the Probe_Page |
| [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) | 4.3.2 | Apache-2.0 | transformers.js in-browser runtime for the Probe_Page |
| [`@huggingface/transformers-structured-output`](https://www.npmjs.com/package/@huggingface/transformers-structured-output) | 4.3.2 | Apache-2.0 | Constrained (structured) generation for transformers.js (no dependencies) |
| [`vite`](https://www.npmjs.com/package/vite) | 8.3.5 | MIT | Builds and serves the Probe_Page (dev only) |
| [`@playwright/test`](https://www.npmjs.com/package/@playwright/test) | 1.64.1 | Apache-2.0 | Browser driver on the system Chrome (dev only) |

Transitive packages that matter for the Probe_Page or carry a non-permissive license (versions from `eval/probe/pnpm-lock.yaml`; licenses read from the installed `package.json` files on Linux x64, where 66 packages are installed in total; all of the rest are MIT, ISC, BSD-3-Clause, Apache-2.0 or `MIT OR CC0-1.0`). None of these is in `web/` or in `web/dist`:

| Name | Version | License | Used for |
|---|---|---|---|
| `onnxruntime-web` | 1.31.0-dev.20260914-8d85527a0 | MIT | Transitive (`@huggingface/transformers`): the ONNX Runtime Web build that runs the transformers.js models in the Probe_Page |
| `onnxruntime-common` | 1.31.0-dev.20260911-2a43ec07e and 1.30.0 | MIT | Transitive (`onnxruntime-web`, `onnxruntime-node`) |
| `onnxruntime-node` | 1.30.0 | MIT | Transitive (`@huggingface/transformers`): declared by transformers.js for Node; not loaded in the browser page |
| `@huggingface/jinja` | 0.5.11 | MIT | Transitive (`@huggingface/transformers`): chat-template rendering |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | Transitive (`@huggingface/transformers`): tokenizers |
| `sharp` | 0.35.5 | Apache-2.0 | Transitive (`@huggingface/transformers`): Node image processing; not used by the probe |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later | Transitive (`sharp`): prebuilt native library for Linux x64, installed by pnpm for this platform only; dev machine only, never linked into or served with any build output |
| `protobufjs` (and its `@protobufjs/*` helpers), `flatbuffers`, `long`, `guid-typescript`, `platform` | 7.6.6 (BSD-3-Clause), 25.9.23 (Apache-2.0), 5.3.2 (Apache-2.0), 1.0.9 (ISC), 1.3.6 (MIT) | as listed | Transitive (`onnxruntime-web`): protobuf and flatbuffer parsing, 64-bit integers, GUIDs |
| `loglevel` | 1.9.2 | MIT | Transitive (`@mlc-ai/web-llm`): logging |
| `lightningcss` (and `lightningcss-linux-x64-gnu`) | 1.33.0 | MPL-2.0 | Transitive (`vite`, in both `web/` and `eval/probe/`): CSS tooling at build time only; not modified, not bundled |

Development tools (not linked into any build output): `wasm-bindgen-cli` 0.2.130 (MIT OR Apache-2.0), Node.js 26.7.0 (MIT) and `pnpm` 10.33.1 (MIT), all pinned in `mise.toml`.

## License

Code is licensed under the [Apache License 2.0](LICENSE). The license does not grant rights to the project name (see section 6 of the license).
