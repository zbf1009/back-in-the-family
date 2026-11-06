# Grading fixtures

Synthetic fixtures for the llm-probe grading code (`sim_core::llm::api`), used by the
native and wasm32 parity tests and the Probe_Runner's TypeScript parity test.

**No model output is in here.** Everything is generated from the Dev_Cards
(`eval/cards/cards/dev.jsonl`, read only). The locked split is never read.

| File | Content |
|---|---|
| `dev-outputs.json` | For every Dev_Card: valid outputs (one per option for D; gold, fenced gold, empty, `must_not_include` and severe-pattern answers for S, all built from the card's own answer key) and Illegal outputs from a fixed list of mutations (empty, prose, truncated, wrong type, unknown field, bad enum, duplicate evidence, timeout, runtime error, and so on). At least one valid and one Illegal output per card. Each output has a `label`, a `kind` (`valid` or `illegal`) and either `raw` text or an `outcome` object. |
| `dev-golden.json` | The exact result bytes (as strings) of every export on every card and output. |

## What `dev-golden.json` holds

Per card (in `dev.jsonl` order): `parse_card`, `permutations`, one `render_prompt` result per
kept permutation, and per output `validate`, `grade` and `identity`. Then `contrast`: for each
Contrast_Pair, every valid-by-valid combination plus each Illegal output against the other
card's first valid output, both ways. A reader rebuilds the inputs like this:

- `parse_card`: the card line.
- `frozen_context` (FC): the `frozen_context` member of the `parse_card` result.
- `permutations`: `{"frozen_context":FC}`.
- `render_prompt`: `{"frozen_context":FC,"template":T,"schema_text":S,"permutation":P}` with T
  from `templates.decision` (D cards) or `templates.synthesis` (S cards), S `null` for D cards
  and the file's `schema_text` for S cards.
- `validate`: `{"frozen_context":FC,"raw":R}` or `{"frozen_context":FC,"outcome":O}`.
- `grade` and `identity`: `{"card":LINE,"verdict":V}`, V being the `verdict` of the `validate` result.
- `contrast`: `{"card_a":LINE_A,"verdict_a":V_A,"card_b":LINE_B,"verdict_b":V_B}`.

The files are canonical (sorted keys, two-space indent, one trailing newline) and
byte-identical on every run.

## Regenerating

Only on purpose, after an **intended** change to the grading code, the prompt renderer or the
Dev_Cards. Tests never write these files.

```sh
scripts/regen-grading-golden.sh
```

which builds `sim-cli` and runs `sim-cli grading-outputs` (writes `dev-outputs.json`) and then
`sim-cli grading-golden` (writes `dev-golden.json`). Running it twice leaves `git status`
unchanged. Review the diff, and say in the commit message that the golden file was
regenerated on purpose. A fixture failure otherwise means behavior changed: fix the code, do
not regenerate to make a test pass. Never edit these files by hand, except to demonstrate
tamper detection on a **copy** or in an injected fault that is reverted.
