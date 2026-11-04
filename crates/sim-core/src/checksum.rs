//! Per-tick checksum (design decision D3).
//!
//! `Checksum` is the first 8 bytes, read little-endian, of the BLAKE3 hash of a value's
//! canonical encoding (see [`crate::canon`]). It is displayed and stored as 16
//! lowercase hex characters. It detects accidental divergence; it is not a security
//! measure.

use std::fmt;
use std::str::FromStr;

use crate::canon::{Canon, encode_to_vec};

/// A 64-bit state checksum.
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
pub struct Checksum(pub u64);

/// Why a string is not a valid checksum.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ParseChecksumError {
    /// The string is not exactly 16 bytes long.
    WrongLength { actual: usize },
    /// The string contains something other than `0-9` and `a-f` (uppercase is rejected
    /// so that every checksum has exactly one textual form).
    InvalidChar,
}

impl fmt::Display for ParseChecksumError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WrongLength { actual } => {
                write!(f, "checksum must be 16 hex characters, got {actual} bytes")
            }
            Self::InvalidChar => f.write_str("checksum must use only 0-9 and a-f"),
        }
    }
}

impl std::error::Error for ParseChecksumError {}

impl Checksum {
    /// Checksum of raw bytes: BLAKE3, first 8 bytes of the digest, little-endian.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let digest = blake3::hash(bytes);
        let [a, b, c, d, e, f, g, h, ..] = *digest.as_bytes();
        Self(u64::from_le_bytes([a, b, c, d, e, f, g, h]))
    }

    /// Checksum of the canonical encoding of `value`.
    pub fn of<T: Canon>(value: &T) -> Self {
        Self::from_bytes(&encode_to_vec(value))
    }

    /// The 16-character lowercase hex form.
    pub fn to_hex_string(self) -> String {
        self.to_string()
    }

    /// Parses the form produced by [`Checksum::to_hex_string`]. Never panics.
    pub fn from_hex(s: &str) -> Result<Self, ParseChecksumError> {
        if s.len() != 16 {
            return Err(ParseChecksumError::WrongLength { actual: s.len() });
        }
        if !s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(ParseChecksumError::InvalidChar);
        }
        // Validated above, so this cannot fail (and rejects `+`/`-` prefixes itself).
        u64::from_str_radix(s, 16)
            .map(Self)
            .map_err(|_| ParseChecksumError::InvalidChar)
    }
}

impl fmt::Display for Checksum {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:016x}", self.0)
    }
}

impl FromStr for Checksum {
    type Err = ParseChecksumError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_hex(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The published BLAKE3 digest of empty input (BLAKE3 reference
    /// implementation / `b3sum < /dev/null`).
    const BLAKE3_EMPTY: &str = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";

    #[test]
    fn blake3_matches_published_empty_input_digest() {
        assert_eq!(blake3::hash(b"").to_hex().as_str(), BLAKE3_EMPTY);
    }

    #[test]
    fn checksum_is_first_eight_digest_bytes_little_endian() {
        // First 8 bytes of the empty digest: af 13 49 b9 f5 f9 a1 a6.
        let expected = u64::from_le_bytes([0xaf, 0x13, 0x49, 0xb9, 0xf5, 0xf9, 0xa1, 0xa6]);
        assert_eq!(Checksum::from_bytes(b""), Checksum(expected));
        assert_eq!(
            Checksum::from_bytes(b"").to_hex_string(),
            "a6a1f9f5b94913af"
        );
    }

    #[test]
    fn of_hashes_the_canonical_encoding() {
        assert_eq!(
            Checksum::of(&0x0102_0304u32),
            Checksum::from_bytes(&[4, 3, 2, 1])
        );
    }

    #[test]
    fn hex_round_trips_with_leading_zeros() {
        for v in [0u64, 1, 0x00ab_cdef, u64::MAX, 0x0123_4567_89ab_cdef] {
            let c = Checksum(v);
            let s = c.to_hex_string();
            assert_eq!(s.len(), 16);
            assert_eq!(Checksum::from_hex(&s), Ok(c));
            assert_eq!(s.parse::<Checksum>(), Ok(c));
        }
        assert_eq!(Checksum(1).to_hex_string(), "0000000000000001");
    }

    #[test]
    fn malformed_hex_is_rejected() {
        assert_eq!(
            Checksum::from_hex(""),
            Err(ParseChecksumError::WrongLength { actual: 0 })
        );
        assert_eq!(
            Checksum::from_hex("0123456789abcde"),
            Err(ParseChecksumError::WrongLength { actual: 15 })
        );
        assert_eq!(
            Checksum::from_hex("0123456789abcdef0"),
            Err(ParseChecksumError::WrongLength { actual: 17 })
        );
        assert_eq!(
            Checksum::from_hex("0123456789abcdeg"),
            Err(ParseChecksumError::InvalidChar)
        );
        assert_eq!(
            Checksum::from_hex("0123456789ABCDEF"),
            Err(ParseChecksumError::InvalidChar)
        );
        assert_eq!(
            Checksum::from_hex("+123456789abcdef"),
            Err(ParseChecksumError::InvalidChar)
        );
        // Multi-byte characters must not panic.
        assert!(Checksum::from_hex("0123456789abcdé").is_err());
    }

    #[test]
    fn different_inputs_give_different_checksums() {
        let a = Checksum::from_bytes(&[1, 2, 3, 4]);
        let b = Checksum::from_bytes(&[1, 2, 3, 5]);
        assert_ne!(a, b);
        assert_ne!(Checksum::of(&0u64), Checksum::of(&1u64));
    }
}
