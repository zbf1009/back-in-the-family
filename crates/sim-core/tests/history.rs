//! Property tests for history: preservation (Property 3), death settlement
//! (Property 4), births and arrivals (Property 5), debts (Property 6) and Mood
//! (Property 7).

mod life_gen;

use std::collections::BTreeSet;

use life_gen::*;
use proptest::prelude::*;
use sim_core::ids::PersonId;
use sim_core::values::RelationTag;
use sim_core::world::{Life, SoulPlace, World};

fn is_resident(world: &World, person: PersonId) -> bool {
    world
        .persons()
        .get(&person)
        .is_some_and(|p| matches!(p.life, Life::Alive { .. }))
}

fn is_dead(world: &World, person: PersonId) -> bool {
    world
        .persons()
        .get(&person)
        .is_some_and(|p| matches!(p.life, Life::Dead { .. }))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 3: History is preserved across ticks.
    #[test]
    fn history_is_preserved_across_ticks(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        for tick in 0..TICKS {
            let before = sim.world().clone();
            sim.step();
            let after = sim.world();
            let tick_error = |message: String| format!("seed {} tick {tick}: {message}", scenario.seed);
            prop_assert_eq!(after.tick().0, before.tick().0 + 1);

            // Persons: same identity fields, and the dead stay dead with the same tick.
            for (&id, old) in before.persons() {
                let new = after
                    .persons()
                    .get(&id)
                    .unwrap_or_else(|| panic!("{}", tick_error(format!("person {} vanished", id.0))));
                prop_assert_eq!(new.name, old.name);
                prop_assert_eq!(new.birth_day, old.birth_day);
                prop_assert_eq!(new.sex, old.sex);
                prop_assert_eq!(new.origin, old.origin);
                prop_assert_eq!(&new.traits, &old.traits);
                prop_assert_eq!(new.soul, old.soul);
                match (&old.life, &new.life) {
                    (Life::Dead { death: before }, Life::Dead { death: after }) => {
                        prop_assert_eq!(before, after);
                    }
                    (Life::Dead { .. }, Life::Alive { .. }) => {
                        return Err(TestCaseError::fail(tick_error(format!(
                            "person {} rose from the dead",
                            id.0
                        ))));
                    }
                    (Life::Alive { .. }, _) => {}
                }
            }

            // The log before the tick is an unchanged prefix of the log after it.
            let prefix_end = before.log().len();
            prop_assert_eq!(
                after.log().events().get(..prefix_end),
                Some(before.log().events())
            );
            for (index, event) in after.log().events().iter().enumerate().skip(prefix_end) {
                prop_assert_eq!(event.id.0, u64::try_from(index).unwrap() + 1);
            }

            // New IDs only grow: every new Person, Household, Property and Event gets an
            // ID above every ID that existed before the tick.
            let max_person = before.persons().keys().next_back().copied();
            for &id in after.persons().keys() {
                if !before.persons().contains_key(&id) {
                    prop_assert!(max_person.is_none_or(|max| id > max));
                }
            }
            let max_household = before.households().keys().next_back().copied();
            for &id in after.households().keys() {
                if !before.households().contains_key(&id) {
                    prop_assert!(max_household.is_none_or(|max| id > max));
                }
            }
            let max_property = before.properties().keys().next_back().copied();
            for &id in after.properties().keys() {
                if !before.properties().contains_key(&id) {
                    prop_assert!(max_property.is_none_or(|max| id > max));
                }
            }

            // Souls: same set of Soul IDs, same Player_Soul.
            let before_souls: BTreeSet<_> = before.souls().places.keys().copied().collect();
            let after_souls: BTreeSet<_> = after.souls().places.keys().copied().collect();
            prop_assert_eq!(&before_souls, &after_souls);
            prop_assert_eq!(before.souls().player, after.souls().player);

            // No `spouse` tag disappears.
            for (&(from, to), relation) in before.relations() {
                if relation.tags.contains(RelationTag::Spouse) {
                    let new = after.relations().get(&(from, to)).ok_or_else(|| {
                        TestCaseError::fail(tick_error(format!(
                            "spouse relation {} -> {} vanished",
                            from.0, to.0
                        )))
                    })?;
                    prop_assert!(new.tags.contains(RelationTag::Spouse));
                }
            }

            // Relations whose `from` was already dead never change.
            for (&(from, to), relation) in before.relations() {
                if is_dead(&before, from) {
                    prop_assert_eq!(after.relations().get(&(from, to)), Some(relation));
                }
            }

            // A Relation may disappear only when its `from` died in this tick and it
            // carries no Kinship_Tag (the death step's non-kin removal).
            for (&(from, to), relation) in before.relations() {
                if !after.relations().contains_key(&(from, to)) {
                    let died_this_tick = is_resident(&before, from) && is_dead(&after, from);
                    prop_assert!(
                        died_this_tick && !relation.tags.has_kinship(),
                        "{}",
                        tick_error(format!(
                            "relation {} -> {} vanished without a death of its holder",
                            from.0, to.0
                        ))
                    );
                }
            }

            // Every Relation from a Resident to a Person who died in this tick is kept.
            for (&dead, old) in before.persons() {
                if !(matches!(old.life, Life::Alive { .. }) && is_dead(&after, dead)) {
                    continue;
                }
                for &(from, to) in before.relations().keys() {
                    if to == dead && is_resident(&after, from) {
                        prop_assert!(
                            after.relations().contains_key(&(from, to)),
                            "{}",
                            tick_error(format!(
                                "relation {} -> {} was dropped at the death",
                                from.0, to.0
                            ))
                        );
                    }
                }
            }

            // A waiting Player_Soul keeps waiting with the same `since` (R20.1).
            if let Some(SoulPlace::Waiting { since }) =
                before.souls().places.get(&before.souls().player)
            {
                prop_assert_eq!(
                    after.souls().places.get(&after.souls().player),
                    Some(&SoulPlace::Waiting { since: *since })
                );
            }
        }
    }
}
