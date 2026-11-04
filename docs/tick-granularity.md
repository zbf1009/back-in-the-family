# Tick granularity: measurements and design comparison (R10)

> Note (2026-11-04): weekly tick support was removed from the code in task 12 of the `sim-core-skeleton` spec (`days_per_tick`, replay format version 1, the `d7` fixtures and the weekly column of `sim-cli measure`). The numbers below reproduce at commit `bac46e3`. This document is otherwise unchanged and stays as the record of the measurement.

Status: **measured; daily ticks chosen by the author on 2026-11-04** (see "Decision" at the end).

## 1. Purpose and what was measured

`tech.md` says the tick is either 1 day or 1 week, and that the choice is made on design needs, not performance. This document gives the measured cost of each option on a placeholder workload and compares them on the design needs. The author chooses.

Workload (identical for both options): `Workload::Pairwise` with 60 placeholder entities, so each tick does 60 drift updates plus 60 x 59 = 3,540 affinity updates (a stand-in for relationship updates), then advances the tick and computes the checksum over the canonical encoding of the whole world. Seed 1, no inputs. A weekly tick is not internally split into days, so per-tick work is the same at both granularities.

- Lifetime: 80 years. Daily: 80 x 365 = 29,200 ticks. Weekly: 80 x 52 = 4,160 ticks (365 is not a multiple of 7; see section 4e).
- Each run is one full lifetime on a fresh simulation. 5 runs per granularity. "Best" is the minimum, "median" is the median of the 5 runs.
- `ticks/s` = lifetime ticks / best lifetime time.
- Checksum cost: time of 2,000 `Checksum::of(world)` calls on the world after 100 ticks, per call, best of 5 samples. The WASM side cannot call it directly, so it uses `bench_checksum(seed, config, iterations)` (feature `bench`): per call = (best t(2000 iterations) - best t(1 iteration)) / 1999, where the one-iteration call is the baseline (construction + 100 warm-up ticks + one checksum).
- Checksum share of a tick = checksum ns per call / (best lifetime ns / lifetime ticks). `World::step` already includes the checksum, so this is "checksum cost alone divided by full step cost".
- Canonical state size: length of the canonical encoding of the world after 100 ticks (native only).
- WASM is timed in JavaScript with `performance.now()`, outside the simulation. The main row uses one `run_ticks(n)` call per lifetime. The `step()` rows use one `WasmSim.step()` call per tick, so they include the JS-to-WASM boundary and the hex string returned per call.

Reproduce (release build; run on a quiet machine):

```
cargo run --release -p sim-cli -- measure          # native; --runs N --entities N optional
scripts/measure-wasm.sh                            # WASM in Node; same flags
```

## 2. Environment

| Item | Value |
|---|---|
| CPU | 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz, 8 cores / 16 threads (16 logical processors) |
| OS | Arch Linux, kernel 7.2.11-zen1-1-zen |
| rustc / cargo | 1.99.1 (58cf8f9c3 2026-10-13) / 1.99.1 (5f94df478 2026-08-27) |
| Node | v26.7.0 |
| wasm-bindgen CLI / crate | 0.2.130 / 0.2.130 (checked equal by the script) |
| Build profile | `--release`, Cargo defaults: opt-level 3, no LTO, codegen-units 16, panic=unwind (the workspace has no `[profile]` section). WASM: `wasm32-unknown-unknown`, release, feature `bench`, then `wasm-bindgen --target nodejs` (no `wasm-opt`). |
| Load average (1 min) | 0.16 before the native runs, 0.29 to 0.45 during; 0.41 before the WASM runs, up to 0.90 at the end (the rise is the measurement itself plus the build before it). |
| Code measured | base commit `cab7f9f` plus this task's uncommitted changes (`measure.rs`, `bench_checksum`, scripts); the commit that adds this document contains exactly that code. |

## 3. Results

Native and WASM, 60 entities, best of 5. "Spread" is the min to max of the reported value over three separate invocations of the whole command.

### Native (`sim-cli measure`, run 1 of 3)

```
metric                            daily (1d)     weekly (7d)
days_per_tick                              1               7
lifetime_ticks                         29200            4160
ticks_per_second                       23315           23352
lifetime_best_ms                     1252.44          178.14
lifetime_median_ms                   1256.34          178.60
checksum_ns_per_call                   33846           33715
checksum_share_percent                  78.9            78.7
canonical_state_bytes                  36879           36879
```

### WASM (`scripts/measure-wasm.mjs`, Node, run 1 of 3)

```
metric                            daily (1d)     weekly (7d)
days_per_tick                              1               7
lifetime_ticks                         29200            4160
ticks_per_second                       10910           10960
lifetime_best_ms                     2676.34          379.57
lifetime_median_ms                   2676.61          379.95
checksum_ns_per_call                   57792           57814
checksum_share_percent                  63.1            63.4
canonical_state_bytes                      -               -
step_ticks_per_second                  10732           10718
step_lifetime_best_ms                2720.85          388.14
step_lifetime_median_ms              2728.46          388.32
```

### Run-to-run spread (3 invocations each)

| Metric | Native daily | Native weekly | WASM daily | WASM weekly |
|---|---|---|---|---|
| ticks/s | 23,310 to 23,354 | 23,352 to 23,432 | 10,910 to 10,928 | 10,932 to 10,960 |
| lifetime best, ms | 1250.34 to 1252.70 | 177.54 to 178.14 | 2672.15 to 2676.34 | 379.57 to 380.53 |
| lifetime median, ms | 1254.63 to 1256.34 | 177.82 to 178.90 | 2674.30 to 2676.61 | 379.95 to 381.47 |
| checksum ns/call | 33,802 to 34,656 | 33,715 to 34,640 | 57,781 to 57,959 | 57,814 to 57,867 |
| checksum share, % | 78.9 to 80.8 | 78.7 to 81.2 | 63.1 to 63.3 | 63.3 to 63.4 |
| `step()` ticks/s | - | - | 10,607 to 10,732 | 10,596 to 10,718 |

Lifetime times repeat within about 0.2% (native) and 0.2% (WASM); best and median within 0.4% of each other. The checksum per-call figure is noisier natively (up to about 3%), which moves the share by up to 2.5 points. A fourth WASM run through `scripts/measure-wasm.sh` was only checked for its header (it printed `wasm-bindgen 0.2.130`; the three recorded WASM runs called `node` directly, so their header says `wasm-bindgen unknown`).

### What the numbers show and do not show

- Ticks per second does not depend on `days_per_tick`: 23.3k/s native and 10.9k/s WASM at both settings. The granularity only changes how many ticks a life needs (7.0x fewer weekly), so a weekly lifetime is 7.0x cheaper (178 ms vs 1252 ms native; 380 ms vs 2676 ms WASM). This is by construction, not a finding.
- One tick costs about 43 us natively and 91 us in WASM (WASM is 2.1x slower; its checksum is 1.7x slower).
- The checksum is most of the tick: 79% native, 63% WASM. The placeholder state encodes to 36,879 bytes, so per-tick hashing is about 1.09 GB/s native and 0.64 GB/s WASM (36,879 B / 33.8 us, 36,879 B / 57.8 us). The 36,879 bytes break down as follows (checked against the `Canon` impls in `world.rs`; the earlier text "60 entities x 59 affinities x 2 bytes, plus values" was wrong because each affinity entry also encodes its 8-byte id key):
  - affinity entries: 60 x 59 = 3,540 entries x 10 bytes (8-byte id + 2-byte value) = 35,400;
  - entities: 60 x 24 bytes (8-byte map key + 8-byte id + 4-byte value + 4-byte affinity-map length) = 1,440;
  - header and rejections: 39 bytes (2 canon version + 8 seed + 4 config, which then included the 1-byte `days_per_tick` + 8 tick + 8 id counter + 4 entity-map length = 34, plus 5 for the empty rejection record: 4-byte map length + 1-byte `last` tag);
  - total 35,400 + 1,440 + 39 = 36,879. After task 12 removed `days_per_tick` the header is 38 bytes and the total is 36,878 (35,400 + 1,440 + 38), which `sim-cli measure` prints today.
- The JS-to-WASM boundary adds about 1.5 us per daily `step()` call and about 2.0 us per weekly one ((2720.85 - 2676.34) ms / 29,200; (388.14 - 379.57) ms / 4,160), 2% of a tick.
- The numbers do not include the real life-sim, narrator, event log or presentation. The workload is a placeholder; real per-tick work will differ, probably upward.

## 4. Design comparison

Targets from `product.md`: one life lasts 5 to 10 minutes of play; first interruption within about 30 s; roughly one interruption every 30 to 40 s; a town of 40 to 60 residents.

### (a) Resolution of "due within N days" stakes

Daily ticks: every N is exactly representable. A debt or promise due in 1, 3, 10 or 30 days is due after exactly 1, 3, 10 or 30 ticks.

Weekly ticks: only multiples of 7 days are representable. `tech.md` requires a defined rounding for every division, so a weekly world needs one rule for converting a due-in-N-days stake into ticks. The candidates:

| Due in N days | Exact in weekly ticks? | Round up (`ceil(N/7)`, minimum 1) | Round to nearest | Round down |
|---|---|---|---|---|
| 1 | no | 1 tick = 7 days (+6 days, 7x as long) | 0 ticks = due immediately | 0 ticks = due immediately |
| 3 | no | 1 tick = 7 days (+4, 2.3x) | 0 ticks = due immediately | 0 ticks |
| 10 | no | 2 ticks = 14 days (+4, 1.4x) | 1 tick = 7 days (-3) | 1 tick = 7 days (-3) |
| 30 | no | 5 ticks = 35 days (+5, 1.17x) | 4 ticks = 28 days (-2) | 4 ticks = 28 days (-2) |
| 7, 14, 28 | yes | exact | exact | exact |

Rounding down or to nearest turns short stakes into "due now", which breaks stakes under a week; weekly ticks would need the round-up rule (a deadline is never earlier than promised), with a minimum of one tick. A stake is then never shorter than promised but can be up to 6 days longer, and the player-facing text must be generated from the tick count ("due in 2 weeks"), not from the promised day count ("due in 10 days"). The alternative is to store due dates in days and compare them against `tick x 7` at each tick boundary: the stake stays exact in data, but it resolves at the first tick boundary at or after the due date, which is the same up-to-6-days lateness (mean 3 days) with a more complex model.

Calendar: 365 is not divisible by 7 (365 / 7 = 52.14). A weekly world needs either a 52-week, 364-day year (one day lost per year, so birthdays and fixed dates such as Halloween drift against a 365-day calendar: about 80 days over 80 years) or a calendar with leap weeks. With daily ticks, a 365-day calendar is exact (leap days are a separate decision). Age-based life-stage nodes ("at six") work with either: weekly resolution is fine for ages.

### (b) Events per tick and narrator pacing

Nodes per life. A 5-minute life is 300 s: first node at 30 s, then every 40 s gives 30 + 40k <= 300, so 7 nodes. A 10-minute life is 600 s with a node every 30 s: 20 nodes. So about 7 to 20 nodes per life.

Ticks between two nodes, if a life spans the full 80 years (a first life starting as an adult has fewer, so halve these for 40 years):

| | 7 nodes (slow) | 20 nodes (fast) |
|---|---|---|
| Daily: 29,200 ticks / nodes | 4,171 ticks | 1,460 ticks |
| Weekly: 4,160 ticks / nodes | 594 ticks | 208 ticks |
| In-game time between nodes (80 / nodes) | 11.4 years | 4.0 years |

Between two nodes there are 208 to 594 weekly ticks, or 1,460 to 4,171 daily ticks; both are plenty for the narrator to find patterns, and in-game time between nodes (4 to 11 years) is the same under both. The granularity does not change how much happens between nodes; it changes how finely that is cut into ticks.

Events per tick. The event rate is not yet known. As an illustration only (assumption, not a measurement): if the 60 residents produce one logged event each per in-game year, that is 60 events per year. Daily: 60 / 365 = 0.16 events per tick, so most ticks are empty and events rarely share a tick. Weekly: 60 / 52 = 1.15 events per tick, so about one event per tick and several events per tick are normal. Events in the same tick cannot be ordered by time, only by the tick's fixed step order, so a cause and its effect that happen within one week land in the same tick; the narrator's "one-hop neighbour" scans and `caused_by` pointers would link events of the same tick. With daily ticks that happens 7x less often. Per node interval, the narrator scans the same total number of events either way (60 x 4 to 11 years = 240 to 690 events under the assumption); daily ticks call the scan 7x more often with 7x fewer events each, which only matters if the scan has a large fixed cost per call.

First interruption: about 30 s into play. At the measured speeds the simulation needs far less than that (section 4c), so the 30 s is set by the pacing design, not by simulation cost, at both granularities.

### (c) Fast-forward cost

Arithmetic: seconds = ticks / (ticks per second), using the best-run ticks/s of section 3.

| | Native daily | Native weekly | WASM daily | WASM weekly |
|---|---|---|---|---|
| Ticks per in-game year | 365 | 52 | 365 | 52 |
| Seconds per in-game year | 365 / 23,315 = 15.7 ms | 52 / 23,352 = 2.2 ms | 365 / 10,910 = 33.5 ms | 52 / 10,960 = 4.7 ms |
| Seconds per 80-year life | 1.25 s | 0.18 s | 2.68 s | 0.38 s |
| Share of a 300 s life | 0.42% | 0.06% | 0.89% | 0.13% |
| Share of a 600 s life | 0.21% | 0.03% | 0.45% | 0.06% |

Performance is not a constraint at either granularity on this placeholder workload: even daily ticks in WASM use under 1% of the play time. Headroom: if simulation is allowed 10% of a 300 s life (30 s), that is 30 s / 29,200 = 1.03 ms per daily tick (11x the measured 91 us WASM tick) or 30 s / 4,160 = 7.2 ms per weekly tick (79x). So the real life-sim could be about 11x (daily) or about 79x (weekly) heavier than the placeholder before fast-forward reaches 10% of the play time in WASM. This is headroom information only; per `tech.md` the choice is made on design needs.

### (d) Replay size

A replay stores one checksum per tick as a 16-character hex string in JSON, 19 bytes each with quotes and comma. Recorded with `sim-cli record --seed 1 --ticks N` (60 entities, no inputs) and verified by size, then deleted: 29,200 daily ticks = 554,973 bytes (29,200 x 19 = 554,800 plus 173 of header); 4,160 weekly ticks = 79,212 bytes (4,160 x 19 = 79,040 plus 172). That is about 0.55 MB vs 0.08 MB per life; a gallery replay of 8 lives would be about 4.4 MB daily or 0.63 MB weekly (arithmetic, not recorded). The design text said "about 0.6 MB" for a daily life; the real figure is 0.55 MB. Neither is near the 25 MiB per-file limit.

### (e) Other things the measurement and code revealed

- The checksum dominates tick cost (79% native), and the cost is hashing all of the state every tick: 36,879 bytes x 29,200 daily ticks = 1.08 GB hashed per life, versus 0.15 GB weekly (7x less). With real game state larger than the placeholder, "checksum every tick" (`tech.md` rule 8) is the first cost to grow. Daily ticks make it 7x more expensive per in-game year. This is not a reason to choose either option, but it is a lever to know about (checksum every N ticks, or only at nodes, would be a rule-8 change for the author to decide).
- `Checksum::of` builds the whole canonical encoding in a `Vec<u8>` (`encode_to_vec`) and then hashes it, so each tick allocates about 36.9 KB. The design (D4) described the encoding as streaming into the hasher with no allocation; the code does not do that. Not changed in this task (sim-core is untouched). Streaming into the hasher would likely cut part of the 34 us per call; it was not measured.
- 365 days is not a whole number of weeks (section 4a): a weekly calendar is a 364-day year, so a "lifetime" is 4,160 weekly ticks (80 x 52), which is 29,120 days, 80 days short of 29,200. The design's 4,160 figure already assumes this.
- Daily drift in the placeholder is scaled by `days_per_tick` (a +-10 x d range). That is placeholder behavior and is not a reason for either option.
- Inputs apply at a tick boundary. At weekly granularity a player or LLM choice recorded for "tick T" takes effect at a 7-day boundary; since the simulation is paused at nodes this is not visible, but the input's `tick` field has 7x coarser meaning.

## 5. Decision

**Chosen by the author on 2026-11-04: 1 day per tick.** Recorded in `.kiro/steering/tech.md` and `docs/kiro-log.md`. It rests on the design comparison in section 4: exact "due within N days" stakes, a plain 365-day calendar, and rarely more than one event per tick. Performance did not decide it; the measurements show both options are fast. Costs accepted: 7x more ticks per life, hence 7x more checksum work, and larger replay files (about 0.55 MB per 80-year life).

Follow-up: the weekly option is removed from the code in task 12 of the `sim-core-skeleton` spec. The numbers above stay reproducible at commit `bac46e3`.

Non-binding observation by the agent: the measurements do not separate the options on speed (both fast with large headroom), so the choice rests on stakes and calendar. Daily ticks keep "due within N days" and a 365-day calendar exact at the price of 7x more ticks (more checksum work, larger replays, 7x less fast-forward headroom); weekly ticks are cheaper and still give 200 to 600 ticks between nodes but need a round-up rule for short stakes and a 364-day year or leap weeks.
