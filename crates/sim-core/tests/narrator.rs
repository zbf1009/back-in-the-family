//! Public-seam property tests for the Narrator's first-playable contract.
//!
//! These tests deliberately drive `World::step`/`step_with_outcomes`; constructed player
//! nodes use only the test-support fixture helpers, never narrator implementation internals.

mod underworld_gen;

use proptest::prelude::*;

use sim_core::events::EventKind;
use sim_core::ids::{InputSeq, NodeId, PersonId, Tick};
use sim_core::input::{InputPayload, TickInput};
use sim_core::intro::IntroDebt;
use sim_core::narrator::{
    EffectPart, EntrySource, PlannedOption, PlayerFamily, PlayerLife, PlayerNode, PlayerOption,
    PreviewEntry, PreviewWhat, SkipReason, StakeUnit, Stakes,
};
use sim_core::params::Params;
use sim_core::testing::{self, Mutation};
use sim_core::values::{Intensity, SocialKind, Trait, Traits};
use sim_core::world::{Life, SoulPlace, World, WorldConfig};

fn narrator_params() -> Params {
    let mut params = Params::stress_underworld();
    // Constructed examples should not wait for the ordinary 600-day interruption band.
    params.first_interrupt_min = 0;
    params.interrupt_gap_min = 0;
    // Keep the production min_salience and first_interrupt_max unchanged.
    params.social_ppm = 0;
    params.social_rolls_per_day = 0;
    params.loan_ppm = 0;
    params.marriage_ppm = 0;
    params.birth_ppm_married = 0;
    params.birth_ppm_unmarried = 0;
    params.mortality_ppm_by_age = [0; 120];
    params.mortality_floor_ppm = 0;
    params
}

fn world(seed: u64) -> World {
    World::new_with_params(seed, WorldConfig::try_new(40).unwrap(), narrator_params()).unwrap()
}

fn body(world: &World) -> PersonId {
    match world.souls().places[&world.souls().player] {
        SoulPlace::Body(id) => id,
        SoulPlace::Waiting { .. } => panic!("fixture player must start embodied"),
    }
}

fn other_living(world: &World, excluded: PersonId) -> PersonId {
    world
        .persons()
        .values()
        .find(|person| person.id != excluded && matches!(person.life, Life::Alive { .. }))
        .map(|person| person.id)
        .expect("opening world has another Resident")
}

fn preview(person: PersonId, delta: i64) -> Vec<PreviewEntry> {
    vec![PreviewEntry {
        person,
        what: PreviewWhat::Affinity,
        delta,
    }]
}

fn empty_option(id: PlayerOption, person: PersonId, delta: i64) -> PlannedOption {
    PlannedOption {
        id,
        parts: Vec::new(),
        preview: preview(person, delta),
    }
}

fn node(world: &World, id: NodeId, chooser: PersonId) -> PlayerNode {
    PlayerNode {
        id,
        family: PlayerFamily::DebtDue,
        chooser,
        fired: Tick(world.tick().0.saturating_sub(1)),
        stakes: Stakes {
            who: vec![chooser],
            amount: 20,
            unit: StakeUnit::Money,
            by: world.tick(),
        },
        options: vec![
            empty_option(PlayerOption::AskForTime, chooser, 1),
            empty_option(PlayerOption::IgnoreIt, chooser, 0),
        ],
        rules_default: PlayerOption::IgnoreIt,
        external: None,
        trigger: None,
    }
}

fn input(tick: Tick, seq: u64, node: NodeId, option: PlayerOption) -> TickInput {
    TickInput {
        tick,
        seq: InputSeq(seq),
        payload: InputPayload::ChoosePlayer { node, option },
    }
}

fn observable_equal(left: &World, right: &World) -> bool {
    left.persons() == right.persons()
        && left.households() == right.households()
        && left.relations() == right.relations()
        && left.debts() == right.debts()
        && left.souls() == right.souls()
        && left.log() == right.log()
        && left.narrator() == right.narrator()
}

// Feature: first-playable, Property 10: The opening gives a guaranteed first stop
#[test]
fn opening_designates_a_real_eligible_debt_for_every_seed() {
    for seed in 0..=999u64 {
        let world = World::new(seed, WorldConfig::default()).expect("valid opening");
        let second = World::new(seed, WorldConfig::default()).expect("same opening");
        assert_eq!(world, second, "seed {seed}");
        let IntroDebt::Grace { loan, body: chosen } = world.intro_debt() else {
            panic!("seed {seed}: opening escaped without Grace");
        };
        assert_eq!(body(&world), chosen, "seed {seed}");
        let person = &world.persons()[&chosen];
        assert!(matches!(person.life, Life::Alive { .. }));
        assert!((20..=50).contains(&world.age_years(person)));
        let home = match person.life {
            Life::Alive { household, .. } => household,
            _ => unreachable!(),
        };
        assert!(world.persons().values().any(|other| other.id != chosen
            && matches!(other.life, Life::Alive { household, .. } if household == home)));
        let debt = &world.debts()[&loan];
        let other = if debt.debtor == chosen {
            debt.creditor
        } else {
            assert_eq!(debt.creditor, chosen);
            debt.debtor
        };
        assert!(matches!(world.persons()[&other].life, Life::Alive { .. }));
        let offset = debt
            .due
            .0
            .checked_sub(world.params().debt_due_lead)
            .unwrap();
        assert!(
            (world.params().first_interrupt_min..=world.params().opening_trigger_max)
                .contains(&offset),
            "seed {seed}: {offset}"
        );
        assert!(offset < world.params().first_interrupt_max);
        assert!(matches!(
            world.log().event(loan).unwrap().kind,
            EventKind::Loan { .. }
        ));
        assert!(
            world
                .debts()
                .iter()
                .find(|(_, d)| {
                    let counterpart = if d.debtor == chosen {
                        d.creditor
                    } else {
                        d.debtor
                    };
                    (d.debtor == chosen || d.creditor == chosen)
                        && d.due
                            .0
                            .checked_sub(world.params().debt_due_lead)
                            .is_some_and(|t| {
                                (world.params().first_interrupt_min
                                    ..=world.params().opening_trigger_max)
                                    .contains(&t)
                            })
                        && matches!(world.persons()[&counterpart].life, Life::Alive { .. })
                })
                .is_some_and(|(&first, _)| first == loan)
        );
    }
}

// Feature: first-playable, Property 19: Intro_Grace ends only on a real end condition
#[test]
fn grace_and_first_stop_report_for_default_seeds() {
    let mut lost = 0u64;
    for seed in 0..=199u64 {
        let mut world = World::new(seed, WorldConfig::default()).unwrap();
        let IntroDebt::Grace {
            loan,
            body: first_body,
        } = world.intro_debt()
        else {
            unreachable!()
        };
        let trigger = world.debts()[&loan].due.0 - world.params().debt_due_lead;
        let mut lost_this_seed = false;
        let mut first_stop = None;
        for tick in 0..=870u64 {
            if tick > trigger {
                break;
            }
            world.step(&[]);
            assert_ne!(world.intro_debt(), IntroDebt::Undesignated);
            let open = world.debts().get(&loan);
            let still_involves_body =
                open.is_some_and(|d| d.debtor == first_body || d.creditor == first_body);
            if tick < trigger
                && (!still_involves_body
                    || !matches!(world.souls().places[&world.souls().player], SoulPlace::Body(id) if id == first_body))
            {
                lost_this_seed = true;
            }
            if let Some(node) = world.narrator().pending.as_ref() {
                first_stop.get_or_insert((node.fired.0, node.family));
            }
            if let IntroDebt::Grace {
                loan: current,
                body: current_body,
            } = world.intro_debt()
            {
                assert_eq!((current, current_body), (loan, first_body));
                assert!(
                    open.is_some(),
                    "seed {seed} tick {tick}: grace kept closed debt"
                );
                assert!(
                    matches!(world.souls().places[&world.souls().player], SoulPlace::Body(id) if id == first_body)
                );
                assert!(
                    world
                        .narrator()
                        .chronicle
                        .entries()
                        .iter()
                        .all(|e| e.node.is_none())
                );
            }
        }
        if lost_this_seed {
            lost += 1;
        }
        if let Some((tick, _)) = first_stop {
            assert!(
                (600..900).contains(&tick),
                "seed {seed}: first stop offset {tick}"
            );
        } else if !lost_this_seed {
            panic!("seed {seed}: no first stop despite surviving Intro_Debt");
        }
    }
    println!("intro trigger loss seeds=0..=199 count={lost}");
}

#[test]
fn grace_survives_transfer_but_ends_once_after_closure_or_first_life_death() {
    let mut transferred = World::new(70, WorldConfig::default()).unwrap();
    let IntroDebt::Grace {
        loan,
        body: first_body,
    } = transferred.intro_debt()
    else {
        unreachable!()
    };
    let heir = transferred
        .persons()
        .keys()
        .copied()
        .find(|id| *id != first_body && *id != transferred.debts()[&loan].creditor)
        .unwrap();
    testing::transfer_intro_debt(&mut transferred, heir);
    transferred.step(&[]);
    assert_eq!(
        transferred.intro_debt(),
        IntroDebt::Grace {
            loan,
            body: first_body
        }
    );
    assert_eq!(transferred.debts()[&loan].debtor, heir);
    testing::close_intro_debt(&mut transferred);
    transferred.step(&[]);
    assert_eq!(transferred.intro_debt(), IntroDebt::Ended { loan });
    transferred.step(&[]);
    assert_eq!(transferred.intro_debt(), IntroDebt::Ended { loan });

    let mut died = World::new(71, WorldConfig::default()).unwrap();
    let IntroDebt::Grace { loan, .. } = died.intro_debt() else {
        unreachable!()
    };
    testing::end_intro_life(&mut died);
    died.step(&[]);
    assert_eq!(died.intro_debt(), IntroDebt::Ended { loan });
}

#[test]
fn first_node_resolution_ends_grace_only_on_the_choice_tick() {
    let mut world = World::new(72, WorldConfig::default()).unwrap();
    let IntroDebt::Grace { loan, .. } = world.intro_debt() else {
        unreachable!()
    };
    let mut fired = None;
    for _ in 0..900 {
        world.step(&[]);
        if let Some(node) = world.narrator().pending.as_ref() {
            fired = Some((node.fired, node.family));
            assert!(matches!(world.intro_debt(), IntroDebt::Grace { .. }));
            break;
        }
    }
    let (tick, family) = fired.expect("first-life node");
    assert!((600..900).contains(&tick.0));
    world.step(&[]);
    assert_eq!(world.intro_debt(), IntroDebt::Ended { loan });
    assert!(
        world
            .narrator()
            .chronicle
            .entries()
            .iter()
            .any(|entry| entry.tick.0 == tick.0 + 1
                && entry.node.is_some()
                && entry.family == family
                && entry.source == EntrySource::RulesDefault)
    );
    world.step(&[]);
    assert_eq!(world.intro_debt(), IntroDebt::Ended { loan });
}

#[test]
fn grace_skips_monthly_repayment_and_excludes_intro_from_inheritance() {
    let mut world = world(73);
    let IntroDebt::Grace {
        loan,
        body: chooser,
    } = world.intro_debt()
    else {
        unreachable!()
    };
    let original = world.debts()[&loan].clone();
    let other = other_living(&world, chooser);
    let second = testing::add_test_debt(&mut world, chooser, other, Tick(720), 100);
    assert_eq!(testing::inheritance_pay_target(&world, other), Some(second));
    let mut only_intro = world.clone();
    testing::close_test_debt(&mut only_intro, second);
    assert_eq!(testing::inheritance_pay_target(&only_intro, other), None);
    let anniversary = Tick(30);
    testing::set_tick(&mut world, anniversary);
    world.step(&[]);
    assert_eq!(
        world.debts()[&loan],
        original,
        "step 10 never pays the designated loan during Grace"
    );
    assert_eq!(world.debts()[&loan], original);
}

#[test]
fn eligible_intro_debt_outweighs_same_tick_event_candidate() {
    let mut world = world(74);
    let IntroDebt::Grace {
        loan,
        body: chooser,
    } = world.intro_debt()
    else {
        unreachable!()
    };
    let trigger = world.debts()[&loan].due.0 - world.params().debt_due_lead;
    let other = if world.debts()[&loan].debtor == chooser {
        world.debts()[&loan].creditor
    } else {
        world.debts()[&loan].debtor
    };
    testing::set_player_life(
        &mut world,
        PlayerLife {
            body: chooser,
            start: Tick(0),
            first_fire: None,
            last_fire: None,
        },
    );
    testing::set_tick(&mut world, Tick(trigger));
    testing::append_invalid_event(
        &mut world,
        Tick(trigger),
        EventKind::Inheritance {
            deceased: other,
            heir: chooser,
            amount: 100,
        },
    );
    world.step(&[]);
    let node = world
        .narrator()
        .pending
        .as_ref()
        .expect("eligible intro debt fires first");
    assert_eq!(node.family, PlayerFamily::DebtDue);
    assert_eq!(node.fired, Tick(trigger));
    assert_eq!(
        world.intro_debt(),
        IntroDebt::Grace {
            loan,
            body: chooser
        }
    );
}
// Feature: first-playable, Property 6: Ordering and selection follow the budget rule
#[test]
fn default_params_never_fire_a_first_node_before_600_ticks() {
    assert_eq!(Params::DEFAULT.first_interrupt_min, 600);
    assert_eq!(Params::DEFAULT.first_interrupt_max, 900);
    assert_eq!(Params::DEFAULT.interrupt_gap_min, 900);
    assert_eq!(Params::DEFAULT.min_salience, 30);
    for seed in 1..=5 {
        let mut world = World::new(seed, WorldConfig::default()).unwrap();
        for offset in 0..600 {
            world.step(&[]);
            assert!(
                world.narrator().pending.is_none(),
                "seed {seed} fired at offset {offset}"
            );
            assert!(
                world
                    .narrator()
                    .life
                    .as_ref()
                    .is_none_or(|life| life.first_fire.is_none()),
                "seed {seed} first fired before 600"
            );
        }
    }
}

// Feature: first-playable, Property 8: The Narrator stays inside its scope
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_8_default_budget_gap_and_chronicle_provenance(seed in any::<u64>()) {
        let mut world = World::new(seed, WorldConfig::default()).unwrap();
        let mut last_fire: Option<u64> = None;
        for _ in 0..400 {
            let tick = world.tick();
            let entries_before = world.narrator().chronicle.entries().len();
            world.step(&[]);
            let narrator = world.narrator();
            if let Some(node) = &narrator.pending {
                prop_assert_eq!(node.fired, tick);
                if let Some(previous) = last_fire {
                    prop_assert!(tick.0 - previous >= Params::DEFAULT.interrupt_gap_min);
                } else {
                    prop_assert!(tick.0 >= Params::DEFAULT.first_interrupt_min);
                }
                last_fire = Some(tick.0);
            }
            for entry in &narrator.chronicle.entries()[entries_before..] {
                if entry.source == EntrySource::AutoResolved {
                    prop_assert!(entry.node.is_none());
                }
                for id in &entry.appended {
                    let event = world.log().event(*id).expect("Chronicle event exists");
                    prop_assert_eq!(event.tick, entry.tick);
                }
            }
        }
    }
}

// Feature: first-playable, Property 1: Player_Node lifecycle invariants
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_1_player_node_lifecycle_invariants(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        testing::set_tick(&mut world, Tick(1));
        let node_id = NodeId(10_000 + seed % 1_000);
        let constructed = node(&world, node_id, chooser);
        testing::install_player_node(&mut world, constructed.clone());

        let before = world.narrator().chronicle.entries().len();
        world.step(&[]);
        let narrator = world.narrator();
        prop_assert!(narrator.pending.is_none(), "a node resolves exactly one tick later");
        prop_assert_eq!(narrator.chronicle.entries().len(), before + 1);
        let entry = narrator.chronicle.entries().last().unwrap();
        prop_assert_eq!(entry.node, Some(node_id));
        prop_assert_eq!(entry.tick, Tick(1));
        prop_assert_eq!(entry.source, EntrySource::RulesDefault);
        prop_assert!(narrator.chronicle.entries().iter().filter(|e| e.node == Some(node_id)).count() == 1);
    }

    #[test]
    fn property_1_real_fired_nodes_resolve_once(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        let other = other_living(&world, chooser);
        let due = Tick(world.params().debt_due_lead);
        testing::add_test_debt(&mut world, chooser, other, due, 100);
        world.step(&[]);
        let pending = world.narrator().pending.as_ref().expect("constructed due debt fires").clone();
        prop_assert_eq!(pending.fired, Tick(0));
        prop_assert_eq!(world.tick(), Tick(1));
        prop_assert!((2..=5).contains(&pending.options.len()));
        prop_assert!(pending.options.iter().any(|option| option.id == pending.rules_default));
        prop_assert_eq!(pending.options.iter().map(|option| option.id).collect::<std::collections::BTreeSet<_>>().len(), pending.options.len());
        let expected = pending.rules_default;
        world.step(&[]);
        prop_assert!(world.narrator().pending.is_none());
        let entries: Vec<_> = world.narrator().chronicle.entries().iter().filter(|entry| entry.node == Some(pending.id)).collect();
        prop_assert_eq!(entries.len(), 1);
        prop_assert_eq!(entries[0].tick, Tick(1));
        prop_assert_eq!(entries[0].applied, expected);
        prop_assert_eq!(entries[0].source, EntrySource::RulesDefault);
        prop_assert_eq!(world.narrator().chronicle.digest(), world.narrator().chronicle.recompute_digest());
    }

}

// Feature: first-playable, Property 2: Applied option is the External_Choice or the frozen Rules_Default
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_2_external_choice_is_applied(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        testing::set_tick(&mut world, Tick(1));
        let id = NodeId(20_000 + seed % 1_000);
        let constructed = node(&world, id, chooser);
        testing::install_player_node(&mut world, constructed);
        let (_, outcomes) = world.step_with_outcomes(&[input(Tick(1), 0, id, PlayerOption::AskForTime)]);
        prop_assert_eq!(outcomes[0].result, Ok(()));
        let entry = world.narrator().chronicle.entries().last().unwrap();
        prop_assert_eq!(entry.applied, PlayerOption::AskForTime);
        prop_assert_eq!(entry.source, EntrySource::External);
        prop_assert!(!entry.chooser_absent);
    }

    #[test]
    fn property_2_default_is_frozen_when_no_choice(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        testing::set_tick(&mut world, Tick(1));
        let id = NodeId(21_000 + seed % 1_000);
        let constructed = node(&world, id, chooser);
        testing::install_player_node(&mut world, constructed);
        world.step(&[]);
        let entry = world.narrator().chronicle.entries().last().unwrap();
        prop_assert_eq!(entry.applied, PlayerOption::IgnoreIt);
        prop_assert_eq!(entry.source, EntrySource::RulesDefault);
    }
    #[test]
    fn property_2_first_real_node_accepts_external_choice(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        let other = other_living(&world, chooser);
        let due = Tick(world.params().debt_due_lead);
        testing::add_test_debt(&mut world, chooser, other, due, 100);
        world.step(&[]);
        let node = world.narrator().pending.as_ref().expect("first due node fires").clone();
        let chosen = node.options.iter().map(|option| option.id)
            .find(|option| *option != node.rules_default).expect("defensible choice");
        let choice_tick = world.tick();
        let (_, outcomes) = world.step_with_outcomes(&[input(choice_tick, 0, node.id, chosen)]);
        prop_assert_eq!(outcomes[0].result, Ok(()));
        let entry = world.narrator().chronicle.entries().iter()
            .find(|entry| entry.node == Some(node.id)).expect("choice resolution");
        prop_assert_eq!(entry.applied, chosen);
        prop_assert_eq!(entry.source, EntrySource::External);
        prop_assert_eq!(entry.tick, choice_tick);
    }
}

// Feature: first-playable, Property 3: Invalid choices change nothing but the rejection record
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_3_unknown_node_changes_only_rejection(seed in any::<u64>()) {
        let mut rejected = world(seed);
        let chooser = body(&rejected);
        testing::set_tick(&mut rejected, Tick(1));
        let id = NodeId(30_000 + seed % 1_000);
        let constructed = node(&rejected, id, chooser);
        testing::install_player_node(&mut rejected, constructed);
        let mut control = rejected.clone();
        let (_, outcomes) = rejected.step_with_outcomes(&[input(Tick(1), 0, NodeId(id.0 + 1), PlayerOption::IgnoreIt)]);
        control.step(&[]);
        prop_assert_eq!(outcomes[0].result, Err(sim_core::world::RejectReason::UnknownNode));
        prop_assert!(observable_equal(&rejected, &control));
    }

    #[test]
    fn property_3_option_outside_set_changes_only_rejection(seed in any::<u64>()) {
        let mut rejected = world(seed);
        let chooser = body(&rejected);
        testing::set_tick(&mut rejected, Tick(1));
        let id = NodeId(31_000 + seed % 1_000);
        let constructed = node(&rejected, id, chooser);
        testing::install_player_node(&mut rejected, constructed);
        let mut control = rejected.clone();
        let (_, outcomes) = rejected.step_with_outcomes(&[input(Tick(1), 0, id, PlayerOption::ComfortMourner)]);
        control.step(&[]);
        prop_assert_eq!(outcomes[0].result, Err(sim_core::world::RejectReason::OptionNotInSet));
        prop_assert!(observable_equal(&rejected, &control));
    }

    #[test]
    fn property_3_already_chosen_changes_only_rejection(seed in any::<u64>()) {
        let mut rejected = world(seed);
        let chooser = body(&rejected);
        testing::set_tick(&mut rejected, Tick(1));
        let id = NodeId(32_000 + seed % 1_000);
        let mut installed = node(&rejected, id, chooser);
        installed.external = Some(PlayerOption::IgnoreIt);
        testing::install_player_node(&mut rejected, installed);
        let mut control = rejected.clone();
        let (_, outcomes) = rejected.step_with_outcomes(&[input(Tick(1), 0, id, PlayerOption::AskForTime)]);
        control.step(&[]);
        prop_assert_eq!(outcomes[0].result, Err(sim_core::world::RejectReason::AlreadyChosen));
        prop_assert!(observable_equal(&rejected, &control));
    }
    #[test]
    fn property_3_wrong_choice_tick_rejects_without_changing_world(seed in any::<u64>()) {
        let mut rejected = world(seed);
        let chooser = body(&rejected);
        let id = NodeId(33_000 + seed % 1_000);
        let constructed = node(&rejected, id, chooser);
        testing::install_player_node(&mut rejected, constructed);
        let mut control = rejected.clone();
        let (_, outcomes) = rejected.step_with_outcomes(&[input(Tick(1), 0, id, PlayerOption::IgnoreIt)]);
        control.step(&[]);
        prop_assert_eq!(outcomes[0].result, Err(sim_core::world::RejectReason::UnknownNode));
        prop_assert!(observable_equal(&rejected, &control));
    }
}

// Feature: first-playable, Property 4: The skip rule applies exactly the valid parts
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_4_invalid_parts_are_skipped_without_rollback(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        let target = other_living(&world, chooser);
        let target_index = world.persons().keys().position(|id| *id == target).unwrap();
        testing::set_tick(&mut world, Tick(1));
        let id = NodeId(40_000 + seed % 1_000);
        let mut installed = node(&world, id, chooser);
        installed.options[0] = PlannedOption {
            id: PlayerOption::AskForTime,
            parts: vec![
                EffectPart::Social {
                    kind: SocialKind::Help,
                    doer: chooser,
                    target,
                    intensity: Intensity::new(40).unwrap(),
                },
                EffectPart::Trait {
                    person: chooser,
                    name: sim_core::underworld::carry_over::TraitName::Warmth,
                    delta: 1,
                },
            ],
            preview: preview(chooser, 1),
        };
        installed.external = Some(PlayerOption::AskForTime);
        testing::install_player_node(&mut world, installed);
        testing::apply(&mut world, Mutation::PersonField { person: target_index as u64, part: 11 });
        let before = world.persons()[&chooser].traits.warmth.get();
        world.step(&[]);
        let entry = world.narrator().chronicle.entries().last().unwrap();
        prop_assert_eq!(entry.applied, PlayerOption::AskForTime);
        prop_assert_eq!(&entry.skipped, &[(0, SkipReason::DeadPerson)]);
        prop_assert!(entry.appended.is_empty());
        prop_assert_eq!(world.persons()[&chooser].traits.warmth.get(), (i16::from(before) + 1).min(3) as i8);
    }

    #[test]
    fn property_4_chooser_absent_skips_parts_naming_chooser(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        let chooser_index = world.persons().keys().position(|id| *id == chooser).unwrap();
        testing::set_tick(&mut world, Tick(1));
        let id = NodeId(41_000 + seed % 1_000);
        let mut installed = node(&world, id, chooser);
        installed.rules_default = PlayerOption::AskForTime;
        installed.options[0] = PlannedOption {
            id: PlayerOption::AskForTime,
            parts: vec![EffectPart::Trait {
                person: chooser,
                name: sim_core::underworld::carry_over::TraitName::Warmth,
                delta: 1,
            }],
            preview: preview(chooser, 1),
        };
        testing::install_player_node(&mut world, installed);
        testing::apply(&mut world, Mutation::PersonField { person: chooser_index as u64, part: 11 });
        world.step(&[]);
        let entry = world.narrator().chronicle.entries().last().unwrap();
        prop_assert!(entry.chooser_absent);
        prop_assert_eq!(&entry.skipped, &[(0, SkipReason::DeadPerson)]);
    }
}

// Feature: first-playable, Property 8: The Narrator stays inside its scope
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_8_waiting_player_is_never_interrupted(seed in any::<u64>()) {
        let mut world = world(seed);
        let player_soul = world.souls().player;
        let soul_index = world.souls().places.keys().position(|id| *id == player_soul).unwrap();
        testing::apply(&mut world, Mutation::SoulPlaceField { soul: soul_index as u64 });
        let chronicle = world.narrator().chronicle.entries().len();
        for _ in 0..20 {
            world.step(&[]);
            prop_assert!(world.narrator().pending.is_none());
            prop_assert_eq!(world.narrator().chronicle.entries().len(), chronicle);
            prop_assert!(matches!(world.souls().places[&player_soul], SoulPlace::Waiting { .. }), "waiting player must remain waiting");
        }
    }

    #[test]
    fn property_8_narrator_appends_only_card_effect_events(seed in any::<u64>()) {
        let mut world = world(seed);
        for _ in 0..25 { world.step(&[]); }
        for entry in world.narrator().chronicle.entries() {
            for id in &entry.appended {
                let event = world.log().event(*id).unwrap();
                prop_assert!(matches!(event.kind,
                    EventKind::Social { kind: SocialKind::Help | SocialKind::Gift | SocialKind::Quarrel | SocialKind::Insult | SocialKind::Apology, .. }
                    | EventKind::Repayment { .. }
                    | EventKind::DebtForgiven { .. }
                ), "Narrator only emits card effect events");
            }
        }
    }
}

// Feature: first-playable, Property 9: Life-stage choices bias only Traits, within bounds
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_9_life_stage_candidate_and_application_are_trait_only(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        testing::set_person_birth_day(&mut world, chooser, 0);
        testing::set_player_life(&mut world, PlayerLife { body: chooser, start: Tick(0), first_fire: None, last_fire: None });
        testing::set_person_traits(
            &mut world,
            chooser,
            Traits {
                greed: Trait::clamped(0),
                loyalty: Trait::clamped(0),
                pride: Trait::clamped(0),
                warmth: Trait::clamped(0),
                temper: Trait::clamped(0),
                vindictiveness: Trait::clamped(0),
                piety: Trait::clamped(0),
            },
        );
        testing::set_tick(&mut world, Tick(2_190));
        let before = world.persons()[&chooser].traits.clone();
        world.step(&[]);
        let pending = world.narrator().pending.as_ref().expect("age 6 fires a life-stage node");
        prop_assert_eq!(pending.family, PlayerFamily::LifeStage);
        prop_assert_eq!(pending.options.len(), 3);
        prop_assert!(pending.options.iter().all(|option| option.parts.len() <= 2));
        world.step(&[]);
        let after = &world.persons()[&chooser].traits;
        let changed = [
            (before.greed.get(), after.greed.get()), (before.loyalty.get(), after.loyalty.get()),
            (before.pride.get(), after.pride.get()), (before.warmth.get(), after.warmth.get()),
            (before.temper.get(), after.temper.get()), (before.vindictiveness.get(), after.vindictiveness.get()),
            (before.piety.get(), after.piety.get()),
        ];
        prop_assert!(changed.iter().all(|(_, b)| i16::from(*b) >= -3 && i16::from(*b) <= 3));
        prop_assert!(changed.iter().filter(|(a, b)| a != b).count() <= 2);
    }
}

// Feature: first-playable, Property 20: Feud candidates come only from first crossings
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_20_crossing_below_and_rearm(seed in any::<u64>()) {
        let mut world = world(seed);
        let chooser = body(&world);
        let target = other_living(&world, chooser);
        testing::add_test_debt(&mut world, chooser, target, Tick(2_000), 100);
        let threshold = world.params().grudge_threshold;
        testing::set_relation_affinity(&mut world, chooser, target, threshold);
        testing::set_relation_affinity(&mut world, target, chooser, threshold);
        let mut seq = 0;
        let act = |tick: Tick, seq: u64| TickInput {
            tick, seq: InputSeq(seq), payload: InputPayload::Act {
                kind: SocialKind::Quarrel, actor: chooser, target, intensity: 100,
            }
        };
        world.step(&[act(Tick(0), seq)]); seq += 1;
        let first = world.narrator().pending.as_ref().map(|node| node.family);
        prop_assert_eq!(first, Some(PlayerFamily::Feud));
        world.step(&[]);
        prop_assert!(world.narrator().chronicle.entries().iter().any(|entry| entry.family == PlayerFamily::Feud));

        // A second grievance while already below threshold does not re-arm the feud.
        world.step(&[act(world.tick(), seq)]); seq += 1;
        let feud_count = world.narrator().chronicle.entries().iter().filter(|entry| entry.family == PlayerFamily::Feud).count();
        prop_assert_eq!(feud_count, 1);

        // Returning to the threshold re-arms; a second crossing is recorded
        // even if another eligible candidate wins this tick's budget.
        testing::set_relation_affinity(&mut world, chooser, target, threshold);
        testing::set_relation_affinity(&mut world, target, chooser, threshold);
        world.step(&[act(world.tick(), seq)]);
        prop_assert!(world.narrator().pending.as_ref().is_some_and(|node| node.family == PlayerFamily::Feud)
            || world.narrator().chronicle.entries().iter().filter(|entry| entry.family == PlayerFamily::Feud).count() >= 2);
    }
}

fn assert_family_example(mut world: World, family: PlayerFamily) {
    world.step(&[]);
    assert!(
        world
            .narrator()
            .pending
            .as_ref()
            .is_some_and(|node| node.family == family)
            || world
                .narrator()
                .chronicle
                .entries()
                .iter()
                .any(|entry| entry.family == family)
    );
}

#[test]
fn example_family_death_candidate() {
    let mut world = world(101);
    let chooser = body(&world);
    let deceased = world
        .relations()
        .keys()
        .find_map(|(from, to)| {
            if *from == chooser && world.relations()[&(*from, *to)].tags.has_kinship() {
                Some(*to)
            } else if *to == chooser && world.relations()[&(*from, *to)].tags.has_kinship() {
                Some(*from)
            } else {
                None
            }
        })
        .expect("opening family relation");
    let index = world
        .persons()
        .keys()
        .position(|id| *id == deceased)
        .unwrap();
    testing::apply(
        &mut world,
        Mutation::PersonField {
            person: index as u64,
            part: 11,
        },
    );
    let tick = world.tick();
    testing::append_invalid_event(&mut world, tick, EventKind::Death { person: deceased });
    assert_family_example(world, PlayerFamily::FamilyDeath);
}

#[test]
fn example_inheritance_candidate() {
    let mut world = world(102);
    let chooser = body(&world);
    let deceased = other_living(&world, chooser);
    let creditor = other_living(&world, chooser);
    let due = Tick(world.tick().0 + world.params().debt_due_lead + 1);
    testing::add_test_debt(&mut world, chooser, creditor, due, 100);
    let tick = world.tick();
    testing::append_invalid_event(
        &mut world,
        tick,
        EventKind::Inheritance {
            deceased,
            heir: chooser,
            amount: 100,
        },
    );
    assert_family_example(world, PlayerFamily::Inheritance);
}

#[test]
fn example_debt_due_candidate() {
    let mut world = world(103);
    let chooser = body(&world);
    let creditor = other_living(&world, chooser);
    let due = Tick(world.tick().0 + world.params().debt_due_lead);
    testing::add_test_debt(&mut world, chooser, creditor, due, 100);
    assert_family_example(world, PlayerFamily::DebtDue);
}

#[test]
fn example_feud_crossing_stays_below_and_rearms() {
    let mut world = world(104);
    let chooser = body(&world);
    let target = world
        .relations()
        .keys()
        .find_map(|&(from, to)| {
            (from == chooser
                && world.relations()[&(from, to)].tags.has_kinship()
                && matches!(world.persons()[&to].life, Life::Alive { .. }))
            .then_some(to)
        })
        .expect("opening player has living kin");
    let threshold = world.params().grudge_threshold;
    testing::set_relation_affinity(&mut world, chooser, target, threshold);
    let crossing = TickInput {
        tick: Tick(0),
        seq: InputSeq(0),
        payload: InputPayload::Act {
            kind: SocialKind::Quarrel,
            actor: chooser,
            target,
            intensity: 100,
        },
    };
    world.step(&[crossing]);
    assert!(
        world
            .narrator()
            .pending
            .as_ref()
            .is_some_and(|node| node.family == PlayerFamily::Feud)
    );
    world.step(&[]);
    let first_count = world
        .narrator()
        .chronicle
        .entries()
        .iter()
        .filter(|entry| entry.family == PlayerFamily::Feud)
        .count();
    assert_eq!(first_count, 1);
    world.step(&[TickInput {
        tick: world.tick(),
        seq: InputSeq(1),
        payload: InputPayload::Act {
            kind: SocialKind::Quarrel,
            actor: chooser,
            target,
            intensity: 100,
        },
    }]);
    assert_eq!(
        world
            .narrator()
            .chronicle
            .entries()
            .iter()
            .filter(|entry| entry.family == PlayerFamily::Feud)
            .count(),
        first_count
    );
    assert!(
        world
            .narrator()
            .pending
            .as_ref()
            .is_none_or(|node| node.family != PlayerFamily::Feud)
    );
    testing::set_relation_affinity(&mut world, chooser, target, threshold);
    world.step(&[TickInput {
        tick: world.tick(),
        seq: InputSeq(2),
        payload: InputPayload::Act {
            kind: SocialKind::Quarrel,
            actor: chooser,
            target,
            intensity: 100,
        },
    }]);
    assert!(
        world
            .narrator()
            .chronicle
            .entries()
            .iter()
            .filter(|entry| entry.family == PlayerFamily::Feud)
            .count()
            > first_count
            || world
                .narrator()
                .pending
                .as_ref()
                .is_some_and(|node| node.family == PlayerFamily::Feud)
    );
}

#[test]
fn example_life_stage_candidate() {
    let mut world = world(105);
    let chooser = body(&world);
    testing::set_person_birth_day(&mut world, chooser, 0);
    testing::set_player_life(
        &mut world,
        PlayerLife {
            body: chooser,
            start: Tick(0),
            first_fire: None,
            last_fire: None,
        },
    );
    testing::set_tick(&mut world, Tick(2_190));
    world.step(&[]);
    assert_eq!(
        world.narrator().pending.as_ref().map(|node| node.family),
        Some(PlayerFamily::LifeStage)
    );
}

fn assert_snapshot_blocks(world: &World) {
    use serde_json::{Value, json};
    use sim_core::underworld::carry_over::TraitName;
    use sim_core::underworld::slots::{Needed, SlotRef, base_traits, path_status};

    let value: Value = serde_json::from_str(&sim_core::snapshot::snapshot_json(world)).unwrap();
    let current = match world.souls().places[&world.souls().player] {
        SoulPlace::Body(id) => Some(id),
        SoulPlace::Waiting { .. } => None,
    };
    let earlier: Vec<_> = world.persons().values()
        .filter(|p| p.soul == world.souls().player && Some(p.id) != current)
        .map(|p| {
            let Life::Dead { death } = p.life else { panic!("earlier body must be dead") };
            json!({"id":p.id.0,"name":p.name.text(p.sex),"origin":p.origin.as_str(),"death":death.0.to_string()})
        }).collect();
    let mut blood = Vec::new();
    let mut other = Vec::new();
    let mut past = Vec::new();
    for (&(from, to), relation) in world.relations() {
        let living_from = matches!(world.persons()[&from].life, Life::Alive { .. });
        let living_to = matches!(world.persons()[&to].life, Life::Alive { .. });
        if Some(from) == current && living_to {
            let kinship: Vec<_> = relation
                .tags
                .iter()
                .filter(|tag| tag.is_kinship())
                .map(|tag| tag.name())
                .collect();
            let tie = json!({"person":to.0,"affinity":relation.affinity.get(),"kinship":kinship});
            if relation.tags.has_kinship() {
                blood.push(tie);
            } else {
                other.push(tie);
            }
        }
        if living_from && earlier.iter().any(|p| p["id"] == to.0) {
            past.push(
                json!({"rememberer":from.0,"earlier_body":to.0,"affinity":relation.affinity.get()}),
            );
        }
    }
    assert_eq!(
        value["player"],
        json!({
            "place":if current.is_some() { "body" } else { "waiting" },
            "body":current.map(|id| id.0),"earlier_bodies":earlier,
            "blood_ties":blood,"relations":other,"past_life_ties":past
        })
    );
    let stakes = |s: &Stakes| json!({"who":s.who.iter().map(|id| id.0).collect::<Vec<_>>(),"amount":s.amount.to_string(),"unit":s.unit.label(),"by":s.by.0.to_string()});
    let expected_node = world.narrator().pending.as_ref().map(|n| {
        let options: Vec<_> = n.options.iter().map(|o| {
            let preview: Vec<_> = o.preview.iter().map(|p| json!({"person":p.person.0,"what":p.what.label(),"delta":p.delta.to_string()})).collect();
            json!({"id":o.id.label(),"preview":preview})
        }).collect();
        json!({"id":n.id.0.to_string(),"family":n.family.label(),"fired":n.fired.0.to_string(),
            "choice_tick":n.fired.0.saturating_add(1).to_string(),"resolves":n.fired.0.saturating_add(1).to_string(),
            "stakes":stakes(&n.stakes),"options":options,"rules_default":n.rules_default.label()})
    });
    assert_eq!(value["player_node"], json!(expected_node));
    let entries = world.narrator().chronicle.entries();
    let recent = &entries[entries.len().saturating_sub(100)..];
    let chronicle: Vec<_> = recent.iter().map(|e| {
        let skipped: Vec<_> = e.skipped.iter().map(|(part, reason)| json!({"part":part,"reason":reason.label()})).collect();
        json!({"tick":e.tick.0.to_string(),"family":e.family.label(),"stakes":stakes(&e.stakes),
            "applied":e.applied.label(),"source":e.source.label(),"chooser_absent":e.chooser_absent,"skipped":skipped})
    }).collect();
    assert_eq!(value["chronicle"], json!(chronicle));
    let traits = |t: &sim_core::values::Traits| json!({"greed":t.greed.get(),"loyalty":t.loyalty.get(),"pride":t.pride.get(),"warmth":t.warmth.get(),"temper":t.temper.get(),"vindictiveness":t.vindictiveness.get(),"piety":t.piety.get()});
    let expected_view = world.player_wait().map(|wait| {
        let mut slots: Vec<_> = world.slots().values().map(|s| (SlotRef::Birth(s.id),format!("birth:{}",s.id.0),"birth_slot",0,Some(s.birth.0.to_string()))).collect();
        slots.push((SlotRef::ImportedVessel,"imported_vessel".to_owned(),"imported_vessel",world.params().imported_price,None));
        slots.push((SlotRef::RebuiltBody,"rebuilt_body".to_owned(),"rebuilt_body",world.params().rebuilt_price,None));
        let slots: Vec<_> = slots.into_iter().map(|(slot,id,kind,price,birth)| {
            let status = path_status(world, slot);
            let needed: Vec<_> = status.needed.iter().map(|n| match n {
                Needed::WaitUntil(t) => json!({"kind":"wait_until","tick":t.0.to_string()}),
                Needed::JossShort(a) => json!({"kind":"joss_short","amount":a.to_string()}),
                Needed::CapRoomShort(a) => json!({"kind":"cap_room_short","amount":a.to_string()}),
                Needed::Named(name) => json!({"kind":"named","name":name}),
            }).collect();
            json!({"slot":id,"kind":kind,"price":price.to_string(),"birth":birth,"status":{
                "announced":status.announced,"claimable":status.claimable,"affordable":status.affordable,"needed":needed}})
        }).collect();
        let bases: Vec<_> = std::iter::once(None).chain(TraitName::ALL.into_iter().map(Some))
            .map(|carry| json!({"carry_over":carry.map(|t| match t {
                TraitName::Greed => "greed", TraitName::Loyalty => "loyalty", TraitName::Pride => "pride",
                TraitName::Warmth => "warmth", TraitName::Temper => "temper", TraitName::Vindictiveness => "vindictiveness", TraitName::Piety => "piety",
            }),"traits":traits(&base_traits(world,carry).unwrap())})).collect();
        json!({"connected":sim_core::underworld::ghosts::connected(world,wait.ghost).iter().map(|id|id.0).collect::<Vec<_>>(),
            "dream_price":world.params().dream_price.to_string(),
            "ghost_traits":traits(&world.persons()[&wait.ghost].traits),"slots":slots,"base_traits":bases})
    });
    assert_eq!(value["underworld_view"], json!(expected_view));
    let last_dream = world.nodes().resolved.iter().rev().find(|record| {
        record.family == sim_core::underworld::nodes::NodeFamily::DreamInterpretation
    });
    match last_dream {
        Some(record) => assert_eq!(
            value.get("last_dream"),
            Some(
                &json!({"tick":record.tick.0.to_string(),"dreamer":record.subject.0,
                "applied":record.applied.id()})
            )
        ),
        None => assert!(value.get("last_dream").is_none()),
    }
    let mut referenced = std::collections::BTreeSet::new();
    if let Some(id) = current {
        referenced.insert(id.0);
    }
    for p in &earlier {
        referenced.insert(p["id"].as_u64().unwrap());
    }
    for tie in blood.iter().chain(&other) {
        referenced.insert(tie["person"].as_u64().unwrap());
    }
    for tie in &past {
        referenced.insert(tie["rememberer"].as_u64().unwrap());
        referenced.insert(tie["earlier_body"].as_u64().unwrap());
    }
    if let Some(n) = &world.narrator().pending {
        referenced.extend(n.stakes.who.iter().map(|id| id.0));
        referenced.extend(
            n.options
                .iter()
                .flat_map(|o| o.preview.iter().map(|p| p.person.0)),
        );
    }
    referenced.extend(
        recent
            .iter()
            .flat_map(|e| e.stakes.who.iter().map(|id| id.0)),
    );
    if let Some(record) = last_dream {
        referenced.insert(record.subject.0);
    }
    let names: Vec<_> = world
        .persons()
        .values()
        .filter(|p| referenced.contains(&p.id.0) && matches!(p.life, Life::Dead { .. }))
        .map(|p| json!({"id":p.id.0,"name":p.name.text(p.sex)}))
        .collect();
    assert_eq!(value["person_names"], json!(names));
}

// Feature: first-playable, Property 15: The Snapshot reports the World exactly and changes nothing
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_15_snapshot_reports_generated_runs(scenario in underworld_gen::arb_scenario()) {
        let mut run = underworld_gen::Run::new(scenario);
        for _ in 0..underworld_gen::TICKS {
            let (mut before, after, _) = run.step();
            let checksum = sim_core::checksum::Checksum::of(&before);
            assert_snapshot_blocks(&before);
            prop_assert_eq!(sim_core::checksum::Checksum::of(&before),checksum);
            assert_snapshot_blocks(&after);
            prop_assert_eq!(before.step(&run.last_inputs),sim_core::checksum::Checksum::of(&after));
        }
    }
}

// Feature: first-playable, Property 17: Replay format 5 round-trips and replays exactly
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn property_17_replay_round_trip_and_version_rejection(
        scenario in underworld_gen::arb_scenario(),
        id in any::<u64>(),
        option in 0usize..PlayerOption::ALL.len(),
        value in any::<i8>(),
        delta in prop_oneof![Just(-1i8), Just(1i8)],
    ) {
        use sim_core::ids::BirthSlotId;
        use sim_core::replay::{ReplayError, ReplayFile, record, verify};
        use sim_core::underworld::carry_over::TraitName;
        use sim_core::underworld::customization::Customization;
        use sim_core::underworld::dreams::DreamIntent;
        use sim_core::underworld::nodes::{NodeOption, NodeRef};
        use sim_core::underworld::slots::SlotRef;

        let run = underworld_gen::driven(scenario);
        let mut inputs: Vec<_> = run.sim.inputs().all().iter()
            .map(|input| (input.tick, input.payload)).collect();
        // Every case covers every DTO arm, both customizations and an omitted None.
        // These inputs may be rejected at apply time; do not filter them out.
        let payloads = [
            InputPayload::Act {
                kind: SocialKind::Help, actor: PersonId(id), target: PersonId(1), intensity: 40,
            },
            InputPayload::ClaimSlot { slot: SlotRef::Birth(BirthSlotId(id)), customization: None },
            InputPayload::ClaimSlot { slot: SlotRef::ImportedVessel, customization: None },
            InputPayload::ClaimSlot {
                slot: SlotRef::RebuiltBody,
                customization: Some(Customization::Set { trait_name: TraitName::Piety, value }),
            },
            InputPayload::ClaimSlot {
                slot: SlotRef::RebuiltBody,
                customization: Some(Customization::Adjust {
                    first: (TraitName::Greed, delta), second: (TraitName::Warmth, -delta),
                }),
            },
            InputPayload::Haunt { target: PersonId(id) },
            InputPayload::Bribe { amount: id },
            InputPayload::CarryOver { trait_name: TraitName::Piety },
            InputPayload::Dream { dreamer: PersonId(id), intent: DreamIntent::Warn },
            InputPayload::Choose {
                node: NodeRef::Trigger { seq: InputSeq(id) },
                option: NodeOption::HeedWarning,
                fingerprint: None,
            },
            InputPayload::ChoosePlayer { node: NodeId(id), option: PlayerOption::ALL[option] },
        ];
        inputs.extend(payloads.map(|payload| (Tick(0), payload)));
        // The replay format has no Params field: reuse stress-generated inputs, but
        // record/verify with the public replay contract's DEFAULT Params (design:713 deviation).
        let config = WorldConfig::try_new(scenario.residents).unwrap();
        let file = record(scenario.seed, config, &inputs, underworld_gen::TICKS).unwrap();
        prop_assert_eq!(file.version, 5);
        let json = file.to_json_string().unwrap();
        let back = ReplayFile::from_json_str(&json).unwrap();
        prop_assert_eq!(&back, &file);
        prop_assert_eq!(back.to_json_string().unwrap(), json);
        prop_assert_eq!(verify(&back), Ok(()));
        for found in [2, 3, 4] {
            let mut old = file.clone();
            old.version = found;
            let expected = Err(ReplayError::UnsupportedVersion { found });
            prop_assert_eq!(ReplayFile::from_json_str(&old.to_json_string().unwrap()), expected.clone());
            prop_assert_eq!(verify(&old), expected.map(|_| ()));
        }
    }
}

// Feature: first-playable, Property 17: Replay format 5 round-trips and replays exactly
#[test]
fn property_17_first_player_node_replays_from_both_sources() {
    use sim_core::replay::{ReplayFile, record, verify};
    use sim_core::tick::Sim;

    for seed in 1..=5 {
        for answer in [false, true] {
            let config = WorldConfig::default();
            let mut live = Sim::new(seed, config).unwrap();
            for _ in 0..1_000 {
                if live.world().narrator().pending.is_some() {
                    break;
                }
                live.step();
            }
            let pending = live
                .world()
                .narrator()
                .pending
                .as_ref()
                .expect("the real first Player_Node must fire")
                .clone();
            assert_eq!(
                live.world().narrator().life.as_ref().unwrap().first_fire,
                Some(pending.fired)
            );
            let choice_tick = live.world().tick();
            assert_eq!(choice_tick.0, pending.fired.0 + 1);
            let chosen = if answer {
                pending
                    .options
                    .iter()
                    .map(|option| option.id)
                    .find(|option| *option != pending.rules_default)
                    .expect("a non-default choice")
            } else {
                pending.rules_default
            };
            let mut inputs = Vec::new();
            if answer {
                let payload = InputPayload::ChoosePlayer {
                    node: pending.id,
                    option: chosen,
                };
                live.submit(choice_tick, payload).unwrap();
                inputs.push((choice_tick, payload));
            }
            live.step();
            if answer {
                assert_eq!(live.last_outcomes()[0].result, Ok(()));
            }
            let source = if answer {
                EntrySource::External
            } else {
                EntrySource::RulesDefault
            };
            let entry = live
                .world()
                .narrator()
                .chronicle
                .entries()
                .iter()
                .find(|entry| entry.node == Some(pending.id))
                .expect("first node resolved");
            assert_eq!(entry.tick, choice_tick);
            assert_eq!(entry.applied, chosen);
            assert_eq!(entry.source, source);
            assert!(!entry.chooser_absent);

            let file = record(seed, config, &inputs, live.world().tick().0).unwrap();
            assert_eq!(file.checksums, live.checksums());
            let json = file.to_json_string().unwrap();
            let replay = ReplayFile::from_json_str(&json).unwrap();
            assert_eq!(replay.to_json_string().unwrap(), json);
            assert_eq!(verify(&replay), Ok(()));
            let mut played = Sim::new(replay.seed, replay.config.try_into().unwrap()).unwrap();
            for input in &replay.inputs {
                played
                    .submit(Tick(input.tick), input.payload.into())
                    .unwrap();
            }
            for expected in &replay.checksums {
                assert_eq!(played.step(), *expected);
            }
            assert_eq!(
                played.world().narrator().chronicle,
                live.world().narrator().chronicle
            );
            let observed = played
                .world()
                .narrator()
                .chronicle
                .entries()
                .iter()
                .find(|entry| entry.node == Some(pending.id))
                .unwrap();
            assert_eq!(observed.source, source);
            assert_eq!(observed.applied, chosen);
            println!(
                "C2 replay seed={seed} first_node={} fired={} resolved={} family={} source={} applied={} ticks={} parity=ok",
                pending.id.0,
                pending.fired.0,
                observed.tick.0,
                observed.family.label(),
                observed.source.label(),
                observed.applied.label(),
                replay.ticks,
            );
        }
    }
}
