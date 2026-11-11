//! Range-checked value types shared by the life-sim (design "Data Models").
//!
//! Each type keeps its field private and offers a constructor that either clamps the
//! input or refuses it, so an out-of-range score, trait, intensity or mood cannot be
//! built. The types are also part of the canonical encoding: their inner integer is
//! written as is, and each enum writes an explicit `u8` variant tag (design "Canonical
//! encoding of the World").

use crate::canon::{Canon, CanonWriter};

/// Smallest and largest relation score (`affinity`, `trust`).
pub const SCORE_MIN: i8 = -100;
/// Largest relation score.
pub const SCORE_MAX: i8 = 100;
/// Smallest trait value.
pub const TRAIT_MIN: i8 = -3;
/// Largest trait value.
pub const TRAIT_MAX: i8 = 3;
/// Smallest social intensity.
pub const INTENSITY_MIN: u8 = 1;
/// Largest social intensity.
pub const INTENSITY_MAX: u8 = 100;
/// Smallest mood value.
pub const MOOD_MIN: i8 = -100;
/// Largest mood value.
pub const MOOD_MAX: i8 = 100;

/// A relation score: `affinity` or `trust`, in `-100..=100` (R4.1).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Score(i8);

impl Score {
    /// Clamps `value` into `-100..=100`.
    pub fn clamped(value: i64) -> Self {
        let clamped = value.clamp(i64::from(SCORE_MIN), i64::from(SCORE_MAX));
        Self(i8::try_from(clamped).expect("a clamped score fits in i8"))
    }

    /// The score as an `i8`.
    pub const fn get(self) -> i8 {
        self.0
    }
}

/// One card trait value, in `-3..=3` (R2.2).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Trait(i8);

impl Trait {
    /// Refuses a value outside `-3..=3`.
    pub const fn new(value: i8) -> Option<Self> {
        if value >= TRAIT_MIN && value <= TRAIT_MAX {
            Some(Self(value))
        } else {
            None
        }
    }

    /// Clamps `value` into `-3..=3`.
    pub fn clamped(value: i64) -> Self {
        let clamped = value.clamp(i64::from(TRAIT_MIN), i64::from(TRAIT_MAX));
        Self(i8::try_from(clamped).expect("a clamped trait fits in i8"))
    }

    /// The trait as an `i8`.
    pub const fn get(self) -> i8 {
        self.0
    }
}

/// The intensity of a social Event, in `1..=100` (R5.4).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Intensity(u8);

impl Intensity {
    /// Refuses a value outside `1..=100`.
    pub const fn new(value: u8) -> Option<Self> {
        if value >= INTENSITY_MIN && value <= INTENSITY_MAX {
            Some(Self(value))
        } else {
            None
        }
    }

    /// The intensity as a `u8`.
    pub const fn get(self) -> u8 {
        self.0
    }
}

/// A Resident's long-term mood, in `-100..=100` (R14.1).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Mood(i8);

impl Mood {
    /// Clamps `value` into `-100..=100`.
    pub fn clamped(value: i64) -> Self {
        let clamped = value.clamp(i64::from(MOOD_MIN), i64::from(MOOD_MAX));
        Self(i8::try_from(clamped).expect("a clamped mood fits in i8"))
    }

    /// Returns the mood moved by `delta` and clamped to `-100..=100`.
    ///
    /// The addition saturates first, so any `i64` delta is safe; the clamp then keeps
    /// the documented mood range (R14.2).
    pub fn add_clamped(self, delta: i64) -> Self {
        Self::clamped(i64::from(self.0).saturating_add(delta))
    }

    /// The mood as an `i8`.
    pub const fn get(self) -> i8 {
        self.0
    }
}

/// A Person's sex.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Sex {
    /// Female.
    Female,
    /// Male.
    Male,
}

impl Sex {
    /// The card name (`female` or `male`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Female => "female",
            Self::Male => "male",
        }
    }
}

/// Where a Person's body came from.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Origin {
    /// Born in town.
    Native,
    /// An outsider in an Imported_Vessel.
    Possessed,
    /// An outsider in a Rebuilt_Body.
    Rebuilt,
}

impl Origin {
    /// The card name (`native`, `possessed` or `rebuilt`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Possessed => "possessed",
            Self::Rebuilt => "rebuilt",
        }
    }
}

/// The seven card traits (design "Data Models").
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Traits {
    /// Grasping versus indifferent to money.
    pub greed: Trait,
    /// Stands by kin and promises versus drops them easily.
    pub loyalty: Trait,
    /// Cannot bear to lose face versus does not care.
    pub pride: Trait,
    /// Affectionate versus cold.
    pub warmth: Trait,
    /// Quick to anger versus slow to anger.
    pub temper: Trait,
    /// Holds grudges versus forgives easily.
    pub vindictiveness: Trait,
    /// Reveres ancestors and the underworld versus dismisses them.
    pub piety: Trait,
}

/// One tag of the card relation tag list, in card order.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub enum RelationTag {
    /// `to` is `from`'s parent.
    Parent,
    /// `to` is `from`'s child.
    Child,
    /// `to` is `from`'s sibling.
    Sibling,
    /// `to` is `from`'s spouse.
    Spouse,
    /// `to` is `from`'s former spouse.
    FormerSpouse,
    /// `to` is `from`'s grandparent.
    Grandparent,
    /// `to` is `from`'s grandchild.
    Grandchild,
    /// `to` is `from`'s cousin.
    Cousin,
    /// `to` is `from`'s in-law.
    InLaw,
    /// `to` is `from`'s friend.
    Friend,
    /// `to` is `from`'s rival.
    Rival,
    /// `to` is `from`'s neighbor.
    Neighbor,
    /// `to` is `from`'s employer.
    Employer,
    /// `to` is `from`'s employee.
    Employee,
    /// `to` is `from`'s suitor.
    Suitor,
    /// `to` is `from`'s former suitor.
    FormerSuitor,
}

impl RelationTag {
    /// Every relation tag, in card order.
    pub const ALL: [Self; 16] = [
        Self::Parent,
        Self::Child,
        Self::Sibling,
        Self::Spouse,
        Self::FormerSpouse,
        Self::Grandparent,
        Self::Grandchild,
        Self::Cousin,
        Self::InLaw,
        Self::Friend,
        Self::Rival,
        Self::Neighbor,
        Self::Employer,
        Self::Employee,
        Self::Suitor,
        Self::FormerSuitor,
    ];

    /// The card name of the tag.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Parent => "parent",
            Self::Child => "child",
            Self::Sibling => "sibling",
            Self::Spouse => "spouse",
            Self::FormerSpouse => "former_spouse",
            Self::Grandparent => "grandparent",
            Self::Grandchild => "grandchild",
            Self::Cousin => "cousin",
            Self::InLaw => "in_law",
            Self::Friend => "friend",
            Self::Rival => "rival",
            Self::Neighbor => "neighbor",
            Self::Employer => "employer",
            Self::Employee => "employee",
            Self::Suitor => "suitor",
            Self::FormerSuitor => "former_suitor",
        }
    }

    /// Looks a tag up by its card name.
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tag| tag.name() == name)
    }

    /// Whether the tag is a Kinship_Tag (R4.3).
    pub const fn is_kinship(self) -> bool {
        matches!(
            self,
            Self::Parent
                | Self::Child
                | Self::Sibling
                | Self::Spouse
                | Self::FormerSpouse
                | Self::Grandparent
                | Self::Grandchild
                | Self::Cousin
                | Self::InLaw
        )
    }

    /// The tag's bit in a [`RelTags`] bitset.
    pub const fn bit(self) -> u16 {
        match self {
            Self::Parent => 1,
            Self::Child => 2,
            Self::Sibling => 4,
            Self::Spouse => 8,
            Self::FormerSpouse => 16,
            Self::Grandparent => 32,
            Self::Grandchild => 64,
            Self::Cousin => 128,
            Self::InLaw => 256,
            Self::Friend => 512,
            Self::Rival => 1024,
            Self::Neighbor => 2048,
            Self::Employer => 4096,
            Self::Employee => 8192,
            Self::Suitor => 16_384,
            Self::FormerSuitor => 32_768,
        }
    }

    /// Writes the explicit enum tag used by the canonical encoding.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::Parent => 0,
            Self::Child => 1,
            Self::Sibling => 2,
            Self::Spouse => 3,
            Self::FormerSpouse => 4,
            Self::Grandparent => 5,
            Self::Grandchild => 6,
            Self::Cousin => 7,
            Self::InLaw => 8,
            Self::Friend => 9,
            Self::Rival => 10,
            Self::Neighbor => 11,
            Self::Employer => 12,
            Self::Employee => 13,
            Self::Suitor => 14,
            Self::FormerSuitor => 15,
        }
    }
}

/// Bitset over the card relation tags; bit order is the card tag order.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub struct RelTags(u16);

impl RelTags {
    /// No tags.
    pub const fn empty() -> Self {
        Self(0)
    }

    /// The raw bitset. Unknown bits are preserved so a later spec can add tags.
    pub const fn from_bits(bits: u16) -> Self {
        Self(bits)
    }

    /// The raw bitset.
    pub const fn bits(self) -> u16 {
        self.0
    }

    /// Whether `tag` is set.
    pub const fn contains(self, tag: RelationTag) -> bool {
        self.0 & tag.bit() != 0
    }

    /// Sets `tag`.
    pub fn insert(&mut self, tag: RelationTag) {
        self.0 |= tag.bit();
    }

    /// Clears `tag`.
    pub fn remove(&mut self, tag: RelationTag) {
        self.0 &= !tag.bit();
    }

    /// Whether any Kinship_Tag is set.
    pub const fn has_kinship(self) -> bool {
        // The first nine card tags are the Kinship_Tags.
        self.0 & 0x01FF != 0
    }

    /// The set tags in card order.
    pub fn iter(self) -> impl Iterator<Item = RelationTag> {
        RelationTag::ALL
            .into_iter()
            .filter(move |tag| self.contains(*tag))
    }

    /// The card names of the set tags, in card order.
    pub fn names(self) -> impl Iterator<Item = &'static str> {
        self.iter().map(RelationTag::name)
    }
}

/// The kind of a social Event (design "Inputs and replay format").
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SocialKind {
    /// Help.
    Help,
    /// Give a gift.
    Gift,
    /// Quarrel.
    Quarrel,
    /// Insult.
    Insult,
    /// Theft.
    Theft,
    /// Apologize.
    Apology,
}

impl SocialKind {
    /// The card event type (`help`, `gift`, ...).
    pub const fn name(self) -> &'static str {
        match self {
            Self::Help => "help",
            Self::Gift => "gift",
            Self::Quarrel => "quarrel",
            Self::Insult => "insult",
            Self::Theft => "theft",
            Self::Apology => "apology",
        }
    }

    /// Writes the explicit enum tag used by the canonical encoding.
    const fn canon_tag(self) -> u8 {
        match self {
            Self::Help => 0,
            Self::Gift => 1,
            Self::Quarrel => 2,
            Self::Insult => 3,
            Self::Theft => 4,
            Self::Apology => 5,
        }
    }
}

impl Canon for Score {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.0.encode(w);
    }
}

impl Canon for Trait {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.0.encode(w);
    }
}

impl Canon for Intensity {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.0.encode(w);
    }
}

impl Canon for Mood {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.0.encode(w);
    }
}

impl Canon for Sex {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Female => 0,
            Self::Male => 1,
        };
        tag.encode(w);
    }
}

impl Canon for Origin {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let tag: u8 = match self {
            Self::Native => 0,
            Self::Possessed => 1,
            Self::Rebuilt => 2,
        };
        tag.encode(w);
    }
}

impl Canon for Traits {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            greed,
            loyalty,
            pride,
            warmth,
            temper,
            vindictiveness,
            piety,
        } = self;
        greed.encode(w);
        loyalty.encode(w);
        pride.encode(w);
        warmth.encode(w);
        temper.encode(w);
        vindictiveness.encode(w);
        piety.encode(w);
    }
}

impl Canon for RelationTag {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
    }
}

impl Canon for RelTags {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.0.encode(w);
    }
}

impl Canon for SocialKind {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.canon_tag().encode(w);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::canon::encode_to_vec;

    fn first_byte<T: Canon>(value: &T) -> u8 {
        encode_to_vec(value)[0]
    }

    fn assert_distinct_tags<T: Canon>(values: &[T]) {
        let tags: BTreeSet<u8> = values.iter().map(first_byte).collect();
        assert_eq!(tags.len(), values.len(), "canonical tags must be distinct");
    }

    #[test]
    fn scores_clamp_to_bounds() {
        assert_eq!(Score::clamped(-1_000).get(), -100);
        assert_eq!(Score::clamped(-100).get(), -100);
        assert_eq!(Score::clamped(0).get(), 0);
        assert_eq!(Score::clamped(100).get(), 100);
        assert_eq!(Score::clamped(1_000).get(), 100);
    }

    #[test]
    fn traits_clamp_or_refuse_out_of_range_values() {
        assert_eq!(Trait::clamped(-100).get(), -3);
        assert_eq!(Trait::clamped(100).get(), 3);
        assert_eq!(Trait::new(-4), None);
        assert_eq!(Trait::new(4), None);
        assert_eq!(Trait::new(-3).map(Trait::get), Some(-3));
        assert_eq!(Trait::new(3).map(Trait::get), Some(3));
    }

    #[test]
    fn intensities_refuse_out_of_range_values() {
        assert_eq!(Intensity::new(0), None);
        assert_eq!(Intensity::new(101), None);
        assert_eq!(Intensity::new(255), None);
        assert_eq!(Intensity::new(1).map(Intensity::get), Some(1));
        assert_eq!(Intensity::new(100).map(Intensity::get), Some(100));
    }

    #[test]
    fn moods_clamp_on_construction_and_addition() {
        assert_eq!(Mood::clamped(-1_000).get(), -100);
        assert_eq!(Mood::clamped(1_000).get(), 100);
        assert_eq!(Mood::clamped(95).add_clamped(10).get(), 100);
        assert_eq!(Mood::clamped(-95).add_clamped(-10).get(), -100);
        assert_eq!(Mood::clamped(0).add_clamped(i64::MAX).get(), 100);
        assert_eq!(Mood::clamped(0).add_clamped(i64::MIN).get(), -100);
        assert_eq!(Mood::clamped(7).add_clamped(-3).get(), 4);
    }

    #[test]
    fn relation_tag_names_round_trip_in_card_order() {
        let expected = [
            "parent",
            "child",
            "sibling",
            "spouse",
            "former_spouse",
            "grandparent",
            "grandchild",
            "cousin",
            "in_law",
            "friend",
            "rival",
            "neighbor",
            "employer",
            "employee",
            "suitor",
            "former_suitor",
        ];
        let names: Vec<&str> = RelationTag::ALL.iter().map(|tag| tag.name()).collect();
        assert_eq!(names, expected);
        for tag in RelationTag::ALL {
            assert_eq!(RelationTag::from_name(tag.name()), Some(tag));
        }
        assert_eq!(RelationTag::from_name("best_friend"), None);
    }

    #[test]
    fn relation_tags_set_and_clear_their_own_bit() {
        let bits: BTreeSet<u16> = RelationTag::ALL.iter().map(|tag| tag.bit()).collect();
        assert_eq!(bits.len(), RelationTag::ALL.len());

        let mut tags = RelTags::empty();
        assert_eq!(tags.names().count(), 0);
        tags.insert(RelationTag::Spouse);
        tags.insert(RelationTag::Friend);
        assert!(tags.contains(RelationTag::Spouse));
        assert!(tags.contains(RelationTag::Friend));
        assert!(!tags.contains(RelationTag::Rival));
        assert_eq!(tags.names().collect::<Vec<_>>(), vec!["spouse", "friend"]);

        tags.remove(RelationTag::Spouse);
        assert!(!tags.contains(RelationTag::Spouse));
        assert_eq!(tags.bits(), RelationTag::Friend.bit());
        assert_eq!(RelTags::from_bits(tags.bits()), tags);
    }

    #[test]
    fn kinship_tags_are_the_first_nine_card_tags() {
        for tag in RelationTag::ALL {
            let mut tags = RelTags::empty();
            tags.insert(tag);
            assert_eq!(tags.has_kinship(), tag.is_kinship(), "{}", tag.name());
        }
        assert!(!RelTags::empty().has_kinship());
    }

    #[test]
    fn canonical_tags_are_distinct() {
        assert_distinct_tags(&[Sex::Female, Sex::Male]);
        assert_distinct_tags(&[Origin::Native, Origin::Possessed, Origin::Rebuilt]);
        assert_distinct_tags(&[
            SocialKind::Help,
            SocialKind::Gift,
            SocialKind::Quarrel,
            SocialKind::Insult,
            SocialKind::Theft,
            SocialKind::Apology,
        ]);
        assert_distinct_tags(&RelationTag::ALL);
    }

    #[test]
    fn enum_canonical_tags_match_declaration_order() {
        assert_eq!(encode_to_vec(&Sex::Female), [0]);
        assert_eq!(encode_to_vec(&Sex::Male), [1]);
        assert_eq!(encode_to_vec(&Origin::Native), [0]);
        assert_eq!(encode_to_vec(&Origin::Possessed), [1]);
        assert_eq!(encode_to_vec(&Origin::Rebuilt), [2]);
        assert_eq!(encode_to_vec(&SocialKind::Help), [0]);
        assert_eq!(encode_to_vec(&SocialKind::Apology), [5]);
        assert_eq!(encode_to_vec(&RelationTag::Parent), [0]);
        assert_eq!(encode_to_vec(&RelationTag::FormerSuitor), [15]);
    }

    #[test]
    fn traits_encode_all_seven_values_in_card_order() {
        let traits = Traits {
            greed: Trait::new(1).unwrap(),
            loyalty: Trait::new(2).unwrap(),
            pride: Trait::new(3).unwrap(),
            warmth: Trait::new(-1).unwrap(),
            temper: Trait::new(-2).unwrap(),
            vindictiveness: Trait::new(-3).unwrap(),
            piety: Trait::new(0).unwrap(),
        };
        assert_eq!(encode_to_vec(&traits), [1, 2, 3, 0xFF, 0xFE, 0xFD, 0]);
    }
}
