//! Tunable numeric parameters (design "Parameters and calibration", OP-5).
//!
//! Every per-day probability is in parts per million: a roll succeeds when
//! `rng::below(draw, 1_000_000) < ppm`. Money is in dollars and durations are in days.
//! `Params` is part of the World and of the canonical encoding, so a test world with a
//! different Params can never be confused with a default one.

use crate::canon::{Canon, CanonWriter};

/// Age at which mortality is certain (R6.2).
pub const CERTAIN_DEATH_AGE: u16 = 120;
/// Mortality rate reported at [`CERTAIN_DEATH_AGE`] and above: every roll succeeds.
pub const CERTAIN_MORTALITY_PPM: u32 = 1_000_000;

/// The simulation's numeric parameters.
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub struct Params {
    /// Mortality in ppm per day, indexed by age in years (`0..=119`). Age 120 is
    /// certain and handled by [`Params::mortality_ppm`].
    pub mortality_ppm_by_age: [u32; 120],
    /// Daily birth chance of a female Resident aged 18..=45 with a living spouse.
    pub birth_ppm_married: u32,
    /// Daily birth chance of a female Resident aged 18..=45 without one.
    pub birth_ppm_unmarried: u32,
    /// Longest a Soul may wait before release into an outsider body (R11.3).
    pub max_wait: u64,
    /// Souls waiting at World creation, besides the ones in opening bodies.
    pub initial_waiting: u64,
    /// Daily chance that one world-level marriage roll succeeds.
    pub marriage_ppm: u32,
    /// Daily chance that one world-level loan roll succeeds.
    pub loan_ppm: u32,
    /// A borrower's balance must be below this to take a loan.
    pub loan_need_below: u64,
    /// A lender's balance must be at least this to give one.
    pub loan_lender_min: u64,
    /// Chance that one daily social roll produces an Event.
    pub social_ppm: u32,
    /// Social rolls per day (step 9 of the tick).
    pub social_rolls_per_day: u32,
    /// Daily wage range of a Resident aged 18..=67.
    pub wage_min: u16,
    /// Upper end of the daily wage range.
    pub wage_max: u16,
    /// Daily upkeep paid by every Resident aged 18+.
    pub upkeep: u64,
    /// Affinity below this sets the `rival` tag (OP-5).
    pub grudge_threshold: i8,
    /// Affinity at or above this sets the `friend` tag (OP-5).
    pub friend_at: i8,
    /// Affinity of a new spouse Relation (initial kin scores).
    pub spouse_affinity: i8,
    /// Trust of a new spouse Relation.
    pub spouse_trust: i8,
    /// Affinity of a `parent`/`child` Relation.
    pub parent_child_affinity: i8,
    /// Trust of a `parent`/`child` Relation.
    pub parent_child_trust: i8,
    /// Affinity between siblings.
    pub sibling_affinity: i8,
    /// Trust between siblings.
    pub sibling_trust: i8,
    /// Affinity between grandparents and grandchildren.
    pub grandparent_affinity: i8,
    /// Trust between grandparents and grandchildren.
    pub grandparent_trust: i8,
    /// Chance that a released Soul gets a Rebuilt_Body instead of an Imported_Vessel.
    pub rebuilt_share_ppm: u32,
    /// Minimum age of an arriving outsider body (R11.2).
    pub outsider_age_min: u16,
    /// Maximum age of an arriving outsider body.
    pub outsider_age_max: u16,
}

/// The default mortality table: `15` at birth, `1` for ages 1..=17, then rising bands
/// (`3`, `10`, `40`, `110`, `300`, `800`, `2_000`). Age 120 is certain and is not stored.
const fn default_mortality_ppm_by_age() -> [u32; 120] {
    let mut table = [0u32; 120];
    table[0] = 15;
    let mut i = 1;
    while i < 18 {
        table[i] = 1;
        i = i.wrapping_add(1);
    }
    while i < 40 {
        table[i] = 3;
        i = i.wrapping_add(1);
    }
    while i < 60 {
        table[i] = 10;
        i = i.wrapping_add(1);
    }
    while i < 70 {
        table[i] = 40;
        i = i.wrapping_add(1);
    }
    while i < 80 {
        table[i] = 110;
        i = i.wrapping_add(1);
    }
    while i < 90 {
        table[i] = 300;
        i = i.wrapping_add(1);
    }
    while i < 100 {
        table[i] = 800;
        i = i.wrapping_add(1);
    }
    while i < 120 {
        table[i] = 2_000;
        i = i.wrapping_add(1);
    }
    table
}

/// The default table with every rate multiplied by `factor`, saturating at the maximum
/// ppm so that a stress value never exceeds a certain roll.
const fn scaled_mortality_ppm_by_age(factor: u32) -> [u32; 120] {
    let base = default_mortality_ppm_by_age();
    let mut table = [0u32; 120];
    let mut i = 0;
    while i < 120 {
        let scaled = base[i].wrapping_mul(factor);
        table[i] = if scaled > CERTAIN_MORTALITY_PPM {
            CERTAIN_MORTALITY_PPM
        } else {
            scaled
        };
        i = i.wrapping_add(1);
    }
    table
}

impl Params {
    /// The calibrated defaults of design "Parameters and calibration".
    pub const DEFAULT: Self = Self {
        mortality_ppm_by_age: default_mortality_ppm_by_age(),
        birth_ppm_married: 500,
        birth_ppm_unmarried: 50,
        max_wait: 1_095,
        initial_waiting: 2,
        marriage_ppm: 2_000,
        loan_ppm: 33_000,
        loan_need_below: 2_000,
        loan_lender_min: 5_000,
        social_ppm: 300_000,
        social_rolls_per_day: 1,
        wage_min: 20,
        wage_max: 60,
        upkeep: 30,
        grudge_threshold: -40,
        friend_at: 50,
        spouse_affinity: 60,
        spouse_trust: 60,
        parent_child_affinity: 50,
        parent_child_trust: 50,
        sibling_affinity: 30,
        sibling_trust: 30,
        grandparent_affinity: 40,
        grandparent_trust: 40,
        rebuilt_share_ppm: 200_000,
        outsider_age_min: 18,
        outsider_age_max: 40,
    };

    /// Raised rates for short property-test runs: deaths, births, releases, debts at
    /// death and remarriages all occur within 240 ticks.
    ///
    /// Only rates and waits change; the thresholds, kin scores, wage and upkeep stay at
    /// their defaults, so the same code paths are exercised with the same bounds.
    #[cfg(any(test, feature = "test-support"))]
    pub fn stress() -> Self {
        let mut params = Self::DEFAULT;
        params.mortality_ppm_by_age = scaled_mortality_ppm_by_age(50);
        params.birth_ppm_married = 100_000;
        params.birth_ppm_unmarried = 10_000;
        params.max_wait = 15;
        params.marriage_ppm = 50_000;
        params.loan_ppm = 300_000;
        params.social_ppm = 900_000;
        params.social_rolls_per_day = 2;
        params
    }

    /// Mortality of a Resident aged `age` years, in ppm per day. Age 120 and above is
    /// certain (R6.2).
    pub fn mortality_ppm(&self, age: u16) -> u32 {
        if age >= CERTAIN_DEATH_AGE {
            CERTAIN_MORTALITY_PPM
        } else {
            self.mortality_ppm_by_age[usize::from(age)]
        }
    }

    /// Daily birth chance of a female Resident, by whether she has a living spouse.
    pub fn birth_ppm(&self, married: bool) -> u32 {
        if married {
            self.birth_ppm_married
        } else {
            self.birth_ppm_unmarried
        }
    }
}

impl Default for Params {
    fn default() -> Self {
        Self::DEFAULT
    }
}

impl Canon for Params {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            mortality_ppm_by_age,
            birth_ppm_married,
            birth_ppm_unmarried,
            max_wait,
            initial_waiting,
            marriage_ppm,
            loan_ppm,
            loan_need_below,
            loan_lender_min,
            social_ppm,
            social_rolls_per_day,
            wage_min,
            wage_max,
            upkeep,
            grudge_threshold,
            friend_at,
            spouse_affinity,
            spouse_trust,
            parent_child_affinity,
            parent_child_trust,
            sibling_affinity,
            sibling_trust,
            grandparent_affinity,
            grandparent_trust,
            rebuilt_share_ppm,
            outsider_age_min,
            outsider_age_max,
        } = self;
        // Fixed-length table, so no length prefix is needed.
        for ppm in mortality_ppm_by_age {
            ppm.encode(w);
        }
        birth_ppm_married.encode(w);
        birth_ppm_unmarried.encode(w);
        max_wait.encode(w);
        initial_waiting.encode(w);
        marriage_ppm.encode(w);
        loan_ppm.encode(w);
        loan_need_below.encode(w);
        loan_lender_min.encode(w);
        social_ppm.encode(w);
        social_rolls_per_day.encode(w);
        wage_min.encode(w);
        wage_max.encode(w);
        upkeep.encode(w);
        grudge_threshold.encode(w);
        friend_at.encode(w);
        spouse_affinity.encode(w);
        spouse_trust.encode(w);
        parent_child_affinity.encode(w);
        parent_child_trust.encode(w);
        sibling_affinity.encode(w);
        sibling_trust.encode(w);
        grandparent_affinity.encode(w);
        grandparent_trust.encode(w);
        rebuilt_share_ppm.encode(w);
        outsider_age_min.encode(w);
        outsider_age_max.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The design's mortality table, written out band by band (age 120 included).
    fn expected_mortality_ppm(age: u16) -> u32 {
        match age {
            0 => 15,
            1..=17 => 1,
            18..=39 => 3,
            40..=59 => 10,
            60..=69 => 40,
            70..=79 => 110,
            80..=89 => 300,
            90..=99 => 800,
            100..=119 => 2_000,
            120 => CERTAIN_MORTALITY_PPM,
            _ => panic!("age above the table: {age}"),
        }
    }

    #[test]
    fn mortality_lookup_hits_every_band_edge() {
        let edges = [
            0u16, 1, 17, 18, 39, 40, 59, 60, 69, 70, 79, 80, 89, 90, 99, 100, 119, 120,
        ];
        for age in edges {
            assert_eq!(
                Params::DEFAULT.mortality_ppm(age),
                expected_mortality_ppm(age),
                "age {age}"
            );
        }
        // Above the table, death is certain too.
        for age in [121u16, 500, u16::MAX] {
            assert_eq!(
                Params::DEFAULT.mortality_ppm(age),
                CERTAIN_MORTALITY_PPM,
                "age {age}"
            );
        }
    }

    #[test]
    fn default_mortality_table_is_pinned() {
        for age in 0..=120u16 {
            assert_eq!(
                Params::DEFAULT.mortality_ppm(age),
                expected_mortality_ppm(age),
                "age {age}"
            );
        }
        assert_eq!(Params::DEFAULT.mortality_ppm_by_age.len(), 120);
    }

    #[test]
    fn default_values_are_pinned() {
        let p = Params::DEFAULT;
        assert_eq!(p.birth_ppm(true), 500);
        assert_eq!(p.birth_ppm(false), 50);
        assert_eq!(p.max_wait, 1_095);
        assert_eq!(p.initial_waiting, 2);
        assert_eq!(p.marriage_ppm, 2_000);
        assert_eq!(p.loan_ppm, 33_000);
        assert_eq!(p.loan_need_below, 2_000);
        assert_eq!(p.loan_lender_min, 5_000);
        assert_eq!(p.social_ppm, 300_000);
        assert_eq!(p.social_rolls_per_day, 1);
        assert_eq!(p.wage_min, 20);
        assert_eq!(p.wage_max, 60);
        assert_eq!(p.upkeep, 30);
        assert_eq!(p.grudge_threshold, -40);
        assert_eq!(p.friend_at, 50);
        assert_eq!(p.spouse_affinity, 60);
        assert_eq!(p.spouse_trust, 60);
        assert_eq!(p.parent_child_affinity, 50);
        assert_eq!(p.parent_child_trust, 50);
        assert_eq!(p.sibling_affinity, 30);
        assert_eq!(p.sibling_trust, 30);
        assert_eq!(p.grandparent_affinity, 40);
        assert_eq!(p.grandparent_trust, 40);
        assert_eq!(p.rebuilt_share_ppm, 200_000);
        assert_eq!(p.outsider_age_min, 18);
        assert_eq!(p.outsider_age_max, 40);
    }

    #[cfg(any(test, feature = "test-support"))]
    #[test]
    fn stress_raises_the_event_rates_and_leaves_the_thresholds() {
        let stressed = Params::stress();
        let default = Params::DEFAULT;
        assert!(stressed.birth_ppm(true) > default.birth_ppm(true));
        assert!(stressed.birth_ppm(false) > default.birth_ppm(false));
        assert!(stressed.max_wait < default.max_wait);
        assert!(stressed.marriage_ppm > default.marriage_ppm);
        assert!(stressed.loan_ppm > default.loan_ppm);
        assert!(stressed.social_ppm > default.social_ppm);
        assert!(stressed.social_rolls_per_day > default.social_rolls_per_day);
        assert!(
            stressed
                .mortality_ppm_by_age
                .iter()
                .zip(default.mortality_ppm_by_age.iter())
                .all(|(a, b)| a >= b)
        );
        assert_eq!(stressed.grudge_threshold, default.grudge_threshold);
        assert_eq!(stressed.friend_at, default.friend_at);
        assert_eq!(stressed.upkeep, default.upkeep);
        assert_eq!(stressed.wage_min, default.wage_min);
        assert_eq!(stressed.wage_max, default.wage_max);
    }

    #[test]
    fn canonical_encoding_is_fixed_width_and_deterministic() {
        use crate::canon::{CanonBytes, encode_to_vec};

        let bytes = encode_to_vec(&Params::DEFAULT);
        // 120 u32 rates + 86 bytes of scalars (pinned here on purpose: a field added
        // to Params without encoding it fails the exhaustive destructuring instead).
        assert_eq!(bytes.len(), 566);
        assert_eq!(&bytes[..4], &15u32.to_le_bytes());
        assert_eq!(
            &bytes[bytes.len() - 8..],
            &[0x40, 0x0D, 0x03, 0x00, 18, 0, 40, 0]
        );
        let mut w = CanonBytes::new();
        Params::DEFAULT.encode(&mut w);
        assert_eq!(w.as_slice(), bytes.as_slice());
        assert_eq!(
            encode_to_vec(&Params::DEFAULT),
            encode_to_vec(&Params::DEFAULT)
        );
    }
}
