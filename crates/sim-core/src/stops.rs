//! Stop reasons and checked input submission for a running simulation.

use crate::checksum::Checksum;
use crate::ids::Tick;
use crate::world::SoulPlace;

/// Reasons the last stepped tick asked a caller to pause.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub struct StopSet {
    pub player_node: bool,
    pub player_died: bool,
    pub dream_resolved: bool,
    pub player_reborn: bool,
}

impl StopSet {
    pub const fn any(self) -> bool {
        self.player_node || self.player_died || self.dream_resolved || self.player_reborn
    }

    pub fn labels(self) -> Vec<&'static str> {
        let mut labels = Vec::with_capacity(4);
        if self.player_node {
            labels.push("player_node");
        }
        if self.player_died {
            labels.push("player_died");
        }
        if self.dream_resolved {
            labels.push("dream_resolved");
        }
        if self.player_reborn {
            labels.push("player_reborn");
        }
        labels
    }
}

/// Result of running up to a stop, or up to the requested tick bound.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct RunUntilStop {
    pub ran: u32,
    pub checksum: Option<Checksum>,
    pub stops: StopSet,
}

/// Computes stop reasons from the state before and after one tick.
pub(crate) fn stops_for(
    before_place: Option<SoulPlace>,
    after: &crate::world::World,
    tick: Tick,
    previous_resolved: usize,
) -> StopSet {
    let after_place = after.souls().places.get(&after.souls().player).copied();
    let player_died = matches!(before_place, Some(SoulPlace::Body(_)))
        && matches!(after_place, Some(SoulPlace::Waiting { .. }));
    let player_reborn = matches!(before_place, Some(SoulPlace::Waiting { .. }))
        && matches!(after_place, Some(SoulPlace::Body(_)));
    let dream_resolved = after.nodes().resolved[previous_resolved..]
        .iter()
        .any(|record| {
            record.tick == tick
                && record.family == crate::underworld::nodes::NodeFamily::DreamInterpretation
        });
    let player_node = after
        .narrator()
        .pending
        .as_ref()
        .is_some_and(|node| node.fired == tick);
    StopSet {
        player_node,
        player_died,
        dream_resolved,
        player_reborn,
    }
}
