//! Deterministic random-input generation for `record --random-inputs`.
//!
//! [`generate_inputs`] is a pure function of `(seed, count, ticks, opening_residents)`.
//! Input number `i` takes its numbers from `draw(seed, EntityId(i),
//! StreamTag::ToolingInputs, Tick(0), index)`: the entity slot carries the input's
//! ordinal, so adding inputs never changes earlier ones. `ToolingInputs` is never used
//! by the simulation itself, so these draws cannot alias a simulation stream.
//!
//! # Mix
//!
//! Each input rolls a bucket in `0..12`. `N` is `opening_residents`; the opening
//! Residents get Person IDs `1..=N`, so an unknown person is a high ID that no opening
//! Resident has.
//!
//! | roll | input | valid? |
//! |---|---|---|
//! | 0..=7 | `Act` with a random kind, actor and target in `1..=N`, intensity in `1..=100` | yes |
//! | 8 | `Act` whose actor is an unknown person (`N + 1000 + ...`) | no (`unknown_person`) |
//! | 9 | `Act` whose target is the actor | no (`self_target`) |
//! | 10 | `Act` with intensity 0 or `101..=255` | no (`intensity_out_of_range`) |
//! | 11 | `Act` with a random kind, actor and target in `1..=N`, valid intensity | maybe (`dead_person` late in a run) |
//!
//! Some "valid-looking" acts hit Persons who die later in the run, which is intended:
//! they then become `dead_person` rejections (design "inputs.rs").
//!
//! Inputs are returned in submission order, at ticks in `0..ticks` (so not sorted by
//! tick).

use sim_core::ids::{EntityId, Tick};
use sim_core::input::InputPayload;
use sim_core::rng::{StreamTag, below, draw};
use sim_core::values::SocialKind;

/// Number of buckets rolled per input (see the table above).
const BUCKETS: u64 = 12;
/// Unknown person IDs are `opening_residents + UNKNOWN_BASE + below(UNKNOWN_SPAN)`.
const UNKNOWN_BASE: u64 = 1000;
const UNKNOWN_SPAN: u64 = 1_000_000;

/// Fixed draw indices for one input; each draw site has its own constant (rng.rs rule).
const IDX_TICK: u64 = 0;
const IDX_BUCKET: u64 = 1;
const IDX_ACTOR: u64 = 2;
const IDX_TARGET: u64 = 3;
const IDX_SPREAD: u64 = 4;
const IDX_INTENSITY: u64 = 5;
const IDX_KIND: u64 = 6;

/// The six social kinds in card order.
const KINDS: [SocialKind; 6] = [
    SocialKind::Help,
    SocialKind::Gift,
    SocialKind::Quarrel,
    SocialKind::Insult,
    SocialKind::Theft,
    SocialKind::Apology,
];

/// `1 + below(x, n)`, a Person ID in `1..=n` (n >= 1).
fn person(x: u64, n: u64) -> u64 {
    1 + below(x, n.max(1))
}

/// A valid intensity in `1..=100`.
fn intensity(x: u64) -> u8 {
    // 1..=100 always fits a u8; the fallback is unreachable.
    u8::try_from(1 + below(x, 100)).unwrap_or(1)
}

/// Generates `count` inputs for a run of `ticks` ticks over a world that starts with
/// `opening_residents` Residents. Returns nothing if `ticks == 0` (there is no tick to
/// apply an input on).
pub fn generate_inputs(
    seed: u64,
    count: u64,
    ticks: u64,
    opening_residents: u64,
) -> Vec<(Tick, InputPayload)> {
    let mut inputs = Vec::new();
    if ticks == 0 {
        return inputs;
    }
    for i in 0..count {
        let d = |index: u64| draw(seed, EntityId(i), StreamTag::ToolingInputs, Tick(0), index);
        let tick = Tick(below(d(IDX_TICK), ticks));
        let bucket = below(d(IDX_BUCKET), BUCKETS);
        let (a, b, c) = (d(IDX_ACTOR), d(IDX_TARGET), d(IDX_SPREAD));

        let unknown = opening_residents
            .saturating_add(UNKNOWN_BASE)
            .saturating_add(below(a, UNKNOWN_SPAN));
        let actor = person(a, opening_residents);
        let target = person(b, opening_residents);
        let kind = KINDS[usize::try_from(below(d(IDX_KIND), 6)).unwrap_or(0)];

        let (actor, target, intensity) = match bucket {
            0..=7 | 11 => (actor, target, intensity(d(IDX_INTENSITY))),
            8 => (unknown, target, intensity(d(IDX_INTENSITY))),
            9 => (target, target, intensity(d(IDX_INTENSITY))),
            _ => {
                let bad = if c & 1 == 0 {
                    0
                } else {
                    // 101 + 0..=154 = 101..=255.
                    101 + below(c, 155)
                };
                (actor, target, u8::try_from(bad).unwrap_or(0))
            }
        };
        inputs.push((
            tick,
            InputPayload::Act {
                kind,
                actor: sim_core::ids::PersonId(actor),
                target: sim_core::ids::PersonId(target),
                intensity,
            },
        ));
    }
    inputs
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim_core::replay::record;
    use sim_core::world::{RejectReason, WorldConfig};

    fn config() -> WorldConfig {
        WorldConfig::try_new(50).unwrap()
    }

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
        assert_eq!(generate_inputs(1, 50, 1, 40).len(), 50);
        assert_eq!(generate_inputs(1, 50, 10, u64::MAX).len(), 50);
    }

    #[test]
    fn about_a_quarter_is_rejected_at_apply_time() {
        for seed in [1, 2, 3, u64::MAX] {
            let inputs = generate_inputs(seed, 120, 300, 50);
            let file = record(seed, config(), &inputs, 300).unwrap();
            let mut sim = sim_core::tick::Sim::new(seed, config()).unwrap();
            for (tick, payload) in &inputs {
                sim.submit(*tick, *payload).unwrap();
            }
            for _ in 0..file.ticks {
                sim.step();
            }
            let rejected: u64 = sim.world().rejections().count_by_reason.values().sum();
            // Nominal 30 of 120 (buckets 8, 9, 10), plus a few dead persons late in the
            // run; allow for sampling noise and a generous upper bound.
            assert!(
                (20..=80).contains(&rejected),
                "seed {seed}: {rejected} of 120 rejected"
            );
        }
    }

    #[test]
    fn all_rejection_reasons_that_inputs_can_cause_appear() {
        let inputs = generate_inputs(2, 240, 300, 50);
        let mut sim = sim_core::tick::Sim::new(2, config()).unwrap();
        for (tick, payload) in &inputs {
            sim.submit(*tick, *payload).unwrap();
        }
        for _ in 0..300 {
            sim.step();
        }
        let by = &sim.world().rejections().count_by_reason;
        assert!(by.contains_key(&RejectReason::UnknownPerson));
        assert!(by.contains_key(&RejectReason::SelfTarget));
        assert!(by.contains_key(&RejectReason::IntensityOutOfRange));
    }
}
