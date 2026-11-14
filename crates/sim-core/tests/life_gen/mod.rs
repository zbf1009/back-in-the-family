//! Shared `proptest` generators and direct invariant checks for the life-sim
//! properties (task 8.1, design "Testing Strategy").
//!
//! Included by the property test files with `mod life_gen;`. A [`Scenario`] is a seed,
//! an `opening_residents` count in 40..=60, a Params choice and a list of `Act` inputs
//! that mixes valid and invalid payloads the way `sim-cli` `inputs.rs` does. Three
//! scenarios in four use `Params::stress()` (deaths, births, releases, debts at death
//! and remarriages inside 240 ticks); the fourth uses `Params::DEFAULT` so the real
//! rates stay covered.
//!
//! The checks in this file are deliberately independent of
//! [`InvariantChecker`](sim_core::invariants::InvariantChecker): the property tests run
//! both, so a bug in the checker cannot hide a broken invariant. Each check names the
//! requirement it enforces (`9.3`, `3.5`, ...).

#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use sim_core::checksum::Checksum;
use sim_core::events::{Event, EventKind, EventTag};
use sim_core::ids::{EventId, PersonId, SoulId, Tick};
use sim_core::input::{InputPayload, InputStream};
use sim_core::params::Params;
use sim_core::tick::Sim;
use sim_core::values::{RelationTag, SCORE_MAX, SCORE_MIN, SocialKind, Trait};
use sim_core::world::{Life, SoulPlace, World, WorldConfig};

/// Ticks generated per property case (design "Testing Strategy").
pub const TICKS: u64 = 240;

/// The six social kinds, in card order.
const KINDS: [SocialKind; 6] = [
    SocialKind::Help,
    SocialKind::Gift,
    SocialKind::Quarrel,
    SocialKind::Insult,
    SocialKind::Theft,
    SocialKind::Apology,
];

/// Which Params a scenario runs with.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ParamsChoice {
    /// Raised rates (`Params::stress()`): three cases in four.
    Stress,
    /// The calibrated defaults: one case in four.
    Default,
}

/// One generated run: seed, opening size, Params and a mixed input list.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Scenario {
    /// World seed.
    pub seed: u64,
    /// Opening residents, 40..=60.
    pub residents: u16,
    /// Stress or default rates.
    pub params: ParamsChoice,
    /// Inputs in submission order, all for ticks below [`TICKS`].
    pub inputs: Vec<(Tick, InputPayload)>,
}

impl Scenario {
    /// Builds a [`Sim`] from the scenario and submits every input.
    pub fn sim(&self) -> Sim {
        let config = WorldConfig::try_new(self.residents).expect("scenario config is in range");
        let mut sim = match self.params {
            ParamsChoice::Stress => {
                Sim::new_with_params(self.seed, config, Params::stress()).expect("opening world")
            }
            ParamsChoice::Default => Sim::new(self.seed, config).expect("opening world"),
        };
        for &(tick, payload) in &self.inputs {
            sim.submit(tick, payload)
                .expect("input tick is in the future");
        }
        sim
    }

    /// Builds the same run without the `Sim` wrapper: the World and its input stream.
    /// Property 16 needs a `&mut World` to discard and rebuild Derived_State.
    pub fn world_and_inputs(&self) -> (World, InputStream) {
        let config = WorldConfig::try_new(self.residents).expect("scenario config is in range");
        let world = match self.params {
            ParamsChoice::Stress => World::new_with_params(self.seed, config, Params::stress()),
            ParamsChoice::Default => World::new(self.seed, config),
        }
        .expect("opening world");
        let mut inputs = InputStream::new();
        for &(tick, payload) in &self.inputs {
            inputs
                .submit(Tick(0), tick, payload)
                .expect("input tick is in the future");
        }
        (world, inputs)
    }
}

/// One input's raw rolled parts, turned into a payload by [`build_input`].
fn arb_input(residents: u16) -> impl Strategy<Value = (Tick, InputPayload)> {
    (
        0u64..TICKS,
        0u8..12,
        0u64..64,
        0u64..64,
        0usize..6,
        any::<u8>(),
    )
        .prop_map(move |(tick, bucket, actor, target, kind, intensity)| {
            build_input(residents, tick, bucket, actor, target, kind, intensity)
        })
}

/// The `sim-cli` `inputs.rs` mix over 12 buckets: `0..=7` and `11` are valid-looking,
/// `8` names an unknown person, `9` targets the actor, `10` has an intensity outside
/// `1..=100`.
fn build_input(
    residents: u16,
    tick: u64,
    bucket: u8,
    actor_slot: u64,
    target_slot: u64,
    kind: usize,
    intensity_raw: u8,
) -> (Tick, InputPayload) {
    let n = u64::from(residents);
    let actor = 1 + actor_slot % n;
    let target = 1 + target_slot % n;
    let valid_intensity = 1 + intensity_raw % 100;
    let (actor, target, intensity) = match bucket {
        0..=7 | 11 => (actor, target, valid_intensity),
        8 => (n + 1000 + actor_slot % 1000, target, valid_intensity),
        9 => (actor, actor, valid_intensity),
        _ => (
            actor,
            target,
            if intensity_raw.is_multiple_of(2) {
                0
            } else {
                101 + intensity_raw % 155
            },
        ),
    };
    (
        Tick(tick),
        InputPayload::Act {
            kind: KINDS[kind % KINDS.len()],
            actor: PersonId(actor),
            target: PersonId(target),
            intensity,
        },
    )
}

/// The Params choice: stress three times in four.
pub fn arb_params() -> impl Strategy<Value = ParamsChoice> {
    prop_oneof![
        3 => Just(ParamsChoice::Stress),
        1 => Just(ParamsChoice::Default),
    ]
}

/// A scenario without inputs (Properties 9, 10 and 16 build their own payload).
pub fn arb_run() -> impl Strategy<Value = Scenario> {
    (any::<u64>(), 40u16..=60, arb_params()).prop_map(|(seed, residents, params)| Scenario {
        seed,
        residents,
        params,
        inputs: Vec::new(),
    })
}

/// A full generated run: seed, N, Params and 0 to 24 mixed Act inputs.
pub fn arb_scenario() -> impl Strategy<Value = Scenario> {
    arb_run().prop_flat_map(|scenario| {
        let residents = scenario.residents;
        prop::collection::vec(arb_input(residents), 0..=24).prop_map(move |inputs| Scenario {
            inputs,
            ..scenario.clone()
        })
    })
}

/// Steps `world` once, applying the inputs for its tick, and returns the World before
/// and after the step.
pub fn step_world(world: &mut World, inputs: &InputStream) -> (World, World) {
    let before = world.clone();
    let tick = world.tick();
    world.step(inputs.for_tick(tick));
    (before, world.clone())
}

/// Steps `sim` once and returns the World before and after the step.
pub fn step_sim(sim: &mut Sim) -> (World, World) {
    let before = sim.world().clone();
    sim.step();
    (before, sim.world().clone())
}

/// Every Resident, in Person ID order.
pub fn residents(world: &World) -> Vec<PersonId> {
    world
        .persons()
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .map(|person| person.id)
        .collect()
}

/// Every dead Person, in Person ID order.
pub fn dead_persons(world: &World) -> Vec<PersonId> {
    world
        .persons()
        .values()
        .filter(|person| matches!(person.life, Life::Dead { .. }))
        .map(|person| person.id)
        .collect()
}

/// The Persons present in `after` but not in `before`, in Person ID order.
pub fn new_persons(before: &World, after: &World) -> Vec<PersonId> {
    after
        .persons()
        .keys()
        .filter(|id| !before.persons().contains_key(id))
        .copied()
        .collect()
}

/// Every waiting Soul and the tick its wait began, in Soul ID order.
pub fn waiting_souls(world: &World) -> BTreeMap<SoulId, Tick> {
    world
        .souls()
        .places
        .iter()
        .filter_map(|(&soul, place)| match place {
            SoulPlace::Waiting { since } => Some((soul, *since)),
            SoulPlace::Body(_) => None,
        })
        .collect()
}

/// The resident's balance (0 for a dead Person).
pub fn balance(world: &World, person: PersonId) -> u64 {
    match world.persons().get(&person).map(|p| &p.life) {
        Some(Life::Alive { money, .. }) => *money,
        _ => 0,
    }
}

/// Total money in the World (R3.5).
pub fn total_money(world: &World) -> u128 {
    world
        .persons()
        .values()
        .filter_map(|person| match person.life {
            Life::Alive { money, .. } => Some(u128::from(money)),
            Life::Dead { .. } => None,
        })
        .sum()
}

/// The Events appended since `start`, in ID order.
pub fn events_since(world: &World, start: usize) -> &[Event] {
    world.log().events().get(start..).unwrap_or(&[])
}

/// Asserts that every field both Worlds share is equal, except `rejections`
/// (Property 10: an invalid input changes only the rejection record).
pub fn assert_same_except_rejections(a: &World, b: &World) {
    assert_eq!(a.seed(), b.seed());
    assert_eq!(a.config(), b.config());
    assert_eq!(a.params(), b.params());
    assert_eq!(a.tick(), b.tick());
    assert_eq!(a.persons(), b.persons(), "persons differ");
    assert_eq!(a.households(), b.households(), "households differ");
    assert_eq!(a.properties(), b.properties(), "properties differ");
    assert_eq!(a.relations(), b.relations(), "relations differ");
    assert_eq!(a.debts(), b.debts(), "debts differ");
    assert_eq!(a.souls(), b.souls(), "souls differ");
    assert_eq!(a.log().events(), b.log().events(), "event logs differ");
    assert_eq!(a.log().digest(), b.log().digest(), "log digests differ");
    assert_eq!(a.last_flows(), b.last_flows(), "flows differ");
}

/// The six core invariants of R19.1 that need only the current World: soul
/// conservation (9.3), one soul one place (9.1, 9.2), one Household per Resident
/// (3.1) and acyclic kinship (4.4).
fn check_core_world(world: &World, context: &str) {
    check_souls(world, context);
    check_households(world, context);
    check_kinship_acyclic(world, context);
}

fn check_souls(world: &World, context: &str) {
    let souls = world.souls();
    let mut bodies: BTreeSet<PersonId> = BTreeSet::new();
    let mut waiting = 0u64;
    for (&soul, place) in &souls.places {
        match *place {
            SoulPlace::Body(person) => {
                let Some(entry) = world.persons().get(&person) else {
                    panic!("{context}: soul {} is in unknown body {}", soul.0, person.0);
                };
                assert!(
                    matches!(entry.life, Life::Alive { .. }),
                    "{context}: soul {} is in the dead body {}",
                    soul.0,
                    person.0
                );
                assert_eq!(
                    entry.soul, soul,
                    "{context}: body {} carries soul {} but its place says {}",
                    person.0, entry.soul.0, soul.0
                );
                assert!(
                    bodies.insert(person),
                    "{context}: person {} is in two bodies",
                    person.0
                );
            }
            SoulPlace::Waiting { .. } => waiting = waiting.saturating_add(1),
        }
    }
    let alive = residents(world);
    assert_eq!(
        bodies.len(),
        alive.len(),
        "{context}: {} residents but {} bodies (9.3)",
        alive.len(),
        bodies.len()
    );
    for id in &alive {
        let person = world
            .persons()
            .get(id)
            .unwrap_or_else(|| panic!("{context}: resident {} vanished", id.0));
        assert_eq!(
            souls.places.get(&person.soul),
            Some(&SoulPlace::Body(*id)),
            "{context}: resident {} does not own soul {}'s place (9.2)",
            id.0,
            person.soul.0
        );
    }
    let alive_count = u64::try_from(alive.len()).unwrap_or(u64::MAX);
    let soul_count = u64::try_from(souls.places.len()).unwrap_or(u64::MAX);
    assert_eq!(
        alive_count.saturating_add(waiting),
        soul_count,
        "{context}: {alive_count} residents + {waiting} waiting souls != {soul_count} souls (9.3)"
    );
    let expected_souls =
        u64::from(world.config().opening_residents).saturating_add(world.params().initial_waiting);
    assert_eq!(
        soul_count, expected_souls,
        "{context}: Total_Souls changed (9.3)"
    );
}

fn check_households(world: &World, context: &str) {
    for (&id, person) in world.persons() {
        if let Life::Alive { household, .. } = person.life {
            assert!(
                world.households().contains_key(&household),
                "{context}: resident {} names missing household {} (3.1)",
                id.0,
                household.0
            );
        }
    }
    for &id in world.households().keys() {
        assert!(
            !world.household_members(id).is_empty(),
            "{context}: household {} has no member (3.6)",
            id.0
        );
    }
}

fn check_kinship_acyclic(world: &World, context: &str) {
    let mut parents: BTreeMap<PersonId, Vec<PersonId>> = BTreeMap::new();
    for (&(from, to), relation) in world.relations() {
        if relation.tags.contains(RelationTag::Parent) {
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
                1 => panic!("{context}: parent cycle through person {} (4.4)", node.0),
                _ => {}
            }
            colour.insert(node, 1);
            stack.push((node, true));
            for &parent in parents.get(&node).map(Vec::as_slice).unwrap_or(&[]) {
                match colour.get(&parent).copied().unwrap_or(0) {
                    1 => panic!("{context}: parent cycle through person {} (4.4)", parent.0),
                    2 => {}
                    _ => stack.push((parent, false)),
                }
            }
        }
    }
}

/// Runs the six core invariants of R19.1 at every tick, independently of
/// [`sim_core::invariants::InvariantChecker`].
///
/// The World-only checks run in [`CoreChecker::new`] and at the end of every tick; the
/// no-actions-by-the-dead check (5.8, 6.4) folds only the new Events, and money
/// conservation (3.5) compares the total before and after the tick with the tick's
/// sources and sinks.
#[derive(Clone, Debug)]
pub struct CoreChecker {
    death_events: BTreeMap<PersonId, EventId>,
    checked_events: usize,
    previous_total_money: u128,
}

impl CoreChecker {
    /// Checks the Opening_World and remembers the state the first tick is compared with.
    pub fn new(world: &World) -> Self {
        check_core_world(world, "opening world");
        let mut checker = Self {
            death_events: BTreeMap::new(),
            checked_events: 0,
            previous_total_money: total_money(world),
        };
        checker.check_event_tail(world);
        checker
    }

    /// Checks the six core invariants at the end of one tick.
    pub fn after_tick(&mut self, before: &World, after: &World) {
        let context = format!("tick {}", before.tick().0);
        check_core_world(after, &context);
        self.check_event_tail(after);
        let flows = after.last_flows();
        let expected = self
            .previous_total_money
            .checked_add(u128::from(flows.sources))
            .and_then(|total| total.checked_sub(u128::from(flows.sinks)));
        let actual = total_money(after);
        assert_eq!(
            Some(actual),
            expected,
            "{context}: money went from {} to {actual} with {} sources and {} sinks (3.5)",
            self.previous_total_money,
            flows.sources,
            flows.sinks
        );
        self.previous_total_money = actual;
    }

    /// R5.8 and R6.4 for the Events appended since the last call: no Event lists an
    /// actor whose `death` Event has a lower ID, unless it is an Afterlife_Event_Type.
    fn check_event_tail(&mut self, world: &World) {
        let events = world.log().events();
        let start = self.checked_events;
        let tail = events.get(start..).unwrap_or(&[]);
        for event in tail {
            if let EventKind::Death { person } = &event.kind {
                self.death_events.insert(*person, event.id);
            }
        }
        for event in tail {
            for actor in event.kind.actors().iter() {
                if let Some(&death) = self.death_events.get(&actor) {
                    assert!(
                        event.kind.is_afterlife() || death.0 >= event.id.0,
                        "event {} ({}) lists actor {} whose death event {} is earlier (5.8, 6.4)",
                        event.id.0,
                        event.kind.card_type(),
                        actor.0,
                        death.0
                    );
                }
            }
        }
        self.checked_events = events.len();
    }
}

/// The structural invariants of Property 2, asserted directly (R2.2, 3.3, 3.6, 4.2,
/// 4.3, 4.5, 4.6, 5.6, 5.7, 6.2, 6.4, 7.3, 8.3, 8.4, 11.3, 13.3, 20.2).
pub fn check_structure(world: &World) {
    let context = format!("tick {}", world.tick().0.saturating_sub(1));
    let mut members: BTreeMap<sim_core::ids::HouseholdId, u64> = BTreeMap::new();
    let mut names: BTreeSet<sim_core::names::FullName> = BTreeSet::new();
    for (&id, person) in world.persons() {
        if let Life::Alive { household, .. } = person.life {
            assert!(
                world.households().contains_key(&household),
                "{context}: resident {} names missing household {} (3.1)",
                id.0,
                household.0
            );
            let count = members.entry(household).or_insert(0);
            *count = count.saturating_add(1);
            assert!(
                names.insert(person.name),
                "{context}: resident {} shares a full name (13.3)",
                id.0
            );
            let age = world.age_years(person);
            assert!(
                age <= 120,
                "{context}: resident {} is {age} years old (6.2)",
                id.0
            );
        }
        for (name, value) in [
            ("greed", person.traits.greed),
            ("loyalty", person.traits.loyalty),
            ("pride", person.traits.pride),
            ("warmth", person.traits.warmth),
            ("temper", person.traits.temper),
            ("vindictiveness", person.traits.vindictiveness),
            ("piety", person.traits.piety),
        ] {
            assert!(
                (-3..=3).contains(&value.get()),
                "{context}: person {} has {name} {} (2.2)",
                id.0,
                value.get()
            );
        }
    }
    for &id in world.households().keys() {
        assert!(
            members.get(&id).copied().unwrap_or(0) > 0,
            "{context}: household {} has no member (3.6)",
            id.0
        );
    }
    for (&id, property) in world.properties() {
        match world.persons().get(&property.owner).map(|p| &p.life) {
            Some(Life::Alive { .. }) => {}
            _ => panic!(
                "{context}: property {} is owned by non-resident {} (3.3)",
                id.0, property.owner.0
            ),
        }
    }

    let mut parent_count: BTreeMap<PersonId, u64> = BTreeMap::new();
    let mut living_spouse_count: BTreeMap<PersonId, u64> = BTreeMap::new();
    for (&(from, to), relation) in world.relations() {
        assert!(
            from != to,
            "{context}: relation from {} to itself (4.2)",
            from.0
        );
        assert!(
            (SCORE_MIN..=SCORE_MAX).contains(&relation.affinity.get())
                && (SCORE_MIN..=SCORE_MAX).contains(&relation.trust.get()),
            "{context}: relation {} -> {} has an out-of-range score",
            from.0,
            to.0
        );
        let from_dead = world
            .persons()
            .get(&from)
            .is_some_and(|p| matches!(p.life, Life::Dead { .. }));
        if from_dead {
            assert!(
                relation.tags.has_kinship(),
                "{context}: dead person {} has a non-kin relation to {} (6.4)",
                from.0,
                to.0
            );
        }
        if relation.tags.contains(RelationTag::Parent) {
            let count = parent_count.entry(from).or_insert(0);
            *count = count.saturating_add(1);
            assert!(
                *count <= 2,
                "{context}: person {} has more than two parent relations (4.5)",
                from.0
            );
            require_tag(world, &context, to, from, RelationTag::Child, "4.3");
        }
        if relation.tags.contains(RelationTag::Child) {
            require_tag(world, &context, to, from, RelationTag::Parent, "4.3");
        }
        if relation.tags.contains(RelationTag::Sibling) {
            require_tag(world, &context, to, from, RelationTag::Sibling, "4.3");
        }
        if relation.tags.contains(RelationTag::Spouse) {
            require_tag(world, &context, to, from, RelationTag::Spouse, "4.3");
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
                assert!(
                    *count <= 1,
                    "{context}: resident {} has more than one living spouse (4.6)",
                    from.0
                );
            }
        }
    }

    let mut death_event: BTreeMap<PersonId, EventId> = BTreeMap::new();
    let mut outsider_event: BTreeMap<PersonId, EventId> = BTreeMap::new();
    for event in world.log().events() {
        match &event.kind {
            EventKind::Death { person } => {
                death_event.insert(*person, event.id);
            }
            EventKind::Possession { person, .. } | EventKind::Rebuild { person, .. } => {
                outsider_event.entry(*person).or_insert(event.id);
            }
            _ => {}
        }
    }
    for event in world.log().events() {
        for cause in event.caused_by.iter() {
            match world.log().event(cause) {
                Some(cited) if cited.id.0 < event.id.0 && cited.tick <= event.tick => {}
                _ => panic!(
                    "{context}: event {} cites invalid cause {} (5.6)",
                    event.id.0, cause.0
                ),
            }
        }
        for (position, actor) in event.kind.actors().iter().enumerate() {
            let known_resident = world.persons().contains_key(&actor);
            let official_recipient = actor == world.magistrate().id
                && position == 1
                && matches!(
                    &event.kind,
                    EventKind::Appeal { .. } | EventKind::BribeOffering { .. }
                );
            assert!(
                known_resident || official_recipient,
                "{context}: event {} names unknown actor {} (5.7)",
                event.id.0,
                actor.0
            );
        }
        if let EventKind::Inheritance { deceased, heir, .. } = &event.kind
            && let (Some(death), Some(outsider)) =
                (death_event.get(deceased), outsider_event.get(heir))
        {
            assert!(
                death.0 >= outsider.0,
                "{context}: event {} names outsider {} as heir of an earlier death (7.3)",
                event.id.0,
                heir.0
            );
        }
    }

    for (&loan, debt) in world.debts() {
        assert!(
            debt.creditor != debt.debtor,
            "{context}: debt {loan:?} is owed to oneself (8.1)"
        );
        assert!(
            debt.open >= 1 && debt.open <= debt.principal,
            "{context}: debt {loan:?} has open {} of principal {} (8.3)",
            debt.open,
            debt.principal
        );
    }

    let completed = world.tick().0.saturating_sub(1);
    let max_wait = world.params().max_wait;
    let player = world.souls().player;
    for (&soul, place) in &world.souls().places {
        if soul == player {
            continue;
        }
        if let SoulPlace::Waiting { since } = place {
            let waited = completed.saturating_sub(since.0);
            assert!(
                waited <= max_wait,
                "{context}: soul {} has waited {waited} days (11.3, 20.2)",
                soul.0
            );
        }
    }
}

fn require_tag(
    world: &World,
    context: &str,
    from: PersonId,
    to: PersonId,
    tag: RelationTag,
    criterion: &str,
) {
    let reverse = world.relations().get(&(from, to));
    assert!(
        reverse.is_some_and(|relation| relation.tags.contains(tag)),
        "{context}: relation {} -> {} lacks `{}` ({criterion})",
        from.0,
        to.0,
        tag.name()
    );
}

/// A trait value inside the card range (used by the opening check).
pub fn trait_in_range(value: Trait) -> bool {
    (-3..=3).contains(&value.get())
}

/// The tag names of `tags` in card order, for messages.
pub fn tag_names(tags: sim_core::events::EventTags) -> Vec<&'static str> {
    tags.names().collect()
}

/// The event tag list in card order (kept here so tests can assert tag order).
pub const EVENT_TAGS_IN_CARD_ORDER: [EventTag; 13] = EventTag::ALL;

/// A checksum for a World (convenience for Property 16).
pub fn checksum(world: &World) -> Checksum {
    Checksum::of(world)
}
