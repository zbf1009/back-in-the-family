//! The Decision_Node convention (R3, OP-D2 A, OP-U11, OP-U12).
//!
//! A node fires inside step 2a from the input that caused it (a dream, later a Bribe),
//! lives until step 2b of the same tick and is resolved exactly once there (OP-U11 A).
//! The pure parts of the convention — the option sets, the Rules_Default and
//! `clamp_effect` — read only the Frozen_Context and the node's noise draw, so a later
//! decision model can call them unchanged (design "Seam for the decision model").
//!
//! `Nodes::pending` holds at most the nodes of the current tick and is empty at every
//! tick boundary; `Nodes::resolved` is the append-only record list that enters the
//! Checksum (R3.6). The context is encoded as its `frozen_context_to_json` text, so the
//! checksum covers exactly what a later decision model would have seen (design
//! "Canonical encoding").

use std::collections::BTreeMap;

use crate::canon::{Canon, CanonWriter};
use crate::context_builder::build_node_context;
use crate::ids::{EntityId, IdCounter, InputSeq, NodeId, PersonId, Tick};
use crate::llm::{Family, FrozenContext, OptionDef, PlayerInput};
use crate::rng::{self, StreamTag};
use crate::underworld::{dreams, magistrate};
use crate::world::{RejectReason, World};

/// The value the Node ID counter of a fresh World is at (R3.1).
pub(crate) const NODE_IDS_START: u64 = 1;

/// The option sets and the resolution site of a node (OP-D2 A). Extended by later
/// families; `match` sites are exhaustive so a new family cannot be forgotten.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum NodeFamily {
    /// A dream the Player_Soul's Ghost sends to a living dreamer (R4).
    DreamInterpretation,
    /// A Bribe's appeal, ruled on by the Magistrate (R6).
    MagistrateRuling,
}

impl NodeFamily {
    /// The card family of a Context_Builder call.
    pub const fn family(self) -> Family {
        match self {
            Self::DreamInterpretation => Family::DreamInterpretation,
            Self::MagistrateRuling => Family::MagistrateRuling,
        }
    }

    /// The explicit canonical tag, in declaration order.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::DreamInterpretation => 0,
            Self::MagistrateRuling => 1,
        }
    }
}

/// Every option ID of both families, as a closed enum (OP-U12 A). Serialized as its
/// snake_case ID; an option outside a node's set is a valid value that the node rejects
/// `option_not_in_set` (R3.4).
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum NodeOption {
    /// `heed_warning`: the dreamer acts on a warning.
    HeedWarning,
    /// `take_comfort`: the dreamer takes a reassuring dream to heart.
    TakeComfort,
    /// `follow_urging`: the dreamer does what the dream urged.
    FollowUrging,
    /// `believe_revelation`: the dreamer believes what the dream revealed.
    BelieveRevelation,
    /// `obey_ban`: the dreamer obeys the ban the dream set.
    ObeyBan,
    /// `burn_offering`: one Offering to the Ghost.
    BurnOffering,
    /// `burn_small`: one third of an Offering to the Ghost.
    BurnSmall,
    /// `dismiss_dream`: nothing changes.
    DismissDream,
    /// `grant_next_slot`: the register opens now (R6.6).
    GrantNextSlot,
    /// `grant_later_slot`: the register opens after `grant_later_delay`.
    GrantLaterSlot,
    /// `deny`: the queue stands; nothing changes (R6.7).
    Deny,
}

impl NodeOption {
    /// Every option, in the order of the design's option tables.
    pub const ALL: [Self; 11] = [
        Self::HeedWarning,
        Self::TakeComfort,
        Self::FollowUrging,
        Self::BelieveRevelation,
        Self::ObeyBan,
        Self::BurnOffering,
        Self::BurnSmall,
        Self::DismissDream,
        Self::GrantNextSlot,
        Self::GrantLaterSlot,
        Self::Deny,
    ];

    /// The snake_case option ID (OP-U12 A).
    pub const fn id(self) -> &'static str {
        match self {
            Self::HeedWarning => "heed_warning",
            Self::TakeComfort => "take_comfort",
            Self::FollowUrging => "follow_urging",
            Self::BelieveRevelation => "believe_revelation",
            Self::ObeyBan => "obey_ban",
            Self::BurnOffering => "burn_offering",
            Self::BurnSmall => "burn_small",
            Self::DismissDream => "dismiss_dream",
            Self::GrantNextSlot => "grant_next_slot",
            Self::GrantLaterSlot => "grant_later_slot",
            Self::Deny => "deny",
        }
    }

    /// Looks an option up by its snake_case ID.
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|option| option.id() == id)
    }

    /// The explicit canonical tag, in declaration order. Appended, never renumbered.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::HeedWarning => 0,
            Self::TakeComfort => 1,
            Self::FollowUrging => 2,
            Self::BelieveRevelation => 3,
            Self::ObeyBan => 4,
            Self::BurnOffering => 5,
            Self::BurnSmall => 6,
            Self::DismissDream => 7,
            Self::GrantNextSlot => 8,
            Self::GrantLaterSlot => 9,
            Self::Deny => 10,
        }
    }
}

/// How an External_Choice names its node (OP-U12 A): by the `seq` the firing input got
/// in this tick. `NodeRef` is an enum so a later spec can add a node-ID variant.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum NodeRef {
    /// The node fired by the input with this `seq` in the current tick.
    Trigger {
        /// The `seq` of the trigger input.
        seq: InputSeq,
    },
}

impl NodeRef {
    /// The trigger `seq` this ref names.
    pub const fn trigger(self) -> InputSeq {
        match self {
            Self::Trigger { seq } => seq,
        }
    }
}

/// Where the applied option came from (R3.3).
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum ChoiceSource {
    /// An External_Choice attached in step 2a.
    External,
    /// The family's Rules_Default.
    RulesDefault,
}

impl ChoiceSource {
    /// The explicit canonical tag, in declaration order.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::External => 0,
            Self::RulesDefault => 1,
        }
    }
}

/// What the node's effect needs beyond its context (design "Decision_Node convention").
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum NodeParams {
    /// `dream_interpretation`: the dream's intent.
    Dream {
        /// The intent the dream was sent with.
        intent: dreams::DreamIntent,
    },
    /// `magistrate_ruling`: the joss paper the Ghost burned (R6.4).
    Ruling {
        /// The `magnitude` of the Bribe's `offering` Event.
        amount: u64,
    },
}

impl NodeParams {
    /// The explicit canonical tag, in declaration order.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::Dream { .. } => 0,
            Self::Ruling { .. } => 1,
        }
    }
}

/// A node that fired in this tick and has not resolved yet.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PendingNode {
    /// The Node ID, from the dedicated counter (R3.1).
    pub id: NodeId,
    /// The `seq` of the input that fired it (OP-U12 A).
    pub trigger: InputSeq,
    /// The family.
    pub family: NodeFamily,
    /// The dreamer (or, for a ruling, the Magistrate).
    pub subject: PersonId,
    /// The acting Ghost.
    pub ghost: PersonId,
    /// 2..=5 distinct options, in context order.
    pub options: Vec<NodeOption>,
    /// One of `options`, computed from the context and the node's draw.
    pub rules_default: NodeOption,
    /// Frozen at firing and never mutated (R3.8).
    pub context: FrozenContext,
    /// At most one valid External_Choice (R3.4).
    pub external: Option<NodeOption>,
    /// What the effect needs beyond the context.
    pub params: NodeParams,
}

/// One resolved node (R3.6). Part of the Checksum.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct NodeRecord {
    /// The Node ID.
    pub id: NodeId,
    /// The tick it fired and resolved.
    pub tick: Tick,
    /// The family.
    pub family: NodeFamily,
    /// The dreamer or the Magistrate.
    pub subject: PersonId,
    /// The option that was applied.
    pub applied: NodeOption,
    /// Where `applied` came from.
    pub source: ChoiceSource,
    /// The Rules_Default it was chosen against.
    pub rules_default: NodeOption,
}

/// The node state of the World: the ID counter, this tick's pending nodes and the
/// append-only record list.
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Nodes {
    /// The Node ID counter (R3.1).
    pub ids: IdCounter,
    /// Pending nodes in Node ID order; empty at every tick boundary.
    pub pending: BTreeMap<NodeId, PendingNode>,
    /// Every resolved node, in resolution order.
    pub resolved: Vec<NodeRecord>,
}

impl Nodes {
    /// A fresh, empty node state.
    pub fn new() -> Self {
        Self {
            ids: IdCounter::starting_at(NODE_IDS_START),
            pending: BTreeMap::new(),
            resolved: Vec::new(),
        }
    }
}

impl Default for Nodes {
    fn default() -> Self {
        Self::new()
    }
}

/// Everything `fire` needs to build a node, prepared by its family module.
pub(crate) struct NodePlan {
    /// The family.
    pub family: NodeFamily,
    /// The dreamer or the Magistrate.
    pub subject: PersonId,
    /// The acting Ghost.
    pub ghost: PersonId,
    /// The Events the context shows (OP-D5 A).
    pub focus: Vec<PersonId>,
    /// The option set, in context order.
    pub options: Vec<NodeOption>,
    /// The same options as card definitions, in the same order.
    pub option_defs: Vec<OptionDef>,
    /// The fixed situation template with its values filled in.
    pub situation: String,
    /// The dream's intent block; `None` for a ruling.
    pub player_input: Option<PlayerInput>,
    /// What the effect needs beyond the context.
    pub params: NodeParams,
}

/// Fires a node in step 2a (design "Decision_Node convention" step 1).
///
/// Returns `None` when the Node ID counter is exhausted or the prepared context cannot
/// be built. Both are unreachable for a validated input and a fixed option table, so
/// the caller keeps the spend and the Events and simply has no node to resolve; the
/// `debug_assert`s make the case loud in tests.
pub(crate) fn fire(world: &mut World, trigger: InputSeq, plan: NodePlan) -> Option<NodeId> {
    debug_assert_eq!(
        plan.options.len(),
        plan.option_defs.len(),
        "a plan has one card definition per option"
    );
    let Ok(id) = world.nodes.ids.next() else {
        debug_assert!(
            false,
            "the Node ID counter cannot be exhausted in any real run"
        );
        return None;
    };
    let id = NodeId(id);
    let Ok(context) = build_node_context(
        world,
        plan.subject,
        &plan.focus,
        plan.family.family(),
        plan.option_defs,
        plan.situation,
        plan.player_input,
    ) else {
        debug_assert!(
            false,
            "a validated node subject and option table build a context"
        );
        return None;
    };
    let rules_default = default_option(world, id, plan.family, &context);
    debug_assert!(
        plan.options.contains(&rules_default),
        "the Rules_Default is one of the node's options"
    );
    world.nodes.pending.insert(
        id,
        PendingNode {
            id,
            trigger,
            family: plan.family,
            subject: plan.subject,
            ghost: plan.ghost,
            options: plan.options,
            rules_default,
            context,
            external: None,
            params: plan.params,
        },
    );
    Some(id)
}

/// The family's Rules_Default, from the frozen context and the node's noise draws
/// (design "Rules_Default formulas").
fn default_option(
    world: &World,
    id: NodeId,
    family: NodeFamily,
    context: &FrozenContext,
) -> NodeOption {
    match family {
        NodeFamily::DreamInterpretation => {
            let bound = i64::try_from(world.params.dream_noise).unwrap_or(10);
            let noise = rng::in_range(
                rng::draw(world.seed, EntityId(id.0), StreamTag::Nodes, world.tick, 0),
                bound.saturating_neg(),
                bound,
            );
            dreams::dream_default(context, noise)
        }
        NodeFamily::MagistrateRuling => {
            let noise = |site: u64, cap: u64| {
                let cap = i64::try_from(cap).unwrap_or(0);
                rng::in_range(
                    rng::draw(
                        world.seed,
                        EntityId(id.0),
                        StreamTag::Nodes,
                        world.tick,
                        site,
                    ),
                    cap.saturating_neg(),
                    cap,
                )
            };
            let next_noise = noise(1, world.params.next_noise);
            let later_noise = noise(2, world.params.later_noise);
            magistrate::ruling_default(context, next_noise, later_noise, &world.params)
        }
    }
}

/// Attaches an External_Choice to the pending node of `node` (design "Decision_Node
/// convention" step 2). Checks `unknown_node`, `option_not_in_set`, `already_chosen`, in
/// that order (R3.4).
pub(crate) fn attach_choice(
    world: &mut World,
    node: NodeRef,
    option: NodeOption,
) -> Result<(), RejectReason> {
    let trigger = node.trigger();
    let Some(id) = world
        .nodes
        .pending
        .values()
        .find(|pending| pending.trigger == trigger)
        .map(|pending| pending.id)
    else {
        return Err(RejectReason::UnknownNode);
    };
    let Some(pending) = world.nodes.pending.get_mut(&id) else {
        return Err(RejectReason::UnknownNode);
    };
    if !pending.options.contains(&option) {
        return Err(RejectReason::OptionNotInSet);
    }
    if pending.external.is_some() {
        return Err(RejectReason::AlreadyChosen);
    }
    pending.external = Some(option);
    Ok(())
}

/// Bounds one written affinity or trust value (R3.10): the delta is clamped to
/// `-10..=10` (the OP-U11 bracket) and the result to `-100..=100`.
pub fn clamp_score(current: i8, delta: i8) -> i8 {
    let delta = delta.clamp(-10, 10);
    let total = i64::from(current).saturating_add(i64::from(delta));
    crate::values::Score::clamped(total).get()
}

/// Bounds one written Offering amount to `1..=500` (R3.10).
pub fn clamp_offer(amount: u64) -> u64 {
    amount.clamp(1, 500)
}

/// Bounds a written `access_from` to `T..=current` (R3.10, OP-U6 A).
pub fn clamp_access(now: Tick, proposed: Tick, current: Tick) -> Tick {
    let low = now.0;
    let high = current.0.max(low);
    Tick(proposed.0.clamp(low, high))
}

/// Writes a text with a `u32` byte length: the canonical encoding of the stored
/// `frozen_context_to_json` text.
fn encode_text<W: CanonWriter>(w: &mut W, text: &str) {
    let len = u32::try_from(text.len()).expect("a context text fits in u32");
    len.encode(w);
    w.bytes(text.as_bytes());
}

impl Canon for NodeFamily {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
    }
}

impl Canon for NodeOption {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
    }
}

impl Canon for ChoiceSource {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
    }
}

impl Canon for NodeParams {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
        match self {
            Self::Dream { intent } => intent.encode(w),
            Self::Ruling { amount } => amount.encode(w),
        }
    }
}

impl Canon for PendingNode {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            trigger,
            family,
            subject,
            ghost,
            options,
            rules_default,
            context,
            external,
            params,
        } = self;
        id.encode(w);
        trigger.encode(w);
        family.encode(w);
        subject.encode(w);
        ghost.encode(w);
        options.encode(w);
        rules_default.encode(w);
        encode_text(
            w,
            &crate::llm::json::write(&crate::llm::api::frozen_context_to_json(context)),
        );
        external.encode(w);
        params.encode(w);
    }
}

impl Canon for NodeRecord {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            tick,
            family,
            subject,
            applied,
            source,
            rules_default,
        } = self;
        id.encode(w);
        tick.encode(w);
        family.encode(w);
        subject.encode(w);
        applied.encode(w);
        source.encode(w);
        rules_default.encode(w);
    }
}

impl Canon for Nodes {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            ids,
            pending,
            resolved,
        } = self;
        ids.encode(w);
        pending.encode(w);
        resolved.encode(w);
    }
}
