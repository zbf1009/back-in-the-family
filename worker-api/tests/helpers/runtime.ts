import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { URL } from 'node:url';
import type { DurableObjectStorageHandle, Miniflare, MiniflareOptions, V4FetchHandler, V4WorkerOptions, WorkerOptions } from 'worker-tools/miniflare';
import type * as MiniflareTools from 'worker-tools/miniflare';
import type * as WranglerTools from '../../../web/node_modules/wrangler';
import { decisionObject } from '../../../web/src/shared/decision.ts';
import { nativeResult } from './decision.ts';
import { root, sourceConfig } from '../../scripts/profile.ts';
import type { JudgeSourceConfig, SourceConfig, WorkerProfile } from '../../scripts/profile.ts';
import { assertWorkerTools, requireTools } from '../../scripts/tools.ts';
import { checkedWorkerBundle } from '../../scripts/bundle.ts';

process.env.WRANGLER_SEND_METRICS = 'false';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
const wrangler = requireTools('wrangler') as typeof WranglerTools;

export type ConfigFault = 'missing-ai' | 'missing-byte-cap' | 'missing-exact-worker-first' | 'missing-wildcard-worker-first' | 'broken-spa';

export function applyConfigFault(config: SourceConfig, fault: ConfigFault): void {
  switch (fault) {
    case 'missing-ai': delete config.ai; break;
    case 'missing-byte-cap': delete config.vars.MAX_REQUEST_BYTES; break;
    case 'missing-exact-worker-first': config.assets.run_worker_first = config.assets.run_worker_first.filter(path => path !== '/api'); break;
    case 'missing-wildcard-worker-first': config.assets.run_worker_first = config.assets.run_worker_first.filter(path => path !== '/api/*'); break;
    case 'broken-spa': config.assets.not_found_handling = 'none'; break;
  }
}

function offlineMiniflare(): typeof MiniflareTools {
  assertWorkerTools();
  return requireTools('miniflare') as typeof MiniflareTools;
}

const fakeScript = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export class FakeAI extends WorkerEntrypoint {
  async run(model, input, options) {
    if (options?.returnRawResponse !== true) throw new Error('Expected native raw transport option');
    await this.env.CALLS.fetch('http://calls.local/', { method: 'POST', body: JSON.stringify({ model, input, options }) });
    return new Response(this.env.RESULT, { status: this.env.STATUS, headers: { 'content-type': 'application/json' } });
  }
}
export default {
  async fetch() {
    const response = await fetch('http://127.0.0.1:9/');
    const blocked = response.status === 403
      && response.headers.get('x-worker-api-egress') === 'denied-v1';
    if (response.body) await response.body.cancel();
    return Response.json({ blocked });
  }
};
`;

export interface RuntimeFixture {
  runtime: Miniflare;
  calls: { model: unknown; input: unknown }[];
  assetsDir: string;
  dispose(): Promise<void>;
}

export interface RuntimeFixtureOptions {
  variables?: Record<string, unknown>;
  result?: unknown;
  status?: number;
  fault?: ConfigFault;
  externalFault?: boolean;
}

export interface JudgeFixtureControls {
  workerName: string;
  persistencePath: string;
  readonly reserveAttempts: number;
  setTime(ms: number): Promise<void>;
  storage(): Promise<DurableObjectStorageHandle>;
  evict(): Promise<void>;
}

export async function runtimeFixture(options: RuntimeFixtureOptions = {}): Promise<RuntimeFixture> {
  return profileRuntimeFixture(await sourceConfig(), 'generic', root, options);
}

export async function profileRuntimeFixture(
  config: SourceConfig | JudgeSourceConfig,
  profile: WorkerProfile,
  projectRoot: string,
  options: RuntimeFixtureOptions & { persistencePath?: string; nowMs?: number; reserveFault?: 'reject-after-commit' } = {},
): Promise<RuntimeFixture & JudgeFixtureControls> {
  process.env.WRANGLER_SEND_METRICS = 'false';
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  assert.ok(options.reserveFault === undefined || (profile === 'judge' && options.reserveFault === 'reject-after-commit'), 'Reserve faults are judge-fixture-only');
  const assetsDir = resolve(projectRoot, 'worker-api', config.assets.directory);
  assert.ok((await readFile(join(assetsDir, 'index.html'))).byteLength > 0, 'Build checked web/dist first');
  config.main = resolve(projectRoot, 'worker-api', config.main);
  config.assets.directory = assetsDir;
  config.vars = { ...config.vars, ...options.variables };
  if (options.fault) applyConfigFault(config, options.fault);
  if (profile === 'generic' && options.externalFault !== false && process.env.WORKER_API_FAULT) {
    const fault = process.env.WORKER_API_FAULT;
    assert.ok(['missing-ai', 'missing-exact-worker-first', 'missing-wildcard-worker-first', 'broken-spa'].includes(fault));
    applyConfigFault(config, fault as ConfigFault);
  }
  // sourceConfig asserted the real native AI profile before any fixture changes.
  // Record the fault-adjusted binding, then remove it only from this isolated
  // config: Wrangler rejects local AI before it can return Miniflare options.
  const nativeAI = config.ai;
  delete config.ai;
  let nowMs = options.nowMs;
  if (nowMs !== undefined) assert.ok(Number.isSafeInteger(nowMs) && nowMs >= 0, 'Fixture time must be a nonnegative safe integer');
  const temp = await mkdtemp(join(tmpdir(), 'worker-api-runtime-'));
  const persistencePath = options.persistencePath === undefined ? join(temp, 'storage') : resolve(options.persistencePath);
  const workerName = profile === 'judge' ? 'judge-api' : 'decision-api';
  let runtime: Miniflare | undefined;
  try {
    const path = join(temp, 'wrangler.jsonc');
    // Only this isolated directory is passed to Wrangler; there are no .env or
    // .dev.vars files, and the original project/root env is never loaded.
    await writeFile(path, JSON.stringify(config));
    const converted = wrangler.unstable_getMiniflareWorkerOptions(path, undefined, { overrides: { enableContainers: false } });
    assert.equal(converted.main, config.main);
    assert.deepEqual(converted.externalWorkers, []);
    assert.deepEqual(converted.define, {});
    const workerOptions = converted.workerOptions;
    assert.ok(decisionObject(workerOptions));
    assert.equal(workerOptions.ai, undefined);
    assert.equal(workerOptions.assets?.binding, 'ASSETS');
    assert.deepEqual(Object.keys(workerOptions.bindings ?? {}).sort(), Object.keys(config.vars).sort());
    assert.deepEqual(workerOptions.serviceBindings ?? {}, {});
    if (profile === 'judge') {
      assert.deepEqual(Object.keys(workerOptions.durableObjects ?? {}), ['JUDGE_GATE'], 'Only the judge SQLite binding is permitted');
      const gate = workerOptions.durableObjects?.JUDGE_GATE;
      assert.ok(decisionObject(gate));
      assert.equal(gate.className, 'JudgeGate');
      assert.equal(gate.useSQLite, true, 'The pinned Wrangler converter must enable real SQLite storage');
      assert.equal(gate.scriptName, undefined);
      assert.equal(gate.container, undefined);
      assert.ok(Object.keys(gate).every(key => ['className', 'useSQLite', 'scriptName', 'container'].includes(key)));
    }
    for (const key of ['kvNamespaces', 'd1Databases', 'r2Buckets', ...(profile === 'generic' ? ['durableObjects'] as const : []), 'queueProducers',
      'queueConsumers', 'hyperdrives', 'ratelimits', 'unsafeBindings', 'workflows', 'tails', 'streamingTails'] as const) {
      const value = workerOptions[key];
      assert.ok(value === undefined || (Array.isArray(value) ? value.length === 0
        : decisionObject(value) && Object.keys(value).length === 0), `Unexpected binding ${key}`);
    }
    // Execute the exact module checked and staged by Worker_Build, never a second
    // test-only esbuild build that could mask a broken Wrangler bundle.
    const script = await checkedWorkerBundle(projectRoot, profile);
    const { modulesRules: _rules, ai: _removedAI, ...withoutAI } = workerOptions;
    // Also omit native AI from V4 options: its converter runs after service
    // bindings and would otherwise overwrite the local RPC fake.
    const calls: { model: unknown; input: unknown }[] = [];
    let reserveAttempts = 0;
    let reserveFaultUsed = false;
    const tools = offlineMiniflare();
    let outboundDenials = 0;
    const deny = () => {
      outboundDenials += 1;
      return new tools.Response(null, {
        status: 403, headers: { 'x-worker-api-egress': 'denied-v1' },
      });
    };
    const user: V4WorkerOptions = {
      ...withoutAI, name: workerName, modules: true, script,
      serviceBindings: {
        ...(nativeAI ? { AI: { name: 'fake-ai', entrypoint: 'FakeAI' } } : {}),
        ...(options.reserveFault ? { FIXTURE_EVENTS: async (request: Parameters<V4FetchHandler>[0]) => {
          const path = new URL(request.url).pathname;
          assert.equal(request.method, 'POST');
          if (path === '/attempt') {
            reserveAttempts += 1;
            return new tools.Response(null, { status: 204 });
          }
          assert.equal(path, '/committed');
          const reject = !reserveFaultUsed;
          reserveFaultUsed = true;
          return new tools.Response(reject ? 'reject' : 'forward');
        } } : {}),
      },
      outboundService: deny, unsafeRegisterWorker: false,
    };
    const fake: V4WorkerOptions = {
      name: 'fake-ai', compatibilityDate: config.compatibility_date, modules: true, script: fakeScript,
      bindings: { RESULT: JSON.stringify(options.result === undefined ? nativeResult() : options.result), STATUS: options.status ?? 200 },
      serviceBindings: { CALLS: async request => {
        const call: unknown = await request.json();
        assert.ok(decisionObject(call));
        assert.deepEqual(call.options, { returnRawResponse: true });
        calls.push({ model: call.model, input: call.input });
        return new tools.Response(null, { status: 204 });
      } },
      outboundService: deny, unsafeRegisterWorker: false,
      unsafeDirectSockets: [{ host: '127.0.0.1', port: 0, entrypoint: 'default' }],
    };
    const makeRuntimeOptions = (): MiniflareOptions => {
      // Initialize the fixture clock inside each workerd module context, not in
      // Node. Reload only fixture modules, retaining the byte-exact checked
      // bundle and the same caller-owned SQLite persistence directory.
      const source = profile === 'judge' ? {
        ...user,
        modulesRoot: temp,
        modules: [
          { type: 'ESModule' as const, path: join(temp, 'fixture.js'), contents: options.reserveFault ? `
import './fixture-clock.js';
import worker, { JudgeGate } from './checked-worker.js';
export { JudgeGate };
export default {
  fetch(request, env, ctx) {
    const gate = {
      getByName(name) {
        const target = env.JUDGE_GATE.getByName(name);
        return {
          status(...args) { return target.status(...args); },
          open(...args) { return target.open(...args); },
          revoke(...args) { return target.revoke(...args); },
          async reserve(...args) {
            await env.FIXTURE_EVENTS.fetch('http://fixture-events.local/attempt', { method: 'POST' });
            const result = await target.reserve(...args);
            if (result.kind === 'admitted') {
              const event = await env.FIXTURE_EVENTS.fetch('http://fixture-events.local/committed', { method: 'POST' });
              if (await event.text() === 'reject') throw new Error('Fixture admission transport rejection');
            }
            return result;
          },
        };
      },
    };
    return worker.fetch(request, { ...env, JUDGE_GATE: gate }, ctx);
  },
};
` : "import './fixture-clock.js'; export { default, JudgeGate } from './checked-worker.js';" },
          { type: 'ESModule' as const, path: join(temp, 'fixture-clock.js'), contents: nowMs === undefined ? 'export {};' : `Date.now = () => ${nowMs};` },
          { type: 'ESModule' as const, path: join(temp, 'checked-worker.js'), contents: script },
        ],
      } : user;
      const converted: MiniflareOptions = tools.convertV4MiniflareOptions({
        workers: [source, fake], rootPath: temp, resourcePersistencePath: persistencePath, cf: false, host: '127.0.0.1', port: 0,
        log: new tools.Log(tools.LogLevel.ERROR), logRequests: false,
        telemetry: { enabled: false }, unsafeLocalExplorer: false, unsafeObservability: false, unsafeInspectDurableObjects: profile === 'judge',
      });
      const workers: WorkerOptions[] = converted.workers;
      if (profile === 'judge') {
        const worker = workers.find(worker => worker.config.name === workerName);
        assert.ok(worker);
        assert.deepEqual(Object.keys(worker.config.exports ?? {}), ['JudgeGate']);
        assert.equal(worker.config.exports?.JudgeGate?.type, 'durable-object');
        const gate = worker.config.exports?.JudgeGate;
        assert.ok(gate?.type === 'durable-object' && 'storage' in gate && gate.storage === 'sqlite');
        assert.deepEqual(worker.config.env?.JUDGE_GATE, { type: 'durable-object', worker: workerName, exportName: 'JudgeGate' });
      }
      return converted;
    };
    const runtimeOptions = makeRuntimeOptions();
    assert.equal(runtimeOptions.enableDevRegistry, false);
    assert.equal(runtimeOptions.telemetry?.enabled, false);
    for (const worker of runtimeOptions.workers) {
      assert.equal(worker.dev?.remoteProxyConnectionString, undefined);
      assert.equal(worker.dev?.unsafeRegisterWorker, false);
      assert.equal(worker.dev?.outboundService?.type, 'fetcher');
      assert.ok(Object.values(worker.config.env ?? {}).every(binding => decisionObject(binding) && binding.type !== 'ai'));
    }
    runtime = new tools.Miniflare(runtimeOptions);
    await runtime.ready;
    const fakeURL = await runtime.unsafeGetDirectURL('fake-ai');
    assert.equal(fakeURL.hostname, '127.0.0.1');
    assert.deepEqual(await (await fetch(fakeURL.href)).json(), { blocked: true });
    assert.equal(outboundDenials, 1, 'The fake probe must invoke the registered outbound deny hook');
    const fixtureRuntime = runtime;
    return { runtime, calls, assetsDir, workerName, persistencePath,
      get reserveAttempts() { return reserveAttempts; },
      async setTime(ms) {
        assert.equal(profile, 'judge', 'Clock controls are judge-fixture-only');
        assert.ok(Number.isSafeInteger(ms) && ms >= 0, 'Fixture time must be a nonnegative safe integer');
        nowMs = ms;
        await fixtureRuntime.setOptions(makeRuntimeOptions());
        await fixtureRuntime.ready;
      },
      async storage() {
        assert.equal(profile, 'judge', 'SQLite controls are judge-fixture-only');
        return fixtureRuntime.unsafeGetDurableObjectStorage(workerName, 'JudgeGate', { name: 'review-pool-v1' });
      },
      async evict() {
        assert.equal(profile, 'judge', 'DO controls are judge-fixture-only');
        await fixtureRuntime.unsafeEvictDurableObject(workerName, 'JudgeGate', { name: 'review-pool-v1' });
      },
      async dispose() { await fixtureRuntime.dispose(); await rm(temp, { recursive: true, force: true }); },
    };
  } catch (error) {
    if (runtime) await runtime.dispose();
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}
