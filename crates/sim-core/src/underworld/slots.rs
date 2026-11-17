//! Birth_Slots and the Standing_Slot kinds (R7.1, R7.5, R7.6, OP-U7 A, OP-U8).
//!
//! A Birth_Slot is one announced future local birth. It opens in the tick of the
//! announcement with `birth = announced + birth_lead_days`, stays open until its birth
//! tick or until its mother dies, and holds at most one claim (the claim itself is the
//! Player_Soul's `PlayerWait::claim`, added in task 3.3). `World::slots` holds open slots
//! only, in slot ID order; a closed slot is removed, so no stale slot can be observed.

use crate::canon::{Canon, CanonWriter};
use crate::ids::{BirthSlotId, IdCounter, PersonId, Tick};
use crate::params::Params;
use crate::underworld::carry_over::{TraitName, set, value};
use crate::underworld::customization::{Customization, customize, is_valid};
use crate::values::Origin;
use crate::values::Traits;
use crate::world::{RejectReason, World};

/// One announced future local birth (design "Data Models").
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct BirthSlot {
    /// Its slot ID, from the dedicated counter (R7.1).
    pub id: BirthSlotId,
    /// The mother; her Household is the slot's Household while the slot is open.
    pub mother: PersonId,
    /// The tick the announcement rolled.
    pub announced: Tick,
    /// The tick the birth happens, `announced + birth_lead_days` (OP-U7 A).
    pub birth: Tick,
}

impl Canon for BirthSlot {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            mother,
            announced,
            birth,
        } = self;
        id.encode(w);
        mother.encode(w);
        announced.encode(w);
        birth.encode(w);
    }
}

/// One of the two Standing_Slots (R7.6, OP-U8): open exactly while the Player_Soul
/// waits, so the state is `World::player_wait` itself.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum StandingKind {
    /// The Imported_Vessel slot, the cheaper one.
    ImportedVessel,
    /// The Rebuilt_Body slot, whose price counts against the Yearly_Cap (R2.6).
    RebuiltBody,
}

impl StandingKind {
    /// The slot's price (OP-U8).
    pub fn price(self, params: &Params) -> u64 {
        match self {
            Self::ImportedVessel => params.imported_price,
            Self::RebuiltBody => params.rebuilt_price,
        }
    }

    /// The body kind the slot creates.
    pub(crate) fn origin(self) -> Origin {
        match self {
            Self::ImportedVessel => Origin::Possessed,
            Self::RebuiltBody => Origin::Rebuilt,
        }
    }

    /// Whether the price counts against the Yearly_Cap (OP-U2 A: Rebuilt only).
    pub(crate) fn capped(self) -> bool {
        matches!(self, Self::RebuiltBody)
    }
}

/// The slot a `ClaimSlot` input names (design "Inputs").
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SlotRef {
    /// An announced Birth_Slot by its ID.
    Birth(BirthSlotId),
    /// The Imported_Vessel Standing_Slot.
    ImportedVessel,
    /// The Rebuilt_Body Standing_Slot.
    RebuiltBody,
}

impl SlotRef {
    /// The Standing_Slot this ref names, if it is one.
    pub fn standing(self) -> Option<StandingKind> {
        match self {
            Self::Birth(_) => None,
            Self::ImportedVessel => Some(StandingKind::ImportedVessel),
            Self::RebuiltBody => Some(StandingKind::RebuiltBody),
        }
    }
}

/// The slot counter every World starts with.
pub(crate) const SLOT_IDS_START: u64 = 1;

/// An empty slot counter.
pub(crate) fn slot_ids() -> IdCounter {
    IdCounter::starting_at(SLOT_IDS_START)
}

/// Whether `mother` already has an open Birth_Slot (OP-U13 A).
pub(crate) fn mother_has_open_slot(world: &World, mother: PersonId) -> bool {
    world.slots.values().any(|slot| slot.mother == mother)
}

/// Opens one Birth_Slot for `mother` in the current tick (step 7). Returns `None` when
/// the slot counter is exhausted, in which case nothing changes.
pub(crate) fn open(world: &mut World, mother: PersonId) -> Option<BirthSlotId> {
    let id = BirthSlotId(world.slot_ids.next().ok()?);
    let birth = Tick(world.tick.0.saturating_add(world.params.birth_lead_days));
    world.slots.insert(
        id,
        BirthSlot {
            id,
            mother,
            announced: world.tick,
            birth,
        },
    );
    Some(id)
}

/// Closes every open Birth_Slot of a dying mother (design "Birth_Slots": the slot closes
/// in her death tick with no birth).
pub(crate) fn close_for_mother(world: &mut World, mother: PersonId) {
    let closing: Vec<BirthSlotId> = world
        .slots
        .iter()
        .filter(|(_, slot)| slot.mother == mother)
        .map(|(&id, _)| id)
        .collect();
    for id in closing {
        world.slots.remove(&id);
        // A claim on the closed slot is released; the Player_Soul keeps waiting (R8.2,
        // design "Birth_Slots").
        if let Some(wait) = world.player_wait.as_mut()
            && wait.claim == Some(id)
        {
            wait.claim = None;
        }
    }
}

/// One condition still missing before a slot can be claimed.
#[derive(Clone, Eq, PartialEq, Debug)]
pub enum Needed {
    WaitUntil(Tick),
    JossShort(u64),
    CapRoomShort(u64),
    Named(&'static str),
}

/// The eligibility and cost of a claim at `world.tick()`.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PathStatus {
    pub announced: bool,
    pub claimable: bool,
    pub affordable: bool,
    pub needed: Vec<Needed>,
}

impl PathStatus {
    pub fn executable(&self) -> bool {
        self.announced && self.claimable && self.affordable
    }
}

struct ClaimCheck {
    price: u64,
    status: PathStatus,
    first_error: Option<RejectReason>,
}

/// Read-only base Traits for a chosen Carry_Over, always using this wait's stored draw.
pub fn base_traits(world: &World, carry: Option<TraitName>) -> Option<Traits> {
    let wait = world.player_wait.as_ref()?;
    let mut base = wait.rebuilt_draw.clone();
    if let Some(name) = carry
        && let Some(ghost) = world.persons.get(&wait.ghost)
    {
        set(&mut base, name, value(&ghost.traits, name));
    }
    Some(base)
}

/// Checks every slot condition in the historical rejection order, without mutating state.
fn assess(world: &World, slot: SlotRef, customization: Option<Customization>) -> ClaimCheck {
    let mut check = ClaimCheck {
        price: slot.standing().map_or(0, |kind| kind.price(&world.params)),
        status: PathStatus {
            announced: match slot {
                SlotRef::Birth(id) => world.slots.contains_key(&id),
                _ => world.player_wait.is_some(),
            },
            claimable: true,
            affordable: true,
            needed: Vec::new(),
        },
        first_error: None,
    };
    let price = check.price;
    let mut missing = |reason: RejectReason, needed: Needed, cost: bool| {
        check.first_error.get_or_insert(reason);
        if cost {
            check.status.affordable = false;
        } else {
            check.status.claimable = false;
        }
        check.status.needed.push(needed);
    };
    if let Err(reason) = crate::underworld::player::require_waiting(world) {
        missing(reason, Needed::Named(reason.label()), false);
    }
    match (slot, customization) {
        (SlotRef::RebuiltBody, Some(c)) if is_valid(c) => {}
        (SlotRef::RebuiltBody, _) => missing(
            RejectReason::BadCustomization,
            Needed::Named("bad_customization"),
            false,
        ),
        (_, Some(_)) => missing(
            RejectReason::CustomizationNotAllowed,
            Needed::Named("customization_not_allowed"),
            false,
        ),
        _ => {}
    }
    match slot {
        SlotRef::Birth(id) => {
            if !world.slots.contains_key(&id) {
                missing(
                    RejectReason::SlotClosed,
                    Needed::Named("slot_closed"),
                    false,
                );
            }
            if let Some(wait) = world.player_wait.as_ref() {
                if wait.claim == Some(id) {
                    missing(
                        RejectReason::SlotClaimed,
                        Needed::Named("claimed_by_you"),
                        false,
                    );
                } else if wait.claim.is_some() {
                    missing(RejectReason::ClaimHeld, Needed::Named("claim_held"), false);
                }
                if world.tick < wait.access_from {
                    missing(
                        RejectReason::RegisterWait,
                        Needed::WaitUntil(wait.access_from),
                        false,
                    );
                }
            }
        }
        SlotRef::ImportedVessel | SlotRef::RebuiltBody => {
            if world.player_wait.is_some() {
                let account = world
                    .joss
                    .get(&world.souls.player)
                    .copied()
                    .unwrap_or_default();
                if account.balance < price {
                    missing(
                        RejectReason::InsufficientJoss,
                        Needed::JossShort(price.saturating_sub(account.balance)),
                        true,
                    );
                }
                if slot == SlotRef::RebuiltBody
                    && !crate::underworld::joss::capped_spend_allowed(
                        &account,
                        price,
                        world.tick,
                        world.params.yearly_cap,
                    )
                {
                    missing(
                        RejectReason::YearlyCap,
                        Needed::CapRoomShort(
                            account
                                .capped_spent_in(world.tick)
                                .saturating_add(price)
                                .saturating_sub(world.params.yearly_cap),
                        ),
                        true,
                    );
                }
                if !crate::outsiders::can_create(world)
                    || !world.joss.contains_key(&world.souls.player)
                {
                    missing(
                        RejectReason::IdExhausted,
                        Needed::Named("id_exhausted"),
                        false,
                    );
                }
            }
        }
    }
    check
}

/// Checks a claim through the same path that produces its Path_Status.
pub fn check_claim(
    world: &World,
    slot: SlotRef,
    customization: Option<Customization>,
) -> Result<u64, RejectReason> {
    let check = assess(world, slot, customization);
    check.first_error.map_or(Ok(check.price), Err)
}

/// Path_Status for the next claim tick, using a valid placeholder for Rebuilt_Body.
pub fn path_status(world: &World, slot: SlotRef) -> PathStatus {
    let placeholder = (slot == SlotRef::RebuiltBody).then_some(Customization::Set {
        trait_name: TraitName::Piety,
        value: 3,
    });
    assess(world, slot, placeholder).status
}

/// Applies one validated `ClaimSlot` input in the existing input order.
pub(crate) fn claim(
    world: &mut World,
    slot: SlotRef,
    customization: Option<Customization>,
) -> Result<(), RejectReason> {
    let price = check_claim(world, slot, customization)?;
    apply_claim(world, slot, customization, price);
    Ok(())
}

/// Mutates the World only after `check_claim` has passed.
fn apply_claim(world: &mut World, slot: SlotRef, customization: Option<Customization>, price: u64) {
    match slot {
        SlotRef::Birth(id) => {
            world.player_wait.as_mut().expect("checked wait").claim = Some(id);
        }
        SlotRef::ImportedVessel | SlotRef::RebuiltBody => {
            let wait = world.player_wait.as_ref().expect("checked wait");
            let ghost = wait.ghost;
            let carry = wait.carry_over;
            let traits = customization
                .map(|c| customize(base_traits(world, carry).expect("checked wait"), c));
            let player = world.souls.player;
            let kind = slot.standing().expect("standing slot");
            let tick = world.tick;
            let account = world.joss.get_mut(&player).expect("checked account");
            let spent = if kind.capped() {
                crate::underworld::joss::spend_capped(account, price, tick, world.params.yearly_cap)
            } else {
                crate::underworld::joss::spend(account, price)
            };
            debug_assert!(spent, "checked claim must be affordable");
            world.player_wait = None;
            let body =
                crate::outsiders::create_outsider(world, player, kind.origin(), price, traits);
            if slot == SlotRef::ImportedVessel
                && let Some(body) = body
            {
                crate::underworld::carry_over::apply(world, body, ghost, carry);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::EventKind;
    use crate::params::Params;
    use crate::world::{Life, SoulPlace, WorldConfig};

    fn world(seed: u64) -> World {
        World::new(seed, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn first_mother(world: &World) -> PersonId {
        world
            .persons()
            .values()
            .find(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .expect("the town has Residents")
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    /// A world whose Player_Soul died at tick 0 and waits with its body as the Ghost.
    fn waiting_player(params: Params) -> World {
        let mut world =
            World::new_with_params(3, WorldConfig::try_new(40).unwrap(), params).unwrap();
        let player = world.souls.player;
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        if let Some(person) = world.persons.get_mut(&body) {
            person.life = Life::Dead { death: Tick(0) };
        }
        world
            .souls
            .places
            .insert(player, SoulPlace::Waiting { since: Tick(0) });
        crate::underworld::player::start_wait(&mut world, player, Tick(0));
        world
    }

    fn give_joss(world: &mut World, amount: u64) {
        let player = world.souls.player;
        if let Some(account) = world.joss.get_mut(&player) {
            account.balance = amount;
        }
    }

    #[test]
    fn a_claim_before_access_from_is_rejected_register_wait() {
        let mut world = waiting_player(Params::DEFAULT);
        let mother = first_mother(&world);
        let slot = open(&mut world, mother).expect("the counter has room");
        assert_eq!(
            claim(&mut world, SlotRef::Birth(slot), None),
            Err(RejectReason::RegisterWait)
        );
        assert_eq!(world.player_wait().and_then(|wait| wait.claim), None);
    }

    #[test]
    fn a_second_claim_is_rejected_claim_held_and_the_first_is_slot_claimed() {
        let mut params = Params::DEFAULT;
        params.register_wait = 0;
        let mut world = waiting_player(params);
        let mothers = residents(&world);
        let first = open(&mut world, mothers[0]).expect("the counter has room");
        let second = open(&mut world, mothers[1]).expect("the counter has room");
        assert_eq!(claim(&mut world, SlotRef::Birth(first), None), Ok(()));
        assert_eq!(
            claim(&mut world, SlotRef::Birth(first), None),
            Err(RejectReason::SlotClaimed)
        );
        assert_eq!(
            claim(&mut world, SlotRef::Birth(second), None),
            Err(RejectReason::ClaimHeld)
        );
        assert_eq!(world.player_wait().and_then(|wait| wait.claim), Some(first));
    }

    #[test]
    fn a_closed_slot_is_rejected_slot_closed() {
        let mut params = Params::DEFAULT;
        params.register_wait = 0;
        let mut world = waiting_player(params);
        assert_eq!(
            claim(&mut world, SlotRef::Birth(BirthSlotId(9)), None),
            Err(RejectReason::SlotClosed)
        );
    }

    #[test]
    fn a_mothers_death_releases_a_claim_and_the_player_keeps_waiting() {
        let mut params = Params::DEFAULT;
        params.register_wait = 0;
        let mut world = waiting_player(params);
        let mother = first_mother(&world);
        let slot = open(&mut world, mother).expect("the counter has room");
        assert_eq!(claim(&mut world, SlotRef::Birth(slot), None), Ok(()));
        close_for_mother(&mut world, mother);
        assert!(!world.slots().contains_key(&slot));
        let wait = world.player_wait().expect("the Player_Soul still waits");
        assert_eq!(wait.claim, None);
        assert_eq!(
            world.souls.places[&world.souls.player],
            SoulPlace::Waiting { since: Tick(0) }
        );
    }

    #[test]
    fn a_standing_claim_with_too_little_joss_is_rejected() {
        let mut world = waiting_player(Params::DEFAULT);
        assert_eq!(
            claim(&mut world, SlotRef::ImportedVessel, None),
            Err(RejectReason::InsufficientJoss)
        );
        give_joss(&mut world, 99);
        assert_eq!(
            claim(&mut world, SlotRef::ImportedVessel, None),
            Err(RejectReason::InsufficientJoss)
        );
        assert!(world.player_wait().is_some());
    }

    #[test]
    fn a_rebuilt_claim_over_the_yearly_cap_is_rejected() {
        let mut params = Params::DEFAULT;
        params.yearly_cap = 300;
        let mut world = waiting_player(params);
        give_joss(&mut world, 1_000);
        assert_eq!(
            claim(
                &mut world,
                SlotRef::RebuiltBody,
                Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 3
                })
            ),
            Err(RejectReason::YearlyCap)
        );
        assert!(world.player_wait().is_some());
        assert_eq!(world.joss()[&world.souls.player].balance, 1_000);
    }

    #[test]
    fn an_imported_vessel_claim_spends_the_price_and_places_the_player() {
        let mut params = Params::DEFAULT;
        params.imported_price = 10;
        let mut world = waiting_player(params);
        give_joss(&mut world, 10);
        let player = world.souls.player;
        assert_eq!(claim(&mut world, SlotRef::ImportedVessel, None), Ok(()));
        assert_eq!(world.player_wait(), None);
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul was placed");
        };
        assert_eq!(
            world.persons()[&body].origin,
            crate::values::Origin::Possessed
        );
        assert_eq!(world.joss()[&player].balance, 0);
        let event = world.log().events().last().expect("an arrival Event");
        assert!(matches!(
            event.kind,
            EventKind::Possession { person, price } if person == body && price == 10
        ));
    }

    #[test]
    fn a_carry_over_copies_exactly_one_trait_and_the_fallback_none() {
        let mut params = Params::DEFAULT;
        params.imported_price = 10;
        let mut with = waiting_player(params);
        let mut without = waiting_player(params);
        let player = with.souls.player;
        let ghost = with.player_wait().expect("a wait").ghost;
        let previous = with.persons()[&ghost].traits.clone();
        crate::underworld::player::store_carry_over(
            &mut with,
            crate::underworld::carry_over::TraitName::Greed,
        )
        .expect("the Carrying_Over is stored");
        give_joss(&mut with, 10);
        give_joss(&mut without, 10);
        assert_eq!(claim(&mut with, SlotRef::ImportedVessel, None), Ok(()));
        assert_eq!(claim(&mut without, SlotRef::ImportedVessel, None), Ok(()));
        let body_with = match with.souls.places[&player] {
            SoulPlace::Body(body) => body,
            _ => panic!("placed"),
        };
        let body_without = match without.souls.places[&player] {
            SoulPlace::Body(body) => body,
            _ => panic!("placed"),
        };
        let carried = &with.persons()[&body_with].traits;
        let plain = &without.persons()[&body_without].traits;
        assert_eq!(carried.greed, previous.greed);
        assert_eq!(carried.loyalty, plain.loyalty);
        assert_eq!(carried.pride, plain.pride);
        assert_eq!(carried.warmth, plain.warmth);
        assert_eq!(carried.temper, plain.temper);
        assert_eq!(carried.vindictiveness, plain.vindictiveness);
        assert_eq!(carried.piety, plain.piety);
    }

    #[test]
    fn a_later_carry_over_replaces_the_earlier_one() {
        let mut world = waiting_player(Params::DEFAULT);
        crate::underworld::player::store_carry_over(
            &mut world,
            crate::underworld::carry_over::TraitName::Greed,
        )
        .expect("stored");
        crate::underworld::player::store_carry_over(
            &mut world,
            crate::underworld::carry_over::TraitName::Piety,
        )
        .expect("stored");
        assert_eq!(
            world.player_wait().and_then(|wait| wait.carry_over),
            Some(crate::underworld::carry_over::TraitName::Piety)
        );
    }

    #[test]
    fn underworld_inputs_before_the_first_death_are_rejected_no_ghost() {
        let mut world = world(3);
        assert_eq!(
            claim(&mut world, SlotRef::ImportedVessel, None),
            Err(RejectReason::NoGhost)
        );
        assert_eq!(
            crate::underworld::player::store_carry_over(
                &mut world,
                crate::underworld::carry_over::TraitName::Greed
            ),
            Err(RejectReason::NoGhost)
        );
    }

    #[test]
    fn inputs_after_a_rebirth_are_rejected_not_waiting() {
        let mut params = Params::DEFAULT;
        params.imported_price = 10;
        let mut world = waiting_player(params);
        give_joss(&mut world, 10);
        assert_eq!(claim(&mut world, SlotRef::ImportedVessel, None), Ok(()));
        assert_eq!(
            claim(&mut world, SlotRef::ImportedVessel, None),
            Err(RejectReason::NotWaiting)
        );
        assert_eq!(
            crate::underworld::player::store_carry_over(
                &mut world,
                crate::underworld::carry_over::TraitName::Greed
            ),
            Err(RejectReason::NotWaiting)
        );
    }

    #[test]
    fn a_claimed_slot_birth_gives_the_player_soul_and_applies_the_carry_over() {
        let mut world = waiting_player(Params::DEFAULT);
        let player = world.souls.player;
        let ghost = world.player_wait().expect("a wait").ghost;
        let previous_piety = world.persons()[&ghost].traits.piety;
        let mother = first_mother(&world);
        let slot = open(&mut world, mother).expect("the counter has room");
        crate::underworld::player::store_carry_over(
            &mut world,
            crate::underworld::carry_over::TraitName::Piety,
        )
        .expect("stored");
        if let Some(wait) = world.player_wait.as_mut() {
            wait.claim = Some(slot);
        }
        world.tick = world.slots()[&slot].birth;

        crate::births::process_slot_births(&mut world);

        assert!(world.slots().is_empty(), "the slot closed");
        assert_eq!(world.player_wait(), None);
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the newborn holds the Player_Soul");
        };
        assert_eq!(world.persons()[&body].soul, player);
        assert_eq!(world.persons()[&body].origin, crate::values::Origin::Native);
        assert_eq!(world.persons()[&body].traits.piety, previous_piety);
    }

    // Feature: first-playable, Property 11: Customization is valid only on Rebuilt_Body.
    #[test]
    fn customization_rejections_leave_the_wait_and_joss_untouched() {
        let mut world = waiting_player(Params::DEFAULT);
        give_joss(&mut world, 500);
        let player = world.souls.player;
        let before = (
            world.player_wait.clone(),
            world.joss[&player],
            world.souls.places[&player],
        );
        let invalid = [
            (SlotRef::RebuiltBody, None, RejectReason::BadCustomization),
            (
                SlotRef::RebuiltBody,
                Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 4,
                }),
                RejectReason::BadCustomization,
            ),
            (
                SlotRef::RebuiltBody,
                Some(Customization::Adjust {
                    first: (TraitName::Piety, 1),
                    second: (TraitName::Piety, -1),
                }),
                RejectReason::BadCustomization,
            ),
            (
                SlotRef::RebuiltBody,
                Some(Customization::Adjust {
                    first: (TraitName::Piety, 2),
                    second: (TraitName::Greed, -1),
                }),
                RejectReason::BadCustomization,
            ),
            (
                SlotRef::ImportedVessel,
                Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 3,
                }),
                RejectReason::CustomizationNotAllowed,
            ),
        ];
        for (slot, customization, reason) in invalid {
            assert_eq!(claim(&mut world, slot, customization), Err(reason));
            assert_eq!(
                (
                    world.player_wait.clone(),
                    world.joss[&player],
                    world.souls.places[&player]
                ),
                before
            );
        }
        let mother = first_mother(&world);
        let id = open(&mut world, mother).unwrap();
        assert_eq!(
            claim(
                &mut world,
                SlotRef::Birth(id),
                Some(Customization::Set {
                    trait_name: TraitName::Greed,
                    value: 0
                })
            ),
            Err(RejectReason::CustomizationNotAllowed)
        );
        assert_eq!(
            (
                world.player_wait.clone(),
                world.joss[&player],
                world.souls.places[&player]
            ),
            before
        );
    }

    // Feature: first-playable, Property 12: Set/Adjust act after Carry_Over.
    #[test]
    fn rebuilt_set_and_adjust_use_the_same_base_and_override_carry_over() {
        let mut world = waiting_player(Params::DEFAULT);
        give_joss(&mut world, 500);
        world.player_wait.as_mut().unwrap().carry_over = Some(TraitName::Piety);
        let base = base_traits(&world, Some(TraitName::Piety)).unwrap();
        let piety = world.persons[&world.player_wait.as_ref().unwrap().ghost]
            .traits
            .piety;
        assert_eq!(base.piety, piety);
        for c in [
            Customization::Set {
                trait_name: TraitName::Piety,
                value: 3,
            },
            Customization::Adjust {
                first: (TraitName::Piety, -1),
                second: (TraitName::Greed, 1),
            },
        ] {
            let mut copy = world.clone();
            assert_eq!(claim(&mut copy, SlotRef::RebuiltBody, Some(c)), Ok(()));
            let SoulPlace::Body(body) = copy.souls.places[&copy.souls.player] else {
                panic!("placed")
            };
            assert_eq!(copy.persons[&body].traits, customize(base.clone(), c));
            assert_eq!(
                copy.joss[&copy.souls.player].capped_spent,
                copy.params.rebuilt_price
            );
        }
    }

    // Feature: first-playable, Property 13: draw stability across read and rejection.
    #[test]
    fn rebuilt_draw_survives_reads_rejections_and_carry_changes() {
        let mut world = waiting_player(Params::DEFAULT);
        let original = world.player_wait.as_ref().unwrap().rebuilt_draw.clone();
        let checksum = crate::checksum::Checksum::of(&world);
        let _ = crate::snapshot::snapshot_json(&world);
        let _ = path_status(&world, SlotRef::RebuiltBody);
        assert_eq!(crate::checksum::Checksum::of(&world), checksum);
        assert_eq!(
            claim(&mut world, SlotRef::RebuiltBody, None),
            Err(RejectReason::BadCustomization)
        );
        assert_eq!(world.player_wait.as_ref().unwrap().rebuilt_draw, original);
        let name = TraitName::Greed;
        world.player_wait.as_mut().unwrap().carry_over = Some(name);
        assert_eq!(world.player_wait.as_ref().unwrap().rebuilt_draw, original);
        let base = base_traits(&world, Some(name)).unwrap();
        assert_eq!(
            base.greed,
            world.persons[&world.player_wait.as_ref().unwrap().ghost]
                .traits
                .greed
        );
        let mut altered = world.clone();
        let previous = altered
            .player_wait
            .as_ref()
            .unwrap()
            .rebuilt_draw
            .piety
            .get();
        altered.player_wait.as_mut().unwrap().rebuilt_draw.piety =
            crate::values::Trait::clamped(i64::from(previous) + if previous == 3 { -1 } else { 1 });
        assert_ne!(
            crate::checksum::Checksum::of(&altered),
            crate::checksum::Checksum::of(&world)
        );
    }

    // Feature: first-playable, Property 14: status predicts submitted claims.
    #[test]
    fn submitted_claim_outcome_matches_path_status_at_choice_tick() {
        use crate::input::InputPayload;
        for balance in [0, 100, 400] {
            let mut world = waiting_player(Params::DEFAULT);
            give_joss(&mut world, balance);
            let slot = SlotRef::RebuiltBody;
            let status = path_status(&world, slot);
            let expected = check_claim(
                &world,
                slot,
                Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 3,
                }),
            );
            let mut sim = crate::tick::Sim::from_test_world(world);
            sim.submit(
                sim.world().tick(),
                InputPayload::ClaimSlot {
                    slot,
                    customization: Some(Customization::Set {
                        trait_name: TraitName::Piety,
                        value: 3,
                    }),
                },
            )
            .unwrap();
            sim.step();
            assert_eq!(sim.last_outcomes()[0].result.is_ok(), status.executable());
            assert_eq!(sim.last_outcomes()[0].result.err(), expected.err());
        }
    }

    // Feature: first-playable, Property 14: the same checks power Path_Status and claims.
    #[test]
    fn status_lists_all_independent_shortfalls_and_matches_rejections() {
        let mut params = Params::DEFAULT;
        params.yearly_cap = 300;
        let mut world = waiting_player(params);
        give_joss(&mut world, 20);
        let status = path_status(&world, SlotRef::RebuiltBody);
        assert!(status.announced && status.claimable && !status.affordable);
        assert_eq!(
            status.needed,
            [Needed::JossShort(380), Needed::CapRoomShort(100)]
        );
        assert_eq!(
            check_claim(
                &world,
                SlotRef::RebuiltBody,
                Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 3
                })
            ),
            Err(RejectReason::InsufficientJoss)
        );
        give_joss(&mut world, 400);
        assert_eq!(
            check_claim(
                &world,
                SlotRef::RebuiltBody,
                Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 3
                })
            ),
            Err(RejectReason::YearlyCap)
        );
        world.params.yearly_cap = 500;
        assert!(path_status(&world, SlotRef::RebuiltBody).executable());
        assert_eq!(
            claim(
                &mut world,
                SlotRef::RebuiltBody,
                Some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 3
                })
            ),
            Ok(())
        );
    }

    #[test]
    fn an_opening_world_has_no_slots_and_an_empty_counter() {
        let world = world(3);
        assert!(world.slots().is_empty());
        assert_eq!(world.slot_ids.peek(), SLOT_IDS_START);
    }

    #[test]
    fn a_slot_opens_with_the_documented_birth_tick_and_a_fresh_id() {
        let mut world = world(3);
        let mother = first_mother(&world);
        let today = world.tick();
        let lead = world.params().birth_lead_days;
        let first = open(&mut world, mother).expect("the counter has room");
        assert_eq!(first, BirthSlotId(1));
        let slot = world.slots()[&first].clone();
        assert_eq!(slot.mother, mother);
        assert_eq!(slot.announced, today);
        assert_eq!(slot.birth, Tick(today.0.saturating_add(lead)));

        world.tick = Tick(10);
        let second = open(&mut world, mother).expect("the counter has room");
        assert_eq!(second, BirthSlotId(2));
        assert_eq!(world.slots()[&second].announced, Tick(10));
        assert_eq!(
            world.slots()[&second].birth,
            Tick(10u64.saturating_add(lead))
        );
        assert!(mother_has_open_slot(&world, mother));
    }

    #[test]
    fn a_mothers_death_closes_her_slots_and_leaves_the_others() {
        let mut world = world(3);
        let mothers: Vec<PersonId> = world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .take(2)
            .collect();
        let dying = mothers[0];
        let other = mothers[1];
        let closed = open(&mut world, dying).expect("room");
        let kept = open(&mut world, other).expect("room");
        close_for_mother(&mut world, dying);
        assert!(!world.slots().contains_key(&closed));
        assert!(world.slots().contains_key(&kept));
        assert!(!mother_has_open_slot(&world, dying));
        assert!(mother_has_open_slot(&world, other));
    }

    #[test]
    fn a_slot_encodes_its_four_fields_in_order() {
        use crate::canon::encode_to_vec;
        let slot = BirthSlot {
            id: BirthSlotId(2),
            mother: PersonId(7),
            announced: Tick(1),
            birth: Tick(11),
        };
        assert_eq!(
            encode_to_vec(&slot),
            [
                2, 0, 0, 0, 0, 0, 0, 0, // id
                7, 0, 0, 0, 0, 0, 0, 0, // mother
                1, 0, 0, 0, 0, 0, 0, 0, // announced
                11, 0, 0, 0, 0, 0, 0, 0, // birth
            ]
        );
    }

    #[test]
    fn an_exhausted_counter_opens_no_slot() {
        let mut world = world(3);
        let mother = first_mother(&world);
        world.slot_ids = IdCounter::starting_at(u64::MAX);
        assert_eq!(open(&mut world, mother), None);
        assert!(world.slots().is_empty());
    }
}
