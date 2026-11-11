//! The shared run generator (task 8.1).
//!
//! The numbered properties are added by tasks 8.2 and 8.3; this file starts with the
//! smoke test that proves the generator and both Params choices run.

mod life_gen;

use life_gen::*;

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