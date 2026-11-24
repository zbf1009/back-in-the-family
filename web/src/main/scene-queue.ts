import type { PauseReason } from '../shared/protocol.ts';
import type { WorldSnapshot } from '../shared/world-snapshot.ts';
import type { SceneKind } from './templates.ts';

export interface SceneEntry { kind: SceneKind | 'choice'; node: string | null }
export interface SceneQueue {
  worldId: number;
  tick: string;
  reasons: readonly PauseReason[];
  world: WorldSnapshot;
  entries: SceneEntry[];
}

export function sceneQueue(reasons: readonly PauseReason[], world: WorldSnapshot): SceneEntry[] {
  const entries: SceneEntry[] = [];
  if (reasons.includes('player_died')) entries.push({ kind: 'funeral', node: null });
  if (reasons.includes('dream_resolved')) entries.push({ kind: 'dream', node: null });
  if (reasons.includes('player_reborn')) entries.push({ kind: 'birth', node: null });
  const node = world.player_node;
  if (node !== null) entries.push({
    kind: node.family === 'family_death' ? 'funeral' : node.family === 'inheritance' ? 'inheritance' : 'choice',
    node: node.id,
  });
  return entries;
}

export function nextScene(queue: SceneQueue | null): SceneQueue | null {
  if (queue === null || queue.entries.length <= 1) return null;
  return { ...queue, entries: queue.entries.slice(1) };
}

/** Admission retires only this node, even behind unrelated historical scenes. */
export function retireNode(queue: SceneQueue | null, node: string): SceneQueue | null {
  if (queue === null || !queue.entries.some(entry => entry.node === node)) return queue;
  const entries = queue.entries.filter(entry => entry.node !== node);
  return entries.length === 0 ? null : { ...queue, entries };
}

export type SceneClose = Pick<SceneQueue, 'worldId' | 'tick'> & { entry: SceneEntry };

/** Retained entry identity makes late and duplicate close callbacks harmless. */
export function closeScene(queue: SceneQueue | null, expected: SceneClose): SceneQueue | null {
  return queue !== null && queue.worldId === expected.worldId && queue.tick === expected.tick
    && queue.entries[0] === expected.entry && expected.entry.node === null ? nextScene(queue) : queue;
}
