#!/usr/bin/env bash
# Kiro hook `seed-batch-after-task` (.kiro/hooks/seed-batch-after-task.json): after a spec
# task finishes, builds sim-cli in release mode and runs
# `sim-cli batch --seeds 1..=20 --ticks 2000` (invariants after every tick, in-memory
# record + verify per seed).
#
# Quiet on success except for the batch summary line. On failure it prints a SHORT
# summary (at most ~40 lines: the FAIL lines or build errors) to BOTH stdout and stderr
# and exits non-zero (1 for a violation or divergence, 2 for a usage problem), so the
# summary reaches the agent whichever channel the hook runner forwards. Usable from any
# directory.
#
# Invocation marker (intentional evidence, kept on purpose): every run first appends one
# line to /tmp/hook-seed-batch-invoked.log with the first 200 bytes the hook runner
# sent on stdin (the hook event JSON), so it is possible to tell "the hook did not fire"
# from "the hook ran but its output was not shown". Only /tmp is written; the line is
# small and never read by this script.
set -euo pipefail

cd "$(dirname "$0")/.."

stdin_head=""
if [ ! -t 0 ]; then
  stdin_head="$(timeout 1 head -c 200 2>/dev/null | tr '\n' ' ' || true)"
fi
echo "hook-seed-batch invoked args=[$*] stdin=[${stdin_head}]" >>/tmp/hook-seed-batch-invoked.log

log="$(mktemp)"
trap 'rm -f "$log" "$log.summary"' EXIT

# The batch repeats every FAIL line on stderr; only stdout is kept so each appears once.
rc=0
{
  cargo build -q --release -p sim-cli 2>&1 &&
    target/release/sim-cli batch --seeds 1..=20 --ticks 2000 2>/dev/null
} >"$log" || rc=$?

if [ "$rc" -eq 0 ]; then
  tail -n 1 "$log"
  exit 0
fi

{
  echo "seed batch FAILED (exit $rc)"
  if grep -q '^error' "$log" && ! grep -q '^seed ' "$log"; then
    echo "-- build error (first lines):"
    grep -m 3 -A 8 '^error' "$log" | head -30
  else
    # First 12 FAIL lines (there can be one per seed), then the batch summary line.
    grep -E '^seed [0-9]+ FAIL|^error' "$log" | head -12
    grep -E '^batch:' "$log" || true
  fi
} >"$log.summary"
head -40 "$log.summary"
head -40 "$log.summary" >&2
exit "$rc"
