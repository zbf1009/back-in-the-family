//! Properties 14 and 16: every state field reaches the Checksum (R5.10) and
//! rebuilding Derived_State changes nothing (R16.5).

mod life_gen;

use life_gen::*;
use proptest::prelude::*;
use sim_core::input::RejectReason;
use sim_core::testing::{Mutation, apply};

/// Every [`Mutation`] except the two `Derived` ones: `Derived` is not encoded, so those
/// two are the documented exception (R16.5, `testing.rs`) and Property 16 covers them.
fn arb_mutation() -> impl Strategy<Value = Mutation> {
    (
        0usize..40,
        any::<u64>(),
        any::<u64>(),
        any::<u8>(),
        any::<bool>(),
    )
        .prop_map(|(index, first, second, part, up)| match index {
            0 => Mutation::Seed { bit: part },
            1 => Mutation::ConfigOpeningResidents,
            2 => Mutation::ParamsUpkeep,
            3 => Mutation::Tick,
            4 => Mutation::PersonIdCounter,
            5 => Mutation::HouseholdIdCounter,
            6 => Mutation::PropertyIdCounter,
            7 => Mutation::SoulIdCounter,
            8 => Mutation::PersonField {
                person: first,
                part,
            },
            9 => Mutation::AddPerson,
            10 => Mutation::RemovePerson { person: first },
            11 => Mutation::AddHousehold,
            12 => Mutation::RemoveHousehold { household: first },
            13 => Mutation::AddProperty,
            14 => Mutation::RemoveProperty { property: first },
            15 => Mutation::PropertyKindField { property: first },
            16 => Mutation::PropertyOwner { property: first },
            17 => Mutation::RelationAffinity {
                from: first,
                to: second,
                up,
            },
            18 => Mutation::RelationTrust {
                from: first,
                to: second,
                up,
            },
            19 => Mutation::RelationTags {
                from: first,
                to: second,
            },
            20 => Mutation::AddRelation {
                from: first,
                to: second,
            },
            21 => Mutation::RemoveRelation {
                from: first,
                to: second,
            },
            22 => Mutation::AddDebt,
            23 => Mutation::RemoveDebt { debt: first },
            24 => Mutation::DebtOpen { debt: first, up },
            25 => Mutation::DebtDue { debt: first },
            26 => Mutation::DebtPrincipal { debt: first },
            27 => Mutation::DebtCreditor { debt: first },
            28 => Mutation::DebtDebtor { debt: first },
            29 => Mutation::SoulPlaceField { soul: first },
            30 => Mutation::AddSoul,
            31 => Mutation::RemoveSoul { soul: first },
            32 => Mutation::PlayerSoul,
            33 => Mutation::EventTick { event: first },
            34 => Mutation::AddEvent,
            35 => Mutation::DropEvent { event: first },
            36 => Mutation::FlowSources,
            37 => Mutation::FlowSinks,
            38 => Mutation::RejectionCount {
                reason: [
                    RejectReason::UnknownPerson,
                    RejectReason::DeadPerson,
                    RejectReason::SelfTarget,
                    RejectReason::IntensityOutOfRange,
                    RejectReason::IdExhausted,
                ][usize::from(part) % 5],
            },
            _ => Mutation::RejectionLast { part },
        })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 14: Every state field reaches the Checksum.
    #[test]
    fn every_state_field_reaches_the_checksum(
        scenario in arb_scenario(),
        ticks in 0u64..TICKS,
        mutation in arb_mutation(),
    ) {
        let mut sim = scenario.sim();
        for _ in 0..ticks {
            sim.step();
        }
        let mut world = sim.world().clone();
        let before = world.clone();
        let checksum_before = checksum(&world);
        let changed = apply(&mut world, mutation);
        // Some mutations have no target in this World (an empty collection, or a field
        // that only exists on a living Person). They did not change the World, so they
        // are not a state field to reach the checksum.
        if !changed || world == before {
            return Ok(());
        }
        prop_assert_ne!(
            checksum(&world),
            checksum_before,
            "mutation {:?} changed the World but not the checksum",
            mutation
        );
    }

    // Feature: life-sim, Property 16: Rebuilding Derived_State changes nothing.
    #[test]
    fn rebuilding_derived_state_changes_nothing(
        scenario in arb_scenario(),
        at in 0u64..TICKS,
    ) {
        let (mut original, inputs) = scenario.world_and_inputs();
        let (mut rebuilt, _) = scenario.world_and_inputs();
        for tick in 0..TICKS {
            let current = original.tick();
            let original_checksum = original.step(inputs.for_tick(current));
            let rebuilt_checksum = rebuilt.step(inputs.for_tick(current));
            prop_assert_eq!(
                original_checksum,
                rebuilt_checksum,
                "seed {} tick {}: the rebuilt copy diverged",
                scenario.seed,
                tick
            );
            if tick == at {
                rebuilt.discard_derived();
                rebuilt.rebuild_derived();
                prop_assert_eq!(checksum(&rebuilt), checksum(&original));
            }
        }
    }
}
