//! Properties 9 and 10: a valid `Act` changes the Checksum, an invalid one is skipped
//! and recorded (R1.4, R1.5, R6.5).

mod life_gen;

use life_gen::*;
use proptest::prelude::*;
use sim_core::ids::{InputSeq, PersonId, Tick};
use sim_core::input::{InputPayload, RejectReason};
use sim_core::values::SocialKind;
use sim_core::world::World;

const KINDS: [SocialKind; 6] = [
    SocialKind::Help,
    SocialKind::Gift,
    SocialKind::Quarrel,
    SocialKind::Insult,
    SocialKind::Theft,
    SocialKind::Apology,
];

fn act(kind: SocialKind, actor: PersonId, target: PersonId, intensity: u8) -> InputPayload {
    InputPayload::Act {
        kind,
        actor,
        target,
        intensity,
    }
}

fn first_two_residents(world: &World) -> Option<(PersonId, PersonId)> {
    let mut ids = residents(world).into_iter();
    Some((ids.next()?, ids.next()?))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 9: A valid Act changes the Checksum.
    #[test]
    fn a_valid_act_changes_the_checksum(
        scenario in arb_run(),
        at in 0u64..TICKS,
        kind in 0usize..6,
        intensity in 1u8..=100,
    ) {
        let mut with = scenario.sim();
        let mut without = scenario.sim();
        for _ in 0..at {
            with.step();
            without.step();
        }
        let (actor, target) = first_two_residents(with.world()).expect("a town has residents");
        with.submit(Tick(at), act(KINDS[kind], actor, target, intensity))
            .expect("input is for the current tick");
        let with_tick = with.step();
        let without_tick = without.step();
        prop_assert_ne!(
            with_tick,
            without_tick,
            "seed {} tick {}: a valid Act left the checksum unchanged",
            scenario.seed,
            at
        );
        // The states stay different, so the checksums do too.
        for _ in 0..3 {
            prop_assert_ne!(with.step(), without.step());
        }
    }

    // Feature: life-sim, Property 10: An invalid input is skipped and recorded.
    #[test]
    fn an_invalid_input_is_skipped_and_recorded(
        scenario in arb_run(),
        at in 0u64..TICKS,
        reason in 0usize..4,
        intensity_raw in 0u8..=255,
        unknown_offset in 0u64..1000,
    ) {
        let mut with = scenario.sim();
        let mut without = scenario.sim();
        for _ in 0..at {
            with.step();
            without.step();
        }
        let (first, second) = first_two_residents(with.world()).expect("a town has residents");
        let dead = dead_persons(with.world());
        let (payload, expected_reason) = match reason {
            0 => {
                // A Person ID that no opening Resident has.
                let unknown = PersonId(
                    with.world()
                        .persons()
                        .keys()
                        .next_back()
                        .map_or(1_000_000, |last| last.0 + 1000 + unknown_offset),
                );
                (act(SocialKind::Help, unknown, first, 40), RejectReason::UnknownPerson)
            }
            1 => {
                prop_assume!(!dead.is_empty());
                (act(SocialKind::Help, first, dead[0], 40), RejectReason::DeadPerson)
            }
            2 => (act(SocialKind::Insult, first, first, 40), RejectReason::SelfTarget),
            _ => {
                let intensity = if intensity_raw % 2 == 0 {
                    0
                } else {
                    101 + intensity_raw % 155
                };
                (
                    act(SocialKind::Gift, first, second, intensity),
                    RejectReason::IntensityOutOfRange,
                )
            }
        };
        with.submit(Tick(at), payload)
            .expect("input is for the current tick");
        with.step();
        without.step();

        assert_same_except_rejections(with.world(), without.world());
        let rejections = with.world().rejections();
        prop_assert_eq!(
            rejections.count_by_reason.get(&expected_reason).copied(),
            Some(1),
            "seed {} tick {}: wrong rejection count for {:?}",
            scenario.seed,
            at,
            expected_reason
        );
        prop_assert_eq!(
            rejections.count_by_reason.len(),
            1,
            "seed {} tick {}: an unrelated rejection was recorded",
            scenario.seed,
            at
        );
        prop_assert_eq!(
            rejections.last,
            Some((Tick(at), InputSeq(0), expected_reason))
        );
    }
}
