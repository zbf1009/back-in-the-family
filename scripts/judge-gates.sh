#!/usr/bin/env bash
# Consume the exact successful source gate transport; never rebuild Rust, WASM or Vite.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ${BIF_OFFLINE_GATES:-} != 1 ]]; then
  exec scripts/offline-gates.sh /bin/bash scripts/judge-gates.sh "$@"
fi
node scripts/gate-tools.mjs check
[[ $# -gt 0 ]] || { echo 'judge-gates: explicit checker trust arguments are required' >&2; exit 1; }
trust=("$@")
node scripts/check-judge-artifact.ts restore-upstream "${trust[@]}"
sdk=()
for ((index=0; index<${#trust[@]}; index+=2)); do
  case "${trust[index]}" in
    --input|--envelope-sha|--source-commit) sdk+=("${trust[index]}" "${trust[index+1]}") ;;
    --upstream-run-id) sdk+=(--run-id "${trust[index+1]}") ;;
    --upstream-run-attempt) sdk+=(--run-attempt "${trust[index+1]}") ;;
  esac
done
node scripts/check-artifact-sdk.mjs "${sdk[@]}"
node worker-api/scripts/typecheck.ts --profile judge
node --test worker-api/tests/judge/unit.test.ts
node --test worker-api/tests/unit/*.test.ts scripts/tests/decision-contract.test.ts
node worker-api/scripts/wrangler.ts build --profile judge
node --test worker-api/tests/judge/runtime.test.ts worker-api/tests/judge/artifact.test.ts
prepared=$(node scripts/check-judge-artifact.ts prepare "${trust[@]}")
manifest_sha=$(node -e 'const v=JSON.parse(process.argv[1]); if (!/^[a-f0-9]{64}$/.test(v.manifestSHA)) throw new Error("Missing independent manifest SHA"); process.stdout.write(v.manifestSHA)' "$prepared")
node scripts/check-judge-artifact.ts check "${trust[@]}" --manifest-sha "$manifest_sha"
node scripts/check-judge-artifact.ts pack "${trust[@]}" --manifest-sha "$manifest_sha"
# Only the independently emitted digest is sent to the next job; no workflow_run job outputs are assumed.
printf 'manifest_sha=%s\n' "$manifest_sha"
