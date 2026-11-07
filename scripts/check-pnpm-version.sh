#!/usr/bin/env bash
# Checks that pnpm is pinned to the same exact version in mise.toml and in the
# packageManager field of web/package.json and eval/probe/package.json (R1.2, R1.3,
# R16.1, R16.9). The version must be a
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

# A package.json's packageManager field, read as text (via node -p). A missing file
# or field prints as "undefined"/nothing; anything not of the form pnpm@x.y.z -> "missing".
# Sets pm_value to the full field or "missing", and pm_version to the bare version.
read_pm() {
  local raw
  raw="$(node -p "require('./$1').packageManager" 2>/dev/null || true)"
  if [[ "$raw" =~ ^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    pm_version="${BASH_REMATCH[1]}"
    pm_value="$raw"
  else
    pm_version=""
    pm_value="missing"
  fi
}

read_pm web/package.json
web_value="$pm_value"
web_version="$pm_version"
read_pm eval/probe/package.json
probe_value="$pm_value"
probe_version="$pm_version"

if [ "$mise_value" = "missing" ] || [ "$web_value" = "missing" ] || [ "$probe_value" = "missing" ] \
  || [ "$mise_value" != "$web_version" ] || [ "$mise_value" != "$probe_version" ]; then
  echo "mise.toml: $mise_value"
  echo "web/package.json packageManager: $web_value"
  echo "eval/probe/package.json packageManager: $probe_value"
  exit 1
fi

echo "pnpm pinned to $mise_value in mise.toml, web/package.json and eval/probe/package.json."
