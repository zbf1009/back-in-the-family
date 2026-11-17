//! Rebuilt_Body customization rules (first-playable task 4.1).

use crate::underworld::carry_over::{TraitName, set, value};
use crate::values::{Trait, Traits};

/// The one customization supplied with a Rebuilt_Body claim.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Customization {
    /// Set one Trait directly to a legal value.
    Set { trait_name: TraitName, value: i8 },
    /// Adjust two distinct Traits by one point in either direction.
    Adjust {
        first: (TraitName, i8),
        second: (TraitName, i8),
    },
}

/// Returns whether a customization has the shape accepted by the input contract.
pub(crate) fn is_valid(customization: Customization) -> bool {
    match customization {
        Customization::Set { value, .. } => Trait::new(value).is_some(),
        Customization::Adjust { first, second } => {
            first.0 != second.0 && matches!(first.1, -1 | 1) && matches!(second.1, -1 | 1)
        }
    }
}

/// Applies a validated customization to a Base_Traits value.
pub fn customize(mut base: Traits, customization: Customization) -> Traits {
    match customization {
        Customization::Set { trait_name, value } => {
            set(&mut base, trait_name, Trait::clamped(i64::from(value)));
        }
        Customization::Adjust { first, second } => {
            for (name, delta) in [first, second] {
                let value = value(&base, name);
                set(
                    &mut base,
                    name,
                    Trait::clamped(i64::from(value.get()).saturating_add(i64::from(delta))),
                );
            }
        }
    }
    base
}
