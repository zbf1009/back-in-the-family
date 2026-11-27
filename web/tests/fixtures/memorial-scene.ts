/// <reference lib="dom" />
/// <reference types="vite/client" />
import { mount } from 'svelte';
import baselineBytes from '../../../fixtures/parity/seed1-pairwise.snapshot-500.json?raw';
import type { StoryActor, StoryEvent } from '../../src/shared/story.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import type { EntryContext, LifePhase } from '../../src/main/life-context.ts';
import { captureMemorial } from '../../src/main/memorial.ts';
import MemorialSceneFixture from './MemorialSceneFixture.svelte';
import '../../src/ui/life.css';

declare global {
  interface Window { __memorialSceneFixture?: { read(): { world: WorldSnapshot; facts: StoryEvent[];
    identity: readonly [number, string]; lines: string[]; closeCount: number; settledCount: number; ordinaryTicks: number; inputs: never[] } } }
}
const world = JSON.parse(baselineBytes) as WorldSnapshot;
world.player_node = null;
const body = world.player.body!;
const deceased = 999999;
const actors = new Map<number, StoryActor>([
  [body, { person: body, soulId: world.player_soul, name: 'Current Player', sex: 'male', origin: 'native' }],
  [deceased, { person: deceased, soulId: '900', name: 'Olive Cooper', sex: 'female', origin: 'native', ageAtDeath: '60' }],
]);
const death: StoryEvent = { id: '9007199254740993', tick: '499', kind: { type: 'death', person: deceased },
  causedBy: [], tags: 0, relevance: 'circle', relevanceBasis: 'observed-day-start-end',
  actorContext: [{ relativeTo: body, basis: 'observed-day-start', actors: [{ person: body }, { person: deceased, kinRole: 'parent' }] }] };
const phase: LifePhase = { key: `7/life/${body}`, worldId: 7, kind: 'life', person: body, name: 'Current Player' };
const context: EntryContext = { phase, playerSoul: world.player_soul, focus: body, actors, actorContext: death.actorContext, formerBodies: new Map() };
const initial = captureMemorial({ worldId: 7, world, event: death, context, currentPhase: phase, opening: false });
if (initial === null) throw Error('Constructed memorial carrier is ineligible');
const inheritance: StoryEvent = { ...death, id: '9007199254740994', kind: { type: 'inheritance', deceased, heir: body, amount: '640' }, causedBy: [death.id] };
const target = document.getElementById('fixture');
if (target === null) throw Error('Memorial fixture mount target is missing');
mount(MemorialSceneFixture, { target, props: { initial, death, inheritance } });
