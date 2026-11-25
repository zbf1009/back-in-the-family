<script lang="ts">
  import type { UiState } from '../main/ui-state.ts';
  import { currentDecision } from '../main/ui-state.ts';
  import type { UnderworldForm } from '../main/customization.ts';
  import type { feedbackView } from '../main/view-model.ts';
  import type { PlayerOption, Slot } from '../shared/world-snapshot.ts';
  import type { SpriteSet } from '../art/sprites.ts';
  import ScenePicture from './ScenePicture.svelte';
  import TownView from './TownView.svelte';
  import IdentityPanel from './IdentityPanel.svelte';
  import ChoicePanel from './ChoicePanel.svelte';
  import ChroniclePanel from './ChroniclePanel.svelte';
  import UnderworldPanel from './UnderworldPanel.svelte';
  import Funeral from './scenes/Funeral.svelte';
  import Inheritance from './scenes/Inheritance.svelte';
  import Dream from './scenes/Dream.svelte';
  import Birth from './scenes/Birth.svelte';

  const { ui, sprites, feedback, onChoose, onForm, onDream, onClaim, onBribe, onHaunt, onClose }: {
    ui: UiState; sprites: SpriteSet | null; feedback: ReturnType<typeof feedbackView>;
    onChoose(worldId: number, node: string, option: PlayerOption): Promise<void>;
    onForm(form: UnderworldForm): void; onDream(): Promise<void>; onClaim(slot: Slot): Promise<void>;
    onBribe(worldId: number, amount: string): void; onHaunt(worldId: number, target: number): void;
    onClose(): void;
  } = $props();
  const decision = $derived(currentDecision(ui));
  const head = $derived(ui.scene?.entries[0] ?? null);
  const historical = $derived(head !== null && head.node === null && head.kind !== 'choice' ? head : null);
  let mapOpen = $state(false);
  let mapWorld = 0;
  $effect(() => {
    if (ui.worldId !== mapWorld) {
      mapWorld = ui.worldId;
      mapOpen = false;
    }
  });
</script>

<div class="life-layout" data-testid="life-surface">
  <div class="reading-lane">
    <section class="scene-context" aria-label="Current scene and reported events">
      {#if historical !== null}
        <p class="historical-label">Reported at tick {ui.scene?.tick}. Current identity and actions are shown separately.</p>
        {#if historical.kind === 'funeral'}<Funeral {ui} {sprites} {onClose} />
        {:else if historical.kind === 'inheritance'}<Inheritance {ui} {sprites} {onClose} />
        {:else if historical.kind === 'dream'}<Dream {ui} {sprites} {onClose} />
        {:else}<Birth {ui} {sprites} {onClose} />{/if}
      {:else}
        <ScenePicture world={ui.world} {sprites} kind={decision?.family ?? (ui.world?.player.place === 'waiting' ? 'waiting' : 'living')} node={decision} />
      {/if}
    </section>

    <section id="current-action" class="current-action" tabindex="-1" aria-label="Current choice and actions">
      {#if historical !== null && decision !== null}
        <div class="current-vignette">
          <p>Current choice — available now, independent of the earlier scene.</p>
          <ScenePicture world={ui.world} {sprites} kind={decision.family} node={decision} />
        </div>
      {/if}
      {#if ui.world !== null && ui.world.tick !== ui.tick}
        <p class="as-of" data-testid="world-as-of">World resources and eligibility as of tick {ui.world.tick}.</p>
      {/if}
      {#if ui.world?.player.place === 'waiting'}
        <UnderworldPanel {ui} {onForm} {onDream} {onClaim} {onBribe} {onHaunt} />
      {/if}
      {#if decision !== null || ui.world?.player.place !== 'waiting'}
        <ChoicePanel {ui} {onChoose} />
      {/if}
    </section>

    <section class="results" aria-labelledby="recorded-results-title">
      <h2 id="recorded-results-title">Recorded results</h2>
      {#if feedback.actions.length === 0 && feedback.playerLifecycle.length === 0}
        <p class="muted">No new action or lifecycle result has been reported.</p>
      {:else}
        <a href="#action-result-scroll">Read all action and lifecycle results</a>
        <div id="action-result-scroll" class="result-list" role="region" aria-label="Action and lifecycle results" tabindex="-1">
          {#each feedback.actions as action, index (action.requestId ?? `input-${action.inputSeq}-${index}`)}
            <p role="status" data-testid="action-feedback" data-phase={action.phase}>{action.text}</p>
          {/each}
          {#each feedback.playerLifecycle as fact (fact.event)}
            <p data-testid="lifecycle-feedback">{fact.kind} at tick {fact.tick}: {fact.name} · body {fact.body} · {fact.origin} · event {fact.event}</p>
          {/each}
        </div>
      {/if}
      {#if feedback.settledOmitted > 0}
        <p data-testid="settled-omitted">{feedback.settledOmitted} older settled results omitted. Chronicle remains available.</p>
      {/if}
      <ChroniclePanel {ui} />
    </section>
  </div>

  <aside class="secondary-lane" aria-label="Identity, relationships and optional town context">
    <IdentityPanel {ui} />
    <details class="town-disclosure" data-testid="town-disclosure" bind:open={mapOpen}>
      <summary>Town map</summary>
      <p class="muted">Illustrative positions, not simulated movement or recognition.</p>
      {#if mapOpen}<TownView {ui} {sprites} />{/if}
    </details>
    <a class="back-to-action" href="#current-action">Back to current action</a>
  </aside>
</div>

<style>
  .life-layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 28px; align-items: start; }
  .reading-lane, .secondary-lane, .scene-context, .current-action { min-width: 0; }
  .scene-context { margin-bottom: 16px; }
  .historical-label, .as-of, .muted { color: var(--life-muted); }
  .historical-label { margin: 0 0 8px; }
  .current-action { scroll-margin-top: 16px; }
  .current-vignette { margin-bottom: 16px; }
  .current-vignette p { margin: 0 0 8px; font-weight: 600; }
  .results { margin-top: 28px; border-top: 1px solid var(--life-border); padding-top: 16px; }
  .results h2 { margin: 0 0 12px; }
  .result-list { max-height: 28rem; overflow: auto; padding: 4px 8px; }
  .result-list p { margin: 8px 0; }
  .secondary-lane { border-left: 1px solid var(--life-border); padding-left: 20px; }
  .town-disclosure { margin-top: 20px; border-top: 1px solid var(--life-border); padding-top: 8px; }
  .back-to-action { display: inline-block; margin-top: 16px; padding: 6px 0; }
  @media (max-width: 1100px) {
    .life-layout { grid-template-columns: minmax(0, 1fr) 240px; gap: 20px; }
    .secondary-lane { padding-left: 16px; }
  }
  @media (max-width: 800px) {
    .life-layout { display: block; }
    .secondary-lane { margin-top: 28px; padding-left: 0; padding-top: 16px; border-left: 0; border-top: 1px solid var(--life-border); }
    .result-list { max-height: none; }
  }
</style>
