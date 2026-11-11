//! The tick loop (R16.2).
//!
//! [`World::step`] runs exactly these 13 steps, in this order, on every tick. "Today"
//! is the world's tick `T` throughout the step.
//!
//! 1. **Reset flows.** `flows = FlowTotals { sources: 0, sinks: 0 }`.
//! 2. **Apply inputs** in `(tick, seq)` order. Each `Act` is validated (R1.5, R6.5) and,
//!    if valid, appended as a social Event through `social::apply_social`. Invalid
//!    inputs are recorded in `rejections` with `(T, seq, reason)`.
//! 3. **Outsider releases** (R11): every waiting Soul other than the Player_Soul whose
//!    wait exceeds Max_Wait gets an outsider body, in Soul ID order.
//! 4. **Deaths** (R6, R7): mortality rolls against the state at the start of the step,
//!    then each death is settled in Person ID order.
//! 5. **Births** (R10): a birth roll per candidate mother in Person ID order, while a
//!    non-player Soul is waiting.
//! 6. **Marriage** (R4): one world-level roll, then a couple is married.
//! 7. **Loans** (R8): one world-level roll, then a Debt is opened.
//! 8. **Repayments** (R8): for every open Debt in loan Event ID order whose monthly
//!    anniversary is today, a roll and possibly a repayment.
//! 9. **Social events** (R4): `SOCIAL_ROLLS_PER_DAY` world-level rolls, each success
//!    appending one social Event.
//! 10. **Economy**: for every Resident in Person ID order, wage then upkeep.
//! 11. **Relation decay**, only when `T % 30 == 29`: every Relation whose `from` is a
//!     Resident moves one point toward 0, except negative affinity of a vindictive
//!     holder.
//! 12. **Advance** `tick` to `T + 1`.
//! 13. **Checksum** of the resulting World.
//!
//! Steps 3 to 11 call the step functions of their modules (`outsiders`, `death`,
//! `births`, `social`, `economy`); until tasks 6 and 7 fill them in, a step does nothing.

use crate::checksum::Checksum;
use crate::events::CausedBy;
use crate::ids::{InputSeq, PersonId, Tick};
use crate::input::{InputPayload, InputStream, SubmitError, TickInput};
use crate::social::apply_social;
use crate::values::Intensity;
use crate::world::{AppendRefused, ConfigError, Life, RejectReason, World, WorldConfig};

impl World {
    /// Runs one tick (the 13 steps documented above) and returns the checksum of the
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
        // 1. Reset flows.
        self.flows = crate::economy::FlowTotals::default();
        // 2. Apply inputs.
        self.apply_inputs(inputs);
        // 3. Outsider releases.
        crate::outsiders::release_outsiders(self);
        // 4. Deaths, inheritance and debts at death.
        crate::death::process_deaths(self);
        // 5. Births.
        crate::births::process_births(self);
        // 6. Marriage.
        crate::social::process_marriage(self);
        // 7. Loans.
        crate::economy::process_loans(self);
        // 8. Repayments.
        crate::economy::process_repayments(self);
        // 9. Social events.
        crate::social::process_social_events(self);
        // 10. Economy: wages and upkeep.
        crate::economy::process_economy(self);
        // 11. Relation decay.
        crate::social::process_relation_decay(self);
        // 12. Advance the tick.
        self.tick = Tick(
            self.tick
                .0
                .checked_add(1)
                .expect("tick counter overflow (u64) — unreachable in any realistic run"),
        );
        // 13. Checksum.
        Checksum::of(self)
    }

    fn apply_inputs(&mut self, inputs: &[TickInput]) {
        for input in inputs {
            if let Err(reason) = self.apply_one(input.payload) {
                self.rejections.record(self.tick, input.seq, reason);
            }
        }
    }

    /// Validates and applies one payload (design "Inputs and replay format"): actor and
    /// target exist, both are alive, they differ, the intensity is 1..=100.
    fn apply_one(&mut self, payload: InputPayload) -> Result<(), RejectReason> {
        let InputPayload::Act {
            kind,
            actor,
            target,
            intensity,
        } = payload;
        let intensity = validate_act(self, actor, target, intensity)?;
        match apply_social(self, kind, actor, target, intensity, CausedBy::default()) {
            Ok(_) => Ok(()),
            Err(AppendRefused::IdExhausted) => Err(RejectReason::IdExhausted),
            Err(_other) => {
                // Unreachable: validation above guarantees existing, living, distinct
                // actors and no causes, so only counter exhaustion can refuse a
                // validated input.
                Err(RejectReason::IdExhausted)
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
}

impl Sim {
    pub fn new(seed: u64, config: WorldConfig) -> Result<Self, SimError> {
        Ok(Self {
            world: World::new(seed, config)?,
            inputs: InputStream::new(),
            checksums: Vec::new(),
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
        })
    }

    /// Submits an input for `tick` (the current tick or later).
    pub fn submit(&mut self, tick: Tick, payload: InputPayload) -> Result<InputSeq, SubmitError> {
        self.inputs.submit(self.world.tick(), tick, payload)
    }

    /// Runs the current tick with its inputs and returns (and records) the checksum.
    pub fn step(&mut self) -> Checksum {
        let tick = self.world.tick();
        let checksum = self.world.step(self.inputs.for_tick(tick));
        self.checksums.push(checksum);
        checksum
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::IdCounter;
    use crate::values::SocialKind;

    fn sim() -> Sim {
        Sim::new(42, WorldConfig::try_new(40).unwrap()).unwrap()
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
        assert_eq!(
            s.world().last_flows(),
            crate::economy::FlowTotals::default()
        );
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
        assert_eq!(s.world.person_ids, IdCounter::starting_at(1 + 40));
    }
}
