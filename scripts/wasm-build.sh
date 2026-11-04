#!/usr/bin/env bash
# Release-builds sim-wasm, runs wasm-bindgen (--target web) and checks that every
# deployed file is below 25 MiB (R7.3). Output: target/wasm-pkg (gitignored).
set -euo pipefail

cd "$(dirname "$0")/.."

# The CLI and the crate must be the same version (the wasm schema is version-locked).
scripts/check-wasm-bindgen.sh >/dev/null

out=target/wasm-pkg
rm -rf "$out"

cargo build -p sim-wasm --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$out" target/wasm32-unknown-unknown/release/sim_wasm.wasm

echo "Artifact sizes (bytes):"
wc -c target/wasm32-unknown-unknown/release/sim_wasm.wasm "$out"/*
cargo run -q -p sim-cli -- check-size "$out" --max-bytes 26214400
