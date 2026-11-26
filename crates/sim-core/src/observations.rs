//! Transient, typed observations of the existing tick loop. Never canonical state.

use serde::Serialize;
use serde::ser::{SerializeSeq, Serializer};

use crate::checksum::Checksum;
use crate::events::{EventKind, mood_delta};
use crate::ids::{EventId, InputSeq, NodeId, PersonId, Tick};
use crate::input::{InputOutcome, InputPayload, TickInput};
use crate::stops::{RunUntilStop, StopSet};
use crate::underworld::nodes::{ChoiceSource, NodeFamily, NodeOption};
use crate::values::Origin;
use crate::world::{RejectReason, World};

pub(crate) trait Decimal {
    fn value(&self) -> u64;
}
macro_rules! decimal_ids {
    ($($ty:ty),+ $(,)?) => { $(
        impl Decimal for $ty {
            fn value(&self) -> u64 { self.0 }
        }
    )+ };
}
decimal_ids!(EventId, InputSeq, NodeId, Tick);
impl Decimal for u64 {
    fn value(&self) -> u64 {
        *self
    }
}
pub(crate) fn decimal<T: Decimal, S: Serializer>(value: &T, s: S) -> Result<S::Ok, S::Error> {
    s.collect_str(&value.value())
}
pub(crate) fn person<S: Serializer>(value: &PersonId, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_u64(value.0)
}
pub(crate) fn reason<S: Serializer>(value: &RejectReason, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(value.label())
}
fn sequences<S: Serializer>(values: &[InputSeq], s: S) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct Sequence(#[serde(serialize_with = "decimal")] InputSeq);
    let mut seq = s.serialize_seq(Some(values.len()))?;
    for &value in values {
        seq.serialize_element(&Sequence(value))?;
    }
    seq.end()
}
fn checksum<S: Serializer>(value: &Option<Checksum>, s: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => s.collect_str(value),
        None => s.serialize_str(""),
    }
}
fn stops<S: Serializer>(value: &StopSet, s: S) -> Result<S::Ok, S::Error> {
    let mut seq = s.serialize_seq(None)?;
    for label in value.iter_labels() {
        seq.serialize_element(label)?;
    }
    seq.end()
}

/// Actual checked admission allocation, moved from the input stream's receipt.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct SubmissionReceipt {
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    #[serde(serialize_with = "sequences")]
    pub seqs: Vec<InputSeq>,
}
#[derive(Debug, Eq, PartialEq)]
pub enum CheckedSubmission {
    Accepted(SubmissionReceipt),
    Rejected { index: usize, reason: RejectReason },
}
impl CheckedSubmission {
    pub(crate) fn from_result(
        tick: Tick,
        result: Result<Vec<InputSeq>, (usize, RejectReason)>,
    ) -> Self {
        match result {
            Ok(seqs) => Self::Accepted(SubmissionReceipt { tick, seqs }),
            Err((index, reason)) => Self::Rejected { index, reason },
        }
    }
}
impl Serialize for CheckedSubmission {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Accepted<'a> {
            ok: bool,
            #[serde(flatten)]
            receipt: &'a SubmissionReceipt,
        }
        #[derive(Serialize)]
        struct Rejected {
            ok: bool,
            index: usize,
            #[serde(serialize_with = "reason")]
            reason: RejectReason,
        }
        match self {
            Self::Accepted(receipt) => Accepted { ok: true, receipt }.serialize(s),
            Self::Rejected { index, reason } => Rejected {
                ok: false,
                index: *index,
                reason: *reason,
            }
            .serialize(s),
        }
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RulingOption {
    GrantNextSlot,
    GrantLaterSlot,
    Deny,
}
impl From<NodeOption> for RulingOption {
    fn from(value: NodeOption) -> Self {
        match value {
            NodeOption::GrantNextSlot => Self::GrantNextSlot,
            NodeOption::GrantLaterSlot => Self::GrantLaterSlot,
            NodeOption::Deny => Self::Deny,
            _ => panic!("a Magistrate ruling contains only ruling options"),
        }
    }
}
fn source<S: Serializer>(value: &ChoiceSource, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(match value {
        ChoiceSource::External => "external",
        ChoiceSource::RulesDefault => "rules_default",
    })
}
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct RulingRecord {
    #[serde(serialize_with = "decimal")]
    pub node: NodeId,
    #[serde(serialize_with = "person")]
    pub magistrate: PersonId,
    pub applied: RulingOption,
    #[serde(serialize_with = "source")]
    pub source: ChoiceSource,
    pub rules_default: RulingOption,
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BribeResult {
    Rejected {
        #[serde(serialize_with = "crate::observations::reason")]
        reason: RejectReason,
        #[serde(serialize_with = "decimal")]
        amount: u64,
    },
    Applied {
        #[serde(serialize_with = "decimal")]
        amount: u64,
        #[serde(serialize_with = "decimal")]
        offering_event: EventId,
        #[serde(serialize_with = "decimal")]
        appeal_event: EventId,
        #[serde(serialize_with = "person")]
        ghost: PersonId,
        ruling: Option<RulingRecord>,
    },
}
fn signed_decimal<S: Serializer>(value: &i64, s: S) -> Result<S::Ok, S::Error> {
    s.collect_str(value)
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum HauntResult {
    Rejected {
        #[serde(serialize_with = "crate::observations::reason")]
        reason: RejectReason,
        #[serde(serialize_with = "person")]
        target: PersonId,
    },
    Applied {
        #[serde(serialize_with = "person")]
        target: PersonId,
        #[serde(serialize_with = "person")]
        ghost: PersonId,
        #[serde(serialize_with = "decimal")]
        event: EventId,
        #[serde(serialize_with = "decimal")]
        price: u64,
        #[serde(serialize_with = "decimal")]
        intensity: u64,
        /// Event-defined signed effect before clamp, not guaranteed observed loss.
        #[serde(serialize_with = "signed_decimal")]
        mood_delta: i64,
    },
}
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionResult {
    Bribe {
        #[serde(flatten)]
        result: BribeResult,
    },
    Haunt {
        #[serde(flatten)]
        result: HauntResult,
    },
}
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct CoreActionResult {
    #[serde(serialize_with = "decimal")]
    pub input_seq: InputSeq,
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    #[serde(flatten)]
    pub result: ActionResult,
}
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleKind {
    Birth,
    Death,
    Possession,
    Rebuild,
}
fn origin<S: Serializer>(value: &Origin, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(value.as_str())
}
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct PlayerLifecycleFact {
    #[serde(serialize_with = "decimal")]
    pub event: EventId,
    #[serde(serialize_with = "decimal")]
    pub tick: Tick,
    pub kind: LifecycleKind,
    #[serde(serialize_with = "person")]
    pub body: PersonId,
    pub name: String,
    #[serde(serialize_with = "origin")]
    pub origin: Origin,
}
/// Interactive native report. Zero ticks retains the old optional-checksum semantics.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct RunUntilStopResult {
    pub ran: u32,
    #[serde(serialize_with = "checksum")]
    pub checksum: Option<Checksum>,
    #[serde(serialize_with = "stops")]
    pub stops: StopSet,
    pub actions: Vec<CoreActionResult>,
    pub player_lifecycle: Vec<PlayerLifecycleFact>,
    pub story: crate::story::StoryBatch,
}

/// Two read-only points sharing one owned state in the existing loop.
pub(crate) trait TickObserver {
    fn applied(&mut self, world: &World, input: &TickInput);
    fn completed(&mut self, _world: &World, _inputs: &[TickInput], _outcomes: &[InputOutcome]) {}
}
// Replay audit's successful-prefix callback remains a real consumer of this seam.
impl<F: FnMut(&World, &TickInput)> TickObserver for F {
    fn applied(&mut self, world: &World, input: &TickInput) {
        self(world, input);
    }
}
struct CapturedAction {
    action: CoreActionResult,
    fired: Option<NodeId>,
}
pub(crate) struct Collector {
    resolved_cursor: usize,
    successes: Vec<CapturedAction>,
    dreams: Vec<crate::story::DreamFact>,
    actions: Vec<CoreActionResult>,
    player_lifecycle: Vec<PlayerLifecycleFact>,
    story: crate::story::StoryCollector,
}
impl Collector {
    pub(crate) fn new(world: &World) -> Self {
        Self {
            resolved_cursor: world.nodes().resolved.len(),
            successes: Vec::new(),
            dreams: Vec::new(),
            actions: Vec::new(),
            player_lifecycle: Vec::new(),
            story: crate::story::StoryCollector::new(world, false),
        }
    }
    pub(crate) fn finish(self, run: RunUntilStop) -> RunUntilStopResult {
        RunUntilStopResult {
            ran: run.ran,
            checksum: run.checksum,
            stops: run.stops,
            actions: self.actions,
            player_lifecycle: self.player_lifecycle,
            story: self.story.finish(),
        }
    }
}
impl TickObserver for Collector {
    fn applied(&mut self, world: &World, input: &TickInput) {
        let (result, fired) = match input.payload {
            InputPayload::Dream {
                dreamer: submitted,
                intent,
            } => {
                let event = world
                    .log()
                    .events()
                    .last()
                    .expect("an applied Dream has its atomic tail event");
                let EventKind::Dream {
                    ghost,
                    dreamer,
                    price,
                } = event.kind
                else {
                    panic!("an applied Dream ends in its sent event");
                };
                assert_eq!(dreamer, submitted);
                assert_eq!(event.tick, input.tick);
                let node = world
                    .nodes()
                    .pending
                    .values()
                    .find(|node| {
                        node.trigger == input.seq && node.family == NodeFamily::DreamInterpretation
                    })
                    .map(|node| node.id.0);
                self.dreams.push(crate::story::DreamFact {
                    event_id: event.id,
                    input_seq: input.seq,
                    tick: input.tick,
                    ghost,
                    dreamer,
                    intent: intent.card_name(),
                    price,
                    node,
                    interpretation: None,
                });
                return;
            }
            InputPayload::Bribe { amount: submitted } => {
                let events = world.log().events();
                let [offering, appeal] = &events[events
                    .len()
                    .checked_sub(2)
                    .expect("an applied Bribe has two events")..]
                else {
                    panic!("an applied Bribe appends exactly two atomic events");
                };
                let EventKind::BribeOffering {
                    ghost,
                    magistrate,
                    amount,
                } = offering.kind
                else {
                    panic!("an applied Bribe ends in its atomic offering and appeal");
                };
                assert_eq!(amount, submitted, "the captured offering is this Bribe");
                assert_eq!(appeal.kind, EventKind::Appeal { ghost, magistrate });
                assert_eq!(offering.tick, input.tick);
                assert_eq!(appeal.tick, input.tick);
                let fired = world
                    .nodes()
                    .pending
                    .values()
                    .find(|node| {
                        node.trigger == input.seq && node.family == NodeFamily::MagistrateRuling
                    })
                    .map(|node| node.id);
                (
                    ActionResult::Bribe {
                        result: BribeResult::Applied {
                            amount,
                            offering_event: offering.id,
                            appeal_event: appeal.id,
                            ghost,
                            ruling: None,
                        },
                    },
                    fired,
                )
            }
            InputPayload::Haunt { target: submitted } => {
                let event = world
                    .log()
                    .events()
                    .last()
                    .expect("an applied Haunt has an event");
                let EventKind::Haunting {
                    ghost,
                    target,
                    intensity,
                    price,
                } = event.kind
                else {
                    panic!("an applied Haunt ends in its haunting event");
                };
                assert_eq!(target, submitted);
                assert_eq!(event.tick, input.tick);
                (
                    ActionResult::Haunt {
                        result: HauntResult::Applied {
                            target,
                            ghost,
                            event: event.id,
                            price,
                            intensity,
                            mood_delta: mood_delta(&event.kind, 1),
                        },
                    },
                    None,
                )
            }
            _ => return,
        };
        self.successes.push(CapturedAction {
            action: CoreActionResult {
                input_seq: input.seq,
                tick: input.tick,
                result,
            },
            fired,
        });
    }
    fn completed(&mut self, world: &World, inputs: &[TickInput], outcomes: &[InputOutcome]) {
        assert_eq!(
            inputs.len(),
            outcomes.len(),
            "every applied input has an outcome"
        );
        let mut successes = self.successes.drain(..);
        for (input, outcome) in inputs.iter().zip(outcomes) {
            assert_eq!(input.seq, outcome.seq, "outcomes retain actual input order");
            if !matches!(
                input.payload,
                InputPayload::Bribe { .. } | InputPayload::Haunt { .. }
            ) {
                continue;
            }
            let action = match outcome.result {
                Ok(()) => {
                    let mut captured = successes.next().expect("every applied action was captured");
                    assert_eq!(captured.action.input_seq, input.seq);
                    if let Some(id) = captured.fired {
                        let record = world.nodes().resolved[self.resolved_cursor..]
                            .iter()
                            .find(|record| record.id == id)
                            .expect("a captured fired node has its exact resolved record");
                        assert_eq!(record.family, NodeFamily::MagistrateRuling);
                        let ActionResult::Bribe {
                            result: BribeResult::Applied { ruling, .. },
                        } = &mut captured.action.result
                        else {
                            panic!("only a Bribe captures a Magistrate ruling");
                        };
                        *ruling = Some(RulingRecord {
                            node: record.id,
                            magistrate: record.subject,
                            applied: record.applied.into(),
                            source: record.source,
                            rules_default: record.rules_default.into(),
                        });
                    }
                    captured.action
                }
                Err(reason) => CoreActionResult {
                    input_seq: input.seq,
                    tick: input.tick,
                    result: match input.payload {
                        InputPayload::Bribe { amount } => ActionResult::Bribe {
                            result: BribeResult::Rejected { reason, amount },
                        },
                        InputPayload::Haunt { target } => ActionResult::Haunt {
                            result: HauntResult::Rejected { reason, target },
                        },
                        _ => unreachable!(),
                    },
                },
            };
            self.actions.push(action);
        }
        assert!(
            successes.next().is_none(),
            "all captured actions join their outcomes"
        );
        for mut dream in self.dreams.drain(..) {
            if let Some(id) = dream.node
                && let Some(record) = world.nodes().resolved[self.resolved_cursor..]
                    .iter()
                    .find(|record| record.id.0 == id)
            {
                assert_eq!(record.family, NodeFamily::DreamInterpretation);
                assert_eq!(record.subject, dream.dreamer);
                dream.interpretation = Some(crate::story::DreamInterpretation {
                    node: record.id,
                    applied: record.applied.id(),
                    tick: record.tick,
                    source: match record.source {
                        ChoiceSource::External => "external",
                        ChoiceSource::RulesDefault => "rules_default",
                    },
                    rules_default: record.rules_default.id(),
                });
            }
            self.story.batch.dreams.push(dream);
        }
        self.story.completed_with(world, |event| {
            let (body, kind) = match event.kind {
                EventKind::Birth { person } => (person, LifecycleKind::Birth),
                EventKind::Death { person } => (person, LifecycleKind::Death),
                EventKind::Possession { person, .. } => (person, LifecycleKind::Possession),
                EventKind::Rebuild { person, .. } => (person, LifecycleKind::Rebuild),
                _ => return,
            };
            let person = world
                .persons()
                .get(&body)
                .expect("a lifecycle event retains its Person");
            if person.soul != world.souls().player {
                return;
            }
            self.player_lifecycle.push(PlayerLifecycleFact {
                event: event.id,
                tick: event.tick,
                kind,
                body,
                name: person.name.text(person.sex),
                origin: person.origin,
            });
        });
        self.resolved_cursor = world.nodes().resolved.len();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(debug_assertions))]
    use crate::ids::IdCounter;
    use crate::params::Params;
    use crate::snapshot::ActionView;
    use crate::tick::Sim;
    use crate::underworld::carry_over::TraitName;
    use crate::underworld::customization::Customization;
    use crate::underworld::dreams::DreamIntent;
    use crate::underworld::nodes::NodeRef;
    use crate::underworld::{ghosts, hauntings, magistrate, slots};
    use crate::values::{Mood, Sex};
    use crate::world::{Life, SoulPlace, WorldConfig};

    fn quiet() -> Params {
        let mut params = Params::DEFAULT;
        params.mortality_ppm_by_age = [0; 120];
        params.mortality_floor_ppm = 0;
        params.birth_ppm_married = 0;
        params.birth_ppm_unmarried = 0;
        params.marriage_ppm = 0;
        params.loan_ppm = 0;
        params.social_ppm = 0;
        params.offer_min_affinity = 101;
        params.max_wait = u64::MAX;
        params.player_max_wait = u64::MAX;
        params.min_salience = i64::MAX;
        params
    }
    fn waiting(params: Params) -> (World, PersonId, PersonId) {
        let mut world =
            World::new_with_params(22, WorldConfig::try_new(40).unwrap(), params).unwrap();
        world.tick = Tick(1);
        let ghost = crate::testing::prepare_player_wait(&mut world, Tick(0), Some(Tick(1)), None);
        let target = world
            .persons()
            .values()
            .find(|person| person.id != PersonId(1) && matches!(person.life, Life::Alive { .. }))
            .unwrap()
            .id;
        crate::testing::set_relation_affinity(&mut world, target, ghost, -25);
        world.joss.get_mut(&world.souls.player).unwrap().balance = 1_000;
        (world, ghost, target)
    }
    fn actions(world: &World) -> ActionView {
        let targets = ghosts::connected(world, world.player_wait().unwrap().ghost);
        ActionView::inspect(world, &targets)
    }
    fn bribe(report: &RunUntilStopResult) -> &BribeResult {
        let ActionResult::Bribe { result } = &report
            .actions
            .iter()
            .find(|action| matches!(action.result, ActionResult::Bribe { .. }))
            .unwrap()
            .result
        else {
            unreachable!()
        };
        result
    }

    #[test]
    fn report_stop_labels_preserve_all_wire_combinations() {
        let expected = [
            r#"[]"#,
            r#"["player_node"]"#,
            r#"["player_died"]"#,
            r#"["player_node","player_died"]"#,
            r#"["dream_resolved"]"#,
            r#"["player_node","dream_resolved"]"#,
            r#"["player_died","dream_resolved"]"#,
            r#"["player_node","player_died","dream_resolved"]"#,
            r#"["player_reborn"]"#,
            r#"["player_node","player_reborn"]"#,
            r#"["player_died","player_reborn"]"#,
            r#"["player_node","player_died","player_reborn"]"#,
            r#"["dream_resolved","player_reborn"]"#,
            r#"["player_node","dream_resolved","player_reborn"]"#,
            r#"["player_died","dream_resolved","player_reborn"]"#,
            r#"["player_node","player_died","dream_resolved","player_reborn"]"#,
        ];
        let world = World::new(1, WorldConfig::default()).unwrap();
        for (mask, expected) in expected.into_iter().enumerate() {
            let report = RunUntilStopResult {
                ran: 0,
                checksum: None,
                stops: StopSet {
                    player_node: mask & 1 != 0,
                    player_died: mask & 2 != 0,
                    dream_resolved: mask & 4 != 0,
                    player_reborn: mask & 8 != 0,
                },
                actions: Vec::new(),
                player_lifecycle: Vec::new(),
                story: crate::story::StoryCollector::new(&world, false).finish(),
            };
            let wire = serde_json::to_value(&report).unwrap();
            assert_eq!(wire["stops"].to_string(), expected, "stop mask {mask}");
        }
    }

    #[test]
    fn action_view_is_read_only_lazy_and_parameter_owned() {
        let mut params = quiet();
        params.haunt_price = 17;
        params.yearly_cap = 70;
        let (mut world, ghost, target) = waiting(params);
        let player = world.souls.player;
        world.joss.get_mut(&player).unwrap().capped_spent = 69;
        let before = world.clone();
        let view = actions(&world);
        assert_eq!(world, before);
        assert_eq!(view.version, 1);
        assert_eq!(view.haunt.price, 17);
        assert_eq!(view.capped_spend.spent, 69);
        assert_eq!(view.capped_spend.remaining, 1);
        assert_eq!(view.bribe.min_amount, 1);
        assert_eq!(view.bribe.max_amount, 1_000);
        assert!(
            view.bribe.availability.eligible,
            "Bribe is not capped spend"
        );
        assert_eq!(
            view.haunt
                .targets
                .iter()
                .map(|entry| entry.target)
                .collect::<Vec<_>>(),
            ghosts::connected(&world, ghost)
        );
        assert!(
            view.haunt
                .targets
                .iter()
                .all(|entry| entry.target != world.magistrate.id)
        );
        assert_eq!(
            view.haunt
                .targets
                .iter()
                .find(|entry| entry.target == target)
                .unwrap()
                .availability
                .reason,
            Some(RejectReason::YearlyCap)
        );
        world.tick = Tick(365);
        let stored = world.joss[&player];
        let view = actions(&world);
        assert_eq!(
            world.joss[&player], stored,
            "inspection does not reset the stored account"
        );
        assert_eq!(view.capped_spend.cap_year, 1);
        assert_eq!(view.capped_spend.spent, 0);
        assert_eq!(view.capped_spend.remaining, 70);
        assert!(
            view.haunt
                .targets
                .iter()
                .find(|entry| entry.target == target)
                .unwrap()
                .availability
                .eligible
        );
        world.relations.remove(&(target, ghost));
        assert!(
            !actions(&world)
                .haunt
                .targets
                .iter()
                .any(|entry| entry.target == target)
        );
        assert_eq!(
            hauntings::validate(&world, target),
            Err(RejectReason::NotConnected)
        );
    }

    #[test]
    fn shared_spent_blocks_haunt_and_rebuild_but_not_bribe() {
        let mut params = quiet();
        params.yearly_cap = 60;
        params.haunt_price = 20;
        params.rebuilt_price = 50;
        let (mut world, _, target) = waiting(params);
        hauntings::apply(&mut world, target).unwrap();
        assert_eq!(actions(&world).capped_spend.remaining, 40);
        let customization = Some(Customization::Set {
            trait_name: TraitName::Piety,
            value: 0,
        });
        assert_eq!(
            slots::check_claim(&world, slots::SlotRef::RebuiltBody, customization),
            Err(RejectReason::YearlyCap)
        );
        world.tick = Tick(2);
        world.params.yearly_cap = 25;
        assert_eq!(
            hauntings::validate(&world, target),
            Err(RejectReason::YearlyCap)
        );
        assert!(magistrate::validate(&world, 1).is_ok());
        world.params.yearly_cap = u64::MAX;
        world.params.haunt_price = 1;
        world
            .joss
            .get_mut(&world.souls.player)
            .unwrap()
            .capped_spent = u64::MAX;
        assert!(
            hauntings::validate(&world, target).is_ok(),
            "retain legacy saturating cap arithmetic"
        );
    }

    #[test]
    fn pure_checks_preserve_first_error_and_atomic_event_capacity() {
        let (mut world, ghost, target) = waiting(quiet());
        world.log.exhaust_ids_leaving(1);
        world.joss.get_mut(&world.souls.player).unwrap().balance = 0;
        assert_eq!(
            magistrate::validate(&world, 0),
            Err(RejectReason::BadAmount)
        );
        assert_eq!(
            magistrate::validate(&world, 1),
            Err(RejectReason::InsufficientJoss)
        );
        assert_eq!(
            hauntings::validate(&world, world.magistrate.id),
            Err(RejectReason::OfficialPerson)
        );
        assert_eq!(
            hauntings::validate(&world, PersonId(u64::MAX)),
            Err(RejectReason::UnknownPerson)
        );
        assert_eq!(
            hauntings::validate(&world, ghost),
            Err(RejectReason::DeadPerson)
        );
        world.joss.get_mut(&world.souls.player).unwrap().balance = 1_000;
        let before = world.clone();
        assert_eq!(
            magistrate::validate(&world, 1),
            Err(RejectReason::IdExhausted)
        );
        assert_eq!(world, before);
        assert_eq!(
            magistrate::apply(&mut world, InputSeq(0), 1),
            Err(RejectReason::IdExhausted)
        );
        assert_eq!(
            world, before,
            "neither half of the atomic Bribe pair nor spend commits"
        );
        assert!(hauntings::validate(&world, target).is_ok());
        world.log.exhaust_ids();
        assert_eq!(
            hauntings::validate(&world, target),
            Err(RejectReason::IdExhausted)
        );
        let (mut world, _, target) = waiting(quiet());
        magistrate::apply(&mut world, InputSeq(0), 1).unwrap();
        let before = world.clone();
        assert_eq!(
            magistrate::validate(&world, 1),
            Err(RejectReason::NodePending)
        );
        assert_eq!(
            actions(&world).bribe.availability.reason,
            Some(RejectReason::NodePending)
        );
        assert_eq!(world, before);
        world.joss.get_mut(&world.souls.player).unwrap().balance = 0;
        assert_eq!(
            magistrate::validate(&world, 1),
            Err(RejectReason::InsufficientJoss)
        );
        world.joss.get_mut(&world.souls.player).unwrap().balance = 1_000;
        hauntings::apply(&mut world, target).unwrap();
        world.joss.get_mut(&world.souls.player).unwrap().balance = 0;
        assert_eq!(
            hauntings::validate(&world, target),
            Err(RejectReason::RateLimited)
        );
    }

    #[test]
    fn multi_tick_success_and_each_rejection_survive_later_empty_outcomes() {
        let (mut world, _, target) = waiting(quiet());
        if let Life::Alive { mood, .. } = &mut world.persons.get_mut(&target).unwrap().life {
            *mood = Mood::clamped(-90);
        }
        let mut observed = Sim::from_test_world(world);
        let tick = observed.world().tick();
        let first = observed
            .submit(tick, InputPayload::Haunt { target })
            .unwrap();
        let second = observed
            .submit(tick, InputPayload::Haunt { target })
            .unwrap();
        let third = observed
            .submit(tick, InputPayload::Bribe { amount: 0 })
            .unwrap();
        let mut plain = observed.clone();
        let report = observed.run_until_stop_observed(3);
        let run = plain.run_until_stop(3);
        assert_eq!(report.ran, 3);
        assert_eq!(
            (report.ran, report.checksum, report.stops),
            (run.ran, run.checksum, run.stops)
        );
        assert_eq!(observed.world(), plain.world());
        assert_eq!(observed.checksums(), plain.checksums());
        assert!(observed.last_outcomes().is_empty());
        assert_eq!(
            report
                .actions
                .iter()
                .map(|action| action.input_seq)
                .collect::<Vec<_>>(),
            [first, second, third]
        );
        let ActionResult::Haunt {
            result:
                HauntResult::Applied {
                    event,
                    price,
                    intensity,
                    mood_delta,
                    ..
                },
        } = report.actions[0].result
        else {
            panic!("the first Haunt applied")
        };
        assert_ne!(target, PersonId(1));
        assert_eq!(mood_delta, -15);
        assert_eq!(price, observed.world().params().haunt_price);
        assert_eq!(intensity, observed.world().params().haunt_intensity);
        assert!(
            matches!(observed.world().log().event(event).unwrap().kind, EventKind::Haunting { target: actual, .. } if actual == target)
        );
        let Life::Alive { mood, .. } = observed.world().persons()[&target].life else {
            unreachable!()
        };
        assert_eq!(
            mood.get(),
            -100,
            "the pre-clamp receipt is not observed loss"
        );
        assert!(matches!(
            report.actions[1].result,
            ActionResult::Haunt {
                result: HauntResult::Rejected {
                    reason: RejectReason::RateLimited,
                    ..
                }
            }
        ));
        assert!(matches!(
            report.actions[2].result,
            ActionResult::Bribe {
                result: BribeResult::Rejected {
                    reason: RejectReason::BadAmount,
                    ..
                }
            }
        ));
        let empty = observed.run_until_stop_observed(0);
        assert_eq!(empty.checksum, report.checksum);
        assert!(empty.actions.is_empty() && empty.player_lifecycle.is_empty());
    }

    #[test]
    fn bribe_joins_exact_events_node_default_external_and_failed_admission_fallback() {
        for external in [false, true] {
            let (mut world, ghost, target) = waiting(quiet());
            let amount = 1u64 << 54;
            world.joss.get_mut(&world.souls.player).unwrap().balance = amount.saturating_add(1_000);
            let mut sim = Sim::from_test_world(world);
            sim.try_submit_all(&[InputPayload::Dream {
                dreamer: target,
                intent: DreamIntent::Warn,
            }])
            .unwrap();
            let trigger = sim.inputs().next_seq();
            let rejected = sim.try_submit_all(&[
                InputPayload::Bribe { amount },
                InputPayload::Choose {
                    node: NodeRef::Trigger { seq: trigger },
                    option: NodeOption::DismissDream,
                    fingerprint: None,
                },
            ]);
            assert_eq!(rejected, Err((1, RejectReason::OptionNotInSet)));
            assert_eq!(sim.inputs().next_seq(), trigger);
            let mut payloads = vec![InputPayload::Bribe { amount }];
            if external {
                payloads.push(InputPayload::Choose {
                    node: NodeRef::Trigger { seq: trigger },
                    option: NodeOption::Deny,
                    fingerprint: None,
                });
            }
            let accepted = sim.try_submit_all(&payloads).unwrap();
            assert_eq!(accepted[0], trigger);
            let report = sim.run_until_stop_observed(1);
            let BribeResult::Applied {
                offering_event,
                appeal_event,
                ghost: actual_ghost,
                amount: actual_amount,
                ruling: Some(ruling),
            } = bribe(&report)
            else {
                panic!("the Bribe fired and resolved")
            };
            assert_eq!(*actual_ghost, ghost);
            assert_eq!(*actual_amount, amount);
            assert!(
                matches!(sim.world().log().event(*offering_event).unwrap().kind, EventKind::BribeOffering { amount: actual, .. } if actual == amount)
            );
            assert!(
                matches!(sim.world().log().event(*appeal_event).unwrap().kind, EventKind::Appeal { ghost: actual, .. } if actual == ghost)
            );
            let record = sim
                .world()
                .nodes()
                .resolved
                .iter()
                .find(|record| record.id == ruling.node)
                .unwrap();
            assert_eq!(record.family, NodeFamily::MagistrateRuling);
            assert_ne!(
                record.id,
                sim.world().nodes().resolved[0].id,
                "the Dream is a different node"
            );
            assert_eq!(ruling.rules_default, record.rules_default.into());
            assert_eq!(ruling.applied, record.applied.into());
            assert_eq!(ruling.magistrate, record.subject);
            assert_eq!(
                ruling.source,
                if external {
                    ChoiceSource::External
                } else {
                    ChoiceSource::RulesDefault
                }
            );
            if external {
                assert_eq!(ruling.applied, RulingOption::Deny);
            }
            let wire: serde_json::Value =
                serde_json::from_str(&serde_json::to_string(&report).unwrap()).unwrap();
            assert_eq!(wire["actions"][0]["amount"], amount.to_string());
        }
    }

    #[test]
    #[cfg(not(debug_assertions))]
    fn applied_bribe_with_exhausted_node_counter_truthfully_has_null_ruling() {
        let (mut world, _, _) = waiting(quiet());
        world.nodes.ids = IdCounter::starting_at(u64::MAX);
        let mut sim = Sim::from_test_world(world);
        let accepted = sim
            .try_submit_all(&[
                InputPayload::Bribe { amount: 10 },
                InputPayload::Bribe { amount: 20 },
            ])
            .unwrap();
        let report = sim.run_until_stop_observed(1);
        assert_eq!(
            report
                .actions
                .iter()
                .map(|action| action.input_seq)
                .collect::<Vec<_>>(),
            accepted
        );
        assert_eq!(sim.world().joss()[&sim.world().souls().player].balance, 970);
        assert!(sim.world().nodes().resolved.is_empty());
        for action in &report.actions {
            assert!(matches!(
                action.result,
                ActionResult::Bribe {
                    result: BribeResult::Applied { ruling: None, .. }
                }
            ));
        }
        let wire: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&report).unwrap()).unwrap();
        assert!(wire["actions"][0]["ruling"].is_null());
        assert_eq!(wire["actions"][1]["amount"], "20");
    }

    #[test]
    fn native_birth_and_other_soul_birth_keep_only_real_player_fact() {
        let mut params = quiet();
        params.initial_waiting = 2;
        params.birth_lead_days = 1;
        let (mut world, _, _) = waiting(params);
        let mothers: Vec<_> = world
            .persons()
            .values()
            .filter(|person| {
                person.sex == Sex::Female
                    && matches!(person.life, Life::Alive { .. })
                    && (18..=45).contains(&world.age_years(person))
            })
            .take(2)
            .map(|person| person.id)
            .collect();
        let player_slot = slots::open(&mut world, mothers[0]).unwrap();
        slots::open(&mut world, mothers[1]).unwrap();
        let mut sim = Sim::from_test_world(world);
        sim.try_submit_all(&[InputPayload::ClaimSlot {
            slot: slots::SlotRef::Birth(player_slot),
            customization: None,
        }])
        .unwrap();
        let report = sim.run_until_stop_observed(5);
        assert_eq!(report.ran, 2);
        assert_eq!(report.player_lifecycle.len(), 1);
        let fact = &report.player_lifecycle[0];
        assert_eq!(fact.kind, LifecycleKind::Birth);
        assert_eq!(fact.tick, Tick(2));
        assert_eq!(fact.origin, Origin::Native);
        assert_eq!(sim.world().persons()[&fact.body].birth_day, 2);
        assert_eq!(
            sim.world().persons()[&fact.body].soul,
            sim.world().souls().player
        );
        assert_eq!(
            sim.world()
                .log()
                .events()
                .iter()
                .filter(
                    |event| event.tick == Tick(2) && matches!(event.kind, EventKind::Birth { .. })
                )
                .count(),
            2
        );
        let newborn = report
            .story
            .actors
            .iter()
            .find(|actor| actor.person == fact.body)
            .unwrap();
        assert_eq!(newborn.birth_day, Some(2));
        assert_eq!(newborn.age_at_death, None);
        let story_birth = report
            .story
            .events
            .iter()
            .find(|event| event.id == fact.event)
            .unwrap();
        assert_eq!(
            story_birth.relevance,
            crate::story::StoryRelevance::SelfLife
        );
        assert!(report.story.events.iter().any(
            |event| matches!(event.kind.0, EventKind::Birth { person } if person != fact.body)
        ));
    }

    #[test]
    fn actual_arrival_then_death_retains_dead_body_and_current_waiting() {
        for slot in [slots::SlotRef::ImportedVessel, slots::SlotRef::RebuiltBody] {
            let mut params = quiet();
            params.mortality_ppm_by_age = [1_000_000; 120];
            params.mortality_floor_ppm = 1_000_000;
            let (world, old_body, _) = waiting(params);
            let mut sim = Sim::from_test_world(world);
            let customization =
                (slot == slots::SlotRef::RebuiltBody).then_some(Customization::Set {
                    trait_name: TraitName::Piety,
                    value: 0,
                });
            sim.try_submit_all(&[InputPayload::ClaimSlot {
                slot,
                customization,
            }])
            .unwrap();
            let report = sim.run_until_stop_observed(5);
            assert_eq!(report.ran, 1);
            assert!(report.stops.player_died && report.stops.player_reborn);
            assert_eq!(report.player_lifecycle.len(), 2);
            let arrival = &report.player_lifecycle[0];
            let death = &report.player_lifecycle[1];
            assert_ne!(arrival.body, old_body);
            assert_eq!(arrival.body, death.body);
            assert_eq!(arrival.tick, Tick(1));
            assert_eq!(death.tick, arrival.tick);
            assert!(arrival.event < death.event);
            assert_eq!(
                arrival.kind,
                if slot == slots::SlotRef::ImportedVessel {
                    LifecycleKind::Possession
                } else {
                    LifecycleKind::Rebuild
                }
            );
            assert_eq!(death.kind, LifecycleKind::Death);
            let retained = &sim.world().persons()[&arrival.body];
            assert_eq!(arrival.origin, retained.origin);
            assert_eq!(arrival.name, retained.name.text(retained.sex));
            assert_eq!(death.name, arrival.name);
            assert_eq!(retained.life, Life::Dead { death: Tick(1) });
            let actor = report
                .story
                .actors
                .iter()
                .find(|actor| actor.person == arrival.body)
                .unwrap();
            assert_eq!(actor.name, arrival.name);
            assert_eq!(actor.birth_day, Some(retained.birth_day));
            assert_eq!(
                actor.age_at_death,
                Some(u64::from(sim.world().age_years(retained)))
            );
            for event in &report.story.events {
                let native = sim.world().log().event(event.id).unwrap();
                assert_eq!(event.kind.0, native.kind);
                assert_eq!(event.caused_by, native.caused_by.as_slice());
                for id in native.kind.actors().iter() {
                    assert!(report.story.actors.iter().any(|actor| actor.person == id));
                }
            }
            assert_eq!(
                sim.world().souls().places[&sim.world().souls().player],
                SoulPlace::Waiting { since: Tick(1) }
            );
            let snapshot: serde_json::Value =
                serde_json::from_str(&crate::snapshot::snapshot_json(sim.world())).unwrap();
            assert_eq!(snapshot["player"]["place"], "waiting");
            assert!(!snapshot["underworld_view"].is_null());
        }
    }
    #[test]
    fn dream_sent_sequence_intent_and_actual_node_join_survive_other_inputs() {
        for intent in DreamIntent::ALL {
            for external in [false, true] {
                let (world, ghost, target) = waiting(quiet());
                let mut sim = Sim::from_test_world(world);
                let tick = sim.world().tick();
                let seq = sim
                    .submit(
                        tick,
                        InputPayload::Dream {
                            dreamer: target,
                            intent,
                        },
                    )
                    .unwrap();
                sim.submit(tick, InputPayload::Bribe { amount: 1 }).unwrap();
                let answer = intent.options()[0];
                if external {
                    sim.submit(
                        tick,
                        InputPayload::Choose {
                            node: NodeRef::Trigger { seq },
                            option: answer,
                            fingerprint: None,
                        },
                    )
                    .unwrap();
                }
                sim.submit(
                    tick,
                    InputPayload::Dream {
                        dreamer: target,
                        intent,
                    },
                )
                .unwrap();
                let mut control = sim.clone();
                let report = sim.run_until_stop_observed(1);
                assert_eq!(report.checksum, Some(control.step()));
                assert_eq!(
                    report.story.dreams.len(),
                    1,
                    "a refused duplicate has no sent fact"
                );
                let dream = &report.story.dreams[0];
                assert_eq!(dream.input_seq, seq);
                assert_eq!(dream.intent, intent.card_name());
                assert_eq!(dream.tick, tick);
                assert_eq!(dream.ghost, ghost);
                assert_eq!(dream.dreamer, target);
                let sent = sim.world().log().event(dream.event_id).unwrap();
                assert_eq!(
                    sent.kind,
                    EventKind::Dream {
                        ghost,
                        dreamer: target,
                        price: dream.price
                    }
                );
                assert!(report.story.events.iter().any(|event| event.id == sent.id));
                let interpretation = dream.interpretation.as_ref().unwrap();
                assert_eq!(dream.node, Some(interpretation.node.0));
                let record = sim
                    .world()
                    .nodes()
                    .resolved
                    .iter()
                    .find(|record| record.id == interpretation.node)
                    .unwrap();
                assert_eq!(record.family, NodeFamily::DreamInterpretation);
                assert_eq!(record.subject, target);
                assert_eq!(interpretation.tick, record.tick);
                assert_eq!(
                    serde_json::to_value(interpretation).unwrap()["tick"],
                    record.tick.0.to_string()
                );
                assert_eq!(interpretation.applied, record.applied.id());
                assert_eq!(interpretation.rules_default, record.rules_default.id());
                assert_eq!(
                    interpretation.source,
                    if external {
                        "external"
                    } else {
                        "rules_default"
                    }
                );
                if external {
                    assert_eq!(record.applied, answer);
                }
                let BribeResult::Applied {
                    ruling: Some(ruling),
                    ..
                } = bribe(&report)
                else {
                    panic!("the same tick has its distinct actual Bribe ruling");
                };
                assert_ne!(ruling.node, interpretation.node);
                assert_eq!(
                    sim.last_outcomes().last().unwrap().result,
                    Err(RejectReason::RateLimited)
                );
                let wire = serde_json::to_value(dream).unwrap();
                assert_eq!(wire["eventId"], sent.id.0.to_string());
                assert_eq!(wire["inputSeq"], seq.0.to_string());
                assert!(wire.get("effectsApplied").is_none());
                assert!(sim.run_until_stop_observed(0).story.dreams.is_empty());
            }
        }
    }

    #[test]
    #[cfg(not(debug_assertions))]
    fn dream_without_fired_node_has_no_synthetic_interpretation() {
        let (mut world, _, target) = waiting(quiet());
        world.nodes.ids = IdCounter::starting_at(u64::MAX);
        let mut sim = Sim::from_test_world(world);
        sim.submit(
            sim.world().tick(),
            InputPayload::Dream {
                dreamer: target,
                intent: DreamIntent::Warn,
            },
        )
        .unwrap();
        let report = sim.run_until_stop_observed(1);
        assert_eq!(report.story.dreams.len(), 1);
        let dream = &report.story.dreams[0];
        assert!(dream.node.is_none() && dream.interpretation.is_none());
        let wire = serde_json::to_value(dream).unwrap();
        assert!(wire.get("node").is_none() && wire.get("interpretation").is_none());
    }

    #[test]
    fn chronicle_projection_keeps_native_append_index_absence_skips_and_joins() {
        use crate::narrator::{
            EffectPart, PlannedOption, PlayerFamily, PlayerNode, PlayerOption, StakeUnit, Stakes,
        };
        use crate::values::{Intensity, SocialKind};
        for external in [false, true] {
            for absent in [false, true] {
                let mut world =
                    World::new_with_params(22, WorldConfig::default(), quiet()).unwrap();
                world.tick = Tick(1);
                let SoulPlace::Body(chooser) = world.souls.places[&world.souls.player] else {
                    unreachable!()
                };
                let target = world
                    .persons()
                    .values()
                    .find(|person| {
                        person.id != chooser && matches!(person.life, Life::Alive { .. })
                    })
                    .unwrap()
                    .id;
                let id = NodeId(500);
                let option = PlannedOption {
                    id: PlayerOption::AskForTime,
                    preview: Vec::new(),
                    parts: vec![
                        EffectPart::Social {
                            kind: SocialKind::Help,
                            doer: chooser,
                            target,
                            intensity: Intensity::new(40).unwrap(),
                        },
                        EffectPart::Social {
                            kind: SocialKind::Gift,
                            doer: chooser,
                            target: PersonId(u64::MAX),
                            intensity: Intensity::new(36).unwrap(),
                        },
                    ],
                };
                crate::testing::install_player_node(
                    &mut world,
                    PlayerNode {
                        id,
                        family: PlayerFamily::DebtDue,
                        chooser,
                        fired: Tick(0),
                        stakes: Stakes {
                            who: vec![chooser, target],
                            amount: i64::MIN,
                            unit: StakeUnit::Money,
                            by: Tick(u64::MAX),
                        },
                        options: vec![option],
                        rules_default: PlayerOption::AskForTime,
                        external: external.then_some(PlayerOption::AskForTime),
                        trigger: None,
                    },
                );
                if absent {
                    crate::testing::prepare_player_wait(&mut world, Tick(0), Some(Tick(1)), None);
                }
                let mut sim = Sim::from_test_world(world);
                let start = sim.world().narrator().chronicle.entries().len();
                let report = sim.run_until_stop_observed(1);
                let native = &sim.world().narrator().chronicle.entries()[start];
                let projected = report
                    .story
                    .chronicle
                    .iter()
                    .find(|entry| entry.node == Some(id.0))
                    .unwrap();
                assert_eq!(projected.index, start);
                assert_eq!(projected.tick, native.tick);
                assert_eq!(projected.source, native.source.label());
                assert_eq!(projected.chooser_absent, absent);
                assert_eq!(projected.applied, native.applied.label());
                assert_eq!(projected.stakes.amount, i64::MIN);
                assert_eq!(projected.stakes.by, Tick(u64::MAX));
                assert_eq!(projected.appended, native.appended);
                assert_eq!(
                    projected
                        .skipped
                        .iter()
                        .map(|part| (part.part, part.reason))
                        .collect::<Vec<_>>(),
                    native
                        .skipped
                        .iter()
                        .map(|(part, reason)| (*part, reason.label()))
                        .collect::<Vec<_>>()
                );
                assert!(!projected.skipped.is_empty());
                for &event in &projected.appended {
                    assert!(report.story.events.iter().any(|fact| fact.id == event));
                    assert!(sim.world().log().event(event).is_some());
                }
                assert_eq!(report.story.cursors.chronicle.start, start);
                assert_eq!(
                    report.story.cursors.chronicle.end,
                    sim.world().narrator().chronicle.entries().len()
                );
            }
        }
    }

    #[test]
    fn automatic_chronicle_has_no_fabricated_node() {
        let mut params = quiet();
        params.min_salience = 0;
        let mut world = World::new_with_params(22, WorldConfig::default(), params).unwrap();
        world.tick = Tick(1);
        let SoulPlace::Body(chooser) = world.souls.places[&world.souls.player] else {
            unreachable!()
        };
        let target = world
            .persons()
            .values()
            .find(|person| person.id != chooser && matches!(person.life, Life::Alive { .. }))
            .unwrap()
            .id;
        let due = Tick(
            world
                .tick()
                .0
                .checked_add(world.params().debt_due_lead)
                .unwrap(),
        );
        crate::testing::add_test_debt(&mut world, chooser, target, due, 20);
        let mut sim = Sim::from_test_world(world);
        let report = sim.run_until_stop_observed(1);
        let entry = report
            .story
            .chronicle
            .iter()
            .find(|entry| entry.source == "auto_resolved")
            .unwrap();
        assert!(entry.node.is_none());
        let native = &sim.world().narrator().chronicle.entries()[entry.index];
        assert_eq!(entry.appended, native.appended);
        assert_eq!(entry.applied, native.applied.label());
        assert!(serde_json::to_value(entry).unwrap().get("node").is_none());
    }
}
