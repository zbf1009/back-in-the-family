//! Property 23: the nine checked batch totals are independent of report-only figures.

use proptest::prelude::*;
use sim_cli::batch::{Totals, zero_count_failures};

struct ReportFigures<'a> {
    totals: &'a Totals,
    player_lives: String,
    auto_placed: u64,
    max_wait_player: u64,
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 1_000, ..ProptestConfig::default() })]

    // Feature: underworld, Property 23: The zero-count gate fails exactly on a zero total.
    #[test]
    fn property_23_zero_count_failures_match_only_zero_totals(
        counts in proptest::array::uniform9((any::<bool>(), 1u64..=u64::MAX)),
        player_lives in any::<String>(),
        auto_placed in any::<u64>(),
        max_wait_player in any::<u64>(),
        other_player_lives in any::<String>(),
        other_auto_placed in any::<u64>(),
        other_max_wait_player in any::<u64>(),
    ) {
        let values = counts.map(|(zero, nonzero)| if zero { 0 } else { nonzero });
        let totals = Totals {
            dreams: values[0],
            hauntings: values[1],
            bribes: values[2],
            birth_claims: values[3],
            imported_claims: values[4],
            rebuilt_claims: values[5],
            carry_overs: values[6],
            nodes_dream_interpretation: values[7],
            nodes_magistrate_ruling: values[8],
        };
        let names = [
            "dreams",
            "hauntings",
            "bribes",
            "birth_claims",
            "imported_claims",
            "rebuilt_claims",
            "carry_overs",
            "nodes_dream_interpretation",
            "nodes_magistrate_ruling",
        ];
        // The mask is generated independently of the values passed to the function.
        let expected: Vec<_> = names
            .into_iter()
            .zip(counts)
            .filter_map(|(name, (zero, _))| zero.then_some(name))
            .collect();
        let first = ReportFigures { totals: &totals, player_lives, auto_placed, max_wait_player };
        let second = ReportFigures {
            totals: &totals,
            player_lives: other_player_lives,
            auto_placed: other_auto_placed,
            max_wait_player: other_max_wait_player,
        };
        let first_failures = zero_count_failures(first.totals);
        prop_assert_eq!(&first_failures, &expected);
        prop_assert_eq!(first_failures.is_empty(), counts.iter().all(|(zero, _)| !zero));
        prop_assert_eq!(zero_count_failures(second.totals), first_failures,
            "report-only figures changed from {:?} to {:?}",
            (&first.player_lives, first.auto_placed, first.max_wait_player),
            (&second.player_lives, second.auto_placed, second.max_wait_player));
    }
}
