//! The recorded input stream (design decision D6: submission order).
//!
//! Everything external to the simulation enters as a [`TickInput`] tagged with the tick
//! it applies on. Inputs for the same tick apply in `seq` order, and `seq` is assigned
//! in submission order when the stream accepts the input.
//!
//! Submission only checks the past-tick rule. Whether an input makes sense for the
//! current world (target entity exists, value in range) is decided at apply time inside
//! the tick loop (R4.4).

use std::fmt;

use crate::ids::{EntityId, IdCounter, InputSeq, Tick};

/// Placeholder payloads; real game inputs arrive with later specs.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum InputPayload {
    /// Set an entity's value. Valid when the entity exists and `value` is `0..=1000`.
    SetValue { entity: EntityId, value: i32 },
    /// Create an entity with this value. Valid when `value` is `0..=1000`.
    Spawn { value: i32 },
    /// Remove an entity and every affinity entry pointing at it.
    Despawn { entity: EntityId },
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

#[cfg(test)]
mod tests {
    use super::*;

    const SPAWN: InputPayload = InputPayload::Spawn { value: 1 };

    #[test]
    fn past_tick_is_rejected_and_stream_is_unchanged() {
        let mut s = InputStream::new();
        s.submit(Tick(0), Tick(5), SPAWN).unwrap();
        s.submit(Tick(0), Tick(2), SPAWN).unwrap();
        let before = s.clone();
        assert_eq!(
            s.submit(Tick(4), Tick(3), SPAWN),
            Err(SubmitError::PastTick {
                tick: Tick(3),
                current: Tick(4)
            })
        );
        assert_eq!(s, before);
        // The seq counter was not consumed by the rejection.
        assert_eq!(s.submit(Tick(4), Tick(4), SPAWN), Ok(InputSeq(2)));
    }

    #[test]
    fn current_tick_is_accepted() {
        let mut s = InputStream::new();
        assert_eq!(s.submit(Tick(3), Tick(3), SPAWN), Ok(InputSeq(0)));
    }

    #[test]
    fn for_tick_returns_seq_order_even_when_submitted_out_of_tick_order() {
        let mut s = InputStream::new();
        let a = s.submit(Tick(0), Tick(7), SPAWN).unwrap();
        let b = s.submit(Tick(0), Tick(2), SPAWN).unwrap();
        let c = s.submit(Tick(0), Tick(7), SPAWN).unwrap();
        let d = s.submit(Tick(0), Tick(2), SPAWN).unwrap();
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
}
