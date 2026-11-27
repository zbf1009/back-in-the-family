import { configuredCount, failure, handleRequest, json } from './handler.ts';
import { readRequest } from './http.ts';
import { JudgeGate } from './judge-gate.ts';
import type { JudgeEnv } from './judge-gate.ts';
import type { JudgeOpen, JudgeReservation, JudgeRPC, JudgeSession, Quota } from './judge-contract.ts';
import { decisionObject, isDecisionCount, PROJECT_REQUEST_BYTE_CAP } from '../../web/src/shared/decision.ts';
import { handleObituaryPost, obituaryCapability, obituaryFailure } from './obituary.ts';
import type { ObituaryAI } from './obituary.ts';

export { JudgeGate };

const COOKIE_NAME = '__Host-bif_judge';
const COOKIE_ATTRIBUTES = '; Secure; HttpOnly; SameSite=Strict; Path=/';
const CLEAR_COOKIE = COOKIE_NAME + '=' + COOKIE_ATTRIBUTES + '; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
const encoder = new TextEncoder();
const PORTAL_STATUS = {
  malformed_request: 400, payload_too_large: 413, invalid_code: 401, forbidden: 403,
  not_found: 404, method_not_allowed: 405, unavailable: 503,
} as const;
type JudgeErrorKind = keyof typeof PORTAL_STATUS;

function portalFailure(kind: JudgeErrorKind, allow?: string): Response {
  return json({ version: 'judge-error-v1', error: { kind } }, PORTAL_STATUS[kind], allow);
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function canonical(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='), character => character.charCodeAt(0));
  return bytes.length === 32 && base64url(bytes) === value;
}
async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
function cookie(request: Request): { token: string | null; present: boolean } {
  const values: string[] = [];
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    const name = (separator < 0 ? part : part.slice(0, separator)).trim();
    if (name === COOKIE_NAME) values.push(separator < 0 ? '' : part.slice(separator + 1));
  }
  return { token: values.length === 1 && canonical(values[0]) ? values[0] : null, present: values.length > 0 };
}
function clearInvalid(response: Response, present: boolean, session: JudgeSession): Response {
  if (present && session.state === 'anonymous') response.headers.set('Set-Cookie', CLEAR_COOKIE);
  return response;
}
function sameOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin
    && request.headers.get('Sec-Fetch-Site')?.toLowerCase() !== 'cross-site';
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return decisionObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validQuota(value: unknown): value is Quota {
  if (!exact(value, ['utc_day', 'reset_at_ms', 'daily_limit', 'daily_remaining', 'session_limit', 'session_remaining'])
    || typeof value.utc_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.utc_day)
    || !isDecisionCount(value.reset_at_ms) || value.daily_limit !== 40 || value.session_limit !== 10
    || !isDecisionCount(value.daily_remaining) || value.daily_remaining > 40
    || !isDecisionCount(value.session_remaining) || value.session_remaining > 10) return false;
  const start = Date.parse(value.utc_day + 'T00:00:00.000Z');
  return Number.isFinite(start) && new Date(start).toISOString().slice(0, 10) === value.utc_day
    && value.reset_at_ms === start + 86400000;
}
function validSession(value: unknown): value is JudgeSession {
  if (!exact(value, ['version', 'state', 'expires_at_ms', 'quota']) || value.version !== 'judge-session-v1') return false;
  if (value.state === 'anonymous') return value.expires_at_ms === null && value.quota === null;
  return value.state === 'active' && isDecisionCount(value.expires_at_ms) && value.expires_at_ms % 1000 === 0
    && value.expires_at_ms <= 8640000000000000 && validQuota(value.quota);
}
function validOpen(value: unknown): value is JudgeOpen {
  return exact(value, ['session', 'reused']) && typeof value.reused === 'boolean'
    && validSession(value.session) && value.session.state === 'active';
}
function validReservation(value: unknown): value is JudgeReservation {
  if (exact(value, ['kind']) && value.kind === 'anonymous') return true;
  if (!exact(value, ['kind', 'quota']) || !validQuota(value.quota)) return false;
  if (value.kind === 'admitted') return value.quota.daily_remaining < 40 && value.quota.session_remaining < 10;
  return value.kind === 'rate_limited' && (value.quota.daily_remaining === 0 || value.quota.session_remaining === 0);
}
function rpc(value: unknown): value is JudgeRPC {
  return decisionObject(value) && ['status', 'open', 'revoke', 'reserve', 'reserveObituary'].every(method => typeof value[method] === 'function');
}
function configured(env: Record<string, unknown>, allowDisabled = false): env is Record<string, unknown> & {
  JUDGE_CODE: string;
  JUDGE_GATE: { getByName(name: string): unknown };
} {
  return ((env.INFERENCE_ENABLED === true || env.INFERENCE_ENABLED === 'true')
      || (allowDisabled && (env.INFERENCE_ENABLED === false || env.INFERENCE_ENABLED === 'false')))
    && configuredCount(env.MAX_REQUEST_BYTES) === PROJECT_REQUEST_BYTE_CAP
    && configuredCount(env.SESSION_CAP) === 10 && configuredCount(env.JUDGE_DAILY_CAP) === 40
    && configuredCount(env.JUDGE_SESSION_TTL_SECONDS) === 86400 && canonical(env.JUDGE_CODE)
    && decisionObject(env.AI) && typeof env.AI.run === 'function'
    && decisionObject(env.JUDGE_GATE) && typeof env.JUDGE_GATE.getByName === 'function';
}
function decisionView(env: Record<string, unknown>, cap: number, enabled: boolean): Record<string, unknown> {
  return { AI: env.AI, MAX_REQUEST_BYTES: env.MAX_REQUEST_BYTES, SESSION_CAP: cap, INFERENCE_ENABLED: enabled };
}

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reviewer access — Back in the Family</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f8f7f2; color: #252525; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
::selection { background: #d7d2bd; color: #111111; }
:focus-visible { outline: 2px solid #252525; outline-offset: 3px; }
main { max-width: 34rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { margin: 0 0 1rem; font-size: 20px; line-height: 1.3; }
p { margin: 0 0 1rem; }
form { display: grid; gap: 8px; margin: 1.5rem 0; }
label { font-weight: 600; }
button, input { font: inherit; color: inherit; border: 1px solid #858585; border-radius: 4px; background: #fffefa; min-height: 44px; }
input { width: 100%; padding: 8px; caret-color: #252525; }
button { cursor: pointer; padding: 8px 12px; font-weight: 600; border-color: #65645e; background: #e2e0d9; }
button:hover:not(:disabled) { background: #d0cdc0; }
button:disabled { color: #65645e; background: #eeede6; cursor: not-allowed; }
a { color: #252525; text-underline-offset: 3px; }
#message { color: #9b2520; overflow-wrap: anywhere; }
#message:empty { margin: 0; }
#status { font-variant-numeric: tabular-nums; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; }
[hidden] { display: none; }
</style>
</head>
<body>
<main>
<h1>Back in the Family — reviewer access</h1>
<p>Enter the private reviewer code to play the existing game with native decisions. The public game remains rules-only.</p>
<form id="login">
<label for="code">Reviewer code</label>
<input id="code" name="code" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required minlength="43" maxlength="43" aria-describedby="code-help message">
<p id="code-help">Use the code exactly as supplied. Each session lasts up to 24 hours and permits 10 decisions, within the shared limit of 40 per UTC day.</p>
<button id="submit" type="submit">Enter game</button>
</form>
<p id="message" role="alert"></p>
<p id="status" role="status" aria-live="polite">Checking session…</p>
<div class="actions"><a id="continue" href="/" hidden>Continue to game</a><button id="logout" type="button" disabled>Log out</button></div>
<noscript><p>JavaScript is required to sign in and play.</p></noscript>
</main>
<script>
const form = document.getElementById('login');
const password = document.getElementById('code');
const submit = document.getElementById('submit');
const logout = document.getElementById('logout');
const continueLink = document.getElementById('continue');
const status = document.getElementById('status');
const message = document.getElementById('message');
const errors = {
  malformed_request: 'The code must match the supplied 43-character code exactly.',
  payload_too_large: 'The sign-in request is too large. Enter only the reviewer code.',
  invalid_code: 'That code was not accepted. Check the privately supplied code and try again.',
  forbidden: 'Sign-in was blocked. Open this page directly and try again.',
  unavailable: 'Reviewer access is unavailable. Try again later.',
};
function showSession(session) {
  if (!session || session.version !== 'judge-session-v1' || !['anonymous', 'active'].includes(session.state)) throw new Error('Unavailable');
  const active = session.state === 'active';
  logout.disabled = !active;
  continueLink.hidden = !active;
  status.textContent = active
    ? 'Session active. ' + session.quota.session_remaining + ' of 10 lifetime decisions remain; ' + session.quota.daily_remaining + ' of 40 remain today (UTC). Expires ' + new Date(session.expires_at_ms).toLocaleString() + '.'
    : 'Not signed in. Enter the private code above.';
}
async function sessionRequest(method, body) {
  const response = await fetch('/api/judge/session', {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
  });
  if (response.status === 204 && method === 'DELETE') return null;
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error && result.error.kind] || errors.unavailable);
  showSession(result);
  return result;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const logoutWasDisabled = logout.disabled;
  submit.disabled = true;
  logout.disabled = true;
  message.textContent = '';
  status.textContent = 'Signing in…';
  try {
    const session = await sessionRequest('POST', JSON.stringify({ version: 'judge-login-v1', code: password.value }));
    if (session.state !== 'active') throw new Error(errors.unavailable);
    password.value = '';
    window.location.assign('/');
  } catch (error) {
    message.textContent = error instanceof Error && Object.values(errors).includes(error.message) ? error.message : errors.unavailable;
    status.textContent = 'Sign-in did not complete.';
    logout.disabled = logoutWasDisabled;
    password.focus();
  } finally {
    submit.disabled = false;
  }
});
logout.addEventListener('click', async () => {
  submit.disabled = true;
  logout.disabled = true;
  message.textContent = '';
  status.textContent = 'Logging out…';
  try {
    await sessionRequest('DELETE');
    continueLink.hidden = true;
    status.textContent = 'Logged out. Enter the code to start a new session.';
    password.focus();
  } catch {
    message.textContent = 'Logout could not be confirmed. Try again.';
    status.textContent = 'Session status unavailable.';
    logout.disabled = false;
  } finally {
    submit.disabled = false;
  }
});
submit.disabled = true;
sessionRequest('GET').catch(() => { status.textContent = errors.unavailable; }).finally(() => { submit.disabled = false; });
</script>
</body>
</html>`;

/** Route and method checks precede every credential, namespace and storage operation. */
export async function handleJudgeRequest(request: Request, environment: unknown, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const path = new URL(request.url).pathname;
  const portal = path === '/api/judge' || path.startsWith('/api/judge/');
  const login = path === '/judge/login';
  const sessionRoute = path === '/api/judge/session';
  const configRoute = path === '/api/decision/config';
  const decisionRoute = path === '/api/decision';
  const obituaryConfigRoute = path === '/api/judge/obituary/config';
  const obituaryRoute = path === '/api/obituary';
  const narration = obituaryConfigRoute || obituaryRoute;
  const root = path === '/';
  if (portal && !sessionRoute && !obituaryConfigRoute) return portalFailure('not_found');
  if (login) {
    if (request.method !== 'GET') return portalFailure('method_not_allowed', 'GET');
    return new Response(LOGIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (!sessionRoute && !configRoute && !decisionRoute && !root && !narration) return handleRequest(request, environment);
  const allow = sessionRoute ? 'GET, POST, DELETE' : decisionRoute || obituaryRoute ? 'POST' : 'GET';
  if (!(sessionRoute ? ['GET', 'POST', 'DELETE'].includes(request.method) : request.method === allow)) {
    if (narration) return obituaryFailure('request_invalid', 405, allow);
    return sessionRoute ? portalFailure('method_not_allowed', allow) : failure('method_not_allowed', allow);
  }
  if ((request.method === 'POST' || request.method === 'DELETE') && !sameOrigin(request)) {
    if (narration) return obituaryFailure('request_invalid', 403);
    return sessionRoute ? portalFailure('forbidden') : failure('disabled');
  }
  let submitted: string | undefined;
  if (sessionRoute && request.method === 'POST') {
    if (!/^\s*application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get('Content-Type') ?? '')) {
      return portalFailure('malformed_request');
    }
    const body = await readRequest(request, 256);
    if (!body.ok) return portalFailure(body.kind);
    if (!exact(body.value, ['version', 'code']) || body.value.version !== 'judge-login-v1' || !canonical(body.value.code)) {
      return portalFailure('malformed_request');
    }
    submitted = body.value.code;
  }
  const env = decisionObject(environment) ? environment : {};
  if (!configured(env, narration)) return narration ? obituaryFailure('capability_unavailable', 503)
    : sessionRoute ? portalFailure('unavailable') : failure(root ? 'unavailable' : 'disabled');
  const parsedCookie = cookie(request);
  try {
    if (submitted !== undefined) {
      if (!('timingSafeEqual' in crypto.subtle) || typeof crypto.subtle.timingSafeEqual !== 'function') {
        return portalFailure('unavailable');
      }
      if (crypto.subtle.timingSafeEqual(encoder.encode(submitted), encoder.encode(env.JUDGE_CODE)) !== true) {
        return portalFailure('invalid_code');
      }
    }
    const gate = env.JUDGE_GATE.getByName('review-pool-v1');
    if (!rpc(gate)) throw new Error('Judge gate unavailable');
    const tokenHash = parsedCookie.token === null ? null : await sha256(parsedCookie.token);
    if (sessionRoute && request.method === 'DELETE') {
      await gate.revoke(tokenHash);
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': CLEAR_COOKIE } });
    }
    const epoch = await sha256(env.JUDGE_CODE);
    if (submitted !== undefined) {
      const candidate = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const opened: unknown = await gate.open(await sha256(candidate), tokenHash, epoch);
      if (!validOpen(opened) || (opened.reused && parsedCookie.token === null)) throw new Error('Judge gate unavailable');
      const token = opened.reused ? parsedCookie.token : candidate;
      const response = json(opened.session);
      response.headers.set('Set-Cookie', COOKIE_NAME + '=' + token + COOKIE_ATTRIBUTES + '; Expires=' + new Date(opened.session.expires_at_ms).toUTCString());
      return response;
    }
    const session: unknown = await gate.status(tokenHash, epoch);
    if (!validSession(session)) throw new Error('Judge gate unavailable');
    if (sessionRoute) return clearInvalid(json(session), parsedCookie.present, session);
    if (narration) {
      if (session.state === 'anonymous' || tokenHash === null) {
        return clearInvalid(obituaryFailure('anonymous', 401), parsedCookie.present, session);
      }
      const inferenceEnabled = env.INFERENCE_ENABLED === true || env.INFERENCE_ENABLED === 'true';
      if (obituaryConfigRoute) return obituaryCapability(session, inferenceEnabled);
      if (!inferenceEnabled) return obituaryFailure('disabled', 503);
      const response = await handleObituaryPost(request, env.AI as ObituaryAI, gate, tokenHash, epoch, ctx);
      if (response.status === 401) response.headers.set('Set-Cookie', CLEAR_COOKIE);
      return response;
    }
    if (root) {
      if (session.state === 'anonymous') {
        return clearInvalid(new Response(null, { status: 303, headers: { Location: '/judge/login', 'Cache-Control': 'no-store' } }), parsedCookie.present, session);
      }
      if (!decisionObject(env.ASSETS) || typeof env.ASSETS.fetch !== 'function') return failure('unavailable');
      return await env.ASSETS.fetch(request);
    }
    const cap = session.state === 'active' ? Math.min(session.quota.session_remaining, session.quota.daily_remaining) : 0;
    if (configRoute) {
      return clearInvalid(await handleRequest(request, decisionView(env, cap, cap > 0)), parsedCookie.present, session);
    }
    if (session.state === 'anonymous' || tokenHash === null) return clearInvalid(failure('disabled'), parsedCookie.present, session);
    // A zero-quota snapshot still validates the original body before authoritative reserve.
    let revoked = false;
    const response = await handleRequest(request, decisionView(env, cap, true), undefined, async () => {
      const reserved: unknown = await gate.reserve(tokenHash, epoch);
      if (!validReservation(reserved)) return 'unavailable';
      if (reserved.kind === 'anonymous') { revoked = true; return 'disabled'; }
      return reserved.kind;
    });
    if (revoked) response.headers.set('Set-Cookie', CLEAR_COOKIE);
    return response;
  } catch {
    return narration ? obituaryFailure(obituaryConfigRoute ? 'capability_unavailable' : 'admission_unavailable', 503)
      : sessionRoute ? portalFailure('unavailable') : failure('unavailable');
  }
}

export default {
  fetch(request, env, ctx) {
    return handleJudgeRequest(request, env, ctx);
  },
} satisfies ExportedHandler<JudgeEnv>;
