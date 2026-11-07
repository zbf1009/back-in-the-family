// Prompt_Templates and Warm_Up_Prompts: loaded from the committed files, hashed over their exact bytes.
// Template format and placeholders are the renderer's (crates/sim-core/src/llm/render.rs).
// Warm-up files use the same `[system]` / `[user]` sections but carry literal text (no placeholders);
// they are sent after every engine create or rebuild and never recorded as results.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TaskType } from './cards.ts';
import type { Prompt } from './adapters/interface.ts';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
export const WARMUP_DIR = fileURLToPath(new URL('../warmup/', import.meta.url));

export const TEMPLATE_FILES: Readonly<Record<TaskType, string>> = {
  decision: 'decision.v1.txt',
  synthesis: 'synthesis.v1.txt',
};
export const WARMUP_FILES: Readonly<Record<TaskType, string>> = {
  decision: 'decision.txt',
  synthesis: 'synthesis.txt',
};

export interface TextWithHash {
  readonly text: string;
  /** sha256 (lowercase hex) of the file's exact bytes. */
  readonly sha256: string;
}

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function load(path: string): TextWithHash {
  const bytes = readFileSync(path);
  return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha256: sha256Hex(bytes) };
}

export const loadTemplate = (task: TaskType, dir: string = TEMPLATES_DIR): TextWithHash => load(`${dir}${TEMPLATE_FILES[task]}`);
export const loadWarmup = (task: TaskType, dir: string = WARMUP_DIR): TextWithHash => load(`${dir}${WARMUP_FILES[task]}`);

/** Template_Hash per Task_Type, as recorded in the ledger `template_hashes`. */
export const templateHashes = (dir: string = TEMPLATES_DIR): Record<TaskType, string> => ({
  decision: loadTemplate('decision', dir).sha256,
  synthesis: loadTemplate('synthesis', dir).sha256,
});

/** Warm-up hash per Task_Type. */
export const warmupHashes = (dir: string = WARMUP_DIR): Record<TaskType, string> => ({
  decision: loadWarmup('decision', dir).sha256,
  synthesis: loadWarmup('synthesis', dir).sha256,
});

/**
 * Splits a warm-up file into its `[system]` and `[user]` sections (same layout as a template, no
 * placeholders). Throws when a section marker is missing or out of order.
 */
export function parseWarmupPrompt(text: string): Prompt {
  const lines = text.split('\n');
  const sys = lines.findIndex((l) => l === '[system]');
  const usr = lines.findIndex((l) => l === '[user]');
  if (sys !== 0 || usr < 0) throw new Error('warm-up prompt must start with [system] and contain [user]');
  return { system: lines.slice(1, usr).join('\n'), user: lines.slice(usr + 1).join('\n') };
}

/** The warm-up prompt of a Task_Type, parsed from its committed file. */
export const loadWarmupPrompt = (task: TaskType, dir: string = WARMUP_DIR): Prompt => parseWarmupPrompt(loadWarmup(task, dir).text);
