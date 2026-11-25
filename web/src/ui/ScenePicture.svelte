<script lang="ts">
  import type { PlayerFamily, PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
  import { type LifeTile, type SpriteSet } from '../art/sprites.ts';
  import { LIFE_TILES } from '../art/life-view-atlas.ts';
  import { picturePeople, type KeySceneView } from '../main/key-scene.ts';
  import { sceneLines } from '../main/templates.ts';

  const { world, sprites, kind, node, keyScene = null, onLayers }: {
    world: WorldSnapshot | null;
    sprites: SpriteSet | null;
    kind: 'living' | 'waiting' | PlayerFamily | 'death' | 'rebirth';
    node: PlayerNode | null;
    keyScene?: KeySceneView | null;
    onLayers?: (layers: { base: HTMLCanvasElement; people: HTMLCanvasElement; focal: HTMLCanvasElement } | null) => void;
  } = $props();

  const titles = {
    living: 'Current life', waiting: 'Waiting in the Underworld', family_death: 'Family death',
    inheritance: 'Inheritance', debt_due: 'Debt due', feud: 'Feud', life_stage: 'Life stage', death: 'Your death', rebirth: 'Rebirth',
  };
  const eventLines = $derived(keyScene?.lines ?? (world !== null && node !== null && (kind === 'family_death' || kind === 'inheritance')
    ? sceneLines({ kind: kind === 'family_death' ? 'funeral' : 'inheritance', node: node.id, playerNode: node }, world) : []));
  const participants = $derived(keyScene?.people ?? (world === null ? [] : picturePeople(world,
    node !== null ? node.stakes.who : kind === 'living' && world.player.body !== null ? [world.player.body] : [], node)));
  const illustrated = $derived(participants.filter(person => person.lifeStatus !== 'unknown').slice(0, 4));
  const waitingBody = $derived(world?.player_wait === null || world?.player_wait === undefined ? null
    : world.player.earlier_bodies.find(body => body.id === world.player_wait!.ghost) ?? null);
  const sceneProps = $derived.by((): LifeTile[] => {
    if (keyScene !== null) return keyScene.props;
    if (kind === 'waiting') return ['register', 'seal', 'joss_paper'];
    if (kind === 'family_death') return ['coffin', 'candle'];
    if (kind === 'inheritance') return ['table', 'will'];
    if (kind === 'debt_due') return ['table', 'register', 'seal'];
    if (kind === 'feud') return ['affected_marker'];
    if (kind === 'life_stage' && illustrated.some(person => person.age !== null && person.age < 3 && person.origin === 'native')) return ['cradle'];
    return [];
  });
  const compositionKey = $derived(JSON.stringify([
    world !== null, kind, sceneProps, waitingBody?.id ?? null, keyScene?.focal ?? null,
    illustrated.map(person => [person.id, person.visual, person.tint, person.soul, person.lifeStatus]),
  ]));
  let canvas: HTMLCanvasElement | undefined = $state();
  let peopleCanvas: HTMLCanvasElement | undefined = $state();
  let focalCanvas: HTMLCanvasElement | undefined = $state();
  let renderedKey: string | undefined;
  let renderedSprites: SpriteSet | null | undefined;
  let renderedCanvas: HTMLCanvasElement | undefined;

  $effect(() => {
    if (canvas === undefined || peopleCanvas === undefined || focalCanvas === undefined) return;
    onLayers?.({ base: canvas, people: peopleCanvas, focal: focalCanvas });
    return () => onLayers?.(null);
  });

  $effect(() => {
    const base = canvas?.getContext('2d');
    const people = peopleCanvas?.getContext('2d');
    const focal = focalCanvas?.getContext('2d');
    if (!base || !people || !focal || renderedKey === compositionKey && renderedSprites === sprites && renderedCanvas === canvas) return;
    renderedKey = compositionKey;
    renderedSprites = sprites;
    renderedCanvas = canvas;
    for (const ctx of [base, people, focal]) {
      ctx.clearRect(0, 0, 256, 80);
      ctx.imageSmoothingEnabled = false;
    }
    if (world === null || sprites === null) return;
    const art = sprites;
    function repeat(tile: LifeTile, y: number) {
      for (let x = 0; x < 256; x += LIFE_TILES[tile].w) art.prop(base!, tile, x, y);
    }
    if (kind === 'waiting' || kind === 'death') {
      repeat('night_sky', 0);
      repeat('floor', 64);
      if (kind === 'waiting') {
        art.prop(base, 'soul_marker', 48, 32);
        if (waitingBody !== null) art.grave(base, 96, 64);
      }
    } else if (kind === 'inheritance' || kind === 'debt_due' || kind === 'family_death' || kind === 'rebirth') {
      repeat('wall', 16);
      repeat('floor', 64);
    } else {
      repeat('grass', 64);
      repeat('sidewalk', 48);
      art.house(base, 184, 8, 64, 48);
      art.prop(base, 'tree', 8, 32);
    }
    for (const [index, prop] of sceneProps.entries()) {
      const target = keyScene?.focal.kind === 'prop' && keyScene.focal.id === prop ? focal : base;
      art.prop(target, prop, 136 + index * 40, 40);
    }
    for (const [index, person] of illustrated.entries()) {
      const x = kind === 'feud' ? 32 + index * 36 : 32 + index * 28;
      const target = keyScene?.focal.kind === 'person' && keyScene.focal.id === person.id ? focal : people;
      if (person.lifeStatus === 'deceased') art.grave(target, x, 64);
      else if (person.lifeStatus === 'alive') art.resident(target, x, 64, person.tint, person.visual);
      if (person.soul) art.soulMarker(target, x, 44);
    }
  });
</script>

<figure class="scene-picture" data-testid="scene-picture">
  <div class="picture-window" data-focal-kind={keyScene?.focal.kind} data-focal-id={keyScene?.focal.id}>
    <canvas bind:this={canvas} width="256" height="80" data-testid="scene-picture-canvas"
      aria-label={`${keyScene?.title ?? titles[kind]}. Symbolic pixel illustration; names and facts follow below.`}>
      Symbolic pixel illustration; names and facts follow below.
    </canvas>
    <canvas class="picture-layer" bind:this={peopleCanvas} width="256" height="80" data-testid="scene-picture-people" aria-hidden="true"></canvas>
    <canvas class="picture-layer" bind:this={focalCanvas} width="256" height="80" data-testid="scene-picture-focal" aria-hidden="true"></canvas>
  </div>
  <figcaption>
    <p class="picture-note">Illustration only, not location or attendance. Gold: Soul; blue: blood tie; purple: rememberer; red: choice-preview effect.</p>
    {#each eventLines as line}
      <p data-testid="scene-event-role">{line}</p>
    {/each}
    {#if keyScene?.lifecycle !== null && keyScene?.lifecycle !== undefined && world !== null}
      <p>Historical event-associated body. Current Soul {world.player_soul}: {world.player.place === 'waiting' ? 'Waiting' : `in body ${world.player.body}`}.</p>
    {/if}
    {#if kind === 'waiting' && world !== null}
      <p>Soul {world.player_soul} · Waiting{#if waitingBody !== null} · earlier body {waitingBody.name} · {waitingBody.origin} · died at tick {waitingBody.death}{/if}</p>
    {/if}
    {#if participants.length > 0}
      <p>{keyScene?.lifecycle != null ? 'Event-associated body' : node === null ? 'Current body' : 'Named participants'}: {participants.map(person => `${person.name} (Person ${person.id}; ${person.age === null ? 'age unknown' : `age ${person.age}`}${person.origin === null ? '' : `; ${person.origin}`}${person.lifeStatus === 'deceased' ? '; deceased' : person.lifeStatus === 'unknown' ? '; life status unknown' : ''}${person.soul ? '; your Soul' : person.tint === 'kin' ? '; blood tie marker' : person.tint === 'rememberer' ? '; rememberer marker' : person.tint === 'affected' ? '; affected by choice previews' : ''})`).join(', ')}.</p>
      {#if participants.length > illustrated.length}<p class="picture-note">The picture shows {illustrated.length} named participants with known life status; the full list is above.</p>{/if}
    {/if}
  </figcaption>
</figure>

<style>
  .scene-picture { margin: 0; min-width: 0; color: var(--life-ink); container-type: inline-size; }
  .picture-window { position: relative; width: 256px; height: 80px; max-width: 100%; overflow: hidden; background: var(--life-paper); }
  canvas { display: block; width: 256px; height: 80px; image-rendering: pixelated; }
  .picture-layer { position: absolute; inset: 0; pointer-events: none; }
  figcaption { max-width: 72ch; font-size: 14px; line-height: 1.45; }
  p { margin: 8px 0; overflow-wrap: anywhere; }
  .picture-note { color: var(--life-muted); }
  @container (min-width: 512px) {
    .picture-window, canvas { width: 512px; height: 160px; }
  }
  @media (max-width: 1100px) {
    .picture-window, canvas { width: 256px; height: 80px; }
  }
</style>
