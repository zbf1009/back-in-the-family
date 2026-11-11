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
//! seed 3 ok ticks=29200 final=<hex> residents_min=46 residents_max=52 band_40_60_ticks=29200 queue_final=1 max_wait_npc=1095 max_wait_player=0 births=51 deaths=52 imported=3 rebuilt=1 origin_final=native:46,possessed:3,rebuilt:1 arrivals=native:51,possessed:3,rebuilt:1 events=14212 relations_max=4410 rejections=unknown_person:9,dead_person:4,self_target:3,intensity_out_of_range:7,id_exhausted:0 invariants=pass pop_35_65=pass band_95=pass outsiders_le_births=pass outsiders_le_births_third=pass
//! seed 4 FAIL tick=812 criterion=9.1 detail: soul S-0012 is in body 31 and waiting
//! seed 5 FAIL targets: band_95=fail
//! ```
//!
//! then `batch: <ok>/<total> seeds ok`.
//!
//! * `final` is the checksum of the last tick; `invariants=pass` means the
//!   [`InvariantChecker`] accepted the Opening_World and every tick (a failure is a
//!   `FAIL` line instead, R17.7).
//! * `max_wait_*` is the longest wait observed at the end of any tick; `queue_final` is
//!   the number of waiting Souls at the end. `relations_max` is the largest Relation
//!   count at the end of any tick (a measurement, not a target).
//! * `band_40_60_ticks` counts ticks whose Resident count is in `40..=60`; `band_95` is
//!   `band_40_60_ticks * 100 >= ticks * 95` (R17.9).
//! * `pop_35_65` is R17.1 and `outsiders_le_births` is R17.8.
//!   `outsiders_le_births_third` is the tighter arrival ratio the calibration adopted
//!   (design "Parameters and calibration", step 5): outsider arrivals at most a third of
//!   native births, as `3 * arrivals <= births`. Without
//!   `--require-targets` a failing target prints `=fail` but the seed stays `ok`; with
//!   it, the seed FAILs and the exit status is 1. A failed invariant or a failed
//!   record/verify always FAILs the seed and the exit status is 1.
//! * `FAIL tick=<t>`: `t` is the tick of the checked state, so `0` means the freshly
//!   built world before any tick and `t` means after `t` ticks have run.
//!
//! Every seed is processed even after failures; each failure is also written to stderr.

use std::io::Write;

use sim_core::checksum::Checksum;
use sim_core::events::EventKind;
use sim_core::ids::Tick;
use sim_core::invariants::{InvariantChecker, Violation};
use sim_core::replay::{
    REPLAY_FORMAT, REPLAY_VERSION, ReplayConfig, ReplayError, ReplayFile, ReplayInput,
    ReplayPayload, verify,
};
use sim_core::tick::Sim;
use sim_core::values::Origin;
use sim_core::world::{Life, RejectReason, SoulPlace, World, WorldConfig};

use crate::args::{self, Parsed};
use crate::commands::{
    EXIT_FAILED, EXIT_OK, EXIT_USAGE_OR_MALFORMED, MAX_RANDOM_INPUTS, MAX_TICKS, default_config,
    load_config,
};
use crate::inputs::generate_inputs;

/// Largest number of seeds one `batch` run accepts.
pub const MAX_SEEDS: u64 = 10_000;
/// `--random-inputs` default for `batch`.
pub const DEFAULT_RANDOM_INPUTS: u64 = 60;
/// Smallest and largest tick count the R17.9 band target accepts (R17.1).
const POP_MIN: u64 = 35;
const POP_MAX: u64 = 65;
/// Resident-count band of R17.9.
const BAND_MIN: u64 = 40;
const BAND_MAX: u64 = 60;

pub const BATCH_USAGE: &str = "usage: sim-cli batch --seeds A..=B --ticks N \
[--random-inputs K] [--config FILE] [--require-targets]\n\
--seeds is an inclusive range (or a single seed A), at most 10000 seeds; \
--random-inputs defaults to 60; without --config: {\"opening_residents\":50}; \
--require-targets fails a seed whose R17.1, R17.8, R17.9 or calibrated arrival-ratio \
target does not pass";

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

/// The three target criteria of R17.1, R17.8 and R17.9 plus the tighter arrival ratio
/// that the calibration adopted (design "Parameters and calibration", step 5): outsider
/// arrivals at most a third of native births.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Targets {
    pop_35_65: bool,
    band_95: bool,
    outsiders_le_births: bool,
    outsiders_le_births_third: bool,
}

impl Targets {
    /// The failing target names, in report order.
    fn failing(&self) -> Vec<&'static str> {
        let mut failing = Vec::new();
        if !self.pop_35_65 {
            failing.push("pop_35_65");
        }
        if !self.band_95 {
            failing.push("band_95");
        }
        if !self.outsiders_le_births {
            failing.push("outsiders_le_births");
        }
        if !self.outsiders_le_births_third {
            failing.push("outsiders_le_births_third");
        }
        failing
    }

    fn pass(&self) -> bool {
        self.failing().is_empty()
    }

    fn label(value: bool) -> &'static str {
        if value { "pass" } else { "fail" }
    }
}

/// What a successful seed reports, in report order.
#[derive(Debug, Eq, PartialEq)]
struct SeedStats {
    final_checksum: String,
    residents_min: u64,
    residents_max: u64,
    band_40_60_ticks: u64,
    queue_final: u64,
    max_wait_npc: u64,
    max_wait_player: u64,
    births: u64,
    deaths: u64,
    imported: u64,
    rebuilt: u64,
    origin_final: [u64; 3],
    arrivals: [u64; 3],
    events: u64,
    relations_max: u64,
    rejections: [u64; 5],
    targets: Targets,
}

#[derive(Debug, Eq, PartialEq)]
enum SeedOutcome {
    Ok(SeedStats),
    Targets { failing: Vec<&'static str> },
    Invariant { tick: u64, violation: Violation },
    Divergence(String),
    Setup(String),
}

/// Statistics collected after every tick.
struct Tally {
    residents_min: u64,
    residents_max: u64,
    band_40_60_ticks: u64,
    max_wait_npc: u64,
    max_wait_player: u64,
    relations_max: u64,
    pop_ok: bool,
}

impl Tally {
    fn new(world: &World) -> Self {
        let residents = resident_count(world);
        Self {
            residents_min: u64::MAX,
            residents_max: 0,
            band_40_60_ticks: 0,
            max_wait_npc: 0,
            max_wait_player: 0,
            relations_max: 0,
            pop_ok: (POP_MIN..=POP_MAX).contains(&residents),
        }
    }

    fn after_tick(&mut self, world: &World) {
        let residents = resident_count(world);
        self.residents_min = self.residents_min.min(residents);
        self.residents_max = self.residents_max.max(residents);
        if (BAND_MIN..=BAND_MAX).contains(&residents) {
            self.band_40_60_ticks += 1;
        }
        if !(POP_MIN..=POP_MAX).contains(&residents) {
            self.pop_ok = false;
        }
        self.relations_max = self.relations_max.max(world.relations().len() as u64);
        let tick = world.tick().0;
        for (&soul, place) in &world.souls().places {
            if let SoulPlace::Waiting { since } = place {
                let wait = tick.saturating_sub(since.0);
                if soul == world.souls().player {
                    self.max_wait_player = self.max_wait_player.max(wait);
                } else {
                    self.max_wait_npc = self.max_wait_npc.max(wait);
                }
            }
        }
    }
}

fn resident_count(world: &World) -> u64 {
    world
        .persons()
        .values()
        .filter(|p| matches!(p.life, Life::Alive { .. }))
        .count() as u64
}

fn count_of(world: &World, reason: RejectReason) -> u64 {
    world
        .rejections()
        .count_by_reason
        .get(&reason)
        .copied()
        .unwrap_or(0)
}

/// Counts Persons by Origin since World creation. Opening Persons are all `native`, so
/// `possessed` and `rebuilt` count outsider arrivals; native arrivals are the births.
fn arrivals_by_origin(world: &World) -> [u64; 3] {
    let mut counts = [0u64; 3];
    for person in world.persons().values() {
        let slot = match person.origin {
            Origin::Native => 0,
            Origin::Possessed => 1,
            Origin::Rebuilt => 2,
        };
        counts[slot] += 1;
    }
    counts
}

/// Living Residents by Origin, at the end of the run.
fn origin_final(world: &World) -> [u64; 3] {
    let mut counts = [0u64; 3];
    for person in world.persons().values() {
        if matches!(person.life, Life::Alive { .. }) {
            let slot = match person.origin {
                Origin::Native => 0,
                Origin::Possessed => 1,
                Origin::Rebuilt => 2,
            };
            counts[slot] += 1;
        }
    }
    counts
}

fn event_count(world: &World, want: &dyn Fn(&EventKind) -> bool) -> u64 {
    world
        .log()
        .events()
        .iter()
        .filter(|event| want(&event.kind))
        .count() as u64
}

fn stats_of(world: &World, ticks: u64, tally: &Tally, final_checksum: String) -> SeedStats {
    let births = event_count(world, &|kind| matches!(kind, EventKind::Birth { .. }));
    let deaths = event_count(world, &|kind| matches!(kind, EventKind::Death { .. }));
    let origin_final = origin_final(world);
    let mut arrivals = arrivals_by_origin(world);
    // Opening Persons are all native and were not arrivals; native arrivals are births.
    arrivals[0] = births;
    let imported = arrivals[1];
    let rebuilt = arrivals[2];
    let band_95 = tally.band_40_60_ticks.saturating_mul(100) >= ticks.saturating_mul(95);
    let targets = Targets {
        pop_35_65: tally.pop_ok,
        band_95,
        outsiders_le_births: imported + rebuilt <= births,
        // The calibrated tighter ratio: outsider arrivals <= births / 3, in integer
        // arithmetic (3 x arrivals <= births).
        outsiders_le_births_third: (imported + rebuilt).saturating_mul(3) <= births,
    };
    SeedStats {
        final_checksum,
        residents_min: tally.residents_min.min(tally.residents_max),
        residents_max: tally.residents_max,
        band_40_60_ticks: tally.band_40_60_ticks,
        queue_final: world
            .souls()
            .places
            .values()
            .filter(|place| matches!(place, SoulPlace::Waiting { .. }))
            .count() as u64,
        max_wait_npc: tally.max_wait_npc,
        max_wait_player: tally.max_wait_player,
        births,
        deaths,
        imported,
        rebuilt,
        origin_final,
        arrivals,
        events: world.log().len() as u64,
        relations_max: tally.relations_max,
        rejections: [
            count_of(world, RejectReason::UnknownPerson),
            count_of(world, RejectReason::DeadPerson),
            count_of(world, RejectReason::SelfTarget),
            count_of(world, RejectReason::IntensityOutOfRange),
            count_of(world, RejectReason::IdExhausted),
        ],
        targets,
    }
}

/// The exact `ok` line of the design.
fn ok_line(seed: u64, ticks: u64, s: &SeedStats) -> String {
    format!(
        "seed {seed} ok ticks={ticks} final={} residents_min={} residents_max={} \
band_40_60_ticks={} queue_final={} max_wait_npc={} max_wait_player={} births={} deaths={} \
imported={} rebuilt={} origin_final=native:{},possessed:{},rebuilt:{} \
arrivals=native:{},possessed:{},rebuilt:{} events={} relations_max={} \
rejections=unknown_person:{},dead_person:{},self_target:{},intensity_out_of_range:{},\
id_exhausted:{} invariants=pass pop_35_65={} band_95={} outsiders_le_births={} \
outsiders_le_births_third={}",
        s.final_checksum,
        s.residents_min,
        s.residents_max,
        s.band_40_60_ticks,
        s.queue_final,
        s.max_wait_npc,
        s.max_wait_player,
        s.births,
        s.deaths,
        s.imported,
        s.rebuilt,
        s.origin_final[0],
        s.origin_final[1],
        s.origin_final[2],
        s.arrivals[0],
        s.arrivals[1],
        s.arrivals[2],
        s.events,
        s.relations_max,
        s.rejections[0],
        s.rejections[1],
        s.rejections[2],
        s.rejections[3],
        s.rejections[4],
        Targets::label(s.targets.pop_35_65),
        Targets::label(s.targets.band_95),
        Targets::label(s.targets.outsiders_le_births),
        Targets::label(s.targets.outsiders_le_births_third),
    )
}

/// The `FAIL targets:` line: `name=fail` entries in report order.
fn targets_line(seed: u64, failing: &[&'static str]) -> String {
    let entries: Vec<String> = failing.iter().map(|name| format!("{name}=fail")).collect();
    format!("seed {seed} FAIL targets: {}", entries.join(","))
}

/// Builds the replay for the stepped run: its own checksums, its inputs in submission
/// order (so `seq` equals the index).
fn replay_of(
    seed: u64,
    config: WorldConfig,
    ticks: u64,
    inputs: &[(Tick, sim_core::input::InputPayload)],
    checksums: &[Checksum],
) -> ReplayFile {
    ReplayFile {
        format: REPLAY_FORMAT.to_owned(),
        version: REPLAY_VERSION,
        seed,
        config: ReplayConfig::from(config),
        ticks,
        inputs: inputs
            .iter()
            .enumerate()
            .map(|(seq, &(tick, payload))| ReplayInput {
                tick: tick.0,
                seq: seq as u64,
                payload: ReplayPayload::from(payload),
            })
            .collect(),
        checksums: checksums.to_vec(),
    }
}

/// Runs one seed. `check` runs after every tick on top of the built-in
/// [`InvariantChecker`]; `batch` passes a closure that never fails, tests pass one that
/// can fail on demand.
fn run_seed(
    seed: u64,
    config: WorldConfig,
    ticks: u64,
    random_inputs: u64,
    require_targets: bool,
    check: &dyn Fn(&World) -> Result<(), Violation>,
) -> SeedOutcome {
    let inputs = generate_inputs(
        seed,
        random_inputs,
        ticks,
        u64::from(config.opening_residents),
    );

    let mut sim = match Sim::new(seed, config) {
        Ok(sim) => sim,
        Err(e) => return SeedOutcome::Setup(e.to_string()),
    };
    let mut checker = match InvariantChecker::new(sim.world()) {
        Ok(checker) => checker,
        Err(violation) => return SeedOutcome::Invariant { tick: 0, violation },
    };
    for &(tick, payload) in &inputs {
        if let Err(e) = sim.submit(tick, payload) {
            return SeedOutcome::Setup(format!("input refused: {e}"));
        }
    }
    let mut tally = Tally::new(sim.world());
    for _ in 0..ticks {
        sim.step();
        if let Err(violation) = checker.after_tick(sim.world()) {
            return SeedOutcome::Invariant {
                tick: violation.tick,
                violation,
            };
        }
        if let Err(violation) = check(sim.world()) {
            return SeedOutcome::Invariant {
                tick: violation.tick,
                violation,
            };
        }
        tally.after_tick(sim.world());
    }

    // The digest must equal a from-scratch recompute at the end of the run (OP-8 A).
    let log = sim.world().log();
    if log.digest() != log.recompute_digest() {
        return SeedOutcome::Divergence("Event_Log digest differs from a recompute".to_owned());
    }

    // The replay carries the stepped run's own checksums and is verified in process.
    // `inputs` is in submission order, which is the file's required order (`seq` equals
    // the index); `InputStream::all()` would be `(tick, seq)` order instead.
    let file = replay_of(seed, config, ticks, &inputs, sim.checksums());
    match verify(&file) {
        Ok(()) => {}
        Err(e @ ReplayError::Diverged(_)) => return SeedOutcome::Divergence(e.to_string()),
        Err(e) => return SeedOutcome::Divergence(format!("verify failed: {e}")),
    }

    let Some(last) = sim.checksums().last() else {
        return SeedOutcome::Setup("no ticks were run".to_owned());
    };
    let stats = stats_of(sim.world(), ticks, &tally, last.to_hex_string());
    if require_targets && !stats.targets.pass() {
        return SeedOutcome::Targets {
            failing: stats.targets.failing(),
        };
    }
    SeedOutcome::Ok(stats)
}

/// Runs seeds `first..=last` in ascending order and writes the report. Returns the exit
/// code: 1 if any seed failed, else 0.
#[allow(clippy::too_many_arguments)]
fn run_batch(
    (first, last): (u64, u64),
    config: WorldConfig,
    ticks: u64,
    random_inputs: u64,
    require_targets: bool,
    check: &dyn Fn(&World) -> Result<(), Violation>,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> i32 {
    let (mut total, mut ok) = (0u64, 0u64);
    for seed in first..=last {
        total += 1;
        let line = match run_seed(seed, config, ticks, random_inputs, require_targets, check) {
            SeedOutcome::Ok(stats) => {
                ok += 1;
                let _ = writeln!(out, "{}", ok_line(seed, ticks, &stats));
                continue;
            }
            SeedOutcome::Targets { failing } => targets_line(seed, &failing),
            SeedOutcome::Invariant { tick, violation } => format!(
                "seed {seed} FAIL tick={tick} criterion={} detail: {}",
                violation.criterion, violation.detail
            ),
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
    let parsed = match args::parse_with_switches(
        args,
        &["seeds", "ticks", "random-inputs", "config"],
        &["require-targets"],
    ) {
        Ok(p) => p,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{BATCH_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    match setup(&parsed) {
        Ok((range, config, ticks, random_inputs, require_targets)) => run_batch(
            range,
            config,
            ticks,
            random_inputs,
            require_targets,
            &|_| Ok(()),
            out,
            err,
        ),
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{BATCH_USAGE}");
            EXIT_USAGE_OR_MALFORMED
        }
    }
}

type BatchSetup = ((u64, u64), WorldConfig, u64, u64, bool);

fn setup(parsed: &Parsed) -> Result<BatchSetup, String> {
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
    Ok((
        range,
        config,
        ticks,
        random_inputs,
        parsed.get("require-targets").is_some(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        WorldConfig::try_new(40).unwrap()
    }

    fn run(
        range: (u64, u64),
        require_targets: bool,
        check: &dyn Fn(&World) -> Result<(), Violation>,
    ) -> (i32, String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run_batch(
            range,
            small_config(),
            30,
            20,
            require_targets,
            check,
            &mut out,
            &mut err,
        );
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn healthy_batch_exits_zero_with_one_line_per_seed() {
        let (code, out, err) = run((1, 2), false, &|_| Ok(()));
        assert_eq!(code, 0, "{err}");
        assert!(err.is_empty(), "{err}");
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 3, "{out}");
        for (line, seed) in lines.iter().zip(1..=2) {
            assert!(
                line.starts_with(&format!("seed {seed} ok ticks=30 final=")),
                "{line}"
            );
            assert!(line.contains(" residents_min="), "{line}");
            assert!(line.contains(" residents_max="), "{line}");
            assert!(line.contains(" band_40_60_ticks=30 "), "{line}");
            assert!(line.contains(" queue_final="), "{line}");
            assert!(line.contains(" max_wait_npc="), "{line}");
            assert!(line.contains(" max_wait_player="), "{line}");
            // Counts depend on the calibrated birth rate; the fields must be there.
            assert!(line.contains(" births="), "{line}");
            assert!(line.contains(" deaths="), "{line}");
            assert!(line.contains(" imported="), "{line}");
            assert!(line.contains(" rebuilt="), "{line}");
            assert!(line.contains(" origin_final=native:"), "{line}");
            assert!(line.contains(" arrivals=native:"), "{line}");
            assert!(line.contains(" events="), "{line}");
            assert!(line.contains(" relations_max="), "{line}");
            assert!(line.contains(" rejections=unknown_person:"), "{line}");
            assert!(line.contains(" invariants=pass "), "{line}");
            assert!(
                line.contains(
                    " pop_35_65=pass band_95=pass outsiders_le_births=pass \
outsiders_le_births_third=pass"
                ),
                "{line}"
            );
        }
        assert_eq!(lines[2], "batch: 2/2 seeds ok");
    }

    #[test]
    fn a_failing_seed_is_reported_and_the_rest_still_run() {
        // Fail seed 2 only, once the sixth tick has run (the seed is read from the world).
        let broken = |w: &World| {
            if w.seed() == 2 && w.tick().0 == 6 {
                Err(Violation {
                    criterion: "9.3",
                    tick: 5,
                    detail: "injected soul fault".to_owned(),
                })
            } else {
                Ok(())
            }
        };
        let (code, out, err) = run((1, 2), false, &broken);
        assert_eq!(code, 1);
        let lines: Vec<&str> = out.lines().collect();
        assert!(lines[0].starts_with("seed 1 ok"), "{out}");
        assert_eq!(
            lines[1],
            "seed 2 FAIL tick=5 criterion=9.3 detail: injected soul fault"
        );
        assert_eq!(lines[2], "batch: 1/2 seeds ok");
        assert!(err.contains("seed 2 FAIL"), "{err}");
    }

    #[test]
    fn a_violation_in_the_initial_world_is_reported_at_tick_zero() {
        let (code, out, _) = run((9, 9), false, &|_| {
            Err(Violation {
                criterion: "20.1",
                tick: 0,
                detail: "injected opening fault".to_owned(),
            })
        });
        assert_eq!(code, 1);
        // The Opening_World itself must be valid; the injected fault fires on tick 1.
        assert!(
            out.starts_with("seed 9 FAIL tick=0 criterion=20.1"),
            "{out}"
        );
    }

    #[test]
    fn output_is_identical_across_runs() {
        let a = run((4, 5), false, &|_| Ok(()));
        let b = run((4, 5), false, &|_| Ok(()));
        assert_eq!(a, b);
    }

    #[test]
    fn failing_targets_are_printed_in_report_order() {
        let targets = Targets {
            pop_35_65: false,
            band_95: false,
            outsiders_le_births: true,
            outsiders_le_births_third: true,
        };
        assert_eq!(targets.failing(), ["pop_35_65", "band_95"]);
        assert_eq!(
            targets_line(5, &targets.failing()),
            "seed 5 FAIL targets: pop_35_65=fail,band_95=fail"
        );
        let lone = Targets {
            pop_35_65: true,
            band_95: false,
            outsiders_le_births: true,
            outsiders_le_births_third: true,
        };
        assert_eq!(
            targets_line(5, &lone.failing()),
            "seed 5 FAIL targets: band_95=fail"
        );
    }

    #[test]
    fn every_report_field_is_parsed_from_a_healthy_line() {
        let (_, out, _) = run((1, 1), false, &|_| Ok(()));
        let line = out.lines().next().unwrap();
        let fields: Vec<&str> = line.split(' ').collect();
        let expected = [
            "seed",
            "1",
            "ok",
            "ticks=30",
            "final=",
            "residents_min=",
            "residents_max=",
            "band_40_60_ticks=",
            "queue_final=",
            "max_wait_npc=",
            "max_wait_player=",
            "births=",
            "deaths=",
            "imported=",
            "rebuilt=",
            "origin_final=",
            "arrivals=",
            "events=",
            "relations_max=",
            "rejections=",
            "invariants=pass",
            "pop_35_65=",
            "band_95=",
            "outsiders_le_births=",
            "outsiders_le_births_third=",
        ];
        assert_eq!(fields.len(), expected.len(), "{line}");
        for (field, prefix) in fields.iter().zip(expected) {
            assert!(
                field.starts_with(prefix),
                "{field} should start with {prefix}"
            );
        }
    }
}
