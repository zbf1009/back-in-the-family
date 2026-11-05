#!/usr/bin/env bash
# Web_Build (R7.1, R7.2, R7.3, R7.8, R7.9): builds Sim_Wasm, then the Web_App into
# the Deploy_Directory (web/dist), then checks the result against the Size_Limit and
# the deploy-boundary rules. Steps run in order; the first failing step names itself
# on stderr and exits non-zero (R7.8). Exit 0 only when every step passes (R7.9).
set -euo pipefail

cd "$(dirname "$0")/.."

# Run a build step; on a non-zero status name the step on stderr and exit non-zero,
# so the output says which step failed (R7.8).
step() {
  local name=$1
  shift
  echo "==> web-build: $name"
  "$@" || {
    echo "web-build: step '$name' failed" >&2
    exit 1
  }
}

# 1. Build Sim_Wasm to completion before building the Web_App (R7.1).
step wasm-build scripts/wasm-build.sh

# 2. Clear the Deploy_Directory so nothing from an earlier run survives (R7.2).
rm -rf web/dist

# 3. Build the Web_App into web/dist (R7.3). The pinned pnpm is reached through
#    `mise exec`, because the pnpm on PATH may be a different version.
step vite-build mise exec -- pnpm --dir web run build

# 4. Check every deployed file against the Size_Limit and the deploy boundary
#    (R7.4, R7.5, R2.3, R7.3). Exit 0 only if this and all earlier steps pass (R7.9).
step check-deploy mise exec -- pnpm --dir web run check-deploy
