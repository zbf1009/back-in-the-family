//! Replay file: record and verify in-process, JSON round trip, tamper detection and
//! strict parsing (R16.6, R1.3).
//!
//! The replay format is version 4: config `{ "opening_residents": 50 }` and `Act`
//! payloads (the underworld payloads arrive with their handlers). The Parity_Fixtures
//! are recorded with `scripts/regen-fixtures.sh`; their native/WASM parity tests live in
//! `crates/sim-wasm/tests/parity.rs`.

use proptest::prelude::*;
use sim_core::checksum::Checksum;
use sim_core::ids::{PersonId, Tick};
use sim_core::input::InputPayload;
use sim_core::replay::{
    Divergence, REPLAY_FORMAT, REPLAY_VERSION, ReplayConfig, ReplayError, ReplayFile, record,
    verify,
};
use sim_core::values::SocialKind;
use sim_core::world::{RejectReason, WorldConfig};

mod life_gen;

const TICKS: u64 = 500;

fn act(kind: SocialKind, actor: u64, target: u64, intensity: u8) -> InputPayload {
    InputPayload::Act {
        kind,
        actor: PersonId(actor),
        target: PersonId(target),
        intensity,
    }
}

/// Valid and deliberately invalid acts, in submission order and NOT in tick order, so
/// `seq` order and `(tick, seq)` order differ.
fn mixed_inputs() -> Vec<(Tick, InputPayload)> {
    vec![
        (Tick(40), act(SocialKind::Help, 1, 2, 40)),   // valid
        (Tick(3), act(SocialKind::Quarrel, 3, 4, 60)), // valid, earlier tick
        (Tick(3), act(SocialKind::Gift, u64::MAX, 2, 40)), // unknown person
        (Tick(10), act(SocialKind::Insult, 1, 1, 40)), // self target
        (Tick(10), act(SocialKind::Theft, 1, 2, 0)),   // intensity too low
        (Tick(20), act(SocialKind::Apology, 2, 3, 101)), // intensity too high
        (Tick(60), act(SocialKind::Help, 4, 3, 100)),  // valid
        (Tick(1 << 40), act(SocialKind::Gift, 1, 3, 40)), // far future, never applied
    ]
}

fn config() -> WorldConfig {
    WorldConfig::try_new(50).unwrap()
}

fn cases() -> Vec<(u64, WorldConfig)> {
    vec![
        (1, config()),
        (0x0123_4567_89ab_cdef, WorldConfig::try_new(45).unwrap()),
        (u64::MAX, WorldConfig::try_new(40).unwrap()),
        (42, WorldConfig::try_new(60).unwrap()),
    ]
}

fn sample() -> ReplayFile {
    let (seed, config) = cases()[0];
    record(seed, config, &mixed_inputs(), TICKS).unwrap()
}

fn flip_last_digit(c: Checksum) -> Checksum {
    Checksum(c.0 ^ 1)
}

#[test]
fn record_then_verify_for_fixed_seeds() {
    for (seed, config) in cases() {
        let file = record(seed, config, &mixed_inputs(), TICKS).unwrap();
        assert_eq!(file.format, REPLAY_FORMAT);
        assert_eq!(file.version, REPLAY_VERSION);
        assert_eq!(file.checksums.len() as u64, TICKS);
        assert_eq!(file.inputs.len(), mixed_inputs().len());
        for (i, input) in file.inputs.iter().enumerate() {
            assert_eq!(input.seq, i as u64);
        }
        assert_eq!(verify(&file), Ok(()), "seed {seed}");
    }
}

#[test]
fn the_mixed_inputs_exercise_every_rejection_reason() {
    let file = sample();
    // Re-run locally to inspect the World (verify only returns Ok/Err).
    let mut sim =
        sim_core::tick::Sim::new(file.seed, WorldConfig::try_from(file.config).unwrap()).unwrap();
    for input in &file.inputs {
        sim.submit(Tick(input.tick), input.payload.into()).unwrap();
    }
    for _ in 0..TICKS {
        sim.step();
    }
    let counts = sim.world().rejections().count_by_reason.clone();
    for reason in [
        RejectReason::UnknownPerson,
        RejectReason::SelfTarget,
        RejectReason::IntensityOutOfRange,
    ] {
        assert!(counts.get(&reason).copied().unwrap_or(0) > 0, "{reason:?}");
    }
    // Nothing in this stream kills a person, so DeadPerson and IdExhausted stay at 0.
    assert_eq!(counts.get(&RejectReason::DeadPerson), None);
    assert_eq!(counts.get(&RejectReason::IdExhausted), None);
    // The far-future input was accepted by the stream but never applied.
    let last = sim.world().rejections().last.expect("rejections recorded");
    assert!(last.0 < Tick(1 << 40));
}

#[test]
fn different_seeds_give_different_checksums() {
    let a = record(1, WorldConfig::default(), &[], 10).unwrap();
    let b = record(2, WorldConfig::default(), &[], 10).unwrap();
    assert_ne!(a.checksums, b.checksums);
}

#[test]
fn json_round_trip_is_exact_and_verifies() {
    for (seed, config) in cases() {
        let file = record(seed, config, &mixed_inputs(), TICKS).unwrap();
        let json = file.to_json_string().unwrap();
        let back = ReplayFile::from_json_str(&json).unwrap();
        assert_eq!(back, file);
        assert_eq!(verify(&back), Ok(()));
        assert_eq!(back.to_json_string().unwrap(), json);
    }
}

#[test]
fn json_has_the_documented_shape() {
    let file = record(
        1,
        WorldConfig::try_new(50).unwrap(),
        &[(Tick(5), act(SocialKind::Help, 3, 17, 40))],
        2,
    )
    .unwrap();
    let json = file.to_json_string().unwrap();
    assert!(json.starts_with(
        r#"{"format":"back-in-the-family/replay","version":4,"seed":"1","config":{"opening_residents":50},"ticks":"2","inputs":[{"tick":"5","seq":"0","payload":{"Act":{"kind":"help","actor":"3","target":"17","intensity":40}}}],"checksums":["#
    ));
    for c in &file.checksums {
        assert!(json.contains(&format!("\"{c}\"")));
    }
}

#[test]
fn tampered_checksum_is_reported_at_the_right_tick() {
    let original = sample();
    for n in [0usize, 1, 3, 250, TICKS as usize - 1] {
        let mut file = original.clone();
        let truth = file.checksums[n];
        let tampered = flip_last_digit(truth);
        file.checksums[n] = tampered;
        assert_eq!(
            verify(&file),
            Err(ReplayError::Diverged(Divergence {
                tick: Tick(n as u64),
                expected: tampered,
                actual: truth,
            }))
        );
    }
}

#[test]
fn first_divergence_wins_when_several_checksums_are_wrong() {
    let mut file = sample();
    for n in [200usize, 70, 120] {
        file.checksums[n] = flip_last_digit(file.checksums[n]);
    }
    match verify(&file) {
        Err(ReplayError::Diverged(d)) => assert_eq!(d.tick, Tick(70)),
        other => panic!("expected divergence, got {other:?}"),
    }
}

#[test]
fn a_config_with_a_workload_field_is_rejected_and_no_world_is_created() {
    let text = r#"{"opening_residents":50,"workload":"Pairwise"}"#;
    match ReplayConfig::from_json_str(text) {
        Err(ReplayError::Malformed(message)) => {
            assert!(message.contains("unknown field `workload`"), "{message}");
        }
        other => panic!("expected Malformed, got {other:?}"),
    }
    // A whole replay file with the legacy config fails the same way.
    let file = r#"{"format":"back-in-the-family/replay","version":4,"seed":"1","config":{"opening_residents":50,"workload":"Pairwise"},"ticks":"0","inputs":[],"checksums":[]}"#;
    match ReplayFile::from_json_str(file) {
        Err(ReplayError::Malformed(message)) => {
            assert!(message.contains("unknown field `workload`"), "{message}");
        }
        other => panic!("expected Malformed, got {other:?}"),
    }
}

#[test]
fn a_version_2_file_is_rejected_as_unsupported() {
    let v2 = r#"{"format":"back-in-the-family/replay","version":2,"seed":"1","config":{"entity_count":5,"workload":"Pairwise"},"ticks":"0","inputs":[],"checksums":[]}"#;
    assert_eq!(
        ReplayFile::from_json_str(v2),
        Err(ReplayError::UnsupportedVersion { found: 2 })
    );
    let mut file = sample();
    file.version = 2;
    assert_eq!(
        verify(&file),
        Err(ReplayError::UnsupportedVersion { found: 2 })
    );
}

#[test]
fn a_version_3_file_is_rejected_as_unsupported() {
    let v3 = r#"{"format":"back-in-the-family/replay","version":3,"seed":"1","config":{"opening_residents":50},"ticks":"0","inputs":[],"checksums":[]}"#;
    assert_eq!(
        ReplayFile::from_json_str(v3),
        Err(ReplayError::UnsupportedVersion { found: 3 })
    );
    let mut file = sample();
    file.version = 3;
    assert_eq!(
        verify(&file),
        Err(ReplayError::UnsupportedVersion { found: 3 })
    );
}

#[test]
fn verify_uses_seed_config_and_inputs_not_the_recorded_checksums() {
    let mut file = sample();
    file.inputs[0].tick = 41;
    assert!(matches!(verify(&file), Err(ReplayError::Diverged(_))));
    let mut file = sample();
    file.seed ^= 1;
    match verify(&file) {
        Err(ReplayError::Diverged(d)) => assert_eq!(d.tick, Tick(0)),
        other => panic!("expected divergence at tick 0, got {other:?}"),
    }
}

#[test]
fn wrong_checksum_count_is_a_distinct_error() {
    let mut short = sample();
    short.checksums.pop();
    assert_eq!(
        verify(&short),
        Err(ReplayError::ChecksumCount {
            expected_ticks: TICKS,
            found: TICKS - 1
        })
    );
    let mut long = sample();
    long.checksums.push(Checksum(0));
    assert_eq!(
        verify(&long),
        Err(ReplayError::ChecksumCount {
            expected_ticks: TICKS,
            found: TICKS + 1
        })
    );
}

#[test]
fn unknown_format_and_version_are_rejected() {
    let json = sample().to_json_string().unwrap();
    let bad_format = json.replacen(REPLAY_FORMAT, "somebody-else/replay", 1);
    assert!(matches!(
        ReplayFile::from_json_str(&bad_format),
        Err(ReplayError::UnknownFormat { .. })
    ));
    let bad_version = json.replacen("\"version\":4", "\"version\":3", 1);
    assert_ne!(bad_version, json);
    assert_eq!(
        ReplayFile::from_json_str(&bad_version),
        Err(ReplayError::UnsupportedVersion { found: 3 })
    );
    let future = r#"{"format":"back-in-the-family/replay","version":9,"brand_new":true}"#;
    assert_eq!(
        ReplayFile::from_json_str(future),
        Err(ReplayError::UnsupportedVersion { found: 9 })
    );
}

#[test]
fn u64_values_above_2_pow_53_survive_the_round_trip() {
    let big = (1u64 << 53) + 1;
    let mut file = record(
        u64::MAX,
        WorldConfig::try_new(40).unwrap(),
        &[(Tick(big), act(SocialKind::Help, big, u64::MAX, 40))],
        5,
    )
    .unwrap();
    assert_eq!(file.seed, u64::MAX);
    file.inputs[0].seq = u64::MAX - 1; // not verifiable, but must round-trip exactly
    let json = file.to_json_string().unwrap();
    assert!(json.contains(r#""seed":"18446744073709551615""#));
    assert!(json.contains(r#""tick":"9007199254740993""#));
    assert!(json.contains(r#""seq":"18446744073709551614""#));
    assert!(json.contains(r#""actor":"9007199254740993""#));
    assert!(json.contains(r#""target":"18446744073709551615""#));
    let back = ReplayFile::from_json_str(&json).unwrap();
    assert_eq!(back, file);
}

#[test]
fn u64_strings_are_parsed_strictly() {
    let json = sample().to_json_string().unwrap();
    let seed_text = format!("\"seed\":\"{}\"", sample().seed);
    assert!(json.contains(&seed_text));

    // A JSON number where a string is required.
    let number = json.replacen(&seed_text, &format!("\"seed\":{}", sample().seed), 1);
    assert!(matches!(
        ReplayFile::from_json_str(&number),
        Err(ReplayError::Malformed(_))
    ));

    for bad in [
        "01",
        "+1",
        "",
        "-1",
        "00",
        " 1",
        "1 ",
        "1_0",
        "0x10",
        "1.0",
        "1e3",
        "١٨",
        "18446744073709551616",
    ] {
        let text = json.replacen(&seed_text, &format!("\"seed\":\"{bad}\""), 1);
        assert!(
            matches!(
                ReplayFile::from_json_str(&text),
                Err(ReplayError::Malformed(_))
            ),
            "{bad:?} should be rejected"
        );
    }
    for (text, value) in [("0", 0u64), ("18446744073709551615", u64::MAX)] {
        let json = json.replacen(&seed_text, &format!("\"seed\":\"{text}\""), 1);
        assert_eq!(ReplayFile::from_json_str(&json).unwrap().seed, value);
    }
}

#[test]
fn out_of_order_or_gapped_seq_is_an_error() {
    let mut file = sample();
    file.inputs.swap(0, 1);
    file.inputs[0].seq = 1;
    file.inputs[1].seq = 0;
    assert_eq!(
        verify(&file),
        Err(ReplayError::InputSeqMismatch {
            index: 0,
            expected: 0,
            found: 1
        })
    );
    let mut file = sample();
    file.inputs[5].seq = 6;
    assert_eq!(
        verify(&file),
        Err(ReplayError::InputSeqMismatch {
            index: 5,
            expected: 5,
            found: 6
        })
    );
}

#[test]
fn malformed_json_is_an_error_not_a_panic() {
    let json = sample().to_json_string().unwrap();
    let cases: Vec<String> = vec![
        String::new(),
        "null".into(),
        "[]".into(),
        "{".into(),
        "{}".into(),
        "not json".into(),
        json[..json.len() / 2].to_owned(),
        json.replacen("\"seed\"", "\"sede\"", 1),
        json.replacen("\"checksums\"", "\"extra\":1,\"checksums\"", 1),
        json.replacen(",\"ticks\":\"500\"", "", 1),
        json.replacen("\"payload\":{\"Act\"", "\"payload\":{\"Teleport\"", 1),
        json.replacen("\"kind\":\"help\"", "\"kind\":7", 1),
        json.replacen(&sample().checksums[0].to_hex_string(), "XYZ", 1),
    ];
    for text in &cases {
        assert!(
            ReplayFile::from_json_str(text).is_err(),
            "{text:?} should be rejected"
        );
    }
}

#[test]
fn invalid_config_values_are_a_config_error_at_verify() {
    let mut file = sample();
    file.config.opening_residents = 61;
    assert!(matches!(verify(&file), Err(ReplayError::Config(_))));
    let mut file = sample();
    file.config.opening_residents = 39;
    assert!(matches!(verify(&file), Err(ReplayError::Config(_))));
}

#[test]
fn v4_claim_customization_round_trips_without_changing_version() {
    use sim_core::replay::ReplayPayload;
    use sim_core::underworld::carry_over::TraitName;
    use sim_core::underworld::customization::Customization;
    use sim_core::underworld::slots::SlotRef;

    let payloads = [
        (
            InputPayload::ClaimSlot {
                slot: SlotRef::ImportedVessel,
                customization: None,
            },
            r#"{"ClaimSlot":{"slot":"ImportedVessel"}}"#,
        ),
        (
            InputPayload::ClaimSlot {
                slot: SlotRef::RebuiltBody,
                customization: Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 3,
                }),
            },
            r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Set":{"trait_name":"piety","value":3}}}}"#,
        ),
        (
            InputPayload::ClaimSlot {
                slot: SlotRef::RebuiltBody,
                customization: Some(Customization::Adjust {
                    first: (TraitName::Piety, -1),
                    second: (TraitName::Greed, 1),
                }),
            },
            r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Adjust":{"first":{"trait_name":"piety","delta":-1},"second":{"trait_name":"greed","delta":1}}}}}"#,
        ),
    ];
    assert_eq!(REPLAY_VERSION, 4);
    for (payload, expected) in payloads {
        let json = serde_json::to_string(&ReplayPayload::from(payload)).unwrap();
        assert_eq!(json, expected);
        let dto: ReplayPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(InputPayload::from(dto), payload);
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 17: Replays reproduce every Checksum.
    #[test]
    fn replays_reproduce_every_checksum(
        scenario in life_gen::arb_scenario(),
        tamper in 0u64..life_gen::TICKS,
    ) {
        let config = WorldConfig::try_new(scenario.residents).expect("scenario config");
        let ticks = life_gen::TICKS;
        let file = record(scenario.seed, config, &scenario.inputs, ticks)
            .expect("a generated run records");
        prop_assert_eq!(file.checksums.len(), usize::try_from(ticks).unwrap());
        prop_assert_eq!(verify(&file), Ok(()));

        // Altering one recorded checksum is reported at that tick and no earlier one.
        let index = usize::try_from(tamper).unwrap();
        let mut tampered = file.clone();
        let recorded = tampered.checksums[index];
        tampered.checksums[index] = Checksum(recorded.0 ^ 1);
        match verify(&tampered) {
            Err(ReplayError::Diverged(divergence)) => {
                prop_assert_eq!(divergence.tick.0, tamper);
                prop_assert_eq!(divergence.expected, tampered.checksums[index]);
                prop_assert_eq!(divergence.actual, recorded);
            }
            other => {
                return Err(TestCaseError::fail(format!(
                    "seed {} tampered tick {tamper}: expected Diverged, got {other:?}",
                    scenario.seed
                )));
            }
        }
    }
}
