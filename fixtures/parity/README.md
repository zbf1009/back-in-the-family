# Parity fixtures

Golden replay files for the native-vs-WASM checksum check (design decision D7 of the
`sim-core-skeleton` spec). Each file is a complete run: seed, world config, recorded
inputs and the checksum of every tick.

| File | Seed | Workload | Entities | Ticks | Recorded inputs |
|---|---|---|---|---|---|
| `seed1-pairwise.replay.json` | 1 | Pairwise | 50 | 2000 | 120 |
| `seed2-pairwise.replay.json` | 2 | Pairwise | 50 | 2000 | 120 |
| `seedbig-pairwise.replay.json` | 18446744073709551557 | Pairwise | 50 | 2000 | 120 |

One tick is one day, so the config has no tick-length field. The files use replay format
version 2.

`seedbig` is above 2^53 on purpose: it exercises the `u64`-as-decimal-string path that
JavaScript numbers cannot hold. The 120 inputs per file are generated from the seed
(`--random-inputs 120`); about one third of them are invalid on purpose (unknown
entities, out-of-range values, repeated despawns), so rejections enter the checksums.
The names are a contract: the WASM parity test embeds them with `include_str!`.

## Who checks them

- Native: `cargo test -p sim-core --test replay` verifies every file and fails if one is
  missing, renamed or extra.
- WASM: `sim-wasm/tests/parity.rs`, under `wasm-bindgen-test` in Node.
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
