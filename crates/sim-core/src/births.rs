//! Births from announced Birth_Slots (design "Birth_Slots", "The tick" steps 6 and 7,
//! R7.1, R7.5, R10).
//!
//! Step 7 ([`process_announcements`]) rolls a birth announcement for every candidate
//! mother in Person ID order: female Residents aged 18..=45 without an open Birth_Slot,
//! rolled only while the number of waiting Souls (the Player_Soul included) exceeds the
//! number of open Birth_Slots (OP-U13 A). A success opens a slot whose birth is
//! `birth_lead_days` after the announcement (OP-U7 A).
//!
//! Step 6 ([`process_slot_births`]) closes every open slot whose birth tick is today, in
//! slot ID order. The Soul is chosen at that birth tick: the waiting Soul with the
//! longest wait (ties go to the lower Soul ID, OP-3 A), or no newborn at all when none
//! waits (LS-R10.2). The newborn is created by [`bear`], which takes the Soul instead of
//! choosing it; the second parent is the mother's living spouse at the birth tick.
//!
//! Each of the newborn's seven Traits is, by its own roll, either a copy of one parent's
//! Trait or a fresh draw through the shared weighted trait draw (design "Trait draws",
//! Author 2026-11-11, and R10.5). The roll chooses uniformly among the mother, the
//! living spouse (when there is one) and the fresh draw; the fresh value comes from
//! [`Params::draw_trait`](crate::params::draw_trait) on the same `Traits` stream.
//!
//! Every draw is keyed by the newborn's Person ID, so adding or removing a birth never
//! shifts another Person's numbers (rng rule).

use std::collections::BTreeSet;

use crate::events::{CausedBy, EventKind, EventTags};
use crate::ids::{BirthSlotId, PersonId, SoulId, Tick};
use crate::names::pick_full_name;
use crate::params::draw_trait;
use crate::rng::{StreamTag, below, draw, in_range};
use crate::underworld::slots;
use crate::values::{Mood, Origin, RelTags, RelationTag, Score, Sex, Traits};
use crate::world::{Life, Person, Relation, SoulPlace, World};

/// Youngest and oldest age of a candidate mother (design "Births").
const MOTHER_AGE_MIN: u16 = 18;
const MOTHER_AGE_MAX: u16 = 45;

/// Draw sites keyed by the mother (the birth roll) and by the newborn (everything else).
const BIRTH_ROLL: u64 = 0;
const NEWBORN_SEX: u64 = 0;
const NEWBORN_WAGE: u64 = 1;
const NEWBORN_NAME: u64 = 0;
/// One source-choice site per trait, and one fresh-draw site per trait.
const NEWBORN_TRAIT_SOURCE_BASE: u64 = 0;
const NEWBORN_TRAIT_FRESH_BASE: u64 = 8;

/// Step 6: every open Birth_Slot with `birth == T`, in slot ID order, gives birth to the
/// longest-waiting non-player Soul (LS-R10.1, OP-3 A) or to no newborn when none waits
/// (LS-R10.2). The slot closes either way.
pub(crate) fn process_slot_births(world: &mut World) {
    let today = world.tick;
    let due: Vec<BirthSlotId> = world
        .slots
        .iter()
        .filter(|(_, slot)| slot.birth == today)
        .map(|(&id, _)| id)
        .collect();
    for id in due {
        let Some(slot) = world.slots.remove(&id) else {
            continue;
        };
        let Some(soul) = longest_waiting_soul(world) else {
            continue;
        };
        let _ = bear(world, slot.mother, soul);
    }
}

/// Step 7: a birth announcement roll per candidate mother in Person ID order, while the
/// number of waiting Souls (the Player_Soul included) exceeds the number of open
/// Birth_Slots (OP-U13 A). A success opens a slot with `birth = T + birth_lead_days`.
pub(crate) fn process_announcements(world: &mut World) {
    let mothers: Vec<PersonId> = world
        .persons
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .filter(|person| person.sex == Sex::Female)
        .filter(|person| (MOTHER_AGE_MIN..=MOTHER_AGE_MAX).contains(&world.age_years(person)))
        .filter(|person| !slots::mother_has_open_slot(world, person.id))
        .map(|person| person.id)
        .collect();
    for mother in mothers {
        // OP-U13 A: slots track the Souls that need bodies, so the gate counts every
        // waiting Soul, the Player_Soul included.
        if waiting_soul_count(world) <= open_slot_count(world) {
            break;
        }
        let married = living_spouse(world, mother).is_some();
        let ppm = world.params.birth_ppm(married);
        let roll = draw(
            world.seed,
            mother.rng_key(),
            StreamTag::Births,
            world.tick,
            BIRTH_ROLL,
        );
        if below(roll, 1_000_000) >= u64::from(ppm) {
            continue;
        }
        slots::open(world, mother);
    }
}

/// Every waiting Soul, the Player_Soul included.
fn waiting_soul_count(world: &World) -> u64 {
    u64::try_from(
        world
            .souls
            .places
            .values()
            .filter(|place| matches!(place, SoulPlace::Waiting { .. }))
            .count(),
    )
    .unwrap_or(u64::MAX)
}

/// The number of open Birth_Slots.
fn open_slot_count(world: &World) -> u64 {
    u64::try_from(world.slots.len()).unwrap_or(u64::MAX)
}

/// The non-player waiting Soul with the longest wait; ties go to the lower Soul ID
/// (OP-3 A). `None` when the queue holds only the Player_Soul.
fn longest_waiting_soul(world: &World) -> Option<SoulId> {
    let player = world.souls.player;
    let mut best: Option<(SoulId, Tick)> = None;
    for (&soul, place) in &world.souls.places {
        if soul == player {
            continue;
        }
        let SoulPlace::Waiting { since } = place else {
            continue;
        };
        match best {
            // Soul IDs ascend with the map keys, so an equal `since` keeps the earlier
            // (lower) Soul ID.
            Some((_, best_since)) if *since >= best_since => {}
            _ => best = Some((soul, *since)),
        }
    }
    best.map(|(soul, _)| soul)
}

fn is_resident(world: &World, person: PersonId) -> bool {
    world
        .persons
        .get(&person)
        .is_some_and(|entry| matches!(entry.life, Life::Alive { .. }))
}

/// `person`'s living spouse, from the `spouse` tag toward a Resident (R4.6).
fn living_spouse(world: &World, person: PersonId) -> Option<PersonId> {
    world
        .relations
        .iter()
        .filter_map(|(key, relation)| {
            let (from, to) = *key;
            (from == person && relation.tags.contains(RelationTag::Spouse)).then_some(to)
        })
        .next()
        .filter(|&to| is_resident(world, to))
}

/// Creates the newborn and its Relations, places the Soul and appends the `birth` Event
/// (design "Births" steps 1 to 4). Returns the new Person's ID, or `None` when the
/// mother left the state the slot required (her death closes the slot) or the Person ID
/// counter is exhausted.
fn bear(world: &mut World, mother: PersonId, soul: SoulId) -> Option<PersonId> {
    let mother_person = world.persons.get(&mother)?;
    let Life::Alive { household, .. } = mother_person.life else {
        return None;
    };
    let surname = mother_person.name.surname;
    let parents: Vec<(PersonId, Traits)> = std::iter::once((mother, mother_person.traits.clone()))
        .chain(
            living_spouse(world, mother)
                .and_then(|father| world.persons.get(&father))
                .map(|father| (father.id, father.traits.clone())),
        )
        .collect();
    let Ok(raw_id) = world.person_ids.next() else {
        return None;
    };
    let id = PersonId(raw_id);

    let sex = if draw(
        world.seed,
        id.rng_key(),
        StreamTag::Births,
        world.tick,
        NEWBORN_SEX,
    ) & 1
        == 0
    {
        Sex::Female
    } else {
        Sex::Male
    };
    let traits = inherit_traits(world, id, &parents);
    let wage = u16::try_from(in_range(
        draw(
            world.seed,
            id.rng_key(),
            StreamTag::Births,
            world.tick,
            NEWBORN_WAGE,
        ),
        i64::from(world.params.wage_min),
        i64::from(world.params.wage_max),
    ))
    .unwrap_or(world.params.wage_min);
    let name = pick_full_name(
        sex == Sex::Female,
        surname,
        draw(
            world.seed,
            id.rng_key(),
            StreamTag::Names,
            world.tick,
            NEWBORN_NAME,
        ),
        &world.derived.living_names,
    );
    world.derived.living_names.insert(name);
    let birth_day = i64::try_from(world.tick.0).unwrap_or(i64::MAX);
    world.persons.insert(
        id,
        Person {
            id,
            name,
            birth_day,
            sex,
            origin: Origin::Native,
            traits,
            soul,
            wage,
            life: Life::Alive {
                household,
                mood: Mood::clamped(0),
                money: 0,
            },
        },
    );

    add_kinship(world, id, &parents);
    world.souls.places.insert(soul, SoulPlace::Body(id));
    if let Err(refused) = world.append(
        EventKind::Birth { person: id },
        CausedBy::default(),
        EventTags::empty(),
    ) {
        // Unreachable: the newborn is a known, living Person and the counter has room.
        debug_assert!(false, "the birth Event was refused: {refused:?}");
    }
    Some(id)
}

/// One Trait of the newborn: with probability proportional to the number of parents a
/// copy of that parent's Trait, otherwise a fresh weighted draw (R10.5).
fn inherit_traits(world: &World, newborn: PersonId, parents: &[(PersonId, Traits)]) -> Traits {
    let parent_count = u64::try_from(parents.len()).unwrap_or(0);
    let value = |index: u64, select: fn(&Traits) -> crate::values::Trait| {
        let source = draw(
            world.seed,
            newborn.rng_key(),
            StreamTag::Traits,
            world.tick,
            NEWBORN_TRAIT_SOURCE_BASE.saturating_add(index),
        );
        let pick = below(source, parent_count.saturating_add(1));
        match usize::try_from(pick)
            .ok()
            .and_then(|slot| parents.get(slot))
        {
            Some((_, traits)) => select(traits),
            None => draw_trait(draw(
                world.seed,
                newborn.rng_key(),
                StreamTag::Traits,
                world.tick,
                NEWBORN_TRAIT_FRESH_BASE.saturating_add(index),
            )),
        }
    };
    Traits {
        greed: value(0, |traits| traits.greed),
        loyalty: value(1, |traits| traits.loyalty),
        pride: value(2, |traits| traits.pride),
        warmth: value(3, |traits| traits.warmth),
        temper: value(4, |traits| traits.temper),
        vindictiveness: value(5, |traits| traits.vindictiveness),
        piety: value(6, |traits| traits.piety),
    }
}

/// Links the newborn to its living parents, its living siblings and its living
/// grandparents with the Params initial scores (R10.4, R4.3). Dead kin get no Relation
/// in either direction.
fn add_kinship(world: &mut World, newborn: PersonId, parents: &[(PersonId, Traits)]) {
    let params = world.params;
    let mut siblings: BTreeSet<PersonId> = BTreeSet::new();
    let mut grandparents: BTreeSet<PersonId> = BTreeSet::new();
    for &(parent, _) in parents {
        relate_pair(
            world,
            newborn,
            parent,
            RelationTag::Parent,
            RelationTag::Child,
            params.parent_child_affinity,
            params.parent_child_trust,
        );
        for (&(from, to), relation) in &world.relations {
            if from != parent || !is_resident(world, to) || to == newborn {
                continue;
            }
            if relation.tags.contains(RelationTag::Child) {
                siblings.insert(to);
            }
            if relation.tags.contains(RelationTag::Parent) {
                grandparents.insert(to);
            }
        }
    }
    for sibling in siblings {
        relate_pair(
            world,
            newborn,
            sibling,
            RelationTag::Sibling,
            RelationTag::Sibling,
            params.sibling_affinity,
            params.sibling_trust,
        );
    }
    for grandparent in grandparents {
        relate_pair(
            world,
            newborn,
            grandparent,
            RelationTag::Grandparent,
            RelationTag::Grandchild,
            params.grandparent_affinity,
            params.grandparent_trust,
        );
    }
}

/// Writes one Relation in each direction with the initial kin scores.
fn relate_pair(
    world: &mut World,
    a: PersonId,
    b: PersonId,
    a_tag: RelationTag,
    b_tag: RelationTag,
    affinity: i8,
    trust: i8,
) {
    relate(world, a, b, a_tag, affinity, trust);
    relate(world, b, a, b_tag, affinity, trust);
}

/// Sets one directed Relation's tag and initial scores, refreshing the friend and rival
/// thresholds (R4.8).
fn relate(
    world: &mut World,
    from: PersonId,
    to: PersonId,
    tag: RelationTag,
    affinity: i8,
    trust: i8,
) {
    let params = world.params;
    let relation = world
        .relations
        .entry((from, to))
        .or_insert_with(|| Relation {
            affinity: Score::clamped(0),
            trust: Score::clamped(0),
            tags: RelTags::empty(),
        });
    relation.tags.insert(tag);
    relation.affinity = Score::clamped(i64::from(affinity));
    relation.trust = Score::clamped(i64::from(trust));
    crate::social::apply_threshold_tags(&mut relation.tags, relation.affinity, &params);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;
    use crate::world::WorldConfig;

    fn world_with(params: Params) -> World {
        World::new_with_params(11, WorldConfig::try_new(40).unwrap(), params).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    fn birth_count(world: &World) -> usize {
        world
            .log
            .events()
            .iter()
            .filter(|event| matches!(event.kind, EventKind::Birth { .. }))
            .count()
    }

    #[test]
    fn only_the_player_soul_waiting_announces_a_slot_but_gives_no_newborn() {
        let mut params = Params::DEFAULT;
        params.birth_ppm_married = 1_000_000;
        params.birth_ppm_unmarried = 1_000_000;
        params.birth_lead_days = 5;
        let mut world = world_with(params);
        // Leave only the Player_Soul in the Waiting_Queue.
        let player = world.souls.player;
        for (soul, place) in world.souls.places.clone() {
            if soul == player {
                world
                    .souls
                    .places
                    .insert(soul, SoulPlace::Waiting { since: world.tick });
            } else if matches!(place, SoulPlace::Waiting { .. }) {
                // Put the non-player waiting Souls into the bodies of dead Persons so
                // that the queue holds exactly the Player_Soul.
                let dead = residents(&world)
                    .first()
                    .copied()
                    .expect("the town has Residents");
                world.souls.places.insert(soul, SoulPlace::Body(dead));
            }
        }

        // OP-U13 A: the waiting Player_Soul makes the announcement gate roll.
        process_announcements(&mut world);
        assert_eq!(world.slots.len(), 1, "the gate rolls for a waiting Soul");
        let slot = world
            .slots
            .values()
            .next()
            .cloned()
            .expect("the slot opened");
        assert_eq!(slot.birth, Tick(world.tick.0 + 5));

        // At its birth tick there is no non-player Soul to take (LS-R10.2).
        world.tick = slot.birth;
        let persons_before = world.persons.len();
        let births_before = birth_count(&world);
        process_slot_births(&mut world);

        assert_eq!(world.persons.len(), persons_before, "no newborn (R10.2)");
        assert_eq!(birth_count(&world), births_before, "no birth Event (R10.2)");
        assert!(world.slots.is_empty(), "the slot closes either way");
    }

    #[test]
    fn a_slot_gives_birth_to_the_longest_waiting_non_player_soul() {
        let mut world = world_with(Params::DEFAULT);
        let mother = residents(&world)
            .into_iter()
            .find(|&id| world.persons[&id].sex == Sex::Female)
            .expect("the town has a woman");
        let player = world.souls.player;
        // The opening queue waits with two non-player Souls.
        let longest = world
            .souls
            .places
            .iter()
            .filter(|(soul, place)| **soul != player && matches!(place, SoulPlace::Waiting { .. }))
            .map(|(&soul, _)| soul)
            .next()
            .expect("a non-player Soul waits");
        for (soul, place) in world.souls.places.clone() {
            if soul != player && matches!(place, SoulPlace::Waiting { .. }) {
                world
                    .souls
                    .places
                    .insert(soul, SoulPlace::Waiting { since: Tick(9) });
            }
        }
        world
            .souls
            .places
            .insert(longest, SoulPlace::Waiting { since: Tick(4) });

        let slot = slots::open(&mut world, mother).expect("the counter has room");
        world.tick = world.slots()[&slot].birth;
        let persons_before = world.persons.len();
        process_slot_births(&mut world);

        assert!(!world.slots().contains_key(&slot), "the slot closed");
        assert_eq!(world.persons.len(), persons_before.saturating_add(1));
        let newborn = *world
            .persons
            .keys()
            .next_back()
            .expect("the newborn has the highest Person ID");
        assert_eq!(world.persons[&newborn].soul, longest);
        assert_eq!(world.souls.places[&longest], SoulPlace::Body(newborn));
    }

    #[test]
    fn a_tie_on_the_wait_goes_to_the_lower_soul_id() {
        let mut world = world_with(Params::DEFAULT);
        let player = world.souls.player;
        for place in world.souls.places.values_mut() {
            if let SoulPlace::Waiting { .. } = place {
                *place = SoulPlace::Waiting { since: Tick(7) };
            }
        }
        let waiting: Vec<SoulId> = world
            .souls
            .places
            .iter()
            .filter(|(soul, place)| **soul != player && matches!(place, SoulPlace::Waiting { .. }))
            .map(|(soul, _)| *soul)
            .collect();
        assert!(waiting.len() >= 2, "the opening world waits with two Souls");

        assert_eq!(
            longest_waiting_soul(&world),
            Some(waiting[0]),
            "ties go to the lower Soul ID"
        );
        // A longer wait wins even when its Soul ID is higher.
        let longer = waiting[1];
        world
            .souls
            .places
            .insert(longer, SoulPlace::Waiting { since: Tick(6) });
        assert_eq!(longest_waiting_soul(&world), Some(longer));
    }

    #[test]
    fn the_player_soul_is_never_taken() {
        let mut world = world_with(Params::DEFAULT);
        let player = world.souls.player;
        assert!(matches!(world.souls.places[&player], SoulPlace::Body(_)));
        // Make the Player_Soul the longest-waiting Soul in the queue.
        world
            .souls
            .places
            .insert(player, SoulPlace::Waiting { since: Tick(0) });
        for (soul, place) in world.souls.places.clone() {
            if soul != player && matches!(place, SoulPlace::Waiting { .. }) {
                world
                    .souls
                    .places
                    .insert(soul, SoulPlace::Waiting { since: Tick(5) });
            }
        }
        assert_ne!(longest_waiting_soul(&world), Some(player));
    }

    #[test]
    fn a_birth_links_only_living_kin_and_places_the_soul() {
        let mut world = world_with(Params::DEFAULT);
        let ids = residents(&world);
        let mother = ids
            .iter()
            .copied()
            .find(|&id| world.persons[&id].sex == Sex::Female)
            .expect("the town has a woman");
        // A dead grandparent: the mother's father. Give the mother a Parent Relation to a
        // dead Person and check it produces no grandchild Relation.
        let dead_grandparent = ids
            .iter()
            .copied()
            .find(|&id| id != mother)
            .expect("the town has another Resident");
        if let Some(person) = world.persons.get_mut(&dead_grandparent) {
            person.life = Life::Dead { death: Tick(0) };
        }
        relate(
            &mut world,
            mother,
            dead_grandparent,
            RelationTag::Parent,
            50,
            50,
        );
        let soul = longest_waiting_soul(&world).expect("a non-player Soul waits");
        let persons_before = world.persons.len();
        let births_before = birth_count(&world);

        assert!(
            bear(&mut world, mother, soul).is_some(),
            "the birth happens"
        );

        assert_eq!(world.persons.len(), persons_before.saturating_add(1));
        assert_eq!(birth_count(&world), births_before.saturating_add(1));
        let newborn = *world
            .persons
            .keys()
            .next_back()
            .expect("the newborn has the highest Person ID");
        assert_eq!(world.persons[&newborn].soul, soul);
        assert_eq!(world.souls.places[&soul], SoulPlace::Body(newborn));
        assert_eq!(world.persons[&newborn].origin, Origin::Native);
        assert_eq!(world.persons[&newborn].birth_day, 0);
        assert_eq!(
            world.persons[&newborn].name.surname, world.persons[&mother].name.surname,
            "the newborn takes the mother's surname"
        );
        assert!(
            world.relations[&(newborn, mother)]
                .tags
                .contains(RelationTag::Parent),
            "a parent Relation to the mother"
        );
        assert!(
            world.relations[&(mother, newborn)]
                .tags
                .contains(RelationTag::Child),
            "a child Relation from the mother"
        );
        assert!(
            !world.relations.contains_key(&(newborn, dead_grandparent)),
            "a dead grandparent gets no Relation"
        );
        assert!(!world.relations.contains_key(&(dead_grandparent, newborn)));
        let last = world.log.events().last().expect("the birth Event exists");
        assert!(matches!(last.kind, EventKind::Birth { person } if person == newborn));
    }

    #[test]
    fn the_newborn_enters_the_mothers_household_with_no_money() {
        let mut world = world_with(Params::DEFAULT);
        let mother = residents(&world)
            .into_iter()
            .find(|&id| world.persons[&id].sex == Sex::Female)
            .expect("the town has a woman");
        let Life::Alive { household, .. } = world.persons[&mother].life else {
            panic!("the mother is a Resident");
        };
        let soul = longest_waiting_soul(&world).expect("a non-player Soul waits");

        assert!(
            bear(&mut world, mother, soul).is_some(),
            "the birth happens"
        );

        let newborn = *world
            .persons
            .keys()
            .next_back()
            .expect("the newborn has the highest Person ID");
        let Life::Alive {
            household: home,
            mood,
            money,
        } = &world.persons[&newborn].life
        else {
            panic!("a newborn is alive");
        };
        assert_eq!(*home, household);
        assert_eq!(mood.get(), 0);
        assert_eq!(*money, 0);
    }
}
