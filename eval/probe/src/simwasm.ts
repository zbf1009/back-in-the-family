// Sim_Wasm loader and thin wrappers (R6.2, R6.3).
// Every wrapper passes its JSON text to the matching `llm_*` export and returns the
// JSON text unchanged. No validation, option-membership checks or grading live here:
// all of that is Rust (sim_core::llm). A thrown WebAssembly.RuntimeError is fatal:
// the module may be in a bad state, so the run stops with exit status 2.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeStderr } from './sink.ts';
import type * as Glue from 'sim-wasm/sim_wasm.d.ts';

const pkgDir = fileURLToPath(new URL('../../../target/wasm-pkg/', import.meta.url));
const wasmBytes = readFileSync(`${pkgDir}sim_wasm_bg.wasm`);

/** sha256 (lowercase hex) of the loaded .wasm bytes, for the Model_Fingerprint. */
export const wasmSha256: string = createHash('sha256').update(wasmBytes).digest('hex');

const glue = (await import(pathToFileURL(`${pkgDir}sim_wasm.js`).href)) as typeof Glue;
glue.initSync({ module: wasmBytes });

/** Exit status used when the wasm module traps. */
export const TRAP_EXIT_STATUS = 2;

export function trapMessage(exportName: string, cardId: string | undefined): string {
  return `sim-wasm trapped in ${exportName} (Card ID: ${cardId ?? 'n/a'}); stopping the run`;
}

/** Runs one export; a WebAssembly.RuntimeError ends the process with status 2. */
export function guard(
  exportName: string,
  cardId: string | undefined,
  call: () => string,
  exit: (code: number) => never = (code) => process.exit(code),
): string {
  try {
    return call();
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) {
      writeStderr(`${trapMessage(exportName, cardId)}: ${e.message}\n`);
      return exit(TRAP_EXIT_STATUS);
    }
    throw e;
  }
}

export const llmParseCard = (line: string, cardId?: string): string =>
  guard('llm_parse_card', cardId, () => glue.llm_parse_card(line));
export const llmPermutations = (input: string, cardId?: string): string =>
  guard('llm_permutations', cardId, () => glue.llm_permutations(input));
/**
 * Card IDs (or `undefined`) of every `llm_render_prompt` call so far, in order. Tests read it to prove that
 * `ingest`, `regrade` and `report` never render a locked card (R3.1, Property 26); it holds IDs only.
 */
export const renderPromptCalls: (string | undefined)[] = [];

export const llmRenderPrompt = (input: string, cardId?: string): string => {
  renderPromptCalls.push(cardId);
  return guard('llm_render_prompt', cardId, () => glue.llm_render_prompt(input));
};
/** The two validator modes of `llm_validate` (R4.16, DA-17). */
export type ValidateMode = 'json' | 'raw_choice';

/**
 * Inserts the `mode` member into a JSON-object input text without re-serializing it, so every
 * other byte reaches the export unchanged. Input that is not an object text is passed on as is:
 * the export then answers with its own `input` error.
 */
export function withMode(input: string, mode: ValidateMode): string {
  const open = input.search(/\S/);
  if (open < 0 || input[open] !== '{') return input;
  const rest = input.slice(open + 1);
  const empty = /^\s*\}/.test(rest);
  return `${input.slice(0, open + 1)}"mode":${JSON.stringify(mode)}${empty ? '' : ','}${rest}`;
}

/** `mode` is required: the Probe_Runner picks it from the Combination's `response_shape`, never from the output. */
export const llmValidate = (input: string, mode: ValidateMode, cardId?: string): string =>
  guard('llm_validate', cardId, () => glue.llm_validate(withMode(input, mode)));
/** System_One_Mapping render: `{"frozen_context":…,"mapping":"…","permutation":"base"}` in, JSON text out (R19.7). */
export const llmRenderSystemOne = (input: string, cardId?: string): string =>
  guard('llm_render_system_one', cardId, () => glue.llm_render_system_one(input));
export const llmGrade = (input: string, cardId?: string): string =>
  guard('llm_grade', cardId, () => glue.llm_grade(input));
export const llmIdentity = (input: string, cardId?: string): string =>
  guard('llm_identity', cardId, () => glue.llm_identity(input));
export const llmContrast = (input: string, cardId?: string): string =>
  guard('llm_contrast', cardId, () => glue.llm_contrast(input));
