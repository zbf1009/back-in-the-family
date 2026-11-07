// Engine lifecycle (design: runner sequence "create engine, cold start on Warm_Up_Prompts (not
// recorded as Results)"; R9.12, R9.13). Create or rebuild an engine, then send the decision
// Warm_Up_Prompt and then the synthesis Warm_Up_Prompt. This module has no access to any Results
// writer, so warm-up traffic cannot become a Results record.
import type { Prompt, SamplingParams } from './interface.ts';

export interface LifecycleEngine {
  create(): Promise<void>;
  generate(prompt: Prompt, sampling: SamplingParams): Promise<unknown>;
  dispose(): void;
}

export interface WarmUpPrompts {
  decision: Prompt;
  synthesis: Prompt;
}

export interface LifecycleInput {
  engine: LifecycleEngine;
  warmups: WarmUpPrompts;
  sampling: SamplingParams;
  /** Called once the engine is created and both warm-ups finished (e.g. the timing machine's reset). */
  onReady?: () => void;
}

export async function createEngineWithWarmUp(input: LifecycleInput): Promise<void> {
  await input.engine.create();
  await input.engine.generate(input.warmups.decision, input.sampling);
  await input.engine.generate(input.warmups.synthesis, input.sampling);
  input.onReady?.();
}

/** Disposes the old engine state, then repeats the create sequence. A failure rejects to the caller. */
export async function rebuildEngineWithWarmUp(input: LifecycleInput): Promise<void> {
  input.engine.dispose();
  await createEngineWithWarmUp(input);
}
