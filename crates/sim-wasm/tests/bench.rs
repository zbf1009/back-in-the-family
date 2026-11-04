//! Tests of the `bench` feature export (run with `--features bench`; empty otherwise).
#![cfg(feature = "bench")]

use sim_core::checksum::Checksum;
use sim_core::tick::Sim;
use sim_core::world::{Workload, WorldConfig};
use sim_wasm::{BENCH_WARMUP_TICKS, bench_checksum_hex};

const CONFIG: &str = r#"{"entity_count":6,"days_per_tick":7,"workload":"Pairwise"}"#;

fn expected(seed: u64) -> u64 {
    let config = WorldConfig::try_new(6, 7, Workload::Pairwise).unwrap();
    let mut sim = Sim::new(seed, config).unwrap();
    for _ in 0..BENCH_WARMUP_TICKS {
        sim.step();
    }
    Checksum::of(sim.world()).0
}

#[test]
fn one_iteration_is_the_checksum_after_the_warmup() {
    let got = bench_checksum_hex(9, CONFIG, 1).unwrap();
    assert_eq!(got, Checksum(expected(9)).to_hex_string());
}

#[test]
fn the_sink_is_a_wrapping_sum_that_does_not_cancel() {
    let one = expected(9);
    for n in [0u32, 2, 3, 1000] {
        let got = bench_checksum_hex(9, CONFIG, n).unwrap();
        let want = one.wrapping_mul(u64::from(n));
        assert_eq!(got, Checksum(want).to_hex_string(), "n={n}");
    }
    assert_ne!(
        bench_checksum_hex(9, CONFIG, 2).unwrap(),
        "0000000000000000"
    );
}

#[test]
fn deterministic_and_seed_sensitive_and_rejects_bad_config() {
    assert_eq!(
        bench_checksum_hex(1, CONFIG, 5),
        bench_checksum_hex(1, CONFIG, 5)
    );
    assert_ne!(
        bench_checksum_hex(1, CONFIG, 5),
        bench_checksum_hex(2, CONFIG, 5)
    );
    assert!(bench_checksum_hex(1, "nope", 1).is_err());
}
