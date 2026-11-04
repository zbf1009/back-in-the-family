//! Native-vs-WASM parity (design D7). The same golden fixtures that
//! `sim-core/tests/replay.rs` checks natively are checked here; under
//! `cargo test -p sim-wasm --target wasm32-unknown-unknown` they run in Node through
//! `wasm-bindgen-test-runner`, and under plain `cargo test` they run natively
//! (`unsupported = test` falls back to `#[test]`).

use serde_json::Value;
use sim_wasm::{WasmSim, verify_replay, verify_replay_str};
use wasm_bindgen_test::wasm_bindgen_test;

const FIXTURES: [(&str, &str); 3] = [
    (
        "seed1-pairwise",
        include_str!("../../../fixtures/parity/seed1-pairwise.replay.json"),
    ),
    (
        "seed2-pairwise",
        include_str!("../../../fixtures/parity/seed2-pairwise.replay.json"),
    ),
    (
        "seedbig-pairwise",
        include_str!("../../../fixtures/parity/seedbig-pairwise.replay.json"),
    ),
];

#[wasm_bindgen_test(unsupported = test)]
fn fixtures_verify_via_verify_replay() {
    for (name, json) in FIXTURES {
        if let Err(e) = verify_replay_str(json) {
            panic!("fixture {name}: {e}");
        }
        // The exported wrapper must agree (Ok path only; JsError is opaque on native).
        assert!(verify_replay(json).is_ok(), "fixture {name}: verify_replay");
    }
}

/// R7.1: create a world, submit inputs, step and read the checksum through `WasmSim`.
#[wasm_bindgen_test(unsupported = test)]
fn wasm_sim_api_reproduces_every_recorded_checksum() {
    for (name, json) in FIXTURES {
        let v: Value = serde_json::from_str(json).expect("fixture is JSON");
        let seed: u64 = v["seed"].as_str().unwrap().parse().unwrap();
        let config = v["config"].to_string();
        let ticks: u64 = v["ticks"].as_str().unwrap().parse().unwrap();
        let checksums = v["checksums"].as_array().unwrap();
        let inputs = v["inputs"].as_array().unwrap();
        assert_eq!(checksums.len() as u64, ticks, "fixture {name}");

        let Ok(mut sim) = WasmSim::new(seed, &config) else {
            panic!("fixture {name}: WasmSim::new failed");
        };
        // Inputs are recorded in seq order; submit them all up front, in that order.
        for input in inputs {
            let body = serde_json::json!({
                "tick": input["tick"],
                "payload": input["payload"],
            })
            .to_string();
            if sim.submit(&body).is_err() {
                panic!("fixture {name}: submit failed for {body}");
            }
        }
        for (tick, expected) in checksums.iter().enumerate() {
            assert_eq!(sim.tick(), tick as u64, "fixture {name}");
            let actual = sim.step();
            assert_eq!(
                actual,
                expected.as_str().unwrap(),
                "fixture {name}: checksum mismatch at tick {tick}"
            );
        }
        assert_eq!(sim.tick(), ticks, "fixture {name}");
    }
}

#[wasm_bindgen_test(unsupported = test)]
fn run_ticks_returns_last_checksum_and_handles_zero() {
    let cfg = r#"{"entity_count":5,"workload":"Light"}"#;
    let mut a = WasmSim::create(7, cfg).unwrap();
    assert_eq!(a.run_ticks(0), "", "no tick has run yet");
    let last = a.run_ticks(10);
    assert_eq!(a.tick(), 10);
    assert_eq!(a.run_ticks(0), last, "zero ticks repeats the last checksum");
    let mut b = WasmSim::create(7, cfg).unwrap();
    let mut step_last = String::new();
    for _ in 0..10 {
        step_last = b.step();
    }
    assert_eq!(step_last, last);
}

#[wasm_bindgen_test(unsupported = test)]
fn bad_caller_input_is_an_error_not_a_panic() {
    let cfg = r#"{"entity_count":5,"workload":"Light"}"#;
    assert!(WasmSim::create(1, "not json").is_err());
    assert!(WasmSim::create(1, r#"{"entity_count":201,"workload":"Light"}"#).is_err());
    let mut sim = WasmSim::create(1, cfg).unwrap();
    sim.step();
    for bad in [
        "",
        "{}",
        r#"{"tick":5,"payload":{"Spawn":{"value":1}}}"#,
        r#"{"tick":"05","payload":{"Spawn":{"value":1}}}"#,
        r#"{"tick":"0","payload":{"Spawn":{"value":1}}}"#,
    ] {
        assert!(sim.submit_json(bad).is_err(), "should reject {bad:?}");
    }
    assert!(
        sim.submit_json(r#"{"tick":"1","payload":{"Spawn":{"value":1}}}"#)
            .is_ok()
    );
}

/// R6.3 on the WASM side: a tampered checksum is reported with its tick number.
#[wasm_bindgen_test(unsupported = test)]
fn tampered_fixture_error_names_the_tick() {
    let (name, json) = FIXTURES[0];
    let mut v: Value = serde_json::from_str(json).unwrap();
    v["checksums"][42] = Value::String("0000000000000000".into());
    let err = verify_replay_str(&v.to_string()).expect_err("tampered fixture must fail");
    assert!(
        err.contains("tick 42"),
        "fixture {name}: error should name tick 42, got: {err}"
    );
}
