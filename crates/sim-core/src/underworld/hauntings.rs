//! Hauntings (R5, OP-U5 A).
//!
//! A haunting is the Player_Soul's Ghost acting on one living Connected_Person. The
//! input spends `haunt_price` against the spend cap (R2.6), appends one `haunting` Event
//! with actors (Ghost, target) to which that spend is attributed, and changes nothing
//! else: the target's Mood moves by the fixed `-15` of the Event's `mood_delta` row
//! (LS-R14.2), so Mood still changes only through an Event (R5.2, R5.4).

use std::cell::OnceCell;

use crate::events::{CausedBy, Event, EventKind, EventTags};
use crate::ids::{PersonId, Tick};
use crate::underworld::{ghosts, joss, player};
use crate::world::{AppendRefused, Life, RejectReason, World};

/// Borrowed facts shared by every target in one read-only action inspection.
/// Errors remain deferred until their position in the authoritative input order.
/// The target-independent tail is evaluated only after a target passes the prefix.
pub(crate) struct HauntInspection<'a> {
    world: &'a World,
    waiting_ghost: Result<PersonId, RejectReason>,
    tail: OnceCell<Result<(), RejectReason>>,
}

impl<'a> HauntInspection<'a> {
    pub(crate) fn new(world: &'a World, waiting_ghost: Result<PersonId, RejectReason>) -> Self {
        Self {
            world,
            waiting_ghost,
            tail: OnceCell::new(),
        }
    }

    pub(crate) fn validate(&self, target: PersonId) -> Result<PersonId, RejectReason> {
        let world = self.world;
        if target == world.magistrate.id {
            return Err(RejectReason::OfficialPerson);
        }
        let ghost = self.waiting_ghost?;
        validate_target_prefix(world, target, ghost)?;
        (*self.tail.get_or_init(|| validate_tail(world)))?;
        Ok(ghost)
    }
}

/// Checks the authoritative input order without mutating the World.
pub(crate) fn validate(world: &World, target: PersonId) -> Result<PersonId, RejectReason> {
    if target == world.magistrate.id {
        return Err(RejectReason::OfficialPerson);
    }
    let ghost = player::waiting_ghost(world)?;
    validate_target_prefix(world, target, ghost)?;
    validate_tail(world)?;
    Ok(ghost)
}

/// Cheap target checks after the authoritative waiting check.
fn validate_target_prefix(
    world: &World,
    target: PersonId,
    ghost: PersonId,
) -> Result<(), RejectReason> {
    let Some(person) = world.persons.get(&target) else {
        return Err(RejectReason::UnknownPerson);
    };
    if matches!(person.life, Life::Dead { .. }) {
        return Err(RejectReason::DeadPerson);
    }
    if !ghosts::is_connected(world, target, ghost) {
        return Err(RejectReason::NotConnected);
    }
    Ok(())
}

/// The target-independent tail, shared by inspection and apply.
fn validate_tail(world: &World) -> Result<(), RejectReason> {
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
    if !world.log.has_room(1) {
        return Err(RejectReason::IdExhausted);
    }
    Ok(())
}

/// Appends the validated event before charging the shared capped-spend budget.
pub(crate) fn apply(world: &mut World, target: PersonId) -> Result<(), RejectReason> {
    let ghost = validate(world, target)?;
    let price = world.params.haunt_price;
    let yearly_cap = world.params.yearly_cap;
    let tick = world.tick;
    let player_soul = world.souls.player;
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
    haunted_in_tick_suffix(world.log.events().iter().rev(), world.tick)
}

/// Event ticks are nondecreasing in a valid World. The first older Event bounds
/// the search even when no haunting has ever occurred.
fn haunted_in_tick_suffix<'a>(events: impl Iterator<Item = &'a Event>, tick: Tick) -> bool {
    for event in events {
        if event.tick < tick {
            break;
        }
        if matches!(event.kind, EventKind::Haunting { .. }) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::EventKind;
    use crate::ids::{InputSeq, Tick};
    use crate::input::{InputOutcome, InputPayload, TickInput};
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
    fn official_targets_precede_no_ghost_and_not_waiting() {
        for waiting_error in [RejectReason::NoGhost, RejectReason::NotWaiting] {
            let mut w = world(quiet());
            if waiting_error == RejectReason::NotWaiting {
                kill_player(&mut w);
                w.player_wait = None;
            }
            assert_eq!(player::waiting_ghost(&w), Err(waiting_error));
            let official = w.magistrate.id;
            let before = crate::checksum::Checksum::of(&w);
            assert_eq!(validate(&w, official), Err(RejectReason::OfficialPerson));
            assert_eq!(apply(&mut w, official), Err(RejectReason::OfficialPerson));
            assert_eq!(crate::checksum::Checksum::of(&w), before);
        }
    }

    #[test]
    fn inspection_early_rejections_do_not_initialize_tail() {
        let unknown = PersonId(u64::MAX);
        for waiting_error in [RejectReason::NoGhost, RejectReason::NotWaiting] {
            let mut w = world(quiet());
            if waiting_error == RejectReason::NotWaiting {
                kill_player(&mut w);
                w.player_wait = None;
            }
            let inspection = HauntInspection::new(&w, player::waiting_ghost(&w));
            assert_eq!(inspection.tail.get(), None);
            assert_eq!(
                inspection.validate(w.magistrate.id),
                Err(RejectReason::OfficialPerson)
            );
            assert_eq!(inspection.tail.get(), None);
            assert_eq!(inspection.validate(unknown), Err(waiting_error));
            assert_eq!(inspection.tail.get(), None);
            assert_eq!(validate(&w, unknown), Err(waiting_error));
        }

        let mut w = world(quiet());
        let ghost = kill_player(&mut w);
        let unrelated = w
            .persons
            .values()
            .find(|person| {
                matches!(person.life, Life::Alive { .. })
                    && !w.relations.contains_key(&(person.id, ghost))
            })
            .map(|person| person.id)
            .expect("the town has unrelated Residents");
        give_joss(&mut w, 0);
        w.params.yearly_cap = 0;
        w.log.exhaust_ids_leaving(0);
        let cases = [
            (w.magistrate.id, RejectReason::OfficialPerson),
            (unknown, RejectReason::UnknownPerson),
            (ghost, RejectReason::DeadPerson),
            (unrelated, RejectReason::NotConnected),
        ];
        {
            let inspection = HauntInspection::new(&w, player::waiting_ghost(&w));
            assert_eq!(inspection.tail.get(), None);
            for (target, reason) in cases {
                assert_eq!(inspection.validate(target), Err(reason));
                assert_eq!(inspection.tail.get(), None);
                assert_eq!(validate(&w, target), Err(reason));
            }
        }
        let before = crate::checksum::Checksum::of(&w);
        for (target, reason) in cases {
            assert_eq!(apply(&mut w, target), Err(reason));
            assert_eq!(crate::checksum::Checksum::of(&w), before);
        }
    }

    #[test]
    fn inspection_initializes_and_reuses_tail_for_legal_prefixes() {
        for balance in [0, 100] {
            let mut w = world(quiet());
            let ghost = kill_player(&mut w);
            let first = connected(&w, ghost);
            let second = w
                .persons
                .values()
                .find(|person| person.id != first && matches!(person.life, Life::Alive { .. }))
                .map(|person| person.id)
                .expect("the town has another living Resident");
            let relation = w.relations[&(first, ghost)].clone();
            w.relations.insert((second, ghost), relation);
            give_joss(&mut w, balance);
            let expected_tail = if balance == 0 {
                Err(RejectReason::InsufficientJoss)
            } else {
                Ok(())
            };
            let expected = expected_tail.map(|()| ghost);
            let inspection = HauntInspection::new(&w, player::waiting_ghost(&w));
            assert_eq!(inspection.tail.get(), None);
            assert_eq!(inspection.validate(first), expected);
            let cached_tail = inspection
                .tail
                .get()
                .expect("the legal prefix queries the tail");
            assert_eq!(*cached_tail, expected_tail);
            assert_eq!(inspection.validate(second), expected);
            assert!(std::ptr::eq(cached_tail, inspection.tail.get().unwrap()));
            assert_eq!(*inspection.tail.get().unwrap(), expected_tail);
        }
    }

    #[test]
    fn raw_repeated_illegal_haunts_preserve_every_outcome() {
        for rejection in [
            RejectReason::NoGhost,
            RejectReason::NotWaiting,
            RejectReason::UnknownPerson,
        ] {
            let mut w = world(quiet());
            if rejection != RejectReason::NoGhost {
                kill_player(&mut w);
                if rejection == RejectReason::NotWaiting {
                    w.player_wait = None;
                }
            }
            let official = w.magistrate.id;
            let unknown = PersonId(u64::MAX);
            let cases = [
                (official, RejectReason::OfficialPerson),
                (unknown, rejection),
                (official, RejectReason::OfficialPerson),
                (unknown, rejection),
                (unknown, rejection),
                (official, RejectReason::OfficialPerson),
            ];
            let inputs: Vec<_> = cases
                .iter()
                .enumerate()
                .map(|(index, &(target, _))| TickInput {
                    tick: w.tick,
                    seq: InputSeq(u64::try_from(index).unwrap()),
                    payload: InputPayload::Haunt { target },
                })
                .collect();
            let expected: Vec<_> = cases
                .iter()
                .enumerate()
                .map(|(index, &(_, reason))| InputOutcome {
                    seq: InputSeq(u64::try_from(index).unwrap()),
                    result: Err(reason),
                })
                .collect();
            let mut replayed = w.clone();
            let (checksum, outcomes) = w.step_with_outcomes(&inputs);
            let (replayed_checksum, replayed_outcomes) = replayed.step_with_outcomes(&inputs);
            assert_eq!(outcomes, expected);
            assert_eq!(replayed_outcomes, expected);
            assert_eq!(checksum, replayed_checksum);
            assert_eq!(
                w.rejections().count_by_reason,
                std::collections::BTreeMap::from([
                    (RejectReason::OfficialPerson, 3),
                    (rejection, 3),
                ])
            );
            assert_eq!(
                w.rejections().last,
                Some((Tick(0), InputSeq(5), RejectReason::OfficialPerson))
            );
            assert!(
                !w.log()
                    .events()
                    .iter()
                    .any(|event| matches!(event.kind, EventKind::Haunting { .. }))
            );
        }
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
    #[test]
    fn haunting_search_stops_at_the_first_older_event_without_a_historical_haunting() {
        use std::cell::Cell;

        let mut w = world(quiet());
        let person = *w.persons.keys().next().unwrap();
        for _ in 0..10_000 {
            w.log
                .push(
                    Tick(0),
                    EventKind::Birth { person },
                    CausedBy::default(),
                    EventTags::empty(),
                )
                .unwrap();
        }
        w.tick = Tick(1);
        let visited = Cell::new(0);
        let search = |w: &World| {
            visited.set(0);
            haunted_in_tick_suffix(
                w.log
                    .events()
                    .iter()
                    .rev()
                    .inspect(|_| visited.set(visited.get() + 1)),
                w.tick,
            )
        };
        assert!(!search(&w));
        assert_eq!(visited.get(), 1, "only the older-tick boundary is read");
        for _ in 0..3 {
            w.log
                .push(
                    w.tick,
                    EventKind::Birth { person },
                    CausedBy::default(),
                    EventTags::empty(),
                )
                .unwrap();
        }
        assert!(!haunted_this_tick(&w));
        assert!(!search(&w));
        assert_eq!(visited.get(), 4, "three current Events and one boundary");
    }

    #[test]
    fn a_historical_haunting_does_not_rate_limit_a_later_tick() {
        let mut w = world(quiet());
        let ghost = kill_player(&mut w);
        let target = connected(&w, ghost);
        give_joss(&mut w, 100);
        assert_eq!(apply(&mut w, target), Ok(()));
        w.tick = Tick(1);
        assert!(!haunted_this_tick(&w));
        assert_eq!(validate(&w, target), Ok(ghost));
        assert_eq!(apply(&mut w, target), Ok(()));
    }

    #[test]
    fn any_current_tick_haunting_rate_limits_the_player() {
        let mut w = world(quiet());
        let ghost = kill_player(&mut w);
        let target = connected(&w, ghost);
        let others: Vec<_> = w
            .persons
            .keys()
            .copied()
            .filter(|id| *id != ghost && *id != target)
            .take(2)
            .collect();
        let other_ghost = others[0];
        let other_target = others[1];
        let soul = w.persons[&other_ghost].soul;
        w.persons.get_mut(&other_ghost).unwrap().life = Life::Dead { death: w.tick };
        w.souls
            .places
            .insert(soul, SoulPlace::Waiting { since: w.tick });
        w.append(
            EventKind::Haunting {
                ghost: other_ghost,
                target: other_target,
                intensity: w.params.haunt_intensity,
                price: w.params.haunt_price,
            },
            CausedBy::default(),
            EventTags::empty(),
        )
        .unwrap();
        assert!(haunted_this_tick(&w));
        // RateLimited precedes the balance, cap and ID checks.
        give_joss(&mut w, 0);
        w.params.yearly_cap = 0;
        w.log.exhaust_ids_leaving(0);
        let before = crate::checksum::Checksum::of(&w);
        assert_eq!(validate(&w, target), Err(RejectReason::RateLimited));
        assert_eq!(apply(&mut w, target), Err(RejectReason::RateLimited));
        assert_eq!(crate::checksum::Checksum::of(&w), before);
    }
}
