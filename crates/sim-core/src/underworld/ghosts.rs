//! Ghosts and Connected_Persons (R4.3, R5.3, OP-U4 A).
//!
//! A Ghost is a dead Person whose Soul is in the Waiting_Queue: it acts for that Soul in
//! afterlife Events (glossary "Ghost"). A Resident is connected to a Ghost when any
//! Relation from the Resident toward the Ghost exists, whatever its tags (OP-U4 A), so a
//! grudge can continue as a haunting.

use crate::ids::{PersonId, SoulId};
use crate::world::{Life, SoulPlace, World};

/// Every Ghost, in Person ID order, with its Soul (R2.1, R4.3).
pub fn ghosts(world: &World) -> Vec<(PersonId, SoulId)> {
    world
        .persons
        .iter()
        .filter_map(|(&id, person)| {
            let Life::Dead { .. } = person.life else {
                return None;
            };
            matches!(
                world.souls.places.get(&person.soul),
                Some(SoulPlace::Waiting { .. })
            )
            .then_some((id, person.soul))
        })
        .collect()
}

/// Whether `resident` is a living Resident with any Relation toward `ghost` (OP-U4 A).
pub fn is_connected(world: &World, resident: PersonId, ghost: PersonId) -> bool {
    world
        .persons
        .get(&resident)
        .is_some_and(|person| matches!(person.life, Life::Alive { .. }))
        && world.relations.contains_key(&(resident, ghost))
}

/// Every Connected_Person of `ghost`, in Person ID order (OP-U4 A).
pub fn connected(world: &World, ghost: PersonId) -> Vec<PersonId> {
    world
        .persons
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .filter(|person| world.relations.contains_key(&(person.id, ghost)))
        .map(|person| person.id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Tick;
    use crate::world::{Life, WorldConfig};

    fn world(seed: u64) -> World {
        World::new(seed, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    #[test]
    fn a_dead_person_whose_soul_waits_is_a_ghost() {
        let mut world = world(3);
        let ids = residents(&world);
        let dead = ids[0];
        let soul = world.persons()[&dead].soul;
        if let Some(person) = world.persons.get_mut(&dead) {
            person.life = Life::Dead { death: Tick(0) };
        }
        world
            .souls
            .places
            .insert(soul, SoulPlace::Waiting { since: Tick(0) });
        assert!(ghosts(&world).contains(&(dead, soul)));
        // A dead body whose Soul is in a new body is not a Ghost.
        let other = ids[1];
        if let Some(person) = world.persons.get_mut(&other) {
            person.life = Life::Dead { death: Tick(1) };
        }
        world
            .souls
            .places
            .insert(world.persons()[&other].soul, SoulPlace::Body(ids[2]));
        assert!(!ghosts(&world).iter().any(|(id, _)| *id == other));
    }

    #[test]
    fn ghosts_are_listed_in_person_id_order() {
        let mut world = world(5);
        for id in residents(&world).into_iter().take(3) {
            let soul = world.persons()[&id].soul;
            if let Some(person) = world.persons.get_mut(&id) {
                person.life = Life::Dead { death: Tick(0) };
            }
            world
                .souls
                .places
                .insert(soul, SoulPlace::Waiting { since: Tick(0) });
        }
        let listed: Vec<PersonId> = ghosts(&world).into_iter().map(|(id, _)| id).collect();
        let mut sorted = listed.clone();
        sorted.sort();
        assert_eq!(listed, sorted);
        assert_eq!(listed.len(), 3);
    }

    #[test]
    fn any_relation_toward_the_ghost_connects_a_resident() {
        let mut world = world(7);
        let ids = residents(&world);
        let ghost = ids[0];
        if let Some(person) = world.persons.get_mut(&ghost) {
            person.life = Life::Dead { death: Tick(0) };
        }
        let connected_person = ids[1];
        let stranger = ids[2];
        // A rival Relation counts (OP-U4 A).
        if let Some(relation) = world.relations.get_mut(&(connected_person, ghost)) {
            relation.tags.insert(crate::values::RelationTag::Rival);
        } else {
            world.relations.insert(
                (connected_person, ghost),
                crate::world::Relation {
                    affinity: crate::values::Score::clamped(-10),
                    trust: crate::values::Score::clamped(-5),
                    tags: {
                        let mut tags = crate::values::RelTags::empty();
                        tags.insert(crate::values::RelationTag::Rival);
                        tags
                    },
                },
            );
        }
        // Drop any Relation from the stranger if the opening world had one.
        world.relations.remove(&(stranger, ghost));
        assert!(is_connected(&world, connected_person, ghost));
        assert!(!is_connected(&world, stranger, ghost));
        let list = connected(&world, ghost);
        assert!(list.contains(&connected_person));
        assert!(!list.contains(&stranger));
        assert!(
            list.windows(2).all(|pair| pair[0] < pair[1]),
            "Person ID order"
        );
        // A Relation on the other side does not connect the resident.
        assert!(!is_connected(&world, ghost, connected_person));
    }
}
