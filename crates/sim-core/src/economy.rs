//! Money flows and the economy tick step (design "Money_Flow list", R3.4).
//!
//! Every change to a money balance goes through [`flow`]. It is the only writer of
//! balances, so each change is exactly one documented Money_Flow and R3.5 (total money
//! after a tick equals the total before plus sources minus sinks) holds by construction.
//! A flow that would overflow `u64`, or a transfer larger than the source balance, is
//! skipped whole: nothing is half-applied and conservation still holds.
//!
//! Loans (step 7), repayments (step 8) and wages and upkeep (step 10) are filled in
//! tasks 6.1 and 6.4; until then their step functions do nothing.

use crate::canon::{Canon, CanonWriter};
use crate::ids::PersonId;
use crate::world::{Life, World};

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

/// Step 7 of the tick: loans. Filled in task 6.4.
pub(crate) fn process_loans(_world: &mut World) {}

/// Step 8 of the tick: repayments. Filled in task 6.4.
pub(crate) fn process_repayments(_world: &mut World) {}

/// Step 10 of the tick: wages and upkeep. Filled in task 6.1.
pub(crate) fn process_economy(_world: &mut World) {}

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
}
