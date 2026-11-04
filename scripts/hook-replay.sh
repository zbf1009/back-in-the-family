#!/usr/bin/env bash
# Kiro hook `replay-on-save` (.kiro/hooks/replay-on-save.json): runs the replay checks of
# sim-core (every golden fixture plus in-process record/replay) after the agent saves a
# file under crates/sim-core/. Also fails when sim-core (or its tests) does not compile.
#
# Quiet on success (one line). On failure it prints a SHORT summary (at most ~40 lines:
# the first compiler errors or the failing test / divergence lines, not the full cargo
# log) to BOTH stdout and stderr, and exits 1 (or cargo's own non-zero status), so the
# summary reaches the agent whichever channel the hook runner forwards. Usable from any
# directory.
#
# Release build on purpose: measured 2026-11 on this machine, a debug run took ~14.5 s
# every time (the 2,000-tick fixtures are slow unoptimized), while a release run takes
# ~1.5 s after a one-file change on a warm cache. Trade-off: release has no overflow
# checks or debug_assert!s; those still run in `scripts/gates.sh` (debug `cargo test`).
set -euo pipefail

cd "$(dirname "$0")/.."

log="$(mktemp)"
trap 'rm -f "$log" "$log.summary"' EXIT

rc=0
cargo test -p sim-core --test replay --quiet --release >"$log" 2>&1 || rc=$?

if [ "$rc" -eq 0 ]; then
  echo "replay check ok"
  exit 0
fi

{
  echo "replay check FAILED (cargo exit $rc)"
  if grep -qE '^error(\[E[0-9]+\])?: .*|could not compile' "$log" &&
    ! grep -qE '^running [0-9]+ tests' "$log"; then
    echo "-- compile error (first lines):"
    grep -m 3 -A 8 -E '^error(\[E[0-9]+\])?: ' "$log" | head -30
  else
    echo "-- failing tests:"
    grep -E ' FAILED$' "$log" | head -12
    echo "-- first divergences / assertions:"
    grep -E 'Diverged\(|diverged' "$log" | head -8
    grep -E 'panicked at' "$log" | head -8
  fi
} >"$log.summary"
head -40 "$log.summary"
head -40 "$log.summary" >&2
exit "$rc"
