//! `sim-cli batch`: run many seeds with generated random inputs and the Auto_Player,
//! check the world invariants after every tick, and replay-verify each run.
//!
//! The output is a pure function of the arguments (no timestamps, no timing), so two runs
//! of the same command line print identical bytes.
//!
//! # Output
//!
//! One stdout line per seed, in ascending seed order, then the nine underworld totals
//! and the seed summary:
//!
//! ```text
//! seed 3 ok ticks=29200 final=<hex> residents_min=46 ... rejections=... offerings=412 dreams=2 hauntings=1 bribes=2 claims=birth:1,imported:0,rebuilt:1 auto_placed=0 carry_overs=2 nodes=dream_interpretation:external:1,rules:1;magistrate_ruling:external:0,rules:2 max_wait_player=730 player_lives=1:death=21450,age_days=27012,joss=388;2:alive invariants=pass pop_35_65=pass band_95=pass outsiders_le_births=pass outsiders_le_births_third=pass
//! seed 4 FAIL tick=812 criterion=9.1 detail: soul S-0012 is in body 31 and waiting
//! seed 5 FAIL targets: band_95=fail
//! batch: totals dreams=2 hauntings=1 bribes=2 birth_claims=1 imported_claims=0 rebuilt_claims=1 carry_overs=2 nodes_dream_interpretation=2 nodes_magistrate_ruling=2
//! batch: 1/3 seeds ok
//! ```
//!
//! * `offerings` counts both ordinary and Bribe offerings (both card type `offering`); applied
//!   claims and Carry_Over inputs come from `Sim::last_outcomes()` and Standing_Slot
//!   claims are cross-checked against the corresponding Player arrival Events.
//! * `final` is the checksum of the last tick; `invariants=pass` means the
//!   [`InvariantChecker`] accepted the Opening_World and every tick (a failure is a
//!   `FAIL` line instead, R17.7).
//! * `max_wait_*` is the longest wait observed at the completed tick (`world.tick() - 1`),
//!   including the tick a wait ends; `queue_final` is the waiting Souls at the end.
//!   `relations_max` is the largest Relation count at the end of any tick.
//! * `band_40_60_ticks` counts ticks whose Resident count is in `40..=60`; `band_95` is
//!   `band_40_60_ticks * 100 >= ticks * 95` (R17.9).
//! * `pop_35_65` is R17.1, `band_95` is R17.9 and `outsiders_le_births` is R17.8: the
//!   three hard targets. `outsiders_le_births_third` is the tighter arrival ratio the
//!   calibration adopted (design "Parameters and calibration", step 5): outsider
//!   arrivals at most a third of native births, as `3 * arrivals <= births`. It is
//!   reported only (`=pass` or `=fail`) and never fails a seed (design "Correction: the
//!   one-third arrival target", Author 2026-11-11, audit). Without `--require-targets`
//!   a failing target prints `=fail` but the seed stays `ok`; with it, a seed that
//!   misses a hard target FAILs and the exit status is 1. A failed invariant or a
//!   failed record/verify always FAILs the seed and the exit status is 1.
//! * `FAIL tick=<t>`: `t` is the tick of the checked state, so `0` means the freshly
//!   built world before any tick and `t` means after `t` ticks have run.
//!
//! Every seed is processed even after failures; each failure is also written to stderr.

use std::io::Write;

use crate::args::{self, Parsed};
use crate::commands::{
    EXIT_FAILED, EXIT_OK, EXIT_USAGE_OR_MALFORMED, MAX_RANDOM_INPUTS, MAX_TICKS, default_config,
    load_config,
};
use crate::inputs::generate_inputs;
use sim_core::checksum::Checksum;
use sim_core::events::EventKind;
use sim_core::ids::Tick;
use sim_core::input::{InputPayload, TickInput};
use sim_core::invariants::{InvariantChecker, Violation};
use sim_core::replay::{
    REPLAY_FORMAT, REPLAY_VERSION, ReplayConfig, ReplayError, ReplayFile, ReplayInput,
    ReplayPayload, verify,
};
use sim_core::tick::Sim;
use sim_core::underworld::nodes::{ChoiceSource, NodeFamily};
use sim_core::underworld::slots::SlotRef;
use sim_core::values::Origin;
use sim_core::world::{Life, RejectReason, SoulPlace, World, WorldConfig};

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
--require-targets fails a seed whose R17.1, R17.8 or R17.9 target does not pass; \
outsiders_le_births_third is reported only";

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

/// The three hard target criteria of R17.1, R17.8 and R17.9, which `--require-targets`
/// enforces, plus the tighter arrival ratio the calibration adopted (design "Parameters
/// and calibration", step 5), which is reported only (design "Correction: the one-third
/// arrival target", Author 2026-11-11, audit).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Targets {
    pop_35_65: bool,
    band_95: bool,
    outsiders_le_births: bool,
    outsiders_le_births_third: bool,
}

impl Targets {
    /// The failing hard target names, in report order, used by both [`Targets::pass`] and
    /// the `FAIL targets:` line. `outsiders_le_births_third` is deliberately outside this
    /// list: it is reported in the `ok` line but never enforced.
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
        failing
    }

    /// Whether `--require-targets` accepts the seed: true when no hard target fails.
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
    rejections: Vec<u64>,
    offerings: u64,
    dreams: u64,
    hauntings: u64,
    bribes: u64,
    claims: [u64; 3],
    auto_placed: u64,
    carry_overs: u64,
    nodes: [[u64; 2]; 2],
    player_lives: String,
    targets: Targets,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Totals {
    pub dreams: u64,
    pub hauntings: u64,
    pub bribes: u64,
    pub birth_claims: u64,
    pub imported_claims: u64,
    pub rebuilt_claims: u64,
    pub carry_overs: u64,
    pub nodes_dream_interpretation: u64,
    pub nodes_magistrate_ruling: u64,
}

impl Totals {
    fn add(&mut self, stats: &SeedStats) {
        self.dreams = self.dreams.saturating_add(stats.dreams);
        self.hauntings = self.hauntings.saturating_add(stats.hauntings);
        self.bribes = self.bribes.saturating_add(stats.bribes);
        self.birth_claims = self.birth_claims.saturating_add(stats.claims[0]);
        self.imported_claims = self.imported_claims.saturating_add(stats.claims[1]);
        self.rebuilt_claims = self.rebuilt_claims.saturating_add(stats.claims[2]);
        self.carry_overs = self.carry_overs.saturating_add(stats.carry_overs);
        self.nodes_dream_interpretation = self
            .nodes_dream_interpretation
            .saturating_add(stats.nodes[0][0].saturating_add(stats.nodes[0][1]));
        self.nodes_magistrate_ruling = self
            .nodes_magistrate_ruling
            .saturating_add(stats.nodes[1][0].saturating_add(stats.nodes[1][1]));
    }
}

/// The passive acceptance batch gates invariants and LS-R17 only, never underworld counts.
pub const PASSIVE_ZERO_COUNT_LIST: &[&str] = &[];

/// Applied underworld successes required across the Devoted acceptance seeds, in report order.
pub const DEVOTED_ZERO_COUNT_LIST: &[&str] = &[
    "dreams",
    "hauntings",
    "bribes",
    "imported_claims",
    "rebuilt_claims",
    "carry_overs",
    "nodes_dream_interpretation",
    "nodes_magistrate_ruling",
];

/// Return only zero applied counts named by the selected acceptance contract, in list order.
pub fn zero_count_failures(t: &Totals, list: &[&'static str]) -> Vec<&'static str> {
    let mut failures = Vec::new();
    for &name in list {
        let count = match name {
            "dreams" => t.dreams,
            "hauntings" => t.hauntings,
            "bribes" => t.bribes,
            "birth_claims" => t.birth_claims,
            "imported_claims" => t.imported_claims,
            "rebuilt_claims" => t.rebuilt_claims,
            "carry_overs" => t.carry_overs,
            "nodes_dream_interpretation" => t.nodes_dream_interpretation,
            "nodes_magistrate_ruling" => t.nodes_magistrate_ruling,
            _ => {
                debug_assert!(false, "unknown zero-count field: {name}");
                continue;
            }
        };
        if count == 0 {
            failures.push(name);
        }
    }
    failures
}

#[derive(Debug, Eq, PartialEq)]
enum SeedOutcome {
    Ok(SeedStats),
    Targets {
        failing: Vec<&'static str>,
        stats: SeedStats,
    },
    Invariant {
        tick: u64,
        violation: Violation,
    },
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
    claims: [u64; 3],
    carry_overs: u64,
    nodes: [[u64; 2]; 2],
    node_count: usize,
    event_count: usize,
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
            claims: [0, 0, 0],
            carry_overs: 0,
            nodes: [[0, 0], [0, 0]],
            node_count: 0,
            event_count: world.log().len(),
        }
    }

    fn after_tick(&mut self, world: &World, player_wait_before: Option<Tick>) {
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
        // The tick just completed: step 12 already advanced the counter, and this is the
        // value the invariant checker measures the wait against for R11.3.
        let tick = world.tick().0.saturating_sub(1);
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
        // A claim or automatic placement can end the wait this tick, before the
        // post-tick queue is measured. Include that completed wait too.
        if let Some(since) = player_wait_before {
            self.max_wait_player = self.max_wait_player.max(tick.saturating_sub(since.0));
        }
    }
    fn count_underworld(&mut self, sim: &Sim) -> Result<(), String> {
        let world = sim.world();
        let inputs = sim
            .inputs()
            .for_tick(Tick(world.tick().0.saturating_sub(1)));
        if inputs.len() != sim.last_outcomes().len() {
            return Err("input outcomes differ from submitted inputs".to_owned());
        }
        let mut standing_claims = [0u64; 2];
        for (input, outcome) in inputs.iter().zip(sim.last_outcomes()) {
            if input.seq != outcome.seq {
                return Err("input outcomes differ from submitted inputs".to_owned());
            }
            if outcome.result.is_ok() {
                match input.payload {
                    InputPayload::ClaimSlot {
                        slot: SlotRef::Birth(_),
                    } => self.claims[0] += 1,
                    InputPayload::ClaimSlot {
                        slot: SlotRef::ImportedVessel,
                    } => {
                        self.claims[1] += 1;
                        standing_claims[0] += 1;
                    }
                    InputPayload::ClaimSlot {
                        slot: SlotRef::RebuiltBody,
                    } => {
                        self.claims[2] += 1;
                        standing_claims[1] += 1;
                    }
                    InputPayload::CarryOver { .. } => self.carry_overs += 1,
                    _ => {}
                }
            }
        }
        let mut standing_events = [0u64; 2];
        for event in &world.log().events()[self.event_count..] {
            let (kind, person, price) = match event.kind {
                EventKind::Possession { person, price } => (0, person, price),
                EventKind::Rebuild { person, price } => (1, person, price),
                _ => continue,
            };
            if price > 0
                && world
                    .persons()
                    .get(&person)
                    .is_some_and(|p| p.soul == world.souls().player)
            {
                standing_events[kind] += 1;
            }
        }
        if standing_claims != standing_events {
            return Err(format!(
                "applied standing claims {standing_claims:?} differ from player arrival Events {standing_events:?}"
            ));
        }
        self.event_count = world.log().len();
        for node in &world.nodes().resolved[self.node_count..] {
            let family = match node.family {
                NodeFamily::DreamInterpretation => 0,
                NodeFamily::MagistrateRuling => 1,
            };
            let source = match node.source {
                ChoiceSource::External => 0,
                ChoiceSource::RulesDefault => 1,
            };
            self.nodes[family][source] += 1;
        }
        self.node_count = world.nodes().resolved.len();
        Ok(())
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

fn is_offering_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Offering { .. } | EventKind::BribeOffering { .. }
    )
}

fn player_lives(world: &World) -> String {
    let player = world.souls().player;
    let bodies: Vec<_> = world
        .persons()
        .values()
        .filter(|person| person.soul == player)
        .collect();
    let events = world.log().events();
    bodies
        .iter()
        .enumerate()
        .map(|(index, person)| match person.life {
            Life::Alive { .. } => format!("{}:alive", index + 1),
            Life::Dead { death } => {
                // Event order assigns offerings only after this death and before the
                // next arrival, even when either happens on the same tick.
                let death_event = events.iter().find(|event| {
                    matches!(event.kind, EventKind::Death { person: deceased } if deceased == person.id)
                });
                let next_arrival = bodies.get(index + 1).and_then(|next| {
                    events.iter().find(|event| match event.kind {
                        EventKind::Birth { person }
                        | EventKind::Possession { person, .. }
                        | EventKind::Rebuild { person, .. } => person == next.id,
                        _ => false,
                    })
                });
                let credited: u64 = events
                    .iter()
                    .filter(|event| {
                        death_event.is_some_and(|start| event.id >= start.id)
                            && next_arrival.is_none_or(|arrival| event.id < arrival.id)
                    })
                    .filter_map(|event| match event.kind {
                        EventKind::Offering {
                            ghost, credited, ..
                        } if world
                            .persons()
                            .get(&ghost)
                            .is_some_and(|p| p.soul == player) =>
                        {
                            Some(credited)
                        }
                        _ => None,
                    })
                    .sum();
                let age = i128::from(death.0) - i128::from(person.birth_day);
                format!(
                    "{}:death={},age_days={age},joss={credited}",
                    index + 1,
                    death.0
                )
            }
        })
        .collect::<Vec<_>>()
        .join(";")
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
        offerings: event_count(world, &is_offering_event),
        dreams: event_count(world, &|kind| matches!(kind, EventKind::Dream { .. })),
        hauntings: event_count(world, &|kind| matches!(kind, EventKind::Haunting { .. })),
        bribes: event_count(world, &|kind| matches!(kind, EventKind::Appeal { .. })),
        claims: tally.claims,
        auto_placed: event_count(world, &|kind| {
            matches!(kind, EventKind::Possession { person, price: 0 }
                if world.persons().get(person).is_some_and(|p| p.soul == world.souls().player))
        }),
        carry_overs: tally.carry_overs,
        nodes: tally.nodes,
        player_lives: player_lives(world),
        relations_max: tally.relations_max,
        rejections: RejectReason::ALL
            .iter()
            .map(|&reason| count_of(world, reason))
            .collect(),
        targets,
    }
}

/// The exact `ok` line of the design.
fn ok_line(seed: u64, ticks: u64, s: &SeedStats) -> String {
    let rejections: String = RejectReason::ALL
        .iter()
        .zip(&s.rejections)
        .map(|(reason, count)| format!("{}:{}", reason.label(), count))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "seed {seed} ok ticks={ticks} final={} residents_min={} residents_max={} band_40_60_ticks={} queue_final={} max_wait_npc={} births={} deaths={} imported={} rebuilt={} origin_final=native:{},possessed:{},rebuilt:{} arrivals=native:{},possessed:{},rebuilt:{} events={} relations_max={} rejections={} offerings={} dreams={} hauntings={} bribes={} claims=birth:{},imported:{},rebuilt:{} auto_placed={} carry_overs={} nodes=dream_interpretation:external:{},rules:{};magistrate_ruling:external:{},rules:{} max_wait_player={} player_lives={} invariants=pass pop_35_65={} band_95={} outsiders_le_births={} outsiders_le_births_third={}",
        s.final_checksum,
        s.residents_min,
        s.residents_max,
        s.band_40_60_ticks,
        s.queue_final,
        s.max_wait_npc,
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
        rejections,
        s.offerings,
        s.dreams,
        s.hauntings,
        s.bribes,
        s.claims[0],
        s.claims[1],
        s.claims[2],
        s.auto_placed,
        s.carry_overs,
        s.nodes[0][0],
        s.nodes[0][1],
        s.nodes[1][0],
        s.nodes[1][1],
        s.max_wait_player,
        s.player_lives,
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
/// Builds a replay with each input's original submission sequence, including inputs
/// submitted for future ticks before the AutoPlayer's current-tick inputs.
pub(crate) fn replay_of(
    seed: u64,
    config: WorldConfig,
    ticks: u64,
    inputs: &[TickInput],
    checksums: &[Checksum],
) -> ReplayFile {
    ReplayFile {
        format: REPLAY_FORMAT.to_owned(),
        version: REPLAY_VERSION,
        seed,
        config: ReplayConfig::from(config),
        ticks,
        inputs: {
            let mut recorded: Vec<_> = inputs
                .iter()
                .map(|input| ReplayInput {
                    tick: input.tick.0,
                    seq: input.seq.0,
                    payload: ReplayPayload::from(input.payload),
                })
                .collect();
            recorded.sort_by_key(|input| input.seq);
            recorded
        },
        checksums: checksums.to_vec(),
    }
}

type TickObserver<'a> = Option<&'a mut dyn FnMut(&Sim, bool)>;

#[derive(Debug)]
enum DriveError {
    Invariant { tick: u64, violation: Violation },
    Divergence(String),
    Setup(String),
}

impl From<DriveError> for SeedOutcome {
    fn from(error: DriveError) -> Self {
        match error {
            DriveError::Invariant { tick, violation } => Self::Invariant { tick, violation },
            DriveError::Divergence(message) => Self::Divergence(message),
            DriveError::Setup(message) => Self::Setup(message),
        }
    }
}

/// Steps an already constructed run through the same Auto_Player, invariant and
/// reporting path used by `batch`; the caller owns the run's input stream.
/// The optional observer is called before planning and after the completed tick;
/// production passes `None` and never clones or retains a World snapshot.
fn drive_sim(
    sim: &mut Sim,
    ticks: u64,
    check: &dyn Fn(&World) -> Result<(), Violation>,
    mut observe: TickObserver<'_>,
) -> Result<Tally, DriveError> {
    let mut checker = InvariantChecker::new(sim.world())
        .map_err(|violation| DriveError::Invariant { tick: 0, violation })?;
    let mut tally = Tally::new(sim.world());
    let mut auto_player = crate::auto_player::AutoPlayer::default();
    for _ in 0..ticks {
        let tick = sim.world().tick();
        let player_wait_before = match sim.world().souls().places[&sim.world().souls().player] {
            SoulPlace::Waiting { since } => Some(since),
            SoulPlace::Body(_) => None,
        };
        if let Some(callback) = &mut observe {
            callback(sim, false);
        }
        for payload in auto_player.plan(sim) {
            sim.submit(tick, payload)
                .map_err(|e| DriveError::Setup(format!("auto-player input refused: {e}")))?;
        }
        sim.step();
        checker
            .after_tick(sim.world())
            .map_err(|violation| DriveError::Invariant {
                tick: violation.tick,
                violation,
            })?;
        check(sim.world()).map_err(|violation| DriveError::Invariant {
            tick: violation.tick,
            violation,
        })?;
        if let Some(callback) = &mut observe {
            callback(sim, true);
        }
        tally.after_tick(sim.world(), player_wait_before);
        tally
            .count_underworld(sim)
            .map_err(DriveError::Divergence)?;
    }
    Ok(tally)
}

fn checked_stats(sim: &Sim, ticks: u64, tally: &Tally) -> Result<SeedStats, String> {
    let log = sim.world().log();
    if log.digest() != log.recompute_digest() {
        return Err("Event_Log digest differs from a recompute".to_owned());
    }
    let checksum = sim.checksums().last().ok_or("no ticks were run")?;
    Ok(stats_of(
        sim.world(),
        ticks,
        tally,
        checksum.to_hex_string(),
    ))
}

/// Report an explicitly configured simulation through the production batch path.
/// The test observer receives the state before planning and after settlement;
/// the normal CLI passes no observer and retains its DEFAULT Params.
/// Tests inspect real inputs and outcomes at each completed tick.
#[doc(hidden)]
pub fn report_sim(
    mut sim: Sim,
    ticks: u64,
    mut observe: impl FnMut(&Sim, bool),
) -> Result<String, String> {
    let tally = drive_sim(&mut sim, ticks, &|_| Ok(()), Some(&mut observe))
        .map_err(|failure| format!("{failure:?}"))?;
    let stats = checked_stats(&sim, ticks, &tally)?;
    Ok(ok_line(sim.world().seed(), ticks, &stats))
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
    for &(tick, payload) in &inputs {
        if let Err(e) = sim.submit(tick, payload) {
            return SeedOutcome::Setup(format!("input refused: {e}"));
        }
    }
    let tally = match drive_sim(&mut sim, ticks, check, None) {
        Ok(tally) => tally,
        Err(outcome) => return outcome.into(),
    };

    // The digest must equal a from-scratch recompute at the end of the run (OP-8 A).
    let log = sim.world().log();
    if log.digest() != log.recompute_digest() {
        return SeedOutcome::Divergence("Event_Log digest differs from a recompute".to_owned());
    }

    // The replay carries the stepped run's own checksums and is verified in process.
    // `InputStream::all()` is in tick order, but each entry retains its submission seq.
    let file = replay_of(seed, config, ticks, sim.inputs().all(), sim.checksums());
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
            stats,
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
    let mut totals = Totals::default();
    for seed in first..=last {
        total += 1;
        let line = match run_seed(seed, config, ticks, random_inputs, require_targets, check) {
            SeedOutcome::Ok(stats) => {
                ok += 1;
                totals.add(&stats);
                let _ = writeln!(out, "{}", ok_line(seed, ticks, &stats));
                continue;
            }
            SeedOutcome::Targets { failing, stats } => {
                totals.add(&stats);
                targets_line(seed, &failing)
            }
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
    let _ = writeln!(
        out,
        "batch: totals dreams={} hauntings={} bribes={} birth_claims={} imported_claims={} rebuilt_claims={} carry_overs={} nodes_dream_interpretation={} nodes_magistrate_ruling={}",
        totals.dreams,
        totals.hauntings,
        totals.bribes,
        totals.birth_claims,
        totals.imported_claims,
        totals.rebuilt_claims,
        totals.carry_overs,
        totals.nodes_dream_interpretation,
        totals.nodes_magistrate_ruling
    );
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
    use sim_core::ids::SoulId;

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
    fn replay_retains_submission_sequences_across_future_tick_inputs() {
        use sim_core::ids::{InputSeq, PersonId};

        let payload = InputPayload::Haunt {
            target: PersonId(1),
        };
        let inputs = [
            TickInput {
                tick: Tick(9),
                seq: InputSeq(0),
                payload,
            },
            TickInput {
                tick: Tick(3),
                seq: InputSeq(1),
                payload,
            },
            TickInput {
                tick: Tick(3),
                seq: InputSeq(2),
                payload,
            },
        ];
        let replay = replay_of(7, small_config(), 10, &inputs, &[]);
        let ordering: Vec<_> = replay
            .inputs
            .iter()
            .map(|input| (input.tick, input.seq))
            .collect();
        assert_eq!(ordering, [(9, 0), (3, 1), (3, 2)]);
    }

    #[test]
    fn a_release_past_max_wait_reports_exactly_max_wait() {
        let mut params = sim_core::params::Params::DEFAULT;
        // Zero births: the opening Souls stay waiting until the release, so one reaches
        // Max_Wait exactly. With default Params no seed in 1..=20 reaches the bound
        // within 1,200 ticks (the largest wait is 858), so the birth rolls are disabled.
        params.birth_ppm_married = 0;
        params.birth_ppm_unmarried = 0;
        let max_wait = params.max_wait;
        let mut sim = Sim::new_with_params(1, small_config(), params).unwrap();
        let opening_waiting: Vec<SoulId> = {
            let world = sim.world();
            world
                .souls()
                .places
                .iter()
                .filter(|(soul, place)| {
                    **soul != world.souls().player && matches!(**place, SoulPlace::Waiting { .. })
                })
                .map(|(&soul, _)| soul)
                .collect()
        };
        assert!(
            opening_waiting.len() >= 2,
            "the opening world waits with two non-player Souls"
        );

        let mut tally = Tally::new(sim.world());
        for _ in 0..1_100 {
            sim.step();
            tally.after_tick(sim.world(), None);
        }

        for soul in opening_waiting {
            assert!(
                matches!(sim.world().souls().places[&soul], SoulPlace::Body(_)),
                "every waiting Soul was released"
            );
        }
        // Before the fix (wait measured at the already-advanced counter) this read 1,096.
        assert_eq!(tally.max_wait_npc, max_wait);
    }

    #[test]
    fn healthy_batch_exits_zero_with_one_line_per_seed() {
        let (code, out, err) = run((1, 2), false, &|_| Ok(()));
        assert_eq!(code, 0, "{err}");
        assert!(err.is_empty(), "{err}");
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 4, "{out}");
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
            let max_wait: u64 = line
                .split(' ')
                .find_map(|field| field.strip_prefix("max_wait_npc="))
                .expect("the max_wait_npc field")
                .parse()
                .expect("a decimal wait");
            assert!(
                max_wait <= sim_core::params::Params::DEFAULT.max_wait,
                "{line}"
            );
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
        assert_eq!(lines[3], "batch: 2/2 seeds ok");
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
        assert_eq!(lines[3], "batch: 1/2 seeds ok");
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
            // The report-only ratio is not part of the enforced list.
            outsiders_le_births_third: false,
        };
        assert_eq!(targets.failing(), ["pop_35_65", "band_95"]);
        assert!(!targets.pass());
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

    /// A `SeedStats` from a real 30-tick seed 1 run with the targets replaced.
    fn stats_with(targets: Targets) -> SeedStats {
        let SeedOutcome::Ok(mut stats) = run_seed(1, small_config(), 30, 20, false, &|_| Ok(()))
        else {
            panic!("seed 1 runs");
        };
        stats.targets = targets;
        stats
    }

    #[test]
    fn a_one_third_arrival_shortfall_is_reported_but_never_fails_the_seed() {
        let targets = Targets {
            pop_35_65: true,
            band_95: true,
            outsiders_le_births: true,
            outsiders_le_births_third: false,
        };
        // `run_seed` reads `pass()` under --require-targets, so this seed stays `ok` and
        // `run_batch` returns EXIT_OK (0).
        assert!(targets.pass());
        assert!(targets.failing().is_empty());
        let line = ok_line(1, 30, &stats_with(targets));
        assert!(
            line.ends_with(
                "pop_35_65=pass band_95=pass outsiders_le_births=pass \
outsiders_le_births_third=fail"
            ),
            "{line}"
        );
    }

    #[test]
    fn a_ratio_shortfall_still_fails_the_seed_under_require_targets() {
        let targets = Targets {
            pop_35_65: true,
            band_95: true,
            outsiders_le_births: false,
            outsiders_le_births_third: true,
        };
        // `run_seed` returns `SeedOutcome::Targets` when `pass()` is false, so `run_batch`
        // counts the seed as failed and returns EXIT_FAILED (1).
        assert!(!targets.pass());
        assert_eq!(targets.failing(), ["outsiders_le_births"]);
        assert_eq!(
            targets_line(5, &targets.failing()),
            "seed 5 FAIL targets: outsiders_le_births=fail"
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
            "births=",
            "deaths=",
            "imported=",
            "rebuilt=",
            "origin_final=",
            "arrivals=",
            "events=",
            "relations_max=",
            "rejections=",
            "offerings=",
            "dreams=",
            "hauntings=",
            "bribes=",
            "claims=",
            "auto_placed=",
            "carry_overs=",
            "nodes=",
            "max_wait_player=",
            "player_lives=",
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

    #[test]
    fn offerings_include_bribes_without_claiming_bribe_credit() {
        use sim_core::ids::PersonId;

        let ordinary = EventKind::Offering {
            offerer: PersonId(1),
            ghost: PersonId(2),
            amount: 30,
            credited: 12,
        };
        let bribe = EventKind::BribeOffering {
            ghost: PersonId(2),
            magistrate: PersonId(3),
            amount: 5,
        };
        let appeal = EventKind::Appeal {
            ghost: PersonId(2),
            magistrate: PersonId(3),
        };
        let kinds = [ordinary, bribe, appeal];
        assert_eq!(
            kinds.iter().filter(|kind| is_offering_event(kind)).count(),
            2
        );
        assert_eq!(
            kinds
                .iter()
                .filter(|kind| matches!(kind, EventKind::Appeal { .. }))
                .count(),
            1
        );
        let credited: u64 = kinds
            .iter()
            .filter_map(|kind| match kind {
                EventKind::Offering { credited, .. } => Some(*credited),
                _ => None,
            })
            .sum();
        assert_eq!(
            credited, 12,
            "bribe offerings do not credit the Player_Soul"
        );
    }

    #[test]
    fn passive_zero_count_list_is_empty() {
        assert!(PASSIVE_ZERO_COUNT_LIST.is_empty());
        assert!(zero_count_failures(&Totals::default(), PASSIVE_ZERO_COUNT_LIST).is_empty());
    }

    #[test]
    fn devoted_zero_count_list_has_only_documented_applied_counts_in_order() {
        assert_eq!(
            DEVOTED_ZERO_COUNT_LIST,
            [
                "dreams",
                "hauntings",
                "bribes",
                "imported_claims",
                "rebuilt_claims",
                "carry_overs",
                "nodes_dream_interpretation",
                "nodes_magistrate_ruling",
            ]
        );
        // Independently validate the public lists against the nine Totals field names.
        for &name in PASSIVE_ZERO_COUNT_LIST
            .iter()
            .chain(DEVOTED_ZERO_COUNT_LIST)
        {
            assert!(
                [
                    "dreams",
                    "hauntings",
                    "bribes",
                    "birth_claims",
                    "imported_claims",
                    "rebuilt_claims",
                    "carry_overs",
                    "nodes_dream_interpretation",
                    "nodes_magistrate_ruling",
                ]
                .contains(&name),
                "unknown Totals count field: {name}"
            );
        }
    }
}
