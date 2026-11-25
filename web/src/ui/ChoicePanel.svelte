<script lang="ts">
  import { decisionBusy, type UiState } from '../main/ui-state.ts';
  import type { PlayerOption } from '../shared/world-snapshot.ts';
  import { viewModel } from '../main/view-model.ts';
  const { ui, onChoose }: { ui: UiState; onChoose: (worldId: number, node: string, option: PlayerOption) => Promise<void> } = $props();
  const view = $derived(viewModel(ui));
  const currentAction = $derived(ui.actions.find(action => action.request?.type === 'choose' && action.worldId === ui.worldId
    && ui.playerNode.pending && action.request.node === ui.playerNode.node
    && (action.phase === 'sending' || action.phase === 'queued' || action.phase === 'unknown')));
</script>

<section class="choice-panel" aria-labelledby="choice-heading" data-testid="choice-panel">
  <h2 id="choice-heading">A choice to make</h2>
  {#if view?.choice}
    {@const choice = view.choice}
    <div class="decision-grid">
      <div class="choice-context">
        <p class="family">{choice.family} · node <span data-testid="choice-node">{choice.id}</span></p>
        <p class="timing" data-testid="choice-timing">Fired at tick {choice.fired} · choice tick {choice.choiceTick} · resolves at tick {choice.resolves}</p>
        <div class="stakes" data-testid="stakes">
          <h3>Stakes</h3>
          <p>{view.choice.stakes.who.join(', ')}</p>
          <p>{view.choice.stakes.amount} {view.choice.stakes.unit}</p>
          <p>By tick {view.choice.stakes.by} · {view.choice.stakes.days} days from now</p>
        </div>
        <p class="default" data-testid="choice-default">Rules default: {choice.rulesDefault}</p>
      </div>
      <div class="options">
        <p class="preview-note">Original option previews, not applied results. Chronicle reports actual applied and skipped parts.</p>
        {#each view.choice.options as option (option.id)}
          <div class="option" data-testid={`option-preview-${option.id}`}>
            <button type="button" data-testid={`option-${option.id}`}
              onclick={() => onChoose(choice.worldId, choice.id, option.id)}>{option.id}</button>
            <ul aria-label={`${option.id} preview`}>
              {#each option.preview as effect, index (index)}
                <li>{effect.person}: {effect.delta} {effect.unit}{effect.what.startsWith('trait:') ? ` (${effect.what})` : effect.what === 'debt' ? ' (debt)' : ''} · Person {effect.personId}</li>
              {:else}
                <li class="empty">No numerical effects in this preview.</li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </div>
  {:else if currentAction?.phase === 'queued'}
    <p class="recorded" data-testid="choice-recorded" role="status">Choice queued, not applied yet. Use Run or Step to continue.</p>
  {:else if currentAction !== undefined}
    <p class="recorded" role="status">{currentAction.phase === 'unknown' ? 'Choice completion unknown. No retry was sent.' : 'Choice submitting.'} Request {currentAction.requestId}.</p>
  {:else if decisionBusy(ui)}
    <p class="empty">Waiting for the current decision.</p>
  {:else}
    <p class="empty">{view === null ? 'Create a World to meet the town.' : 'The town is quiet. Run to continue.'}</p>
  {/if}
</section>

<style>
  .choice-panel { padding: 16px; min-width: 0; color: var(--life-ink); font: 15px/1.5 system-ui, sans-serif; container-type: inline-size; }
  h2 { margin: 0 0 12px; font-size: 21px; line-height: 1.25; }
  h3 { margin: 0 0 8px; font-size: 15px; }
  p { overflow-wrap: anywhere; }
  .family, .timing { margin: 0 0 12px; }
  .timing, .stakes { font-variant-numeric: tabular-nums; }
  .stakes { margin: 24px 0; }
  .stakes p { margin: 5px 0; }
  .preview-note, .default { color: var(--life-muted); margin: 12px 0; }
  .options { display: flex; flex-direction: column; gap: 16px; }
  .option { border-top: 1px solid var(--life-border); padding-top: 12px; }
  button { max-width: 100%; text-align: left; color: var(--life-on-accent); background: var(--life-accent); border: 1px solid var(--life-accent); font: inherit; padding: 9px 14px; overflow-wrap: anywhere; cursor: pointer; }
  button:hover { background: var(--life-ink); }
  button:focus-visible { outline: 3px solid var(--life-focus); outline-offset: 3px; }
  ul { list-style: none; margin: 8px 0 0; padding: 0; }
  li { overflow-wrap: anywhere; margin-bottom: 5px; }
  .empty { color: var(--life-muted); }
  .recorded { margin: 16px 0 0; }
  .choice-context, .options { min-width: 0; }
  @container (min-width: 640px) {
    .decision-grid { display: grid; grid-template-columns: minmax(200px, 260px) minmax(0, 1fr); gap: 24px; align-items: start; }
    .preview-note { margin-top: 0; }
  }
</style>
