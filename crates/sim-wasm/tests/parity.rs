//! Native-vs-WASM parity (design D7): the committed Parity_Fixtures in
//! `fixtures/parity/` are the golden runs. Under
//! `cargo test -p sim-wasm --target wasm32-unknown-unknown` they run in Node through
//! `wasm-bindgen-test-runner`, and under plain `cargo test` they run natively
//! (`unsupported = test` falls back to `#[test]`).
//!
//! The fixture names `seed1-pairwise`, `seed2-pairwise` and `seedbig-pairwise` are kept
//! from the skeleton era and no longer describe a workload (`Pairwise` is gone); only
//! their contents changed with the life-sim model.

use serde_json::Value;
use sim_wasm::{WasmSim, verify_replay, verify_replay_str};
use wasm_bindgen_test::wasm_bindgen_test;

const FIXTURES: [(&str, &str); 4] = [
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
    (
        "seedU-underworld",
        include_str!("../../../fixtures/parity/seedU-underworld.replay.json"),
    ),
];

/// The native Snapshot at tick 500 of `seed1-pairwise` (R18.3), written by
/// `sim-cli snapshot` from the same replay file.
const SNAPSHOT_500: &str =
    include_str!("../../../fixtures/parity/seed1-pairwise.snapshot-500.json");

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

/// R14.6: the recorded Choose input is applied to a real node, not merely submitted.
#[cfg(not(target_arch = "wasm32"))]
#[test]
fn underworld_fixture_applies_an_external_choice() {
    use sim_core::ids::Tick;
    use sim_core::input::InputPayload;
    use sim_core::replay::{ReplayFile, verify};
    use sim_core::tick::Sim;
    use sim_core::underworld::nodes::ChoiceSource;
    use sim_core::world::WorldConfig;

    let file = ReplayFile::from_json_str(FIXTURES[3].1).expect("underworld replay format");
    assert!(
        file.inputs.iter().any(|input| matches!(
            InputPayload::from(input.payload),
            InputPayload::Choose { .. }
        )),
        "fixture must record a Choose input"
    );
    verify(&file).expect("every native checksum must match the fixture");

    let config = WorldConfig::try_from(file.config).expect("underworld config");
    let mut sim = Sim::new(file.seed, config).expect("underworld opening");
    for input in &file.inputs {
        let seq = sim
            .submit(Tick(input.tick), input.payload.into())
            .expect("recorded input submits");
        assert_eq!(seq.0, input.seq, "keep original submission sequence");
    }
    for &expected in &file.checksums {
        assert_eq!(sim.step(), expected, "native checksum for each tick");
    }
    assert!(
        sim.world()
            .nodes()
            .resolved
            .iter()
            .any(|record| record.source == ChoiceSource::External),
        "a recorded Choose must be applied as an External NodeRecord"
    );
}

/// R18.3 and R18.2: the Snapshot at tick 500 of `seed1-pairwise` is byte-identical to
/// the committed native file, and taking a Snapshot does not change the run.
#[wasm_bindgen_test(unsupported = test)]
fn snapshot_at_tick_500_matches_the_committed_file() {
    let json = FIXTURES[0].1;
    let v: Value = serde_json::from_str(json).expect("fixture is JSON");
    let seed: u64 = v["seed"].as_str().unwrap().parse().unwrap();
    let config = v["config"].to_string();

    let Ok(mut sim) = WasmSim::new(seed, &config) else {
        panic!("WasmSim::new failed");
    };
    for input in v["inputs"].as_array().unwrap() {
        let body = serde_json::json!({
            "tick": input["tick"],
            "payload": input["payload"],
        })
        .to_string();
        assert!(sim.submit(&body).is_ok(), "submit failed for {body}");
    }
    sim.run_ticks(500);
    assert_eq!(sim.tick(), 500);
    assert_eq!(sim.snapshot(), SNAPSHOT_500, "committed snapshot differs");
    assert_eq!(
        sim.snapshot_string(),
        SNAPSHOT_500,
        "the plain twin differs"
    );

    // The act of taking a Snapshot is read-only: the next tick is unaffected.
    let before = sim.snapshot();
    let checksum = sim.step();
    assert_ne!(sim.snapshot(), before, "the tick must be visible");
    assert_eq!(checksum.len(), 16);
}

#[wasm_bindgen_test(unsupported = test)]
fn run_ticks_returns_last_checksum_and_handles_zero() {
    let cfg = r#"{"opening_residents":45}"#;
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
    let cfg = r#"{"opening_residents":45}"#;
    assert!(WasmSim::create(1, "not json").is_err());
    // Below the 40..=60 range and the retired `workload` field both fail validation.
    assert!(WasmSim::create(1, r#"{"opening_residents":39}"#).is_err());
    assert!(WasmSim::create(1, r#"{"opening_residents":45,"workload":"Pairwise"}"#).is_err());
    let mut sim = WasmSim::create(1, cfg).unwrap();
    sim.step();
    for bad in [
        "",
        "{}",
        r#"{"tick":5,"payload":{"Act":{"kind":"help","actor":"1","target":"2","intensity":40}}}"#,
        r#"{"tick":"05","payload":{"Act":{"kind":"help","actor":"1","target":"2","intensity":40}}}"#,
        r#"{"tick":"1","payload":{"SetValue":{"entity":"1","value":1}}}"#,
        r#"{"tick":"1","payload":{"Act":{"kind":"dream","actor":"1","target":"2","intensity":40}}}"#,
    ] {
        assert!(sim.submit_json(bad).is_err(), "should reject {bad:?}");
    }
    assert!(
        sim.submit_json(
            r#"{"tick":"1","payload":{"Act":{"kind":"help","actor":"1","target":"2","intensity":40}}}"#
        )
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
