#!/usr/bin/env bash
# Dependency preparation ONLY. --offline forbids downloads and lifecycle scripts.
# First install the existing rust-toolchain.toml and mise.toml pins separately
# (CI already does this); system Chrome, unshare and ip must also be installed.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
cache="$root/target/gate-cache"
mkdir -p "$cache/cargo" "$cache/pnpm"
rm -f "$cache/prepared.json"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 WRANGLER_SEND_METRICS=false
export npm_config_manage_package_manager_versions=false
export npm_config_package_manager_strict_version=true
case "${1:-}" in
  '') ;;
  --offline) export CARGO_NET_OFFLINE=true npm_config_offline=true ;;
  *) echo 'usage: scripts/prepare-gates.sh [--offline]' >&2; exit 1 ;;
esac

for tool in unshare ip; do
  command -v "$tool" >/dev/null || { echo "prepare-gates: missing system prerequisite $tool" >&2; exit 1; }
done
node_dir=$(mise where node@26.7.0)
pnpm=$(mise which pnpm)
wasm=$(mise which wasm-bindgen)
runner=$(mise which wasm-bindgen-test-runner)
node="$node_dir/bin/node"
[[ "$("$node" --version)" == v26.7.0 ]] || { echo 'prepare-gates: Node pin mismatch' >&2; exit 1; }
[[ "$("$pnpm" --version)" == 10.33.1 ]] || { echo 'prepare-gates: pnpm pin mismatch' >&2; exit 1; }
[[ "$("$wasm" --version)" == 'wasm-bindgen 0.2.130' ]] || { echo 'prepare-gates: wasm-bindgen pin mismatch' >&2; exit 1; }
printf '%s\n' "$node" > "$cache/node.path"
printf '%s\n' "$pnpm" > "$cache/pnpm.path"
printf '%s\n' "$wasm" > "$cache/wasm-bindgen.path"
printf '%s\n' "$runner" > "$cache/wasm-bindgen-test-runner.path"
for tool in cargo rustc rustfmt cargo-clippy clippy-driver; do
  rustup which --toolchain 1.99.1 "$tool" > "$cache/$tool.path"
done
cargo=$(< "$cache/cargo.path")
rustc=$(< "$cache/rustc.path")
[[ "$("$rustc" --version)" == 'rustc 1.99.1 '* ]] || { echo 'prepare-gates: Rust pin mismatch' >&2; exit 1; }
[[ -d "$(dirname "$(dirname "$rustc")")/lib/rustlib/wasm32-unknown-unknown" ]] || { echo 'prepare-gates: missing pinned WASM target' >&2; exit 1; }
export PATH="$(dirname "$node"):$(dirname "$cargo"):$(dirname "$wasm"):/usr/bin:/bin"
"$root/scripts/check-pnpm-version.sh"

# Reuse public package caches only, never Cargo/npm credentials or user config.
original_cargo=${CARGO_HOME:-"$HOME/.cargo"}
for directory in registry git; do
  if [[ -d "$original_cargo/$directory" && ! -d "$cache/cargo/$directory" ]]; then
    cp -a "$original_cargo/$directory" "$cache/cargo/$directory"
  fi
done
original_store=$("$pnpm" store path)
if [[ -d "$original_store" && ! -d "$cache/pnpm/$(basename "$original_store")" ]]; then
  cp -a "$original_store" "$cache/pnpm/$(basename "$original_store")"
fi
CARGO_HOME="$cache/cargo" "$cargo" fetch --locked
# Installs are deliberately outside gates, always frozen, never browser/model tools.
install_flags=(--frozen-lockfile --store-dir "$cache/pnpm")
if [[ "${1:-}" == --offline ]]; then
  install_flags+=(--offline --ignore-scripts)
fi
for package in web eval/probe; do
  CI=1 "$pnpm" --dir "$package" install "${install_flags[@]}"
done

# Host installs omit other platforms' optional payloads. Inventory the existing
# two fixed public SDK roots, plus the installed YAML helper, before recording.
sdk_workspace=$(mktemp -d "$root/target/sdk-cache-preparation.XXXXXX")
trap 'rm -rf -- "$sdk_workspace"' EXIT
sdk_args=(--source-lock "$root/web/pnpm-lock.yaml"
  --package "$root/worker-api/artifact-deploy/package.json"
  --store-dir "$cache/pnpm" --output "$sdk_workspace/output")
env -i PATH=/usr/bin:/bin "$node" "$root/scripts/prepare-artifact-sdk-cache.mjs" \
  --plan "${sdk_args[@]}" > "$sdk_workspace/plan.json"
sdk_missing=$(env -i PATH=/usr/bin:/bin "$node" -e '
  const plan = require(process.argv[1]);
  console.log(plan.missing.map(({ name, version }) => `${name}@${version}`).join("\n"));
' "$sdk_workspace/plan.json")
if [[ -n "$sdk_missing" ]]; then
  if [[ "${1:-}" == --offline ]]; then
    printf 'prepare-gates: missing complete fixed SDK cache payloads (offline; no downloads):\n%s\n' "$sdk_missing" >&2
    exit 1
  fi
  # Only the exact missing packages in this current-lock plan may be fetched.
  # The helper verifies locked tarball SRI and writes a new owned store only.
  env -i PATH=/usr/bin:/bin "$node" "$root/scripts/prepare-artifact-sdk-cache.mjs" \
    --prepare "${sdk_args[@]}" --approved-plan "$sdk_workspace/plan.json" > "$sdk_workspace/preparation.json"
  for directory in files index; do
    mkdir -p "$cache/pnpm/v10/$directory"
    cp -a "$sdk_workspace/output/store/v10/$directory/." "$cache/pnpm/v10/$directory/"
  done
  env -i PATH=/usr/bin:/bin "$node" "$root/scripts/prepare-artifact-sdk-cache.mjs" \
    --plan "${sdk_args[@]}" > "$sdk_workspace/complete.json"
  env -i PATH=/usr/bin:/bin "$node" -e '
    const plan = require(process.argv[1]);
    if (plan.missing.length) throw new Error(`Incomplete fixed SDK cache after copy: ${plan.missing.map(({ name, version }) => `${name}@${version}`).join(", ")}`);
  ' "$sdk_workspace/complete.json"
fi
rm -rf -- "$sdk_workspace"
trap - EXIT
"$node" scripts/gate-tools.mjs record
printf '%s\n' 'Pinned dependencies prepared. Run scripts/gates.sh or scripts/offline-gates.sh <command>; no installs occur inside gates.'
