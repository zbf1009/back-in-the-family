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
version 4: `Act` payloads, with `tick`, `actor` and `target` as strict decimal strings
and `kind` one of the card event names (`help`, `gift`, `quarrel`, `insult`, `theft`,
`apology`). Version 4 is the life-sim shape with the underworld payload kinds added by
later tasks; a version 3 file is rejected as unsupported.

`seedbig` is above 2^53 on purpose: it exercises the `u64`-as-decimal-string path that
JavaScript numbers cannot hold. The 120 inputs per file are generated from the seed
(`--random-inputs 120`); about a quarter of them are invalid on purpose (unknown persons,
self targets, out-of-range intensities, and persons who died during the run), so
rejections enter the checksums. The names are a contract: the WASM parity test embeds
them with `include_str!`.

The names `pairwise` and `seedbig-pairwise` are kept from the skeleton era, when they
described a synthetic workload. The life-sim has no workload; only the contents of the
files changed.

## Snapshot fixture

`seed1-pairwise.snapshot-500.json` is the native Snapshot (R18) of the World after tick
500 of `seed1-pairwise.replay.json`. The design asks only for "a snapshot recorded
natively at tick 500"; `sim-cli snapshot` is the chosen recorder and this file is its
output:

```sh
sim-cli snapshot --replay fixtures/parity/seed1-pairwise.replay.json --at 500 \
  --out fixtures/parity/seed1-pairwise.snapshot-500.json
```

It replays the file's seed, config and inputs, checks every recorded checksum on the
way, and writes one line of compact Snapshot JSON. The file has no trailing newline so
`WasmSim::snapshot()` can be compared with it byte for byte in
`crates/sim-wasm/tests/parity.rs` (R18.3).

After `souls` the Snapshot carries the underworld state (design "Snapshot"): the
`magistrate` object (the one official Person, in no other list), `joss` (every Soul's
balance as a decimal string, in Soul ID order), `birth_slots` (the open slots with their
household, birth tick, `"0"` price and claimant Soul ID or `null`), `standing_slots`
(both slots, `imported_vessel` first, present exactly while the Player_Soul waits),
`player_wait` (`null` while it is in a body) and `pending_nodes` (empty between ticks,
because both node families resolve in their firing tick).

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
sim-cli snapshot --replay fixtures/parity/seed1-pairwise.replay.json --at 500 \
  --out fixtures/parity/seed1-pairwise.snapshot-500.json
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