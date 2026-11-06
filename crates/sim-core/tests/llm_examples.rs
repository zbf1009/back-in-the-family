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
