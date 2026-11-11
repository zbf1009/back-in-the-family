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

pub mod births;
pub mod canon;
pub mod checksum;
pub mod context_builder;
pub mod death;
pub mod economy;
pub mod events;
pub mod ids;
pub mod input;
pub mod invariants;
pub mod llm;
pub mod names;
pub mod opening;
pub mod outsiders;
pub mod params;
pub mod replay;
pub mod rng;
pub mod snapshot;
pub mod social;
#[cfg(any(test, feature = "test-support"))]
pub mod testing;
pub mod tick;
pub mod values;
pub mod world;
