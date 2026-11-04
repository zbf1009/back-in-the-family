//! Replay files (design decision D5: JSON, every `u64` as a decimal string).
//!
//! A replay is the seed, the world config, the recorded inputs and the checksum of
//! every tick. [`verify`] rebuilds a [`Sim`] from the seed, config and inputs **only**
//! and compares each tick's checksum with the recorded one; the recorded checksums are
//! never used to build state.
//!
//! # Format (version 2)
//!
//! ```json
//! {
//!   "format": "back-in-the-family/replay",
//!   "version": 2,
//!   "seed": "1234567890123",
//!   "config": { "entity_count": 50, "workload": "Pairwise" },
//!   "ticks": "2000",
//!   "inputs": [ { "tick": "5", "seq": "0",
//!                 "payload": { "SetValue": { "entity": "3", "value": 500 } } } ],
//!   "checksums": [ "9f2c0a7d41e3b856" ]
//! }
//! ```
//!
//! - Every `u64` (`seed`, `ticks`, input `tick` and `seq`, entity ids) is a JSON string
//!   in canonical decimal form: ASCII digits only, no sign, no leading zeros except
//!   `"0"` itself, no overflow. JavaScript numbers cannot hold a `u64` exactly, and one
//!   textual form per value keeps files diffable. A JSON number in its place is an
//!   error.
//! - Small integers (`value`, `entity_count`, `version`) are JSON
//!   numbers. No field is a float; `1.5` anywhere an integer is expected is an error.
//! - Checksums are 16 lowercase hex characters ([`Checksum`]'s `Display`).
//! - Unknown fields are rejected, so a typo or a newer format cannot be silently
//!   ignored.
//!
//! # Layering
//!
//! The serde derives live only on the DTO types in this module ([`ReplayFile`],
//! [`ReplayInput`], [`ReplayPayload`], [`ReplayConfig`], [`ReplayWorkload`]). Core types
//! (`WorldConfig`, `InputPayload`, ...) convert to and from them, so a change to a core
//! type cannot change the on-disk format by accident.
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
use crate::ids::{EntityId, Tick};
use crate::input::{InputPayload, SubmitError};
use crate::tick::{Sim, SimError};
use crate::world::{ConfigError, Workload, WorldConfig};

/// The `format` string of every replay file.
pub const REPLAY_FORMAT: &str = "back-in-the-family/replay";
/// The only replay `version` this code reads and writes.
pub const REPLAY_VERSION: u32 = 2;

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

/// File-format twin of [`Workload`].
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
pub enum ReplayWorkload {
    Light,
    Pairwise,
}

impl From<Workload> for ReplayWorkload {
    fn from(w: Workload) -> Self {
        match w {
            Workload::Light => Self::Light,
            Workload::Pairwise => Self::Pairwise,
        }
    }
}

impl From<ReplayWorkload> for Workload {
    fn from(w: ReplayWorkload) -> Self {
        match w {
            ReplayWorkload::Light => Self::Light,
            ReplayWorkload::Pairwise => Self::Pairwise,
        }
    }
}

/// File-format twin of [`WorldConfig`]. Not validated until converted.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayConfig {
    pub entity_count: u16,
    pub workload: ReplayWorkload,
}

impl ReplayConfig {
    /// Parses a bare config (the `config` object of a replay file). Never panics.
    pub fn from_json_str(s: &str) -> Result<Self, ReplayError> {
        serde_json::from_str(s).map_err(|e| ReplayError::Malformed(e.to_string()))
    }
}

impl From<WorldConfig> for ReplayConfig {
    fn from(c: WorldConfig) -> Self {
        let WorldConfig {
            entity_count,
            workload,
        } = c;
        Self {
            entity_count,
            workload: workload.into(),
        }
    }
}

impl TryFrom<ReplayConfig> for WorldConfig {
    type Error = ConfigError;

    /// Validates the ranges (`WorldConfig::try_new`).
    fn try_from(c: ReplayConfig) -> Result<Self, ConfigError> {
        Self::try_new(c.entity_count, c.workload.into())
    }
}

/// File-format twin of [`InputPayload`].
#[derive(Copy, Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ReplayPayload {
    SetValue {
        #[serde(with = "u64_string")]
        entity: u64,
        value: i32,
    },
    Spawn {
        value: i32,
    },
    Despawn {
        #[serde(with = "u64_string")]
        entity: u64,
    },
}

impl From<InputPayload> for ReplayPayload {
    fn from(p: InputPayload) -> Self {
        match p {
            InputPayload::SetValue { entity, value } => Self::SetValue {
                entity: entity.0,
                value,
            },
            InputPayload::Spawn { value } => Self::Spawn { value },
            InputPayload::Despawn { entity } => Self::Despawn { entity: entity.0 },
        }
    }
}

impl From<ReplayPayload> for InputPayload {
    fn from(p: ReplayPayload) -> Self {
        match p {
            ReplayPayload::SetValue { entity, value } => Self::SetValue {
                entity: EntityId(entity),
                value,
            },
            ReplayPayload::Spawn { value } => Self::Spawn { value },
            ReplayPayload::Despawn { entity } => Self::Despawn {
                entity: EntityId(entity),
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
/// One input as submitted by a live caller (e.g. the browser): a tick and a payload.
/// There is no `seq`: the input stream assigns it. Same strict `u64` string rules as
/// [`ReplayInput`].
///
/// ```json
/// { "tick": "5", "payload": { "SetValue": { "entity": "3", "value": 500 } } }
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
