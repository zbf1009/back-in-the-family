//! Offline decision provenance from a single checksum-verified replay traversal.
//!
//! The input observer reads each successful trigger at its exact step-2a prefix.
//! It joins that transient trigger sequence to the real resolved NodeRecord by ID;
//! no trigger identity or fingerprint is added to canonical World state. A queued
//! choice, a rejected choice or an External choice without a fingerprint is not a
//! model-applied choice. Agreement compares options, not decision quality, and an
//! absent choice reveals neither an inference attempt nor a fallback reason.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::ids::{InputSeq, NodeId, Tick};
use crate::input::{InputPayload, TickInput};
use crate::replay::{ReplayError, ReplayFile, check_checksum, verified_sim};
use crate::underworld::nodes::{ChoiceSource, NodeFamily, NodeOption, NodeRecord};
use crate::world::World;

/// Stable JSON report schema; independent of the unchanged replay version.
pub const AUDIT_FORMAT: &str = "back-in-the-family/replay-audit";
pub const AUDIT_VERSION: u32 = 1;

/// Integer counts only. `resolved` is the denominator for source attribution;
/// `model_comparison_denominator` includes only applied fingerprint-bearing External
/// choices. The three source counts partition `resolved`.
#[derive(Clone, Default, Eq, PartialEq, Debug, Serialize)]
pub struct DecisionCounts {
    pub resolved: u64,
    pub resolved_rules_default: u64,
    pub model_applied: u64,
    pub other_external_without_fingerprint: u64,
    pub model_comparison_denominator: u64,
    pub model_agreement: u64,
    pub model_divergence: u64,
}

impl DecisionCounts {
    fn count(&mut self, record: &NodeRecord, model_applied: bool) {
        self.resolved = self.resolved.saturating_add(1);
        match record.source {
            ChoiceSource::RulesDefault => {
                self.resolved_rules_default = self.resolved_rules_default.saturating_add(1);
            }
            ChoiceSource::External if model_applied => {
                self.model_applied = self.model_applied.saturating_add(1);
                self.model_comparison_denominator =
                    self.model_comparison_denominator.saturating_add(1);
                if record.applied == record.rules_default {
                    self.model_agreement = self.model_agreement.saturating_add(1);
                } else {
                    self.model_divergence = self.model_divergence.saturating_add(1);
                }
            }
            ChoiceSource::External => {
                self.other_external_without_fingerprint =
                    self.other_external_without_fingerprint.saturating_add(1);
            }
        }
    }
}

/// Counts keyed by an option ID. `rules_default` counts that option as the frozen
/// comparator across all resolved nodes, including nodes resolved externally.
#[derive(Clone, Default, Eq, PartialEq, Debug, Serialize)]
pub struct OptionCounts {
    pub applied: DecisionCounts,
    pub rules_default: u64,
}

#[derive(Clone, Eq, PartialEq, Debug, Serialize)]
pub struct FamilyAudit {
    pub family: &'static str,
    pub counts: DecisionCounts,
    /// Lexicographically ordered option IDs; only observed applied/default options.
    pub options: BTreeMap<&'static str, OptionCounts>,
}

impl FamilyAudit {
    fn new(family: &'static str) -> Self {
        Self {
            family,
            counts: DecisionCounts::default(),
            options: BTreeMap::new(),
        }
    }

    fn count(&mut self, record: &NodeRecord, model_applied: bool) {
        self.counts.count(record, model_applied);
        self.options
            .entry(record.applied.id())
            .or_default()
            .applied
            .count(record, model_applied);
        let default = &mut self
            .options
            .entry(record.rules_default.id())
            .or_default()
            .rules_default;
        *default = default.saturating_add(1);
    }
}

/// Reports counts, never frozen contexts, names, IDs, prompts or raw model output.
#[derive(Clone, Eq, PartialEq, Debug, Serialize)]
pub struct ReplayAudit {
    pub format: &'static str,
    pub version: u32,
    pub replay_version: u32,
    pub completed_ticks: u64,
    pub verified_checksums: u64,
    pub totals: DecisionCounts,
    /// Fixed family order: dream_interpretation, magistrate_ruling, including zeros.
    pub per_family: [FamilyAudit; 2],
}

#[derive(Copy, Clone, Debug)]
struct ObservedNode {
    tick: Tick,
    trigger: InputSeq,
    family: NodeFamily,
    rules_default: NodeOption,
    external: Option<(NodeOption, bool)>,
}

fn observe_input(observed: &mut BTreeMap<NodeId, ObservedNode>, world: &World, input: &TickInput) {
    match input.payload {
        InputPayload::Dream { .. } | InputPayload::Bribe { .. } => {
            if let Some(node) = world
                .nodes()
                .pending
                .values()
                .find(|node| node.trigger == input.seq)
            {
                observed.insert(
                    node.id,
                    ObservedNode {
                        tick: input.tick,
                        trigger: input.seq,
                        family: node.family,
                        rules_default: node.rules_default,
                        external: None,
                    },
                );
            }
        }
        InputPayload::Choose {
            node,
            option,
            fingerprint,
        } => {
            // Called only after successful attach_choice; earlier/rejected duplicate
            // choices cannot overwrite the provenance of the actually applied choice.
            if let Some(pending) = world
                .nodes()
                .pending
                .values()
                .find(|pending| pending.trigger == node.trigger())
                && let Some(trigger) = observed.get_mut(&pending.id)
                && trigger.tick == input.tick
                && trigger.trigger == node.trigger()
            {
                trigger.external = Some((option, fingerprint.is_some()));
            }
        }
        _ => {}
    }
}

/// Verifies every completed checksum and audits the same forward traversal.
/// Reuses the replay codec's header/config/sequence guards and normal tick mechanics.
/// Future inputs are submitted as usual, but never observed before their tick runs.
/// Historical fingerprints are accepted by the strict replay codec's format check;
/// this audit deliberately does not compare them to today's model contract.
pub fn audit(file: &ReplayFile) -> Result<ReplayAudit, ReplayError> {
    let mut sim = verified_sim(file)?;
    let mut report = ReplayAudit {
        format: AUDIT_FORMAT,
        version: AUDIT_VERSION,
        replay_version: file.version,
        completed_ticks: file.ticks,
        verified_checksums: 0,
        totals: DecisionCounts::default(),
        per_family: [
            FamilyAudit::new("dream_interpretation"),
            FamilyAudit::new("magistrate_ruling"),
        ],
    };
    let mut observed = BTreeMap::new();
    for (tick, &expected) in (0u64..).zip(&file.checksums) {
        let start = sim.world().nodes().resolved.len();
        let actual = sim.step_observing_inputs(&mut |world, input| {
            observe_input(&mut observed, world, input);
        });
        check_checksum(Tick(tick), expected, actual)?;
        report.verified_checksums = report.verified_checksums.saturating_add(1);
        for record in &sim.world().nodes().resolved[start..] {
            let trigger = observed.remove(&record.id).ok_or_else(|| {
                ReplayError::Malformed("resolved decision has no observed trigger".to_owned())
            })?;
            let source_matches = match (record.source, trigger.external) {
                (ChoiceSource::RulesDefault, None) => record.applied == trigger.rules_default,
                (ChoiceSource::External, Some((option, _))) => option == record.applied,
                _ => false,
            };
            if trigger.tick != record.tick
                || trigger.family != record.family
                || trigger.rules_default != record.rules_default
                || !source_matches
            {
                return Err(ReplayError::Malformed(
                    "resolved decision differs from its observed trigger/choice".to_owned(),
                ));
            }
            let model_applied = matches!(trigger.external, Some((_, true)));
            report.totals.count(record, model_applied);
            let family = match record.family {
                NodeFamily::DreamInterpretation => &mut report.per_family[0],
                NodeFamily::MagistrateRuling => &mut report.per_family[1],
            };
            family.count(record, model_applied);
        }
        if !observed.is_empty() {
            return Err(ReplayError::Malformed(
                "observed decision did not resolve on its trigger tick".to_owned(),
            ));
        }
    }
    Ok(report)
}
