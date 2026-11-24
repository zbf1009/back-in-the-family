# Requirements Document

## Introduction

This standalone release Spec makes the existing native Clef game available to reviewers through a private-code portal while preserving the public rules-only game. It is not a numbered successor UI Spec and does not reopen completed `slow-think` checkpoints. Current state: implementation and publication completed by the execution session; final Spec review **PASS** for source `1701d2df26ede28c2a5ed422a6dbff0fcd7845dd`. See the [final acceptance record](../../../docs/kiro-log.md#judge-demo-release-final-spec-acceptance). The original Author grant below remains the release boundary.

**Current public continuation:** the separate [slow-think public deployment grant](../slow-think/requirements.md#permanent-public-deployment-author-grant) has verified tasks 10.1–10.3: permanent generic default-off artifact/button, actual import/build/UI/bytes/native AI/ASSETS and owned-copy cleanup, with **0 new model dispatches / 0 judge calls**. Its successful import-source main/static/publisher `45326300030/1` and judge `45328839414/1` are continuation CI identities, **not replacements for this Spec's accepted `1701d2…` identity or model/replay evidence**. The reviewer Worker, stable namespace/pool, Secret and counters remain retained; 40/UTC-day, 10/session-lifetime and TTL 86400 are unchanged, with no newly measured balance equality. The original grant below did not authorize publisher/button changes; the later public grant did, without extending the judge grant or allowance. **Public 10.4 is execution-complete**: documentation source `b152d6fc81d26731c84ab759aea007cdcabb72e8` published with successful observed main/static/publisher `45354247253/1` and judge `45357996605/1`. Public execution is ready for **final Spec 7 review, acceptance pending**, within [the public audit's review scope](../../../docs/slow-think-audit.md#permanent-public-delivery), not a reopened judge acceptance or B/text implementation grant. The next status-only closure source/CI tuple comes from Main's final handoff.

### Author grant

The actual Author selection is `implement_and_publish`, with `private_channel_confirmed`. Approved budgets are **40 application admissions per UTC day across the reviewer pool**, **10 admissions per session lifetime**, and **5 real validation model dispatches total**. Validation dispatches also spend the application pool/session allowance; they cannot be renamed reviewer calls to evade the validation budget. The public game has a zero-model-call policy. Session means possession of an opaque browser token, not a named reviewer; the Author privately delivers the shared code.

This one grant covers owned local implementation/repairs and commits, source push to `zbf1009/back-in-the-family` `main`, its existing green-main static deployment, the new `back-in-the-family-judge` Worker, SQLite `JudgeGate` / `JUDGE_GATE`, `JUDGE_CODE` Worker Secret, a dedicated judge workflow/config, scoped deployment, native/browser validation, and repairs or CI/deploy reruns until the goal is achieved or the real validation budget is exhausted. Existing authentication may be reused. Exact-target ownership/non-overwrite checks remain required; account/token-policy/old cleanup audits are not repeated. No new per-command approval is needed.

Preserve Rust core, WASM behavior, mapping/fingerprint, replay v5 and original C1–C5 evidence. Generic Worker/candidate inference stays false; the static workflow and its byte guard stay unchanged; both publisher guards, permanent artifact ref and README Deploy button stay off. No paid upgrade, expanded account system/Cloudflare Access, new gameplay, presentation model, B artwork, refund/retry framework or toolchain upgrade is included. Pause only for an exhausted validation budget with the goal incomplete, a genuinely ambiguous goal, an unapproved resource/effect, or an unavailable Author-owned credential/decision. Otherwise repair and continue; final release results return for Spec review.

## Glossary

- **Public_Game**: the existing assets-only, rules-based production site.
- **Judge_Demo**: the separate gated Worker serving the existing game and its native Decision handler.
- **Judge_Session**: a finite-lived opaque cookie token, represented only by its SHA-256 in persistent storage.
- **Judge_Pool**: the one stable SQLite Durable Object selected by `review-pool-v1`.
- **Admission**: an atomic, conservatively spent application slot reserved immediately before native model dispatch; not a provider-metered call or neuron fact.
- **Author_Grant**: the scope, effects and budgets above, continuously valid until delivery or an actual boundary is reached.
- **Judge_Manifest**: the independent closed `judge-artifact-v1` checked release record, not an extension of generic nine-key public provenance.

## Requirements

### Requirement 1: Playable private reviewer entry without changing the game

**User Story:** As a reviewer holding the privately supplied code, I want to enter the existing game and request native decisions without registering an account, so that I can evaluate the actual demo.

#### Acceptance Criteria

1. THE Public_Game SHALL remain playable with its existing rules-only behavior and no model dispatch.
2. WHEN a visitor navigates to Judge_Demo root without a valid session, THE Judge_Demo SHALL redirect to a real login page; WHEN the session is valid, it SHALL serve the existing game.
3. WHEN a reviewer supplies the valid private code through the login page, THE Judge_Demo SHALL establish or reuse a session and navigate to a fresh game document whose original Decision config is read normally.
4. THE Judge_Demo SHALL gate every model-capable path and accessible deployment alias, including direct API requests; static JS/CSS/WASM are not treated as secrets.
5. THE Judge_Demo SHALL preserve original Decision request/success/error contracts, native Clef transport, mapping/fingerprint, held-decision behavior and replay v5; it SHALL introduce no new game rule or client-side model substitute.

### Requirement 2: Private, finite and observable session lifecycle

**User Story:** As the Author, I want reviewers to authenticate with a private code and receive a protected, expiring session, so that neither deployment credentials nor reviewer tokens become public.

#### Acceptance Criteria

1. THE Judge_Demo SHALL keep the shared code and session tokens out of URLs, Web Storage, repository content, artifacts and evidence; session tokens SHALL be retained client-side only in the protected HttpOnly cookie, and deployment control credentials SHALL never reach the client.
2. WHEN login/session/logout requests are processed, THE Judge_Demo SHALL return exactly the versioned portal fields, statuses and headers defined in design, without echoing credentials or internal exceptions.
3. WHEN a cookie is absent, duplicate, noncanonical, unknown, revoked or expired, THE Judge_Demo SHALL treat it as anonymous, clear an invalid cookie and allow no model dispatch.
4. WHEN login is repeated with a valid cookie and valid code, THE Judge_Demo SHALL reuse that session without extending expiry or resetting its lifetime admission count.
5. WHEN logout completes, THE Judge_Demo SHALL revoke the token and clear its cookie without refunding the current UTC-day pool; expiry SHALL be enforced consistently by cookie and storage.
6. WHEN a state-changing request lacks the same Origin or explicitly indicates cross-site Fetch Metadata, THE Judge_Demo SHALL reject it without model dispatch; Origin SHALL not be treated as reviewer identity.
7. WHEN the shared code is rotated, THE Judge_Demo SHALL reject sessions issued under the previous code without resetting or recreating the current UTC-day pool; newly authenticated sessions SHALL remain constrained by that same pool.

### Requirement 3: Persistent shared and session-lifetime admission

**User Story:** As the Author, I want the approved application limits enforced by the server across requests and redeploys, so that refresh, concurrency and midnight cannot spend an unapproved allowance.

#### Acceptance Criteria

1. THE Judge_Pool SHALL enforce the Author_Grant daily allowance across all sessions and its session allowance across each session's entire lifetime, using server time and one stable storage identity.
2. WHEN UTC day changes, THE daily allowance SHALL become that new day's allowance while each surviving session's lifetime count remains unchanged; refresh, login, restart and redeploy SHALL not reset counters.
3. WHEN one valid request is admitted, THE Judge_Pool SHALL atomically consume one slot in both counts only after original Decision validation/native-input construction and immediately before native `AI.run`.
4. WHEN either remaining allowance is zero, THE original Decision error SHALL be `rate_limited` / 429; WHEN storage/admission is unavailable, it SHALL be `unavailable` / 503 and fail closed. Application exhaustion SHALL not claim provider `quota` exhaustion.
5. WHEN competing requests contend for the last shared or session slot, THE Judge_Pool SHALL admit at most one and leave both counts unchanged for rejected requests.
6. WHEN dispatch fails, produces invalid output, disconnects or cannot be confirmed after reserve, THE Admission SHALL remain conservatively spent without refund or ambiguous-RPC retry; evidence SHALL distinguish admission from observed model dispatch and provider usage.

### Requirement 4: Independent checked judge release

**User Story:** As the maintainer, I want the deployed judge code, assets, bindings and SDK checked together, so that publication cannot silently select stale or generic disabled artifacts.

#### Acceptance Criteria

1. THE Judge_Demo SHALL have an independent Env, bundle, source/hosted profiles and Judge_Manifest, with a closed checked identity and complete source/config/bundle/assets/WASM/SDK/schema digests and declared exports/bindings.
2. THE Judge_Manifest SHALL exclude secret values and preserve the existing generic provenance shape, generic disabled configuration, static byte guard and publisher guards.
3. WHEN judge artifacts are built or deployed, THE checked source, pinned SDK/runtime and exact successful source-main gate-run assets SHALL agree; stale bytes, extra fields, missing exports or mismatched identity SHALL reject publication.
4. THE dedicated judge deployment SHALL consume exactly the already checked bundle/assets/config without rebuilding them at deploy time or trusting fork/unpinned workflow-run artifacts.
5. WHILE any gate, secret or required limit/configuration is missing or unsafe, THE Judge_Demo SHALL keep inference disabled and fail closed.

### Requirement 5: Real verification and durable reviewer availability

**User Story:** As the Author, I want a working deployed native demo with safe proof and ongoing reviewer availability, so that successful self-testing delivers a usable release rather than another disposable trial.

#### Acceptance Criteria

1. THE local verification SHALL prove portal and Decision authentication/validation, atomic final-slot concurrency, session lifecycle, SQLite restart persistence and UTC rollover versus session-lifetime accounting without real model calls.
2. THE verification SHALL exercise actual workerd and SQLite storage with native-shaped fake AI only inside isolated test fixtures; boundary quota fixtures SHALL expose no production reset/admin/fake-quota endpoint.
3. THE deployed verification SHALL prove actual browser login, existing game/config, held native decision, actual v5 export and the current native replay audit within the Author_Grant total validation budget; unauthenticated judge probes and Public_Game use SHALL dispatch no model.
4. THE release evidence SHALL preserve original C1–C5 evidence, identify the checked/deployed revision and distinguish reservation, observed dispatch, normalized provider usage, native application and unknown metering; login body, cookies and secrets SHALL be omitted/redacted before persistence.
5. WHEN verification succeeds, THE reviewer Worker, its stable DO/counters and Worker Secret SHALL remain available; temporary test browsers/files SHALL be cleaned. WHEN deployment is incomplete or the gate is unsafe, inference SHALL be disabled while scoped repair continues, not counters reset or the reviewer deployment automatically destroyed.
6. THE final release report SHALL provide the safe reviewer URL, private credential-file location only, deployed identity, remaining budgets and actual proof for Spec review, without claiming unobserved implementation or publication success.
