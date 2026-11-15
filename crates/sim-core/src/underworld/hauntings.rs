//! Hauntings (R5, OP-U5 A).
//!
//! A haunting is the Player_Soul's Ghost acting on one living Connected_Person. The
//! input spends `haunt_price` against the spend cap (R2.6), appends one `haunting` Event
//! with actors (Ghost, target) to which that spend is attributed, and changes nothing
//! else: the target's Mood moves by the fixed `-15` of the Event's `mood_delta` row
//! (LS-R14.2), so Mood still changes only through an Event (R5.2, R5.4).

use crate::events::{CausedBy, EventKind, EventTags};
use crate::ids::PersonId;
use crate::underworld::{ghosts, joss, player};
use crate::world::{AppendRefused, Life, RejectReason, World};

/// Applies one `Haunt` input in step 2a (design "Inputs", rejection table order).
///
/// `official_person` comes first (R15.9), then `no_ghost`, `not_waiting`,
/// `unknown_person`, `dead_person`, `not_connected`, `rate_limited` (one applied
/// haunting per tick, OP-U5 A), `insufficient_joss` and `yearly_cap`. The Event is
/// appended before the spend, so a refused append leaves the balance untouched.
pub(crate) fn apply(world: &mut World, target: PersonId) -> Result<(), RejectReason> {
    if target == world.magistrate.id {
        return Err(RejectReason::OfficialPerson);
    }
    player::require_waiting(world)?;
    let Some(ghost) = world.player_wait.as_ref().map(|wait| wait.ghost) else {
        return Err(RejectReason::NotWaiting);
    };
    let Some(person) = world.persons.get(&target) else {
        return Err(RejectReason::UnknownPerson);
    };
    if matches!(person.life, Life::Dead { .. }) {
        return Err(RejectReason::DeadPerson);
    }
    if !ghosts::is_connected(world, target, ghost) {
        return Err(RejectReason::NotConnected);
    }
    if haunted_this_tick(world) {
        return Err(RejectReason::RateLimited);
    }
    let price = world.params.haunt_price;
    let yearly_cap = world.params.yearly_cap;
    let tick = world.tick;
    let player_soul = world.souls.player;
    let account = world.joss.get(&player_soul).copied().unwrap_or_default();
    if account.balance < price {
        return Err(RejectReason::InsufficientJoss);
    }
    if !joss::capped_spend_allowed(&account, price, tick, yearly_cap) {
        return Err(RejectReason::YearlyCap);
    }
    if let Err(refused) = world.append(
        EventKind::Haunting {
            ghost,
            target,
            intensity: world.params.haunt_intensity,
            price,
        },
        CausedBy::default(),
        EventTags::empty(),
    ) {
        debug_assert_eq!(refused, AppendRefused::IdExhausted);
        return Err(RejectReason::IdExhausted);
    }
    if let Some(account) = world.joss.get_mut(&player_soul) {
        let spent = joss::spend_capped(account, price, tick, yearly_cap);
        debug_assert!(spent, "the balance and the spend cap were checked");
    }
    Ok(())
}

/// Whether a `haunting` Event already fired in the current tick (OP-U5 A).
fn haunted_this_tick(world: &World) -> bool {
    world
        .log
        .events()
        .iter()
        .rev()
        .find_map(|event| match event.kind {
            EventKind::Haunting { .. } => Some(event.tick),
            _ => None,
        })
        == Some(world.tick)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::EventKind;
    use crate::ids::{InputSeq, Tick};
    use crate::input::{InputPayload, TickInput};
    use crate::params::Params;
    use crate::underworld::player::start_wait;
    use crate::values::Mood;
    use crate::world::{SoulPlace, WorldConfig};

    fn world(params: Params) -> World {
        World::new_with_params(11, WorldConfig::try_new(40).unwrap(), params).unwrap()
    }

    /// The defaults with offerings switched off, so a balance assertion sees only the
    /// haunting's own spend (Offerings run in step 5 of the same tick).
    fn quiet() -> Params {
        let mut params = Params::DEFAULT;
        params.offer_min_affinity = 101;
        params
    }

    /// Kills the Player_Soul's body today and starts its wait, so a Ghost exists.
    fn kill_player(world: &mut World) -> PersonId {
        let player = world.souls.player;
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        let tick = world.tick;
        if let Some(person) = world.persons.get_mut(&body) {
            person.life = Life::Dead { death: tick };
        }
        world
            .souls
            .places
            .insert(player, SoulPlace::Waiting { since: tick });
        start_wait(world, player, tick);
        body
    }

    /// A living Resident connected to `ghost`.
    fn connected(world: &World, ghost: PersonId) -> PersonId {
        ghosts::connected(world, ghost)
            .into_iter()
            .next()
            .expect("the Opening_World leaves a kin Relation")
    }

    fn give_joss(world: &mut World, amount: u64) {
        let player = world.souls.player;
        if let Some(account) = world.joss.get_mut(&player) {
            account.balance = amount;
        }
    }

    fn set_mood(world: &mut World, person: PersonId, value: i64) {
        if let Some(entry) = world.persons.get_mut(&person)
            && let Life::Alive { mood, .. } = &mut entry.life
        {
            *mood = Mood::clamped(value);
        }
    }

    fn mood_of(world: &World, person: PersonId) -> i8 {
        match world.persons[&person].life {
            Life::Alive { mood, .. } => mood.get(),
            Life::Dead { .. } => panic!("the target is alive"),
        }
    }

    fn step(world: &mut World, payloads: &[InputPayload]) {
        let inputs: Vec<TickInput> = payloads
            .iter()
            .enumerate()
            .map(|(index, payload)| TickInput {
                tick: world.tick,
                seq: InputSeq(u64::try_from(index).unwrap()),
                payload: *payload,
            })
            .collect();
        world.step(&inputs);
    }

    #[test]
    fn a_haunting_moves_the_targets_mood_by_minus_fifteen() {
        let mut w = world(quiet());
        let ghost = kill_player(&mut w);
        let target = connected(&w, ghost);
        give_joss(&mut w, 100);
        let before = mood_of(&w, target);
        let price = w.params.haunt_price;
        step(&mut w, &[InputPayload::Haunt { target }]);
        assert_eq!(mood_of(&w, target), before.saturating_sub(15).max(-100));
        // The spend is attributed to exactly one `haunting` Event.
        let events: Vec<_> = w
            .log()
            .events()
            .iter()
            .filter(|event| matches!(event.kind, EventKind::Haunting { .. }))
            .collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tick, Tick(0));
        match events[0].kind {
            EventKind::Haunting {
                ghost: g,
                target: t,
                intensity,
                price: p,
            } => {
                assert_eq!(g, ghost);
                assert_eq!(t, target);
                assert_eq!(intensity, w.params.haunt_intensity);
                assert_eq!(p, price);
            }
            _ => unreachable!(),
        }
        let player = w.souls.player;
        assert_eq!(w.joss()[&player].balance, 100 - price);
    }

    #[test]
    fn a_haunting_clamps_the_targets_mood_at_minus_one_hundred() {
        let mut w = world(quiet());
        let ghost = kill_player(&mut w);
        let target = connected(&w, ghost);
        give_joss(&mut w, 100);
        set_mood(&mut w, target, -90);
        step(&mut w, &[InputPayload::Haunt { target }]);
        assert_eq!(mood_of(&w, target), -100);
    }

    #[test]
    fn a_non_connected_target_is_rejected_not_connected() {
        let mut w = world(quiet());
        let ghost = kill_player(&mut w);
        let target = w
            .persons
            .values()
            .find(|person| {
                matches!(person.life, Life::Alive { .. })
                    && !w.relations.contains_key(&(person.id, ghost))
            })
            .map(|person| person.id)
            .expect("the town has unrelated Residents");
        give_joss(&mut w, 100);
        step(&mut w, &[InputPayload::Haunt { target }]);
        assert_eq!(
            w.rejections().last.map(|(_, _, reason)| reason),
            Some(RejectReason::NotConnected)
        );
        assert_eq!(w.joss()[&w.souls.player].balance, 100);
    }

    #[test]
    fn a_second_haunting_in_the_tick_is_rejected_rate_limited() {
        let mut w = world(quiet());
        let ghost = kill_player(&mut w);
        let target = connected(&w, ghost);
        give_joss(&mut w, 100);
        step(
            &mut w,
            &[
                InputPayload::Haunt { target },
                InputPayload::Haunt { target },
            ],
        );
        assert_eq!(
            w.rejections().last.map(|(_, _, reason)| reason),
            Some(RejectReason::RateLimited)
        );
        assert_eq!(
            w.log()
                .events()
                .iter()
                .filter(|event| matches!(event.kind, EventKind::Haunting { .. }))
                .count(),
            1
        );
        assert_eq!(
            w.joss()[&w.souls.player].balance,
            100 - w.params.haunt_price
        );
    }

    #[test]
    fn a_spend_over_the_yearly_cap_is_rejected_yearly_cap() {
        let mut params = quiet();
        params.yearly_cap = 10;
        let mut w = world(params);
        let ghost = kill_player(&mut w);
        let target = connected(&w, ghost);
        give_joss(&mut w, 100);
        step(&mut w, &[InputPayload::Haunt { target }]);
        assert_eq!(
            w.rejections().last.map(|(_, _, reason)| reason),
            Some(RejectReason::YearlyCap)
        );
        assert!(
            !w.log()
                .events()
                .iter()
                .any(|event| matches!(event.kind, EventKind::Haunting { .. }))
        );
        assert_eq!(w.joss()[&w.souls.player].balance, 100);
    }

    #[test]
    fn a_haunting_without_a_ghost_is_rejected_no_ghost() {
        let mut w = world(quiet());
        let target = w
            .persons
            .values()
            .find(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .expect("the town has Residents");
        step(&mut w, &[InputPayload::Haunt { target }]);
        assert_eq!(
            w.rejections().last.map(|(_, _, reason)| reason),
            Some(RejectReason::NoGhost)
        );
    }
}
