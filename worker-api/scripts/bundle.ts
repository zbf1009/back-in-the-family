import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './profile.ts';

const sourceFiles = ['worker-api/src/index.ts', 'worker-api/src/handler.ts', 'web/src/shared/decision.ts', 'web/src/shared/decision-contract.ts'];
export function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export async function sourceDigests(projectRoot = root): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, digest(await readFile(join(projectRoot, path)))])));
}
export async function checkedWorkerBundle(projectRoot = root): Promise<string> {
  const directory = join(projectRoot, 'target/decision-worker');
  const bytes = await readFile(join(directory, 'worker.js'));
  const stamp: unknown = JSON.parse(await readFile(join(directory, 'build.json'), 'utf8'));
  assert.deepEqual(stamp, { version: 1, bundle: digest(bytes), sources: await sourceDigests(projectRoot) }, 'Worker bundle is stale or modified; run the actual Worker_Build gate');
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 26_214_400, 'Worker bundle must be nonempty and within the existing file size limit');
  return bytes.toString('utf8');
}
