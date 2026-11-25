import type { PlayerFamily, PlayerLifecycleFact, PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
import { resolveVisualKey, type LifeTile, type Tint, type VisualKey } from '../art/sprites.ts';
import { sceneLines } from './templates.ts';

export interface PicturePerson {
  id: number;
  name: string;
  age: number | null;
  origin: string | null;
  lifeStatus: 'alive' | 'deceased' | 'unknown';
  soul: boolean;
  visual: VisualKey;
  tint: Tint;
}

export interface KeySceneView {
  identity: readonly [number, string] | readonly [number, string, string];
  category: PlayerFamily | 'death' | 'rebirth';
  node: PlayerNode | null;
  lifecycle: PlayerLifecycleFact | null;
  world: WorldSnapshot;
  title: string;
  lines: string[];
  people: PicturePerson[];
  props: LifeTile[];
  focal: { kind: 'person' | 'prop'; id: number | LifeTile };
}

/** Only known living people stand; retained dead references use graves. */
export function picturePeople(world: WorldSnapshot, ids: readonly number[], node: PlayerNode | null): PicturePerson[] {
  return [...new Set(ids)].map(id => {
    const person = world.residents.find(person => person.id === id)
      ?? (world.magistrate.id === id ? world.magistrate : undefined);
    const earlier = world.player.earlier_bodies.find(body => body.id === id);
    const retainedName = world.person_names.find(person => person.id === id);
    return {
      id, name: person?.name ?? earlier?.name ?? retainedName?.name ?? `Person ${id}`,
      age: person?.age ?? null, origin: person?.origin ?? earlier?.origin ?? null,
      lifeStatus: earlier !== undefined || retainedName !== undefined || person?.alive === false ? 'deceased'
        : person?.alive === true ? 'alive' : 'unknown',
      soul: world.player.place === 'body' && world.player.body === id,
      visual: resolveVisualKey(id, person?.age ?? null),
      tint: (world.player.body === id ? 'self' : node?.options.some(option => option.preview.some(preview => preview.person === id))
        ? 'affected' : world.player.blood_ties.some(tie => tie.person === id) ? 'kin'
          : world.player.past_life_ties.some(tie => tie.rememberer === id) ? 'rememberer' : 'neutral') as Tint,
    };
  });
}

const NODE_TITLES: Record<PlayerFamily, string> = {
  family_death: 'Family death', inheritance: 'Inheritance', debt_due: 'Debt due', feud: 'Feud', life_stage: 'Life stage',
};

export function nodeKeyScene(worldId: number, world: WorldSnapshot, node: PlayerNode): KeySceneView {
  const people = picturePeople(world, node.stakes.who, node);
  const props: LifeTile[] = node.family === 'family_death' ? ['coffin', 'candle']
    : node.family === 'inheritance' ? ['table', 'will']
      : node.family === 'debt_due' ? ['table', 'register', 'seal']
        : node.family === 'feud' ? ['affected_marker'] : [];
  const lines = node.family === 'family_death' || node.family === 'inheritance'
    ? sceneLines({ kind: node.family === 'family_death' ? 'funeral' : 'inheritance', node: node.id, playerNode: node }, world)
    : [`${NODE_TITLES[node.family]} · fired at tick ${node.fired}`];
  lines.push(`Stakes: ${people.map(person => `${person.name} (Person ${person.id})`).join(', ')} · ${node.stakes.amount} ${node.stakes.unit} · by tick ${node.stakes.by}`,
    `Choice at tick ${node.choice_tick} · resolves at tick ${node.resolves}`);
  const person = people.find(person => person.lifeStatus !== 'unknown');
  const focal: KeySceneView['focal'] = node.family === 'inheritance' ? { kind: 'prop', id: 'will' }
    : node.family === 'debt_due' ? { kind: 'prop', id: 'seal' }
      : node.family === 'family_death' ? { kind: 'prop', id: 'candle' }
        : person !== undefined ? { kind: 'person', id: person.id } : { kind: 'prop', id: 'affected_marker' };
  if (focal.kind === 'prop' && !props.includes(focal.id as LifeTile)) props.push(focal.id as LifeTile);
  return { identity: [worldId, world.player_soul, node.id], category: node.family,
    node, lifecycle: null, world, title: NODE_TITLES[node.family], lines, people, props, focal };
}

/** Arrival/death history is bound to the actual event body, never the current ghost. */
export function lifecycleKeyScene(worldId: number, world: WorldSnapshot, fact: PlayerLifecycleFact): KeySceneView {
  // Biological Birth establishes age zero; other events carry no historical age.
  const age = fact.kind === 'birth' ? 0 : null;
  const people = picturePeople(world, [fact.body], null).map(person => ({
    ...person, name: fact.name, origin: fact.origin, age, visual: resolveVisualKey(person.id, age),
    lifeStatus: fact.kind === 'death' ? 'deceased' as const : person.lifeStatus,
  }));
  const death = fact.kind === 'death';
  const props: LifeTile[] = death ? ['coffin', 'candle'] : fact.kind === 'birth' ? ['cradle'] : ['register', 'seal'];
  return {
    identity: [worldId, fact.event], category: death ? 'death' : 'rebirth', node: null, lifecycle: fact, world,
    title: death ? 'Your death' : fact.kind === 'birth' ? 'Rebirth — native birth' : `Rebirth — ${fact.kind} arrival`,
    lines: sceneLines({ kind: death ? 'funeral' : 'birth', node: null, lifecycle: fact }, world),
    people, props, focal: { kind: 'prop', id: death ? 'candle' : fact.kind === 'birth' ? 'cradle' : 'seal' },
  };
}
