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
use sim_core::llm::{AnswerKey, FrozenContext, Task, TaskSpec};

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
