//! JSON-in / JSON-out API of the llm module (R6.1, R6.6, R6.7).
//!
//! Eight plain-Rust functions, each taking one JSON text and returning one canonical JSON
//! text. `sim-wasm` exports exactly these, so native tests and the browser run the same
//! code. Every result is
//!
//! - `{"ok":true,…}` with the members listed per function, or
//! - `{"ok":false,"error":{"kind":"input"|"card"|"answer_key"|"render","message":"…"}}`.
//!
//! | Function | Input | Result members |
//! |---|---|---|
//! | [`llm_parse_card`] | one card line | `card`, `frozen_context`, `meta`, `random_baseline_parts` |
//! | [`llm_permutations`] | `{"frozen_context":…}` | `permutations` |
//! | [`llm_render_prompt`] | `{"frozen_context":…,"template":…,"schema_text":…,"permutation":…}` | `system`, `user`, `renderer_version` |
//! | [`llm_render_system_one`] | `{"frozen_context":…,"mapping":…,"permutation":…}` | `state`, `instructions`, `question_id`, `criteria`, `renderer_version` |
//! | [`llm_validate`] | `{"frozen_context":…,"raw":…,"mode":…?}` or `{"frozen_context":…,"outcome":{…}}` | `verdict` |
//! | [`llm_grade`] | `{"card":"<line>","verdict":…}` | `grade` |
//! | [`llm_identity`] | `{"card":"<line>","verdict":…}` | `identity` |
//! | [`llm_contrast`] | `{"card_a":…,"verdict_a":…,"card_b":…,"verdict_b":…}` | `contrast` |
//!
//! Shapes the design leaves open:
//!
//! - `frozen_context` is the card's context members plus `task`, `family`, and `options`
//!   (decision) or `output_schema` (synthesis); see [`frozen_context_to_json`].
//! - `verdict` is `{"kind":"decision","option":…}`, `{"kind":"synthesis","answer":<S answer
//!   object>,"missing_events":[…],"missing_persons":[…]}` or
//!   `{"kind":"illegal","reason":…,"path":…|null}`.
//! - `llm_contrast` takes card A first (role `a`) and card B second (role `b`) of one pair
//!   and uses the expected sets that card A carries.
//!
//! Error strings name answer-key fields bare (no quotes). No function panics: every input
//! that is not valid JSON, or does not have the expected shape, is an `input` error.
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

use super::answer::{self, debt_status_str, direction_str, level_str, promise_status_str};
use super::card::{
    self, CardError, CardErrorKind, ContrastRole, ParsedCard, Split, family_name,
    frozen_context_from_json,
};
use super::grade;
use super::json::{self, Json};
use super::key::{AnswerKey, Grade};
use super::render::{self, Permutation, RENDERER_VERSION};
use super::system_one;
use super::validate::{self, Outcome};
use super::{FrozenContext, IdentityTuple, IdentityValue, IllegalReason, Task, TaskSpec, Verdict};

/// Largest accepted API input. Model output inside an envelope may itself be up to the
/// validator's own limit, so this is larger than [`json::MAX_INPUT_BYTES`].
pub const API_MAX_INPUT_BYTES: usize = 8 * json::MAX_INPUT_BYTES;

// ---------------------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------------------

struct ApiError {
    kind: &'static str,
    message: String,
}

type Members = Vec<(&'static str, Json)>;
type Res = Result<Members, ApiError>;

fn err<T>(kind: &'static str, message: impl Into<String>) -> Result<T, ApiError> {
    Err(ApiError {
        kind,
        message: message.into(),
    })
}

fn input_err<T>(message: impl Into<String>) -> Result<T, ApiError> {
    err("input", message)
}

fn text(s: &str) -> Json {
    Json::Str(s.to_owned())
}

fn object(members: Members) -> Json {
    Json::Object(
        members
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect(),
    )
}

fn envelope(result: Res) -> String {
    let value = match result {
        Ok(mut members) => {
            members.push(("ok", Json::Bool(true)));
            object(members)
        }
        Err(e) => object(vec![
            ("ok", Json::Bool(false)),
            (
                "error",
                object(vec![
                    ("kind", text(e.kind)),
                    ("message", Json::Str(e.message)),
                ]),
            ),
        ]),
    };
    json::write(&value)
}

/// A card or context error as text, without the line number (the API has no file).
fn describe(e: &CardError) -> String {
    if e.path.is_empty() {
        format!("{}: {}", e.kind.as_str(), e.detail)
    } else {
        format!("{}: {} at {}", e.kind.as_str(), e.detail, e.path)
    }
}

fn card_error(e: &CardError) -> ApiError {
    let kind = match e.kind {
        CardErrorKind::AnswerKey => "answer_key",
        _ => "card",
    };
    ApiError {
        kind,
        message: describe(e),
    }
}

// ---------------------------------------------------------------------------------------
// Reading inputs
// ---------------------------------------------------------------------------------------

/// An input object whose members are taken out one by one; [`Fields::finish`] rejects leftovers.
struct Fields {
    what: &'static str,
    map: BTreeMap<String, Json>,
}

impl Fields {
    fn new(what: &'static str, v: Json) -> Result<Self, ApiError> {
        match v {
            Json::Object(map) => Ok(Self { what, map }),
            _ => input_err(format!("{what} must be an object")),
        }
    }

    fn opt(&mut self, key: &str) -> Option<Json> {
        self.map.remove(key)
    }

    fn req(&mut self, key: &str) -> Result<Json, ApiError> {
        match self.map.remove(key) {
            Some(v) => Ok(v),
            None => input_err(format!("{} lacks member {key}", self.what)),
        }
    }

    fn string(&mut self, key: &str) -> Result<String, ApiError> {
        match self.req(key)? {
            Json::Str(s) => Ok(s),
            _ => input_err(format!("{}.{key} must be a string", self.what)),
        }
    }

    fn finish(self) -> Result<(), ApiError> {
        match self.map.keys().next() {
            Some(k) => input_err(format!("{} has unknown member {k}", self.what)),
            None => Ok(()),
        }
    }
}

fn read_input(input: &str) -> Result<Fields, ApiError> {
    match json::parse_limited(input, API_MAX_INPUT_BYTES) {
        Ok(v) => Fields::new("input", v),
        Err(e) => input_err(format!("input is not valid JSON ({})", e.detail)),
    }
}

fn read_context(v: Json) -> Result<FrozenContext, ApiError> {
    frozen_context_from_json(v).map_err(|e| ApiError {
        kind: "input",
        message: format!("frozen_context: {}", describe(&e)),
    })
}

fn read_card(line: &str) -> Result<ParsedCard, ApiError> {
    card::parse_card(line, 1).map_err(|e| card_error(&e))
}

fn read_card_member(f: &mut Fields, key: &str) -> Result<ParsedCard, ApiError> {
    let line = f.string(key)?;
    read_card(&line)
}

fn int_list(what: &str, v: Json) -> Result<Vec<i64>, ApiError> {
    let Json::Array(items) = v else {
        return input_err(format!("{what} must be an array"));
    };
    let mut out = Vec::new();
    for item in items {
        match item {
            Json::Number(lexeme) => match json::integer_value(&lexeme) {
                Ok(n) => out.push(n),
                Err(_) => return input_err(format!("{what} must hold integers")),
            },
            _ => return input_err(format!("{what} must hold integers")),
        }
    }
    Ok(out)
}

fn string_list(what: &str, v: Json) -> Result<Vec<String>, ApiError> {
    let Json::Array(items) = v else {
        return input_err(format!("{what} must be an array"));
    };
    let mut out = Vec::new();
    for item in items {
        match item {
            Json::Str(s) => out.push(s),
            _ => return input_err(format!("{what} must hold strings")),
        }
    }
    Ok(out)
}

fn read_verdict(v: Json) -> Result<Verdict, ApiError> {
    let mut f = Fields::new("verdict", v)?;
    let kind = f.string("kind")?;
    let verdict = match kind.as_str() {
        "decision" => {
            let name = f.string("option")?;
            match super::OptionId::new(&name) {
                Some(option) => Verdict::Decision { option },
                None => return input_err("verdict.option is not a legal option ID"),
            }
        }
        "synthesis" => {
            let Some(answer) = validate::read_answer(&f.req("answer")?) else {
                return input_err("verdict.answer is not a legal synthesis answer");
            };
            let mut missing_persons =
                int_list("verdict.missing_persons", f.req("missing_persons")?)?;
            let mut missing_events =
                string_list("verdict.missing_events", f.req("missing_events")?)?;
            missing_persons.sort_unstable();
            missing_persons.dedup();
            missing_events.sort();
            missing_events.dedup();
            Verdict::Synthesis {
                answer,
                missing_persons,
                missing_events,
            }
        }
        "illegal" => {
            let name = f.string("reason")?;
            let Some(reason) = IllegalReason::from_name(&name) else {
                return input_err("verdict.reason is not a known reason");
            };
            let path = match f.req("path")? {
                Json::Null => None,
                Json::Str(s) => Some(s),
                _ => return input_err("verdict.path must be a string or null"),
            };
            Verdict::Illegal { reason, path }
        }
        _ => return input_err("verdict.kind must be decision, synthesis or illegal"),
    };
    f.finish()?;
    Ok(verdict)
}

// ---------------------------------------------------------------------------------------
// Writing results
// ---------------------------------------------------------------------------------------

fn id_list<'a>(ids: impl Iterator<Item = &'a str>) -> Json {
    Json::Array(ids.map(text).collect())
}

fn strings(items: &[String]) -> Json {
    id_list(items.iter().map(String::as_str))
}

/// The JSON form of a [`FrozenContext`] that [`frozen_context_from_json`] reads back.
pub fn frozen_context_to_json(ctx: &FrozenContext) -> Json {
    let people = ctx
        .people
        .iter()
        .map(|p| {
            object(vec![
                ("id", Json::int(p.id.0)),
                ("name", text(&p.name)),
                ("age", Json::int(p.age)),
                ("sex", text(&p.sex)),
                ("alive", Json::Bool(p.alive)),
                ("origin", text(&p.origin)),
                (
                    "traits",
                    object(vec![
                        ("greed", Json::int(p.traits.greed)),
                        ("loyalty", Json::int(p.traits.loyalty)),
                        ("pride", Json::int(p.traits.pride)),
                        ("warmth", Json::int(p.traits.warmth)),
                        ("temper", Json::int(p.traits.temper)),
                        ("vindictiveness", Json::int(p.traits.vindictiveness)),
                        ("piety", Json::int(p.traits.piety)),
                    ]),
                ),
                ("wealth", Json::int(p.wealth)),
                ("soul_id", text(&p.soul_id)),
            ])
        })
        .collect();
    let relations = ctx
        .relations
        .iter()
        .map(|r| {
            object(vec![
                ("from", Json::int(r.from.0)),
                ("to", Json::int(r.to.0)),
                ("affinity", Json::int(r.affinity)),
                ("trust", Json::int(r.trust)),
                ("tags", strings(&r.tags)),
            ])
        })
        .collect();
    let events = ctx
        .events
        .iter()
        .map(|e| {
            let mut m: Members = vec![
                ("id", text(e.id.as_str())),
                ("tick", Json::int(e.tick)),
                ("type", text(&e.kind)),
                (
                    "actors",
                    Json::Array(e.actors.iter().map(|a| Json::int(a.0)).collect()),
                ),
                ("magnitude", Json::int(e.magnitude)),
                ("caused_by", id_list(e.caused_by.iter().map(|c| c.as_str()))),
                ("tags", strings(&e.tags)),
            ];
            if let Some(due) = e.due_tick {
                m.push(("due_tick", Json::int(due)));
            }
            object(m)
        })
        .collect();
    let mut members: Members = vec![
        (
            "task",
            text(match ctx.task {
                Task::Decision => "decision",
                Task::Synthesis => "synthesis",
            }),
        ),
        ("family", text(family_name(ctx.family))),
        ("tick", Json::int(ctx.tick)),
        (
            "subject",
            ctx.subject.map_or(Json::Null, |s| Json::int(s.0)),
        ),
        ("people", Json::Array(people)),
        ("relations", Json::Array(relations)),
        ("events", Json::Array(events)),
        ("situation", text(&ctx.situation)),
        (
            "player_input",
            ctx.player_input.as_ref().map_or(Json::Null, |p| {
                object(vec![
                    ("intent", text(&p.intent)),
                    ("content", text(&p.content)),
                ])
            }),
        ),
    ];
    match &ctx.spec {
        TaskSpec::Decision { options } => members.push((
            "options",
            Json::Array(
                options
                    .iter()
                    .map(|o| object(vec![("id", text(o.id.as_str())), ("label", text(&o.label))]))
                    .collect(),
            ),
        )),
        TaskSpec::Synthesis { schema } => {
            members.push(("output_schema", text(answer::schema_name(*schema))));
        }
    }
    object(members)
}

/// The JSON form of a [`Verdict`] that `read_verdict` reads back.
pub fn verdict_to_json(verdict: &Verdict) -> Json {
    match verdict {
        Verdict::Decision { option } => object(vec![
            ("kind", text("decision")),
            ("option", text(option.as_str())),
        ]),
        Verdict::Synthesis {
            answer: a,
            missing_persons,
            missing_events,
        } => object(vec![
            ("kind", text("synthesis")),
            ("answer", answer::to_json(a)),
            (
                "missing_persons",
                Json::Array(missing_persons.iter().map(|p| Json::int(*p)).collect()),
            ),
            ("missing_events", strings(missing_events)),
        ]),
        Verdict::Illegal { reason, path } => object(vec![
            ("kind", text("illegal")),
            ("reason", text(reason.as_str())),
            ("path", path.as_deref().map_or(Json::Null, text)),
        ]),
    }
}

fn grade_to_json(g: &Grade) -> Json {
    object(vec![
        ("acceptable", Json::Bool(g.acceptable)),
        ("severe", Json::Bool(g.severe)),
        ("illegal", Json::Bool(g.illegal)),
        (
            "severe_conditions",
            id_list(
                g.severe_conditions
                    .iter()
                    .map(|c| card::severe_condition_name(*c)),
            ),
        ),
    ])
}

fn event_or_null(e: &Option<super::EventId>) -> Json {
    e.as_ref().map_or(Json::Null, |e| text(e.as_str()))
}

fn tuple_to_json(t: &IdentityTuple) -> Json {
    match t {
        IdentityTuple::Grudge { from, to, level } => object(vec![
            ("type", text("grudge")),
            ("from", Json::int(*from)),
            ("to", Json::int(*to)),
            ("level", text(level_str(*level))),
        ]),
        IdentityTuple::DebtChain {
            debtor,
            creditor,
            origin_event,
            status,
            amount,
        } => object(vec![
            ("type", text("debt_chain")),
            ("debtor", Json::int(*debtor)),
            ("creditor", Json::int(*creditor)),
            ("origin_event", text(origin_event.as_str())),
            ("status", text(debt_status_str(*status))),
            ("amount", Json::int(*amount)),
        ]),
        IdentityTuple::BrokenPromise {
            promisor,
            promisee,
            promise_event,
            status,
        } => object(vec![
            ("type", text("broken_promise")),
            ("promisor", Json::int(*promisor)),
            ("promisee", Json::int(*promisee)),
            ("promise_event", text(promise_event.as_str())),
            ("status", text(promise_status_str(*status))),
        ]),
        IdentityTuple::RelationshipShift {
            low,
            high,
            direction,
            turning_point,
        } => object(vec![
            ("type", text("relationship_shift")),
            ("low", Json::int(*low)),
            ("high", Json::int(*high)),
            ("direction", text(direction_str(*direction))),
            ("turning_point", event_or_null(turning_point)),
        ]),
    }
}

fn identity_to_json(v: &IdentityValue) -> Json {
    match v {
        IdentityValue::Invalid => object(vec![("kind", text("invalid"))]),
        IdentityValue::Option(o) => {
            object(vec![("kind", text("option")), ("option", text(o.as_str()))])
        }
        IdentityValue::Set(set) => object(vec![
            ("kind", text("set")),
            (
                "tuples",
                Json::Array(set.iter().map(tuple_to_json).collect()),
            ),
        ]),
    }
}

// ---------------------------------------------------------------------------------------
// The eight functions
// ---------------------------------------------------------------------------------------

/// Parses one card line. Result members: `card` (the line as canonical JSON), `frozen_context`,
/// `meta` (`id`, `task`, `family`, `scenario_group`, `split`, `scored`, `pair_id`, `role`),
/// and `random_baseline_parts` (`acceptable_count`, `option_count` for D, `null` for S).
pub fn llm_parse_card(line: &str) -> String {
    envelope(parse_card_inner(line))
}

fn parse_card_inner(line: &str) -> Res {
    let (meta, ctx, key, contrast) = read_card(line)?;
    let root = match json::parse(line) {
        Ok(v) => v,
        Err(e) => return input_err(format!("card is not valid JSON ({})", e.detail)),
    };
    let baseline = match (&key, &ctx.spec) {
        (AnswerKey::Decision { acceptable, .. }, TaskSpec::Decision { options }) => object(vec![
            ("acceptable_count", Json::int(acceptable.len() as i64)),
            ("option_count", Json::int(options.len() as i64)),
        ]),
        _ => Json::Null,
    };
    let meta_json = object(vec![
        ("id", text(&meta.id)),
        (
            "task",
            text(match ctx.task {
                Task::Decision => "decision",
                Task::Synthesis => "synthesis",
            }),
        ),
        ("family", text(family_name(ctx.family))),
        ("scenario_group", text(&meta.scenario_group)),
        (
            "split",
            text(match meta.split {
                Split::Dev => "dev",
                Split::Locked => "locked",
            }),
        ),
        ("scored", Json::Bool(meta.scored)),
        (
            "pair_id",
            contrast.as_ref().map_or(Json::Null, |c| text(&c.pair_id)),
        ),
        (
            "role",
            contrast.as_ref().map_or(Json::Null, |c| {
                text(match c.role {
                    ContrastRole::A => "a",
                    ContrastRole::B => "b",
                })
            }),
        ),
    ]);
    Ok(vec![
        ("card", root),
        ("frozen_context", frozen_context_to_json(&ctx)),
        ("meta", meta_json),
        ("random_baseline_parts", baseline),
    ])
}

/// Kept permutation names in order for `{"frozen_context":…}`. Result member: `permutations`.
pub fn llm_permutations(input: &str) -> String {
    envelope(permutations_inner(input))
}

fn permutations_inner(input: &str) -> Res {
    let mut f = read_input(input)?;
    let ctx = read_context(f.req("frozen_context")?)?;
    f.finish()?;
    let names = render::permutations(&ctx)
        .into_iter()
        .map(|p| text(p.name()))
        .collect();
    Ok(vec![("permutations", Json::Array(names))])
}

/// Renders one prompt. Result members: `system`, `user`, `renderer_version`.
pub fn llm_render_prompt(input: &str) -> String {
    envelope(render_inner(input))
}

fn render_inner(input: &str) -> Res {
    let mut f = read_input(input)?;
    let ctx = read_context(f.req("frozen_context")?)?;
    let template = f.string("template")?;
    let schema_text = match f.opt("schema_text") {
        None | Some(Json::Null) => None,
        Some(Json::Str(s)) => Some(s),
        Some(_) => return input_err("input.schema_text must be a string or null"),
    };
    let name = f.string("permutation")?;
    let Some(perm) = Permutation::from_name(&name) else {
        return input_err("input.permutation is not a known permutation");
    };
    f.finish()?;
    match render::render(&ctx, &template, schema_text.as_deref(), perm) {
        Ok(p) => Ok(vec![
            ("system", Json::Str(p.system)),
            ("user", Json::Str(p.user)),
            ("renderer_version", Json::int(i64::from(RENDERER_VERSION))),
        ]),
        Err(e) => err("render", e.to_string()),
    }
}

/// Renders the System_One_Mapping for a D context. Input:
/// `{"frozen_context":…,"mapping":"<mapping text>","permutation":"base"|…}`. Result members:
/// `state`, `instructions`, `question_id`, `criteria` (`[{"id","label"},…]` in the
/// permutation's option order) and `renderer_version`. Unknown placeholders, including
/// `{{options}}`, are `render` errors naming the placeholder.
pub fn llm_render_system_one(input: &str) -> String {
    envelope(render_system_one_inner(input))
}

fn render_system_one_inner(input: &str) -> Res {
    let mut f = read_input(input)?;
    let ctx = read_context(f.req("frozen_context")?)?;
    let mapping = f.string("mapping")?;
    let name = f.string("permutation")?;
    let Some(perm) = Permutation::from_name(&name) else {
        return input_err("input.permutation is not a known permutation");
    };
    f.finish()?;
    match system_one::render_system_one(&ctx, &mapping, perm) {
        Ok(r) => Ok(vec![
            ("state", Json::Str(r.state)),
            ("instructions", Json::Str(r.instructions)),
            ("question_id", Json::Str(r.question_id)),
            (
                "criteria",
                Json::Array(
                    r.criteria
                        .iter()
                        .map(|(id, label)| object(vec![("id", text(id)), ("label", text(label))]))
                        .collect(),
                ),
            ),
            ("renderer_version", Json::int(i64::from(RENDERER_VERSION))),
        ]),
        Err(system_one::MapError::NotDecision) => {
            input_err("frozen_context must be a decision context")
        }
        Err(e) => err("render", e.to_string()),
    }
}

/// Validates one raw output or one non-text outcome. Result member: `verdict`.
///
/// The optional `mode` member is `json` (the default, and today's behaviour) or
/// `raw_choice`: `raw` is then a Raw_Choice string, and the verdict is `Decision` exactly
/// when it equals an option ID byte for byte (R4.16). `raw_choice` needs a D context; an
/// unknown `mode` is an `input` error.
pub fn llm_validate(input: &str) -> String {
    envelope(validate_inner(input))
}

fn validate_inner(input: &str) -> Res {
    let mut f = read_input(input)?;
    let ctx = read_context(f.req("frozen_context")?)?;
    let raw_choice = match f.opt("mode") {
        None => false,
        Some(Json::Str(m)) if m == "json" => false,
        Some(Json::Str(m)) if m == "raw_choice" => true,
        Some(Json::Str(_)) => return input_err("input.mode must be json or raw_choice"),
        Some(_) => return input_err("input.mode must be a string"),
    };
    let raw = f.opt("raw");
    let outcome = f.opt("outcome");
    f.finish()?;
    let options = match (&ctx.spec, raw_choice) {
        (TaskSpec::Decision { options }, true) => Some(options.as_slice()),
        (TaskSpec::Synthesis { .. }, true) => {
            return input_err("input.mode raw_choice needs a decision context");
        }
        (_, false) => None,
    };
    let verdict = match (raw, outcome) {
        (Some(Json::Str(raw)), None) => match options {
            Some(options) => validate::validate_raw_choice(options, &raw),
            None => validate::validate(&ctx, Outcome::Text(&raw)),
        },
        (None, Some(o)) => {
            let mut of = Fields::new("outcome", o)?;
            let kind = of.string("kind")?;
            let verdict = match kind.as_str() {
                "timeout" => {
                    of.opt("code");
                    of.opt("detail");
                    validate::validate(&ctx, Outcome::Timeout)
                }
                "error" => {
                    let code = of.string("code")?;
                    let detail = match of.opt("detail") {
                        None => String::new(),
                        Some(Json::Str(s)) => s,
                        Some(_) => return input_err("outcome.detail must be a string"),
                    };
                    validate::validate(
                        &ctx,
                        Outcome::Error {
                            code: &code,
                            detail: &detail,
                        },
                    )
                }
                _ => return input_err("outcome.kind must be timeout or error"),
            };
            of.finish()?;
            verdict
        }
        (Some(_), None) => return input_err("input.raw must be a string"),
        _ => return input_err("input needs exactly one of raw and outcome"),
    };
    Ok(vec![("verdict", verdict_to_json(&verdict))])
}

/// Grades one verdict against one card's answer key. Result member: `grade`.
pub fn llm_grade(input: &str) -> String {
    envelope(grade_inner(input))
}

fn grade_inner(input: &str) -> Res {
    let mut f = read_input(input)?;
    let (meta, _ctx, key, _contrast) = read_card_member(&mut f, "card")?;
    let verdict = read_verdict(f.req("verdict")?)?;
    f.finish()?;
    match grade::grade(&meta.id, &verdict, &key) {
        Ok(g) => Ok(vec![("grade", grade_to_json(&g))]),
        Err(e) => err("answer_key", e.to_string()),
    }
}

/// The Identity_Value of one verdict. Result member: `identity`.
pub fn llm_identity(input: &str) -> String {
    envelope(identity_inner(input))
}

fn identity_inner(input: &str) -> Res {
    let mut f = read_input(input)?;
    // The card is read so a faulty line is reported, though identity does not use the key.
    read_card_member(&mut f, "card")?;
    let verdict = read_verdict(f.req("verdict")?)?;
    f.finish()?;
    Ok(vec![(
        "identity",
        identity_to_json(&grade::identity(&verdict)),
    )])
}

/// The Direction_Consistent decision for one Contrast_Pair. Result member: `contrast`.
pub fn llm_contrast(input: &str) -> String {
    envelope(contrast_inner(input))
}

fn contrast_inner(input: &str) -> Res {
    let mut f = read_input(input)?;
    let (meta_a, _, _, contrast_a) = read_card_member(&mut f, "card_a")?;
    let verdict_a = read_verdict(f.req("verdict_a")?)?;
    let (meta_b, _, _, contrast_b) = read_card_member(&mut f, "card_b")?;
    let verdict_b = read_verdict(f.req("verdict_b")?)?;
    f.finish()?;
    let (Some(ca), Some(cb)) = (contrast_a, contrast_b) else {
        return err("card", "card has no contrast member");
    };
    if ca.pair_id != cb.pair_id {
        return err(
            "card",
            format!(
                "cards {} and {} are not one pair ({} and {})",
                meta_a.id, meta_b.id, ca.pair_id, cb.pair_id
            ),
        );
    }
    if ca.role != ContrastRole::A || cb.role != ContrastRole::B {
        return err(
            "card",
            format!(
                "pair {} needs card_a with role a and card_b with role b",
                ca.pair_id
            ),
        );
    }
    match grade::contrast(
        &ca.pair_id,
        &verdict_a,
        &verdict_b,
        &ca.expected_a,
        &ca.expected_b,
    ) {
        Ok(d) => Ok(vec![(
            "contrast",
            object(vec![
                ("a_in_expected", Json::Bool(d.a_in_expected)),
                ("b_in_expected", Json::Bool(d.b_in_expected)),
                ("consistent", Json::Bool(d.consistent)),
            ]),
        )]),
        Err(e) => err("answer_key", e.to_string()),
    }
}
