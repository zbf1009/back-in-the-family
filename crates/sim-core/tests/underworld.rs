//! The underworld properties of design "Correctness Properties" and the smoke test of
//! the generated underworld run.
//!
//! Every property drives the shared generator in `underworld_gen`, which plans a
//! state-aware mix of valid and invalid inputs for 400 ticks and runs the extended
//! `InvariantChecker` after every tick.

mod underworld_gen;

use sim_core::params::Params;
use underworld_gen::{AppliedCounts, ParamsChoice, Run, Scenario, TICKS};

/// The generator covers every mechanic: over 20 generated runs at least one dream, one
/// haunting, one Bribe, one Birth claim, one Standing claim and one R8.1 placement
/// occurs, so the properties below are not vacuous.
///
/// Every fourth run plans no claim, so its Player_Wait reaches the placement bound.
#[test]
fn twenty_generated_runs_exercise_every_mechanic() {
    let mut params = Params::stress_underworld();
    // A short wait bound and a high mortality floor put a Player_Soul in the queue in
    // every run within a few dozen ticks of the start.
    params.mortality_floor_ppm = 20_000;
    params.player_max_wait = 12;

    let mut counts = AppliedCounts::default();
    let mut placements = 0u64;
    for seed in 1..=20u64 {
        let scenario = Scenario::new(seed, 50, ParamsChoice::StressUnderworld);
        let mut run = Run::with_params(scenario, params);
        run.claims = !seed.is_multiple_of(4);
        for _ in 0..TICKS {
            let (before, after, planned) = run.step();
            counts.add(&planned);
            if underworld_gen::forced_placement(&before, &after, &planned) {
                placements = placements.saturating_add(1);
            }
        }
    }

    assert!(counts.dreams > 0, "no dream applied: {counts:?}");
    assert!(counts.hauntings > 0, "no haunting applied: {counts:?}");
    assert!(counts.bribes > 0, "no Bribe applied: {counts:?}");
    assert!(
        counts.birth_claims > 0,
        "no Birth_Slot claim applied: {counts:?}"
    );
    assert!(
        counts.standing_claims > 0,
        "no Standing_Slot claim applied: {counts:?}"
    );
    assert!(counts.carry_overs > 0, "no Carry_Over applied: {counts:?}");
    assert!(counts.choices > 0, "no External_Choice applied: {counts:?}");
    assert!(placements > 0, "no R8.1 placement happened: {counts:?}");
}
