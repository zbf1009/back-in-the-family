import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces, tmpdir } from 'node:os';
import { ReadableStream } from 'node:stream/web';
import test from 'node:test';
import { decisionObject, isDecisionConfig, isDecisionError, isDecisionRequest, isModelDecision } from '../../../web/src/shared/decision.ts';
import type { DecisionErrorKind, DecisionRequest } from '../../../web/src/shared/decision.ts';
import type { ActiveJudgeSession, JudgeSession, Quota } from '../../src/judge-contract.ts';
import { requireTools } from '../../scripts/tools.ts';
import { decisionRequest, nativeResult, publicBody } from '../helpers/decision.ts';
import type { PublicResponse } from '../helpers/decision.ts';
import { judgeRuntimeFixture } from '../helpers/judge-runtime.ts';
import type { JudgeRuntimeFixture, JudgeRuntimeFixtureOptions } from '../helpers/judge-runtime.ts';
import { OBITUARY_MODEL, OBITUARY_SYSTEM_PROMPT, parseObituaryCapability, parseObituaryReply, parseObituaryError } from '../../../web/src/shared/obituary.ts';
import type { ObituaryFactsV1 } from '../../../web/src/shared/obituary.ts';
import { renderObituaryTemplate } from '../../../web/src/main/obituary-template.ts';
import type * as RuntimeTools from 'worker-tools/miniflare';

const origin = 'https://judge.test';
// Public, synthetic credentials only. Never load a reviewer/deployment secret.
const code = Buffer.alloc(32, 17).toString('base64url');
const otherCode = Buffer.alloc(32, 34).toString('base64url');
const unknownToken = Buffer.alloc(32, 51).toString('base64url');
const cookieName = '__Host-bif_judge';
const now = Date.parse('2026-11-23T12:34:56.789Z');
const day = '2026-11-23';
const navigation = { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
const hash = (value: string) => createHash('sha256').update(value, 'ascii').digest('hex');
const obituaryFacts: ObituaryFactsV1 = {
  version: 1, deceased: { fullName: 'Ada Bell', sex: 'female', ageYears: 60,
    deathDate: { year: '1', day: 1, label: 'Year 1, Day 1 — Halloween' }, origin: 'born in town' },
  survivors: [], precededInDeath: [], debtActions: { forgivenDebts: null, demandsMade: null, peopleAskedForPayment: null },
  collections: { debtsPaidOn: null }, estate: null, jossBurnersOnDeathDay: '0',
};
const obituaryRequest = (key = 'a'.repeat(64)) => ({ version: 1, operationKey: key, facts: obituaryFacts });
function submitObituary(fixture: JudgeRuntimeFixture, cookie?: string, value: unknown = obituaryRequest(), headers: Record<string, string> = {}) {
  return fixture.runtime.dispatchFetch(origin + '/api/obituary', { method: 'POST', body: JSON.stringify(value),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers } });
}
async function narrationError(response: PublicResponse, error: string, status: number) {
  assert.equal(response.status, status);
  const parsed = parseObituaryError(await body(response));
  assert.ok(parsed !== null && parsed.error === error, 'Closed narration rejection');
}

async function fixtureCase(run: (fixture: JudgeRuntimeFixture) => Promise<void>, options: JudgeRuntimeFixtureOptions = {}): Promise<void> {
  const fixture = await judgeRuntimeFixture({ ...options, nowMs: options.nowMs ?? now,
    variables: { JUDGE_CODE: code, ...options.variables } });
  try { await run(fixture); }
  finally { await fixture.dispose(); }
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return decisionObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

// Never include an unvalidated response, Cookie, login body, RPC argument or
// recorded native input in assertion diagnostics. Only booleans and closed,
// nonsecret numeric/status projections may reach the test runner.
async function body(response: PublicResponse): Promise<unknown> {
  try { return await publicBody(response); }
  catch { throw new Error('Public JSON headers, size or encoding are invalid'); }
}
function quota(value: unknown): asserts value is Quota {
  assert.ok(exact(value, ['utc_day', 'reset_at_ms', 'daily_limit', 'daily_remaining', 'session_limit', 'session_remaining']), 'Closed quota fields');
  assert.ok(typeof value.utc_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.utc_day), 'Canonical UTC day');
  const start = Date.parse(value.utc_day + 'T00:00:00.000Z');
  assert.ok(Number.isFinite(start) && new Date(start).toISOString().slice(0, 10) === value.utc_day, 'Gregorian UTC day');
  assert.ok(value.reset_at_ms === start + 86400000, 'Next UTC midnight');
  assert.ok(value.daily_limit === 40 && value.session_limit === 10, 'Author grant limits');
  assert.ok(typeof value.daily_remaining === 'number' && Number.isSafeInteger(value.daily_remaining)
    && value.daily_remaining >= 0 && value.daily_remaining <= 40, 'Bounded daily remaining');
  assert.ok(typeof value.session_remaining === 'number' && Number.isSafeInteger(value.session_remaining)
    && value.session_remaining >= 0 && value.session_remaining <= 10, 'Bounded lifetime remaining');
}
async function sessionBody(response: PublicResponse): Promise<JudgeSession> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const value = await body(response);
  assert.ok(exact(value, ['version', 'state', 'expires_at_ms', 'quota']), 'Closed session fields');
  assert.ok(value.version === 'judge-session-v1', 'Session wire version');
  if (value.state === 'anonymous') {
    assert.ok(value.expires_at_ms === null && value.quota === null, 'Anonymous session fields');
    return { version: 'judge-session-v1', state: 'anonymous', expires_at_ms: null, quota: null };
  }
  assert.ok(value.state === 'active', 'Known session state');
  assert.ok(typeof value.expires_at_ms === 'number' && Number.isSafeInteger(value.expires_at_ms)
    && value.expires_at_ms >= 0 && value.expires_at_ms % 1000 === 0, 'Whole-second finite expiry');
  quota(value.quota);
  return { version: 'judge-session-v1', state: 'active', expires_at_ms: value.expires_at_ms, quota: value.quota };
}
async function active(response: PublicResponse): Promise<ActiveJudgeSession> {
  const value = await sessionBody(response);
  assert.ok(value.state === 'active', 'Authenticated session');
  return value;
}
async function portalError(response: PublicResponse, kind: string, status: number): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const value = await body(response);
  assert.ok(exact(value, ['version', 'error']) && value.version === 'judge-error-v1'
    && exact(value.error, ['kind']) && value.error.kind === kind, 'Closed portal error');
}
async function decisionError(response: PublicResponse, kind: DecisionErrorKind, status: number): Promise<void> {
  assert.equal(response.status, status);
  const value = await body(response);
  assert.ok(isDecisionError(value, status) && value.error.kind === kind, 'Original closed Decision error');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
}
async function config(fixture: JudgeRuntimeFixture, cookie?: string, cap = 0): Promise<void> {
  const response = await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal(response.status, 200);
  const value = await body(response);
  assert.ok(isDecisionConfig(value), 'Original closed Decision config');
  assert.deepEqual(value, { version: 'decision-config-v1', enabled: cap > 0, session_cap: cap });
}
function cookieFrom(response: PublicResponse, expires: number): string {
  const header = response.headers.get('set-cookie');
  assert.ok(typeof header === 'string', 'Session cookie is set');
  const pair = header.split(';', 1)[0]!;
  const token = pair.slice(cookieName.length + 1);
  assert.ok(pair.startsWith(cookieName + '=') && /^[A-Za-z0-9_-]{43}$/.test(token)
    && Buffer.from(token, 'base64url').toString('base64url') === token, 'Opaque canonical 32-byte token');
  const attributes = header.split(';').slice(1).map(value => value.trim());
  assert.ok(attributes.length === 5 && ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Expires=' + new Date(expires).toUTCString()]
    .every(value => attributes.includes(value)), 'Protected host cookie and exact finite Expires');
  assert.ok(!/\b(?:Max-Age|Domain)\s*=/i.test(header), 'No competing expiry or domain');
  assert.ok(token !== code && token !== otherCode, 'Token is independent from shared code');
  return pair;
}
function cleared(response: PublicResponse): void {
  const header = response.headers.get('set-cookie');
  assert.ok(typeof header === 'string' && header.startsWith(cookieName + '=;'), 'Invalid cookie is cleared');
  assert.ok(header.includes('Secure') && header.includes('HttpOnly') && header.includes('SameSite=Strict')
    && header.includes('Path=/') && header.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    && !/\b(?:Max-Age|Domain)\s*=/i.test(header), 'Clearing preserves host protection');
}
async function login(fixture: JudgeRuntimeFixture, cookie?: string, secret = code): Promise<{ cookie: string; session: ActiveJudgeSession }> {
  const response = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json; charset=utf-8', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ version: 'judge-login-v1', code: secret }),
  });
  const session = await active(response);
  return { cookie: cookieFrom(response, session.expires_at_ms), session };
}
function submit(fixture: JudgeRuntimeFixture, cookie?: string, request: unknown = decisionRequest(), headers: Record<string, string> = {}) {
  return fixture.runtime.dispatchFetch(origin + '/api/decision', { method: 'POST',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(request) });
}
async function success(response: PublicResponse, request: DecisionRequest = decisionRequest()): Promise<void> {
  assert.equal(response.status, 200);
  const value = await body(response);
  assert.ok(isModelDecision(value, request), 'Original native Decision projection');
  assert.ok(value.choice === 'heed_warning', 'Legal fake provider choice');
  assert.deepEqual(value.usage, { input_tokens: 23, output_tokens: 1 });
}
async function counts(fixture: JudgeRuntimeFixture, cookie: string, utcDay = day): Promise<{ session: number; daily: number }> {
  const sql = await fixture.storage();
  const sessionRows = await sql.exec<{ admitted: number }>('SELECT admitted FROM sessions WHERE token_sha256 = ?', hash(cookie.slice(cookieName.length + 1)));
  assert.equal(sessionRows.length, 1);
  const dailyRows = await sql.exec<{ admitted: number }>('SELECT admitted FROM daily WHERE utc_day = ?', utcDay);
  return { session: sessionRows[0]!.admitted, daily: dailyRows[0]?.admitted ?? 0 };
}
async function seedCounts(fixture: JudgeRuntimeFixture, cookie: string, session: number, daily: number, utcDay = day): Promise<void> {
  const sql = await fixture.storage();
  await sql.exec('UPDATE sessions SET admitted = ? WHERE token_sha256 = ?', session, hash(cookie.slice(cookieName.length + 1)));
  await sql.exec('INSERT INTO daily (utc_day, admitted) VALUES (?, ?) ON CONFLICT(utc_day) DO UPDATE SET admitted = excluded.admitted', utcDay, daily);
}
function streamed(fixture: JudgeRuntimeFixture, path: string, bytes: Uint8Array, cookie?: string, contentType = 'application/json') {
  const tools = requireTools('miniflare') as typeof RuntimeTools;
  let offset = 0;
  const request = new tools.Request(origin + path, { method: 'POST', duplex: 'half',
    headers: { Origin: origin, 'Content-Type': contentType, ...(cookie ? { Cookie: cookie } : {}) },
    body: new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset === bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 17, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end)); offset = end;
    } }),
  });
  assert.equal(request.headers.get('content-length'), null);
  return fixture.runtime.dispatchFetch(request);
}

test('judge runtime is isolated to the prepared loopback-only namespace', () => {
  assert.deepEqual(Object.keys(networkInterfaces()).sort(), ['lo'], 'Use scripts/offline-gates.sh');
  assert.ok(networkInterfaces().lo?.every(address => address.internal));
});

test('checked default fetch and declarative native JudgeGate execute real SQLite, portal, assets and one native-shaped AI dispatch', async () => {
  await fixtureCase(async fixture => {
    const anonymous = await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: navigation });
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get('location'), '/judge/login');
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');
    assert.equal(anonymous.headers.get('set-cookie'), null);
    const page = await fixture.runtime.dispatchFetch(origin + '/judge/login');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok((page.headers.get('content-type') ?? '').startsWith('text/html'));
    await page.body?.cancel();
    assert.equal((await sessionBody(await fixture.runtime.dispatchFetch(origin + '/api/judge/session'))).state, 'anonymous');
    await config(fixture);
    await decisionError(await submit(fixture), 'disabled', 503);
    assert.equal(fixture.calls.length, 0);
    const authenticated = await login(fixture);
    assert.equal(authenticated.session.expires_at_ms, Math.floor(now / 1000) * 1000 + 86400000);
    assert.deepEqual(authenticated.session.quota, { utc_day: day, reset_at_ms: Date.parse('2026-11-24T00:00:00Z'),
      daily_limit: 40, daily_remaining: 40, session_limit: 10, session_remaining: 10 });
    await config(fixture, authenticated.cookie, 10);
    const root = await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: { ...navigation, Cookie: authenticated.cookie } });
    assert.equal(root.status, 200);
    assert.ok((root.headers.get('content-type') ?? '').startsWith('text/html'));
    assert.ok(Buffer.from(await root.arrayBuffer()).equals(await readFile(join(fixture.assetsDir, 'index.html'))), 'Existing checked game document');
    const assetNames = await readdir(join(fixture.assetsDir, 'assets'));
    for (const extension of ['.js', '.css', '.wasm']) {
      const name = assetNames.find(name => name.endsWith(extension));
      assert.ok(name, 'Checked static asset exists');
      const response = await fixture.runtime.dispatchFetch(origin + '/assets/' + name);
      assert.equal(response.status, 200);
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(await readFile(join(fixture.assetsDir, 'assets', name))), 'Anonymous static asset stays public');
    }
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    await success(await submit(fixture, authenticated.cookie));
    assert.equal(fixture.calls.length, 1);
    const request = decisionRequest();
    assert.ok(JSON.stringify(fixture.calls[0]) === JSON.stringify({ model: '@cf/cloudflare/clef', input: {
      model: 'clef', state: request.state, questions: { decision: { type: 'choice', instructions: request.instructions,
        criteria: Object.fromEntries(request.criteria.map(criterion => [criterion.id, criterion.label])) } },
    } }), 'Original native model/input transport, without prompt diagnostics');
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
    await config(fixture, authenticated.cookie, 9);
  });
});

test('SQLite preserves the two budget tables and permits only the additive session/operation claim table', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    const sql = await fixture.storage();
    // Pinned workerd owns the _cf_* names below; Miniflare's inspection wrapper
    // adds exactly __miniflare_do_name. Do not hide arbitrary application tables
    // behind a fixture/system prefix wildcard.
    const tables = await sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV', '_cf_EXTERNALS', '_cf_METADATA', '_cf_ALARM', '__miniflare_do_name') ORDER BY name");
    assert.ok(tables.length === 3 && tables[0]!.name === 'daily' && tables[1]!.name === 'obituary_claims'
      && tables[2]!.name === 'sessions', 'Only the approved three application tables');
    const sessionColumns = await sql.exec<{ name: string; pk: number }>('PRAGMA table_info(sessions)');
    assert.ok(sessionColumns.length === 4 && ['token_sha256', 'expires_at_ms', 'admitted', 'code_epoch']
      .every(name => sessionColumns.some(column => column.name === name)), 'Closed stored session columns');
    assert.ok(sessionColumns.some(column => column.name === 'token_sha256' && column.pk === 1), 'Token hash is primary key');
    const dailyColumns = await sql.exec<{ name: string; pk: number }>('PRAGMA table_info(daily)');
    assert.ok(dailyColumns.length === 2 && dailyColumns.some(column => column.name === 'utc_day' && column.pk === 1)
      && dailyColumns.some(column => column.name === 'admitted'), 'One UTC-day primary key, no session-per-day table');
    const claimColumns = await sql.exec<{ name: string; pk: number; notnull: number }>('PRAGMA table_info(obituary_claims)');
    assert.ok(claimColumns.length === 2 && claimColumns.some(column => column.name === 'token_sha256' && column.pk === 1 && column.notnull === 1)
      && claimColumns.some(column => column.name === 'operation_key' && column.pk === 2 && column.notnull === 1), 'Session/operation composite claim key only');
    const rows = await sql.exec('SELECT * FROM sessions');
    const token = authenticated.cookie.slice(cookieName.length + 1);
    assert.ok(rows.length === 1 && rows[0]!.token_sha256 === hash(token) && rows[0]!.code_epoch === hash(code), 'Only credential hashes are stored');
    assert.ok(rows.every(row => Object.values(row).every(value => value !== token && value !== code && value !== authenticated.cookie)), 'No plaintext credential in SQLite fields');
    assert.ok(/^[a-f0-9]{64}$/.test(String(rows[0]!.token_sha256)) && /^[a-f0-9]{64}$/.test(String(rows[0]!.code_epoch)), 'Canonical stored SHA256 values');
    await seedCounts(fixture, authenticated.cookie, 0, 0);
    const tokenHash = hash(token);
    const invalidSQL: [string, (string | number)[]][] = [
      ['UPDATE sessions SET admitted = ? WHERE token_sha256 = ?', [-1, tokenHash]],
      ['UPDATE sessions SET admitted = ? WHERE token_sha256 = ?', [11, tokenHash]],
      ['UPDATE sessions SET expires_at_ms = ? WHERE token_sha256 = ?', [-1, tokenHash]],
      ['UPDATE daily SET admitted = ? WHERE utc_day = ?', [-1, day]],
      ['UPDATE daily SET admitted = ? WHERE utc_day = ?', [41, day]],
      ['INSERT INTO sessions (token_sha256, expires_at_ms, admitted, code_epoch) VALUES (?, ?, 0, ?)', [tokenHash, authenticated.session.expires_at_ms, hash(code)]],
      ['INSERT INTO daily (utc_day, admitted) VALUES (?, 0)', [day]],
      ['INSERT INTO obituary_claims (token_sha256, operation_key) VALUES (?, ?)', [tokenHash, 'bad']],
      ['INSERT INTO obituary_claims (token_sha256, operation_key) VALUES (?, ?)', [tokenHash, 'A'.repeat(64)]],
    ];
    for (const [query, parameters] of invalidSQL) {
      let rejected = false;
      try { await sql.exec(query, ...parameters); }
      catch { rejected = true; }
      assert.ok(rejected, 'Real SQLite rejects a violated constraint');
    }
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    {
      const namespace: unknown = await fixture.runtime.getDurableObjectNamespace('JUDGE_GATE', fixture.workerName);
      assert.ok((typeof namespace === 'object' && namespace !== null) || typeof namespace === 'function', 'Actual SDK namespace is an object or callable proxy');
      const getByName: unknown = Reflect.get(namespace, 'getByName');
      assert.ok(typeof getByName === 'function', 'Actual SDK namespace exposes callable getByName');
      const gate: unknown = Reflect.apply(getByName, namespace, ['review-pool-v1']);
      assert.ok((typeof gate === 'object' && gate !== null) || typeof gate === 'function', 'Actual SDK actor stub is an object or callable proxy');
      const open: unknown = Reflect.get(gate, 'open');
      assert.ok(typeof open === 'function', 'Actual actor exposes the native open RPC method');
      let rejected = false;
      try { await Reflect.apply(open, gate, [token, null, hash(code)]); }
      catch { rejected = true; }
      assert.ok(rejected, 'Native RPC rejects a plaintext/nonhash token');
      assert.equal(fixture.calls.length, 0);
    }
  });
});

test('duplicate, malformed, noncanonical and unknown cookies are anonymous, clear on every protected surface and never dispatch', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    const invalid = [cookieName + '=', cookieName, cookieName + '=short', cookieName + '=' + unknownToken,
      authenticated.cookie + '; ' + authenticated.cookie, cookieName + '=' + code.slice(0, -1) + 'B', cookieName + '=' + unknownToken + '='];
    for (const cookie of invalid) {
      const status = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: cookie } });
      assert.equal((await sessionBody(status)).state, 'anonymous'); cleared(status);
      const root = await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: { ...navigation, Cookie: cookie } });
      assert.equal(root.status, 303); assert.equal(root.headers.get('location'), '/judge/login'); cleared(root);
      const cfg = await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: { Cookie: cookie } });
      const value = await body(cfg);
      assert.ok(isDecisionConfig(value) && !value.enabled && value.session_cap === 0, 'Invalid cookie disables model config'); cleared(cfg);
      const response = await submit(fixture, cookie);
      await decisionError(response, 'disabled', 503); cleared(response);
    }
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    assert.equal(fixture.calls.length, 0);
  });
});

test('same-Origin and Fetch Metadata checks reject portal/model mutations before admission; unsupported methods and API paths keep exact wires', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    for (const headers of [{}, { Origin: 'null' }, { Origin: 'https://other.test' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: origin, 'Sec-Fetch-Site': 'CrOsS-SiTe' }]) {
      for (const method of ['POST', 'DELETE']) {
        await portalError(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { method,
          headers: { Cookie: authenticated.cookie, 'Content-Type': 'application/json', ...headers },
          ...(method === 'POST' ? { body: JSON.stringify({ version: 'judge-login-v1', code }) } : {}) }), 'forbidden', 403);
      }
      await decisionError(await fixture.runtime.dispatchFetch(origin + '/api/decision', { method: 'POST',
        headers: { Cookie: authenticated.cookie, ...headers }, body: JSON.stringify(decisionRequest()) }), 'disabled', 503);
    }
    for (const [path, allow, portal] of [['/api/judge/session', 'GET, POST, DELETE', true], ['/judge/login', 'GET', true],
      ['/api/decision/config', 'GET', false], ['/api/decision', 'POST', false]] as const) {
      for (const method of ['PUT', 'OPTIONS']) {
        const response = await fixture.runtime.dispatchFetch(origin + path, { method });
        assert.equal(response.headers.get('allow'), allow);
        if (portal) await portalError(response, 'method_not_allowed', 405);
        else await decisionError(response, 'method_not_allowed', 405);
      }
      const response = await fixture.runtime.dispatchFetch(origin + path, { method: 'HEAD' });
      assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), allow); assert.equal(await response.text(), '');
    }
    for (const path of ['/api/judge', '/api/judge/unknown', '/api/judge/session/']) {
      await portalError(await fixture.runtime.dispatchFetch(origin + path), 'not_found', 404);
    }
    for (const path of ['/api', '/api/unknown', '/api/decision/', '/api/decision/config/']) {
      await decisionError(await fixture.runtime.dispatchFetch(origin + path), 'not_found', 404);
    }
    assert.equal(fixture.calls.length, 0);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    // Absence of Fetch Metadata is permitted when Origin is correct.
    await success(await submit(fixture, authenticated.cookie));
    assert.equal(fixture.calls.length, 1);
  });
});

test('login media type, exact JSON shape, canonical code, fatal UTF8 and streamed 256-byte cap reject without native dispatch', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    const attempts: { body: string; type: string; kind: string; status: number }[] = [
      { body: '{', type: 'application/json', kind: 'malformed_request', status: 400 },
      ...[{}, [], null, { version: 'wrong', code }, { version: 'judge-login-v1', code: 1 },
        { version: 'judge-login-v1', code, extra: true }, { version: 'judge-login-v1', code: code + ' ' },
        { version: 'judge-login-v1', code: code.slice(0, -1) + 'B' }]
        .map(value => ({ body: JSON.stringify(value), type: 'application/json', kind: 'malformed_request', status: 400 })),
      ...['text/plain', 'application/json; charset=latin1', 'application/json; extra=1', '']
        .map(type => ({ body: JSON.stringify({ version: 'judge-login-v1', code }), type, kind: 'malformed_request', status: 400 })),
      { body: JSON.stringify({ version: 'judge-login-v1', code: otherCode }), type: 'application/json', kind: 'invalid_code', status: 401 },
    ];
    for (const attempt of attempts) {
      await portalError(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { method: 'POST',
        headers: { Origin: origin, Cookie: authenticated.cookie, 'Content-Type': attempt.type }, body: attempt.body }), attempt.kind, attempt.status);
    }
    await portalError(await streamed(fixture, '/api/judge/session', Uint8Array.of(123, 34, 255, 34, 125), authenticated.cookie), 'malformed_request', 400);
    const encoded = new TextEncoder().encode(JSON.stringify({ version: 'judge-login-v1', code }));
    const atLimit = new Uint8Array(256).fill(32); atLimit.set(encoded);
    const response = await streamed(fixture, '/api/judge/session', atLimit, authenticated.cookie);
    const reused = await active(response);
    assert.ok(cookieFrom(response, reused.expires_at_ms) === authenticated.cookie, '256-byte login reuses token');
    const overLimit = new Uint8Array(257).fill(32); overLimit.set(encoded);
    await portalError(await streamed(fixture, '/api/judge/session', overLimit, authenticated.cookie), 'payload_too_large', 413);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    assert.equal(fixture.calls.length, 0);
  });
});

test('original Decision validation and actual 16385 streamed UTF8 bytes spend zero; a closed 16384-byte request dispatches exactly once', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    const request = decisionRequest();
    for (const invalid of [{ ...request, extra: true }, { ...request, mapping_hash: 'wrong' },
      { ...request, metadata: { bridge_version: 'wrong' } }, { ...request, criteria: [request.criteria[0], request.criteria[0]] },
      { ...request, state: { unexpected: true } }]) {
      await decisionError(await submit(fixture, authenticated.cookie, invalid), 'malformed_request', 400);
    }
    await decisionError(await streamed(fixture, '/api/decision', new TextEncoder().encode('{'), authenticated.cookie), 'malformed_request', 400);
    await decisionError(await streamed(fixture, '/api/decision', Uint8Array.of(123, 34, 255, 34, 125), authenticated.cookie), 'malformed_request', 400);
    request.state = '界😀é';
    request.state += 'a'.repeat(16384 - new TextEncoder().encode(JSON.stringify(request)).byteLength);
    const exactBytes = new TextEncoder().encode(JSON.stringify(request));
    const over = { ...request, state: request.state + 'a' };
    assert.ok(isDecisionRequest(request) && isDecisionRequest(over), 'Both transport boundaries satisfy original Decision schema');
    const overBytes = new TextEncoder().encode(JSON.stringify(over));
    assert.equal(exactBytes.byteLength, 16384); assert.equal(overBytes.byteLength, 16385);
    await decisionError(await streamed(fixture, '/api/decision', overBytes, authenticated.cookie), 'payload_too_large', 413);
    assert.equal(fixture.calls.length, 0);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    await success(await streamed(fixture, '/api/decision', exactBytes, authenticated.cookie), request);
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
  });
});

test('two concurrent HTTP decisions race for the final session-lifetime slot: one native dispatch, original 429 and no rejected increment', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await seedCounts(fixture, authenticated.cookie, 9, 9);
    await config(fixture, authenticated.cookie, 1);
    const responses = await Promise.all([submit(fixture, authenticated.cookie), submit(fixture, authenticated.cookie)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
    for (const response of responses) {
      if (response.status === 200) await success(response);
      else await decisionError(response, 'rate_limited', 429);
    }
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 10, daily: 10 });
    await config(fixture, authenticated.cookie);
    await decisionError(await submit(fixture, authenticated.cookie, { invalid: true }), 'malformed_request', 400);
    await decisionError(await submit(fixture, authenticated.cookie), 'rate_limited', 429);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 10, daily: 10 });
    assert.equal(fixture.calls.length, 1);
  });
});

test('distinct sessions race for the final shared UTC-day slot: losing session is unchanged and shared cap never becomes provider quota', async () => {
  await fixtureCase(async fixture => {
    const first = await login(fixture);
    const second = await login(fixture);
    assert.ok(first.cookie !== second.cookie, 'Independent reviewer tokens');
    await seedCounts(fixture, first.cookie, 0, 39);
    await config(fixture, first.cookie, 1); await config(fixture, second.cookie, 1);
    const cookies = [first.cookie, second.cookie];
    const responses = await Promise.all(cookies.map(cookie => submit(fixture, cookie)));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
    for (let index = 0; index < responses.length; index++) {
      const response = responses[index]!;
      if (response.status === 200) await success(response);
      else await decisionError(response, 'rate_limited', 429);
      assert.deepEqual(await counts(fixture, cookies[index]!), { session: response.status === 200 ? 1 : 0, daily: 40 });
    }
    assert.equal(fixture.calls.length, 1);
    for (const cookie of cookies) {
      await config(fixture, cookie);
      await decisionError(await submit(fixture, cookie), 'rate_limited', 429);
    }
    const sql = await fixture.storage();
    const total = await sql.exec<{ admitted: number }>('SELECT SUM(admitted) AS admitted FROM sessions');
    assert.equal(total[0]!.admitted, 1);
    assert.equal(fixture.calls.length, 1);
  });
});

test('refresh, repeated login and fixture clock reload keep exactly the same token, expiry and lifetime admissions', async () => {
  await fixtureCase(async fixture => {
    const first = await login(fixture);
    await success(await submit(fixture, first.cookie));
    await fixture.setTime(now + 5000);
    const status = await active(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: first.cookie } }));
    assert.equal(status.expires_at_ms, first.session.expires_at_ms);
    assert.equal(status.quota.session_remaining, 9); assert.equal(status.quota.daily_remaining, 39);
    const root = await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: { ...navigation, Cookie: first.cookie } });
    assert.equal(root.status, 200); await root.body?.cancel();
    const repeated = await login(fixture, first.cookie);
    assert.ok(repeated.cookie === first.cookie, 'Repeated login preserves token identity');
    assert.equal(repeated.session.expires_at_ms, first.session.expires_at_ms);
    assert.deepEqual(repeated.session.quota, status.quota);
    assert.deepEqual(await counts(fixture, first.cookie), { session: 1, daily: 1 });
    assert.equal(fixture.calls.length, 1);
  });
});

test('expiry is enforced at the exact whole-second timestamp on status/root/config/model and never dispatches or refunds', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await seedCounts(fixture, authenticated.cookie, 1, 1);
    await fixture.setTime(authenticated.session.expires_at_ms - 1);
    await config(fixture, authenticated.cookie, 9);
    await fixture.setTime(authenticated.session.expires_at_ms);
    const status = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: authenticated.cookie } });
    assert.equal((await sessionBody(status)).state, 'anonymous'); cleared(status);
    const root = await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: { ...navigation, Cookie: authenticated.cookie } });
    assert.equal(root.status, 303); cleared(root);
    const cfg = await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: { Cookie: authenticated.cookie } });
    const value = await body(cfg); assert.ok(isDecisionConfig(value) && !value.enabled && value.session_cap === 0); cleared(cfg);
    const response = await submit(fixture, authenticated.cookie); await decisionError(response, 'disabled', 503); cleared(response);
    const sql = await fixture.storage();
    const daily = await sql.exec<{ admitted: number }>('SELECT admitted FROM daily WHERE utc_day = ?', day);
    assert.equal(daily[0]!.admitted, 1);
    assert.equal(fixture.calls.length, 0);
  });
});

test('logout revokes and clears without daily refund; stale token stays anonymous and a new login uses the unchanged pool', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await success(await submit(fixture, authenticated.cookie));
    const response = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { method: 'DELETE', headers: { Origin: origin, Cookie: authenticated.cookie } });
    assert.equal(response.status, 204); assert.equal(await response.text(), ''); assert.equal(response.headers.get('cache-control'), 'no-store'); cleared(response);
    const sql = await fixture.storage();
    const revoked = await sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM sessions WHERE token_sha256 = ?', hash(authenticated.cookie.slice(cookieName.length + 1)));
    assert.equal(revoked[0]!.count, 0);
    const status = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: authenticated.cookie } });
    assert.equal((await sessionBody(status)).state, 'anonymous'); cleared(status);
    await decisionError(await submit(fixture, authenticated.cookie), 'disabled', 503);
    const newLogin = await login(fixture, authenticated.cookie);
    assert.ok(newLogin.cookie !== authenticated.cookie, 'Revoked token is not reused');
    assert.equal(newLogin.session.quota.daily_remaining, 39); assert.equal(newLogin.session.quota.session_remaining, 10);
    assert.deepEqual(await counts(fixture, newLogin.cookie), { session: 0, daily: 1 });
    for (const cookie of [undefined, cookieName + '=short']) {
      const deleted = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { method: 'DELETE', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
      assert.equal(deleted.status, 204); assert.equal(await deleted.text(), ''); cleared(deleted);
    }
    assert.equal(fixture.calls.length, 1);
  });
});

test('UTC midnight restores only the shared day allowance; a surviving lifetime-exhausted session remains at ten', async () => {
  const beforeMidnight = Date.parse('2026-11-23T23:59:59.789Z');
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await seedCounts(fixture, authenticated.cookie, 9, 39);
    await success(await submit(fixture, authenticated.cookie));
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 10, daily: 40 });
    await fixture.setTime(Date.parse('2026-11-24T00:00:00.000Z'));
    const status = await active(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: authenticated.cookie } }));
    assert.equal(status.expires_at_ms, authenticated.session.expires_at_ms);
    assert.deepEqual(status.quota, { utc_day: '2026-11-24', reset_at_ms: Date.parse('2026-11-25T00:00:00Z'),
      daily_limit: 40, daily_remaining: 40, session_limit: 10, session_remaining: 0 });
    await config(fixture, authenticated.cookie);
    await decisionError(await submit(fixture, authenticated.cookie), 'rate_limited', 429);
    assert.deepEqual(await counts(fixture, authenticated.cookie, '2026-11-24'), { session: 10, daily: 0 });
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 10, daily: 40 });
    const repeated = await login(fixture, authenticated.cookie);
    assert.ok(repeated.cookie === authenticated.cookie, 'Midnight login cannot create a fresh lifetime');
    assert.equal(repeated.session.quota.session_remaining, 0); assert.equal(repeated.session.expires_at_ms, authenticated.session.expires_at_ms);
    const fresh = await login(fixture);
    await success(await submit(fixture, fresh.cookie));
    assert.deepEqual(await counts(fixture, fresh.cookie, '2026-11-24'), { session: 1, daily: 1 });
    assert.deepEqual(await counts(fixture, authenticated.cookie, '2026-11-24'), { session: 10, daily: 1 });
    assert.equal(fixture.calls.length, 2);
  }, { nowMs: beforeMidnight });
});

test('owned SQLite directory survives eviction, module reload, complete runtime reopen and secret rotation with stable class/pool identity', async () => {
  const persistencePath = await mkdtemp(join(tmpdir(), 'judge-reopen-'));
  let fixture: JudgeRuntimeFixture | undefined;
  try {
    fixture = await judgeRuntimeFixture({ persistencePath, nowMs: now, variables: { JUDGE_CODE: code } });
    const first = await login(fixture);
    await success(await submit(fixture, first.cookie));
    await success(await submit(fixture, first.cookie));
    assert.equal(fixture.calls.length, 2);
    const workerName = fixture.workerName;
    await fixture.evict();
    await config(fixture, first.cookie, 8);
    assert.deepEqual(await counts(fixture, first.cookie), { session: 2, daily: 2 });
    await fixture.setTime(now + 1000);
    await config(fixture, first.cookie, 8);
    await fixture.dispose(); fixture = undefined;
    fixture = await judgeRuntimeFixture({ persistencePath, nowMs: now + 2000, variables: { JUDGE_CODE: code } });
    assert.equal(fixture.workerName, workerName); assert.equal(fixture.persistencePath, persistencePath);
    assert.equal(fixture.calls.length, 0, 'Reopening resets only the observed fixture dispatch recorder');
    const reopened = await login(fixture, first.cookie);
    assert.ok(reopened.cookie === first.cookie, 'Reopened checked bundle reuses persisted token');
    assert.equal(reopened.session.expires_at_ms, first.session.expires_at_ms);
    assert.deepEqual(await counts(fixture, first.cookie), { session: 2, daily: 2 });
    await success(await submit(fixture, first.cookie));
    assert.deepEqual(await counts(fixture, first.cookie), { session: 3, daily: 3 });
    assert.equal(fixture.calls.length, 1);
    await fixture.dispose(); fixture = undefined;
    fixture = await judgeRuntimeFixture({ persistencePath, nowMs: now + 3000, variables: { JUDGE_CODE: otherCode } });
    assert.equal(fixture.workerName, workerName);
    const status = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: first.cookie } });
    assert.equal((await sessionBody(status)).state, 'anonymous'); cleared(status);
    const root = await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: { ...navigation, Cookie: first.cookie } });
    assert.equal(root.status, 303); cleared(root);
    const cfg = await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: { Cookie: first.cookie } });
    const cfgBody = await body(cfg); assert.ok(isDecisionConfig(cfgBody) && !cfgBody.enabled && cfgBody.session_cap === 0); cleared(cfg);
    const denied = await submit(fixture, first.cookie); await decisionError(denied, 'disabled', 503); cleared(denied);
    await portalError(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 'judge-login-v1', code }) }), 'invalid_code', 401);
    const rotated = await login(fixture, first.cookie, otherCode);
    assert.ok(rotated.cookie !== first.cookie, 'Rotated epoch creates a different protected token');
    assert.equal(rotated.session.quota.daily_remaining, 37); assert.equal(rotated.session.quota.session_remaining, 10);
    assert.deepEqual(await counts(fixture, rotated.cookie), { session: 0, daily: 3 });
    const sql = await fixture.storage();
    const stored = await sql.exec('SELECT token_sha256, code_epoch FROM sessions WHERE token_sha256 = ?', hash(rotated.cookie.slice(cookieName.length + 1)));
    assert.ok(stored.length === 1 && stored[0]!.code_epoch === hash(otherCode), 'Rotated epoch remains internal SHA256 only');
    assert.equal(fixture.calls.length, 0);
  } finally {
    try { if (fixture) await fixture.dispose(); }
    finally { await rm(persistencePath, { recursive: true, force: true }); }
  }
});

for (const scenario of [
  { label: 'provider 500', status: 500, result: nativeResult(), kind: 'model_error' as const, responseStatus: 502 },
  { label: 'illegal native answer', status: 200, result: { ...nativeResult(), answers: { decision: { type: 'choice', choice: 'illegal' } } }, kind: 'invalid_response' as const, responseStatus: 502 },
  { label: 'invalid native usage', status: 200, result: { ...nativeResult(), usage: { input_tokens: -1, output_tokens: 1 } }, kind: 'invalid_response' as const, responseStatus: 502 },
  { label: 'provider 429', status: 429, result: nativeResult(), kind: 'rate_limited' as const, responseStatus: 429 },
]) {
  test(`${scenario.label} consumes every application admission without refund or automatic native retry`, async () => {
    await fixtureCase(async fixture => {
      const authenticated = await login(fixture);
      for (let admitted = 1; admitted <= 2; admitted++) {
        await decisionError(await submit(fixture, authenticated.cookie), scenario.kind, scenario.responseStatus);
        assert.deepEqual(await counts(fixture, authenticated.cookie), { session: admitted, daily: admitted });
        assert.equal(fixture.calls.length, admitted);
        await config(fixture, authenticated.cookie, 10 - admitted);
      }
    }, { status: scenario.status, result: scenario.result });
  });
}

test('a direct native binding reserve on the same SQLite actor spends one admission with zero observed AI dispatch', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    {
      // Native Node binding proxies are managed by the SDK proxy heap, not
      // Disposable capabilities; RPC wire objects are returned by value.
      const namespace: unknown = await fixture.runtime.getDurableObjectNamespace('JUDGE_GATE', fixture.workerName);
      assert.ok((typeof namespace === 'object' && namespace !== null) || typeof namespace === 'function', 'Actual SDK namespace is an object or callable proxy');
      const getByName: unknown = Reflect.get(namespace, 'getByName');
      assert.ok(typeof getByName === 'function', 'Actual SDK namespace exposes callable getByName');
      const gate: unknown = Reflect.apply(getByName, namespace, ['review-pool-v1']);
      assert.ok((typeof gate === 'object' && gate !== null) || typeof gate === 'function', 'Actual SDK actor stub is an object or callable proxy');
      const reserve: unknown = Reflect.get(gate, 'reserve');
      assert.ok(typeof reserve === 'function', 'Actual actor exposes the native reserve RPC method');
      const reservation: unknown = await Reflect.apply(reserve, gate, [hash(authenticated.cookie.slice(cookieName.length + 1)), hash(code)]);
      assert.ok(exact(reservation, ['kind', 'quota']) && reservation.kind === 'admitted', 'Actual native RPC admission');
      quota(reservation.quota);
      assert.equal(reservation.quota.session_remaining, 9); assert.equal(reservation.quota.daily_remaining, 39);
      assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
      assert.equal(fixture.calls.length, 0, 'Admission is not an observed model dispatch');
    }
    // The pinned Node ProxyStubHandler hides all symbol properties and releases
    // heap references through GC or the public setOptions lifecycle. Use the
    // latter deterministically: same fixture time, checked bytes and SQLite root.
    // SDK Runtime.updateConfig disposes old workerd before starting the new one.
    await fixture.setTime(now);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
    await fixture.evict();
    await config(fixture, authenticated.cookie, 9);
    await success(await submit(fixture, authenticated.cookie));
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 2, daily: 2 });
    assert.equal(fixture.calls.length, 1);
  });
});

test('a rejected connection after native RPC commit is unavailable, spends one slot, dispatches zero and never retries admission', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    assert.equal(fixture.reserveAttempts, 0);
    await decisionError(await submit(fixture, authenticated.cookie), 'unavailable', 503);
    assert.equal(fixture.reserveAttempts, 1, 'Exactly one ambiguous reserve RPC attempt');
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
    assert.equal(fixture.calls.length, 0, 'Committed admission has no observed native dispatch');
    await config(fixture, authenticated.cookie, 9);
    const status = await active(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: authenticated.cookie } }));
    assert.equal(status.quota.session_remaining, 9); assert.equal(status.quota.daily_remaining, 39);
    assert.equal(fixture.reserveAttempts, 1, 'Status/config cannot replay an ambiguous admission');
    await fixture.evict();
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
    // This is an explicit new reviewer request, not a retry performed by the router.
    await success(await submit(fixture, authenticated.cookie));
    assert.equal(fixture.reserveAttempts, 2);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 2, daily: 2 });
    assert.equal(fixture.calls.length, 1);
  }, { reserveFault: 'reject-after-commit' });
});

test('actual SQLite snapshot failure is unavailable on portal/root/config/model and logout never reports a failed revocation as success', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await seedCounts(fixture, authenticated.cookie, 0, 0);
    const sql = await fixture.storage();
    // SQL CHECK permits this in-range REAL, while the native gate correctly
    // refuses a counter that is not a safe integer. No product hook is added.
    await sql.exec('UPDATE daily SET admitted = 0.5 WHERE utc_day = ?', day);
    await portalError(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: authenticated.cookie } }), 'unavailable', 503);
    await decisionError(await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: { ...navigation, Cookie: authenticated.cookie } }), 'unavailable', 503);
    await decisionError(await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: { Cookie: authenticated.cookie } }), 'unavailable', 503);
    await decisionError(await submit(fixture, authenticated.cookie), 'unavailable', 503);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0.5 });
    assert.equal(fixture.calls.length, 0);
    // Deliberately damage only this case's owned SQLite schema to force a
    // genuine revoke RPC rejection rather than simulating a 204 response.
    await sql.exec('DROP TABLE sessions');
    const deleted = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { method: 'DELETE',
      headers: { Origin: origin, Cookie: authenticated.cookie } });
    await portalError(deleted, 'unavailable', 503);
    assert.equal(deleted.headers.get('set-cookie'), null, 'Failed revocation cannot claim successful cookie clearing');
    const daily = await sql.exec<{ admitted: number }>('SELECT admitted FROM daily WHERE utc_day = ?', day);
    assert.equal(daily[0]!.admitted, 0.5);
    assert.equal(fixture.calls.length, 0);
  });
});

test('checked production HTTP has no quota/time/reset/reserve controls and query/header credentials do not authenticate', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await seedCounts(fixture, authenticated.cookie, 9, 39);
    for (const path of ['/api/judge/reset', '/api/judge/time', '/api/judge/quota', '/api/judge/reserve', '/api/judge/admin', '/api/judge/fixture']) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        await portalError(await fixture.runtime.dispatchFetch(origin + path, { method,
          headers: { Origin: origin, Cookie: authenticated.cookie, 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: JSON.stringify({ now: 0, daily: 0, session: 0 }) } : {}) }), 'not_found', 404);
      }
    }
    await decisionError(await fixture.runtime.dispatchFetch(origin + '/api/decision', { method: 'POST',
      headers: { Origin: origin, Authorization: 'Bearer ' + unknownToken, 'X-Judge-Code': code },
      body: JSON.stringify(decisionRequest()) }), 'disabled', 503);
    const query = await fixture.runtime.dispatchFetch(origin + '/api/judge/session?code=' + code + '&token=' + unknownToken);
    assert.equal((await sessionBody(query)).state, 'anonymous');
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 9, daily: 39 });
    assert.equal(fixture.calls.length, 0);
  });
});

for (const variables of [{ JUDGE_CODE: '' }, { INFERENCE_ENABLED: 'false' }, { SESSION_CAP: '11' },
  { JUDGE_DAILY_CAP: '41' }, { JUDGE_SESSION_TTL_SECONDS: '0' }, { MAX_REQUEST_BYTES: '16385' }]) {
  test(`required judge prerequisite ${Object.keys(variables)[0]} fails closed without native dispatch`, async () => {
    await fixtureCase(async fixture => {
      await portalError(await fixture.runtime.dispatchFetch(origin + '/api/judge/session'), 'unavailable', 503);
      await decisionError(await fixture.runtime.dispatchFetch(origin + '/api/decision/config'), 'disabled', 503);
      await decisionError(await submit(fixture), 'disabled', 503);
      const root = await fixture.runtime.dispatchFetch(origin + '/', { redirect: 'manual', headers: navigation });
      await decisionError(root, 'unavailable', 503);
      assert.equal(fixture.calls.length, 0);
    }, { variables });
  });
}

test('native narration capability and authenticated POST use one pinned dispatch and the same Clef accounting pool', async () => {
  await fixtureCase(async fixture => {
    await narrationError(await fixture.runtime.dispatchFetch(origin + '/api/judge/obituary/config'), 'anonymous', 401);
    await narrationError(await submitObituary(fixture), 'anonymous', 401);
    assert.equal(fixture.calls.length, 0);
    const authenticated = await login(fixture);
    const capabilityResponse = await fixture.runtime.dispatchFetch(origin + '/api/judge/obituary/config', { headers: { Cookie: authenticated.cookie } });
    assert.equal(capabilityResponse.status, 200);
    const capability = parseObituaryCapability(await body(capabilityResponse));
    assert.ok(capability?.enabled && capability.model === OBITUARY_MODEL && capability.timeout_ms === 10000);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    const response = await submitObituary(fixture, authenticated.cookie);
    assert.equal(response.status, 200);
    const reply = parseObituaryReply(await body(response));
    assert.ok(reply?.result.source === 'model' && reply.operationKey === obituaryRequest().operationKey);
    assert.equal(reply.quota.session_remaining, 9);
    assert.equal(reply.quota.daily_remaining, 39);
    assert.equal(fixture.calls.length, 1);
    assert.ok(JSON.stringify(fixture.calls[0]) === JSON.stringify({ model: OBITUARY_MODEL, input: {
      messages: [{ role: 'system', content: OBITUARY_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(obituaryFacts) }],
      max_tokens: 256, temperature: 0.3, stream: false,
    } }), 'Pinned narration receives closed facts only, never operation/session transport fields');
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'duplicate', 409);
    await success(await submit(fixture, authenticated.cookie));
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 2, daily: 2 });
    const claims = await (await fixture.storage()).exec('SELECT * FROM obituary_claims');
    assert.ok(claims.length === 1 && claims[0]!.operation_key === obituaryRequest().operationKey
      && claims[0]!.token_sha256 === hash(authenticated.cookie.slice(cookieName.length + 1)), 'Only a hash-bound operation claim is persisted');
  });
});

test('two concurrent native narration requests for one operation atomically claim and infer once', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    const responses = await Promise.all([submitObituary(fixture, authenticated.cookie), submitObituary(fixture, authenticated.cookie)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    for (const response of responses) {
      if (response.status === 409) await narrationError(response, 'duplicate', 409);
      else assert.ok(parseObituaryReply(await body(response))?.result.source === 'model');
    }
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
    assert.equal(fixture.calls.length, 1);
    await seedCounts(fixture, authenticated.cookie, 10, 40);
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'duplicate', 409);
    await narrationError(await submitObituary(fixture, authenticated.cookie, obituaryRequest('b'.repeat(64))), 'quota_exhausted', 429);
    assert.equal((await (await fixture.storage()).exec('SELECT * FROM obituary_claims')).length, 1);
    assert.equal(fixture.calls.length, 1);
  });
});

test('a Clef decision and narration race for the final unchanged shared session allowance', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await seedCounts(fixture, authenticated.cookie, 9, 39);
    const [decision, narration] = await Promise.all([submit(fixture, authenticated.cookie), submitObituary(fixture, authenticated.cookie)]);
    assert.deepEqual([decision.status, narration.status].sort(), [200, 429]);
    if (decision.status === 200) await success(decision); else await decisionError(decision, 'rate_limited', 429);
    if (narration.status === 200) assert.ok(parseObituaryReply(await body(narration)));
    else await narrationError(narration, 'quota_exhausted', 429);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 10, daily: 40 });
    assert.equal(fixture.calls.length, 1);
  });
});

test('claim insertion and both budget increments roll back together when SQLite rejects a counter update', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    const sql = await fixture.storage();
    await sql.exec("CREATE TRIGGER reject_narration_count BEFORE UPDATE OF admitted ON sessions BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'admission_unavailable', 503);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    assert.equal((await sql.exec('SELECT * FROM obituary_claims')).length, 0);
    assert.equal(fixture.calls.length, 0);
    await sql.exec('DROP TRIGGER reject_narration_count');
  });
});

test('committed native narration transport failure remains spent, duplicate never retries inference', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'admission_unavailable', 503);
    assert.equal(fixture.reserveAttempts, 1);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
    assert.equal(fixture.calls.length, 0);
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'duplicate', 409);
    assert.equal(fixture.reserveAttempts, 2);
    assert.equal(fixture.calls.length, 0);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
  }, { reserveFault: 'reject-after-commit' });
});

for (const [name, result, status, reason] of [
  ['non-200', { response: 'unusable' }, 500, 'provider_error'],
  ['missing response', {}, 200, 'invalid_output'],
  ['nonempty tool calls', { response: 'unusable', tool_calls: [{ name: 'tool' }] }, 200, 'invalid_output'],
  ['oversized raw JSON', { response: 'x'.repeat(8192) }, 200, 'provider_error'],
] as const) test(`native narration ${name} returns one terminal exact template with committed quota`, async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    const response = await submitObituary(fixture, authenticated.cookie);
    assert.equal(response.status, 200);
    const reply = parseObituaryReply(await body(response));
    assert.ok(reply?.result.source === 'template' && reply.result.fallbackReason === reason);
    assert.equal(reply.result.text, renderObituaryTemplate(obituaryFacts));
    assert.equal(reply.result.model, OBITUARY_MODEL);
    assert.equal(reply.quota.session_remaining, 9);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 1, daily: 1 });
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'duplicate', 409);
    assert.equal(fixture.calls.length, 1);
  }, { result, status });
});

test('native narration rejects CSRF, unknown nested request keys and streamed 16385 bytes without claims or AI', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    for (const Origin of ['', 'null', 'https://foreign.test']) {
      await narrationError(await submitObituary(fixture, authenticated.cookie, obituaryRequest(), { Origin }), 'request_invalid', 403);
    }
    await narrationError(await submitObituary(fixture, authenticated.cookie, { ...obituaryRequest(), prompt: 'no' }), 'request_invalid', 400);
    await narrationError(await submitObituary(fixture, authenticated.cookie, {
      ...obituaryRequest(), facts: { ...obituaryFacts, deceased: { ...obituaryFacts.deceased, instructions: 'no' } },
    }), 'request_invalid', 400);
    await narrationError(await streamed(fixture, '/api/obituary', new TextEncoder().encode(' '.repeat(16385)), authenticated.cookie), 'request_too_large', 413);
    await narrationError(await streamed(fixture, '/api/obituary', new Uint8Array([0xff]), authenticated.cookie), 'request_invalid', 400);
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 0, daily: 0 });
    assert.equal((await (await fixture.storage()).exec('SELECT * FROM obituary_claims')).length, 0);
    assert.equal(fixture.calls.length, 0);
    const encoded = JSON.stringify(obituaryRequest());
    const exactBytes = Buffer.concat([Buffer.from(encoded), Buffer.alloc(16384 - Buffer.byteLength(encoded), 0x20)]);
    const response = await streamed(fixture, '/api/obituary', exactBytes, authenticated.cookie);
    assert.equal(response.status, 200);
    assert.ok(parseObituaryReply(await body(response)));
    assert.equal(fixture.calls.length, 1);
  });
});

test('narration claims survive actor eviction but expire and revoke with their original session without refunds', async () => {
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await (await submitObituary(fixture, authenticated.cookie)).body?.cancel();
    await fixture.evict();
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'duplicate', 409);
    await fixture.setTime(authenticated.session.expires_at_ms);
    await narrationError(await submitObituary(fixture, authenticated.cookie), 'anonymous', 401);
    assert.equal((await (await fixture.storage()).exec('SELECT * FROM obituary_claims')).length, 0);
    const next = await login(fixture);
    await (await submitObituary(fixture, next.cookie)).body?.cancel();
    const logout = await fixture.runtime.dispatchFetch(origin + '/api/judge/session', {
      method: 'DELETE', headers: { Origin: origin, Cookie: next.cookie },
    });
    assert.equal(logout.status, 204);
    assert.equal((await (await fixture.storage()).exec('SELECT * FROM obituary_claims')).length, 0);
    assert.equal(fixture.calls.length, 2);
    const rows = await (await fixture.storage()).exec<{ admitted: number }>('SELECT admitted FROM daily ORDER BY utc_day');
    assert.equal(rows.reduce((sum, row) => sum + row.admitted, 0), 2);
  });
});

test('anonymous native status cleans only expired claims with primary-key probes despite retained claimless session history', async () => {
  const cleanupNow = Math.floor(now / 1000) * 1000;
  await fixtureCase(async fixture => {
    const authenticated = await login(fixture);
    await seedCounts(fixture, authenticated.cookie, 2, 6);
    const sql = await fixture.storage();
    const activeToken = hash(authenticated.cookie.slice(cookieName.length + 1));
    const expiredToken = hash('expired-claims');
    const boundaryToken = hash('boundary-claims');
    const futureToken = hash('future-claims');
    const orphanToken = hash('no-session-row');
    const claimlessSessions = 2048;
    // Historical sessions remain stored after expiry. None of these needs a claim.
    await sql.exec(`WITH RECURSIVE history(n) AS (
      VALUES(1) UNION ALL SELECT n + 1 FROM history WHERE n < ?
    ) INSERT INTO sessions (token_sha256, expires_at_ms, admitted, code_epoch)
      SELECT printf('%064x', n), ?, 0, ? FROM history`, claimlessSessions, cleanupNow - 2000, hash(code));
    for (const [token, expiry, admitted, epoch] of [
      [expiredToken, cleanupNow - 1000, 2, hash(code)],
      [boundaryToken, cleanupNow, 1, hash(code)],
      [futureToken, cleanupNow + 1000, 1, hash(otherCode)],
    ] as const) await sql.exec('INSERT INTO sessions (token_sha256, expires_at_ms, admitted, code_epoch) VALUES (?, ?, ?, ?)',
      token, expiry, admitted, epoch);
    for (const [token, operation] of [
      [activeToken, 'a'], [activeToken, 'b'], [expiredToken, 'a'], [expiredToken, 'b'],
      [boundaryToken, 'a'], [futureToken, 'a'], [orphanToken, 'a'],
    ] as const) await sql.exec('INSERT INTO obituary_claims (token_sha256, operation_key) VALUES (?, ?)', token, operation.repeat(64));
    const storedSessions = await sql.exec<{ total: number; admitted: number }>('SELECT COUNT(*) AS total, SUM(admitted) AS admitted FROM sessions');
    assert.deepEqual(storedSessions, [{ total: claimlessSessions + 4, admitted: 6 }]);
    await fixture.sqlTrace(); // Discard login and fixture seeding statements.
    const anonymous = await sessionBody(await fixture.runtime.dispatchFetch(origin + '/api/judge/session'));
    assert.equal(anonymous.state, 'anonymous');
    const trace = await fixture.sqlTrace();
    assert.equal(trace.length, 1, 'Anonymous status executes only the production claim cleanup');
    const cleanup = trace[0]!;
    assert.ok(/^DELETE\s+FROM\s+obituary_claims\b/i.test(cleanup.query), 'Captured the native cleanup statement');
    assert.ok(cleanup.bindings.length === 1 && cleanup.bindings[0] === cleanupNow, 'Native expiry cutoff is unchanged');
    // The fixture EXPLAINs the exact SQL/bindings intercepted from the checked
    // production bundle, not a copied alternative query or a source assertion.
    const details = cleanup.plan.map(row => row.detail);
    assert.ok(details.some(detail => /^SCAN (?:TABLE )?obituary_claims\b/i.test(detail)), 'Claims drive cleanup');
    assert.ok(details.some(detail => /CORRELATED.*SUBQUERY/i.test(detail)), 'Expiry lookup is correlated to each claim');
    assert.ok(details.some(detail => /^SEARCH (?:TABLE )?sessions USING (?:COVERING )?INDEX \S+ \(token_sha256=\?\)/i.test(detail)),
      'Each session lookup uses its existing token primary key');
    assert.ok(!details.some(detail => /^SCAN (?:TABLE )?sessions\b/i.test(detail)), 'Anonymous cleanup never scans historical sessions');
    const retained = await sql.exec<{ token_sha256: string; operation_key: string }>('SELECT token_sha256, operation_key FROM obituary_claims');
    assert.equal(retained.length, 4);
    assert.ok(retained.filter(row => row.token_sha256 === activeToken).length === 2, 'Active-session claims survive');
    assert.ok(retained.some(row => row.token_sha256 === futureToken), 'Unexpired claims survive even with another code epoch');
    assert.ok(retained.some(row => row.token_sha256 === orphanToken), 'A missing session is not an expired session');
    assert.ok(retained.every(row => row.token_sha256 !== expiredToken && row.token_sha256 !== boundaryToken),
      'Earlier-expired and exact-boundary claims are deleted');
    assert.deepEqual(await sql.exec('SELECT COUNT(*) AS total, SUM(admitted) AS admitted FROM sessions'), storedSessions,
      'Cleanup preserves every session row and lifetime admission');
    assert.deepEqual(await counts(fixture, authenticated.cookie), { session: 2, daily: 6 }, 'Cleanup refunds neither counter');
    const current = await active(await fixture.runtime.dispatchFetch(origin + '/api/judge/session', { headers: { Cookie: authenticated.cookie } }));
    assert.equal(current.quota.session_remaining, 8); assert.equal(current.quota.daily_remaining, 34);
    assert.equal(fixture.calls.length, 0, 'Status and cleanup dispatch no AI');
  }, { nowMs: cleanupNow, traceSql: true });
});

test('authenticated disabled narration capability survives unchanged session storage while POST remains zero-AI', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'obituary-disabled-session-'));
  const persistencePath = join(owned, 'sqlite');
  let cookie: string;
  const enabled = await judgeRuntimeFixture({ persistencePath, nowMs: now, variables: { JUDGE_CODE: code } });
  try { cookie = (await login(enabled)).cookie; }
  finally { await enabled.dispose(); }
  const disabled = await judgeRuntimeFixture({ persistencePath, nowMs: now, variables: { JUDGE_CODE: code, INFERENCE_ENABLED: 'false' } });
  try {
    const response = await disabled.runtime.dispatchFetch(origin + '/api/judge/obituary/config', { headers: { Cookie: cookie! } });
    assert.equal(response.status, 200);
    const capability = parseObituaryCapability(await body(response));
    assert.ok(capability && !capability.enabled && capability.disabledReason === 'disabled');
    await narrationError(await submitObituary(disabled, cookie!), 'disabled', 503);
    await narrationError(await disabled.runtime.dispatchFetch(origin + '/api/judge/obituary/config'), 'anonymous', 401);
    assert.deepEqual(await counts(disabled, cookie!), { session: 0, daily: 0 });
    assert.equal(disabled.calls.length, 0);
  } finally { await disabled.dispose(); await rm(owned, { recursive: true, force: true }); }
});

test('distinct sessions share the final UTC-day narration slot and duplicate claims remain spent across midnight', async () => {
  await fixtureCase(async fixture => {
    const first = await login(fixture);
    const second = await login(fixture);
    await seedCounts(fixture, first.cookie, 0, 39);
    const responses = await Promise.all([submitObituary(fixture, first.cookie), submitObituary(fixture, second.cookie)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
    const winner = responses[0]!.status === 200 ? first : second;
    const loser = winner === first ? second : first;
    for (const response of responses) await response.body?.cancel();
    assert.deepEqual(await counts(fixture, winner.cookie), { session: 1, daily: 40 });
    assert.deepEqual(await counts(fixture, loser.cookie), { session: 0, daily: 40 });
    assert.equal(fixture.calls.length, 1);
    await fixture.setTime(Date.parse('2026-11-24T00:00:00Z'));
    await narrationError(await submitObituary(fixture, winner.cookie), 'duplicate', 409);
    assert.deepEqual(await counts(fixture, winner.cookie, '2026-11-24'), { session: 1, daily: 0 });
    const response = await submitObituary(fixture, winner.cookie, obituaryRequest('b'.repeat(64)));
    assert.equal(response.status, 200);
    await response.body?.cancel();
    assert.deepEqual(await counts(fixture, winner.cookie, '2026-11-24'), { session: 2, daily: 1 });
    assert.equal(fixture.calls.length, 2);
  });
});
