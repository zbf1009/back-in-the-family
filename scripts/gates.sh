#!/usr/bin/env bash
# Runs every quality gate in order and stops on the first failure.
# Later tasks extend this script.
set -euo pipefail

cd "$(dirname "$0")/.."

# Never download a Playwright browser; the Smoke_Test uses the system Chrome (R9.2).
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Run a gate; on failure name the failing command and exit with its status (R10.2).
run() {
  echo "==> $*"
  local status=0
  "$@" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "gate failed: $*" >&2
    exit "$status"
  fi
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

# First web gates (R10.1 order): pnpm pin check, then a frozen-lockfile install.
run scripts/check-pnpm-version.sh
# The pinned pnpm (mise.toml) is reached through `mise exec`, because the pnpm on
# PATH may be a different version. --frozen-lockfile neither resolves new versions
# nor rewrites the lockfile, and fails if the lockfile is out of date (R1.5, R1.6).
run mise exec -- pnpm --dir web install --frozen-lockfile

echo "All gates passed."
