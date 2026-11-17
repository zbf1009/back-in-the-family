//! Append-only, hash-chained record of resolved Narrator candidates.

use crate::canon::{Canon, CanonWriter};
use crate::ids::{EventId, NodeId, Tick};
use crate::narrator::{PlayerFamily, PlayerOption, Stakes};

macro_rules! closed_enum {
    ($name:ident { $($variant:ident => ($tag:literal, $label:literal)),+ $(,)? }) => {
        #[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
            pub const fn label(self) -> &'static str {
                match self { $(Self::$variant => $label),+ }
            }
        }
        impl Canon for $name {
            fn encode<W: CanonWriter>(&self, w: &mut W) {
                let tag: u8 = match self { $(Self::$variant => $tag),+ };
                tag.encode(w);
            }
        }
    };
}
closed_enum!(EntrySource {
    External => (0, "external"), RulesDefault => (1, "rules_default"),
    AutoResolved => (2, "auto_resolved"),
});
closed_enum!(SkipReason {
    MissingPerson => (0, "missing_person"), MissingHousehold => (1, "missing_household"),
    MissingDebt => (2, "missing_debt"), DeadPerson => (3, "dead_person"),
    DebtNotOpen => (4, "debt_not_open"), WrongDebtor => (5, "wrong_debtor"),
    InsufficientMoney => (6, "insufficient_money"), AlreadyApplied => (7, "already_applied"),
    OutOfBounds => (8, "out_of_bounds"),
});

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct ChronicleEntry {
    pub tick: Tick,
    pub family: PlayerFamily,
    pub node: Option<NodeId>,
    pub stakes: Stakes,
    pub applied: PlayerOption,
    pub source: EntrySource,
    pub chooser_absent: bool,
    pub skipped: Vec<(u8, SkipReason)>,
    pub appended: Vec<EventId>,
}
impl Canon for ChronicleEntry {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            tick,
            family,
            node,
            stakes,
            applied,
            source,
            chooser_absent,
            skipped,
            appended,
        } = self;
        tick.encode(w);
        family.encode(w);
        node.encode(w);
        stakes.encode(w);
        applied.encode(w);
        source.encode(w);
        chooser_absent.encode(w);
        skipped.encode(w);
        appended.encode(w);
    }
}

#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct Chronicle {
    entries: Vec<ChronicleEntry>,
    digest: [u8; 32],
}
impl Chronicle {
    pub fn entries(&self) -> &[ChronicleEntry] {
        &self.entries
    }
    pub fn digest(&self) -> [u8; 32] {
        self.digest
    }
    pub fn push(&mut self, entry: ChronicleEntry) {
        self.digest = fold_digest(&self.digest, &entry);
        self.entries.push(entry);
    }
    pub fn recompute_digest(&self) -> [u8; 32] {
        self.entries
            .iter()
            .fold([0; 32], |digest, entry| fold_digest(&digest, entry))
    }
}

struct DigestWriter<'a>(&'a mut blake3::Hasher);
impl CanonWriter for DigestWriter<'_> {
    fn bytes(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }
}
fn fold_digest(previous: &[u8; 32], entry: &ChronicleEntry) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(previous);
    entry.encode(&mut DigestWriter(&mut hasher));
    *hasher.finalize().as_bytes()
}
impl Canon for Chronicle {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { entries, digest } = self;
        u32::try_from(entries.len())
            .expect("chronicle length exceeds u32")
            .encode(w);
        w.bytes(digest);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canon::encode_to_vec;
    use crate::ids::PersonId;
    use crate::narrator::StakeUnit;

    fn entry() -> ChronicleEntry {
        ChronicleEntry {
            tick: Tick(9),
            family: PlayerFamily::DebtDue,
            node: Some(NodeId(7)),
            stakes: Stakes {
                who: vec![PersonId(2)],
                amount: 20,
                unit: StakeUnit::Money,
                by: Tick(10),
            },
            applied: PlayerOption::RepayNow,
            source: EntrySource::External,
            chooser_absent: false,
            skipped: vec![(1, SkipReason::MissingDebt)],
            appended: vec![EventId(4)],
        }
    }

    #[test]
    fn closed_tags_and_labels_match_contract() {
        for (position, option) in PlayerOption::ALL.iter().enumerate() {
            assert_eq!(encode_to_vec(option), [u8::try_from(position).unwrap()]);
        }
        for (position, reason) in SkipReason::ALL.iter().enumerate() {
            assert_eq!(encode_to_vec(reason), [u8::try_from(position).unwrap()]);
        }
        assert_eq!(SkipReason::MissingDebt.label(), "missing_debt");
        assert_eq!(EntrySource::AutoResolved.label(), "auto_resolved");
    }

    #[test]
    fn chronicle_hash_chain_and_canonical_length_digest() {
        let first = entry();
        let mut chronicle = Chronicle::default();
        assert_eq!(encode_to_vec(&chronicle), [0; 36]);
        chronicle.push(first.clone());
        let mut hasher = blake3::Hasher::new();
        hasher.update(&[0; 32]);
        hasher.update(&encode_to_vec(&first));
        assert_eq!(chronicle.digest(), *hasher.finalize().as_bytes());
        chronicle.push(first);
        assert_eq!(chronicle.digest(), chronicle.recompute_digest());
        let encoded = encode_to_vec(&chronicle);
        assert_eq!(&encoded[..4], &2u32.to_le_bytes());
        assert_eq!(&encoded[4..], &chronicle.digest());
    }
}
