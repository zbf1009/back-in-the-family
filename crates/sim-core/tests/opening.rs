//! Property 12: the Opening_World is valid and reproducible (R12.1 to R12.6).

mod life_gen;

use life_gen::*;
use proptest::prelude::*;
use sim_core::events::EventKind;
use sim_core::ids::PersonId;
use sim_core::values::{RelationTag, SocialKind};
use sim_core::world::{Life, SoulPlace, World, WorldConfig};

fn is_resident(world: &World, person: PersonId) -> bool {
    world
        .persons()
        .get(&person)
        .is_some_and(|p| matches!(p.life, Life::Alive { .. }))
}

/// A Resident with a `parent` Relation to another Resident that has the `child`
/// counterpart (R12.2).
fn has_parent_child_pair(world: &World) -> bool {
    world.relations().iter().any(|(&(from, to), relation)| {
        relation.tags.contains(RelationTag::Parent)
            && is_resident(world, from)
            && is_resident(world, to)
            && world
                .relations()
                .get(&(to, from))
                .is_some_and(|reverse| reverse.tags.contains(RelationTag::Child))
    })
}

/// An open Debt between two Residents whose `loan` Event has `due_tick > 0` (R12.3).
fn has_open_loan(world: &World) -> bool {
    world.debts().iter().any(|(loan, debt)| {
        is_resident(world, debt.creditor)
            && is_resident(world, debt.debtor)
            && world
                .log()
                .event(*loan)
                .is_some_and(|event| matches!(event.kind, EventKind::Loan { due, .. } if due.0 > 0))
    })
}

/// A Resident pair with affinity below the grudge threshold and a grievance Event
/// between them (R12.4).
fn has_opening_grudge(world: &World) -> bool {
    world.relations().iter().any(|(&(from, to), relation)| {
        relation.affinity.get() < world.params().grudge_threshold
            && is_resident(world, from)
            && is_resident(world, to)
            && world.log().events().iter().any(|event| {
                matches!(
                    &event.kind,
                    EventKind::Social {
                        kind: SocialKind::Quarrel | SocialKind::Insult | SocialKind::Theft,
                        doer,
                        target,
                        ..
                    } if (*doer == from && *target == to) || (*doer == to && *target == from)
                )
            })
    })
}

/// The Player_Soul is the Soul of a Resident aged 20..=50 (R12.5).
fn player_soul_is_eligible(world: &World) -> bool {
    match world.souls().places.get(&world.souls().player) {
        Some(SoulPlace::Body(person)) => world.persons().get(person).is_some_and(|p| {
            matches!(p.life, Life::Alive { .. }) && (20..=50).contains(&world.age_years(p))
        }),
        _ => false,
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 12: The Opening_World is valid and reproducible.
    #[test]
    fn the_opening_world_is_valid_and_reproducible(seed in any::<u64>(), count in 40u16..=60) {
        let config = WorldConfig::try_new(count).unwrap();
        let world = World::new(seed, config).expect("valid config generates a World");

        // R12.1: exactly N Residents.
        prop_assert_eq!(residents(&world).len(), usize::from(count));
        prop_assert_eq!(world.persons().len(), usize::from(count));
        prop_assert_eq!(world.tick().0, 0);

        // R12.2 to R12.5.
        prop_assert!(
            has_parent_child_pair(&world),
            "seed {seed} N {count}: no parent/child pair"
        );
        prop_assert!(
            has_open_loan(&world),
            "seed {seed} N {count}: no open opening loan"
        );
        prop_assert!(
            has_opening_grudge(&world),
            "seed {seed} N {count}: no opening grudge"
        );
        prop_assert!(
            player_soul_is_eligible(&world),
            "seed {seed} N {count}: Player_Soul is not a Resident aged 20..=50"
        );

        // Properties 1 and 2 hold at the Opening_World.
        let _core = CoreChecker::new(&world);
        check_structure(&world);

        // R12.6: same seed and config give an equal World and Checksum.
        let again = World::new(seed, config).expect("valid config generates a World");
        prop_assert_eq!(&again, &world);
        prop_assert_eq!(checksum(&again), checksum(&world));
        prop_assert_eq!(again.log().digest(), world.log().digest());
    }
}
