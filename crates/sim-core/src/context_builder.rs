//! The Context_Builder (design "Context_Builder", R15).
//!
//! Builds a decision [`FrozenContext`] for a node family from the live [`World`]:
//! the last 12 Events that list the subject as an actor, the subject, those Events'
//! actors and the subject's strongest Relations, every Relation between the selected
//! people, and the id mapping of OP-10. Every value is read from the World at the
//! current tick and stays inside the card ranges, so the existing
//! System_One_Mapping_v1, the card JSON reader and the output validator work unchanged.
//!
//! The builder only reads the World and only constructs `llm` values through their
//! public fields; nothing under `src/llm/` changes (R15.8).

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::events::Event as WorldEvent;
use crate::ids::{EventId, PersonId};
use crate::names::{FEMALE_FIRST, MALE_FIRST, SURNAMES};
use crate::world::Life;
use crate::world::World;

use crate::llm::{
    Event as CardEvent, EventId as CardEventId, Family, FrozenContext, OptionDef, OptionId,
    Person as CardPerson, PersonId as CardPersonId, Relation as CardRelation, Task, TaskSpec,
    Traits as CardTraits,
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
    /// The subject is dead; a decision node needs a Resident.
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

/// Builds a decision context for `subject` (design "Context_Builder" steps 1 to 7).
///
/// `options` must hold 2..=5 options with distinct IDs. `situation` is the node's fixed
/// template text; the caller keeps it at most 80 words (R15.3).
pub fn build_decision_context(
    world: &World,
    subject: PersonId,
    family: Family,
    options: Vec<OptionDef>,
    situation: String,
) -> Result<FrozenContext, BuildError> {
    // 1. The subject must be a Resident; the options must be 2..=5 and distinct.
    let Some(person) = world.persons().get(&subject) else {
        return Err(BuildError::UnknownSubject(subject));
    };
    if matches!(person.life, Life::Dead { .. }) {
        return Err(BuildError::DeadSubject(subject));
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

    // 2. The last 12 Events that list the subject as an actor, in ascending live ID.
    let mut chosen: Vec<&WorldEvent> = world
        .log()
        .events()
        .iter()
        .filter(|event| event.kind.actors().iter().any(|actor| actor == subject))
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
        .filter_map(|id| world.persons().get(&id))
        .map(|p| card_person(world, p))
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
        player_input: None,
        spec: TaskSpec::Decision { options },
    })
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
    let Some(person) = world.persons().get(&id) else {
        return String::from("Unknown");
    };
    let first_names: &[&str] = match person.sex {
        crate::values::Sex::Female => &FEMALE_FIRST,
        crate::values::Sex::Male => &MALE_FIRST,
    };
    let first = first_names
        .get(usize::from(person.name.first))
        .copied()
        .unwrap_or("Unknown");
    let surname = SURNAMES
        .get(usize::from(person.name.surname))
        .copied()
        .unwrap_or("Unknown");
    format!("{first} {surname}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;
    use crate::testing::{Mutation, apply};
    use crate::world::WorldConfig;

    fn world() -> World {
        World::new_with_params(1, WorldConfig::default(), Params::stress())
            .expect("the Opening_World builds")
    }

    fn first_open_debt(world: &World) -> EventId {
        *world.debts().keys().next().expect("an opening loan exists")
    }

    fn options(count: usize) -> Vec<OptionDef> {
        (0..count)
            .map(|i| option(&format!("opt_{i}"), "label"))
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
