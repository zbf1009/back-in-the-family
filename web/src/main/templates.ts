import type { UiState } from './ui-state.ts';
import type { ChronicleEntry, PlayerLifecycleFact, PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
import { namesById } from './view-model.ts';
import { townDrawList } from './town-layout.ts';

type SceneCue = SceneKind | { kind: SceneKind; node: string | null; playerNode?: PlayerNode; lifecycle?: PlayerLifecycleFact };
export type SceneKind = 'funeral' | 'inheritance' | 'dream' | 'birth';
export const EMPTY_CHRONICLE = 'Nothing has been written yet.';

function stakesText(entry: ChronicleEntry, world: WorldSnapshot): string {
  const names = namesById(world);
  return `${entry.stakes.who.map(id => names.get(id)!).join(', ')}; ${entry.stakes.amount} ${entry.stakes.unit}; by tick ${entry.stakes.by}`;
}

export function chronicleLine(entry: ChronicleEntry, world: WorldSnapshot): string {
  const skipped = entry.skipped.map(part => `part ${part.part}: ${part.reason}`).join('; ');
  return `Tick ${entry.tick} · ${entry.family} · ${stakesText(entry, world)} · ${entry.applied} · ${entry.source} · chooser absent: ${entry.chooser_absent ? 'yes' : 'no'} · skipped: ${skipped || 'none'}`;
}

export function chronicleLines(ui: UiState): string[] {
  const world = ui.world;
  if (world === null) return [];
  return world.chronicle.map((entry, index) => ({ entry, index }))
    .sort((a, b) => BigInt(a.entry.tick) === BigInt(b.entry.tick)
      ? b.index - a.index : BigInt(a.entry.tick) > BigInt(b.entry.tick) ? -1 : 1)
    .map(({ entry }) => chronicleLine(entry, world));
}

// Scene text and staging report only Snapshot facts (R10.11).
function scenePeople(cue: SceneCue, world: WorldSnapshot): number[] {
  const kind = typeof cue === 'string' ? cue : cue.kind;
  if (typeof cue !== 'string' && cue.lifecycle !== undefined) return [cue.lifecycle.body];
  const node = typeof cue === 'string' ? world.player_node : cue.playerNode ?? world.player_node;
  if (kind === 'funeral' || kind === 'inheritance') return node?.stakes.who ?? [];
  if (kind === 'dream') return world.last_dream === undefined ? [] : [world.last_dream.dreamer];
  return [];
}

export function sceneLines(cue: SceneCue, world: WorldSnapshot): string[] {
  const kind = typeof cue === 'string' ? cue : cue.kind;
  if (typeof cue !== 'string' && cue.lifecycle !== undefined) {
    const fact = cue.lifecycle;
    const body = world.player.earlier_bodies.find(body => body.id === fact.body);
    const lines = [fact.kind === 'death'
      ? `${fact.name} has died · tick ${fact.tick}`
      : fact.kind === 'birth' ? `${fact.name} was born · biological birth at tick ${fact.tick}`
        : `${fact.name} arrived by ${fact.kind} · entry at tick ${fact.tick} (not biological birth)`];
    lines.push(`Body ${fact.body} · ${fact.origin} · event ${fact.event}`);
    if (fact.kind === 'death') {
      const count = world.player.past_life_ties.filter(tie => tie.earlier_body === fact.body).length;
      lines.push(`Remembered by ${count} of the living.`);
    } else if (body !== undefined) lines.push(`This event-associated body subsequently died at tick ${body.death}.`);
    return lines;
  }
  const node = typeof cue === 'string' ? world.player_node : cue.playerNode ?? world.player_node;
  const names = namesById(world);
  const people = scenePeople(cue, world);
  if (people.length === 0) return [];
  switch (kind) {
    case 'funeral': {
      return [`${names.get(people[0]!)!} has died · tick ${node!.fired}`,
        ...(people.length > 1 ? [`Also in this choice: ${people.slice(1).map(id => names.get(id)!).join(', ')}`] : [])];
    }
    case 'inheritance': return [
      `${names.get(people[0]!)!} left you ${node!.stakes.amount} ${node!.stakes.unit} · tick ${node!.fired}`,
      ...(people.length > 1 ? [`Co-heirs named: ${people.slice(1).map(id => names.get(id)!).join(', ')}`] : []),
    ];
    case 'dream': {
      const dream = world.last_dream!;
      const text = {
        heed_warning: 'They took the warning to heart.', take_comfort: 'They took comfort from it.',
        follow_urging: 'They did what the dream urged.', believe_revelation: 'They believed what it revealed.',
        obey_ban: 'They obeyed the ban.', burn_offering: 'They burned joss paper for you.',
        burn_small: 'They burned a small bundle of joss paper for you.', dismiss_dream: 'They dismissed it and went on with the day.',
      };
      return [`${names.get(dream.dreamer)!} dreamt of you · tick ${dream.tick}`, text[dream.applied]];
    }
    case 'birth': return [];
  }
}

export function sceneStaging(cue: SceneCue, world: WorldSnapshot) {
  const kind = typeof cue === 'string' ? cue : cue.kind;
  const props: Record<SceneKind, ('coffin' | 'candle' | 'will' | 'cloud' | 'cradle')[]> = {
    funeral: ['coffin', 'candle'], inheritance: ['will'], dream: ['cloud'], birth: ['cradle'],
  };
  const town = new Map(townDrawList(world).residents.map(marker => [marker.person, marker]));
  const people = [...new Set(scenePeople(cue, world))].filter(id => town.has(id));
  return {
    props: props[kind], people,
    markers: people.map((id, index) => ({ ...town.get(id)!, x: 32 + index % 18 * 26, y: 72 + Math.floor(index / 18) * 18 })),
    height: Math.max(110, 90 + Math.ceil(people.length / 18) * 18),
  };
}
