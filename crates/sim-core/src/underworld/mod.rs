//! The underworld: joss paper, offerings, the Magistrate, slots, Decision_Nodes and the
//! Player_Soul's wait (design "Architecture", OP-D1 A).
//!
//! One file per mechanic. This module owns the step functions that `tick.rs` calls, so
//! the tick keeps its written order and every mechanic stays testable on its own.

use crate::values::Origin;
use crate::world::{SoulPlace, World};

pub mod carry_over;
pub mod ghosts;
pub mod joss;
pub mod magistrate;
pub mod player;
pub mod slots;

/// Step 3, after the NPC releases: places the Player_Soul in a new Imported_Vessel when
/// its wait exceeds `player_max_wait` (R8.1). Any claim is released and the slot stays
/// open and unclaimed (R8.2); the placement costs no joss paper (OP-U8 A).
///
/// Running after the inputs and before the deaths lets a claim in the same tick win over
/// the placement, and the state this reads is the one the Snapshot showed.
pub(crate) fn place_player_if_overdue(world: &mut World) {
    let Some(wait) = world.player_wait.clone() else {
        return;
    };
    let Some(SoulPlace::Waiting { since }) = world.souls.places.get(&world.souls.player).copied()
    else {
        return;
    };
    if world.tick.0.saturating_sub(since.0) <= world.params.player_max_wait {
        return;
    }
    let ghost = wait.ghost;
    let trait_name = wait.carry_over;
    // R8.2: release the claim by dropping the wait.
    world.player_wait = None;
    if let Some(body) =
        crate::outsiders::create_outsider(world, world.souls.player, Origin::Possessed, 0)
    {
        crate::underworld::carry_over::apply(world, body, ghost, trait_name);
    }
}
