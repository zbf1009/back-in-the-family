//! The underworld properties of design "Correctness Properties" and the smoke test of
//! the generated underworld run.
//!
//! Every property drives the shared generator in `underworld_gen`, which plans a
//! state-aware mix of valid and invalid inputs for 400 ticks and runs the extended
//! `InvariantChecker` after every tick. The assertions here are written from the
//! World's own accessors and the Event_Log, independently of the checker.

mod life_gen;
mod underworld_gen;

use std::collections::BTreeMap;

use proptest::prelude::*;

use sim_core::events::EventKind;
use sim_core::ids::{InputSeq, SoulId};
use sim_core::input::InputPayload;
use sim_core::underworld::joss::cap_year;
use sim_core::underworld::slots::SlotRef;
use sim_core::world::{Life, SoulPlace, World, WorldConfig};
use underworld_gen::{Run, TICKS, driven, events_since};

/// The joss paper one Event moves and whether it is a capped spend (R1.2, R2.6).
/// Each Event kind carries at most one credit or spend field, so this returns one
/// entry at most.
fn ledger_event(world: &World, kind: &EventKind) -> Option<(SoulId, i128, bool)> {
    let soul_of = |person: sim_core::ids::PersonId| world.persons().get(&person).map(|p| p.soul);
    match kind {
        EventKind::Offering {
            ghost, credited, ..
        } => Some((soul_of(*ghost)?, i128::from(*credited), false)),
        EventKind::BribeOffering { ghost, amount, .. } => {
            Some((soul_of(*ghost)?, -i128::from(*amount), false))
        }
        EventKind::Dream { ghost, price, .. } => {
            Some((soul_of(*ghost)?, -i128::from(*price), false))
        }
        EventKind::Haunting { ghost, price, .. } => {
            Some((soul_of(*ghost)?, -i128::from(*price), true))
        }
        EventKind::Possession { person, price } => {
            Some((soul_of(*person)?, -i128::from(*price), false))
        }
        EventKind::Rebuild { person, price } => {
            Some((soul_of(*person)?, -i128::from(*price), true))
        }
        _ => None,
    }
}

fn balances(world: &World) -> BTreeMap<SoulId, u64> {
    world
        .joss()
        .iter()
        .map(|(&soul, account)| (soul, account.balance))
        .collect()
}

/// The bodies that a birth, possession or rebuild Event gave a Soul in this tick.
fn arrivals(world: &World, start: usize) -> Vec<sim_core::ids::PersonId> {
    events_since(world, start)
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::Birth { person }
            | EventKind::Possession { person, .. }
            | EventKind::Rebuild { person, .. } => Some(*person),
            _ => None,
        })
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    // Feature: underworld, Property 1: The log is the joss ledger.
    #[test]
    fn property_1_the_log_is_the_joss_ledger(scenario in underworld_gen::arb_scenario()) {
        let mut run = Run::new(scenario);
        let player = run.world().souls().player;
        let mut expected: BTreeMap<SoulId, i128> = BTreeMap::new();
        let mut previous = balances(run.world());
        prop_assert_eq!(run.world().joss().len(), run.world().souls().places.len());

        for _step in 0..TICKS {
            let start = run.world().log().len();
            let (_before, after, _planned) = run.step();
            // R1.1: exactly one Joss_Balance per Soul.
            prop_assert_eq!(
                after.joss().len(),
                after.souls().places.len(),
                "tick {}",
                after.tick().0
            );
            let arrivals = arrivals(&after, start);
            for event in events_since(&after, start) {
                if let Some((soul, delta, _capped)) = ledger_event(&after, &event.kind) {
                    let entry = expected.entry(soul).or_insert(0);
                    *entry = entry.saturating_add(delta);
                }
                // R1.4: an Offering with a credit names a Ghost whose Soul was waiting
                // at the append; a Soul reborn later in the same tick is still a Ghost.
                if let EventKind::Offering { ghost, credited, .. } = &event.kind
                    && *credited > 0
                {
                    let person = after
                        .persons()
                        .get(ghost)
                        .expect("an Offering names a known Ghost");
                    prop_assert!(
                        matches!(person.life, Life::Dead { .. }),
                        "tick {}: offering {} credits the living person {}",
                        after.tick().0,
                        event.id.0,
                        ghost.0
                    );
                    if let Some(SoulPlace::Body(body)) = after.souls().places.get(&person.soul) {
                        prop_assert!(
                            arrivals.contains(body),
                            "tick {}: offering {} credits soul {} in body {}",
                            after.tick().0,
                            event.id.0,
                            person.soul.0,
                            body.0
                        );
                    }
                }
            }
            for (&soul, account) in after.joss() {
                prop_assert_eq!(
                    i128::from(account.balance),
                    expected.get(&soul).copied().unwrap_or(0),
                    "tick {}: soul {} balance",
                    after.tick().0,
                    soul.0
                );
                // R10.2: an NPC_Soul's balance never decreases.
                if soul != player {
                    let before = previous.get(&soul).copied().unwrap_or(0);
                    prop_assert!(
                        account.balance >= before,
                        "tick {}: NPC soul {} went from {} to {}",
                        after.tick().0,
                        soul.0,
                        before,
                        account.balance
                    );
                }
            }
            previous = balances(&after);
        }
    }

    // Feature: underworld, Property 2: The Yearly_Cap holds.
    #[test]
    fn property_2_the_yearly_cap_holds(scenario in underworld_gen::arb_scenario()) {
        let mut run = Run::new(scenario);
        let cap = run.world().params().yearly_cap;
        let mut credited: BTreeMap<(SoulId, u64), u64> = BTreeMap::new();
        let mut capped: BTreeMap<(SoulId, u64), u64> = BTreeMap::new();

        for _ in 0..TICKS {
            let start = run.world().log().len();
            let (_before, after, _planned) = run.step();
            for event in events_since(&after, start) {
                let year = cap_year(event.tick);
                let soul = match &event.kind {
                    EventKind::Offering { ghost, .. } => after
                        .persons()
                        .get(ghost)
                        .map(|person| person.soul),
                    EventKind::Haunting { ghost, .. } => after
                        .persons()
                        .get(ghost)
                        .map(|person| person.soul),
                    EventKind::Rebuild { person, .. } => {
                        after.persons().get(person).map(|entry| entry.soul)
                    }
                    _ => None,
                };
                let Some(soul) = soul else {
                    continue;
                };
                match &event.kind {
                    EventKind::Offering { amount, credited: given, .. } => {
                        let prior = credited.get(&(soul, year)).copied().unwrap_or(0);
                        let allowed = (*amount).min(cap.saturating_sub(prior));
                        prop_assert_eq!(
                            *given,
                            allowed,
                            "tick {}: soul {} credited {} of {} after {} in Cap_Year {}",
                            after.tick().0,
                            soul.0,
                            given,
                            amount,
                            prior,
                            year
                        );
                        let total = prior.saturating_add(*given);
                        prop_assert!(
                            total <= cap,
                            "tick {}: soul {} credited {} in Cap_Year {}",
                            after.tick().0,
                            soul.0,
                            total,
                            year
                        );
                        credited.insert((soul, year), total);
                    }
                    EventKind::Haunting { price, .. } | EventKind::Rebuild { price, .. } => {
                        let total = capped
                            .get(&(soul, year))
                            .copied()
                            .unwrap_or(0)
                            .saturating_add(*price);
                        prop_assert!(
                            total <= cap,
                            "tick {}: soul {} capped spends {} in Cap_Year {}",
                            after.tick().0,
                            soul.0,
                            total,
                            year
                        );
                        capped.insert((soul, year), total);
                    }
                    _ => {}
                }
            }
        }
    }
}

/// The smoke test of the generator: over 20 generated runs at least one dream, one
/// haunting, one Bribe, one Birth claim, one Standing claim, one Carry_Over, one
/// External_Choice and one R8.1 placement occurs, so the properties are not vacuous.
///
/// Every fourth run plans no claim, so its Player_Wait reaches the placement bound.
#[test]
fn twenty_generated_runs_exercise_every_mechanic() {
    use sim_core::params::Params;
    use underworld_gen::{AppliedCounts, ParamsChoice, Scenario};

    let mut params = Params::stress_underworld();
    // A short wait bound and a high mortality floor put a Player_Soul in the queue in
    // every run within a few dozen ticks of the start.
    params.mortality_floor_ppm = 20_000;
    params.player_max_wait = 12;

    let mut counts = AppliedCounts::default();
    let mut placements = 0u64;
    for seed in 1..=20u64 {
        let scenario = Scenario::new(seed, 50, ParamsChoice::StressUnderworld);
        let mut run = Run::with_params(scenario, params);
        run.claims = !seed.is_multiple_of(4);
        for _ in 0..TICKS {
            let (before, after, planned) = run.step();
            counts.add(&planned);
            if underworld_gen::forced_placement(&before, &after, &planned) {
                placements = placements.saturating_add(1);
            }
        }
    }

    assert!(counts.dreams > 0, "no dream applied: {counts:?}");
    assert!(counts.hauntings > 0, "no haunting applied: {counts:?}");
    assert!(counts.bribes > 0, "no Bribe applied: {counts:?}");
    assert!(
        counts.birth_claims > 0,
        "no Birth_Slot claim applied: {counts:?}"
    );
    assert!(
        counts.standing_claims > 0,
        "no Standing_Slot claim applied: {counts:?}"
    );
    assert!(counts.carry_overs > 0, "no Carry_Over applied: {counts:?}");
    assert!(counts.choices > 0, "no External_Choice applied: {counts:?}");
    assert!(placements > 0, "no R8.1 placement happened: {counts:?}");
}

/// The offering formula of design "Offerings", written independently of
/// `underworld::offerings::offering_amount`.
fn expected_offering_amount(
    params: &sim_core::params::Params,
    affinity: i8,
    piety: i8,
    money: u64,
    factor: u64,
) -> u64 {
    let affinity = i64::from(affinity);
    if affinity < i64::from(params.offer_min_affinity) {
        return 0;
    }
    let piety = i64::from(piety).saturating_add(3);
    let steps = money
        .checked_div(params.offer_money_step)
        .unwrap_or(u64::MAX)
        .min(params.offer_money_max_steps);
    let steps = i64::try_from(steps).unwrap_or(i64::MAX);
    let factor = i64::try_from(factor).unwrap_or(i64::MAX);
    let product = affinity
        .saturating_mul(piety)
        .saturating_mul(steps.saturating_add(2))
        .saturating_mul(factor);
    u64::try_from(product.checked_div(12).unwrap_or(0).clamp(0, 500)).unwrap_or(0)
}

proptest! {
    // Feature: underworld, Property 3: Offerings follow the occasions and the formula.
    #[test]
    fn property_3_offerings_follow_the_occasions_and_the_formula(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let (_b, after, _planned) = run.step();
            // Inputs and deaths precede step 5; births, economy and decay follow it.
            // Reconstruct the actual stage rather than guessing money or affinity
            // from either tick boundary.
            let stage = before.before_offerings(&run.last_inputs);
            let offered = stage.after_offerings();
            let events = events_since(&offered, stage.log().len());
            let money = |world: &World| -> BTreeMap<_, _> {
                world.persons().iter().filter_map(|(&id, person)| match person.life {
                    Life::Alive { money, .. } => Some((id, money)),
                    Life::Dead { .. } => None,
                }).collect()
            };
            prop_assert_eq!(money(&stage), money(&offered), "tick {}: offerings moved money", tick.0);

            let mut expected = BTreeMap::new();
            for (&ghost, person) in stage.persons() {
                let Life::Dead { death } = person.life else { continue };
                if !matches!(stage.souls().places.get(&person.soul), Some(SoulPlace::Waiting { .. })) {
                    continue;
                }
                let params = stage.params();
                let funeral = (death == tick).then_some(params.funeral_factor);
                let anniversary = (tick > death &&
                    tick.0.saturating_sub(death.0).is_multiple_of(365))
                    .then_some(params.anniversary_factor);
                let halloween = (tick.0 % 365 == params.halloween_day)
                    .then_some(params.halloween_factor);
                let factor = funeral.into_iter().chain(anniversary).chain(halloween)
                    .max().unwrap_or(0);
                if factor == 0 { continue; }
                for (&offerer, resident) in stage.persons() {
                    let Life::Alive { money, .. } = resident.life else { continue };
                    if stage.age_years(resident) < 12 { continue; }
                    let Some(relation) = stage.relations().get(&(offerer, ghost)) else { continue };
                    let amount = expected_offering_amount(
                        stage.params(), relation.affinity.get(), resident.traits.piety.get(), money, factor,
                    );
                    if amount > 0 { expected.insert((offerer, ghost), amount); }
                }
            }
            let mut actual = BTreeMap::new();
            for event in events {
                let EventKind::Offering { offerer, ghost, amount, .. } = event.kind else {
                    prop_assert!(false, "tick {}: non-offering in step 5", tick.0);
                    continue;
                };
                prop_assert!(event.tags.contains(sim_core::events::EventTag::JossPaper));
                prop_assert!(actual.insert((offerer, ghost), amount).is_none(), "tick {}: duplicate offering", tick.0);
            }
            prop_assert_eq!(actual, expected, "tick {}: step-5 offerings", tick.0);
            prop_assert_eq!(
                after.log().events().get(stage.log().len()..offered.log().len()),
                Some(events),
                "tick {}: step-5 event identities or amounts differ", tick.0
            );
        }
    }
}

/// Which node family a payload fires, if any.
fn fired_family(payload: InputPayload) -> Option<sim_core::underworld::nodes::NodeFamily> {
    use sim_core::underworld::nodes::NodeFamily;
    match payload {
        InputPayload::Dream { .. } => Some(NodeFamily::DreamInterpretation),
        InputPayload::Bribe { .. } => Some(NodeFamily::MagistrateRuling),
        _ => None,
    }
}

proptest! {
    // Feature: underworld, Property 4: Every Decision_Node fires, resolves once and is recorded.
    #[test]
    fn property_4_every_node_fires_resolves_once_and_is_recorded(
        scenario in underworld_gen::arb_scenario()
    ) {
        use std::collections::BTreeSet;

        use sim_core::underworld::nodes::{ChoiceSource, NodeFamily, NodeOption};

        let mut run = Run::new(scenario);
        let mut last_id = 0u64;
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let already = before.nodes().resolved.len();
            let (_b, after, planned) = run.step();
            // R3.8: no node survives its tick.
            prop_assert!(
                after.nodes().pending.is_empty(),
                "tick {}: a node is still pending",
                tick.0
            );
            let records = after.nodes().resolved.get(already..).unwrap_or(&[]);
            // R3.1: Node IDs increase, one record per node.
            let mut seen = BTreeSet::new();
            for record in records {
                prop_assert_eq!(record.tick, tick, "a record of another tick");
                prop_assert!(
                    record.id.0 > last_id,
                    "tick {}: node {} after {}",
                    tick.0,
                    record.id.0,
                    last_id
                );
                last_id = record.id.0;
                prop_assert!(seen.insert(record.id), "node {} resolved twice", record.id.0);
                // R3.5: without an External_Choice the Rules_Default is applied.
                if record.source == ChoiceSource::RulesDefault {
                    prop_assert_eq!(record.applied, record.rules_default);
                }
            }

            // R3.4: an applied External_Choice is recorded as the applied option with
            // the External source.
            for entry in &planned {
                let InputPayload::Choose { node, option } = entry.payload else {
                    continue;
                };
                if entry.result.is_err() {
                    continue;
                }
                let trigger = node.trigger();
                let family = planned
                    .iter()
                    .find(|other| other.seq == trigger)
                    .and_then(|other| fired_family(other.payload));
                let Some(family) = family else {
                    continue;
                };
                let record = records
                    .iter()
                    .find(|record| record.family == family)
                    .expect("a chosen node is recorded");
                prop_assert_eq!(record.source, ChoiceSource::External);
                prop_assert_eq!(record.applied, option);
            }

            // R3.2, R3.8, R3.6: every fired node offered 2..=5 distinct options equal to
            // the context's, with a Rules_Default among them, and is recorded once.
            for spec in underworld_gen::previews(&planned) {
                prop_assert!(
                    (2..=5).contains(&spec.options.len()),
                    "tick {}: {} options",
                    tick.0,
                    spec.options.len()
                );
                let distinct: BTreeSet<NodeOption> = spec.options.iter().copied().collect();
                prop_assert_eq!(distinct.len(), spec.options.len());
                prop_assert!(spec.options.contains(&spec.rules_default));
                if let sim_core::llm::TaskSpec::Decision { options } = &spec.context.spec {
                    prop_assert_eq!(options.len(), spec.options.len());
                    for (def, option) in options.iter().zip(spec.options.iter()) {
                        prop_assert_eq!(def.id.as_str(), option.id());
                    }
                } else {
                    prop_assert!(false, "a node context is a decision task");
                }
                let matching: Vec<_> = records
                    .iter()
                    .filter(|record| record.family == spec.family)
                    .collect();
                prop_assert_eq!(matching.len(), 1, "tick {}: node records", tick.0);
                prop_assert_eq!(matching[0].rules_default, spec.rules_default);
                let chosen = planned.iter().any(|entry| {
                    entry.result.is_ok()
                        && matches!(
                            entry.payload,
                            InputPayload::Choose { node, .. } if node.trigger() == spec.trigger
                        )
                });
                prop_assert_eq!(matching[0].source == ChoiceSource::External, chosen);
                if !chosen {
                    prop_assert_eq!(matching[0].applied, spec.rules_default);
                }
            }
            // A preview runs the same validation and the same firing as the input, so a
            // previewed input always applies.
            for entry in &planned {
                prop_assert!(
                    entry.preview.is_none() || entry.result.is_ok(),
                    "tick {}: a previewed input was rejected with {:?}",
                    tick.0,
                    entry.result
                );
            }
            let _ = NodeFamily::DreamInterpretation;
        }
    }

    // Feature: underworld, Property 5: Rules_Defaults depend only on the context and the node's draws.
    #[test]
    fn property_5_rules_defaults_depend_only_on_the_context_and_the_nodes_draws(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let already = before.nodes().resolved.len();
            let (_b, after, planned) = run.step();
            let records = after.nodes().resolved.get(already..).unwrap_or(&[]);
            let seed = after.seed();
            let params = *after.params();
            for spec in underworld_gen::previews(&planned) {
                let Some(record) = records
                    .iter()
                    .find(|record| record.family == spec.family)
                else {
                    continue;
                };
                let entity = sim_core::ids::EntityId(record.id.0);
                match spec.family {
                    sim_core::underworld::nodes::NodeFamily::DreamInterpretation => {
                        let bound = i64::try_from(params.dream_noise).unwrap_or(10);
                        let noise = sim_core::rng::in_range(
                            sim_core::rng::draw(
                                seed,
                                entity,
                                sim_core::rng::StreamTag::Nodes,
                                tick,
                                0,
                            ),
                            bound.saturating_neg(),
                            bound,
                        );
                        prop_assert_eq!(
                            sim_core::underworld::dreams::dream_default(&spec.context, noise),
                            record.rules_default,
                            "tick {}: dream Rules_Default",
                            tick.0
                        );
                    }
                    sim_core::underworld::nodes::NodeFamily::MagistrateRuling => {
                        let noise = |site: u64, cap: u64| {
                            let cap = i64::try_from(cap).unwrap_or(0);
                            sim_core::rng::in_range(
                                sim_core::rng::draw(
                                    seed,
                                    entity,
                                    sim_core::rng::StreamTag::Nodes,
                                    tick,
                                    site,
                                ),
                                cap.saturating_neg(),
                                cap,
                            )
                        };
                        prop_assert_eq!(
                            sim_core::underworld::magistrate::ruling_default(
                                &spec.context,
                                noise(1, params.next_noise),
                                noise(2, params.later_noise),
                                &params,
                            ),
                            record.rules_default,
                            "tick {}: ruling Rules_Default",
                            tick.0
                        );
                    }
                }
                // Both functions take the stored Frozen_Context and the node's draws and
                // nothing else, so no World field outside the context can change the
                // answer: recomputing it here proves the recorded default follows from
                // the context alone.
            }
        }
    }
}

/// The ruling order of design "Rules_Default formulas" (R6.5).
fn ruling_rank(option: sim_core::underworld::nodes::NodeOption) -> u8 {
    use sim_core::underworld::nodes::NodeOption;
    match option {
        NodeOption::Deny => 0,
        NodeOption::GrantLaterSlot => 1,
        NodeOption::GrantNextSlot => 2,
        _ => 0,
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 1000, ..ProptestConfig::default() })]

    // Feature: underworld, Property 6: The magistrate ruling is monotone in the amount.
    #[test]
    fn property_6_the_magistrate_ruling_is_monotone_in_the_amount(
        greed in -3i8..=3,
        loyalty in -3i8..=3,
        piety in -3i8..=3,
        noise_next in -100i64..=100,
        noise_later in -100i64..=100,
        first in 0u64..4_000,
        second in 0u64..4_000,
    ) {
        use sim_core::underworld::magistrate::magistrate_default;
        use sim_core::values::Trait;
        use sim_core::values::Traits;

        let traits = Traits {
            greed: Trait::clamped(i64::from(greed)),
            loyalty: Trait::clamped(i64::from(loyalty)),
            pride: Trait::clamped(0),
            warmth: Trait::clamped(0),
            temper: Trait::clamped(0),
            vindictiveness: Trait::clamped(0),
            piety: Trait::clamped(i64::from(piety)),
        };
        let params = sim_core::params::Params::DEFAULT;
        let (low, high) = if first <= second {
            (first, second)
        } else {
            (second, first)
        };
        let worse = magistrate_default(low, &traits, noise_next, noise_later, &params);
        let better = magistrate_default(high, &traits, noise_next, noise_later, &params);
        prop_assert!(
            ruling_rank(better) >= ruling_rank(worse),
            "amount {high} ruled {better:?} after amount {low} ruled {worse:?}"
        );
    }
}

/// Steps `before` with `inputs`, and again with the payloads in `without` removed, so a
/// property can compare the tick with and without one input (design Properties 8 to 10).
fn tick_without(
    before: &World,
    inputs: &[sim_core::input::TickInput],
    without: &[InputSeq],
) -> (World, World) {
    let (with, outcomes) = before.after_inputs_and_nodes(inputs);
    for outcome in outcomes {
        if !without.contains(&outcome.seq) {
            assert!(
                outcome.result.is_ok(),
                "an isolated input was rejected: {outcome:?}"
            );
        }
    }
    let kept: Vec<_> = inputs
        .iter()
        .filter(|input| !without.contains(&input.seq))
        .copied()
        .collect();
    let (other, outcomes) = before.after_inputs_and_nodes(&kept);
    assert!(
        outcomes.iter().all(|outcome| outcome.result.is_ok()),
        "the baseline rejected an input"
    );
    (with, other)
}

/// Replays exactly the selected underworld input and its applied choice. Unrelated
/// underworld inputs are excluded so the differential measures only this mechanic.
fn isolated_inputs(
    tick: sim_core::ids::Tick,
    planned: &[underworld_gen::Submitted],
    extra: &[InputSeq],
) -> Vec<sim_core::input::TickInput> {
    planned
        .iter()
        .filter(|entry| extra.contains(&entry.seq))
        .map(|entry| sim_core::input::TickInput {
            tick,
            seq: entry.seq,
            payload: entry.payload,
        })
        .collect()
}

/// The committed System_One_Mapping_v1 (R14.4: never edited by this spec).
const SYSTEM_ONE_V1: &str =
    include_str!("../../../eval/probe/templates/decision.system_one.v1.txt");

/// Checks one fired node's context against the card rules of LS-R15 and R4.4 (Property
/// 7): the subject is present, every value is inside its card range, the situation is
/// short, the JSON round trip holds, every permutation renders and the option IDs are
/// exactly the ones the validator answers.
fn check_node_context(world: &World, spec: &sim_core::underworld::nodes::NodeSpec) {
    use sim_core::llm::api::frozen_context_to_json;
    use sim_core::llm::card::frozen_context_from_json;
    use sim_core::llm::render::permutations;
    use sim_core::llm::system_one::render_system_one;
    use sim_core::llm::validate::validate_raw_choice;
    use sim_core::llm::{IllegalReason, TaskSpec, Verdict};

    let ctx = &spec.context;
    let subject = ctx.subject.expect("a node context has a subject");
    assert!(
        ctx.people.iter().any(|person| person.id == subject),
        "the subject {} is not in people",
        subject.0
    );
    let mut previous = i64::MIN;
    for person in &ctx.people {
        assert!(person.id.0 >= 1, "card id {} < 1", person.id.0);
        assert!(
            person.id.0 > previous,
            "people are not in ascending ID order"
        );
        previous = person.id.0;
        assert!((0..=999).contains(&person.age), "age {}", person.age);
        assert!(person.wealth >= 0, "wealth {}", person.wealth);
        assert!(
            matches!(
                person.origin.as_str(),
                "native" | "possessed" | "rebuilt" | "official"
            ),
            "origin {}",
            person.origin
        );
        for trait_value in [
            person.traits.greed,
            person.traits.loyalty,
            person.traits.pride,
            person.traits.warmth,
            person.traits.temper,
            person.traits.vindictiveness,
            person.traits.piety,
        ] {
            assert!((-3..=3).contains(&trait_value), "trait {trait_value}");
        }
        if person.origin == "official" {
            // R15.12: the Magistrate's card fields.
            assert_eq!(
                person.id.0,
                i64::try_from(world.magistrate().id.0).unwrap_or(0)
            );
            assert!(person.alive);
            assert_eq!(
                person.age,
                i64::from(sim_core::underworld::magistrate::NOMINAL_AGE)
            );
            assert_eq!(person.wealth, 0);
            assert_eq!(
                person.soul_id.as_str(),
                sim_core::underworld::magistrate::SOUL_ID_TEXT
            );
        } else {
            let live = world
                .persons()
                .get(&sim_core::ids::PersonId(
                    u64::try_from(person.id.0).expect("a positive card id"),
                ))
                .expect("every context person is a World Person");
            assert_eq!(person.alive, matches!(live.life, Life::Alive { .. }));
        }
    }
    // R4.4: the dream's intent is in the context exactly for `dream_interpretation`.
    match spec.family {
        sim_core::underworld::nodes::NodeFamily::DreamInterpretation => {
            let input = ctx
                .player_input
                .as_ref()
                .expect("a dream context has its input");
            assert!(
                sim_core::underworld::dreams::DreamIntent::from_card_name(&input.intent).is_some()
            );
            assert!(!input.content.is_empty());
        }
        sim_core::underworld::nodes::NodeFamily::MagistrateRuling => {
            assert!(ctx.player_input.is_none());
        }
    }
    let words = ctx.situation.split_whitespace().count();
    assert!(words <= 80, "the situation has {words} words");
    // R15.4 (LS-R15.1): the JSON round trip returns the same context.
    let json = frozen_context_to_json(ctx);
    assert_eq!(frozen_context_from_json(json), Ok(ctx.clone()));
    // R15.5 (LS-R15.3): every permutation renders.
    let perms = permutations(ctx);
    assert_eq!(
        perms.first(),
        Some(&sim_core::llm::render::Permutation::Base)
    );
    for perm in perms {
        let rendered = render_system_one(ctx, SYSTEM_ONE_V1, perm);
        assert!(rendered.is_ok(), "rendering {perm:?} failed: {rendered:?}");
    }
    // R15.6, R15.7 (LS-R15.6, LS-R15.7): exact option IDs decide; anything else is out
    // of set.
    let TaskSpec::Decision { options } = &ctx.spec else {
        panic!("a node context is a decision task");
    };
    assert!((2..=5).contains(&options.len()));
    for option in options {
        assert_eq!(
            validate_raw_choice(options, option.id.as_str()),
            Verdict::Decision {
                option: option.id.clone()
            }
        );
        let non_option = format!("{}_not_an_option", option.id.as_str());
        match validate_raw_choice(options, &non_option) {
            Verdict::Illegal { reason, .. } => assert_eq!(reason, IllegalReason::OutOfSetOption),
            other => panic!("{non_option:?} should be out of set, got {other:?}"),
        }
    }
}

proptest! {
    // Feature: underworld, Property 7: Node contexts are valid cards.
    #[test]
    fn property_7_node_contexts_are_valid_cards(scenario in underworld_gen::arb_scenario()) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let (_b, _after, planned) = run.step();
            // The context is frozen in step 2a, so the state it shows is the one at the
            // start of the tick (a Person who dies in step 4 is still alive there).
            for spec in underworld_gen::previews(&planned) {
                check_node_context(&before, spec);
            }
        }
    }
}

/// The Mood after folding `events` onto `start`, with the clamp after each Event row.
fn fold_mood(start: i8, events: &[sim_core::events::Event], target: sim_core::ids::PersonId) -> i8 {
    let mut mood = i64::from(start);
    for event in events {
        for (position, actor) in event.kind.actors().iter().enumerate() {
            if actor != target {
                continue;
            }
            let delta = sim_core::events::mood_delta(&event.kind, position);
            mood = mood.saturating_add(delta).clamp(-100, 100);
        }
    }
    i8::try_from(mood).unwrap_or(0)
}

/// Where the "same tick without the input" may differ from the tick with it.
struct Allowed {
    /// The Event_Log length before the tick (both Worlds share it).
    start: usize,
    /// The Player_Soul's account: the spend and any credit the effect caused.
    player_account: bool,
    /// A second Soul's account that the input's effect may credit (an Offering).
    other_account: Option<SoulId>,
    /// The Player_Soul's wait may move `access_from` (a magistrate grant).
    access_from: bool,
    /// One Relation whose scores the applied option may change.
    relation: Option<(sim_core::ids::PersonId, sim_core::ids::PersonId)>,
    /// One Person whose Mood the input moves, with the Mood expected in the tick with it.
    mood: Option<(sim_core::ids::PersonId, i8)>,
    /// The only Offering pair an option is permitted to affect.
    offering_pair: Option<(sim_core::ids::PersonId, sim_core::ids::PersonId)>,
    /// Expected additions, by event kind. Other Events must agree exactly.
    added: Vec<EventKind>,
}

/// Asserts that `with` differs from `without` only where `allowed` says so (R4.7, R5.4,
/// R6.6): no other Person, Relation, Household, property, Debt, Soul, slot or balance
/// changes, the log grows by exactly the input's own Events, and no node stays pending.
fn assert_only_allowed(with: &World, without: &World, allowed: &Allowed) {
    assert_eq!(with.seed(), without.seed());
    assert_eq!(with.config(), without.config());
    assert_eq!(with.params(), without.params());
    assert_eq!(with.tick(), without.tick());
    assert_eq!(with.households(), without.households(), "households differ");
    assert_eq!(with.properties(), without.properties(), "properties differ");
    // Debts are keyed by the loan Event ID, which the input's own Event shifts; compare
    // the Debts themselves.
    let debts = |world: &World| -> Vec<(
        sim_core::ids::PersonId,
        sim_core::ids::PersonId,
        u64,
        u64,
        sim_core::ids::Tick,
    )> {
        world
            .debts()
            .values()
            .map(|debt| {
                (
                    debt.creditor,
                    debt.debtor,
                    debt.principal,
                    debt.open,
                    debt.due,
                )
            })
            .collect()
    };
    assert_eq!(debts(with), debts(without), "debts differ");
    assert_eq!(with.souls(), without.souls(), "souls differ");
    assert_eq!(with.slots(), without.slots(), "birth slots differ");
    assert_eq!(with.magistrate(), without.magistrate());
    assert_eq!(with.last_flows(), without.last_flows(), "flows differ");
    assert!(
        with.nodes().pending.is_empty() && without.nodes().pending.is_empty(),
        "a node is pending"
    );
    // Event IDs and causal pointers shift when an input appends an Event. Compare
    // complete kinds (participants, price, amount, due tick) of all unaffected
    // Events, not merely their card types or counts.
    let common = |world: &World| -> Vec<EventKind> {
        world
            .log()
            .events()
            .iter()
            .skip(allowed.start)
            .filter_map(|event| {
                if allowed.added.contains(&event.kind) {
                    return None;
                }
                if matches!(event.kind, EventKind::Offering { offerer, ghost, .. }
                if allowed.offering_pair == Some((offerer, ghost)))
                {
                    return None;
                }
                Some(event.kind.clone())
            })
            .collect()
    };
    assert_eq!(common(with), common(without), "an unrelated Event changed");
    for kind in &allowed.added {
        let actual = with
            .log()
            .events()
            .iter()
            .skip(allowed.start)
            .filter(|event| &event.kind == kind)
            .count();
        let baseline = without
            .log()
            .events()
            .iter()
            .skip(allowed.start)
            .filter(|event| &event.kind == kind)
            .count();
        let expected = allowed.added.iter().filter(|other| *other == kind).count();
        assert_eq!(
            actual,
            baseline + expected,
            "an input Event is missing or duplicated"
        );
    }

    let player = with.souls().player;
    for (id, person) in with.persons() {
        let base = without
            .persons()
            .get(id)
            .unwrap_or_else(|| panic!("person {} is missing", id.0));
        match allowed.mood {
            Some((target, expected)) if *id == target => {
                let Life::Alive {
                    household,
                    money,
                    mood,
                } = &person.life
                else {
                    panic!("the haunting target {} died", id.0);
                };
                assert_eq!(person.traits, base.traits);
                assert_eq!(person.soul, base.soul);
                assert_eq!(person.wage, base.wage);
                assert_eq!(person.name, base.name);
                assert_eq!(*household, base_household(&base.life));
                assert_eq!(*money, base_money(&base.life));
                assert_eq!(mood.get(), expected, "person {} Mood", id.0);
            }
            _ => assert_eq!(person, base, "person {} differs", id.0),
        }
    }
    for (soul, account) in with.joss() {
        let base = without
            .joss()
            .get(soul)
            .unwrap_or_else(|| panic!("account {} is missing", soul.0));
        if *soul == player && allowed.player_account || Some(*soul) == allowed.other_account {
            continue;
        }
        assert_eq!(account, base, "account {} differs", soul.0);
    }
    for (pair, relation) in with.relations() {
        let base = without.relations().get(pair);
        if Some(*pair) == allowed.relation {
            assert_eq!(
                base.map(|relation| relation.tags),
                Some(relation.tags),
                "the allowed Relation changed tags"
            );
            continue;
        }
        assert_eq!(Some(relation), base, "the Relation {pair:?} differs");
    }
    for pair in without.relations().keys() {
        assert!(
            with.relations().contains_key(pair) || Some(*pair) == allowed.relation,
            "the Relation {pair:?} disappeared"
        );
    }
    match (with.player_wait(), without.player_wait()) {
        (None, None) => {}
        (Some(a), Some(b)) if allowed.access_from => {
            assert_eq!(a.ghost, b.ghost);
            assert_eq!(a.claim, b.claim);
            assert_eq!(a.carry_over, b.carry_over);
            assert!(
                a.access_from <= b.access_from,
                "a grant moved access_from later"
            );
        }
        (a, b) => assert_eq!(a, b, "the Player_Wait differs"),
    }
}

fn base_household(life: &Life) -> sim_core::ids::HouseholdId {
    match life {
        Life::Alive { household, .. } => *household,
        Life::Dead { .. } => panic!("a dead Person has no Household"),
    }
}

fn base_money(life: &Life) -> u64 {
    match life {
        Life::Alive { money, .. } => *money,
        Life::Dead { .. } => panic!("a dead Person has no money"),
    }
}

proptest! {
    // Feature: underworld, Property 8: Dreams spend, fire and change only what the option names.
    #[test]
    fn property_8_dreams_spend_fire_and_change_only_what_the_option_names(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let (_before_world, after, planned) = run.step();
            let Some(dream) = planned
                .iter()
                .find(|entry| entry.result.is_ok() && matches!(entry.payload, InputPayload::Dream { .. }))
            else {
                continue;
            };
            let InputPayload::Dream { dreamer, intent } = dream.payload else {
                continue;
            };
            let price = before.params().dream_price;
            let ghost = before
                .player_wait()
                .expect("an applied dream has a Ghost")
                .ghost;
            // R4.1: one `dream` Event for this dream's tick.
            let dreams: Vec<_> = events_since(&after, before.log().len())
                .iter()
                .filter(|event| matches!(event.kind, EventKind::Dream { .. }))
                .collect();
            prop_assert_eq!(dreams.len(), 1, "tick {}", tick.0);
            let EventKind::Dream { ghost: event_ghost, dreamer: event_dreamer, price: event_price } =
                dreams[0].kind
            else {
                unreachable!()
            };
            prop_assert_eq!(event_ghost, ghost);
            prop_assert_eq!(event_dreamer, dreamer);
            prop_assert_eq!(event_price, price);
            // R4.2, R4.5, R4.6: the node's options carry the intent, a dismissal and, for
            // `request_offering`, a burning option.
            let spec = dream.preview.as_ref().expect("a valid dream fires a node");
            prop_assert!(spec.options.contains(&intent.as_intent_option()));
            prop_assert!(spec.options.contains(&sim_core::underworld::nodes::NodeOption::DismissDream));
            if intent == sim_core::underworld::dreams::DreamIntent::RequestOffering {
                prop_assert!(spec.options.contains(&sim_core::underworld::nodes::NodeOption::BurnOffering));
            }
            prop_assert_eq!(spec.family, sim_core::underworld::nodes::NodeFamily::DreamInterpretation);
            prop_assert_eq!(spec.context.subject, Some(sim_core::llm::PersonId(i64::try_from(dreamer.0).unwrap_or(0))));

            // R4.7: without the dream and its Choose the tick differs only in the spend,
            // the Events, the node record and the applied option's effect.
            let mut extra = vec![dream.seq];
            if let Some(choice) = planned.iter().find(|entry| {
                entry.result.is_ok() && matches!(entry.payload, InputPayload::Choose { node, .. }
                    if node.trigger() == dream.seq)
            }) {
                extra.push(choice.seq);
            }
            let isolated = isolated_inputs(tick, &planned, &extra);
            let (with_world, without_world) = tick_without(&before, &isolated, &extra);
            let applied = with_world.nodes().resolved.last().expect("a dream resolved").applied;
            let pair = (dreamer, ghost);
            let offering_effect = matches!(applied,
                sim_core::underworld::nodes::NodeOption::BurnOffering
                    | sim_core::underworld::nodes::NodeOption::BurnSmall);
            let offerings = |world: &World| -> Vec<_> {
                events_since(world, before.log().len()).iter().filter_map(|event| match event.kind {
                    EventKind::Offering { offerer, ghost, amount, credited } if (offerer, ghost) == pair => Some((amount, credited)),
                    _ => None,
                }).collect()
            };
            let with_offerings = offerings(&with_world);
            let without_offerings = offerings(&without_world);
            prop_assert_eq!(with_offerings.len(), usize::from(offering_effect),
                "tick {}: the option added an unexpected Offering", tick.0);
            prop_assert!(without_offerings.is_empty());
            let player = before.souls().player;
            let credited = with_offerings.iter().map(|(_, credit)| *credit).sum::<u64>();
            prop_assert_eq!(
                with_world.joss()[&player].balance.saturating_add(price),
                without_world.joss()[&player].balance.saturating_add(credited),
                "tick {}: dream price or offering credit", tick.0
            );
            let original = before.relations().get(&pair).expect("a connected dreamer");
            let changed = with_world.relations().get(&pair).expect("the Relation persists");
            let (affinity, trust) = match applied {
                sim_core::underworld::nodes::NodeOption::DismissDream => (0, 0),
                sim_core::underworld::nodes::NodeOption::BurnOffering =>
                    (before.params().burn_offering_affinity_gain, 0),
                sim_core::underworld::nodes::NodeOption::BurnSmall =>
                    (before.params().burn_small_affinity_gain, 0),
                _ => (before.params().dream_affinity_gain, before.params().dream_trust_gain),
            };
            prop_assert_eq!(changed.affinity.get(), sim_core::underworld::nodes::clamp_score(original.affinity.get(), affinity));
            prop_assert_eq!(changed.trust.get(), sim_core::underworld::nodes::clamp_score(original.trust.get(), trust));
            if let Some((amount, _)) = with_offerings.first() {
                let base = expected_offering_amount(before.params(), original.affinity.get(),
                    before.persons()[&dreamer].traits.piety.get(),
                    match before.persons()[&dreamer].life { Life::Alive { money, .. } => money, _ => 0 }, 1);
                let divisor = if applied == sim_core::underworld::nodes::NodeOption::BurnSmall { 3 } else { 1 };
                prop_assert_eq!(*amount, base.checked_div(divisor).unwrap_or(0).clamp(1, 500));
            }
            assert_only_allowed(&with_world, &without_world, &Allowed {
                start: before.log().len(),
                added: vec![dreams[0].kind.clone()],
                offering_pair: offering_effect.then_some(pair),
                player_account: true,
                other_account: None,
                access_from: false,
                relation: (applied != sim_core::underworld::nodes::NodeOption::DismissDream).then_some(pair),
                mood: None,
            });
        }
    }

    // Feature: underworld, Property 9: Hauntings change only the target's Mood.
    #[test]
    fn property_9_hauntings_change_only_the_targets_mood(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let (_b, after, planned) = run.step();
            let Some(haunt) = planned
                .iter()
                .find(|entry| entry.result.is_ok() && matches!(entry.payload, InputPayload::Haunt { .. }))
            else {
                continue;
            };
            let InputPayload::Haunt { target } = haunt.payload else {
                continue;
            };
            let ghost = before
                .player_wait()
                .expect("an applied haunting has a Ghost")
                .ghost;
            let price = before.params().haunt_price;
            let haunts: Vec<_> = events_since(&after, before.log().len())
                .iter()
                .filter(|event| matches!(event.kind, EventKind::Haunting { .. }))
                .collect();
            prop_assert_eq!(haunts.len(), 1, "tick {}", tick.0);
            let EventKind::Haunting { ghost: event_ghost, target: event_target, price: event_price, .. } =
                haunts[0].kind
            else {
                unreachable!()
            };
            prop_assert_eq!(event_ghost, ghost);
            prop_assert_eq!(event_target, target);
            prop_assert_eq!(event_price, price);

            let isolated = isolated_inputs(tick, &planned, &[haunt.seq]);
            let (with_world, without_world) = tick_without(&before, &isolated, &[haunt.seq]);
            // The Mood after the tick, folded from the documented Mood rows of the
            // tick's Events in log order, with the clamp after each (LS-R14.2).
            let target_mood = |world: &World| match world.persons()[&target].life {
                Life::Alive { mood, .. } => Some(mood.get()),
                Life::Dead { .. } => None,
            };
            let expected_mood = target_mood(&before).map(|start| {
                fold_mood(start, events_since(&with_world, before.log().len()), target)
            });
            prop_assert_eq!(
                target_mood(&with_world),
                expected_mood,
                "tick {}: Mood before {:?} without {:?} with {:?}",
                tick.0,
                target_mood(&before),
                target_mood(&without_world),
                target_mood(&with_world)
            );
            // A target that dies in this tick has no Mood to compare; it dies in both
            // runs, so the rest of the Person is equal.
            let mood = expected_mood.map(|mood| (target, mood));
            let player = before.souls().player;
            let spent = without_world.joss()[&player]
                .balance
                .checked_sub(with_world.joss()[&player].balance)
                .unwrap_or_else(|| panic!(
                    "tick {}: the haunting balance did not fall: without {} with {}",
                    tick.0,
                    without_world.joss()[&player].balance,
                    with_world.joss()[&player].balance
                ));
            prop_assert_eq!(spent, price, "tick {}: haunting spend", tick.0);
            assert_only_allowed(&with_world, &without_world, &Allowed {
                start: before.log().len(),
                added: vec![haunts[0].kind.clone()],
                offering_pair: None,
                player_account: true,
                other_account: None,
                access_from: false,
                relation: None,
                mood,
            });
        }
    }

    // Feature: underworld, Property 10: Bribes and rulings change only access.
    #[test]
    fn property_10_bribes_and_rulings_change_only_access(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let (_b, after, planned) = run.step();
            let Some(bribe) = planned
                .iter()
                .find(|entry| entry.result.is_ok() && matches!(entry.payload, InputPayload::Bribe { .. }))
            else {
                continue;
            };
            let InputPayload::Bribe { amount } = bribe.payload else {
                continue;
            };
            let ghost = before
                .player_wait()
                .expect("an applied Bribe has a Ghost")
                .ghost;
            let magistrate = before.magistrate().id;
            let tail = events_since(&after, before.log().len());
            // R6.1: the offering to the Magistrate and the appeal, in that order.
            let offerings: Vec<_> = tail
                .iter()
                .filter(|event| matches!(&event.kind, EventKind::BribeOffering { .. }))
                .collect();
            prop_assert_eq!(offerings.len(), 1, "tick {}", tick.0);
            let EventKind::BribeOffering { ghost: offerer, magistrate: recipient, amount: offered } =
                offerings[0].kind
            else {
                unreachable!()
            };
            prop_assert_eq!(offerer, ghost);
            prop_assert_eq!(recipient, magistrate);
            prop_assert_eq!(offered, amount);
            prop_assert!(offerings[0].tags.contains(sim_core::events::EventTag::JossPaper));
            let appeals: Vec<_> = tail
                .iter()
                .filter(|event| matches!(&event.kind, EventKind::Appeal { .. }))
                .collect();
            prop_assert_eq!(appeals.len(), 1, "tick {}", tick.0);
            let EventKind::Appeal { ghost: appealing, magistrate: ruled } = appeals[0].kind else {
                unreachable!()
            };
            prop_assert_eq!(appealing, ghost);
            prop_assert_eq!(ruled, magistrate);
            // R6.1, R3.11: the ruling node has the Magistrate as subject.
            let spec = bribe.preview.as_ref().expect("a valid Bribe fires a node");
            prop_assert_eq!(spec.family, sim_core::underworld::nodes::NodeFamily::MagistrateRuling);
            prop_assert_eq!(spec.context.subject, Some(sim_core::llm::PersonId(i64::try_from(magistrate.0).unwrap_or(0))));
            if let Some(slot) = planned.iter().find_map(|entry| {
                if !entry.result.is_ok() {
                    return None;
                }
                match entry.payload {
                    InputPayload::ClaimSlot { slot: SlotRef::ImportedVessel } => Some(SlotRef::ImportedVessel),
                    InputPayload::ClaimSlot { slot: SlotRef::RebuiltBody } => Some(SlotRef::RebuiltBody),
                    _ => None,
                }
            }) {
                prop_assert!(standing_claim_ends_old_wait(&before, &after, slot),
                    "tick {}: a Standing claim did not end its original wait", tick.0);
                prop_assert!(after.nodes().resolved.iter().any(|record|
                    record.tick == tick && record.family == sim_core::underworld::nodes::NodeFamily::MagistrateRuling),
                    "tick {}: a same-tick claim lost its ruling record", tick.0);
            }

            let mut extra = vec![bribe.seq];
            if let Some(choice) = planned.iter().find(|entry| {
                entry.result.is_ok() && matches!(entry.payload, InputPayload::Choose { node, .. }
                    if node.trigger() == bribe.seq)
            }) {
                extra.push(choice.seq);
            }
            let isolated = isolated_inputs(tick, &planned, &extra);
            let (with_world, without_world) = tick_without(&before, &isolated, &extra);
            let player = before.souls().player;
            let spent = without_world.joss()[&player]
                .balance
                .checked_sub(with_world.joss()[&player].balance)
                .expect("the Bribe spends joss paper");
            // The ruling may grant an earlier register date, never a later one.
            prop_assert!(spent == amount, "tick {}: Bribe spend {spent}", tick.0);
            let record = with_world.nodes().resolved.last().expect("the Bribe resolves");
            prop_assert_eq!(record.family, sim_core::underworld::nodes::NodeFamily::MagistrateRuling);
            let current = before.player_wait().expect("the Bribe requires a wait").access_from;
            let expected = match record.applied {
                sim_core::underworld::nodes::NodeOption::GrantNextSlot =>
                    sim_core::underworld::nodes::clamp_access(tick, tick, current),
                sim_core::underworld::nodes::NodeOption::GrantLaterSlot =>
                    sim_core::underworld::nodes::clamp_access(tick,
                        sim_core::ids::Tick(tick.0.saturating_add(before.params().grant_later_delay)), current),
                _ => current,
            };
            prop_assert_eq!(with_world.player_wait().expect("isolated Bribe keeps waiting").access_from, expected);
            assert_only_allowed(&with_world, &without_world, &Allowed {
                start: before.log().len(),
                added: vec![offerings[0].kind.clone(), appeals[0].kind.clone()],
                offering_pair: None,
                player_account: true,
                other_account: None,
                access_from: true,
                relation: None,
                mood: None,
            });
        }
    }
}

/// The value of one card Trait, for the Carry_Over check (Property 13).
fn trait_value(traits: &sim_core::values::Traits, name: TraitSelected) -> i8 {
    use sim_core::underworld::carry_over::TraitName;
    match name {
        TraitName::Greed => traits.greed.get(),
        TraitName::Loyalty => traits.loyalty.get(),
        TraitName::Pride => traits.pride.get(),
        TraitName::Warmth => traits.warmth.get(),
        TraitName::Temper => traits.temper.get(),
        TraitName::Vindictiveness => traits.vindictiveness.get(),
        TraitName::Piety => traits.piety.get(),
    }
}

type TraitSelected = sim_core::underworld::carry_over::TraitName;

/// The body that carries the Player_Soul at the end of `world`, if it is in one.
fn player_body(world: &World) -> Option<sim_core::ids::PersonId> {
    match world.souls().places.get(&world.souls().player) {
        Some(SoulPlace::Body(body)) => Some(*body),
        _ => None,
    }
}

/// A placement ends this wait even if its new body dies in step 4 and starts another.
/// Match the arrival Event (and its price) before inspecting the resulting Soul place.
fn player_arrival_ends_old_wait(
    before: &World,
    after: &World,
    arrival: impl Fn(&EventKind) -> Option<sim_core::ids::PersonId>,
) -> bool {
    let events = events_since(after, before.log().len());
    let player = before.souls().player;
    events
        .iter()
        .filter_map(|event| arrival(&event.kind))
        .any(|body| {
            after.persons().get(&body).is_some_and(|person| person.soul == player)
                && match after.souls().places.get(&player) {
                    Some(SoulPlace::Body(current)) => {
                        *current == body && after.player_wait().is_none()
                    }
                    Some(SoulPlace::Waiting { since }) => {
                        *since == before.tick()
                            && after.player_wait().is_some_and(|wait| {
                                wait.ghost == body && wait.claim.is_none()
                            })
                            && events.iter().any(|event| {
                                matches!(event.kind, EventKind::Death { person } if person == body)
                            })
                    }
                    _ => false,
                }
        })
}

fn standing_claim_ends_old_wait(before: &World, after: &World, slot: SlotRef) -> bool {
    player_arrival_ends_old_wait(before, after, |kind| match (slot, kind) {
        (SlotRef::ImportedVessel, EventKind::Possession { person, price })
            if *price == before.params().imported_price =>
        {
            Some(*person)
        }
        (SlotRef::RebuiltBody, EventKind::Rebuild { person, price })
            if *price == before.params().rebuilt_price =>
        {
            Some(*person)
        }
        _ => None,
    })
}

/// A claimed Birth_Slot can remain open after step 3 only if this wait ended in
/// a priced Standing placement or the free overdue placement. A death of the
/// arriving body in step 4 starts a new, unclaimed wait, not the old one.
fn placement_ends_old_wait(
    before: &World,
    stage: &World,
    planned: &[underworld_gen::Submitted],
) -> bool {
    let player = before.souls().player;
    let overdue = matches!(
        before.souls().places.get(&player),
        Some(SoulPlace::Waiting { since })
            if before.tick().0.saturating_sub(since.0) > before.params().player_max_wait
    );
    (overdue
        && player_arrival_ends_old_wait(before, stage, |kind| match kind {
            EventKind::Possession { person, price } if *price == 0 => Some(*person),
            _ => None,
        }))
        || planned
            .iter()
            .filter(|entry| entry.result.is_ok())
            .any(|entry| match entry.payload {
                InputPayload::ClaimSlot {
                    slot: SlotRef::ImportedVessel,
                } => standing_claim_ends_old_wait(before, stage, SlotRef::ImportedVessel),
                InputPayload::ClaimSlot {
                    slot: SlotRef::RebuiltBody,
                } => standing_claim_ends_old_wait(before, stage, SlotRef::RebuiltBody),
                _ => false,
            })
}

/// A closed mother's slot releases this claim without ending the same wait.
/// Otherwise a placement must be witnessed by its priced arrival Event.
fn old_claim_release_is_valid(
    before: &World,
    stage: &World,
    planned: &[underworld_gen::Submitted],
    died: &[sim_core::ids::PersonId],
    id: sim_core::ids::BirthSlotId,
) -> bool {
    let mother_died = before
        .slots()
        .get(&id)
        .is_some_and(|slot| died.contains(&slot.mother));
    if stage.slots().contains_key(&id) == mother_died {
        return false;
    }
    placement_ends_old_wait(before, stage, planned)
        || (mother_died
            && stage.player_wait().is_some_and(|wait| {
                before
                    .player_wait()
                    .is_some_and(|old| wait.ghost == old.ghost)
                    && wait.claim.is_none()
            })
            && matches!(
                stage.souls().places.get(&before.souls().player),
                Some(SoulPlace::Waiting { .. })
            ))
}

proptest! {
    // Feature: underworld, Property 11: Slots open, are claimed and are born correctly.
    #[test]
    fn property_11_slots_open_are_claimed_and_are_born_correctly(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let start = before.log().len();
            let (_b, after, planned) = run.step();
            let params = *before.params();
            let events = events_since(&after, start);

            // R7.1: a slot opens in the tick of its announcement with a fresh ID, a
            // birth tick one lead time later and a living Resident mother.
            for (id, slot) in after.slots() {
                if before.slots().contains_key(id) {
                    continue;
                }
                prop_assert_eq!(slot.announced, tick, "tick {}: announced", tick.0);
                prop_assert_eq!(
                    slot.birth.0,
                    tick.0.saturating_add(params.birth_lead_days),
                    "tick {}: birth",
                    tick.0
                );
                let mother_alive = matches!(
                    after.persons().get(&slot.mother).map(|person| &person.life),
                    Some(Life::Alive { .. })
                );
                prop_assert!(
                    mother_alive,
                    "tick {}: slot {} names non-Resident mother {}",
                    tick.0,
                    id.0,
                    slot.mother.0
                );
                prop_assert!(
                    before.slots().keys().all(|earlier| earlier.0 < id.0),
                    "tick {}: slot {} is not fresh",
                    tick.0,
                    id.0
                );
            }
            let died: Vec<sim_core::ids::PersonId> = events
                .iter()
                .filter_map(|event| match event.kind {
                    EventKind::Death { person } => Some(person),
                    _ => None,
                })
                .collect();
            // R7.1: a slot closes at its birth tick or at the mother's death.
            for (id, slot) in before.slots() {
                if after.slots().contains_key(id) {
                    continue;
                }
                prop_assert!(
                    slot.birth == tick || died.contains(&slot.mother),
                    "tick {}: slot {} closed without a birth or the mother's death",
                    tick.0,
                    id.0
                );
            }

            // Step 6 reads the post-input, post-release, post-death and post-offering
            // state, not either end-of-tick queue. In particular, a claim applied in
            // step 2 wins over a birth due today, and step-3 releases cannot be born.
            let stage = before.before_offerings(&run.last_inputs).after_offerings();
            let mut waiting: Vec<(u64, SoulId)> = stage.souls().places.iter().filter_map(|(&soul, place)| {
                match place {
                    SoulPlace::Waiting { since } if soul != stage.souls().player => Some((since.0, soul)),
                    _ => None,
                }
            }).collect();
            waiting.sort();
            let births: Vec<_> = events.iter().filter_map(|event| match event.kind {
                EventKind::Birth { person } => Some(person),
                _ => None,
            }).collect();
            let mut next_birth = 0usize;
            for slot in stage.slots().values().filter(|slot| slot.birth == tick) {
                let claimed = stage.player_wait().and_then(|wait| wait.claim) == Some(slot.id);
                let expected = if claimed {
                    Some(stage.souls().player)
                } else if waiting.is_empty() {
                    None
                } else {
                    Some(waiting.remove(0).1)
                };
                if let Some(expected) = expected {
                    let body = births.get(next_birth).unwrap_or_else(|| panic!(
                        "tick {}: slot {} gave no birth to Soul {}", tick.0, slot.id.0, expected.0
                    ));
                    next_birth += 1;
                    prop_assert_eq!(after.persons()[body].soul, expected,
                        "tick {}: slot {} gave the body to the wrong Soul", tick.0, slot.id.0);
                }
            }
            prop_assert_eq!(next_birth, births.len(), "tick {}: extra slot birth", tick.0);
            // R7.6: both Standing_Slots are open with different prices while it waits.
            if after.player_wait().is_some() {
                prop_assert!(params.rebuilt_price > params.imported_price);
            }
            // Claims resolve in input sequence order before step 3. A Standing
            // claim ends this wait before deaths; its new body can die in step 4,
            // starting a different wait before the slot stage.
            for entry in planned.iter().filter(|entry| entry.result.is_ok()) {
                let InputPayload::ClaimSlot { slot } = entry.payload else { continue };
                match slot {
                    SlotRef::Birth(id) => {
                        let stage_claim = stage.player_wait().and_then(|wait| wait.claim);
                        let due = stage.slots().get(&id).is_some_and(|slot| slot.birth == tick);
                        if stage_claim == Some(id) {
                            prop_assert!(stage.slots().contains_key(&id),
                                "tick {}: applied claim {} points to a closed slot", tick.0, id.0);
                            if due {
                                prop_assert!(births.iter().any(|body| after.persons()[body].soul == before.souls().player),
                                    "tick {}: claim {} did not give the Player_Soul a body", tick.0, id.0);
                            } else {
                                prop_assert_eq!(after.player_wait().and_then(|wait| wait.claim), Some(id),
                                    "tick {}: a live claim on an open slot was lost", tick.0);
                            }
                        } else {
                            prop_assert_eq!(stage_claim, None,
                                "tick {}: applied claim {} was replaced", tick.0, id.0);
                            prop_assert!(old_claim_release_is_valid(&before, &stage, &planned, &died, id),
                                "tick {}: applied claim {} disappeared without its mother dying or a witnessed placement of the original wait", tick.0, id.0);
                        }
                    }
                    SlotRef::ImportedVessel | SlotRef::RebuiltBody => {
                        prop_assert!(standing_claim_ends_old_wait(&before, &after, slot),
                            "tick {}: same-tick Standing claim did not end its original wait", tick.0);
                    }
                }
            }
            if let Some(id) = before.player_wait().and_then(|wait| wait.claim) {
                let stage_claim = stage.player_wait().and_then(|wait| wait.claim);
                if stage_claim == Some(id) {
                    let slot = stage.slots().get(&id);
                    prop_assert!(slot.is_some(),
                        "tick {}: held claim {} points to a closed slot", tick.0, id.0);
                    if slot.is_some_and(|slot| slot.birth == tick) {
                        prop_assert!(births.iter().any(|body| after.persons()[body].soul == before.souls().player),
                            "tick {}: held claim {} did not produce a Player_Soul birth", tick.0, id.0);
                    } else {
                        prop_assert_eq!(after.player_wait().and_then(|wait| wait.claim), Some(id),
                            "tick {}: held claim {} ended before its birth", tick.0, id.0);
                    }
                } else {
                    prop_assert_eq!(stage_claim, None,
                        "tick {}: held claim {} was replaced", tick.0, id.0);
                    prop_assert!(old_claim_release_is_valid(&before, &stage, &planned, &died, id),
                        "tick {}: held claim {} disappeared without its mother dying or a witnessed placement of the original wait",
                        tick.0, id.0);
                }
            }
        }
    }

    // Feature: underworld, Property 12: The Player_Soul's wait is bounded.
    #[test]
    fn property_12_the_player_souls_wait_is_bounded(scenario in underworld_gen::arb_scenario()) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let (_b, after, planned) = run.step();
            let params = *before.params();
            // R8.3: at the end of every tick the wait is at most Player_Max_Wait.
            if after.player_wait().is_some() {
                let player = after.souls().player;
                match after.souls().places.get(&player) {
                    Some(SoulPlace::Waiting { since }) => {
                        let waited = tick.0.saturating_sub(since.0);
                        prop_assert!(
                            waited <= params.player_max_wait,
                            "tick {}: wait {} over {}",
                            tick.0,
                            waited,
                            params.player_max_wait
                        );
                    }
                    _ => prop_assert!(false, "tick {}: a wait without a waiting Soul", tick.0),
                }
            }
            // R8.1, R8.2: a tick in which the wait would exceed the bound places the
            // Player_Soul in a new Imported_Vessel, at no cost, releasing the claim.
            let since = before
                .player_wait()
                .and_then(|_| match before.souls().places.get(&before.souls().player) {
                    Some(SoulPlace::Waiting { since }) => Some(since.0),
                    _ => None,
                });
            if let Some(since) = since
                && tick.0.saturating_sub(since) > params.player_max_wait
                && !planned.iter().any(|entry| entry.result.is_ok()
                    && matches!(entry.payload, InputPayload::ClaimSlot { slot: SlotRef::ImportedVessel | SlotRef::RebuiltBody }))
            {
                prop_assert!(player_arrival_ends_old_wait(&before, &after, |kind| match kind {
                    EventKind::Possession { person, price } if *price == 0 => Some(*person),
                    _ => None,
                }), "tick {}: no free placement ended the original wait", tick.0);
                // R8.2: no open Birth_Slot names the Player_Soul as its claimant.
                for slot in after.slots().values() {
                    prop_assert!(
                        after.player_wait().and_then(|wait| wait.claim) != Some(slot.id),
                        "tick {}: slot {} kept a claim",
                        tick.0,
                        slot.id.0
                    );
                }
            }
        }
    }

    // Feature: underworld, Property 13: The carry-over changes at most one Trait.
    #[test]
    fn property_13_the_carry_over_changes_at_most_one_trait(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let (_b, after, planned) = run.step();
            let inputs = run.last_inputs.clone();
            let left = before.player_wait().is_some() && after.player_wait().is_none();
            if !left {
                continue;
            }
            // Remove both the stored choice from an earlier tick and today's input.
            // Removing only today's input would apply the earlier choice, potentially
            // changing a second, different Trait in the comparison.
            let baseline_inputs: Vec<_> = inputs.iter().filter(|input| {
                !matches!(input.payload, InputPayload::CarryOver { .. })
            }).copied().collect();
            let mut baseline = before.without_carry_over();
            baseline.step(&baseline_inputs);
            let body_with = player_body(&after).expect("the player received a new body");
            let body_without = player_body(&baseline).expect("the baseline received a new body");
            prop_assert_eq!(body_with, body_without,
                "tick {}: deleting carry-over changed the selected body", before.tick().0);
            // Inputs apply in sequence: the last successful Carry_Over on this tick
            // replaces any choice made earlier in the wait.
            let stored = planned
                .iter()
                .rev()
                .find_map(|entry| match entry.payload {
                    InputPayload::CarryOver { trait_name } if entry.result.is_ok() => {
                        Some(trait_name)
                    }
                    _ => None,
                })
                .or_else(|| before.player_wait().and_then(|wait| wait.carry_over));
            let ghost = before.player_wait().expect("an exit has a previous body").ghost;
            let traits_with = &after.persons()[&body_with].traits;
            let traits_without = &baseline.persons()[&body_without].traits;
            for name in TraitSelected::ALL {
                let actual = trait_value(traits_with, name);
                let original = trait_value(traits_without, name);
                prop_assert!((-3..=3).contains(&actual), "trait {name:?} out of range");
                let expected = if stored == Some(name) {
                    trait_value(&before.persons()[&ghost].traits, name)
                } else {
                    original
                };
                prop_assert_eq!(actual, expected,
                    "tick {}: {:?} did not follow the stored Carry_Over {:?}",
                    before.tick().0, name, stored);
            }
        }
    }

    // Feature: underworld, Property 14: Invalid underworld inputs are skipped and recorded.
    #[test]
    fn property_14_invalid_underworld_inputs_are_skipped_and_recorded(
        scenario in underworld_gen::arb_scenario()
    ) {
        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let tick = before.tick();
            let (_b, after, planned) = run.step();
            for entry in &planned {
                let Err(reason) = entry.result else {
                    continue;
                };
                if matches!(entry.payload, InputPayload::Act { .. }) {
                    continue;
                }
                // R1.5, R3.4, R4.3, R5.3, R6.2, R7.8, R9.2, R15.9: an invalid input
                // changes nothing but the rejection record.
                let before_rejections = before
                    .rejections()
                    .count_by_reason
                    .get(&reason)
                    .copied()
                    .unwrap_or(0);
                let after_rejections = after
                    .rejections()
                    .count_by_reason
                    .get(&reason)
                    .copied()
                    .unwrap_or(0);
                prop_assert!(
                    after_rejections > before_rejections,
                    "tick {}: no rejection counted for {:?}",
                    tick.0,
                    reason
                );
                let last_rejected = planned.iter().rev().find(|candidate| candidate.result.is_err());
                if last_rejected.is_some_and(|candidate| candidate.seq == entry.seq) {
                    prop_assert_eq!(after.rejections().last, Some((tick, entry.seq, reason)));
                }
                // The same tick without that input.
                let inputs = run.last_inputs.clone();
                let mut other = before.clone();
                let kept: Vec<sim_core::input::TickInput> = inputs
                    .iter()
                    .filter(|input| input.seq != entry.seq)
                    .copied()
                    .collect();
                other.step(&kept);
                underworld_gen::assert_same_except_rejections(&after, &other);
            }
        }
    }

    // Feature: underworld, Property 15: The Magistrate stays fixed and outside the town.
    #[test]
    fn property_15_the_magistrate_stays_fixed_and_outside_the_town(
        scenario in underworld_gen::arb_scenario()
    ) {
        use std::collections::BTreeSet;

        let mut run = Run::new(scenario);
        let opening = run.world().magistrate().clone();
        let id = opening.id;
        let full_name = sim_core::underworld::magistrate::FULL_NAME;
        for _ in 0..TICKS {
            let before = run.world().clone();
            let start = before.log().len();
            let (_b, after, _planned) = run.step();
            prop_assert_eq!(after.magistrate(), &opening, "the Magistrate changed");
            prop_assert!(!after.persons().contains_key(&id));
            prop_assert!(after.souls().places.values().all(|place| *place != SoulPlace::Body(id)));
            // SoulId and PersonId are separate namespaces; numeric equality is valid.
            prop_assert!(after.relations().keys().all(|(from, to)| *from != id && *to != id));
            prop_assert!(
                after
                    .debts()
                    .values()
                    .all(|debt| debt.creditor != id && debt.debtor != id)
            );
            prop_assert!(after.properties().values().all(|property| property.owner != id));
            // R15.10: a full name distinct from every Resident's.
            let names: BTreeSet<String> = after
                .persons()
                .values()
                .filter(|person| matches!(person.life, Life::Alive { .. }))
                .map(|person| person.name.text(person.sex))
                .collect();
            prop_assert!(!names.contains(full_name));
            // R15.8: only as the recipient of an appeal or its offering.
            for event in events_since(&after, start) {
                let actors: Vec<sim_core::ids::PersonId> =
                    event.kind.actors().iter().collect();
                if !actors.contains(&id) {
                    continue;
                }
                prop_assert_eq!(actors.get(1), Some(&id), "the Magistrate is not the recipient");
                prop_assert!(
                    matches!(
                        event.kind,
                        EventKind::Appeal { .. } | EventKind::BribeOffering { .. }
                    ),
                    "the Magistrate appears in a `{}` Event",
                    event.kind.card_type()
                );
            }
        }
    }
}

/// Every `(tick, payload)` of a run's input stream, in submission order.
fn recorded_inputs(run: &Run) -> Vec<(sim_core::ids::Tick, InputPayload)> {
    run.sim
        .inputs()
        .all()
        .iter()
        .map(|input| (input.tick, input.payload))
        .collect()
}

proptest! {
    // Feature: underworld, Property 16: Replays with External_Choices reproduce every Checksum.
    #[test]
    fn property_16_replays_with_external_choices_reproduce_every_checksum(
        scenario in underworld_gen::arb_scenario()
    ) {
        let run = driven(scenario);
        let choices = run
            .plan
            .iter()
            .flatten()
            .filter(|entry| {
                entry.result.is_ok()
                    && matches!(
                        entry.payload,
                        InputPayload::Choose { .. }
                    )
            })
            .count();
        if choices == 0 {
            // R14.2 constrains runs with External_Choices; the smoke test shows they
            // occur, and this property covers every run that has one.
            return Ok(());
        }
        // The same seed, Params and recorded input stream reproduce every Checksum
        // without calling any model.
        let mut rerun = scenario.sim();
        for (tick, payload) in recorded_inputs(&run) {
            rerun
                .submit(tick, payload)
                .expect("the recorded input is in the future");
        }
        let mut reproduced = Vec::new();
        for _ in 0..TICKS {
            reproduced.push(rerun.step());
        }
        prop_assert_eq!(&reproduced, run.sim.checksums());

        // The replay file carries only the default Params. Stress runs still test
        // exact stream/checksum replay above; the file-format path uses a matching
        // default-Params run and checks its applied choices explicitly.
        let default_scenario = underworld_gen::Scenario::new(
            scenario.seed, scenario.residents, underworld_gen::ParamsChoice::Default,
        );
        let default_run = driven(default_scenario);
        let config = WorldConfig::try_new(scenario.residents).expect("config");
        let mut file = sim_core::replay::record(
            scenario.seed, config, &recorded_inputs(&default_run), TICKS,
        ).expect("a recorded default-Params run");
        prop_assert_eq!(&file.checksums, default_run.sim.checksums());
        sim_core::replay::verify(&file).expect("its own checksums verify");
        let tick = (choices % 64).min(file.checksums.len() - 1);
        file.checksums[tick].0 ^= 1;
        prop_assert!(matches!(sim_core::replay::verify(&file), Err(sim_core::replay::ReplayError::Diverged(_))));
    }

    // Feature: underworld, Property 18: Every new state field reaches the Checksum.
    #[test]
    fn property_18_every_new_state_field_reaches_the_checksum(
        scenario in underworld_gen::arb_scenario(),
        soul in any::<u64>(),
        part in any::<u8>(),
    ) {
        use sim_core::testing::{Mutation, apply};

        let run = driven(scenario);
        let base = run.world().clone();
        let mutations = [
            Mutation::JossBalance { soul },
            Mutation::JossCapCounter { soul, part },
            Mutation::SlotIdCounter,
            Mutation::AddSlot,
            Mutation::SlotBirth { slot: soul },
            Mutation::PlayerWait,
            Mutation::NodeRecordApplied { record: soul },
            Mutation::MagistrateTraits,
        ];
        let before = sim_core::checksum::Checksum::of(&base);
        let mut changed = 0;
        for mutation in mutations {
            let mut world = base.clone();
            if !apply(&mut world, mutation) {
                // The mutation has no target in this run (an empty slot list, no Wait).
                continue;
            }
            prop_assert_ne!(
                sim_core::checksum::Checksum::of(&world),
                before,
                "the mutation did not reach the Checksum"
            );
            changed += 1;
        }
        prop_assert!(changed > 0, "no mutation had a target");
    }

    // Feature: underworld, Property 19: Life-sim properties keep holding.
    #[test]
    fn property_19_life_sim_properties_keep_holding(scenario in underworld_gen::arb_scenario()) {
        use life_gen::CoreChecker;

        let mut run = Run::new(scenario);
        let mut core = CoreChecker::new(run.world());
        for _ in 0..TICKS {
            let (before, after, _planned) = run.step();
            core.after_tick(&before, &after);
            life_gen::check_structure(&after);
            sim_core::invariants::InvariantChecker::new(&after)
                .expect("the extended checker accepts the state");
        }
    }
}

proptest! {
    // Feature: underworld, Property 17: The extended Snapshot is faithful and read-only.
    #[test]
    fn property_17_the_extended_snapshot_is_faithful_and_read_only(
        scenario in underworld_gen::arb_scenario()
    ) {
        use sim_core::snapshot::snapshot_json;

        let mut run = Run::new(scenario);
        for _ in 0..TICKS {
            let before = run.world().clone();
            let (_b, after, _planned) = run.step();
            let checksum = sim_core::checksum::Checksum::of(&after);
            let json = snapshot_json(&after);
            // R13.5: a Snapshot is read-only.
            prop_assert_eq!(
                sim_core::checksum::Checksum::of(run.world()),
                checksum,
                "taking a Snapshot changed the Checksum"
            );
            prop_assert_eq!(snapshot_json(run.world()), json.clone());
            let value: serde_json::Value = serde_json::from_str(&json).expect("JSON");

            // R13.1: every Joss_Balance in Soul ID order.
            let joss = value["joss"].as_array().expect("joss array");
            prop_assert_eq!(joss.len(), after.souls().places.len());
            let expected: Vec<_> = after.joss().iter().collect();
            for (entry, (soul, account)) in joss.iter().zip(expected) {
                prop_assert_eq!(
                    entry["soul_id"].as_str().unwrap_or(""),
                    format!("S-{:04}", soul.0)
                );
                prop_assert_eq!(
                    entry["balance"].as_str().unwrap_or(""),
                    account.balance.to_string()
                );
            }
            // R13.2: exactly the open Birth_Slots in slot ID order.
            let slots = value["birth_slots"].as_array().expect("birth slots");
            prop_assert_eq!(slots.len(), after.slots().len());
            let claim = after.player_wait().and_then(|wait| wait.claim);
            for (entry, slot) in slots.iter().zip(after.slots().values()) {
                prop_assert_eq!(entry["id"].as_str().unwrap_or(""), slot.id.0.to_string());
                prop_assert_eq!(
                    entry["birth"].as_str().unwrap_or(""),
                    slot.birth.0.to_string()
                );
                prop_assert_eq!(entry["price"].as_str().unwrap_or(""), "0");
                let claimant = entry["claimant"].as_str().map(|s| s.to_owned());
                let expected_claimant =
                    (claim == Some(slot.id)).then(|| format!("S-{:04}", after.souls().player.0));
                prop_assert_eq!(claimant, expected_claimant);
            }
            // R13.3: both Standing_Slots, Imported first, exactly while it waits.
            let standing = value["standing_slots"].as_array().expect("standing slots");
            let wait = after.player_wait();
            prop_assert_eq!(standing.len(), if wait.is_some() { 2 } else { 0 });
            if let Some(wait) = wait {
                let params = *after.params();
                prop_assert_eq!(
                    standing[0]["kind"].as_str(),
                    Some("imported_vessel")
                );
                prop_assert_eq!(
                    standing[0]["price"].as_str().unwrap_or(""),
                    params.imported_price.to_string()
                );
                prop_assert_eq!(standing[1]["kind"].as_str(), Some("rebuilt_body"));
                prop_assert_eq!(
                    standing[1]["price"].as_str().unwrap_or(""),
                    params.rebuilt_price.to_string()
                );
                prop_assert_eq!(value["player_wait"]["ghost"].as_u64(), Some(wait.ghost.0));
                prop_assert_eq!(
                    value["player_wait"]["access_from"].as_str().unwrap_or(""),
                    wait.access_from.0.to_string()
                );
            } else {
                prop_assert!(value["player_wait"].is_null());
            }
            // R13.4: no pending node between ticks.
            prop_assert_eq!(
                value["pending_nodes"].as_array().expect("pending nodes").len(),
                after.nodes().pending.len()
            );
            // R15.13: the Magistrate in its own field, in none of the other lists.
            let magistrate = &value["magistrate"];
            prop_assert_eq!(
                magistrate["id"].as_u64(),
                Some(after.magistrate().id.0)
            );
            prop_assert_eq!(
                magistrate["soul_id"].as_str(),
                Some(sim_core::underworld::magistrate::SOUL_ID_TEXT)
            );
            let id = after.magistrate().id.0;
            for resident in value["residents"].as_array().expect("residents") {
                prop_assert_ne!(resident["id"].as_u64(), Some(id));
            }
            for soul in value["souls"].as_array().expect("souls") {
                prop_assert_ne!(
                    soul["soul_id"].as_str(),
                    Some(sim_core::underworld::magistrate::SOUL_ID_TEXT)
                );
            }
            // The tick's own state is unchanged by the Snapshot.
            prop_assert_eq!(before.tick().0.saturating_add(1), after.tick().0);
        }
    }
}
