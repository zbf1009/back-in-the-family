//! The tick loop.
//!
//! [`World::step`] runs this fixed sequence, in this order, once per tick:
//!
//! 1. **Apply inputs** in the given `(tick, seq)` order. An input that is invalid at
//!    apply time is skipped and recorded in the world's rejections (count per reason,
//!    plus the last `(tick, seq, reason)`); the rejection enters the checksum.
//!    - `SetValue`: the entity must exist (`UnknownEntity`) and the value must be in
//!      `0..=1000` (`ValueOutOfRange`).
//!    - `Spawn`: the value must be in `0..=1000` (`ValueOutOfRange`); the new entity
//!      takes the next id from the counter (`IdExhausted` if the counter has run out).
//!    - `Despawn`: the entity must exist (`UnknownEntity`); it is removed, together
//!      with every affinity entry in other entities that points at it.
//! 2. **Drift**: for each entity in ID order,
//!    `value = clamp(value + in_range(draw(seed, id, Drift, tick, 0), -10*d, 10*d), 0, 1000)`
//!    where `d = days_per_tick`.
//! 3. **Affinity** (only with `Workload::Pairwise`): for each ordered pair `(a, b)` of
//!    distinct entities, both in ID order,
//!    `affinity[a][b] = clamp(old + in_range(draw(seed, a, Affinity, tick, b), -3, 3), -100, 100)`
//!    (`old` is 0 if `a` has no entry for `b` yet).
//! 4. **Advance**: the tick counter increases by exactly one.
//! 5. **Checksum** of the resulting state.
//!
//! Iteration is always over the `BTreeMap` (ID order). Arithmetic is done in `i64` with
//! saturating operations and explicit clamps, and narrowed only after clamping.

use crate::checksum::Checksum;
use crate::ids::{EntityId, InputSeq, Tick};
use crate::input::{InputPayload, InputStream, SubmitError, TickInput};
use crate::rng::{StreamTag, draw, in_range};
use crate::world::{
    AFFINITY_MAX, AFFINITY_MIN, ConfigError, RejectReason, VALUE_MAX, VALUE_MIN, Workload, World,
    WorldConfig,
};

/// Largest drift per day, in value units.
const DRIFT_PER_DAY: i64 = 10;
/// Largest affinity change per tick, in either direction.
const AFFINITY_STEP: i64 = 3;

impl World {
    /// Runs one tick (see the module docs for the exact sequence) and returns the
    /// checksum of the resulting state.
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
        self.apply_inputs(inputs);
        self.drift();
        if self.config.workload == Workload::Pairwise {
            self.update_affinity();
        }
        self.tick = Tick(
            self.tick
                .0
                .checked_add(1)
                .expect("tick counter overflow (u64) — unreachable in any realistic run"),
        );
        Checksum::of(self)
    }

    fn apply_inputs(&mut self, inputs: &[TickInput]) {
        for input in inputs {
            if let Err(reason) = self.apply_one(input.payload) {
                self.rejections.record(self.tick, input.seq, reason);
            }
        }
    }

    fn apply_one(&mut self, payload: InputPayload) -> Result<(), RejectReason> {
        match payload {
            InputPayload::SetValue { entity, value } => {
                let e = self
                    .entities
                    .get_mut(&entity)
                    .ok_or(RejectReason::UnknownEntity)?;
                if !(VALUE_MIN..=VALUE_MAX).contains(&value) {
                    return Err(RejectReason::ValueOutOfRange);
                }
                e.value = value;
            }
            InputPayload::Spawn { value } => {
                if !(VALUE_MIN..=VALUE_MAX).contains(&value) {
                    return Err(RejectReason::ValueOutOfRange);
                }
                self.spawn_entity(value)
                    .map_err(|_| RejectReason::IdExhausted)?;
            }
            InputPayload::Despawn { entity } => {
                self.entities
                    .remove(&entity)
                    .ok_or(RejectReason::UnknownEntity)?;
                for other in self.entities.values_mut() {
                    other.affinity.remove(&entity);
                }
            }
        }
        Ok(())
    }

    fn drift(&mut self) {
        let bound = i64::from(self.config.days_per_tick).saturating_mul(DRIFT_PER_DAY);
        // `bound` is derived from `days_per_tick` (1 or 7), so `0 - bound` cannot overflow
        // `i64`; `checked_neg` makes that explicit instead of relying on plain `-`.
        let lower_bound = bound
            .checked_neg()
            .expect("drift bound derived from days_per_tick cannot overflow i64 negation");
        let (seed, tick) = (self.seed, self.tick);
        for (&id, entity) in &mut self.entities {
            let delta = in_range(
                draw(seed, id, StreamTag::Drift, tick, 0),
                lower_bound,
                bound,
            );
            let v = i64::from(entity.value)
                .saturating_add(delta)
                .clamp(i64::from(VALUE_MIN), i64::from(VALUE_MAX));
            entity.value = i32::try_from(v).expect("value was clamped into the i32 range");
        }
    }

    fn update_affinity(&mut self) {
        let (seed, tick) = (self.seed, self.tick);
        // Ids in ascending order; the inner loop reads them while one entity is mutated.
        let ids: Vec<EntityId> = self.entities.keys().copied().collect();
        for &a in &ids {
            let Some(entity) = self.entities.get_mut(&a) else {
                continue;
            };
            for &b in &ids {
                if a == b {
                    continue;
                }
                let delta = in_range(
                    draw(seed, a, StreamTag::Affinity, tick, b.0),
                    -AFFINITY_STEP,
                    AFFINITY_STEP,
                );
                let slot = entity.affinity.entry(b).or_insert(0);
                let v = i64::from(*slot)
                    .saturating_add(delta)
                    .clamp(i64::from(AFFINITY_MIN), i64::from(AFFINITY_MAX));
                *slot = i16::try_from(v).expect("affinity was clamped into the i16 range");
            }
        }
    }
}

/// Why [`Sim::new`] failed.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SimError {
    /// The world config is invalid.
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

    fn sim(count: u16, workload: Workload) -> Sim {
        Sim::new(42, WorldConfig::try_new(count, 1, workload).unwrap()).unwrap()
    }

    /// Runs tick 0 with `payload` submitted, and a control sim with no input; returns both.
    fn with_and_without(payload: InputPayload) -> (Sim, Sim) {
        let mut a = sim(4, Workload::Pairwise);
        let mut b = sim(4, Workload::Pairwise);
        a.submit(Tick(0), payload).unwrap();
        a.step();
        b.step();
        (a, b)
    }

    fn assert_rejected_only(payload: InputPayload, reason: RejectReason) {
        let (a, b) = with_and_without(payload);
        let (wa, wb) = (a.world(), b.world());
        // Entities, tick and counter match the control; only the rejection record differs.
        assert_eq!(wa.entities(), wb.entities());
        assert_eq!(wa.tick(), wb.tick());
        assert_eq!(wa.next_entity_id(), wb.next_entity_id());
        assert_eq!(wa.rejections().count_by_reason.get(&reason), Some(&1));
        assert_eq!(wa.rejections().count_by_reason.len(), 1);
        assert_eq!(wa.rejections().last, Some((Tick(0), InputSeq(0), reason)));
        assert_eq!(wb.rejections().last, None);
        assert_ne!(a.checksums(), b.checksums());
        assert_eq!(wa.check_invariants(), Ok(()));
    }

    #[test]
    fn set_value_on_missing_entity_is_skipped_and_counted() {
        assert_rejected_only(
            InputPayload::SetValue {
                entity: EntityId(99),
                value: 5,
            },
            RejectReason::UnknownEntity,
        );
    }

    #[test]
    fn set_value_out_of_range_is_skipped_and_counted() {
        for value in [-1, 1001, i32::MIN, i32::MAX] {
            assert_rejected_only(
                InputPayload::SetValue {
                    entity: EntityId(1),
                    value,
                },
                RejectReason::ValueOutOfRange,
            );
        }
    }

    #[test]
    fn spawn_out_of_range_is_skipped_and_counted() {
        assert_rejected_only(
            InputPayload::Spawn { value: 1001 },
            RejectReason::ValueOutOfRange,
        );
    }

    #[test]
    fn despawn_of_missing_entity_is_skipped_and_counted() {
        assert_rejected_only(
            InputPayload::Despawn {
                entity: EntityId(99),
            },
            RejectReason::UnknownEntity,
        );
    }

    #[test]
    fn spawn_with_exhausted_id_counter_is_skipped_and_counted() {
        let mut s = sim(2, Workload::Light);
        s.world.entity_ids = IdCounter::starting_at(u64::MAX);
        s.submit(Tick(0), InputPayload::Spawn { value: 7 }).unwrap();
        s.step();
        let w = s.world();
        assert_eq!(w.entities().len(), 2);
        assert_eq!(
            w.rejections()
                .count_by_reason
                .get(&RejectReason::IdExhausted),
            Some(&1)
        );
        assert_eq!(
            w.rejections().last,
            Some((Tick(0), InputSeq(0), RejectReason::IdExhausted))
        );
    }

    #[test]
    fn valid_spawn_gets_the_next_id() {
        let mut s = sim(3, Workload::Light);
        s.submit(Tick(0), InputPayload::Spawn { value: 7 }).unwrap();
        s.step();
        assert!(s.world().entities().contains_key(&EntityId(3)));
        assert_eq!(s.world().next_entity_id(), 4);
        assert_eq!(s.world().rejections().last, None);
        assert_eq!(s.world().check_invariants(), Ok(()));
    }

    #[test]
    fn despawn_removes_entity_and_all_inbound_affinity() {
        let mut s = sim(5, Workload::Pairwise);
        s.step();
        s.step();
        let victim = EntityId(2);
        let pointing = |s: &Sim| {
            s.world()
                .entities()
                .values()
                .filter(|e| e.affinity.contains_key(&victim))
                .count()
        };
        assert_eq!(pointing(&s), 4);
        s.submit(Tick(2), InputPayload::Despawn { entity: victim })
            .unwrap();
        s.step();
        let w = s.world();
        assert!(!w.entities().contains_key(&victim));
        assert_eq!(pointing(&s), 0);
        for e in w.entities().values() {
            assert_eq!(e.affinity.len(), 3, "entity {:?}", e.id);
        }
        assert_eq!(w.rejections().last, None);
        assert_eq!(w.check_invariants(), Ok(()));
        // The id is not reused.
        assert_eq!(w.next_entity_id(), 5);
    }

    #[test]
    fn same_tick_inputs_apply_in_seq_order() {
        let set = |value| InputPayload::SetValue {
            entity: EntityId(0),
            value,
        };
        let run = |first: i32, second: i32| {
            let mut s = sim(2, Workload::Light);
            s.submit(Tick(0), set(first)).unwrap();
            s.submit(Tick(0), set(second)).unwrap();
            s.step();
            s
        };
        // Control: only the winning value is submitted.
        let mut control = sim(2, Workload::Light);
        control.submit(Tick(0), set(900)).unwrap();
        control.step();

        let a = run(100, 900);
        assert_eq!(a.world().entities(), control.world().entities());
        let b = run(900, 100);
        assert_ne!(b.world().entities(), control.world().entities());
        assert!((90..=110).contains(&b.world().entities()[&EntityId(0)].value));
    }

    #[test]
    fn spawn_then_set_value_in_one_tick_sees_the_new_entity() {
        let mut s = sim(1, Workload::Light);
        s.submit(Tick(0), InputPayload::Spawn { value: 1 }).unwrap();
        s.submit(
            Tick(0),
            InputPayload::SetValue {
                entity: EntityId(1),
                value: 800,
            },
        )
        .unwrap();
        s.step();
        assert!(s.world().entities()[&EntityId(1)].value >= 790);
        assert_eq!(s.world().rejections().last, None);
    }

    #[test]
    fn invariants_hold_over_many_ticks_for_both_workloads() {
        for workload in [Workload::Light, Workload::Pairwise] {
            for days in [1u8, 7] {
                let mut s = Sim::new(7, WorldConfig::try_new(12, days, workload).unwrap()).unwrap();
                assert_eq!(s.world().check_invariants(), Ok(()));
                s.submit(
                    Tick(5),
                    InputPayload::Despawn {
                        entity: EntityId(3),
                    },
                )
                .unwrap();
                s.submit(Tick(6), InputPayload::Spawn { value: 0 }).unwrap();
                for _ in 0..60 {
                    s.step();
                    assert_eq!(s.world().check_invariants(), Ok(()), "{workload:?} {days}");
                }
                assert_eq!(s.world().tick(), Tick(60));
                assert_eq!(s.checksums().len(), 60);
            }
        }
    }

    #[test]
    fn step_changes_state_and_checksum_every_tick() {
        let mut s = sim(10, Workload::Pairwise);
        let mut seen = Vec::new();
        for _ in 0..20 {
            let c = s.step();
            assert!(!seen.contains(&c), "checksum repeated");
            seen.push(c);
        }
        assert_eq!(s.checksums(), seen.as_slice());
    }

    #[test]
    fn different_seeds_and_configs_give_different_checksums() {
        let cfg = WorldConfig::try_new(10, 1, Workload::Pairwise).unwrap();
        let c1 = Sim::new(1, cfg).unwrap().step();
        let c2 = Sim::new(2, cfg).unwrap().step();
        assert_ne!(c1, c2);
        let cfg7 = WorldConfig::try_new(10, 7, Workload::Pairwise).unwrap();
        assert_ne!(c1, Sim::new(1, cfg7).unwrap().step());
        // And the same seed and config reproduce.
        assert_eq!(c1, Sim::new(1, cfg).unwrap().step());
    }

    #[test]
    fn sim_new_rejects_invalid_config() {
        let bad = WorldConfig {
            entity_count: 500,
            ..WorldConfig::default()
        };
        assert_eq!(
            Sim::new(1, bad).unwrap_err(),
            SimError::Config(ConfigError::EntityCountOutOfRange { entity_count: 500 })
        );
    }

    #[test]
    fn sim_submit_rejects_past_ticks_and_leaves_state_unchanged() {
        let mut s = sim(3, Workload::Light);
        s.step();
        s.step();
        let (inputs_before, world_before) = (s.inputs().clone(), s.world().clone());
        assert_eq!(
            s.submit(Tick(1), InputPayload::Spawn { value: 1 }),
            Err(SubmitError::PastTick {
                tick: Tick(1),
                current: Tick(2)
            })
        );
        assert_eq!(*s.inputs(), inputs_before);
        assert_eq!(*s.world(), world_before);
        assert!(s.submit(Tick(2), InputPayload::Spawn { value: 1 }).is_ok());
    }
}
