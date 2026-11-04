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

echo "==> cargo tree -p sim-core -e normal (checking for rand / getrandom)"
tree_output="$(cargo tree -p sim-core -e normal)"
echo "$tree_output"
if echo "$tree_output" | grep -Eq '(^|[^A-Za-z0-9_-])(rand|getrandom)( |$|v[0-9])'; then
  echo "error: sim-core's dependency tree must not contain rand or getrandom" >&2
  exit 1
fi

run cargo clippy --workspace --all-targets -- -D warnings
run cargo clippy -p sim-core -p sim-wasm --target wasm32-unknown-unknown -- -D warnings
run cargo clippy -p sim-wasm --features bench --target wasm32-unknown-unknown -- -D warnings
run cargo test --workspace
# Invariants after every tick plus a record-and-verify round trip, 20 seeds x 2,000 ticks
# (the property tests run only 150 ticks). Release build: about 5 s versus about 225 s in debug.
run cargo run -q --release -p sim-cli -- batch --seeds 1..=20 --ticks 2000
run cargo test -p sim-wasm --features bench --test bench
run cargo test -p sim-wasm --target wasm32-unknown-unknown
run scripts/wasm-build.sh

echo "All gates passed."
