//! The same preview scenarios run natively and in Node via wasm-bindgen-test-runner.

use proptest::prelude::*;
use proptest::test_runner::{RngAlgorithm, TestRng, TestRunner};
use serde_json::{Value, json};
use sim_core::ids::{InputSeq, Tick};
use sim_core::input::InputPayload;
use sim_core::replay::{ReplayFile, ReplayPayload};
use sim_core::tick::Sim;
use sim_core::underworld::dreams::DreamIntent;
use sim_core::underworld::nodes::{ChoiceSource, NodeFamily, NodeOption, NodeRef};
use sim_core::world::Life;
use wasm_bindgen_test::wasm_bindgen_test;

use super::{WasmSim, llm};

const DREAM: &str = r#"{"Dream":{"dreamer":"31","intent":"urge"}}"#;
const BRIBE: &str = r#"{"Bribe":{"amount":"1"}}"#;
const FIRING_TICK: Tick = Tick(1654);
const DREAM_SEQ: InputSeq = InputSeq(61);
const BRIBE_SEQ: InputSeq = InputSeq(62);
const MAPPING: &str = "[instructions]\nPick an option.\n[state]\n{{tick}} {{situation}}\n{{people}}\n{{relations}}\n{{events}}\n{{player_input}}\n{{subject}}";

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
    #[cfg(not(target_arch = "wasm32"))]
    println!("PREVIEW_PARITY {label}\t{reply}");
    #[cfg(target_arch = "wasm32")]
    wasm_bindgen_test::console_log!("PREVIEW_PARITY {label}\t{reply}");
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
    let rendered = render(MAPPING);
    let value = decode(&rendered);
    assert_eq!(value["ok"], true);
    assert_eq!(value["criteria"], node["option_defs"]);
    emit(&format!("{family}.render"), &rendered);
    let bad_mapping = render("[instructions]\nPick.\n[state]\n{{options}}");
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
