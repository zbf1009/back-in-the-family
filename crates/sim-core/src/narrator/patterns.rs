//! Five Narrator patterns over this tick's Events, relations and exact clock triggers.

use std::collections::BTreeSet;

use crate::events::{Event, EventKind};
use crate::ids::{PersonId, Tick};
use crate::world::{Life, World};

use super::options::{self, PatternContext};
use super::{Candidate, Crossing, PlayerFamily, StakeUnit, Stakes};

/// Build each family in its declared order; selection sorts candidates afterwards.
pub(crate) fn collect(
    world: &World,
    body: PersonId,
    life_start: Tick,
    events: &[&Event],
    crossings: &[Crossing],
) -> Vec<Candidate> {
    let mut out = Vec::new();
    family_deaths(world, body, events, &mut out);
    inheritances(world, body, events, &mut out);
    due_debts(world, body, &mut out);
    feuds(world, body, events, crossings, &mut out);
    life_stage(world, body, life_start, &mut out);
    out
}

fn alive(world: &World, id: PersonId) -> bool {
    world
        .persons
        .get(&id)
        .is_some_and(|p| matches!(p.life, Life::Alive { .. }))
}

fn affinity(world: &World, from: PersonId, to: PersonId) -> i8 {
    world
        .relations
        .get(&(from, to))
        .map_or(0, |r| r.affinity.get())
}

fn outgoing_kin(world: &World, from: PersonId, to: PersonId) -> bool {
    world
        .relations
        .get(&(from, to))
        .is_some_and(|r| r.tags.has_kinship())
}

fn family_deaths(world: &World, body: PersonId, events: &[&Event], out: &mut Vec<Candidate>) {
    for event in events {
        let EventKind::Death { person: deceased } = event.kind else {
            continue;
        };
        if event.tick != world.tick || !outgoing_kin(world, body, deceased) {
            continue;
        }
        // Highest affinity to the deceased wins; without any mourner, flowers
        // go to the oldest living kin of the chooser instead of comfort.
        let mourner = world
            .persons
            .values()
            .filter(|person| person.id != body && alive(world, person.id))
            .max_by_key(|person| {
                (
                    affinity(world, person.id, deceased),
                    std::cmp::Reverse(person.id),
                )
            })
            .map(|person| person.id);
        let no_mourner = mourner.is_none();
        let mourner = mourner.or_else(|| {
            world
                .persons
                .values()
                .filter(|person| {
                    person.id != body
                        && alive(world, person.id)
                        && outgoing_kin(world, body, person.id)
                })
                .min_by_key(|person| (person.birth_day, person.id))
                .map(|person| person.id)
        });
        let Some(mourner) = mourner else { continue };
        let stakes = Stakes {
            who: vec![deceased, mourner],
            amount: 0,
            unit: StakeUnit::Affinity,
            by: Tick(world.tick.0.saturating_add(1)),
        };
        if let Some(candidate) = options::build(
            world,
            PlayerFamily::FamilyDeath,
            body,
            Some(event.id),
            event.id.0,
            stakes,
            PatternContext::FamilyDeath {
                mourner,
                no_mourner,
            },
        ) {
            out.push(candidate);
        }
    }
}

fn inheritances(world: &World, body: PersonId, events: &[&Event], out: &mut Vec<Candidate>) {
    for event in events {
        let EventKind::Inheritance {
            deceased,
            heir,
            amount,
        } = event.kind
        else {
            continue;
        };
        if event.tick != world.tick || heir != body {
            continue;
        }
        let mut co_heirs: Vec<PersonId> = events
            .iter()
            .filter_map(|other| match other.kind {
                EventKind::Inheritance {
                    deceased: d, heir, ..
                } if other.tick == world.tick
                    && d == deceased
                    && heir != body
                    && alive(world, heir) =>
                {
                    Some(heir)
                }
                _ => None,
            })
            .collect();
        co_heirs.sort_unstable();
        co_heirs.dedup();
        co_heirs.truncate(2);
        // BTreeMap's first matching loan is the oldest open debt. Task 3.1 adds
        // the Intro_Debt exclusion after it creates the designation state.
        let pay_loan = world
            .debts
            .iter()
            .find(|(_, debt)| debt.debtor == body && debt.open > 0)
            .map(|(&loan, debt)| (loan, debt.open.min(amount)));
        let mut who = vec![deceased];
        who.extend(co_heirs.iter().copied());
        let stakes = Stakes {
            who,
            amount: i64::try_from(amount).unwrap_or(i64::MAX),
            unit: StakeUnit::Money,
            by: Tick(world.tick.0.saturating_add(1)),
        };
        if let Some(candidate) = options::build(
            world,
            PlayerFamily::Inheritance,
            body,
            Some(event.id),
            event.id.0,
            stakes,
            PatternContext::Inheritance { co_heirs, pay_loan },
        ) {
            out.push(candidate);
        }
    }
}

fn due_debts(world: &World, body: PersonId, out: &mut Vec<Candidate>) {
    if !alive(world, body) {
        return;
    }
    for (&loan, debt) in &world.debts {
        if debt.due.0.checked_sub(world.params.debt_due_lead) != Some(world.tick.0)
            || (debt.debtor != body && debt.creditor != body)
        {
            continue;
        }
        let other = if debt.debtor == body {
            debt.creditor
        } else {
            debt.debtor
        };
        if !alive(world, other) {
            continue;
        }
        let stakes = Stakes {
            who: vec![other],
            amount: i64::try_from(debt.open).unwrap_or(i64::MAX),
            unit: StakeUnit::Money,
            by: debt.due,
        };
        if let Some(candidate) = options::build(
            world,
            PlayerFamily::DebtDue,
            body,
            None,
            loan.0,
            stakes,
            PatternContext::DebtDue {
                loan,
                other,
                debtor: debt.debtor == body,
            },
        ) {
            out.push(candidate);
        }
    }
}

fn feuds(
    world: &World,
    body: PersonId,
    events: &[&Event],
    crossings: &[Crossing],
    out: &mut Vec<Candidate>,
) {
    let mut seen = BTreeSet::new();
    for crossing in crossings {
        if (crossing.from != body && crossing.to != body)
            || !events
                .iter()
                .any(|event| event.id == crossing.event && event.tick == world.tick)
            || !seen.insert(crossing.event)
        {
            continue;
        }
        let other = if crossing.from == body {
            crossing.to
        } else {
            crossing.from
        };
        if !alive(world, other) {
            continue;
        }
        let stakes = Stakes {
            who: vec![other],
            amount: i64::from(affinity(world, body, other)),
            unit: StakeUnit::Affinity,
            by: Tick(world.tick.0.saturating_add(1)),
        };
        if let Some(candidate) = options::build(
            world,
            PlayerFamily::Feud,
            body,
            Some(crossing.event),
            crossing.event.0,
            stakes,
            PatternContext::Feud { other },
        ) {
            out.push(candidate);
        }
    }
}

fn age_days(world: &World, body: PersonId, tick: Tick) -> Option<u64> {
    let person = world.persons.get(&body)?;
    let day = i64::try_from(tick.0).ok()?;
    u64::try_from(day.checked_sub(person.birth_day)?).ok()
}

fn life_stage(world: &World, body: PersonId, life_start: Tick, out: &mut Vec<Candidate>) {
    let (Some(age), Some(start_age)) = (
        age_days(world, body, world.tick),
        age_days(world, body, life_start),
    ) else {
        return;
    };
    if !alive(world, body) {
        return;
    }
    let Some(stage) = world
        .params
        .life_stage_ages
        .into_iter()
        .find(|stage| *stage == age && *stage > start_age)
    else {
        return;
    };
    let stakes = Stakes {
        who: vec![body],
        amount: 0,
        unit: StakeUnit::TraitPoints,
        by: Tick(world.tick.0.saturating_add(1)),
    };
    if let Some(candidate) = options::build(
        world,
        PlayerFamily::LifeStage,
        body,
        None,
        body.0,
        stakes,
        PatternContext::LifeStage { age: stage },
    ) {
        out.push(candidate);
    }
}
