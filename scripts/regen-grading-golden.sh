#!/usr/bin/env bash
# Regenerates fixtures/grading/dev-outputs.json, fixtures/grading/dev-golden.json and
# fixtures/grading/system-one-golden.json, fixtures/grading/perm-avg-inputs.json and
# fixtures/grading/perm-avg-golden.json with sim-cli. Run it only on purpose (after an
# intended change to the llm grading code, the renderer or the Dev_Cards) and read fixtures/grading/README.md first. Tests never run it.
# Only eval/cards/cards/dev.jsonl is read. The output is byte-identical on every run, so a
# second run must leave `git status` unchanged.
set -euo pipefail

cd "$(dirname "$0")/.."

cargo build -q -p sim-cli
cli=target/debug/sim-cli

"$cli" grading-outputs --cards eval/cards/cards/dev.jsonl \
  --out fixtures/grading/dev-outputs.json
"$cli" grading-golden --cards eval/cards/cards/dev.jsonl \
  --outputs fixtures/grading/dev-outputs.json --out fixtures/grading/dev-golden.json
"$cli" grading-system-one-golden --cards eval/cards/cards/dev.jsonl \
  --out fixtures/grading/system-one-golden.json
"$cli" grading-perm-avg-inputs --cards eval/cards/cards/dev.jsonl \
  --out fixtures/grading/perm-avg-inputs.json
"$cli" grading-perm-avg-golden --inputs fixtures/grading/perm-avg-inputs.json \
  --out fixtures/grading/perm-avg-golden.json
