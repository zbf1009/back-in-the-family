<script lang="ts">
  import { onMount } from 'svelte';
  import type { PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import { nodeKeyScene, picturePeople, type KeySceneView, type SceneDocument } from '../main/key-scene.ts';
  import type { JournalActors } from '../main/journal-templates.ts';
  import { originLabel } from '../main/player-copy.ts';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { LIFE_SCENE_TEXT } from '../main/technical-text.ts';
  import { paintCradle, paintLifeDeparture, paintStageBackdrop, paintStagePerson, paintUnderworldDesk, stageSeason,
    type StageKind } from '../art/stage-paint.ts';
  import { STAGE_HEIGHT, STAGE_WIDTH, stagePixelScale } from '../art/stage-geometry.ts';

  const { world, sprites, kind, node, keyScene = null, onLayers, running = false, worldKey = 0, actors }: {
    world: WorldSnapshot | null; sprites: SpriteSet | null; kind: StageKind; node: PlayerNode | null;
    keyScene?: KeySceneView | null; running?: boolean; worldKey?: number; actors?: JournalActors;
    onLayers?: (layers: { base: HTMLCanvasElement; people: HTMLCanvasElement; focal: HTMLCanvasElement;
      departure?: HTMLCanvasElement; certificate?: HTMLElement; counterpart?: HTMLCanvasElement } | null) => void;
  } = $props();
  const scene = $derived(keyScene ?? (world !== null && node !== null ? nodeKeyScene(worldKey, world, node, actors) : null));
  const waitingBody = $derived(world?.player_wait == null ? null : world.player.earlier_bodies.find(body => body.id === world.player_wait!.ghost) ?? null);
  const participants = $derived(scene?.people ?? (world === null ? [] : picturePeople(world,
    kind === 'waiting' && waitingBody !== null ? [waitingBody.id] : world.player.body !== null ? [world.player.body] : [], node, actors)));
  const documentView = $derived.by((): SceneDocument | null => scene?.document ?? (kind === 'waiting' && waitingBody !== null ? {
    title: LIFE_SCENE_TEXT.death.document,
    fields: [{ label: LIFE_SCENE_TEXT.death.fields[0], value: waitingBody.name || 'Name unavailable' },
      { label: LIFE_SCENE_TEXT.death.fields[1], value: dateLabel(waitingBody.death) },
      ...(actors?.get(waitingBody.id)?.ageAtDeath === undefined ? []
        : [{ label: LIFE_SCENE_TEXT.death.fields[2], value: formatAmount(actors.get(waitingBody.id)!.ageAtDeath!) }])], note: LIFE_SCENE_TEXT.death.footer,
  } : null));
  const hasDocument = $derived(documentView !== null);
  const split = $derived(kind === 'family_death' || kind === 'inheritance' || kind === 'debt_due' || kind === 'feud');
  const transition = $derived(kind === 'death' || kind === 'rebirth');
  const season = $derived(stageSeason(scene?.date ?? world?.tick ?? '0'));
  const compositionKey = $derived(JSON.stringify([worldKey, world !== null, kind, season, scene?.source, scene?.lifecycle?.kind,
    scene?.certificate, scene?.arrivalPrice, documentView?.title,
    participants.map(person => [person.id, person.name, person.age, person.sex, person.origin, person.tint, person.soul, person.lifeStatus]) ]));
  let hidden = $state(typeof document !== 'undefined' && document.hidden);
  let viewport: HTMLDivElement | null | undefined = $state();
  let pixelScale = $state(1);
  let canvas: HTMLCanvasElement | null | undefined = $state();
  let peopleCanvas: HTMLCanvasElement | null | undefined = $state();
  let focalCanvas: HTMLCanvasElement | null | undefined = $state();
  let departureCanvas: HTMLCanvasElement | null | undefined = $state();
  let counterpartCanvas: HTMLCanvasElement | null | undefined = $state();
  let paper: HTMLElement | null | undefined = $state();
  let renderedKey: string | undefined;
  let renderedSprites: SpriteSet | null | undefined;
  let renderedCanvas: HTMLCanvasElement | null | undefined;
  let renderedDeparture: HTMLCanvasElement | null | undefined;
  let renderedCounterpart: HTMLCanvasElement | null | undefined;
  const ambient = $derived(running && !hidden && keyScene === null && node === null && sprites !== null);

  onMount(() => {
    const resize = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry !== undefined) pixelScale = stagePixelScale(entry.contentRect.width);
    });
    const currentViewport = viewport;
    if (currentViewport != null) {
      pixelScale = stagePixelScale(currentViewport.clientWidth);
      resize.observe(currentViewport);
    }
    const visibilityChanged = () => { hidden = document.hidden; };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => { resize.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged); };
  });

  $effect(() => {
    const publish = onLayers;
    const base = canvas;
    const people = peopleCanvas;
    const focal = focalCanvas;
    const departure = transition ? departureCanvas : undefined;
    const certificate = hasDocument ? paper : undefined;
    const counterpart = split ? counterpartCanvas : undefined;
    // bind:this clears removed elements to null, not just undefined.
    if (base == null || people == null || focal == null) return;
    if (transition && departure == null || hasDocument && certificate == null || split && counterpart == null) return;
    publish?.({ base, people, focal,
      ...(departure == null ? {} : { departure }),
      ...(certificate == null ? {} : { certificate }),
      ...(counterpart == null ? {} : { counterpart }) });
    return () => publish?.(null);
  });

  $effect(() => {
    const base = canvas?.getContext('2d');
    const people = peopleCanvas?.getContext('2d');
    const focal = focalCanvas?.getContext('2d');
    const departure = departureCanvas?.getContext('2d');
    const counterpart = counterpartCanvas?.getContext('2d');
    if (!base || !people || !focal || renderedKey === compositionKey && renderedSprites === sprites
      && renderedCanvas === canvas && renderedDeparture === departureCanvas && renderedCounterpart === counterpartCanvas) return;
    renderedKey = compositionKey; renderedSprites = sprites; renderedCanvas = canvas;
    renderedDeparture = departureCanvas; renderedCounterpart = counterpartCanvas;
    for (const ctx of [base, people, focal, departure, counterpart]) {
      if (ctx == null) continue;
      ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT); ctx.imageSmoothingEnabled = false;
    }
    if (world === null || sprites === null) return;
    paintStageBackdrop(base, sprites, kind, season, scene?.lifecycle?.kind, scene?.document.title);
    if (departure != null) {
      if (kind === 'death') paintLifeDeparture(departure, sprites);
      else paintUnderworldDesk(departure, sprites);
    }
    const first = participants[0];
    if (first !== undefined) {
      if (kind === 'rebirth' && scene?.lifecycle?.kind === 'birth') paintCradle(people, sprites, first);
      else paintStagePerson(people, sprites, first, split ? 64 : 84,
        kind === 'living' ? 150 : kind === 'death' || kind === 'waiting' ? 145 : 111,
        kind === 'death' || kind === 'waiting' || kind === 'dream' || kind === 'rebirth');
    }
    if (split && counterpart != null && participants[1] !== undefined) paintStagePerson(counterpart, sprites, participants[1], 352, 111);
    if (kind === 'dream' && scene?.dream !== undefined && participants[1] !== undefined) paintStagePerson(focal, sprites, participants[1], 344, 155);
    if (kind === 'living') {
      focal.fillStyle = '#ead59b'; focal.fillRect(270, 34, 12, 12);
      focal.fillStyle = '#a1b28c'; focal.fillRect(76, 132, 16, 4);
    } else if (kind === 'waiting') {
      focal.fillStyle = '#edd18c'; focal.fillRect(346, 44, 36, 4);
    }
  });
</script>

<figure class="scene-picture" class:split-picture={split} class:office-picture={kind === 'death' || kind === 'waiting'} class:ambient data-testid="scene-picture" data-kind={kind} data-pixel-scale={pixelScale}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (溢出区域使用原生键盘滚动。) -->
  <div class="picture-viewport" bind:this={viewport} tabindex="0" role="group" aria-label={scene?.title ?? (kind === 'waiting' ? 'Between lives' : 'Your life')}>
  <div class="picture-window" style={`--pixel-scale: ${pixelScale}; --document-width: ${STAGE_WIDTH - 184}px; width: ${STAGE_WIDTH * pixelScale}px; height: ${STAGE_HEIGHT * pixelScale}px`} data-focal-kind={scene?.focal.kind} data-focal-id={scene?.focal.id}>
    <canvas bind:this={canvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} data-testid="scene-picture-canvas"
      aria-label={scene?.title ?? (kind === 'waiting' ? 'Between lives' : 'Your life')}>
    </canvas>
    {#if transition}<canvas class="picture-layer departure-layer" bind:this={departureCanvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true"></canvas>{/if}
    <canvas class="picture-layer people-layer" bind:this={peopleCanvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} data-testid="scene-picture-people" data-person={participants[0]?.id} data-sex={participants[0]?.sex ?? 'neutral'} data-age={participants[0]?.age ?? 'unknown'} aria-hidden="true"></canvas>
    {#if split}<canvas class="picture-layer" bind:this={counterpartCanvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true"></canvas>{/if}
    <canvas class="picture-layer focal-layer" bind:this={focalCanvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} data-testid="scene-picture-focal" aria-hidden="true"></canvas>
    {#if documentView !== null}
      <div class="stage-document" class:dream-document={kind === 'dream'} bind:this={paper} aria-hidden="true">
        <h3>{documentView.title}</h3>
        {#if documentView.name !== undefined}<p class="document-name">{documentView.name}</p>{/if}
        <dl>{#each documentView.fields as field}<div class:response-stamp={field.role === 'response'}><dt>{field.label}</dt><dd>{field.value}</dd></div>{/each}</dl>
        {#if documentView.note !== undefined}<p class="document-note">{documentView.note}</p>{/if}
      </div>
    {:else if world !== null}
      <p class="calendar-page" aria-hidden="true">{dateLabel(world.tick)}</p>
    {/if}
  </div>
  </div>
  <figcaption class="sr-only">
    {#if participants.length > 0}<p>{scene?.lifecycle != null || kind === 'dream' ? 'Historical people' : node === null ? 'Current person' : 'People involved'}:
      {participants.map(person => `${person.name}${person.age === null ? '' : `, age ${formatAmount(String(person.age))}`}${person.origin === null ? '' : `, ${originLabel(person.origin)}`}${person.lifeStatus === 'deceased' ? ', deceased' : ''}`).join('; ')}.</p>{/if}
    {#if keyScene === null && documentView !== null}
      <p>{documentView.title}: {documentView.fields.map(field => `${field.label}: ${field.value}`).join('; ')}.</p>
    {/if}
  </figcaption>
</figure>

<style>
  .scene-picture { margin: 0; min-width: 0; max-width: 100%; color: var(--life-ink); }
  .picture-viewport { width: 100%; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-color: #647166 #e5dec3; }
  .picture-viewport:focus-visible { outline: 2px solid #005fcc; outline-offset: -2px; }
  .picture-window { position: relative; overflow: hidden; background: var(--life-paper); }
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  .picture-layer { position: absolute; inset: 0; pointer-events: none; }
  .departure-layer { opacity: 0; }
  .stage-document { position: absolute; left: calc(164px * var(--pixel-scale)); top: calc(24px * var(--pixel-scale)); width: calc(var(--document-width) * var(--pixel-scale)); height: calc(154px * var(--pixel-scale)); overflow: auto; box-sizing: border-box; padding: calc(10px * var(--pixel-scale)); background: #f5eed7; color: #263b3c; border: 1px solid #ab956d; font-family: Georgia, 'Times New Roman', serif; scrollbar-color: #647166 #f5eed7; }
  .office-picture .stage-document { left: calc(160px * var(--pixel-scale)); top: calc(78px * var(--pixel-scale)); height: calc(108px * var(--pixel-scale)); padding: calc(6px * var(--pixel-scale)); }
  .split-picture .stage-document { left: calc(132px * var(--pixel-scale)); top: calc(20px * var(--pixel-scale)); width: calc(152px * var(--pixel-scale)); height: calc(156px * var(--pixel-scale)); }
  .dream-document { left: calc(132px * var(--pixel-scale)); top: calc(16px * var(--pixel-scale)); width: calc(172px * var(--pixel-scale)); height: calc(164px * var(--pixel-scale)); padding: calc(8px * var(--pixel-scale)); }
  h3 { margin: 0 0 calc(5px * var(--pixel-scale)); font-size: calc(13px * var(--pixel-scale)); font-weight: 400; }
  .document-name { margin: 0 0 calc(5px * var(--pixel-scale)); font-size: calc(14px * var(--pixel-scale)); font-weight: 700; line-height: 1.12; }
  dl { margin: 0; font-size: calc(9px * var(--pixel-scale)); line-height: 1.2; }
  dl div { display: flex; flex-wrap: wrap; gap: calc(1px * var(--pixel-scale)) calc(5px * var(--pixel-scale)); margin-bottom: calc(3px * var(--pixel-scale)); }
  dt { color: #566451; } dd { margin: 0; }
  .response-stamp { margin-top: calc(4px * var(--pixel-scale)); padding: calc(3px * var(--pixel-scale)); border: 1px solid #546e60; background: #e8ebd8; color: #314f43; }
  .document-note { margin: calc(6px * var(--pixel-scale)) 0 0; padding-top: calc(3px * var(--pixel-scale)); border-top: 1px solid #c5b78d; font-size: calc(8px * var(--pixel-scale)); color: #566451; }
  .calendar-page { position: absolute; left: calc(22px * var(--pixel-scale)); top: calc(16px * var(--pixel-scale)); margin: 0; padding: calc(5px * var(--pixel-scale)) calc(6px * var(--pixel-scale)); background: #f3ebd3; color: #263b3c; font: calc(9px * var(--pixel-scale)) Georgia, serif; }
  figcaption { max-width: 72ch; font-size: 14px; line-height: 1.45; } p { margin: 8px 0; overflow-wrap: anywhere; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .ambient .people-layer { animation: breathing 4.8s steps(2, end) infinite; }
  .ambient .focal-layer { animation: lamplight 5.6s steps(2, end) infinite; }
  @keyframes breathing { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
  @keyframes lamplight { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .departure-layer { display: none; } .ambient .people-layer, .ambient .focal-layer { animation: none; } }
</style>
