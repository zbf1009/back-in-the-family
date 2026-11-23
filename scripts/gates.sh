#!/usr/bin/env bash
# Runs every offline quality gate in order and stops on the first failure.
# Prepare pinned tools and dependency stores separately with prepare-gates.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ${BIF_OFFLINE_GATES:-} != 1 ]]; then
  exec scripts/offline-gates.sh scripts/gates.sh
fi
node scripts/gate-tools.mjs check

# Never download a Playwright browser; the Smoke_Test uses the system Chrome (R9.2).
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Run a gate; on failure name the failing command and exit with its status (R10.2).
run() {
  echo "==> $*" >&2
  local status=0
  "$@" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "gate failed: $*" >&2
    exit "$status"
  fi
}

run cargo fmt --check

echo "==> cargo tree --locked --offline -p sim-core -e normal (checking for rand / getrandom)"
tree_output="$(cargo tree --locked --offline -p sim-core -e normal)"
echo "$tree_output"
if echo "$tree_output" | grep -Eq '(^|[^A-Za-z0-9_-])(rand|getrandom)( |$|v[0-9])'; then
  echo "error: sim-core's dependency tree must not contain rand or getrandom" >&2
  exit 1
fi

run cargo clippy --locked --offline --workspace --all-targets -- -D warnings
run cargo clippy --locked --offline -p sim-core -p sim-wasm --target wasm32-unknown-unknown -- -D warnings
run cargo clippy --locked --offline -p sim-wasm --features bench --target wasm32-unknown-unknown -- -D warnings
run cargo test --locked --offline --workspace
# Invariants after every tick plus a record-and-verify round trip, 20 seeds x 2,000 ticks.
# Release build: a few seconds.
run cargo run --locked --offline -q --release -p sim-cli -- batch --seeds 1..=20 --ticks 2000
# R17: Life_Runs (80 years) on the Acceptance_Seeds, with targets enforced.
run cargo run --locked --offline -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --require-targets
# R11.16: Devoted applied-success reachability; LS-R17 stays report-only here.
run cargo run --locked --offline -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --devoted --require-reachability
# Acceptance-only branch, report-only; Devoted's gate and hard counts above stay unchanged.
run cargo run --locked --offline -q --release -p sim-cli -- batch --seeds 1..=5 --ticks 29200 --playthrough
run cargo test --locked --offline -p sim-wasm --features bench --test bench
run cargo test --locked --offline -p sim-wasm --target wasm32-unknown-unknown
run scripts/wasm-build.sh

# Prepared dependency snapshots must match manifests/locks. No install, download,
# package-manager version bootstrap or toolchain provisioning occurs in gates.
run scripts/check-pnpm-version.sh
# Manifest_Check remains local-only and never reads the root env file.
run pnpm --dir eval/probe run probe check-manifest
# Type_Check gate (R8, R10.1): svelte-check + tsc over every first-party .ts and
# .svelte file, checked against the wasm-bindgen declarations produced by the
# wasm-build.sh step above. Runs after preparation and before the Unit_Tests.
run pnpm --dir web run typecheck
# Worker generated declarations must match actual pinned Wrangler output before tsc.
run pnpm --dir worker-api run typecheck
# Unit_Tests includes report-only metrics/properties and native-shaped binding fakes.
run pnpm --dir web run test:unit
run pnpm --dir worker-api run test:unit
# Probe gates (R16.1): Type_Check then Unit_Tests for eval/probe. They need
# target/wasm-pkg from wasm-build.sh and the separately prepared probe install.
# Manifest_Check runs earlier. The import gate follows the Probe Unit_Tests: no
# file under web/src may import anything from eval/.
run pnpm --dir eval/probe run typecheck
run pnpm --dir eval/probe run test:unit
run pnpm --dir eval/probe run probe check-web-imports
# Web_Build gate (R7, R10.1): build Sim_Wasm and the Web_App into the Deploy_Directory
# (web/dist) and check every file against the Size_Limit and the deploy boundary. Runs
# after the Unit_Tests gate and before the Smoke_Test gate.
run scripts/web-build.sh
# Worker_Build packages the validated source profile, never deploys, and stages the
# exact checked Worker for the actual pinned runtime/assets router suite.
run scripts/worker-build.sh
run pnpm --dir worker-api run test:runtime
# Artifact_Check prepares the exact checked builds in a fresh private transport,
# captures the producer's independent digest, then checks without rebuilding.
artifact_gate=$(mktemp -d target/artifact-gate.XXXXXX)
trap 'rm -rf -- "$artifact_gate"' EXIT
echo "==> Artifact_Check"
artifact_prepared=$(run node scripts/stage-artifact.ts --prepare --output "$artifact_gate/transport")
artifact_envelope_sha=$(run node -e 'const p=JSON.parse(process.argv[1]); if (!/^[a-f0-9]{64}$/.test(p.envelopeSHA)) throw new Error("Invalid checked envelope SHA"); process.stdout.write(p.envelopeSHA)' "$artifact_prepared")
run node scripts/check-artifact.ts --input "$artifact_gate/transport" --envelope-sha "$artifact_envelope_sha"
run node --test scripts/tests/artifact.test.ts scripts/tests/publisher.test.ts scripts/tests/artifact-gate.test.ts scripts/tests/artifact-sdk-lock.test.ts
# Fresh public SDK installation/native packaging proof, separate from app builds.
run node scripts/check-artifact-sdk.mjs --input "$artifact_gate/transport" --envelope-sha "$artifact_envelope_sha"
# Smoke_Test gate (R9, R10.1): the LAST gate. Playwright drives the BUILT page in the
# system Chrome against the native Parity_Fixture. Its `webServer` serves the web/dist
# that the Web_Build gate just produced (Local_Preview rebuilds nothing), so Web_Build
# must run before it for dist to exist; Worker_Build/router checks also precede it.
run pnpm --dir web run test:smoke

echo "All gates passed."
