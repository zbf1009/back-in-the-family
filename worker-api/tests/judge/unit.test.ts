import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';
import { handleRequest } from '../../src/handler.ts';
import { readRequest } from '../../src/http.ts';
import { decisionRequest, expectError, nativeResult, publicBody } from '../helpers/decision.ts';
import { decisionObject, isDecisionCount, isModelDecision } from '../../../web/src/shared/decision.ts';
import type { ActiveJudgeSession, JudgeSession, Quota } from '../../src/judge-contract.ts';

// Pure Node boundary fixture only: this base does not implement native RPC or SQLite.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return {
    url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }',
    shortCircuit: true,
  };
  return nextResolve(specifier, context);
} });
// Static import would resolve the unavailable platform module before this fixture hook.
const { handleJudgeRequest, JudgeGate } = await import('../../src/judge.ts');
hooks.deregister();
const originalComparison = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
  configurable: true, value: (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b),
});
after(() => {
  if (originalComparison) Object.defineProperty(crypto.subtle, 'timingSafeEqual', originalComparison);
  else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
});

const ORIGIN = 'https://judge.test';
const NAME = '__Host-bif_judge';
// Known synthetic code, never a real reviewer credential.
const SYNTHETIC_CODE = Buffer.alloc(32, 0x41).toString('base64url');
const ANONYMOUS = { version: 'judge-session-v1', state: 'anonymous', expires_at_ms: null, quota: null } as const;

function request(path: string, method = 'GET', body?: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(ORIGIN + path, {
    method, body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}
function login(code: unknown = SYNTHETIC_CODE, headers: Record<string, string> = {}, body?: unknown): Request {
  return request('/api/judge/session', 'POST', JSON.stringify(body ?? { version: 'judge-login-v1', code }), {
    Origin: ORIGIN, 'Content-Type': 'application/json', ...headers,
  });
}
function model(cookie?: string, body: unknown = decisionRequest(), headers: Record<string, string> = {}): Request {
  return request('/api/decision', 'POST', JSON.stringify(body), { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...headers });
}
function cookieOf(response: Response): string {
  const value = response.headers.get('set-cookie');
  assert.ok(value);
  return value.split(';')[0]!;
}
async function portalError(response: Response, kind: string, status: number, allow?: string): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('allow'), allow ?? null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await publicBody(response), { version: 'judge-error-v1', error: { kind } });
}

/** An explicitly fake RPC boundary. Its clock/counters are not native SQL proof. */
function fixture() {
  let now = Date.UTC(2026, 10, 10, 12, 0, 0, 321);
  const rows = new Map<string, { expires: number; admitted: number; epoch: string }>();
  const daily = new Map<string, number>();
  const operations: string[] = [];
  let nativeCalls = 0;
  let fail: string | undefined;
  let malformed: string | undefined;
  let sessionOverride: unknown;
  let nativeStatus = 200;
  let reserveAnonymous = false;
  function check(method: string) {
    operations.push(method);
    if (fail === method) throw new Error('Synthetic boundary failure');
  }
  function active(hash: string | null, epoch: string): ActiveJudgeSession | null {
    const row = hash === null ? undefined : rows.get(hash);
    if (!row || row.expires <= now || row.epoch !== epoch) return null;
    const day = new Date(now).toISOString().slice(0, 10);
    const quota: Quota = {
      utc_day: day, reset_at_ms: Date.parse(day + 'T00:00:00.000Z') + 86400000,
      daily_limit: 40, daily_remaining: 40 - (daily.get(day) ?? 0),
      session_limit: 10, session_remaining: 10 - row.admitted,
    };
    return { version: 'judge-session-v1', state: 'active', expires_at_ms: row.expires, quota };
  }
  const gate = {
    async status(hash: string | null, epoch: string): Promise<unknown> {
      check('status');
      if (sessionOverride !== undefined) return sessionOverride;
      const result: JudgeSession = active(hash, epoch) ?? ANONYMOUS;
      return malformed === 'status' ? { ...result, extra: true } : result;
    },
    async open(candidate: string, existing: string | null, epoch: string): Promise<unknown> {
      check('open');
      for (const hash of [candidate, epoch, existing].filter(value => value !== null)) assert.match(hash, /^[0-9a-f]{64}$/);
      const prior = active(existing, epoch);
      if (prior) return { session: prior, reused: true };
      if (rows.has(candidate)) throw new Error('Synthetic collision');
      rows.set(candidate, { expires: Math.floor(now / 1000) * 1000 + 86400000, admitted: 0, epoch });
      const result = { session: active(candidate, epoch), reused: false };
      return malformed === 'open' ? { ...result, extra: true } : result;
    },
    async revoke(hash: string | null): Promise<void> {
      check('revoke');
      if (hash !== null) rows.delete(hash);
    },
    async reserve(hash: string, epoch: string): Promise<unknown> {
      check('reserve');
      if (malformed === 'reserve') return { kind: 'admitted' };
      const session = reserveAnonymous ? null : active(hash, epoch);
      if (!session) return { kind: 'anonymous' };
      if (session.quota.daily_remaining === 0 || session.quota.session_remaining === 0) return { kind: 'rate_limited', quota: session.quota };
      rows.get(hash)!.admitted += 1;
      daily.set(session.quota.utc_day, (daily.get(session.quota.utc_day) ?? 0) + 1);
      return { kind: 'admitted', quota: active(hash, epoch)!.quota };
    },
  };
  const env: Record<string, unknown> = {
    INFERENCE_ENABLED: 'true', MAX_REQUEST_BYTES: '16384', SESSION_CAP: '10',
    JUDGE_DAILY_CAP: '40', JUDGE_SESSION_TTL_SECONDS: '86400', JUDGE_CODE: SYNTHETIC_CODE,
    JUDGE_GATE: { getByName(name: string) { assert.equal(name, 'review-pool-v1'); check('namespace'); return gate; } },
    AI: { async run(name: unknown, input: unknown, options: unknown) {
      nativeCalls += 1;
      operations.push('AI');
      assert.equal(name, '@cf/cloudflare/clef');
      assert.deepEqual(options, { returnRawResponse: true });
      const original = decisionRequest();
      assert.deepEqual(input, { model: 'clef', state: original.state, questions: { decision: {
        type: 'choice', instructions: original.instructions,
        criteria: { heed_warning: 'Heed the warning.', dismiss_dream: 'Dismiss the dream.' },
      } } });
      return new Response(JSON.stringify(nativeResult()), { status: nativeStatus });
    } },
    ASSETS: { async fetch() { operations.push('assets'); return new Response('Existing game document'); } },
  };
  return {
    env, rows, daily, operations,
    get calls() { return nativeCalls; },
    setTime(value: number) { now = value; },
    failAt(value: string | undefined) { fail = value; },
    malformedAt(value: string | undefined) { malformed = value; },
    overrideSession(value: unknown) { sessionOverride = value; },
    nativeStatus(value: number) { nativeStatus = value; },
    invalidateBeforeReserve() { reserveAnonymous = true; },
  };
}

function assertActiveSession(value: unknown): asserts value is ActiveJudgeSession {
  assert.ok(decisionObject(value));
  assert.deepEqual(Object.keys(value).sort(), ['expires_at_ms', 'quota', 'state', 'version']);
  assert.equal(value.version, 'judge-session-v1');
  assert.equal(value.state, 'active');
  assert.ok(isDecisionCount(value.expires_at_ms));
  assert.equal(value.expires_at_ms % 1000, 0);
  assert.ok(decisionObject(value.quota));
  const quota = value.quota;
  assert.deepEqual(Object.keys(quota).sort(), ['daily_limit', 'daily_remaining', 'reset_at_ms', 'session_limit', 'session_remaining', 'utc_day']);
  assert.equal(quota.daily_limit, 40);
  assert.equal(quota.session_limit, 10);
  assert.ok(isDecisionCount(quota.daily_remaining) && quota.daily_remaining <= 40);
  assert.ok(isDecisionCount(quota.session_remaining) && quota.session_remaining <= 10);
  assert.ok(isDecisionCount(quota.reset_at_ms));
  assert.equal(typeof quota.utc_day, 'string');
}

async function signedIn(fake: { env: Record<string, unknown> }): Promise<{ cookie: string; session: ActiveJudgeSession }> {
  const response = await handleJudgeRequest(login(), fake.env);
  assert.equal(response.status, 200);
  const session = await publicBody(response);
  assertActiveSession(session);
  return { cookie: cookieOf(response), session };
}

test('pure module loading retains default native entry association without pretending to test SQLite', () => {
  assert.equal(Object.getPrototypeOf(JudgeGate).name, 'DurableObject');
  assert.deepEqual(Object.getOwnPropertyNames(JudgeGate.prototype).sort(), ['constructor', 'open', 'reserve', 'revoke', 'status']);
});

test('login is real no-store accessible HTML with actual fetch, password clearing and fresh navigation', async () => {
  const response = await handleJudgeRequest(request('/judge/login'), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  for (const text of ['<html lang="en">', '<label for="code">', 'type="password"', 'role="alert"', 'role="status"', 'system-ui', "sessionRequest('GET')", "sessionRequest('POST'", "sessionRequest('DELETE')", "password.value = ''", "window.location.assign('/')"]) assert.ok(html.includes(text));
  for (const text of ['localStorage', 'sessionStorage', SYNTHETIC_CODE, 'Set-Cookie', 'document.cookie']) assert.ok(!html.includes(text));
});

test('route and method rejection precedes namespace, configuration and CSRF', async () => {
  const fake = fixture();
  fake.failAt('namespace');
  for (const path of ['/api/judge', '/api/judge/', '/api/judge/unknown', '/api/judge/session/']) {
    await portalError(await handleJudgeRequest(request(path), fake.env), 'not_found', 404);
  }
  for (const method of ['PUT', 'PATCH', 'HEAD', 'OPTIONS']) {
    await portalError(await handleJudgeRequest(request('/api/judge/session', method), fake.env), 'method_not_allowed', 405, 'GET, POST, DELETE');
    await portalError(await handleJudgeRequest(request('/judge/login', method), fake.env), 'method_not_allowed', 405, 'GET');
  }
  for (const [path, method, allow] of [['/api/decision', 'GET', 'POST'], ['/api/decision/config', 'POST', 'GET'], ['/', 'POST', 'GET']]) {
    const response = await handleJudgeRequest(request(path!, method), fake.env);
    assert.equal(response.headers.get('allow'), allow);
    await expectError(response, 'method_not_allowed', 405);
  }
  for (const path of ['/api', '/api/', '/api/unknown', '/api/decision/', '/api/decision/config/']) {
    await expectError(await handleJudgeRequest(request(path), fake.env), 'not_found', 404);
  }
  assert.deepEqual(fake.operations, []);
});

test('portal CSRF and model CSRF reject missing null foreign Origin and explicit cross-site', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  fake.operations.length = 0;
  const rejectedHeaders: Record<string, string>[] = [{}, { Origin: 'null' }, { Origin: 'https://other.test' }, { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' }];
  for (const headers of rejectedHeaders) {
    await portalError(await handleJudgeRequest(request('/api/judge/session', 'POST', JSON.stringify({ version: 'judge-login-v1', code: SYNTHETIC_CODE }), { 'Content-Type': 'application/json', ...headers }), fake.env), 'forbidden', 403);
    await portalError(await handleJudgeRequest(request('/api/judge/session', 'DELETE', undefined, headers), fake.env), 'forbidden', 403);
    await expectError(await handleJudgeRequest(request('/api/decision', 'POST', JSON.stringify(decisionRequest()), { Cookie: signed.cookie, ...headers }), fake.env), 'disabled', 503);
  }
  assert.deepEqual(fake.operations, []);
  assert.equal(fake.calls, 0);
  assert.equal((await handleJudgeRequest(model(signed.cookie, decisionRequest(), { 'Sec-Fetch-Site': 'same-origin' }), fake.env)).status, 200);
  assert.equal(fake.calls, 1);
});

test('login accepts only the exact versioned object and canonical case-sensitive 32-byte code', async () => {
  const fake = fixture();
  const cases: unknown[] = [null, [], {}, { version: 'judge-login-v1' }, { code: SYNTHETIC_CODE },
    { version: 'wrong', code: SYNTHETIC_CODE }, { version: 'judge-login-v1', code: SYNTHETIC_CODE, extra: true },
    ...[null, 1, [], {}, '', ' ' + SYNTHETIC_CODE, SYNTHETIC_CODE + ' ', SYNTHETIC_CODE + '=', SYNTHETIC_CODE.slice(0, -1),
      SYNTHETIC_CODE.slice(0, -1) + 'R', '界'.repeat(43)].map(code => ({ version: 'judge-login-v1', code }))];
  for (const body of cases) {
    await portalError(await handleJudgeRequest(request('/api/judge/session', 'POST', JSON.stringify(body), { Origin: ORIGIN, 'Content-Type': 'application/json' }), fake.env), 'malformed_request', 400);
  }
  assert.deepEqual(fake.operations, []);
  const wrongCase = SYNTHETIC_CODE[0]!.toLowerCase() + SYNTHETIC_CODE.slice(1);
  assert.notEqual(wrongCase, SYNTHETIC_CODE);
  for (const code of [wrongCase, Buffer.alloc(32, 0x42).toString('base64url')]) {
    await portalError(await handleJudgeRequest(login(code), fake.env), 'invalid_code', 401);
  }
  assert.deepEqual(fake.operations, []);
  const response = await handleJudgeRequest(login(), fake.env);
  const token = cookieOf(response).slice(NAME.length + 1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, 'base64url').toString('base64url'), token);
  assert.notEqual(token, SYNTHETIC_CODE);
  await portalError(await handleJudgeRequest(login(token), fake.env), 'invalid_code', 401);
  assert.equal(fake.calls, 0);
});

test('login media type, fatal UTF8, stream failures and actual 256-byte bound are independent of Content-Length', async () => {
  const fake = fixture();
  for (const contentType of ['', 'text/plain', 'application/problem+json', 'application/json; charset=latin1', 'application/json; extra=x', 'application/json; charset=utf-8; charset=utf-8']) {
    await portalError(await handleJudgeRequest(login(SYNTHETIC_CODE, { 'Content-Type': contentType }), fake.env), 'malformed_request', 400);
  }
  for (const contentType of ['application/json', 'application/json; charset=UTF-8', 'Application/JSON; charset="utf-8"']) {
    assert.equal((await handleJudgeRequest(login(SYNTHETIC_CODE, { 'Content-Type': contentType }), fake.env)).status, 200);
  }
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json' };
  for (const body of [undefined, '{', new Uint8Array([0xff]), new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('Synthetic stream failure')); } })]) {
    await portalError(await handleJudgeRequest(request('/api/judge/session', 'POST', body, headers), fake.env), 'malformed_request', 400);
  }
  const encoded = JSON.stringify({ version: 'judge-login-v1', code: SYNTHETIC_CODE });
  const exact = encoded + ' '.repeat(256 - new TextEncoder().encode(encoded).byteLength);
  for (const length of [undefined, '1', '99999']) {
    const stream = (text: string) => new ReadableStream<Uint8Array>({ start(controller) {
      const bytes = new TextEncoder().encode(text);
      controller.enqueue(bytes.slice(0, 13)); controller.enqueue(bytes.slice(13)); controller.close();
    } });
    const customHeaders = { ...headers, ...(length ? { 'Content-Length': length } : {}) };
    const accepted = request('/api/judge/session', 'POST', stream(exact), customHeaders);
    if (length === undefined) assert.equal(accepted.headers.get('content-length'), null);
    assert.equal((await handleJudgeRequest(accepted, fake.env)).status, 200);
    await portalError(await handleJudgeRequest(request('/api/judge/session', 'POST', stream(exact + ' '), customHeaders), fake.env), 'payload_too_large', 413);
  }
  let cancelled = false;
  const overflowing = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(257)); }, cancel() { cancelled = true; },
  });
  await portalError(await handleJudgeRequest(request('/api/judge/session', 'POST', overflowing, headers), fake.env), 'payload_too_large', 413);
  assert.equal(cancelled, true);
  assert.equal(fake.calls, 0);
});

test('anonymous status root redirect and config are exact; invalid duplicate noncanonical unknown cookies clear', async () => {
  const fake = fixture();
  for (const value of [undefined, NAME + '=', NAME + '=short', NAME + '=' + SYNTHETIC_CODE + '=',
    NAME + '=' + SYNTHETIC_CODE.slice(0, -1) + 'R', NAME + '=' + SYNTHETIC_CODE,
    NAME + '=' + SYNTHETIC_CODE + '; ' + NAME + '=' + SYNTHETIC_CODE, NAME + '= ' + SYNTHETIC_CODE]) {
    const headers: Record<string, string> = value === undefined ? {} : { Cookie: value };
    const status = await handleJudgeRequest(request('/api/judge/session', 'GET', undefined, headers), fake.env);
    assert.deepEqual(await publicBody(status), ANONYMOUS);
    assert.equal(status.status, 200);
    assert.equal(status.headers.has('set-cookie'), value !== undefined);
    if (value !== undefined) assert.match(status.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
    const root = await handleJudgeRequest(request('/', 'GET', undefined, headers), fake.env);
    assert.equal(root.status, 303);
    assert.equal(root.headers.get('location'), '/judge/login');
    assert.equal(root.headers.get('cache-control'), 'no-store');
    const config = await handleJudgeRequest(request('/api/decision/config', 'GET', undefined, headers), fake.env);
    assert.deepEqual(await publicBody(config), { version: 'decision-config-v1', enabled: false, session_cap: 0 });
    const denied = await handleJudgeRequest(model(value), fake.env);
    await expectError(denied, 'disabled', 503);
  }
  await expectError(await handleJudgeRequest(request('/api/decision?code=' + SYNTHETIC_CODE, 'POST', JSON.stringify(decisionRequest()), { Origin: ORIGIN }), fake.env), 'disabled', 503);
  assert.equal(fake.calls, 0);
});

test('active wire cookie expiry and reuse are exact and only hash/epoch reach the fake RPC rows', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  assert.deepEqual(signed.session, {
    version: 'judge-session-v1', state: 'active', expires_at_ms: Date.UTC(2026, 10, 11, 12), quota: {
      utc_day: '2026-11-10', reset_at_ms: Date.UTC(2026, 10, 11),
      daily_limit: 40, daily_remaining: 40, session_limit: 10, session_remaining: 10,
    },
  });
  const response = await handleJudgeRequest(login(SYNTHETIC_CODE, { Cookie: signed.cookie }), fake.env);
  assert.equal(cookieOf(response), signed.cookie);
  assert.deepEqual(await publicBody(response), signed.session);
  const fullCookie = response.headers.get('set-cookie')!;
  assert.ok(fullCookie.includes('; Secure; HttpOnly; SameSite=Strict; Path=/'));
  assert.ok(fullCookie.endsWith('; Expires=' + new Date(signed.session.expires_at_ms).toUTCString()));
  assert.ok(!fullCookie.includes('Domain=') && !fullCookie.includes('Max-Age='));
  for (const [hash, row] of fake.rows) { assert.match(hash, /^[0-9a-f]{64}$/); assert.match(row.epoch, /^[0-9a-f]{64}$/); }
  assert.ok(!JSON.stringify([...fake.rows]).includes(SYNTHETIC_CODE));
  const root = await handleJudgeRequest(request('/', 'GET', undefined, { Cookie: signed.cookie }), fake.env);
  assert.equal(await root.text(), 'Existing game document');
  assert.deepEqual(await publicBody(await handleJudgeRequest(request('/api/decision/config', 'GET', undefined, { Cookie: signed.cookie }), fake.env)),
    { version: 'decision-config-v1', enabled: true, session_cap: 10 });
  assert.equal(fake.calls, 0);
});

test('valid native Decision reserves exactly once after validation; zero snapshot does not disable validation', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  const row = [...fake.rows.values()][0]!;
  row.admitted = 9;
  fake.operations.length = 0;
  const response = await handleJudgeRequest(model(signed.cookie), fake.env);
  assert.equal(response.status, 200);
  const result = await publicBody(response);
  assert.ok(isModelDecision(result, decisionRequest()));
  assert.equal(result.session_cap, 1);
  assert.deepEqual(fake.operations, ['namespace', 'status', 'reserve', 'AI']);
  assert.equal(fake.calls, 1);
  fake.operations.length = 0;
  await expectError(await handleJudgeRequest(model(signed.cookie, { ...decisionRequest(), extra: true }), fake.env), 'malformed_request', 400);
  assert.deepEqual(fake.operations, ['namespace', 'status']);
  await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'rate_limited', 429);
  assert.equal(fake.calls, 1);
  assert.equal(row.admitted, 10);
  assert.equal(fake.daily.get('2026-11-10'), 1);
  assert.deepEqual(await publicBody(await handleJudgeRequest(request('/api/decision/config', 'GET', undefined, { Cookie: signed.cookie }), fake.env)),
    { version: 'decision-config-v1', enabled: false, session_cap: 0 });
  assert.equal(fake.env.SESSION_CAP, '10');
  assert.equal(fake.env.INFERENCE_ENABLED, 'true');
});

test('daily exhaustion, provider failure and RPC failure preserve separate original Decision classifications', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  fake.daily.set('2026-11-10', 40);
  await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'rate_limited', 429);
  assert.equal(fake.calls, 0);
  fake.daily.set('2026-11-10', 0);
  fake.nativeStatus(500);
  await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'model_error', 502);
  assert.equal(fake.calls, 1);
  assert.equal([...fake.rows.values()][0]!.admitted, 1);
  assert.equal(fake.daily.get('2026-11-10'), 1);
  fake.failAt('reserve');
  await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'unavailable', 503);
  assert.equal(fake.calls, 1);
  fake.failAt(undefined);
  fake.malformedAt('reserve');
  await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'unavailable', 503);
  assert.equal(fake.calls, 1);
  fake.malformedAt(undefined);
  fake.invalidateBeforeReserve();
  const expired = await handleJudgeRequest(model(signed.cookie), fake.env);
  assert.match(expired.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  await expectError(expired, 'disabled', 503);
  assert.equal(fake.calls, 1);
});

test('expiry logout reuse rotation and UTC change stay authoritative at the fake RPC boundary', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  await handleJudgeRequest(model(signed.cookie), fake.env);
  fake.setTime(Date.UTC(2026, 10, 11, 0, 0, 1));
  const reused = await handleJudgeRequest(login(SYNTHETIC_CODE, { Cookie: signed.cookie }), fake.env);
  assert.equal(cookieOf(reused), signed.cookie);
  const nextDay = await publicBody(reused);
  assert.deepEqual(nextDay, { ...signed.session, quota: { ...signed.session.quota,
    utc_day: '2026-11-11', reset_at_ms: Date.UTC(2026, 10, 12), daily_remaining: 40, session_remaining: 9,
  } });
  fake.env.JUDGE_CODE = Buffer.alloc(32, 0x43).toString('base64url');
  const rotated = await handleJudgeRequest(request('/api/judge/session', 'GET', undefined, { Cookie: signed.cookie }), fake.env);
  assert.deepEqual(await publicBody(rotated), ANONYMOUS);
  assert.ok(rotated.headers.has('set-cookie'));
  await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'disabled', 503);
  assert.equal(fake.daily.get('2026-11-10'), 1);
  fake.env.JUDGE_CODE = SYNTHETIC_CODE;
  fake.setTime(signed.session.expires_at_ms);
  assert.deepEqual(await publicBody(await handleJudgeRequest(request('/api/judge/session', 'GET', undefined, { Cookie: signed.cookie }), fake.env)), ANONYMOUS);
  const fresh = await signedIn(fake);
  assert.notEqual(fresh.cookie, signed.cookie);
  const logout = await handleJudgeRequest(request('/api/judge/session', 'DELETE', undefined, { Origin: ORIGIN, Cookie: fresh.cookie }), fake.env);
  assert.equal(logout.status, 204);
  assert.equal(await logout.text(), '');
  assert.equal(logout.headers.get('cache-control'), 'no-store');
  assert.ok(logout.headers.has('set-cookie'));
  assert.deepEqual(await publicBody(await handleJudgeRequest(request('/api/judge/session', 'GET', undefined, { Cookie: fresh.cookie }), fake.env)), ANONYMOUS);
  assert.equal(fake.daily.get('2026-11-10'), 1);
  fake.failAt('revoke');
  await portalError(await handleJudgeRequest(request('/api/judge/session', 'DELETE', undefined, { Origin: ORIGIN, Cookie: signed.cookie }), fake.env), 'unavailable', 503);
});

test('every missing unsafe prerequisite closes before storage; reachable or malformed RPC fails unavailable', async () => {
  const changes = [
    ...[false, 'false', undefined, null, '1', 1, ' true'].map(INFERENCE_ENABLED => ({ INFERENCE_ENABLED })),
    ...[undefined, '16383', '16385', ' 16384', '16384 ', '1e4', '16384.0', true].map(MAX_REQUEST_BYTES => ({ MAX_REQUEST_BYTES })),
    ...[undefined, '9', '11', '01', ' 10', 0.5, true].map(SESSION_CAP => ({ SESSION_CAP })),
    ...[undefined, '39', '41', '40 ', '4e1', false].map(JUDGE_DAILY_CAP => ({ JUDGE_DAILY_CAP })),
    ...[undefined, '0', '86401', ' 86400', '86400.0', true].map(JUDGE_SESSION_TTL_SECONDS => ({ JUDGE_SESSION_TTL_SECONDS })),
    ...[undefined, '', SYNTHETIC_CODE + '=', SYNTHETIC_CODE.slice(0, -1) + 'R'].map(JUDGE_CODE => ({ JUDGE_CODE })),
    ...[undefined, {}, { run: 1 }].map(AI => ({ AI })),
    ...[undefined, {}, { getByName: 1 }].map(JUDGE_GATE => ({ JUDGE_GATE })),
  ];
  for (const change of changes) {
    const fake = fixture();
    Object.assign(fake.env, change);
    await portalError(await handleJudgeRequest(request('/api/judge/session'), fake.env), 'unavailable', 503);
    await expectError(await handleJudgeRequest(request('/api/decision/config'), fake.env), 'disabled', 503);
    await expectError(await handleJudgeRequest(model(), fake.env), 'disabled', 503);
    assert.deepEqual(fake.operations, []);
    assert.equal(fake.calls, 0);
  }
  const fake = fixture();
  const signed = await signedIn(fake);
  for (const method of ['namespace', 'status']) {
    fake.failAt(method);
    await portalError(await handleJudgeRequest(request('/api/judge/session'), fake.env), 'unavailable', 503);
    await expectError(await handleJudgeRequest(request('/api/decision/config'), fake.env), 'unavailable', 503);
    await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'unavailable', 503);
    await expectError(await handleJudgeRequest(request('/'), fake.env), 'unavailable', 503);
  }
  fake.failAt(undefined);
  fake.malformedAt('status');
  await portalError(await handleJudgeRequest(request('/api/judge/session'), fake.env), 'unavailable', 503);
  fake.malformedAt('open');
  await portalError(await handleJudgeRequest(login(), fake.env), 'unavailable', 503);
  assert.equal(fake.calls, 0);
});

test('bounded reader retains original parse classification and generic Decision keeps no-Origin compatibility', async () => {
  assert.deepEqual(await readRequest(request('/anything', 'POST', '{}'), 2), { ok: true, value: {} });
  assert.deepEqual(await readRequest(request('/anything', 'POST', '{}'), 1), { ok: false, kind: 'payload_too_large' });
  assert.deepEqual(await readRequest(request('/anything', 'POST', new Uint8Array([0xff])), 10), { ok: false, kind: 'malformed_request' });
  let calls = 0;
  const env = { INFERENCE_ENABLED: 'true', MAX_REQUEST_BYTES: '16384', AI: { async run() {
    calls += 1; return new Response(JSON.stringify(nativeResult()));
  } } };
  const response = await handleRequest(request('/api/decision', 'POST', JSON.stringify(decisionRequest())), env);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('active RPC wire rejects every extra field and invalid quota or epoch-time domain', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  const base = signed.session;
  const malformed: unknown[] = [
    { ...base, extra: true }, { ...base, version: 'wrong' }, { ...base, state: 'unknown' },
    ...[null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 8640000000001000, '1000', 1001].map(expires_at_ms => ({ ...base, expires_at_ms })),
    ...Object.keys(base).map(key => Object.fromEntries(Object.entries(base).filter(([name]) => name !== key))),
    ...[null, {}, { ...base.quota, extra: true }, { ...base.quota, daily_limit: 41 }, { ...base.quota, session_limit: 11 },
      ...['2026-02-30', '2026-2-10', 'not-a-day', '2026-13-10'].map(utc_day => ({ ...base.quota, utc_day })),
      ...[-1, 0.5, '1', base.quota.reset_at_ms + 1].map(reset_at_ms => ({ ...base.quota, reset_at_ms })),
      ...[-1, 0.5, 41, '40', Number.MAX_SAFE_INTEGER + 1].map(daily_remaining => ({ ...base.quota, daily_remaining })),
      ...[-1, 0.5, 11, '10', Number.MAX_SAFE_INTEGER + 1].map(session_remaining => ({ ...base.quota, session_remaining })),
      ...Object.keys(base.quota).map(key => Object.fromEntries(Object.entries(base.quota).filter(([name]) => name !== key))),
    ].map(quota => ({ ...base, quota })),
  ];
  for (const session of malformed) {
    fake.overrideSession(session);
    await portalError(await handleJudgeRequest(request('/api/judge/session', 'GET', undefined, { Cookie: signed.cookie }), fake.env), 'unavailable', 503);
    await expectError(await handleJudgeRequest(model(signed.cookie), fake.env), 'unavailable', 503);
  }
  assert.equal(fake.calls, 0);
  assert.ok(!fake.operations.includes('reserve'));
});

test('authenticated malformed, UTF8, absent and streamed oversized Decision bodies never reserve', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  fake.operations.length = 0;
  const headers = { Origin: ORIGIN, Cookie: signed.cookie };
  for (const body of [undefined, '{', new Uint8Array([0xff]), JSON.stringify({ ...decisionRequest(), metadata: { bridge_version: 'wrong' } })]) {
    await expectError(await handleJudgeRequest(request('/api/decision', 'POST', body, headers), fake.env), 'malformed_request', 400);
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(16385)); }, cancel() { cancelled = true; } });
  const oversized = request('/api/decision', 'POST', stream, headers);
  assert.equal(oversized.headers.get('content-length'), null);
  await expectError(await handleJudgeRequest(oversized, fake.env), 'payload_too_large', 413);
  assert.equal(cancelled, true);
  assert.ok(!fake.operations.includes('reserve'));
  assert.equal(fake.calls, 0);
});

test('absent invalid and duplicate logout cookies clear with an empty 204 without refund', async () => {
  const fake = fixture();
  fake.daily.set('2026-11-10', 7);
  for (const token of [undefined, NAME + '=bad', NAME + '=' + SYNTHETIC_CODE + '; ' + NAME + '=' + SYNTHETIC_CODE]) {
    const response = await handleJudgeRequest(request('/api/judge/session', 'DELETE', undefined, { Origin: ORIGIN, ...(token ? { Cookie: token } : {}) }), fake.env);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('content-type'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), NAME + '=; Secure; HttpOnly; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  assert.equal(fake.daily.get('2026-11-10'), 7);
  assert.equal(fake.calls, 0);
});

test('canonical session token is case-sensitive and unrelated cookie names do not authenticate', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  const token = signed.cookie.slice(NAME.length + 1);
  const index = token.search(/[A-Za-z]/);
  assert.ok(index >= 0);
  const character = token[index]!;
  const changed = character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase();
  const wrongCase = token.slice(0, index) + changed + token.slice(index + 1);
  for (const value of [NAME + '=' + wrongCase, NAME.toUpperCase() + '=' + token]) {
    const response = await handleJudgeRequest(request('/api/judge/session', 'GET', undefined, { Cookie: value }), fake.env);
    assert.deepEqual(await publicBody(response), ANONYMOUS);
    await expectError(await handleJudgeRequest(model(value), fake.env), 'disabled', 503);
  }
  assert.equal(fake.calls, 0);
});

test('GET config uses the smaller server quota snapshot and never reserves or mutates shared environment', async () => {
  const fake = fixture();
  const signed = await signedIn(fake);
  fake.daily.set('2026-11-10', 37);
  fake.operations.length = 0;
  const response = await handleJudgeRequest(request('/api/decision/config', 'GET', undefined, { Cookie: signed.cookie }), fake.env);
  assert.deepEqual(await publicBody(response), { version: 'decision-config-v1', enabled: true, session_cap: 3 });
  assert.deepEqual(fake.operations, ['namespace', 'status']);
  assert.equal(fake.calls, 0);
  assert.equal(fake.env.SESSION_CAP, '10');
  assert.equal(fake.daily.get('2026-11-10'), 37);
});
