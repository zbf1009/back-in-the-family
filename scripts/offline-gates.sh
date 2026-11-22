#!/usr/bin/env bash
# Every gate process, including Node/workerd/Chrome children, gets loopback only.
# Tool/package installation belongs exclusively to prepare-gates.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
cache="$root/target/gate-cache"
[[ $# -gt 0 ]] || { echo 'offline-gates: expected a gate command' >&2; exit 1; }
[[ -f "$cache/prepared.json" ]] || { echo 'offline-gates: run scripts/prepare-gates.sh before offline execution' >&2; exit 1; }
node=$(< "$cache/node.path")
[[ -x "$node" && "$node" != */shims/* ]] || { echo 'offline-gates: prepared direct Node launcher is missing' >&2; exit 1; }

# Reentry from Worker package scripts is safe only after the real namespace and
# sanitized environment assertions; an environment marker cannot bypass them.
if [[ ${BIF_OFFLINE_GATES:-} == 1 ]]; then
  # Pinned pnpm's lifecycle serializer emits boolean false as an empty value.
  # Restore its explicit spelling before checking/launching another process;
  # absent or truthy values remain unmodified and fail the strict preflight.
  case "${npm_config_manage_package_manager_versions-unset}" in
    false|'') export npm_config_manage_package_manager_versions=false ;;
  esac
  "$node" scripts/gate-tools.mjs check
  exec "$@"
fi
for tool in unshare ip; do
  [[ -x /usr/bin/$tool ]] || { echo "offline-gates: missing system prerequisite $tool" >&2; exit 1; }
done
path=/usr/bin:/bin
for tool in node pnpm cargo rustc rustfmt cargo-clippy clippy-driver wasm-bindgen wasm-bindgen-test-runner; do
  binary=$(< "$cache/$tool.path")
  [[ -x "$binary" && "$binary" != */shims/* ]] || { echo "offline-gates: prepared direct $tool launcher is missing" >&2; exit 1; }
  path="$(dirname "$binary"):$path"
done
parent_net_ns=$(/usr/bin/readlink /proc/self/ns/net)
[[ "$parent_net_ns" =~ ^net:\[[0-9]+\]$ ]] || { echo 'offline-gates: invalid launching network namespace identity' >&2; exit 1; }
home=$(mktemp -d)
trap 'rm -rf "$home"' EXIT
mkdir -p "$home/tmp" "$home/config" "$home/cache"
# env -i drops tokens, account IDs, root env, user config, proxies and loaders.
# WORKER_API_FAULT is a closed local config-fault test hook, never a live binding.
# Map the caller to root only inside the new user namespace so CAP_NET_ADMIN
# survives exec and can bring up its isolated loopback device.
/usr/bin/env -i PATH="$path" HOME="$home" TMPDIR="$home/tmp" \
  XDG_CONFIG_HOME="$home/config" XDG_CACHE_HOME="$home/cache" \
  CI="${CI:-}" BIF_OFFLINE_GATES=1 BIF_OFFLINE_PARENT_NET_NS="$parent_net_ns" \
  CARGO_HOME="$cache/cargo" CARGO_NET_OFFLINE=true \
  npm_config_offline=true npm_config_store_dir="$cache/pnpm" \
  npm_config_manage_package_manager_versions=false npm_config_package_manager_strict_version=true \
  npm_config_userconfig=/dev/null npm_config_globalconfig=/dev/null \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 WRANGLER_SEND_METRICS=false \
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false CLOUDFLARE_INCLUDE_PROCESS_ENV=false \
  WORKER_API_FAULT="${WORKER_API_FAULT:-}" \
  /usr/bin/unshare --user --map-root-user --net --fork /bin/bash -c '
    set -euo pipefail
    /usr/bin/ip link set lo up
    "$1" scripts/gate-tools.mjs check
    shift
    exec "$@"
  ' offline-gates "$node" "$@"
