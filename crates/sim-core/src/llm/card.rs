//! Card parser: one JSON Lines row into `(CardMeta, FrozenContext, AnswerKey, Option<Contrast>)`.
//!
//! - [`CardMeta`] (`id`, `scenario_group`, `split`, `scored`, `author_note`) is returned
//!   beside the other parts and is never an input of rendering or validation.
//! - Every number in the line must be an integer in `i64`; a number with a fraction or
//!   exponent is a `parse_failure` error that names the line (R2.9).
//! - A severe condition outside the list of the card schema, or a pattern field outside
//!   the field set of the card's output schema, is an `answer_key` error (R5.11).
//! - Structural checks: 2 to 5 unique options for a decision card, events sorted by tick.
//!
//! Integers, strings and ordered collections only.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use super::json::{self, Json};
use super::key::{AnswerKey, Pattern, PatternValue, Scalar, SevereCondition};
use super::{
    Event, EventId, Family, FrozenContext, OptionDef, OptionId, OutputSchema, Person, PersonId,
    PlayerInput, Relation, Task, TaskSpec, Traits,
};

/// Which part of the card a [`CardError`] belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CardErrorKind {
    /// The line is not valid JSON, or a number is not an integer in `i64`.
    ParseFailure,
    /// Top-level metadata, or fields that belong to no other part.
    Meta,
    /// The Frozen_Context, including its options and event order.
    Context,
    /// `acceptable`, `severe`, `gold`, severe conditions and patterns (R5.11).
    AnswerKey,
    /// The `contrast` member.
    Contrast,
}

impl CardErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ParseFailure => "parse_failure",
            Self::Meta => "meta",
            Self::Context => "context",
            Self::AnswerKey => "answer_key",
            Self::Contrast => "contrast",
        }
    }
}

/// A card parse failure. `line` is the 1-based line number given to [`parse_card`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardError {
    pub line: usize,
    pub kind: CardErrorKind,
    /// Dotted path of the offending member; empty when it applies to the whole line.
    pub path: String,
    pub detail: String,
}

impl fmt::Display for CardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "line {}: {}: {}",
            self.line,
            self.kind.as_str(),
            self.detail
        )?;
        if !self.path.is_empty() {
            write!(f, " at {}", self.path)?;
        }
        Ok(())
    }
}

impl std::error::Error for CardError {}

type R<T> = Result<T, CardError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Split {
    Dev,
    Locked,
}

/// Card metadata. Never reaches rendering or validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardMeta {
    pub id: String,
    pub scenario_group: String,
    pub split: Split,
    pub scored: bool,
    pub author_note: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ContrastRole {
    A,
    B,
}

/// What a contrast pair expects for one of its two cards.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExpectedSide {
    /// Decision cards: a non-empty set of option IDs.
    Options(BTreeSet<OptionId>),
    /// Synthesis cards: include and exclude pattern lists.
    Patterns {
        include: Vec<Pattern>,
        exclude: Vec<Pattern>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Contrast {
    pub pair_id: String,
    pub role: ContrastRole,
    pub changed_fact: String,
    pub expected_a: ExpectedSide,
    pub expected_b: ExpectedSide,
}

/// The four parts of a parsed card.
pub type ParsedCard = (CardMeta, FrozenContext, AnswerKey, Option<Contrast>);

const SYNTHESIS_ONLY: [&str; 4] = [
    "output_schema",
    "gold",
    "severe_conditions",
    "severe_patterns",
];
const DECISION_ONLY: [&str; 3] = ["options", "acceptable", "severe"];

const FAMILIES: [&str; 11] = [
    "dream_interpretation",
    "will_execution",
    "reconcile_or_revenge",
    "debt_repayment",
    "remarriage",
    "magistrate_ruling",
    "grudge_detection",
    "debt_chain",
    "broken_promise",
    "relationship_shift",
    "sanity",
];
const SCHEMAS: [&str; 4] = [
    "grudge_v1",
    "debt_chain_v1",
    "broken_promise_v1",
    "relationship_shift_v1",
];
const SEVERE: [(&str, SevereCondition); 7] = [
    ("invented_event_id", SevereCondition::InventedEventId),
    ("invented_person", SevereCondition::InventedPerson),
    ("reversed_direction", SevereCondition::ReversedDirection),
    (
        "dead_person_as_actor_after_death",
        SevereCondition::DeadPersonAsActorAfterDeath,
    ),
    ("contradicts_fact", SevereCondition::ContradictsFact),
    ("self_reference", SevereCondition::SelfReference),
    ("wrong_debt_holder", SevereCondition::WrongDebtHolder),
];
const SEXES: [&str; 2] = ["female", "male"];
const ORIGINS: [&str; 4] = ["native", "possessed", "rebuilt", "official"];
const INTENTS: [&str; 6] = [
    "warn",
    "reassure",
    "urge",
    "reveal",
    "request_offering",
    "forbid",
];
const RELATION_TAGS: [&str; 16] = [
    "parent",
    "child",
    "sibling",
    "spouse",
    "former_spouse",
    "grandparent",
    "grandchild",
    "cousin",
    "in_law",
    "friend",
    "rival",
    "neighbor",
    "employer",
    "employee",
    "suitor",
    "former_suitor",
];
const EVENT_TYPES: [&str; 28] = [
    "birth",
    "death",
    "illness",
    "accident",
    "marriage",
    "courtship",
    "deal",
    "loan",
    "repayment",
    "debt_transfer",
    "debt_forgiven",
    "promise",
    "promise_kept",
    "will",
    "inheritance",
    "insult",
    "apology",
    "help",
    "gift",
    "quarrel",
    "theft",
    "lawsuit",
    "offering",
    "dream",
    "haunting",
    "possession",
    "rebuild",
    "appeal",
];
const EVENT_TAGS: [&str; 13] = [
    "public",
    "private",
    "witnessed",
    "written",
    "verbal",
    "partial",
    "cash",
    "joss_paper",
    "land",
    "house",
    "shop",
    "heirloom",
    "deathbed",
];

fn bad(kind: CardErrorKind, path: &str, detail: &str) -> CardError {
    CardError {
        line: 0,
        kind,
        path: path.to_owned(),
        detail: detail.to_owned(),
    }
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_owned()
    } else {
        format!("{path}.{key}")
    }
}

fn indexed(path: &str, i: usize) -> String {
    format!("{path}[{i}]")
}

fn j_int(kind: CardErrorKind, path: &str, v: &Json, min: i64, max: i64) -> R<i64> {
    match v {
        Json::Number(lexeme) => {
            let n = json::integer_value(lexeme)
                .map_err(|_| bad(CardErrorKind::ParseFailure, path, "non_integer_number"))?;
            if (min..=max).contains(&n) {
                Ok(n)
            } else {
                Err(bad(kind, path, "out_of_range"))
            }
        }
        _ => Err(bad(kind, path, "wrong_type")),
    }
}

fn j_str(kind: CardErrorKind, path: &str, v: Json) -> R<String> {
    match v {
        Json::Str(s) => Ok(s),
        _ => Err(bad(kind, path, "wrong_type")),
    }
}

fn j_text(kind: CardErrorKind, path: &str, v: Json) -> R<String> {
    let s = j_str(kind, path, v)?;
    if s.is_empty() {
        Err(bad(kind, path, "empty_string"))
    } else {
        Ok(s)
    }
}

fn j_array(kind: CardErrorKind, path: &str, v: Json) -> R<Vec<Json>> {
    match v {
        Json::Array(items) => Ok(items),
        _ => Err(bad(kind, path, "wrong_type")),
    }
}

fn j_choice(kind: CardErrorKind, path: &str, v: Json, allowed: &[&str]) -> R<String> {
    let s = j_str(kind, path, v)?;
    if allowed.contains(&s.as_str()) {
        Ok(s)
    } else {
        Err(bad(kind, path, "illegal_enum_value"))
    }
}

fn j_event_id(kind: CardErrorKind, path: &str, v: Json) -> R<EventId> {
    let s = j_str(kind, path, v)?;
    EventId::new(&s).ok_or_else(|| bad(kind, path, "malformed_event_id"))
}

fn j_option_id(kind: CardErrorKind, path: &str, v: Json) -> R<OptionId> {
    let s = j_str(kind, path, v)?;
    OptionId::new(&s).ok_or_else(|| bad(kind, path, "malformed_option_id"))
}

/// An array of enum strings, optionally with unique entries.
fn j_choice_list(
    kind: CardErrorKind,
    path: &str,
    v: Json,
    allowed: &[&str],
    unique: bool,
) -> R<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for (i, item) in j_array(kind, path, v)?.into_iter().enumerate() {
        let p = indexed(path, i);
        let s = j_choice(kind, &p, item, allowed)?;
        if unique && out.contains(&s) {
            return Err(bad(kind, &p, "duplicate_item"));
        }
        out.push(s);
    }
    Ok(out)
}

fn j_event_id_list(kind: CardErrorKind, path: &str, v: Json) -> R<Vec<EventId>> {
    let mut out: Vec<EventId> = Vec::new();
    for (i, item) in j_array(kind, path, v)?.into_iter().enumerate() {
        let p = indexed(path, i);
        let id = j_event_id(kind, &p, item)?;
        if out.contains(&id) {
            return Err(bad(kind, &p, "duplicate_item"));
        }
        out.push(id);
    }
    Ok(out)
}

/// An array of unique option IDs.
fn j_option_set(kind: CardErrorKind, path: &str, v: Json) -> R<BTreeSet<OptionId>> {
    let mut out = BTreeSet::new();
    for (i, item) in j_array(kind, path, v)?.into_iter().enumerate() {
        let p = indexed(path, i);
        if !out.insert(j_option_id(kind, &p, item)?) {
            return Err(bad(kind, &p, "duplicate_item"));
        }
    }
    Ok(out)
}

/// An object whose members are taken out one by one; [`Obj::done`] rejects leftovers.
struct Obj {
    kind: CardErrorKind,
    path: String,
    map: BTreeMap<String, Json>,
}

impl Obj {
    fn new(kind: CardErrorKind, path: &str, v: Json) -> R<Self> {
        match v {
            Json::Object(map) => Ok(Self {
                kind,
                path: path.to_owned(),
                map,
            }),
            _ => Err(bad(kind, path, "wrong_type")),
        }
    }

    fn at(&self, key: &str) -> String {
        join(&self.path, key)
    }

    fn opt(&mut self, key: &str) -> Option<Json> {
        self.map.remove(key)
    }

    fn req(&mut self, key: &str) -> R<Json> {
        self.map
            .remove(key)
            .ok_or_else(|| bad(self.kind, &self.at(key), "missing_field"))
    }

    fn int(&mut self, key: &str, min: i64, max: i64) -> R<i64> {
        let v = self.req(key)?;
        j_int(self.kind, &self.at(key), &v, min, max)
    }

    fn text(&mut self, key: &str) -> R<String> {
        let v = self.req(key)?;
        j_text(self.kind, &self.at(key), v)
    }

    fn boolean(&mut self, key: &str) -> R<bool> {
        match self.req(key)? {
            Json::Bool(b) => Ok(b),
            _ => Err(bad(self.kind, &self.at(key), "wrong_type")),
        }
    }

    fn choice(&mut self, key: &str, allowed: &[&str]) -> R<String> {
        let v = self.req(key)?;
        j_choice(self.kind, &self.at(key), v, allowed)
    }

    fn array(&mut self, key: &str) -> R<Vec<Json>> {
        let v = self.req(key)?;
        j_array(self.kind, &self.at(key), v)
    }

    fn obj(&mut self, key: &str) -> R<Obj> {
        let v = self.req(key)?;
        Obj::new(self.kind, &self.at(key), v)
    }

    fn done(self) -> R<()> {
        match self.map.keys().next() {
            Some(k) => Err(bad(self.kind, &join(&self.path, k), "unknown_field")),
            None => Ok(()),
        }
    }
}

/// Rejects every number that is not an integer in `i64`, anywhere in the line (R2.9).
fn check_numbers(root: &Json) -> R<()> {
    let mut work: Vec<&Json> = vec![root];
    while let Some(v) = work.pop() {
        match v {
            Json::Number(lexeme) => {
                json::integer_value(lexeme).map_err(|reason| {
                    let detail = match reason {
                        super::IllegalReason::NonInteger => "non_integer_number",
                        _ => "integer_out_of_range",
                    };
                    bad(CardErrorKind::ParseFailure, "", detail)
                })?;
            }
            Json::Array(items) => work.extend(items.iter()),
            Json::Object(map) => work.extend(map.values()),
            Json::Null | Json::Bool(_) | Json::Str(_) => {}
        }
    }
    Ok(())
}

/// `^<prefix>[0-9]{3}$`
fn tagged3(s: &str, prefix: char) -> bool {
    s.strip_prefix(prefix)
        .is_some_and(|d| d.len() == 3 && d.bytes().all(|b| b.is_ascii_digit()))
}

/// `^(D|S)-[a-z_]+-[0-9]{3}$`; returns the leading letter.
fn card_id_kind(id: &str) -> Option<char> {
    let mut parts = id.splitn(3, '-');
    let head = parts.next()?;
    let middle = parts.next()?;
    let tail = parts.next()?;
    let ok = !middle.is_empty()
        && middle.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
        && tail.len() == 3
        && tail.bytes().all(|b| b.is_ascii_digit());
    match head {
        "D" if ok => Some('D'),
        "S" if ok => Some('S'),
        _ => None,
    }
}

fn family_of(name: &str) -> Option<Family> {
    Some(match name {
        "dream_interpretation" => Family::DreamInterpretation,
        "will_execution" => Family::WillExecution,
        "reconcile_or_revenge" => Family::ReconcileOrRevenge,
        "debt_repayment" => Family::DebtRepayment,
        "remarriage" => Family::Remarriage,
        "magistrate_ruling" => Family::MagistrateRuling,
        "grudge_detection" => Family::GrudgeDetection,
        "debt_chain" => Family::DebtChain,
        "broken_promise" => Family::BrokenPromise,
        "relationship_shift" => Family::RelationshipShift,
        "sanity" => Family::Sanity,
        _ => return None,
    })
}

fn schema_of(name: &str) -> Option<OutputSchema> {
    Some(match name {
        "grudge_v1" => OutputSchema::GrudgeV1,
        "debt_chain_v1" => OutputSchema::DebtChainV1,
        "broken_promise_v1" => OutputSchema::BrokenPromiseV1,
        "relationship_shift_v1" => OutputSchema::RelationshipShiftV1,
        _ => return None,
    })
}

/// The schema a non-sanity synthesis family must use.
fn family_schema(family: Family) -> Option<OutputSchema> {
    match family {
        Family::GrudgeDetection => Some(OutputSchema::GrudgeV1),
        Family::DebtChain => Some(OutputSchema::DebtChainV1),
        Family::BrokenPromise => Some(OutputSchema::BrokenPromiseV1),
        Family::RelationshipShift => Some(OutputSchema::RelationshipShiftV1),
        _ => None,
    }
}

fn is_synthesis_family(family: Family) -> bool {
    family_schema(family).is_some()
}

fn is_decision_family(family: Family) -> bool {
    !is_synthesis_family(family) && family != Family::Sanity
}

/// Item fields a pattern may name for each output schema (besides `evidence_any`).
fn pattern_fields(schema: OutputSchema) -> &'static [&'static str] {
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

fn scalar(path: &str, v: &Json) -> R<Scalar> {
    let kind = CardErrorKind::AnswerKey;
    match v {
        Json::Number(_) => Ok(Scalar::Int(j_int(kind, path, v, i64::MIN, i64::MAX)?)),
        Json::Str(s) => Ok(Scalar::Str(s.clone())),
        Json::Null => Ok(Scalar::Null),
        _ => Err(bad(kind, path, "wrong_type")),
    }
}

fn pattern(path: &str, v: Json, schema: OutputSchema) -> R<Pattern> {
    let kind = CardErrorKind::AnswerKey;
    let map = match v {
        Json::Object(map) => map,
        _ => return Err(bad(kind, path, "wrong_type")),
    };
    if map.is_empty() {
        return Err(bad(kind, path, "empty_pattern"));
    }
    let allowed = pattern_fields(schema);
    let mut fields = BTreeMap::new();
    let mut evidence_any = None;
    for (key, value) in map {
        let p = join(path, &key);
        if key == "evidence_any" {
            let ids = j_event_id_list(kind, &p, value)?;
            if ids.is_empty() {
                return Err(bad(kind, &p, "empty_evidence_any"));
            }
            evidence_any = Some(ids.into_iter().collect::<BTreeSet<_>>());
        } else if allowed.contains(&key.as_str()) {
            let pv = match value {
                Json::Array(items) => {
                    if items.is_empty() {
                        return Err(bad(kind, &p, "empty_any_of"));
                    }
                    let mut out = Vec::new();
                    for (i, item) in items.iter().enumerate() {
                        out.push(scalar(&indexed(&p, i), item)?);
                    }
                    PatternValue::AnyOf(out)
                }
                other => PatternValue::Exact(scalar(&p, &other)?),
            };
            fields.insert(key, pv);
        } else {
            return Err(bad(kind, &p, "unknown_pattern_field"));
        }
    }
    Ok(Pattern {
        fields,
        evidence_any,
    })
}

fn pattern_list(path: &str, v: Json, schema: OutputSchema) -> R<Vec<Pattern>> {
    let mut out = Vec::new();
    for (i, item) in j_array(CardErrorKind::AnswerKey, path, v)?
        .into_iter()
        .enumerate()
    {
        out.push(pattern(&indexed(path, i), item, schema)?);
    }
    Ok(out)
}

fn severe_condition(path: &str, v: Json) -> R<SevereCondition> {
    let kind = CardErrorKind::AnswerKey;
    let s = j_str(kind, path, v)?;
    SEVERE
        .iter()
        .find(|(name, _)| *name == s)
        .map(|(_, c)| *c)
        .ok_or_else(|| bad(kind, path, "unknown_severe_condition"))
}

fn traits(mut o: Obj) -> R<Traits> {
    let t = Traits {
        greed: o.int("greed", -3, 3)?,
        loyalty: o.int("loyalty", -3, 3)?,
        pride: o.int("pride", -3, 3)?,
        warmth: o.int("warmth", -3, 3)?,
        temper: o.int("temper", -3, 3)?,
        vindictiveness: o.int("vindictiveness", -3, 3)?,
        piety: o.int("piety", -3, 3)?,
    };
    o.done()?;
    Ok(t)
}

fn person(path: &str, v: Json) -> R<Person> {
    let mut o = Obj::new(CardErrorKind::Context, path, v)?;
    let p = Person {
        id: PersonId(o.int("id", 1, i64::MAX)?),
        name: o.text("name")?,
        age: o.int("age", 0, 999)?,
        sex: o.choice("sex", &SEXES)?,
        alive: o.boolean("alive")?,
        origin: o.choice("origin", &ORIGINS)?,
        traits: traits(o.obj("traits")?)?,
        wealth: o.int("wealth", 0, i64::MAX)?,
        soul_id: {
            let s = o.text("soul_id")?;
            let ok = s
                .strip_prefix("S-")
                .is_some_and(|d| d.len() == 4 && d.bytes().all(|b| b.is_ascii_digit()));
            if !ok {
                return Err(bad(
                    CardErrorKind::Context,
                    &o.at("soul_id"),
                    "malformed_soul_id",
                ));
            }
            s
        },
    };
    o.done()?;
    Ok(p)
}

fn relation(path: &str, v: Json) -> R<Relation> {
    let kind = CardErrorKind::Context;
    let mut o = Obj::new(kind, path, v)?;
    let r = Relation {
        from: PersonId(o.int("from", i64::MIN, i64::MAX)?),
        to: PersonId(o.int("to", i64::MIN, i64::MAX)?),
        affinity: o.int("affinity", -100, 100)?,
        trust: o.int("trust", -100, 100)?,
        tags: {
            let v = o.req("tags")?;
            j_choice_list(kind, &o.at("tags"), v, &RELATION_TAGS, true)?
        },
    };
    o.done()?;
    Ok(r)
}

fn event(path: &str, v: Json) -> R<Event> {
    let kind = CardErrorKind::Context;
    let mut o = Obj::new(kind, path, v)?;
    let id = {
        let v = o.req("id")?;
        j_event_id(kind, &o.at("id"), v)?
    };
    let tick = o.int("tick", 0, i64::MAX)?;
    let ev_type = o.choice("type", &EVENT_TYPES)?;
    let actors = {
        let p = o.at("actors");
        let items = o.array("actors")?;
        if items.is_empty() {
            return Err(bad(kind, &p, "empty_actors"));
        }
        let mut out = Vec::new();
        for (i, item) in items.iter().enumerate() {
            out.push(PersonId(j_int(
                kind,
                &indexed(&p, i),
                item,
                i64::MIN,
                i64::MAX,
            )?));
        }
        out
    };
    let magnitude = o.int("magnitude", 0, i64::MAX)?;
    let due_tick = match o.opt("due_tick") {
        None => None,
        Some(v) => Some(j_int(kind, &o.at("due_tick"), &v, 0, i64::MAX)?),
    };
    let caused_by = {
        let v = o.req("caused_by")?;
        j_event_id_list(kind, &o.at("caused_by"), v)?
    };
    let tags = {
        let v = o.req("tags")?;
        j_choice_list(kind, &o.at("tags"), v, &EVENT_TAGS, true)?
    };
    o.done()?;
    Ok(Event {
        id,
        tick,
        kind: ev_type,
        actors,
        magnitude,
        due_tick,
        caused_by,
        tags,
    })
}

struct ContextParts {
    tick: i64,
    subject: Option<PersonId>,
    people: Vec<Person>,
    relations: Vec<Relation>,
    events: Vec<Event>,
    situation: String,
    player_input: Option<PlayerInput>,
}

fn context(v: Json) -> R<ContextParts> {
    let kind = CardErrorKind::Context;
    let mut o = Obj::new(kind, "context", v)?;
    let tick = o.int("tick", 0, i64::MAX)?;
    let subject = match o.req("subject")? {
        Json::Null => None,
        other => Some(PersonId(j_int(
            kind,
            &o.at("subject"),
            &other,
            i64::MIN,
            i64::MAX,
        )?)),
    };
    let people_path = o.at("people");
    let people = {
        let items = o.array("people")?;
        if items.is_empty() {
            return Err(bad(kind, &people_path, "empty_people"));
        }
        let mut out = Vec::new();
        for (i, item) in items.into_iter().enumerate() {
            out.push(person(&indexed(&people_path, i), item)?);
        }
        out
    };
    let relations = {
        let path = o.at("relations");
        let mut out = Vec::new();
        for (i, item) in o.array("relations")?.into_iter().enumerate() {
            out.push(relation(&indexed(&path, i), item)?);
        }
        out
    };
    let events_path = o.at("events");
    let events = {
        let mut out: Vec<Event> = Vec::new();
        for (i, item) in o.array("events")?.into_iter().enumerate() {
            let ev = event(&indexed(&events_path, i), item)?;
            if out.last().is_some_and(|prev| prev.tick > ev.tick) {
                return Err(bad(
                    kind,
                    &indexed(&events_path, i),
                    "events_not_sorted_by_tick",
                ));
            }
            out.push(ev);
        }
        out
    };
    let situation = o.text("situation")?;
    let player_input = match o.req("player_input")? {
        Json::Null => None,
        other => {
            let mut p = Obj::new(kind, &o.at("player_input"), other)?;
            let pi = PlayerInput {
                intent: p.choice("intent", &INTENTS)?,
                content: p.text("content")?,
            };
            p.done()?;
            Some(pi)
        }
    };
    o.done()?;
    Ok(ContextParts {
        tick,
        subject,
        people,
        relations,
        events,
        situation,
        player_input,
    })
}

fn options(v: Json) -> R<Vec<OptionDef>> {
    let kind = CardErrorKind::Context;
    let items = j_array(kind, "options", v)?;
    if !(2..=5).contains(&items.len()) {
        return Err(bad(kind, "options", "option_count_out_of_range"));
    }
    let mut out: Vec<OptionDef> = Vec::new();
    for (i, item) in items.into_iter().enumerate() {
        let path = indexed("options", i);
        let mut o = Obj::new(kind, &path, item)?;
        let id = {
            let v = o.req("id")?;
            j_option_id(kind, &o.at("id"), v)?
        };
        let label = o.text("label")?;
        o.done()?;
        if out.iter().any(|d| d.id == id) {
            return Err(bad(kind, &join(&path, "id"), "duplicate_option_id"));
        }
        out.push(OptionDef { id, label });
    }
    Ok(out)
}

fn in_options(
    defs: &[OptionDef],
    kind: CardErrorKind,
    path: &str,
    ids: &BTreeSet<OptionId>,
) -> R<()> {
    if ids.iter().all(|id| defs.iter().any(|d| &d.id == id)) {
        Ok(())
    } else {
        Err(bad(kind, path, "option_not_in_options"))
    }
}

fn expected_side(path: &str, v: Json, task: &TaskSpec) -> R<ExpectedSide> {
    let kind = CardErrorKind::Contrast;
    match task {
        TaskSpec::Decision { options } => {
            let ids = j_option_set(kind, path, v)?;
            if ids.is_empty() {
                return Err(bad(kind, path, "empty_expected"));
            }
            in_options(options, kind, path, &ids)?;
            Ok(ExpectedSide::Options(ids))
        }
        TaskSpec::Synthesis { schema } => {
            let mut o = Obj::new(kind, path, v)?;
            let include = {
                let v = o.req("include")?;
                pattern_list(&o.at("include"), v, *schema)?
            };
            let exclude = {
                let v = o.req("exclude")?;
                pattern_list(&o.at("exclude"), v, *schema)?
            };
            o.done()?;
            Ok(ExpectedSide::Patterns { include, exclude })
        }
    }
}

fn contrast(v: Json, task: &TaskSpec) -> R<Contrast> {
    let kind = CardErrorKind::Contrast;
    let mut o = Obj::new(kind, "contrast", v)?;
    let pair_id = o.text("pair_id")?;
    if !tagged3(&pair_id, 'P') {
        return Err(bad(kind, &o.at("pair_id"), "malformed_pair_id"));
    }
    let role = match o.choice("role", &["a", "b"])?.as_str() {
        "a" => ContrastRole::A,
        _ => ContrastRole::B,
    };
    let changed_fact = o.text("changed_fact")?;
    let mut e = o.obj("expected")?;
    let a = {
        let v = e.req("a")?;
        expected_side(&e.at("a"), v, task)?
    };
    let b = {
        let v = e.req("b")?;
        expected_side(&e.at("b"), v, task)?
    };
    e.done()?;
    o.done()?;
    Ok(Contrast {
        pair_id,
        role,
        changed_fact,
        expected_a: a,
        expected_b: b,
    })
}

/// Parses one card line. `line_no` (1-based) is only used to name the line in errors.
pub fn parse_card(line: &str, line_no: usize) -> Result<ParsedCard, CardError> {
    parse_inner(line).map_err(|mut e| {
        e.line = line_no;
        e
    })
}

fn parse_inner(line: &str) -> R<ParsedCard> {
    let root = json::parse(line).map_err(|e| bad(CardErrorKind::ParseFailure, "", e.detail))?;
    check_numbers(&root)?;
    let mut o = Obj::new(CardErrorKind::Meta, "", root)?;

    // Metadata.
    let id = o.text("id")?;
    let id_kind =
        card_id_kind(&id).ok_or_else(|| bad(CardErrorKind::Meta, "id", "malformed_id"))?;
    let task = match o.choice("task", &["decision", "synthesis"])?.as_str() {
        "decision" => Task::Decision,
        _ => Task::Synthesis,
    };
    if (task == Task::Decision) != (id_kind == 'D') {
        return Err(bad(CardErrorKind::Meta, "id", "id_task_mismatch"));
    }
    let family_name = o.choice("family", &FAMILIES)?;
    let family = family_of(&family_name)
        .ok_or_else(|| bad(CardErrorKind::Meta, "family", "illegal_enum_value"))?;
    let family_ok = match task {
        Task::Decision => is_decision_family(family) || family == Family::Sanity,
        Task::Synthesis => is_synthesis_family(family) || family == Family::Sanity,
    };
    if !family_ok {
        return Err(bad(CardErrorKind::Meta, "family", "family_task_mismatch"));
    }
    let scenario_group = o.text("scenario_group")?;
    if !tagged3(&scenario_group, 'G') {
        return Err(bad(
            CardErrorKind::Meta,
            "scenario_group",
            "malformed_scenario_group",
        ));
    }
    let split = match o.choice("split", &["dev", "locked"])?.as_str() {
        "dev" => Split::Dev,
        _ => Split::Locked,
    };
    let scored = o.boolean("scored")?;
    let author_note = o.text("author_note")?;
    let ctx = context(o.req("context")?)?;

    // Fields that belong to the other task type are an answer-key error.
    let forbidden: &[&str] = match task {
        Task::Decision => &SYNTHESIS_ONLY,
        Task::Synthesis => &DECISION_ONLY,
    };
    for name in forbidden {
        if o.map.contains_key(*name) {
            return Err(bad(
                CardErrorKind::AnswerKey,
                name,
                "field_not_allowed_for_task",
            ));
        }
    }

    let (spec, key) = match task {
        Task::Decision => {
            let defs = options(o.req("options")?)?;
            let kind = CardErrorKind::AnswerKey;
            let acceptable = j_option_set(kind, "acceptable", o.req("acceptable")?)?;
            if acceptable.is_empty() {
                return Err(bad(kind, "acceptable", "empty_acceptable"));
            }
            let severe = j_option_set(kind, "severe", o.req("severe")?)?;
            in_options(&defs, kind, "acceptable", &acceptable)?;
            in_options(&defs, kind, "severe", &severe)?;
            (
                TaskSpec::Decision { options: defs },
                AnswerKey::Decision { acceptable, severe },
            )
        }
        Task::Synthesis => {
            let kind = CardErrorKind::AnswerKey;
            let schema_name = o.choice("output_schema", &SCHEMAS).map_err(|mut e| {
                e.kind = kind;
                e
            })?;
            let schema = schema_of(&schema_name)
                .ok_or_else(|| bad(kind, "output_schema", "illegal_enum_value"))?;
            if let Some(required) = family_schema(family)
                && required != schema
            {
                return Err(bad(kind, "output_schema", "schema_family_mismatch"));
            }
            let mut gold = Obj::new(kind, "gold", o.req("gold")?)?;
            let must_include = {
                let v = gold.req("must_include")?;
                pattern_list(&gold.at("must_include"), v, schema)?
            };
            let must_not_include = {
                let v = gold.req("must_not_include")?;
                pattern_list(&gold.at("must_not_include"), v, schema)?
            };
            gold.done()?;
            let mut severe_conditions = BTreeSet::new();
            for (i, item) in j_array(kind, "severe_conditions", o.req("severe_conditions")?)?
                .into_iter()
                .enumerate()
            {
                let p = indexed("severe_conditions", i);
                if !severe_conditions.insert(severe_condition(&p, item)?) {
                    return Err(bad(kind, &p, "duplicate_item"));
                }
            }
            let mut severe_patterns = Vec::new();
            if let Some(v) = o.opt("severe_patterns") {
                for (i, item) in j_array(kind, "severe_patterns", v)?.into_iter().enumerate() {
                    let p = indexed("severe_patterns", i);
                    let mut sp = Obj::new(kind, &p, item)?;
                    let cond = {
                        let v = sp.req("condition")?;
                        severe_condition(&sp.at("condition"), v)?
                    };
                    let pat = {
                        let v = sp.req("pattern")?;
                        pattern(&sp.at("pattern"), v, schema)?
                    };
                    sp.done()?;
                    severe_patterns.push((cond, pat));
                }
            }
            (
                TaskSpec::Synthesis { schema },
                AnswerKey::Synthesis {
                    schema,
                    must_include,
                    must_not_include,
                    severe_conditions,
                    severe_patterns,
                },
            )
        }
    };
    let contrast = match o.opt("contrast") {
        None => None,
        Some(v) => Some(contrast(v, &spec)?),
    };
    o.done()?;

    let meta = CardMeta {
        id,
        scenario_group,
        split,
        scored,
        author_note,
    };
    let frozen = FrozenContext {
        task,
        family,
        tick: ctx.tick,
        subject: ctx.subject,
        people: ctx.people,
        relations: ctx.relations,
        events: ctx.events,
        situation: ctx.situation,
        player_input: ctx.player_input,
        spec,
    };
    Ok((meta, frozen, key, contrast))
}
