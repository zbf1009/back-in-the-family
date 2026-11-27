import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './profile.ts';
import type { WorkerProfile } from './profile.ts';

const sharedFiles = ['worker-api/src/http.ts', 'worker-api/src/handler.ts', 'web/src/shared/decision.ts', 'web/src/shared/decision-contract.ts'];
const sourceFiles = {
  generic: ['worker-api/src/index.ts', ...sharedFiles],
  judge: ['worker-api/src/judge.ts', 'worker-api/src/judge-gate.ts', 'worker-api/src/judge-contract.ts',
    'worker-api/src/obituary.ts', 'web/src/shared/obituary.ts', 'web/src/main/obituary-template.ts', 'web/src/main/calendar.ts', ...sharedFiles],
};
export function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export async function sourceDigests(projectRoot = root, profile: WorkerProfile = 'generic'): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(sourceFiles[profile].map(async path => [path, digest(await readFile(join(projectRoot, path)))])));
}
export async function checkedWorkerBundle(projectRoot = root, profile: WorkerProfile = 'generic'): Promise<string> {
  const directory = join(projectRoot, profile === 'judge' ? 'target/judge-worker' : 'target/decision-worker');
  const bytes = await readFile(join(directory, 'worker.js'));
  const stamp: unknown = JSON.parse(await readFile(join(directory, 'build.json'), 'utf8'));
  assert.deepEqual(stamp, { version: 1, bundle: digest(bytes), sources: await sourceDigests(projectRoot, profile) }, 'Worker bundle is stale or modified; run the actual Worker_Build gate');
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 26_214_400, 'Worker bundle must be nonempty and within the existing file size limit');
  return bytes.toString('utf8');
}
