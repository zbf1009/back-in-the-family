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
//!
//! This spec adds the underworld checks of design "Invariant checker additions": the
//! log is the joss ledger (`U1.2`, `U1.3`), the Yearly_Cap holds (`U2.5`, `U2.6`),
//! dreams and hauntings name a living Connected_Person (`U4.3`, `U5.3`), the
//! Player_Soul's wait is bounded and its claim open (`U7.10`, `U8.3`), and the
//! Magistrate stays fixed and outside the town (`U15.1`, `U15.4` to `U15.8`). Their
//! labels start with `U`, so they never collide with a life-sim label.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::events::{EventKind, fold_digest};
use crate::ids::{EventId, HouseholdId, PersonId, SoulId};
use crate::underworld::magistrate::Magistrate;
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
    /// Joss_Balances at the end of the previous tick (R1.3).
    previous_joss: BTreeMap<SoulId, u64>,
    /// `credited` of every Soul in every Cap_Year, folded from the log (R2.5).
    credited_by_year: BTreeMap<(SoulId, u64), u64>,
    /// Haunting and Rebuilt_Body spends of every Soul in every Cap_Year, folded from
    /// the log (R2.6).
    capped_spent_by_year: BTreeMap<(SoulId, u64), u64>,
    /// The Magistrate as Opening_World generation created it (R15.1).
    magistrate: Magistrate,
}

impl InvariantChecker {
    /// Checks the Opening_World and remembers the state the first tick is compared with.
    pub fn new(world: &World) -> Result<Self, Violation> {
        check_world(world)?;
        check_log_tail(world, 0, &[0u8; 32])?;
        check_event_tail(world, 0)?;
        let previous_player_place = player_place(world)?;
        check_magistrate_log(world, 0)?;
        let mut credited_by_year = BTreeMap::new();
        let mut capped_spent_by_year = BTreeMap::new();
        // Opening_World generation leaves every Joss_Balance at 0, so the opening log
        // is folded against an empty baseline.
        check_ledger(
            world,
            0,
            &BTreeMap::new(),
            &mut credited_by_year,
            &mut capped_spent_by_year,
        )?;
        Ok(Self {
            previous_total_money: total_money(world),
            previous_log_len: world.log().len(),
            previous_digest: world.log().digest(),
            previous_player_place,
            previous_joss: previous_joss(world),
            credited_by_year,
            capped_spent_by_year,
            magistrate: world.magistrate().clone(),
        })
    }

    /// Checks every invariant at the end of a tick.
    pub fn after_tick(&mut self, world: &World) -> Result<(), Violation> {
        check_world(world)?;

        // R5.2: the log only grows; R5.10: the digest commits to every stored Event.
        // Only the Events appended since the last call are folded and inspected.
        check_log_tail(world, self.previous_log_len, &self.previous_digest)?;
        check_event_tail(world, self.previous_log_len)?;

        // U7.10: the Player_Soul leaves the Waiting_Queue only with a birth, possession or
        // rebuild Event for its new body in this tick (replaces life-sim check 20.1).
        let player_place = player_place(world)?;
        check_player_exit(world, self.previous_player_place, self.previous_log_len)?;

        // U1.2, U1.3, U2.5, U2.6: the log is the ledger and the cap counters agree with it.
        check_ledger(
            world,
            self.previous_log_len,
            &self.previous_joss,
            &mut self.credited_by_year,
            &mut self.capped_spent_by_year,
        )?;

        // U4.3, U5.3: a dream's dreamer and a haunting's target were a living
        // Connected_Person of the acting Ghost at the append.
        check_afterlife_targets(world, self.previous_log_len)?;

        // U15.1, U15.5, U15.8: the Magistrate never changes and stays outside the town.
        check_magistrate(world, &self.magistrate)?;
        check_magistrate_log(world, self.previous_log_len)?;

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
        self.previous_joss = previous_joss(world);
        Ok(())
    }
}

/// Every Soul's Joss_Balance, in Soul ID order (R1.1).
fn previous_joss(world: &World) -> BTreeMap<SoulId, u64> {
    world
        .joss()
        .iter()
        .map(|(&soul, account)| (soul, account.balance))
        .collect()
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
    check_player_wait(world)?;
    check_magistrate_state(world)?;
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
                EventKind::Possession { person, .. } | EventKind::Rebuild { person, .. } => {
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
            // R5.7: the actor exists. The one official Person exists outside
            // `World::persons`; its recipient-only rule is U15.8.
            if !world.persons().contains_key(&actor) && actor != world.magistrate().id {
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

/// U7.10: a transition of the Player_Soul out of the Waiting_Queue needs a `birth`,
/// `possession` or `rebuild` Event for the new body among the Events appended in the
/// tick (`log_start` is the log length before the tick).
fn check_player_exit(
    world: &World,
    previous_place: SoulPlace,
    log_start: usize,
) -> Result<(), Violation> {
    let SoulPlace::Body(body) = player_place(world)? else {
        return Ok(());
    };
    if !matches!(previous_place, SoulPlace::Waiting { .. }) {
        return Ok(());
    }
    let tail = world.log().events().get(log_start..).unwrap_or(&[]);
    let exited = tail.iter().any(|event| {
        matches!(
            &event.kind,
            EventKind::Birth { person }
                | EventKind::Possession { person, .. }
                | EventKind::Rebuild { person, .. } if *person == body
        )
    });
    if exited {
        return Ok(());
    }
    Err(violation(
        "U7.10",
        world,
        "the Player_Soul left the Waiting_Queue without a birth, possession or rebuild Event"
            .to_owned(),
    ))
}

/// U7.10 and U8.3: `player_wait` matches the Player_Soul's place, its claim names an
/// open slot, and the wait stays within Player_Max_Wait (R8.3).
fn check_player_wait(world: &World) -> Result<(), Violation> {
    let player = world.souls().player;
    let place = player_place(world)?;
    match (place, world.player_wait()) {
        (SoulPlace::Waiting { since }, Some(wait)) => {
            let ghost_ok = world.persons().get(&wait.ghost).is_some_and(|person| {
                person.soul == player && matches!(person.life, Life::Dead { .. })
            });
            if !ghost_ok {
                return Err(violation(
                    "U7.10",
                    world,
                    format!(
                        "the acting Ghost {} is not a dead body of the Player_Soul",
                        wait.ghost.0
                    ),
                ));
            }
            if let Some(claim) = wait.claim
                && !world.slots().contains_key(&claim)
            {
                return Err(violation(
                    "U7.10",
                    world,
                    format!("the Player_Soul's claim names closed slot {}", claim.0),
                ));
            }
            let waited = completed_tick(world).saturating_sub(since.0);
            if waited > world.params().player_max_wait {
                return Err(violation(
                    "U8.3",
                    world,
                    format!("the Player_Soul has waited {waited} days"),
                ));
            }
        }
        (SoulPlace::Body(_), None) => {}
        (SoulPlace::Waiting { .. }, None) => {
            return Err(violation(
                "U7.10",
                world,
                "the Player_Soul waits without a `player_wait`".to_owned(),
            ));
        }
        (SoulPlace::Body(_), Some(_)) => {
            return Err(violation(
                "U7.10",
                world,
                "`player_wait` is set while the Player_Soul is in a body".to_owned(),
            ));
        }
    }
    Ok(())
}

/// The Soul-owning actor of one ledger Event, the parts that move that Soul's balance
/// and whether the spend counts against the Yearly_Cap (OP-D3 A, R2.6).
struct LedgerFields {
    holder: PersonId,
    credit: u64,
    spend: u64,
    capped: bool,
}

/// The ledger line of one Event, or `None` for every Event that moves no joss paper
/// (R1.2: each Event carries at most one credit or spend, which this `match` states).
fn ledger_fields(kind: &EventKind) -> Option<LedgerFields> {
    match kind {
        EventKind::Offering {
            ghost, credited, ..
        } => Some(LedgerFields {
            holder: *ghost,
            credit: *credited,
            spend: 0,
            capped: false,
        }),
        EventKind::BribeOffering { ghost, amount, .. } => Some(LedgerFields {
            holder: *ghost,
            credit: 0,
            spend: *amount,
            capped: false,
        }),
        EventKind::Dream { ghost, price, .. } => Some(LedgerFields {
            holder: *ghost,
            credit: 0,
            spend: *price,
            capped: false,
        }),
        EventKind::Haunting { ghost, price, .. } => Some(LedgerFields {
            holder: *ghost,
            credit: 0,
            spend: *price,
            capped: true,
        }),
        EventKind::Possession { person, price } => Some(LedgerFields {
            holder: *person,
            credit: 0,
            spend: *price,
            capped: false,
        }),
        EventKind::Rebuild { person, price } => Some(LedgerFields {
            holder: *person,
            credit: 0,
            spend: *price,
            capped: true,
        }),
        _ => None,
    }
}

/// U1.2, U1.3, U2.5, U2.6: one account per Soul, every ledger field attributable to one
/// Soul, the per-tick balance identity of R1.3, and the Yearly_Cap of R2.5/R2.6 with
/// the counters the account keeps.
///
/// `previous` holds the balances at the end of the previous tick; `credited_by_year`
/// and `capped_spent_by_year` fold the ledger over the whole run and are advanced by the
/// Events from `start` on.
fn check_ledger(
    world: &World,
    start: usize,
    previous: &BTreeMap<SoulId, u64>,
    credited_by_year: &mut BTreeMap<(SoulId, u64), u64>,
    capped_spent_by_year: &mut BTreeMap<(SoulId, u64), u64>,
) -> Result<(), Violation> {
    let yearly_cap = world.params().yearly_cap;
    // R1.1: exactly one Joss_Balance per Soul, and no balance without a Soul.
    for &soul in world.souls().places.keys() {
        if !world.joss().contains_key(&soul) {
            return Err(violation(
                "U1.2",
                world,
                format!("soul {} has no Joss_Balance", soul.0),
            ));
        }
    }
    for &soul in world.joss().keys() {
        if !world.souls().places.contains_key(&soul) {
            return Err(violation(
                "U1.2",
                world,
                format!("Joss_Balance of unknown soul {}", soul.0),
            ));
        }
    }

    let events = world.log().events();
    let tail = events.get(start..).unwrap_or(&[]);
    // The bodies created in this tick: an Offering to a Ghost whose Soul a birth took
    // over in this same tick still names a waiting Soul at the append (R1.4).
    let reborn_this_tick: BTreeSet<PersonId> = tail
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Birth { person }
            | EventKind::Possession { person, .. }
            | EventKind::Rebuild { person, .. } => Some(*person),
            _ => None,
        })
        .collect();

    let mut movement: BTreeMap<SoulId, i128> = BTreeMap::new();
    for event in tail {
        let Some(fields) = ledger_fields(&event.kind) else {
            continue;
        };
        // U1.2: the credited or charged Person exists and carries a Soul.
        let Some(person) = world.persons().get(&fields.holder) else {
            return Err(violation(
                "U1.2",
                world,
                format!(
                    "event {} ({}) moves joss paper of unknown person {}",
                    event.id.0,
                    event.kind.card_type(),
                    fields.holder.0
                ),
            ));
        };
        let soul = person.soul;
        if !world.joss().contains_key(&soul) {
            return Err(violation(
                "U1.2",
                world,
                format!(
                    "event {} moves joss paper of soul {} with no account",
                    event.id.0, soul.0
                ),
            ));
        }
        if let EventKind::Offering {
            amount, credited, ..
        } = &event.kind
        {
            if *credited > *amount {
                return Err(violation(
                    "U1.2",
                    world,
                    format!(
                        "offering {} credits {credited} of a magnitude {amount}",
                        event.id.0
                    ),
                ));
            }
            // R1.4: an Offering with a credit names a Ghost, never a Soul in a body.
            if *credited > 0 && !matches!(person.life, Life::Dead { .. }) {
                return Err(violation(
                    "U1.2",
                    world,
                    format!(
                        "offering {} credits the living person {}",
                        event.id.0, fields.holder.0
                    ),
                ));
            }
            if *credited > 0
                && let Some(SoulPlace::Body(body)) = world.souls().places.get(&soul)
                && !reborn_this_tick.contains(body)
            {
                return Err(violation(
                    "U1.2",
                    world,
                    format!(
                        "offering {} credits soul {} in body {}",
                        event.id.0, soul.0, body.0
                    ),
                ));
            }
        }

        let year = event
            .tick
            .0
            .checked_div(crate::underworld::joss::DAYS_PER_CAP_YEAR)
            .unwrap_or(0);
        if fields.credit > 0 {
            let credited = credited_by_year.entry((soul, year)).or_insert(0);
            *credited = credited.saturating_add(fields.credit);
            if *credited > yearly_cap {
                return Err(violation(
                    "U2.5",
                    world,
                    format!(
                        "soul {} is credited {} in Cap_Year {year}, cap {yearly_cap}",
                        soul.0, *credited
                    ),
                ));
            }
        }
        if fields.capped && fields.spend > 0 {
            let spent = capped_spent_by_year.entry((soul, year)).or_insert(0);
            *spent = spent.saturating_add(fields.spend);
            if *spent > yearly_cap {
                return Err(violation(
                    "U2.6",
                    world,
                    format!(
                        "soul {} spends {spent} on hauntings and Rebuilt_Bodies in Cap_Year \
{year}, cap {yearly_cap}",
                        soul.0
                    ),
                ));
            }
        }
        let delta = i128::from(fields.credit).saturating_sub(i128::from(fields.spend));
        let entry = movement.entry(soul).or_insert(0);
        *entry = entry.saturating_add(delta);
    }

    // U1.3: the balance at the end of the tick is the balance at the start plus this
    // tick's credits minus this tick's spends, for every Soul.
    for (&soul, account) in world.joss() {
        let before = previous.get(&soul).copied().unwrap_or(0);
        let delta = movement.get(&soul).copied().unwrap_or(0);
        let expected = i128::from(before).saturating_add(delta);
        if expected < 0 || u128::try_from(expected).ok() != Some(u128::from(account.balance)) {
            return Err(violation(
                "U1.3",
                world,
                format!(
                    "soul {} holds {} after starting at {before} with a movement of {delta}",
                    soul.0, account.balance
                ),
            ));
        }
    }

    // U2.5, U2.6: the counters the account keeps are exactly the log's fold for the
    // Cap_Year it belongs to, and neither exceeds the Yearly_Cap.
    for (&soul, account) in world.joss() {
        if account.credited > yearly_cap {
            return Err(violation(
                "U2.5",
                world,
                format!(
                    "soul {} has a credit counter of {} in Cap_Year {}",
                    soul.0, account.credited, account.cap_year
                ),
            ));
        }
        if account.capped_spent > yearly_cap {
            return Err(violation(
                "U2.6",
                world,
                format!(
                    "soul {} has a spend counter of {} in Cap_Year {}",
                    soul.0, account.capped_spent, account.cap_year
                ),
            ));
        }
        let credited = credited_by_year
            .get(&(soul, account.cap_year))
            .copied()
            .unwrap_or(0);
        if account.credited != credited {
            return Err(violation(
                "U2.5",
                world,
                format!(
                    "soul {} credits {} but the log folded {credited} in Cap_Year {}",
                    soul.0, account.credited, account.cap_year
                ),
            ));
        }
        let spent = capped_spent_by_year
            .get(&(soul, account.cap_year))
            .copied()
            .unwrap_or(0);
        if account.capped_spent != spent {
            return Err(violation(
                "U2.6",
                world,
                format!(
                    "soul {} spent {} but the log folded {spent} in Cap_Year {}",
                    soul.0, account.capped_spent, account.cap_year
                ),
            ));
        }
    }
    Ok(())
}

/// U4.3, U5.3: every `dream` and `haunting` Event appended since `start` names a
/// Person who was a living Resident at the append and is connected to the acting Ghost,
/// unless the Person's own death came later in the same tick and removed the Relation.
fn check_afterlife_targets(world: &World, start: usize) -> Result<(), Violation> {
    let events = world.log().events();
    let tail = events.get(start..).unwrap_or(&[]);
    if !tail.iter().any(|event| {
        matches!(
            event.kind,
            EventKind::Dream { .. } | EventKind::Haunting { .. }
        )
    }) {
        return Ok(());
    }
    let mut first_death: BTreeMap<PersonId, EventId> = BTreeMap::new();
    for event in events {
        if let EventKind::Death { person } = event.kind {
            first_death.entry(person).or_insert(event.id);
        }
    }
    for event in tail {
        let (criterion, target, ghost) = match &event.kind {
            EventKind::Dream { ghost, dreamer, .. } => ("U4.3", *dreamer, *ghost),
            EventKind::Haunting { ghost, target, .. } => ("U5.3", *target, *ghost),
            _ => continue,
        };
        if let Some(&death) = first_death.get(&target) {
            if death.0 < event.id.0 {
                return Err(violation(
                    criterion,
                    world,
                    format!(
                        "event {} ({}) names person {} whose death event {} is earlier",
                        event.id.0,
                        event.kind.card_type(),
                        target.0,
                        death.0
                    ),
                ));
            }
            // The Person died after the append, so a non-kin Relation removed by that
            // death is not evidence of a bad append.
            continue;
        }
        if !world.relations().contains_key(&(target, ghost)) {
            return Err(violation(
                criterion,
                world,
                format!(
                    "event {} ({}) names person {} with no Relation to the acting Ghost {}",
                    event.id.0,
                    event.kind.card_type(),
                    target.0,
                    ghost.0
                ),
            ));
        }
    }
    Ok(())
}

/// U15.1, U15.4 to U15.7: the Magistrate is the Opening_World Magistrate and stays out
/// of every Household, Relation, Debt, property and Soul_Place (R15.1, R15.4 to R15.7).
fn check_magistrate(world: &World, opening: &Magistrate) -> Result<(), Violation> {
    if world.magistrate() != opening {
        return Err(violation(
            "U15.1",
            world,
            format!(
                "the Magistrate changed from {:?} to {:?}",
                opening,
                world.magistrate()
            ),
        ));
    }
    check_magistrate_state(world)
}

/// The world-only half of [`check_magistrate`] (R15.4 to R15.7).
fn check_magistrate_state(world: &World) -> Result<(), Violation> {
    let id = world.magistrate().id;
    // R15.4: no Resident entry (so no money balance), no Household, no property, no Debt.
    if world.persons().contains_key(&id) {
        return Err(violation(
            "U15.4",
            world,
            format!("the Magistrate {} is stored as a Person", id.0),
        ));
    }
    if world
        .properties()
        .values()
        .any(|property| property.owner == id)
    {
        return Err(violation(
            "U15.4",
            world,
            format!("the Magistrate {} owns a property item", id.0),
        ));
    }
    if world
        .debts()
        .values()
        .any(|debt| debt.creditor == id || debt.debtor == id)
    {
        return Err(violation(
            "U15.4",
            world,
            format!("the Magistrate {} is part of a Debt", id.0),
        ));
    }
    // R15.6: no Soul and no Soul_Place.
    for (&soul, place) in &world.souls().places {
        if matches!(place, SoulPlace::Body(body) if *body == id) {
            return Err(violation(
                "U15.6",
                world,
                format!("soul {} is placed in the Magistrate's body", soul.0),
            ));
        }
    }
    // R15.7: no Relation from or to the Magistrate.
    for &(from, to) in world.relations().keys() {
        if from == id || to == id {
            return Err(violation(
                "U15.7",
                world,
                format!("the Magistrate {} has a Relation", id.0),
            ));
        }
    }
    Ok(())
}

/// U15.5, U15.8: no Event runs a rule with the Magistrate in a role (R15.5) and the
/// Magistrate appears only as the recipient of an `appeal` or of its `offering`
/// (R15.8).
fn check_magistrate_log(world: &World, start: usize) -> Result<(), Violation> {
    let id = world.magistrate().id;
    let events = world.log().events();
    for event in events.iter().skip(start) {
        let names_official = event.kind.actors().iter().any(|actor| actor == id)
            || matches!(
                &event.kind,
                EventKind::Possession { person, .. } | EventKind::Rebuild { person, .. }
                    if *person == id
            );
        if !names_official {
            continue;
        }
        // R15.5: no rule role. The two afterlife kinds of R15.8 are the only exceptions.
        if !matches!(
            event.kind,
            EventKind::Appeal { .. } | EventKind::BribeOffering { .. }
        ) {
            return Err(violation(
                "U15.5",
                world,
                format!(
                    "event {} ({}) runs a rule with the Magistrate {}",
                    event.id.0,
                    event.kind.card_type(),
                    id.0
                ),
            ));
        }
        // R15.8: second actor only.
        let actors: Vec<PersonId> = event.kind.actors().iter().collect();
        if actors.len() != 2 || actors[1] != id {
            return Err(violation(
                "U15.8",
                world,
                format!(
                    "event {} ({}) names the Magistrate {} outside the recipient position",
                    event.id.0,
                    event.kind.card_type(),
                    id.0
                ),
            ));
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
    fn a_player_wait_while_the_player_is_in_a_body_is_caught_as_u7_10() {
        let mut w = world();
        let ghost = *w.persons.keys().next().expect("the town has Persons");
        w.player_wait = Some(crate::underworld::player::PlayerWait {
            ghost,
            access_from: crate::ids::Tick(0),
            claim: None,
            carry_over: None,
        });
        let violation = check_player_wait(&w).unwrap_err();
        assert_eq!(violation.criterion, "U7.10");
    }

    #[test]
    fn a_player_wait_past_player_max_wait_is_caught_as_u8_3() {
        let mut w = world();
        let player = w.souls.player;
        let SoulPlace::Body(body) = w.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        if let Some(person) = w.persons.get_mut(&body) {
            person.life = Life::Dead {
                death: crate::ids::Tick(0),
            };
        }
        w.souls.places.insert(
            player,
            SoulPlace::Waiting {
                since: crate::ids::Tick(0),
            },
        );
        w.params.player_max_wait = 5;
        w.tick = crate::ids::Tick(10);
        w.player_wait = Some(crate::underworld::player::PlayerWait {
            ghost: body,
            access_from: crate::ids::Tick(0),
            claim: None,
            carry_over: None,
        });
        let violation = check_player_wait(&w).unwrap_err();
        assert_eq!(violation.criterion, "U8.3");
    }

    #[test]
    fn a_claim_on_a_closed_slot_is_caught_as_u7_10() {
        let mut w = world();
        let player = w.souls.player;
        let SoulPlace::Body(body) = w.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        if let Some(person) = w.persons.get_mut(&body) {
            person.life = Life::Dead {
                death: crate::ids::Tick(0),
            };
        }
        w.souls.places.insert(
            player,
            SoulPlace::Waiting {
                since: crate::ids::Tick(0),
            },
        );
        w.tick = crate::ids::Tick(1);
        w.player_wait = Some(crate::underworld::player::PlayerWait {
            ghost: body,
            access_from: crate::ids::Tick(0),
            claim: Some(crate::ids::BirthSlotId(9)),
            carry_over: None,
        });
        let violation = check_player_wait(&w).unwrap_err();
        assert_eq!(violation.criterion, "U7.10");
    }

    #[test]
    fn a_departure_without_an_event_is_caught_as_u7_10() {
        let w = world();
        let violation = check_player_exit(
            &w,
            SoulPlace::Waiting {
                since: crate::ids::Tick(0),
            },
            0,
        )
        .unwrap_err();
        assert_eq!(violation.criterion, "U7.10");
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

    /// A World with one tick run, the checker that saw the Opening_World and the first
    /// Resident (every case moves that Resident's joss paper).
    fn stepped_world() -> (World, InvariantChecker, PersonId) {
        let mut w = world();
        let person = w
            .persons
            .values()
            .find(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .expect("the town has Residents");
        let checker = InvariantChecker::new(&w).unwrap();
        w.step(&[]);
        (w, checker, person)
    }

    #[test]
    fn a_balance_that_the_log_does_not_explain_is_caught_as_u1_3() {
        let (mut w, mut checker, person) = stepped_world();
        let soul = w.persons[&person].soul;
        if let Some(account) = w.joss.get_mut(&soul) {
            account.balance = account.balance.saturating_add(7);
        }
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U1.3");
    }

    #[test]
    fn a_missing_account_is_caught_as_u1_2() {
        let (mut w, mut checker, person) = stepped_world();
        let soul = w.persons[&person].soul;
        w.joss.remove(&soul);
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U1.2");
    }

    #[test]
    fn an_offering_credited_to_a_living_person_is_caught_as_u1_2() {
        let (mut w, mut checker, _soul) = stepped_world();
        let actors: Vec<PersonId> = w
            .persons
            .values()
            .filter(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .take(2)
            .collect();
        w.append(
            EventKind::Offering {
                offerer: actors[0],
                ghost: actors[1],
                amount: 5,
                credited: 5,
            },
            crate::events::CausedBy::default(),
            crate::events::EventTags::empty(),
        )
        .expect("a living Ghost is still an appendable Offering");
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U1.2");
    }

    #[test]
    fn a_credit_counter_above_the_cap_is_caught_as_u2_5() {
        let (mut w, mut checker, person) = stepped_world();
        let soul = w.persons[&person].soul;
        let cap = w.params.yearly_cap;
        if let Some(account) = w.joss.get_mut(&soul) {
            account.credited = cap.saturating_add(1);
        }
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U2.5");
    }

    #[test]
    fn a_capped_spend_counter_that_the_log_does_not_hold_is_caught_as_u2_6() {
        let (mut w, mut checker, person) = stepped_world();
        let soul = w.persons[&person].soul;
        if let Some(account) = w.joss.get_mut(&soul) {
            account.capped_spent = 40;
        }
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U2.6");
    }

    #[test]
    fn a_dream_of_a_dead_person_is_caught_as_u4_3() {
        let (mut w, mut checker, _soul) = stepped_world();
        let actors: Vec<PersonId> = w
            .persons
            .values()
            .filter(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .take(2)
            .collect();
        let (ghost, dreamer) = (actors[0], actors[1]);
        w.append(
            EventKind::Death { person: dreamer },
            crate::events::CausedBy::default(),
            crate::events::EventTags::empty(),
        )
        .expect("a Death Event is valid");
        if let Some(person) = w.persons.get_mut(&dreamer) {
            person.life = Life::Dead { death: w.tick };
        }
        // A dead Resident keeps only its kin Relations (R6.4).
        w.relations
            .retain(|&(from, _), relation| from != dreamer || relation.tags.has_kinship());
        let soul = w.persons[&dreamer].soul;
        w.souls
            .places
            .insert(soul, SoulPlace::Waiting { since: w.tick });
        w.append(
            EventKind::Dream {
                ghost,
                dreamer,
                price: 0,
            },
            crate::events::CausedBy::default(),
            crate::events::EventTags::empty(),
        )
        .expect("the afterlife kinds accept a dead actor");
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U4.3");
    }

    #[test]
    fn a_haunting_of_an_unconnected_person_is_caught_as_u5_3() {
        let (mut w, mut checker, _soul) = stepped_world();
        let residents: Vec<PersonId> = w
            .persons
            .values()
            .filter(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .collect();
        let (ghost, target) = residents
            .iter()
            .flat_map(|&a| residents.iter().map(move |&b| (a, b)))
            .find(|&(a, b)| a != b && !w.relations.contains_key(&(b, a)))
            .expect("two Residents without a Relation");
        w.append(
            EventKind::Haunting {
                ghost,
                target,
                intensity: 50,
                price: 0,
            },
            crate::events::CausedBy::default(),
            crate::events::EventTags::empty(),
        )
        .expect("an unconnected haunting is still appendable");
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U5.3");
    }

    #[test]
    fn a_changed_magistrate_is_caught_as_u15_1() {
        let (mut w, mut checker, _soul) = stepped_world();
        w.magistrate.traits.greed = crate::values::Trait::clamped(3);
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U15.1");
    }

    #[test]
    fn a_magistrate_relation_is_caught_as_u15_7() {
        let mut w = world();
        let id = w.magistrate.id;
        let other = *w.persons.keys().next().expect("the town has Persons");
        w.relations.insert(
            (other, id),
            crate::world::Relation {
                affinity: crate::values::Score::clamped(0),
                trust: crate::values::Score::clamped(0),
                tags: crate::values::RelTags::empty(),
            },
        );
        let violation = check_magistrate_state(&w).unwrap_err();
        assert_eq!(violation.criterion, "U15.7");
    }

    #[test]
    fn a_magistrate_household_or_property_is_caught_as_u15_4() {
        let mut w = world();
        let id = w.magistrate.id;
        w.properties.insert(
            crate::ids::PropertyId(1),
            crate::world::Property {
                id: crate::ids::PropertyId(1),
                kind: crate::world::PropertyKind::Heirloom,
                owner: id,
            },
        );
        let violation = check_magistrate_state(&w).unwrap_err();
        assert_eq!(violation.criterion, "U15.4");
    }

    #[test]
    fn a_soul_placed_in_the_magistrate_is_caught_as_u15_6() {
        let mut w = world();
        let id = w.magistrate.id;
        let soul = *w.souls.places.keys().next().expect("the town has Souls");
        w.souls.places.insert(soul, SoulPlace::Body(id));
        let violation = check_magistrate_state(&w).unwrap_err();
        assert_eq!(violation.criterion, "U15.6");
    }

    #[test]
    fn a_rule_event_naming_the_magistrate_is_caught_as_u15_5() {
        let (mut w, mut checker, _soul) = stepped_world();
        let id = w.magistrate.id;
        w.log
            .push(
                w.tick,
                EventKind::Birth { person: id },
                crate::events::CausedBy::default(),
                crate::events::EventTags::empty(),
            )
            .unwrap();
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U15.5");
    }

    #[test]
    fn an_appeal_naming_the_magistrate_first_is_caught_as_u15_8() {
        let (mut w, mut checker, _soul) = stepped_world();
        let id = w.magistrate.id;
        let resident = *w.persons.keys().next().expect("the town has Persons");
        w.log
            .push(
                w.tick,
                EventKind::Appeal {
                    ghost: id,
                    magistrate: resident,
                },
                crate::events::CausedBy::default(),
                crate::events::EventTags::empty(),
            )
            .unwrap();
        let violation = checker.after_tick(&w).unwrap_err();
        assert_eq!(violation.criterion, "U15.8");
    }

    #[test]
    fn a_correct_appeal_to_the_magistrate_passes() {
        let (mut w, mut checker, _soul) = stepped_world();
        let id = w.magistrate.id;
        let resident = *w.persons.keys().next().expect("the town has Persons");
        w.append(
            EventKind::Appeal {
                ghost: resident,
                magistrate: id,
            },
            crate::events::CausedBy::default(),
            crate::events::EventTags::empty(),
        )
        .expect("an appeal may address the Magistrate");
        checker.after_tick(&w).expect("the appeal is valid");
    }
}
