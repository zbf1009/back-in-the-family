//! The per-tick invariant checker (R17.6, R19.1, design "Fault injection").
//!
//! [`InvariantChecker`] is stateful: it keeps the previous total money, the previous
//! log length, the Event_Log digest at that length and the previous Player_Soul place so
//! it can check the per-tick invariants (money conservation, append-only history, the
//! Player_Soul staying in the Waiting_Queue) as well as the facts that only need the
//! current World. Event checks cover only the Events appended since the last call and
//! fold the digest incrementally (OP-8), so checking every tick stays linear in the new
//! Events instead of in the whole log.
//!
//! `sim-cli batch` and the property tests use this one implementation, so R17.6 and
//! Property 1 exercise the same code. Every check returns the first
//! [`Violation`] with the requirement number as `criterion` text (for example `"9.3"`).

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::events::{EventKind, fold_digest};
use crate::ids::{EventId, HouseholdId, PersonId};
use crate::world::{Life, SoulPlace, World};

/// The first broken invariant, as reported by `sim-cli batch` (R17.7).
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Violation {
    /// The requirement criterion number, for example `"9.3"`.
    pub criterion: &'static str,
    /// The tick the checked state belongs to: the tick that just ran (the World's tick
    /// minus one after a step), or 0 for the Opening_World.
    pub tick: u64,
    /// Human-readable detail naming the offending ID or value.
    pub detail: String,
}

impl fmt::Display for Violation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "tick={} criterion={} detail: {}",
            self.tick, self.criterion, self.detail
        )
    }
}

impl std::error::Error for Violation {}

/// A stateful invariant checker over one World.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct InvariantChecker {
    previous_total_money: u64,
    previous_log_len: usize,
    previous_digest: [u8; 32],
    previous_player_place: SoulPlace,
}

impl InvariantChecker {
    /// Checks the Opening_World and remembers the state the first tick is compared with.
    pub fn new(world: &World) -> Result<Self, Violation> {
        check_world(world)?;
        check_log_tail(world, 0, &[0u8; 32])?;
        check_event_tail(world, 0)?;
        let previous_player_place = player_place(world)?;
        Ok(Self {
            previous_total_money: total_money(world),
            previous_log_len: world.log().len(),
            previous_digest: world.log().digest(),
            previous_player_place,
        })
    }

    /// Checks every invariant at the end of a tick.
    pub fn after_tick(&mut self, world: &World) -> Result<(), Violation> {
        check_world(world)?;

        // R5.2: the log only grows; R5.10: the digest commits to every stored Event.
        // Only the Events appended since the last call are folded and inspected.
        check_log_tail(world, self.previous_log_len, &self.previous_digest)?;
        check_event_tail(world, self.previous_log_len)?;

        // R20.1: a waiting Player_Soul stays waiting.
        let player_place = player_place(world)?;
        if matches!(self.previous_player_place, SoulPlace::Waiting { .. })
            && !matches!(player_place, SoulPlace::Waiting { .. })
        {
            return Err(violation(
                "20.1",
                world,
                "the Player_Soul left the Waiting_Queue without an input".to_owned(),
            ));
        }

        // R3.5: total money after = before + sources - sinks.
        let current_total = total_money(world);
        let flows = world.last_flows();
        let expected = u128::from(self.previous_total_money)
            .checked_add(u128::from(flows.sources))
            .and_then(|value| value.checked_sub(u128::from(flows.sinks)));
        if expected != Some(u128::from(current_total)) {
            return Err(violation(
                "3.5",
                world,
                format!(
                    "money went from {} to {} with {} sources and {} sinks",
                    self.previous_total_money, current_total, flows.sources, flows.sinks
                ),
            ));
        }

        self.previous_total_money = current_total;
        self.previous_log_len = world.log().len();
        self.previous_digest = world.log().digest();
        self.previous_player_place = player_place;
        Ok(())
    }
}

/// The tick the checked state belongs to: the tick just run, which is the World's tick
/// minus one after [`World::step`](crate::tick::World::step) advanced it. The opening
/// World (tick 0) reports tick 0.
fn completed_tick(world: &World) -> u64 {
    world.tick().0.saturating_sub(1)
}

fn violation(criterion: &'static str, world: &World, detail: String) -> Violation {
    Violation {
        criterion,
        tick: completed_tick(world),
        detail,
    }
}

/// Total money in the World: the sum of every living balance (R3.5).
pub fn total_money(world: &World) -> u64 {
    world
        .persons()
        .values()
        .filter_map(|person| match person.life {
            Life::Alive { money, .. } => Some(money),
            Life::Dead { .. } => None,
        })
        .fold(0u64, u64::saturating_add)
}

fn player_place(world: &World) -> Result<SoulPlace, Violation> {
    world
        .souls()
        .places
        .get(&world.souls().player)
        .copied()
        .ok_or_else(|| {
            violation(
                "9.1",
                world,
                format!("Player_Soul {} has no place", world.souls().player.0),
            )
        })
}

/// Checks that need only the current World (everything except the log tail and the
/// per-tick deltas).
fn check_world(world: &World) -> Result<(), Violation> {
    check_persons(world)?;
    check_households(world)?;
    check_properties(world)?;
    check_relations(world)?;
    check_souls(world)?;
    check_debts(world)?;
    check_waiting(world)?;
    check_names(world)?;
    Ok(())
}

/// R5.2 and R5.10 for the Events from index `start` on, folding the digest from
/// `previous_digest` (the stored digest when the log was `start` events long).
fn check_log_tail(
    world: &World,
    start: usize,
    previous_digest: &[u8; 32],
) -> Result<(), Violation> {
    let events = world.log().events();
    if events.len() < start {
        return Err(violation(
            "5.2",
            world,
            format!("log shrank from {start} to {} events", events.len()),
        ));
    }
    let mut digest = *previous_digest;
    for (index, event) in events.iter().enumerate().skip(start) {
        let expected = u64::try_from(index).unwrap_or(u64::MAX).saturating_add(1);
        if event.id.0 != expected {
            return Err(violation(
                "5.2",
                world,
                format!("event {} is stored at index {}", event.id.0, index),
            ));
        }
        digest = fold_digest(&digest, event);
    }
    if digest != world.log().digest() {
        return Err(violation(
            "5.10",
            world,
            "the stored Event_Log digest differs from the folded one".to_owned(),
        ));
    }
    Ok(())
}

/// R2.2, R2.5, R6.2.
fn check_persons(world: &World) -> Result<(), Violation> {
    for (&id, person) in world.persons() {
        if person.id != id {
            return Err(violation(
                "2.5",
                world,
                format!("person key {} holds id {}", id.0, person.id.0),
            ));
        }
        let traits = &person.traits;
        for (name, trait_value) in [
            ("greed", traits.greed),
            ("loyalty", traits.loyalty),
            ("pride", traits.pride),
            ("warmth", traits.warmth),
            ("temper", traits.temper),
            ("vindictiveness", traits.vindictiveness),
            ("piety", traits.piety),
        ] {
            if !(-3..=3).contains(&trait_value.get()) {
                return Err(violation(
                    "2.2",
                    world,
                    format!("person {} has {name} {}", id.0, trait_value.get()),
                ));
            }
        }
        if matches!(person.life, Life::Alive { .. }) {
            let age = world.age_years(person);
            if age > 120 {
                return Err(violation(
                    "6.2",
                    world,
                    format!("resident {} is {age} years old", id.0),
                ));
            }
        }
    }
    Ok(())
}

/// R3.1, R3.2, R3.6.
fn check_households(world: &World) -> Result<(), Violation> {
    // One pass over the Residents: `Life::Alive.household` is the member list, so a dead
    // Person cannot appear in it (R3.2 holds by construction) and every Household's
    // member count falls out of the same pass.
    let mut member_count: BTreeMap<HouseholdId, u32> = BTreeMap::new();
    for (&id, person) in world.persons() {
        if let Life::Alive { household, .. } = person.life {
            if !world.households().contains_key(&household) {
                return Err(violation(
                    "3.1",
                    world,
                    format!("resident {} names missing household {}", id.0, household.0),
                ));
            }
            let count = member_count.entry(household).or_insert(0);
            *count = count.saturating_add(1);
        }
    }
    for &id in world.households().keys() {
        if member_count.get(&id).copied().unwrap_or(0) == 0 {
            return Err(violation(
                "3.6",
                world,
                format!("household {} has no member", id.0),
            ));
        }
    }
    Ok(())
}

/// R3.3.
fn check_properties(world: &World) -> Result<(), Violation> {
    for (&id, property) in world.properties() {
        match world.persons().get(&property.owner).map(|p| &p.life) {
            Some(Life::Alive { .. }) => {}
            _ => {
                return Err(violation(
                    "3.3",
                    world,
                    format!(
                        "property {} is owned by non-resident {}",
                        id.0, property.owner.0
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// R4.2 to R4.6 and R6.4.
fn check_relations(world: &World) -> Result<(), Violation> {
    let mut parent_count: BTreeMap<PersonId, u32> = BTreeMap::new();
    let mut living_spouse_count: BTreeMap<PersonId, u32> = BTreeMap::new();
    for (&(from, to), relation) in world.relations() {
        if from == to {
            return Err(violation(
                "4.2",
                world,
                format!("relation from {} to itself", from.0),
            ));
        }
        let from_dead = world
            .persons()
            .get(&from)
            .is_some_and(|p| matches!(p.life, Life::Dead { .. }));
        if from_dead && !relation.tags.has_kinship() {
            return Err(violation(
                "6.4",
                world,
                format!("dead person {} has a non-kin relation to {}", from.0, to.0),
            ));
        }
        if relation.tags.contains(crate::values::RelationTag::Parent) {
            let count = parent_count.entry(from).or_insert(0);
            *count = count.saturating_add(1);
            if *count > 2 {
                return Err(violation(
                    "4.5",
                    world,
                    format!("person {} has more than two parent relations", from.0),
                ));
            }
            require_tag(world, to, from, crate::values::RelationTag::Child, "4.3")?;
        }
        if relation.tags.contains(crate::values::RelationTag::Child) {
            require_tag(world, to, from, crate::values::RelationTag::Parent, "4.3")?;
        }
        if relation.tags.contains(crate::values::RelationTag::Spouse) {
            require_tag(world, to, from, crate::values::RelationTag::Spouse, "4.3")?;
            let from_alive = world
                .persons()
                .get(&from)
                .is_some_and(|p| matches!(p.life, Life::Alive { .. }));
            let to_alive = world
                .persons()
                .get(&to)
                .is_some_and(|p| matches!(p.life, Life::Alive { .. }));
            if from_alive && to_alive {
                let count = living_spouse_count.entry(from).or_insert(0);
                *count = count.saturating_add(1);
                if *count > 1 {
                    return Err(violation(
                        "4.6",
                        world,
                        format!("resident {} has more than one living spouse", from.0),
                    ));
                }
            }
        }
        if relation.tags.contains(crate::values::RelationTag::Sibling) {
            require_tag(world, to, from, crate::values::RelationTag::Sibling, "4.3")?;
        }
    }

    check_acyclic_kinship(world)
}

fn require_tag(
    world: &World,
    from: PersonId,
    to: PersonId,
    tag: crate::values::RelationTag,
    criterion: &'static str,
) -> Result<(), Violation> {
    let reverse = world.relations().get(&(from, to));
    if reverse.is_none_or(|relation| !relation.tags.contains(tag)) {
        return Err(violation(
            criterion,
            world,
            format!("relation {} -> {} lacks `{}`", from.0, to.0, tag.name()),
        ));
    }
    Ok(())
}

/// R4.4: following `parent` tags never leads back to the start.
fn check_acyclic_kinship(world: &World) -> Result<(), Violation> {
    // The parent adjacency is built once: a per-node scan of the Relation map would make
    // the per-tick check O(persons x relations).
    let mut parents: BTreeMap<PersonId, Vec<PersonId>> = BTreeMap::new();
    for (&(from, to), relation) in world.relations() {
        if relation.tags.contains(crate::values::RelationTag::Parent) {
            parents.entry(from).or_default().push(to);
        }
    }
    // 0 = unvisited, 1 = on the current path, 2 = done.
    let mut colour: BTreeMap<PersonId, u8> = BTreeMap::new();
    for &start in world.persons().keys() {
        if colour.get(&start).copied().unwrap_or(0) != 0 {
            continue;
        }
        let mut stack: Vec<(PersonId, bool)> = vec![(start, false)];
        while let Some((node, leaving)) = stack.pop() {
            if leaving {
                colour.insert(node, 2);
                continue;
            }
            match colour.get(&node).copied().unwrap_or(0) {
                2 => continue,
                1 => {
                    return Err(violation(
                        "4.4",
                        world,
                        format!("parent cycle through person {}", node.0),
                    ));
                }
                _ => {}
            }
            colour.insert(node, 1);
            stack.push((node, true));
            if let Some(children) = parents.get(&node) {
                for &child in children {
                    match colour.get(&child).copied().unwrap_or(0) {
                        1 => {
                            return Err(violation(
                                "4.4",
                                world,
                                format!("parent cycle through person {}", child.0),
                            ));
                        }
                        2 => {}
                        _ => stack.push((child, false)),
                    }
                }
            }
        }
    }
    Ok(())
}

/// R5.6, R5.7, R5.8, R7.3 for the Events from index `start` on.
fn check_event_tail(world: &World, start: usize) -> Result<(), Violation> {
    let events = world.log().events();
    if start >= events.len() {
        return Ok(());
    }
    let tail = &events[start..];
    // The death and arrival maps are only needed when the tail can exercise R5.8 or
    // R7.3; building them costs one scan of the log, so skip it on ordinary ticks.
    let needs_history = tail.iter().any(|event| {
        matches!(
            event.kind,
            EventKind::Death { .. } | EventKind::Inheritance { .. }
        ) || event.kind.actors().iter().any(|actor| {
            world
                .persons()
                .get(&actor)
                .is_some_and(|p| matches!(p.life, Life::Dead { .. }))
        })
    });
    let mut death_event: BTreeMap<PersonId, EventId> = BTreeMap::new();
    let mut outsider_event: BTreeMap<PersonId, EventId> = BTreeMap::new();
    if needs_history {
        for event in events {
            match event.kind {
                EventKind::Death { person } => {
                    death_event.insert(person, event.id);
                }
                EventKind::Possession { person } | EventKind::Rebuild { person } => {
                    outsider_event.entry(person).or_insert(event.id);
                }
                _ => {}
            }
        }
    }

    for event in tail {
        for cause in event.caused_by.iter() {
            match world.log().event(cause) {
                Some(cited) if cited.id.0 < event.id.0 && cited.tick <= event.tick => {}
                _ => {
                    return Err(violation(
                        "5.6",
                        world,
                        format!("event {} cites invalid cause {}", event.id.0, cause.0),
                    ));
                }
            }
        }
        for actor in event.kind.actors().iter() {
            if !world.persons().contains_key(&actor) {
                return Err(violation(
                    "5.7",
                    world,
                    format!("event {} names unknown actor {}", event.id.0, actor.0),
                ));
            }
            if !event.kind.is_afterlife()
                && death_event
                    .get(&actor)
                    .is_some_and(|death| death.0 < event.id.0)
            {
                return Err(violation(
                    "5.8",
                    world,
                    format!(
                        "event {} ({}) lists dead actor {}",
                        event.id.0,
                        event.kind.card_type(),
                        actor.0
                    ),
                ));
            }
        }
        if let EventKind::Inheritance { deceased, heir, .. } = event.kind {
            let death = death_event.get(&deceased).copied();
            let outsider = outsider_event.get(&heir).copied();
            if let (Some(death), Some(outsider)) = (death, outsider)
                && death.0 < outsider.0
            {
                return Err(violation(
                    "7.3",
                    world,
                    format!(
                        "event {} names outsider {} as heir of a death before their arrival",
                        event.id.0, heir.0
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// R9.1 to R9.4.
fn check_souls(world: &World) -> Result<(), Violation> {
    let souls = world.souls();
    // R9.3: Total_Souls is fixed at opening, so the place count must still match it.
    // Comparing against Total_Souls (not only against the live place count) catches a
    // Soul entry that disappeared.
    let expected_total =
        u64::from(world.config().opening_residents).saturating_add(world.params().initial_waiting);
    let soul_count = u64::try_from(souls.places.len()).unwrap_or(u64::MAX);
    if soul_count != expected_total {
        return Err(violation(
            "9.3",
            world,
            format!("Total_Souls is {soul_count}, expected {expected_total}"),
        ));
    }
    let counter = souls.ids.peek();
    let expected_counter = u64::try_from(souls.places.len())
        .unwrap_or(u64::MAX)
        .saturating_add(1);
    if counter != expected_counter {
        return Err(violation(
            "9.4",
            world,
            format!(
                "soul counter is {counter} but the World holds {} souls",
                souls.places.len()
            ),
        ));
    }

    let mut body_persons: BTreeSet<PersonId> = BTreeSet::new();
    // R9.1: a Resident's Soul is in that Resident's body, never in the queue. This check
    // runs before the aggregate counts so a birth that keeps its Soul waiting is
    // reported as 9.1 instead of as a body-count mismatch.
    for (&id, person) in world.persons() {
        if !matches!(person.life, Life::Alive { .. }) {
            continue;
        }
        match souls.places.get(&person.soul) {
            Some(SoulPlace::Body(owner)) if *owner == id => {}
            Some(SoulPlace::Body(owner)) => {
                return Err(violation(
                    "9.2",
                    world,
                    format!(
                        "resident {} carries soul {} whose place is body {}",
                        id.0, person.soul.0, owner.0
                    ),
                ));
            }
            Some(SoulPlace::Waiting { since }) => {
                return Err(violation(
                    "9.1",
                    world,
                    format!(
                        "resident {} is alive but its soul {} waits since {}",
                        id.0, person.soul.0, since.0
                    ),
                ));
            }
            None => {
                return Err(violation(
                    "9.1",
                    world,
                    format!("soul {} of resident {} has no place", person.soul.0, id.0),
                ));
            }
        }
    }
    for (&soul, place) in &souls.places {
        if soul.0.checked_add(1).is_none_or(|next| next > counter) {
            return Err(violation(
                "9.4",
                world,
                format!("soul {} is at or above the counter {counter}", soul.0),
            ));
        }
        if let SoulPlace::Body(person) = place {
            let Some(entry) = world.persons().get(person) else {
                return Err(violation(
                    "9.2",
                    world,
                    format!("soul {} is in unknown body {}", soul.0, person.0),
                ));
            };
            if !matches!(entry.life, Life::Alive { .. }) {
                return Err(violation(
                    "9.1",
                    world,
                    format!("soul {} is in the dead body {}", soul.0, person.0),
                ));
            }
            if entry.soul != soul {
                return Err(violation(
                    "9.2",
                    world,
                    format!(
                        "body {} carries soul {} but its place says {}",
                        person.0, entry.soul.0, soul.0
                    ),
                ));
            }
            if !body_persons.insert(*person) {
                return Err(violation(
                    "9.2",
                    world,
                    format!("person {} is in two bodies", person.0),
                ));
            }
        }
    }

    let residents = world
        .persons()
        .values()
        .filter(|p| matches!(p.life, Life::Alive { .. }))
        .count();
    if body_persons.len() != residents {
        return Err(violation(
            "9.3",
            world,
            format!("{residents} residents but {} bodies", body_persons.len()),
        ));
    }
    for (&id, person) in world.persons() {
        if !matches!(person.life, Life::Alive { .. }) {
            continue;
        }
        match souls.places.get(&person.soul) {
            Some(SoulPlace::Body(owner)) if *owner == id => {}
            _ => {
                return Err(violation(
                    "9.2",
                    world,
                    format!(
                        "resident {} does not own its soul {}'s place",
                        id.0, person.soul.0
                    ),
                ));
            }
        }
    }
    let waiting = souls
        .places
        .values()
        .filter(|place| matches!(place, SoulPlace::Waiting { .. }))
        .count();
    if residents.saturating_add(waiting) != souls.places.len() {
        return Err(violation(
            "9.3",
            world,
            format!(
                "{residents} residents + {waiting} waiting souls != {} souls",
                souls.places.len()
            ),
        ));
    }
    Ok(())
}

/// R8.3 (and the creditor/debtor fact of R8.1).
fn check_debts(world: &World) -> Result<(), Violation> {
    for (&loan, debt) in world.debts() {
        if debt.creditor == debt.debtor {
            return Err(violation(
                "8.1",
                world,
                format!("debt {loan:?} is owed to oneself"),
            ));
        }
        if debt.open < 1 || debt.open > debt.principal {
            return Err(violation(
                "8.3",
                world,
                format!(
                    "debt {loan:?} has open {} of principal {}",
                    debt.open, debt.principal
                ),
            ));
        }
        for person in [debt.creditor, debt.debtor] {
            if !world.persons().contains_key(&person) {
                return Err(violation(
                    "8.1",
                    world,
                    format!("debt {loan:?} names unknown person {}", person.0),
                ));
            }
        }
    }
    Ok(())
}

/// R11.3 and R20.2.
fn check_waiting(world: &World) -> Result<(), Violation> {
    let max_wait = world.params().max_wait;
    let player = world.souls().player;
    for (&soul, place) in &world.souls().places {
        if soul == player {
            continue;
        }
        if let SoulPlace::Waiting { since } = place {
            let waited = completed_tick(world).saturating_sub(since.0);
            if waited > max_wait {
                return Err(violation(
                    "11.3",
                    world,
                    format!("soul {} has waited {waited} days", soul.0),
                ));
            }
        }
    }
    Ok(())
}

/// R13.3.
fn check_names(world: &World) -> Result<(), Violation> {
    let mut seen: BTreeSet<crate::names::FullName> = BTreeSet::new();
    for (&id, person) in world.persons() {
        if !matches!(person.life, Life::Alive { .. }) {
            continue;
        }
        if !seen.insert(person.name) {
            return Err(violation(
                "13.3",
                world,
                format!("resident {} shares a full name", id.0),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economy::{Flow, flow};
    use crate::world::WorldConfig;

    fn world() -> World {
        World::new(3, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    #[test]
    fn the_opening_world_and_every_empty_tick_pass_the_checker() {
        let mut w = world();
        let mut checker = InvariantChecker::new(&w).expect("opening world is valid");
        for tick in 0..30 {
            w.step(&[]);
            checker
                .after_tick(&w)
                .unwrap_or_else(|violation| panic!("tick {tick}: {violation}"));
        }
    }

    #[test]
    fn an_unbalanced_money_flow_is_caught_as_three_point_five() {
        let mut w = world();
        let mut checker = InvariantChecker::new(&w).unwrap();
        w.step(&[]);
        // Credit a resident without counting a source: total money rises.
        if let Some(person) = w.persons.values_mut().next()
            && let Life::Alive { money, .. } = &mut person.life
        {
            *money = money.saturating_add(100);
        }
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "3.5");
    }

    #[test]
    fn a_counted_source_conserves_money() {
        let mut w = world();
        let mut checker = InvariantChecker::new(&w).unwrap();
        w.flows = crate::economy::FlowTotals::default();
        let resident = *w
            .persons
            .values()
            .find(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| &p.id)
            .unwrap();
        assert!(flow(&mut w, Flow::Wage { to: resident }, 10));
        checker.after_tick(&w).expect("a counted source conserves");
    }

    #[test]
    fn a_dead_actor_outside_afterlife_events_is_caught() {
        let mut w = world();
        let mut checker = InvariantChecker::new(&w).unwrap();
        w.tick = crate::ids::Tick(1);
        let actors: Vec<PersonId> = w
            .persons
            .values()
            .filter(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .take(2)
            .collect();
        w.log
            .push(
                crate::ids::Tick(1),
                EventKind::Death { person: actors[0] },
                crate::events::CausedBy::default(),
                crate::events::EventTags::empty(),
            )
            .unwrap();
        w.log
            .push(
                crate::ids::Tick(1),
                EventKind::Social {
                    kind: crate::values::SocialKind::Help,
                    doer: actors[0],
                    target: actors[1],
                    intensity: crate::values::Intensity::new(10).unwrap(),
                },
                crate::events::CausedBy::default(),
                crate::events::EventTags::empty(),
            )
            .unwrap();
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "5.8");
    }
}
