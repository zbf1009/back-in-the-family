<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { KeySceneView } from '../main/key-scene.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import { dateLabel } from '../main/calendar.ts';
  import ScenePicture from './ScenePicture.svelte';

  const { view, sprites, onClose, presentationVersion = 0, onSettled, next = false, preSettled = false }: {
    view: KeySceneView; sprites: SpriteSet | null; onClose?: () => void;
    presentationVersion?: number; onSettled?: () => void; next?: boolean; preSettled?: boolean;
  } = $props();
  type Layers = { base: HTMLCanvasElement; people: HTMLCanvasElement; focal: HTMLCanvasElement;
    departure?: HTMLCanvasElement; certificate?: HTMLElement; counterpart?: HTMLCanvasElement };
  type Beat = 'establish' | 'focus' | 'settle' | 'settled';
  const identity = $derived(JSON.stringify(view.identity));
  const characters = $derived(Array.from(view.lines.join('\n\n')));
  let layers: Layers | null = $state(null);
  let reduced = $state(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let hidden = $state(typeof document !== 'undefined' && document.hidden);
  let beat: Beat = $state('settled');
  let visibleCharacters = $state(Infinity);
  let playedIdentity: string | null = null;
  let settledIdentity: string | null = null;
  let actionVersion = untrack(() => presentationVersion);
  let animations: Animation[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];
  let textTimer: ReturnType<typeof setInterval> | undefined;
  let run = 0;

  function release(current: Layers | null): void {
    run++;
    for (const animation of animations) animation.cancel();
    animations = [];
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    if (textTimer !== undefined) clearInterval(textTimer);
    textTimer = undefined;
    if (current !== null) for (const layer of Object.values(current)) layer.style.removeProperty('will-change');
  }

  function settled(): void {
    beat = 'settled';
    visibleCharacters = Infinity;
    if (settledIdentity !== identity) {
      settledIdentity = identity;
      onSettled?.();
    }
  }

  function showAll(): void {
    visibleCharacters = Infinity;
    if (textTimer !== undefined) clearInterval(textTimer);
    textTimer = undefined;
  }

  function skip(): void {
    playedIdentity = identity;
    release(layers);
    settled();
  }

  function receiveLayers(value: Layers | null): void { layers = value; }
  function preventRepeatedActivation(event: KeyboardEvent): void {
    if (event.repeat && (event.key === ' ' || event.key === 'Enter')) event.preventDefault();
  }
  function close(event: MouseEvent): void {
    if (event.detail > 1) return;
    skip();
    onClose?.();
  }

  onMount(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionChanged = () => { reduced = preference.matches; if (reduced) skip(); };
    const visibilityChanged = () => { hidden = document.hidden; if (hidden) skip(); };
    preference.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      preference.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
      release(layers);
    };
  });

  $effect(() => {
    const version = presentationVersion;
    if (version === actionVersion) return;
    actionVersion = version;
    untrack(skip);
  });

  $effect(() => {
    const id = identity;
    const current = layers;
    const artReady = sprites !== null;
    const quiet = reduced || hidden || preSettled;
    if (current === null) return;
    release(current);
    if (!artReady || quiet || playedIdentity === id) {
      if (quiet) playedIdentity = id;
      untrack(settled);
      return;
    }
    playedIdentity = id;
    settledIdentity = null;
    const generation = run;
    const category = untrack(() => view.category);
    const duration = category === 'death' || category === 'rebirth' ? 7000 : category === 'dream' ? 6500 : 5000;
    const scale = current.base.getBoundingClientRect().width / 448;
    const ease = 'cubic-bezier(0.77, 0, 0.175, 1)';
    const movement = (x: number, y = 0) => `translate(${x * scale}px, ${y * scale}px)`;
    beat = 'establish';
    visibleCharacters = 0;
    const started = performance.now();
    textTimer = setInterval(() => {
      if (generation !== run) return;
      visibleCharacters = Math.floor((performance.now() - started) * 35 / 1000);
      if (visibleCharacters >= untrack(() => characters.length)) showAll();
    }, 100);

    function animate(layer: HTMLElement, frames: Keyframe[]): void {
      layer.style.willChange = 'transform, opacity';
      animations.push(layer.animate(frames, { duration, easing: 'linear', fill: 'forwards' }));
    }
    if (current.departure !== undefined) animate(current.departure, [
      { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.36 },
      { opacity: 0, offset: 0.67 }, { opacity: 0, offset: 1 },
    ]);
    const portraitStart = category === 'feud' ? movement(44) : category === 'life_stage' ? movement(0, 40)
      : category === 'rebirth' ? movement(80) : movement(56);
    animate(current.people, [
      { transform: portraitStart, opacity: 0.35, offset: 0 },
      { transform: portraitStart, opacity: 1, offset: 0.12, easing: ease },
      { transform: movement(0), opacity: 1, offset: 0.62 },
      { transform: movement(0), opacity: 1, offset: 1 },
    ]);
    if (current.counterpart !== undefined) {
      const otherStart = category === 'feud' ? movement(-44) : movement(-56);
      animate(current.counterpart, [
        { transform: otherStart, opacity: 0.5, offset: 0 },
        { transform: otherStart, opacity: 1, offset: 0.12, easing: ease },
        { transform: movement(0), opacity: 1, offset: 0.62 },
        { transform: movement(0), opacity: 1, offset: 1 },
      ]);
    }
    if (current.certificate !== undefined) {
      const paperStart = category === 'inheritance' ? movement(-64) : category === 'family_death' ? movement(0, 48)
        : category === 'debt_due' ? movement(0, -56) : category === 'life_stage' ? movement(80) : movement(64);
      animate(current.certificate, [
        { transform: paperStart, opacity: 0, clipPath: 'inset(0 70% 0 0)', offset: 0 },
        { transform: paperStart, opacity: 0.35, clipPath: 'inset(0 70% 0 0)', offset: 0.12, easing: ease },
        { transform: movement(0), opacity: 1, clipPath: 'inset(0 0 0 0)', offset: 0.60 },
        { transform: movement(0), opacity: 1, clipPath: 'inset(0 0 0 0)', offset: 1 },
      ]);
    }
    if (category === 'dream') animate(current.focal, [
      { opacity: 0, transform: movement(-64), offset: 0 },
      { opacity: 0, transform: movement(-64), offset: 0.36, easing: ease },
      { opacity: 1, transform: movement(0), offset: 0.78 },
      { opacity: 1, transform: movement(0), offset: 1 },
    ]);
    timers.push(setTimeout(() => { if (run === generation) beat = 'focus'; }, 800));
    timers.push(setTimeout(() => { if (run === generation) beat = 'settle'; }, duration * 0.6));
    timers.push(setTimeout(() => {
      if (run !== generation) return;
      release(current);
      untrack(settled);
    }, duration));
    return () => release(current);
  });
</script>

<section class="key-scene" aria-label={view.title} data-testid="key-scene" data-category={view.category}
  data-identity={identity} data-beat={beat}>
  <div class="scene-heading"><h2>{view.title}</h2><p>{dateLabel(view.date)}</p></div>
  <div class="scene-controls">
    <button type="button" onclick={showAll} onkeydown={preventRepeatedActivation}>Show all text</button>
    <button type="button" data-testid="scene-skip" onclick={skip} onkeydown={preventRepeatedActivation}>Skip scene</button>
    {#if view.node === null && onClose !== undefined}
      <button type="button" data-testid="scene-close" onclick={close} onkeydown={preventRepeatedActivation}>{next ? 'Continue' : 'Close scene'}</button>
    {/if}
  </div>
  <ScenePicture world={view.world} {sprites} kind={view.category} node={view.node} keyScene={view} worldKey={view.identity[0]} onLayers={receiveLayers} />
  <div class="scene-paragraphs" aria-hidden="true">
    <p>{characters.slice(0, visibleCharacters).join('')}</p>
  </div>
  <div class="accessible-facts">
    {#each view.lines as line}<p>{line}</p>{/each}
    <dl>{#each view.document.fields as field}<div><dt>{field.label}</dt><dd>{field.value}</dd></div>{/each}</dl>
  </div>
  <p class="picture-status" data-testid="scene-playback-status">{beat === 'settled' ? 'The picture has settled. Your next action is available.' : 'Your actions are available now; the picture can wait.'}</p>
</section>

<style>
  .key-scene { min-width: 0; }
  .scene-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 16px; margin-bottom: 12px; }
  h2 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: clamp(24px, 3vw, 34px); font-weight: 400; }
  .scene-heading p { margin: 0; color: var(--life-muted); }
  .scene-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .scene-controls button { min-height: 40px; padding: 8px 14px; border: 1px solid #647166; background: #f4efd9; color: #263b3c; font: inherit; cursor: pointer; }
  .scene-controls button:focus-visible { outline: 2px solid #005fcc; outline-offset: 3px; }
  .scene-controls button:disabled { cursor: default; opacity: 0.6; }
  .scene-controls button:hover:not(:disabled) { background: #e5dec3; }
  .scene-paragraphs { max-width: 72ch; min-height: 5.5em; font-size: 18px; line-height: 1.55; }
  .scene-paragraphs p { margin: 12px 0; white-space: pre-line; overflow-wrap: anywhere; }
  .accessible-facts { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .picture-status { margin: 8px 0 0; color: var(--life-muted); font-size: 14px; }
  ::selection { background: #c6d4b9; color: #172d2e; }
</style>
