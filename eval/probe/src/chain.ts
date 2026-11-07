// Fallback chain (design: Adapter_Interface; R8.7, R8.8). Links in fixed order:
// inBrowser -> server -> rulesDefault. Transport-neutral (R8.11): it only sees RuntimeAdapter.
// All legality decisions are Rust: each text result goes through the llm_validate export and
// only `ok` and `verdict.kind` are read from the envelope. The probe never uses the Rules_Default
// link for scoring; it returns whatever default the caller supplies and never calls a model.
import type {
  AdapterErrorCode,
  Prompt,
  RequestOptions,
  RuntimeAdapter,
} from './adapters/interface.ts';
import { llmValidate } from './simwasm.ts';

export type ChainLink = 'in_browser' | 'server' | 'rules_default';
export type AttemptKind = 'valid' | 'illegal' | 'timeout' | 'error';

export interface Attempt {
  link: ChainLink;
  kind: AttemptKind;
  /** Adapter reason code; present exactly when kind is 'error'. */
  code?: AdapterErrorCode;
}

/** Verdict object exactly as the validator returned it (decision or synthesis). */
export type Verdict = { kind: string; [key: string]: unknown };

export interface ChainLinks {
  inBrowser: RuntimeAdapter | null;
  server: RuntimeAdapter | null;
  /** Caller-supplied default answer; returned as-is when every model link fails. */
  rulesDefault: unknown;
}

export interface ChainInput {
  links: ChainLinks;
  /** The Frozen_Context as JSON text (same text the validator receives). */
  frozenContext: string;
  cardId: string;
  prompt: Prompt;
  options: RequestOptions;
}

export type ChainResult =
  | { producedBy: 'in_browser' | 'server'; verdict: Verdict; text: string; attempts: Attempt[] }
  | { producedBy: 'rules_default'; answer: unknown; attempts: Attempt[] };

function validate(frozenContext: string, text: string, cardId: string): Verdict {
  const input = JSON.stringify({ frozen_context: JSON.parse(frozenContext) as unknown, raw: text });
  const env = JSON.parse(llmValidate(input, cardId)) as { ok: boolean; verdict?: Verdict };
  if (!env.ok || env.verdict === undefined) {
    throw new Error(`llm_validate rejected its input for card ${cardId}`);
  }
  return env.verdict;
}

export async function runChain(input: ChainInput): Promise<ChainResult> {
  const attempts: Attempt[] = [];
  const models: [Exclude<ChainLink, 'rules_default'>, RuntimeAdapter | null][] = [
    ['in_browser', input.links.inBrowser],
    ['server', input.links.server],
  ];
  for (const [link, adapter] of models) {
    if (adapter === null) continue; // a link that is not configured is not tried
    const result = await adapter.complete(input.prompt, input.options);
    if (result.kind === 'text') {
      const verdict = validate(input.frozenContext, result.text, input.cardId);
      if (verdict.kind !== 'illegal') {
        attempts.push({ link, kind: 'valid' });
        return { producedBy: link, verdict, text: result.text, attempts };
      }
      attempts.push({ link, kind: 'illegal' });
    } else if (result.kind === 'error') {
      attempts.push({ link, kind: 'error', code: result.code });
    } else {
      attempts.push({ link, kind: 'timeout' });
    }
  }
  attempts.push({ link: 'rules_default', kind: 'valid' });
  return { producedBy: 'rules_default', answer: input.links.rulesDefault, attempts };
}
