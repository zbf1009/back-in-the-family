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

mod answer_examples {
    use sim_core::llm::answer;
    use sim_core::llm::json::Json;
    use sim_core::llm::{
        DebtItem, DebtStatus, Direction, EventId, GrudgeItem, IllegalReason, Level, ShiftItem,
        SynthesisAnswer,
    };

    const OBJ: &str = r#"{"option":"a"}"#;

    fn ok(raw: &str) -> Json {
        answer::parse_answer(raw).expect("accepted")
    }

    fn rejected(raw: &str) -> (IllegalReason, &'static str) {
        let e = answer::parse_answer(raw).expect_err("rejected");
        (e.reason, e.detail)
    }

    fn eid(s: &str) -> EventId {
        EventId::new(s).expect("valid event id")
    }

    #[test]
    fn unfenced_and_whitespace_padded_json_is_accepted() {
        let expected = ok(OBJ);
        assert_eq!(ok(&format!(" \n\t{OBJ}\r\n ")), expected);
    }

    #[test]
    fn one_fence_with_or_without_json_tag_is_accepted() {
        let expected = ok(OBJ);
        assert_eq!(ok(&format!("```\n{OBJ}\n```")), expected);
        assert_eq!(ok(&format!("```json\n{OBJ}\n```")), expected);
        assert_eq!(ok(&format!("  ```json \r\n  {OBJ}  \n```  \n")), expected);
    }

    #[test]
    fn double_fence_is_a_parse_failure() {
        let raw = format!("```\n```json\n{OBJ}\n```\n```");
        assert_eq!(rejected(&raw).0, IllegalReason::ParseFailure);
    }

    #[test]
    fn text_around_the_json_or_the_fence_is_a_parse_failure() {
        for raw in [
            format!("Sure! {OBJ}"),
            format!("{OBJ} Hope that helps."),
            format!("Here you go:\n```json\n{OBJ}\n```"),
            format!("```json\n{OBJ}\n```\nDone."),
            format!("```python\n{OBJ}\n```"),
            format!("```json {OBJ}```"),
            format!("```\n{OBJ}"),
        ] {
            assert_eq!(rejected(&raw).0, IllegalReason::ParseFailure, "{raw}");
        }
    }

    #[test]
    fn two_json_values_are_a_parse_failure() {
        assert_eq!(
            rejected(&format!("{OBJ}\n{OBJ}")).0,
            IllegalReason::ParseFailure
        );
        assert_eq!(
            rejected(&format!("```\n{OBJ}\n{OBJ}\n```")).0,
            IllegalReason::ParseFailure
        );
    }

    #[test]
    fn empty_and_whitespace_only_input_is_a_parse_failure() {
        for raw in ["", "   \n\t", "```", "```\n```", "```json\n\n```"] {
            assert_eq!(rejected(raw).0, IllegalReason::ParseFailure, "{raw:?}");
        }
    }

    #[test]
    fn grudge_answer_serializes_canonically_and_round_trips() {
        let a = SynthesisAnswer::Grudge(vec![GrudgeItem {
            from: 1,
            to: 2,
            level: Level::High,
            evidence: vec![eid("e3"), eid("e1")],
            reason: "said \"no\"".to_owned(),
        }]);
        let text = answer::canonical(&a);
        assert_eq!(
            text,
            r#"{"items":[{"evidence":["e3","e1"],"from":1,"level":"high","reason":"said \"no\"","to":2}],"schema":"grudge_v1"}"#
        );
        assert_eq!(ok(&text), answer::to_json(&a));
        assert_eq!(answer::canonical(&a), text);
    }

    #[test]
    fn optional_fields_serialize_as_null() {
        let d = SynthesisAnswer::DebtChain(vec![DebtItem {
            debtor: 2,
            creditor: 1,
            amount: 0,
            status: DebtStatus::Transferred,
            origin_event: eid("e1"),
            transferred_from: None,
            evidence: vec![eid("e1")],
            reason: String::new(),
        }]);
        assert!(answer::canonical(&d).contains(r#""transferred_from":null"#));
        let s = SynthesisAnswer::RelationshipShift(vec![ShiftItem {
            a: 1,
            b: 2,
            direction: Direction::Unchanged,
            turning_point: None,
            evidence: vec![eid("e2")],
            reason: String::new(),
        }]);
        assert!(answer::canonical(&s).contains(r#""turning_point":null"#));
        assert!(answer::canonical(&s).ends_with(r#""schema":"relationship_shift_v1"}"#));
    }
}

// ---- Output_Validator (task 2.2) ----

mod validator {
    use sim_core::llm::validate::{Outcome, validate, validate_raw};
    use sim_core::llm::{
        Event, EventId, Family, FrozenContext, IllegalReason, OptionDef, OptionId, OutputSchema,
        Person, PersonId, Task, TaskSpec, Traits, Verdict,
    };

    fn person(id: i64) -> Person {
        Person {
            id: PersonId(id),
            name: format!("P{id}"),
            age: 30,
            sex: "female".into(),
            alive: true,
            origin: "native".into(),
            traits: Traits {
                greed: 0,
                loyalty: 0,
                pride: 0,
                warmth: 0,
                temper: 0,
                vindictiveness: 0,
                piety: 0,
            },
            wealth: 0,
            soul_id: format!("s{id}"),
        }
    }

    fn event(id: &str, tick: i64) -> Event {
        Event {
            id: EventId::new(id).expect("id"),
            tick,
            kind: "k".into(),
            actors: vec![],
            magnitude: 1,
            due_tick: None,
            caused_by: vec![],
            tags: vec![],
        }
    }

    fn ctx(task: Task, spec: TaskSpec) -> FrozenContext {
        FrozenContext {
            task,
            family: Family::Sanity,
            tick: 10,
            subject: None,
            people: vec![person(1), person(2)],
            relations: vec![],
            events: vec![event("e1", 1), event("e2", 2)],
            situation: String::new(),
            player_input: None,
            spec,
        }
    }

    fn d() -> FrozenContext {
        let opt = |id: &str| OptionDef {
            id: OptionId::new(id).expect("id"),
            label: id.into(),
        };
        ctx(
            Task::Decision,
            TaskSpec::Decision {
                options: vec![opt("alpha"), opt("beta")],
            },
        )
    }

    fn s(schema: OutputSchema) -> FrozenContext {
        ctx(Task::Synthesis, TaskSpec::Synthesis { schema })
    }

    fn illegal(v: &Verdict) -> (IllegalReason, Option<&str>) {
        match v {
            Verdict::Illegal { reason, path } => (*reason, path.as_deref()),
            other => panic!("expected Illegal, got {other:?}"),
        }
    }

    fn grudge(item: &str) -> String {
        format!(r#"{{"schema":"grudge_v1","items":[{item}]}}"#)
    }

    const G_OK: &str = r#"{"from":1,"to":2,"level":"high","evidence":["e1"],"reason":"x"}"#;

    fn g_with(from: &str, to: &str) -> String {
        G_OK.replacen("\"from\":1", from, 1)
            .replacen("\"to\":2", to, 1)
    }

    #[test]
    fn decision_accepts_one_member_object_in_set() {
        let v = validate_raw(&d(), r#"{"option":"beta"}"#);
        assert!(matches!(v, Verdict::Decision { ref option } if option.as_str() == "beta"));
        let v = validate_raw(&d(), "```json\n{\"option\":\"alpha\"}\n```");
        assert!(matches!(v, Verdict::Decision { .. }));
    }

    #[test]
    fn decision_schema_is_checked_before_membership() {
        let c = d();
        assert_eq!(
            illegal(&validate_raw(&c, "[]")),
            (IllegalReason::WrongType, Some("$"))
        );
        assert_eq!(
            illegal(&validate_raw(&c, "{}")),
            (IllegalReason::MissingRequiredField, Some("option"))
        );
        assert_eq!(
            illegal(&validate_raw(&c, r#"{"option":"alpha","why":"x"}"#)),
            (IllegalReason::UnknownField, Some("why"))
        );
        assert_eq!(
            illegal(&validate_raw(&c, r#"{"option":3}"#)),
            (IllegalReason::WrongType, Some("option"))
        );
        assert_eq!(
            illegal(&validate_raw(&c, r#"{"option":"Alpha"}"#)),
            (IllegalReason::OutOfSetOption, Some("option"))
        );
    }

    #[test]
    fn parse_failures_have_no_path() {
        for raw in ["", "   ", "{\"option\":", r#"{"option":"a","option":"b"}"#] {
            assert_eq!(
                illegal(&validate_raw(&d(), raw)),
                (IllegalReason::ParseFailure, None),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn non_text_outcomes_map_to_illegal_reasons() {
        let c = d();
        assert_eq!(
            illegal(&validate(&c, Outcome::Timeout)),
            (IllegalReason::Timeout, None)
        );
        let err = |code, detail| validate(&c, Outcome::Error { code, detail });
        assert_eq!(
            illegal(&err("remote_error", "x")),
            (IllegalReason::RuntimeError, None)
        );
        assert_eq!(
            illegal(&err("parse_failure", "non_text_response")),
            (IllegalReason::ParseFailure, None)
        );
    }

    #[test]
    fn synthesis_legal_answer_lists_missing_references_sorted() {
        let c = s(OutputSchema::GrudgeV1);
        let item = G_OK
            .replace("\"from\":1", "\"from\":9")
            .replace("\"to\":2", "\"to\":7")
            .replace("[\"e1\"]", "[\"e5\",\"e1\",\"e3\"]");
        let two = format!("{item},{}", item.replace("\"to\":7", "\"to\":4"));
        match validate_raw(&c, &grudge(&two)) {
            Verdict::Synthesis {
                missing_persons,
                missing_events,
                ..
            } => {
                assert_eq!(missing_persons, vec![4, 7, 9]);
                assert_eq!(missing_events, vec!["e3".to_owned(), "e5".to_owned()]);
            }
            other => panic!("{other:?}"),
        }
        match validate_raw(&c, &grudge(G_OK)) {
            Verdict::Synthesis {
                missing_persons,
                missing_events,
                ..
            } => assert!(missing_persons.is_empty() && missing_events.is_empty()),
            other => panic!("{other:?}"),
        }
    }

    fn check(c: &FrozenContext, raw: &str, want: (IllegalReason, &str)) {
        assert_eq!(
            illegal(&validate_raw(c, raw)),
            (want.0, Some(want.1)),
            "{raw}"
        );
    }

    #[test]
    fn synthesis_reason_codes_and_paths() {
        let c = s(OutputSchema::GrudgeV1);
        check(&c, "[]", (IllegalReason::WrongType, "$"));
        check(
            &c,
            r#"{"schema":"grudge_v1"}"#,
            (IllegalReason::MissingRequiredField, "items"),
        );
        check(
            &c,
            r#"{"schema":"grudge_v1","items":[],"x":1}"#,
            (IllegalReason::UnknownField, "x"),
        );
        check(
            &c,
            r#"{"schema":"debt_chain_v1","items":[]}"#,
            (IllegalReason::WrongSchemaConst, "schema"),
        );
        check(
            &c,
            r#"{"schema":3,"items":[]}"#,
            (IllegalReason::WrongType, "schema"),
        );
        check(
            &c,
            r#"{"schema":"grudge_v1","items":{}}"#,
            (IllegalReason::WrongType, "items"),
        );
        check(&c, &grudge("3"), (IllegalReason::WrongType, "items[0]"));
        check(
            &c,
            &grudge(&G_OK.replace(",\"reason\":\"x\"", "")),
            (IllegalReason::MissingRequiredField, "items[0].reason"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("\"reason\":\"x\"", "\"reason\":\"x\",\"z\":1")),
            (IllegalReason::UnknownField, "items[0].z"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("\"high\"", "\"huge\"")),
            (IllegalReason::IllegalEnumValue, "items[0].level"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("\"high\"", "1")),
            (IllegalReason::WrongType, "items[0].level"),
        );
        check(
            &c,
            &grudge(&g_with("\"from\":\"1\"", "\"to\":2")),
            (IllegalReason::WrongType, "items[0].from"),
        );
        check(
            &c,
            &grudge(&g_with("\"from\":1.0", "\"to\":2")),
            (IllegalReason::NonInteger, "items[0].from"),
        );
        check(
            &c,
            &grudge(&g_with("\"from\":1", "\"to\":1e2")),
            (IllegalReason::NonInteger, "items[0].to"),
        );
        check(
            &c,
            &grudge(&g_with("\"from\":99999999999999999999", "\"to\":2")),
            (IllegalReason::IntegerOutOfRange, "items[0].from"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("[\"e1\"]", "[]")),
            (IllegalReason::EmptyEvidence, "items[0].evidence"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("[\"e1\"]", "[\"e1\",\"e2\",\"e1\"]")),
            (IllegalReason::DuplicateEvidence, "items[0].evidence[2]"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("[\"e1\"]", "[\"e1\",\"e12345\"]")),
            (IllegalReason::MalformedEventId, "items[0].evidence[1]"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("[\"e1\"]", "[\"e1\",7]")),
            (IllegalReason::WrongType, "items[0].evidence[1]"),
        );
        check(
            &c,
            &grudge(&G_OK.replace("[\"e1\"]", "\"e1\"")),
            (IllegalReason::WrongType, "items[0].evidence"),
        );
    }

    #[test]
    fn debt_amount_below_minimum_and_event_fields() {
        let c = s(OutputSchema::DebtChainV1);
        let ok = r#"{"debtor":1,"creditor":2,"amount":5,"status":"open","origin_event":"e1","transferred_from":null,"evidence":["e1"],"reason":"r"}"#;
        let wrap = |i: &str| format!(r#"{{"schema":"debt_chain_v1","items":[{i}]}}"#);
        assert!(matches!(
            validate_raw(&c, &wrap(ok)),
            Verdict::Synthesis { .. }
        ));
        check(
            &c,
            &wrap(&ok.replace("\"amount\":5", "\"amount\":-1")),
            (IllegalReason::IntegerOutOfRange, "items[0].amount"),
        );
        check(
            &c,
            &wrap(&ok.replace("\"e1\",\"transferred", "\"E1\",\"transferred")),
            (IllegalReason::MalformedEventId, "items[0].origin_event"),
        );
        match validate_raw(&c, &wrap(&ok.replace("null", "8"))) {
            Verdict::Synthesis {
                missing_persons, ..
            } => assert_eq!(missing_persons, vec![8]),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn shift_turning_point_may_be_null_and_counts_as_event_when_set() {
        let c = s(OutputSchema::RelationshipShiftV1);
        let ok = r#"{"schema":"relationship_shift_v1","items":[{"a":1,"b":2,"direction":"warmer","turning_point":null,"evidence":["e1"],"reason":"r"}]}"#;
        assert!(matches!(validate_raw(&c, ok), Verdict::Synthesis { .. }));
        match validate_raw(&c, &ok.replace("null", "\"e9\"")) {
            Verdict::Synthesis { missing_events, .. } => {
                assert_eq!(missing_events, vec!["e9".to_owned()]);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn validator_is_total_on_huge_and_deep_input() {
        let c = d();
        let big = "x".repeat(2_000_000);
        assert_eq!(
            illegal(&validate_raw(&c, &big)),
            (IllegalReason::ParseFailure, None)
        );
        let deep = "[".repeat(10_000);
        assert_eq!(
            illegal(&validate_raw(&s(OutputSchema::GrudgeV1), &deep)),
            (IllegalReason::ParseFailure, None)
        );
    }
}

mod reason_codes {
    use sim_core::llm::IllegalReason;

    /// Compile-time exhaustiveness: adding a variant forces a new example test.
    /// Every variant is exercised in `validator` (see the per-variant list below).
    #[test]
    fn every_reason_code_has_an_example() {
        let all = [
            IllegalReason::ParseFailure,
            IllegalReason::OutOfSetOption,
            IllegalReason::MissingRequiredField,
            IllegalReason::UnknownField,
            IllegalReason::IllegalEnumValue,
            IllegalReason::NonInteger,
            IllegalReason::IntegerOutOfRange,
            IllegalReason::EmptyEvidence,
            IllegalReason::DuplicateEvidence,
            IllegalReason::MalformedEventId,
            IllegalReason::WrongType,
            IllegalReason::WrongSchemaConst,
            IllegalReason::Timeout,
            IllegalReason::RuntimeError,
        ];
        for r in all {
            // Exhaustive match: a new variant fails to compile here.
            match r {
                IllegalReason::ParseFailure
                | IllegalReason::OutOfSetOption
                | IllegalReason::MissingRequiredField
                | IllegalReason::UnknownField
                | IllegalReason::IllegalEnumValue
                | IllegalReason::NonInteger
                | IllegalReason::IntegerOutOfRange
                | IllegalReason::EmptyEvidence
                | IllegalReason::DuplicateEvidence
                | IllegalReason::MalformedEventId
                | IllegalReason::WrongType
                | IllegalReason::WrongSchemaConst
                | IllegalReason::Timeout
                | IllegalReason::RuntimeError => {}
            }
        }
    }
}

mod forbidden_literals {
    use std::fs;
    use std::path::{Path, PathBuf};

    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.filter_map(Result::ok).map(|e| e.path()).collect();
        entries.sort();
        for p in entries {
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push(p);
            }
        }
    }

    /// R3.13: answer-key field names and results schema prefixes never appear in
    /// llm or wasm sources. The literals are built at runtime so this file has none.
    #[test]
    fn no_answer_key_names_or_results_schema_prefix_in_sources() {
        let forbidden = [
            format!("\"{}_{}\"", "author", "note"),
            format!("\"{}_{}\"", "severe", "patterns"),
            format!("{}-{}-", "llm", "probe"),
        ];
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let dirs = [root.join("src/llm"), root.join("../sim-wasm/src")];
        let mut files = Vec::new();
        for d in &dirs {
            walk(d, &mut files);
        }
        assert!(
            files.iter().any(|f| f.ends_with("card.rs")),
            "scan must see the llm sources"
        );
        for f in files {
            let Ok(text) = fs::read_to_string(&f) else {
                continue;
            };
            for lit in &forbidden {
                assert!(
                    !text.contains(lit.as_str()),
                    "{} contains {lit}",
                    f.display()
                );
            }
        }
    }
}

// ---- README grading examples (task 3.7) ----
//
// Hand-built cards, one or more per grading rule of the Grading section of
// `eval/cards/README.md`. No card file is read. The answer-key member names are built
// at runtime so this file keeps the same habit as the source files.

mod readme_grading {
    use sim_core::llm::card::{CardErrorKind, ExpectedSide, parse_card};
    use sim_core::llm::grade::{GradeError, contrast, grade, identity};
    use sim_core::llm::validate::validate_raw;
    use sim_core::llm::{
        AnswerKey, FrozenContext, Grade, IdentityValue, OptionId, OutputSchema, Pattern,
        PatternValue, Scalar, SevereCondition, SynthesisAnswer, Verdict,
    };
    use std::collections::{BTreeMap, BTreeSet};

    const AUTHOR_NOTE: &str = concat!("author", "_note");
    const SEVERE_PATTERNS: &str = concat!("severe", "_patterns");

    const PEOPLE: &str = r#"[
        {"id":1,"name":"Ann One","age":40,"sex":"female","alive":true,"origin":"native","traits":{"greed":0,"loyalty":0,"pride":0,"warmth":0,"temper":0,"vindictiveness":0,"piety":0},"wealth":0,"soul_id":"S-0101"},
        {"id":2,"name":"Bob Two","age":42,"sex":"male","alive":true,"origin":"native","traits":{"greed":0,"loyalty":0,"pride":0,"warmth":0,"temper":0,"vindictiveness":0,"piety":0},"wealth":0,"soul_id":"S-0102"},
        {"id":3,"name":"Cy Three","age":80,"sex":"male","alive":false,"origin":"native","traits":{"greed":0,"loyalty":0,"pride":0,"warmth":0,"temper":0,"vindictiveness":0,"piety":0},"wealth":0,"soul_id":"S-0103"}]"#;

    const EVENTS: &str = r#"[
        {"id":"e1","tick":10,"type":"loan","actors":[2,1],"magnitude":50,"due_tick":90,"caused_by":[],"tags":[]},
        {"id":"e2","tick":20,"type":"gift","actors":[1,2],"magnitude":5,"caused_by":[],"tags":[]},
        {"id":"e3","tick":20,"type":"insult","actors":[2,1],"magnitude":5,"caused_by":[],"tags":[]},
        {"id":"e4","tick":30,"type":"death","actors":[3],"magnitude":0,"caused_by":[],"tags":[]}]"#;

    fn context(subject: &str) -> String {
        format!(
            r#"{{"tick":100,"subject":{subject},"people":{PEOPLE},"relations":[],"events":{EVENTS},"situation":"Hand built.","player_input":null}}"#
        )
    }

    /// A synthesis card line. `contrast` is either empty or `,"contrast":{...}`.
    #[allow(clippy::too_many_arguments)]
    fn s_line(
        id: &str,
        family: &str,
        schema: &str,
        include: &str,
        exclude: &str,
        conds: &str,
        severe_patterns: &str,
        contrast: &str,
    ) -> String {
        format!(
            r#"{{"id":"{id}","task":"synthesis","family":"{family}","scenario_group":"G001","split":"dev","scored":true,"context":{ctx}{contrast},"{AUTHOR_NOTE}":"hand built","output_schema":"{schema}","gold":{{"must_include":{include},"must_not_include":{exclude}}},"severe_conditions":{conds},"{SEVERE_PATTERNS}":{severe_patterns}}}"#,
            ctx = context("null"),
        )
    }

    fn grudge_card(include: &str, exclude: &str, conds: &str, sp: &str) -> String {
        s_line(
            "S-grudge_detection-001",
            "grudge_detection",
            "grudge_v1",
            include,
            exclude,
            conds,
            sp,
            "",
        )
    }

    fn d_line(id: &str, acceptable: &str, severe: &str, contrast: &str) -> String {
        format!(
            r#"{{"id":"{id}","task":"decision","family":"will_execution","scenario_group":"G001","split":"dev","scored":true,"context":{ctx}{contrast},"{AUTHOR_NOTE}":"hand built","options":[{{"id":"heed","label":"Heed"}},{{"id":"burn","label":"Burn"}},{{"id":"dismiss","label":"Dismiss"}},{{"id":"bless","label":"Bless"}}],"acceptable":{acceptable},"severe":{severe}}}"#,
            ctx = context("1"),
        )
    }

    fn parsed(
        line: &str,
    ) -> (
        String,
        FrozenContext,
        AnswerKey,
        Option<sim_core::llm::card::Contrast>,
    ) {
        let (meta, ctx, key, c) = parse_card(line, 1).unwrap_or_else(|e| panic!("{e}\n{line}"));
        (meta.id, ctx, key, c)
    }

    fn graded(line: &str, raw: &str) -> Grade {
        let (id, ctx, key, _) = parsed(line);
        grade(&id, &validate_raw(&ctx, raw), &key).expect("answer key is sound")
    }

    /// (acceptable, severe, illegal)
    fn flags(g: &Grade) -> (bool, bool, bool) {
        (g.acceptable, g.severe, g.illegal)
    }

    fn verdict(line: &str, raw: &str) -> Verdict {
        let (_, ctx, _, _) = parsed(line);
        validate_raw(&ctx, raw)
    }

    // ---- item and answer builders (JSON text) ----

    fn ids(list: &[&str]) -> String {
        let quoted: Vec<String> = list.iter().map(|e| format!("\"{e}\"")).collect();
        format!("[{}]", quoted.join(","))
    }

    fn grudge(from: i64, to: i64, level: &str, evidence: &[&str]) -> String {
        format!(
            r#"{{"from":{from},"to":{to},"level":"{level}","evidence":{},"reason":"r"}}"#,
            ids(evidence)
        )
    }

    fn debt(
        debtor: i64,
        creditor: i64,
        amount: i64,
        status: &str,
        origin: &str,
        evidence: &[&str],
    ) -> String {
        format!(
            r#"{{"debtor":{debtor},"creditor":{creditor},"amount":{amount},"status":"{status}","origin_event":"{origin}","transferred_from":null,"evidence":{},"reason":"r"}}"#,
            ids(evidence)
        )
    }

    fn promise(promisor: i64, promisee: i64, event: &str, status: &str) -> String {
        format!(
            r#"{{"promisor":{promisor},"promisee":{promisee},"promise_event":"{event}","status":"{status}","evidence":["e1"],"reason":"r"}}"#
        )
    }

    fn shift(a: i64, b: i64, direction: &str, turning: Option<&str>) -> String {
        let tp = turning.map_or("null".to_owned(), |t| format!("\"{t}\""));
        format!(
            r#"{{"a":{a},"b":{b},"direction":"{direction}","turning_point":{tp},"evidence":["e1"],"reason":"r"}}"#
        )
    }

    fn wrap(schema: &str, items: &[String]) -> String {
        format!(r#"{{"schema":"{schema}","items":[{}]}}"#, items.join(","))
    }

    fn g(items: &[String]) -> String {
        wrap("grudge_v1", items)
    }

    // ---- Decision cards ----

    #[test]
    fn decision_acceptable_severe_and_illegal() {
        let line = d_line(
            "D-will_execution-001",
            r#"["heed","burn"]"#,
            r#"["bless"]"#,
            "",
        );
        let pick = |o: &str| graded(&line, &format!(r#"{{"option":"{o}"}}"#));
        assert_eq!(flags(&pick("heed")), (true, false, false));
        assert_eq!(flags(&pick("burn")), (true, false, false));
        // Neither acceptable nor severe.
        assert_eq!(flags(&pick("dismiss")), (false, false, false));
        // Severe, and therefore not acceptable.
        assert_eq!(flags(&pick("bless")), (false, true, false));
        // Illegal: an ID that is not an option, or text that does not parse. Not
        // acceptable, not severe, reported as its own rate.
        for raw in [r#"{"option":"fly"}"#, "I would heed it.", ""] {
            let grade = graded(&line, raw);
            assert_eq!(flags(&grade), (false, false, true), "{raw:?}");
            assert!(grade.severe_conditions.is_empty());
        }
    }

    // ---- Synthesis cards: illegal, acceptable ----

    #[test]
    fn synthesis_illegal_output_is_never_severe() {
        // The card lists every automatic condition; severe checks run only on
        // schema-valid outputs, so a schema failure stays plain Illegal.
        let line = grudge_card(
            "[]",
            "[]",
            r#"["invented_event_id","invented_person","self_reference"]"#,
            "[]",
        );
        let bad_enum = g(&[grudge(9, 9, "huge", &["e99"])]);
        let wrong_schema = wrap("debt_chain_v1", &[]);
        for raw in [bad_enum.as_str(), wrong_schema.as_str(), "not json", "[]"] {
            let grade = graded(&line, raw);
            assert_eq!(flags(&grade), (false, false, true), "{raw}");
            assert!(grade.severe_conditions.is_empty());
        }
    }

    #[test]
    fn synthesis_acceptable_needs_every_include_and_no_exclude() {
        let line = grudge_card(
            r#"[{"from":1,"to":2,"level":["medium","high"],"evidence_any":["e1","e2"]}]"#,
            r#"[{"from":2,"to":1}]"#,
            "[]",
            "[]",
        );
        let good = grudge(1, 2, "high", &["e1", "e3"]);
        let ok = |items: &[String]| flags(&graded(&line, &g(items)));
        assert_eq!(ok(std::slice::from_ref(&good)), (true, false, false));
        // A list means "equal to one of these": `low` is not listed.
        assert_eq!(ok(&[grudge(1, 2, "low", &["e1"])]), (false, false, false));
        // `evidence_any` needs one listed ID in the item's evidence.
        assert_eq!(ok(&[grudge(1, 2, "high", &["e3"])]), (false, false, false));
        // Extra items are allowed...
        assert_eq!(
            ok(&[good.clone(), grudge(3, 1, "low", &["e4"])]),
            (true, false, false)
        );
        // ...unless one matches a must_not_include pattern.
        assert_eq!(
            ok(&[good.clone(), grudge(2, 1, "low", &["e3"])]),
            (false, false, false)
        );
        // An empty list is schema-valid and misses the include pattern.
        assert_eq!(ok(&[]), (false, false, false));
    }

    #[test]
    fn synthesis_every_include_pattern_must_be_matched() {
        let line = grudge_card(r#"[{"from":1,"to":2},{"from":3,"to":1}]"#, "[]", "[]", "[]");
        let a = grudge(1, 2, "low", &["e1"]);
        let b = grudge(3, 1, "low", &["e4"]);
        let acceptable = |items: &[String]| graded(&line, &g(items)).acceptable;
        assert!(!acceptable(std::slice::from_ref(&a)));
        assert!(!acceptable(std::slice::from_ref(&b)));
        assert!(acceptable(&[b, a]));
    }

    #[test]
    fn item_matching_no_pattern_is_neither_required_nor_harmful() {
        let line = grudge_card(
            r#"[{"from":1,"to":2}]"#,
            r#"[{"from":2,"to":1}]"#,
            "[]",
            "[]",
        );
        let stray = grudge(3, 2, "medium", &["e4"]);
        // Alone, the stray item satisfies no include pattern.
        assert_eq!(
            flags(&graded(&line, &g(std::slice::from_ref(&stray)))),
            (false, false, false)
        );
        // Next to a matching item it changes nothing.
        let both = g(&[stray, grudge(1, 2, "high", &["e1"])]);
        assert_eq!(flags(&graded(&line, &both)), (true, false, false));
    }

    #[test]
    fn relationship_shift_pattern_matches_only_with_a_and_b_swapped() {
        let line = s_line(
            "S-relationship_shift-001",
            "relationship_shift",
            "relationship_shift_v1",
            r#"[{"a":1,"b":2,"direction":["colder","reversed"],"turning_point":"e3"}]"#,
            r#"[{"a":1,"b":2,"direction":"warmer"}]"#,
            "[]",
            "[]",
            "",
        );
        let w = |items: &[String]| wrap("relationship_shift_v1", items);
        // As written.
        let direct = w(&[shift(1, 2, "colder", Some("e3"))]);
        assert!(graded(&line, &direct).acceptable);
        // Only the swapped orientation (a=2, b=1) matches the include pattern.
        let swapped = w(&[shift(2, 1, "colder", Some("e3"))]);
        assert!(graded(&line, &swapped).acceptable);
        // The exclude pattern is also tried swapped.
        let excluded = w(&[
            shift(1, 2, "reversed", Some("e3")),
            shift(2, 1, "warmer", None),
        ]);
        assert!(!graded(&line, &excluded).acceptable);
        // A different pair never matches, swapped or not.
        let other = w(&[shift(1, 3, "colder", Some("e3"))]);
        assert!(!graded(&line, &other).acceptable);
        // A swap does not repair a wrong direction or turning point.
        let wrong_dir = w(&[shift(2, 1, "unchanged", Some("e3"))]);
        assert!(!graded(&line, &wrong_dir).acceptable);
        let wrong_tp = w(&[shift(2, 1, "colder", Some("e2"))]);
        assert!(!graded(&line, &wrong_tp).acceptable);
    }

    // ---- Synthesis cards: severe ----

    #[test]
    fn automatic_severe_conditions_fire_only_when_listed() {
        let all = r#"["invented_event_id","invented_person","self_reference"]"#;
        let line = grudge_card("[]", "[]", all, "[]");
        let sev = |items: &[String]| graded(&line, &g(items)).severe_conditions;
        assert!(sev(&[grudge(1, 2, "low", &["e1"])]).is_empty());
        // Any event ID not in the card, in any item.
        assert_eq!(
            sev(&[grudge(1, 2, "low", &["e1", "e99"])]),
            vec![SevereCondition::InventedEventId]
        );
        // Any person ID not in the card.
        assert_eq!(
            sev(&[grudge(1, 9, "low", &["e1"])]),
            vec![SevereCondition::InventedPerson]
        );
        // An item whose two people are the same person.
        assert_eq!(
            sev(&[grudge(2, 2, "low", &["e1"])]),
            vec![SevereCondition::SelfReference]
        );
        // All three at once come out in the fixed condition order.
        assert_eq!(
            sev(&[grudge(9, 9, "low", &["e99"])]),
            vec![
                SevereCondition::InventedEventId,
                SevereCondition::InventedPerson,
                SevereCondition::SelfReference
            ]
        );
        // The same answer on a card that lists no condition is not severe.
        let quiet = grudge_card("[]", "[]", "[]", "[]");
        let grade = graded(&quiet, &g(&[grudge(9, 9, "low", &["e99"])]));
        assert_eq!(flags(&grade), (true, false, false));
        assert!(grade.severe_conditions.is_empty());
        // Only the listed ones fire.
        let one = grudge_card("[]", "[]", r#"["self_reference"]"#, "[]");
        assert_eq!(
            graded(&one, &g(&[grudge(9, 9, "low", &["e99"])])).severe_conditions,
            vec![SevereCondition::SelfReference]
        );
    }

    #[test]
    fn invented_event_id_also_covers_origin_and_turning_point_fields() {
        let debt_line = s_line(
            "S-debt_chain-001",
            "debt_chain",
            "debt_chain_v1",
            "[]",
            "[]",
            r#"["invented_event_id"]"#,
            "[]",
            "",
        );
        let raw = wrap("debt_chain_v1", &[debt(2, 1, 50, "open", "e77", &["e1"])]);
        assert_eq!(
            graded(&debt_line, &raw).severe_conditions,
            vec![SevereCondition::InventedEventId]
        );
        let shift_line = s_line(
            "S-relationship_shift-001",
            "relationship_shift",
            "relationship_shift_v1",
            "[]",
            "[]",
            r#"["invented_event_id"]"#,
            "[]",
            "",
        );
        let raw = wrap(
            "relationship_shift_v1",
            &[shift(1, 2, "colder", Some("e55"))],
        );
        assert_eq!(
            graded(&shift_line, &raw).severe_conditions,
            vec![SevereCondition::InventedEventId]
        );
    }

    /// One row per pattern-based condition: (condition, family, schema, pattern,
    /// triggering answer, answer that must not trigger).
    fn pattern_rows() -> Vec<(
        &'static str,
        &'static str,
        &'static str,
        &'static str,
        String,
        String,
    )> {
        vec![
            (
                "reversed_direction",
                "relationship_shift",
                "relationship_shift_v1",
                r#"{"a":1,"b":2,"direction":"reversed"}"#,
                wrap("relationship_shift_v1", &[shift(2, 1, "reversed", None)]),
                wrap("relationship_shift_v1", &[shift(1, 2, "colder", None)]),
            ),
            (
                "dead_person_as_actor_after_death",
                "broken_promise",
                "broken_promise_v1",
                r#"{"promisor":3,"status":"kept"}"#,
                wrap("broken_promise_v1", &[promise(3, 1, "e1", "kept")]),
                wrap("broken_promise_v1", &[promise(1, 3, "e1", "kept")]),
            ),
            (
                "contradicts_fact",
                "grudge_detection",
                "grudge_v1",
                r#"{"from":1,"to":2,"level":"low"}"#,
                g(&[grudge(1, 2, "low", &["e1"])]),
                g(&[grudge(1, 2, "high", &["e1"])]),
            ),
            (
                "wrong_debt_holder",
                "debt_chain",
                "debt_chain_v1",
                r#"{"debtor":3,"creditor":1}"#,
                wrap("debt_chain_v1", &[debt(3, 1, 50, "open", "e1", &["e1"])]),
                wrap("debt_chain_v1", &[debt(2, 1, 50, "open", "e1", &["e1"])]),
            ),
        ]
    }

    #[test]
    fn pattern_based_severe_conditions_follow_severe_patterns() {
        let expected = [
            SevereCondition::ReversedDirection,
            SevereCondition::DeadPersonAsActorAfterDeath,
            SevereCondition::ContradictsFact,
            SevereCondition::WrongDebtHolder,
        ];
        for ((cond, family, schema, pattern, hit, miss), want) in
            pattern_rows().into_iter().zip(expected)
        {
            let id = format!("S-{family}-001");
            let sp = format!(r#"[{{"condition":"{cond}","pattern":{pattern}}}]"#);
            let listed = s_line(
                &id,
                family,
                schema,
                "[]",
                "[]",
                &format!("[\"{cond}\"]"),
                &sp,
                "",
            );
            assert_eq!(
                graded(&listed, &hit).severe_conditions,
                vec![want],
                "{cond}"
            );
            assert!(graded(&listed, &hit).severe, "{cond}");
            assert!(
                graded(&listed, &miss).severe_conditions.is_empty(),
                "{cond}"
            );
            // A pattern entry for a condition the card does not list never fires.
            let unlisted = s_line(&id, family, schema, "[]", "[]", "[]", &sp, "");
            let g = graded(&unlisted, &hit);
            assert!(!g.severe && g.severe_conditions.is_empty(), "{cond}");
        }
    }

    #[test]
    fn severe_is_independent_of_acceptable() {
        let line = grudge_card(
            r#"[{"from":1,"to":2}]"#,
            "[]",
            r#"["self_reference"]"#,
            "[]",
        );
        let raw = g(&[grudge(1, 2, "high", &["e1"]), grudge(3, 3, "low", &["e4"])]);
        let grade = graded(&line, &raw);
        assert_eq!(flags(&grade), (true, true, false));
        assert_eq!(
            grade.severe_conditions,
            vec![SevereCondition::SelfReference]
        );
    }

    // ---- Shuffle identity fields ----

    fn id_of(line: &str, raw: &str) -> IdentityValue {
        identity(&verdict(line, raw))
    }

    #[test]
    fn identity_ignores_item_order_evidence_order_and_reason() {
        let line = grudge_card("[]", "[]", "[]", "[]");
        let a = grudge(1, 2, "high", &["e1", "e2"]);
        let b = grudge(2, 1, "low", &["e3"]);
        let base = id_of(&line, &g(&[a.clone(), b.clone()]));
        assert!(matches!(base, IdentityValue::Set(ref s) if s.len() == 2));
        assert_eq!(base, id_of(&line, &g(&[b.clone(), a.clone()])));
        let reworded = grudge(1, 2, "high", &["e2", "e1"]).replace("\"r\"", "\"other words\"");
        assert_eq!(base, id_of(&line, &g(&[reworded, b])));
    }

    #[test]
    fn grudge_identity_fields_are_from_to_level() {
        let line = grudge_card("[]", "[]", "[]", "[]");
        let base = id_of(&line, &g(&[grudge(1, 2, "high", &["e1"])]));
        for changed in [
            grudge(2, 1, "high", &["e1"]),
            grudge(1, 3, "high", &["e1"]),
            grudge(1, 2, "low", &["e1"]),
        ] {
            assert_ne!(base, id_of(&line, &g(&[changed])));
        }
        // Evidence is not an identity field.
        assert_eq!(
            base,
            id_of(&line, &g(&[grudge(1, 2, "high", &["e2", "e3"])]))
        );
    }

    #[test]
    fn debt_identity_fields_are_debtor_creditor_origin_status_amount() {
        let line = s_line(
            "S-debt_chain-001",
            "debt_chain",
            "debt_chain_v1",
            "[]",
            "[]",
            "[]",
            "[]",
            "",
        );
        let w = |item: String| id_of(&line, &wrap("debt_chain_v1", &[item]));
        let base = w(debt(2, 1, 50, "open", "e1", &["e1"]));
        for changed in [
            debt(1, 2, 50, "open", "e1", &["e1"]),
            debt(3, 1, 50, "open", "e1", &["e1"]),
            debt(2, 1, 51, "open", "e1", &["e1"]),
            debt(2, 1, 50, "repaid", "e1", &["e1"]),
            debt(2, 1, 50, "open", "e2", &["e1"]),
        ] {
            assert_ne!(base, w(changed));
        }
        assert_eq!(base, w(debt(2, 1, 50, "open", "e1", &["e3", "e2"])));
        // `transferred_from` is not an identity field.
        let transferred = debt(2, 1, 50, "open", "e1", &["e1"]).replace("null", "3");
        assert_eq!(base, w(transferred));
    }

    #[test]
    fn promise_identity_fields_are_promisor_promisee_event_status() {
        let line = s_line(
            "S-broken_promise-001",
            "broken_promise",
            "broken_promise_v1",
            "[]",
            "[]",
            "[]",
            "[]",
            "",
        );
        let w = |item: String| id_of(&line, &wrap("broken_promise_v1", &[item]));
        let base = w(promise(1, 2, "e1", "broken"));
        for changed in [
            promise(2, 1, "e1", "broken"),
            promise(1, 3, "e1", "broken"),
            promise(1, 2, "e2", "broken"),
            promise(1, 2, "e1", "kept"),
        ] {
            assert_ne!(base, w(changed));
        }
        let other_evidence = promise(1, 2, "e1", "broken").replace("[\"e1\"]", "[\"e2\"]");
        assert_eq!(base, w(other_evidence));
    }

    #[test]
    fn shift_identity_is_an_unordered_pair_with_direction_and_turning_point() {
        let line = s_line(
            "S-relationship_shift-001",
            "relationship_shift",
            "relationship_shift_v1",
            "[]",
            "[]",
            "[]",
            "[]",
            "",
        );
        let w = |item: String| id_of(&line, &wrap("relationship_shift_v1", &[item]));
        let base = w(shift(1, 2, "colder", Some("e3")));
        assert_eq!(base, w(shift(2, 1, "colder", Some("e3"))));
        assert_ne!(base, w(shift(1, 2, "warmer", Some("e3"))));
        assert_ne!(base, w(shift(1, 2, "colder", Some("e2"))));
        assert_ne!(base, w(shift(1, 2, "colder", None)));
        assert_ne!(base, w(shift(1, 3, "colder", Some("e3"))));
    }

    #[test]
    fn decision_identity_is_the_chosen_id_and_illegal_is_invalid() {
        let line = d_line("D-will_execution-001", r#"["heed"]"#, "[]", "");
        let heed = id_of(&line, r#"{"option":"heed"}"#);
        assert_eq!(
            heed,
            IdentityValue::Option(OptionId::new("heed").expect("id"))
        );
        assert_ne!(heed, id_of(&line, r#"{"option":"burn"}"#));
        // Different illegal outputs compare as the same value `invalid`.
        let one = id_of(&line, r#"{"option":"fly"}"#);
        let two = id_of(&line, "garbage");
        assert_eq!(
            (&one, &two),
            (&IdentityValue::Invalid, &IdentityValue::Invalid)
        );
        let s_card = grudge_card("[]", "[]", "[]", "[]");
        assert_eq!(id_of(&s_card, "garbage"), IdentityValue::Invalid);
    }

    // ---- Contrast pairs ----

    #[test]
    fn decision_contrast_pair_is_consistent_only_in_the_expected_subsets() {
        let ct = |role: &str| {
            format!(
                r#","contrast":{{"pair_id":"P001","role":"{role}","changed_fact":"piety","expected":{{"a":["heed","burn"],"b":["dismiss"]}}}}"#
            )
        };
        let card_a = d_line("D-will_execution-001", r#"["heed","burn"]"#, "[]", &ct("a"));
        let card_b = d_line("D-will_execution-002", r#"["dismiss"]"#, "[]", &ct("b"));
        let (_, _, _, ca) = parsed(&card_a);
        let ca = ca.expect("contrast on card a");
        assert_eq!(ca.pair_id, "P001");
        let pick = |line: &str, o: &str| verdict(line, &format!(r#"{{"option":"{o}"}}"#));
        let decide = |va: &Verdict, vb: &Verdict| {
            let d =
                contrast(&ca.pair_id, va, vb, &ca.expected_a, &ca.expected_b).expect("sound pair");
            (d.a_in_expected, d.b_in_expected, d.consistent)
        };
        let heed = pick(&card_a, "heed");
        let dismiss = pick(&card_b, "dismiss");
        assert_eq!(decide(&heed, &dismiss), (true, true, true));
        // A model that ignores the changed fact answers both cards alike.
        assert_eq!(decide(&heed, &pick(&card_b, "heed")), (true, false, false));
        assert_eq!(decide(&dismiss, &dismiss), (false, true, false));
        // The reverse direction is inconsistent too.
        assert_eq!(decide(&dismiss, &heed), (false, false, false));
        // An Illegal answer is in neither subset.
        let illegal = verdict(&card_a, "nonsense");
        assert!(matches!(illegal, Verdict::Illegal { .. }));
        assert_eq!(decide(&illegal, &dismiss), (false, true, false));
        assert_eq!(decide(&heed, &illegal), (true, false, false));
        assert_eq!(decide(&illegal, &illegal), (false, false, false));
    }

    #[test]
    fn synthesis_contrast_pair_uses_include_and_exclude_patterns() {
        let ct = |role: &str| {
            format!(
                r#","contrast":{{"pair_id":"P002","role":"{role}","changed_fact":"e3 is a theft or a gift","expected":{{"a":{{"include":[{{"a":1,"b":2,"direction":["colder","reversed"]}}],"exclude":[{{"a":1,"b":2,"direction":"warmer"}}]}},"b":{{"include":[{{"a":1,"b":2,"direction":"warmer"}}],"exclude":[{{"a":1,"b":2,"direction":["colder","reversed"]}}]}}}}}}"#
            )
        };
        let line = |id: &str, role: &str| {
            s_line(
                id,
                "relationship_shift",
                "relationship_shift_v1",
                "[]",
                "[]",
                "[]",
                "[]",
                &ct(role),
            )
        };
        let card_a = line("S-relationship_shift-001", "a");
        let (_, _, _, c) = parsed(&card_a);
        let c = c.expect("contrast");
        assert!(matches!(c.expected_a, ExpectedSide::Patterns { .. }));
        let w = |items: &[String]| verdict(&card_a, &wrap("relationship_shift_v1", items));
        let colder = w(&[shift(2, 1, "colder", Some("e3"))]);
        let warmer = w(&[shift(1, 2, "warmer", None)]);
        let both = w(&[shift(1, 2, "warmer", None), shift(1, 2, "colder", None)]);
        let unrelated = w(&[shift(1, 3, "colder", None)]);
        let decide = |va: &Verdict, vb: &Verdict| {
            let d = contrast(&c.pair_id, va, vb, &c.expected_a, &c.expected_b).expect("sound pair");
            (d.a_in_expected, d.b_in_expected, d.consistent)
        };
        // The swapped (a=2, b=1) colder item satisfies card a's include pattern.
        assert_eq!(decide(&colder, &warmer), (true, true, true));
        assert_eq!(decide(&warmer, &colder), (false, false, false));
        // "Falls in" means every include is matched and no exclude is matched.
        assert_eq!(decide(&both, &warmer), (false, true, false));
        assert_eq!(decide(&colder, &both), (true, false, false));
        assert_eq!(decide(&unrelated, &warmer), (false, true, false));
        let illegal = w(&[]);
        assert!(matches!(illegal, Verdict::Synthesis { .. }));
        assert_eq!(decide(&illegal, &illegal), (false, false, false));
        let bad = verdict(&card_a, "garbage");
        assert_eq!(decide(&bad, &warmer), (false, true, false));
    }

    // ---- Answer-key errors ----

    fn unknown_field_pattern() -> Pattern {
        Pattern {
            fields: BTreeMap::from([(
                "colour".to_owned(),
                PatternValue::Exact(Scalar::Str("red".into())),
            )]),
            evidence_any: None,
        }
    }

    fn good_pattern() -> Pattern {
        Pattern {
            fields: BTreeMap::from([("from".to_owned(), PatternValue::Exact(Scalar::Int(1)))]),
            evidence_any: None,
        }
    }

    fn empty_grudge_verdict() -> Verdict {
        Verdict::Synthesis {
            answer: SynthesisAnswer::Grudge(Vec::new()),
            missing_persons: Vec::new(),
            missing_events: Vec::new(),
        }
    }

    fn key_with(
        include: Vec<Pattern>,
        exclude: Vec<Pattern>,
        severe: Vec<(SevereCondition, Pattern)>,
    ) -> AnswerKey {
        AnswerKey::Synthesis {
            schema: OutputSchema::GrudgeV1,
            must_include: include,
            must_not_include: exclude,
            severe_conditions: BTreeSet::new(),
            severe_patterns: severe,
        }
    }

    #[test]
    fn grader_names_the_card_and_the_faulty_entry() {
        let v = empty_grudge_verdict();
        let cases = [
            (
                key_with(
                    vec![good_pattern(), unknown_field_pattern()],
                    vec![],
                    vec![],
                ),
                "must_include[1].colour".to_owned(),
            ),
            (
                key_with(
                    vec![],
                    vec![good_pattern(), unknown_field_pattern()],
                    vec![],
                ),
                "must_not_include[1].colour".to_owned(),
            ),
            (
                key_with(
                    vec![],
                    vec![],
                    vec![
                        (SevereCondition::ContradictsFact, good_pattern()),
                        (SevereCondition::ReversedDirection, unknown_field_pattern()),
                    ],
                ),
                format!("{SEVERE_PATTERNS}[1].colour"),
            ),
        ];
        for (key, entry) in cases {
            let e = grade("S-grudge_detection-007", &v, &key).expect_err("faulty key");
            assert_eq!(
                e,
                GradeError {
                    card_id: "S-grudge_detection-007".to_owned(),
                    entry: entry.clone(),
                    detail: "unknown_pattern_field",
                }
            );
            let text = e.to_string();
            assert!(
                text.contains("S-grudge_detection-007") && text.contains(&entry),
                "{text}"
            );
        }
        // A field of another schema is just as faulty: `debtor` is not a grudge field.
        let other = Pattern {
            fields: BTreeMap::from([("debtor".to_owned(), PatternValue::Exact(Scalar::Int(1)))]),
            evidence_any: None,
        };
        let e = grade(
            "S-grudge_detection-008",
            &v,
            &key_with(vec![other], vec![], vec![]),
        )
        .expect_err("faulty key");
        assert_eq!(
            (e.card_id.as_str(), e.entry.as_str()),
            ("S-grudge_detection-008", "must_include[0].debtor")
        );
    }

    #[test]
    fn contrast_check_names_the_pair_and_the_faulty_side() {
        let v = empty_grudge_verdict();
        let bad = ExpectedSide::Patterns {
            include: vec![],
            exclude: vec![unknown_field_pattern()],
        };
        let fine = ExpectedSide::Patterns {
            include: vec![],
            exclude: vec![],
        };
        let e = contrast("P012", &v, &v, &fine, &bad).expect_err("faulty side");
        assert_eq!(
            (e.card_id.as_str(), e.entry.as_str(), e.detail),
            (
                "P012",
                "expected.b.exclude[0].colour",
                "unknown_pattern_field"
            )
        );
    }

    #[test]
    fn verdict_that_does_not_fit_the_key_is_an_error_not_a_grade() {
        let d_key = AnswerKey::Decision {
            acceptable: BTreeSet::new(),
            severe: BTreeSet::new(),
        };
        let e =
            grade("D-will_execution-003", &empty_grudge_verdict(), &d_key).expect_err("mismatch");
        assert_eq!(e.card_id, "D-will_execution-003");
        let s_key = key_with(vec![], vec![], vec![]);
        let opt = Verdict::Decision {
            option: OptionId::new("heed").expect("id"),
        };
        assert!(grade("S-grudge_detection-003", &opt, &s_key).is_err());
        // A verdict for another schema does not fit either.
        let debt_verdict = Verdict::Synthesis {
            answer: SynthesisAnswer::DebtChain(Vec::new()),
            missing_persons: Vec::new(),
            missing_events: Vec::new(),
        };
        assert!(grade("S-grudge_detection-003", &debt_verdict, &s_key).is_err());
    }

    #[test]
    fn card_parser_rejects_faulty_pattern_entries_with_their_path() {
        let unknown_in_gold = grudge_card(r#"[{"from":1},{"colour":"red"}]"#, "[]", "[]", "[]");
        let e = parse_card(&unknown_in_gold, 7).expect_err("rejected");
        assert_eq!(e.kind, CardErrorKind::AnswerKey);
        assert_eq!(e.detail, "unknown_pattern_field");
        assert_eq!(e.line, 7);
        assert!(e.path.ends_with("must_include[1].colour"), "{}", e.path);

        let sp = r#"[{"condition":"contradicts_fact","pattern":{"colour":"red"}}]"#;
        let unknown_in_sp = grudge_card("[]", "[]", r#"["contradicts_fact"]"#, sp);
        let e = parse_card(&unknown_in_sp, 3).expect_err("rejected");
        assert_eq!(
            (e.kind, e.detail.as_str()),
            (CardErrorKind::AnswerKey, "unknown_pattern_field")
        );
        assert!(
            e.path.starts_with(&format!("{SEVERE_PATTERNS}[0]")) && e.path.ends_with(".colour"),
            "{}",
            e.path
        );

        let bad_cond = grudge_card("[]", "[]", r#"["made_up"]"#, "[]");
        let e = parse_card(&bad_cond, 1).expect_err("rejected");
        assert_eq!(
            (e.kind, e.detail.as_str()),
            (CardErrorKind::AnswerKey, "unknown_severe_condition")
        );
        assert!(e.path.starts_with("severe_conditions[0]"), "{}", e.path);
    }

    #[test]
    fn missing_reference_lists_come_from_the_validator() {
        // Guards the link between the validator and the automatic conditions.
        let line = grudge_card("[]", "[]", "[]", "[]");
        match verdict(&line, &g(&[grudge(9, 2, "low", &["e99"])])) {
            Verdict::Synthesis {
                answer,
                missing_persons,
                missing_events,
            } => {
                assert_eq!(missing_persons, vec![9]);
                assert_eq!(missing_events, vec!["e99".to_owned()]);
                assert!(matches!(answer, SynthesisAnswer::Grudge(_)));
            }
            other => panic!("{other:?}"),
        }
    }
}

// ---- JSON API (task 4.5) ----
//
// The canonical JSON of each `sim_core::llm::api` function for Dev_Cards. Only
// `dev.jsonl` is read. Answer-key member names are built at runtime.

mod json_api {
    use serde_json::{Value, json};
    use sim_core::llm::api::{
        frozen_context_to_json, llm_contrast, llm_grade, llm_identity, llm_parse_card,
        llm_permutations, llm_render_prompt, llm_validate,
    };
    use sim_core::llm::card::{frozen_context_from_json, parse_card};

    const DEV: &str = include_str!("../../../eval/cards/cards/dev.jsonl");

    fn card(id: &str) -> &'static str {
        DEV.lines()
            .find(|l| l.contains(&format!("\"id\":\"{id}\"")))
            .unwrap_or_else(|| panic!("no dev card {id}"))
    }

    fn val(s: &str) -> Value {
        serde_json::from_str(s).unwrap_or_else(|e| panic!("not JSON ({e}): {s}"))
    }

    fn ok(s: &str) -> Value {
        let v = val(s);
        assert_eq!(v["ok"], json!(true), "{s}");
        v
    }

    fn error(s: &str) -> (String, String) {
        let v = val(s);
        assert_eq!(v["ok"], json!(false), "{s}");
        (
            v["error"]["kind"].as_str().unwrap_or_default().to_owned(),
            v["error"]["message"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        )
    }

    const D1: &str = "D-dream_interpretation-001";
    const D2: &str = "D-dream_interpretation-002";
    const S1: &str = "S-grudge_detection-001";

    fn ctx_of(id: &str) -> Value {
        ok(&llm_parse_card(card(id)))["frozen_context"].clone()
    }

    #[test]
    fn parse_card_result_for_a_decision_dev_card() {
        let out = llm_parse_card(card(D1));
        let v = ok(&out);
        assert_eq!(
            v["meta"],
            json!({"family":"dream_interpretation","id":D1,"pair_id":"P001","role":"a",
                   "scenario_group":"G001","scored":true,"split":"dev","task":"decision"})
        );
        assert_eq!(
            v["random_baseline_parts"],
            json!({"acceptable_count":2,"option_count":4})
        );
        assert_eq!(v["frozen_context"]["task"], json!("decision"));
        assert_eq!(
            v["frozen_context"]["options"][0]["id"],
            json!("heed_warning")
        );
        // `card` is the canonical form of the input line, so it parses back to the same card.
        let canonical = serde_json::to_string(&v["card"]).unwrap_or_default();
        assert_eq!(val(card(D1)), val(&canonical));
        // Canonical: keys in byte order, no whitespace; calling twice gives the same bytes.
        assert!(out.starts_with("{\"card\":{"), "{}", &out[..40]);
        assert!(!out.contains("\n"));
        assert_eq!(out, llm_parse_card(card(D1)));
    }

    #[test]
    fn parse_card_result_for_a_synthesis_dev_card_has_no_baseline() {
        let v = ok(&llm_parse_card(card(S1)));
        assert_eq!(v["random_baseline_parts"], Value::Null);
        assert_eq!(v["meta"]["task"], json!("synthesis"));
        assert_eq!(v["frozen_context"]["output_schema"], json!("grudge_v1"));
    }

    #[test]
    fn frozen_context_json_round_trips_for_every_dev_card() {
        for (i, line) in DEV.lines().enumerate() {
            let (_, ctx, _, _) = parse_card(line, i + 1).expect("dev card parses");
            let back = frozen_context_from_json(frozen_context_to_json(&ctx))
                .unwrap_or_else(|e| panic!("line {}: {e}", i + 1));
            assert_eq!(back, ctx, "line {}", i + 1);
        }
    }

    #[test]
    fn permutations_result() {
        let input = json!({"frozen_context": ctx_of(D1)}).to_string();
        assert_eq!(
            llm_permutations(&input),
            r#"{"ok":true,"permutations":["base","reversed","rotated_1","rotated_2"]}"#
        );
        let sanity = json!({"frozen_context": ctx_of("D-sanity-001")}).to_string();
        assert_eq!(
            llm_permutations(&sanity),
            r#"{"ok":true,"permutations":["base"]}"#
        );
    }

    #[test]
    fn render_prompt_result() {
        let template = "[system]\nYou decide. Today is day {{tick}}.\n[user]\n{{situation}}\n{{people}}\n{{relations}}\n{{events}}\n{{options}}\n";
        let input = json!({"frozen_context": ctx_of(D1), "template": template,
                           "schema_text": null, "permutation": "reversed"})
        .to_string();
        let out = llm_render_prompt(&input);
        let v = ok(&out);
        assert_eq!(v["renderer_version"], json!(2));
        assert!(
            v["system"]
                .as_str()
                .unwrap_or_default()
                .starts_with("You decide. Today is day ")
        );
        let user = v["user"].as_str().unwrap_or_default();
        let first = user
            .find("read_as_blessing")
            .expect("reversed puts it first");
        let last = user.find("heed_warning").expect("last option");
        assert!(first < last);
        assert_eq!(out, llm_render_prompt(&input));
        // A template that uses an unknown placeholder is a render error.
        let bad = json!({"frozen_context": ctx_of(D1), "template": "[system]\n{{nope}}\n[user]\nx",
                         "permutation": "base"})
        .to_string();
        let (kind, message) = error(&llm_render_prompt(&bad));
        assert_eq!(kind, "render");
        assert!(message.contains("nope"), "{message}");
    }

    #[test]
    fn validate_results() {
        let ctx = ctx_of(D1);
        let raw =
            json!({"frozen_context": ctx, "raw": "{\"option\":\"heed_warning\"}"}).to_string();
        assert_eq!(
            llm_validate(&raw),
            r#"{"ok":true,"verdict":{"kind":"decision","option":"heed_warning"}}"#
        );
        let off = json!({"frozen_context": ctx, "raw": "{\"option\":\"nope\"}"}).to_string();
        assert_eq!(
            llm_validate(&off),
            r#"{"ok":true,"verdict":{"kind":"illegal","path":"option","reason":"out_of_set_option"}}"#
        );
        let timeout = json!({"frozen_context": ctx, "outcome": {"kind": "timeout"}}).to_string();
        assert_eq!(
            llm_validate(&timeout),
            r#"{"ok":true,"verdict":{"kind":"illegal","path":null,"reason":"timeout"}}"#
        );
        let fail = json!({"frozen_context": ctx, "outcome": {"kind": "error", "code": "http_500"}})
            .to_string();
        assert_eq!(
            llm_validate(&fail),
            r#"{"ok":true,"verdict":{"kind":"illegal","path":null,"reason":"runtime_error"}}"#
        );
    }

    fn decision(option: &str) -> Value {
        json!({"kind": "decision", "option": option})
    }

    #[test]
    fn grade_identity_and_contrast_results() {
        let grade = json!({"card": card(D1), "verdict": decision("heed_warning")}).to_string();
        assert_eq!(
            llm_grade(&grade),
            r#"{"grade":{"acceptable":true,"illegal":false,"severe":false,"severe_conditions":[]},"ok":true}"#
        );
        assert_eq!(
            llm_identity(&grade),
            r#"{"identity":{"kind":"option","option":"heed_warning"},"ok":true}"#
        );
        let illegal = json!({"card": card(D1),
            "verdict": {"kind":"illegal","reason":"timeout","path":null}})
        .to_string();
        assert_eq!(
            llm_grade(&illegal),
            r#"{"grade":{"acceptable":false,"illegal":true,"severe":false,"severe_conditions":[]},"ok":true}"#
        );
        assert_eq!(
            llm_identity(&illegal),
            r#"{"identity":{"kind":"invalid"},"ok":true}"#
        );
        let pair = json!({"card_a": card(D1), "verdict_a": decision("heed_warning"),
                          "card_b": card(D2), "verdict_b": decision("heed_warning")})
        .to_string();
        let v = ok(&llm_contrast(&pair));
        assert_eq!(v["contrast"]["a_in_expected"], json!(true));
        assert_eq!(
            v["contrast"]["consistent"],
            json!(
                v["contrast"]["a_in_expected"] == json!(true)
                    && v["contrast"]["b_in_expected"] == json!(true)
            )
        );
        assert_eq!(llm_contrast(&pair), llm_contrast(&pair));
    }

    #[test]
    fn synthesis_card_validate_grade_identity_chain() {
        let ctx = ctx_of(S1);
        let people = ctx["people"].as_array().cloned().unwrap_or_default();
        let events = ctx["events"].as_array().cloned().unwrap_or_default();
        let answer = json!({"schema":"grudge_v1","items":[{
            "from": people[0]["id"], "to": people[1]["id"], "level": "high",
            "evidence": [events[0]["id"]], "reason": "r"}]});
        let input = json!({"frozen_context": ctx, "raw": answer.to_string()}).to_string();
        let verdict = ok(&llm_validate(&input))["verdict"].clone();
        assert_eq!(verdict["kind"], json!("synthesis"));
        assert_eq!(verdict["missing_events"], json!([]));
        let graded = ok(&llm_grade(
            &json!({"card": card(S1), "verdict": verdict}).to_string(),
        ));
        assert_eq!(graded["grade"]["illegal"], json!(false));
        let identity = ok(&llm_identity(
            &json!({"card": card(S1), "verdict": verdict}).to_string(),
        ));
        assert_eq!(identity["identity"]["kind"], json!("set"));
        assert_eq!(identity["identity"]["tuples"][0]["type"], json!("grudge"));
        assert_eq!(identity["identity"]["tuples"][0]["level"], json!("high"));
    }

    #[test]
    fn bad_input_is_an_input_error_and_never_panics() {
        let deep = "[".repeat(10_000);
        let huge = format!("\"{}\"", "a".repeat(9_000_000));
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
            "{\"card\":3,\"verdict\":{}}",
            deep.as_str(),
            huge.as_str(),
        ];
        for input in inputs {
            for out in [
                llm_parse_card(input),
                llm_permutations(input),
                llm_render_prompt(input),
                llm_validate(input),
                llm_grade(input),
                llm_identity(input),
                llm_contrast(input),
            ] {
                let v = val(&out);
                assert!(
                    v["ok"] == json!(true) || v["error"]["kind"].is_string(),
                    "{out}"
                );
            }
        }
        assert_eq!(error(&llm_permutations("{")).0, "input");
        assert_eq!(
            error(&llm_grade(&json!({"card": card(D1)}).to_string())).0,
            "input"
        );
        let extra =
            json!({"card": card(D1), "verdict": decision("heed_warning"), "more": 1}).to_string();
        assert_eq!(error(&llm_grade(&extra)).0, "input");
        assert_eq!(error(&llm_parse_card("not json")).0, "card");
    }

    #[test]
    fn card_and_answer_key_errors_name_fields_bare() {
        // A synthesis-only member on a decision card is an answer-key error.
        let name = format!("{}_{}", "severe", "patterns");
        let line =
            card(D1).trim_end().trim_end_matches('}').to_owned() + &format!(",\"{name}\":[]}}");
        let (kind, message) = error(&llm_parse_card(&line));
        assert_eq!(kind, "answer_key");
        assert!(message.contains(&name), "{message}");
        assert!(!message.contains('"'), "{message}");
        // A verdict of the wrong task is an answer-key error from the grader.
        let synth = ok(&llm_validate(
            &json!({"frozen_context": ctx_of(S1), "raw": "{\"schema\":\"grudge_v1\",\"items\":[]}"}).to_string(),
        ))["verdict"]
            .clone();
        let (kind, message) = error(&llm_grade(
            &json!({"card": card(D1), "verdict": synth}).to_string(),
        ));
        assert_eq!(kind, "answer_key");
        assert!(!message.contains('"'), "{message}");
    }

    #[test]
    fn contrast_needs_one_pair_in_order() {
        let v = decision("heed_warning");
        let swapped =
            json!({"card_a": card(D2), "verdict_a": v, "card_b": card(D1), "verdict_b": v});
        assert_eq!(error(&llm_contrast(&swapped.to_string())).0, "card");
        let unpaired = json!({"card_a": card("D-dream_interpretation-003"), "verdict_a": v,
                              "card_b": card(D2), "verdict_b": v});
        assert_eq!(error(&llm_contrast(&unpaired.to_string())).0, "card");
    }
}
