//! Birth_Slots (R7.1, R7.5, OP-U7 A).
//!
//! A Birth_Slot is one announced future local birth. It opens in the tick of the
//! announcement with `birth = announced + birth_lead_days`, stays open until its birth
//! tick or until its mother dies. `World::slots` holds open slots only, in slot ID
//! order; a closed slot is removed, so no stale slot can be observed.

use crate::canon::{Canon, CanonWriter};
use crate::ids::{BirthSlotId, IdCounter, PersonId, Tick};
use crate::world::World;

/// One announced future local birth (design "Data Models").
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct BirthSlot {
    /// Its slot ID, from the dedicated counter (R7.1).
    pub id: BirthSlotId,
    /// The mother; her Household is the slot's Household while the slot is open.
    pub mother: PersonId,
    /// The tick the announcement rolled.
    pub announced: Tick,
    /// The tick the birth happens, `announced + birth_lead_days` (OP-U7 A).
    pub birth: Tick,
}

impl Canon for BirthSlot {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            mother,
            announced,
            birth,
        } = self;
        id.encode(w);
        mother.encode(w);
        announced.encode(w);
        birth.encode(w);
    }
}

/// The slot counter every World starts with.
pub(crate) const SLOT_IDS_START: u64 = 1;

/// An empty slot counter.
pub(crate) fn slot_ids() -> IdCounter {
    IdCounter::starting_at(SLOT_IDS_START)
}

/// Whether `mother` already has an open Birth_Slot (OP-U13 A).
pub(crate) fn mother_has_open_slot(world: &World, mother: PersonId) -> bool {
    world.slots.values().any(|slot| slot.mother == mother)
}

/// Opens one Birth_Slot for `mother` in the current tick (step 7). Returns `None` when
/// the slot counter is exhausted, in which case nothing changes.
pub(crate) fn open(world: &mut World, mother: PersonId) -> Option<BirthSlotId> {
    let id = BirthSlotId(world.slot_ids.next().ok()?);
    let birth = Tick(world.tick.0.saturating_add(world.params.birth_lead_days));
    world.slots.insert(
        id,
        BirthSlot {
            id,
            mother,
            announced: world.tick,
            birth,
        },
    );
    Some(id)
}

/// Closes every open Birth_Slot of a dying mother (design "Birth_Slots": the slot closes
/// in her death tick with no birth).
pub(crate) fn close_for_mother(world: &mut World, mother: PersonId) {
    let closing: Vec<BirthSlotId> = world
        .slots
        .iter()
        .filter(|(_, slot)| slot.mother == mother)
        .map(|(&id, _)| id)
        .collect();
    for id in closing {
        world.slots.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{Life, WorldConfig};

    fn world(seed: u64) -> World {
        World::new(seed, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn first_mother(world: &World) -> PersonId {
        world
            .persons()
            .values()
            .find(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .expect("the town has Residents")
    }

    #[test]
    fn an_opening_world_has_no_slots_and_an_empty_counter() {
        let world = world(3);
        assert!(world.slots().is_empty());
        assert_eq!(world.slot_ids.peek(), SLOT_IDS_START);
    }

    #[test]
    fn a_slot_opens_with_the_documented_birth_tick_and_a_fresh_id() {
        let mut world = world(3);
        let mother = first_mother(&world);
        let today = world.tick();
        let lead = world.params().birth_lead_days;
        let first = open(&mut world, mother).expect("the counter has room");
        assert_eq!(first, BirthSlotId(1));
        let slot = world.slots()[&first].clone();
        assert_eq!(slot.mother, mother);
        assert_eq!(slot.announced, today);
        assert_eq!(slot.birth, Tick(today.0.saturating_add(lead)));

        world.tick = Tick(10);
        let second = open(&mut world, mother).expect("the counter has room");
        assert_eq!(second, BirthSlotId(2));
        assert_eq!(world.slots()[&second].announced, Tick(10));
        assert_eq!(
            world.slots()[&second].birth,
            Tick(10u64.saturating_add(lead))
        );
        assert!(mother_has_open_slot(&world, mother));
    }

    #[test]
    fn a_mothers_death_closes_her_slots_and_leaves_the_others() {
        let mut world = world(3);
        let mothers: Vec<PersonId> = world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .take(2)
            .collect();
        let dying = mothers[0];
        let other = mothers[1];
        let closed = open(&mut world, dying).expect("room");
        let kept = open(&mut world, other).expect("room");
        close_for_mother(&mut world, dying);
        assert!(!world.slots().contains_key(&closed));
        assert!(world.slots().contains_key(&kept));
        assert!(!mother_has_open_slot(&world, dying));
        assert!(mother_has_open_slot(&world, other));
    }

    #[test]
    fn a_slot_encodes_its_four_fields_in_order() {
        use crate::canon::encode_to_vec;
        let slot = BirthSlot {
            id: BirthSlotId(2),
            mother: PersonId(7),
            announced: Tick(1),
            birth: Tick(11),
        };
        assert_eq!(
            encode_to_vec(&slot),
            [
                2, 0, 0, 0, 0, 0, 0, 0, // id
                7, 0, 0, 0, 0, 0, 0, 0, // mother
                1, 0, 0, 0, 0, 0, 0, 0, // announced
                11, 0, 0, 0, 0, 0, 0, 0, // birth
            ]
        );
    }

    #[test]
    fn an_exhausted_counter_opens_no_slot() {
        let mut world = world(3);
        let mother = first_mother(&world);
        world.slot_ids = IdCounter::starting_at(u64::MAX);
        assert_eq!(open(&mut world, mother), None);
        assert!(world.slots().is_empty());
    }
}
