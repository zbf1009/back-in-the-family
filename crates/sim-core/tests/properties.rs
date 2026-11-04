//! Property-based tests P1–P7 (R9, R5.4), native only, using `proptest` 1.12.0.
//!
//! Every property runs on generated scenarios: a seed, a config (`entity_count` 0..=80,
//! both `days_per_tick`, both workloads) and 0..=40 inputs at ticks 0..=150 (valid and
//! invalid ids, in-range and out-of-range values), stepped for 150 ticks. Inputs are
//! submitted in generated order, not sorted by tick.
//!
//! proptest's own RNG only generates test INPUTS; it is test infrastructure outside the
//! simulation, which never uses `rand` (see the comment in `Cargo.toml`).
//!
//! # Re-running a failure
//!
//! proptest's default failure persistence is on: a failing case is appended to
//! `crates/sim-core/tests/properties.proptest-regressions` (next to this file; proptest
//! prints a harmless "failed to find lib.rs or main.rs" note because this is an
//! integration test). Commit that file: its cases are replayed first on every later
//! run. To re-run one property: `cargo test -p sim-core --test properties <name>`; the
//! failure output prints the minimal (shrunk) input.

use std::collections::BTreeSet;

use proptest::prelude::*;
use sim_core::checksum::Checksum;
use sim_core::ids::{EntityId, IdCounter, Tick};
use sim_core::input::{InputPayload, InputStream};
use sim_core::replay::{ReplayFile, record, verify};
use sim_core::testing::{self, Mutation};
use sim_core::tick::Sim;
use sim_core::world::{RejectReason, Workload, World, WorldConfig};

const TICKS: u64 = 150;

/// One generated run: seed, config and inputs in submission order.
#[derive(Clone, Debug)]
struct Scenario {
    seed: u64,
    config: WorldConfig,
    inputs: Vec<(Tick, InputPayload)>,
}

fn config_strategy() -> impl Strategy<Value = WorldConfig> {
    (
        0u16..=80,
        prop_oneof![Just(1u8), Just(7u8)],
        prop_oneof![Just(Workload::Light), Just(Workload::Pairwise)],
    )
        .prop_map(|(n, d, w)| WorldConfig::try_new(n, d, w).unwrap())
}

fn value_strategy() -> impl Strategy<Value = i32> {
    prop_oneof![
        6 => 0i32..=1000,
        2 => any::<i32>(),
        1 => prop_oneof![
            Just(i32::MIN),
            Just(i32::MAX),
            Just(-1),
            Just(1001),
            Just(0),
            Just(1000)
        ],
    ]
}

/// Entity ids: mostly ids that exist or could soon exist (`0..bound`), sometimes
/// arbitrary or huge.
fn entity_strategy(bound: u64) -> impl Strategy<Value = EntityId> {
    prop_oneof![
        6 => 0..bound,
        1 => any::<u64>(),
        1 => Just(u64::MAX),
    ]
    .prop_map(EntityId)
}

/// Payload with relative weights for `SetValue`, `Spawn` and `Despawn`.
fn payload_strategy(bound: u64, weights: (u32, u32, u32)) -> impl Strategy<Value = InputPayload> {
    prop_oneof![
        weights.0 => (entity_strategy(bound), value_strategy())
            .prop_map(|(entity, value)| InputPayload::SetValue { entity, value }),
        weights.1 => value_strategy().prop_map(|value| InputPayload::Spawn { value }),
        weights.2 => entity_strategy(bound)
            .prop_map(|entity| InputPayload::Despawn { entity }),
    ]
}

fn scenario_with(weights: (u32, u32, u32)) -> impl Strategy<Value = Scenario> {
    (any::<u64>(), config_strategy()).prop_flat_map(move |(seed, config)| {
        // Ids up to a little beyond the initial population, so valid targets are common.
        let bound = u64::from(config.entity_count).saturating_add(8);
        let input = (0u64..=TICKS, payload_strategy(bound, weights))
            .prop_map(|(tick, payload)| (Tick(tick), payload));
        proptest::collection::vec(input, 0..=40).prop_map(move |inputs| Scenario {
            seed,
            config,
            inputs,
        })
    })
}

fn scenario() -> impl Strategy<Value = Scenario> {
    scenario_with((4, 2, 2))
}

/// A sim with all of the scenario's inputs submitted (nothing stepped yet).
fn build(s: &Scenario) -> Sim {
    let mut sim = Sim::new(s.seed, s.config).unwrap();
    for &(tick, payload) in &s.inputs {
        sim.submit(tick, payload).unwrap();
    }
    sim
}

fn cfg(cases: u32) -> ProptestConfig {
    ProptestConfig::with_cases(cases)
}

proptest! {
    #![proptest_config(cfg(128))]

    /// P1 Reproducibility (R9.1): two independent sims agree on every checksum and on
    /// the final world.
    #[test]
    fn p1_reproducibility(s in scenario()) {
        let (mut a, mut b) = (build(&s), build(&s));
        for _ in 0..TICKS {
            a.step();
            b.step();
        }
        prop_assert_eq!(a.checksums(), b.checksums());
        prop_assert_eq!(a.world(), b.world());
        prop_assert_eq!(a.checksums().len() as u64, TICKS);
    }

    /// P2 Replay round trip (R9.2): record, JSON, parse, verify.
    #[test]
    fn p2_replay_round_trip(s in scenario()) {
        let file = record(s.seed, s.config, &s.inputs, TICKS).unwrap();
        let json = file.to_json_string().unwrap();
        let parsed = ReplayFile::from_json_str(&json).unwrap();
        prop_assert_eq!(verify(&parsed), Ok(()));
    }

    /// P3 Serialization round trip (R9.3). `InputStream` has no serialization of its
    /// own; the replay file is it. The parsed file equals the original, its text is
    /// stable, and re-submitting the parsed inputs rebuilds an equal `InputStream`.
    #[test]
    fn p3_serialization_round_trip(s in scenario(), ticks in 0u64..=40) {
        let file = record(s.seed, s.config, &s.inputs, ticks).unwrap();
        let json = file.to_json_string().unwrap();
        let parsed = ReplayFile::from_json_str(&json).unwrap();
        prop_assert_eq!(&parsed, &file);
        prop_assert_eq!(parsed.to_json_string().unwrap(), json);

        let mut original = InputStream::new();
        for &(tick, payload) in &s.inputs {
            original.submit(Tick(0), tick, payload).unwrap();
        }
        let mut rebuilt = InputStream::new();
        for input in &parsed.inputs {
            rebuilt
                .submit(Tick(0), Tick(input.tick), input.payload.into())
                .unwrap();
        }
        prop_assert_eq!(rebuilt.all(), original.all());
        prop_assert_eq!(&rebuilt, &original);
    }
}

/// Original entity ids: those that exist at construction.
fn original_ids(config: &WorldConfig) -> Vec<EntityId> {
    (0..u64::from(config.entity_count)).map(EntityId).collect()
}

/// Asserts that, for every id in `ids` (after tick `t`), both worlds agree on presence,
/// on `value`, and on the affinity toward every other id in `ids` that is present.
fn assert_shared_state_equal(
    a: &Sim,
    b: &Sim,
    ids: &[EntityId],
    t: u64,
) -> Result<(), TestCaseError> {
    let (wa, wb) = (a.world().entities(), b.world().entities());
    for &id in ids {
        let (ea, eb) = (wa.get(&id), wb.get(&id));
        prop_assert_eq!(
            ea.is_some(),
            eb.is_some(),
            "presence of {:?} after tick {}",
            id,
            t
        );
        let (Some(ea), Some(eb)) = (ea, eb) else {
            continue;
        };
        prop_assert_eq!(ea.value, eb.value, "value of {:?} after tick {}", id, t);
        for &other in ids {
            if other == id || !wa.contains_key(&other) {
                continue;
            }
            prop_assert_eq!(
                ea.affinity.get(&other),
                eb.affinity.get(&other),
                "affinity {:?} -> {:?} after tick {}",
                id,
                other,
                t
            );
        }
    }
    Ok(())
}

proptest! {
    #![proptest_config(cfg(64))]

    /// P4a Stream independence (R9.4), as specified in the design: an extra `Spawn` at
    /// tick 0 (submitted first, so it takes the first free id in world B) changes
    /// nothing about the original entities' values or their affinities toward each
    /// other, after every tick. Entities spawned by generated inputs get different ids
    /// in A and B, and the extra entity exists only in B, so the comparison is
    /// restricted to ids `0..entity_count`.
    ///
    /// Limit found by fault injection: the extra entity always has the LARGEST id, so
    /// it never shifts the iteration position of an original. A draw keyed by the loop
    /// position instead of the entity id goes undetected here; P4b covers that.
    #[test]
    fn p4a_stream_independence_extra_spawn(s in scenario(), extra_value in 0i32..=1000) {
        let mut a = build(&s);
        let mut b = Sim::new(s.seed, s.config).unwrap();
        b.submit(Tick(0), InputPayload::Spawn { value: extra_value }).unwrap();
        for &(tick, payload) in &s.inputs {
            b.submit(tick, payload).unwrap();
        }
        let originals = original_ids(&s.config);
        for t in 0..TICKS {
            a.step();
            b.step();
            assert_shared_state_equal(&a, &b, &originals, t)?;
        }
        // Not vacuous: B issued exactly one more id than A (the extra spawn).
        prop_assert_eq!(b.world().next_entity_id(), a.world().next_entity_id() + 1);
    }

    /// P4b Stream independence with a LOWER-id extra entity, so that it shifts the
    /// iteration position of every other entity. Both worlds are built with
    /// `entity_count + 1` entities; world A despawns entity 0 first thing at tick 0 and
    /// world B keeps it. Id counters match, so every other entity (initial or spawned
    /// by a generated input) has the same id in both worlds and is compared after
    /// every tick. Entity 0 itself and affinities toward it are not compared.
    #[test]
    fn p4b_stream_independence_lower_id_entity(s in scenario()) {
        let config = WorldConfig::try_new(
            s.config.entity_count + 1,
            s.config.days_per_tick,
            s.config.workload,
        )
        .unwrap();
        let mut a = Sim::new(s.seed, config).unwrap();
        a.submit(Tick(0), InputPayload::Despawn { entity: EntityId(0) }).unwrap();
        let mut b = Sim::new(s.seed, config).unwrap();
        for &(tick, payload) in &s.inputs {
            a.submit(tick, payload).unwrap();
            b.submit(tick, payload).unwrap();
        }
        for t in 0..TICKS {
            a.step();
            b.step();
            let ids: Vec<EntityId> = a
                .world()
                .entities()
                .keys()
                .chain(b.world().entities().keys())
                .copied()
                .filter(|id| id.0 != 0)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            assert_shared_state_equal(&a, &b, &ids, t)?;
        }
        prop_assert_eq!(a.world().next_entity_id(), b.world().next_entity_id());
        prop_assert!(!a.world().entities().contains_key(&EntityId(0)));
    }
}

fn mutation_strategy() -> impl Strategy<Value = Mutation> {
    prop_oneof![
        any::<u8>().prop_map(|bit| Mutation::Seed { bit }),
        Just(Mutation::ConfigEntityCount),
        Just(Mutation::ConfigDaysPerTick),
        Just(Mutation::ConfigWorkload),
        Just(Mutation::Tick),
        Just(Mutation::EntityIdCounter),
        (any::<u64>(), any::<bool>()).prop_map(|(entity, up)| Mutation::EntityValue { entity, up }),
        any::<u64>().prop_map(|entity| Mutation::EntityIdField { entity }),
        (any::<u64>(), any::<u64>(), any::<bool>())
            .prop_map(|(entity, other, up)| Mutation::Affinity { entity, other, up }),
        Just(Mutation::AddEntity),
        any::<u64>().prop_map(|entity| Mutation::RemoveEntity { entity }),
        prop_oneof![
            Just(RejectReason::UnknownEntity),
            Just(RejectReason::ValueOutOfRange),
            Just(RejectReason::IdExhausted)
        ]
        .prop_map(|reason| Mutation::RejectionCount { reason }),
        any::<u8>().prop_map(|part| Mutation::RejectionLast { part }),
    ]
}

proptest! {
    #![proptest_config(cfg(128))]

    /// P5 Checksum sensitivity (R9.5, R5.4): after `k` ticks, one single-field mutation
    /// changes the world and therefore the checksum.
    #[test]
    fn p5_checksum_sensitivity(
        s in scenario(),
        k in 0u64..=40,
        mutation in mutation_strategy(),
    ) {
        let mut sim = build(&s);
        for _ in 0..k {
            sim.step();
        }
        let original: World = sim.world().clone();
        let mut mutated = original.clone();
        // Entity mutations have no target in a world without entities; the world-level
        // `Tick` mutation stands in so every case still tests something.
        if !testing::apply(&mut mutated, mutation) {
            prop_assert!(original.entities().is_empty());
            prop_assert!(testing::apply(&mut mutated, Mutation::Tick));
        }
        prop_assert_ne!(&mutated, &original, "mutation {:?} changed nothing", mutation);
        prop_assert_ne!(
            Checksum::of(&mutated),
            Checksum::of(&original),
            "mutation {:?} did not change the checksum",
            mutation
        );
    }
}

proptest! {
    #![proptest_config(cfg(256))]

    /// P6a IdCounter alone: strictly increasing values from any start, no wrap at the
    /// top, and a failed `next()` leaves the counter unchanged.
    #[test]
    fn p6a_id_counter_monotonic(
        start in prop_oneof![0u64..1000, (u64::MAX - 40)..=u64::MAX, any::<u64>()],
        calls in 0usize..80,
    ) {
        let mut counter = IdCounter::starting_at(start);
        let mut last: Option<u64> = None;
        let mut exhausted = false;
        for _ in 0..calls {
            let before = counter.peek();
            match counter.next() {
                Ok(id) => {
                    prop_assert!(!exhausted, "issued an id after exhaustion");
                    prop_assert_eq!(id, before);
                    if let Some(prev) = last {
                        prop_assert!(id > prev);
                    }
                    prop_assert!(counter.peek() > id);
                    last = Some(id);
                }
                Err(_) => {
                    exhausted = true;
                    prop_assert_eq!(counter.peek(), before);
                }
            }
        }
    }
}

proptest! {
    #![proptest_config(cfg(128))]

    /// P6b IDs through the sim, with spawn/despawn-heavy inputs: new ids are strictly
    /// greater than every id seen before, the counter never decreases, every live id is
    /// below the counter, and a despawned id never reappears.
    #[test]
    fn p6b_entity_ids_monotonic(s in scenario_with((1, 5, 5))) {
        let mut sim = build(&s);
        let mut ever_seen: BTreeSet<EntityId> = sim.world().entities().keys().copied().collect();
        let mut max_seen = ever_seen.last().copied();
        let mut previous = ever_seen.clone();
        let mut gone: BTreeSet<EntityId> = BTreeSet::new();
        let mut counter = sim.world().next_entity_id();
        for _ in 0..TICKS {
            sim.step();
            let now: BTreeSet<EntityId> = sim.world().entities().keys().copied().collect();
            prop_assert!(sim.world().next_entity_id() >= counter);
            counter = sim.world().next_entity_id();
            for id in &now {
                prop_assert!(id.0 < counter, "{:?} not below counter {}", id, counter);
                prop_assert!(!gone.contains(id), "despawned {:?} reappeared", id);
            }
            // Ascending order: each new id must exceed all earlier ones, including the
            // new ids issued earlier in this same tick.
            for id in now.difference(&ever_seen) {
                if let Some(m) = max_seen {
                    prop_assert!(*id > m, "new {:?} not above earlier max {:?}", id, m);
                }
                max_seen = Some(*id);
            }
            gone.extend(previous.difference(&now).copied());
            ever_seen.extend(now.iter().copied());
            previous = now;
        }
    }
}

proptest! {
    #![proptest_config(cfg(128))]

    /// P7 Semantic invariants (R9.7): `check_invariants` passes before the first tick
    /// and after every tick.
    #[test]
    fn p7_semantic_invariants(s in scenario()) {
        let mut sim = build(&s);
        prop_assert_eq!(sim.world().check_invariants(), Ok(()));
        for t in 0..TICKS {
            sim.step();
            prop_assert_eq!(sim.world().check_invariants(), Ok(()), "after tick {}", t);
        }
    }
}
