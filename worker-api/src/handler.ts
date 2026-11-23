import { readRequest } from './http.ts';
import { DECISION_CONTRACT } from '../../web/src/shared/decision-contract.ts';
import {
  DECISION_CONFIG_VERSION, DECISION_ERROR_STATUS, DECISION_ERROR_VERSION,
  DECISION_WIRE_BOUNDS, DEFAULT_SESSION_CAP, decisionObject, isDecisionCount,
  isDecisionId, isDecisionRequest, isDecisionUsage, isModelDecision,
} from '../../web/src/shared/decision.ts';
import type { DecisionErrorKind, DecisionRequest, DecisionUsage, ModelDecision } from '../../web/src/shared/decision.ts';

// Transport-only port, not an Env or a second request validator. The production
// entry passes its generated AI binding here, checking the native run overload.
export interface DecisionAI {
  run(model: typeof DECISION_CONTRACT.model, input: {
    model: 'clef';
    state: DecisionRequest['state'];
    questions: { decision: {
      type: 'choice';
      instructions: DecisionRequest['instructions'];
      criteria: Record<string, string>;
    } };
  }, options: { returnRawResponse: true }): Promise<unknown>;
}

export type DecisionAdmission = () => Promise<'admitted' | 'disabled' | 'rate_limited' | 'unavailable'>;

export function json(value: unknown, status = 200, allow?: string): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(allow === undefined ? {} : { Allow: allow }),
    },
  });
}
export function failure(kind: DecisionErrorKind, allow?: string): Response {
  return json({ version: DECISION_ERROR_VERSION, error: { kind } }, DECISION_ERROR_STATUS[kind], allow);
}

// Wrangler variables may be JSON numbers or decimal strings. No truthiness,
// whitespace, exponent, fractional, boolean or invalid-value defaulting.
export function configuredCount(value: unknown): number | null {
  if (isDecisionCount(value)) return value;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const number = Number(value);
  return isDecisionCount(number) ? number : null;
}
function usableAI(value: unknown): value is DecisionAI {
  return decisionObject(value) && typeof value.run === 'function';
}

function project(raw: unknown, request: DecisionRequest, sessionCap: number): ModelDecision | null {
  if (!decisionObject(raw) || typeof raw.model !== 'string' || raw.model.length === 0
    || raw.model.length > 128 || new TextEncoder().encode(raw.model).byteLength > 128
    || !decisionObject(raw.answers) || !decisionObject(raw.answers.decision)) return null;
  const answer = raw.answers.decision;
  if (answer.type !== 'choice' || !isDecisionId(answer.choice)
    || !request.criteria.some(criterion => criterion.id === answer.choice)) return null;
  let usage: DecisionUsage | null = null;
  if (Object.hasOwn(raw, 'usage')) {
    if (!isDecisionUsage(raw.usage)) return null;
    usage = raw.usage;
  }
  const decision = {
    version: DECISION_CONTRACT.responseSchema,
    choice: answer.choice,
    model: DECISION_CONTRACT.model,
    mapping_version: DECISION_CONTRACT.mappingVersion,
    mapping_hash: DECISION_CONTRACT.mappingHash,
    fingerprint: DECISION_CONTRACT.fingerprint,
    usage: usage === null ? null : {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
    session_cap: sessionCap,
  };
  return isModelDecision(decision, request) ? decision : null;
}

/** Unknown at the runtime boundary; generated Wrangler types own real bindings. */
export async function handleRequest(request: Request, environment: unknown, binding?: DecisionAI, admission?: DecisionAdmission): Promise<Response> {
  const path = new URL(request.url).pathname;
  const env = decisionObject(environment) ? environment : {};
  if (path !== '/api' && !path.startsWith('/api/')) {
    if (decisionObject(env.ASSETS) && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return failure('unavailable');
  }
  const configRoute = path === '/api/decision/config';
  if (!configRoute && path !== '/api/decision') return failure('not_found');
  const allow = configRoute ? 'GET' : 'POST';
  if (request.method !== allow) return failure('method_not_allowed', allow);

  const sessionCap = Object.hasOwn(env, 'SESSION_CAP')
    ? configuredCount(env.SESSION_CAP) : DEFAULT_SESSION_CAP;
  const byteCap = configuredCount(env.MAX_REQUEST_BYTES);
  const ai = binding ?? env.AI;
  const enabled = (env.INFERENCE_ENABLED === true || env.INFERENCE_ENABLED === 'true')
    && sessionCap !== null && byteCap !== null && byteCap >= 1
    && byteCap <= DECISION_WIRE_BOUNDS.requestBytesCeiling && usableAI(ai);
  if (sessionCap === null) return failure('disabled');
  if (configRoute) return json({ version: DECISION_CONFIG_VERSION, enabled, session_cap: sessionCap });
  if (!enabled || byteCap === null || !usableAI(ai)) return failure('disabled');

  const body = await readRequest(request, byteCap);
  if (!body.ok) return failure(body.kind);
  const parsed = body.value;
  if (!isDecisionRequest(parsed)) return failure('malformed_request');
  const input: Parameters<DecisionAI['run']>[1] = {
    model: 'clef',
    state: parsed.state,
    questions: {
      decision: {
        type: 'choice',
        instructions: parsed.instructions,
        criteria: Object.fromEntries(parsed.criteria.map(criterion => [criterion.id, criterion.label])),
      },
    },
  };
  if (admission !== undefined) {
    try {
      const result = await admission();
      if (result !== 'admitted') {
        return failure(result === 'disabled' || result === 'rate_limited' ? result : 'unavailable');
      }
    } catch {
      return failure('unavailable');
    }
  }
  let raw: unknown;
  try {
    raw = await ai.run('@cf/cloudflare/clef', input, { returnRawResponse: true });
  } catch {
    return failure('model_error');
  }
  // Pinned workerd Ai.run documents returnRawResponse before its error parser.
  // Inspect only this request's Response, never shared lastRequest* diagnostics,
  // provider error text or unverified 3036/quota meanings. Success remains the
  // same native JSON object that the binding otherwise returns via res.json().
  if (!(raw instanceof Response)) return failure('invalid_response');
  if (raw.status !== 200) {
    if (raw.body) await raw.body.cancel().catch(() => {});
    return failure(raw.status === 429 ? 'rate_limited' : 'model_error');
  }
  try {
    raw = await raw.json();
  } catch {
    return failure('invalid_response');
  }
  const decision = project(raw, parsed, sessionCap);
  return decision === null ? failure('invalid_response') : json(decision);
}
