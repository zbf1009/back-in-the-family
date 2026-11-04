//! `sim-cli batch`: run many seeds with generated random inputs, check the world
//! invariants after every tick, and round-trip each run through `record` + `verify`.
//!
//! The output is a pure function of the arguments (no timestamps, no timing), so two runs
//! of the same command line print identical bytes.
//!
//! # Output
//!
//! One stdout line per seed, in ascending seed order:
//!
//! ```text
//! seed 7 ok ticks=2000 final=<16 hex> entities=<n> rejections=unknown_entity:a,value_out_of_range:b,id_exhausted:c value_min=<m> value_max=<M> value_mean=<mean>
//! seed 7 FAIL tick=<t> invariant: <Debug of the InvariantViolation>
//! seed 7 FAIL divergence: <message>
//! seed 7 FAIL setup: <message>
//! ```
//!
//! then `batch: <ok>/<total> seeds ok`.
//!
//! * `value_mean` is the sum of the entities' `value`s divided by the entity count with
//!   integer division rounded down. With no entities at the end of the run, `value_min`,
//!   `value_max` and `value_mean` are all printed as `-`.
//! * `FAIL tick=<t>`: `t` is the world's tick counter when the check ran, so `0` means
//!   the freshly built world before any tick and `t` means after `t` ticks have run.
//! * `FAIL divergence`: the in-memory `record` + `verify` round trip failed, or the
//!   checksums of the stepped run (the one with per-tick invariant checks) differ from the
//!   recorded run's.
//!
//! Every seed is processed even after failures; each failure is also written to stderr.

use std::io::Write;

use sim_core::replay::{ReplayError, record as core_record, verify};
use sim_core::tick::Sim;
use sim_core::world::{InvariantViolation, RejectReason, World, WorldConfig};

use crate::args;
use crate::commands::{
    EXIT_FAILED, EXIT_OK, EXIT_USAGE_OR_MALFORMED, MAX_RANDOM_INPUTS, MAX_TICKS, default_config,
    load_config,
};
use crate::inputs::generate_inputs;

/// Largest number of seeds one `batch` run accepts.
pub const MAX_SEEDS: u64 = 10_000;
/// `--random-inputs` default for `batch`.
pub const DEFAULT_RANDOM_INPUTS: u64 = 60;

pub const BATCH_USAGE: &str = "usage: sim-cli batch --seeds A..=B --ticks N \
[--random-inputs K] [--config FILE]\n\
--seeds is an inclusive range (or a single seed A), at most 10000 seeds; \
--random-inputs defaults to 60; without --config: 50 entities, 1 day per tick, Pairwise";

/// Parses `--seeds`: `A..=B` (inclusive) or a single `A`. Rejects descending ranges,
/// malformed text and ranges of more than [`MAX_SEEDS`] seeds.
pub fn parse_seed_range(text: &str) -> Result<(u64, u64), String> {
    let (first, last) = match text.split_once("..=") {
        Some((a, b)) => (args::parse_u64(a)?, args::parse_u64(b)?),
        None => {
            if text.contains("..") {
                return Err(format!(
                    "expected an inclusive range A..=B or a single seed, got {text:?}"
                ));
            }
            let a = args::parse_u64(text)?;
            (a, a)
        }
    };
    if last < first {
        return Err(format!("descending seed range {first}..={last}"));
    }
    // `last >= first`, so the subtraction cannot underflow; the count saturates.
    let count = (last - first).saturating_add(1);
    if count > MAX_SEEDS {
        return Err(format!(
            "seed range {first}..={last} has {count} seeds, at most {MAX_SEEDS} are allowed"
        ));
    }
    Ok((first, last))
}

/// What a successful seed reports.
#[derive(Debug, Eq, PartialEq)]
struct SeedStats {
    final_checksum: String,
    entities: usize,
    /// Counts for `unknown_entity`, `value_out_of_range`, `id_exhausted`, in that order.
    rejections: [u64; 3],
    /// `(min, max, mean)` of the entity values; `None` when there are no entities.
    values: Option<(i32, i32, i64)>,
}

#[derive(Debug, Eq, PartialEq)]
enum SeedOutcome {
    Ok(SeedStats),
    Invariant {
        tick: u64,
        violation: InvariantViolation,
    },
    Divergence(String),
    Setup(String),
}

/// `(min, max, mean)` of `values`, or `None` if empty. The mean is the sum divided by the
/// count with integer division rounded down (toward negative infinity).
fn summarize(mut values: impl Iterator<Item = i32>) -> Option<(i32, i32, i64)> {
    let first = values.next()?;
    let (mut min, mut max, mut sum, mut n) = (first, first, i128::from(first), 1i128);
    for v in values {
        min = min.min(v);
        max = max.max(v);
        sum += i128::from(v);
        n += 1;
    }
    // `n >= 1`. The mean of i32 values always fits in i64.
    Some((min, max, i64::try_from(sum.div_euclid(n)).unwrap_or(0)))
}

fn stats_of(sim: &Sim, final_checksum: String) -> SeedStats {
    let world = sim.world();
    let count = |reason| {
        world
            .rejections()
            .count_by_reason
            .get(&reason)
            .copied()
            .unwrap_or(0)
    };
    let values = summarize(world.entities().values().map(|e| e.value));
    SeedStats {
        final_checksum,
        entities: world.entities().len(),
        rejections: [
            count(RejectReason::UnknownEntity),
            count(RejectReason::ValueOutOfRange),
            count(RejectReason::IdExhausted),
        ],
        values,
    }
}

/// Runs one seed. `check` is the per-tick invariant check; `batch` passes
/// `World::check_invariants`, tests pass a closure that can fail on demand.
fn run_seed(
    seed: u64,
    config: WorldConfig,
    ticks: u64,
    random_inputs: u64,
    check: &dyn Fn(&World) -> Result<(), InvariantViolation>,
) -> SeedOutcome {
    let inputs = generate_inputs(seed, random_inputs, ticks, u64::from(config.entity_count));

    let mut sim = match Sim::new(seed, config) {
        Ok(sim) => sim,
        Err(e) => return SeedOutcome::Setup(e.to_string()),
    };
    for &(tick, payload) in &inputs {
        if let Err(e) = sim.submit(tick, payload) {
            return SeedOutcome::Setup(format!("input refused: {e}"));
        }
    }
    if let Err(violation) = check(sim.world()) {
        return SeedOutcome::Invariant { tick: 0, violation };
    }
    for _ in 0..ticks {
        sim.step();
        if let Err(violation) = check(sim.world()) {
            return SeedOutcome::Invariant {
                tick: sim.world().tick().0,
                violation,
            };
        }
    }

    let file = match core_record(seed, config, &inputs, ticks) {
        Ok(file) => file,
        Err(e) => return SeedOutcome::Divergence(format!("record failed: {e}")),
    };
    match verify(&file) {
        Ok(()) => {}
        Err(e @ ReplayError::Diverged(_)) => return SeedOutcome::Divergence(e.to_string()),
        Err(e) => return SeedOutcome::Divergence(format!("verify failed: {e}")),
    }
    // The stepped run and the recorded run must agree on every tick.
    let stepped = sim.checksums();
    if stepped != file.checksums.as_slice() {
        let first = stepped
            .iter()
            .zip(&file.checksums)
            .position(|(a, b)| a != b)
            .unwrap_or_else(|| stepped.len().min(file.checksums.len()));
        return SeedOutcome::Divergence(format!(
            "stepped run and recorded run disagree at tick {first}"
        ));
    }
    match stepped.last() {
        Some(last) => SeedOutcome::Ok(stats_of(&sim, last.to_hex_string())),
        None => SeedOutcome::Setup("no ticks were run".to_owned()),
    }
}

/// Runs seeds `first..=last` in ascending order and writes the report. Returns the exit
/// code: 1 if any seed failed, else 0.
fn run_batch(
    (first, last): (u64, u64),
    config: WorldConfig,
    ticks: u64,
    random_inputs: u64,
    check: &dyn Fn(&World) -> Result<(), InvariantViolation>,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> i32 {
    let (mut total, mut ok) = (0u64, 0u64);
    for seed in first..=last {
        total += 1;
        let line = match run_seed(seed, config, ticks, random_inputs, check) {
            SeedOutcome::Ok(s) => {
                ok += 1;
                let [unknown, range, exhausted] = s.rejections;
                let (min, max, mean) = match s.values {
                    Some((min, max, mean)) => (min.to_string(), max.to_string(), mean.to_string()),
                    None => ("-".to_owned(), "-".to_owned(), "-".to_owned()),
                };
                let _ = writeln!(
                    out,
                    "seed {seed} ok ticks={ticks} final={} entities={} \
rejections=unknown_entity:{unknown},value_out_of_range:{range},id_exhausted:{exhausted} \
value_min={min} value_max={max} value_mean={mean}",
                    s.final_checksum, s.entities
                );
                continue;
            }
            SeedOutcome::Invariant { tick, violation } => {
                format!("seed {seed} FAIL tick={tick} invariant: {violation:?}")
            }
            SeedOutcome::Divergence(msg) => format!("seed {seed} FAIL divergence: {msg}"),
            SeedOutcome::Setup(msg) => format!("seed {seed} FAIL setup: {msg}"),
        };
        let _ = writeln!(out, "{line}");
        let _ = writeln!(err, "{line}");
    }
    let _ = writeln!(out, "batch: {ok}/{total} seeds ok");
    if ok == total {
        EXIT_OK
    } else {
        let _ = writeln!(err, "batch: {} of {total} seeds FAILED", total - ok);
        EXIT_FAILED
    }
}

pub fn batch(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse(args, &["seeds", "ticks", "random-inputs", "config"]) {
        Ok(p) => p,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{BATCH_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    match setup(&parsed) {
        Ok((range, config, ticks, random_inputs)) => run_batch(
            range,
            config,
            ticks,
            random_inputs,
            &World::check_invariants,
            out,
            err,
        ),
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{BATCH_USAGE}");
            EXIT_USAGE_OR_MALFORMED
        }
    }
}

type BatchSetup = ((u64, u64), WorldConfig, u64, u64);

fn setup(parsed: &args::Parsed) -> Result<BatchSetup, String> {
    if let Some(stray) = parsed.positionals().first() {
        return Err(format!("unexpected argument {stray:?}"));
    }
    let seeds = parsed
        .get("seeds")
        .ok_or_else(|| "missing required flag --seeds".to_owned())?;
    let range = parse_seed_range(seeds).map_err(|e| format!("--seeds: {e}"))?;
    let ticks = parsed.require_u64("ticks")?;
    if !(1..=MAX_TICKS).contains(&ticks) {
        return Err(format!(
            "--ticks must be between 1 and {MAX_TICKS}, got {ticks}"
        ));
    }
    let random_inputs = parsed
        .get_u64("random-inputs")?
        .unwrap_or(DEFAULT_RANDOM_INPUTS);
    if random_inputs > MAX_RANDOM_INPUTS {
        return Err(format!(
            "--random-inputs must be at most {MAX_RANDOM_INPUTS}, got {random_inputs}"
        ));
    }
    let config = match parsed.get("config") {
        Some(path) => load_config(path)?,
        None => default_config(),
    };
    Ok((range, config, ticks, random_inputs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim_core::ids::EntityId;

    #[test]
    fn seed_ranges_parse() {
        assert_eq!(parse_seed_range("1..=20"), Ok((1, 20)));
        assert_eq!(parse_seed_range("7"), Ok((7, 7)));
        assert_eq!(parse_seed_range("5..=5"), Ok((5, 5)));
        assert_eq!(parse_seed_range("0..=9999"), Ok((0, 9999)));
        let top = u64::MAX;
        assert_eq!(
            parse_seed_range(&format!("{}..={top}", top - 1)),
            Ok((top - 1, top))
        );
    }

    #[test]
    fn bad_seed_ranges_are_rejected() {
        for bad in [
            "",
            "..=",
            "1..=",
            "..=5",
            "5..=1",
            "1..5",
            "1...5",
            "a..=b",
            "-1..=5",
            "1..=-5",
            "1..=2..=3",
            " 1..=2",
            "0..=10000",
            "1..=99999999999999999999",
        ] {
            assert!(parse_seed_range(bad).is_err(), "{bad:?}");
        }
        assert!(parse_seed_range("0..=18446744073709551615").is_err());
    }

    fn small_config() -> WorldConfig {
        WorldConfig::try_new(8, 1, sim_core::world::Workload::Pairwise).unwrap()
    }

    fn run(
        range: (u64, u64),
        check: &dyn Fn(&World) -> Result<(), InvariantViolation>,
    ) -> (i32, String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run_batch(range, small_config(), 30, 20, check, &mut out, &mut err);
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn healthy_batch_exits_zero_with_one_line_per_seed() {
        let (code, out, err) = run((1, 3), &World::check_invariants);
        assert_eq!(code, 0, "{err}");
        assert!(err.is_empty(), "{err}");
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 4, "{out}");
        for (line, seed) in lines.iter().zip(1..=3) {
            assert!(
                line.starts_with(&format!("seed {seed} ok ticks=30 final=")),
                "{line}"
            );
            assert!(line.contains(" entities="), "{line}");
            assert!(line.contains(" rejections=unknown_entity:"), "{line}");
            assert!(line.contains(" value_mean="), "{line}");
        }
        assert_eq!(lines[3], "batch: 3/3 seeds ok");
    }

    #[test]
    fn a_failing_seed_is_reported_and_the_rest_still_run() {
        // Fail seed 2 only, once it has run 5 ticks (the seed is read from the world).
        let broken = |w: &World| {
            if w.seed() == 2 && w.tick().0 == 5 {
                Err(InvariantViolation::ValueOutOfRange {
                    entity: EntityId(3),
                    value: 1001,
                })
            } else {
                w.check_invariants()
            }
        };
        let (code, out, err) = run((1, 3), &broken);
        assert_eq!(code, 1);
        let lines: Vec<&str> = out.lines().collect();
        assert!(lines[0].starts_with("seed 1 ok"), "{out}");
        assert_eq!(
            lines[1],
            "seed 2 FAIL tick=5 invariant: ValueOutOfRange { entity: EntityId(3), value: 1001 }"
        );
        assert!(lines[2].starts_with("seed 3 ok"), "{out}");
        assert_eq!(lines[3], "batch: 2/3 seeds ok");
        assert!(err.contains("seed 2 FAIL tick=5 invariant:"), "{err}");
    }

    #[test]
    fn a_violation_in_the_initial_world_is_reported_at_tick_zero() {
        let broken = |w: &World| {
            if w.tick().0 == 0 {
                Err(InvariantViolation::SelfAffinity {
                    entity: EntityId(0),
                })
            } else {
                Ok(())
            }
        };
        let (code, out, _) = run((9, 9), &broken);
        assert_eq!(code, 1);
        assert!(out.starts_with("seed 9 FAIL tick=0 invariant: SelfAffinity"));
    }

    #[test]
    fn output_is_identical_across_runs() {
        let a = run((4, 6), &World::check_invariants);
        let b = run((4, 6), &World::check_invariants);
        assert_eq!(a, b);
    }

    #[test]
    fn an_empty_world_prints_dashes_for_the_value_statistics() {
        let config = WorldConfig::try_new(0, 1, sim_core::world::Workload::Light).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run_batch(
            (1, 1),
            config,
            10,
            0,
            &World::check_invariants,
            &mut out,
            &mut err,
        );
        assert_eq!(code, 0);
        let out = String::from_utf8(out).unwrap();
        assert!(
            out.contains("entities=0 ") && out.contains("value_min=- value_max=- value_mean=-"),
            "{out}"
        );
    }

    #[test]
    fn summary_statistics_round_the_mean_down() {
        assert_eq!(summarize(std::iter::empty()), None);
        assert_eq!(summarize([7].into_iter()), Some((7, 7, 7)));
        assert_eq!(summarize([1, 0, 0].into_iter()), Some((0, 1, 0)));
        assert_eq!(summarize([1, 1, 0].into_iter()), Some((0, 1, 0)));
        assert_eq!(summarize([10, 0, 5, 6].into_iter()), Some((0, 10, 5)));
        // Rounds toward negative infinity (never reached with valid worlds).
        assert_eq!(summarize([-1, 0].into_iter()), Some((-1, 0, -1)));
    }
}
