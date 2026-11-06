//! Native and wasm32 grading parity (llm-probe task 5.4; requirements 4.13, 6.4, 6.5).
//!
//! Every Dev_Card x fixture output x export must produce exactly the bytes recorded in
//! `fixtures/grading/dev-golden.json`. The exports called here are the
//! `sim_wasm::llm` functions, i.e. the same functions that become the wasm-bindgen exports.
//! Under plain `cargo test` they run natively; under
//! `cargo test -p sim-wasm --target wasm32-unknown-unknown` they run in Node. Fixtures are
//! compiled in with `include_str!` because wasm32 tests cannot read the filesystem.
//!
//! Inputs are rebuilt from the golden header exactly as `fixtures/grading/README.md`
//! describes. A mismatch panics with the Card ID and the export name. The fixtures are
//! never written by this test.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};
use sim_wasm::llm::{
    llm_contrast, llm_grade, llm_identity, llm_parse_card, llm_permutations, llm_render_prompt,
    llm_validate,
};
use wasm_bindgen_test::wasm_bindgen_test;

const CARDS: &str = include_str!("../../../eval/cards/cards/dev.jsonl");
const OUTPUTS: &str = include_str!("../../../fixtures/grading/dev-outputs.json");
const GOLDEN: &str = include_str!("../../../fixtures/grading/dev-golden.json");

fn parse(text: &str, what: &str) -> Value {
    match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => panic!("{what}: not JSON: {e}"),
    }
}

fn compact(v: &Value) -> String {
    v.to_string()
}

fn text<'a>(v: &'a Value, what: &str) -> &'a str {
    match v.as_str() {
        Some(s) => s,
        None => panic!("{what}: expected a string"),
    }
}

fn list<'a>(v: &'a Value, what: &str) -> &'a Vec<Value> {
    match v.as_array() {
        Some(a) => a,
        None => panic!("{what}: expected a list"),
    }
}

/// Compares one export result with its golden string; the panic names card and export.
fn check(card: &str, export: &str, detail: &str, actual: &str, expected: &Value) {
    let expected = text(expected, &format!("golden {card} {export} {detail}"));
    assert!(
        actual == expected,
        "card {card}: export {export} ({detail}) differs from golden\n  expected: {expected}\n  actual:   {actual}"
    );
}

/// Dev_Card lines by card ID, in a map so the golden order does not matter.
fn card_lines() -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in CARDS.lines().filter(|l| !l.trim().is_empty()) {
        let parsed = parse(&llm_parse_card(line), "llm_parse_card");
        let id = text(&parsed["meta"]["id"], "card id").to_owned();
        map.insert(id, line.to_owned());
    }
    map
}

/// `label` -> the `raw` / `outcome` member of the `llm_validate` input.
fn output_sources(outputs: &Value) -> BTreeMap<(String, String), (&'static str, Value)> {
    let mut map = BTreeMap::new();
    for entry in list(&outputs["cards"], "outputs.cards") {
        let id = text(&entry["card"], "outputs card").to_owned();
        for o in list(&entry["outputs"], "outputs.outputs") {
            let label = text(&o["label"], "output label").to_owned();
            let source = match (o.get("raw"), o.get("outcome")) {
                (Some(r), None) => ("raw", r.clone()),
                (None, Some(oc)) => ("outcome", oc.clone()),
                _ => panic!("card {id}: output {label} needs exactly one of raw/outcome"),
            };
            map.insert((id.clone(), label), source);
        }
    }
    map
}

#[wasm_bindgen_test(unsupported = test)]
fn grading_exports_match_golden_bytes() {
    let golden = parse(GOLDEN, "dev-golden.json");
    let outputs = parse(OUTPUTS, "dev-outputs.json");
    let lines = card_lines();
    let sources = output_sources(&outputs);
    let templates = &golden["templates"];
    let schema_text = &golden["schema_text"];

    let cards = list(&golden["cards"], "golden.cards");
    assert_eq!(cards.len(), lines.len(), "golden and dev.jsonl card counts");

    // (card id, output label) -> verdict, for the contrast checks below.
    let mut verdicts: BTreeMap<(String, String), Value> = BTreeMap::new();
    let mut checks = 0usize;

    for entry in cards {
        let id = text(&entry["card"], "golden card");
        let Some(line) = lines.get(id) else {
            panic!("card {id}: in the golden file but not in dev.jsonl");
        };

        let parsed_text = llm_parse_card(line);
        check(id, "llm_parse_card", "", &parsed_text, &entry["parse_card"]);
        let parsed = parse(&parsed_text, "llm_parse_card");
        let ctx = &parsed["frozen_context"];

        let perm_input = compact(&json!({"frozen_context": ctx}));
        check(
            id,
            "llm_permutations",
            "",
            &llm_permutations(&perm_input),
            &entry["permutations"],
        );

        let is_decision = parse(line, "card line")["task"] == "decision";
        let (template, schema) = if is_decision {
            (&templates["decision"], &Value::Null)
        } else {
            (&templates["synthesis"], schema_text)
        };
        for r in list(&entry["render_prompt"], "render_prompt") {
            let input = compact(&json!({"frozen_context": ctx, "template": template,
                "schema_text": schema, "permutation": r["permutation"]}));
            let detail = format!("permutation {}", r["permutation"]);
            check(
                id,
                "llm_render_prompt",
                &detail,
                &llm_render_prompt(&input),
                &r["result"],
            );
            checks += 1;
        }

        for o in list(&entry["outputs"], "golden outputs") {
            let label = text(&o["output"], "output label");
            let Some((key, value)) = sources.get(&(id.to_owned(), label.to_owned())) else {
                panic!("card {id}: golden output {label} missing from dev-outputs.json");
            };
            let mut vin = Map::new();
            vin.insert("frozen_context".to_owned(), ctx.clone());
            vin.insert((*key).to_owned(), value.clone());
            let validated = llm_validate(&compact(&Value::Object(vin)));
            check(id, "llm_validate", label, &validated, &o["validate"]);

            let verdict = parse(&validated, "llm_validate")["verdict"].clone();
            let gin = compact(&json!({"card": line, "verdict": verdict}));
            check(id, "llm_grade", label, &llm_grade(&gin), &o["grade"]);
            check(
                id,
                "llm_identity",
                label,
                &llm_identity(&gin),
                &o["identity"],
            );
            verdicts.insert((id.to_owned(), label.to_owned()), verdict);
            checks += 3;
        }
    }

    for c in list(&golden["contrast"], "golden.contrast") {
        let (a, b) = (text(&c["card_a"], "card_a"), text(&c["card_b"], "card_b"));
        let (oa, ob) = (
            text(&c["output_a"], "output_a"),
            text(&c["output_b"], "output_b"),
        );
        let (Some(la), Some(lb)) = (lines.get(a), lines.get(b)) else {
            panic!("contrast {a}/{b}: card missing from dev.jsonl");
        };
        let (Some(va), Some(vb)) = (
            verdicts.get(&(a.to_owned(), oa.to_owned())),
            verdicts.get(&(b.to_owned(), ob.to_owned())),
        ) else {
            panic!("contrast {a}/{b}: verdict missing for {oa} / {ob}");
        };
        let input = compact(&json!({"card_a": la, "verdict_a": va,
            "card_b": lb, "verdict_b": vb}));
        let card = format!("{a} + {b}");
        check(
            &card,
            "llm_contrast",
            &format!("{oa} / {ob}"),
            &llm_contrast(&input),
            &c["result"],
        );
        checks += 1;
    }
    assert!(checks > 0, "no golden entries were checked");
}
