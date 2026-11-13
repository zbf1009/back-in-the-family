//! Offerings by the living (step 5, R2, OP-U3 A).
//!
//! For every Ghost in Person ID order whose Offering_Occasion is today, every eligible
//! offerer in Person ID order burns one amount of joss paper: one `offering` Event with
//! the tag `joss_paper` and the credit after the Yearly_Cap. The formula is fixed (no
//! draws): affinity toward the Ghost, piety and the offerer's own money. No money moves
//! (R2.8) and a Ghost's Event keeps the full amount even when the cap credits less
//! (R2.4, R2.7).

use crate::events::{CausedBy, EventKind, EventTag, EventTags};
use crate::ids::{PersonId, SoulId, Tick};
use crate::world::{Life, World};

/// Smallest age of an eligible offerer (OP-U3 A).
pub const OFFERER_AGE_MIN: u16 = 12;

/// Step 5: every Ghost with an Offering_Occasion today receives one Offering per
/// eligible offerer (R2.1 to R2.4).
pub(crate) fn process_offerings(world: &mut World) {
    let today = world.tick;
    for (ghost, soul) in super::ghosts::ghosts(world) {
        let Some(death) = death_tick(world, ghost) else {
            continue;
        };
        let Some(factor) = occasion_factor(world, death, today) else {
            continue;
        };
        for offerer in eligible_offerers(world, ghost) {
            let amount = offering_amount(world, offerer, ghost, factor);
            if amount == 0 {
                continue;
            }
            append_offering(world, offerer, ghost, soul, amount);
        }
    }
}

/// The death tick of a Ghost.
fn death_tick(world: &World, ghost: PersonId) -> Option<Tick> {
    match world.persons.get(&ghost)?.life {
        Life::Dead { death } => Some(death),
        Life::Alive { .. } => None,
    }
}

/// The largest occasion factor of today for a Ghost that died on `death` (design
/// "Offerings"): the funeral, the death anniversary and Halloween, the largest on a
/// shared tick. `None` when today is no occasion.
pub fn occasion_factor(world: &World, death: Tick, today: Tick) -> Option<u64> {
    let params = &world.params;
    let mut factor = 0u64;
    if today == death {
        factor = factor.max(params.funeral_factor);
    } else if today > death
        && today
            .0
            .saturating_sub(death.0)
            .is_multiple_of(super::joss::DAYS_PER_CAP_YEAR)
    {
        factor = factor.max(params.anniversary_factor);
    }
    if today.0 % super::joss::DAYS_PER_CAP_YEAR == params.halloween_day {
        factor = factor.max(params.halloween_factor);
    }
    (factor > 0).then_some(factor)
}

/// Every living Resident aged 12+ with a Relation toward the Ghost whose affinity is at
/// least `offer_min_affinity`, in Person ID order (OP-U3 A).
pub fn eligible_offerers(world: &World, ghost: PersonId) -> Vec<PersonId> {
    world
        .persons
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .filter(|person| world.age_years(person) >= OFFERER_AGE_MIN)
        .filter(|person| {
            world
                .relations
                .get(&(person.id, ghost))
                .is_some_and(|relation| relation.affinity.get() >= world.params.offer_min_affinity)
        })
        .map(|person| person.id)
        .collect()
}

/// The amount one offerer burns for one Ghost on an occasion with `factor` (design
/// "Offerings"):
///
/// ```text
/// a = affinity(offerer -> ghost)                   0 if a < offer_min_affinity
/// p = piety + 3                                    0..=6
/// m = min(money / offer_money_step, offer_money_max_steps)
/// amount = a * p * (2 + m) * factor / 12           floor, 0..=500
/// ```
///
/// The product is bounded (`100 * 6 * 5 * 2 = 6_000`), so the division is exact integer
/// arithmetic on non-negative values.
pub fn offering_amount(world: &World, offerer: PersonId, ghost: PersonId, factor: u64) -> u64 {
    let Some(person) = world.persons.get(&offerer) else {
        return 0;
    };
    let Life::Alive { money, .. } = person.life else {
        return 0;
    };
    let affinity = world
        .relations
        .get(&(offerer, ghost))
        .map_or(0, |relation| i64::from(relation.affinity.get()));
    let minimum = i64::from(world.params.offer_min_affinity);
    if affinity < minimum {
        return 0;
    }
    let piety = i64::from(person.traits.piety.get()).saturating_add(3);
    let steps = money
        .checked_div(world.params.offer_money_step)
        .unwrap_or(u64::MAX)
        .min(world.params.offer_money_max_steps);
    let steps = i64::try_from(steps).unwrap_or(i64::MAX);
    let factor = i64::try_from(factor).unwrap_or(i64::MAX);
    let product = affinity
        .saturating_mul(piety)
        .saturating_mul(steps.saturating_add(2))
        .saturating_mul(factor);
    let amount = product.checked_div(12).unwrap_or(0);
    u64::try_from(amount.clamp(0, 500)).unwrap_or(0)
}

/// Appends one `offering` Event and credits the Ghost's Soul (R2.2, R2.4).
///
/// The credit is computed before the append and applied after it, so an Event the log
/// refuses (an exhausted counter) credits nothing. The Event keeps the full `amount`
/// even when the cap allows less.
pub(crate) fn append_offering(
    world: &mut World,
    offerer: PersonId,
    ghost: PersonId,
    soul: SoulId,
    amount: u64,
) {
    let yearly_cap = world.params.yearly_cap;
    let today = world.tick;
    let account = world.joss.get(&soul).copied().unwrap_or_default();
    let room = yearly_cap.saturating_sub(account.credited_in(today));
    let credited = amount.min(room);
    let mut tags = EventTags::empty();
    tags.insert(EventTag::JossPaper);
    if world
        .append(
            EventKind::Offering {
                offerer,
                ghost,
                amount,
                credited,
            },
            CausedBy::default(),
            tags,
        )
        .is_err()
    {
        // An exhausted Event counter skips the Offering whole (design "Error handling").
        return;
    }
    if let Some(account) = world.joss.get_mut(&soul) {
        let applied = super::joss::credit(account, amount, today, yearly_cap);
        debug_assert_eq!(
            applied, credited,
            "the credit changed between read and write"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;
    use crate::values::{RelTags, Score, Trait};
    use crate::world::{Relation, SoulPlace, WorldConfig};

    fn world(params: Params) -> World {
        World::new_with_params(7, WorldConfig::try_new(40).unwrap(), params).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    /// Kills `person` today and puts its Soul in the queue, so it is a Ghost.
    fn make_ghost(world: &mut World, person: PersonId, death: Tick) -> SoulId {
        let soul = world.persons[&person].soul;
        if let Some(entry) = world.persons.get_mut(&person) {
            entry.life = Life::Dead { death };
        }
        world
            .souls
            .places
            .insert(soul, SoulPlace::Waiting { since: death });
        soul
    }

    fn relate(world: &mut World, from: PersonId, to: PersonId, affinity: i8) {
        world.relations.insert(
            (from, to),
            Relation {
                affinity: Score::clamped(i64::from(affinity)),
                trust: Score::clamped(0),
                tags: RelTags::empty(),
            },
        );
    }

    fn set_offerer(world: &mut World, offerer: PersonId, piety: i8, money: u64) {
        if let Some(person) = world.persons.get_mut(&offerer) {
            person.traits.piety = Trait::clamped(i64::from(piety));
            if let Life::Alive { money: balance, .. } = &mut person.life {
                *balance = money;
            }
        }
    }

    fn offerings(world: &World) -> Vec<(PersonId, PersonId, u64, u64)> {
        world
            .log()
            .events()
            .iter()
            .filter_map(|event| match event.kind {
                EventKind::Offering {
                    offerer,
                    ghost,
                    amount,
                    credited,
                } => Some((offerer, ghost, amount, credited)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_formula_gives_zero_one_and_the_maximum() {
        let mut world = world(Params::DEFAULT);
        let ids = residents(&world);
        let (offerer, ghost) = (ids[0], ids[1]);
        make_ghost(&mut world, ghost, Tick(0));

        // 0: no Relation, then affinity 0: both are below the minimum or at the floor.
        world.relations.remove(&(offerer, ghost));
        assert_eq!(offering_amount(&world, offerer, ghost, 1), 0);
        relate(&mut world, offerer, ghost, 0);
        assert_eq!(offering_amount(&world, offerer, ghost, 1), 0);
        // Negative affinity offers nothing either.
        relate(&mut world, offerer, ghost, -30);
        assert_eq!(offering_amount(&world, offerer, ghost, 2), 0);

        // 1: 1 * (3 + 3) * (2 + 1) * 1 / 12 = 18 / 12 = 1.
        relate(&mut world, offerer, ghost, 1);
        set_offerer(&mut world, offerer, 3, 10_000);
        assert_eq!(world.params.offer_money_step, 10_000);
        assert_eq!(offering_amount(&world, offerer, ghost, 1), 1);

        // 500: 100 * 6 * (2 + 3) * 2 / 12 = 500 exactly.
        relate(&mut world, offerer, ghost, 100);
        set_offerer(&mut world, offerer, 3, 30_000);
        assert_eq!(offering_amount(&world, offerer, ghost, 2), 500);
        // More money than the steps count changes nothing.
        set_offerer(&mut world, offerer, 3, 1_000_000);
        assert_eq!(offering_amount(&world, offerer, ghost, 2), 500);
        // The occasion factor multiplies before the floor.
        set_offerer(&mut world, offerer, 0, 0);
        relate(&mut world, offerer, ghost, 40);
        assert_eq!(offering_amount(&world, offerer, ghost, 2), 40);
        assert_eq!(offering_amount(&world, offerer, ghost, 1), 20);
    }

    #[test]
    fn funeral_and_halloween_on_one_tick_count_once_with_the_largest_factor() {
        let mut world = world(Params::DEFAULT);
        assert_eq!(world.params.halloween_day, 0);
        // Tick 0 is both the funeral (death 0) and Halloween (T % 365 == 0).
        assert_eq!(occasion_factor(&world, Tick(0), Tick(0)), Some(2));
        // Anniversary only: death 5, today 370.
        assert_eq!(occasion_factor(&world, Tick(5), Tick(370)), Some(1));
        // Halloween only.
        assert_eq!(occasion_factor(&world, Tick(5), Tick(365)), Some(1));
        // No occasion.
        assert_eq!(occasion_factor(&world, Tick(5), Tick(6)), None);

        // The step appends one Offering, with the mourning factor 2.
        let ids = residents(&world);
        let (offerer, ghost) = (ids[0], ids[1]);
        make_ghost(&mut world, ghost, Tick(0));
        relate(&mut world, offerer, ghost, 40);
        set_offerer(&mut world, offerer, 0, 0);
        process_offerings(&mut world);
        let appended = offerings(&world);
        assert_eq!(appended.len(), 1, "{appended:?}");
        assert_eq!(appended[0].2, 40);
    }

    #[test]
    fn a_reborn_souls_dead_body_gets_no_offering() {
        let mut world = world(Params::DEFAULT);
        let ids = residents(&world);
        let (offerer, body) = (ids[0], ids[1]);
        let soul = make_ghost(&mut world, body, Tick(0));
        relate(&mut world, offerer, body, 40);
        set_offerer(&mut world, offerer, 0, 0);
        // The Soul leaves the queue for a new body: the dead body is no Ghost.
        world.souls.places.insert(soul, SoulPlace::Body(ids[2]));
        process_offerings(&mut world);
        assert!(offerings(&world).is_empty());
    }

    #[test]
    fn an_offering_moves_no_money() {
        let mut world = world(Params::DEFAULT);
        let ids = residents(&world);
        let (offerer, ghost) = (ids[0], ids[1]);
        make_ghost(&mut world, ghost, Tick(0));
        relate(&mut world, offerer, ghost, 40);
        set_offerer(&mut world, offerer, 0, 5_000);
        let before: Vec<(PersonId, u64)> = world
            .persons
            .values()
            .filter_map(|person| match person.life {
                Life::Alive { money, .. } => Some((person.id, money)),
                Life::Dead { .. } => None,
            })
            .collect();
        process_offerings(&mut world);
        let after: Vec<(PersonId, u64)> = world
            .persons
            .values()
            .filter_map(|person| match person.life {
                Life::Alive { money, .. } => Some((person.id, money)),
                Life::Dead { .. } => None,
            })
            .collect();
        assert_eq!(before, after, "R2.8: an Offering changes no money balance");
        assert_eq!(offerings(&world).len(), 1);
    }

    #[test]
    fn the_credit_stops_at_the_cap_while_the_magnitude_stays_full() {
        let mut world = world(Params::DEFAULT);
        let ids = residents(&world);
        let (offerer, ghost) = (ids[0], ids[1]);
        let soul = make_ghost(&mut world, ghost, Tick(0));
        relate(&mut world, offerer, ghost, 100);
        set_offerer(&mut world, offerer, 3, 30_000);
        let cap = world.params.yearly_cap;
        let account = world.joss.get_mut(&soul).expect("one account per Soul");
        account.credited = cap.saturating_sub(10);
        process_offerings(&mut world);
        let appended = offerings(&world);
        assert_eq!(appended.len(), 1);
        assert_eq!(appended[0].2, 500, "the magnitude keeps the full amount");
        assert_eq!(
            appended[0].3, 10,
            "only the room left in the Cap_Year is credited"
        );
        assert_eq!(world.joss[&soul].balance, 10);
        assert_eq!(world.joss[&soul].credited, cap);
    }
}
