//! The System_One_Mapping (llm-probe R19.7, R19.10; design DA-18): a mapping text, a D
//! [`FrozenContext`] and a [`Permutation`] in; `state`, `instructions`, `question_id` and
//! `criteria` out. Only those three inputs are read, so the output depends on nothing else.
//!
//! Mapping format (UTF-8): sections introduced by their own header lines.
//!
//! - `[meta]` (optional): `key: value` lines. `format_version`, if present, must be `1`;
//!   `question_id` names the question (default `decision`); other keys are descriptive.
//! - `[instructions]` (required): returned unchanged, without trailing line breaks. It may
//!   not contain a `{{placeholder}}`.
//! - `[state]` (required): filled with the fixed fact blocks of [`super::render`]; the
//!   placeholders are `{{tick}}`, `{{situation}}`, `{{people}}`, `{{relations}}`,
//!   `{{events}}`, `{{player_input}}` and `{{subject}}`. `{{options}}` is unknown here.
//! - `[criteria]` (optional): free text describing the option-to-label mapping; ignored.
//!
//! Text before the first header must be blank. A section may appear once.
//!
//! Integers, strings and ordered collections only: no floats, clocks, environment,
//! randomness or I/O.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::fmt;

use super::render::{self, Permutation, RenderError};
use super::{FrozenContext, TaskSpec};

/// The only mapping format version this code reads.
pub const FORMAT_VERSION: &str = "1";

/// The question ID when the mapping names none.
pub const DEFAULT_QUESTION_ID: &str = "decision";

/// The rendered pieces of one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemOne {
    pub state: String,
    pub instructions: String,
    pub question_id: String,
    /// `(option ID, label)` in the permutation's order.
    pub criteria: Vec<(String, String)>,
}

/// Why a mapping cannot be rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MapError {
    /// The mapping text is malformed; the message says how.
    Mapping(String),
    /// The state or instructions text, or the context, fails the fact-block rules.
    Render(RenderError),
    /// The context is not a decision.
    NotDecision,
}

impl fmt::Display for MapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MapError::Mapping(m) => write!(f, "render: mapping: {m}"),
            MapError::Render(e) => write!(f, "{e}"),
            MapError::NotDecision => write!(f, "render: system_one needs a decision context"),
        }
    }
}

impl std::error::Error for MapError {}

impl From<RenderError> for MapError {
    fn from(e: RenderError) -> Self {
        MapError::Render(e)
    }
}

struct Sections<'a> {
    meta: Option<&'a str>,
    instructions: Option<&'a str>,
    state: Option<&'a str>,
}

fn bad<T>(message: impl Into<String>) -> Result<T, MapError> {
    Err(MapError::Mapping(message.into()))
}

fn split_sections(mapping: &str) -> Result<Sections<'_>, MapError> {
    let mut out = Sections {
        meta: None,
        instructions: None,
        state: None,
    };
    // (section name, start offset of its body)
    let mut current: Option<(&str, usize)> = None;
    let mut offset = 0usize;
    let mut close = |current: &mut Option<(&str, usize)>, end: usize| -> Result<(), MapError> {
        if let Some((name, start)) = current.take() {
            let body = mapping
                .get(start..end)
                .unwrap_or_default()
                .trim_end_matches(['\r', '\n']);
            let slot = match name {
                "meta" => &mut out.meta,
                "instructions" => &mut out.instructions,
                "state" => &mut out.state,
                _ => return Ok(()),
            };
            if slot.replace(body).is_some() {
                return bad(format!("section [{name}] appears twice"));
            }
        }
        Ok(())
    };
    for line in mapping.split_inclusive('\n') {
        let end = offset.saturating_add(line.len());
        let bare = line.trim_end_matches(['\r', '\n']);
        let header = bare
            .strip_prefix('[')
            .and_then(|r| r.strip_suffix(']'))
            .filter(|n| matches!(*n, "meta" | "instructions" | "state" | "criteria"));
        if let Some(name) = header {
            close(&mut current, offset)?;
            current = Some((name, end));
        } else if current.is_none() && !bare.trim().is_empty() {
            return bad("text before the first section header");
        }
        offset = end;
    }
    close(&mut current, mapping.len())?;
    Ok(out)
}

/// The `question_id` of a `[meta]` body, after checking `format_version`.
fn read_meta(meta: Option<&str>) -> Result<String, MapError> {
    let mut question_id = DEFAULT_QUESTION_ID.to_owned();
    for line in meta.unwrap_or_default().lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "format_version" if value != FORMAT_VERSION => {
                return bad(format!("unsupported format_version {value}"));
            }
            "question_id" => {
                let ok = !value.is_empty() && value.bytes().all(|b| b.is_ascii_alphabetic());
                if !ok {
                    return bad("question_id must be letters only");
                }
                question_id = value.to_owned();
            }
            _ => {}
        }
    }
    Ok(question_id)
}

/// Renders the mapping for a D context and a permutation.
pub fn render_system_one(
    ctx: &FrozenContext,
    mapping: &str,
    perm: Permutation,
) -> Result<SystemOne, MapError> {
    if !matches!(ctx.spec, TaskSpec::Decision { .. }) {
        return Err(MapError::NotDecision);
    }
    let sections = split_sections(mapping)?;
    let question_id = read_meta(sections.meta)?;
    let Some(instructions) = sections.instructions else {
        return bad("missing section [instructions]");
    };
    let Some(state_tpl) = sections.state else {
        return bad("missing section [state]");
    };
    render::reject_placeholders(instructions)?;
    let state = render::render_state(ctx, state_tpl, perm)?;
    Ok(SystemOne {
        state,
        instructions: instructions.to_owned(),
        question_id,
        criteria: render::criteria(ctx, perm),
    })
}
