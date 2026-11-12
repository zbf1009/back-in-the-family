//! Outsider releases (design "Outsiders", R11, R20).
//!
//! Step 3 of the tick. Every waiting Soul other than the Player_Soul whose wait exceeds
//! `MAX_WAIT` is released, in Soul ID order: the body kind is a seeded roll per Soul
//! (OP-4 A: `rebuilt_share_ppm` of releases become Rebuilt_Bodies, the rest Imported_Vessels),
//! the body is 18..=40 years old with fresh Traits and a fresh name whose surname no living
//! Resident uses (design "Outsiders", Author decision 2026-11-11: the free surnames in
//! ascending index, `free[below(draw, count)]`, falling back to a draw over all 60 only
//! when every surname is in use), it arrives with the
//! `ArrivalEndowment` source in its own single-person Household and with no Relations,
//! and the release appends one `possession` or `rebuild` Event (R11.2).
//!
//! Releases come first in the tick, so R11.1 holds "when the tick begins" and the freed
//! Soul can be counted by the death and birth steps of the same tick.

use std::collections::BTreeSet;

use crate::economy::{Flow, flow};
use crate::events::{CausedBy, EventKind, EventTags};
use crate::ids::{HouseholdId, PersonId, SoulId};
use crate::names::{SURNAME_COUNT, pick_full_name};
use crate::params::draw_trait;
use crate::rng::{StreamTag, below, draw, in_range};
use crate::values::{Mood, Origin, Sex, Traits};
use crate::world::{Household, Life, Person, SoulPlace, World};

/// Fixed draw sites, keyed by the released Soul (kind, age, sex, wage, endowment) or by
/// the new Person (name, the seven Traits).
const RELEASE_KIND: u64 = 0;
const RELEASE_AGE: u64 = 1;
const RELEASE_BIRTH_EXTRA: u64 = 2;
const RELEASE_SEX: u64 = 3;
const RELEASE_WAGE: u64 = 4;
const RELEASE_ENDOWMENT: u64 = 5;
const RELEASE_SURNAME: u64 = 6;
const RELEASE_NAME: u64 = 0;
const RELEASE_TRAIT_BASE: u64 = 0;

/// Endowment band of an arriving outsider, in dollars (design "Outsiders").
const ENDOWMENT_MIN: i64 = 500;
const ENDOWMENT_MAX: i64 = 3_000;

/// Releases every non-player Soul whose wait exceeds Max_Wait, in Soul ID order.
pub(crate) fn release_outsiders(world: &mut World) {
    let player = world.souls.player;
    let max_wait = world.params.max_wait;
    let released: Vec<SoulId> = world
        .souls
        .places
        .iter()
        .filter(|(soul, place)| {
            **soul != player
                && match **place {
                    SoulPlace::Waiting { since } => world
                        .tick
                        .0
                        .checked_sub(since.0)
                        .is_some_and(|waited| waited > max_wait),
                    SoulPlace::Body(_) => false,
                }
        })
        .map(|(soul, _)| *soul)
        .collect();
    for soul in released {
        release(world, soul);
    }
}

/// Creates the outsider body for one released Soul (design "Outsiders").
fn release(world: &mut World, soul: SoulId) {
    if !matches!(
        world.souls.places.get(&soul),
        Some(SoulPlace::Waiting { .. })
    ) {
        return;
    }
    let key = soul.rng_key();
    let rebuilt = below(
        draw(
            world.seed,
            key,
            StreamTag::Outsiders,
            world.tick,
            RELEASE_KIND,
        ),
        1_000_000,
    ) < u64::from(world.params.rebuilt_share_ppm);
    let origin = if rebuilt {
        Origin::Rebuilt
    } else {
        Origin::Possessed
    };
    let age = u16::try_from(in_range(
        draw(
            world.seed,
            key,
            StreamTag::Outsiders,
            world.tick,
            RELEASE_AGE,
        ),
        i64::from(world.params.outsider_age_min),
        i64::from(world.params.outsider_age_max),
    ))
    .unwrap_or(world.params.outsider_age_min);
    let extra_days = i64::try_from(below(
        draw(
            world.seed,
            key,
            StreamTag::Outsiders,
            world.tick,
            RELEASE_BIRTH_EXTRA,
        ),
        365,
    ))
    .unwrap_or(0);
    let today = i64::try_from(world.tick.0).unwrap_or(i64::MAX);
    let birth_day = today
        .saturating_sub(i64::from(age).saturating_mul(365))
        .saturating_sub(extra_days);
    let sex = if draw(
        world.seed,
        key,
        StreamTag::Outsiders,
        world.tick,
        RELEASE_SEX,
    ) & 1
        == 0
    {
        Sex::Female
    } else {
        Sex::Male
    };
    let wage = u16::try_from(in_range(
        draw(
            world.seed,
            key,
            StreamTag::Outsiders,
            world.tick,
            RELEASE_WAGE,
        ),
        i64::from(world.params.wage_min),
        i64::from(world.params.wage_max),
    ))
    .unwrap_or(world.params.wage_min);
    let endowment = u64::try_from(in_range(
        draw(
            world.seed,
            key,
            StreamTag::Outsiders,
            world.tick,
            RELEASE_ENDOWMENT,
        ),
        ENDOWMENT_MIN,
        ENDOWMENT_MAX,
    ))
    .unwrap_or(0);

    let Ok(raw_person) = world.person_ids.next() else {
        return;
    };
    let id = PersonId(raw_person);
    let Ok(raw_household) = world.household_ids.next() else {
        return;
    };
    let household = HouseholdId(raw_household);
    let traits = draw_traits(world, id);
    let used: BTreeSet<u16> = world
        .derived
        .living_names
        .iter()
        .map(|name| name.surname)
        .collect();
    let surname = outsider_surname(
        draw(
            world.seed,
            key,
            StreamTag::Outsiders,
            world.tick,
            RELEASE_SURNAME,
        ),
        &used,
    );
    let name = pick_full_name(
        sex == Sex::Female,
        surname,
        draw(
            world.seed,
            id.rng_key(),
            StreamTag::Names,
            world.tick,
            RELEASE_NAME,
        ),
        &world.derived.living_names,
    );

    world.households.insert(
        household,
        Household {
            id: household,
            founded: world.tick,
        },
    );
    world.derived.living_names.insert(name);
    world.persons.insert(
        id,
        Person {
            id,
            name,
            birth_day,
            sex,
            origin,
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
    world.souls.places.insert(soul, SoulPlace::Body(id));
    // The endowment is the `ArrivalEndowment` source (design "Money_Flow list").
    flow(world, Flow::ArrivalEndowment { to: id }, endowment);
    let kind = if rebuilt {
        EventKind::Rebuild {
            person: id,
            price: 0,
        }
    } else {
        EventKind::Possession {
            person: id,
            price: 0,
        }
    };
    if let Err(refused) = world.append(kind, CausedBy::default(), EventTags::empty()) {
        // Unreachable: the new Person is known and alive and the counter has room.
        debug_assert!(false, "the arrival Event was refused: {refused:?}");
    }
}

/// Picks the surname of an arriving outsider (design "Outsiders", Author decision
/// 2026-11-11): the surnames `0..SURNAME_COUNT` that `used` does not hold, in ascending
/// index, chosen with `below(draw, count)`; when every surname is in use, a plain
/// `below(draw, SURNAME_COUNT)` over all 60.
fn outsider_surname(draw: u64, used: &BTreeSet<u16>) -> u16 {
    let count = u16::try_from(SURNAME_COUNT).unwrap_or(0);
    let free: Vec<u16> = (0..count)
        .filter(|surname| !used.contains(surname))
        .collect();
    if free.is_empty() {
        return u16::try_from(below(draw, u64::from(count))).unwrap_or(0);
    }
    let index = usize::try_from(below(draw, u64::try_from(free.len()).unwrap_or(1))).unwrap_or(0);
    free.get(index).copied().unwrap_or(0)
}

/// Seven fresh Traits keyed by the new Person, through the shared weighted draw
/// (design "Trait draws", Author 2026-11-11).
fn draw_traits(world: &World, person: PersonId) -> Traits {
    let trait_at = |index: u64| {
        draw_trait(draw(
            world.seed,
            person.rng_key(),
            StreamTag::Traits,
            world.tick,
            RELEASE_TRAIT_BASE.saturating_add(index),
        ))
    };
    Traits {
        greed: trait_at(0),
        loyalty: trait_at(1),
        pride: trait_at(2),
        warmth: trait_at(3),
        temper: trait_at(4),
        vindictiveness: trait_at(5),
        piety: trait_at(6),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Tick;
    use crate::params::Params;
    use crate::world::WorldConfig;

    fn world() -> World {
        World::new(7, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn waiting_souls(world: &World) -> Vec<SoulId> {
        world
            .souls
            .places
            .iter()
            .filter(|(_, place)| matches!(place, SoulPlace::Waiting { .. }))
            .map(|(&soul, _)| soul)
            .collect()
    }

    #[test]
    fn a_waiting_player_soul_past_max_wait_is_not_released() {
        let mut world = world();
        let player = world.souls.player;
        // Only the Player_Soul waits, and it has waited far longer than Max_Wait.
        for (soul, place) in world.souls.places.clone() {
            if soul != player && matches!(place, SoulPlace::Waiting { .. }) {
                let body = world
                    .persons
                    .keys()
                    .next()
                    .copied()
                    .expect("the town has Persons");
                world.souls.places.insert(soul, SoulPlace::Body(body));
            }
        }
        world
            .souls
            .places
            .insert(player, SoulPlace::Waiting { since: Tick(0) });
        world.tick = Tick(world.params.max_wait.saturating_add(10));
        let persons_before = world.persons.len();

        release_outsiders(&mut world);

        assert_eq!(
            world.souls.places[&player],
            SoulPlace::Waiting { since: Tick(0) },
            "the Player_Soul stays waiting (R20.2)"
        );
        assert_eq!(world.persons.len(), persons_before, "no outsider body");
    }

    #[test]
    fn a_soul_at_exactly_max_wait_waits_one_more_day() {
        let mut world = world();
        let player = world.souls.player;
        let waiting = waiting_souls(&world);
        let soul = waiting
            .iter()
            .copied()
            .find(|&soul| soul != player)
            .expect("a non-player Soul waits");
        // Every waiting Soul starts its wait on the same day.
        for waiting_soul in &waiting {
            world
                .souls
                .places
                .insert(*waiting_soul, SoulPlace::Waiting { since: Tick(10) });
        }
        let max_wait = world.params.max_wait;
        world.tick = Tick(10u64.saturating_add(max_wait));
        let persons_before = world.persons.len();

        release_outsiders(&mut world);

        assert_eq!(
            world.persons.len(),
            persons_before,
            "exactly Max_Wait waits"
        );
        assert!(matches!(
            world.souls.places[&soul],
            SoulPlace::Waiting { .. }
        ));

        world.tick = Tick(11u64.saturating_add(max_wait));
        release_outsiders(&mut world);

        let released = u64::try_from(waiting.len()).unwrap_or(0);
        assert_eq!(
            world.persons.len(),
            persons_before.saturating_add(usize::try_from(released).unwrap_or(0)),
            "one day past Max_Wait releases every waiting Soul"
        );
        assert!(matches!(world.souls.places[&soul], SoulPlace::Body(_)));
        assert!(
            !waiting_souls(&world).contains(&soul),
            "the released Soul left the Waiting_Queue"
        );
    }

    #[test]
    fn an_arrival_has_a_fresh_body_a_household_and_no_relations() {
        let mut world =
            World::new_with_params(3, WorldConfig::try_new(40).unwrap(), Params::DEFAULT).unwrap();
        let player = world.souls.player;
        let soul = waiting_souls(&world)
            .into_iter()
            .find(|&soul| soul != player)
            .expect("a non-player Soul waits");
        world.tick = Tick(world.params.max_wait.saturating_add(1));
        let total_before = crate::invariants::total_money(&world);
        let sources_before = world.flows.sources;

        release_outsiders(&mut world);

        let Some(SoulPlace::Body(newcomer)) = world.souls.places.get(&soul) else {
            panic!("the released Soul has a body");
        };
        let newcomer = *newcomer;
        let person = &world.persons[&newcomer];
        assert!(matches!(person.origin, Origin::Possessed | Origin::Rebuilt));
        assert!(matches!(person.life, Life::Alive { .. }));
        assert!(world.age_years(person) >= 18 && world.age_years(person) <= 40);
        assert_eq!(person.soul, soul);
        let Life::Alive {
            household, money, ..
        } = person.life
        else {
            panic!("an arrival is a Resident");
        };
        assert_eq!(
            world.household_members(household),
            vec![newcomer],
            "a new single-person Household"
        );
        assert!(
            !world
                .relations
                .keys()
                .any(|&(from, to)| from == newcomer || to == newcomer),
            "no Relations at arrival (R11.2)"
        );
        assert!(
            (500..=3_000).contains(&money),
            "the endowment is in the documented band"
        );
        let source_delta = world.flows.sources.saturating_sub(sources_before);
        assert!(
            source_delta >= money,
            "the endowment is an ArrivalEndowment source"
        );
        assert_eq!(
            crate::invariants::total_money(&world),
            total_before.saturating_add(source_delta),
            "the endowments are the only change in total money"
        );
        assert!(
            world.log.events().iter().any(|event| matches!(
                event.kind,
                EventKind::Possession { person, .. } | EventKind::Rebuild { person, .. }
                    if person == newcomer
            )),
            "one possession or rebuild Event"
        );
    }

    #[test]
    fn an_outsider_surname_is_never_one_in_use() {
        let sparse: BTreeSet<u16> = [5, 17, 42].into_iter().collect();
        let nearly_full: BTreeSet<u16> = (0..59).collect();
        for used in [&sparse, &nearly_full] {
            for draw in [0u64, 1, 7, 123_456, u64::MAX] {
                let surname = outsider_surname(draw, used);
                assert!(!used.contains(&surname), "draw {draw}");
                assert!(usize::from(surname) < SURNAME_COUNT, "draw {draw}");
            }
        }
    }

    #[test]
    fn an_outsider_surname_falls_back_to_all_surnames_when_none_is_free() {
        let used: BTreeSet<u16> = (0..u16::try_from(SURNAME_COUNT).unwrap()).collect();
        for draw in [0u64, 1, 7, 123_456, u64::MAX] {
            let surname = outsider_surname(draw, &used);
            assert_eq!(u64::from(surname), below(draw, 60), "draw {draw}");
            assert!(usize::from(surname) < SURNAME_COUNT, "draw {draw}");
        }
    }

    /// A World where exactly one non-player Soul waits; it is the only one released.
    fn one_waiting_soul(seed: u64) -> (World, SoulId) {
        let mut world = World::new(seed, WorldConfig::try_new(40).unwrap()).unwrap();
        let player = world.souls.player;
        let body = world
            .persons
            .keys()
            .next()
            .copied()
            .expect("the town has Persons");
        let waiting: Vec<SoulId> = waiting_souls(&world)
            .into_iter()
            .filter(|&soul| soul != player)
            .collect();
        assert!(waiting.len() >= 2, "the opening world waits with two Souls");
        for &soul in &waiting {
            world.souls.places.insert(soul, SoulPlace::Body(body));
        }
        let soul = waiting[0];
        world
            .souls
            .places
            .insert(soul, SoulPlace::Waiting { since: Tick(0) });
        (world, soul)
    }

    fn name_of(world: &World, soul: SoulId) -> crate::names::FullName {
        let SoulPlace::Body(person) = world.souls.places[&soul] else {
            panic!("the released Soul has a body");
        };
        world.persons[&person].name
    }

    #[test]
    fn a_world_arrival_surname_is_unused_by_the_other_residents() {
        let (mut world, soul) = one_waiting_soul(11);
        world.tick = Tick(world.params.max_wait.saturating_add(1));

        release_outsiders(&mut world);

        let newcomer = name_of(&world, soul);
        for (&id, person) in &world.persons {
            if matches!(person.life, Life::Alive { .. }) && person.name != newcomer {
                assert_ne!(
                    person.name.surname, newcomer.surname,
                    "{id:?} shares the arrival's surname"
                );
            }
        }
    }

    #[test]
    fn clones_release_the_same_name_at_the_same_tick() {
        let (world, soul) = one_waiting_soul(23);
        let mut first = world.clone();
        let mut second = world;
        first.tick = Tick(first.params.max_wait.saturating_add(1));
        second.tick = Tick(second.params.max_wait.saturating_add(1));

        release_outsiders(&mut first);
        release_outsiders(&mut second);

        assert_eq!(name_of(&first, soul), name_of(&second, soul));
    }

    fn release_all(share_ppm: u32) -> Vec<Origin> {
        let mut params = Params::DEFAULT;
        params.rebuilt_share_ppm = share_ppm;
        let mut world =
            World::new_with_params(5, WorldConfig::try_new(40).unwrap(), params).unwrap();
        let player = world.souls.player;
        let souls: Vec<SoulId> = waiting_souls(&world)
            .into_iter()
            .filter(|&soul| soul != player)
            .collect();
        assert!(souls.len() >= 2, "the opening world waits with two Souls");
        world.tick = Tick(world.params.max_wait.saturating_add(1));

        release_outsiders(&mut world);

        souls
            .into_iter()
            .map(|soul| {
                let SoulPlace::Body(person) = world.souls.places[&soul] else {
                    panic!("a released Soul has a body (R11.4)");
                };
                world.persons[&person].origin
            })
            .collect()
    }

    #[test]
    fn the_rebuilt_share_follows_the_parameter() {
        assert!(
            release_all(1_000_000)
                .iter()
                .all(|origin| *origin == Origin::Rebuilt),
            "a full rebuilt share makes every body rebuilt"
        );
        assert!(
            release_all(0)
                .iter()
                .all(|origin| *origin == Origin::Possessed),
            "a zero rebuilt share makes every body an Imported_Vessel"
        );
    }
}
