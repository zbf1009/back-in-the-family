//! The placeholder world: seed, config, tick counter, entities and rejection record.
//!
//! The state here is deliberately generic (integer `value` and pairwise `affinity`),
//! standing in for the real life-sim until later specs. Everything in [`World`] enters
//! the checksum; there is no derived state yet (R5.3). Future caches must live outside
//! these structs.

use std::collections::BTreeMap;
use std::fmt;

use crate::canon::{CANON_VERSION, Canon, CanonWriter};
use crate::ids::{EntityId, IdCounter, IdExhausted, InputSeq, Tick};

/// Smallest and largest legal entity `value`.
pub const VALUE_MIN: i32 = 0;
pub const VALUE_MAX: i32 = 1000;
/// Smallest and largest legal affinity.
pub const AFFINITY_MIN: i16 = -100;
pub const AFFINITY_MAX: i16 = 100;
/// Largest legal `WorldConfig::entity_count`.
pub const ENTITY_COUNT_MAX: u16 = 200;
/// Default `WorldConfig::entity_count` (inside the 40–60 range of the product plan).
pub const DEFAULT_ENTITY_COUNT: u16 = 50;
/// Value of every entity created by [`World::new`]: the middle of the legal range.
pub const INITIAL_VALUE: i32 = 500;

/// How much work the per-tick placeholder steps do.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum Workload {
    /// Value drift only.
    Light,
    /// Drift plus an affinity update for every ordered pair of entities (O(n^2)),
    /// a stand-in for relationship simulation cost.
    Pairwise,
}

/// Why a [`WorldConfig`] is not valid.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ConfigError {
    /// `entity_count` is above [`ENTITY_COUNT_MAX`].
    EntityCountOutOfRange { entity_count: u16 },
    /// `days_per_tick` is neither 1 nor 7.
    InvalidDaysPerTick { days_per_tick: u8 },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EntityCountOutOfRange { entity_count } => write!(
                f,
                "entity_count {entity_count} is out of range 0..={ENTITY_COUNT_MAX}"
            ),
            Self::InvalidDaysPerTick { days_per_tick } => {
                write!(f, "days_per_tick must be 1 or 7, got {days_per_tick}")
            }
        }
    }
}

impl std::error::Error for ConfigError {}

/// World configuration. Fields are public so tooling can build and display it, but a
/// config is only trusted after [`WorldConfig::validate`]; [`WorldConfig::try_new`] and
/// [`World::new`] both validate and reject (never clamp) invalid values.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct WorldConfig {
    /// Entities created at the start. Valid range `0..=200`; default 50.
    pub entity_count: u16,
    /// Days of in-game time per tick: 1 or 7.
    pub days_per_tick: u8,
    pub workload: Workload,
}

impl WorldConfig {
    /// Builds and validates a config.
    pub fn try_new(
        entity_count: u16,
        days_per_tick: u8,
        workload: Workload,
    ) -> Result<Self, ConfigError> {
        let config = Self {
            entity_count,
            days_per_tick,
            workload,
        };
        config.validate()?;
        Ok(config)
    }

    /// Checks the documented ranges.
    pub fn validate(&self) -> Result<(), ConfigError> {
        let Self {
            entity_count,
            days_per_tick,
            workload: _,
        } = *self;
        if entity_count > ENTITY_COUNT_MAX {
            return Err(ConfigError::EntityCountOutOfRange { entity_count });
        }
        if !matches!(days_per_tick, 1 | 7) {
            return Err(ConfigError::InvalidDaysPerTick { days_per_tick });
        }
        Ok(())
    }
}

impl Default for WorldConfig {
    /// 50 entities, daily ticks, light workload.
    fn default() -> Self {
        Self {
            entity_count: DEFAULT_ENTITY_COUNT,
            days_per_tick: 1,
            workload: Workload::Light,
        }
    }
}

/// A placeholder entity.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Entity {
    pub id: EntityId,
    /// Invariant: `VALUE_MIN..=VALUE_MAX`.
    pub value: i32,
    /// Invariant: each value in `AFFINITY_MIN..=AFFINITY_MAX`; each key is the id of an
    /// existing entity other than this one.
    pub affinity: BTreeMap<EntityId, i16>,
}

/// Why an input was skipped at apply time.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum RejectReason {
    UnknownEntity,
    ValueOutOfRange,
    IdExhausted,
}

/// Record of skipped inputs. It is part of the checksummed state (R4.4).
#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct Rejections {
    pub count_by_reason: BTreeMap<RejectReason, u64>,
    /// The most recent rejection as `(tick it was applied on, input seq, reason)`. One
    /// `Option` of a tuple, so the three parts cannot get out of sync.
    pub last: Option<(Tick, InputSeq, RejectReason)>,
}

impl Rejections {
    pub(crate) fn record(&mut self, tick: Tick, seq: InputSeq, reason: RejectReason) {
        let n = self.count_by_reason.entry(reason).or_insert(0);
        *n = n.saturating_add(1);
        self.last = Some((tick, seq, reason));
    }
}

/// A broken world invariant, reported by [`World::check_invariants`].
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum InvariantViolation {
    /// A map key differs from the `id` stored in its entity.
    IdMismatch {
        key: EntityId,
        id: EntityId,
    },
    /// An entity id is not below the ID counter's next value.
    IdNotBelowCounter {
        entity: EntityId,
        counter: u64,
    },
    ValueOutOfRange {
        entity: EntityId,
        value: i32,
    },
    AffinityOutOfRange {
        entity: EntityId,
        other: EntityId,
        affinity: i16,
    },
    /// An affinity key points at an entity that does not exist.
    DanglingAffinity {
        entity: EntityId,
        other: EntityId,
    },
    /// An entity has an affinity entry about itself.
    SelfAffinity {
        entity: EntityId,
    },
}

impl fmt::Display for InvariantViolation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "world invariant violated: {self:?}")
    }
}

impl std::error::Error for InvariantViolation {}

/// The simulation state. Advanced only by [`World::step`](crate::tick) with the inputs
/// for the current tick.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct World {
    pub(crate) seed: u64,
    pub(crate) config: WorldConfig,
    pub(crate) tick: Tick,
    pub(crate) entity_ids: IdCounter,
    pub(crate) entities: BTreeMap<EntityId, Entity>,
    pub(crate) rejections: Rejections,
}

impl World {
    /// Creates a world at tick 0 with `config.entity_count` entities, ids `0..count` in
    /// order, each with value [`INITIAL_VALUE`] and no affinities. Validates `config`.
    pub fn new(seed: u64, config: WorldConfig) -> Result<Self, ConfigError> {
        config.validate()?;
        let mut world = Self {
            seed,
            config,
            tick: Tick(0),
            entity_ids: IdCounter::new(),
            entities: BTreeMap::new(),
            rejections: Rejections::default(),
        };
        for _ in 0..config.entity_count {
            // A fresh counter cannot run out after at most 200 ids.
            world
                .spawn_entity(INITIAL_VALUE)
                .expect("fresh id counter cannot be exhausted by a validated entity_count");
        }
        Ok(world)
    }

    /// Creates an entity with the next id. The caller checks `value` is in range.
    pub(crate) fn spawn_entity(&mut self, value: i32) -> Result<EntityId, IdExhausted> {
        let id = EntityId(self.entity_ids.next()?);
        self.entities.insert(
            id,
            Entity {
                id,
                value,
                affinity: BTreeMap::new(),
            },
        );
        Ok(id)
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn config(&self) -> &WorldConfig {
        &self.config
    }

    /// The current tick: the one the next [`World::step`] will run.
    pub fn tick(&self) -> Tick {
        self.tick
    }

    /// Entities in ID order.
    pub fn entities(&self) -> &BTreeMap<EntityId, Entity> {
        &self.entities
    }

    /// The id the next spawned entity will get.
    pub fn next_entity_id(&self) -> u64 {
        self.entity_ids.peek()
    }

    pub fn rejections(&self) -> &Rejections {
        &self.rejections
    }

    /// Checks the documented invariants. Not called by `step`; tests call it.
    pub fn check_invariants(&self) -> Result<(), InvariantViolation> {
        let counter = self.entity_ids.peek();
        for (&key, entity) in &self.entities {
            let Entity {
                id,
                value,
                affinity,
            } = entity;
            let (id, value) = (*id, *value);
            if key != id {
                return Err(InvariantViolation::IdMismatch { key, id });
            }
            if id.0 >= counter {
                return Err(InvariantViolation::IdNotBelowCounter {
                    entity: id,
                    counter,
                });
            }
            if !(VALUE_MIN..=VALUE_MAX).contains(&value) {
                return Err(InvariantViolation::ValueOutOfRange { entity: id, value });
            }
            for (&other, &a) in affinity {
                if other == id {
                    return Err(InvariantViolation::SelfAffinity { entity: id });
                }
                if !self.entities.contains_key(&other) {
                    return Err(InvariantViolation::DanglingAffinity { entity: id, other });
                }
                if !(AFFINITY_MIN..=AFFINITY_MAX).contains(&a) {
                    return Err(InvariantViolation::AffinityOutOfRange {
                        entity: id,
                        other,
                        affinity: a,
                    });
                }
            }
        }
        Ok(())
    }
}

impl Canon for Workload {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Light => 0,
            Self::Pairwise => 1,
        };
        tag.encode(w);
    }
}

impl Canon for RejectReason {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::UnknownEntity => 0,
            Self::ValueOutOfRange => 1,
            Self::IdExhausted => 2,
        };
        tag.encode(w);
    }
}

impl Canon for WorldConfig {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            entity_count,
            days_per_tick,
            workload,
        } = self;
        entity_count.encode(w);
        days_per_tick.encode(w);
        workload.encode(w);
    }
}

impl Canon for Entity {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            value,
            affinity,
        } = self;
        id.encode(w);
        value.encode(w);
        affinity.encode(w);
    }
}

impl Canon for Rejections {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            count_by_reason,
            last,
        } = self;
        count_by_reason.encode(w);
        match last {
            None => 0u8.encode(w),
            Some((tick, seq, reason)) => {
                1u8.encode(w);
                tick.encode(w);
                seq.encode(w);
                reason.encode(w);
            }
        }
    }
}

impl Canon for World {
    /// [`CANON_VERSION`] first, then every field in declaration order.
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            seed,
            config,
            tick,
            entity_ids,
            entities,
            rejections,
        } = self;
        CANON_VERSION.encode(w);
        seed.encode(w);
        config.encode(w);
        tick.encode(w);
        entity_ids.encode(w);
        entities.encode(w);
        rejections.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_validation_rejects_bad_values() {
        assert_eq!(WorldConfig::default().validate(), Ok(()));
        assert_eq!(WorldConfig::default().entity_count, 50);
        assert!(WorldConfig::try_new(0, 1, Workload::Light).is_ok());
        assert!(WorldConfig::try_new(200, 7, Workload::Pairwise).is_ok());
        assert_eq!(
            WorldConfig::try_new(201, 1, Workload::Light),
            Err(ConfigError::EntityCountOutOfRange { entity_count: 201 })
        );
        for d in [0u8, 2, 6, 8, 255] {
            assert_eq!(
                WorldConfig::try_new(10, d, Workload::Light),
                Err(ConfigError::InvalidDaysPerTick { days_per_tick: d })
            );
        }
    }

    #[test]
    fn world_new_validates_config() {
        let bad = WorldConfig {
            entity_count: 10,
            days_per_tick: 3,
            workload: Workload::Light,
        };
        assert_eq!(
            World::new(1, bad).unwrap_err(),
            ConfigError::InvalidDaysPerTick { days_per_tick: 3 }
        );
    }

    #[test]
    fn new_world_has_sequential_ids_and_initial_values() {
        let w = World::new(9, WorldConfig::default()).unwrap();
        assert_eq!(w.tick(), Tick(0));
        assert_eq!(w.next_entity_id(), 50);
        let ids: Vec<u64> = w.entities().keys().map(|id| id.0).collect();
        assert_eq!(ids, (0..50).collect::<Vec<_>>());
        assert!(
            w.entities()
                .values()
                .all(|e| e.value == INITIAL_VALUE && e.affinity.is_empty())
        );
        assert_eq!(w.check_invariants(), Ok(()));
    }

    #[test]
    fn check_invariants_detects_each_violation() {
        let base = World::new(1, WorldConfig::try_new(3, 1, Workload::Light).unwrap()).unwrap();

        let mut w = base.clone();
        w.entities.get_mut(&EntityId(1)).unwrap().value = 1001;
        assert_eq!(
            w.check_invariants(),
            Err(InvariantViolation::ValueOutOfRange {
                entity: EntityId(1),
                value: 1001
            })
        );

        let mut w = base.clone();
        w.entities
            .get_mut(&EntityId(0))
            .unwrap()
            .affinity
            .insert(EntityId(0), 0);
        assert_eq!(
            w.check_invariants(),
            Err(InvariantViolation::SelfAffinity {
                entity: EntityId(0)
            })
        );

        let mut w = base.clone();
        w.entities
            .get_mut(&EntityId(0))
            .unwrap()
            .affinity
            .insert(EntityId(9), 0);
        assert_eq!(
            w.check_invariants(),
            Err(InvariantViolation::DanglingAffinity {
                entity: EntityId(0),
                other: EntityId(9)
            })
        );

        let mut w = base.clone();
        w.entities
            .get_mut(&EntityId(0))
            .unwrap()
            .affinity
            .insert(EntityId(1), 101);
        assert_eq!(
            w.check_invariants(),
            Err(InvariantViolation::AffinityOutOfRange {
                entity: EntityId(0),
                other: EntityId(1),
                affinity: 101
            })
        );

        let mut w = base.clone();
        w.entity_ids = IdCounter::starting_at(2);
        assert_eq!(
            w.check_invariants(),
            Err(InvariantViolation::IdNotBelowCounter {
                entity: EntityId(2),
                counter: 2
            })
        );
    }
}
