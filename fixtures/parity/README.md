# Parity fixtures

Golden replay files for the native-vs-WASM checksum check (design decision D7 of the
`sim-core-skeleton` spec). Each file is a complete run: seed, world config, recorded
inputs and the checksum of every tick.

| File | Seed | Config | Ticks | Recorded inputs |
|---|---|---|---|---|
| `seed1-pairwise.replay.json` | 1 | `{"opening_residents":50}` | 2000 | 120 |
| `seed2-pairwise.replay.json` | 2 | `{"opening_residents":50}` | 2000 | 120 |
| `seedbig-pairwise.replay.json` | 18446744073709551557 | `{"opening_residents":50}` | 2000 | 120 |

One tick is one day, so the config has no tick-length field. The files use replay format
version 3: `Act` payloads, with `tick`, `actor` and `target` as strict decimal strings
and `kind` one of the card event names (`help`, `gift`, `quarrel`, `insult`, `theft`,
`apology`).

`seedbig` is above 2^53 on purpose: it exercises the `u64`-as-decimal-string path that
JavaScript numbers cannot hold. The 120 inputs per file are generated from the seed
(`--random-inputs 120`); about a quarter of them are invalid on purpose (unknown persons,
self targets, out-of-range intensities, and persons who died during the run), so
rejections enter the checksums. The names are a contract: the WASM parity test embeds
them with `include_str!`.

The names `pairwise` and `seedbig-pairwise` are kept from the skeleton era, when they
described a synthetic workload. The life-sim has no workload; only the contents of the
files changed.

## Who checks them

- Native and WASM: `crates/sim-wasm/tests/parity.rs`. Under
  `cargo test -p sim-wasm --target wasm32-unknown-unknown` it runs in Node through
  `wasm-bindgen-test-runner`; under plain `cargo test` the same test functions fall back
  to `#[test]`, so a native build verifies the fixtures too.
- By hand: `cargo run -p sim-cli -- replay fixtures/parity/*.replay.json`
  (exit 0 and one `ok` line per file; exit 1 and the first divergent tick on a mismatch).

## Regenerating

Only after an **intentional** change to tick logic, the random streams, the canonical
encoding or the replay format:

```sh
scripts/regen-fixtures.sh
```

which runs, for each file (the config files live in `fixtures/configs/`):

```sh
sim-cli record --seed 1 --ticks 2000 --random-inputs 120 \
  --config fixtures/configs/pairwise.json --out fixtures/parity/seed1-pairwise.replay.json
sim-cli record --seed 2 --ticks 2000 --random-inputs 120 \
  --config fixtures/configs/pairwise.json --out fixtures/parity/seed2-pairwise.replay.json
sim-cli record --seed 18446744073709551557 --ticks 2000 --random-inputs 120 \
  --config fixtures/configs/pairwise.json --out fixtures/parity/seedbig-pairwise.replay.json
```

The output is byte-identical on every run, so running the script twice leaves
`git status` unchanged. After an intentional change the diff shows the new checksums;
review it before committing.

## Rules

- Never edit a fixture by hand, except to demonstrate tamper detection on a **copy**
  outside the repository.
- Never regenerate to make a failing test pass without understanding why it fails. A
  fixture failure means some behavior changed: either that was intended (regenerate and
  say so in the commit message) or it is a bug (fix the code).