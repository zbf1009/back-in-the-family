#!/usr/bin/env bash
# Checks that the wasm-bindgen CLI matches the wasm-bindgen crate version in Cargo.lock
# (the wasm schema is version-locked). Prints the version on success; exits 1 otherwise.
# Shared by wasm-build.sh and measure-wasm.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

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
echo "$cli_version"
