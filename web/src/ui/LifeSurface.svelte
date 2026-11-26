<script lang="ts">
  import { onMount } from 'svelte';
  import type { UiState } from '../main/ui-state.ts';
  import { currentDecision } from '../main/ui-state.ts';
  import type { SceneClose } from '../main/scene-queue.ts';
  import type { UnderworldForm } from '../main/customization.ts';
  import type { feedbackView } from '../main/view-model.ts';
  import { operationStates } from '../main/operation-state.ts';
  import { dateLabel } from '../main/calendar.ts';
  import type { PlayerOption, Slot } from '../shared/world-snapshot.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import ScenePicture from './ScenePicture.svelte';
  import TownView from './TownView.svelte';
  import IdentityPanel from './IdentityPanel.svelte';
  import ChoicePanel from './ChoicePanel.svelte';
  import UnderworldPanel from './UnderworldPanel.svelte';
  import ActionFeedback from './ActionFeedback.svelte';
  import LifeJournal from './LifeJournal.svelte';
  import KeyScene from './KeyScene.svelte';

  const { ui, sprites, feedback, presentationVersion = 0, onChoose, onForm, onDream, onClaim, onBribe, onHaunt, onClose, onSettled }: {
    ui: UiState; sprites: SpriteSet | null; feedback: ReturnType<typeof feedbackView>; presentationVersion?: number;
    onChoose(worldId: number, node: string, option: PlayerOption): Promise<void>;
    onForm(form: UnderworldForm): void; onDream(): Promise<void>; onClaim(slot: Slot): Promise<void>;
    onBribe(worldId: number, amount: string): void; onHaunt(worldId: number, target: number): void;
    onClose(expected: SceneClose): void;
    onSettled(expected: SceneClose): void;
  } = $props();
  const decision = $derived(currentDecision(ui));
  const head = $derived(ui.scene?.entries[0] ?? null);
  const paperwork = $derived(operationStates(ui));
  const otherPaperwork = $derived(paperwork.filter(state => state.kind === 'choose'
    ? decision === null : ui.world?.player.place !== 'waiting'));
  const closeHead = $derived.by(() => {
    const queue = ui.scene;
    const entry = queue?.entries[0];
    return queue === null || entry === undefined || entry.node !== null ? undefined
      : () => onClose({ worldId: queue.worldId, tick: queue.tick, entry });
  });
  const settledHead = $derived.by(() => {
    const queue = ui.scene;
    const entry = queue?.entries[0];
    return queue === null || entry === undefined || entry.node !== null ? undefined
      : () => onSettled({ worldId: queue.worldId, tick: queue.tick, entry });
  });
  let mapOpen = $state(false);
  let mapWorld = 0;
  let filesOpen = $state(typeof window !== 'undefined' && !window.matchMedia('(max-width: 1150px)').matches);
  onMount(() => {
    const narrow = window.matchMedia('(max-width: 1150px)');
    const update = () => { filesOpen = !narrow.matches; };
    narrow.addEventListener('change', update);
    return () => narrow.removeEventListener('change', update);
  });
  $effect(() => {
    if (ui.worldId !== mapWorld) { mapWorld = ui.worldId; mapOpen = false; }
  });
</script>

<div class="life-layout" data-testid="life-surface" data-place={ui.world?.player.place}>
  <div class="reading-lane">
    <section class="scene-context" aria-label="The current scene">
      {#if head?.keyScene !== null && head?.keyScene !== undefined}
        {#key head.identity}<KeyScene view={head.keyScene} {sprites} {presentationVersion} onClose={closeHead} onSettled={settledHead} next={(ui.scene?.entries.length ?? 0) > 1} />{/key}
      {:else}
        <ScenePicture world={ui.world} {sprites} kind={decision?.family ?? (ui.world?.player.place === 'waiting' ? 'waiting' : 'living')} node={decision} running={ui.runState === 'running'} worldKey={ui.worldId} />
      {/if}
    </section>
    <section id="current-action" class="current-action" tabindex="-1" aria-label="Your next action">
      {#if ui.world !== null && ui.world.tick !== ui.tick}
        <p class="as-of" data-testid="world-as-of">Resources and available actions last checked on {dateLabel(ui.world.tick)}.</p>
      {/if}
      {#if decision !== null}
        <ChoicePanel {ui} {onChoose} operationStates={paperwork} />
      {/if}
      {#if ui.world?.player.place === 'waiting'}
        <UnderworldPanel {ui} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} operationStates={paperwork} />
      {/if}
      <ActionFeedback operationStates={otherPaperwork} actors={ui.notebook.actors} />
    </section>
    {#if ui.world !== null}
      <LifeJournal notebook={ui.notebook} playerSoul={ui.world.player_soul} currentBody={ui.world.player.body} running={ui.runState === 'running'} speed={ui.speed} />
    {/if}
    <details class="technical-results"><summary>Technical result records</summary>
      {#each feedback.actions as action, index (action.requestId ?? 'input-' + action.inputSeq + '-' + index)}
        <p data-phase={action.phase}>{action.text}</p>
      {/each}
      <p>{feedback.settledOmitted} older display receipts; the native journal and replay remain available.</p>
    </details>
  </div>
  <aside class="secondary-lane" aria-label="People files and town context">
    <details class="people-files" bind:open={filesOpen}><summary>People files</summary><IdentityPanel {ui} /></details>
    <details class="town-disclosure" data-testid="town-disclosure" bind:open={mapOpen}>
      <summary>Town map</summary>
      <p class="muted">An illustration of the town, not recorded movement.</p>
      {#if mapOpen}<TownView {ui} {sprites} />{/if}
    </details>
    <a class="back-to-action" href="#current-action">Back to your next action</a>
  </aside>
</div>

<style>
  .life-layout { display: grid; grid-template-columns: minmax(0, 896px) minmax(220px, 1fr); gap: 24px; align-items: start; }
  .reading-lane, .secondary-lane, .scene-context, .current-action { min-width: 0; }
  .scene-context { margin-bottom: 24px; }
  .as-of, .muted { color: var(--life-muted); }
  .current-action { scroll-margin-top: 20px; }
  .secondary-lane { border-left: 1px solid var(--life-border); padding-left: 20px; }
  .town-disclosure, .technical-results { margin-top: 24px; border-top: 1px solid var(--life-border); padding-top: 8px; }
  .technical-results { max-width: 100%; }
  .back-to-action { display: inline-block; margin-top: 20px; padding: 8px 0; }
  @media (max-width: 1150px) {
    .life-layout { display: flex; flex-direction: column; }
    .reading-lane, .secondary-lane { width: 100%; }
    .secondary-lane { padding-left: 0; padding-top: 20px; border-left: 0; border-top: 1px solid var(--life-border); }
    .people-files :global(.people-grid) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
  }
</style>
