//! wasm-bindgen bindings for `sim-core`.
//!
//! This crate is deliberately thin: every rule lives in `sim-core`; here we only turn
//! strings, JSON and errors into what JavaScript sees. Each exported function has a
//! plain-Rust twin returning `Result<_, String>` (`WasmSim::create`, `submit_json`,
//! [`verify_replay_str`]) so the same logic is testable on native and wasm32, where
//! `JsError` cannot be inspected or even built on native.
//!
//! JSON formats:
//! - `config_json`: the `ReplayConfig` shape, e.g.
//!   `{"entity_count":50,"days_per_tick":1,"workload":"Pairwise"}`.
//! - `input_json`: `{"tick":"5","payload":{"SetValue":{"entity":"3","value":500}}}`;
//!   `u64` values are strict decimal strings, and there is no `seq` (the stream assigns it).
//! - Checksums are returned as 16 lowercase hex characters.
//!
//! `u64` arguments and results (`seed`, `tick()`) are JavaScript `BigInt`s.
#![forbid(unsafe_code)]

use sim_core::ids::Tick;
use sim_core::replay::{ReplayConfig, ReplayFile, SubmitInput, verify};
use sim_core::tick::Sim;
use sim_core::world::WorldConfig;
use wasm_bindgen::prelude::*;

/// A running simulation owned by JavaScript.
#[wasm_bindgen]
pub struct WasmSim {
    inner: Sim,
}

impl WasmSim {
    /// Plain-Rust constructor behind [`WasmSim::new`].
    pub fn create(seed: u64, config_json: &str) -> Result<WasmSim, String> {
        let config: ReplayConfig =
            ReplayConfig::from_json_str(config_json).map_err(|e| e.to_string())?;
        let config = WorldConfig::try_from(config).map_err(|e| e.to_string())?;
        let inner = Sim::new(seed, config).map_err(|e| e.to_string())?;
        Ok(WasmSim { inner })
    }

    /// Plain-Rust body of [`WasmSim::submit`].
    pub fn submit_json(&mut self, input_json: &str) -> Result<(), String> {
        let input = SubmitInput::from_json_str(input_json).map_err(|e| e.to_string())?;
        self.inner
            .submit(Tick(input.tick), input.payload.into())
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Plain-Rust body of [`WasmSim::step`].
    pub fn step_hex(&mut self) -> String {
        self.inner.step().to_hex_string()
    }

    /// Plain-Rust body of [`WasmSim::run_ticks`].
    pub fn run_ticks_hex(&mut self, n: u32) -> String {
        for _ in 0..n {
            self.inner.step();
        }
        self.inner
            .checksums()
            .last()
            .map_or_else(String::new, |c| c.to_hex_string())
    }
}

#[wasm_bindgen]
impl WasmSim {
    /// Creates a world from `seed` and a `ReplayConfig` JSON string.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64, config_json: &str) -> Result<WasmSim, JsError> {
        Self::create(seed, config_json).map_err(|e| JsError::new(&e))
    }

    /// Submits one input (see the module docs for the JSON shape). Errors: malformed JSON,
    /// or a tick earlier than the current tick.
    pub fn submit(&mut self, input_json: &str) -> Result<(), JsError> {
        self.submit_json(input_json).map_err(|e| JsError::new(&e))
    }

    /// Runs one tick and returns its checksum as 16 lowercase hex characters.
    pub fn step(&mut self) -> String {
        self.step_hex()
    }

    /// The current tick (the number of ticks run so far).
    pub fn tick(&self) -> u64 {
        self.inner.world().tick().0
    }

    /// Runs `n` ticks and returns the checksum of the last tick run so far. `run_ticks(0)`
    /// returns the checksum of the most recent earlier tick, or an empty string if no tick
    /// has run yet. A very large `n` simply takes as long as it takes.
    pub fn run_ticks(&mut self, n: u32) -> String {
        self.run_ticks_hex(n)
    }
}

/// Plain-Rust body of [`verify_replay`]: the error text names the diverging tick.
pub fn verify_replay_str(replay_json: &str) -> Result<(), String> {
    let file = ReplayFile::from_json_str(replay_json).map_err(|e| e.to_string())?;
    verify(&file).map_err(|e| e.to_string())
}

/// Re-runs a whole replay file and compares every tick's checksum. The error message
/// names the tick of the first divergence ("replay diverged at tick N: ...").
#[wasm_bindgen]
pub fn verify_replay(replay_json: &str) -> Result<(), JsError> {
    verify_replay_str(replay_json).map_err(|e| JsError::new(&e))
}
