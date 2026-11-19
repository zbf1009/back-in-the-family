<script lang="ts">
  import { nodeOptionsEnabled, type UiState } from '../main/ui-state.ts';
  import type { PlayerOption } from '../shared/world-snapshot.ts';
  import { viewModel } from '../main/view-model.ts';
  const { ui, onChoose }: { ui: UiState; onChoose: (node: string, option: PlayerOption) => Promise<void> } = $props();
  const view = $derived(viewModel(ui));
  const answered = $derived(ui.playerNode.pending && ui.playerNode.answered);
  const enabled = $derived(nodeOptionsEnabled(ui));
</script>

<section class="choice-panel" aria-labelledby="choice-heading" data-testid="choice-panel">
  <h2 id="choice-heading">A choice to make</h2>
  {#if view?.choice}
    <p class="family">{view.choice.family}</p>
    <div class="stakes" data-testid="stakes">
      <h3>Stakes</h3>
      <p>{view.choice.stakes.who.join(', ')}</p>
      <p>{view.choice.stakes.amount} {view.choice.stakes.unit}</p>
      <p>By tick {view.choice.stakes.by} · {view.choice.stakes.days} days from now</p>
    </div>
    <div class="options">
      {#each view.choice.options as option (option.id)}
        <div class="option" data-testid={`option-preview-${option.id}`}>
          <button type="button" data-testid={`option-${option.id}`}
            disabled={!enabled} onclick={() => onChoose(view!.choice!.id, option.id)}>{option.id}</button>
          <ul aria-label={`${option.id} preview`}>
            {#each option.preview as effect, index (index)}
              <li>{effect.person}: {effect.delta} {effect.unit}{effect.what.startsWith('trait:') ? ` (${effect.what})` : effect.what === 'debt' ? ' (debt)' : ''}</li>
            {:else}
              <li class="empty">No effects.</li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
    {#if answered}
      <p class="recorded" data-testid="choice-recorded" role="status">Choice recorded. Use Run or Step to continue.</p>
    {/if}
  {:else}
    <p class="empty">{view === null ? 'Create a World to meet the town.' : 'The town is quiet. Run to continue.'}</p>
  {/if}
</section>

<style>
  .choice-panel { padding: 16px; min-height: 680px; }
  h2 { margin: 0 0 12px; font-size: 18px; }
  h3 { margin: 0 0 6px; font-size: 14px; }
  .family { margin: 0 0 18px; font-size: 13px; }
  .stakes { margin-bottom: 18px; font-size: 14px; }
  .stakes p { margin: 5px 0; overflow-wrap: anywhere; }
  .options { display: flex; flex-direction: column; gap: 12px; }
  .option { border-top: 1px solid #c6c3b9; padding-top: 10px; }
  button { width: 100%; text-align: center; font-size: 13px; padding: 7px 10px; }
  ul { list-style: none; margin: 6px 0 0; padding: 0; font-size: 13px; line-height: 1.35; }
  li { overflow-wrap: anywhere; }
  .empty { color: #54534f; }
  .recorded { margin: 16px 0 0; font-size: 13px; line-height: 1.4; }
</style>
