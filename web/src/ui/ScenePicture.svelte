<script lang="ts">
  import type { PlayerFamily, PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
  import { resolveVisualKey, type LifeTile, type SpriteSet, type Tint } from '../art/sprites.ts';
  import { LIFE_TILES } from '../art/life-view-atlas.ts';

  const { world, sprites, kind, node }: {
    world: WorldSnapshot | null;
    sprites: SpriteSet | null;
    kind: 'living' | 'waiting' | PlayerFamily;
    node: PlayerNode | null;
  } = $props();

  const titles = {
    living: 'Current life', waiting: 'Waiting in the Underworld', family_death: 'Family death',
    inheritance: 'Inheritance', debt_due: 'Debt due', feud: 'Feud', life_stage: 'Life stage',
  };
  const ids = $derived(world === null ? [] : node !== null ? [...new Set(node.stakes.who)]
    : kind === 'living' && world.player.body !== null ? [world.player.body] : []);
  const participants = $derived(ids.map(id => {
    const person = world!.residents.find(person => person.id === id)
      ?? (world!.magistrate.id === id ? world!.magistrate : undefined);
    const earlier = world!.player.earlier_bodies.find(body => body.id === id);
    return {
      id, name: person?.name ?? earlier?.name ?? world!.person_names.find(person => person.id === id)?.name ?? `Person ${id}`,
      age: person?.age ?? null, origin: person?.origin ?? earlier?.origin ?? null,
      deceased: earlier !== undefined || person?.alive === false,
      soul: world!.player.place === 'body' && world!.player.body === id,
      visual: resolveVisualKey(id, person?.age ?? null),
      tint: (world!.player.body === id ? 'self' : node?.options.some(option => option.preview.some(preview => preview.person === id))
        ? 'affected' : world!.player.blood_ties.some(tie => tie.person === id) ? 'kin'
          : world!.player.past_life_ties.some(tie => tie.rememberer === id) ? 'rememberer' : 'neutral') as Tint,
    };
  }));
  const illustrated = $derived(participants.slice(0, 4));
  const waitingBody = $derived(world?.player_wait === null || world?.player_wait === undefined ? null
    : world.player.earlier_bodies.find(body => body.id === world.player_wait!.ghost) ?? null);
  const sceneProps = $derived.by((): LifeTile[] => {
    if (kind === 'waiting') return ['register', 'seal', 'joss_paper'];
    if (kind === 'family_death') return ['coffin', 'candle'];
    if (kind === 'inheritance') return ['table', 'will'];
    if (kind === 'debt_due') return ['table', 'register', 'seal'];
    if (kind === 'feud') return ['affected_marker'];
    if (kind === 'life_stage' && illustrated.some(person => person.age !== null && person.age < 3 && person.origin === 'native')) return ['cradle'];
    return [];
  });
  const compositionKey = $derived(JSON.stringify([
    world !== null, kind, sceneProps, waitingBody?.id ?? null,
    illustrated.map(person => [person.id, person.visual, person.tint, person.soul, person.deceased]),
  ]));
  let canvas: HTMLCanvasElement | undefined = $state();
  let renderedKey: string | undefined;
  let renderedSprites: SpriteSet | null | undefined;
  let renderedCanvas: HTMLCanvasElement | undefined;

  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || renderedKey === compositionKey && renderedSprites === sprites && renderedCanvas === canvas) return;
    renderedKey = compositionKey;
    renderedSprites = sprites;
    renderedCanvas = canvas;
    ctx.clearRect(0, 0, 256, 80);
    if (world === null || sprites === null) return;
    const art = sprites;
    function repeat(tile: LifeTile, y: number) {
      for (let x = 0; x < 256; x += LIFE_TILES[tile].w) art.prop(ctx!, tile, x, y);
    }
    if (kind === 'waiting') {
      repeat('night_sky', 0);
      repeat('floor', 64);
      art.prop(ctx, 'soul_marker', 48, 32);
      if (waitingBody !== null) art.grave(ctx, 96, 64);
    } else if (kind === 'inheritance' || kind === 'debt_due' || kind === 'family_death') {
      repeat('wall', 16);
      repeat('floor', 64);
    } else {
      repeat('grass', 64);
      repeat('sidewalk', 48);
      art.house(ctx, 184, 8, 64, 48);
      art.prop(ctx, 'tree', 8, 32);
    }
    for (const [index, prop] of sceneProps.entries()) art.prop(ctx, prop, 136 + index * 40, 40);
    for (const [index, person] of illustrated.entries()) {
      const x = 32 + index * 28;
      if (person.deceased) art.grave(ctx, x, 64);
      else art.resident(ctx, x, 64, person.tint, person.visual);
      if (person.soul) art.soulMarker(ctx, x, 44);
    }
  });
</script>

<figure class="scene-picture" data-testid="scene-picture">
  <div class="picture-window">
    <canvas bind:this={canvas} width="256" height="80" data-testid="scene-picture-canvas"
      aria-label={`${titles[kind]}. Symbolic pixel illustration; names and facts follow below.`}>
      Symbolic pixel illustration; names and facts follow below.
    </canvas>
  </div>
  <figcaption>
    <p class="picture-note">Illustration only, not location or attendance. Gold: Soul; blue: blood tie; purple: rememberer; red: choice-preview effect.</p>
    {#if kind === 'waiting' && world !== null}
      <p>Soul {world.player_soul} · Waiting{#if waitingBody !== null} · earlier body {waitingBody.name} · {waitingBody.origin} · died at tick {waitingBody.death}{/if}</p>
    {/if}
    {#if participants.length > 0}
      <p>{node === null ? 'Current body' : 'Named participants'}: {participants.map(person => `${person.name} (Person ${person.id}; ${person.age === null ? 'age unknown' : `age ${person.age}`}${person.origin === null ? '' : `; ${person.origin}`}${person.deceased ? '; deceased' : ''}${person.soul ? '; your Soul' : person.tint === 'kin' ? '; blood tie marker' : person.tint === 'rememberer' ? '; rememberer marker' : person.tint === 'affected' ? '; affected by choice previews' : ''})`).join(', ')}.</p>
      {#if participants.length > illustrated.length}<p class="picture-note">The picture shows the first {illustrated.length} named participants; the full list is above.</p>{/if}
    {/if}
  </figcaption>
</figure>

<style>
  .scene-picture { margin: 0; min-width: 0; color: #24383c; container-type: inline-size; }
  .picture-window { overflow: hidden; background: #f7f6ef; }
  canvas { display: block; width: 256px; height: 80px; image-rendering: pixelated; }
  figcaption { max-width: 72ch; font-size: 14px; line-height: 1.45; }
  p { margin: 8px 0; overflow-wrap: anywhere; }
  .picture-note { color: #4e6263; }
  @container (min-width: 512px) { canvas { width: 512px; height: 160px; } }
  @media (max-width: 1100px) { canvas { width: 256px; height: 80px; } }
</style>
