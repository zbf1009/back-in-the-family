//! Property tests for the real Auto_Player/batch path on 400-tick stress worlds.

use std::collections::BTreeMap;

use proptest::prelude::*;
use sim_cli::auto_player::{Strategy, strategy_for_wait};
use sim_cli::batch::{report_devoted_sim, report_sim};
use sim_core::events::EventKind;
use sim_core::ids::Tick;
use sim_core::input::{InputPayload, TickInput};
use sim_core::params::Params;
use sim_core::rng::{StreamTag, draw};
use sim_core::tick::Sim;
use sim_core::underworld::nodes::{ChoiceSource, NodeFamily};
use sim_core::underworld::slots::SlotRef;
use sim_core::world::{Life, SoulPlace, World, WorldConfig};

const TICKS: u64 = 400;

fn stress(seed: u64) -> Sim {
    Sim::new_with_params(
        seed,
        WorldConfig::try_new(50).unwrap(),
        Params::stress_underworld(),
    )
    .unwrap()
}

#[derive(Default, Debug, PartialEq, Eq)]
struct Facts {
    offerings: u64,
    dreams: u64,
    hauntings: u64,
    bribes: u64,
    claims: [u64; 3],
    auto_placed: u64,
    carry_overs: u64,
    nodes: [[u64; 2]; 2],
    max_wait: u64,
    positive_price_arrivals: u64,
    waits: BTreeMap<u64, WaitFacts>,
    input_stream: Vec<TickInput>,
    lives: String,
}

#[derive(Default, Debug, PartialEq, Eq)]
struct WaitFacts {
    first_tick: Option<u64>,
    carry_ticks: Vec<u64>,
    dream_possible: bool,
    bribe_possible: bool,
    dreams: u64,
    bribes: u64,
}

fn lives_from_events(world: &World) -> String {
    let player = world.souls().player;
    let events = world.log().events();
    let bodies: Vec<_> = world
        .persons()
        .values()
        .filter(|p| p.soul == player)
        .collect();
    bodies
        .iter()
        .enumerate()
        .map(|(i, p)| match p.life {
            Life::Alive { .. } => format!("{}:alive", i + 1),
            Life::Dead { death } => {
                let death_event = events
                    .iter()
                    .find(|e| matches!(e.kind, EventKind::Death { person } if person == p.id))
                    .unwrap();
                let next = bodies.get(i + 1).and_then(|next| {
                    events.iter().find(|e| match e.kind {
                        EventKind::Birth { person }
                        | EventKind::Possession { person, .. }
                        | EventKind::Rebuild { person, .. } => person == next.id,
                        _ => false,
                    })
                });
                let credited: u64 = events
                    .iter()
                    .filter(|e| e.id >= death_event.id && next.is_none_or(|n| e.id < n.id))
                    .filter_map(|e| match e.kind {
                        EventKind::Offering {
                            ghost, credited, ..
                        } if world.persons()[&ghost].soul == player => Some(credited),
                        _ => None,
                    })
                    .sum();
                format!(
                    "{}:death={},age_days={},joss={credited}",
                    i + 1,
                    death.0,
                    i128::from(death.0) - i128::from(p.birth_day)
                )
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn field<'a>(line: &'a str, name: &str) -> &'a str {
    line.split_whitespace()
        .find_map(|part| part.strip_prefix(name))
        .unwrap_or_else(|| panic!("missing {name}: {line}"))
}
fn number(line: &str, name: &str) -> u64 {
    field(line, name).parse().unwrap()
}

fn inspect(seed: u64, ticks: u64, sim: Sim) -> (String, Facts) {
    let mut facts = Facts::default();
    let mut previous_events = 0;
    let mut previous_nodes = 0;
    let mut before_wait = None;
    let line = report_sim(sim, ticks, |sim, completed| {
        let world = sim.world();
        let player = world.souls().player;
        if !completed {
            before_wait = match world.souls().places[&player] {
                SoulPlace::Waiting { since } => Some(since.0),
                SoulPlace::Body(_) => None,
            };
            if let Some(since) = before_wait {
                let wait = facts.waits.entry(since).or_default();
                wait.first_tick.get_or_insert(world.tick().0);
                let connected = world.player_wait().is_some_and(|w| {
                    world.persons().values().any(|p| {
                        matches!(p.life, Life::Alive { .. })
                            && world.relations().contains_key(&(p.id, w.ghost))
                    })
                });
                let balance = world.joss()[&player].balance;
                wait.dream_possible |= balance >= world.params().dream_price && connected;
                wait.bribe_possible |=
                    balance > world.params().dream_price || balance >= 1 && !connected;
            }
            return;
        }
        let tick = Tick(world.tick().0 - 1);
        if let Some(since) = before_wait {
            facts.max_wait = facts.max_wait.max(tick.0.saturating_sub(since));
        }
        if let SoulPlace::Waiting { since } = world.souls().places[&player] {
            facts.max_wait = facts.max_wait.max(tick.0.saturating_sub(since.0));
        }
        let inputs = sim.inputs().for_tick(tick);
        assert_eq!(
            inputs.len(),
            sim.last_outcomes().len(),
            "seed={seed} tick={tick:?}"
        );
        for (position, input) in inputs.iter().enumerate() {
            if matches!(input.payload, InputPayload::ClaimSlot { .. }) {
                assert_eq!(
                    position + 1,
                    inputs.len(),
                    "claim must be last: seed={seed} tick={tick:?}"
                );
            }
            if let InputPayload::Choose { node, .. } = input.payload {
                let trigger = inputs[..position]
                    .iter()
                    .find(|candidate| candidate.seq == node.trigger())
                    .expect("Choice needs earlier trigger");
                match trigger.payload {
                    InputPayload::Dream { .. } => assert_eq!(
                        draw(seed, player.rng_key(), StreamTag::AutoPlayer, tick, 3) & 1,
                        1
                    ),
                    InputPayload::Bribe { .. } => assert_eq!(
                        draw(seed, player.rng_key(), StreamTag::AutoPlayer, tick, 5) & 1,
                        1
                    ),
                    _ => panic!("Choice needs Dream or Bribe trigger"),
                }
            }
        }
        for (input, outcome) in inputs.iter().zip(sim.last_outcomes()) {
            assert_eq!(input.seq, outcome.seq);
            facts.input_stream.push(*input);
            if outcome.result.is_err() {
                continue;
            }
            if let Some(since) = before_wait {
                let wait = facts.waits.get_mut(&since).unwrap();
                match input.payload {
                    InputPayload::Dream { .. } => wait.dreams += 1,
                    InputPayload::Bribe { .. } => wait.bribes += 1,
                    InputPayload::CarryOver { .. } => wait.carry_ticks.push(tick.0),
                    _ => {}
                }
            }
            match input.payload {
                InputPayload::ClaimSlot {
                    slot: SlotRef::Birth(_),
                    ..
                } => facts.claims[0] += 1,
                InputPayload::ClaimSlot {
                    slot: SlotRef::ImportedVessel,
                    ..
                } => facts.claims[1] += 1,
                InputPayload::ClaimSlot {
                    slot: SlotRef::RebuiltBody,
                    ..
                } => facts.claims[2] += 1,
                InputPayload::CarryOver { .. } => facts.carry_overs += 1,
                _ => {}
            }
        }
        for e in &world.log().events()[previous_events..] {
            match e.kind {
                EventKind::Offering { .. } | EventKind::BribeOffering { .. } => {
                    facts.offerings += 1
                }
                EventKind::Dream { .. } => facts.dreams += 1,
                EventKind::Haunting { .. } => facts.hauntings += 1,
                EventKind::Appeal { .. } => facts.bribes += 1,
                EventKind::Possession { person, price: 0 }
                    if world.persons()[&person].soul == player =>
                {
                    facts.auto_placed += 1
                }
                EventKind::Possession { person, price } | EventKind::Rebuild { person, price }
                    if price > 0 && world.persons()[&person].soul == player =>
                {
                    facts.positive_price_arrivals += 1
                }
                _ => {}
            }
        }
        previous_events = world.log().len();
        for node in &world.nodes().resolved[previous_nodes..] {
            let family = match node.family {
                NodeFamily::DreamInterpretation => 0,
                NodeFamily::MagistrateRuling => 1,
            };
            let source = match node.source {
                ChoiceSource::External => 0,
                ChoiceSource::RulesDefault => 1,
            };
            facts.nodes[family][source] += 1;
        }
        previous_nodes = world.nodes().resolved.len();
        if tick.0 + 1 == ticks {
            facts.lives = lives_from_events(world);
        }
    })
    .unwrap();
    (line, facts)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: underworld, Property 20: The Auto_Player is reproducible and meets R11.10 exactly.
    #[test]
    fn property_20_reproducible_and_guaranteed_dream_bribe(seed in any::<u64>()) {
        let (a, facts) = inspect(seed, TICKS, stress(seed));
        let (b, again) = inspect(seed, TICKS, stress(seed));
        prop_assert_eq!(a, b);
        prop_assert!(facts.input_stream.iter().all(|input| input.tick.0 < TICKS));
        prop_assert_eq!(&facts.input_stream, &again.input_stream);
        prop_assert_eq!(&facts, &again);
        for (since, wait) in &facts.waits {
            prop_assert!(!wait.dream_possible || wait.dreams >= 1, "seed={seed} since={since} {wait:?}");
            prop_assert!(!wait.bribe_possible || wait.bribes >= 1, "seed={seed} since={since} {wait:?}");
        }
    }

    // Feature: underworld, Property 21: The strategy rotation covers every slot kind and every wait applies one Carry_Over.
    #[test]
    fn property_21_strategy_rotation(seed in any::<u64>(), k in 0u64..=u64::MAX - 2) {
        let trio = [strategy_for_wait(seed, k), strategy_for_wait(seed, k + 1), strategy_for_wait(seed, k + 2)];
        prop_assert!(trio.contains(&Strategy::Birth));
        prop_assert!(trio.contains(&Strategy::ImportedVessel));
        prop_assert!(trio.contains(&Strategy::RebuiltBody));
    }

    // Feature: underworld, Property 21: Every wait applies one Carry_Over on its first waiting tick.
    #[test]
    fn property_21_carry_over_per_wait(seed in any::<u64>()) {
        let (_, facts) = inspect(seed, TICKS, stress(seed));
        for (since, wait) in &facts.waits {
            prop_assert_eq!(&wait.carry_ticks, &vec![wait.first_tick.unwrap()], "seed={} since={}", seed, since);
        }
    }
    // Feature: underworld, Property 22: The batch report counts equal the recorded facts.
    #[test]
    fn property_22_report_matches_events_outcomes_and_lives(seed in any::<u64>()) {
        let (line, facts) = inspect(seed, TICKS, stress(seed));
        prop_assert_eq!(number(&line, "offerings="), facts.offerings);
        prop_assert_eq!(number(&line, "dreams="), facts.dreams);
        prop_assert_eq!(number(&line, "hauntings="), facts.hauntings);
        prop_assert_eq!(number(&line, "bribes="), facts.bribes);
        prop_assert_eq!(field(&line, "claims="), format!("birth:{},imported:{},rebuilt:{}", facts.claims[0], facts.claims[1], facts.claims[2]));
        prop_assert_eq!(facts.claims[1] + facts.claims[2], facts.positive_price_arrivals, "seed={}: paid Standing claims must match Player arrivals", seed);
        prop_assert_eq!(number(&line, "auto_placed="), facts.auto_placed);
        prop_assert_eq!(number(&line, "carry_overs="), facts.carry_overs);
        prop_assert_eq!(field(&line, "nodes="), format!("dream_interpretation:external:{},rules:{};magistrate_ruling:external:{},rules:{}", facts.nodes[0][0], facts.nodes[0][1], facts.nodes[1][0], facts.nodes[1][1]));
        prop_assert_eq!(number(&line, "max_wait_player="), facts.max_wait);
        prop_assert_eq!(field(&line, "player_lives="), facts.lives);
    }
}

// Feature: underworld, Property 22: The batch report counts equal the recorded facts.
proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    #[test]
    fn property_22_devoted_wait_report_matches_recorded_facts(seed in any::<u64>()) {
        let mut credited = 0u64;
        let mut current_ghost = None;
        let mut acts_in_life = 0u64;
        let mut wait_acts = 0u64;
        let mut candidates = [false; 5];
        let mut waits = Vec::new();
        let mut before_events = 0usize;
        let mut submitted = 0u64;
        let mut applied = 0u64;
        let mut rejected = 0u64;
        let mut tick_inputs = 0usize;
        let mut previous_body = None;
        let a = report_devoted_sim(stress(seed), TICKS, |sim, completed| {
            let world = sim.world();
            let soul = world.souls().player;
            if !completed {
                if let SoulPlace::Body(body) = world.souls().places[&soul] {
                    if previous_body != Some(body) { acts_in_life = 0; previous_body = Some(body); }
                } else {
                    previous_body = None;
                }
                tick_inputs = sim.inputs().for_tick(world.tick()).len();
                if let SoulPlace::Waiting { .. } = world.souls().places[&soul] {
                    let ghost = current_ghost.expect("waiting ghost");
                    let a = &world.joss()[&soul];
                    let p = world.params();
                    let connected = world.relations().keys().any(|&(from,to)| to == ghost
                        && matches!(world.persons()[&from].life, Life::Alive { .. }));
                    let capped = a.capped_spent_in(world.tick());
                    for (target, possible) in candidates.iter_mut().zip([
                        a.balance >= p.dream_price && connected,
                        a.balance >= p.haunt_price && connected && capped.saturating_add(p.haunt_price) <= p.yearly_cap,
                        a.balance >= 1,
                        a.balance >= p.imported_price,
                        a.balance >= p.rebuilt_price && capped.saturating_add(p.rebuilt_price) <= p.yearly_cap,
                    ]) { *target |= possible; }
                }
                return;
            }
            let tick = Tick(world.tick().0 - 1);
            let inputs = sim.inputs().for_tick(tick);
            for (input, outcome) in inputs.iter().zip(sim.last_outcomes()).skip(tick_inputs) {
                if let InputPayload::Act { actor, .. } = input.payload
                    && previous_body == Some(actor)
                {
                    submitted += 1;
                    if outcome.result.is_ok() { applied += 1; acts_in_life += 1; }
                    else { rejected += 1; }
                }
            }
            for event in &world.log().events()[before_events..] {
                match event.kind {
                    EventKind::Death { person } if world.persons()[&person].soul == soul => {
                        if current_ghost.take().is_some() { waits.push((credited,wait_acts,candidates)); }
                        current_ghost = Some(person);
                        credited = 0; candidates = [false; 5]; wait_acts = acts_in_life;
                    }
                    EventKind::Offering { ghost, credited: amount, .. } if Some(ghost) == current_ghost => credited += amount,
                    EventKind::Birth { person } | EventKind::Possession { person, .. } | EventKind::Rebuild { person, .. }
                        if world.persons()[&person].soul == soul && current_ghost.take().is_some() => {
                        waits.push((credited,wait_acts,candidates)); credited = 0; candidates = [false; 5];
                    }
                    _ => {}
                }
            }
            before_events = world.log().len();
        }).unwrap();
        if current_ghost.is_some() { waits.push((credited,wait_acts,candidates)); }
        let mut expected = format!("seed {seed} devoted waits=");
        for (index, (credit, acts, possible)) in waits.iter().enumerate() {
            if index > 0 { expected.push(';'); }
            expected.push_str(&format!("{}:joss={credit},zero={},acts={acts},afford_candidates=", index + 1, u8::from(*credit == 0)));
            let names: Vec<_> = ["dream","haunting","bribe","imported","rebuilt"].into_iter().zip(possible)
                .filter_map(|(name,&yes)| yes.then_some(name)).collect();
            if names.is_empty() { expected.push('-'); } else { expected.push_str(&names.join(",")); }
        }
        let zero = waits.iter().filter(|(credit,_,_)| *credit == 0).count();
        expected.push_str(&format!(" zero_credit_waits={zero}/{} acts=submitted:{submitted},applied:{applied},rejected:{rejected}", waits.len()));
        prop_assert_eq!(&a, &expected);
        let b = report_devoted_sim(stress(seed), TICKS, |_, _| {}).unwrap();
        prop_assert_eq!(a, b);
    }
}

#[test]
fn rotation_covers_every_kind_on_acceptance_seeds() {
    let first: Vec<_> = (1..=5).map(|seed| strategy_for_wait(seed, 0)).collect();
    assert_eq!(
        first,
        [
            Strategy::Birth,
            Strategy::RebuiltBody,
            Strategy::ImportedVessel,
            Strategy::Birth,
            Strategy::RebuiltBody
        ]
    );
}

#[test]
fn property_20_default_acceptance_seed_examples() {
    for seed in [1, 3, 5] {
        let sim = Sim::new(seed, WorldConfig::try_new(50).unwrap()).unwrap();
        let (line, facts) = inspect(seed, 29_200, sim);
        assert_eq!(field(&line, "player_lives="), facts.lives);
        for (since, wait) in &facts.waits {
            assert!(
                !wait.dream_possible || wait.dreams > 0,
                "seed={seed} since={since}"
            );
            assert!(
                !wait.bribe_possible || wait.bribes > 0,
                "seed={seed} since={since}"
            );
        }
    }
}
