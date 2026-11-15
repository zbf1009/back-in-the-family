//! C1 checker-recognition evidence: each fixture deliberately violates one rule.
//! These tests do not inject faults into production simulation code (C2).

use sim_core::events::EventKind;
use sim_core::ids::{PersonId, Tick};
use sim_core::invariants::InvariantChecker;
use sim_core::params::Params;
use sim_core::testing::{Mutation, append_invalid_event, apply, set_invalid_joss_account};
use sim_core::world::{Life, SoulPlace, World, WorldConfig};

fn opening(params: Params) -> World {
    World::new_with_params(3, WorldConfig::try_new(40).unwrap(), params).unwrap()
}

fn quiet(mut params: Params) -> Params {
    params.mortality_ppm_by_age = [0; 120];
    params.social_ppm = 0;
    params.birth_ppm_married = 0;
    params.birth_ppm_unmarried = 0;
    params.marriage_ppm = 0;
    params.loan_ppm = 0;
    params
}

fn waiting_player(mut params: Params) -> World {
    let initial = opening(params);
    let player = initial.souls().player;
    let SoulPlace::Body(body) = initial.souls().places[&player] else {
        panic!("the opening Player_Soul has a body");
    };
    let age = usize::from(initial.age_years(&initial.persons()[&body]));
    params = quiet(params);
    params.mortality_ppm_by_age[age] = 1_000_000;
    params.offer_min_affinity = 101; // The forced death must not produce unrelated credits.
    let mut world = opening(params);
    world.step(&[]);
    assert!(
        world.player_wait().is_some(),
        "the Player_Soul died at tick 0"
    );
    world
}

fn living_person(world: &World) -> PersonId {
    world
        .persons()
        .values()
        .find(|person| matches!(person.life, Life::Alive { .. }))
        .expect("the town still has living Residents")
        .id
}

fn checked_step(world: &World) -> InvariantChecker {
    InvariantChecker::new(world).expect("the fixture baseline is legal")
}

fn assert_label(checker: &mut InvariantChecker, world: &World, criterion: &str) {
    let violation = checker
        .after_tick(world)
        .expect_err("the fixture must be illegal");
    assert_eq!(violation.criterion, criterion, "{violation}");
}

#[test]
fn u1_3_flags_a_balance_that_differs_from_the_log() {
    let mut world = opening(quiet(Params::DEFAULT));
    let mut checker = checked_step(&world);
    world.step(&[]);
    assert!(world.joss().values().all(|account| account.balance == 0));
    assert!(apply(&mut world, Mutation::JossBalance { soul: 0 }));
    assert_label(&mut checker, &world, "U1.3");
}

#[test]
fn u1_2_flags_a_credit_with_no_owning_soul() {
    let mut world = opening(quiet(Params::DEFAULT));
    let mut checker = checked_step(&world);
    world.step(&[]);
    let offerer = living_person(&world);
    let ghost = world
        .persons()
        .values()
        .find(|person| person.id != offerer && matches!(person.life, Life::Alive { .. }))
        .expect("a second living Person")
        .id;
    append_invalid_event(
        &mut world,
        Tick(0),
        EventKind::Offering {
            offerer,
            ghost,
            amount: 1,
            credited: 1,
        },
    );
    assert_label(&mut checker, &world, "U1.2");
}

#[test]
fn u2_5_flags_credits_over_the_cap() {
    let mut params = Params::DEFAULT;
    params.yearly_cap = 2;
    let mut world = waiting_player(params);
    let mut checker = checked_step(&world);
    let ghost = world.player_wait().unwrap().ghost;
    let offerer = living_person(&world);
    let soul = world.souls().player;
    let credit = world.params().yearly_cap + 1;
    append_invalid_event(
        &mut world,
        Tick(0),
        EventKind::Offering {
            offerer,
            ghost,
            amount: credit,
            credited: credit,
        },
    );
    let mut account = world.joss()[&soul];
    account.balance += credit;
    account.credited += credit;
    set_invalid_joss_account(&mut world, soul, account);
    assert_label(&mut checker, &world, "U2.5");
}

#[test]
fn u2_6_flags_capped_spends_over_the_cap() {
    let mut params = Params::DEFAULT;
    params.yearly_cap = 2;
    params.player_max_wait = 500;
    let mut world = waiting_player(params);
    let ghost = world.player_wait().unwrap().ghost;
    let offerer = living_person(&world);
    let soul = world.souls().player;
    assert_eq!(world.persons()[&ghost].soul, soul);
    // Two individually legal credits leave enough balance for the illegal spend.
    append_invalid_event(
        &mut world,
        Tick(0),
        EventKind::Offering {
            offerer,
            ghost,
            amount: 2,
            credited: 2,
        },
    );
    let mut account = world.joss()[&soul];
    account.balance = 2;
    account.credited = 2;
    assert_eq!(account.cap_year, 0);
    set_invalid_joss_account(&mut world, soul, account);
    for _ in 0..365 {
        assert!(apply(&mut world, Mutation::Tick));
    }
    let mut checker = checked_step(&world);
    append_invalid_event(
        &mut world,
        Tick(365),
        EventKind::Offering {
            offerer,
            ghost,
            amount: 2,
            credited: 2,
        },
    );
    let mut account = world.joss()[&soul];
    account.balance = 4;
    account.cap_year = 1;
    assert_eq!(account.capped_spent, 0);
    account.credited = 2;
    set_invalid_joss_account(&mut world, soul, account);
    append_invalid_event(
        &mut world,
        Tick(365),
        EventKind::Haunting {
            ghost,
            target: offerer,
            intensity: 50,
            price: 2,
        },
    );
    append_invalid_event(
        &mut world,
        Tick(365),
        EventKind::Haunting {
            ghost,
            target: offerer,
            intensity: 50,
            price: 1,
        },
    );
    let mut account = world.joss()[&soul];
    account.balance = 1;
    account.capped_spent = 3;
    set_invalid_joss_account(&mut world, soul, account);
    assert_label(&mut checker, &world, "U2.6");
}

#[test]
fn u4_3_flags_a_dream_naming_a_disconnected_person() {
    let mut world = waiting_player(Params::DEFAULT);
    let mut checker = checked_step(&world);
    let ghost = world.player_wait().unwrap().ghost;
    let dreamer = world
        .persons()
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .find(|person| !world.relations().contains_key(&(person.id, ghost)))
        .expect("there is an unconnected living Resident")
        .id;
    append_invalid_event(
        &mut world,
        Tick(0),
        EventKind::Dream {
            ghost,
            dreamer,
            price: 0,
        },
    );
    assert_label(&mut checker, &world, "U4.3");
}

#[test]
fn u5_3_flags_a_haunting_naming_a_dead_target() {
    let mut world = waiting_player(Params::DEFAULT);
    let mut checker = checked_step(&world);
    let ghost = world.player_wait().unwrap().ghost;
    let dead_target = world
        .log()
        .events()
        .iter()
        .find_map(|event| match event.kind {
            EventKind::Death { person } if person != ghost => Some(person),
            _ => None,
        })
        .unwrap_or(ghost);
    assert!(world.log().events().iter().any(|event| {
        matches!(event.kind, EventKind::Death { person } if person == dead_target)
    }));
    append_invalid_event(
        &mut world,
        Tick(0),
        EventKind::Haunting {
            ghost,
            target: dead_target,
            intensity: 50,
            price: 0,
        },
    );
    assert_label(&mut checker, &world, "U5.3");
}

#[test]
fn u7_10_flags_a_wait_while_the_player_is_in_a_body() {
    let mut world = opening(Params::DEFAULT);
    assert!(apply(&mut world, Mutation::PlayerWait));
    let violation = InvariantChecker::new(&world).expect_err("a living Player_Soul cannot wait");
    assert_eq!(violation.criterion, "U7.10", "{violation}");
}

#[test]
fn u8_3_flags_a_wait_over_the_bound() {
    let mut params = Params::DEFAULT;
    params.player_max_wait = 2;
    let mut world = waiting_player(params);
    let mut checker = checked_step(&world);
    for _ in 0..4 {
        assert!(apply(&mut world, Mutation::Tick));
    }
    assert_label(&mut checker, &world, "U8.3");
}
