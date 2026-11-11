//! The Name_List and the probing name picker (design "Name_List and picker", R13).
//!
//! The lists are written for this project by hand (R13.2). Each entry is one ASCII
//! word; no entry is taken from a third-party dataset. A [`FullName`] stores indices
//! into the sex's first-name list and the surname list, so it is 4 bytes and has a
//! fixed canonical encoding. Names never change.

use std::collections::BTreeSet;

use crate::canon::{Canon, CanonWriter};
use crate::rng::below;

/// Female first names, 80 entries.
pub const FEMALE_FIRST: [&str; FEMALE_FIRST_COUNT] = [
    "Ada",
    "Alice",
    "Amelia",
    "Anna",
    "Audrey",
    "Beatrice",
    "Bella",
    "Bernice",
    "Blanche",
    "Bonnie",
    "Bridget",
    "Camille",
    "Carla",
    "Caroline",
    "Cecilia",
    "Clara",
    "Cora",
    "Daisy",
    "Dana",
    "Delia",
    "Dora",
    "Edith",
    "Elena",
    "Elise",
    "Ella",
    "Emily",
    "Emma",
    "Esther",
    "Eva",
    "Faye",
    "Fiona",
    "Flora",
    "Frances",
    "Gail",
    "Gemma",
    "Gloria",
    "Grace",
    "Hazel",
    "Helen",
    "Hilda",
    "Holly",
    "Irene",
    "Iris",
    "Ivy",
    "Jane",
    "Janet",
    "Joan",
    "Josephine",
    "Julia",
    "June",
    "Karen",
    "Kate",
    "Laura",
    "Lena",
    "Lillian",
    "Linda",
    "Lois",
    "Lucy",
    "Mabel",
    "Mae",
    "Margaret",
    "Maria",
    "Marion",
    "Martha",
    "Maude",
    "Mavis",
    "Meredith",
    "Mila",
    "Nadine",
    "Nancy",
    "Nell",
    "Nora",
    "Olive",
    "Opal",
    "Pearl",
    "Rachel",
    "Rosa",
    "Ruth",
    "Sadie",
    "Selma",
];

/// Male first names, 80 entries.
pub const MALE_FIRST: [&str; MALE_FIRST_COUNT] = [
    "Aaron", "Abel", "Adam", "Albert", "Alfred", "Amos", "Andrew", "Arthur", "August", "Ben",
    "Bernard", "Calvin", "Carl", "Cecil", "Charles", "Chester", "Clifford", "Clyde", "Colin",
    "Conrad", "Cyrus", "Daniel", "David", "Dennis", "Donald", "Douglas", "Edgar", "Edmund",
    "Edward", "Edwin", "Elias", "Elliot", "Emil", "Ernest", "Eugene", "Felix", "Floyd", "Francis",
    "Frank", "Fred", "Gabriel", "George", "Gerald", "Gilbert", "Gordon", "Harold", "Harvey",
    "Henry", "Herman", "Howard", "Hugh", "Isaac", "Ivan", "Jacob", "James", "Jasper", "Jerome",
    "Joel", "John", "Jonas", "Julian", "Karl", "Keith", "Kenneth", "Lawrence", "Leo", "Leon",
    "Lewis", "Lloyd", "Louis", "Lucas", "Marcus", "Martin", "Marvin", "Matthew", "Maurice",
    "Miles", "Milton", "Morris", "Nathan",
];

/// Surnames, 60 entries.
pub const SURNAMES: [&str; SURNAME_COUNT] = [
    "Abbott",
    "Adler",
    "Barrett",
    "Becker",
    "Bishop",
    "Boone",
    "Bradley",
    "Brennan",
    "Burke",
    "Callahan",
    "Carlson",
    "Chase",
    "Coleman",
    "Cooper",
    "Dalton",
    "Dawson",
    "Doyle",
    "Ellis",
    "Emerson",
    "Fairbanks",
    "Fleming",
    "Fletcher",
    "Foster",
    "Gardner",
    "Gibson",
    "Graves",
    "Griffin",
    "Hale",
    "Hammond",
    "Harper",
    "Hayes",
    "Holland",
    "Hopkins",
    "Houston",
    "Hughes",
    "Jenkins",
    "Keller",
    "Kendall",
    "Lambert",
    "Lawson",
    "Lowell",
    "Marshall",
    "Mercer",
    "Monroe",
    "Nash",
    "Norris",
    "Palmer",
    "Parker",
    "Patton",
    "Pierce",
    "Quinn",
    "Ramsey",
    "Reed",
    "Rhodes",
    "Rowe",
    "Sawyer",
    "Sheridan",
    "Stanton",
    "Sutton",
    "Townsend",
];

/// Number of female first names.
pub const FEMALE_FIRST_COUNT: usize = 80;
/// Number of male first names.
pub const MALE_FIRST_COUNT: usize = 80;
/// Number of surnames.
pub const SURNAME_COUNT: usize = 60;

/// Indices into the Name_List. Equal values are the same full name (R13.3); the caller
/// resolves `first` with the Person's sex.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub struct FullName {
    /// Index into [`FEMALE_FIRST`] or [`MALE_FIRST`].
    pub first: u16,
    /// Index into [`SURNAMES`].
    pub surname: u16,
}

/// The probing picker (design "Name_List and picker").
///
/// Starts at first-name index `below(draw, 80)` and probes forward (wrapping at 80)
/// until the full name is not in `occupied`. If all 80 first names of the surname are
/// taken, it moves to the next surname (wrapping at 60) and probes again. With at most
/// 61 Residents and 4,800 full names per sex a free one always exists (R13.3).
///
/// `female` selects the first-name list; both lists have 80 entries, so the returned
/// indices are valid either way. The caller renders the name with the Person's sex.
pub fn pick_full_name(
    female: bool,
    surname: u16,
    draw: u64,
    occupied: &BTreeSet<FullName>,
) -> FullName {
    // Both first-name lists have the same length, so the sex decides which list the
    // indices will be read from but not the index the picker returns.
    let first_count = if female {
        FEMALE_FIRST_COUNT
    } else {
        MALE_FIRST_COUNT
    };
    let first_count = u16::try_from(first_count).expect("the first-name count fits in u16");
    let start = u16::try_from(below(draw, u64::from(first_count)))
        .expect("below(.., first_count) is below u16::MAX");
    let surname_count = u16::try_from(SURNAME_COUNT).expect("60 fits in u16");
    let mut surname = surname
        .checked_rem(surname_count)
        .expect("the surname count is non-zero");
    for _ in 0..SURNAME_COUNT {
        for offset in 0..first_count {
            let first = start
                .wrapping_add(offset)
                .checked_rem(first_count)
                .expect("the first-name count is non-zero");
            let candidate = FullName { first, surname };
            if !occupied.contains(&candidate) {
                return candidate;
            }
        }
        surname = surname
            .wrapping_add(1)
            .checked_rem(surname_count)
            .expect("the surname count is non-zero");
    }
    unreachable!("4,800 full names cannot all be occupied by at most 62 Residents");
}

impl Canon for FullName {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { first, surname } = self;
        first.encode(w);
        surname.encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_distinct_ascii_words(words: &[&str], expected_len: usize) {
        assert_eq!(words.len(), expected_len);
        let unique: BTreeSet<&str> = words.iter().copied().collect();
        assert_eq!(unique.len(), words.len(), "duplicate name");
        for word in words {
            assert!(
                !word.is_empty() && word.chars().all(|c| c.is_ascii_alphabetic()),
                "not a single ASCII word: {word:?}"
            );
        }
    }

    #[test]
    fn lists_have_the_designed_sizes_and_no_duplicates() {
        assert_distinct_ascii_words(&FEMALE_FIRST, 80);
        assert_distinct_ascii_words(&MALE_FIRST, 80);
        assert_distinct_ascii_words(&SURNAMES, 60);
    }

    #[test]
    fn picker_starts_at_the_draw_and_probes_forward() {
        let mut occupied = BTreeSet::new();
        // Occupy first-name indices 0..=4 of surname 7, so a draw starting at 0 lands
        // on the first free index, 5, rather than wrapping.
        for first in 0..5u16 {
            occupied.insert(FullName { first, surname: 7 });
        }
        let picked = pick_full_name(false, 7, 0, &occupied);
        assert_eq!(
            picked,
            FullName {
                first: 5,
                surname: 7
            }
        );
    }

    #[test]
    fn picker_wraps_to_the_next_surname_when_all_first_names_are_taken() {
        let mut occupied = BTreeSet::new();
        for first in 0..80u16 {
            occupied.insert(FullName { first, surname: 5 });
        }
        let picked = pick_full_name(true, 5, 0, &occupied);
        assert_eq!(picked.surname, 6);
        assert_eq!(picked.first, 0);
    }

    #[test]
    fn picker_is_sex_independent_for_the_index() {
        let empty = BTreeSet::new();
        assert_eq!(
            pick_full_name(true, 3, 12_345, &empty),
            pick_full_name(false, 3, 12_345, &empty)
        );
    }

    #[test]
    fn full_name_encodes_two_little_endian_u16() {
        use crate::canon::encode_to_vec;
        assert_eq!(
            encode_to_vec(&FullName {
                first: 0x0102,
                surname: 0x0304
            }),
            [0x02, 0x01, 0x04, 0x03]
        );
    }
}
