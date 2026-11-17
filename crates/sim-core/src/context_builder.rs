//! The Context_Builder (design "Contexts and LS-R15", R15).
//!
//! Builds a decision [`FrozenContext`] for a node family from the live [`World`]:
//! the last 12 Events that list any Person of the node's focus set, the subject, those
//! Events' actors and the subject's strongest Relations, every Relation between the
//! selected people, and the id mapping of OP-10. The subject may be a Resident or the
//! Magistrate, which renders with its fixed card values (R15.12). Every value is read
//! from the World at the current tick and stays inside the card ranges, so the existing
//! System_One_Mapping_v1, the card JSON reader and the output validator work unchanged.
//!
//! The builder only reads the World and only constructs `llm` values through their
//! public fields; nothing under `src/llm/` changes (R15.8).

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::events::Event as WorldEvent;
use crate::ids::{EventId, PersonId};
use crate::world::Life;
use crate::world::World;

use crate::llm::{
    Event as CardEvent, EventId as CardEventId, Family, FrozenContext, OptionDef, OptionId,
    Person as CardPerson, PersonId as CardPersonId, PlayerInput, Relation as CardRelation, Task,
    TaskSpec, Traits as CardTraits,
};

/// The most Events a context carries, the last ones by live Event ID.
pub const MAX_EVENTS: usize = 12;
/// The most extra people added from the subject's Relations.
pub const MAX_RELATED_PEOPLE: usize = 6;
/// Smallest and largest option count a decision context accepts (R15, card format).
pub const OPTION_MIN: usize = 2;
/// Largest option count a decision context accepts.
pub const OPTION_MAX: usize = 5;

/// Why a context cannot be built (design "Context_Builder" step 1).
#[derive(Clone, Eq, PartialEq, Debug)]
pub enum BuildError {
    /// The subject is not a Person of this World.
    UnknownSubject(PersonId),
    /// The subject is dead; a decision node needs a living Resident or the Magistrate.
    DeadSubject(PersonId),
    /// No open Debt is keyed by this `loan` Event.
    UnknownLoan(EventId),
    /// The option list has fewer than [`OPTION_MIN`] or more than [`OPTION_MAX`] options.
    OptionCount(usize),
    /// The same option ID appears more than once.
    DuplicateOption(OptionId),
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownSubject(id) => write!(f, "subject person {} does not exist", id.0),
            Self::DeadSubject(id) => write!(f, "subject person {} is dead", id.0),
            Self::UnknownLoan(id) => write!(f, "no open debt is keyed by event e{}", id.0),
            Self::OptionCount(n) => write!(
                f,
                "a decision context needs {OPTION_MIN}..={OPTION_MAX} options, got {n}"
            ),
            Self::DuplicateOption(id) => write!(f, "duplicate option id {:?}", id.as_str()),
        }
    }
}

impl std::error::Error for BuildError {}

/// Builds a decision context for `subject` (design "Contexts and LS-R15").
///
/// `subject` may be a living Resident or the Magistrate (R15.12); a dead Resident is
/// refused with [`BuildError::DeadSubject`]. `focus` is the set of Persons whose Events
/// the context shows: the last [`MAX_EVENTS`] Events that list any of them (OP-D5 A).
/// `options` must hold 2..=5 options with distinct IDs. `situation` is the node's fixed
/// template text; the caller keeps it at most 80 words (R15.3).
pub fn build_node_context(
    world: &World,
    subject: PersonId,
    focus: &[PersonId],
    family: Family,
    options: Vec<OptionDef>,
    situation: String,
    player_input: Option<PlayerInput>,
) -> Result<FrozenContext, BuildError> {
    // 1. The subject must be a living Resident or the Magistrate; the options must be
    //    2..=5 and distinct.
    match world.persons().get(&subject) {
        Some(person) if matches!(person.life, Life::Dead { .. }) => {
            return Err(BuildError::DeadSubject(subject));
        }
        Some(_) => {}
        None if subject == world.magistrate().id => {}
        None => return Err(BuildError::UnknownSubject(subject)),
    }
    if !(OPTION_MIN..=OPTION_MAX).contains(&options.len()) {
        return Err(BuildError::OptionCount(options.len()));
    }
    let mut option_ids: BTreeSet<&str> = BTreeSet::new();
    for option in &options {
        if !option_ids.insert(option.id.as_str()) {
            return Err(BuildError::DuplicateOption(option.id.clone()));
        }
    }

    // 2. The last 12 Events that list any Person of `focus`, in ascending live ID.
    let mut chosen: Vec<&WorldEvent> = world
        .log()
        .events()
        .iter()
        .filter(|event| {
            event
                .kind
                .actors()
                .iter()
                .any(|actor| focus.contains(&actor))
        })
        .collect();
    let first = chosen.len().saturating_sub(MAX_EVENTS);
    chosen.drain(..first);

    // 3. The subject, every actor of the chosen Events, then up to 6 more people from
    //    the subject's Relations (both directions): highest |affinity| first, ties by
    //    lower Person ID. `BTreeSet` keeps the final list in ascending ID order.
    let mut people: BTreeSet<PersonId> = BTreeSet::new();
    people.insert(subject);
    for event in &chosen {
        for actor in event.kind.actors().iter() {
            people.insert(actor);
        }
    }
    for related in ranked_relations(world, subject)
        .into_iter()
        .take(MAX_RELATED_PEOPLE)
    {
        people.insert(related);
    }

    // 4. Every World Relation whose both ends are in `people`, in `(from, to)` order.
    let relations: Vec<CardRelation> = world
        .relations()
        .iter()
        .filter(|((from, to), _)| people.contains(from) && people.contains(to))
        .map(|(&(from, to), relation)| CardRelation {
            from: card_person_id(from),
            to: card_person_id(to),
            affinity: i64::from(relation.affinity.get()),
            trust: i64::from(relation.trust.get()),
            tags: relation.tags.names().map(str::to_owned).collect(),
        })
        .collect();

    // 5. Context-local Event IDs `e1..=eN` by ascending live ID; `caused_by` entries
    //    pointing outside the context are dropped.
    let event_index: BTreeMap<EventId, usize> = chosen
        .iter()
        .enumerate()
        .map(|(index, event)| (event.id, index.saturating_add(1)))
        .collect();
    let card_events: Vec<CardEvent> = chosen
        .iter()
        .map(|event| card_event(event, &event_index))
        .collect();

    // 6 and 7. Values from the World and the fixed header fields.
    let card_people: Vec<CardPerson> = people
        .into_iter()
        .filter_map(|id| card_person_any(world, id))
        .collect();

    Ok(FrozenContext {
        task: Task::Decision,
        family,
        tick: world_tick(world),
        subject: Some(card_person_id(subject)),
        people: card_people,
        relations,
        events: card_events,
        situation,
        player_input,
        spec: TaskSpec::Decision { options },
    })
}

/// The life-sim entry point: [`build_node_context`] with the subject as the only Person
/// whose Events the context shows, so its output is unchanged.
pub fn build_decision_context(
    world: &World,
    subject: PersonId,
    family: Family,
    options: Vec<OptionDef>,
    situation: String,
) -> Result<FrozenContext, BuildError> {
    build_node_context(world, subject, &[subject], family, options, situation, None)
}

/// The test node of OP-10: the debtor of the open Debt keyed by `loan`, options
/// `repay`, `stall` and `refuse`, and the fixed situation template.
pub fn debt_repayment_node(world: &World, loan: EventId) -> Result<FrozenContext, BuildError> {
    let Some(debt) = world.debts().get(&loan) else {
        return Err(BuildError::UnknownLoan(loan));
    };
    let debtor = debt.debtor;
    let creditor = debt.creditor;
    let debtor_name = person_name(world, debtor);
    let creditor_name = person_name(world, creditor);
    let situation = format!(
        "{debtor_name} owes {creditor_name} {} dollars from a loan of {} dollars, \
due on day {}. Today is day {}.",
        debt.open,
        debt.principal,
        debt.due.0,
        world.tick().0
    );
    let options = vec![
        option("repay", "Pay the next instalment"),
        option("stall", "Ask for more time"),
        option("refuse", "Refuse to pay"),
    ];
    build_decision_context(world, debtor, Family::DebtRepayment, options, situation)
}

fn option(id: &str, label: &str) -> OptionDef {
    // Both IDs are static literals matching `^[a-z][a-z_]*$`.
    let id = OptionId::new(id).unwrap_or_else(|| OptionId::new("option").expect("valid literal"));
    OptionDef {
        id,
        label: label.to_owned(),
    }
}

/// The people on either end of the subject's Relations, ordered by descending
/// `|affinity|` and then ascending Person ID, each Person once (the strongest direction
/// wins).
fn ranked_relations(world: &World, subject: PersonId) -> Vec<PersonId> {
    let mut strongest: BTreeMap<PersonId, i16> = BTreeMap::new();
    for (&(from, to), relation) in world.relations() {
        let other = if from == subject {
            to
        } else if to == subject {
            from
        } else {
            continue;
        };
        if other == subject {
            continue;
        }
        let magnitude = i16::from(relation.affinity.get()).unsigned_abs();
        let magnitude = i16::try_from(magnitude).unwrap_or(i16::MAX);
        match strongest.get(&other) {
            Some(&previous) if previous >= magnitude => {}
            _ => {
                strongest.insert(other, magnitude);
            }
        }
    }
    let mut ranked: Vec<(PersonId, i16)> = strongest.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked.into_iter().map(|(id, _)| id).collect()
}

fn card_person(world: &World, person: &crate::world::Person) -> CardPerson {
    CardPerson {
        id: card_person_id(person.id),
        name: person_name(world, person.id),
        age: i64::from(world.age_years(person)),
        sex: person.sex.as_str().to_owned(),
        alive: matches!(person.life, Life::Alive { .. }),
        origin: person.origin.as_str().to_owned(),
        traits: CardTraits {
            greed: i64::from(person.traits.greed.get()),
            loyalty: i64::from(person.traits.loyalty.get()),
            pride: i64::from(person.traits.pride.get()),
            warmth: i64::from(person.traits.warmth.get()),
            temper: i64::from(person.traits.temper.get()),
            vindictiveness: i64::from(person.traits.vindictiveness.get()),
            piety: i64::from(person.traits.piety.get()),
        },
        wealth: i64::try_from(world.wealth(person.id)).unwrap_or(i64::MAX),
        soul_id: format!("S-{:04}", person.soul.0),
    }
}

/// Renders any Person a context may name: a Resident or dead Person from the World, or
/// the Magistrate with its fixed card values (R15.12): origin `official`, alive, the
/// nominal age, wealth 0 and the Soul ID text `S-0000`.
fn card_person_any(world: &World, id: PersonId) -> Option<CardPerson> {
    if let Some(person) = world.persons().get(&id) {
        return Some(card_person(world, person));
    }
    let magistrate = world.magistrate();
    if id != magistrate.id {
        return None;
    }
    Some(CardPerson {
        id: card_person_id(id),
        name: crate::underworld::magistrate::FULL_NAME.to_owned(),
        age: i64::from(crate::underworld::magistrate::NOMINAL_AGE),
        sex: crate::underworld::magistrate::SEX.as_str().to_owned(),
        alive: true,
        origin: "official".to_owned(),
        traits: CardTraits {
            greed: i64::from(magistrate.traits.greed.get()),
            loyalty: i64::from(magistrate.traits.loyalty.get()),
            pride: i64::from(magistrate.traits.pride.get()),
            warmth: i64::from(magistrate.traits.warmth.get()),
            temper: i64::from(magistrate.traits.temper.get()),
            vindictiveness: i64::from(magistrate.traits.vindictiveness.get()),
            piety: i64::from(magistrate.traits.piety.get()),
        },
        wealth: 0,
        soul_id: crate::underworld::magistrate::SOUL_ID_TEXT.to_owned(),
    })
}

fn card_event(event: &WorldEvent, index: &BTreeMap<EventId, usize>) -> CardEvent {
    CardEvent {
        id: card_event_id(index.get(&event.id).copied().unwrap_or(0)),
        tick: i64::try_from(event.tick.0).unwrap_or(i64::MAX),
        kind: event.kind.card_type().to_owned(),
        actors: event.kind.actors().iter().map(card_person_id).collect(),
        magnitude: i64::try_from(event.kind.magnitude()).unwrap_or(i64::MAX),
        due_tick: event
            .kind
            .due_tick()
            .map(|due| i64::try_from(due.0).unwrap_or(i64::MAX)),
        caused_by: event
            .caused_by
            .iter()
            .filter_map(|cause| index.get(&cause).copied())
            .map(card_event_id)
            .collect(),
        tags: event.tags.names().map(str::to_owned).collect(),
    }
}

/// A live Person ID as a card person ID (always at least 1, OP-10).
fn card_person_id(id: PersonId) -> CardPersonId {
    CardPersonId(i64::try_from(id.0).unwrap_or(i64::MAX))
}

/// A context-local Event ID. The builder only passes indices in `1..=MAX_EVENTS`; 0 is
/// mapped to `e1` so the ID is always inside the card pattern.
fn card_event_id(index: usize) -> CardEventId {
    let number = index.max(1);
    CardEventId::new(&format!("e{number}"))
        .unwrap_or_else(|| CardEventId::new("e1").expect("e1 matches the card pattern"))
}

fn world_tick(world: &World) -> i64 {
    i64::try_from(world.tick().0).unwrap_or(i64::MAX)
}

/// The full name of a Person, resolved through the sex's first-name list.
fn person_name(world: &World, id: PersonId) -> String {
    world
        .persons()
        .get(&id)
        .map(|person| person.name.text(person.sex))
        .unwrap_or_else(|| String::from("Unknown"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{CausedBy, EventKind, EventTags};
    use crate::params::Params;
    use crate::testing::{Mutation, apply};
    use crate::values::{Intensity, SocialKind};
    use crate::world::WorldConfig;

    fn world() -> World {
        World::new_with_params(1, WorldConfig::default(), Params::stress())
            .expect("the Opening_World builds")
    }

    fn first_open_debt(world: &World) -> EventId {
        *world.debts().keys().next().expect("an opening loan exists")
    }

    fn options(count: usize) -> Vec<OptionDef> {
        // Option IDs match `^[a-z][a-z_]*$`, so no digits.
        const NAMES: [&str; 6] = ["one", "two", "three", "four", "five", "six"];
        (0..count)
            .map(|i| option(NAMES.get(i).copied().unwrap_or("seven"), "label"))
            .collect()
    }

    fn live_subject(world: &World) -> PersonId {
        world
            .persons()
            .values()
            .find(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .expect("a Resident exists")
    }

    #[test]
    fn a_dead_subject_is_refused() {
        let mut world = world();
        let subject = live_subject(&world);
        let selector = subject.0.saturating_sub(1);
        assert!(apply(
            &mut world,
            Mutation::PersonField {
                person: selector,
                part: 11
            }
        ));
        assert_eq!(
            build_decision_context(
                &world,
                subject,
                Family::DebtRepayment,
                options(3),
                "situation".to_owned()
            ),
            Err(BuildError::DeadSubject(subject))
        );
        assert_eq!(
            build_node_context(
                &world,
                subject,
                &[subject],
                Family::DebtRepayment,
                options(3),
                "situation".to_owned(),
                None
            ),
            Err(BuildError::DeadSubject(subject))
        );
    }

    /// Pinned JSON of the life-sim `debt_repayment_node` context (seed 1, `Params::stress`,
    /// the first open Debt). `build_decision_context` must stay byte-identical to the
    /// life-sim output (design "Contexts and LS-R15", task 4.2).
    const PINNED_DEBT_CONTEXT_JSON: &str = r#"{"events":[{"actors":[22,2],"caused_by":[],"id":"e1","magnitude":68,"tags":[],"tick":0,"type":"theft"},{"actors":[10,22],"caused_by":[],"due_tick":407,"id":"e2","magnitude":1584,"tags":["cash"],"tick":0,"type":"loan"}],"family":"debt_repayment","options":[{"id":"repay","label":"Pay the next instalment"},{"id":"stall","label":"Ask for more time"},{"id":"refuse","label":"Refuse to pay"}],"people":[{"age":36,"alive":true,"id":2,"name":"Irene Carlson","origin":"native","sex":"female","soul_id":"S-0002","traits":{"greed":0,"loyalty":1,"piety":0,"pride":-3,"temper":2,"vindictiveness":-1,"warmth":2},"wealth":30103},{"age":28,"alive":true,"id":10,"name":"Edgar Rowe","origin":"native","sex":"male","soul_id":"S-0010","traits":{"greed":3,"loyalty":-1,"piety":1,"pride":3,"temper":2,"vindictiveness":-2,"warmth":-3},"wealth":74670},{"age":29,"alive":true,"id":19,"name":"Meredith Hale","origin":"native","sex":"female","soul_id":"S-0019","traits":{"greed":2,"loyalty":3,"piety":-2,"pride":-3,"temper":1,"vindictiveness":-2,"warmth":-2},"wealth":63688},{"age":5,"alive":true,"id":21,"name":"Bernard Hale","origin":"native","sex":"male","soul_id":"S-0021","traits":{"greed":1,"loyalty":0,"piety":0,"pride":3,"temper":2,"vindictiveness":-2,"warmth":2},"wealth":0},{"age":90,"alive":true,"id":22,"name":"Amelia Hale","origin":"native","sex":"female","soul_id":"S-0022","traits":{"greed":-3,"loyalty":-2,"piety":-2,"pride":2,"temper":2,"vindictiveness":1,"warmth":-2},"wealth":5573}],"player_input":null,"relations":[{"affinity":-60,"from":2,"tags":["rival"],"to":22,"trust":-50},{"affinity":50,"from":19,"tags":["child"],"to":21,"trust":50},{"affinity":50,"from":19,"tags":["parent"],"to":22,"trust":50},{"affinity":50,"from":21,"tags":["parent"],"to":19,"trust":50},{"affinity":40,"from":21,"tags":["grandparent"],"to":22,"trust":40},{"affinity":50,"from":22,"tags":["child"],"to":19,"trust":50},{"affinity":40,"from":22,"tags":["grandchild"],"to":21,"trust":40}],"situation":"Amelia Hale owes Edgar Rowe 1584 dollars from a loan of 1584 dollars, due on day 407. Today is day 0.","subject":22,"task":"decision","tick":0}"#;

    #[test]
    fn the_debt_context_json_is_byte_identical_to_the_life_sim_output() {
        let world = world();
        let loan = first_open_debt(&world);
        let context = debt_repayment_node(&world, loan).expect("the context builds");
        let json = crate::llm::json::write(&crate::llm::api::frozen_context_to_json(&context));
        assert_eq!(json, PINNED_DEBT_CONTEXT_JSON);
    }

    #[test]
    fn a_magistrate_subject_context_round_trips_and_renders_as_official() {
        let world = world();
        let magistrate = world.magistrate().id;
        let context = build_node_context(
            &world,
            magistrate,
            &[magistrate],
            Family::MagistrateRuling,
            options(3),
            "situation".to_owned(),
            None,
        )
        .expect("the context builds");
        assert_eq!(
            context.subject.map(|s| s.0),
            Some(i64::try_from(magistrate.0).unwrap_or(i64::MAX))
        );
        let official = context
            .people
            .iter()
            .find(|p| p.id.0 == i64::try_from(magistrate.0).unwrap_or(i64::MAX))
            .expect("R15.12: the Magistrate is in people");
        assert_eq!(official.name, "Orrin Vell");
        assert_eq!(official.origin, "official");
        assert!(official.alive);
        assert_eq!(official.age, 600);
        assert_eq!(official.wealth, 0);
        assert_eq!(official.soul_id, "S-0000");
        assert_eq!(official.sex, "male");
        let json = crate::llm::api::frozen_context_to_json(&context);
        assert_eq!(
            crate::llm::card::frozen_context_from_json(json),
            Ok(context),
            "the context must survive the JSON round trip"
        );
    }

    #[test]
    fn the_magistrate_renders_only_where_the_focus_names_it() {
        let world = world();
        let magistrate = world.magistrate().id;
        let subject = live_subject(&world);
        let context = build_node_context(
            &world,
            subject,
            &[subject],
            Family::DebtRepayment,
            options(3),
            "situation".to_owned(),
            None,
        )
        .expect("the context builds");
        assert!(
            context
                .people
                .iter()
                .all(|p| p.id.0 != i64::try_from(magistrate.0).unwrap_or(i64::MAX)),
            "the Magistrate is in no context its focus does not name"
        );
    }

    #[test]
    fn the_focus_set_selects_the_events_the_context_shows() {
        // Three Residents that no opening Event names, so the window holds exactly the
        // Events the test appends.
        let mut world = world();
        let quiet: Vec<PersonId> = world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .filter(|person| {
                !world
                    .log()
                    .events()
                    .iter()
                    .any(|event| event.kind.actors().iter().any(|actor| actor == person.id))
            })
            .map(|person| person.id)
            .take(3)
            .collect();
        let [subject, other, third] = quiet[..] else {
            panic!("the Opening_World leaves at least three Residents event-free");
        };
        world
            .append(
                EventKind::Social {
                    kind: SocialKind::Help,
                    doer: other,
                    target: third,
                    intensity: Intensity::new(40).expect("40 is in range"),
                },
                CausedBy::default(),
                EventTags::empty(),
            )
            .expect("the Event appends");

        let alone = build_node_context(
            &world,
            subject,
            &[subject],
            Family::DebtRepayment,
            options(3),
            "situation".to_owned(),
            None,
        )
        .expect("the context builds");
        assert!(
            alone.events.is_empty(),
            "a focus that does not name the actor shows none of its Events"
        );

        let with_other = build_node_context(
            &world,
            subject,
            &[subject, other],
            Family::DebtRepayment,
            options(3),
            "situation".to_owned(),
            None,
        )
        .expect("the context builds");
        assert_eq!(with_other.events.len(), 1, "OP-D5 A: the focus set adds it");
        assert_eq!(with_other.events[0].kind, "help");
        assert!(
            with_other
                .people
                .iter()
                .any(|p| p.id == card_person_id(third)),
            "the Event's actors join the people"
        );
    }

    #[test]
    fn an_unknown_subject_is_refused() {
        let world = world();
        let missing = PersonId(9_999_999);
        assert_eq!(
            build_decision_context(
                &world,
                missing,
                Family::DebtRepayment,
                options(3),
                "situation".to_owned()
            ),
            Err(BuildError::UnknownSubject(missing))
        );
    }

    #[test]
    fn an_unknown_loan_is_refused() {
        let world = world();
        let missing = EventId(9_999_999);
        assert_eq!(
            debt_repayment_node(&world, missing),
            Err(BuildError::UnknownLoan(missing))
        );
    }

    #[test]
    fn zero_one_or_six_options_are_refused() {
        let world = world();
        let subject = live_subject(&world);
        for count in [0usize, 1, 6] {
            assert_eq!(
                build_decision_context(
                    &world,
                    subject,
                    Family::DebtRepayment,
                    options(count),
                    "situation".to_owned()
                ),
                Err(BuildError::OptionCount(count)),
                "{count} options"
            );
        }
    }

    #[test]
    fn repeated_option_ids_are_refused() {
        let world = world();
        let subject = live_subject(&world);
        let repeated = vec![option("repay", "a"), option("repay", "b")];
        assert_eq!(
            build_decision_context(
                &world,
                subject,
                Family::DebtRepayment,
                repeated,
                "situation".to_owned()
            ),
            Err(BuildError::DuplicateOption(
                OptionId::new("repay").expect("valid literal")
            ))
        );
    }

    #[test]
    fn a_dead_creditor_appears_with_alive_false_and_no_wealth() {
        let mut world = world();
        let loan = first_open_debt(&world);
        let creditor = world.debts().get(&loan).expect("the debt exists").creditor;
        let selector = creditor.0.saturating_sub(1);
        assert!(apply(
            &mut world,
            Mutation::PersonField {
                person: selector,
                part: 11
            }
        ));

        let context = debt_repayment_node(&world, loan).expect("the context builds");
        let dead = context
            .people
            .iter()
            .find(|p| p.id.0 == i64::try_from(creditor.0).unwrap_or(i64::MAX))
            .expect("the creditor is an actor of the loan Event");
        assert!(!dead.alive);
        assert_eq!(dead.wealth, 0);
        let person = world.persons().get(&creditor).expect("the Person exists");
        assert_eq!(dead.age, i64::from(world.age_years(person)));
    }

    #[test]
    fn the_situation_has_at_most_eighty_words() {
        let world = world();
        let loan = first_open_debt(&world);
        let context = debt_repayment_node(&world, loan).expect("the context builds");
        let words = context.situation.split_whitespace().count();
        assert!(words <= 80, "{} words", context.situation);
        assert!(!context.situation.is_empty());
    }

    #[test]
    fn the_debt_node_has_the_designed_family_and_options() {
        let world = world();
        let loan = first_open_debt(&world);
        let context = debt_repayment_node(&world, loan).expect("the context builds");
        assert_eq!(context.family, Family::DebtRepayment);
        assert_eq!(context.task, Task::Decision);
        assert_eq!(
            context.subject.map(|s| s.0),
            Some(
                i64::try_from(world.debts().get(&loan).expect("the debt exists").debtor.0)
                    .unwrap_or(i64::MAX)
            )
        );
        let TaskSpec::Decision { options } = &context.spec else {
            panic!("a decision context");
        };
        let ids: Vec<&str> = options.iter().map(|o| o.id.as_str()).collect();
        assert_eq!(ids, ["repay", "stall", "refuse"]);
        assert!(context.player_input.is_none());
    }

    #[test]
    fn people_are_in_ascending_id_order_and_events_use_local_ids() {
        let world = world();
        let loan = first_open_debt(&world);
        let context = debt_repayment_node(&world, loan).expect("the context builds");
        let ids: Vec<i64> = context.people.iter().map(|p| p.id.0).collect();
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]), "{ids:?}");
        assert!(ids.iter().all(|id| *id >= 1));
        for (index, event) in context.events.iter().enumerate() {
            let expected = index.saturating_add(1);
            assert_eq!(event.id.as_str(), format!("e{expected}"));
            assert!(event.tick >= 0);
            assert!(
                event
                    .actors
                    .iter()
                    .all(|actor| context.people.iter().any(|p| p.id == *actor))
            );
            let earlier: Vec<&str> = context.events[..index]
                .iter()
                .map(|e| e.id.as_str())
                .collect();
            assert!(
                event
                    .caused_by
                    .iter()
                    .all(|c| earlier.contains(&c.as_str()))
            );
        }
        // Soul IDs are `S-` plus exactly four digits.
        for person in &context.people {
            let digits = person.soul_id.strip_prefix("S-").unwrap_or("");
            assert_eq!(digits.len(), 4, "{}", person.soul_id);
            assert!(digits.bytes().all(|b| b.is_ascii_digit()));
        }
    }
}
