//! Deaths, inheritance and debts at death (design "Deaths", R6, R7).
//!
//! Step 4 of the tick. Mortality is rolled for every Resident against the state at the
//! start of the step, then each death is settled in Person ID order: the `death` Event,
//! the waiting Soul, the estate (OP-2 A), the Debts the deceased owed or was owed
//! (OP-2 A) and the dead Person's non-kin Relations. Relations whose `from` is a living
//! Person and whose `to` is the deceased stay, with their affinity, trust and tags.
//!
//! The [`Life::Dead`] variant carries no balance, so a death settles the estate while
//! the balance still exists (the `Inheritance` and `Escheat` Money_Flows name the
//! deceased) and flips the Life to `Dead` at the end of the settlement. The resulting
//! state is exactly the one design "Deaths" specifies; only the order of the same-tick
//! writes inside one settlement differs.

use crate::economy::{Flow, flow};
use crate::events::{CausedBy, EventKind, EventTag, EventTags};
use crate::ids::{EventId, HouseholdId, PersonId, PropertyId};
use crate::rng::{StreamTag, below, draw};
use crate::values::RelationTag;
use crate::world::{Life, PropertyKind, SoulPlace, World};

/// The one mortality draw site of a Resident (keyed by the Person, `StreamTag::Mortality`).
const MORTALITY_ROLL: u64 = 0;

/// Rolls mortality for every Resident, then settles each death in Person ID order.
pub(crate) fn process_deaths(world: &mut World) {
    let mut dying: Vec<PersonId> = Vec::new();
    for person in world.persons.values() {
        if !matches!(person.life, Life::Alive { .. }) {
            continue;
        }
        let age = world.age_years(person);
        let ppm = world.params.effective_mortality_ppm(age);
        let roll = draw(
            world.seed,
            person.id.rng_key(),
            StreamTag::Mortality,
            world.tick,
            MORTALITY_ROLL,
        );
        if below(roll, 1_000_000) < u64::from(ppm) {
            dying.push(person.id);
        }
    }
    for deceased in dying {
        settle_death(world, deceased);
    }
}

/// Settles one death: `death` Event, waiting Soul, estate, Debts and Relations, then
/// `Life::Dead` and the Household removal (design "Deaths" steps 1 to 7).
fn settle_death(world: &mut World, deceased: PersonId) {
    let Some(person) = world.persons.get(&deceased) else {
        return;
    };
    let Life::Alive {
        household,
        money: estate,
        ..
    } = person.life
    else {
        return;
    };
    let soul = person.soul;
    let name = person.name;
    let death_tick = world.tick;

    // Step 2: the `death` Event. `Death` is an Afterlife_Event_Type, so the deceased may
    // be listed before the Life flips to `Dead`.
    let Ok(death) = world.append(
        EventKind::Death { person: deceased },
        CausedBy::default(),
        EventTags::empty(),
    ) else {
        // Unreachable: the actor is a known Person and `Death` is an afterlife kind.
        debug_assert!(false, "the death Event of {deceased:?} was refused");
        return;
    };

    // A dying mother's open Birth_Slots close in her death tick, with no birth (design
    // "Birth_Slots"; a claim on them is released in task 3.3).
    crate::underworld::slots::close_for_mother(world, deceased);
    // Step 4: the estate (OP-2 A), settled while the balance still exists.
    let heirs = heirs(world, deceased);
    settle_estate(world, deceased, &heirs, death, estate);
    // Steps 5 and 6: the Debts of the deceased (OP-2 A).
    settle_debts(world, deceased, &heirs, death);
    // Step 7: the dead Person's non-kin Relations go; living-to-dead Relations stay.
    remove_non_kin_relations(world, deceased);

    // Step 1: `Life::Dead` (no balance, household, mood or property) and the Household
    // removal when it lost its last member (R3.6).
    world.derived.living_names.remove(&name);
    if let Some(person) = world.persons.get_mut(&deceased) {
        person.life = Life::Dead { death: death_tick };
    }
    remove_household_if_empty(world, household);
    // Step 3: the Soul waits from the death tick (R6.3).
    world
        .souls
        .places
        .insert(soul, SoulPlace::Waiting { since: death_tick });
}

fn is_resident(world: &World, person: PersonId) -> bool {
    world
        .persons
        .get(&person)
        .is_some_and(|entry| matches!(entry.life, Life::Alive { .. }))
}

/// The heirs of `deceased` in heir order (OP-2 A): the first non-empty class among
/// living spouse and living children, living parents and living siblings, each class in
/// ascending Person ID order.
fn heirs(world: &World, deceased: PersonId) -> Vec<PersonId> {
    let mut spouse_and_children: Vec<PersonId> = Vec::new();
    let mut parents: Vec<PersonId> = Vec::new();
    let mut siblings: Vec<PersonId> = Vec::new();
    // `relations` is keyed `(from, to)`, so a scan in key order visits `deceased`'s
    // Relations in ascending Person ID order.
    for (&(from, to), relation) in &world.relations {
        if from != deceased || !is_resident(world, to) {
            continue;
        }
        let tags = relation.tags;
        if tags.contains(RelationTag::Spouse) || tags.contains(RelationTag::Child) {
            push_unique(&mut spouse_and_children, to);
        }
        if tags.contains(RelationTag::Parent) {
            push_unique(&mut parents, to);
        }
        if tags.contains(RelationTag::Sibling) {
            push_unique(&mut siblings, to);
        }
    }
    for class in [spouse_and_children, parents, siblings] {
        if !class.is_empty() {
            return class;
        }
    }
    Vec::new()
}

fn push_unique(list: &mut Vec<PersonId>, id: PersonId) {
    if !list.contains(&id) {
        list.push(id);
    }
}

/// The card event tag that records a property kind moving (design "Deaths" step 4).
fn kind_tag(kind: PropertyKind) -> EventTag {
    match kind {
        PropertyKind::Land => EventTag::Land,
        PropertyKind::House => EventTag::House,
        PropertyKind::Shop => EventTag::Shop,
        PropertyKind::Heirloom => EventTag::Heirloom,
    }
}

/// Passes the whole estate: money split equally with the remainder one dollar each to
/// the first heirs, property items round-robin in property-ID order, one `inheritance`
/// Event per heir who received anything. With no heir the money leaves the World through
/// `Escheat` and the property items are removed.
fn settle_estate(
    world: &mut World,
    deceased: PersonId,
    heirs: &[PersonId],
    death: EventId,
    estate: u64,
) {
    let properties: Vec<PropertyId> = world
        .properties
        .iter()
        .filter(|(_, property)| property.owner == deceased)
        .map(|(&id, _)| id)
        .collect();
    if heirs.is_empty() {
        if estate > 0 {
            flow(world, Flow::Escheat { from: deceased }, estate);
        }
        world
            .properties
            .retain(|_, property| property.owner != deceased);
        return;
    }

    let count = u64::try_from(heirs.len()).unwrap_or(u64::MAX);
    let share = estate.checked_div(count).unwrap_or(0);
    let remainder = estate.checked_rem(count).unwrap_or(0);
    let mut cash: Vec<u64> = Vec::with_capacity(heirs.len());
    for position in 0..heirs.len() {
        let extra = if u64::try_from(position).unwrap_or(u64::MAX) < remainder {
            1
        } else {
            0
        };
        cash.push(share.saturating_add(extra));
    }
    let mut kinds: Vec<Vec<PropertyKind>> = vec![Vec::new(); heirs.len()];
    for (position, property_id) in properties.iter().enumerate() {
        let heir_index = position.checked_rem(heirs.len()).unwrap_or(0);
        let Some(&heir) = heirs.get(heir_index) else {
            continue;
        };
        let Some(property) = world.properties.get_mut(property_id) else {
            continue;
        };
        property.owner = heir;
        let kind = property.kind;
        if let Some(received) = kinds.get_mut(heir_index) {
            received.push(kind);
        }
    }

    for (position, &heir) in heirs.iter().enumerate() {
        let inherited = cash.get(position).copied().unwrap_or(0);
        if inherited > 0 {
            flow(
                world,
                Flow::Inheritance {
                    from: deceased,
                    to: heir,
                },
                inherited,
            );
        }
        let received = kinds.get(position).map_or(&[][..], Vec::as_slice);
        if inherited == 0 && received.is_empty() {
            continue;
        }
        let mut magnitude = inherited;
        let mut tags = EventTags::empty();
        if inherited > 0 {
            tags.insert(EventTag::Cash);
        }
        for kind in received {
            magnitude = magnitude.saturating_add(kind.value());
            tags.insert(kind_tag(*kind));
        }
        let _ = world.append(
            EventKind::Inheritance {
                deceased,
                heir,
                amount: magnitude,
            },
            CausedBy::new(vec![death]),
            tags,
        );
    }
}

/// Settles the Debts of the deceased (OP-2 A), each citing the `loan` and the `death`.
///
/// A Debt the deceased owed moves to the first heir, or is forgiven when there is no
/// heir or the first heir is the creditor. A Debt the deceased was owed is forgiven
/// (the card format has no claim-transfer Event).
fn settle_debts(world: &mut World, deceased: PersonId, heirs: &[PersonId], death: EventId) {
    let owed: Vec<EventId> = world
        .debts
        .iter()
        .filter(|(_, debt)| debt.debtor == deceased)
        .map(|(&loan, _)| loan)
        .collect();
    for loan in owed {
        let Some(debt) = world.debts.get(&loan).cloned() else {
            continue;
        };
        let cause = CausedBy::new(vec![loan, death]);
        let transfer_to = heirs.first().copied().filter(|heir| *heir != debt.creditor);
        match transfer_to {
            Some(heir) => {
                let appended = world.append(
                    EventKind::DebtTransfer {
                        from: deceased,
                        to: heir,
                        amount: debt.open,
                    },
                    cause,
                    EventTags::empty(),
                );
                if appended.is_ok()
                    && let Some(open) = world.debts.get_mut(&loan)
                {
                    open.debtor = heir;
                }
            }
            None => {
                let appended = world.append(
                    EventKind::DebtForgiven {
                        creditor: debt.creditor,
                        debtor: deceased,
                        amount: debt.open,
                    },
                    cause,
                    EventTags::empty(),
                );
                if appended.is_ok() {
                    world.debts.remove(&loan);
                }
            }
        }
    }

    let owing: Vec<EventId> = world
        .debts
        .iter()
        .filter(|(_, debt)| debt.creditor == deceased)
        .map(|(&loan, _)| loan)
        .collect();
    for loan in owing {
        let Some(debt) = world.debts.get(&loan).cloned() else {
            continue;
        };
        let appended = world.append(
            EventKind::DebtForgiven {
                creditor: deceased,
                debtor: debt.debtor,
                amount: debt.open,
            },
            CausedBy::new(vec![loan, death]),
            EventTags::empty(),
        );
        if appended.is_ok() {
            world.debts.remove(&loan);
        }
    }
}

/// Removes every Relation whose `from` is `deceased` and that carries no Kinship_Tag
/// (design "Deaths" step 7). Relations toward the deceased, kin included, are kept.
fn remove_non_kin_relations(world: &mut World, deceased: PersonId) {
    let removed: Vec<(PersonId, PersonId)> = world
        .relations
        .iter()
        .filter(|entry| {
            let (from, _) = *entry.0;
            from == deceased && !entry.1.tags.has_kinship()
        })
        .map(|(&key, _)| key)
        .collect();
    for key in removed {
        world.relations.remove(&key);
    }
}

/// Removes `household` when it has no member left (R3.6).
fn remove_household_if_empty(world: &mut World, household: HouseholdId) {
    if world.household_members(household).is_empty() {
        world.households.remove(&household);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Tick;
    use crate::invariants::total_money;
    use crate::values::{RelTags, Score};
    use crate::world::{Debt, Property, Relation, World, WorldConfig};

    fn world() -> World {
        World::new(7, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    /// Leaves only `keep` alive, so a settlement sees exactly the intended estate.
    fn isolate(world: &mut World, keep: &[PersonId]) {
        for person in world.persons.values_mut() {
            if !keep.contains(&person.id) {
                person.life = Life::Dead { death: Tick(0) };
            }
        }
        let empty: Vec<HouseholdId> = world
            .households
            .keys()
            .copied()
            .filter(|id| world.household_members(*id).is_empty())
            .collect();
        for id in empty {
            world.households.remove(&id);
        }
    }

    fn drop_relations_from(world: &mut World, from: PersonId) {
        world.relations.retain(|&(f, _), _| f != from);
    }

    fn drop_properties(world: &mut World, owner: PersonId) {
        world
            .properties
            .retain(|_, property| property.owner != owner);
    }

    fn money(world: &World, id: PersonId) -> u64 {
        match world.persons[&id].life {
            Life::Alive { money, .. } => money,
            Life::Dead { .. } => 0,
        }
    }

    fn set_money(world: &mut World, id: PersonId, value: u64) {
        if let Some(person) = world.persons.get_mut(&id)
            && let Life::Alive { money, .. } = &mut person.life
        {
            *money = value;
        }
    }

    fn link(world: &mut World, from: PersonId, to: PersonId, tag: RelationTag) {
        let mut tags = RelTags::empty();
        tags.insert(tag);
        world.relations.insert(
            (from, to),
            Relation {
                affinity: Score::clamped(0),
                trust: Score::clamped(0),
                tags,
            },
        );
    }

    fn inheritance_amounts(world: &World, deceased: PersonId) -> Vec<(PersonId, u64)> {
        world
            .log
            .events()
            .iter()
            .filter_map(|event| match event.kind {
                EventKind::Inheritance {
                    deceased: who,
                    heir,
                    amount,
                } if who == deceased => Some((heir, amount)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn an_estate_of_ten_dollars_splits_four_three_three() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        let heirs = [ids[1], ids[2], ids[3]];
        isolate(&mut world, &[deceased, heirs[0], heirs[1], heirs[2]]);
        drop_relations_from(&mut world, deceased);
        drop_properties(&mut world, deceased);
        set_money(&mut world, deceased, 10);
        let before: Vec<u64> = heirs.iter().map(|&id| money(&world, id)).collect();
        for heir in heirs {
            link(&mut world, deceased, heir, RelationTag::Child);
        }

        settle_death(&mut world, deceased);

        assert_eq!(money(&world, heirs[0]), before[0].saturating_add(4));
        assert_eq!(money(&world, heirs[1]), before[1].saturating_add(3));
        assert_eq!(money(&world, heirs[2]), before[2].saturating_add(3));
        assert_eq!(
            inheritance_amounts(&world, deceased),
            vec![(heirs[0], 4), (heirs[1], 3), (heirs[2], 3)]
        );
    }

    #[test]
    fn an_estate_without_heirs_escheats_and_removes_the_property() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        isolate(&mut world, &[deceased]);
        drop_relations_from(&mut world, deceased);
        set_money(&mut world, deceased, 500);
        if !world
            .properties
            .values()
            .any(|property| property.owner == deceased)
        {
            let id = PropertyId(
                world
                    .property_ids
                    .next()
                    .expect("property ids are not exhausted"),
            );
            world.properties.insert(
                id,
                Property {
                    id,
                    kind: PropertyKind::House,
                    owner: deceased,
                },
            );
        }
        assert!(
            world
                .properties
                .values()
                .any(|property| property.owner == deceased),
            "the estate must hold property to remove"
        );
        let sinks_before = world.flows.sinks;

        settle_death(&mut world, deceased);

        assert!(
            world
                .properties
                .values()
                .all(|property| property.owner != deceased),
            "property of a heirless estate is removed"
        );
        assert_eq!(world.flows.sinks, sinks_before.saturating_add(500));
        assert_eq!(total_money(&world), 0, "the estate left the World");
        assert!(world.households.is_empty(), "the emptied household goes");
    }

    #[test]
    fn a_debt_to_a_first_heir_who_is_the_creditor_is_forgiven() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        let creditor = ids[1];
        isolate(&mut world, &[deceased, creditor]);
        drop_relations_from(&mut world, deceased);
        drop_properties(&mut world, deceased);
        set_money(&mut world, deceased, 0);
        // The creditor is the first heir, so transferring would owe a Debt to oneself.
        link(&mut world, deceased, creditor, RelationTag::Child);
        let loan = world
            .append(
                EventKind::Loan {
                    lender: creditor,
                    borrower: deceased,
                    amount: 100,
                    due: Tick(50),
                },
                CausedBy::default(),
                EventTags::empty(),
            )
            .expect("the loan Event is accepted");
        world.debts.insert(
            loan,
            Debt {
                creditor,
                debtor: deceased,
                principal: 100,
                open: 100,
                due: Tick(50),
            },
        );

        settle_death(&mut world, deceased);

        assert!(!world.debts.contains_key(&loan), "the Debt is closed");
        assert!(
            world.log.events().iter().any(|event| matches!(
                event.kind,
                EventKind::DebtForgiven {
                    creditor: c,
                    debtor: d,
                    amount: 100,
                } if c == creditor && d == deceased
            ) && event.caused_by.as_slice().contains(&loan)),
            "a debt_forgiven Event citing the loan"
        );
    }

    #[test]
    fn a_debt_transfers_to_the_first_heir_and_cites_loan_and_death() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        let creditor = ids[1];
        let heir = ids[2];
        isolate(&mut world, &[deceased, creditor, heir]);
        drop_relations_from(&mut world, deceased);
        drop_properties(&mut world, deceased);
        set_money(&mut world, deceased, 0);
        link(&mut world, deceased, heir, RelationTag::Child);
        let loan = world
            .append(
                EventKind::Loan {
                    lender: creditor,
                    borrower: deceased,
                    amount: 300,
                    due: Tick(50),
                },
                CausedBy::default(),
                EventTags::empty(),
            )
            .expect("the loan Event is accepted");
        world.debts.insert(
            loan,
            Debt {
                creditor,
                debtor: deceased,
                principal: 300,
                open: 300,
                due: Tick(50),
            },
        );

        settle_death(&mut world, deceased);

        assert_eq!(
            world.debts[&loan].debtor, heir,
            "the Debt moved to the heir"
        );
        assert_eq!(world.debts[&loan].open, 300, "the open amount is unchanged");
        let death = world
            .log
            .events()
            .iter()
            .find(|event| matches!(event.kind, EventKind::Death { person } if person == deceased))
            .map(|event| event.id)
            .expect("the death Event exists");
        assert!(
            world.log.events().iter().any(|event| matches!(
                event.kind,
                EventKind::DebtTransfer { from, to, amount: 300 } if from == deceased && to == heir
            ) && event.caused_by.as_slice() == [loan, death]),
            "a debt_transfer citing the loan and the death"
        );
    }

    #[test]
    fn a_creditors_death_forgives_the_debt() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        let debtor = ids[1];
        isolate(&mut world, &[deceased, debtor]);
        drop_relations_from(&mut world, deceased);
        drop_properties(&mut world, deceased);
        set_money(&mut world, deceased, 0);
        let loan = world
            .append(
                EventKind::Loan {
                    lender: deceased,
                    borrower: debtor,
                    amount: 250,
                    due: Tick(50),
                },
                CausedBy::default(),
                EventTags::empty(),
            )
            .expect("the loan Event is accepted");
        world.debts.insert(
            loan,
            Debt {
                creditor: deceased,
                debtor,
                principal: 250,
                open: 250,
                due: Tick(50),
            },
        );

        settle_death(&mut world, deceased);

        assert!(
            !world.debts.contains_key(&loan),
            "a creditor's death closes the Debt"
        );
        assert!(
            world.log.events().iter().any(|event| matches!(
                event.kind,
                EventKind::DebtForgiven { creditor: c, debtor: d, amount: 250 }
                    if c == deceased && d == debtor
            ) && event.caused_by.as_slice().contains(&loan)),
            "a debt_forgiven Event names the dead creditor"
        );
    }

    #[test]
    fn relations_at_death_keep_living_feelings_and_keep_kin() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        let friend = ids[1];
        let rival = ids[2];
        let parent = ids[3];
        isolate(&mut world, &[deceased, friend, rival, parent]);
        drop_relations_from(&mut world, deceased);
        drop_properties(&mut world, deceased);
        set_money(&mut world, deceased, 0);

        let mut friend_tags = RelTags::empty();
        friend_tags.insert(RelationTag::Friend);
        let friend_relation = Relation {
            affinity: Score::clamped(70),
            trust: Score::clamped(55),
            tags: friend_tags,
        };
        world
            .relations
            .insert((friend, deceased), friend_relation.clone());
        let mut rival_tags = RelTags::empty();
        rival_tags.insert(RelationTag::Rival);
        let rival_relation = Relation {
            affinity: Score::clamped(-80),
            trust: Score::clamped(-60),
            tags: rival_tags,
        };
        world
            .relations
            .insert((rival, deceased), rival_relation.clone());
        // The deceased's own non-kin Relation and a kin Relation.
        link(&mut world, deceased, friend, RelationTag::Neighbor);
        link(&mut world, deceased, parent, RelationTag::Parent);

        settle_death(&mut world, deceased);

        assert_eq!(
            world.relations.get(&(friend, deceased)),
            Some(&friend_relation),
            "a living friend's feelings toward the dead are kept as they are"
        );
        assert_eq!(
            world.relations.get(&(rival, deceased)),
            Some(&rival_relation),
            "a living rival's feelings toward the dead are kept as they are"
        );
        assert!(
            !world.relations.contains_key(&(deceased, friend)),
            "the dead Person's non-kin Relations are removed"
        );
        assert!(
            world.relations.contains_key(&(deceased, parent)),
            "kin Relations of the dead Person are kept"
        );
        assert!(
            world.relations.contains_key(&(parent, deceased)),
            "kin Relations toward the dead Person are kept"
        );
    }

    #[test]
    fn a_resident_aged_120_always_dies() {
        let mut world = world();
        let ids = residents(&world);
        let old = ids[0];
        let someone = ids[1];
        if let Some(person) = world.persons.get_mut(&old) {
            person.birth_day = 0i64.saturating_sub(i64::from(120u16).saturating_mul(365));
        }
        set_money(&mut world, old, 0);
        drop_properties(&mut world, old);
        drop_relations_from(&mut world, old);
        world.relations.remove(&(someone, old));
        debug_assert_eq!(world.age_years(&world.persons[&old]), 120);

        process_deaths(&mut world);

        assert_eq!(
            world.persons[&old].life,
            Life::Dead { death: Tick(0) },
            "age 120 is certain death (R6.2)"
        );
        assert!(
            world
                .log
                .events()
                .iter()
                .any(|event| matches!(event.kind, EventKind::Death { person } if person == old)),
            "one death Event"
        );
    }

    #[test]
    fn every_death_leaves_exactly_one_death_event_and_a_waiting_soul() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        isolate(&mut world, &[deceased, ids[1]]);
        drop_relations_from(&mut world, deceased);
        drop_properties(&mut world, deceased);
        set_money(&mut world, deceased, 0);
        let soul = world.persons[&deceased].soul;
        let Life::Alive { household, .. } = world.persons[&deceased].life else {
            panic!("the subject is a Resident");
        };

        settle_death(&mut world, deceased);

        assert_eq!(
            world.souls.places[&soul],
            SoulPlace::Waiting { since: Tick(0) },
            "the Soul waits from the death tick"
        );
        let deaths = world
            .log
            .events()
            .iter()
            .filter(|event| matches!(event.kind, EventKind::Death { person } if person == deceased))
            .count();
        assert_eq!(deaths, 1, "exactly one death Event");
        assert!(
            !world.household_members(household).contains(&deceased),
            "the dead Person is in no Household"
        );
    }

    #[test]
    fn the_money_of_the_estate_is_fully_accounted_for() {
        let mut world = world();
        let ids = residents(&world);
        let deceased = ids[0];
        let heirs = [ids[1], ids[2]];
        isolate(&mut world, &[deceased, heirs[0], heirs[1]]);
        drop_relations_from(&mut world, deceased);
        drop_properties(&mut world, deceased);
        set_money(&mut world, deceased, 7);
        link(&mut world, deceased, heirs[0], RelationTag::Child);
        link(&mut world, deceased, heirs[1], RelationTag::Child);
        let total_before = total_money(&world);
        let sinks_before = world.flows.sinks;
        let sources = world.flows.sources;

        settle_death(&mut world, deceased);

        let sink_delta = world.flows.sinks.saturating_sub(sinks_before);
        assert_eq!(
            total_money(&world).saturating_add(sink_delta),
            total_before,
            "every dollar of the estate moved to an heir or left through Escheat"
        );
        assert_eq!(world.flows.sources, sources);
    }
}
