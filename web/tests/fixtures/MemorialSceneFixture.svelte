<script lang="ts">
  import { onMount } from 'svelte';
  import KeyScene from '../../src/ui/KeyScene.svelte';
  import { loadLifeSprites, type SpriteSet } from '../../src/art/sprites.ts';
  import { enrichMemorial, memorialKeyScene, type MemorialCapture } from '../../src/main/memorial.ts';
  import type { StoryEvent } from '../../src/shared/story.ts';

  const { initial, death, inheritance }: { initial: MemorialCapture; death: StoryEvent; inheritance: StoryEvent } = $props();
  let capture = $state(initial);
  let sprites = $state<SpriteSet | null>(null);
  let closed = $state(false);
  let closeCount = $state(0);
  let settledCount = $state(0);
  let presentationVersion = $state(0);
  let facts = $state<StoryEvent[]>([death]);
  let ordinaryTicks = $state(0);
  const view = $derived(memorialKeyScene(capture));
  function receiveEstate(): void {
    if (!facts.some(event => event.id === inheritance.id)) facts = [...facts, inheritance];
    if (!closed) capture = enrichMemorial(capture, capture.worldId, [inheritance]);
  }
  function close(): void { closeCount++; closed = true; }
  function settled(): void { settledCount++; }
  onMount(() => {
    window.__memorialSceneFixture = { read: () => ({ world: initial.world, facts: $state.snapshot(facts),
      identity: view.identity, lines: view.lines, closeCount, settledCount, ordinaryTicks, inputs: [] }) };
    void loadLifeSprites().then(value => { sprites = value; });
    return () => { delete window.__memorialSceneFixture; };
  });
</script>

<main>
  <h1>Memorial — COMPONENT-ONLY factual carrier</h1>
  {#if sprites !== null && !closed}
    <KeyScene {view} {sprites} {presentationVersion} onClose={close} onSettled={settled} />
  {/if}
  <section aria-label="Component carrier controls">
    <button type="button" data-testid="fixture-estate" onclick={receiveEstate}>Deliver exact estate fact</button>
    <button type="button" data-testid="fixture-tick" onclick={() => { ordinaryTicks++; }}>Ordinary tick carrier</button>
    <button type="button" data-testid="fixture-truncate" onclick={() => { presentationVersion++; }}>Truncate decoration</button>
  </section>
</main>

<style>
  main { max-width: 1000px; margin: 0 auto; padding: 20px; }
  h1 { font: 18px system-ui, sans-serif; }
  section { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
  section button { min-height: 44px; padding: 8px 12px; font: inherit; }
</style>
