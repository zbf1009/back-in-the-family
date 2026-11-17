//! Replay files (design decision D5: JSON, every `u64` as a decimal string).
//!
//! A replay is the seed, the world config, the recorded inputs and the checksum of
//! every tick. [`verify`] rebuilds a [`Sim`] from the seed, config and inputs **only**
//! and compares each tick's checksum with the recorded one; the recorded checksums are
//! never used to build state.
//!
//! # Format (version 5)
//!
//! ```json
//! {
//!   "format": "back-in-the-family/replay",
//!   "version": 5,
//!   "seed": "1",
//!   "config": { "opening_residents": 50 },
//!   "ticks": "2000",
//!   "inputs": [ { "tick": "5", "seq": "0",
//!                 "payload": { "Act": { "kind": "help", "actor": "3",
//!                                       "target": "17", "intensity": 40 } } } ],
//!   "checksums": [ "9f2c0a7d41e3b856" ]
//! }
//! ```
//!
//! One input per underworld payload kind:
//!
//! ```json
//! {"ClaimSlot":{"slot":{"Birth":"3"}}}
//! {"ClaimSlot":{"slot":"ImportedVessel"}}
//! {"ClaimSlot":{"slot":"RebuiltBody","customization":{"Set":{"trait_name":"warmth","value":2}}}}
//! {"ClaimSlot":{"slot":"RebuiltBody","customization":{"Adjust":{"first":{"trait_name":"greed","delta":-1},"second":{"trait_name":"piety","delta":1}}}}}
//! {"CarryOver":{"trait_name":"piety"}}
//! {"Dream":{"dreamer":"17","intent":"warn"}}
//! {"Haunt":{"target":"9"}}
//! {"Bribe":{"amount":"120"}}
//! {"Choose":{"node":{"Trigger":{"seq":"64"}},"option":"heed_warning"}}
//! {"ChoosePlayer":{"node":"12","option":"repay_now"}}
//! ```
//!
//! - Every `u64` (`seed`, `ticks`, input `tick` and `seq`, person ids, slot ids) is a JSON string
//!   in canonical decimal form: ASCII digits only, no sign, no leading zeros except
//!   `"0"` itself, no overflow. JavaScript numbers cannot hold a `u64` exactly, and one
//!   textual form per value keeps files diffable. A JSON number in its place is an
//!   error.
//! - Small integers (`opening_residents`, `intensity`, `version`) are JSON numbers. No
//!   field is a float; `1.5` anywhere an integer is expected is an error.
//! - Checksums are 16 lowercase hex characters ([`Checksum`]'s `Display`).
//! - Unknown fields are rejected, so a typo or a newer format cannot be silently
//!   ignored. [`ReplayConfig`] rejects a `workload` field with serde's `unknown field
//!   \`workload\`` and no World is created (R1.3).
//! - Versions 2 (skeleton), 3 (life-sim) and 4 (underworld baseline) are rejected as
//!   [`ReplayError::UnsupportedVersion`]. Version 5 consumes the staged Player_Node
//!   choice and Rebuilt_Body customization payloads. A `None` customization is omitted.
//!
//! # Layering
//!
//! The serde derives live only on the DTO types in this module ([`ReplayFile`],
//! [`ReplayInput`], [`ReplayPayload`], [`ReplaySlotRef`], [`ReplayTraitName`],
//! [`ReplayDreamIntent`], [`ReplayNodeRef`], [`ReplayNodeOption`],
//! [`ReplayPlayerOption`], [`ReplaySocialKind`], [`ReplayConfig`]). Core
//! types (`WorldConfig`, `InputPayload`, ...) convert to and from them, so a change to a
//! core type cannot change the on-disk format by accident.
//!
//! # Input order
//!
//! `inputs` are listed in **submission order**, which is `seq` order: the input at
//! index `i` must have `seq == i`. [`record`] writes them that way (not `(tick, seq)`
//! order) and [`verify`] re-submits them in that order, so the stream assigns identical
//! `seq` values. Any other numbering is rejected as malformed rather than renumbered.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::checksum::Checksum;
use crate::ids::{BirthSlotId, NodeId, PersonId, Tick};
use crate::input::{InputPayload, SubmitError};
use crate::narrator::PlayerOption;
use crate::tick::{Sim, SimError};
use crate::underworld::carry_over::TraitName;
use crate::underworld::customization::Customization;
use crate::underworld::dreams::DreamIntent;
use crate::underworld::nodes::{NodeOption, NodeRef};
use crate::underworld::slots::SlotRef;
use crate::values::SocialKind;
use crate::world::{ConfigError, WorldConfig};

/// The `format` string of every replay file.
pub const REPLAY_FORMAT: &str = "back-in-the-family/replay";
/// The only replay `version` this code reads and writes.
pub const REPLAY_VERSION: u32 = 5;

/// Strict decimal-string codec for `u64`, for `#[serde(with = "u64_string")]`.
mod u64_string {
    use std::fmt;

    use serde::de::{Error, Visitor};
    use serde::{Deserializer, Serializer};

    /// Parses the canonical decimal form of a `u64`.
    fn parse(s: &str) -> Result<u64, &'static str> {
        if s.is_empty() {
            return Err("empty string is not a u64");
        }
        if !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err("u64 string must contain only ASCII digits 0-9 (no sign or spaces)");
        }
        if s.len() > 1 && s.starts_with('0') {
            return Err("u64 string must not have leading zeros");
        }
        s.parse::<u64>()
            .map_err(|_| "u64 string overflows the u64 range")
    }

    struct U64Visitor;

    impl Visitor<'_> for U64Visitor {
        type Value = u64;

        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a u64 as a canonical decimal string")
        }

        fn visit_str<E: Error>(self, v: &str) -> Result<u64, E> {
            parse(v).map_err(E::custom)
        }
    }

    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(v)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        d.deserialize_str(U64Visitor)
    }
}

/// Codec for `Vec<Checksum>` as an array of 16-character lowercase hex strings.
mod checksum_list {
    use std::fmt;

    use serde::de::{Error, Visitor};
    use serde::ser::SerializeSeq;
    use serde::{Deserialize, Deserializer, Serializer};

    use crate::checksum::Checksum;

    struct Hex(Checksum);

    struct HexVisitor;

    impl Visitor<'_> for HexVisitor {
        type Value = Hex;

        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a checksum as 16 lowercase hex characters")
        }

        fn visit_str<E: Error>(self, v: &str) -> Result<Hex, E> {
            Checksum::from_hex(v).map(Hex).map_err(E::custom)
        }
    }

    impl<'de> Deserialize<'de> for Hex {
        fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            d.deserialize_str(HexVisitor)
        }
    }

    pub fn serialize<S: Serializer>(v: &[Checksum], s: S) -> Result<S::Ok, S::Error> {
        let mut seq = s.serialize_seq(Some(v.len()))?;
        for c in v {
            seq.serialize_element(&c.to_hex_string())?;
        }
        seq.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Checksum>, D::Error> {
        let hex = Vec::<Hex>::deserialize(d)?;
        Ok(hex.into_iter().map(|Hex(c)| c).collect())
    }
}

/// File-format twin of [`WorldConfig`]. Not validated until converted.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayConfig {
    pub opening_residents: u16,
}

impl ReplayConfig {
    /// Parses a bare config (the `config` object of a replay file, or the Sim_Cli
    /// `--config` file). Never panics.
    pub fn from_json_str(s: &str) -> Result<Self, ReplayError> {
        serde_json::from_str(s).map_err(|e| ReplayError::Malformed(e.to_string()))
    }
}

impl From<WorldConfig> for ReplayConfig {
    fn from(c: WorldConfig) -> Self {
        Self {
            opening_residents: c.opening_residents,
        }
    }
}

impl TryFrom<ReplayConfig> for WorldConfig {
    type Error = ConfigError;

    /// Validates the range (`WorldConfig::try_new`).
    fn try_from(c: ReplayConfig) -> Result<Self, ConfigError> {
        Self::try_new(c.opening_residents)
    }
}

/// File-format twin of [`SocialKind`], written as the card event-type name.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplaySocialKind {
    Help,
    Gift,
    Quarrel,
    Insult,
    Theft,
    Apology,
}

impl From<SocialKind> for ReplaySocialKind {
    fn from(kind: SocialKind) -> Self {
        match kind {
            SocialKind::Help => Self::Help,
            SocialKind::Gift => Self::Gift,
            SocialKind::Quarrel => Self::Quarrel,
            SocialKind::Insult => Self::Insult,
            SocialKind::Theft => Self::Theft,
            SocialKind::Apology => Self::Apology,
        }
    }
}

impl From<ReplaySocialKind> for SocialKind {
    fn from(kind: ReplaySocialKind) -> Self {
        match kind {
            ReplaySocialKind::Help => Self::Help,
            ReplaySocialKind::Gift => Self::Gift,
            ReplaySocialKind::Quarrel => Self::Quarrel,
            ReplaySocialKind::Insult => Self::Insult,
            ReplaySocialKind::Theft => Self::Theft,
            ReplaySocialKind::Apology => Self::Apology,
        }
    }
}

/// File-format twin of [`SlotRef`]: `{"Birth":"3"}` or `"ImportedVessel"`.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ReplaySlotRef {
    /// An announced Birth_Slot by ID.
    Birth(#[serde(with = "u64_string")] u64),
    /// The Imported_Vessel Standing_Slot.
    ImportedVessel,
    /// The Rebuilt_Body Standing_Slot.
    RebuiltBody,
}

impl From<SlotRef> for ReplaySlotRef {
    fn from(slot: SlotRef) -> Self {
        match slot {
            SlotRef::Birth(id) => Self::Birth(id.0),
            SlotRef::ImportedVessel => Self::ImportedVessel,
            SlotRef::RebuiltBody => Self::RebuiltBody,
        }
    }
}

impl From<ReplaySlotRef> for SlotRef {
    fn from(slot: ReplaySlotRef) -> Self {
        match slot {
            ReplaySlotRef::Birth(id) => Self::Birth(BirthSlotId(id)),
            ReplaySlotRef::ImportedVessel => Self::ImportedVessel,
            ReplaySlotRef::RebuiltBody => Self::RebuiltBody,
        }
    }
}

/// File-format twin of [`TraitName`], written as its card snake_case name.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplayTraitName {
    Greed,
    Loyalty,
    Pride,
    Warmth,
    Temper,
    Vindictiveness,
    Piety,
}

impl From<TraitName> for ReplayTraitName {
    fn from(name: TraitName) -> Self {
        match name {
            TraitName::Greed => Self::Greed,
            TraitName::Loyalty => Self::Loyalty,
            TraitName::Pride => Self::Pride,
            TraitName::Warmth => Self::Warmth,
            TraitName::Temper => Self::Temper,
            TraitName::Vindictiveness => Self::Vindictiveness,
            TraitName::Piety => Self::Piety,
        }
    }
}

impl From<ReplayTraitName> for TraitName {
    fn from(name: ReplayTraitName) -> Self {
        match name {
            ReplayTraitName::Greed => Self::Greed,
            ReplayTraitName::Loyalty => Self::Loyalty,
            ReplayTraitName::Pride => Self::Pride,
            ReplayTraitName::Warmth => Self::Warmth,
            ReplayTraitName::Temper => Self::Temper,
            ReplayTraitName::Vindictiveness => Self::Vindictiveness,
            ReplayTraitName::Piety => Self::Piety,
        }
    }
}

/// One named Trait and a signed step in an Adjust customization.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayTraitAdjust {
    pub trait_name: ReplayTraitName,
    pub delta: i8,
}

/// Strict file-format twin of a Rebuilt_Body customization.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ReplayCustomization {
    Set {
        trait_name: ReplayTraitName,
        value: i8,
    },
    Adjust {
        first: ReplayTraitAdjust,
        second: ReplayTraitAdjust,
    },
}

impl From<Customization> for ReplayCustomization {
    fn from(customization: Customization) -> Self {
        match customization {
            Customization::Set { trait_name, value } => Self::Set {
                trait_name: trait_name.into(),
                value,
            },
            Customization::Adjust { first, second } => Self::Adjust {
                first: ReplayTraitAdjust {
                    trait_name: first.0.into(),
                    delta: first.1,
                },
                second: ReplayTraitAdjust {
                    trait_name: second.0.into(),
                    delta: second.1,
                },
            },
        }
    }
}

impl From<ReplayCustomization> for Customization {
    fn from(customization: ReplayCustomization) -> Self {
        match customization {
            ReplayCustomization::Set { trait_name, value } => Self::Set {
                trait_name: trait_name.into(),
                value,
            },
            ReplayCustomization::Adjust { first, second } => Self::Adjust {
                first: (first.trait_name.into(), first.delta),
                second: (second.trait_name.into(), second.delta),
            },
        }
    }
}

/// File-format twin of [`DreamIntent`], written as its card name.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayDreamIntent {
    Warn,
    Reassure,
    Urge,
    Reveal,
    RequestOffering,
    Forbid,
}

impl From<DreamIntent> for ReplayDreamIntent {
    fn from(intent: DreamIntent) -> Self {
        match intent {
            DreamIntent::Warn => Self::Warn,
            DreamIntent::Reassure => Self::Reassure,
            DreamIntent::Urge => Self::Urge,
            DreamIntent::Reveal => Self::Reveal,
            DreamIntent::RequestOffering => Self::RequestOffering,
            DreamIntent::Forbid => Self::Forbid,
        }
    }
}

impl From<ReplayDreamIntent> for DreamIntent {
    fn from(intent: ReplayDreamIntent) -> Self {
        match intent {
            ReplayDreamIntent::Warn => Self::Warn,
            ReplayDreamIntent::Reassure => Self::Reassure,
            ReplayDreamIntent::Urge => Self::Urge,
            ReplayDreamIntent::Reveal => Self::Reveal,
            ReplayDreamIntent::RequestOffering => Self::RequestOffering,
            ReplayDreamIntent::Forbid => Self::Forbid,
        }
    }
}

/// File-format twin of [`NodeRef`]: `{"Trigger":{"seq":"64"}}` (OP-U12 A).
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ReplayNodeRef {
    Trigger {
        #[serde(with = "u64_string")]
        seq: u64,
    },
}

impl From<NodeRef> for ReplayNodeRef {
    fn from(node: NodeRef) -> Self {
        match node {
            NodeRef::Trigger { seq } => Self::Trigger { seq: seq.0 },
        }
    }
}

impl From<ReplayNodeRef> for NodeRef {
    fn from(node: ReplayNodeRef) -> Self {
        match node {
            ReplayNodeRef::Trigger { seq } => Self::Trigger {
                seq: crate::ids::InputSeq(seq),
            },
        }
    }
}

/// File-format twin of [`NodeOption`], written as its snake_case ID (OP-U12 A).
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayNodeOption {
    HeedWarning,
    TakeComfort,
    FollowUrging,
    BelieveRevelation,
    ObeyBan,
    BurnOffering,
    BurnSmall,
    DismissDream,
    GrantNextSlot,
    GrantLaterSlot,
    Deny,
}

impl From<NodeOption> for ReplayNodeOption {
    fn from(option: NodeOption) -> Self {
        match option {
            NodeOption::HeedWarning => Self::HeedWarning,
            NodeOption::TakeComfort => Self::TakeComfort,
            NodeOption::FollowUrging => Self::FollowUrging,
            NodeOption::BelieveRevelation => Self::BelieveRevelation,
            NodeOption::ObeyBan => Self::ObeyBan,
            NodeOption::BurnOffering => Self::BurnOffering,
            NodeOption::BurnSmall => Self::BurnSmall,
            NodeOption::DismissDream => Self::DismissDream,
            NodeOption::GrantNextSlot => Self::GrantNextSlot,
            NodeOption::GrantLaterSlot => Self::GrantLaterSlot,
            NodeOption::Deny => Self::Deny,
        }
    }
}

impl From<ReplayNodeOption> for NodeOption {
    fn from(option: ReplayNodeOption) -> Self {
        match option {
            ReplayNodeOption::HeedWarning => Self::HeedWarning,
            ReplayNodeOption::TakeComfort => Self::TakeComfort,
            ReplayNodeOption::FollowUrging => Self::FollowUrging,
            ReplayNodeOption::BelieveRevelation => Self::BelieveRevelation,
            ReplayNodeOption::ObeyBan => Self::ObeyBan,
            ReplayNodeOption::BurnOffering => Self::BurnOffering,
            ReplayNodeOption::BurnSmall => Self::BurnSmall,
            ReplayNodeOption::DismissDream => Self::DismissDream,
            ReplayNodeOption::GrantNextSlot => Self::GrantNextSlot,
            ReplayNodeOption::GrantLaterSlot => Self::GrantLaterSlot,
            ReplayNodeOption::Deny => Self::Deny,
        }
    }
}

/// Strict replay ID for the 24 closed player-facing options.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayPlayerOption {
    ComfortMourner,
    SendFlowers,
    StayAway,
    KeepIt,
    ThankFamily,
    PayDebts,
    RepayNow,
    AskForTime,
    IgnoreIt,
    DemandPayment,
    ForgiveDebt,
    WaitItOut,
    Apologize,
    Retaliate,
    LetItGo,
    AskForAToy,
    VisitGrandparents,
    AskForNothing,
    StandUpToBully,
    TellATeacher,
    KeepQuiet,
    GetAJob,
    HelpAtHome,
    TendTheShrine,
}

impl From<PlayerOption> for ReplayPlayerOption {
    fn from(option: PlayerOption) -> Self {
        match option {
            PlayerOption::ComfortMourner => Self::ComfortMourner,
            PlayerOption::SendFlowers => Self::SendFlowers,
            PlayerOption::StayAway => Self::StayAway,
            PlayerOption::KeepIt => Self::KeepIt,
            PlayerOption::ThankFamily => Self::ThankFamily,
            PlayerOption::PayDebts => Self::PayDebts,
            PlayerOption::RepayNow => Self::RepayNow,
            PlayerOption::AskForTime => Self::AskForTime,
            PlayerOption::IgnoreIt => Self::IgnoreIt,
            PlayerOption::DemandPayment => Self::DemandPayment,
            PlayerOption::ForgiveDebt => Self::ForgiveDebt,
            PlayerOption::WaitItOut => Self::WaitItOut,
            PlayerOption::Apologize => Self::Apologize,
            PlayerOption::Retaliate => Self::Retaliate,
            PlayerOption::LetItGo => Self::LetItGo,
            PlayerOption::AskForAToy => Self::AskForAToy,
            PlayerOption::VisitGrandparents => Self::VisitGrandparents,
            PlayerOption::AskForNothing => Self::AskForNothing,
            PlayerOption::StandUpToBully => Self::StandUpToBully,
            PlayerOption::TellATeacher => Self::TellATeacher,
            PlayerOption::KeepQuiet => Self::KeepQuiet,
            PlayerOption::GetAJob => Self::GetAJob,
            PlayerOption::HelpAtHome => Self::HelpAtHome,
            PlayerOption::TendTheShrine => Self::TendTheShrine,
        }
    }
}
impl From<ReplayPlayerOption> for PlayerOption {
    fn from(option: ReplayPlayerOption) -> Self {
        match option {
            ReplayPlayerOption::ComfortMourner => Self::ComfortMourner,
            ReplayPlayerOption::SendFlowers => Self::SendFlowers,
            ReplayPlayerOption::StayAway => Self::StayAway,
            ReplayPlayerOption::KeepIt => Self::KeepIt,
            ReplayPlayerOption::ThankFamily => Self::ThankFamily,
            ReplayPlayerOption::PayDebts => Self::PayDebts,
            ReplayPlayerOption::RepayNow => Self::RepayNow,
            ReplayPlayerOption::AskForTime => Self::AskForTime,
            ReplayPlayerOption::IgnoreIt => Self::IgnoreIt,
            ReplayPlayerOption::DemandPayment => Self::DemandPayment,
            ReplayPlayerOption::ForgiveDebt => Self::ForgiveDebt,
            ReplayPlayerOption::WaitItOut => Self::WaitItOut,
            ReplayPlayerOption::Apologize => Self::Apologize,
            ReplayPlayerOption::Retaliate => Self::Retaliate,
            ReplayPlayerOption::LetItGo => Self::LetItGo,
            ReplayPlayerOption::AskForAToy => Self::AskForAToy,
            ReplayPlayerOption::VisitGrandparents => Self::VisitGrandparents,
            ReplayPlayerOption::AskForNothing => Self::AskForNothing,
            ReplayPlayerOption::StandUpToBully => Self::StandUpToBully,
            ReplayPlayerOption::TellATeacher => Self::TellATeacher,
            ReplayPlayerOption::KeepQuiet => Self::KeepQuiet,
            ReplayPlayerOption::GetAJob => Self::GetAJob,
            ReplayPlayerOption::HelpAtHome => Self::HelpAtHome,
            ReplayPlayerOption::TendTheShrine => Self::TendTheShrine,
        }
    }
}

/// File-format twin of [`InputPayload`].
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ReplayPayload {
    Act {
        kind: ReplaySocialKind,
        #[serde(with = "u64_string")]
        actor: u64,
        #[serde(with = "u64_string")]
        target: u64,
        intensity: u8,
    },
    ClaimSlot {
        slot: ReplaySlotRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        customization: Option<ReplayCustomization>,
    },
    CarryOver {
        trait_name: ReplayTraitName,
    },
    Dream {
        #[serde(with = "u64_string")]
        dreamer: u64,
        intent: ReplayDreamIntent,
    },
    Haunt {
        #[serde(with = "u64_string")]
        target: u64,
    },
    Bribe {
        #[serde(with = "u64_string")]
        amount: u64,
    },
    Choose {
        node: ReplayNodeRef,
        option: ReplayNodeOption,
    },
    ChoosePlayer {
        #[serde(with = "u64_string")]
        node: u64,
        option: ReplayPlayerOption,
    },
}

impl From<InputPayload> for ReplayPayload {
    fn from(p: InputPayload) -> Self {
        match p {
            InputPayload::Act {
                kind,
                actor,
                target,
                intensity,
            } => Self::Act {
                kind: kind.into(),
                actor: actor.0,
                target: target.0,
                intensity,
            },
            InputPayload::ClaimSlot {
                slot,
                customization,
            } => Self::ClaimSlot {
                slot: slot.into(),
                customization: customization.map(Into::into),
            },
            InputPayload::CarryOver { trait_name } => Self::CarryOver {
                trait_name: trait_name.into(),
            },
            InputPayload::Dream { dreamer, intent } => Self::Dream {
                dreamer: dreamer.0,
                intent: intent.into(),
            },
            InputPayload::Haunt { target } => Self::Haunt { target: target.0 },
            InputPayload::Bribe { amount } => Self::Bribe { amount },
            InputPayload::Choose { node, option } => Self::Choose {
                node: node.into(),
                option: option.into(),
            },
            InputPayload::ChoosePlayer { node, option } => Self::ChoosePlayer {
                node: node.0,
                option: option.into(),
            },
        }
    }
}

impl From<ReplayPayload> for InputPayload {
    fn from(p: ReplayPayload) -> Self {
        match p {
            ReplayPayload::Act {
                kind,
                actor,
                target,
                intensity,
            } => Self::Act {
                kind: kind.into(),
                actor: PersonId(actor),
                target: PersonId(target),
                intensity,
            },
            ReplayPayload::ClaimSlot {
                slot,
                customization,
            } => Self::ClaimSlot {
                slot: slot.into(),
                customization: customization.map(Into::into),
            },
            ReplayPayload::CarryOver { trait_name } => Self::CarryOver {
                trait_name: trait_name.into(),
            },
            ReplayPayload::Dream { dreamer, intent } => Self::Dream {
                dreamer: PersonId(dreamer),
                intent: intent.into(),
            },
            ReplayPayload::Haunt { target } => Self::Haunt {
                target: PersonId(target),
            },
            ReplayPayload::Bribe { amount } => Self::Bribe { amount },
            ReplayPayload::Choose { node, option } => Self::Choose {
                node: node.into(),
                option: option.into(),
            },
            ReplayPayload::ChoosePlayer { node, option } => Self::ChoosePlayer {
                node: NodeId(node),
                option: option.into(),
            },
        }
    }
}

/// One recorded input, as written in the file.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayInput {
    #[serde(with = "u64_string")]
    pub tick: u64,
    #[serde(with = "u64_string")]
    pub seq: u64,
    pub payload: ReplayPayload,
}

/// A replay file. Fields are public so tooling and tests can inspect and tamper with
/// them; [`verify`] re-checks everything it relies on.
#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayFile {
    pub format: String,
    pub version: u32,
    #[serde(with = "u64_string")]
    pub seed: u64,
    pub config: ReplayConfig,
    #[serde(with = "u64_string")]
    pub ticks: u64,
    pub inputs: Vec<ReplayInput>,
    /// One checksum per tick: index `n` is the checksum after running tick `n`.
    #[serde(with = "checksum_list")]
    pub checksums: Vec<Checksum>,
}

/// One input as submitted by a live caller (e.g. the browser): a tick and a payload.
/// There is no `seq`: the input stream assigns it. Same strict `u64` string rules as
/// [`ReplayInput`].
///
/// ```json
/// { "tick": "5", "payload": { "Act": { "kind": "help", "actor": "3",
///                                     "target": "17", "intensity": 40 } } }
/// ```
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubmitInput {
    #[serde(with = "u64_string")]
    pub tick: u64,
    pub payload: ReplayPayload,
}

impl SubmitInput {
    /// Parses one submitted input. Never panics.
    pub fn from_json_str(s: &str) -> Result<Self, ReplayError> {
        serde_json::from_str(s).map_err(|e| ReplayError::Malformed(e.to_string()))
    }
}

/// The first tick at which a re-run disagrees with the recorded checksum.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Divergence {
    /// The tick that was being run (the world's tick before it advanced); equals the
    /// index into `checksums`.
    pub tick: Tick,
    /// The checksum recorded in the file.
    pub expected: Checksum,
    /// The checksum the re-run produced.
    pub actual: Checksum,
}

impl fmt::Display for Divergence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "replay diverged at tick {}: expected {}, got {}",
            self.tick.0, self.expected, self.actual
        )
    }
}

/// Why a replay could not be read, recorded or verified.
#[derive(Clone, Eq, PartialEq, Debug)]
pub enum ReplayError {
    /// The text is not valid JSON, or does not match the file format (missing or
    /// unknown field, wrong type, bad `u64` string, bad checksum). Carries the parser's
    /// message.
    Malformed(String),
    /// `format` is not [`REPLAY_FORMAT`].
    UnknownFormat { found: String },
    /// `version` is not [`REPLAY_VERSION`].
    UnsupportedVersion { found: u32 },
    /// The number of checksums differs from `ticks`.
    ChecksumCount { expected_ticks: u64, found: u64 },
    /// The input at `index` does not have `seq == index`.
    InputSeqMismatch {
        index: u64,
        expected: u64,
        found: u64,
    },
    /// The config is outside the valid ranges.
    Config(ConfigError),
    /// The input stream refused a recorded input.
    Submit(SubmitError),
    /// The re-run disagrees with a recorded checksum.
    Diverged(Divergence),
}

impl fmt::Display for ReplayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(msg) => write!(f, "malformed replay file: {msg}"),
            Self::UnknownFormat { found } => {
                write!(
                    f,
                    "unknown replay format {found:?}, expected {REPLAY_FORMAT:?}"
                )
            }
            Self::UnsupportedVersion { found } => write!(
                f,
                "unsupported replay version {found}, this build reads version {REPLAY_VERSION}"
            ),
            Self::ChecksumCount {
                expected_ticks,
                found,
            } => write!(
                f,
                "replay has {found} checksums but declares {expected_ticks} ticks"
            ),
            Self::InputSeqMismatch {
                index,
                expected,
                found,
            } => write!(
                f,
                "input {index} has seq {found}, expected {expected} (inputs must be listed in seq order starting at 0)"
            ),
            Self::Config(e) => write!(f, "invalid config in replay: {e}"),
            Self::Submit(e) => write!(f, "recorded input refused: {e}"),
            Self::Diverged(d) => d.fmt(f),
        }
    }
}

impl std::error::Error for ReplayError {}

impl From<ConfigError> for ReplayError {
    fn from(e: ConfigError) -> Self {
        Self::Config(e)
    }
}

impl From<SimError> for ReplayError {
    fn from(e: SimError) -> Self {
        match e {
            SimError::Config(c) => Self::Config(c),
        }
    }
}

impl From<SubmitError> for ReplayError {
    fn from(e: SubmitError) -> Self {
        Self::Submit(e)
    }
}

impl From<Divergence> for ReplayError {
    fn from(d: Divergence) -> Self {
        Self::Diverged(d)
    }
}

/// Only the two header fields, parsed first so a newer-format file is reported as an
/// unsupported version rather than as whatever field differs. Unknown fields allowed.
#[derive(Deserialize)]
struct Header {
    format: String,
    version: u32,
}

impl ReplayFile {
    fn check_header(&self) -> Result<(), ReplayError> {
        check_header(&self.format, self.version)
    }

    /// Serializes to compact JSON. Cannot fail for a well-formed value; a failure would
    /// be reported as [`ReplayError::Malformed`].
    pub fn to_json_string(&self) -> Result<String, ReplayError> {
        serde_json::to_string(self).map_err(|e| ReplayError::Malformed(e.to_string()))
    }

    /// Parses and structurally checks a replay file: valid JSON, known `format` and
    /// `version`, every field present and well typed. Never panics. It does not run the
    /// simulation (see [`verify`]).
    pub fn from_json_str(s: &str) -> Result<Self, ReplayError> {
        let header: Header =
            serde_json::from_str(s).map_err(|e| ReplayError::Malformed(e.to_string()))?;
        check_header(&header.format, header.version)?;
        serde_json::from_str(s).map_err(|e| ReplayError::Malformed(e.to_string()))
    }
}

fn check_header(format: &str, version: u32) -> Result<(), ReplayError> {
    if format != REPLAY_FORMAT {
        return Err(ReplayError::UnknownFormat {
            found: format.to_owned(),
        });
    }
    if version != REPLAY_VERSION {
        return Err(ReplayError::UnsupportedVersion { found: version });
    }
    Ok(())
}

/// Runs `ticks` ticks of a fresh [`Sim`] and returns the replay file.
///
/// `inputs` are `(tick, payload)` pairs **in submission order**; the stream gives them
/// `seq` 0, 1, 2, ... in that order, and the file lists them in that order. Inputs for
/// ticks at or beyond `ticks` are kept in the file but never applied.
pub fn record(
    seed: u64,
    config: WorldConfig,
    inputs: &[(Tick, InputPayload)],
    ticks: u64,
) -> Result<ReplayFile, ReplayError> {
    let mut sim = Sim::new(seed, config)?;
    let mut recorded = Vec::with_capacity(inputs.len());
    for &(tick, payload) in inputs {
        let seq = sim.submit(tick, payload)?;
        recorded.push(ReplayInput {
            tick: tick.0,
            seq: seq.0,
            payload: payload.into(),
        });
    }
    for _ in 0..ticks {
        sim.step();
    }
    Ok(ReplayFile {
        format: REPLAY_FORMAT.to_owned(),
        version: REPLAY_VERSION,
        seed,
        config: config.into(),
        ticks,
        inputs: recorded,
        checksums: sim.checksums().to_vec(),
    })
}

/// Rebuilds the simulation from `seed`, `config` and `inputs` only, re-runs `ticks`
/// ticks and compares every tick's checksum with the recorded one.
///
/// Returns [`ReplayError::Diverged`] for the first mismatching tick. Structural problems
/// (header, checksum count, input `seq` numbering, config) are distinct errors, checked
/// before any tick runs.
pub fn verify(file: &ReplayFile) -> Result<(), ReplayError> {
    file.check_header()?;
    let found = u64::try_from(file.checksums.len()).unwrap_or(u64::MAX);
    if found != file.ticks {
        return Err(ReplayError::ChecksumCount {
            expected_ticks: file.ticks,
            found,
        });
    }
    let config = WorldConfig::try_from(file.config)?;
    let mut sim = Sim::new(file.seed, config)?;
    for (index, input) in (0u64..).zip(&file.inputs) {
        if input.seq != index {
            return Err(ReplayError::InputSeqMismatch {
                index,
                expected: index,
                found: input.seq,
            });
        }
        let seq = sim.submit(Tick(input.tick), input.payload.into())?;
        debug_assert_eq!(seq.0, index);
    }
    for (n, &expected) in (0u64..).zip(&file.checksums) {
        let actual = sim.step();
        if actual != expected {
            return Err(Divergence {
                tick: Tick(n),
                expected,
                actual,
            }
            .into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::TickInput;
    use crate::values::Intensity;
    use crate::world::{Life, RejectReason, World};

    fn payload() -> InputPayload {
        InputPayload::Act {
            kind: SocialKind::Help,
            actor: PersonId(3),
            target: PersonId(17),
            intensity: 40,
        }
    }

    fn world() -> World {
        World::new(1, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    #[test]
    fn a_config_with_a_workload_field_is_rejected_before_any_world() {
        let text = r#"{"opening_residents":50,"workload":"Pairwise"}"#;
        match ReplayConfig::from_json_str(text) {
            Err(ReplayError::Malformed(message)) => {
                assert!(
                    message.contains("unknown field `workload`"),
                    "message was {message:?}"
                );
            }
            other => panic!("expected Malformed, got {other:?}"),
        }
        // A whole replay file with the same config fails the same way.
        let file = r#"{"format":"back-in-the-family/replay","version":5,"seed":"1","config":{"opening_residents":50,"workload":"Pairwise"},"ticks":"0","inputs":[],"checksums":[]}"#;
        match ReplayFile::from_json_str(file) {
            Err(ReplayError::Malformed(message)) => assert!(
                message.contains("unknown field `workload`"),
                "message was {message:?}"
            ),
            other => panic!("expected Malformed, got {other:?}"),
        }
        // And the `--config` shape is exactly the replay config object.
        assert_eq!(
            ReplayConfig::from_json_str(r#"{"opening_residents":50}"#),
            Ok(ReplayConfig {
                opening_residents: 50
            })
        );
    }

    #[test]
    fn a_version_2_file_is_rejected_as_unsupported() {
        let v2 = r#"{"format":"back-in-the-family/replay","version":2,"seed":"1","config":{"entity_count":5,"workload":"Pairwise"},"ticks":"0","inputs":[],"checksums":[]}"#;
        assert_eq!(
            ReplayFile::from_json_str(v2),
            Err(ReplayError::UnsupportedVersion { found: 2 })
        );
    }

    #[test]
    fn a_version_3_file_is_rejected_as_unsupported() {
        let v3 = r#"{"format":"back-in-the-family/replay","version":3,"seed":"1","config":{"opening_residents":50},"ticks":"0","inputs":[],"checksums":[]}"#;
        assert_eq!(
            ReplayFile::from_json_str(v3),
            Err(ReplayError::UnsupportedVersion { found: 3 })
        );
    }

    #[test]
    fn payload_round_trips_through_the_documented_json() {
        let payload = payload();
        let dto: ReplayPayload = payload.into();
        let json = serde_json::to_string(&dto).unwrap();
        assert_eq!(
            json,
            r#"{"Act":{"kind":"help","actor":"3","target":"17","intensity":40}}"#
        );
        let back: ReplayPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(InputPayload::from(back), payload);
        // Every kind map both ways.
        for (kind, name) in [
            (SocialKind::Help, "help"),
            (SocialKind::Gift, "gift"),
            (SocialKind::Quarrel, "quarrel"),
            (SocialKind::Insult, "insult"),
            (SocialKind::Theft, "theft"),
            (SocialKind::Apology, "apology"),
        ] {
            let dto: ReplayPayload = InputPayload::Act {
                kind,
                actor: PersonId(1),
                target: PersonId(2),
                intensity: 1,
            }
            .into();
            assert!(serde_json::to_string(&dto).unwrap().contains(name));
            assert_eq!(SocialKind::from(ReplaySocialKind::from(kind)), kind);
        }
    }

    #[test]
    fn underworld_payloads_round_trip_through_the_documented_json() {
        let cases = [
            (
                InputPayload::ClaimSlot {
                    slot: SlotRef::Birth(BirthSlotId(3)),
                    customization: None,
                },
                r#"{"ClaimSlot":{"slot":{"Birth":"3"}}}"#,
            ),
            (
                InputPayload::ClaimSlot {
                    slot: SlotRef::ImportedVessel,
                    customization: None,
                },
                r#"{"ClaimSlot":{"slot":"ImportedVessel"}}"#,
            ),
            (
                InputPayload::ClaimSlot {
                    slot: SlotRef::RebuiltBody,
                    customization: None,
                },
                r#"{"ClaimSlot":{"slot":"RebuiltBody"}}"#,
            ),
            (
                InputPayload::ClaimSlot {
                    slot: SlotRef::RebuiltBody,
                    customization: Some(Customization::Set {
                        trait_name: TraitName::Warmth,
                        value: 2,
                    }),
                },
                r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Set":{"trait_name":"warmth","value":2}}}}"#,
            ),
            (
                InputPayload::ClaimSlot {
                    slot: SlotRef::RebuiltBody,
                    customization: Some(Customization::Adjust {
                        first: (TraitName::Greed, -1),
                        second: (TraitName::Piety, 1),
                    }),
                },
                r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Adjust":{"first":{"trait_name":"greed","delta":-1},"second":{"trait_name":"piety","delta":1}}}}}"#,
            ),
            (
                InputPayload::CarryOver {
                    trait_name: TraitName::Piety,
                },
                r#"{"CarryOver":{"trait_name":"piety"}}"#,
            ),
            (
                InputPayload::Dream {
                    dreamer: PersonId(17),
                    intent: DreamIntent::Warn,
                },
                r#"{"Dream":{"dreamer":"17","intent":"warn"}}"#,
            ),
            (
                InputPayload::Haunt {
                    target: PersonId(9),
                },
                r#"{"Haunt":{"target":"9"}}"#,
            ),
            (
                InputPayload::Bribe { amount: 120 },
                r#"{"Bribe":{"amount":"120"}}"#,
            ),
            (
                InputPayload::Choose {
                    node: NodeRef::Trigger {
                        seq: crate::ids::InputSeq(64),
                    },
                    option: NodeOption::HeedWarning,
                },
                r#"{"Choose":{"node":{"Trigger":{"seq":"64"}},"option":"heed_warning"}}"#,
            ),
        ];
        for (payload, json) in cases {
            let dto: ReplayPayload = payload.into();
            assert_eq!(serde_json::to_string(&dto).unwrap(), json);
            let back: ReplayPayload = serde_json::from_str(json).unwrap();
            assert_eq!(InputPayload::from(back), payload);
        }
        for intent in DreamIntent::ALL {
            let payload = InputPayload::Dream {
                dreamer: PersonId(3),
                intent,
            };
            let text = serde_json::to_string(&ReplayPayload::from(payload)).unwrap();
            let back: ReplayPayload = serde_json::from_str(&text).unwrap();
            assert_eq!(InputPayload::from(back), payload);
        }
        for option in NodeOption::ALL {
            let payload = InputPayload::Choose {
                node: NodeRef::Trigger {
                    seq: crate::ids::InputSeq(7),
                },
                option,
            };
            let text = serde_json::to_string(&ReplayPayload::from(payload)).unwrap();
            let back: ReplayPayload = serde_json::from_str(&text).unwrap();
            assert_eq!(InputPayload::from(back), payload);
        }
        for name in TraitName::ALL {
            let payload = InputPayload::CarryOver { trait_name: name };
            let text = serde_json::to_string(&ReplayPayload::from(payload)).unwrap();
            let back: ReplayPayload = serde_json::from_str(&text).unwrap();
            assert_eq!(InputPayload::from(back), payload);
        }
        // An unknown trait name or a malformed slot ID never reaches the World (R4.2,
        // R9.2).
        for text in [
            r#"{"CarryOver":{"trait_name":"wrath"}}"#,
            r#"{"ClaimSlot":{"slot":{"Birth":"three"}}}"#,
            r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Set":{"trait_name":"unknown","value":2}}}}"#,
            r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Set":{"trait_name":"piety","value":256}}}}"#,
            r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Set":{"trait_name":"piety","value":1},"Adjust":{"first":{"trait_name":"greed","delta":1},"second":{"trait_name":"piety","delta":-1}}}}}"#,
            r#"{"ClaimSlot":{"slot":"RebuiltBody","customization":{"Adjust":{"first":{"trait_name":"greed","delta":1}}}}}"#,
        ] {
            assert!(
                serde_json::from_str::<ReplayPayload>(text).is_err(),
                "{text}"
            );
        }
    }

    #[test]
    fn player_choice_round_trips_with_strict_node_id_and_version_5_header() {
        for &option in PlayerOption::ALL {
            let payload = InputPayload::ChoosePlayer {
                node: NodeId(u64::MAX),
                option,
            };
            let json = serde_json::to_string(&ReplayPayload::from(payload)).unwrap();
            assert_eq!(
                json,
                format!(
                    r#"{{"ChoosePlayer":{{"node":"18446744073709551615","option":"{}"}}}}"#,
                    option.label()
                )
            );
            let parsed: ReplayPayload = serde_json::from_str(&json).unwrap();
            assert_eq!(InputPayload::from(parsed), payload);
        }

        for bad in [
            r#"{"ChoosePlayer":{"node":12,"option":"repay_now"}}"#,
            r#"{"ChoosePlayer":{"node":"01","option":"repay_now"}}"#,
            r#"{"ChoosePlayer":{"node":"18446744073709551616","option":"repay_now"}}"#,
            r#"{"ChoosePlayer":{"node":"12","option":"repay_now","extra":true}}"#,
            r#"{"ChoosePlayer":{"node":"12","option":"unknown"}}"#,
        ] {
            assert!(serde_json::from_str::<ReplayPayload>(bad).is_err(), "{bad}");
        }

        let payload = InputPayload::ChoosePlayer {
            node: NodeId(12),
            option: PlayerOption::RepayNow,
        };
        let file = record(1, WorldConfig::default(), &[(Tick(1), payload)], 2).unwrap();
        let json = file.to_json_string().unwrap();
        assert!(
            json.starts_with(r#"{"format":"back-in-the-family/replay","version":5,"seed":"1""#)
        );
        assert!(json.contains(r#""payload":{"ChoosePlayer":{"node":"12","option":"repay_now"}}"#));
        assert_eq!(ReplayFile::from_json_str(&json).unwrap(), file);
        assert_eq!(verify(&file), Ok(()));
    }

    fn reason_for(world: &mut World, payload: InputPayload) -> RejectReason {
        let seq = crate::ids::InputSeq(0);
        let tick = world.tick();
        world.step(&[TickInput { tick, seq, payload }]);
        world
            .rejections()
            .last
            .map(|(_, _, reason)| reason)
            .expect("an input was rejected")
    }

    #[test]
    fn every_reject_reason_is_produced_by_a_matching_input() {
        let other = PersonId(2);
        let mut w = world();
        let resident = *w
            .persons()
            .values()
            .find(|p| matches!(p.life, Life::Alive { .. }))
            .map(|p| &p.id)
            .unwrap();
        assert_eq!(
            reason_for(
                &mut w,
                InputPayload::Act {
                    kind: SocialKind::Help,
                    actor: PersonId(u64::MAX),
                    target: other,
                    intensity: 40,
                }
            ),
            RejectReason::UnknownPerson
        );

        let mut w = world();
        let dead = PersonId(2);
        if let Some(person) = w.persons.get_mut(&dead) {
            person.life = Life::Dead { death: Tick(0) };
        }
        assert_eq!(
            reason_for(
                &mut w,
                InputPayload::Act {
                    kind: SocialKind::Help,
                    actor: resident,
                    target: dead,
                    intensity: 40,
                }
            ),
            RejectReason::DeadPerson
        );

        let mut w = world();
        assert_eq!(
            reason_for(
                &mut w,
                InputPayload::Act {
                    kind: SocialKind::Help,
                    actor: resident,
                    target: resident,
                    intensity: 40,
                }
            ),
            RejectReason::SelfTarget
        );

        let mut w = world();
        assert_eq!(
            reason_for(
                &mut w,
                InputPayload::Act {
                    kind: SocialKind::Help,
                    actor: resident,
                    target: other,
                    intensity: 0,
                }
            ),
            RejectReason::IntensityOutOfRange
        );

        let mut w = world();
        w.log.exhaust_ids();
        assert_eq!(
            reason_for(
                &mut w,
                InputPayload::Act {
                    kind: SocialKind::Help,
                    actor: resident,
                    target: other,
                    intensity: 40,
                }
            ),
            RejectReason::IdExhausted
        );
    }

    #[test]
    fn invalid_intensity_values_stay_out_of_the_event_log() {
        assert_eq!(Intensity::new(0), None);
        assert_eq!(Intensity::new(101), None);
    }
}
