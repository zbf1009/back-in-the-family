# Back in the Family

*Born here. Die here. Repeat.*

A reincarnation life-sim set in a small American town where, after a Halloween clerical error at the local branch of the underworld, everyone who dies in town can only be reborn into the town's own newborns.

Built for Kiroween 2026 (Frankenstein category). Development is done with Kiro CLI; the `.kiro/` directory (steering, specs, hooks, agents) is part of this repository.

Status: early development. Build and run instructions will be added as the project takes shape.

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

## License

Code is licensed under the [Apache License 2.0](LICENSE). The license does not grant rights to the project name (see section 6 of the license).
