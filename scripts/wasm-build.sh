#!/usr/bin/env bash
# Release-builds sim-wasm, runs wasm-bindgen (--target web) and checks that every
# deployed file is below 25 MiB (R7.3). Output: target/wasm-pkg (gitignored).
set -euo pipefail

cd "$(dirname "$0")/.."

# The CLI and the crate must be the same version (the wasm schema is version-locked).
crate_version="$(awk '
  /^name = "wasm-bindgen"$/ { found = 1; next }
  found && /^version = / { gsub(/"/, "", $3); print $3; exit }
' Cargo.lock)"
if [ -z "$crate_version" ]; then
  echo "error: could not find the wasm-bindgen version in Cargo.lock" >&2
  exit 1
fi
if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "error: wasm-bindgen CLI not found; run \`mise install\`" >&2
  exit 1
fi
cli_version="$(wasm-bindgen --version | awk '{print $2}')"
if [ "$cli_version" != "$crate_version" ]; then
  echo "error: wasm-bindgen CLI $cli_version does not match crate $crate_version; run \`mise install\`" >&2
  exit 1
fi

out=target/wasm-pkg
rm -rf "$out"

cargo build -p sim-wasm --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$out" target/wasm32-unknown-unknown/release/sim_wasm.wasm

echo "Artifact sizes (bytes):"
wc -c target/wasm32-unknown-unknown/release/sim_wasm.wasm "$out"/*
cargo run -q -p sim-cli -- check-size "$out" --max-bytes 26214400
