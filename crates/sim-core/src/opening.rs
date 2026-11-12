//! Opening_World generation (design "Opening_World generation", R12).
//!
//! Steps 1 to 10 of the design, in order: households, persons, property, kinship,
//! cross-household relations, the grudge, the opening loans, souls, the Player_Soul and
//! the derived indexes. Every draw uses the stream keyed by the ID being generated
//! (Household ID for household rolls, Person ID for person fields) or the world-level
//! `OpeningWorld` stream with `EntityId(0)`; each sites has its own fixed `index`
//! constant, never a running call counter (design "Opening_World generation", rng rule).
//!
//! History (the grudge and the loans) is appended at tick 0 (OP-7 A) through
//! [`EventLog::push`] directly, so generation does not apply the Mood deltas a live
//! append would: everyone starts at Mood 0 (step 10). The scores the history produced
//! are written into the Relations directly.
//!
//! Generation cannot fail for a valid config. A forced choice that still finds no
//! candidate returns [`ConfigError::Generation`] instead of panicking.

use crate::economy::{Flow, flow};
use crate::events::{CausedBy, EventKind, EventLog, EventTags};
use crate::ids::{HouseholdId, IdCounter, PersonId, PropertyId, SoulId, Tick};
use crate::names::{SURNAME_COUNT, pick_full_name};
use crate::params::Params;
use crate::rng::{StreamTag, below, draw, in_range};
use crate::social::apply_threshold_tags;
use crate::values::{
    Intensity, Mood, Origin, RelTags, RelationTag, Score, Sex, SocialKind, Traits,
};
use crate::world::{
    ConfigError, Debt, Derived, Household, Life, Person, Property, PropertyKind, Rejections,
    Relation, SoulPlace, Souls, World, WorldConfig,
};

/// Every generation draw happens at tick 0.
const OPENING_TICK: Tick = Tick(0);

// Fixed draw-site indices. Each site has its own constant (rng rule).
const OPEN_HOUSEHOLD_TEMPLATE: u64 = 0;
const OPEN_HOUSEHOLD_CHILDREN: u64 = 1;
const OPEN_HOUSEHOLD_SURNAME: u64 = 2;
const OPEN_HOUSEHOLD_PROPERTY: u64 = 3;

const OPEN_PERSON_AGE: u64 = 0;
const OPEN_PERSON_PARTNER_AGE: u64 = 1;
const OPEN_PERSON_ELDER_AGE: u64 = 2;
const OPEN_PERSON_MONEY: u64 = 3;
const OPEN_PERSON_WAGE: u64 = 4;
const OPEN_PERSON_BIRTH_DAY: u64 = 5;
const OPEN_PERSON_SEX: u64 = 6;

const OPEN_TRAIT_GREED: u64 = 0;
const OPEN_TRAIT_LOYALTY: u64 = 1;
const OPEN_TRAIT_PRIDE: u64 = 2;
const OPEN_TRAIT_WARMTH: u64 = 3;
const OPEN_TRAIT_TEMPER: u64 = 4;
const OPEN_TRAIT_VINDICTIVENESS: u64 = 5;
const OPEN_TRAIT_PIETY: u64 = 6;

/// The name picker's draw site.
const OPEN_NAME: u64 = 0;

// World-level draw sites. The `_BASE` sites add the pair or loan ordinal, so every pair
// and every loan has its own indices and draw order never shifts another site.
const WORLD_CROSS_ADULT_A: u64 = 1_000;
const WORLD_CROSS_ADULT_B: u64 = 2_000;
const WORLD_CROSS_AFFINITY: u64 = 3_000;
const WORLD_CROSS_TRUST: u64 = 4_000;
const WORLD_GRUDGE_ADULT_A: u64 = 5_000;
const WORLD_GRUDGE_ADULT_B: u64 = 5_001;
const WORLD_GRUDGE_KIND: u64 = 5_002;
const WORLD_GRUDGE_INTENSITY: u64 = 5_003;
const WORLD_LOAN_LENDER: u64 = 6_000;
const WORLD_LOAN_BORROWER: u64 = 7_000;
const WORLD_LOAN_AMOUNT: u64 = 8_000;
const WORLD_LOAN_DUE: u64 = 9_000;
const WORLD_LOAN_COUNT: u64 = 10_000;
const WORLD_PLAYER_SOUL: u64 = 11_000;

/// Adults in a couple, the age band of the first adult and the partner's age spread.
const COUPLE_AGE_MIN: i64 = 25;
const COUPLE_AGE_SPREAD: i64 = 5;
/// Age from which a Person counts as an adult.
const ADULT_AGE: u16 = 18;
/// Opening money of an adult, in dollars.
const ADULT_MONEY_MIN: i64 = 1_000;
const ADULT_MONEY_MAX: i64 = 30_000;
/// Three-generation households: the elder's age band.
const ELDER_AGE_MIN: i64 = 65;
const ELDER_AGE_SPREAD: i64 = 20;
const ELDER_AGE_MAX: i64 = 90;
/// Single adult age band.
const SINGLE_AGE_MIN: i64 = 18;
const SINGLE_AGE_MAX: i64 = 85;
/// The Player_Soul's opening age band (R12.5).
const PLAYER_SOUL_AGE_MIN: u16 = 20;
const PLAYER_SOUL_AGE_MAX: u16 = 50;
/// A household-1 first adult is always inside the Player_Soul band.
const HOUSEHOLD_ONE_ADULT_MIN: i64 = 25;
const HOUSEHOLD_ONE_ADULT_MAX: i64 = 50;
/// A lender must hold at least this much to give an opening loan.
const OPENING_LOAN_LENDER_MIN: u64 = 2_000;
/// Opening loan amount and due-date bands.
const OPENING_LOAN_AMOUNT_MIN: i64 = 500;
const OPENING_LOAN_AMOUNT_MAX: i64 = 2_000;
const OPENING_LOAN_DUE_MIN: i64 = 60;
const OPENING_LOAN_DUE_MAX: i64 = 720;
/// The grudge scores (design step 6).
const GRUDGE_AFFINITY: i64 = -60;
const GRUDGE_TRUST: i64 = -50;
const GRUDGE_INTENSITY_MIN: i64 = 40;
const GRUDGE_INTENSITY_MAX: i64 = 80;
/// Cross-household relation score bands (design step 5).
const CROSS_AFFINITY_MIN: i64 = -30;
const CROSS_AFFINITY_MAX: i64 = 60;
const CROSS_TRUST_MIN: i64 = -20;
const CROSS_TRUST_MAX: i64 = 50;

/// A household template.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum Template {
    /// A couple with children.
    Couple,
    /// One adult.
    Single,
    /// An elder parent, a couple and children.
    ThreeGeneration,
}

/// One member slot of a household, in creation order.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum Role {
    FirstAdult,
    Spouse,
    Child,
    Elder,
}

/// Builds the Opening_World. `config` must already be validated by the caller.
pub(crate) fn generate(
    seed: u64,
    config: WorldConfig,
    params: Params,
) -> Result<World, ConfigError> {
    let mut world = World {
        seed,
        config,
        params,
        tick: OPENING_TICK,
        person_ids: IdCounter::starting_at(1),
        household_ids: IdCounter::starting_at(1),
        property_ids: IdCounter::starting_at(1),
        persons: std::collections::BTreeMap::new(),
        households: std::collections::BTreeMap::new(),
        properties: std::collections::BTreeMap::new(),
        relations: std::collections::BTreeMap::new(),
        debts: std::collections::BTreeMap::new(),
        souls: Souls {
            places: std::collections::BTreeMap::new(),
            player: SoulId(0),
            ids: IdCounter::starting_at(1),
        },
        log: EventLog::new(),
        flows: crate::economy::FlowTotals::default(),
        rejections: Rejections::default(),
        magistrate: crate::underworld::magistrate::Magistrate::vacant(),
        joss: std::collections::BTreeMap::new(),
        slot_ids: crate::underworld::slots::slot_ids(),
        slots: std::collections::BTreeMap::new(),
        player_wait: None,
        derived: Derived::default(),
    };

    build_households(&mut world)?;
    build_property(&mut world)?;
    add_cross_household_relations(&mut world);
    add_grudge(&mut world)?;
    add_opening_loans(&mut world)?;
    assign_souls(&mut world)?;
    choose_player_soul(&mut world)?;
    assign_joss(&mut world);
    crate::underworld::magistrate::create(&mut world)?;
    world.rebuild_derived();
    Ok(world)
}

/// Steps 1 and 2: households and their persons.
fn build_households(world: &mut World) -> Result<(), ConfigError> {
    let target = usize::from(world.config.opening_residents);
    while world.persons.len() < target {
        let remaining = target.saturating_sub(world.persons.len());
        build_one_household(world, remaining)?;
    }
    Ok(())
}

/// Household-level roll for the template (design step 1).
fn roll_template(world: &World, household: HouseholdId) -> (Template, usize) {
    let roll = below(
        draw(
            world.seed,
            household.rng_key(),
            StreamTag::OpeningWorld,
            OPENING_TICK,
            OPEN_HOUSEHOLD_TEMPLATE,
        ),
        100,
    );
    let kind = if roll < 55 {
        Template::Couple
    } else if roll < 80 {
        Template::Single
    } else {
        Template::ThreeGeneration
    };
    let children_draw = draw(
        world.seed,
        household.rng_key(),
        StreamTag::OpeningWorld,
        OPENING_TICK,
        OPEN_HOUSEHOLD_CHILDREN,
    );
    let children = match kind {
        // A couple has 0 to 3 children, a three-generation household 0 to 2.
        Template::Couple => usize::try_from(below(children_draw, 4)).unwrap_or(0),
        Template::ThreeGeneration => usize::try_from(below(children_draw, 3)).unwrap_or(0),
        Template::Single => 0,
    };
    (kind, children)
}

/// The full member list of a template.
fn template_roles(kind: Template, children: usize) -> Vec<Role> {
    let mut roles = vec![Role::FirstAdult];
    match kind {
        Template::Single => {}
        Template::Couple => {
            roles.push(Role::Spouse);
            for _ in 0..children {
                roles.push(Role::Child);
            }
        }
        Template::ThreeGeneration => {
            roles.push(Role::Spouse);
            for _ in 0..children {
                roles.push(Role::Child);
            }
            roles.push(Role::Elder);
        }
    }
    roles
}

/// Truncates a member list to `remaining` persons by dropping, in order, children (last
/// first), then the elder, then the spouse. The first adult is never dropped.
fn truncate_roles(mut roles: Vec<Role>, remaining: usize) -> Vec<Role> {
    while roles.len() > remaining {
        if let Some(position) = roles.iter().rposition(|role| *role == Role::Child) {
            roles.remove(position);
        } else if let Some(position) = roles.iter().position(|role| *role == Role::Elder) {
            roles.remove(position);
        } else if let Some(position) = roles.iter().position(|role| *role == Role::Spouse) {
            roles.remove(position);
        } else {
            break;
        }
    }
    roles
}

/// Creates one household and its persons (design steps 1 and 2).
fn build_one_household(world: &mut World, remaining: usize) -> Result<(), ConfigError> {
    let id = HouseholdId(
        world
            .household_ids
            .next()
            .map_err(|_| ConfigError::Generation("household id counter exhausted"))?,
    );
    let forced_couple = id == HouseholdId(1);
    let (kind, children) = if forced_couple {
        // Household 1 is always a couple with at least one child (R12.2, R12.5).
        let roll = below(
            draw(
                world.seed,
                id.rng_key(),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                OPEN_HOUSEHOLD_CHILDREN,
            ),
            3,
        );
        (
            Template::Couple,
            1usize.saturating_add(usize::try_from(roll).unwrap_or(0)),
        )
    } else {
        roll_template(world, id)
    };
    let roles = truncate_roles(template_roles(kind, children), remaining);

    let surname = u16::try_from(below(
        draw(
            world.seed,
            id.rng_key(),
            StreamTag::OpeningWorld,
            OPENING_TICK,
            OPEN_HOUSEHOLD_SURNAME,
        ),
        u64::try_from(SURNAME_COUNT).unwrap_or(1),
    ))
    .unwrap_or(0);

    // The first adult sets the couple's age; the spouse stays within five years.
    let first_sex = draw_sex(world.seed, PersonId(world.person_ids.peek()));
    let first_age = if forced_couple {
        in_range(
            draw(
                world.seed,
                PersonId(world.person_ids.peek()).rng_key(),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                OPEN_PERSON_AGE,
            ),
            HOUSEHOLD_ONE_ADULT_MIN,
            HOUSEHOLD_ONE_ADULT_MAX,
        )
    } else {
        match kind {
            Template::Single => in_range(
                draw(
                    world.seed,
                    PersonId(world.person_ids.peek()).rng_key(),
                    StreamTag::OpeningWorld,
                    OPENING_TICK,
                    OPEN_PERSON_AGE,
                ),
                SINGLE_AGE_MIN,
                SINGLE_AGE_MAX,
            ),
            Template::Couple | Template::ThreeGeneration => in_range(
                draw(
                    world.seed,
                    PersonId(world.person_ids.peek()).rng_key(),
                    StreamTag::OpeningWorld,
                    OPENING_TICK,
                    OPEN_PERSON_AGE,
                ),
                COUPLE_AGE_MIN,
                COUPLE_AGE_MIN.saturating_add(35),
            ),
        }
    };

    let first = add_person(world, id, surname, age_u16(first_age), first_sex, true)?;
    let mut spouse_id = None;
    let mut child_ids = Vec::new();
    let mut elder_id = None;
    let mut partner_age = first_age;

    for role in roles {
        match role {
            Role::FirstAdult => {}
            Role::Spouse => {
                let age = in_range(
                    draw(
                        world.seed,
                        PersonId(world.person_ids.peek()).rng_key(),
                        StreamTag::OpeningWorld,
                        OPENING_TICK,
                        OPEN_PERSON_PARTNER_AGE,
                    ),
                    COUPLE_AGE_SPREAD.saturating_neg(),
                    COUPLE_AGE_SPREAD,
                )
                .saturating_add(first_age)
                .max(i64::from(ADULT_AGE));
                partner_age = age;
                let sex = opposite(first_sex);
                spouse_id = Some(add_person(world, id, surname, age_u16(age), sex, true)?);
            }
            Role::Child => {
                let younger = first_age.min(partner_age);
                let max_age = younger.saturating_sub(i64::from(ADULT_AGE)).max(0);
                let age = in_range(
                    draw(
                        world.seed,
                        PersonId(world.person_ids.peek()).rng_key(),
                        StreamTag::OpeningWorld,
                        OPENING_TICK,
                        OPEN_PERSON_AGE,
                    ),
                    0,
                    max_age,
                );
                let sex = draw_sex(world.seed, PersonId(world.person_ids.peek()));
                child_ids.push(add_person(world, id, surname, age_u16(age), sex, false)?);
            }
            Role::Elder => {
                let min = first_age
                    .saturating_add(ELDER_AGE_SPREAD)
                    .max(ELDER_AGE_MIN);
                let age = in_range(
                    draw(
                        world.seed,
                        PersonId(world.person_ids.peek()).rng_key(),
                        StreamTag::OpeningWorld,
                        OPENING_TICK,
                        OPEN_PERSON_ELDER_AGE,
                    ),
                    min,
                    ELDER_AGE_MAX.max(min),
                );
                let sex = draw_sex(world.seed, PersonId(world.person_ids.peek()));
                elder_id = Some(add_person(world, id, surname, age_u16(age), sex, true)?);
            }
        }
    }

    world.households.insert(
        id,
        Household {
            id,
            founded: OPENING_TICK,
        },
    );

    // Step 4: kinship inside the household, with the Params initial scores.
    let params = world.params;
    if let Some(spouse) = spouse_id {
        relate(
            world,
            first,
            spouse,
            RelationTag::Spouse,
            params.spouse_affinity,
            params.spouse_trust,
        );
        relate(
            world,
            spouse,
            first,
            RelationTag::Spouse,
            params.spouse_affinity,
            params.spouse_trust,
        );
        for &child in &child_ids {
            relate(
                world,
                child,
                first,
                RelationTag::Parent,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
            relate(
                world,
                first,
                child,
                RelationTag::Child,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
            relate(
                world,
                child,
                spouse,
                RelationTag::Parent,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
            relate(
                world,
                spouse,
                child,
                RelationTag::Child,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
        }
        if let Some(elder) = elder_id {
            relate(
                world,
                first,
                elder,
                RelationTag::Parent,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
            relate(
                world,
                elder,
                first,
                RelationTag::Child,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
            for &child in &child_ids {
                relate(
                    world,
                    child,
                    elder,
                    RelationTag::Grandparent,
                    params.grandparent_affinity,
                    params.grandparent_trust,
                );
                relate(
                    world,
                    elder,
                    child,
                    RelationTag::Grandchild,
                    params.grandparent_affinity,
                    params.grandparent_trust,
                );
            }
        }
        for (index, &child) in child_ids.iter().enumerate() {
            for &sibling in child_ids.iter().skip(index.saturating_add(1)) {
                relate(
                    world,
                    child,
                    sibling,
                    RelationTag::Sibling,
                    params.sibling_affinity,
                    params.sibling_trust,
                );
                relate(
                    world,
                    sibling,
                    child,
                    RelationTag::Sibling,
                    params.sibling_affinity,
                    params.sibling_trust,
                );
            }
        }
    } else {
        // A single adult (or a truncated couple): the first adult parents any child.
        for &child in &child_ids {
            relate(
                world,
                child,
                first,
                RelationTag::Parent,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
            relate(
                world,
                first,
                child,
                RelationTag::Child,
                params.parent_child_affinity,
                params.parent_child_trust,
            );
        }
        for (index, &child) in child_ids.iter().enumerate() {
            for &sibling in child_ids.iter().skip(index.saturating_add(1)) {
                relate(
                    world,
                    child,
                    sibling,
                    RelationTag::Sibling,
                    params.sibling_affinity,
                    params.sibling_trust,
                );
                relate(
                    world,
                    sibling,
                    child,
                    RelationTag::Sibling,
                    params.sibling_affinity,
                    params.sibling_trust,
                );
            }
        }
    }
    Ok(())
}

/// Adds one Person (design step 2). `adult` selects the adult money band.
fn add_person(
    world: &mut World,
    household: HouseholdId,
    surname: u16,
    age: u16,
    sex: Sex,
    adult: bool,
) -> Result<PersonId, ConfigError> {
    let id = PersonId(
        world
            .person_ids
            .next()
            .map_err(|_| ConfigError::Generation("person id counter exhausted"))?,
    );
    let name_draw = draw(
        world.seed,
        id.rng_key(),
        StreamTag::Names,
        OPENING_TICK,
        OPEN_NAME,
    );
    let name = pick_full_name(
        sex == Sex::Female,
        surname,
        name_draw,
        &world.derived.living_names,
    );
    world.derived.living_names.insert(name);

    let wage = u16::try_from(in_range(
        draw(
            world.seed,
            id.rng_key(),
            StreamTag::OpeningWorld,
            OPENING_TICK,
            OPEN_PERSON_WAGE,
        ),
        i64::from(world.params.wage_min),
        i64::from(world.params.wage_max),
    ))
    .unwrap_or(world.params.wage_min);

    let money = if adult {
        u64::try_from(in_range(
            draw(
                world.seed,
                id.rng_key(),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                OPEN_PERSON_MONEY,
            ),
            ADULT_MONEY_MIN,
            ADULT_MONEY_MAX,
        ))
        .unwrap_or(0)
    } else {
        0
    };

    let birth_day = birth_day_for(world.seed, id, age);
    world.persons.insert(
        id,
        Person {
            id,
            name,
            birth_day,
            sex,
            origin: Origin::Native,
            traits: draw_traits(world.seed, id),
            soul: SoulId(0),
            wage,
            life: Life::Alive {
                household,
                mood: Mood::clamped(0),
                money,
            },
        },
    );
    Ok(id)
}

/// The negative birth day of a Person aged `age` years at tick 0 (R2.3 is exact).
fn birth_day_for(seed: u64, person: PersonId, age: u16) -> i64 {
    let whole = i64::from(age).saturating_mul(365);
    let extra = i64::try_from(below(
        draw(
            seed,
            person.rng_key(),
            StreamTag::OpeningWorld,
            OPENING_TICK,
            OPEN_PERSON_BIRTH_DAY,
        ),
        365,
    ))
    .unwrap_or(0);
    whole.saturating_add(extra).saturating_neg()
}

/// Seven trait draws, keyed by the Person, through the shared weighted draw of design
/// "Trait draws" (Author, 2026-11-11).
fn draw_traits(seed: u64, person: PersonId) -> Traits {
    let trait_at = |index: u64| {
        crate::params::draw_trait(draw(
            seed,
            person.rng_key(),
            StreamTag::Traits,
            OPENING_TICK,
            index,
        ))
    };
    Traits {
        greed: trait_at(OPEN_TRAIT_GREED),
        loyalty: trait_at(OPEN_TRAIT_LOYALTY),
        pride: trait_at(OPEN_TRAIT_PRIDE),
        warmth: trait_at(OPEN_TRAIT_WARMTH),
        temper: trait_at(OPEN_TRAIT_TEMPER),
        vindictiveness: trait_at(OPEN_TRAIT_VINDICTIVENESS),
        piety: trait_at(OPEN_TRAIT_PIETY),
    }
}

fn draw_sex(seed: u64, person: PersonId) -> Sex {
    if draw(
        seed,
        person.rng_key(),
        StreamTag::OpeningWorld,
        OPENING_TICK,
        OPEN_PERSON_SEX,
    ) & 1
        == 0
    {
        Sex::Female
    } else {
        Sex::Male
    }
}

fn opposite(sex: Sex) -> Sex {
    match sex {
        Sex::Female => Sex::Male,
        Sex::Male => Sex::Female,
    }
}

fn age_u16(age: i64) -> u16 {
    u16::try_from(age.max(0)).unwrap_or(0)
}

/// Inserts or updates one directed Relation, setting its scores to the given values.
fn relate(
    world: &mut World,
    from: PersonId,
    to: PersonId,
    tag: RelationTag,
    affinity: i8,
    trust: i8,
) {
    debug_assert_ne!(from, to, "no Relation from a Person to itself");
    let relation = world
        .relations
        .entry((from, to))
        .or_insert_with(|| Relation {
            affinity: Score::clamped(0),
            trust: Score::clamped(0),
            tags: RelTags::empty(),
        });
    relation.affinity = Score::clamped(i64::from(affinity));
    relation.trust = Score::clamped(i64::from(trust));
    relation.tags.insert(tag);
}

/// Step 3: every household's first adult owns a house and possibly one more item.
fn build_property(world: &mut World) -> Result<(), ConfigError> {
    let households: Vec<HouseholdId> = world.households.keys().copied().collect();
    for household in households {
        let first = first_adult(world, household)
            .ok_or(ConfigError::Generation("household without an adult"))?;
        add_property(world, PropertyKind::House, first)?;
        let roll = below(
            draw(
                world.seed,
                household.rng_key(),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                OPEN_HOUSEHOLD_PROPERTY,
            ),
            100,
        );
        let extra = if roll < 30 {
            Some(PropertyKind::Land)
        } else if roll < 45 {
            Some(PropertyKind::Shop)
        } else if roll < 85 {
            Some(PropertyKind::Heirloom)
        } else {
            None
        };
        if let Some(kind) = extra {
            add_property(world, kind, first)?;
        }
    }
    Ok(())
}

fn add_property(
    world: &mut World,
    kind: PropertyKind,
    owner: PersonId,
) -> Result<PropertyId, ConfigError> {
    let id = PropertyId(
        world
            .property_ids
            .next()
            .map_err(|_| ConfigError::Generation("property id counter exhausted"))?,
    );
    world.properties.insert(id, Property { id, kind, owner });
    Ok(id)
}

/// The first adult of a household, by Person ID order.
fn first_adult(world: &World, household: HouseholdId) -> Option<PersonId> {
    world
        .household_members(household)
        .into_iter()
        .find(|id| world.age_years(&world.persons[id]) >= ADULT_AGE)
}

/// Step 5: `N / 2` cross-household relations between adults.
fn add_cross_household_relations(world: &mut World) {
    let adults: Vec<(PersonId, HouseholdId)> = residents_with_household(world)
        .into_iter()
        .filter(|(id, _)| world.age_years(&world.persons[id]) >= ADULT_AGE)
        .collect();
    let pairs = world.config.opening_residents.checked_div(2).unwrap_or(0);
    for pair in 0..pairs {
        let a = pick_adult(
            world,
            &adults,
            WORLD_CROSS_ADULT_A.saturating_add(u64::from(pair)),
        );
        let Some(a) = a else {
            break;
        };
        let candidates: Vec<(PersonId, HouseholdId)> = adults
            .iter()
            .copied()
            .filter(|(id, household)| *id != a.0 && *household != a.1)
            .collect();
        let b = pick_adult(
            world,
            &candidates,
            WORLD_CROSS_ADULT_B.saturating_add(u64::from(pair)),
        );
        let Some(b) = b else {
            break;
        };
        let a_to_b_affinity = in_range(
            draw(
                world.seed,
                crate::ids::EntityId(0),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                WORLD_CROSS_AFFINITY.saturating_add(u64::from(pair).saturating_mul(2)),
            ),
            CROSS_AFFINITY_MIN,
            CROSS_AFFINITY_MAX,
        );
        let b_to_a_affinity = in_range(
            draw(
                world.seed,
                crate::ids::EntityId(0),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                WORLD_CROSS_AFFINITY
                    .saturating_add(u64::from(pair).saturating_mul(2))
                    .saturating_add(1),
            ),
            CROSS_AFFINITY_MIN,
            CROSS_AFFINITY_MAX,
        );
        let a_to_b_trust = in_range(
            draw(
                world.seed,
                crate::ids::EntityId(0),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                WORLD_CROSS_TRUST.saturating_add(u64::from(pair).saturating_mul(2)),
            ),
            CROSS_TRUST_MIN,
            CROSS_TRUST_MAX,
        );
        let b_to_a_trust = in_range(
            draw(
                world.seed,
                crate::ids::EntityId(0),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                WORLD_CROSS_TRUST
                    .saturating_add(u64::from(pair).saturating_mul(2))
                    .saturating_add(1),
            ),
            CROSS_TRUST_MIN,
            CROSS_TRUST_MAX,
        );
        set_scores(world, a.0, b.0, a_to_b_affinity, a_to_b_trust);
        set_scores(world, b.0, a.0, b_to_a_affinity, b_to_a_trust);
    }
}

/// Sets the scores of one directed Relation, creating it when needed, and updates the
/// friend/rival tags.
fn set_scores(world: &mut World, from: PersonId, to: PersonId, affinity: i64, trust: i64) {
    debug_assert_ne!(from, to, "no Relation from a Person to itself");
    let relation = world
        .relations
        .entry((from, to))
        .or_insert_with(|| Relation {
            affinity: Score::clamped(0),
            trust: Score::clamped(0),
            tags: RelTags::empty(),
        });
    relation.affinity = Score::clamped(affinity);
    relation.trust = Score::clamped(trust);
    apply_threshold_tags(&mut relation.tags, relation.affinity, &world.params);
}

/// Step 6: one asymmetric grudge plus its tick-0 history Event (R12.4).
fn add_grudge(world: &mut World) -> Result<(), ConfigError> {
    let adults: Vec<(PersonId, HouseholdId)> = residents_with_household(world)
        .into_iter()
        .filter(|(id, _)| world.age_years(&world.persons[id]) >= ADULT_AGE)
        .collect();
    let a = pick_adult(world, &adults, WORLD_GRUDGE_ADULT_A)
        .ok_or(ConfigError::Generation("grudge: no first adult"))?;
    let candidates: Vec<(PersonId, HouseholdId)> = adults
        .iter()
        .copied()
        .filter(|(id, household)| *id != a.0 && *household != a.1)
        .collect();
    let b = pick_adult(world, &candidates, WORLD_GRUDGE_ADULT_B)
        .ok_or(ConfigError::Generation("grudge: no second adult"))?;

    set_scores(world, a.0, b.0, GRUDGE_AFFINITY, GRUDGE_TRUST);

    let kind_roll = below(
        draw(
            world.seed,
            crate::ids::EntityId(0),
            StreamTag::OpeningWorld,
            OPENING_TICK,
            WORLD_GRUDGE_KIND,
        ),
        3,
    );
    let intensity = Intensity::new(
        u8::try_from(in_range(
            draw(
                world.seed,
                crate::ids::EntityId(0),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                WORLD_GRUDGE_INTENSITY,
            ),
            GRUDGE_INTENSITY_MIN,
            GRUDGE_INTENSITY_MAX,
        ))
        .unwrap_or(40),
    )
    .ok_or(ConfigError::Generation("grudge intensity out of range"))?;
    let kind = match kind_roll {
        0 => EventKind::Social {
            kind: SocialKind::Quarrel,
            doer: a.0,
            target: b.0,
            intensity,
        },
        1 => EventKind::Social {
            kind: SocialKind::Insult,
            doer: b.0,
            target: a.0,
            intensity,
        },
        _ => EventKind::Social {
            kind: SocialKind::Theft,
            doer: b.0,
            target: a.0,
            intensity,
        },
    };
    world
        .log
        // No tags: the design specifies opening tags only for the loans below.
        .push(OPENING_TICK, kind, CausedBy::default(), EventTags::empty())
        .map_err(|_| ConfigError::Generation("event id counter exhausted"))?;
    Ok(())
}

/// Step 7: one opening loan plus 0 to 2 more (R12.3).
fn add_opening_loans(world: &mut World) -> Result<(), ConfigError> {
    let count = 1usize.saturating_add(
        usize::try_from(below(
            draw(
                world.seed,
                crate::ids::EntityId(0),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                WORLD_LOAN_COUNT,
            ),
            3,
        ))
        .unwrap_or(0),
    );
    for loan in 0..count {
        let index = u64::try_from(loan).unwrap_or(0);
        let adults: Vec<(PersonId, HouseholdId)> = residents_with_household(world)
            .into_iter()
            .filter(|(id, _)| world.age_years(&world.persons[id]) >= ADULT_AGE)
            .collect();
        let lenders: Vec<(PersonId, HouseholdId)> = adults
            .iter()
            .copied()
            .filter(|(id, _)| balance(world, *id) >= OPENING_LOAN_LENDER_MIN)
            .collect();
        let lender = pick_adult(world, &lenders, WORLD_LOAN_LENDER.saturating_add(index))
            .ok_or(ConfigError::Generation("loan: no lender"))?;
        let borrowers: Vec<(PersonId, HouseholdId)> = adults
            .iter()
            .copied()
            .filter(|(id, household)| *id != lender.0 && *household != lender.1)
            .collect();
        let borrower = pick_adult(world, &borrowers, WORLD_LOAN_BORROWER.saturating_add(index))
            .ok_or(ConfigError::Generation("loan: no borrower"))?;
        let amount = u64::try_from(in_range(
            draw(
                world.seed,
                crate::ids::EntityId(0),
                StreamTag::OpeningWorld,
                OPENING_TICK,
                WORLD_LOAN_AMOUNT.saturating_add(index),
            ),
            OPENING_LOAN_AMOUNT_MIN,
            OPENING_LOAN_AMOUNT_MAX,
        ))
        .unwrap_or(500);
        let due = Tick(
            u64::try_from(in_range(
                draw(
                    world.seed,
                    crate::ids::EntityId(0),
                    StreamTag::OpeningWorld,
                    OPENING_TICK,
                    WORLD_LOAN_DUE.saturating_add(index),
                ),
                OPENING_LOAN_DUE_MIN,
                OPENING_LOAN_DUE_MAX,
            ))
            .unwrap_or(60),
        );
        // The design specifies tags for the live loan step; money moved here, so the
        // opening `loan` carries `cash` (recorded in docs/kiro-log.md).
        let mut tags = EventTags::empty();
        tags.insert(crate::events::EventTag::Cash);
        let event = world
            .log
            .push(
                OPENING_TICK,
                EventKind::Loan {
                    lender: lender.0,
                    borrower: borrower.0,
                    amount,
                    due,
                },
                CausedBy::default(),
                tags,
            )
            .map_err(|_| ConfigError::Generation("event id counter exhausted"))?;
        if !flow(
            world,
            Flow::Loan {
                from: lender.0,
                to: borrower.0,
            },
            amount,
        ) {
            return Err(ConfigError::Generation("loan: transfer failed"));
        }
        world.debts.insert(
            event,
            Debt {
                creditor: lender.0,
                debtor: borrower.0,
                principal: amount,
                open: amount,
                due,
            },
        );
    }
    Ok(())
}

/// Step 8: one Soul per Person in Person ID order, then the initial waiting Souls.
fn assign_souls(world: &mut World) -> Result<(), ConfigError> {
    let persons: Vec<PersonId> = world.persons.keys().copied().collect();
    for person in persons {
        let soul = SoulId(
            world
                .souls
                .ids
                .next()
                .map_err(|_| ConfigError::Generation("soul id counter exhausted"))?,
        );
        if let Some(entry) = world.persons.get_mut(&person) {
            entry.soul = soul;
        }
        world.souls.places.insert(soul, SoulPlace::Body(person));
    }
    for _ in 0..world.params.initial_waiting {
        let soul = SoulId(
            world
                .souls
                .ids
                .next()
                .map_err(|_| ConfigError::Generation("soul id counter exhausted"))?,
        );
        world.souls.places.insert(
            soul,
            SoulPlace::Waiting {
                since: OPENING_TICK,
            },
        );
    }
    Ok(())
}

/// Opens one joss paper account per Soul, in Soul ID order, after step 8 has assigned
/// every Soul (R1.1, design "Data Models"). No joss paper exists at the opening;
/// offerings create it later.
fn assign_joss(world: &mut World) {
    let souls: Vec<SoulId> = world.souls.places.keys().copied().collect();
    for soul in souls {
        world.joss.insert(
            soul,
            crate::underworld::joss::JossAccount::new(OPENING_TICK),
        );
    }
}

/// Step 9: the Player_Soul is the Soul of a Resident aged 20..=50 (R12.5).
fn choose_player_soul(world: &mut World) -> Result<(), ConfigError> {
    let candidates: Vec<PersonId> = world
        .persons
        .values()
        .filter(|person| {
            matches!(person.life, Life::Alive { .. })
                && (PLAYER_SOUL_AGE_MIN..=PLAYER_SOUL_AGE_MAX).contains(&world.age_years(person))
        })
        .map(|person| person.id)
        .collect();
    if candidates.is_empty() {
        return Err(ConfigError::Generation("player soul: no candidate"));
    }
    let index = below(
        draw(
            world.seed,
            crate::ids::EntityId(0),
            StreamTag::OpeningWorld,
            OPENING_TICK,
            WORLD_PLAYER_SOUL,
        ),
        u64::try_from(candidates.len()).unwrap_or(1),
    );
    let index = usize::try_from(index).unwrap_or(0);
    let chosen = candidates
        .get(index)
        .ok_or(ConfigError::Generation("player soul: index out of range"))?;
    world.souls.player = world
        .persons
        .get(chosen)
        .map(|person| person.soul)
        .ok_or(ConfigError::Generation("player soul: missing person"))?;
    Ok(())
}

/// Living Persons with the Household they live in, in Person ID order.
fn residents_with_household(world: &World) -> Vec<(PersonId, HouseholdId)> {
    world
        .persons
        .values()
        .filter_map(|person| match person.life {
            Life::Alive { household, .. } => Some((person.id, household)),
            Life::Dead { .. } => None,
        })
        .collect()
}

/// Picks one adult from `pool` by a world-level draw at `index`.
fn pick_adult(
    world: &World,
    pool: &[(PersonId, HouseholdId)],
    index: u64,
) -> Option<(PersonId, HouseholdId)> {
    if pool.is_empty() {
        return None;
    }
    let draw = draw(
        world.seed,
        crate::ids::EntityId(0),
        StreamTag::OpeningWorld,
        OPENING_TICK,
        index,
    );
    let position = below(draw, u64::try_from(pool.len()).unwrap_or(1));
    pool.get(usize::try_from(position).unwrap_or(0)).copied()
}

/// The money balance of a living Person.
fn balance(world: &World, person: PersonId) -> u64 {
    match world.persons.get(&person).map(|p| &p.life) {
        Some(Life::Alive { money, .. }) => *money,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::names::FullName;
    use crate::values::RelationTag;

    fn world(seed: u64, n: u16) -> World {
        World::new(seed, WorldConfig::try_new(n).unwrap()).unwrap()
    }

    #[test]
    fn generation_succeeds_for_seeds_0_to_999_and_every_n() {
        for seed in 0..=999u64 {
            for n in 40..=60u16 {
                let w = World::new(seed, WorldConfig::try_new(n).unwrap())
                    .unwrap_or_else(|e| panic!("seed {seed} n {n}: {e}"));
                assert_eq!(w.persons().len(), usize::from(n), "seed {seed} n {n}");
                assert_eq!(w.tick(), Tick(0));
            }
        }
    }

    #[test]
    fn the_same_seed_reproduces_the_same_opening_world() {
        for seed in [0u64, 1, 42, 999] {
            let a = world(seed, 50);
            let b = world(seed, 50);
            assert_eq!(a, b, "seed {seed}");
            assert_eq!(
                crate::checksum::Checksum::of(&a),
                crate::checksum::Checksum::of(&b),
                "seed {seed}"
            );
            assert_ne!(a, world(seed, 49), "seed {seed}: config must matter");
        }
    }

    #[test]
    fn household_one_is_a_couple_with_a_child() {
        for seed in 0..50u64 {
            let w = world(seed, 50);
            let members = w.household_members(HouseholdId(1));
            assert!(members.len() >= 3, "seed {seed}");
            let has_child_link = members.iter().any(|child| {
                members.iter().any(|parent| {
                    *child != *parent
                        && w.relations()
                            .get(&(*child, *parent))
                            .is_some_and(|r| r.tags.contains(RelationTag::Parent))
                        && w.relations()
                            .get(&(*parent, *child))
                            .is_some_and(|r| r.tags.contains(RelationTag::Child))
                })
            });
            assert!(has_child_link, "seed {seed}");
        }
    }

    #[test]
    fn opening_world_has_a_grudge_a_loan_and_a_player_soul() {
        for seed in 0..50u64 {
            let w = world(seed, 50);
            // R12.4: a below-threshold Relation and a grievance Event between the pair.
            let grudge = w
                .relations()
                .iter()
                .find(|((from, to), relation)| {
                    relation.affinity.get() < w.params().grudge_threshold
                        && w.log().events().iter().any(|event| {
                            !matches!(event.kind, EventKind::Loan { .. })
                                && event.kind.actors().iter().any(|a| a == *from)
                                && event.kind.actors().iter().any(|a| a == *to)
                        })
                })
                .unwrap_or_else(|| panic!("seed {seed}: no grudge"));
            assert!(grudge.1.tags.contains(RelationTag::Rival));
            // R12.3: an open Debt with a due tick later than 0.
            assert!(!w.debts().is_empty(), "seed {seed}: no debt");
            for debt in w.debts().values() {
                assert!(debt.due > Tick(0), "seed {seed}: due tick 0");
                assert!(debt.open >= 1 && debt.open <= debt.principal);
            }
            // R12.5: the Player_Soul is a Resident aged 20..=50.
            let player = w.souls().player;
            let place = w.souls().places.get(&player).expect("player place");
            let SoulPlace::Body(person) = place else {
                panic!("seed {seed}: player soul waiting");
            };
            let age = w.age_years(&w.persons()[person]);
            assert!((20..=50).contains(&age), "seed {seed}: player age {age}");
        }
    }

    #[test]
    fn every_household_has_a_member_and_all_residents_have_one() {
        let w = world(3, 40);
        for id in w.households().keys() {
            assert!(!w.household_members(*id).is_empty());
        }
        for person in w.persons().values() {
            let Life::Alive { household, .. } = person.life else {
                panic!("opening residents are alive");
            };
            assert!(w.households().contains_key(&household));
        }
    }

    #[test]
    fn all_resident_names_are_distinct() {
        let w = world(11, 60);
        let names: std::collections::BTreeSet<FullName> =
            w.persons().values().map(|p| p.name).collect();
        assert_eq!(names.len(), w.persons().len());
        assert!(names.len() <= crate::names::FULL_NAME_COUNT);
    }

    #[test]
    fn souls_are_one_per_person_plus_the_initial_waiting_ones() {
        let w = world(5, 45);
        assert_eq!(
            w.souls().places.len(),
            w.persons().len() + usize::try_from(w.params().initial_waiting).unwrap_or(0)
        );
        let waiting = w
            .souls()
            .places
            .values()
            .filter(|place| matches!(place, SoulPlace::Waiting { .. }))
            .count();
        assert_eq!(
            waiting,
            usize::try_from(w.params().initial_waiting).unwrap_or(0)
        );
    }

    #[test]
    fn every_soul_has_one_empty_joss_account_after_opening() {
        let w = world(5, 45);
        assert_eq!(w.joss().len(), w.souls().places.len());
        for soul in w.souls().places.keys() {
            let account = w
                .joss()
                .get(soul)
                .unwrap_or_else(|| panic!("soul {} has no joss account", soul.0));
            assert_eq!(*account, crate::underworld::joss::JossAccount::new(Tick(0)));
        }
    }
}
