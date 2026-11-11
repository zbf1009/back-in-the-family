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
pub mod grading;
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
  sim-cli grading-outputs --cards FILE --out FILE
  sim-cli grading-golden --cards FILE --outputs FILE --out FILE
  sim-cli grading-system-one-golden --cards FILE --out FILE
  sim-cli grading-perm-avg-inputs --cards FILE --out FILE
  sim-cli grading-perm-avg-golden --inputs FILE --out FILE
  sim-cli --help

record       Run N ticks from seed S and write a replay file (parent directories are
             created). Without --config the world config is {\"opening_residents\":50}.
             --config FILE is JSON with the replay file's config shape:
             {\"opening_residents\":50}; an unknown field (such as the retired
             `workload`) is an error.
             --random-inputs K adds K inputs generated from the seed (about a quarter are
             invalid on purpose). The same command line always writes identical bytes.
replay       Re-run each replay file from its seed, config and inputs and compare every
             tick's checksum. Prints `ok FILE` on stdout per verified file; problems go to
             stderr.
check-size   Fail if any file under DIR (recursive) is at or above --max-bytes
             (default 26214400, 25 MiB).
batch        For each seed in the inclusive range A..=B (or a single seed A; at most 10000
             seeds), in ascending order: generate K random inputs (default 60), run N ticks
             checking the world invariants before the first tick and after every tick,
             then build the replay from the stepped run's own checksums and verify it in
             memory, and recompute the Event_Log digest from scratch. Same default world
             as record. Prints one line per seed with resident counts and band ticks,
             waiting-queue and max-wait figures, births/deaths/arrivals by origin, event
             and relation counts, rejection counts and the target results (or
             `seed 7 FAIL ...`), then `batch: OK/TOTAL seeds ok`; output has no timestamps
             and is identical across runs. --require-targets makes a failing R17.1, R17.8
             or R17.9 target fail the seed (without it, targets print `=fail` but the seed
             stays ok). A failed invariant prints its tick, criterion and detail and
             exits 1. NOTE: --seeds A..=B is a range, unlike the plain decimal numbers of
             the other flags.
measure      Time one 80-year lifetime (80 x 365 = 29200 daily ticks)
             on a fresh Sim, Pairwise workload, seed 1, no inputs, --runs times (default 5,
             1..=50) with --entities entities (default 60, 0..=200). Prints best and median
             lifetime wall time, ticks per second (from the best run), the cost of one
             Checksum::of call on the world after 100 ticks, its share of a tick, and the
             canonical state size. Run with --release; a debug build says so in the header
             and its numbers mean nothing. Output depends on timing, so it is not stable.
grading-outputs  Write the synthetic Dev_Card outputs (valid ones from each card's answer
             key, Illegal ones from fixed mutations; no model output) for the llm grading
             fixtures. Deterministic. Run only by scripts/regen-grading-golden.sh.
grading-golden   Run every sim_core::llm::api export on every card x fixture output and
             write the expected result bytes. Deterministic. Same script.
grading-system-one-golden  Run the raw_choice mode of llm_validate and llm_render_system_one
             on every Dev_Card and write the expected result bytes. Deterministic. Same script.
grading-perm-avg-inputs  Write the synthetic inputs of llm_aggregate_perm_avg (built from the
             Dev_Cards' option IDs; no model output). Deterministic. Same script.
grading-perm-avg-golden  Run llm_aggregate_perm_avg on those inputs and write the expected
             result bytes. Deterministic. Same script.

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
        "grading-outputs" => grading::grading_outputs(rest, out, err),
        "grading-golden" => grading::grading_golden(rest, out, err),
        "grading-system-one-golden" => grading::grading_system_one_golden(rest, out, err),
        "grading-perm-avg-inputs" => grading::grading_perm_avg_inputs(rest, out, err),
        "grading-perm-avg-golden" => grading::grading_perm_avg_golden(rest, out, err),
        other => {
            let _ = writeln!(err, "error: unknown subcommand {other:?}\n\n{USAGE}");
            commands::EXIT_USAGE_OR_MALFORMED
        }
    }
}
