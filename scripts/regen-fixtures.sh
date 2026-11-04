#!/usr/bin/env bash
# Regenerates fixtures/parity/*.replay.json with sim-cli. Run it only after an
# intentional change to tick logic, and read fixtures/parity/README.md first.
# The output is byte-identical on every run, so a second run must leave `git status`
# unchanged.
set -euo pipefail

cd "$(dirname "$0")/.."

cargo build -q -p sim-cli
cli=target/debug/sim-cli

record() {
  local name="$1" seed="$2" config="$3"
  "$cli" record --seed "$seed" --ticks 2000 --random-inputs 120 \
    --config "fixtures/configs/$config" --out "fixtures/parity/$name.replay.json"
}

record seed1-d1-pairwise 1 pairwise-d1.json
record seed1-d7-pairwise 1 pairwise-d7.json
record seedbig-d1-pairwise 18446744073709551557 pairwise-d1.json
record seedbig-d7-pairwise 18446744073709551557 pairwise-d7.json
