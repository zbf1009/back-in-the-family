# Design Document: judge-demo-release

## Overview

Implemented and published by the execution session; final Spec review **PASS** for source `1701d2df26ede28c2a5ed422a6dbff0fcd7845dd`. The implementation is a separate Judge Worker over the existing game/native Decision handler, coordinated by one persistent SQLite review pool. The verified reviewer deployment remains available, unlike the earlier disposable C4 trial. The single **Author grant in requirements.md** remains the resource and budget boundary; actual deployment steps and evidence limits are recorded in the [final acceptance record](../../../docs/kiro-log.md#judge-demo-release-final-spec-acceptance).

**Current public continuation:** the generic own-account/default-off Deploy entry has separately verified permanent publication and actual import/build/rules-only UI/application-byte/native AI/ASSETS proof with owned cleanup through slow-think tasks 10.1–10.3. [The public delivery audit](../../../docs/slow-think-audit.md#permanent-public-delivery) records import source `32100ed224595d0ec4d0645a0ae4e9cde640c7bf`, successful main/static/publisher `45326300030/1` and dependent judge `45328839414/1`, with **0 new models / 0 judge calls**. These are continuation identities, not replacements for original accepted judge `1701d2…` or a new native-decision/quality sample. The reviewer Worker, namespace `94ccd70c31864da69594838a4baeda91`, `review-pool-v1`, existing Secret and counters remain retained; the **40/UTC-day**, **10/session-lifetime**, **86400-second TTL** contract is unchanged and balances were not reread. The original grant and design below remain the judge scope; public documentation-tail CI and final Spec 7 acceptance are the remaining delivery review, not new judge authority.

Repository anchors used for this design: `worker-api/src/handler.ts:109–169` (original parsing/native dispatch/projection), `web/src/shared/decision.ts:18–54,93–137` (closed wire), `worker-api/scripts/{profile,wrangler,bundle,tools}.ts` (pinned source/build/runtime helpers), `worker-api/tests/helpers/runtime.ts:64–174` (isolated native-shaped fake), `scripts/artifact-inputs.ts:18–32,149–154,173–208,302–323` (existing checked identity/source/license/assets), and `.github/workflows/deploy.yml:10–41,90–99,133–139` (main gate transport/static path/disabled publisher). The installed Wrangler 4.157.0 `config-schema.json:118–122,3868–3894,3993–3998` permits declarative SQLite exports, mutually exclusive with migrations. These are read-only planning observations, not new runtime proofs.

## Architecture

- Existing Public_Game: unchanged static workflow/config and rules-only assets.
- `src/judge.ts`: default fetch router and minimal real login/status HTML; gate root and model routes, then call the original handler with the real generated native `AI` binding.
- `src/judge-gate.ts`: exported `JudgeGate extends DurableObject<JudgeEnv>`; one `JUDGE_GATE.getByName('review-pool-v1')` holds shared admission state. This low-volume coordination atom handles short SQL operations only, not AI network waits.
- `src/http.ts`: extract only the original bounded UTF-8 JSON reader so login and Decision share parsing/byte-limit behavior while retaining their separate envelopes.
- Existing profile/build/runtime helpers gain an explicit judge selection with their default generic behavior unchanged. Judge source/hosted config, generated binding declaration and bundle are separate. No wrapper replacing `env.AI`, duplicate Decision parser, second license/Cargo/SDK selector or generic provenance schema is introduced.

Root, `/api`, `/api/*` and `/judge/login` run Worker first. Static JS/CSS/WASM remain ordinary checked assets. Version URLs are disabled and no branch/preview deployment or alternate ungated model entrypoint is created. Any intentionally enabled alias must execute the same router and stable pool.

## Components and Interfaces

### 1. Judge router and native admission seam

Preserve `handleRequest(request, environment, binding?)` for existing callers; add an optional fourth argument:

```ts
type DecisionAdmission = () => Promise<
  'admitted' | 'disabled' | 'rate_limited' | 'unavailable'
>;
```

Only the Judge entry supplies it. Existing generic callers retain their original behavior and disabled profiles. Construct the identical native input once, after `readRequest` and `isDecisionRequest` have passed, immediately before dispatch. Await admission outside the original provider-error catch: denial becomes the existing `failure(kind)`, callback/RPC rejection becomes `unavailable`, and only `admitted` enters the unchanged real `AI.run('@cf/cloudflare/clef', input, {returnRawResponse:true})` try/catch. Preserve raw Response checks and projection. Export/reuse the existing `json`, `failure` and strict `configuredCount` helpers where needed; do not duplicate their behavior.

The extracted reader returns `{ok:true,value:unknown}` or `{ok:false,kind:'malformed_request'|'payload_too_large'}`; each caller maps it to its own error envelope. It retains actual streamed byte counting, cancellation on overflow/failure, fatal UTF-8 decoding and one JSON parse. Decision validation, depth/string/criteria limits and request construction remain owned by the existing shared contract.

Route/method checks occur before auth/storage work. Required judge configuration is validated before using the Decision handler: missing/invalid limit, secret, AI or DO yields original `disabled` / 503; a reachable DO/RPC failure yields original `unavailable` / 503. For POST, a valid session is checked without reservation, original input validation runs once, then reserve rechecks authoritatively. Use a request-local environment view, never mutate shared `env`. POST may have zero remaining quota at the snapshot yet stays enabled for validation so the seam returns `rate_limited`, not a misleading `disabled`. Successful `ModelDecision.session_cap` is a diagnostic snapshot; it does not change the client's cached GET config cap.

### 2. Exact portal and Decision HTTP behavior

JSON responses have `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`, with no CORS. Portal means `/api/judge`, `/api/judge/*` and login-route errors only; unknown portal paths return portal 404. Other API paths still use the original Decision 404/405 wire. Method rejection includes `Allow`; session allows `GET, POST, DELETE`, login allows `GET`. No code or token is accepted as a query parameter or authorization URL.

| Route | Exact behavior |
| --- | --- |
| `GET /judge/login` | 200 real minimal HTML with password entry, submit, safe error text, session/remaining status and logout. It performs session GET and POST/DELETE via same-origin fetch. Valid submission clears the password field and navigates to `/`, creating a fresh normal game/config document; no client success simulation. Missing prerequisites can be displayed as unavailable without revealing internals. HTML is no-store. |
| `GET /` | Anonymous: 303, `Location: /judge/login`, no-store and clear invalid cookie. Active: serve the existing `ASSETS.fetch(request)` document. Storage failure: unavailable 503, no game/auth bypass. |
| `POST /api/judge/session` | Require same Origin, then JSON media type `application/json` (optional UTF-8 charset only), fatal UTF-8 and actual body size at most 256 bytes. Decoded object is exactly `{version:'judge-login-v1',code:string}`. Unknown fields/version/type or noncanonical code give malformed 400; oversized bytes give 413; correctly shaped but wrong secret gives invalid-code 401. Valid code returns active 200 and session cookie, creating or reusing a session. No model. |
| `GET /api/judge/session` | 200 exact anonymous/active wire. Missing, duplicate same-name, noncanonical, unknown, revoked, expired or old-code-epoch cookie is anonymous; clear invalid cookie. No model/reservation. Unavailable required configuration/storage returns portal unavailable 503. |
| `DELETE /api/judge/session` | Require same Origin; revoke the recognized current token, then 204 empty body, no-store and clearing cookie. Missing/invalid token still gives 204 and clear; RPC failure gives 503, never falsely claims successful revocation. Never refunds a day count. |
| `GET /api/decision/config` | Original exact `{version:'decision-config-v1',enabled:boolean,session_cap:number}`. With usable required configuration, anonymous or exhausted session returns 200/enabled false/cap 0; active usable session returns enabled true and `min(session_remaining,daily_remaining)`. Invalid/missing judge configuration returns original disabled 503; storage failure returns original unavailable 503. GET reserves nothing. |
| `POST /api/decision` | Original closed request/success/error only. Anonymous/expired/old epoch or rejected same-Origin/cross-site request: disabled 503. After original validation, application exhaustion: rate_limited 429; storage failure: unavailable 503. No portal error envelope is substituted here. |

Require `Origin === new URL(request.url).origin` on both portal state changes and model POST; reject missing/`null`/different Origin and explicit `Sec-Fetch-Site: cross-site`. Fetch Metadata is additional CSRF assistance, not identity; absent metadata with valid Origin is permitted. Unsupported methods retain their route's 405 before CSRF checks. Invalid JSON/media type/content/UTF-8 is malformed 400. Do not trust Content-Length instead of counting streamed bytes.

Portal envelopes are closed at every object level; no additional keys:

```ts
type JudgeError = {
  version: 'judge-error-v1';
  error: { kind: 'malformed_request' | 'payload_too_large' |
    'invalid_code' | 'forbidden' | 'not_found' |
    'method_not_allowed' | 'unavailable' };
};
// Status respectively: 400, 413, 401, 403, 404, 405 (with Allow), 503.
type Quota = {
  utc_day: string;              // real Gregorian YYYY-MM-DD, DO UTC clock
  reset_at_ms: number;          // next UTC midnight, nonnegative safe integer
  daily_limit: 40; daily_remaining: number;     // integer 0..40
  session_limit: 10; session_remaining: number; // integer 0..10, lifetime
};
type JudgeSession =
  | { version:'judge-session-v1'; state:'anonymous';
      expires_at_ms:null; quota:null }
  | { version:'judge-session-v1'; state:'active';
      expires_at_ms:number; quota:Quota }; // nonnegative safe epoch-ms integer
```

Original Decision wire remains the definitions/validators in `web/src/shared/decision.ts`, not a new schema: request has exactly `version,family,mapping_version,mapping_hash,question_id,metadata,state,instructions,criteria`; success has exactly `version,choice,model,mapping_version,mapping_hash,fingerprint,usage,session_cap`; config has the three fields above; error is exactly `{version:'decision-error-v1',error:{kind}}`. Original error/status enumeration is `malformed_request` 400, `not_found` 404, `method_not_allowed` 405, `payload_too_large` 413, `model_error`/`invalid_response` 502, `disabled`/`unavailable` 503, `quota`/`rate_limited` 429. Provider Response 429 remains rate_limited; other non-200 or thrown native errors remain model_error; invalid native output remains invalid_response. `quota` is reserved for confirmed provider quota semantics, never inferred from application counts or unverified provider messages.

### 3. Credentials, cookies and rotation

Generate the shared code and each session token independently with 32 cryptographically random bytes. Encoding is canonical unpadded base64url, exactly 43 ASCII characters, case-sensitive and not trimmed; decode/re-encode equality is required (not merely a character regex). Compare the submitted code with the secret without credential-bearing diagnostics. Store the code in a repository-external private 0600 file, set `JUDGE_CODE` by stdin, and report only its file location. No secret values enter argv/tool arguments, URLs, Git, README, logs or artifacts. Automation accepts a private file path and reads its contents inside its own process; login bodies and Cookie/Set-Cookie are dropped/redacted before any evidence recorder runs.

Cookie name is `__Host-bif_judge`, with `Secure; HttpOnly; SameSite=Strict; Path=/`, no Domain. Use `Expires` equal to the DO's whole-second `expires_at_ms` (UTC HTTP-date); omit competing Max-Age. The finite configured TTL is 86400 seconds; compute `floor(now_ms/1000)*1000 + ttl_seconds*1000`, so actual life does not exceed TTL. On reuse, retain the same token and exact expiry. Clearing uses the same attributes, empty value and an expired date. No cookie/token in localStorage/sessionStorage. Do not regard code possession as a personal reviewer identity: anyone holding it can open a new session, but cannot bypass the shared daily pool.

Compute `code_epoch = SHA256(current canonical JUDGE_CODE ASCII bytes)` in the Worker and pass only that hash to DO operations. Sessions store this high-entropy epoch hash, never plaintext. Rotation changes epoch: status/create-reuse/reserve reject old-epoch sessions and clear the old cookie. The code hash is internal, not returned to clients or logged; it is not a second secret setting. To contain a leaked code, disable inference, replace the private file/Worker Secret, confirm old-cookie rejection, then re-enable the same Worker/namespace; do not delete/recreate counters or add a quota reset endpoint. An already dispatched native call cannot be recalled; no old alias/version retaining the previous secret is left accessible.

### 4. JudgeGate RPC and SQLite state

Internal RPC surface (not HTTP routes), with hashes exactly 64 lowercase hex characters:

```ts
status(token_sha256:string|null, code_epoch:string): Promise<JudgeSession>;
open(candidate_sha256:string, existing_sha256:string|null, code_epoch:string):
  Promise<{session: Extract<JudgeSession,{state:'active'}>; reused:boolean}>;
revoke(token_sha256:string|null): Promise<void>;
reserve(token_sha256:string, code_epoch:string): Promise<
  | {kind:'admitted'; quota:Quota}
  | {kind:'anonymous'}
  | {kind:'rate_limited'; quota:Quota}
>;
```

Worker creates a fresh candidate token before `open`; DO returns `reused:true` only for a still-valid matching-epoch existing session, so Worker sets that existing token instead. A collision with an existing candidate hash fails unavailable rather than resetting a row. DO owns time and validated limit/TTL configuration; clients cannot supply time, counters or limits. RPC rejection is unavailable; do not retry ambiguous admissions. Wire quota is a snapshot, not a promise/reservation.

Exactly two tables, initialized idempotently in constructor storage setup; `code_epoch` is the additional rotation field:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  token_sha256 TEXT PRIMARY KEY,
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms >= 0),
  admitted INTEGER NOT NULL DEFAULT 0 CHECK(admitted BETWEEN 0 AND 10),
  code_epoch TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily (
  utc_day TEXT PRIMARY KEY,
  admitted INTEGER NOT NULL DEFAULT 0 CHECK(admitted BETWEEN 0 AND 40)
);
```

`open`/status/revoke and reserve each use short synchronous storage operations; use `storage.transactionSync` whenever their related reads/writes need one snapshot. For reserve: read matching session and epoch, enforce `expires_at_ms > Date.now()`, derive current UTC day, read daily row (missing means zero), compare both counts with configured caps, and on success increment session `admitted` and insert/update daily `admitted` in **one** transactionSync. Denial writes neither count. There is no await/AI/network inside the SQL transaction. A new UTC-day key resets only daily allowance, never session admitted. Logout/expiry can remove a session row, never current-day daily counts. No third session-daily table, midnight reset job, production admin/reset route or in-memory quota authority. Preserve Worker/class/namespace/pool identity across deployment and repair.

Successful reserve is permanently spent for this allowance even if provider errors, browser disconnects or crashes occur. Reserve-before-dispatch crashes are recorded as admissions without confirmed dispatch, not actual AI calls. No cross-system exactly-once/provider-quota reservation is claimed. Author validation accounting uses observed native dispatch; local launcher/CI failures before sending are not model calls. If dispatch is ambiguous, inspect retained evidence before any resend; never assume it was zero. Other account usage can consume Cloudflare's shared neuron allowance; the application cap and 16KiB transport policy do not guarantee exact token/neuron cost or availability.

## Data Models: Profiles, Env and checked manifest

### Closed judge profiles and pinned types

Add `worker-api/judge.jsonc` with exactly these top-level/nested fields (JSONC schema field uses the existing convention):

```json
{
  "$schema":"../web/node_modules/wrangler/config-schema.json",
  "name":"back-in-the-family-judge", "main":"./src/judge.ts",
  "compatibility_date":"2026-11-10", "send_metrics":false,
  "workers_dev":true, "preview_urls":false,
  "assets":{"directory":"../web/dist","binding":"ASSETS",
    "run_worker_first":["/","/api","/api/*","/judge/login"],
    "not_found_handling":"single-page-application"},
  "ai":{"binding":"AI","remote":false},
  "vars":{"INFERENCE_ENABLED":"true","MAX_REQUEST_BYTES":"16384",
    "SESSION_CAP":"10","JUDGE_DAILY_CAP":"40",
    "JUDGE_SESSION_TTL_SECONDS":"86400"},
  "durable_objects":{"bindings":[{"name":"JUDGE_GATE","class_name":"JudgeGate"}]},
  "exports":{"JudgeGate":{"type":"durable-object","storage":"sqlite"}}
}
```

`judge-hosted.jsonc` has the same closed shape plus `no_bundle:true`, with main `../target/judge-worker/worker.js`; no `migrations`, custom build, remote binding, preview aliases, routes or secrets. A prechecked disabled bootstrap config is emitted at `target/judge-worker/deploy-disabled.jsonc`: same semantic profile except inference false and relative paths resolved for that directory (`main:'./worker.js'`, assets `'../../web/dist'`, schema `'../../web/node_modules/wrangler/config-schema.json'`), with `no_bundle:true`. Check both variants before use; do not mutate an unchecked config at deployment. Final source/hosted profile is enabled only when installed prerequisites allow the gate.

Use the existing strict count parser; required daily/session caps must equal the Author grant, byte cap the existing policy, and TTL the configured value above; missing/invalid/whitespace/fraction/exponent/truthy/default values fail closed. Allow only explicit boolean/string true/false for inference. Regenerate `JudgeBindings` with pinned Wrangler into `judge-configuration.d.ts`; define `JudgeEnv = JudgeBindings & {JUDGE_CODE?:string}` and require canonical secret at runtime. Native `Ai`, `Fetcher` and `DurableObjectNamespace<JudgeGate>` come from generated SDK types, never handwritten substitutes. Split the pinned generator output at its observed `// Begin runtime types` marker: one checked `runtime-configuration.d.ts` holds the shared runtime body, and generic/judge binding declarations retain their own generated pre-marker headers. The wrapper compares regenerated binding headers and shared runtime bytes exactly (apart from the existing invocation-comment normalization); it rejects a missing/ambiguous marker or unequal runtime bodies. Both app type projects include the same shared runtime declaration and only their own binding/global metadata header. Generic `tsconfig.json` explicitly selects index/handler/http, not every judge entry; judge `tsconfig.judge.json` selects judge/gate/handler/http. Separate `tsconfig.judge.node.json` covers judge helpers/tests without merging generic and judge `Cloudflare.GlobalProps.mainModule` declarations; generic node checks exclude those judge-only roots. This avoids the two generated Env/global headers colliding while retaining one pinned runtime prelude; no SDK/tool upgrade or generated declaration body is hand-edited.

Preserve Node v26.7.0, pnpm 10.33.1, Wrangler 4.157.0, Miniflare 5.20261103.0-beta, workerd 1.20261103.1, esbuild 0.28.2 and compatibility date 2026-11-10. Reuse `assertWorkerTools`, existing source profile/bundle checks and runtime converter. Judge bundle is `target/judge-worker/worker.js`, with `{version:1,bundle:SHA256,sources:Record<relativePath,SHA256>}` build stamp; source list covers judge entry/gate/http/handler and the two shared Decision contract files. Generic stamp also adds any extracted HTTP dependency without changing its version/shape.

### Independent Judge_Manifest: complete closed shape

`target/judge-worker/judge-manifest.json` is **not** generic public provenance, and does not add keys to the old nine-key record. Reuse existing `ReleaseIdentity`, `ArtifactFile`, `jsonBytes`, regular-file/closed-tree/private-content guards and `verifyArtifactInputs` to verify the upstream transport/source/license/assets. Reuse `validateSdkLock`/`selectSdkLock` and existing SDK/native proof, not a second license/provenance/Cargo dependency resolver.

```ts
type SHA256 = string; // exactly 64 lowercase hex characters
type File = {path:string; size:number; sha256:SHA256};
// File uses existing ArtifactFile validation: safe relative regular-file path,
// nonnegative safe integer byte size, exact digest, no symlinks or extra keys.
type JudgeManifest = {
  version:'judge-artifact-v1';
  identity: {sourceCommit:string; runId:string; runAttempt:string};
  upstream: {
    identity:{sourceCommit:string; runId:string; runAttempt:string};
    artifactId:string; archiveSHA256:SHA256; envelopeSHA:SHA256;
  };
  worker:File;
  configs:{source:File; hosted:File; disabled:File};
  assets:File[]; assetsSHA256:SHA256;
  wasm:{source:File; assetPath:string};
  sources:{digests:Record<string,SHA256>; sha256:SHA256};
  sdk:{
    toolchain:{node:'v26.7.0'; pnpm:'10.33.1'; wrangler:'4.157.0';
      miniflare:'5.20261103.0-beta'; workerd:'1.20261103.1'; esbuild:'0.28.2'};
    healthyLock:File; deployPackage:File; deployLock:File;
    runtimeTypes:File; judgeTypes:File;
    graphSHA256:SHA256;
    schema:{path:string; sha256:SHA256};
  };
  exports:{default:'fetch'; JudgeGate:{type:'durable-object';storage:'sqlite'}};
  bindings:{AI:'AI'; ASSETS:'ASSETS';
    JUDGE_GATE:{class_name:'JudgeGate';pool_name:'review-pool-v1'};
    secretNames:['JUDGE_CODE']};
  policy:{maxRequestBytes:16384;loginRequestBytes:256;
    dailyLimit:40;sessionLimit:10;sessionTtlSeconds:86400;
    workerFirst:['/','/api','/api/*','/judge/login'];previewUrls:false};
};
```

Every object is exact-key, every array has its prescribed inventory/order, and omitted/extra fields reject. Existing `validateIdentity` rules apply: sourceCommit lowercase 40-hex, runId positive decimal CI ID or `local`, runAttempt positive decimal (`local` attempt is 1); upstream artifactId is a positive decimal CI artifact ID, or `local` only in local fixture/proof, never remote deploy. Judge check run identity may differ from upstream run identity, but source commits must be equal. Trusted context supplies both identities, artifact ID, authenticated archive SHA, independently bound envelope SHA and final manifest SHA; self-asserted JSON cannot establish trust. Local archive/digest fixtures are labeled local and cannot satisfy remote identity.

Fixed paths: worker `target/judge-worker/worker.js`; configs `worker-api/judge.jsonc`, `worker-api/judge-hosted.jsonc`, `target/judge-worker/deploy-disabled.jsonc`; WASM source `target/wasm-pkg/sim_wasm_bg.wasm`; SDK healthyLock `web/pnpm-lock.yaml`, deployPackage/deployLock `worker-api/artifact-deploy/{package.json,pnpm-lock.yaml}`, runtimeTypes `worker-api/runtime-configuration.d.ts`, judgeTypes `worker-api/judge-configuration.d.ts`. `sdk.schema.path` is `wrangler/config-schema.json` relative to the installed package resolved by existing `requireTools`, never a host fallback. schema digest equals upstream checked schema digest. `graphSHA256 = digest(jsonBytes(selectSdkLock(healthyLockText,deployPackageText)))`; validate exact deploy-lock document against that existing selection.

`assets` is the complete lexicographically sorted `web/dist` inventory, with paths relative to that directory; no additions/omissions/symlinks. `assetsSHA256 = digest(jsonBytes(assets))`; inventory must equal upstream checked assets, and exactly one asset WASM has the source WASM digest/size and `wasm.assetPath`. Reuse existing asset/license/WASM/import/private-content guards, keeping Rust behavior and asset bytes from the exact gate run.

`sources.digests` is the verified upstream `CheckedInputs.sourceDigests` union the following committed regular files (deduplicate keys, sorted lexicographically): `worker-api/judge.jsonc`, `worker-api/judge-hosted.jsonc`, `worker-api/judge-configuration.d.ts`, `worker-api/worker-configuration.d.ts`, `worker-api/runtime-configuration.d.ts`, `worker-api/tsconfig.judge.json`, `worker-api/tsconfig.judge.node.json`, `worker-api/tsconfig.node.json`, `worker-api/scripts/{profile,wrangler,bundle,typecheck,tools}.ts`, `worker-api/tests/helpers/{runtime,judge-runtime,decision}.ts`, `worker-api/tests/judge/{unit,runtime,artifact}.test.ts`, `scripts/judge-gates.sh`, `scripts/check-judge-artifact.ts`, `.github/workflows/deploy.yml`, `.github/workflows/deploy-judge.yml`. All judge runtime source files are already included by the upstream `worker-api/src` closed walk. Expose/reuse the existing checked-source helper with an additional-paths input whose default remains unchanged, comparing this fixed additional inventory with blobs at the trusted sourceCommit; do not introduce another Git/source/license/Cargo resolver or expand generic provenance keys. `sources.sha256 = digest(jsonBytes(digests))`. Generic source input pins include the shared generated runtime when splitting its declaration. Generated bootstrap config and bundle are output digests, not claimed source blobs. The new checker is included in its own committed source inventory.

The artifact checker validates actual native bundle default fetch and JudgeGate export via pinned offline runtime/SDK loading, schema-supported SQLite binding conversion, exact profiles/policy, source/build stamp, SDK graph and every file digest. It reuses `currentStaticDeployment` to keep the original workflow/config byte guard, not a weaker parallel interpretation. Produce a fresh manifest for any repaired code/config and use the matching independently recorded manifest SHA; no stale checked revision promotion.

## Controlled CI, Resource and Secret Lifecycle

Add `.github/workflows/deploy-judge.yml`, triggered by completion of the existing `deploy` workflow. Accept only successful push/main runs of `zbf1009/back-in-the-family`, exact workflow path, repository/head repository, trusted commit, run ID/attempt and immutable checked-artifact ID/name. Reject fork/PR/manual or mismatched events and stale head before activating an older release. Obtain the immutable artifact's `digest` (`sha256:<64 lowercase hex>`) from authenticated GitHub artifact metadata for that exact producer run/ID, hash the downloaded archive before extraction and fail closed on absent/mismatched digest. Read/hash `inputs.json` only from that authenticated, digest-verified archive, binding the expected envelope SHA passed to existing `verifyArtifactInputs`; a digest merely asserted inside unverified artifact JSON is insufficient. This avoids assuming cross-workflow job outputs are retrievable or changing the static producer workflow. Check out that exact source with persisted Git credentials disabled; do not run arbitrary event/ref-provided scripts. Use SHA-pinned actions consistent with existing workflow, read-only contents/actions permissions, and a separate serial judge-deploy concurrency group with cancel-in-progress false.

Credential-free checks verify the upstream transport using the existing verifier, restore its exact checked assets and WASM, run judge type/pure checks, build with pinned native Wrangler offline, then run judge runtime/artifact checks and record the final manifest SHA. New judge runtime suites live under `tests/judge/`, not the existing generic pre/post-build globs; they run only after Judge_Build and restored/built Web assets. An unbuilt judge bundle must not break the original static workflow. Reuse prepared dependency and offline namespace tooling; do not weaken static guards or publisher conditions.

The deploy job consumes the exact judge-check job artifact ID, manifest SHA, upstream identity and checked source; verify again without rebuild in the credential-free checker step. Only its scoped deployment step receives existing authorized Cloudflare account/token environment credentials. Existing repository Cloudflare credentials may be reused for this named target; they do not appear in client, code, config/manifest or checker/runtime process. Do not put JUDGE_CODE in the workflow artifact or upload it on every CI run: initial installation/rotation uses the external private file and scoped stdin secret operation. CI requires the named Worker Secret to be installed, preserves it and the DO namespace, and fails closed if not available.

Before first remote write, use existing authentication and exact-target ownership/non-overwrite checks; if the Worker/namespace exists unexpectedly or belongs to someone else, stop rather than overwrite. Record owned Worker/class/namespace identity. Deploy the checked disabled variant first to provision SQLite export/binding; install secret by stdin while inference remains false; confirm intended bindings/secret presence and disabled native config, then deploy the checked enabled hosted variant. Secret setting can itself create/deploy a version, so no unsafe enabled bootstrap is allowed. Keep previews/version URLs off throughout. Each later scoped repair preserves namespace/class/pool and counters; reruns are covered by the same grant.

Temporary fixtures, browsers, runtime homes and transient deployment-auth files are removed after use. Retain the repository-external 0600 reviewer-code file for the Author's confirmed private handoff; report only its location. Retain the reviewer Worker, DO and Worker Secret after success. Incomplete/unsafe releases disable inference on the same resource while repairing; no automatic C4 watchdog/15-minute destroy, session quota refund or namespace recreation. Any code rotation revokes old epochs without restoring daily allowance. Changes outside the Author grant or budget/goal ambiguity go to the Author; ordinary launcher/CI/API failures are repaired within scope.

## Correctness Properties

### Property 1: No native dispatch without valid atomic admission

Any native Judge dispatch has exactly one prior successful reserve for a valid, unexpired, matching-epoch session; auth/method/CSRF/body/validation denial and failed RPC dispatch zero times. At most one competing request can consume the final slot in either dimension. Admission may conservatively exist without a dispatch, never the reverse.

**Validates: Requirements 1.4, 2.3, 2.6, 2.7, 3.3–3.6.**

### Property 2: Counters survive lifecycle operations

Daily admitted is bounded by the grant across all sessions; session admitted is bounded for its lifetime. Midnight changes only the day key. Refresh/relogin/restart/redeploy cannot restore allowance; logout, expiry and code rotation do not refund current-day admissions.

**Validates: Requirements 2.4, 2.5, 2.7, 3.1, 3.2, 3.5.**

### Property 3: Only exact checked, credential-free bytes are publishable

Trusted identities and independently supplied digests bind judge code/config/exports/SDK/schema and complete assets to the successful source gate run. Any changed source/output/field/binding or untrusted artifact rejects activation, while generic/static/publisher protections remain unchanged.

**Validates: Requirements 2.1, 4.1–4.5.**

## Error Handling

Portal and Decision envelopes remain separate as specified above. Route/method/CSRF/body/auth failures are safe observable outcomes, not model attempts. Configuration failure is disabled/unavailable, never an enabled fallback; storage failure is unavailable and cannot become a permissive anonymous or admitted result. A provider exception is not a DO failure; original native classifications and projection remain intact. Known failure evidence is retained without rerunning merely to reconfirm it; code/config repairs generate new proof and identity. Reservations are never silently refunded, validation dispatches are never relabeled, and model response/raw credential content is not logged.

## Testing Strategy

- Pure tests: exact portal fields/status enumeration and original Decision validator compatibility; canonical code/token/cookie parsing including duplicate cookie, invalid UTF-8 and streamed oversize; same-Origin/cross-site/method checks; missing/invalid configuration and credential redaction. No generated app/bundle prerequisite.
- Post-build workerd/SQLite tests: actual checked judge bundle/native-shaped isolated fake through existing converter/outbound deny hook; default fetch/JudgeGate exports; anonymous/invalid/expired/old-epoch/CSRF/malformed/oversize requests dispatch zero, valid native request exactly one fake dispatch. Fixtures explicitly allow only intended JUDGE_GATE SQLite binding and fixture AI, not production fake fields/routes.
- Persistence/concurrency: session and global remaining-one races, rejected requests leave both counts unchanged; reopen the same owned SQLite persistence directory/reload bundle and prove counts survive; injected fixture time across UTC midnight preserves session lifetime admitted; refresh/relogin retain expiry/count, logout revokes, rotation rejects old cookie while daily count stays unchanged. Use local SQL/time/native fixtures for exhausted counters, provider failure and reserve-before-dispatch crash; never exhaust the live pool to test boundaries and never ship reset/time-control endpoints.
- Artifact negatives: extra/missing manifest fields, wrong identity/artifact/envelope, source/config/bundle/assets/WASM/schema/SDK/graph/type digest mutations, missing root/API worker-first, incompatible migrations/exports, unknown bindings, missing secret prerequisites and missing default/Gate exports. Reuse generic Decision/core/replay/source-separation/static byte guards at the affected surface; tests needing assets/bundles run after builds.
- Live bounded proof: deployed unauthenticated/root/API and Public_Game probes dispatch zero; privately authenticate through the real page, observe actual cookie/game config, run a held native decision and export actual replay v5. Audit with the current already-supported `audit-replay` native interface, recording command/exit, input SHA, auditor SHA and applied/default classification. Save only safe statuses, normalized outcomes/usage/byte counts and replay association; no code/login body/cookies/raw provider response. Count observed dispatches against the single Author-grant validation budget, also recording admissions separately. Continue scoped repair/verification while budget remains; remaining budget is not a requirement to spend every call.
- Final proof identifies the safe reviewer URL, private code-file location only, deployed source/run/manifest/Worker/namespace identity, native replay/audit, actual reservation/dispatch/provider-usage limits, remaining budgets, unchanged public behavior and temporary cleanup. Successful reviewer resources deliberately remain available for ordinary authorized use. Return this result for the one final Spec review checkpoint.
