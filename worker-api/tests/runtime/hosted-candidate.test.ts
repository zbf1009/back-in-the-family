import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  checkHostedCandidate, currentStaticDeployment,
} from '../../../scripts/check-hosted-candidate.ts';
import { PROJECT_REQUEST_BYTE_CAP, isDecisionRequest } from '../../../web/src/shared/decision.ts';
import { handleRequest } from '../../src/handler.ts';
import { digest } from '../../scripts/bundle.ts';
import { root } from '../../scripts/profile.ts';
import { requireTools } from '../../scripts/tools.ts';
import { decisionRequest, expectError, nativeResult, publicBody } from '../helpers/decision.ts';

async function fixture(t: TestContext): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'hosted-candidate-'));
  t.after(async () => { await rm(project, { recursive: true, force: true }); });
  const paths = [
    'worker-api/hosted-candidate.jsonc', 'worker-api/wrangler.jsonc',
    'worker-api/src/index.ts', 'worker-api/src/handler.ts',
    'web/src/shared/decision.ts', 'web/src/shared/decision-contract.ts',
    'target/decision-worker/worker.js', 'target/decision-worker/build.json',
    'web/wrangler.jsonc', '.github/workflows/deploy.yml',
  ];
  await Promise.all(paths.map(async path => {
    await mkdir(dirname(join(project, path)), { recursive: true });
    await copyFile(join(root, path), join(project, path));
  }));
  for (const path of ['web/dist/assets', 'web/assets', 'target/wasm-pkg']) {
    await mkdir(join(project, path), { recursive: true });
  }
  await Promise.all([
    writeFile(join(project, 'README.md'), '# Owned asset fixture\n'),
    writeFile(join(project, 'web/assets/ASSETS.json'), '[]\n'),
    writeFile(join(project, 'web/dist/index.html'), '<!doctype html><title>Owned hosted fixture</title>'),
    writeFile(join(project, 'web/dist/assets/sim.wasm'), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    writeFile(join(project, 'target/wasm-pkg/sim_wasm_bg.wasm'), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    writeFile(join(project, 'web/dist/assets/sim-worker.js'), 'const __wbindgen = "sim.wasm";\n'),
    writeFile(join(project, 'web/dist/assets/main.js'), 'console.log("owned fixture");\n'),
  ]);
  return project;
}

test('actual checker accepts the disabled candidate against owned checked bundle and asset identities', async t => {
  const project = await fixture(t);
  const checked = await checkHostedCandidate(project);
  assert.equal(checked.bundle, digest(await readFile(join(project, 'target/decision-worker/worker.js'))));
  assert.equal(checked.assets['assets/sim.wasm'], digest(await readFile(join(project, 'target/wasm-pkg/sim_wasm_bg.wasm'))));
  assert.equal(checked.production.cwd, join(project, 'web'));
});

test('candidate variables make zero AI calls at real exact and over-bound UTF-8 payload boundaries', async t => {
  const checked = await checkHostedCandidate(await fixture(t));
  const request = decisionRequest();
  request.state = 'A fictional warning: 界\\"\n';
  const serialize = () => JSON.stringify(request);
  request.state += 'a'.repeat(PROJECT_REQUEST_BYTE_CAP - Buffer.byteLength(serialize()));
  assert.ok(isDecisionRequest(request));
  assert.equal(Buffer.byteLength(serialize()), 16_384);
  let calls = 0;
  const ai = { async run() { calls += 1; return new Response(JSON.stringify(nativeResult())); } };
  const env = { ...checked.candidate.vars, AI: ai };
  const config = await publicBody(await handleRequest(new Request('https://candidate.test/api/decision/config'), env));
  assert.deepEqual(config, { version: 'decision-config-v1', enabled: false, session_cap: 40 });
  for (const extra of ['', 'a']) {
    const body = JSON.stringify({ ...request, state: request.state + extra });
    assert.equal(Buffer.byteLength(body), 16_384 + extra.length);
    const post = new Request('https://candidate.test/api/decision', { method: 'POST', body });
    assert.equal(post.headers.get('content-length'), null);
    await expectError(await handleRequest(post, env), 'disabled', 503);
  }
  assert.equal(calls, 0);
  // A test-only positive control proves the exact body and fake are usable;
  // production candidate configuration is neither written nor enabled here.
  const exact = new Request('https://candidate.test/api/decision', { method: 'POST', body: serialize() });
  assert.equal((await handleRequest(exact, { ...env, INFERENCE_ENABLED: 'true' })).status, 200);
  assert.equal(calls, 1);
});

test('actual pinned-config consumer rejects cap binding routing date and rebuild faults', async t => {
  const faults = {
    'missing cap': (config: Record<string, unknown>) => { delete (config.vars as Record<string, unknown>).MAX_REQUEST_BYTES; },
    'zero cap': (config: Record<string, unknown>) => { (config.vars as Record<string, unknown>).MAX_REQUEST_BYTES = '0'; },
    'numeric cap': (config: Record<string, unknown>) => { (config.vars as Record<string, unknown>).MAX_REQUEST_BYTES = 16384; },
    'different cap': (config: Record<string, unknown>) => { (config.vars as Record<string, unknown>).MAX_REQUEST_BYTES = '16385'; },
    'enabled inference': (config: Record<string, unknown>) => { (config.vars as Record<string, unknown>).INFERENCE_ENABLED = 'true'; },
    'missing AI': (config: Record<string, unknown>) => { delete config.ai; },
    'wrong AI binding': (config: Record<string, unknown>) => { (config.ai as Record<string, unknown>).binding = 'OTHER_AI'; },
    'remote AI': (config: Record<string, unknown>) => { (config.ai as Record<string, unknown>).remote = true; },
    'missing assets binding': (config: Record<string, unknown>) => { delete (config.assets as Record<string, unknown>).binding; },
    'wrong assets path': (config: Record<string, unknown>) => { (config.assets as Record<string, unknown>).directory = './dist'; },
    'missing exact API routing': (config: Record<string, unknown>) => { (config.assets as Record<string, unknown>).run_worker_first = ['/api/*']; },
    'missing wildcard API routing': (config: Record<string, unknown>) => { (config.assets as Record<string, unknown>).run_worker_first = ['/api']; },
    'invalid routing type': (config: Record<string, unknown>) => { (config.assets as Record<string, unknown>).run_worker_first = 'true'; },
    'missing SPA': (config: Record<string, unknown>) => { delete (config.assets as Record<string, unknown>).not_found_handling; },
    'invalid SPA': (config: Record<string, unknown>) => { (config.assets as Record<string, unknown>).not_found_handling = 'invented'; },
    'missing date': (config: Record<string, unknown>) => { delete config.compatibility_date; },
    'different date': (config: Record<string, unknown>) => { config.compatibility_date = '2026-11-11'; },
    'invalid date': (config: Record<string, unknown>) => { config.compatibility_date = 'not-a-date'; },
    'missing no_bundle': (config: Record<string, unknown>) => { delete config.no_bundle; },
    'rebuild': (config: Record<string, unknown>) => { config.no_bundle = false; },
    'source entry instead of checked bundle': (config: Record<string, unknown>) => { config.main = './src/index.ts'; },
    'telemetry': (config: Record<string, unknown>) => { config.send_metrics = true; },
    'unapproved named environment': (config: Record<string, unknown>) => { config.env = { production: {} }; },
    'custom build': (config: Record<string, unknown>) => { config.build = { command: 'rebuild' }; },
    'production name': (config: Record<string, unknown>) => { config.name = 'back-in-the-family'; },
  };
  for (const [name, fault] of Object.entries(faults)) {
    await t.test(name, async sub => {
      const project = await fixture(sub);
      const { candidate } = await checkHostedCandidate(project);
      const config: Record<string, unknown> = structuredClone({ ...candidate });
      fault(config);
      await writeFile(join(project, 'worker-api/hosted-candidate.jsonc'), JSON.stringify(config));
      await assert.rejects(checkHostedCandidate(project));
    });
  }
});

test('actual checked-input consumers reject stale bundle source stamp and asset lineage', async t => {
  const faults = {
    'modified bundle': ['target/decision-worker/worker.js', 'export default {};\n'],
    'stale source': ['worker-api/src/handler.ts', 'export const stale = true;\n'],
    'invalid stamp': ['target/decision-worker/build.json', '{}\n'],
    'malformed candidate JSON': ['worker-api/hosted-candidate.jsonc', '{'],
    'different WASM': ['web/dist/assets/sim.wasm', 'not the checked WASM'],
    'second WASM': ['web/dist/assets/other.wasm', 'another module'],
    'main bundle imports WASM': ['web/dist/assets/main.js', 'const __wbindgen = "sim.wasm";\n'],
    'token leak': ['web/dist/assets/main.js', 'const token = "WORKERS_AI_TOKEN";\n'],
    'probe result leak': ['web/dist/assets/main.js', 'const source = "llm-probe-stale";\n'],
    'unlisted media': ['web/dist/assets/unlisted.png', 'unlisted'],
    'empty SPA index': ['web/dist/index.html', ''],
    'stale source policy': ['worker-api/wrangler.jsonc', '{}\n'],
  };
  for (const [name, [path, content]] of Object.entries(faults)) {
    await t.test(name, async sub => {
      const project = await fixture(sub);
      await checkHostedCandidate(project);
      await writeFile(join(project, path), content);
      await assert.rejects(checkHostedCandidate(project));
    });
  }
  for (const path of ['target/decision-worker/worker.js', 'target/decision-worker/build.json', 'web/dist/index.html', 'target/wasm-pkg/sim_wasm_bg.wasm']) {
    await t.test(`missing ${path}`, async sub => {
      const project = await fixture(sub);
      await checkHostedCandidate(project);
      await rm(join(project, path));
      await assert.rejects(checkHostedCandidate(project));
    });
  }
});

test('eligible production deployment consumes the actual unchanged static CI command and config', async t => {
  const project = await fixture(t);
  const production = await currentStaticDeployment(project);
  const bin = join(project, 'bin');
  await mkdir(bin);
  const capture = join(project, 'capture.cjs');
  const output = join(project, 'selected.json');
  // Intercept only the executable boundary. Execute the actual CI shell tail;
  // the fake upload consumes the config through the real pinned Wrangler API.
  await writeFile(capture, `const fs = require('node:fs');
const assert = require('node:assert/strict');
const wrangler = require(${JSON.stringify(requireTools.resolve('wrangler'))});
assert.deepEqual(process.argv.slice(2), ['exec', 'wrangler', 'deploy']);
const path = require('node:path').resolve('wrangler.jsonc');
const config = wrangler.unstable_readConfig({ config: path }, { hideWarnings: true, useRedirectIfAvailable: false });
fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({ path, name: config.name, main: config.main ?? null, ai: config.ai ?? null, assets: config.assets }));
`);
  await writeFile(join(bin, 'mise'), '#!/bin/bash\n[[ "$1$2" == "exec--" ]] || exit 1\nshift 2\nexec "$@"\n');
  await writeFile(join(bin, 'pnpm'), `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(capture)} "$@"\n`);
  await Promise.all(['mise', 'pnpm'].map(name => chmod(join(bin, name), 0o755)));
  const result = spawnSync('/bin/bash', ['-c', production.command], {
    cwd: production.cwd, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const selected = JSON.parse(await readFile(output, 'utf8')) as {
    path: string; name: string; main: string | null; ai: unknown;
    assets: { directory: string; binding?: string; run_worker_first?: unknown; not_found_handling?: unknown };
  };
  assert.equal(selected.path, join(project, 'web/wrangler.jsonc'));
  assert.equal(selected.name, 'back-in-the-family');
  assert.equal(selected.main, null);
  assert.equal(selected.ai, null);
  assert.equal(selected.assets.binding, undefined);
  assert.equal(selected.assets.run_worker_first, undefined);
  assert.equal(selected.assets.not_found_handling, undefined);
});

test('candidate selection without separate release authority fails closed even after checked inputs', async t => {
  const project = await fixture(t);
  await checkHostedCandidate(project);
  const path = join(project, '.github/workflows/deploy.yml');
  const workflow = await readFile(path, 'utf8');
  await writeFile(path, workflow.replace('working-directory: web', 'working-directory: worker-api')
    .replace('run: mise exec -- pnpm exec wrangler deploy', 'run: mise exec -- pnpm exec wrangler deploy --config hosted-candidate.jsonc'));
  await assert.rejects(checkHostedCandidate(project), /no hosted release authority.*candidate selection is not approved/);
});

test('replacing the production static config with the checked candidate also fails closed', async t => {
  const project = await fixture(t);
  await checkHostedCandidate(project);
  await copyFile(join(project, 'worker-api/hosted-candidate.jsonc'), join(project, 'web/wrangler.jsonc'));
  await assert.rejects(checkHostedCandidate(project), /static production config must remain byte-exact/);
});
