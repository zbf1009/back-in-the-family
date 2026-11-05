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
# Type_Check gate (R8, R10.1): svelte-check + tsc over every first-party .ts and
# .svelte file, checked against the wasm-bindgen declarations produced by the
# wasm-build.sh step above. Runs between the frozen install and the Unit_Tests.
run mise exec -- pnpm --dir web run typecheck
# Unit_Tests gate: the web unit and property tests (R10.1).
run mise exec -- pnpm --dir web run test:unit
# Web_Build gate (R7, R10.1): build Sim_Wasm and the Web_App into the Deploy_Directory
# (web/dist) and check every file against the Size_Limit and the deploy boundary. Runs
# after the Unit_Tests gate and before the Smoke_Test gate.
run scripts/web-build.sh
# Smoke_Test gate (R9, R10.1): the LAST gate. Playwright drives the BUILT page in the
# system Chrome against the native Parity_Fixture. Its `webServer` serves the web/dist
# that the Web_Build gate just produced (Local_Preview rebuilds nothing), so Web_Build
# must run before it for dist to exist -- it does, directly above.
run mise exec -- pnpm --dir web run test:smoke

echo "All gates passed."
