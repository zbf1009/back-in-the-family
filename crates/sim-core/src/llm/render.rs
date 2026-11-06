//! The Prompt_Renderer: a [`FrozenContext`], template text, optional schema text and a
//! [`Permutation`] in, a [`RenderedPrompt`] (`system` and `user` text) out.
//!
//! - The renderer only receives a [`FrozenContext`], so no answer-key or card meta field can
//!   reach a prompt.
//! - Template format: UTF-8 text with two sections introduced by the lines `[system]` and
//!   `[user]`, and the placeholders `{{tick}}`, `{{situation}}`, `{{people}}`, `{{relations}}`,
//!   `{{events}}`, `{{options}}`, `{{player_input}}`, `{{subject}}` and `{{schema}}`.
//!   Substituted values are never scanned for placeholders again.
//! - The blocks are rendered by fixed code (one line per person, relation, event, option).
//!   IDs are printed exactly as stored. An event with a `due_tick` ends with `, due day N`.
//! - `player_input`, `subject` and `relations` that are absent or empty render as `none` and
//!   never cause an error. Render errors are structural only.
//! - Permutations: `reversed`, `rotated_1`, `rotated_2` (left rotation `xs[k..] ++ xs[..k]`),
//!   applied to the options (D) or to each same-tick block of events (S).
//!
//! Integers, strings and ordered collections only: no floats, clocks, environment,
//! randomness or I/O.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::BTreeSet;
use std::fmt;

use super::{Event, FrozenContext, OptionDef, Person, PlayerInput, Relation, TaskSpec};

/// Part of the Model_Fingerprint: a change to the fixed block formats changes prompts
/// without changing a template's bytes.
pub const RENDERER_VERSION: u32 = 2;

/// One ordering of the options (D) or of the events inside same-tick blocks (S).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Permutation {
    Base,
    Reversed,
    Rotated1,
    Rotated2,
}

impl Permutation {
    /// The three non-base candidates in their fixed checking order.
    pub const CANDIDATES: [Permutation; 3] = [
        Permutation::Reversed,
        Permutation::Rotated1,
        Permutation::Rotated2,
    ];

    /// The name recorded with every output.
    pub fn name(self) -> &'static str {
        match self {
            Permutation::Base => "base",
            Permutation::Reversed => "reversed",
            Permutation::Rotated1 => "rotated_1",
            Permutation::Rotated2 => "rotated_2",
        }
    }

    /// Inverse of [`Permutation::name`].
    pub fn from_name(name: &str) -> Option<Self> {
        [Permutation::Base]
            .into_iter()
            .chain(Self::CANDIDATES)
            .find(|p| p.name() == name)
    }

    fn apply<T: Clone>(self, xs: &[T]) -> Vec<T> {
        let mut v = xs.to_vec();
        match self {
            Permutation::Base => {}
            Permutation::Reversed => v.reverse(),
            Permutation::Rotated1 => rotate_left(&mut v, 1),
            Permutation::Rotated2 => rotate_left(&mut v, 2),
        }
        v
    }
}

fn rotate_left<T>(v: &mut [T], k: usize) {
    if let Some(mid) = k.checked_rem(v.len()) {
        v.rotate_left(mid);
    }
}

/// The rendered prompt text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedPrompt {
    pub system: String,
    pub user: String,
}

/// Why a context or template cannot be rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderReason {
    /// A D context with fewer than 2 or more than 5 options.
    OptionCount(usize),
    /// A D context that repeats an option ID.
    DuplicateOptionId(String),
    /// A `{{name}}` that is not one of the nine placeholders.
    UnknownPlaceholder(String),
    /// A `{{` without a closing `}}`.
    UnterminatedPlaceholder,
    /// A placeholder whose value the context lacks (for example `{{options}}` on an S
    /// context, or `{{schema}}` without schema text).
    MissingValue(&'static str),
    /// The template lacks a `[system]` or `[user]` section, or has text before the first.
    BadSections,
    /// The template never uses a placeholder that the prompt must carry.
    MissingPlaceholder(&'static str),
}

/// A structural render error. The renderer does not know the Card ID; the caller attaches it
/// with [`RenderError::with_card_id`] and the message then names the card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderError {
    /// Card ID, empty until attached.
    pub card_id: String,
    pub reason: RenderReason,
}

impl RenderError {
    fn new(reason: RenderReason) -> Self {
        Self {
            card_id: String::new(),
            reason,
        }
    }

    /// Names the card this error belongs to.
    pub fn with_card_id(mut self, card_id: &str) -> Self {
        self.card_id = card_id.to_owned();
        self
    }
}

impl fmt::Display for RenderReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RenderReason::OptionCount(n) => write!(f, "decision has {n} options, need 2 to 5"),
            RenderReason::DuplicateOptionId(id) => write!(f, "repeated option ID {id}"),
            RenderReason::UnknownPlaceholder(name) => write!(f, "unknown placeholder {name}"),
            RenderReason::UnterminatedPlaceholder => write!(f, "unterminated placeholder"),
            RenderReason::MissingValue(name) => write!(f, "no value for placeholder {name}"),
            RenderReason::BadSections => write!(f, "template needs [system] and [user] sections"),
            RenderReason::MissingPlaceholder(name) => {
                write!(f, "template never uses placeholder {name}")
            }
        }
    }
}

impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.card_id.is_empty() {
            write!(f, "render: {}", self.reason)
        } else {
            write!(f, "render: card {}: {}", self.card_id, self.reason)
        }
    }
}

impl std::error::Error for RenderError {}

/// Options (D) in permuted order. Empty for S.
fn permuted_options(ctx: &FrozenContext, perm: Permutation) -> Vec<OptionDef> {
    match &ctx.spec {
        TaskSpec::Decision { options } => perm.apply(options),
        TaskSpec::Synthesis { .. } => Vec::new(),
    }
}

/// Events with the permutation applied inside each block of consecutive same-tick events.
/// Decisions never reorder events: their permutations act on the options only.
fn permuted_events(ctx: &FrozenContext, perm: Permutation) -> Vec<Event> {
    let perm = match ctx.spec {
        TaskSpec::Decision { .. } => Permutation::Base,
        TaskSpec::Synthesis { .. } => perm,
    };
    ctx.events
        .chunk_by(|a, b| a.tick == b.tick)
        .flat_map(|block| perm.apply(block))
        .collect()
}

/// The kept permutations in order: `base` first, then every non-base candidate whose
/// resulting order differs from the base and from every earlier kept candidate.
/// Sanity contexts get `base` only.
pub fn permutations(ctx: &FrozenContext) -> Vec<Permutation> {
    let mut kept = vec![Permutation::Base];
    if ctx.family == super::Family::Sanity {
        return kept;
    }
    let mut seen_options = vec![permuted_options(ctx, Permutation::Base)];
    let mut seen_events = vec![permuted_events(ctx, Permutation::Base)];
    for cand in Permutation::CANDIDATES {
        let options = permuted_options(ctx, cand);
        let events = permuted_events(ctx, cand);
        // A candidate is a duplicate only when one kept order has both parts equal.
        let duplicate = seen_options
            .iter()
            .zip(&seen_events)
            .any(|(o, e)| *o == options && *e == events);
        if duplicate {
            continue;
        }
        seen_options.push(options);
        seen_events.push(events);
        kept.push(cand);
    }
    kept
}

/// Renders one prompt. `schema_text` is substituted for `{{schema}}`.
pub fn render(
    ctx: &FrozenContext,
    template: &str,
    schema_text: Option<&str>,
    perm: Permutation,
) -> Result<RenderedPrompt, RenderError> {
    check_context(ctx)?;
    let (system_tpl, user_tpl) = split_sections(template)?;
    let values = Values::build(ctx, schema_text, perm);
    let mut used = BTreeSet::new();
    let system = substitute(system_tpl, &values, &mut used)?;
    let user = substitute(user_tpl, &values, &mut used)?;
    if !used.contains("tick") {
        return Err(RenderError::new(RenderReason::MissingPlaceholder("tick")));
    }
    if matches!(ctx.spec, TaskSpec::Decision { .. }) && !used.contains("options") {
        return Err(RenderError::new(RenderReason::MissingPlaceholder(
            "options",
        )));
    }
    if !ctx.events.is_empty() && !used.contains("events") {
        return Err(RenderError::new(RenderReason::MissingPlaceholder("events")));
    }
    Ok(RenderedPrompt { system, user })
}

fn check_context(ctx: &FrozenContext) -> Result<(), RenderError> {
    if let TaskSpec::Decision { options } = &ctx.spec {
        if !(2..=5).contains(&options.len()) {
            return Err(RenderError::new(RenderReason::OptionCount(options.len())));
        }
        let mut seen = BTreeSet::new();
        for o in options {
            if !seen.insert(o.id.as_str()) {
                return Err(RenderError::new(RenderReason::DuplicateOptionId(
                    o.id.as_str().to_owned(),
                )));
            }
        }
    }
    Ok(())
}

/// Splits at the `[system]` and `[user]` header lines (in that order), keeping bytes.
fn split_sections(template: &str) -> Result<(&str, &str), RenderError> {
    let bad = || RenderError::new(RenderReason::BadSections);
    let mut system_start = None;
    let mut user_header = None;
    let mut offset = 0usize;
    for line in template.split_inclusive('\n') {
        let end = offset.saturating_add(line.len());
        let bare = line.trim_end_matches(['\r', '\n']);
        if bare == "[system]" && system_start.is_none() && user_header.is_none() {
            if !template.get(..offset).ok_or_else(bad)?.trim().is_empty() {
                return Err(bad());
            }
            system_start = Some(end);
        } else if bare == "[user]" && system_start.is_some() && user_header.is_none() {
            user_header = Some((offset, end));
        }
        offset = end;
    }
    let (Some(sys_start), Some((user_line, user_start))) = (system_start, user_header) else {
        return Err(bad());
    };
    let system = template.get(sys_start..user_line).ok_or_else(bad)?;
    let user = template.get(user_start..).ok_or_else(bad)?;
    Ok((
        system.trim_end_matches(['\r', '\n']),
        user.trim_end_matches(['\r', '\n']),
    ))
}

struct Values<'a> {
    tick: String,
    situation: &'a str,
    people: String,
    relations: String,
    events: String,
    /// `None` on an S context.
    options: Option<String>,
    player_input: String,
    subject: String,
    schema: Option<&'a str>,
}

impl<'a> Values<'a> {
    fn build(ctx: &'a FrozenContext, schema_text: Option<&'a str>, perm: Permutation) -> Self {
        let options = match &ctx.spec {
            TaskSpec::Decision { .. } => {
                Some(block(permuted_options(ctx, perm).iter().map(option_line)))
            }
            TaskSpec::Synthesis { .. } => None,
        };
        Self {
            tick: ctx.tick.to_string(),
            situation: &ctx.situation,
            people: block(ctx.people.iter().map(person_line)),
            relations: block(ctx.relations.iter().map(relation_line)),
            events: block(permuted_events(ctx, perm).iter().map(event_line)),
            options,
            player_input: ctx
                .player_input
                .as_ref()
                .map_or_else(none_text, player_input_text),
            subject: ctx.subject.map_or_else(none_text, |p| format!("#{}", p.0)),
            schema: schema_text,
        }
    }

    fn get(&self, name: &str) -> Result<(&'static str, &str), RenderError> {
        let missing = |n: &'static str| RenderError::new(RenderReason::MissingValue(n));
        Ok(match name {
            "tick" => ("tick", &self.tick),
            "situation" => ("situation", self.situation),
            "people" => ("people", &self.people),
            "relations" => ("relations", &self.relations),
            "events" => ("events", &self.events),
            "options" => (
                "options",
                self.options.as_deref().ok_or_else(|| missing("options"))?,
            ),
            "player_input" => ("player_input", &self.player_input),
            "subject" => ("subject", &self.subject),
            "schema" => ("schema", self.schema.ok_or_else(|| missing("schema"))?),
            other => {
                return Err(RenderError::new(RenderReason::UnknownPlaceholder(
                    other.to_owned(),
                )));
            }
        })
    }
}

fn substitute(
    tpl: &str,
    values: &Values<'_>,
    used: &mut BTreeSet<&'static str>,
) -> Result<String, RenderError> {
    let mut out = String::new();
    let mut rest = tpl;
    while let Some((before, after)) = rest.split_once("{{") {
        out.push_str(before);
        let Some((name, tail)) = after.split_once("}}") else {
            return Err(RenderError::new(RenderReason::UnterminatedPlaceholder));
        };
        let (key, value) = values.get(name)?;
        used.insert(key);
        out.push_str(value);
        rest = tail;
    }
    out.push_str(rest);
    Ok(out)
}

fn none_text() -> String {
    "none".to_owned()
}

/// Joins lines with `\n`; an empty block is the single line `none`.
fn block(lines: impl Iterator<Item = String>) -> String {
    let joined = lines.collect::<Vec<_>>().join("\n");
    if joined.is_empty() {
        none_text()
    } else {
        joined
    }
}

fn words(items: impl Iterator<Item = String>) -> String {
    let joined = items.collect::<Vec<_>>().join(" ");
    if joined.is_empty() {
        "\u{2014}".to_owned()
    } else {
        joined
    }
}

fn person_line(p: &Person) -> String {
    let t = &p.traits;
    format!(
        "#{} {}, {}, {}, {}, {}, traits greed {} loyalty {} pride {} warmth {} temper {} vindictiveness {} piety {}, wealth {}, soul {}",
        p.id.0,
        p.name,
        p.age,
        p.sex,
        if p.alive { "alive" } else { "dead" },
        p.origin,
        t.greed,
        t.loyalty,
        t.pride,
        t.warmth,
        t.temper,
        t.vindictiveness,
        t.piety,
        p.wealth,
        p.soul_id,
    )
}

fn relation_line(r: &Relation) -> String {
    format!(
        "#{} -> #{} affinity {} trust {} tags {}",
        r.from.0,
        r.to.0,
        r.affinity,
        r.trust,
        words(r.tags.iter().cloned()),
    )
}

fn event_line(e: &Event) -> String {
    let mut line = format!(
        "{} day {} {} actors {} magnitude {} caused_by {} tags {}",
        e.id.as_str(),
        e.tick,
        e.kind,
        words(e.actors.iter().map(|a| format!("#{}", a.0))),
        e.magnitude,
        words(e.caused_by.iter().map(|c| c.as_str().to_owned())),
        words(e.tags.iter().cloned()),
    );
    if let Some(due) = e.due_tick {
        line.push_str(&format!(", due day {due}"));
    }
    line
}

fn option_line(o: &OptionDef) -> String {
    format!("- {}: {}", o.id.as_str(), o.label)
}

fn player_input_text(p: &PlayerInput) -> String {
    match (p.intent.is_empty(), p.content.is_empty()) {
        (true, true) => none_text(),
        (false, true) => p.intent.clone(),
        (true, false) => p.content.clone(),
        (false, false) => format!("{}: {}", p.intent, p.content),
    }
}

#[cfg(test)]
#[allow(
    clippy::panic,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::arithmetic_side_effects
)]
mod tests {
    use super::*;
    use crate::llm::{EventId, Family, OptionId, OutputSchema, PersonId, Task, Traits};

    const TEMPLATE: &str = "[system]\nYou decide.\n[user]\nToday is day {{tick}}.\n{{situation}}\nPeople:\n{{people}}\nRelations:\n{{relations}}\nEvents:\n{{events}}\nOptions:\n{{options}}\nInput: {{player_input}}\nSubject: {{subject}}\n";

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
                loyalty: 1,
                pride: 2,
                warmth: 3,
                temper: 4,
                vindictiveness: 5,
                piety: 6,
            },
            wealth: 2600,
            soul_id: "S-0102".into(),
        }
    }

    fn event(id: &str, tick: i64, due: Option<i64>) -> Event {
        Event {
            id: EventId::new(id).unwrap(),
            tick,
            kind: "dream".into(),
            actors: vec![PersonId(1), PersonId(2)],
            magnitude: 0,
            due_tick: due,
            caused_by: vec![],
            tags: vec![],
        }
    }

    fn opts(ids: &[&str]) -> Vec<OptionDef> {
        ids.iter()
            .map(|i| OptionDef {
                id: OptionId::new(i).unwrap(),
                label: format!("label {i}"),
            })
            .collect()
    }

    fn decision(ids: &[&str]) -> FrozenContext {
        FrozenContext {
            task: Task::Decision,
            family: Family::DebtRepayment,
            tick: 21400,
            subject: None,
            people: vec![person(1), person(2)],
            relations: vec![],
            events: vec![event("e3", 21000, Some(21500))],
            situation: "A debt falls due.".into(),
            player_input: None,
            spec: TaskSpec::Decision { options: opts(ids) },
        }
    }

    fn synthesis(ticks: &[i64]) -> FrozenContext {
        let mut ctx = decision(&["a", "b"]);
        ctx.task = Task::Synthesis;
        ctx.family = Family::GrudgeDetection;
        ctx.spec = TaskSpec::Synthesis {
            schema: OutputSchema::GrudgeV1,
        };
        ctx.events = ticks
            .iter()
            .enumerate()
            .map(|(i, t)| event(&format!("e{}", i + 1), *t, None))
            .collect();
        ctx
    }

    #[test]
    fn renders_blocks_none_and_due_day() {
        let ctx = decision(&["a", "b"]);
        let p = render(&ctx, TEMPLATE, None, Permutation::Base).unwrap();
        assert_eq!(p.system, "You decide.");
        assert!(p.user.starts_with("Today is day 21400.\nA debt falls due."));
        assert!(p.user.contains("#1 P1, 30, female, alive, native, traits greed 0 loyalty 1 pride 2 warmth 3 temper 4 vindictiveness 5 piety 6, wealth 2600, soul S-0102"));
        assert!(p.user.contains("Relations:\nnone\n"));
        assert!(p.user.contains(
            "e3 day 21000 dream actors #1 #2 magnitude 0 caused_by \u{2014} tags \u{2014}, due day 21500"
        ));
        assert!(p.user.contains("- a: label a\n- b: label b"));
        assert!(p.user.ends_with("Input: none\nSubject: none"));
    }

    #[test]
    fn option_order_follows_the_permutation() {
        let ctx = decision(&["a", "b", "c"]);
        let p = render(&ctx, TEMPLATE, None, Permutation::Rotated1).unwrap();
        assert!(p.user.contains("- b: label b\n- c: label c\n- a: label a"));
        let p = render(&ctx, TEMPLATE, None, Permutation::Reversed).unwrap();
        assert!(p.user.contains("- c: label c\n- b: label b\n- a: label a"));
    }

    #[test]
    fn permutation_counts() {
        use Permutation::*;
        assert_eq!(permutations(&decision(&["a", "b"])), [Base, Reversed]);
        assert_eq!(
            permutations(&decision(&["a", "b", "c"])),
            [Base, Reversed, Rotated1, Rotated2]
        );
        // S: blocks of one event stay put; a 2-event block gives only `reversed`.
        assert_eq!(permutations(&synthesis(&[1, 2, 3])), [Base]);
        assert_eq!(permutations(&synthesis(&[1, 2, 2, 3])), [Base, Reversed]);
        assert_eq!(permutations(&synthesis(&[5, 5, 5])).len(), 4);
        let mut sanity = decision(&["a", "b", "c"]);
        sanity.family = Family::Sanity;
        assert_eq!(permutations(&sanity), [Base]);
    }

    #[test]
    fn synthesis_permutes_only_inside_same_tick_blocks() {
        let ctx = synthesis(&[1, 2, 2, 3]);
        let p = render(
            &ctx,
            "[system]\ns\n[user]\nday {{tick}}\n{{events}}\n{{schema}}",
            Some("grudge_v1"),
            Permutation::Reversed,
        )
        .unwrap();
        let ids: Vec<&str> = p
            .user
            .lines()
            .filter(|l| l.starts_with('e'))
            .map(|l| l.split(' ').next().unwrap())
            .collect();
        assert_eq!(ids, ["e1", "e3", "e2", "e4"]);
        assert!(p.user.ends_with("grudge_v1"));
    }

    #[test]
    fn structural_errors_name_card_and_reason() {
        let ctx = decision(&["a", "a"]);
        let e = render(&ctx, TEMPLATE, None, Permutation::Base)
            .unwrap_err()
            .with_card_id("D001");
        assert!(matches!(e.reason, RenderReason::DuplicateOptionId(_)));
        assert!(e.to_string().contains("D001") && e.to_string().contains("repeated option ID a"));
        let e = render(&decision(&["a"]), TEMPLATE, None, Permutation::Base).unwrap_err();
        assert_eq!(e.reason, RenderReason::OptionCount(1));
        let e = render(&synthesis(&[1]), TEMPLATE, None, Permutation::Base).unwrap_err();
        assert_eq!(e.reason, RenderReason::MissingValue("options"));
        let e = render(
            &decision(&["a", "b"]),
            "[system]\n{{nope}}\n[user]\n{{tick}}",
            None,
            Permutation::Base,
        )
        .unwrap_err();
        assert_eq!(e.reason, RenderReason::UnknownPlaceholder("nope".into()));
        let e = render(
            &decision(&["a", "b"]),
            "no sections",
            None,
            Permutation::Base,
        );
        assert_eq!(e.unwrap_err().reason, RenderReason::BadSections);
    }

    #[test]
    fn substituted_text_is_not_rescanned() {
        let mut ctx = decision(&["a", "b"]);
        ctx.situation = "{{schema}}".into();
        let p = render(&ctx, TEMPLATE, None, Permutation::Base).unwrap();
        assert!(p.user.contains("\n{{schema}}\n"));
    }

    #[test]
    fn player_input_and_subject_render_when_present() {
        let mut ctx = decision(&["a", "b"]);
        ctx.subject = Some(PersonId(2));
        ctx.player_input = Some(PlayerInput {
            intent: "plead".into(),
            content: "please".into(),
        });
        let p = render(&ctx, TEMPLATE, None, Permutation::Base).unwrap();
        assert!(p.user.ends_with("Input: plead: please\nSubject: #2"));
        ctx.player_input = Some(PlayerInput {
            intent: String::new(),
            content: String::new(),
        });
        let p = render(&ctx, TEMPLATE, None, Permutation::Base).unwrap();
        assert!(p.user.contains("Input: none\n"));
    }
}
