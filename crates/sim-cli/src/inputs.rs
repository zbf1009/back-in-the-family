//! Deterministic random-input generation for `record --random-inputs`.
//!
//! [`generate_inputs`] is a pure function of `(seed, count, ticks, entity_count)`. Input
//! number `i` takes its numbers from `draw(seed, EntityId(i), StreamTag::ToolingInputs,
//! Tick(0), index)`: the entity slot carries the input's ordinal, so adding inputs never
//! changes earlier ones. `ToolingInputs` is never used by the simulation itself, so
//! these draws cannot alias a simulation stream.
//!
//! # Mix
//!
//! Each input rolls a kind in `0..12`, so exactly one third of the nominal mix is
//! invalid at apply time:
//!
//! | roll | input | valid? |
//! |---|---|---|
//! | 0..=4 | `SetValue` on an initial entity, value in `0..=1000` | yes |
//! | 5..=6 | `Spawn` with value in `0..=1000` | yes |
//! | 7 | `Despawn` of an initial entity | yes (invalid if already despawned) |
//! | 8 | `SetValue` on an unknown entity (`entity_count + 1000 + ...`) | no |
//! | 9 | `SetValue` on an initial entity, value below 0 or above 1000 | no |
//! | 10 | `Spawn` with value below 0 or above 1000 | no |
//! | 11 | `Despawn` of an unknown entity | no |
//!
//! Inputs are returned in submission order, at ticks in `0..ticks` (so not sorted by
//! tick). With `entity_count == 0` there is no initial entity, so "initial entity"
//! targets become unknown ones.

use sim_core::ids::{EntityId, Tick};
use sim_core::input::InputPayload;
use sim_core::rng::{StreamTag, below, draw};

/// Number of kinds rolled per input (see the table above).
const KINDS: u64 = 12;
/// Unknown entity ids are `entity_count + UNKNOWN_BASE + below(UNKNOWN_SPAN)`.
const UNKNOWN_BASE: u64 = 1000;
const UNKNOWN_SPAN: u64 = 1_000_000;

/// `below(x, n)` as an `i32`, for `n <= 2^31`.
fn small(x: u64, n: u64) -> i32 {
    // below() < n <= 2^31 always fits; the fallback is unreachable.
    i32::try_from(below(x, n)).unwrap_or(0)
}

/// Generates `count` inputs for a run of `ticks` ticks over a world that starts with
/// `entity_count` entities. Returns nothing if `ticks == 0` (there is no tick to apply
/// an input on).
pub fn generate_inputs(
    seed: u64,
    count: u64,
    ticks: u64,
    entity_count: u64,
) -> Vec<(Tick, InputPayload)> {
    let mut inputs = Vec::new();
    if ticks == 0 {
        return inputs;
    }
    for i in 0..count {
        let d = |index: u64| draw(seed, EntityId(i), StreamTag::ToolingInputs, Tick(0), index);
        let tick = Tick(below(d(0), ticks));
        let kind = below(d(1), KINDS);
        let (a, b, c) = (d(2), d(3), d(4));

        let unknown = EntityId(
            entity_count
                .saturating_add(UNKNOWN_BASE)
                .saturating_add(below(a, UNKNOWN_SPAN)),
        );
        let initial = if entity_count == 0 {
            unknown
        } else {
            EntityId(below(a, entity_count))
        };
        let good_value = small(b, 1001);
        let bad_value = if c & 1 == 0 {
            -1 - small(b, 1000)
        } else {
            1001 + small(b, 1000)
        };

        let payload = match kind {
            0..=4 => InputPayload::SetValue {
                entity: initial,
                value: good_value,
            },
            5 | 6 => InputPayload::Spawn { value: good_value },
            7 => InputPayload::Despawn { entity: initial },
            8 => InputPayload::SetValue {
                entity: unknown,
                value: good_value,
            },
            9 => InputPayload::SetValue {
                entity: initial,
                value: bad_value,
            },
            10 => InputPayload::Spawn { value: bad_value },
            _ => InputPayload::Despawn { entity: unknown },
        };
        inputs.push((tick, payload));
    }
    inputs
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim_core::replay::record;
    use sim_core::world::{Workload, WorldConfig};

    #[test]
    fn is_a_pure_function_of_its_arguments() {
        let a = generate_inputs(5, 200, 1000, 50);
        assert_eq!(a, generate_inputs(5, 200, 1000, 50));
        assert_ne!(a, generate_inputs(6, 200, 1000, 50));
        assert_eq!(a.len(), 200);
    }

    #[test]
    fn earlier_inputs_do_not_change_when_more_are_requested() {
        let short = generate_inputs(9, 30, 500, 50);
        let long = generate_inputs(9, 60, 500, 50);
        assert_eq!(short[..], long[..30]);
    }

    #[test]
    fn ticks_stay_in_range_and_are_not_sorted() {
        let inputs = generate_inputs(3, 300, 40, 50);
        assert!(inputs.iter().all(|(t, _)| t.0 < 40));
        assert!(inputs.windows(2).any(|w| w[0].0 > w[1].0));
    }

    #[test]
    fn degenerate_arguments_do_not_panic() {
        assert!(generate_inputs(1, 0, 100, 50).is_empty());
        assert!(generate_inputs(1, 10, 0, 50).is_empty());
        assert_eq!(generate_inputs(1, 50, 1, 0).len(), 50);
        assert_eq!(generate_inputs(1, 50, 10, u64::MAX).len(), 50);
    }

    #[test]
    fn about_one_third_is_rejected_at_apply_time() {
        let config = WorldConfig::try_new(50, Workload::Pairwise).unwrap();
        for seed in [1, 2, 3, u64::MAX] {
            let inputs = generate_inputs(seed, 120, 300, 50);
            let file = record(seed, config, &inputs, 300).unwrap();
            let mut sim = sim_core::tick::Sim::new(seed, config).unwrap();
            for (tick, payload) in &inputs {
                sim.submit(*tick, *payload).unwrap();
            }
            for _ in 0..file.ticks {
                sim.step();
            }
            let rejected: u64 = sim.world().rejections().count_by_reason.values().sum();
            // Nominal 40 of 120; allow for sampling noise and duplicate despawns.
            assert!(
                (24..=70).contains(&rejected),
                "seed {seed}: {rejected} of 120 rejected"
            );
        }
    }

    #[test]
    fn all_rejection_reasons_that_inputs_can_cause_appear() {
        use sim_core::world::RejectReason;
        let config = WorldConfig::try_new(50, Workload::Pairwise).unwrap();
        let inputs = generate_inputs(2, 240, 300, 50);
        let mut sim = sim_core::tick::Sim::new(2, config).unwrap();
        for (tick, payload) in &inputs {
            sim.submit(*tick, *payload).unwrap();
        }
        for _ in 0..300 {
            sim.step();
        }
        let by = &sim.world().rejections().count_by_reason;
        assert!(by.contains_key(&RejectReason::UnknownEntity));
        assert!(by.contains_key(&RejectReason::ValueOutOfRange));
    }
}
