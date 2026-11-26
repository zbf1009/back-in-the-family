import type { PauseReason } from '../shared/protocol.ts';
import type { PlayerLifecycleFact, WorldSnapshot } from '../shared/world-snapshot.ts';
import type { DreamFact, StoryActor, StoryEvent } from '../shared/story.ts';
import { dreamKeyScene, dreamResolutionKeyScene, lifecycleKeyScene, nodeKeyScene, type KeySceneView } from './key-scene.ts';

export type SceneKind = 'funeral' | 'inheritance' | 'dream' | 'birth';

export interface SceneEntry {
  kind: SceneKind | 'choice';
  node: string | null;
  identity: string;
  keyScene: KeySceneView | null;
  world: WorldSnapshot;
}
export interface SceneQueue {
  worldId: number;
  tick: string;
  reasons: readonly PauseReason[];
  world: WorldSnapshot;
  entries: SceneEntry[];
}

export function sceneQueue(reasons: readonly PauseReason[], world: WorldSnapshot, worldId: number,
  lifecycle: readonly PlayerLifecycleFact[], actors: readonly StoryActor[] = [],
  dreams: readonly DreamFact[] = [], events: readonly StoryEvent[] = []): SceneEntry[] {
  const ordered = [
    ...lifecycle.map(fact => ({ event: fact.event, view: lifecycleKeyScene(worldId, world, fact, actors, events) })),
    ...dreams.map(fact => ({ event: fact.eventId, view: dreamKeyScene(worldId, world, fact, actors) })),
  ].sort((a, b) => {
    const left = BigInt(a.event);
    const right = BigInt(b.event);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const entries: SceneEntry[] = [];
  const seen = new Set<string>();
  for (const { view } of ordered) {
    const identity = JSON.stringify(view.identity);
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({ kind: view.category === 'death' ? 'funeral' : view.category === 'dream' ? 'dream' : 'birth',
      node: null, identity, keyScene: view, world: view.world });
  }
  const resolution = world.last_dream;
  const exactResolution = dreams.some(fact => fact.interpretation !== undefined);
  if (reasons.includes('dream_resolved') && resolution !== undefined && !exactResolution
    && BigInt(resolution.tick) + 1n === BigInt(world.tick)) {
    const view = dreamResolutionKeyScene(worldId, world, resolution);
    entries.push({ kind: 'dream', node: null, identity: JSON.stringify(view.identity), keyScene: view, world });
  }
  const node = world.player_node;
  if (node !== null) {
    const view = nodeKeyScene(worldId, world, node, actors);
    entries.push({ kind: node.family === 'family_death' ? 'funeral' : node.family === 'inheritance' ? 'inheritance' : 'choice',
      node: node.id, identity: JSON.stringify(view.identity), keyScene: view, world });
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
