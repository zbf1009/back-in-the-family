//! The Output_Validator: raw model text (or a non-text outcome) plus a [`FrozenContext`]
//! in, a [`Verdict`] out. Total: every input gives a verdict, nothing panics.
//!
//! D answers are checked against one card-independent schema first (an object whose only
//! member is `option`, a string), then for membership in the context's option IDs. S answers
//! are checked against the family schema named by the context. The first failure in a fixed
//! traversal order gives the reason code and the field path.
//!
//! Paths: `$` is the root value; members are written `items[2].evidence[1]`, and a top-level
//! member is just its name (`option`, `items`).
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

use super::answer;
use super::json::{self, Json};
use super::{
    DebtItem, DebtStatus, Direction, EventId, FrozenContext, GrudgeItem, IllegalReason, Level,
    OutputSchema, PromiseItem, PromiseStatus, ShiftItem, SynthesisAnswer, TaskSpec, Verdict,
};

/// What a Runtime handed back for one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome<'a> {
    /// The raw text, byte for byte.
    Text(&'a str),
    Timeout,
    Error {
        code: &'a str,
        detail: &'a str,
    },
}

/// Validates an outcome against the context.
pub fn validate(ctx: &FrozenContext, outcome: Outcome<'_>) -> Verdict {
    match outcome {
        Outcome::Text(raw) => validate_raw(ctx, raw),
        Outcome::Timeout => illegal(IllegalReason::Timeout, None),
        Outcome::Error { code, detail } => {
            if code == "parse_failure" && detail == "non_text_response" {
                illegal(IllegalReason::ParseFailure, None)
            } else {
                illegal(IllegalReason::RuntimeError, None)
            }
        }
    }
}

/// Validates raw model text against the context.
pub fn validate_raw(ctx: &FrozenContext, raw: &str) -> Verdict {
    let value = match answer::parse_answer(raw) {
        Ok(v) => v,
        Err(e) => return illegal(e.reason, None),
    };
    let result = match &ctx.spec {
        TaskSpec::Decision { options } => check_decision(options, &value),
        TaskSpec::Synthesis { schema } => check_synthesis(ctx, *schema, &value),
    };
    result.unwrap_or_else(|f| illegal(f.reason, Some(f.path)))
}

struct Fail {
    reason: IllegalReason,
    path: String,
}

type Check<T> = Result<T, Fail>;

fn fail<T>(reason: IllegalReason, path: impl Into<String>) -> Check<T> {
    Err(Fail {
        reason,
        path: path.into(),
    })
}

fn illegal(reason: IllegalReason, path: Option<String>) -> Verdict {
    Verdict::Illegal { reason, path }
}

// ---- D ----

fn check_decision(options: &[super::OptionDef], value: &Json) -> Check<Verdict> {
    let Json::Object(members) = value else {
        return fail(IllegalReason::WrongType, "$");
    };
    let Some(option) = members.get("option") else {
        return fail(IllegalReason::MissingRequiredField, "option");
    };
    if let Some(extra) = members.keys().find(|k| k.as_str() != "option") {
        return fail(IllegalReason::UnknownField, extra.clone());
    }
    let Json::Str(chosen) = option else {
        return fail(IllegalReason::WrongType, "option");
    };
    match options.iter().find(|o| o.id.as_str() == chosen) {
        Some(o) => Ok(Verdict::Decision {
            option: o.id.clone(),
        }),
        None => fail(IllegalReason::OutOfSetOption, "option"),
    }
}

// ---- S ----

#[derive(Clone, Copy)]
enum Kind {
    Int,
    /// An integer that may also be `null`.
    OptInt,
    /// An integer of at least 0.
    NonNegInt,
    Enum(&'static [&'static str]),
    Event,
    OptEvent,
    Evidence,
    Text,
}

const LEVELS: &[&str] = &["low", "medium", "high"];
const DEBT_STATUSES: &[&str] = &["open", "repaid", "transferred", "forgiven"];
const PROMISE_STATUSES: &[&str] = &["broken", "pending", "kept"];
const DIRECTIONS: &[&str] = &["warmer", "colder", "unchanged", "reversed"];

/// Item members in schema order.
fn item_fields(schema: OutputSchema) -> &'static [(&'static str, Kind)] {
    match schema {
        OutputSchema::GrudgeV1 => &[
            ("from", Kind::Int),
            ("to", Kind::Int),
            ("level", Kind::Enum(LEVELS)),
            ("evidence", Kind::Evidence),
            ("reason", Kind::Text),
        ],
        OutputSchema::DebtChainV1 => &[
            ("debtor", Kind::Int),
            ("creditor", Kind::Int),
            ("amount", Kind::NonNegInt),
            ("status", Kind::Enum(DEBT_STATUSES)),
            ("origin_event", Kind::Event),
            ("transferred_from", Kind::OptInt),
            ("evidence", Kind::Evidence),
            ("reason", Kind::Text),
        ],
        OutputSchema::BrokenPromiseV1 => &[
            ("promisor", Kind::Int),
            ("promisee", Kind::Int),
            ("promise_event", Kind::Event),
            ("status", Kind::Enum(PROMISE_STATUSES)),
            ("evidence", Kind::Evidence),
            ("reason", Kind::Text),
        ],
        OutputSchema::RelationshipShiftV1 => &[
            ("a", Kind::Int),
            ("b", Kind::Int),
            ("direction", Kind::Enum(DIRECTIONS)),
            ("turning_point", Kind::OptEvent),
            ("evidence", Kind::Evidence),
            ("reason", Kind::Text),
        ],
    }
}

/// A checked member value, ready to be read into a typed item.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Val {
    Int(i64),
    Null,
    Word(&'static str),
    Event(EventId),
    Evidence(Vec<EventId>),
    Text(String),
}

type Item = BTreeMap<&'static str, Val>;

fn check_int(v: &Json, path: &str) -> Check<i64> {
    match v {
        Json::Number(lexeme) => json::integer_value(lexeme).or_else(|r| fail(r, path)),
        _ => fail(IllegalReason::WrongType, path),
    }
}

fn check_event(v: &Json, path: &str) -> Check<EventId> {
    match v {
        Json::Str(s) => match EventId::new(s) {
            Some(id) => Ok(id),
            None => fail(IllegalReason::MalformedEventId, path),
        },
        _ => fail(IllegalReason::WrongType, path),
    }
}

fn check_evidence(v: &Json, path: &str) -> Check<Vec<EventId>> {
    let Json::Array(entries) = v else {
        return fail(IllegalReason::WrongType, path);
    };
    if entries.is_empty() {
        return fail(IllegalReason::EmptyEvidence, path);
    }
    let mut seen: BTreeSet<EventId> = BTreeSet::new();
    let mut out = Vec::with_capacity(entries.len());
    for (j, entry) in entries.iter().enumerate() {
        let entry_path = format!("{path}[{j}]");
        let id = check_event(entry, &entry_path)?;
        if !seen.insert(id.clone()) {
            return fail(IllegalReason::DuplicateEvidence, entry_path);
        }
        out.push(id);
    }
    Ok(out)
}

fn check_value(kind: Kind, v: &Json, path: &str) -> Check<Val> {
    match kind {
        Kind::Int => check_int(v, path).map(Val::Int),
        Kind::OptInt => match v {
            Json::Null => Ok(Val::Null),
            _ => check_int(v, path).map(Val::Int),
        },
        Kind::NonNegInt => {
            let n = check_int(v, path)?;
            if n < 0 {
                fail(IllegalReason::IntegerOutOfRange, path)
            } else {
                Ok(Val::Int(n))
            }
        }
        Kind::Enum(words) => match v {
            Json::Str(s) => match words.iter().find(|w| **w == s.as_str()) {
                Some(w) => Ok(Val::Word(w)),
                None => fail(IllegalReason::IllegalEnumValue, path),
            },
            _ => fail(IllegalReason::WrongType, path),
        },
        Kind::Event => check_event(v, path).map(Val::Event),
        Kind::OptEvent => match v {
            Json::Null => Ok(Val::Null),
            _ => check_event(v, path).map(Val::Event),
        },
        Kind::Evidence => check_evidence(v, path).map(Val::Evidence),
        Kind::Text => match v {
            Json::Str(s) => Ok(Val::Text(s.clone())),
            _ => fail(IllegalReason::WrongType, path),
        },
    }
}

/// Checks that `members` has exactly the `required` names: missing first (schema order),
/// then unknown (byte order of the key).
fn check_members(members: &BTreeMap<String, Json>, required: &[&str], prefix: &str) -> Check<()> {
    let at = |name: &str| {
        if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}.{name}")
        }
    };
    if let Some(name) = required.iter().find(|n| !members.contains_key(**n)) {
        return fail(IllegalReason::MissingRequiredField, at(name));
    }
    if let Some(extra) = members.keys().find(|k| !required.contains(&k.as_str())) {
        return fail(IllegalReason::UnknownField, at(extra));
    }
    Ok(())
}

fn check_item(schema: OutputSchema, index: usize, v: &Json) -> Check<Item> {
    let prefix = format!("items[{index}]");
    let Json::Object(members) = v else {
        return fail(IllegalReason::WrongType, prefix);
    };
    let fields = item_fields(schema);
    let names: Vec<&str> = fields.iter().map(|(n, _)| *n).collect();
    check_members(members, &names, &prefix)?;
    let mut item = Item::new();
    for (name, kind) in fields {
        if let Some(value) = members.get(*name) {
            let val = check_value(*kind, value, &format!("{prefix}.{name}"))?;
            item.insert(name, val);
        }
    }
    Ok(item)
}

fn check_synthesis(ctx: &FrozenContext, schema: OutputSchema, value: &Json) -> Check<Verdict> {
    let (typed, persons, events) = check_answer(schema, value)?;
    let known_persons: BTreeSet<i64> = ctx.people.iter().map(|p| p.id.0).collect();
    let known_events: BTreeSet<&str> = ctx.events.iter().map(|e| e.id.as_str()).collect();
    Ok(Verdict::Synthesis {
        answer: typed,
        missing_persons: persons
            .into_iter()
            .filter(|p| !known_persons.contains(p))
            .collect(),
        missing_events: events
            .into_iter()
            .filter(|e| !known_events.contains(e.as_str()))
            .collect(),
    })
}

/// Checks an S answer against the family schema alone (no context) and returns the typed
/// answer with every person ID and event ID it names.
fn check_answer(
    schema: OutputSchema,
    value: &Json,
) -> Check<(SynthesisAnswer, BTreeSet<i64>, BTreeSet<String>)> {
    let Json::Object(top) = value else {
        return fail(IllegalReason::WrongType, "$");
    };
    check_members(top, &["schema", "items"], "")?;
    match top.get("schema") {
        Some(Json::Str(s)) if s == answer::schema_name(schema) => {}
        Some(Json::Str(_)) => return fail(IllegalReason::WrongSchemaConst, "schema"),
        _ => return fail(IllegalReason::WrongType, "schema"),
    }
    let Some(Json::Array(raw_items)) = top.get("items") else {
        return fail(IllegalReason::WrongType, "items");
    };
    let mut items = Vec::with_capacity(raw_items.len());
    for (i, raw) in raw_items.iter().enumerate() {
        items.push(check_item(schema, i, raw)?);
    }
    let Some(typed) = build(schema, &items) else {
        return fail(IllegalReason::WrongType, "items");
    };
    let (persons, events) = references(&items);
    Ok((typed, persons, events))
}

/// Reads a typed S answer back from the JSON written by `answer::to_json`. The schema is
/// taken from the value's own `schema` member. `None` when the value is not a legal answer.
pub fn read_answer(value: &Json) -> Option<SynthesisAnswer> {
    let Json::Object(top) = value else {
        return None;
    };
    let Some(Json::Str(name)) = top.get("schema") else {
        return None;
    };
    let schema = [
        OutputSchema::GrudgeV1,
        OutputSchema::DebtChainV1,
        OutputSchema::BrokenPromiseV1,
        OutputSchema::RelationshipShiftV1,
    ]
    .into_iter()
    .find(|s| answer::schema_name(*s) == name)?;
    check_answer(schema, value).ok().map(|(a, _, _)| a)
}

/// Person fields and event fields per R4.7, collected as sorted sets.
fn references(items: &[Item]) -> (BTreeSet<i64>, BTreeSet<String>) {
    const PERSON: &[&str] = &[
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
    let mut persons = BTreeSet::new();
    let mut events = BTreeSet::new();
    for item in items {
        for (name, val) in item {
            match val {
                Val::Int(n) if PERSON.contains(name) => {
                    persons.insert(*n);
                }
                Val::Event(e) => {
                    events.insert(e.as_str().to_owned());
                }
                Val::Evidence(es) => {
                    events.extend(es.iter().map(|e| e.as_str().to_owned()));
                }
                _ => {}
            }
        }
    }
    (persons, events)
}

// ---- typed items (members were checked, so the fallbacks are unreachable) ----

fn int(item: &Item, name: &str) -> i64 {
    match item.get(name) {
        Some(Val::Int(n)) => *n,
        _ => 0,
    }
}

fn opt_int(item: &Item, name: &str) -> Option<i64> {
    match item.get(name) {
        Some(Val::Int(n)) => Some(*n),
        _ => None,
    }
}

fn word(item: &Item, name: &str) -> &'static str {
    match item.get(name) {
        Some(Val::Word(w)) => w,
        _ => "",
    }
}

fn event(item: &Item, name: &str) -> Option<EventId> {
    match item.get(name) {
        Some(Val::Event(e)) => Some(e.clone()),
        _ => None,
    }
}

fn evidence(item: &Item) -> Vec<EventId> {
    match item.get("evidence") {
        Some(Val::Evidence(v)) => v.clone(),
        _ => Vec::new(),
    }
}

fn reason(item: &Item) -> String {
    match item.get("reason") {
        Some(Val::Text(s)) => s.clone(),
        _ => String::new(),
    }
}

fn level(w: &str) -> Level {
    match w {
        "medium" => Level::Medium,
        "high" => Level::High,
        _ => Level::Low,
    }
}

fn debt_status(w: &str) -> DebtStatus {
    match w {
        "repaid" => DebtStatus::Repaid,
        "transferred" => DebtStatus::Transferred,
        "forgiven" => DebtStatus::Forgiven,
        _ => DebtStatus::Open,
    }
}

fn promise_status(w: &str) -> PromiseStatus {
    match w {
        "pending" => PromiseStatus::Pending,
        "kept" => PromiseStatus::Kept,
        _ => PromiseStatus::Broken,
    }
}

fn direction(w: &str) -> Direction {
    match w {
        "colder" => Direction::Colder,
        "unchanged" => Direction::Unchanged,
        "reversed" => Direction::Reversed,
        _ => Direction::Warmer,
    }
}

fn build(schema: OutputSchema, items: &[Item]) -> Option<SynthesisAnswer> {
    Some(match schema {
        OutputSchema::GrudgeV1 => SynthesisAnswer::Grudge(
            items
                .iter()
                .map(|i| GrudgeItem {
                    from: int(i, "from"),
                    to: int(i, "to"),
                    level: level(word(i, "level")),
                    evidence: evidence(i),
                    reason: reason(i),
                })
                .collect(),
        ),
        OutputSchema::DebtChainV1 => SynthesisAnswer::DebtChain(
            items
                .iter()
                .map(|i| {
                    Some(DebtItem {
                        debtor: int(i, "debtor"),
                        creditor: int(i, "creditor"),
                        amount: int(i, "amount"),
                        status: debt_status(word(i, "status")),
                        origin_event: event(i, "origin_event")?,
                        transferred_from: opt_int(i, "transferred_from"),
                        evidence: evidence(i),
                        reason: reason(i),
                    })
                })
                .collect::<Option<Vec<_>>>()?,
        ),
        OutputSchema::BrokenPromiseV1 => SynthesisAnswer::BrokenPromise(
            items
                .iter()
                .map(|i| {
                    Some(PromiseItem {
                        promisor: int(i, "promisor"),
                        promisee: int(i, "promisee"),
                        promise_event: event(i, "promise_event")?,
                        status: promise_status(word(i, "status")),
                        evidence: evidence(i),
                        reason: reason(i),
                    })
                })
                .collect::<Option<Vec<_>>>()?,
        ),
        OutputSchema::RelationshipShiftV1 => SynthesisAnswer::RelationshipShift(
            items
                .iter()
                .map(|i| ShiftItem {
                    a: int(i, "a"),
                    b: int(i, "b"),
                    direction: direction(word(i, "direction")),
                    turning_point: event(i, "turning_point"),
                    evidence: evidence(i),
                    reason: reason(i),
                })
                .collect(),
        ),
    })
}
