#!/usr/bin/env bash
# Worker_Build: validated native-AI source profile, pinned Wrangler dry run only.
# Requires the checked Web_Build output and separately prepared dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
exec scripts/offline-gates.sh node worker-api/scripts/wrangler.ts build
