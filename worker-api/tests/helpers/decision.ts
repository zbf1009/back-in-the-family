import assert from 'node:assert/strict';
import { DECISION_CONTRACT } from '../../../web/src/shared/decision-contract.ts';
import {
  DECISION_REQUEST_VERSION, DECISION_WIRE_BOUNDS, isDecisionError, isDecisionRequest,
} from '../../../web/src/shared/decision.ts';
import type { DecisionErrorKind, DecisionRequest } from '../../../web/src/shared/decision.ts';

export function decisionRequest(): DecisionRequest {
  const value = {
    version: DECISION_REQUEST_VERSION,
    family: 'dream_interpretation',
    mapping_version: DECISION_CONTRACT.mappingVersion,
    mapping_hash: DECISION_CONTRACT.mappingHash,
    question_id: 'decision',
    metadata: { bridge_version: 'slow-think-v1' },
    state: 'A fictional resident remembers a warning.',
    instructions: 'Choose one of the legal options.',
    criteria: [
      { id: 'heed_warning', label: 'Heed the warning.' },
      { id: 'dismiss_dream', label: 'Dismiss the dream.' },
    ],
  };
  assert.ok(isDecisionRequest(value));
  return value;
}
export function nativeResult(): Record<string, unknown> {
  return {
    model: 'clef-provider-revision',
    answers: { decision: { type: 'choice', choice: 'heed_warning' } },
    usage: { input_tokens: 23, output_tokens: 1 },
  };
}
export function enabledVariables(): Record<string, unknown> {
  return { INFERENCE_ENABLED: 'true', MAX_REQUEST_BYTES: String(DECISION_WIRE_BOUNDS.requestBytesCeiling) };
}
export function post(body: unknown = decisionRequest(), headers?: Record<string, string>): Request {
  return new Request('https://decision.test/api/decision', {
    method: 'POST', body: JSON.stringify(body), headers,
  });
}
export interface PublicResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export async function publicBody(response: PublicResponse): Promise<unknown> {
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.ok(new TextEncoder().encode(text).byteLength <= DECISION_WIRE_BOUNDS.responseBytes);
  return JSON.parse(text) as unknown;
}
export async function expectError(response: PublicResponse, kind: DecisionErrorKind, status: number): Promise<void> {
  assert.equal(response.status, status);
  const body = await publicBody(response);
  assert.ok(isDecisionError(body, status));
  assert.deepEqual(body, { version: 'decision-error-v1', error: { kind } });
}
