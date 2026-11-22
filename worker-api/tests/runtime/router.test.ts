import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import { URL } from 'node:url';
import test from 'node:test';
import { isDecisionConfig, isModelDecision } from '../../../web/src/shared/decision.ts';
import { decisionRequest, enabledVariables, expectError, publicBody } from '../helpers/decision.ts';
import { runtimeFixture } from '../helpers/runtime.ts';
import { sourceConfig } from '../../scripts/profile.ts';
import type { RuntimeFixture } from '../helpers/runtime.ts';

const origin = 'https://router.test';
const navigation = { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };

async function apiRoutes(fixture: RuntimeFixture): Promise<void> {
  for (const headers of [undefined, navigation]) {
    for (const path of ['/api', '/api/', '/api/unknown', '/api/deeper/unknown', '/api/decision/', '/api/decision/config/']) {
      await expectError(await fixture.runtime.dispatchFetch(origin + path, { headers }), 'not_found', 404);
    }
    for (const [path, allow] of [['/api/decision', 'POST'], ['/api/decision/config', 'GET']]) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].filter(method => method !== allow)) {
        const response = await fixture.runtime.dispatchFetch(origin + path, { method, headers });
        assert.equal(response.headers.get('allow'), allow);
        await expectError(response, 'method_not_allowed', 405);
      }
      const head = await fixture.runtime.dispatchFetch(origin + path, { method: 'HEAD', headers });
      assert.equal(head.status, 405);
      assert.equal(head.headers.get('allow'), allow);
      assert.equal(head.headers.get('content-type'), 'application/json; charset=utf-8');
      assert.equal(head.headers.get('cache-control'), 'no-store');
      assert.equal(await head.text(), '');
    }
  }
}

async function assetRoutes(fixture: RuntimeFixture): Promise<void> {
  const index = await readFile(join(fixture.assetsDir, 'index.html'));
  for (const path of ['/', '/life/history/deep-link']) {
    const response = await fixture.runtime.dispatchFetch(origin + path, { headers: navigation });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html(?:;|$)/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), index);
  }
  const assets = await readdir(join(fixture.assetsDir, 'assets'));
  const wasm = assets.filter(name => name.endsWith('.wasm'));
  assert.equal(wasm.length, 1, 'Expected one checked WASM asset');
  assert.ok(assets.some(name => name.endsWith('.js')));
  assert.ok(assets.some(name => name.endsWith('.css')));
  for (const name of assets) {
    const response = await fixture.runtime.dispatchFetch(origin + '/assets/' + name);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(fixture.assetsDir, 'assets', name)));
    if (name.endsWith('.wasm')) assert.equal(response.headers.get('content-type'), 'application/wasm');
  }
  const checkedWasm = await readFile(join(fixture.assetsDir, 'assets', wasm[0]!));
  const currentWasm = await readFile(new URL('../../../target/wasm-pkg/sim_wasm_bg.wasm', import.meta.url));
  assert.deepEqual(checkedWasm, currentWasm, 'web/dist WASM is stale; run the checked Web_Build first');
}

test('runtime isolation requires only loopback; RPC loopback works and external routes cannot connect', async () => {
  assert.deepEqual(Object.keys(networkInterfaces()).sort(), ['lo'], 'Use the unshare network-namespace parent command');
  assert.ok(networkInterfaces().lo?.every(address => address.internal));
  const server = createServer(socket => socket.end());
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const local = createConnection({ host: '127.0.0.1', port: address.port });
    await once(local, 'connect');
    local.destroy();
    // Documentation-only address; a loopback-only namespace has no route and
    // the real kernel error, not a timer or mocked fetch, proves fail-closed.
    const external = createConnection({ host: '192.0.2.1', port: 443 });
    try { await assert.rejects(once(external, 'connect'), /ENETUNREACH|EHOSTUNREACH/); }
    finally { external.destroy(); }
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('real source config preserves native AI and worker-first SPA profile with inference off and no byte cap', async () => {
  await sourceConfig();
});

test('actual pinned assets router owns API navigations JSON errors static bytes WASM and SPA', async () => {
  const fixture = await runtimeFixture();
  try {
    await apiRoutes(fixture);
    await assetRoutes(fixture);
    const config = await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: navigation });
    assert.equal(config.status, 200);
    const body = await publicBody(config);
    assert.ok(isDecisionConfig(body));
    assert.deepEqual(body, { version: 'decision-config-v1', enabled: false, session_cap: 40 });
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    }), 'disabled', 503);
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});

test('actual native-shaped RPC fake enables one valid POST; GET malformed and oversized paths use zero AI', async () => {
  const request = decisionRequest();
  request.state = 'A multibyte fictional warning 界😀.';
  const body = JSON.stringify(request);
  const bytes = new TextEncoder().encode(body).byteLength;
  const fixture = await runtimeFixture({ variables: { ...enabledVariables(), MAX_REQUEST_BYTES: bytes } });
  try {
    const config = await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: navigation });
    assert.equal(config.status, 200);
    assert.deepEqual(await publicBody(config), { version: 'decision-config-v1', enabled: true, session_cap: 40 });
    await apiRoutes(fixture);
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', { method: 'POST', body: '{' }), 'malformed_request', 400);
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: body + ' ',
    }), 'payload_too_large', 413);
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify({ ...request, metadata: { bridge_version: 'wrong' } }),
    }), 'malformed_request', 400);
    assert.equal(fixture.calls.length, 0);
    const result = await fixture.runtime.dispatchFetch(origin + '/api/decision', { method: 'POST', body });
    assert.equal(result.status, 200);
    const decision = await publicBody(result);
    assert.ok(isModelDecision(decision, request));
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.calls[0], { model: '@cf/cloudflare/clef', input: {
      model: 'clef', state: request.state, questions: { decision: {
        type: 'choice', instructions: request.instructions,
        criteria: { heed_warning: 'Heed the warning.', dismiss_dream: 'Dismiss the dream.' },
      } },
    } });
  } finally { await fixture.dispose(); }
});

test('actual runtime invalid session cap advertises no fabricated config and closes inference', async () => {
  const fixture = await runtimeFixture({ variables: { ...enabledVariables(), SESSION_CAP: '-1' } });
  try {
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision/config'), 'disabled', 503);
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    }), 'disabled', 503);
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});

test('missing native AI config fault genuinely disables runtime GET and POST with zero fake calls', async () => {
  const fixture = await runtimeFixture({ variables: enabledVariables(), fault: 'missing-ai', externalFault: false });
  try {
    const response = await fixture.runtime.dispatchFetch(origin + '/api/decision/config');
    assert.equal(response.status, 200);
    assert.deepEqual(await publicBody(response), { version: 'decision-config-v1', enabled: false, session_cap: 40 });
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    }), 'disabled', 503);
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});

test('removing exact worker-first really lets API navigation escape to SPA and is detected', async () => {
  const fixture = await runtimeFixture({ fault: 'missing-exact-worker-first', externalFault: false });
  try {
    const response = await fixture.runtime.dispatchFetch(origin + '/api', { headers: navigation });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html(?:;|$)/);
    await assert.rejects(apiRoutes(fixture));
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});

test('removing wildcard worker-first really lets nested API navigation escape and is detected', async () => {
  const fixture = await runtimeFixture({ fault: 'missing-wildcard-worker-first', externalFault: false });
  try {
    const response = await fixture.runtime.dispatchFetch(origin + '/api/unknown', { headers: navigation });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html(?:;|$)/);
    await assert.rejects(apiRoutes(fixture));
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});

test('broken SPA config really returns 404 on deep navigation and is detected', async () => {
  const fixture = await runtimeFixture({ fault: 'broken-spa', externalFault: false });
  try {
    const response = await fixture.runtime.dispatchFetch(origin + '/life/history/deep-link', { headers: navigation });
    assert.equal(response.status, 404);
    await assert.rejects(assetRoutes(fixture));
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});

test('actual runtime explicit enablement without a byte cap still closes inference', async () => {
  const fixture = await runtimeFixture({ variables: { INFERENCE_ENABLED: 'true', SESSION_CAP: 0 } });
  try {
    const response = await fixture.runtime.dispatchFetch(origin + '/api/decision/config');
    assert.equal(response.status, 200);
    assert.deepEqual(await publicBody(response), { version: 'decision-config-v1', enabled: false, session_cap: 0 });
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    }), 'disabled', 503);
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});

test('actual RPC native absent usage projects null and zero page cap does not disable server readiness', async () => {
  const fixture = await runtimeFixture({ variables: { ...enabledVariables(), SESSION_CAP: 0 }, result: {
    model: 'different-provider-revision', answers: { decision: { type: 'choice', choice: 'heed_warning',
      confidence: 'ignored', probabilities: { a: { b: { c: { d: { e: {} } } } } } } },
    provider_extra: 'PRIVATE_PROVIDER_SENTINEL',
  } });
  try {
    assert.deepEqual(await publicBody(await fixture.runtime.dispatchFetch(origin + '/api/decision/config')),
      { version: 'decision-config-v1', enabled: true, session_cap: 0 });
    const response = await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    });
    assert.equal(response.status, 200);
    const body = await publicBody(response);
    assert.ok(isModelDecision(body, decisionRequest()));
    assert.equal(body.usage, null);
    assert.equal(body.session_cap, 0);
    assert.ok(!JSON.stringify(body).includes('PRIVATE_PROVIDER_SENTINEL'));
    assert.equal(fixture.calls.length, 1);
  } finally { await fixture.dispose(); }
});

test('actual RPC present invalid native usage fails closed without echo', async () => {
  const fixture = await runtimeFixture({ variables: enabledVariables(), result: {
    model: 'provider', answers: { decision: { type: 'choice', choice: 'heed_warning' } },
    usage: { input_tokens: 1, output_tokens: 2, neurons: 1 }, provider_text: 'PRIVATE_PROVIDER_SENTINEL',
  } });
  try {
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    }), 'invalid_response', 502);
    assert.equal(fixture.calls.length, 1);
  } finally { await fixture.dispose(); }
});

test('actual RPC request-owned provider 429 is only rate_limited with one call and no body echo', async () => {
  const fixture = await runtimeFixture({ variables: enabledVariables(), status: 429,
    result: { code: 3036, provider_text: 'PRIVATE_PROVIDER_QUOTA_SENTINEL' } });
  try {
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    }), 'rate_limited', 429);
    assert.equal(fixture.calls.length, 1);
  } finally { await fixture.dispose(); }
});

test('actual router explicit inference off blocks POST even with a usable native fake and valid byte cap', async () => {
  const fixture = await runtimeFixture({ variables: { ...enabledVariables(), INFERENCE_ENABLED: 'false' } });
  try {
    const config = await fixture.runtime.dispatchFetch(origin + '/api/decision/config', { headers: navigation });
    assert.equal(config.status, 200);
    assert.deepEqual(await publicBody(config), { version: 'decision-config-v1', enabled: false, session_cap: 40 });
    await expectError(await fixture.runtime.dispatchFetch(origin + '/api/decision', {
      method: 'POST', body: JSON.stringify(decisionRequest()),
    }), 'disabled', 503);
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.dispose(); }
});
