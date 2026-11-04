#!/usr/bin/env bash
# R10: WASM tick-granularity timings. Builds sim-wasm in release mode WITH the `bench`
# feature, runs wasm-bindgen for Node into target/wasm-bench (kept apart from the
# production web build in target/wasm-pkg), then runs scripts/measure-wasm.mjs.
# Usage: scripts/measure-wasm.sh [--runs N] [--entities N]   (defaults 5 and 60)
set -euo pipefail

cd "$(dirname "$0")/.."

bindgen_version="$(scripts/check-wasm-bindgen.sh)"

out=target/wasm-bench
rm -rf "$out"
cargo build -q -p sim-wasm --release --target wasm32-unknown-unknown --features bench
wasm-bindgen --target nodejs --out-dir "$out" target/wasm32-unknown-unknown/release/sim_wasm.wasm

WASM_BINDGEN_VERSION="$bindgen_version" exec node scripts/measure-wasm.mjs "$out" "$@"
