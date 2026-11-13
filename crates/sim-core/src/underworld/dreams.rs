//! Dreams (R4, OP-U11) and the `dream_interpretation` Rules_Default.
//!
//! A dream is the Player_Soul's Ghost visiting one living Connected_Person. The input
//! spends `dream_price` (attributed to the `dream` Event), fires one
//! `dream_interpretation` node and resolves it in the same tick (OP-U11 A). The option
//! effects touch only the dreamer's Relation toward the Ghost and, for the offering
//! options, one Offering from the dreamer; Mood never changes here (R4.7).

use crate::events::{CausedBy, EventKind, EventTags};
use crate::ids::{InputSeq, PersonId};
use crate::llm::{FrozenContext, OptionDef, OptionId, PlayerInput, TaskSpec};
use crate::underworld::nodes::{self, NodeFamily, NodeOption, NodeParams, NodePlan, PendingNode};
use crate::underworld::{ghosts, joss, offerings, player};
use crate::values::Score;
use crate::world::{Life, RejectReason, SoulPlace, World};

/// The intent the dream was sent with (design "Inputs").
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum DreamIntent {
    /// A warning: the dreamer should be careful.
    Warn,
    /// Comfort: the dreamer should take heart.
    Reassure,
    /// An urging: the dreamer should do something.
    Urge,
    /// A revelation: the dreamer should believe it.
    Reveal,
    /// A request for joss paper.
    RequestOffering,
    /// A ban: the dreamer should not do something.
    Forbid,
}

impl DreamIntent {
    /// Every intent, in the card order.
    pub const ALL: [Self; 6] = [
        Self::Warn,
        Self::Reassure,
        Self::Urge,
        Self::Reveal,
        Self::RequestOffering,
        Self::Forbid,
    ];

    /// The card name of the intent, written into `player_input.intent`.
    pub const fn card_name(self) -> &'static str {
        match self {
            Self::Warn => "warn",
            Self::Reassure => "reassure",
            Self::Urge => "urge",
            Self::Reveal => "reveal",
            Self::RequestOffering => "request_offering",
            Self::Forbid => "forbid",
        }
    }

    /// The intent of a card `player_input.intent` name.
    pub fn from_card_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|intent| intent.card_name() == name)
    }

    /// The three options of this intent, in context order (OP-U11 table).
    pub const fn options(self) -> &'static [NodeOption] {
        const WARN: [NodeOption; 3] = [
            NodeOption::HeedWarning,
            NodeOption::BurnOffering,
            NodeOption::DismissDream,
        ];
        const REASSURE: [NodeOption; 3] = [
            NodeOption::TakeComfort,
            NodeOption::BurnOffering,
            NodeOption::DismissDream,
        ];
        const URGE: [NodeOption; 3] = [
            NodeOption::FollowUrging,
            NodeOption::BurnOffering,
            NodeOption::DismissDream,
        ];
        const REVEAL: [NodeOption; 3] = [
            NodeOption::BelieveRevelation,
            NodeOption::BurnOffering,
            NodeOption::DismissDream,
        ];
        const FORBID: [NodeOption; 3] = [
            NodeOption::ObeyBan,
            NodeOption::BurnOffering,
            NodeOption::DismissDream,
        ];
        const REQUEST: [NodeOption; 3] = [
            NodeOption::BurnOffering,
            NodeOption::BurnSmall,
            NodeOption::DismissDream,
        ];
        match self {
            Self::Warn => &WARN,
            Self::Reassure => &REASSURE,
            Self::Urge => &URGE,
            Self::Reveal => &REVEAL,
            Self::Forbid => &FORBID,
            Self::RequestOffering => &REQUEST,
        }
    }

    /// The option that reads the dream as its intent (OP-U11 table). For
    /// `request_offering` that is `burn_offering`.
    pub const fn as_intent_option(self) -> NodeOption {
        match self {
            Self::Warn => NodeOption::HeedWarning,
            Self::Reassure => NodeOption::TakeComfort,
            Self::Urge => NodeOption::FollowUrging,
            Self::Reveal => NodeOption::BelieveRevelation,
            Self::Forbid => NodeOption::ObeyBan,
            Self::RequestOffering => NodeOption::BurnOffering,
        }
    }

    /// The fixed dream content for `ghost`'s name (R4.4).
    pub fn content(self, ghost: &str) -> String {
        match self {
            Self::Warn => {
                format!("{ghost} stands at the foot of the bed and slowly shakes their head.")
            }
            Self::Reassure => format!("{ghost} sits by the window, calm, and smiles."),
            Self::Urge => format!("{ghost} points at the door and beckons, again and again."),
            Self::Reveal => format!("{ghost} opens an old ledger and taps one line."),
            Self::RequestOffering => {
                format!("{ghost} sits beside an empty brazier in a thin coat, shivering.")
            }
            Self::Forbid => format!("{ghost} stands in the doorway with arms crossed."),
        }
    }

    /// The explicit canonical tag, in declaration order.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::Warn => 0,
            Self::Reassure => 1,
            Self::Urge => 2,
            Self::Reveal => 3,
            Self::RequestOffering => 4,
            Self::Forbid => 5,
        }
    }
}

impl crate::canon::Canon for DreamIntent {
    fn encode<W: crate::canon::CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
    }
}

/// Applies one `Dream` input in step 2a (design "Inputs", rejection table order).
///
/// `official_person` comes first (R15.9), then `no_ghost`, `not_waiting`,
/// `unknown_person`, `dead_person`, `not_connected`, `rate_limited` (one applied dream
/// per tick, OP-U5 A) and `insufficient_joss`. The Event is appended before the spend,
/// so a refused append leaves the balance untouched.
pub(crate) fn apply(
    world: &mut World,
    trigger: InputSeq,
    dreamer: PersonId,
    intent: DreamIntent,
) -> Result<(), RejectReason> {
    if dreamer == world.magistrate.id {
        return Err(RejectReason::OfficialPerson);
    }
    player::require_waiting(world)?;
    let Some(ghost) = world.player_wait.as_ref().map(|wait| wait.ghost) else {
        return Err(RejectReason::NotWaiting);
    };
    let Some(person) = world.persons.get(&dreamer) else {
        return Err(RejectReason::UnknownPerson);
    };
    if matches!(person.life, Life::Dead { .. }) {
        return Err(RejectReason::DeadPerson);
    }
    if !ghosts::is_connected(world, dreamer, ghost) {
        return Err(RejectReason::NotConnected);
    }
    if dream_fired_this_tick(world) {
        return Err(RejectReason::RateLimited);
    }
    let price = world.params.dream_price;
    let player_soul = world.souls.player;
    let balance = world.joss.get(&player_soul).map_or(0, |a| a.balance);
    if balance < price {
        return Err(RejectReason::InsufficientJoss);
    }
    if world
        .append(
            EventKind::Dream {
                ghost,
                dreamer,
                price,
            },
            CausedBy::default(),
            EventTags::empty(),
        )
        .is_err()
    {
        return Err(RejectReason::IdExhausted);
    }
    if let Some(account) = world.joss.get_mut(&player_soul) {
        let spent = joss::spend(account, price);
        debug_assert!(spent, "the balance was checked against the price");
    }
    let plan = plan(world, dreamer, ghost, intent);
    nodes::fire(world, trigger, plan);
    Ok(())
}

/// Whether a `dream` Event already fired in the current tick (OP-U5 A).
fn dream_fired_this_tick(world: &World) -> bool {
    world
        .log
        .events()
        .iter()
        .rev()
        .find_map(|event| match event.kind {
            EventKind::Dream { .. } => Some(event.tick),
            _ => None,
        })
        == Some(world.tick)
}

/// Everything `nodes::fire` needs for a dream node.
fn plan(world: &World, dreamer: PersonId, ghost: PersonId, intent: DreamIntent) -> NodePlan {
    let options = intent.options().to_vec();
    let option_defs = options.iter().map(|&option| option_def(option)).collect();
    let dreamer_name = person_name(world, dreamer);
    let ghost_name = person_name(world, ghost);
    let age = world
        .persons
        .get(&dreamer)
        .map_or(0, |person| world.age_years(person));
    let death = match world.persons.get(&ghost).map(|person| &person.life) {
        Some(Life::Dead { death }) => *death,
        _ => world.tick,
    };
    let situation = format!(
        "{dreamer_name} is {age} years old. {ghost_name} died on day {}. Tonight, day {}, \
{dreamer_name} dreamed of {ghost_name}.",
        death.0, world.tick.0
    );
    NodePlan {
        family: NodeFamily::DreamInterpretation,
        subject: dreamer,
        ghost,
        focus: vec![dreamer, ghost],
        options,
        option_defs,
        situation,
        player_input: Some(PlayerInput {
            intent: intent.card_name().to_owned(),
            content: intent.content(&ghost_name),
        }),
        params: NodeParams::Dream { intent },
    }
}

/// The card definition of one dream option (fixed English labels, design "Contexts and
/// LS-R15").
fn option_def(option: NodeOption) -> OptionDef {
    OptionDef {
        id: OptionId::new(option.id()).expect("a node option id matches the card pattern"),
        label: label(option).to_owned(),
    }
}

/// The fixed label of one dream option.
fn label(option: NodeOption) -> &'static str {
    match option {
        NodeOption::HeedWarning => "Take the warning seriously and act on it",
        NodeOption::TakeComfort => "Take comfort from the dream",
        NodeOption::FollowUrging => "Do what the dream urged you to do",
        NodeOption::BelieveRevelation => "Believe what the dream revealed",
        NodeOption::ObeyBan => "Obey the ban the dream set",
        NodeOption::BurnOffering => "Burn joss paper for the ghost",
        NodeOption::BurnSmall => "Burn a small bundle of joss paper",
        NodeOption::DismissDream => "Dismiss the dream and go on with the day",
        NodeOption::GrantNextSlot | NodeOption::GrantLaterSlot | NodeOption::Deny => {
            debug_assert!(false, "a ruling option is not a dream option");
            ""
        }
    }
}

/// The `dream_interpretation` Rules_Default (design "Rules_Default formulas").
///
/// Reads only the Frozen_Context: the subject's `piety`, `warmth` and `greed`, the
/// subject's Relation toward the Ghost (the dead actor of the last `dream` Event) and
/// `player_input.intent`. Options the closed set does not know score nothing and are
/// never chosen, so a card-only option such as `read_as_blessing` cannot win. Ties go
/// to the earlier option in the context's order.
pub fn dream_default(context: &FrozenContext, noise: i64) -> NodeOption {
    let subject = context.subject;
    let person = subject.and_then(|id| context.people.iter().find(|p| p.id == id));
    let (piety, warmth, greed) = person.map_or((0, 0, 0), |p| {
        (p.traits.piety, p.traits.warmth, p.traits.greed)
    });
    let affinity = match (subject, dream_ghost(context, subject)) {
        (Some(from), Some(to)) => context
            .relations
            .iter()
            .find(|relation| relation.from == from && relation.to == to)
            .map_or(0, |relation| relation.affinity),
        _ => 0,
    };
    let intent = context
        .player_input
        .as_ref()
        .and_then(|input| DreamIntent::from_card_name(&input.intent));
    let base = 20i64
        .saturating_mul(piety)
        .saturating_add(affinity.div_euclid(4))
        .saturating_add(5i64.saturating_mul(warmth))
        .saturating_add(noise);

    let mut best: Option<(i64, NodeOption)> = None;
    if let TaskSpec::Decision { options } = &context.spec {
        for def in options {
            let Some(option) = NodeOption::from_id(def.id.as_str()) else {
                continue;
            };
            let Some(score) = score(option, intent, base, piety, greed) else {
                continue;
            };
            if best.is_none_or(|(best_score, _)| score > best_score) {
                best = Some((score, option));
            }
        }
    }
    match best {
        Some((_, option)) => option,
        None => {
            debug_assert!(
                false,
                "a dream context always offers at least one scored option"
            );
            NodeOption::DismissDream
        }
    }
}

/// The Ghost of the last `dream` Event: its actor that is not the subject.
fn dream_ghost(
    context: &FrozenContext,
    subject: Option<crate::llm::PersonId>,
) -> Option<crate::llm::PersonId> {
    context
        .events
        .iter()
        .rev()
        .find(|event| event.kind == "dream")
        .and_then(|event| {
            event
                .actors
                .iter()
                .copied()
                .find(|actor| Some(*actor) != subject)
        })
}

/// The score of one option, or `None` when it is not an option of this dream's intent
/// (an as-intent option of another intent scores nothing).
fn score(
    option: NodeOption,
    intent: Option<DreamIntent>,
    base: i64,
    piety: i64,
    greed: i64,
) -> Option<i64> {
    match option {
        NodeOption::HeedWarning => (intent == Some(DreamIntent::Warn)).then_some(base),
        NodeOption::TakeComfort => (intent == Some(DreamIntent::Reassure)).then_some(base),
        NodeOption::FollowUrging => (intent == Some(DreamIntent::Urge)).then_some(base),
        NodeOption::BelieveRevelation => (intent == Some(DreamIntent::Reveal)).then_some(base),
        NodeOption::ObeyBan => (intent == Some(DreamIntent::Forbid)).then_some(base),
        NodeOption::BurnOffering => Some(
            base.saturating_add(10i64.saturating_mul(piety))
                .saturating_sub(10)
                .saturating_add(if intent == Some(DreamIntent::RequestOffering) {
                    20
                } else {
                    0
                }),
        ),
        NodeOption::BurnSmall => Some(
            base.saturating_add(10i64.saturating_mul(greed))
                .saturating_sub(5),
        ),
        NodeOption::DismissDream => Some(0),
        NodeOption::GrantNextSlot | NodeOption::GrantLaterSlot | NodeOption::Deny => None,
    }
}

/// Applies the chosen option's effect at resolution (step 2b), with the R3.11 partial
/// effects: every part re-checks its state and a failed part is skipped, the rest
/// applies.
pub(crate) fn apply_effect(world: &mut World, node: &PendingNode, applied: NodeOption) {
    let dreamer = node.subject;
    let ghost = node.ghost;
    let params = world.params;
    match applied {
        NodeOption::HeedWarning
        | NodeOption::TakeComfort
        | NodeOption::FollowUrging
        | NodeOption::BelieveRevelation
        | NodeOption::ObeyBan => {
            change_relation(
                world,
                dreamer,
                ghost,
                params.dream_affinity_gain,
                params.dream_trust_gain,
            );
        }
        NodeOption::BurnOffering => {
            burn(world, dreamer, ghost, 1, params.burn_offering_affinity_gain)
        }
        NodeOption::BurnSmall => burn(world, dreamer, ghost, 3, params.burn_small_affinity_gain),
        NodeOption::DismissDream
        | NodeOption::GrantNextSlot
        | NodeOption::GrantLaterSlot
        | NodeOption::Deny => {}
    }
}

/// Adds one dream's as-intent gains to the dreamer's Relation toward the Ghost.
fn change_relation(world: &mut World, dreamer: PersonId, ghost: PersonId, affinity: i8, trust: i8) {
    if let Some(relation) = world.relations.get_mut(&(dreamer, ghost)) {
        relation.affinity = Score::clamped(i64::from(nodes::clamp_score(
            relation.affinity.get(),
            affinity,
        )));
        relation.trust = Score::clamped(i64::from(nodes::clamp_score(relation.trust.get(), trust)));
    }
}

/// One Offering of `offering_amount / divisor` (at least 1), then the affinity gain.
fn burn(world: &mut World, dreamer: PersonId, ghost: PersonId, divisor: u64, affinity: i8) {
    if is_resident(world, dreamer) && is_ghost(world, ghost) {
        let base = offerings::offering_amount(world, dreamer, ghost, 1);
        let amount = nodes::clamp_offer(base.checked_div(divisor).unwrap_or(base));
        if let Some(soul) = world.persons.get(&ghost).map(|person| person.soul) {
            offerings::append_offering(world, dreamer, ghost, soul, amount);
        }
    }
    if let Some(relation) = world.relations.get_mut(&(dreamer, ghost)) {
        relation.affinity = Score::clamped(i64::from(nodes::clamp_score(
            relation.affinity.get(),
            affinity,
        )));
    }
}

/// Whether `person` is a living Resident.
fn is_resident(world: &World, person: PersonId) -> bool {
    world
        .persons
        .get(&person)
        .is_some_and(|p| matches!(p.life, Life::Alive { .. }))
}

/// Whether `person` is a dead body whose Soul waits (a Ghost).
fn is_ghost(world: &World, person: PersonId) -> bool {
    let Some(body) = world.persons.get(&person) else {
        return false;
    };
    matches!(body.life, Life::Dead { .. })
        && matches!(
            world.souls.places.get(&body.soul),
            Some(SoulPlace::Waiting { .. })
        )
}

/// The full name of a Person, or `Unknown` for an ID that is not one.
fn person_name(world: &World, id: PersonId) -> String {
    world
        .persons
        .get(&id)
        .map(|person| person.name.text(person.sex))
        .unwrap_or_else(|| String::from("Unknown"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{InputSeq, Tick};
    use crate::input::{InputPayload, TickInput};
    use crate::llm::card::parse_card;
    use crate::params::Params;
    use crate::underworld::player::start_wait;
    use crate::world::WorldConfig;

    fn world(params: Params) -> World {
        World::new_with_params(11, WorldConfig::try_new(40).unwrap(), params).unwrap()
    }

    /// Kills the Player_Soul's body today and starts its wait, so a Ghost exists.
    fn kill_player(world: &mut World) -> PersonId {
        let player = world.souls.player;
        let SoulPlace::Body(body) = world.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        let tick = world.tick;
        if let Some(person) = world.persons.get_mut(&body) {
            person.life = Life::Dead { death: tick };
        }
        world
            .souls
            .places
            .insert(player, SoulPlace::Waiting { since: tick });
        start_wait(world, player, tick);
        body
    }

    /// A living Resident connected to `ghost` and holding `balance` joss paper.
    fn connected_dreamer(world: &mut World, ghost: PersonId, balance: u64) -> PersonId {
        let id = world
            .persons
            .values()
            .find(|person| {
                person.id != ghost
                    && matches!(person.life, Life::Alive { .. })
                    && world.relations.contains_key(&(person.id, ghost))
            })
            .map(|person| person.id)
            .expect("the Opening_World leaves a kin Relation");
        let player = world.souls.player;
        if let Some(account) = world.joss.get_mut(&player) {
            account.balance = balance;
        }
        id
    }

    fn step(world: &mut World, payloads: &[InputPayload]) {
        let inputs: Vec<TickInput> = payloads
            .iter()
            .enumerate()
            .map(|(index, payload)| TickInput {
                tick: world.tick,
                seq: InputSeq(u64::try_from(index).unwrap()),
                payload: *payload,
            })
            .collect();
        world.step(&inputs);
    }

    /// The joss paper credited to `soul` by the Offering Events in the log.
    fn offerings_credited(world: &World, soul: crate::ids::SoulId) -> u64 {
        world
            .log()
            .events()
            .iter()
            .filter_map(|event| match event.kind {
                EventKind::Offering {
                    ghost, credited, ..
                } => {
                    let ghost_soul = world.persons.get(&ghost)?.soul;
                    (ghost_soul == soul).then_some(credited)
                }
                _ => None,
            })
            .sum()
    }

    #[test]
    fn every_intent_has_its_designed_option_set() {
        for intent in DreamIntent::ALL {
            let options = intent.options();
            assert_eq!(options.len(), 3, "{intent:?}");
            assert_eq!(options[2], NodeOption::DismissDream, "{intent:?}");
            assert_eq!(
                options[0],
                intent.as_intent_option(),
                "{intent:?}: the as-intent option comes first"
            );
            match intent {
                DreamIntent::RequestOffering => {
                    assert_eq!(options[1], NodeOption::BurnSmall);
                }
                _ => assert_eq!(options[1], NodeOption::BurnOffering),
            }
            let ids: Vec<&str> = options.iter().map(|option| option.id()).collect();
            assert_eq!(ids.len(), 3);
            assert!(ids.iter().all(|id| NodeOption::from_id(id).is_some()));
        }
        // The order of the closing option is the context order, never alphabetical.
        let warn: Vec<&str> = DreamIntent::Warn
            .options()
            .iter()
            .map(|option| option.id())
            .collect();
        assert_eq!(warn, ["heed_warning", "burn_offering", "dismiss_dream"]);
    }

    /// Reads the three dream Dev_Cards and checks the Rules_Default against them for
    /// every noise value in -10..=10 (design "Rules_Default formulas" table).
    #[test]
    fn dream_default_agrees_with_dev_cards() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../eval/cards/cards/dev.jsonl");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        // card id -> the option the design's table expects.
        let expected: [(&str, NodeOption); 3] = [
            ("D-dream_interpretation-001", NodeOption::BurnOffering),
            ("D-dream_interpretation-002", NodeOption::DismissDream),
            ("D-dream_interpretation-003", NodeOption::BurnOffering),
        ];
        let mut seen: Vec<String> = Vec::new();
        for (line_no, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let (meta, context, key, _) =
                parse_card(line, line_no.saturating_add(1)).expect("the card parses");
            let Some((_, want)) = expected.iter().find(|(id, _)| *id == meta.id) else {
                continue;
            };
            seen.push(meta.id.clone());
            for noise in -10..=10 {
                assert_eq!(
                    dream_default(&context, noise),
                    *want,
                    "{} at noise {noise}",
                    meta.id
                );
            }
            // The card grades the expected option acceptable, and the options the role
            // map does not know are never chosen.
            let crate::llm::key::AnswerKey::Decision { acceptable, .. } = &key else {
                panic!("{} is a decision card", meta.id);
            };
            assert!(
                acceptable.iter().any(|option| option.as_str() == want.id()),
                "{}: {} is not acceptable",
                meta.id,
                want.id()
            );
            for card_only in ["read_as_blessing", "sell_house"] {
                assert!(
                    NodeOption::from_id(card_only).is_none(),
                    "{card_only} has no role in the node's option set"
                );
            }
        }
        assert_eq!(
            seen.len(),
            expected.len(),
            "every dream Dev_Card was read: {seen:?}"
        );
    }

    #[test]
    fn a_dream_spends_fires_and_resolves_in_one_tick() {
        let mut world = world(Params::DEFAULT);
        let ghost = kill_player(&mut world);
        let dreamer = connected_dreamer(&mut world, ghost, 100);
        let player = world.souls.player;
        let price = world.params.dream_price;
        let start = world.joss()[&player].balance;
        let credits_before = offerings_credited(&world, player);
        step(
            &mut world,
            &[InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Warn,
            }],
        );
        // The dream's own burn option may credit the Soul again; the ledger identity
        // balance = start + credits - spends must hold with exactly one spend of
        // `dream_price`.
        let balance = world.joss()[&player].balance;
        let credits = offerings_credited(&world, player);
        assert!(credits >= credits_before, "offerings only add credit");
        assert_eq!(
            balance,
            start + (credits - credits_before) - price,
            "the only spend is the dream price"
        );
        assert!(world.nodes().pending.is_empty(), "no node stays pending");
        let record = *world.nodes().resolved.last().expect("one record");
        assert_eq!(record.family, NodeFamily::DreamInterpretation);
        assert_eq!(record.subject, dreamer);
        assert_eq!(record.tick, Tick(0));
        assert_eq!(
            record.source,
            nodes::ChoiceSource::RulesDefault,
            "no External_Choice was submitted"
        );
        assert_eq!(record.applied, record.rules_default);
        assert!(
            world
                .log()
                .events()
                .iter()
                .any(|event| matches!(event.kind, EventKind::Dream { .. }))
        );
    }

    #[test]
    fn an_external_choice_is_applied_and_recorded_as_external() {
        let mut world = world(Params::DEFAULT);
        let ghost = kill_player(&mut world);
        let dreamer = connected_dreamer(&mut world, ghost, 100);
        step(
            &mut world,
            &[
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::Warn,
                },
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(0) },
                    option: NodeOption::HeedWarning,
                },
            ],
        );
        let record = *world.nodes().resolved.last().expect("one record");
        assert_eq!(record.source, nodes::ChoiceSource::External);
        assert_eq!(record.applied, NodeOption::HeedWarning);
    }

    #[test]
    fn a_choice_before_its_trigger_is_unknown_and_twice_is_already_chosen() {
        let mut world = world(Params::DEFAULT);
        let ghost = kill_player(&mut world);
        let dreamer = connected_dreamer(&mut world, ghost, 100);
        step(
            &mut world,
            &[
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(1) },
                    option: NodeOption::HeedWarning,
                },
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::Warn,
                },
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(1) },
                    option: NodeOption::DismissDream,
                },
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(1) },
                    option: NodeOption::BurnOffering,
                },
            ],
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::UnknownNode),
            Some(&1)
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::AlreadyChosen),
            Some(&1)
        );
    }

    #[test]
    fn an_option_outside_the_set_is_refused() {
        let mut world = world(Params::DEFAULT);
        let ghost = kill_player(&mut world);
        let dreamer = connected_dreamer(&mut world, ghost, 100);
        step(
            &mut world,
            &[
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::Warn,
                },
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(0) },
                    option: NodeOption::BurnSmall,
                },
            ],
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::OptionNotInSet),
            Some(&1)
        );
        assert_eq!(
            world.nodes().resolved.last().map(|record| record.source),
            Some(nodes::ChoiceSource::RulesDefault)
        );
    }

    #[test]
    fn the_checks_run_in_the_documented_order() {
        let mut world = world(Params::DEFAULT);
        // Before the first death there is no Ghost at all.
        let resident = world
            .persons
            .values()
            .find(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .expect("a Resident");
        step(
            &mut world,
            &[InputPayload::Dream {
                dreamer: resident,
                intent: DreamIntent::Warn,
            }],
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::NoGhost),
            Some(&1)
        );

        // A second dream in the same tick is rate-limited; the first one applies.
        let ghost = kill_player(&mut world);
        let dreamer = connected_dreamer(&mut world, ghost, 100);
        world.rejections.count_by_reason.clear();
        step(
            &mut world,
            &[
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::Warn,
                },
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::Urge,
                },
            ],
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::RateLimited),
            Some(&1)
        );

        // A dreamer with too little joss paper.
        let poor = connected_dreamer(&mut world, ghost, 0);
        world.rejections.count_by_reason.clear();
        world.nodes.resolved.clear();
        step(
            &mut world,
            &[InputPayload::Dream {
                dreamer: poor,
                intent: DreamIntent::Warn,
            }],
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::InsufficientJoss),
            Some(&1)
        );

        // The Magistrate is never a dreamer (R15.9).
        let magistrate = world.magistrate().id;
        world.rejections.count_by_reason.clear();
        step(
            &mut world,
            &[InputPayload::Dream {
                dreamer: magistrate,
                intent: DreamIntent::Warn,
            }],
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::OfficialPerson),
            Some(&1)
        );
    }

    #[test]
    fn an_unconnected_dreamer_is_refused() {
        let mut world = world(Params::DEFAULT);
        let ghost = kill_player(&mut world);
        let unconnected = world
            .persons
            .values()
            .find(|person| {
                person.id != ghost
                    && matches!(person.life, Life::Alive { .. })
                    && !world.relations.contains_key(&(person.id, ghost))
            })
            .map(|person| person.id)
            .expect("the Opening_World leaves unrelated Residents");
        if let Some(account) = world.joss.get_mut(&world.souls.player) {
            account.balance = 100;
        }
        step(
            &mut world,
            &[InputPayload::Dream {
                dreamer: unconnected,
                intent: DreamIntent::Warn,
            }],
        );
        assert_eq!(
            world
                .rejections()
                .count_by_reason
                .get(&RejectReason::NotConnected),
            Some(&1)
        );
    }

    #[test]
    fn burn_offering_appends_an_offering_and_adds_affinity() {
        let mut world = world(Params::DEFAULT);
        let ghost = kill_player(&mut world);
        let dreamer = connected_dreamer(&mut world, ghost, 100);
        let before = world.relations()[&(dreamer, ghost)].affinity.get();
        step(
            &mut world,
            &[
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::RequestOffering,
                },
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(0) },
                    option: NodeOption::BurnOffering,
                },
            ],
        );
        let after = world.relations()[&(dreamer, ghost)].affinity.get();
        assert_eq!(
            after,
            nodes::clamp_score(before, world.params.burn_offering_affinity_gain)
        );
        let offering = world
            .log()
            .events()
            .iter()
            .rev()
            .find_map(|event| match event.kind {
                EventKind::Offering {
                    offerer,
                    ghost: to,
                    amount,
                    ..
                } if offerer == dreamer && to == ghost => Some((offerer, to, amount)),
                _ => None,
            })
            .expect("the burn appends an Offering from the dreamer");
        assert_eq!(offering.0, dreamer);
        assert_eq!(offering.1, ghost);
        assert!((1..=500).contains(&offering.2));
    }

    #[test]
    fn dismiss_changes_nothing() {
        let mut world = world(Params::DEFAULT);
        let ghost = kill_player(&mut world);
        let dreamer = connected_dreamer(&mut world, ghost, 100);
        let before = world.relations()[&(dreamer, ghost)].clone();
        step(
            &mut world,
            &[
                InputPayload::Dream {
                    dreamer,
                    intent: DreamIntent::Reassure,
                },
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(0) },
                    option: NodeOption::DismissDream,
                },
            ],
        );
        assert_eq!(world.relations()[&(dreamer, ghost)], before);
        // The dreamer is an eligible offerer of the Ghost, so step 5 still burns the
        // funeral offering for it; a dismissed dream adds no second one.
        let burned = world
            .log()
            .events()
            .iter()
            .filter(|event| {
                matches!(
                    event.kind,
                    EventKind::Offering { offerer, ghost: to, .. }
                        if offerer == dreamer && to == ghost
                )
            })
            .count();
        assert_eq!(burned, 1, "only the funeral offering is in the log");
    }
}
