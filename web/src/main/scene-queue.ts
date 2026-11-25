import type { PauseReason } from '../shared/protocol.ts';
import type { PlayerLifecycleFact, WorldSnapshot } from '../shared/world-snapshot.ts';
import type { SceneKind } from './templates.ts';
import { lifecycleKeyScene, nodeKeyScene, type KeySceneView } from './key-scene.ts';

export interface SceneEntry {
  kind: SceneKind | 'choice';
  node: string | null;
  identity: string;
  keyScene: KeySceneView | null;
}
export interface SceneQueue {
  worldId: number;
  tick: string;
  reasons: readonly PauseReason[];
  world: WorldSnapshot;
  entries: SceneEntry[];
}

export function sceneQueue(reasons: readonly PauseReason[], world: WorldSnapshot, worldId: number,
  lifecycle: readonly PlayerLifecycleFact[]): SceneEntry[] {
  const entries: SceneEntry[] = [];
  const facts = [...lifecycle].sort((a, b) => BigInt(a.event) < BigInt(b.event) ? -1 : BigInt(a.event) > BigInt(b.event) ? 1 : 0);
  const seen = new Set<string>();
  function append(fact: PlayerLifecycleFact): void {
    const view = lifecycleKeyScene(worldId, world, fact);
    const identity = JSON.stringify(view.identity);
    if (seen.has(identity)) return;
    seen.add(identity);
    entries.push({ kind: fact.kind === 'death' ? 'funeral' : 'birth', node: null, identity, keyScene: view });
  }
  for (const fact of facts) if (fact.kind === 'death') append(fact);
  if (reasons.includes('dream_resolved') && world.last_dream !== undefined) entries.push({
    kind: 'dream', node: null, identity: JSON.stringify([worldId, 'dream', world.last_dream.tick]), keyScene: null,
  });
  for (const fact of facts) if (fact.kind !== 'death') append(fact);
  const node = world.player_node;
  if (node !== null) {
    const view = nodeKeyScene(worldId, world, node);
    entries.push({ kind: node.family === 'family_death' ? 'funeral' : node.family === 'inheritance' ? 'inheritance' : 'choice',
      node: node.id, identity: JSON.stringify(view.identity), keyScene: view });
  }
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
