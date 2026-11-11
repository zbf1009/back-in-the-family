//! Property tests for the core and structural invariants (tasks 8.2, 8.3).
//!
//! Both properties run a generated scenario for 240 ticks. Each tick is checked twice:
//! by `life_gen`'s direct assertions (independent of the checker) and by
//! [`InvariantChecker`], the same code `sim-cli batch` uses.

mod life_gen;

use life_gen::*;
use proptest::prelude::*;
use sim_core::invariants::InvariantChecker;

#[test]
fn the_generator_builds_runnable_scenarios() {
    for (params, expected) in [
        (ParamsChoice::Stress, 40u16),
        (ParamsChoice::Default, 60u16),
    ] {
        let scenario = Scenario {
            seed: 7,
            residents: expected,
            params,
            inputs: Vec::new(),
        };
        let mut sim = scenario.sim();
        assert_eq!(residents(sim.world()).len(), usize::from(expected));
        for _ in 0..TICKS {
            sim.step();
        }
        assert_eq!(sim.world().tick().0, TICKS);
        assert!(!sim.world().log().is_empty());
        assert_eq!(sim.checksums().len(), usize::try_from(TICKS).unwrap());
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 1: Core invariants hold at the end of every tick.
    #[test]
    fn core_invariants_hold_at_the_end_of_every_tick(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        let mut core = CoreChecker::new(sim.world());
        let mut checker = InvariantChecker::new(sim.world())
            .unwrap_or_else(|violation| panic!("opening world: {violation}"));
        for tick in 0..TICKS {
            let before = sim.world().clone();
            sim.step();
            let after = sim.world();
            core.after_tick(&before, after);
            checker
                .after_tick(after)
                .unwrap_or_else(|violation| {
                    panic!("seed {} tick {tick}: {violation}", scenario.seed)
                });
        }
        prop_assert_eq!(sim.world().tick().0, TICKS);
    }

    // Feature: life-sim, Property 2: Structural invariants hold at the end of every tick.
    #[test]
    fn structural_invariants_hold_at_the_end_of_every_tick(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        check_structure(sim.world());
        let mut checker = InvariantChecker::new(sim.world())
            .unwrap_or_else(|violation| panic!("opening world: {violation}"));
        for tick in 0..TICKS {
            sim.step();
            check_structure(sim.world());
            checker
                .after_tick(sim.world())
                .unwrap_or_else(|violation| {
                    panic!("seed {} tick {tick}: {violation}", scenario.seed)
                });
        }
        prop_assert_eq!(sim.world().tick().0, TICKS);
    }
}
