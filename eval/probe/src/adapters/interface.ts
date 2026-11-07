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

export interface RequestOptions {
  timeoutMs: number;
  sampling: SamplingParams;
}

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
  | 'runtime_error';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
}

export type LateAnswer =
  | { kind: 'late'; text: string; latencyMs: number; usage?: Usage | null } // arrived after the Timeout, by the Generation_Cap
  | { kind: 'none'; reason: LateNoneReason };

export type AdapterResult =
  | { kind: 'text'; text: string; latencyMs: number; usage: Usage | null }
  | { kind: 'timeout'; timeoutMs: number; elapsedMs: number; late: Promise<LateAnswer> }
  | {
      kind: 'error';
      code: AdapterErrorCode;
      detail: string;
      elapsedMs: number;
      remote: { status: number; code: string | null } | null;
    };

export interface RuntimeIdentity {
  runtime: string;
  runtimeVersion: string;
  modelId: string; // 'unknown' when not determinable (R8.10)
  modelRevision: string; // commit sha, or 'server-side, not pinnable' (R11.21)
  quantization: string;
}

export type AdapterState = 'idle' | 'busy' | 'stuck';

export interface RuntimeAdapter {
  identity(): RuntimeIdentity;
  state(): AdapterState;
  complete(prompt: Prompt, options: RequestOptions): Promise<AdapterResult>;
}
