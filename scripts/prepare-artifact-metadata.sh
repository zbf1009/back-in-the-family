#!/usr/bin/env bash
# Separate offline lock-only preparation. Never called by gates or Artifact_Check.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
cache="$root/target/gate-cache"
metadata="$root/worker-api/artifact-deploy"
[[ $# == 0 ]] || { echo 'usage: bash scripts/prepare-artifact-metadata.sh' >&2; exit 1; }
for tool in unshare ip; do
  [[ -x /usr/bin/$tool ]] || { echo "artifact-metadata: missing system prerequisite $tool" >&2; exit 1; }
done
for tool in node pnpm; do
  [[ -f "$cache/$tool.path" ]] || { echo "artifact-metadata: missing prepared $tool.path" >&2; exit 1; }
  binary=$(< "$cache/$tool.path")
  [[ "$binary" == /* && -x "$binary" && "$binary" != */shims/* ]] || { echo "artifact-metadata: missing direct pinned $tool launcher" >&2; exit 1; }
  if [[ "$tool" == node ]]; then node=$binary; else pnpm=$binary; fi
done
[[ -d "$cache/pnpm/v10/index" && -d "$cache/pnpm/v10/files" ]] || { echo 'artifact-metadata: prepared pnpm v10 store is missing; no download is permitted' >&2; exit 1; }
[[ -f "$metadata/package.json" && ! -L "$metadata/package.json" ]] || { echo 'artifact-metadata: expected regular deploy package metadata' >&2; exit 1; }
[[ ! -L "$metadata/pnpm-lock.yaml" ]] || { echo 'artifact-metadata: lock destination must not be a symlink' >&2; exit 1; }
parent_net_ns=$(/usr/bin/readlink /proc/self/ns/net)
workspace=$(/usr/bin/mktemp -d /tmp/bif-artifact-metadata.XXXXXXXX)
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/package" "$workspace/home/config" "$workspace/home/cache" "$workspace/tmp"
cp "$metadata/package.json" "$workspace/package/package.json"
cp "$root/web/pnpm-lock.yaml" "$workspace/package/pnpm-lock.yaml"
# pnpm may write store bookkeeping: give it an owned copy, not the shared cache.
cp -a --reflink=auto "$cache/pnpm" "$workspace/store"
/usr/bin/env -i PATH="$(dirname "$node"):$(dirname "$pnpm"):/usr/bin:/bin" \
  HOME="$workspace/home" TMPDIR="$workspace/tmp" \
  XDG_CONFIG_HOME="$workspace/home/config" XDG_CACHE_HOME="$workspace/home/cache" \
  CI=1 npm_config_offline=true npm_config_ignore_scripts=true \
  npm_config_manage_package_manager_versions=false npm_config_package_manager_strict_version=true \
  npm_config_userconfig=/dev/null npm_config_globalconfig=/dev/null \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 WRANGLER_SEND_METRICS=false \
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false CLOUDFLARE_INCLUDE_PROCESS_ENV=false \
  /usr/bin/unshare --user --map-root-user --net --fork /bin/bash -c '
    set -euo pipefail
    /usr/bin/ip link set lo up
    [[ "$(/usr/bin/readlink /proc/self/ns/net)" != "$1" ]] || { echo "artifact-metadata: network namespace was not isolated" >&2; exit 1; }
    [[ "$("$2" --version)" == v26.7.0 ]] || { echo "artifact-metadata: Node pin mismatch" >&2; exit 1; }
    [[ "$("$3" --version)" == 10.33.1 ]] || { echo "artifact-metadata: pnpm pin mismatch" >&2; exit 1; }
    cd "$4/package"
    "$3" install --lockfile-only --offline --ignore-scripts --no-frozen-lockfile --store-dir "$4/store"
    [[ ! -e node_modules && -f pnpm-lock.yaml && ! -L pnpm-lock.yaml ]] || { echo "artifact-metadata: expected only a generated regular lockfile" >&2; exit 1; }
  ' artifact-metadata "$parent_net_ns" "$node" "$pnpm" "$workspace"
# Only the successful generated lock is copied back; web inputs stay untouched.
cp "$workspace/package/pnpm-lock.yaml" "$metadata/pnpm-lock.yaml"
printf '%s\n' 'Offline artifact deploy lock prepared; no application build or package scripts ran.'
