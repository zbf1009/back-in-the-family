<script lang="ts">
  import { PORTRAIT_CELL, portraitAgeGroup, portraitId, type PortraitSet, type PortraitSubject } from '../art/portraits.ts';
  const props: PortraitSubject & { portraits: PortraitSet | null; label: string; pixelScale?: number } = $props();
  const pixelScale = $derived(props.pixelScale ?? 2);
  const extent = $derived(PORTRAIT_CELL * pixelScale);
  const id = $derived(portraitId(props));
  let canvas: HTMLCanvasElement | undefined = $state();
  $effect(() => {
    if (canvas === undefined || props.portraits === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Portrait canvas is unavailable');
    ctx.clearRect(0, 0, extent, extent);
    props.portraits.draw(ctx, id, 0, 0, pixelScale);
  });
</script>

<div role="img" aria-label={props.label} data-testid="portrait" data-person={props.person} data-sex={props.sex ?? 'unknown'}
  data-age={props.age ?? 'unknown'} data-pixel-scale={pixelScale} data-portrait-id={id} data-age-group={portraitAgeGroup(id)}>
  {#if props.portraits !== null}
    <canvas bind:this={canvas} width={extent} height={extent} aria-hidden="true" data-testid="portrait-canvas"></canvas>
  {/if}
</div>

<style>
  canvas { display: block; image-rendering: pixelated; }
</style>
