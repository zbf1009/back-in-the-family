<script lang="ts">
  import type { UiState } from '../../main/ui-state.ts';
  import { sceneLines, sceneStaging } from '../../main/templates.ts';
  import { resolveVisualKey, type SpriteSet } from '../../art/sprites.ts';
  const { ui, sprites, onClose }: { ui: UiState; sprites: SpriteSet | null; onClose: () => void } = $props();
  const world = $derived(ui.scene?.world ?? null);
  const cue = $derived({ kind: 'funeral' as const, node: ui.scene?.entries[0]?.node ?? null });
  const lines = $derived(world === null ? [] : sceneLines(cue, world));
  const stage = $derived(world === null ? null : sceneStaging(cue, world));
  const markers = $derived(stage?.markers.slice(0, 4).map(marker => ({ ...marker,
    visual: resolveVisualKey(marker.person, world!.residents.find(person => person.id === marker.person)?.age ?? null),
  })) ?? []);
  const compositionKey = $derived(JSON.stringify([stage?.props, markers.map(marker => [marker.person, marker.visual, marker.tint, marker.soul]), world?.player_wait?.ghost]));
  let canvas: HTMLCanvasElement;
  let renderedKey: string | undefined;
  let renderedSprites: SpriteSet | null | undefined;
  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || renderedKey === compositionKey && renderedSprites === sprites) return;
    renderedKey = compositionKey;
    renderedSprites = sprites;
    ctx.clearRect(0, 0, 256, 80);
    if (stage === null || sprites === null) return;
    for (let x = 0; x < 256; x += 16) sprites.prop(ctx, 'floor', x, 64);
    for (const [index, prop] of stage.props.entries()) sprites.prop(ctx, prop, 136 + index * 40, 40);
    for (const [index, marker] of markers.entries()) {
      sprites.resident(ctx, 32 + index * 28, 64, marker.tint, marker.visual);
      if (marker.soul) sprites.soulMarker(ctx, 32 + index * 28, 44);
    }
    if (world?.player_wait !== null && world?.player_wait !== undefined) sprites.prop(ctx, 'soul_marker', 64, 32);
  });
</script>

<section class="scene" aria-label="Funeral scene" data-testid="scene-funeral">
  <canvas bind:this={canvas} width="256" height="80" data-testid="scene-funeral-canvas" aria-label="Symbolic funeral illustration; historical facts follow below.">
    Symbolic funeral illustration; historical facts follow below.
  </canvas>
  <p class="picture-note">Historical cue · symbolic illustration, not locations or attendance.</p>
  {#each lines as line, index (index)}<p>{line}</p>{/each}
  {#if (stage?.people.length ?? 0) > 0}
    <p>Named living people: {stage!.people.map(id => world!.person_names.find(person => person.id === id)?.name ?? `Person ${id}`).join(', ')}.</p>
  {/if}
  {#if ui.scene?.entries[0]?.node === null}
    <button type="button" data-testid="scene-close" onclick={onClose}>Close</button>
  {/if}
</section>

<style>
  .scene { min-width: 0; color: #24383c; }
  canvas { display: block; width: 256px; height: 80px; background: #f7f6ef; image-rendering: pixelated; }
  p { margin: 8px 0; line-height: 1.45; overflow-wrap: anywhere; }
  .picture-note { font-size: 14px; color: #4e6263; }
  button { min-height: 36px; margin-top: 4px; padding: 6px 14px; color: #24383c; background: #e9eee7; border: 1px solid #4e6263; font: inherit; cursor: pointer; }
  button:hover { background: #dbe5db; }
  button:focus-visible { outline: 2px solid #005fcc; outline-offset: 2px; }
</style>
