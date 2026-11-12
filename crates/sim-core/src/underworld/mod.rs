//! The underworld: joss paper, offerings, the Magistrate, slots, Decision_Nodes and the
//! Player_Soul's wait (design "Architecture", OP-D1 A).
//!
//! One file per mechanic. This module owns the step functions that `tick.rs` calls, so
//! the tick keeps its written order and every mechanic stays testable on its own.

pub mod joss;
pub mod magistrate;
pub mod slots;
