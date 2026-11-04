//! Replay file: record and verify in-process, JSON round trip, tamper detection and
//! strict parsing (R4.5, R6.2, R6.4).

use sim_core::checksum::Checksum;
use sim_core::ids::{EntityId, Tick};
use sim_core::input::InputPayload;
use sim_core::replay::{
    Divergence, REPLAY_FORMAT, REPLAY_VERSION, ReplayError, ReplayFile, record, verify,
};
use sim_core::tick::Sim;
use sim_core::world::{Workload, WorldConfig};

const TICKS: u64 = 300;

/// Valid and deliberately invalid inputs, in submission order and NOT in tick order,
/// so `seq` order and `(tick, seq)` order differ.
fn mixed_inputs() -> Vec<(Tick, InputPayload)> {
    let set = |entity, value| InputPayload::SetValue {
        entity: EntityId(entity),
        value,
    };
    vec![
        (Tick(40), set(1, 900)),                         // valid
        (Tick(3), set(2, 100)),                          // valid, earlier tick
        (Tick(3), set(9_999, 100)),                      // unknown entity
        (Tick(10), set(0, 1001)),                        // out of range (high)
        (Tick(10), set(0, -1)),                          // out of range (low)
        (Tick(20), InputPayload::Spawn { value: 250 }),  // valid
        (Tick(20), InputPayload::Spawn { value: 5000 }), // out of range
        (
            Tick(60),
            InputPayload::Despawn {
                entity: EntityId(3),
            },
        ), // valid
        (
            Tick(60),
            InputPayload::Despawn {
                entity: EntityId(3),
            },
        ), // already gone
        (
            Tick(0),
            InputPayload::Despawn {
                entity: EntityId(u64::MAX - 1),
            },
        ), // unknown
        (Tick(1 << 60), set(1, 1)),                      // far future, never applied
    ]
}

fn cases() -> Vec<(u64, WorldConfig)> {
    let cfg = |n, w| WorldConfig::try_new(n, w).unwrap();
    vec![
        (1, cfg(12, Workload::Pairwise)),
        (0x0123_4567_89ab_cdef, cfg(20, Workload::Light)),
        (u64::MAX, cfg(8, Workload::Pairwise)),
        (42, cfg(15, Workload::Light)),
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
        // seq numbers are 0..n in listed order.
        for (i, input) in file.inputs.iter().enumerate() {
            assert_eq!(input.seq, i as u64);
        }
        assert_eq!(verify(&file), Ok(()), "seed {seed}");
    }
}

#[test]
fn mixed_inputs_really_exercise_the_rejection_record() {
    let (seed, config) = cases()[0];
    let mut sim = Sim::new(seed, config).unwrap();
    for (tick, payload) in mixed_inputs() {
        sim.submit(tick, payload).unwrap();
    }
    for _ in 0..TICKS {
        sim.step();
    }
    let total: u64 = sim.world().rejections().count_by_reason.values().sum();
    assert!(total >= 5, "expected several rejections, got {total}");
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
        // Writing again gives the same text: one textual form per file.
        assert_eq!(back.to_json_string().unwrap(), json);
    }
}

#[test]
fn json_has_the_documented_shape() {
    let file = record(
        1_234_567_890_123,
        WorldConfig::try_new(5, Workload::Pairwise).unwrap(),
        &[(
            Tick(5),
            InputPayload::SetValue {
                entity: EntityId(3),
                value: 500,
            },
        )],
        2,
    )
    .unwrap();
    let json = file.to_json_string().unwrap();
    assert!(json.starts_with(
        r#"{"format":"back-in-the-family/replay","version":2,"seed":"1234567890123","config":{"entity_count":5,"workload":"Pairwise"},"ticks":"2","inputs":[{"tick":"5","seq":"0","payload":{"SetValue":{"entity":"3","value":500}}}],"checksums":[""#
    ));
    for c in &file.checksums {
        assert!(json.contains(&format!("\"{c}\"")));
    }
}

#[test]
fn tampered_checksum_is_reported_at_the_right_tick() {
    let original = sample();
    for n in [0usize, 1, 3, 150, TICKS as usize - 1] {
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
fn tampered_tick_digit_in_json_text_is_caught() {
    let file = sample();
    let json = file.to_json_string().unwrap();
    let target = file.checksums[7].to_hex_string();
    let mut chars: Vec<char> = target.chars().collect();
    chars[15] = if chars[15] == '0' { '1' } else { '0' };
    let changed: String = chars.into_iter().collect();
    let tampered = json.replacen(&target, &changed, 1);
    assert_ne!(tampered, json);
    let parsed = ReplayFile::from_json_str(&tampered).unwrap();
    match verify(&parsed) {
        Err(ReplayError::Diverged(d)) => {
            assert_eq!(d.tick, Tick(7));
            assert_eq!(d.expected.to_hex_string(), changed);
            assert_eq!(d.actual, file.checksums[7]);
        }
        other => panic!("expected divergence, got {other:?}"),
    }
}

#[test]
fn verify_uses_seed_config_and_inputs_not_the_recorded_checksums() {
    // Changing an input changes the re-run, so the unchanged checksums no longer match.
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
    // A huge declared tick count is rejected before any tick runs.
    let mut huge = sample();
    huge.ticks = u64::MAX;
    assert!(matches!(
        verify(&huge),
        Err(ReplayError::ChecksumCount { .. })
    ));
}

#[test]
fn unknown_format_and_version_are_rejected() {
    let json = sample().to_json_string().unwrap();

    let bad_format = json.replacen(REPLAY_FORMAT, "somebody-else/replay", 1);
    assert!(matches!(
        ReplayFile::from_json_str(&bad_format),
        Err(ReplayError::UnknownFormat { .. })
    ));

    let bad_version = json.replacen("\"version\":2", "\"version\":3", 1);
    assert_eq!(
        ReplayFile::from_json_str(&bad_version),
        Err(ReplayError::UnsupportedVersion { found: 3 })
    );

    // A future file with a different shape still reports the version, not a field error.
    let future = r#"{"format":"back-in-the-family/replay","version":9,"brand_new":true}"#;
    assert_eq!(
        ReplayFile::from_json_str(future),
        Err(ReplayError::UnsupportedVersion { found: 9 })
    );

    // verify() checks the header too, for files built or edited in memory.
    let mut file = sample();
    file.version = 1;
    assert_eq!(
        verify(&file),
        Err(ReplayError::UnsupportedVersion { found: 1 })
    );
    let mut file = sample();
    file.format = "x".into();
    assert!(matches!(
        verify(&file),
        Err(ReplayError::UnknownFormat { .. })
    ));
}

#[test]
fn u64_values_above_2_pow_53_survive_the_round_trip() {
    let big = (1u64 << 53) + 1;
    let mut file = record(
        u64::MAX,
        WorldConfig::try_new(3, Workload::Light).unwrap(),
        &[
            (
                Tick(big),
                InputPayload::SetValue {
                    entity: EntityId(u64::MAX),
                    value: 7,
                },
            ),
            (
                Tick(u64::MAX),
                InputPayload::Despawn {
                    entity: EntityId(big),
                },
            ),
        ],
        5,
    )
    .unwrap();
    assert_eq!(file.seed, u64::MAX);
    file.inputs[1].seq = u64::MAX - 1; // not verifiable, but must round-trip exactly
    let json = file.to_json_string().unwrap();
    assert!(json.contains(r#""seed":"18446744073709551615""#));
    assert!(json.contains(r#""tick":"9007199254740993""#));
    assert!(json.contains(r#""seq":"18446744073709551614""#));
    assert!(json.contains(r#""entity":"18446744073709551615""#));
    let back = ReplayFile::from_json_str(&json).unwrap();
    assert_eq!(back, file);

    // The unmodified file verifies after a round trip.
    let ok = ReplayFile::from_json_str(
        &record(u64::MAX, WorldConfig::default(), &[], 3)
            .unwrap()
            .to_json_string()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(verify(&ok), Ok(()));
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
        "-0",
        "00",
        " 1",
        "1 ",
        "1_0",
        "0x10",
        "1.0",
        "1e3",
        "١٢", // non-ASCII digits
        "18446744073709551616",
        "99999999999999999999999999",
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

    // Boundary values are accepted.
    for (text, value) in [("0", 0u64), ("18446744073709551615", u64::MAX)] {
        let json = json.replacen(&seed_text, &format!("\"seed\":\"{text}\""), 1);
        assert_eq!(ReplayFile::from_json_str(&json).unwrap().seed, value);
    }

    // Same rules apply to ticks, input tick/seq and entity ids.
    for (key, value) in [
        ("ticks", "300"),
        ("tick", "40"),
        ("seq", "0"),
        ("entity", "1"),
    ] {
        let field = format!("\"{key}\":\"{value}\"");
        assert!(json.contains(&field), "{field}");
        let text = json.replacen(&field, &format!("\"{key}\":{value}"), 1);
        assert!(
            matches!(
                ReplayFile::from_json_str(&text),
                Err(ReplayError::Malformed(_))
            ),
            "bare number for {field} should be rejected"
        );
        let text = json.replacen(&field, &format!("\"{key}\":\"0{value}\""), 1);
        assert!(
            matches!(
                ReplayFile::from_json_str(&text),
                Err(ReplayError::Malformed(_))
            ),
            "leading zero for {field} should be rejected"
        );
    }
}

/// Version 1 files (which carried `days_per_tick`) are rejected by the version check,
/// before the config is looked at.
#[test]
fn version_1_files_are_rejected_as_unsupported() {
    let v1 = r#"{"format":"back-in-the-family/replay","version":1,"seed":"1","config":{"entity_count":5,"days_per_tick":1,"workload":"Light"},"ticks":"0","inputs":[],"checksums":[]}"#;
    assert_eq!(
        ReplayFile::from_json_str(v1),
        Err(ReplayError::UnsupportedVersion { found: 1 })
    );
}

#[test]
fn floats_and_bad_small_ints_are_rejected() {
    let json = sample().to_json_string().unwrap();
    for (from, to) in [
        ("\"value\":900", "\"value\":900.5"),
        ("\"entity_count\":12", "\"entity_count\":12.0"),
        ("\"entity_count\":12", "\"entity_count\":70000"),
        (
            "\"entity_count\":12",
            "\"days_per_tick\":1,\"entity_count\":12",
        ),
        ("\"version\":2", "\"version\":2.5"),
        ("\"workload\":\"Pairwise\"", "\"workload\":\"Heavy\""),
    ] {
        let text = json.replacen(from, to, 1);
        assert_ne!(text, json, "{from}");
        assert!(
            matches!(
                ReplayFile::from_json_str(&text),
                Err(ReplayError::Malformed(_))
            ),
            "{to} should be rejected"
        );
    }
}

#[test]
fn invalid_config_values_are_a_config_error_at_verify() {
    let mut file = sample();
    file.config.entity_count = 201;
    assert!(matches!(verify(&file), Err(ReplayError::Config(_))));
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
        json[..json.len() / 2].to_owned(),        // truncated
        json.replacen("\"seed\"", "\"sede\"", 1), // misspelled field
        json.replacen("\"checksums\"", "\"extra\":1,\"checksums\"", 1), // unknown field
        json.replacen(",\"ticks\":\"300\"", "", 1), // missing field
        json.replacen("\"payload\":{\"SetValue\"", "\"payload\":{\"Teleport\"", 1),
        json.replacen("\"workload\":\"Pairwise\"", "\"workload\":7", 1),
        json.replacen(&sample().checksums[0].to_hex_string(), "XYZ", 1),
        "\u{0}\u{1}\u{2}".into(),
    ];
    for text in &cases {
        // A panic here fails the test by itself; the explicit check is for `Ok`.
        assert!(
            ReplayFile::from_json_str(text).is_err(),
            "{text:?} should be rejected"
        );
    }
    // Wrong checksum text specifically.
    let bad_sum = json.replacen(&sample().checksums[0].to_hex_string(), "0123", 1);
    assert!(matches!(
        ReplayFile::from_json_str(&bad_sum),
        Err(ReplayError::Malformed(_))
    ));
}

#[test]
fn out_of_order_or_gapped_seq_is_a_malformed_file_error() {
    // Swapped.
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

    // Gap in the middle.
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

    // Does not start at 0.
    let mut file = sample();
    for input in &mut file.inputs {
        input.seq += 1;
    }
    assert!(matches!(
        verify(&file),
        Err(ReplayError::InputSeqMismatch { index: 0, .. })
    ));

    // Duplicate.
    let mut file = sample();
    file.inputs[3].seq = 2;
    assert!(matches!(
        verify(&file),
        Err(ReplayError::InputSeqMismatch { index: 3, .. })
    ));
}

#[test]
fn record_rejects_an_invalid_config() {
    let bad = WorldConfig {
        entity_count: 201,
        workload: Workload::Light,
    };
    assert!(matches!(
        record(1, bad, &[], 1),
        Err(ReplayError::Config(_))
    ));
}

// ---------------------------------------------------------------------------------
// Parity fixtures (design decision D7): `fixtures/parity/*.replay.json`, recorded by
// `sim-cli record` (see fixtures/parity/README.md). Task 9 verifies the same files
// under WASM.
// ---------------------------------------------------------------------------------

/// The exact set of fixture file names. A deleted or renamed fixture must fail the
/// test, not silently shrink coverage.
const FIXTURE_NAMES: [&str; 3] = [
    "seed1-pairwise.replay.json",
    "seed2-pairwise.replay.json",
    "seedbig-pairwise.replay.json",
];

const FIXTURE_TICKS: u64 = 2000;

fn fixture_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/parity")
}

fn load_fixture(name: &str) -> ReplayFile {
    let path = fixture_dir().join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixture {}: {e}", path.display()));
    ReplayFile::from_json_str(&text)
        .unwrap_or_else(|e| panic!("fixture {} is malformed: {e}", path.display()))
}

#[test]
fn the_fixture_directory_holds_exactly_the_expected_replays() {
    let mut found: Vec<String> = std::fs::read_dir(fixture_dir())
        .expect("fixtures/parity must exist")
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.ends_with(".replay.json"))
        .collect();
    found.sort();
    assert_eq!(found, FIXTURE_NAMES);
}

#[test]
fn every_parity_fixture_replays_ok() {
    for name in FIXTURE_NAMES {
        let file = load_fixture(name);
        assert_eq!(verify(&file), Ok(()), "{name}");
    }
}

#[test]
fn parity_fixtures_have_the_documented_shape() {
    for name in FIXTURE_NAMES {
        let file = load_fixture(name);
        assert_eq!(file.ticks, FIXTURE_TICKS, "{name}");
        assert_eq!(file.checksums.len() as u64, FIXTURE_TICKS, "{name}");
        assert_eq!(file.config.entity_count, 50, "{name}");
        assert_eq!(
            Workload::from(file.config.workload),
            Workload::Pairwise,
            "{name}"
        );
        let seed = if name.starts_with("seedbig") {
            18_446_744_073_709_551_557
        } else if name.starts_with("seed2") {
            2
        } else {
            1
        };
        assert_eq!(file.seed, seed, "{name}");
        assert!(!file.inputs.is_empty(), "{name} has no recorded inputs");

        // The recorded inputs include invalid ones: re-running them produces rejections.
        let config = WorldConfig::try_from(file.config).unwrap();
        let mut sim = Sim::new(file.seed, config).unwrap();
        for input in &file.inputs {
            sim.submit(Tick(input.tick), input.payload.into()).unwrap();
        }
        for _ in 0..file.ticks {
            sim.step();
        }
        let rejected: u64 = sim.world().rejections().count_by_reason.values().sum();
        assert!(rejected > 0, "{name}: no rejection was exercised");
    }
}

#[test]
fn a_tampered_fixture_checksum_is_reported_at_the_right_tick() {
    let mut file = load_fixture(FIXTURE_NAMES[0]);
    let truth = file.checksums[1234];
    let tampered = flip_last_digit(truth);
    file.checksums[1234] = tampered;
    assert_eq!(
        verify(&file),
        Err(ReplayError::Diverged(Divergence {
            tick: Tick(1234),
            expected: tampered,
            actual: truth,
        }))
    );
}
