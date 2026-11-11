//! Outsider releases (design "Outsiders", R11, R20).
//!
//! Step 3 of the tick. Filled in task 7.3.

use crate::world::World;

/// Releases every non-player Soul whose wait exceeds Max_Wait, in Soul ID order.
pub(crate) fn release_outsiders(_world: &mut World) {}
