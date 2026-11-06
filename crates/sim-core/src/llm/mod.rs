//! LLM boundary: frozen context, answer verdicts, answer keys and grades.
//!
//! This module holds the types only (task 1.1 of the llm-probe spec). Rendering,
//! validation and grading are added by later tasks. Everything here is integers,
//! strings and ordered collections: no floats, clocks, environment, randomness or I/O.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

pub mod answer;
pub mod card;
pub mod context;
pub mod json;
pub mod key;
pub mod validate;

use std::collections::BTreeSet;

pub use context::{
    Event, Family, FrozenContext, OptionDef, Person, PlayerInput, Relation, TaskSpec, Traits,
};
pub use key::{AnswerKey, Grade, Pattern, PatternValue, Scalar, SevereCondition};

/// A person ID. Card schema: integer >= 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PersonId(pub i64);

/// An event ID matching `^e[0-9]{1,4}$`, compared character for character.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct EventId(String);

impl EventId {
    /// Returns `None` unless `s` matches `^e[0-9]{1,4}$`.
    pub fn new(s: &str) -> Option<Self> {
        let digits = s.strip_prefix('e')?;
        let ok = (1..=4).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit());
        ok.then(|| Self(s.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An option ID matching `^[a-z][a-z_]*$`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct OptionId(String);

impl OptionId {
    /// Returns `None` unless `s` matches `^[a-z][a-z_]*$`.
    pub fn new(s: &str) -> Option<Self> {
        let mut bytes = s.bytes();
        let first_ok = bytes.next().is_some_and(|b| b.is_ascii_lowercase());
        let rest_ok = bytes.all(|b| b.is_ascii_lowercase() || b == b'_');
        (first_ok && rest_ok).then(|| Self(s.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Task {
    Decision,
    Synthesis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum OutputSchema {
    GrudgeV1,
    DebtChainV1,
    BrokenPromiseV1,
    RelationshipShiftV1,
}

/// Result of validating one model output against a [`FrozenContext`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Decision {
        option: OptionId,
    },
    Synthesis {
        answer: SynthesisAnswer,
        /// Sorted, deduplicated person IDs that the context does not contain.
        missing_persons: Vec<i64>,
        /// Sorted, deduplicated event IDs that the context does not contain.
        missing_events: Vec<String>,
    },
    Illegal {
        reason: IllegalReason,
        path: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum IllegalReason {
    ParseFailure,
    OutOfSetOption,
    MissingRequiredField,
    UnknownField,
    IllegalEnumValue,
    NonInteger,
    IntegerOutOfRange,
    EmptyEvidence,
    DuplicateEvidence,
    MalformedEventId,
    WrongType,
    WrongSchemaConst,
    /// Built by the runner for non-text outcomes.
    Timeout,
    /// Built by the runner for non-text outcomes.
    RuntimeError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DebtStatus {
    Open,
    Repaid,
    Transferred,
    Forgiven,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PromiseStatus {
    Broken,
    Pending,
    Kept,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Direction {
    Warmer,
    Colder,
    Unchanged,
    Reversed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SynthesisAnswer {
    Grudge(Vec<GrudgeItem>),
    DebtChain(Vec<DebtItem>),
    BrokenPromise(Vec<PromiseItem>),
    RelationshipShift(Vec<ShiftItem>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrudgeItem {
    pub from: i64,
    pub to: i64,
    pub level: Level,
    pub evidence: Vec<EventId>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DebtItem {
    pub debtor: i64,
    pub creditor: i64,
    pub amount: i64,
    pub status: DebtStatus,
    pub origin_event: EventId,
    pub transferred_from: Option<i64>,
    pub evidence: Vec<EventId>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromiseItem {
    pub promisor: i64,
    pub promisee: i64,
    pub promise_event: EventId,
    pub status: PromiseStatus,
    pub evidence: Vec<EventId>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShiftItem {
    pub a: i64,
    pub b: i64,
    pub direction: Direction,
    pub turning_point: Option<EventId>,
    pub evidence: Vec<EventId>,
    pub reason: String,
}

/// One canonical identity tuple of a synthesis answer (used by the shuffle test).
///
/// `RelationshipShift` stores `(min(a, b), max(a, b), direction, turning_point)`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum IdentityTuple {
    Grudge {
        from: i64,
        to: i64,
        level: Level,
    },
    DebtChain {
        debtor: i64,
        creditor: i64,
        origin_event: EventId,
        status: DebtStatus,
        amount: i64,
    },
    BrokenPromise {
        promisor: i64,
        promisee: i64,
        promise_event: EventId,
        status: PromiseStatus,
    },
    RelationshipShift {
        low: i64,
        high: i64,
        direction: Direction,
        turning_point: Option<EventId>,
    },
}

/// What a run produced, reduced to the value compared across permutations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityValue {
    Invalid,
    Option(OptionId),
    Set(BTreeSet<IdentityTuple>),
}

/// Result of the contrast-pair check for one pair of cards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContrastDecision {
    pub a_in_expected: bool,
    pub b_in_expected: bool,
    pub consistent: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_id_accepts_only_the_card_pattern() {
        for ok in ["e0", "e1", "e9999", "e0042"] {
            assert!(EventId::new(ok).is_some(), "{ok}");
        }
        for bad in ["", "e", "E1", "e12345", "e1a", "x1", " e1", "e-1", "e١"] {
            assert!(EventId::new(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn option_id_accepts_only_the_card_pattern() {
        for ok in ["a", "heed_warning", "x_"] {
            assert!(OptionId::new(ok).is_some(), "{ok}");
        }
        for bad in ["", "_a", "A", "a1", "a-b", "a b"] {
            assert!(OptionId::new(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn event_ids_compare_character_for_character() {
        let a = EventId::new("e2").map(|e| e.as_str().to_owned());
        let b = EventId::new("e02").map(|e| e.as_str().to_owned());
        assert_ne!(a, b);
    }
}
