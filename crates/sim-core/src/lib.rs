//! Deterministic simulation core.
//!
//! No dependency on rendering, networking, threads, clocks or the browser.

#![forbid(unsafe_code)]
// Determinism guards (R8). Banned types and methods live in `clippy.toml`;
// `tests/source_guard.rs` is the text-scan backstop for code hidden by `#[allow]`.
#![deny(
    clippy::float_arithmetic,
    clippy::arithmetic_side_effects,
    clippy::cast_possible_truncation
)]

pub mod canon;
pub mod checksum;
pub mod ids;
pub mod rng;
