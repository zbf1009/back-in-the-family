//! Property 18: snapshots are faithful and read-only (R18.1, R18.2).
//!
//! Every case runs two identical generated runs. Both take one tick at a time; only one
//! calls `snapshot_json` after every tick. The two runs must produce the same Checksum
//! at every tick, and the Snapshot taken at a sampled tick must list every Resident,
//! Household and Soul exactly once, in ascending ID order, with the values the World
//! holds at that tick.
//!
//! `// Feature: life-sim, Property 18: Snapshots are faithful and read-only.`

mod life_gen;

use proptest::prelude::*;
use serde_json::{Value, json};
use sim_core::checksum::Checksum;
use sim_core::ids::{PersonId, Tick};
use sim_core::input::InputPayload;
use sim_core::params::Params;
use sim_core::snapshot::snapshot_json;
use sim_core::testing::{Mutation, apply, prepare_player_wait, set_invalid_joss_account};
use sim_core::tick::Sim;
use sim_core::underworld::dreams::DreamIntent;
use sim_core::underworld::nodes::NodeFamily;
use sim_core::underworld::slots::SlotRef;
use sim_core::world::{Life, SoulPlace, World, WorldConfig};

/// Checks that `json` is the Snapshot of `world` (R18.1).
fn check_snapshot(world: &World, json: &str) {
    let value: Value = serde_json::from_str(json).expect("the Snapshot is JSON");
    assert_eq!(
        value["tick"].as_str(),
        Some(world.tick().0.to_string().as_str()),
        "tick"
    );
    assert_eq!(
        value["player_soul"].as_str(),
        Some(format!("S-{:04}", world.souls().player.0).as_str()),
        "player_soul"
    );

    // Residents: every Resident exactly once, ascending, with the World's values.
    let residents = value["residents"].as_array().expect("residents array");
    let expected: Vec<&sim_core::world::Person> = world
        .persons()
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .collect();
    assert_eq!(residents.len(), expected.len(), "resident count");
    let mut previous: Option<u64> = None;
    for (entry, person) in residents.iter().zip(&expected) {
        let id = entry["id"].as_u64().expect("numeric id");
        assert_eq!(id, person.id.0, "residents are in ascending ID order");
        assert!(previous.is_none_or(|p| p < id), "duplicate or unsorted id");
        previous = Some(id);
        assert_eq!(
            entry["name"].as_str(),
            Some(person.name.text(person.sex).as_str())
        );
        assert_eq!(
            entry["age"].as_u64(),
            Some(u64::from(world.age_years(person)))
        );
        assert_eq!(entry["sex"].as_str(), Some(person.sex.as_str()));
        assert_eq!(entry["alive"], Value::Bool(true));
        assert_eq!(entry["origin"].as_str(), Some(person.origin.as_str()));
        assert_eq!(entry["wealth"].as_u64(), Some(world.wealth(person.id)));
        assert_eq!(
            entry["soul_id"].as_str(),
            Some(format!("S-{:04}", person.soul.0).as_str())
        );
        let Life::Alive { household, .. } = person.life else {
            panic!("filtered to Residents");
        };
        assert_eq!(
            entry["household"].as_str(),
            Some(household.0.to_string().as_str())
        );
        let traits = &entry["traits"];
        assert_eq!(
            traits["greed"].as_i64(),
            Some(i64::from(person.traits.greed.get()))
        );
        assert_eq!(
            traits["loyalty"].as_i64(),
            Some(i64::from(person.traits.loyalty.get()))
        );
        assert_eq!(
            traits["pride"].as_i64(),
            Some(i64::from(person.traits.pride.get()))
        );
        assert_eq!(
            traits["warmth"].as_i64(),
            Some(i64::from(person.traits.warmth.get()))
        );
        assert_eq!(
            traits["temper"].as_i64(),
            Some(i64::from(person.traits.temper.get()))
        );
        assert_eq!(
            traits["vindictiveness"].as_i64(),
            Some(i64::from(person.traits.vindictiveness.get()))
        );
        assert_eq!(
            traits["piety"].as_i64(),
            Some(i64::from(person.traits.piety.get()))
        );
    }

    // Households: every Household exactly once, ascending, with its members.
    let households = value["households"].as_array().expect("households array");
    assert_eq!(
        households.len(),
        world.households().len(),
        "household count"
    );
    let mut previous: Option<u64> = None;
    for (entry, &id) in households.iter().zip(world.households().keys()) {
        let parsed: u64 = entry["id"]
            .as_str()
            .expect("household ids are strings")
            .parse()
            .expect("decimal household id");
        assert_eq!(parsed, id.0);
        assert!(previous.is_none_or(|p| p < parsed), "unsorted household id");
        previous = Some(parsed);
        let members: Vec<u64> = entry["members"]
            .as_array()
            .expect("members array")
            .iter()
            .map(|m| m.as_u64().expect("numeric member id"))
            .collect();
        let expected: Vec<u64> = world
            .household_members(id)
            .into_iter()
            .map(|member| member.0)
            .collect();
        assert_eq!(members, expected, "members of household {}", id.0);
    }

    // Souls: every Soul exactly once, ascending, with its one Soul_Place.
    let souls = value["souls"].as_array().expect("souls array");
    assert_eq!(souls.len(), world.souls().places.len(), "soul count");
    let mut previous: Option<&str> = None;
    for (entry, (&soul, place)) in souls.iter().zip(&world.souls().places) {
        let text = entry["soul_id"].as_str().expect("soul ids are strings");
        assert_eq!(text, format!("S-{:04}", soul.0));
        assert!(
            previous.is_none_or(|p| p < text),
            "duplicate or unsorted soul id"
        );
        previous = Some(text);
        match place {
            SoulPlace::Body(person) => {
                assert_eq!(
                    entry["place"]["body"].as_u64(),
                    Some(person.0),
                    "soul {} body",
                    soul.0
                );
                assert!(entry["place"].get("waiting").is_none());
            }
            SoulPlace::Waiting { since } => {
                assert_eq!(
                    entry["place"]["waiting"]["since"].as_str(),
                    Some(since.0.to_string().as_str()),
                    "soul {} since",
                    soul.0
                );
                assert!(entry["place"].get("body").is_none());
            }
        }
    }

    // Every resident id is a live Person of the World (spot check of the mapping).
    for entry in residents {
        let id = PersonId(entry["id"].as_u64().expect("numeric id"));
        assert!(world.persons().contains_key(&id));
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: life-sim, Property 18: Snapshots are faithful and read-only.
    #[test]
    fn property_18_snapshots_are_faithful_and_read_only(
        scenario in life_gen::arb_scenario(),
        sample in 0u64..=life_gen::TICKS,
    ) {
        // Two identical runs: only the first takes Snapshots.
        let mut with = scenario.sim();
        let mut without = scenario.sim();
        let mut last = Checksum::of(with.world());
        for step in 0..=life_gen::TICKS {
            let json = snapshot_json(with.world());
            // R18.2: taking a Snapshot cannot change the World.
            prop_assert_eq!(Checksum::of(with.world()), last);
            if step == sample {
                check_snapshot(with.world(), &json);
            }
            if step < life_gen::TICKS {
                let a = with.step();
                let b = without.step();
                prop_assert_eq!(a, b, "taking Snapshots changed tick {}", step);
                last = a;
            }
        }
        prop_assert_eq!(with.checksums(), without.checksums());
    }
}

fn waiting_for_snapshot(params: Params, access_from: Option<Tick>) -> (World, PersonId) {
    let mut world = World::new_with_params(22, WorldConfig::try_new(40).unwrap(), params).unwrap();
    let ghost = prepare_player_wait(&mut world, Tick(0), access_from, None);
    let dreamer = sim_core::underworld::ghosts::connected(&world, ghost)
        .into_iter()
        .next()
        .expect("the opening body has living kin");
    let player = world.souls().player;
    let mut account = world.joss()[&player];
    account.balance = params
        .dream_price
        .saturating_add(params.imported_price)
        .saturating_add(100);
    set_invalid_joss_account(&mut world, player, account);
    (world, dreamer)
}

fn read_snapshot(world: &World) -> Value {
    let checksum = Checksum::of(world);
    let text = snapshot_json(world);
    assert_eq!(snapshot_json(world), text);
    assert_eq!(Checksum::of(world), checksum);
    serde_json::from_str(&text).unwrap()
}

#[test]
fn dream_price_is_read_from_default_and_stress_params() {
    for params in [Params::DEFAULT, Params::stress_underworld()] {
        let (world, _) = waiting_for_snapshot(params, None);
        let value = read_snapshot(&world);
        assert_eq!(
            value["underworld_view"]["dream_price"],
            world.params().dream_price.to_string()
        );
    }
}

#[test]
fn last_dream_is_omitted_until_a_real_dream_resolves() {
    let opening = World::new(22, WorldConfig::try_new(40).unwrap()).unwrap();
    assert!(read_snapshot(&opening).get("last_dream").is_none());
    let (world, dreamer) = waiting_for_snapshot(Params::DEFAULT, None);
    let mut sim = Sim::from_test_world(world);
    assert!(read_snapshot(sim.world()).get("last_dream").is_none());
    sim.try_submit_all(&[InputPayload::Dream {
        dreamer,
        intent: DreamIntent::Warn,
    }])
    .unwrap();
    assert!(read_snapshot(sim.world()).get("last_dream").is_none());
    let stopped = sim.run_until_stop(20);
    assert_eq!(stopped.ran, 1);
    assert!(stopped.stops.dream_resolved);
    let record = sim
        .world()
        .nodes()
        .resolved
        .iter()
        .rev()
        .find(|record| record.family == NodeFamily::DreamInterpretation)
        .unwrap();
    let value = read_snapshot(sim.world());
    assert_eq!(
        value["last_dream"],
        json!({"tick": record.tick.0.to_string(), "dreamer": record.subject.0,
            "applied": record.applied.id()})
    );
    assert_eq!(record.subject, dreamer);
    assert_eq!(value["last_dream"]["tick"], "0");
    assert_eq!(value["tick"], "1");
    let last = value["last_dream"].clone();
    sim.step();
    assert_eq!(read_snapshot(sim.world())["last_dream"], last);
}

#[test]
fn last_dream_selects_the_latest_real_resolved_record() {
    let (world, dreamer) = waiting_for_snapshot(Params::DEFAULT, None);
    let mut sim = Sim::from_test_world(world);
    for intent in [DreamIntent::Warn, DreamIntent::Reassure] {
        sim.try_submit_all(&[InputPayload::Dream { dreamer, intent }])
            .unwrap();
        sim.step();
    }
    let records: Vec<_> = sim
        .world()
        .nodes()
        .resolved
        .iter()
        .filter(|record| record.family == NodeFamily::DreamInterpretation)
        .collect();
    assert_eq!(records.len(), 2);
    let last = records[1];
    assert_eq!(
        read_snapshot(sim.world())["last_dream"],
        json!({"tick": last.tick.0.to_string(), "dreamer": last.subject.0,
            "applied": last.applied.id()})
    );
}

#[test]
fn last_dream_survives_a_same_tick_dream_and_standing_claim() {
    let (world, dreamer) = waiting_for_snapshot(Params::DEFAULT, Some(Tick(0)));
    let mut sim = Sim::from_test_world(world);
    sim.try_submit_all(&[
        InputPayload::Dream {
            dreamer,
            intent: DreamIntent::Warn,
        },
        InputPayload::ClaimSlot {
            slot: SlotRef::ImportedVessel,
            customization: None,
        },
    ])
    .unwrap();
    let stopped = sim.run_until_stop(20);
    assert_eq!(stopped.ran, 1);
    assert_eq!(stopped.stops.labels(), ["dream_resolved", "player_reborn"]);
    assert!(
        sim.last_outcomes()
            .iter()
            .all(|outcome| outcome.result.is_ok())
    );
    let value = read_snapshot(sim.world());
    assert!(value["underworld_view"].is_null());
    let record = sim.world().nodes().resolved.last().unwrap();
    assert_eq!(record.family, NodeFamily::DreamInterpretation);
    assert_eq!(
        value["last_dream"],
        json!({"tick": record.tick.0.to_string(), "dreamer": record.subject.0,
            "applied": record.applied.id()})
    );
}

#[test]
fn last_dream_names_a_dreamer_who_has_since_died() {
    let (world, dreamer) = waiting_for_snapshot(Params::DEFAULT, None);
    let mut sim = Sim::from_test_world(world);
    sim.try_submit_all(&[InputPayload::Dream {
        dreamer,
        intent: DreamIntent::Warn,
    }])
    .unwrap();
    sim.step();
    let mut world = sim.world().clone();
    let selector = world
        .persons()
        .keys()
        .position(|id| *id == dreamer)
        .unwrap();
    assert!(apply(
        &mut world,
        Mutation::PersonField {
            person: u64::try_from(selector).unwrap(),
            part: 11,
        }
    ));
    let person = &world.persons()[&dreamer];
    assert!(matches!(person.life, Life::Dead { .. }));
    let value = read_snapshot(&world);
    let expected = json!({"id": dreamer.0, "name": person.name.text(person.sex)});
    assert!(
        value["person_names"]
            .as_array()
            .unwrap()
            .contains(&expected)
    );
    assert!(
        value["residents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|person| person["id"] != dreamer.0)
    );
}
