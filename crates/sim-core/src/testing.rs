//! Test-only mutation API for the checksum-sensitivity property (R9.5, R5.4).
//!
//! Compiled only under `#[cfg(any(test, feature = "test-support"))]`. Integration tests
//! in `tests/` are built without `cfg(test)`, so `sim-core` enables the `test-support`
//! feature for its own tests through a self dev-dependency; a normal build of the crate
//! does not contain this module.
//!
//! [`apply`] performs exactly ONE single-field mutation on a [`World`] and reports
//! whether it changed anything. It deliberately does not preserve invariants (it can
//! make an entity id disagree with its map key, for example): its only purpose is to
//! prove that every field of the canonical state reaches the checksum.
//!
//! # Compile-time exhaustiveness guard
//!
//! `apply` destructures [`World`], [`WorldConfig`], [`Entity`] and [`Rejections`] with
//! every field named and no `..`. Adding a field to any of those structs therefore
//! fails to compile here until the new field gets a [`Mutation`] variant (the same
//! discipline as the `Canon` impls, extended to the test API). Selectors are raw
//! integers resolved by modulo over the live collection, so a caller can never produce
//! an out-of-range index.

use crate::ids::{EntityId, IdCounter, InputSeq, Tick};
use crate::world::{
    AFFINITY_MAX, AFFINITY_MIN, Entity, INITIAL_VALUE, RejectReason, Rejections, VALUE_MAX,
    VALUE_MIN, Workload, World, WorldConfig,
};

/// One single-field mutation. Selector fields are resolved modulo the number of
/// candidates, so any value is legal.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Mutation {
    /// `World::seed`: flip bit `bit % 64`.
    Seed { bit: u8 },
    /// `WorldConfig::entity_count`: toggle the lowest bit (stays within `0..=200`).
    ConfigEntityCount,
    /// `WorldConfig::days_per_tick`: swap 1 and 7.
    ConfigDaysPerTick,
    /// `WorldConfig::workload`: swap `Light` and `Pairwise`.
    ConfigWorkload,
    /// `World::tick`: plus one.
    Tick,
    /// `World::entity_ids`: counter plus one.
    EntityIdCounter,
    /// `Entity::value` of one entity: plus or minus one, staying in `0..=1000`.
    /// Needs at least one entity.
    EntityValue { entity: u64, up: bool },
    /// `Entity::id` of one entity, leaving its map key alone. Needs at least one entity.
    EntityIdField { entity: u64 },
    /// One `Entity::affinity` entry: plus or minus one within `-100..=100`, or a new
    /// entry of +1 / -1 when the pair has none. Needs at least one entity.
    Affinity { entity: u64, other: u64, up: bool },
    /// `World::entities`: insert a new entity under the counter's next id without
    /// advancing the counter.
    AddEntity,
    /// `World::entities`: remove one entity. Needs at least one entity.
    RemoveEntity { entity: u64 },
    /// `Rejections::count_by_reason`: plus one for `reason` (creating the entry).
    RejectionCount { reason: RejectReason },
    /// `Rejections::last`: `part % 4` picks `None -> Some`, or for `Some`: 0 = tick + 1,
    /// 1 = seq + 1, 2 = next reason, 3 = back to `None`.
    RejectionLast { part: u8 },
}

/// Applies `mutation` to `world`. Returns `true` if the state changed; `false` when
/// the mutation has no target (an entity mutation on a world without entities).
pub fn apply(world: &mut World, mutation: Mutation) -> bool {
    // Exhaustive: a new `World` field is a compile error until it is handled below.
    let World {
        seed,
        config,
        tick,
        entity_ids,
        entities,
        rejections,
    } = world;

    match mutation {
        Mutation::Seed { bit } => {
            *seed ^= 1u64.rotate_left(u32::from(bit)); // bit % 64, by rotation
            true
        }
        Mutation::ConfigEntityCount | Mutation::ConfigDaysPerTick | Mutation::ConfigWorkload => {
            // Exhaustive: a new `WorldConfig` field is a compile error here.
            let WorldConfig {
                entity_count,
                days_per_tick,
                workload,
            } = config;
            match mutation {
                Mutation::ConfigEntityCount => *entity_count ^= 1,
                Mutation::ConfigDaysPerTick => {
                    *days_per_tick = if *days_per_tick == 1 { 7 } else { 1 };
                }
                _ => {
                    *workload = match workload {
                        Workload::Light => Workload::Pairwise,
                        Workload::Pairwise => Workload::Light,
                    };
                }
            }
            true
        }
        Mutation::Tick => {
            *tick = Tick(tick.0.wrapping_add(1));
            true
        }
        Mutation::EntityIdCounter => {
            *entity_ids = IdCounter::starting_at(entity_ids.peek().wrapping_add(1));
            true
        }
        Mutation::EntityValue { .. }
        | Mutation::EntityIdField { .. }
        | Mutation::Affinity { .. } => {
            let keys: Vec<EntityId> = entities.keys().copied().collect();
            if keys.is_empty() {
                return false;
            }
            let pick = |selector: u64| {
                let n = u64::try_from(keys.len()).unwrap_or(u64::MAX);
                let i = usize::try_from(selector.checked_rem(n).unwrap_or(0)).unwrap_or(0);
                keys.get(i).copied().unwrap_or(EntityId(0))
            };
            match mutation {
                Mutation::EntityValue { entity, up } => {
                    // Exhaustive: a new `Entity` field is a compile error here.
                    let Some(Entity {
                        id: _,
                        value,
                        affinity: _,
                    }) = entities.get_mut(&pick(entity))
                    else {
                        return false;
                    };
                    let up = if *value >= VALUE_MAX {
                        false
                    } else if *value <= VALUE_MIN {
                        true
                    } else {
                        up
                    };
                    *value = if up {
                        value.saturating_add(1)
                    } else {
                        value.saturating_sub(1)
                    };
                    true
                }
                Mutation::EntityIdField { entity } => {
                    let Some(Entity {
                        id,
                        value: _,
                        affinity: _,
                    }) = entities.get_mut(&pick(entity))
                    else {
                        return false;
                    };
                    *id = EntityId(id.0.wrapping_add(1));
                    true
                }
                Mutation::Affinity { entity, other, up } => {
                    let other = pick(other);
                    let Some(Entity {
                        id: _,
                        value: _,
                        affinity,
                    }) = entities.get_mut(&pick(entity))
                    else {
                        return false;
                    };
                    let slot = affinity.entry(other);
                    match slot {
                        std::collections::btree_map::Entry::Vacant(v) => {
                            v.insert(if up { 1 } else { -1 });
                        }
                        std::collections::btree_map::Entry::Occupied(mut o) => {
                            let a = *o.get();
                            let up = if a >= AFFINITY_MAX {
                                false
                            } else if a <= AFFINITY_MIN {
                                true
                            } else {
                                up
                            };
                            o.insert(if up {
                                a.saturating_add(1)
                            } else {
                                a.saturating_sub(1)
                            });
                        }
                    }
                    true
                }
                _ => false,
            }
        }
        Mutation::AddEntity => {
            let id = EntityId(entity_ids.peek());
            entities
                .insert(
                    id,
                    Entity {
                        id,
                        value: INITIAL_VALUE,
                        affinity: std::collections::BTreeMap::new(),
                    },
                )
                .is_none()
        }
        Mutation::RemoveEntity { entity } => {
            let n = u64::try_from(entities.len()).unwrap_or(u64::MAX);
            if n == 0 {
                return false;
            }
            let i = usize::try_from(entity.checked_rem(n).unwrap_or(0)).unwrap_or(0);
            let Some(key) = entities.keys().nth(i).copied() else {
                return false;
            };
            entities.remove(&key).is_some()
        }
        Mutation::RejectionCount { .. } | Mutation::RejectionLast { .. } => {
            // Exhaustive: a new `Rejections` field is a compile error here.
            let Rejections {
                count_by_reason,
                last,
            } = rejections;
            match mutation {
                Mutation::RejectionCount { reason } => {
                    let n = count_by_reason.entry(reason).or_insert(0);
                    let before = *n;
                    *n = n.saturating_add(1);
                    *n != before
                }
                Mutation::RejectionLast { part } => {
                    *last = match (*last, part % 4) {
                        (None, _) => Some((Tick(0), InputSeq(0), RejectReason::UnknownEntity)),
                        (Some(_), 3) => None,
                        (Some((t, s, r)), 0) => Some((Tick(t.0.wrapping_add(1)), s, r)),
                        (Some((t, s, r)), 1) => Some((t, InputSeq(s.0.wrapping_add(1)), r)),
                        (Some((t, s, r)), _) => Some((t, s, next_reason(r))),
                    };
                    true
                }
                _ => false,
            }
        }
    }
}

fn next_reason(r: RejectReason) -> RejectReason {
    match r {
        RejectReason::UnknownEntity => RejectReason::ValueOutOfRange,
        RejectReason::ValueOutOfRange => RejectReason::IdExhausted,
        RejectReason::IdExhausted => RejectReason::UnknownEntity,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checksum::Checksum;
    use crate::tick::Sim;

    fn all_mutations() -> Vec<Mutation> {
        let mut v = vec![
            Mutation::Seed { bit: 63 },
            Mutation::ConfigEntityCount,
            Mutation::ConfigDaysPerTick,
            Mutation::ConfigWorkload,
            Mutation::Tick,
            Mutation::EntityIdCounter,
            Mutation::EntityValue {
                entity: 1,
                up: true,
            },
            Mutation::EntityValue {
                entity: 1,
                up: false,
            },
            Mutation::EntityIdField { entity: 2 },
            Mutation::Affinity {
                entity: 0,
                other: 1,
                up: true,
            },
            Mutation::AddEntity,
            Mutation::RemoveEntity { entity: 0 },
        ];
        for reason in [
            RejectReason::UnknownEntity,
            RejectReason::ValueOutOfRange,
            RejectReason::IdExhausted,
        ] {
            v.push(Mutation::RejectionCount { reason });
        }
        for part in 0..4 {
            v.push(Mutation::RejectionLast { part });
        }
        v
    }

    #[test]
    fn every_mutation_changes_world_and_checksum() {
        let mut sim = Sim::new(5, WorldConfig::try_new(3, 1, Workload::Pairwise).unwrap()).unwrap();
        for _ in 0..3 {
            sim.step();
        }
        for m in all_mutations() {
            let mut w = sim.world().clone();
            assert!(apply(&mut w, m), "{m:?} reported no change");
            assert_ne!(&w, sim.world(), "{m:?}");
            assert_ne!(Checksum::of(&w), Checksum::of(sim.world()), "{m:?}");
        }
    }

    #[test]
    fn entity_mutations_report_no_target_on_empty_world() {
        let mut w =
            crate::world::World::new(1, WorldConfig::try_new(0, 1, Workload::Light).unwrap())
                .unwrap();
        for m in [
            Mutation::EntityValue {
                entity: 9,
                up: true,
            },
            Mutation::EntityIdField { entity: 9 },
            Mutation::Affinity {
                entity: 9,
                other: 9,
                up: true,
            },
            Mutation::RemoveEntity { entity: 9 },
        ] {
            let before = w.clone();
            assert!(!apply(&mut w, m));
            assert_eq!(w, before);
        }
    }

    #[test]
    fn value_and_affinity_mutations_stay_in_range_at_the_edges() {
        let mut w =
            crate::world::World::new(1, WorldConfig::try_new(2, 1, Workload::Light).unwrap())
                .unwrap();
        w.entities.get_mut(&EntityId(0)).unwrap().value = VALUE_MAX;
        w.entities.get_mut(&EntityId(1)).unwrap().value = VALUE_MIN;
        assert!(apply(
            &mut w,
            Mutation::EntityValue {
                entity: 0,
                up: true
            }
        ));
        assert!(apply(
            &mut w,
            Mutation::EntityValue {
                entity: 1,
                up: false
            }
        ));
        assert_eq!(w.entities[&EntityId(0)].value, VALUE_MAX - 1);
        assert_eq!(w.entities[&EntityId(1)].value, VALUE_MIN + 1);
    }
}
