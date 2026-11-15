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

record seed1-pairwise 1 pairwise.json
record seed2-pairwise 2 pairwise.json
record seedbig-pairwise 18446744073709551557 pairwise.json

# OP-D6: earliest Player_Soul death from the one-off 1..=200, 7300-tick batch
# (seed 45, death tick 764). Keep the passive Auto_Player's original input seq.
"$cli" record --seed 45 --ticks 1164 --random-inputs 60 --auto-player \
  --out fixtures/parity/seedU-underworld.replay.json

# The native Snapshot (R18) at tick 500 of seed1-pairwise. The design asks for "a
# snapshot recorded natively at tick 500"; `sim-cli snapshot` is that recorder and
# fixtures/parity/README.md names the subcommand.
snapshot() {
  local name="$1" at="$2"
  "$cli" snapshot --replay "fixtures/parity/$name.replay.json" --at "$at" \
    --out "fixtures/parity/$name.snapshot-$at.json"
}

snapshot seed1-pairwise 500
