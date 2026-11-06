//! wasm-bindgen exports of the LLM probe API (`sim_core::llm::api`).
//!
//! Each function takes one JSON string and returns one JSON string. Failures are reported
//! inside the returned envelope by `sim-core`, so none of these functions throws.

use sim_core::llm::api;
use wasm_bindgen::prelude::*;

/// Parses one card line. See [`api::llm_parse_card`].
#[wasm_bindgen]
pub fn llm_parse_card(line: &str) -> String {
    api::llm_parse_card(line)
}

/// Lists the kept permutations for a frozen context. See [`api::llm_permutations`].
#[wasm_bindgen]
pub fn llm_permutations(input: &str) -> String {
    api::llm_permutations(input)
}

/// Renders one prompt. See [`api::llm_render_prompt`].
#[wasm_bindgen]
pub fn llm_render_prompt(input: &str) -> String {
    api::llm_render_prompt(input)
}

/// Validates one raw output or non-text outcome. See [`api::llm_validate`].
#[wasm_bindgen]
pub fn llm_validate(input: &str) -> String {
    api::llm_validate(input)
}

/// Grades one verdict against an answer key. See [`api::llm_grade`].
#[wasm_bindgen]
pub fn llm_grade(input: &str) -> String {
    api::llm_grade(input)
}

/// The identity value of one verdict. See [`api::llm_identity`].
#[wasm_bindgen]
pub fn llm_identity(input: &str) -> String {
    api::llm_identity(input)
}

/// Direction consistency for one contrast pair. See [`api::llm_contrast`].
#[wasm_bindgen]
pub fn llm_contrast(input: &str) -> String {
    api::llm_contrast(input)
}
