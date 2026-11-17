//! The Carry_Over (R9, OP-U9 A).
//!
//! When the Player_Soul leaves the Waiting_Queue for a new body, the Trait named by the
//! last valid `CarryOver` input of the wait takes the previous body's value (OP-U9 A);
//! with no valid input all seven Traits stay as the new body drew them (OP-U9 A
//! fallback). Only one Trait is written, so R9.4 holds by construction, and every Trait
//! is stored in `-3..=3`, so R9.3 holds as well.

use crate::canon::{Canon, CanonWriter};
use crate::ids::PersonId;
use crate::values::{Trait, Traits};
use crate::world::World;

/// One of the seven card Traits, in card trait order (design "Inputs").
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum TraitName {
    /// `traits.greed`.
    Greed,
    /// `traits.loyalty`.
    Loyalty,
    /// `traits.pride`.
    Pride,
    /// `traits.warmth`.
    Warmth,
    /// `traits.temper`.
    Temper,
    /// `traits.vindictiveness`.
    Vindictiveness,
    /// `traits.piety`.
    Piety,
}

impl TraitName {
    /// Every Trait name, in card trait order.
    pub const ALL: [Self; 7] = [
        Self::Greed,
        Self::Loyalty,
        Self::Pride,
        Self::Warmth,
        Self::Temper,
        Self::Vindictiveness,
        Self::Piety,
    ];
}

/// The value of `name` in `traits`.
pub(crate) fn value(traits: &Traits, name: TraitName) -> Trait {
    match name {
        TraitName::Greed => traits.greed,
        TraitName::Loyalty => traits.loyalty,
        TraitName::Pride => traits.pride,
        TraitName::Warmth => traits.warmth,
        TraitName::Temper => traits.temper,
        TraitName::Vindictiveness => traits.vindictiveness,
        TraitName::Piety => traits.piety,
    }
}

/// Writes `value` into the `name` field of `traits`.
pub(crate) fn set(traits: &mut Traits, name: TraitName, value: Trait) {
    match name {
        TraitName::Greed => traits.greed = value,
        TraitName::Loyalty => traits.loyalty = value,
        TraitName::Pride => traits.pride = value,
        TraitName::Warmth => traits.warmth = value,
        TraitName::Temper => traits.temper = value,
        TraitName::Vindictiveness => traits.vindictiveness = value,
        TraitName::Piety => traits.piety = value,
    }
}

/// Applies the stored Carry_Over to the new body: with `Some(name)`, that one Trait of
/// `body` takes the previous body's (`ghost`'s) value (OP-U9 A); with `None` nothing
/// changes (the fallback). Every other Trait keeps the body's own value (R9.4), and the
/// value is already in `-3..=3` (R9.3).
///
/// A missing `body` or `ghost` is skipped, so the effect parts of R3.11 hold.
pub(crate) fn apply(
    world: &mut World,
    body: PersonId,
    ghost: PersonId,
    trait_name: Option<TraitName>,
) {
    let Some(name) = trait_name else {
        return;
    };
    let Some(source) = world
        .persons
        .get(&ghost)
        .map(|person| person.traits.clone())
    else {
        return;
    };
    let inherited = value(&source, name);
    if let Some(person) = world.persons.get_mut(&body) {
        set(&mut person.traits, name, inherited);
    }
}

impl Canon for TraitName {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Greed => 0,
            Self::Loyalty => 1,
            Self::Pride => 2,
            Self::Warmth => 3,
            Self::Temper => 4,
            Self::Vindictiveness => 5,
            Self::Piety => 6,
        };
        tag.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_trait_names_are_in_card_order_with_distinct_tags() {
        use crate::canon::encode_to_vec;
        let tags: Vec<u8> = TraitName::ALL.iter().map(|n| encode_to_vec(n)[0]).collect();
        assert_eq!(tags, [0, 1, 2, 3, 4, 5, 6]);
        assert_eq!(TraitName::ALL.len(), 7);
    }
}
