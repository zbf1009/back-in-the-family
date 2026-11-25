<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { KeySceneView } from '../main/key-scene.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import ScenePicture from './ScenePicture.svelte';

  const { view, sprites, onClose }: {
    view: KeySceneView; sprites: SpriteSet | null; onClose?: () => void;
  } = $props();
  type Layers = { base: HTMLCanvasElement; people: HTMLCanvasElement; focal: HTMLCanvasElement };
  type Beat = 'establish' | 'focus' | 'settle' | 'settled';
  const identity = $derived(JSON.stringify(view.identity));
  let layers: Layers | null = $state(null);
  let reduced = $state(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let hidden = $state(typeof document !== 'undefined' && document.hidden);
  let beat: Beat = $state(untrack(() => reduced || hidden || sprites === null ? 'settled' : 'establish'));
  let playedIdentity: string | null = null;
  let animations: Animation[] = [];
  let run = 0;

  function release(current: Layers | null): void {
    run++;
    for (const animation of animations) animation.cancel();
    animations = [];
    if (current !== null) for (const layer of Object.values(current)) layer.style.removeProperty('will-change');
  }

  function skip(): void {
    playedIdentity = identity;
    release(layers);
    beat = 'settled';
  }

  function receiveLayers(value: Layers | null): void { layers = value; }

  function preventRepeatedActivation(event: KeyboardEvent): void {
    if (event.repeat && (event.key === ' ' || event.key === 'Enter')) event.preventDefault();
  }

  function close(event: MouseEvent): void {
    if (event.detail > 1) return;
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
    const id = identity;
    const current = layers;
    const artReady = sprites !== null;
    const quiet = reduced || hidden;
    const category = view.category;
    if (current === null) return;
    release(current);
    if (!artReady || quiet || playedIdentity === id) {
      if (quiet) playedIdentity = id;
      beat = 'settled';
      return;
    }
    playedIdentity = id;
    const generation = run;
    const ease = getComputedStyle(current.base).getPropertyValue('--life-ease-out').trim();
    const duration = (token: string) => Number.parseFloat(getComputedStyle(current.base).getPropertyValue(token));
    for (const layer of Object.values(current)) layer.style.willChange = 'transform, opacity';

    async function animate(layer: HTMLCanvasElement, frames: Keyframe[], milliseconds: number): Promise<boolean> {
      const animation = layer.animate(frames, { duration: milliseconds, easing: ease, fill: 'forwards' });
      animations.push(animation);
      try { await animation.finished; }
      catch { return false; } // Cancellation is the expected Skip/invalidation/hidden path.
      return run === generation;
    }

    async function perform(): Promise<void> {
      beat = 'establish';
      const established = await Promise.all([
        animate(current!.base, [{ opacity: 0.82, transform: 'translateY(2px)' }, { opacity: 1, transform: 'translateY(0px)' }], duration('--life-beat-establish')),
        animate(current!.people, [{ opacity: 0.6 }, { opacity: 1 }], duration('--life-beat-establish')),
        animate(current!.focal, [{ opacity: 0.65 }, { opacity: 1 }], duration('--life-beat-establish')),
      ]);
      if (run !== generation || established.some(done => !done)) return;
      beat = 'focus';
      // Documents arrive at their stamp; a named person receives a restrained focus shift.
      const focus = category === 'feud' ? 'translateX(4px)' : category === 'life_stage' ? 'translateY(-2px)' : 'translateY(-4px)';
      if (!await animate(current!.focal, [{ opacity: 1, transform: 'translate(0px, 0px)' }, { opacity: 1, transform: focus }], duration('--life-beat-focus'))) return;
      beat = 'settle';
      if (!await animate(current!.focal, [{ opacity: 1, transform: focus }, { opacity: 1, transform: 'translate(0px, 0px)' }], duration('--life-beat-settle'))) return;
      release(current);
      beat = 'settled';
    }
    void perform();
    return () => release(current);
  });
</script>

<section class="key-scene" aria-label={view.title} data-testid="key-scene" data-category={view.category}
  data-identity={identity} data-beat={beat}>
  <h2>{view.title}</h2>
  <ScenePicture world={view.world} {sprites} kind={view.category} node={view.node} keyScene={view} onLayers={receiveLayers} />
  <div class="scene-controls">
    <button type="button" data-testid="scene-skip" onclick={skip} onkeydown={preventRepeatedActivation}>Skip animation</button>
    {#if view.node === null && onClose !== undefined}
      <button type="button" data-testid="scene-close" onclick={close} onkeydown={preventRepeatedActivation}>Close scene</button>
    {/if}
    <p class="picture-status" data-testid="scene-playback-status">{beat === 'settled' ? 'Picture settled. Full facts remain available.' : 'Optional picture performance. Full facts and actions are available now.'}</p>
  </div>
</section>

<style>
  .key-scene { min-width: 0; }
  h2 { margin: 0 0 12px; }
  .scene-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .picture-status { margin: 0; color: var(--life-muted); font-size: 14px; }
</style>
