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
use sim_core::llm::card::{CardMeta, Split};
use sim_core::llm::grade::{grade, identity};
use sim_core::llm::json::{self, Json};
use sim_core::llm::render::{Permutation, permutations, render};
use sim_core::llm::validate::validate_raw;
use sim_core::llm::{
    AnswerKey, FrozenContext, IdentityValue, IllegalReason, Task, TaskSpec, Verdict,
};

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

const ALL_ILLEGAL_REASONS: [IllegalReason; 14] = [
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

proptest! {
    // Feature: llm-probe, Property 7: D and Illegal grades follow set membership
    // **Validates: Requirements 5.3, 5.4, 8.5**
    #[test]
    fn d_grades_follow_set_membership(
        (ctx, key, pick) in arb_decision_case().prop_flat_map(|(ctx, key)| {
            let n = match &ctx.spec {
                TaskSpec::Decision { options } => options.len(),
                TaskSpec::Synthesis { .. } => unreachable!("decision case"),
            };
            (Just(ctx), Just(key), 0..n)
        })
    ) {
        let (TaskSpec::Decision { options }, AnswerKey::Decision { acceptable, severe }) =
            (&ctx.spec, &key)
        else {
            return Err(TestCaseError::fail("expected a decision case"));
        };
        let option = options[pick].id.clone();
        let verdict = Verdict::Decision { option: option.clone() };
        let g = grade("p7", &verdict, &key).map_err(|e| TestCaseError::fail(e.to_string()))?;
        prop_assert_eq!(g.acceptable, acceptable.contains(&option));
        prop_assert_eq!(g.severe, severe.contains(&option));
        prop_assert!(!g.illegal);
        prop_assert!(g.severe_conditions.is_empty());
    }

    // Feature: llm-probe, Property 7: D and Illegal grades follow set membership
    // **Validates: Requirements 5.3, 5.4, 8.5**
    #[test]
    fn illegal_grades_are_never_acceptable_or_severe(
        (_ctx, key) in arb_case(),
        reason_ix in 0..ALL_ILLEGAL_REASONS.len(),
        path in proptest::option::of("[a-z_.\\[\\]0-9]{0,12}"),
    ) {
        let verdict = Verdict::Illegal { reason: ALL_ILLEGAL_REASONS[reason_ix], path };
        let g = grade("p7", &verdict, &key).map_err(|e| TestCaseError::fail(e.to_string()))?;
        prop_assert!(!g.acceptable);
        prop_assert!(!g.severe);
        prop_assert!(g.illegal);
        prop_assert!(g.severe_conditions.is_empty());
        prop_assert_eq!(identity(&verdict), IdentityValue::Invalid);
    }
}

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

use sim_core::llm::grade::GradeError;
use sim_core::llm::{
    EventId, Grade, OutputSchema, Pattern, PatternValue, Scalar, SevereCondition, SynthesisAnswer,
};

/// All seven severe conditions in the declared order, written out here on purpose.
const REF_CONDITIONS: [SevereCondition; 7] = [
    SevereCondition::InventedEventId,
    SevereCondition::InventedPerson,
    SevereCondition::SelfReference,
    SevereCondition::ReversedDirection,
    SevereCondition::DeadPersonAsActorAfterDeath,
    SevereCondition::ContradictsFact,
    SevereCondition::WrongDebtHolder,
];

/// One answer item as the reference model sees it: field name and value pairs, the
/// evidence IDs as text, and the two person fields.
struct RefItem {
    fields: Vec<(&'static str, Scalar)>,
    evidence: Vec<String>,
    people: (i64, i64),
}

fn ref_ids(ids: &[EventId]) -> Vec<String> {
    ids.iter().map(|e| e.as_str().to_owned()).collect()
}

fn ref_event(e: &EventId) -> Scalar {
    Scalar::Str(e.as_str().to_owned())
}

fn ref_items(answer: &SynthesisAnswer) -> Vec<RefItem> {
    let s = |t: &str| Scalar::Str(t.to_owned());
    match answer {
        SynthesisAnswer::Grudge(v) => v
            .iter()
            .map(|i| RefItem {
                fields: vec![
                    ("from", Scalar::Int(i.from)),
                    ("to", Scalar::Int(i.to)),
                    ("level", s(level_name(i.level))),
                ],
                evidence: ref_ids(&i.evidence),
                people: (i.from, i.to),
            })
            .collect(),
        SynthesisAnswer::DebtChain(v) => v
            .iter()
            .map(|i| RefItem {
                fields: vec![
                    ("debtor", Scalar::Int(i.debtor)),
                    ("creditor", Scalar::Int(i.creditor)),
                    ("amount", Scalar::Int(i.amount)),
                    ("status", s(debt_status_name(i.status))),
                    ("origin_event", ref_event(&i.origin_event)),
                    (
                        "transferred_from",
                        match i.transferred_from {
                            Some(p) => Scalar::Int(p),
                            None => Scalar::Null,
                        },
                    ),
                ],
                evidence: ref_ids(&i.evidence),
                people: (i.debtor, i.creditor),
            })
            .collect(),
        SynthesisAnswer::BrokenPromise(v) => v
            .iter()
            .map(|i| RefItem {
                fields: vec![
                    ("promisor", Scalar::Int(i.promisor)),
                    ("promisee", Scalar::Int(i.promisee)),
                    ("promise_event", ref_event(&i.promise_event)),
                    ("status", s(promise_status_name(i.status))),
                ],
                evidence: ref_ids(&i.evidence),
                people: (i.promisor, i.promisee),
            })
            .collect(),
        SynthesisAnswer::RelationshipShift(v) => v
            .iter()
            .map(|i| RefItem {
                fields: vec![
                    ("a", Scalar::Int(i.a)),
                    ("b", Scalar::Int(i.b)),
                    ("direction", s(direction_name(i.direction))),
                    (
                        "turning_point",
                        match &i.turning_point {
                            Some(e) => ref_event(e),
                            None => Scalar::Null,
                        },
                    ),
                ],
                evidence: ref_ids(&i.evidence),
                people: (i.a, i.b),
            })
            .collect(),
    }
}

/// The pattern fields each schema allows (README of the cards).
fn ref_allowed(schema: OutputSchema) -> &'static [&'static str] {
    match schema {
        OutputSchema::GrudgeV1 => &["from", "to", "level"],
        OutputSchema::DebtChainV1 => &[
            "debtor",
            "creditor",
            "amount",
            "status",
            "origin_event",
            "transferred_from",
        ],
        OutputSchema::BrokenPromiseV1 => &["promisor", "promisee", "promise_event", "status"],
        OutputSchema::RelationshipShiftV1 => &["a", "b", "direction", "turning_point"],
    }
}

fn ref_value_ok(want: &PatternValue, got: &Scalar) -> bool {
    match want {
        PatternValue::Exact(x) => x == got,
        PatternValue::AnyOf(list) => list.iter().any(|x| x == got),
    }
}

/// Whether the pattern, with its keys read as given or with `a` and `b` exchanged,
/// holds on the item's fields.
fn ref_fields_hold(p: &Pattern, item: &RefItem, exchange_a_b: bool) -> bool {
    p.fields.iter().all(|(key, want)| {
        let key = match (exchange_a_b, key.as_str()) {
            (true, "a") => "b",
            (true, "b") => "a",
            (_, k) => k,
        };
        item.fields
            .iter()
            .any(|(name, got)| *name == key && ref_value_ok(want, got))
    })
}

/// Pattern_Match; `allow_swap` is the relationship_shift_v1 rule.
fn ref_matches(p: &Pattern, item: &RefItem, allow_swap: bool) -> bool {
    let evidence_ok = match &p.evidence_any {
        None => true,
        Some(set) => item
            .evidence
            .iter()
            .any(|e| set.iter().any(|w| w.as_str() == e)),
    };
    evidence_ok
        && (ref_fields_hold(p, item, false) || (allow_swap && ref_fields_hold(p, item, true)))
}

fn ref_any(p: &Pattern, items: &[RefItem], allow_swap: bool) -> bool {
    items.iter().any(|i| ref_matches(p, i, allow_swap))
}

fn ref_acceptable(include: &[Pattern], exclude: &[Pattern], items: &[RefItem], swap: bool) -> bool {
    let mut ok = true;
    for p in include {
        ok &= ref_any(p, items, swap);
    }
    for p in exclude {
        ok &= !ref_any(p, items, swap);
    }
    ok
}

/// The reference grade of a synthesis verdict, or the entry of the first faulty
/// pattern field.
fn ref_grade(
    schema: OutputSchema,
    answer: &SynthesisAnswer,
    missing_persons: &[i64],
    missing_events: &[String],
    key: &AnswerKey,
) -> Result<Grade, String> {
    let AnswerKey::Synthesis {
        must_include,
        must_not_include,
        severe_conditions,
        severe_patterns,
        ..
    } = key
    else {
        return Err("not a synthesis key".to_owned());
    };
    let allowed = ref_allowed(schema);
    let lists: [(&str, Vec<&Pattern>); 3] = [
        ("must_include", must_include.iter().collect()),
        ("must_not_include", must_not_include.iter().collect()),
        (
            "severe_patterns",
            severe_patterns.iter().map(|(_, p)| p).collect(),
        ),
    ];
    for (name, list) in &lists {
        for (i, p) in list.iter().enumerate() {
            if let Some(k) = p.fields.keys().find(|k| !allowed.contains(&k.as_str())) {
                return Err(format!("{name}[{i}].{k}"));
            }
        }
    }
    let swap = schema == OutputSchema::RelationshipShiftV1;
    let items = ref_items(answer);
    let raised: Vec<SevereCondition> = REF_CONDITIONS
        .iter()
        .copied()
        .filter(|c| {
            let automatic = match c {
                SevereCondition::InventedEventId => !missing_events.is_empty(),
                SevereCondition::InventedPerson => !missing_persons.is_empty(),
                SevereCondition::SelfReference => items.iter().any(|i| i.people.0 == i.people.1),
                _ => false,
            };
            let by_pattern = severe_patterns
                .iter()
                .any(|(sc, p)| sc == c && ref_any(p, &items, swap));
            severe_conditions.contains(c) && (automatic || by_pattern)
        })
        .collect();
    Ok(Grade {
        acceptable: ref_acceptable(must_include, must_not_include, &items, swap),
        severe: !raised.is_empty(),
        illegal: false,
        severe_conditions: raised,
    })
}

/// Raw draw for one pattern derived from an item of the answer:
/// (target list, condition pick, item pick, field mask, perturbation, swap a/b,
/// evidence mode, evidence pick).
type DerivedRaw = (u8, usize, usize, [bool; 6], u8, bool, u8, usize);

fn derived_raw() -> impl Strategy<Value = DerivedRaw> {
    (
        0u8..3,
        0usize..7,
        0usize..8,
        prop::array::uniform6(any::<bool>()),
        prop_oneof![4 => Just(0u8), 1 => Just(1u8), 1 => Just(2u8), 1 => Just(3u8)],
        any::<bool>(),
        prop_oneof![3 => Just(0u8), 1 => Just(1u8), 1 => Just(2u8)],
        0usize..8,
    )
}

fn other_scalar(v: &Scalar, step: i64, tag: &str) -> Scalar {
    match v {
        Scalar::Int(n) => Scalar::Int(n + step),
        Scalar::Str(s) => Scalar::Str(format!("{s}{tag}")),
        Scalar::Null => Scalar::Int(step - 1),
    }
}

/// A pattern read off `item`, then possibly bent: a changed value, a "one of" list with
/// or without the real value, `a` and `b` exchanged, an `evidence_any` that does or
/// does not meet the item's evidence.
fn derive_pattern(ctx: &FrozenContext, item: &RefItem, raw: &DerivedRaw) -> Pattern {
    let (_, _, _, mask, perturb, swap, ev_mode, pick) = raw;
    let mut chosen: Vec<(String, PatternValue)> = item
        .fields
        .iter()
        .enumerate()
        .filter(|(i, _)| mask[i % mask.len()])
        .map(|(_, (n, v))| ((*n).to_owned(), PatternValue::Exact(v.clone())))
        .collect();
    if chosen.is_empty()
        && let Some((n, v)) = item.fields.first()
    {
        chosen.push(((*n).to_owned(), PatternValue::Exact(v.clone())));
    }
    if let Some((name, value)) = chosen.first().cloned() {
        let PatternValue::Exact(real) = value else {
            unreachable!("derived values start exact");
        };
        let new_value = match perturb {
            1 => PatternValue::Exact(other_scalar(&real, 1, "x")),
            2 => PatternValue::AnyOf(vec![other_scalar(&real, 1, "x"), real.clone()]),
            3 => PatternValue::AnyOf(vec![
                other_scalar(&real, 1, "x"),
                other_scalar(&real, 2, "y"),
            ]),
            _ => PatternValue::Exact(real),
        };
        chosen[0] = (name, new_value);
    }
    let rename = |k: String| match (*swap, k.as_str()) {
        (true, "a") => "b".to_owned(),
        (true, "b") => "a".to_owned(),
        _ => k,
    };
    let fields = chosen.into_iter().map(|(k, v)| (rename(k), v)).collect();
    let evidence_any = match ev_mode {
        1 if !item.evidence.is_empty() => {
            let id = &item.evidence[pick % item.evidence.len()];
            EventId::new(id).map(|e| [e].into_iter().collect())
        }
        2 => {
            let outside: Vec<&EventId> = ctx
                .events
                .iter()
                .map(|e| &e.id)
                .filter(|e| !item.evidence.iter().any(|x| x == e.as_str()))
                .collect();
            if outside.is_empty() {
                EventId::new("e10").map(|e| [e].into_iter().collect())
            } else {
                Some(
                    [outside[pick % outside.len()].clone()]
                        .into_iter()
                        .collect(),
                )
            }
        }
        _ => None,
    };
    Pattern {
        fields,
        evidence_any,
    }
}

/// An S verdict and its answer key, ready to grade.
#[derive(Debug, Clone)]
struct SCase {
    schema: OutputSchema,
    answer: SynthesisAnswer,
    missing_persons: Vec<i64>,
    missing_events: Vec<String>,
    key: AnswerKey,
}

impl SCase {
    fn verdict(&self) -> Verdict {
        Verdict::Synthesis {
            answer: self.answer.clone(),
            missing_persons: self.missing_persons.clone(),
            missing_events: self.missing_events.clone(),
        }
    }
}

/// Makes item `idx` name the same person twice (the second person field copies the first).
fn make_self_reference(answer: &mut SynthesisAnswer, idx: usize) {
    match answer {
        SynthesisAnswer::Grudge(v) => v.iter_mut().skip(idx).take(1).for_each(|i| i.to = i.from),
        SynthesisAnswer::DebtChain(v) => v
            .iter_mut()
            .skip(idx)
            .take(1)
            .for_each(|i| i.creditor = i.debtor),
        SynthesisAnswer::BrokenPromise(v) => v
            .iter_mut()
            .skip(idx)
            .take(1)
            .for_each(|i| i.promisee = i.promisor),
        SynthesisAnswer::RelationshipShift(v) => {
            v.iter_mut().skip(idx).take(1).for_each(|i| i.b = i.a)
        }
    }
}

type SCaseRaw = (
    FrozenContext,
    LegalAnswer,
    AnswerKey,
    Vec<DerivedRaw>,
    Vec<bool>,
    Vec<i64>,
    Vec<u8>,
    bool,
);

fn build_s_case(raw: SCaseRaw) -> SCase {
    let (ctx, legal, mut key, derived, self_ref, miss_p, miss_e, keep_random) = raw;
    let TaskSpec::Synthesis { schema } = &ctx.spec else {
        unreachable!("synthesis context");
    };
    let Expected::Items(mut answer) = legal.expected else {
        unreachable!("synthesis answer");
    };
    for (i, on) in self_ref.iter().enumerate() {
        if *on {
            make_self_reference(&mut answer, i);
        }
    }
    let mut missing_persons = miss_p;
    missing_persons.sort_unstable();
    missing_persons.dedup();
    let mut missing_events: Vec<String> = miss_e
        .iter()
        .map(|n| format!("e{}", 9000 + u32::from(*n)))
        .collect();
    missing_events.sort();
    missing_events.dedup();

    if let AnswerKey::Synthesis {
        must_include,
        must_not_include,
        severe_conditions,
        severe_patterns,
        ..
    } = &mut key
    {
        if !keep_random {
            must_include.clear();
            must_not_include.clear();
            severe_patterns.clear();
        }
        let items = ref_items(&answer);
        let listed: Vec<SevereCondition> = severe_conditions.iter().copied().collect();
        if !items.is_empty() {
            for d in &derived {
                let p = derive_pattern(&ctx, &items[d.2 % items.len()], d);
                match d.0 {
                    0 => must_include.push(p),
                    1 => must_not_include.push(p),
                    _ if !listed.is_empty() => {
                        severe_patterns.push((listed[d.1 % listed.len()], p))
                    }
                    _ => {}
                }
            }
        }
    }
    SCase {
        schema: *schema,
        answer,
        missing_persons,
        missing_events,
        key,
    }
}

fn arb_s_case() -> BoxedStrategy<SCase> {
    arb_synthesis_context()
        .prop_flat_map(|ctx| {
            let legal = arb_legal_synthesis_answer(&ctx);
            let key = arb_key(&ctx);
            (
                Just(ctx),
                legal,
                key,
                prop::collection::vec(derived_raw(), 0..=5),
                prop::collection::vec(prop_oneof![4 => Just(false), 1 => Just(true)], 0..=4),
                prop_oneof![4 => Just(Vec::new()), 1 => prop::collection::vec(100i64..=103, 1..=2)],
                prop_oneof![4 => Just(Vec::new()), 1 => prop::collection::vec(0u8..3, 1..=2)],
                prop_oneof![1 => Just(true), 3 => Just(false)],
            )
        })
        .prop_map(build_s_case)
        .boxed()
}

proptest! {
    // Feature: llm-probe, Property 8: S grades agree with a reference model
    // **Validates: Requirements 5.5, 5.6, 5.7, 5.8, 5.11**
    #[test]
    fn s_grades_agree_with_the_reference_model(case in arb_s_case()) {
        let got = grade("p8", &case.verdict(), &case.key)
            .map_err(|e| TestCaseError::fail(e.to_string()))?;
        let want = ref_grade(
            case.schema,
            &case.answer,
            &case.missing_persons,
            &case.missing_events,
            &case.key,
        )
        .map_err(TestCaseError::fail)?;
        prop_assert_eq!(&got, &want);
        // The condition list is in SevereCondition order, each condition once.
        prop_assert!(got.severe_conditions.windows(2).all(|w| w[0] < w[1]));
        prop_assert_eq!(got.severe, !got.severe_conditions.is_empty());
    }

    // Feature: llm-probe, Property 8: S grades agree with a reference model
    // **Validates: Requirements 5.5, 5.6, 5.7, 5.8, 5.11**
    #[test]
    fn a_pattern_field_outside_the_schema_is_an_error_naming_card_and_entry(
        case in arb_s_case(),
        target in 0u8..3,
        entry_pick in 0usize..4,
        name_pick in 0usize..6,
    ) {
        const STRANGERS: [&str; 6] = ["colour", "debtor", "level", "a", "evidence", "reason"];
        let allowed = ref_allowed(case.schema);
        let mut case = case;
        let stranger = (0..STRANGERS.len())
            .map(|k| STRANGERS[(name_pick + k) % STRANGERS.len()])
            .find(|n| !allowed.contains(n))
            .unwrap_or("colour");
        let bad = Pattern {
            fields: [(stranger.to_owned(), PatternValue::Exact(Scalar::Int(1)))]
                .into_iter()
                .collect(),
            evidence_any: None,
        };
        let AnswerKey::Synthesis { must_include, must_not_include, severe_conditions, severe_patterns, .. } =
            &mut case.key
        else {
            return Err(TestCaseError::fail("synthesis key"));
        };
        let at = match target {
            0 => {
                must_include.push(bad.clone());
                entry_pick % must_include.len()
            }
            1 => {
                must_not_include.push(bad.clone());
                entry_pick % must_not_include.len()
            }
            _ => {
                severe_conditions.insert(SevereCondition::ContradictsFact);
                severe_patterns.push((SevereCondition::ContradictsFact, bad.clone()));
                entry_pick % severe_patterns.len()
            }
        };
        // Put the faulty pattern at the chosen position of its list.
        let last_ix = match target {
            0 => must_include.len() - 1,
            1 => must_not_include.len() - 1,
            _ => severe_patterns.len() - 1,
        };
        match target {
            0 => must_include.swap(at, last_ix),
            1 => must_not_include.swap(at, last_ix),
            _ => severe_patterns.swap(at, last_ix),
        }
        let want = match ref_grade(case.schema, &case.answer, &case.missing_persons, &case.missing_events, &case.key) {
            Err(entry) => entry,
            Ok(g) => return Err(TestCaseError::fail(format!("reference accepted a faulty key: {g:?}"))),
        };
        let got = grade("p8-err", &case.verdict(), &case.key);
        match got {
            Err(GradeError { card_id, entry, .. }) => {
                prop_assert_eq!(card_id, "p8-err".to_owned());
                prop_assert_eq!(entry, want);
            }
            Ok(g) => prop_assert!(false, "a faulty key gave a Grade: {:?}", g),
        }
    }
}

/// The generator reaches the cases the property is about: `must_not_include` that fires
/// and flips `acceptable`, that is present but quiet, swapped `a`/`b` matches,
/// `evidence_any` meeting and missing the evidence, and every automatic and pattern
/// severe condition.
#[test]
fn s_case_generator_covers_the_grading_rules() {
    let mut runner = TestRunner::deterministic();
    let strategy = arb_s_case();
    let (mut flips, mut quiet, mut swapped_only, mut ev_hit, mut ev_miss) = (0, 0, 0, 0, 0);
    let (mut by_pattern, mut auto_invented, mut auto_self, mut unlisted) = (0, 0, 0, 0);
    let mut condition_lists = BTreeSet::new();
    for _ in 0..1500 {
        let case = strategy.new_tree(&mut runner).expect("tree").current();
        let AnswerKey::Synthesis {
            must_include,
            must_not_include,
            severe_conditions,
            severe_patterns,
            ..
        } = &case.key
        else {
            panic!("synthesis key");
        };
        let items = ref_items(&case.answer);
        let swap = case.schema == OutputSchema::RelationshipShiftV1;
        let full = ref_acceptable(must_include, must_not_include, &items, swap);
        let without = ref_acceptable(must_include, &[], &items, swap);
        flips += usize::from(without && !full);
        quiet += usize::from(
            full && !must_not_include.is_empty()
                && !must_not_include.iter().any(|p| ref_any(p, &items, swap)),
        );
        swapped_only += usize::from(
            swap && must_include
                .iter()
                .any(|p| ref_any(p, &items, true) && !ref_any(p, &items, false)),
        );
        for p in must_include.iter().chain(must_not_include) {
            if let Some(set) = &p.evidence_any {
                let hit = items.iter().any(|i| {
                    i.evidence
                        .iter()
                        .any(|e| set.iter().any(|w| w.as_str() == e))
                });
                ev_hit += usize::from(hit);
                ev_miss += usize::from(!hit);
            }
        }
        let g = ref_grade(
            case.schema,
            &case.answer,
            &case.missing_persons,
            &case.missing_events,
            &case.key,
        )
        .expect("generated keys are well formed");
        condition_lists.extend(g.severe_conditions.iter().copied());
        by_pattern += usize::from(
            severe_patterns
                .iter()
                .any(|(_, p)| ref_any(p, &items, swap)),
        );
        auto_invented += usize::from(
            !case.missing_events.is_empty()
                && severe_conditions.contains(&SevereCondition::InventedEventId),
        );
        auto_self += usize::from(
            items.iter().any(|i| i.people.0 == i.people.1)
                && severe_conditions.contains(&SevereCondition::SelfReference),
        );
        unlisted += usize::from(
            items.iter().any(|i| i.people.0 == i.people.1)
                && !severe_conditions.contains(&SevereCondition::SelfReference),
        );
    }
    for (name, n) in [
        ("must_not_include flips acceptable", flips),
        ("must_not_include present but quiet", quiet),
        ("a/b swapped match only", swapped_only),
        ("evidence_any meets", ev_hit),
        ("evidence_any misses", ev_miss),
        ("severe pattern matches", by_pattern),
        ("invented event listed", auto_invented),
        ("self reference listed", auto_self),
        ("self reference not listed", unlisted),
    ] {
        assert!(n >= 10, "{name}: only {n} of 1500 cases");
    }
    assert!(
        condition_lists.len() >= 3,
        "raised conditions seen: {condition_lists:?}"
    );
}

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

/// Reorders `v` by sorting on `keys` (cycled), ties kept in place: a permutation of `v`.
fn permute<T>(v: &mut Vec<T>, keys: &[u32]) {
    if keys.is_empty() {
        return;
    }
    let mut tagged: Vec<(u32, usize, T)> = std::mem::take(v)
        .into_iter()
        .enumerate()
        .map(|(i, x)| (keys[i % keys.len()], i, x))
        .collect();
    tagged.sort_by_key(|t| (t.0, t.1));
    v.extend(tagged.into_iter().map(|t| t.2));
}

/// Reorders the items (and each item's evidence), optionally exchanges `a` and `b` of
/// relationship_shift items, and optionally appends a copy of one item.
fn scramble(
    answer: &mut SynthesisAnswer,
    item_keys: &[u32],
    ev_keys: &[u32],
    swap_ab: bool,
    dup: Option<usize>,
) {
    fn go<T: Clone>(
        v: &mut Vec<T>,
        item_keys: &[u32],
        dup: Option<usize>,
        mut each: impl FnMut(&mut T),
    ) {
        v.iter_mut().for_each(&mut each);
        if let Some(d) = dup
            && !v.is_empty()
        {
            let copy = v[d % v.len()].clone();
            v.push(copy);
        }
        permute(v, item_keys);
    }
    match answer {
        SynthesisAnswer::Grudge(v) => go(v, item_keys, dup, |i| permute(&mut i.evidence, ev_keys)),
        SynthesisAnswer::DebtChain(v) => {
            go(v, item_keys, dup, |i| permute(&mut i.evidence, ev_keys))
        }
        SynthesisAnswer::BrokenPromise(v) => {
            go(v, item_keys, dup, |i| permute(&mut i.evidence, ev_keys))
        }
        SynthesisAnswer::RelationshipShift(v) => go(v, item_keys, dup, |i| {
            permute(&mut i.evidence, ev_keys);
            if swap_ab {
                std::mem::swap(&mut i.a, &mut i.b);
            }
        }),
    }
}

proptest! {
    // Feature: llm-probe, Property 9: Order of items and evidence does not matter
    // **Validates: Requirements 5.10, 5.12**
    #[test]
    fn item_and_evidence_order_and_duplicates_do_not_change_grade_or_identity(
        case in arb_s_case(),
        item_keys in prop::collection::vec(any::<u32>(), 1..=12),
        ev_keys in prop::collection::vec(any::<u32>(), 1..=12),
        swap_ab in any::<bool>(),
        dup in prop::option::of(0usize..12),
    ) {
        let before = case.verdict();
        let want_grade = grade("p9", &before, &case.key)
            .map_err(|e| TestCaseError::fail(e.to_string()))?;
        let want_identity = identity(&before);

        let mut moved = case.clone();
        scramble(&mut moved.answer, &item_keys, &ev_keys, swap_ab, dup);
        let after = moved.verdict();
        let got_grade = grade("p9", &after, &case.key)
            .map_err(|e| TestCaseError::fail(e.to_string()))?;
        prop_assert_eq!(&got_grade, &want_grade);
        prop_assert_eq!(identity(&after), want_identity);
    }
}

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

use sim_core::llm::card::ExpectedSide;

/// One side of a contrast pair: the base verdict, the subset the pair expects for it,
/// and what the reference rule says about membership.
type Side = (Verdict, ExpectedSide, bool);

/// A D side: a legal option against a non-empty subset of the options.
fn arb_d_side() -> BoxedStrategy<Side> {
    arb_decision_context()
        .prop_flat_map(|ctx| {
            let n = match &ctx.spec {
                TaskSpec::Decision { options } => options.len(),
                TaskSpec::Synthesis { .. } => unreachable!("decision context"),
            };
            (
                Just(ctx),
                0..n,
                prop::collection::vec(any::<bool>(), 5..=5),
                0..n,
            )
        })
        .prop_map(|(ctx, pick, mask, fallback)| {
            let TaskSpec::Decision { options } = &ctx.spec else {
                unreachable!("decision context");
            };
            let mut set: BTreeSet<_> = options
                .iter()
                .enumerate()
                .filter(|(i, _)| mask[*i])
                .map(|(_, o)| o.id.clone())
                .collect();
            if set.is_empty() {
                set.insert(options[fallback].id.clone());
            }
            let option = options[pick].id.clone();
            let want = set.contains(&option);
            (
                Verdict::Decision { option },
                ExpectedSide::Options(set),
                want,
            )
        })
        .boxed()
}

/// An S side: a legal answer against include/exclude lists, judged by the Property 8
/// reference matcher (every include matched, no exclude matched).
fn arb_s_side() -> BoxedStrategy<Side> {
    arb_s_case()
        .prop_map(|case| {
            let AnswerKey::Synthesis {
                must_include,
                must_not_include,
                ..
            } = &case.key
            else {
                unreachable!("synthesis key");
            };
            let swap = case.schema == OutputSchema::RelationshipShiftV1;
            let want = ref_acceptable(
                must_include,
                must_not_include,
                &ref_items(&case.answer),
                swap,
            );
            let expected = ExpectedSide::Patterns {
                include: must_include.clone(),
                exclude: must_not_include.clone(),
            };
            (case.verdict(), expected, want)
        })
        .boxed()
}

/// An Illegal side: never in the subset, whatever the subset is (an empty pattern pair
/// would hold for any legal answer; a full option set holds for every option).
fn arb_illegal_side() -> BoxedStrategy<Side> {
    (
        0..ALL_ILLEGAL_REASONS.len(),
        proptest::option::of("[a-z_.\\[\\]0-9]{0,12}"),
        arb_d_side(),
        any::<bool>(),
    )
        .prop_map(|(reason_ix, path, (_, d_expected, _), empty_patterns)| {
            let expected = if empty_patterns {
                ExpectedSide::Patterns {
                    include: Vec::new(),
                    exclude: Vec::new(),
                }
            } else {
                d_expected
            };
            let verdict = Verdict::Illegal {
                reason: ALL_ILLEGAL_REASONS[reason_ix],
                path,
            };
            (verdict, expected, false)
        })
        .boxed()
}

fn arb_side() -> BoxedStrategy<Side> {
    prop_oneof![
        3 => arb_d_side(),
        3 => arb_s_side(),
        2 => arb_illegal_side(),
    ]
    .boxed()
}

/// A D-or-Illegal / S-or-Illegal pair of sides: valid/illegal combinations of both
/// task types, including the mixed case where the two cards are of different tasks.
fn arb_pair() -> BoxedStrategy<(Side, Side)> {
    (arb_side(), arb_side()).boxed()
}

proptest! {
    // Feature: llm-probe, Property 10: Contrast decisions follow the expected subsets
    // **Validates: Requirements 5.9, 13.3**
    #[test]
    fn contrast_decisions_follow_the_expected_subsets(
        (a, b) in arb_pair(),
        pair_id in "[a-z]{1,6}-[0-9]{1,3}",
    ) {
        let (verdict_a, expected_a, want_a) = a;
        let (verdict_b, expected_b, want_b) = b;
        let got = sim_core::llm::grade::contrast(
            &pair_id, &verdict_a, &verdict_b, &expected_a, &expected_b,
        )
        .map_err(|e| TestCaseError::fail(e.to_string()))?;
        prop_assert_eq!(got.a_in_expected, want_a);
        prop_assert_eq!(got.b_in_expected, want_b);
        prop_assert_eq!(got.consistent, want_a && want_b);
        // An Illegal base on either card is never consistent.
        if matches!(verdict_a, Verdict::Illegal { .. }) {
            prop_assert!(!got.a_in_expected && !got.consistent);
        }
        if matches!(verdict_b, Verdict::Illegal { .. }) {
            prop_assert!(!got.b_in_expected && !got.consistent);
        }
    }
}

/// The pair generator reaches every combination the property is about.
#[test]
fn contrast_pair_generator_covers_valid_and_illegal_combinations() {
    let mut runner = TestRunner::deterministic();
    let strategy = arb_pair();
    // [a valid, b valid] x [a in subset, b in subset], plus illegal on a / on b / on both.
    let (mut both_in, mut a_only, mut b_only, mut neither) = (0, 0, 0, 0);
    let (mut ill_a, mut ill_b, mut ill_both) = (0, 0, 0);
    let (mut d_and_s, mut s_s) = (0, 0);
    for _ in 0..1500 {
        let ((va, _, wa), (vb, _, wb)) = strategy.new_tree(&mut runner).expect("tree").current();
        let (ia, ib) = (
            matches!(va, Verdict::Illegal { .. }),
            matches!(vb, Verdict::Illegal { .. }),
        );
        ill_a += usize::from(ia && !ib);
        ill_b += usize::from(ib && !ia);
        ill_both += usize::from(ia && ib);
        if !ia && !ib {
            both_in += usize::from(wa && wb);
            a_only += usize::from(wa && !wb);
            b_only += usize::from(!wa && wb);
            neither += usize::from(!wa && !wb);
            let (sa, sb) = (
                matches!(va, Verdict::Synthesis { .. }),
                matches!(vb, Verdict::Synthesis { .. }),
            );
            d_and_s += usize::from(sa != sb);
            s_s += usize::from(sa && sb);
        }
    }
    for (name, n) in [
        ("both in subset", both_in),
        ("only a in subset", a_only),
        ("only b in subset", b_only),
        ("neither in subset", neither),
        ("illegal on a only", ill_a),
        ("illegal on b only", ill_b),
        ("illegal on both", ill_both),
        ("one D one S", d_and_s),
        ("both S", s_s),
    ] {
        assert!(n >= 10, "{name}: only {n} of 1500 pairs");
    }
}

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------
//
// Scope: all 34 Dev_Cards, including the four unscored Sanity cards (their keys are
// graded like any other, so they are covered, not skipped).

mod gold {
    use std::collections::BTreeMap;

    use sim_core::llm::card::ParsedCard;
    use sim_core::llm::json::Json;
    use sim_core::llm::{
        AnswerKey, EventId, FrozenContext, OutputSchema, Pattern, PatternValue, Scalar, TaskSpec,
    };

    use super::schema_name_of;

    fn scalar_json(s: &Scalar) -> Json {
        match s {
            Scalar::Int(n) => Json::int(*n),
            Scalar::Str(t) => Json::Str(t.clone()),
            Scalar::Null => Json::Null,
        }
    }

    fn json_scalar(j: &Json) -> Scalar {
        match j {
            Json::Number(n) => Scalar::Int(n.parse().unwrap_or(i64::MIN)),
            Json::Str(s) => Scalar::Str(s.clone()),
            _ => Scalar::Null,
        }
    }

    /// An allowed value of a pattern field; `choice` picks among a list.
    fn allowed(v: &PatternValue, choice: usize) -> Scalar {
        match v {
            PatternValue::Exact(s) => s.clone(),
            PatternValue::AnyOf(l) => l
                .get(choice % l.len().max(1))
                .cloned()
                .unwrap_or(Scalar::Null),
        }
    }

    fn value_ok(want: &PatternValue, got: &Scalar) -> bool {
        match want {
            PatternValue::Exact(s) => s == got,
            PatternValue::AnyOf(l) => l.contains(got),
        }
    }

    /// Independent pattern matcher over a built item (the `a`/`b` swap for shifts).
    fn item_matches(schema: OutputSchema, p: &Pattern, item: &BTreeMap<String, Json>) -> bool {
        let ev_ok = p
            .evidence_any
            .as_ref()
            .is_none_or(|any| match item.get("evidence") {
                Some(Json::Array(ev)) => ev
                    .iter()
                    .any(|e| matches!(e, Json::Str(s) if any.iter().any(|x| x.as_str() == s))),
                _ => false,
            });
        let direct = |swap: bool| {
            p.fields.iter().all(|(k, want)| {
                let key = match (swap, k.as_str()) {
                    (true, "a") => "b",
                    (true, "b") => "a",
                    _ => k.as_str(),
                };
                item.get(key)
                    .is_some_and(|got| value_ok(want, &json_scalar(got)))
            })
        };
        ev_ok && (direct(false) || (schema == OutputSchema::RelationshipShiftV1 && direct(true)))
    }

    const LEVELS: [&str; 3] = ["low", "medium", "high"];
    const DEBT: [&str; 4] = ["open", "repaid", "transferred", "forgiven"];
    const PROMISE: [&str; 3] = ["broken", "pending", "kept"];
    const DIRS: [&str; 4] = ["warmer", "colder", "unchanged", "reversed"];

    /// Builds one item satisfying `p`. Free fields take values from `free`, a rotation
    /// offset; the caller retries other offsets when the item hits an exclusion.
    fn build_item(
        ctx: &FrozenContext,
        schema: OutputSchema,
        p: &Pattern,
        choice: usize,
        free: usize,
    ) -> BTreeMap<String, Json> {
        let people: Vec<i64> = ctx.people.iter().map(|x| x.id.0).collect();
        let events: Vec<&EventId> = ctx.events.iter().map(|e| &e.id).collect();
        let pick_enum =
            |names: &[&str], salt: usize| Json::Str(names[(free + salt) % names.len()].to_owned());
        let pick_event =
            |salt: usize| Json::Str(events[(free + salt) % events.len()].as_str().to_owned());
        let fixed = |name: &str| p.fields.get(name).map(|v| scalar_json(&allowed(v, choice)));
        // Person fields: pattern value when given; otherwise rotate, avoiding the
        // partner so the item never refers to a person twice.
        let (p1, p2) = match schema {
            OutputSchema::GrudgeV1 => ("from", "to"),
            OutputSchema::DebtChainV1 => ("debtor", "creditor"),
            OutputSchema::BrokenPromiseV1 => ("promisor", "promisee"),
            OutputSchema::RelationshipShiftV1 => ("a", "b"),
        };
        let first = match fixed(p1) {
            Some(Json::Number(n)) => n.parse().unwrap_or(0),
            _ => people[free % people.len()],
        };
        let second = match fixed(p2) {
            Some(Json::Number(n)) => n.parse().unwrap_or(0),
            _ => {
                let others: Vec<i64> = people.iter().copied().filter(|x| *x != first).collect();
                others[(free / people.len().max(1)) % others.len().max(1)]
            }
        };
        let mut m: BTreeMap<String, Json> = BTreeMap::new();
        m.insert(p1.to_owned(), Json::int(first));
        m.insert(p2.to_owned(), Json::int(second));
        let evidence = match &p.evidence_any {
            Some(any) => {
                let ids: Vec<&EventId> = any.iter().collect();
                vec![ids[choice % ids.len()].as_str().to_owned()]
            }
            None => vec![events[free % events.len()].as_str().to_owned()],
        };
        m.insert(
            "evidence".to_owned(),
            Json::Array(evidence.into_iter().map(Json::Str).collect()),
        );
        m.insert("reason".to_owned(), Json::Str("gold".to_owned()));
        match schema {
            OutputSchema::GrudgeV1 => {
                m.insert(
                    "level".to_owned(),
                    fixed("level").unwrap_or_else(|| pick_enum(&LEVELS, 0)),
                );
            }
            OutputSchema::DebtChainV1 => {
                m.insert(
                    "amount".to_owned(),
                    fixed("amount").unwrap_or_else(|| Json::int([0, 1, 40, 500][free % 4])),
                );
                m.insert(
                    "status".to_owned(),
                    fixed("status").unwrap_or_else(|| pick_enum(&DEBT, 0)),
                );
                m.insert(
                    "origin_event".to_owned(),
                    fixed("origin_event").unwrap_or_else(|| pick_event(1)),
                );
                m.insert(
                    "transferred_from".to_owned(),
                    fixed("transferred_from").unwrap_or(Json::Null),
                );
            }
            OutputSchema::BrokenPromiseV1 => {
                m.insert(
                    "promise_event".to_owned(),
                    fixed("promise_event").unwrap_or_else(|| pick_event(1)),
                );
                m.insert(
                    "status".to_owned(),
                    fixed("status").unwrap_or_else(|| pick_enum(&PROMISE, 0)),
                );
            }
            OutputSchema::RelationshipShiftV1 => {
                m.insert(
                    "direction".to_owned(),
                    fixed("direction").unwrap_or_else(|| pick_enum(&DIRS, 0)),
                );
                m.insert(
                    "turning_point".to_owned(),
                    fixed("turning_point").unwrap_or_else(|| {
                        if free.is_multiple_of(2) {
                            Json::Null
                        } else {
                            pick_event(2)
                        }
                    }),
                );
            }
        }
        m
    }

    /// A schema-valid answer text with one item per `must_include` pattern, taken from
    /// the card's own people and events, matching no `must_not_include` or severe pattern.
    /// `None` when no variant avoids every exclusion (a card whose key cannot be met).
    pub fn gold_answer(card: &ParsedCard, choice: usize, extra: usize) -> Option<String> {
        let (_, ctx, key, _) = card;
        let (
            TaskSpec::Synthesis { .. },
            AnswerKey::Synthesis {
                schema,
                must_include,
                must_not_include,
                severe_patterns,
                ..
            },
        ) = (&ctx.spec, key)
        else {
            return None;
        };
        let banned: Vec<&Pattern> = must_not_include
            .iter()
            .chain(severe_patterns.iter().map(|(_, p)| p))
            .collect();
        let mut items = Vec::new();
        for (i, p) in must_include.iter().enumerate() {
            let item = (0..200usize)
                .map(|k| build_item(ctx, *schema, p, choice + i, extra + k))
                .find(|m| banned.iter().all(|b| !item_matches(*schema, b, m)))?;
            items.push(Json::Object(item));
        }
        let mut root = BTreeMap::new();
        root.insert("schema".to_owned(), Json::Str(schema_name_of(*schema)));
        root.insert("items".to_owned(), Json::Array(items));
        Some(sim_core::llm::json::write(&Json::Object(root)))
    }
}

fn schema_name_of(s: sim_core::llm::OutputSchema) -> String {
    schema_name(s).to_owned()
}

fn assert_gold_card(card: &ParsedCard, choice: usize, extra: usize) -> Result<(), TestCaseError> {
    let (meta, ctx, key, _) = card;
    let want = |g: &sim_core::llm::Grade| g.acceptable && !g.severe && !g.illegal;
    match key {
        AnswerKey::Decision { acceptable, severe } => {
            for option in acceptable.difference(severe) {
                let raw = format!("{{\"option\":\"{}\"}}", option.as_str());
                let verdict = validate_raw(ctx, &raw);
                let g = grade(&meta.id, &verdict, key)
                    .map_err(|e| TestCaseError::fail(e.to_string()))?;
                prop_assert!(
                    want(&g),
                    "{}: option {} graded {:?}",
                    meta.id,
                    option.as_str(),
                    g
                );
            }
        }
        AnswerKey::Synthesis { .. } => {
            let Some(raw) = gold::gold_answer(card, choice, extra) else {
                return Err(TestCaseError::fail(format!(
                    "{}: no gold answer avoids every exclusion",
                    meta.id
                )));
            };
            let verdict = validate_raw(ctx, &raw);
            match &verdict {
                Verdict::Synthesis {
                    missing_persons,
                    missing_events,
                    ..
                } => prop_assert!(
                    missing_persons.is_empty() && missing_events.is_empty(),
                    "{}: {}",
                    meta.id,
                    raw
                ),
                other => prop_assert!(false, "{}: {:?} for {}", meta.id, other, raw),
            }
            let g =
                grade(&meta.id, &verdict, key).map_err(|e| TestCaseError::fail(e.to_string()))?;
            prop_assert!(want(&g), "{}: graded {:?} for {}", meta.id, g, raw);
        }
    }
    Ok(())
}

proptest! {
    // Feature: llm-probe, Property 11: Gold answers grade as acceptable on every Dev_Card
    // **Validates: Requirements 5.13, 5.14**
    #[test]
    fn gold_answers_grade_acceptable_on_a_dev_card(
        card in arb_dev_card(),
        choice in 0usize..8,
        extra in 0usize..64,
    ) {
        assert_gold_card(&card, choice, extra)?;
    }
}

// Feature: llm-probe, Property 11: Gold answers grade as acceptable on every Dev_Card
// **Validates: Requirements 5.13, 5.14**
#[test]
fn gold_answers_grade_acceptable_on_every_dev_card_for_every_choice() {
    let cards = dev_cards();
    assert_eq!(cards.len(), 34);
    for card in &cards {
        for choice in 0..4 {
            for extra in [0, 1, 7] {
                if let Err(e) = assert_gold_card(card, choice, extra) {
                    panic!("{} (choice {choice}, extra {extra}): {e}", card.0.id);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Property 12: prompts depend only on the Frozen_Context
// ---------------------------------------------------------------------------

const DECISION_TEMPLATE: &str = "[system]\nYou advise a town. Answer with JSON only.\n{{schema}}\n[user]\nToday is day {{tick}}.\n{{situation}}\nSubject: {{subject}}\nPeople:\n{{people}}\nRelations:\n{{relations}}\nEvents:\n{{events}}\nOptions:\n{{options}}\nPlayer: {{player_input}}\n";
const SYNTHESIS_TEMPLATE: &str = "[system]\nYou summarize town facts. Answer with JSON only.\n{{schema}}\n[user]\nToday is day {{tick}}.\n{{situation}}\nSubject: {{subject}}\nPeople:\n{{people}}\nRelations:\n{{relations}}\nEvents:\n{{events}}\nPlayer: {{player_input}}\n";
const TEST_SCHEMA: &str = "Schema: {\"fixed\":true}";

fn template_for(ctx: &FrozenContext) -> &'static str {
    match ctx.task {
        Task::Decision => DECISION_TEMPLATE,
        Task::Synthesis => SYNTHESIS_TEMPLATE,
    }
}

/// Every kept permutation of the card on this line, rendered.
fn render_line(line: &str) -> Result<Vec<(Permutation, String, String)>, TestCaseError> {
    let (_, ctx, _, _) = parse_card(line, 1).map_err(|e| TestCaseError::fail(e.to_string()))?;
    let template = template_for(&ctx);
    permutations(&ctx)
        .into_iter()
        .map(|perm| {
            let p = render(&ctx, template, Some(TEST_SCHEMA), perm)
                .map_err(|e| TestCaseError::fail(format!("{e:?}")))?;
            Ok((perm, p.system, p.user))
        })
        .collect()
}

proptest! {
    // Feature: llm-probe, Property 12: Prompts depend only on the Frozen_Context
    // **Validates: Requirements 4.9, 7.1, 7.2**
    #[test]
    fn prompts_ignore_card_metadata_and_answer_key(
        (card, new_key) in arb_card().prop_flat_map(|c| {
            let k = arb_key(&c.1);
            (Just(c), k)
        }),
        group in 1u32..=999,
        scored in any::<bool>(),
        note in "\\PC{1,60}",
        drop_contrast in any::<bool>(),
    ) {
        let (meta, ctx, _, contrast) = card.clone();
        let before = render_line(&card_line(&card))?;
        prop_assert!(!before.is_empty());
        // Rendering the same inputs twice is byte-identical.
        prop_assert_eq!(&before, &render_line(&card_line(&card))?);

        // Change every meta and answer-key field, keeping task, family and context.
        let prefix = &meta.id[..meta.id.len() - 3];
        let new_meta = CardMeta {
            id: format!("{prefix}{group:03}"),
            scenario_group: format!("G{group:03}"),
            split: Split::Dev,
            scored,
            author_note: note,
        };
        let new_contrast = if drop_contrast { None } else { contrast.clone() };
        let changed = (new_meta, ctx.clone(), new_key, new_contrast);
        let after = render_line(&card_line(&changed))?;
        prop_assert_eq!(&before, &after);
    }
}

// ---------------------------------------------------------------------------
// Property 13: permutations follow the fixed rules
// ---------------------------------------------------------------------------

/// The candidate orders written out independently of the renderer.
fn model_candidate<T: Clone>(xs: &[T], perm: Permutation) -> Vec<T> {
    let n = xs.len();
    let rot = |k: usize| -> Vec<T> {
        if n == 0 {
            return Vec::new();
        }
        let k = k % n;
        xs[k..].iter().chain(&xs[..k]).cloned().collect()
    };
    match perm {
        Permutation::Base => xs.to_vec(),
        Permutation::Reversed => xs.iter().rev().cloned().collect(),
        Permutation::Rotated1 => rot(1),
        Permutation::Rotated2 => rot(2),
    }
}

/// Events with the candidate applied inside each same-tick block.
fn model_events(ctx: &FrozenContext, perm: Permutation) -> Vec<sim_core::llm::Event> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < ctx.events.len() {
        let mut j = i;
        while j < ctx.events.len() && ctx.events[j].tick == ctx.events[i].tick {
            j += 1;
        }
        out.extend(model_candidate(&ctx.events[i..j], perm));
        i = j;
    }
    out
}

/// The same context with the options (D) or events (S) put in the modelled order.
fn model_context(ctx: &FrozenContext, perm: Permutation) -> FrozenContext {
    let mut c = ctx.clone();
    match &ctx.spec {
        TaskSpec::Decision { options } => {
            c.spec = TaskSpec::Decision {
                options: model_candidate(options, perm),
            };
        }
        TaskSpec::Synthesis { .. } => c.events = model_events(ctx, perm),
    }
    c
}

fn sorted_lines(text: &str) -> Vec<&str> {
    let mut v: Vec<&str> = text.lines().collect();
    v.sort_unstable();
    v
}

fn check_permutation_rules(ctx: &FrozenContext) -> Result<(), TestCaseError> {
    let kept = permutations(ctx);
    prop_assert_eq!(kept.first(), Some(&Permutation::Base));
    if ctx.family == sim_core::llm::Family::Sanity {
        prop_assert_eq!(&kept, &vec![Permutation::Base]);
    }

    // The expected list: base, then each candidate whose order is new.
    let mut expected = vec![Permutation::Base];
    let mut orders = vec![model_context(ctx, Permutation::Base)];
    if ctx.family != sim_core::llm::Family::Sanity {
        for cand in [
            Permutation::Reversed,
            Permutation::Rotated1,
            Permutation::Rotated2,
        ] {
            let c = model_context(ctx, cand);
            if orders.iter().all(|o| *o != c) {
                orders.push(c);
                expected.push(cand);
            }
        }
    }
    prop_assert_eq!(&kept, &expected);

    match &ctx.spec {
        TaskSpec::Decision { options } if ctx.family != sim_core::llm::Family::Sanity => {
            let non_base = kept.len() - 1;
            prop_assert_eq!(non_base, if options.len() == 2 { 1 } else { 3 });
        }
        TaskSpec::Synthesis { .. } => {
            let multi = ctx.events.windows(2).any(|w| w[0].tick == w[1].tick);
            if !multi {
                prop_assert_eq!(&kept, &vec![Permutation::Base]);
            }
        }
        _ => {}
    }

    let template = template_for(ctx);
    let base = render(ctx, template, Some(TEST_SCHEMA), Permutation::Base)
        .map_err(|e| TestCaseError::fail(format!("{e:?}")))?;
    for perm in kept {
        let got = render(ctx, template, Some(TEST_SCHEMA), perm)
            .map_err(|e| TestCaseError::fail(format!("{e:?}")))?;
        // The prompt equals the base prompt of the modelled order.
        let want = render(
            &model_context(ctx, perm),
            template,
            Some(TEST_SCHEMA),
            Permutation::Base,
        )
        .map_err(|e| TestCaseError::fail(format!("{e:?}")))?;
        prop_assert_eq!(&got, &want);
        // Same options and events as the base prompt, only in another order.
        prop_assert_eq!(sorted_lines(&got.user), sorted_lines(&base.user));
        prop_assert_eq!(&got.system, &base.system);
        if matches!(ctx.spec, TaskSpec::Synthesis { .. }) {
            let ticks = |c: &FrozenContext| c.events.iter().map(|e| e.tick).collect::<Vec<_>>();
            let m = model_context(ctx, perm);
            prop_assert_eq!(ticks(&m), ticks(ctx));
        }
    }
    Ok(())
}

proptest! {
    // Feature: llm-probe, Property 13: Permutations follow the fixed rules
    // **Validates: Requirements 7.3, 7.4, 7.5, 7.8**
    #[test]
    fn permutations_follow_the_fixed_rules(ctx in arb_context()) {
        check_permutation_rules(&ctx)?;
    }

    // Feature: llm-probe, Property 13: Permutations follow the fixed rules
    // **Validates: Requirements 7.3, 7.4, 7.5, 7.8**
    #[test]
    fn decision_permutations_ignore_same_tick_events(ctx in arb_decision_context()) {
        check_permutation_rules(&ctx)?;
    }
}

// Feature: llm-probe, Property 13: Permutations follow the fixed rules
// **Validates: Requirements 7.3, 7.4, 7.5, 7.8**
#[test]
fn every_dev_card_follows_the_permutation_rules() {
    for (meta, ctx, ..) in dev_cards() {
        if let Err(e) = check_permutation_rules(&ctx) {
            panic!("{}: {e}", meta.id);
        }
    }
}

// ---------------------------------------------------------------------------
// Property 14: every ID, the tick and every due day appear verbatim in the prompt
// ---------------------------------------------------------------------------

/// The context with `player_input`, `subject` and `relations` in the given absent or empty
/// form: `mode` 0 keeps them, 1 makes them absent, 2 makes `player_input` an empty value.
fn blank_optionals(ctx: &FrozenContext, mode: u8) -> FrozenContext {
    let mut c = ctx.clone();
    if mode >= 1 {
        c.subject = None;
        c.relations = Vec::new();
        c.player_input = if mode == 1 {
            None
        } else {
            Some(sim_core::llm::PlayerInput {
                intent: String::new(),
                content: String::new(),
            })
        };
    }
    c
}

fn check_verbatim(ctx: &FrozenContext, perm: Permutation) -> Result<(), TestCaseError> {
    let template = template_for(ctx);
    let p = render(ctx, template, Some(TEST_SCHEMA), perm)
        .map_err(|e| TestCaseError::fail(format!("{e:?}")))?;
    let user = &p.user;
    if let TaskSpec::Decision { options } = &ctx.spec {
        for o in options {
            let line = format!("- {}: {}", o.id.as_str(), o.label);
            prop_assert!(user.contains(&line), "option line {}", line);
        }
    }
    for person in &ctx.people {
        let line = format!("#{} {},", person.id.0, person.name);
        prop_assert!(
            user.lines().any(|l| l.starts_with(&line)),
            "person line {}",
            line
        );
    }
    let today = format!("Today is day {}.", ctx.tick);
    prop_assert!(user.contains(&today), "{}", today);
    for e in &ctx.events {
        let head = format!("{} day {} ", e.id.as_str(), e.tick);
        let lines: Vec<&str> = user.lines().filter(|l| l.starts_with(&head)).collect();
        prop_assert_eq!(lines.len(), 1, "one line for {}", e.id.as_str());
        if let Some(due) = e.due_tick {
            let want = format!("due day {due}");
            prop_assert!(lines[0].ends_with(&want), "{} in {}", want, lines[0]);
        } else {
            prop_assert!(!lines[0].contains("due day"));
        }
    }
    // Absent or empty optional fields render as `none`.
    if ctx.subject.is_none() {
        prop_assert!(user.contains("Subject: none\n"));
    }
    if ctx.relations.is_empty() {
        prop_assert!(user.contains("Relations:\nnone\n"));
    }
    let empty_input = ctx
        .player_input
        .as_ref()
        .is_none_or(|i| i.intent.is_empty() && i.content.is_empty());
    if empty_input {
        prop_assert!(user.ends_with("Player: none"), "{}", user);
    }
    Ok(())
}

proptest! {
    // Feature: llm-probe, Property 14: Every ID, the tick and every due day appear verbatim in the prompt
    // **Validates: Requirements 7.6, 7.9, 7.10, 7.11**
    #[test]
    fn ids_tick_and_due_days_appear_verbatim(ctx in arb_context(), mode in 0u8..3) {
        let ctx = blank_optionals(&ctx, mode);
        for perm in permutations(&ctx) {
            check_verbatim(&ctx, perm)?;
        }
    }

    // Feature: llm-probe, Property 14: Every ID, the tick and every due day appear verbatim in the prompt
    // **Validates: Requirements 7.6, 7.9, 7.10, 7.11**
    #[test]
    fn structural_faults_are_render_errors_naming_the_card(
        ctx in arb_decision_context(),
        keep in 0usize..2,
        extra in 6usize..9,
        card_id in "[DSX][0-9]{3}",
    ) {
        use sim_core::llm::{OptionDef, OptionId};
        use sim_core::llm::render::RenderReason;
        let TaskSpec::Decision { options } = &ctx.spec else {
            return Err(TestCaseError::fail("decision context expected"));
        };
        let with_options = |opts: Vec<OptionDef>| {
            let mut c = ctx.clone();
            c.spec = TaskSpec::Decision { options: opts };
            c
        };
        let check = |c: &FrozenContext, template: &str, want: RenderReason|
            -> Result<(), TestCaseError> {
            let err = render(c, template, Some(TEST_SCHEMA), Permutation::Base)
                .err()
                .ok_or_else(|| TestCaseError::fail("structural fault was rendered"))?
                .with_card_id(&card_id);
            prop_assert_eq!(&err.reason, &want);
            prop_assert!(err.to_string().contains(&card_id), "{}", err);
            prop_assert!(err.to_string().contains(&want.to_string()), "{}", err);
            Ok(())
        };
        // Too few options.
        let few: Vec<OptionDef> = options.iter().take(keep).cloned().collect();
        check(&with_options(few), DECISION_TEMPLATE, RenderReason::OptionCount(keep))?;
        // Too many options (unique IDs).
        let many: Vec<OptionDef> = (0..extra)
            .map(|i| OptionDef {
                id: OptionId::new(&format!("opt_{}", (b'a' + i as u8) as char)).expect("id"),
                label: format!("label {i}"),
            })
            .collect();
        check(&with_options(many), DECISION_TEMPLATE, RenderReason::OptionCount(extra))?;
        // A repeated option ID.
        let mut dup = options.clone();
        dup[1].id = dup[0].id.clone();
        let dup_id = dup[0].id.as_str().to_owned();
        check(&with_options(dup), DECISION_TEMPLATE, RenderReason::DuplicateOptionId(dup_id))?;
        // A template without a required placeholder.
        check(
            &ctx,
            &DECISION_TEMPLATE.replace("{{tick}}", "?"),
            RenderReason::MissingPlaceholder("tick"),
        )?;
        check(
            &ctx,
            &DECISION_TEMPLATE.replace("{{options}}", "?"),
            RenderReason::MissingPlaceholder("options"),
        )?;
        if !ctx.events.is_empty() {
            check(
                &ctx,
                &DECISION_TEMPLATE.replace("{{events}}", "?"),
                RenderReason::MissingPlaceholder("events"),
            )?;
        }
        // Schema text missing for `{{schema}}`.
        let err = render(&ctx, DECISION_TEMPLATE, None, Permutation::Base).err();
        prop_assert_eq!(
            err.map(|e| e.reason),
            Some(RenderReason::MissingValue("schema"))
        );
    }
}

// Feature: llm-probe, Property 14: Every ID, the tick and every due day appear verbatim in the prompt
// **Validates: Requirements 7.6, 7.9, 7.10, 7.11**
#[test]
fn every_dev_card_prompt_carries_ids_tick_and_due_days() {
    for (meta, ctx, ..) in dev_cards() {
        for mode in 0..3 {
            let c = blank_optionals(&ctx, mode);
            for perm in permutations(&c) {
                if let Err(e) = check_verbatim(&c, perm) {
                    panic!("{} mode {mode} {perm:?}: {e}", meta.id);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Property 42: Raw_Choice validation is exact, total and mode-selected
// ---------------------------------------------------------------------------

use sim_core::llm::api::llm_validate;
use sim_core::llm::validate::validate_raw_choice;

mod raw_choice {
    use super::*;
    use serde_json::{Value, json};
    use sim_core::llm::api::{frozen_context_to_json, verdict_to_json};

    /// Whether the API accepts the context (the generators also make contexts that the card
    /// schema rejects, such as an event with no actors; those are skipped).
    pub fn api_accepts(ctx: &FrozenContext) -> bool {
        sim_core::llm::card::frozen_context_from_json(frozen_context_to_json(ctx)).is_ok()
    }

    /// The context with every event that has no actor given the first person as its actor,
    /// which is the card-schema fault the generators produce most often.
    pub fn with_actors(ctx: &FrozenContext) -> FrozenContext {
        let mut c = ctx.clone();
        if let Some(first) = c.people.first().map(|p| p.id) {
            for e in c.events.iter_mut().filter(|e| e.actors.is_empty()) {
                e.actors = vec![first];
            }
        }
        c
    }

    pub fn ctx_value(ctx: &FrozenContext) -> Value {
        serde_json::from_str(&json::write(&frozen_context_to_json(ctx))).expect("context JSON")
    }

    pub fn option_ids(ctx: &FrozenContext) -> Vec<String> {
        match &ctx.spec {
            TaskSpec::Decision { options } => {
                options.iter().map(|o| o.id.as_str().to_owned()).collect()
            }
            TaskSpec::Synthesis { .. } => Vec::new(),
        }
    }

    /// The `llm_validate` result for `input`, parsed.
    pub fn call(input: &Value) -> Value {
        serde_json::from_str(&llm_validate(&input.to_string())).expect("envelope JSON")
    }

    /// The verdict a Raw_Choice `s` must get, written out independently of the validator.
    pub fn expected_verdict(ids: &[String], s: &str) -> Value {
        if ids.iter().any(|i| i == s) {
            json!({"kind": "decision", "option": s})
        } else {
            json!({"kind": "illegal", "reason": "out_of_set_option", "path": null})
        }
    }

    pub fn to_value(v: &Verdict) -> Value {
        serde_json::from_str(&json::write(&verdict_to_json(v))).expect("verdict JSON")
    }

    /// A string `s` near the option IDs of `ids`: exact, padded, recased, extended, cut,
    /// empty, whitespace only, or any Unicode.
    pub fn arb_choice(ids: Vec<String>) -> BoxedStrategy<String> {
        let pick = prop::sample::select(ids);
        prop_oneof![
            3 => pick.clone(),
            1 => pick.clone().prop_map(|i| format!(" {i}")),
            1 => pick.clone().prop_map(|i| format!("{i} ")),
            1 => pick.clone().prop_map(|i| format!("{i}\n")),
            1 => pick.clone().prop_map(|i| format!("\t{i}\r\n")),
            1 => pick.clone().prop_map(|i| i.to_uppercase()),
            1 => pick.clone().prop_map(|i| {
                let mut c = i.chars();
                let first = c.next().map(|f| f.to_uppercase().collect::<String>());
                first.unwrap_or_default() + c.as_str()
            }),
            1 => pick.clone().prop_map(|i| format!("{i}x")),
            1 => pick.clone().prop_map(|i| i.chars().take(i.len().saturating_sub(1)).collect()),
            1 => pick.prop_map(|i| format!("\"{i}\"")),
            1 => Just(String::new()),
            1 => "[ \t\r\n]{1,8}",
            2 => "\\PC{0,40}",
            1 => any::<String>(),
        ]
        .boxed()
    }
}

proptest! {
    // Feature: llm-probe, Property 42: Raw_Choice validation is exact, total and mode-selected
    // **Validates: Requirements 4.16, 4.5, 4.8, 4.13**
    #[test]
    fn raw_choice_is_exact_total_and_mode_selected(
        (ctx, s) in arb_decision_context().prop_flat_map(|ctx| {
            let ids = raw_choice::option_ids(&ctx);
            (Just(ctx), raw_choice::arb_choice(ids))
        })
    ) {
        use raw_choice::*;
        let ctx = with_actors(&ctx);
        prop_assume!(api_accepts(&ctx));
        let ids = option_ids(&ctx);
        let fc = ctx_value(&ctx);
        let rc = serde_json::json!({"frozen_context": fc, "raw": s, "mode": "raw_choice"});
        let first = call(&rc);
        prop_assert_eq!(&first["ok"], &serde_json::json!(true), "{}", first);
        // Exactly the IDs, character for character; everything else is out of set.
        prop_assert_eq!(&first["verdict"], &expected_verdict(&ids, &s));
        // No parse-failure reason is possible in this mode.
        prop_assert_ne!(first["verdict"]["reason"].as_str(), Some("parse_failure"));
        // Same verdict on every call.
        prop_assert_eq!(&call(&rc), &first);

        // Without `mode` and with `mode: "json"` the existing validator answers.
        let plain = serde_json::json!({"frozen_context": fc, "raw": s});
        let json_mode = serde_json::json!({"frozen_context": fc, "raw": s, "mode": "json"});
        let old = to_value(&validate_raw(&ctx, &s));
        let (a, b) = (call(&plain), call(&json_mode));
        prop_assert_eq!(&a["verdict"], &old);
        prop_assert_eq!(&b, &a);
    }

    // Feature: llm-probe, Property 42: Raw_Choice validation is exact, total and mode-selected
    // **Validates: Requirements 4.16, 4.5, 4.8, 4.13**
    #[test]
    fn raw_choice_needs_a_decision_context_and_a_known_mode(
        ctx in arb_context(),
        s in "\\PC{0,20}",
        bad_mode in prop_oneof![
            Just("".to_owned()), Just("RAW_CHOICE".to_owned()), Just("raw".to_owned()),
            Just("json ".to_owned()), "\\PC{0,12}",
        ],
    ) {
        use raw_choice::*;
        let ctx = with_actors(&ctx);
        prop_assume!(api_accepts(&ctx));
        let fc = ctx_value(&ctx);
        let is_d = matches!(ctx.spec, TaskSpec::Decision { .. });
        let rc = call(&serde_json::json!({"frozen_context": fc, "raw": s, "mode": "raw_choice"}));
        if is_d {
            prop_assert_eq!(&rc["ok"], &serde_json::json!(true));
        } else {
            prop_assert_eq!(&rc["ok"], &serde_json::json!(false));
            prop_assert_eq!(&rc["error"]["kind"], &serde_json::json!("input"));
        }
        if bad_mode != "json" && bad_mode != "raw_choice" {
            let r = call(&serde_json::json!({"frozen_context": fc, "raw": s, "mode": bad_mode}));
            prop_assert_eq!(&r["ok"], &serde_json::json!(false));
            prop_assert_eq!(&r["error"]["kind"], &serde_json::json!("input"));
        }
        let r = call(&serde_json::json!({"frozen_context": fc, "raw": s, "mode": 5}));
        prop_assert_eq!(&r["error"]["kind"], &serde_json::json!("input"));
    }

    // Feature: llm-probe, Property 42: Raw_Choice validation is exact, total and mode-selected
    // **Validates: Requirements 4.16, 4.5, 4.8, 4.13**
    #[test]
    fn a_raw_choice_verdict_grades_like_the_json_verdict_naming_the_same_option(
        (ctx, key, pick) in arb_decision_case().prop_flat_map(|(ctx, key)| {
            let n = raw_choice::option_ids(&ctx).len();
            (Just(ctx), Just(key), 0..n)
        })
    ) {
        let TaskSpec::Decision { options } = &ctx.spec else {
            return Err(TestCaseError::fail("decision case expected"));
        };
        let id = options[pick].id.as_str().to_owned();
        let via_choice = validate_raw_choice(options, &id);
        let via_json = validate_raw(&ctx, &format!("{{\"option\":\"{id}\"}}"));
        prop_assert_eq!(&via_choice, &via_json);
        let g1 = grade("p42", &via_choice, &key).map_err(|e| TestCaseError::fail(e.to_string()))?;
        let g2 = grade("p42", &via_json, &key).map_err(|e| TestCaseError::fail(e.to_string()))?;
        prop_assert_eq!(g1, g2);
        prop_assert_eq!(identity(&via_choice), identity(&via_json));
    }
}

// Feature: llm-probe, Property 42: Raw_Choice validation is exact, total and mode-selected
// **Validates: Requirements 4.16, 4.5, 4.8, 4.13**
#[test]
fn raw_choice_handles_one_mebibyte_strings() {
    use raw_choice::*;
    let (_, ctx, ..) = dev_cards()
        .into_iter()
        .find(|c| matches!(c.1.spec, TaskSpec::Decision { .. }))
        .expect("a D Dev_Card");
    let ids = option_ids(&ctx);
    let fc = ctx_value(&ctx);
    let mib = 1024 * 1024;
    let big = [
        "a".repeat(mib),
        ids[0].repeat(mib / ids[0].len()),
        format!("{}{}", ids[0], " ".repeat(mib)),
        "\u{1F642}".repeat(mib / 4),
    ];
    for s in big {
        let rc = serde_json::json!({"frozen_context": fc, "raw": s, "mode": "raw_choice"});
        let r = call(&rc);
        assert_eq!(r["verdict"], expected_verdict(&ids, &s));
        assert_eq!(call(&rc), r);
    }
}

// Feature: llm-probe, Property 42: Raw_Choice validation is exact, total and mode-selected
// **Validates: Requirements 4.16, 4.5, 4.8, 4.13**
#[test]
fn json_and_absent_mode_still_return_the_committed_dev_golden_bytes() {
    use raw_choice::ctx_value;
    use serde_json::Value;
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let read = |p: &str| -> Value {
        let text = std::fs::read_to_string(root.join(p)).unwrap_or_else(|e| panic!("{p}: {e}"));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{p}: {e}"))
    };
    let golden = read("fixtures/grading/dev-golden.json");
    let outputs = read("fixtures/grading/dev-outputs.json");
    let mut contexts = std::collections::BTreeMap::new();
    for (_, line) in dev_lines() {
        let (meta, ctx, ..) = parse_card(&line, 1).expect("dev card");
        contexts.insert(meta.id, ctx_value(&ctx));
    }
    let mut checked = 0usize;
    for card in golden["cards"].as_array().expect("cards") {
        let id = card["card"].as_str().expect("card id");
        let entry = outputs["cards"]
            .as_array()
            .expect("output cards")
            .iter()
            .find(|e| e["card"] == id)
            .expect("outputs for card");
        for o in card["outputs"].as_array().expect("golden outputs") {
            let src = entry["outputs"]
                .as_array()
                .expect("outputs")
                .iter()
                .find(|x| x["label"] == o["output"])
                .expect("output");
            let want = o["validate"].as_str().expect("validate bytes");
            for mode in [None, Some("json")] {
                let mut input = serde_json::Map::new();
                input.insert("frozen_context".into(), contexts[id].clone());
                for k in ["raw", "outcome"] {
                    if let Some(v) = src.get(k) {
                        input.insert(k.into(), v.clone());
                    }
                }
                if let Some(m) = mode {
                    input.insert("mode".into(), m.into());
                }
                assert_eq!(
                    llm_validate(&Value::Object(input).to_string()),
                    want,
                    "card {id} output {} mode {mode:?}",
                    o["output"]
                );
                checked += 1;
            }
        }
    }
    assert!(checked > 0);
}

// ---------------------------------------------------------------------------
// Property 41 (Rust part): the System_One_Mapping depends only on the Frozen_Context,
// the mapping bytes and the Permutation. The part on the real mapping file is task 30.2.
// ---------------------------------------------------------------------------

mod system_one_map {
    use super::*;
    use serde_json::{Value, json};
    use sim_core::llm::api::llm_render_system_one;

    pub const INSTRUCTIONS: &str =
        "How to read the facts:\n- Test rule one.\nHow to choose:\n- Test rule two.";
    pub const STATE: &str = "Today is day {{tick}}.\n{{situation}}\nPeople:\n{{people}}\nRelations:\n{{relations}}\nEvents:\n{{events}}\nInput: {{player_input}}\nSubject: {{subject}}";
    pub const PLACEHOLDERS: [&str; 7] = [
        "tick",
        "situation",
        "people",
        "relations",
        "events",
        "player_input",
        "subject",
    ];

    /// The test mapping; `state` and `instructions` can be swapped to inject faults.
    pub fn mapping(instructions: &str, state: &str) -> String {
        format!(
            "[meta]\nformat_version: 1\nquestion_id: decision\ncriteria: option id -> option label, in the order of the Permutation\n[instructions]\n{instructions}\n[state]\n{state}\n"
        )
    }

    pub fn test_mapping() -> String {
        mapping(INSTRUCTIONS, STATE)
    }

    pub const PERMS: [Permutation; 4] = [
        Permutation::Base,
        Permutation::Reversed,
        Permutation::Rotated1,
        Permutation::Rotated2,
    ];

    pub fn call(ctx: &Value, mapping: &str, perm: &str) -> (String, Value) {
        let input = json!({"frozen_context": ctx, "mapping": mapping, "permutation": perm});
        let text = llm_render_system_one(&input.to_string());
        let value = serde_json::from_str(&text).expect("envelope JSON");
        (text, value)
    }

    pub fn error_message(v: &Value) -> String {
        assert_eq!(v["ok"], json!(false), "{v}");
        v["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }
}

/// The export's result bytes for each of the four permutations of the D card on this line;
/// empty for an S card.
fn system_one_line(line: &str) -> Result<Vec<String>, TestCaseError> {
    use system_one_map::*;
    let (_, ctx, _, _) = parse_card(line, 1).map_err(|e| TestCaseError::fail(e.to_string()))?;
    if !matches!(ctx.spec, TaskSpec::Decision { .. }) {
        return Ok(Vec::new());
    }
    let fc = raw_choice::ctx_value(&ctx);
    Ok(PERMS
        .iter()
        .map(|p| call(&fc, &test_mapping(), p.name()).0)
        .collect())
}

proptest! {
    // Feature: llm-probe, Property 41: The System_One_Mapping depends only on the Frozen_Context, the mapping bytes and the Permutation
    // **Validates: Requirements 19.7, 19.10, 7.1, 7.2, 7.3, 7.6, 7.10, 7.11**
    #[test]
    fn mapping_render_is_deterministic_ordered_and_verbatim(
        ctx in arb_decision_context(),
        mode in 0u8..3,
    ) {
        use system_one_map::*;
        let ctx = raw_choice::with_actors(&blank_optionals(&ctx, mode));
        prop_assume!(raw_choice::api_accepts(&ctx));
        let TaskSpec::Decision { options } = &ctx.spec else {
            return Err(TestCaseError::fail("decision context expected"));
        };
        let fc = raw_choice::ctx_value(&ctx);
        let map = test_mapping();
        for perm in PERMS {
            let (text, v) = call(&fc, &map, perm.name());
            prop_assert_eq!(&v["ok"], &json!(true), "{}", text);
            prop_assert_eq!(&call(&fc, &map, perm.name()).0, &text);
            prop_assert_eq!(v["instructions"].as_str(), Some(INSTRUCTIONS));
            prop_assert_eq!(v["question_id"].as_str(), Some("decision"));
            prop_assert_eq!(v["renderer_version"].as_i64(), Some(2));

            // `criteria`: exactly the context's options, each once, in the Permutation's order.
            let want: Vec<Value> = model_candidate(options, perm)
                .iter()
                .map(|o| json!({"id": o.id.as_str(), "label": o.label}))
                .collect();
            prop_assert_eq!(v["criteria"].as_array(), Some(&want));

            // The state is the fixed fact blocks of the D prompt, and the criteria are the
            // labels the D prompt prints.
            let tpl = format!("[system]\ns\n[user]\n{STATE}\n{{{{options}}}}");
            let prompt = render(&ctx, &tpl, None, perm)
                .map_err(|e| TestCaseError::fail(format!("{e:?}")))?;
            let state = v["state"].as_str().unwrap_or_default();
            let lines: Vec<String> = options_in_order(options, perm)
                .iter()
                .map(|o| format!("- {}: {}", o.id.as_str(), o.label))
                .collect();
            prop_assert_eq!(&prompt.user, &format!("{state}\n{}", lines.join("\n")));
            prop_assert!(!state.contains("Options:"));

            // IDs, the tick and the due days are verbatim.
            let today = format!("Today is day {}.", ctx.tick);
            prop_assert!(state.contains(&today));
            for o in options {
                prop_assert!(text.contains(o.id.as_str()));
            }
            for p in &ctx.people {
                let head = format!("#{} {},", p.id.0, p.name);
                prop_assert!(state.lines().any(|l| l.starts_with(&head)), "{}", head);
            }
            for e in &ctx.events {
                let head = format!("{} day {} ", e.id.as_str(), e.tick);
                let found: Vec<&str> = state.lines().filter(|l| l.starts_with(&head)).collect();
                prop_assert_eq!(found.len(), 1);
                match e.due_tick {
                    Some(d) => {
                        let want = format!("due day {d}");
                        prop_assert!(found[0].ends_with(&want));
                    }
                    None => prop_assert!(!found[0].contains("due day")),
                }
            }
            if ctx.subject.is_none() {
                prop_assert!(state.ends_with("Subject: none"));
            }
            if ctx.relations.is_empty() {
                prop_assert!(state.contains("Relations:\nnone\n"));
            }
            let empty_input = ctx.player_input.as_ref()
                .is_none_or(|i| i.intent.is_empty() && i.content.is_empty());
            if empty_input {
                prop_assert!(state.contains("\nInput: none\n"));
            }
        }
    }

    // Feature: llm-probe, Property 41: The System_One_Mapping depends only on the Frozen_Context, the mapping bytes and the Permutation
    // **Validates: Requirements 19.7, 19.10, 7.1, 7.2, 7.3, 7.6, 7.10, 7.11**
    #[test]
    fn mapping_render_ignores_card_metadata_and_answer_key(
        (card, new_key) in arb_card().prop_flat_map(|c| {
            let k = arb_key(&c.1);
            (Just(c), k)
        }),
        group in 1u32..=999,
        scored in any::<bool>(),
        note in "\\PC{1,60}",
        drop_contrast in any::<bool>(),
    ) {
        let (meta, ctx, _, contrast) = card.clone();
        let before = system_one_line(&card_line(&card))?;
        prop_assert_eq!(&before, &system_one_line(&card_line(&card))?);
        let prefix = &meta.id[..meta.id.len() - 3];
        let new_meta = CardMeta {
            id: format!("{prefix}{group:03}"),
            scenario_group: format!("G{group:03}"),
            split: Split::Dev,
            scored,
            author_note: note,
        };
        let new_contrast = if drop_contrast { None } else { contrast.clone() };
        let changed = (new_meta, ctx.clone(), new_key, new_contrast);
        prop_assert_eq!(&before, &system_one_line(&card_line(&changed))?);
    }

    // Feature: llm-probe, Property 41: The System_One_Mapping depends only on the Frozen_Context, the mapping bytes and the Permutation
    // **Validates: Requirements 19.7, 19.10, 7.1, 7.2, 7.3, 7.6, 7.10, 7.11**
    #[test]
    fn unknown_placeholders_are_render_errors_naming_them(
        ctx in arb_decision_context(),
        name in prop_oneof![
            Just("options".to_owned()), Just("schema".to_owned()),
            "[a-z_]{1,10}".prop_filter("known", |n| !system_one_map::PLACEHOLDERS.contains(&n.as_str())),
        ],
        in_state in any::<bool>(),
    ) {
        use system_one_map::*;
        let ctx = raw_choice::with_actors(&ctx);
        prop_assume!(raw_choice::api_accepts(&ctx));
        let fc = raw_choice::ctx_value(&ctx);
        let ph = format!("{{{{{name}}}}}");
        let map = if in_state {
            mapping(INSTRUCTIONS, &format!("{STATE}\n{ph}"))
        } else {
            mapping(&format!("{INSTRUCTIONS}\n{ph}"), STATE)
        };
        let (_, v) = call(&fc, &map, "base");
        prop_assert_eq!(&v["error"]["kind"], &json!("render"));
        let msg = error_message(&v);
        prop_assert!(msg.contains("unknown placeholder"), "{}", msg);
        prop_assert!(msg.contains(&name), "{}", msg);
    }
}

/// `options` in the permutation's order, written out with `model_candidate`.
fn options_in_order(
    options: &[sim_core::llm::OptionDef],
    perm: Permutation,
) -> Vec<sim_core::llm::OptionDef> {
    model_candidate(options, perm)
}

// Feature: llm-probe, Property 41: The System_One_Mapping depends only on the Frozen_Context, the mapping bytes and the Permutation
// **Validates: Requirements 19.7, 19.10, 7.1, 7.2, 7.3, 7.6, 7.10, 7.11**
#[test]
fn mapping_errors_name_their_cause() {
    use system_one_map::*;
    let cards = dev_cards();
    let d = cards
        .iter()
        .find(|c| matches!(c.1.spec, TaskSpec::Decision { .. }))
        .expect("a D Dev_Card");
    let s = cards
        .iter()
        .find(|c| matches!(c.1.spec, TaskSpec::Synthesis { .. }))
        .expect("an S Dev_Card");
    let fc = raw_choice::ctx_value(&d.1);
    let ok = |m: &str| call(&fc, m, "base").1;
    assert_eq!(ok(&test_mapping())["ok"], json!(true));
    // Structural faults of the mapping.
    let faults = [
        ("missing section [state]", "[instructions]\nx\n".to_owned()),
        (
            "missing section [instructions]",
            "[state]\nDay {{tick}}\n".to_owned(),
        ),
        (
            "appears twice",
            format!("{}[state]\nDay {{{{tick}}}}\n", test_mapping()),
        ),
        (
            "text before the first section header",
            format!("oops\n{}", test_mapping()),
        ),
        (
            "unsupported format_version 2",
            test_mapping().replace("format_version: 1", "format_version: 2"),
        ),
        (
            "question_id must be letters only",
            test_mapping().replace("question_id: decision", "question_id: 7up"),
        ),
        (
            "unterminated placeholder",
            mapping(INSTRUCTIONS, "Day {{tick"),
        ),
        (
            "no value",
            mapping(INSTRUCTIONS, "Day {{tick}} {{options}}"),
        ),
    ];
    for (needle, map) in faults {
        let msg = error_message(&ok(&map));
        assert!(
            msg.contains(needle) || (needle == "no value" && msg.contains("options")),
            "{needle}: {msg}"
        );
    }
    // A state that drops the tick or the events is a structural error too.
    let msg = error_message(&ok(&mapping(INSTRUCTIONS, "{{people}}")));
    assert!(msg.contains("tick"), "{msg}");
    // An S context, an unknown Permutation and a missing member are `input` errors.
    let sv = raw_choice::ctx_value(&s.1);
    for v in [
        call(&sv, &test_mapping(), "base").1,
        call(&fc, &test_mapping(), "sideways").1,
    ] {
        assert_eq!(v["error"]["kind"], json!("input"), "{v}");
    }
    let v: Value = serde_json::from_str(&sim_core::llm::api::llm_render_system_one(
        &json!({"frozen_context": fc, "permutation": "base"}).to_string(),
    ))
    .expect("JSON");
    assert_eq!(v["error"]["kind"], json!("input"));
    // A mapping without [meta] still renders, with the default question ID.
    let bare = format!("[instructions]\n{INSTRUCTIONS}\n[state]\n{STATE}\n");
    assert_eq!(ok(&bare)["question_id"], json!("decision"));
    // The state text of a D card with an empty `player_input` renders `none`.
    let state = ok(&test_mapping())["state"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    assert!(state.starts_with(&format!("Today is day {}.", d.1.tick)));
}

use serde_json::{Value, json};
