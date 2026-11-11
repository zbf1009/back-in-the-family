//! The Snapshot (design "Snapshot", R18): a read-only JSON view of the World.
//!
//! [`snapshot_json`] serializes Residents, Households and Souls with the card field
//! names and types: Card_Person fields, the Household ID and the Soul_Place. Lists are
//! in ascending ID order, and the field order is fixed by the DTO structs, so the text
//! is byte-identical on native and WASM.
//!
//! Person IDs, ages and `wealth` are JSON numbers (as on the cards); the project `u64`
//! values that are not card fields (`tick`, household IDs, `since`) are decimal strings,
//! like the replay format.

use serde::Serialize;

use crate::world::{Life, SoulPlace, World};

/// Largest integer a JavaScript number represents exactly (2^53). `wealth` is a JSON
/// number, so every balance must stay below it (design "Snapshot").
pub const MAX_EXACT_JSON_INT: u64 = 1 << 53;

#[derive(Serialize)]
struct SnapshotDto {
    tick: String,
    player_soul: String,
    residents: Vec<ResidentDto>,
    households: Vec<HouseholdDto>,
    souls: Vec<SoulDto>,
}

#[derive(Serialize)]
struct ResidentDto {
    id: u64,
    name: String,
    age: u16,
    sex: &'static str,
    alive: bool,
    origin: &'static str,
    traits: TraitsDto,
    wealth: u64,
    soul_id: String,
    household: String,
}

#[derive(Serialize)]
struct TraitsDto {
    greed: i8,
    loyalty: i8,
    pride: i8,
    warmth: i8,
    temper: i8,
    vindictiveness: i8,
    piety: i8,
}

#[derive(Serialize)]
struct HouseholdDto {
    id: String,
    members: Vec<u64>,
}

#[derive(Serialize)]
struct SoulDto {
    soul_id: String,
    place: PlaceDto,
}

/// Exactly one member is serialized: `{"body": N}` or `{"waiting": {"since": "T"}}`.
#[derive(Serialize)]
struct PlaceDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    waiting: Option<WaitingDto>,
}

#[derive(Serialize)]
struct WaitingDto {
    since: String,
}

/// The compact Snapshot JSON of `world` (design "Snapshot").
pub fn snapshot_json(world: &World) -> String {
    let residents: Vec<ResidentDto> = world
        .persons()
        .values()
        .filter_map(|person| {
            let Life::Alive { household, .. } = person.life else {
                return None;
            };
            Some(ResidentDto {
                id: person.id.0,
                name: person.name.text(person.sex),
                age: world.age_years(person),
                sex: person.sex.as_str(),
                alive: true,
                origin: person.origin.as_str(),
                traits: TraitsDto {
                    greed: person.traits.greed.get(),
                    loyalty: person.traits.loyalty.get(),
                    pride: person.traits.pride.get(),
                    warmth: person.traits.warmth.get(),
                    temper: person.traits.temper.get(),
                    vindictiveness: person.traits.vindictiveness.get(),
                    piety: person.traits.piety.get(),
                },
                wealth: world.wealth(person.id),
                soul_id: soul_id(person.soul),
                household: household.0.to_string(),
            })
        })
        .collect();

    let households: Vec<HouseholdDto> = world
        .households()
        .keys()
        .map(|&household| HouseholdDto {
            id: household.0.to_string(),
            members: world
                .household_members(household)
                .into_iter()
                .map(|member| member.0)
                .collect(),
        })
        .collect();

    let souls: Vec<SoulDto> = world
        .souls()
        .places
        .iter()
        .map(|(&soul, place)| SoulDto {
            soul_id: soul_id(soul),
            place: match place {
                SoulPlace::Body(person) => PlaceDto {
                    body: Some(person.0),
                    waiting: None,
                },
                SoulPlace::Waiting { since } => PlaceDto {
                    body: None,
                    waiting: Some(WaitingDto {
                        since: since.0.to_string(),
                    }),
                },
            },
        })
        .collect();

    let dto = SnapshotDto {
        tick: world.tick().0.to_string(),
        player_soul: soul_id(world.souls().player),
        residents,
        households,
        souls,
    };
    serde_json::to_string(&dto).expect("the snapshot DTO is always serializable")
}

fn soul_id(soul: crate::ids::SoulId) -> String {
    format!("S-{:04}", soul.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checksum::Checksum;
    use crate::params::Params;
    use crate::tick::Sim;
    use crate::world::WorldConfig;
    use serde_json::Value;

    fn world() -> World {
        World::new_with_params(3, WorldConfig::default(), Params::stress())
            .expect("the Opening_World builds")
    }

    #[test]
    fn wealth_stays_below_the_json_exact_integer_bound() {
        let mut world = world();
        for _ in 0..240 {
            world.step(&[]);
        }
        let largest = world
            .persons()
            .keys()
            .map(|&id| world.wealth(id))
            .max()
            .unwrap_or(0);
        assert!(largest < MAX_EXACT_JSON_INT, "{largest}");
    }

    #[test]
    fn lists_are_complete_and_in_ascending_order() {
        let world = world();
        let json = snapshot_json(&world);
        let value: Value = serde_json::from_str(&json).expect("the snapshot is JSON");

        let residents = value["residents"].as_array().expect("residents array");
        let expected_residents = world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .count();
        assert_eq!(residents.len(), expected_residents);
        let ids: Vec<u64> = residents
            .iter()
            .map(|r| r["id"].as_u64().expect("residents have numeric ids"))
            .collect();
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));

        let households = value["households"].as_array().expect("households array");
        assert_eq!(households.len(), world.households().len());
        for household in households {
            let members: Vec<u64> = household["members"]
                .as_array()
                .expect("members array")
                .iter()
                .map(|m| m.as_u64().expect("members are numbers"))
                .collect();
            assert!(members.windows(2).all(|pair| pair[0] < pair[1]));
        }

        let souls = value["souls"].as_array().expect("souls array");
        assert_eq!(souls.len(), world.souls().places.len());
        let soul_ids: Vec<&str> = souls
            .iter()
            .map(|s| s["soul_id"].as_str().expect("soul ids are strings"))
            .collect();
        assert!(soul_ids.windows(2).all(|pair| pair[0] < pair[1]));
        for soul in souls {
            let place = soul["place"].as_object().expect("place object");
            assert_eq!(place.len(), 1, "a Soul has exactly one place");
        }
    }

    #[test]
    fn a_person_appears_once_with_the_world_values() {
        let world = world();
        let json = snapshot_json(&world);
        let value: Value = serde_json::from_str(&json).expect("the snapshot is JSON");
        let resident = &value["residents"][0];
        let id = resident["id"].as_u64().expect("numeric id");
        let person = world
            .persons()
            .get(&crate::ids::PersonId(id))
            .expect("the person exists");
        assert_eq!(
            resident["name"],
            Value::String(person.name.text(person.sex))
        );
        assert_eq!(resident["age"], Value::from(world.age_years(person)));
        assert_eq!(resident["alive"], Value::Bool(true));
        assert_eq!(resident["wealth"], Value::from(world.wealth(person.id)));
        assert_eq!(
            resident["soul_id"],
            Value::String(format!("S-{:04}", person.soul.0))
        );
        assert_eq!(value["tick"], Value::String(world.tick().0.to_string()));
        assert_eq!(
            value["player_soul"],
            Value::String(format!("S-{:04}", world.souls().player.0))
        );
    }

    #[test]
    fn taking_a_snapshot_changes_nothing() {
        let mut sim = Sim::new_with_params(5, WorldConfig::default(), Params::stress())
            .expect("the Opening_World builds");
        let before = Checksum::of(sim.world());
        let first = snapshot_json(sim.world());
        assert_eq!(first, snapshot_json(sim.world()));
        assert_eq!(Checksum::of(sim.world()), before);
        sim.step();
        let second = snapshot_json(sim.world());
        assert_ne!(first, second, "the tick changed the snapshot's tick field");
    }

    #[test]
    fn waiting_souls_render_their_since_as_a_decimal_string() {
        let world = world();
        let json = snapshot_json(&world);
        let value: Value = serde_json::from_str(&json).expect("the snapshot is JSON");
        let waiting = value["souls"]
            .as_array()
            .expect("souls array")
            .iter()
            .find(|s| s["place"]["waiting"].is_object());
        if let Some(soul) = waiting {
            assert!(soul["place"]["waiting"]["since"].is_string());
            assert!(soul["place"]["body"].is_null());
        }
    }
}
