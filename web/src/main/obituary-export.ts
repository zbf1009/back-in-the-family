import { parseObituarySidecar, type ObituarySidecarV1 } from '../shared/obituary.ts';
import type { ObituaryRun } from './obituary-store.ts';
import { renderObituaryTemplate } from './obituary-template.ts';

/** 只读原导出，不重新序列化 replay 或加入任何回放字段。 */
export async function exportObituarySidecar(run: ObituaryRun, replayBytes: string): Promise<ObituarySidecarV1> {
  const replay: unknown = JSON.parse(replayBytes);
  if (replay === null || typeof replay !== 'object' || !('version' in replay) || replay.version !== 5
    || !('ticks' in replay) || typeof replay.ticks !== 'string' || !/^(0|[1-9][0-9]*)$/.test(replay.ticks)
    || BigInt(replay.ticks) > 18446744073709551615n) throw new Error('Invalid original replay export prefix.');
  // 在 await 前捕获本次前缀内的最终记录，异步摘要期间的后续人生不能混入。
  const records = run.archive(BigInt(replay.ticks));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(replayBytes));
  const replaySha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const sidecar: ObituarySidecarV1 = { format: 'back-in-the-family/obituaries', version: 1, replaySha256, records };
  if (parseObituarySidecar(sidecar, replaySha256) === null
    || records.some(record => record.result.source === 'template' && record.result.text !== renderObituaryTemplate(record.facts))) {
    throw new Error('Invalid terminal obituary archive.');
  }
  return sidecar;
}
