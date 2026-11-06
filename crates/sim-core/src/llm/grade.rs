//! The Grader: a [`Verdict`] plus a card's answer key in, a [`Grade`] out; also the
//! Identity_Value of a verdict and the contrast-pair decision.
//!
//! - Pattern_Match: every pattern field must exist on the item and match (scalar equal,
//!   list "equal to one of"); `evidence_any` needs a non-empty intersection with the item's
//!   evidence; for `relationship_shift_v1` the pattern is also tried with `a` and `b`
//!   swapped.
//! - A faulty answer key (a pattern field outside the output schema, or a key that does not
//!   fit the verdict) is a [`GradeError`] naming the card and the entry; no Grade is
//!   returned. Severe conditions outside the seven are unrepresentable in the typed key
//!   and are rejected earlier by the card parser.
//! - A `severe_patterns` entry for a listed condition raises that condition when an item
//!   matches it (the four pattern conditions); the three automatic conditions come from
//!   the verdict.
//!
//! Integers, strings and ordered collections only: no floats, clocks, environment,
//! randomness or I/O.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use super::answer::{self, debt_status_str, direction_str, level_str, promise_status_str};
use super::card::{ExpectedSide, pattern_fields};
use super::key::{AnswerKey, Grade, Pattern, PatternValue, Scalar, SevereCondition};
use super::{
    ContrastDecision, EventId, IdentityTuple, IdentityValue, OutputSchema, SynthesisAnswer, Verdict,
};

/// Entry name of the severe-pattern list, built without the quoted literal form.
const SEVERE_PATTERNS: &str = concat!("severe", "_patterns");

/// A faulty answer key: names the card (or pair) and the faulty entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GradeError {
    /// Card ID, or `pair_id` for a contrast check.
    pub card_id: String,
    /// Dotted path of the faulty entry, for example `must_include[0].colour`.
    pub entry: String,
    pub detail: &'static str,
}

impl fmt::Display for GradeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "answer_key: {} at {} (card {})",
            self.detail, self.entry, self.card_id
        )
    }
}

impl std::error::Error for GradeError {}

fn err(card_id: &str, entry: &str, detail: &'static str) -> GradeError {
    GradeError {
        card_id: card_id.to_owned(),
        entry: entry.to_owned(),
        detail,
    }
}

// ---------------------------------------------------------------------------------------
// Item views
// ---------------------------------------------------------------------------------------

/// One answer item reduced to what patterns and checks read.
struct ItemView<'a> {
    /// Field maps to try; two for `relationship_shift_v1` (as given, and `a`/`b` swapped).
    orientations: Vec<BTreeMap<&'static str, Scalar>>,
    evidence: &'a [EventId],
    /// The item's two person fields.
    people: (i64, i64),
}

fn int(v: i64) -> Scalar {
    Scalar::Int(v)
}

fn text(s: &str) -> Scalar {
    Scalar::Str(s.to_owned())
}

fn event(id: &EventId) -> Scalar {
    text(id.as_str())
}

fn opt_event(id: &Option<EventId>) -> Scalar {
    id.as_ref().map_or(Scalar::Null, event)
}

fn fields<const N: usize>(pairs: [(&'static str, Scalar); N]) -> BTreeMap<&'static str, Scalar> {
    pairs.into_iter().collect()
}

fn views(answer: &SynthesisAnswer) -> Vec<ItemView<'_>> {
    match answer {
        SynthesisAnswer::Grudge(items) => items
            .iter()
            .map(|i| ItemView {
                orientations: vec![fields([
                    ("from", int(i.from)),
                    ("to", int(i.to)),
                    ("level", text(level_str(i.level))),
                ])],
                evidence: &i.evidence,
                people: (i.from, i.to),
            })
            .collect(),
        SynthesisAnswer::DebtChain(items) => items
            .iter()
            .map(|i| ItemView {
                orientations: vec![fields([
                    ("debtor", int(i.debtor)),
                    ("creditor", int(i.creditor)),
                    ("amount", int(i.amount)),
                    ("status", text(debt_status_str(i.status))),
                    ("origin_event", event(&i.origin_event)),
                    (
                        "transferred_from",
                        i.transferred_from.map_or(Scalar::Null, int),
                    ),
                ])],
                evidence: &i.evidence,
                people: (i.debtor, i.creditor),
            })
            .collect(),
        SynthesisAnswer::BrokenPromise(items) => items
            .iter()
            .map(|i| ItemView {
                orientations: vec![fields([
                    ("promisor", int(i.promisor)),
                    ("promisee", int(i.promisee)),
                    ("promise_event", event(&i.promise_event)),
                    ("status", text(promise_status_str(i.status))),
                ])],
                evidence: &i.evidence,
                people: (i.promisor, i.promisee),
            })
            .collect(),
        SynthesisAnswer::RelationshipShift(items) => items
            .iter()
            .map(|i| {
                let make = |a: i64, b: i64| {
                    fields([
                        ("a", int(a)),
                        ("b", int(b)),
                        ("direction", text(direction_str(i.direction))),
                        ("turning_point", opt_event(&i.turning_point)),
                    ])
                };
                ItemView {
                    orientations: vec![make(i.a, i.b), make(i.b, i.a)],
                    evidence: &i.evidence,
                    people: (i.a, i.b),
                }
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------------------
// Pattern_Match
// ---------------------------------------------------------------------------------------

fn value_matches(want: &PatternValue, got: &Scalar) -> bool {
    match want {
        PatternValue::Exact(s) => s == got,
        PatternValue::AnyOf(list) => list.contains(got),
    }
}

fn fields_match(p: &Pattern, f: &BTreeMap<&'static str, Scalar>) -> bool {
    p.fields.iter().all(|(k, want)| {
        f.get(k.as_str())
            .is_some_and(|got| value_matches(want, got))
    })
}

fn matches(p: &Pattern, item: &ItemView<'_>) -> bool {
    let evidence_ok = p
        .evidence_any
        .as_ref()
        .is_none_or(|any| item.evidence.iter().any(|e| any.contains(e)));
    evidence_ok && item.orientations.iter().any(|o| fields_match(p, o))
}

fn any_item_matches(p: &Pattern, items: &[ItemView<'_>]) -> bool {
    items.iter().any(|i| matches(p, i))
}

/// Every `include` pattern has a match and no `exclude` pattern has one.
fn satisfies(include: &[Pattern], exclude: &[Pattern], items: &[ItemView<'_>]) -> bool {
    include.iter().all(|p| any_item_matches(p, items))
        && !exclude.iter().any(|p| any_item_matches(p, items))
}

/// Rejects a pattern that names a field outside the schema.
fn check_pattern(
    card_id: &str,
    entry: &str,
    p: &Pattern,
    schema: OutputSchema,
) -> Result<(), GradeError> {
    let allowed = pattern_fields(schema);
    match p.fields.keys().find(|k| !allowed.contains(&k.as_str())) {
        Some(k) => Err(err(
            card_id,
            &format!("{entry}.{k}"),
            "unknown_pattern_field",
        )),
        None => Ok(()),
    }
}

fn check_list(
    card_id: &str,
    list_name: &str,
    list: &[Pattern],
    schema: OutputSchema,
) -> Result<(), GradeError> {
    for (i, p) in list.iter().enumerate() {
        check_pattern(card_id, &format!("{list_name}[{i}]"), p, schema)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------------------

fn illegal_grade() -> Grade {
    Grade {
        acceptable: false,
        severe: false,
        illegal: true,
        severe_conditions: Vec::new(),
    }
}

/// Grades one verdict against one card's answer key.
///
/// `card_id` is only used to name the card in a [`GradeError`].
pub fn grade(card_id: &str, verdict: &Verdict, key: &AnswerKey) -> Result<Grade, GradeError> {
    match key {
        AnswerKey::Decision { acceptable, severe } => match verdict {
            Verdict::Decision { option } => Ok(Grade {
                acceptable: acceptable.contains(option),
                severe: severe.contains(option),
                illegal: false,
                severe_conditions: Vec::new(),
            }),
            Verdict::Illegal { .. } => Ok(illegal_grade()),
            Verdict::Synthesis { .. } => Err(err(card_id, "task", "verdict_does_not_fit_key")),
        },
        AnswerKey::Synthesis {
            schema,
            must_include,
            must_not_include,
            severe_conditions,
            severe_patterns,
        } => {
            check_list(card_id, "must_include", must_include, *schema)?;
            check_list(card_id, "must_not_include", must_not_include, *schema)?;
            for (i, (_, p)) in severe_patterns.iter().enumerate() {
                check_pattern(card_id, &format!("{SEVERE_PATTERNS}[{i}]"), p, *schema)?;
            }
            match verdict {
                Verdict::Illegal { .. } => Ok(illegal_grade()),
                Verdict::Decision { .. } => Err(err(card_id, "task", "verdict_does_not_fit_key")),
                Verdict::Synthesis {
                    answer,
                    missing_persons,
                    missing_events,
                } => {
                    if answer::schema_of(answer) != *schema {
                        return Err(err(card_id, "output_schema", "verdict_does_not_fit_key"));
                    }
                    let items = views(answer);
                    let mut raised: BTreeSet<SevereCondition> = BTreeSet::new();
                    let mut raise = |c: SevereCondition, holds: bool| {
                        if holds && severe_conditions.contains(&c) {
                            raised.insert(c);
                        }
                    };
                    raise(SevereCondition::InventedEventId, !missing_events.is_empty());
                    raise(SevereCondition::InventedPerson, !missing_persons.is_empty());
                    raise(
                        SevereCondition::SelfReference,
                        items.iter().any(|i| i.people.0 == i.people.1),
                    );
                    for (c, p) in severe_patterns {
                        raise(*c, any_item_matches(p, &items));
                    }
                    let severe_list: Vec<SevereCondition> = raised.into_iter().collect();
                    Ok(Grade {
                        acceptable: satisfies(must_include, must_not_include, &items),
                        severe: !severe_list.is_empty(),
                        illegal: false,
                        severe_conditions: severe_list,
                    })
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------
// Identity_Value
// ---------------------------------------------------------------------------------------

/// The value compared across permutations: `Invalid` for an Illegal verdict, the option
/// for D, the set of canonical identity tuples for S.
pub fn identity(verdict: &Verdict) -> IdentityValue {
    match verdict {
        Verdict::Illegal { .. } => IdentityValue::Invalid,
        Verdict::Decision { option } => IdentityValue::Option(option.clone()),
        Verdict::Synthesis { answer, .. } => IdentityValue::Set(identity_tuples(answer)),
    }
}

fn identity_tuples(answer: &SynthesisAnswer) -> BTreeSet<IdentityTuple> {
    match answer {
        SynthesisAnswer::Grudge(v) => v
            .iter()
            .map(|i| IdentityTuple::Grudge {
                from: i.from,
                to: i.to,
                level: i.level,
            })
            .collect(),
        SynthesisAnswer::DebtChain(v) => v
            .iter()
            .map(|i| IdentityTuple::DebtChain {
                debtor: i.debtor,
                creditor: i.creditor,
                origin_event: i.origin_event.clone(),
                status: i.status,
                amount: i.amount,
            })
            .collect(),
        SynthesisAnswer::BrokenPromise(v) => v
            .iter()
            .map(|i| IdentityTuple::BrokenPromise {
                promisor: i.promisor,
                promisee: i.promisee,
                promise_event: i.promise_event.clone(),
                status: i.status,
            })
            .collect(),
        SynthesisAnswer::RelationshipShift(v) => v
            .iter()
            .map(|i| IdentityTuple::RelationshipShift {
                low: i.a.min(i.b),
                high: i.a.max(i.b),
                direction: i.direction,
                turning_point: i.turning_point.clone(),
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------------------

/// Whether `verdict` falls in the expected subset. An Illegal verdict falls in neither.
fn in_expected(
    pair_id: &str,
    side_name: &str,
    verdict: &Verdict,
    side: &ExpectedSide,
) -> Result<bool, GradeError> {
    match (verdict, side) {
        (Verdict::Illegal { .. }, _) => Ok(false),
        (Verdict::Decision { option }, ExpectedSide::Options(set)) => Ok(set.contains(option)),
        (Verdict::Synthesis { answer, .. }, ExpectedSide::Patterns { include, exclude }) => {
            let schema = answer::schema_of(answer);
            check_list(pair_id, &format!("{side_name}.include"), include, schema)?;
            check_list(pair_id, &format!("{side_name}.exclude"), exclude, schema)?;
            Ok(satisfies(include, exclude, &views(answer)))
        }
        _ => Err(err(pair_id, side_name, "verdict_does_not_fit_key")),
    }
}

/// The contrast-pair decision for the base answers of cards a and b.
///
/// `pair_id` only names the pair in a [`GradeError`].
pub fn contrast(
    pair_id: &str,
    verdict_a: &Verdict,
    verdict_b: &Verdict,
    expected_a: &ExpectedSide,
    expected_b: &ExpectedSide,
) -> Result<ContrastDecision, GradeError> {
    let a_in_expected = in_expected(pair_id, "expected.a", verdict_a, expected_a)?;
    let b_in_expected = in_expected(pair_id, "expected.b", verdict_b, expected_b)?;
    Ok(ContrastDecision {
        a_in_expected,
        b_in_expected,
        consistent: a_in_expected && b_in_expected,
    })
}

#[cfg(test)]
#[allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::super::{Direction, GrudgeItem, IllegalReason, Level, OptionId, ShiftItem};
    use super::*;

    fn opt(s: &str) -> OptionId {
        OptionId::new(s).expect("test option id")
    }

    fn eid(s: &str) -> EventId {
        EventId::new(s).expect("test event id")
    }

    fn pat(entries: Vec<(&str, PatternValue)>) -> Pattern {
        Pattern {
            fields: entries
                .into_iter()
                .map(|(k, v)| (k.to_owned(), v))
                .collect(),
            evidence_any: None,
        }
    }

    fn exact_int(n: i64) -> PatternValue {
        PatternValue::Exact(Scalar::Int(n))
    }

    fn synth_key(
        schema: OutputSchema,
        include: Vec<Pattern>,
        conds: &[SevereCondition],
        sev: Vec<(SevereCondition, Pattern)>,
    ) -> AnswerKey {
        AnswerKey::Synthesis {
            schema,
            must_include: include,
            must_not_include: Vec::new(),
            severe_conditions: conds.iter().copied().collect(),
            severe_patterns: sev,
        }
    }

    fn shift_verdict(a: i64, b: i64, missing_persons: Vec<i64>) -> Verdict {
        Verdict::Synthesis {
            answer: SynthesisAnswer::RelationshipShift(vec![ShiftItem {
                a,
                b,
                direction: Direction::Colder,
                turning_point: Some(eid("e3")),
                evidence: vec![eid("e3"), eid("e1")],
                reason: String::new(),
            }]),
            missing_persons,
            missing_events: Vec::new(),
        }
    }

    #[test]
    fn decision_grades_follow_the_key_lists() {
        let key = AnswerKey::Decision {
            acceptable: [opt("a"), opt("b")].into_iter().collect(),
            severe: [opt("c")].into_iter().collect(),
        };
        let g = |o: &str| grade("D-x-001", &Verdict::Decision { option: opt(o) }, &key);
        assert_eq!(g("a").map(|g| (g.acceptable, g.severe)), Ok((true, false)));
        assert_eq!(g("c").map(|g| (g.acceptable, g.severe)), Ok((false, true)));
        let ill = Verdict::Illegal {
            reason: IllegalReason::Timeout,
            path: None,
        };
        assert_eq!(grade("D-x-001", &ill, &key), Ok(illegal_grade()));
    }

    #[test]
    fn shift_pattern_matches_swapped_pair_and_identity_is_unordered() {
        let p = pat(vec![("a", exact_int(1)), ("b", exact_int(2))]);
        let key = synth_key(OutputSchema::RelationshipShiftV1, vec![p], &[], vec![]);
        let g = grade("S-x-001", &shift_verdict(2, 1, vec![]), &key);
        assert_eq!(g.map(|g| g.acceptable), Ok(true));
        assert_eq!(
            identity(&shift_verdict(2, 1, vec![])),
            identity(&shift_verdict(1, 2, vec![]))
        );
    }

    #[test]
    fn severe_conditions_need_listing_and_come_out_in_order() {
        let items = SynthesisAnswer::Grudge(vec![GrudgeItem {
            from: 5,
            to: 5,
            level: Level::High,
            evidence: vec![eid("e1")],
            reason: String::new(),
        }]);
        let v = Verdict::Synthesis {
            answer: items,
            missing_persons: vec![5],
            missing_events: vec!["e9".to_owned()],
        };
        let listed = [
            SevereCondition::SelfReference,
            SevereCondition::InventedEventId,
        ];
        let key = synth_key(OutputSchema::GrudgeV1, vec![], &listed, vec![]);
        let g = grade("S-x-001", &v, &key);
        // InventedPerson holds but is not listed; the others come out in enum order.
        assert_eq!(
            g.map(|g| g.severe_conditions),
            Ok(vec![
                SevereCondition::InventedEventId,
                SevereCondition::SelfReference
            ])
        );
    }

    #[test]
    fn unknown_pattern_field_is_an_error_naming_card_and_entry() {
        let bad = pat(vec![("colour", exact_int(1))]);
        let key = synth_key(OutputSchema::GrudgeV1, vec![bad], &[], vec![]);
        let v = Verdict::Synthesis {
            answer: SynthesisAnswer::Grudge(Vec::new()),
            missing_persons: Vec::new(),
            missing_events: Vec::new(),
        };
        let e = grade("S-x-007", &v, &key);
        assert_eq!(
            e,
            Err(GradeError {
                card_id: "S-x-007".to_owned(),
                entry: "must_include[0].colour".to_owned(),
                detail: "unknown_pattern_field",
            })
        );
    }

    #[test]
    fn illegal_falls_in_neither_contrast_subset() {
        let side = ExpectedSide::Options([opt("a")].into_iter().collect());
        let ill = Verdict::Illegal {
            reason: IllegalReason::ParseFailure,
            path: None,
        };
        let ok = Verdict::Decision { option: opt("a") };
        let d = contrast("P001", &ok, &ill, &side, &side);
        assert_eq!(
            d.map(|d| (d.a_in_expected, d.b_in_expected, d.consistent)),
            Ok((true, false, false))
        );
    }
}
