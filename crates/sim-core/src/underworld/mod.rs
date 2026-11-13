//! The underworld: joss paper, offerings, the Magistrate, slots, Decision_Nodes and the
//! Player_Soul's wait (design "Architecture", OP-D1 A).
//!
//! One file per mechanic. This module owns the step functions that `tick.rs` calls, so
//! the tick keeps its written order and every mechanic stays testable on its own.

use crate::values::Origin;
use crate::world::{SoulPlace, World};

pub mod carry_over;
pub mod dreams;
pub mod ghosts;
pub mod hauntings;
pub mod joss;
pub mod magistrate;
pub mod nodes;
pub mod offerings;
pub mod player;
pub mod slots;

pub(crate) use offerings::process_offerings;

/// Step 2b: resolves every pending node in Node ID order (design "Decision_Node
/// convention" step 3), applies the attached External_Choice or the Rules_Default
/// through the family's effect and `clamp_effect`, and writes one [`nodes::NodeRecord`]
/// per node (R3.3 to R3.6). After this step no node is pending.
///
/// A node is removed from `pending` before its effect runs, so its record is written
/// even when an effect part re-checks its state and skips itself (R3.11).
pub(crate) fn resolve_pending(world: &mut World) {
    let pending: Vec<crate::ids::NodeId> = world.nodes.pending.keys().copied().collect();
    for id in pending {
        let Some(node) = world.nodes.pending.remove(&id) else {
            continue;
        };
        let applied = node.external.unwrap_or(node.rules_default);
        let source = if node.external.is_some() {
            nodes::ChoiceSource::External
        } else {
            nodes::ChoiceSource::RulesDefault
        };
        match node.family {
            nodes::NodeFamily::DreamInterpretation => dreams::apply_effect(world, &node, applied),
            nodes::NodeFamily::MagistrateRuling => magistrate::apply_effect(world, &node, applied),
        }
        world.nodes.resolved.push(nodes::NodeRecord {
            id,
            tick: world.tick,
            family: node.family,
            subject: node.subject,
            applied,
            source,
            rules_default: node.rules_default,
        });
    }
}

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
