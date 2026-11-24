var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../../../home/runner/work/back-in-the-family/back-in-the-family/worker-api/src/http.ts
async function readRequest(request, cap) {
  if (request.body === null) return { ok: false, kind: "malformed_request" };
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => {
        });
        return { ok: false, kind: "payload_too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) };
  } catch {
    await reader.cancel().catch(() => {
    });
    return { ok: false, kind: "malformed_request" };
  } finally {
    reader.releaseLock();
  }
}
__name(readRequest, "readRequest");

// ../../../../home/runner/work/back-in-the-family/back-in-the-family/web/src/shared/decision-contract.ts
var DECISION_CONTRACT = Object.freeze({
  provider: "cloudflare_workers_ai",
  model: "@cf/cloudflare/clef",
  mappingVersion: "system-one-v1",
  mappingHash: "e275f397327b91dc1b6f69290535d6ef72c6bb712021ff130ed9da43589b337d",
  responseSchema: "clef-system-one-choice-v1",
  fingerprint: "6ffb8d3a255dbc1d066ba3b4a1c38291b1adfda5aa1f4e3c65a9adafbd243a32"
});

// ../../../../home/runner/work/back-in-the-family/back-in-the-family/web/src/shared/decision.ts
var DECISION_REQUEST_VERSION = "decision-request-v1";
var DECISION_CONFIG_VERSION = "decision-config-v1";
var DECISION_ERROR_VERSION = "decision-error-v1";
var DEFAULT_SESSION_CAP = 40;
var DECISION_WIRE_BOUNDS = Object.freeze({
  state: 65536,
  instructions: 8192,
  label: 1024,
  id: 64,
  depth: 4,
  responseBytes: 4096,
  requestBytesCeiling: 1048576
});
var DECISION_ERROR_STATUS = Object.freeze({
  malformed_request: 400,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  model_error: 502,
  invalid_response: 502,
  disabled: 503,
  unavailable: 503,
  quota: 429,
  rate_limited: 429
});
function decisionObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(decisionObject, "decisionObject");
function exact(value, keys) {
  return decisionObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
__name(exact, "exact");
function isDecisionCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
__name(isDecisionCount, "isDecisionCount");
var encoder = new TextEncoder();
function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && encoder.encode(value).byteLength <= maximum;
}
__name(boundedString, "boundedString");
function isDecisionId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= DECISION_WIRE_BOUNDS.id && /^[a-z][a-z_]*$/.test(value);
}
__name(isDecisionId, "isDecisionId");
function withinDecisionDepth(value, depth = 1) {
  if (typeof value !== "object" || value === null) return true;
  if (depth > DECISION_WIRE_BOUNDS.depth) return false;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.every((child) => withinDecisionDepth(child, depth + 1));
}
__name(withinDecisionDepth, "withinDecisionDepth");
function isDecisionRequest(value) {
  if (!exact(value, [
    "version",
    "family",
    "mapping_version",
    "mapping_hash",
    "question_id",
    "metadata",
    "state",
    "instructions",
    "criteria"
  ]) || !withinDecisionDepth(value)) return false;
  if (value.version !== DECISION_REQUEST_VERSION || value.family !== "dream_interpretation" && value.family !== "magistrate_ruling" || value.mapping_version !== DECISION_CONTRACT.mappingVersion || value.mapping_hash !== DECISION_CONTRACT.mappingHash || value.question_id !== "decision" || !exact(value.metadata, ["bridge_version"]) || value.metadata.bridge_version !== "slow-think-v1" || !boundedString(value.state, DECISION_WIRE_BOUNDS.state) || !boundedString(value.instructions, DECISION_WIRE_BOUNDS.instructions) || !Array.isArray(value.criteria) || value.criteria.length < 2 || value.criteria.length > 5) return false;
  const ids = /* @__PURE__ */ new Set();
  return value.criteria.every((criterion) => {
    if (!exact(criterion, ["id", "label"]) || !isDecisionId(criterion.id) || !boundedString(criterion.label, DECISION_WIRE_BOUNDS.label) || ids.has(criterion.id)) return false;
    ids.add(criterion.id);
    return true;
  });
}
__name(isDecisionRequest, "isDecisionRequest");
function isDecisionUsage(value) {
  return exact(value, ["input_tokens", "output_tokens"]) && isDecisionCount(value.input_tokens) && isDecisionCount(value.output_tokens);
}
__name(isDecisionUsage, "isDecisionUsage");
function isModelDecision(value, request) {
  return exact(value, [
    "version",
    "choice",
    "model",
    "mapping_version",
    "mapping_hash",
    "fingerprint",
    "usage",
    "session_cap"
  ]) && withinDecisionDepth(value) && value.version === DECISION_CONTRACT.responseSchema && isDecisionId(value.choice) && request.criteria.some((criterion) => criterion.id === value.choice) && value.model === DECISION_CONTRACT.model && value.mapping_version === DECISION_CONTRACT.mappingVersion && value.mapping_hash === DECISION_CONTRACT.mappingHash && value.fingerprint === DECISION_CONTRACT.fingerprint && (value.usage === null || isDecisionUsage(value.usage)) && isDecisionCount(value.session_cap);
}
__name(isModelDecision, "isModelDecision");

// ../../../../home/runner/work/back-in-the-family/back-in-the-family/worker-api/src/handler.ts
function json(value, status = 200, allow) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...allow === void 0 ? {} : { Allow: allow }
    }
  });
}
__name(json, "json");
function failure(kind, allow) {
  return json({ version: DECISION_ERROR_VERSION, error: { kind } }, DECISION_ERROR_STATUS[kind], allow);
}
__name(failure, "failure");
function configuredCount(value) {
  if (isDecisionCount(value)) return value;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const number = Number(value);
  return isDecisionCount(number) ? number : null;
}
__name(configuredCount, "configuredCount");
function usableAI(value) {
  return decisionObject(value) && typeof value.run === "function";
}
__name(usableAI, "usableAI");
function project(raw, request, sessionCap) {
  if (!decisionObject(raw) || typeof raw.model !== "string" || raw.model.length === 0 || raw.model.length > 128 || new TextEncoder().encode(raw.model).byteLength > 128 || !decisionObject(raw.answers) || !decisionObject(raw.answers.decision)) return null;
  const answer = raw.answers.decision;
  if (answer.type !== "choice" || !isDecisionId(answer.choice) || !request.criteria.some((criterion) => criterion.id === answer.choice)) return null;
  let usage = null;
  if (Object.hasOwn(raw, "usage")) {
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
      output_tokens: usage.output_tokens
    },
    session_cap: sessionCap
  };
  return isModelDecision(decision, request) ? decision : null;
}
__name(project, "project");
async function handleRequest(request, environment, binding, admission) {
  const path = new URL(request.url).pathname;
  const env = decisionObject(environment) ? environment : {};
  if (path !== "/api" && !path.startsWith("/api/")) {
    if (decisionObject(env.ASSETS) && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return failure("unavailable");
  }
  const configRoute = path === "/api/decision/config";
  if (!configRoute && path !== "/api/decision") return failure("not_found");
  const allow = configRoute ? "GET" : "POST";
  if (request.method !== allow) return failure("method_not_allowed", allow);
  const sessionCap = Object.hasOwn(env, "SESSION_CAP") ? configuredCount(env.SESSION_CAP) : DEFAULT_SESSION_CAP;
  const byteCap = configuredCount(env.MAX_REQUEST_BYTES);
  const ai = binding ?? env.AI;
  const enabled = (env.INFERENCE_ENABLED === true || env.INFERENCE_ENABLED === "true") && sessionCap !== null && byteCap !== null && byteCap >= 1 && byteCap <= DECISION_WIRE_BOUNDS.requestBytesCeiling && usableAI(ai);
  if (sessionCap === null) return failure("disabled");
  if (configRoute) return json({ version: DECISION_CONFIG_VERSION, enabled, session_cap: sessionCap });
  if (!enabled || byteCap === null || !usableAI(ai)) return failure("disabled");
  const body = await readRequest(request, byteCap);
  if (!body.ok) return failure(body.kind);
  const parsed = body.value;
  if (!isDecisionRequest(parsed)) return failure("malformed_request");
  const input = {
    model: "clef",
    state: parsed.state,
    questions: {
      decision: {
        type: "choice",
        instructions: parsed.instructions,
        criteria: Object.fromEntries(parsed.criteria.map((criterion) => [criterion.id, criterion.label]))
      }
    }
  };
  if (admission !== void 0) {
    try {
      const result = await admission();
      if (result !== "admitted") {
        return failure(result === "disabled" || result === "rate_limited" ? result : "unavailable");
      }
    } catch {
      return failure("unavailable");
    }
  }
  let raw;
  try {
    raw = await ai.run("@cf/cloudflare/clef", input, { returnRawResponse: true });
  } catch {
    return failure("model_error");
  }
  if (!(raw instanceof Response)) return failure("invalid_response");
  if (raw.status !== 200) {
    if (raw.body) await raw.body.cancel().catch(() => {
    });
    return failure(raw.status === 429 ? "rate_limited" : "model_error");
  }
  try {
    raw = await raw.json();
  } catch {
    return failure("invalid_response");
  }
  const decision = project(raw, parsed, sessionCap);
  return decision === null ? failure("invalid_response") : json(decision);
}
__name(handleRequest, "handleRequest");

// ../../../../home/runner/work/back-in-the-family/back-in-the-family/worker-api/src/index.ts
var index_default = {
  fetch(request, env) {
    return handleRequest(request, env, env.AI);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
