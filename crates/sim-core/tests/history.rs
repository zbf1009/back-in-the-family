//! Property tests for history: preservation (Property 3), death settlement
//! (Property 4), births and arrivals (Property 5), debts (Property 6) and Mood
//! (Property 7).

mod life_gen;

use std::collections::{BTreeMap, BTreeSet};

use life_gen::*;
use proptest::prelude::*;
use sim_core::events::{EventKind, EventTag, mood_delta};
use sim_core::ids::{EventId, PersonId, SoulId};
use sim_core::values::{Mood, RelationTag, Sex};
use sim_core::world::{Life, SoulPlace, World};

fn is_resident(world: &World, person: PersonId) -> bool {
    world
        .persons()
        .get(&person)
        .is_some_and(|p| matches!(p.life, Life::Alive { .. }))
}

fn is_dead(world: &World, person: PersonId) -> bool {
    world
        .persons()
        .get(&person)
        .is_some_and(|p| matches!(p.life, Life::Dead { .. }))
}

/// The parents of `person`, from the `parent` tags on its outgoing Relations.
fn parents(world: &World, person: PersonId) -> Vec<PersonId> {
    world
        .relations()
        .iter()
        .filter(|((from, _), _)| *from == person)
        .filter(|(_, relation)| relation.tags.contains(RelationTag::Parent))
        .map(|((_, to), _)| *to)
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 3: History is preserved across ticks.
    #[test]
    fn history_is_preserved_across_ticks(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        for tick in 0..TICKS {
            let before = sim.world().clone();
            sim.step();
            let after = sim.world();
            let tick_error = |message: String| format!("seed {} tick {tick}: {message}", scenario.seed);
            prop_assert_eq!(after.tick().0, before.tick().0 + 1);

            // Persons: same identity fields, and the dead stay dead with the same tick.
            for (&id, old) in before.persons() {
                let new = after
                    .persons()
                    .get(&id)
                    .unwrap_or_else(|| panic!("{}", tick_error(format!("person {} vanished", id.0))));
                prop_assert_eq!(new.name, old.name);
                prop_assert_eq!(new.birth_day, old.birth_day);
                prop_assert_eq!(new.sex, old.sex);
                prop_assert_eq!(new.origin, old.origin);
                prop_assert_eq!(&new.traits, &old.traits);
                prop_assert_eq!(new.soul, old.soul);
                match (&old.life, &new.life) {
                    (Life::Dead { death: before }, Life::Dead { death: after }) => {
                        prop_assert_eq!(before, after);
                    }
                    (Life::Dead { .. }, Life::Alive { .. }) => {
                        return Err(TestCaseError::fail(tick_error(format!(
                            "person {} rose from the dead",
                            id.0
                        ))));
                    }
                    (Life::Alive { .. }, _) => {}
                }
            }

            // The log before the tick is an unchanged prefix of the log after it.
            let prefix_end = before.log().len();
            prop_assert_eq!(
                after.log().events().get(..prefix_end),
                Some(before.log().events())
            );
            for (index, event) in after.log().events().iter().enumerate().skip(prefix_end) {
                prop_assert_eq!(event.id.0, u64::try_from(index).unwrap() + 1);
            }

            // New IDs only grow: every new Person, Household, Property and Event gets an
            // ID above every ID that existed before the tick.
            let max_person = before.persons().keys().next_back().copied();
            for &id in after.persons().keys() {
                if !before.persons().contains_key(&id) {
                    prop_assert!(max_person.is_none_or(|max| id > max));
                }
            }
            let max_household = before.households().keys().next_back().copied();
            for &id in after.households().keys() {
                if !before.households().contains_key(&id) {
                    prop_assert!(max_household.is_none_or(|max| id > max));
                }
            }
            let max_property = before.properties().keys().next_back().copied();
            for &id in after.properties().keys() {
                if !before.properties().contains_key(&id) {
                    prop_assert!(max_property.is_none_or(|max| id > max));
                }
            }

            // Souls: same set of Soul IDs, same Player_Soul.
            let before_souls: BTreeSet<_> = before.souls().places.keys().copied().collect();
            let after_souls: BTreeSet<_> = after.souls().places.keys().copied().collect();
            prop_assert_eq!(&before_souls, &after_souls);
            prop_assert_eq!(before.souls().player, after.souls().player);

            // No `spouse` tag disappears.
            for (&(from, to), relation) in before.relations() {
                if relation.tags.contains(RelationTag::Spouse) {
                    let new = after.relations().get(&(from, to)).ok_or_else(|| {
                        TestCaseError::fail(tick_error(format!(
                            "spouse relation {} -> {} vanished",
                            from.0, to.0
                        )))
                    })?;
                    prop_assert!(new.tags.contains(RelationTag::Spouse));
                }
            }

            // Relations whose `from` was already dead never change.
            for (&(from, to), relation) in before.relations() {
                if is_dead(&before, from) {
                    prop_assert_eq!(after.relations().get(&(from, to)), Some(relation));
                }
            }

            // A Relation may disappear only when its `from` died in this tick and it
            // carries no Kinship_Tag (the death step's non-kin removal).
            for (&(from, to), relation) in before.relations() {
                if !after.relations().contains_key(&(from, to)) {
                    let died_this_tick = is_resident(&before, from) && is_dead(after, from);
                    prop_assert!(
                        died_this_tick && !relation.tags.has_kinship(),
                        "{}",
                        tick_error(format!(
                            "relation {} -> {} vanished without a death of its holder",
                            from.0, to.0
                        ))
                    );
                }
            }

            // Every Relation from a Resident to a Person who died in this tick is kept.
            for (&dead, old) in before.persons() {
                if !(matches!(old.life, Life::Alive { .. }) && is_dead(after, dead)) {
                    continue;
                }
                for &(from, to) in before.relations().keys() {
                    if to == dead && is_resident(after, from) {
                        prop_assert!(
                            after.relations().contains_key(&(from, to)),
                            "{}",
                            tick_error(format!(
                                "relation {} -> {} was dropped at the death",
                                from.0, to.0
                            ))
                        );
                    }
                }
            }

            // A waiting Player_Soul keeps waiting with the same `since` (R20.1).
            if let Some(SoulPlace::Waiting { since }) =
                before.souls().places.get(&before.souls().player)
            {
                prop_assert_eq!(
                    after.souls().places.get(&after.souls().player),
                    Some(&SoulPlace::Waiting { since: *since })
                );
            }
        }
    }

    // Feature: life-sim, Property 4: Every death is settled in its own tick.
    #[test]
    fn every_death_is_settled_in_its_own_tick(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        for tick in 0..TICKS {
            let before = sim.world().clone();
            let log_start = before.log().len();
            sim.step();
            let after = sim.world();
            let today = before.tick();
            let tail = events_since(after, log_start);
            let tick_error = |message: String| format!("seed {} tick {tick}: {message}", scenario.seed);

            // Every Person who died in this tick, in Person ID order.
            let died: Vec<PersonId> = before
                .persons()
                .values()
                .filter(|person| matches!(person.life, Life::Alive { .. }))
                .filter(|person| {
                    matches!(
                        after.persons().get(&person.id).map(|n| &n.life),
                        Some(Life::Dead { death }) if *death == today
                    )
                })
                .map(|person| person.id)
                .collect();
            let death_events: Vec<(sim_core::ids::EventId, PersonId)> = tail
                .iter()
                .filter_map(|event| match &event.kind {
                    EventKind::Death { person } => Some((event.id, *person)),
                    _ => None,
                })
                .collect();
            prop_assert_eq!(
                death_events.len(),
                died.len(),
                "{}",
                tick_error(format!(
                    "{} deaths but {} death events",
                    died.len(),
                    death_events.len()
                ))
            );
            for (_, person) in &death_events {
                prop_assert!(died.contains(person));
            }
            let newcomers = new_persons(&before, after);

            for &dead in &died {
                let death_id = death_events
                    .iter()
                    .find(|(_, person)| *person == dead)
                    .map(|(id, _)| *id)
                    .ok_or_else(|| {
                        TestCaseError::fail(tick_error(format!(
                            "person {} died without a death event",
                            dead.0
                        )))
                    })?;

                // R6.3: the body is gone (one Life value). The Soul is set to waiting
                // since today; births run later in the same tick, so a Soul with the
                // fewest waiting days may be taken again before the tick ends — then
                // its place must be a body born in this tick after this death.
                assert!(matches!(
                    after.persons()[&dead].life,
                    Life::Dead { death } if death == today
                ));
                let soul = before.persons()[&dead].soul;
                let place = after
                    .souls()
                    .places
                    .get(&soul)
                    .copied()
                    .ok_or_else(|| {
                        TestCaseError::fail(tick_error(format!(
                            "soul {} of the deceased {} has no place",
                            soul.0, dead.0
                        )))
                    })?;
                let placed = match place {
                    SoulPlace::Waiting { since } => since == today,
                    SoulPlace::Body(person) => {
                        newcomers.contains(&person)
                            && tail.iter().any(|event| {
                                event.id.0 > death_id.0
                                    && matches!(&event.kind, EventKind::Birth { person: p } if *p == person)
                            })
                    }
                };
                prop_assert!(
                    placed,
                    "{}",
                    tick_error(format!(
                        "soul {} of {} is at {place:?} instead of waiting since {today:?}",
                        soul.0, dead.0
                    ))
                );

                // The estate is fully accounted for by inheritance Events and (when
                // there is no heir) Escheat. An inheritance received earlier in this
                // same tick is part of the estate and is added here, so chained deaths
                // keep the equality.
                let start_money = balance(&before, dead);
                let received: u64 = tail
                    .iter()
                    .filter(|event| event.id.0 < death_id.0)
                    .filter_map(|event| match &event.kind {
                        EventKind::Inheritance { heir, amount, .. } if *heir == dead => {
                            Some(*amount)
                        }
                        _ => None,
                    })
                    .sum();
                let own_property: u64 = before
                    .properties()
                    .values()
                    .filter(|property| property.owner == dead)
                    .map(|property| property.kind.value())
                    .sum();
                let inheritance: Vec<(&sim_core::events::Event, PersonId, u64)> = tail
                    .iter()
                    .filter_map(|event| match &event.kind {
                        EventKind::Inheritance {
                            deceased, heir, amount, ..
                        } if *deceased == dead => Some((event, *heir, *amount)),
                        _ => None,
                    })
                    .collect();
                let heirs: BTreeSet<PersonId> =
                    inheritance.iter().map(|(_, heir, _)| *heir).collect();
                prop_assert_eq!(
                    heirs.len(),
                    inheritance.len(),
                    "{}",
                    tick_error(format!(
                        "person {} has more than one inheritance event per heir",
                        dead.0
                    ))
                );
                let actual: u64 = inheritance.iter().map(|(_, _, amount)| *amount).sum();
                for (event, heir, amount) in &inheritance {
                    prop_assert!(
                        event.caused_by.iter().any(|cause| cause == death_id),
                        "{}",
                        tick_error(format!(
                            "inheritance {} does not cite death {}",
                            event.id.0, death_id.0
                        ))
                    );
                    prop_assert!(*amount >= 1);
                    prop_assert!(before.persons().contains_key(heir));
                }
                if heirs.is_empty() {
                    prop_assert_eq!(actual, 0);
                    prop_assert!(
                        !after
                            .properties()
                            .values()
                            .any(|property| property.owner == dead),
                        "{}",
                        tick_error(format!("dead person {} still owns property", dead.0))
                    );
                    // Escheat plus the tick's upkeep is at least the cash estate.
                    prop_assert!(
                        after.last_flows().sinks >= start_money,
                        "{}",
                        tick_error(format!(
                            "estate of {} ({start_money}) left no sink",
                            dead.0
                        ))
                    );
                } else {
                    prop_assert_eq!(
                        actual,
                        start_money + received + own_property,
                        "{}",
                        tick_error(format!("estate of {} is not fully accounted for", dead.0))
                    );
                }

                // R7.2: each Debt touching the deceased is transferred or forgiven by
                // exactly one Event citing both the loan and this death. A Debt another
                // death settled earlier in the same tick is already closed and skipped.
                for (&loan, debt) in before.debts() {
                    if debt.debtor != dead && debt.creditor != dead {
                        continue;
                    }
                    let mine: Vec<&sim_core::events::Event> = tail
                        .iter()
                        .filter(|event| {
                            matches!(
                                event.kind,
                                EventKind::DebtTransfer { .. } | EventKind::DebtForgiven { .. }
                            ) && event.caused_by.iter().any(|cause| cause == loan)
                                && event.caused_by.iter().any(|cause| cause == death_id)
                        })
                        .collect();
                    if mine.is_empty() {
                        let settled_elsewhere = tail.iter().any(|event| {
                            matches!(
                                event.kind,
                                EventKind::DebtTransfer { .. } | EventKind::DebtForgiven { .. }
                            ) && event.caused_by.iter().any(|cause| cause == loan)
                        });
                        prop_assert!(
                            settled_elsewhere,
                            "{}",
                            tick_error(format!(
                                "debt {loan:?} of the deceased {} was not settled",
                                dead.0
                            ))
                        );
                        continue;
                    }
                    prop_assert_eq!(
                        mine.len(),
                        1,
                        "{}",
                        tick_error(format!("debt {loan:?} settled more than once at one death"))
                    );
                    match &mine[0].kind {
                        EventKind::DebtTransfer {
                            from,
                            to,
                            amount,
                        } => {
                            prop_assert_eq!(*from, dead);
                            prop_assert_eq!(debt.debtor, dead);
                            prop_assert_eq!(*amount, debt.open);
                            // A later death in the same tick may settle the Debt again;
                            // then that death's iteration checks the final state.
                            let settled_later = tail.iter().any(|event| {
                                event.id.0 > mine[0].id.0
                                    && event.caused_by.iter().any(|cause| cause == loan)
                            });
                            if !settled_later {
                                let moved = after.debts().get(&loan).ok_or_else(|| {
                                    TestCaseError::fail(tick_error(format!(
                                        "transferred debt {loan:?} disappeared"
                                    )))
                                })?;
                                prop_assert_eq!(moved.debtor, *to);
                            }
                        }
                        EventKind::DebtForgiven { amount, .. } => {
                            prop_assert_eq!(*amount, debt.open);
                            prop_assert!(!after.debts().contains_key(&loan));
                        }
                        _ => unreachable!(),
                    }
                }
            }
        }
    }

    // Feature: life-sim, Property 5: Births and arrivals use waiting Souls correctly.
    #[test]
    fn births_and_arrivals_use_waiting_souls_correctly(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        for tick in 0..TICKS {
            let before = sim.world().clone();
            let log_start = before.log().len();
            sim.step();
            let after = sim.world();
            let today = before.tick();
            let tail = events_since(after, log_start);
            let tick_error = |message: String| format!("seed {} tick {tick}: {message}", scenario.seed);

            let births: Vec<(EventId, PersonId)> = tail
                .iter()
                .filter_map(|event| match &event.kind {
                    EventKind::Birth { person } => Some((event.id, *person)),
                    _ => None,
                })
                .collect();
            let arrivals: Vec<(EventId, PersonId)> = tail
                .iter()
                .filter_map(|event| match &event.kind {
                    EventKind::Possession { person, .. } | EventKind::Rebuild { person, .. } => {
                        Some((event.id, *person))
                    }
                    _ => None,
                })
                .collect();
            let newcomers = new_persons(&before, after);
            for &id in &newcomers {
                let born = births.iter().any(|(_, person)| *person == id);
                let arrived = arrivals.iter().any(|(_, person)| *person == id);
                prop_assert!(
                    born ^ arrived,
                    "{}",
                    tick_error(format!(
                        "new person {} has {} birth and {} arrival events",
                        id.0,
                        usize::from(born),
                        usize::from(arrived)
                    ))
                );
            }

            // The Souls available to births, in take order: Souls waiting at the start
            // of the tick (except the Player_Soul and the ones released in step 3),
            // sorted by longest wait with ties by lower Soul ID, then the Souls freed by
            // this tick's deaths (all since today, so ordered by Soul ID).
            let player = before.souls().player;
            let released: BTreeSet<SoulId> = arrivals
                .iter()
                .map(|(_, person)| after.persons()[person].soul)
                .collect();
            let mut eligible: Vec<(sim_core::ids::Tick, SoulId)> = waiting_souls(&before)
                .into_iter()
                .filter(|(soul, _)| *soul != player && !released.contains(soul))
                .map(|(soul, since)| (since, soul))
                .collect();
            let mut freed: Vec<SoulId> = before
                .persons()
                .values()
                .filter(|person| matches!(person.life, Life::Alive { .. }))
                .filter(|person| is_dead(after, person.id))
                .map(|person| person.soul)
                .filter(|soul| *soul != player && !released.contains(soul))
                .collect();
            freed.sort();
            eligible.extend(freed.into_iter().map(|soul| (today, soul)));
            eligible.sort();

            for (index, (_, person)) in births.iter().enumerate() {
                let newborn = &after.persons()[person];
                prop_assert_eq!(newborn.origin, sim_core::values::Origin::Native);
                prop_assert_eq!(
                    newborn.birth_day,
                    i64::try_from(today.0).unwrap(),
                    "{}",
                    tick_error(format!("newborn {} has the wrong birth day", person.0))
                );
                let expected_soul = eligible
                    .get(index)
                    .map(|(_, soul)| *soul)
                    .ok_or_else(|| {
                        TestCaseError::fail(tick_error(format!(
                            "birth {} has no waiting Soul to take",
                            person.0
                        )))
                    })?;
                prop_assert_eq!(
                    newborn.soul,
                    expected_soul,
                    "{}",
                    tick_error(format!(
                        "birth {} took soul {} instead of {}",
                        person.0, newborn.soul.0, expected_soul.0
                    ))
                );
                prop_assert_ne!(newborn.soul, player);

                // One or two living parents, the mother among them, all in the newborn's
                // Household.
                let parents = parents(after, *person);
                prop_assert!(
                    (1..=2).contains(&parents.len()),
                    "{}",
                    tick_error(format!("newborn {} has {} parents", person.0, parents.len()))
                );
                prop_assert!(
                    parents
                        .iter()
                        .any(|parent| before.persons()[parent].sex == Sex::Female),
                    "{}",
                    tick_error(format!("newborn {} has no female parent", person.0))
                );
                let household = match after.persons()[person].life {
                    Life::Alive { household, .. } => household,
                    Life::Dead { .. } => {
                        return Err(TestCaseError::fail(tick_error(format!(
                            "newborn {} is dead",
                            person.0
                        ))));
                    }
                };
                for parent in &parents {
                    prop_assert!(is_resident(&before, *parent));
                    prop_assert!(is_resident(after, *parent));
                    let parent_household = match after.persons()[parent].life {
                        Life::Alive { household, .. } => household,
                        Life::Dead { .. } => unreachable!(),
                    };
                    prop_assert_eq!(
                        parent_household,
                        household,
                        "{}",
                        tick_error(format!(
                            "parent {} does not live with newborn {}",
                            parent.0, person.0
                        ))
                    );
                }
            }

            for (_, person) in &arrivals {
                let person = *person;
                let event_id = arrivals
                    .iter()
                    .find(|(_, p)| *p == person)
                    .map(|(id, _)| *id)
                    .unwrap();
                let body = &after.persons()[&person];
                let event = after.log().event(event_id).unwrap();
                let expected_origin = match event.kind {
                    EventKind::Possession { .. } => sim_core::values::Origin::Possessed,
                    EventKind::Rebuild { .. } => sim_core::values::Origin::Rebuilt,
                    _ => unreachable!(),
                };
                prop_assert_eq!(body.origin, expected_origin);
                prop_assert!(
                    after.age_years(body) >= 18,
                    "{}",
                    tick_error(format!("outsider {} is too young", person.0))
                );

                // The Soul was waiting at the start of the tick, was not the
                // Player_Soul, and had exceeded Max_Wait.
                let since = match before.souls().places.get(&body.soul) {
                    Some(SoulPlace::Waiting { since }) => *since,
                    _ => {
                        return Err(TestCaseError::fail(tick_error(format!(
                            "outsider {} did not take a waiting Soul",
                            person.0
                        ))));
                    }
                };
                prop_assert_ne!(body.soul, player);
                prop_assert!(
                    today.0.saturating_sub(since.0) > after.params().max_wait,
                    "{}",
                    tick_error(format!(
                        "outsider {} took a Soul that waited only {} days",
                        person.0,
                        today.0.saturating_sub(since.0)
                    ))
                );

                // A marriage later in the same tick may add a spouse Relation and move
                // the newcomer; otherwise the arrival has no kinship and lives alone.
                let married_this_tick = tail.iter().any(|event| {
                    matches!(&event.kind, EventKind::Marriage { a, b } if *a == person || *b == person)
                });
                if !married_this_tick {
                    for (&(from, to), relation) in after.relations() {
                        if from == person || to == person {
                            prop_assert!(
                                !relation.tags.has_kinship(),
                                "{}",
                                tick_error(format!(
                                    "outsider {} has a kinship relation to {}",
                                    person.0,
                                    if from == person { to.0 } else { from.0 }
                                ))
                            );
                        }
                    }
                    let household = match body.life {
                        Life::Alive { household, .. } => household,
                        Life::Dead { .. } => unreachable!(),
                    };
                    prop_assert_eq!(
                        after.household_members(household),
                        vec![person],
                        "{}",
                        tick_error(format!("outsider {} does not live alone", person.0))
                    );
                }
            }

            // R11.1: every non-player Soul whose wait exceeded Max_Wait at the start of
            // the tick was released in this tick.
            for (soul, since) in waiting_souls(&before) {
                if soul != player && today.0.saturating_sub(since.0) > before.params().max_wait {
                    prop_assert!(
                        released.contains(&soul),
                        "{}",
                        tick_error(format!("soul {} was not released", soul.0))
                    );
                }
            }
        }
    }

    // Feature: life-sim, Property 6: Debts follow their Events.
    #[test]
    fn debts_follow_their_events(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        for tick in 0..TICKS {
            let before = sim.world().clone();
            let log_start = before.log().len();
            sim.step();
            let after = sim.world();
            let tail = events_since(after, log_start);
            let tick_error = |message: String| format!("seed {} tick {tick}: {message}", scenario.seed);

            // A new `loan` opens exactly one Debt keyed by its Event id.
            for event in tail {
                if let EventKind::Loan {
                    lender,
                    borrower,
                    amount,
                    due,
                } = &event.kind
                {
                    let debt = after.debts().get(&event.id).ok_or_else(|| {
                        TestCaseError::fail(tick_error(format!(
                            "loan {} has no Debt",
                            event.id.0
                        )))
                    })?;
                    prop_assert_ne!(lender, borrower);
                    prop_assert_eq!(debt.creditor, *lender);
                    prop_assert_eq!(debt.debtor, *borrower);
                    prop_assert_eq!(debt.principal, *amount);
                    prop_assert_eq!(debt.open, *amount);
                    prop_assert!(*amount >= 1);
                    prop_assert_eq!(debt.due, *due);
                    prop_assert!(debt.due > event.tick);
                    // The lender had the money before the tick (the per-flow transfer
                    // itself is covered by the economy unit tests; money conservation
                    // is Property 1).
                    prop_assert!(is_resident(&before, *lender));
                    // The lender had the money before the tick, or received it in this
                    // tick from an estate: deaths run before the loans step, and an heir
                    // can lend what it just inherited. The `inheritance` magnitude counts
                    // property as well as cash, so it is an upper bound on the money
                    // gained. A same-tick arrival cannot be the lender on its endowment
                    // alone, because the endowment (500..=3000) is below
                    // `loan_lender_min` (5,000).
                    let inherited_this_tick: u64 = tail
                        .iter()
                        .filter_map(|event| match event.kind {
                            EventKind::Inheritance { heir, amount, .. } if heir == *lender => {
                                Some(amount)
                            }
                            _ => None,
                        })
                        .fold(0u64, u64::saturating_add);
                    prop_assert!(
                        balance(&before, *lender).saturating_add(inherited_this_tick) >= *amount
                    );
                }
            }

            // A repayment reduces its Debt by exactly its magnitude and moves the money
            // from the debtor to the creditor.
            for event in tail {
                if let EventKind::Repayment {
                    payer,
                    payee,
                    amount,
                } = &event.kind
                {
                    let loan = event
                        .caused_by
                        .iter()
                        .find(|cause| before.debts().contains_key(cause))
                        .ok_or_else(|| {
                            TestCaseError::fail(tick_error(format!(
                                "repayment {} cites no open Debt",
                                event.id.0
                            )))
                        })?;
                    let old = &before.debts()[&loan];
                    // A death earlier in this tick may have transferred the Debt, so the
                    // payer is the debtor after any `debt_transfer` before this Event.
                    let transferred_to = tail
                        .iter()
                        .rev()
                        .filter(|candidate| candidate.id.0 < event.id.0)
                        .find_map(|candidate| match &candidate.kind {
                            EventKind::DebtTransfer { to, .. }
                                if candidate.caused_by.iter().any(|cause| cause == loan) =>
                            {
                                Some(*to)
                            }
                            _ => None,
                        });
                    prop_assert_eq!(transferred_to.unwrap_or(old.debtor), *payer);
                    prop_assert_eq!(old.creditor, *payee);
                    prop_assert!(*amount >= 1 && *amount <= old.open);
                    let remaining = after.debts().get(&loan).map(|debt| debt.open).unwrap_or(0);
                    prop_assert_eq!(old.open.checked_sub(*amount), Some(remaining));
                    if remaining > 0 {
                        prop_assert!(event.tags.contains(EventTag::Partial));
                    }
                }
            }

            // A Debt disappears only when a repayment reached 0 or a `debt_forgiven`
            // for it was appended in this tick — never because it is overdue.
            for (&loan, old) in before.debts() {
                if after.debts().contains_key(&loan) {
                    continue;
                }
                let forgiven = tail.iter().any(|event| {
                    matches!(event.kind, EventKind::DebtForgiven { .. })
                        && event.caused_by.iter().any(|cause| cause == loan)
                });
                let repaid: u64 = tail
                    .iter()
                    .filter(|event| matches!(event.kind, EventKind::Repayment { .. }))
                    .filter(|event| event.caused_by.iter().any(|cause| cause == loan))
                    .map(|event| event.kind.magnitude())
                    .sum();
                prop_assert!(
                    forgiven || repaid == old.open,
                    "{}",
                    tick_error(format!(
                        "debt {loan:?} vanished with {} of {} repaid and no forgiveness",
                        repaid, old.open
                    ))
                );
            }
        }
    }

    // Feature: life-sim, Property 7: Mood changes only through Events.
    #[test]
    fn mood_changes_only_through_events(scenario in arb_scenario()) {
        let mut sim = scenario.sim();
        let mut expected: BTreeMap<PersonId, Mood> = sim
            .world()
            .persons()
            .values()
            .filter_map(|person| match person.life {
                Life::Alive { mood, .. } => Some((person.id, mood)),
                Life::Dead { .. } => None,
            })
            .collect();
        for tick in 0..TICKS {
            let before = sim.world().clone();
            let log_start = before.log().len();
            sim.step();
            let after = sim.world();
            let tail = events_since(after, log_start);

            // A newborn starts at Mood 0 and only the tick's Events may move it after.
            for id in new_persons(&before, after) {
                expected.entry(id).or_insert_with(|| Mood::clamped(0));
            }
            for event in tail {
                for (position, actor) in event.kind.actors().iter().enumerate() {
                    if let Some(mood) = expected.get_mut(&actor) {
                        *mood = mood.add_clamped(mood_delta(&event.kind, position));
                    }
                }
            }
            for (&id, person) in after.persons() {
                if let Life::Alive { mood, .. } = person.life {
                    let want = expected.get(&id).copied().unwrap_or_else(|| Mood::clamped(0));
                    prop_assert_eq!(
                        mood,
                        want,
                        "seed {} tick {}: Mood of {} changed without an Event",
                        scenario.seed,
                        tick,
                        id.0
                    );
                }
            }
        }
    }
}
