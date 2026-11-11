//! The append-only Event_Log (design "Events", R5).
//!
//! Every Event carries the card actor order for its type, the card magnitude rule and a
//! due tick only for `loan`. The log stores a BLAKE3 hash-chain digest so the canonical
//! encoding is `(length, digest)` and the per-tick checksum costs O(new events), not
//! O(log) (OP-8 A). There is no remove method and no mutable access to stored Events:
//! [`EventLog::push`] is the only mutator (R5.2).

use crate::canon::{Canon, CanonWriter};
use crate::ids::{EventId, IdCounter, IdExhausted, PersonId, Tick};
use crate::values::{Intensity, SocialKind};

/// One tag of the card event tag list, in card order.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum EventTag {
    /// The Event is public knowledge.
    Public,
    /// The Event is private.
    Private,
    /// Someone witnessed the Event.
    Witnessed,
    /// The Event was written down.
    Written,
    /// The Event was spoken.
    Verbal,
    /// A payment was partial.
    Partial,
    /// Money moved.
    Cash,
    /// Joss paper moved.
    JossPaper,
    /// Land moved.
    Land,
    /// A house moved.
    House,
    /// A shop moved.
    Shop,
    /// An heirloom moved.
    Heirloom,
    /// The Event happened at a deathbed.
    Deathbed,
}

impl EventTag {
    /// Every event tag, in card order.
    pub const ALL: [Self; 13] = [
        Self::Public,
        Self::Private,
        Self::Witnessed,
        Self::Written,
        Self::Verbal,
        Self::Partial,
        Self::Cash,
        Self::JossPaper,
        Self::Land,
        Self::House,
        Self::Shop,
        Self::Heirloom,
        Self::Deathbed,
    ];

    /// The card name of the tag.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Private => "private",
            Self::Witnessed => "witnessed",
            Self::Written => "written",
            Self::Verbal => "verbal",
            Self::Partial => "partial",
            Self::Cash => "cash",
            Self::JossPaper => "joss_paper",
            Self::Land => "land",
            Self::House => "house",
            Self::Shop => "shop",
            Self::Heirloom => "heirloom",
            Self::Deathbed => "deathbed",
        }
    }

    /// Looks a tag up by its card name.
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tag| tag.name() == name)
    }

    /// The tag's bit in an [`EventTags`] bitset.
    pub const fn bit(self) -> u16 {
        match self {
            Self::Public => 1,
            Self::Private => 2,
            Self::Witnessed => 4,
            Self::Written => 8,
            Self::Verbal => 16,
            Self::Partial => 32,
            Self::Cash => 64,
            Self::JossPaper => 128,
            Self::Land => 256,
            Self::House => 512,
            Self::Shop => 1024,
            Self::Heirloom => 2048,
            Self::Deathbed => 4096,
        }
    }

    /// Writes the explicit enum tag used by the canonical encoding.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::Public => 0,
            Self::Private => 1,
            Self::Witnessed => 2,
            Self::Written => 3,
            Self::Verbal => 4,
            Self::Partial => 5,
            Self::Cash => 6,
            Self::JossPaper => 7,
            Self::Land => 8,
            Self::House => 9,
            Self::Shop => 10,
            Self::Heirloom => 11,
            Self::Deathbed => 12,
        }
    }
}

/// Bitset over the card event tags; bit order is the card tag order.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub struct EventTags(u16);

impl EventTags {
    /// No tags.
    pub const fn empty() -> Self {
        Self(0)
    }

    /// The raw bitset. Unknown bits are preserved so a later spec can add tags.
    pub const fn from_bits(bits: u16) -> Self {
        Self(bits)
    }

    /// The raw bitset.
    pub const fn bits(self) -> u16 {
        self.0
    }

    /// Whether `tag` is set.
    pub const fn contains(self, tag: EventTag) -> bool {
        self.0 & tag.bit() != 0
    }

    /// Sets `tag`.
    pub fn insert(&mut self, tag: EventTag) {
        self.0 |= tag.bit();
    }

    /// Clears `tag`.
    pub fn remove(&mut self, tag: EventTag) {
        self.0 &= !tag.bit();
    }

    /// The set tags in card order.
    pub fn iter(self) -> impl Iterator<Item = EventTag> {
        EventTag::ALL
            .into_iter()
            .filter(move |tag| self.contains(*tag))
    }

    /// The card names of the set tags, in card order.
    pub fn names(self) -> impl Iterator<Item = &'static str> {
        self.iter().map(EventTag::name)
    }
}

/// One Event_Log entry. Each variant carries exactly its card actors, in card order.
#[derive(Clone, Eq, PartialEq, Debug)]
pub enum EventKind {
    /// A birth.
    Birth {
        /// The newborn.
        person: PersonId,
    },
    /// A death.
    Death {
        /// The deceased.
        person: PersonId,
    },
    /// A marriage.
    Marriage {
        /// The first spouse, then the second.
        a: PersonId,
        /// The second spouse.
        b: PersonId,
    },
    /// A loan.
    Loan {
        /// The lender.
        lender: PersonId,
        /// The borrower.
        borrower: PersonId,
        /// The loaned amount in dollars.
        amount: u64,
        /// The day repayment is due.
        due: Tick,
    },
    /// A repayment.
    Repayment {
        /// The debtor who pays.
        payer: PersonId,
        /// The creditor who receives.
        payee: PersonId,
        /// The repaid amount in dollars.
        amount: u64,
    },
    /// A debt transferred to an heir.
    DebtTransfer {
        /// The previous debtor.
        from: PersonId,
        /// The new debtor.
        to: PersonId,
        /// The open amount in dollars.
        amount: u64,
    },
    /// A debt forgiven.
    DebtForgiven {
        /// The creditor.
        creditor: PersonId,
        /// The debtor.
        debtor: PersonId,
        /// The forgiven amount in dollars.
        amount: u64,
    },
    /// An inheritance.
    Inheritance {
        /// The deceased.
        deceased: PersonId,
        /// The heir.
        heir: PersonId,
        /// Dollars plus property value received.
        amount: u64,
    },
    /// An Imported_Vessel arrived.
    Possession {
        /// The outsider entering town.
        person: PersonId,
    },
    /// A Rebuilt_Body arrived.
    Rebuild {
        /// The outsider entering town.
        person: PersonId,
    },
    /// A social act.
    Social {
        /// The kind of act.
        kind: SocialKind,
        /// The doer.
        doer: PersonId,
        /// The target.
        target: PersonId,
        /// The act's intensity.
        intensity: Intensity,
    },
}

/// The actors of an Event, in card order: one or two Person IDs.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Actors {
    ids: [PersonId; 2],
    len: u8,
}

impl Actors {
    /// An actor list of one.
    const fn one(person: PersonId) -> Self {
        Self {
            ids: [person, PersonId(0)],
            len: 1,
        }
    }

    /// An actor list of two.
    const fn two(first: PersonId, second: PersonId) -> Self {
        Self {
            ids: [first, second],
            len: 2,
        }
    }

    /// Number of actors.
    pub fn len(&self) -> usize {
        usize::from(self.len)
    }

    /// Whether there are no actors. Never true for a produced Event kind.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The actors in card order.
    pub fn as_slice(&self) -> &[PersonId] {
        &self.ids[..usize::from(self.len)]
    }

    /// The actors in card order.
    pub fn iter(&self) -> impl Iterator<Item = PersonId> + '_ {
        self.as_slice().iter().copied()
    }
}

impl EventKind {
    /// The actors in card order (R5.3).
    pub fn actors(&self) -> Actors {
        match self {
            Self::Birth { person }
            | Self::Death { person }
            | Self::Possession { person }
            | Self::Rebuild { person } => Actors::one(*person),
            Self::Marriage { a, b } => Actors::two(*a, *b),
            Self::Loan {
                lender, borrower, ..
            } => Actors::two(*lender, *borrower),
            Self::Repayment { payer, payee, .. } => Actors::two(*payer, *payee),
            Self::DebtTransfer { from, to, .. } => Actors::two(*from, *to),
            Self::DebtForgiven {
                creditor, debtor, ..
            } => Actors::two(*creditor, *debtor),
            Self::Inheritance { deceased, heir, .. } => Actors::two(*deceased, *heir),
            Self::Social { doer, target, .. } => Actors::two(*doer, *target),
        }
    }

    /// The card event type name (R5.3).
    pub fn card_type(&self) -> &'static str {
        match self {
            Self::Birth { .. } => "birth",
            Self::Death { .. } => "death",
            Self::Marriage { .. } => "marriage",
            Self::Loan { .. } => "loan",
            Self::Repayment { .. } => "repayment",
            Self::DebtTransfer { .. } => "debt_transfer",
            Self::DebtForgiven { .. } => "debt_forgiven",
            Self::Inheritance { .. } => "inheritance",
            Self::Possession { .. } => "possession",
            Self::Rebuild { .. } => "rebuild",
            Self::Social { kind, .. } => kind.name(),
        }
    }

    /// The card magnitude: dollars for money events, intensity for social events, 0
    /// otherwise (R5.4).
    pub fn magnitude(&self) -> u64 {
        match self {
            Self::Loan { amount, .. }
            | Self::Repayment { amount, .. }
            | Self::DebtTransfer { amount, .. }
            | Self::DebtForgiven { amount, .. }
            | Self::Inheritance { amount, .. } => *amount,
            Self::Social { intensity, .. } => u64::from(intensity.get()),
            Self::Birth { .. }
            | Self::Death { .. }
            | Self::Marriage { .. }
            | Self::Possession { .. }
            | Self::Rebuild { .. } => 0,
        }
    }

    /// The due tick, present exactly on `loan` (R5.5).
    pub fn due_tick(&self) -> Option<Tick> {
        match self {
            Self::Loan { due, .. } => Some(*due),
            Self::Birth { .. }
            | Self::Death { .. }
            | Self::Marriage { .. }
            | Self::Repayment { .. }
            | Self::DebtTransfer { .. }
            | Self::DebtForgiven { .. }
            | Self::Inheritance { .. }
            | Self::Possession { .. }
            | Self::Rebuild { .. }
            | Self::Social { .. } => None,
        }
    }

    /// Whether a dead Person may appear as an actor (R5.8).
    pub fn is_afterlife(&self) -> bool {
        matches!(
            self,
            Self::Death { .. }
                | Self::DebtTransfer { .. }
                | Self::DebtForgiven { .. }
                | Self::Inheritance { .. }
        )
    }
}

/// Prior Events that caused this one; at most two in this spec.
#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct CausedBy(Vec<EventId>);

impl CausedBy {
    /// Builds a cause list. The design allows at most two entries.
    pub fn new(ids: Vec<EventId>) -> Self {
        debug_assert!(ids.len() <= 2, "at most two causes");
        Self(ids)
    }

    /// The IDs in the order given.
    pub fn as_slice(&self) -> &[EventId] {
        &self.0
    }

    /// The IDs in the order given.
    pub fn iter(&self) -> impl Iterator<Item = EventId> + '_ {
        self.0.iter().copied()
    }

    /// Number of causes.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether there is no cause.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// One Event_Log entry.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Event {
    /// Stable ID; `events[i].id == EventId(i + 1)`.
    pub id: EventId,
    /// The day the Event happened.
    pub tick: Tick,
    /// What happened.
    pub kind: EventKind,
    /// Prior Events that caused it.
    pub caused_by: CausedBy,
    /// Card event tags.
    pub tags: EventTags,
}

/// The append-only Event_Log with its hash-chain digest (OP-8 A).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct EventLog {
    events: Vec<Event>,
    digest: [u8; 32],
    ids: IdCounter,
}

impl EventLog {
    /// An empty log. Event IDs start at 1 (OP-10).
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            digest: [0; 32],
            ids: IdCounter::starting_at(1),
        }
    }

    /// The stored Events, in ascending ID order.
    pub fn events(&self) -> &[Event] {
        &self.events
    }

    /// Number of stored Events.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Whether the log is empty.
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// The stored hash-chain digest.
    pub fn digest(&self) -> [u8; 32] {
        self.digest
    }

    /// The ID the next Event will get.
    pub fn next_id(&self) -> EventId {
        EventId(self.ids.peek())
    }

    /// Looks up an Event by ID. Never indexes out of bounds.
    pub fn event(&self, id: EventId) -> Option<&Event> {
        let index = id.0.checked_sub(1)?;
        let index = usize::try_from(index).ok()?;
        self.events.get(index).filter(|event| event.id == id)
    }

    /// The only mutator: appends one Event and folds it into the digest.
    ///
    /// The Event ID comes from the log's counter. On counter exhaustion nothing changes.
    pub(crate) fn push(
        &mut self,
        tick: Tick,
        kind: EventKind,
        caused_by: CausedBy,
        tags: EventTags,
    ) -> Result<EventId, IdExhausted> {
        let id = EventId(self.ids.next()?);
        let event = Event {
            id,
            tick,
            kind,
            caused_by,
            tags,
        };
        self.digest = fold_digest(&self.digest, &event);
        self.events.push(event);
        Ok(id)
    }

    /// Mutable access to the stored Events, for the test-support mutation API only.
    /// Mutating through it breaks the log's hash-chain guarantee, which is exactly what
    /// the checksum-sensitivity mutation needs to prove.
    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn events_for_test_mut(&mut self) -> &mut Vec<Event> {
        &mut self.events
    }

    /// Recomputes and stores the digest after a test-support mutation of a stored
    /// Event (test-support only).
    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn refresh_digest(&mut self) {
        self.digest = self.recompute_digest();
    }

    /// Removes one stored Event and recomputes the digest (test-support only).
    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn remove_for_test(&mut self, index: usize) -> bool {
        if index >= self.events.len() {
            return false;
        }
        self.events.remove(index);
        self.digest = self.recompute_digest();
        true
    }

    /// Forces the ID counter to its last value, so the next append is refused with
    /// [`IdExhausted`] (tests and test-support only).
    #[cfg(test)]
    pub(crate) fn exhaust_ids(&mut self) {
        self.ids = IdCounter::starting_at(u64::MAX);
    }

    /// Recomputes the digest from scratch: `digest_0 = [0; 32]`,
    /// `digest_{n+1} = blake3(digest_n || encode(event_{n+1}))`.
    pub fn recompute_digest(&self) -> [u8; 32] {
        let mut digest = [0; 32];
        for event in &self.events {
            digest = fold_digest(&digest, event);
        }
        digest
    }
}

impl Default for EventLog {
    fn default() -> Self {
        Self::new()
    }
}

/// A [`CanonWriter`] that feeds bytes straight into a BLAKE3 hasher.
struct DigestWriter<'a>(&'a mut blake3::Hasher);

impl CanonWriter for DigestWriter<'_> {
    fn bytes(&mut self, b: &[u8]) {
        self.0.update(b);
    }
}

/// One digest fold step: `blake3(previous || canonical bytes of event)`.
pub(crate) fn fold_digest(previous: &[u8; 32], event: &Event) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(previous);
    {
        let mut writer = DigestWriter(&mut hasher);
        event.encode(&mut writer);
    }
    *hasher.finalize().as_bytes()
}

/// The Mood delta of an Event kind for the actor at `actor_position` (0-based, card
/// actor order). Deltas apply to living actors; every other position gives 0.
///
/// Table: design "Parameters and calibration", Mood row.
pub fn mood_delta(kind: &EventKind, actor_position: usize) -> i64 {
    match kind {
        EventKind::Marriage { .. } => match actor_position {
            0 | 1 => 20,
            _ => 0,
        },
        EventKind::Loan { .. } => match actor_position {
            0 => -2,
            1 => 5,
            _ => 0,
        },
        EventKind::Repayment { .. } => match actor_position {
            0 => -3,
            1 => 3,
            _ => 0,
        },
        EventKind::DebtTransfer { .. } => match actor_position {
            1 => -15,
            _ => 0,
        },
        EventKind::DebtForgiven { .. } => match actor_position {
            1 => 10,
            _ => 0,
        },
        EventKind::Inheritance { .. } => match actor_position {
            1 => 5,
            _ => 0,
        },
        EventKind::Social { kind, .. } => match kind {
            SocialKind::Help | SocialKind::Gift => match actor_position {
                0 => 2,
                1 => 5,
                _ => 0,
            },
            SocialKind::Quarrel => match actor_position {
                0 | 1 => -8,
                _ => 0,
            },
            SocialKind::Insult => match actor_position {
                0 => 1,
                1 => -10,
                _ => 0,
            },
            SocialKind::Theft => match actor_position {
                0 => 3,
                1 => -15,
                _ => 0,
            },
            SocialKind::Apology => match actor_position {
                0 => -2,
                1 => 4,
                _ => 0,
            },
        },
        EventKind::Birth { .. }
        | EventKind::Death { .. }
        | EventKind::Possession { .. }
        | EventKind::Rebuild { .. } => 0,
    }
}

impl Canon for EventTag {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
    }
}

impl Canon for EventTags {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.0.encode(w);
    }
}

impl Canon for EventKind {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Birth { .. } => 0,
            Self::Death { .. } => 1,
            Self::Marriage { .. } => 2,
            Self::Loan { .. } => 3,
            Self::Repayment { .. } => 4,
            Self::DebtTransfer { .. } => 5,
            Self::DebtForgiven { .. } => 6,
            Self::Inheritance { .. } => 7,
            Self::Possession { .. } => 8,
            Self::Rebuild { .. } => 9,
            Self::Social { .. } => 10,
        };
        tag.encode(w);
        match self {
            Self::Birth { person }
            | Self::Death { person }
            | Self::Possession { person }
            | Self::Rebuild { person } => person.encode(w),
            Self::Marriage { a, b } => {
                a.encode(w);
                b.encode(w);
            }
            Self::Loan {
                lender,
                borrower,
                amount,
                due,
            } => {
                lender.encode(w);
                borrower.encode(w);
                amount.encode(w);
                due.encode(w);
            }
            Self::Repayment {
                payer,
                payee,
                amount,
            } => {
                payer.encode(w);
                payee.encode(w);
                amount.encode(w);
            }
            Self::DebtTransfer { from, to, amount } => {
                from.encode(w);
                to.encode(w);
                amount.encode(w);
            }
            Self::DebtForgiven {
                creditor,
                debtor,
                amount,
            } => {
                creditor.encode(w);
                debtor.encode(w);
                amount.encode(w);
            }
            Self::Inheritance {
                deceased,
                heir,
                amount,
            } => {
                deceased.encode(w);
                heir.encode(w);
                amount.encode(w);
            }
            Self::Social {
                kind,
                doer,
                target,
                intensity,
            } => {
                kind.encode(w);
                doer.encode(w);
                target.encode(w);
                intensity.encode(w);
            }
        }
    }
}

impl Canon for CausedBy {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.0.encode(w);
    }
}

impl Canon for Event {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            tick,
            kind,
            caused_by,
            tags,
        } = self;
        id.encode(w);
        tick.encode(w);
        kind.encode(w);
        caused_by.encode(w);
        tags.encode(w);
    }
}

impl Canon for EventLog {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            events,
            digest,
            ids,
        } = self;
        // The Event counter always equals `events.len() + 1` (IDs are issued in order
        // and never reused), so it needs no separate encoding.
        let _ = ids;
        let len = u32::try_from(events.len()).expect("event log length exceeds u32");
        len.encode(w);
        w.bytes(&digest[..]);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::canon::encode_to_vec;
    use crate::values::Intensity;

    fn person(id: u64) -> PersonId {
        PersonId(id)
    }

    fn intensity(value: u8) -> Intensity {
        Intensity::new(value).expect("test intensity in range")
    }

    fn social(kind: SocialKind) -> EventKind {
        EventKind::Social {
            kind,
            doer: person(1),
            target: person(2),
            intensity: intensity(40),
        }
    }

    fn kinds() -> Vec<EventKind> {
        vec![
            EventKind::Birth { person: person(1) },
            EventKind::Death { person: person(1) },
            EventKind::Marriage {
                a: person(1),
                b: person(2),
            },
            EventKind::Loan {
                lender: person(1),
                borrower: person(2),
                amount: 500,
                due: Tick(90),
            },
            EventKind::Repayment {
                payer: person(2),
                payee: person(1),
                amount: 100,
            },
            EventKind::DebtTransfer {
                from: person(1),
                to: person(3),
                amount: 200,
            },
            EventKind::DebtForgiven {
                creditor: person(1),
                debtor: person(2),
                amount: 300,
            },
            EventKind::Inheritance {
                deceased: person(1),
                heir: person(2),
                amount: 400,
            },
            EventKind::Possession { person: person(2) },
            EventKind::Rebuild { person: person(2) },
            social(SocialKind::Help),
            social(SocialKind::Gift),
            social(SocialKind::Quarrel),
            social(SocialKind::Insult),
            social(SocialKind::Theft),
            social(SocialKind::Apology),
        ]
    }

    fn first_byte<T: Canon>(value: &T) -> u8 {
        encode_to_vec(value)[0]
    }

    fn assert_distinct_tags<T: Canon>(values: &[T]) {
        let tags: BTreeSet<u8> = values.iter().map(first_byte).collect();
        assert_eq!(tags.len(), values.len(), "canonical tags must be distinct");
    }

    fn push_all(log: &mut EventLog) {
        for (tick, kind) in kinds().into_iter().enumerate() {
            let tick = u64::try_from(tick).expect("small tick");
            log.push(Tick(tick), kind, CausedBy::default(), EventTags::empty())
                .expect("event id available");
        }
    }

    #[test]
    fn event_ids_follow_the_log_order_starting_at_one() {
        let mut log = EventLog::new();
        assert!(log.is_empty());
        push_all(&mut log);
        for (index, event) in log.events().iter().enumerate() {
            let expected = u64::try_from(index)
                .expect("small index")
                .checked_add(1)
                .expect("small index");
            assert_eq!(event.id, EventId(expected));
            assert_eq!(log.event(event.id), Some(event));
        }
        assert_eq!(log.next_id(), EventId(17));
        assert_eq!(log.event(EventId(0)), None);
        assert_eq!(log.event(EventId(99)), None);
    }

    #[test]
    fn stored_digest_equals_recompute_digest_after_many_pushes() {
        let mut log = EventLog::new();
        assert_eq!(log.digest(), log.recompute_digest());
        push_all(&mut log);
        assert_eq!(log.digest(), log.recompute_digest());
        assert_ne!(log.digest(), [0; 32]);

        let before = log.digest();
        log.push(
            Tick(99),
            EventKind::Death { person: person(1) },
            CausedBy::default(),
            EventTags::empty(),
        )
        .expect("event id available");
        assert_ne!(log.digest(), before);
        assert_eq!(log.digest(), log.recompute_digest());
    }

    #[test]
    fn digest_fold_matches_an_explicit_chain() {
        let mut log = EventLog::new();
        push_all(&mut log);

        let mut expected = [0u8; 32];
        for event in log.events() {
            let mut hasher = blake3::Hasher::new();
            hasher.update(&expected);
            hasher.update(&encode_to_vec(event));
            expected = *hasher.finalize().as_bytes();
        }
        assert_eq!(log.digest(), expected);
    }

    #[test]
    fn canonical_log_is_length_then_digest() {
        let mut log = EventLog::new();
        push_all(&mut log);
        let encoded = encode_to_vec(&log);
        let len = u32::try_from(log.len()).expect("small log");
        assert_eq!(&encoded[..4], &len.to_le_bytes());
        assert_eq!(&encoded[4..], &log.digest()[..]);
        assert_eq!(encoded.len(), 4 + 32);
    }

    #[test]
    fn card_type_names_match_the_card_event_type_list() {
        let expected = [
            ("birth", EventKind::Birth { person: person(1) }),
            ("death", EventKind::Death { person: person(1) }),
            (
                "marriage",
                EventKind::Marriage {
                    a: person(1),
                    b: person(2),
                },
            ),
            (
                "loan",
                EventKind::Loan {
                    lender: person(1),
                    borrower: person(2),
                    amount: 1,
                    due: Tick(1),
                },
            ),
            (
                "repayment",
                EventKind::Repayment {
                    payer: person(1),
                    payee: person(2),
                    amount: 1,
                },
            ),
            (
                "debt_transfer",
                EventKind::DebtTransfer {
                    from: person(1),
                    to: person(2),
                    amount: 1,
                },
            ),
            (
                "debt_forgiven",
                EventKind::DebtForgiven {
                    creditor: person(1),
                    debtor: person(2),
                    amount: 1,
                },
            ),
            (
                "inheritance",
                EventKind::Inheritance {
                    deceased: person(1),
                    heir: person(2),
                    amount: 1,
                },
            ),
            ("possession", EventKind::Possession { person: person(1) }),
            ("rebuild", EventKind::Rebuild { person: person(1) }),
            ("help", social(SocialKind::Help)),
            ("gift", social(SocialKind::Gift)),
            ("quarrel", social(SocialKind::Quarrel)),
            ("insult", social(SocialKind::Insult)),
            ("theft", social(SocialKind::Theft)),
            ("apology", social(SocialKind::Apology)),
        ];
        for (name, kind) in expected {
            assert_eq!(kind.card_type(), name);
        }
    }

    #[test]
    fn actor_counts_and_order_match_the_card_table() {
        let cases: [(&str, EventKind, &[u64]); 16] = [
            ("birth", EventKind::Birth { person: person(1) }, &[1]),
            ("death", EventKind::Death { person: person(1) }, &[1]),
            (
                "marriage",
                EventKind::Marriage {
                    a: person(3),
                    b: person(4),
                },
                &[3, 4],
            ),
            (
                "loan",
                EventKind::Loan {
                    lender: person(5),
                    borrower: person(6),
                    amount: 1,
                    due: Tick(1),
                },
                &[5, 6],
            ),
            (
                "repayment",
                EventKind::Repayment {
                    payer: person(7),
                    payee: person(8),
                    amount: 1,
                },
                &[7, 8],
            ),
            (
                "debt_transfer",
                EventKind::DebtTransfer {
                    from: person(9),
                    to: person(10),
                    amount: 1,
                },
                &[9, 10],
            ),
            (
                "debt_forgiven",
                EventKind::DebtForgiven {
                    creditor: person(11),
                    debtor: person(12),
                    amount: 1,
                },
                &[11, 12],
            ),
            (
                "inheritance",
                EventKind::Inheritance {
                    deceased: person(13),
                    heir: person(14),
                    amount: 1,
                },
                &[13, 14],
            ),
            (
                "possession",
                EventKind::Possession { person: person(15) },
                &[15],
            ),
            ("rebuild", EventKind::Rebuild { person: person(16) }, &[16]),
            ("help", social(SocialKind::Help), &[1, 2]),
            ("gift", social(SocialKind::Gift), &[1, 2]),
            ("quarrel", social(SocialKind::Quarrel), &[1, 2]),
            ("insult", social(SocialKind::Insult), &[1, 2]),
            ("theft", social(SocialKind::Theft), &[1, 2]),
            ("apology", social(SocialKind::Apology), &[1, 2]),
        ];
        for (name, kind, expected) in cases {
            let actual: Vec<u64> = kind.actors().iter().map(|id| id.0).collect();
            assert_eq!(actual, expected, "actors of {name}");
            assert_eq!(kind.actors().len(), expected.len(), "actor count of {name}");
        }
    }

    #[test]
    fn magnitude_rules_follow_r5_4() {
        assert_eq!(
            EventKind::Loan {
                lender: person(1),
                borrower: person(2),
                amount: 500,
                due: Tick(1),
            }
            .magnitude(),
            500
        );
        assert_eq!(
            EventKind::Repayment {
                payer: person(1),
                payee: person(2),
                amount: 300,
            }
            .magnitude(),
            300
        );
        assert_eq!(
            EventKind::DebtTransfer {
                from: person(1),
                to: person(2),
                amount: 200,
            }
            .magnitude(),
            200
        );
        assert_eq!(
            EventKind::DebtForgiven {
                creditor: person(1),
                debtor: person(2),
                amount: 100,
            }
            .magnitude(),
            100
        );
        assert_eq!(
            EventKind::Inheritance {
                deceased: person(1),
                heir: person(2),
                amount: 75,
            }
            .magnitude(),
            75
        );
        for kind in [
            SocialKind::Help,
            SocialKind::Gift,
            SocialKind::Quarrel,
            SocialKind::Insult,
            SocialKind::Theft,
            SocialKind::Apology,
        ] {
            assert_eq!(social(kind).magnitude(), 40);
        }
        assert_eq!(EventKind::Birth { person: person(1) }.magnitude(), 0);
        assert_eq!(EventKind::Death { person: person(1) }.magnitude(), 0);
        assert_eq!(
            EventKind::Marriage {
                a: person(1),
                b: person(2),
            }
            .magnitude(),
            0
        );
        assert_eq!(EventKind::Possession { person: person(1) }.magnitude(), 0);
        assert_eq!(EventKind::Rebuild { person: person(1) }.magnitude(), 0);
    }

    #[test]
    fn due_tick_is_present_only_on_loan() {
        for kind in kinds() {
            let due = kind.due_tick();
            if matches!(kind, EventKind::Loan { .. }) {
                assert_eq!(due, Some(Tick(90)));
            } else {
                assert_eq!(due, None, "{} must not carry due_tick", kind.card_type());
            }
        }
    }

    #[test]
    fn afterlife_kinds_match_the_card_list() {
        for kind in kinds() {
            let expected = matches!(
                kind,
                EventKind::Death { .. }
                    | EventKind::DebtTransfer { .. }
                    | EventKind::DebtForgiven { .. }
                    | EventKind::Inheritance { .. }
            );
            assert_eq!(kind.is_afterlife(), expected, "{}", kind.card_type());
        }
    }

    #[test]
    fn mood_delta_matches_the_table() {
        assert_eq!(
            mood_delta(
                &EventKind::Marriage {
                    a: person(1),
                    b: person(2)
                },
                0
            ),
            20
        );
        assert_eq!(
            mood_delta(
                &EventKind::Marriage {
                    a: person(1),
                    b: person(2)
                },
                1
            ),
            20
        );
        let loan = EventKind::Loan {
            lender: person(1),
            borrower: person(2),
            amount: 1,
            due: Tick(1),
        };
        assert_eq!(mood_delta(&loan, 0), -2);
        assert_eq!(mood_delta(&loan, 1), 5);
        let repayment = EventKind::Repayment {
            payer: person(1),
            payee: person(2),
            amount: 1,
        };
        assert_eq!(mood_delta(&repayment, 0), -3);
        assert_eq!(mood_delta(&repayment, 1), 3);
        let transfer = EventKind::DebtTransfer {
            from: person(1),
            to: person(2),
            amount: 1,
        };
        assert_eq!(mood_delta(&transfer, 0), 0);
        assert_eq!(mood_delta(&transfer, 1), -15);
        let forgiven = EventKind::DebtForgiven {
            creditor: person(1),
            debtor: person(2),
            amount: 1,
        };
        assert_eq!(mood_delta(&forgiven, 0), 0);
        assert_eq!(mood_delta(&forgiven, 1), 10);
        let inheritance = EventKind::Inheritance {
            deceased: person(1),
            heir: person(2),
            amount: 1,
        };
        assert_eq!(mood_delta(&inheritance, 0), 0);
        assert_eq!(mood_delta(&inheritance, 1), 5);
        for kind in [SocialKind::Help, SocialKind::Gift] {
            let event = social(kind);
            assert_eq!(mood_delta(&event, 0), 2);
            assert_eq!(mood_delta(&event, 1), 5);
        }
        let quarrel = social(SocialKind::Quarrel);
        assert_eq!(mood_delta(&quarrel, 0), -8);
        assert_eq!(mood_delta(&quarrel, 1), -8);
        let insult = social(SocialKind::Insult);
        assert_eq!(mood_delta(&insult, 0), 1);
        assert_eq!(mood_delta(&insult, 1), -10);
        let theft = social(SocialKind::Theft);
        assert_eq!(mood_delta(&theft, 0), 3);
        assert_eq!(mood_delta(&theft, 1), -15);
        let apology = social(SocialKind::Apology);
        assert_eq!(mood_delta(&apology, 0), -2);
        assert_eq!(mood_delta(&apology, 1), 4);
        for kind in [
            EventKind::Birth { person: person(1) },
            EventKind::Death { person: person(1) },
            EventKind::Possession { person: person(1) },
            EventKind::Rebuild { person: person(1) },
        ] {
            assert_eq!(mood_delta(&kind, 0), 0);
            assert_eq!(mood_delta(&kind, 1), 0);
        }
        assert_eq!(mood_delta(&loan, 2), 0);
    }

    #[test]
    fn event_tag_names_round_trip_in_card_order() {
        let expected = [
            "public",
            "private",
            "witnessed",
            "written",
            "verbal",
            "partial",
            "cash",
            "joss_paper",
            "land",
            "house",
            "shop",
            "heirloom",
            "deathbed",
        ];
        let names: Vec<&str> = EventTag::ALL.iter().map(|tag| tag.name()).collect();
        assert_eq!(names, expected);
        for tag in EventTag::ALL {
            assert_eq!(EventTag::from_name(tag.name()), Some(tag));
        }
        assert_eq!(EventTag::from_name("publicity"), None);
    }

    #[test]
    fn event_tags_set_and_clear_their_own_bit() {
        let bits: BTreeSet<u16> = EventTag::ALL.iter().map(|tag| tag.bit()).collect();
        assert_eq!(bits.len(), EventTag::ALL.len());

        let mut tags = EventTags::empty();
        tags.insert(EventTag::Public);
        tags.insert(EventTag::Cash);
        assert!(tags.contains(EventTag::Public));
        assert!(tags.contains(EventTag::Cash));
        assert!(!tags.contains(EventTag::Private));
        assert_eq!(tags.names().collect::<Vec<_>>(), vec!["public", "cash"]);
        tags.remove(EventTag::Public);
        assert!(!tags.contains(EventTag::Public));
        assert_eq!(tags.bits(), EventTag::Cash.bit());
        assert_eq!(EventTags::from_bits(tags.bits()), tags);
    }

    #[test]
    fn canonical_enum_tags_are_distinct() {
        assert_distinct_tags(&EventTag::ALL);
    }

    #[test]
    fn canonical_kind_tags_are_distinct_and_stable() {
        let kinds = kinds();
        let tags: Vec<u8> = kinds.iter().map(first_byte).collect();
        let unique: BTreeSet<u8> = tags.iter().copied().collect();
        assert_eq!(unique.len(), 11, "one tag per EventKind variant");
        assert_eq!(tags[0], 0, "birth");
        assert_eq!(tags[1], 1, "death");
        assert_eq!(tags[10], 10, "social");
    }
}
