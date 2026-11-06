//! Property-based tests for the `sim_core::llm` boundary (llm-probe spec, Properties 1-15),
//! using `proptest`.
//!
//! This file holds the shared generators (module `llm_gen`) and, for now, only smoke
//! tests that every generated context, key and legal answer is structurally valid. The
//! numbered properties are added by the later tasks of the spec; each is tagged
//! `// Feature: llm-probe, Property N: <title>`.
//!
//! The Dev_Cards are read from `eval/cards/cards/dev.jsonl` only.

mod llm_gen;

use std::collections::BTreeSet;

use llm_gen::*;
use proptest::prelude::*;
use proptest::strategy::{Strategy, ValueTree};
use proptest::test_runner::TestRunner;
use sim_core::llm::card::{CardErrorKind, ParsedCard, parse_card};
use sim_core::llm::json::{self, Json};
use sim_core::llm::validate::validate_raw;
use sim_core::llm::{AnswerKey, FrozenContext, IllegalReason, Task, TaskSpec, Verdict};

/// Panics with a message when `ctx` breaks a structural rule of the card schema.
fn check_context(ctx: &FrozenContext) {
    assert!((1..=12).contains(&ctx.people.len()), "people count");
    assert!(ctx.events.len() <= 12, "event count");
    let pids: BTreeSet<i64> = ctx.people.iter().map(|p| p.id.0).collect();
    assert_eq!(pids.len(), ctx.people.len(), "person IDs unique");
    let eids: BTreeSet<&str> = ctx.events.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(eids.len(), ctx.events.len(), "event IDs unique");
    assert!(
        ctx.events.windows(2).all(|w| w[0].tick <= w[1].tick),
        "ticks sorted"
    );
    assert!(
        ctx.events.iter().all(|e| e.tick <= ctx.tick),
        "tick covers the log"
    );
    if let Some(s) = ctx.subject {
        assert!(pids.contains(&s.0), "subject is a person");
    }
    for e in &ctx.events {
        assert!(e.actors.iter().all(|a| pids.contains(&a.0)), "actors exist");
        assert!(
            e.caused_by.iter().all(|c| eids.contains(c.as_str())),
            "causes exist"
        );
        if let Some(due) = e.due_tick {
            assert!(
                matches!(e.kind.as_str(), "loan" | "promise"),
                "due_tick kind"
            );
            assert!(due > e.tick, "due after the event");
        }
    }
    for r in &ctx.relations {
        assert!(
            pids.contains(&r.from.0) && pids.contains(&r.to.0),
            "relation ends"
        );
        assert_ne!(r.from, r.to);
    }
    match (&ctx.task, &ctx.spec) {
        (Task::Decision, TaskSpec::Decision { options }) => {
            assert!((2..=5).contains(&options.len()), "option count");
            let ids: BTreeSet<_> = options.iter().map(|o| o.id.clone()).collect();
            assert_eq!(ids.len(), options.len(), "option IDs unique");
        }
        (Task::Synthesis, TaskSpec::Synthesis { .. }) => {}
        _ => panic!("task and spec disagree"),
    }
}

fn check_key(ctx: &FrozenContext, key: &AnswerKey) {
    match (&ctx.spec, key) {
        (TaskSpec::Decision { options }, AnswerKey::Decision { acceptable, severe }) => {
            let ids: BTreeSet<_> = options.iter().map(|o| o.id.clone()).collect();
            assert!(!acceptable.is_empty(), "acceptable non-empty");
            assert!(acceptable.is_subset(&ids) && severe.is_subset(&ids));
            assert!(
                acceptable.is_disjoint(severe),
                "acceptable and severe disjoint"
            );
        }
        (
            TaskSpec::Synthesis { schema: cs },
            AnswerKey::Synthesis {
                schema,
                must_include,
                must_not_include,
                severe_conditions,
                severe_patterns,
            },
        ) => {
            assert_eq!(cs, schema);
            let eids: BTreeSet<_> = ctx.events.iter().map(|e| e.id.clone()).collect();
            let patterns = must_include
                .iter()
                .chain(must_not_include)
                .chain(severe_patterns.iter().map(|(_, p)| p));
            for p in patterns {
                assert!(!p.fields.is_empty(), "pattern has a field");
                if let Some(ev) = &p.evidence_any {
                    assert!(!ev.is_empty() && ev.is_subset(&eids), "evidence_any");
                }
            }
            assert!(
                severe_patterns
                    .iter()
                    .all(|(c, _)| severe_conditions.contains(c))
            );
        }
        _ => panic!("key and context disagree"),
    }
}

fn check_answer(ctx: &FrozenContext, answer: &LegalAnswer) {
    let root = json::parse(&answer.text).expect("legal answer text is one JSON value");
    let Json::Object(map) = root else {
        panic!("answer is an object");
    };
    match (&ctx.spec, &answer.expected) {
        (TaskSpec::Decision { options }, Expected::Option(id)) => {
            assert_eq!(map.len(), 1, "only `option`");
            assert_eq!(map.get("option"), Some(&Json::Str(id.as_str().to_owned())));
            assert!(options.iter().any(|o| &o.id == id));
        }
        (TaskSpec::Synthesis { schema }, Expected::Items(_)) => {
            assert_eq!(
                map.get("schema"),
                Some(&Json::Str(schema_name(*schema).to_owned()))
            );
            let Some(Json::Array(items)) = map.get("items") else {
                panic!("items array");
            };
            let eids: BTreeSet<String> = ctx
                .events
                .iter()
                .map(|e| e.id.as_str().to_owned())
                .collect();
            if ctx.events.is_empty() {
                assert!(items.is_empty());
            }
            for item in items {
                let Json::Object(item) = item else {
                    panic!("item object");
                };
                let Some(Json::Array(ev)) = item.get("evidence") else {
                    panic!("evidence array");
                };
                let ev: Vec<&Json> = ev.iter().collect();
                assert!(!ev.is_empty(), "evidence non-empty");
                let unique: BTreeSet<String> = ev
                    .iter()
                    .map(|j| match j {
                        Json::Str(s) => s.clone(),
                        _ => panic!("evidence entry is a string"),
                    })
                    .collect();
                assert_eq!(unique.len(), ev.len(), "evidence duplicate-free");
                assert!(unique.is_subset(&eids), "evidence events exist");
            }
        }
        _ => panic!("answer and context disagree"),
    }
}

proptest! {
    #[test]
    fn generated_contexts_are_structurally_valid(ctx in arb_context()) {
        check_context(&ctx);
    }

    #[test]
    fn generated_keys_refer_only_to_their_context((ctx, key) in arb_case()) {
        check_context(&ctx);
        check_key(&ctx, &key);
    }

    #[test]
    fn generated_legal_answers_are_structurally_valid(
        (ctx, answer) in arb_context_and_legal_answer()
    ) {
        check_answer(&ctx, &answer);
    }

    #[test]
    fn wrapped_answers_keep_the_json_value(
        (text, wrapped) in arb_context_and_legal_answer().prop_flat_map(|(_, a)| {
            let t = a.text;
            (Just(t.clone()), arb_wrapped(t))
        })
    ) {
        prop_assert!(wrapped.contains(&text));
    }

    #[test]
    fn dev_card_seeds_are_valid_contexts_and_keys(card in arb_dev_card()) {
        let (_, ctx, key, _) = card;
        check_key(&ctx, &key);
        if let TaskSpec::Decision { options } = &ctx.spec {
            prop_assert!((2..=5).contains(&options.len()));
        }
    }
}

#[test]
fn dev_cards_load_read_only() {
    let cards = dev_cards();
    assert_eq!(cards.len(), 34);
    assert!(
        cards
            .iter()
            .all(|(m, ..)| m.id.starts_with(['D', 'S', 'X']))
    );
}

/// The generators reach the corners the properties need: same-tick blocks, `due_tick`
/// present and absent, absent and empty optional fields, and both task types.
#[test]
fn generators_cover_the_schema_corners() {
    let mut runner = TestRunner::deterministic();
    let strategy = arb_context();
    let mut same_tick = false;
    let (mut due_some, mut due_none) = (false, false);
    let (mut no_input, mut empty_input, mut no_subject, mut no_relations) =
        (false, false, false, false);
    let (mut zero_events, mut twelve_events, mut d, mut s) = (false, false, false, false);
    for _ in 0..400 {
        let ctx = strategy.new_tree(&mut runner).expect("tree").current();
        same_tick |= ctx.events.windows(2).any(|w| w[0].tick == w[1].tick);
        for e in &ctx.events {
            due_some |= e.due_tick.is_some();
            due_none |= e.due_tick.is_none() && matches!(e.kind.as_str(), "loan" | "promise");
        }
        no_input |= ctx.player_input.is_none();
        empty_input |= ctx
            .player_input
            .as_ref()
            .is_some_and(|p| p.content.is_empty());
        no_subject |= ctx.subject.is_none();
        no_relations |= ctx.relations.is_empty();
        zero_events |= ctx.events.is_empty();
        twelve_events |= ctx.events.len() == 12;
        d |= ctx.task == Task::Decision;
        s |= ctx.task == Task::Synthesis;
    }
    assert!(same_tick && due_some && due_none, "events");
    assert!(
        no_input && empty_input && no_subject && no_relations,
        "optionals"
    );
    assert!(zero_events && twelve_events && d && s, "sizes and tasks");
}

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

/// `parse(serialize(parse(card))) == parse(card)` for one card line.
fn assert_round_trip(line: &str, line_no: usize) -> Result<(), TestCaseError> {
    let first = parse_card(line, line_no).map_err(|e| TestCaseError::fail(e.to_string()))?;
    let written = card_line(&first);
    let second = parse_card(&written, line_no).map_err(|e| TestCaseError::fail(e.to_string()))?;
    prop_assert_eq!(&second, &first);
    // The writer is canonical: writing the reparsed card gives the same line.
    prop_assert_eq!(card_line(&second), written);
    Ok(())
}

/// A card line with its `pick`-th number replaced by a fractional or exponent number
/// must fail with a `parse_failure` error that names the line.
fn assert_non_integer_rejected(
    base: &Json,
    pick: usize,
    style: usize,
    line_no: usize,
) -> Result<(), TestCaseError> {
    let count = number_count(base);
    prop_assert!(count > 0);
    let mut mutated = base.clone();
    let mut n = pick % count;
    prop_assert!(replace_nth_number(&mut mutated, &mut n, style));
    let line = json::write(&mutated);
    match parse_card(&line, line_no) {
        Ok(_) => prop_assert!(false, "accepted a non-integer number: {}", line),
        Err(e) => {
            prop_assert_eq!(e.kind, CardErrorKind::ParseFailure);
            prop_assert_eq!(e.line, line_no);
            let shown = e.to_string();
            let named = format!("line {line_no}:");
            prop_assert!(shown.starts_with(&named), "{}", shown);
        }
    }
    Ok(())
}

proptest! {
    // Feature: llm-probe, Property 1: Card parse round trip and integer-only numbers
    // **Validates: Requirements 2.3, 2.9, 2.10**
    #[test]
    fn card_round_trip_on_generated_cards(card in arb_card(), line_no in 1usize..=5000) {
        let line = card_line(&card);
        let parsed: ParsedCard =
            parse_card(&line, line_no).map_err(|e| TestCaseError::fail(e.to_string()))?;
        // The generated card is valid, and the writer loses nothing.
        prop_assert_eq!(&parsed, &card);
        assert_round_trip(&line, line_no)?;
    }

    // Feature: llm-probe, Property 1: Card parse round trip and integer-only numbers
    // **Validates: Requirements 2.3, 2.9, 2.10**
    #[test]
    fn non_integer_number_in_generated_card_is_rejected(
        card in arb_card(),
        pick in 0usize..10_000,
        style in 0usize..6,
        line_no in 1usize..=5000,
    ) {
        assert_non_integer_rejected(&card_json(&card), pick, style, line_no)?;
    }

    // Feature: llm-probe, Property 1: Card parse round trip and integer-only numbers
    // **Validates: Requirements 2.3, 2.9, 2.10**
    #[test]
    fn non_integer_number_in_dev_card_is_rejected(
        which in 0usize..34,
        pick in 0usize..100_000,
        style in 0usize..6,
    ) {
        let lines = dev_lines();
        let (line_no, text) = &lines[which % lines.len()];
        let base = json::parse(text).map_err(|e| TestCaseError::fail(e.detail.to_owned()))?;
        assert_non_integer_rejected(&base, pick, style, *line_no)?;
    }
}

// Feature: llm-probe, Property 1: Card parse round trip and integer-only numbers
// **Validates: Requirements 2.3, 2.9, 2.10**
#[test]
fn every_dev_card_round_trips() {
    let lines = dev_lines();
    assert_eq!(lines.len(), 34);
    for (line_no, text) in &lines {
        if let Err(e) = assert_round_trip(text, *line_no) {
            panic!("dev.jsonl line {line_no}: {e}");
        }
    }
}

// Feature: llm-probe, Property 1: Card parse round trip and integer-only numbers
// **Validates: Requirements 2.3, 2.9, 2.10**
#[test]
fn every_number_of_every_dev_card_rejects_a_fraction_or_exponent() {
    for (line_no, text) in &dev_lines() {
        let base = json::parse(text).expect("dev card is JSON");
        for pick in 0..number_count(&base) {
            for style in 0..6 {
                if let Err(e) = assert_non_integer_rejected(&base, pick, style, *line_no) {
                    panic!("dev.jsonl line {line_no}, number {pick}, style {style}: {e}");
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

/// Validates `raw` and checks the verdict is the legal one for `expected`.
fn assert_legal(ctx: &FrozenContext, raw: &str, expected: &Expected) -> Result<(), TestCaseError> {
    match (validate_raw(ctx, raw), expected) {
        (Verdict::Decision { option }, Expected::Option(want)) => {
            prop_assert_eq!(&option, want);
        }
        (
            Verdict::Synthesis {
                answer,
                missing_persons,
                missing_events,
            },
            Expected::Items(want),
        ) => {
            prop_assert_eq!(&answer, want);
            prop_assert!(missing_persons.is_empty(), "{:?}", missing_persons);
            prop_assert!(missing_events.is_empty(), "{:?}", missing_events);
        }
        (verdict, _) => prop_assert!(false, "unexpected verdict {:?} for {}", verdict, raw),
    }
    Ok(())
}

proptest! {
    // Feature: llm-probe, Property 2: Answers built from the context are legal
    // **Validates: Requirements 4.2, 4.3, 4.11**
    #[test]
    fn legal_answers_are_accepted(
        (ctx, answer) in arb_context_and_legal_answer()
    ) {
        assert_legal(&ctx, &answer.text, &answer.expected)?;
    }

    // Feature: llm-probe, Property 2: Answers built from the context are legal
    // **Validates: Requirements 4.2, 4.3, 4.11**
    #[test]
    fn fenced_and_whitespace_wrapped_legal_answers_are_accepted(
        (ctx, answer, wrapped) in arb_context_and_legal_answer().prop_flat_map(|(c, a)| {
            let w = arb_wrapped(a.text.clone());
            (Just(c), Just(a), w)
        })
    ) {
        assert_legal(&ctx, &wrapped, &answer.expected)?;
    }
}

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

/// One injected fault: the broken answer text and what the validator must say about it.
struct Fault {
    label: String,
    text: String,
    reason: IllegalReason,
    path: Option<String>,
}

fn fault(label: &str, text: String, reason: IllegalReason, path: Option<&str>) -> Fault {
    Fault {
        label: label.to_owned(),
        text,
        reason,
        path: path.map(str::to_owned),
    }
}

/// Faults that break the text itself, whatever the task: no field path.
fn text_faults(text: &str) -> Vec<Fault> {
    let pf = IllegalReason::ParseFailure;
    let mut cut = text.to_owned();
    cut.pop();
    vec![
        fault("truncated", cut, pf, None),
        fault("trailing text", format!("{text} x"), pf, None),
        fault(
            "leading prose",
            format!("Here is the answer: {text}"),
            pf,
            None,
        ),
        fault("two values", format!("{text}{text}"), pf, None),
        fault("empty", String::new(), pf, None),
        fault("unclosed fence", format!("```json\n{text}"), pf, None),
        fault(
            "unknown fence tag",
            format!("```xml\n{text}\n```"),
            pf,
            None,
        ),
        fault(
            "text after fence",
            format!("```\n{text}\n``` done"),
            pf,
            None,
        ),
        // Canonical text starts with `{` and its first member is `"items"` or `"option"`,
        // so the prepended member repeats a key.
        fault(
            "duplicate key",
            match text.strip_prefix('{') {
                Some(rest) if text.contains("\"option\"") => {
                    format!("{{\"option\":\"zz\",{rest}")
                }
                Some(rest) => format!("{{\"schema\":\"zz\",{rest}"),
                None => text.to_owned(),
            },
            pf,
            None,
        ),
    ]
}

/// Faults for a D answer `{"option": id}`.
fn decision_faults(ctx: &FrozenContext, text: &str, chosen: &str) -> Vec<Fault> {
    let TaskSpec::Decision { options } = &ctx.spec else {
        return Vec::new();
    };
    let mut out = text_faults(text);
    let wrong = |label: &str, text: &str, reason, path| fault(label, text.to_owned(), reason, path);
    out.push(wrong("array", "[]", IllegalReason::WrongType, Some("$")));
    out.push(wrong(
        "string",
        "\"a\"",
        IllegalReason::WrongType,
        Some("$"),
    ));
    out.push(wrong("null", "null", IllegalReason::WrongType, Some("$")));
    out.push(wrong(
        "empty object",
        "{}",
        IllegalReason::MissingRequiredField,
        Some("option"),
    ));
    out.push(wrong(
        "only an extra member",
        "{\"zz\":1}",
        IllegalReason::MissingRequiredField,
        Some("option"),
    ));
    out.push(fault(
        "extra member",
        format!("{{\"option\":\"{chosen}\",\"zz\":1}}"),
        IllegalReason::UnknownField,
        Some("zz"),
    ));
    for bad in ["1", "null", "true", "[]", "{}", "[\"a\"]"] {
        out.push(fault(
            "option not a string",
            format!("{{\"option\":{bad}}}"),
            IllegalReason::WrongType,
            Some("option"),
        ));
    }
    for outside in ["zz_out_of_set", "", "OPTION", "Z"] {
        if options.iter().all(|o| o.id.as_str() != outside) {
            out.push(fault(
                "out-of-set option",
                format!("{{\"option\":\"{outside}\"}}"),
                IllegalReason::OutOfSetOption,
                Some("option"),
            ));
        }
    }
    out
}

const NON_INTEGERS: [&str; 6] = ["1.5", "1e2", "2.0", "-0.5", "1E+2", "0e0"];
const OUT_OF_RANGE: [&str; 3] = [
    "99999999999999999999",
    "-99999999999999999999",
    "9223372036854775808",
];
const BAD_EVENT_IDS: [&str; 6] = ["x1", "e12345", "e", "E1", "", "e-1"];

fn as_object_mut(v: &mut Json) -> &mut std::collections::BTreeMap<String, Json> {
    match v {
        Json::Object(m) => m,
        _ => panic!("object expected"),
    }
}

/// Faults for an S answer, over every item and every member of each item.
fn synthesis_faults(text: &str, root: &Json) -> Vec<Fault> {
    use IllegalReason as R;
    let mut out = text_faults(text);
    let write = |v: &Json| json::write(v);
    let top = |f: &dyn Fn(&mut std::collections::BTreeMap<String, Json>)| {
        let mut r = root.clone();
        f(as_object_mut(&mut r));
        write(&r)
    };
    out.push(fault(
        "no schema",
        top(&|m| drop(m.remove("schema"))),
        R::MissingRequiredField,
        Some("schema"),
    ));
    out.push(fault(
        "no items",
        top(&|m| drop(m.remove("items"))),
        R::MissingRequiredField,
        Some("items"),
    ));
    out.push(fault(
        "unknown top member",
        top(&|m| drop(m.insert("zz_extra".into(), Json::Null))),
        R::UnknownField,
        Some("zz_extra"),
    ));
    out.push(fault(
        "schema not a string",
        top(&|m| drop(m.insert("schema".into(), Json::Bool(true)))),
        R::WrongType,
        Some("schema"),
    ));
    out.push(fault(
        "wrong schema const",
        top(&|m| drop(m.insert("schema".into(), Json::Str("zz_schema".into())))),
        R::WrongSchemaConst,
        Some("schema"),
    ));
    out.push(fault(
        "items not an array",
        top(&|m| drop(m.insert("items".into(), Json::Bool(true)))),
        R::WrongType,
        Some("items"),
    ));
    out.push(fault(
        "root array",
        "[]".to_owned(),
        R::WrongType,
        Some("$"),
    ));

    let Some(Json::Array(items)) = as_object_ref(root).get("items") else {
        return out;
    };
    for (i, item) in items.iter().enumerate() {
        let Json::Object(members) = item else {
            continue;
        };
        let item_edit = |f: &dyn Fn(&mut std::collections::BTreeMap<String, Json>)| {
            let mut r = root.clone();
            let Some(Json::Array(its)) = as_object_mut(&mut r).get_mut("items") else {
                panic!("items");
            };
            f(as_object_mut(its.get_mut(i).expect("item")));
            write(&r)
        };
        let at = |name: &str| format!("items[{i}].{name}");
        let ip = format!("items[{i}]");
        {
            let mut r = root.clone();
            let Some(Json::Array(its)) = as_object_mut(&mut r).get_mut("items") else {
                panic!("items");
            };
            *its.get_mut(i).expect("item") = Json::Bool(true);
            out.push(fault(
                "item not an object",
                write(&r),
                R::WrongType,
                Some(&ip),
            ));
        }
        out.push(fault(
            "unknown item member",
            item_edit(&|m| drop(m.insert("zz_extra".into(), Json::Null))),
            R::UnknownField,
            Some(&at("zz_extra")),
        ));
        for (name, value) in members {
            let n = name.clone();
            let p = at(name);
            out.push(fault(
                "missing member",
                item_edit(&|m| drop(m.remove(&n))),
                R::MissingRequiredField,
                Some(&p),
            ));
            out.push(fault(
                "member of the wrong JSON type",
                item_edit(&|m| drop(m.insert(n.clone(), Json::Bool(true)))),
                R::WrongType,
                Some(&p),
            ));
            if matches!(name.as_str(), "level" | "status" | "direction") {
                for bad in ["bogus", "", "HIGH"] {
                    out.push(fault(
                        "illegal enum value",
                        item_edit(&|m| drop(m.insert(n.clone(), Json::Str(bad.into())))),
                        R::IllegalEnumValue,
                        Some(&p),
                    ));
                }
            }
            if matches!(value, Json::Number(_)) {
                for bad in NON_INTEGERS {
                    out.push(fault(
                        "fraction or exponent",
                        item_edit(&|m| drop(m.insert(n.clone(), Json::Number(bad.into())))),
                        R::NonInteger,
                        Some(&p),
                    ));
                }
                for bad in OUT_OF_RANGE {
                    out.push(fault(
                        "integer outside i64",
                        item_edit(&|m| drop(m.insert(n.clone(), Json::Number(bad.into())))),
                        R::IntegerOutOfRange,
                        Some(&p),
                    ));
                }
                if name == "amount" {
                    out.push(fault(
                        "amount below its minimum",
                        item_edit(&|m| drop(m.insert(n.clone(), Json::int(-1)))),
                        R::IntegerOutOfRange,
                        Some(&p),
                    ));
                }
            }
            if matches!(
                name.as_str(),
                "origin_event" | "promise_event" | "turning_point"
            ) && matches!(value, Json::Str(_))
            {
                for bad in BAD_EVENT_IDS {
                    out.push(fault(
                        "malformed event ID",
                        item_edit(&|m| drop(m.insert(n.clone(), Json::Str(bad.into())))),
                        R::MalformedEventId,
                        Some(&p),
                    ));
                }
            }
            if name == "evidence" {
                let Json::Array(ev) = value else { continue };
                out.push(fault(
                    "evidence not an array",
                    item_edit(&|m| drop(m.insert(n.clone(), Json::Str("e1".into())))),
                    R::WrongType,
                    Some(&p),
                ));
                out.push(fault(
                    "empty evidence",
                    item_edit(&|m| drop(m.insert(n.clone(), Json::Array(Vec::new())))),
                    R::EmptyEvidence,
                    Some(&p),
                ));
                for (j, entry) in ev.iter().enumerate() {
                    let ep = format!("{p}[{j}]");
                    for bad in BAD_EVENT_IDS {
                        out.push(fault(
                            "malformed evidence entry",
                            item_edit(&|m| set_evidence(m, j, Json::Str(bad.into()))),
                            R::MalformedEventId,
                            Some(&ep),
                        ));
                    }
                    out.push(fault(
                        "evidence entry of the wrong JSON type",
                        item_edit(&|m| set_evidence(m, j, Json::int(5))),
                        R::WrongType,
                        Some(&ep),
                    ));
                    // The copy lands after the whole list: the first duplicate is at `ev.len()`.
                    out.push(fault(
                        "duplicate evidence ID",
                        item_edit(&|m| {
                            if let Some(Json::Array(list)) = m.get_mut("evidence") {
                                list.push(entry.clone());
                            }
                        }),
                        R::DuplicateEvidence,
                        Some(&format!("{p}[{}]", ev.len())),
                    ));
                }
            }
        }
    }
    out
}

fn as_object_ref(v: &Json) -> &std::collections::BTreeMap<String, Json> {
    match v {
        Json::Object(m) => m,
        _ => panic!("object expected"),
    }
}

fn set_evidence(m: &mut std::collections::BTreeMap<String, Json>, j: usize, v: Json) {
    if let Some(Json::Array(list)) = m.get_mut("evidence")
        && let Some(slot) = list.get_mut(j)
    {
        *slot = v;
    }
}

fn assert_fault_verdicts(ctx: &FrozenContext, faults: &[Fault]) -> Result<(), TestCaseError> {
    for f in faults {
        let want = Verdict::Illegal {
            reason: f.reason,
            path: f.path.clone(),
        };
        let got = validate_raw(ctx, &f.text);
        prop_assert_eq!(&got, &want, "fault `{}` on {}", f.label, f.text);
    }
    Ok(())
}

proptest! {
    // Feature: llm-probe, Property 3: One injected fault gives its own reason code and path
    // **Validates: Requirements 4.4, 4.5, 4.6, 4.12, 4.14, 4.15**
    #[test]
    fn one_fault_in_a_decision_answer_gives_its_reason_and_path(
        (ctx, answer) in arb_decision_context().prop_flat_map(|c| {
            let a = arb_legal_answer(&c);
            (Just(c), a)
        })
    ) {
        let Expected::Option(chosen) = &answer.expected else {
            return Err(TestCaseError::fail("decision context, non-decision answer"));
        };
        assert_legal(&ctx, &answer.text, &answer.expected)?;
        let faults = decision_faults(&ctx, &answer.text, chosen.as_str());
        assert_fault_verdicts(&ctx, &faults)?;
    }

    // Feature: llm-probe, Property 3: One injected fault gives its own reason code and path
    // **Validates: Requirements 4.4, 4.5, 4.6, 4.12, 4.14, 4.15**
    #[test]
    fn one_fault_in_a_synthesis_answer_gives_its_reason_and_path(
        (ctx, answer) in arb_synthesis_context().prop_flat_map(|c| {
            let a = arb_legal_answer(&c);
            (Just(c), a)
        })
    ) {
        assert_legal(&ctx, &answer.text, &answer.expected)?;
        let root = json::parse(&answer.text).map_err(|e| TestCaseError::fail(e.detail.to_owned()))?;
        let faults = synthesis_faults(&answer.text, &root);
        assert_fault_verdicts(&ctx, &faults)?;
    }
}

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

const PERSON_FIELDS: [&str; 9] = [
    "from",
    "to",
    "debtor",
    "creditor",
    "transferred_from",
    "promisor",
    "promisee",
    "a",
    "b",
];
const EVENT_FIELDS: [&str; 3] = ["origin_event", "promise_event", "turning_point"];

/// Replaces some person and event references of a legal S answer with well-formed IDs
/// that the context does not contain. Returns the new text and the injected IDs.
fn inject_absent_references(
    ctx: &FrozenContext,
    text: &str,
    picks: &[(bool, u32)],
) -> Result<(String, BTreeSet<i64>, BTreeSet<String>), TestCaseError> {
    let known_p: BTreeSet<i64> = ctx.people.iter().map(|p| p.id.0).collect();
    let known_e: BTreeSet<&str> = ctx.events.iter().map(|e| e.id.as_str()).collect();
    let mut root = json::parse(text).map_err(|e| TestCaseError::fail(e.detail.to_owned()))?;
    let (mut ps, mut es) = (BTreeSet::new(), BTreeSet::new());
    let mut next = picks.iter().cycle();
    let Json::Object(top) = &mut root else {
        return Err(TestCaseError::fail("answer is not an object"));
    };
    if let Some(Json::Array(items)) = top.get_mut("items") {
        for item in items {
            let Json::Object(m) = item else {
                return Err(TestCaseError::fail("item is not an object"));
            };
            for (name, value) in m.iter_mut() {
                let &(inject, raw) = next.next().unwrap_or(&(false, 0));
                if !inject {
                    continue;
                }
                if PERSON_FIELDS.contains(&name.as_str()) {
                    // Small pool so that duplicates across items occur.
                    let mut id = 1_000 + i64::from(raw % 6) - if raw % 5 == 0 { 2_000 } else { 0 };
                    while known_p.contains(&id) {
                        id += 7;
                    }
                    *value = Json::Number(id.to_string());
                    ps.insert(id);
                } else if EVENT_FIELDS.contains(&name.as_str()) {
                    let id = absent_event(&known_e, raw, &[]);
                    *value = Json::Str(id.clone());
                    es.insert(id);
                } else if name == "evidence"
                    && let Json::Array(list) = value
                    && !list.is_empty()
                {
                    let at = raw as usize % list.len();
                    let others: Vec<String> = list
                        .iter()
                        .enumerate()
                        .filter(|(j, _)| *j != at)
                        .filter_map(|(_, v)| match v {
                            Json::Str(s) => Some(s.clone()),
                            _ => None,
                        })
                        .collect();
                    let id = absent_event(&known_e, raw / 7, &others);
                    if let Some(slot) = list.get_mut(at) {
                        *slot = Json::Str(id.clone());
                    }
                    es.insert(id);
                }
            }
        }
    }
    Ok((json::write(&root), ps, es))
}

/// A well-formed event ID outside the context and outside `avoid`, from a small pool.
fn absent_event(known: &BTreeSet<&str>, raw: u32, avoid: &[String]) -> String {
    let mut n = 5_000 + raw % 6;
    loop {
        let id = format!("e{n}");
        if !known.contains(id.as_str()) && !avoid.contains(&id) {
            return id;
        }
        n += 1;
    }
}

proptest! {
    // Feature: llm-probe, Property 4: Missing-reference lists are exact
    // **Validates: Requirements 4.7**
    #[test]
    fn missing_reference_lists_equal_the_injected_absent_ids(
        (ctx, answer) in arb_synthesis_context().prop_flat_map(|c| {
            let a = arb_legal_answer(&c);
            (Just(c), a)
        }),
        picks in proptest::collection::vec((any::<bool>(), any::<u32>()), 1..40),
        inject_any in any::<bool>(),
    ) {
        let picks: Vec<(bool, u32)> = if inject_any {
            picks
        } else {
            picks.into_iter().map(|(_, r)| (false, r)).collect()
        };
        let (text, want_p, want_e) = inject_absent_references(&ctx, &answer.text, &picks)?;
        match validate_raw(&ctx, &text) {
            Verdict::Synthesis { missing_persons, missing_events, .. } => {
                prop_assert_eq!(missing_persons, want_p.into_iter().collect::<Vec<_>>());
                prop_assert_eq!(missing_events, want_e.into_iter().collect::<Vec<_>>());
            }
            other => prop_assert!(false, "unexpected verdict {:?} for {}", other, text),
        }
    }
}

// ---------------------------------------------------------------------------
// Property 5
// ---------------------------------------------------------------------------

/// Validates `raw` twice, failing on a panic or when the two verdicts differ.
fn assert_total_and_deterministic(ctx: &FrozenContext, raw: &str) -> Result<(), TestCaseError> {
    let run = || std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| validate_raw(ctx, raw)));
    let first = run();
    let second = run();
    prop_assert!(first.is_ok() && second.is_ok(), "validate_raw panicked");
    let (a, b) = (
        first.unwrap_or_else(|_| unreachable!()),
        second.unwrap_or_else(|_| unreachable!()),
    );
    prop_assert_eq!(format!("{a:?}"), format!("{b:?}"));
    prop_assert!(a == b, "verdicts differ");
    Ok(())
}

/// Truncates, splices or overwrites a legal answer at positions chosen by `seeds`.
fn mutate(text: &str, seeds: &[(u8, u32, char)]) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    for &(kind, at, ch) in seeds {
        if chars.is_empty() {
            chars.push(ch);
            continue;
        }
        let i = at as usize % chars.len();
        match kind % 4 {
            0 => chars.truncate(i),
            1 => chars[i] = ch,
            2 => chars.insert(i, ch),
            _ => {
                chars.remove(i);
            }
        }
    }
    chars.into_iter().collect()
}

proptest! {
    // Feature: llm-probe, Property 5: The validator is total and deterministic
    // **Validates: Requirements 4.8, 4.13, 5.2, 6.6**
    #[test]
    fn arbitrary_text_gets_the_same_verdict_twice_without_panic(
        ctx in arb_context(),
        raw in prop_oneof![
            any::<String>(),
            "[\\x00-\\x1f\\x7f\\u{80}-\\u{10FFFF}\\[\\]\\{\\}\":,0-9a-z\\\\ `-]{0,200}",
            "(\\{\"[a-z_]{0,8}\": ?[\\[\\{\"0-9a-z]{0,6}[,\\}\\]]?){0,12}",
        ],
    ) {
        assert_total_and_deterministic(&ctx, &raw)?;
    }

    // Feature: llm-probe, Property 5: The validator is total and deterministic
    // **Validates: Requirements 4.8, 4.13, 5.2, 6.6**
    #[test]
    fn truncated_and_mutated_legal_answers_get_the_same_verdict_twice(
        (ctx, answer) in arb_context_and_legal_answer(),
        seeds in proptest::collection::vec(
            (any::<u8>(), any::<u32>(), any::<char>()), 0..6),
    ) {
        let raw = mutate(&answer.text, &seeds);
        assert_total_and_deterministic(&ctx, &raw)?;
    }
}

// Feature: llm-probe, Property 5: The validator is total and deterministic
// **Validates: Requirements 4.8, 4.13, 5.2, 6.6**
#[test]
fn big_and_deeply_nested_inputs_are_total_and_deterministic() {
    let mut runner = TestRunner::deterministic();
    let ctxs: Vec<FrozenContext> = (0..2)
        .map(|i| {
            let s = if i == 0 {
                arb_decision_context()
            } else {
                arb_synthesis_context()
            };
            s.new_tree(&mut runner).expect("context").current()
        })
        .collect();
    let depth = 10_000usize;
    let mib = 1_048_576usize;
    let mut inputs: Vec<String> = vec![
        "[".repeat(depth),
        "[".repeat(depth * 10),
        format!("{}{}", "[".repeat(depth), "]".repeat(depth)),
        format!("{}0{}", "[".repeat(depth), "]".repeat(depth)),
        "{\"a\":".repeat(depth) + "1" + &"}".repeat(depth),
        format!("{{\"chosen\":{}}}", "[".repeat(depth)),
        format!("```json\n{}\n```", "[".repeat(depth)),
        "x".repeat(mib),
        "\u{1F600}".repeat(mib / 4 + 1),
        "\0".repeat(mib),
        format!("\"{}\"", "a".repeat(mib)),
        format!("[{}0]", "0,".repeat(mib / 2)),
        format!("{{\"chosen\":\"{}\"}}", "z".repeat(mib)),
        format!("{}{}", "[".repeat(mib), "]".repeat(mib)),
    ];
    inputs.push("{".repeat(mib));
    assert!(inputs.iter().any(|s| s.len() >= mib));
    for ctx in &ctxs {
        for raw in &inputs {
            let run = || std::panic::catch_unwind(|| validate_raw(ctx, raw));
            let a = run().expect("validate_raw panicked on a big input");
            let b = run().expect("validate_raw panicked on a big input");
            assert_eq!(a, b);
        }
    }
}

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

/// Parses `raw` with `validate_raw` and returns the typed S answer.
fn parse_synthesis(
    ctx: &FrozenContext,
    raw: &str,
) -> Result<sim_core::llm::SynthesisAnswer, TestCaseError> {
    match validate_raw(ctx, raw) {
        Verdict::Synthesis { answer, .. } => Ok(answer),
        other => Err(TestCaseError::fail(format!(
            "expected a synthesis verdict, got {other:?} for {raw}"
        ))),
    }
}

proptest! {
    // Feature: llm-probe, Property 6: Canonical round trip of S answers
    // **Validates: Requirements 4.10**
    #[test]
    fn canonical_round_trip_of_s_answers(
        (ctx, legal) in arb_synthesis_context().prop_flat_map(|ctx| {
            let answers = arb_legal_synthesis_answer(&ctx);
            (Just(ctx), answers)
        }),
        wrapper_seed in any::<u8>(),
    ) {
        let first = parse_synthesis(&ctx, &legal.text)?;
        let canonical = sim_core::llm::answer::canonical(&first);
        let second = parse_synthesis(&ctx, &canonical)?;
        prop_assert_eq!(&first, &second);
        // The canonical text is a fixed point.
        prop_assert_eq!(&sim_core::llm::answer::canonical(&second), &canonical);
        // A fenced or whitespace-wrapped form of the same answer parses to the same value.
        let wrapped = match wrapper_seed % 3 {
            0 => format!("```json\n{}\n```", legal.text),
            1 => format!("  \n{}\n\t", legal.text),
            _ => legal.text.clone(),
        };
        prop_assert_eq!(&parse_synthesis(&ctx, &wrapped)?, &first);
    }
}
