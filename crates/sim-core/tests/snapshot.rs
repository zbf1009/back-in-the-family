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
use serde_json::Value;
use sim_core::checksum::Checksum;
use sim_core::ids::PersonId;
use sim_core::snapshot::snapshot_json;
use sim_core::world::{Life, SoulPlace, World};

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
