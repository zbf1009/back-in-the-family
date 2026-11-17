//! The single opening Debt designation and its first-life grace period.

use crate::canon::{Canon, CanonWriter};
use crate::ids::{EventId, PersonId, Tick};
use crate::world::{SoulPlace, World};

/// The opening-only construction value never escapes `opening::generate`.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum IntroDebt {
    Undesignated,
    Grace { loan: EventId, body: PersonId },
    Ended { loan: EventId },
}

impl Canon for IntroDebt {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        match *self {
            Self::Undesignated => {
                debug_assert!(false, "opening must designate its debt before a checksum");
                0u8.encode(w);
            }
            Self::Grace { loan, body } => {
                1u8.encode(w);
                loan.encode(w);
                body.encode(w);
            }
            Self::Ended { loan } => {
                2u8.encode(w);
                loan.encode(w);
            }
        }
    }
}

/// Check actual grace end conditions after resolution, death settlement and Narrator effects.
/// A transfer alone leaves the Debt open and the first life ongoing.
pub(crate) fn update(world: &mut World) {
    let IntroDebt::Grace { loan, body } = world.intro_debt else {
        return;
    };
    let first_life_ongoing = world.souls.places.get(&world.souls.player)
        == Some(&SoulPlace::Body(body))
        && world
            .narrator
            .life
            .as_ref()
            .is_none_or(|life| life.body == body && life.start == Tick(0));
    let first_node_resolved = world.narrator.life.as_ref().is_some_and(|life| {
        life.body == body
            && life.start == Tick(0)
            && life.first_fire.is_some_and(|fired| {
                world
                    .narrator
                    .chronicle
                    .entries()
                    .iter()
                    .rev()
                    .any(|entry| {
                        entry.node.is_some() && fired.0.checked_add(1) == Some(entry.tick.0)
                    })
            })
    });
    if first_node_resolved || !world.debts.contains_key(&loan) || !first_life_ongoing {
        world.intro_debt = IntroDebt::Ended { loan };
    }
}
