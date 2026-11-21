//! Own-Sim replay audit cases; no target evidence or permanent replay fixtures.

use std::sync::LazyLock;

use proptest::prelude::*;
use sim_core::canon::encode_to_vec;
use sim_core::checksum::Checksum;
use sim_core::decision_fingerprint::DecisionFingerprint;
use sim_core::ids::{NodeId, PersonId, Tick};
use sim_core::input::InputPayload;
use sim_core::narrator::PlayerOption;
use sim_core::replay::{ReplayError, ReplayFile, record, verify};
use sim_core::replay_audit::{AUDIT_FORMAT, AUDIT_VERSION, audit};
use sim_core::tick::Sim;
use sim_core::underworld::dreams::DreamIntent;
use sim_core::underworld::ghosts::connected;
use sim_core::underworld::nodes::{ChoiceSource, NodeFamily, NodeRef, NodeSpec};
use sim_core::values::SocialKind;
use sim_core::world::{Life, RejectReason, WorldConfig};

// Cache only generated simulation state, never a pre-existing target artifact. All
// source inputs are ordinary submitted inputs and Params stay at their v5 defaults.
static WAIT: LazyLock<Sim> = LazyLock::new(|| {
    let mut sim = Sim::new(185, WorldConfig::default()).unwrap();
    for _ in 0..5000 {
        if let Some(wait) = sim.world().player_wait()
            && sim.world().joss()[&sim.world().souls().player].balance
                > sim.world().params().dream_price
            && !connected(sim.world(), wait.ghost).is_empty()
        {
            return sim;
        }
        if let Some(node) = sim.world().narrator().pending.as_ref() {
            let payload = InputPayload::ChoosePlayer {
                node: node.id,
                option: node.rules_default,
            };
            sim.submit(sim.world().tick(), payload).unwrap();
        }
        sim.step();
    }
    panic!("generated seed 185 must reach a funded connected Player_Wait");
});

fn waiting_sim() -> Sim {
    WAIT.clone()
}

fn choice(
    spec: &NodeSpec,
    fingerprint: Option<DecisionFingerprint>,
    diverge: bool,
) -> InputPayload {
    let option = if diverge {
        *spec
            .options
            .iter()
            .find(|&&id| id != spec.rules_default)
            .unwrap()
    } else {
        spec.rules_default
    };
    InputPayload::Choose {
        node: NodeRef::Trigger { seq: spec.trigger },
        option,
        fingerprint,
    }
}

/// Queue both triggers before either choice, and unrelated current/future/Player
/// inputs before the triggers. The Choose's own prefix is NOT the trigger prefix.
fn queued_pair(reverse: bool) -> (Sim, [NodeSpec; 2]) {
    let mut sim = waiting_sim();
    let tick = sim.world().tick();
    let wait = sim.world().player_wait().unwrap();
    let dreamer = connected(sim.world(), wait.ghost)[0];
    let target = *sim
        .world()
        .persons()
        .iter()
        .find(|(id, person)| **id != dreamer && matches!(person.life, Life::Alive { .. }))
        .unwrap()
        .0;
    let act = InputPayload::Act {
        kind: SocialKind::Help,
        actor: dreamer,
        target,
        intensity: 40,
    };
    sim.submit(Tick(tick.0 + 100), act).unwrap();
    let player = sim.world().narrator().pending.as_ref().map_or(
        InputPayload::ChoosePlayer {
            node: NodeId(u64::MAX),
            option: PlayerOption::ComfortMourner,
        },
        |node| InputPayload::ChoosePlayer {
            node: node.id,
            option: node.rules_default,
        },
    );
    sim.submit(tick, player).unwrap();
    sim.submit(tick, act).unwrap();
    let dream = InputPayload::Dream {
        dreamer,
        intent: DreamIntent::Warn,
    };
    let bribe = InputPayload::Bribe { amount: 1 };
    let payloads = if reverse {
        [bribe, dream]
    } else {
        [dream, bribe]
    };
    let specs = payloads.map(|payload| {
        let spec = sim.preview_node(payload).unwrap();
        assert_eq!(sim.submit(tick, payload).unwrap(), spec.trigger);
        spec
    });
    assert_ne!(specs[0].family, specs[1].family);
    assert!(specs[0].trigger < specs[1].trigger);
    (sim, specs)
}

#[test]
fn same_tick_both_families_join_exact_trigger_prefix_in_both_orders() {
    for reverse in [false, true] {
        let (mut sim, specs) = queued_pair(reverse);
        let tick = sim.world().tick();
        for spec in &specs {
            let input = choice(spec, Some(DecisionFingerprint::from_bytes([7; 32])), true);
            let seq = sim.submit(tick, input).unwrap();
            assert!(seq > specs[1].trigger);
        }
        sim.step();
        let file = ReplayFile::from_sim(&sim).unwrap();
        let report = audit(&file).unwrap();
        assert_eq!(report.verified_checksums, file.ticks);
        assert_eq!(report.totals.resolved, 2);
        assert_eq!(report.totals.model_applied, 2);
        assert_eq!(report.totals.model_comparison_denominator, 2);
        assert_eq!(report.totals.model_agreement, 0);
        assert_eq!(report.totals.model_divergence, 2);
        for family in &report.per_family {
            assert_eq!(family.counts.model_applied, 1);
            assert_eq!(family.counts.resolved, 1);
        }
        for (record, spec) in sim.world().nodes().resolved.iter().zip(&specs) {
            assert_eq!(record.tick, tick);
            assert_eq!(record.family, spec.family);
            assert_eq!(record.rules_default, spec.rules_default);
            assert_eq!(record.source, ChoiceSource::External);
            let family =
                &report.per_family[usize::from(record.family == NodeFamily::MagistrateRuling)];
            assert_eq!(
                family.options[record.applied.id()].applied.model_divergence,
                1
            );
            assert_eq!(family.options[record.rules_default.id()].rules_default, 1);
        }
        assert_eq!(verify(&file), Ok(()));
    }
}

#[test]
fn defaults_human_external_and_model_external_have_separate_denominators() {
    for (has_choice, fingerprint) in [
        (false, None),
        (true, None),
        (true, Some(DecisionFingerprint::from_bytes([11; 32]))),
    ] {
        let (mut sim, specs) = queued_pair(false);
        if has_choice {
            for spec in &specs {
                sim.submit(sim.world().tick(), choice(spec, fingerprint, false))
                    .unwrap();
            }
        }
        sim.step();
        let report = audit(&ReplayFile::from_sim(&sim).unwrap()).unwrap();
        let totals = &report.totals;
        assert_eq!(totals.resolved, 2);
        assert_eq!(
            totals.resolved_rules_default,
            if has_choice { 0 } else { 2 }
        );
        assert_eq!(
            totals.other_external_without_fingerprint,
            if has_choice && fingerprint.is_none() {
                2
            } else {
                0
            }
        );
        assert_eq!(
            totals.model_applied,
            if fingerprint.is_some() { 2 } else { 0 }
        );
        assert_eq!(totals.model_comparison_denominator, totals.model_applied);
        assert_eq!(totals.model_agreement, totals.model_applied);
        assert_eq!(totals.model_divergence, 0);
        assert_eq!(
            totals.resolved,
            totals.resolved_rules_default
                + totals.model_applied
                + totals.other_external_without_fingerprint
        );
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["format"], AUDIT_FORMAT);
        assert_eq!(json["version"], AUDIT_VERSION);
        assert_eq!(json["per_family"][0]["family"], "dream_interpretation");
        assert_eq!(json["per_family"][1]["family"], "magistrate_ruling");
        assert!(
            json["totals"]
                .as_object()
                .unwrap()
                .values()
                .all(|value| value.is_u64())
        );
        assert!(json.get("attempts").is_none());
        assert!(json.get("fallback_reason").is_none());
    }
}

#[test]
fn queued_fingerprints_are_excluded_until_the_resolution_tick_completes() {
    let (mut sim, specs) = queued_pair(false);
    for spec in &specs {
        sim.submit(
            sim.world().tick(),
            choice(spec, Some(DecisionFingerprint::from_bytes([19; 32])), false),
        )
        .unwrap();
    }
    let before = ReplayFile::from_sim(&sim).unwrap();
    assert!(before.inputs.iter().any(|input| input.tick == before.ticks));
    let report = audit(&before).unwrap();
    assert_eq!(report.totals.resolved, 0);
    assert_eq!(report.totals.model_applied, 0);
    assert_eq!(report.verified_checksums, before.ticks);
    sim.step();
    assert_eq!(
        audit(&ReplayFile::from_sim(&sim).unwrap())
            .unwrap()
            .totals
            .model_applied,
        2
    );
}

#[test]
fn rejected_and_future_fingerprints_never_color_an_applied_human_choice() {
    let (mut sim, specs) = queued_pair(false);
    let tick = sim.world().tick();
    let fp = Some(DecisionFingerprint::from_bytes([29; 32]));
    // Wrong-family option rejects before a valid old-style human choice attaches.
    let wrong = InputPayload::Choose {
        node: NodeRef::Trigger {
            seq: specs[0].trigger,
        },
        option: specs[1].rules_default,
        fingerprint: fp,
    };
    sim.submit(tick, wrong).unwrap();
    for spec in &specs {
        sim.submit(tick, choice(spec, None, false)).unwrap();
        // A later duplicate fingerprint-bearing choice is rejected, even if equal.
        sim.submit(tick, choice(spec, fp, false)).unwrap();
        // A future choice naming today's trigger is neither today's provenance nor
        // a new model decision when it eventually rejects unknown_node tomorrow.
        sim.submit(Tick(tick.0 + 1), choice(spec, fp, false))
            .unwrap();
    }
    sim.step();
    assert_eq!(
        sim.last_outcomes()
            .iter()
            .filter(|outcome| {
                matches!(
                    outcome.result,
                    Err(RejectReason::OptionNotInSet | RejectReason::AlreadyChosen)
                )
            })
            .count(),
        3
    );
    sim.step();
    let totals = audit(&ReplayFile::from_sim(&sim).unwrap()).unwrap().totals;
    assert_eq!(totals.model_applied, 0);
    assert_eq!(totals.other_external_without_fingerprint, 2);
    assert_eq!(totals.resolved_rules_default, 0);
}

#[test]
fn audit_reuses_header_config_sequence_and_checksum_guards() {
    let input = InputPayload::Act {
        kind: SocialKind::Help,
        actor: PersonId(1),
        target: PersonId(2),
        intensity: 40,
    };
    let file = record(
        1,
        WorldConfig::default(),
        &[(Tick(2), input), (Tick(4), input)],
        6,
    )
    .unwrap();
    for tick in 0..file.checksums.len() {
        let mut bad = file.clone();
        bad.checksums[tick] = Checksum(bad.checksums[tick].0 ^ 1);
        assert!(
            matches!(audit(&bad), Err(ReplayError::Diverged(d)) if d.tick == Tick(u64::try_from(tick).unwrap()))
        );
        assert_eq!(audit(&bad).unwrap_err(), verify(&bad).unwrap_err());
    }
    let mut bad = file.clone();
    bad.inputs[0].seq = 1;
    assert!(matches!(
        audit(&bad),
        Err(ReplayError::InputSeqMismatch { .. })
    ));
    let mut bad = file.clone();
    bad.inputs.swap(0, 1);
    assert!(matches!(
        audit(&bad),
        Err(ReplayError::InputSeqMismatch { .. })
    ));
    let mut bad = file.clone();
    bad.config.opening_residents = 61;
    assert!(matches!(audit(&bad), Err(ReplayError::Config(_))));
    let mut bad = file.clone();
    bad.checksums.pop();
    assert!(matches!(
        audit(&bad),
        Err(ReplayError::ChecksumCount { .. })
    ));
    let mut bad = file;
    bad.version = 4;
    assert!(matches!(
        audit(&bad),
        Err(ReplayError::UnsupportedVersion { found: 4 })
    ));
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    #[test]
    fn historical_fingerprints_and_audit_are_canonical_state_neutral(
        digest in any::<[u8; 32]>(),
        reverse in any::<bool>(),
        diverge in any::<bool>(),
    ) {
        let (base, specs) = queued_pair(reverse);
        let mut human = base.clone();
        let mut model = base;
        for spec in &specs {
            human
                .submit(human.world().tick(), choice(spec, None, diverge))
                .unwrap();
            model
                .submit(
                    model.world().tick(),
                    choice(spec, Some(DecisionFingerprint::from_bytes(digest)), diverge),
                )
                .unwrap();
        }
        human.step();
        model.step();
        prop_assert_eq!(human.checksums(), model.checksums());
        prop_assert_eq!(encode_to_vec(human.world()), encode_to_vec(model.world()));
        let human_file = ReplayFile::from_sim(&human).unwrap();
        let model_file = ReplayFile::from_sim(&model).unwrap();
        let before_world = encode_to_vec(model.world());
        let before_inputs = model.inputs().all().to_vec();
        let before_checksums = model.checksums().to_vec();
        let json = model_file.to_json_string().unwrap();
        let decoded = ReplayFile::from_json_str(&json).unwrap();
        prop_assert_eq!(decoded.to_json_string().unwrap(), json);
        let report = audit(&decoded).unwrap();
        prop_assert_eq!(report.totals.model_applied, 2);
        prop_assert_eq!(report.totals.model_agreement, if diverge { 0 } else { 2 });
        prop_assert_eq!(report.totals.model_divergence, if diverge { 2 } else { 0 });
        prop_assert_eq!(
            audit(&human_file).unwrap().totals.other_external_without_fingerprint,
            2
        );
        prop_assert_eq!(encode_to_vec(model.world()), before_world);
        prop_assert_eq!(model.inputs().all(), before_inputs.as_slice());
        prop_assert_eq!(model.checksums(), before_checksums.as_slice());
        prop_assert_eq!(ReplayFile::from_sim(&model).unwrap(), model_file);
    }
}
