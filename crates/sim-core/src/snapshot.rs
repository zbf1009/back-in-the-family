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
    magistrate: MagistrateDto,
    joss: Vec<JossDto>,
    birth_slots: Vec<BirthSlotDto>,
    standing_slots: Vec<StandingSlotDto>,
    player_wait: Option<PlayerWaitDto>,
    pending_nodes: Vec<PendingNodeDto>,
    player: PlayerViewDto,
    player_node: Option<PlayerNodeDto>,
    chronicle: Vec<ChronicleDto>,
    underworld_view: Option<UnderworldViewDto>,
    person_names: Vec<NamedPersonDto>,
}

#[derive(Serialize)]
struct PlayerViewDto {
    place: &'static str,
    body: Option<u64>,
    earlier_bodies: Vec<EarlierBodyDto>,
    blood_ties: Vec<RelationDto>,
    relations: Vec<RelationDto>,
    past_life_ties: Vec<PastLifeTieDto>,
}

#[derive(Serialize)]
struct EarlierBodyDto {
    id: u64,
    name: String,
    origin: &'static str,
    death: String,
}

#[derive(Serialize)]
struct RelationDto {
    person: u64,
    affinity: i8,
    kinship: Vec<&'static str>,
}

#[derive(Serialize)]
struct PastLifeTieDto {
    rememberer: u64,
    earlier_body: u64,
    affinity: i8,
}

#[derive(Serialize)]
struct StakesDto {
    who: Vec<u64>,
    amount: String,
    unit: &'static str,
    by: String,
}

#[derive(Serialize)]
struct PreviewDto {
    person: u64,
    what: String,
    delta: String,
}

#[derive(Serialize)]
struct PlayerOptionDto {
    id: &'static str,
    preview: Vec<PreviewDto>,
}

#[derive(Serialize)]
struct PlayerNodeDto {
    id: String,
    family: &'static str,
    fired: String,
    choice_tick: String,
    resolves: String,
    stakes: StakesDto,
    options: Vec<PlayerOptionDto>,
    rules_default: &'static str,
}

#[derive(Serialize)]
struct ChronicleDto {
    tick: String,
    family: &'static str,
    stakes: StakesDto,
    applied: &'static str,
    source: &'static str,
    chooser_absent: bool,
    skipped: Vec<SkippedDto>,
}

#[derive(Serialize)]
struct SkippedDto {
    part: u8,
    reason: &'static str,
}

#[derive(Serialize)]
struct NeededDto {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    tick: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'static str>,
}

#[derive(Serialize)]
struct PathStatusDto {
    announced: bool,
    claimable: bool,
    affordable: bool,
    needed: Vec<NeededDto>,
}

#[derive(Serialize)]
struct UnderworldSlotDto {
    slot: String,
    kind: &'static str,
    price: String,
    birth: Option<String>,
    status: PathStatusDto,
}

#[derive(Serialize)]
struct BaseTraitsDto {
    carry_over: Option<&'static str>,
    traits: TraitsDto,
}

#[derive(Serialize)]
struct UnderworldViewDto {
    connected: Vec<u64>,
    ghost_traits: TraitsDto,
    slots: Vec<UnderworldSlotDto>,
    base_traits: Vec<BaseTraitsDto>,
}

#[derive(Serialize)]
struct NamedPersonDto {
    id: u64,
    name: String,
}

/// The one fixed official Person (R15.13): its Card_Person fields and its own Soul ID
/// text. It appears in no other list.
#[derive(Serialize)]
struct MagistrateDto {
    id: u64,
    name: String,
    age: u16,
    sex: &'static str,
    alive: bool,
    origin: &'static str,
    traits: TraitsDto,
    wealth: u64,
    soul_id: String,
}

/// One Soul's Joss_Balance (R13.1), in Soul ID order.
#[derive(Serialize)]
struct JossDto {
    soul_id: String,
    balance: String,
}

/// One open Birth_Slot (R13.2), in slot ID order.
#[derive(Serialize)]
struct BirthSlotDto {
    id: String,
    household: String,
    birth: String,
    price: String,
    claimant: Option<String>,
}

/// One of the two Standing_Slots (R13.3), Imported_Vessel first.
#[derive(Serialize)]
struct StandingSlotDto {
    kind: &'static str,
    price: String,
}

/// The Player_Soul's wait, `null` while it is in a body (R13.3).
#[derive(Serialize)]
struct PlayerWaitDto {
    ghost: u64,
    access_from: String,
    claim: Option<String>,
    carry_over: Option<&'static str>,
}

/// One pending Decision_Node (R13.4), in Node ID order. Always empty between ticks
/// under OP-U11; kept for a later multi-tick family.
#[derive(Serialize)]
struct PendingNodeDto {
    id: String,
    family: &'static str,
    subject: u64,
    options: Vec<&'static str>,
    rules_default: &'static str,
    resolves: String,
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

fn stakes_dto(stakes: &crate::narrator::Stakes) -> StakesDto {
    StakesDto {
        who: stakes.who.iter().map(|id| id.0).collect(),
        amount: stakes.amount.to_string(),
        unit: stakes.unit.label(),
        by: stakes.by.0.to_string(),
    }
}

fn preview_dto(entry: &crate::narrator::PreviewEntry) -> PreviewDto {
    PreviewDto {
        person: entry.person.0,
        what: entry.what.label().to_owned(),
        delta: entry.delta.to_string(),
    }
}

fn player_node_dto(node: &crate::narrator::PlayerNode) -> PlayerNodeDto {
    let choice_tick = node.fired.0.saturating_add(1).to_string();
    PlayerNodeDto {
        id: node.id.0.to_string(),
        family: node.family.label(),
        fired: node.fired.0.to_string(),
        resolves: choice_tick.clone(),
        choice_tick,
        stakes: stakes_dto(&node.stakes),
        options: node
            .options
            .iter()
            .map(|option| PlayerOptionDto {
                id: option.id.label(),
                preview: option.preview.iter().map(preview_dto).collect(),
            })
            .collect(),
        rules_default: node.rules_default.label(),
    }
}

fn chronicle_dto(entry: &crate::narrator::ChronicleEntry) -> ChronicleDto {
    ChronicleDto {
        tick: entry.tick.0.to_string(),
        family: entry.family.label(),
        stakes: stakes_dto(&entry.stakes),
        applied: entry.applied.label(),
        source: entry.source.label(),
        chooser_absent: entry.chooser_absent,
        skipped: entry
            .skipped
            .iter()
            .map(|(part, reason)| SkippedDto {
                part: *part,
                reason: reason.label(),
            })
            .collect(),
    }
}

fn path_status_dto(status: crate::underworld::slots::PathStatus) -> PathStatusDto {
    use crate::underworld::slots::Needed;
    PathStatusDto {
        announced: status.announced,
        claimable: status.claimable,
        affordable: status.affordable,
        needed: status
            .needed
            .into_iter()
            .map(|needed| match needed {
                Needed::WaitUntil(tick) => NeededDto {
                    kind: "wait_until",
                    tick: Some(tick.0.to_string()),
                    amount: None,
                    name: None,
                },
                Needed::JossShort(amount) => NeededDto {
                    kind: "joss_short",
                    tick: None,
                    amount: Some(amount.to_string()),
                    name: None,
                },
                Needed::CapRoomShort(amount) => NeededDto {
                    kind: "cap_room_short",
                    tick: None,
                    amount: Some(amount.to_string()),
                    name: None,
                },
                Needed::Named(name) => NeededDto {
                    kind: "named",
                    tick: None,
                    amount: None,
                    name: Some(name),
                },
            })
            .collect(),
    }
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
                traits: traits_dto(&person.traits),
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

    let magistrate = MagistrateDto {
        id: world.magistrate().id.0,
        name: crate::underworld::magistrate::FULL_NAME.to_owned(),
        age: crate::underworld::magistrate::NOMINAL_AGE,
        sex: crate::underworld::magistrate::SEX.as_str(),
        alive: true,
        origin: "official",
        traits: traits_dto(&world.magistrate().traits),
        wealth: 0,
        soul_id: crate::underworld::magistrate::SOUL_ID_TEXT.to_owned(),
    };

    let joss: Vec<JossDto> = world
        .joss()
        .iter()
        .map(|(&soul, account)| JossDto {
            soul_id: soul_id(soul),
            balance: account.balance.to_string(),
        })
        .collect();

    let player_soul = world.souls().player;
    let claim = world.player_wait().and_then(|wait| wait.claim);
    let birth_slots: Vec<BirthSlotDto> = world
        .slots()
        .values()
        .map(|slot| BirthSlotDto {
            id: slot.id.0.to_string(),
            household: world
                .persons()
                .get(&slot.mother)
                .map(|mother| match mother.life {
                    Life::Alive { household, .. } => household.0.to_string(),
                    Life::Dead { .. } => String::from("0"),
                })
                .unwrap_or_else(|| String::from("0")),
            // A Birth_Slot claim costs no joss paper (R1.2, design "Snapshot").
            price: String::from("0"),
            birth: slot.birth.0.to_string(),
            claimant: (claim == Some(slot.id)).then(|| soul_id(player_soul)),
        })
        .collect();

    let params = *world.params();
    let standing_slots: Vec<StandingSlotDto> = if world.player_wait().is_some() {
        vec![
            StandingSlotDto {
                kind: "imported_vessel",
                price: params.imported_price.to_string(),
            },
            StandingSlotDto {
                kind: "rebuilt_body",
                price: params.rebuilt_price.to_string(),
            },
        ]
    } else {
        Vec::new()
    };

    let player_wait = world.player_wait().map(|wait| PlayerWaitDto {
        ghost: wait.ghost.0,
        access_from: wait.access_from.0.to_string(),
        claim: wait.claim.map(|slot| slot.0.to_string()),
        carry_over: wait.carry_over.map(trait_name),
    });

    let pending_nodes: Vec<PendingNodeDto> = world
        .nodes()
        .pending
        .values()
        .map(|node| PendingNodeDto {
            id: node.id.0.to_string(),
            family: match node.family {
                crate::underworld::nodes::NodeFamily::DreamInterpretation => "dream_interpretation",
                crate::underworld::nodes::NodeFamily::MagistrateRuling => "magistrate_ruling",
            },
            subject: node.subject.0,
            options: node.options.iter().map(|option| option.id()).collect(),
            rules_default: node.rules_default.id(),
            // Both families resolve in their firing tick (OP-U11 A).
            resolves: world.tick().0.to_string(),
        })
        .collect();

    let current_body = match world.souls().places.get(&player_soul) {
        Some(SoulPlace::Body(id)) => Some(*id),
        _ => None,
    };
    let earlier_bodies: Vec<EarlierBodyDto> = world
        .persons()
        .values()
        .filter(|person| person.soul == player_soul && Some(person.id) != current_body)
        .filter_map(|person| match person.life {
            Life::Dead { death } => Some(EarlierBodyDto {
                id: person.id.0,
                name: person.name.text(person.sex),
                origin: person.origin.as_str(),
                death: death.0.to_string(),
            }),
            Life::Alive { .. } => None,
        })
        .collect();
    let earlier_ids: std::collections::BTreeSet<u64> =
        earlier_bodies.iter().map(|p| p.id).collect();
    let mut blood_ties = Vec::new();
    let mut relations = Vec::new();
    if let Some(body) = current_body {
        for (&(from, to), relation) in world.relations() {
            if from != body
                || !world
                    .persons()
                    .get(&to)
                    .is_some_and(|p| matches!(p.life, Life::Alive { .. }))
            {
                continue;
            }
            let dto = RelationDto {
                person: to.0,
                affinity: relation.affinity.get(),
                kinship: relation
                    .tags
                    .iter()
                    .filter(|tag| tag.is_kinship())
                    .map(|tag| tag.name())
                    .collect(),
            };
            if relation.tags.has_kinship() {
                blood_ties.push(dto);
            } else {
                relations.push(dto);
            }
        }
    }
    let past_life_ties = world
        .relations()
        .iter()
        .filter_map(|(&(from, to), relation)| {
            (world
                .persons()
                .get(&from)
                .is_some_and(|p| matches!(p.life, Life::Alive { .. }))
                && earlier_ids.contains(&to.0)
                && Some(to) != current_body)
                .then_some(PastLifeTieDto {
                    rememberer: from.0,
                    earlier_body: to.0,
                    affinity: relation.affinity.get(),
                })
        })
        .collect();
    let player = PlayerViewDto {
        place: if current_body.is_some() {
            "body"
        } else {
            "waiting"
        },
        body: current_body.map(|id| id.0),
        earlier_bodies,
        blood_ties,
        relations,
        past_life_ties,
    };
    let player_node = world.narrator().pending.as_ref().map(player_node_dto);
    let entries = world.narrator().chronicle.entries();
    let chronicle = entries
        .iter()
        .skip(entries.len().saturating_sub(100))
        .map(chronicle_dto)
        .collect();
    let underworld_view = world.player_wait().map(|wait| {
        use crate::underworld::slots::{SlotRef, base_traits, path_status};
        let connected = crate::underworld::ghosts::connected(world, wait.ghost)
            .into_iter()
            .map(|id| id.0)
            .collect();
        let mut slots = world
            .slots()
            .values()
            .map(|slot| UnderworldSlotDto {
                slot: format!("birth:{}", slot.id.0),
                kind: "birth_slot",
                price: "0".to_owned(),
                birth: Some(slot.birth.0.to_string()),
                status: path_status_dto(path_status(world, SlotRef::Birth(slot.id))),
            })
            .collect::<Vec<_>>();
        for (slot, kind, price) in [
            (
                SlotRef::ImportedVessel,
                "imported_vessel",
                world.params().imported_price,
            ),
            (
                SlotRef::RebuiltBody,
                "rebuilt_body",
                world.params().rebuilt_price,
            ),
        ] {
            slots.push(UnderworldSlotDto {
                slot: kind.to_owned(),
                kind,
                price: price.to_string(),
                birth: None,
                status: path_status_dto(path_status(world, slot)),
            });
        }
        let ghost_traits = traits_dto(&world.persons()[&wait.ghost].traits);
        let base_traits = std::iter::once(None)
            .chain(
                crate::underworld::carry_over::TraitName::ALL
                    .into_iter()
                    .map(Some),
            )
            .map(|carry| BaseTraitsDto {
                carry_over: carry.map(trait_name),
                traits: traits_dto(&base_traits(world, carry).expect("PlayerWait exists")),
            })
            .collect();
        UnderworldViewDto {
            connected,
            ghost_traits,
            slots,
            base_traits,
        }
    });
    let mut referenced = std::collections::BTreeSet::new();
    if let Some(body) = player.body {
        referenced.insert(body);
    }
    for body in &player.earlier_bodies {
        referenced.insert(body.id);
    }
    for tie in player.blood_ties.iter().chain(&player.relations) {
        referenced.insert(tie.person);
    }
    for tie in &player.past_life_ties {
        referenced.insert(tie.rememberer);
        referenced.insert(tie.earlier_body);
    }
    if let Some(node) = &player_node {
        referenced.extend(node.stakes.who.iter().copied());
        for option in &node.options {
            referenced.extend(option.preview.iter().map(|p| p.person));
        }
    }
    for entry in entries.iter().skip(entries.len().saturating_sub(100)) {
        referenced.extend(entry.stakes.who.iter().map(|id| id.0));
    }
    let person_names = referenced
        .into_iter()
        .filter_map(|id| world.persons().get(&crate::ids::PersonId(id)))
        .filter(|person| matches!(person.life, Life::Dead { .. }))
        .map(|person| NamedPersonDto {
            id: person.id.0,
            name: person.name.text(person.sex),
        })
        .collect();
    let dto = SnapshotDto {
        tick: world.tick().0.to_string(),
        player_soul: soul_id(player_soul),
        residents,
        households,
        souls,
        magistrate,
        joss,
        birth_slots,
        standing_slots,
        player_wait,
        pending_nodes,
        player,
        player_node,
        chronicle,
        underworld_view,
        person_names,
    };
    serde_json::to_string(&dto).expect("the snapshot DTO is always serializable")
}

/// The card names of one set of Traits.
fn traits_dto(traits: &crate::values::Traits) -> TraitsDto {
    TraitsDto {
        greed: traits.greed.get(),
        loyalty: traits.loyalty.get(),
        pride: traits.pride.get(),
        warmth: traits.warmth.get(),
        temper: traits.temper.get(),
        vindictiveness: traits.vindictiveness.get(),
        piety: traits.piety.get(),
    }
}

/// The card name of one Trait, as the Carry_Over names it.
fn trait_name(name: crate::underworld::carry_over::TraitName) -> &'static str {
    use crate::underworld::carry_over::TraitName;
    match name {
        TraitName::Greed => "greed",
        TraitName::Loyalty => "loyalty",
        TraitName::Pride => "pride",
        TraitName::Warmth => "warmth",
        TraitName::Temper => "temper",
        TraitName::Vindictiveness => "vindictiveness",
        TraitName::Piety => "piety",
    }
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

    /// A world whose Player_Soul died at tick 0 and waits with its body as the Ghost.
    fn waiting_player() -> World {
        let mut world = world();
        let player = world.souls.player;
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        if let Some(person) = world.persons.get_mut(&body) {
            person.life = Life::Dead {
                death: crate::ids::Tick(0),
            };
        }
        world.souls.places.insert(
            player,
            SoulPlace::Waiting {
                since: crate::ids::Tick(0),
            },
        );
        crate::underworld::player::start_wait(&mut world, player, crate::ids::Tick(0));
        world
    }

    #[test]
    fn the_magistrate_field_holds_the_fixed_details() {
        let world = world();
        let value: Value = serde_json::from_str(&snapshot_json(&world)).expect("JSON");
        let magistrate = &value["magistrate"];
        let expected_id = world.magistrate().id.0;
        assert_eq!(magistrate["id"], Value::from(expected_id));
        assert_eq!(
            magistrate["name"],
            Value::String(String::from("Orrin Vell"))
        );
        assert_eq!(magistrate["age"], Value::from(600));
        assert_eq!(magistrate["sex"], Value::String(String::from("male")));
        assert_eq!(magistrate["alive"], Value::Bool(true));
        assert_eq!(
            magistrate["origin"],
            Value::String(String::from("official"))
        );
        assert_eq!(magistrate["wealth"], Value::from(0));
        assert_eq!(magistrate["soul_id"], Value::String(String::from("S-0000")));
        // R15.13: in none of the Resident, Household and Soul lists.
        for resident in value["residents"].as_array().expect("residents") {
            assert_ne!(resident["id"], Value::from(expected_id));
        }
        for household in value["households"].as_array().expect("households") {
            assert!(
                !household["members"]
                    .as_array()
                    .expect("members")
                    .contains(&Value::from(expected_id))
            );
        }
        for soul in value["souls"].as_array().expect("souls") {
            assert_ne!(soul["soul_id"], Value::String(String::from("S-0000")));
        }
    }

    #[test]
    fn the_underworld_lists_are_empty_while_the_player_lives() {
        let world = world();
        let value: Value = serde_json::from_str(&snapshot_json(&world)).expect("JSON");
        let joss = value["joss"].as_array().expect("joss array");
        assert_eq!(joss.len(), world.souls.places.len());
        let soul_ids: Vec<&str> = joss
            .iter()
            .map(|entry| entry["soul_id"].as_str().expect("soul id"))
            .collect();
        assert!(soul_ids.windows(2).all(|pair| pair[0] < pair[1]));
        for entry in joss {
            assert!(entry["balance"].is_string(), "a balance is a string");
        }
        assert_eq!(value["standing_slots"].as_array().expect("array").len(), 0);
        assert!(value["player_wait"].is_null());
        assert_eq!(value["pending_nodes"].as_array().expect("array").len(), 0);
    }

    #[test]
    fn both_standing_slots_and_the_wait_appear_while_the_player_waits() {
        let world = waiting_player();
        let value: Value = serde_json::from_str(&snapshot_json(&world)).expect("JSON");
        let standing = value["standing_slots"].as_array().expect("array");
        assert_eq!(standing.len(), 2);
        assert_eq!(
            standing[0]["kind"],
            Value::String(String::from("imported_vessel"))
        );
        assert_eq!(standing[0]["price"], Value::String(String::from("100")));
        assert_eq!(
            standing[1]["kind"],
            Value::String(String::from("rebuilt_body"))
        );
        assert_eq!(standing[1]["price"], Value::String(String::from("400")));
        let wait = &value["player_wait"];
        assert_eq!(
            wait["ghost"],
            Value::from(world.player_wait().unwrap().ghost.0)
        );
        assert_eq!(wait["access_from"], Value::String(String::from("365")));
        assert!(wait["claim"].is_null());
        assert!(wait["carry_over"].is_null());
        for slot in value["birth_slots"].as_array().expect("birth slots") {
            assert_eq!(slot["price"], Value::String(String::from("0")));
            assert!(slot["birth"].is_string() && slot["household"].is_string());
            assert!(slot["claimant"].is_null() || slot["claimant"].is_string());
        }
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
    #[test]
    fn waiting_view_uses_core_path_status_and_fixed_base_traits() {
        let world = waiting_player();
        let before = Checksum::of(&world);
        let value: Value = serde_json::from_str(&snapshot_json(&world)).unwrap();
        let view = &value["underworld_view"];
        assert_eq!(view["base_traits"].as_array().unwrap().len(), 8);
        assert_eq!(
            view["base_traits"][0]["traits"]["piety"],
            world.player_wait().unwrap().rebuilt_draw.piety.get()
        );
        for slot in view["slots"].as_array().unwrap() {
            let reference = match slot["slot"].as_str().unwrap() {
                "imported_vessel" => crate::underworld::slots::SlotRef::ImportedVessel,
                "rebuilt_body" => crate::underworld::slots::SlotRef::RebuiltBody,
                id => crate::underworld::slots::SlotRef::Birth(crate::ids::BirthSlotId(
                    id.strip_prefix("birth:").unwrap().parse().unwrap(),
                )),
            };
            let status = crate::underworld::slots::path_status(&world, reference);
            assert_eq!(slot["status"]["announced"], status.announced);
            assert_eq!(slot["status"]["claimable"], status.claimable);
            assert_eq!(slot["status"]["affordable"], status.affordable);
            assert_eq!(
                slot["status"]["needed"].as_array().unwrap().len(),
                status.needed.len()
            );
        }
        assert_eq!(Checksum::of(&world), before);
    }
}
