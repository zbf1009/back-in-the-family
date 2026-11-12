//! The Player_Soul's wait in the Waiting_Queue (R8, OP-U4 A, OP-U8 A, OP-U10 A).
//!
//! A wait starts at the Player_Soul's death: its acting Ghost is the latest dead body
//! that carries the Player_Soul (highest death tick, ties higher Person ID), and the
//! register opens `register_wait` days later (OP-U6 A). It ends through a claimed birth,
//! a Standing_Slot claim, or the automatic placement of R8.1 when the wait exceeds
//! `player_max_wait` (OP-U10 A).
//!
//! `World::player_wait` is `Some` exactly while the Player_Soul waits with a Ghost; the
//! invariant checker `U7.10` verifies that equivalence every tick. The claim store is
//! this one field, so R7.3 (at most one claim per slot and per Soul) holds by
//! construction.

use crate::canon::{Canon, CanonWriter};
use crate::ids::{BirthSlotId, PersonId, SoulId, Tick};
use crate::underworld::carry_over::TraitName;
use crate::world::{Life, World};

/// One stay of the Player_Soul in the Waiting_Queue (design "Data Models").
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PlayerWait {
    /// The acting Ghost: the latest dead body of the Player_Soul (OP-U4 A).
    pub ghost: PersonId,
    /// The first tick a Birth_Slot may be claimed (OP-U6 A).
    pub access_from: Tick,
    /// The one Birth_Slot claim of this wait (R7.3), released by the R8.1 placement.
    pub claim: Option<BirthSlotId>,
    /// The trait copied into the next body (R9.1), `None` for the fallback.
    pub carry_over: Option<TraitName>,
}

impl Canon for PlayerWait {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            ghost,
            access_from,
            claim,
            carry_over,
        } = self;
        ghost.encode(w);
        access_from.encode(w);
        claim.encode(w);
        carry_over.encode(w);
    }
}

/// The latest dead body of `soul`: highest death tick, ties higher Person ID (OP-U4 A).
pub fn latest_body(world: &World, soul: SoulId) -> Option<PersonId> {
    let mut best: Option<(Tick, PersonId)> = None;
    for person in world.persons.values() {
        if person.soul != soul {
            continue;
        }
        let Life::Dead { death } = person.life else {
            continue;
        };
        // Person IDs ascend with the map keys, so a `>` comparison keeps the lower ID on
        // a tie only if it is reached later; compare explicitly instead.
        let candidate = (death, person.id);
        best = match best {
            None => Some(candidate),
            Some(current) if candidate > current => Some(candidate),
            Some(current) => Some(current),
        };
    }
    best.map(|(_, id)| id)
}

/// Starts the Player_Soul's wait at its death (design "Player wait").
///
/// Call after the dead body has flipped to [`Life::Dead`] and the Soul is waiting, so
/// [`latest_body`] sees the body that just died.
pub(crate) fn start_wait(world: &mut World, soul: SoulId, death_tick: Tick) {
    if soul != world.souls.player {
        return;
    }
    let Some(ghost) = latest_body(world, soul) else {
        return;
    };
    let access_from = Tick(death_tick.0.saturating_add(world.params.register_wait));
    world.player_wait = Some(PlayerWait {
        ghost,
        access_from,
        claim: None,
        carry_over: None,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::EventKind;
    use crate::params::Params;
    use crate::values::Origin;
    use crate::world::SoulPlace;
    use crate::world::{Life, WorldConfig};

    fn world(params: Params) -> World {
        World::new_with_params(3, WorldConfig::try_new(40).unwrap(), params).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    /// Kills the Player_Soul's body at `death` and starts its wait.
    fn kill_player(world: &mut World, death: Tick) {
        let player = world.souls.player;
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        if let Some(person) = world.persons.get_mut(&body) {
            person.life = Life::Dead { death };
        }
        world
            .souls
            .places
            .insert(player, SoulPlace::Waiting { since: death });
        world.tick = death;
        start_wait(world, player, death);
    }

    #[test]
    fn a_wait_starts_with_the_latest_body_and_the_register_wait() {
        let mut world = world(Params::DEFAULT);
        let player = world.souls.player;
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        // An older body of the same Soul.
        let older = residents(&world)
            .into_iter()
            .find(|id| *id != body)
            .expect("another Resident");
        if let Some(person) = world.persons.get_mut(&older) {
            person.soul = player;
            person.life = Life::Dead { death: Tick(4) };
        }
        kill_player(&mut world, Tick(10));

        let wait = world.player_wait().expect("the wait started");
        assert_eq!(wait.ghost, body, "the latest body acts as the Ghost");
        assert_eq!(wait.access_from, Tick(10 + world.params().register_wait));
        assert_eq!(wait.claim, None);
        assert_eq!(wait.carry_over, None);
        assert_eq!(latest_body(&world, player), Some(body));
    }

    #[test]
    fn a_tie_on_the_death_tick_goes_to_the_higher_person_id() {
        let mut world = world(Params::DEFAULT);
        let player = world.souls.player;
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        let other = residents(&world)
            .into_iter()
            .find(|id| *id != body)
            .expect("another Resident");
        for id in [body, other] {
            if let Some(person) = world.persons.get_mut(&id) {
                person.soul = player;
                person.life = Life::Dead { death: Tick(8) };
            }
        }
        let higher = body.max(other);
        assert_eq!(latest_body(&world, player), Some(higher));
    }

    #[test]
    fn the_forced_placement_happens_after_player_max_wait() {
        let mut params = Params::DEFAULT;
        params.register_wait = 2;
        params.player_max_wait = 5;
        let mut world = world(params);
        let player = world.souls.player;
        kill_player(&mut world, Tick(10));
        let since = 10u64;
        let bound = since + world.params().player_max_wait;

        world.tick = Tick(bound);
        crate::underworld::place_player_if_overdue(&mut world);
        assert!(
            matches!(world.souls.places[&player], SoulPlace::Waiting { .. }),
            "at player_max_wait the Player_Soul still waits"
        );
        assert!(world.player_wait().is_some());

        world.tick = Tick(bound + 1);
        crate::underworld::place_player_if_overdue(&mut world);
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul was placed");
        };
        assert_eq!(world.player_wait(), None);
        assert_eq!(world.persons()[&body].origin, Origin::Possessed);
        let event = world.log().events().last().expect("an arrival Event");
        assert!(
            matches!(event.kind, EventKind::Possession { person, price } if person == body && price == 0),
            "the placement is free (OP-U8 A): {:?}",
            event.kind
        );
    }

    #[test]
    fn the_forced_placement_releases_a_claim() {
        let mut params = Params::DEFAULT;
        params.player_max_wait = 3;
        let mut world = world(params);
        kill_player(&mut world, Tick(0));
        let mother = residents(&world)[0];
        let slot =
            crate::underworld::slots::open(&mut world, mother).expect("the counter has room");
        if let Some(wait) = world.player_wait.as_mut() {
            wait.claim = Some(slot);
        }
        world.tick = Tick(4);
        crate::underworld::place_player_if_overdue(&mut world);
        assert_eq!(world.player_wait(), None);
        let some_slot = world.slots().get(&slot).expect("the slot stays open");
        assert_eq!(some_slot.id, slot);
    }
}
