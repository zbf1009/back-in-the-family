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

    /// Stop labels in their stable report order, without allocating.
    pub fn iter_labels(self) -> impl Iterator<Item = &'static str> {
        [
            (self.player_node, "player_node"),
            (self.player_died, "player_died"),
            (self.dream_resolved, "dream_resolved"),
            (self.player_reborn, "player_reborn"),
        ]
        .into_iter()
        .filter_map(|(present, label)| present.then_some(label))
    }

    pub fn labels(self) -> Vec<&'static str> {
        self.iter_labels().collect()
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
    let player_died = matches!(after_place, Some(SoulPlace::Waiting { since }) if since == tick);
    let player_reborn = matches!(before_place, Some(SoulPlace::Waiting { .. }))
        && (matches!(after_place, Some(SoulPlace::Body(_))) || player_died);
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
