<script lang="ts">
  import { onMount } from 'svelte';
  import type { PlayerNode, WorldSnapshot } from '../shared/world-snapshot.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import { nodeKeyScene, picturePeople, type KeySceneView, type SceneDocument } from '../main/key-scene.ts';
  import { nameLabel, originLabel } from '../main/player-copy.ts';
  import { dateLabel, formatAmount } from '../main/calendar.ts';
  import { paintCradle, paintLifeDeparture, paintStageBackdrop, paintStagePerson, paintUnderworldDesk, stageSeason,
    STAGE_HEIGHT, STAGE_WIDTH, type StageKind } from '../art/stage-paint.ts';

  const { world, sprites, kind, node, keyScene = null, onLayers, running = false, worldKey = 0 }: {
    world: WorldSnapshot | null; sprites: SpriteSet | null; kind: StageKind; node: PlayerNode | null;
    keyScene?: KeySceneView | null; running?: boolean; worldKey?: number;
    onLayers?: (layers: { base: HTMLCanvasElement; people: HTMLCanvasElement; focal: HTMLCanvasElement;
      departure?: HTMLCanvasElement; certificate?: HTMLElement; counterpart?: HTMLCanvasElement } | null) => void;
  } = $props();
  const scene = $derived(keyScene ?? (world !== null && node !== null ? nodeKeyScene(worldKey, world, node) : null));
  const waitingBody = $derived(world?.player_wait == null ? null : world.player.earlier_bodies.find(body => body.id === world.player_wait!.ghost) ?? null);
  const participants = $derived(scene?.people ?? (world === null ? [] : picturePeople(world,
    kind === 'waiting' && waitingBody !== null ? [waitingBody.id] : world.player.body !== null ? [world.player.body] : [], node)));
  const documentView = $derived.by((): SceneDocument | null => scene?.document ?? (kind === 'waiting' && waitingBody !== null ? {
    title: 'Underworld paper bureau', name: nameLabel(waitingBody.name),
    fields: [{ label: 'Former life ended', value: dateLabel(waitingBody.death) }], note: 'Your applications are below',
  } : null));
  const split = $derived(kind === 'family_death' || kind === 'inheritance' || kind === 'debt_due' || kind === 'feud');
  const transition = $derived(kind === 'death' || kind === 'rebirth');
  const season = $derived(stageSeason(scene?.date ?? world?.tick ?? '0'));
  const compositionKey = $derived(JSON.stringify([worldKey, world !== null, kind, season, scene?.source, scene?.lifecycle?.kind,
    scene?.certificate, scene?.arrivalPrice, scene?.document, documentView,
    participants.map(person => [person.id, person.name, person.age, person.origin, person.visual, person.tint, person.soul, person.lifeStatus])]));
  let hidden = $state(typeof document !== 'undefined' && document.hidden);
  let canvas: HTMLCanvasElement | undefined = $state();
  let peopleCanvas: HTMLCanvasElement | undefined = $state();
  let focalCanvas: HTMLCanvasElement | undefined = $state();
  let departureCanvas: HTMLCanvasElement | undefined = $state();
  let counterpartCanvas: HTMLCanvasElement | undefined = $state();
  let paper: HTMLElement | undefined = $state();
  let renderedKey: string | undefined;
  let renderedSprites: SpriteSet | null | undefined;
  let renderedCanvas: HTMLCanvasElement | undefined;
  let renderedDeparture: HTMLCanvasElement | undefined;
  let renderedCounterpart: HTMLCanvasElement | undefined;
  const ambient = $derived(running && !hidden && keyScene === null && node === null && sprites !== null);

  onMount(() => {
    const visibilityChanged = () => { hidden = document.hidden; };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => document.removeEventListener('visibilitychange', visibilityChanged);
  });

  $effect(() => {
    if (canvas === undefined || peopleCanvas === undefined || focalCanvas === undefined) return;
    if (transition && departureCanvas === undefined || documentView !== null && paper === undefined || split && counterpartCanvas === undefined) return;
    onLayers?.({ base: canvas, people: peopleCanvas, focal: focalCanvas,
      ...(departureCanvas === undefined ? {} : { departure: departureCanvas }),
      ...(paper === undefined ? {} : { certificate: paper }),
      ...(counterpartCanvas === undefined ? {} : { counterpart: counterpartCanvas }) });
    return () => onLayers?.(null);
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
      else paintStagePerson(people, sprites, first, split ? 64 : 84, kind === 'living' ? 150 : 111, kind === 'death' || kind === 'waiting' || kind === 'dream' || kind === 'rebirth');
    }
    if (split && counterpart != null && participants[1] !== undefined) paintStagePerson(counterpart, sprites, participants[1], 384, 111);
    if (kind === 'dream' && scene?.dream !== undefined && participants[1] !== undefined) paintStagePerson(focal, sprites, participants[1], 376, 155);
    if (kind === 'living') {
      focal.fillStyle = '#ead59b'; focal.fillRect(270, 34, 12, 12);
      focal.fillStyle = '#a1b28c'; focal.fillRect(76, 132, 16, 4);
    } else if (kind === 'waiting') {
      focal.fillStyle = '#edd18c'; focal.fillRect(378, 44, 36, 4);
    }
  });
</script>

<figure class="scene-picture" class:split-picture={split} class:ambient data-testid="scene-picture" data-kind={kind}>
  <div class="picture-window" data-focal-kind={scene?.focal.kind} data-focal-id={scene?.focal.id}>
    <canvas bind:this={canvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} data-testid="scene-picture-canvas"
      aria-label={`${scene?.title ?? (kind === 'waiting' ? 'Waiting in the Underworld' : 'Current life')}. Illustrative pixel scenery; the actual people and facts are below.`}>
      Illustrative pixel scenery; the actual people and facts are below.
    </canvas>
    {#if transition}<canvas class="picture-layer departure-layer" bind:this={departureCanvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true"></canvas>{/if}
    <canvas class="picture-layer people-layer" bind:this={peopleCanvas} width={STAGE_WIDTH} height={STAGE_HEIGHT} data-testid="scene-picture-people" aria-hidden="true"></canvas>
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
  <figcaption>
    <p class="picture-note">Illustration, not a record of location, appearance or attendance.</p>
    {#if kind === 'waiting' && waitingBody !== null}<p>{nameLabel(waitingBody.name)}'s former life ended {dateLabel(waitingBody.death)}. {originLabel(waitingBody.origin)}.</p>{/if}
    {#if participants.length > 0}<p>{scene?.lifecycle != null || kind === 'dream' ? 'Historical people' : node === null ? 'Current person' : 'People involved'}:
      {participants.map(person => `${person.name}${person.age === null ? '' : `, age ${formatAmount(String(person.age))}`}${person.origin === null ? '' : `, ${originLabel(person.origin)}`}${person.lifeStatus === 'deceased' ? ', deceased' : ''}`).join('; ')}.</p>{/if}
    {#if keyScene === null && documentView !== null}
      <p>{documentView.title}: {documentView.fields.map(field => `${field.label}: ${field.value}`).join('; ')}.</p>
    {/if}
  </figcaption>
</figure>

<style>
  .scene-picture { margin: 0; min-width: 0; color: var(--life-ink); container-type: inline-size; }
  .picture-window { position: relative; width: 896px; max-width: 100%; aspect-ratio: 448 / 192; overflow: hidden; background: var(--life-paper); }
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  .picture-layer { position: absolute; inset: 0; pointer-events: none; }
  .departure-layer { opacity: 0; }
  .stage-document { position: absolute; left: 36.6%; top: 12.5%; width: 52%; min-height: 70%; box-sizing: border-box; padding: clamp(8px, 2.2cqi, 20px); background: #f5eed7; color: #263b3c; border: 1px solid #ab956d; font-family: Georgia, 'Times New Roman', serif; }
  .split-picture .stage-document { left: 29.5%; top: 10%; width: 41%; min-height: 72%; }
  .dream-document { left: 33%; top: 8%; width: 47%; min-height: 76%; padding: clamp(7px, 1.8cqi, 16px); }
  h3 { margin: 0 0 clamp(4px, 1.5cqi, 12px); font-size: clamp(12px, 2.8cqi, 26px); font-weight: 400; }
  .document-name { margin: 0 0 clamp(4px, 1.5cqi, 12px); font-size: clamp(12px, 3.1cqi, 28px); font-weight: 700; line-height: 1.12; }
  dl { margin: 0; font-size: clamp(10px, 2cqi, 18px); line-height: 1.2; }
  dl div { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-bottom: 4px; }
  dt { color: #566451; } dd { margin: 0; }
  .dream-document dl { font-size: clamp(9px, 1.8cqi, 16px); }
  .response-stamp { margin-top: 8px; padding: 6px; border: 1px solid #546e60; background: #e8ebd8; color: #314f43; }
  .document-note { margin: clamp(4px, 2cqi, 18px) 0 0; padding-top: 6px; border-top: 1px solid #c5b78d; font-size: clamp(9px, 1.8cqi, 16px); color: #566451; }
  .calendar-page { position: absolute; left: 5%; top: 8%; margin: 0; padding: 10px 12px; background: #f3ebd3; color: #263b3c; font: clamp(12px, 2cqi, 18px) Georgia, serif; }
  figcaption { max-width: 72ch; font-size: 14px; line-height: 1.45; } p { margin: 8px 0; overflow-wrap: anywhere; }
  .picture-note { color: var(--life-muted); }
  .ambient .people-layer { animation: breathing 4.8s steps(2, end) infinite; }
  .ambient .focal-layer { animation: lamplight 5.6s steps(2, end) infinite; }
  @keyframes breathing { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
  @keyframes lamplight { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .departure-layer { display: none; } .ambient .people-layer, .ambient .focal-layer { animation: none; } }
  @container (max-width: 420px) {
    .stage-document { top: 8%; padding: 6px; }
    .document-note { display: none; }
    dl div { gap: 1px 4px; margin-bottom: 2px; }
    .stage-document dl div:nth-child(n+3):not(.response-stamp) { display: none; }
    .response-stamp { margin-top: 4px; padding: 3px; }
  }
</style>
