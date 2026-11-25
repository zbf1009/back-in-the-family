<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { townDrawList } from '../main/town-layout.ts';
  import { resolveVisualKey, TINTS, type SpriteSet } from '../art/sprites.ts';

  const { ui, sprites }: { ui: UiState; sprites: SpriteSet | null } = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  const world = $derived(ui.world);
  const drawing = $derived(world === null ? null : townDrawList(world));
  const people = $derived(new Map(world?.residents.map(person => [person.id, person]) ?? []));
  const markers = $derived(drawing?.residents.map(marker => ({
    ...marker, visual: resolveVisualKey(marker.person, people.get(marker.person)?.age ?? null),
  })) ?? []);
  const height = $derived(Math.max(120, (drawing?.height ?? 0) + 32 + Math.ceil((drawing?.graves.length ?? 0) / 12) * 28));
  const compositionKey = $derived(JSON.stringify([
    drawing?.houses, markers.map(marker => [marker.person, marker.x, marker.y, marker.tint, marker.visual, marker.soul]),
    drawing?.graves.map(body => body.id), height,
  ]));
  let renderedKey: string | undefined;
  let renderedSprites: SpriteSet | null | undefined;
  let renderedCanvas: HTMLCanvasElement | undefined;

  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || renderedKey === compositionKey && renderedSprites === sprites && renderedCanvas === canvas) return;
    renderedKey = compositionKey;
    renderedSprites = sprites;
    renderedCanvas = canvas;
    ctx.clearRect(0, 0, 620, height);
    if (drawing === null || sprites === null) return;
    for (const house of drawing.houses) sprites.house(ctx, house.x, house.y, house.w, house.h);
    for (const marker of markers) {
      sprites.resident(ctx, marker.x, marker.y + 10, marker.tint, marker.visual);
      if (marker.soul) sprites.soulMarker(ctx, marker.x, marker.y - 8);
    }
    for (const [index] of drawing.graves.entries()) {
      sprites.grave(ctx, 22 + index % 12 * 50, drawing.height + 28 + Math.floor(index / 12) * 28);
    }
  });
</script>

<section class="town" aria-label="Town view">
  {#if drawing === null}
    <p>Create a World to meet the town.</p>
  {:else}
    <p class="map-note">Living Residents grouped by Household; positions are illustrative, not locations. Scroll to explore the map.</p>
    <a href="#town-map-scroll">Scroll town map with arrow keys</a>
    <div id="town-map-scroll" class="map-scroll" tabindex="-1" role="region" aria-label="Scrollable pixel town map">
      <canvas bind:this={canvas} width="620" {height} data-testid="town-view"
        aria-label={`Town view: ${markers.length} living Residents grouped by Household. Full names and markers follow below.`}>
        Living Residents are grouped by Household. Full names and markers follow below.
      </canvas>
    </div>
    <div class="legend" aria-label="Town marker legend">
      <span>Unmarked: neutral</span>
      <span style:color={TINTS.kin}>Blue side marker: blood tie</span>
      <span style:color={TINTS.rememberer}>Purple side marker: rememberer</span>
      <span style:color={TINTS.affected}>Red asset marker: affected by choice previews</span>
      <span>Gold asset marker: your Soul</span>
    </div>
    <div class="town-names" aria-label="Town residents and earlier lives">
      {#each drawing.houses as house (house.id)}
        <details>
          <summary>Household {house.id} · {markers.filter(marker => marker.household === house.id).length} living</summary>
          <ul>
            {#each markers.filter(marker => marker.household === house.id) as marker (marker.person)}
              {@const person = people.get(marker.person)}
              <li>{person?.name ?? `Person ${marker.person}`} · {person === undefined ? 'age unknown' : `age ${person.age}`} · {marker.soul ? 'your Soul' : marker.tint === 'kin' ? 'blood tie' : marker.tint === 'rememberer' ? 'rememberer' : marker.tint === 'affected' ? 'affected by choice previews' : 'neutral'}</li>
            {/each}
          </ul>
        </details>
      {/each}
      {#if drawing.graves.length > 0}
        <details>
          <summary>Earlier lives · {drawing.graves.length} graves</summary>
          <ul>{#each drawing.graves as body (body.id)}<li>{body.name} · {body.origin} · died at tick {body.death}</li>{/each}</ul>
        </details>
      {/if}
    </div>
  {/if}
</section>

<style>
  .town { min-width: 0; color: #24383c; }
  .map-note, .legend { color: #4e6263; font-size: 14px; line-height: 1.45; }
  .map-scroll { overflow: auto; max-height: 360px; background: #f7f6ef; scrollbar-color: #4e6263 #e9eee7; }
  .map-scroll:focus-visible, summary:focus-visible { outline: 2px solid #005fcc; outline-offset: 2px; }
  canvas { display: block; width: 620px; image-rendering: pixelated; }
  .legend { display: grid; gap: 6px; margin: 12px 0; }
  .town-names { font-size: 14px; }
  details { border-top: 1px solid #c1cdc4; padding: 8px 0; }
  summary { cursor: pointer; overflow-wrap: anywhere; }
  ul { padding-left: 20px; }
  li { margin: 6px 0; line-height: 1.45; overflow-wrap: anywhere; }
</style>
