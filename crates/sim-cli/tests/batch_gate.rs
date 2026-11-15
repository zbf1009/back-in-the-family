//! Property 23: only zero applied counts on the Devoted list fail reachability.

use proptest::prelude::*;
use sim_cli::batch::{
    DEVOTED_ZERO_COUNT_LIST, PASSIVE_ZERO_COUNT_LIST, Totals, zero_count_failures,
};

struct ReportFigures<'a> {
    totals: &'a Totals,
    player_lives: String,
    auto_placed: u64,
    max_wait_player: u64,
}

#[test]
fn passive_has_no_zero_count_gate() {
    assert!(PASSIVE_ZERO_COUNT_LIST.is_empty());
    assert!(zero_count_failures(&Totals::default(), PASSIVE_ZERO_COUNT_LIST).is_empty());
}

#[test]
fn devoted_requires_the_eight_documented_successes_in_order() {
    assert_eq!(
        DEVOTED_ZERO_COUNT_LIST,
        [
            "dreams",
            "hauntings",
            "bribes",
            "imported_claims",
            "rebuilt_claims",
            "carry_overs",
            "nodes_dream_interpretation",
            "nodes_magistrate_ruling",
        ]
    );
}

#[test]
fn single_zero_and_multiple_zero_counts_fail_but_birth_claims_do_not() {
    let mut totals = Totals {
        dreams: 1,
        hauntings: 1,
        bribes: 1,
        birth_claims: 0,
        imported_claims: 1,
        rebuilt_claims: 1,
        carry_overs: 1,
        nodes_dream_interpretation: 1,
        nodes_magistrate_ruling: 1,
    };
    assert!(zero_count_failures(&totals, DEVOTED_ZERO_COUNT_LIST).is_empty());
    totals.rebuilt_claims = 0;
    assert_eq!(
        zero_count_failures(&totals, DEVOTED_ZERO_COUNT_LIST),
        ["rebuilt_claims"]
    );
    totals.hauntings = 0;
    totals.nodes_magistrate_ruling = 0;
    assert_eq!(
        zero_count_failures(&totals, DEVOTED_ZERO_COUNT_LIST),
        ["hauntings", "rebuilt_claims", "nodes_magistrate_ruling"]
    );
    assert_eq!(
        zero_count_failures(&Totals::default(), DEVOTED_ZERO_COUNT_LIST),
        DEVOTED_ZERO_COUNT_LIST
    );
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 1_000, ..ProptestConfig::default() })]

    // Feature: underworld, Property 23: The Devoted zero-count gate fails exactly on a listed zero count.
    #[test]
    fn property_23_only_devoted_zero_successes_fail(
        zero_mask in any::<u8>(),
        positive in proptest::array::uniform8(1u64..=u64::MAX),
        birth_claims in any::<u64>(),
        other_birth_claims in any::<u64>(),
        player_lives in any::<String>(),
        auto_placed in any::<u64>(),
        max_wait_player in any::<u64>(),
        other_player_lives in any::<String>(),
        other_auto_placed in any::<u64>(),
        other_max_wait_player in any::<u64>(),
    ) {
        // Generate the expected failure set from the input mask, not from Totals or
        // the production function's name-to-field selection.
        let totals = Totals {
            dreams: if zero_mask & 1 != 0 { 0 } else { positive[0] },
            hauntings: if zero_mask & 2 != 0 { 0 } else { positive[1] },
            bribes: if zero_mask & 4 != 0 { 0 } else { positive[2] },
            birth_claims,
            imported_claims: if zero_mask & 8 != 0 { 0 } else { positive[3] },
            rebuilt_claims: if zero_mask & 16 != 0 { 0 } else { positive[4] },
            carry_overs: if zero_mask & 32 != 0 { 0 } else { positive[5] },
            nodes_dream_interpretation: if zero_mask & 64 != 0 { 0 } else { positive[6] },
            nodes_magistrate_ruling: if zero_mask & 128 != 0 { 0 } else { positive[7] },
        };
        let expected: Vec<_> = DEVOTED_ZERO_COUNT_LIST
            .iter()
            .enumerate()
            .filter_map(|(index, &name)| (zero_mask & (1 << index) != 0).then_some(name))
            .collect();
        let first = ReportFigures { totals: &totals, player_lives, auto_placed, max_wait_player };
        let mut changed = totals;
        changed.birth_claims = other_birth_claims;
        let second = ReportFigures {
            totals: &changed,
            player_lives: other_player_lives,
            auto_placed: other_auto_placed,
            max_wait_player: other_max_wait_player,
        };
        let first_failures = zero_count_failures(first.totals, DEVOTED_ZERO_COUNT_LIST);
        prop_assert_eq!(&first_failures, &expected);
        prop_assert_eq!(first_failures.is_empty(), zero_mask == 0);
        prop_assert_eq!(zero_count_failures(second.totals, DEVOTED_ZERO_COUNT_LIST), first_failures,
            "report-only figures changed from {:?} to {:?}",
            (&first.player_lives, first.auto_placed, first.max_wait_player),
            (&second.player_lives, second.auto_placed, second.max_wait_player));
    }
}
