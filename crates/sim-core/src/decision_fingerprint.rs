//! Historical model provenance carried only by a recorded choice.

use std::{fmt, str::FromStr};

/// An opaque 32-byte digest, written as 64 lowercase hex characters.
///
/// Parsing validates the format, not which provider or model produced the digest.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct DecisionFingerprint([u8; 32]);

impl DecisionFingerprint {
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

/// The text is not a 64-character lowercase hex digest.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct InvalidDecisionFingerprint;

impl fmt::Display for InvalidDecisionFingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("expected a decision fingerprint as 64 lowercase hex characters")
    }
}

impl std::error::Error for InvalidDecisionFingerprint {}

impl FromStr for DecisionFingerprint {
    type Err = InvalidDecisionFingerprint;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        fn nibble(byte: u8) -> Result<u8, InvalidDecisionFingerprint> {
            match byte {
                b'0'..=b'9' => Ok(byte.wrapping_sub(b'0')),
                b'a'..=b'f' => Ok(byte.wrapping_sub(b'a').wrapping_add(10)),
                _ => Err(InvalidDecisionFingerprint),
            }
        }

        let hex: &[u8; 64] = text
            .as_bytes()
            .try_into()
            .map_err(|_| InvalidDecisionFingerprint)?;
        let mut bytes = [0; 32];
        for (byte, &[hi, lo]) in bytes.iter_mut().zip(hex.as_chunks::<2>().0) {
            *byte = (nibble(hi)? << 4) | nibble(lo)?;
        }
        Ok(Self::from_bytes(bytes))
    }
}

impl fmt::Display for DecisionFingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}
