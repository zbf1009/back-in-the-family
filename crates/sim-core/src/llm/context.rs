//! The Frozen_Context: the only input of rendering and validation.
//!
//! It holds no answer-key field. The answer key lives in [`super::key`] and is never
//! reachable from a [`FrozenContext`].

use super::{EventId, OptionId, OutputSchema, PersonId, Task};

/// Node type of a card. Selects nothing in the answer key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Family {
    DreamInterpretation,
    WillExecution,
    ReconcileOrRevenge,
    DebtRepayment,
    Remarriage,
    MagistrateRuling,
    GrudgeDetection,
    DebtChain,
    BrokenPromise,
    RelationshipShift,
    Sanity,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Traits {
    pub greed: i64,
    pub loyalty: i64,
    pub pride: i64,
    pub warmth: i64,
    pub temper: i64,
    pub vindictiveness: i64,
    pub piety: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    pub id: PersonId,
    pub name: String,
    pub age: i64,
    /// `female` or `male`.
    pub sex: String,
    pub alive: bool,
    /// `native`, `possessed`, `rebuilt` or `official`.
    pub origin: String,
    pub traits: Traits,
    pub wealth: i64,
    pub soul_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relation {
    pub from: PersonId,
    pub to: PersonId,
    pub affinity: i64,
    pub trust: i64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub id: EventId,
    pub tick: i64,
    pub kind: String,
    pub actors: Vec<PersonId>,
    pub magnitude: i64,
    pub due_tick: Option<i64>,
    pub caused_by: Vec<EventId>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerInput {
    pub intent: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OptionDef {
    pub id: OptionId,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskSpec {
    /// 2..=5 options with unique IDs (checked when the context is built).
    Decision {
        options: Vec<OptionDef>,
    },
    Synthesis {
        schema: OutputSchema,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrozenContext {
    pub task: Task,
    pub family: Family,
    pub tick: i64,
    pub subject: Option<PersonId>,
    /// Card order.
    pub people: Vec<Person>,
    pub relations: Vec<Relation>,
    /// Card order (sorted by tick).
    pub events: Vec<Event>,
    pub situation: String,
    pub player_input: Option<PlayerInput>,
    pub spec: TaskSpec,
}
