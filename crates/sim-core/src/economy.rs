//! Money flows and the economy tick step (design "Money_Flow list", R3.4).
//!
//! Every change to a money balance goes through [`flow`]. It is the only writer of
//! balances, so each change is exactly one documented Money_Flow and R3.5 (total money
//! after a tick equals the total before plus sources minus sinks) holds by construction.
//! A flow that would overflow `u64`, or a transfer larger than the source balance, is
//! skipped whole: nothing is half-applied and conservation still holds.
//!
//! Loans (step 7) and repayments (step 8) are documented in "Loans" and "Repayments";
//! the Debts they open and close live in [`World::debts`], keyed by the `loan` Event.

use crate::canon::{Canon, CanonWriter};
use crate::events::{CausedBy, EventKind, EventTag, EventTags};
use crate::ids::{EntityId, EventId, PersonId, Tick};
use crate::rng::{StreamTag, below, draw, in_range};
use crate::values::Traits;
use crate::world::{Debt, Life, World};

/// Youngest age at which a Resident earns a wage.
const WORKING_AGE_MIN: u16 = 18;
/// Oldest age at which a Resident earns a wage.
const WORKING_AGE_MAX: u16 = 67;
/// Youngest age at which a Resident pays upkeep and may lend or borrow.
const ADULT_AGE: u16 = 18;

// Loan draw sites (design "Loans").
const LOAN_SUCCESS: u64 = 0;
const LOAN_BORROWER: u64 = 1;
const LOAN_LENDER: u64 = 2;
const LOAN_AMOUNT: u64 = 3;
const LOAN_DUE: u64 = 4;
const LOAN_TAGS: u64 = 5;
/// Smallest and largest loan amount; the upper end is also capped by half the lender's
/// balance.
const LOAN_AMOUNT_MIN: u64 = 200;
const LOAN_AMOUNT_MAX: u64 = 5_000;
/// Loan due-date band, in days after the loan tick.
const LOAN_DUE_MIN: i64 = 60;
const LOAN_DUE_MAX: i64 = 720;
/// A lender's affinity toward the borrower must be at least this.
const LOAN_AFFINITY_MIN: i8 = -10;

/// The repayment roll and its period (design "Repayments").
const REPAY_SUCCESS: u64 = 0;
const REPAY_PERIOD: u64 = 30;

/// Sources and sinks of the last tick run (design "Data Models").
///
/// Transfers between Persons do not change either total: they only move money. Reset
/// to zero at step 1 of every tick.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub struct FlowTotals {
    /// Money that entered the World this tick.
    pub sources: u64,
    /// Money that left the World this tick.
    pub sinks: u64,
}

/// One row of the documented Money_Flow list (design "Money_Flow list").
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum Flow {
    /// Source: a Resident's daily wage.
    Wage { to: PersonId },
    /// Source: an arriving outsider's endowment.
    ArrivalEndowment { to: PersonId },
    /// Sink: a Resident's daily upkeep.
    Upkeep { from: PersonId },
    /// Sink: an estate with no heir leaves the World.
    Escheat { from: PersonId },
    /// Transfer: a loan from the lender to the borrower.
    Loan { from: PersonId, to: PersonId },
    /// Transfer: a repayment from the debtor to the creditor.
    Repayment { from: PersonId, to: PersonId },
    /// Transfer: money from a deceased Person's estate to an heir.
    Inheritance { from: PersonId, to: PersonId },
}

/// The balance of a living Person; `None` when the Person is dead or unknown.
fn balance(world: &World, person: PersonId) -> Option<u64> {
    match world.persons.get(&person)?.life {
        Life::Alive { money, .. } => Some(money),
        Life::Dead { .. } => None,
    }
}

/// Overwrites the balance of a living Person. Does nothing for a dead Person, whose
/// `Life::Dead` has no balance (design "Data Models").
fn set_balance(world: &mut World, person: PersonId, value: u64) {
    if let Some(p) = world.persons.get_mut(&person)
        && let Life::Alive { money, .. } = &mut p.life
    {
        *money = value;
    }
}

/// Applies one Money_Flow of `amount` dollars, all or nothing.
///
/// Returns `true` when the flow was applied (an `amount` of 0 counts as applied and
/// changes nothing), `false` when it was skipped: an actor is dead or unknown, a
/// balance or a total would overflow, or a transfer exceeds the source balance.
pub fn flow(world: &mut World, flow: Flow, amount: u64) -> bool {
    match flow {
        Flow::Wage { to } | Flow::ArrivalEndowment { to } => {
            let Some(old) = balance(world, to) else {
                return false;
            };
            let (Some(new), Some(sources)) = (
                old.checked_add(amount),
                world.flows.sources.checked_add(amount),
            ) else {
                return false;
            };
            set_balance(world, to, new);
            world.flows.sources = sources;
            true
        }
        Flow::Upkeep { from } | Flow::Escheat { from } => {
            let Some(old) = balance(world, from) else {
                return false;
            };
            let (Some(new), Some(sinks)) = (
                old.checked_sub(amount),
                world.flows.sinks.checked_add(amount),
            ) else {
                return false;
            };
            set_balance(world, from, new);
            world.flows.sinks = sinks;
            true
        }
        Flow::Loan { from, to } | Flow::Repayment { from, to } | Flow::Inheritance { from, to } => {
            if from == to {
                return false;
            }
            let (Some(payer), Some(payee)) = (balance(world, from), balance(world, to)) else {
                return false;
            };
            let (Some(payer_after), Some(payee_after)) =
                (payer.checked_sub(amount), payee.checked_add(amount))
            else {
                return false;
            };
            set_balance(world, from, payer_after);
            set_balance(world, to, payee_after);
            true
        }
    }
}

/// The affinity of `from` toward `to`; a missing Relation counts as 0.
fn affinity(world: &World, from: PersonId, to: PersonId) -> i8 {
    world
        .relations
        .get(&(from, to))
        .map_or(0, |relation| relation.affinity.get())
}

/// Step 7 of the tick: loans (design "Loans").
///
/// One world-level roll. Borrowers are adult Residents with a balance below
/// `LOAN_NEED_BELOW`; lenders are adult Residents with at least `LOAN_LENDER_MIN`, not
/// the borrower, whose affinity toward the borrower is at least -10. The amount is in
/// `200..=min(5000, lender_balance / 2)`, the due tick in `T + 60..=T + 720`. The
/// transfer goes through [`flow`], then the `loan` Event is appended and a Debt is
/// opened under its ID.
pub(crate) fn process_loans(world: &mut World) {
    let success = draw(
        world.seed,
        EntityId(0),
        StreamTag::Loans,
        world.tick,
        LOAN_SUCCESS,
    );
    if below(success, 1_000_000) >= u64::from(world.params.loan_ppm) {
        return;
    }
    let need_below = world.params.loan_need_below;
    let lender_min = world.params.loan_lender_min;
    let borrowers: Vec<PersonId> = world
        .persons
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .filter(|person| world.age_years(person) >= ADULT_AGE)
        .filter(|person| balance(world, person.id).is_some_and(|money| money < need_below))
        .map(|person| person.id)
        .collect();
    if borrowers.is_empty() {
        return;
    }
    let borrower_roll = draw(
        world.seed,
        EntityId(0),
        StreamTag::Loans,
        world.tick,
        LOAN_BORROWER,
    );
    let borrower = borrowers[usize::try_from(below(
        borrower_roll,
        u64::try_from(borrowers.len()).unwrap_or(u64::MAX),
    ))
    .unwrap_or(0)];
    let lenders: Vec<PersonId> = world
        .persons
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .filter(|person| world.age_years(person) >= ADULT_AGE)
        .filter(|person| person.id != borrower)
        .filter(|person| balance(world, person.id).is_some_and(|money| money >= lender_min))
        .filter(|person| affinity(world, person.id, borrower) >= LOAN_AFFINITY_MIN)
        .map(|person| person.id)
        .collect();
    if lenders.is_empty() {
        return;
    }
    let lender_roll = draw(
        world.seed,
        EntityId(0),
        StreamTag::Loans,
        world.tick,
        LOAN_LENDER,
    );
    let lender = lenders[usize::try_from(below(
        lender_roll,
        u64::try_from(lenders.len()).unwrap_or(u64::MAX),
    ))
    .unwrap_or(0)];
    let Some(lender_money) = balance(world, lender) else {
        return;
    };
    let limit = lender_money
        .checked_div(2)
        .unwrap_or(0)
        .min(LOAN_AMOUNT_MAX);
    if limit < LOAN_AMOUNT_MIN {
        return;
    }
    let amount = u64::try_from(in_range(
        draw(
            world.seed,
            EntityId(0),
            StreamTag::Loans,
            world.tick,
            LOAN_AMOUNT,
        ),
        i64::try_from(LOAN_AMOUNT_MIN).unwrap_or(i64::MAX),
        i64::try_from(limit).unwrap_or(i64::MAX),
    ))
    .unwrap_or(0);
    if amount == 0 {
        return;
    }
    let due_in = u64::try_from(in_range(
        draw(
            world.seed,
            EntityId(0),
            StreamTag::Loans,
            world.tick,
            LOAN_DUE,
        ),
        LOAN_DUE_MIN,
        LOAN_DUE_MAX,
    ))
    .unwrap_or(0);
    let due = Tick(world.tick.0.saturating_add(due_in));
    let mut tags = EventTags::empty();
    tags.insert(EventTag::Cash);
    let written = draw(
        world.seed,
        EntityId(0),
        StreamTag::Loans,
        world.tick,
        LOAN_TAGS,
    )
    .checked_rem(2)
        == Some(0);
    tags.insert(if written {
        EventTag::Written
    } else {
        EventTag::Verbal
    });

    let (Some(lender_before), Some(borrower_before)) =
        (balance(world, lender), balance(world, borrower))
    else {
        return;
    };
    if !flow(
        world,
        Flow::Loan {
            from: lender,
            to: borrower,
        },
        amount,
    ) {
        return;
    }
    match world.append(
        EventKind::Loan {
            lender,
            borrower,
            amount,
            due,
        },
        CausedBy::default(),
        tags,
    ) {
        Ok(loan) => {
            world.debts.insert(
                loan,
                Debt {
                    creditor: lender,
                    debtor: borrower,
                    principal: amount,
                    open: amount,
                    due,
                },
            );
        }
        Err(_) => {
            // Only an exhausted event counter can refuse here; undo the transfer so the
            // World is unchanged by the refused loan.
            set_balance(world, lender, lender_before);
            set_balance(world, borrower, borrower_before);
        }
    }
}

/// The repayment roll of a Debt, from the debtor's Traits (design "Repayments"):
/// `clamp(500_000 + 100_000*loyalty - 80_000*greed, 50_000, 950_000)` ppm.
fn repayment_ppm(traits: &Traits) -> u32 {
    let loyalty = i64::from(traits.loyalty.get());
    let greed = i64::from(traits.greed.get());
    let ppm = 500_000i64
        .saturating_add(loyalty.saturating_mul(100_000))
        .saturating_sub(greed.saturating_mul(80_000))
        .clamp(50_000, 950_000);
    u32::try_from(ppm).unwrap_or(950_000)
}

/// Step 8 of the tick: repayments (design "Repayments").
///
/// For every open Debt in loan Event ID order whose debtor is a Resident and whose
/// monthly anniversary is today, one roll keyed by the Debt decides a repayment of
/// `min(open, balance, ceil(principal / 3))`. The transfer goes through [`flow`], the
/// Debt's open amount drops by the amount, and the `repayment` Event cites the `loan`.
/// A Debt closes only when its open amount reaches 0; an overdue Debt stays open.
pub(crate) fn process_repayments(world: &mut World) {
    let loans: Vec<EventId> = world.debts.keys().copied().collect();
    for loan in loans {
        let Some(debt) = world.debts.get(&loan).cloned() else {
            continue;
        };
        let Some(loan_tick) = world.log.event(loan).map(|event| event.tick) else {
            continue;
        };
        let Some(elapsed) = world.tick.0.checked_sub(loan_tick.0) else {
            continue;
        };
        if elapsed == 0 || elapsed.checked_rem(REPAY_PERIOD) != Some(0) {
            continue;
        }
        let Some(debtor) = world.persons.get(&debt.debtor) else {
            continue;
        };
        if !matches!(debtor.life, Life::Alive { .. }) {
            continue;
        }
        let ppm = repayment_ppm(&debtor.traits);
        let roll = draw(
            world.seed,
            loan.rng_key(),
            StreamTag::Repayments,
            world.tick,
            REPAY_SUCCESS,
        );
        if below(roll, 1_000_000) >= u64::from(ppm) {
            continue;
        }
        let Some(debtor_money) = balance(world, debt.debtor) else {
            continue;
        };
        let instalment = debt
            .principal
            .checked_add(2)
            .and_then(|principal| principal.checked_div(3))
            .unwrap_or(u64::MAX);
        let amount = debt.open.min(debtor_money).min(instalment);
        if amount == 0 {
            continue;
        }
        if !flow(
            world,
            Flow::Repayment {
                from: debt.debtor,
                to: debt.creditor,
            },
            amount,
        ) {
            continue;
        }
        let remaining = debt.open.saturating_sub(amount);
        let mut tags = EventTags::empty();
        tags.insert(EventTag::Cash);
        if remaining > 0 {
            tags.insert(EventTag::Partial);
        }
        let appended = world.append(
            EventKind::Repayment {
                payer: debt.debtor,
                payee: debt.creditor,
                amount,
            },
            CausedBy::new(vec![loan]),
            tags,
        );
        if appended.is_err() {
            // Only an exhausted counter can refuse; undo the transfer.
            let _ = flow(
                world,
                Flow::Repayment {
                    from: debt.creditor,
                    to: debt.debtor,
                },
                amount,
            );
            continue;
        }
        if remaining == 0 {
            world.debts.remove(&loan);
        } else if let Some(open_debt) = world.debts.get_mut(&loan) {
            open_debt.open = remaining;
        }
    }
}

/// Step 10 of the tick: wages and upkeep (design "Economy").
///
/// Runs in Person ID order: a Resident aged 18..=67 first receives the wage as a
/// source, then a Resident aged 18+ pays `min(balance, UPKEEP)` as a sink. The upkeep
/// therefore sees the wage just credited, and every balance change goes through
/// [`flow`], so a flow that would overflow is skipped whole (R3.5).
pub(crate) fn process_economy(world: &mut World) {
    let upkeep = world.params.upkeep;
    let residents: Vec<(PersonId, u16, u16)> = world
        .persons
        .values()
        .filter(|person| matches!(person.life, Life::Alive { .. }))
        .map(|person| (person.id, world.age_years(person), person.wage))
        .collect();
    for (id, age, wage) in residents {
        if (WORKING_AGE_MIN..=WORKING_AGE_MAX).contains(&age) {
            flow(world, Flow::Wage { to: id }, u64::from(wage));
        }
        if age >= ADULT_AGE
            && let Some(current) = balance(world, id)
        {
            flow(world, Flow::Upkeep { from: id }, current.min(upkeep));
        }
    }
}

impl Canon for FlowTotals {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { sources, sinks } = self;
        sources.encode(w);
        sinks.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Tick;
    use crate::world::{World, WorldConfig};

    fn world() -> World {
        World::new(1, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn resident(world: &World, index: usize) -> PersonId {
        let mut killed = 0usize;
        for id in world.persons().keys() {
            if matches!(world.persons()[id].life, Life::Alive { .. }) {
                if killed == index {
                    return *id;
                }
                killed = killed.saturating_add(1);
            }
        }
        panic!("no living resident at index {index}");
    }

    fn money(world: &World, id: PersonId) -> u64 {
        match world.persons()[&id].life {
            Life::Alive { money, .. } => money,
            Life::Dead { .. } => 0,
        }
    }

    fn set_age(world: &mut World, id: PersonId, age: u16) {
        if let Some(person) = world.persons.get_mut(&id) {
            person.birth_day = 0i64.saturating_sub(i64::from(age).saturating_mul(365));
        }
    }

    fn set_money(world: &mut World, id: PersonId, value: u64) {
        if let Some(person) = world.persons.get_mut(&id)
            && let Life::Alive { money, .. } = &mut person.life
        {
            *money = value;
        }
    }

    fn set_wage(world: &mut World, id: PersonId, wage: u16) {
        if let Some(person) = world.persons.get_mut(&id) {
            person.wage = wage;
        }
    }

    /// Leaves only `keep` alive, so a step's flows are exactly the ones under test.
    fn isolate(world: &mut World, keep: &[PersonId]) {
        for person in world.persons.values_mut() {
            if !keep.contains(&person.id) {
                person.life = Life::Dead { death: Tick(0) };
            }
        }
    }

    #[test]
    fn wages_pay_18_to_67_and_upkeep_charges_every_adult() {
        let mut w = world();
        let a = resident(&w, 0);
        let b = resident(&w, 1);
        let c = resident(&w, 2);
        let d = resident(&w, 3);
        isolate(&mut w, &[a, b, c, d]);
        set_age(&mut w, a, 17);
        set_age(&mut w, b, 18);
        set_age(&mut w, c, 67);
        set_age(&mut w, d, 68);
        for (id, wage) in [(a, 100u16), (b, 20), (c, 30), (d, 40)] {
            set_wage(&mut w, id, wage);
            set_money(&mut w, id, 100);
        }
        w.flows = FlowTotals::default();
        process_economy(&mut w);
        // 17: no wage, no upkeep. 18: wage then upkeep. 67: wage then upkeep.
        // 68: no wage, upkeep only.
        assert_eq!(money(&w, a), 100);
        assert_eq!(money(&w, b), 90);
        assert_eq!(money(&w, c), 100);
        assert_eq!(money(&w, d), 70);
        assert_eq!(
            w.flows,
            FlowTotals {
                sources: 50,
                sinks: 90
            }
        );
    }

    #[test]
    fn upkeep_never_exceeds_the_balance_and_sees_the_wage_first() {
        let mut w = world();
        let a = resident(&w, 0);
        let b = resident(&w, 1);
        isolate(&mut w, &[a, b]);
        set_age(&mut w, a, 30);
        set_age(&mut w, b, 30);
        set_wage(&mut w, a, 20);
        set_wage(&mut w, b, 20);
        set_money(&mut w, a, 10);
        set_money(&mut w, b, 0);
        w.flows = FlowTotals::default();
        process_economy(&mut w);
        // a: 10 + 20 = 30, then min(30, 30) = 30. Running upkeep first would leave 20.
        assert_eq!(money(&w, a), 0);
        // b: 0 + 20 = 20, then min(20, 30) = 20.
        assert_eq!(money(&w, b), 0);
        assert_eq!(
            w.flows,
            FlowTotals {
                sources: 40,
                sinks: 50
            }
        );
    }

    #[test]
    fn an_overflowing_wage_is_skipped_whole_and_upkeep_still_conserves() {
        let mut w = world();
        let a = resident(&w, 0);
        // Leave one Resident so the totals are the wage and the upkeep only.
        isolate(&mut w, &[a]);
        set_age(&mut w, a, 30);
        set_wage(&mut w, a, 60);
        set_money(&mut w, a, u64::MAX);
        let before = total_money(&w);
        w.flows = FlowTotals::default();
        process_economy(&mut w);
        assert_eq!(money(&w, a), u64::MAX.saturating_sub(30));
        assert_eq!(
            w.flows,
            FlowTotals {
                sources: 0,
                sinks: 30
            },
            "the wage overflows and is skipped whole"
        );
        assert_eq!(total_money(&w), before.saturating_sub(30));
    }

    #[test]
    fn a_dead_person_earns_no_wage_and_pays_no_upkeep() {
        let mut w = world();
        let a = resident(&w, 0);
        isolate(&mut w, &[a]);
        set_age(&mut w, a, 30);
        set_wage(&mut w, a, 20);
        set_money(&mut w, a, 100);
        if let Some(person) = w.persons.get_mut(&a) {
            person.life = Life::Dead { death: Tick(0) };
        }
        w.flows = FlowTotals::default();
        process_economy(&mut w);
        assert_eq!(money(&w, a), 0);
        assert_eq!(w.flows, FlowTotals::default());
    }

    #[test]
    fn every_flow_kind_moves_money_as_documented() {
        let base = world();
        let a = resident(&base, 0);
        let b = resident(&base, 1);
        let (a0, b0) = (money(&base, a), money(&base, b));

        let mut w = base.clone();
        w.flows = FlowTotals::default();
        assert!(flow(&mut w, Flow::Wage { to: a }, 100));
        assert_eq!(money(&w, a), a0.saturating_add(100));
        assert_eq!(
            w.flows,
            FlowTotals {
                sources: 100,
                sinks: 0
            }
        );

        assert!(flow(&mut w, Flow::Upkeep { from: a }, 30));
        assert_eq!(money(&w, a), a0.saturating_add(70));
        assert_eq!(
            w.flows,
            FlowTotals {
                sources: 100,
                sinks: 30
            }
        );

        let mut w = base.clone();
        w.flows = FlowTotals::default();
        assert!(flow(&mut w, Flow::ArrivalEndowment { to: b }, 500));
        assert_eq!(money(&w, b), b0.saturating_add(500));
        assert_eq!(w.flows.sources, 500);

        let mut w = base.clone();
        w.flows = FlowTotals::default();
        assert!(flow(&mut w, Flow::Escheat { from: b }, 200));
        assert_eq!(money(&w, b), b0.saturating_sub(200));
        assert_eq!(w.flows.sinks, 200);

        for transfer in [
            Flow::Loan { from: a, to: b },
            Flow::Repayment { from: a, to: b },
            Flow::Inheritance { from: a, to: b },
        ] {
            let mut w = base.clone();
            w.flows = FlowTotals::default();
            let total_before = total_money(&w);
            assert!(flow(&mut w, transfer, 250), "{transfer:?}");
            assert_eq!(money(&w, a), a0.saturating_sub(250), "{transfer:?}");
            assert_eq!(money(&w, b), b0.saturating_add(250), "{transfer:?}");
            assert_eq!(total_money(&w), total_before, "{transfer:?} conserves");
            assert_eq!(w.flows, FlowTotals::default(), "{transfer:?} is a transfer");
        }
    }

    fn total_money(world: &World) -> u64 {
        world
            .persons()
            .values()
            .filter_map(|p| match p.life {
                Life::Alive { money, .. } => Some(money),
                Life::Dead { .. } => None,
            })
            .fold(0u64, u64::saturating_add)
    }

    #[test]
    fn a_transfer_larger_than_the_balance_is_skipped_whole() {
        let mut w = world();
        let a = resident(&w, 0);
        let b = resident(&w, 1);
        let (a0, b0) = (money(&w, a), money(&w, b));
        let before = w.clone();
        assert!(!flow(
            &mut w,
            Flow::Loan { from: a, to: b },
            a0.saturating_add(1)
        ));
        assert_eq!(w.persons(), before.persons());
        assert_eq!(w.flows, before.flows);
        assert_eq!((money(&w, a), money(&w, b)), (a0, b0));
    }

    #[test]
    fn an_overflowing_flow_is_skipped_whole() {
        let mut w = world();
        let a = resident(&w, 0);
        let before_persons = w.persons().clone();
        w.flows = FlowTotals {
            sources: u64::MAX,
            sinks: 0,
        };
        assert!(!flow(&mut w, Flow::Wage { to: a }, 1));
        assert_eq!(w.persons(), &before_persons);
        assert_eq!(
            w.flows,
            FlowTotals {
                sources: u64::MAX,
                sinks: 0
            }
        );
    }

    #[test]
    fn dead_persons_have_no_balance_and_no_flow() {
        let mut w = world();
        let a = resident(&w, 0);
        if let Some(person) = w.persons.get_mut(&a) {
            person.life = Life::Dead { death: Tick(0) };
        }
        assert!(!flow(&mut w, Flow::Wage { to: a }, 10));
        assert_eq!(w.flows, FlowTotals::default());
    }

    fn set_traits(world: &mut World, id: PersonId, loyalty: i8, greed: i8) {
        if let Some(person) = world.persons.get_mut(&id) {
            person.traits.loyalty = crate::values::Trait::new(loyalty).unwrap();
            person.traits.greed = crate::values::Trait::new(greed).unwrap();
        }
    }

    fn set_affinity(world: &mut World, from: PersonId, to: PersonId, affinity: i8) {
        world.relations.insert(
            (from, to),
            crate::world::Relation {
                affinity: crate::values::Score::clamped(i64::from(affinity)),
                trust: crate::values::Score::clamped(0),
                tags: crate::values::RelTags::empty(),
            },
        );
    }

    #[test]
    fn a_successful_loan_opens_a_debt_keyed_by_its_event() {
        let mut w = world();
        let borrower = resident(&w, 0);
        let lender = resident(&w, 1);
        isolate(&mut w, &[borrower, lender]);
        set_age(&mut w, borrower, 30);
        set_age(&mut w, lender, 30);
        set_money(&mut w, borrower, 100);
        set_money(&mut w, lender, 10_000);
        w.params.loan_ppm = 1_000_000;
        w.flows = FlowTotals::default();
        process_loans(&mut w);
        let event = w.log().events().last().expect("a loan event");
        let (event_lender, event_borrower, amount, due) = match &event.kind {
            EventKind::Loan {
                lender,
                borrower,
                amount,
                due,
            } => (*lender, *borrower, *amount, *due),
            other => panic!("expected a loan, got {other:?}"),
        };
        assert_eq!((event_lender, event_borrower), (lender, borrower));
        assert_eq!(event.tick, Tick(0));
        assert!((200..=5_000).contains(&amount), "amount {amount}");
        assert!(amount <= 5_000, "half the lender's balance caps the amount");
        assert!((60..=720).contains(&due.0), "due {}", due.0);
        assert_eq!(money(&w, borrower), 100u64.saturating_add(amount));
        assert_eq!(money(&w, lender), 10_000u64.saturating_sub(amount));
        assert_eq!(w.flows, FlowTotals::default(), "a loan is a transfer");
        let debt = w.debts().get(&event.id).expect("debt under the loan event");
        assert_eq!(debt.creditor, lender);
        assert_eq!(debt.debtor, borrower);
        assert_eq!(debt.principal, amount);
        assert_eq!(debt.open, amount);
        assert_eq!(debt.due, due);
        assert!(event.tags.contains(EventTag::Cash));
        assert_ne!(
            event.tags.contains(EventTag::Written),
            event.tags.contains(EventTag::Verbal),
            "exactly one of written and verbal"
        );
    }

    #[test]
    fn a_loan_needs_an_eligible_lender() {
        let mut w = world();
        let borrower = resident(&w, 0);
        isolate(&mut w, &[borrower]);
        set_age(&mut w, borrower, 30);
        set_money(&mut w, borrower, 100);
        w.params.loan_ppm = 1_000_000;
        let before = w.log().len();
        process_loans(&mut w);
        assert_eq!(w.log().len(), before, "no lender, no loan");

        // A lender whose affinity toward the borrower is below -10 is not eligible.
        let mut w = world();
        let borrower = resident(&w, 0);
        let lender = resident(&w, 1);
        isolate(&mut w, &[borrower, lender]);
        set_age(&mut w, borrower, 30);
        set_age(&mut w, lender, 30);
        set_money(&mut w, borrower, 100);
        set_money(&mut w, lender, 10_000);
        set_affinity(&mut w, lender, borrower, -11);
        w.params.loan_ppm = 1_000_000;
        let before = w.log().len();
        process_loans(&mut w);
        assert_eq!(w.log().len(), before, "affinity -11 is too low");

        set_affinity(&mut w, lender, borrower, -10);
        process_loans(&mut w);
        assert_eq!(
            w.log().len(),
            before.saturating_add(1),
            "affinity -10 is enough"
        );
    }

    fn open_debt(
        world: &mut World,
        creditor: PersonId,
        debtor: PersonId,
        principal: u64,
        open: u64,
    ) -> EventId {
        let loan = world
            .append(
                EventKind::Loan {
                    lender: creditor,
                    borrower: debtor,
                    amount: principal,
                    due: Tick(60),
                },
                CausedBy::default(),
                EventTags::empty(),
            )
            .unwrap();
        world.debts.insert(
            loan,
            Debt {
                creditor,
                debtor,
                principal,
                open,
                due: Tick(60),
            },
        );
        loan
    }

    /// The first anniversary tick at which the Debt's repayment roll succeeds.
    fn repayment_tick(world: &World, loan: EventId, ppm: u32) -> u64 {
        for step in 1..=24u64 {
            let tick = step.saturating_mul(REPAY_PERIOD);
            let roll = draw(
                world.seed,
                loan.rng_key(),
                StreamTag::Repayments,
                Tick(tick),
                REPAY_SUCCESS,
            );
            if below(roll, 1_000_000) < u64::from(ppm) {
                return tick;
            }
        }
        panic!("no successful repayment tick in two years");
    }

    fn repayment_setup() -> (World, PersonId, PersonId, EventId) {
        let mut w = world();
        let debtor = resident(&w, 0);
        let creditor = resident(&w, 1);
        isolate(&mut w, &[debtor, creditor]);
        set_traits(&mut w, debtor, 0, 0);
        set_money(&mut w, debtor, 1_000);
        set_money(&mut w, creditor, 0);
        let loan = open_debt(&mut w, creditor, debtor, 300, 300);
        w.debts.retain(|key, _| *key == loan);
        (w, debtor, creditor, loan)
    }

    #[test]
    fn a_repayment_happens_on_the_anniversary_only() {
        let (mut w, debtor, creditor, loan) = repayment_setup();
        let ppm = repayment_ppm(&w.persons[&debtor].traits);
        let anniversary = repayment_tick(&w, loan, ppm);

        // The day before the anniversary the Debt is untouched, whatever the roll.
        let mut early = w.clone();
        early.tick = Tick(anniversary.saturating_sub(1));
        process_repayments(&mut early);
        assert_eq!(money(&early, debtor), 1_000);
        assert_eq!(early.debts()[&loan].open, 300);

        // On the anniversary the instalment ceil(300 / 3) = 100 is paid.
        w.tick = Tick(anniversary);
        process_repayments(&mut w);
        let event = w.log().events().last().expect("a repayment event");
        let (payer, payee, amount) = match &event.kind {
            EventKind::Repayment {
                payer,
                payee,
                amount,
            } => (*payer, *payee, *amount),
            other => panic!("expected a repayment, got {other:?}"),
        };
        assert_eq!((payer, payee, amount), (debtor, creditor, 100));
        assert_eq!(event.tick, Tick(anniversary));
        assert_eq!(event.caused_by.as_slice(), &[loan]);
        assert!(event.tags.contains(EventTag::Cash));
        assert!(
            event.tags.contains(EventTag::Partial),
            "the Debt stays open"
        );
        assert_eq!(money(&w, debtor), 900);
        assert_eq!(money(&w, creditor), 100);
        assert_eq!(w.debts()[&loan].open, 200);
        assert_eq!(w.flows, FlowTotals::default(), "a repayment is a transfer");
    }

    #[test]
    fn a_debt_closes_when_its_open_amount_reaches_zero() {
        let (mut w, debtor, creditor, loan) = repayment_setup();
        if let Some(debt) = w.debts.get_mut(&loan) {
            debt.open = 100;
        }
        let ppm = repayment_ppm(&w.persons[&debtor].traits);
        let anniversary = repayment_tick(&w, loan, ppm);
        w.tick = Tick(anniversary);
        process_repayments(&mut w);
        assert!(!w.debts().contains_key(&loan), "the Debt closes at 0");
        let event = w.log().events().last().expect("a repayment event");
        assert!(!event.tags.contains(EventTag::Partial));
        assert_eq!(money(&w, debtor), 900);
        assert_eq!(money(&w, creditor), 100);
    }

    #[test]
    fn a_debtor_with_no_money_makes_no_repayment() {
        let (mut w, debtor, _creditor, loan) = repayment_setup();
        set_money(&mut w, debtor, 0);
        let ppm = repayment_ppm(&w.persons[&debtor].traits);
        let anniversary = repayment_tick(&w, loan, ppm);
        let before = w.log().len();
        w.tick = Tick(anniversary);
        process_repayments(&mut w);
        assert_eq!(w.log().len(), before, "no money, no repayment");
        assert_eq!(w.debts()[&loan].open, 300);
    }

    #[test]
    fn an_overdue_debt_stays_open() {
        let (mut w, debtor, _creditor, loan) = repayment_setup();
        // The due tick is long past; the Debt is still repaid on its anniversary and
        // is not removed for being overdue.
        if let Some(debt) = w.debts.get_mut(&loan) {
            debt.due = Tick(0);
        }
        let ppm = repayment_ppm(&w.persons[&debtor].traits);
        let anniversary = repayment_tick(&w, loan, ppm);
        w.tick = Tick(anniversary);
        process_repayments(&mut w);
        assert!(
            w.debts().contains_key(&loan),
            "the Debt stays open after its due tick"
        );
        assert!(w.debts()[&loan].open < 300, "it is still repaid on time");
    }

    #[test]
    fn repayment_ppm_follows_the_formula_and_clamps() {
        let mut w = world();
        let debtor = resident(&w, 0);
        set_traits(&mut w, debtor, 3, 3);
        assert_eq!(repayment_ppm(&w.persons[&debtor].traits), 560_000);
        set_traits(&mut w, debtor, -3, 3);
        assert_eq!(repayment_ppm(&w.persons[&debtor].traits), 50_000);
        set_traits(&mut w, debtor, 3, -3);
        assert_eq!(repayment_ppm(&w.persons[&debtor].traits), 950_000);
    }
}
