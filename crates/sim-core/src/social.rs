//! Social acts, their effect table and the friend/rival thresholds (R4.8, R4.9).
//!
//! [`apply_social`] is the one path that turns a social act into state: it appends the
//! Event through [`World::append`] (which applies the Mood deltas) and then moves the
//! two Relations between the actors by the documented table, clamped to -100..=100.
//! Step 2 of the tick (a valid `Act` input) and step 9 (random social events, task 6.2)
//! both use it, so the bounds hold in one place.
//!
//! Marriage (step 6), the daily social rolls (step 9) and relation decay (step 11) are
//! filled in tasks 6.2 and 6.5; until then their step functions do nothing.

use crate::events::{CausedBy, EventKind, EventTags};
use crate::ids::{EntityId, EventId, PersonId};
use crate::params::Params;
use crate::rng::{StreamTag, below, draw, in_range};
use crate::values::{Intensity, RelTags, RelationTag, Score, SocialKind};
use crate::world::{AppendRefused, Life, Relation, World, unordered_pair};

/// The signed affinity and trust change one direction of a social act applies.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
struct Effect {
    affinity: i64,
    trust: i64,
}

/// The effect table of design "Steps in detail" (Social events).
///
/// Returns `(target_to_actor, actor_to_target)`: the first moves the Relation whose
/// `from` is the target toward the actor, the second the Relation whose `from` is the
/// actor toward the target. The values are signed exactly as the table writes them
/// (`help`, `gift` and `apology` raise; `quarrel`, `insult` and `theft` lower). All
/// divisions are on the non-negative intensity and round down; the caps are the table's
/// `<=` bounds.
fn effects(kind: SocialKind, intensity: Intensity) -> (Effect, Effect) {
    let i = i64::from(intensity.get());
    let divide = |by: i64, cap: i64| i.checked_div(by).unwrap_or(0).min(cap);
    let lower = |by: i64, cap: i64| divide(by, cap).saturating_neg();
    match kind {
        SocialKind::Help => (
            Effect {
                affinity: divide(5, 20),
                trust: divide(10, 10),
            },
            Effect {
                affinity: divide(10, 10),
                trust: 0,
            },
        ),
        SocialKind::Gift => (
            Effect {
                affinity: divide(5, 20),
                trust: 0,
            },
            Effect {
                affinity: divide(20, 5),
                trust: 0,
            },
        ),
        SocialKind::Quarrel => (
            Effect {
                affinity: lower(4, 25),
                trust: lower(10, 10),
            },
            Effect {
                affinity: lower(4, 25),
                trust: lower(10, 10),
            },
        ),
        SocialKind::Insult => (
            Effect {
                affinity: lower(3, 33),
                trust: lower(5, 20),
            },
            Effect::default(),
        ),
        SocialKind::Theft => (
            Effect {
                affinity: lower(2, 50),
                trust: lower(2, 50),
            },
            Effect::default(),
        ),
        SocialKind::Apology => (
            Effect {
                affinity: divide(5, 20),
                trust: divide(10, 10),
            },
            Effect::default(),
        ),
    }
}

/// Sets the `friend` and `rival` tags exactly from the affinity thresholds (R4.8).
pub(crate) fn apply_threshold_tags(tags: &mut RelTags, affinity: Score, params: &Params) {
    if affinity.get() >= params.friend_at {
        tags.insert(RelationTag::Friend);
    } else {
        tags.remove(RelationTag::Friend);
    }
    if affinity.get() < params.grudge_threshold {
        tags.insert(RelationTag::Rival);
    } else {
        tags.remove(RelationTag::Rival);
    }
}

/// Moves one directed Relation by `affinity_delta` and `trust_delta`, clamping both
/// scores into -100..=100 and updating the friend/rival tags.
fn move_relation(
    world: &mut World,
    from: PersonId,
    to: PersonId,
    affinity_delta: i64,
    trust_delta: i64,
) {
    if affinity_delta == 0 && trust_delta == 0 {
        return;
    }
    debug_assert_ne!(from, to, "social actors are distinct");
    let params = world.params;
    let relation = world
        .relations
        .entry((from, to))
        .or_insert_with(|| Relation {
            affinity: Score::clamped(0),
            trust: Score::clamped(0),
            tags: RelTags::empty(),
        });
    relation.affinity =
        Score::clamped(i64::from(relation.affinity.get()).saturating_add(affinity_delta));
    relation.trust = Score::clamped(i64::from(relation.trust.get()).saturating_add(trust_delta));
    apply_threshold_tags(&mut relation.tags, relation.affinity, &params);
}

/// Applies one social act: appends the Event, applies the Mood deltas through
/// [`World::append`], then moves the two Relations by the effect table (R4.8).
///
/// The actors must exist, be alive and differ; the caller (input validation or the
/// social step) guarantees that. A refusal from `append` leaves the Relations untouched.
pub(crate) fn apply_social(
    world: &mut World,
    kind: SocialKind,
    doer: PersonId,
    target: PersonId,
    intensity: Intensity,
    caused_by: CausedBy,
) -> Result<EventId, AppendRefused> {
    let id = world.append(
        EventKind::Social {
            kind,
            doer,
            target,
            intensity,
        },
        caused_by,
        EventTags::empty(),
    )?;
    let (target_to_actor, actor_to_target) = effects(kind, intensity);
    move_relation(
        world,
        target,
        doer,
        target_to_actor.affinity,
        target_to_actor.trust,
    );
    move_relation(
        world,
        doer,
        target,
        actor_to_target.affinity,
        actor_to_target.trust,
    );
    Ok(id)
}

/// Step 6 of the tick: marriage. Filled in task 6.5.
pub(crate) fn process_marriage(_world: &mut World) {}

/// Youngest age of a social actor.
const SOCIAL_ACTOR_MIN_AGE: u16 = 12;
/// Youngest age of a target picked from any other Resident.
const SOCIAL_TARGET_MIN_AGE: u16 = 6;
/// Social intensity band of a random social act.
const SOCIAL_INTENSITY_MIN: i64 = 10;
const SOCIAL_INTENSITY_MAX: i64 = 60;
/// Draw sites of one social roll. Each roll shifts the sites by this stride, so an
/// extra roll never reuses another roll's numbers (rng rule).
const SOCIAL_SITES_PER_ROLL: u64 = 8;
const SOCIAL_SUCCESS: u64 = 0;
const SOCIAL_ACTOR: u64 = 1;
const SOCIAL_TARGET_MODE: u64 = 2;
const SOCIAL_TARGET: u64 = 3;
const SOCIAL_KIND: u64 = 4;
const SOCIAL_INTENSITY: u64 = 5;

/// The weights of the six social kinds for an actor's Traits and its affinity toward
/// the target (design "Social events"), clamped to at least 1. The `apology` weight is
/// 0 when the actor's affinity toward the target is not below 0, because that kind is
/// then not allowed.
fn kind_weights(traits: &crate::values::Traits, affinity_toward_target: i64) -> [u32; 6] {
    let at = |value: i8| i64::from(value);
    let clamp = |weight: i64| u32::try_from(weight.max(1)).unwrap_or(u32::MAX);
    let warmth = at(traits.warmth.get());
    let temper = at(traits.temper.get());
    let pride = at(traits.pride.get());
    let greed = at(traits.greed.get());
    let loyalty = at(traits.loyalty.get());
    let help = clamp(30i64.saturating_add(warmth.saturating_mul(10)));
    let gift = clamp(15i64.saturating_add(warmth.saturating_mul(5)));
    let quarrel = clamp(20i64.saturating_add(temper.saturating_mul(8)));
    let insult = clamp(
        10i64
            .saturating_add(temper.saturating_mul(5))
            .saturating_add(pride.saturating_mul(3)),
    );
    let theft = clamp(
        3i64.saturating_add(greed.saturating_mul(3))
            .saturating_sub(loyalty.saturating_mul(2)),
    );
    let apology = if affinity_toward_target < 0 {
        clamp(
            10i64
                .saturating_add(loyalty.saturating_mul(5))
                .saturating_sub(pride.saturating_mul(5)),
        )
    } else {
        0
    };
    [help, gift, quarrel, insult, theft, apology]
}

/// The weighted kind draw on one 64-bit value.
fn weighted_kind(weights: [u32; 6], roll: u64) -> SocialKind {
    const KINDS: [SocialKind; 6] = [
        SocialKind::Help,
        SocialKind::Gift,
        SocialKind::Quarrel,
        SocialKind::Insult,
        SocialKind::Theft,
        SocialKind::Apology,
    ];
    let total: u64 = weights
        .iter()
        .fold(0u64, |sum, w| sum.saturating_add(u64::from(*w)));
    let mut pick = below(roll, total);
    for (kind, weight) in KINDS.into_iter().zip(weights) {
        let weight = u64::from(weight);
        if pick < weight {
            return kind;
        }
        pick = pick.saturating_sub(weight);
    }
    SocialKind::Help
}

/// Step 9 of the tick: random social events (design "Social events").
///
/// Each of `SOCIAL_ROLLS_PER_DAY` world-level rolls succeeds with `social_ppm`. An
/// actor is a Resident aged 12+; the target comes half the time from the actor's
/// Relations to Residents and otherwise from any other Resident aged 6+ (an empty
/// first pool falls back to the second). The kind is a weighted draw on the actor's
/// Traits and affinity toward the target, and the act goes through [`apply_social`],
/// the same path as an `Act` input (R4.8).
pub(crate) fn process_social_events(world: &mut World) {
    let rolls = world.params.social_rolls_per_day;
    for roll in 0..rolls {
        let base = u64::from(roll).saturating_mul(SOCIAL_SITES_PER_ROLL);
        let success = draw(
            world.seed,
            EntityId(0),
            StreamTag::Social,
            world.tick,
            base.saturating_add(SOCIAL_SUCCESS),
        );
        if below(success, 1_000_000) >= u64::from(world.params.social_ppm) {
            continue;
        }
        let actors: Vec<PersonId> = world
            .persons
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .filter(|person| world.age_years(person) >= SOCIAL_ACTOR_MIN_AGE)
            .map(|person| person.id)
            .collect();
        if actors.is_empty() {
            continue;
        }
        let actor_roll = draw(
            world.seed,
            EntityId(0),
            StreamTag::Social,
            world.tick,
            base.saturating_add(SOCIAL_ACTOR),
        );
        let actor = actors[usize::try_from(below(
            actor_roll,
            u64::try_from(actors.len()).unwrap_or(u64::MAX),
        ))
        .unwrap_or(0)];
        debug_assert!(matches!(world.persons[&actor].life, Life::Alive { .. }));

        let related: Vec<PersonId> = world
            .relations
            .iter()
            .filter(|((from, _), _)| *from == actor)
            .filter(|((_, to), _)| {
                world
                    .persons
                    .get(to)
                    .is_some_and(|person| matches!(person.life, Life::Alive { .. }))
            })
            .map(|((_, to), _)| *to)
            .collect();
        let strangers: Vec<PersonId> = world
            .persons
            .values()
            .filter(|person| person.id != actor)
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .filter(|person| world.age_years(person) >= SOCIAL_TARGET_MIN_AGE)
            .map(|person| person.id)
            .collect();
        let prefer_related = draw(
            world.seed,
            EntityId(0),
            StreamTag::Social,
            world.tick,
            base.saturating_add(SOCIAL_TARGET_MODE),
        )
        .checked_rem(2)
            == Some(0);
        let pool: &[PersonId] = match (prefer_related, related.is_empty(), strangers.is_empty()) {
            (true, false, _) => &related,
            (_, _, false) => &strangers,
            (_, false, true) => &related,
            (_, true, true) => continue,
        };
        let target_roll = draw(
            world.seed,
            EntityId(0),
            StreamTag::Social,
            world.tick,
            base.saturating_add(SOCIAL_TARGET),
        );
        let target = pool[usize::try_from(below(
            target_roll,
            u64::try_from(pool.len()).unwrap_or(u64::MAX),
        ))
        .unwrap_or(0)];
        debug_assert_ne!(actor, target);

        let affinity = world
            .relations
            .get(&(actor, target))
            .map_or(0, |relation| i64::from(relation.affinity.get()));
        let weights = kind_weights(&world.persons[&actor].traits, affinity);
        let kind_roll = draw(
            world.seed,
            EntityId(0),
            StreamTag::Social,
            world.tick,
            base.saturating_add(SOCIAL_KIND),
        );
        let kind = weighted_kind(weights, kind_roll);
        let intensity_roll = draw(
            world.seed,
            EntityId(0),
            StreamTag::Social,
            world.tick,
            base.saturating_add(SOCIAL_INTENSITY),
        );
        let intensity_value = u8::try_from(in_range(
            intensity_roll,
            SOCIAL_INTENSITY_MIN,
            SOCIAL_INTENSITY_MAX,
        ))
        .unwrap_or(1);
        let Some(intensity) = Intensity::new(intensity_value) else {
            continue;
        };
        let caused_by = if kind == SocialKind::Apology {
            world
                .derived
                .last_grievance
                .get(&unordered_pair(actor, target))
                .map_or_else(CausedBy::default, |event| CausedBy::new(vec![*event]))
        } else {
            CausedBy::default()
        };
        if let Err(refused) = apply_social(world, kind, actor, target, intensity, caused_by) {
            // Selection guarantees living, distinct actors, so only counter exhaustion
            // can refuse here; any other refusal is a bug. The invariant checker
            // surfaces both in tests.
            debug_assert_eq!(
                refused,
                AppendRefused::IdExhausted,
                "social step refused an event: {refused:?}"
            );
        }
    }
}

/// Step 11 of the tick: relation decay (design "The tick").
///
/// Runs only when `T % 30 == 29`. Every Relation whose `from` is a Resident moves
/// `affinity` one point toward 0, including Relations toward the dead, except negative
/// affinity held by a `from` with `vindictiveness >= 2`. A changed affinity also
/// refreshes the `friend`/`rival` tags (R4.8).
pub(crate) fn process_relation_decay(world: &mut World) {
    if world.tick.0.checked_rem(30) != Some(29) {
        return;
    }
    let params = world.params;
    let keys: Vec<(PersonId, PersonId)> = world.relations.keys().copied().collect();
    for key in keys {
        let (from, to) = key;
        let Some(person) = world.persons.get(&from) else {
            continue;
        };
        if !matches!(person.life, Life::Alive { .. }) {
            continue;
        }
        let vindictive = person.traits.vindictiveness.get() >= 2;
        let Some(relation) = world.relations.get_mut(&(from, to)) else {
            continue;
        };
        let affinity = relation.affinity.get();
        let next = if affinity > 0 {
            affinity.saturating_sub(1)
        } else if affinity < 0 && !vindictive {
            affinity.saturating_add(1)
        } else {
            affinity
        };
        if next != affinity {
            relation.affinity = Score::clamped(i64::from(next));
            apply_threshold_tags(&mut relation.tags, relation.affinity, &params);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{Life, WorldConfig};
    use proptest::prelude::*;

    fn world() -> World {
        World::new(9, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons()
            .values()
            .filter(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| p.id)
            .collect()
    }

    fn intensity(value: u8) -> Intensity {
        Intensity::new(value).unwrap()
    }

    #[test]
    fn effect_table_bounds_follow_the_design() {
        let max = intensity(100);
        for kind in [
            SocialKind::Help,
            SocialKind::Gift,
            SocialKind::Quarrel,
            SocialKind::Insult,
            SocialKind::Theft,
            SocialKind::Apology,
        ] {
            let (to_actor, to_target) = effects(kind, max);
            assert!(
                to_actor.affinity.unsigned_abs() <= 50 && to_actor.trust.unsigned_abs() <= 50,
                "{kind:?}"
            );
            assert!(
                to_target.affinity.unsigned_abs() <= 25 && to_target.trust.unsigned_abs() <= 10,
                "{kind:?}"
            );
        }
        assert_eq!(effects(SocialKind::Help, max).0.affinity, 20);
        assert_eq!(effects(SocialKind::Help, max).0.trust, 10);
        assert_eq!(effects(SocialKind::Help, max).1.affinity, 10);
        assert_eq!(effects(SocialKind::Gift, max).1.affinity, 5);
        // Negative kinds lower affinity and trust exactly as the table writes them.
        assert_eq!(effects(SocialKind::Quarrel, max).0.affinity, -25);
        assert_eq!(effects(SocialKind::Quarrel, max).0.trust, -10);
        assert_eq!(effects(SocialKind::Quarrel, max).1.affinity, -25);
        assert_eq!(effects(SocialKind::Insult, max).0.affinity, -33);
        assert_eq!(effects(SocialKind::Insult, max).0.trust, -20);
        assert_eq!(effects(SocialKind::Theft, max).0.affinity, -50);
        assert_eq!(effects(SocialKind::Theft, max).0.trust, -50);
        assert_eq!(effects(SocialKind::Apology, max).1, Effect::default());
        // Every division rounds down.
        assert_eq!(effects(SocialKind::Help, intensity(9)).0.trust, 0);
    }

    #[test]
    fn negative_kinds_lower_affinity_through_apply_social() {
        // Regression: the table's negative rows were applied as positive magnitudes
        // until Property 8 caught it.
        let mut w = world();
        let ids = residents(&w);
        let (a, b) = (ids[0], ids[1]);
        let old = w.relations().get(&(b, a)).map_or((0, 0), |relation| {
            (relation.affinity.get(), relation.trust.get())
        });
        let old_actor = w
            .relations()
            .get(&(a, b))
            .map(|relation| relation.affinity.get());
        apply_social(
            &mut w,
            SocialKind::Insult,
            a,
            b,
            intensity(100),
            CausedBy::default(),
        )
        .unwrap();
        // The target's Relation toward the actor falls by 33 affinity and 20 trust.
        let after = &w.relations()[&(b, a)];
        assert_eq!(after.affinity.get(), old.0.saturating_sub(33).max(-100));
        assert_eq!(after.trust.get(), old.1.saturating_sub(20).max(-100));
        // The actor's Relation toward the target does not move for an insult.
        assert_eq!(
            w.relations()
                .get(&(a, b))
                .map(|relation| relation.affinity.get()),
            old_actor
        );
    }

    #[test]
    fn apply_social_changes_only_the_two_relations_and_respects_bounds() {
        let mut w = world();
        let ids = residents(&w);
        let (a, b) = (ids[0], ids[1]);
        let before = w.relations().clone();
        apply_social(
            &mut w,
            SocialKind::Quarrel,
            a,
            b,
            intensity(100),
            CausedBy::default(),
        )
        .unwrap();
        for (key, relation) in w.relations() {
            if *key != (a, b) && *key != (b, a) {
                assert_eq!(before.get(key), Some(relation), "{key:?} changed");
            }
        }
        // Both directions lose at most 25 affinity and 10 trust.
        for key in [(a, b), (b, a)] {
            let old = before.get(&key).map_or(0, |r| r.affinity.get());
            let new = w.relations()[&key].affinity.get();
            assert!(old.saturating_sub(new) <= 25, "{key:?}");
        }
        assert!(w.log().events().last().is_some());
    }

    #[test]
    fn thresholds_set_friend_and_rival_exactly() {
        let params = Params::DEFAULT;
        let mut tags = RelTags::empty();
        apply_threshold_tags(&mut tags, Score::clamped(50), &params);
        assert!(tags.contains(RelationTag::Friend));
        assert!(!tags.contains(RelationTag::Rival));
        apply_threshold_tags(&mut tags, Score::clamped(-60), &params);
        assert!(!tags.contains(RelationTag::Friend));
        assert!(tags.contains(RelationTag::Rival));
        apply_threshold_tags(&mut tags, Score::clamped(-40), &params);
        assert!(
            !tags.contains(RelationTag::Rival),
            "-40 is not below the threshold"
        );
        apply_threshold_tags(&mut tags, Score::clamped(49), &params);
        assert!(!tags.contains(RelationTag::Friend));
    }

    fn traits_with(value: i8) -> crate::values::Traits {
        let trait_value = |v: i8| crate::values::Trait::new(v).unwrap();
        crate::values::Traits {
            greed: trait_value(value),
            loyalty: trait_value(value),
            pride: trait_value(value),
            warmth: trait_value(value),
            temper: trait_value(value),
            vindictiveness: trait_value(value),
            piety: trait_value(value),
        }
    }

    fn set_relation(world: &mut World, from: PersonId, to: PersonId, affinity: i8) {
        world.relations.insert(
            (from, to),
            Relation {
                affinity: Score::clamped(i64::from(affinity)),
                trust: Score::clamped(0),
                tags: RelTags::empty(),
            },
        );
    }

    #[test]
    fn kind_weights_follow_the_table_at_the_trait_extremes() {
        // All traits -3: help 0, gift 0, quarrel -4, insult -14, theft 0, apology 10;
        // every weight clamps to at least 1.
        assert_eq!(kind_weights(&traits_with(-3), -10), [1, 1, 1, 1, 1, 10]);
        // All traits +3: help 60, gift 30, quarrel 44, insult 34, theft 6, apology 10.
        assert_eq!(kind_weights(&traits_with(3), -10), [60, 30, 44, 34, 6, 10]);
    }

    #[test]
    fn apology_is_offered_only_when_affinity_is_below_zero() {
        let traits = traits_with(0);
        assert_eq!(kind_weights(&traits, 0)[5], 0);
        assert_eq!(kind_weights(&traits, 5)[5], 0);
        assert!(kind_weights(&traits, -1)[5] >= 1);
    }

    #[test]
    fn a_vindictive_holder_keeps_negative_affinity() {
        let mut w = world();
        w.tick = crate::ids::Tick(29);
        let ids = residents(&w);
        let (a, b) = (ids[0], ids[1]);
        if let Some(person) = w.persons.get_mut(&a) {
            person.traits.vindictiveness = crate::values::Trait::new(2).unwrap();
        }
        set_relation(&mut w, a, b, -5);
        process_relation_decay(&mut w);
        assert_eq!(w.relations[&(a, b)].affinity.get(), -5);
        // Positive affinity still decays for the same holder.
        set_relation(&mut w, a, b, 5);
        process_relation_decay(&mut w);
        assert_eq!(w.relations[&(a, b)].affinity.get(), 4);
    }

    #[test]
    fn negative_affinity_of_a_non_vindictive_holder_moves_toward_zero() {
        let mut w = world();
        w.tick = crate::ids::Tick(29);
        let ids = residents(&w);
        let (a, b) = (ids[0], ids[1]);
        if let Some(person) = w.persons.get_mut(&a) {
            person.traits.vindictiveness = crate::values::Trait::new(1).unwrap();
        }
        set_relation(&mut w, a, b, -5);
        process_relation_decay(&mut w);
        assert_eq!(w.relations[&(a, b)].affinity.get(), -4);
    }

    #[test]
    fn decay_applies_to_a_relation_toward_the_dead() {
        let mut w = world();
        w.tick = crate::ids::Tick(29);
        let ids = residents(&w);
        let (a, b) = (ids[0], ids[1]);
        if let Some(person) = w.persons.get_mut(&b) {
            person.life = Life::Dead {
                death: crate::ids::Tick(0),
            };
        }
        set_relation(&mut w, a, b, 10);
        process_relation_decay(&mut w);
        assert_eq!(w.relations[&(a, b)].affinity.get(), 9);
    }

    #[test]
    fn decay_runs_only_on_the_last_day_of_the_month() {
        let mut w = world();
        w.tick = crate::ids::Tick(28);
        let ids = residents(&w);
        let (a, b) = (ids[0], ids[1]);
        set_relation(&mut w, a, b, 10);
        process_relation_decay(&mut w);
        assert_eq!(w.relations[&(a, b)].affinity.get(), 10);
    }

    #[test]
    fn a_social_roll_appends_an_event_through_the_shared_path() {
        let mut w = world();
        w.params.social_ppm = 1_000_000;
        let before = w.log().len();
        process_social_events(&mut w);
        assert_eq!(w.log().len(), before.saturating_add(1));
        assert!(matches!(
            w.log().events().last().map(|event| &event.kind),
            Some(EventKind::Social { .. })
        ));
    }

    // Feature: life-sim, Property 8: Social effects stay within their bounds.
    //
    // For any two distinct Residents, any prior Relations between them (or none), any
    // kind and any intensity in 1..=100, applying the act changes only the two Relations
    // between the actors, each change is exactly the documented bound for its kind and
    // direction with the result clamped to -100..=100, and the friend/rival tags follow
    // the thresholds. **Validates: Requirements 4.8**
    proptest! {
        #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

        #[test]
        fn property_8_social_effects_stay_within_their_bounds(
            a_index in 0usize..40,
            offset in 1usize..40,
            kind_index in 0usize..6,
            intensity_value in 1u8..=100,
            prior_to_actor in proptest::option::of((-100i16..=100, -100i16..=100, 0u8..=3)),
            prior_to_target in proptest::option::of((-100i16..=100, -100i16..=100, 0u8..=3)),
        ) {
            const KINDS: [SocialKind; 6] = [
                SocialKind::Help,
                SocialKind::Gift,
                SocialKind::Quarrel,
                SocialKind::Insult,
                SocialKind::Theft,
                SocialKind::Apology,
            ];
            let kind = KINDS[kind_index];
            let intensity = intensity(intensity_value);
            let mut w = world();
            let ids = residents(&w);
            prop_assume!(ids.len() >= 2);
            let a = ids[a_index.checked_rem(ids.len()).unwrap_or(0)];
            let b = ids[a_index
                .saturating_add(offset)
                .checked_rem(ids.len())
                .unwrap_or(0)];
            prop_assume!(a != b);

            let tag_bits = |roll: u8| {
                let mut tags = RelTags::empty();
                if roll & 1 != 0 {
                    tags.insert(RelationTag::Friend);
                }
                if roll & 2 != 0 {
                    tags.insert(RelationTag::Rival);
                }
                tags
            };
            if let Some((affinity, trust, roll)) = prior_to_target {
                w.relations.insert(
                    (a, b),
                    Relation {
                        affinity: Score::clamped(i64::from(affinity)),
                        trust: Score::clamped(i64::from(trust)),
                        tags: tag_bits(roll),
                    },
                );
            }
            if let Some((affinity, trust, roll)) = prior_to_actor {
                w.relations.insert(
                    (b, a),
                    Relation {
                        affinity: Score::clamped(i64::from(affinity)),
                        trust: Score::clamped(i64::from(trust)),
                        tags: tag_bits(roll),
                    },
                );
            }
            let before = w.relations().clone();

            apply_social(&mut w, kind, a, b, intensity, CausedBy::default())
                .expect("living, distinct actors never refuse an event");

            // Only the two Relations between the actors may change.
            for (key, relation) in &before {
                if *key != (a, b) && *key != (b, a) {
                    prop_assert_eq!(w.relations().get(key), Some(relation), "{:?} changed", key);
                }
            }
            for key in w.relations().keys() {
                prop_assert!(
                    before.contains_key(key) || *key == (a, b) || *key == (b, a),
                    "{:?} appeared",
                    key
                );
            }

            // The table bound, restated independently of `effects`: intensity `i`, the
            // `<=` caps, and every division on the non-negative intensity rounded down.
            let i = i64::from(intensity_value);
            let p2 = i.checked_div(2).unwrap_or(0);
            let p3 = i.checked_div(3).unwrap_or(0);
            let p4 = i.checked_div(4).unwrap_or(0);
            let p5 = i.checked_div(5).unwrap_or(0);
            let p10 = i.checked_div(10).unwrap_or(0);
            let p20 = i.checked_div(20).unwrap_or(0);
            let (to_actor, to_target) = match kind {
                SocialKind::Help => ((p5.min(20), p10.min(10)), (p10.min(10), 0)),
                SocialKind::Gift => ((p5.min(20), 0), (p20.min(5), 0)),
                SocialKind::Quarrel => (
                    (p4.min(25).saturating_neg(), p10.min(10).saturating_neg()),
                    (p4.min(25).saturating_neg(), p10.min(10).saturating_neg()),
                ),
                SocialKind::Insult => (
                    (p3.min(33).saturating_neg(), p5.min(20).saturating_neg()),
                    (0, 0),
                ),
                SocialKind::Theft => (
                    (p2.min(50).saturating_neg(), p2.min(50).saturating_neg()),
                    (0, 0),
                ),
                SocialKind::Apology => ((p5.min(20), p10.min(10)), (0, 0)),
            };
            let params = *w.params();
            for (key, (affinity_delta, trust_delta)) in [((b, a), to_actor), ((a, b), to_target)] {
                let old_affinity = before
                    .get(&key)
                    .map_or(0, |relation| i64::from(relation.affinity.get()));
                let old_trust = before
                    .get(&key)
                    .map_or(0, |relation| i64::from(relation.trust.get()));
                let expected_affinity = old_affinity
                    .saturating_add(affinity_delta)
                    .clamp(-100, 100);
                let expected_trust = old_trust.saturating_add(trust_delta).clamp(-100, 100);
                match w.relations().get(&key) {
                    None => prop_assert_eq!(
                        (affinity_delta, trust_delta),
                        (0, 0),
                        "{:?} is missing",
                        key
                    ),
                    Some(relation) => {
                        prop_assert_eq!(
                            i64::from(relation.affinity.get()),
                            expected_affinity,
                            "{:?} affinity",
                            key
                        );
                        prop_assert_eq!(
                            i64::from(relation.trust.get()),
                            expected_trust,
                            "{:?} trust",
                            key
                        );
                        prop_assert!((-100..=100).contains(&i64::from(relation.affinity.get())));
                        prop_assert!((-100..=100).contains(&i64::from(relation.trust.get())));
                        // A touched Relation is re-derived exactly; an act with both deltas
                        // 0 leaves the Relation untouched.
                        if (affinity_delta, trust_delta) != (0, 0) {
                            prop_assert_eq!(
                                relation.tags.contains(RelationTag::Friend),
                                expected_affinity >= i64::from(params.friend_at),
                                "{:?} friend tag",
                                key
                            );
                            prop_assert_eq!(
                                relation.tags.contains(RelationTag::Rival),
                                expected_affinity < i64::from(params.grudge_threshold),
                                "{:?} rival tag",
                                key
                            );
                        } else if let Some(previous) = before.get(&key) {
                            prop_assert_eq!(
                                relation.tags,
                                previous.tags,
                                "{:?} tags changed without an effect",
                                key
                            );
                        }
                    }
                }
            }
        }
    }
}
