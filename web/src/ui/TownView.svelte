<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { townDrawList } from '../main/town-layout.ts';
  import { placeholderSprites } from '../art/sprites.ts';

  const { ui }: { ui: UiState } = $props();
  let canvas: HTMLCanvasElement;
  const drawing = $derived(ui.world === null ? null : townDrawList(ui.world));

  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 620, 460);
    ctx.fillStyle = '#f2f0e9';
    ctx.fillRect(0, 0, 620, 460);
    if (drawing === null) return;
    ctx.save();
    const scale = Math.min(1, 380 / drawing.height);
    ctx.scale(1, scale);
    for (const house of drawing.houses) {
      placeholderSprites.house(ctx, house.x, house.y, house.w, house.h);
      ctx.fillStyle = '#454545';
      ctx.font = '10px sans-serif';
      ctx.fillText(`House ${house.id}`, house.x + 7, house.y + 15);
    }
    for (const marker of drawing.residents) {
      placeholderSprites.resident(ctx, marker.x, marker.y, marker.tint);
      if (marker.soul) placeholderSprites.soulMarker(ctx, marker.x, marker.y);
    }
    ctx.restore();
    ctx.fillStyle = '#454545';
    ctx.font = '12px sans-serif';
    ctx.fillText('Earlier lives · graveyard', 16, 405);
    for (const [index, body] of drawing.graves.entries()) {
      const x = 22 + index % 6 * 100;
      const y = 425 + Math.floor(index / 6) * 22;
      placeholderSprites.grave(ctx, x, y);
      ctx.fillStyle = '#252525';
      ctx.fillText(body.name, x + 10, y + 4, 78);
    }
  });
</script>

<section class="town" aria-label="Town view">
  <canvas bind:this={canvas} width="620" height="460" data-testid="town-view"
    aria-label={drawing === null ? 'Town view: no World created' : `Town view: ${drawing.residents.length} living Residents grouped by Household`}>
    Living Residents are grouped by Household. The gold ring marks your soul.
  </canvas>
  {#if drawing === null}
    <p class="empty">Create a World to meet the town.</p>
  {/if}
  <p class="legend">One marker per living Resident. Gold ring: your soul.</p>
</section>

<style>
  .town { position: relative; }
  canvas { display: block; width: 620px; height: 460px; image-rendering: pixelated; }
  .empty { position: absolute; top: 190px; width: 100%; text-align: center; }
  .legend { margin: 10px 16px; font-size: 12px; color: #454545; }
  @media (max-width: 1279px) { canvas { max-width: 100%; height: auto; } }
</style>
