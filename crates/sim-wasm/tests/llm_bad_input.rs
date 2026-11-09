//! Feature: llm-probe, Property 15: Exports survive bad input.
//!
//! **Validates: Requirements 6.7.**
//!
//! For any string passed to any `llm_*` export the export returns a JSON envelope (`ok:false`
//! with a known `kind`, or a normal `ok:true` result) without panicking or trapping, and
//! after any sequence of such calls in one loaded module a golden input still returns the
//! golden output bytes.
//!
//! This is a property test driven by a fixed-seed generator (SplitMix64) instead of
//! `proptest`: the same loop then runs unchanged natively and on wasm32 under
//! `wasm-bindgen-test-runner`, without proptest's std-only machinery (files, threads,
//! OS randomness) on `wasm32-unknown-unknown`. Every case is reproducible from its index.

use serde_json::{Value, json};
use sim_wasm::llm::{
    llm_aggregate_perm_avg, llm_contrast, llm_grade, llm_identity, llm_parse_card,
    llm_permutations, llm_render_prompt, llm_render_system_one, llm_validate,
};
use wasm_bindgen_test::wasm_bindgen_test;

const DEV: &str = include_str!("../../../eval/cards/cards/dev.jsonl");
const CASES: u64 = 256;
const KINDS: [&str; 4] = ["input", "card", "answer_key", "render"];

type Export = fn(&str) -> String;
const EXPORTS: [(&str, Export); 10] = [
    ("llm_parse_card", llm_parse_card),
    ("llm_permutations", llm_permutations),
    ("llm_render_prompt", llm_render_prompt),
    ("llm_validate", llm_validate),
    ("llm_validate (raw_choice)", llm_validate),
    ("llm_render_system_one", llm_render_system_one),
    ("llm_grade", llm_grade),
    ("llm_identity", llm_identity),
    ("llm_contrast", llm_contrast),
    ("llm_aggregate_perm_avg", llm_aggregate_perm_avg),
];

fn card(id: &str) -> &'static str {
    DEV.lines()
        .find(|l| l.contains(&format!("\"id\":\"{id}\"")))
        .unwrap_or_else(|| panic!("no dev card {id}"))
}

/// A known-good input per export, in `EXPORTS` order.
fn golden_inputs() -> Vec<String> {
    const D1: &str = "D-dream_interpretation-001";
    const D2: &str = "D-dream_interpretation-002";
    let parsed: Value = serde_json::from_str(&llm_parse_card(card(D1))).expect("parse_card JSON");
    let ctx = parsed["frozen_context"].clone();
    let verdict = json!({"kind": "decision", "option": "heed_warning"});
    let mapping =
        "[instructions]\nRead the facts.\n[state]\nDay {{tick}}.\n{{people}}\n{{events}}\n";
    let template = "[system]\nDay {{tick}}.\n[user]\n{{situation}}\n{{people}}\n{{relations}}\n{{events}}\n{{options}}\n";
    vec![
        card(D1).to_owned(),
        json!({"frozen_context": ctx}).to_string(),
        json!({"frozen_context": ctx, "template": template, "schema_text": null,
               "permutation": "reversed"})
        .to_string(),
        json!({"frozen_context": ctx, "raw": "{\"option\":\"heed_warning\"}"}).to_string(),
        json!({"frozen_context": ctx, "raw": "heed_warning", "mode": "raw_choice"}).to_string(),
        json!({"frozen_context": ctx, "mapping": mapping, "permutation": "reversed"}).to_string(),
        json!({"card": card(D1), "verdict": verdict}).to_string(),
        json!({"card": card(D1), "verdict": verdict}).to_string(),
        json!({"card_a": card(D1), "verdict_a": verdict,
               "card_b": card(D2), "verdict_b": verdict})
        .to_string(),
        json!({"frozen_context": ctx, "scope": "sanity", "question_id": "decision",
               "calls": [{"permutation": "base", "status": "ok", "response_text":
                   "{\"result\":{\"answers\":{\"decision\":{\"choice\":\"heed_warning\",\"probabilities\":{\"heed_warning\":0.6,\"burn_offering\":0.2,\"dismiss_dream\":0.1,\"read_as_blessing\":0.1}}}}}"}]})
        .to_string(),
    ]
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

const TOKENS: [&str; 24] = [
    "{",
    "}",
    "[",
    "]",
    ":",
    ",",
    "null",
    "true",
    "false",
    "0",
    "-1",
    "1e999",
    "18446744073709551616",
    "\"frozen_context\"",
    "\"card\"",
    "\"verdict\"",
    "\"raw\"",
    "\"outcome\"",
    "\"template\"",
    "\"permutation\"",
    "\"option\"",
    "\"kind\"",
    "\"\\u0000\"",
    "\"\\ud800\"",
];
const UNICODE: [char; 10] = [
    'é',
    'ß',
    '漢',
    '🙂',
    '\u{0}',
    '\u{7f}',
    '\u{200b}',
    '\u{feff}',
    '\u{10ffff}',
    '\u{202e}',
];
const KEYS: [&str; 14] = [
    "mapping",
    "mode",
    "frozen_context",
    "card",
    "verdict",
    "raw",
    "outcome",
    "template",
    "permutation",
    "card_a",
    "card_b",
    "verdict_a",
    "verdict_b",
    "schema_text",
];

/// One bad input; `golden` is the export's known-good input, used for mutations.
fn bad_input(i: u64, rng: &mut Rng, golden: &str) -> String {
    match i % 9 {
        // Random Unicode text, not JSON.
        0 => (0..rng.below(200))
            .map(|_| match rng.below(3) {
                0 => UNICODE[rng.below(UNICODE.len())],
                1 => char::from(32 + rng.below(95) as u8),
                _ => char::from_u32(rng.below(0xD7FF) as u32).unwrap_or('?'),
            })
            .collect(),
        // Soup of JSON tokens.
        1 => (0..rng.below(40))
            .map(|_| TOKENS[rng.below(TOKENS.len())])
            .collect(),
        // The golden input cut off at a character boundary.
        2 => {
            let mut cut = rng.below(golden.len().max(1));
            while !golden.is_char_boundary(cut) {
                cut -= 1;
            }
            golden[..cut].to_owned()
        }
        // The golden input with one character replaced.
        3 => {
            let chars: Vec<char> = golden.chars().collect();
            let at = rng.below(chars.len().max(1));
            chars
                .iter()
                .enumerate()
                .map(|(n, c)| {
                    if n == at {
                        UNICODE[rng.below(UNICODE.len())]
                    } else {
                        *c
                    }
                })
                .collect()
        }
        // Right keys, wrong value shapes.
        4 => {
            let mut obj = serde_json::Map::new();
            for _ in 0..1 + rng.below(6) {
                let value = match rng.below(6) {
                    0 => Value::Null,
                    1 => json!(rng.next()),
                    2 => json!([]),
                    3 => json!({}),
                    4 => json!("x"),
                    _ => json!([[], {"kind": 5}]),
                };
                obj.insert(KEYS[rng.below(KEYS.len())].to_owned(), value);
            }
            Value::Object(obj).to_string()
        }
        // Deep nesting (arrays, objects, or strings in arrays).
        5 => {
            let depth = 1 + rng.below(20_000);
            match rng.below(3) {
                0 => "[".repeat(depth),
                1 => format!("{}{}", "{\"a\":".repeat(depth), "1"),
                _ => format!("{}1{}", "[".repeat(depth), "]".repeat(depth)),
            }
        }
        // Huge inputs (kept few so the wasm run stays quick).
        6 => {
            if i % 64 == 6 {
                format!("\"{}\"", "a".repeat(2_000_000))
            } else {
                format!("[{}]", "0,".repeat(50_000))
            }
        }
        // Valid card text under every key, but in the wrong place, with unicode strings.
        7 => json!({
            "frozen_context": card("D-dream_interpretation-001"),
            "card": {"id": "🙂", "kind": UNICODE.iter().collect::<String>()},
            "verdict": "heed_warning",
            "raw": UNICODE.iter().collect::<String>(),
            "permutation": "漢字",
        })
        .to_string(),
        // Empty or whitespace only.
        _ => " \t\r\n".repeat(rng.below(4)),
    }
}

/// The export returned a JSON envelope: `ok:true`, or `ok:false` with a known error kind.
fn check_envelope(name: &str, out: &str) {
    let v: Value = serde_json::from_str(out)
        .unwrap_or_else(|e| panic!("{name}: result is not JSON ({e}): {:.200}", out));
    match v["ok"].as_bool() {
        Some(true) => {}
        Some(false) => {
            let kind = v["error"]["kind"].as_str().unwrap_or_default();
            assert!(
                KINDS.contains(&kind),
                "{name}: unknown error kind in {out:.200}"
            );
            assert!(
                v["error"]["message"].is_string(),
                "{name}: no message in {out:.200}"
            );
        }
        None => panic!("{name}: no boolean `ok` in {out:.200}"),
    }
}

#[wasm_bindgen_test(unsupported = test)]
fn exports_survive_bad_input_and_still_return_golden_output() {
    let goldens = golden_inputs();
    let expected: Vec<String> = EXPORTS
        .iter()
        .zip(&goldens)
        .map(|((name, f), input)| {
            let out = f(input);
            let v: Value = serde_json::from_str(&out).expect("golden output is JSON");
            assert_eq!(v["ok"], json!(true), "{name} golden: {out}");
            out
        })
        .collect();

    let mut rng = Rng(0x1156_0F15);
    for case in 0..CASES {
        for (k, (name, f)) in EXPORTS.iter().enumerate() {
            let input = bad_input(case + k as u64, &mut rng, &goldens[k]);
            let out = f(&input);
            check_envelope(name, &out);
            // A later call on the same module still returns the golden bytes.
            assert_eq!(f(&goldens[k]), expected[k], "{name} after case {case}");
        }
    }
    for (k, (name, f)) in EXPORTS.iter().enumerate() {
        assert_eq!(f(&goldens[k]), expected[k], "{name} at the end");
    }
}

/// Every export on a fixed list of awkward inputs, the same shapes as the sim-core example
/// test, so a failure here names the input directly.
#[wasm_bindgen_test(unsupported = test)]
fn exports_reject_obviously_bad_input_with_an_envelope() {
    let deep = "[".repeat(10_000);
    let inputs = [
        "",
        " ",
        "null",
        "[]",
        "42",
        "\"x\"",
        "{",
        "{}",
        "{\"frozen_context\":1}",
        &deep,
    ];
    for input in inputs {
        for (name, f) in EXPORTS {
            let out = f(input);
            check_envelope(name, &out);
            let v: Value = serde_json::from_str(&out).expect("JSON");
            assert_eq!(v["ok"], json!(false), "{name} on {:.30}", input);
        }
    }
}
