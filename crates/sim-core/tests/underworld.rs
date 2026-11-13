//! The underworld properties of design "Correctness Properties" and the smoke test of
//! the generated underworld run.
//!
//! Every property drives the shared generator in `underworld_gen`, which plans a
//! state-aware mix of valid and invalid inputs for 400 ticks and runs the extended
//! `InvariantChecker` after every tick. The assertions here are written from the
//! World's own accessors and the Event_Log, independently of the checker.

mod underworld_gen;

use std::collections::BTreeMap;

use proptest::prelude::*;

use sim_core::events::EventKind;
use sim_core::ids::SoulId;
use sim_core::underworld::joss::cap_year;
use sim_core::world::{Life, SoulPlace, World};
use underworld_gen::{Run, TICKS, events_since};

/// The joss paper one Event moves and whether it is a capped spend (R1.2, R2.6).
/// Each Event kind carries at most one credit or spend field, so this returns one
/// entry at most.
fn ledger_event(world: &World, kind: &EventKind) -> Option<(SoulId, i128, bool)> {
    let soul_of = |person: sim_core::ids::PersonId| world.persons().get(&person).map(|p| p.soul);
    match kind {
        EventKind::Offering {
            ghost, credited, ..
        } => Some((soul_of(*ghost)?, i128::from(*credited), false)),
        EventKind::BribeOffering { ghost, amount, .. } => {
            Some((soul_of(*ghost)?, -i128::from(*amount), false))
        }
        EventKind::Dream { ghost, price, .. } => {
            Some((soul_of(*ghost)?, -i128::from(*price), false))
        }
        EventKind::Haunting { ghost, price, .. } => {
            Some((soul_of(*ghost)?, -i128::from(*price), true))
        }
        EventKind::Possession { person, price } => {
            Some((soul_of(*person)?, -i128::from(*price), false))
        }
        EventKind::Rebuild { person, price } => {
            Some((soul_of(*person)?, -i128::from(*price), true))
        }
        _ => None,
    }
}

fn balances(world: &World) -> BTreeMap<SoulId, u64> {
    world
        .joss()
        .iter()
        .map(|(&soul, account)| (soul, account.balance))
        .collect()
}

/// The bodies that a birth, possession or rebuild Event gave a Soul in this tick.
fn arrivals(world: &World, start: usize) -> Vec<sim_core::ids::PersonId> {
    events_since(world, start)
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Birth { person }
            | EventKind::Possession { person, .. }
            | EventKind::Rebuild { person, .. } => Some(*person),
            _ => None,
        })
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: underworld, Property 1: The log is the joss ledger.
    #[test]
    fn property_1_the_log_is_the_joss_ledger(scenario in underworld_gen::arb_scenario()) {
        let mut run = Run::new(scenario);
        let player = run.world().souls().player;
        let mut expected: BTreeMap<SoulId, i128> = BTreeMap::new();
        let mut previous = balances(run.world());
        prop_assert_eq!(run.world().joss().len(), run.world().souls().places.len());

        for _step in 0..TICKS {
            let start = run.world().log().len();
            let (_before, after, _planned) = run.step();
            // R1.1: exactly one Joss_Balance per Soul.
            prop_assert_eq!(
                after.joss().len(),
                after.souls().places.len(),
                "tick {}",
                after.tick().0
            );
            let arrivals = arrivals(&after, start);
            for event in events_since(&after, start) {
                if let Some((soul, delta, _capped)) = ledger_event(&after, &event.kind) {
                    let entry = expected.entry(soul).or_insert(0);
                    *entry = entry.saturating_add(delta);
                }
                // R1.4: an Offering with a credit names a Ghost whose Soul was waiting
                // at the append; a Soul reborn later in the same tick is still a Ghost.
                if let EventKind::Offering { ghost, credited, .. } = &event.kind
                    && *credited > 0
                {
                    let person = after
                        .persons()
                        .get(ghost)
                        .expect("an Offering names a known Ghost");
                    prop_assert!(
                        matches!(person.life, Life::Dead { .. }),
                        "tick {}: offering {} credits the living person {}",
                        after.tick().0,
                        event.id.0,
                        ghost.0
                    );
                    if let Some(SoulPlace::Body(body)) = after.souls().places.get(&person.soul) {
                        prop_assert!(
                            arrivals.contains(body),
                            "tick {}: offering {} credits soul {} in body {}",
                            after.tick().0,
                            event.id.0,
                            person.soul.0,
                            body.0
                        );
                    }
                }
            }
            for (&soul, account) in after.joss() {
                prop_assert_eq!(
                    i128::from(account.balance),
                    expected.get(&soul).copied().unwrap_or(0),
                    "tick {}: soul {} balance",
                    after.tick().0,
                    soul.0
                );
                // R10.2: an NPC_Soul's balance never decreases.
                if soul != player {
                    let before = previous.get(&soul).copied().unwrap_or(0);
                    prop_assert!(
                        account.balance >= before,
                        "tick {}: NPC soul {} went from {} to {}",
                        after.tick().0,
                        soul.0,
                        before,
                        account.balance
                    );
                }
            }
            previous = balances(&after);
        }
    }

    // Feature: underworld, Property 2: The Yearly_Cap holds.
    #[test]
    fn property_2_the_yearly_cap_holds(scenario in underworld_gen::arb_scenario()) {
        let mut run = Run::new(scenario);
        let cap = run.world().params().yearly_cap;
        let mut credited: BTreeMap<(SoulId, u64), u64> = BTreeMap::new();
        let mut capped: BTreeMap<(SoulId, u64), u64> = BTreeMap::new();

        for _ in 0..TICKS {
            let start = run.world().log().len();
            let (_before, after, _planned) = run.step();
            for event in events_since(&after, start) {
                let year = cap_year(event.tick);
                let soul = match &event.kind {
                    EventKind::Offering { ghost, .. } => after
                        .persons()
                        .get(ghost)
                        .map(|person| person.soul),
                    EventKind::Haunting { ghost, .. } => after
                        .persons()
                        .get(ghost)
                        .map(|person| person.soul),
                    EventKind::Rebuild { person, .. } => {
                        after.persons().get(person).map(|entry| entry.soul)
                    }
                    _ => None,
                };
                let Some(soul) = soul else {
                    continue;
                };
                match &event.kind {
                    EventKind::Offering { amount, credited: given, .. } => {
                        let prior = credited.get(&(soul, year)).copied().unwrap_or(0);
                        let allowed = (*amount).min(cap.saturating_sub(prior));
                        prop_assert_eq!(
                            *given,
                            allowed,
                            "tick {}: soul {} credited {} of {} after {} in Cap_Year {}",
                            after.tick().0,
                            soul.0,
                            given,
                            amount,
                            prior,
                            year
                        );
                        let total = prior.saturating_add(*given);
                        prop_assert!(
                            total <= cap,
                            "tick {}: soul {} credited {} in Cap_Year {}",
                            after.tick().0,
                            soul.0,
                            total,
                            year
                        );
                        credited.insert((soul, year), total);
                    }
                    EventKind::Haunting { price, .. } | EventKind::Rebuild { price, .. } => {
                        let total = capped
                            .get(&(soul, year))
                            .copied()
                            .unwrap_or(0)
                            .saturating_add(*price);
                        prop_assert!(
                            total <= cap,
                            "tick {}: soul {} capped spends {} in Cap_Year {}",
                            after.tick().0,
                            soul.0,
                            total,
                            year
                        );
                        capped.insert((soul, year), total);
                    }
                    _ => {}
                }
            }
        }
    }
}

/// The smoke test of the generator: over 20 generated runs at least one dream, one
/// haunting, one Bribe, one Birth claim, one Standing claim, one Carry_Over, one
/// External_Choice and one R8.1 placement occurs, so the properties are not vacuous.
///
/// Every fourth run plans no claim, so its Player_Wait reaches the placement bound.
#[test]
fn twenty_generated_runs_exercise_every_mechanic() {
    use sim_core::params::Params;
    use underworld_gen::{AppliedCounts, ParamsChoice, Scenario};

    let mut params = Params::stress_underworld();
    // A short wait bound and a high mortality floor put a Player_Soul in the queue in
    // every run within a few dozen ticks of the start.
    params.mortality_floor_ppm = 20_000;
    params.player_max_wait = 12;

    let mut counts = AppliedCounts::default();
    let mut placements = 0u64;
    for seed in 1..=20u64 {
        let scenario = Scenario::new(seed, 50, ParamsChoice::StressUnderworld);
        let mut run = Run::with_params(scenario, params);
        run.claims = !seed.is_multiple_of(4);
        for _ in 0..TICKS {
            let (before, after, planned) = run.step();
            counts.add(&planned);
            if underworld_gen::forced_placement(&before, &after, &planned) {
                placements = placements.saturating_add(1);
            }
        }
    }

    assert!(counts.dreams > 0, "no dream applied: {counts:?}");
    assert!(counts.hauntings > 0, "no haunting applied: {counts:?}");
    assert!(counts.bribes > 0, "no Bribe applied: {counts:?}");
    assert!(
        counts.birth_claims > 0,
        "no Birth_Slot claim applied: {counts:?}"
    );
    assert!(
        counts.standing_claims > 0,
        "no Standing_Slot claim applied: {counts:?}"
    );
    assert!(counts.carry_overs > 0, "no Carry_Over applied: {counts:?}");
    assert!(counts.choices > 0, "no External_Choice applied: {counts:?}");
    assert!(placements > 0, "no R8.1 placement happened: {counts:?}");
}
