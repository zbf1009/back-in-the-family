//! The tick loop (R16.2).
//!
//! [`World::step`] runs the 15 numbered steps with Narrator steps 2c and 13a.
//! "Today" is the world's tick `T` throughout the step.
//!
//! 1. **Reset flows.** `flows = FlowTotals { sources: 0, sinks: 0 }`.
//! 2. **Apply inputs** in `(tick, seq)` order (2a), then **resolve underworld nodes**
//!    (2b), then **resolve yesterday's Player_Node** (2c). Invalid inputs are
//!    recorded in `rejections`. Underworld nodes still resolve in the same tick;
//!    a Player_Node uses exactly the following Choice_Tick.
//! 3. **Outsider releases and the Player_Soul placement** (R11, R8.1): every waiting
//!    Soul other than the Player_Soul whose wait exceeds Max_Wait gets an outsider body,
//!    in Soul ID order; then the Player_Soul is placed in a new Imported_Vessel when its
//!    wait exceeds Player_Max_Wait, releasing any claim (R8.2).
//! 4. **Deaths** (R6, R7): mortality rolls against the state at the start of the step,
//!    then each death is settled in Person ID order.
//! 5. **Offerings** (R2): every Ghost in Person ID order whose Offering_Occasion is
//!    today receives one Offering per eligible offerer in Person ID order; the funeral
//!    of a death in step 4 happens in this same tick.
//! 6. **Births from slots** (R7.5): every open Birth_Slot whose birth tick is today, in
//!    slot ID order, gives birth to the longest-waiting non-player Soul, or to no
//!    newborn when none waits; the slot closes either way.
//! 7. **Birth announcements** (R7.1): one roll per candidate mother in Person ID order,
//!    while the number of waiting Souls (the Player_Soul included) exceeds the number
//!    of open Birth_Slots; a success opens a slot due `birth_lead_days` later.
//! 8. **Marriage** (R4): one world-level roll, then a couple is married.
//! 9. **Loans** (R8): one world-level roll, then a Debt is opened.
//! 10. **Repayments** (R8): for every open Debt in loan Event ID order whose monthly
//!     anniversary is today, a roll and possibly a repayment.
//! 11. **Social events** (R4): `SOCIAL_ROLLS_PER_DAY` world-level rolls, each success
//!     appending one social Event.
//! 12. **Economy**: for every Resident in Person ID order, wage then upkeep.
//! 13. **Relation decay**, only when `T % 30 == 29`: every Relation whose `from` is a
//!     Resident moves one point toward 0, except negative affinity of a vindictive
//!     holder.
//!
//! 13a. **Narrator** observes the completed life-sim/underworld tick.
//! 14. **Advance** `tick` to `T + 1`.
//! 15. **Checksum** of the resulting World.
//!
//! Steps 3 to 13 call the step function of their module (`outsiders`, `death`,
//! `underworld`, `births`, `social`, `economy`); each of those modules documents its
//! step.

use crate::checksum::Checksum;
use crate::events::CausedBy;
use crate::ids::{InputSeq, PersonId, Tick};
use crate::input::{InputOutcome, InputPayload, InputStream, SubmitError, TickInput};
use crate::observations::{CheckedSubmission, Collector, RunUntilStopResult, TickObserver};
use crate::social::apply_social;
use crate::values::Intensity;
use crate::world::{AppendRefused, ConfigError, Life, RejectReason, World, WorldConfig};

impl World {
    /// Runs one tick (including steps 2c and 13a) and returns the checksum of the
    /// resulting state.
    ///
    /// `inputs` must already be in `(tick, seq)` order and are applied as given;
    /// [`Sim::step`] passes exactly [`InputStream::for_tick`].
    ///
    /// # Panics
    /// If the tick counter would overflow `u64`. At 29,200 ticks per 80-year life this
    /// cannot happen in practice, and `step` returns a checksum rather than a `Result`,
    /// so the overflow is a documented panic (like `canon::write_len`) instead of an
    /// error path every caller would have to carry.
    pub fn step(&mut self, inputs: &[TickInput]) -> Checksum {
        self.step_with_outcomes(inputs).0
    }

    /// Runs one tick like [`World::step`] and also returns the outcome of every input in
    /// `(tick, seq)` order (R11.5).
    ///
    /// The vector is a return value, not World state: it is never encoded, never
    /// checksummed and never stored in the World (LS-R16.5).
    pub fn step_with_outcomes(&mut self, inputs: &[TickInput]) -> (Checksum, Vec<InputOutcome>) {
        self.step_observing_inputs(inputs, &mut |_: &World, _: &TickInput| {})
    }

    fn step_observing_inputs(
        &mut self,
        inputs: &[TickInput],
        observer: &mut impl TickObserver,
    ) -> (Checksum, Vec<InputOutcome>) {
        // 1. Reset flows.
        self.flows = crate::economy::FlowTotals::default();
        // 2a. Apply inputs.
        let outcomes = self.apply_inputs_observing(inputs, observer);
        // 2b. Resolve same-tick underworld nodes; 2c. Resolve yesterday's Player_Node.
        crate::underworld::resolve_pending(self);
        crate::narrator::resolve(self);
        crate::intro::update(self);
        // 3. Outsider releases, then the Player_Soul's forced placement (R8.1).
        crate::outsiders::release_outsiders(self);
        crate::underworld::place_player_if_overdue(self);
        // 4. Deaths, inheritance and debts at death.
        crate::death::process_deaths(self);
        crate::intro::update(self);
        // 5. Offerings by the living, including today's funerals.
        crate::underworld::process_offerings(self);
        // 6. Births from open Birth_Slots.
        crate::births::process_slot_births(self);
        // 7. Birth announcements.
        crate::births::process_announcements(self);
        // 8. Marriage.
        crate::social::process_marriage(self);
        // 9. Loans.
        crate::economy::process_loans(self);
        // 10. Repayments.
        crate::economy::process_repayments(self);
        // 11. Social events.
        crate::social::process_social_events(self);
        // 12. Economy: wages and upkeep.
        crate::economy::process_economy(self);
        // 13. Relation decay.
        crate::social::process_relation_decay(self);
        // 13a. Narrator observes the completed life-sim/underworld tick.
        crate::narrator::run(self);
        crate::intro::update(self);
        // 14. Advance the tick.
        self.tick = Tick(
            self.tick
                .0
                .checked_add(1)
                .expect("tick counter overflow (u64) — unreachable in any realistic run"),
        );
        // 15. Checksum.
        (Checksum::of(self), outcomes)
    }

    /// Test-only view of the state at the boundary before step 5. The inputs and
    /// deaths have already applied; offerings and later changes have not.
    #[cfg(any(test, feature = "test-support"))]
    pub fn before_offerings(&self, inputs: &[TickInput]) -> Self {
        let mut world = self.clone();
        world.flows = crate::economy::FlowTotals::default();
        world.apply_inputs(inputs);
        crate::underworld::resolve_pending(&mut world);
        crate::outsiders::release_outsiders(&mut world);
        crate::underworld::place_player_if_overdue(&mut world);
        crate::death::process_deaths(&mut world);
        world
    }

    /// Test-only view after step 5, for checking that offerings move no money.
    #[cfg(any(test, feature = "test-support"))]
    pub fn after_offerings(&self) -> Self {
        let mut world = self.clone();
        crate::underworld::process_offerings(&mut world);
        world
    }

    /// Test-only baseline for the body's own trait draws without a stored carry-over.
    #[cfg(any(test, feature = "test-support"))]
    pub fn without_carry_over(&self) -> Self {
        let mut world = self.clone();
        if let Some(wait) = world.player_wait.as_mut() {
            wait.carry_over = None;
        }
        world
    }

    /// Test-only state after the last input and all its same-tick node rulings.
    #[cfg(any(test, feature = "test-support"))]
    pub fn after_inputs_and_nodes(&self, inputs: &[TickInput]) -> (Self, Vec<InputOutcome>) {
        let mut world = self.clone();
        world.flows = crate::economy::FlowTotals::default();
        let outcomes = world.apply_inputs(inputs);
        crate::underworld::resolve_pending(&mut world);
        (world, outcomes)
    }

    #[cfg(any(test, feature = "test-support"))]
    fn apply_inputs(&mut self, inputs: &[TickInput]) -> Vec<InputOutcome> {
        self.apply_inputs_observing(inputs, &mut |_: &World, _: &TickInput| {})
    }

    fn apply_inputs_observing(
        &mut self,
        inputs: &[TickInput],
        observer: &mut impl TickObserver,
    ) -> Vec<InputOutcome> {
        let mut outcomes = Vec::with_capacity(inputs.len());
        for input in inputs {
            let result = self.apply_one(input.seq, input.payload);
            if let Err(reason) = result {
                self.rejections.record(self.tick, input.seq, reason);
            } else {
                // Observe the exact applied prefix, including the frozen node, without
                // storing provenance in World or re-running legality/default logic.
                observer.applied(self, input);
            }
            outcomes.push(InputOutcome {
                seq: input.seq,
                result,
            });
        }
        outcomes
    }

    /// Validates and applies one payload (design "Inputs"): the `Act` checks are actor
    /// and target exist, both are alive, they differ, the intensity is 1..=100; the
    /// underworld kinds run the check tables of design "Inputs". `seq` is the input's
    /// submission number, which a fired node records as its trigger (OP-U12 A).
    fn apply_one(&mut self, seq: InputSeq, payload: InputPayload) -> Result<(), RejectReason> {
        match payload {
            InputPayload::Act {
                kind,
                actor,
                target,
                intensity,
            } => {
                let intensity = validate_act(self, actor, target, intensity)?;
                match apply_social(self, kind, actor, target, intensity, CausedBy::default()) {
                    Ok(_) => Ok(()),
                    Err(AppendRefused::IdExhausted) => Err(RejectReason::IdExhausted),
                    Err(_other) => {
                        // Unreachable: validation above guarantees existing, living,
                        // distinct actors and no causes, so only counter exhaustion can
                        // refuse a validated input.
                        Err(RejectReason::IdExhausted)
                    }
                }
            }
            InputPayload::ClaimSlot {
                slot,
                customization,
            } => crate::underworld::slots::claim(self, slot, customization),
            InputPayload::CarryOver { trait_name } => {
                crate::underworld::player::store_carry_over(self, trait_name)
            }
            InputPayload::Dream { dreamer, intent } => {
                crate::underworld::dreams::apply(self, seq, dreamer, intent)
            }
            InputPayload::Haunt { target } => crate::underworld::hauntings::apply(self, target),
            InputPayload::Bribe { amount } => {
                crate::underworld::magistrate::apply(self, seq, amount)
            }
            InputPayload::Choose {
                node,
                option,
                fingerprint: _, // Input provenance never participates in resolution.
            } => crate::underworld::nodes::attach_choice(self, node, option),
            InputPayload::ChoosePlayer { node, option } => {
                crate::narrator::attach_choice(self, node, option)
            }
        }
    }
}

/// The validation order of design "Inputs and replay format".
fn validate_act(
    world: &World,
    actor: PersonId,
    target: PersonId,
    intensity: u8,
) -> Result<Intensity, RejectReason> {
    // R15.9: any Person field naming the Magistrate is rejected before any other check.
    if actor == world.magistrate().id || target == world.magistrate().id {
        return Err(RejectReason::OfficialPerson);
    }
    let (Some(actor_person), Some(target_person)) =
        (world.persons.get(&actor), world.persons.get(&target))
    else {
        return Err(RejectReason::UnknownPerson);
    };
    if matches!(actor_person.life, Life::Dead { .. })
        || matches!(target_person.life, Life::Dead { .. })
    {
        return Err(RejectReason::DeadPerson);
    }
    if actor == target {
        return Err(RejectReason::SelfTarget);
    }
    Intensity::new(intensity).ok_or(RejectReason::IntensityOutOfRange)
}

/// Why [`Sim::new`] failed.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SimError {
    /// The world config is invalid, or Opening_World generation failed.
    Config(ConfigError),
}

impl std::fmt::Display for SimError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(e) => write!(f, "invalid world config: {e}"),
        }
    }
}

impl std::error::Error for SimError {}

impl From<ConfigError> for SimError {
    fn from(e: ConfigError) -> Self {
        Self::Config(e)
    }
}

/// Driver tying a [`World`] to its [`InputStream`] and recording every tick's checksum.
#[derive(Clone, Debug)]
pub struct Sim {
    world: World,
    inputs: InputStream,
    checksums: Vec<Checksum>,
    last_outcomes: Vec<InputOutcome>,
    last_stops: crate::stops::StopSet,
}

impl Sim {
    pub fn new(seed: u64, config: WorldConfig) -> Result<Self, SimError> {
        Ok(Self {
            world: World::new(seed, config)?,
            inputs: InputStream::new(),
            checksums: Vec::new(),
            last_outcomes: Vec::new(),
            last_stops: crate::stops::StopSet::default(),
        })
    }

    /// Creates the simulation with explicit Params (tests and property tests only).
    #[cfg(any(test, feature = "test-support"))]
    pub fn new_with_params(
        seed: u64,
        config: WorldConfig,
        params: crate::params::Params,
    ) -> Result<Self, SimError> {
        Ok(Self {
            world: World::new_with_params(seed, config, params)?,
            inputs: InputStream::new(),
            checksums: Vec::new(),
            last_outcomes: Vec::new(),
            last_stops: crate::stops::StopSet::default(),
        })
    }

    /// Submits an input for `tick` (the current tick or later).
    pub fn submit(&mut self, tick: Tick, payload: InputPayload) -> Result<InputSeq, SubmitError> {
        self.inputs.submit(self.world.tick(), tick, payload)
    }

    /// Runs the current tick, returning and recording its checksum and stop reasons.
    pub fn step(&mut self) -> Checksum {
        self.step_observing_inputs(&mut |_: &World, _: &TickInput| {})
    }

    /// Replay tooling observes successful inputs immediately after their application.
    /// The observer is read-only and never changes counters, draws or canonical state.
    pub(crate) fn step_observing_inputs(&mut self, observer: &mut impl TickObserver) -> Checksum {
        let before_place = self
            .world
            .souls()
            .places
            .get(&self.world.souls().player)
            .copied();
        let resolved = self.world.nodes().resolved.len();
        let tick = self.world.tick();
        let (checksum, outcomes) = self
            .world
            .step_observing_inputs(self.inputs.for_tick(tick), observer);
        self.last_outcomes = outcomes;
        self.last_stops = crate::stops::stops_for(before_place, &self.world, tick, resolved);
        self.checksums.push(checksum);
        observer.completed(&self.world, self.inputs.for_tick(tick), &self.last_outcomes);
        checksum
    }

    /// Stop reasons from the last stepped tick. This read changes no World state.
    pub fn last_stops(&self) -> crate::stops::StopSet {
        self.last_stops
    }

    /// Runs up to `max` ticks, stopping on the tick that first produces any stop.
    pub fn run_until_stop(&mut self, max: u32) -> crate::stops::RunUntilStop {
        self.run_observing(max, &mut |_: &World, _: &TickInput| {})
    }

    /// Runs the same loop with transient per-input and player-lifecycle observations.
    pub fn run_until_stop_observed(&mut self, max: u32) -> RunUntilStopResult {
        let mut collector = Collector::new(&self.world);
        let run = self.run_observing(max, &mut collector);
        collector.finish(run)
    }

    fn run_observing(
        &mut self,
        max: u32,
        observer: &mut impl TickObserver,
    ) -> crate::stops::RunUntilStop {
        let mut ran = 0;
        while ran < max {
            let checksum = self.step_observing_inputs(observer);
            ran = ran
                .checked_add(1)
                .expect("run count cannot exceed u32::MAX");
            if self.last_stops.any() {
                return crate::stops::RunUntilStop {
                    ran,
                    checksum: Some(checksum),
                    stops: self.last_stops,
                };
            }
        }
        crate::stops::RunUntilStop {
            ran,
            checksum: self.checksums.last().copied(),
            stops: crate::stops::StopSet::default(),
        }
    }

    /// Previews the Decision_Node `payload` would fire on the current tick (design
    /// "Decision_Node convention", "Seam for the decision model").
    ///
    /// Clones the World, runs step 1 and step 2a for the inputs already submitted for
    /// the current tick, then applies `payload` with the next `seq`. The run is
    /// unchanged: no Checksum, no input, no rejection and no World state change.
    pub fn preview_node(
        &self,
        payload: InputPayload,
    ) -> Result<crate::underworld::nodes::NodeSpec, crate::underworld::nodes::PreviewError> {
        use crate::underworld::nodes::{NodeSpec, PreviewError};

        let seq = self.inputs.next_seq();
        // The counter must be able to advance for this sequence to be assigned.
        if seq.0 == u64::MAX {
            return Err(PreviewError::Rejected(RejectReason::IdExhausted));
        }

        let mut world = self.world.clone();
        world.flows = crate::economy::FlowTotals::default();
        for input in self.inputs.for_tick(world.tick) {
            let _ = world.apply_one(input.seq, input.payload);
        }
        world
            .apply_one(seq, payload)
            .map_err(PreviewError::Rejected)?;
        let node = world
            .nodes
            .pending
            .values()
            .find(|node| node.trigger == seq)
            .ok_or(PreviewError::NoNode)?;
        Ok(NodeSpec {
            family: node.family,
            trigger: node.trigger,
            context: node.context.clone(),
            options: node.options.clone(),
            rules_default: node.rules_default,
        })
    }

    /// The outcome of every input of the last stepped tick, in `(tick, seq)` order
    /// (R11.5). Empty before the first step and after a tick with no inputs; it is never
    /// part of the World or the checksum.
    pub fn last_outcomes(&self) -> &[InputOutcome] {
        &self.last_outcomes
    }

    pub fn world(&self) -> &World {
        &self.world
    }

    pub fn inputs(&self) -> &InputStream {
        &self.inputs
    }

    /// The checksum of every tick run so far, in tick order.
    pub fn checksums(&self) -> &[Checksum] {
        &self.checksums
    }
}

impl Sim {
    /// Atomically validates and queues all inputs for the current tick.
    pub fn try_submit_all(
        &mut self,
        payloads: &[InputPayload],
    ) -> Result<Vec<InputSeq>, (usize, RejectReason)> {
        let tick = self.world.tick();
        let mut preview = self.world.clone();
        preview.flows = crate::economy::FlowTotals::default();
        for input in self.inputs.for_tick(tick) {
            let _ = preview.apply_one(input.seq, input.payload);
        }
        let start_seq = self.inputs.next_seq().0;
        for (index, &payload) in payloads.iter().enumerate() {
            let seq = start_seq
                .checked_add(u64::try_from(index).unwrap_or(u64::MAX))
                .filter(|&seq| seq != u64::MAX)
                .map(InputSeq)
                .ok_or((index, RejectReason::IdExhausted))?;
            preview
                .apply_one(seq, payload)
                .map_err(|reason| (index, reason))?;
        }
        let mut seqs = Vec::with_capacity(payloads.len());
        for &payload in payloads {
            let seq = self
                .inputs
                .submit(tick, tick, payload)
                .expect("preflighted sequence capacity");
            seqs.push(seq);
        }
        Ok(seqs)
    }

    /// Checked admission with its actual allocation exposed as a typed wire receipt.
    pub fn submit_checked(&mut self, payloads: &[InputPayload]) -> CheckedSubmission {
        let tick = self.world.tick();
        CheckedSubmission::from_result(tick, self.try_submit_all(payloads))
    }

    /// The pending Player_Node and whether its accepted choice is queued for its Choice_Tick.
    pub fn player_node_state(&self) -> Option<(crate::ids::NodeId, bool)> {
        let node = self.world.narrator().pending.as_ref()?;
        let answered = self.inputs.for_tick(self.world.tick()).iter().any(|input| {
            matches!(input.payload, InputPayload::ChoosePlayer { node: id, option } if id == node.id && node.options.iter().any(|planned| planned.id == option))
        });
        Some((node.id, answered))
    }
}

#[cfg(any(test, feature = "test-support"))]
impl Sim {
    /// Construct a Sim around a prepared World for pure status-vs-submit tests.
    pub fn from_test_world(world: World) -> Self {
        Self {
            world,
            inputs: InputStream::new(),
            checksums: Vec::new(),
            last_outcomes: Vec::new(),
            last_stops: crate::stops::StopSet::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::IdCounter;
    use crate::input::InputOutcome;
    use crate::underworld::dreams::DreamIntent;
    use crate::underworld::nodes::{ChoiceSource, PreviewError};
    use crate::values::SocialKind;
    use proptest::prelude::*;

    fn sim() -> Sim {
        Sim::new(42, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    /// A Sim whose Player_Soul died at tick 0 and waits with joss paper. Returns the
    /// Sim, the Ghost's body and a living Connected_Person of it.
    fn waiting_sim() -> (Sim, PersonId, PersonId) {
        use crate::underworld::ghosts::connected;

        let mut s = Sim::new_with_params(
            22,
            WorldConfig::try_new(40).unwrap(),
            crate::params::Params::DEFAULT,
        )
        .unwrap();
        let player = s.world.souls.player;
        let tick = s.world.tick;
        let body = crate::testing::prepare_player_wait(&mut s.world, tick, None, None);
        if let Some(account) = s.world.joss.get_mut(&player) {
            account.balance = 100;
        }
        let dreamer = connected(&s.world, body)
            .into_iter()
            .next()
            .expect("the Opening_World leaves a kin Relation");
        (s, body, dreamer)
    }

    #[test]
    fn checked_submission_rejects_whole_batch_without_mutation() {
        use crate::underworld::carry_over::TraitName;
        use crate::underworld::slots::SlotRef;
        let (mut sim, _, _) = waiting_sim();
        let before_world = sim.world.clone();
        let before_inputs = sim.inputs.clone();
        assert_eq!(
            sim.try_submit_all(&[
                InputPayload::CarryOver {
                    trait_name: TraitName::Piety
                },
                InputPayload::ClaimSlot {
                    slot: SlotRef::RebuiltBody,
                    customization: None
                },
            ]),
            Err((1, RejectReason::BadCustomization))
        );
        assert_eq!(sim.world, before_world);
        assert_eq!(sim.inputs, before_inputs);
        assert_eq!(
            sim.try_submit_all(&[InputPayload::CarryOver {
                trait_name: TraitName::Piety
            }]),
            Ok(vec![InputSeq(0)])
        );
        assert_eq!(
            sim.world, before_world,
            "accepted inputs stay pending until step 2a"
        );
        assert_eq!(
            sim.world.player_wait().unwrap().rebuilt_draw,
            before_world.player_wait().unwrap().rebuilt_draw
        );
    }

    #[test]
    fn stop_on_tick_and_reset_after_next_step() {
        let (mut sim, _, dreamer) = waiting_sim();
        sim.submit(
            Tick(0),
            InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Warn,
            },
        )
        .unwrap();
        let result = sim.run_until_stop(20);
        assert_eq!(result.ran, 1);
        assert!(result.stops.dream_resolved);
        assert_eq!(sim.world.tick(), Tick(1));
        assert_eq!(sim.checksums().len(), 1);
        assert_eq!(sim.last_stops(), result.stops);
        let next = sim.run_until_stop(1);
        assert_eq!(next.ran, 1);
        assert!(!next.stops.dream_resolved);
        assert_eq!(sim.checksums().len(), 2);
    }

    #[test]
    fn pending_choice_state_reads_input_stream_not_world() {
        use crate::narrator::{
            PlannedOption, PlayerFamily, PlayerNode, PlayerOption, StakeUnit, Stakes,
        };
        let mut sim = sim();
        let body = match sim.world.souls.places[&sim.world.souls.player] {
            crate::world::SoulPlace::Body(id) => id,
            _ => unreachable!(),
        };
        sim.world.tick = Tick(1);
        sim.world.narrator.pending = Some(PlayerNode {
            id: crate::ids::NodeId(17),
            family: PlayerFamily::DebtDue,
            chooser: body,
            fired: Tick(0),
            stakes: Stakes {
                who: vec![body],
                amount: 1,
                unit: StakeUnit::Money,
                by: Tick(1),
            },
            options: vec![
                PlannedOption {
                    id: PlayerOption::IgnoreIt,
                    parts: vec![],
                    preview: vec![],
                },
                PlannedOption {
                    id: PlayerOption::AskForTime,
                    parts: vec![],
                    preview: vec![],
                },
            ],
            rules_default: PlayerOption::IgnoreIt,
            external: None,
            trigger: None,
        });
        let node = crate::ids::NodeId(17);
        assert_eq!(sim.player_node_state(), Some((node, false)));
        let before = crate::checksum::Checksum::of(sim.world());
        assert_eq!(
            sim.try_submit_all(&[InputPayload::ChoosePlayer {
                node,
                option: PlayerOption::RepayNow,
            }]),
            Err((0, RejectReason::OptionNotInSet))
        );
        assert_eq!(sim.player_node_state(), Some((node, false)));
        assert!(sim.inputs().all().is_empty());
        assert_eq!(crate::checksum::Checksum::of(sim.world()), before);
        assert_eq!(
            sim.try_submit_all(&[InputPayload::ChoosePlayer {
                node,
                option: PlayerOption::AskForTime,
            }]),
            Ok(vec![InputSeq(0)])
        );
        assert_eq!(sim.player_node_state(), Some((node, true)));
        assert_eq!(crate::checksum::Checksum::of(sim.world()), before);
        assert!(
            sim.world
                .narrator
                .pending
                .as_ref()
                .unwrap()
                .external
                .is_none()
        );
        assert_eq!(
            sim.try_submit_all(&[InputPayload::ChoosePlayer {
                node,
                option: PlayerOption::IgnoreIt,
            }]),
            Err((0, RejectReason::AlreadyChosen))
        );
        assert_eq!(sim.player_node_state(), Some((node, true)));
        sim.step();
        assert_eq!(sim.player_node_state(), None);
    }

    #[test]
    fn simultaneous_death_and_node_reasons_are_preserved() {
        use crate::narrator::{
            PlannedOption, PlayerFamily, PlayerNode, PlayerOption, StakeUnit, Stakes,
        };
        let mut sim = sim();
        let player = sim.world.souls.player;
        let crate::world::SoulPlace::Body(body) = sim.world.souls.places[&player] else {
            unreachable!()
        };
        let before_place = Some(crate::world::SoulPlace::Body(body));
        sim.world
            .souls
            .places
            .insert(player, crate::world::SoulPlace::Waiting { since: Tick(0) });
        sim.world.narrator.pending = Some(PlayerNode {
            id: crate::ids::NodeId(17),
            family: PlayerFamily::DebtDue,
            chooser: body,
            fired: Tick(0),
            stakes: Stakes {
                who: vec![body],
                amount: 1,
                unit: StakeUnit::Money,
                by: Tick(1),
            },
            options: vec![PlannedOption {
                id: PlayerOption::IgnoreIt,
                parts: vec![],
                preview: vec![],
            }],
            rules_default: PlayerOption::IgnoreIt,
            external: None,
            trigger: None,
        });
        let stops = crate::stops::stops_for(
            before_place,
            &sim.world,
            Tick(0),
            sim.world.nodes().resolved.len(),
        );
        assert_eq!(stops.labels(), ["player_node", "player_died"]);
    }

    #[test]
    fn dream_and_rebirth_stop_together_without_an_extra_tick() {
        let (mut sim, _, dreamer) = waiting_sim();
        let player = sim.world.souls.player;
        sim.world.joss.get_mut(&player).unwrap().balance = 200;
        sim.world.player_wait.as_mut().unwrap().access_from = Tick(0);
        sim.try_submit_all(&[
            InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Warn,
            },
            InputPayload::ClaimSlot {
                slot: crate::underworld::slots::SlotRef::ImportedVessel,
                customization: None,
            },
        ])
        .unwrap();
        let stopped = sim.run_until_stop(20);
        assert_eq!(stopped.ran, 1);
        assert_eq!(stopped.stops.labels(), ["dream_resolved", "player_reborn"]);
        assert_eq!(sim.world.tick(), Tick(1));
        assert_eq!(sim.checksums().len(), 1);
        assert!(
            sim.last_outcomes()
                .iter()
                .all(|outcome| outcome.result.is_ok())
        );
        assert_eq!(sim.run_until_stop(0).ran, 0);
        assert_eq!(sim.last_stops(), stopped.stops);
        sim.step();
        assert!(!sim.last_stops().dream_resolved);
        assert!(!sim.last_stops().player_reborn);
    }

    #[test]
    fn player_death_stops_on_the_death_tick() {
        let mut params = crate::params::Params::DEFAULT;
        params.mortality_ppm_by_age = [1_000_000; 120];
        params.mortality_floor_ppm = 1_000_000;
        let mut sim = Sim::new_with_params(42, WorldConfig::default(), params).unwrap();
        let stopped = sim.run_until_stop(20);
        assert_eq!(stopped.ran, 1);
        assert!(stopped.stops.player_died);
        assert_eq!(sim.world.tick(), Tick(1));
        assert_eq!(sim.checksums().len(), 1);
    }

    #[test]
    fn rebirth_and_immediate_death_stop_on_the_same_tick() {
        let (mut sim, previous_body, _) = waiting_sim();
        let tick = Tick(1);
        sim.world.tick = tick;
        sim.world.params.mortality_ppm_by_age = [1_000_000; 120];
        sim.world.params.mortality_floor_ppm = 1_000_000;
        sim.world.player_wait.as_mut().unwrap().access_from = tick;
        let seq = sim
            .try_submit_all(&[InputPayload::ClaimSlot {
                slot: crate::underworld::slots::SlotRef::ImportedVessel,
                customization: None,
            }])
            .unwrap()[0];

        let stopped = sim.run_until_stop(20);
        assert_eq!(stopped.ran, 1);
        assert_eq!(stopped.stops.labels(), ["player_died", "player_reborn"]);
        assert_eq!(sim.world.tick(), Tick(2));
        assert_eq!(sim.checksums().len(), 1);
        assert_eq!(sim.last_stops(), stopped.stops);
        assert_eq!(
            sim.last_outcomes(),
            &[InputOutcome {
                seq,
                result: Ok(()),
            }]
        );
        let player = sim.world.souls.player;
        assert_eq!(
            sim.world.souls.places[&player],
            crate::world::SoulPlace::Waiting { since: tick }
        );
        let new_body = sim.world.player_wait().unwrap().ghost;
        assert_ne!(new_body, previous_body);
        assert_eq!(
            sim.world.persons[&new_body].life,
            Life::Dead { death: tick }
        );
    }

    fn checked_payload(sim: &Sim, selector: u8, raw: u8) -> InputPayload {
        use crate::underworld::carry_over::TraitName;
        use crate::underworld::customization::Customization;
        use crate::underworld::nodes::{NodeOption, NodeRef};
        use crate::underworld::slots::SlotRef;

        let (actor, target) = two_residents(sim);
        let dreamer = sim
            .world
            .player_wait()
            .and_then(|wait| {
                crate::underworld::ghosts::connected(sim.world(), wait.ghost)
                    .into_iter()
                    .next()
            })
            .unwrap_or(PersonId(target));
        match selector % 12 {
            0 => act(actor, target, raw),
            1 => act(u64::MAX, target, raw),
            2 => InputPayload::CarryOver {
                trait_name: TraitName::ALL[usize::from(raw) % 7],
            },
            3 => InputPayload::ClaimSlot {
                slot: SlotRef::ImportedVessel,
                customization: None,
            },
            4 => InputPayload::ClaimSlot {
                slot: SlotRef::RebuiltBody,
                customization: Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: i8::try_from(raw % 11).unwrap().saturating_sub(5),
                }),
            },
            5 => InputPayload::ClaimSlot {
                slot: SlotRef::Birth(crate::ids::BirthSlotId(u64::from(raw))),
                customization: None,
            },
            6 => InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Warn,
            },
            7 => InputPayload::Haunt { target: dreamer },
            8 => InputPayload::Bribe {
                amount: u64::from(raw),
            },
            9 => InputPayload::ChoosePlayer {
                node: sim
                    .world
                    .narrator()
                    .pending
                    .as_ref()
                    .map_or(crate::ids::NodeId(0), |n| n.id),
                option: sim
                    .world
                    .narrator()
                    .pending
                    .as_ref()
                    .map_or(crate::narrator::PlayerOption::IgnoreIt, |n| n.rules_default),
            },
            10 => InputPayload::ChoosePlayer {
                node: crate::ids::NodeId(u64::MAX),
                option: crate::narrator::PlayerOption::RepayNow,
            },
            _ => InputPayload::Choose {
                node: NodeRef::Trigger {
                    seq: sim.inputs.next_seq(),
                },
                option: NodeOption::TakeComfort,
                fingerprint: None,
            },
        }
    }

    // Feature: first-playable, Property 16: Checked submission is exact
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_16_checked_submission_matches_real_step(
            seed in any::<u64>(), mode in 0u8..3, balance in 0u64..700,
            existing in prop::collection::vec((0u8..12,any::<u8>()),0..5),
            proposed in prop::collection::vec((0u8..12,any::<u8>()),0..10),
        ) {
            let mut sim = if mode == 1 { waiting_sim().0 } else {
                Sim::new(seed,WorldConfig::default()).unwrap()
            };
            if mode == 1 {
                let player = sim.world.souls.player;
                sim.world.joss.get_mut(&player).unwrap().balance = balance;
                sim.world.player_wait.as_mut().unwrap().access_from = Tick(balance % 2);
            } else if mode == 2 {
                let mut params = sim.world.params;
                params.first_interrupt_min = 0;
                sim = Sim::new_with_params(seed,WorldConfig::default(),params).unwrap();
                let crate::world::SoulPlace::Body(body) = sim.world.souls.places[&sim.world.souls.player] else { unreachable!() };
                let other = sim.world.persons.values().find(|p| p.id != body && matches!(p.life,Life::Alive{..})).unwrap().id;
                let due = Tick(sim.world.params.debt_due_lead);
                crate::testing::add_test_debt(&mut sim.world,body,other,due,100);
                sim.step();
            }
            for (selector,raw) in existing {
                let payload = checked_payload(&sim,selector,raw);
                sim.submit(sim.world.tick(),payload).unwrap();
            }
            let payloads: Vec<_> = proposed.into_iter().map(|(selector,raw)|checked_payload(&sim,selector,raw)).collect();
            let before = sim.clone();
            let mut reference = sim.clone();
            let offset = reference.inputs.for_tick(reference.world.tick()).len();
            for &payload in &payloads { reference.submit(reference.world.tick(),payload).unwrap(); }
            let expected_checksum = reference.step();
            let first_failure = reference.last_outcomes()[offset..].iter().enumerate()
                .find_map(|(index,outcome)|outcome.result.err().map(|reason|(index,reason)));
            let result = sim.try_submit_all(&payloads);
            prop_assert_eq!(&sim.world,&before.world);
            prop_assert_eq!(&sim.checksums,&before.checksums);
            prop_assert_eq!(&sim.last_outcomes,&before.last_outcomes);
            prop_assert_eq!(sim.last_stops,before.last_stops);
            match (result,first_failure) {
                (Ok(seqs),None) => {
                    prop_assert_eq!(seqs.len(),payloads.len());
                    prop_assert_eq!(sim.step(),expected_checksum);
                    prop_assert!(sim.last_outcomes()[offset..].iter().all(|outcome|outcome.result.is_ok()));
                    prop_assert_eq!(sim.inputs(),reference.inputs());
                },
                (Err(actual),Some(expected)) => {
                    prop_assert_eq!(actual,expected);
                    prop_assert_eq!(sim.inputs(),before.inputs());
                    prop_assert_eq!(sim.player_node_state(),before.player_node_state());
                },
                (actual,expected) => prop_assert!(false,"checked result {actual:?} differs from real failure {expected:?}"),
            }
        }
    }

    fn act(actor: u64, target: u64, intensity: u8) -> InputPayload {
        InputPayload::Act {
            kind: SocialKind::Help,
            actor: PersonId(actor),
            target: PersonId(target),
            intensity,
        }
    }

    fn two_residents(sim: &Sim) -> (u64, u64) {
        let ids: Vec<u64> = sim
            .world()
            .persons()
            .values()
            .filter(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id.0)
            .collect();
        (ids[0], ids[1])
    }

    #[test]
    fn a_valid_act_changes_the_checksum_and_the_relations() {
        let mut with = sim();
        let mut without = sim();
        let (a, b) = two_residents(&with);
        with.submit(Tick(0), act(a, b, 40)).unwrap();
        let ca = with.step();
        let cb = without.step();
        assert_ne!(ca, cb, "R1.4: a valid Act changes the checksum");
        assert_eq!(with.world().rejections().last, None);
        assert!(
            with.world()
                .relations()
                .contains_key(&(PersonId(a), PersonId(b)))
        );
    }

    #[test]
    fn an_unknown_person_is_rejected() {
        let mut s = sim();
        let (a, _) = two_residents(&s);
        s.submit(Tick(0), act(a, u64::MAX, 40)).unwrap();
        s.step();
        assert_eq!(
            s.world().rejections().last,
            Some((Tick(0), InputSeq(0), RejectReason::UnknownPerson))
        );
    }

    #[test]
    fn an_act_naming_the_magistrate_is_rejected_official_person() {
        for as_actor in [true, false] {
            let mut s = sim();
            let (a, _) = two_residents(&s);
            let magistrate = s.world().magistrate().id.0;
            let payload = if as_actor {
                act(magistrate, a, 40)
            } else {
                act(a, magistrate, 40)
            };
            s.submit(Tick(0), payload).unwrap();
            s.step();
            assert_eq!(
                s.world().rejections().last,
                Some((Tick(0), InputSeq(0), RejectReason::OfficialPerson)),
                "as_actor {as_actor}"
            );
        }
    }

    #[test]
    fn a_dead_person_is_rejected() {
        let mut s = sim();
        let (a, b) = two_residents(&s);
        if let Some(person) = s.world.persons.get_mut(&PersonId(b)) {
            person.life = Life::Dead { death: Tick(0) };
        }
        s.submit(Tick(0), act(a, b, 40)).unwrap();
        s.step();
        assert_eq!(
            s.world().rejections().last,
            Some((Tick(0), InputSeq(0), RejectReason::DeadPerson))
        );
    }

    #[test]
    fn a_self_target_is_rejected() {
        let mut s = sim();
        let (a, _) = two_residents(&s);
        s.submit(Tick(0), act(a, a, 40)).unwrap();
        s.step();
        assert_eq!(
            s.world().rejections().last,
            Some((Tick(0), InputSeq(0), RejectReason::SelfTarget))
        );
    }

    #[test]
    fn an_out_of_range_intensity_is_rejected() {
        for intensity in [0u8, 101, 255] {
            let mut s = sim();
            let (a, b) = two_residents(&s);
            s.submit(Tick(0), act(a, b, intensity)).unwrap();
            s.step();
            assert_eq!(
                s.world().rejections().last,
                Some((Tick(0), InputSeq(0), RejectReason::IntensityOutOfRange)),
                "intensity {intensity}"
            );
        }
    }

    #[test]
    fn an_exhausted_event_counter_rejects_the_act() {
        let mut s = sim();
        let (a, b) = two_residents(&s);
        s.world.log.exhaust_ids();
        s.submit(Tick(0), act(a, b, 40)).unwrap();
        s.step();
        assert_eq!(
            s.world().rejections().last,
            Some((Tick(0), InputSeq(0), RejectReason::IdExhausted))
        );
    }

    #[test]
    fn an_invalid_input_leaves_the_world_as_if_it_was_absent() {
        let mut with = sim();
        let mut without = sim();
        let (a, _) = two_residents(&with);
        with.submit(Tick(3), act(a, u64::MAX, 40)).unwrap();
        for _ in 0..5 {
            with.step();
            without.step();
        }
        assert_eq!(with.world().persons(), without.world().persons());
        assert_eq!(with.world().relations(), without.world().relations());
        assert_eq!(with.world().log(), without.world().log());
        assert_ne!(with.world().rejections(), without.world().rejections());
        assert_ne!(with.checksums()[4], without.checksums()[4]);
    }

    #[test]
    fn step_advances_the_tick_by_one_and_records_a_checksum() {
        let mut s = sim();
        assert_eq!(s.world().tick(), Tick(0));
        let c = s.step();
        assert_eq!(s.world().tick(), Tick(1));
        assert_eq!(s.checksums(), [c]);
        // The economy step pays the opening adults' wages and charges their upkeep.
        let flows = s.world().last_flows();
        assert!(flows.sources > 0, "the tick pays wages");
        assert!(flows.sinks > 0, "the tick charges upkeep");
    }

    #[test]
    fn sim_new_rejects_an_invalid_config() {
        let bad = WorldConfig {
            opening_residents: 500,
        };
        assert_eq!(
            Sim::new(1, bad).unwrap_err(),
            SimError::Config(ConfigError::OpeningResidentsOutOfRange {
                opening_residents: 500
            })
        );
    }

    #[test]
    fn sim_submit_rejects_past_ticks_and_leaves_state_unchanged() {
        let mut s = sim();
        let (a, b) = two_residents(&s);
        s.step();
        s.step();
        let (inputs_before, world_before) = (s.inputs().clone(), s.world().clone());
        assert_eq!(
            s.submit(Tick(1), act(a, b, 40)),
            Err(SubmitError::PastTick {
                tick: Tick(1),
                current: Tick(2)
            })
        );
        assert_eq!(*s.inputs(), inputs_before);
        assert_eq!(*s.world(), world_before);
        assert!(s.submit(Tick(2), act(a, b, 40)).is_ok());
    }

    #[test]
    fn last_outcomes_lists_every_input_of_the_last_tick_in_order() {
        let mut s = sim();
        assert!(
            s.last_outcomes().is_empty(),
            "a freshly loaded Sim has no outcomes"
        );
        let (a, b) = two_residents(&s);
        s.submit(Tick(0), act(a, b, 40)).unwrap();
        s.submit(Tick(0), act(a, u64::MAX, 40)).unwrap();
        s.step();
        assert_eq!(
            s.last_outcomes(),
            [
                InputOutcome {
                    seq: InputSeq(0),
                    result: Ok(()),
                },
                InputOutcome {
                    seq: InputSeq(1),
                    result: Err(RejectReason::UnknownPerson),
                },
            ]
        );
        // A tick with no inputs empties the vector again.
        s.step();
        assert!(s.last_outcomes().is_empty());
    }

    #[test]
    fn the_outcome_vector_is_not_world_state_or_checksummed() {
        let mut with = sim();
        let mut without = sim();
        let (a, b) = two_residents(&with);
        let input = TickInput {
            tick: Tick(0),
            seq: InputSeq(0),
            payload: act(a, b, 40),
        };
        let (checksum, outcomes) = with.world.step_with_outcomes(&[input]);
        let plain = without.world.step(&[input]);
        assert_eq!(checksum, plain, "the outcome vector is not checksummed");
        assert_eq!(with.world, without.world, "it is not World state");
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].seq, InputSeq(0));
        assert_eq!(outcomes[0].result, Ok(()));
    }

    #[test]
    fn id_counters_are_not_advanced_by_an_empty_tick_run() {
        let mut s = sim();
        let before = (
            s.world.person_ids.peek(),
            s.world.household_ids.peek(),
            s.world.property_ids.peek(),
            s.world.souls.ids.peek(),
        );
        for _ in 0..10 {
            s.step();
        }
        assert_eq!(
            (
                s.world.person_ids.peek(),
                s.world.household_ids.peek(),
                s.world.property_ids.peek(),
                s.world.souls.ids.peek(),
            ),
            before
        );
        assert_eq!(s.world.person_ids, IdCounter::starting_at(2 + 40));
    }
    #[test]
    fn preview_node_equals_the_fired_node_and_leaves_the_run_unchanged() {
        use crate::underworld::nodes::NodeSpec;

        let (mut s, real_ghost, dreamer) = waiting_sim();
        let payload = InputPayload::Dream {
            dreamer,
            intent: DreamIntent::Warn,
        };
        let world_before = s.world.clone();
        let inputs_before = s.inputs().all().to_vec();
        let checksums_before = s.checksums().to_vec();

        let spec = s.preview_node(payload).expect("a dream fires a node");
        assert_eq!(spec.trigger, s.inputs().next_seq());
        assert_eq!(
            spec.family,
            crate::underworld::nodes::NodeFamily::DreamInterpretation
        );
        assert_eq!(
            spec.context.subject,
            Some(crate::llm::PersonId(i64::try_from(dreamer.0).unwrap()))
        );
        assert_eq!(spec.options.len(), 3);
        let crate::llm::TaskSpec::Decision { options } = &spec.context.spec else {
            panic!("a dream node is a decision context");
        };
        assert_eq!(
            spec.options
                .iter()
                .map(|option| option.id())
                .collect::<Vec<_>>(),
            options
                .iter()
                .map(|def| def.id.as_str())
                .collect::<Vec<_>>()
        );
        assert!(spec.options.contains(&spec.rules_default));
        // The preview changed nothing.
        assert_eq!(s.world, world_before, "a preview changes no state");
        assert_eq!(s.inputs().all(), inputs_before.as_slice());
        assert_eq!(s.checksums(), checksums_before.as_slice());

        // The node the same payload fires when it is submitted for real.
        let seq = s.submit(s.world().tick(), payload).unwrap();
        assert_eq!(seq, spec.trigger);
        s.step();
        assert_eq!(s.world().nodes().resolved.len(), 1);
        let record = s.world().nodes().resolved[0];
        assert_eq!(
            record.family,
            crate::underworld::nodes::NodeFamily::DreamInterpretation
        );
        assert_eq!(record.subject, dreamer);
        assert_eq!(record.rules_default, spec.rules_default);
        assert_eq!(record.applied, spec.rules_default);
        assert_eq!(record.source, ChoiceSource::RulesDefault);
        assert!(real_ghost != dreamer);

        // A second preview of the same payload is identical: the context is frozen from
        // the same World state.
        let (s2, _, _) = waiting_sim();
        let again: NodeSpec = s2.preview_node(payload).unwrap();
        assert_eq!(again, spec);
    }

    #[test]
    fn preview_node_applies_the_inputs_already_submitted_for_the_tick() {
        let (mut s, _ghost, dreamer) = waiting_sim();
        s.submit(
            s.world().tick(),
            InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Warn,
            },
        )
        .unwrap();
        assert_eq!(
            s.preview_node(InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Urge,
            }),
            Err(PreviewError::Rejected(RejectReason::RateLimited))
        );
    }

    #[test]
    fn input_observer_sees_exact_frozen_prefix_without_changing_the_tick() {
        use crate::decision_fingerprint::DecisionFingerprint;
        use crate::underworld::nodes::{NodeRef, NodeSpec};

        for digest in 0..100u8 {
            let (mut sim, _, dreamer) = waiting_sim();
            let tick = sim.world().tick();
            sim.submit(Tick(100), InputPayload::Bribe { amount: 1 })
                .unwrap();
            let mut specs = Vec::new();
            for payload in [
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::Warn,
                },
                InputPayload::Bribe { amount: 1 },
            ] {
                let spec = sim.preview_node(payload).unwrap();
                assert_eq!(sim.submit(tick, payload).unwrap(), spec.trigger);
                specs.push(spec);
            }
            for spec in &specs {
                sim.submit(
                    tick,
                    InputPayload::Choose {
                        node: NodeRef::Trigger { seq: spec.trigger },
                        option: spec.rules_default,
                        fingerprint: Some(DecisionFingerprint::from_bytes([digest; 32])),
                    },
                )
                .unwrap();
            }
            let mut plain = sim.clone();
            let mut observed = Vec::new();
            let checksum = sim.step_observing_inputs(&mut |world: &World, input: &TickInput| {
                if let Some(node) = world
                    .nodes()
                    .pending
                    .values()
                    .find(|node| node.trigger == input.seq)
                {
                    observed.push(NodeSpec {
                        family: node.family,
                        trigger: node.trigger,
                        context: node.context.clone(),
                        options: node.options.clone(),
                        rules_default: node.rules_default,
                    });
                }
            });
            assert_eq!(observed, specs);
            assert_eq!(checksum, plain.step());
            assert_eq!(sim.world(), plain.world());
            assert_eq!(sim.inputs().all(), plain.inputs().all());
            assert_eq!(sim.checksums(), plain.checksums());
            assert_eq!(sim.last_outcomes(), plain.last_outcomes());
            assert_eq!(sim.last_stops(), plain.last_stops());
        }
    }

    #[test]
    fn queued_previews_match_both_nodes_at_firing() {
        let (mut sim, _, dreamer) = waiting_sim();
        let payloads = [
            InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Warn,
            },
            InputPayload::Bribe { amount: 1 },
        ];
        let mut specs = Vec::new();
        for payload in payloads {
            let spec = sim.preview_node(payload).unwrap();
            assert_eq!(sim.try_submit_all(&[payload]), Ok(vec![spec.trigger]));
            specs.push(spec);
        }

        // Observe the real step 2a before 2b consumes the pending nodes.
        let mut world = sim.world.clone();
        world.flows = crate::economy::FlowTotals::default();
        let outcomes = world.apply_inputs(sim.inputs().for_tick(world.tick()));
        assert!(outcomes.iter().all(|outcome| outcome.result.is_ok()));
        assert_eq!(world.nodes().pending.len(), specs.len());
        for (node, spec) in world.nodes().pending.values().zip(specs) {
            assert_eq!(node.trigger, spec.trigger);
            assert_eq!(node.family, spec.family);
            assert_eq!(node.context, spec.context);
            assert_eq!(node.options, spec.options);
            assert_eq!(node.rules_default, spec.rules_default);
        }
    }

    #[test]
    fn preview_node_reports_a_rejected_payload_with_its_reason() {
        let (s, _ghost, _dreamer) = waiting_sim();
        let magistrate = s.world().magistrate().id;
        assert_eq!(
            s.preview_node(InputPayload::Dream {
                dreamer: magistrate,
                intent: DreamIntent::Warn,
            }),
            Err(PreviewError::Rejected(RejectReason::OfficialPerson))
        );
    }

    #[test]
    fn preview_rejects_an_exhausted_input_sequence() {
        use crate::underworld::nodes::PreviewError;

        let (mut sim, _, dreamer) = waiting_sim();
        let payload = InputPayload::Dream {
            dreamer,
            intent: DreamIntent::Warn,
        };
        sim.inputs = InputStream::with_next_seq(u64::MAX);
        assert_eq!(
            sim.try_submit_all(&[payload]),
            Err((0, RejectReason::IdExhausted))
        );
        assert_eq!(
            sim.preview_node(payload),
            Err(PreviewError::Rejected(RejectReason::IdExhausted))
        );
        assert_eq!(sim.inputs.next_seq(), InputSeq(u64::MAX));
        assert!(sim.inputs.all().is_empty());
    }

    #[test]
    fn preview_node_of_a_payload_that_fires_no_node_is_no_node() {
        let (s, _ghost, dreamer) = waiting_sim();
        assert_eq!(
            s.preview_node(InputPayload::Haunt { target: dreamer }),
            Err(PreviewError::NoNode)
        );
    }

    #[test]
    fn checked_receipts_move_real_high_u64_allocations_and_failed_batches_allocate_none() {
        use crate::observations::CheckedSubmission;
        use crate::underworld::carry_over::TraitName;
        let (mut sim, _, _) = waiting_sim();
        sim.world.tick = Tick(1u64 << 54);
        sim.inputs = InputStream::with_next_seq(u64::MAX - 2);
        let payload = InputPayload::CarryOver {
            trait_name: TraitName::Piety,
        };
        let before = sim.inputs.clone();
        let rejected = sim.submit_checked(&[payload, InputPayload::Bribe { amount: 0 }]);
        assert_eq!(
            rejected,
            CheckedSubmission::Rejected {
                index: 1,
                reason: RejectReason::BadAmount
            }
        );
        assert_eq!(sim.inputs, before);
        let accepted = sim.submit_checked(&[payload, payload]);
        let CheckedSubmission::Accepted(receipt) = &accepted else {
            panic!("the batch was accepted")
        };
        assert_eq!(receipt.tick, sim.world.tick());
        assert_eq!(
            receipt.seqs,
            sim.inputs()
                .all()
                .iter()
                .map(|input| input.seq)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            receipt.seqs,
            [InputSeq(u64::MAX - 2), InputSeq(u64::MAX - 1)]
        );
        let wire: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&accepted).unwrap()).unwrap();
        assert_eq!(wire["tick"], (1u64 << 54).to_string());
        assert_eq!(wire["seqs"][1], (u64::MAX - 1).to_string());
        let empty = sim.submit_checked(&[]);
        let CheckedSubmission::Accepted(empty) = empty else {
            panic!("empty batches allocate no sequences")
        };
        assert!(empty.seqs.is_empty());
        let zero = sim.run_until_stop_observed(0);
        assert_eq!(zero.checksum, None);
        assert!(zero.actions.is_empty() && zero.player_lifecycle.is_empty());
    }
}
