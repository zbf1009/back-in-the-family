//! Shared `proptest` generators for the llm-probe properties (spec task 1.4).
//!
//! Included by `llm_properties.rs` with `mod llm_gen;`. It builds, from the card schema:
//!
//! * Frozen_Contexts: 2..=5 unique options (D) or a schema (S), 1..=12 people,
//!   0..=12 events in tick order with random same-tick blocks, optional fields `None`,
//!   present or empty, and `due_tick` present (on `loan` / `promise`) or absent;
//! * answer keys that refer only to a given context;
//! * legal D and S answers built from a context, as model-output text plus the typed
//!   value the Output_Validator must return;
//! * the Dev_Cards of `eval/cards/cards/dev.jsonl` (read only), parsed with
//!   `parse_card`, as seeds.
//!
//! Each generator draws raw numbers and builds the value deterministically, so shrinking
//! stays simple and every generated value is structurally valid by construction. This
//! file never reads the locked split.

// Later property tests (1.5 onward) use items that the smoke tests here do not.
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use sim_core::llm::card::{
    CardMeta, Contrast, ContrastRole, ExpectedSide, ParsedCard, Split, parse_card,
};
use sim_core::llm::json::{self, Json};
use sim_core::llm::{
    AnswerKey, DebtItem, DebtStatus, Direction, Event, EventId, Family, FrozenContext, GrudgeItem,
    Level, OptionDef, OptionId, OutputSchema, Pattern, PatternValue, Person, PersonId, PlayerInput,
    PromiseItem, PromiseStatus, Relation, Scalar, SevereCondition, ShiftItem, SynthesisAnswer,
    Task, TaskSpec, Traits,
};

const KINDS: [&str; 10] = [
    "death",
    "offering",
    "dream",
    "loan",
    "promise",
    "repayment",
    "quarrel",
    "gift",
    "marriage",
    "birth",
];
/// Event tags of the card schema.
const TAGS: [&str; 6] = [
    "joss_paper",
    "public",
    "private",
    "written",
    "witnessed",
    "cash",
];
/// Relation tags of the card schema.
const REL_TAGS: [&str; 6] = ["parent", "child", "sibling", "friend", "rival", "neighbor"];
const ORIGINS: [&str; 4] = ["native", "possessed", "rebuilt", "official"];
const INTENTS: [&str; 4] = ["warn", "reassure", "urge", "forbid"];
const OPTION_POOL: [&str; 12] = [
    "heed_warning",
    "burn_offering",
    "dismiss_dream",
    "read_as_blessing",
    "forgive",
    "seek_revenge",
    "pay_in_full",
    "stall",
    "split_estate",
    "remarry",
    "stay_single",
    "defer_to_magistrate",
];
const DECISION_FAMILIES: [Family; 7] = [
    Family::DreamInterpretation,
    Family::WillExecution,
    Family::ReconcileOrRevenge,
    Family::DebtRepayment,
    Family::Remarriage,
    Family::MagistrateRuling,
    Family::Sanity,
];
const SCHEMAS: [OutputSchema; 4] = [
    OutputSchema::GrudgeV1,
    OutputSchema::DebtChainV1,
    OutputSchema::BrokenPromiseV1,
    OutputSchema::RelationshipShiftV1,
];
const SEVERE_ALL: [SevereCondition; 7] = [
    SevereCondition::InventedEventId,
    SevereCondition::InventedPerson,
    SevereCondition::SelfReference,
    SevereCondition::ReversedDirection,
    SevereCondition::DeadPersonAsActorAfterDeath,
    SevereCondition::ContradictsFact,
    SevereCondition::WrongDebtHolder,
];
const LEVELS: [Level; 3] = [Level::Low, Level::Medium, Level::High];
const DEBT_STATUS: [DebtStatus; 4] = [
    DebtStatus::Open,
    DebtStatus::Repaid,
    DebtStatus::Transferred,
    DebtStatus::Forgiven,
];
const PROMISE_STATUS: [PromiseStatus; 3] = [
    PromiseStatus::Broken,
    PromiseStatus::Pending,
    PromiseStatus::Kept,
];
const DIRECTIONS: [Direction; 4] = [
    Direction::Warmer,
    Direction::Colder,
    Direction::Unchanged,
    Direction::Reversed,
];

/// The schema's `const` name.
pub fn schema_name(schema: OutputSchema) -> &'static str {
    match schema {
        OutputSchema::GrudgeV1 => "grudge_v1",
        OutputSchema::DebtChainV1 => "debt_chain_v1",
        OutputSchema::BrokenPromiseV1 => "broken_promise_v1",
        OutputSchema::RelationshipShiftV1 => "relationship_shift_v1",
    }
}

pub fn level_name(v: Level) -> &'static str {
    match v {
        Level::Low => "low",
        Level::Medium => "medium",
        Level::High => "high",
    }
}

pub fn debt_status_name(v: DebtStatus) -> &'static str {
    match v {
        DebtStatus::Open => "open",
        DebtStatus::Repaid => "repaid",
        DebtStatus::Transferred => "transferred",
        DebtStatus::Forgiven => "forgiven",
    }
}

pub fn promise_status_name(v: PromiseStatus) -> &'static str {
    match v {
        PromiseStatus::Broken => "broken",
        PromiseStatus::Pending => "pending",
        PromiseStatus::Kept => "kept",
    }
}

pub fn direction_name(v: Direction) -> &'static str {
    match v {
        Direction::Warmer => "warmer",
        Direction::Colder => "colder",
        Direction::Unchanged => "unchanged",
        Direction::Reversed => "reversed",
    }
}

// ---------------------------------------------------------------------------
// Frozen_Contexts
// ---------------------------------------------------------------------------

type PersonRaw = (String, i64, bool, bool, usize, [i64; 7], i64, u32);
type EventRaw = (
    usize,
    Vec<usize>,
    Vec<usize>,
    i64,
    Option<i64>,
    Vec<usize>,
    i64,
);
type RelationRaw = (usize, usize, i64, i64, Vec<usize>);

fn person_raw() -> impl Strategy<Value = PersonRaw> {
    (
        "[A-Z][a-z]{2,8} [A-Z][a-z]{2,10}",
        0i64..=110,
        any::<bool>(),
        any::<bool>(),
        0usize..ORIGINS.len(),
        prop::array::uniform7(-3i64..=3),
        0i64..=2_000_000,
        0u32..10_000,
    )
}

fn event_raw() -> impl Strategy<Value = EventRaw> {
    (
        0usize..KINDS.len(),
        prop::collection::vec(0usize..64, 0..=3),
        prop::collection::vec(0usize..64, 0..=2),
        0i64..=10_000,
        prop::option::of(1i64..=400),
        prop::collection::vec(0usize..TAGS.len(), 0..=2),
        // Tick step from the previous event. Zero is common, so same-tick blocks appear.
        prop_oneof![3 => Just(0i64), 2 => 1i64..=5, 1 => 1i64..=500],
    )
}

fn relation_raw() -> impl Strategy<Value = RelationRaw> {
    (
        0usize..64,
        0usize..64,
        -100i64..=100,
        0i64..=100,
        prop::collection::vec(0usize..REL_TAGS.len(), 0..=2),
    )
}

/// Everything the context builder needs, drawn up front.
#[derive(Debug, Clone)]
struct ContextRaw {
    person_ids: Vec<i64>,
    persons: Vec<PersonRaw>,
    events: Vec<EventRaw>,
    event_ids: Vec<u32>,
    relations: Vec<RelationRaw>,
    base_tick: i64,
    tail: i64,
    subject: Option<usize>,
    situation: String,
    player_input: Option<(usize, String)>,
}

fn context_raw() -> impl Strategy<Value = ContextRaw> {
    (1usize..=12, 0usize..=12)
        .prop_flat_map(|(np, ne)| {
            (
                prop::collection::btree_set(1i64..=40, np..=np),
                prop::collection::vec(person_raw(), np..=np),
                prop::collection::vec(event_raw(), ne..=ne),
                prop::collection::btree_set(1u32..=9999, ne..=ne)
                    .prop_map(|s| s.into_iter().collect::<Vec<_>>())
                    .prop_shuffle(),
                prop::collection::vec(relation_raw(), 0..=8),
                0i64..=40_000,
                0i64..=50,
                prop::option::of(0usize..64),
                "\\PC{1,200}",
                prop::option::of((0usize..INTENTS.len(), "\\PC{0,80}")),
            )
        })
        .prop_map(
            |(
                ids,
                persons,
                events,
                event_ids,
                relations,
                base_tick,
                tail,
                subject,
                situation,
                player_input,
            )| ContextRaw {
                person_ids: ids.into_iter().collect(),
                persons,
                events,
                event_ids,
                relations,
                base_tick,
                tail,
                subject,
                situation,
                player_input,
            },
        )
}

fn event_id(n: u32) -> EventId {
    EventId::new(&format!("e{n}")).expect("e1..e9999 matches the pattern")
}

fn build_context(raw: ContextRaw, task: Task, family: Family, spec: TaskSpec) -> FrozenContext {
    let np = raw.person_ids.len();
    let people: Vec<Person> = raw
        .person_ids
        .iter()
        .zip(raw.persons)
        .map(
            |(id, (name, age, male, alive, origin, t, wealth, soul))| Person {
                id: PersonId(*id),
                name,
                age,
                sex: if male { "male" } else { "female" }.to_owned(),
                alive,
                origin: ORIGINS[origin].to_owned(),
                traits: Traits {
                    greed: t[0],
                    loyalty: t[1],
                    pride: t[2],
                    warmth: t[3],
                    temper: t[4],
                    vindictiveness: t[5],
                    piety: t[6],
                },
                wealth,
                soul_id: format!("S-{soul:04}"),
            },
        )
        .collect();

    let mut tick = raw.base_tick;
    let mut events: Vec<Event> = Vec::new();
    for (i, (kind, actors, causes, magnitude, due, tags, step)) in
        raw.events.into_iter().enumerate()
    {
        tick += step;
        let kind_name = KINDS[kind];
        let mut seen = BTreeSet::new();
        let actors = actors
            .into_iter()
            .map(|a| raw.person_ids[a % np])
            .filter(|a| seen.insert(*a))
            .map(PersonId)
            .collect();
        let mut seen = BTreeSet::new();
        let caused_by = if i == 0 {
            Vec::new()
        } else {
            causes
                .into_iter()
                .map(|c| c % i)
                .filter(|c| seen.insert(*c))
                .map(|c| event_id(raw.event_ids[c]))
                .collect()
        };
        let due_tick = match kind_name {
            "loan" | "promise" => due.map(|d| tick + d),
            _ => None,
        };
        let mut seen = BTreeSet::new();
        let tags = tags
            .into_iter()
            .filter(|t| seen.insert(*t))
            .map(|t| TAGS[t].to_owned())
            .collect();
        events.push(Event {
            id: event_id(raw.event_ids[i]),
            tick,
            kind: kind_name.to_owned(),
            actors,
            magnitude,
            due_tick,
            caused_by,
            tags,
        });
    }

    let mut relations: Vec<Relation> = Vec::new();
    if np >= 2 {
        let mut seen = BTreeSet::new();
        for (f, t, affinity, trust, tags) in raw.relations {
            let from = f % np;
            let to = (from + 1 + t % (np - 1)) % np;
            if !seen.insert((from, to)) {
                continue;
            }
            let mut tag_seen = BTreeSet::new();
            relations.push(Relation {
                from: PersonId(raw.person_ids[from]),
                to: PersonId(raw.person_ids[to]),
                affinity,
                trust,
                tags: tags
                    .into_iter()
                    .filter(|x| tag_seen.insert(*x))
                    .map(|x| REL_TAGS[x].to_owned())
                    .collect(),
            });
        }
    }

    FrozenContext {
        task,
        family,
        tick: tick + raw.tail,
        subject: raw.subject.map(|s| PersonId(raw.person_ids[s % np])),
        people,
        relations,
        events,
        situation: raw.situation,
        player_input: raw.player_input.map(|(i, content)| PlayerInput {
            intent: INTENTS[i].to_owned(),
            content,
        }),
        spec,
    }
}

/// A decision context: 2..=5 options with unique IDs.
pub fn arb_decision_context() -> BoxedStrategy<FrozenContext> {
    (
        context_raw(),
        2usize..=5,
        0usize..DECISION_FAMILIES.len(),
        Just(OPTION_POOL.to_vec()).prop_shuffle(),
        prop::collection::vec("\\PC{1,40}", 5..=5),
    )
        .prop_map(|(raw, n, fam, pool, labels)| {
            let options = pool
                .into_iter()
                .zip(labels)
                .take(n)
                .map(|(id, label)| OptionDef {
                    id: OptionId::new(id).expect("pool ids match the pattern"),
                    label,
                })
                .collect();
            build_context(
                raw,
                Task::Decision,
                DECISION_FAMILIES[fam],
                TaskSpec::Decision { options },
            )
        })
        .boxed()
}

/// A synthesis context for any of the four schemas.
pub fn arb_synthesis_context() -> BoxedStrategy<FrozenContext> {
    (context_raw(), 0usize..SCHEMAS.len(), 0u8..5)
        .prop_map(|(raw, s, sanity)| {
            let schema = SCHEMAS[s];
            let family = if sanity == 0 {
                Family::Sanity
            } else {
                match schema {
                    OutputSchema::GrudgeV1 => Family::GrudgeDetection,
                    OutputSchema::DebtChainV1 => Family::DebtChain,
                    OutputSchema::BrokenPromiseV1 => Family::BrokenPromise,
                    OutputSchema::RelationshipShiftV1 => Family::RelationshipShift,
                }
            };
            build_context(raw, Task::Synthesis, family, TaskSpec::Synthesis { schema })
        })
        .boxed()
}

pub fn arb_context() -> BoxedStrategy<FrozenContext> {
    prop_oneof![arb_decision_context(), arb_synthesis_context()].boxed()
}

// ---------------------------------------------------------------------------
// Answer keys
// ---------------------------------------------------------------------------

type PatRaw = (
    [bool; 4],
    [(usize, usize, bool, bool); 4],
    Option<Vec<usize>>,
);

fn pat_raw() -> impl Strategy<Value = PatRaw> {
    (
        prop::array::uniform4(any::<bool>()),
        prop::array::uniform4((0usize..64, 0usize..64, any::<bool>(), any::<bool>())),
        prop::option::of(prop::collection::vec(0usize..64, 1..=3)),
    )
}

fn person_ids(ctx: &FrozenContext) -> Vec<i64> {
    ctx.people.iter().map(|p| p.id.0).collect()
}

fn event_ids(ctx: &FrozenContext) -> Vec<EventId> {
    ctx.events.iter().map(|e| e.id.clone()).collect()
}

/// One scalar of the given kind; `alt` picks a second candidate for "one of" lists.
fn enum_scalar<T: Copy>(values: &[T], name: fn(T) -> &'static str, pick: usize) -> Scalar {
    Scalar::Str(name(values[pick % values.len()]).to_owned())
}

fn pattern_value(
    kind: FieldKind,
    ctx: &FrozenContext,
    raw: (usize, usize, bool, bool),
) -> PatternValue {
    let (a, b, null, any_of) = raw;
    let persons = person_ids(ctx);
    let events = event_ids(ctx);
    let make = |pick: usize| -> Scalar {
        match kind {
            FieldKind::Person => Scalar::Int(persons[pick % persons.len()]),
            FieldKind::PersonOrNull => {
                if null {
                    Scalar::Null
                } else {
                    Scalar::Int(persons[pick % persons.len()])
                }
            }
            FieldKind::Amount => Scalar::Int((pick as i64) * 100),
            FieldKind::Event => Scalar::Str(events[pick % events.len()].as_str().to_owned()),
            FieldKind::EventOrNull => {
                if null {
                    Scalar::Null
                } else {
                    Scalar::Str(events[pick % events.len()].as_str().to_owned())
                }
            }
            FieldKind::Level => enum_scalar(&LEVELS, level_name, pick),
            FieldKind::DebtStatus => enum_scalar(&DEBT_STATUS, debt_status_name, pick),
            FieldKind::PromiseStatus => enum_scalar(&PROMISE_STATUS, promise_status_name, pick),
            FieldKind::Direction => enum_scalar(&DIRECTIONS, direction_name, pick),
        }
    };
    if any_of {
        let mut list = vec![make(a)];
        let second = make(b);
        if !list.contains(&second) {
            list.push(second);
        }
        if list.len() == 1 {
            PatternValue::Exact(list.remove(0))
        } else {
            PatternValue::AnyOf(list)
        }
    } else {
        PatternValue::Exact(make(a))
    }
}

#[derive(Clone, Copy)]
enum FieldKind {
    Person,
    PersonOrNull,
    Amount,
    Event,
    EventOrNull,
    Level,
    DebtStatus,
    PromiseStatus,
    Direction,
}

/// The pattern fields of a family schema, in a fixed order (the first is always a person
/// field, so a pattern is never empty, even when the context has no events).
fn schema_fields(schema: OutputSchema) -> [(&'static str, FieldKind); 4] {
    match schema {
        OutputSchema::GrudgeV1 => [
            ("from", FieldKind::Person),
            ("to", FieldKind::Person),
            ("level", FieldKind::Level),
            ("level", FieldKind::Level),
        ],
        OutputSchema::DebtChainV1 => [
            ("debtor", FieldKind::Person),
            ("creditor", FieldKind::Person),
            ("status", FieldKind::DebtStatus),
            ("origin_event", FieldKind::Event),
        ],
        OutputSchema::BrokenPromiseV1 => [
            ("promisor", FieldKind::Person),
            ("promisee", FieldKind::Person),
            ("status", FieldKind::PromiseStatus),
            ("promise_event", FieldKind::Event),
        ],
        OutputSchema::RelationshipShiftV1 => [
            ("a", FieldKind::Person),
            ("b", FieldKind::Person),
            ("direction", FieldKind::Direction),
            ("turning_point", FieldKind::EventOrNull),
        ],
    }
}

/// Extra debt fields that do not fit the four fixed slots.
const DEBT_EXTRA: [(&str, FieldKind); 2] = [
    ("amount", FieldKind::Amount),
    ("transferred_from", FieldKind::PersonOrNull),
];

fn build_pattern(schema: OutputSchema, ctx: &FrozenContext, raw: PatRaw) -> Pattern {
    let (mask, vals, ev_any) = raw;
    let has_events = !ctx.events.is_empty();
    let mut fields: BTreeMap<String, PatternValue> = BTreeMap::new();
    let mut slots: Vec<(&str, FieldKind)> = schema_fields(schema).to_vec();
    if schema == OutputSchema::GrudgeV1 {
        slots.truncate(3);
    }
    if schema == OutputSchema::DebtChainV1 {
        slots.extend(DEBT_EXTRA);
    }
    for (i, (name, kind)) in slots.iter().enumerate() {
        let needs_event = matches!(kind, FieldKind::Event);
        let included = i == 0 || mask.get(i).copied().unwrap_or(i % 2 == 0);
        if !included || (needs_event && !has_events) {
            continue;
        }
        let v = vals.get(i).copied().unwrap_or(vals[0]);
        let kind = match kind {
            FieldKind::EventOrNull if !has_events => FieldKind::PersonOrNull,
            k => *k,
        };
        // `turning_point` must stay an event or null.
        let value = if *name == "turning_point" && !has_events {
            PatternValue::Exact(Scalar::Null)
        } else {
            pattern_value(kind, ctx, v)
        };
        fields.insert((*name).to_owned(), value);
    }
    let evidence_any = ev_any.filter(|_| has_events).map(|picks| {
        let ids = event_ids(ctx);
        picks
            .into_iter()
            .map(|p| ids[p % ids.len()].clone())
            .collect::<BTreeSet<_>>()
    });
    Pattern {
        fields,
        evidence_any,
    }
}

/// A D answer key: non-empty `acceptable`, disjoint `severe`, both inside the options.
fn decision_key(ctx: &FrozenContext, classes: Vec<u8>) -> AnswerKey {
    let TaskSpec::Decision { options } = &ctx.spec else {
        unreachable!("decision_key needs a decision context");
    };
    let mut acceptable = BTreeSet::new();
    let mut severe = BTreeSet::new();
    for (i, o) in options.iter().enumerate() {
        match classes.get(i).copied().unwrap_or(2) {
            0 => acceptable.insert(o.id.clone()),
            1 => severe.insert(o.id.clone()),
            _ => false,
        };
    }
    if acceptable.is_empty() {
        let first = options[0].id.clone();
        severe.remove(&first);
        acceptable.insert(first);
    }
    AnswerKey::Decision { acceptable, severe }
}

/// An answer key for `ctx`: patterns refer only to people and events of the context.
pub fn arb_key(ctx: &FrozenContext) -> BoxedStrategy<AnswerKey> {
    match &ctx.spec {
        TaskSpec::Decision { .. } => {
            let ctx = ctx.clone();
            prop::collection::vec(0u8..3, 5..=5)
                .prop_map(move |classes| decision_key(&ctx, classes))
                .boxed()
        }
        TaskSpec::Synthesis { schema } => {
            let (ctx, schema) = (ctx.clone(), *schema);
            (
                prop::collection::vec(pat_raw(), 0..=3),
                prop::collection::vec(pat_raw(), 0..=2),
                prop::array::uniform7(any::<bool>()),
                prop::collection::vec((0usize..7, pat_raw()), 0..=2),
            )
                .prop_map(move |(inc, exc, sev_mask, sev_pats)| {
                    let severe_conditions: BTreeSet<SevereCondition> = SEVERE_ALL
                        .iter()
                        .zip(sev_mask)
                        .filter(|(_, on)| *on)
                        .map(|(c, _)| *c)
                        .collect();
                    let listed: Vec<SevereCondition> = severe_conditions.iter().copied().collect();
                    let severe_patterns = if listed.is_empty() {
                        Vec::new()
                    } else {
                        sev_pats
                            .into_iter()
                            .map(|(c, p)| {
                                (listed[c % listed.len()], build_pattern(schema, &ctx, p))
                            })
                            .collect()
                    };
                    AnswerKey::Synthesis {
                        schema,
                        must_include: inc
                            .into_iter()
                            .map(|p| build_pattern(schema, &ctx, p))
                            .collect(),
                        must_not_include: exc
                            .into_iter()
                            .map(|p| build_pattern(schema, &ctx, p))
                            .collect(),
                        severe_conditions,
                        severe_patterns,
                    }
                })
                .boxed()
        }
    }
}

fn with_key(ctx: BoxedStrategy<FrozenContext>) -> BoxedStrategy<(FrozenContext, AnswerKey)> {
    ctx.prop_flat_map(|ctx| {
        let key = arb_key(&ctx);
        (Just(ctx), key)
    })
    .boxed()
}

pub fn arb_decision_case() -> BoxedStrategy<(FrozenContext, AnswerKey)> {
    with_key(arb_decision_context())
}

pub fn arb_synthesis_case() -> BoxedStrategy<(FrozenContext, AnswerKey)> {
    with_key(arb_synthesis_context())
}

pub fn arb_case() -> BoxedStrategy<(FrozenContext, AnswerKey)> {
    with_key(arb_context())
}

// ---------------------------------------------------------------------------
// Legal answers
// ---------------------------------------------------------------------------

/// What the Output_Validator must return for a legal answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expected {
    Option(OptionId),
    Items(SynthesisAnswer),
}

/// Model-output text in the DA-5 format and the typed value it stands for.
#[derive(Debug, Clone)]
pub struct LegalAnswer {
    pub text: String,
    pub expected: Expected,
}

fn obj(fields: Vec<(&str, Json)>) -> Json {
    Json::Object(fields.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}

fn ids_json(ids: &[EventId]) -> Json {
    Json::Array(
        ids.iter()
            .map(|e| Json::Str(e.as_str().to_owned()))
            .collect(),
    )
}

fn opt_int(v: Option<i64>) -> Json {
    v.map_or(Json::Null, Json::int)
}

fn opt_event(v: &Option<EventId>) -> Json {
    v.as_ref()
        .map_or(Json::Null, |e| Json::Str(e.as_str().to_owned()))
}

/// Canonical answer text of a typed S answer, with the schema constant.
pub fn synthesis_text(schema: OutputSchema, answer: &SynthesisAnswer) -> String {
    let items: Vec<Json> = match answer {
        SynthesisAnswer::Grudge(v) => v
            .iter()
            .map(|i| {
                obj(vec![
                    ("from", Json::int(i.from)),
                    ("to", Json::int(i.to)),
                    ("level", Json::Str(level_name(i.level).to_owned())),
                    ("evidence", ids_json(&i.evidence)),
                    ("reason", Json::Str(i.reason.clone())),
                ])
            })
            .collect(),
        SynthesisAnswer::DebtChain(v) => v
            .iter()
            .map(|i| {
                obj(vec![
                    ("debtor", Json::int(i.debtor)),
                    ("creditor", Json::int(i.creditor)),
                    ("amount", Json::int(i.amount)),
                    ("status", Json::Str(debt_status_name(i.status).to_owned())),
                    (
                        "origin_event",
                        Json::Str(i.origin_event.as_str().to_owned()),
                    ),
                    ("transferred_from", opt_int(i.transferred_from)),
                    ("evidence", ids_json(&i.evidence)),
                    ("reason", Json::Str(i.reason.clone())),
                ])
            })
            .collect(),
        SynthesisAnswer::BrokenPromise(v) => v
            .iter()
            .map(|i| {
                obj(vec![
                    ("promisor", Json::int(i.promisor)),
                    ("promisee", Json::int(i.promisee)),
                    (
                        "promise_event",
                        Json::Str(i.promise_event.as_str().to_owned()),
                    ),
                    (
                        "status",
                        Json::Str(promise_status_name(i.status).to_owned()),
                    ),
                    ("evidence", ids_json(&i.evidence)),
                    ("reason", Json::Str(i.reason.clone())),
                ])
            })
            .collect(),
        SynthesisAnswer::RelationshipShift(v) => v
            .iter()
            .map(|i| {
                obj(vec![
                    ("a", Json::int(i.a)),
                    ("b", Json::int(i.b)),
                    (
                        "direction",
                        Json::Str(direction_name(i.direction).to_owned()),
                    ),
                    ("turning_point", opt_event(&i.turning_point)),
                    ("evidence", ids_json(&i.evidence)),
                    ("reason", Json::Str(i.reason.clone())),
                ])
            })
            .collect(),
    };
    json::write(&obj(vec![
        ("schema", Json::Str(schema_name(schema).to_owned())),
        ("items", Json::Array(items)),
    ]))
}

type ItemRaw = (usize, usize, usize, usize, i64, bool, Vec<usize>, String);

fn item_raw() -> impl Strategy<Value = ItemRaw> {
    (
        0usize..64,
        0usize..64,
        0usize..64,
        0usize..64,
        0i64..=1_000_000,
        any::<bool>(),
        prop::collection::vec(0usize..64, 1..=4),
        "\\PC{0,60}",
    )
}

/// A legal D answer: `{"option":"<id>"}` with an option of the context.
pub fn arb_legal_decision_answer(ctx: &FrozenContext) -> BoxedStrategy<LegalAnswer> {
    let TaskSpec::Decision { options } = &ctx.spec else {
        unreachable!("needs a decision context");
    };
    let ids: Vec<OptionId> = options.iter().map(|o| o.id.clone()).collect();
    (0..ids.len())
        .prop_map(move |i| LegalAnswer {
            text: json::write(&obj(vec![(
                "option",
                Json::Str(ids[i].as_str().to_owned()),
            )])),
            expected: Expected::Option(ids[i].clone()),
        })
        .boxed()
}

/// A legal S answer: only the context's person and event IDs, legal enum values,
/// non-empty duplicate-free evidence. With no events in the context the item list is empty.
pub fn arb_legal_synthesis_answer(ctx: &FrozenContext) -> BoxedStrategy<LegalAnswer> {
    let TaskSpec::Synthesis { schema } = &ctx.spec else {
        unreachable!("needs a synthesis context");
    };
    let schema = *schema;
    let persons = person_ids(ctx);
    let events = event_ids(ctx);
    let max_items = if events.is_empty() { 0 } else { 4 };
    prop::collection::vec(item_raw(), 0..=max_items)
        .prop_map(move |raws| {
            let pick_p = |i: usize| persons[i % persons.len()];
            let pick_e = |i: usize| events[i % events.len()].clone();
            let evidence = |picks: &[usize]| -> Vec<EventId> {
                let mut seen = BTreeSet::new();
                picks
                    .iter()
                    .map(|p| pick_e(*p))
                    .filter(|e| seen.insert(e.clone()))
                    .collect()
            };
            let answer = match schema {
                OutputSchema::GrudgeV1 => SynthesisAnswer::Grudge(
                    raws.iter()
                        .map(|(a, b, c, _, _, _, ev, reason)| GrudgeItem {
                            from: pick_p(*a),
                            to: pick_p(*b),
                            level: LEVELS[*c % 3],
                            evidence: evidence(ev),
                            reason: reason.clone(),
                        })
                        .collect(),
                ),
                OutputSchema::DebtChainV1 => SynthesisAnswer::DebtChain(
                    raws.iter()
                        .map(|(a, b, c, d, amount, flag, ev, reason)| DebtItem {
                            debtor: pick_p(*a),
                            creditor: pick_p(*b),
                            amount: *amount,
                            status: DEBT_STATUS[*c % 4],
                            origin_event: pick_e(*d),
                            transferred_from: flag.then(|| pick_p(*c)),
                            evidence: evidence(ev),
                            reason: reason.clone(),
                        })
                        .collect(),
                ),
                OutputSchema::BrokenPromiseV1 => SynthesisAnswer::BrokenPromise(
                    raws.iter()
                        .map(|(a, b, c, d, _, _, ev, reason)| PromiseItem {
                            promisor: pick_p(*a),
                            promisee: pick_p(*b),
                            promise_event: pick_e(*d),
                            status: PROMISE_STATUS[*c % 3],
                            evidence: evidence(ev),
                            reason: reason.clone(),
                        })
                        .collect(),
                ),
                OutputSchema::RelationshipShiftV1 => SynthesisAnswer::RelationshipShift(
                    raws.iter()
                        .map(|(a, b, c, d, _, flag, ev, reason)| ShiftItem {
                            a: pick_p(*a),
                            b: pick_p(*b),
                            direction: DIRECTIONS[*c % 4],
                            turning_point: flag.then(|| pick_e(*d)),
                            evidence: evidence(ev),
                            reason: reason.clone(),
                        })
                        .collect(),
                ),
            };
            LegalAnswer {
                text: synthesis_text(schema, &answer),
                expected: Expected::Items(answer),
            }
        })
        .boxed()
}

pub fn arb_legal_answer(ctx: &FrozenContext) -> BoxedStrategy<LegalAnswer> {
    match ctx.task {
        Task::Decision => arb_legal_decision_answer(ctx),
        Task::Synthesis => arb_legal_synthesis_answer(ctx),
    }
}

/// A context together with a legal answer for it.
pub fn arb_context_and_legal_answer() -> BoxedStrategy<(FrozenContext, LegalAnswer)> {
    arb_context()
        .prop_flat_map(|ctx| {
            let answer = arb_legal_answer(&ctx);
            (Just(ctx), answer)
        })
        .boxed()
}

/// Wraps answer text as the DA-5 format allows: ASCII whitespace around it and at most
/// one Markdown fence (` ``` ` or ` ```json `).
pub fn arb_wrapped(text: String) -> BoxedStrategy<String> {
    let ws = prop::collection::vec(prop::sample::select(vec![' ', '\t', '\n', '\r']), 0..=3)
        .prop_map(|v| v.into_iter().collect::<String>());
    (0u8..3, ws.clone(), ws)
        .prop_map(move |(mode, pre, post)| match mode {
            0 => format!("{pre}{text}{post}"),
            1 => format!("{pre}```\n{text}\n```{post}"),
            _ => format!("{pre}```json\n{text}\n```{post}"),
        })
        .boxed()
}

// ---------------------------------------------------------------------------
// Dev_Cards
// ---------------------------------------------------------------------------

/// Loads every card of `eval/cards/cards/dev.jsonl` (read only). Panics with the line
/// number when a card does not parse. The locked split is never read.
pub fn dev_cards() -> Vec<ParsedCard> {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../eval/cards/cards/dev.jsonl");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    text.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(i, l)| {
            parse_card(l, i + 1).unwrap_or_else(|e| panic!("dev.jsonl line {}: {e}", i + 1))
        })
        .collect()
}

/// Any one Dev_Card, as a seed.
pub fn arb_dev_card() -> BoxedStrategy<ParsedCard> {
    prop::sample::select(dev_cards()).boxed()
}

/// The raw lines of `eval/cards/cards/dev.jsonl` as `(1-based line number, text)`.
pub fn dev_lines() -> Vec<(usize, String)> {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../eval/cards/cards/dev.jsonl");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    text.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(i, l)| (i + 1, l.to_owned()))
        .collect()
}

// ---------------------------------------------------------------------------
// Cards: generator and canonical writer
// ---------------------------------------------------------------------------

fn family_name(f: Family) -> &'static str {
    match f {
        Family::DreamInterpretation => "dream_interpretation",
        Family::WillExecution => "will_execution",
        Family::ReconcileOrRevenge => "reconcile_or_revenge",
        Family::DebtRepayment => "debt_repayment",
        Family::Remarriage => "remarriage",
        Family::MagistrateRuling => "magistrate_ruling",
        Family::GrudgeDetection => "grudge_detection",
        Family::DebtChain => "debt_chain",
        Family::BrokenPromise => "broken_promise",
        Family::RelationshipShift => "relationship_shift",
        Family::Sanity => "sanity",
    }
}

fn severe_name(c: SevereCondition) -> &'static str {
    match c {
        SevereCondition::InventedEventId => "invented_event_id",
        SevereCondition::InventedPerson => "invented_person",
        SevereCondition::ReversedDirection => "reversed_direction",
        SevereCondition::DeadPersonAsActorAfterDeath => "dead_person_as_actor_after_death",
        SevereCondition::ContradictsFact => "contradicts_fact",
        SevereCondition::SelfReference => "self_reference",
        SevereCondition::WrongDebtHolder => "wrong_debt_holder",
    }
}

fn s(v: &str) -> Json {
    Json::Str(v.to_owned())
}

fn scalar_json(v: &Scalar) -> Json {
    match v {
        Scalar::Int(n) => Json::int(*n),
        Scalar::Str(t) => s(t),
        Scalar::Null => Json::Null,
    }
}

fn pattern_json(p: &Pattern) -> Json {
    let mut map: BTreeMap<String, Json> = p
        .fields
        .iter()
        .map(|(k, v)| {
            let j = match v {
                PatternValue::Exact(x) => scalar_json(x),
                PatternValue::AnyOf(xs) => Json::Array(xs.iter().map(scalar_json).collect()),
            };
            (k.clone(), j)
        })
        .collect();
    if let Some(ev) = &p.evidence_any {
        map.insert(
            "evidence_any".to_owned(),
            Json::Array(ev.iter().map(|e| s(e.as_str())).collect()),
        );
    }
    Json::Object(map)
}

fn patterns_json(ps: &[Pattern]) -> Json {
    Json::Array(ps.iter().map(pattern_json).collect())
}

fn option_set_json(ids: &BTreeSet<OptionId>) -> Json {
    Json::Array(ids.iter().map(|o| s(o.as_str())).collect())
}

fn expected_json(e: &ExpectedSide) -> Json {
    match e {
        ExpectedSide::Options(ids) => option_set_json(ids),
        ExpectedSide::Patterns { include, exclude } => obj(vec![
            ("include", patterns_json(include)),
            ("exclude", patterns_json(exclude)),
        ]),
    }
}

fn people_ids_json(ids: &[PersonId]) -> Json {
    Json::Array(ids.iter().map(|p| Json::int(p.0)).collect())
}

fn strings_json(v: &[String]) -> Json {
    Json::Array(v.iter().map(|t| s(t)).collect())
}

/// The canonical JSON value of a parsed card: the card writer used by the round-trip
/// property. Optional members that are `None` or empty are left out where the card
/// schema allows it (`due_tick`, `severe_patterns`, `contrast`).
pub fn card_json(card: &ParsedCard) -> Json {
    let (meta, ctx, key, contrast) = card;
    let people: Vec<Json> = ctx
        .people
        .iter()
        .map(|p| {
            let t = &p.traits;
            obj(vec![
                ("id", Json::int(p.id.0)),
                ("name", s(&p.name)),
                ("age", Json::int(p.age)),
                ("sex", s(&p.sex)),
                ("alive", Json::Bool(p.alive)),
                ("origin", s(&p.origin)),
                (
                    "traits",
                    obj(vec![
                        ("greed", Json::int(t.greed)),
                        ("loyalty", Json::int(t.loyalty)),
                        ("pride", Json::int(t.pride)),
                        ("warmth", Json::int(t.warmth)),
                        ("temper", Json::int(t.temper)),
                        ("vindictiveness", Json::int(t.vindictiveness)),
                        ("piety", Json::int(t.piety)),
                    ]),
                ),
                ("wealth", Json::int(p.wealth)),
                ("soul_id", s(&p.soul_id)),
            ])
        })
        .collect();
    let relations: Vec<Json> = ctx
        .relations
        .iter()
        .map(|r| {
            obj(vec![
                ("from", Json::int(r.from.0)),
                ("to", Json::int(r.to.0)),
                ("affinity", Json::int(r.affinity)),
                ("trust", Json::int(r.trust)),
                ("tags", strings_json(&r.tags)),
            ])
        })
        .collect();
    let events: Vec<Json> = ctx
        .events
        .iter()
        .map(|e| {
            let mut fields = vec![
                ("id", s(e.id.as_str())),
                ("tick", Json::int(e.tick)),
                ("type", s(&e.kind)),
                ("actors", people_ids_json(&e.actors)),
                ("magnitude", Json::int(e.magnitude)),
                ("caused_by", ids_json(&e.caused_by)),
                ("tags", strings_json(&e.tags)),
            ];
            if let Some(d) = e.due_tick {
                fields.push(("due_tick", Json::int(d)));
            }
            obj(fields)
        })
        .collect();
    let player_input = ctx.player_input.as_ref().map_or(Json::Null, |p| {
        obj(vec![("intent", s(&p.intent)), ("content", s(&p.content))])
    });
    let context = obj(vec![
        ("tick", Json::int(ctx.tick)),
        ("subject", opt_int(ctx.subject.map(|p| p.0))),
        ("people", Json::Array(people)),
        ("relations", Json::Array(relations)),
        ("events", Json::Array(events)),
        ("situation", s(&ctx.situation)),
        ("player_input", player_input),
    ]);
    let mut fields = vec![
        ("id", s(&meta.id)),
        (
            "task",
            s(match ctx.task {
                Task::Decision => "decision",
                Task::Synthesis => "synthesis",
            }),
        ),
        ("family", s(family_name(ctx.family))),
        ("scenario_group", s(&meta.scenario_group)),
        (
            "split",
            s(match meta.split {
                Split::Dev => "dev",
                Split::Locked => "locked",
            }),
        ),
        ("scored", Json::Bool(meta.scored)),
        ("author_note", s(&meta.author_note)),
        ("context", context),
    ];
    match (&ctx.spec, key) {
        (TaskSpec::Decision { options }, AnswerKey::Decision { acceptable, severe }) => {
            let defs = options
                .iter()
                .map(|o| obj(vec![("id", s(o.id.as_str())), ("label", s(&o.label))]))
                .collect();
            fields.push(("options", Json::Array(defs)));
            fields.push(("acceptable", option_set_json(acceptable)));
            fields.push(("severe", option_set_json(severe)));
        }
        (
            TaskSpec::Synthesis { .. },
            AnswerKey::Synthesis {
                schema,
                must_include,
                must_not_include,
                severe_conditions,
                severe_patterns,
            },
        ) => {
            fields.push(("output_schema", s(schema_name(*schema))));
            fields.push((
                "gold",
                obj(vec![
                    ("must_include", patterns_json(must_include)),
                    ("must_not_include", patterns_json(must_not_include)),
                ]),
            ));
            fields.push((
                "severe_conditions",
                Json::Array(
                    severe_conditions
                        .iter()
                        .map(|c| s(severe_name(*c)))
                        .collect(),
                ),
            ));
            if !severe_patterns.is_empty() {
                let items = severe_patterns
                    .iter()
                    .map(|(c, p)| {
                        obj(vec![
                            ("condition", s(severe_name(*c))),
                            ("pattern", pattern_json(p)),
                        ])
                    })
                    .collect();
                fields.push(("severe_patterns", Json::Array(items)));
            }
        }
        _ => panic!("card context and key disagree"),
    }
    if let Some(c) = contrast {
        fields.push((
            "contrast",
            obj(vec![
                ("pair_id", s(&c.pair_id)),
                (
                    "role",
                    s(match c.role {
                        ContrastRole::A => "a",
                        ContrastRole::B => "b",
                    }),
                ),
                ("changed_fact", s(&c.changed_fact)),
                (
                    "expected",
                    obj(vec![
                        ("a", expected_json(&c.expected_a)),
                        ("b", expected_json(&c.expected_b)),
                    ]),
                ),
            ]),
        ));
    }
    obj(fields)
}

/// One canonical card line (no trailing newline).
pub fn card_line(card: &ParsedCard) -> String {
    json::write(&card_json(card))
}

/// A card the parser must accept: a context and key from the shared generators, plus
/// metadata and, for about half of the cards, a `contrast` member. Fields the card
/// schema requires but the shared context generator may leave empty are filled here
/// (an event without actors gets the first person; an empty player input becomes
/// `null`).
pub fn arb_card() -> BoxedStrategy<ParsedCard> {
    (
        arb_case(),
        1u32..=999,
        any::<bool>(),
        "\\PC{1,60}",
        prop::option::of((any::<bool>(), "\\PC{1,40}", 1u32..=999)),
    )
        .prop_map(|((mut ctx, key), group, scored, note, contrast)| {
            let first = ctx.people[0].id;
            for e in &mut ctx.events {
                if e.actors.is_empty() {
                    e.actors.push(first);
                }
            }
            if ctx
                .player_input
                .as_ref()
                .is_some_and(|p| p.content.is_empty())
            {
                ctx.player_input = None;
            }
            let prefix = match ctx.task {
                Task::Decision => 'D',
                Task::Synthesis => 'S',
            };
            let meta = CardMeta {
                id: format!("{prefix}-{}-{group:03}", family_name(ctx.family)),
                scenario_group: format!("G{group:03}"),
                split: Split::Dev,
                scored,
                author_note: note,
            };
            let contrast = contrast.map(|(role_a, changed_fact, pair)| {
                let (a, b) = match (&ctx.spec, &key) {
                    (TaskSpec::Decision { options }, AnswerKey::Decision { acceptable, .. }) => (
                        ExpectedSide::Options(acceptable.clone()),
                        ExpectedSide::Options(options.iter().map(|o| o.id.clone()).collect()),
                    ),
                    (
                        _,
                        AnswerKey::Synthesis {
                            must_include,
                            must_not_include,
                            ..
                        },
                    ) => (
                        ExpectedSide::Patterns {
                            include: must_include.clone(),
                            exclude: must_not_include.clone(),
                        },
                        ExpectedSide::Patterns {
                            include: must_not_include.clone(),
                            exclude: must_include.clone(),
                        },
                    ),
                    _ => unreachable!("case key matches its context"),
                };
                Contrast {
                    pair_id: format!("P{pair:03}"),
                    role: if role_a {
                        ContrastRole::A
                    } else {
                        ContrastRole::B
                    },
                    changed_fact,
                    expected_a: a,
                    expected_b: b,
                }
            });
            (meta, ctx, key, contrast)
        })
        .boxed()
}

// ---------------------------------------------------------------------------
// Number replacement
// ---------------------------------------------------------------------------

/// How many `Json::Number` nodes `v` holds.
pub fn number_count(v: &Json) -> usize {
    match v {
        Json::Number(_) => 1,
        Json::Array(items) => items.iter().map(number_count).sum(),
        Json::Object(map) => map.values().map(number_count).sum(),
        _ => 0,
    }
}

/// Replaces the `n`-th number (pre-order, object members in key order) with a number
/// that has a fraction or exponent part, chosen by `style`. Returns whether it did.
pub fn replace_nth_number(v: &mut Json, n: &mut usize, style: usize) -> bool {
    match v {
        Json::Number(lexeme) => {
            if *n == 0 {
                let base = lexeme.clone();
                *lexeme = match style % 6 {
                    0 => format!("{base}.0"),
                    1 => format!("{base}.5"),
                    2 => format!("{base}e0"),
                    3 => format!("{base}E2"),
                    4 => format!("{base}e-1"),
                    _ => format!("{base}.25e+3"),
                };
                true
            } else {
                *n -= 1;
                false
            }
        }
        Json::Array(items) => items.iter_mut().any(|i| replace_nth_number(i, n, style)),
        Json::Object(map) => map.values_mut().any(|i| replace_nth_number(i, n, style)),
        _ => false,
    }
}
