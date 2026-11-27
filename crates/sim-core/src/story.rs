//! Full-fidelity, read-only history delivery. Nothing here is canonical state.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde::ser::{SerializeStruct, Serializer};

use crate::events::{Event, EventKind};
use crate::ids::{EventId, InputSeq, NodeId, PersonId, Tick};
use crate::narrator::ChronicleEntry;
use crate::observations::{decimal, person};
use crate::values::RelationTag;
use crate::world::{Life, SoulPlace, World};

fn signed<S: Serializer>(value: &i64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_str(value)
}
fn optional_signed<S: Serializer>(value: &Option<i64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => serializer.collect_str(value),
        None => serializer.serialize_none(),
    }
}
fn optional_decimal<S: Serializer>(value: &Option<u64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => serializer.collect_str(value),
        None => serializer.serialize_none(),
    }
}
fn index<S: Serializer>(value: &usize, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_str(value)
}
fn event_ids<S: Serializer>(values: &[EventId], serializer: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;
    let mut sequence = serializer.serialize_seq(Some(values.len()))?;
    for value in values {
        sequence.serialize_element(&DecimalText(value.0))?;
    }
    sequence.end()
}
struct DecimalText(u64);
impl Serialize for DecimalText {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(&self.0)
    }
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryActor {
    #[serde(serialize_with = "person")]
    pub person: PersonId,
    pub soul_id: String,
    pub name: String,
    pub sex: &'static str,
    pub origin: &'static str,
    // The fixed official has a nominal age, not a biological birth date.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "optional_signed"
    )]
    pub birth_day: Option<i64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "optional_decimal"
    )]
    pub age_at_death: Option<u64>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
pub enum StoryBasis {
    #[serde(rename = "opening-current")]
    OpeningCurrent,
    #[serde(rename = "observed-day-start")]
    ObservedDayStart,
    #[serde(rename = "observed-day-end")]
    ObservedDayEnd,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextActor {
    #[serde(serialize_with = "person")]
    pub person: PersonId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kin_role: Option<&'static str>,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorContext {
    #[serde(serialize_with = "person")]
    pub relative_to: PersonId,
    pub basis: StoryBasis,
    pub actors: Vec<ContextActor>,
}
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StoryRelevance {
    #[serde(rename = "self")]
    SelfLife,
    Circle,
    Townlife,
    Background,
}
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
pub enum RelevanceBasis {
    #[serde(rename = "opening-current")]
    OpeningCurrent,
    #[serde(rename = "observed-day-start-end")]
    ObservedDayStartEnd,
}

/// Owns only the native payload; the wire never uses the lossy context-card codec.
#[derive(Debug, Eq, PartialEq)]
pub struct StoryEventKind(pub EventKind);
impl Serialize for StoryEventKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        macro_rules! payload {
            ($kind:literal $(, $field:literal => $value:expr)* $(,)?) => {{
                let mut object = serializer.serialize_struct("StoryEventKind", ["type", $($field),*].len())?;
                object.serialize_field("type", $kind)?;
                $(object.serialize_field($field, &$value)?;)*
                object.end()
            }};
        }
        match &self.0 {
            EventKind::Birth { person } => payload!("birth", "person" => person.0),
            EventKind::Death { person } => payload!("death", "person" => person.0),
            EventKind::Marriage { a, b } => payload!("marriage", "a" => a.0, "b" => b.0),
            EventKind::Loan {
                lender,
                borrower,
                amount,
                due,
            } => payload!("loan",
                "lender" => lender.0, "borrower" => borrower.0,
                "amount" => DecimalText(*amount), "due" => DecimalText(due.0)),
            EventKind::Repayment {
                payer,
                payee,
                amount,
            } => payload!("repayment",
                "payer" => payer.0, "payee" => payee.0, "amount" => DecimalText(*amount)),
            EventKind::DebtTransfer { from, to, amount } => payload!("debt_transfer",
                "from" => from.0, "to" => to.0, "amount" => DecimalText(*amount)),
            EventKind::DebtForgiven {
                creditor,
                debtor,
                amount,
            } => payload!("debt_forgiven",
                "creditor" => creditor.0, "debtor" => debtor.0, "amount" => DecimalText(*amount)),
            EventKind::Inheritance {
                deceased,
                heir,
                amount,
            } => payload!("inheritance",
                "deceased" => deceased.0, "heir" => heir.0, "amount" => DecimalText(*amount)),
            EventKind::Possession { person, price } => payload!("possession",
                "person" => person.0, "price" => DecimalText(*price)),
            EventKind::Rebuild { person, price } => payload!("rebuild",
                "person" => person.0, "price" => DecimalText(*price)),
            EventKind::Offering {
                offerer,
                ghost,
                amount,
                credited,
            } => payload!("offering",
                "offerer" => offerer.0, "ghost" => ghost.0,
                "amount" => DecimalText(*amount), "credited" => DecimalText(*credited)),
            EventKind::BribeOffering {
                ghost,
                magistrate,
                amount,
            } => payload!("bribe_offering",
                "ghost" => ghost.0, "magistrate" => magistrate.0, "amount" => DecimalText(*amount)),
            EventKind::Dream {
                ghost,
                dreamer,
                price,
            } => payload!("dream",
                "ghost" => ghost.0, "dreamer" => dreamer.0, "price" => DecimalText(*price)),
            EventKind::Haunting {
                ghost,
                target,
                intensity,
                price,
            } => payload!("haunting",
                "ghost" => ghost.0, "target" => target.0,
                "intensity" => DecimalText(*intensity), "price" => DecimalText(*price)),
            EventKind::Appeal { ghost, magistrate } => payload!("appeal",
                "ghost" => ghost.0, "magistrate" => magistrate.0),
            EventKind::Social {
                kind,
                doer,
                target,
                intensity,
            } => payload!("social",
                "kind" => kind.name(), "doer" => doer.0, "target" => target.0,
                "intensity" => intensity.get()),
        }
    }
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryEvent {
    #[serde(serialize_with = "decimal")]
    pub id: EventId,
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    pub kind: StoryEventKind,
    #[serde(serialize_with = "event_ids")]
    pub caused_by: Vec<EventId>,
    pub tags: u16,
    pub relevance: StoryRelevance,
    pub relevance_basis: RelevanceBasis,
    pub actor_context: Vec<ActorContext>,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct StoryStakes {
    pub who: Vec<u64>,
    #[serde(serialize_with = "signed")]
    pub amount: i64,
    pub unit: &'static str,
    #[serde(serialize_with = "decimal")]
    pub by: Tick,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct StorySkipped {
    pub part: u8,
    pub reason: &'static str,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryChronicle {
    #[serde(serialize_with = "index")]
    pub index: usize,
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    pub family: &'static str,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "optional_decimal"
    )]
    pub node: Option<u64>,
    pub stakes: StoryStakes,
    pub applied: &'static str,
    pub source: &'static str,
    pub chooser_absent: bool,
    pub skipped: Vec<StorySkipped>,
    #[serde(serialize_with = "event_ids")]
    pub appended: Vec<EventId>,
    pub actor_context: Vec<ActorContext>,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamInterpretation {
    #[serde(serialize_with = "decimal")]
    pub node: NodeId,
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    pub applied: &'static str,
    pub source: &'static str,
    pub rules_default: &'static str,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamFact {
    #[serde(serialize_with = "decimal")]
    pub event_id: EventId,
    #[serde(serialize_with = "decimal")]
    pub input_seq: InputSeq,
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    #[serde(serialize_with = "person")]
    pub ghost: PersonId,
    #[serde(serialize_with = "person")]
    pub dreamer: PersonId,
    pub intent: &'static str,
    #[serde(serialize_with = "decimal")]
    pub price: u64,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "optional_decimal"
    )]
    pub node: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interpretation: Option<DreamInterpretation>,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct StoryCursor {
    #[serde(serialize_with = "index")]
    pub start: usize,
    #[serde(serialize_with = "index")]
    pub end: usize,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct StoryCursors {
    pub events: StoryCursor,
    pub chronicle: StoryCursor,
}
/// Complete read-only kin identity at the instant an own Death was appended.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct NativeDeathKinPerson {
    #[serde(serialize_with = "person")]
    pub person: PersonId,
    pub name: String,
    pub sex: &'static str,
    pub relation: &'static str,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnDeathKinSummaryV1 {
    #[serde(serialize_with = "decimal")]
    pub death_event: EventId,
    #[serde(serialize_with = "person")]
    pub body: PersonId,
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    pub spouse: Vec<NativeDeathKinPerson>,
    pub living_children: Vec<NativeDeathKinPerson>,
    pub living_grandchildren: Vec<NativeDeathKinPerson>,
    pub deceased_spouses: Vec<NativeDeathKinPerson>,
    pub deceased_parents: Vec<NativeDeathKinPerson>,
    pub deceased_children: Vec<NativeDeathKinPerson>,
    pub deceased_siblings: Vec<NativeDeathKinPerson>,
}

/// Only the directed outgoing edges; traversal adds observation labels, not kin tags.
fn outgoing_kin(
    world: &World,
    from: PersonId,
) -> impl Iterator<Item = (PersonId, &crate::world::Relation)> {
    world
        .relations()
        .range((from, PersonId(0))..=(from, PersonId(u64::MAX)))
        .filter(|(_, relation)| relation.tags.has_kinship())
        .map(|(&(_, to), relation)| (to, relation))
}
fn insert_kin(
    category: &mut Vec<NativeDeathKinPerson>,
    person: &crate::world::Person,
    relation: &'static str,
) {
    if let Err(index) = category.binary_search_by_key(&person.id, |entry| entry.person) {
        category.insert(
            index,
            NativeDeathKinPerson {
                person: person.id,
                name: person.name.text(person.sex),
                sex: person.sex.as_str(),
                relation,
            },
        );
    }
}
impl OwnDeathKinSummaryV1 {
    fn capture(world: &World, body: PersonId, death_event: EventId) -> Self {
        let mut summary = Self {
            death_event,
            body,
            tick: world.tick(),
            spouse: Vec::new(),
            living_children: Vec::new(),
            living_grandchildren: Vec::new(),
            deceased_spouses: Vec::new(),
            deceased_parents: Vec::new(),
            deceased_children: Vec::new(),
            deceased_siblings: Vec::new(),
        };
        for (to, edge) in outgoing_kin(world, body) {
            let person = &world.persons()[&to];
            let tags = edge.tags;
            let alive = matches!(person.life, Life::Alive { .. });
            if tags.contains(RelationTag::Spouse) {
                insert_kin(
                    if alive {
                        &mut summary.spouse
                    } else {
                        &mut summary.deceased_spouses
                    },
                    person,
                    "spouse",
                );
            } else if tags.contains(RelationTag::FormerSpouse) && !alive {
                insert_kin(&mut summary.deceased_spouses, person, "former_spouse");
            }
            if tags.contains(RelationTag::Child) {
                insert_kin(
                    if alive {
                        &mut summary.living_children
                    } else {
                        &mut summary.deceased_children
                    },
                    person,
                    "child",
                );
                for (grandchild, _) in outgoing_kin(world, to)
                    .filter(|(_, edge)| edge.tags.contains(RelationTag::Child))
                {
                    let person = &world.persons()[&grandchild];
                    if matches!(person.life, Life::Alive { .. }) {
                        insert_kin(&mut summary.living_grandchildren, person, "grandchild");
                    }
                }
            }
            if tags.contains(RelationTag::Grandchild) && alive {
                insert_kin(&mut summary.living_grandchildren, person, "grandchild");
            }
            if tags.contains(RelationTag::Parent) {
                if !alive {
                    insert_kin(&mut summary.deceased_parents, person, "parent");
                }
                for (sibling, _) in outgoing_kin(world, to).filter(|(sibling, edge)| {
                    *sibling != body && edge.tags.contains(RelationTag::Child)
                }) {
                    let person = &world.persons()[&sibling];
                    if matches!(person.life, Life::Dead { .. }) {
                        insert_kin(&mut summary.deceased_siblings, person, "sibling");
                    }
                }
            }
            if to != body && tags.contains(RelationTag::Sibling) && !alive {
                insert_kin(&mut summary.deceased_siblings, person, "sibling");
            }
        }
        summary
    }
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct StoryBatch {
    pub version: u8,
    pub opening: bool,
    pub actors: Vec<StoryActor>,
    pub events: Vec<StoryEvent>,
    pub chronicle: Vec<StoryChronicle>,
    pub dreams: Vec<DreamFact>,
    #[serde(rename = "ownDeathSummaries", skip_serializing_if = "Vec::is_empty")]
    pub own_death_summaries: Vec<OwnDeathKinSummaryV1>,
    pub cursors: StoryCursors,
}

const KIN_ORDER: [RelationTag; 9] = [
    RelationTag::Spouse,
    RelationTag::FormerSpouse,
    RelationTag::Parent,
    RelationTag::Child,
    RelationTag::Sibling,
    RelationTag::Grandparent,
    RelationTag::Grandchild,
    RelationTag::Cousin,
    RelationTag::InLaw,
];

/// Just the focused relationships at one real boundary, never an owned World.
pub(crate) struct Focus {
    person: Option<PersonId>,
    close: BTreeSet<PersonId>,
    kin: BTreeMap<PersonId, &'static str>,
}
impl Focus {
    pub(crate) fn capture(world: &World) -> Self {
        let person = match world.souls().places.get(&world.souls().player) {
            Some(SoulPlace::Body(person)) => Some(*person),
            Some(SoulPlace::Waiting { .. }) => world.player_wait().map(|wait| wait.ghost),
            None => None,
        };
        let mut focus = Self {
            person,
            close: BTreeSet::new(),
            kin: BTreeMap::new(),
        };
        let earlier: BTreeSet<_> = world
            .persons()
            .values()
            .filter(|person| {
                person.soul == world.souls().player && matches!(person.life, Life::Dead { .. })
            })
            .map(|person| person.id)
            .collect();
        for (&(from, to), relation) in world.relations() {
            let kin = relation.tags.has_kinship();
            let strong = relation.affinity.get().unsigned_abs() >= 20;
            if Some(from) == person {
                if kin || strong {
                    focus.close.insert(to);
                }
                if let Some(role) = KIN_ORDER.iter().find(|tag| relation.tags.contains(**tag)) {
                    focus.kin.insert(to, role.name());
                }
            }
            if Some(to) == person && (kin || strong) {
                focus.close.insert(from);
            }
            // Remembering requires a real living -> earlier-body relation. Its reverse
            // affinity is irrelevant; reverse kinship remains a qualifying kin fact.
            if earlier.contains(&to)
                && world
                    .persons()
                    .get(&from)
                    .is_some_and(|actor| matches!(actor.life, Life::Alive { .. }))
                && (kin
                    || strong
                    || world
                        .relations()
                        .get(&(to, from))
                        .is_some_and(|reverse| reverse.tags.has_kinship()))
            {
                focus.close.insert(from);
            }
        }
        focus
    }
    fn context(&self, actors: &[PersonId], basis: StoryBasis) -> Option<ActorContext> {
        self.person.map(|relative_to| ActorContext {
            relative_to,
            basis,
            actors: actors
                .iter()
                .map(|person| ContextActor {
                    person: *person,
                    kin_role: self.kin.get(person).copied(),
                })
                .collect(),
        })
    }
}

pub(crate) struct StoryCollector {
    pub(crate) batch: StoryBatch,
    focus: Focus,
    actors: BTreeMap<PersonId, StoryActor>,
}
impl StoryCollector {
    pub(crate) fn new(world: &World, opening: bool) -> Self {
        let event_start = if opening { 0 } else { world.log().len() };
        let chronicle_start = if opening {
            0
        } else {
            world.narrator().chronicle.entries().len()
        };
        Self {
            batch: StoryBatch {
                version: 1,
                opening,
                actors: Vec::new(),
                events: Vec::new(),
                chronicle: Vec::new(),
                dreams: Vec::new(),
                own_death_summaries: Vec::new(),
                cursors: StoryCursors {
                    events: StoryCursor {
                        start: event_start,
                        end: event_start,
                    },
                    chronicle: StoryCursor {
                        start: chronicle_start,
                        end: chronicle_start,
                    },
                },
            },
            focus: Focus::capture(world),
            actors: BTreeMap::new(),
        }
    }
    pub(crate) fn successful_death(&mut self, world: &World, deceased: PersonId, death: EventId) {
        // Soul identity survives arrival/rebirth within this tick; day-start Focus does not.
        if world.persons()[&deceased].soul != world.souls().player {
            return;
        }
        self.batch
            .own_death_summaries
            .push(OwnDeathKinSummaryV1::capture(world, deceased, death));
    }

    fn actor(&mut self, world: &World, id: PersonId) {
        use std::collections::btree_map::Entry;
        let entry = match self.actors.entry(id) {
            Entry::Occupied(mut entry) => {
                // Identity stays immutable; a death age can become known this batch.
                let actor = entry.get_mut();
                if actor.age_at_death.is_none()
                    && let Some(person) = world.persons().get(&id)
                    && matches!(person.life, Life::Dead { .. })
                {
                    actor.age_at_death = Some(u64::from(world.age_years(person)));
                }
                return;
            }
            Entry::Vacant(entry) => entry,
        };
        let actor = if let Some(person) = world.persons().get(&id) {
            StoryActor {
                person: id,
                soul_id: format!("S-{:04}", person.soul.0),
                name: person.name.text(person.sex),
                sex: person.sex.as_str(),
                origin: person.origin.as_str(),
                birth_day: Some(person.birth_day),
                age_at_death: matches!(person.life, Life::Dead { .. })
                    .then(|| u64::from(world.age_years(person))),
            }
        } else if id == world.magistrate().id {
            use crate::underworld::magistrate;
            StoryActor {
                person: id,
                soul_id: magistrate::SOUL_ID_TEXT.to_owned(),
                name: magistrate::FULL_NAME.to_owned(),
                sex: magistrate::SEX.as_str(),
                origin: "official",
                birth_day: None,
                age_at_death: None,
            }
        } else {
            // Real append validation retains every actor; unavailable IDs are not
            // replaced with fabricated names or identities.
            return;
        };
        entry.insert(actor);
    }
    fn contexts(&self, actors: &[PersonId], end: Option<&Focus>) -> Vec<ActorContext> {
        if self.batch.opening {
            self.focus
                .context(actors, StoryBasis::OpeningCurrent)
                .into_iter()
                .collect()
        } else {
            self.focus
                .context(actors, StoryBasis::ObservedDayStart)
                .into_iter()
                .chain(end.and_then(|end| end.context(actors, StoryBasis::ObservedDayEnd)))
                .collect()
        }
    }
    fn event(&mut self, world: &World, event: &Event, end: Option<&Focus>) {
        let actors = event.kind.actors();
        for actor in actors.iter() {
            self.actor(world, actor);
        }
        let relevance = if actors.iter().any(|actor| {
            Some(actor) == self.focus.person || end.is_some_and(|end| Some(actor) == end.person)
        }) {
            StoryRelevance::SelfLife
        } else if actors.iter().any(|actor| {
            self.focus.close.contains(&actor) || end.is_some_and(|end| end.close.contains(&actor))
        }) {
            StoryRelevance::Circle
        } else if matches!(
            event.kind,
            EventKind::Birth { .. } | EventKind::Marriage { .. } | EventKind::Death { .. }
        ) {
            StoryRelevance::Townlife
        } else {
            StoryRelevance::Background
        };
        self.batch.events.push(StoryEvent {
            id: event.id,
            tick: event.tick,
            kind: StoryEventKind(event.kind.clone()),
            caused_by: event.caused_by.as_slice().to_vec(),
            tags: event.tags.bits(),
            relevance,
            relevance_basis: if self.batch.opening {
                RelevanceBasis::OpeningCurrent
            } else {
                RelevanceBasis::ObservedDayStartEnd
            },
            actor_context: self.contexts(actors.as_slice(), end),
        });
    }
    fn chronicle(
        &mut self,
        world: &World,
        index: usize,
        entry: &ChronicleEntry,
        end: Option<&Focus>,
    ) {
        for &actor in &entry.stakes.who {
            self.actor(world, actor);
        }
        // A joined prior event can reference a retained actor outside today's suffix.
        for &id in &entry.appended {
            if let Some(event) = world.log().event(id) {
                for actor in event.kind.actors().iter() {
                    self.actor(world, actor);
                }
            }
        }
        self.batch.chronicle.push(StoryChronicle {
            index,
            tick: entry.tick,
            family: entry.family.label(),
            node: entry.node.map(|node| node.0),
            stakes: StoryStakes {
                who: entry.stakes.who.iter().map(|person| person.0).collect(),
                amount: entry.stakes.amount,
                unit: entry.stakes.unit.label(),
                by: entry.stakes.by,
            },
            applied: entry.applied.label(),
            source: entry.source.label(),
            chooser_absent: entry.chooser_absent,
            skipped: entry
                .skipped
                .iter()
                .map(|&(part, reason)| StorySkipped {
                    part,
                    reason: reason.label(),
                })
                .collect(),
            appended: entry.appended.clone(),
            actor_context: self.contexts(&entry.stakes.who, end),
        });
    }
    pub(crate) fn completed(&mut self, world: &World) {
        self.completed_with(world, |_| {});
    }
    pub(crate) fn completed_with(&mut self, world: &World, mut observe: impl FnMut(&Event)) {
        let end = (!self.batch.opening).then(|| Focus::capture(world));
        for event in &world.log().events()[self.batch.cursors.events.end..] {
            self.event(world, event, end.as_ref());
            observe(event);
        }
        let entries = world.narrator().chronicle.entries();
        for (index, entry) in entries
            .iter()
            .enumerate()
            .skip(self.batch.cursors.chronicle.end)
        {
            self.chronicle(world, index, entry, end.as_ref());
        }
        // Focus identities themselves qualify the actor context, even on quiet days.
        if let Some(id) = self.focus.person {
            self.actor(world, id);
        }
        if let Some(id) = end.as_ref().and_then(|end| end.person) {
            self.actor(world, id);
        }
        self.batch.cursors.events.end = world.log().len();
        self.batch.cursors.chronicle.end = entries.len();
        if let Some(end) = end {
            self.focus = end;
        }
    }
    pub(crate) fn finish(mut self) -> StoryBatch {
        self.batch.actors = self.actors.into_values().collect();
        self.batch
    }
}

/// The fresh-create prefix only. Read-only calls do not consume history or advance.
pub fn story_opening(world: &World) -> StoryBatch {
    let mut collector = StoryCollector::new(world, true);
    collector.completed(world);
    collector.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{CausedBy, EventTags};
    use crate::input::InputPayload;
    use crate::params::Params;
    use crate::tick::Sim;
    use crate::values::{Intensity, RelTags, Score, SocialKind};
    use crate::world::{Relation, WorldConfig};
    use serde_json::json;

    #[test]
    fn all_native_payload_roles_and_large_integers_survive_wire_projection() {
        let a = PersonId(1);
        let b = PersonId(2);
        let n = u64::MAX;
        let text = n.to_string();
        let cases = [
            (
                EventKind::Birth { person: a },
                json!({"type":"birth","person":1}),
            ),
            (
                EventKind::Death { person: a },
                json!({"type":"death","person":1}),
            ),
            (
                EventKind::Marriage { a, b },
                json!({"type":"marriage","a":1,"b":2}),
            ),
            (
                EventKind::Loan {
                    lender: a,
                    borrower: b,
                    amount: n,
                    due: Tick(n),
                },
                json!({"type":"loan","lender":1,"borrower":2,"amount":text,"due":text}),
            ),
            (
                EventKind::Repayment {
                    payer: a,
                    payee: b,
                    amount: n,
                },
                json!({"type":"repayment","payer":1,"payee":2,"amount":text}),
            ),
            (
                EventKind::DebtTransfer {
                    from: a,
                    to: b,
                    amount: n,
                },
                json!({"type":"debt_transfer","from":1,"to":2,"amount":text}),
            ),
            (
                EventKind::DebtForgiven {
                    creditor: a,
                    debtor: b,
                    amount: n,
                },
                json!({"type":"debt_forgiven","creditor":1,"debtor":2,"amount":text}),
            ),
            (
                EventKind::Inheritance {
                    deceased: a,
                    heir: b,
                    amount: n,
                },
                json!({"type":"inheritance","deceased":1,"heir":2,"amount":text}),
            ),
            (
                EventKind::Possession {
                    person: a,
                    price: n,
                },
                json!({"type":"possession","person":1,"price":text}),
            ),
            (
                EventKind::Rebuild {
                    person: a,
                    price: n,
                },
                json!({"type":"rebuild","person":1,"price":text}),
            ),
            (
                EventKind::Offering {
                    offerer: a,
                    ghost: b,
                    amount: n,
                    credited: 0,
                },
                json!({"type":"offering","offerer":1,"ghost":2,"amount":text,"credited":"0"}),
            ),
            (
                EventKind::BribeOffering {
                    ghost: a,
                    magistrate: b,
                    amount: n,
                },
                json!({"type":"bribe_offering","ghost":1,"magistrate":2,"amount":text}),
            ),
            (
                EventKind::Dream {
                    ghost: a,
                    dreamer: b,
                    price: n,
                },
                json!({"type":"dream","ghost":1,"dreamer":2,"price":text}),
            ),
            (
                EventKind::Haunting {
                    ghost: a,
                    target: b,
                    intensity: n,
                    price: n,
                },
                json!({"type":"haunting","ghost":1,"target":2,"intensity":text,"price":text}),
            ),
            (
                EventKind::Appeal {
                    ghost: a,
                    magistrate: b,
                },
                json!({"type":"appeal","ghost":1,"magistrate":2}),
            ),
            (
                EventKind::Social {
                    kind: SocialKind::Gift,
                    doer: a,
                    target: b,
                    intensity: Intensity::new(36).unwrap(),
                },
                json!({"type":"social","kind":"gift","doer":1,"target":2,"intensity":36}),
            ),
        ];
        for (kind, expected) in cases {
            assert_eq!(
                serde_json::to_value(StoryEventKind(kind)).unwrap(),
                expected
            );
        }
        for (kind, label) in [
            (SocialKind::Help, "help"),
            (SocialKind::Gift, "gift"),
            (SocialKind::Quarrel, "quarrel"),
            (SocialKind::Insult, "insult"),
            (SocialKind::Theft, "theft"),
            (SocialKind::Apology, "apology"),
        ] {
            let payload = StoryEventKind(EventKind::Social {
                kind,
                doer: a,
                target: b,
                intensity: Intensity::new(25).unwrap(),
            });
            assert_eq!(serde_json::to_value(payload).unwrap()["kind"], label);
        }
    }

    #[test]
    fn opening_is_read_only_and_observed_suffix_starts_at_actual_ends() {
        let mut sim = Sim::new(1205, WorldConfig::default()).unwrap();
        let mut control = sim.clone();
        let before = crate::snapshot::snapshot_json(sim.world());
        let opening = story_opening(sim.world());
        assert_eq!(opening, story_opening(sim.world()));
        assert_eq!(before, crate::snapshot::snapshot_json(sim.world()));
        assert_eq!(opening.cursors.events.start, 0);
        assert_eq!(opening.cursors.events.end, sim.world().log().len());
        assert_eq!(opening.cursors.chronicle.start, 0);
        let mut referenced = BTreeSet::new();
        for (projected, event) in opening.events.iter().zip(sim.world().log().events()) {
            assert_eq!(projected.id, event.id);
            assert_eq!(projected.tick, event.tick);
            assert_eq!(projected.kind.0, event.kind);
            assert_eq!(projected.caused_by, event.caused_by.as_slice());
            assert_eq!(projected.tags, event.tags.bits());
            assert_eq!(projected.relevance_basis, RelevanceBasis::OpeningCurrent);
            for context in &projected.actor_context {
                referenced.insert(context.relative_to);
                assert_eq!(context.basis, StoryBasis::OpeningCurrent);
            }
            referenced.extend(event.kind.actors().iter());
        }
        assert_eq!(opening.actors.len(), referenced.len());
        for actor in &opening.actors {
            let native = &sim.world().persons()[&actor.person];
            assert_eq!(actor.name, native.name.text(native.sex));
            assert_eq!(actor.birth_day, Some(native.birth_day));
            assert_eq!(actor.soul_id, format!("S-{:04}", native.soul.0));
        }
        let report = sim.run_until_stop_observed(1);
        assert_eq!(report.checksum, Some(control.step()));
        assert!(!report.story.opening);
        assert_eq!(
            report.story.cursors.events.start,
            opening.cursors.events.end
        );
        assert_eq!(
            report.story.cursors.chronicle.start,
            opening.cursors.chronicle.end
        );
        let empty = sim.run_until_stop_observed(0).story;
        assert!(empty.events.is_empty() && empty.chronicle.is_empty() && empty.dreams.is_empty());
        assert_eq!(empty.cursors.events.start, empty.cursors.events.end);
    }

    #[test]
    fn causes_unknown_tag_bits_and_signed_stakes_are_not_rounded() {
        let world = World::new(1205, WorldConfig::default()).unwrap();
        let focus = Focus::capture(&world).person.unwrap();
        let event = Event {
            id: EventId(u64::MAX),
            tick: Tick(u64::MAX),
            kind: EventKind::Birth { person: focus },
            caused_by: CausedBy::new(vec![EventId(u64::MAX.saturating_sub(1))]),
            tags: EventTags::from_bits(0xe001),
        };
        let mut collector = StoryCollector::new(&world, false);
        collector.event(&world, &event, Some(&Focus::capture(&world)));
        let wire = serde_json::to_value(collector.finish()).unwrap();
        assert_eq!(wire["events"][0]["id"], u64::MAX.to_string());
        assert_eq!(wire["events"][0]["tick"], u64::MAX.to_string());
        assert_eq!(
            wire["events"][0]["causedBy"][0],
            u64::MAX.saturating_sub(1).to_string()
        );
        assert_eq!(wire["events"][0]["tags"], 0xe001);
        let stakes = StoryStakes {
            who: vec![focus.0],
            amount: i64::MIN,
            unit: "money",
            by: Tick(u64::MAX),
        };
        assert_eq!(
            serde_json::to_value(stakes).unwrap()["amount"],
            i64::MIN.to_string()
        );
    }

    fn quiet() -> Params {
        let mut params = Params::DEFAULT;
        params.mortality_ppm_by_age = [0; 120];
        params.mortality_floor_ppm = 0;
        params.birth_ppm_married = 0;
        params.birth_ppm_unmarried = 0;
        params.marriage_ppm = 0;
        params.loan_ppm = 0;
        params.social_ppm = 0;
        params.min_salience = i64::MAX;
        params
    }
    fn relation(affinity: i64, tags: RelTags) -> Relation {
        Relation {
            affinity: Score::clamped(affinity),
            trust: Score::clamped(0),
            tags,
        }
    }

    #[test]
    fn day_start_close_survives_decay_without_leaking_into_next_day() {
        let mut world = World::new_with_params(1205, WorldConfig::default(), quiet()).unwrap();
        world.tick = Tick(29);
        let focus = Focus::capture(&world).person.unwrap();
        let actors: Vec<_> = world
            .persons()
            .values()
            .filter(|person| person.id != focus && matches!(person.life, Life::Alive { .. }))
            .take(2)
            .map(|person| person.id)
            .collect();
        world.relations.clear();
        world
            .relations
            .insert((focus, actors[0]), relation(20, RelTags::empty()));
        let mut sim = Sim::from_test_world(world);
        let payload = InputPayload::Act {
            kind: SocialKind::Help,
            actor: actors[0],
            target: actors[1],
            intensity: 1,
        };
        sim.submit(sim.world().tick(), payload).unwrap();
        let first = sim.run_until_stop_observed(1).story;
        let event = first
            .events
            .iter()
            .find(|event| matches!(event.kind.0, EventKind::Social { .. }))
            .unwrap();
        assert_eq!(event.relevance, StoryRelevance::Circle);
        assert_eq!(event.actor_context[0].basis, StoryBasis::ObservedDayStart);
        assert_eq!(event.actor_context[1].basis, StoryBasis::ObservedDayEnd);
        assert_eq!(
            sim.world().relations()[&(focus, actors[0])].affinity.get(),
            19
        );
        sim.submit(sim.world().tick(), payload).unwrap();
        let second = sim.run_until_stop_observed(1).story;
        let event = second
            .events
            .iter()
            .find(|event| matches!(event.kind.0, EventKind::Social { .. }))
            .unwrap();
        assert_eq!(event.relevance, StoryRelevance::Background);
    }

    #[test]
    fn oriented_kin_uses_actor_role_not_actors_reverse_role() {
        let mut world = World::new_with_params(1205, WorldConfig::default(), quiet()).unwrap();
        let focus = Focus::capture(&world).person.unwrap();
        let actors: Vec<_> = world
            .persons()
            .values()
            .filter(|person| person.id != focus && matches!(person.life, Life::Alive { .. }))
            .take(2)
            .map(|person| person.id)
            .collect();
        world.relations.clear();
        world.relations.insert(
            (focus, actors[0]),
            relation(0, RelTags::from_bits(RelationTag::Parent.bit())),
        );
        world.relations.insert(
            (actors[0], focus),
            relation(0, RelTags::from_bits(RelationTag::Child.bit())),
        );
        let mut sim = Sim::from_test_world(world);
        sim.submit(
            sim.world().tick(),
            InputPayload::Act {
                kind: SocialKind::Gift,
                actor: actors[0],
                target: actors[1],
                intensity: 36,
            },
        )
        .unwrap();
        let batch = sim.run_until_stop_observed(1).story;
        let event = batch
            .events
            .iter()
            .find(|event| matches!(event.kind.0, EventKind::Social { .. }))
            .unwrap();
        assert_eq!(event.relevance, StoryRelevance::Circle);
        for context in &event.actor_context {
            assert_eq!(context.relative_to, focus);
            assert_eq!(context.actors[0].person, actors[0]);
            assert_eq!(context.actors[0].kin_role, Some("parent"));
            assert_eq!(context.actors[1].kin_role, None);
        }
    }

    #[test]
    fn real_past_life_remembrance_uses_rememberer_direction_not_reverse_affinity() {
        let mut world = World::new_with_params(1205, WorldConfig::default(), quiet()).unwrap();
        world.tick = Tick(1);
        let earlier = crate::testing::prepare_player_wait(&mut world, Tick(0), Some(Tick(1)), None);
        world.joss.get_mut(&world.souls.player).unwrap().balance = 1_000;
        let mut sim = Sim::from_test_world(world);
        sim.submit(
            sim.world().tick(),
            InputPayload::ClaimSlot {
                slot: crate::underworld::slots::SlotRef::ImportedVessel,
                customization: None,
            },
        )
        .unwrap();
        let arrival = sim.run_until_stop_observed(1);
        assert!(arrival.stops.player_reborn);
        let mut world = sim.world().clone();
        let current = Focus::capture(&world).person.unwrap();
        assert_ne!(current, earlier);
        let people: Vec<_> = world
            .persons()
            .values()
            .filter(|person| person.id != current && matches!(person.life, Life::Alive { .. }))
            .take(3)
            .map(|person| person.id)
            .collect();
        world.relations.clear();
        world
            .relations
            .insert((people[0], earlier), relation(1, RelTags::empty()));
        world
            .relations
            .insert((earlier, people[0]), relation(-80, RelTags::empty()));
        world
            .relations
            .insert((people[1], earlier), relation(-20, RelTags::empty()));
        world
            .relations
            .insert((people[2], earlier), relation(1, RelTags::empty()));
        world.relations.insert(
            (earlier, people[2]),
            relation(0, RelTags::from_bits(RelationTag::Parent.bit())),
        );
        let selected = Focus::capture(&world);
        assert!(!selected.close.contains(&people[0]));
        assert!(selected.close.contains(&people[1]));
        assert!(selected.close.contains(&people[2]));
        let connected = crate::underworld::ghosts::connected(&world, earlier);
        assert!(
            people.iter().all(|person| connected.contains(person)),
            "selection does not narrow connectivity"
        );
        assert!(
            !selected.kin.contains_key(&people[2]),
            "an earlier-body kin fact is not kin of the new body"
        );
    }

    #[test]
    fn own_death_kin_categories_union_paths_and_use_exact_settlement_instant() {
        let mut params = quiet();
        params.mortality_ppm_by_age = [1_000_000; 120];
        params.mortality_floor_ppm = 1_000_000;
        let mut world = World::new_with_params(1205, WorldConfig::default(), params).unwrap();
        world.tick = Tick(7);
        let body = PersonId(10);
        assert_eq!(world.persons()[&body].soul, world.souls().player);
        world.relations.clear();
        for id in [3, 4, 6] {
            world.persons.get_mut(&PersonId(id)).unwrap().life = Life::Dead { death: Tick(1) };
        }
        for (from, to, tag) in [
            (10, 14, RelationTag::Spouse),
            (10, 3, RelationTag::Spouse), // Death retains this tag, even after remarriage.
            (10, 4, RelationTag::FormerSpouse),
            (10, 12, RelationTag::Child),
            (10, 2, RelationTag::Child),
            (10, 5, RelationTag::Parent),
            (10, 16, RelationTag::Parent),
            (10, 18, RelationTag::Grandchild),
            (12, 18, RelationTag::Child), // Duplicate direct/traversed grandchild.
            (2, 19, RelationTag::Child),  // Living grandchild through a deceased child.
            (12, 6, RelationTag::Child),  // A deceased grandchild is not a survivor.
            (10, 7, RelationTag::Sibling),
            (5, 7, RelationTag::Child), // Duplicate direct/traversed sibling.
            (5, 8, RelationTag::Child), // No direct Sibling edge was ever added.
            (16, 8, RelationTag::Child), // Duplicate through another parent.
            (5, 10, RelationTag::Child), // Self must never become a sibling.
            (5, 17, RelationTag::Child), // A later-settled sibling is still living.
            (20, 10, RelationTag::Spouse), // Incoming-only kin is not outgoing spouse.
            (10, 1, RelationTag::Cousin), // Other kin is deliberately out of scope.
        ] {
            world.relations.insert(
                (PersonId(from), PersonId(to)),
                relation(0, RelTags::from_bits(tag.bit())),
            );
        }
        let mut sim = Sim::from_test_world(world);
        let mut control = sim.clone();
        let report = sim.run_until_stop_observed(1);
        assert_eq!(report.checksum, Some(control.step()));
        assert_eq!(sim.world(), control.world());
        let [summary] = report.story.own_death_summaries.as_slice() else {
            panic!("exactly one player death has one complete kin summary");
        };
        let [death] = report.player_lifecycle.as_slice() else {
            panic!("NPC deaths must not acquire player lifecycle facts");
        };
        assert_eq!(
            (summary.body, summary.death_event, summary.tick),
            (body, death.event, Tick(7))
        );
        let ids = |category: &[NativeDeathKinPerson]| {
            category
                .iter()
                .map(|entry| entry.person.0)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(&summary.spouse), [14]);
        assert_eq!(ids(&summary.living_children), [12]);
        assert_eq!(ids(&summary.living_grandchildren), [18, 19]);
        assert_eq!(ids(&summary.deceased_spouses), [3, 4]);
        assert_eq!(ids(&summary.deceased_parents), [5]);
        assert_eq!(ids(&summary.deceased_children), [2]);
        assert_eq!(ids(&summary.deceased_siblings), [7, 8]);
        assert_eq!(summary.deceased_spouses[0].relation, "spouse");
        assert_eq!(summary.deceased_spouses[1].relation, "former_spouse");
        for entry in &summary.deceased_spouses {
            let native = &sim.world().persons()[&entry.person];
            assert_eq!(entry.name, native.name.text(native.sex));
            assert_eq!(entry.sex, native.sex.as_str());
        }
        for (category, role) in [
            (&summary.spouse, "spouse"),
            (&summary.living_children, "child"),
            (&summary.living_grandchildren, "grandchild"),
            (&summary.deceased_parents, "parent"),
            (&summary.deceased_children, "child"),
            (&summary.deceased_siblings, "sibling"),
        ] {
            for entry in category {
                let native = &sim.world().persons()[&entry.person];
                assert_eq!(entry.name, native.name.text(native.sex));
                assert_eq!(entry.sex, native.sex.as_str());
                assert_eq!(entry.relation, role);
            }
        }
        // Classification is frozen before higher-ID deaths, not reconstructed at day end.
        assert!(matches!(
            sim.world().persons()[&PersonId(14)].life,
            Life::Dead { death: Tick(7) }
        ));
        assert!(matches!(
            sim.world().persons()[&PersonId(2)].life,
            Life::Dead { death: Tick(7) }
        ));
        let wire = serde_json::to_value(&report.story).unwrap();
        let wire_summary = &wire["ownDeathSummaries"][0];
        assert_eq!(wire_summary["body"], 10);
        assert_eq!(wire_summary["deathEvent"], death.event.0.to_string());
        assert_eq!(wire_summary["tick"], "7");
        assert_eq!(wire_summary.as_object().unwrap().len(), 10);
        for key in [
            "spouse",
            "livingChildren",
            "livingGrandchildren",
            "deceasedSpouses",
            "deceasedParents",
            "deceasedChildren",
            "deceasedSiblings",
        ] {
            assert!(wire_summary[key].is_array());
        }
        assert!(
            sim.run_until_stop_observed(0)
                .story
                .own_death_summaries
                .is_empty()
        );
        assert!(story_opening(sim.world()).own_death_summaries.is_empty());
    }

    #[test]
    fn own_death_seed1205_complete_observation_witness() {
        use crate::replay::{ReplayFile, verify};

        let source = ReplayFile::from_json_str(include_str!(
            "../../../fixtures/parity/seedP-playthrough.replay.json"
        ))
        .unwrap();
        assert_eq!(source.seed, 1205);
        assert_eq!(
            source
                .inputs
                .iter()
                .take(3)
                .map(|input| input.tick)
                .collect::<Vec<_>>(),
            [734, 2328, 3866]
        );
        let mut sim = Sim::new(1205, WorldConfig::try_new(50).unwrap()).unwrap();
        for input in source.inputs.iter().take(3) {
            sim.submit(Tick(input.tick), input.payload.into()).unwrap();
        }
        let opening = story_opening(sim.world());
        let mut batches = Vec::new();
        while sim.world().tick().0 < 5_373 {
            let remaining = u32::try_from(5_373 - sim.world().tick().0).unwrap();
            let report = sim.run_until_stop_observed(remaining);
            assert!(report.ran > 0);
            batches.push(report);
        }
        assert_eq!(sim.world().tick(), Tick(5_373));
        assert_eq!(sim.checksums(), &source.checksums[..5_373]);
        assert_eq!(
            sim.checksums().last().unwrap().to_hex_string(),
            "8a1b9da5de15bb91"
        );
        let summary_count: usize = batches
            .iter()
            .map(|batch| batch.story.own_death_summaries.len())
            .sum();
        assert_eq!(summary_count, 1);
        let death_batch = batches.last().unwrap();
        let summary = &death_batch.story.own_death_summaries[0];
        assert_eq!(
            (summary.death_event, summary.body, summary.tick),
            (EventId(2368), PersonId(10), Tick(5372))
        );
        assert!(death_batch.player_lifecycle.iter().any(|fact| {
            fact.event == summary.death_event
                && fact.body == summary.body
                && fact.tick == summary.tick
        }));
        let actor = death_batch
            .story
            .actors
            .iter()
            .find(|actor| actor.person == summary.body)
            .unwrap();
        assert_eq!(actor.name, "Nadine Bradley");
        assert_eq!(actor.sex, "female");
        assert_eq!(actor.origin, "native");
        assert_eq!(actor.age_at_death, Some(60));
        assert!(summary.deceased_spouses.iter().any(|relative| {
            relative.name == "Clifford Bradley"
                && relative.sex == "male"
                && relative.relation == "spouse"
        }));
        assert!(summary.spouse.iter().any(|relative| {
            relative.name == "Marvin Jenkins"
                && relative.sex == "male"
                && relative.relation == "spouse"
        }));
        let estate_events = death_batch
            .story
            .events
            .iter()
            .filter(|event| {
                event.caused_by.contains(&summary.death_event)
                    && matches!(event.kind.0, EventKind::Inheritance { .. })
            })
            .count();
        assert_eq!(
            estate_events, 2,
            "the admitted batch contains the whole estate settlement"
        );
        let funeral_events = death_batch
            .story
            .events
            .iter()
            .filter(|event| {
                event.tick == summary.tick
                    && matches!(event.kind.0, EventKind::Offering { ghost, .. } if ghost == summary.body)
            })
            .count();
        assert_eq!(
            funeral_events, 2,
            "the admitted batch contains completed funeral offerings"
        );
        // Contiguous cursors prove this is the whole admitted suffix, not the selected journal fixture.
        let mut event_end = opening.cursors.events.end;
        let mut chronicle_end = opening.cursors.chronicle.end;
        for batch in &batches {
            assert_eq!(batch.story.cursors.events.start, event_end);
            assert_eq!(batch.story.cursors.chronicle.start, chronicle_end);
            event_end = batch.story.cursors.events.end;
            chronicle_end = batch.story.cursors.chronicle.end;
            for event in &batch.story.events {
                assert_eq!(
                    event.kind.0,
                    sim.world().log().event(event.id).unwrap().kind
                );
            }
        }
        assert_eq!(event_end, sim.world().log().len());
        assert_eq!(
            chronicle_end,
            sim.world().narrator().chronicle.entries().len()
        );
        let replay = ReplayFile::from_sim(&sim).unwrap();
        assert_eq!(replay.version, 5);
        assert_eq!(replay.inputs, source.inputs[..3]);
        verify(&replay).unwrap(); // Closure observers still reproduce every canonical checksum.
        let replay_wire: serde_json::Value =
            serde_json::from_str(&replay.to_json_string().unwrap()).unwrap();
        assert!(replay_wire.get("ownDeathSummaries").is_none());
        assert!(
            sim.run_until_stop_observed(0)
                .story
                .own_death_summaries
                .is_empty()
        );
        assert!(story_opening(sim.world()).own_death_summaries.is_empty());
        println!(
            "OBITUARY_SEED1205_COMPLETE_WITNESS {}",
            json!({
                "seed": "1205", "config": {"opening_residents": 50},
                "completedTicks": "5373", "checksum": "8a1b9da5de15bb91",
                "inputs": &replay.inputs, "openingBatch": opening, "observedBatches": batches,
            })
        );
    }
}
