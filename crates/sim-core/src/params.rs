//! Tunable numeric parameters (design "Parameters and calibration", OP-5).
//!
//! Every per-day probability is in parts per million: a roll succeeds when
//! `rng::below(draw, 1_000_000) < ppm`. Money is in dollars and durations are in days.
//! `Params` is part of the World and of the canonical encoding, so a test world with a
//! different Params can never be confused with a default one.

use crate::canon::{Canon, CanonWriter};
use crate::rng::below;
use crate::values::Trait;

/// Age at which mortality is certain (R6.2).
pub const CERTAIN_DEATH_AGE: u16 = 120;
/// Mortality rate reported at [`CERTAIN_DEATH_AGE`] and above: every roll succeeds.
pub const CERTAIN_MORTALITY_PPM: u32 = 1_000_000;

/// Weights of the seven trait values `-3..=3`, indexed by `value + 3` (design
/// "Trait draws", Author 2026-11-11). All equal today, so the distribution is uniform;
/// a later spec may make the table configurable.
pub const TRAIT_WEIGHTS: [u32; 7] = [1; 7];

/// The shared weighted trait draw (design "Trait draws", Author 2026-11-11).
///
/// Maps one 64-bit draw onto `-3..=3` through [`TRAIT_WEIGHTS`]. Every trait site
/// (Opening_World, the fresh draw of a birth, an outsider body) uses this function; no
/// site uses a direct `in_range(-3, 3)`.
pub(crate) fn draw_trait(roll: u64) -> Trait {
    let total: u64 = TRAIT_WEIGHTS
        .iter()
        .fold(0u64, |sum, weight| sum.saturating_add(u64::from(*weight)));
    let mut pick = below(roll, total);
    for (index, weight) in TRAIT_WEIGHTS.iter().enumerate() {
        let weight = u64::from(*weight);
        if pick < weight {
            let value = i64::try_from(index).unwrap_or(0).saturating_sub(3);
            return Trait::clamped(value);
        }
        pick = pick.saturating_sub(weight);
    }
    Trait::clamped(3)
}

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
    /// Yearly_Cap: the most joss paper one Soul may receive in one Cap_Year, and the
    /// most it may spend there on hauntings and Rebuilt_Body claims (R2.5, R2.6).
    pub yearly_cap: u64,
    /// Smallest affinity toward a Ghost that makes a Resident an eligible offerer
    /// (OP-U3 A).
    pub offer_min_affinity: i8,
    /// Dollars per offering money step (the formula's `money / offer_money_step`).
    pub offer_money_step: u64,
    /// Largest number of money steps an offering counts.
    pub offer_money_max_steps: u64,
    /// Funeral occasion factor.
    pub funeral_factor: u64,
    /// Death-anniversary occasion factor.
    pub anniversary_factor: u64,
    /// Halloween occasion factor.
    pub halloween_factor: u64,
    /// Halloween's day inside a Cap_Year, as `T % 365` (OP-U3 A).
    pub halloween_day: u64,
    /// Joss paper spent on one dream.
    pub dream_price: u64,
    /// Joss paper spent on one haunting.
    pub haunt_price: u64,
    /// Card intensity of a `haunting` Event (OP-U5 A).
    pub haunt_intensity: u64,
    /// Joss paper spent on the Imported_Vessel Standing_Slot.
    pub imported_price: u64,
    /// Joss paper spent on the Rebuilt_Body Standing_Slot.
    pub rebuilt_price: u64,
    /// Days between a birth announcement and the birth (OP-U7 A).
    pub birth_lead_days: u64,
    /// Longest the Player_Soul may wait (OP-U10 A).
    pub player_max_wait: u64,
    /// Days after its death before the Player_Soul may claim a Birth_Slot (OP-U6 A).
    pub register_wait: u64,
    /// Days `grant_later_slot` opens the register, counted from the ruling tick.
    pub grant_later_delay: u64,
    /// `magistrate_ruling`: base of the `grant_next_slot` threshold.
    pub next_base: u64,
    /// `magistrate_ruling`: threshold raise per point of the Magistrate's loyalty.
    pub next_per_loyalty: u64,
    /// `magistrate_ruling`: largest noise, either sign, on the `grant_next_slot`
    /// threshold.
    pub next_noise: u64,
    /// `magistrate_ruling`: base of the `grant_later_slot` threshold.
    pub later_base: u64,
    /// `magistrate_ruling`: threshold raise per point of the Magistrate's loyalty.
    pub later_per_loyalty: u64,
    /// `magistrate_ruling`: largest noise, either sign, on the `grant_later_slot`
    /// threshold.
    pub later_noise: u64,
    /// Largest noise, either sign, on a `dream_interpretation` Rules_Default score
    /// (OP-U11 A).
    pub dream_noise: u64,
    /// Affinity a dream's as-intent option adds (OP-U11 table).
    pub dream_affinity_gain: i8,
    /// Trust a dream's as-intent option adds.
    pub dream_trust_gain: i8,
    /// Affinity `burn_offering` adds.
    pub burn_offering_affinity_gain: i8,
    /// Affinity `burn_small` adds.
    pub burn_small_affinity_gain: i8,
    /// Lower bound of the daily mortality rate, in ppm (OP-D7 A). `0` disables it.
    pub mortality_floor_ppm: u32,
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
///
/// Used only by [`Params::stress`], which shares its cfg.
#[cfg(any(test, feature = "test-support"))]
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
        birth_ppm_married: 1_000,
        birth_ppm_unmarried: 100,
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
        yearly_cap: 500,
        offer_min_affinity: 1,
        offer_money_step: 10_000,
        offer_money_max_steps: 3,
        funeral_factor: 2,
        anniversary_factor: 1,
        halloween_factor: 1,
        halloween_day: 0,
        dream_price: 20,
        haunt_price: 40,
        haunt_intensity: 50,
        imported_price: 100,
        rebuilt_price: 400,
        birth_lead_days: 180,
        player_max_wait: 1_095,
        register_wait: 365,
        grant_later_delay: 120,
        next_base: 800,
        next_per_loyalty: 100,
        next_noise: 100,
        later_base: 200,
        later_per_loyalty: 40,
        later_noise: 40,
        dream_noise: 10,
        dream_affinity_gain: 6,
        dream_trust_gain: 4,
        burn_offering_affinity_gain: 3,
        burn_small_affinity_gain: 1,
        mortality_floor_ppm: 0,
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

    /// Raised underworld rates for short property-test runs (OP-D7 A): the mortality
    /// floor makes most Player_Souls die within about 250 ticks, and the short lead
    /// times and low prices make caps, automatic placements, slot births and every
    /// rejection occur within 400 ticks.
    ///
    /// It is [`Params::stress`] plus the underworld overrides only, so the same code
    /// paths run with the same thresholds as the default world.
    #[cfg(any(test, feature = "test-support"))]
    pub fn stress_underworld() -> Self {
        let mut params = Self::stress();
        params.mortality_floor_ppm = 4_000;
        params.birth_lead_days = 10;
        params.register_wait = 5;
        params.grant_later_delay = 3;
        params.player_max_wait = 40;
        params.yearly_cap = 120;
        params.dream_price = 5;
        params.haunt_price = 10;
        params.imported_price = 20;
        params.rebuilt_price = 60;
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

    /// The mortality rate the death step rolls against: [`Params::mortality_ppm`]
    /// raised to the floor (OP-D7 A), `max(mortality_ppm(age), mortality_floor_ppm)`.
    /// With the default floor of 0 it equals [`Params::mortality_ppm`].
    pub fn effective_mortality_ppm(&self, age: u16) -> u32 {
        self.mortality_ppm(age).max(self.mortality_floor_ppm)
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
            yearly_cap,
            offer_min_affinity,
            offer_money_step,
            offer_money_max_steps,
            funeral_factor,
            anniversary_factor,
            halloween_factor,
            halloween_day,
            dream_price,
            haunt_price,
            haunt_intensity,
            imported_price,
            rebuilt_price,
            birth_lead_days,
            player_max_wait,
            register_wait,
            grant_later_delay,
            next_base,
            next_per_loyalty,
            next_noise,
            later_base,
            later_per_loyalty,
            later_noise,
            dream_noise,
            dream_affinity_gain,
            dream_trust_gain,
            burn_offering_affinity_gain,
            burn_small_affinity_gain,
            mortality_floor_ppm,
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
        yearly_cap.encode(w);
        offer_min_affinity.encode(w);
        offer_money_step.encode(w);
        offer_money_max_steps.encode(w);
        funeral_factor.encode(w);
        anniversary_factor.encode(w);
        halloween_factor.encode(w);
        halloween_day.encode(w);
        dream_price.encode(w);
        haunt_price.encode(w);
        haunt_intensity.encode(w);
        imported_price.encode(w);
        rebuilt_price.encode(w);
        birth_lead_days.encode(w);
        player_max_wait.encode(w);
        register_wait.encode(w);
        grant_later_delay.encode(w);
        next_base.encode(w);
        next_per_loyalty.encode(w);
        next_noise.encode(w);
        later_base.encode(w);
        later_per_loyalty.encode(w);
        later_noise.encode(w);
        dream_noise.encode(w);
        dream_affinity_gain.encode(w);
        dream_trust_gain.encode(w);
        burn_offering_affinity_gain.encode(w);
        burn_small_affinity_gain.encode(w);
        mortality_floor_ppm.encode(w);
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
        assert_eq!(p.birth_ppm(true), 1_000);
        assert_eq!(p.birth_ppm(false), 100);
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
        assert_eq!(p.yearly_cap, 500);
        assert_eq!(p.offer_min_affinity, 1);
        assert_eq!(p.offer_money_step, 10_000);
        assert_eq!(p.offer_money_max_steps, 3);
        assert_eq!(p.funeral_factor, 2);
        assert_eq!(p.anniversary_factor, 1);
        assert_eq!(p.halloween_factor, 1);
        assert_eq!(p.halloween_day, 0);
        assert_eq!(p.dream_price, 20);
        assert_eq!(p.haunt_price, 40);
        assert_eq!(p.haunt_intensity, 50);
        assert_eq!(p.imported_price, 100);
        assert_eq!(p.rebuilt_price, 400);
        assert_eq!(p.birth_lead_days, 180);
        assert_eq!(p.player_max_wait, 1_095);
        assert_eq!(p.register_wait, 365);
        assert_eq!(p.grant_later_delay, 120);
        assert_eq!(p.next_base, 800);
        assert_eq!(p.next_per_loyalty, 100);
        assert_eq!(p.next_noise, 100);
        assert_eq!(p.later_base, 200);
        assert_eq!(p.later_per_loyalty, 40);
        assert_eq!(p.later_noise, 40);
        assert_eq!(p.dream_noise, 10);
        assert_eq!(p.dream_affinity_gain, 6);
        assert_eq!(p.dream_trust_gain, 4);
        assert_eq!(p.burn_offering_affinity_gain, 3);
        assert_eq!(p.burn_small_affinity_gain, 1);
        assert_eq!(p.mortality_floor_ppm, 0);
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

    #[cfg(any(test, feature = "test-support"))]
    #[test]
    fn stress_underworld_values_are_pinned() {
        let p = Params::stress_underworld();
        let base = Params::stress();
        // The life-sim stress overrides are inherited unchanged.
        assert_eq!(p.birth_ppm(true), base.birth_ppm(true));
        assert_eq!(p.max_wait, base.max_wait);
        assert_eq!(p.mortality_ppm_by_age, base.mortality_ppm_by_age);
        // The underworld overrides of OP-D7 A.
        assert_eq!(p.mortality_floor_ppm, 4_000);
        assert_eq!(p.birth_lead_days, 10);
        assert_eq!(p.register_wait, 5);
        assert_eq!(p.grant_later_delay, 3);
        assert_eq!(p.player_max_wait, 40);
        assert_eq!(p.yearly_cap, 120);
        assert_eq!(p.dream_price, 5);
        assert_eq!(p.haunt_price, 10);
        assert_eq!(p.imported_price, 20);
        assert_eq!(p.rebuilt_price, 60);
        // Every other underworld parameter keeps its default.
        let default = Params::DEFAULT;
        assert_eq!(p.offer_min_affinity, default.offer_min_affinity);
        assert_eq!(p.offer_money_step, default.offer_money_step);
        assert_eq!(p.offer_money_max_steps, default.offer_money_max_steps);
        assert_eq!(p.funeral_factor, default.funeral_factor);
        assert_eq!(p.anniversary_factor, default.anniversary_factor);
        assert_eq!(p.halloween_factor, default.halloween_factor);
        assert_eq!(p.halloween_day, default.halloween_day);
        assert_eq!(p.haunt_intensity, default.haunt_intensity);
        assert_eq!(p.next_base, default.next_base);
        assert_eq!(p.next_per_loyalty, default.next_per_loyalty);
        assert_eq!(p.next_noise, default.next_noise);
        assert_eq!(p.later_base, default.later_base);
        assert_eq!(p.later_per_loyalty, default.later_per_loyalty);
        assert_eq!(p.later_noise, default.later_noise);
        assert_eq!(p.dream_noise, default.dream_noise);
        assert_eq!(p.dream_affinity_gain, default.dream_affinity_gain);
        assert_eq!(p.dream_trust_gain, default.dream_trust_gain);
        assert_eq!(
            p.burn_offering_affinity_gain,
            default.burn_offering_affinity_gain
        );
        assert_eq!(p.burn_small_affinity_gain, default.burn_small_affinity_gain);
        // A stress world can buy the Rebuilt_Body slot inside the spend cap.
        assert!(p.imported_price < p.rebuilt_price);
        assert!(
            p.rebuilt_price <= p.yearly_cap.saturating_sub(p.haunt_price),
            "rebuilt price must fit under the spend cap"
        );
    }

    #[test]
    fn the_mortality_floor_raises_a_low_band_and_leaves_a_higher_band_unchanged() {
        let mut p = Params::DEFAULT;
        // The default floor of 0 leaves the table untouched.
        for age in 0..=120u16 {
            assert_eq!(
                p.effective_mortality_ppm(age),
                p.mortality_ppm(age),
                "{age}"
            );
        }
        // A floor of 50 raises the low bands (3, 10 and 40) ...
        p.mortality_floor_ppm = 50;
        assert_eq!(p.effective_mortality_ppm(30), 50);
        assert_eq!(p.effective_mortality_ppm(0), 50);
        assert_eq!(p.effective_mortality_ppm(45), 50);
        assert_eq!(p.effective_mortality_ppm(65), 50);
        // ... and leaves the bands above it unchanged.
        assert_eq!(p.effective_mortality_ppm(70), 110);
        assert_eq!(p.effective_mortality_ppm(80), 300);
        assert_eq!(p.effective_mortality_ppm(90), 800);
        assert_eq!(p.effective_mortality_ppm(100), 2_000);
        // Certain death stays certain.
        assert_eq!(p.effective_mortality_ppm(120), CERTAIN_MORTALITY_PPM);
        assert_eq!(p.effective_mortality_ppm(500), CERTAIN_MORTALITY_PPM);
    }

    #[test]
    fn canonical_encoding_is_fixed_width_and_deterministic() {
        use crate::canon::{CanonBytes, encode_to_vec};

        let bytes = encode_to_vec(&Params::DEFAULT);
        // 120 u32 rates + 279 bytes of scalars (pinned here on purpose: a field added
        // to Params without encoding it fails the exhaustive destructuring instead).
        assert_eq!(bytes.len(), 759);
        assert_eq!(&bytes[..4], &15u32.to_le_bytes());
        assert_eq!(
            &bytes[bytes.len() - 8..],
            &[6, 4, 3, 1, 0, 0, 0, 0],
            "the four dream gains, then mortality_floor_ppm"
        );
        let mut w = CanonBytes::new();
        Params::DEFAULT.encode(&mut w);
        assert_eq!(w.as_slice(), bytes.as_slice());
        assert_eq!(
            encode_to_vec(&Params::DEFAULT),
            encode_to_vec(&Params::DEFAULT)
        );
    }

    #[test]
    fn the_shared_trait_draw_maps_the_table_onto_the_trait_range() {
        assert_eq!(TRAIT_WEIGHTS, [1; 7]);
        assert_eq!(draw_trait(0).get(), -3);
        assert_eq!(draw_trait(u64::MAX).get(), 3);
        // Only values in the table exist, whatever the draw.
        for roll in [1u64, u64::MAX, 1_000_000, 7, 12_345] {
            assert!((-3..=3).contains(&draw_trait(roll).get()));
        }
    }
}
