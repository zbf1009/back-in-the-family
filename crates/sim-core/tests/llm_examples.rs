//! Example tests for the `sim_core::llm` module (llm-probe spec).

use sim_core::llm::IllegalReason;
use sim_core::llm::json::{self, Json, MAX_INPUT_BYTES};

fn detail(input: &str) -> (IllegalReason, &'static str) {
    let e = json::parse(input).expect_err("must be rejected");
    (e.reason, e.detail)
}

#[test]
fn json_one_mib_input_is_accepted_and_one_more_byte_is_too_large() {
    // `"` + payload + `"` is exactly MAX_INPUT_BYTES bytes.
    let ok = format!("\"{}\"", "a".repeat(MAX_INPUT_BYTES - 2));
    assert_eq!(ok.len(), MAX_INPUT_BYTES);
    assert!(json::parse(&ok).is_ok());
    let big = format!("\"{}\"", "a".repeat(MAX_INPUT_BYTES - 1));
    assert_eq!(detail(&big), (IllegalReason::ParseFailure, "too_large"));
}

#[test]
fn json_ten_thousand_open_brackets_are_too_deep_without_recursion() {
    let input = "[".repeat(10_000);
    assert_eq!(detail(&input), (IllegalReason::ParseFailure, "too_deep"));
}

#[test]
fn json_depth_64_is_accepted_and_65_is_not() {
    let ok = format!("{}{}", "[".repeat(64), "]".repeat(64));
    assert!(json::parse(&ok).is_ok());
    let deep = format!("{}{}", "[".repeat(65), "]".repeat(65));
    assert_eq!(detail(&deep), (IllegalReason::ParseFailure, "too_deep"));
}

#[test]
fn json_duplicate_key_is_a_parse_failure() {
    assert_eq!(
        detail(r#"{"a":1,"a":2}"#),
        (IllegalReason::ParseFailure, "duplicate_key")
    );
    assert_eq!(
        detail(r#"{"x":{"a":1,"b":2,"a":3}}"#),
        (IllegalReason::ParseFailure, "duplicate_key")
    );
}

#[test]
fn json_integer_lexemes() {
    let lexeme = |s: &str| match json::parse(s) {
        Ok(Json::Number(n)) => n,
        other => panic!("not a number: {other:?}"),
    };
    assert_eq!(
        json::integer_value(&lexeme("1.0")),
        Err(IllegalReason::NonInteger)
    );
    assert_eq!(
        json::integer_value(&lexeme("1e2")),
        Err(IllegalReason::NonInteger)
    );
    assert_eq!(
        json::integer_value(&lexeme("99999999999999999999")),
        Err(IllegalReason::IntegerOutOfRange)
    );
    assert_eq!(
        json::integer_value(&lexeme("-9223372036854775808")),
        Ok(i64::MIN)
    );
    assert_eq!(
        json::integer_value(&lexeme("9223372036854775807")),
        Ok(i64::MAX)
    );
    assert_eq!(
        json::integer_value(&lexeme("9223372036854775808")),
        Err(IllegalReason::IntegerOutOfRange)
    );
}

#[test]
fn json_rejects_non_strict_syntax() {
    for bad in [
        "",
        "01",
        "-",
        "+1",
        "1.",
        ".5",
        "1e",
        "[1,]",
        "{\"a\":1,}",
        "[1 2]",
        "{a:1}",
        "'a'",
        "nul",
        "[1] x",
        "\"a\nb\"",
        "\"\\x\"",
        "\"\\ud800\"",
        "\"\\udc00\"",
        "[",
        "{\"a\"}",
    ] {
        assert_eq!(detail(bad).0, IllegalReason::ParseFailure, "{bad:?}");
    }
}

#[test]
fn json_writer_is_canonical() {
    let input = " { \"b\" : [ 1 , -0 , 2.50 ] , \"a\" : \"x\\u0041\\/\\n\\u0001é\" , \"c\":{} , \"d\":[] , \"e\":null , \"f\":true } ";
    let v = json::parse(input).expect("valid");
    assert_eq!(
        json::write(&v),
        "{\"a\":\"xA/\\n\\u0001é\",\"b\":[1,0,2.50],\"c\":{},\"d\":[],\"e\":null,\"f\":true}"
    );
    // Writing is a fixed point of parse.
    let text = json::write(&v);
    assert_eq!(json::write(&json::parse(&text).expect("valid")), text);
}

#[test]
fn json_surrogate_pair_decodes() {
    assert_eq!(
        json::parse("\"\\ud83d\\ude00\""),
        Ok(Json::Str("\u{1f600}".to_owned()))
    );
}

// ---- Card parser (task 1.3) ----

mod card_parser {
    use sim_core::llm::card::{CardErrorKind, ExpectedSide, Split, parse_card};
    use sim_core::llm::{AnswerKey, Task};

    const DEV: &str = include_str!("../../../eval/cards/cards/dev.jsonl");

    fn dev_lines() -> Vec<&'static str> {
        DEV.lines().filter(|l| !l.trim().is_empty()).collect()
    }

    /// Replaces the first occurrence of `from` in the first Dev_Card of `task`.
    fn mutate(task: &str, from: &str, to: &str) -> String {
        let line = dev_lines()
            .into_iter()
            .find(|l| l.contains(&format!("\"task\":\"{task}\"")) && l.contains(from))
            .expect("a dev card containing the fragment");
        line.replacen(from, to, 1)
    }

    #[test]
    fn every_dev_card_parses() {
        let lines = dev_lines();
        assert_eq!(lines.len(), 34);
        let mut contrasts = 0;
        for (i, line) in lines.iter().enumerate() {
            let (meta, ctx, key, contrast) =
                parse_card(line, i + 1).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(meta.split, Split::Dev);
            assert!(!meta.author_note.is_empty());
            match (ctx.task, &key) {
                (Task::Decision, AnswerKey::Decision { .. })
                | (Task::Synthesis, AnswerKey::Synthesis { .. }) => {}
                other => panic!("task and key disagree: {other:?}"),
            }
            if let Some(c) = contrast {
                contrasts += 1;
                let sides_match = matches!(
                    (&c.expected_a, ctx.task),
                    (ExpectedSide::Options(_), Task::Decision)
                        | (ExpectedSide::Patterns { .. }, Task::Synthesis)
                );
                assert!(sides_match);
            }
        }
        assert!(contrasts > 0);
    }

    #[test]
    fn non_integer_number_is_a_parse_failure_naming_the_line() {
        let bad = mutate("decision", "\"tick\":", "\"tick\":1.5,\"x\":");
        let e = parse_card(&bad, 17).expect_err("rejected");
        assert_eq!(e.kind, CardErrorKind::ParseFailure);
        assert_eq!(e.line, 17);
        assert!(e.to_string().starts_with("line 17:"), "{e}");
        let exp = mutate("decision", "\"wealth\":0", "\"wealth\":1e2");
        assert_eq!(
            parse_card(&exp, 3).expect_err("rejected").kind,
            CardErrorKind::ParseFailure
        );
    }

    #[test]
    fn unknown_severe_condition_is_an_answer_key_error() {
        let bad = mutate(
            "synthesis",
            "\"invented_event_id\"",
            "\"made_up_condition\"",
        );
        let e = parse_card(&bad, 1).expect_err("rejected");
        assert_eq!(e.kind, CardErrorKind::AnswerKey);
        assert_eq!(e.detail, "unknown_severe_condition");
    }

    #[test]
    fn pattern_field_outside_the_family_schema_is_an_answer_key_error() {
        let bad = mutate(
            "synthesis",
            "\"must_not_include\":[{",
            "\"must_not_include\":[{\"debtor\":9,",
        );
        let e = parse_card(&bad, 1).expect_err("rejected");
        assert_eq!(e.kind, CardErrorKind::AnswerKey);
        assert_eq!(e.detail, "unknown_pattern_field");
    }

    #[test]
    fn decision_option_count_and_uniqueness_are_checked() {
        let dup = mutate(
            "decision",
            "\"id\":\"heed_warning\"",
            "\"id\":\"burn_offering\"",
        );
        let e = parse_card(&dup, 1).expect_err("rejected");
        assert_eq!(
            (e.kind, e.detail.as_str()),
            (CardErrorKind::Context, "duplicate_option_id")
        );
    }

    #[test]
    fn events_must_be_sorted_by_tick() {
        let bad = mutate("synthesis", "\"tick\":16990", "\"tick\":17999");
        let e = parse_card(&bad, 1).expect_err("rejected");
        assert_eq!(e.detail, "events_not_sorted_by_tick");
    }

    #[test]
    fn missing_unknown_and_mixed_fields_are_rejected() {
        let unknown = mutate("decision", "\"scored\":true", "\"scored\":true,\"extra\":1");
        assert_eq!(
            parse_card(&unknown, 1).expect_err("r").detail,
            "unknown_field"
        );
        let mixed = mutate("decision", "\"scored\":true", "\"scored\":true,\"gold\":{}");
        assert_eq!(
            parse_card(&mixed, 1).expect_err("r").kind,
            CardErrorKind::AnswerKey
        );
        assert_eq!(parse_card("{}", 1).expect_err("r").detail, "missing_field");
        assert_eq!(parse_card("not json", 9).expect_err("r").line, 9);
    }
}
