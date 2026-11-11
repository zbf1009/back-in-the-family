//! Property 15: contexts built from the live World are valid cards (R15).
//!
//! Every case runs a generated Life_Sim (the shared `life_gen` scenario), then checks
//! every open Debt with a Resident debtor at the Opening_World and after a sampled
//! number of ticks: the context from `debt_repayment_node` is accepted by the card JSON
//! reader after the JSON round trip, renders through the committed
//! System_One_Mapping_v1 for every permutation, answers the exact option IDs through
//! `validate_raw_choice`, carries only values the World holds and stays inside the card
//! ranges.
//!
//! `// Feature: life-sim, Property 15: Contexts built from the live World are valid cards.`

mod life_gen;

use std::collections::BTreeSet;

use proptest::prelude::*;
use sim_core::context_builder::debt_repayment_node;
use sim_core::ids::{EventId, PersonId};
use sim_core::llm::api::frozen_context_to_json;
use sim_core::llm::card::frozen_context_from_json;
use sim_core::llm::render::permutations;
use sim_core::llm::system_one::render_system_one;
use sim_core::llm::validate::validate_raw_choice;
use sim_core::llm::{FrozenContext, IllegalReason, TaskSpec, Verdict};
use sim_core::names::{FEMALE_FIRST, MALE_FIRST, SURNAMES};
use sim_core::values::{RelationTag, Sex};
use sim_core::world::Life;
use sim_core::world::World;

/// The committed System_One_Mapping_v1 (R15.8: never edited by this spec).
const SYSTEM_ONE_V1: &str =
    include_str!("../../../eval/probe/templates/decision.system_one.v1.txt");

/// Every event type this spec produces, from the card event-type list.
const EVENT_TYPES: [&str; 16] = [
    "birth",
    "death",
    "marriage",
    "loan",
    "repayment",
    "debt_transfer",
    "debt_forgiven",
    "inheritance",
    "possession",
    "rebuild",
    "help",
    "gift",
    "quarrel",
    "insult",
    "theft",
    "apology",
];

/// Every card event tag name.
const EVENT_TAGS: [&str; 13] = [
    "public",
    "private",
    "witnessed",
    "written",
    "verbal",
    "partial",
    "cash",
    "joss_paper",
    "land",
    "house",
    "shop",
    "heirloom",
    "deathbed",
];

/// Checks every open Debt whose debtor is a Resident and returns how many contexts were
/// checked.
fn check_all_debt_contexts(world: &World) -> usize {
    let mut checked = 0usize;
    for (&loan, debt) in world.debts() {
        let debtor = world
            .persons()
            .get(&debt.debtor)
            .expect("a Debt names a Person");
        if !matches!(debtor.life, Life::Alive { .. }) {
            continue;
        }
        let context = debt_repayment_node(world, loan).expect("the debt node builds");
        check_context(world, &context);
        checked = checked.saturating_add(1);
    }
    checked
}

fn check_context(world: &World, ctx: &FrozenContext) {
    // The subject is in `people`, and ids use the OP-10 formats.
    let subject = ctx.subject.expect("a decision context has a subject");
    assert!(
        ctx.people.iter().any(|p| p.id == subject),
        "the subject {} is missing from people",
        subject.0
    );
    check_people(world, ctx);
    check_relations(world, ctx);
    check_events(world, ctx);

    // A situation of at most 80 words, from the fixed template (R15.3).
    let words = ctx.situation.split_whitespace().count();
    assert!(
        words <= 80,
        "the situation has {words} words: {}",
        ctx.situation
    );

    // R15.4: the JSON round trip returns the same context.
    let json = frozen_context_to_json(ctx);
    assert_eq!(
        frozen_context_from_json(json.clone()),
        Ok(ctx.clone()),
        "the context does not survive the JSON round trip"
    );

    // R15.5: every kept permutation renders through System_One_Mapping_v1.
    let perms = permutations(ctx);
    assert_eq!(
        perms.first(),
        Some(&sim_core::llm::render::Permutation::Base)
    );
    for perm in perms {
        let rendered = render_system_one(ctx, SYSTEM_ONE_V1, perm);
        assert!(rendered.is_ok(), "rendering {perm:?} failed: {rendered:?}");
    }

    // R15.6 and R15.7: exact option IDs give a Decision; anything else is out of set.
    let TaskSpec::Decision { options } = &ctx.spec else {
        panic!("the debt node is a decision context");
    };
    assert!((2..=5).contains(&options.len()));
    for option in options {
        assert_eq!(
            validate_raw_choice(options, option.id.as_str()),
            Verdict::Decision {
                option: option.id.clone()
            }
        );
        let non_option = format!("{}_not_an_option", option.id.as_str());
        assert!(
            !options.iter().any(|o| o.id.as_str() == non_option),
            "the generated non-option {non_option:?} is an option"
        );
        match validate_raw_choice(options, &non_option) {
            Verdict::Illegal { reason, .. } => {
                assert_eq!(reason, IllegalReason::OutOfSetOption)
            }
            other => panic!("{non_option:?} should be out of set, got {other:?}"),
        }
    }
    for other in ["", "Repay", " repay", "repay "] {
        assert!(!options.iter().any(|o| o.id.as_str() == other));
        if let Verdict::Illegal { reason, .. } = validate_raw_choice(options, other) {
            assert_eq!(reason, IllegalReason::OutOfSetOption);
        } else {
            panic!("{other:?} should be out of set");
        }
    }
}

fn check_people(world: &World, ctx: &FrozenContext) {
    let people: Vec<PersonId> = ctx
        .people
        .iter()
        .map(|p| PersonId(u64::try_from(p.id.0).expect("a card person id is positive")))
        .collect();
    assert!(
        people.windows(2).all(|pair| pair[0] < pair[1]),
        "people are not in ascending ID order"
    );
    for person in &ctx.people {
        assert!(person.id.0 >= 1, "card person id {} < 1", person.id.0);
        assert!((0..=999).contains(&person.age), "age {}", person.age);
        assert!(person.wealth >= 0, "wealth {}", person.wealth);
        assert!(matches!(person.sex.as_str(), "female" | "male"));
        assert!(matches!(
            person.origin.as_str(),
            "native" | "possessed" | "rebuilt" | "official"
        ));
        for trait_value in [
            person.traits.greed,
            person.traits.loyalty,
            person.traits.pride,
            person.traits.warmth,
            person.traits.temper,
            person.traits.vindictiveness,
            person.traits.piety,
        ] {
            assert!((-3..=3).contains(&trait_value), "trait {trait_value}");
        }

        let live = world
            .persons()
            .get(&PersonId(u64::try_from(person.id.0).expect("positive")))
            .expect("every context person is a World Person");
        assert_eq!(person.alive, matches!(live.life, Life::Alive { .. }));
        assert_eq!(person.age, i64::from(world.age_years(live)));
        assert_eq!(
            person.wealth,
            i64::try_from(world.wealth(live.id)).expect("wealth fits in i64")
        );
        assert_eq!(person.sex, live.sex.as_str());
        assert_eq!(person.origin, live.origin.as_str());
        assert_eq!(person.soul_id, format!("S-{:04}", live.soul.0));
        assert_eq!(person.name, full_name(live));
        assert_eq!(person.traits.greed, i64::from(live.traits.greed.get()));
        assert_eq!(person.traits.loyalty, i64::from(live.traits.loyalty.get()));
        assert_eq!(person.traits.pride, i64::from(live.traits.pride.get()));
        assert_eq!(person.traits.warmth, i64::from(live.traits.warmth.get()));
        assert_eq!(person.traits.temper, i64::from(live.traits.temper.get()));
        assert_eq!(
            person.traits.vindictiveness,
            i64::from(live.traits.vindictiveness.get())
        );
        assert_eq!(person.traits.piety, i64::from(live.traits.piety.get()));
    }
}

fn full_name(person: &sim_core::world::Person) -> String {
    let first_names: &[&str] = match person.sex {
        Sex::Female => &FEMALE_FIRST,
        Sex::Male => &MALE_FIRST,
    };
    let first = first_names
        .get(usize::from(person.name.first))
        .copied()
        .expect("the first-name index is in range");
    let surname = SURNAMES
        .get(usize::from(person.name.surname))
        .copied()
        .expect("the surname index is in range");
    format!("{first} {surname}")
}

fn check_relations(world: &World, ctx: &FrozenContext) {
    let people: BTreeSet<i64> = ctx.people.iter().map(|p| p.id.0).collect();
    for relation in &ctx.relations {
        assert!((-100..=100).contains(&relation.affinity));
        assert!((-100..=100).contains(&relation.trust));
        assert_ne!(relation.from, relation.to, "a Relation to itself");
        assert!(people.contains(&relation.from.0) && people.contains(&relation.to.0));
        let tag_names: Vec<&str> = relation.tags.iter().map(String::as_str).collect();
        assert!(
            tag_names
                .iter()
                .all(|tag| RelationTag::from_name(tag).is_some())
        );
        let live = world
            .relations()
            .get(&(
                PersonId(u64::try_from(relation.from.0).expect("positive")),
                PersonId(u64::try_from(relation.to.0).expect("positive")),
            ))
            .expect("every context relation is a World Relation");
        assert_eq!(relation.affinity, i64::from(live.affinity.get()));
        assert_eq!(relation.trust, i64::from(live.trust.get()));
        let expected: Vec<&str> = live.tags.names().collect();
        assert_eq!(tag_names, expected);
    }
    // Every World Relation whose both ends are in `people` is present.
    let context_pairs: BTreeSet<(i64, i64)> =
        ctx.relations.iter().map(|r| (r.from.0, r.to.0)).collect();
    for &(from, to) in world.relations().keys() {
        let pair = (
            i64::try_from(from.0).expect("positive"),
            i64::try_from(to.0).expect("positive"),
        );
        if people.contains(&pair.0) && people.contains(&pair.1) {
            assert!(
                context_pairs.contains(&pair),
                "the relation {pair:?} is missing from the context"
            );
        }
    }
}

fn check_events(world: &World, ctx: &FrozenContext) {
    let subject = ctx.subject.expect("a decision context has a subject");
    let subject = PersonId(u64::try_from(subject.0).expect("positive"));
    let chosen: Vec<_> = world
        .log()
        .events()
        .iter()
        .filter(|event| event.kind.actors().iter().any(|actor| actor == subject))
        .collect();
    let first = chosen
        .len()
        .saturating_sub(sim_core::context_builder::MAX_EVENTS);
    let chosen = &chosen[first..];
    assert_eq!(
        ctx.events.len(),
        chosen.len(),
        "the 12-event window differs"
    );

    let index_of = |id: EventId| -> Option<usize> {
        chosen
            .iter()
            .position(|event| event.id == id)
            .map(|i| i.saturating_add(1))
    };

    let mut seen: BTreeSet<String> = BTreeSet::new();
    for (position, card_event) in ctx.events.iter().enumerate() {
        let expected_id = position.saturating_add(1);
        assert_eq!(card_event.id.as_str(), format!("e{expected_id}"));
        assert!(seen.insert(card_event.id.as_str().to_owned()));
        assert!(EVENT_TYPES.contains(&card_event.kind.as_str()));
        assert!(card_event.tick >= 0);
        assert!(!card_event.actors.is_empty());
        assert!(card_event.magnitude >= 0);
        for tag in &card_event.tags {
            assert!(EVENT_TAGS.contains(&tag.as_str()), "unknown tag {tag}");
        }
        if let Some(due) = card_event.due_tick {
            assert!(due >= 0);
            assert_eq!(card_event.kind, "loan");
        } else {
            assert_ne!(card_event.kind, "loan", "a loan needs a due tick");
        }
        if position > 0 {
            assert!(
                ctx.events[position - 1].tick <= card_event.tick,
                "events are not sorted by tick"
            );
        }
        for cause in &card_event.caused_by {
            assert!(
                seen.contains(cause.as_str()) && cause.as_str() != card_event.id.as_str(),
                "cause {cause:?} is not an earlier context event"
            );
        }

        let live = &chosen[position];
        assert_eq!(
            card_event.tick,
            i64::try_from(live.tick.0).expect("tick fits")
        );
        assert_eq!(card_event.kind, live.kind.card_type());
        let actors: Vec<i64> = live
            .kind
            .actors()
            .iter()
            .map(|a| i64::try_from(a.0).expect("positive"))
            .collect();
        assert_eq!(
            card_event.actors.iter().map(|a| a.0).collect::<Vec<_>>(),
            actors
        );
        assert_eq!(
            card_event.magnitude,
            i64::try_from(live.kind.magnitude()).expect("magnitude fits")
        );
        assert_eq!(
            card_event.due_tick,
            live.kind
                .due_tick()
                .map(|due| i64::try_from(due.0).expect("tick fits"))
        );
        let tags: Vec<&str> = live.tags.names().collect();
        assert_eq!(
            card_event
                .tags
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            tags
        );
        let causes: Vec<String> = live
            .caused_by
            .iter()
            .filter_map(&index_of)
            .map(|n| format!("e{n}"))
            .collect();
        assert_eq!(
            card_event
                .caused_by
                .iter()
                .map(|c| c.as_str().to_owned())
                .collect::<Vec<_>>(),
            causes
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 120, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 15: Contexts built from the live World are valid cards.
    #[test]
    fn property_15_contexts_built_from_the_live_world_are_valid_cards(
        scenario in life_gen::arb_scenario(),
        advance in 0u64..=life_gen::TICKS,
    ) {
        let mut sim = scenario.sim();
        let opening = check_all_debt_contexts(sim.world());
        prop_assert!(opening > 0, "the Opening_World has at least one open Debt");
        for _ in 0..advance {
            sim.step();
        }
        check_all_debt_contexts(sim.world());
    }
}
