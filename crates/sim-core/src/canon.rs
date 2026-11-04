//! Canonical byte encoding of simulation state (design decision D4).
//!
//! The checksum hashes this encoding, so the layout is part of the project's
//! determinism contract and must be identical on native and `wasm32`:
//!
//! - Integers are fixed width, little-endian. `usize` is never encoded (it is 4 bytes
//!   on wasm32 and 8 natively); lengths are written as `u32`.
//! - `bool` is one byte, 0 or 1.
//! - `Option<T>` is a tag byte (0 = `None`, 1 = `Some`) followed by the value.
//! - `Vec<T>` and `BTreeMap<K, V>` are a `u32` length followed by the elements in
//!   iteration order (key order for maps).
//! - Enums (in later tasks) write an explicit `u8` tag per variant in code, then fields.
//! - Every `encode` of a struct destructures `Self` exhaustively, so a field added
//!   without being encoded fails to compile.
//!
//! The encoding of the whole world starts with [`CANON_VERSION`] as a `u16`. The
//! `Canon` impl for `World` (a later task) must write it first, before any field.

use std::collections::BTreeMap;

use crate::ids::{EntityId, IdCounter, InputSeq, Tick};

/// Version of the canonical layout. Bump it whenever any encoding rule or any encoded
/// field changes, so old and new checksums can never be confused for each other.
pub const CANON_VERSION: u16 = 1;

/// Sink for canonical bytes.
pub trait CanonWriter {
    /// Appends `b` to the stream.
    fn bytes(&mut self, b: &[u8]);
}

/// A value with a canonical byte encoding.
pub trait Canon {
    /// Writes the canonical encoding of `self` to `w`.
    fn encode<W: CanonWriter>(&self, w: &mut W);
}

/// A [`CanonWriter`] that collects bytes into a `Vec<u8>`.
#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct CanonBytes(Vec<u8>);

impl CanonBytes {
    /// An empty buffer.
    pub const fn new() -> Self {
        Self(Vec::new())
    }

    /// The bytes written so far.
    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }

    /// Consumes the buffer and returns the bytes.
    pub fn into_vec(self) -> Vec<u8> {
        self.0
    }
}

impl CanonWriter for CanonBytes {
    fn bytes(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
    }
}

/// Encodes `value` into a fresh byte vector.
pub fn encode_to_vec<T: Canon>(value: &T) -> Vec<u8> {
    let mut w = CanonBytes::new();
    value.encode(&mut w);
    w.into_vec()
}

/// Writes a collection length as `u32`.
///
/// Panics if `len` does not fit in a `u32`. That is a programmer error, not a data
/// error: no collection in this project can realistically hold 2^32 elements, and the
/// canonical format has no way to represent one. Propagating a `Result` through every
/// `encode` would only add noise to a path that cannot fail with valid state. (This is
/// the one place sim-core may panic; design.md "Error handling" is about *external*
/// data, which never reaches here as an unbounded length.)
fn write_len<W: CanonWriter>(w: &mut W, len: usize) {
    let len = u32::try_from(len).expect("length exceeds u32 — canonical format limit");
    len.encode(w);
}

macro_rules! impl_canon_int {
    ($($t:ty),* $(,)?) => {$(
        impl Canon for $t {
            fn encode<W: CanonWriter>(&self, w: &mut W) {
                w.bytes(&self.to_le_bytes());
            }
        }
    )*};
}

impl_canon_int!(u8, u16, u32, u64, i8, i16, i32, i64);

impl Canon for bool {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        w.bytes(&[u8::from(*self)]);
    }
}

impl<T: Canon> Canon for Option<T> {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        match self {
            None => w.bytes(&[0]),
            Some(v) => {
                w.bytes(&[1]);
                v.encode(w);
            }
        }
    }
}

impl<T: Canon> Canon for Vec<T> {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        write_len(w, self.len());
        for item in self {
            item.encode(w);
        }
    }
}

impl<K: Canon, V: Canon> Canon for BTreeMap<K, V> {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        write_len(w, self.len());
        for (k, v) in self {
            k.encode(w);
            v.encode(w);
        }
    }
}

impl Canon for Tick {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self(v) = self;
        v.encode(w);
    }
}

impl Canon for EntityId {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self(v) = self;
        v.encode(w);
    }
}

impl Canon for InputSeq {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self(v) = self;
        v.encode(w);
    }
}

impl Canon for IdCounter {
    /// Encodes the value the counter would issue next ([`IdCounter::peek`]).
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        self.peek().encode(w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_are_fixed_width_little_endian() {
        assert_eq!(encode_to_vec(&0x0102_0304u32), [0x04, 0x03, 0x02, 0x01]);
        assert_eq!(encode_to_vec(&0xABu8), [0xAB]);
        assert_eq!(encode_to_vec(&0x0102u16), [0x02, 0x01]);
        assert_eq!(
            encode_to_vec(&0x0102_0304_0506_0708u64),
            [8, 7, 6, 5, 4, 3, 2, 1]
        );
        assert_eq!(encode_to_vec(&-2i16), [0xFE, 0xFF]);
        assert_eq!(encode_to_vec(&-1i8), [0xFF]);
        assert_eq!(encode_to_vec(&i32::MIN), [0, 0, 0, 0x80]);
        assert_eq!(encode_to_vec(&-1i64), [0xFF; 8]);
    }

    #[test]
    fn bool_is_one_byte() {
        assert_eq!(encode_to_vec(&true), [1]);
        assert_eq!(encode_to_vec(&false), [0]);
    }

    #[test]
    fn option_has_a_tag_byte() {
        assert_eq!(encode_to_vec(&None::<u32>), [0]);
        assert_eq!(encode_to_vec(&Some(7u32)), [1, 7, 0, 0, 0]);
    }

    #[test]
    fn vec_has_u32_length_prefix() {
        assert_eq!(encode_to_vec(&Vec::<u16>::new()), [0, 0, 0, 0]);
        assert_eq!(
            encode_to_vec(&vec![1u16, 0x0203]),
            [2, 0, 0, 0, 1, 0, 0x03, 0x02]
        );
    }

    #[test]
    fn btreemap_is_written_in_key_order() {
        let mut m = BTreeMap::new();
        m.insert(9u8, 0x0102u16);
        m.insert(3u8, 5u16);
        assert_eq!(encode_to_vec(&m), [2, 0, 0, 0, 3, 5, 0, 9, 0x02, 0x01]);
    }

    #[test]
    fn nested_values_compose() {
        let v = vec![Some(1u8), None];
        assert_eq!(encode_to_vec(&v), [2, 0, 0, 0, 1, 1, 0]);
    }

    #[test]
    fn id_newtypes_encode_as_their_u64() {
        assert_eq!(encode_to_vec(&Tick(258)), [2, 1, 0, 0, 0, 0, 0, 0]);
        assert_eq!(encode_to_vec(&EntityId(1)), [1, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(encode_to_vec(&InputSeq(0)), [0; 8]);
    }

    #[test]
    fn canon_version_is_encoded_as_u16() {
        assert_eq!(encode_to_vec(&CANON_VERSION), [1, 0]);
    }
}
