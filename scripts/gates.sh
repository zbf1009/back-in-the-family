#!/usr/bin/env bash
# Runs every quality gate in order and stops on the first failure.
# Later tasks extend this script.
set -euo pipefail

cd "$(dirname "$0")/.."

run() {
  echo "==> $*"
  "$@"
}

run cargo fmt --check
run cargo clippy --workspace --all-targets -- -D warnings
run cargo clippy -p sim-core -p sim-wasm --target wasm32-unknown-unknown -- -D warnings
run cargo test --workspace

echo "All gates passed."
