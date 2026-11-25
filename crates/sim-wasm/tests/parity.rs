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

/// R15.5/R15.7: verify both the golden replay and the applied playthrough, including
/// the stop Snapshots the browser smoke test will use as its display oracle.
#[wasm_bindgen_test(unsupported = test)]
fn playthrough_fixture_matches_every_tick_and_stage() {
    use sim_core::ids::Tick;
    use sim_core::input::InputPayload;
    use sim_core::narrator::chronicle::EntrySource;
    use sim_core::replay::ReplayFile;
    use sim_core::snapshot::snapshot_json;
    use sim_core::tick::Sim;
    use sim_core::underworld::slots::{SlotRef, path_status};
    use sim_core::values::Origin;
    use sim_core::world::{Life, SoulPlace, WorldConfig};

    let file = ReplayFile::from_json_str(include_str!(
        "../../../fixtures/parity/seedP-playthrough.replay.json"
    ))
    .expect("seedP-playthrough replay format");
    assert_eq!(
        file.ticks,
        file.checksums.len() as u64,
        "seedP-playthrough: expected one checksum per tick"
    );
    let sidecar: Value = serde_json::from_str(include_str!(
        "../../../fixtures/parity/seedP-playthrough.stages.json"
    ))
    .expect("seedP-playthrough stage format");
    let mut core = Sim::new(file.seed, WorldConfig::try_from(file.config).unwrap()).unwrap();
    let mut wasm =
        WasmSim::create(file.seed, &serde_json::to_string(&file.config).unwrap()).unwrap();
    let souls = core.world().souls();
    let SoulPlace::Body(first_body) = souls.places[&souls.player] else {
        panic!("seedP-playthrough: missing opening body");
    };
    let mut inputs = file.inputs.iter().peekable();
    let mut stages = Vec::new();
    let mut death_stop = None;
    let mut dream_stop = None;
    let mut claim_tick = None;
    let mut carry_tick = None;
    let mut first_divergence = None;
    for (tick, expected) in (0..file.ticks).zip(&file.checksums) {
        let before = core.last_stops();
        let mut sent_dream = false;
        let mut sent_claim = false;
        let mut payloads = Vec::new();
        while let Some(input) = inputs.next_if(|input| input.tick == tick) {
            let payload = InputPayload::from(input.payload);
            match payload {
                InputPayload::ChoosePlayer { node, .. } => assert!(
                    before.player_node && core.player_node_state() == Some((node, false)),
                    "seedP-playthrough: no unanswered Player_Node {node:?} at tick {tick}"
                ),
                InputPayload::Dream { .. } => {
                    assert_eq!(
                        death_stop,
                        Some(tick),
                        "seedP-playthrough: Dream not sent at real death stop"
                    );
                    assert!(
                        dream_stop.is_none() && !sent_dream,
                        "seedP-playthrough: extra Dream"
                    );
                    sent_dream = true;
                }
                InputPayload::CarryOver { .. } => {
                    assert_eq!(
                        carry_tick.replace(tick),
                        None,
                        "seedP-playthrough: extra CarryOver"
                    );
                }
                InputPayload::ClaimSlot {
                    slot: SlotRef::ImportedVessel,
                    customization: None,
                } => {
                    assert_eq!(
                        carry_tick,
                        Some(tick),
                        "seedP-playthrough: CarryOver must precede claim on the same tick"
                    );
                    assert!(
                        claim_tick.is_none() && !sent_claim,
                        "seedP-playthrough: extra Imported_Vessel claim"
                    );
                    assert!(
                        path_status(core.world(), SlotRef::ImportedVessel).executable(),
                        "seedP-playthrough: Imported_Vessel not executable at tick {tick}"
                    );
                    sent_claim = true;
                }
                _ => panic!("seedP-playthrough: unexpected input at tick {tick}: {payload:?}"),
            }
            let seq = core.submit(Tick(tick), payload).unwrap();
            assert_eq!(
                seq.0, input.seq,
                "seedP-playthrough: input sequence at tick {tick}"
            );
            payloads.push(input.payload);
        }
        if !payloads.is_empty() {
            let reply = wasm
                .submit_checked_json(&serde_json::to_string(&payloads).unwrap())
                .unwrap();
            let receipt: Value = serde_json::from_str(&reply).unwrap();
            let seqs: Vec<_> = core
                .inputs()
                .for_tick(Tick(tick))
                .iter()
                .map(|input| input.seq.0.to_string())
                .collect();
            assert_eq!(
                receipt,
                serde_json::json!({"ok":true,"tick":tick.to_string(),"seqs":seqs}),
                "seedP-playthrough: checked submit at tick {tick}"
            );
        }
        assert!(
            !matches!(core.player_node_state(), Some((_, false))),
            "seedP-playthrough: missing Player_Node choice at tick {tick}"
        );
        let observed = core.run_until_stop_observed(1);
        let checksum = observed
            .checksum
            .expect("one completed fixture tick has a checksum");
        let after = core.last_stops();
        for outcome in core.last_outcomes() {
            assert_eq!(
                outcome.result,
                Ok(()),
                "seedP-playthrough: rejected input {outcome:?} at tick {tick}"
            );
        }
        assert!(
            !sent_dream || after.dream_resolved,
            "seedP-playthrough: Dream not resolved at tick {tick}"
        );
        assert!(
            !sent_claim || after.player_reborn,
            "seedP-playthrough: Imported_Vessel claim did not result in rebirth at tick {tick}"
        );
        let post_tick = core.world().tick().0;
        if after.player_died && death_stop.is_none() {
            assert_eq!(
                core.world().persons()[&first_body].life,
                Life::Dead { death: Tick(tick) },
                "seedP-playthrough: player_died without real first-body death"
            );
            death_stop = Some(post_tick);
        }
        if sent_dream {
            dream_stop = Some(post_tick);
        }
        if sent_claim {
            claim_tick = Some(tick);
        }

        let reasons = after.labels();
        let native_reply = serde_json::to_value(&observed).unwrap();
        let reply: Value = serde_json::from_str(&wasm.run_until_stop(1)).unwrap();
        assert_eq!(
            wasm.tick(),
            post_tick,
            "seedP-playthrough: WASM tick after {tick}"
        );
        assert_eq!(
            reply, native_reply,
            "seedP-playthrough: checksum/stop reply at tick {post_tick}"
        );
        if after.any() {
            assert_eq!(
                wasm.snapshot(),
                snapshot_json(core.world()),
                "seedP-playthrough: stage Snapshot at tick {post_tick}"
            );
            stages.push(serde_json::json!({"tick": post_tick.to_string(), "reasons": reasons}));
        }
        if checksum != *expected {
            // Report missing behavior before the golden mismatch if an input was removed.
            first_divergence.get_or_insert((post_tick, *expected, checksum));
        }
    }
    assert!(
        inputs.next().is_none(),
        "seedP-playthrough: input outside recording or out of tick order"
    );
    let death_stop = death_stop.expect("seedP-playthrough: missing real first-body death");
    let choices = core
        .world()
        .narrator()
        .chronicle
        .entries()
        .iter()
        .filter(|entry| {
            entry.tick.0 < death_stop
                && entry.source == EntrySource::External
                && !entry.chooser_absent
        })
        .count();
    assert!(
        choices >= 2,
        "seedP-playthrough: needs two applied first-life Player_Node choices, got {choices}"
    );
    let dream_stop = dream_stop.expect("seedP-playthrough: missing applied Dream");
    let claim_tick = claim_tick.expect("seedP-playthrough: missing applied Imported_Vessel claim");
    let life = core
        .world()
        .narrator()
        .life
        .as_ref()
        .expect("seedP-playthrough: missing second body");
    assert!(
        life.body != first_body
            && life.start.0 == claim_tick
            && core.world().persons()[&life.body].origin == Origin::Possessed,
        "seedP-playthrough: missing second body from the Imported_Vessel claim"
    );
    assert!(
        file.ticks >= life.start.0 + 2,
        "seedP-playthrough: missing tick after second body begins (start {}, end {})",
        life.start.0,
        file.ticks
    );

    let step_clicks = claim_tick
        .checked_sub(dream_stop)
        .expect("seedP-playthrough: claim was before dream resolution");
    assert!(
        step_clicks <= 200,
        "seedP-playthrough: fallback exceeds 200 Step clicks"
    );
    assert_eq!(
        sidecar["step_clicks"], step_clicks,
        "seedP-playthrough: Step click count"
    );
    assert_eq!(
        sidecar["last_tick"],
        file.ticks.to_string(),
        "seedP-playthrough: final world tick"
    );
    assert_eq!(
        sidecar["stages"],
        serde_json::json!(stages),
        "seedP-playthrough: ordered stage ticks and reasons"
    );
    if let Some((tick, expected, actual)) = first_divergence {
        panic!(
            "seedP-playthrough: checksum mismatch at tick {tick}: expected {expected}, actual {actual}"
        );
    }
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

#[wasm_bindgen_test(unsupported = test)]
fn stop_and_checked_submission_are_identical_on_native_and_wasm() {
    let mut sim = WasmSim::create(1, r#"{"opening_residents":50}"#).unwrap();
    let before = sim.snapshot();
    assert_eq!(sim.player_node_state_json(), r#"{"pending":false}"#);
    let bad = sim
        .submit_checked_json(r#"[{"ChoosePlayer":{"node":"12","option":"repay_now"}}]"#)
        .unwrap();
    assert_eq!(bad, r#"{"ok":false,"index":0,"reason":"unknown_node"}"#);
    assert_eq!(sim.snapshot(), before);
    assert_eq!(sim.tick(), 0);
    let first = sim.run_until_stop_json(1000);
    let first: Value = serde_json::from_str(&first).unwrap();
    assert!(first["ran"].as_u64().unwrap() < 1000);
    assert!(
        first["stops"]
            .as_array()
            .unwrap()
            .contains(&Value::String("player_node".into()))
    );
    assert!(first["actions"].as_array().unwrap().is_empty());
    assert!(first["player_lifecycle"].as_array().unwrap().is_empty());
    let tick = sim.tick();
    assert_eq!(tick, first["ran"].as_u64().unwrap());
    let snapshot: Value = serde_json::from_str(&sim.snapshot()).unwrap();
    let node = snapshot["player_node"]["id"].as_str().unwrap();
    assert_eq!(
        sim.player_node_state_json(),
        format!(r#"{{"pending":true,"node":"{}","answered":false}}"#, node)
    );
    let option = snapshot["player_node"]["options"][0]["id"]
        .as_str()
        .unwrap();
    let chosen = serde_json::json!([{"ChoosePlayer":{"node":node,"option":option}}]).to_string();
    let stopped_snapshot = sim.snapshot();
    let stopped_checksums = sim.checksums_json(0, u64::MAX);
    let receipt: Value = serde_json::from_str(&sim.submit_checked_json(&chosen).unwrap()).unwrap();
    let replay: Value = serde_json::from_str(&sim.export_replay_json().unwrap()).unwrap();
    let seq = &replay["inputs"].as_array().unwrap().last().unwrap()["seq"];
    assert_eq!(
        receipt,
        serde_json::json!({"ok":true,"tick":tick.to_string(),"seqs":[seq]})
    );
    assert_eq!(
        sim.player_node_state_json(),
        format!(r#"{{"pending":true,"node":"{}","answered":true}}"#, node)
    );
    assert_eq!(sim.tick(), tick);
    assert_eq!(
        sim.snapshot(),
        stopped_snapshot,
        "Snapshot excludes queued choices"
    );
    assert_eq!(sim.checksums_json(0, u64::MAX), stopped_checksums);
    assert!(
        sim.submit_checked_json(&chosen)
            .unwrap()
            .contains("already_chosen")
    );
    assert_eq!(sim.snapshot(), stopped_snapshot);
    assert_eq!(sim.checksums_json(0, u64::MAX), stopped_checksums);
    let next = sim.run_until_stop_json(1);
    let next: Value = serde_json::from_str(&next).unwrap();
    assert_eq!(next["ran"], 1);
    assert!(next["actions"].as_array().unwrap().is_empty());
    assert!(next["player_lifecycle"].as_array().unwrap().is_empty());
    assert_eq!(sim.tick(), tick + 1);
    assert_eq!(sim.player_node_state_json(), r#"{"pending":false}"#);
    assert_eq!(
        sim.checksums_json(tick, tick),
        serde_json::json!([next["checksum"]]).to_string()
    );
}

#[wasm_bindgen_test(unsupported = test)]
fn checked_wasm_payloads_reject_malformed_json_without_queuing() {
    let mut sim = WasmSim::create(1, r#"{"opening_residents":50}"#).unwrap();
    assert!(
        sim.submit_checked_json(r#"[{"ChoosePlayer":{"node":12,"option":"repay_now"}}]"#)
            .is_err()
    );
    assert!(
        sim.submit_checked_json(
            r#"[{"ChoosePlayer":{"node":"12","option":"repay_now","extra":1}}]"#
        )
        .is_err()
    );
    assert_eq!(
        sim.run_until_stop_json(0),
        r#"{"ran":0,"checksum":"","stops":[],"actions":[],"player_lifecycle":[]}"#
    );
    assert_eq!(sim.tick(), 0);
    assert_eq!(sim.checksums_json(0, 0), "[]");
}

#[wasm_bindgen_test(unsupported = test)]
fn extended_snapshot_and_stop_replies_match_core_on_every_fixture_tick() {
    use sim_core::ids::Tick;
    use sim_core::replay::ReplayFile;
    use sim_core::tick::Sim;
    use sim_core::world::WorldConfig;

    for (name, json) in FIXTURES {
        let file = ReplayFile::from_json_str(json).unwrap();
        let mut core = Sim::new(file.seed, WorldConfig::try_from(file.config).unwrap()).unwrap();
        let mut wasm =
            WasmSim::create(file.seed, &serde_json::to_string(&file.config).unwrap()).unwrap();
        for input in &file.inputs {
            core.submit(Tick(input.tick), input.payload.into()).unwrap();
            wasm.submit_json(
                &serde_json::json!({"tick":input.tick.to_string(),"payload":input.payload})
                    .to_string(),
            )
            .unwrap();
        }
        assert_eq!(
            wasm.snapshot(),
            sim_core::snapshot::snapshot_json(core.world()),
            "fixture {name}: opening Snapshot"
        );
        for (tick, expected) in file.checksums.iter().enumerate() {
            let reply = wasm.run_until_stop(1);
            let observed = core.run_until_stop_observed(1);
            let checksum = observed.checksum.unwrap();
            assert_eq!(&checksum, expected, "fixture {name}: tick {tick}");
            let expected_reply = serde_json::to_string(&observed).unwrap();
            assert_eq!(
                reply, expected_reply,
                "fixture {name}: tick {tick} stop reply"
            );
            let before = core.clone();
            assert_eq!(
                wasm.snapshot(),
                sim_core::snapshot::snapshot_json(core.world()),
                "fixture {name}: tick {tick} Snapshot"
            );
            assert_eq!(wasm.snapshot_string(), wasm.snapshot());
            assert_eq!(
                sim_core::checksum::Checksum::of(core.world()),
                sim_core::checksum::Checksum::of(before.world())
            );
        }
        let all: Vec<_> = file.checksums.iter().map(|c| c.to_hex_string()).collect();
        assert_eq!(
            wasm.checksums(0, u64::MAX),
            serde_json::to_string(&all).unwrap()
        );
        assert_eq!(wasm.checksums(u64::MAX, u64::MAX), "[]");
        assert_eq!(wasm.checksums(5, 4), "[]");
        assert_eq!(
            wasm.checksums(2, 3),
            serde_json::to_string(&all[2..=3]).unwrap()
        );
    }
}

#[wasm_bindgen_test(unsupported = test)]
fn core_run_resolves_an_unanswered_player_node_by_default() {
    let mut sim = WasmSim::create(1, r#"{"opening_residents":50}"#).unwrap();
    let stop: Value = serde_json::from_str(&sim.run_until_stop(1000)).unwrap();
    assert_eq!(stop["stops"], serde_json::json!(["player_node"]));
    let snapshot: Value = serde_json::from_str(&sim.snapshot()).unwrap();
    let default = &snapshot["player_node"]["rules_default"];
    let tick = sim.tick();
    let next: Value = serde_json::from_str(&sim.run_until_stop(1)).unwrap();
    assert_eq!(next["ran"], 1);
    assert_eq!(sim.tick(), tick + 1);
    assert_eq!(sim.player_node_state(), r#"{"pending":false}"#);
    let resolved: Value = serde_json::from_str(&sim.snapshot()).unwrap();
    let choice_tick = tick.to_string();
    let entry = resolved["chronicle"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["tick"] == choice_tick && entry["source"] == "rules_default")
        .unwrap();
    assert_eq!(&entry["applied"], default);
}

#[wasm_bindgen_test(unsupported = test)]
fn real_waiting_wasm_batch_retains_early_applied_and_rejected_actions() {
    use sim_core::ids::Tick;
    use sim_core::input::InputPayload;
    use sim_core::replay::ReplayFile;
    use sim_core::tick::Sim;
    use sim_core::world::WorldConfig;

    let file = ReplayFile::from_json_str(include_str!(
        "../../../fixtures/parity/seedP-playthrough.replay.json"
    ))
    .unwrap();
    let mut core = Sim::new(file.seed, WorldConfig::try_from(file.config).unwrap()).unwrap();
    let mut wasm =
        WasmSim::create(file.seed, &serde_json::to_string(&file.config).unwrap()).unwrap();
    // Branch after the recorded Dream resolves, before queuing the affordable claim.
    let prepared_tick = 5_374;
    for input in file
        .inputs
        .iter()
        .filter(|input| input.tick < prepared_tick)
    {
        core.submit(Tick(input.tick), input.payload.into()).unwrap();
        wasm.submit_json(
            &serde_json::json!({"tick":input.tick.to_string(),"payload":input.payload}).to_string(),
        )
        .unwrap();
    }
    for (tick, expected) in file
        .checksums
        .iter()
        .take(usize::try_from(prepared_tick).unwrap())
        .enumerate()
    {
        assert_eq!(
            core.step(),
            *expected,
            "prepared native fixture tick {tick}"
        );
        assert_eq!(
            wasm.step_hex(),
            expected.to_hex_string(),
            "prepared WASM fixture tick {tick}"
        );
    }
    assert_eq!(core.world().tick(), Tick(prepared_tick));
    assert!(
        sim_core::underworld::slots::path_status(
            core.world(),
            sim_core::underworld::slots::SlotRef::ImportedVessel
        )
        .executable(),
        "the actual recorded claim point has at least its 100-joss price"
    );
    let account = core.world().joss()[&core.world().souls().player];
    assert!(account.balance >= core.world().params().imported_price);
    assert!(
        account.balance >= core.world().params().haunt_price.checked_add(1).unwrap(),
        "the actual balance covers Bribe first, then Haunt"
    );
    assert_eq!(
        account.capped_spent_in(core.world().tick()),
        0,
        "the prefix has no Haunt/Rebuild spend"
    );
    let snapshot_text = wasm.snapshot();
    assert_eq!(
        snapshot_text,
        sim_core::snapshot::snapshot_json(core.world())
    );
    let snapshot: Value = serde_json::from_str(&snapshot_text).unwrap();
    let view = &snapshot["underworld_view"]["actions"];
    assert_eq!(view["version"], 1);
    let target = view["haunt"]["targets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["availability"]["eligible"] == true && entry["target"] != 1)
        .expect("the delivered underworld fixture has an eligible connected target")["target"]
        .as_u64()
        .unwrap();
    let tick = core.world().tick();
    let payload = InputPayload::Haunt {
        target: sim_core::ids::PersonId(target),
    };
    let checked_payloads = [InputPayload::Bribe { amount: 1 }, payload];
    let receipt = core.submit_checked(&checked_payloads);
    assert!(
        matches!(
            &receipt,
            sim_core::observations::CheckedSubmission::Accepted(_)
        ),
        "the authoritative queued-prefix validator admits both ordered actions"
    );
    let checked = wasm
        .submit_checked_json(
            &serde_json::json!([{"Bribe":{"amount":"1"}},{"Haunt":{"target":target.to_string()}}])
                .to_string(),
        )
        .unwrap();
    assert_eq!(checked, serde_json::to_string(&receipt).unwrap());
    for (payload, wire) in [
        (
            payload,
            serde_json::json!({"Haunt":{"target":target.to_string()}}),
        ),
        (
            InputPayload::Bribe { amount: 0 },
            serde_json::json!({"Bribe":{"amount":"0"}}),
        ),
    ] {
        core.submit(tick, payload).unwrap();
        wasm.submit_json(
            &serde_json::json!({"tick":tick.0.to_string(),"payload":wire}).to_string(),
        )
        .unwrap();
    }
    let report = core.run_until_stop_observed(3);
    assert_eq!(report.ran, 3);
    assert!(core.last_outcomes().is_empty());
    let wire = wasm.run_until_stop_json(3);
    assert_eq!(wire, serde_json::to_string(&report).unwrap());
    let wire: Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(wire["actions"].as_array().unwrap().len(), 4);
    assert_eq!(wire["actions"][0]["kind"], "bribe");
    assert_eq!(wire["actions"][0]["state"], "applied");
    assert!(wire["actions"][0]["ruling"].is_object());
    assert_eq!(wire["actions"][1]["kind"], "haunt");
    assert_eq!(wire["actions"][1]["state"], "applied");
    assert_eq!(wire["actions"][1]["mood_delta"], "-15");
    assert_eq!(wire["actions"][2]["reason"], "rate_limited");
    assert_eq!(wire["actions"][3]["reason"], "bad_amount");
    let expected_tick = tick.0.to_string();
    assert!(
        wire["actions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|action| action["tick"].as_str() == Some(expected_tick.as_str()))
    );
    assert_eq!(
        wasm.snapshot(),
        sim_core::snapshot::snapshot_json(core.world())
    );
    let empty: Value = serde_json::from_str(&wasm.run_until_stop_json(0)).unwrap();
    assert_eq!(empty["checksum"], wire["checksum"]);
    assert!(empty["actions"].as_array().unwrap().is_empty());
    assert!(empty["player_lifecycle"].as_array().unwrap().is_empty());
    let receipt: Value = serde_json::from_str(&wasm.submit_checked_json("[]").unwrap()).unwrap();
    assert_eq!(
        receipt,
        serde_json::json!({"ok":true,"tick":wasm.tick().to_string(),"seqs":[]})
    );
}
