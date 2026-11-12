//! The Magistrate (R15, OP-U1 A).
//!
//! One fixed official Person in the World, held outside `World::persons`: every
//! iteration over `World::persons` therefore stays a Resident/dead-Person iteration, so
//! R15.3 to R15.7 hold by construction. It owns the next Person ID after the opening
//! Residents and never changes after Opening_World generation (R15.1).
//!
//! Name, sex, nominal age and the context Soul ID text are the constants of the
//! design's fixed-details table. "Orrin" is in neither first-name list, so the full
//! name differs from every Resident's by construction (R15.10).

use crate::canon::{Canon, CanonWriter};
use crate::ids::PersonId;
use crate::params::draw_trait;
use crate::rng::{StreamTag, draw};
use crate::values::{Sex, Trait, Traits};
use crate::world::{ConfigError, World};

/// The Magistrate's first name (R15.10).
pub const FIRST_NAME: &str = "Orrin";
/// The Magistrate's surname (R15.10).
pub const SURNAME: &str = "Vell";
/// The Magistrate's full name, one first name and one surname (R15.10).
pub const FULL_NAME: &str = "Orrin Vell";
/// The Magistrate's sex (OP-U1 table).
pub const SEX: Sex = Sex::Male;
/// The Magistrate's nominal age in years, in place of the life-sim lifespan (R15.2).
pub const NOMINAL_AGE: u16 = 600;
/// The card Soul ID text the Context_Builder renders for the Magistrate (R15.12).
pub const SOUL_ID_TEXT: &str = "S-0000";

/// Trait draw sites keyed by the Magistrate's Person ID, in card trait order (OP-U1).
const TRAIT_BASE: u64 = 0;

/// The one fixed official Person (design "Data Models").
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Magistrate {
    /// Its Person ID, `N + 1` for an opening town of `N` Residents (OP-U1 A).
    pub id: PersonId,
    /// The seven Traits, drawn once at tick 0 from `StreamTag::Traits` (R15.1).
    pub traits: Traits,
}

impl Magistrate {
    /// The value a fresh [`World`] literal starts with. Opening_World generation always
    /// replaces it through [`create`] before it returns, so no caller ever sees it.
    pub(crate) fn vacant() -> Self {
        Self {
            id: PersonId(0),
            traits: Traits {
                greed: Trait::clamped(0),
                loyalty: Trait::clamped(0),
                pride: Trait::clamped(0),
                warmth: Trait::clamped(0),
                temper: Trait::clamped(0),
                vindictiveness: Trait::clamped(0),
                piety: Trait::clamped(0),
            },
        }
    }

    /// The seven traits of `id` at tick 0 (R15.1): one shared weighted draw per trait,
    /// keyed by the Magistrate's Person ID, in card trait order.
    fn draw_traits(seed: u64, id: PersonId) -> Traits {
        let trait_at = |index: u64| {
            draw_trait(draw(
                seed,
                id.rng_key(),
                StreamTag::Traits,
                crate::ids::Tick(0),
                TRAIT_BASE.saturating_add(index),
            ))
        };
        Traits {
            greed: trait_at(0),
            loyalty: trait_at(1),
            pride: trait_at(2),
            warmth: trait_at(3),
            temper: trait_at(4),
            vindictiveness: trait_at(5),
            piety: trait_at(6),
        }
    }
}

/// Creates the Magistrate at the end of Opening_World generation with the next Person
/// ID (`N + 1`) and its fixed details (R15.1, OP-U1 A).
pub(crate) fn create(world: &mut World) -> Result<(), ConfigError> {
    let id = PersonId(
        world
            .person_ids
            .next()
            .map_err(|_| ConfigError::Generation("person id counter exhausted"))?,
    );
    world.magistrate = Magistrate {
        id,
        traits: Magistrate::draw_traits(world.seed, id),
    };
    Ok(())
}

impl Canon for Magistrate {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { id, traits } = self;
        id.encode(w);
        traits.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{CausedBy, EventKind, EventTags};
    use crate::ids::{HouseholdId, Tick};
    use crate::names::{FEMALE_FIRST, MALE_FIRST};
    use crate::world::{AppendRefused, Life, WorldConfig};

    fn world(seed: u64) -> World {
        World::new(seed, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    #[test]
    fn magistrate_is_created_once_with_fixed_fields() {
        for seed in [0u64, 1, 7, 42, 999] {
            for n in [40u16, 50, 60] {
                let world = World::new(seed, WorldConfig::try_new(n).unwrap()).unwrap();
                let magistrate = world.magistrate();
                let expected_id = PersonId(u64::from(n) + 1);
                assert_eq!(magistrate.id, expected_id, "seed {seed} n {n}");
                assert!(!world.persons().contains_key(&expected_id));
                assert_eq!(
                    magistrate.traits,
                    Magistrate::draw_traits(seed, expected_id),
                    "seed {seed} n {n}"
                );
                for value in [
                    magistrate.traits.greed,
                    magistrate.traits.loyalty,
                    magistrate.traits.pride,
                    magistrate.traits.warmth,
                    magistrate.traits.temper,
                    magistrate.traits.vindictiveness,
                    magistrate.traits.piety,
                ] {
                    assert!((-3..=3).contains(&value.get()));
                }
                assert_eq!(magistrate.id.0, world.person_ids.peek().saturating_sub(1));
            }
        }
        // The fixed details of the design table.
        assert_eq!(FULL_NAME, "Orrin Vell");
        assert_eq!(SEX, Sex::Male);
        assert_eq!(NOMINAL_AGE, 600);
        assert_eq!(SOUL_ID_TEXT, "S-0000");
    }

    #[test]
    fn residents_keep_ids_one_to_n() {
        for n in [40u16, 50, 60] {
            let world = World::new(3, WorldConfig::try_new(n).unwrap()).unwrap();
            let ids: Vec<u64> = residents(&world).iter().map(|id| id.0).collect();
            let expected: Vec<u64> = (1..=u64::from(n)).collect();
            assert_eq!(ids, expected, "n {n}");
            assert_eq!(world.persons().len(), usize::from(n));
        }
    }

    #[test]
    fn the_magistrate_is_in_no_resident_household_or_soul_list() {
        let world = world(5);
        let id = world.magistrate().id;
        assert!(!world.persons().contains_key(&id));
        assert!(!world.households().contains_key(&HouseholdId(id.0)));
        assert!(
            world
                .relations()
                .keys()
                .all(|(from, to)| *from != id && *to != id)
        );
        assert!(
            world
                .debts()
                .values()
                .all(|debt| debt.creditor != id && debt.debtor != id)
        );
        assert!(
            world
                .properties()
                .values()
                .all(|property| property.owner != id)
        );
        // Every Soul still belongs to one Resident body or the queue (R15.6).
        assert_eq!(
            world.souls().places.len(),
            world.persons().len() + usize::try_from(world.params().initial_waiting).unwrap_or(0)
        );
    }

    #[test]
    fn the_magistrate_never_changes_during_a_run() {
        let mut world = world(11);
        let opening = world.magistrate().clone();
        for _ in 0..50 {
            world.step(&[]);
            assert_eq!(world.magistrate(), &opening);
        }
    }

    #[test]
    fn the_magistrates_full_name_differs_from_every_residents() {
        assert!(!MALE_FIRST.contains(&FIRST_NAME));
        assert!(!FEMALE_FIRST.contains(&FIRST_NAME));
        for seed in 0..20u64 {
            let world = world(seed);
            for person in world.persons().values() {
                assert_ne!(person.name.text(person.sex), FULL_NAME, "seed {seed}");
            }
        }
    }

    #[test]
    fn the_magistrate_id_is_accepted_only_as_second_actor_of_appeal_and_bribe() {
        let mut world = world(7);
        let magistrate = world.magistrate().id;
        let ids = residents(&world);
        let resident = ids[0];
        let ghost = ids[1];
        if let Some(person) = world.persons.get_mut(&ghost) {
            person.life = Life::Dead { death: Tick(0) };
        }
        assert!(
            world
                .append(
                    EventKind::Appeal { ghost, magistrate },
                    CausedBy::default(),
                    EventTags::empty()
                )
                .is_ok()
        );
        assert!(
            world
                .append(
                    EventKind::BribeOffering {
                        ghost,
                        magistrate,
                        amount: 1
                    },
                    CausedBy::default(),
                    EventTags::empty()
                )
                .is_ok()
        );
        // First actor: refused.
        assert_eq!(
            world.append(
                EventKind::Appeal {
                    ghost: magistrate,
                    magistrate: resident
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        assert_eq!(
            world.append(
                EventKind::BribeOffering {
                    ghost: magistrate,
                    magistrate: resident,
                    amount: 1
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        // Second actor of another kind: refused.
        assert_eq!(
            world.append(
                EventKind::Offering {
                    offerer: resident,
                    ghost: magistrate,
                    amount: 1,
                    credited: 0
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        assert_eq!(
            world.append(
                EventKind::Dream {
                    ghost: resident,
                    dreamer: magistrate,
                    price: 1
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        // Only actor of a one-actor kind: refused.
        assert_eq!(
            world.append(
                EventKind::Birth { person: magistrate },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
    }
}
