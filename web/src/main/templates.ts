import type { UiState } from './ui-state.ts';
import type { ChronicleEntry, WorldSnapshot } from '../shared/world-snapshot.ts';
import { namesById } from './view-model.ts';

export type SceneKind = 'funeral' | 'inheritance' | 'dream' | 'birth';
export const EMPTY_CHRONICLE = 'Nothing has been written yet.';

function stakesText(entry: ChronicleEntry, world: WorldSnapshot): string {
  const names = namesById(world);
  return `${entry.stakes.who.map(id => names.get(id)!).join(', ')}; ${entry.stakes.amount} ${entry.stakes.unit}; by tick ${entry.stakes.by}`;
}

export function chronicleLine(entry: ChronicleEntry, world: WorldSnapshot): string {
  return `Tick ${entry.tick} · ${entry.family} · ${stakesText(entry, world)} · ${entry.applied} · ${entry.source}`;
}

export function chronicleLines(ui: UiState): string[] {
  const world = ui.world;
  if (world === null) return [];
  return world.chronicle.map((entry, index) => ({ entry, index }))
    .sort((a, b) => BigInt(a.entry.tick) === BigInt(b.entry.tick)
      ? b.index - a.index : BigInt(a.entry.tick) > BigInt(b.entry.tick) ? -1 : 1)
    .map(({ entry }) => chronicleLine(entry, world));
}

// These lines stage Snapshot facts; they do not describe an unreported outcome.
export function sceneLines(kind: SceneKind, world: WorldSnapshot): string[] {
  const names = namesById(world);
  const who = world.player_node?.stakes.who.map(id => names.get(id)!).join(', ');
  switch (kind) {
    case 'funeral': return who === undefined
      ? world.player.earlier_bodies.map(body => `${body.name} · funeral · tick ${body.death}`)
      : [`${who} · family_death · tick ${world.player_node!.fired}`];
    case 'inheritance': return world.player_node === null ? []
      : [`${who} · inheritance · ${world.player_node.stakes.amount} ${world.player_node.stakes.unit} · by tick ${world.player_node.stakes.by}`];
    case 'dream': return [`A dream reaches the town · tick ${world.tick}`];
    case 'birth': return world.player.body === null ? []
      : [`${names.get(world.player.body)!} · a new life · tick ${world.tick}`];
  }
}
