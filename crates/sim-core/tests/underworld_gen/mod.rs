//! Shared generator for the underworld property tests (design "Correctness Properties",
//! "Generated underworld run").
//!
//! A [`Scenario`] is a seed, an `opening_residents` count in 40..=60 and a Params
//! choice: `Params::stress_underworld()` in three cases of four and `Params::DEFAULT`
//! otherwise. A [`Run`] drives such a world for [`TICKS`] ticks, planning the inputs of
//! every tick from the World's own state: valid `Act`, dream, haunting, Bribe, slot
//! claim, Carry_Over and External_Choice payloads next to invalid ones (an unknown or
//! dead or unconnected dreamer, the Magistrate's ID, a zero or excessive Bribe, a
//! closed slot, a `Choose` with the wrong trigger or an option outside the set).
//!
//! Every planned input goes through [`Sim::submit`] for the current tick, so it is an
//! ordinary `TickInput`; a valid `Choose` takes its option from
//! [`Sim::preview_node`]. [`Run::step`] returns the World before and after the tick and
//! the planned inputs with their outcomes, and runs the extended
//! [`InvariantChecker`] after every tick (R12.1).

#![allow(dead_code)]

use proptest::prelude::*;

use sim_core::checksum::Checksum;
use sim_core::events::{Event, EventKind};
use sim_core::ids::{BirthSlotId, EntityId, InputSeq, PersonId, Tick};
use sim_core::input::{InputPayload, RejectReason};
use sim_core::invariants::InvariantChecker;
use sim_core::params::Params;
use sim_core::rng::{self, StreamTag};
use sim_core::tick::Sim;
use sim_core::underworld::carry_over::TraitName;
use sim_core::underworld::dreams::DreamIntent;
use sim_core::underworld::ghosts;
use sim_core::underworld::nodes::{NodeOption, NodeRef};
use sim_core::underworld::slots::{BirthSlot, SlotRef};
use sim_core::values::SocialKind;
use sim_core::world::{Life, SoulPlace, World, WorldConfig};

/// Ticks generated per property case (design "Generated underworld run").
pub const TICKS: u64 = 400;

/// The six social kinds, in card order.
const KINDS: [SocialKind; 6] = [
    SocialKind::Help,
    SocialKind::Gift,
    SocialKind::Quarrel,
    SocialKind::Insult,
    SocialKind::Theft,
    SocialKind::Apology,
];

/// Which Params a scenario runs with.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ParamsChoice {
    /// `Params::stress_underworld()`: three cases in four.
    StressUnderworld,
    /// The calibrated defaults: one case in four.
    Default,
}

/// One generated run: seed, opening size and Params.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Scenario {
    /// World seed.
    pub seed: u64,
    /// Opening residents, 40..=60.
    pub residents: u16,
    /// Stress or default rates.
    pub params: ParamsChoice,
}

impl Scenario {
    /// A scenario with the given seed, size and Params.
    pub fn new(seed: u64, residents: u16, params: ParamsChoice) -> Self {
        Self {
            seed,
            residents,
            params,
        }
    }

    /// The Params of this scenario.
    pub fn values(&self) -> Params {
        match self.params {
            ParamsChoice::StressUnderworld => Params::stress_underworld(),
            ParamsChoice::Default => Params::DEFAULT,
        }
    }

    /// Builds the [`Sim`] of this scenario.
    pub fn sim(&self) -> Sim {
        self.sim_with(self.values())
    }

    /// Builds the [`Sim`] of this scenario with explicit Params.
    pub fn sim_with(&self, params: Params) -> Sim {
        let config = WorldConfig::try_new(self.residents).expect("scenario config is in range");
        Sim::new_with_params(self.seed, config, params).expect("opening world")
    }
}

/// The Params choice: stress three times in four.
pub fn arb_params() -> impl Strategy<Value = ParamsChoice> {
    prop_oneof![
        3 => Just(ParamsChoice::StressUnderworld),
        1 => Just(ParamsChoice::Default),
    ]
}

/// A generated scenario.
pub fn arb_scenario() -> impl Strategy<Value = Scenario> {
    (any::<u64>(), 40u16..=60, arb_params())
        .prop_map(|(seed, residents, params)| Scenario::new(seed, residents, params))
}

/// One planned input and what the tick made of it.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Submitted {
    /// The payload the generator planned.
    pub payload: InputPayload,
    /// The `seq` the input stream gave it.
    pub seq: InputSeq,
    /// `Ok(())` when it applied, `Err(reason)` when the tick skipped it.
    pub result: Result<(), RejectReason>,
    /// The node the payload would fire, from [`Sim::preview_node`] (design "Seam for
    /// the decision model"), when the generator previewed it.
    pub preview: Option<sim_core::underworld::nodes::NodeSpec>,
}

/// One generated run in progress.
pub struct Run {
    /// The scenario.
    pub scenario: Scenario,
    /// The simulation.
    pub sim: Sim,
    /// Planned inputs per tick, in tick order.
    pub plan: Vec<Vec<Submitted>>,
    /// Whether the generator plans slot claims (a claim-less run reaches the R8.1
    /// placement).
    pub claims: bool,
    /// The inputs the last stepped tick applied, in `(tick, seq)` order.
    pub last_inputs: Vec<sim_core::input::TickInput>,
    checker: InvariantChecker,
}

impl Run {
    /// Starts the run and checks the Opening_World.
    pub fn new(scenario: Scenario) -> Self {
        Self::with_params(scenario, scenario.values())
    }

    /// Starts a run with explicit Params.
    pub fn with_params(scenario: Scenario, params: Params) -> Self {
        let sim = scenario.sim_with(params);
        let checker = InvariantChecker::new(sim.world())
            .unwrap_or_else(|violation| panic!("opening world of {scenario:?}: {violation}"));
        Self {
            scenario,
            sim,
            plan: Vec::new(),
            claims: true,
            last_inputs: Vec::new(),
            checker,
        }
    }

    /// The world of the run.
    pub fn world(&self) -> &World {
        self.sim.world()
    }

    /// Plans, submits and steps one tick; returns the World before and after the tick
    /// and the planned inputs with their outcomes. Runs the extended checker.
    pub fn step(&mut self) -> (World, World, Vec<Submitted>) {
        let before = self.sim.world().clone();
        let mut planned: Vec<Submitted> = Vec::new();
        plan_tick(&mut self.sim, &mut planned, self.claims);
        self.last_inputs = self.sim.inputs().for_tick(before.tick()).to_vec();
        self.sim.step();
        for entry in &mut planned {
            entry.result = self
                .sim
                .last_outcomes()
                .iter()
                .find(|outcome| outcome.seq == entry.seq)
                .unwrap_or_else(|| panic!("input {} has no outcome", entry.seq.0))
                .result;
        }
        let after = self.sim.world().clone();
        self.checker
            .after_tick(&after)
            .unwrap_or_else(|violation| panic!("scenario {:?}: {violation}", self.scenario));
        self.plan.push(planned.clone());
        (before, after, planned)
    }

    /// Runs the whole scenario.
    pub fn drive(&mut self) -> &mut Self {
        for _ in 0..TICKS {
            self.step();
        }
        self
    }
}

/// A scenario's whole run, driven to the end of [`TICKS`].
pub fn driven(scenario: Scenario) -> Run {
    let mut run = Run::new(scenario);
    run.drive();
    run
}

fn pick(len: usize, roll: u64) -> usize {
    let n = u64::try_from(len).expect("a generated list fits in u64");
    usize::try_from(rng::below(roll, n)).expect("below() is smaller than len")
}

/// One draw of the generator's own stream: tooling never aliases a simulation stream.
fn draw(seed: u64, tick: Tick, site: u64) -> u64 {
    rng::draw(seed, EntityId(0), StreamTag::ToolingInputs, tick, site)
}

/// Plans the inputs of the current tick and submits them.
fn plan_tick(sim: &mut Sim, planned: &mut Vec<Submitted>, claims: bool) {
    let tick = sim.world().tick();
    let seed = sim.world().seed();
    let d = |site: u64| draw(seed, tick, site);

    plan_acts(sim, planned, &d);

    let Some(ghost) = sim.world().player_wait().map(|wait| wait.ghost) else {
        return;
    };
    let _ = ghost;
    let connected = ghosts::connected(sim.world(), ghost);
    let residents = residents(sim.world());

    plan_dream(sim, planned, &connected, &d);
    plan_haunting(sim, planned, &connected, &residents, &d);
    plan_bribe(sim, planned, &d);
    plan_carry_over(sim, planned, &d);
    plan_invalid_choose(sim, planned, &d);
    if claims {
        plan_claim(sim, planned, &d);
    }
}

/// Zero to two social `Act` inputs, valid-looking or invalid (unknown person, self
/// target, intensity out of range), the way `sim-cli` `inputs.rs` mixes them.
fn plan_acts(sim: &mut Sim, planned: &mut Vec<Submitted>, d: &dyn Fn(u64) -> u64) {
    let residents = residents(sim.world());
    if residents.is_empty() {
        return;
    }
    let acts = d(0) % 3;
    for k in 0..acts {
        let base = 1 + k * 4;
        let actor = residents[pick(residents.len(), d(base))];
        let target = residents[pick(residents.len(), d(base + 1))];
        let kind = KINDS[pick(KINDS.len(), d(base + 2))];
        let (actor, target, intensity) = match d(base + 3) % 8 {
            0 => (PersonId(9999), target, 10),
            1 => (actor, actor, 10),
            2 => (actor, target, 0),
            _ => (
                actor,
                target,
                1 + u8::try_from(d(base + 3) % 100).unwrap_or(0),
            ),
        };
        let payload = InputPayload::Act {
            kind,
            actor,
            target,
            intensity,
        };
        submit(sim, planned, payload);
    }
}

/// A dream with an External_Choice, or one of the invalid dreamers.
fn plan_dream(
    sim: &mut Sim,
    planned: &mut Vec<Submitted>,
    connected: &[PersonId],
    d: &dyn Fn(u64) -> u64,
) {
    let dead = dead_person(sim.world());
    let unconnected = residents(sim.world())
        .into_iter()
        .find(|id| !connected.contains(id));
    let dreamer = match d(10) % 7 {
        0 | 1 if !connected.is_empty() => connected[pick(connected.len(), d(11))],
        2 => sim.world().magistrate().id,
        3 => dead.unwrap_or(PersonId(9999)),
        4 => unconnected.unwrap_or(PersonId(9999)),
        5 => PersonId(9999),
        _ => return,
    };
    let intent = DreamIntent::ALL[pick(DreamIntent::ALL.len(), d(12))];
    let payload = InputPayload::Dream { dreamer, intent };
    // A preview states whether the dream fires a node; a valid Choose takes its option
    // from the same option set (design "Seam for the decision model").
    let spec = sim.preview_node(payload).ok();
    let seq = match submit_previewed(sim, planned, payload, spec.clone()) {
        Some(seq) => seq,
        None => return,
    };
    let Some(spec) = spec else {
        return;
    };
    if d(13).is_multiple_of(4) || spec.options.is_empty() {
        return;
    }
    let option = spec.options[pick(spec.options.len(), d(14))];
    submit(
        sim,
        planned,
        InputPayload::Choose {
            node: NodeRef::Trigger { seq },
            option,
        },
    );
}

/// A haunting of a connected person, the Magistrate, an unconnected Resident or a dead
/// Person.
fn plan_haunting(
    sim: &mut Sim,
    planned: &mut Vec<Submitted>,
    connected: &[PersonId],
    residents: &[PersonId],
    d: &dyn Fn(u64) -> u64,
) {
    let target = match d(20) % 7 {
        0 | 1 if !connected.is_empty() => connected[pick(connected.len(), d(21))],
        2 => sim.world().magistrate().id,
        3 => residents
            .iter()
            .copied()
            .find(|id| !connected.contains(id))
            .unwrap_or(PersonId(9999)),
        4 => dead_person(sim.world()).unwrap_or(PersonId(9999)),
        _ => return,
    };
    submit(sim, planned, InputPayload::Haunt { target });
}

/// A Bribe with a valid amount, zero, more than the balance, or half of it, followed by
/// an External_Choice.
fn plan_bribe(sim: &mut Sim, planned: &mut Vec<Submitted>, d: &dyn Fn(u64) -> u64) {
    let player = sim.world().souls().player;
    let balance = sim.world().joss().get(&player).map_or(0, |a| a.balance);
    let amount = match d(30) % 6 {
        0 | 1 => balance.max(1),
        2 => 0,
        3 => balance.saturating_add(1),
        4 => balance.checked_div(2).unwrap_or(0).saturating_add(1),
        _ => return,
    };
    let payload = InputPayload::Bribe { amount };
    let spec = sim.preview_node(payload).ok();
    let Some(seq) = submit_previewed(sim, planned, payload, spec.clone()) else {
        return;
    };
    let Some(spec) = spec else {
        return;
    };
    if spec.options.is_empty() {
        return;
    }
    let option = spec.options[pick(spec.options.len(), d(31))];
    submit(
        sim,
        planned,
        InputPayload::Choose {
            node: NodeRef::Trigger { seq },
            option,
        },
    );
}

/// A Carry_Over choice.
fn plan_carry_over(sim: &mut Sim, planned: &mut Vec<Submitted>, d: &dyn Fn(u64) -> u64) {
    if !d(40).is_multiple_of(3) {
        return;
    }
    let trait_name = TraitName::ALL[pick(TraitName::ALL.len(), d(41))];
    submit(sim, planned, InputPayload::CarryOver { trait_name });
}

/// A `Choose` with a trigger that fired nothing or an option outside a node's set.
fn plan_invalid_choose(sim: &mut Sim, planned: &mut Vec<Submitted>, d: &dyn Fn(u64) -> u64) {
    if !d(50).is_multiple_of(8) {
        return;
    }
    let seq = InputSeq(d(51) % 5);
    let option = NodeOption::ALL[pick(NodeOption::ALL.len(), d(52))];
    submit(
        sim,
        planned,
        InputPayload::Choose {
            node: NodeRef::Trigger { seq },
            option,
        },
    );
}

/// A claim on an open Birth_Slot, a Standing_Slot, or a closed Birth_Slot. The claim is
/// the last planned input of the tick, so it never hides an earlier mechanic.
fn plan_claim(sim: &mut Sim, planned: &mut Vec<Submitted>, d: &dyn Fn(u64) -> u64) {
    let slots: Vec<BirthSlotId> = sim.world().slots().keys().copied().collect();
    let slot = match d(60) % 8 {
        0 | 1 if !slots.is_empty() => SlotRef::Birth(slots[pick(slots.len(), d(61))]),
        2 => SlotRef::ImportedVessel,
        3 => SlotRef::RebuiltBody,
        4 => SlotRef::Birth(BirthSlotId(9999)),
        _ => return,
    };
    submit(sim, planned, InputPayload::ClaimSlot { slot });
}

fn submit(sim: &mut Sim, planned: &mut Vec<Submitted>, payload: InputPayload) -> Option<InputSeq> {
    submit_previewed(sim, planned, payload, None)
}

/// Submits `payload` and records the preview of the node it would fire.
fn submit_previewed(
    sim: &mut Sim,
    planned: &mut Vec<Submitted>,
    payload: InputPayload,
    preview: Option<sim_core::underworld::nodes::NodeSpec>,
) -> Option<InputSeq> {
    let tick = sim.world().tick();
    let seq = sim.submit(tick, payload).ok()?;
    planned.push(Submitted {
        payload,
        seq,
        result: Ok(()),
        preview,
    });
    Some(seq)
}

/// Every Resident, in Person ID order.
pub fn residents(world: &World) -> Vec<PersonId> {
    world
        .persons()
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .map(|person| person.id)
        .collect()
}

/// The first dead Person, in Person ID order.
pub fn dead_person(world: &World) -> Option<PersonId> {
    world
        .persons()
        .values()
        .find(|person| matches!(person.life, Life::Dead { .. }))
        .map(|person| person.id)
}

/// The Events appended since `start`, in ID order.
pub fn events_since(world: &World, start: usize) -> &[Event] {
    world.log().events().get(start..).unwrap_or(&[])
}

/// The Events of `kind` appended since `start`.
pub fn events_of(world: &World, start: usize) -> impl Iterator<Item = &Event> {
    events_since(world, start).iter()
}

/// How often each applied underworld kind occurred in a list of planned inputs.
#[derive(Copy, Clone, Default, Eq, PartialEq, Debug)]
pub struct AppliedCounts {
    /// Applied dreams.
    pub dreams: u64,
    /// Applied hauntings.
    pub hauntings: u64,
    /// Applied Bribes.
    pub bribes: u64,
    /// Applied Birth_Slot claims.
    pub birth_claims: u64,
    /// Applied Standing_Slot claims.
    pub standing_claims: u64,
    /// Applied Carry_Over inputs.
    pub carry_overs: u64,
    /// Applied External_Choices.
    pub choices: u64,
}

impl AppliedCounts {
    /// Counts the applied underworld inputs of one tick.
    pub fn add(&mut self, planned: &[Submitted]) {
        for entry in planned {
            if entry.result.is_err() {
                continue;
            }
            match entry.payload {
                InputPayload::Dream { .. } => self.dreams = self.dreams.saturating_add(1),
                InputPayload::Haunt { .. } => {
                    self.hauntings = self.hauntings.saturating_add(1);
                }
                InputPayload::Bribe { .. } => self.bribes = self.bribes.saturating_add(1),
                InputPayload::ClaimSlot {
                    slot: SlotRef::Birth(_),
                } => self.birth_claims = self.birth_claims.saturating_add(1),
                InputPayload::ClaimSlot { .. } => {
                    self.standing_claims = self.standing_claims.saturating_add(1);
                }
                InputPayload::CarryOver { .. } => {
                    self.carry_overs = self.carry_overs.saturating_add(1);
                }
                InputPayload::Choose { .. } => self.choices = self.choices.saturating_add(1),
                InputPayload::Act { .. } => {}
            }
        }
    }

}

/// The node previews of the inputs that applied, in submission order.
pub fn previews(
    planned: &[Submitted],
) -> impl Iterator<Item = &sim_core::underworld::nodes::NodeSpec> {
    planned
        .iter()
        .filter(|entry| entry.result.is_ok())
        .filter_map(|entry| entry.preview.as_ref())
}

/// Whether the Player_Soul was placed by R8.1 in this tick: it left the queue without an
/// applied claim and without a birth that gave it a body.
pub fn forced_placement(before: &World, after: &World, planned: &[Submitted]) -> bool {
    if before.player_wait().is_none() || after.player_wait().is_some() {
        return false;
    }
    let claimed = planned.iter().any(|entry| {
        entry.result.is_ok() && matches!(entry.payload, InputPayload::ClaimSlot { .. })
    });
    if claimed {
        return false;
    }
    // A claimed Birth_Slot birth also ends the wait; it appends a `birth` Event for the
    // new body.
    let player = after.souls().player;
    let born = after.log().events().iter().rev().any(|event| {
        matches!(&event.kind, EventKind::Birth { person }
            if after.persons().get(person).is_some_and(|p| p.soul == player))
            && event.tick == before.tick()
    });
    !born
}

/// The total money of every living balance (R3.5).
pub fn total_money(world: &World) -> u128 {
    world
        .persons()
        .values()
        .filter_map(|person| match person.life {
            Life::Alive { money, .. } => Some(u128::from(money)),
            Life::Dead { .. } => None,
        })
        .sum()
}

/// Asserts that two Worlds agree in every field except `rejections` (Property 14).
pub fn assert_same_except_rejections(a: &World, b: &World) {
    assert_eq!(a.seed(), b.seed(), "seeds differ");
    assert_eq!(a.config(), b.config(), "configs differ");
    assert_eq!(a.params(), b.params(), "params differ");
    assert_eq!(a.tick(), b.tick(), "ticks differ");
    assert_eq!(a.persons(), b.persons(), "persons differ");
    assert_eq!(a.households(), b.households(), "households differ");
    assert_eq!(a.properties(), b.properties(), "properties differ");
    assert_eq!(a.relations(), b.relations(), "relations differ");
    assert_eq!(a.debts(), b.debts(), "debts differ");
    assert_eq!(a.souls(), b.souls(), "souls differ");
    assert_eq!(a.log().events(), b.log().events(), "event logs differ");
    assert_eq!(a.log().digest(), b.log().digest(), "log digests differ");
    assert_eq!(a.last_flows(), b.last_flows(), "flows differ");
    assert_eq!(a.joss(), b.joss(), "joss accounts differ");
    assert_eq!(a.magistrate(), b.magistrate(), "magistrates differ");
    assert_eq!(a.slots(), b.slots(), "birth slots differ");
    assert_eq!(a.player_wait(), b.player_wait(), "player waits differ");
    assert_eq!(a.nodes(), b.nodes(), "node states differ");
}

/// A checksum for a World (Property 16).
pub fn checksum(world: &World) -> Checksum {
    Checksum::of(world)
}

/// The open Birth_Slots of a World, in slot ID order.
pub fn slots(world: &World) -> Vec<BirthSlot> {
    world.slots().values().cloned().collect()
}

/// The waiting Souls of a World and the tick each wait began, in Soul ID order.
pub fn waiting_souls(world: &World) -> Vec<(sim_core::ids::SoulId, Tick)> {
    world
        .souls()
        .places
        .iter()
        .filter_map(|(&soul, place)| match place {
            SoulPlace::Waiting { since } => Some((soul, *since)),
            SoulPlace::Body(_) => None,
        })
        .collect()
}
