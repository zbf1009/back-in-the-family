#!/usr/bin/env bash
# Separate offline structured lock preparation. Never called by gates or Artifact_Check.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
cache="$root/target/gate-cache"
metadata="$root/worker-api/artifact-deploy"
[[ $# == 0 ]] || { echo 'usage: bash scripts/prepare-artifact-metadata.sh' >&2; exit 1; }
for tool in unshare ip; do
  [[ -x /usr/bin/$tool ]] || { echo "artifact-metadata: missing system prerequisite $tool" >&2; exit 1; }
done
[[ -f "$cache/node.path" ]] || { echo 'artifact-metadata: missing prepared node.path' >&2; exit 1; }
node=$(< "$cache/node.path")
[[ "$node" == /* && -x "$node" && "$node" != */shims/* ]] || { echo 'artifact-metadata: missing direct pinned Node launcher' >&2; exit 1; }
[[ -f "$metadata/package.json" && ! -L "$metadata/package.json" ]] || { echo 'artifact-metadata: expected regular deploy package metadata' >&2; exit 1; }
[[ -f "$root/web/pnpm-lock.yaml" && ! -L "$root/web/pnpm-lock.yaml" ]] || { echo 'artifact-metadata: expected regular healthy source lock' >&2; exit 1; }
[[ ! -L "$metadata/pnpm-lock.yaml" ]] || { echo 'artifact-metadata: lock destination must not be a symlink' >&2; exit 1; }
parent_net_ns=$(/usr/bin/readlink /proc/self/ns/net)
workspace=$(/usr/bin/mktemp -d /tmp/bif-artifact-metadata.XXXXXXXX)
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/home/config" "$workspace/home/cache" "$workspace/tmp"
cp "$metadata/package.json" "$workspace/package.json"
cp "$root/web/pnpm-lock.yaml" "$workspace/source-lock.yaml"
/usr/bin/env -i PATH="$(dirname "$node"):/usr/bin:/bin" \
  HOME="$workspace/home" TMPDIR="$workspace/tmp" \
  XDG_CONFIG_HOME="$workspace/home/config" XDG_CACHE_HOME="$workspace/home/cache" \
  CI=1 \
  /usr/bin/unshare --user --map-root-user --net --fork /bin/bash -c '
    set -euo pipefail
    /usr/bin/ip link set lo up
    [[ "$(/usr/bin/readlink /proc/self/ns/net)" != "$1" ]] || { echo "artifact-metadata: network namespace was not isolated" >&2; exit 1; }
    [[ "$("$2" --version)" == v26.7.0 ]] || { echo "artifact-metadata: Node pin mismatch" >&2; exit 1; }
    "$2" "$4" --source-lock "$3/source-lock.yaml" --package "$3/package.json" --output "$3/pnpm-lock.yaml"
    [[ ! -e "$3/node_modules" && -f "$3/pnpm-lock.yaml" && ! -L "$3/pnpm-lock.yaml" ]] || { echo "artifact-metadata: expected only a generated regular lockfile" >&2; exit 1; }
  ' artifact-metadata "$parent_net_ns" "$node" "$workspace" "$root/scripts/artifact-sdk-lock.ts"
# Only the successful generated lock is copied back; web inputs stay untouched.
cp "$workspace/pnpm-lock.yaml" "$metadata/pnpm-lock.yaml"
printf '%s\n' 'Offline artifact deploy lock selected from the healthy source; no install, application build or package scripts ran.'
