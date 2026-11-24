//! The same preview scenarios run natively and in Node via wasm-bindgen-test-runner.

use proptest::prelude::*;
use proptest::test_runner::{RngAlgorithm, TestRng, TestRunner};
use serde_json::{Value, json};
use sim_core::canon::encode_to_vec;
use sim_core::decision_contract;
use sim_core::decision_fingerprint::DecisionFingerprint;
use sim_core::ids::{InputSeq, Tick};
use sim_core::input::InputPayload;
use sim_core::replay::{ReplayError, ReplayFile, ReplayNodeOption, ReplayPayload, verify};
use sim_core::tick::Sim;
use sim_core::underworld::dreams::DreamIntent;
use sim_core::underworld::nodes::{ChoiceSource, NodeFamily, NodeOption, NodeRef};
use sim_core::world::Life;
use wasm_bindgen_test::wasm_bindgen_test;

use super::{WasmSim, llm, verify_replay};

const DREAM: &str = r#"{"Dream":{"dreamer":"31","intent":"urge"}}"#;
const BRIBE: &str = r#"{"Bribe":{"amount":"1"}}"#;
const FIRING_TICK: Tick = Tick(1654);
const DREAM_SEQ: InputSeq = InputSeq(61);
const BRIBE_SEQ: InputSeq = InputSeq(62);

fn decode(reply: &str) -> Value {
    serde_json::from_str(reply).expect("expected JSON object")
}

// The unmodified parity fixture queues CarryOver and both families on tick 1654.
// Stop before their firing tick, with only the preceding inputs queued (including
// already assigned future inputs). This is a real run, not a synthetic World.
fn before_triggers() -> (WasmSim, ReplayFile) {
    let replay = ReplayFile::from_json_str(include_str!(
        "../../../fixtures/parity/seedU-underworld.replay.json"
    ))
    .unwrap();
    let config = serde_json::to_string(&replay.config).unwrap();
    let mut sim = WasmSim::create(replay.seed, &config).unwrap();
    for input in replay
        .inputs
        .iter()
        .take_while(|input| input.seq < DREAM_SEQ.0)
    {
        let seq = sim
            .inner
            .submit(Tick(input.tick), input.payload.into())
            .unwrap();
        assert_eq!(seq, InputSeq(input.seq));
    }
    while sim.tick() < FIRING_TICK.0 {
        sim.inner.step();
    }
    assert_eq!(
        sim.inner.checksums(),
        &replay.checksums[..FIRING_TICK.0 as usize]
    );
    (sim, replay)
}

// Preserve the exact export bytes; do not parse and reserialize the evidence.
// Run this test on both targets with --nocapture and compare PREVIEW_PARITY lines.
fn emit(label: &str, reply: &str) {
    emit_json("PREVIEW_PARITY", label, reply);
}

fn emit_json(marker: &str, label: &str, reply: &str) {
    #[cfg(not(target_arch = "wasm32"))]
    println!("{marker} {label}\t{reply}");
    #[cfg(target_arch = "wasm32")]
    wasm_bindgen_test::console_log!("{marker} {label}\t{reply}");
}

fn assert_node_shape(node: &Value, family: &str, seq: InputSeq, option_ids: [&str; 3]) {
    assert_eq!(
        node.as_object().unwrap().len(),
        7,
        "closed NodeSpec transport"
    );
    assert_eq!(node["ok"], true);
    assert_eq!(node["family"], family);
    assert_eq!(node["trigger"], seq.0.to_string());
    let context = &node["frozen_context"];
    assert_eq!(context["family"], family);
    assert_eq!(context["task"], "decision");
    assert_eq!(context["tick"], FIRING_TICK.0);
    assert!(
        context["subject"].is_u64(),
        "pinned renderer uses numeric person IDs"
    );
    assert_eq!(node["option_ids"], json!(option_ids));
    assert_eq!(node["option_defs"], context["options"]);
    let defs = node["option_defs"].as_array().unwrap();
    assert_eq!(defs.len(), option_ids.len());
    for (def, id) in defs.iter().zip(option_ids) {
        assert_eq!(def.as_object().unwrap().len(), 2);
        assert_eq!(def["id"], id);
        assert!(!def["label"].as_str().unwrap().is_empty());
    }
    assert!(option_ids.contains(&node["rules_default"].as_str().unwrap()));
}

fn render_and_validate(family: &str, node: &Value) {
    let render = |mapping| {
        llm::llm_render_system_one(
            &json!({"frozen_context": node["frozen_context"], "mapping": mapping,
                "permutation": "base"})
            .to_string(),
        )
    };
    let rendered = render(decision_contract::SYSTEM_ONE_MAPPING);
    let value = decode(&rendered);
    assert_eq!(value["ok"], true);
    assert_eq!(value["criteria"], node["option_defs"]);
    assert_eq!(value["question_id"], "decision");
    assert!(
        value["state"]
            .as_str()
            .unwrap()
            .starts_with("Today is day 1654.\n")
    );
    assert!(
        value["instructions"]
            .as_str()
            .unwrap()
            .contains("How to read the facts:")
    );
    emit(&format!("{family}.render"), &rendered);
    let corrupt_mapping =
        decision_contract::SYSTEM_ONE_MAPPING.replacen("{{subject}}", "{{options}}", 1);
    let bad_mapping = render(&corrupt_mapping);
    assert_eq!(decode(&bad_mapping)["error"]["kind"], "render");
    emit(&format!("{family}.render_error"), &bad_mapping);

    for (label, raw, kind) in [
        (
            "validate",
            node["rules_default"].as_str().unwrap(),
            "decision",
        ),
        ("illegal", "not_an_option", "illegal"),
    ] {
        let validated = llm::llm_validate(
            &json!({"frozen_context": node["frozen_context"], "mode": "raw_choice", "raw": raw})
                .to_string(),
        );
        let value = decode(&validated);
        assert_eq!(value["ok"], true);
        assert_eq!(value["verdict"]["kind"], kind);
        if kind == "decision" {
            assert_eq!(value["verdict"]["option"], raw);
        }
        emit(&format!("{family}.{label}"), &validated);
    }
}

#[wasm_bindgen_test(unsupported = test)]
fn decision_contract_native_wasm_json_trace() {
    use decision_contract::{
        FINGERPRINT, MAPPING_HASH, MAPPING_VERSION, MODEL, PROVIDER, RESPONSE_SCHEMA,
        SYSTEM_ONE_MAPPING,
    };

    assert_eq!(
        SYSTEM_ONE_MAPPING.as_bytes(),
        include_bytes!("../../../eval/probe/templates/decision.system_one.v1.txt")
    );
    let fingerprint_input = [
        PROVIDER,
        MODEL,
        MAPPING_VERSION,
        MAPPING_HASH,
        RESPONSE_SCHEMA,
    ]
    .join("\0");
    assert_eq!(fingerprint_input.len(), 146);
    assert_eq!(
        fingerprint_input.bytes().filter(|byte| *byte == 0).count(),
        4
    );
    assert!(!fingerprint_input.ends_with('\0'));
    let contract = json!({
        "provider": PROVIDER,
        "model": MODEL,
        "mappingVersion": MAPPING_VERSION,
        "mappingHash": MAPPING_HASH,
        "responseSchema": RESPONSE_SCHEMA,
        "fingerprint": FINGERPRINT.to_string(),
        "fingerprintInput": fingerprint_input,
        "mapping": SYSTEM_ONE_MAPPING,
    });
    emit_json(
        "DECISION_CONTRACT_PARITY",
        "contract",
        &contract.to_string(),
    );
}

#[wasm_bindgen_test(unsupported = test)]
fn preview_native_wasm_json_trace() {
    let (mut sim, replay) = before_triggers();
    let bribe_before_dream = decode(&sim.preview_node(BRIBE));
    let dream_reply = sim.preview_node(DREAM);
    let dream = decode(&dream_reply);
    assert_node_shape(
        &dream,
        "dream_interpretation",
        DREAM_SEQ,
        ["follow_urging", "burn_offering", "dismiss_dream"],
    );
    assert_eq!(dream["frozen_context"]["subject"], 31);
    let dream_payload = serde_json::from_str::<ReplayPayload>(DREAM).unwrap().into();
    assert_eq!(
        sim.inner.try_submit_all(&[dream_payload]),
        Ok(vec![DREAM_SEQ])
    );

    let bribe_reply = sim.preview_node(BRIBE);
    let bribe = decode(&bribe_reply);
    assert_node_shape(
        &bribe,
        "magistrate_ruling",
        BRIBE_SEQ,
        ["grant_next_slot", "grant_later_slot", "deny"],
    );
    let has_current_dream = |reply: &Value| {
        reply["frozen_context"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["type"] == "dream" && event["tick"] == FIRING_TICK.0)
    };
    assert!(!has_current_dream(&bribe_before_dream));
    assert!(
        has_current_dream(&bribe),
        "a queued Dream changes Bribe's frozen facts"
    );
    for (label, reply, node) in [
        ("dream", dream_reply, &dream),
        ("bribe", bribe_reply, &bribe),
    ] {
        emit(label, &reply);
        render_and_validate(label, node);
    }

    let actor = dream["frozen_context"]["subject"].as_u64().unwrap();
    let target = sim
        .inner
        .world()
        .persons()
        .values()
        .find(|person| person.id.0 != actor && !matches!(person.life, Life::Dead { .. }))
        .unwrap()
        .id
        .0;
    let act = json!({"Act": {"kind": "help", "actor": actor.to_string(),
        "target": target.to_string(), "intensity": 1}});
    let act_json = act.to_string();
    let before_errors = sim.inner.clone();
    for (label, input, expected) in [
        (
            "malformed",
            r#"{"Dream":{"dreamer":31,"intent":"urge"}}"#,
            json!({"kind":"malformed"}),
        ),
        (
            "dream_rejected",
            DREAM,
            json!({"kind":"rejected","reason":"rate_limited"}),
        ),
        (
            "bribe_rejected",
            r#"{"Bribe":{"amount":"0"}}"#,
            json!({"kind":"rejected","reason":"bad_amount"}),
        ),
        ("no_node", &act_json, json!({"kind":"no_node"})),
    ] {
        let reply = sim.preview_node(input);
        assert_eq!(decode(&reply), json!({"ok": false, "error": expected}));
        emit(label, &reply);
    }
    for (label, reply) in [
        ("render_malformed", llm::llm_render_system_one("{")),
        ("validate_malformed", llm::llm_validate("{")),
    ] {
        assert_eq!(decode(&reply)["error"]["kind"], "input");
        emit(label, &reply);
    }
    same_live_run(&sim.inner, &before_errors).unwrap();

    let seq = InputSeq(bribe["trigger"].as_str().unwrap().parse().unwrap());
    let payload = serde_json::from_str::<ReplayPayload>(BRIBE).unwrap().into();
    let choose = InputPayload::Choose {
        node: NodeRef::Trigger { seq },
        option: NodeOption::Deny,
        fingerprint: None,
    };
    assert_eq!(
        sim.inner.try_submit_all(&[payload, choose]),
        Ok(vec![seq, InputSeq(63)])
    );
    assert_eq!(sim.inner.step(), replay.checksums[FIRING_TICK.0 as usize]);
    let resolved = &sim.inner.world().nodes().resolved;
    assert_eq!(resolved.len(), 2);
    for (record, node) in resolved.iter().zip([dream, bribe]) {
        assert_eq!(node["frozen_context"]["subject"], record.subject.0);
        assert_eq!(node["rules_default"], record.rules_default.id());
    }
    assert_eq!(resolved[0].family, NodeFamily::DreamInterpretation);
    assert_eq!(resolved[0].source, ChoiceSource::RulesDefault);
    assert_eq!(resolved[1].family, NodeFamily::MagistrateRuling);
    assert_eq!(resolved[1].source, ChoiceSource::External);
    assert_eq!(resolved[1].applied, NodeOption::Deny);
}

#[wasm_bindgen_test(unsupported = test)]
fn preview_rejects_non_strict_payloads() {
    let sim = WasmSim::create(1, r#"{"opening_residents":50}"#).unwrap();
    let before = sim.inner.clone();
    for input in [
        "{",
        "null",
        "{}",
        r#"{"Dream":["31","urge"]}"#,
        r#"{"Dream":{"dreamer":"31"}}"#,
        r#"{"Dream":{"dreamer":"31","intent":"URGE"}}"#,
        r#"{"Dream":{"dreamer":"31","intent":"urge","seq":"0"}}"#,
        r#"{"Dream":{"dreamer":"31","dreamer":"32","intent":"urge"}}"#,
        r#"{"Dream":{"dreamer":"031","intent":"urge"}}"#,
        r#"{"Dream":{"dreamer":"+31","intent":"urge"}}"#,
        r#"{"Dream":{"dreamer":"٣١","intent":"urge"}}"#,
        r#"{"Bribe":{"amount":1}}"#,
        r#"{"Bribe":{"amount":"18446744073709551616"}}"#,
        r#"{"Bribe":{"amount":"1"},"Dream":{"dreamer":"31","intent":"urge"}}"#,
        r#"{"Bribe":{"amount":"1"}} {}"#,
        r#"{"tick":"0","payload":{"Bribe":{"amount":"1"}}}"#,
    ] {
        assert_eq!(
            decode(&sim.preview_node(input)),
            json!({"ok":false,"error":{"kind":"malformed"}}),
            "{input}"
        );
    }
    same_live_run(&sim.inner, &before).unwrap();
}

fn same_live_run(left: &Sim, right: &Sim) -> Result<(), TestCaseError> {
    prop_assert_eq!(left.inputs().next_seq(), right.inputs().next_seq());
    prop_assert_eq!(left.inputs().all(), right.inputs().all());
    prop_assert_eq!(left.checksums(), right.checksums());
    prop_assert_eq!(left.world(), right.world());
    prop_assert_eq!(left.last_stops(), right.last_stops());
    prop_assert_eq!(left.last_outcomes(), right.last_outcomes());
    Ok(())
}

#[wasm_bindgen_test(unsupported = test)]
fn preview_is_read_only_and_predicts_keyed_choices() {
    let (base, _) = before_triggers();
    // No thread/OS RNG, filesystem persistence or elapsed-time limit in the WASM runner.
    let config = ProptestConfig {
        cases: 100,
        failure_persistence: None,
        ..ProptestConfig::default()
    };
    let rng = TestRng::from_seed(RngAlgorithm::ChaCha, &[17; 32]);
    let mut runner = TestRunner::new_with_rng(config, rng);
    runner
        .run(
            &(0..DreamIntent::ALL.len(), any::<bool>(), 1..5_u8, 0..4_u64),
            |(intent, dream_first, repeats, future)| {
                let dream = InputPayload::Dream {
                    dreamer: sim_core::ids::PersonId(31),
                    intent: DreamIntent::ALL[intent],
                };
                let bribe = InputPayload::Bribe { amount: 1 };
                let mut plain = base.inner.clone();
                let mut probed = WasmSim {
                    inner: plain.clone(),
                };
                for delta in 1..=future {
                    // These consume sequences without applying in the firing tick.
                    let tick = Tick(FIRING_TICK.0 + delta);
                    let later = InputPayload::Bribe { amount: 0 };
                    prop_assert_eq!(probed.inner.submit(tick, later), plain.submit(tick, later));
                }
                let order = if dream_first {
                    [dream, bribe]
                } else {
                    [bribe, dream]
                };
                let mut defaults = Vec::new();
                for payload in order {
                    let input = serde_json::to_string(&ReplayPayload::from(payload)).unwrap();
                    let preview = probed.preview_node(&input);
                    for _ in 1..repeats {
                        prop_assert_eq!(&probed.preview_node(&input), &preview);
                    }
                    same_live_run(&probed.inner, &plain)?;
                    let node = decode(&preview);
                    prop_assert_eq!(&node["ok"], &json!(true));
                    let assigned = plain.try_submit_all(&[payload]).unwrap();
                    prop_assert_eq!(&node["trigger"], &json!(assigned[0].0.to_string()));
                    prop_assert_eq!(probed.inner.try_submit_all(&[payload]), Ok(assigned));
                    defaults.push(node);
                }
                prop_assert_eq!(probed.inner.step(), plain.step());
                same_live_run(&probed.inner, &plain)?;
                let records = &plain.world().nodes().resolved;
                prop_assert_eq!(records.len(), defaults.len());
                for (record, node) in records.iter().zip(defaults) {
                    prop_assert_eq!(&node["rules_default"], &json!(record.rules_default.id()));
                    prop_assert_eq!(record.applied, record.rules_default);
                    prop_assert_eq!(record.source, ChoiceSource::RulesDefault);
                }
                // A second real keyed node (not just empty ticks) must remain exact.
                let later = InputPayload::Bribe { amount: 1 };
                prop_assert_eq!(
                    probed.inner.try_submit_all(&[later]),
                    plain.try_submit_all(&[later])
                );
                let resolved_count = plain.world().nodes().resolved.len();
                prop_assert_eq!(probed.inner.step(), plain.step());
                prop_assert_eq!(plain.world().nodes().resolved.len(), resolved_count + 1);
                same_live_run(&probed.inner, &plain)?;
                for _ in 0..=future {
                    prop_assert_eq!(probed.inner.step(), plain.step());
                    same_live_run(&probed.inner, &plain)?;
                }
                Ok(())
            },
        )
        .unwrap();
}

#[wasm_bindgen_test(unsupported = test)]
fn replay_export_native_wasm_json_trace() {
    let (mut sim, fixture) = before_triggers();
    let future_tick = FIRING_TICK.0 + 10;
    let future = format!(r#"{{"tick":"{future_tick}","payload":{{"Bribe":{{"amount":"0"}}}}}}"#);
    assert!(sim.submit(&future).is_ok());
    let spec = sim
        .inner
        .preview_node(InputPayload::Bribe { amount: 1 })
        .unwrap();
    assert_eq!(spec.trigger, BRIBE_SEQ);
    let option = spec.rules_default.id();
    let seq = spec.trigger.0;
    let historical = "ab".repeat(32);
    let batch = |fingerprint: &str| {
        format!(
            r#"[{BRIBE},{{"Choose":{{"node":{{"Trigger":{{"seq":"{seq}"}}}},"option":"{option}","fingerprint":{fingerprint}}}}}]"#,
        )
    };
    let mut fallback = WasmSim {
        inner: sim.inner.clone(),
    };
    let fallback_receipt = fallback.submit_checked_json(&format!("[{BRIBE}]")).unwrap();
    let fallback_seq = fallback
        .inner
        .inputs()
        .all()
        .iter()
        .max_by_key(|input| input.seq)
        .unwrap()
        .seq;
    assert_eq!(
        decode(&fallback_receipt),
        serde_json::json!({"ok":true,"tick":FIRING_TICK.0.to_string(),"seqs":[fallback_seq.0.to_string()]})
    );
    let before_submit = sim.inner.clone();
    for malformed in ["null", r#""f00""#] {
        assert!(sim.submit_checked_json(&batch(malformed)).is_err());
        same_live_run(&sim.inner, &before_submit).unwrap();
    }
    let receipt = sim
        .submit_checked_json(&batch(&format!(r#""{historical}""#)))
        .unwrap();
    let mut assigned: Vec<_> = sim
        .inner
        .inputs()
        .all()
        .iter()
        .map(|input| input.seq)
        .collect();
    assigned.sort_unstable();
    let assigned: Vec<_> = assigned[assigned.len() - 2..]
        .iter()
        .map(|seq| seq.0.to_string())
        .collect();
    assert_eq!(
        decode(&receipt),
        serde_json::json!({"ok":true,"tick":FIRING_TICK.0.to_string(),"seqs":assigned})
    );

    let mut unexported = sim.inner.clone();
    let Ok(queued_json) = sim.export_replay() else {
        panic!("queued audit export failed");
    };
    same_live_run(&sim.inner, &unexported).unwrap();
    let queued = ReplayFile::from_json_str(&queued_json).unwrap();
    assert_eq!(queued.seed, fixture.seed);
    assert_eq!(queued.config, fixture.config);
    assert_eq!(queued.ticks, FIRING_TICK.0);
    assert_eq!(
        queued.checksums,
        fixture.checksums[..FIRING_TICK.0 as usize]
    );
    assert_eq!(
        queued.inputs[seq as usize - 1..]
            .iter()
            .map(|input| (input.seq, input.tick))
            .collect::<Vec<_>>(),
        [
            (seq - 1, future_tick),
            (seq, FIRING_TICK.0),
            (seq + 1, FIRING_TICK.0),
        ]
    );
    assert!(matches!(
        queued.inputs.last().unwrap().payload,
        ReplayPayload::Choose { fingerprint: Some(value), .. }
            if value == DecisionFingerprint::from_bytes([0xab; 32])
    ));
    assert!(sim.inner.world().nodes().resolved.is_empty());
    assert!(verify_replay(&queued_json).is_ok());

    let checksum = sim.step();
    assert_eq!(checksum, unexported.step().to_hex_string());
    fallback.step();
    let external = &sim.inner.world().nodes().resolved[0];
    let rules = &fallback.inner.world().nodes().resolved[0];
    assert_eq!(external.applied, spec.rules_default);
    assert_eq!(rules.applied, external.applied);
    assert_eq!(external.source, ChoiceSource::External);
    assert_eq!(rules.source, ChoiceSource::RulesDefault);

    let Ok(completed_json) = sim.export_replay() else {
        panic!("completed audit export failed");
    };
    same_live_run(&sim.inner, &unexported).unwrap();
    let completed = ReplayFile::from_json_str(&completed_json).unwrap();
    assert_eq!(completed.ticks, queued.ticks + 1);
    assert_eq!(completed.inputs, queued.inputs);
    assert_eq!(
        completed.checksums.last().unwrap().to_hex_string(),
        checksum
    );
    assert_eq!(completed.to_json_string().unwrap(), completed_json);
    assert!(verify_replay(&completed_json).is_ok());
    let mut tampered = completed;
    let ReplayPayload::Choose { option, .. } = &mut tampered.inputs[seq as usize + 1].payload
    else {
        panic!("expected the accepted Choose");
    };
    *option = ReplayNodeOption::HeedWarning; // A Dream option on a Magistrate node.
    assert!(matches!(
        verify(&tampered),
        Err(ReplayError::Diverged(d)) if d.tick == FIRING_TICK
    ));

    // Keep the raw line in redirected logs; compare only marker count/digest in summaries.
    emit_json("REPLAY_EXPORT_PARITY", "completed", &completed_json);
}

#[wasm_bindgen_test(unsupported = test)]
fn replay_export_fingerprint_neutrality_and_round_trip() {
    let (base, _) = before_triggers();
    let config = ProptestConfig {
        cases: 100,
        failure_persistence: None,
        ..ProptestConfig::default()
    };
    let rng = TestRng::from_seed(RngAlgorithm::ChaCha, &[29; 32]);
    let mut runner = TestRunner::new_with_rng(config, rng);
    runner
        .run(
            &(any::<bool>(), 0..3_usize, any::<[u8; 32]>()),
            |(bribe, pick, bytes)| {
                let trigger =
                    serde_json::from_str::<ReplayPayload>(if bribe { BRIBE } else { DREAM })
                        .unwrap()
                        .into();
                let spec = base.inner.preview_node(trigger).unwrap();
                let option = spec.options[pick];
                let node = NodeRef::Trigger { seq: spec.trigger };
                let mut other = bytes;
                other[0] ^= 1;
                let fingerprints = [
                    None,
                    Some(DecisionFingerprint::from_bytes(bytes)),
                    Some(DecisionFingerprint::from_bytes(other)),
                ];
                let mut runs = fingerprints.map(|fingerprint| {
                    let mut sim = base.inner.clone();
                    let choose = InputPayload::Choose {
                        node,
                        option,
                        fingerprint,
                    };
                    assert_eq!(
                        sim.try_submit_all(&[trigger, choose]).unwrap()[0],
                        spec.trigger
                    );
                    sim
                });
                for sim in &mut runs {
                    sim.step();
                    let record = sim.world().nodes().resolved.last().unwrap();
                    prop_assert_eq!(record.applied, option);
                    prop_assert_eq!(record.source, ChoiceSource::External);
                    sim.step();
                }
                let canonical = encode_to_vec(runs[0].world());
                let mut exports = Vec::new();
                for (sim, fingerprint) in runs.iter().zip(fingerprints) {
                    let world_bytes = encode_to_vec(sim.world());
                    prop_assert_eq!(&world_bytes, &canonical);
                    prop_assert_eq!(sim.checksums(), runs[0].checksums());
                    let text = ReplayFile::from_sim(sim).unwrap().to_json_string().unwrap();
                    let decoded = ReplayFile::from_json_str(&text).unwrap();
                    prop_assert_eq!(&decoded.to_json_string().unwrap(), &text);
                    prop_assert_eq!(
                        InputPayload::from(decoded.inputs.last().unwrap().payload),
                        InputPayload::Choose {
                            node,
                            option,
                            fingerprint
                        }
                    );
                    exports.push(text);
                }
                prop_assert_ne!(&exports[0], &exports[1]);
                prop_assert_ne!(&exports[0], &exports[2]);
                prop_assert_ne!(&exports[1], &exports[2]);
                Ok(())
            },
        )
        .unwrap();
}
