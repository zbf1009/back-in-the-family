//! One end-to-end run with the invariant checker (R17.6).
//!
//! The skeleton properties are gone. Task 8 adds the life-sim properties to their own
//! files (`tests/invariants.rs`, `tests/history.rs`, `tests/inputs.rs`, ...); this file
//! keeps one simple test so the checker runs against a real 240-tick run before then.

use sim_core::invariants::InvariantChecker;
use sim_core::tick::Sim;
use sim_core::world::WorldConfig;

#[test]
fn a_240_tick_run_passes_the_invariant_checker() {
    for seed in [0u64, 1, 42] {
        let config = WorldConfig::try_new(40).unwrap();
        let mut sim = Sim::new(seed, config).unwrap();
        let mut checker = InvariantChecker::new(sim.world())
            .unwrap_or_else(|violation| panic!("seed {seed}, opening: {violation}"));
        for tick in 0..240 {
            sim.step();
            checker
                .after_tick(sim.world())
                .unwrap_or_else(|violation| panic!("seed {seed}, tick {tick}: {violation}"));
        }
        assert_eq!(sim.world().tick().0, 240);
        assert_eq!(
            sim.world().persons().len(),
            40,
            "no births or deaths yet: steps 3 to 11 are still empty"
        );
    }
}
