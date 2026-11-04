//! Identifier and time newtypes, and the monotonic ID counter.
//!
//! None of these types derive `std::hash::Hash`: nothing in sim-core needs it, and
//! hashing-based containers are banned for simulation state (tech.md rule 4).

use std::fmt;

/// The simulation clock. Time inside the simulation is only this counter.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub struct Tick(pub u64);

/// Stable identifier of an entity, issued by an [`IdCounter`].
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub struct EntityId(pub u64);

/// Sequence number given to an input when the input stream accepts it.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub struct InputSeq(pub u64);

/// An [`IdCounter`] ran out of values (`u64::MAX` was already issued).
///
/// This is its own small error type for now. The shared `SimError` enum arrives with
/// later tasks and will gain a variant wrapping this type (or an equivalent one), so
/// callers should not depend on this being the final error shape.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct IdExhausted;

impl fmt::Display for IdExhausted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("id counter exhausted")
    }
}

impl std::error::Error for IdExhausted {}

/// Monotonic counter: `next()` returns the current value, then increments.
///
/// It never decrements and never reuses a value. Incrementing uses `checked_add`;
/// when the next value would not fit in a `u64`, `next()` returns [`IdExhausted`]
/// and leaves the counter unchanged. Because the maximum value `u64::MAX` is never
/// issued (the increment after it would overflow), exhaustion happens one step early
/// rather than ever wrapping.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct IdCounter {
    next: u64,
}

impl IdCounter {
    /// A counter whose first issued value is 0.
    pub const fn new() -> Self {
        Self { next: 0 }
    }

    /// A counter whose first issued value is `next`. Used when restoring state and in
    /// tests that need a near-exhausted counter.
    pub const fn starting_at(next: u64) -> Self {
        Self { next }
    }

    /// The value the next call to [`IdCounter::next`] would return.
    pub const fn peek(&self) -> u64 {
        self.next
    }

    /// Returns the current value and advances the counter.
    #[allow(clippy::should_implement_trait)] // fallible, not an `Iterator`
    pub fn next(&mut self) -> Result<u64, IdExhausted> {
        let issued = self.next;
        self.next = issued.checked_add(1).ok_or(IdExhausted)?;
        Ok(issued)
    }
}

impl Default for IdCounter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issues_sequential_values_from_zero() {
        let mut c = IdCounter::new();
        for expected in 0..5u64 {
            assert_eq!(c.peek(), expected);
            assert_eq!(c.next(), Ok(expected));
        }
        assert_eq!(c.peek(), 5);
    }

    #[test]
    fn exhaustion_is_an_error_and_leaves_counter_unchanged() {
        let mut c = IdCounter::starting_at(u64::MAX.wrapping_sub(1));
        assert_eq!(c.next(), Ok(u64::MAX.wrapping_sub(1)));
        assert_eq!(c.peek(), u64::MAX);
        let before = c.clone();
        assert_eq!(c.next(), Err(IdExhausted));
        assert_eq!(c, before);
        // Stays exhausted; never skips, wraps or reissues.
        assert_eq!(c.next(), Err(IdExhausted));
        assert_eq!(c, before);
    }

    #[test]
    fn newtypes_order_by_inner_value() {
        assert!(Tick(1) < Tick(2));
        assert!(EntityId(7) > EntityId(3));
        assert!(InputSeq(0) <= InputSeq(0));
    }
}
