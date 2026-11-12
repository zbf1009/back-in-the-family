//! The recorded input stream (design decision D6: submission order).
//!
//! Everything external to the simulation enters as a [`TickInput`] tagged with the tick
//! it applies on. Inputs for the same tick apply in `seq` order, and `seq` is assigned
//! in submission order when the stream accepts the input.
//!
//! Submission only checks the past-tick rule. Whether a payload makes sense for the
//! current world (persons exist, both are alive, intensity in range) is decided at
//! apply time inside the tick loop (R1.5, R6.5); an invalid payload is skipped and
//! recorded in the world's [`Rejections`](crate::world::Rejections).

use std::fmt;

use crate::canon::{Canon, CanonWriter};
use crate::ids::{IdCounter, InputSeq, PersonId, Tick};
use crate::values::SocialKind;

/// The one input kind of the life-sim (OP-6 A): one social act between two Residents.
///
/// `intensity` is the raw `u8` so that out-of-range values can be *rejected* at apply
/// time instead of being refused by the type. A valid payload turns into an
/// [`Intensity`] and appends the matching social Event through the normal path.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum InputPayload {
    /// Perform a social act: `actor` acts on `target` with `intensity` (1..=100).
    Act {
        kind: SocialKind,
        actor: PersonId,
        target: PersonId,
        intensity: u8,
    },
}

/// Why an input was skipped at apply time (R1.5, R6.5).
///
/// The variant names are also the `batch` report labels (`unknown_person`, ...).
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum RejectReason {
    /// The actor or the target is not a Person in the World.
    UnknownPerson,
    /// The actor or the target is dead (R6.5).
    DeadPerson,
    /// The actor and the target are the same Person.
    SelfTarget,
    /// The intensity is outside 1..=100.
    IntensityOutOfRange,
    /// The Event ID counter ran out.
    IdExhausted,
    /// The input names the Magistrate in a Person field (R15.9).
    OfficialPerson,
    /// The Player_Soul has no Ghost yet (before its first death, R4.3).
    NoGhost,
    /// The Player_Soul is not in the Waiting_Queue.
    NotWaiting,
    /// The dreamer or the haunting target is not a Connected_Person of the Ghost.
    NotConnected,
    /// A dream or a haunting was already applied in this tick (OP-U5 A).
    RateLimited,
    /// The Joss_Balance is below the price.
    InsufficientJoss,
    /// The spend would exceed the Yearly_Cap (R2.6).
    YearlyCap,
    /// A Bribe amount of 0 (R6.2).
    BadAmount,
    /// A `magistrate_ruling` node for the Player_Soul is already pending.
    NodePending,
    /// The named Birth_Slot is not open.
    SlotClosed,
    /// The named Birth_Slot is already claimed (R7.3).
    SlotClaimed,
    /// The Player_Soul already holds a claim on another Birth_Slot (R7.3).
    ClaimHeld,
    /// The Player_Soul may not claim a Birth_Slot before its `access_from` (OP-U6 A).
    RegisterWait,
    /// No pending node was fired by the named trigger input in this tick.
    UnknownNode,
    /// The option is outside the node's option set (R3.4).
    OptionNotInSet,
    /// The pending node already has a valid External_Choice (R3.4).
    AlreadyChosen,
}

impl RejectReason {
    /// Every reason in report order: the life-sim reasons first, then the underworld
    /// reasons in the order their labels first appear in the design's input table.
    /// The `batch` report lists all of them.
    pub const ALL: [Self; 21] = [
        Self::UnknownPerson,
        Self::DeadPerson,
        Self::SelfTarget,
        Self::IntensityOutOfRange,
        Self::IdExhausted,
        Self::OfficialPerson,
        Self::NoGhost,
        Self::NotWaiting,
        Self::NotConnected,
        Self::RateLimited,
        Self::InsufficientJoss,
        Self::YearlyCap,
        Self::BadAmount,
        Self::NodePending,
        Self::SlotClosed,
        Self::SlotClaimed,
        Self::ClaimHeld,
        Self::RegisterWait,
        Self::UnknownNode,
        Self::OptionNotInSet,
        Self::AlreadyChosen,
    ];

    /// The report label used by `sim-cli batch`.
    pub const fn label(self) -> &'static str {
        match self {
            Self::UnknownPerson => "unknown_person",
            Self::DeadPerson => "dead_person",
            Self::SelfTarget => "self_target",
            Self::IntensityOutOfRange => "intensity_out_of_range",
            Self::IdExhausted => "id_exhausted",
            Self::OfficialPerson => "official_person",
            Self::NoGhost => "no_ghost",
            Self::NotWaiting => "not_waiting",
            Self::NotConnected => "not_connected",
            Self::RateLimited => "rate_limited",
            Self::InsufficientJoss => "insufficient_joss",
            Self::YearlyCap => "yearly_cap",
            Self::BadAmount => "bad_amount",
            Self::NodePending => "node_pending",
            Self::SlotClosed => "slot_closed",
            Self::SlotClaimed => "slot_claimed",
            Self::ClaimHeld => "claim_held",
            Self::RegisterWait => "register_wait",
            Self::UnknownNode => "unknown_node",
            Self::OptionNotInSet => "option_not_in_set",
            Self::AlreadyChosen => "already_chosen",
        }
    }
}

/// One recorded input.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct TickInput {
    /// The tick this input applies on.
    pub tick: Tick,
    /// Submission order, assigned by [`InputStream::submit`].
    pub seq: InputSeq,
    pub payload: InputPayload,
}

/// The result of one input of a tick (R11.5), returned by
/// [`World::step_with_outcomes`](crate::world::World::step_with_outcomes) in `(tick, seq)`
/// order.
///
/// It is a return value, not World state: it is never encoded, never checksummed and
/// empty after loading a run (LS-R16.5, LS-R16.6).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct InputOutcome {
    /// The input's `seq`.
    pub seq: InputSeq,
    /// `Ok(())` when the input applied, `Err(reason)` when it was skipped (LS-R1.5).
    pub result: Result<(), RejectReason>,
}

/// Why [`InputStream::submit`] refused an input.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SubmitError {
    /// The input's tick is earlier than the current tick.
    PastTick { tick: Tick, current: Tick },
    /// The `seq` counter ran out of values.
    SeqExhausted,
}

impl fmt::Display for SubmitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PastTick { tick, current } => write!(
                f,
                "input for tick {} is in the past (current tick {})",
                tick.0, current.0
            ),
            Self::SeqExhausted => f.write_str("input sequence counter exhausted"),
        }
    }
}

impl std::error::Error for SubmitError {}

/// All accepted inputs, ordered by `(tick, seq)`.
///
/// Ordering strategy: **sorted insertion**. A new input gets the largest `seq` so far,
/// so it belongs after every existing input with the same or an earlier tick and
/// before any with a later tick; it is inserted at that position (`partition_point`).
/// In normal play (ticks only move forward) this is an append, but inputs for distant
/// future ticks may be submitted out of tick order and the invariant still holds.
/// Keeping the vector sorted at all times makes [`InputStream::for_tick`] a pure read
/// returning a contiguous slice, with no sort on the hot path.
#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct InputStream {
    inputs: Vec<TickInput>,
    next_seq: IdCounter,
}

impl InputStream {
    pub const fn new() -> Self {
        Self {
            inputs: Vec::new(),
            next_seq: IdCounter::new(),
        }
    }

    /// Accepts `payload` for `tick` and returns its `seq`.
    ///
    /// Rejects `tick < current_tick` with [`SubmitError::PastTick`]. On any rejection
    /// the stream is left exactly as it was (the `seq` counter is not consumed).
    pub fn submit(
        &mut self,
        current_tick: Tick,
        tick: Tick,
        payload: InputPayload,
    ) -> Result<InputSeq, SubmitError> {
        if tick < current_tick {
            return Err(SubmitError::PastTick {
                tick,
                current: current_tick,
            });
        }
        // `IdCounter::next` leaves the counter unchanged on error.
        let seq = InputSeq(
            self.next_seq
                .next()
                .map_err(|_| SubmitError::SeqExhausted)?,
        );
        let at = self.inputs.partition_point(|i| i.tick <= tick);
        self.inputs.insert(at, TickInput { tick, seq, payload });
        Ok(seq)
    }

    /// The inputs that apply on `tick`, in `seq` order.
    pub fn for_tick(&self, tick: Tick) -> &[TickInput] {
        let start = self.inputs.partition_point(|i| i.tick < tick);
        let end = self.inputs.partition_point(|i| i.tick <= tick);
        self.inputs.get(start..end).unwrap_or(&[])
    }

    /// Every accepted input in `(tick, seq)` order.
    pub fn all(&self) -> &[TickInput] {
        &self.inputs
    }
}

impl Canon for RejectReason {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::UnknownPerson => 0,
            Self::DeadPerson => 1,
            Self::SelfTarget => 2,
            Self::IntensityOutOfRange => 3,
            Self::IdExhausted => 4,
            Self::OfficialPerson => 5,
            Self::NoGhost => 6,
            Self::NotWaiting => 7,
            Self::NotConnected => 8,
            Self::RateLimited => 9,
            Self::InsufficientJoss => 10,
            Self::YearlyCap => 11,
            Self::BadAmount => 12,
            Self::NodePending => 13,
            Self::SlotClosed => 14,
            Self::SlotClaimed => 15,
            Self::ClaimHeld => 16,
            Self::RegisterWait => 17,
            Self::UnknownNode => 18,
            Self::OptionNotInSet => 19,
            Self::AlreadyChosen => 20,
        };
        tag.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACT: InputPayload = InputPayload::Act {
        kind: SocialKind::Help,
        actor: PersonId(1),
        target: PersonId(2),
        intensity: 40,
    };

    #[test]
    fn past_tick_is_rejected_and_stream_is_unchanged() {
        let mut s = InputStream::new();
        s.submit(Tick(0), Tick(5), ACT).unwrap();
        s.submit(Tick(0), Tick(2), ACT).unwrap();
        let before = s.clone();
        assert_eq!(
            s.submit(Tick(4), Tick(3), ACT),
            Err(SubmitError::PastTick {
                tick: Tick(3),
                current: Tick(4)
            })
        );
        assert_eq!(s, before);
        // The seq counter was not consumed by the rejection.
        assert_eq!(s.submit(Tick(4), Tick(4), ACT), Ok(InputSeq(2)));
    }

    #[test]
    fn current_tick_is_accepted() {
        let mut s = InputStream::new();
        assert_eq!(s.submit(Tick(3), Tick(3), ACT), Ok(InputSeq(0)));
    }

    #[test]
    fn for_tick_returns_seq_order_even_when_submitted_out_of_tick_order() {
        let mut s = InputStream::new();
        let a = s.submit(Tick(0), Tick(7), ACT).unwrap();
        let b = s.submit(Tick(0), Tick(2), ACT).unwrap();
        let c = s.submit(Tick(0), Tick(7), ACT).unwrap();
        let d = s.submit(Tick(0), Tick(2), ACT).unwrap();
        let seqs = |t| {
            s.for_tick(Tick(t))
                .iter()
                .map(|i| i.seq)
                .collect::<Vec<_>>()
        };
        assert_eq!(seqs(2), [b, d]);
        assert_eq!(seqs(7), [a, c]);
        assert!(seqs(3).is_empty());
        assert!(seqs(100).is_empty());
        let all: Vec<_> = s.all().iter().map(|i| (i.tick.0, i.seq.0)).collect();
        assert_eq!(all, [(2, 1), (2, 3), (7, 0), (7, 2)]);
    }

    #[test]
    fn reject_reason_labels_are_distinct_and_match_the_report() {
        let labels: std::collections::BTreeSet<&str> =
            RejectReason::ALL.iter().map(|r| r.label()).collect();
        assert_eq!(labels.len(), RejectReason::ALL.len());
        let expected = [
            "unknown_person",
            "dead_person",
            "self_target",
            "intensity_out_of_range",
            "id_exhausted",
            "official_person",
            "no_ghost",
            "not_waiting",
            "not_connected",
            "rate_limited",
            "insufficient_joss",
            "yearly_cap",
            "bad_amount",
            "node_pending",
            "slot_closed",
            "slot_claimed",
            "claim_held",
            "register_wait",
            "unknown_node",
            "option_not_in_set",
            "already_chosen",
        ];
        let actual: Vec<&str> = RejectReason::ALL.iter().map(|r| r.label()).collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn canonical_reject_reason_tags_are_distinct_and_run_from_zero() {
        use crate::canon::encode_to_vec;
        let tags: Vec<u8> = RejectReason::ALL
            .iter()
            .map(|reason| encode_to_vec(reason)[0])
            .collect();
        let unique: std::collections::BTreeSet<u8> = tags.iter().copied().collect();
        assert_eq!(unique.len(), RejectReason::ALL.len());
        for (index, tag) in tags.iter().enumerate() {
            assert_eq!(usize::from(*tag), index, "tag order follows ALL");
        }
        assert_eq!(encode_to_vec(&RejectReason::UnknownPerson), [0]);
        assert_eq!(encode_to_vec(&RejectReason::IdExhausted), [4]);
        assert_eq!(encode_to_vec(&RejectReason::OfficialPerson), [5]);
        assert_eq!(encode_to_vec(&RejectReason::AlreadyChosen), [20]);
    }
}
