# Back in the Family

*Born here. Die here. Repeat.*

A reincarnation life-sim set in a small American town where, after a Halloween clerical error at the local branch of the underworld, everyone who dies in town can only be reborn into the town's own newborns.

Built for Kiroween 2026 (Frankenstein category). Development is done with Kiro CLI; the `.kiro/` directory (steering, specs, agents) is part of this repository.

Status: the deterministic simulation skeleton (`sim-core`, with the native runner `sim-cli` and the browser bindings `sim-wasm`) is built and checked; there is no playable game or web page yet. The next spec is `web-shell`.

## Build and test

Prerequisites (Linux; commands below were run on Arch Linux):

- [`rustup`](https://rustup.rs). It reads `rust-toolchain.toml`, which pins Rust 1.99.1 with `rustfmt`, `clippy` and the `wasm32-unknown-unknown` target; if that toolchain is not installed yet, `rustup toolchain install` (run in the repository) installs it.
- [`mise`](https://mise.jdx.dev) with the project's `mise.toml`: `mise install` provides `wasm-bindgen-cli` 0.2.130 (it must equal the `wasm-bindgen` crate version in `Cargo.lock`; `scripts/check-wasm-bindgen.sh` checks this) and Node 26.7.0. Only the WASM steps need them.

Everything, in one command (about 2.5 minutes from a clean `target/`, about 2 minutes with a warm one):

```sh
scripts/gates.sh
```

It runs `cargo fmt --check`, a check that `sim-core`'s normal dependency tree has no `rand` or `getrandom`, `cargo clippy --workspace --all-targets -- -D warnings` (plus wasm32 clippy), `cargo test --workspace`, `sim-cli batch --seeds 1..=20 --ticks 2000` (release build; invariants after every tick and a record-and-verify round trip per seed, which the 150-tick property tests do not cover), the `bench`-feature test, `cargo test -p sim-wasm --target wasm32-unknown-unknown` (the fixtures replayed in Node), and `scripts/wasm-build.sh` (release build, `wasm-bindgen --target web` into `target/wasm-pkg`, and a check that every output file is under 25 MiB).

Tests only: `cargo test --workspace` (the property tests take about 30 seconds in a debug build).

### Command-line runner

```sh
cargo run -p sim-cli -- --help
cargo run -p sim-cli -- record --seed 1 --ticks 2000 --random-inputs 120 --out /tmp/run.replay.json
cargo run -p sim-cli -- replay /tmp/run.replay.json      # exit 0 and "ok", or exit 1 and the first divergent tick
cargo run -p sim-cli -- batch --seeds 1..=20 --ticks 2000 # invariants after every tick, in-memory record and verify
cargo run -p sim-cli -- check-size target/wasm-pkg --max-bytes 26214400
cargo run --release -p sim-cli -- measure                 # native timing of one 80-year lifetime (29,200 daily ticks)
```

`scripts/measure-wasm.sh` builds the WASM module with the `bench` feature and runs the same measurement in Node. One tick is one day.

### Fixtures

`fixtures/parity/*.replay.json` are golden replay files (three seeds, 2,000 ticks each). The native test (`cargo test -p sim-core --test replay`) and the WASM test replay them and must produce the recorded checksum at every tick. Regenerate them only after an intentional change to tick logic, random streams, the canonical encoding or the replay format: `scripts/regen-fixtures.sh`, then read the diff. Details are in `fixtures/parity/README.md`.

Kiro hooks were tried and removed on 2026-11-04: they ran only on the agent's edit-tool saves and on task completions, and their output did not reach the agent. The evidence is in `docs/kiro-log.md` and `docs/sim-core-skeleton-audit.md`; `sim-cli batch` is now a gate step instead.

Other documents: `docs/tick-granularity.md` (measurement behind the 1-day tick), `docs/sim-core-skeleton-audit.md` (requirement-by-requirement check of the first spec), `docs/kiro-log.md` (how Kiro was used).

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

More entries are added here as libraries and assets arrive.

### Web app (`web/`) dependencies

Resolved versions are from the committed `web/pnpm-lock.yaml`; licenses are the SPDX identifiers on the npm registry. All nine are dev dependencies. Transitive packages whose code reaches the Deploy_Directory are added from the build report in task 4; so far only `svelte` is bundled (`web/.bundle-report.json`), so `wrangler` is a dev/deploy tool and is not part of `web/dist`.

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



Development tools (not linked into any build output): `wasm-bindgen-cli` 0.2.130 (MIT OR Apache-2.0), Node.js 26.7.0 (MIT) and `pnpm` 10.33.1 (MIT), all pinned in `mise.toml`.

## License

Code is licensed under the [Apache License 2.0](LICENSE). The license does not grant rights to the project name (see section 6 of the license).
