//! Test-only mutation and C1 illegal-fixture API, absent from normal builds.
//!
//! Compiled only under `#[cfg(any(test, feature = "test-support"))]`. Integration tests
//! in `tests/` are built without `cfg(test)`, so `sim-core` enables the `test-support`
//! feature for its own tests through a self dev-dependency; a normal build of the crate
//! does not contain this module.
//!
//! [`apply`] performs exactly ONE single-field mutation on a [`World`] and reports
//! whether it changed anything. It deliberately does not preserve invariants (it can
//! make a Relation point at itself, for example): its only purpose is to prove that
//! every field of the canonical state reaches the checksum. [`Derived`] is the one
//! exception: it is not encoded, so its mutations change the World but not the checksum
//! (R16.5), and the unit tests assert exactly that.
//!
//! # Compile-time exhaustiveness guard
//!
//! [`apply`] destructures [`World`], [`WorldConfig`], [`Souls`], [`FlowTotals`],
//! [`Rejections`], [`Derived`], [`Person`], [`Life`], [`Household`], [`Property`],
//! [`Relation`], [`Debt`], [`JossAccount`],
//! [`crate::underworld::magistrate::Magistrate`] and
//! [`crate::underworld::slots::BirthSlot`] with every field named and no `..`.
//! Adding a field to any of those structs therefore fails to compile here until the new field
//! gets a [`Mutation`] variant (the same discipline as the `Canon` impls). Selectors are
//! raw integers resolved by modulo over the live collection, so a caller can never
//! produce an out-of-range index.

use crate::economy::FlowTotals;
use crate::events::{CausedBy, EventKind, EventTags};
use crate::ids::{
    BirthSlotId, EventId, HouseholdId, IdCounter, InputSeq, PersonId, PropertyId, SoulId, Tick,
};
use crate::names::{FEMALE_FIRST_COUNT, SURNAME_COUNT};
use crate::underworld::joss::JossAccount;
use crate::values::{Mood, Origin, RelTags, RelationTag, Score, Sex, Trait};
use crate::world::{
    Debt, Derived, Household, Life, Person, Property, PropertyKind, RejectReason, Rejections,
    Relation, SoulPlace, Souls, World, WorldConfig,
};

/// Inserts an intentionally illegal Event directly into the test-only log for C1
/// checker-recognition fixtures. Normal simulation Events must use `World::append`.
pub fn append_invalid_event(world: &mut World, tick: Tick, kind: EventKind) {
    assert!(tick <= world.tick, "C1 Event cannot be from a future tick");
    world
        .log
        .push(tick, kind, CausedBy::default(), EventTags::empty())
        .expect("C1 fixture has room for one Event");
}

/// Sets one existing account in a test-only fixture, without a simulation credit or
/// spend. C1 uses this to balance its illegal Event ledger; the Rebuilt function-only
/// test uses it to fund a claim without asserting normal-play affordability.
pub fn set_invalid_joss_account(world: &mut World, soul: SoulId, account: JossAccount) {
    *world.joss.get_mut(&soul).expect("C1 Soul has an account") = account;
}

/// One single-field mutation. Selector fields are resolved modulo the number of
/// candidates, so any value is legal.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Mutation {
    /// `World::seed`: flip bit `bit % 64`.
    Seed { bit: u8 },
    /// `WorldConfig::opening_residents`: plus one, staying inside 40..=60.
    ConfigOpeningResidents,
    /// `Params::upkeep`: plus one.
    ParamsUpkeep,
    /// `World::tick`: plus one.
    Tick,
    /// `World::person_ids`: counter plus one.
    PersonIdCounter,
    /// `World::household_ids`: counter plus one.
    HouseholdIdCounter,
    /// `World::property_ids`: counter plus one.
    PropertyIdCounter,
    /// `Souls::ids`: counter plus one.
    SoulIdCounter,
    /// One field of a Person: `part % 12` picks the name, birth day, sex, Origin, a
    /// trait, Soul ID, wage, Mood, money, Household or the `Life` value.
    PersonField { person: u64, part: u8 },
    /// `World::persons`: insert a fresh Person under the counter's next id.
    AddPerson,
    /// `World::persons`: remove one Person.
    RemovePerson { person: u64 },
    /// `World::households`: insert a Household under the counter's next id.
    AddHousehold,
    /// `World::households`: remove one Household.
    RemoveHousehold { household: u64 },
    /// `World::properties`: insert a Property item.
    AddProperty,
    /// `World::properties`: remove one item.
    RemoveProperty { property: u64 },
    /// `Property::kind`: next kind.
    PropertyKindField { property: u64 },
    /// `Property::owner`: another Person.
    PropertyOwner { property: u64 },
    /// `Relation::affinity`: plus or minus one within -100..=100.
    RelationAffinity { from: u64, to: u64, up: bool },
    /// `Relation::trust`: plus or minus one within -100..=100.
    RelationTrust { from: u64, to: u64, up: bool },
    /// `Relation::tags`: toggle the `rival` tag.
    RelationTags { from: u64, to: u64 },
    /// `World::relations`: insert a default Relation between two Persons.
    AddRelation { from: u64, to: u64 },
    /// `World::relations`: remove one Relation.
    RemoveRelation { from: u64, to: u64 },
    /// `World::debts`: insert a Debt under the next Event ID.
    AddDebt,
    /// `World::debts`: remove one Debt.
    RemoveDebt { debt: u64 },
    /// `Debt::open`: plus or minus one within 1..=principal.
    DebtOpen { debt: u64, up: bool },
    /// `Debt::due`: plus one.
    DebtDue { debt: u64 },
    /// `Debt::principal`: plus one.
    DebtPrincipal { debt: u64 },
    /// `Debt::creditor`: another Person.
    DebtCreditor { debt: u64 },
    /// `Debt::debtor`: another Person.
    DebtDebtor { debt: u64 },
    /// `Souls::places`: flip one Soul between a body and the queue.
    SoulPlaceField { soul: u64 },
    /// `Souls::places`: insert a waiting Soul at the counter's next id.
    AddSoul,
    /// `Souls::places`: remove one Soul.
    RemoveSoul { soul: u64 },
    /// `Souls::player`: another Soul.
    PlayerSoul,
    /// One stored Event's `tick`: plus one.
    EventTick { event: u64 },
    /// `EventLog`: append one Event.
    AddEvent,
    /// `EventLog`: drop one stored Event.
    DropEvent { event: u64 },
    /// `FlowTotals::sources`: plus one.
    FlowSources,
    /// `FlowTotals::sinks`: plus one.
    FlowSinks,
    /// `Rejections::count_by_reason`: plus one (creating the entry).
    RejectionCount { reason: RejectReason },
    /// `Rejections::last`: `part % 4` picks `None -> Some`, or for `Some`: 0 = tick + 1,
    /// 1 = seq + 1, 2 = next reason, 3 = back to `None`.
    RejectionLast { part: u8 },
    /// `JossAccount::balance` of one Soul: plus one.
    JossBalance { soul: u64 },
    /// `Magistrate::traits`: move `greed` one step within -3..=3.
    MagistrateTraits,
    /// One Yearly_Cap counter of one Soul: `part % 3` picks `credited` (+1),
    /// `capped_spent` (+1) or `cap_year` (+1).
    JossCapCounter { soul: u64, part: u8 },
    /// `World::slot_ids`: counter plus one.
    SlotIdCounter,
    /// `World::slots`: insert an open Birth_Slot under the counter's next id.
    AddSlot,
    /// `BirthSlot::birth` of one slot: plus one.
    SlotBirth { slot: u64 },
    /// `World::player_wait`: bump `access_from`, or install a wait when there is none.
    PlayerWait,
    /// `Nodes::resolved`: change one record's `applied` to the next option, or install
    /// one record when the run has none.
    NodeRecordApplied { record: u64 },
    /// `Derived::living_names`: add a free full name. **Not checksummed** (R16.5).
    DerivedName,
    /// `Derived::last_grievance`: add or bump one pair. **Not checksummed** (R16.5).
    DerivedGrievance,
}

fn index_of(len: usize, selector: u64) -> Option<usize> {
    let n = u64::try_from(len).ok().filter(|n| *n != 0)?;
    usize::try_from(selector.checked_rem(n)?).ok()
}

/// `items[selector % len]`, if any.
fn pick<T>(items: &[T], selector: u64) -> Option<&T> {
    items.get(index_of(items.len(), selector)?)
}

/// Applies `mutation` to `world`. Returns `true` if the state changed; `false` when the
/// mutation has no target (an empty collection).
pub fn apply(world: &mut World, mutation: Mutation) -> bool {
    // Exhaustive: a new `World` field is a compile error until it is handled below.
    let World {
        seed,
        config,
        params,
        tick,
        person_ids,
        household_ids,
        property_ids,
        persons,
        households,
        properties,
        relations,
        debts,
        souls,
        log,
        flows,
        rejections,
        magistrate,
        joss,
        slot_ids,
        slots,
        player_wait,
        nodes,
        derived,
    } = world;

    match mutation {
        Mutation::Seed { bit } => {
            *seed ^= 1u64.rotate_left(u32::from(bit));
            true
        }
        Mutation::ConfigOpeningResidents => {
            // Exhaustive: a new `WorldConfig` field is a compile error here.
            let WorldConfig { opening_residents } = config;
            *opening_residents = if *opening_residents >= 60 {
                59
            } else {
                opening_residents.saturating_add(1)
            };
            true
        }
        Mutation::ParamsUpkeep => {
            params.upkeep = params.upkeep.saturating_add(1);
            true
        }
        Mutation::Tick => {
            *tick = Tick(tick.0.wrapping_add(1));
            true
        }
        Mutation::PersonIdCounter => {
            *person_ids = IdCounter::starting_at(person_ids.peek().wrapping_add(1));
            true
        }
        Mutation::HouseholdIdCounter => {
            *household_ids = IdCounter::starting_at(household_ids.peek().wrapping_add(1));
            true
        }
        Mutation::PropertyIdCounter => {
            *property_ids = IdCounter::starting_at(property_ids.peek().wrapping_add(1));
            true
        }
        Mutation::SoulIdCounter => {
            souls.ids = IdCounter::starting_at(souls.ids.peek().wrapping_add(1));
            true
        }
        Mutation::PersonField { person, part } => {
            let keys: Vec<PersonId> = persons.keys().copied().collect();
            let Some(&key) = pick(&keys, person) else {
                return false;
            };
            // Exhaustive: a new `Person` field is a compile error here.
            let Some(Person {
                id: _,
                name,
                birth_day,
                sex,
                origin,
                traits,
                soul,
                wage,
                life,
            }) = persons.get_mut(&key)
            else {
                return false;
            };
            match part % 12 {
                0 => {
                    let count = u16::try_from(FEMALE_FIRST_COUNT).unwrap_or(80);
                    name.first = name.first.wrapping_add(1).checked_rem(count).unwrap_or(0);
                }
                1 => {
                    let count = u16::try_from(SURNAME_COUNT).unwrap_or(60);
                    name.surname = name.surname.wrapping_add(1).checked_rem(count).unwrap_or(0);
                }
                2 => *birth_day = birth_day.saturating_add(1),
                3 => {
                    *sex = match sex {
                        Sex::Female => Sex::Male,
                        Sex::Male => Sex::Female,
                    }
                }
                4 => {
                    *origin = match origin {
                        Origin::Native => Origin::Possessed,
                        Origin::Possessed => Origin::Rebuilt,
                        Origin::Rebuilt => Origin::Native,
                    }
                }
                5 => {
                    let value = traits.greed.get();
                    traits.greed = Trait::clamped(if value >= 3 {
                        i64::from(value).saturating_sub(1)
                    } else {
                        i64::from(value).saturating_add(1)
                    });
                }
                6 => *soul = SoulId(soul.0.wrapping_add(1)),
                7 => *wage = wage.saturating_add(1),
                8 => {
                    if let Life::Alive { mood, .. } = life {
                        let value = i64::from(mood.get());
                        let next = if value >= 100 {
                            value.saturating_sub(1)
                        } else {
                            value.saturating_add(1)
                        };
                        *mood = Mood::clamped(next);
                    }
                }
                9 => {
                    if let Life::Alive { money, .. } = life {
                        *money = money.saturating_add(1);
                    }
                }
                10 => {
                    if let Life::Alive { household, .. } = life {
                        *household = HouseholdId(household.0.wrapping_add(1));
                    }
                }
                11 => {
                    // Exhaustive: a new `Life` field is a compile error here.
                    *life = match life {
                        Life::Alive { .. } => Life::Dead { death: *tick },
                        Life::Dead { death } => Life::Dead {
                            death: Tick(death.0.wrapping_add(1)),
                        },
                    };
                }
                _ => return false,
            }
            true
        }
        Mutation::AddPerson => {
            let id = PersonId(person_ids.peek());
            if persons.contains_key(&id) {
                return false;
            }
            let household = households.keys().next().copied().unwrap_or(HouseholdId(1));
            persons
                .insert(
                    id,
                    Person {
                        id,
                        name: crate::names::FullName {
                            first: 0,
                            surname: 0,
                        },
                        birth_day: 0,
                        sex: Sex::Female,
                        origin: Origin::Native,
                        traits: crate::values::Traits {
                            greed: Trait::new(0).expect("in range"),
                            loyalty: Trait::new(0).expect("in range"),
                            pride: Trait::new(0).expect("in range"),
                            warmth: Trait::new(0).expect("in range"),
                            temper: Trait::new(0).expect("in range"),
                            vindictiveness: Trait::new(0).expect("in range"),
                            piety: Trait::new(0).expect("in range"),
                        },
                        soul: SoulId(1),
                        wage: 0,
                        life: Life::Alive {
                            household,
                            mood: Mood::clamped(0),
                            money: 0,
                        },
                    },
                )
                .is_none()
        }
        Mutation::RemovePerson { person } => {
            let keys: Vec<PersonId> = persons.keys().copied().collect();
            let Some(key) = pick(&keys, person).copied() else {
                return false;
            };
            persons.remove(&key).is_some()
        }
        Mutation::AddHousehold => {
            let id = HouseholdId(household_ids.peek());
            households
                .insert(id, Household { id, founded: *tick })
                .is_none()
        }
        Mutation::RemoveHousehold { household } => {
            let keys: Vec<HouseholdId> = households.keys().copied().collect();
            let Some(key) = pick(&keys, household).copied() else {
                return false;
            };
            households.remove(&key).is_some()
        }
        Mutation::AddProperty => {
            let id = PropertyId(property_ids.peek());
            let Some(owner) = persons.keys().next().copied() else {
                return false;
            };
            properties
                .insert(
                    id,
                    Property {
                        id,
                        kind: PropertyKind::Heirloom,
                        owner,
                    },
                )
                .is_none()
        }
        Mutation::RemoveProperty { property } => {
            let keys: Vec<PropertyId> = properties.keys().copied().collect();
            let Some(key) = pick(&keys, property).copied() else {
                return false;
            };
            properties.remove(&key).is_some()
        }
        Mutation::PropertyKindField { property } => {
            let keys: Vec<PropertyId> = properties.keys().copied().collect();
            let Some(&key) = pick(&keys, property) else {
                return false;
            };
            // Exhaustive: a new `Property` field is a compile error here.
            let Some(Property {
                id: _,
                kind,
                owner: _,
            }) = properties.get_mut(&key)
            else {
                return false;
            };
            *kind = match kind {
                PropertyKind::Land => PropertyKind::House,
                PropertyKind::House => PropertyKind::Shop,
                PropertyKind::Shop => PropertyKind::Heirloom,
                PropertyKind::Heirloom => PropertyKind::Land,
            };
            true
        }
        Mutation::PropertyOwner { property } => {
            let keys: Vec<PropertyId> = properties.keys().copied().collect();
            let Some(&key) = pick(&keys, property) else {
                return false;
            };
            let Some(owner) = persons.keys().last().copied() else {
                return false;
            };
            let Some(Property {
                id: _,
                kind: _,
                owner: current,
            }) = properties.get_mut(&key)
            else {
                return false;
            };
            *current = owner;
            true
        }
        Mutation::RelationAffinity { from, to, up } => {
            mutate_relation(relations, from, to, |relation| {
                let value = i64::from(relation.affinity.get());
                let next = if up {
                    value.saturating_add(1)
                } else {
                    value.saturating_sub(1)
                };
                let next = next.clamp(-100, 100);
                if next == value {
                    return false;
                }
                relation.affinity = Score::clamped(next);
                true
            })
        }
        Mutation::RelationTrust { from, to, up } => {
            mutate_relation(relations, from, to, |relation| {
                let value = i64::from(relation.trust.get());
                let next = if up {
                    value.saturating_add(1)
                } else {
                    value.saturating_sub(1)
                };
                let next = next.clamp(-100, 100);
                if next == value {
                    return false;
                }
                relation.trust = Score::clamped(next);
                true
            })
        }
        Mutation::RelationTags { from, to } => mutate_relation(relations, from, to, |relation| {
            if relation.tags.contains(RelationTag::Rival) {
                relation.tags.remove(RelationTag::Rival);
            } else {
                relation.tags.insert(RelationTag::Rival);
            }
            true
        }),
        Mutation::AddRelation { from, to } => {
            let keys: Vec<PersonId> = persons.keys().copied().collect();
            let count = keys.len();
            let (Some(first_start), Some(second_start)) =
                (index_of(count, from), index_of(count, to))
            else {
                return false;
            };
            // Find the first pair (starting at the selectors) that has no Relation yet.
            for offset_a in 0..count {
                let Some(a_index) = first_start.saturating_add(offset_a).checked_rem(count) else {
                    return false;
                };
                let Some(&a) = keys.get(a_index) else {
                    return false;
                };
                for offset_b in 0..count {
                    let Some(b_index) = second_start.saturating_add(offset_b).checked_rem(count)
                    else {
                        return false;
                    };
                    let Some(&b) = keys.get(b_index) else {
                        return false;
                    };
                    if a == b || relations.contains_key(&(a, b)) {
                        continue;
                    }
                    relations.insert(
                        (a, b),
                        Relation {
                            affinity: Score::clamped(0),
                            trust: Score::clamped(0),
                            tags: RelTags::empty(),
                        },
                    );
                    return true;
                }
            }
            false
        }
        Mutation::RemoveRelation { from, to } => {
            let keys: Vec<(PersonId, PersonId)> = relations.keys().copied().collect();
            let selector = from.checked_add(to).unwrap_or(from);
            let Some(index) = index_of(keys.len(), selector) else {
                return false;
            };
            let Some(key) = keys.get(index).copied() else {
                return false;
            };
            relations.remove(&key).is_some()
        }
        Mutation::AddDebt => {
            let (Some(&creditor), Some(&debtor)) = (persons.keys().next(), persons.keys().nth(1))
            else {
                return false;
            };
            let id = log.next_id();
            debts
                .insert(
                    id,
                    Debt {
                        creditor,
                        debtor,
                        principal: 100,
                        open: 100,
                        due: *tick,
                    },
                )
                .is_none()
        }
        Mutation::RemoveDebt { debt } => {
            let keys: Vec<EventId> = debts.keys().copied().collect();
            let Some(key) = pick(&keys, debt).copied() else {
                return false;
            };
            debts.remove(&key).is_some()
        }
        Mutation::DebtOpen { debt, up } => {
            let keys: Vec<EventId> = debts.keys().copied().collect();
            let Some(&key) = pick(&keys, debt) else {
                return false;
            };
            // Exhaustive: a new `Debt` field is a compile error here.
            let Some(Debt {
                creditor: _,
                debtor: _,
                principal,
                open,
                due: _,
            }) = debts.get_mut(&key)
            else {
                return false;
            };
            let next = if up {
                open.saturating_add(1).min(*principal)
            } else {
                open.saturating_sub(1).max(1)
            };
            if next == *open {
                return false;
            }
            *open = next;
            true
        }
        Mutation::DebtDue { debt } => {
            let keys: Vec<EventId> = debts.keys().copied().collect();
            let Some(&key) = pick(&keys, debt) else {
                return false;
            };
            let Some(entry) = debts.get_mut(&key) else {
                return false;
            };
            entry.due = Tick(entry.due.0.wrapping_add(1));
            true
        }
        Mutation::DebtPrincipal { debt } => {
            let keys: Vec<EventId> = debts.keys().copied().collect();
            let Some(&key) = pick(&keys, debt) else {
                return false;
            };
            let Some(entry) = debts.get_mut(&key) else {
                return false;
            };
            entry.principal = entry.principal.saturating_add(1);
            true
        }
        Mutation::DebtCreditor { debt } => {
            let keys: Vec<EventId> = debts.keys().copied().collect();
            let Some(&key) = pick(&keys, debt) else {
                return false;
            };
            let Some(current) = debts.get(&key).map(|d| d.creditor) else {
                return false;
            };
            let Some(other) = next_person_other_than_field(persons, current) else {
                return false;
            };
            if let Some(entry) = debts.get_mut(&key) {
                entry.creditor = other;
            }
            true
        }
        Mutation::DebtDebtor { debt } => {
            let keys: Vec<EventId> = debts.keys().copied().collect();
            let Some(&key) = pick(&keys, debt) else {
                return false;
            };
            let Some(current) = debts.get(&key).map(|d| d.debtor) else {
                return false;
            };
            let Some(other) = next_person_other_than_field(persons, current) else {
                return false;
            };
            if let Some(entry) = debts.get_mut(&key) {
                entry.debtor = other;
            }
            true
        }
        Mutation::SoulPlaceField { soul } => {
            let keys: Vec<SoulId> = souls.places.keys().copied().collect();
            let Some(&key) = pick(&keys, soul) else {
                return false;
            };
            // Exhaustive: a new `Souls` field is a compile error here.
            let Souls {
                places,
                player: _,
                ids: _,
            } = souls;
            let Some(place) = places.get_mut(&key) else {
                return false;
            };
            *place = match place {
                SoulPlace::Body(_) => SoulPlace::Waiting { since: *tick },
                SoulPlace::Waiting { .. } => {
                    let resident = persons
                        .values()
                        .find(|p| matches!(p.life, Life::Alive { .. }))
                        .map(|p| p.id)
                        .unwrap_or(PersonId(1));
                    SoulPlace::Body(resident)
                }
            };
            true
        }
        Mutation::AddSoul => {
            let id = SoulId(souls.ids.peek());
            souls
                .places
                .insert(id, SoulPlace::Waiting { since: *tick })
                .is_none()
        }
        Mutation::RemoveSoul { soul } => {
            let keys: Vec<SoulId> = souls.places.keys().copied().collect();
            let Some(key) = pick(&keys, soul).copied() else {
                return false;
            };
            souls.places.remove(&key).is_some()
        }
        Mutation::PlayerSoul => {
            let current = souls.player;
            let Some(other) = souls.places.keys().copied().find(|id| *id != current) else {
                return false;
            };
            souls.player = other;
            true
        }
        Mutation::EventTick { event } => {
            let keys: Vec<EventId> = log.events().iter().map(|e| e.id).collect();
            let Some(&id) = pick(&keys, event) else {
                return false;
            };
            let index = usize::try_from(id.0.saturating_sub(1)).unwrap_or(0);
            let Some(stored) = log.events_for_test_mut().get_mut(index) else {
                return false;
            };
            stored.tick = Tick(stored.tick.0.wrapping_add(1));
            log.refresh_digest();
            true
        }
        Mutation::AddEvent => log
            .push(
                *tick,
                EventKind::Birth {
                    person: PersonId(1),
                },
                CausedBy::default(),
                EventTags::empty(),
            )
            .is_ok(),
        Mutation::DropEvent { event } => {
            let len = log.len();
            let Some(index) = index_of(len, event) else {
                return false;
            };
            log.remove_for_test(index)
        }
        Mutation::FlowSources => {
            // Exhaustive: a new `FlowTotals` field is a compile error here.
            let FlowTotals { sources, sinks: _ } = flows;
            *sources = sources.saturating_add(1);
            true
        }
        Mutation::FlowSinks => {
            let FlowTotals { sources: _, sinks } = flows;
            *sinks = sinks.saturating_add(1);
            true
        }
        Mutation::RejectionCount { reason } => {
            // Exhaustive: a new `Rejections` field is a compile error here.
            let Rejections {
                count_by_reason,
                last: _,
            } = rejections;
            let n = count_by_reason.entry(reason).or_insert(0);
            let before = *n;
            *n = n.saturating_add(1);
            *n != before
        }
        Mutation::RejectionLast { part } => {
            let Rejections {
                count_by_reason: _,
                last,
            } = rejections;
            *last = match (*last, part % 4) {
                (None, _) => Some((Tick(0), InputSeq(0), RejectReason::UnknownPerson)),
                (Some(_), 3) => None,
                (Some((tick, seq, reason)), 0) => Some((Tick(tick.0.wrapping_add(1)), seq, reason)),
                (Some((tick, seq, reason)), 1) => {
                    Some((tick, InputSeq(seq.0.wrapping_add(1)), reason))
                }
                (Some((tick, seq, reason)), _) => Some((tick, seq, next_reason(reason))),
            };
            true
        }
        Mutation::MagistrateTraits => {
            // Exhaustive: a new `Magistrate` field is a compile error here.
            let crate::underworld::magistrate::Magistrate { id: _, traits } = magistrate;
            let value = traits.greed.get();
            traits.greed = Trait::clamped(if value >= 3 {
                i64::from(value).saturating_sub(1)
            } else {
                i64::from(value).saturating_add(1)
            });
            true
        }
        Mutation::JossBalance { soul } => {
            let keys: Vec<SoulId> = joss.keys().copied().collect();
            let Some(&key) = pick(&keys, soul) else {
                return false;
            };
            let Some(account) = joss.get_mut(&key) else {
                return false;
            };
            let Some(next) = account.balance.checked_add(1) else {
                return false;
            };
            account.balance = next;
            true
        }
        Mutation::JossCapCounter { soul, part } => {
            let keys: Vec<SoulId> = joss.keys().copied().collect();
            let Some(&key) = pick(&keys, soul) else {
                return false;
            };
            // Exhaustive: a new `JossAccount` field is a compile error here.
            let Some(JossAccount {
                balance: _,
                cap_year,
                credited,
                capped_spent,
            }) = joss.get_mut(&key)
            else {
                return false;
            };
            match part % 3 {
                0 => *credited = credited.saturating_add(1),
                1 => *capped_spent = capped_spent.saturating_add(1),
                _ => *cap_year = cap_year.wrapping_add(1),
            }
            true
        }
        Mutation::SlotIdCounter => {
            *slot_ids = IdCounter::starting_at(slot_ids.peek().wrapping_add(1));
            true
        }
        Mutation::AddSlot => {
            let Some(mother) = persons.keys().next().copied() else {
                return false;
            };
            let Ok(raw) = slot_ids.next() else {
                return false;
            };
            let id = BirthSlotId(raw);
            slots
                .insert(
                    id,
                    crate::underworld::slots::BirthSlot {
                        id,
                        mother,
                        announced: *tick,
                        birth: Tick(tick.0.wrapping_add(1)),
                    },
                )
                .is_none()
        }
        Mutation::SlotBirth { slot } => {
            let keys: Vec<BirthSlotId> = slots.keys().copied().collect();
            let Some(&key) = pick(&keys, slot) else {
                return false;
            };
            let Some(entry) = slots.get_mut(&key) else {
                return false;
            };
            entry.birth = Tick(entry.birth.0.wrapping_add(1));
            true
        }
        Mutation::PlayerWait => {
            // Exhaustive: a new `PlayerWait` field is a compile error here.
            if let Some(wait) = player_wait.as_mut() {
                let crate::underworld::player::PlayerWait {
                    ghost: _,
                    access_from,
                    claim: _,
                    carry_over: _,
                } = wait;
                *access_from = Tick(access_from.0.wrapping_add(1));
                true
            } else {
                let Some(ghost) = persons.keys().next().copied() else {
                    return false;
                };
                *player_wait = Some(crate::underworld::player::PlayerWait {
                    ghost,
                    access_from: *tick,
                    claim: None,
                    carry_over: None,
                });
                true
            }
        }
        Mutation::NodeRecordApplied { record } => {
            // Exhaustive: a new `NodeRecord` field is a compile error here.
            let keys: Vec<usize> = (0..nodes.resolved.len()).collect();
            if let Some(&index) = pick(&keys, record) {
                let Some(entry) = nodes.resolved.get_mut(index) else {
                    return false;
                };
                let crate::underworld::nodes::NodeRecord {
                    id: _,
                    tick: _,
                    family: _,
                    subject: _,
                    applied,
                    source: _,
                    rules_default: _,
                } = entry;
                let position = crate::underworld::nodes::NodeOption::ALL
                    .iter()
                    .position(|option| option == applied)
                    .unwrap_or(0);
                let next = position
                    .saturating_add(1)
                    .checked_rem(crate::underworld::nodes::NodeOption::ALL.len())
                    .unwrap_or(0);
                *applied = crate::underworld::nodes::NodeOption::ALL[next];
                return true;
            }
            let Some(subject) = persons.keys().next().copied() else {
                return false;
            };
            nodes.resolved.push(crate::underworld::nodes::NodeRecord {
                id: crate::ids::NodeId(nodes.ids.peek()),
                tick: *tick,
                family: crate::underworld::nodes::NodeFamily::DreamInterpretation,
                subject,
                applied: crate::underworld::nodes::NodeOption::HeedWarning,
                source: crate::underworld::nodes::ChoiceSource::RulesDefault,
                rules_default: crate::underworld::nodes::NodeOption::DismissDream,
            });
            true
        }
        Mutation::DerivedName => {
            // Exhaustive: a new `Derived` field is a compile error here.
            let Derived {
                last_grievance: _,
                living_names,
            } = derived;
            let mut free = None;
            'search: for surname in 0..u16::try_from(SURNAME_COUNT).unwrap_or(60) {
                for first in 0..u16::try_from(FEMALE_FIRST_COUNT).unwrap_or(80) {
                    let name = crate::names::FullName { first, surname };
                    if !living_names.contains(&name) {
                        free = Some(name);
                        break 'search;
                    }
                }
            }
            let Some(name) = free else {
                return false;
            };
            living_names.insert(name)
        }
        Mutation::DerivedGrievance => {
            let Derived {
                last_grievance,
                living_names: _,
            } = derived;
            let keys: Vec<PersonId> = persons.keys().copied().collect();
            let (Some(&a), Some(&b)) = (keys.first(), keys.get(1)) else {
                return false;
            };
            let pair = crate::world::unordered_pair(a, b);
            let next = last_grievance
                .get(&pair)
                .map_or(Some(EventId(1)), |id| id.0.checked_add(1).map(EventId));
            let Some(next) = next else {
                return false;
            };
            last_grievance.insert(pair, next);
            true
        }
    }
}

fn mutate_relation(
    relations: &mut std::collections::BTreeMap<(PersonId, PersonId), Relation>,
    from: u64,
    to: u64,
    change: impl FnOnce(&mut Relation) -> bool,
) -> bool {
    let keys: Vec<(PersonId, PersonId)> = relations.keys().copied().collect();
    let selector = from.checked_add(to).unwrap_or(from);
    let Some(index) = index_of(keys.len(), selector) else {
        return false;
    };
    let Some(key) = keys.get(index).copied() else {
        return false;
    };
    let Some(relation) = relations.get_mut(&key) else {
        return false;
    };
    change(relation)
}

fn next_person_other_than_field(
    persons: &std::collections::BTreeMap<PersonId, Person>,
    current: PersonId,
) -> Option<PersonId> {
    persons.keys().copied().find(|id| *id != current)
}

fn next_reason(reason: RejectReason) -> RejectReason {
    let position = RejectReason::ALL
        .iter()
        .position(|candidate| *candidate == reason)
        .unwrap_or(0);
    let next = position
        .checked_add(1)
        .and_then(|index| index.checked_rem(RejectReason::ALL.len()))
        .unwrap_or(0);
    RejectReason::ALL[next]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checksum::Checksum;
    use crate::tick::Sim;
    use crate::world::WorldConfig;

    fn all_mutations() -> Vec<Mutation> {
        let mut v = vec![
            Mutation::Seed { bit: 63 },
            Mutation::ConfigOpeningResidents,
            Mutation::ParamsUpkeep,
            Mutation::Tick,
            Mutation::PersonIdCounter,
            Mutation::HouseholdIdCounter,
            Mutation::PropertyIdCounter,
            Mutation::AddPerson,
            Mutation::RemovePerson { person: 0 },
            Mutation::AddHousehold,
            Mutation::RemoveHousehold { household: 0 },
            Mutation::AddProperty,
            Mutation::RemoveProperty { property: 0 },
            Mutation::PropertyKindField { property: 0 },
            Mutation::PropertyOwner { property: 0 },
            Mutation::RelationAffinity {
                from: 0,
                to: 1,
                up: true,
            },
            Mutation::RelationTrust {
                from: 0,
                to: 1,
                up: false,
            },
            Mutation::RelationTags { from: 0, to: 1 },
            Mutation::AddRelation { from: 0, to: 1 },
            Mutation::RemoveRelation { from: 0, to: 1 },
            Mutation::AddDebt,
            Mutation::RemoveDebt { debt: 0 },
            Mutation::DebtOpen { debt: 0, up: false },
            Mutation::DebtDue { debt: 0 },
            Mutation::DebtPrincipal { debt: 0 },
            Mutation::DebtCreditor { debt: 0 },
            Mutation::DebtDebtor { debt: 0 },
            Mutation::SoulPlaceField { soul: 0 },
            Mutation::AddSoul,
            Mutation::RemoveSoul { soul: 0 },
            Mutation::PlayerSoul,
            Mutation::EventTick { event: 0 },
            Mutation::AddEvent,
            Mutation::DropEvent { event: 0 },
            Mutation::FlowSources,
            Mutation::FlowSinks,
        ];
        for part in 0..12u8 {
            v.push(Mutation::PersonField { person: 0, part });
        }
        for reason in RejectReason::ALL {
            v.push(Mutation::RejectionCount { reason });
        }
        for part in 0..4u8 {
            v.push(Mutation::RejectionLast { part });
        }
        v.push(Mutation::JossBalance { soul: 0 });
        v.push(Mutation::MagistrateTraits);
        v.push(Mutation::SlotIdCounter);
        v.push(Mutation::AddSlot);
        v.push(Mutation::SlotBirth { slot: 0 });
        v.push(Mutation::PlayerWait);
        v.push(Mutation::NodeRecordApplied { record: 0 });
        for part in 0..3u8 {
            v.push(Mutation::JossCapCounter { soul: 0, part });
        }
        v
    }

    fn world() -> World {
        let mut sim = Sim::new(5, WorldConfig::try_new(40).unwrap()).unwrap();
        for _ in 0..3 {
            sim.step();
        }
        let mut world = sim.world().clone();
        // A base slot lets `SlotBirth` and a second `AddSlot` find a target.
        assert!(apply(&mut world, Mutation::AddSlot));
        world
    }

    #[test]
    fn every_state_mutation_changes_the_world_and_the_checksum() {
        let base = world();
        for mutation in all_mutations() {
            let mut w = base.clone();
            assert!(apply(&mut w, mutation), "{mutation:?} reported no change");
            assert_ne!(w, base, "{mutation:?} changed nothing");
            assert_ne!(
                Checksum::of(&w),
                Checksum::of(&base),
                "{mutation:?} did not reach the checksum"
            );
        }
    }

    #[test]
    fn derived_mutations_change_the_world_but_not_the_checksum() {
        let base = world();
        for mutation in [Mutation::DerivedName, Mutation::DerivedGrievance] {
            let mut w = base.clone();
            assert!(apply(&mut w, mutation), "{mutation:?} reported no change");
            assert_ne!(w, base, "{mutation:?} changed nothing");
            assert_eq!(
                Checksum::of(&w),
                Checksum::of(&base),
                "{mutation:?} must stay outside the checksum (R16.5)"
            );
        }
    }

    #[test]
    fn mutations_report_no_target_on_an_empty_world() {
        let mut w = World::new(1, WorldConfig::try_new(40).unwrap()).unwrap();
        w.persons.clear();
        w.households.clear();
        w.properties.clear();
        w.relations.clear();
        w.debts.clear();
        for mutation in [
            Mutation::RemovePerson { person: 0 },
            Mutation::AddProperty,
            Mutation::PropertyKindField { property: 0 },
            Mutation::AddRelation { from: 0, to: 1 },
            Mutation::AddDebt,
            Mutation::DerivedGrievance,
        ] {
            let before = w.clone();
            assert!(!apply(&mut w, mutation), "{mutation:?}");
            assert_eq!(w, before, "{mutation:?}");
        }
    }
}
