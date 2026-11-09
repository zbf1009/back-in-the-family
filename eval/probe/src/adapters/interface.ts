// Adapter_Interface (design: "Adapter_Interface", R8). Transport-neutral: nothing here names a
// transport, a credentials file or a secret. `remote` is a generic status and code pair.
// Late-answer reasons come from results.ts so the adapter and the Results record cannot drift.
import type { LateNoneReason } from '../results.ts';

export interface Prompt {
  system: string;
  user: string;
}

export type OutputConstraint =
  | { kind: 'none' }
  | { kind: 'json_schema'; schema: unknown }; // D: the one card-independent schema; S: the family schema

export interface SamplingParams {
  temperature: number; // 0 = greedy
  topP: number | null;
  maxOutputTokens: number;
  seed: number | null; // null where the Runtime takes none (recorded as null, R12.12)
  chatTemplateKwargs: Record<string, boolean | string | number> | null; // e.g. { enable_thinking: false }
  constraint: OutputConstraint;
}

/** The only option every request has. A `decision` request carries no sampling (System One has none). */
export interface TimeoutOptions {
  timeoutMs: number;
}

export interface RequestOptions extends TimeoutOptions {
  sampling: SamplingParams;
}

/** Today's chat request: a system and a user text (what the existing adapters take). */
export type ChatRequest = Prompt & { readonly kind: 'chat' };

/**
 * A transport-neutral Decision_Model request (R19.6, R8.11): the rendered facts, the reading and choosing
 * instructions, and the options in the Permutation's order. It has no Workers AI field.
 */
export interface DecisionRequest {
  readonly kind: 'decision';
  readonly state: string;
  readonly instructions: string;
  readonly questionId: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

/** The Adapter_Interface request (design: Decision_Model adapter): a chat request or a decision request. */
export type AdapterRequest = ChatRequest | DecisionRequest;

export type AdapterErrorCode =
  | 'gpu_unavailable'
  | 'software_adapter'
  | 'backend_not_webgpu'
  | 'placement_not_logged'
  | 'model_load_failed'
  | 'out_of_memory'
  | 'runtime_stuck'
  | 'credentials_missing'
  | 'budget_exhausted'
  | 'not_approved'
  | 'remote_error'
  | 'rate_limited'
  | 'constraint_unmet'
  | 'empty_content'
  | 'truncated'
  | 'non_text_response'
  | 'runtime_error'
  | 'system_one_shape'
  | 'over_context'
  | 'truncated_state';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
}

/** What a System_One adapter keeps next to the outcome (R19.8): the verbatim response body and whether usage was reported. */
export interface SystemOneExtra {
  /** The byte-exact HTTP body, so `confidence` and `probabilities` keep their original lexemes. */
  readonly responseText: string;
  readonly usageReported: boolean;
}

export type LateAnswer =
  | { kind: 'late'; text: string; latencyMs: number; usage?: Usage | null } // arrived after the Timeout, by the Generation_Cap
  | { kind: 'none'; reason: LateNoneReason };

export type AdapterResult =
  | { kind: 'text'; text: string; latencyMs: number; usage: Usage | null; systemOne?: SystemOneExtra }
  | { kind: 'timeout'; timeoutMs: number; elapsedMs: number; late: Promise<LateAnswer> }
  | {
      kind: 'error';
      code: AdapterErrorCode;
      detail: string;
      elapsedMs: number;
      remote: { status: number; code: string | null } | null;
      /** Token usage when the Runtime reported it despite the error (for example `truncated`); lets the run flow settle the budget. */
      usage?: Usage | null;
      /** Set by a System_One adapter for a response it could read (R19.8). */
      systemOne?: SystemOneExtra;
    };

export interface RuntimeIdentity {
  runtime: string;
  runtimeVersion: string;
  modelId: string; // 'unknown' when not determinable (R8.10)
  modelRevision: string; // commit sha, or 'server-side, not pinnable' (R11.21)
  quantization: string;
}

/** An adapter that also takes the transport-neutral `decision` request (the System_One adapter). */
export interface DecisionAdapter extends RuntimeAdapter {
  complete(request: Prompt | AdapterRequest, options: TimeoutOptions): Promise<AdapterResult>;
}

export type AdapterState = 'idle' | 'busy' | 'stuck';

export interface RuntimeAdapter {
  identity(): RuntimeIdentity;
  state(): AdapterState;
  complete(prompt: Prompt, options: RequestOptions): Promise<AdapterResult>;
}
