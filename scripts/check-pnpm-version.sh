#!/usr/bin/env bash
# Checks that pnpm is pinned to the same exact version in mise.toml and in the
# packageManager field of web/package.json (R1.2, R1.3). The version must be a
# full major.minor.patch with no range or tag. On any missing, malformed or
# differing value this prints both values (or "missing") and exits 1; it exits 0
# only when both are present, well-formed and equal. Runs before the frozen
# install in scripts/gates.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

# A full major.minor.patch, no range or tag.
version_re='^[0-9]+\.[0-9]+\.[0-9]+$'

# mise.toml: the value of the `pnpm = "x.y.z"` line. Missing or malformed -> "missing".
mise_raw="$(awk -F'"' '/^[[:space:]]*pnpm[[:space:]]*=/ { print $2; exit }' mise.toml)"
if [[ "$mise_raw" =~ $version_re ]]; then
  mise_value="$mise_raw"
else
  mise_value="missing"
fi

# web/package.json: the packageManager field, read as text (via node -p). A missing
# field prints as "undefined"; anything not of the form pnpm@x.y.z -> "missing".
pm_raw="$(node -p 'require("./web/package.json").packageManager' 2>/dev/null || true)"
if [[ "$pm_raw" =~ ^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  pm_version="${BASH_REMATCH[1]}"
  pm_value="$pm_raw"
else
  pm_version=""
  pm_value="missing"
fi

if [ "$mise_value" = "missing" ] || [ "$pm_value" = "missing" ] || [ "$mise_value" != "$pm_version" ]; then
  echo "mise.toml: $mise_value"
  echo "web/package.json packageManager: $pm_value"
  exit 1
fi

echo "pnpm pinned to $mise_value in mise.toml and web/package.json."
