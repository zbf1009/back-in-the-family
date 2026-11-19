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
