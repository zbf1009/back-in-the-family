//! Salience scoring for Narrator candidates.

use crate::ids::PersonId;
use crate::world::{Life, World};

use super::{PlayerFamily, Stakes};

/// Score a candidate using only ties from the chooser to the staked Persons.
/// Affinity division deliberately rounds toward zero (`i8` -> `i64`).
pub(crate) fn score(world: &World, family: PlayerFamily, body: PersonId, stakes: &Stakes) -> i64 {
    let base = match family {
        PlayerFamily::FamilyDeath | PlayerFamily::Inheritance | PlayerFamily::DebtDue => 20,
        PlayerFamily::Feud => 10,
        PlayerFamily::LifeStage => 100,
    };
    stakes
        .who
        .iter()
        .copied()
        .filter(|person| *person != body)
        .fold(base, |total, person| {
            total.saturating_add(tie(world, body, person))
        })
}

fn tie(world: &World, body: PersonId, person: PersonId) -> i64 {
    let mut value = 0i64;
    if kin(world, body, person) {
        value = value.saturating_add(40);
    }
    if world.debts.values().any(|debt| {
        (debt.debtor == body && debt.creditor == person)
            || (debt.creditor == body && debt.debtor == person)
    }) {
        value = value.saturating_add(20);
    }
    let affinity = world
        .relations
        .get(&(body, person))
        .map_or(0, |relation| i64::from(relation.affinity.get()));
    value = value.saturating_add(affinity.abs() / 5);
    if remembers_earlier_body(world, person, body) {
        value = value.saturating_add(30);
    }
    value
}

fn kin(world: &World, a: PersonId, b: PersonId) -> bool {
    world
        .relations
        .get(&(a, b))
        .is_some_and(|relation| relation.tags.has_kinship())
        || world
            .relations
            .get(&(b, a))
            .is_some_and(|relation| relation.tags.has_kinship())
}

/// A living Resident remembers an earlier body when they have a Relation toward a
/// body carrying the Player Soul. The current body is intentionally excluded.
fn remembers_earlier_body(world: &World, person: PersonId, current: PersonId) -> bool {
    world
        .persons
        .values()
        .filter(|body| body.id != current && body.soul == world.souls.player)
        .any(|earlier| {
            world
                .persons
                .get(&person)
                .is_some_and(|rememberer| matches!(rememberer.life, Life::Alive { .. }))
                && world.relations.contains_key(&(person, earlier.id))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Tick;
    use crate::narrator::StakeUnit;
    use crate::values::{RelationTag, Score};
    use crate::world::WorldConfig;
    use proptest::prelude::*;

    // Feature: first-playable, Property 7: Salience matches the reference formula
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn salience_is_sum_of_independent_tie_terms(
            seed in any::<u64>(),
            offset in 1usize..40,
            affinity in -100i8..=100,
            kinship in any::<bool>(),
        ) {
            let mut world = World::new(seed, WorldConfig::default()).unwrap();
            let crate::world::SoulPlace::Body(body) = world.souls.places[&world.souls.player] else {
                unreachable!("opening is embodied");
            };
            let other = world.persons.keys().copied().filter(|id| *id != body)
                .nth(offset).unwrap_or_else(|| world.persons.keys().copied().find(|id| *id != body).unwrap());
            // Keep just this link and remove any debts involving the pair so the
            // expected sum comes from independent fixture facts, not implementation.
            world.relations.retain(|(a, b), _| (*a, *b) != (body, other) && (*a, *b) != (other, body));
            let mut tags = crate::values::RelTags::empty();
            if kinship { tags.insert(RelationTag::Sibling); }
            world.relations.insert((body, other), crate::world::Relation {
                affinity: Score::clamped(i64::from(affinity)), trust: Score::clamped(0), tags,
            });
            let debt_term = world.debts.values().any(|d|
                (d.debtor == body && d.creditor == other) || (d.creditor == body && d.debtor == other));
            let stakes = Stakes { who: vec![body, other], amount: 1, unit: StakeUnit::Affinity, by: Tick(1) };
            let expected = 10i64
                .saturating_add(if kinship { 40 } else { 0 })
                .saturating_add(if debt_term { 20 } else { 0 })
                .saturating_add(i64::from(affinity).abs() / 5);
            prop_assert_eq!(score(&world, PlayerFamily::Feud, body, &stakes), expected);
        }
    }
}
