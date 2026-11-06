//! Answer keys, patterns and grades. Never part of a [`super::FrozenContext`].

use std::collections::{BTreeMap, BTreeSet};

use super::{EventId, OptionId, OutputSchema};

/// A scalar value in a pattern field.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Scalar {
    Int(i64),
    Str(String),
    Null,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatternValue {
    Exact(Scalar),
    AnyOf(Vec<Scalar>),
}

/// A conclusion pattern: every key in `fields` must match; `evidence_any`, when present,
/// needs a non-empty intersection with the item's evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pattern {
    pub fields: BTreeMap<String, PatternValue>,
    pub evidence_any: Option<BTreeSet<EventId>>,
}

/// Severe conditions. `Ord` is the declared order; a [`Grade`] lists conditions in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SevereCondition {
    InventedEventId,
    InventedPerson,
    SelfReference,
    ReversedDirection,
    DeadPersonAsActorAfterDeath,
    ContradictsFact,
    WrongDebtHolder,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnswerKey {
    Decision {
        acceptable: BTreeSet<OptionId>,
        severe: BTreeSet<OptionId>,
    },
    Synthesis {
        schema: OutputSchema,
        must_include: Vec<Pattern>,
        must_not_include: Vec<Pattern>,
        severe_conditions: BTreeSet<SevereCondition>,
        severe_patterns: Vec<(SevereCondition, Pattern)>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grade {
    pub acceptable: bool,
    pub severe: bool,
    pub illegal: bool,
    /// Sorted in [`SevereCondition`] order.
    pub severe_conditions: Vec<SevereCondition>,
}
