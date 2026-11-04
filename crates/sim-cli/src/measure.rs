//! `sim-cli measure`: tick performance benchmark (R10), native side.
//!
//! One tick is one day. It times one full 80-year lifetime (29,200 ticks)
//! on a fresh `Sim` with the `Pairwise` workload and no inputs, `--runs` times, and times
//! `Checksum::of(world)` separately on a representative state. The numbers depend on the
//! machine and the build profile, so tests only check structure, never values.
//!
//! Definitions (also printed in the output header):
//! - `lifetime best` / `median`: wall time of the whole tick loop, best and median of the
//!   runs (median of an even count is the mean of the two middle runs).
//! - `ticks/s`: lifetime ticks divided by the best lifetime time.
//! - `checksum ns/call`: best over the runs of (time of 2,000 `Checksum::of` calls / 2,000)
//!   on the world after 100 ticks. `World::step` already includes the checksum, so
//!   `checksum share = checksum ns/call / (best lifetime ns / lifetime ticks)`.
//! - `state bytes`: length of the canonical encoding of that same world.

use std::hint::black_box;
use std::io::Write;
use std::time::{Duration, Instant};

use sim_core::canon::encode_to_vec;
use sim_core::checksum::Checksum;
use sim_core::tick::Sim;
use sim_core::world::{ENTITY_COUNT_MAX, Workload, WorldConfig};

use crate::args;
use crate::commands::{EXIT_OK, EXIT_USAGE_OR_MALFORMED};

/// Seed used for every measured run.
pub const MEASURE_SEED: u64 = 1;
/// Years in one measured lifetime.
pub const LIFETIME_YEARS: u64 = 80;
/// Ticks per in-game year: one tick is one day.
pub const TICKS_PER_YEAR: u64 = 365;
/// Ticks run before the checksum is timed, so affinities are populated.
pub const WARMUP_TICKS: u32 = 100;
/// `Checksum::of` calls per timing sample.
pub const CHECKSUM_ITERATIONS: u32 = 2_000;
pub const DEFAULT_RUNS: u64 = 5;
pub const DEFAULT_ENTITIES: u64 = 60;
pub const MAX_RUNS: u64 = 50;

pub const MEASURE_USAGE: &str = "usage: sim-cli measure [--runs N] [--entities N]\n\
defaults: --runs 5 (1..=50), --entities 60 (0..=200)";

/// Timings for the daily lifetime.
#[derive(Debug)]
struct Row {
    lifetime_ticks: u64,
    best: Duration,
    median: Duration,
    checksum_ns: f64,
    state_bytes: usize,
}

pub fn measure(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse(args, &["runs", "entities"]).and_then(|p| {
        if p.positionals().is_empty() {
            Ok(p)
        } else {
            Err("measure takes no positional arguments".to_owned())
        }
    }) {
        Ok(p) => p,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{MEASURE_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    let runs = parsed.get_u64("runs").map(|v| v.unwrap_or(DEFAULT_RUNS));
    let entities = parsed
        .get_u64("entities")
        .map(|v| v.unwrap_or(DEFAULT_ENTITIES));
    let (runs, entities) = match (runs, entities) {
        (Ok(r), Ok(e)) if (1..=MAX_RUNS).contains(&r) && e <= u64::from(ENTITY_COUNT_MAX) => (r, e),
        (Ok(r), Ok(e)) => {
            let _ = writeln!(
                err,
                "error: --runs must be 1..={MAX_RUNS} (got {r}) and --entities 0..={ENTITY_COUNT_MAX} (got {e})\n{MEASURE_USAGE}"
            );
            return EXIT_USAGE_OR_MALFORMED;
        }
        (Err(e), _) | (_, Err(e)) => {
            let _ = writeln!(err, "error: {e}\n{MEASURE_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    // Both values were range-checked above, so these conversions cannot fail.
    let (Ok(runs), Ok(entities)) = (usize::try_from(runs), u16::try_from(entities)) else {
        return EXIT_USAGE_OR_MALFORMED;
    };

    let row = match measure_one(entities, runs) {
        Ok(row) => row,
        Err(e) => {
            let _ = writeln!(err, "error: {e}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    let build = if cfg!(debug_assertions) {
        "debug (numbers are NOT meaningful)"
    } else {
        "release"
    };
    let _ = write_report(out, build, entities, runs, &row);
    EXIT_OK
}

fn measure_one(entities: u16, runs: usize) -> Result<Row, String> {
    let config = WorldConfig::try_new(entities, Workload::Pairwise).map_err(|e| e.to_string())?;
    let lifetime_ticks = LIFETIME_YEARS * TICKS_PER_YEAR;

    let mut samples = Vec::with_capacity(runs);
    for _ in 0..runs {
        let mut sim = Sim::new(MEASURE_SEED, config).map_err(|e| e.to_string())?;
        let start = Instant::now();
        let mut last = Checksum(0);
        for _ in 0..lifetime_ticks {
            last = sim.step();
        }
        black_box(last);
        samples.push(start.elapsed());
        black_box(&sim);
    }
    let (best, median) = best_and_median(&samples);

    let mut sim = Sim::new(MEASURE_SEED, config).map_err(|e| e.to_string())?;
    for _ in 0..WARMUP_TICKS {
        sim.step();
    }
    let world = sim.world();
    let state_bytes = encode_to_vec(world).len();
    let mut best_checksum = Duration::MAX;
    for _ in 0..runs {
        let start = Instant::now();
        for _ in 0..CHECKSUM_ITERATIONS {
            black_box(Checksum::of(black_box(world)));
        }
        best_checksum = best_checksum.min(start.elapsed());
    }
    let checksum_ns = best_checksum.as_secs_f64() * 1e9 / f64::from(CHECKSUM_ITERATIONS);
    Ok(Row {
        lifetime_ticks,
        best,
        median,
        checksum_ns,
        state_bytes,
    })
}

/// Best (minimum) and median of a non-empty sample; the median of an even count is the
/// mean of the two middle values.
fn best_and_median(samples: &[Duration]) -> (Duration, Duration) {
    let mut sorted = samples.to_vec();
    sorted.sort();
    let best = sorted.first().copied().unwrap_or_default();
    let n = sorted.len();
    let median = if n == 0 {
        Duration::ZERO
    } else if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    };
    (best, median)
}

fn write_report(
    out: &mut dyn Write,
    build: &str,
    entities: u16,
    runs: usize,
    row: &Row,
) -> std::io::Result<()> {
    writeln!(out, "sim-cli measure (native) build={build}")?;
    writeln!(
        out,
        "params: seed={MEASURE_SEED} entities={entities} workload=Pairwise runs={runs} \
         checksum_iterations={CHECKSUM_ITERATIONS} checksum_state_after_ticks={WARMUP_TICKS}"
    )?;
    writeln!(
        out,
        "lifetime: 80 years = 80 x 365 = 29200 daily ticks; no inputs; fresh Sim per run"
    )?;
    writeln!(
        out,
        "definitions: best/median over runs; ticks/s = lifetime ticks / best lifetime;"
    )?;
    writeln!(
        out,
        "  checksum share = checksum ns per call / (best lifetime ns / lifetime ticks)"
    )?;
    writeln!(out)?;
    writeln!(out, "{:<28}{:>16}", "metric", "daily (1d)")?;
    let table: [(&str, String); 7] = [
        ("lifetime_ticks", row.lifetime_ticks.to_string()),
        ("ticks_per_second", format!("{:.0}", ticks_per_second(row))),
        (
            "lifetime_best_ms",
            format!("{:.2}", row.best.as_secs_f64() * 1e3),
        ),
        (
            "lifetime_median_ms",
            format!("{:.2}", row.median.as_secs_f64() * 1e3),
        ),
        ("checksum_ns_per_call", format!("{:.0}", row.checksum_ns)),
        (
            "checksum_share_percent",
            format!("{:.1}", checksum_share(row) * 100.0),
        ),
        ("canonical_state_bytes", row.state_bytes.to_string()),
    ];
    for (label, value) in table {
        writeln!(out, "{label:<28}{value:>16}")?;
    }
    Ok(())
}

fn ticks_per_second(r: &Row) -> f64 {
    r.lifetime_ticks as f64 / r.best.as_secs_f64().max(f64::MIN_POSITIVE)
}

fn checksum_share(r: &Row) -> f64 {
    let tick_ns = r.best.as_secs_f64() * 1e9 / (r.lifetime_ticks.max(1) as f64);
    if tick_ns > 0.0 {
        r.checksum_ns / tick_ns
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    fn run(items: &[&str]) -> (i32, String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = measure(&v(items), &mut out, &mut err);
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn tiny_run_prints_every_labelled_row() {
        let (code, out, err) = run(&["--runs", "1", "--entities", "3"]);
        assert_eq!(code, 0, "{err}");
        assert!(out.contains("build="), "{out}");
        assert!(
            out.contains("seed=1 entities=3 workload=Pairwise runs=1"),
            "{out}"
        );
        for label in [
            "lifetime_ticks",
            "ticks_per_second",
            "lifetime_best_ms",
            "lifetime_median_ms",
            "checksum_ns_per_call",
            "checksum_share_percent",
            "canonical_state_bytes",
        ] {
            assert!(out.lines().any(|l| l.starts_with(label)), "{label}: {out}");
        }
        let ticks = out
            .lines()
            .find(|l| l.starts_with("lifetime_ticks"))
            .unwrap();
        assert!(
            ticks.contains("29200") && !ticks.contains("4160"),
            "{ticks}"
        );
        assert!(err.is_empty());
    }

    #[test]
    fn bad_usage_exits_2() {
        for bad in [
            &["--runs", "0"][..],
            &["--runs", "51"],
            &["--entities", "201"],
            &["--runs", "x"],
            &["--entities=-1"],
            &["--seed", "1"],
            &["stray"],
            &["--runs"],
        ] {
            let (code, out, err) = run(bad);
            assert_eq!(code, 2, "{bad:?}");
            assert!(out.is_empty(), "{bad:?}");
            assert!(err.starts_with("error:"), "{bad:?}: {err}");
        }
    }

    #[test]
    fn zero_entities_is_accepted() {
        let (code, _, err) = run(&["--runs", "1", "--entities", "0"]);
        assert_eq!(code, 0, "{err}");
    }

    #[test]
    fn median_of_odd_and_even_samples() {
        let ms = Duration::from_millis;
        assert_eq!(best_and_median(&[ms(5), ms(1), ms(3)]), (ms(1), ms(3)));
        assert_eq!(best_and_median(&[ms(4), ms(2)]), (ms(2), ms(3)));
        assert_eq!(best_and_median(&[]), (Duration::ZERO, Duration::ZERO));
    }
}
