//! Public-seam property tests for the Narrator's first-playable contract.
//!
//! These tests deliberately drive `World::step`/`step_with_outcomes`; constructed player
//! nodes use only the test-support fixture helpers, never narrator implementation internals.

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
use sim_core::values::{Intensity, SocialKind};
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
