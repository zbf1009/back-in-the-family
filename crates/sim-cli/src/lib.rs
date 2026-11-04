//! Library part of `sim-cli`: argument parsing, input generation and the subcommand
//! implementations, kept separate from `main.rs` so they are unit-testable without
//! shelling out to the built binary.
//!
//! `sim-cli` is tooling, not simulation code: unlike `sim-core`, it may use
//! `std::fs`, `std::env`, `std::time` and `std::process::exit` freely.

#![forbid(unsafe_code)]

pub mod args;
pub mod batch;
pub mod commands;
pub mod inputs;
pub mod measure;

use std::io::Write;

/// The text printed by `--help` (stdout, exit 0) and on a missing or unknown subcommand
/// (stderr, exit 2).
pub const USAGE: &str = "\
sim-cli: native headless runner for sim-core

USAGE:
  sim-cli record --seed S --ticks N --out FILE [--config FILE] [--random-inputs K]
  sim-cli replay FILE...
  sim-cli check-size DIR [--max-bytes N]
  sim-cli batch --seeds A..=B --ticks N [--random-inputs K] [--config FILE]
  sim-cli measure [--runs N] [--entities N]
  sim-cli --help

record       Run N ticks from seed S and write a replay file (parent directories are
             created). Without --config the world has 50 entities, 1 day per tick and the
             Pairwise workload. --config FILE is JSON with the replay file's config shape:
             {\"entity_count\":50,\"days_per_tick\":1,\"workload\":\"Pairwise\"}.
             --random-inputs K adds K inputs generated from the seed (about one third are
             invalid on purpose). The same command line always writes identical bytes.
replay       Re-run each replay file from its seed, config and inputs and compare every
             tick's checksum. Prints `ok FILE` on stdout per verified file; problems go to
             stderr.
check-size   Fail if any file under DIR (recursive) is at or above --max-bytes
             (default 26214400, 25 MiB).
batch        For each seed in the inclusive range A..=B (or a single seed A; at most 10000
             seeds), in ascending order: generate K random inputs (default 60), run N ticks
             checking the world invariants before the first tick and after every tick,
             then record and verify a replay in memory and compare its checksums with the
             stepped run's. Same default world as record. Prints one line per seed
             (`seed 7 ok ticks=... final=... entities=... rejections=... value_min=...
             value_max=... value_mean=...`, or `seed 7 FAIL ...`) and `batch: OK/TOTAL
             seeds ok`; output has no timestamps and is identical across runs. value_mean
             is integer division rounded down; with no entities the three value fields
             print `-`. FAIL tick=T means T ticks had run when the invariant broke (0 =
             before the first tick). All seeds are run even after a failure; failures are
             also written to stderr. NOTE: --seeds A..=B is a range, unlike the plain
             decimal numbers of the other flags.
measure      Time one 80-year lifetime (80 x 365 = 29200 daily ticks, 80 x 52 = 4160 weekly)
             on a fresh Sim, Pairwise workload, seed 1, no inputs, --runs times (default 5,
             1..=50) with --entities entities (default 60, 0..=200). Prints best and median
             lifetime wall time, ticks per second (from the best run), the cost of one
             Checksum::of call on the world after 100 ticks, its share of a tick, and the
             canonical state size. Run with --release; a debug build says so in the header
             and its numbers mean nothing. Output depends on timing, so it is not stable.

EXIT CODES:
  0  success
  1  replay: a checksum diverged (first divergent tick is printed); record: the fresh
     replay failed its own verification; check-size: a file is at or above the limit;
     batch: any seed broke an invariant or diverged
  2  usage error, unreadable or malformed file, invalid config, I/O error
     (replay with several files: all are processed; 2 wins over 1)";

/// Runs the CLI for `args` (without the program name) and returns the exit code.
pub fn run(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let code = dispatch(args, out, err);
    let _ = out.flush();
    let _ = err.flush();
    code
}

fn dispatch(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let Some((command, rest)) = args.split_first() else {
        let _ = writeln!(err, "error: missing subcommand\n\n{USAGE}");
        return commands::EXIT_USAGE_OR_MALFORMED;
    };
    if matches!(command.as_str(), "--help" | "-h" | "help")
        || rest.iter().any(|a| a == "--help" || a == "-h")
    {
        let _ = writeln!(out, "{USAGE}");
        return commands::EXIT_OK;
    }
    match command.as_str() {
        "record" => commands::record(rest, out, err),
        "replay" => commands::replay(rest, out, err),
        "check-size" => commands::check_size(rest, out, err),
        "batch" => batch::batch(rest, out, err),
        "measure" => measure::measure(rest, out, err),
        other => {
            let _ = writeln!(err, "error: unknown subcommand {other:?}\n\n{USAGE}");
            commands::EXIT_USAGE_OR_MALFORMED
        }
    }
}
