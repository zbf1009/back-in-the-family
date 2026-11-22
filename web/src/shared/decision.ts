import { DECISION_CONTRACT } from './decision-contract.ts';

export const DECISION_REQUEST_VERSION = 'decision-request-v1';
export const DECISION_CONFIG_VERSION = 'decision-config-v1';
export const DECISION_ERROR_VERSION = 'decision-error-v1';
export const CONFIG_PREFETCH_TIMEOUT_MS = 3000;
export const DEFAULT_SESSION_CAP = 40;
export const DEFAULT_DECISION_WAIT_SECONDS = 10;
/** Selected actual UTF-8 transport policy, not a runtime default, wire bound or token/neuron guarantee. */
export const PROJECT_REQUEST_BYTE_CAP = 16_384;
export const DECISION_WIRE_BOUNDS = Object.freeze({
  state: 65_536, instructions: 8192, label: 1024, id: 64,
  depth: 4, responseBytes: 4096, requestBytesCeiling: 1_048_576,
});

export type DecisionFamily = 'dream_interpretation' | 'magistrate_ruling';
export interface DecisionCriterion { id: string; label: string }
export interface DecisionRequest {
  version: typeof DECISION_REQUEST_VERSION;
  family: DecisionFamily;
  mapping_version: typeof DECISION_CONTRACT.mappingVersion;
  mapping_hash: typeof DECISION_CONTRACT.mappingHash;
  question_id: 'decision';
  metadata: { bridge_version: 'slow-think-v1' };
  state: string;
  instructions: string;
  criteria: DecisionCriterion[];
}
export interface DecisionConfig {
  version: typeof DECISION_CONFIG_VERSION;
  enabled: boolean;
  session_cap: number;
}
export interface DecisionUsage { input_tokens: number; output_tokens: number }
export interface ModelDecision {
  version: typeof DECISION_CONTRACT.responseSchema;
  choice: string;
  model: typeof DECISION_CONTRACT.model;
  mapping_version: typeof DECISION_CONTRACT.mappingVersion;
  mapping_hash: typeof DECISION_CONTRACT.mappingHash;
  fingerprint: typeof DECISION_CONTRACT.fingerprint;
  usage: DecisionUsage | null;
  session_cap: number;
}
export const DECISION_ERROR_STATUS = Object.freeze({
  malformed_request: 400, not_found: 404, method_not_allowed: 405,
  payload_too_large: 413, model_error: 502, invalid_response: 502,
  disabled: 503, unavailable: 503, quota: 429, rate_limited: 429,
});
export type DecisionErrorKind = keyof typeof DECISION_ERROR_STATUS;
export interface DecisionError {
  version: typeof DECISION_ERROR_VERSION;
  error: { kind: DecisionErrorKind };
}
export type DecisionFallbackReason = DecisionErrorKind | 'timeout' | 'network' | 'session_cap'
  | 'cancelled' | 'zero_wait' | 'config_pending';
export type DecisionOutcome = { kind: 'model'; decision: ModelDecision }
  | { kind: 'fallback'; reason: DecisionFallbackReason };
export interface DecisionSessionStatus {
  config: 'pending' | 'ready' | 'unavailable' | 'disposed';
  enabled: boolean;
  sessionCap: number | null;
  spent: number;
  waitSeconds: number;
}

export function decisionObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return decisionObject(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}
export function isDecisionCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
const encoder = new TextEncoder();
function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && encoder.encode(value).byteLength <= maximum;
}
export function isDecisionId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1
    && value.length <= DECISION_WIRE_BOUNDS.id && /^[a-z][a-z_]*$/.test(value);
}
/** Stop at the first over-bound container, before visiting its children. */
export function withinDecisionDepth(value: unknown, depth = 1): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (depth > DECISION_WIRE_BOUNDS.depth) return false;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.every(child => withinDecisionDepth(child, depth + 1));
}
export function isDecisionRequest(value: unknown): value is DecisionRequest {
  if (!exact(value, ['version', 'family', 'mapping_version', 'mapping_hash', 'question_id',
    'metadata', 'state', 'instructions', 'criteria']) || !withinDecisionDepth(value)) return false;
  if (value.version !== DECISION_REQUEST_VERSION
    || (value.family !== 'dream_interpretation' && value.family !== 'magistrate_ruling')
    || value.mapping_version !== DECISION_CONTRACT.mappingVersion
    || value.mapping_hash !== DECISION_CONTRACT.mappingHash || value.question_id !== 'decision'
    || !exact(value.metadata, ['bridge_version']) || value.metadata.bridge_version !== 'slow-think-v1'
    || !boundedString(value.state, DECISION_WIRE_BOUNDS.state)
    || !boundedString(value.instructions, DECISION_WIRE_BOUNDS.instructions)
    || !Array.isArray(value.criteria) || value.criteria.length < 2 || value.criteria.length > 5) return false;
  const ids = new Set<string>();
  return value.criteria.every(criterion => {
    if (!exact(criterion, ['id', 'label']) || !isDecisionId(criterion.id)
      || !boundedString(criterion.label, DECISION_WIRE_BOUNDS.label) || ids.has(criterion.id)) return false;
    ids.add(criterion.id);
    return true;
  });
}
export function isDecisionConfig(value: unknown): value is DecisionConfig {
  return exact(value, ['version', 'enabled', 'session_cap']) && withinDecisionDepth(value)
    && value.version === DECISION_CONFIG_VERSION && typeof value.enabled === 'boolean'
    && isDecisionCount(value.session_cap);
}
export function isDecisionUsage(value: unknown): value is DecisionUsage {
  return exact(value, ['input_tokens', 'output_tokens'])
    && isDecisionCount(value.input_tokens) && isDecisionCount(value.output_tokens);
}
export function isModelDecision(value: unknown, request: DecisionRequest): value is ModelDecision {
  return exact(value, ['version', 'choice', 'model', 'mapping_version', 'mapping_hash',
    'fingerprint', 'usage', 'session_cap']) && withinDecisionDepth(value)
    && value.version === DECISION_CONTRACT.responseSchema && isDecisionId(value.choice)
    && request.criteria.some(criterion => criterion.id === value.choice)
    && value.model === DECISION_CONTRACT.model
    && value.mapping_version === DECISION_CONTRACT.mappingVersion
    && value.mapping_hash === DECISION_CONTRACT.mappingHash
    && value.fingerprint === DECISION_CONTRACT.fingerprint
    && (value.usage === null || isDecisionUsage(value.usage)) && isDecisionCount(value.session_cap);
}
export function isDecisionError(value: unknown, status: number): value is DecisionError {
  return exact(value, ['version', 'error']) && withinDecisionDepth(value)
    && value.version === DECISION_ERROR_VERSION && exact(value.error, ['kind'])
    && typeof value.error.kind === 'string' && Object.hasOwn(DECISION_ERROR_STATUS, value.error.kind)
    && DECISION_ERROR_STATUS[value.error.kind as DecisionErrorKind] === status;
}
