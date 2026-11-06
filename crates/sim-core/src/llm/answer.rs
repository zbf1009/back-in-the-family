//! Answer extraction (DA-5 B) and the typed S answer's canonical serialization.
//!
//! Extraction: strip ASCII whitespace; allow at most one Markdown code fence (an opening
//! line of three backticks, optionally followed by `json`, and a closing three backticks);
//! the rest must be exactly one JSON value. Anything else around the value is a
//! `ParseFailure`.
//!
//! Serialization: [`to_json`] turns a [`SynthesisAnswer`] into the family's JSON object
//! (the `schema` constant plus `items`) and [`canonical`] writes it with the canonical
//! writer, so parse, write, parse gives the same value (R4.10). Reading a [`Json`] value
//! back into typed items is the Output_Validator's job, not this module's.
//!
//! Integers, strings and ordered collections only: no floats, clocks, environment,
//! randomness or I/O.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::BTreeMap;

use super::json::{self, Json, JsonError};
use super::{
    DebtItem, DebtStatus, Direction, EventId, GrudgeItem, IllegalReason, Level, OutputSchema,
    PromiseItem, PromiseStatus, ShiftItem, SynthesisAnswer,
};

const FENCE: &str = "```";

fn parse_failure(detail: &'static str) -> JsonError {
    JsonError {
        reason: IllegalReason::ParseFailure,
        detail,
    }
}

fn trim_ascii_ws(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_ascii_whitespace())
}

/// Returns the text that must hold exactly one JSON value (DA-5 B steps 1 and 2).
///
/// Fails with `ParseFailure` (detail `fence`) when the text starts with a fence but the
/// opening line is not `` ``` `` or `` ```json ``, or the closing fence is missing.
pub fn extract(raw: &str) -> Result<&str, JsonError> {
    let text = trim_ascii_ws(raw);
    let Some(after_open) = text.strip_prefix(FENCE) else {
        return Ok(text);
    };
    let (open_line, rest) = after_open
        .split_once('\n')
        .ok_or_else(|| parse_failure("fence"))?;
    if !matches!(trim_ascii_ws(open_line), "" | "json") {
        return Err(parse_failure("fence"));
    }
    let body = trim_ascii_ws(rest)
        .strip_suffix(FENCE)
        .ok_or_else(|| parse_failure("fence"))?;
    Ok(trim_ascii_ws(body))
}

/// Extracts the JSON text from `raw` and parses it as exactly one JSON value.
pub fn parse_answer(raw: &str) -> Result<Json, JsonError> {
    json::parse(extract(raw)?)
}

/// The schema constant written in the `schema` member of an S answer.
pub fn schema_name(schema: OutputSchema) -> &'static str {
    match schema {
        OutputSchema::GrudgeV1 => "grudge_v1",
        OutputSchema::DebtChainV1 => "debt_chain_v1",
        OutputSchema::BrokenPromiseV1 => "broken_promise_v1",
        OutputSchema::RelationshipShiftV1 => "relationship_shift_v1",
    }
}

/// The schema a [`SynthesisAnswer`] belongs to.
pub fn schema_of(answer: &SynthesisAnswer) -> OutputSchema {
    match answer {
        SynthesisAnswer::Grudge(_) => OutputSchema::GrudgeV1,
        SynthesisAnswer::DebtChain(_) => OutputSchema::DebtChainV1,
        SynthesisAnswer::BrokenPromise(_) => OutputSchema::BrokenPromiseV1,
        SynthesisAnswer::RelationshipShift(_) => OutputSchema::RelationshipShiftV1,
    }
}

pub(super) fn level_str(v: Level) -> &'static str {
    match v {
        Level::Low => "low",
        Level::Medium => "medium",
        Level::High => "high",
    }
}

pub(super) fn debt_status_str(v: DebtStatus) -> &'static str {
    match v {
        DebtStatus::Open => "open",
        DebtStatus::Repaid => "repaid",
        DebtStatus::Transferred => "transferred",
        DebtStatus::Forgiven => "forgiven",
    }
}

pub(super) fn promise_status_str(v: PromiseStatus) -> &'static str {
    match v {
        PromiseStatus::Broken => "broken",
        PromiseStatus::Pending => "pending",
        PromiseStatus::Kept => "kept",
    }
}

pub(super) fn direction_str(v: Direction) -> &'static str {
    match v {
        Direction::Warmer => "warmer",
        Direction::Colder => "colder",
        Direction::Unchanged => "unchanged",
        Direction::Reversed => "reversed",
    }
}

fn event(id: &EventId) -> Json {
    Json::Str(id.as_str().to_owned())
}

fn opt_event(id: &Option<EventId>) -> Json {
    id.as_ref().map_or(Json::Null, event)
}

fn evidence(ids: &[EventId]) -> Json {
    Json::Array(ids.iter().map(event).collect())
}

fn text(s: &str) -> Json {
    Json::Str(s.to_owned())
}

fn object(members: Vec<(&str, Json)>) -> Json {
    let map: BTreeMap<String, Json> = members
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
    Json::Object(map)
}

fn grudge(i: &GrudgeItem) -> Json {
    object(vec![
        ("from", Json::int(i.from)),
        ("to", Json::int(i.to)),
        ("level", text(level_str(i.level))),
        ("evidence", evidence(&i.evidence)),
        ("reason", text(&i.reason)),
    ])
}

fn debt(i: &DebtItem) -> Json {
    object(vec![
        ("debtor", Json::int(i.debtor)),
        ("creditor", Json::int(i.creditor)),
        ("amount", Json::int(i.amount)),
        ("status", text(debt_status_str(i.status))),
        ("origin_event", event(&i.origin_event)),
        (
            "transferred_from",
            i.transferred_from.map_or(Json::Null, Json::int),
        ),
        ("evidence", evidence(&i.evidence)),
        ("reason", text(&i.reason)),
    ])
}

fn promise(i: &PromiseItem) -> Json {
    object(vec![
        ("promisor", Json::int(i.promisor)),
        ("promisee", Json::int(i.promisee)),
        ("promise_event", event(&i.promise_event)),
        ("status", text(promise_status_str(i.status))),
        ("evidence", evidence(&i.evidence)),
        ("reason", text(&i.reason)),
    ])
}

fn shift(i: &ShiftItem) -> Json {
    object(vec![
        ("a", Json::int(i.a)),
        ("b", Json::int(i.b)),
        ("direction", text(direction_str(i.direction))),
        ("turning_point", opt_event(&i.turning_point)),
        ("evidence", evidence(&i.evidence)),
        ("reason", text(&i.reason)),
    ])
}

/// The family's JSON object for `answer`: the `schema` constant plus `items`, in item order.
pub fn to_json(answer: &SynthesisAnswer) -> Json {
    let items: Vec<Json> = match answer {
        SynthesisAnswer::Grudge(v) => v.iter().map(grudge).collect(),
        SynthesisAnswer::DebtChain(v) => v.iter().map(debt).collect(),
        SynthesisAnswer::BrokenPromise(v) => v.iter().map(promise).collect(),
        SynthesisAnswer::RelationshipShift(v) => v.iter().map(shift).collect(),
    };
    object(vec![
        ("schema", text(schema_name(schema_of(answer)))),
        ("items", Json::Array(items)),
    ])
}

/// Canonical JSON text of `answer` (byte-order keys, no whitespace, shortest integers).
pub fn canonical(answer: &SynthesisAnswer) -> String {
    json::write(&to_json(answer))
}
