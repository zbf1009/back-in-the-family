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
use crate::ids::EventId;
use crate::ids::PersonId;
use crate::params::Params;
use crate::values::{Intensity, RelTags, RelationTag, Score, SocialKind};
use crate::world::{AppendRefused, Relation, World};

/// The affinity and trust change one direction of a social act applies. Both are
/// non-negative magnitudes; the kind decides the direction of each change.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
struct Effect {
    affinity: i64,
    trust: i64,
}

/// The effect table of design "Steps in detail" (Social events).
///
/// Returns `(target_to_actor, actor_to_target)`: the first moves the Relation whose
/// `from` is the target toward the actor, the second the Relation whose `from` is the
/// actor toward the target. All divisions are on the non-negative intensity and round
/// down; the caps are the table's `<=` bounds.
fn effects(kind: SocialKind, intensity: Intensity) -> (Effect, Effect) {
    let i = i64::from(intensity.get());
    let divide = |by: i64, cap: i64| i.checked_div(by).unwrap_or(0).min(cap);
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
                affinity: divide(4, 25),
                trust: divide(10, 10),
            },
            Effect {
                affinity: divide(4, 25),
                trust: divide(10, 10),
            },
        ),
        SocialKind::Insult => (
            Effect {
                affinity: divide(3, 33),
                trust: divide(5, 20),
            },
            Effect::default(),
        ),
        SocialKind::Theft => (
            Effect {
                affinity: divide(2, 50),
                trust: divide(2, 50),
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

/// Step 9 of the tick: random social events. Filled in task 6.2.
pub(crate) fn process_social_events(_world: &mut World) {}

/// Step 11 of the tick: relation decay. Filled in task 6.2.
pub(crate) fn process_relation_decay(_world: &mut World) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{Life, WorldConfig};

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
            assert!(to_actor.affinity <= 50 && to_actor.trust <= 50, "{kind:?}");
            assert!(
                to_target.affinity <= 25 && to_target.trust <= 10,
                "{kind:?}"
            );
        }
        assert_eq!(effects(SocialKind::Help, max).0.affinity, 20);
        assert_eq!(effects(SocialKind::Help, max).0.trust, 10);
        assert_eq!(effects(SocialKind::Help, max).1.affinity, 10);
        assert_eq!(effects(SocialKind::Gift, max).1.affinity, 5);
        assert_eq!(effects(SocialKind::Quarrel, max).0.affinity, 25);
        assert_eq!(effects(SocialKind::Insult, max).0.affinity, 33);
        assert_eq!(effects(SocialKind::Theft, max).0.trust, 50);
        assert_eq!(effects(SocialKind::Apology, max).1, Effect::default());
        // Every division rounds down.
        assert_eq!(effects(SocialKind::Help, intensity(9)).0.trust, 0);
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
}
