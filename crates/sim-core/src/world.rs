//! World state of the life-sim (design "Data Models", R2 to R5, R9, R14).
//!
//! Every field except [`World::derived`] is part of the canonical encoding and therefore
//! of the per-tick checksum. Dead Persons keep no household, mood or money: their
//! [`Life`] is [`Life::Dead`], so R3.2 and "estates are settled" hold by construction.
//! Souls live in [`Souls`], one [`SoulPlace`] each, so one soul cannot be in two places.
//!
//! `World::append` is the only way an Event enters the log. It checks R5.3 to R5.9,
//! applies the Mood deltas of R14.2 and keeps the derived indexes current.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::canon::{CANON_VERSION, Canon, CanonWriter};
use crate::economy::FlowTotals;
use crate::events::{CausedBy, EventKind, EventLog, EventTags, mood_delta};
use crate::ids::{EventId, HouseholdId, IdCounter, InputSeq, PersonId, PropertyId, SoulId, Tick};
use crate::names::FullName;
use crate::params::Params;
use crate::values::{Mood, Origin, RelTags, Score, Sex, SocialKind, Traits};

pub use crate::input::RejectReason;

/// Smallest legal `WorldConfig::opening_residents` (R12.1).
pub const OPENING_RESIDENTS_MIN: u16 = 40;
/// Largest legal `WorldConfig::opening_residents` (R12.1).
pub const OPENING_RESIDENTS_MAX: u16 = 60;
/// Default `opening_residents`.
pub const DEFAULT_OPENING_RESIDENTS: u16 = 50;

/// Value of a `land` property item, in dollars (design "Money_Flow list").
pub const PROPERTY_LAND_VALUE: u64 = 25_000;
/// Value of a `house` property item, in dollars.
pub const PROPERTY_HOUSE_VALUE: u64 = 60_000;
/// Value of a `shop` property item, in dollars.
pub const PROPERTY_SHOP_VALUE: u64 = 40_000;
/// Value of an `heirloom` property item, in dollars.
pub const PROPERTY_HEIRLOOM_VALUE: u64 = 1_500;

/// Why a [`WorldConfig`] is not valid.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ConfigError {
    /// `opening_residents` is outside 40..=60.
    OpeningResidentsOutOfRange { opening_residents: u16 },
    /// Opening_World generation found no candidate for a forced choice. Unreachable
    /// for a valid config; the message names the choice.
    Generation(&'static str),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OpeningResidentsOutOfRange { opening_residents } => write!(
                f,
                "opening_residents {opening_residents} is out of range \
                 {OPENING_RESIDENTS_MIN}..={OPENING_RESIDENTS_MAX}"
            ),
            Self::Generation(what) => write!(f, "opening-world generation failed: {what}"),
        }
    }
}

impl std::error::Error for ConfigError {}

/// World configuration: the only knob a replay or the WASM constructor carries.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct WorldConfig {
    /// Residents at World creation, 40..=60 (R12.1).
    pub opening_residents: u16,
}

impl WorldConfig {
    /// Builds and validates a config.
    pub fn try_new(opening_residents: u16) -> Result<Self, ConfigError> {
        let config = Self { opening_residents };
        config.validate()?;
        Ok(config)
    }

    /// Checks the documented range (R12.1).
    pub fn validate(&self) -> Result<(), ConfigError> {
        if !(OPENING_RESIDENTS_MIN..=OPENING_RESIDENTS_MAX).contains(&self.opening_residents) {
            return Err(ConfigError::OpeningResidentsOutOfRange {
                opening_residents: self.opening_residents,
            });
        }
        Ok(())
    }
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            opening_residents: DEFAULT_OPENING_RESIDENTS,
        }
    }
}

/// A Person: one body that has existed in the World, living or dead (R2).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Person {
    /// Stable identifier.
    pub id: PersonId,
    /// Full name from the Name_List; never changes.
    pub name: FullName,
    /// Birth tick; negative for Opening_World residents (ages are exact, R2.3).
    pub birth_day: i64,
    /// Female or male.
    pub sex: Sex,
    /// Where the body came from.
    pub origin: Origin,
    /// The seven card traits.
    pub traits: Traits,
    /// Set at creation and never changed (R9.5).
    pub soul: SoulId,
    /// Dollars per day while aged 18..=67.
    pub wage: u16,
    /// Alive (household, mood, money) or dead (death tick) — one value, so they cannot
    /// get out of sync (R2.1, R2.4).
    pub life: Life,
}

/// Alive flag and death tick in one value (R2.1).
#[derive(Clone, Eq, PartialEq, Debug)]
pub enum Life {
    /// A Resident: in exactly one Household, with a Mood and a money balance.
    Alive {
        /// The Household the Resident lives in (R3.1).
        household: HouseholdId,
        /// Long-term mood, in -100..=100 (R14.1).
        mood: Mood,
        /// Money balance in dollars (OP-1 A).
        money: u64,
    },
    /// A dead Person: no household, mood or money (R2.4).
    Dead {
        /// The tick of death.
        death: Tick,
    },
}

/// A group of Residents living together. Exists exactly while it has a member; its
/// members are the Residents whose `Life::Alive.household` names it (R3.1). It holds no
/// money (OP-1 A).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Household {
    /// Stable identifier.
    pub id: HouseholdId,
    /// The tick the Household was founded.
    pub founded: Tick,
}

/// The kind of a property item (R3.3).
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum PropertyKind {
    /// Land.
    Land,
    /// A house.
    House,
    /// A shop.
    Shop,
    /// An heirloom.
    Heirloom,
}

impl PropertyKind {
    /// The card name of the kind.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Land => "land",
            Self::House => "house",
            Self::Shop => "shop",
            Self::Heirloom => "heirloom",
        }
    }

    /// The dollar value used for card `wealth` and inheritance `magnitude`.
    pub const fn value(self) -> u64 {
        match self {
            Self::Land => PROPERTY_LAND_VALUE,
            Self::House => PROPERTY_HOUSE_VALUE,
            Self::Shop => PROPERTY_SHOP_VALUE,
            Self::Heirloom => PROPERTY_HEIRLOOM_VALUE,
        }
    }
}

/// One property item with exactly one owner, always a Resident (R3.3).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Property {
    /// Stable identifier.
    pub id: PropertyId,
    /// What kind of property it is.
    pub kind: PropertyKind,
    /// The Resident who owns it.
    pub owner: PersonId,
}

/// A directed Relation from one Person to another (R4.1).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Relation {
    /// Feeling toward `to`, in -100..=100.
    pub affinity: Score,
    /// Trust in `to`, in -100..=100.
    pub trust: Score,
    /// Card relation tags; each says what `to` is to `from`.
    pub tags: RelTags,
}

/// An open obligation from a debtor to a creditor (R8).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Debt {
    /// Who is owed.
    pub creditor: PersonId,
    /// Who owes; changes only by `debt_transfer` (R7.2).
    pub debtor: PersonId,
    /// The `loan` Event's magnitude, at least 1.
    pub principal: u64,
    /// The remaining amount, 1..=principal while the Debt exists (R8.3).
    pub open: u64,
    /// The day repayment is due (R8.5).
    pub due: Tick,
}

/// Where a Soul is: in exactly one body or in the Waiting_Queue (R9.1).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SoulPlace {
    /// The Soul is in this Resident's body.
    Body(PersonId),
    /// The Soul is waiting, since this tick.
    Waiting {
        /// The tick its wait began.
        since: Tick,
    },
}

/// Every Soul of the World, with its place (R9).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Souls {
    /// One entry per Soul: a Soul cannot be in two places.
    pub places: BTreeMap<SoulId, SoulPlace>,
    /// The Player_Soul, fixed at creation (R9.6).
    pub player: SoulId,
    /// Advanced only by Opening_World generation (R9.4).
    pub ids: IdCounter,
}

/// Record of skipped inputs; part of the checksummed state (R1.5).
#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct Rejections {
    /// Number of rejections per reason.
    pub count_by_reason: BTreeMap<RejectReason, u64>,
    /// The most recent rejection as `(tick, input seq, reason)`. One `Option` of a tuple,
    /// so the three parts cannot get out of sync.
    pub last: Option<(Tick, InputSeq, RejectReason)>,
}

impl Rejections {
    /// Records one rejected input.
    pub(crate) fn record(&mut self, tick: Tick, seq: InputSeq, reason: RejectReason) {
        let n = self.count_by_reason.entry(reason).or_insert(0);
        *n = n.saturating_add(1);
        self.last = Some((tick, seq, reason));
    }
}

/// Caches computed from the World. Never encoded and never checksummed (R16.5).
#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct Derived {
    /// The latest grievance Event (`quarrel`, `insult` or `theft`) per unordered pair,
    /// keyed `(low, high)`.
    pub last_grievance: BTreeMap<(PersonId, PersonId), EventId>,
    /// The names of every Resident (R13.3).
    pub living_names: BTreeSet<FullName>,
}

/// Why [`World::append`] refused an Event (design "Event append").
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum AppendRefused {
    /// An actor is not a Person in the World (R5.7).
    UnknownActor,
    /// A non-afterlife Event names a dead actor (R5.8, R6.4).
    DeadActor,
    /// A `caused_by` entry is not an earlier Event (R5.6).
    BadCause,
    /// The Event ID counter has run out.
    IdExhausted,
}

impl fmt::Display for AppendRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownActor => f.write_str("event actor is not a Person"),
            Self::DeadActor => f.write_str("event lists a dead actor"),
            Self::BadCause => f.write_str("caused_by entry is not an earlier event"),
            Self::IdExhausted => f.write_str("event id counter exhausted"),
        }
    }
}

impl std::error::Error for AppendRefused {}

/// The full simulation state at one tick. Advanced only by
/// [`World::step`](crate::tick::World::step).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct World {
    pub(crate) seed: u64,
    pub(crate) config: WorldConfig,
    pub(crate) params: Params,
    pub(crate) tick: Tick,
    pub(crate) person_ids: IdCounter,
    pub(crate) household_ids: IdCounter,
    pub(crate) property_ids: IdCounter,
    pub(crate) persons: BTreeMap<PersonId, Person>,
    pub(crate) households: BTreeMap<HouseholdId, Household>,
    pub(crate) properties: BTreeMap<PropertyId, Property>,
    pub(crate) relations: BTreeMap<(PersonId, PersonId), Relation>,
    pub(crate) debts: BTreeMap<EventId, Debt>,
    pub(crate) souls: Souls,
    pub(crate) log: EventLog,
    pub(crate) flows: FlowTotals,
    pub(crate) rejections: Rejections,
    pub(crate) derived: Derived,
}

impl World {
    /// Creates the Opening_World from `seed` and `config` with [`Params::DEFAULT`].
    pub fn new(seed: u64, config: WorldConfig) -> Result<Self, ConfigError> {
        config.validate()?;
        crate::opening::generate(seed, config, Params::DEFAULT)
    }

    /// Creates the Opening_World with explicit Params (tests and property tests only).
    #[cfg(any(test, feature = "test-support"))]
    pub fn new_with_params(
        seed: u64,
        config: WorldConfig,
        params: Params,
    ) -> Result<Self, ConfigError> {
        config.validate()?;
        crate::opening::generate(seed, config, params)
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn config(&self) -> &WorldConfig {
        &self.config
    }

    pub fn params(&self) -> &Params {
        &self.params
    }

    /// The current tick: the one the next [`step`](Self::step) will run.
    pub fn tick(&self) -> Tick {
        self.tick
    }

    /// Persons in ascending ID order, living and dead.
    pub fn persons(&self) -> &BTreeMap<PersonId, Person> {
        &self.persons
    }

    /// Households in ascending ID order.
    pub fn households(&self) -> &BTreeMap<HouseholdId, Household> {
        &self.households
    }

    /// Relations in `(from, to)` order.
    pub fn relations(&self) -> &BTreeMap<(PersonId, PersonId), Relation> {
        &self.relations
    }

    /// Open Debts in loan Event ID order.
    pub fn debts(&self) -> &BTreeMap<EventId, Debt> {
        &self.debts
    }

    /// Souls and the Player_Soul.
    pub fn souls(&self) -> &Souls {
        &self.souls
    }

    /// The append-only Event_Log.
    pub fn log(&self) -> &EventLog {
        &self.log
    }

    /// Property items in ascending ID order.
    pub fn properties(&self) -> &BTreeMap<PropertyId, Property> {
        &self.properties
    }

    /// Skipped inputs so far.
    pub fn rejections(&self) -> &Rejections {
        &self.rejections
    }

    /// Sources and sinks of the last tick run.
    pub fn last_flows(&self) -> FlowTotals {
        self.flows
    }

    /// Whole years of age, rounded down (R2.3): the current tick for a Resident, the
    /// death tick for a dead Person.
    pub fn age_years(&self, p: &Person) -> u16 {
        let end = match p.life {
            Life::Alive { .. } => self.tick,
            Life::Dead { death } => death,
        };
        age_from_birth_day(end, p.birth_day)
    }

    /// Card `wealth` (OP-1 A): the balance plus the value of every property item the
    /// Person owns; 0 for a dead Person.
    pub fn wealth(&self, id: PersonId) -> u64 {
        let Some(person) = self.persons.get(&id) else {
            return 0;
        };
        let Life::Alive { money, .. } = person.life else {
            return 0;
        };
        let mut total = money;
        for property in self.properties.values() {
            if property.owner == id {
                total = total.saturating_add(property.kind.value());
            }
        }
        total
    }

    /// The Residents of `household`, in ascending Person ID order (R3.1).
    pub fn household_members(&self, household: HouseholdId) -> Vec<PersonId> {
        self.persons
            .values()
            .filter(|p| match p.life {
                Life::Alive { household: h, .. } => h == household,
                Life::Dead { .. } => false,
            })
            .map(|p| p.id)
            .collect()
    }

    /// Rebuilds every index in [`Derived`] from the World (R16.5).
    pub fn rebuild_derived(&mut self) {
        let mut living_names = BTreeSet::new();
        for person in self.persons.values() {
            if matches!(person.life, Life::Alive { .. }) {
                living_names.insert(person.name);
            }
        }
        let mut last_grievance = BTreeMap::new();
        for event in self.log.events() {
            if let EventKind::Social {
                kind, doer, target, ..
            } = &event.kind
                && matches!(
                    kind,
                    SocialKind::Quarrel | SocialKind::Insult | SocialKind::Theft
                )
            {
                last_grievance.insert(unordered_pair(*doer, *target), event.id);
            }
        }
        self.derived = Derived {
            last_grievance,
            living_names,
        };
    }

    /// Empties [`Derived`] without rebuilding it (test-support only, property 16).
    #[cfg(any(test, feature = "test-support"))]
    pub fn discard_derived(&mut self) {
        self.derived = Derived::default();
    }

    /// The only way an Event enters the log (design "Event append").
    ///
    /// Checks, in order: every actor exists (R5.7); no actor is dead unless the kind is
    /// an Afterlife_Event_Type (R5.8, R6.4); every `caused_by` entry is an earlier
    /// Event with a tick no later than `T` (R5.6); the Event counter has a value left.
    /// On refusal nothing changes. On success the Mood deltas (R14.2) are applied to
    /// living actors and the derived indexes are kept current.
    pub(crate) fn append(
        &mut self,
        kind: EventKind,
        caused_by: CausedBy,
        tags: EventTags,
    ) -> Result<EventId, AppendRefused> {
        let actors: Vec<PersonId> = kind.actors().iter().collect();
        for &actor in &actors {
            if !self.persons.contains_key(&actor) {
                return Err(AppendRefused::UnknownActor);
            }
        }
        if !kind.is_afterlife() {
            for &actor in &actors {
                if let Some(person) = self.persons.get(&actor)
                    && matches!(person.life, Life::Dead { .. })
                {
                    return Err(AppendRefused::DeadActor);
                }
            }
        }
        let next = self.log.next_id();
        for cause in caused_by.iter() {
            if cause.0 >= next.0 {
                return Err(AppendRefused::BadCause);
            }
            match self.log.event(cause) {
                Some(event) if event.tick <= self.tick => {}
                _ => return Err(AppendRefused::BadCause),
            }
        }

        let deltas: Vec<(PersonId, i64)> = actors
            .iter()
            .enumerate()
            .map(|(position, &actor)| (actor, mood_delta(&kind, position)))
            .filter(|&(_, delta)| delta != 0)
            .collect();
        let grievance = match &kind {
            EventKind::Social {
                kind: SocialKind::Quarrel | SocialKind::Insult | SocialKind::Theft,
                doer,
                target,
                ..
            } => Some((unordered_pair(*doer, *target), actors.clone())),
            _ => None,
        };

        let id = self
            .log
            .push(self.tick, kind, caused_by, tags)
            .map_err(|_| AppendRefused::IdExhausted)?;

        for (actor, delta) in deltas {
            if let Some(person) = self.persons.get_mut(&actor)
                && let Life::Alive { mood, .. } = &mut person.life
            {
                *mood = mood.add_clamped(delta);
            }
        }
        if let Some((key, _)) = grievance {
            self.derived.last_grievance.insert(key, id);
        }
        // Keep the name index current for every Event that brings a new Resident into
        // the World (births, possession, rebuild). Idempotent for existing Residents.
        for actor in actors {
            if let Some(person) = self.persons.get(&actor)
                && matches!(person.life, Life::Alive { .. })
            {
                self.derived.living_names.insert(person.name);
            }
        }
        Ok(id)
    }
}

/// `(e - birth_day) / 365`, rounded down (R2.3). Negative durations cannot occur for a
/// real Person; they are treated as age 0 instead of wrapping.
pub(crate) fn age_from_birth_day(end: Tick, birth_day: i64) -> u16 {
    let end = i64::try_from(end.0).unwrap_or(i64::MAX);
    let days = end.saturating_sub(birth_day).max(0);
    let years = days.checked_div(365).unwrap_or(0);
    u16::try_from(years).unwrap_or(u16::MAX)
}

/// The unordered pair key used by [`Derived::last_grievance`].
pub(crate) fn unordered_pair(a: PersonId, b: PersonId) -> (PersonId, PersonId) {
    if a <= b { (a, b) } else { (b, a) }
}

impl Canon for WorldConfig {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { opening_residents } = self;
        opening_residents.encode(w);
    }
}

impl Canon for Person {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            name,
            birth_day,
            sex,
            origin,
            traits,
            soul,
            wage,
            life,
        } = self;
        id.encode(w);
        name.encode(w);
        birth_day.encode(w);
        sex.encode(w);
        origin.encode(w);
        traits.encode(w);
        soul.encode(w);
        wage.encode(w);
        life.encode(w);
    }
}

impl Canon for Life {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Alive { .. } => 0,
            Self::Dead { .. } => 1,
        };
        tag.encode(w);
        match self {
            Self::Alive {
                household,
                mood,
                money,
            } => {
                household.encode(w);
                mood.encode(w);
                money.encode(w);
            }
            Self::Dead { death } => death.encode(w),
        }
    }
}

impl Canon for Household {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { id, founded } = self;
        id.encode(w);
        founded.encode(w);
    }
}

impl Canon for PropertyKind {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Land => 0,
            Self::House => 1,
            Self::Shop => 2,
            Self::Heirloom => 3,
        };
        tag.encode(w);
    }
}

impl Canon for Property {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { id, kind, owner } = self;
        id.encode(w);
        kind.encode(w);
        owner.encode(w);
    }
}

impl Canon for Relation {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            affinity,
            trust,
            tags,
        } = self;
        affinity.encode(w);
        trust.encode(w);
        tags.encode(w);
    }
}

impl Canon for Debt {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            creditor,
            debtor,
            principal,
            open,
            due,
        } = self;
        creditor.encode(w);
        debtor.encode(w);
        principal.encode(w);
        open.encode(w);
        due.encode(w);
    }
}

impl Canon for SoulPlace {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Body(_) => 0,
            Self::Waiting { .. } => 1,
        };
        tag.encode(w);
        match self {
            Self::Body(person) => person.encode(w),
            Self::Waiting { since } => since.encode(w),
        }
    }
}

impl Canon for Souls {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            places,
            player,
            ids,
        } = self;
        places.encode(w);
        player.encode(w);
        ids.encode(w);
    }
}

impl Canon for Rejections {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            count_by_reason,
            last,
        } = self;
        count_by_reason.encode(w);
        match last {
            None => 0u8.encode(w),
            Some((tick, seq, reason)) => {
                1u8.encode(w);
                tick.encode(w);
                seq.encode(w);
                reason.encode(w);
            }
        }
    }
}

impl Canon for World {
    /// [`CANON_VERSION`] first, then every field in the order of design "Canonical
    /// encoding of the World". `derived` is skipped explicitly: caches are outside the
    /// checksum (R16.5).
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            seed,
            config,
            params,
            tick,
            person_ids,
            household_ids,
            property_ids,
            persons,
            households,
            properties,
            relations,
            debts,
            souls,
            log,
            flows,
            rejections,
            derived: _,
        } = self;
        CANON_VERSION.encode(w);
        seed.encode(w);
        config.encode(w);
        params.encode(w);
        tick.encode(w);
        person_ids.encode(w);
        household_ids.encode(w);
        property_ids.encode(w);
        persons.encode(w);
        households.encode(w);
        properties.encode(w);
        relations.encode(w);
        debts.encode(w);
        souls.encode(w);
        log.encode(w);
        flows.encode(w);
        rejections.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checksum::Checksum;
    use crate::values::{Intensity, Trait};
    use proptest::prelude::*;

    fn world() -> World {
        World::new(7, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn zero_traits() -> Traits {
        let zero = Trait::new(0).unwrap();
        Traits {
            greed: zero,
            loyalty: zero,
            pride: zero,
            warmth: zero,
            temper: zero,
            vindictiveness: zero,
            piety: zero,
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        // Feature: life-sim, Property 11: Age is whole years rounded down.
        #[test]
        fn age_is_whole_years_rounded_down_for_any_birth_day(
            birth_day in -100_000i64..=100_000,
            extra in 0i64..=100_000,
        ) {
            // `e >= b` and `e >= 0` (a tick is never negative).
            let end = birth_day.max(0).checked_add(extra).unwrap();
            let person = Person {
                id: PersonId(1),
                name: FullName {
                    first: 0,
                    surname: 0,
                },
                birth_day,
                sex: Sex::Female,
                origin: Origin::Native,
                traits: zero_traits(),
                soul: SoulId(1),
                wage: 0,
                life: Life::Dead {
                    death: Tick(u64::try_from(end).unwrap()),
                },
            };
            let w = world();
            let expected =
                u16::try_from(end.checked_sub(birth_day).unwrap().checked_div(365).unwrap()).unwrap();
            prop_assert_eq!(w.age_years(&person), expected);

            // One day later the age is unchanged unless the new day is a birthday.
            let next = end.checked_add(1).unwrap();
            let next_person = Person {
                life: Life::Dead {
                    death: Tick(u64::try_from(next).unwrap()),
                },
                ..person
            };
            let next_age = w.age_years(&next_person);
            let days = next.checked_sub(birth_day).unwrap();
            if days.checked_rem(365).unwrap() == 0 {
                prop_assert_eq!(next_age, expected.checked_add(1).unwrap());
            } else {
                prop_assert_eq!(next_age, expected);
            }
        }
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons()
            .values()
            .filter(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .collect()
    }

    #[test]
    fn config_validation_rejects_out_of_range_values() {
        assert_eq!(WorldConfig::default().opening_residents, 50);
        assert!(WorldConfig::try_new(40).is_ok());
        assert!(WorldConfig::try_new(60).is_ok());
        assert_eq!(
            WorldConfig::try_new(39),
            Err(ConfigError::OpeningResidentsOutOfRange {
                opening_residents: 39
            })
        );
        assert_eq!(
            WorldConfig::try_new(61),
            Err(ConfigError::OpeningResidentsOutOfRange {
                opening_residents: 61
            })
        );
    }

    #[test]
    fn new_world_starts_at_tick_zero_with_all_counters_at_one() {
        let w = world();
        assert_eq!(w.tick(), Tick(0));
        assert_eq!(w.person_ids.peek(), w.persons.len() as u64 + 1);
        assert!(w.household_ids.peek() >= 2);
        assert!(w.property_ids.peek() >= 2);
        // Opening history events exist (a grudge and at least one loan), all at tick 0.
        assert!(w.log().len() >= 2);
        assert_eq!(w.log().next_id().0, w.log().len() as u64 + 1);
        assert!(w.log().events().iter().all(|e| e.tick == Tick(0)));
        assert_eq!(w.souls.ids.peek(), w.persons.len() as u64 + 3);
    }

    #[test]
    fn age_is_whole_years_rounded_down() {
        assert_eq!(age_from_birth_day(Tick(0), 0), 0);
        assert_eq!(age_from_birth_day(Tick(364), 0), 0);
        assert_eq!(age_from_birth_day(Tick(365), 0), 1);
        assert_eq!(age_from_birth_day(Tick(365 * 34 + 364), -365 * 10), 44);
        assert_eq!(age_from_birth_day(Tick(0), -365 * 50), 50);
        // A birth day in the future (never produced) reports 0, not a wrap.
        assert_eq!(age_from_birth_day(Tick(0), 10), 0);
    }

    #[test]
    fn wealth_is_balance_plus_owned_property() {
        let w = world();
        let with_property = w
            .properties()
            .values()
            .map(|p| p.owner)
            .next()
            .expect("opening world has property");
        let expected = w
            .properties()
            .values()
            .filter(|p| p.owner == with_property)
            .map(|p| p.kind.value())
            .fold(0u64, u64::saturating_add);
        assert!(w.wealth(with_property) >= expected);
        assert_eq!(w.wealth(PersonId(u64::MAX)), 0);
    }

    #[test]
    fn household_members_are_exactly_the_residents_who_name_it() {
        let w = world();
        for &id in w.households().keys() {
            let members = w.household_members(id);
            assert!(!members.is_empty());
            for member in members {
                match w.persons()[&member].life {
                    Life::Alive { household, .. } => assert_eq!(household, id),
                    Life::Dead { .. } => panic!("dead person in a household"),
                }
            }
        }
    }

    #[test]
    fn append_applies_mood_and_checks_actors_and_causes() {
        let mut w = world();
        let ids = residents(&w);
        let a = ids[0];
        let b = ids[1];
        let missed = PersonId(u64::MAX);
        assert_eq!(
            w.append(
                EventKind::Birth { person: missed },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        let next = w.log().next_id();
        let id = w
            .append(
                EventKind::Social {
                    kind: SocialKind::Quarrel,
                    doer: a,
                    target: b,
                    intensity: Intensity::new(40).unwrap(),
                },
                CausedBy::default(),
                EventTags::empty(),
            )
            .unwrap();
        assert_eq!(id, next);
        match w.persons()[&a].life {
            Life::Alive { mood, .. } => assert_eq!(mood.get(), -8),
            Life::Dead { .. } => panic!("resident"),
        }
        assert_eq!(
            w.derived.last_grievance.get(&unordered_pair(a, b)),
            Some(&id)
        );
        // An already logged cause is accepted ...
        assert!(
            w.append(
                EventKind::Death { person: a },
                CausedBy::new(vec![id]),
                EventTags::empty()
            )
            .is_ok()
        );
        // ... an unknown one is refused (R5.6).
        let mut fresh = world();
        assert_eq!(
            fresh.append(
                EventKind::Death { person: a },
                CausedBy::new(vec![EventId(99)]),
                EventTags::empty()
            ),
            Err(AppendRefused::BadCause)
        );
    }

    #[test]
    fn append_refuses_a_dead_actor_outside_afterlife_kinds() {
        let mut w = world();
        let ids = residents(&w);
        let a = ids[0];
        if let Some(p) = w.persons.get_mut(&a) {
            p.life = Life::Dead { death: Tick(0) };
        }
        assert_eq!(
            w.append(
                EventKind::Birth { person: a },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::DeadActor)
        );
        assert!(
            w.append(
                EventKind::Death { person: a },
                CausedBy::default(),
                EventTags::empty()
            )
            .is_ok()
        );
    }

    #[test]
    fn derived_state_is_not_part_of_the_checksum() {
        let w = world();
        let mut changed = w.clone();
        changed.derived.living_names.insert(FullName {
            first: 0,
            surname: 0,
        });
        assert_ne!(changed, w);
        assert_eq!(Checksum::of(&changed), Checksum::of(&w));
    }

    #[test]
    fn rebuild_derived_restores_the_same_indexes() {
        let w = world();
        let mut rebuilt = w.clone();
        rebuilt.discard_derived();
        rebuilt.rebuild_derived();
        assert_eq!(rebuilt, w);
    }

    #[test]
    fn trait_values_and_relation_tags_are_encoded() {
        use crate::values::{RelationTag, Trait};
        let relation = Relation {
            affinity: Score::clamped(-60),
            trust: Score::clamped(-50),
            tags: {
                let mut tags = RelTags::empty();
                tags.insert(RelationTag::Rival);
                tags
            },
        };
        let traits = Traits {
            greed: Trait::new(1).unwrap(),
            loyalty: Trait::new(0).unwrap(),
            pride: Trait::new(-1).unwrap(),
            warmth: Trait::new(2).unwrap(),
            temper: Trait::new(-2).unwrap(),
            vindictiveness: Trait::new(3).unwrap(),
            piety: Trait::new(0).unwrap(),
        };
        use crate::canon::encode_to_vec;
        assert_eq!(encode_to_vec(&relation).len(), 4);
        assert_eq!(encode_to_vec(&traits).len(), 7);
    }
}
