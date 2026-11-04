//! Counter-based random streams (decision D2).
//!
//! There is no generator state. Every random number is a pure function of five
//! inputs, `draw(seed, entity, tag, tick, index)`, so draws can happen in any order,
//! adding an entity never shifts another entity's numbers, and nothing needs to be
//! stored, checksummed or restored after a load. Output is identical on native and
//! `wasm32` because only 64-bit wrapping integer operations are used.
//!
//! Each draw site must choose its own `index` for a given `(entity, tag, tick)`;
//! reusing an index repeats the number.

use crate::ids::{EntityId, Tick};

/// Names a random stream. The numeric values are permanent: never renumber or reuse
/// one, because they are folded into every draw and changing them changes history.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
#[repr(u8)]
pub enum StreamTag {
    /// Per-tick value drift of an entity.
    Drift = 1,
    /// Per-tick affinity change between a pair of entities.
    Affinity = 2,
    /// **Tooling only; the simulation never draws from this stream.** `sim-cli record
    /// --random-inputs` uses it to generate test inputs from a seed. It exists so that
    /// tooling can never alias a simulation stream. Value 3 is permanent like the others.
    ToolingInputs = 3,
}

// Distinct odd multipliers, one per input position (seed, entity, tag, tick, index).
const K_SEED: u64 = 0xA24B_AED4_963E_E407;
const K_ENTITY: u64 = 0x9FB2_1C65_1E98_DF25;
const K_TAG: u64 = 0xD6E8_FEB8_6659_FD93;
const K_TICK: u64 = 0xC2B2_AE3D_27D4_EB4F;
const K_INDEX: u64 = 0x1656_67B1_9E37_79F9;

/// Starting value of the fold (the 64-bit golden-ratio constant).
const INIT: u64 = 0x9E37_79B9_7F4A_7C15;

/// SplitMix64-style finalizer: two xor-shift/multiply rounds and a final xor-shift.
/// Every output bit depends on every input bit.
const fn mix(z: u64) -> u64 {
    let z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    let z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// One fold step: multiply the input by its position constant, xor into the running
/// value, and mix.
const fn fold(h: u64, input: u64, k: u64) -> u64 {
    mix(h ^ input.wrapping_mul(k))
}

/// The random number for `(seed, entity, tag, tick, index)`.
///
/// Pure and total: the same five inputs always give the same output, on every platform,
/// and it never panics. The inputs are folded in the fixed order seed, entity, tag,
/// tick, index.
pub fn draw(seed: u64, entity: EntityId, tag: StreamTag, tick: Tick, index: u64) -> u64 {
    let h = fold(INIT, seed, K_SEED);
    let h = fold(h, entity.0, K_ENTITY);
    let h = fold(h, u64::from(tag as u8), K_TAG);
    let h = fold(h, tick.0, K_TICK);
    fold(h, index, K_INDEX)
}

/// Maps `x` (a uniform 64-bit value) onto `0..n` by multiplying in 128 bits and taking
/// the high 64 bits: `(x * n) >> 64`.
///
/// There is no rejection loop, so the cost is constant. The price is a small bias: each
/// result is hit by either `floor(2^64 / n)` or `ceil(2^64 / n)` inputs, so the
/// probability of any result differs from `1/n` by less than `1/2^64`, and the
/// relative bias is at most `n / 2^64`. All ranges used by the simulation are far
/// below 2^16, where this is negligible.
///
/// `x == 0` gives 0 and `x == u64::MAX` gives `n - 1`.
///
/// # Panics
/// If `n == 0`: an empty range has no valid result, and passing it is a caller bug.
pub fn below(x: u64, n: u64) -> u64 {
    assert!(n != 0, "below(): n must be non-zero");
    // The product of two u64 values always fits in u128, so `wrapping_mul` is exact.
    let wide = u128::from(x).wrapping_mul(u128::from(n)) >> 64;
    // `x <= u64::MAX` gives `wide <= n - 1`, so this always fits.
    u64::try_from(wide).expect("high half of a 64x64-bit product fits in u64")
}

/// Maps `x` onto the inclusive range `lo..=hi`, built on [`below`] (same bias bound,
/// with `n = hi - lo + 1`). The full `i64` range is supported: it needs 2^64 values,
/// which `below` cannot take, so that single case returns `x` reinterpreted as an
/// offset (exactly uniform).
///
/// # Panics
/// If `hi < lo`: an empty range is a caller bug.
pub fn in_range(x: u64, lo: i64, hi: i64) -> i64 {
    assert!(lo <= hi, "in_range(): lo must not exceed hi");
    // `hi - lo` as an unsigned distance; wrapping subtraction gives the exact value
    // because hi >= lo, even when the true difference exceeds i64::MAX.
    let width = hi.wrapping_sub(lo) as u64;
    let offset = match width.checked_add(1) {
        Some(count) => below(x, count),
        None => x, // width == u64::MAX: the whole i64 range
    };
    // Adding the offset to `lo` cannot leave `lo..=hi`; two's-complement wrapping makes
    // the sum exact even when `offset` exceeds i64::MAX.
    lo.wrapping_add(offset as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const E: EntityId = EntityId(3);
    const T: Tick = Tick(10);

    #[test]
    fn stream_tag_values_are_permanent() {
        assert_eq!(StreamTag::Drift as u8, 1);
        assert_eq!(StreamTag::Affinity as u8, 2);
        assert_eq!(StreamTag::ToolingInputs as u8, 3);
    }

    #[test]
    fn draw_pinned_outputs() {
        // Regression pins: if these change, every recorded history changes.
        let cases: [(u64, EntityId, StreamTag, Tick, u64, u64); 4] = [
            (
                0,
                EntityId(0),
                StreamTag::Drift,
                Tick(0),
                0,
                0x96E7_C3AB_4C46_8327,
            ),
            (
                1,
                EntityId(0),
                StreamTag::Drift,
                Tick(0),
                0,
                0x62DB_2EAA_C058_5BE9,
            ),
            (
                12345,
                EntityId(7),
                StreamTag::Affinity,
                Tick(100),
                9,
                0xBFC1_0C01_63EC_16CF,
            ),
            (
                u64::MAX,
                EntityId(u64::MAX),
                StreamTag::Affinity,
                Tick(u64::MAX),
                u64::MAX,
                0xF06C_331C_A2E0_82C4,
            ),
        ];
        for (seed, e, tag, t, idx, want) in cases {
            assert_eq!(
                draw(seed, e, tag, t, idx),
                want,
                "{seed} {e:?} {tag:?} {t:?} {idx}"
            );
        }
    }

    #[test]
    fn draw_changes_when_any_single_input_changes() {
        let base = draw(42, E, StreamTag::Drift, T, 5);
        assert_eq!(base, draw(42, E, StreamTag::Drift, T, 5));
        for seed in [0, 41, 43, u64::MAX] {
            assert_ne!(draw(seed, E, StreamTag::Drift, T, 5), base, "seed {seed}");
        }
        for ent in [0, 2, 4, u64::MAX] {
            assert_ne!(
                draw(42, EntityId(ent), StreamTag::Drift, T, 5),
                base,
                "entity {ent}"
            );
        }
        assert_ne!(draw(42, E, StreamTag::Affinity, T, 5), base, "tag");
        for tick in [0, 9, 11, u64::MAX] {
            assert_ne!(
                draw(42, E, StreamTag::Drift, Tick(tick), 5),
                base,
                "tick {tick}"
            );
        }
        for index in [0, 4, 6, u64::MAX] {
            assert_ne!(
                draw(42, E, StreamTag::Drift, T, index),
                base,
                "index {index}"
            );
        }
    }

    #[test]
    fn below_boundaries() {
        for n in [1, 2, 7, 1000, u64::MAX] {
            assert_eq!(below(0, n), 0);
            assert_eq!(below(u64::MAX, n), n.wrapping_sub(1));
        }
        for x in [0, 1, u64::MAX / 3, u64::MAX / 2, u64::MAX] {
            for n in [1, 2, 3, 10, 1 << 32] {
                assert!(below(x, n) < n);
            }
        }
        assert_eq!(below(1 << 63, 2), 1);
        assert_eq!(below((1 << 63) - 1, 2), 0);
    }

    #[test]
    #[should_panic(expected = "n must be non-zero")]
    fn below_zero_panics() {
        below(1, 0);
    }

    #[test]
    fn in_range_stays_inside_bounds() {
        let pairs = [
            (0, 0),
            (-5, -5),
            (-10, 10),
            (-3, 3),
            (0, 1000),
            (-100, 100),
            (i64::MIN, i64::MIN),
            (i64::MAX, i64::MAX),
            (i64::MIN, i64::MAX),
            (i64::MIN, 0),
            (0, i64::MAX),
            (i64::MIN, i64::MAX.wrapping_sub(1)),
        ];
        let xs = [
            0,
            1,
            u64::MAX / 3,
            1 << 63,
            u64::MAX.wrapping_sub(1),
            u64::MAX,
        ];
        for (lo, hi) in pairs {
            for x in xs {
                let r = in_range(x, lo, hi);
                assert!((lo..=hi).contains(&r), "x={x} lo={lo} hi={hi} r={r}");
            }
            assert_eq!(in_range(0, lo, hi), lo, "x=0 hits lo");
        }
        assert_eq!(in_range(u64::MAX, -3, 3), 3);
        assert_eq!(in_range(u64::MAX, i64::MIN, i64::MAX), i64::MAX);
        assert_eq!(in_range(5, 9, 9), 9);
    }

    #[test]
    #[should_panic(expected = "lo must not exceed hi")]
    fn in_range_empty_panics() {
        in_range(0, 1, 0);
    }
}
