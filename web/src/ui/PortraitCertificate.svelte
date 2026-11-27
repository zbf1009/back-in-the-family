<script lang="ts">
  import { onMount } from 'svelte';
  import type { SpriteSet } from '../art/sprites.ts';
  import { paintOfficeInterior } from '../art/office-interior.ts';
  import { STAGE_HEIGHT, STAGE_WIDTH, stagePixelScale } from '../art/stage-geometry.ts';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { LIFE_SCENE_TEXT, TECHNICAL_TEXT, supportedText } from '../main/technical-text.ts';
  import Portrait from './Portrait.svelte';

  const { sprites, person, sex, name, deathDay, age, identity, onClose }: {
    sprites: SpriteSet; person: number; sex?: 'female' | 'male';
    name: string; deathDay: string; age: number | null; identity: string;
    onClose: (identity: string) => void;
  } = $props();
  const date = $derived(dateLabel(deathDay));
  const ageText = $derived(age === null ? undefined : formatAmount(String(age)));
  const words = $derived(LIFE_SCENE_TEXT.death.lines.map(template => supportedText(template, { 'Full Name': name, n: ageText, date })).filter(line => line !== null).join('\n'));
  let canvas: HTMLCanvasElement;
  let viewport: HTMLDivElement;
  let pixelScale = $state(1);
  let paper: HTMLDivElement;
  let portraitFile: HTMLDivElement;
  let visible = $state(0);
  let closed = $state(false);
  let animations: Animation[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;

  function showAll(): void { visible = words.length; }
  function skip(): void {
    showAll();
    for (const animation of animations) animation.finish();
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }
  function close(): void { if (closed) return; closed = true; skip(); onClose(identity); }
  function preventRepeat(event: KeyboardEvent): void { if (event.repeat) event.preventDefault(); }

  $effect(() => {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Interior canvas is unavailable');
    paintOfficeInterior(ctx, sprites);
  });

  onMount(() => {
    const resize = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry !== undefined) pixelScale = stagePixelScale(entry.contentRect.width);
    });
    pixelScale = stagePixelScale(viewport.clientWidth);
    resize.observe(viewport);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    function settle(): void { if (document.hidden || reduced.matches) skip(); }
    if (document.hidden || reduced.matches) showAll();
    else {
      const timing = { duration: 7000, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'both' as const };
      animations = [
        paper.animate([{ transform: `translate(${-140 * pixelScale}px, ${64 * pixelScale}px)`, opacity: 0.45, clipPath: 'inset(0 0 60% 0)' },
          { transform: 'translate(0, 0)', opacity: 1, clipPath: 'inset(0)' }], timing),
        portraitFile.animate([{ transform: `translate(0, ${-100 * pixelScale}px)`, opacity: 0.6 },
          { transform: 'translate(0, 0)', opacity: 1 }], timing),
      ];
      timer = setInterval(() => {
        visible = Math.min(words.length, visible + 1);
        if (visible === words.length && timer !== undefined) { clearInterval(timer); timer = undefined; }
      }, 1000 / 35);
    }
    document.addEventListener('visibilitychange', settle);
    reduced.addEventListener('change', settle);
    return () => {
      resize.disconnect();
      if (timer !== undefined) clearInterval(timer);
      for (const animation of animations) animation.cancel();
      document.removeEventListener('visibilitychange', settle);
      reduced.removeEventListener('change', settle);
    };
  });
</script>

<section aria-labelledby="portrait-certificate-title" data-testid="portrait-certificate" data-identity={identity}>
  <div class="heading"><h2 id="portrait-certificate-title">{LIFE_SCENE_TEXT.death.title}</h2><p>{date}</p></div>
  <div class="controls">
    <button type="button" onclick={showAll} onkeydown={preventRepeat}>{TECHNICAL_TEXT.showAll}</button>
    <button type="button" onclick={skip} onkeydown={preventRepeat}>{TECHNICAL_TEXT.skip}</button>
    <button type="button" onclick={close} onkeydown={preventRepeat}>{TECHNICAL_TEXT.close}</button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (溢出区域使用原生键盘滚动。) -->
  <div class="stage-viewport" bind:this={viewport} tabindex="0" role="region" aria-label={LIFE_SCENE_TEXT.death.title}>
  <div class="stage" style={`--pixel-scale: ${pixelScale}; --document-width: ${STAGE_WIDTH - 184}px; width: ${STAGE_WIDTH * pixelScale}px; height: ${STAGE_HEIGHT * pixelScale}px`} data-pixel-scale={pixelScale}>
    <canvas bind:this={canvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true"></canvas>
    <div class="portrait-file" bind:this={portraitFile}>
      <Portrait portraits={sprites.portraits} {person} {sex} {age} label={name} {pixelScale} />
      <span>{name}</span>
    </div>
    <div class="certificate" bind:this={paper}>
      <h3>{LIFE_SCENE_TEXT.death.document}</h3>
      <dl>
        <div><dt>{LIFE_SCENE_TEXT.death.fields[0]}</dt><dd>{name}</dd></div>
        <div><dt>{LIFE_SCENE_TEXT.death.fields[1]}</dt><dd>{date}</dd></div>
        {#if ageText !== undefined}<div><dt>{LIFE_SCENE_TEXT.death.fields[2]}</dt><dd>{ageText}</dd></div>{/if}
      </dl>
      <p>{LIFE_SCENE_TEXT.death.footer}</p>
    </div>
  </div>
  </div>
  <div class="scene-words" aria-hidden="true"><p>{words.slice(0, visible)}</p></div>
  <div class="screen-reader">{words}</div>
</section>

<style>
  section { min-width: 0; }
  .heading { display: flex; align-items: baseline; flex-wrap: wrap; justify-content: space-between; gap: 8px 20px; }
  h2 { margin: 0; font: 400 clamp(28px, 3vw, 38px)/1.2 Georgia, serif; }
  .heading p { margin: 0; color: #4b5d55; font-variant-numeric: tabular-nums; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  button { min-height: 44px; padding: 9px 18px; border: 1px solid #66736b; background: #f4efd9; color: #263b3c; font: inherit; cursor: pointer; }
  .controls button:focus-visible { outline: 3px solid #315e65; outline-offset: 3px; background: #f4efd9; color: #263b3c; }
  button:active { transform: scale(0.97); }
  .controls button:hover:not(:disabled) { background: #e5dec3; color: #263b3c; }
  .stage-viewport { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-color: #647166 #e5dec3; }
  .stage-viewport:focus-visible { outline: 2px solid #005fcc; outline-offset: -2px; }
  .stage { position: relative; overflow: hidden; background: #435048; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
  .portrait-file { position: absolute; top: calc(77px * var(--pixel-scale)); left: calc(44px * var(--pixel-scale)); width: calc(80px * var(--pixel-scale)); height: calc(74px * var(--pixel-scale)); box-sizing: border-box; background: #c8b17b; padding: calc(4px * var(--pixel-scale)) calc(8px * var(--pixel-scale)); }
  .portrait-file::after { content: ''; position: absolute; bottom: calc(2px * var(--pixel-scale)); left: calc(4px * var(--pixel-scale)); width: calc(72px * var(--pixel-scale)); height: calc(6px * var(--pixel-scale)); background: #675c48; }
  .portrait-file span { position: absolute; z-index: 1; bottom: 0; left: calc(4px * var(--pixel-scale)); width: calc(72px * var(--pixel-scale)); height: calc(8px * var(--pixel-scale)); overflow: hidden; background: #675c48; color: #f4ebd0; font: calc(7px * var(--pixel-scale))/1 Georgia, serif; text-align: center; }
  .certificate { position: absolute; top: calc(78px * var(--pixel-scale)); left: calc(160px * var(--pixel-scale)); width: calc(var(--document-width) * var(--pixel-scale)); height: calc(108px * var(--pixel-scale)); overflow: auto; padding: calc(6px * var(--pixel-scale)); box-sizing: border-box; color: #273d37; background: #f5efd6; border: 1px solid #ab956d; scrollbar-color: #647166 #f5efd6; }
  h3 { margin: 0 0 calc(5px * var(--pixel-scale)); font: 400 calc(13px * var(--pixel-scale))/1.2 Georgia, serif; }
  dl { margin: 0; font-size: calc(9px * var(--pixel-scale)); }
  dl div { display: flex; flex-wrap: wrap; gap: calc(1px * var(--pixel-scale)) calc(5px * var(--pixel-scale)); margin-top: calc(3px * var(--pixel-scale)); }
  dt { color: #526357; }
  dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .certificate p { margin: calc(6px * var(--pixel-scale)) 0 0; font-size: calc(8px * var(--pixel-scale)); color: #526357; }
  .scene-words { max-width: 72ch; min-height: 5.5em; font: 18px/1.55 Georgia, serif; white-space: pre-line; }
  .scene-words p { margin: 16px 0; }
  .screen-reader { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: pre-line; }
</style>
