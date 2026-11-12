//! Joss paper accounts and the Yearly_Cap (R1, R2.4 to R2.6, OP-U2).
//!
//! Every Soul has exactly one [`JossAccount`]. The account is the only place joss paper
//! is held; the Event_Log is the ledger (OP-D3 A), because every credit and every spend
//! is a field of exactly one Event. The invariant checker folds the log into these
//! balances every tick (R1.2, R1.3).
//!
//! A Cap_Year is a calendar year from tick 0: `cap_year(T) = T / 365`, rounded down
//! (OP-U2 A). The two cap counters reset lazily: the first credit or capped spend of a
//! later Cap_Year first moves the account to that year and zeroes them, so a World that
//! never touches an account pays nothing for the reset.

use crate::canon::{Canon, CanonWriter};
use crate::ids::Tick;

/// Days per Cap_Year.
pub const DAYS_PER_CAP_YEAR: u64 = 365;

/// The Cap_Year of `tick`: `tick / 365`, rounded down (OP-U2 A).
pub const fn cap_year(tick: Tick) -> u64 {
    // `DAYS_PER_CAP_YEAR` is a non-zero constant, so the division cannot fail.
    match tick.0.checked_div(DAYS_PER_CAP_YEAR) {
        Some(year) => year,
        None => 0,
    }
}

/// One Soul's joss paper account (design "Data Models").
#[derive(Clone, Copy, Eq, PartialEq, Debug, Default)]
pub struct JossAccount {
    /// Joss paper held (R1.1). Never negative; credits and spends are Events.
    pub balance: u64,
    /// The Cap_Year the two counters below belong to.
    pub cap_year: u64,
    /// Joss paper credited in `cap_year`, `0..=yearly_cap`.
    pub credited: u64,
    /// Haunting and Rebuilt_Body spends in `cap_year`, `0..=yearly_cap` (R2.6).
    pub capped_spent: u64,
}

impl JossAccount {
    /// An empty account in the Cap_Year of `tick`.
    pub fn new(tick: Tick) -> Self {
        Self {
            balance: 0,
            cap_year: cap_year(tick),
            credited: 0,
            capped_spent: 0,
        }
    }

    /// Moves the counters to the Cap_Year of `tick` when they belong to an earlier one
    /// (the lazy reset of OP-U2 A).
    fn reset_for(&mut self, tick: Tick) {
        let year = cap_year(tick);
        if year != self.cap_year {
            self.cap_year = year;
            self.credited = 0;
            self.capped_spent = 0;
        }
    }

    /// Joss paper credited in the Cap_Year of `tick` (0 when that year is later than
    /// the account's).
    pub fn credited_in(&self, tick: Tick) -> u64 {
        if cap_year(tick) == self.cap_year {
            self.credited
        } else {
            0
        }
    }

    /// Haunting and Rebuilt_Body spends in the Cap_Year of `tick` (0 when that year is
    /// later than the account's).
    pub fn capped_spent_in(&self, tick: Tick) -> u64 {
        if cap_year(tick) == self.cap_year {
            self.capped_spent
        } else {
            0
        }
    }
}

/// Credits `amount` to `account` in the Cap_Year of `tick` and returns the part actually
/// credited (R2.4): `min(amount, yearly_cap - credited)` after the lazy reset. Once the
/// cap is reached the return value is 0 and the account is unchanged; the Event keeps
/// its full `magnitude` (R2.7), which is the caller's business.
///
/// A credit that would overflow the balance is skipped whole (unreachable with the
/// documented ranges).
pub fn credit(account: &mut JossAccount, amount: u64, tick: Tick, yearly_cap: u64) -> u64 {
    account.reset_for(tick);
    let room = yearly_cap.saturating_sub(account.credited);
    let credited = amount.min(room);
    if credited == 0 {
        return 0;
    }
    let Some(balance) = account.balance.checked_add(credited) else {
        return 0;
    };
    account.balance = balance;
    account.credited = account.credited.saturating_add(credited);
    credited
}

/// Spends `price` from `account` when the balance covers it, using checked subtraction
/// (R1.1). Returns whether the spend happened; on `false` nothing changes.
pub fn spend(account: &mut JossAccount, price: u64) -> bool {
    let Some(rest) = account.balance.checked_sub(price) else {
        return false;
    };
    account.balance = rest;
    true
}

/// Whether a capped spend of `price` still fits the Yearly_Cap of the Cap_Year of
/// `tick` (R2.6). Only hauntings and Rebuilt_Body claims are capped (OP-U2 A).
pub fn capped_spend_allowed(
    account: &JossAccount,
    price: u64,
    tick: Tick,
    yearly_cap: u64,
) -> bool {
    account.capped_spent_in(tick).saturating_add(price) <= yearly_cap
}

/// Performs one capped spend (a haunting or a Rebuilt_Body claim): checks the Yearly_Cap
/// and the balance, deducts the price and records it in `capped_spent`.
///
/// Returns whether the spend happened; on `false` nothing changes.
pub fn spend_capped(account: &mut JossAccount, price: u64, tick: Tick, yearly_cap: u64) -> bool {
    if !capped_spend_allowed(account, price, tick, yearly_cap) {
        return false;
    }
    account.reset_for(tick);
    if !spend(account, price) {
        return false;
    }
    account.capped_spent = account.capped_spent.saturating_add(price);
    true
}

impl Canon for JossAccount {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            balance,
            cap_year,
            credited,
            capped_spent,
        } = self;
        balance.encode(w);
        cap_year.encode(w);
        credited.encode(w);
        capped_spent.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAP: u64 = 500;

    fn account(tick: Tick) -> JossAccount {
        JossAccount::new(tick)
    }

    #[test]
    fn cap_year_bounds_follow_calendar_years_from_tick_zero() {
        assert_eq!(cap_year(Tick(0)), 0);
        assert_eq!(cap_year(Tick(364)), 0);
        assert_eq!(cap_year(Tick(365)), 1);
        assert_eq!(cap_year(Tick(729)), 1);
        assert_eq!(cap_year(Tick(730)), 2);
        assert_eq!(cap_year(Tick(29_200)), 80);
        assert_eq!(cap_year(Tick(u64::MAX)), u64::MAX / DAYS_PER_CAP_YEAR);
    }

    #[test]
    fn credit_stops_at_the_cap_and_reports_the_part_credited() {
        let mut a = account(Tick(0));
        assert_eq!(credit(&mut a, 400, Tick(0), CAP), 400);
        assert_eq!(a.balance, 400);
        assert_eq!(a.credited, 400);
        // At the boundary: exactly the room is credited.
        assert_eq!(credit(&mut a, 150, Tick(1), CAP), 100);
        assert_eq!(a.balance, 500);
        assert_eq!(a.credited, CAP);
        // Above it: nothing is credited and the account is unchanged.
        assert_eq!(credit(&mut a, 1, Tick(2), CAP), 0);
        assert_eq!(credit(&mut a, u64::MAX, Tick(2), CAP), 0);
        assert_eq!(a.balance, 500);
        assert_eq!(a.credited, CAP);
    }

    #[test]
    fn a_zero_amount_credits_nothing() {
        let mut a = account(Tick(0));
        assert_eq!(credit(&mut a, 0, Tick(0), CAP), 0);
        assert_eq!(a, JossAccount::new(Tick(0)));
    }

    #[test]
    fn the_cap_counters_reset_lazily_in_a_later_cap_year() {
        let mut a = account(Tick(10));
        assert_eq!(credit(&mut a, CAP, Tick(10), CAP), CAP);
        assert_eq!(a.cap_year, 0);
        // Still the same Cap_Year: the cap holds.
        assert_eq!(credit(&mut a, 10, Tick(364), CAP), 0);
        // The first credit of the next Cap_Year resets the counter.
        assert_eq!(credit(&mut a, 300, Tick(365), CAP), 300);
        assert_eq!(a.cap_year, 1);
        assert_eq!(a.credited, 300);
        assert_eq!(a.balance, CAP + 300);
        // The balance is kept across the reset (OP-U8 A).
        assert_eq!(a.capped_spent, 0);
    }

    #[test]
    fn spend_uses_checked_subtraction() {
        let mut a = account(Tick(0));
        credit(&mut a, 100, Tick(0), CAP);
        assert!(!spend(&mut a, 101));
        assert_eq!(a.balance, 100);
        assert!(spend(&mut a, 100));
        assert_eq!(a.balance, 0);
        assert!(!spend(&mut a, 1));
        assert_eq!(a.balance, 0);
        // A zero price is a spend of nothing and succeeds.
        assert!(spend(&mut a, 0));
    }

    #[test]
    fn the_spend_cap_holds_at_the_yearly_cap() {
        let mut a = account(Tick(0));
        credit(&mut a, CAP, Tick(0), CAP);
        assert!(capped_spend_allowed(&a, CAP, Tick(0), CAP));
        assert!(spend_capped(&mut a, 400, Tick(0), CAP));
        assert_eq!(a.balance, 100);
        assert_eq!(a.capped_spent, 400);
        // One more than the remaining room is refused, the boundary passes.
        assert!(!capped_spend_allowed(&a, 101, Tick(0), CAP));
        assert!(!spend_capped(&mut a, 101, Tick(0), CAP));
        assert_eq!(a.balance, 100);
        assert_eq!(a.capped_spent, 400);
        assert!(spend_capped(&mut a, 100, Tick(0), CAP));
        assert_eq!(a.balance, 0);
        assert_eq!(a.capped_spent, CAP);
        // At the cap nothing else fits.
        assert!(!capped_spend_allowed(&a, 1, Tick(364), CAP));
        // A later Cap_Year starts with a fresh spend counter.
        assert!(capped_spend_allowed(&a, CAP, Tick(365), CAP));
        credit(&mut a, CAP, Tick(365), CAP);
        assert!(spend_capped(&mut a, CAP, Tick(365), CAP));
        assert_eq!(a.capped_spent, CAP);
    }

    #[test]
    fn a_capped_spend_still_needs_the_balance() {
        let mut a = account(Tick(0));
        credit(&mut a, 10, Tick(0), CAP);
        assert!(!spend_capped(&mut a, 20, Tick(0), CAP));
        assert_eq!(a.balance, 10);
        assert_eq!(a.capped_spent, 0);
        assert!(spend_capped(&mut a, 10, Tick(0), CAP));
        assert_eq!(a.balance, 0);
        assert_eq!(a.capped_spent, 10);
    }

    #[test]
    fn the_account_encodes_its_four_fields_in_order() {
        use crate::canon::encode_to_vec;
        let mut a = account(Tick(0));
        credit(&mut a, 7, Tick(0), CAP);
        assert_eq!(
            encode_to_vec(&a),
            [
                7, 0, 0, 0, 0, 0, 0, 0, // balance
                0, 0, 0, 0, 0, 0, 0, 0, // cap_year
                7, 0, 0, 0, 0, 0, 0, 0, // credited
                0, 0, 0, 0, 0, 0, 0, 0, // capped_spent
            ]
        );
    }
}
