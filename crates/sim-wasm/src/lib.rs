//! wasm-bindgen bindings for `sim-core`.
//!
//! This crate is deliberately thin: every rule lives in `sim-core`; here we only turn
//! strings, JSON and errors into what JavaScript sees. Each exported function has a
//! plain-Rust twin returning `Result<_, String>` (`WasmSim::create`, `submit_json`,
//! [`verify_replay_str`]) so the same logic is testable on native and wasm32, where
//! `JsError` cannot be inspected or even built on native.
//!
//! JSON formats:
//! - `config_json`: the `ReplayConfig` shape, e.g. `{"opening_residents":50}`. An
//!   unknown field (such as the retired `workload`) is rejected and no World is created.
//! - `input_json`:
//!   `{"tick":"5","payload":{"Act":{"kind":"help","actor":"3","target":"17","intensity":40}}}`;
//!   `u64` values (`tick`, `actor`, `target`) are strict decimal strings, `kind` is one
//!   of `help`, `gift`, `quarrel`, `insult`, `theft`, `apology`, and there is no `seq`
//!   (the stream assigns it).
//! - Checksums are returned as 16 lowercase hex characters.
//!
//! `snapshot()` returns the Snapshot JSON (R18) of the current World: a read-only,
//! compact view of Residents, Households and Souls in ascending ID order. It takes
//! `&self`, so calling it cannot change the run.
//!
//! `u64` arguments and results (`seed`, `tick()`) are JavaScript `BigInt`s.
#![forbid(unsafe_code)]

pub mod llm;

mod preview;
#[cfg(test)]
mod preview_tests;

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

    /// Plain-Rust body of [`WasmSim::preview_node`].
    pub fn preview_node_json(&self, payload_json: &str) -> String {
        preview::preview_json(&self.inner, payload_json)
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

    /// Plain-Rust body of [`WasmSim::snapshot`]: the Snapshot JSON of the current World
    /// (R18). Takes `&self`, so it cannot change the World.
    pub fn snapshot_string(&self) -> String {
        sim_core::snapshot::snapshot_json(self.inner.world())
    }

    /// Plain-Rust body of [`WasmSim::export_replay`].
    pub fn export_replay_json(&self) -> Result<String, String> {
        ReplayFile::from_sim(&self.inner)
            .and_then(|replay| replay.to_json_string())
            .map_err(|e| e.to_string())
    }

    /// Plain-Rust body of `run_until_stop`; the JSON field order is part of its reply.
    pub fn run_until_stop_json(&mut self, max: u32) -> String {
        let result = self.inner.run_until_stop(max);
        let checksum = result
            .checksum
            .map_or_else(String::new, |c| c.to_hex_string());
        let stops = serde_json::to_string(&result.stops.labels()).expect("stop labels serialize");
        format!(
            r#"{{"ran":{},"checksum":"{}","stops":{}}}"#,
            result.ran, checksum, stops
        )
    }

    /// Preflight the current-tick payload array before queuing any of it.
    pub fn submit_checked_json(&mut self, inputs_json: &str) -> Result<String, String> {
        let inputs: Vec<sim_core::replay::ReplayPayload> =
            serde_json::from_str(inputs_json).map_err(|e| e.to_string())?;
        let payloads: Vec<_> = inputs.into_iter().map(Into::into).collect();
        Ok(match self.inner.try_submit_all(&payloads) {
            Ok(_) => String::from(r#"{"ok":true}"#),
            Err((index, reason)) => format!(
                r#"{{"ok":false,"index":{},"reason":"{}"}}"#,
                index,
                reason.label()
            ),
        })
    }

    /// Tick `from..=to` of the already recorded checksum history.
    pub fn checksums_json(&self, from: u64, to: u64) -> String {
        let history = self.inner.checksums();
        let start = usize::try_from(from).unwrap_or(usize::MAX);
        let end = usize::try_from(to.saturating_add(1)).unwrap_or(usize::MAX);
        let values: Vec<_> = history
            .get(start..end.min(history.len()))
            .unwrap_or(&[])
            .iter()
            .map(|checksum| checksum.to_hex_string())
            .collect();
        serde_json::to_string(&values).expect("checksum list serializes")
    }

    /// Pending node + accepted input-stream choice; never World snapshot state.
    pub fn player_node_state_json(&self) -> String {
        match self.inner.player_node_state() {
            None => String::from(r#"{"pending":false}"#),
            Some((node, answered)) => format!(
                r#"{{"pending":true,"node":"{}","answered":{}}}"#,
                node.0, answered
            ),
        }
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

    /// The Snapshot JSON of the current World (R18), compact and read-only.
    pub fn snapshot(&self) -> String {
        self.snapshot_string()
    }

    /// Audit-only v5 JSON from the live run, including inputs still queued.
    pub fn export_replay(&self) -> Result<String, JsError> {
        self.export_replay_json().map_err(|e| JsError::new(&e))
    }

    /// Up to `max` core ticks; pauses on the first stop tick, without a Worker gate.
    pub fn run_until_stop(&mut self, max: u32) -> String {
        self.run_until_stop_json(max)
    }

    /// Checked, all-or-nothing current-tick payload array.
    pub fn submit_checked(&mut self, inputs_json: &str) -> Result<String, JsError> {
        self.submit_checked_json(inputs_json)
            .map_err(|e| JsError::new(&e))
    }

    /// Read-only preview of a current-tick payload, e.g.
    /// `{"Dream":{"dreamer":"39","intent":"reassure"}}` or `{"Bribe":{"amount":"1"}}`.
    /// This takes the same payload shape as an entry in `submit_checked`, with
    /// canonical decimal strings for replay `u64` fields. There is no tick or seq
    /// wrapper. Only Dream and Bribe fire decision nodes.
    ///
    /// Success: `ok: true`, `family`, `trigger` (decimal-string sequence),
    /// `frozen_context`, `option_ids`, `option_defs` (id/label pairs), `rules_default`
    /// (an option ID). The context uses the pinned LLM JSON shape unchanged, including
    /// its numeric person IDs, so it passes directly to the renderer and validator.
    /// There is no World or predicted Node ID in the reply.
    ///
    /// Failure: `ok: false`, `error.kind` is `malformed`, `rejected` (with the core
    /// rejection label in `error.reason`), or `no_node` (accepted, but no node fired).
    pub fn preview_node(&self, payload_json: &str) -> String {
        self.preview_node_json(payload_json)
    }

    /// Read already-computed per-tick checksum strings, inclusive range.
    pub fn checksums(&self, from: u64, to: u64) -> String {
        self.checksums_json(from, to)
    }

    /// Whether a pending node has a checked choice in the input stream.
    pub fn player_node_state(&self) -> String {
        self.player_node_state_json()
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

/// Ticks run before the checksum loop in [`bench_checksum_hex`], so affinities are
/// populated and the state is representative.
#[cfg(feature = "bench")]
pub const BENCH_WARMUP_TICKS: u32 = 100;

/// Plain-Rust body of [`bench_checksum`].
///
/// Builds a `Sim` from `seed` and `config_json`, runs [`BENCH_WARMUP_TICKS`] ticks, then
/// computes `Checksum::of(world)` `iterations` times. The sink is a running wrapping sum
/// of the values, returned as 16 hex characters, so the optimizer cannot drop the loop.
/// (An XOR sink would cancel for every even `iterations`.)
#[cfg(feature = "bench")]
pub fn bench_checksum_hex(seed: u64, config_json: &str, iterations: u32) -> Result<String, String> {
    use sim_core::checksum::Checksum;
    let mut sim = WasmSim::create(seed, config_json)?.inner;
    for _ in 0..BENCH_WARMUP_TICKS {
        sim.step();
    }
    let mut sink = 0u64;
    for _ in 0..iterations {
        sink = sink.wrapping_add(Checksum::of(sim.world()).0);
    }
    Ok(Checksum(sink).to_hex_string())
}

/// Benchmark helper (feature `bench` only): see [`bench_checksum_hex`]. The time for
/// `iterations = 1` is the baseline (construction plus warm-up); callers subtract it.
#[cfg(feature = "bench")]
#[wasm_bindgen]
pub fn bench_checksum(seed: u64, config_json: &str, iterations: u32) -> Result<String, JsError> {
    bench_checksum_hex(seed, config_json, iterations).map_err(|e| JsError::new(&e))
}
