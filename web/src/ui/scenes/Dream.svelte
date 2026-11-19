<script lang="ts">
  import type { UiState } from '../../main/ui-state.ts';
  import { sceneLines, sceneStaging } from '../../main/templates.ts';
  import { placeholderSprites } from '../../art/sprites.ts';
  const { ui, onClose }: { ui: UiState; onClose: () => void } = $props();
  const world = $derived(ui.scene?.world ?? null);
  const lines = $derived(world === null ? [] : sceneLines('dream', world));
  const stage = $derived(world === null ? null : sceneStaging('dream', world));
  let canvas: HTMLCanvasElement;
  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || stage === null) return;
    ctx.clearRect(0, 0, 520, stage.height);
    for (const [index, prop] of stage.props.entries()) placeholderSprites.prop(ctx, prop, 200 + index * 40, 30);
    for (const marker of stage.markers) {
      placeholderSprites.resident(ctx, marker.x, marker.y, marker.tint);
      if (marker.soul) placeholderSprites.soulMarker(ctx, marker.x, marker.y);
    }
  });
</script>

<section class="scene" aria-label="Dream scene" data-testid="scene-dream">
  <canvas bind:this={canvas} width="520" height={stage?.height ?? 110} data-testid="scene-dream-canvas" aria-label="Scene props and named living people">
    Scene props and named living people.
  </canvas>
  {#each lines as line, index (index)}<p>{line}</p>{/each}
  {#if ui.scene?.entries[0]?.node === null}
    <button type="button" data-testid="scene-close" onclick={onClose}>Close</button>
  {/if}
</section>

<style>
  .scene { padding: 16px; background: #fffefa; border: 1px solid #858585; border-radius: 6px; box-shadow: 0 8px 24px #25252526; }
  canvas { display: block; width: 100%; height: auto; background: #f2f0e9; image-rendering: pixelated; }
  p { margin: 12px 0; line-height: 1.45; overflow-wrap: anywhere; }
  button { margin-top: 4px; }
</style>
